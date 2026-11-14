'use strict';

// auditScanChargeRaceReadonly.test.js — الملحق الثاني بالقرار ١٠٤ (2026-09-26
// +03)، البند ٢ (ب). نصّ الأمر: "اختبار محلّي بلا شبكة إن أمكن: بقاعدة
// وهمية في الذاكرة، يثبت أن السكربت لا يكتب، وأنه يعدّ عيّنة مصطنعة فيها
// سباق." يتحقّق من شقّين معاً — لا الحارس الكاتب وحده (ذاك مُختبَر بنفس
// أسلوب auditDeviceProfilesReadonly.test.js) بل buildSummary() الفعلية
// على db مُزيَّف بالكامل، لا Firestore حقيقي، لا شبكة.
//
// **أمانة المحاكاة (القاعدة 37)**: db المُزيَّف أدناه يُعيد فقط الأشكال
// (id/data()) التي يقرأها buildSummary فعلاً (scanClaims.claimedAtMs،
// deviceProfiles.scanHistory[].scanId) — لا يحاكي فهارس/استعلامات Firestore
// الحقيقية (.where/.orderBy) لأن buildSummary لا تستعملها (قراءة .get() على
// المجموعة كاملة فقط). هذا يكفي لأمانة المحاكاة هنا تحديداً — لو استُعمل
// هذا المُزيَّف لاختبار شيء يعتمد فهرسة Firestore الحقيقية لكان غير أمين،
// ويُعلَن ذلك صراحةً هنا لا يُطوى.
//
// Run: node functions/test/auditScanChargeRaceReadonly.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {wrapReadOnly, hashId, buildSummary, CLAIM_TTL_MS, PROJECT_ID, toIso03Timestamp} = require('../scripts/audit-scan-charge-race-readonly');

// Firestore Timestamp مُزيَّف — كل ما يقرؤه toIso03Timestamp هو .toDate().
function fakeTimestamp(ms) {
  return {toDate: () => new Date(ms)};
}

// ─── عيّنة مصطنعة فيها سباق فعلياً (مُوسَّعة — القرار ١٠٤ ملحق رابع) ───────
// scanClaims: مطالبة "fresh" (لا تُعَدّ)، ومطالبة "stale" (تُعَدّ).
// deviceProfiles:
//   p-clean            — بلا تكرار.
//   p-race             — scan-raced مكرَّر **بوقتين مختلفين** (scanDate)؛
//                         reports/scan-raced **موجود** بـcreatedAt/analyzedAt
//                         حقيقيَّين (يُثبت "الوقتين يظهران" + قراءة تقرير ناجحة).
//   p-race-no-report   — scan-orphaned-race مكرَّر مرّتين (بلا scanDate على
//                         العنصر الثاني — يُثبت FIELD_ABSENT)؛
//                         reports/scan-orphaned-race **غير موجود إطلاقاً**
//                         (يُثبت "مكرَّر بلا مستند reports يُخرج null بسببه").
const NOW = Date.now();
const RACED_T1_MS = NOW - 200_000; // النداء الأوّل (الأقدم)
const RACED_T2_MS = NOW - 100_000; // النداء الثاني (الأحدث، مُلحَق أوّلاً — FIFO يضع الجديد في الرأس)
const REPORT_CREATED_AT_MS = NOW - 95_000; // بعد آخر إلحاق بقليل — واقعي (reportRef.set يسبق appendScanToHistory)
let realWriteCalls = 0;
function fakeDb() {
  return {
    collection: (name) => {
      if (name === 'scanClaims') {
        return {
          get: async () => ({
            size: 2,
            docs: [
              {id: 'scan-fresh-claim', data: () => ({scanId: 'scan-fresh-claim', userId: 'u1', claimedAtMs: NOW - 1000})}, // عمر ثانية واحدة — لا يُعَدّ
              {id: 'scan-stale-claim', data: () => ({scanId: 'scan-stale-claim', userId: 'u2', claimedAtMs: NOW - (CLAIM_TTL_MS + 60_000)})}, // أقدم من TTL بدقيقة — يُعَدّ
            ],
          }),
          doc: (id) => fakeDocRef('scanClaims', id),
        };
      }
      if (name === 'deviceProfiles') {
        return {
          get: async () => ({
            size: 3,
            docs: [
              {id: 'p-clean', data: () => ({scanHistory: [
                {scanId: 'scan-a', reportRef: 'reports/scan-a', scanDate: fakeTimestamp(NOW)},
                {scanId: 'scan-b', reportRef: 'reports/scan-b', scanDate: fakeTimestamp(NOW)},
              ]})},
              {id: 'p-race', data: () => ({scanHistory: [
                {scanId: 'scan-raced', reportRef: 'reports/scan-raced', scanDate: fakeTimestamp(RACED_T2_MS)}, // النداء الثاني (الأحدث، مُلحَق أوّلاً)
                {scanId: 'scan-other', reportRef: 'reports/scan-other', scanDate: fakeTimestamp(NOW)},
                {scanId: 'scan-raced', reportRef: 'reports/scan-raced', scanDate: fakeTimestamp(RACED_T1_MS)}, // النداء الأوّل — نفس scanId، وقت مختلف
              ]})},
              {id: 'p-race-no-report', data: () => ({scanHistory: [
                {scanId: 'scan-orphaned-race', reportRef: 'reports/scan-orphaned-race', scanDate: fakeTimestamp(NOW)},
                {scanId: 'scan-orphaned-race'}, // النداء الآخر — بلا scanDate إطلاقاً (FIELD_ABSENT)
              ]})},
            ],
          }),
          doc: (id) => fakeDocRef('deviceProfiles', id),
        };
      }
      if (name === 'reports') {
        return {
          get: async () => ({size: 0, docs: []}),
          doc: (id) => {
            if (id === 'scan-raced') {
              return {get: async () => ({
                exists: true, id,
                data: () => ({createdAt: fakeTimestamp(REPORT_CREATED_AT_MS), analyzedAt: REPORT_CREATED_AT_MS - 5000}),
              })};
            }
            if (id === 'scan-orphaned-race') {
              return {get: async () => ({exists: false, id, data: () => undefined})};
            }
            return fakeDocRef('reports', id);
          },
        };
      }
      return {get: async () => ({size: 0, docs: []}), doc: (id) => fakeDocRef(name, id), add: async () => { realWriteCalls++; }};
    },
    doc: (path) => ({get: async () => ({exists: false, data: () => null})}),
    batch: () => ({}),
    runTransaction: async () => {},
  };
}
function fakeDocRef(collectionName, id) {
  return {
    get: async () => ({exists: true, id, data: () => ({})}),
    set: async () => { realWriteCalls++; },
    update: async () => { realWriteCalls++; },
    delete: async () => { realWriteCalls++; },
    collection: (sub) => fakeDb().collection(sub),
  };
}

(async () => {
  const ro = wrapReadOnly(fakeDb());

  // ═══════════════════════════════════════════════════════════════════
  // ٠ — كل دالّة كتابة معروفة ترمي TRAP قبل أي تنفيذ (نفس تحقّق ١ في
  //     auditDeviceProfilesReadonly.test.js حرفياً) — دفاع مباشر، لا
  //     الاستدلال غير المباشر وحده (تحقّق ١ أدناه) من أن buildSummary لا
  //     تستدعيها أصلاً.
  // ═══════════════════════════════════════════════════════════════════
  realWriteCalls = 0;
  const writeAttempts = [
    ['doc.set', async () => ro.collection('scanClaims').doc('x').set({})],
    ['doc.update', async () => ro.collection('deviceProfiles').doc('x').update({})],
    ['doc.delete', async () => ro.collection('scanClaims').doc('x').delete()],
    ['collection.add', async () => ro.collection('scanClaims').add({})],
    ['db.batch', () => ro.batch()],
    ['db.runTransaction', () => ro.runTransaction(async () => {})],
  ];
  for (const [label, attempt] of writeAttempts) {
    let threw = null;
    try {
      await attempt();
    } catch (e) {
      threw = e;
    }
    ok(threw && /TRAP: write operation/.test(threw.message), `[٠] ${label} يرمي TRAP قبل أي تنفيذ — ${threw && threw.message}`);
  }
  eq(realWriteCalls, 0, '[٠] صفر استدعاء كتابة حقيقي وصل db المُزيَّف — كلّها اعتُرضت قبل التنفيذ');
  console.log('تحقّق ٠: كل دوالّ الكتابة الستّ (set/update/delete/add/batch/runTransaction) تُحجَب قبل أي تنفيذ');

  // ═══════════════════════════════════════════════════════════════════
  // ١ — buildSummary لا تكتب شيئاً على db المُزيَّف (لا set/update/delete
  //     تصل فعلياً — كل محاولة كانت سترمي TRAP عبر wrapReadOnly أصلاً).
  // ═══════════════════════════════════════════════════════════════════
  realWriteCalls = 0;
  const summary = await buildSummary(ro);
  eq(realWriteCalls, 0, '[١] buildSummary على db مُزيَّف — صفر استدعاء كتابة حقيقي وصل الطبقة السفلى');
  console.log('تحقّق ١: buildSummary لا تكتب شيئاً — صفر استدعاء كتابة على db المُزيَّف بالكامل');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — الحقول الثابتة (projectId أوّلاً، claimTtlMs).
  // ═══════════════════════════════════════════════════════════════════
  eq(summary.projectId, PROJECT_ID, '[٢] projectId أوّل حقل، مطابق للثابت المُصدَّر');
  eq(summary.claimTtlMs, CLAIM_TTL_MS, '[٢] claimTtlMs مطابق للثابت (300000)');
  console.log('تحقّق ٢: الحقول الثابتة (projectId/claimTtlMs) حاضرة وصحيحة');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — القيم التي لا سجلّ لها: NOT_RECORDED صراحةً، لا صفر، لا افتراض.
  // ═══════════════════════════════════════════════════════════════════
  eq(summary.counts.scansChargedMoreThanOnce.status, 'NOT_RECORDED', '[٣][جوهري] فحوص خُصم لها أكثر من رصيد — NOT_RECORDED دائماً (لا سجلّ بمعرِّف scanId إطلاقاً)');
  eq(summary.counts.scansChargedMoreThanOnce.value, null, '[٣] قيمتها null — لا صفر مُختلَق');
  eq(summary.counts.reportsWrittenTwiceDirect.status, 'NOT_RECORDED', '[٣][جوهري] تقارير كُتبت مرّتين (دليل مباشر) — NOT_RECORDED دائماً');
  eq(summary.counts.reportsCountVsChargedNotAttempted.status, 'NOT_RECORDED', '[٣] مقارنة التقارير بالخصم — NOT_RECORDED (لم يُحاوَل، لا أساس موثوق)');
  console.log('تحقّق ٣: القيم التي لا سجلّ لها مُعلَنة NOT_RECORDED صراحةً — لا صفر مُموَّه بديلاً عن الغياب');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — العدّان الفعليّان: يعدّان العيّنة المصطنعة فيها السباق بدقّة.
  // ═══════════════════════════════════════════════════════════════════
  eq(summary.counts.staleScanClaims.status, 'COUNTED', '[٤] staleScanClaims: COUNTED');
  eq(summary.counts.staleScanClaims.value, 1, '[٤][مطلوب صراحةً] staleScanClaims يعدّ 1 (المطالبة "stale" فقط، لا "fresh")');
  eq(summary.counts.staleScanClaims.examplesHashed.length, 1, '[٤] مثال واحد فقط للمطالبة المتقادمة');
  eq(summary.counts.staleScanClaims.examplesHashed[0].scanIdHash, hashId('scan-stale-claim'), '[٤] المثال مُهشَّر (لا معرِّف خام) ويطابق hashId المُصدَّرة');
  ok(summary.counts.staleScanClaims.examplesHashed[0].ageMs > CLAIM_TTL_MS, '[٤] عمر المثال المُبلَّغ فعلاً أكبر من TTL');

  eq(summary.counts.duplicateScanHistoryEntries.status, 'COUNTED', '[٤] duplicateScanHistoryEntries: COUNTED');
  eq(summary.counts.duplicateScanHistoryEntries.value, 2, '[٤][مطلوب صراحةً] duplicateScanHistoryEntries يعدّ 2 (p-race وp-race-no-report، لا p-clean)');
  eq(summary.counts.duplicateScanHistoryEntries.examplesHashed.length, 2, '[٤] مثالان — profيلا السباق كلاهما');

  const pRaceExample = summary.counts.duplicateScanHistoryEntries.examplesHashed.find((e) => e.profileIdHash === hashId('p-race'));
  const pOrphanExample = summary.counts.duplicateScanHistoryEntries.examplesHashed.find((e) => e.profileIdHash === hashId('p-race-no-report'));
  ok(pRaceExample && pOrphanExample, '[٤] كلا المثالين (p-race/p-race-no-report) حاضران بمعرِّفهما المُهشَّر');
  eq(pRaceExample.duplicateScanIdHashes.length, 1, '[٤] p-race: scanId مكرَّر واحد بالضبط (scan-raced)');
  eq(pRaceExample.duplicateScanIdHashes[0].scanIdHash, hashId('scan-raced'), '[٤] scanId المكرَّر مُهشَّر ويطابق scan-raced');
  eq(pRaceExample.duplicateScanIdHashes[0].occurrences, 2, '[٤] عدد التكرار = 2 بالضبط (كما بُنيت العيّنة)');
  console.log('تحقّق ٤ [جوهري]: العدّان الفعليّان (staleScanClaims/duplicateScanHistoryEntries) يعدّان العيّنة المصطنعة فيها السباق بدقّة — 1/2، بلا زيادة أو نقصان');

  // ═══════════════════════════════════════════════════════════════════
  // ٤-ب — القرار ١٠٤ ملحق رابع [مطلوب صراحةً]: "عيّنة مصطنعة فيها مكرَّر
  //        بوقتين مختلفين تُخرج الوقتين. ومكرَّر بلا مستند reports يُخرج
  //        null بسببه."
  // ═══════════════════════════════════════════════════════════════════
  const racedTimes = pRaceExample.duplicateScanIdHashes[0].scanHistoryTimestamps;
  eq(racedTimes.length, 2, '[٤-ب] وقتان بالضبط لِـscan-raced (بعدد ظهوراته)');
  eq(racedTimes[0].status, 'PRESENT', '[٤-ب] الظهور الأوّل (الأحدث، RACED_T2_MS) — PRESENT');
  eq(racedTimes[1].status, 'PRESENT', '[٤-ب] الظهور الثاني (الأقدم، RACED_T1_MS) — PRESENT');
  ok(typeof racedTimes[0].iso === 'string' && racedTimes[0].iso.endsWith('+03:00'), '[٤-ب] وقت ISO بصيغة +03:00 صريحة');
  ok(racedTimes[0].iso !== racedTimes[1].iso,
      `[٤-ب][مطلوب صراحةً] الوقتان مختلفان فعلياً — ${racedTimes[0].iso} ≠ ${racedTimes[1].iso}`);
  eq(racedTimes[0].iso, toIso03Timestamp(fakeTimestamp(RACED_T2_MS)), '[٤-ب] الوقت الأوّل يطابق RACED_T2_MS حرفياً (تحويل صحيح)');
  eq(racedTimes[1].iso, toIso03Timestamp(fakeTimestamp(RACED_T1_MS)), '[٤-ب] الوقت الثاني يطابق RACED_T1_MS حرفياً');

  const racedReport = pRaceExample.duplicateScanIdHashes[0].report;
  eq(racedReport.documentStatus, 'EXISTS', '[٤-ب] reports/scan-raced موجود فعلاً في هذه العيّنة');
  eq(racedReport.createdAt.status, 'PRESENT', '[٤-ب] createdAt حاضر (Firestore Timestamp مُزيَّف)');
  eq(racedReport.createdAt.iso, toIso03Timestamp(fakeTimestamp(REPORT_CREATED_AT_MS)), '[٤-ب] createdAt.iso يطابق REPORT_CREATED_AT_MS حرفياً');
  eq(racedReport.analyzedAt.status, 'PRESENT', '[٤-ب] analyzedAt حاضر (رقم epoch ms مباشرة، لا Timestamp)');
  eq(racedReport.analyzedAt.iso, toIso03Timestamp(REPORT_CREATED_AT_MS - 5000), '[٤-ب] analyzedAt.iso يطابق الرقم المُعطى حرفياً');
  console.log('تحقّق ٤-ب [مطلوب صراحةً]: مكرَّر بوقتين مختلفين (scan-raced) يُخرج الوقتين فعلياً، مختلفين، بصيغة ISO+03:00، ومعهما وقتا reports الحقيقيّان');

  // مكرَّر بلا مستند reports إطلاقاً — يُخرج null بسببه (DOCUMENT_ABSENT)،
  // ومكرَّر بلا scanDate على أحد ظهوريه — يُخرج null بسببه (FIELD_ABSENT).
  eq(pOrphanExample.duplicateScanIdHashes.length, 1, '[٤-ب] p-race-no-report: scanId مكرَّر واحد (scan-orphaned-race)');
  const orphanEntry = pOrphanExample.duplicateScanIdHashes[0];
  eq(orphanEntry.scanIdHash, hashId('scan-orphaned-race'), '[٤-ب] scanId المكرَّر مُهشَّر ويطابق scan-orphaned-race');
  eq(orphanEntry.occurrences, 2, '[٤-ب] عدد التكرار = 2');
  eq(orphanEntry.scanHistoryTimestamps[0].status, 'PRESENT', '[٤-ب] الظهور الأوّل يحمل scanDate فعلياً — PRESENT');
  eq(orphanEntry.scanHistoryTimestamps[1].status, 'FIELD_ABSENT', '[٤-ب][مطلوب صراحةً] الظهور الثاني بلا scanDate إطلاقاً — FIELD_ABSENT، لا صفر ولا وقت افتراضي');
  eq(orphanEntry.scanHistoryTimestamps[1].iso, null, '[٤-ب] iso=null حين FIELD_ABSENT');
  eq(orphanEntry.report.documentStatus, 'DOCUMENT_ABSENT', '[٤-ب][مطلوب صراحةً] reports/scan-orphaned-race غير موجود — DOCUMENT_ABSENT');
  eq(orphanEntry.report.createdAt.status, 'DOCUMENT_ABSENT', '[٤-ب] createdAt.status=DOCUMENT_ABSENT حين لا مستند إطلاقاً');
  eq(orphanEntry.report.createdAt.iso, null, '[٤-ب][مطلوب صراحةً] createdAt.iso=null بسببه (DOCUMENT_ABSENT) — لا صفر ولا وقت افتراضي');
  eq(orphanEntry.report.analyzedAt.status, 'DOCUMENT_ABSENT', '[٤-ب] analyzedAt.status=DOCUMENT_ABSENT لنفس السبب');
  eq(orphanEntry.report.analyzedAt.iso, null, '[٤-ب] analyzedAt.iso=null بسببه');
  console.log('تحقّق ٤-ب [مطلوب صراحةً]: مكرَّر بلا مستند reports (scan-orphaned-race) يُخرج null بسببه (DOCUMENT_ABSENT) على كلا الحقلين، وظهور بلا scanDate يُخرج null بسببه (FIELD_ABSENT)');

  eq(summary.scanClaimsTotalDocs, 2, '[٤] إجمالي مستندات scanClaims المفحوصة = 2');
  eq(summary.deviceProfilesTotalDocs, 3, '[٤] إجمالي مستندات deviceProfiles المفحوصة = 3');

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — hashId لا تُسرِّب المعرِّف الخام (القاعدة 36).
  // ═══════════════════════════════════════════════════════════════════
  const allExamplesJson = JSON.stringify(summary.counts);
  ok(!allExamplesJson.includes('scan-stale-claim'), '[٥] المعرِّف الخام scan-stale-claim لا يظهر في المخرَج، فقط هاشه');
  ok(!allExamplesJson.includes('scan-raced'), '[٥] المعرِّف الخام scan-raced لا يظهر في المخرَج، فقط هاشه');
  ok(!allExamplesJson.includes('scan-orphaned-race'), '[٥] المعرِّف الخام scan-orphaned-race لا يظهر في المخرَج، فقط هاشه');
  ok(!allExamplesJson.includes('p-race'), '[٥] معرِّف profile الخام p-race (وp-race-no-report) لا يظهر في المخرَج، فقط هاشه');
  console.log('تحقّق ٥: لا معرِّف خام (scanId/profileId) في المخرَج — كلّها مُهشَّرة (القاعدة 36)');

  console.log(`\nauditScanChargeRaceReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});

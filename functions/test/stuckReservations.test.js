'use strict';

// stuckReservations.test.js — جرد الحجوزات العالقة وإعادتها (V8 قبل أوّل نشر، 2026-10-09 +03). وحدة بلا شبكة ولا محاكي:
// المعيار (classifyClaim) بكل حالاته وحدّه، والمخرَج المهشَّر، والوسائط، و--preflight، وأن السكربتين يستعملان المصدر الواحد
// (releaseScanCredit نفسها، wrapReadOnly، hashIdForLog) لا نسخاً. الإنفاذ على Firestore حقيقي (المحاكي): stuckReservations.e2e.test.js.
//
// Run: node functions/test/stuckReservations.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const L = require('../scripts/lib/stuckReservations');
const audit = require('../scripts/audit-stuck-scan-reservations-readonly');
const release = require('../scripts/release-stuck-scan-reservations');
const {PROJECT_ID} = require('../scripts/audit-device-profiles-readonly');
const {hashIdForLog} = require('../src/utils/logRedaction');

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;
const res = (over = {}) => ({reservation: {userId: 'user-x', isFreeTrial: false, deviceFP: null, reservedAtMs: NOW - 30 * MIN, ...over}});
const cls = (claimData, reportExists = false) => L.classifyClaim({claimData, reportExists, nowMs: NOW});

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — المعيار: حجز غير null، وأقدم من 10 دقائق، وبلا تقرير
  // ═══════════════════════════════════════════════════════════════════
  eq(L.STUCK_AFTER_MS, 600000, '[١] العتبة 10 دقائق بنصّ القرار (لا TTL=5 دقائق في تعليق scanReservation.js:30-33)');
  eq(cls(res()).state, 'STUCK', '[١] حجز عمره 30 دقيقة بلا تقرير ⇒ STUCK');
  eq(cls(res({reservedAtMs: NOW - 10 * MIN - 1})).state, 'STUCK', '[١] 10 دقائق ومللي ثانية ⇒ STUCK');
  eq(cls(res({reservedAtMs: NOW - 10 * MIN})).state, 'RECENT', '[١] 10 دقائق تماماً ليس «أقدم من» ⇒ RECENT');
  eq(cls(res({reservedAtMs: NOW - 2 * MIN})).state, 'RECENT', '[١] حجز عمره دقيقتان ⇒ RECENT (قد يكون تحليلاً جارياً)');
  eq(cls(res({reservedAtMs: NOW + 5 * MIN})).state, 'RECENT', '[١] حجز في المستقبل (انحراف ساعة) ⇒ RECENT لا STUCK');
  eq(cls(res(), true).state, 'HAS_REPORT', '[١] أقدم من 10 دقائق ولـreports/{scanId} موجود ⇒ HAS_REPORT (لا إعادة: الفحصة مستهلَكة)');
  eq(cls(res({reservedAtMs: NOW - 2 * MIN}), true).state, 'RECENT', '[١] حديث وله تقرير ⇒ RECENT (العمر أوّلاً)');
  eq(cls({reservation: null}).state, 'NO_RESERVATION', '[١] reservation=null ⇒ NO_RESERVATION');
  eq(cls({}).state, 'NO_RESERVATION', '[١] reservation غائب ⇒ NO_RESERVATION');
  eq(cls(null).state, 'NO_RESERVATION', '[١] claimData=null ⇒ NO_RESERVATION');
  for (const [label, bad] of [
    ['reservation نصّ', 'x'], ['بلا reservedAtMs', {userId: 'u'}], ['reservedAtMs نصّ', {userId: 'u', reservedAtMs: '123'}],
    ['reservedAtMs NaN', {userId: 'u', reservedAtMs: NaN}], ['reservedAtMs Infinity', {userId: 'u', reservedAtMs: Infinity}],
    ['بلا userId', {reservedAtMs: NOW - 30 * MIN}], ['userId فارغ', {userId: '', reservedAtMs: NOW - 30 * MIN}], ['userId رقم', {userId: 5, reservedAtMs: NOW - 30 * MIN}],
  ]) {
    eq(cls({reservation: bad}).state, 'MALFORMED', `[١] ${label} ⇒ MALFORMED (الغياب لا يُقرأ قِدَماً ولا حداثة — القاعدة 22)`);
  }
  eq(cls(res()).ageMs, 30 * MIN, '[١] ageMs = الآن − reservedAtMs');
  eq(cls({reservation: null}).ageMs, null, '[١] بلا حجز: ageMs=null');
  deq(Object.values(L.CLAIM_STATE).sort(), ['HAS_REPORT', 'MALFORMED', 'NO_RESERVATION', 'RECENT', 'STUCK'], '[١] خمس حالات مسمّاة');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — المخرَج: أعداد ومعرّفات مهشَّرة، لا معرّف خامّ
  // ═══════════════════════════════════════════════════════════════════
  const stuck = Array.from({length: 60}, (_, i) => ({
    scanId: `scan-secret-${i}`, userId: i % 2 === 0 ? 'user-secret-a' : 'user-secret-b', isFreeTrial: i % 10 === 0, ageMs: (11 + i) * MIN, claimedAtMs: NOW - (11 + i) * MIN,
  }));
  const sum = L.summarizeCollected({totalClaims: 100, byState: {STUCK: 60, RECENT: 40}, stuck});
  const printed = JSON.stringify(sum);
  ok(!/scan-secret|user-secret/.test(printed), '[٢] لا scanId ولا معرّف مستخدم خامّ في المخرَج (القاعدة 36)');
  ok(/^#[0-9a-f]{12}$/.test(sum.stuckListedHashed[0].scanId) && /^#[0-9a-f]{12}$/.test(sum.stuckListedHashed[0].userId), '[٢] التهشير بصيغة hashIdForLog (#+12 سداسية)');
  eq(sum.stuckListedHashed[0].scanId, hashIdForLog('scan-secret-0'), '[٢] المهشَّر = ناتج الدالّة المُصدَّرة في سياسة السجلّات بعينها');
  eq(sum.stuckCount, 60, '[٢] العدد كاملاً');
  eq(sum.stuckListedHashed.length, L.MAX_LISTED, '[٢] المسرود مسقوف (50)');
  eq(sum.stuckListTruncated, true, '[٢] والاقتطاع معلَن');
  deq(sum.stuckByUserHashed, {[hashIdForLog('user-secret-a')]: 30, [hashIdForLog('user-secret-b')]: 30}, '[٢] التجميع بالمستخدم مهشَّراً');
  eq(sum.creditsHeldByStuckReservations, 60, '[٢] كل حجز عالق = فحصة محجوزة');
  eq(sum.stuckFreeTrial, 6, '[٢] عدد الفحص المجاني منها');
  deq(sum.stuckAgeMinutes, {min: 11, max: 70}, '[٢] أصغر وأكبر عمر بالدقائق');
  const empty = L.summarizeCollected({totalClaims: 0, byState: {}, stuck: []});
  deq(empty.stuckAgeMinutes, {min: null, max: null}, '[٢] بلا عالق: العمر null لا صفر (القاعدة 22)');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — --preflight بلا شبكة، والوسائط
  // ═══════════════════════════════════════════════════════════════════
  eq(L.preflightChecks().ok, true, '[٣] الفحص الذاتي يمرّ');
  for (const [name, mod] of [['audit', audit], ['release', release]]) {
    const lines = [];
    const code = await mod.main(['--preflight'], {out: (s) => lines.push(s), err: (s) => lines.push(`ERR ${s}`), initAdmin: () => { throw new Error('preflight must not open Admin SDK'); }});
    eq(code, 0, `[٣] ${name} --preflight: رمز الخروج 0 ولم يفتح Admin SDK`);
    const j = JSON.parse(lines.join('\n'));
    ok(j.projectId === PROJECT_ID && j.mode === 'preflight' && j.network === false && j.ok === true && j.stuckAfterMinutes === 10, `[٣] ${name} --preflight: projectId مثبَّت وبلا شبكة والمعيار 10 دقائق`);
    ok(Object.keys(j)[0] === 'projectId', `[٣] ${name}: projectId أوّل حقل`);
  }
  let errs = [];
  eq(await audit.main(['--apply'], {err: (s) => errs.push(s)}), 1, '[٣] سكربت القراءة لا يقبل --apply');
  ok(errs.some((e) => /USAGE/.test(e)), '[٣] برسالة استعمال');
  eq(await audit.main(['somefile'], {err: () => {}}), 1, '[٣] وسيط موضعي مرفوض');
  eq(await release.main(['--force'], {err: () => {}}), 1, '[٣] وسيط مجهول مرفوض في الإعادة');
  eq(await release.main(['--preflight', '--apply'], {err: () => {}}), 1, '[٣] --preflight لا يجتمع مع --apply');
  deq(release.parseArgs([]), {preflight: false, apply: false}, '[٣] بلا وسائط = جافّ');
  deq(release.parseArgs(['--apply']), {preflight: false, apply: true}, '[٣] --apply وحده يكتب');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — المصدر الواحد: لا نسخة من releaseScanCredit، ولا كتابة في سكربت القراءة، والجافّ مغلَّف
  // ═══════════════════════════════════════════════════════════════════
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');
  const read = (...p) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
  const libSrc = read('scripts', 'lib', 'stuckReservations.js');
  const auditSrc = read('scripts', 'audit-stuck-scan-reservations-readonly.js');
  const releaseSrc = read('scripts', 'release-stuck-scan-reservations.js');
  ok(/const \{releaseScanCredit\} = require\('\.\.\/\.\.\/src\/analysis\/scanReservation'\)/.test(libSrc), '[٤] الإعادة تستورد releaseScanCredit من src/analysis/scanReservation (الدالّة نفسها)');
  ok(!/increment\(|arrayRemove\(|arrayUnion\(/.test(libSrc + releaseSrc + auditSrc), '[٤] لا نسخة من منطق الإعادة (increment/arrayRemove) في أيّ من السكربتين أو المكتبة');
  ok(!/\.(set|update|delete|add|create)\(|\.batch\(|runTransaction\(|bulkWriter\(/.test(auditSrc), '[٤] سكربت القراءة بلا أيّ استدعاء كتابة');
  ok(!/\.(set|update|delete|add|create)\(|\.batch\(|runTransaction\(|bulkWriter\(/.test(libSrc.replace(/releaseScanCredit\(\{db, FieldValue, claimRef\}\)/, '')),
      '[٤] والمكتبة لا تكتب بنفسها: الكتابة الوحيدة داخل releaseScanCredit');
  ok(/wrapReadOnly\(db\)/.test(auditSrc), '[٤] سكربت القراءة يغلّف db بـwrapReadOnly');
  ok(/args\.apply \? db : wrapReadOnly\(db\)/.test(releaseSrc), '[٤] الإعادة: الجافّ على db مغلَّف، ومع --apply وحده db الحقيقي');
  ok(/projectId: PROJECT_ID/.test(auditSrc) && /projectId: PROJECT_ID/.test(releaseSrc) && !/initializeApp\(\)/.test(auditSrc + releaseSrc), '[٤] projectId مثبَّت في كليهما');
  ok(/hashIdForLog/.test(libSrc) && !/hashId\(/.test(libSrc), '[٤] التهشير بالدالّة المُصدَّرة في سياسة السجلّات لا بنسخة');
  ok(!/console\.log/.test(libSrc), '[٤] المكتبة لا تطبع');

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — المصدر نفسه الذي يستعمله analyzeDevice: الدالّة موجودة ومُصدَّرة بالاسم نفسه
  // ═══════════════════════════════════════════════════════════════════
  const scanReservation = require('../src/analysis/scanReservation');
  eq(typeof scanReservation.releaseScanCredit, 'function', '[٥] releaseScanCredit مُصدَّرة من scanReservation.js');
  ok(/releaseScanCredit\(\{db, FieldValue: admin\.firestore\.FieldValue, claimRef\}\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', 'analyzeDevice.js'), 'utf8')),
      '[٥] وهي بالتوقيع نفسه الذي تستدعيه analyzeDevice عند الفشل');

  console.log(`\nstuckReservations.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});

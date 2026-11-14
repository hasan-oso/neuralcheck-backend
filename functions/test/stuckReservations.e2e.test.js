// E2E test: جرد الحجوزات العالقة وإعادتها على محاكي Firestore (V8 قبل أوّل نشر، 2026-10-09 +03). الشيفرة الحقيقية كلّها
// (scripts/lib/stuckReservations.js، السكربتان، وsrc/analysis/scanReservation.js:releaseScanCredit) على قاعدة بيانات المحاكي؛
// **لا يُستبدَل منها شيء** (القاعدة 37). يرفض الملفّ العمل إن لم يكن FIRESTORE_EMULATOR_HOST محلّياً (projectId مثبَّت في السكربتين = الإنتاج).
//
// قرار المستخدم، بنصّه: «الحجوزات العالقة: سكربت قراءة يعدّ الحجوزات الأقدم من 10 دقائق بلا تقرير، وسكربت إعادة منفصل يستدعي
// releaseScanCredit نفسها، جافّ افتراضياً و--apply بيدي. ولا منظّف مجدوَل الآن. معتمد.» والمطلوب: «عالق يُعدّ ويُعاد مرّة واحدة؛ وحديث لا يُعدّ؛
// وما له تقرير لا يُعدّ؛ والجافّ لا يكتب؛ والتكرار لا يُعيد مرّتين.»
//
// المشهد (أعمار نسبية للآن الفعلي، لأن سطر الأوامر يقرأ Date.now()):
//   s1 s2   عالقان لمستخدم واحد (30 و12 دقيقة)            s3  عالق بفحص مجاني (جهاز devF يُزال من القائمة)
//   i1      عالق بالمعيار لكنّ القفل حديث (إعادة طلب تتبنّاه) ⇒ يُتخطّى في الإعادة
//   r1      حجز حديث (دقيقتان) ⇒ لا يُعدّ              h1  حجز قديم وله تقرير ⇒ لا يُعدّ ولا يُعاد
//   n1      بلا حجز (null) ⇒ لا يُعدّ                    m1  حجز مشوَّه (بلا reservedAtMs) ⇒ يُعدّ مشوَّهاً ولا يُعاد
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/stuckReservations.e2e.test.js"

require('./lib/emulatorOnlyGuard'); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const HOST = process.env.FIRESTORE_EMULATOR_HOST; // مضمون محلّي بالحارس أعلاه (السكربتان مثبَّتان على مشروع الإنتاج، فلا حماية إلا هذا)

const admin = require('firebase-admin');
const {FieldValue, Timestamp} = require('firebase-admin/firestore');
const L = require('../scripts/lib/stuckReservations');
const {wrapReadOnly, PROJECT_ID} = require('../scripts/audit-device-profiles-readonly');
const {hashIdForLog} = require('../src/utils/logRedaction');

const app = admin.initializeApp({projectId: PROJECT_ID}, 'e2e-stuck-reservations');
const db = app.firestore();

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const MIN = 60 * 1000;
const SCRIPTS = path.join(__dirname, '..', 'scripts');
const AUDIT = path.join(SCRIPTS, 'audit-stuck-scan-reservations-readonly.js');
const RELEASE = path.join(SCRIPTS, 'release-stuck-scan-reservations.js');

async function reset() {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {method: 'DELETE'});
  assert.ok(res.ok, 'تعذّر تفريغ المحاكي');
}

async function dump() {
  const out = {};
  for (const col of ['scanClaims', 'users', 'reports']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) out[`${col}/${d.id}`] = {data: JSON.stringify(d.data()), updateTime: d.updateTime.toMillis()};
  }
  return out;
}
const same = (a, b) => Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((k) => b[k] && a[k].data === b[k].data && a[k].updateTime === b[k].updateTime);

const U_ALPHA = 'user-alpha-9d3f';
const U_FREE = 'user-free-77aa';
const U_IFL = 'user-inflight-31c2';
const U_BETA = 'user-beta-0e5b';
const SCANS = {s1: 'scan-stuck-one-a1', s2: 'scan-stuck-two-b2', s3: 'scan-stuck-free-c3', i1: 'scan-inflight-d4', r1: 'scan-recent-e5',
  h1: 'scan-hasreport-f6', n1: 'scan-noreserv-g7', m1: 'scan-malformed-h8'};

async function seed() {
  await reset();
  const now = Date.now();
  const reservation = (userId, ageMin, extra = {}) => ({userId, isFreeTrial: false, deviceFP: null, reservedAtMs: now - ageMin * MIN, ...extra});
  const claim = (scanId, userId, reservationValue, claimedAgeMin) => db.collection('scanClaims').doc(scanId).set({
    scanId, userId, claimedAtMs: now - claimedAgeMin * MIN, claimedAt: Timestamp.fromMillis(now - claimedAgeMin * MIN), reservation: reservationValue,
  });
  // أرصدة بعد الحجز (الخصم وقع عند الحجز)
  await db.collection('users').doc(U_ALPHA).set({scansRemaining: 3, scansTotal: 10, plan: 'single'});
  await db.collection('users').doc(U_FREE).set({scansRemaining: 0, plan: 'free', freeTrialUsedDevices: ['devF', 'devKeep']});
  await db.collection('users').doc(U_IFL).set({scansRemaining: 7, plan: 'single'});
  await db.collection('users').doc(U_BETA).set({scansRemaining: 5, plan: 'single'});
  await claim(SCANS.s1, U_ALPHA, reservation(U_ALPHA, 30), 30);
  await claim(SCANS.s2, U_ALPHA, reservation(U_ALPHA, 12), 12);
  await claim(SCANS.s3, U_FREE, reservation(U_FREE, 45, {isFreeTrial: true, deviceFP: 'devF'}), 45);
  await claim(SCANS.i1, U_IFL, reservation(U_IFL, 30), 1);
  await claim(SCANS.r1, U_BETA, reservation(U_BETA, 2), 2);
  await claim(SCANS.h1, U_BETA, reservation(U_BETA, 60), 60);
  await db.collection('reports').doc(SCANS.h1).set({userId: U_BETA, pipeline: 'v7_findings_based'});
  await claim(SCANS.n1, U_BETA, null, 40);
  await claim(SCANS.m1, U_BETA, {userId: U_BETA}, 40);
}

const cli = (script, args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  env: {...process.env, ...env}, encoding: 'utf8', cwd: path.join(__dirname, '..'),
});

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — الجرد (قراءة بحتة): العالق يُعدّ، وغيره لا
  // ═══════════════════════════════════════════════════════════════════
  await seed();
  const before = await dump();
  const nowMs = Date.now();
  const collected = await L.collectClaims({db: wrapReadOnly(db), nowMs, pageSize: 3}); // صفحات صغيرة: يختبر الترقيم
  const sum = L.summarizeCollected(collected);
  ok(same(before, await dump()), '[١] الجرد لا يغيّر في المحاكي شيئاً (محتوى وupdateTime)');
  eq(sum.totalClaims, 8, '[١] ثمانية أقفال');
  eq(sum.byState.STUCK, 4, '[١] العالق بالمعيار: s1 وs2 وs3 وi1');
  eq(sum.byState.RECENT, 1, '[١] الحديث (r1) لا يُعدّ عالقاً');
  eq(sum.byState.HAS_REPORT, 1, '[١] ما له تقرير (h1) لا يُعدّ عالقاً');
  eq(sum.byState.NO_RESERVATION, 1, '[١] بلا حجز (n1) لا يُعدّ');
  eq(sum.byState.MALFORMED, 1, '[١] المشوَّه (m1) يُعدّ مشوَّهاً لا عالقاً');
  eq(sum.stuckCount, 4, '[١] stuckCount=4');
  eq(sum.stuckFreeTrial, 1, '[١] واحد منها فحص مجاني');
  const printed = JSON.stringify(sum);
  ok(![...Object.values(SCANS), U_ALPHA, U_FREE, U_IFL, U_BETA].some((id) => printed.includes(id)), '[١] لا scanId ولا معرّف مستخدم خامّ في المخرَج');
  ok(sum.stuckListedHashed.some((s) => s.scanId === hashIdForLog(SCANS.s1) && s.userId === hashIdForLog(U_ALPHA)), '[١] المعرّفات مهشَّرة بـhashIdForLog');
  eq(sum.stuckByUserHashed[hashIdForLog(U_ALPHA)], 2, '[١] مستخدم واحد يحمل حجزين عالقين');
  // الجرد عبر سطر الأوامر الحقيقي
  let r = cli(AUDIT, []);
  eq(r.status, 0, '[١] سكربت القراءة (سطر الأوامر): رمز الخروج 0');
  const cliAudit = JSON.parse(r.stdout);
  eq(Object.keys(cliAudit)[0], 'projectId', '[١] projectId أوّل حقل');
  eq(cliAudit.projectId, PROJECT_ID, '[١] projectId مثبَّت');
  eq(cliAudit.target, `EMULATOR ${HOST}`, '[١] الهدف مطبوع');
  eq(cliAudit.stuckCount, 4, '[١] العدّ نفسه عبر سطر الأوامر');
  ok(![...Object.values(SCANS), U_ALPHA, U_FREE, U_IFL, U_BETA].some((id) => r.stdout.includes(id)), '[١] مخرَج سطر الأوامر بلا معرّف خامّ');
  ok(same(before, await dump()), '[١] وسطر الأوامر لم يكتب شيئاً');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — الجافّ لا يكتب
  // ═══════════════════════════════════════════════════════════════════
  const dry = await L.releaseStuck({db: wrapReadOnly(db), FieldValue, apply: false, now: Date.now});
  eq(dry.wouldRelease, 4, '[٢] الجافّ يعدّ ما سيُعاد (4)');
  eq(Object.values(dry.results).reduce((a, b) => a + b, 0), 0, '[٢] ولا نتيجة إعادة واحدة');
  ok(same(before, await dump()), '[٢] الجافّ (المكتبة) لم يغيّر شيئاً');
  r = cli(RELEASE, []);
  eq(r.status, 0, '[٢] الإعادة بلا وسائط (سطر الأوامر) = جافّ: رمز الخروج 0');
  const cliDry = JSON.parse(r.stdout);
  eq(cliDry.mode, 'dry-run', '[٢] الوضع dry-run');
  eq(cliDry.wouldRelease, 4, '[٢] وwouldRelease=4');
  ok(same(before, await dump()), '[٢] والجافّ (سطر الأوامر) لم يغيّر شيئاً');
  // الغلاف يرفض أيّ كتابة لو حاولها الجافّ
  let trap = null;
  try {
    await wrapReadOnly(db).collection('users').doc(U_ALPHA).update({scansRemaining: 999});
  } catch (e) { trap = e; }
  ok(trap && /TRAP/.test(trap.message), '[٢] db الجافّ مغلَّف: الكتابة عليه ترمي TRAP');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — --apply: يُعاد العالق مرّة واحدة بـreleaseScanCredit، وغيره لا يُمسّ
  // ═══════════════════════════════════════════════════════════════════
  const preApply = await dump();
  const applied = await L.releaseStuck({db, FieldValue, apply: true, now: Date.now});
  eq(applied.results.RELEASED, 3, '[٣] أُعيدت ثلاثة: s1 وs2 وs3');
  eq(applied.results.SKIPPED_RETRY_IN_FLIGHT, 1, '[٣] i1 تُخطّي: القفل حديث (إعادة طلب تتبنّاه)');
  eq(applied.results.FAILED + applied.results.SKIPPED_HAS_REPORT_NOW + applied.results.ALREADY_RELEASED, 0, '[٣] لا فشل ولا غيره');
  const u = async (id) => (await db.collection('users').doc(id).get()).data();
  eq((await u(U_ALPHA)).scansRemaining, 5, '[٣] المستخدم ألفا: 3 ← 5 (فحصتان أُعيدتا، مرّة لكل حجز)');
  const free = await u(U_FREE);
  eq(free.scansRemaining, 1, '[٣] صاحب الفحص المجاني: 0 ← 1');
  ok(!free.freeTrialUsedDevices.includes('devF') && free.freeTrialUsedDevices.includes('devKeep'), '[٣] الجهاز المحجوز أُزيل من قائمة الفحص المجاني وغيره بقي');
  eq((await u(U_IFL)).scansRemaining, 7, '[٣] صاحب الحجز i1 لم يُمسّ (7)');
  const claimData = async (id) => (await db.collection('scanClaims').doc(id).get()).data();
  for (const id of [SCANS.s1, SCANS.s2, SCANS.s3]) eq((await claimData(id)).reservation, null, `[٣] حجز ${id.slice(0, 11)}… مُحي من القفل`);
  const post = await dump();
  for (const id of [SCANS.i1, SCANS.r1, SCANS.h1, SCANS.n1, SCANS.m1]) {
    ok(post[`scanClaims/${id}`] && post[`scanClaims/${id}`].updateTime === preApply[`scanClaims/${id}`].updateTime, `[٣] قفل ${id.slice(0, 11)}… لم يُمسّ (updateTime نفسه)`);
  }
  for (const id of [U_BETA, U_IFL]) ok(post[`users/${id}`].updateTime === preApply[`users/${id}`].updateTime, '[٣] مستخدمو غير العالق لم يُمسّوا');
  ok(post[`reports/${SCANS.h1}`].updateTime === preApply[`reports/${SCANS.h1}`].updateTime, '[٣] التقرير لم يُمسّ');
  eq(applied.before.stuckCount, 4, '[٣] «قبل»: 4 عالقة');
  eq(applied.after.stuckCount, 1, '[٣] «بعد»: 1 (i1: يبقى عالقاً بالمعيار لأنّ حجزه لم يُعَد؛ الجرد يُظهره)');
  ok(!JSON.stringify(applied).includes(SCANS.s1) && !JSON.stringify(applied).includes(U_ALPHA), '[٣] ناتج الإعادة بلا معرّف خامّ');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — التكرار لا يُعيد مرّتين
  // ═══════════════════════════════════════════════════════════════════
  const preRerun = await dump();
  const again = await L.releaseStuck({db, FieldValue, apply: true, now: Date.now});
  eq(again.results.RELEASED, 0, '[٤] التكرار: لا إعادة');
  eq(again.before.stuckCount, 1, '[٤] لا يرى إلا i1');
  eq(again.results.SKIPPED_RETRY_IN_FLIGHT, 1, '[٤] ويتخطّاها كما سبق');
  ok(same(preRerun, await dump()), '[٤] المحاكي كما هو بعد التكرار (لا مستند تغيّر) — فلا أثر مضاعف');
  eq((await u(U_ALPHA)).scansRemaining, 5, '[٤] ألفا ما زال 5 لا 7');
  // وإعادة استدعاء releaseScanCredit نفسها على قفل بلا حجز: لا شيء
  const {releaseScanCredit} = require('../src/analysis/scanReservation');
  const direct = await releaseScanCredit({db, FieldValue, claimRef: db.collection('scanClaims').doc(SCANS.s1)});
  eq(direct.released, false, '[٤] releaseScanCredit مباشرة على قفل أُعيد حجزه: released=false');

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — إعادة فحص المعيار قبل كل إعادة (على الحالة الحيّة)
  // ═══════════════════════════════════════════════════════════════════
  await seed();
  const re = (scanId) => L.recheckBeforeRelease({db, scanId, nowMs: Date.now()});
  eq((await re(SCANS.s1)).result, null, '[٥] عالق حقيقي: إعادة الفحص تُجيز الإعادة (null)');
  await db.collection('reports').doc(SCANS.s1).set({userId: U_ALPHA}); // ظهر تقرير بعد الجرد
  eq((await re(SCANS.s1)).result, 'SKIPPED_HAS_REPORT_NOW', '[٥] ظهر تقرير بعد الجرد ⇒ SKIPPED_HAS_REPORT_NOW');
  await db.collection('scanClaims').doc(SCANS.s2).update({reservation: null});
  eq((await re(SCANS.s2)).result, 'SKIPPED_NOT_STUCK_NOW', '[٥] أُعيد الحجز بين الجرد والإعادة ⇒ SKIPPED_NOT_STUCK_NOW');
  await db.collection('scanClaims').doc(SCANS.s3).update({'reservation.reservedAtMs': Date.now() - MIN});
  eq((await re(SCANS.s3)).result, 'SKIPPED_NOT_STUCK_NOW', '[٥] صار الحجز حديثاً ⇒ SKIPPED_NOT_STUCK_NOW');
  eq((await re(SCANS.i1)).result, 'SKIPPED_RETRY_IN_FLIGHT', '[٥] القفل حديث ⇒ SKIPPED_RETRY_IN_FLIGHT');
  await db.collection('scanClaims').doc(SCANS.s2).delete();
  eq((await re(SCANS.s2)).result, 'SKIPPED_CLAIM_GONE', '[٥] مُحي القفل ⇒ SKIPPED_CLAIM_GONE');
  // دمج حقيقي داخل releaseStuck: يظهر تقرير للمعرّف بعد الجرد وقبل إعادة الفحص (القراءة الثانية لـreports/{id})
  await seed();
  let reportReads = 0;
  const racingDb = new Proxy(db, {
    get(target, prop) {
      if (prop === 'collection') {
        return (name) => {
          const col = target.collection(name);
          if (name !== 'reports') return col;
          return new Proxy(col, {
            get(ct, cp) {
              if (cp === 'doc') {
                return (id) => {
                  const ref = ct.doc(id);
                  if (id !== SCANS.s1) return ref;
                  return new Proxy(ref, {
                    get(rt, rp) {
                      if (rp === 'get') {
                        return async () => {
                          reportReads++;
                          if (reportReads === 2) await target.collection('reports').doc(SCANS.s1).set({userId: U_ALPHA}); // بين الجرد وإعادة الفحص
                          return rt.get();
                        };
                      }
                      const v = rt[rp];
                      return typeof v === 'function' ? v.bind(rt) : v;
                    },
                  });
                };
              }
              const v = ct[cp];
              return typeof v === 'function' ? v.bind(ct) : v;
            },
          });
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const raced = await L.releaseStuck({db: racingDb, FieldValue, apply: true, now: Date.now});
  eq(raced.results.SKIPPED_HAS_REPORT_NOW, 1, '[٥] تقرير ظهر بين الجرد والإعادة داخل releaseStuck نفسها: يُتخطّى (لا إعادة لفحصة مستهلَكة)');
  eq(raced.results.RELEASED, 2, '[٥] والباقيان (s2 وs3) أُعيدا');
  eq((await u(U_ALPHA)).scansRemaining, 4, '[٥] ألفا: 3 ← 4 (s2 وحده؛ s1 له تقرير فلم يُعَد)');
  eq((await claimData(SCANS.s1)).reservation.userId, U_ALPHA, '[٥] حجز s1 بقي على قفله');

  // ═══════════════════════════════════════════════════════════════════
  // ٦ — فشل إعادة واحدة لا يوقف الباقي ويُعلَن (مستند مستخدم غير موجود)
  // ═══════════════════════════════════════════════════════════════════
  await seed();
  const ghostScan = 'scan-ghost-owner-z9';
  await db.collection('scanClaims').doc(ghostScan).set({scanId: ghostScan, userId: 'ghost-user', claimedAtMs: Date.now() - 50 * MIN,
    reservation: {userId: 'ghost-user', isFreeTrial: false, deviceFP: null, reservedAtMs: Date.now() - 50 * MIN}});
  const failedRun = await L.releaseStuck({db, FieldValue, apply: true, now: Date.now});
  eq(failedRun.results.FAILED, 1, '[٦] إعادة فشلت (لا مستند للمستخدم) وعُدّت FAILED');
  eq(failedRun.results.RELEASED, 3, '[٦] والثلاث الأخرى أُعيدت');
  ok(failedRun.failedExamples[0] && failedRun.failedExamples[0].scanId === hashIdForLog(ghostScan) && typeof failedRun.failedExamples[0].code === 'string',
      '[٦] الفشل بسببه (رمز) ومعرّف مهشَّر لا خامّ');
  eq((await claimData(ghostScan)).reservation.userId, 'ghost-user', '[٦] وحجزه بقي ظاهراً في الجرد (لا يضيع)');
  eq(failedRun.after.stuckCount, 2, '[٦] «بعد»: i1 وghost');
  r = cli(RELEASE, ['--apply']);
  eq(r.status, 2, '[٦] سطر الأوامر --apply: رمز الخروج 2 حين تبقى إعادة فاشلة');
  eq(JSON.parse(r.stdout).results.FAILED, 1, '[٦] والخلاصة تعلن الفاشلة');

  // ═══════════════════════════════════════════════════════════════════
  // ٧ — سطر الأوامر: --apply الحقيقي، و--preflight بلا شبكة
  // ═══════════════════════════════════════════════════════════════════
  await seed();
  r = cli(RELEASE, ['--apply']);
  eq(r.status, 0, '[٧] --apply الحقيقي: رمز الخروج 0');
  const cliApply = JSON.parse(r.stdout);
  eq(cliApply.mode, 'apply', '[٧] الوضع apply');
  eq(cliApply.results.RELEASED, 3, '[٧] أُعيدت ثلاثة');
  eq(cliApply.before.stuckCount, 4, '[٧] قبل 4');
  eq(cliApply.after.stuckCount, 1, '[٧] بعد 1');
  eq((await u(U_ALPHA)).scansRemaining, 5, '[٧] الأرصدة كما في الحالة [٣]');
  r = cli(RELEASE, ['--bogus']);
  eq(r.status, 1, '[٧] وسيط مجهول: رمز 1');
  // --preflight بلا أيّ اتصال: بلا متغيّر المحاكي وباعتماد يشير إلى ملفّ غير موجود — لو لمس الشبكة لفشل أو علق
  const noNet = {FIRESTORE_EMULATOR_HOST: '', GOOGLE_APPLICATION_CREDENTIALS: path.join(__dirname, 'no-such-credentials.json')};
  const t0 = Date.now();
  for (const script of [AUDIT, RELEASE]) {
    r = cli(script, ['--preflight'], noNet);
    eq(r.status, 0, `[٧] ${path.basename(script)} --preflight: رمز الخروج 0 بلا شبكة ولا اعتماد`);
    const pf = JSON.parse(r.stdout);
    ok(pf.ok === true && pf.network === false && pf.projectId === PROJECT_ID, '[٧] المخرَج: ok وبلا شبكة وprojectId مثبَّت');
    ok(!/target=/.test(r.stderr), '[٧] ولم يفتح اتصالاً (لا سطر target على stderr)');
  }
  ok(Date.now() - t0 < 20000, '[٧] وانتهى سريعاً');

  await app.delete();
  console.log(`\nALL PASS (${n} assertions)`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exitCode = 1;
});

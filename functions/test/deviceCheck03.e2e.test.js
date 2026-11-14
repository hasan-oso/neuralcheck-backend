// E2E test: سكربتات قراءة فحص الجهاز ٠٣ الثلاثة على محاكي Firestore (2026-10-10 +03، القاعدتان 37 و41):
//   device-check-03-before-readonly.js · device-check-03-after-readonly.js · golden-stage2-keypaths-readonly.js
//
// أمر المنسّق (بنصّه المنقول): «وe2e على المحاكي (firebase emulators:exec --only firestore --project demo-nc) ببيانات مزروعة من عيّنات fv69 الذهبية (القاعدة 41)، وStorage بمحاكاة أو كعب محلّي إن لزم (صرّح به).»
//
// ─── البيانات: السلسلة الحقيقية لا مستندات مكتوبة باليد (القاعدة 41) ────────────────────────────────────────────────────────────────────────────────
// التقارير الخمسة تصدر من analyzeDevice الحقيقية بحمولات fv69 الذهبية الثلاث (11ch وب 13ch و16ch) وطلب fv67 (1.0.10)، فيُكتب مستند reports ومستند reportRaw بدفعتهما الذرّية الحقيقية وتُخصم الفحصة وتُمحى الأقفال؛
// وجلستا QR بـcreateScanSession وjoinScanSession الحقيقيتين؛ وتقييم S1 بـsubmitEvaluation الحقيقية قبل صدور التقرير ثم resolvePendingEvaluation الحقيقية بعده (كما يجري في الميدان). تتغيّر في الحمولة قيمة
// header.scanId وحدها (كي لا تتصادم الأمعرّفات الثلاثة المتطابقة في العيّنات الذهبية)؛ ما عدا ذلك الحمولة حرفية.
//
// ─── ما يُستبدَل (القاعدة 37، مُعلَن) ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   ١) الشبكة نحو مزوّد النموذج وحدها: كعب global.fetch (كما في analyzeDeviceFv68.e2e.test.js) — صفر طلب خارجي؛ ويُمنع أيّ اتصال بغير المضيف المحلّي طوال الاختبار (blockNonLocalNetwork).
//   ٢) Storage: bucket مزيَّف محلّي يخدم ملفّ السلسلة الزمنية لكل تقرير (gzip) — **مُشتقّ من timeSeries الحمولة الذهبية** بلا timeSeriesState (لا ملفّ Storage حقيقي مُلتزَم لـfv69). محاكي Storage لا يعمل بأمر
//      الـe2e القياسي (--only firestore). فمنطق تنزيل Storage الحقيقي (fetchSamplesFromStorage) يجري كاملاً على بايتات gzip حقيقية، والمستبدَل هو الشبكة نحو GCS وحدها.
//   ٣) Auth: getUserByEmail مزيَّف في المسار الأساسي (محاكي Auth لا يعمل بالأمر القياسي)؛ وإن وُجد FIREBASE_AUTH_EMULATOR_HOST تجري أيضاً **حالات Auth الحقيقية بالسكربتين ١ و٢ في عملية فرعية** (٢ بـ--no-storage لأن Storage
//      لا يُخدَم محلّياً)؛ وإلا تُطبَع «AUTH-EMULATOR CASES SKIPPED» صراحةً.
//   والمسار الحقيقي لتهيئة Admin SDK (initReadOnlyAdmin بـprojectId المثبَّت) يُختبر على المحاكي: يقرأ Firestore فعلاً.
//
// Run (قياسي):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc "node functions/test/deviceCheck03.e2e.test.js"
// Run (مع محاكي Auth — كل الحالات):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --config functions/test/firebase.firestore-auth.emulators.json --only firestore,auth --project demo-nc "node functions/test/deviceCheck03.e2e.test.js"

require('./lib/emulatorOnlyGuard'); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const HOST = process.env.FIRESTORE_EMULATOR_HOST; // مضمون محلّي بالحارس أعلاه
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const LOCAL = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
if (AUTH_HOST && !LOCAL.test(AUTH_HOST)) {
  console.error('REFUSING TO RUN: FIREBASE_AUTH_EMULATOR_HOST ليس مضيفاً محلّياً.');
  process.exit(2);
}
const REAL_FETCH = global.fetch; // لتفريغ المحاكي وحده (عنوانه محلّي)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'dummy';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy';
process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

// Gemini: لا يُستدعى — كعب يرمي فيفشل أيّ مرور عليه بصوت عالٍ لا بشبكة.
const geminiPath = require.resolve('@google/generative-ai');
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {generateContent: async () => { throw new Error('stub gemini: must not be called'); }};
    }
  }},
};

const admin = require('firebase-admin');
const C = require('../scripts/lib/deviceCheck03Common');
// التطبيق الافتراضي مثبَّت على مشروع الإنتاج (اسماً) بالتصميم — مضيف المحاكي محلّي (يفرضه الحارس أعلاه) فكل مستنداته في المحاكي؛ والسكربتات الثلاثة تفتح تطبيقها المسمّى بالمشروع نفسه فترى المستندات نفسها.
if (!admin.apps.length) admin.initializeApp({projectId: C.PROJECT_ID, storageBucket: C.STORAGE_BUCKET}); // الـbucket يلزم analyzeDevice (حفظ العيّنات)؛ وأيّ اتصال به بغير المضيف المحلّي يمنعه blockNonLocalNetwork أدناه فيُعاد {saved:false} (فشل الحفظ لا يُفشل التحليل)
const {db} = require('../src/utils/admin');
const {analyzeDevice} = require('../src/analysis/analyzeDevice');
const {createScanSession} = require('../src/sessions/createScanSession');
const {joinScanSession} = require('../src/sessions/joinScanSession');
const {submitEvaluation} = require('../src/evaluations/submitEvaluation');
const {resolvePendingEvaluation} = require('../src/evaluations/resolvePendingEvaluation');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const A = require('../scripts/lib/activeSessions');
const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {main: mainBefore} = require('../scripts/device-check-03-before-readonly');
const {main: mainAfter} = require('../scripts/device-check-03-after-readonly');
const {main: mainKeyPaths} = require('../scripts/golden-stage2-keypaths-readonly');
const H = require('./lib/deviceCheck03Harness');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEM = 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const FILES = {c11: `${STEM}11ch-nothing-admitted`, c13: `${STEM}13ch-selinux-blocked-policy`, c16: `${STEM}16ch-four-policies-truncated-failures`};
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
const FV67_REQUEST = 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json';
const clone = (x) => JSON.parse(JSON.stringify(x));

const SCRIPT_DIR = path.join(__dirname, '..', 'scripts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc03-e2e-'));
let counter = 0;
const nextOut = (label) => path.join(tmp, `${label}-${++counter}.json`);

const EMAIL = 'owner.s10.e2e.secret@example.test';
const OWNER = 'e2e-owner-uid-SECRET-0001';
const ANON_S1 = 'e2e-anon-joiner-S1-SECRET';
const ANON_S2 = 'e2e-anon-joiner-S2-SECRET';
const TECH = 'E2E SECRET TECH NAME';
const future = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const call = (data, auth) => analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
const fakeAuth = () => ({getUserByEmail: async (email) => {
  if (email === EMAIL) return {uid: OWNER};
  throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
}});

async function reset() {
  const res = await REAL_FETCH(`http://${HOST}/emulator/v1/projects/${C.PROJECT_ID}/databases/(default)/documents`, {method: 'DELETE'});
  assert.ok(res.ok, 'تعذّر تفريغ المحاكي');
}
/** كل المجموعات كلّها بمحتواها وupdateTime: صورة المحاكي الكاملة (قراءة بحتة تعني أن الصورتين متطابقتان). */
async function dumpAll() {
  const out = {};
  for (const col of await db.listCollections()) {
    const snap = await col.get();
    for (const d of snap.docs) out[`${col.id}/${d.id}`] = JSON.stringify([d.data(), d.updateTime.toMillis(), d.createTime.toMillis()]);
  }
  return JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1))));
}

// كعب المزوّد (الشبكة وحدها)
function installProvider() {
  const state = {calls: 0};
  global.fetch = async (url, opts) => {
    state.calls++;
    const body = JSON.parse(opts.body);
    const userMessage = body.messages.find((m) => m.role === 'user').content;
    const payload = JSON.parse(userMessage.replace(/\n\nProduce the analysis JSON now\.$/, ''));
    const ids = ((payload.categoryStates && payload.categoryStates.issues) || []).map((i) => i.id);
    const content = {
      narrative: {
        summary: 'ملخّص اختبار سليم الشكل', details: 'تفاصيل اختبار سليمة الشكل', verdict: 'حكم اختبار سليم الشكل',
        buyerAdvice: {casual: 'نصيحة اختبار للمشتري العادي', gamer: 'نصيحة اختبار للاعب', photographer: 'نصيحة اختبار للمصوّر'},
        issueDescriptions: Object.fromEntries(ids.map((id) => [id, 'وصف اختبار للعطب'])),
      },
      crossChecks: [], adjustments: [], modelObservations: [],
    };
    const envelope = {choices: [{message: {content: JSON.stringify(content)}, finish_reason: 'stop'}], usage: {prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 20}};
    return {ok: true, status: 200, json: async () => envelope, text: async () => ''};
  };
  return state;
}

// الأوسام: B1 فحص 1.0.10 أُعيد تحليله (ختم 67) · B2 الـS10 من الرئيسية · WAIT فحص فردي رابع · S1 وS2 جلستا الـS21 (بتقييم) — وفوقها X16 (جلسة بلا تقييم، 16ch) وOLD8 (عيّنة fv67 كما هي) لحالات السلب.
const SCAN = {B1: 'e2e-scan-B1-SECRET', B2: 'e2e-scan-B2-SECRET', WAIT: 'e2e-scan-WAIT-SECRET', S1: 'e2e-scan-S1-SECRET', S2: 'e2e-scan-S2-SECRET', X16: 'e2e-scan-X16-SECRET', OLD8: 'e2e-scan-OLD8-SECRET'};
const KEY = {B2: 'c11', WAIT: 'c11', S1: 'c13', S2: 'c13', X16: 'c16'};
const payloadFor = (tag) => {
  if (tag === 'OLD8') return readJson(FV67_REQUEST).fingerprint; // كما هي: header.appVersion = 1.0.8-v6beta (ملفّها الزمني أقدم من 1.0.10)
  if (tag === 'B1') {
    // فحص 1.0.10 الحقيقي يكتب header.appVersion = 1.0.10؛ عيّنة fv67 الذهبية مشتقّة من ملفّ 1.0.8-v6beta فتحمل غيره. **تعديل مُعلَن** (الرأس وحده؛ الباقي حرفياً).
    const f = readJson(FV67_REQUEST).fingerprint;
    f.timeSeries.header.appVersion = '1.0.10';
    return f;
  }
  return readJson(`${FILES[KEY[tag]]}.json`);
};
const fingerprintFor = (tag) => { const f = payloadFor(tag); f.timeSeries.header.scanId = SCAN[tag]; return f; };
const storageFileOf = (fp) => { const {timeSeriesState, ...file} = fp.timeSeries; void timeSeriesState; return file; };

(async () => {
  const netGuard = H.blockNonLocalNetwork(); // صفر اتصال بغير المضيف المحلّي طوال الاختبار
  const guardedFetch = global.fetch;
  try {
    // ═══ ١ — البيانات بالسلسلة الحقيقية ═══
    await reset();
    await db.collection('users').doc(OWNER).set({scansRemaining: 10, scansTotal: 10, plan: 'shop_pro', isActive: true, expiresAt: future(), evaluationEnabled: true});
    const provider = installProvider();
    const sessions = {};
    // فحوص فردية بحساب المالك: B1 (fv67) وB2 وWAIT وOLD8
    for (const tag of ['B1', 'B2', 'WAIT', 'OLD8']) {
      const r = await call({scanId: SCAN[tag], fingerprint: fingerprintFor(tag), language: 'ar', usePrecomputed: true}, {uid: OWNER, token: tokenOf('password')});
      eq(r.pipeline, V7_PIPELINE_TAG, `[١] ${tag}: التقرير صدر (V7)`);
    }
    // جلسات QR: إنشاء ثمّ انضمام (الجهاز المفحوص) ثمّ [S1 وS2: تقييم الفنّي قبل التقرير] ثمّ الفحص
    const ANON = {S1: ANON_S1, S2: ANON_S2, X16: 'e2e-anon-joiner-X16-SECRET'};
    for (const tag of ['S1', 'S2', 'X16']) {
      const anon = ANON[tag];
      const created = await createScanSession.run({data: {}, auth: {uid: OWNER, token: tokenOf('google.com')}, rawRequest: {headers: {}}});
      const joined = await joinScanSession.run({data: {code: created.code}, auth: {uid: anon, token: tokenOf('anonymous')}, rawRequest: {headers: {}}});
      eq(joined.sessionId, created.sessionId, `[١] ${tag}: الجهاز المفحوص انضمّ بالرمز`);
      eq(joined.evaluationEnabled, true, `[١] ${tag}: joinScanSession تُعيد evaluationEnabled=true (علم المالك)`);
      sessions[tag] = created.sessionId;
      if (tag !== 'X16') {
        const ev = await submitEvaluation.run({data: {scanId: SCAN[tag], sessionId: sessions[tag], technicianGradeRaw: 'good', categoryRatings: {battery: 'good'}, visibleDefects: ['none_noticed'], technicianName: TECH}, auth: null, rawRequest: {headers: {}}});
        eq(ev.pending, true, `[١] ${tag}: التقييم قبل صدور التقرير يُخزَّن معلَّقاً (pending)`);
      }
      const r = await call({scanId: SCAN[tag], fingerprint: fingerprintFor(tag), language: 'ar', usePrecomputed: true, sessionId: sessions[tag]}, {uid: anon, token: tokenOf('anonymous')});
      eq(r.pipeline, V7_PIPELINE_TAG, `[١] ${tag}: تقرير الجلسة صدر (V7)`);
      eq((await db.collection('scanSessions').doc(sessions[tag]).get()).data().status, 'completed', `[١] ${tag}: الجلسة completed بعد الفحص`);
    }
    // استكمال تقييمَي S1 وS2 بالمعالج الحقيقي على لقطة كل تقرير حقيقي (محاكي Firestore وحده بلا runtime للمشغّلات)
    for (const tag of ['S1', 'S2']) await resolvePendingEvaluation.run({params: {scanId: SCAN[tag]}, data: await db.collection('reports').doc(SCAN[tag]).get()});
    eq(provider.calls, 7, '[١] سبعة نداءات للكعب (واحد لكل فحص)');
    eq((await db.collection('users').doc(OWNER).get()).data().scansRemaining, 3, '[١] الرصيد 10 ← 3: خُصمت سبع فحصات');
    global.fetch = guardedFetch; // الكعب يُزال: ما بعدها بلا أيّ مزوّد

    // ما كتبته السلسلة الحقيقية
    const shortOf = {};
    const rawOf = {};
    for (const tag of Object.keys(SCAN)) {
      const rep = await db.collection('reports').doc(SCAN[tag]).get();
      ok(rep.exists, `[١] ${tag}: reports موجود`);
      shortOf[tag] = rep.data().shortId;
      rawOf[tag] = (await db.collection('reportRaw').doc(SCAN[tag]).get()).data();
      eq(rep.createTime.isEqual((await db.collection('reportRaw').doc(SCAN[tag]).get()).createTime), true, `[١] ${tag}: reports وreportRaw بدفعة واحدة (createTime واحد)`);
    }
    deq([rawOf.B1.rawFingerprint.timeSeries.footer.fieldsVersion, rawOf.B1.rawFingerprint.timeSeries.header.appVersion, rawOf.OLD8.rawFingerprint.timeSeries.header.appVersion], [67, '1.0.10', '1.0.8-v6beta'], '[١] B1 في reportRaw: ختم 67 وheader 1.0.10 (التعديل المُعلَن)، وOLD8 كما في العيّنة 1.0.8-v6beta');
    const objects = {};
    for (const tag of Object.keys(SCAN)) {
      const p = rawOf[tag].timeSeriesStoragePath;
      ok(typeof p === 'string' && p.endsWith(`${SCAN[tag]}.ts.json.gz`), `[١] ${tag}: timeSeriesStoragePath في reportRaw`);
      objects[p] = H.gz(storageFileOf(fingerprintFor(tag)));
    }
    const SECRETS = [EMAIL, 'owner.s10.e2e', OWNER, ANON_S1, ANON_S2, ANON.X16, TECH, ...Object.values(SCAN), ...Object.values(sessions), ...Object.values(shortOf), ...Object.values(rawOf).map((r) => r.timeSeriesStoragePath), readJson(`${FILES.c13}.json`).timeSeries.header.deviceFingerprint];
    ok(SECRETS.every((s) => typeof s === 'string' && s.length > 5), '[١] قائمة الأسرار المراقَبة سليمة');
    const tokens = (tags, swap = {}) => tags.map((t) => `${t}=${shortOf[swap[t] || t]}`).join(',');
    const FIVE = ['B1', 'B2', 'S1', 'S2', 'WAIT'];

    // ═══ مراقبة القرص والشبكة والمحاكي خلال كل تشغيلات السكربتات ═══
    await new Promise((r) => setTimeout(r, 400)); // لا كتابة خلفية متأخّرة من السلسلة الحقيقية قبل اللقطة
    const before = await dumpAll();
    await new Promise((r) => setTimeout(r, 400));
    eq(await dumpAll(), before, '[١] المحاكي ساكن بعد السلسلة الحقيقية (لا كتابة خلفية)');
    const fsSpy = H.spyFsWrites();
    const outFiles = [];
    const outText = [];
    const runScript = async (mainFn, argv, io = {}) => {
      const outPath = nextOut('o');
      const argvFull = argv.map((x) => (x === '@OUT' ? outPath : x));
      const r = await H.runMain(mainFn, argvFull, {env: {[C.OWNER_EMAIL_ENV]: EMAIL}, now: () => Date.now(), db, auth: fakeAuth(), ...io});
      const fileText = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
      if (fileText !== null) outFiles.push(outPath);
      outText.push(r.text, fileText || '');
      return {...r, outPath, fileText, json: fileText ? JSON.parse(fileText) : null};
    };

    // ═══ ٢ — السكربت ١ على الإنتاج المحاكى ═══
    {
      const r = await runScript(mainBefore, ['--out', '@OUT']);
      eq(r.code, 0, '[٢] السكربت ١: 0');
      const j = r.json;
      deq([j.evaluationEnabled.userDocExists, j.evaluationEnabled.present, j.evaluationEnabled.type, j.evaluationEnabled.value], [true, true, 'boolean', true], '[٢] evaluationEnabled: true بنوعه boolean');
      deq(j.evaluationEnabled.decision, {value: true, reason: 'FLAG_TRUE', valueType: null}, '[٢] وسببه المسمّى FLAG_TRUE (evaluationEnabledState)');
      const direct = (await db.collection('reports').where('userId', '==', OWNER).get()).size;
      eq(j.reports.accountReportsCount, direct, `[٢] عدد تقارير الحساب = العدّ المباشر (${direct})`);
      eq(direct, 7, '[٢] سبعة تقارير');
      // الجلسات: مقارنة بعدّ مستقلّ من الجلسات الحقيقية
      const all = await db.collection('scanSessions').get();
      const byStatus = {};
      for (const d of all.docs) byStatus[d.data().status] = (byStatus[d.data().status] || 0) + 1;
      deq(j.activeSessions.sessions.terminal, {completed: byStatus.completed || 0, expired: byStatus.expired || 0, cancelled: byStatus.cancelled || 0}, '[٢] الجلسات النهائية = العدّ المستقلّ');
      eq(byStatus.completed, 3, '[٢] ثلاث جلسات completed (S1 وS2 وX16)');
      deq([j.activeSessions.sessions.byStatus.pending.total, j.activeSessions.sessions.byStatus.scanning.total], [0, 0], '[٢] لا جلسة جارية');
      const direct2 = A.summarize(await A.collectActive({db, nowMs: Date.now()}), {claimsWindowMin: A.CLAIMS_WINDOW_MIN_DEFAULT, claimsWindowIsDefault: true});
      deq(j.activeSessions.sessions, direct2.sessions, '[٢] والعدّ = collectActive نفسها على المحاكي');
      eq(j.activeSessions.claims.total, 0, '[٢] وأقفال scanClaims صفر (مُحيت بعد الفحص)');
      eq(j.account.accountHash, C.hashIdForLog(OWNER), '[٢] حساب المالك مُهشَّراً');
      globalThis.__before = j;
    }

    // ═══ ٣ — السكربت ٢ على التقارير الحقيقية: الخمسة تطابق توقّعاتها ═══
    const bucketFor = () => H.makeStubBucket(objects);
    const failingOf = (j, tag) => j.table.filter((x) => x.tag === tag && x.verdict === 'FAIL').map((x) => x.item);
    const failAll = (j) => j.table.filter((x) => x.verdict === 'FAIL').map((x) => `${x.tag}:${x.item}`);
    {
      const stub = bucketFor();
      const r = await runScript(mainAfter, ['--tokens', tokens(FIVE), '--out', '@OUT'], {bucket: stub.bucket});
      eq(r.code, 0, `[٣] السكربت ٢ على الوسوم الخمسة (B1 B2 S1 S2 WAIT) المطابقة لتوقّعاتها: 0 — FAIL: ${r.json ? failAll(r.json).join(',') : '?'}`);
      deq(stub.writeAttempts, [], '[٣] لا كتابة Storage');
      const j = r.json;
      deq(failAll(j), [], '[٣] ولا FAIL في الجدول الواحد');
      if (process.env.DC03_PRINT_TABLE) for (const x of j.table) console.log(`TABLE|${x.tag}|${x.item}|${x.verdict}`);
      const rowOf = (tag, item) => j.table.find((x) => x.tag === tag && x.item === item);
      const verdict = (tag, item) => (rowOf(tag, item) || {}).verdict;
      eq(j.owner.accountReportsCount, globalThis.__before.reports.accountReportsCount, '[٣] عدد تقارير المالك = عدد السكربت ١ (سبعة)');
      ok(j.table.every((x) => ['PASS', 'FAIL', 'NOT_MEASURED', 'INFO'].includes(x.verdict) && x.basis.length > 0), '[٣] كل صفّ بحكم من الأربعة وأساس');
      deq(j.expectations.thisRun.map((x) => [x.tag, x.special]), FIVE.map((t) => [t, true]), '[٣] المخرَج: الوسوم الخمسة ذات توقّعات خاصّة، وجدولها في expectations');
      for (const id of ['EXPECT_B1_LEGACY_FV67_SCAN', 'EXPECT_M02_AUTO_COMPLETE_FULL_GRID', 'EXPECT_M02_NOT_WORKING_PARTIAL_GRID', 'EXPECT_CYCLE_EXTRA_API34_POSITIVE']) ok(typeof j.rules[id] === 'string' && j.rules[id].includes('DEVICE-CHECK-03-2026-10-10.md:'), `[٣] rules تحمل نصّ ${id} وسطر وثيقته`);
      // B1: فحص 1.0.10 (ختم 67) أُعيد تحليله — لا FAIL، وبنود fv68+ NOT_MEASURED بسببها
      deq(['REPORT_FOUND', 'REPORT_OWNED_BY_OWNER_ACCOUNT', 'RAW_STATE', 'APP_VERSION', 'FIELDS_VERSION', 'EXPECT_B1_LEGACY_FV67_SCAN', 'READER_ANOMALIES'].map((i) => verdict('B1', i)), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS'], '[٣] B1: التقرير ومالكه وPRIVATE و1.0.10 وختم 67 والتوقّع وبلا شذوذ (السلسلة الحقيقية)');
      const b1 = j.table.filter((x) => x.tag === 'B1');
      eq(b1.some((x) => x.verdict === 'FAIL'), false, '[٣] B1 من عيّنة fv67: لا FAIL في الجدول');
      const legacyRows = b1.filter((x) => x.basis.startsWith('LEGACY_FV67_SCAN: '));
      deq(legacyRows.map((x) => x.item).sort(), j.expectations.legacyByNature.items.map((x) => x.item).sort(), '[٣] وبنود fv68+ كلّها NOT_MEASURED:LEGACY_FV67_SCAN (الخمسة عشر)');
      ok(legacyRows.every((x) => x.verdict === 'NOT_MEASURED'), '[٣] بحكم NOT_MEASURED لا FAIL');
      deq(['MANUAL_STATUS_VOCAB', 'M02_MANUAL_STATUS', 'GPU_FPS_TAIL', 'SAMPLING_TIME', 'STORAGE_COPY'].map((i) => verdict('B1', i)), ['PASS', 'INFO', 'INFO', 'INFO', 'INFO'], '[٣] وما تحمله حمولة fv67 يُقاس: اليدوي وحالة M-02 وذيل gpu_fps وزمن العيّنة وStorage');
      // B2: الـS10 من الرئيسية
      deq(['APP_VERSION', 'FIELDS_VERSION', 'EXPECT_M02_AUTO_COMPLETE_FULL_GRID', 'EXPECT_MANUAL_UNAVAILABLE_HARDWARE_ABSENT', 'EXPECT_HIDDEN_BY_MODEL_EMPTY', 'EXPECT_SN04_COVER_NO_THRESHOLD', 'EXPECT_CYCLE_NOT_READ_DECLARED', 'CPU_D_SHARE'].map((i) => verdict('B2', i)), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'INFO', 'PASS', 'PASS'], '[٣] B2: 1.0.11 وختم 69 وM-02 وunavailable وhiddenByModel [] وSN-04 INFO والدورات غير مقروءة بحالة معلنة وD');
      // S1 وS2: الجلسة والتقييم الحقيقيان
      for (const tag of ['S1', 'S2']) {
        deq(['APP_VERSION', 'FIELDS_VERSION', 'SESSION_STATUS', 'SESSION_JOINED_BY', 'SESSION_SCAN_LINK', 'EVALUATION_DOC', 'EVALUATION_NO_MOVED_IDS', 'EXPECT_CYCLE_EXTRA_API34_POSITIVE'].map((i) => verdict(tag, i)), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS'], `[٣] ${tag}: الإصدار والختم وcompleted وjoinedBy والربط والتقييم المرتبط بلا معرّفات منقولة والدورات extra_api34`);
      }
      eq(verdict('S1', 'EXPECT_M02_NOT_WORKING_PARTIAL_GRID'), 'PASS', '[٣] S1: M-02 user_marked_not_working وfail وtouchedCells < totalCells');
      ok(!j.table.some((x) => x.tag === 'S2' && x.item.startsWith('EXPECT_M02')), '[٣] S2: لا صفّ M-02 خاصّ (بلا توقّع)');
      // WAIT: فردي
      deq(['APP_VERSION', 'FIELDS_VERSION', 'SESSION_SCAN'].map((i) => verdict('WAIT', i)), ['PASS', 'PASS', 'INFO'], '[٣] WAIT: 1.0.11 وختم 69، وفحص فردي (SESSION_SCAN INFO)');
      ok(!j.table.some((x) => x.tag === 'WAIT' && x.item.startsWith('EXPECT_')), '[٣] WAIT: بلا صفوف EXPECT');
      // الأرقام من الحمولات الذهبية نفسها (مستقلّ عن السكربت)
      const m02 = (tag) => payloadFor(tag).manualResults.find((m) => m.testId === 'M-02');
      const rep = (tag) => j.reports.find((x) => x.tag === tag);
      deq([rep('B2').m02.endReason, rep('S1').m02.endReason, rep('S2').m02.endReason], [m02('B2').measurements.endReason, m02('S1').measurements.endReason, m02('S2').measurements.endReason], '[٣] endReason لكل تقرير = ما أرسله التطبيق (من reportRaw الحقيقي)');
      deq([rep('B2').m02.manualStatus, rep('S1').m02.manualStatus, rep('S1').m02.touchedCells, rep('S1').m02.totalCells], ['pass', 'fail', 87, 120], '[٣] الحالة اليدوية لـM-02: B2 pass، وS1 fail بـ87/120');
      deq([rep('B2').manual.hiddenByModel, rep('B2').cycleCount.state.startsWith('not_read:'), rep('S1').cycleCount.value, rep('S1').cycleCount.sourceIsExtraApi34], [{state: 'PRESENT', list: []}, true, 187, true], '[٣] B2: hiddenByModel [] والدورات not_read:…؛ S1: الدورات 187 من extra_api34');
      const dPhase3 = rep('B2').cpuD.phases.find((p) => p.phase === '3');
      deq([dPhase3.totalMs, dPhase3.phaseDurationMs, dPhase3.verdict], [360, 74978, 'PASS'], '[٣] B2: D المرحلة 3: 360ms من 74978ms (0.48٪) من العيّنات المفكوكة من gzip');
      deq([rep('S1').session.joinedByPresent, rep('S1').session.joinedByHash, rep('S2').session.joinedByHash], [true, C.hashIdForLog(ANON_S1), C.hashIdForLog(ANON_S2)], '[٣] joinedBy حاضر ومُهشَّر لكل جلسة');
      ok(/^\d{4}-\d\d-\d\dT[\d:.]+\+03:00$/.test(rep('S1').session.joinedAtPlus03), '[٣] joinedAt من Timestamp المحاكي بتوقيت +03');
      for (const tag of ['S1', 'S2']) {
        const ev = rep(tag).evaluation;
        deq([ev.exists, ev.pending, ev.linkageIncomplete, ev.ownerMismatch, ev.linkageRawState, ev.source, ev.movedKeysFound], [true, false, false, false, 'PRIVATE', 'session', []], `[٣] ${tag}: التقييم الحقيقي مستكمل مرتبط (الربط PRIVATE، بلا مفاتيح منقولة)`);
        const evDoc = (await db.collection('evaluations').doc(SCAN[tag]).get()).data();
        for (const k of ['timeSeriesStoragePath', 'deviceFingerprintSha', 'sessionId', 'rawFingerprint', 'aiAudit']) ok(!(k in evDoc), `[٣] (تحقّق مستقلّ) مستند evaluations الحقيقي لـ${tag} بلا ${k}`);
      }
      // تفصيل D لكل تشغيل (طلب المنسّق 2026-10-11): من cpuKnownAnswerRuns[] في reportRaw الحقيقي، صفوف INFO وحدها، والأرقام بحلقة مستقلّة من الحمولة الذهبية
      for (const tag of ['B2', 'WAIT', 'S1', 'S2']) {
        const rows = j.table.filter((x) => x.tag === tag);
        const runRows = rows.filter((x) => x.item.startsWith('CPU_D_RUN_'));
        const brkRows = rows.filter((x) => x.item.startsWith('CPU_D_BREAKDOWN_'));
        deq([verdict(tag, 'CPU_D_RUNS'), runRows.length, brkRows.length, [...runRows, ...brkRows].every((x) => x.verdict === 'INFO')], ['INFO', 6, 2, true], `[٣] ${tag}: تفصيل D: ملخّص INFO وستّة صفوف تشغيل وصفّان للمرحلتين، كلّها INFO (لا حكم)`);
        const runs = payloadFor(tag).timeSeries.footer.verificationResults.cpuKnownAnswerRuns;
        for (const ph of [3, 5]) {
          let d = 0; let s = 0; let h = 0; let c = 0;
          for (const e of runs) if (e.phase === ph) { d += e.tEnd - e.t; s += e.sieveDurationMs; h += e.sha256DurationMs; c++; }
          const b = rep(tag).cpuD.runDetail.byPhase[ph];
          deq([b.diff.sumMs, b.sieve.sumMs, b.sha256.sumMs, b.remainder.sumMs, b.runs, b.diffSumVsShipped], [d, s, h, d - s - h, c, 'EQUAL'], `[٣] ${tag}: المرحلة ${ph}: مجاميع التفصيل = حلقة مستقلّة من الحمولة الذهبية، وتساوي المجموع المشحون`);
        }
        eq(rowOf(tag, 'CPU_D_RUN_3_1').basis, 'index=0 phase=3 order=1 plannedAtPct=25 t=184695 tEnd=184815 diffMs=120 sieveStatus=match sievePrimeCount=664579 sieveDurationMs=90 sha256Status=match sha256DurationMs=30 remainderMs=0', `[٣] ${tag}: صفّ التشغيل الأوّل بقيمه كما شُحنت (من reportRaw الحقيقي)`);
      }
      // B1 (fv67): D لا تحمله الحمولة بطبيعتها ⟵ NOT_MEASURED:LEGACY_FV67_SCAN، ولا صفوف تشغيل
      deq([verdict('B1', 'CPU_D_RUNS'), rowOf('B1', 'CPU_D_RUNS').basis.startsWith('LEGACY_FV67_SCAN: '), j.table.some((x) => x.tag === 'B1' && (x.item.startsWith('CPU_D_RUN_') || x.item.startsWith('CPU_D_BREAKDOWN_')))], ['NOT_MEASURED', true, false], '[٣] B1 (ختم 67): CPU_D_RUNS NOT_MEASURED:LEGACY_FV67_SCAN وبلا صفوف تشغيل');
      // قيم الحالات والنصوص الإضافية (INFO): من reportRaw الحقيقي ومن ملفّ Storage، بقراءة مستقلّة من الحمولة الذهبية
      for (const tag of ['B2', 'WAIT', 'S1', 'S2']) {
        const ft = payloadFor(tag).timeSeries.footer;
        deq(['ENERGY_COUNTER_NWH', 'CPU_TEMP_FINAL_SOURCE', 'WORKERS_PIN_STATE', 'MEMORY_VERIFY_STATE', 'TIME_TO_FIRST_FIX_STATE'].map((i) => verdict(tag, i)), ['INFO', 'INFO', 'INFO', 'INFO', 'INFO'], `[٣] ${tag}: صفوف القيم الإضافية الخمسة INFO`);
        eq(rowOf(tag, 'CPU_TEMP_FINAL_SOURCE').basis, `cpuTempFinalSource=${ft.cpuTempFinalSource}`, `[٣] ${tag}: cpuTempFinalSource كما في الحمولة الذهبية`);
        eq(rowOf(tag, 'WORKERS_PIN_STATE').basis, `workersPinState=${ft.verificationResults.workersPinState}`, `[٣] ${tag}: workersPinState كما في الحمولة`);
        eq(rowOf(tag, 'MEMORY_VERIFY_STATE').basis, `memoryVerifyState=${ft.verificationResults.memoryVerifyState}`, `[٣] ${tag}: memoryVerifyState كما في الحمولة`);
        eq(rowOf(tag, 'ENERGY_COUNTER_NWH').basis, `request.energyCounterNwh=ABSENT request.energyCounterNwhState=${ft.batteryHealth.energyCounterNwhState} file.energyCounterNwh=ABSENT comparison=ABSENT_BOTH`, `[٣] ${tag}: الطاقة: الطلب والملفّ بلا رقم`);
        eq(rowOf(tag, 'TIME_TO_FIRST_FIX_STATE').basis, 'L-02 timeToFirstFixState=ABSENT', `[٣] ${tag}: timeToFirstFixState غائبة في العيّنة الذهبية ⟵ ABSENT`);
      }
      deq(['ENERGY_COUNTER_NWH', 'CPU_TEMP_FINAL_SOURCE', 'WORKERS_PIN_STATE', 'MEMORY_VERIFY_STATE', 'TIME_TO_FIRST_FIX_STATE'].map((i) => verdict('B1', i)), ['INFO', 'INFO', 'INFO', 'INFO', 'INFO'], '[٣] B1 (fv67): الخمسة INFO بحالات الغياب (لا استبدال LEGACY: قيم مقروءة لا بنود حمولة)');
      eq(rowOf('B1', 'ENERGY_COUNTER_NWH').basis.startsWith('request.energyCounterNwh=ABSENT request.energyCounterNwhState=ABSENT file.energyCounterNwh=ABSENT'), true, '[٣] B1: طاقة العدّاد وحالتها غائبتان في حمولة fv67');
      eq(j.summary.hasFail, false, '[٣] لا FAIL');
      globalThis.__after = j;
    }
    // حالة سلبية لكل وسم ⟵ 1 (القيمة الحقيقية الخاطئة تحت الوسم)
    {
      const neg = async (label, tag, swapTo, runTags, must) => {
        const r = await runScript(mainAfter, ['--tokens', tokens(runTags, {[tag]: swapTo}), '--out', '@OUT'], {bucket: bucketFor().bucket});
        eq(r.code, 1, `[٣] ${label}: حالة سلبية ⟵ 1`);
        const fl = failingOf(r.json, tag);
        ok(must.every((m) => fl.includes(m)), `[٣] ${label}: FAIL في ${must.join(' و')} — الفعلي: ${fl.join(',')}`);
        return r;
      };
      await neg('B1 بتقرير fv69 (B2)', 'B1', 'B2', ['B1'], ['APP_VERSION', 'FIELDS_VERSION', 'EXPECT_B1_LEGACY_FV67_SCAN']);
      const asIs = await neg('B1 بعيّنة fv67 كما هي (OLD8: header 1.0.8-v6beta)', 'B1', 'OLD8', ['B1'], ['APP_VERSION']);
      deq(failingOf(asIs.json, 'B1'), ['APP_VERSION'], '[٣] OLD8 تحت B1: FAIL في APP_VERSION وحده (ختمها 67 مطابق؛ الفرق في الإصدار الذي يحمله ملفّها الزمني)');
      await neg('B2 بتقرير S1 (13ch: M-02 not_working، وhiddenByModel، ودورات read)', 'B2', 'S1', ['B2'], ['EXPECT_M02_AUTO_COMPLETE_FULL_GRID', 'EXPECT_HIDDEN_BY_MODEL_EMPTY', 'EXPECT_CYCLE_NOT_READ_DECLARED']);
      await neg('S1 بتقرير X16 (جلسة 16ch بلا تقييم، دورات sysfs)', 'S1', 'X16', ['S1'], ['EXPECT_M02_NOT_WORKING_PARTIAL_GRID', 'EXPECT_CYCLE_EXTRA_API34_POSITIVE', 'EVALUATION_DOC']);
      await neg('S2 بتقرير X16 (جلسة بلا تقييم)', 'S2', 'X16', ['S2'], ['EVALUATION_DOC', 'EXPECT_CYCLE_EXTRA_API34_POSITIVE']);
      await neg('S2 بتقرير B2 (فحص فردي)', 'S2', 'B2', ['S2'], ['SESSION_SCAN']);
      await neg('WAIT بعيّنة fv67 (OLD8)', 'WAIT', 'OLD8', ['WAIT'], ['APP_VERSION', 'FIELDS_VERSION']);
      await neg('WAIT بتقرير B1 (فحص 1.0.10، ختم 67)', 'WAIT', 'B1', ['WAIT'], ['APP_VERSION', 'FIELDS_VERSION']);
    }
    // تفصيل D في تقرير بتشغيلين غير كاملين (16ch: فشل أصلي في الغربال بلا زمنه، وتشغيل not_reached بلا t ولا tEnd): بالسلسلة الحقيقية
    {
      const r = await runScript(mainAfter, ['--tokens', tokens(['X16']), '--out', '@OUT'], {bucket: bucketFor().bucket});
      const row = (item) => (r.json.table.find((x) => x.tag === 'X16' && x.item === item) || {});
      deq([row('CPU_D_RUNS').verdict, row('CPU_D_RUNS').basis], ['INFO', 'cpuKnownAnswerState=ran runs=6 phases=[3,5] runsWithFieldsNotPresent=2'], '[٣] X16: ملخّص D: ستّة تشغيلات، تشغيلان فيهما حقول غير حاضرة');
      eq(row('CPU_D_RUN_3_2').basis, 'index=1 phase=3 order=2 plannedAtPct=60 t=210945 tEnd=210975 diffMs=30 sieveStatus=native_call_failed:sieve kernel aborted: out of memory sievePrimeCount=ABSENT sieveDurationMs=ABSENT sha256Status=match sha256DurationMs=30 remainderMs=NOT_COMPUTED(sieveDurationMs:ABSENT)', '[٣] X16: التشغيل المقطوع بفشل أصلي: زمن الغربال وعدده ABSENT لا صفر');
      eq(row('CPU_D_RUN_5_3').basis, 'index=5 phase=5 order=3 plannedAtPct=92 t=ABSENT tEnd=ABSENT diffMs=NOT_COMPUTED(t:ABSENT,tEnd:ABSENT) sieveStatus=not_reached sievePrimeCount=ABSENT sieveDurationMs=ABSENT sha256Status=not_reached sha256DurationMs=ABSENT remainderMs=NOT_COMPUTED(t:ABSENT,tEnd:ABSENT,sieveDurationMs:ABSENT,sha256DurationMs:ABSENT)', '[٣] X16: التشغيل not_reached: بلا t ولا tEnd ولا أزمنة ⟵ ABSENT');
      eq(row('CPU_D_BREAKDOWN_3').basis, 'runs=3 sumDiffMs=270(n=3) sumSieveMs=180(n=2) sumSha256Ms=90(n=3) remainderMs=0(n=2) remainderExcluded=[{"index":1,"reason":"NOT_COMPUTED(sieveDurationMs:ABSENT)"}] shippedTotalMs=270 diffSumVsShipped=EQUAL', '[٣] X16: المرحلة 3: الغربال من تشغيلين (n=2) والمستثنى من الباقي مسمّى');
      eq(row('CPU_D_BREAKDOWN_5').basis, 'runs=3 sumDiffMs=240(n=2) sumSieveMs=180(n=2) sumSha256Ms=60(n=2) remainderMs=0(n=2) remainderExcluded=[{"index":5,"reason":"NOT_COMPUTED(t:ABSENT,tEnd:ABSENT,sieveDurationMs:ABSENT,sha256DurationMs:ABSENT)"}] shippedTotalMs=240 diffSumVsShipped=EQUAL', '[٣] X16: المرحلة 5: not_reached لا يدخل أيّ مجموع');
      eq(r.json.table.filter((x) => x.tag === 'X16' && (x.item.startsWith('CPU_D_RUN_') || x.item.startsWith('CPU_D_BREAKDOWN_'))).every((x) => x.verdict === 'INFO'), true, '[٣] X16: صفوف التفصيل كلّها INFO');
      eq(row('CPU_D_SHARE').verdict, 'PASS', '[٣] X16: وحكم معيار D كما كان (PASS: 270 و240 من المشحون)');
    }
    // طاقة العدّاد: null صريحة في ملفّ Storage (كما يكتبها التطبيق بقول وكيله) ورقم في الملفّ — الطلب (reportRaw الحقيقي) يُسقطها. INFO بلا حكم، والخروج 0. (ملفّ Storage هنا من كعب مُعلَن: الشبكة نحو GCS وحدها)
    {
      const variant = (tag, value) => { const file = storageFileOf(fingerprintFor(tag)); file.footer.batteryHealth.energyCounterNwh = value; return H.gz(file); };
      const objects2 = {...objects, [rawOf.B2.timeSeriesStoragePath]: variant('B2', null), [rawOf.S1.timeSeriesStoragePath]: variant('S1', 424242)};
      const r = await runScript(mainAfter, ['--tokens', tokens(['B2', 'S1']), '--out', '@OUT'], {bucket: H.makeStubBucket(objects2).bucket});
      const row = (tag) => r.json.table.find((x) => x.tag === tag && x.item === 'ENERGY_COUNTER_NWH');
      eq(row('B2').basis, `request.energyCounterNwh=ABSENT request.energyCounterNwhState=${payloadFor('B2').timeSeries.footer.batteryHealth.energyCounterNwhState} file.energyCounterNwh=NULL comparison=NULL_IN_FILE_ABSENT_IN_REQUEST`, '[٣] B2: null صريحة في ملفّ Storage وغائب من الطلب ⟵ NULL_IN_FILE_ABSENT_IN_REQUEST');
      eq(row('S1').basis, `request.energyCounterNwh=ABSENT request.energyCounterNwhState=${payloadFor('S1').timeSeries.footer.batteryHealth.energyCounterNwhState} file.energyCounterNwh=424242 comparison=NUMBER_IN_FILE_ABSENT_IN_REQUEST`, '[٣] S1: رقم في ملفّ Storage وغائب من الطلب ⟵ NUMBER_IN_FILE_ABSENT_IN_REQUEST');
      deq([row('B2').verdict, row('S1').verdict, r.code], ['INFO', 'INFO', 0], '[٣] كلاهما INFO بلا حكم، والخروج 0 (لا FAIL: تسمية لا حكم)');
      const noSt = await runScript(mainAfter, ['--tokens', tokens(['B2']), '--out', '@OUT', '--no-storage'], {bucket: undefined});
      eq(noSt.json.table.find((x) => x.item === 'ENERGY_COUNTER_NWH').basis.endsWith('file.energyCounterNwh=STORAGE_FILE_NOT_READ(STORAGE_NOT_READ_BY_OPTION) comparison=FILE_NOT_COMPARED(STORAGE_FILE_NOT_READ(STORAGE_NOT_READ_BY_OPTION))'), true, '[٣] --no-storage: الملفّ لم يُقرأ ⟵ FILE_NOT_COMPARED بسببه، والباقي من الطلب');
    }
    // وسم بلا توقّعات خاصّة يمرّ بقواعده العامّة ويُعلَن
    {
      const r = await runScript(mainAfter, ['--tokens', `B2=${shortOf.B2},ZZ=${shortOf.WAIT}`, '--out', '@OUT'], {bucket: bucketFor().bucket});
      eq(r.code, 0, '[٣] وسم بلا توقّعات (ZZ) على تقرير fv69: القواعد العامّة ⟵ 0');
      deq(r.json.expectations.thisRun, [{tag: 'B2', special: true}, {tag: 'ZZ', special: false, note: 'بلا توقّعات خاصّة: القواعد العامّة وحدها'}], '[٣] ويُعلَن في المخرَج أنّه بلا توقّعات خاصّة');
      ok(!r.json.table.some((x) => x.tag === 'ZZ' && x.item.startsWith('EXPECT_')), '[٣] ولا صفوف EXPECT له');
    }
    // --no-storage
    {
      const r = await runScript(mainAfter, ['--tokens', tokens(['B2']), '--out', '@OUT', '--no-storage'], {bucket: undefined});
      eq(r.code, 0, '[٣] --no-storage بلا bucket: 0');
      deq([r.json.table.find((x) => x.item === 'CPU_D_SHARE').verdict, r.json.table.find((x) => x.item === 'STORAGE_COPY').verdict, r.json.table.find((x) => x.item === 'EXPECT_M02_AUTO_COMPLETE_FULL_GRID').verdict], ['NOT_MEASURED', 'NOT_MEASURED', 'PASS'], '[٣] --no-storage: D ونسخة Storage NOT_MEASURED بالسبب، وتوقّع M-02 (من reportRaw) PASS');
    }
    // رمز غير موجود وحساب غير موجود
    {
      const r = await runScript(mainAfter, ['--tokens', 'B2=NC-NOSUCH', '--out', '@OUT'], {bucket: bucketFor().bucket});
      eq(r.code, 1, '[٣] رمز غير موجود: REPORT_FOUND FAIL ⟵ 1');
      ok(r.json.table.filter((x) => x.item.startsWith('EXPECT_')).every((x) => x.verdict === 'NOT_MEASURED' && /REPORT_ABSENT/.test(x.basis)), '[٣] وصفوف EXPECT لـB2 NOT_MEASURED:REPORT_ABSENT (لا صفّ يُحذف صامتاً)');
      const nf = await runScript(mainAfter, ['--tokens', tokens(['B2']), '--out', '@OUT'], {env: {[C.OWNER_EMAIL_ENV]: 'nobody@example.test'}, bucket: bucketFor().bucket});
      eq(nf.code, 2, '[٣] حساب غير موجود: 2');
      ok(!nf.text.includes('nobody@example.test'), '[٣] بلا بريد في النصّ');
    }

    // ═══ ٤ — السكربت ٣ على التقارير الحقيقية ═══
    {
      for (const tag of ['B2', 'S1', 'S2', 'WAIT']) {
        const stub = bucketFor();
        const r = await runScript(mainKeyPaths, ['--short-id', shortOf[tag], '--out', '@OUT'], {bucket: stub.bucket, auth: undefined});
        eq(r.code, 0, `[٤] ${tag}: المصادر الثلاثة قورنت: 0`);
        deq(stub.writeAttempts, [], `[٤] ${tag}: لا كتابة Storage`);
        deq(stub.calls.filter((c) => c.op === 'download').map((c) => JSON.stringify(c.opts)), ['{"decompress":false}'], `[٤] ${tag}: تنزيل واحد بـ{decompress:false} (إلى الذاكرة)`);
        const j = r.json;
        deq(j.keyFiles.chosen.map((c) => c.name), Object.values(FILES).map((f) => `${f}.keys.txt`), `[٤] ${tag}: ملفّات المفاتيح المختارة من الملفّات (fieldsVersion 69): الثلاثة بأسمائها`);
        const own = `${FILES[KEY[tag]]}.keys.txt`;
        eq(j.sources.reportRawFingerprint.closestKeysFile, own, `[٤] ${tag}: الأقرب لـreportRaw الحقيقي هو ملفّ مفاتيح حمولته (${own.slice(-34)})`);
        const rawOwn = j.sources.reportRawFingerprint.comparisons.find((c) => c.keysFile === own);
        deq([rawOwn.extraCount, rawOwn.missingCount], [0, 0], `[٤] ${tag}: reportRaw المكتوب بالسلسلة الحقيقية يطابق ملفّ مفاتيحه بعد التخفيف: لا زائد ولا ناقص`);
        eq(j.sources.storageCopy.closestKeysFile, own, `[٤] ${tag}: وأقرب ملفّ لنسخة Storage هو نفسه`);
        const stOwn = j.sources.storageCopy.comparisons.find((c) => c.keysFile === own);
        deq([stOwn.extra, stOwn.missing], [[], ['timeSeries.timeSeriesState']], `[٤] ${tag}: Storage: الناقص timeSeriesState وحده (حقل حمولة الطلب)`);
        eq(j.sources.reportsDoc.state, 'COMPARED', `[٤] ${tag}: مستند التقرير الحقيقي قورن بمرجعه`);
        ok(j.sources.reportsDoc.actualCount > 20, `[٤] ${tag}: ومساراته أكثر من عشرين`);
        ok(!j.sources.reportsDoc.extra.some((p) => /^(rawFingerprint|sessionId|deviceFingerprintSha|timeSeriesStoragePath|aiAudit)/.test(p)), `[٤] ${tag}: مستند التقرير المقروء بلا الحقول المنقولة (V8)`);
      }
      // B1 (fv67): لا ملفّ مفاتيح بإصدار 67 بجذر البصمة
      const r = await runScript(mainKeyPaths, ['--short-id', shortOf.B1, '--out', '@OUT'], {bucket: bucketFor().bucket});
      eq(r.code, 3, '[٤] B1 (fv67): لا ملفّ مفاتيح بإصداره: 3');
      deq([r.json.keyFiles.reportFieldsVersion, r.json.keyFiles.chosen, r.json.sources.reportRawFingerprint.state, r.json.sources.storageCopy.state], [67, [], 'NO_KEYS_FILE_FOR_FIELDS_VERSION', 'NO_KEYS_FILE_FOR_FIELDS_VERSION'], '[٤] B1: الإصدار 67، لا ملفّ مختار، وحالتان صريحتان (لا مقارنة بملفّ 69)');
      ok(r.json.keyFiles.skipped.some((s) => /^fv67-app-request-payload/.test(s.name) && /REQUEST_ROOT/.test(s.reason)), '[٤] وملفّ مفاتيح طلب fv67 مستبعَد بسببه (جذره الطلب لا البصمة)');
      // Storage يفقد الكائن
      const nostore = await runScript(mainKeyPaths, ['--short-id', shortOf.B2, '--out', '@OUT'], {bucket: H.makeStubBucket({}).bucket});
      deq([nostore.code, nostore.json.sources.storageCopy.state, nostore.json.sources.reportRawFingerprint.state], [3, 'FILE_NOT_FOUND', 'COMPARED'], '[٤] لا كائن في Storage: FILE_NOT_FOUND والخامّ يُقارَن (3)');
      // لا تقرير
      const none = await runScript(mainKeyPaths, ['--short-id', 'NC-NOSUCH', '--out', '@OUT'], {bucket: bucketFor().bucket});
      deq([none.code, none.json.early.state], [3, 'REPORT_ABSENT'], '[٤] لا تقرير: REPORT_ABSENT (3)');
    }

    // ═══ ٥ — لم يتغيّر شيء في المحاكي؛ والقرص؛ والأسرار ═══
    fsSpy.restore();
    eq(await dumpAll(), before, '[٥] صورة المحاكي الكاملة (كل المجموعات، المحتوى وupdateTime وcreateTime) هي نفسها بعد كل تشغيلات السكربتات: قراءة بحتة');
    deq([...new Set(fsSpy.writes.map((w) => path.resolve(w.path)))].sort(), [...new Set(outFiles.map((p) => path.resolve(p)))].sort(), '[٥] الملفّات المكتوبة على القرص = ملفّات --out وحدها (لا نسخة من ملفّ Storage)');
    deq(netGuard.blocked, [], '[٥] ولا اتصال بغير المضيف المحلّي في الاختبار كلّه (لا مزوّد نموذج ولا GCS)');
    const leaked = SECRETS.filter((s) => outText.some((t) => t.includes(s)));
    deq(leaked.map((s) => `${s.slice(0, 12)}…`), [], '[٥] لا بريد ولا uid ولا scanId ولا sessionId ولا shortId ولا اسم فنّي ولا مسار Storage ولا بصمة جهاز في أيّ مخرَج (الملفّات وstdout وstderr)');
    for (const f of outFiles) {
      const b = fs.readFileSync(f);
      ok(!(b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF), `[٥] ${path.basename(f)}: UTF-8 بلا BOM`);
    }

    // ═══ ٦ — المسار الحقيقي لتهيئة Admin SDK ═══
    {
      const real = C.initReadOnlyAdmin({appName: 'dc03-e2e-real-init', withAuth: true, withStorage: true});
      const snap = await C.wrapReadOnly(real.db).collection('users').doc(OWNER).get();
      eq(snap.exists, true, '[٦] initReadOnlyAdmin (projectId المثبَّت) يقرأ Firestore المحاكي فعلاً');
      deq(Object.keys(real.auth), ['getUserByEmail'], '[٦] وAuth المعروضة عملية واحدة');
      eq(real.bucket.name, C.STORAGE_BUCKET, '[٦] وbucket باسمه المثبَّت (لا نداء شبكة حتى يُستعمل)');
      eq((await db.collection('reports').where('userId', '==', OWNER).count().get()).data().count, 7, '[٦] (تحقّق) سبعة تقارير');
      await admin.app('dc03-e2e-real-init').delete();
    }

    // ═══ ٧ — الأوامر كما ستستدعيها الكتل: عملية فرعية ═══
    const cli = (script, args, env = {}) => {
      const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, script), ...args], {env: {...process.env, ...env}, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      return {code: r.status, stdout: r.stdout || '', stderr: r.stderr || ''};
    };
    for (const [script, label] of [['device-check-03-before-readonly.js', 'before'], ['device-check-03-after-readonly.js', 'after'], ['golden-stage2-keypaths-readonly.js', 'keypaths']]) {
      const r = cli(script, ['--preflight']);
      eq(r.code, 0, `[٧] ${label} --preflight: 0`);
      const pj = JSON.parse(r.stdout);
      deq([pj.mode, pj.network, pj.readOnly, pj.ok, pj.projectId], ['preflight', false, true, true, 'neuralchek-9b6d7'], `[٧] ${label}: preflight بلا شبكة، قراءة فقط، projectId المثبَّت`);
    }
    {
      const r1 = cli('device-check-03-before-readonly.js', ['--out', nextOut('cli-noenv')], {[C.OWNER_EMAIL_ENV]: ''});
      ok(r1.code === 2 && /OWNER_EMAIL_ENV_MISSING/.test(r1.stderr), '[٧] before بلا متغيّر بيئة: 2 قبل أيّ اتصال');
      const r2 = cli('device-check-03-after-readonly.js', ['--tokens', 'B1=NC-AAAAAA', '--out', path.join(tmp, 'no-such-dir', 'x.json')], {[C.OWNER_EMAIL_ENV]: EMAIL});
      ok(r2.code === 2 && /OUT_DIR_MISSING/.test(r2.stderr), '[٧] after بمجلّد مخرَج غائب: 2 قبل أيّ اتصال');
      const r3 = cli('golden-stage2-keypaths-readonly.js', ['--short-id', 'bad', '--out', nextOut('cli-bad')]);
      ok(r3.code === 2 && /NC-XXXXXX/.test(r3.stderr), '[٧] keypaths برمز خاطئ: 2');
      const r4 = cli('golden-stage2-keypaths-readonly.js', ['--short-id', shortOf.B2, '--out', path.join(tmp, 'no-such-dir', 'y.json')]);
      ok(r4.code === 2 && /OUT_DIR_MISSING/.test(r4.stderr), '[٧] keypaths بمجلّد مخرَج غائب: 2 قبل أيّ اتصال');
      ok(![r1, r2, r3, r4].some((r) => r.stdout.includes(EMAIL) || r.stderr.includes(EMAIL)), '[٧] ولا بريد في أيّ منها');
    }
    let authCases = 'SKIPPED';
    if (AUTH_HOST) {
      authCases = 'RAN';
      const authApp = admin.initializeApp({projectId: C.PROJECT_ID}, 'e2e-dc03-auth');
      await authApp.auth().createUser({uid: OWNER, email: EMAIL});
      const outB = nextOut('cli-before-real-auth');
      let r = cli('device-check-03-before-readonly.js', ['--out', outB], {[C.OWNER_EMAIL_ENV]: EMAIL});
      eq(r.code, 0, '[٧] Auth حقيقي: السكربت ١ بالأمر نفسه في عملية فرعية: 0');
      const jb = JSON.parse(fs.readFileSync(outB, 'utf8'));
      deq([jb.account.accountHash, jb.evaluationEnabled.decision.reason, jb.reports.accountReportsCount], [C.hashIdForLog(OWNER), 'FLAG_TRUE', 7], '[٧] Auth حقيقي: المعرّف المُهشَّر وFLAG_TRUE وسبعة تقارير');
      ok(![fs.readFileSync(outB, 'utf8'), r.stdout, r.stderr].some((t) => t.includes(EMAIL) || t.includes(OWNER)), '[٧] Auth حقيقي: لا بريد ولا uid خامّ');
      const outA = nextOut('cli-after-real-auth');
      r = cli('device-check-03-after-readonly.js', ['--tokens', tokens(FIVE), '--out', outA, '--no-storage'], {[C.OWNER_EMAIL_ENV]: EMAIL});
      eq(r.code, 0, '[٧] Auth حقيقي: السكربت ٢ (--no-storage) بالأمر نفسه: 0');
      const ja = JSON.parse(fs.readFileSync(outA, 'utf8'));
      eq(ja.owner.accountReportsCount, jb.reports.accountReportsCount, '[٧] Auth حقيقي: عدد تقارير المالك في ٢ = ١');
      ok(ja.table.some((x) => x.item === 'M02_RAW' && x.verdict === 'PASS') && ja.table.filter((x) => x.item === 'CPU_D_SHARE').every((x) => x.verdict === 'NOT_MEASURED'), '[٧] Auth حقيقي: بنود الخامّ تُقرأ وبنود العيّنات NOT_MEASURED (بلا Storage)');
      eq(ja.summary.hasFail, false, '[٧] Auth حقيقي: الوسوم الخمسة تطابق توقّعاتها (لا FAIL) بالأمر نفسه في عملية فرعية');
      ok(![fs.readFileSync(outA, 'utf8'), r.stdout, r.stderr].some((t) => SECRETS.some((s) => t.includes(s))), '[٧] Auth حقيقي: لا أسرار في مخرَج ٢');
      r = cli('device-check-03-before-readonly.js', ['--out', nextOut('cli-nf')], {[C.OWNER_EMAIL_ENV]: 'nobody.real@example.test'});
      ok(r.code === 2 && /OWNER_ACCOUNT_NOT_FOUND/.test(r.stderr) && !r.stderr.includes('nobody.real'), '[٧] Auth حقيقي: حساب غير موجود: 2 بلا بريد (رسالة المزوّد الحقيقية لا تُنقل)');
      await authApp.delete();
    } else {
      console.log('AUTH-EMULATOR CASES SKIPPED: FIREBASE_AUTH_EMULATOR_HOST غير مضبوط — حالات getUserByEmail الحقيقية لم تجرِ في هذا التشغيل (الاستبدال بـAuth مزيَّف معلَن في الرأس)؛ شغّل بملفّ إعداد Auth لتجري.');
    }

    fs.rmSync(tmp, {recursive: true, force: true});
    await reset();
    await admin.app().delete().catch(() => {});
    console.log(`\nALL PASS (${n} assertions; auth-emulator cases: ${authCases})`);
  } finally {
    netGuard.restore();
  }
})().catch((e) => {
  console.error('FAIL:', (e && e.stack) || e);
  process.exitCode = 1;
});

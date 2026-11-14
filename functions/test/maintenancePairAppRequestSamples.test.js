'use strict';

// maintenancePairAppRequestSamples.test.js — عيّنات **طلبات التطبيق** الخمس لربط «قبل/بعد صيانة» تمرّ بالدوالّ الحقيقية (القاعدة 41؛ أمر المنسّق 2026-10-22).
//
// ما هي العيّنات: خمسة ملفّات في test/fixtures/golden/maintenance-pair-request-*.json، نسخ حرفية (بايتاً ببايت، -text) من NeuralChek@fed7d12
// app/src/test/resources/derived/ — صنعتها **بُناة التطبيق الحقيقيون** (SessionPurposeWire.request وPairLinkWire.listRequest وPairLinkWire.confirmRequest)، لا هذا المستودع.
// سجلّ المصدر والبصمات: test/fixtures/golden/maintenance-pair-app-requests-fed7d12.SOURCE.txt. **لا تُعدَّل هنا (القاعدة 12)**؛ المشتقّ منها يُكتب في هذا الملفّ بوسم «مشتقّ».
// هذه **طلبات** لا ردود: ردود الخادم عيّناتها maintenance-pair-wire-samples-2026-10-22.json (مولَّدة، ومحروسة بـmaintenancePairWireSamplesGuard.test.js) — لا يخلط هذا الملفّ بينهما.
//
// ما يُنفَّذ (القاعدة 37: لا يُستبدَل إلا ما تحت الطبقة التي قد ترفض):
//   • **حقيقي:** غلاف onCall في firebase-functions (فكّ التوكن وencode وحالة HTTP)، والدوالّ المُصدَّرة setSessionPurpose وlistOpenMaintenanceBefores وconfirmMaintenanceAfterLink بمعالجاتها الكاملة
//     (التحقّق من المدخل، الملكية، الحالة، جزء المحلّ، نوع العطل، الاستعلامات، المعاملة)، وكل ما يحكم فيها في protocol/maintenancePair.js.
//   • **مستبدَل (مُعلَن):** utils/admin ⟵ db في الذاكرة (lib/pairFakeDb.js: مساواة وحدها، لا حذف، معاملة تفاؤلية) بمشاهد بذرة من هذا الملفّ؛ والتوكن غير موقَّع (FIREBASE_DEBUG_MODE وskipTokenVerification، كالمولّد
//     generate-maintenance-pair-wire-samples.js). **غير متحقَّق هنا:** السلوك على Firestore الحقيقي (maintenancePair.e2e.test.js على المحاكي) وما يفعله التطبيق بالردّ.
//
// ما يثبّته:
//   أ) العيّنات نفسها: sha256 كاملة (من README التطبيق، وتطابقها sha256sum وgit show في سجلّ المصدر)، وبايتاتها، وشكلها **مفتاحاً مفتاحاً** (القاعدة 25: مفتاح جديد في طلب التطبيق لا يُقبل بلا تحديث كل قارئ
//      له — فالاختبار يفشل إن زاد التطبيق مفتاحاً)، وقيمها بحرفيّات مكتوبة باليد (القاعدة 30) ومن مفردات الخادم (protocolVocabulary: المصدر الواحد، القاعدة 24)، وتماسكها: الجلسة نفسها في «بعد» وقائمتها
//      وتأكيدها، و«قبل» التأكيد هي «قبل» التي تعرضها القائمة.
//   ب) setSessionPurpose: الثلاثة تُقبل كما بناها التطبيق، ونوع العطل يُكتب في **protocolPending لا scanSessions**؛ و«normal» بلا مفتاح defectType يُقبل ولا يكتب نوعاً (null صريح، لا نوع مختلَق).
//   جـ) listOpenMaintenanceBefores: الطلب {sessionId} وحده يُقبل ويُرجِع المرشَّح الصحيح بلا أيّ كتابة؛ وتأكيد: {sessionId, beforeScanId} يُقبل ويكتب الاختيار في protocolPending وحده، ولا شيء على «قبل».
//   د) مشتقّات (حمولات معدَّلة لا عيّنات مُنتِج؛ القاعدة 12): «normal» بمفتاح defectType = null يُرفض DEFECT_TYPE_NOT_APPLICABLE (لهذا يتعمّد التطبيق غياب المفتاح)، وmaintenance_before بلا النوع يُرفض
//      DEFECT_TYPE_REQUIRED، وطلب بمفتاح زائد **يُقبل ويُتجاهَل** (الخادم لا يرفض المفاتيح الزائدة: حارس شكل الطلب هو التثبيت في أ، لا الخادم).
//
// Run: node functions/test/maintenancePairAppRequestSamples.test.js

// قبل أيّ require لـfirebase-functions: يُحمَّل الغلاف بوضع تصحيح يقبل توكناً غير موقَّع (لا يُحمَّل شيء من الإنتاج بهذا الوضع إلا في هذه العملية).
process.env.FIREBASE_DEBUG_MODE = 'true';
process.env.FIREBASE_DEBUG_FEATURES = JSON.stringify({skipTokenVerification: true});
process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const {makePairDb, ts, FieldValue} = require('./lib/pairFakeDb');

// ─── utils/admin ⟵ db في الذاكرة (الاستبدال المُعلَن): قاعدة جارية تُبذَر لكل مشهد ───
const state = {db: null};
const dbProxy = new Proxy({}, {
  get: (_t, prop) => {
    if (state.db === null) throw new Error('maintenancePairAppRequestSamples: لا قاعدة مبذورة');
    const v = state.db[prop];
    return typeof v === 'function' ? v.bind(state.db) : v;
  },
});
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: {firestore: {FieldValue}}, db: dbProxy, ADMIN_EMAILS: [], requireAdmin: () => {}},
};

// الدوالّ المُصدَّرة الحقيقية (بعد الاستبدال أعلاه)
const {listOpenMaintenanceBefores, confirmMaintenanceAfterLink} = require('../src/sessions/maintenancePairCalls');
const {setSessionPurpose} = require('../src/sessions/setSessionPurpose');
const V = require('../src/protocol/protocolVocabulary');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsignedJwt = (payload) => `${b64({alg: 'none', typ: 'JWT'})}.${b64(payload)}.unsigned`;

/** طلب POST بشكل ما يصل الدالّة المستدعاة من SDK التطبيق ({data}) إلى الدالّة المُصدَّرة؛ يُعيد {httpStatus, body, lines}. */
async function callWire(fn, data, uid) {
  const headers = {'content-type': 'application/json', authorization: `Bearer ${unsignedJwt({sub: uid, firebase: {sign_in_provider: 'google.com'}})}`};
  const req = {method: 'POST', headers, body: {data}, header(name) { return this.headers[String(name).toLowerCase()]; }, get(name) { return this.header(name); }};
  let httpStatus = null;
  let body = null;
  const listeners = {};
  const res = {
    statusCode: 200, headersSent: false,
    status(s) { httpStatus = s; return this; },
    send(b) { body = b; (listeners.finish || []).forEach((f) => f()); return this; },
    json(b) { body = b; return this; },
    setHeader() {}, getHeader() { return undefined; }, removeHeader() {}, write() { return true; }, flushHeaders() {},
    end() { (listeners.finish || []).forEach((f) => f()); },
    on(e, f) { (listeners[e] = listeners[e] || []).push(f); return this; }, once(e, f) { return this.on(e, f); }, emit() {},
  };
  const lines = [];
  const real = {log: console.log, warn: console.warn, error: console.error, write: process.stdout.write};
  console.log = (...a) => lines.push(a.join(' ')); console.warn = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  process.stdout.write = () => true; // سطر «Callable request verification passed» من firebase-functions يُكتب مباشرة على stdout
  try { await fn(req, res); } finally { process.stdout.write = real.write; Object.assign(console, {log: real.log, warn: real.warn, error: real.error}); }
  if (httpStatus === 401) throw new Error('maintenancePairAppRequestSamples: التوكن غير الموقَّع رُفض — الملفّ حُمِّل بعد firebase-functions أو تغيّر سلوك skipTokenVerification');
  return {httpStatus, body, lines};
}

// ═══ أ) العيّنات: البصمة والبايتات والشكل والقيم والتماسك ═══════════════════════════════════════════════════════════════
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
// الأسماء والبصمات والأحجام والمحتوى المتوقَّع **مكتوبة باليد** (القاعدة 30): البصمة من كتلة maintenance-pair-sha256 في README التطبيق (NeuralChek@fed7d12) وتطابقها sha256sum على النسخ وgit show على المصدر.
const SAMPLES = {
  beforeBattery: {
    file: 'maintenance-pair-request-set-session-purpose-maintenance-before-battery.json', bytes: 97,
    sha256: 'cc0589180dc89bdc4ddba094e9ce03d6c76364b5a0e61b871195758f37c1683e', value: {sessionId: 'sess-golden-1', purpose: 'maintenance_before', defectType: 'BATTERY'},
  },
  afterChargingPort: {
    file: 'maintenance-pair-request-set-session-purpose-maintenance-after-charging-port.json', bytes: 102,
    sha256: '1cd639ca23ee64198e2042f9e53282da5ef13420a213f684f03730c23bb684bb', value: {sessionId: 'sess-golden-2', purpose: 'maintenance_after', defectType: 'CHARGING_PORT'},
  },
  normalNoDefectType: {
    file: 'maintenance-pair-request-set-session-purpose-normal-no-defect-type.json', bytes: 58,
    sha256: '04ab287ab80679ffc32e79324d2db729607d5b51e1a595cdf5fbc16078e74bcb', value: {sessionId: 'sess-golden-3', purpose: 'normal'},
  },
  list: {
    file: 'maintenance-pair-request-list-open-maintenance-befores.json', bytes: 35,
    sha256: '661fdbabc87f26d7ab15f0222252ff7fcc24e386118f90eedd3ce5ee090cf2f7', value: {sessionId: 'sess-golden-2'},
  },
  confirm: {
    file: 'maintenance-pair-request-confirm-maintenance-after-link.json', bytes: 77,
    sha256: '4481f33e1df3c384c58e3ffbc765c2827998f0e502a7f5037f574ad9e45375d1', value: {sessionId: 'sess-golden-2', beforeScanId: 'scan-golden-before-1'},
  },
};
const sourceTxt = fs.readFileSync(path.join(GOLDEN, 'maintenance-pair-app-requests-fed7d12.SOURCE.txt'), 'utf8');
const S = {};
for (const [k, spec] of Object.entries(SAMPLES)) {
  const bytes = fs.readFileSync(path.join(GOLDEN, spec.file));
  eq(crypto.createHash('sha256').update(bytes).digest('hex'), spec.sha256, `[أ][${k}] sha256 كاملة = كتلة README التطبيق (NeuralChek@fed7d12)`);
  eq(bytes.length, spec.bytes, `[أ][${k}] الحجم ${spec.bytes} بايتاً`);
  ok(!bytes.includes(0x0d) && bytes[bytes.length - 1] === 0x0a, `[أ][${k}] LF بلا CR وينتهي بسطر جديد (نسخة -text بلا تحويل)`);
  ok(sourceTxt.includes(`${spec.sha256}  ${spec.file}`), `[أ][${k}] وسجلّ SOURCE.txt يحمل البصمة والاسم معاً`);
  S[k] = JSON.parse(bytes.toString('utf8'));
  deq(S[k], spec.value, `[أ][${k}] المحتوى حرفيّاً: مفاتيحه وقيمه كما أرسلها بنّاء التطبيق، لا مفتاح زائد ولا ناقص (القاعدة 25)`);
}
deq(Object.keys(S.normalNoDefectType), ['sessionId', 'purpose'], '[أ] «normal»: مفتاح defectType **غائب** لا null (يعدّ الخادم المفتاح الحاضر مُرسَلاً: DEFECT_TYPE_NOT_APPLICABLE)');
ok(!Object.prototype.hasOwnProperty.call(S.normalNoDefectType, 'defectType'), '[أ] «normal»: لا مفتاح defectType');
deq(Object.keys(S.list), ['sessionId'], '[أ] القائمة: sessionId وحده');
// مفردات الخادم (المصدر الواحد): قيم العيّنات منها
ok(Object.values(V.SETTABLE_SESSION_PURPOSE).includes(S.beforeBattery.purpose) && Object.values(V.SETTABLE_SESSION_PURPOSE).includes(S.afterChargingPort.purpose) &&
  Object.values(V.SETTABLE_SESSION_PURPOSE).includes(S.normalNoDefectType.purpose), '[أ] أغراض العيّنات الثلاثة من SETTABLE_SESSION_PURPOSE في الخادم');
ok(Object.values(V.DEFECT_TYPE).includes(S.beforeBattery.defectType) && Object.values(V.DEFECT_TYPE).includes(S.afterChargingPort.defectType), '[أ] نوعا العطل (BATTERY وCHARGING_PORT) من DEFECT_TYPE في الخادم');
// التماسك بين العيّنات
eq(S.list.sessionId, S.afterChargingPort.sessionId, '[أ] قائمة «بعد» تسأل عن جلسة «بعد» التي اختارت غرضها في عيّنة setSessionPurpose');
eq(S.confirm.sessionId, S.list.sessionId, '[أ] والتأكيد على الجلسة نفسها');
ok(S.confirm.beforeScanId === 'scan-golden-before-1' && S.confirm.sessionId !== S.beforeBattery.sessionId, '[أ] «قبل» التأكيد scan-golden-before-1، وجلسة «بعد» ليست جلسة «قبل» الأولى');

// ─── المشاهد ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const T0 = Date.now();
const HOUR = 3600 * 1000;
const OWNER = 'owner-golden';
const OTHER = 'owner-other';
const pendingSession = () => ({ownerId: OWNER, status: 'pending', expiresAt: ts(T0 + HOUR)});
// (ق31، أقرّه حسن 2026-10-22؛ القاعدة 23: كانت بذرة المالك غائبة لأنّ setSessionPurpose لم تكن تفحص جزء المحلّ؛ صار maintenance_* يحتاج الجزأين فبذرة المالك تحملهما — ما يُثبَّت هنا هو قبول طلبات التطبيق كما بُنيت، لا فحص الجزء: له setSessionPurposePart.test.js)
const OWNER_DOC = {plan: 'shop_pro', protocolParts: {purposes: true, batteryBeforeAfter: true}};
const freshSessionsDb = () => makePairDb({scanSessions: {'sess-golden-1': pendingSession(), 'sess-golden-2': pendingSession(), 'sess-golden-3': pendingSession()}, users: {[OWNER]: OWNER_DOC}}, {now: T0});
const MAP = {version: 4, entries: [{model: 'SM-A135F', ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}]};
const beforeProto = (defectType, owner = OWNER) => ({scanPurpose: 'maintenance_before', defectType, linkedScanId: null, linkState: 'none', linkMethod: null, pair: {state: 'OPEN', ownerId: owner, openedAt: ts(T0 - 3 * HOUR)}});
const texts = (r) => r.lines.join('\n');

(async () => {
  // ═══ ب) setSessionPurpose: الثلاثة كما بناها التطبيق ═══
  state.db = freshSessionsDb();
  const db = state.db;
  const SP = [
    ['beforeBattery', 'maintenance_before', 'BATTERY'],
    ['afterChargingPort', 'maintenance_after', 'CHARGING_PORT'],
    ['normalNoDefectType', 'normal', null],
  ];
  for (const [k, purpose, defectType] of SP) {
    const id = S[k].sessionId;
    const w0 = db.writes.length;
    const r = await callWire(setSessionPurpose, S[k], OWNER);
    eq(r.httpStatus, 200, `[ب][${k}] تُقبل (HTTP 200) كما بناها التطبيق`);
    deq(r.body, {result: {sessionId: id, purpose, purposeSource: 'selected'}}, `[ب][${k}] الردّ {sessionId, purpose, purposeSource: selected}`);
    deq(db.writes.slice(w0).map((w) => `${w.op}:${w.path}`), [`update:scanSessions/${id}`, `set:protocolPending/${id}`], `[ب][${k}] كتابتان فقط: الجلسة (الغرض) وprotocolPending`);
    const {expiresAt, ...sessionRest} = db.store.scanSessions[id];
    eq(expiresAt.toMillis(), T0 + HOUR, `[ب][${k}] انقضاء الجلسة لم يتغيّر`);
    deq(sessionRest, {ownerId: OWNER, status: 'pending', purpose}, `[ب][${k}] مستند الجلسة: الغرض وحده أُضيف — **لا defectType في scanSessions**`);
    deq(db.store.protocolPending[id], {purposeSource: 'selected', defectType, linkedScanId: null, linkMethod: null, linkConfirmedAt: null, linkConfirmedByTechnicianId: null},
        `[ب][${k}] protocolPending: نوع العطل ${defectType === null ? 'null صريح (لا نوع مختلَق)' : defectType} ومسح اختيار الربط السابق`);
    ok(Object.prototype.hasOwnProperty.call(db.store.protocolPending[id], 'defectType'), `[ب][${k}] مفتاح defectType حاضر في protocolPending (بقيمته)`);
    const log = texts(r);
    ok(log.includes(`[setSessionPurpose] set session=`) && log.includes(`purpose=${purpose} previous=ABSENT`), `[ب][${k}] سطر النجاح المسمّى`);
    eq(log.includes(' defectType='), defectType !== null, `[ب][${k}] ${defectType !== null ? 'والنوع في سطر السجلّ' : 'ولا نوع في سطر السجلّ'}`);
    ok(!log.includes(id) && !log.includes(OWNER), `[ب][${k}] لا معرّف خامّ في السجلّ`);
  }

  // ═══ جـ) القائمة والتأكيد: المشهد يبني على جلسة «بعد» التي اختارت غرضها أعلاه (CHARGING_PORT) ═══
  db.seed('users', OWNER, {plan: 'shop_pro', protocolParts: {purposes: true, batteryBeforeAfter: true}});
  db.seed('protocolSettings', 'current', {version: 1, openBeforeValidityHours: 72});
  db.seed('marketingNames', 'current', MAP);
  db.seed('scanProtocol', 'scan-golden-before-1', beforeProto('CHARGING_PORT'));
  db.seed('reports', 'scan-golden-before-1', {userId: OWNER, deviceModel: 'SM-A135F'});
  db.seed('scanProtocol', 'scan-golden-before-battery', beforeProto('BATTERY'));        // نوع آخر: يُستبعد
  db.seed('reports', 'scan-golden-before-battery', {userId: OWNER, deviceModel: 'SM-A135F'});
  db.seed('scanProtocol', 'scan-golden-before-other-shop', beforeProto('CHARGING_PORT', OTHER)); // محلّ آخر: لا يُقرأ
  db.seed('reports', 'scan-golden-before-other-shop', {userId: OTHER, deviceModel: 'SM-A135F'});
  {
    const w0 = db.writes.length;
    const q0 = db.queries.length;
    const r = await callWire(listOpenMaintenanceBefores, S.list, OWNER);
    eq(r.httpStatus, 200, '[جـ] القائمة: طلب {sessionId} وحده يُقبل (HTTP 200)');
    deq(r.body, {result: {validityHours: 72, candidates: [{
      beforeScanId: 'scan-golden-before-1', deviceName: {state: 'mapped', model: 'SM-A135F', names: {ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}, reason: null}, scannedAtMs: T0 - 3 * HOUR,
    }]}}, '[جـ] القائمة: مرشَّح واحد هو «قبل» CHARGING_PORT لهذا المحلّ (بنوع جلسة «بعد» كما اختارته العيّنة)، باسمه التجاري ووقت فتحه؛ BATTERY ومحلّ آخر لا يظهران');
    deq(db.writes.slice(w0), [], '[جـ] القائمة: **لا كتابة** (قراءة وحدها)');
    ok(db.queries.slice(q0).length >= 1 && db.queries.slice(q0).every((q) => q.filters.every((f) => f[1] === '==')), '[جـ] القائمة: استعلاماتها مساواة وحدها');
    const log = texts(r);
    ok(log.includes('candidates=1') && log.includes('excluded=WRONG_TYPE:1'), '[جـ] سطر السجلّ: مرشَّح واحد، واستُبعدت BATTERY بسبب النوع');
    ok(!log.includes('SM-A135F') && !log.includes('scan-golden') && !log.includes('sess-golden'), '[جـ] لا طراز ولا معرّف خامّ في السجلّ');
  }
  {
    const w0 = db.writes.length;
    const sessionBefore = JSON.stringify(db.store.scanSessions['sess-golden-2']);
    const protoBefore = JSON.stringify(db.store.scanProtocol['scan-golden-before-1']);
    const r = await callWire(confirmMaintenanceAfterLink, S.confirm, OWNER);
    eq(r.httpStatus, 200, '[جـ] التأكيد: طلب {sessionId, beforeScanId} يُقبل (HTTP 200)');
    deq(r.body, {result: {sessionId: 'sess-golden-2', beforeScanId: 'scan-golden-before-1', linkMethod: 'manual'}}, '[جـ] التأكيد: الردّ {sessionId, beforeScanId, linkMethod: manual}');
    deq(db.writes.slice(w0).map((w) => `${w.op}:${w.path}`), ['set:protocolPending/sess-golden-2'], '[جـ] التأكيد: كتابة واحدة على protocolPending وحده — **لا شيء على «قبل» ولا على الجلسة**');
    const p = db.store.protocolPending['sess-golden-2'];
    deq([p.linkedScanId, p.linkMethod, p.linkConfirmedByTechnicianId, p.defectType, p.purposeSource], ['scan-golden-before-1', 'manual', null, 'CHARGING_PORT', 'selected'],
        '[جـ] المكتوب: linkedScanId وlinkMethod = manual وlinkConfirmedByTechnicianId = null صريحاً؛ ونوع العطل واختيار الغرض كما كانا (دمج لا استبدال)');
    eq(p.linkConfirmedAt.toMillis(), T0, '[جـ] linkConfirmedAt بوقت الخادم (ساعة المخزن)');
    eq(JSON.stringify(db.store.scanSessions['sess-golden-2']), sessionBefore, '[جـ] مستند الجلسة لم يتغيّر');
    eq(JSON.stringify(db.store.scanProtocol['scan-golden-before-1']), protoBefore, '[جـ] و«قبل» لم تُمسّ (الحجز لا يُنشأ عند الاختيار)');
    ok(texts(r).includes('replaced=false') && !texts(r).includes('scan-golden') && !texts(r).includes('sess-golden'), '[جـ] سطر النجاح replaced=false بلا معرّف خامّ');
  }

  // ═══ د) مشتقّات (حمولات معدَّلة لا عيّنات مُنتِج، القاعدة 12) ═══
  {
    // «normal» بمفتاح defectType = null: هذا ما يتفاداه التطبيق بإغفال المفتاح
    state.db = freshSessionsDb();
    const derived = {...S.normalNoDefectType, defectType: null};
    const r = await callWire(setSessionPurpose, derived, OWNER);
    eq(r.httpStatus, 400, '[د] مشتقّ: «normal» + defectType null ⟵ HTTP 400');
    deq(r.body, {error: {details: {reasonCode: 'DEFECT_TYPE_NOT_APPLICABLE'}, message: 'DEFECT_TYPE_NOT_APPLICABLE', status: 'INVALID_ARGUMENT'}}, '[د] مشتقّ: DEFECT_TYPE_NOT_APPLICABLE (المفتاح الحاضر يُعدّ مُرسَلاً ولو null)');
    deq(state.db.writes, [], '[د] مشتقّ: لا كتابة');
    ok(!('purpose' in state.db.store.scanSessions['sess-golden-3']), '[د] مشتقّ: الجلسة بلا غرض (لم تُكتب)');
  }
  {
    // «قبل» بلا نوع العطل: المفتاح حامل لمعنى
    state.db = freshSessionsDb();
    const {defectType, ...derived} = S.beforeBattery;
    ok(defectType === 'BATTERY' && !('defectType' in derived), '[د] مشتقّ: نسخة من عيّنة «قبل» بلا defectType');
    const r = await callWire(setSessionPurpose, derived, OWNER);
    eq(r.httpStatus, 400, '[د] مشتقّ: maintenance_before بلا نوع ⟵ HTTP 400');
    eq(r.body && r.body.error && r.body.error.details && r.body.error.details.reasonCode, 'DEFECT_TYPE_REQUIRED', '[د] مشتقّ: DEFECT_TYPE_REQUIRED');
    deq(state.db.writes, [], '[د] مشتقّ: لا كتابة');
  }
  {
    // مفتاح زائد في طلب القائمة والتأكيد: يُقبل ويُتجاهَل
    state.db = makePairDb({
      scanSessions: {'sess-golden-2': {...pendingSession(), purpose: 'maintenance_after'}},
      users: {[OWNER]: {plan: 'shop_pro', protocolParts: {purposes: true, batteryBeforeAfter: true}}},
      protocolSettings: {current: {version: 1, openBeforeValidityHours: 72}},
      protocolPending: {'sess-golden-2': {purposeSource: 'selected', defectType: 'CHARGING_PORT', linkedScanId: null}},
      scanProtocol: {'scan-golden-before-1': beforeProto('CHARGING_PORT')},
      reports: {'scan-golden-before-1': {userId: OWNER, deviceModel: 'SM-A135F'}},
      marketingNames: {current: MAP},
    }, {now: T0});
    const plain = await callWire(listOpenMaintenanceBefores, S.list, OWNER);
    const extra = await callWire(listOpenMaintenanceBefores, {...S.list, unexpectedKey: 1}, OWNER);
    eq(extra.httpStatus, 200, '[د] مشتقّ: القائمة بمفتاح زائد ⟵ HTTP 200 (الخادم لا يرفض المفاتيح الزائدة)');
    deq(extra.body, plain.body, '[د] مشتقّ: وردّها هو ردّ الطلب بلا المفتاح (يُتجاهَل) — فحارس شكل الطلب هو التثبيت في [أ]');
    const extraConfirm = await callWire(confirmMaintenanceAfterLink, {...S.confirm, unexpectedKey: 1}, OWNER);
    eq(extraConfirm.httpStatus, 200, '[د] مشتقّ: التأكيد بمفتاح زائد ⟵ HTTP 200');
    deq(extraConfirm.body, {result: {sessionId: 'sess-golden-2', beforeScanId: 'scan-golden-before-1', linkMethod: 'manual'}}, '[د] مشتقّ: وردّه ردّ التأكيد العادي');
  }

  console.log(`\nmaintenancePairAppRequestSamples.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});

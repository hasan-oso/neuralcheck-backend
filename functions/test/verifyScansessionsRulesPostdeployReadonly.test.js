'use strict';

// verifyScansessionsRulesPostdeployReadonly.test.js — قرار المستخدم 2026-10-07 +03 (الخيار «ب»): فحص ما بعد النشر للقراءة وحدها. هذا الاختبار **بلا شبكة** (fetch مزيَّف
// مُحقَن، وقارئ إدارة مزيَّف، ومخزن ذاكرة في الذاكرة): يغطّي الأجزاء الخالصة (اختيار المعرّف، التهشير بـhashId، تصنيف النتيجة، الحكم، تنقية الأخطاء، فحص الذاكرة المحلّية،
// مسار الذاكرة خارج المستودع) والتنسيق (تسلسل النداءات، إعادة استعمال الحساب، عدم قراءة جسم الـ200، عدم تسرّب سرّ أو معرّف خام).
//
// ما **لا** يغطّيه بلا شبكة (يحسمه تشغيل المستخدم): نصّ رفض القواعد الحرفي على Firestore REST، توفّر الدخول المجهول في المشروع، صلاحية ADC لقراءة scanSessions،
// سلوك انتهاء رمز التحديث، وردّ Firestore الحقيقي على المستند والسرد. وfetch المزيَّف يختبر التنسيق لا الخادم (القاعدة 37 — لا يُدّعى أكثر من ذلك).
//
// Run: node functions/test/verifyScansessionsRulesPostdeployReadonly.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const S = require('../scripts/verify-scansessions-rules-postdeploy-readonly');
const {hashId} = require('../scripts/audit-device-profiles-readonly');
const {CLASSIFICATION: C, VERDICT: V} = S;

const API_KEY = 'AIzaSyFAKE_key_for_unit_test_0123456789abcdef';
const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJ1aWQiOiJ0ZXN0In0.c2lnbmF0dXJl';
const REFRESH = 'AMf-vBFAKEREFRESHTOKENFORUNITTESTONLY';
const RAW_SESSION_ID = 'rawSessionId_ABC123xyz';
const RAW_UID = 'rawAnonUid_9f8e7d6c';
const PROJECT = 'neuralchek-9b6d7';
const DENIED_BODY = JSON.stringify({error: {code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED'}});

// ═══ ١ — تنقية الأخطاء (القاعدة 36) ═══
{
  const t = S.sanitizeErrorText(`fail https://x/y?key=${API_KEY}&a=1 token=${ID_TOKEN} Bearer ${ID_TOKEN} "refreshToken":"${REFRESH}" id_token=${ID_TOKEN}`, [API_KEY, REFRESH]);
  for (const secret of [API_KEY, ID_TOKEN, REFRESH]) ok(!t.includes(secret), `[١] السرّ لا يبقى في النصّ المنقّى (${secret.slice(0, 8)}…)`);
  ok(t.includes('[REDACTED]'), '[١] العلامة موجودة');
  ok(!S.sanitizeErrorText('x'.repeat(1000)).includes('x'.repeat(301)), '[١] تقصير إلى 300');
  ok(!S.sanitizeErrorText(new Error(`oops ${API_KEY}`), [API_KEY]).includes(API_KEY), '[١] كائن Error: رسالته تُنقَّى');
  ok(!S.sanitizeErrorText(`AIza${'a'.repeat(30)}`).includes('AIza'), '[١] نمط مفتاح Google يُحجَب ولو لم يُمرَّر قيمةً');
}

// ═══ ٢ — اختيار معرّف الجلسة ═══
{
  const ts = (ms) => ({toMillis: () => ms});
  deepEq(S.chooseSessionId([{id: 'a', createdAt: 100}, {id: 'b', createdAt: 300}, {id: 'c', createdAt: 200}]), {id: 'b', chosenBy: 'LATEST_CREATED_AT'}, '[٢] الأحدث createdAt (رقم)');
  deepEq(S.chooseSessionId([{id: 'a', createdAt: ts(50)}, {id: 'b', createdAt: new Date(900)}]), {id: 'b', chosenBy: 'LATEST_CREATED_AT'}, '[٢] Timestamp وDate معاً');
  deepEq(S.chooseSessionId([{id: 'zz', createdAt: 5}, {id: 'aa', createdAt: 5}]), {id: 'aa', chosenBy: 'LATEST_CREATED_AT_TIE_SMALLEST_ID'}, '[٢] التعادل: الأصغر نصّاً');
  deepEq(S.chooseSessionId([{id: 'q', createdAt: null}, {id: 'b'}]), {id: 'b', chosenBy: 'NO_CREATED_AT_SMALLEST_ID'}, '[٢] بلا createdAt في كلّها: الأصغر نصّاً');
  deepEq(S.chooseSessionId([{id: 'ok', createdAt: 1}, {id: '', createdAt: 9}, {id: 'a/b', createdAt: 9}, {id: 7, createdAt: 9}, null]), {id: 'ok', chosenBy: 'LATEST_CREATED_AT'}, '[٢] المعرّفات غير الصالحة (فارغ، فيه "/"، غير نصّ، null) تُهمَل');
  eq(S.chooseSessionId([]), null, '[٢] لا مدخل → null (يُعلَن لا يُخترَع)');
  eq(S.chooseSessionId(undefined), null, '[٢] غير مصفوفة → null');
  eq(S.chooseSessionId([{id: 'a/b'}]), null, '[٢] كلّها غير صالحة → null');
}

// ═══ ٣ — التهشير: hashId نفسها (المصدر الواحد) ═══
{
  const h = hashId(RAW_SESSION_ID);
  ok(/^[0-9a-f]{12}$/.test(h), '[٣] hashId: 12 خانة سداسية');
  eq(hashId(RAW_SESSION_ID), h, '[٣] hashId حتمية');
  ok(!h.includes(RAW_SESSION_ID) && h !== RAW_SESSION_ID, '[٣] المهشَّر لا يحمل المعرّف الخام');
  eq(hashId(''), null, '[٣] hashId لمعرّف فارغ = null (لا تهشير لغياب)');
}

// ═══ ٤ — تحليل الجسم وتصنيف النتيجة (بنصّ الرفض لا بالرمز وحده، القاعدة 21) ═══
{
  deepEq(S.parseErrorBody(DENIED_BODY), {errorStatus: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.'}, '[٤] parseErrorBody — كائن');
  deepEq(S.parseErrorBody(`[${DENIED_BODY}]`), {errorStatus: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.'}, '[٤] parseErrorBody — مصفوفة');
  deepEq(S.parseErrorBody('not json'), {errorStatus: null, message: null}, '[٤] جسم غير JSON → حقلان null');
  deepEq(S.parseErrorBody(JSON.stringify({documents: [{name: 'secret'}]})), {errorStatus: null, message: null}, '[٤] جسم بلا error لا يُسرِّب شيئاً');

  const cls = (httpStatus, errorStatus, message) => S.classifyReadResult({httpStatus, errorStatus, message});
  eq(cls(403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.'), C.PERMISSION_DENIED, '[٤] 403 + PERMISSION_DENIED + نصّ القواعد → PERMISSION_DENIED');
  eq(cls(403, 'PERMISSION_DENIED', 'Cloud Firestore API has not been used in project p before or it is disabled.'), C.FORBIDDEN_OTHER, '[٤] 403 بنصّ غير نصّ القواعد (واجهة معطَّلة) → FORBIDDEN_OTHER لا PERMISSION_DENIED');
  eq(cls(403, null, null), C.FORBIDDEN_OTHER, '[٤] 403 بلا جسم مفهوم → FORBIDDEN_OTHER');
  eq(cls(403, 'PERMISSION_DENIED', null), C.FORBIDDEN_OTHER, '[٤] 403 بلا رسالة → FORBIDDEN_OTHER (غياب النصّ لا يُقرأ رفضاً)');
  eq(cls(200, null, null), C.READ_ALLOWED, '[٤] 200 → READ_ALLOWED');
  eq(cls(401, 'UNAUTHENTICATED', 'x'), C.UNAUTHENTICATED, '[٤] 401 → UNAUTHENTICATED');
  eq(cls(404, 'NOT_FOUND', 'x'), C.NOT_FOUND, '[٤] 404 → NOT_FOUND');
  eq(cls(500, null, null), C.OTHER, '[٤] 500 → OTHER');
  eq(cls(null, null, 'NETWORK_ERROR'), C.OTHER, '[٤] غياب httpStatus (شبكة) → OTHER');
  eq(S.classifyReadResult(undefined), C.OTHER, '[٤] غياب النتيجة كلّها → OTHER');
}

// ═══ ٥ — الحكم (القاعدة 22: لا PASS بالغياب) ═══
{
  const v = (...cs) => S.computeVerdict(cs.map((classification) => ({classification})));
  eq(v(C.PERMISSION_DENIED, C.PERMISSION_DENIED), V.PASS, '[٥] الاثنان مرفوضان → PASS');
  eq(v(C.PERMISSION_DENIED, C.READ_ALLOWED), V.FAIL, '[٥] قراءة أُتيحت في أحدهما → FAIL');
  eq(v(C.READ_ALLOWED, C.NOT_FOUND), V.FAIL, '[٥] READ_ALLOWED يغلب أي غموض في الآخر → FAIL');
  eq(v(C.PERMISSION_DENIED, C.NOT_RUN), V.INCONCLUSIVE, '[٥] رفض + لم يُجرَ الآخر → INCONCLUSIVE');
  eq(v(C.PERMISSION_DENIED, C.OTHER), V.INCONCLUSIVE, '[٥] رفض + OTHER → INCONCLUSIVE');
  eq(v(C.FORBIDDEN_OTHER, C.PERMISSION_DENIED), V.INCONCLUSIVE, '[٥] FORBIDDEN_OTHER ليس رفض القواعد → INCONCLUSIVE');
  eq(v(C.PERMISSION_DENIED), V.PASS, '[٥] فحص واحد مرفوض وحده → PASS (التنسيق وحده يضمن الاثنين)');
  eq(S.computeVerdict([]), V.INCONCLUSIVE, '[٥] لا فحوص → INCONCLUSIVE');
  deepEq(S.EXIT_CODE, {PASS: 0, FAIL: 1, INCONCLUSIVE: 2}, '[٥] رموز الخروج');
}

// ═══ ٦ — الروابط ═══
{
  eq(S.buildDocUrl(PROJECT, 'a b/c'), `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/scanSessions/a%20b%2Fc`, '[٦] رابط المستند يُرمَّز معرّفه');
  eq(S.buildListUrl(PROJECT), `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/scanSessions?pageSize=1`, '[٦] رابط السرد بلا فلتر وpageSize=1');
  ok(!S.buildDocUrl(PROJECT, 'x').includes('key=') && !S.buildListUrl(PROJECT).includes('key='), '[٦] روابط Firestore بلا معامل key');
}

// ═══ ٧ — الذاكرة المحلّية: التحقّق، والمسار خارج المستودع ═══
{
  const good = {version: 1, projectId: PROJECT, localId: RAW_UID, refreshToken: REFRESH};
  deepEq(S.parseCachedSession(good, PROJECT), {value: {localId: RAW_UID, refreshToken: REFRESH}, problem: null}, '[٧] ذاكرة صالحة');
  eq(S.parseCachedSession({...good, projectId: 'other'}, PROJECT).problem, 'PROJECT_MISMATCH', '[٧] مشروع مختلف → PROJECT_MISMATCH');
  eq(S.parseCachedSession({...good, version: 2}, PROJECT).problem, 'VERSION_MISMATCH', '[٧] إصدار مختلف → VERSION_MISMATCH');
  eq(S.parseCachedSession({...good, localId: ''}, PROJECT).problem, 'LOCAL_ID_ABSENT', '[٧] localId فارغ');
  eq(S.parseCachedSession({...good, refreshToken: 'x'}, PROJECT).problem, 'REFRESH_TOKEN_ABSENT', '[٧] رمز تحديث قصير/غائب');
  eq(S.parseCachedSession(null, PROJECT).problem, 'NOT_AN_OBJECT', '[٧] null');
  eq(S.parseCachedSession(good, PROJECT).problem, null, '[٧] (تكرار) صالحة بلا مشكلة');

  const home = path.join(os.tmpdir(), 'nc-home-test');
  eq(S.defaultCachePath({}, home), path.join(home, '.neuralcheck', 'postdeploy-anon-session.json'), '[٧] المسار الافتراضي تحت المنزل');
  eq(S.defaultCachePath({NEURALCHECK_POSTDEPLOY_ANON_CACHE: path.join(os.tmpdir(), 'x.json')}, home), path.resolve(path.join(os.tmpdir(), 'x.json')), '[٧] تجاوز بالمتغيّر');

  const repo = path.join(__dirname, '..', '..');
  let threw = false;
  try { S.assertCachePathOutsideRepo(path.join(repo, 'functions', 'scripts', 'cache.json'), repo); } catch (e) { threw = true; }
  ok(threw, '[٧] مسار داخل المستودع مرفوض');
  threw = false;
  try { S.assertCachePathOutsideRepo(repo, repo); } catch (e) { threw = true; }
  ok(threw, '[٧] جذر المستودع نفسه مرفوض');
  eq(S.assertCachePathOutsideRepo(path.join(os.tmpdir(), 'ok.json'), repo), path.join(os.tmpdir(), 'ok.json'), '[٧] مسار خارج المستودع مقبول');

  // مخزن ملفّ حقيقي في مجلّد مؤقّت (لا شبكة)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-anon-cache-'));
  const store = S.buildFsCacheStore(path.join(dir, 'sub', 'c.json'));
  eq(store.read().state, 'ABSENT', '[٧] مخزن: غياب الملفّ → ABSENT');
  store.write(good);
  deepEq(store.read(), {state: 'PRESENT', value: good}, '[٧] مخزن: كتابة ثم قراءة');
  fs.writeFileSync(path.join(dir, 'sub', 'c.json'), '{broken', 'utf8');
  eq(store.read().state, 'UNREADABLE', '[٧] مخزن: ملفّ فاسد → UNREADABLE (يُعلَن لا يُستعمَل)');
  fs.rmSync(dir, {recursive: true, force: true});
}

// ═══ ٨ — التنسيق (runCheck) بـfetch مزيَّف — لا شبكة ═══
function resp(status, bodyObj, extra) {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  const r = {status, jsonCalls: 0, textCalls: 0, bodyCancelled: false, ...(extra || {})};
  r.json = async () => { r.jsonCalls++; return typeof bodyObj === 'string' ? JSON.parse(bodyObj) : bodyObj; };
  r.text = async () => { r.textCalls++; return text; };
  r.body = {cancel: async () => { r.bodyCancelled = true; }};
  return r;
}
function memoryStore(initial) {
  let cur = initial || {state: 'ABSENT', value: null};
  const store = {writes: [], read: () => cur, write: (o) => { store.writes.push(o); cur = {state: 'PRESENT', value: o}; }};
  return store;
}
function harness(opts) {
  const o = opts || {};
  const calls = [];
  const responses = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, method: (init && init.method) || 'GET', headers: (init && init.headers) || {}, body: init && init.body});
    const handler = o.handler(url, init, calls.length);
    if (handler instanceof Error) throw handler;
    responses.push(handler);
    return handler;
  };
  const deps = {
    apiKey: API_KEY, projectId: PROJECT, fetchImpl, nowIso: '2026-10-07T00:00:00+03:00',
    listAdminSessions: o.listAdminSessions || (async () => [{id: RAW_SESSION_ID, createdAt: 1000}]),
    cacheStore: o.cacheStore || memoryStore(),
  };
  return {calls, responses, deps};
}
const isSignUp = (u) => u.includes('accounts:signUp');
const isRefresh = (u) => u.includes('securetoken.googleapis.com');
const isFirestore = (u) => u.includes('firestore.googleapis.com');
const signUpOk = () => resp(200, {idToken: ID_TOKEN, refreshToken: REFRESH, localId: RAW_UID});
const deniedBoth = (u) => (isSignUp(u) ? signUpOk() : resp(403, DENIED_BODY));
const noSecrets = (report, label) => {
  const j = JSON.stringify(report);
  for (const [name, secret] of [['apiKey', API_KEY], ['idToken', ID_TOKEN], ['refreshToken', REFRESH], ['rawSessionId', RAW_SESSION_ID], ['rawUid', RAW_UID]]) {
    ok(!j.includes(secret), `[٨] ${label}: التقرير بلا ${name}`);
  }
};

(async () => {
  // أ — مسار سعيد بلا ذاكرة: حساب مجهول جديد ثم رفضان → PASS
  {
    const h = harness({handler: (u) => deniedBoth(u)});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.PASS, '[٨-أ] PASS');
    eq(r.exitCode, 0, '[٨-أ] رمز الخروج 0');
    deepEq(h.calls.map((c) => `${c.method} ${isSignUp(c.url) ? 'signUp' : (isFirestore(c.url) ? 'firestore' : 'other')}`), ['POST signUp', 'GET firestore', 'GET firestore'], '[٨-أ] التسلسل: signUp ثم قراءتان GET فقط');
    ok(h.calls.filter((c) => isFirestore(c.url)).every((c) => c.method === 'GET'), '[٨-أ] كل نداءات Firestore GET (لا كتابة)');
    ok(h.calls.filter((c) => isFirestore(c.url)).every((c) => c.headers.Authorization === `Bearer ${ID_TOKEN}`), '[٨-أ] قراءتا Firestore بهوية الحساب المجهول (رمز الهوية)');
    ok(h.calls.filter((c) => isFirestore(c.url)).every((c) => !c.url.includes('key=')), '[٨-أ] روابط Firestore بلا مفتاح');
    ok(h.calls[1].url.endsWith(`/scanSessions/${RAW_SESSION_ID}`), '[٨-أ] القراءة الأولى لمستند الجلسة بمعرّفه');
    ok(h.calls[2].url.endsWith('/scanSessions?pageSize=1'), '[٨-أ] القراءة الثانية سرد بلا فلتر');
    deepEq(r.checks.map((c) => c.classification), [C.PERMISSION_DENIED, C.PERMISSION_DENIED], '[٨-أ] التصنيفان');
    eq(r.session.idHash, hashId(RAW_SESSION_ID), '[٨-أ] معرّف الجلسة مُهشَّر بـhashId');
    eq(r.auth.uidHash, hashId(RAW_UID), '[٨-أ] uid مُهشَّر بـhashId');
    eq(r.auth.mode, 'CREATED', '[٨-أ] الحساب أُنشئ');
    deepEq(r.writes, {firestore: 0, authUsersCreated: 1, localCacheFileWritten: true}, '[٨-أ] الكتابات المُعلَنة: Firestore 0، Auth 1، ملفّ الذاكرة');
    eq(h.deps.cacheStore.writes.length, 1, '[٨-أ] الذاكرة كُتبت مرّة');
    noSecrets(r, 'أ');
  }

  // ب — إعادة استعمال الحساب: ذاكرة صالحة → تحديث الرمز بلا إنشاء
  {
    const store = memoryStore({state: 'PRESENT', value: {version: 1, projectId: PROJECT, localId: RAW_UID, refreshToken: REFRESH}});
    const h = harness({cacheStore: store, handler: (u) => (isRefresh(u) ? resp(200, {id_token: ID_TOKEN, user_id: RAW_UID, refresh_token: REFRESH}) : resp(403, DENIED_BODY))});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.PASS, '[٨-ب] PASS');
    eq(r.auth.mode, 'REUSED', '[٨-ب] أُعيد استعمال الحساب');
    ok(!h.calls.some((c) => isSignUp(c.url)), '[٨-ب] لا signUp (لا كتابة في Auth)');
    deepEq(r.writes, {firestore: 0, authUsersCreated: 0, localCacheFileWritten: false}, '[٨-ب] لا كتابة في Auth ولا في الذاكرة');
    eq(store.writes.length, 0, '[٨-ب] الذاكرة لم تُكتب');
    ok(String(h.calls[0].body).includes(`refresh_token=${encodeURIComponent(REFRESH)}`), '[٨-ب] أُرسل رمز التحديث المخزَّن للتبديل');
    noSecrets(r, 'ب');
  }

  // ج — ذاكرة قديمة (رمز منتهٍ): حساب جديد ويُعلَن السبب
  {
    const store = memoryStore({state: 'PRESENT', value: {version: 1, projectId: PROJECT, localId: RAW_UID, refreshToken: REFRESH}});
    const h = harness({cacheStore: store, handler: (u) => (isRefresh(u) ? resp(400, {error: {code: 400, message: 'TOKEN_EXPIRED'}}) : deniedBoth(u))});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.PASS, '[٨-ج] PASS');
    eq(r.auth.mode, 'CREATED', '[٨-ج] حساب جديد');
    eq(r.auth.cacheState, 'PRESENT_STALE:TOKEN_EXPIRED', '[٨-ج] السبب مُعلَن');
    eq(r.writes.authUsersCreated, 1, '[٨-ج] الكتابة في Auth مسجَّلة');
    eq(store.writes.length, 1, '[٨-ج] الذاكرة تُحدَّث');
    noSecrets(r, 'ج');
  }

  // د — ذاكرة فاسدة/من مشروع آخر: تُعلَن ولا تُستعمل
  {
    const store = memoryStore({state: 'PRESENT', value: {version: 1, projectId: 'other-project', localId: RAW_UID, refreshToken: REFRESH}});
    const h = harness({cacheStore: store, handler: (u) => deniedBoth(u)});
    const r = await S.runCheck(h.deps);
    eq(r.auth.cacheState, 'PRESENT_INVALID:PROJECT_MISMATCH', '[٨-د] ذاكرة لمشروع آخر تُعلَن ولا تُستعمل');
    ok(!h.calls.some((c) => isRefresh(c.url)), '[٨-د] لا تبديل رمز بذاكرة غير صالحة');
    const h2 = harness({cacheStore: memoryStore({state: 'UNREADABLE', value: null}), handler: (u) => deniedBoth(u)});
    eq((await S.runCheck(h2.deps)).auth.cacheState, 'UNREADABLE', '[٨-د] ملفّ ذاكرة فاسد يُعلَن UNREADABLE');
  }

  // هـ — فشل تبديل غير مصنَّف (500): INCONCLUSIVE بلا إنشاء حساب (لا كتابة على عطب لم نفهمه)
  {
    const store = memoryStore({state: 'PRESENT', value: {version: 1, projectId: PROJECT, localId: RAW_UID, refreshToken: REFRESH}});
    const h = harness({cacheStore: store, handler: (u) => (isRefresh(u) ? resp(500, {error: {message: `boom key=${API_KEY}`}}) : deniedBoth(u))});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.INCONCLUSIVE, '[٨-هـ] INCONCLUSIVE');
    ok(r.inconclusiveReason.startsWith('ANONYMOUS_AUTH_FAILED: REFRESH_FAILED_UNCLASSIFIED'), '[٨-هـ] السبب مُسمّى');
    ok(!h.calls.some((c) => isSignUp(c.url)) && !h.calls.some((c) => isFirestore(c.url)), '[٨-هـ] لا signUp ولا قراءة Firestore');
    noSecrets(r, 'هـ');
  }

  // و — ثغرة قواعد: 200 على المستند → FAIL، وجسم الردّ لا يُقرأ ولا يظهر
  {
    const leakBody = {name: `projects/${PROJECT}/databases/(default)/documents/scanSessions/${RAW_SESSION_ID}`, fields: {ownerId: {stringValue: 'SECRET-SESSION-DATA'}}};
    let docResp = null;
    const h = harness({handler: (u) => { if (isSignUp(u)) return signUpOk(); if (u.includes(`/scanSessions/${RAW_SESSION_ID}`)) { docResp = resp(200, leakBody); return docResp; } return resp(403, DENIED_BODY); }});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.FAIL, '[٨-و] FAIL');
    eq(r.exitCode, 1, '[٨-و] رمز الخروج 1');
    eq(r.checks[0].classification, C.READ_ALLOWED, '[٨-و] المستند READ_ALLOWED');
    eq(docResp.jsonCalls + docResp.textCalls, 0, '[٨-و] جسم الـ200 لم يُقرأ (لا json() ولا text())');
    eq(docResp.bodyCancelled, true, '[٨-و] جسم الـ200 أُلغي');
    ok(!JSON.stringify(r).includes('SECRET-SESSION-DATA'), '[٨-و] لا بيانات جلسة في التقرير');
    noSecrets(r, 'و');
  }

  // ز — لا جلسة حقيقية: INCONCLUSIVE وبلا أيّ نداء (لا حساب Auth يُنشأ)
  {
    const h = harness({listAdminSessions: async () => [], handler: () => { throw new Error('لا يجب أي نداء'); }});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.INCONCLUSIVE, '[٨-ز] INCONCLUSIVE');
    ok(r.inconclusiveReason.startsWith('NO_REAL_SESSION_FOUND'), '[٨-ز] السبب مُسمّى');
    eq(h.calls.length, 0, '[٨-ز] صفر نداء شبكة (لا كتابة في Auth)');
    deepEq(r.writes, {firestore: 0, authUsersCreated: 0, localCacheFileWritten: false}, '[٨-ز] صفر كتابات');
    eq(r.session, null, '[٨-ز] لا معرّف');
  }

  // ح — فشل قراءة الإدارة (برسالة تحمل سرّاً): INCONCLUSIVE ومنقّاة
  {
    const h = harness({listAdminSessions: async () => { throw new Error(`PERMISSION_DENIED token=${ID_TOKEN} key=${API_KEY}`); }, handler: () => { throw new Error('لا نداء'); }});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.INCONCLUSIVE, '[٨-ح] INCONCLUSIVE');
    ok(r.inconclusiveReason.startsWith('ADMIN_READ_FAILED'), '[٨-ح] السبب مُسمّى');
    eq(h.calls.length, 0, '[٨-ح] لا نداء شبكة قبل نجاح قراءة الإدارة');
    noSecrets(r, 'ح');
  }

  // ط — فشل الدخول المجهول (معطَّل في المشروع): INCONCLUSIVE بسبب مُسمّى
  {
    const h = harness({handler: (u) => (isSignUp(u) ? resp(400, {error: {code: 400, message: 'ADMIN_ONLY_OPERATION'}}) : resp(403, DENIED_BODY))});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.INCONCLUSIVE, '[٨-ط] INCONCLUSIVE');
    ok(r.inconclusiveReason.includes('ANONYMOUS_SIGNUP_FAILED: HTTP 400 ADMIN_ONLY_OPERATION'), '[٨-ط] السبب مُسمّى بنصّ الخطأ');
    eq(r.writes.authUsersCreated, 0, '[٨-ط] لم يُنشأ حساب');
    ok(!h.calls.some((c) => isFirestore(c.url)), '[٨-ط] لا قراءة Firestore بلا حساب');
  }

  // ي — خطأ شبكة في قراءة (رسالته تحمل المفتاح): OTHER، منقّى، INCONCLUSIVE
  {
    const h = harness({handler: (u) => (isSignUp(u) ? signUpOk() : new Error(`fetch failed ${u}?key=${API_KEY} token ${ID_TOKEN}`))});
    const r = await S.runCheck(h.deps);
    eq(r.verdict, V.INCONCLUSIVE, '[٨-ي] INCONCLUSIVE');
    deepEq(r.checks.map((c) => c.classification), [C.OTHER, C.OTHER], '[٨-ي] كلا الفحصين OTHER');
    ok(r.checks.every((c) => c.message.startsWith('NETWORK_ERROR')), '[٨-ي] الرسالة تبدأ NETWORK_ERROR');
    noSecrets(r, 'ي');
  }

  // ك — رفض آخر غير رفض القواعد (واجهة معطَّلة) في أحد الفحصين: INCONCLUSIVE لا PASS
  {
    const h = harness({handler: (u) => { if (isSignUp(u)) return signUpOk(); if (u.includes('pageSize=1')) return resp(403, {error: {code: 403, message: 'Cloud Firestore API has not been used', status: 'PERMISSION_DENIED'}}); return resp(403, DENIED_BODY); }});
    const r = await S.runCheck(h.deps);
    deepEq(r.checks.map((c) => c.classification), [C.PERMISSION_DENIED, C.FORBIDDEN_OTHER], '[٨-ك] التصنيفان');
    eq(r.verdict, V.INCONCLUSIVE, '[٨-ك] INCONCLUSIVE');
  }

  // ═══ ٩ — قارئ الإدارة: لا كتابة، ولا حقل غير createdAt ═══
  {
    const used = [];
    let writes = 0;
    const chain = {
      select: (...f) => { used.push(`select:${f.join(',')}`); return chain; },
      limit: (k) => { used.push(`limit:${k}`); return chain; },
      get: async () => { used.push('get'); return {docs: [{id: 'a', get: (f) => (f === 'createdAt' ? 111 : undefined)}, {id: 'b', get: () => undefined}]}; },
      add: async () => { writes++; }, set: async () => { writes++; }, update: async () => { writes++; }, delete: async () => { writes++; },
    };
    const db = {collection: (name) => { used.push(`collection:${name}`); return chain; }, batch: () => { writes++; }, runTransaction: async () => { writes++; }};
    const entries = await S.buildAdminSessionLister(db)();
    deepEq(used, ['collection:scanSessions', `select:createdAt`, `limit:${S.ADMIN_SESSION_SCAN_LIMIT}`, 'get'], '[٩] القارئ: collection ثم select(createdAt) ثم limit ثم get فقط');
    deepEq(entries, [{id: 'a', createdAt: 111}, {id: 'b', createdAt: undefined}], '[٩] المخرَج {id, createdAt} وحدهما');
    eq(writes, 0, '[٩] لا استدعاء كتابة');
    // الغلاف wrapReadOnly فعّال: محاولة كتابة عبره تُرمى (لا تصل db)
    const {wrapReadOnly} = require('../scripts/audit-device-profiles-readonly');
    let trapped = false;
    try { wrapReadOnly(db).collection('scanSessions').add({}); } catch (e) { trapped = /TRAP/.test(e.message); }
    ok(trapped && writes === 0, '[٩] wrapReadOnly يرمي TRAP على الكتابة (الغلاف الذي يستعمله القارئ)');
  }

  // ═══ ١٠ — المصدر: لا استدعاء كتابة Firestore في الكود، ولا نسخة قائمة ثانية، والنسخة الكاتبة حُذفت ═══
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-scansessions-rules-postdeploy-readonly.js'), 'utf8');
    const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(!/\.(set|update|delete|add|batch|runTransaction)\(/.test(code), '[١٠] لا استدعاء set/update/delete/add/batch/runTransaction في الكود (خارج التعليقات)');
    ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'[^}]*firestore/.test(code), '[١٠] لا طلب كتابة نحو Firestore');
    ok(code.includes("require('./audit-device-profiles-readonly')") && !/function hashId\b/.test(code), '[١٠] hashId وwrapReadOnly مستوردتان (المصدر الواحد) لا منسوختان');
    ok(!fs.existsSync(path.join(__dirname, '..', 'scripts', 'verify-scansessions-rules-postdeploy.js')), '[١٠] النسخة الكاتبة (الخيار أ) محذوفة — لا قارئ لها (git grep: صفر خارج نفسها)');
  }

  console.log(`\nverifyScansessionsRulesPostdeployReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });

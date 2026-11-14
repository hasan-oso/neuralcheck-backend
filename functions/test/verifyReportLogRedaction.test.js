'use strict';

// verifyReportLogRedaction.test.js — تنقية سجلّات verifyReport (البند ٤-ب، 2026-10-18 +03).
//
// القاعدة 36 وقرار المستخدم (V8 الدفعة ١، 2026-10-08): «المعرّفات مُهشَّرة». verifyReport onRequest **عامّة**: قيمة `?scanId=` يكتبها أيّ زائر (shortId العلني أو scanId UUID) فكان
// `console.log("verifyReport — input:", inputId, "upper:", upperId)` يطبعها خامّةً، ومعها `shortId query … for:` و`fallback with prefix:` و`not found for:` و`found … shortId:`.
// الاختبار يشغّل المعالج الحقيقي (utils/admin وحده مستبدَل بـdb من الذاكرة — القاعدة 37 معلَنة) ويلتقط console.* ويبحث نصّياً عن القيم الخامّة. صفر شبكة وصفر محاكٍ.
//
// Run: node functions/test/verifyReportLogRedaction.test.js

const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const store = {};
let queryDocs = [];
const snapOf = (id, data) => ({id, exists: data !== undefined, data: () => data});
const fakeDb = {
  collection: () => {
    const q = {where: () => q, limit: () => q, get: async () => ({empty: queryDocs.length === 0, size: queryDocs.length, docs: queryDocs})};
    return {doc: (id) => ({get: async () => snapOf(id, store[id])}), where: q.where, limit: q.limit, get: q.get};
  },
};
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: {firestore: {}}, db: fakeDb, ADMIN_EMAILS: [], requireAdmin: () => {}, isVerifiedAdmin: () => false},
};
const {verifyReport} = require('../src/reports/verifyReport');
const {hashIdForLog} = require('../src/utils/logRedaction');

async function call(scanId, ip) {
  let status = null; let body = null;
  const res = {
    status(s) { status = s; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; },
    set() { return this; }, setHeader() {}, getHeader() { return undefined; }, removeHeader() {}, on() { return this; }, once() { return this; }, emit() {}, end() {}, headersSent: false,
  };
  const req = {method: 'GET', query: {scanId}, headers: {}, ip, get: () => ''};
  const real = {log: console.log, warn: console.warn, error: console.error};
  const lines = [];
  for (const k of Object.keys(real)) console[k] = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  let thrown = null;
  try { await verifyReport(req, res); } catch (e) { thrown = e; } finally { Object.assign(console, real); }
  return {lines, text: lines.join('\n'), status, body, thrown};
}

(async () => {
  const HEX12 = /^#[0-9a-f]{12}$/;

  // ═══ ١ — مُدخل shortId بلا بادئة، لا مستند ولا تقرير: كل أسطر الإدخال تُطبع (المسار 404) ═══
  {
    const RAW = 'ab12cd34ef';
    const UPPER = RAW.toUpperCase();
    const WITH_PREFIX = `NC-${UPPER}`;
    queryDocs = [];
    const cap = await call(RAW, '203.0.113.1');
    ok(!cap.thrown, `[١] المعالج لا يرمي: ${cap.thrown && cap.thrown.message}`);
    eq(cap.status, 404, '[١] رمز الحالة 404 كما كان');
    eq(JSON.stringify(cap.body), JSON.stringify({error: 'not_found'}), '[١] شكل الردّ للعميل لم يتغيّر');
    const inputLine = cap.lines.find((l) => l.startsWith('verifyReport — input:'));
    ok(!!inputLine, '[١] سطر `verifyReport — input:` ما زال يُطبع (نصّه باقٍ)');
    ok(/ upper: /.test(inputLine), '[١] كلمة `upper:` باقية في السطر');
    eq(inputLine, `verifyReport — input: ${hashIdForLog(RAW)} upper: ${hashIdForLog(UPPER)}`, '[١] السطر = المُدخل مُهشَّراً بـhashIdForLog، لا غير');
    // الغياب الخام في كل ما التُقط (القاعدة 22: لا نجاح من غياب السطر — السطر موجود أعلاه).
    for (const raw of [RAW, UPPER, WITH_PREFIX, RAW.toLowerCase()]) {
      ok(!cap.text.includes(raw), `[١] القيمة الخامّة «${raw}» لا ترد في أيّ سطر سجلّ`);
    }
    ok(cap.lines.some((l) => l.startsWith('verifyReport — shortId query size:')), '[١] سطر shortId query طُبع (الاختبار يمرّ به)');
    ok(cap.lines.some((l) => l.startsWith('verifyReport — fallback with prefix:')), '[١] سطر fallback with prefix طُبع');
    ok(cap.lines.some((l) => l.startsWith('verifyReport — not found for:')), '[١] سطر not found for طُبع');
  }

  // ═══ ٢ — مُدخل UUID (scanId) غير موجود ═══
  {
    const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
    queryDocs = [];
    const cap = await call(UUID, '203.0.113.2');
    eq(cap.status, 404, '[٢] 404');
    ok(!cap.text.includes(UUID) && !cap.text.includes(UUID.toUpperCase()), '[٢] scanId UUID المُدخَل لا يرد خامّاً في أيّ سطر');
    ok(cap.text.includes(hashIdForLog(UUID)), '[٢] وتصل صيغته المُهشَّرة (السطر يحمل ما يلزم للارتباط)');
  }

  // ═══ ٣ — تقرير موجود بـshortId: سطر found يبقى بصيغته للقارئ الخارجي، وshortId فيه مُهشَّر ═══
  {
    const SHORT = 'NC-9A8B7C6D';
    const DOC = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    store[DOC] = {shortId: SHORT, pipeline: 'unknown-tag-for-test'};
    queryDocs = [snapOf(DOC, store[DOC])];
    const cap = await call(SHORT.toLowerCase(), '203.0.113.3');
    ok(!cap.text.includes(SHORT) && !cap.text.includes(SHORT.toLowerCase()), '[٣] shortId لا يرد خامّاً في أيّ سطر');
    ok(!cap.text.includes(DOC), '[٣] ولا معرّف المستند (scanId) خامّاً');
    const found = cap.lines.find((l) => l.startsWith('verifyReport — found:'));
    ok(!!found, '[٣] سطر `verifyReport — found:` طُبع');
    // القارئ الخارجي: tools-scanid-log-check.js يقرأ /verifyReport \S{1,3} found:\s+(\S+)/ — الرمز الأول بعد «found:» هاش.
    const m = /^verifyReport \S{1,3} found: (\S+) shortId: (\S+) pipeline: /.exec(found);
    ok(!!m, `[٣] صيغة سطر found محفوظة للقارئ الخارجي: ${found}`);
    ok(m && HEX12.test(m[1]), '[٣] الرمز الأول بعد found: هاش #<12 سداسياً>');
    eq(m && m[1], hashIdForLog(DOC), '[٣] وهو هاش معرّف المستند');
    eq(m && m[2], hashIdForLog(SHORT), '[٣] وshortId مُهشَّر بالمنقّي نفسه');
  }

  console.log(`verifyReportLogRedaction.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });

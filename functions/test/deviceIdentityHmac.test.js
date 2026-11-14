'use strict';

// deviceIdentityHmac.test.js — الجزء الممكن على الخادم من S-P6-01 بلا السرّ (2026-10-18 +03؛ القاعدتان 22 و36): HMAC للمعرّف وحالة المفتاح الصريحة.
//
// **لا مفتاح حقيقي ولا شبكة:** كل مفتاح هنا **وهميّ مكتوب في الاختبار** (متّجهات معروفة)، والبيئة تُمرَّر كائناً (وإلا process.env مع استعادتها). لا نداء إلى Secret Manager ولا gcloud.
//
// ما يثبّته:
//   أ) **المتّجهات المرجعية** (مستقلّة عن الكود): RFC 4231 الحالة 2 («Jefe») ومتّجه HMAC_SHA256 المعروف («key» / الثعلب) — فالدالّة SHA-256 والمفتاح نصّ UTF-8 كما هو؛ ويختلف عن SHA-256 العادي لنفس المُدخل.
//   ب) حالة المفتاح: كل غياب صريح بسببه (غير مضبوط · null · ليس نصّاً · فارغ · فراغات وحدها) ولا يُقبَل مفتاح فارغ.
//   جـ) حالة المُدخل: تجزئة التطبيق الغائبة/غير النصّية/الفارغة، والقيم الحارسة الستّ كلّها (لا HMAC لحارس: تصادم بين أجهزة)، والعادية تُحسب.
//   د) **لا تسرّب:** المفتاح لا يظهر في JSON.stringify ولا util.inspect ولا الخاصّيات ولا نتيجة applyIdentifierHmac، والملفّ لا يستعمل console ولا الشبكة ولا Secret Manager.
//   هـ) المصدر الواحد: اسم السرّ كما في العقد (E4)، والقيم الحارسة كما في الملفّات التي تقرؤها، ومفردة HMAC_KEY_UNAVAILABLE هي نفسها مفردة البروتوكول.
//
// Run: node functions/test/deviceIdentityHmac.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
const H = require('../src/profiles/deviceIdentityHmac');
const {IDENTITY_STATE} = require('../src/protocol/protocolVocabulary');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const NAME = 'DEVICE_ID_HMAC_KEY';
const SRC = path.join(__dirname, '..', 'src', 'profiles', 'deviceIdentityHmac.js');
const envWith = (v) => ({[NAME]: v});
const HEX64 = /^[0-9a-f]{64}$/;

// ═══ أ) المتّجهات المرجعية ═══════════════════════════════════════════════════════════════════════════════════════
{
  // RFC 4231 §4.3 الحالة 2: المفتاح «Jefe» والبيانات «what do ya want for nothing?»
  const h2 = H.getHmacHasher(envWith('Jefe'));
  eq(h2.available, true, '[أ] مفتاح «Jefe»: متوفّر');
  eq(applyOk(h2, 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', '[أ] RFC 4231 الحالة 2: HMAC-SHA256 بالمفتاح كنصّ مباشر');
  // متّجه معروف (HMAC_SHA256("key", "The quick brown fox jumps over the lazy dog"))
  const hk = H.getHmacHasher(envWith('key'));
  eq(applyOk(hk, 'The quick brown fox jumps over the lazy dog'), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', '[أ] المتّجه المعروف: HMAC-SHA256("key", الثعلب)');
  // يختلف عن SHA-256 العادي (لا تجزئة بلا مفتاح)، وعن SHA-1 (الدالّة SHA-256: 64 سداسياً لا 40)
  const data = 'a'.repeat(64);
  const out = applyOk(hk, data);
  ok(HEX64.test(out), '[أ] المخرَج 64 محرفاً سداسياً صغيراً (SHA-256)');
  ok(out !== crypto.createHash('sha256').update(data).digest('hex'), '[أ] ويختلف عن SHA-256 العادي لمُدخله');
  eq(out, applyOk(H.getHmacHasher(envWith('key')), data), '[أ] ثابت: المفتاح والمُدخل نفسهما ⟵ القيمة نفسها (يُطابَق به لاحقاً)');
  ok(out !== applyOk(H.getHmacHasher(envWith('key2')), data), '[أ] مفتاح آخر ⟵ قيمة أخرى');
  ok(out !== applyOk(hk, `${data}b`), '[أ] مُدخل آخر ⟵ قيمة أخرى');
  eq([H.HMAC_ALGORITHM, H.HMAC_KEY_ENV_NAME], ['sha256', NAME], '[أ] الدالّة sha256 [اجتهاد معلَن]، واسم السرّ DEVICE_ID_HMAC_KEY (E4)');
}
function applyOk(hasher, input) {
  const r = H.applyIdentifierHmac(hasher, input);
  assert.strictEqual(r.state, H.IDENTIFIER_HMAC_STATE.COMPUTED, `applyOk: ${JSON.stringify(r)}`);
  return r.hmac;
}

// ═══ ب) حالة المفتاح ════════════════════════════════════════════════════════════════════════════════════════════
{
  const R = H.HMAC_KEY_UNAVAILABLE_REASON;
  eq(Object.values(R), ['NOT_SET', 'NOT_A_STRING', 'EMPTY'], '[ب] الأسباب الثلاثة');
  const cases = [
    ['{} (غير مضبوط)', {}, R.NOT_SET], ['undefined صراحةً', envWith(undefined), R.NOT_SET], ['null', envWith(null), R.NOT_SET],
    ['رقم', envWith(12345), R.NOT_A_STRING], ['كائن', envWith({k: 'v'}), R.NOT_A_STRING], ['منطقي', envWith(true), R.NOT_A_STRING], ['مصفوفة', envWith(['abc']), R.NOT_A_STRING],
    ['نصّ فارغ', envWith(''), R.EMPTY], ['فراغات', envWith('   '), R.EMPTY], ['سطر جديد وحده', envWith('\n'), R.EMPTY], ['تبويب وسطر', envWith('\t\r\n'), R.EMPTY],
  ];
  for (const [label, env, reason] of cases) {
    const h = H.getHmacHasher(env);
    eq([h.available, h.state, h.reason, typeof h.hmacHex], [false, IDENTITY_STATE.HMAC_KEY_UNAVAILABLE, reason, 'undefined'], `[ب] ${label}: HMAC_KEY_UNAVAILABLE بسبب ${reason}، ولا حاسب`);
    const r = H.applyIdentifierHmac(h, 'a'.repeat(64));
    eq(r, {state: IDENTITY_STATE.HMAC_KEY_UNAVAILABLE, hmac: null, reason}, `[ب] ${label}: applyIdentifierHmac تُعيد الحالة نفسها بلا HMAC (لا HMAC بمفتاح مُختلَق ولا بدونه)`);
  }
  // env غير كائن: لا استثناء، والحالة صريحة
  for (const bad of [null, undefined, 'x', 5]) {
    const h = H.getHmacHasher(bad === undefined ? process.env : bad);
    ok(h.available === false || bad === undefined, `[ب] env=${JSON.stringify(bad)}: لا استثناء`);
  }
  eq(H.getHmacHasher(null).reason, R.NOT_SET, '[ب] env=null ⟵ NOT_SET');
  // مفتاح بفراغات حول نصّ: يُقبل كما هو (بلا قصّ: القصّ يغيّر المفتاح)
  const padded = H.getHmacHasher(envWith('  key  '));
  eq(padded.available, true, '[ب] مفتاح بفراغات حول نصّ: متوفّر');
  ok(applyOk(padded, 'x'.repeat(64)) !== applyOk(H.getHmacHasher(envWith('key')), 'x'.repeat(64)), '[ب] ولا يُقصّ: المفتاح بفراغاته غير المفتاح بلا فراغات');
  // مفتاح غير ASCII: UTF-8
  const utf = H.getHmacHasher(envWith('مفتاح-اختبار-وهمي'));
  eq(applyOk(utf, 'x'.repeat(64)), crypto.createHmac('sha256', Buffer.from('مفتاح-اختبار-وهمي', 'utf8')).update('x'.repeat(64)).digest('hex'), '[ب] مفتاح عربي: بترميز UTF-8');
  // hasher غير صالح يُمرَّر إلى applyIdentifierHmac: حالة صريحة لا استثناء
  for (const bad of [undefined, null, {}, {available: false}, {available: 'yes'}, 'hasher']) {
    eq(H.applyIdentifierHmac(bad, 'a'.repeat(64)).state, IDENTITY_STATE.HMAC_KEY_UNAVAILABLE, `[ب] hasher=${JSON.stringify(bad)}: HMAC_KEY_UNAVAILABLE لا استثناء`);
  }
  eq(H.applyIdentifierHmac({available: false}, 'a'.repeat(64)).reason, R.NOT_SET, '[ب] hasher بلا سبب: NOT_SET');
}

// ═══ جـ) حالة المُدخل ══════════════════════════════════════════════════════════════════════════════════════════
{
  const S = H.IDENTIFIER_HMAC_STATE;
  const h = H.getHmacHasher(envWith('test-only-fake-key-not-a-secret'));
  eq(Object.values(S), ['COMPUTED', IDENTITY_STATE.HMAC_KEY_UNAVAILABLE, 'INPUT_MISSING', 'INPUT_IS_GUARD_VALUE'], '[جـ] حالات النتيجة الأربع');
  for (const [label, input, reason] of [['undefined', undefined, 'ABSENT'], ['null', null, 'ABSENT'], ['رقم', 5, 'NOT_A_STRING'], ['كائن', {}, 'NOT_A_STRING'], ['مصفوفة', ['a'], 'NOT_A_STRING'], ['فارغ', '', 'EMPTY'], ['فراغات', '   ', 'EMPTY']]) {
    eq(H.applyIdentifierHmac(h, input), {state: S.INPUT_MISSING, hmac: null, reason}, `[جـ] مُدخل ${label}: INPUT_MISSING (${reason}) بلا HMAC`);
  }
  // القيم الحارسة الستّ: كلّها مرفوضة بقيمتها الحرفية
  eq(Object.values(H.LAYER_GUARD_VALUES).sort(), ['no_android_id', 'no_fid', 'no_keystore', 'no_sensors', 'unknown', 'unknown_fp'], '[جـ] القيم الحارسة الستّ (مكتوبة باليد)');
  for (const [layer, guard] of Object.entries(H.LAYER_GUARD_VALUES)) {
    eq(H.applyIdentifierHmac(h, guard), {state: S.INPUT_IS_GUARD_VALUE, hmac: null, reason: 'GUARD_VALUE'}, `[جـ] ${layer}=${guard}: حارس ⟵ لا HMAC (يتّفق عليه كل جهاز عجز، فمعرّفه المشترك تصادم)`);
  }
  // الحارس بحروف مختلفة أو بفراغات ليس حارساً حرفياً: يُحسب (التطبيق لا يكتب غير الحرفي)، وهو تحفّظ معلَن
  for (const near of ['NO_ANDROID_ID', 'no_android_id ', 'No_Android_Id']) {
    eq(H.applyIdentifierHmac(h, near).state, S.COMPUTED, `[جـ] «${near}» ليس الحارس الحرفي: يُعامَل قيمة عادية (المطابقة حرفية)`);
  }
  // العادية
  const normal = H.applyIdentifierHmac(h, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  eq([normal.state, normal.reason, HEX64.test(normal.hmac)], [S.COMPUTED, null, true], '[جـ] تجزئة SHA-256 عادية: COMPUTED، وreason=null، وHMAC سداسي 64');
  eq(Object.keys(normal).sort(), ['hmac', 'reason', 'state'], '[جـ] النتيجة ثلاثة مفاتيح لا غير (لا المفتاح ولا المُدخل)');
  ok(!JSON.stringify(normal).includes('e3b0c442'), '[جـ] ولا يظهر المُدخل في النتيجة');
}

// ═══ د) لا تسرّب ═══════════════════════════════════════════════════════════════════════════════════════════════
{
  const KEY = 'SECRET-LOOKING-FAKE-KEY-MATERIAL-12345';
  const h = H.getHmacHasher(envWith(KEY));
  const probes = [JSON.stringify(h), util.inspect(h, {showHidden: true, depth: 5}), String(h), Object.keys(h).join(), Object.getOwnPropertyNames(h).join(),
    JSON.stringify(Object.getOwnPropertySymbols(h).map(String)), util.inspect(h.hmacHex, {showHidden: true, depth: 5}), JSON.stringify(H.applyIdentifierHmac(h, 'a'.repeat(64))), JSON.stringify(H)];
  for (const [i, p] of probes.entries()) ok(!p.includes(KEY) && !p.includes(Buffer.from(KEY).toString('hex')) && !p.includes(Buffer.from(KEY).toString('base64')), `[د] المسبار ${i}: لا يحمل المفتاح (نصّاً ولا hex ولا base64)`);
  eq(Object.keys(h).sort(), ['available', 'hmacHex'], '[د] الحاسب خاصّيتان: available وhmacHex (لا key)');
  ok(Object.isFrozen(h), '[د] الحاسب مُجمَّد (لا يُعدَّل من الخارج)');
  // لا طباعة في أيّ مآل
  const lines = [];
  const orig = {log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug};
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.join(' '));
  try {
    H.applyIdentifierHmac(h, 'a'.repeat(64));
    H.applyIdentifierHmac(h, 'no_android_id');
    H.applyIdentifierHmac(h, undefined);
    H.applyIdentifierHmac(H.getHmacHasher({}), 'a'.repeat(64));
    H.getHmacHasher(envWith(KEY));
  } finally {
    Object.assign(console, orig);
  }
  eq(lines, [], '[د] لا سطر سجلّ في أيّ مآل (القاعدة 36: لا مفتاح ولا معرّف في سجلّ)');
  // المصدر: لا console ولا شبكة ولا Secret Manager ولا gcloud
  const src = fs.readFileSync(SRC, 'utf8');
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  for (const banned of ['console.', 'fetch(', 'require("http', "require('http", 'require("https', "require('https", 'secretmanager', 'SecretManager', 'gcloud', 'child_process', 'process.stdout', 'process.stderr', 'fs.']) {
    ok(!code.includes(banned), `[د] المصدر لا يحتوي «${banned}» في سطر كود`);
  }
  eq((code.match(/require\(/g) || []).length, 3, '[د] ثلاثة مستوردات فقط: crypto ومفردة البروتوكول وUNKNOWN_PRIMARY');
}

// ═══ هـ) المصدر الواحد ═════════════════════════════════════════════════════════════════════════════════════════
{
  const contract = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'PROTOCOL_CONTRACT.md'), 'utf8');
  ok(contract.includes('`DEVICE_ID_HMAC_KEY`'), '[هـ] اسم السرّ في العقد (E4) كما في الكود');
  eq(H.HMAC_KEY_ENV_NAME, 'DEVICE_ID_HMAC_KEY', '[هـ] الثابت = الاسم المعتمد');
  const find = fs.readFileSync(path.join(__dirname, '..', 'src', 'profiles', 'findDeviceProfile.js'), 'utf8');
  const create = fs.readFileSync(path.join(__dirname, '..', 'src', 'profiles', 'createDeviceProfile.js'), 'utf8');
  const keyReader = fs.readFileSync(path.join(__dirname, '..', 'src', 'profiles', 'deviceProfileKey.js'), 'utf8');
  for (const guard of ['no_keystore', 'no_fid', 'no_android_id']) ok(find.includes(`"${guard}"`) && create.includes(`"${guard}"`), `[هـ] الحارس «${guard}» حرفياً في findDeviceProfile وcreateDeviceProfile`);
  for (const guard of ['unknown', 'no_sensors']) ok(find.includes(`"${guard}"`) && create.includes(`"${guard}"`), `[هـ] الحارس «${guard}» حرفياً في findDeviceProfile وcreateDeviceProfile`);
  ok(keyReader.includes('"unknown_fp"'), '[هـ] الحارس «unknown_fp» حرفياً في deviceProfileKey.js (UNKNOWN_PRIMARY)');
  const {UNKNOWN_PRIMARY} = require('../src/profiles/deviceProfileKey');
  eq(H.LAYER_GUARD_VALUES.primary, UNKNOWN_PRIMARY, '[هـ] حارس الأساسي = UNKNOWN_PRIMARY المُصدَّر');
  eq(H.IDENTIFIER_HMAC_STATE.HMAC_KEY_UNAVAILABLE, IDENTITY_STATE.HMAC_KEY_UNAVAILABLE, '[هـ] HMAC_KEY_UNAVAILABLE هي مفردة البروتوكول نفسها');
  eq(IDENTITY_STATE.HMAC_KEY_UNAVAILABLE, 'HMAC_KEY_UNAVAILABLE', '[هـ] وقيمتها حرفياً');
}

// ═══ و) process.env الحقيقية (الافتراضي): تُضبط بمفتاح وهمي ثم تُستعاد ═══════════════════════════════════════════════
{
  const before = Object.prototype.hasOwnProperty.call(process.env, NAME) ? process.env[NAME] : undefined;
  try {
    delete process.env[NAME];
    eq(H.getHmacHasher().available, false, '[و] process.env بلا السرّ: غير متوفّر (كما في الإنتاج قبل ربط السرّ)');
    eq(H.getHmacHasher().reason, 'NOT_SET', '[و] وسببه NOT_SET');
    process.env[NAME] = 'process-env-fake-key-for-test-only';
    const h = H.getHmacHasher();
    eq(h.available, true, '[و] process.env بمفتاح وهمي: متوفّر');
    eq(applyOk(h, 'a'.repeat(64)), crypto.createHmac('sha256', Buffer.from('process-env-fake-key-for-test-only')).update('a'.repeat(64)).digest('hex'), '[و] ويحسب بما في process.env');
  } finally {
    if (before === undefined) delete process.env[NAME]; else process.env[NAME] = before;
  }
}

console.log(`\ndeviceIdentityHmac.test.js: ${n}/${n} assertions passed`);

'use strict';

// failureTextSitesAI.test.js — سلوك مواضع التنقية في سلسلة المزوّد (A-SUB الموجة الأولى، البند ١٣، 2026-10-17 +03). صفر شبكة وصفر محاكٍ وصفر Firestore وصفر مفتاح حقيقي.
//
// القاعدة 36: نصّ خطأ المزوّد قد يحمل سرّاً (طرف مفتاح، مسار مستند بمعرّفه). المواضع هنا: callDeepSeek (شبكة، جسم HTTP، خطأ داخل 200) · callGemini · callAI (primaryError و«Both failed»)
// · languageValidator.fixLeaksTargeted · resolveV7Report (HARD_FAILURE و PROVIDER_FAILED_NO_FALLBACK المخزَّنان في audit) · runAnalysisInternal (aiFallbackReason المكتوب في التقرير + السطر + سطر findDeviceProfile).
//
// **الاستبدال (القاعدة 37) معلَن:** globalThis.fetch (يرمي أو يعيد جسماً مبنيّاً) · مكتبة @google/generative-ai (تُرمى منها رسالة مبنيّة) · utils/admin (فخّ Firestore) · resolveGeminiFallbackConfig (الراية) ·
// profiles/findDeviceProfile في موضع واحد فقط (سطر runAnalysisInternal). **الطبقات التي قد ترفض/تُنقّي كلّها حقيقية:** callDeepSeek وcallGemini وcallAI وresolveV7Report وrunAnalysisInternal وfailureText.
// أشكال الأخطاء **مبنيّة** بيد هذا الاختبار (لا مأخوذة من مزوّد حقيقي): TypeError «fetch failed» بسبب شبكة، وجسم 401 بصياغة عامّة، وخطأ SDK بصياغة عامّة — كلّها تحمل معرّفاً ومفتاحاً **مختلَقَين** من هذا الملفّ.
//
// Run: node functions/test/failureTextSitesAI.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── السرّ المبنيّ: يجب ألّا يظهر في أيّ سطر ولا خطأ مرمي ولا حقل مكتوب ───
const SCAN = 'f3b2c1d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const LONG = `sk-${'A1b2C3d4'.repeat(5)}`; // 43 محرفاً: رمز طويل (لا يلتقطه إلا نمط الرمز الطويل)
const KEYPHRASE = 'sk-REALSECRET1234567890'; // يلتقطه نمط «api_key: …»
const hostile = (tag) => `${tag}-DIAG api_key: ${KEYPHRASE} at projects/p/databases/(default)/documents/reports/${SCAN} bearer ${LONG}`;
const isClean = (text) => !text.includes(KEYPHRASE) && !text.includes(SCAN) && !text.includes(LONG);
const mkErr = (msg, extra = {}) => Object.assign(new Error(msg), extra);

// ─── الاستبدالات المعلَنة ──────────────────────────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};
let geminiEnabled = false;
const geminiCfgPath = require.resolve('../src/utils/resolveGeminiFallbackConfig');
require.cache[geminiCfgPath] = {
  id: geminiCfgPath, filename: geminiCfgPath, loaded: true,
  exports: {
    resolveGeminiFallbackConfig: async () => ({enabled: geminiEnabled, source: 'test-stub'}),
    clearGeminiFallbackConfigCache: () => {}, DEFAULT_GEMINI_FALLBACK_ENABLED: false,
  },
};
let geminiThrow = null;
let geminiResult = null;
let geminiCalls = 0;
const sdkPath = require.resolve('@google/generative-ai');
require.cache[sdkPath] = {
  id: sdkPath, filename: sdkPath, loaded: true,
  exports: {
    GoogleGenerativeAI: class {
      getGenerativeModel() { return {generateContent: async () => { geminiCalls++; if (geminiThrow) throw geminiThrow; return geminiResult; }}; }
    },
  },
};
let fetchBehavior = async () => { throw new Error('TRAP: fetch not configured'); };
let fetchCalls = 0;
global.fetch = async (url, opts) => {
  fetchCalls++;
  if (!String(url).includes('api.deepseek.com')) throw new Error(`TRAP: unexpected host ${url}`);
  return fetchBehavior(url, opts);
};
let findProfileThrow = null;
const findProfilePath = require.resolve('../src/profiles/findDeviceProfile');
require.cache[findProfilePath] = {
  id: findProfilePath, filename: findProfilePath, loaded: true,
  exports: {findDeviceProfile: async () => { throw findProfileThrow; }},
};

const {callDeepSeek} = require('../src/analysis/callDeepSeek');
const {callGeminiFallback} = require('../src/analysis/callGemini');
// تمرير قابل للتبديل (استبدال معلَن، القاعدة 37) على طبقتين فقط، **لإدخال خطأ خامّ غير موسوم** عند موضعَين تنقّيان بنفسيهما: callAIv7 داخل resolveV7Report، وresolveV7Report داخل runAnalysisInternal.
// بلا ذلك لا يصل إلى هذين الموضعين إلا أخطاء مسبوقة بتنقية المنشأ (موسومة)، فيصير إزالة تنقيتهما طفرة مكافئة لا يكشفها اختبار. الافتراضي: الدالّة الحقيقية.
const callAIReal = require('../src/analysis/callAI');
const {callAIv7} = callAIReal;
let callAIv7Override = null;
const callAIPath = require.resolve('../src/analysis/callAI');
require.cache[callAIPath].exports = {...callAIReal, callAIv7: (...a) => (callAIv7Override ? callAIv7Override(...a) : callAIReal.callAIv7(...a))};
const {fixLeaksTargeted} = require('../src/analysis/languageValidator');
const resolveV7ReportReal = require('../src/analysis/resolveV7Report');
const {resolveV7Report} = resolveV7ReportReal;
let resolveV7ReportOverride = null;
const resolveV7Path = require.resolve('../src/analysis/resolveV7Report');
require.cache[resolveV7Path].exports = {...resolveV7ReportReal, resolveV7Report: (...a) => (resolveV7ReportOverride ? resolveV7ReportOverride(...a) : resolveV7ReportReal.resolveV7Report(...a))};
const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const loadGolden = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
const B45_REJECTED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'frozen-real-envelope-b45c8cf6-rejected-2026-09-23.json'), 'utf8')).rawEnvelope;
const s10Raw = loadGolden('b45c8cf6.ts.json');
const ts = s10Raw.timeSeries || s10Raw;
const s10Functional = loadGolden('functionalResults-by-scanid.json').byScanId['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const fingerprint = {
  device: {model: 'SM-G977B', manufacturer: 'samsung'},
  timeSeries: {header: ts.header, footer: ts.footer, samples: ts.samples, variables: ts.variables},
  functionalResults: s10Functional, manualResults: [],
};
const findings = computeFindings(fingerprint);
const battery = sampleInputsFromRaw(fingerprint);
const categoryStates = computeCategoryStates({
  functionalResults: fingerprint.functionalResults, manualResults: fingerprint.manualResults,
  dev: null, findings, batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
});
const v7Params = (extra = {}) => ({
  findings, categoryStates, language: 'ar', scanContext: {scanId: SCAN, isFreeTrial: false}, previousScan: null,
  deepseekApiKey: 'NOT-A-REAL-KEY', geminiApiKey: 'NOT-A-REAL-KEY', ...extra,
});

/** يلتقط كل ما يطبعه fn، ويُعيد {lines, value, thrown}. */
async function capture(fn) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  const lines = [];
  for (const k of Object.keys(real)) console[k] = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  let value; let thrown = null;
  try { value = await fn(); } catch (e) { thrown = e; } finally { Object.assign(console, real); }
  return {lines, value, thrown};
}
const joined = (cap) => cap.lines.join('\n');

(async () => {
  // ═══ ١ — callDeepSeek: ثلاثة مواضع (شبكة، جسم HTTP، خطأ داخل 200) ═══
  {
    fetchBehavior = async () => { throw mkErr(`fetch failed: ${hostile('NET')}`, {name: 'TypeError'}); };
    const cap = await capture(() => callDeepSeek('u', 's', 'NOT-A-REAL-KEY', 'deepseek-flash'));
    ok(cap.thrown && cap.thrown.name === 'DeepSeekError' && cap.thrown.kind === 'network_error', '[١أ] خطأ الشبكة يصير DeepSeekError(network_error)');
    ok(isClean(cap.thrown.message) && isClean(joined(cap)), '[١أ] لا سرّ ولا معرّف في الخطأ المرمي ولا في سطر السجلّ (شبكة)');
    ok(cap.thrown.message.includes('NET-DIAG') && joined(cap).includes('NET-DIAG'), '[١أ] التشخيص باقٍ في الاثنين');

    fetchBehavior = async () => ({ok: false, status: 401, text: async () => `Incorrect API key provided: ${LONG}. ${hostile('HTTP')}`, json: async () => ({})});
    const cap2 = await capture(() => callDeepSeek('u', 's', 'NOT-A-REAL-KEY', 'deepseek-flash'));
    ok(cap2.thrown && cap2.thrown.kind === 'http_error' && cap2.thrown.retryable === false, '[١ب] 401 ⟵ http_error غير قابل للإعادة (السلوك لم يتغيّر)');
    ok(isClean(cap2.thrown.message) && isClean(joined(cap2)), '[١ب] لا سرّ ولا معرّف في جسم الخطأ المرمي ولا في السطر (HTTP)');
    ok(cap2.thrown.message.includes('HTTP-DIAG') && cap2.thrown.message.includes('DeepSeek HTTP 401') && joined(cap2).includes('HTTP-DIAG'), '[١ب] التشخيص ورمز الحالة باقيان');

    fetchBehavior = async () => ({ok: true, status: 200, json: async () => ({error: {message: hostile('ENV')}, choices: [], usage: {}}), text: async () => ''});
    const cap3 = await capture(() => callDeepSeek('u', 's', 'NOT-A-REAL-KEY', 'deepseek-flash'));
    ok(cap3.thrown && cap3.thrown.kind === 'provider_error' && cap3.thrown.retryable === false, '[١ج] خطأ داخل 200 ⟵ provider_error غير قابل للإعادة');
    ok(isClean(cap3.thrown.message) && isClean(joined(cap3)), '[١ج] لا سرّ ولا معرّف في الخطأ المرمي ولا في السطر (envelope.error)');
    ok(cap3.thrown.message.includes('ENV-DIAG'), '[١ج] التشخيص باقٍ');
  }

  // ═══ ٢ — callGemini ═══
  {
    geminiThrow = mkErr(`[GoogleGenerativeAI Error]: ${hostile('GEM')}`, {name: 'GoogleGenerativeAIFetchError'});
    const cap = await capture(() => callGeminiFallback('u', 's', 'NOT-A-REAL-KEY'));
    ok(cap.thrown && cap.thrown.name === 'GeminiError' && cap.thrown.kind === 'request_failed', '[٢] فشل النداء يصير GeminiError(request_failed)');
    ok(isClean(cap.thrown.message) && isClean(joined(cap)), '[٢] لا سرّ ولا معرّف في الخطأ المرمي ولا في سطر السجلّ');
    ok(cap.thrown.message.includes('GEM-DIAG') && joined(cap).includes('GEM-DIAG'), '[٢] التشخيص باقٍ');
  }

  // ═══ ٣ — callAIv7 الحقيقي (callDeepSeek وcallGemini حقيقيان بفخّ fetch/SDK) ═══
  {
    fetchBehavior = async () => { throw mkErr(`fetch failed: ${hostile('V7DS')}`, {name: 'TypeError'}); };
    geminiEnabled = false;
    const cap = await capture(() => callAIv7(v7Params()));
    ok(!cap.thrown && cap.value.providerFailedNoFallback === true, '[٣أ] الراية مطفأة ⟵ providerFailedNoFallback بلا رمي (السلوك لم يتغيّر)');
    ok(typeof cap.value.primaryError === 'string' && isClean(cap.value.primaryError) && cap.value.primaryError.includes('V7DS-DIAG'), '[٣أ] primaryError المُعاد نظيف ويحمل التشخيص');
    ok(isClean(joined(cap)), '[٣أ] سطر التحذير [v7][gemini-fallback] نظيف');

    geminiEnabled = true;
    geminiThrow = mkErr(`[GoogleGenerativeAI Error]: ${hostile('V7GEM')}`);
    const cap2 = await capture(() => callAIv7(v7Params()));
    ok(cap2.thrown && /^V7: Both DeepSeek and Gemini failed: /.test(cap2.thrown.message), '[٣ب] كلاهما فشل ⟵ يرمي «V7: Both DeepSeek and Gemini failed» (السلوك لم يتغيّر)');
    ok(isClean(cap2.thrown.message) && isClean(joined(cap2)), '[٣ب] الخطأ المرمي (رسالتا المزوّدَين) وسطور السجلّ نظيفة');
    ok(cap2.thrown.message.includes('V7DS-DIAG') && cap2.thrown.message.includes('V7GEM-DIAG'), '[٣ب] تشخيص المزوّدَين باقٍ');
    geminiEnabled = false;
  }

  // ═══ ٣ج — خطأ خامّ **غير موسوم** يخرج من callDeepSeek نفسها: response.json() ترمي SyntaxError برسالة تحمل مقطعاً من جسم المزوّد ═══
  {
    geminiEnabled = false;
    fetchBehavior = async () => ({ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token 'I', "${hostile('SYN')}" is not valid JSON`); }, text: async () => ''});
    const cap = await capture(() => callAIv7(v7Params()));
    ok(!cap.thrown && cap.value.providerFailedNoFallback === true, '[٣ج] SyntaxError خامّ من جسم المزوّد ⟵ providerFailedNoFallback (السلوك لم يتغيّر)');
    ok(cap.value.primaryError.includes('SYN-DIAG') && isClean(cap.value.primaryError) && isClean(joined(cap)), '[٣ج] primaryError الناتج عن خطأ خامّ غير موسوم يُنقّى في callAI نفسها: لا سرّ ولا معرّف، والتشخيص باقٍ');
  }

  // ═══ ٣د — خطأ خامّ **غير موسوم** من Gemini: response.text() ترمي (حجب أو ردّ فارغ) برسالة SDK الخامّة ═══
  {
    geminiEnabled = true;
    geminiThrow = null;
    geminiResult = {response: {text: () => { throw mkErr(`[GoogleGenerativeAI Error]: Text not available. ${hostile('TXT')}`); }, candidates: [], usageMetadata: {}}};
    fetchBehavior = async () => { throw mkErr(`fetch failed: ${hostile('V7DS2')}`, {name: 'TypeError'}); };
    const cap = await capture(() => callAIv7(v7Params()));
    geminiResult = null;
    geminiEnabled = false;
    ok(cap.thrown && /^V7: Both DeepSeek and Gemini failed: /.test(cap.thrown.message), '[٣د] كلاهما فشل ⟵ «Both failed» (السلوك لم يتغيّر)');
    ok(cap.thrown.message.includes('TXT-DIAG') && isClean(cap.thrown.message) && isClean(joined(cap)), '[٣د] رسالة Gemini الخامّة غير الموسومة تُنقّى عند تركيب «Both failed»: لا سرّ ولا معرّف، والتشخيص باقٍ');
  }

  // ═══ ٤ — languageValidator.fixLeaksTargeted ═══
  {
    const r = await fixLeaksTargeted(async () => { throw mkErr(hostile('FIX')); }, [{path: 'a.b', original: 'x', tokens: ['x']}], 'ar', 'NOT-A-REAL-KEY');
    ok(r && r.calledModel === true && typeof r.error === 'string' && isClean(r.error) && r.error.includes('FIX-DIAG'), '[٤] error المُعاد من نداء التصحيح نظيف ويحمل التشخيص');
  }

  // ═══ ٥ — resolveV7Report (audit يخزّن الأسباب): PROVIDER_FAILED_NO_FALLBACK وHARD_FAILURE ═══
  {
    geminiEnabled = false;
    fetchBehavior = async () => ({ok: false, status: 500, text: async () => hostile('SRV'), json: async () => ({})});
    const cap = await capture(() => resolveV7Report(v7Params()));
    ok(!cap.thrown && cap.value && cap.value.audit && cap.value.audit.regeneration, '[٥أ] resolveV7Report يعيد عرضاً حتمياً بلا رمي (فشل DeepSeek الصلب والراية مطفأة)');
    const reasons = cap.value.audit.regeneration.rounds.flatMap((r) => r.rejectedReasons || []);
    ok(reasons.some((r) => r.startsWith('PROVIDER_FAILED_NO_FALLBACK:') && r.includes('SRV-DIAG')), '[٥أ] السبب المخزَّن يحمل التشخيص');
    ok(reasons.every(isClean) && isClean(joined(cap)), '[٥أ] لا سرّ ولا معرّف في الأسباب المخزَّنة (audit) ولا في السجلّ');

    // المحاولة الأولى جسم مرفوض الحارس، والثانية تفشل صلباً (شبكة + Gemini مفعَّل يفشل) ⟵ HARD_FAILURE
    geminiEnabled = true;
    geminiThrow = mkErr(`[GoogleGenerativeAI Error]: ${hostile('HGEM')}`);
    let call = 0;
    fetchBehavior = async () => {
      call++;
      if (call === 1) return {ok: true, status: 200, json: async () => B45_REJECTED, text: async () => JSON.stringify(B45_REJECTED)};
      throw mkErr(`fetch failed: ${hostile('HDS')}`, {name: 'TypeError'});
    };
    const b45 = {
      findings, categoryStates, language: 'ar', scanContext: {scanId: SCAN, isFreeTrial: false}, previousScan: null,
      deepseekApiKey: 'NOT-A-REAL-KEY', geminiApiKey: 'NOT-A-REAL-KEY',
    };
    const cap2 = await capture(() => resolveV7Report(b45));
    ok(!cap2.thrown && cap2.value, '[٥ب] فشل نداء إعادة التوليد الصلب لا يُسقط التقرير (السلوك لم يتغيّر)');
    const reasons2 = cap2.value.audit.regeneration.rounds.flatMap((r) => r.rejectedReasons || []);
    const hard = reasons2.filter((r) => r.startsWith('HARD_FAILURE:'));
    ok(hard.length === 1 && hard[0].includes('HDS-DIAG') && hard[0].includes('HGEM-DIAG'), `[٥ب] سبب HARD_FAILURE المخزَّن يحمل تشخيص المزوّدَين — ${JSON.stringify(hard)}`);
    ok(reasons2.every(isClean) && isClean(joined(cap2)), '[٥ب] لا سرّ ولا معرّف في الأسباب المخزَّنة ولا في سطر «regeneration call (attempt 2) threw»');
    ok(joined(cap2).includes('regeneration call (attempt 2) threw'), '[٥ب] السطر المقصود طُبع فعلاً (الاختبار يمرّ بالموضع)');
    geminiEnabled = false;

    // ٥ج: خطأ **خامّ غير موسوم** من callAIv7 في محاولة إعادة التوليد (بلا مرور بتنقية المنشأ) ⟵ resolveV7Report يُنقّيه بنفسه
    let c = 0;
    fetchBehavior = async () => ({ok: true, status: 200, json: async () => B45_REJECTED, text: async () => JSON.stringify(B45_REJECTED)});
    callAIv7Override = (...a) => { c++; if (c === 1) return callAIReal.callAIv7(...a); throw mkErr(hostile('HRAW')); };
    const cap3 = await capture(() => resolveV7Report(b45));
    callAIv7Override = null;
    ok(!cap3.thrown && cap3.value, '[٥ج] خطأ خامّ في محاولة إعادة التوليد لا يُسقط التقرير (السلوك لم يتغيّر)');
    const hard3 = cap3.value.audit.regeneration.rounds.flatMap((r) => r.rejectedReasons || []).filter((r) => r.startsWith('HARD_FAILURE:'));
    ok(hard3.length === 1 && hard3[0].includes('HRAW-DIAG'), `[٥ج] سبب HARD_FAILURE يحمل التشخيص — ${JSON.stringify(hard3)}`);
    ok(hard3.every(isClean) && isClean(joined(cap3)), '[٥ج] الخطأ الخامّ غير الموسوم يُنقّى في resolveV7Report: لا سرّ ولا معرّف في السبب المخزَّن ولا في السطر');
  }

  // ═══ ٦ — runAnalysisInternal: aiFallbackReason المكتوب في التقرير + سطر «AI analysis failed» + سطر findDeviceProfile ═══
  {
    geminiEnabled = true;
    geminiThrow = mkErr(`[GoogleGenerativeAI Error]: ${hostile('RGEM')}`);
    fetchBehavior = async () => { throw mkErr(`fetch failed: ${hostile('RDS')}`, {name: 'TypeError'}); };
    const cap = await capture(() => runAnalysisInternal({
      fingerprint, language: 'ar', deepseekKey: 'NOT-A-REAL-KEY', geminiKey: 'NOT-A-REAL-KEY', scanContext: {scanId: SCAN},
    }));
    ok(!cap.thrown && cap.value.aiFailed === true && cap.value.aiResult === null, '[٦أ] فشل المزوّدَين ⟵ aiFailed=true بلا تقرير (السلوك لم يتغيّر)');
    ok(typeof cap.value.aiFallbackReason === 'string' && cap.value.aiFallbackReason.includes('RDS-DIAG') && cap.value.aiFallbackReason.includes('RGEM-DIAG'), '[٦أ] aiFallbackReason (يُكتب في مستند التقرير) يحمل التشخيص');
    ok(isClean(cap.value.aiFallbackReason) && isClean(joined(cap)), '[٦أ] لا سرّ ولا معرّف في aiFallbackReason ولا في سطر «AI analysis failed»');
    ok(joined(cap).includes('AI analysis failed:'), '[٦أ] السطر المقصود طُبع فعلاً');

    findProfileThrow = mkErr(`6 ALREADY_EXISTS: entity already exists: EntityRef[partitionRef=dev~demo-nc, path=/deviceProfiles/${SCAN}] ${hostile('PRF')}`);
    const fpWithKey = {...fingerprint, device: {...fingerprint.device, deviceProfileKey: {primary: 'p'.repeat(64)}}};
    const cap2 = await capture(() => runAnalysisInternal({
      fingerprint: fpWithKey, language: 'ar', deepseekKey: 'NOT-A-REAL-KEY', geminiKey: 'NOT-A-REAL-KEY', scanContext: {scanId: SCAN},
    }));
    ok(!cap2.thrown, '[٦ب] فشل بحث البصمة لا يُسقط التحليل (السلوك لم يتغيّر)');
    ok(joined(cap2).includes('findDeviceProfile/comparison failed:') && joined(cap2).includes('PRF-DIAG'), '[٦ب] السطر المقصود طُبع ويحمل التشخيص (الموضع مُنفَّذ فعلاً)');
    ok(isClean(joined(cap2)), '[٦ب] لا سرّ ولا معرّف في سطر findDeviceProfile/comparison failed');
    geminiEnabled = false;

    // ٦ج: خطأ خامّ غير موسوم من resolveV7Report نفسها (لا من callAI) ⟵ runAnalysisInternal تُنقّي aiFallbackReason بنفسها
    resolveV7ReportOverride = async () => { throw mkErr(hostile('RRAW')); };
    const cap3 = await capture(() => runAnalysisInternal({
      fingerprint, language: 'ar', deepseekKey: 'NOT-A-REAL-KEY', geminiKey: 'NOT-A-REAL-KEY', scanContext: {scanId: SCAN},
    }));
    resolveV7ReportOverride = null;
    ok(!cap3.thrown && cap3.value.aiFailed === true, '[٦ج] خطأ خامّ من resolveV7Report ⟵ aiFailed=true (السلوك لم يتغيّر)');
    ok(cap3.value.aiFallbackReason.includes('RRAW-DIAG') && isClean(cap3.value.aiFallbackReason) && isClean(joined(cap3)), '[٦ج] aiFallbackReason المكتوب في التقرير وسطر «AI analysis failed» نظيفان ويحملان التشخيص');
  }

  // ═══ ٧ — failureTextOnce: تنقية واحدة لا متداخلة ═══
  {
    const {failureTextOnce, markFailureTextSanitized, sanitizeFailureText} = require('../src/utils/failureText');
    const {DeepSeekError} = require('../src/analysis/callDeepSeek');
    const {GeminiError} = require('../src/analysis/callGemini');
    ok(new DeepSeekError('m', 'k', false).failureTextSanitized === true && new GeminiError('m', 'k').failureTextSanitized === true, '[٧] DeepSeekError وGeminiError موسومان (رسائلهما مبنيّة بتنقية عند الرمي)');
    eq(failureTextOnce(new DeepSeekError('DeepSeek HTTP 401: x', 'http_error', false)), 'DeepSeek HTTP 401: x', '[٧] الخطأ الموسوم يُعاد نصّه كما هو بلا بادئة ولا قصّ (الصيغة القديمة نفسها لـDeepSeekError)');
    const long = 'z'.repeat(450);
    eq(failureTextOnce(markFailureTextSanitized(new Error(long))).length, 450, '[٧] الموسوم لا يُقصّ ثانيةً عند 200');
    const raw = mkErr(hostile('RAW'));
    eq(failureTextOnce(raw), sanitizeFailureText(raw), '[٧] غير الموسوم يُنقّى كما كان');
    ok(isClean(failureTextOnce(raw)) && failureTextOnce(raw).includes('RAW-DIAG'), '[٧] وغير الموسوم نظيف ويحمل التشخيص');
    ok(failureTextOnce(null) === sanitizeFailureText(null) && failureTextOnce('نصّ مرميّ') === sanitizeFailureText('نصّ مرميّ'), '[٧] قيم غير الخطأ (null/نصّ) لا ترمي');
  }

  console.log(`failureTextSitesAI.test.js: ${n}/${n} assertions passed (fetchCalls=${fetchCalls}, geminiCalls=${geminiCalls}; all stubbed, no network)`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});

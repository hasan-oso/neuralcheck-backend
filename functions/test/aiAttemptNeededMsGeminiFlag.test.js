'use strict';

// aiAttemptNeededMsGeminiFlag.test.js — أمر مستخدم 2026-09-23 +03، البند ٦:
// "الوقت المحجوز 35 ث، ووقت المحاولة الثانية يُشتقّ من حالة راية Gemini:
// 130 ث حين يكون مطفأً، 185 حين يكون مشغّلاً... والراية تُقرأ من
// resolveGeminiFallbackConfig نفسها، لا بنسخة." والاختبار المطلوب حرفياً:
// "اختبار بساعة محقونة: الراية مطفأة، وبعد المحاولة الأولى وقتٌ متبقٍّ بين
// 130 و185 ث ← تُجرى الثانية. الراية مشغّلة، والوقت نفسه ← لا تُجرى."
//
// حدّ الاستبدال: globalThis.fetch وحده + فخّ Firestore القابل للتغيير (نفس
// نمط geminiFallbackFlag.test.js) — resolveV7Report → callAIv7 →
// resolveAiAttemptNeededMs → resolveGeminiFallbackConfig كلّها حقيقية غير
// مُعدَّلة (القاعدة 37).
//
// Run: node functions/test/aiAttemptNeededMsGeminiFlag.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const OUT_DIR = path.join(__dirname, '..', 'scripts', 'out');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
function loadLive(name) { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8')); }

// ─── فخّ Firestore — settings/ai (404 دائماً، يطابق الإنتاج) وsettings/
// geminiFallback (قابلة للتبديل بين السيناريوهات) — نفس نمط
// geminiFallbackFlag.test.js حرفياً ─────────────────────────────────────
let geminiFallbackDocState = false; // false | true
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {
      collection: (name) => {
        if (name !== 'settings') throw new Error(`TRAP: unexpected collection "${name}"`);
        return {
          doc: (docId) => ({
            get: async () => {
              if (docId === 'ai') return {exists: false};
              if (docId === 'geminiFallback') return {exists: true, data: () => ({enabled: geminiFallbackDocState})};
              throw new Error(`TRAP: unexpected settings doc "${docId}"`);
            },
          }),
        };
      },
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── globalThis.fetch وحده — يُعيد نفس الجسم الحقيقي المرفوض في كل مرّة ──
let fetchQueue = [];
let fetchCallCount = 0;
global.fetch = async (url) => {
  fetchCallCount++;
  if (!String(url).includes('api.deepseek.com')) throw new Error(`TRAP: unexpected host ${url} (Gemini يجب ألّا يُستدعى في هذا الاختبار)`);
  if (fetchQueue.length === 0) throw new Error('TRAP: fetch queue empty');
  const envelope = fetchQueue.shift();
  return {ok: true, status: 200, json: async () => envelope, text: async () => JSON.stringify(envelope)};
};

const {resolveV7Report} = require('../src/analysis/resolveV7Report');
const {clearGeminiFallbackConfigCache} = require('../src/utils/resolveGeminiFallbackConfig');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const REAL_B45_REJECTED = loadLive('v7-live-b45c8cf6-e376-4765-8703-f68e9bc69844-2026-09-22T23-39-25-313Z.json').rawEnvelope;

const raw = loadGolden('b45c8cf6.ts.json');
const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
const findings = computeFindings(fp);
const inputs = sampleInputsFromRaw(raw);
const categoryStates = computeCategoryStates({
  functionalResults: functional, manualResults: [], dev: null, findings,
  batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
});

function baseParams(deadline) {
  return {
    findings, categoryStates, language: 'ar',
    scanContext: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'irrelevant-fetch-is-stubbed', geminiApiKey: undefined,
    deadline,
  };
}

// بين 130000 (الراية مطفأة) و185000 (الراية مشغَّلة) بالضبط — نصّ الأمر
// حرفياً: "وقتٌ متبقٍّ بين 130 و185 ث". القيمتان 130000/185000 نفسهما
// مصدرهما DEEPSEEK_TIMEOUT_MS/GEMINI_TIMEOUT_MS (callDeepSeek.js:25،
// callGemini.js:25) — لا يُعاد سردهما هنا؛ 150000 تقع بينهما حسابياً
// بصرف النظر عن تلك القيم بعينها (150000 = 130000 + 20000 = 185000 - 35000).
const REMAINING_MS_BETWEEN = 150000;

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — الراية مطفأة (settings/geminiFallback.enabled=false)، وقتٌ متبقٍّ
  // 150000ms (بين 130000 و185000) ← يكفي DeepSeek وحده، محاولة٢ تُجرى.
  // ═══════════════════════════════════════════════════════════════════
  geminiFallbackDocState = false;
  clearGeminiFallbackConfigCache();
  fetchQueue = [REAL_B45_REJECTED, REAL_B45_REJECTED];
  fetchCallCount = 0;
  const deadlineOff = Date.now() + REMAINING_MS_BETWEEN;
  const r1 = await resolveV7Report(baseParams(deadlineOff));
  eq(fetchCallCount, 2, '[١] الراية مطفأة + وقت بين 130-185 ث ← يكفي (130000 وحدها) ← محاولة٢ تُجرى فعلاً، fetch=2');
  ok(!r1.audit.regeneration.rounds.some((rd) => (rd.rejectedReasons || []).some((rr) => /TIME_BUDGET_EXHAUSTED/.test(rr))),
      '[١] صفر TIME_BUDGET_EXHAUSTED — الحاجة (130000) أقلّ من المتبقّي (150000)');
  console.log(`تحقّق ١: الراية مطفأة، متبقٍّ ${REMAINING_MS_BETWEEN}ms ← محاولة٢ نُفِّذت (fetch=2) — الحاجة 130000ms وحدها`);

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — نفس الوقت المتبقّي بالضبط (150000ms)، لكن الراية مشغَّلة الآن
  // (settings/geminiFallback.enabled=true) ← يلزم 185000ms (DeepSeek+Gemini)
  // ← لا تكفي 150000ms المتبقّية ← محاولة٢ لا تُجرى، fetch=1، TIME_BUDGET_EXHAUSTED.
  // ═══════════════════════════════════════════════════════════════════
  geminiFallbackDocState = true;
  clearGeminiFallbackConfigCache();
  fetchQueue = [REAL_B45_REJECTED]; // واحد فقط — لو حاول نداءً ثانياً سيرمي TRAP: fetch queue empty
  fetchCallCount = 0;
  const deadlineOn = Date.now() + REMAINING_MS_BETWEEN;
  const r2 = await resolveV7Report(baseParams(deadlineOn));
  eq(fetchCallCount, 1, '[٢] الراية مشغَّلة + نفس الوقت المتبقّي (150000) ← لا يكفي (يلزم 185000) ← محاولة٢ لا تُجرى، fetch=1');
  const round2 = r2.audit.regeneration.rounds[1];
  ok(round2 && (round2.rejectedReasons || []).some((rr) => /TIME_BUDGET_EXHAUSTED/.test(rr) && /185000/.test(rr)),
      `[٢] TIME_BUDGET_EXHAUSTED يذكر الحاجة 185000ms تحديداً (الراية مشغَّلة) — ${JSON.stringify(round2 && round2.rejectedReasons)}`);
  console.log(`تحقّق ٢: الراية مشغَّلة، نفس المتبقّي (${REMAINING_MS_BETWEEN}ms) ← محاولة٢ لم تُجرَ (fetch=1) — الحاجة صارت 185000ms`);

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — ضابط تأكيدي: الراية مشغَّلة، لكن الوقت المتبقّي ≥185000 فعلاً
  // ← تكفي رغم أن الحاجة صارت الأعلى، محاولة٢ تُجرى (fetch=2). يُثبت أن
  // الرفض في تحقّق ٢ سببه الحاجة الأعلى فعلاً لا عطب آخر يمنع كل محاولة٢
  // حين الراية مشغَّلة.
  // ═══════════════════════════════════════════════════════════════════
  geminiFallbackDocState = true;
  clearGeminiFallbackConfigCache();
  fetchQueue = [REAL_B45_REJECTED, REAL_B45_REJECTED];
  fetchCallCount = 0;
  const deadlineOnFar = Date.now() + 185000 + 20000; // فوق الحاجة الكاملة بهامش
  const r3 = await resolveV7Report(baseParams(deadlineOnFar));
  eq(fetchCallCount, 2, '[٣-ضابط] الراية مشغَّلة + وقت ≥185000 ← يكفي فعلاً ← محاولة٢ تُجرى، fetch=2');
  console.log('تحقّق ٣: ضابط — الراية مشغَّلة لا تمنع محاولة٢ حين الوقت يكفي فعلاً (185000+)، الرفض في تحقّق ٢ كان بسبب الحاجة الأعلى فقط');

  console.log(`\naiAttemptNeededMsGeminiFlag.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});

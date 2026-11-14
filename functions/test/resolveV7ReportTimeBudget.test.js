'use strict';

// resolveV7ReportTimeBudget.test.js — أمر مستخدم 2026-09-23 +03، القرار ١:
// "resolveV7Report يفحص الوقت المتبقّي قبل المحاولة الثانية، وإن لم يكفِ
// يعرض النتيجة جزئية... العرض الجزئي أفضل من لا شيء — وهو القرار ٢١ نفسه."
//
// ساعة محقونة عبر p.deadline (epoch ms مطلق) — لا Date.now() حقيقي يُغيَّر.
// المتوقَّع قيمةً لا وصولاً (القاعدة 30): وقت كافٍ ← محاولة٢ تقع فعلاً
// (fetch=2)؛ وقت غير كافٍ ← لا طلب ثانٍ (fetch=1) والعرض جزئي بسبب مُسمّى
// مستقلّ عن رفض الحارس، والحرف/التغطية/البوّابات كاملة رغم ذلك (لا تمرّ
// بالنموذج أصلاً — buildDisplayShapeV7.js يبنيها من categoryStates/findings
// حصراً، بمعزل عن aiAnalysis).
//
// Run: node functions/test/resolveV7ReportTimeBudget.test.js

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

// ─── فخّ Firestore القياسي ──────────────────────────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── globalThis.fetch وحده — يُعيد نفس الجسم الحقيقي المرفوض في كل مرّة ──
let fetchQueue = [];
let fetchCallCount = 0;
global.fetch = async (url) => {
  fetchCallCount++;
  if (!String(url).includes('api.deepseek.com')) throw new Error(`TRAP: unexpected host ${url}`);
  if (fetchQueue.length === 0) throw new Error('TRAP: fetch queue empty');
  const envelope = fetchQueue.shift();
  return {ok: true, status: 200, json: async () => envelope, text: async () => JSON.stringify(envelope)};
};

const {resolveV7Report} = require('../src/analysis/resolveV7Report');
// أمر مستخدم 2026-09-23 +03، البند ٦: AI_ATTEMPT_NEEDED_MS الثابت استُبدل
// بدالّة resolveAiAttemptNeededMs (تعتمد راية Gemini) — راجع
// aiAttemptNeededMsGeminiFlag.test.js للسلوك الديناميكي بعينه. هذا الملف
// يبقى يختبر منطق الميزانية الزمنية نفسه بمعزل عن الراية (فخّ Firestore
// أدناه يجعلها تسقط دائماً إلى المطفأة الافتراضية = AI_ATTEMPT_NEEDED_MS_MAX
// كافٍ يقيناً للحالتين، فلا حاجة لتغيير منطق الاختبار).
const {AI_ATTEMPT_NEEDED_MS_MAX} = require('../src/analysis/callAI');
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

console.log(`AI_ATTEMPT_NEEDED_MS_MAX = ${AI_ATTEMPT_NEEDED_MS_MAX}ms (من callAI.js — DEEPSEEK_TIMEOUT_MS+GEMINI_TIMEOUT_MS، مصدر واحد)`);

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — وقت كافٍ (ساعة بعيدة جداً) ← محاولة٢ تقع فعلاً، fetch=2.
  // ═══════════════════════════════════════════════════════════════════
  fetchQueue = [REAL_B45_REJECTED, REAL_B45_REJECTED];
  fetchCallCount = 0;
  const farDeadline = Date.now() + AI_ATTEMPT_NEEDED_MS_MAX * 10; // عشرة أضعاف الحاجة — كافٍ يقيناً
  const r1 = await resolveV7Report(baseParams(farDeadline));
  eq(fetchCallCount, 2, '[١] وقت كافٍ — محاولة٢ نُفِّذت فعلاً، fetch=2');
  eq(r1.audit.regeneration.attempts, 2, '[١] audit.regeneration.attempts=2 — الجولتان مُسجَّلتان');
  ok(!r1.audit.regeneration.rounds.some((rd) => (rd.rejectedReasons || []).some((rr) => /TIME_BUDGET_EXHAUSTED/.test(rr))),
      '[١] صفر TIME_BUDGET_EXHAUSTED — الوقت كان كافياً فعلاً');
  console.log('تحقّق ١: وقت كافٍ ← محاولة٢ نُفِّذت، fetch=2');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — وقت غير كافٍ (ساعة قريبة جداً) ← لا محاولة٢، fetch=1، عرض جزئي
  // بسبب مُسمّى، والحرف/التغطية/البوّابات كاملة رغم ذلك.
  // ═══════════════════════════════════════════════════════════════════
  fetchQueue = [REAL_B45_REJECTED]; // واحد فقط — لو حاول السكربت طلباً ثانياً سيرمي TRAP: fetch queue empty
  fetchCallCount = 0;
  const nearDeadline = Date.now() + 500; // أقلّ بكثير من أي قيمة ممكنة (130000 أو 185000)
  const r2 = await resolveV7Report(baseParams(nearDeadline));
  eq(fetchCallCount, 1, '[٢] وقت غير كافٍ — لا طلب شبكة ثانٍ، fetch=1 بالضبط');
  eq(r2.audit.regeneration.attempts, 2, '[٢] attempts=2 مُسجَّلة رغم عدم إصدار نداء — الجولة الثانية "لم نحاول" لا "حاولنا ونجحنا"');
  const round2 = r2.audit.regeneration.rounds[1];
  ok(round2 && (round2.rejectedReasons || []).some((rr) => /TIME_BUDGET_EXHAUSTED/.test(rr)),
      '[٢] سبب مُسمّى TIME_BUDGET_EXHAUSTED مُسجَّل في audit.regeneration.rounds[1]');
  ok(!(round2.rejectedReasons || []).some((rr) => /guard|رفض/i.test(rr) && !/TIME_BUDGET_EXHAUSTED/.test(rr)),
      '[٢] السبب مستقلّ عن رفض الحارس — ليس مصنَّفاً كرفض محتوى (القاعدة ٢١)');
  eq(r2.display.narrativeIncomplete, true, '[٢] narrativeIncomplete=true — نفس سياسة العرض الجزئي (القرار ٢١)');
  // الحرف/التغطية/البوّابات — لا تمرّ بالنموذج أصلاً (buildDisplayShapeV7.js
  // يبنيها من categoryStates/findings حصراً)، فتبقى حاضرة كاملة رغم تخطّي
  // محاولة٢ بالكامل.
  ok(r2.display.overall && typeof r2.display.overall.letter !== 'undefined',
      '[٢] display.overall.letter حاضر — لم يسقط بسبب تخطّي محاولة٢');
  ok(r2.display.overall && r2.display.overall.coverage !== undefined,
      '[٢] display.overall.coverage حاضر — لم يسقط بسبب تخطّي محاولة٢');
  // gatesApplied على audit لا display (القرار ٤+٦ — "تُحفَظ ولا تُعرض"،
  // buildDisplayShapeV7.js:456-461) — تصل audit.gatesApplied حصراً.
  ok(Array.isArray(r2.audit && r2.audit.gatesApplied),
      '[٢] audit.gatesApplied حاضرة (مصفوفة) — البوّابات كاملة رغم العرض الجزئي، لا تمرّ بالنموذج');
  console.log(`تحقّق ٢: وقت غير كافٍ ← fetch=1، TIME_BUDGET_EXHAUSTED مُسجَّل، narrativeIncomplete=true، letter=${r2.display.overall.letter} coverage=${r2.display.overall.coverage} gatesApplied.length=${r2.audit.gatesApplied.length} (كلّها كاملة)`);

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — ضابط: p.deadline غائب (undefined) — نفس السلوك القديم تماماً، لا
  // تغيير افتراضي لأي مستدعٍ لا يمرّر الحقل (runConsistencyTest.js مثلاً).
  // ═══════════════════════════════════════════════════════════════════
  fetchQueue = [REAL_B45_REJECTED, REAL_B45_REJECTED];
  fetchCallCount = 0;
  const r3 = await resolveV7Report(baseParams(undefined));
  eq(fetchCallCount, 2, '[٣-ضابط] deadline غائب ← يُعامَل كـ"بلا سقف" (Infinity)، محاولة٢ تقع كما كانت دائماً');
  console.log('تحقّق ٣: ضابط — deadline غائب لا يُغيّر السلوك القديم (محاولة٢ تقع كالمعتاد)');

  console.log(`\nresolveV7ReportTimeBudget.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});

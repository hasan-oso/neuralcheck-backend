'use strict';

// advisoryLetters.test.js — الحروف الإرشادية والحرف العامّ و`thresholdSet` بنسخة (V8 / PLAN-05 §١-د — الصفّ S-B5a، 2026-10-21 +03)
//
// الكتل:
//   A. thresholdSetVersioned: النسخة وبصمة الحدود (لا يتغيّر حدّ بلا رفع THRESHOLD_SET_VERSION: القاعدة 39)، والمصدر الواحد للحدّين القديمين وحدّ CV (24).
//   B. assessStability وstabilityVerdict: كل فرع، وغياب البيّنة لا يُقرأ ثباتاً (22).
//   C. قارئ fv68 الموسَّع (gpuFragmentHash وgpuFenceTimeout): الحالة والشذوذ، والصفر لا يُقرأ سلامة.
//   D. حقائق التحقّق من قراءة fv68 الحقيقية (مُنتِجات fv70/fv71 من التطبيق): كل قيمة معدَّدة تصل (القاعدة 30).
//   E. حروف الفئات الستّ: كل فرع وكل حدّ حدّيّاً (A/B/C/D) وكل حالة معدَّدة للحقائق.
//   F. الحرف العامّ: المتوسّط المرجَّح ونصف الرتبة نحو الأسوأ (أرقام P5 :183-185)، والبوّابات سقفاً، وnoDataAtAll، والوسم «إرشادي».
//   G. البوّابتان الموصولتان STORAGE_VERIFY_ERRORS وGPU_HASH_MISMATCH بكل حالاتها، وقائمة البوّابات (بلا LOW_CATEGORY_COVERAGE).
//   H. الفحوص الحقيقية الأربعة من fingerprint الخام إلى الحرف العامّ (يمرّ بالقارئ والمكتبة وcategoryStates الحقيقية، بلا مُستبدِل: القاعدتان 37 و41).
//   I. الوثيقة تعدّد كل اسم (7 و25).
//
// Run: node functions/test/advisoryLetters.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {computeFindings, thresholdSet: legacyThresholdSet, UNSTABLE_CV_THRESHOLD_PCT} = require('../src/analysis/findings');
const {readFv68} = require('../src/analysis/fv68Reader');
const {computeFeatureLibrary, classifyStability} = require('../src/analysis/featureLibrary');
const {computeCategoryStates, CATEGORY_WEIGHTS} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');
const {FEATURE, STATUS} = require('../src/analysis/featureNames');
const TS = require('../src/analysis/thresholdSetVersioned');
const AL = require('../src/analysis/advisoryLetters');
const N = require('../src/analysis/fv68Names');

const T = TS.thresholds;
const {PROPERTY, PROPERTY_STATE, ADVISORY_REASON: R} = AL;
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const near = (actual, expected, tol, m) => {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${m} — actual is not a finite number (got ${actual})`);
  assert.ok(Math.abs(actual - expected) <= tol, `${m} — |${actual} - ${expected}| = ${Math.abs(actual - expected)} > ${tol}`);
  n++;
};
const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));

// ═══════════════════════════════════════════════════════════════════════
// A. thresholdSet بنسخة
// ═══════════════════════════════════════════════════════════════════════
{
  eq(TS.THRESHOLD_SET_VERSION, 1, 'THRESHOLD_SET_VERSION = 1 عند هذا الصفّ');
  for (const [k, e] of Object.entries(T)) {
    ok(Object.keys(e).sort().join() === 'label,source,value', `thresholds.${k}: الشكل {value, label, source}`);
    ok(typeof e.source === 'string' && e.source.length > 10, `thresholds.${k}: لكل حدّ مصدره (P5 §١-د: «وكل حدّ بمصدره»)`);
    ok(typeof e.label === 'string' && e.label.length > 0, `thresholds.${k}: لكل حدّ وسمه`);
    ok(Number.isFinite(e.value), `thresholds.${k}: القيمة رقمية`);
  }
  ok(Object.isFrozen(T) && Object.isFrozen(T.cpuCeilingA), 'المجموعة مجمَّدة');
  // مصدر واحد: الحدّان القديمان هما الكائنان نفسهما في findings.js، وحدّ CV هو الثابت المُصدَّر.
  ok(T.vsyncLockCombinedFraction === legacyThresholdSet.vsyncLockCombinedFraction, 'vsyncLockCombinedFraction هو كائن findings.js نفسه (لا نسخة)');
  ok(T.lowCategoryCoverageFraction === legacyThresholdSet.lowCategoryCoverageFraction, 'lowCategoryCoverageFraction هو كائن findings.js نفسه');
  eq(T.unstableCvPct.value, UNSTABLE_CV_THRESHOLD_PCT, 'حدّ CV = UNSTABLE_CV_THRESHOLD_PCT المستورد');
  eq(classifyStability(T.unstableCvPct.value), 'STABLE', 'classifyStability تستعمل الحدّ نفسه');
  // قيم الحروف كما في P5 :145-147.
  deq([T.cpuCeilingA.value, T.cpuRecoveryA.value, T.cpuCeilingB.value, T.thermalHeadroomSevere.value, T.storageCollapseRatio.value, T.minRepeatedScans.value],
      [0.90, 0.90, 0.75, 1.0, 0.5, 3], 'حدود P5 §١-د-١ كما هي');
  deq([T.thermalStatusSevere.value, T.thermalStatusCritical.value, T.thermalStatusEmergency.value], [3, 4, 5], 'حالات الحرارة المنصّة 3/4/5');
  // بصمة المجموعة: تغيير أيّ حدّ أو مصدره أو وسمه بلا رفع النسخة وتحديث هذا السطر يُخفق.
  eq(TS.thresholdSetFingerprint(), '29d767d300ef7ca1e01335dee10ea28924e14aacceb26b286351ebc085bac256', 'بصمة thresholdSet (ارفع THRESHOLD_SET_VERSION وحدّث هذا السطر في الالتزام نفسه عند تغيير مقصود)');
}

// ═══════════════════════════════════════════════════════════════════════
// B. assessStability وstabilityVerdict
// ═══════════════════════════════════════════════════════════════════════
const letterOfCeiling = (v) => (v >= T.cpuCeilingA.value ? 'A' : (v >= T.cpuCeilingB.value ? 'B' : 'C'));
{
  const a = AL.assessStability([0.790, 0.774, 0.781], letterOfCeiling);
  eq(a.nRepeats, 3, 'assess: ثلاثة فحوص');
  deq(a.letters, ['B', 'B', 'B'], 'assess: الحروف');
  eq(a.letterStable, true, 'assess: الحرف لا يتقلّب');
  const m = (0.790 + 0.774 + 0.781) / 3;
  const sd = Math.sqrt(((0.790 - m) ** 2 + (0.774 - m) ** 2 + (0.781 - m) ** 2) / 3);
  near(a.cvPct, sd / m * 100, 1e-12, 'assess: CV = الانحراف السكاني ÷ |المتوسّط| × 100 (صيغة findings.js)');
  eq(classifyStability(a.cvPct), 'STABLE', 'assess: CV مستقرّ');
  // الحرف يتقلّب حول حدّ (مثال التخزين P5 :161: A/B/B) ⟵ letterStable=false حتى لو CV صغير.
  const fl = AL.assessStability([0.581, 0.437, 0.486], (v) => (v >= 0.5 ? 'A' : 'B'));
  eq(fl.letterStable, false, 'assess: نسبة التخزين المرصودة على S10 (0.581/0.437/0.486) ⟵ A/B/B متقلّب');
  ok(fl.cvPct > 0 && fl.cvPct < 15, `assess: وCV وحده (${fl.cvPct.toFixed(1)}%) تحت 15 فلا يكفي (P5 :162)`);
  // أقلّ من الحدّ الأدنى للفحوص ⟵ لا CV ولا حكم ثبات (الغياب لا يُقرأ ثباتاً).
  for (const vals of [[], [0.8], [0.8, 0.81]]) {
    const x = AL.assessStability(vals, letterOfCeiling);
    eq(x.cvPct, null, `assess: ${vals.length} فحصاً ⟵ بلا CV`);
    eq(x.letterStable, null, `assess: ${vals.length} فحصاً ⟵ بلا حكم عدم التقلّب`);
  }
  eq(AL.assessStability([0, 0, 0], () => 'A').cvPct, null, 'assess: متوسّط صفر ⟵ لا CV (لا قسمة على صفر)');
  eq(AL.assessStability([0.8, NaN, 0.8, 'x', 0.8], letterOfCeiling).nRepeats, 3, 'assess: القيم غير الرقمية لا تُعدّ');
  eq(AL.assessStability('x', letterOfCeiling).nRepeats, 0, 'assess: مُدخل ليس مصفوفة');

  const V = AL.stabilityVerdict;
  deq(V({cvPct: 1, letterStable: true}, false), {admitted: true, reason: null}, 'verdict: مستقرّة ثابتة الحرف تدخل');
  eq(V(undefined, false).reason, R.STABILITY_NOT_ESTABLISHED, 'verdict: بلا بيّنة');
  eq(V(null, false).reason, R.STABILITY_NOT_ESTABLISHED, 'verdict: بيّنة null');
  eq(V({cvPct: 1, letterStable: null}, false).reason, R.STABILITY_NOT_ESTABLISHED, 'verdict: عدم التقلّب غير مقيس');
  eq(V({cvPct: null, letterStable: true}, false).reason, R.STABILITY_NOT_ESTABLISHED, 'verdict: CV غير مقيس');
  eq(V({cvPct: 15.1, letterStable: true}, false).reason, R.CV_ABOVE_LIMIT, 'verdict: CV فوق 15');
  eq(V({cvPct: 15, letterStable: true}, false).admitted, true, 'verdict: CV = 15 على الحدّ يدخل (≤)');
  eq(V({cvPct: 1, letterStable: false}, false).reason, R.LETTER_FLUCTUATES, 'verdict: الحرف يتقلّب');
  eq(V({cvPct: 99, letterStable: true}, true).admitted, true, 'verdict: لا قيمة متّصلة بتصميم الخاصّية ⟵ لا CV منطبق');
  eq(V({cvPct: null, letterStable: false}, true).reason, R.LETTER_FLUCTUATES, 'verdict: لا قيمة متّصلة ويتقلّب ⟵ يخرج');
}

// ═══════════════════════════════════════════════════════════════════════
// C. قارئ fv68 الموسَّع
// ═══════════════════════════════════════════════════════════════════════
const synthPayload = (vr, fv) => ({timeSeries: {header: {appVersion: '1.0.11'}, footer: Object.assign({fieldsVersion: fv === undefined ? 71 : fv}, {verificationResults: vr}), samples: [], variables: []}});
{
  const V = N.VERIFICATION;
  eq(V.GPU_FRAGMENT_HASH_MATCHES, 'gpuFragmentHashMatches', 'الاسم الحرفي المُصدَّر');
  eq(V.GPU_FRAGMENT_HASH_TOTAL, 'gpuFragmentHashTotal', 'الاسم الحرفي المُصدَّر');
  eq(V.GPU_FENCE_TIMEOUT_COUNT, 'gpuFenceTimeoutCount', 'الاسم الحرفي المُصدَّر');
  const r = readFv68(synthPayload({gpuFragmentHashMatches: 14, gpuFragmentHashTotal: 14, gpuFenceTimeoutCount: 0}));
  deq(r.verification.gpuFragmentHash, {matches: 14, total: 14, matchesStatus: 'PRESENT', totalStatus: 'PRESENT'}, 'قراءة التجزئة');
  deq(r.verification.gpuFenceTimeout, {count: 0, status: 'PRESENT'}, 'قراءة المهلة: الصفر المقروء يبقى 0 مع حالته (والحكم عند المحرّك)');
  // غائبة: حالة صريحة بحسب الختم، لا صفر.
  const absent71 = readFv68(synthPayload({}, 71));
  deq(absent71.verification.gpuFragmentHash, {matches: null, total: null, matchesStatus: 'ABSENT', totalStatus: 'ABSENT'}, 'ختم ≥ 68 بلا المفتاح ⟵ ABSENT');
  const absent67 = readFv68(synthPayload({}, 67));
  deq(absent67.verification.gpuFenceTimeout, {count: null, status: 'NOT_IN_FIELDS_VERSION'}, 'ختم < 68 بلا المفتاح ⟵ NOT_IN_FIELDS_VERSION');
  // نوع خاطئ ⟵ WRONG_TYPE وشذوذ، لا قيمة.
  const wrong = readFv68(synthPayload({gpuFragmentHashMatches: '14', gpuFragmentHashTotal: 14.5, gpuFenceTimeoutCount: true}));
  eq(wrong.verification.gpuFragmentHash.matchesStatus, 'WRONG_TYPE', 'نصّ بدل عدد');
  eq(wrong.verification.gpuFragmentHash.totalStatus, 'WRONG_TYPE', 'كسر بدل عدد صحيح');
  eq(wrong.verification.gpuFenceTimeout.status, 'WRONG_TYPE', 'بولي بدل عدد');
  eq(wrong.verification.gpuFragmentHash.matches, null, 'WRONG_TYPE بلا قيمة');
  ok(wrong.anomalies.filter((a) => a.code === 'WRONG_TYPE').length >= 3, 'شذوذ WRONG_TYPE لكل منها');
  // شذوذات الاتّساق.
  const over = readFv68(synthPayload({gpuFragmentHashMatches: 15, gpuFragmentHashTotal: 14, gpuFenceTimeoutCount: -1}));
  ok(over.anomalies.some((a) => a.code === 'MATCHES_EXCEED_TOTAL'), 'مطابقات فوق المجموع ⟵ شذوذ معلن');
  ok(over.anomalies.some((a) => a.code === 'NEGATIVE_COUNT'), 'عدّ سالب ⟵ شذوذ معلن');
  eq(over.verification.gpuFragmentHash.matches, 15, 'الشاذّ لا يُصحَّح بصمت');
  // 0 من 0: يُقرأ كما هو (مع الحالة PRESENT)، والمحرّك لا يقرؤه سلامة (E).
  deq(readFv68(synthPayload({gpuFragmentHashMatches: 0, gpuFragmentHashTotal: 0})).verification.gpuFragmentHash.total, 0, '0 من 0 يُقرأ كما وصل');
}

// ═══════════════════════════════════════════════════════════════════════
// D. حقائق التحقّق من حمولات المُنتِج الحقيقية
// ═══════════════════════════════════════════════════════════════════════
const FV71_11 = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json';
const FV71_13 = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json';
const FV71_16 = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json';
const FV70_11 = 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json';
const FV70_13 = 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json';
const FV70_16 = 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json';
{
  const f11 = AL.extractVerificationFacts(readFv68(loadJson(FV71_11)));
  deq(f11.storage, {stateKind: 'ran', writeErrors: 0, readErrors: 0}, 'fv71 11ch: التخزين ran بصفر أخطاء');
  deq(f11.memory, {stateKind: 'ran', march: 0, walkingOnes: 0, randomVerify: 0}, 'fv71 11ch: الذاكرة ran بثلاثة أصفار');
  deq(f11.gpu, {gemm: {verdict: 'OK', basis: 'STATE'}, hashMatches: 14, hashTotal: 14, fenceTimeouts: 0}, 'fv71 11ch: الرسوميات كلّها سليمة، وGEMM من الحالة passed');
  eq(f11.cpu.state, 'partial:time_budget', 'fv71 11ch: حالة المعالج partial:time_budget (قيمة حرفية كاملة في المفردة)');
  eq(f11.cpu.mismatch, false, 'fv71 11ch: لا عدم تطابق');
  ok(f11.cpu.judgedFromRaw > 0, 'fv71 11ch: الحكم من الخامّ المقارَن بمرجع N');

  // عدم تطابق حقيقي من المُنتِج (fv70 13ch: 78499 في المرحلة 5) ⟵ D بحكم الخادم من الخامّ.
  const f70 = AL.extractVerificationFacts(readFv68(loadJson(FV70_13)));
  eq(f70.cpu.mismatch, true, 'fv70 13ch: عدم تطابق من المُنتِج');
  ok(f70.cpu.mismatchRuns >= 1 && f70.cpu.judgedFromRaw >= 1, 'fv70 13ch: حكم الخادم من العدد الخامّ');
  const fAll = [FV70_11, FV70_16, FV71_13, FV71_16].map((f) => AL.extractVerificationFacts(readFv68(loadJson(f))).cpu);
  ok(fAll.every((c) => typeof c.runs === 'number'), 'كل حمولات المُنتِج تُقرأ حقائق معالجها');

  // 16ch: الحالات غير الناجحة تصل كما هي.
  const f16 = AL.extractVerificationFacts(readFv68(loadJson(FV71_16)));
  eq(f16.gpu.gemm.verdict, AL.GEMM_VERDICT.NOT_EXECUTED, 'fv71 16ch: GEMM not_run ⟵ NOT_EXECUTED');
  eq(f16.storage.stateKind, 'partial', 'fv71 16ch: التخزين partial');
  eq(f16.memory.stateKind, 'not_run', 'fv71 16ch: الذاكرة not_run');
  deq([f16.memory.march, f16.memory.walkingOnes, f16.memory.randomVerify], [null, null, null], 'fv71 16ch: عدّادات الذاكرة غائبة لا أصفار');

  // قارئ مكسور (readerError) ⟵ كل الحقائق غائبة صريحاً.
  const bad = AL.extractVerificationFacts({readerError: 'x'});
  deq(bad, {cpu: {state: null, runs: 0, mismatch: null, mismatchRuns: 0, judgedFromRaw: 0, judgedFromStatus: 0},
    storage: {stateKind: null, writeErrors: null, readErrors: null}, memory: {stateKind: null, march: null, walkingOnes: null, randomVerify: null},
    gpu: {gemm: {verdict: 'UNKNOWN', basis: null}, hashMatches: null, hashTotal: null, fenceTimeouts: null}}, 'readerError ⟵ لا حقيقة، لا صفر');
  deq(AL.extractVerificationFacts(null), bad, 'مُدخل null ⟵ نفسه');

  // ختم 67 الحقيقي: GEMM منطقية بلا حالة ⟵ LEGACY_DEFAULT_TRUE موسوم (قيد معلن)، والتخزين صفران حرفيان بلا حالة ⟵ لا ran.
  const real = AL.extractVerificationFacts(readFv68({timeSeries: loadJson('b45c8cf6.ts.json')}));
  deq(real.gpu.gemm, {verdict: 'OK', basis: 'LEGACY_DEFAULT_TRUE'}, 'fv67 الحقيقي: GEMM true بلا حالة ⟵ OK بأساس LEGACY_DEFAULT_TRUE (يُرى)');
  eq(real.storage.stateKind, null, 'fv67 الحقيقي: لا storageVerifyState');
  eq(real.storage.writeErrors, 0, 'fv67 الحقيقي: عدّاد الكتابة الحرفي 0 يصل كما هو');
  eq(real.memory.march, null, 'fv67 الحقيقي: لا عدّادات ذاكرة');
  eq(real.cpu.mismatch, null, 'fv67 الحقيقي: لا حقيقة معالج');
}

// ═══════════════════════════════════════════════════════════════════════
// E. حروف الفئات
// ═══════════════════════════════════════════════════════════════════════
const rec = (value, status, reason) => ({status: status || STATUS.MEASURED, reason: reason || null, value: value === undefined ? null : value});
const feats = (o) => {
  const f = {};
  for (const [k, v] of Object.entries(o)) f[k] = v;
  return f;
};
const absentFacts = AL.extractVerificationFacts(null);
const factsWith = (o) => Object.assign({}, JSON.parse(JSON.stringify(absentFacts)), o);
const STABLE = {cvPct: 2, letterStable: true};
const ALL_STABLE = {
  [PROPERTY.CPU_CEILING_COMBINED]: STABLE, [PROPERTY.CPU_RECOVERY]: STABLE, [PROPERTY.THERMAL_HEADROOM_PEAK]: STABLE, [PROPERTY.STORAGE_POST_OVER_IN_CACHE]: STABLE,
};
const findingsWith = (c) => ({sustainedCeiling: {status: STATUS.MEASURED, combined: {meanWindowMaxRatio: c}}});
const cpuOf = (ceil, rec7, facts, stab) => AL._internal.cpuLetter(feats({[FEATURE.CPU_RECOVERY_P7]: rec7 === 'absent' ? rec(null, STATUS.NOT_MEASURED, 'NO_SAMPLES_IN_PHASE') : rec(rec7)}), findingsWith(ceil), facts || absentFacts, stab === undefined ? ALL_STABLE : stab);
{
  // المعالج — الحدود تماماً (P5 :145): 0.90 ⟵ A (مع تعافٍ ≥ 0.90)، 0.75 ⟵ B، تحت 0.75 ⟵ C.
  eq(cpuOf(0.90, 0.90).letter, 'A', 'cpu: سقف 0.90 وتعافٍ 0.90 ⟵ A (على الحدّ)');
  eq(cpuOf(0.8999, 0.95).letter, 'B', 'cpu: سقف 0.8999 ⟵ B');
  eq(cpuOf(0.95, 0.8999).letter, 'B', 'cpu: سقف 0.95 وتعافٍ 0.8999 ⟵ B (A تتطلّب الاثنين)');
  eq(cpuOf(0.75, 0.5).letter, 'B', 'cpu: سقف 0.75 ⟵ B (على الحدّ)');
  eq(cpuOf(0.7499, 1).letter, 'C', 'cpu: سقف 0.7499 ⟵ C');
  eq(cpuOf(0.1, 1).letter, 'C', 'cpu: سقف 0.1 ⟵ C، **ولا D من السقف** (د-٠-د)');
  eq(cpuOf(0, 0).letter, 'C', 'cpu: سقف 0 ⟵ C لا D');
  // التعافي غائب أو خارج الحرف ⟵ لا A (الغياب لا يُقرأ نجاحاً) فيبقى B.
  eq(cpuOf(0.99, 'absent').letter, 'B', 'cpu: التعافي غائب ⟵ لا A (اختيار S-B5a)');
  const noRec = cpuOf(0.99, 'absent');
  eq(noRec.properties.find((p) => p.name === PROPERTY.CPU_RECOVERY).state, PROPERTY_STATE.ABSENT, 'cpu: التعافي مسجَّل غائباً');
  eq(cpuOf(0.99, 0.99, absentFacts, {[PROPERTY.CPU_CEILING_COMBINED]: STABLE, [PROPERTY.CPU_RECOVERY]: {cvPct: 30, letterStable: true}}).letter, 'B', 'cpu: التعافي غير مستقرّ ⟵ يخرج ◐ ولا A');
  eq(cpuOf(0.99, 0.99, absentFacts, {[PROPERTY.CPU_CEILING_COMBINED]: STABLE, [PROPERTY.CPU_RECOVERY]: {cvPct: 30, letterStable: true}}).properties.find((p) => p.name === PROPERTY.CPU_RECOVERY).displayAs, 'ADVISORY_DOT', 'cpu: الخارج يُعرض ◐');
  // السقف غير ثابت أو بلا بيّنة ⟵ لا حرف (لم يبقَ شيء).
  for (const [ev, reason] of [[undefined, R.STABILITY_NOT_ESTABLISHED], [{cvPct: 16, letterStable: true}, R.CV_ABOVE_LIMIT], [{cvPct: 3, letterStable: false}, R.LETTER_FLUCTUATES]]) {
    const r = cpuOf(0.8, 0.8, absentFacts, ev === undefined ? {} : {[PROPERTY.CPU_CEILING_COMBINED]: ev});
    eq(r.letter, null, `cpu: السقف ${reason} ⟵ لا حرف`);
    eq(r.reason, reason, `cpu: السبب ${reason}`);
    eq(r.status, STATUS.NOT_MEASURED, 'cpu: NOT_MEASURED');
  }
  eq(cpuOf(0.8, 0.8, absentFacts, null).reason, R.STABILITY_NOT_ESTABLISHED, 'cpu: stability = null ⟵ لا بيّنة');
  // السقف غير مقيس أصلاً (بوّابة السقف المستدام).
  const noCeil = AL._internal.cpuLetter(feats({}), {sustainedCeiling: {status: STATUS.NOT_MEASURED, notMeasuredReason: 'INSUFFICIENT_SAMPLES'}}, absentFacts, ALL_STABLE);
  eq(noCeil.letter, null, 'cpu: السقف غير مقيس ⟵ لا حرف');
  eq(noCeil.reason, R.INPUT_ABSENT, 'cpu: مُدخل غائب');
  eq(noCeil.reasonDetail, `${PROPERTY.CPU_CEILING_COMBINED}:INSUFFICIENT_SAMPLES`, 'cpu: المُدخل وسبب غيابه مسمّيان');
  eq(AL._internal.cpuLetter(null, null, absentFacts, ALL_STABLE).letter, null, 'cpu: بلا findings ولا مكتبة ⟵ لا حرف دون رمي');
  // D من حقيقة النتيجة المعروفة — بلا حاجة لثبات ولا لسقف، وتسبق كل شيء.
  const dFacts = factsWith({cpu: {state: 'ran', runs: 3, mismatch: true, mismatchRuns: 1, judgedFromRaw: 3, judgedFromStatus: 0}});
  eq(cpuOf(0.99, 0.99, dFacts).letter, 'D', 'cpu: عدم تطابق ⟵ D حتى بسقف ممتاز');
  eq(cpuOf(0.99, 0.99, dFacts, null).letter, 'D', 'cpu: D بلا بيّنة ثبات (حقيقة لا خاصّية متّصلة)');
  eq(cpuOf(0.99, 0.99, dFacts).basis, 'FACT', 'cpu: أساس D حقيقة');
  const okFacts = factsWith({cpu: {state: 'ran', runs: 3, mismatch: false, mismatchRuns: 0, judgedFromRaw: 3, judgedFromStatus: 0}});
  eq(cpuOf(0.99, 0.99, okFacts).letter, 'A', 'cpu: لا عدم تطابق ⟵ الحرف من السقف');
  eq(cpuOf(0.8, 0.8, factsWith({cpu: {state: null, runs: 0, mismatch: null, mismatchRuns: 0, judgedFromRaw: 0, judgedFromStatus: 0}})).letter, 'B', 'cpu: حقيقة المعالج غائبة ⟵ لا D (غياب لا تطابق) والحرف من السقف');
}
{
  // الحرارة (P5 :146).
  const th = (status, headroom, stab) => AL._internal.thermalLetter(feats({
    [FEATURE.THERMAL_STATUS_MAX]: status === 'absent' ? rec(null, STATUS.NOT_MEASURED, 'ABSENT_IN_FOOTER') : rec(status),
    [FEATURE.THERMAL_HEADROOM_PEAK]: headroom === 'absent' ? rec(null, STATUS.NOT_MEASURED, 'ABSENT_IN_FOOTER') : rec(headroom),
  }), stab === undefined ? ALL_STABLE : stab);
  const L = (s, h, stab) => th(s, h, stab).letter;
  // كل حالة من الحالات السبع المعلنة 0..6 بذروة headroom دون 1.0.
  deq([0, 1, 2, 3, 4, 5, 6].map((s) => L(s, 0.5)), ['A', 'A', 'A', 'B', 'C', 'D', 'D'], 'thermal: الحالات 0..6 (headroom 0.5): A A A B C D D');
  eq(L(2, 0.9999), 'A', 'thermal: headroom 0.9999 ⟵ A');
  eq(L(2, 1.0), 'B', 'thermal: headroom 1.0 على الحدّ ⟵ B (≥ 1.0)');
  eq(L(0, 1.05), 'B', 'thermal: حالة 0 وheadroom 1.05 ⟵ B');
  eq(L(4, 0.3), 'C', 'thermal: CRITICAL ⟵ C ولو headroom منخفض');
  eq(L(5, 0.3), 'D', 'thermal: EMERGENCY ⟵ D');
  eq(L(6, 0.3), 'D', 'thermal: SHUTDOWN ⟵ D');
  // الأسوأ يُحكم بالحالة وحدها: headroom غائب أو بلا بيّنة لا يمنعه.
  eq(L(3, 'absent'), 'B', 'thermal: SEVERE وheadroom غائب ⟵ B');
  eq(L(4, 'absent'), 'C', 'thermal: CRITICAL وheadroom غائب ⟵ C');
  eq(L(5, 'absent', {}), 'D', 'thermal: D بلا بيّنة ثبات (الحالة واقعة)');
  eq(L(3, 0.5, {}), 'B', 'thermal: SEVERE بلا بيّنة ثبات للـheadroom ⟵ B (الحالة واقعة)');
  // A تتطلّب الاثنتين.
  const noH = th(2, 'absent');
  eq(noH.letter, null, 'thermal: حالة ≤ 2 وheadroom غائب ⟵ لا A');
  eq(noH.reason, R.INPUT_ABSENT, 'thermal: السبب مُدخل غائب');
  eq(noH.reasonDetail, `${PROPERTY.THERMAL_HEADROOM_PEAK}:ABSENT_IN_FOOTER`, 'thermal: المُدخل الغائب مسمّى');
  const unstableH = th(2, 0.5, {[PROPERTY.THERMAL_HEADROOM_PEAK]: {cvPct: 30, letterStable: true}});
  eq(unstableH.letter, null, 'thermal: حالة ≤ 2 وheadroom غير مستقرّ ⟵ لا A');
  eq(unstableH.reason, R.CV_ABOVE_LIMIT, 'thermal: سبب الخروج CV');
  eq(unstableH.properties.find((p) => p.name === PROPERTY.THERMAL_HEADROOM_PEAK).displayAs, 'ADVISORY_DOT', 'thermal: يُعرض ◐');
  eq(L('absent', 1.2), 'B', 'thermal: الحالة غائبة وheadroom ≥ 1.0 مستقرّ ⟵ B');
  eq(L('absent', 0.5), null, 'thermal: الحالة غائبة وheadroom < 1 ⟵ لا حرف');
  eq(L('absent', 'absent'), null, 'thermal: كلاهما غائب ⟵ لا حرف');
  eq(AL._internal.thermalLetter(null, ALL_STABLE).letter, null, 'thermal: بلا مكتبة ⟵ لا حرف دون رمي');
  // الحالة القصوى واقعة: تُقبل بلا بيّنة؛ ومثال P5 :168: الحرارة تقلّبت بواقعة فيبقى حرفها.
  eq(th(3, 0.5, {}).properties[0].kind, 'EVENT', 'thermal: الحالة القصوى EVENT');
}
{
  // التخزين (P5 :147).
  const stFeats = (inC, post, postReason) => feats({
    [FEATURE.STORAGE_IN_CACHE_MBPS]: inC === 'absent' ? rec(null, STATUS.NOT_MEASURED, 'STORAGE_SEGMENTS_ABSENT') : rec(inC),
    [FEATURE.STORAGE_POST_CACHE_MBPS]: post === 'noKnee' ? rec(null, STATUS.NOT_MEASURED, 'NO_KNEE_IN_SCAN') : (post === 'absent' ? rec(null, STATUS.NOT_MEASURED, postReason || 'STORAGE_SEGMENTS_ABSENT') : rec(post)),
  });
  const ranZero = {storage: {stateKind: 'ran', writeErrors: 0, readErrors: 0}};
  const st = (inC, post, facts, stab) => AL._internal.storageLetter(stFeats(inC, post), factsWith(facts || ranZero), stab === undefined ? ALL_STABLE : stab);
  eq(st(100, 50).letter, 'A', 'storage: نسبة 0.5 على الحدّ ⟵ A');
  eq(st(100, 49.99).letter, 'B', 'storage: نسبة 0.4999 ⟵ B (انهيار)');
  eq(st(100, 90).letter, 'A', 'storage: نسبة 0.9 ⟵ A');
  eq(st(100, 'noKnee').letter, 'A', 'storage: لا ركبة ⟵ A');
  near(st(100, 40).inputs.ratioPostOverInCache, 0.4, 1e-12, 'storage: النسبة المحسوبة F10 ÷ F9');
  // D من الأخطاء — بلا شرط التحقّق الكامل.
  eq(st(100, 90, {storage: {stateKind: 'ran', writeErrors: 1, readErrors: 0}}).letter, 'D', 'storage: خطأ كتابة ⟵ D');
  eq(st(100, 90, {storage: {stateKind: 'ran', writeErrors: 0, readErrors: 2}}).letter, 'D', 'storage: خطأ قراءة راجعة ⟵ D');
  eq(st(100, 90, {storage: {stateKind: 'partial', writeErrors: 0, readErrors: 1}}).letter, 'D', 'storage: خطأ في تحقّق جزئي ⟵ D (الخطأ المرصود حقيقي)');
  eq(st(100, 90, {storage: {stateKind: null, writeErrors: 3, readErrors: null}}).letter, 'D', 'storage: خطأ كتابة بلا حالة ⟵ D');
  // لا حرف بلا منتِج حقيقي للتحقّق (د-٠-هـ): كل حالة غير ran، وكل عدّاد غائب.
  for (const kind of [null, 'partial', 'not_run']) {
    const r = st(100, 90, {storage: {stateKind: kind, writeErrors: 0, readErrors: 0}});
    eq(r.letter, null, `storage: الحالة ${kind} وصفران ⟵ لا حرف (الصفر مقيس حقيقي فقط مع ran)`);
    eq(r.reason, R.STORAGE_VERIFY_NOT_RUN, `storage: ${kind} السبب مسمّى`);
    eq(r.reasonDetail, `storageVerifyState=${kind === null ? 'absent' : kind}`, `storage: ${kind} حالة المنتِج معلنة`);
  }
  eq(st(100, 90, {storage: {stateKind: 'ran', writeErrors: 0, readErrors: null}}).reason, R.STORAGE_VERIFY_NOT_RUN, 'storage: ran وعدّاد القراءة غائب ⟵ لا حرف');
  eq(st(100, 90, {storage: {stateKind: 'ran', writeErrors: null, readErrors: null}}).letter, null, 'storage: ran بلا عدّادات ⟵ لا حرف');
  eq(st(100, 90, {storage: {stateKind: null, writeErrors: null, readErrors: null}}).properties[0].state, PROPERTY_STATE.ABSENT, 'storage: حقيقة الأخطاء غائبة تُسجَّل غائبة');
  // النسبة متّصلة: لا تدخل بلا بيّنة ثبات؛ وما لا تثبت فيه (A/B/B على S10) يخرج ⟵ لا حرف (P5 :164).
  const noEv = st(100, 90, ranZero, {});
  eq(noEv.letter, null, 'storage: نسبة بلا بيّنة ثبات ⟵ لا حرف');
  eq(noEv.reason, R.STABILITY_NOT_ESTABLISHED, 'storage: سبب غياب البيّنة');
  eq(st(100, 90, ranZero, {[PROPERTY.STORAGE_POST_OVER_IN_CACHE]: {cvPct: 11.9, letterStable: false}}).reason, R.LETTER_FLUCTUATES, 'storage: CV 11.9% تحت 15 لكن الحرف يتقلّب ⟵ يخرج (P5 :161)');
  eq(st(100, 90, ranZero, {[PROPERTY.STORAGE_POST_OVER_IN_CACHE]: {cvPct: 20, letterStable: true}}).reason, R.CV_ABOVE_LIMIT, 'storage: CV 20% ⟵ يخرج');
  eq(st(100, 90, ranZero, {[PROPERTY.STORAGE_POST_OVER_IN_CACHE]: {cvPct: 20, letterStable: true}}).properties[1].displayAs, 'ADVISORY_DOT', 'storage: الخارجة تُعرض ◐');
  // لا ركبة: لا قيمة متّصلة ⟵ يكفي عدم تقلّب الحرف (لا CV منطبق).
  eq(st(100, 'noKnee', ranZero, {[PROPERTY.STORAGE_POST_OVER_IN_CACHE]: {cvPct: null, letterStable: true}}).letter, 'A', 'storage: لا ركبة وحرف ثابت ⟵ A');
  eq(st(100, 'noKnee', ranZero, {[PROPERTY.STORAGE_POST_OVER_IN_CACHE]: {cvPct: null, letterStable: false}}).reason, R.LETTER_FLUCTUATES, 'storage: لا ركبة والحرف يتقلّب عبر الفحوص ⟵ لا حرف');
  eq(st(100, 'noKnee', ranZero, {}).reason, R.STABILITY_NOT_ESTABLISHED, 'storage: لا ركبة بلا بيّنة ⟵ لا حرف');
  // مُدخلات الخصائص غائبة أو غير قابلة للقسمة.
  const noIn = st('absent', 'absent', ranZero);
  eq(noIn.letter, null, 'storage: F9/F10 غائبتان ⟵ لا حرف');
  eq(noIn.reasonDetail, `${PROPERTY.STORAGE_POST_OVER_IN_CACHE}:STORAGE_SEGMENTS_ABSENT`, 'storage: المُدخل الغائب مسمّى');
  eq(st(0, 5).reasonDetail, `${PROPERTY.STORAGE_POST_OVER_IN_CACHE}:ZERO_DENOMINATOR`, 'storage: F9 = 0 ⟵ ZERO_DENOMINATOR لا قسمة');
  eq(st('absent', 'noKnee').letter, null, 'storage: لا ركبة لكن F9 غائبة ⟵ لا حرف (لا تُقرأ «لا ركبة» من غياب المقاطع)');
  eq(AL._internal.storageLetter(null, absentFacts, ALL_STABLE).letter, null, 'storage: بلا مكتبة ولا حقائق ⟵ لا حرف دون رمي');
}
{
  // الرسوميات (P5 :148): المصفوفة الكاملة بمرجع مستقلّ داخل الاختبار (كل قيمة معدَّدة: القاعدة 30).
  const verdicts = Object.values(AL.GEMM_VERDICT);
  deq(verdicts, ['OK', 'FAIL', 'NOT_EXECUTED', 'UNKNOWN'], 'أحكام GEMM الأربعة المعدَّدة');
  const hashes = [[14, 14], [13, 14], [0, 0], [null, null], [14, null]];
  const fences = [0, 2, null];
  let cells = 0;
  for (const gv of verdicts) {
    for (const [hm, ht] of hashes) {
      for (const fc of fences) {
        const g = {gemm: {verdict: gv, basis: 'STATE'}, hashMatches: hm, hashTotal: ht, fenceTimeouts: fc};
        const r = AL._internal.gpuLetter(factsWith({gpu: g}));
        const bad = gv === 'FAIL' || (ht !== null && ht > 0 && hm !== null && hm < ht) || (fc !== null && fc > 0);
        const good = gv === 'OK' && ht !== null && ht > 0 && hm === ht && fc === 0;
        const want = bad ? 'D' : (good ? 'A' : null);
        eq(r.letter, want, `gpu[${gv} ${hm}/${ht} fence=${fc}]`);
        if (want === null) eq(r.reason, R.GPU_VERIFICATION_INCOMPLETE, `gpu[${gv} ${hm}/${ht} fence=${fc}]: السبب`);
        const gate = AL._internal.gpuHashGate(factsWith({gpu: g}));
        eq(gate.status, bad ? 'FIRED' : (good ? 'NOT_FIRED' : 'INPUT_ABSENT'), `بوّابة GPU[${gv} ${hm}/${ht} fence=${fc}]`);
        eq(gate.ceilingLetter, 'D', 'GPU_HASH_MISMATCH سقفها D');
        cells++;
      }
    }
  }
  eq(cells, 60, 'gpu: 4×5×3 خليّة');
  const inc = AL._internal.gpuLetter(factsWith({gpu: {gemm: {verdict: AL.GEMM_VERDICT.NOT_EXECUTED, basis: 'STATE'}, hashMatches: 0, hashTotal: 0, fenceTimeouts: 0}}));
  ok(inc.reasonDetail.includes('gpu.compute_gemm:gemm=NOT_EXECUTED') && inc.reasonDetail.includes('gpuFragmentHashTotal=0'), 'gpu: التفصيل يسمّي ما غاب (GEMM لم يُنفَّذ، و0 من 0)');
  eq(inc.properties.find((p) => p.name === 'gpu.fragment_hash').state, PROPERTY_STATE.ABSENT, 'gpu: 0 من 0 غائبة لا سليمة');
}
{
  // الذاكرة (P5 :149): الحالات × العدّادات.
  let cells = 0;
  for (const kind of [null, 'ran', 'partial', 'not_run']) {
    for (const c of [[0, 0, 0], [1, 0, 0], [0, 0, 2], [null, null, null], [0, null, 0]]) {
      const r = AL._internal.memoryLetter(factsWith({memory: {stateKind: kind, march: c[0], walkingOnes: c[1], randomVerify: c[2]}}));
      const bad = c.some((x) => x !== null && x > 0);
      const good = c.every((x) => x === 0) && kind === 'ran';
      eq(r.letter, bad ? 'D' : (good ? 'A' : null), `memory[${kind} ${c}]`);
      if (!bad && !good) eq(r.reason, R.MEMORY_VERIFY_NOT_COMPLETE, `memory[${kind} ${c}]: السبب`);
      cells++;
    }
  }
  eq(cells, 20, 'memory: 4×5 خليّة');
  eq(AL._internal.memoryLetter(absentFacts).reasonDetail, 'memoryVerifyState=absent', 'memory: لا عدّاد في fv67 ⟵ «لم يُقَس» بحالتها (P5 :149)');
}
{
  // الأمان: الحرف القائم في V7 كما هو.
  const sec = (entry) => AL._internal.securityLetter(entry === undefined ? undefined : {categories: {security: entry}});
  for (const l of ['A', 'B', 'C', 'D']) {
    const r = sec({state: 'MEASURED', deterministicLetter: l});
    eq(r.letter, l, `security: حرف V7 ${l} كما هو`);
    eq(r.advisory, false, 'security: بلا وسم «إرشادي» (د-٠-ب)');
    eq(r.basis, 'V7', 'security: الأساس V7');
  }
  for (const st of ['UNMEASURED', 'ATTESTED_ONLY', 'HARNESS_ERROR']) {
    const r = sec({state: st, deterministicLetter: null});
    eq(r.letter, null, `security: ${st} بلا حرف`);
    eq(r.reason, R.V7_NO_LETTER, `security: ${st} السبب`);
    eq(r.reasonDetail, `state=${st}`, `security: ${st} حالة V7 معلنة`);
  }
  eq(sec(undefined).reason, R.INPUT_ABSENT, 'security: بلا categoryStates ⟵ مُدخل غائب');
  eq(sec(null).reason, R.INPUT_ABSENT, 'security: الفئة غائبة');
  for (const c of ['cpu', 'thermal', 'storage', 'gpu', 'memory']) eq(AL.ADVISORY_CATEGORIES.includes(c) && !AL.NON_ADVISORY_CATEGORIES.includes(c), true, `${c} إرشادية`);
  deq(AL.ADVISORY_CATEGORIES.slice(), ['cpu', 'thermal', 'storage', 'gpu', 'memory', 'security'], 'الفئات الستّ بترتيب P5 :143-150 والبطارية خارجها (د-٢)');
}

// ═══════════════════════════════════════════════════════════════════════
// F. الحرف العامّ
// ═══════════════════════════════════════════════════════════════════════
const catRec = (letter, advisory) => ({letter, advisory: advisory === undefined ? true : advisory});
const overallOf = (letters, gates) => {
  const cats = {};
  for (const [c, l] of Object.entries(letters)) cats[c] = catRec(l, c !== 'security');
  return AL.deriveAdvisoryOverall(cats, gates || []);
};
const gate = (name, status, ceilingLetter, category) => ({name, category: category || 'security', ceilingLetter, status, source: `test:${name}`});
{
  // أرقام P5 :183-185 (النموذج الأوّلي على الستّة): المتوسّط المرجَّح ثم أقرب رتبة، ونصف الرتبة نحو الأسوأ.
  const s10 = overallOf({cpu: 'B', thermal: 'A', gpu: 'A', security: 'D'});
  near(s10.rankMean, (7.5 * 1 + 7.5 * 0 + 4.5 * 0 + 15 * 3) / 34.5, 1e-12, 'S10: المتوسّط 1.522 (P5 :183)');
  near(s10.rankMean, 1.522, 0.001, 'S10: 1.522 كما في P5');
  eq(s10.letter, 'C', 'S10: C');
  eq(s10.letterSource, 'BAND', 'S10: من المتوسّط وحده');
  deq(s10.categoriesCounted.map((c) => c.category), ['cpu', 'thermal', 'gpu', 'security'], 'S10: الفئات الداخلة');
  deq(s10.categoriesCounted.map((c) => c.weight), [CATEGORY_WEIGHTS.cpu, CATEGORY_WEIGHTS.thermal, CATEGORY_WEIGHTS.gpu, CATEGORY_WEIGHTS.security], 'S10: الأوزان = CATEGORY_WEIGHTS (مصدر واحد)');
  const s21a = overallOf({cpu: 'C', thermal: 'A', gpu: 'A'});
  near(s21a.rankMean, 0.769, 0.001, 'S21 دون أمان: 0.769 (P5 :184)');
  eq(s21a.letter, 'B', 'S21 دون أمان: B');
  const s21b = overallOf({cpu: 'C', thermal: 'B', gpu: 'A'});
  near(s21b.rankMean, 1.154, 0.001, 'S21 بحرارة B: 1.154 (P5 :184)');
  eq(s21b.letter, 'B', 'S21 بحرارة B: B');
  const x1 = overallOf({cpu: 'C', thermal: 'A', gpu: 'A', security: 'B'});
  near(x1.rankMean, 0.870, 0.001, 'NC-AZQBJ2: 0.870 (P5 :185)');
  eq(x1.letter, 'B', 'NC-AZQBJ2: B');
  const x2 = overallOf({cpu: 'C', thermal: 'B', gpu: 'A', security: 'B'});
  near(x2.rankMean, 1.087, 0.001, 'NC-XGADHL: 1.087 (P5 :185)');
  eq(x2.letter, 'B', 'NC-XGADHL: B');
  // نصف الرتبة يُقرَّب نحو الأسوأ.
  eq(overallOf({cpu: 'B', thermal: 'A'}).letter, 'B', 'نصف 0.5 ⟵ B (نحو الأسوأ لا A)');
  eq(overallOf({cpu: 'D', thermal: 'A'}).letter, 'C', 'نصف 1.5 ⟵ C');
  eq(overallOf({cpu: 'D', thermal: 'C'}).letter, 'D', 'نصف 2.5 ⟵ D');
  eq(overallOf({cpu: 'A', thermal: 'A'}).letter, 'A', 'صفر ⟵ A');
  eq(overallOf({cpu: 'B', thermal: 'A', gpu: 'A', memory: 'A'}).letter, 'A', 'متوسّط 0.31 ⟵ A (دون النصف)');
  eq(overallOf({cpu: 'D'}).letter, 'D', 'D وحدها ⟵ D (لا تتجاوز 3)');
  // لا فئة بحرف.
  const none = overallOf({cpu: null, thermal: null});
  eq(none.letter, null, 'لا فئة بحرف ⟵ لا حرف عامّ');
  eq(none.noDataAtAll, true, 'noDataAtAll');
  eq(none.letterSource, 'NO_DATA', 'NO_DATA');
  eq(none.rankMean, null, 'لا متوسّط');
  eq(none.advisory, false, 'لا فئة داخلة ⟵ ليس إرشادياً');
  // الوسم «إرشادي»: ما دامت فئة إرشادية داخلة.
  eq(overallOf({security: 'B'}).advisory, false, 'الأمان وحده ⟵ لا وسم (حقائق وسياسة)');
  eq(overallOf({security: 'B', gpu: 'A'}).advisory, true, 'الأمان مع فئة إرشادية ⟵ إرشادي');
  eq(overallOf({cpu: 'A'}).advisory, true, 'فئة إرشادية ⟵ إرشادي');
  // البوّابات سقفاً.
  const gatesFor = (o) => [gate('ROOT_DETECTED', o.root || 'NOT_FIRED', 'C'), gate('PATCH_AGE', o.patch || 'NOT_FIRED', 'B'),
    gate('STORAGE_VERIFY_ERRORS', o.st || 'NOT_FIRED', 'D', 'storage'), gate('GPU_HASH_MISMATCH', o.gpu || 'NOT_FIRED', 'D', 'gpu'), gate('SUSTAINED_CEILING', 'DISABLED', 'C', 'cpu')];
  const a = overallOf({cpu: 'A', gpu: 'A'}, gatesFor({root: 'FIRED'}));
  eq(a.letter, 'C', 'جذر ⟵ سقف C على A');
  eq(a.letterSource, 'GATE:ROOT_DETECTED', 'المصدر البوّابة الحاكمة');
  eq(a.bandLetter, 'A', 'حرف المتوسّط قبل السقف محفوظ');
  eq(a.governingGate.name, 'ROOT_DETECTED', 'البوّابة الحاكمة مسمّاة');
  eq(a.governingGate.ceilingLetter, 'C', 'وسقفها');
  eq(overallOf({cpu: 'A'}, gatesFor({patch: 'FIRED'})).letter, 'B', 'رقعة قديمة ⟵ سقف B');
  const both = overallOf({cpu: 'A'}, gatesFor({root: 'FIRED', patch: 'FIRED'}));
  eq(both.letter, 'C', 'جذر ورقعة معاً ⟵ C');
  eq(both.letterSource, 'GATE:ROOT_DETECTED', 'التعادل: الأسبق في الترتيب (قاعدة V7 نفسها)');
  eq(overallOf({cpu: 'A'}, gatesFor({st: 'FIRED'})).letter, 'D', 'أخطاء تحقّق التخزين ⟵ سقف D');
  eq(overallOf({cpu: 'A'}, gatesFor({gpu: 'FIRED'})).letter, 'D', 'GPU_HASH_MISMATCH ⟵ سقف D');
  eq(overallOf({cpu: 'A'}, gatesFor({gpu: 'FIRED'})).letterSource, 'GATE:GPU_HASH_MISMATCH', 'GPU_HASH_MISMATCH الحاكمة');
  for (const s of ['NOT_FIRED', 'INPUT_ABSENT', 'NOT_WIRED', 'DISABLED', 'UNKNOWN']) {
    const r = overallOf({cpu: 'A'}, [gate('ROOT_DETECTED', s, 'C')]);
    eq(r.letter, 'A', `بوّابة ${s} لا أثر لها على السقف`);
  }
  const worseAlready = overallOf({cpu: 'D'}, gatesFor({root: 'FIRED'}));
  eq(worseAlready.letter, 'D', 'الحرف أسوأ من السقف أصلاً');
  eq(worseAlready.letterSource, 'BAND', 'والمصدر المتوسّط لا البوّابة');
  // بوّابة FIRED بلا فئة بحرف تُنقذ حرفاً (قاعدة V7) ويبقى noDataAtAll true.
  const rescued = overallOf({cpu: null}, gatesFor({root: 'FIRED'}));
  eq(rescued.letter, 'C', 'جذر بلا فئة بحرف ⟵ C من السقف');
  eq(rescued.letterSource, 'GATE:ROOT_DETECTED', 'المصدر البوّابة');
  eq(rescued.noDataAtAll, true, 'noDataAtAll: لا فئة بحرف');
  eq(rescued.advisory, false, 'حرف من بوّابة وحدها ليس إرشادياً');
}

// ═══════════════════════════════════════════════════════════════════════
// G. البوّابتان الموصولتان وقائمة البوّابات
// ═══════════════════════════════════════════════════════════════════════
{
  const sg = (s) => AL._internal.storageVerifyGate(factsWith({storage: s}));
  eq(sg({stateKind: 'ran', writeErrors: 0, readErrors: 0}).status, 'NOT_FIRED', 'STORAGE gate: ran وصفران ⟵ NOT_FIRED');
  eq(sg({stateKind: 'ran', writeErrors: 2, readErrors: 0}).status, 'FIRED', 'STORAGE gate: خطأ كتابة ⟵ FIRED');
  eq(sg({stateKind: 'ran', writeErrors: 0, readErrors: 1}).status, 'FIRED', 'STORAGE gate: خطأ قراءة ⟵ FIRED');
  eq(sg({stateKind: 'partial', writeErrors: 0, readErrors: 5}).status, 'FIRED', 'STORAGE gate: خطأ مرصود في تحقّق جزئي ⟵ FIRED');
  eq(sg({stateKind: null, writeErrors: 4, readErrors: null}).status, 'FIRED', 'STORAGE gate: خطأ بلا حالة ⟵ FIRED');
  for (const s of [{stateKind: null, writeErrors: 0, readErrors: 0}, {stateKind: 'partial', writeErrors: 0, readErrors: 0}, {stateKind: 'not_run', writeErrors: 0, readErrors: 0},
    {stateKind: 'ran', writeErrors: 0, readErrors: null}, {stateKind: 'ran', writeErrors: null, readErrors: 0}, {stateKind: null, writeErrors: null, readErrors: null}]) {
    eq(sg(s).status, 'INPUT_ABSENT', `STORAGE gate: ${JSON.stringify(s)} ⟵ INPUT_ABSENT (لا «قِيس ولم يتحقّق»)`);
  }
  eq(sg({stateKind: 'ran', writeErrors: 0, readErrors: 0}).ceilingLetter, 'D', 'STORAGE_VERIFY_ERRORS سقفها D');
  ok(sg({stateKind: 'ran', writeErrors: 2, readErrors: 0}).source.includes('storageWriteVerifyErrors=2'), 'STORAGE gate: المصدر يذكر القيم');

  // قائمة البوّابات من categoryStates الحقيقية: بلا LOW_CATEGORY_COVERAGE، والبوّابتان موصولتان، والباقي كما هو، وV7 لم تُمسّ.
  const raw = loadJson('b45c8cf6.ts.json');
  const functional = loadJson('functionalResults-by-scanid.json').byScanId['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  const fp = {device: {}, timeSeries: raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inp = sampleInputsFromRaw(raw);
  const cs = computeCategoryStates({functionalResults: functional, manualResults: [], dev: null, findings, batterySampleInputs: inp.sampleInputs, batteryDesignCapacityMah: inp.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS});
  const v7Names = cs.gates.map((g) => g.name);
  ok(v7Names.includes('LOW_CATEGORY_COVERAGE'), 'V7: LOW_CATEGORY_COVERAGE موجودة في gates (مسار V7 لم يُمسّ)');
  eq(cs.gates.find((g) => g.name === 'STORAGE_VERIFY_ERRORS').status, 'NOT_WIRED', 'V7: STORAGE_VERIFY_ERRORS ما زالت NOT_WIRED في categoryStates (لم تُمسّ)');
  eq(cs.gates.find((g) => g.name === 'GPU_HASH_MISMATCH').status, 'NOT_WIRED', 'V7: GPU_HASH_MISMATCH ما زالت NOT_WIRED');
  const facts = AL.extractVerificationFacts(readFv68(fp));
  const gates = AL.buildAdvisoryGates(cs, facts);
  deq(gates.map((g) => g.name), ['ROOT_DETECTED', 'PATCH_AGE', 'STORAGE_VERIFY_ERRORS', 'GPU_HASH_MISMATCH', 'SUSTAINED_CEILING'], 'V8: ترتيب computeGates نفسه بلا LOW_CATEGORY_COVERAGE');
  eq(gates[0], cs.gates[0], 'V8: ROOT_DETECTED هي بوّابة V7 نفسها');
  eq(gates[1], cs.gates[1], 'V8: PATCH_AGE هي بوّابة V7 نفسها');
  eq(gates.find((g) => g.name === 'SUSTAINED_CEILING').status, 'DISABLED', 'V8: SUSTAINED_CEILING تبقى DISABLED (دورها صار حرف المعالج)');
  eq(gates.find((g) => g.name === 'STORAGE_VERIFY_ERRORS').status, 'INPUT_ABSENT', 'V8: STORAGE_VERIFY_ERRORS موصولة (ختم 67: لا حالة تحقّق)');
  eq(gates.find((g) => g.name === 'GPU_HASH_MISMATCH').status, 'NOT_FIRED', 'V8: GPU_HASH_MISMATCH موصولة (14/14 وGEMM ومهلة 0)');
  // مسار HARNESS_ERROR: gates فارغة ⟵ تُلحَق الموصولتان.
  const harness = AL.buildAdvisoryGates({gates: []}, facts);
  deq(harness.map((g) => g.name), ['STORAGE_VERIFY_ERRORS', 'GPU_HASH_MISMATCH'], 'بلا بوّابات V7: الموصولتان تُلحَقان');
  deq(AL.buildAdvisoryGates(null, facts).map((g) => g.name), ['STORAGE_VERIFY_ERRORS', 'GPU_HASH_MISMATCH'], 'categoryStates غائبة: الموصولتان');
}

// ═══════════════════════════════════════════════════════════════════════
// H. الفحوص الحقيقية الأربعة من fingerprint الخام إلى الحرف العامّ
// ═══════════════════════════════════════════════════════════════════════
const SCAN_IDS = {
  '8909e850-s10.ts.json': '8909e850-b10c-466c-899a-ce97cb5c4fbe', 'b45c8cf6.ts.json': 'b45c8cf6-e376-4765-8703-f68e9bc69844',
  '34dff2b8.ts.json': '34dff2b8-ce9e-4b40-86a9-1976c878e195', 'e4b65a2f-honor.ts.json': 'e4b65a2f-3a0c-4f11-939d-17eab7d0912f',
};
const functionalByScan = loadJson('functionalResults-by-scanid.json').byScanId;
function chain(file, stability) {
  const raw = loadJson(file);
  const functional = functionalByScan[SCAN_IDS[file]];
  const fp = {device: {}, timeSeries: raw, functionalResults: functional === null ? [] : functional, manualResults: []};
  const findings = computeFindings(fp);
  const fv68 = readFv68(fp);
  const features = computeFeatureLibrary({fingerprint: fp, findings, fv68});
  const inp = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({functionalResults: functional, manualResults: [], dev: null, findings, batterySampleInputs: inp.sampleInputs, batteryDesignCapacityMah: inp.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS});
  return {findings, fv68, features, categoryStates, out: AL.computeAdvisoryLetters({features, findings, fv68, categoryStates, stability: stability || null})};
}
{
  // بلا بيّنة ثبات (حال اليوم: لا فحوص مكرّرة ولا مخزن بعد): لا خاصّية متّصلة تدخل حرفاً — الواقعة وحدها.
  const r = {};
  for (const f of Object.keys(SCAN_IDS)) r[f] = chain(f);
  for (const f of Object.keys(SCAN_IDS)) {
    const c = r[f].out.categories;
    eq(c.cpu.letter, null, `${f}: cpu بلا بيّنة ثبات ⟵ لا حرف`);
    eq(c.cpu.reason, R.STABILITY_NOT_ESTABLISHED, `${f}: سبب cpu مسمّى`);
    eq(c.storage.letter, null, `${f}: storage بلا حرف (لا منتِج تحقّق في fv67: P5 :164)`);
    eq(c.storage.reason, R.STORAGE_VERIFY_NOT_RUN, `${f}: سبب storage`);
    eq(c.memory.letter, null, `${f}: memory بلا حرف (لا عدّاد في fv67)`);
    eq(c.gpu.letter, 'A', `${f}: gpu A (14/14 وGEMM ومهلة 0، أساس GEMM معلن LEGACY_DEFAULT_TRUE)`);
    eq(c.gpu.inputs.gemmBasis, 'LEGACY_DEFAULT_TRUE', `${f}: أساس GEMM يُرى`);
    eq(r[f].out.lettersVersion, 1, `${f}: lettersVersion`);
    eq(r[f].out.thresholdSetVersion, TS.THRESHOLD_SET_VERSION, `${f}: thresholdSetVersion = نسخة المجموعة`);
    deq(Object.keys(r[f].out.categories), AL.ADVISORY_CATEGORIES.slice(), `${f}: الفئات الستّ بالترتيب`);
    deq(JSON.parse(JSON.stringify(r[f].out)), r[f].out, `${f}: الناتج قابل للتسلسل بلا فقد`);
    deq(chain(f).out, r[f].out, `${f}: حتمي`);
  }
  // الحرارة بواقعة وحدها: الحالة القصوى 3 (SEVERE) ⟵ B بلا حاجة لبيّنة.
  eq(r['b45c8cf6.ts.json'].out.categories.thermal.letter, 'B', 'b45c8cf6: SEVERE ⟵ thermal B بلا بيّنة');
  eq(r['34dff2b8.ts.json'].out.categories.thermal.letter, 'B', '34dff2b8: SEVERE ⟵ thermal B');
  eq(r['8909e850-s10.ts.json'].out.categories.thermal.letter, null, '8909e850: حالة 2 وheadroom بلا بيّنة ⟵ لا A');
  // الأمان من V7 كما هو: الفحصان الجذريان D.
  eq(r['b45c8cf6.ts.json'].out.categories.security.letter, 'D', 'b45c8cf6: الأمان D من V7 (جذر)');
  eq(r['b45c8cf6.ts.json'].out.categories.security.letter, r['b45c8cf6.ts.json'].categoryStates.categories.security.deterministicLetter, 'الأمان = حرف V7 المخزَّن حرفياً');
  eq(r['e4b65a2f-honor.ts.json'].out.categories.security.reason, R.V7_NO_LETTER, 'Honor: functionalResults غائبة (404) ⟵ الأمان بلا حرف');
  eq(r['e4b65a2f-honor.ts.json'].out.categories.security.reasonDetail, 'state=HARNESS_ERROR', 'Honor: حالة V7 معلنة');
  // الحرف العامّ: gpu A و(thermal B وsecurity D في b45c8cf6) = (7.5×1 + 4.5×0 + 15×3)/27 = 1.944 ⟵ C؛ البوّابتان FIRED لا تغيّران (C).
  const o = r['b45c8cf6.ts.json'].out.overall;
  near(o.rankMean, (7.5 * 1 + 4.5 * 0 + 15 * 3) / 27, 1e-12, 'b45c8cf6: المتوسّط');
  eq(o.letter, 'C', 'b45c8cf6: الحرف العامّ C');
  eq(o.letterSource, 'BAND', 'b45c8cf6: من المتوسّط (الجذر C لا يزيد)');
  eq(o.advisory, true, 'b45c8cf6: إرشادي');
  eq(r['b45c8cf6.ts.json'].out.gates.find((g) => g.name === 'ROOT_DETECTED').status, 'FIRED', 'b45c8cf6: ROOT_DETECTED FIRED من categoryStates الحقيقية');

  // بيّنة الثبات من الفحوص الثلاثة لجهاز واحد مفترض (S10 5G: 8909e850 وb45c8cf6 و34dff2b8 — **هويّة الجهاز غير مثبتة**: مفتاح الجهاز ينتظر HMAC؛ تُستعمل هنا لتشغيل المسار بقيم حقيقية فقط).
  const trio = ['8909e850-s10.ts.json', 'b45c8cf6.ts.json', '34dff2b8.ts.json'];
  const vals = (pick) => trio.map((f) => pick(r[f]));
  const stability = {
    [PROPERTY.CPU_CEILING_COMBINED]: AL.assessStability(vals((x) => x.findings.sustainedCeiling.combined.meanWindowMaxRatio), letterOfCeiling),
    [PROPERTY.CPU_RECOVERY]: AL.assessStability(vals((x) => x.features.features[FEATURE.CPU_RECOVERY_P7].value), (v) => (v >= T.cpuRecoveryA.value ? 'A' : 'B')),
    [PROPERTY.THERMAL_HEADROOM_PEAK]: AL.assessStability(vals((x) => x.features.features[FEATURE.THERMAL_HEADROOM_PEAK].value), (v) => (v >= T.thermalHeadroomSevere.value ? 'B' : 'A')),
  };
  eq(stability[PROPERTY.CPU_CEILING_COMBINED].letterStable, true, 'الثلاثة: حرف السقف ثابت (B/B/B)');
  ok(stability[PROPERTY.CPU_CEILING_COMBINED].cvPct < 2, 'الثلاثة: CV السقف دون 2%');
  eq(stability[PROPERTY.THERMAL_HEADROOM_PEAK].letterStable, false, 'الثلاثة: headroom يعبر 1.0 (0.947 / 1.007 / 1.027) ⟵ الحرف يتقلّب');
  const withEv = {};
  for (const f of trio) withEv[f] = chain(f, stability);
  for (const f of trio) {
    eq(withEv[f].out.categories.cpu.letter, 'B', `${f}: cpu B ببيّنة الثبات`);
    eq(withEv[f].out.categories.cpu.basis, 'PROPERTIES', `${f}: أساس cpu الخصائص`);
    near(withEv[f].out.categories.cpu.inputs.ceiling, withEv[f].findings.sustainedCeiling.combined.meanWindowMaxRatio, 0, `${f}: مُدخل السقف = findings نفسه`);
  }
  eq(withEv['8909e850-s10.ts.json'].out.categories.thermal.letter, null, '8909e850: headroom خرج للتقلّب ⟵ لا A');
  eq(withEv['8909e850-s10.ts.json'].out.categories.thermal.reason, R.LETTER_FLUCTUATES, '8909e850: السبب التقلّب');
  eq(withEv['b45c8cf6.ts.json'].out.categories.thermal.letter, 'B', 'b45c8cf6: thermal B (SEVERE واقعة)');
  eq(withEv['b45c8cf6.ts.json'].out.overall.letter, 'C', 'b45c8cf6: العامّ C ببيّنة الثبات');
  near(withEv['b45c8cf6.ts.json'].out.overall.rankMean, (7.5 * 1 + 7.5 * 1 + 4.5 * 0 + 15 * 3) / 34.5, 1e-12, 'b45c8cf6: المتوسّط مع cpu B وthermal B');
  const cpuProps = withEv['b45c8cf6.ts.json'].out.categories.cpu.properties;
  eq(cpuProps.find((p) => p.name === PROPERTY.CPU_RECOVERY).state, PROPERTY_STATE.ADMITTED, 'التعافي 0.714×3 ثابت فيدخل');
  eq(cpuProps.find((p) => p.name === PROPERTY.CPU_RECOVERY).displayAs, 'LETTER_INPUT', 'ويدخل الحرف');

  // Honor: بيّنة **اصطناعية** موسومة (فحص واحد حقيقي لا يكفي لثبات) ⟵ A للمعالج والحرارة.
  const synthEv = {[PROPERTY.CPU_CEILING_COMBINED]: STABLE, [PROPERTY.CPU_RECOVERY]: STABLE, [PROPERTY.THERMAL_HEADROOM_PEAK]: STABLE};
  const honor = chain('e4b65a2f-honor.ts.json', synthEv).out;
  eq(honor.categories.cpu.letter, 'A', 'Honor ببيّنة اصطناعية: cpu A (سقف 0.9986 وتعافٍ 1)');
  eq(honor.categories.thermal.letter, 'A', 'Honor ببيّنة اصطناعية: thermal A (حالة 0، headroom 0.726)');
  eq(honor.overall.letter, 'A', 'Honor: العامّ A (معالج وحرارة ورسوميات)');
  eq(honor.overall.categoriesCounted.length, 3, 'Honor: ثلاث فئات داخلة (الأمان بلا حرف)');
}

// ═══════════════════════════════════════════════════════════════════════
// H2. مُنتِجات fv71/fv70 الحقيقية: التخزين والذاكرة والرسوميات والمعالج بحقائق التحقّق الفعلية
// ═══════════════════════════════════════════════════════════════════════
{
  const run = (file, stability) => {
    const fp = loadJson(file);
    const findings = computeFindings(fp);
    const fv68 = readFv68(fp);
    const features = computeFeatureLibrary({fingerprint: fp, findings, fv68});
    return AL.computeAdvisoryLetters({features, findings, fv68, categoryStates: null, stability});
  };
  const a = run(FV71_11, {[PROPERTY.STORAGE_POST_OVER_IN_CACHE]: {cvPct: null, letterStable: true}, [PROPERTY.CPU_CEILING_COMBINED]: STABLE, [PROPERTY.CPU_RECOVERY]: STABLE});
  eq(a.categories.memory.letter, 'A', 'fv71 11ch: الذاكرة A (ran بثلاثة أصفار)');
  eq(a.categories.gpu.letter, 'A', 'fv71 11ch: الرسوميات A (GEMM من الحالة passed)');
  eq(a.categories.gpu.inputs.gemmBasis, 'STATE', 'fv71 11ch: أساس GEMM الحالة لا الافتراض');
  eq(a.categories.storage.inputs.noKnee, true, 'fv71 11ch: لا ركبة في المقاطع');
  eq(a.categories.storage.letter, 'A', 'fv71 11ch: التخزين A (ran، 0 أخطاء، لا ركبة، حرف ثابت)');
  eq(run(FV71_11, {}).categories.storage.letter, null, 'fv71 11ch بلا بيّنة: لا حرف للتخزين (لا ركبة تتقلّب؟ لا يُعرف)');
  eq(a.categories.security.reason, R.INPUT_ABSENT, 'بلا categoryStates: الأمان مُدخل غائب');
  // 16ch: لا شيء منفَّذ كاملاً ⟵ لا حروف للتخزين/الذاكرة/الرسوميات (partial / not_run / not_run).
  const b = run(FV71_16, {});
  for (const c of ['storage', 'memory', 'gpu']) eq(b.categories[c].letter, null, `fv71 16ch: ${c} بلا حرف (لم يكتمل التحقّق)`);
  eq(b.categories.storage.reason, R.STORAGE_VERIFY_NOT_RUN, 'fv71 16ch: التخزين partial ⟵ لا ran');
  eq(b.categories.memory.reason, R.MEMORY_VERIFY_NOT_COMPLETE, 'fv71 16ch: الذاكرة not_run');
  eq(b.categories.gpu.reason, R.GPU_VERIFICATION_INCOMPLETE, 'fv71 16ch: GEMM not_run');
  // fv70 13ch: عدم تطابق حقيقي في المعالج ⟵ D من حكم الخادم على الخامّ؛ والبوّابات: GPU/STORAGE حسب الحقائق.
  const d = run(FV70_13, null);
  eq(d.categories.cpu.letter, 'D', 'fv70 13ch: cpu D (78499 ≠ 78498) بلا حاجة لبيّنة ثبات');
  eq(d.categories.cpu.basis, 'FACT', 'fv70 13ch: أساس D حقيقة');
  ok(d.categories.cpu.inputs.knownAnswerMismatchRuns >= 1, 'fv70 13ch: عدد التشغيلات غير المتطابقة مُعلَن');
  ok(['C', 'D'].includes(d.overall.letter), 'fv70 13ch: العامّ C أو D (المعالج D مع فئات A أخرى: المتوسّط المرجَّح لا يجعله D وحده)');
  eq(d.overall.categoriesCounted.find((c) => c.category === 'cpu').letter, 'D', 'fv70 13ch: المعالج داخل الحرف العامّ بحرفه D');
}

// ═══════════════════════════════════════════════════════════════════════
// H3. لا عيّنات صالحة، ومُدخلات رديئة: لا رمي، والسبب مسمّى
// ═══════════════════════════════════════════════════════════════════════
{
  const empty = AL.computeAdvisoryLetters({});
  eq(empty.overall.letter, null, 'مُدخل فارغ: لا حرف عامّ');
  eq(empty.overall.letterSource, 'NO_DATA', 'مُدخل فارغ: NO_DATA');
  for (const c of AL.ADVISORY_CATEGORIES) eq(empty.categories[c].letter, null, `مُدخل فارغ: ${c} بلا حرف`);
  eq(AL.computeAdvisoryLetters(null).overall.noDataAtAll, true, 'null: لا رمي');
  const hf = computeFeatureLibrary({fingerprint: {timeSeries: {header: {}, footer: {fieldsVersion: 71}, samples: [], variables: []}}});
  const r = AL.computeAdvisoryLetters({features: hf, findings: computeFindings({}), fv68: readFv68({}), categoryStates: null});
  eq(r.categories.cpu.reason, R.HARNESS_ERROR, 'مكتبة NOT_MEASURED: cpu HARNESS_ERROR');
  eq(r.categories.thermal.reason, R.HARNESS_ERROR, 'مكتبة NOT_MEASURED: thermal HARNESS_ERROR');
  eq(r.categories.gpu.reason, R.GPU_VERIFICATION_INCOMPLETE, 'مكتبة NOT_MEASURED: حقائق التذييل تبقى قيد النظر (لا تُنسى)');
  // حقيقة D من التذييل تبقى معتبرة ولو غابت العيّنات.
  const footerOnly = AL.computeAdvisoryLetters({features: hf, findings: computeFindings({}), fv68: readFv68(synthPayload({
    gpuFragmentHashMatches: 12, gpuFragmentHashTotal: 14, gpuFenceTimeoutCount: 0, gpuComputeGemmCorrect: true, gpuComputeGemmState: 'passed',
    memoryVerifyState: 'ran', memoryMarchErrors: 3, memoryWalkingOnesErrors: 0, memoryRandomVerifyErrors: 0,
    storageVerifyState: 'ran', storageWriteVerifyErrors: 0, storageReadVerifyErrors: 1,
  })), categoryStates: null});
  eq(footerOnly.categories.gpu.letter, 'D', 'تجزئة 12/14 ⟵ gpu D من التذييل وحده');
  eq(footerOnly.categories.memory.letter, 'D', 'خطأ march ⟵ memory D');
  eq(footerOnly.categories.storage.letter, 'D', 'خطأ قراءة راجعة ⟵ storage D');
  eq(footerOnly.overall.letter, 'D', 'العامّ D من ثلاث فئات D');
  deq(footerOnly.gates.filter((g) => g.status === 'FIRED').map((g) => g.name), ['STORAGE_VERIFY_ERRORS', 'GPU_HASH_MISMATCH'], 'البوّابتان FIRED من التذييل');
  eq(footerOnly.overall.letterSource, 'BAND', 'المصدر المتوسّط (D أصلاً)');
}

// ═══════════════════════════════════════════════════════════════════════
// I. الوثيقة تعدّد كل اسم (القاعدتان 7 و25)
// ═══════════════════════════════════════════════════════════════════════
{
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'PROTOCOL_CONTRACT.md'), 'utf8');
  const start = doc.indexOf('### ٢-ب-٢ — الحروف الإرشادية');
  const end = doc.indexOf('## ٣ — أرقام الإصدارات');
  ok(start !== -1 && end > start, 'قسم الحروف الإرشادية موجود في العقد');
  const section = doc.slice(start, end);
  const documented = (v) => section.includes('`' + v + '`');
  for (const v of Object.values(R)) ok(documented(v), 'ADVISORY_REASON.' + v + ' مذكور');
  for (const v of Object.values(PROPERTY)) ok(documented(v), 'PROPERTY ' + v + ' مذكورة');
  for (const v of Object.values(AL.PROPERTY_KIND)) ok(documented(v), 'PROPERTY_KIND.' + v + ' مذكور');
  for (const v of Object.values(PROPERTY_STATE)) ok(documented(v), 'PROPERTY_STATE.' + v + ' مذكور');
  for (const v of Object.values(AL.DISPLAY_AS)) ok(documented(v), 'DISPLAY_AS.' + v + ' مذكور');
  for (const v of Object.values(AL.BASIS)) ok(documented(v), 'BASIS.' + v + ' مذكور');
  for (const v of Object.values(AL.GEMM_VERDICT)) ok(documented(v), 'GEMM_VERDICT.' + v + ' مذكور');
  for (const v of ['STATE', 'LEGACY_VALUE', 'LEGACY_DEFAULT_TRUE']) ok(documented(v), 'أساس GEMM ' + v + ' مذكور');
  for (const k of Object.keys(T)) ok(documented(k), 'حدّ ' + k + ' مذكور');
  for (const g of ['ROOT_DETECTED', 'PATCH_AGE', 'STORAGE_VERIFY_ERRORS', 'GPU_HASH_MISMATCH', 'SUSTAINED_CEILING', 'LOW_CATEGORY_COVERAGE']) ok(documented(g), 'بوّابة ' + g + ' مذكورة');
  const out = chain('b45c8cf6.ts.json').out;
  const sigOf = (obj) => Object.keys(obj);
  const sigAt = (label) => { const i = section.indexOf(label); return i === -1 ? '' : section.slice(i, section.indexOf('\n', i)); };
  for (const [label, keys] of [
    ['**المستوى الأعلى:**', sigOf(out)], ['**سجلّ الفئة:**', sigOf(out.categories.cpu)], ['**سجلّ الخاصّية:**', sigOf(out.categories.cpu.properties[0])],
    ['**الحرف العامّ:**', sigOf(out.overall)], ['**عنصر categoriesCounted:**', sigOf(out.overall.categoriesCounted[0])], ['**التقدير assessStability:**', sigOf(AL.assessStability([1, 1, 1], () => 'A'))],
  ]) {
    const line = sigAt(label);
    ok(line.length > 0, 'سطر ' + label + ' في العقد');
    for (const k of keys) ok(line.includes('`' + k + '`'), label + ' يذكر المفتاح ' + k);
  }
  const g = out.gates.find((x) => x.name === 'GPU_HASH_MISMATCH');
  ok(Object.keys(g).every((k) => section.includes('`' + k + '`')), 'مفاتيح عنصر البوّابة مذكورة');
}

// ═══════════════════════════════════════════════════════════════════════
// J. لا شبكة ولا حالة مشتركة
// ═══════════════════════════════════════════════════════════════════════
{
  for (const f of ['advisoryLetters.js', 'thresholdSetVersioned.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', f), 'utf8');
    ok(!/require\(['"](firebase-admin|https?|net|child_process|node-fetch|axios)['"]\)/.test(src), `${f}: لا استيراد لشبكة/Firestore/عمليات`);
    ok(!/\bfetch\(|\bfs\.(write|append|unlink|rm)|\bconsole\./.test(src), `${f}: لا طلب شبكة ولا كتابة ملفّ ولا console`);
  }
  // لا اتصال مع مسار الإنتاج: لا ملفّ في src غير الاختبارات والمحرّك نفسه يستورد المحرّك.
  const SRC = path.join(__dirname, '..', 'src');
  const importers = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && /require\(['"][^'"]*advisoryLetters['"]\)|require\(['"][^'"]*thresholdSetVersioned['"]\)/.test(fs.readFileSync(p, 'utf8'))) importers.push(path.relative(SRC, p).split(path.sep).join('/'));
    }
  })(SRC);
  deq(importers.sort(), ['analysis/advisoryLetters.js'], 'لا شيء في src يستورد المحرّك سوى المحرّك نفسه لمجموعة الحدود: غير موصول بمسار الإنتاج (S-B7)');
}

console.log(`advisoryLetters.test.js: ALL PASS (${n} assertions)`);


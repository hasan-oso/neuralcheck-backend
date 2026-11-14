'use strict';

// scanSignatureAbsence.test.js — الدفعة ٤ من V8 (PLAN-05)، البندان ٤ و٥ من الأمر والقاعدة 22.
//
// «computeScanSignature.js بلا `|| 0` ولا `!== false`» و«قرّاء cpuPrimeSieveCorrect/cpuFmaErrors الثلاثة يُراجَعون،
//  وcpuFmaErrors يُعلن غائباً لا صفراً، وقارئ لـcpuKnownAnswerState/cpuKnownAnswerRuns[]».
// القارئات الثلاثة: findings.js:84 (قائمة A76 لـ≤ 67 — تبقى وتُحرَس في findings.test.js)، reevaluationDecision.js:18-31،
// computeScanSignature.js:45-53. هذا الاختبار يحرس الأخيرين، على الشكل الذي يستقبلانه فعلاً (حمولات التطبيق الذهبية).
//
// القاعدة المثبَتة: الغائب يبقى غائباً (null) لا صفراً ولا true ولا false:
//   • عدّاد غائب ≠ صفر أخطاء  • فحص غائب ≠ نجاح  • حكم «لا عيب» غائب ≠ false.
// ⚠️ ما يبقى وليس إصلاحاً: storageWriteVerifyErrors/storageReadVerifyErrors = 0 في ختم ≤ 67 (ثابتان حرفيان في التطبيق، عقد :250) يُقرآن 0
//    كما أُرسلا — لا يُعلَن غياب بنصّ مفتاح غائب لأن المفتاح حاضر؛ يُذكر قيداً في تقرير الدفعة.
//
// Run: node functions/test/scanSignatureAbsence.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {computeScanSignature} = require('../src/signatures/computeScanSignature');
const {signatureDifference} = require('../src/signatures/signatureDifference');
const {reevaluationDecision, DETERMINISTIC_BOOLS, ERROR_COUNTERS} = require('../src/signatures/reevaluationDecision');
const N = require('../src/analysis/fv68Names');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEMS = ['11ch-nothing-admitted', '13ch-selinux-blocked-policy', '16ch-four-policies-truncated-failures'];
const load = (stem) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-${stem}.json`), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const fv67 = () => JSON.parse(fs.readFileSync(path.join(GOLDEN, 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json'), 'utf8')).fingerprint;
const SIG = {};
for (const s of STEMS) SIG[s] = computeScanSignature(load(s));
const SIG67 = computeScanSignature(fv67());

// ═══════════════════════════════════════════════════════════════════
// أ) fv67 (حمولة 1.0.10): ما كان يُقرأ نجاحاً صار غائباً صريحاً
// ═══════════════════════════════════════════════════════════════════
{
  const v = SIG67.verification;
  eq([v.cpuFmaErrors, v.cpuPrimeSieveCorrect, v.memoryMarchPassed, v.memoryWalkingOnesPassed, v.memoryRandomVerifyErrors],
      [null, null, null, null, null], '[أ] الخمسة الغائبة في fv67 (A76): null لا 0 ولا true');
  eq(v.gpuComputeGemmCorrect, true, '[أ] gpuComputeGemmCorrect حاضر في fv67 (true) فيُقرأ كما أُرسل');
  eq(v.criticalDefectDetected, false, '[أ] criticalDefectDetected حاضر في fv67 (false) فيُقرأ كما أُرسل');
  eq('cpuKnownAnswerMismatches' in v, false, '[أ] مفتاح cpuKnownAnswerMismatches لا يدخل توقيع ختم < 68 (لا فارق صامت مع توقيع قديم)');
  eq([v.storageWriteVerifyErrors, v.storageReadVerifyErrors], [0, 0], '[أ] storage*VerifyErrors = 0 كما أرسلها 1.0.10 (مفتاح حاضر) — قيد معروف يُذكر لا يُصلَح هنا');
  eq(typeof v.cpuTempCoverage, 'number', '[أ] التغطية الحاضرة (0 ثابتة معلنة في unmeasuredDefaults) تُقرأ رقماً');
}
// الغياب التام لكل حقول التحقّق
{
  const bare = computeScanSignature({timeSeries: {footer: {}}});
  const v = bare.verification;
  eq(Object.entries(v).filter(([k, x]) => x === null).map(([k]) => k).sort(),
      ['cpuFmaErrors', 'cpuPrimeSieveCorrect', 'criticalDefectDetected', 'gpuComputeGemmCorrect', 'memoryMarchPassed', 'memoryRandomVerifyErrors',
        'memoryWalkingOnesPassed', 'cpuTempCoverage', 'skinTempCoverage', 'storageReadVerifyErrors', 'storageWriteVerifyErrors'].sort(),
      '[أ] تذييل بلا شيء: كل حقول التحقّق والتغطية null — لا 0 ولا true ولا false (A76 الخمسة + الباقي)');
  eq(computeScanSignature({}).verification.criticalDefectDetected, null, '[أ] fingerprint فارغ: criticalDefectDetected null لا «لا عيب»');
  // الاحتياط الخلفي: verificationResults في جذر الحمولة (كما كان يقرأ الكود القديم)
  const root = computeScanSignature({verificationResults: {memoryRandomVerifyErrors: 4, gpuComputeGemmCorrect: false}});
  eq([root.verification.memoryRandomVerifyErrors, root.verification.gpuComputeGemmCorrect], [4, false], '[أ] verificationResults من الجذر ما زال يُقرأ (التوافق الخلفي)');
}

// ═══════════════════════════════════════════════════════════════════
// ب) fv68: القراءة بالحالة والاشتقاق الصريح
// ═══════════════════════════════════════════════════════════════════
{
  const a = SIG['11ch-nothing-admitted'].verification;
  eq([a.memoryMarchPassed, a.memoryWalkingOnesPassed, a.memoryRandomVerifyErrors], [true, true, 0], '[ب][11ch] الذاكرة ran بصفر أخطاء: …Passed true مشتقّة، وعدّاد عشوائي 0 حقيقي');
  eq([a.storageWriteVerifyErrors, a.storageReadVerifyErrors], [0, 0], '[ب][11ch] التخزين ran: أصفار حقيقية');
  eq(a.cpuKnownAnswerMismatches, 0, '[ب][11ch] فحوص النتيجة المعروفة: لا عدم تطابق');
  eq([a.cpuFmaErrors, a.cpuPrimeSieveCorrect], [null, null], '[ب][11ch] cpuFmaErrors وcpuPrimeSieveCorrect: لا يُرسلهما fv68 ← غائبان (لا 0 ولا true)');
  eq([a.gpuComputeGemmCorrect, a.criticalDefectDetected], [true, false], '[ب][11ch] gemm وcriticalDefect حاضران');
  const b = SIG['13ch-selinux-blocked-policy'].verification;
  eq([b.memoryMarchPassed, b.memoryWalkingOnesPassed], [null, null], '[ب][13ch] الذاكرة partial بصفر أخطاء: …Passed null (لم يُغطَّ كل المخزن)');
  eq(b.storageWriteVerifyErrors, 2, '[ب][13ch] أخطاء الكتابة 2 تدخل التوقيع');
  eq(b.cpuKnownAnswerMismatches, 1, '[ب][13ch] فحص غربال غير مطابق واحد يدخل التوقيع');
  const c = SIG['16ch-four-policies-truncated-failures'].verification;
  eq([c.memoryMarchPassed, c.memoryWalkingOnesPassed, c.memoryRandomVerifyErrors], [null, null, null], '[ب][16ch] الذاكرة not_run: كلّها null لا true ولا 0');
  eq([c.gpuComputeGemmCorrect, c.criticalDefectDetected], [null, null], '[ب][16ch] gemm لم يجرِ: غائبان لا true ولا false');
  eq(c.cpuKnownAnswerMismatches, 0, '[ب][16ch] ran: صفر عدم تطابق حقيقي (خطأ نداء وتشغيل لم يُبلَغ لا يُحسبان)');
  eq(c.storageReadVerifyErrors, 0, '[ب][16ch] التخزين partial: عدّاد القراءة حاضر');
  // الاشتقاق من خطأ موجب
  const m = clone(load('11ch-nothing-admitted'));
  m.timeSeries.footer.verificationResults.memoryMarchErrors = 5;
  eq(computeScanSignature(m).verification.memoryMarchPassed, false, '[ب] memoryMarchErrors=5 مع ran ← memoryMarchPassed=false');
  // مفتاح قديم حاضر (حمولة أقدم) يُقرأ كما هو
  const old = computeScanSignature({timeSeries: {footer: {verificationResults: {cpuFmaErrors: 3, cpuPrimeSieveCorrect: false, memoryMarchPassed: false}}}});
  eq([old.verification.cpuFmaErrors, old.verification.cpuPrimeSieveCorrect, old.verification.memoryMarchPassed], [3, false, false], '[ب] المفاتيح القديمة إن وصلت تُقرأ بقيمها (لا تُشتقّ فوقها)');
  // التغطية
  const cov = clone(load('11ch-nothing-admitted'));
  cov.timeSeries.footer.dataQuality.cpuTempCoveragePct = 84;
  delete cov.timeSeries.footer.dataQuality.skinTempCoveragePct;
  const sc = computeScanSignature(cov).verification;
  eq([sc.cpuTempCoverage, sc.skinTempCoverage], [80, null], '[ب] تغطية 84 ← 80 (مدوّرة)، والغائبة null لا 0');
}

// ═══════════════════════════════════════════════════════════════════
// جـ) القرار: الغائب لا يُقارَن صفراً
// ═══════════════════════════════════════════════════════════════════
{
  const decide = (newFp, oldFp) => reevaluationDecision(computeScanSignature(newFp), computeScanSignature(oldFp));
  const base = load('11ch-nothing-admitted');
  const sameBase = decide(base, base);
  eq(sameBase, {forceReevaluate: false, reasons: [], maintenanceSuspected: false}, '[جـ] فحصان متطابقان: لا إعادة تقييم');
  // عدّاد جديد موجب بلا سابق (غائب): عيب ظهر قياسه
  const withErr = clone(base);
  withErr.timeSeries.footer.verificationResults.memoryRandomVerifyErrors = 3;
  const old67 = fv67();
  const d1 = decide(withErr, old67);
  ok(d1.reasons.includes('verification:memoryRandomVerifyErrors absent→3'), '[جـ] عدّاد موجب جديد مقابل غائب: «absent→3» (لا 0→3 مختلَقة)');
  // عدّاد جديد غائب: لا يُقارَن
  const d2 = decide(old67, withErr);
  ok(!d2.reasons.some((r) => r.includes('memoryRandomVerifyErrors')), '[جـ] عدّاد جديد غائب مقابل سابق موجب: لا مقارنة (لم يُقَس) ولا «3→0»');
  // pass→fail من true صريحة إلى false صريحة فقط
  const failNow = clone(base);
  failNow.timeSeries.footer.verificationResults.memoryMarchErrors = 4;
  const d3 = decide(failNow, base);
  ok(d3.forceReevaluate && d3.reasons.includes('verification:memoryMarchPassed pass→fail'), '[جـ] ran بصفر ثم ran بأخطاء: memoryMarchPassed pass→fail');
  const d4 = decide(clone(load('16ch-four-policies-truncated-failures')), base);
  ok(!d4.reasons.some((r) => r.includes('memoryMarchPassed')), '[جـ] ran ثم not_run (null): لا pass→fail — الغياب لا يُقرأ فشلاً');
  // عدم تطابق جديد في النتيجة المعروفة مسبقاً
  const d5 = decide(load('13ch-selinux-blocked-policy'), base);
  ok(d5.reasons.includes('verification:cpuKnownAnswerMismatches 0→1'), '[جـ] عدم تطابق غربال جديد: cpuKnownAnswerMismatches 0→1');
  // criticalDefect: انقلاب إلى true
  const crit = clone(base);
  crit.timeSeries.footer.verificationResults.criticalDefectDetected = true;
  ok(decide(crit, base).reasons.includes('verification:criticalDefectDetected →true'), '[جـ] criticalDefectDetected false→true يُطلق إعادة التقييم (كما كان)');
  // الأسماء من المصدر الواحد
  eq(DETERMINISTIC_BOOLS.slice(0, 4), [N.VERIFICATION.CPU_PRIME_SIEVE_CORRECT_LEGACY, N.VERIFICATION.MEMORY_MARCH_PASSED_LEGACY,
    N.VERIFICATION.MEMORY_WALKING_ONES_PASSED_LEGACY, N.VERIFICATION.GPU_COMPUTE_GEMM_CORRECT], '[جـ] أسماء الوقائع المنطقية من fv68Names (القاعدة 24)');
  eq(ERROR_COUNTERS.slice(0, 4), [N.VERIFICATION.CPU_FMA_ERRORS_LEGACY, N.VERIFICATION.MEMORY_RANDOM_VERIFY_ERRORS,
    N.VERIFICATION.STORAGE_WRITE_VERIFY_ERRORS, N.VERIFICATION.STORAGE_READ_VERIFY_ERRORS], '[جـ] وأسماء العدّادات كذلك');
  ok(ERROR_COUNTERS.includes('cpuKnownAnswerMismatches'), '[جـ] وعدّاد النتيجة المعروفة مسبقاً مُدرَج');
}

// ═══════════════════════════════════════════════════════════════════
// د) اتّساق التوقيع بين النسختين (قبل/بعد) — التغيّر مقيس لا مفترَض
// ═══════════════════════════════════════════════════════════════════
{
  eq(signatureDifference(SIG['11ch-nothing-admitted'], SIG['11ch-nothing-admitted']), 0, '[د] التوقيع حتميّ: الحمولة نفسها ← فرق 0');
  const d = signatureDifference(SIG['11ch-nothing-admitted'], SIG67);
  ok(d > 0 && d < 1, `[د] حمولتا fv68 وfv67 للجهاز نفسه: فرق جزئي (${(d * 100).toFixed(1)}%) لا 0 ولا كلّي`);
  const keys67 = Object.keys(SIG67.verification);
  const keys68 = Object.keys(SIG['11ch-nothing-admitted'].verification);
  eq(keys68.filter((k) => !keys67.includes(k)), ['cpuKnownAnswerMismatches'], '[د] الفارق الوحيد في مفاتيح التوقيع بين 67 و68: cpuKnownAnswerMismatches');
}

console.log(`\nscanSignatureAbsence.test.js: ${n}/${n} assertions passed`);

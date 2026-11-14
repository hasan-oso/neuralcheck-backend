'use strict';

// cpuKnownAnswerFv70.test.js — قرّاء D للمعالج في fv70 (2026-10-13 +03). عيّنات fv70 الثلاث نُسخت بايتاً ببايت من NeuralChek@80ca8c3 (§٧-ط من عقد التطبيق؛ منقول من أمر المنسّق، غير متحقَّق من المستودع المصدر).
//
// قرار المستخدم، بنصّه (منقول، غير متحقَّق): «وقرّاء الخادم يعرفون skipped:time_budget قبل أن يُرسله أيّ تطبيق (القاعدة 25)، فهو نشر خادم قبل 1.0.12 أو معه.» وجوابه على اسم الحالة الإجمالية: "Accept partial:time_budget (Recommended)".
// ما أرسله التطبيق (منقول): sieveLimit (عدد صحيح، 1000000 اليوم) يُشحن مع match وmismatch وalloc_failed ويغيب مع native_call_failed وnative_result_unreadable وnot_reached وskipped:time_budget؛ المرجع π(N) بحسب sieveLimit لا بثابت
// (1000000 ⟵ 78498، وختم 68 و69 بلا sieveLimit: N = 10000000 ⟵ 664579)؛ القيمة skipped:time_budget في sieveStatus وsha256Status معاً؛ cpuKnownAnswerState: ran = بلا متروك، partial:time_budget = أُبلغ نصف على الأقلّ وتُرك تشغيل،
// not_run:<سبب> متى لم يُبلَّغ أيّ نصف؛ العنصر المتروك بمفاتيحه الأربعة وحدها (phase, plannedAtPct, sieveStatus, sha256Status) ويبقى في القائمة (ثلاثة لكل مرحلة)؛ cpuKnownAnswerTotalMsByPhase لا يدخله المتروك؛ fieldsVersion 70.
//
// سؤال وكيل التطبيق، وجوابه من كود هذا المستودع (القياس قبل الإصلاح مذكور في تقرير المهمّة): «هل يفترض أيّ قارئ ثلاثة تشغيلات منفَّذة، أو يقارن sievePrimeCount بثابت، أو يقرأ cpuKnownAnswerState بالمساواة 'ran' فقط؟»
// ← لا قارئ إنتاج يفترض ثلاثة منفَّذة ولا يقارن العدد بثابت (يُسلَّم خاماً)؛ وقراءتان كانتا بالمساواة 'ran': عدّاد عدم التطابق (fv68Reader.readCpuKnownAnswer) فيسقط إلى null في الجزئي ويضيع منه عدم تطابق حقيقي (ومعه توقيع الجهاز)،
// وCPU_D_SHARE في سكربت الفحص ٠٣ فيصير NOT_MEASURED. أُصلحتا، وهذا الاختبار يحرس الإصلاح (القاعدة 23: لا اختبار قديم كان يثبّت السلوك الخاطئ؛ الاختبار الوحيد الذي تغيّر طفرتُه في deviceCheck03After.test.js وسببه مكتوب هناك).
//
// ما يغطّيه: (١) المرجع π(N) يُعاد حسابه بغربال مستقلّ. (٢) القارئ: القيمتان الجديدتان، وتوليفات الحالة × المتروك، وsieveLimit بكل ختم وكل نصف (القاعدة 30)، والمرجع بحسب N لا بثابت، والمتروك لا نجاح ولا فشل ولا صفر.
// (٣) التوقيع وإعادة التقييم. (٤) حمولة النموذج بالمسار الكامل (القاعدة 37: يُستبدَل fetch وحده): D لا يصل النموذج بأيّ شكل. (٥) سكربت الفحص ٠٣: ثلاث عيّنات + طفرات. (٦) سكربت العناقيد: المتروك حالة صريحة.
//
// الجزء الخامس (2026-10-13 +03): alloc_failed للغربال معروفة وحاملة لـsieveLimit (عقد §٧-ط (د) :1669 في نسخة 450d9ed؛ الغربال يُرجعها ومعها N — CpuKnownAnswer.kt عند 450d9ed، منقول، غير متحقَّق)،
// وcancelled للحالتين (:1616): ليس من EXECUTED_STATUSES فلا نجاح ولا فشل ولا عدم تطابق ولا يجعل الحالة الإجمالية ran بنفسه؛ وغياب sieveLimit معه معلوم لا شذوذ وحضوره شذوذ
// (المصدر الكود لا العقد: CpuKnownAnswerScheduler.kt:147-158، منقول، غير متحقَّق). **القاعدة 23:** هذا الاختبار استبدل تأكيدين كانا يثبّتان alloc_failed للغربال «غير معروفة»: مصفوفة KINDS أدناه،
// ومفردات الحالات في deviceCheck03After.test.js. وصفوف الجولة الثانية للفحص ٠٣ (ختم القواعد وتصنيف الدورات وبصمة الجهاز المحفوظة) في §٥-ب.
//
// Run: node functions/test/cpuKnownAnswerFv70.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ─── الاستبدال الوحيد (القاعدة 37) لمسار حمولة النموذج: الشبكة. Firestore فخّ (settings 404). ───────────────────────────────────────────────────────────────────────────────────
const fetchCalls = [];
global.fetch = async (url, opts) => {
  fetchCalls.push({url: String(url), body: opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null});
  const {validV7ModelResponse, deepSeekHttpResponse} = require('./lib/v7ProviderStub');
  return deepSeekHttpResponse(validV7ModelResponse());
};
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: {}, db: {collection: (name) => {
    if (name === 'settings') return {doc: () => ({get: async () => ({exists: false})})};
    throw new Error(`TRAP: unexpected collection "${name}"`);
  }}, ADMIN_EMAILS: [], requireAdmin: () => {}},
};

const N = require('../src/analysis/fv68Names');
const {readFv68} = require('../src/analysis/fv68Reader');
const {computeScanSignature} = require('../src/signatures/computeScanSignature');
const {reevaluationDecision} = require('../src/signatures/reevaluationDecision');
const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const D = require('../scripts/lib/deviceCheck03After');
const C = require('../scripts/lib/deviceCheck03Common');
const {makeMemDb} = require('./lib/memFirestore');
const H = require('./lib/deviceCheck03Harness');
const {main: clusterMain} = require('../scripts/cluster-freq-windows-readonly');

const K = N.STATE_KIND;
const V = D.VERDICT;
const I = D.ITEM;
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const KEYS = {c11: '11ch-nothing-admitted', c13: '13ch-selinux-blocked-policy', c16: '16ch-four-policies-truncated-failures'};
const loadGolden = (fv, k) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `${fv}-app-request-payload-derived-from-fv67-golden-34dff2b8-${KEYS[k]}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const runsOf = (p) => p.timeSeries.footer.verificationResults.cpuKnownAnswerRuns;
const vrOf = (p) => p.timeSeries.footer.verificationResults;
const kOf = (p) => readFv68(p).verification.cpuKnownAnswer;
const SKIPPED = 'skipped:time_budget';
const skippedElement = (phase, pct) => ({phase, plannedAtPct: pct, sieveStatus: SKIPPED, sha256Status: SKIPPED});

// ═══════════════════════════════════════════════════════════════════════
// ١ — المرجع π(N): يُعاد حسابه بغربال مستقلّ في الاختبار نفسه (لا نقل من التطبيق ولا من الجدول)
// ═══════════════════════════════════════════════════════════════════════
{
  const piOf = (limit) => {
    const sieve = new Uint8Array(limit + 1);
    let count = 0;
    for (let i = 2; i <= limit; i++) {
      if (sieve[i] === 0) { count++; for (let j = i * 2; j <= limit; j += i) sieve[j] = 1; }
    }
    return count;
  };
  for (const [limit, want] of Object.entries(N.SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT)) eq(piOf(Number(limit)), want, `[١] π(${limit}) بغربال مستقلّ = المرجع في fv68Names`);
  deq(Object.keys(N.SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT).map(Number), [1000000, 10000000], '[١] جدول المرجع: N=1000000 وN=10000000 فقط (لا ثالث بلا قرار)');
  eq(N.SIEVE_LIMIT_WHEN_ABSENT_FV68_69, 10000000, '[١] N حين يغيب sieveLimit في ختم 68 و69 = 10000000 (§٧-ط)');
  ok(Object.isFrozen(N.SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT), '[١] الجدول مجمَّد');
  eq(N.FIELDS_VERSION_70, 70, '[١] FIELDS_VERSION_70 = 70 (app/build.gradle.kts:486 في المصدر، منقول)');
  eq(D.ROUND2_EXPECTED_SIEVE_PRIME_COUNT, 78498, '[١] توقّع الجولة الثانية 78498 = المرجع لـ1000000 من الجدول الواحد (لا نسخة ثانية)');
  eq(D.ROUND2_EXPECTED_SIEVE_LIMIT, 1000000, '[١] وتوقّع N = 1000000');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — القارئ: عيّنات fv70 الثلاث، ثم التوليفات
// ═══════════════════════════════════════════════════════════════════════
{
  const p11 = loadGolden('fv70', 'c11');
  const r11 = readFv68(p11);
  const k11 = r11.verification.cpuKnownAnswer;
  deq([r11.fieldsVersion, r11.applicable, r11.anomalies], [70, true, []], '[٢] 11ch fv70: ختم 70، مُنطبِق، بلا شذوذ');
  deq([k11.state.state.raw, k11.state.state.kind, k11.state.state.recognized], ['partial:time_budget', K.PARTIAL_TIME_BUDGET, true], '[٢] 11ch: partial:time_budget معروفة (لا UNRECOGNIZED)');
  deq([k11.counts.runs, k11.counts.sieveSkipped, k11.counts.shaSkipped, k11.counts.sieveMatch, k11.counts.shaMatch, k11.counts.unrecognized], [6, 2, 2, 4, 4, 0], '[٢] 11ch: 6 تشغيلات، منها متروكان في الغربال وSHA معاً، وأربعة مطابقة — والمتروك لا يُحسب مطابقاً ولا غير معروف');
  eq(k11.mismatches, 0, '[٢] 11ch الجزئي: عدّاد عدم التطابق 0 حقيقي (كان null: `=== ran` وحده)');
  deq(k11.runs.items.map((x) => x.skipped), [false, true, true, false, false, false], '[٢] 11ch: العنصران 1 و2 متروكان');
  deq(k11.runs.items[1], {phase: 3, plannedAtPct: 60, t: null, tEnd: null, skipped: true,
    sieve: {status: k11.runs.items[1].sieve.status, primeCount: null, durationMs: null, limit: {value: null, basis: 'NOT_SHIPPED_BY_DESIGN'}, referencePrimeCount: null, primeCountVsReference: 'NOT_COMPARABLE:NO_PRIME_COUNT'},
    sha256: {status: k11.runs.items[1].sha256.status, durationMs: null}}, '[٢] 11ch: العنصر المتروك: كل ما غاب null بحالته لا صفراً، والحالتان كما شُحنتا');
  deq([k11.runs.items[1].sieve.status.kind, k11.runs.items[1].sha256.status.kind], [K.SKIPPED_TIME_BUDGET, K.SKIPPED_TIME_BUDGET], '[٢] وصنفاهما skipped:time_budget');
  deq(k11.totalMsByPhase.byPhase, {3: 410, 5: 360}, '[٢] مجموع D بالمرحلة كما شُحن (المتروك خارجه)');
  deq(k11.runs.items.filter((x) => !x.skipped).map((x) => [x.sieve.limit.basis, x.sieve.limit.value, x.sieve.referencePrimeCount, x.sieve.primeCountVsReference]),
      Array(4).fill(['SHIPPED', 1000000, 78498, 'EQUAL']), '[٢] 11ch: الأربعة المنفَّذة: N من الحمولة (1000000) والمرجع 78498 بحسبه، والعدد يساويه');
  // 13ch: ran، وعدم تطابق 78499
  const k13 = kOf(loadGolden('fv70', 'c13'));
  deq([k13.state.state.raw, k13.mismatches, k13.counts.sieveMismatch, k13.counts.sieveSkipped], ['ran', 1, 1, 0], '[٢] 13ch fv70: ran بلا متروك، وعدم تطابق واحد');
  eq(k13.runs.items[4].sieve.primeCountVsReference, 'DIFFERENT', '[٢] 13ch: العدد 78499 يخالف المرجع 78498 (معلومة لا حكم) — والحالة mismatch تتّفق معه (لا شذوذ)');
  eq(readFv68(loadGolden('fv70', 'c13')).anomalies.length, 0, '[٢] 13ch: بلا شذوذ');
  // 16ch: native_call_failed وnot_reached: لا N لهما بالتصميم ولا شذوذ
  const p16 = loadGolden('fv70', 'c16');
  const k16 = kOf(p16);
  deq(k16.runs.items.filter((x) => x.sieve.limit.basis === 'NOT_SHIPPED_BY_DESIGN').length, 2, '[٢] 16ch: عنصران بلا N بالتصميم (native_call_failed وnot_reached)');
  eq(readFv68(p16).anomalies.length, 0, '[٢] 16ch: ولا شذوذ');

  // fv69 القائمة: بلا sieveLimit ⟵ N = 10000000 ومرجعه 664579 (تبقى الدلالة القديمة)
  for (const key of ['c11', 'c13', 'c16']) {
    const k69 = kOf(loadGolden('fv69', key));
    deq(k69.runs.items.filter((x) => x.sieve.status !== null && (x.sieve.status.kind === K.MATCH || x.sieve.status.kind === K.MISMATCH)).map((x) => [x.sieve.limit.basis, x.sieve.limit.value, x.sieve.referencePrimeCount]),
        k69.runs.items.filter((x) => x.sieve.status !== null && (x.sieve.status.kind === K.MATCH || x.sieve.status.kind === K.MISMATCH)).map(() => ['LEGACY_FV68_69_DEFAULT', 10000000, 664579]),
        `[٢] ${key} fv69: بلا sieveLimit ⟵ N=10000000 ومرجعه 664579`);
    eq(k69.state.state.raw, 'ran', `[٢] ${key} fv69: ran كما كانت`);
    eq(k69.counts.sieveSkipped + k69.counts.shaSkipped, 0, `[٢] ${key} fv69: لا متروك`);
  }
  eq(kOf(loadGolden('fv69', 'c13')).runs.items[4].sieve.primeCountVsReference, 'DIFFERENT', '[٢] 13ch fv69: العدد 664580 يخالف 664579 (N القديم)');

  // ─── توليفات الحالة الإجمالية × وجود متروك (القاعدة 30: كل قيمة لا واحدة) ───
  const withSkip = () => clone(p11); // فيه متروكان
  const noSkip = () => clone(loadGolden('fv70', 'c13')); // فيه عدم تطابق واحد، بلا متروك
  const STATES = ['ran', 'partial:time_budget', 'not_run:no_check_reached', 'not_run:phase_not_reached', 'partial:other', 'ran:x', 'junk', undefined];
  for (const state of STATES) {
    for (const [label, mk, skippedHalves, mism] of [['بمتروك', withSkip, 4, 0], ['بلا متروك', noSkip, 0, 1]]) {
      const p = mk();
      if (state === undefined) delete vrOf(p).cpuKnownAnswerState; else vrOf(p).cpuKnownAnswerState = state;
      const r = readFv68(p);
      const k = r.verification.cpuKnownAnswer;
      const codes = r.anomalies.map((a) => a.code);
      const counted = state === 'ran' || state === 'partial:time_budget';
      eq(k.mismatches, counted ? mism : null, `[٢] الحالة ${state === undefined ? '(غائبة)' : state} ${label}: العدّاد ${counted ? mism : 'null'} (الجزئي يحسب الأنصاف المُبلَّغة؛ not_run وغير المعروفة وغيابها لا حكم)`);
      eq(k.counts.sieveSkipped + k.counts.shaSkipped, skippedHalves, `[٢] الحالة ${state} ${label}: عدّ المتروك ${skippedHalves} لا يتبع الحالة`);
      eq(codes.includes('RAN_WITH_SKIPPED_RUNS'), state === 'ran' && skippedHalves > 0, `[٢] الحالة ${state} ${label}: RAN_WITH_SKIPPED_RUNS`);
      eq(codes.includes('PARTIAL_WITHOUT_SKIPPED_RUNS'), state === 'partial:time_budget' && skippedHalves === 0, `[٢] الحالة ${state} ${label}: PARTIAL_WITHOUT_SKIPPED_RUNS`);
      const unrecognized = ['partial:other', 'ran:x', 'junk'].includes(state);
      eq(r.anomalies.some((a) => a.section === 'verificationResults.cpuKnownAnswerState' && a.code === 'UNRECOGNIZED_STATE'), unrecognized, `[٢] الحالة ${state} ${label}: غير المعروفة تُعلَن شذوذاً ولا تُسقَط صامتةً`);
    }
  }

  // ─── المتروك لا نجاح ولا فشل ولا صفر ───
  {
    const p = clone(p11);
    runsOf(p)[1].sieveStatus = 'skipped:other_reason';
    const r = readFv68(p);
    eq(r.verification.cpuKnownAnswer.counts.unrecognized, 1, '[٢] skipped:<سبب آخر> ⟵ غير معروف (قيمة حرفية كاملة لا بادئة مفتوحة)');
    ok(r.anomalies.some((a) => a.code === 'UNRECOGNIZED_STATE' && a.detail.raw === 'skipped:other_reason'), '[٢] ويُعلَن شذوذاً باسمه');
    eq(r.verification.cpuKnownAnswer.counts.sieveSkipped, 1, '[٢] والنصف الآخر في العنصر نفسه ما زال يُعدّ متروكاً (الغربال المجهول لا يُحسب متروكاً)');
    // نصف واحد متروك فقط
    const q = clone(loadGolden('fv70', 'c13'));
    runsOf(q)[1].sha256Status = SKIPPED; delete runsOf(q)[1].sha256DurationMs;
    vrOf(q).cpuKnownAnswerState = 'partial:time_budget';
    const kq = kOf(q);
    deq([kq.counts.shaSkipped, kq.counts.sieveSkipped, kq.counts.shaMatch, kq.counts.sieveMatch], [1, 0, 5, 5], '[٢] SHA متروك وحده: يُعدّ في SHA وحده ولا يُعدّ مطابقاً');
    eq(kq.runs.items[1].skipped, true, '[٢] والعنصر skipped (نصف واحد يكفي)');
    // المتروك بقيم ⟵ شذوذ
    for (const [what, patch] of [['t', {t: 5}], ['tEnd', {tEnd: 9}], ['sieveLimit', {sieveLimit: 1000000}], ['sievePrimeCount', {sievePrimeCount: 78498}], ['sieveDurationMs', {sieveDurationMs: 90}], ['sha256DurationMs', {sha256DurationMs: 30}]]) {
      const w = clone(p11);
      Object.assign(runsOf(w)[1], patch);
      const rw = readFv68(w);
      // t/tEnd وحدهما لا يُعلَنان إلا مع الحالتين معاً (كلاهما متروك هنا)
      ok(rw.anomalies.some((a) => a.code === 'SKIPPED_WITH_VALUES'), `[٢] متروك يحمل ${what} ⟵ SKIPPED_WITH_VALUES`);
    }
    eq(readFv68(clone(p11)).anomalies.length, 0, '[٢] (ضابط سلبي) المتروك النظيف بلا شذوذ');
  }

  // ─── sieveLimit: كل ختم × كل نوع نصف غربال (القاعدة 30) ───
  {
    const KINDS = [
      ['match', {sieveStatus: 'match', sievePrimeCount: 78498, sieveDurationMs: 90}, true],
      ['mismatch', {sieveStatus: 'mismatch', sievePrimeCount: 78499, sieveDurationMs: 90}, true],
      // الجزء الخامس: alloc_failed للغربال معروفة ويُنتظَر معها N (N الذي حاول)، وnative_status_unknown:<n> كذلك (العقد :1669)؛ وcancelled معروفة بلا N (الكود: CpuKnownAnswerScheduler.kt:147-158).
      ['alloc_failed', {sieveStatus: 'alloc_failed'}, true],
      ['native_status_unknown', {sieveStatus: 'native_status_unknown:7'}, true],
      ['cancelled', {sieveStatus: 'cancelled'}, false],
      ['native_call_failed', {sieveStatus: 'native_call_failed:boom'}, false],
      ['native_result_unreadable', {sieveStatus: 'native_result_unreadable:size=3'}, false],
      ['not_reached', {sieveStatus: 'not_reached', sha256Status: 'not_reached'}, false],
      ['skipped', {sieveStatus: SKIPPED, sha256Status: SKIPPED}, false],
    ];
    for (const fv of [67, 68, 69, 70, 71, undefined]) {
      for (const [kind, extra, ships] of KINDS) {
        const p = clone(p11);
        if (fv === undefined) delete p.timeSeries.footer.fieldsVersion; else p.timeSeries.footer.fieldsVersion = fv;
        const el = {phase: 3, plannedAtPct: 25, sha256Status: 'match', sha256DurationMs: 30, t: 10, tEnd: 20, ...extra};
        if (kind === 'not_reached' || kind === 'skipped') { delete el.t; delete el.tEnd; delete el.sha256DurationMs; }
        vrOf(p).cpuKnownAnswerRuns = [el]; // بلا sieveLimit
        vrOf(p).cpuKnownAnswerState = kind === 'skipped' ? 'partial:time_budget' : 'ran';
        if (kind === 'skipped') runsOf(p).push({phase: 3, plannedAtPct: 60, sieveStatus: 'match', sievePrimeCount: 78498, sieveLimit: 1000000, sieveDurationMs: 9, sha256Status: 'match', sha256DurationMs: 3, t: 30, tEnd: 40});
        const r = readFv68(p);
        const item = r.verification.cpuKnownAnswer.runs.items[0];
        const codes = r.anomalies.map((a) => a.code);
        let wantBasis;
        let wantLimit;
        if (!ships) { wantBasis = 'NOT_SHIPPED_BY_DESIGN'; wantLimit = null; }
        else if (fv === 70 || fv === 71) { wantBasis = 'ABSENT_IN_FV70'; wantLimit = null; }
        else if (fv === 68 || fv === 69) { wantBasis = 'LEGACY_FV68_69_DEFAULT'; wantLimit = 10000000; }
        else { wantBasis = 'FIELDS_VERSION_BEFORE_68_OR_UNKNOWN'; wantLimit = null; }
        deq([item.sieve.limit.basis, item.sieve.limit.value], [wantBasis, wantLimit], `[٢] ختم ${fv} + ${kind} بلا sieveLimit: الأساس ${wantBasis}`);
        eq(codes.includes('UNRECOGNIZED_STATE'), false, `[٢] ختم ${fv} + ${kind}: حالة الغربال معروفة (لا UNRECOGNIZED_STATE)`);
        eq(codes.includes('SIEVE_LIMIT_ABSENT'), ships && (fv === 70 || fv === 71), `[٢] ختم ${fv} + ${kind}: غياب N شذوذ ≥ 70 وللنصف الذي يُشحن معه وحده`);
        eq(item.sieve.referencePrimeCount, wantLimit === null ? null : N.SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT[wantLimit], `[٢] ختم ${fv} + ${kind}: المرجع بحسب N المعتمَد (لا بثابت)`);
      }
    }
    // N غير معدود، ونوع خاطئ
    const pu = clone(loadGolden('fv70', 'c13'));
    runsOf(pu)[0].sieveLimit = 5000000;
    const iu = kOf(pu).runs.items[0].sieve;
    deq([iu.limit.basis, iu.limit.value, iu.referencePrimeCount, iu.primeCountVsReference], ['SHIPPED', 5000000, null, 'NOT_COMPARABLE:LIMIT_NOT_IN_REFERENCE_TABLE'], '[٢] N غير معدود في الجدول: لا مرجع ولا تخمين، ويُسمّى سبب عدم المقارنة');
    ok(!readFv68(pu).anomalies.some((a) => a.code === 'PRIME_COUNT_DISAGREES_WITH_STATUS'), '[٢] وبلا شذوذ تناقض (لا مرجع ليناقض)');
    const pw = clone(loadGolden('fv70', 'c13'));
    runsOf(pw)[0].sieveLimit = '1000000';
    const rw = readFv68(pw);
    deq([rw.verification.cpuKnownAnswer.runs.items[0].sieve.limit.basis, rw.verification.cpuKnownAnswer.runs.items[0].sieve.primeCountVsReference], ['WRONG_TYPE', 'NOT_COMPARABLE:NO_SIEVE_LIMIT'], '[٢] sieveLimit نصّاً ⟵ WRONG_TYPE ولا مقارنة');
    ok(rw.anomalies.some((a) => a.code === 'WRONG_TYPE' && /sieveLimit/.test(a.section)), '[٢] ويُعلَن شذوذ نوع بمسار الحقل');
  }

  // ─── المرجع بحسب N لا بثابت، والتناقض مع الحالة يُعلَن (معلومة لا حكم) ───
  {
    const mk = (fv, el) => { const p = clone(p11); p.timeSeries.footer.fieldsVersion = fv; vrOf(p).cpuKnownAnswerRuns = [{phase: 3, plannedAtPct: 25, t: 1, tEnd: 2, sha256Status: 'match', sha256DurationMs: 1, ...el}]; vrOf(p).cpuKnownAnswerState = 'ran'; return readFv68(p); };
    const cases = [
      ['N=1e6 والعدد 664579 (الثابت القديم) والحالة match', 70, {sieveStatus: 'match', sieveLimit: 1000000, sievePrimeCount: 664579}, 'DIFFERENT', true],
      ['N=1e6 والعدد 78498 والحالة match', 70, {sieveStatus: 'match', sieveLimit: 1000000, sievePrimeCount: 78498}, 'EQUAL', false],
      ['N=1e7 صريحاً والعدد 664579 والحالة match', 70, {sieveStatus: 'match', sieveLimit: 10000000, sievePrimeCount: 664579}, 'EQUAL', false],
      ['N=1e7 صريحاً والعدد 78498', 70, {sieveStatus: 'match', sieveLimit: 10000000, sievePrimeCount: 78498}, 'DIFFERENT', true],
      ['fv69 بلا N والعدد 78498 والحالة match (N الافتراضي 1e7)', 69, {sieveStatus: 'match', sievePrimeCount: 78498}, 'DIFFERENT', true],
      ['fv69 بلا N والعدد 664579 والحالة match', 69, {sieveStatus: 'match', sievePrimeCount: 664579}, 'EQUAL', false],
      ['mismatch والعدد يساوي المرجع', 70, {sieveStatus: 'mismatch', sieveLimit: 1000000, sievePrimeCount: 78498}, 'EQUAL', true],
      ['mismatch والعدد يخالف المرجع', 70, {sieveStatus: 'mismatch', sieveLimit: 1000000, sievePrimeCount: 78499}, 'DIFFERENT', false],
      ['alloc_failed للغربال مع sieveLimit وبلا عدد', 70, {sieveStatus: 'alloc_failed', sieveLimit: 1000000}, 'NOT_COMPARABLE:NO_PRIME_COUNT', false],
    ];
    for (const [label, fv, el, wantVs, wantAnomaly] of cases) {
      const r = mk(fv, el);
      eq(r.verification.cpuKnownAnswer.runs.items[0].sieve.primeCountVsReference, wantVs, `[٢] ${label}: المقارنة ${wantVs}`);
      eq(r.anomalies.some((a) => a.code === 'PRIME_COUNT_DISAGREES_WITH_STATUS'), wantAnomaly, `[٢] ${label}: تناقض الحالة مع العدد ${wantAnomaly ? 'يُعلَن' : 'لا يُعلَن'}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ٢-ب (الجزء الخامس) — cancelled وalloc_failed وnative_status_unknown في القارئ
// ═══════════════════════════════════════════════════════════════════════
{
  // 13ch بعد إصلاح عدم التطابق الوحيد (المرحلة 5، التشغيل 2) كي يكون الأصل نظيفاً.
  const cleanBase = () => { const p = clone(loadGolden('fv70', 'c13')); Object.assign(runsOf(p)[4], {sieveStatus: 'match', sievePrimeCount: 78498}); return p; };
  const read = (mut) => { const p = cleanBase(); mut(p); return readFv68(p); };
  const cc = (r) => r.verification.cpuKnownAnswer;
  const base0 = readFv68(cleanBase());
  deq([cc(base0).counts.sieveMatch, cc(base0).counts.sieveCancelled, cc(base0).counts.shaCancelled, cc(base0).mismatches, base0.anomalies.length], [6, 0, 0, 0, 0], '[٢-ب] الأصل النظيف: ستّة غرابيل match، لا cancelled، عدم التطابق 0، بلا شذوذ');
  const cancelledEl = (extra) => ({phase: 3, plannedAtPct: 60, t: 210945, tEnd: 210950, sieveStatus: 'cancelled', sha256Status: 'match', sha256DurationMs: 3, ...extra});
  // غربال cancelled (SHA match)، بلا sieveLimit: غياب معلوم
  {
    const r = read((p) => { runsOf(p)[1] = cancelledEl(); });
    const it = cc(r).runs.items[1];
    deq([it.sieve.status.kind, it.sieve.status.recognized, it.skipped], [K.CANCELLED, true, false], '[٢-ب] غربال cancelled: معروفة، وليست «متروكاً»');
    deq([it.sieve.limit.basis, it.sieve.limit.value, it.sieve.primeCount, it.sieve.referencePrimeCount, it.sieve.primeCountVsReference], ['NOT_SHIPPED_BY_DESIGN', null, null, null, 'NOT_COMPARABLE:NO_PRIME_COUNT'], '[٢-ب] غياب sieveLimit مع cancelled معلوم بالتصميم (لا شذوذ) ولا عدد ولا مرجع');
    deq([cc(r).counts.sieveCancelled, cc(r).counts.sieveMatch, cc(r).counts.sieveError, cc(r).counts.unrecognized, cc(r).counts.shaMatch], [1, 5, 0, 0, 6], '[٢-ب] عدّاد sieveCancelled صريح (لا يدخل Error ولا Match ولا Mismatch)');
    deq([cc(r).mismatches, r.anomalies.length], [0, 0], '[٢-ب] cancelled لا تدخل عدّاد عدم التطابق، ولا شذوذ (ولا RAN_WITH_SKIPPED_RUNS: الحالة ran مع cancelled مشروعة)');
  }
  // غربال cancelled ومعه sieveLimit: شذوذ، والقيمة تُعرض كما شُحنت لا تُخفى
  {
    const r = read((p) => { runsOf(p)[1] = cancelledEl({sieveLimit: 1000000}); });
    const it = cc(r).runs.items[1];
    deq(r.anomalies.map((a) => a.code), ['CANCELLED_WITH_SIEVE_LIMIT'], '[٢-ب] cancelled ومعه sieveLimit ⟵ شذوذ CANCELLED_WITH_SIEVE_LIMIT');
    deq([it.sieve.limit.basis, it.sieve.limit.value], ['SHIPPED', 1000000], '[٢-ب] والقيمة كما شُحنت (لا تُهمَل)');
  }
  // SHA وحده cancelled: الغربال كما أبلغ (match ومعه N)، لا شذوذ
  {
    const r = read((p) => { runsOf(p)[1] = {phase: 3, plannedAtPct: 60, t: 210945, tEnd: 211045, sieveStatus: 'match', sievePrimeCount: 78498, sieveLimit: 1000000, sieveDurationMs: 90, sha256Status: 'cancelled'}; });
    const it = cc(r).runs.items[1];
    deq([cc(r).counts.shaCancelled, cc(r).counts.shaMatch, cc(r).counts.sieveMatch, cc(r).counts.shaError, it.skipped, r.anomalies.length], [1, 5, 6, 0, false, 0], '[٢-ب] SHA وحده cancelled: عدّاد shaCancelled، والغربال match ومعه N، بلا شذوذ');
    deq([it.sieve.limit.basis, it.sieve.limit.value, it.sieve.primeCountVsReference], ['SHIPPED', 1000000, 'EQUAL'], '[٢-ب] وN والمقارنة كما أبلغها الغربال');
  }
  // الحالتان cancelled
  {
    const r = read((p) => { runsOf(p)[1] = {phase: 3, plannedAtPct: 60, t: 210945, tEnd: 210950, sieveStatus: 'cancelled', sha256Status: 'cancelled'}; });
    deq([cc(r).counts.sieveCancelled, cc(r).counts.shaCancelled, cc(r).mismatches, r.anomalies.length], [1, 1, 0, 0], '[٢-ب] الحالتان cancelled: عدّادان، لا عدم تطابق ولا شذوذ');
  }
  // cancelled لا تغيّر الحالة الإجمالية التي يقرؤها القارئ من الحمولة (القارئ لا يشتقّها)
  {
    const r = read((p) => { for (let i = 0; i < 6; i++) runsOf(p)[i] = cancelledEl({phase: i < 3 ? 3 : 5, plannedAtPct: [25, 60, 92][i % 3], sha256Status: 'cancelled'}); vrOf(p).cpuKnownAnswerState = 'not_run:no_check_reached'; });
    deq([cc(r).state.state.kind, cc(r).mismatches, cc(r).counts.sieveCancelled, cc(r).counts.shaCancelled], [K.NOT_RUN, null, 6, 6], '[٢-ب] كل الأنصاف cancelled والحالة not_run (كما يحكم التطبيق بـEXECUTED_STATUSES): الحالة من الحمولة، وعدّاد عدم التطابق null');
    ok(r.anomalies.some((a) => a.code === 'RUNS_WITH_NOT_RUN_STATE'), '[٢-ب] وتناقض not_run مع وجود تشغيلات يُعلَن كما كان');
  }
  // cancelled بيدٍ مختلطة: mismatch حقيقي في عنصر آخر يبقى محسوباً
  {
    const r = read((p) => { runsOf(p)[1] = cancelledEl(); Object.assign(runsOf(p)[4], {sieveStatus: 'mismatch', sievePrimeCount: 78499}); });
    deq([cc(r).mismatches, cc(r).counts.sieveCancelled, cc(r).counts.sieveMismatch], [1, 1, 1], '[٢-ب] cancelled بجانب mismatch حقيقي: العدّاد 1 (cancelled لا تُخفيه ولا تُضيف إليه)');
  }
  // alloc_failed للغربال: معروفة، تُحسب «خطأ» (لم يجرِ الفحص) لا عدم تطابق، ومعها N
  {
    const r = read((p) => { runsOf(p)[1] = {phase: 3, plannedAtPct: 60, t: 210945, tEnd: 210946, sieveStatus: 'alloc_failed', sieveLimit: 1000000, sha256Status: 'match', sha256DurationMs: 3}; });
    const it = cc(r).runs.items[1];
    deq([it.sieve.status.kind, it.sieve.status.recognized, it.sieve.limit.basis, it.sieve.limit.value, it.sieve.referencePrimeCount], [K.ALLOC_FAILED, true, 'SHIPPED', 1000000, 78498], '[٢-ب] alloc_failed للغربال: معروفة، ومعها N (N الذي حاول) والمرجع بحسبه');
    deq([cc(r).counts.sieveError, cc(r).counts.sieveMismatch, cc(r).counts.unrecognized, cc(r).mismatches, r.anomalies.length], [1, 0, 0, 0, 0], '[٢-ب] وتدخل «خطأ» (لم يجرِ الفحص) لا عدم تطابق، بلا شذوذ');
  }
  // native_status_unknown:<n> للغربال: معروفة، ومعها N إن شُحن (العقد :1669)
  {
    const r = read((p) => { runsOf(p)[1] = {phase: 3, plannedAtPct: 60, t: 210945, tEnd: 210946, sieveStatus: 'native_status_unknown:7', sieveLimit: 1000000, sha256Status: 'match', sha256DurationMs: 3}; });
    const it = cc(r).runs.items[1];
    deq([it.sieve.status.kind, it.sieve.status.recognized, it.sieve.limit.basis, cc(r).counts.sieveError, r.anomalies.length], [K.NATIVE_STATUS_UNKNOWN, true, 'SHIPPED', 1, 0], '[٢-ب] native_status_unknown:7 للغربال ومعه N: معروفة، «خطأ»، بلا شذوذ');
  }
  // self_test_failed للـSHA وحده («self_test_failed (SHA)» في العقد): للغربال تبقى غير معروفة وتُعلَن
  {
    const r = read((p) => { runsOf(p)[1] = {phase: 3, plannedAtPct: 60, t: 210945, tEnd: 210946, sieveStatus: 'self_test_failed', sha256Status: 'self_test_failed', sha256DurationMs: 3}; });
    const it = cc(r).runs.items[1];
    deq([it.sieve.status.kind, it.sha256.status.kind, r.anomalies.map((a) => `${a.code}:${a.detail.field}`)], [N.READER_STATE.UNRECOGNIZED, K.SELF_TEST_FAILED, ['UNRECOGNIZED_STATE:sieveStatus']], '[٢-ب] self_test_failed: للـSHA معروفة، وللغربال غير معروفة وتُعلَن (العقد: «self_test_failed (SHA)»)');
  }
  // مفردات حرفية كاملة: cancelled:<سبب> غير معروفة في الحالتين
  for (const field of ['sieveStatus', 'sha256Status']) {
    const r = read((p) => { runsOf(p)[1] = cancelledEl({[field]: 'cancelled:phase_end'}); });
    ok(r.anomalies.some((a) => a.code === 'UNRECOGNIZED_STATE' && a.detail.field === field && a.detail.raw === 'cancelled:phase_end'), `[٢-ب] ${field}=cancelled:<سبب> غير معروفة وتُعلَن (قيمة حرفية كاملة)`);
  }
  // التوقيع وإعادة التقييم: cancelled لا تغيّر عدّاد عدم التطابق في التوقيع
  {
    const p = cleanBase(); runsOf(p)[1] = cancelledEl();
    eq(computeScanSignature(p).verification.cpuKnownAnswerMismatches, 0, '[٢-ب] توقيع الجهاز: cancelled لا تُحسب عدم تطابق (0)');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — التوقيع وإعادة التقييم: عدّاد عدم التطابق في الجزئي حقيقي (لا null)
// ═══════════════════════════════════════════════════════════════════════
{
  const mismOf = (p) => computeScanSignature(p).verification.cpuKnownAnswerMismatches;
  const p11 = loadGolden('fv70', 'c11');
  eq(mismOf(p11), 0, '[٣] 11ch fv70 (partial:time_budget): cpuKnownAnswerMismatches = 0 (كان null)');
  const withMismatch = clone(p11);
  Object.assign(runsOf(withMismatch)[0], {sieveStatus: 'mismatch', sievePrimeCount: 78499});
  eq(mismOf(withMismatch), 1, '[٣] جزئي مع عدم تطابق في نصف مُبلَّغ: 1 (لا يضيع)');
  eq(mismOf(loadGolden('fv70', 'c13')), 1, '[٣] 13ch ran: 1 كما كان');
  const notRun = clone(p11); vrOf(notRun).cpuKnownAnswerState = 'not_run:no_check_reached';
  eq(mismOf(notRun), null, '[٣] not_run: null (لا فحص جرى)');
  const noState = clone(p11); delete vrOf(noState).cpuKnownAnswerState;
  eq(mismOf(noState), null, '[٣] حالة غائبة: null (القاعدة 22)');
  // إعادة التقييم: صفر ثم عدم تطابق حقيقي في فحص جزئي لاحق ⟵ سبب مسمّى (قبل الإصلاح كان العدّاد null فلا سبب)
  const reason = reevaluationDecision(computeScanSignature(withMismatch), computeScanSignature(p11));
  eq(reason.forceReevaluate, true, '[٣] جزئي بعدم تطابق بعد فحص نظيف: إعادة تقييم قسرية');
  ok(reason.reasons.includes('verification:cpuKnownAnswerMismatches 0→1'), '[٣] بسببها المسمّى (0→1)');
  deq(reevaluationDecision(computeScanSignature(p11), computeScanSignature(p11)).reasons, [], '[٣] جزئي نظيف مع نفسه: لا سبب');
  // fv69 ثمّ fv70 لجهاز واحد: عدّاد 0 في الاثنين فلا انتقال كاذب
  const sig69 = computeScanSignature(loadGolden('fv69', 'c11'));
  eq(sig69.verification.cpuKnownAnswerMismatches, 0, '[٣] 11ch fv69: 0');
  ok(!reevaluationDecision(computeScanSignature(p11), sig69).reasons.some((r) => r.startsWith('verification:cpuKnownAnswerMismatches')), '[٣] fv69 (ran) ثمّ fv70 (جزئي) بلا عدم تطابق: لا سبب D كاذب');
}

// ═══════════════════════════════════════════════════════════════════════
// ٤ — ما يُنقل إلى النموذج: D لا يصل بأيّ شكل (المسار الكامل، الشبكة وحدها مستبدَلة)
// ═══════════════════════════════════════════════════════════════════════
const SUFFIX = '\n\nProduce the analysis JSON now.';
async function userMessageOf(fp, scanId) {
  fetchCalls.length = 0;
  const saved = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  let out;
  try {
    out = await runAnalysisInternal({fingerprint: fp, language: 'ar', deepseekKey: 'not-a-real-key', geminiKey: undefined, scanContext: {scanId}, analyzedAtMs: 1_800_000_000_000});
  } finally {
    console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
  }
  ok(fetchCalls.length >= 1 && fetchCalls.every((c) => c.url.includes('api.deepseek.com')), `[٤] ${scanId}: النداءات نحو مزوّد النموذج المعلوم فقط`);
  const user = fetchCalls[0].body.messages.find((m) => m.role === 'user').content;
  ok(user.endsWith(SUFFIX), `[٤] ${scanId}: رسالة المستخدم بالشكل المعهود`);
  return {user, out};
}

(async () => {
  for (const key of ['c11', 'c13', 'c16']) {
    const fp = loadGolden('fv70', key);
    delete fp.device.deviceProfileKey;
    const {user, out} = await userMessageOf(fp, `fv70-${key}`);
    ok(out.aiResult && !out.aiFailed, `[٤] ${key} fv70: التحليل يكتمل`);
    ok(!/cpuKnownAnswer|sieve|sha256|time_budget|skipped:/i.test(user), `[٤] ${key} fv70: لا اسم حقل D ولا skipped ولا time_budget في ما أُرسل للنموذج`);
    // D لا أثر له على الحمولة إطلاقاً: بصمة بلا حقول D تُنتج الحمولة نفسها بايتاً بايتاً
    const stripped = clone(fp);
    for (const k of ['cpuKnownAnswerState', 'cpuKnownAnswerRuns', 'cpuKnownAnswerTotalMsByPhase']) delete vrOf(stripped)[k];
    const second = await userMessageOf(stripped, `fv70-${key}`);
    eq(second.user, user, `[٤] ${key} fv70: الحمولة بلا حقول D = الحمولة بها، بايتاً بايتاً (D لا يصل النموذج)`);
  }

  // ═════════════════════════════════════════════════════════════════════
  // ٥ — سكربت الفحص ٠٣ (الجولة الثانية)
  // ═════════════════════════════════════════════════════════════════════
  const factsOf = (payload, tag = 'R2') => {
    const {timeSeriesState, ...file} = payload.timeSeries; void timeSeriesState;
    return {tag, shortIdHash: C.hashIdForLog(`NC-${tag}`), found: 1, scanIdHash: C.hashIdForLog(`scan-${tag}`), userHash: 'u', ownerMatches: true,
      rawRead: {state: 'PRIVATE', raw: {rawFingerprint: clone(lightenFingerprintForStorage(payload)), sessionId: null, deviceFingerprintSha: 'sha', timeSeriesStoragePath: 'p', aiAudit: null}},
      storage: {state: 'DOWNLOADED', json: file}, session: {state: 'NOT_A_SESSION_SCAN'}, evaluation: {exists: false}};
  };
  // §٥-ب (الجزء الخامس): facts إضافية (rulesStamp وprofile) وتوقّع تصنيف الدورات لكل وسم (cycleExpect) تُمرَّر للتقييم؛ الأصل بلا إضافات.
  const evalOf = (payload, tag, extra = {}) => D.evaluateReport({...factsOf(payload, tag), ...(extra.facts || {})}, {accountHash: 'u', ...(extra.cycleExpect !== undefined ? {cycleExpect: extra.cycleExpect} : {})});
  const rowOf = (res, item) => res.rows.find((r) => r.item === item);
  const verdictOf = (res, item) => { const r = rowOf(res, item); return r ? r.verdict : undefined; };
  {
    const r11 = evalOf(loadGolden('fv70', 'c11'));
    eq(r11.block.versions.fieldsVersion, 70, '[٥] 11ch: ختم 70');
    deq([verdictOf(r11, I.CPU_D_SHARE), verdictOf(r11, `${I.CPU_D_SHARE_PHASE}_3`), verdictOf(r11, `${I.CPU_D_SHARE_PHASE}_5`)], [V.PASS, V.PASS, V.PASS], '[٥] 11ch الجزئي: النسبة تُحسب (كان NOT_MEASURED: لم يجرِ فحص D) وPASS ≤ 1%');
    ok(/state=partial:time_budget skippedHalves=4/.test(rowOf(r11, I.CPU_D_SHARE).basis), '[٥] وأساسها يقول إنها جزئية وعدد الأنصاف المتروكة');
    eq(rowOf(r11, `${I.CPU_D_SHARE_PHASE}_3`).basis, 'phase=3 totalMs=410 phaseDurationMs=74978 percent=0.5468 max=1 samples=301', '[٥] المرحلة 3: مجموع D 410 (التشغيل المنفَّذ وحده: 380 غربال + 30 SHA) لا يدخله المتروك');
    eq(verdictOf(r11, I.APP_VERSION), V.INFO, '[٥] وسم بلا توقّعات بختم 70: APP_VERSION INFO بلا حكم (إصدار الجولة الثانية لم يُعطَ)');
    ok(/غير معطى/.test(rowOf(r11, I.APP_VERSION).basis), '[٥] وسببه مكتوب');
    eq(verdictOf(r11, I.FIELDS_VERSION), V.PASS, '[٥] FIELDS_VERSION: 70 ≥ 69');
    eq(verdictOf(r11, I.READER_ANOMALIES), V.PASS, '[٥] بلا شذوذ');
    eq(verdictOf(r11, I.CPU_D_R2), V.PASS, '[٥] CPU_D_R2 PASS');
    deq(['3', '5'].map((p) => rowOf(r11, `${I.CPU_D_R2_SUMMARY}_${p}`).basis), [
      'phase=3 runs=3 executedRuns=1 skippedRuns=2 notReachedRuns=0 cancelledRuns=0 totalDMs=410 phaseDurationMs=74978 percent=0.5468 sieveLimits=[1000000] sievePrimeCounts=[78498]',
      'phase=5 runs=3 executedRuns=3 skippedRuns=0 notReachedRuns=0 cancelledRuns=0 totalDMs=360 phaseDurationMs=59750 percent=0.6025 sieveLimits=[1000000] sievePrimeCounts=[78498,78498,78498]'], '[٥] صفّ ملخّص لكل مرحلة: مجموع D ونسبته وعدد المتروك وsieveLimit وsievePrimeCount');
    for (const p of ['3', '5']) {
      for (const it of [I.CPU_D_R2_FIRST_RUN, I.CPU_D_R2_SIEVE_LIMIT, I.CPU_D_R2_SIEVE_PRIME_COUNT]) eq(verdictOf(r11, `${it}_${p}`), V.PASS, `[٥] ${it}_${p} PASS`);
    }
    ok(rowOf(r11, `${I.CPU_D_BREAKDOWN}_3`).basis.endsWith('skippedRuns=2') && !/skippedRuns/.test(rowOf(r11, `${I.CPU_D_BREAKDOWN}_5`).basis), '[٥] تفصيل المرحلة يذكر المتروك حين يوجد وحده (الصفوف القائمة بلا تغيير حين لا متروك)');
    eq(rowOf(r11, `${I.CPU_D_RUN}_3_2`).basis.includes('sieveStatus=skipped:time_budget') && rowOf(r11, `${I.CPU_D_RUN}_3_2`).basis.includes('t=ABSENT tEnd=ABSENT'), true, '[٥] صفّ التشغيل المتروك: حالته skipped وt وtEnd ABSENT لا صفراً');
    ok(/sieveLimit=1000000$/.test(rowOf(r11, `${I.CPU_D_RUN}_3_1`).basis), '[٥] وصفّ المنفَّذ يحمل sieveLimit');
    eq(r11.rows.filter((r) => r.verdict === V.FAIL).length, 0, '[٥] 11ch: لا FAIL');

    const r13 = evalOf(loadGolden('fv70', 'c13'));
    deq([verdictOf(r13, I.CPU_D_R2), verdictOf(r13, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_5`), verdictOf(r13, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_3`)], [V.FAIL, V.FAIL, V.PASS], '[٥] 13ch: عدد 78499 في المرحلة 5 ⟵ FAIL لتوقّع 78498 (المرحلة 3 PASS)');
    ok(/bad=\[order=2:mismatch:78499\]/.test(rowOf(r13, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_5`).basis), '[٥] ويُسرد التشغيل المخالف بترتيبه وحالته وعدده');
    eq(verdictOf(r13, I.CPU_D_SHARE), V.PASS, '[٥] والنسبة PASS (حكم مستقلّ)');
    const r16 = evalOf(loadGolden('fv70', 'c16'));
    deq([verdictOf(r16, I.CPU_D_R2), r16.rows.filter((r) => r.verdict === V.FAIL).length], [V.PASS, 0], '[٥] 16ch (native_call_failed وnot_reached): R2 PASS — ما لا يُشحن معه N بالتصميم لا يدخل الحكم');
    ok(/runsWithLimit=2 /.test(rowOf(r16, `${I.CPU_D_R2_SIEVE_LIMIT}_3`).basis) && /notReachedRuns=1/.test(rowOf(r16, `${I.CPU_D_R2_SUMMARY}_5`).basis), '[٥] وعدّ ما دخل وما لم يدخل صريح');

    // قبل fv70: لا صفوف عائلة، والحكم المجمَّع NOT_MEASURED:BEFORE_FV70
    const r69 = evalOf(loadGolden('fv69', 'c11'));
    deq([verdictOf(r69, I.CPU_D_R2), /^BEFORE_FV70/.test(rowOf(r69, I.CPU_D_R2).basis), r69.rows.filter((r) => r.item.startsWith('CPU_D_R2_')).length], [V.NOT_MEASURED, true, 0], '[٥] fv69: CPU_D_R2 NOT_MEASURED:BEFORE_FV70 بلا صفوف عائلة');
    deq([verdictOf(r69, I.APP_VERSION), rowOf(r69, I.APP_VERSION).basis], [V.PASS, 'appVersion=1.0.11 expected=1.0.11'], '[٥] وAPP_VERSION بختم 69 على قاعدته القديمة (توقّع 1.0.11) لم يتغيّر');
  }
  // طفرات على 13ch fv70 (كلّها منفَّذة): كل حكم من الأحكام الثلاثة بفروعه
  {
    // 13ch بعد إصلاح عدم التطابق الوحيد (المرحلة 5، التشغيل 2: mismatch/78499 ⟵ match/78498) كي يكون الأصل نظيفاً وتُعزَل كل طفرة عن غيرها.
    const base = () => { const p = clone(loadGolden('fv70', 'c13')); Object.assign(runsOf(p)[4], {sieveStatus: 'match', sievePrimeCount: 78498}); return p; };
    eq(evalOf(base()).rows.filter((r) => r.verdict === V.FAIL).length, 0, '[٥] الأصل المُصلَح بلا أيّ FAIL (ضابط سلبي للطفرات التالية)');
    const run = (mut) => { const p = base(); mut(p); return evalOf(p); };
    const first = run((p) => { runsOf(p)[0] = skippedElement(3, 25); vrOf(p).cpuKnownAnswerState = 'partial:time_budget'; });
    deq([verdictOf(first, `${I.CPU_D_R2_FIRST_RUN}_3`), verdictOf(first, I.CPU_D_R2)], [V.FAIL, V.FAIL], '[٥] الأوّل متروك ⟵ CPU_D_R2_FIRST_RUN_3 FAIL');
    ok(/FIRST_RUN_SKIPPED/.test(rowOf(first, `${I.CPU_D_R2_FIRST_RUN}_3`).basis), '[٥] بسببه المسمّى');
    eq(verdictOf(first, I.CPU_D_SHARE), V.PASS, '[٥] والنسبة لا تتأثّر بالمتروك (لا نجاح ولا فشل ولا صفر)');
    const firstNR = run((p) => { runsOf(p)[0] = {phase: 3, plannedAtPct: 25, sieveStatus: 'not_reached', sha256Status: 'not_reached'}; });
    ok(/FIRST_RUN_NOT_REACHED/.test(rowOf(firstNR, `${I.CPU_D_R2_FIRST_RUN}_3`).basis) && verdictOf(firstNR, `${I.CPU_D_R2_FIRST_RUN}_3`) === V.FAIL, '[٥] الأوّل not_reached ⟵ FAIL');
    const firstNoT = run((p) => { delete runsOf(p)[0].t; });
    ok(/FIRST_RUN_WITHOUT_T_TEND/.test(rowOf(firstNoT, `${I.CPU_D_R2_FIRST_RUN}_3`).basis), '[٥] الأوّل بلا t ⟵ FAIL بسببه');
    const secondSkipped = run((p) => { runsOf(p)[1] = skippedElement(3, 60); vrOf(p).cpuKnownAnswerState = 'partial:time_budget'; });
    deq([verdictOf(secondSkipped, `${I.CPU_D_R2_FIRST_RUN}_3`), verdictOf(secondSkipped, I.CPU_D_R2)], [V.PASS, V.PASS], '[٥] الثاني متروك والأوّل منفَّذ ⟵ PASS (المتروك لا يفشل شيئاً)');
    // sieveLimit
    for (const [label, mut, wantRe] of [
      ['غائب', (p) => { delete runsOf(p)[1].sieveLimit; }, /bad=\[order=2:ABSENT\]/],
      ['10000000', (p) => { runsOf(p)[1].sieveLimit = 10000000; }, /bad=\[order=2:10000000\]/],
      ['نصّ', (p) => { runsOf(p)[1].sieveLimit = '1000000'; }, /bad=\[order=2:WRONG_TYPE\(string\)\]/],
    ]) {
      const r = run(mut);
      deq([verdictOf(r, `${I.CPU_D_R2_SIEVE_LIMIT}_3`), verdictOf(r, I.CPU_D_R2)], [V.FAIL, V.FAIL], `[٥] sieveLimit ${label} ⟵ FAIL`);
      ok(wantRe.test(rowOf(r, `${I.CPU_D_R2_SIEVE_LIMIT}_3`).basis), `[٥] sieveLimit ${label}: التشغيل المخالف مسرود`);
    }
    // sievePrimeCount: العدد بحسب N لا بالثابت القديم 664579
    const oldConst = run((p) => { runsOf(p)[1].sievePrimeCount = 664579; });
    deq([verdictOf(oldConst, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_3`), verdictOf(oldConst, I.READER_ANOMALIES)], [V.FAIL, V.FAIL], '[٥] 664579 مع N=1000000 والحالة match ⟵ FAIL للتوقّع وللقارئ (تناقض الحالة مع المرجع بحسب N)');
    const noCount = run((p) => { delete runsOf(p)[1].sievePrimeCount; });
    ok(/bad=\[order=2:match:ABSENT\]/.test(rowOf(noCount, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_3`).basis), '[٥] العدد غائب في تشغيل match ⟵ FAIL ويُسمّى ABSENT لا صفراً');
    // مرحلة كلّها متروكة: لا أحكام قابلة للقياس إلا «الأوّل»
    const allSkipped = run((p) => { for (const i of [0, 1, 2]) runsOf(p)[i] = skippedElement(3, [25, 60, 92][i]); vrOf(p).cpuKnownAnswerState = 'partial:time_budget'; delete vrOf(p).cpuKnownAnswerTotalMsByPhase['3']; });
    deq([verdictOf(allSkipped, `${I.CPU_D_R2_FIRST_RUN}_3`), verdictOf(allSkipped, `${I.CPU_D_R2_SIEVE_LIMIT}_3`), verdictOf(allSkipped, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_3`)], [V.FAIL, V.NOT_MEASURED, V.NOT_MEASURED], '[٥] مرحلة كلّها متروكة: الأوّل FAIL، وsieveLimit وsievePrimeCount NOT_MEASURED (لا صفر ولا نجاح)');
    ok(/skippedRuns=3 /.test(rowOf(allSkipped, `${I.CPU_D_R2_SUMMARY}_3`).basis) && /totalDMs=ABSENT_FOR_PHASE/.test(rowOf(allSkipped, `${I.CPU_D_R2_SUMMARY}_3`).basis), '[٥] وملخّصها يعدّ الثلاثة متروكة، والمجموع غائب بحالته');
    // لا تشغيلات
    const noRuns = run((p) => { delete vrOf(p).cpuKnownAnswerRuns; });
    eq(verdictOf(noRuns, I.CPU_D_R2), V.NOT_MEASURED, '[٥] fv70 بلا cpuKnownAnswerRuns ⟵ NOT_MEASURED');
  }
  // الحالة الإجمالية في CPU_D_SHARE: كل قيمة × وجود المتروك (القاعدة 30). الصنف المعروف يُحسب؛ غيره NOT_MEASURED؛ والتناقض بين الحالة والتشغيلات يُعلَن شذوذاً فيجعل الصفّ FAIL (لا يُقرأ نجاحاً).
  {
    for (const [state, key, wantVerdict, label] of [
      ['ran', 'c13', V.PASS, 'ran بلا متروك'],
      ['partial:time_budget', 'c11', V.PASS, 'partial مع متروك'],
      ['partial:time_budget', 'c13', V.FAIL, 'partial بلا متروك (تناقض يُعلَن PARTIAL_WITHOUT_SKIPPED_RUNS)'],
      ['ran', 'c11', V.FAIL, 'ran مع متروك (تناقض يُعلَن RAN_WITH_SKIPPED_RUNS)'],
      ['not_run:no_check_reached', 'c13', V.NOT_MEASURED, 'not_run'],
      ['partial:other', 'c13', V.NOT_MEASURED, 'partial:<سبب آخر> غير معروفة'],
      ['junk', 'c13', V.NOT_MEASURED, 'قيمة مجهولة'],
    ]) {
      const p = loadGolden('fv70', key);
      vrOf(p).cpuKnownAnswerState = state;
      const r = evalOf(p);
      eq(verdictOf(r, I.CPU_D_SHARE), wantVerdict, `[٥] CPU_D_SHARE ${label}`);
      const anomalous = (state === 'partial:time_budget' && key === 'c13') || (state === 'ran' && key === 'c11') || ['not_run:no_check_reached', 'partial:other', 'junk'].includes(state);
      eq(verdictOf(r, I.READER_ANOMALIES), anomalous ? V.FAIL : V.PASS, `[٥] READER_ANOMALIES ${label}: ${anomalous ? 'يُعلَن' : 'نظيف'}`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ٥-ب (الجزء الخامس) — cancelled وalloc_failed في صفوف D، ثم ختم القواعد وتصنيف الدورات وبصمة الجهاز المحفوظة
  // ═════════════════════════════════════════════════════════════════════
  {
    const clean13 = () => { const p = clone(loadGolden('fv70', 'c13')); Object.assign(runsOf(p)[4], {sieveStatus: 'match', sievePrimeCount: 78498}); return p; };
    const cancelledEl = (phase, pct) => ({phase, plannedAtPct: pct, t: 210945, tEnd: 210950, sieveStatus: 'cancelled', sha256Status: 'cancelled'});
    const run = (mut, extra) => { const p = clean13(); mut(p); return evalOf(p, 'R2', extra); };
    eq(evalOf(clean13()).rows.filter((r) => r.verdict === V.FAIL).length, 0, '[٥-ب] الأصل المُصلَح بلا FAIL');
    // cancelled في الأوّل: لا «حاضر» ولا يُعدّ منفَّذاً
    const firstC = run((p) => { runsOf(p)[0] = cancelledEl(3, 25); });
    deq([verdictOf(firstC, `${I.CPU_D_R2_FIRST_RUN}_3`), verdictOf(firstC, I.CPU_D_R2)], [V.FAIL, V.FAIL], '[٥-ب] الأوّل cancelled ⟵ CPU_D_R2_FIRST_RUN_3 FAIL');
    ok(/FIRST_RUN_CANCELLED/.test(rowOf(firstC, `${I.CPU_D_R2_FIRST_RUN}_3`).basis), '[٥-ب] بسببه المسمّى FIRST_RUN_CANCELLED');
    ok(/executedRuns=2 skippedRuns=0 notReachedRuns=0 cancelledRuns=1/.test(rowOf(firstC, `${I.CPU_D_R2_SUMMARY}_3`).basis), '[٥-ب] والملخّص يعدّ cancelled منفصلاً ولا يعدّها منفَّذة (executedRuns=2 لا 3)');
    // cancelled في الثاني: الأوّل منفَّذ فلا FAIL، ولا تدخل cancelled أيّ حكم sieveLimit/sievePrimeCount
    const secondC = run((p) => { runsOf(p)[1] = cancelledEl(3, 60); });
    deq([verdictOf(secondC, `${I.CPU_D_R2_FIRST_RUN}_3`), verdictOf(secondC, `${I.CPU_D_R2_SIEVE_LIMIT}_3`), verdictOf(secondC, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_3`), verdictOf(secondC, I.CPU_D_R2)], [V.PASS, V.PASS, V.PASS, V.PASS], '[٥-ب] الثاني cancelled والأوّل منفَّذ ⟵ PASS (cancelled لا نجاح ولا فشل)');
    ok(/runsWithLimit=2 /.test(rowOf(secondC, `${I.CPU_D_R2_SIEVE_LIMIT}_3`).basis) && /reportedRuns=2 /.test(rowOf(secondC, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_3`).basis), '[٥-ب] وعدد ما دخل الحكمين 2 من 3 (cancelled خارجهما)');
    ok(/executedRuns=2 skippedRuns=0 notReachedRuns=0 cancelledRuns=1/.test(rowOf(secondC, `${I.CPU_D_R2_SUMMARY}_3`).basis), '[٥-ب] والملخّص cancelledRuns=1');
    eq(verdictOf(secondC, I.READER_ANOMALIES), V.PASS, '[٥-ب] والقارئ بلا شذوذ');
    // cancelled ومعه sieveLimit: شذوذ القارئ يصل الحكم المجمَّع
    const cWithLimit = run((p) => { runsOf(p)[1] = {...cancelledEl(3, 60), sieveLimit: 1000000}; });
    deq([verdictOf(cWithLimit, I.READER_ANOMALIES), /CANCELLED_WITH_SIEVE_LIMIT/.test(rowOf(cWithLimit, I.READER_ANOMALIES).basis)], [V.FAIL, true], '[٥-ب] cancelled ومعه sieveLimit ⟵ READER_ANOMALIES FAIL باسم الشذوذ');
    // alloc_failed حامل: N مطلوب، ويدخل حكم sieveLimit، وتبقى خارج sievePrimeCount (لا عدد)
    const allocNoLimit = run((p) => { runsOf(p)[1] = {phase: 3, plannedAtPct: 60, t: 210945, tEnd: 210946, sieveStatus: 'alloc_failed', sha256Status: 'match', sha256DurationMs: 3}; });
    ok(verdictOf(allocNoLimit, `${I.CPU_D_R2_SIEVE_LIMIT}_3`) === V.FAIL && /bad=\[order=2:ABSENT\]/.test(rowOf(allocNoLimit, `${I.CPU_D_R2_SIEVE_LIMIT}_3`).basis), '[٥-ب] alloc_failed بلا sieveLimit ⟵ FAIL (حامل بالعقد :1669)');
    const allocWithLimit = run((p) => { runsOf(p)[1] = {phase: 3, plannedAtPct: 60, t: 210945, tEnd: 210946, sieveStatus: 'alloc_failed', sieveLimit: 1000000, sha256Status: 'match', sha256DurationMs: 3}; });
    deq([verdictOf(allocWithLimit, `${I.CPU_D_R2_SIEVE_LIMIT}_3`), /runsWithLimit=3 /.test(rowOf(allocWithLimit, `${I.CPU_D_R2_SIEVE_LIMIT}_3`).basis), /reportedRuns=2 /.test(rowOf(allocWithLimit, `${I.CPU_D_R2_SIEVE_PRIME_COUNT}_3`).basis), verdictOf(allocWithLimit, I.CPU_D_R2)],
        [V.PASS, true, true, V.PASS], '[٥-ب] alloc_failed ومعه N ⟵ PASS، ويدخل حكم N (3 تشغيلات) وخارج العدد (2 مُبلَّغان)');

    // ─── ختم قواعد التقييم ───
    const {EVALUATION_RULES_VERSION, EVALUATION_RULES_VERSION_FIELD} = require('../src/analysis/evaluationRulesVersion');
    const {V7_PIPELINE_TAG, CACHED_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
    const PRES = (v) => ({state: 'PRESENT', value: v});
    const stampOf = (stamp, pipeline) => ({facts: {rulesStamp: {stamp, pipeline}}});
    const stampRow = (res) => rowOf(res, I.EVALUATION_RULES_STAMP);
    {
      const pass = evalOf(clean13(), 'R2', stampOf(PRES(EVALUATION_RULES_VERSION), PRES(V7_PIPELINE_TAG)));
      deq([stampRow(pass).verdict, stampRow(pass).basis], [V.PASS, `${EVALUATION_RULES_VERSION_FIELD}=${EVALUATION_RULES_VERSION} expected=${EVALUATION_RULES_VERSION} pipeline=${V7_PIPELINE_TAG}`], '[٥-ب] ختم القواعد = الثابت الواحد ⟵ PASS (الثابت والاسم من المصدر المُصدَّر لا نسخة حرفية)');
      deq(pass.block.rulesStamp, {field: EVALUATION_RULES_VERSION_FIELD, state: 'PRESENT', value: EVALUATION_RULES_VERSION, expected: EVALUATION_RULES_VERSION, pipeline: V7_PIPELINE_TAG}, '[٥-ب] كتلة rulesStamp: اسم الحقل والقيمة والمتوقَّع كلّها من الثابت الواحد');
      const absent = evalOf(clean13(), 'R2', stampOf({state: 'ABSENT', value: null}, PRES(V7_PIPELINE_TAG)));
      deq([stampRow(absent).verdict, /evaluationRulesVersion=ABSENT/.test(stampRow(absent).basis)], [V.FAIL, true], '[٥-ب] غياب الختم في تقرير كُتب بعد النشر (V7) ⟵ FAIL');
      const absentCached = evalOf(clean13(), 'R2', stampOf({state: 'ABSENT', value: null}, PRES(CACHED_PIPELINE_TAG)));
      deq([stampRow(absentCached).verdict, /pipeline=cached/.test(stampRow(absentCached).basis)], [V.NOT_MEASURED, true], '[٥-ب] غيابه في تقرير pipeline=cached ⟵ NOT_MEASURED (المخبَّأ يحمل ختم الأصل إن حمله وإلا يغيب) لا FAIL');
      const other = evalOf(clean13(), 'R2', stampOf(PRES('rules-other'), PRES(CACHED_PIPELINE_TAG)));
      eq(stampRow(other).verdict, V.FAIL, '[٥-ب] قيمة أخرى ⟵ FAIL حتى في المخبَّأ (غير الغياب لا يُعفى)');
      const wrongType = evalOf(clean13(), 'R2', stampOf({state: 'WRONG_TYPE(number)', value: null}, PRES(V7_PIPELINE_TAG)));
      deq([stampRow(wrongType).verdict, /evaluationRulesVersion=WRONG_TYPE\(number\)/.test(stampRow(wrongType).basis)], [V.FAIL, true], '[٥-ب] نوع خاطئ ⟵ FAIL باسم الحالة');
      const noPipeline = evalOf(clean13(), 'R2', stampOf({state: 'ABSENT', value: null}, {state: 'ABSENT', value: null}));
      eq(stampRow(noPipeline).verdict, V.FAIL, '[٥-ب] غياب الختم وغياب pipeline أيضاً ⟵ FAIL (لا يُعفى إلا المخبَّأ المعلوم)');
      const uncollected = evalOf(clean13());
      deq([stampRow(uncollected).verdict, /NOT_COLLECTED/.test(stampRow(uncollected).basis)], [V.NOT_MEASURED, true], '[٥-ب] facts بلا rulesStamp ⟵ NOT_MEASURED:NOT_COLLECTED (لا نجاح ضمنياً)');
      const old = evalOf(loadGolden('fv69', 'c13'), 'R2', stampOf(PRES(EVALUATION_RULES_VERSION), PRES(V7_PIPELINE_TAG)));
      deq([stampRow(old).verdict, /BEFORE_FV70/.test(stampRow(old).basis)], [V.NOT_MEASURED, true], '[٥-ب] ختم fv69 ⟵ NOT_MEASURED:BEFORE_FV70 (صفوف الجولة الثانية)');
    }

    // ─── تصنيف الدورات: التوقّع لكل وسم وسيط ───
    const withCycles = (cycleCount, source, state) => { const p = clean13(); Object.assign(p.timeSeries.footer.batteryHealth, {cycleCount, cycleCountSource: source, cycleCountState: state}); return p; };
    const CLASS = N.CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34;
    const classRow = (p, extra) => rowOf(evalOf(p, 'R2', extra), I.CYCLE_CLASSIFICATION);
    {
      const zero = withCycles(0, 'extra_api34', 'read');
      deq([classRow(zero, {cycleExpect: {R2: 'classified'}}).verdict, /observed=unsupported:zero_from_extra_api34/.test(classRow(zero, {cycleExpect: {R2: 'classified'}}).basis)], [V.PASS, true], '[٥-ب] صفر من extra_api34 والتوقّع classified ⟵ PASS (المرصود من القارئ نفسه)');
      eq(classRow(zero, {cycleExpect: {R2: 'none'}}).verdict, V.FAIL, '[٥-ب] والتوقّع none ⟵ FAIL (الـS10 لو صُنّف)');
      const info = classRow(zero);
      deq([info.verdict, /expectation=NOT_SUPPLIED_FOR_TAG\(R2\)/.test(info.basis)], [V.INFO, true], '[٥-ب] وسم بلا توقّع ⟵ INFO بسببه (لا حكم بالتخمين)');
      deq([classRow(zero, {cycleExpect: {OTHER: 'classified'}}).verdict], [V.INFO], '[٥-ب] توقّع وسم آخر لا يَسري على هذا الوسم');
      const real = withCycles(187, 'extra_api34', 'read');
      deq([classRow(real, {cycleExpect: {R2: 'none'}}).verdict, classRow(real, {cycleExpect: {R2: 'classified'}}).verdict], [V.PASS, V.FAIL], '[٥-ب] 187 دورة (حقيقية): none ⟵ PASS، وclassified ⟵ FAIL');
      const sysfsZero = withCycles(0, 'sysfs:/sys/class/power_supply/battery/cycle_count', 'read');
      eq(classRow(sysfsZero, {cycleExpect: {R2: 'none'}}).verdict, V.PASS, '[٥-ب] صفر من sysfs (لا من extra_api34): null ⟵ none PASS');
      const notRead = clone(loadGolden('fv70', 'c11'));
      eq(classRow(notRead, {cycleExpect: {R2: 'none'}}).verdict, V.PASS, '[٥-ب] الدورات not_read (11ch): null ⟵ none PASS (غياب القيمة لا يُصنَّف)');
      const old = loadGolden('fv69', 'c13');
      deq([classRow(old, {cycleExpect: {R2: 'none'}}).verdict, /BEFORE_FV70/.test(classRow(old, {cycleExpect: {R2: 'none'}}).basis)], [V.NOT_MEASURED, true], '[٥-ب] fv69 ⟵ NOT_MEASURED:BEFORE_FV70');
    }
    // ─── main الحقيقية: --cycle-expect يصل التقييم (وسيط لكل وسم، لا ثابت) ───
    {
      const os = require('os');
      const H = require('./lib/deviceCheck03Harness');
      const {main: mainAfter} = require('../scripts/device-check-03-after-readonly');
      const EMAIL = 'owner@example.test';
      const OWNER = 'owner-uid-cli-0001';
      const rawOf = (id, payload) => ({scanId: id, rawFingerprint: clone(lightenFingerprintForStorage(payload)), sessionId: null, deviceFingerprintSha: 'sha', timeSeriesStoragePath: '', aiAudit: null, source: 'analyzeDevice'});
      const stampedReport = (shortId) => ({shortId, userId: OWNER, [EVALUATION_RULES_VERSION_FIELD]: EVALUATION_RULES_VERSION, pipeline: V7_PIPELINE_TAG});
      const world = () => makeMemDb({
        reports: {sA: stampedReport('NC-CLIAAA'), sB: stampedReport('NC-CLIBBB')},
        reportRaw: {sA: rawOf('sA', withCycles(0, 'extra_api34', 'read')), sB: rawOf('sB', withCycles(187, 'extra_api34', 'read'))},
      });
      const {auth} = H.makeRecordingAuth(async (email) => { if (email !== EMAIL) throw Object.assign(new Error('no user'), {code: 'auth/user-not-found'}); return {uid: OWNER}; });
      const runCli = async (extraArgs) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-d-cli-'));
        const out = path.join(dir, 'o.json');
        try {
          const r = await H.runMain(mainAfter, ['--tokens', 'S1=NC-CLIAAA,B1=NC-CLIBBB', '--out', out, '--no-storage', ...extraArgs], {env: {[C.OWNER_EMAIL_ENV]: EMAIL}, now: () => 1_800_000_000_000, db: world(), auth});
          return {code: r.code, errs: r.errs, j: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null};
        } finally {
          fs.rmSync(dir, {recursive: true, force: true}); // مجلّد الاختبار المؤقّت الذي أنشأه هذا الاختبار وحده
        }
      };
      const cell = (j, tag, item) => j.table.find((r) => r.tag === tag && r.item === item);
      const right = await runCli(['--cycle-expect', 'S1=classified,B1=none']);
      ok(right.j !== null && right.code !== 2, `[٥-ب] CLI: كُتب المخرَج (${right.code})`);
      deq([cell(right.j, 'S1', I.CYCLE_CLASSIFICATION).verdict, cell(right.j, 'B1', I.CYCLE_CLASSIFICATION).verdict, right.j.input.cycleExpect], [V.PASS, V.PASS, {S1: 'classified', B1: 'none'}], '[٥-ب] CLI: التوقّعان يصلان التقييم (S1 classified وB1 none) ويُكتبان في input');
      const swapped = await runCli(['--cycle-expect', 'S1=none,B1=classified']);
      deq([cell(swapped.j, 'S1', I.CYCLE_CLASSIFICATION).verdict, cell(swapped.j, 'B1', I.CYCLE_CLASSIFICATION).verdict, swapped.j.summary.hasFail, swapped.code], [V.FAIL, V.FAIL, true, 1], '[٥-ب] CLI: التوقّعان معكوسان ⟵ FAIL فيهما ورمز الخروج 1');
      const none = await runCli([]);
      deq([cell(none.j, 'S1', I.CYCLE_CLASSIFICATION).verdict, cell(none.j, 'B1', I.CYCLE_CLASSIFICATION).verdict, none.j.input.cycleExpect], [V.INFO, V.INFO, {}], '[٥-ب] CLI: بلا --cycle-expect ⟵ INFO للوسمين (لا توقّع مفترَض)');
      deq([cell(right.j, 'S1', I.EVALUATION_RULES_STAMP).verdict, cell(right.j, 'S1', I.CYCLE_CLASSIFICATION_SIGNATURE).verdict], [V.PASS, V.INFO], '[٥-ب] CLI: ختم القواعد من جذر reports PASS، وبصمة الجهاز INFO');
      ok(/profileState=PROFILE_BY_PRIMARY_NOT_FOUND/.test(cell(right.j, 'S1', I.CYCLE_CLASSIFICATION_SIGNATURE).basis), '[٥-ب] CLI: ولا ملفّ جهاز في العالم المصطنع ⟵ حالة مسمّاة لا غياب صامت');
    }
    // B-08 والحمولة إلى النموذج: لا صفّ يدّعي ما لا يُقرأ (القاعدة 22) — كتلة explicit في المخرَج لا صفّ حكم
    {
      const res = evalOf(clean13());
      eq(res.rows.some((r) => /B08_MODEL|MODEL_PAYLOAD/.test(r.item)), false, '[٥-ب] لا صفّ حكم عن وصول B-08 إلى النموذج');
      eq(res.block.b08ModelPayload.state, 'NOT_READABLE_FROM_PRODUCTION', '[٥-ب] والكتلة تقول صراحةً إنه غير مقروء من الإنتاج');
      ok(res.block.b08ModelPayload.evidence.includes('[cycleCount] classification=') && res.block.b08ModelPayload.evidence.includes('B-08 omitted from categoryStates.testResults (not sent to the model)'), '[٥-ب] وتسمّي سطر السجلّ بحروفه');
    }

    // ─── بصمة الجهاز المحفوظة (INFO) ───
    {
      const sigRow = (profile, extra = {}) => rowOf(evalOf(clean13(), 'R2', {facts: profile === undefined ? {} : {profile}, ...extra}), I.CYCLE_CLASSIFICATION_SIGNATURE);
      const none = sigRow(undefined);
      deq([none.verdict, /NOT_COLLECTED/.test(none.basis)], [V.INFO, true], '[٥-ب] facts بلا profile ⟵ INFO:NOT_COLLECTED');
      const missing = sigRow({state: 'PROFILE_BY_PRIMARY_NOT_FOUND', profileIdHash: 'h1'});
      deq([missing.verdict, missing.basis], [V.INFO, 'profileState=PROFILE_BY_PRIMARY_NOT_FOUND profileIdHash=h1'], '[٥-ب] PROFILE_BY_PRIMARY_NOT_FOUND ⟵ INFO باسم الحالة');
      const saved = sigRow({state: 'ENTRY_FOUND', profileIdHash: 'h1', historyLength: 3, signatureState: 'OBJECT', classification: PRES(CLASS)}, {cycleExpect: {}});
      ok(saved.verdict === V.INFO && /savedClassification=unsupported:zero_from_extra_api34/.test(saved.basis) && /sameAsObserved=false/.test(saved.basis) && /observedInReport=null/.test(saved.basis), '[٥-ب] المحفوظ classified والمرصود في التقرير null (187 دورة) ⟵ sameAsObserved=false، INFO لا FAIL');
      const absentKey = sigRow({state: 'ENTRY_FOUND', profileIdHash: 'h1', historyLength: 3, signatureState: 'OBJECT', classification: {state: 'ABSENT', value: null}});
      ok(/savedClassification=KEY_ABSENT/.test(absentKey.basis) && /sameAsObserved=NOT_COMPARABLE/.test(absentKey.basis), '[٥-ب] المفتاح غائب من التوقيع ⟵ KEY_ABSENT وNOT_COMPARABLE (لا «لا تصنيف» ضمنياً)');
      const sigNull = sigRow({state: 'ENTRY_FOUND', profileIdHash: 'h1', historyLength: 3, signatureState: 'SIGNATURE_NULL', classification: null});
      ok(/savedClassification=SIGNATURE_NULL/.test(sigNull.basis), '[٥-ب] التوقيع null ⟵ SIGNATURE_NULL');
      eq(rowOf(evalOf(loadGolden('fv69', 'c13'), 'R2', {facts: {profile: {state: 'PROFILE_BY_PRIMARY_NOT_FOUND', profileIdHash: 'h'}}}), I.CYCLE_CLASSIFICATION_SIGNATURE).verdict, V.NOT_MEASURED, '[٥-ب] fv69 ⟵ NOT_MEASURED:BEFORE_FV70');
    }

    // ─── الجمع: gatherReportFacts يقرأ الختم وبصمة الجهاز بالقراءة وحدها ───
    {
      const {normalizeDeviceProfileKey} = require('../src/profiles/deviceProfileKey');
      const payload = clean13();
      const lightened = clone(lightenFingerprintForStorage(payload));
      const primary = normalizeDeviceProfileKey(lightened.device.deviceProfileKey).key.primary;
      const SCAN = 'scan-gather-0001';
      const worldOf = (profileDoc, reportExtra) => makeMemDb({
        reports: {[SCAN]: {shortId: 'NC-GTH001', userId: 'u', ...(reportExtra || {})}},
        reportRaw: {[SCAN]: {scanId: SCAN, rawFingerprint: lightened, sessionId: null, deviceFingerprintSha: 'sha', timeSeriesStoragePath: '', aiAudit: null, source: 'analyzeDevice'}},
        ...(profileDoc === undefined ? {} : {deviceProfiles: {[primary]: profileDoc}}),
      });
      const gather = (db) => D.gatherReportFacts({db, bucket: null, tag: 'R2', shortId: 'NC-GTH001', accountHash: C.hashIdForLog('u'), useStorage: false});
      const f1 = await gather(worldOf({scanHistory: [{scanId: 'other', signature: null}, {scanId: SCAN, signature: {battery: {cycleCountClassification: CLASS}}}]}, {[EVALUATION_RULES_VERSION_FIELD]: EVALUATION_RULES_VERSION, pipeline: V7_PIPELINE_TAG}));
      deq([f1.rulesStamp.stamp, f1.rulesStamp.pipeline], [PRES(EVALUATION_RULES_VERSION), PRES(V7_PIPELINE_TAG)], '[٥-ب] gather: الختم وpipeline من جذر مستند reports (حقلان لا المستند كلّه)');
      deq([f1.profile.state, f1.profile.historyLength, f1.profile.signatureState, f1.profile.classification, f1.profile.profileIdHash === C.hashIdForLog(primary)], ['ENTRY_FOUND', 2, 'OBJECT', PRES(CLASS), true], '[٥-ب] gather: عنصر scanHistory بـscanId التقرير، والتصنيف المحفوظ، والمعرّف مُهشَّراً');
      ok(!JSON.stringify(f1.profile).includes(primary), '[٥-ب] ولا معرّف الملفّ خامّاً في facts');
      const f2 = await gather(worldOf(undefined));
      deq([f2.profile.state, f2.rulesStamp.stamp.state], ['PROFILE_BY_PRIMARY_NOT_FOUND', 'ABSENT'], '[٥-ب] gather: لا ملفّ بـprimary ⟵ PROFILE_BY_PRIMARY_NOT_FOUND؛ والختم غائب ⟵ ABSENT');
      const f3 = await gather(worldOf({scanHistory: [{scanId: 'other', signature: null}]}));
      deq([f3.profile.state, f3.profile.historyLength], ['SCAN_NOT_IN_HISTORY', 1], '[٥-ب] gather: scanId ليس في أحدث الفحوص ⟵ SCAN_NOT_IN_HISTORY (لا تصنيف مختلَق)');
      const f4 = await gather(worldOf({scanHistory: [{scanId: SCAN, signature: {battery: {cycleCount: null}}}]}));
      deq([f4.profile.state, f4.profile.signatureState, f4.profile.classification.state], ['ENTRY_FOUND', 'OBJECT', 'ABSENT'], '[٥-ب] gather: التوقيع بلا مفتاح التصنيف ⟵ ABSENT (المفتاح لا يُكتب إلا حين وقع التصنيف)');
      const f5 = await gather(worldOf({}));
      eq(f5.profile.state, 'SCAN_HISTORY_ABSENT_OR_NOT_ARRAY', '[٥-ب] gather: ملفّ بلا scanHistory ⟵ حالة مسمّاة');
      const f6 = await gather(worldOf({scanHistory: [{scanId: SCAN, signature: null}]}));
      deq([f6.profile.state, f6.profile.signatureState], ['ENTRY_FOUND', 'SIGNATURE_NULL'], '[٥-ب] gather: signature=null ⟵ SIGNATURE_NULL');
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // ٦ — سكربت العناقيد: المتروك حالة صريحة (لا نافذة، ولا صفر، ولا غياب غير مُعلَن)
  // ═════════════════════════════════════════════════════════════════════
  {
    const p = loadGolden('fv70', 'c11');
    const {timeSeriesState, ...file} = p.timeSeries; void timeSeriesState;
    const scanId = 'scan-skip-0001';
    const sp = `scans/sha-skip/${scanId}.ts.json.gz`;
    const db = makeMemDb({reports: {[scanId]: {shortId: 'NC-SKP001', userId: 'u'}}, reportRaw: {[scanId]: {scanId, rawFingerprint: clone(lightenFingerprintForStorage(p)), sessionId: null, deviceFingerprintSha: 'sha-skip', timeSeriesStoragePath: sp, aiAudit: null, source: 'analyzeDevice'}}});
    const {bucket} = H.makeStubBucket({[sp]: H.gz(file)});
    const outPath = path.join(require('os').tmpdir(), `cpu-d-fv70-${process.pid}.json`);
    const outs = [];
    let code;
    try {
      code = await clusterMain(['--tokens', 'S21=NC-SKP001', '--out', outPath], {db, bucket, now: () => 1_800_000_000_000, out: (s) => outs.push(String(s)), err: () => {}});
      eq(code, 0, '[٦] رمز الخروج 0');
      const doc = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      const runs = doc.reports[0].runs;
      deq(runs.map((r) => r.windowState), ['OK', 'RUN_SKIPPED_TIME_BUDGET', 'RUN_SKIPPED_TIME_BUDGET', 'OK', 'OK', 'OK'], '[٦] المتروكان حالة صريحة RUN_SKIPPED_TIME_BUDGET (لا WINDOW_FIELDS_NOT_PRESENT ولا نافذة [0,0])');
      deq([runs[1].channels, runs[1].windowStateDetail], [null, `sieveStatus=${SKIPPED} sha256Status=${SKIPPED}`], '[٦] بلا قنوات (لا قيم مختلَقة) وحالتاه في التفصيل');
      eq(doc.summary.runsSkippedTimeBudget, 2, '[٦] الملخّص يعدّ المتروك (2)');
      ok(outs.some((l) => /phase=3 run=2 RUN_SKIPPED_TIME_BUDGET/.test(l)), '[٦] والسطر النصّي يقوله');
      eq(doc.summary.runsWithWindow, 4, '[٦] والنوافذ الصالحة أربع فقط');
    } finally {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath); // ملفّ الاختبار المؤقّت وحده
    }
  }

  console.log(`\ncpuKnownAnswerFv70.test.js: ${n} assertions passed`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});

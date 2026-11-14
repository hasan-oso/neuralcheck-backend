'use strict';

// fv68Reader.test.js — الدفعة ٤ من V8 (PLAN-05): قارئ الخادم لحمولة fieldsVersion 68؛ **مُحدَّث 2026-10-10 +03 إلى عيّنات fv69 (الدفعة ١٠)**.
//
// الشكل الذي يستقبله القارئ فعلاً (القاعدة 41): العيّنات الذهبية المشتقّة الثلاث في test/fixtures/golden/
// (fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-*.json — نُسخت من NeuralChek@a04b4f0 ويحرس نسختَها
// fv68AppPayloadGoldenCopy.test.js) وحمولة 1.0.10 (fv67-app-request-payload-…): كلها قيمة data.fingerprint كما يصل إلى analyzeDevice.
// ⚠️ الحمولات الثلاث **مشتقّة** من تسجيل fv67 لا من جهاز على fv69 (قيود العقد §٧-و/§٧-ح): المرحلة ٢ من القاعدة 41 (ملفّ حقيقي بعد 1.0.11) لم تُجرَ.
// ⚠️ fv68 لم يُشحن في أيّ APK: لا عيّنة fv68 هنا (حلّت fv69 محلّها). وما لا تحمله العيّنات (مفاتيح L-02 الإضافية وقراءات SN-08/SN-09 وdismissed لـM-02)
// يُختبر بأشكال اصطناعية مأخوذة من نصّ العقد وموسومة «اصطناعي».
//
// ما يثبّته:
//   أ) كل حالة في العيّنات الثلاث وعيّنة fv67 بقيمها، وأن لا شذوذ ولا غياب بلا سبب في الثلاث (حالات سليمة بتصميمها).
//   ب) **حارس التغطية** (القاعدة 25/39): حذف كل مفتاح جديد في fv68/fv69 (138 مساراً مقارنةً بعيّنة fv67، كانت 127 على عيّنات fv68) يُغيّر مخرَج القارئ — أي أن كل مفتاح
//      جديد يقرؤه قارئ. وما لا يقرؤه القارئ مُعدَّد باسمه وسببه، ويُفحص أنه فعلاً لا يغيّر المخرَج (فلا يصير الإعفاء ميّتاً).
//   جـ) الغياب بحالاته: ABSENT / ABSENT_DECLARED / NOT_IN_FILE / NOT_IN_FIELDS_VERSION / REMOVED_IN_FV68 / WRONG_TYPE.
//   د) حالات نصّية خارج المفردة تُعلَن UNRECOGNIZED ولا تُقرأ نجاحاً. ه) لا يرمي أبداً (تشويه كل ورقة في التذييل بخمسة أنواع).
//   و) وحدة v[8]/v[9] بـappVersion (س-19 المصحَّح). ز) العيّنات الفاشلة لكل قناة (س-27): كل حالات التتبّع.
//
// Run: node functions/test/fv68Reader.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const N = require('../src/analysis/fv68Names');
const R = require('../src/analysis/fv68Reader');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEMS = ['11ch-nothing-admitted', '13ch-selinux-blocked-policy', '16ch-four-policies-truncated-failures'];
const fileOf = (stem, ext) => path.join(GOLDEN, `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-${stem}.${ext}`);
const load = (stem) => JSON.parse(fs.readFileSync(fileOf(stem, 'json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const FV67_FILE = path.join(GOLDEN, 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8');
const fv67 = () => JSON.parse(fs.readFileSync(`${FV67_FILE}.json`, 'utf8')).fingerprint;

const P = {};
for (const s of STEMS) P[s] = load(s);
const OUT = {};
for (const s of STEMS) OUT[s] = R.readFv68(P[s]);
const OUT67 = R.readFv68(fv67());

// ═══════════════════════════════════════════════════════════════════
// أ) العيّنات الذهبية الثلاث بقيمها
// ═══════════════════════════════════════════════════════════════════
for (const s of STEMS) {
  const o = OUT[s];
  eq(o.readerError, undefined, `[أ][${s}] القارئ لم يرمِ`);
  eq([o.readerVersion, o.fieldsVersion, o.appVersion, o.applicable], [1, 69, '1.0.11', true], `[أ][${s}] الإصدار والختم (fv69: «مُنطبِق» بعتبة ≥ 68، لا «قديم»)`);
  eq(o.anomalies, [], `[أ][${s}] لا شذوذ في حمولة سليمة بتصميمها`);
  eq(o.absences.ABSENT, [], `[أ][${s}] لا غياب بلا سبب معلن`);
  eq(o.absences.NOT_IN_FILE, [], `[أ][${s}] لا مفتاح «ليس في الملفّ»`);
  eq(o.absences.removedInFv68Count, 6, `[أ][${s}] ستة مفاتيح محذوفة بالعقد غائبة كما يجب (maxCpuTemp وstorageSlcCacheSizeMb وأربعة قديمة)`);
  eq(o.timeSeriesState.state.kind, 'file', `[أ][${s}] timeSeriesState=file`);
  eq(o.lists.fieldsNotInFile, {status: 'PRESENT', names: []}, `[أ][${s}] fieldsNotInFile حاضرة وفارغة (ملفّ fv68 كامل)`);
  eq(o.layout.baseLayout, 'MATCHES', `[أ][${s}] الأعمدة الأساسية في مواضعها`);
  eq(o.layout.indexFrom, 'position', `[أ][${s}] الحمولة بلا index فالفهرس = الموضع`);
  eq(o.layout.unresolvedIndices, [], `[أ][${s}] لا عمود في v[] بلا اسم`);
  eq(o.layout.sampleWidthConsistent, true, `[أ][${s}] طول v[] ثابت داخل الفحص`);
  eq(o.throughputUnit.basis, N.THROUGHPUT_UNIT_BASIS.DECLARED_IN_PAYLOAD, `[أ][${s}] وحدة الإنتاجية: من fv68 بالمعلَن`);
  eq(o.throughputUnit.unit, 'MiB/s', `[أ][${s}] ووحدتها MiB/s`);
  eq(o.thermal.headroom.state.state.kind, 'ok', `[أ][${s}] thermalHeadroomState=ok`);
  eq(o.batteryPairs.state.kind, 'BROADCASTS_RECEIVED', `[أ][${s}] أزواج البطارية: وصلت بثّات`);
  eq(o.stillness.state.kind, 'measured', `[أ][${s}] stillnessState=measured`);
  eq(o.stillness.isStill, true, `[أ][${s}] isStill تصدق مع measured`);
  eq(o.footerDiagnostics.entries.thermalLists.kind, 'ok', `[أ][${s}] footerDiagnostics.thermalLists=ok`);
  eq(Object.values(o.footerDiagnostics.entries).every((e) => e.kind === 'ok'), true, `[أ][${s}] كل أقسام التذييل بُنيت في التطبيق (ok)`);
  eq(o.lists.transitionalAggregates.names.length, 14, `[أ][${s}] transitionalAggregates: 14 اسماً`);
  eq(o.lists.unmeasuredDefaults.names.length, 6, `[أ][${s}] unmeasuredDefaults: 6 أسماء (منها منقوطة)`);
  ok(o.lists.unmeasuredDefaults.names.includes('dataQuality.cpuTempCoveragePct'), `[أ][${s}] الأسماء المنقوطة تُقرأ كما هي`);
}

// 11 عموداً: لا قناة أُدرجت
{
  const o = OUT['11ch-nothing-admitted'];
  eq(o.layout.columnCount, 11, '[أ][11ch] أحد عشر عموداً');
  eq([o.layout.policyChannels, o.layout.chargeCounter], [[], null], '[أ][11ch] لا قنوات سياسات ولا عدّاد شحن');
  eq(o.cpuPolicies.policies, [], '[أ][11ch] cpuPolicies=[] «جرى ولم يجد» (حاضرة وفارغة، لا غائبة)');
  eq(o.cpuPolicies.status, 'PRESENT', '[أ][11ch] ومفتاحها حاضر');
  eq(Object.keys(o.channelReadFailures.channels).every((k) => o.channelReadFailures.channels[k].tracking === 'NOT_TRACKED_BY_DESIGN'), true,
      '[أ][11ch] كل الأعمدة أساسية: حرّاسها قيد معروف بنصّ الحسم');
  eq(o.cpuTemp.state, 'ABSENT_DECLARED', '[أ][11ch] حرارة المعالج: غياب معلن (cpuTempFinalSource=absent:…)');
  eq([o.cpuTemp.valueC, o.cpuTemp.valueStatus], [null, 'ABSENT_DECLARED'], '[أ][11ch] لا رقم ولا صفر ولا -1');
  eq(o.cpuTemp.source.kind, 'absent', '[أ][11ch] مصدرها absent: والسبب نصّ');
  ok(o.cpuTemp.source.detail.includes('readCpuTemp returned -1.0'), '[أ][11ch] نصّ السبب محفوظ حرفياً (القاعدة 21)');
  eq(o.thermal.headroom.readings.byKind, {ok: 48}, '[أ][11ch] 48 قراءة headroom كلّها ok');
  eq(o.thermal.status.events.items.length, 5, '[أ][11ch] خمسة أحداث حالة حرارية');
  eq(o.thermal.status.events.maxStatus, 3, '[أ][11ch] أقصى حالة 3');
  eq([o.batteryPairs.state.broadcastCount, o.batteryPairs.state.droppedByCap, o.batteryPairs.state.invalidReads], [24, 0, 24], '[أ][11ch] بثّات البطارية 24 كلّها قراءة الشحن فيها غير صالحة');
  eq(o.batteryPairs.pairs.items[0].chargeCounterRaw, null, '[أ][11ch] حقل غير صالح غائب في العنصر لا صفر (عقد :500)');
  eq(o.batteryHealth.cycleCount.state.raw, 'not_read:sysfs_not_readable_or_absent_and_api_below_34', '[أ][11ch] الدورات: غياب بسببه');
  eq(o.batteryHealth.cycleCount.valueStatus, 'ABSENT_DECLARED', '[أ][11ch] والقيمة غائبة بحالة معلنة');
  eq(o.batteryHealth.cycleCount.source.kind, 'unavailable', '[أ][11ch] cycleCountSource=unavailable');
  eq(o.batteryHealth.chargeCounter.state.raw, 'not_read:unsupported_by_device', '[أ][11ch] عدّاد الشحن: غير مدعوم');
  eq(o.verification.memory.state.state.kind, 'ran', '[أ][11ch] الذاكرة جرت');
  eq(o.verification.memory.errors, {march: 0, walkingOnes: 0, randomVerify: 0}, '[أ][11ch] أخطاء الذاكرة صفر حقيقي (مع ran)');
  eq(o.verification.memory.derived, {marchPassed: true, walkingOnesPassed: true}, '[أ][11ch] …Passed تُشتقّ true مع ran وصفر');
  eq(o.verification.storage.state.state.kind, 'ran', '[أ][11ch] التخزين جرى');
  eq(o.verification.storage.errors, {write: 0, read: 0}, '[أ][11ch] أخطاء التخزين صفر حقيقي (مع ran)');
  eq(o.verification.cpuKnownAnswer.mismatches, 0, '[أ][11ch] فحوص النتيجة المعروفة: لا عدم تطابق (ran)');
  eq(o.verification.cpuKnownAnswer.counts.runs, 6, '[أ][11ch] ستة تشغيلات');
  eq(o.verification.cpuKnownAnswer.totalMsByPhase.byPhase, {3: 360, 5: 360}, '[أ][11ch] مجموع زمن D لكل مرحلة (خام)');
  eq(o.verification.gpuGemm.state.state.kind, 'passed', '[أ][11ch] gemm passed');
  eq(o.verification.gpuGemm.correct, true, '[أ][11ch] gpuComputeGemmCorrect=true');
  eq(o.verification.criticalDefect.value, false, '[أ][11ch] criticalDefectDetected=false');
  eq(o.verification.criticalDefect.inputsNotRun, [], '[أ][11ch] وكل المُدخلات جرت');
  eq(o.verification.workersPin.state.state.kind, 'not_attempted', '[أ][11ch] لم يُحاوَل التثبيت');
  eq(o.verification.workersPin.state.state.detail, 'ai_workload_path', '[أ][11ch] وسببه مسار الذكاء');
  eq(o.verification.workersPin.pinned.workersPinnedBig, null, '[أ][11ch] عدّاد التثبيت غائب لا 0');
  eq(o.verification.aiDelegate.noInitErrorDeclared, true, '[أ][11ch] aiDelegateInitError غائب مع مندوب حاضر: «لا خطأ» معلن');
  eq(o.verification.aiDelegate.initErrorStatus, 'ABSENT_DECLARED', '[أ][11ch] وليس سلسلة فارغة');
  eq(o.channelDiscovery.reasons.charge_counter_raw.kind, 'UNSUPPORTED_BY_PLATFORM', '[أ][11ch] سبب غياب عدّاد الشحن: Long.MIN_VALUE (غير مدعوم)');
  eq(o.channelDiscovery.reasons.cpu_temp_c.kind, 'ERROR_TEXT_NOT_EXPOSED', '[أ][11ch] قارئ لا يكشف نصّ خطئه: يُسمّى صراحةً لا يُختلق سبب');
  eq(o.channelDiscovery.reasons.skin_temp_c_real.kind, 'OTHER', '[أ][11ch] وما سواه OTHER بنصّه');
}

// 13 عموداً: عدّاد شحن وسياسة واحدة، وسياسة محجوبة
{
  const o = OUT['13ch-selinux-blocked-policy'];
  eq(o.layout.columnCount, 13, '[أ][13ch] ثلاثة عشر عموداً');
  eq(o.layout.chargeCounter, {index: 11, unit: 'as_declared_by_device'}, '[أ][13ch] عدّاد الشحن في العمود 11 بالاسم، ووحدته المعلنة «كما أعلنها الجهاز»');
  eq(o.layout.policyChannels, [{name: 'cpu_freq_policy0_khz', index: 12, policy: 0}], '[أ][13ch] قناة سياسة واحدة');
  eq(o.cpuPolicies.policies.map((p) => [p.policy, p.maxFreq.state]), [[0, 'READ'], [4, 'UNREADABLE']], '[أ][13ch] السياسة 4 مقروءة التردّد الأقصى لا');
  ok(o.cpuPolicies.policies[1].maxFreq.reason.includes('EACCES'), '[أ][13ch] وسبب عدم قراءتها نصّ EACCES');
  eq(o.cpuPolicies.policiesWithoutChannel, [4], '[أ][13ch] السياسة المحجوبة بلا قناة (لا تُدرج)');
  eq(o.cpuPolicies.channelsWithoutPolicyEntry, [], '[أ][13ch] ولا قناة بلا عنصر');
  eq(o.channelDiscovery.lists.blockedBySelinux, ['cpu_freq_policy4_khz'], '[أ][13ch] المحجوبة في blockedBySelinux');
  eq(o.channelDiscovery.reasons.cpu_freq_policy4_khz.kind, 'BLOCKED_ACCESS_DENIED', '[أ][13ch] وتُصنَّف بنصّ الخطأ EACCES لا بصنف الاستثناء');
  eq(o.channelReadFailures.channels.charge_counter_raw.tracking, 'COMPLETE', '[أ][13ch] قائمة فشل عدّاد الشحن كاملة');
  eq(o.channelReadFailures.channels.charge_counter_raw.failedIndices, [100, 101, 102, 900], '[أ][13ch] أربع عيّنات فاشلة');
  eq(o.channelReadFailures.channels.cpu_freq_policy0_khz, {tracking: 'COMPLETE', failedIndices: [], listedCount: 0, count: 0,
    invalidIndexCount: 0, outOfRangeCount: 0, duplicateIndexCount: 0}, '[أ][13ch] قائمة فارغة كاملة = «لا فشل» (≠ غياب المفتاح)');
  eq(o.thermal.headroom.readings.byKind, {ok: 46, nan: 1, exception: 1}, '[أ][13ch] قراءات headroom: ok وnan واستثناء');
  const nan = o.thermal.headroom.readings.items.find((x) => x.kind === 'nan');
  eq(nan.headroom, null, '[أ][13ch] قراءة NaN: headroom غائبة لا NaN ولا 0');
  const exc = o.thermal.headroom.readings.items.find((x) => x.kind === 'exception');
  ok(typeof exc.detail === 'string' && exc.detail.length > 0, '[أ][13ch] قراءة الاستثناء تحمل نصّ الخطأ (القاعدة 21)');
  eq(o.cpuTemp.state, 'LIVE_READ_AT_FINALIZE', '[أ][13ch] حرارة المعالج: قراءة حيّة عند الإنهاء');
  eq(o.cpuTemp.valueC, 52, '[أ][13ch] وقيمتها 52');
  eq(o.batteryHealth.cycleCount.value, 187, '[أ][13ch] الدورات 187');
  eq(o.batteryHealth.cycleCount.source.kind, 'extra_api34', '[أ][13ch] مصدرها EXTRA_CYCLE_COUNT');
  eq(o.preScanWarnings.state.kind, 'not_written', '[أ][13ch] preScanWarningsState=not_written');
  eq(o.verification.memory.state.state.kind, 'partial', '[أ][13ch] الذاكرة جزئية (سقف الزمن)');
  eq(o.verification.memory.state.state.detail, 'time_cap_reached', '[أ][13ch] بسبب بلوغ سقف الزمن');
  eq(o.verification.memory.derived, {marchPassed: null, walkingOnesPassed: null}, '[أ][13ch] صفر أخطاء على partial لا يُقرأ نجاحاً (…Passed=null)');
  ok(o.verification.memory.bytes.verified < o.verification.memory.bytes.buffer, '[أ][13ch] المُتحقَّق منه أقلّ من المخزن (لا نجاح للكلّ)');
  eq(o.verification.storage.method.state.kind, 'dontneed_sequential', '[أ][13ch] التخزين: رجوع معلن إلى DONTNEED');
  ok(o.verification.storage.method.state.detail.includes('o_direct_open_failed'), '[أ][13ch] وسبب الرجوع رفض O_DIRECT بنصّه');
  eq(o.verification.storage.errors.write, 2, '[أ][13ch] أخطاء الكتابة 2 (تُشحن متى جرت الكتابة)');
  eq(o.verification.cpuKnownAnswer.mismatches, 1, '[أ][13ch] فحص غربال واحد غير مطابق');
  eq(o.verification.cpuKnownAnswer.counts.sieveMismatch, 1, '[أ][13ch] مصنَّف عدم تطابق غربال');
  const bad = o.verification.cpuKnownAnswer.runs.items.find((x) => x.sieve.status.kind === 'mismatch');
  eq(bad.sieve.primeCount, 664580, '[أ][13ch] العدد الخامّ (664580) يُسلَّم كما هو ليحكم من يحكم');
  eq(o.verification.cpuKnownAnswer.runs.items.filter((x) => x.sieve.status.kind === 'match').every((x) => x.sieve.primeCount === 664579), true,
      '[أ][13ch] وما تطابق عدده 664579');
  eq(o.preScanWarnings.status, 'PRESENT', '[أ][13ch] مفتاح حالة تحذيرات ما قبل الفحص حاضر');
}

// 16 عموداً: أطول تخطيط، قوائم فشل مبتورة، فحص مُوقَف
{
  const o = OUT['16ch-four-policies-truncated-failures'];
  eq(o.layout.columnCount, 16, '[أ][16ch] ستة عشر عموداً');
  eq(o.layout.policyChannels.map((p) => p.policy), [0, 2, 4, 6], '[أ][16ch] أربع سياسات');
  eq(o.channelReadFailures.channels.cpu_freq_policy2_khz.tracking, 'TRUNCATED', '[أ][16ch] قائمة فشل السياسة 2 مبتورة (230 > 200)');
  eq([o.channelReadFailures.channels.cpu_freq_policy2_khz.listedCount, o.channelReadFailures.channels.cpu_freq_policy2_khz.count], [200, 230], '[أ][16ch] سُمّي 200 من 230');
  eq(o.channelReadFailures.channels.cpu_freq_policy6_khz.tracking, 'COMPLETE', '[أ][16ch] وقائمة السياسة 6 كاملة');
  eq(o.batteryPairs.pairs.items.length, 200, '[أ][16ch] أزواج البطارية بلغت السقف 200');
  eq([o.batteryPairs.state.broadcastCount, o.batteryPairs.state.droppedByCap], [354, 154], '[أ][16ch] 354 بثّاً أُسقط منها 154 بالسقف (200+154=354)');
  eq(o.thermal.status.state.state.kind, 'listener_registration_failed', '[أ][16ch] فشل تسجيل مستمع الحالة الحرارية: حالة مسمّاة');
  eq(o.thermal.status.state.state.detail, 'no thermal listener for this uid', '[أ][16ch] بنصّ سببها');
  eq(o.thermal.headroom.readings.byKind, {ok: 31, exception: 4}, '[أ][16ch] قراءات headroom: 31 ok و4 استثناءات');
  eq(o.cpuTemp.state, 'SAMPLER_MAX_CPU', '[أ][16ch] حرارة المعالج: أقصى المجمِّع');
  eq(o.preScanWarnings.state.kind, 'read_failed', '[أ][16ch] preScanWarningsState=read_failed');
  eq(o.verification.memory.state.state.kind, 'not_run', '[أ][16ch] الذاكرة لم تجرِ');
  eq(o.verification.memory.state.state.detail, 'insufficient_free_memory', '[أ][16ch] لأن الحرّة غير كافية');
  eq(o.verification.memory.errors, {march: null, walkingOnes: null, randomVerify: null}, '[أ][16ch] وعدّاداتها غائبة لا 0');
  eq(o.verification.memory.bytes.freeBytes, 461373440, '[أ][16ch] الحرّة الخام تُشحن وإن لم يجرِ الاختبار (memoryVerifyFreeBytes)');
  eq(o.verification.storage.state.state.kind, 'partial', '[أ][16ch] التخزين جزئي');
  eq([o.verification.storage.bytes.compared, o.verification.storage.bytes.planned], [104857600, 268435456], '[أ][16ch] قورن 100 من 256 MiB');
  eq(o.verification.gpuGemm.state.state.kind, 'not_run', '[أ][16ch] gemm لم يجرِ');
  eq([o.verification.gpuGemm.correct, o.verification.gpuGemm.correctStatus], [null, 'ABSENT_DECLARED'], '[أ][16ch] gpuComputeGemmCorrect غائب بحالة معلنة لا true');
  eq([o.verification.criticalDefect.value, o.verification.criticalDefect.valueStatus], [null, 'ABSENT_DECLARED'], '[أ][16ch] criticalDefectDetected غائب لا false');
  eq(o.verification.criticalDefect.inputsNotRun, ['gpuComputeGemm'], '[أ][16ch] وما لم يجرِ مسمّى');
  eq(o.verification.workersPin.state.state.kind, 'attempted', '[أ][16ch] جرت محاولة تثبيت');
  eq(o.verification.workersPin.pinned.workersPinnedMid, 3, '[أ][16ch] وعدّاداتها حاضرة');
  eq(o.verification.aiDelegate.delegate, 'STUB', '[أ][16ch] مندوب الذكاء STUB');
  ok(o.verification.aiDelegate.initErrorText.includes('UnsatisfiedLinkError'), '[أ][16ch] وخطأ تهيئته حاضر بنصّه');
  eq(o.verification.aiDelegate.noInitErrorDeclared, false, '[أ][16ch] فلا «لا خطأ» معلن');
  const notReached = o.verification.cpuKnownAnswer.runs.items.find((x) => x.sieve.status.kind === 'not_reached');
  eq([notReached.t, notReached.tEnd, notReached.sieve.primeCount], [null, null, null], '[أ][16ch] تشغيل not_reached بلا t ولا tEnd ولا عدد: غياب لا صفر (عقد :1252)');
  const nativeFail = o.verification.cpuKnownAnswer.runs.items.find((x) => x.sieve.status.kind === 'native_call_failed');
  eq(nativeFail.sieve.status.detail, 'sieve kernel aborted: out of memory', '[أ][16ch] فشل النداء الأصلي بنصّه');
  eq([o.verification.cpuKnownAnswer.counts.sieveError, o.verification.cpuKnownAnswer.counts.sieveNotReached], [1, 1], '[أ][16ch] خطأ نداء وتشغيل لم يُبلَغ: لا يُحسبان عدم تطابق');
  eq(o.verification.cpuKnownAnswer.mismatches, 0, '[أ][16ch] فلا عدم تطابق');
}

// ═══════════════════════════════════════════════════════════════════
// أ-٢) عيّنة fv67 (حمولة 1.0.10 المشتقّة من 34dff2b8)
// ═══════════════════════════════════════════════════════════════════
{
  const o = OUT67;
  eq([o.fieldsVersion, o.appVersion, o.applicable], [67, '1.0.8-v6beta', false], '[أ-٢] الختم 67 وappVersion من ترويسة الملفّ');
  eq(o.anomalies, [], '[أ-٢] لا شذوذ');
  eq(o.absences.ABSENT.sort(), [
    'verification.legacy.cpuFmaErrors.status', 'verification.legacy.cpuPrimeSieveCorrect.status',
    'verification.legacy.memoryMarchPassed.status', 'verification.legacy.memoryWalkingOnesPassed.status',
  ], '[أ-٢] الغياب الصريح في fv67 = الأربعة التي كانت تُقرأ نجاحاً (A76) وhي تُعلَن الآن غائبة');
  ok(o.absences.notInFieldsVersionCount > 30, '[أ-٢] ومفاتيح fv68 الجديدة: «ليست في هذا الإصدار» (لا ABSENT)');
  eq(o.layout.columnCount, 11, '[أ-٢] أحد عشر عموداً');
  eq(o.cpuTemp.legacyMaxCpuTemp.status, 'PRESENT', '[أ-٢] maxCpuTemp حاضر في 67');
  eq(o.cpuTemp.legacyMaxCpuTemp.value, -1, '[أ-٢] وقيمته -1 كما أرسلها (تُقرأ بحالتها لا بتأويل)');
  eq(o.cpuTemp.state, 'ABSENT', '[أ-٢] cpuTempFinalSource غائب في 67');
  eq(o.verification.storageSlcCacheSizeMbStatus, 'PRESENT', '[أ-٢] storageSlcCacheSizeMb حاضر في 67');
  eq(o.throughputUnit.basis, N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_APP_VERSION_V6BETA, '[أ-٢] وحدة الإنتاجية: «غير محدَّدة» لـ1.0.8-v6beta');
  eq(o.throughputUnit.unit, null, '[أ-٢] لا وحدة (لا ÷10⁶ ولا ÷2²⁰)');
  eq(o.verification.memory.state.status, 'NOT_IN_FIELDS_VERSION', '[أ-٢] memoryVerifyState: لم يوجد بعد في هذا الإصدار');
  eq(o.verification.memory.derived, {marchPassed: null, walkingOnesPassed: null}, '[أ-٢] …Passed غير مشتقّة (null)');
  eq(o.verification.cpuKnownAnswer.mismatches, null, '[أ-٢] لا فحص معروف مسبقاً: null لا 0');
  eq(o.verification.storage.errors, {write: 0, read: 0}, '[أ-٢] storage*VerifyErrors = 0 كما أرسلها 1.0.10 (صفر ثابت لا قياس — قيد معروف يُعلَن في التقرير)');
}

// ═══════════════════════════════════════════════════════════════════
// ب) حارس التغطية: حذف كل مفتاح جديد يُغيّر المخرَج
// ═══════════════════════════════════════════════════════════════════
const linesOf = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
const unionKeys = new Set(STEMS.flatMap((s) => linesOf(fileOf(s, 'keys.txt'))));
const keys67 = new Set(linesOf(`${FV67_FILE}.keys.txt`).map((l) => l.replace(/^fingerprint\./, '')));
const newPaths = [...unionKeys].filter((p) => !keys67.has(p)).sort();
eq(newPaths.length, 138, '[ب] 138 مساراً جديداً في fv69 مقارنةً بحمولة 1.0.10 (عدّ من .keys.txt؛ 127 + 11 من الدفعة ١٠: manualResultsHeader·hiddenByModel، timeToFirstTouchMs، وسبعة مسارات لخامّ SN-04)');

function deletePath(root, dotted) {
  const segs = dotted.split('.');
  const walk = (node, i) => {
    if (node === null || typeof node !== 'object') return false;
    let seg = segs[i];
    const isArr = seg.endsWith('[]');
    if (isArr) seg = seg.slice(0, -2);
    if (i === segs.length - 1) {
      if (!(seg in node)) return false;
      delete node[seg];
      return true;
    }
    const child = node[seg];
    if (child === undefined || child === null) return false;
    if (isArr) {
      let any = false;
      for (const el of child) any = walk(el, i + 1) || any;
      return any;
    }
    return walk(child, i + 1);
  };
  return walk(root, 0);
}

// مفاتيح موجودة في العيّنات الثلاث ولا يقرؤها القارئ، وسبب كلٍّ منها. ليست من عقد fv68: حقول قديمة (fv ≤ 67) ظهرت في العيّنات المشتقّة
// لأن سيناريوهاتها (توقيف مبكّر، تخفيف حراري) غير موجودة في تسجيل 1.0.10 الأصلي. تُفحَص بالحذف كذلك: إن صار القارئ يقرؤها يُخفق هذا الاختبار حتى يُزال الإعفاء.
const NOT_READ_BY_DESIGN = {
  'timeSeries.footer.stressEffectiveness.phase3CpuUsageAvgBig': 'حقل قديم من stressEffectiveness (fv ≤ 67)؛ لا يقرؤه إلا findings.js عبر peakBigFreqKhzAnywhere وحدها',
  'timeSeries.footer.stressEffectiveness.phase3CpuUsageAvgLittle': 'كالسابق',
  'timeSeries.footer.stressEffectiveness.phase3CpuUsageAvgMid': 'كالسابق',
  'timeSeries.footer.stressEffectiveness.satCaveat': 'كالسابق',
  'timeSeries.footer.stressEffectiveness.saturationFailureReason': 'كالسابق (يقرؤه التوقيع من التذييل مباشرة)',
  'timeSeries.footer.earlyStopReason': 'حقل قديم: سبب التوقّف المبكّر (null = لم يتوقّف)؛ ليس من عقد fv68',
  'timeSeries.footer.throttlingEvents[].applied': 'عناصر throttlingEvents قديمة (fv ≤ 67): قائمة فارغة في عيّنة 1.0.10، وعناصرها هنا من سيناريو الاختبار',
  'timeSeries.footer.throttlingEvents[].newIntensity': 'كالسابق',
  'timeSeries.footer.throttlingEvents[].phase': 'كالسابق',
  'timeSeries.footer.throttlingEvents[].reason': 'كالسابق',
  'timeSeries.footer.throttlingEvents[].skinTemp': 'كالسابق',
  'timeSeries.footer.throttlingEvents[].sourceIsSysfs': 'كالسابق',
  'timeSeries.footer.throttlingEvents[].timestamp': 'كالسابق',
  // fv69 (الدفعة ١٠) — بقرار المستخدم 2026-10-10 (بنصّه): «لا قرّاء للحقول الجديدة قبل المحطّة ١، فهي تُحفظ في reportRaw كاملة، وقرّاؤها مع دفعات التقرير.»
  // فهذه الستّة غير مقروءة بالتصميم؛ وأنها تُحفظ كاملة في reportRaw يُثبته analyzeDeviceFv68.e2e.test.js على المحاكي.
  'manualResultsHeader': 'fv69: رأس النتائج اليدوية (hiddenByModel) — لا قارئ قبل المحطّة ١ (قرار المستخدم 2026-10-10)؛ يُحفظ في reportRaw',
  'manualResultsHeader.hiddenByModel': 'كالسابق',
  'functionalResults[].measurements.readingsBeforeCover[].t': 'fv69: عنصر قراءة SN-04 — القارئ يسرد مفاتيح measurements العليا وحدها (قرار المستخدم 2026-10-10: لا قارئ جديد لخامّ SN-04 قبل المحطّة ١)',
  'functionalResults[].measurements.readingsBeforeCover[].values': 'كالسابق',
  'functionalResults[].measurements.readingsDuringCover[].t': 'كالسابق',
  'functionalResults[].measurements.readingsDuringCover[].values': 'كالسابق',
};
const stable = (o) => JSON.stringify(o);
const uncovered = [];
const wronglyExempt = [];
for (const p of newPaths) {
  let tried = false;
  for (const s of STEMS) {
    const m = clone(P[s]);
    if (!deletePath(m, p)) continue;
    tried = true;
    const changed = stable(R.readFv68(m)) !== stable(OUT[s]);
    if (p in NOT_READ_BY_DESIGN) {
      if (changed) wronglyExempt.push(p);
    } else if (!changed) {
      uncovered.push(`${p} (${s})`);
    }
    break;
  }
  if (!tried) uncovered.push(`${p} (لم يُعثر على المسار في أيّ عيّنة لحذفه)`);
}
eq(uncovered, [], '[ب] كل مفتاح جديد في fv68 يقرؤه القارئ: حذفه يُغيّر المخرَج (وإلا فمفتاح بلا قارئ — القاعدة 25)');
eq(wronglyExempt, [], '[ب] وما أُعفي منها لا يغيّر حذفُه المخرَج فعلاً (الإعفاء غير ميّت)');
eq(newPaths.filter((p) => !(p in NOT_READ_BY_DESIGN)).length, 138 - Object.keys(NOT_READ_BY_DESIGN).length,
    `[ب] المغطّى = 138 − ${Object.keys(NOT_READ_BY_DESIGN).length} إعفاءً مُعدَّداً بأسمائها`);
ok(Object.keys(NOT_READ_BY_DESIGN).every((p) => newPaths.includes(p)), '[ب] كل إعفاء مسار جديد فعلاً (لا إعفاء لمسار غير موجود)');

// ═══════════════════════════════════════════════════════════════════
// جـ) الغياب بحالاته
// ═══════════════════════════════════════════════════════════════════
const sec = (m, ...ks) => ks.reduce((a, k) => a[k], m);
{
  // ABSENT: مفتاح غاب في ختم 68 بلا سبب ولا fieldsNotInFile
  const m = clone(P['13ch-selinux-blocked-policy']);
  delete m.timeSeries.footer.thermalHeadroomReadings;
  delete m.timeSeries.footer.verificationResults.memoryVerifyState;
  const o = R.readFv68(m);
  eq(o.thermal.headroom.readings.status, 'ABSENT', '[جـ] قائمة headroom المحذوفة: ABSENT');
  eq(o.thermal.headroom.readings.items, [], '[جـ] وبلا عناصر مختلَقة');
  eq(o.verification.memory.state.status, 'ABSENT', '[جـ] memoryVerifyState المحذوف: ABSENT');
  eq(o.verification.memory.state.state, null, '[جـ] وبلا حالة مختلَقة');
  ok(o.absences.ABSENT.includes('thermal.headroom.readings.status'), '[جـ] والغياب في ملخّص الغياب الأعلى');
  ok(o.absences.ABSENT.includes('verification.memory.state.status'), '[جـ] كذلك الثاني');
}
{
  // NOT_IN_FILE: ملفّ قديم أعاد تحليله 1.0.11 — fieldsNotInFile يسمّي المفاتيح
  const m = clone(P['13ch-selinux-blocked-policy']);
  m.timeSeries.footer.fieldsVersion = 67;
  m.timeSeries.footer.fieldsNotInFile = ['thermalHeadroomReadings', 'verificationResults.memoryVerifyState'];
  delete m.timeSeries.footer.thermalHeadroomReadings;
  delete m.timeSeries.footer.verificationResults.memoryVerifyState;
  const o = R.readFv68(m);
  eq(o.applicable, false, '[جـ] ختم 67 ← غير مطبَّق');
  eq(o.thermal.headroom.readings.status, 'NOT_IN_FILE', '[جـ] المفتاح الذي سمّاه fieldsNotInFile: NOT_IN_FILE لا ABSENT');
  eq(o.verification.memory.state.status, 'NOT_IN_FILE', '[جـ] والمنقوط (verificationResults.memoryVerifyState) كذلك');
  eq(o.absences.NOT_IN_FILE.length, 2, '[جـ] اثنان في ملخّص الغياب');
  eq(o.anomalies.filter((a) => a.code === 'NAMED_KEY_IS_PRESENT'), [], '[جـ] ولا تناقض: ما سُمّي غائب فعلاً');
  m.timeSeries.footer.thermalHeadroomReadings = [];
  eq(R.readFv68(m).anomalies.filter((a) => a.code === 'NAMED_KEY_IS_PRESENT').map((a) => a.detail), [{name: 'thermalHeadroomReadings'}],
      '[جـ] مفتاح سمّاه fieldsNotInFile وهو حاضر: تناقض يُعلَن');
}
{
  // WRONG_TYPE
  const m = clone(P['11ch-nothing-admitted']);
  m.timeSeries.footer.cpuPolicies = 'oops';
  m.timeSeries.footer.verificationResults.memoryMarchErrors = '3';
  m.timeSeries.footer.batteryPairsState = [];
  const o = R.readFv68(m);
  eq(o.cpuPolicies.status, 'WRONG_TYPE', '[جـ] cpuPolicies نصّ: WRONG_TYPE');
  eq(o.verification.memory.errors.march, null, '[جـ] memoryMarchErrors نصّي: لا يُقرأ رقماً');
  eq(o.batteryPairs.state.status, 'WRONG_TYPE', '[جـ] batteryPairsState مصفوفة: WRONG_TYPE');
  ok(o.anomalies.filter((a) => a.code === 'WRONG_TYPE').length >= 3, '[جـ] وكل نوع خاطئ شذوذ معلن');
}
{
  // null على السلك يُقرأ غياباً، لا قيمة
  const m = clone(P['13ch-selinux-blocked-policy']);
  m.timeSeries.footer.cpuTempFinalC = null;
  const o = R.readFv68(m);
  eq(o.cpuTemp.valueStatus, 'ABSENT', '[جـ] null على السلك = غياب (مع مصدر قراءة حيّة بلا قيمة)');
  ok(o.anomalies.some((a) => a.code === 'SOURCE_WITHOUT_VALUE'), '[جـ] والمصدر بلا قيمة شذوذ معلن');
}
{
  // اتّساق الحالة والقيمة
  const m = clone(P['13ch-selinux-blocked-policy']);
  m.timeSeries.footer.batteryHealth.cycleCountState = 'not_read:sysfs_not_readable_or_absent_and_extra_absent_from_broadcast';
  const o = R.readFv68(m);
  ok(o.anomalies.some((a) => a.code === 'VALUE_WITH_NOT_READ_STATE'), '[جـ] قيمة الدورات مع حالة not_read: تناقض معلن');
  const m2 = clone(P['13ch-selinux-blocked-policy']);
  m2.timeSeries.footer.cpuTempFinalSource = 'absent:synthetic';
  ok(R.readFv68(m2).anomalies.some((a) => a.code === 'VALUE_WITH_ABSENT_SOURCE'), '[جـ] cpuTempFinalC مع مصدر absent: تناقض معلن');
  const m3 = clone(P['11ch-nothing-admitted']);
  m3.timeSeries.footer.maxCpuTemp = -1;
  ok(R.readFv68(m3).anomalies.some((a) => a.code === 'LEGACY_KEY_PRESENT_IN_FV68'), '[جـ] maxCpuTemp في ختم 68: مفتاح محذوف حاضر — معلن');
  const m4 = clone(P['11ch-nothing-admitted']);
  m4.timeSeries.footer.verificationResults.storageSlcCacheSizeMb = 0;
  ok(R.readFv68(m4).anomalies.some((a) => a.code === 'REMOVED_KEY_PRESENT_IN_FV68'), '[جـ] storageSlcCacheSizeMb في ختم 68: معلن');
}
{
  // عدّادات بلا حالة جرى: «الصفر مقيس حقيقي فقط مع ran»
  const m = clone(P['16ch-four-policies-truncated-failures']);
  m.timeSeries.footer.verificationResults.memoryMarchErrors = 0;
  ok(R.readFv68(m).anomalies.some((a) => a.code === 'COUNTERS_WITH_NOT_RUN_STATE'), '[جـ] عدّاد ذاكرة مع not_run: مخالفة معلنة');
  const m2 = clone(P['16ch-four-policies-truncated-failures']);
  m2.timeSeries.footer.verificationResults.storageVerifyState = 'not_run:no_time_left';
  ok(R.readFv68(m2).anomalies.some((a) => a.code === 'READ_ERRORS_WITH_NON_RAN_STATE'), '[جـ] storageReadVerifyErrors مع not_run: مخالفة معلنة');
  const m3 = clone(P['11ch-nothing-admitted']);
  delete m3.timeSeries.footer.verificationResults.storageReadVerifyErrors;
  ok(R.readFv68(m3).anomalies.some((a) => a.code === 'RAN_WITHOUT_ERROR_COUNTERS'), '[جـ] ran بلا عدّاد القراءة: مخالفة معلنة');
  const m4 = clone(P['16ch-four-policies-truncated-failures']);
  m4.timeSeries.footer.verificationResults.gpuComputeGemmCorrect = true;
  ok(R.readFv68(m4).anomalies.some((a) => a.code === 'STATE_DISAGREES_WITH_VALUE'), '[جـ] gpuComputeGemmCorrect مع not_run: تناقض معلن');
  const m5 = clone(P['16ch-four-policies-truncated-failures']);
  m5.timeSeries.footer.scanStillness.stillnessState = 'insufficient_accel_samples';
  const o5 = R.readFv68(m5);
  eq([o5.stillness.isStill, o5.stillness.accelStdDev], [null, null], '[جـ] insufficient_accel_samples: isStill وaccelStdDev غائبتان لا «ثابت» (عقد ت-18 صفّ 6)');
  ok(o5.anomalies.some((a) => a.code === 'VALUES_WITH_INSUFFICIENT_SAMPLES'), '[جـ] وحضورهما معها تناقض معلن');
}

// ═══════════════════════════════════════════════════════════════════
// د) حالات خارج المفردة: تُعلَن ولا تُقرأ نجاحاً
// ═══════════════════════════════════════════════════════════════════
{
  const m = clone(P['11ch-nothing-admitted']);
  m.timeSeries.footer.verificationResults.memoryVerifyState = 'ran_ok';
  m.timeSeries.footer.verificationResults.gpuComputeGemmState = 'success';
  m.timeSeries.footer.verificationResults.cpuKnownAnswerRuns[0].sieveStatus = 'verified';
  m.timeSeries.footer.cpuTempFinalSource = 'estimated';
  m.timeSeries.footer.thermalHeadroomReadings[0].state = 'maybe';
  m.timeSeries.footer.footerDiagnostics.thermalLists = 'broken';
  m.timeSeries.timeSeriesState = 'cloud';
  const o = R.readFv68(m);
  eq(o.verification.memory.state.state.kind, 'UNRECOGNIZED', '[د] memoryVerifyState غير معروفة: UNRECOGNIZED');
  eq(o.verification.memory.derived, {marchPassed: null, walkingOnesPassed: null}, '[د] وحالة غير معروفة لا تُشتقّ منها نجاحات (null لا true)');
  eq(o.verification.gpuGemm.state.state.kind, 'UNRECOGNIZED', '[د] gpuComputeGemmState غير معروفة');
  eq(o.verification.cpuKnownAnswer.counts.unrecognized, 1, '[د] حالة غربال غير معروفة تُعدّ unrecognized لا match');
  eq(o.cpuTemp.state, 'UNRECOGNIZED', '[د] cpuTempFinalSource غير معروف');
  eq(o.thermal.headroom.readings.items[0].kind, 'UNRECOGNIZED', '[د] حالة قراءة headroom غير معروفة');
  eq(o.footerDiagnostics.entries.thermalLists.kind, 'UNRECOGNIZED', '[د] وتشخيص تذييل غير معروف');
  eq(o.timeSeriesState.state.kind, 'UNRECOGNIZED', '[د] وtimeSeriesState');
  const codes = o.anomalies.filter((a) => a.code === 'UNRECOGNIZED_STATE').length;
  ok(codes >= 7, `[د] كل واحدة شذوذ معلن (${codes} ≥ 7)`);
  // parseState
  eq(R.parseState('not_run:x:y', N.VOCAB.MEMORY_VERIFY_STATE), {raw: 'not_run:x:y', kind: 'not_run', detail: 'x:y', recognized: true}, '[د] parseState: التفصيل بعد أوّل «:» كلّه');
  eq(R.parseState('ran:extra', N.VOCAB.MEMORY_VERIFY_STATE).recognized, false, '[د] «ran:extra» ليست «ran»: غير معروفة');
  eq(R.parseState(5, N.VOCAB.MEMORY_VERIFY_STATE), null, '[د] غير النصّ: null');
  eq(R.parseState('ok:size=1606', N.VOCAB.FOOTER_DIAGNOSTIC).kind, 'ok', '[د] «ok:size=1606» تشخيص سليم بتفصيل');
  // تشخيص fail يُعلَن شذوذاً
  const m2 = clone(P['11ch-nothing-admitted']);
  m2.timeSeries.footer.footerDiagnostics.batteryPairs = 'fail:IllegalStateException';
  const o2 = R.readFv68(m2);
  eq(o2.anomalies.filter((a) => a.code === 'FOOTER_SECTION_FAILED').map((a) => a.detail), [{section: 'batteryPairs', detail: 'IllegalStateException'}],
      '[د] fail:<صنف> في footerDiagnostics: قسم لم يُبنَ في التطبيق — شذوذ معلن بقسمه');
}

// ═══════════════════════════════════════════════════════════════════
// ه) لا يرمي أبداً
// ═══════════════════════════════════════════════════════════════════
for (const [label, bad] of [['null', null], ['undefined', undefined], ['مصفوفة', []], ['نصّ', 'x'], ['رقم', 5],
  ['timeSeries=null', {timeSeries: null}], ['footer=[]', {timeSeries: {footer: []}}], ['footer=نصّ', {timeSeries: {footer: 'x'}}],
  ['variables=كائن', {timeSeries: {variables: {}}}], ['samples=نصّ', {timeSeries: {samples: 'x'}}],
  ['عيّنات بلا v', {timeSeries: {samples: [{phase: 1}, null, 5]}}]]) {
  const o = R.readFv68(bad);
  eq(o.readerError, undefined, `[ه] مُدخل «${label}»: لا readerError`);
  eq(o.applicable, false, `[ه] مُدخل «${label}»: غير مطبَّق (لا ختم)`);
}
{
  // تشويه كل ورقة في التذييل بخمسة أنواع — لا رمي، والمخرَج JSON قابل للتسلسل
  const base = P['16ch-four-policies-truncated-failures'];
  const leaves = [];
  const walk = (node, p) => {
    if (node === null || typeof node !== 'object') { leaves.push(p); return; }
    for (const k of Object.keys(node)) walk(node[k], p.concat([k]));
  };
  walk(base.timeSeries.footer, []);
  walk(base.functionalResults, ['__fr']);
  const weirds = [null, 'zz', -7, [1, 'a', null], {a: {b: 1}}];
  let calls = 0;
  for (const leaf of leaves) {
    for (const w of weirds) {
      const m = clone(base);
      let cur = leaf[0] === '__fr' ? m.functionalResults : m.timeSeries.footer;
      const rest = leaf[0] === '__fr' ? leaf.slice(1) : leaf;
      for (let i = 0; i < rest.length - 1; i++) cur = cur[rest[i]];
      cur[rest[rest.length - 1]] = clone(w);
      const o = R.readFv68(m);
      if (o.readerError !== undefined) assert.fail(`readerError بتشويه ${leaf.join('.')} = ${JSON.stringify(w)}: ${o.readerError}`);
      JSON.stringify(o);
      calls++;
    }
  }
  ok(calls > 1000, `[ه] ${calls} تشويهاً (أوراق التذييل × 5 أنواع): لا استثناء، والمخرَج قابل للتسلسل`);
}

// ═══════════════════════════════════════════════════════════════════
// و) وحدة v[8]/v[9] — س-19 المصحَّح
// ═══════════════════════════════════════════════════════════════════
{
  const f67 = fv67();
  const withApp = (v) => { const m = clone(f67); m.timeSeries.header.appVersion = v; return R.readFv68(m).throughputUnit; };
  eq([withApp('1.0.9').unit, withApp('1.0.9').basis], ['MiB/s', N.THROUGHPUT_UNIT_BASIS.APP_VERSION_RULE], '[و] 1.0.9 ← MiB/s بقاعدة الإصدار');
  eq([withApp('1.0.10').unit, withApp('1.0.10').basis], ['MiB/s', N.THROUGHPUT_UNIT_BASIS.APP_VERSION_RULE], '[و] 1.0.10 ← MiB/s');
  eq([withApp('1.0.8-v6beta').unit, withApp('1.0.8-v6beta').basis], [null, N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_APP_VERSION_V6BETA], '[و] 1.0.8-v6beta ← «غير محدَّدة»');
  eq([withApp('1.0.7').unit, withApp('1.0.7').basis], [null, N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_APP_VERSION_NOT_IN_RULE], '[و] إصدار خارج القاعدة ← «غير محدَّدة» لا تخمين');
  eq([withApp(' 1.0.10 ').unit], ['MiB/s'], '[و] الفراغ المحيط يُقصّ');
  eq(withApp('').basis, N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_NO_APP_VERSION, '[و] إصدار فارغ ← غير محدَّدة (لا إصدار)');
  const m = clone(f67); delete m.timeSeries.header.appVersion;
  eq(R.readFv68(m).throughputUnit.basis, N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_NO_APP_VERSION, '[و] بلا appVersion ← غير محدَّدة');
  eq(R.readFv68(m).throughputUnit.declared.storage_throughput_mbps, 'MB/s', '[و] وما أعلنه fv67 («MB/s») يُسجَّل ولا يُعتمد (القيمة ثنائية منذ A70)');
  // من fv68 بالمعلَن
  const m68 = clone(P['11ch-nothing-admitted']);
  m68.timeSeries.variables[8].unit = 'MB/s';
  eq(R.readFv68(m68).throughputUnit.basis, N.THROUGHPUT_UNIT_BASIS.DECLARED_UNITS_DISAGREE, '[و] fv68 بوحدات معلنة متناقضة: يُعلَن (لا اختيار)');
  const m68b = clone(P['11ch-nothing-admitted']);
  for (const v of m68b.timeSeries.variables) if (v.unit === 'MiB/s') delete v.unit;
  delete m68b.timeSeries.footer.verificationResults.storageThroughputSegmentsUnit;
  eq(R.readFv68(m68b).throughputUnit, {appVersion: '1.0.11', fieldsVersion: 69, declared: {storage_throughput_mbps: null, memory_bandwidth_mbps: null, segments: null}, unit: null, basis: N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_NO_DECLARED_UNIT},
      '[و] fv69 (مُنطبِق بعتبة ≥ 68) بلا وحدة معلنة: «غير محدَّدة» — لا يعود إلى قاعدة الإصدار (القاعدة تخصّ ما قبل 68)');
  const m68c = clone(P['11ch-nothing-admitted']); m68c.timeSeries.header.appVersion = '1.0.10';
  eq(R.readFv68(m68c).throughputUnit.basis, N.THROUGHPUT_UNIT_BASIS.DECLARED_IN_PAYLOAD, '[و] fv68 يُقرأ بالمعلَن ولو حمل appVersion من قاعدة 1.0.10');
}

// ═══════════════════════════════════════════════════════════════════
// ز) العيّنات الفاشلة لكل قناة (س-27)
// ═══════════════════════════════════════════════════════════════════
{
  const mk = (map, counts, extra) => {
    const m = clone(P['13ch-selinux-blocked-policy']);
    m.timeSeries.footer.channelReadFailures = map;
    m.timeSeries.footer.channelReadFailureCounts = counts;
    return Object.assign(m, extra || {});
  };
  const chOf = (m, name) => R.readFv68(m).channelReadFailures.channels[name];
  eq(chOf(mk({charge_counter_raw: [], cpu_freq_policy0_khz: []}, {charge_counter_raw: 0, cpu_freq_policy0_khz: 0}), 'charge_counter_raw').tracking, 'COMPLETE', '[ز] قائمة فارغة + count=0: COMPLETE (لا فشل)');
  eq(chOf(mk({charge_counter_raw: [3, 4]}, {charge_counter_raw: 9}), 'charge_counter_raw').tracking, 'TRUNCATED', '[ز] count=9 > 2 مسمّاة: TRUNCATED');
  eq(chOf(mk({charge_counter_raw: [3, 4]}, {}), 'charge_counter_raw').tracking, 'COUNT_ABSENT', '[ز] قائمة بلا count: COUNT_ABSENT (لا برهان على الاكتمال)');
  eq(chOf(mk({}, {}), 'charge_counter_raw').tracking, 'UNTRACKED', '[ز] مفتاح القناة غائب من الخريطة: UNTRACKED (≠ «لا فشل»)');
  eq(chOf(mk({}, {}), 'cpu_freq_policy0_khz').tracking, 'UNTRACKED', '[ز] كذلك لقناة السياسة');
  {
    const m = clone(P['13ch-selinux-blocked-policy']);
    delete m.timeSeries.footer.channelReadFailures;
    delete m.timeSeries.footer.channelReadFailureCounts;
    const o = R.readFv68(m);
    eq(o.channelReadFailures.map.status, 'ABSENT', '[ز] الخريطة كلّها غائبة في ختم 68: ABSENT');
    eq(Object.values(o.channelReadFailures.channels).filter((c) => c.tracking === 'UNTRACKED').length, 2, '[ز] والقناتان المُدرجتان UNTRACKED');
    eq(chOf(m, 'battery_temp_c').tracking, 'NOT_TRACKED_BY_DESIGN', '[ز] وأعمدة v[0..10] NOT_TRACKED_BY_DESIGN (قيد معروف بنصّ الحسم)');
  }
  const mixed = chOf(mk({charge_counter_raw: [5, 5, 'x', -1, 10, 99999, 7.5, null, 6]}, {charge_counter_raw: 9}), 'charge_counter_raw');
  eq(mixed.failedIndices, [5, 6, 10], '[ز] الفهارس الصالحة مرتّبة بلا تكرار (5,6,10)');
  eq([mixed.duplicateIndexCount, mixed.invalidIndexCount, mixed.outOfRangeCount], [1, 4, 1], '[ز] مكرّر 1 وغير صالح 4 (نصّ، سالب، كسر، null) وخارج المدى 1 (99999 ≥ عدد العيّنات)');
  eq(mixed.tracking, 'COMPLETE', '[ز] count=9 = طول القائمة المسرودة (9): COMPLETE');
  const longer = R.readFv68(mk({charge_counter_raw: [1, 2, 3]}, {charge_counter_raw: 2}));
  ok(longer.anomalies.some((a) => a.code === 'LIST_LONGER_THAN_COUNT'), '[ز] قائمة أطول من count: شذوذ معلن');
  const over = R.readFv68(mk({charge_counter_raw: Array.from({length: 201}, (_, i) => i)}, {charge_counter_raw: 201}));
  ok(over.anomalies.some((a) => a.code === 'LIST_OVER_CAP'), '[ز] قائمة فوق سقف 200: شذوذ معلن');
  const unknown = R.readFv68(mk({charge_counter_raw: [], zz_unknown: [1]}, {charge_counter_raw: 0}));
  eq(unknown.channelReadFailures.unknownChannels, ['zz_unknown'], '[ز] قناة في الخريطة بلا عمود في variables[]: تُسمّى');
  ok(unknown.anomalies.some((a) => a.code === 'CHANNEL_WITHOUT_COLUMN'), '[ز] وشذوذ معلن');
  // failedReads
  const fr = R.failedReads(OUT['16ch-four-policies-truncated-failures'].channelReadFailures, 'cpu_freq_policy6_khz');
  eq([[...fr.indices], fr.exclusion, fr.count], [[fr.indices.values().next().value, [...fr.indices][1]], 'COMPLETE', 2], '[ز] failedReads تُعيد مجموعة الفهارس واكتمالها وcount');
  eq(R.failedReads(OUT['16ch-four-policies-truncated-failures'].channelReadFailures, 'no_such').exclusion, 'UNTRACKED', '[ز] قناة لا وجود لها: UNTRACKED لا «لا فشل»');
}

// ═══════════════════════════════════════════════════════════════════
// ح) تخطيط الأعمدة
// ═══════════════════════════════════════════════════════════════════
{
  const vars = P['13ch-selinux-blocked-policy'].timeSeries.variables;
  const samples = [{phase: 0, v: new Array(13).fill(0)}];
  const a = R.resolveLayout(vars, samples);
  eq(a.byName.charge_counter_raw, 11, '[ح] الفهرس = الموضع حين لا index');
  const withIndex = vars.map((v, i) => ({index: i, ...v}));
  const b = R.resolveLayout(withIndex, samples);
  eq([b.indexFrom, b.byName.charge_counter_raw], ['declared', 11], '[ح] index معلن لكل عنصر ← هو المرجع');
  // index معلن بترتيب مخالف للموضع
  const shuffled = [...withIndex].reverse();
  const c = R.resolveLayout(shuffled, samples);
  eq([c.byName.timestamp_ms, c.byName.charge_counter_raw], [0, 11], '[ح] index المعلن يغلب الموضع (قائمة بترتيب مخالف)');
  // index ناقص في عنصر ← الموضع للكلّ
  const partial = withIndex.map((v, i) => (i === 3 ? {name: v.name, unit: v.unit} : v));
  eq(R.resolveLayout(partial, samples).indexFrom, 'position', '[ح] index ناقص في عنصر ← الموضع للجميع (لا خلط)');
  eq(R.columnIndex(a, 'no_such'), null, '[ح] اسم غير موجود ← null لا 0');
  eq(R.columnIndex(a, 'timestamp_ms'), 0, '[ح] الزمن 0');
  // تخطيط V1 (datacollect): الأسماء الأساسية غير في مواضعها
  const v1 = ['timestamp_ms', 'battery_temp_c', 'battery_voltage_mv', 'battery_current_ua', 'battery_level_pct', 'cpu_temp_c', 'cpu_freq_little_khz'].map((name) => ({name}));
  const l1 = R.resolveLayout(v1, [{v: new Array(7).fill(0)}]);
  eq(l1.baseLayout, 'INCOMPLETE', '[ح] تخطيط ينقصه أعمدة أساسية: INCOMPLETE');
  ok(l1.baseMissing.includes('cpu_freq_max_khz') && l1.baseMissing.includes('gpu_fps'), '[ح] والناقص مسمّى');
  const moved = [...vars];
  [moved[5], moved[6]] = [moved[6], moved[5]];
  const l2 = R.resolveLayout(moved, samples);
  eq(l2.baseLayout, 'MISMATCH', '[ح] عمود أساسي في غير موضعه: MISMATCH');
  eq(l2.baseMismatches.map((x) => x.name).sort(), ['cpu_freq_max_khz', 'cpu_usage_pct'], '[ح] والمنقول مسمّى بموضعيه');
  const dup = R.resolveLayout([...vars, {name: 'gpu_fps'}], samples);
  eq(dup.duplicateNames, ['gpu_fps'], '[ح] اسم مكرّر: يُعلَن');
  eq(R.resolveLayout(vars.slice(0, 12), [{v: new Array(13).fill(0)}]).unresolvedIndices, [12], '[ح] عمود في v[] بلا اسم في variables[]: يُسمّى فهرسه');
  eq(R.resolveLayout(vars, [{v: [1, 2]}, {v: [1, 2, 3]}]).sampleWidthConsistent, false, '[ح] طول v[] يتغيّر بين العيّنات: يُعلَن');
  eq(R.resolveLayout([], []).baseLayout, 'NO_VARIABLES', '[ح] بلا variables');
  const o = R.readFv68({timeSeries: {variables: v1, samples: [{v: new Array(7).fill(0)}], footer: {fieldsVersion: 68}}});
  ok(o.anomalies.some((x) => x.code === 'BASE_LAYOUT_INCOMPLETE'), '[ح] تخطيط ناقص: شذوذ معلن في المخرَج');
}

// ═══════════════════════════════════════════════════════════════════
// ط) اشتقاق …Passed وعدد عدم التطابق
// ═══════════════════════════════════════════════════════════════════
{
  const run = (vr) => {
    const m = clone(P['11ch-nothing-admitted']);
    Object.assign(m.timeSeries.footer.verificationResults, vr);
    return R.readFv68(m).verification;
  };
  eq(run({memoryMarchErrors: 0}).memory.derived.marchPassed, true, '[ط] ran + 0 ← true');
  eq(run({memoryMarchErrors: 3}).memory.derived.marchPassed, false, '[ط] ran + 3 ← false');
  eq(run({memoryVerifyState: 'partial:time_cap_reached', memoryMarchErrors: 0}).memory.derived.marchPassed, null, '[ط] partial + 0 ← null (لم يُغطَّ كلّه)');
  eq(run({memoryVerifyState: 'partial:time_cap_reached', memoryMarchErrors: 2}).memory.derived.marchPassed, false, '[ط] partial + 2 ← false (الخطأ المرصود حقيقي)');
  eq(run({memoryVerifyState: 'not_run:allocation_failed'}).memory.derived.marchPassed, null, '[ط] not_run ← null');
  eq(run({memoryWalkingOnesErrors: 1}).memory.derived.walkingOnesPassed, false, '[ط] walking-ones كذلك');
  const ka = (statuses, state) => run({cpuKnownAnswerState: state === undefined ? 'ran' : state,
    cpuKnownAnswerRuns: statuses.map((s, i) => ({phase: 3, plannedAtPct: 25, t: i * 10, tEnd: i * 10 + 5, sieveStatus: s[0], sha256Status: s[1], sievePrimeCount: 664579}))}).cpuKnownAnswer;
  eq(ka([['match', 'match'], ['match', 'match']]).mismatches, 0, '[ط] كلّها match ← 0');
  eq(ka([['mismatch', 'match'], ['match', 'mismatch']]).mismatches, 2, '[ط] عدم تطابقين ← 2');
  eq(ka([['native_call_failed:oom', 'self_test_failed'], ['not_reached', 'not_reached']]).mismatches, 0, '[ط] أخطاء النداءات وعدم الوصول لا تُحسب عدم تطابق');
  eq(ka([['match', 'match']], 'not_run:no_check_reached').mismatches, null, '[ط] not_run ← null لا 0');
  eq(ka([['mismatch', 'match']], 'not_run:no_check_reached').counts.sieveMismatch, 1, '[ط] ويُحصى ما وصل بالرغم من ذلك');
  ok(run({cpuKnownAnswerState: 'not_run:x', cpuKnownAnswerRuns: [{sieveStatus: 'match', sha256Status: 'match'}]}) && R.readFv68(clone(P['11ch-nothing-admitted'])).anomalies.length === 0, '[ط] (ضابط) العيّنة الأصلية لا شذوذ فيها');
}

// ═══════════════════════════════════════════════════════════════════
// ي) measurements — اصطناعي من نصّ العقد (لا عيّنة حقيقية تحمل هذه الأشكال)
// ═══════════════════════════════════════════════════════════════════
{
  const base = () => ({timeSeries: {footer: {fieldsVersion: 68}}, functionalResults: [], manualResults: []});
  const withFr = (entries) => { const m = base(); m.functionalResults = entries; return R.readFv68(m).measurements; };
  // L-02: الأرقام وحدها تُسمّي الحالة (س-34)
  const l02 = (meas) => withFr([{testId: 'L-02', categoryName: 'gps', status: 'fail', rawValue: '0 / 0', measurements: meas}]).items[0].l02;
  eq(l02({satelliteStatusCallbacks: 0, visibleSatellites: 0, usedSatellites: 0}).engineState, 'ENGINE_DID_NOT_REPORT', '[ي][اصطناعي] لا استدعاء حالة: «المحرّك لم يعمل»');
  eq(l02({satelliteStatusCallbacks: 12, visibleSatellites: 0, usedSatellites: 0}).engineState, 'ZERO_SATELLITES_MEASURED', '[ي][اصطناعي] استدعاءات وصفر أقمار: «0 أقمار مقاسة»');
  eq(l02({satelliteStatusCallbacks: 12, visibleSatellites: 9, usedSatellites: 4}).engineState, 'SATELLITES_MEASURED', '[ي][اصطناعي] أقمار مقاسة');
  eq(l02({visibleSatellites: 0}).engineState, 'UNDETERMINED_NO_CALLBACK_COUNT', '[ي][اصطناعي] بلا عدد استدعاءات: لا حكم');
  eq(l02({satelliteStatusCallbacks: 3}).engineState, 'UNDETERMINED_NO_SATELLITE_COUNT', '[ي][اصطناعي] بلا عدد أقمار: لا حكم');
  eq(l02({satelliteStatusCallbacks: 3, visibleSatellites: 2, usedSatellites: 1, timeToFirstFixMs: 8000, locationUpdateCount: 29, gpsProviderEnabled: true,
    gnssCallbackState: 'registered', locationUpdatesState: 'requested', timeToFirstFixState: 'measured'}),
  {satelliteStatusCallbacks: 3, visibleSatellites: 2, usedSatellites: 1, timeToFirstFixMs: 8000, locationUpdateCount: 29, gpsProviderEnabled: true,
    gnssCallbackState: 'registered', locationUpdatesState: 'requested', timeToFirstFixState: 'measured', engineState: 'SATELLITES_MEASURED'},
  '[ي][اصطناعي] مفاتيح L-02 الإضافية كما في العقد §٧-ب بند 7');
  // SN-08/09
  const sn = (meas, id) => withFr([{testId: id || 'SN-08', categoryName: 'sensors', status: 'warning', measurements: meas}]).items[0].stepSensor;
  eq(sn({windowMs: 3000, readings: []}).readingsState, 'EMPTY_DECLARED', '[ي][اصطناعي] SN-08: قائمة فارغة معلنة = «لا قراءات»');
  eq(sn({windowMs: 3000}).readingsState, 'ABSENT', '[ي][اصطناعي] وغياب readings = لم يُشحن');
  eq(sn({windowMs: 3000, readings: [{t: 10, values: [0.1, 0.2, 0.3]}]}, 'SN-09').readings, [{t: 10, values: [0.1, 0.2, 0.3]}], '[ي][اصطناعي] SN-09: قراءات {t, values} كما هي');
  const bad = R.readFv68({...base(), functionalResults: [{testId: 'SN-08', measurements: {readings: [{t: 1, values: ['x']}, {t: 'a'}, 5]}}]});
  ok(bad.anomalies.some((a) => a.code === 'READINGS_ELEMENT_MALFORMED'), '[ي][اصطناعي] عنصر قراءة مشوَّه: يُسقَط ويُعلَن لا يُصلَح');
  // الفشل المعلن
  const failed = withFr([{testId: 'L-02', measurements: {measurementsUnencodable: 'x', measurementsUnreadable: 'y'}}]).items[0];
  eq([failed.unencodable, failed.unreadable], ['x', 'y'], '[ي][اصطناعي] measurementsUnencodable/measurementsUnreadable تُقرآن إعلاناً صريحاً');
  // غياب measurements عن اختبار يعرف العقد شكله
  eq(withFr([{testId: 'L-02', status: 'pass'}]).expectedButAbsent, [{source: 'functionalResults', testId: 'L-02', status: 'ABSENT'}], '[ي] L-02 بلا measurements في ختم 68: غياب معلن');
  const m67 = R.readFv68({timeSeries: {footer: {fieldsVersion: 67}}, functionalResults: [{testId: 'L-02', status: 'pass'}]});
  eq(m67.measurements.expectedButAbsent, [{source: 'functionalResults', testId: 'L-02', status: 'NOT_IN_FIELDS_VERSION'}], '[ي] وفي ختم 67: «ليس في هذا الإصدار»');
  eq(withFr([{testId: 'C-05'}]).expectedButAbsent, [], '[ي] اختبار لا يعرف العقد شكل measurements له: لا إعلان');
  const wrong = R.readFv68({...base(), functionalResults: [{testId: 'L-02', measurements: 'x'}]});
  eq(wrong.measurements.items[0].status, 'WRONG_TYPE', '[ي] measurements نصّ: WRONG_TYPE');
}

// ═══════════════════════════════════════════════════════════════════
// ي-٢) M-02 شبكة اللمس — عقد §٧-ح (ب) (docs/FV68_CONTRACT.md:1458-1476، نسخة a04b4f0) — اصطناعي من نصّ العقد
// (الحالات الثلاث التي تحملها العيّنات الذهبية على fv69 تُختبر بالعيّنات نفسها في ي-٣ — القاعدة 41؛ وهنا ما لا تحمله: dismissed وقيم خارج المفردة
//  وغياب بلا سبب وفرق الإصدار)
// ═══════════════════════════════════════════════════════════════════
{
  const m02 = (fv, meas) => R.readFv68({timeSeries: {footer: fv === null ? {} : {fieldsVersion: fv}}, functionalResults: [],
    manualResults: [{testId: 'M-02', categoryName: 'display', status: 'pass', ...(meas === undefined ? {} : {measurements: meas})}]});
  const tg = (o) => o.measurements.items.find((i) => i.testId === 'M-02').touchGrid;
  // حمولة اصطناعية بلا variables/samples: تُعلن أقسام أخرى شذوذها (الوحدة…)؛ يُفحص هنا ما يخصّ manualResults وحده
  const own = (o) => o.anomalies.filter((a) => a.section.startsWith('manualResults'));
  const K = N.TOUCH_GRID_MEASUREMENT_KEYS;
  const S = N.KEY_STATUS;
  const T = N.TOUCH_GRID_TOUCH_STATE;
  const full = {gridCols: 8, gridRows: 15, totalCells: 120, touchedCells: 120, elapsedMs: 4165, timeToFirstTouchMs: 1730, endReason: 'auto_complete', maxSimultaneousPointers: 3};
  // لا قيمة null بحالة PRESENT ولا قيمة بحالة غير PRESENT: الحالة تقول الحقيقة عن القيمة (القاعدة 22)
  const statusTellsTheTruth = (g) => Object.keys(g).filter((k) => k.endsWith('Status') && k !== 'endReasonStatus').every((k) => {
    const v = g[k.slice(0, -'Status'.length)];
    return (g[k] === S.PRESENT) === (v !== null);
  });

  // ١) الحالة الكاملة (fv69): كل مفتاح PRESENT، وأساس elapsedMs «من أوّل لمسة»
  {
    const g = tg(m02(69, full));
    eq([g.gridCols, g.gridRows, g.totalCells, g.touchedCells, g.maxSimultaneousPointers], [8, 15, 120, 120, 3], '[ي-٢][اصطناعي] مفاتيح الشبكة الخمسة الصحيحة تُقرأ كما هي');
    eq([g.elapsedMs, g.elapsedMsStatus, g.timeToFirstTouchMs, g.timeToFirstTouchMsStatus], [4165, S.PRESENT, 1730, S.PRESENT], '[ي-٢][اصطناعي] elapsedMs وtimeToFirstTouchMs: قيمتاهما وحالتاهما');
    eq([g.touchState, g.elapsedMsBasis], [T.TOUCHED, N.TOUCH_GRID_ELAPSED_BASIS.FROM_FIRST_TOUCH], '[ي-٢][اصطناعي] لمسة وقعت، وelapsedMs «من أوّل لمسة» (fv69)');
    eq(own(m02(69, full)), [], '[ي-٢][اصطناعي] حالة سليمة: لا شذوذ في M-02');
    ok(statusTellsTheTruth(g), '[ي-٢][اصطناعي] كل حالة تطابق قيمتها (لا null بحالة PRESENT)');
    // 2026-10-18 +03 (S-M02، القاعدة 23): استُبدلت القائمة، لا أُضيف اختبارٌ بجوارها — كانت تثبّت أن مخرَج M-02 بلا gridBasis وبلا كتلة path، وهذا لم يعد صحيحاً بقرار القسم §٧-ي ف-01
    // (gridBasis يحسبه القارئ من الختم لكل ختم؛ وكتلة path تحمل مفاتيح fv71: حالتها وحدها تحت ختم < 71).
    eq(Object.keys(g).filter((k) => !k.endsWith('Status')).sort(),
        ['elapsedMs', 'elapsedMsBasis', 'endReason', 'endReasonState', 'gridBasis', 'gridCols', 'gridRows', 'maxSimultaneousPointers', 'path', 'timeToFirstTouchMs', 'totalCells', 'touchState', 'touchedCells'],
        '[ي-٢][اصطناعي] مفاتيح الخرج: الأسماء السبعة القائمة + timeToFirstTouchMs + الحالات (touchState وelapsedMsBasis وendReasonState) + gridBasis وكتلة path (fv71)');
    eq([g.gridBasis, g.path], [N.TOUCH_GRID_GRID_BASIS.FIXED_8X15, {state: N.TOUCH_PATH_STATE.NOT_IN_FIELDS_VERSION, unexpectedKeys: []}],
        '[ي-٢][اصطناعي] ختم 69: أساس الشبكة 8×15 الثابتة، وكتلة path بحالتها وحدها (غيابها هو الحال)');
  }

  // ٢) endReason: القيم الأربع كلٌّ على حدة (القاعدة 30) — كلّها «معروفة» بلا شذوذ، وkind = القيمة نفسها
  for (const [key, value] of Object.entries(N.TOUCH_GRID_END_REASON)) {
    const o = m02(69, {...full, endReason: value});
    const g = tg(o);
    eq([g.endReason, g.endReasonStatus, g.endReasonState.kind, g.endReasonState.recognized], [value, S.PRESENT, value, true], `[ي-٢][اصطناعي] endReason=${value} (${key}): معروفة، kind=القيمة`);
    eq(own(o), [], `[ي-٢][اصطناعي] endReason=${value}: لا شذوذ`);
  }
  eq(Object.values(N.TOUCH_GRID_END_REASON), ['auto_complete', 'user_marked_not_working', 'user_marked_not_tested', 'dismissed'], '[ي-٢] المفردة أربع قيم بنصّ العقد (:1472) لا غير');
  {
    const o = m02(69, {...full, endReason: 'closed_by_system'});
    const g = tg(o);
    eq([g.endReason, g.endReasonState.kind, g.endReasonState.recognized], ['closed_by_system', N.READER_STATE.UNRECOGNIZED, false], '[ي-٢][اصطناعي] endReason خارج الأربع: يُقرأ UNRECOGNIZED ولا يُسقَط ولا يُلحَق بأقربها');
    ok(o.anomalies.some((a) => a.code === 'UNRECOGNIZED_STATE' && a.detail.raw === 'closed_by_system'), '[ي-٢][اصطناعي] ويُعلَن شذوذاً (القاعدة 25)');
    const none = tg(m02(69, (() => { const x = {...full}; delete x.endReason; return x; })()));
    eq([none.endReason, none.endReasonStatus, none.endReasonState], [null, S.ABSENT, null], '[ي-٢][اصطناعي] endReason غائب في fv69: ABSENT لا قيمة مختلَقة');
  }

  // ٣) لا لمسة: elapsedMs وtimeToFirstTouchMs غائبان **بسبب** (touchedCells = 0) — ABSENT_DECLARED لا null صامت ولا شذوذ
  {
    const noTouch = {gridCols: 8, gridRows: 15, totalCells: 120, touchedCells: 0, endReason: 'user_marked_not_tested', maxSimultaneousPointers: 0};
    const o = m02(69, noTouch);
    const g = tg(o);
    eq([g.touchState, g.elapsedMs, g.elapsedMsStatus, g.timeToFirstTouchMs, g.timeToFirstTouchMsStatus], [T.NO_TOUCH, null, S.ABSENT_DECLARED, null, S.ABSENT_DECLARED],
        '[ي-٢][اصطناعي] لا لمسة: الزمنان غائبان بإعلان السبب (touchedCells = 0) لا غياباً صامتاً');
    eq(own(o), [], '[ي-٢][اصطناعي] وغيابهما هنا هو التصميم: لا شذوذ');
    ok(statusTellsTheTruth(g), '[ي-٢][اصطناعي] حالات لا لمسة تطابق قيمها');
    const base = 'measurements.items[0].touchGrid.';
    eq(o.absences.ABSENT_DECLARED.filter((p) => p.startsWith(base)), [base + 'elapsedMsStatus', base + 'timeToFirstTouchMsStatus'],
        '[ي-٢][اصطناعي] والغياب المُعلَن يظهر في ملخّص الغياب في أعلى المخرَج بمساريه');
    eq(o.absences.ABSENT.filter((p) => p.startsWith(base)), [], '[ي-٢][اصطناعي] ولا يظهر في «غياب بلا سبب»');
  }
  // غياب الزمنين مع وقوع لمسة: شذوذ معلن (ABSENT بلا سبب)
  for (const [label, drop] of [['timeToFirstTouchMs', K.TIME_TO_FIRST_TOUCH_MS], ['elapsedMs', K.ELAPSED_MS]]) {
    const x = {...full};
    delete x[drop];
    const o = m02(69, x);
    const g = tg(o);
    eq(g[`${label}Status`], S.ABSENT, `[ي-٢][اصطناعي] ${label} غائب مع لمسات (touchedCells=120): ABSENT لا ABSENT_DECLARED`);
    ok(o.anomalies.some((a) => a.code === 'TOUCH_GRID_TIMING_ABSENT_DESPITE_TOUCH' && a.section.endsWith(`.${label}`)), `[ي-٢][اصطناعي] ${label}: شذوذ «غائب رغم اللمس» معلن`);
    ok(o.absences.ABSENT.some((p) => p.endsWith(`touchGrid.${label}Status`)), `[ي-٢][اصطناعي] ${label}: يظهر في «غياب بلا سبب»`);
  }
  // touchedCells نفسه غائب: لا حكم على اللمس، فغياب الزمنين لا يُشرَح بشيء
  {
    const x = {...full};
    delete x.touchedCells; delete x.elapsedMs; delete x.timeToFirstTouchMs;
    const o = m02(69, x);
    const g = tg(o);
    eq([g.touchState, g.touchedCells, g.touchedCellsStatus, g.elapsedMsStatus, g.timeToFirstTouchMsStatus], [T.UNDETERMINED_NO_TOUCHED_CELLS_COUNT, null, S.ABSENT, S.ABSENT, S.ABSENT],
        '[ي-٢][اصطناعي] touchedCells غائب: «غير محدَّد» وكل الغياب بلا سبب');
    eq(o.anomalies.filter((a) => a.code === 'TOUCH_GRID_TIMING_ABSENT_TOUCH_COUNT_UNKNOWN').length, 2, '[ي-٢][اصطناعي] والزمنان يُعلَنان شذوذاً بسبب «عدد اللمس مجهول»');
  }
  // زمن حاضر مع touchedCells = 0: تناقض يُعلَن (العقد: غائب إن لم تقع لمسة)، والقيمة لا تُسقَط
  {
    const o = m02(69, {...full, touchedCells: 0});
    eq([tg(o).elapsedMs, tg(o).timeToFirstTouchMs], [4165, 1730], '[ي-٢][اصطناعي] الزمنان الحاضران يُقرآن كما وصلا ولا يُمحيان');
    eq(o.anomalies.filter((a) => a.code === 'TOUCH_GRID_TIMING_PRESENT_WITHOUT_TOUCH').length, 2, '[ي-٢][اصطناعي] وحضورهما مع touchedCells = 0 تناقض معلن (مرّتان)');
  }
  // نوع خاطئ
  {
    const o = m02(69, {...full, elapsedMs: 'x', timeToFirstTouchMs: 17.5});
    eq([tg(o).elapsedMs, tg(o).elapsedMsStatus, tg(o).timeToFirstTouchMs, tg(o).timeToFirstTouchMsStatus], [null, S.WRONG_TYPE, null, S.WRONG_TYPE], '[ي-٢][اصطناعي] نصّ أو كسر حيث يُنتظر عدد صحيح: WRONG_TYPE لا تحويل');
    eq(o.anomalies.filter((a) => a.code === 'WRONG_TYPE').length, 2, '[ي-٢][اصطناعي] ويُعلَن شذوذاً لكل منهما');
  }

  // ٤) الإصدار: دلالة elapsedMs تتبع الختم، وtimeToFirstTouchMs لم يوجد قبل 69
  {
    const noTtft = (() => { const x = {...full}; delete x.timeToFirstTouchMs; return x; })();
    const g68 = tg(m02(68, noTtft));
    eq([g68.timeToFirstTouchMs, g68.timeToFirstTouchMsStatus, g68.elapsedMsBasis], [null, S.NOT_IN_FIELDS_VERSION, N.TOUCH_GRID_ELAPSED_BASIS.UNDETERMINED_BEFORE_FV69],
        '[ي-٢][اصطناعي] ختم 68: timeToFirstTouchMs «ليس في هذا الإصدار» لا ABSENT، وأساس elapsedMs «غير محدَّد» (العقد كان يسأل)');
    eq(own(m02(68, noTtft)), [], '[ي-٢][اصطناعي] ختم 68 بلا timeToFirstTouchMs: لا شذوذ (لم يوجد بعد)');
    const gNull = tg(m02(null, full));
    eq(gNull.elapsedMsBasis, N.TOUCH_GRID_ELAPSED_BASIS.UNDETERMINED_NO_FIELDS_VERSION, '[ي-٢][اصطناعي] بلا ختم: أساس elapsedMs «غير محدَّد، لا ختم» — لا يُفترَض fv69');
    eq(tg(m02(70, full)).elapsedMsBasis, N.TOUCH_GRID_ELAPSED_BASIS.FROM_FIRST_TOUCH, '[ي-٢][اصطناعي] ختم أعلى من 69 (عتبة لا مساواة): الأساس «من أوّل لمسة»');
  }

  // ٥) ما لا يقوله القارئ: غياب measurements عن M-02 كلّه لا يُعلَن «متوقَّعاً» (العقد يجعله مشروعاً عند dismissed بلا لمسة، :1475)
  {
    const o = m02(69);
    eq(o.measurements.items, [], '[ي-٢][اصطناعي] M-02 بلا measurements: لا عنصر');
    eq(o.measurements.expectedButAbsent, [], '[ي-٢][اصطناعي] ولا إعلان «غائب» (غيابه مشروع في العقد، فلا يُقرأ عطباً)');
  }
}

// ═══════════════════════════════════════════════════════════════════
// ك) سطر السجلّ
// ═══════════════════════════════════════════════════════════════════
{
  const line = R.summarizeForLog(OUT['16ch-four-policies-truncated-failures']);
  ok(line.startsWith('[fv68] fieldsVersion=69 appVersion=1.0.11 applicable=true columns=16 baseLayout=MATCHES'), '[ك] سطر السجلّ: الختم (69) والأعمدة والتخطيط');
  ok(line.includes('cpu_freq_policy2_khz:TRUNCATED(230)'), '[ك] وقائمة الفشل المبتورة بعددها');
  ok(!line.includes(P['16ch-four-policies-truncated-failures'].timeSeries.header.scanId), '[ك] بلا معرّف فحص');
  ok(!line.includes(P['16ch-four-policies-truncated-failures'].timeSeries.header.deviceFingerprint), '[ك] ولا بصمة جهاز');
  eq(R.summarizeForLog({readerError: 'x'}), '[fv68] readerError=x', '[ك] خطأ القارئ يُسجَّل');
}

console.log(`\nfv68Reader.test.js: ${n}/${n} assertions passed`);

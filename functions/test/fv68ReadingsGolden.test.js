'use strict';

// fv68ReadingsGolden.test.js — الفخّ الذهبي لقرّاء fv68 في الخادم (القاعدة 39) — أمر المنسّق 2026-10-09 +03، PLAN-05 الدفعة ٤، البند ٩.
//
// «الفخّ الذهبي يتبع العقد، لا يسبقه. كل تغيير في العقد يُعيد توليد الفخّ في اللحظة نفسها.» (القاعدة 39)
// يحرس هذا الاختبار طرفين:
//   (أ) أن الملفّات الذهبية الأربعة المُلتزَمة (test/fixtures/golden/fv68-readings-derived-from-*.json) تطابق ما يُنتجه
//       readFv68 فعلياً الآن من الحمولات الأربع المُلتزَمة — أيّ تغيير في القارئ أو ثوابته بلا إعادة توليد يُسقطه فوراً.
//       (يستدعي المولّد في الذاكرة فقط؛ لا يكتب ولا يلمس الملفّ، ويثبت ذلك بـmtime.)
//   (ب) أن الملفّات الذهبية نفسها تحمل المعنى الذي يقوله العقد (القاعدة 30: وصول القيمة ودلالتها معاً). الفخّ المولَّد من القارئ وحده لا يحرس
//       المعنى — لو أخطأ القارئ لصار الخطأ ذهبياً. فهذه الأحكام مكتوبة باليد من عقد FV68_CONTRACT.md ومن الحمولة نفسها
//       (فهارس الفشل تُقارَن بما في تذييل الحمولة لا بما أخرجه القارئ)، لا نسخة من مخرَج القارئ.
//
// (مُحدَّث 2026-10-10 +03: الحمولات الثلاث الأولى صارت fv69 — NeuralChek@a04b4f0، الدفعة ١٠ — وأُعيد توليد القراءات منها في الالتزام نفسه، القاعدة 39.)
// ⚠️ القيد المُعلَن (القاعدة 41): الحمولات الأربع مشتقّة لا مسجَّلة من جهاز يعمل بـfv69 — مرحلة ٢ (عيّنة جهاز حقيقية) بعد صدور APK fv69 (ولم يُشحن fv68 في أيّ APK).
// فهذا الفخّ يثبّت ما يقوله القارئ عن شكل العقد، لا ما يفعله جهاز حقيقي.
//
// الملفّات المحروسة مُصنَّفة في test/goldenFixturesGuardCoverage.test.js (مولَّدة ومحروسة). ولا نسخة منها في مستودعَي التطبيق/الموقع
// (القاعدة 11 من حدود هذا الوكيل: لا أقرأ مستودعاً آخر ولا أكتب فيه) — المنسّق يقرّر مزامنتها.
//
// لإعادة التوليد بعد تغيير مقصود في القارئ أو العقد:  node functions/scripts/generate-fv68-readings-derived.js --write
// ثم تحديث جدول sha256 في test/fixtures/golden/README.md (قسم «قراءات fv68») في الالتزام نفسه.
//
// Run: node functions/test/fv68ReadingsGolden.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const N = require('../src/analysis/fv68Names');
const G = require('../scripts/generate-fv68-readings-derived');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// الأسماء الأربعة بنصّها هنا (لا مشتقّة): الحارس الشامل test/goldenFixturesGuardCoverage.test.js يشترط أن يذكر حارسُ كل ملفّ ذهبي اسمَه حرفياً.
const GOLDEN_FILES = [
  'fv68-readings-derived-from-app-payload-11ch-nothing-admitted.json',
  'fv68-readings-derived-from-app-payload-13ch-selinux-blocked-policy.json',
  'fv68-readings-derived-from-app-payload-16ch-four-policies-truncated-failures.json',
  'fv68-readings-derived-from-fv67-request-1.0.10-62507f4.json',
  // 2026-10-13 +03 (قرّاء D في fv70): قراءات حمولات fv70 الثلاث (NeuralChek@80ca8c3)
  'fv68-readings-derived-from-app-payload-fv70-11ch-nothing-admitted.json',
  'fv68-readings-derived-from-app-payload-fv70-13ch-selinux-blocked-policy.json',
  'fv68-readings-derived-from-app-payload-fv70-16ch-four-policies-truncated-failures.json',
  // 2026-10-18 +03 (مزامنة fv71): قراءات حمولات fv71 الثلاث **من المُنتِج** (NeuralChek@f9e0571) — حلّت محلّ ست قراءات لعيّنات بنيتُها من العقد (القاعدة 23)
  'fv68-readings-derived-from-app-payload-fv71-11ch-nothing-admitted.json',
  'fv68-readings-derived-from-app-payload-fv71-13ch-selinux-blocked-policy.json',
  'fv68-readings-derived-from-app-payload-fv71-16ch-four-policies-truncated-failures.json',
];
eq(G.INPUTS.map((i) => i.outFile), GOLDEN_FILES, '[إعداد] أسماء الملفّات الذهبية في المولّد = المُعدَّدة هنا (لا ملفّ يُولَّد بلا حارس)');
const GOLDEN = G.GOLDEN_DIR;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));

// ═══════════════════════════════════════════════════════════════════
// (أ) الفخّ يطابق القارئ الآن
// ═══════════════════════════════════════════════════════════════════
const before = G.INPUTS.map((i) => fs.statSync(path.join(GOLDEN, i.outFile)).mtimeMs);
const fresh = G.buildReadingsSamples();
const after = G.INPUTS.map((i) => fs.statSync(path.join(GOLDEN, i.outFile)).mtimeMs);
eq(after, before, '[بناء] buildReadingsSamples لم تكتب ولم تلمس أيّ ملفّ ذهبي (mtime بلا تغيير)');
eq(fresh.length, 10, '[إعداد] عشر حمولات: ثلاث fv69 وواحدة 1.0.10 (fv67) وثلاث fv70 (2026-10-13) وثلاث fv71 من المُنتِج (2026-10-18)');

function diffPaths(a, b, p, out) {
  if (out.length >= 20) return;
  if (typeof a !== typeof b) { out.push(`${p}: ${typeof a} ≠ ${typeof b}`); return; }
  if (a === null || b === null) { if (a !== b) out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); return; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${p}: مصفوفة ≠ غير مصفوفة`); return; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${p}: طول ${a.length} ≠ ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i], b[i], `${p}[${i}]`, out);
    return;
  }
  if (typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${p}.${k}: غائب في المُلتزَم`);
      else if (!(k in b)) out.push(`${p}.${k}: غائب في الطازج`);
      else diffPaths(a[k], b[k], `${p}.${k}`, out);
    }
    return;
  }
  if (a !== b) out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

for (const s of fresh) {
  const committed = readJson(s.outFile);
  const diffs = [];
  diffPaths(committed, s.readings, '', diffs);
  eq(diffs, [], `[أ] ${s.outFile}: المُلتزَم = ما يُنتجه القارئ الآن (أعِد التوليد بـ--write إن كان التغيير مقصوداً)`);
  const bytes = fs.readFileSync(path.join(GOLDEN, s.outFile), 'utf8');
  eq(bytes, s.text, `[أ] ${s.outFile}: الملفّ بايتاً ببايت = التسلسل الطازج (نهاية الأسطر LF — .gitattributes يمنع التحويل)`);
  ok(fs.existsSync(path.join(GOLDEN, s.source)), `[أ] مصدر ${s.outFile} موجود: ${s.source}`);
}

// جدول sha256 في README الفخّ (يُحدَّث في الالتزام نفسه)
{
  const readme = fs.readFileSync(path.join(GOLDEN, 'README.md'), 'utf8');
  for (const s of fresh) {
    ok(readme.includes(`${s.sha256}  ${s.outFile}`), `[أ] README.md يسرد sha256 الحالي لـ${s.outFile} (${s.sha256.slice(0, 12)}…) — حدِّث الجدول عند إعادة التوليد`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// (ب) المعنى — مكتوب باليد من العقد ومن الحمولة نفسها
// ═══════════════════════════════════════════════════════════════════
const byOut = Object.fromEntries(G.INPUTS.map((i) => [i.outFile, i]));
const readingOf = (suffix) => readJson(G.INPUTS.find((i) => i.outFile.endsWith(suffix)).outFile);
const payloadOf = (suffix) => {
  const inp = G.INPUTS.find((i) => i.outFile.endsWith(suffix));
  return inp.fingerprintOf(readJson(inp.source));
};
const names = (r) => r.layout.columns.map((c) => c.name);

const R11 = readingOf('app-payload-11ch-nothing-admitted.json');
const R13 = readingOf('app-payload-13ch-selinux-blocked-policy.json');
const R16 = readingOf('app-payload-16ch-four-policies-truncated-failures.json');
const R67 = readingOf('fv67-request-1.0.10-62507f4.json');

// كل حمولة fv68: تُقرأ fv68 (applicable) بلا شذوذ، وmaxCpuTemp المحذوفة لا تعود قيمةً (عقد ت-10 :517-526: «cpuTempFinalC بدل maxCpuTemp و-1»)
for (const [label, r] of [['11ch', R11], ['13ch', R13], ['16ch', R16]]) {
  eq([r.fieldsVersion, r.applicable, r.anomalies], [N.FIELDS_VERSION_69, true, []], `[ب][${label}] fieldsVersion 69 (الدفعة ١٠)، قراءة fv68 مُفعَّلة بعتبة ≥ 68، بلا شذوذ`);
  eq(r.cpuTemp.legacyMaxCpuTemp, {status: N.KEY_STATUS.REMOVED_IN_FV68, value: null}, `[ب][${label}] maxCpuTemp محذوف بالعقد: حالته REMOVED_IN_FV68 لا قيمة (لا -1 ولا 0)`);
  // الوحدة: الأعمدة والمقاطع تعلن MiB/s ← القارئ يأخذها من الحمولة (عقد ت-19 :659-673)، لا من إصدار التطبيق
  eq([r.throughputUnit.unit, r.throughputUnit.basis], [N.THROUGHPUT_UNIT_MIB_PER_S, N.THROUGHPUT_UNIT_BASIS.DECLARED_IN_PAYLOAD], `[ب][${label}] وحدة v[8]/v[9]: MiB/s من الإعلان في الحمولة`);
  // التخطيط بالاسم: كل الأسماء فريدة، والأحد عشر الأساسية أولاً بترتيبها (عقد :421؛ س-35 :1046-1051 — v[] طويل متغيّر)
  eq(names(r).slice(0, N.BASE_CHANNEL_ORDER.length), [...N.BASE_CHANNEL_ORDER], `[ب][${label}] الأعمدة الأساسية الأحد عشر أولاً بترتيب العقد`);
  eq(new Set(names(r)).size, names(r).length, `[ب][${label}] أسماء الأعمدة فريدة`);
  eq([r.layout.columnCount, r.layout.sampleVectorLength, r.layout.sampleWidthConsistent], [names(r).length, names(r).length, true], `[ب][${label}] عرض كل عيّنة = عدد الأعمدة المُعلَنة`);
  eq(r.layout.columns.every((c, i) => c.index === i && c.indexFrom === 'position'), true, `[ب][${label}] فهرس العمود = موضعه في variables[] (لا حقل index في الحمولة)`);
}

// 11 عموداً: لا charge_counter_raw ولا سياسات، وcpuTempFinalC غائبة بإعلان لا بصفر (عقد ت-10)
eq(names(R11), [...N.BASE_CHANNEL_ORDER], '[ب][11ch] أحد عشر عموداً: الأساسية وحدها');
eq([R11.cpuTemp.state, R11.cpuTemp.valueC, R11.cpuTemp.valueStatus], [N.CPU_TEMP_STATE.ABSENT_DECLARED, null, N.KEY_STATUS.ABSENT_DECLARED], '[ب][11ch] درجة المعالج النهائية: غائبة بإعلان (absent:<سبب>)، قيمتها null لا -1 ولا 0');
eq(R11.cpuTemp.source.kind, N.STATE_KIND.ABSENT, '[ب][11ch] وسم المصدر: absent بسببه المنصوص في التذييل');
eq(R11.cpuPolicies.policies, [], '[ب][11ch] لا سياسات تردّد (لا عمود cpu_freq_policy*)');
eq(Object.values(R11.channelReadFailures.channels).every((c) => c.tracking === 'NOT_TRACKED_BY_DESIGN'), true, '[ب][11ch] أعمدة v[0..10]: «غير مُتتبَّعة بالتصميم» لا «سليمة» (عقد :70 (7)) — غياب التتبّع لا يُقرأ نجاحاً');

// 13 عموداً: charge_counter_raw في الموضع 11 بوحدة «كما أعلنها الجهاز»، وسياسة واحدة، والقيمة الحية 52
eq(names(R13).slice(11), [N.CHARGE_COUNTER_CHANNEL, 'cpu_freq_policy0_khz'], '[ب][13ch] العمودان الشرطيان: charge_counter_raw ثم cpu_freq_policy0_khz');
eq(R13.layout.columns[11].unit, N.CHARGE_COUNTER_UNIT_AS_DECLARED, '[ب][13ch] وحدة charge_counter_raw: «كما أعلنها الجهاز» (ليست µAh مفترضة — عقد :421)');
eq([R13.cpuTemp.valueC, R13.cpuTemp.source.kind], [52, N.STATE_KIND.LIVE_READ_AT_FINALIZE], '[ب][13ch] cpuTempFinalC = 52 بمصدر live_read_at_finalize');
// سياسة SELinux المحجوبة: تُقرأ «غير مقروءة» بنصّ الخطأ EACCES (القاعدة 21)، وهي سياسة بلا عمود، لا سياسة «مفقودة»
{
  const blocked = R13.cpuPolicies.policies.find((p) => p.policy === 4);
  ok(blocked !== undefined && blocked.maxFreq.valueKhz === null && /EACCES/.test(blocked.maxFreq.reason), '[ب][13ch] السياسة 4: غير مقروءة بسبب EACCES (يُميَّز بنصّ الخطأ لا بنوع الاستثناء)');
  eq(R13.cpuPolicies.policiesWithoutChannel, [4], '[ب][13ch] السياسة 4 لها مدخل بلا عمود — تُعلَن ولا تُنسى');
  eq(R13.cpuPolicies.policies.find((p) => p.policy === 0).maxFreq, {state: 'READ', valueKhz: 1950000, reason: null}, '[ب][13ch] السياسة 0: مقروءة 1950000 kHz');
}

// 16 عموداً: أربع سياسات بترتيب الحمولة، وfailure lists مبتورة لقناة واحدة
eq(names(R16).slice(11), [N.CHARGE_COUNTER_CHANNEL, 'cpu_freq_policy0_khz', 'cpu_freq_policy2_khz', 'cpu_freq_policy4_khz', 'cpu_freq_policy6_khz'],
    '[ب][16ch] charge_counter_raw ثم أربع سياسات 0/2/4/6 — بالاسم لا بالموضع');
eq([R16.cpuTemp.valueC, R16.cpuTemp.source.kind], [58.5, N.STATE_KIND.SAMPLER_MAX_CPU], '[ب][16ch] cpuTempFinalC = 58.5 بمصدر sampler_max_cpu');

// S-27: فهارس الفشل في القراءة = ما في تذييل الحمولة حرفياً (يُقرأ من الحمولة هنا لا من مخرَج القارئ)، ومبتورة تُعلَن مبتورة
for (const [label, suffix, r] of [['13ch', 'app-payload-13ch-selinux-blocked-policy.json', R13], ['16ch', 'app-payload-16ch-four-policies-truncated-failures.json', R16]]) {
  const footer = payloadOf(suffix).timeSeries.footer;
  const lists = footer[N.FOOTER.CHANNEL_READ_FAILURES];
  const counts = footer[N.FOOTER.CHANNEL_READ_FAILURE_COUNTS];
  for (const ch of Object.keys(lists)) {
    const got = r.channelReadFailures.channels[ch];
    eq(got.failedIndices, lists[ch], `[ب][${label}] ${ch}: الفهارس المُستبعَدة = قائمة الحمولة حرفياً`);
    eq(got.count, counts[ch], `[ب][${label}] ${ch}: العدّاد المُعلَن = عدّاد الحمولة`);
    eq(got.tracking, counts[ch] > lists[ch].length ? 'TRUNCATED' : 'COMPLETE', `[ب][${label}] ${ch}: ${counts[ch]} فاشلة و${lists[ch].length} مسمّاة ← ${counts[ch] > lists[ch].length ? 'مبتورة' : 'كاملة'}`);
  }
}
eq([R16.channelReadFailures.channels.cpu_freq_policy2_khz.count, R16.channelReadFailures.channels.cpu_freq_policy2_khz.listedCount], [230, 200],
    '[ب][16ch] cpu_freq_policy2_khz: 230 فاشلة والمسمّاة 200 (السقف) — يُعلَن البتر بدل اعتبار القائمة كاملة');

// ─── fv69 (الدفعة ١٠، عقد §٧-ح — docs/FV68_CONTRACT.md:1429-1582): M-02 وSN-04 — أحكام مكتوبة باليد من العقد ومن الحمولة نفسها (لا من مخرَج القارئ) ───
// المصدر في كل حكم هو الحمولة المُلتزَمة (payloadOf)؛ فلو أخطأ القارئ لسقط الاختبار بدل أن يصير الخطأ ذهباً (القاعدة 30).
{
  const itemOf = (r, source, testId) => r.measurements.items.find((i) => i.source === source && i.testId === testId);
  const m02Raw = (suffix) => payloadOf(suffix).manualResults.find((m) => m.testId === 'M-02').measurements;
  const sn04Raw = (suffix) => payloadOf(suffix).functionalResults.find((f) => f.testId === 'SN-04').measurements;
  const S = N.KEY_STATUS;
  const cases = [
    ['11ch', 'app-payload-11ch-nothing-admitted.json', R11, 'auto_complete'],
    ['13ch', 'app-payload-13ch-selinux-blocked-policy.json', R13, 'user_marked_not_working'],
    ['16ch', 'app-payload-16ch-four-policies-truncated-failures.json', R16, 'user_marked_not_tested'],
  ];
  eq(cases.map((c) => c[3]), ['auto_complete', 'user_marked_not_working', 'user_marked_not_tested'], '[ب][fv69] ثلاث من قيم endReason الأربع تحملها العيّنات (الرابعة dismissed اصطناعية في fv68Reader.test.js)');
  for (const [label, suffix, r, endReason] of cases) {
    const raw = m02Raw(suffix);
    const tg = itemOf(r, 'manualResults', 'M-02').touchGrid;
    eq(raw.endReason, endReason, `[ب][fv69][${label}] الحمولة تحمل endReason=${endReason} (الحكم من الحمولة لا من القارئ)`);
    eq([tg.endReason, tg.endReasonStatus, tg.endReasonState.kind, tg.endReasonState.recognized], [endReason, S.PRESENT, endReason, true], `[ب][fv69][${label}] endReason يُقرأ معروفاً بقيمته`);
    eq([tg.gridCols, tg.gridRows, tg.totalCells, tg.touchedCells, tg.maxSimultaneousPointers],
        [raw.gridCols, raw.gridRows, raw.totalCells, raw.touchedCells, raw.maxSimultaneousPointers], `[ب][fv69][${label}] مفاتيح الشبكة الخمسة تصل كما أرسلها التطبيق`);
    eq(tg.elapsedMsBasis, N.TOUCH_GRID_ELAPSED_BASIS.FROM_FIRST_TOUCH, `[ب][fv69][${label}] elapsedMs في fv69 «من أوّل لمسة» (عقد :1470، قرار المستخدم 2026-10-10)`);
    if (raw.touchedCells > 0) {
      eq(tg.touchState, N.TOUCH_GRID_TOUCH_STATE.TOUCHED, `[ب][fv69][${label}] وقعت لمسة (touchedCells=${raw.touchedCells})`);
      eq([tg.elapsedMs, tg.elapsedMsStatus, tg.timeToFirstTouchMs, tg.timeToFirstTouchMsStatus], [raw.elapsedMs, S.PRESENT, raw.timeToFirstTouchMs, S.PRESENT],
          `[ب][fv69][${label}] الزمنان يصلان كما أرسلهما التطبيق (elapsedMs=${raw.elapsedMs}، timeToFirstTouchMs=${raw.timeToFirstTouchMs})`);
      ok(Number.isInteger(raw.elapsedMs) && raw.elapsedMs > 0 && Number.isInteger(raw.timeToFirstTouchMs) && raw.timeToFirstTouchMs > 0, `[ب][fv69][${label}] (عقلانية الحمولة) الزمنان عددان صحيحان موجبان`);
    } else {
      eq(tg.touchState, N.TOUCH_GRID_TOUCH_STATE.NO_TOUCH, `[ب][fv69][${label}] لا لمسة (touchedCells=0)`);
      ok(!('elapsedMs' in raw) && !('timeToFirstTouchMs' in raw), `[ب][fv69][${label}] الحمولة بلا الزمنين (عقد :1470-1471: غائبان إن لم تقع لمسة)`);
      eq([tg.elapsedMs, tg.elapsedMsStatus, tg.timeToFirstTouchMs, tg.timeToFirstTouchMsStatus], [null, S.ABSENT_DECLARED, null, S.ABSENT_DECLARED],
          `[ب][fv69][${label}] وغيابهما مُعلَن بسببه (ABSENT_DECLARED) لا null صامت`);
    }
  }
  // SN-04: لا قارئ جديد (قرار المستخدم 2026-10-10)؛ يمرّ خامّه بلا شذوذ ويُسرد مفاتيحه وحسب
  for (const [label, suffix, r] of cases) {
    const raw = sn04Raw(suffix);
    const it = itemOf(r, 'functionalResults', 'SN-04');
    ok(it !== undefined, `[ب][fv69][${label}] SN-04 له عنصر measurements في القراءة`);
    eq(it.status, S.PRESENT, `[ب][fv69][${label}] SN-04: measurements حاضر`);
    eq(it.keys, Object.keys(raw).sort(), `[ب][fv69][${label}] SN-04: القارئ يسرد مفاتيح الحمولة نفسها (${Object.keys(raw).sort().join('، ')}) لا أكثر ولا أقلّ`);
    eq(it.keys, ['coverPromptAtMs', 'readingsBeforeCover', 'readingsDuringCover', 'windowMs'], `[ب][fv69][${label}] وهي مفاتيح عقد §٧-ح (ج) الأربعة (:1485-1490)`);
    eq([it.unencodable, it.unreadable], [null, null], `[ب][fv69][${label}] لا ترميز فاشل ولا فكّ فاشل`);
    eq(['l02', 'stepSensor', 'touchGrid'].filter((k) => k in it), [], `[ب][fv69][${label}] وبلا بنية مفسَّرة (لا قارئ لقيم SN-04 قبل المحطّة ١)`);
    ok(Array.isArray(raw.readingsBeforeCover) && Array.isArray(raw.readingsDuringCover), `[ب][fv69][${label}] القائمتان حاضرتان في الحمولة (عقد :1483: حاضرتان دائماً)`);
    const at = r.measurements.items.indexOf(it);
    eq(r.absences.ABSENT.concat(r.absences.ABSENT_DECLARED).filter((p) => p.startsWith(`measurements.items[${at}]`)), [], `[ب][fv69][${label}] ولا غياب (بسبب أو بلا) يخصّ SN-04`);
  }
  eq(cases.map(([, , r]) => r.anomalies), [[], [], []], '[ب][fv69] ولا شذوذ في القراءات الثلاث (الخامّ الجديد يمرّ بلا إعلان شذوذ)');
}

// ─── fv70 (2026-10-13 +03، §٧-ط من عقد التطبيق — منقول، غير متحقَّق من المستودع المصدر): قرّاء D — أحكام مكتوبة باليد من الحمولة نفسها بحلقة مستقلّة (لا من مخرَج القارئ) ───
// الحالة الإجمالية، والمتروك (لا نجاح ولا فشل ولا صفر)، وsieveLimit والمرجع بحسبه، وعدّاد عدم التطابق في الجزئي (كان `=== 'ran'` وحده يُسقطه إلى null).
{
  const F = [
    ['11ch', 'app-payload-fv70-11ch-nothing-admitted.json'],
    ['13ch', 'app-payload-fv70-13ch-selinux-blocked-policy.json'],
    ['16ch', 'app-payload-fv70-16ch-four-policies-truncated-failures.json'],
  ];
  const REF = {1000000: 78498, 10000000: 664579};
  for (const [label, suffix] of F) {
    const payload = payloadOf(suffix);
    const r = readingOf(suffix);
    const vr = payload.timeSeries.footer.verificationResults;
    const k = r.verification.cpuKnownAnswer;
    eq([r.fieldsVersion, r.applicable, r.anomalies], [N.FIELDS_VERSION_70, true, []], `[ب][fv70][${label}] fieldsVersion 70 (FIELDS_VERSION_70)، مُنطبِق، بلا شذوذ`);
    eq(k.state.state.raw, vr.cpuKnownAnswerState, `[ب][fv70][${label}] الحالة الإجمالية كما في الحمولة (${vr.cpuKnownAnswerState}) — معروفة لا UNRECOGNIZED`);
    eq(k.state.state.recognized, true, `[ب][fv70][${label}] ومعروفة`);
    // حلقة مستقلّة على عناصر الحمولة
    const want = {sieveMatch: 0, sieveMismatch: 0, sieveSkipped: 0, shaMatch: 0, shaSkipped: 0};
    let skippedRuns = 0;
    vr.cpuKnownAnswerRuns.forEach((el, i) => {
      if (el.sieveStatus === 'match') want.sieveMatch++;
      if (el.sieveStatus === 'mismatch') want.sieveMismatch++;
      if (el.sieveStatus === 'skipped:time_budget') want.sieveSkipped++;
      if (el.sha256Status === 'match') want.shaMatch++;
      if (el.sha256Status === 'skipped:time_budget') want.shaSkipped++;
      const item = k.runs.items[i];
      const skipped = el.sieveStatus === 'skipped:time_budget' || el.sha256Status === 'skipped:time_budget';
      if (skipped) skippedRuns++;
      eq(item.skipped, skipped, `[ب][fv70][${label}] عنصر ${i}: skipped = ${skipped}`);
      if (skipped) {
        eq([item.t, item.tEnd, item.sieve.primeCount, item.sieve.durationMs, item.sha256.durationMs, item.sieve.limit.value], [null, null, null, null, null, null], `[ب][fv70][${label}] عنصر ${i} المتروك: لا t ولا tEnd ولا عدد ولا زمن ولا N (غياب لا صفر)`);
        eq(Object.keys(el).sort(), ['phase', 'plannedAtPct', 'sha256Status', 'sieveStatus'], `[ب][fv70][${label}] عنصر ${i} المتروك: مفاتيحه الأربعة بالضبط في الحمولة`);
      }
      if (Number.isInteger(el.sieveLimit)) {
        eq([item.sieve.limit.basis, item.sieve.limit.value, item.sieve.referencePrimeCount], ['SHIPPED', el.sieveLimit, REF[el.sieveLimit]], `[ب][fv70][${label}] عنصر ${i}: N=${el.sieveLimit} من الحمولة والمرجع بحسبه (${REF[el.sieveLimit]}) لا بثابت`);
        eq(item.sieve.primeCountVsReference, el.sievePrimeCount === REF[el.sieveLimit] ? 'EQUAL' : 'DIFFERENT', `[ب][fv70][${label}] عنصر ${i}: العدد ${el.sievePrimeCount} مقابل المرجع`);
      }
    });
    eq([k.counts.sieveMatch, k.counts.sieveMismatch, k.counts.sieveSkipped, k.counts.shaMatch, k.counts.shaSkipped],
        [want.sieveMatch, want.sieveMismatch, want.sieveSkipped, want.shaMatch, want.shaSkipped], `[ب][fv70][${label}] العدّادات = العدّ المستقلّ من الحمولة`);
    eq(k.mismatches, want.sieveMismatch + (vr.cpuKnownAnswerRuns.filter((e) => e.sha256Status === 'mismatch').length), `[ب][fv70][${label}] عدّاد عدم التطابق حقيقي (لا null) حتى في الجزئي`);
    eq(k.totalMsByPhase.byPhase, vr.cpuKnownAnswerTotalMsByPhase, `[ب][fv70][${label}] مجموع زمن D لا يدخله المتروك (كما شُحن)`);
    if (label === '11ch') eq([vr.cpuKnownAnswerState, skippedRuns, k.mismatches], ['partial:time_budget', 2, 0], '[ب][fv70][11ch] جزئي: عنصران متروكان، وعدم التطابق 0 (لا null)');
  }
}

// حمولة 1.0.10 (fv67): لا تُقرأ كأنها fv68 — الغياب يبقى غياباً (القاعدة 22)، و-1 القديمة لا تصير حرارة
eq([R67.fieldsVersion, R67.applicable], [67, false], '[ب][fv67] fieldsVersion 67: قراءة fv68 غير مُفعَّلة');
eq(names(R67), [...N.BASE_CHANNEL_ORDER], '[ب][fv67] أحد عشر عموداً بالأسماء');
eq([R67.cpuTemp.state, R67.cpuTemp.valueC, R67.cpuTemp.valueStatus], [N.READER_STATE.ABSENT, null, N.KEY_STATUS.NOT_IN_FIELDS_VERSION], '[ب][fv67] cpuTempFinalC: غير موجودة في هذا الإصدار (لا صفر)');
eq(R67.cpuTemp.legacyMaxCpuTemp, {status: N.KEY_STATUS.PRESENT, value: -1}, '[ب][fv67] maxCpuTemp القديمة تُقرأ كما هي (-1 حارسة) ولا تصير درجة حرارة');
eq([R67.throughputUnit.unit, R67.throughputUnit.basis], [null, N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_APP_VERSION_V6BETA],
    '[ب][fv67] وحدة الإنتاجية: «غير محدَّدة» لـ1.0.8-v6beta (الحمولة المشتقّة تحمل appVersion الأصلي في الترويسة، لا 1.0.10) — لا تخمين');
eq(R67.channelReadFailures.map.status, N.KEY_STATUS.NOT_IN_FIELDS_VERSION, '[ب][fv67] channelReadFailures: غير موجودة في fv67 — لا تُقرأ «لا فشل»');

// ─── fv71 (مزامنة 2026-10-18): الحمولات الثلاث **من المُنتِج** (NeuralChek@f9e0571: A-M02 وA-VOL وA-P6-13) — أحكام باليد من الحمولة نفسها بحلقات مستقلّة (القاعدة 30) ───
// حلّت هذه محلّ ست عيّنات كنتُ بنيتها من العقد (حُذفت، القاعدة 23). **ما لا تغطّيه عيّنات المُنتِج** (يبقى بلا دليل منتِج، ويُغطّى باختبارات وحدة بحمولات معدَّلة منها): M-02 pass بلا measurements (بعد 5f90ce1)،
// وendReason=dismissed لـM-02، وتحقّق reached=true مع pointsDropped>0 بغير السقف، وتجاوز events 64، وpowerSaveState=on، وbrightnessLock=not_attempted:no_scan_screen_reported، وbatteryLevelStart خارج 30–85،
// وطرق التثبيت system_setting، وأسباب الغياب api_below_<n> وnot_reported_by_device، وstroke.end=cancel، وdensitySource=DENSITY_DPI_FALLBACK وأيّ عنصر في densityCheck، وresampledFlagState=not_read_by_app.
const F71 = [
  ['11ch', 'app-payload-fv71-11ch-nothing-admitted.json'],
  ['13ch', 'app-payload-fv71-13ch-selinux-blocked-policy.json'],
  ['16ch', 'app-payload-fv71-16ch-four-policies-truncated-failures.json'],
];
{
  const OLD_KEYS = ['gridCols', 'gridRows', 'totalCells', 'touchedCells', 'elapsedMs', 'timeToFirstTouchMs', 'endReason', 'maxSimultaneousPointers'];
  const S = N.KEY_STATUS;
  const medianOf = (a) => {
    const b = a.slice().sort((x, y) => x - y);
    const m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  };
  for (const [label, suffix] of F71) {
    const payload = payloadOf(suffix);
    const raw = payload.manualResults.find((m) => m.testId === 'M-02').measurements;
    const r = readingOf(suffix);
    const tg = r.measurements.items.find((i) => i.testId === 'M-02').touchGrid;
    const p = tg.path;
    eq([r.fieldsVersion, r.applicable, r.anomalies], [71, true, []], `[ب][fv71][${label}] الختم 71، مُنطبِق، بلا شذوذ (حمولة المُنتِج)`);
    eq([tg.gridBasis, p.state], ['MM_TARGET', 'READ'], `[ب][fv71][${label}] أساس الشبكة MM_TARGET (الختم ≥ 71)، والكتلة مقروءة`);
    // كل مفتاح جديد في الحمولة يصل بحالة PRESENT وقيمته كما شُحنت (ما عدا المركَّبة: تُلخَّص بلا إحداثيات)
    const COMPOSITE = ['strokes', 'displayedSuspects', 'absentFieldReasons', 'pathCap'];
    for (const key of Object.keys(raw).filter((k) => !OLD_KEYS.includes(k))) {
      eq(p[`${key}Status`], S.PRESENT, `[ب][fv71][${label}] ${key}: يصل PRESENT`);
      if (!COMPOSITE.includes(key)) eq(p[key], raw[key], `[ب][fv71][${label}] ${key}: القيمة كما شُحنت`);
    }
    // «إطار + X» (2026-10-21): المفتاحان حاضران في الثلاث (DECLARED)، والعلاقة 2 بعدّ مستقلّ من الحمولة نفسها، وأساس «المطلوب» المُعلَن
    eq([p.gridPatternState, p.gridPattern, p.gridPatternStatus, p.notRequiredCellsStatus, p.requiredCellsBasis], ['DECLARED', 'FRAME_AND_DIAGONALS', S.PRESENT, S.PRESENT, 'NOT_REQUIRED_CELLS_DECLARED'],
        `[ب][fv71][${label}] gridPattern = FRAME_AND_DIAGONALS وحالتها DECLARED وأساس المطلوب مُعلَن`);
    eq(raw.totalCells, raw.gridCols * raw.gridRows - raw.cutoutCells.length - raw.notRequiredCells.length, `[ب][fv71][${label}] totalCells = cols × rows − |cutoutCells| − |notRequiredCells| (عدّ من الحمولة)`);
    eq(raw.notRequiredCells.filter((i) => raw.cutoutCells.includes(i)), [], `[ب][fv71][${label}] cutoutCells وnotRequiredCells منفصلتان (من الحمولة)`);
    // الخطوط: عدّ مستقلّ من الحمولة
    const points = raw.strokes.reduce((a, st) => a + st.x.length, 0);
    eq([p.strokes.count, p.strokes.pointsTotal, p.strokes.usableCount], [raw.strokes.length, points, raw.strokes.length], `[ب][fv71][${label}] ${raw.strokes.length} خطّ و${points} نقطة (عدّ مستقلّ)`);
    // معدّل العيّنات: وسيط الفواصل من dtMs (من العيّنة 1 فصاعداً)
    const intervals = raw.strokes.flatMap((st) => st.dtMs.slice(1));
    const a = p.analysis;
    eq([a.sampling.medianIntervalMs, a.sampling.intervalCount, a.sampling.medianRateHz], [medianOf(intervals), intervals.length, 1000 / medianOf(intervals)], `[ب][fv71][${label}] معدّل العيّنات: الوسيط والعدد من الحمولة`);
    // الخلايا: ما حسبه الخادم من الخامّ = ما شحنه المُنتِج (اصطلاح الخلية floor(x/cellWidthPx) تؤيّده العيّنات الثلاث)
    eq([a.cells.state, a.cells.pathTouchedCount, a.cells.reportedTouchedCount, a.cells.pathUntouchedCount], ['MATCH', raw.touchedCells, raw.touchedCells, raw.untouchedCells.length],
        `[ب][fv71][${label}] تغطية الخلايا من المسار = ما شحنه المُنتِج`);
  }
  const m02 = (suffix) => readingOf(suffix).measurements.items.find((i) => i.testId === 'M-02').touchGrid;
  const raw02 = (suffix) => payloadOf(suffix).manualResults.find((m) => m.testId === 'M-02').measurements;
  // ما نعرفه **بالبناء** عن كل عيّنة (من الحمولة بالعين: dump 2026-10-18)
  const r11 = m02(F71[0][1]).path.analysis;
  eq([r11.detector.state, r11.detector.suspectsTotal, r11.detector.edgeExitsTotal, r11.detector.excludedStrokes.total], ['RAN', 0, 0, 0], '[ب][fv71][11ch] مسح واحد open_at_end: لا مواضع مشتبهة ولا خروج حافّة ولا استبعاد');
  eq([m02(F71[0][1]).endReason, m02(F71[0][1]).path.roundedCornersState, m02(F71[0][1]).path.roundedCornerRadiiPxStatus], ['auto_complete', 'not_available_api', 'ABSENT'], '[ب][fv71][11ch] auto_complete، وزوايا بلا أرقام (not_available_api)');
  const t13 = m02(F71[1][1]);
  eq(t13.path.analysis.detector.suspects.map((x) => [x.kind, x.strokeIndex, x.toStrokeIndex, x.gapMs]), [['gap_jump', 0, 0, 60], ['coord_jump', 0, 0, 8]],
      '[ب][fv71][13ch] بالحمولة: قفزة بفجوة 60 مث (x 733 ⟶ 1333) وقفزة إحداثيات بلا فجوة (x 733 ⟶ 1233) في الخطّ 0');
  eq(t13.path.analysis.detector.excludedStrokes.items, [{strokeIndex: 2, reasons: ['CANCELLED']}], '[ب][fv71][13ch] خطّ راحة اليد (cancel_flagged) مستبعَد من الكشف');
  eq(t13.path.displayedSuspects.items.items.map((x) => [x.kind, x.strokeIndex, x.fromPointIndex, x.toPointIndex]), raw02(F71[1][1]).displayedSuspects.map((x) => [x.kind, x.strokeIndex, x.fromPointIndex, x.toPointIndex]),
      '[ب][fv71][13ch] علامات العرض الأربع كما شُحنت (gap_jump وcoord_jump وedge_exit مرّتين)');
  eq([t13.path.analysis.displayedVsDetected.displayedCount, t13.path.analysis.displayedVsDetected.matchedCount, t13.path.analysis.displayedVsDetected.displayedNotDetected.total], [4, 2, 2],
      '[ب][fv71][13ch] علامتان يؤيّدهما الخادم، وعلامتا edge_exit تعرضهما المُنتِج ولا يكشفهما الخادم (يُرى الفرق: الخادم لا يعدّ رفعاً قرب الحافّة قفزة بلا خطّ لاحق بعده — معلّق: قاعدة المُنتِج لـedge_exit غير محدَّدة في القسم)');
  // «إطار + X» (2026-10-21، NeuralChek@4c0102c): حلّ هذا محلّ «[[5, 6], 286, 208]» (كل الخلايا مطلوبة عدا المقصاة) — القاعدة 23: المطلوب الآن إطار وقطران = 288 − 2 مقصاتان − 180 غير مطلوبة = 106، والملموسة منها 75
  // (2026-10-22، NeuralChek@3810146، أمر الباك اند ٧): استُبدل ثانيةً بأرقام العيّنة الجديدة (القاعدة 23) — مقصاة [8, 9, 26, 27] (من الحمولة) والمطلوبة 18×35 − 4 − 432 = 194 والملموسة منها 97 (عدّ مستقلّ بأخذ عيّنات نقطية من الملفّ، يطابق ما شحنه المُنتِج)
  eq([t13.path.cutoutCells, t13.totalCells, t13.touchedCells], [[8, 9, 26, 27], 194, 97], '[ب][fv71][13ch] أربع خلايا مقصاة (ثقب الكاميرا) و432 غير مطلوبة بالنمط: 18×35 − 4 − 432 = 194 مطلوبة و97 ملموسة منها');
  const t16 = m02(F71[2][1]);
  eq([t16.path.pathCap.reached, t16.path.pathCap.pointsDropped, t16.path.strokes.pointsTotal, t16.path.analysis.detector.state, t16.path.analysis.detector.suspectsTotal], [true, 300, 15000, 'RAN', 0], '[ب][fv71][16ch] السقف بُلغ: 15000 نقطة مسجَّلة و300 مُسقَطة، والكاشف يعمل على الخامّ كلّه بلا مشتبه');
  eq(Object.fromEntries(Object.entries(t16.path.absentFieldReasons).map(([k, v]) => [k, [v.kind, v.detail]])),
      {modePhysicalHeightPx: ['read_failed', 'the display has no current mode'], modePhysicalWidthPx: ['read_failed', 'the display has no current mode'], unbufferedDispatch: ['read_failed', 'requestUnbufferedDispatch is refused by this view']},
      '[ب][fv71][16ch] الغياب بسببه (read_failed:<نصّ>): ثلاثة مفاتيح، ABSENT_DECLARED لا شذوذ');
  eq(['modePhysicalWidthPx', 'modePhysicalHeightPx', 'unbufferedDispatch'].map((k) => t16.path[`${k}Status`]), ['ABSENT_DECLARED', 'ABSENT_DECLARED', 'ABSENT_DECLARED'], '[ب][fv71][16ch] وحالتها ABSENT_DECLARED');
  eq(readingOf(F71[0][1]).measurements.expectedButAbsent, [], '[ب][fv71] لا «غائب متوقَّع» لـM-02');
  eq(F71.map(([, s]) => readingOf(s).touchGridAnswer), [
    {state: 'RAW_PRESENT', manualStatus: 'pass', passRawRelation: 'BACKS_PASS', rawEndReason: 'auto_complete'},
    {state: 'RAW_PRESENT', manualStatus: 'fail', passRawRelation: 'NOT_APPLICABLE_STATUS_NOT_PASS', rawEndReason: 'user_marked_not_working'},
    {state: 'RAW_PRESENT', manualStatus: 'not_tested', passRawRelation: 'NOT_APPLICABLE_STATUS_NOT_PASS', rawEndReason: 'user_marked_not_tested'},
  ], '[ب][fv71] جواب M-02 في العيّنات الثلاث: pass يسنده auto_complete · fail · not_tested (لا مقارنة بالخامّ لغير pass)');
}

// ─── fv71 أزرار الصوت (A-VOL): العيّنات الثلاث من المُنتِج — أحكام باليد من الحمولة نفسها بحلقات مستقلّة (القاعدة 30) ───
{
  const S = N.KEY_STATUS;
  for (const [label, suffix] of F71) {
    const payload = payloadOf(suffix);
    const r = readingOf(suffix);
    for (const id of ['M-09', 'M-10']) {
      const raw = payload.manualResults.find((m) => m.testId === id).measurements;
      const vb = r.measurements.items.find((i) => i.testId === id).volumeButton;
      eq(vb.state, 'READ', `[ب][fv71-vol][${label}][${id}] مقروء`);
      for (const key of Object.keys(raw).filter((k) => k !== 'events')) {
        eq([vb[`${key}Status`], vb[key]], [S.PRESENT, raw[key]], `[ب][fv71-vol][${label}][${id}] ${key}: يصل PRESENT وبقيمته كما شُحنت`);
      }
      // events: عدّ مستقلّ من الحمولة؛ والبتر بسقف 64 مكتوب هنا حرفاً لا من fv68Names
      eq([vb.events.count, vb.events.state, vb.eventsTotal, vb.eventsTruncated], [raw.events.length, raw.events.length === 0 ? 'EMPTY' : 'HAS_EVENTS', raw.eventsTotal, raw.eventsTotal > 64],
          `[ب][fv71-vol][${label}][${id}] events: العدّ والحالة وeventsTotal والبتر من الحمولة`);
      eq(vb.events.items.map((e) => [e.tMs, e.keyCode, e.action, e.repeat, e.deviceId, e.source]), raw.events.map((e) => [e.tMs, e.keyCode, e.action, e.repeat, e.deviceId, e.source]), `[ب][fv71-vol][${label}][${id}] العناصر كما شُحنت بحقولها الستّة`);
      // الغائب: كل مفتاح غائب في الحمولة غائب في القراءة بحالة غياب (لا قيمة)
      for (const key of ['timeToFirstExpectedDownMs', 'holdMs', 'detectionSource', 'volumeStreamMax', 'volumeLevelAtOpen', 'volumeLevelAtEnd', 'flags']) {
        if (!(key in raw)) eq([vb[key], vb[`${key}Status`] !== S.PRESENT], [null, true], `[ب][fv71-vol][${label}][${id}] ${key}: غائب في الحمولة ⟵ null بحالة غياب لا قيمة`);
      }
      // العدّادان من عدّ مستقلّ للأحداث (ضغطات down بـrepeat=0): مفهومهما في قسم f9e0571
      const downs = raw.events.filter((e) => e.action === 'down' && e.repeat === 0);
      eq([raw.expectedDownCount, raw.otherKeyDownCount], [downs.filter((e) => e.keyCode === raw.expectedKeyCode).length, downs.filter((e) => e.keyCode !== raw.expectedKeyCode).length],
          `[ب][fv71-vol][${label}][${id}] العدّادان المشحونان = عدّ مستقلّ من events[]`);
    }
    eq(r.volumeButtonAnswers, {'M-09': {state: 'RAW_PRESENT', manualStatus: payload.manualResults.find((m) => m.testId === 'M-09').status}, 'M-10': {state: 'RAW_PRESENT', manualStatus: payload.manualResults.find((m) => m.testId === 'M-10').status}},
        `[ب][fv71-vol][${label}] جواب M-09/M-10: الخامّ حاضر، والحالتان كما في الحمولة`);
  }
  // بالبناء (من الحمولة): كل قيم endReason الخمس وقيمتا detectionSource في العيّنات الثلاث
  const vbOf = (suffix, id) => readingOf(suffix).measurements.items.find((i) => i.testId === id).volumeButton;
  const ends = F71.flatMap(([, s]) => ['M-09', 'M-10'].map((id) => vbOf(s, id).endReason));
  eq([...new Set(ends)].sort(), ['auto_detected', 'dismissed', 'user_marked_not_tested', 'user_marked_not_working', 'user_marked_working'], '[ب][fv71-vol] قيم endReason الخمس كلّها في عيّنات المُنتِج');
  eq([...new Set(F71.flatMap(([, s]) => ['M-09', 'M-10'].map((id) => vbOf(s, id).detectionSource)))].filter((x) => x !== null).sort(), ['key_event', 'volume_level_change'], '[ب][fv71-vol] وقيمتا detectionSource كلتاهما');
  const a09 = vbOf(F71[0][1], 'M-09');
  const a10 = vbOf(F71[0][1], 'M-10');
  eq([a09.pressEvidence, a09.detectionSource, a09.expectedKeyCode, a10.pressEvidence, a10.detectionSource, a10.expectedKeyCode], ['KEY_EVENT_SEEN', 'key_event', 24, 'LEVEL_CHANGE_ONLY', 'volume_level_change', 25], '[ب][fv71-vol][11ch] M-09 (24) بحدث مفتاح وM-10 (25) بتغيّر المستوى وحده');
  eq([a10.timeToFirstExpectedDownMsStatus, a10.holdMsStatus], [S.ABSENT_DECLARED, S.ABSENT_DECLARED], '[ب][fv71-vol][11ch] M-10: لا ضغط مطلوب بحدث مفتاح ⟵ الزمنان غائبان بسببهما (لا صفر)');
  const b09 = vbOf(F71[1][1], 'M-09');
  eq([b09.endReason, b09.expectedDownCount, b09.otherKeyDownCount, b09.pressEvidence, b09.detectionSourceStatus], ['user_marked_working', 0, 1, 'NOT_ESTABLISHED', S.ABSENT_DECLARED], '[ب][fv71-vol][13ch] M-09 «يعمل» بيد الفنّي: ضغطة على المفتاح الآخر (25) لا المطلوب (24) — لا دليل ضغط مطلوب، بلا detectionSource');
  const c09 = vbOf(F71[2][1], 'M-09');
  const c10 = vbOf(F71[2][1], 'M-10');
  eq([c09.volumeStreamMaxStatus, c09.volumeLevelAtOpenStatus, c09.volumeLevelAtEndStatus, c09.pressEvidence], [S.ABSENT, S.ABSENT, S.ABSENT, 'NOT_ESTABLISHED'], '[ب][fv71-vol][16ch] M-09 «لم أختبر»: لا مستويات (غائبة لا أصفاراً، غياب مشروع بالقسم بلا سبب مكتوب)');
  eq([c10.endReason, c10.expectedKeyCode, c10.expectedDownCount, c10.otherKeyDownCount, c10.pressEvidence], ['dismissed', 25, 0, 1, 'NOT_ESTABLISHED'], '[ب][fv71-vol][16ch] M-10 أُغلق بحدث مفتاح الصوت الآخر: لا دليل على الضغط المطلوب');
}

// ─── fv71 توحيد الظروف P6-13 (A-P6-13): العيّنات الثلاث من المُنتِج — أحكام باليد من الحمولة نفسها (القاعدة 30) ───
{
  const S = N.KEY_STATUS;
  for (const [label, suffix] of F71) {
    const payload = payloadOf(suffix);
    const r = readingOf(suffix);
    const sc = r.scanConditions;
    eq([r.fieldsVersion, r.applicable, r.anomalies, sc.state, sc.unexpectedKeys], [71, true, [], 'READ', []], `[ب][fv71-cond][${label}] الختم 71، مُنطبِق، بلا شذوذ، والقسم مقروء`);
    // كل قيمة تصل كما شُحنت (من الحمولة لا من قيمة مكتوبة هنا)
    const ts = payload.timeSeries;
    eq([sc.header.powerSaveState, sc.root.powerSaveState], [ts.header.powerSaveState, payload.powerSaveState], `[ب][fv71-cond][${label}] powerSaveState في الموضعين كما شُحن`);
    eq([sc.brightnessLock.state, sc.brightnessLock.value, sc.brightnessLock.method], [ts.footer.brightnessLock.state, ts.footer.brightnessLock.value ?? null, ts.footer.brightnessLock.method ?? null], `[ب][fv71-cond][${label}] brightnessLock كما شُحن`);
    eq([sc.batteryWindow.minPct, sc.batteryWindow.maxPct, sc.batteryWindowBasis], [ts.footer.batteryWindowPct.minPct, ts.footer.batteryWindowPct.maxPct, 'DECLARED_IN_PAYLOAD'], `[ب][fv71-cond][${label}] النافذة كما أُعلِنت في الحمولة (الخادم لا يحمل 30 ولا 85)`);
    eq([sc.batteryLevelStart, sc.batteryLevelStartStatus], [ts.header.batteryLevelStart, S.PRESENT], `[ب][fv71-cond][${label}] بداية الشحن خامّ كما شُحن`);
  }
  // بالبناء (من الحمولة): off في الاثنتين الأولَيين مع المنطقيّين false، وread_failed في الثالثة والمنطقيّان غائبان لا false
  for (const idx of [0, 1]) {
    const a = readingOf(F71[idx][1]).scanConditions;
    eq([a.header.powerSaveState, a.header.isPowerSaveMode, a.header.isPowerSaveModeStatus, a.root.powerSaveMode, a.root.powerSaveModeStatus, a.powerSaveBasis], ['off', false, S.PRESENT, false, S.PRESENT, 'STATE_DECLARED'], `[ب][fv71-cond][${F71[idx][0]}] off ⇒ المنطقيّان false حاضران`);
  }
  const b = readingOf(F71[2][1]).scanConditions;
  eq([b.header.powerSaveState, b.header.isPowerSaveMode, b.header.isPowerSaveModeStatus, b.root.powerSaveMode, b.root.powerSaveModeStatus], ['read_failed', null, S.ABSENT_DECLARED, null, S.ABSENT_DECLARED], '[ب][fv71-cond][16ch] read_failed ⇒ المنطقيّان غائبان بسببه (null لا false، وABSENT_DECLARED لا ABSENT)');
  const k11 = readingOf(F71[0][1]).scanConditions.brightnessLock;
  eq([k11.state, k11.stateState.kind, k11.stateState.detail, k11.value, k11.valueStatus, k11.method, k11.methodStatus], ['not_attempted:value_not_decided', 'not_attempted', 'value_not_decided', null, S.ABSENT_DECLARED, null, S.ABSENT_DECLARED],
      '[ب][fv71-cond][11ch] حالة الإنتاج اليوم: not_attempted:value_not_decided بلا value ولا method — غائبان بسببه (لا صفر)');
  const k13 = readingOf(F71[1][1]).scanConditions.brightnessLock;
  eq([k13.stateState.kind, k13.value, k13.methodState.kind], ['applied', 0.5, 'window_attribute'], '[ب][fv71-cond][13ch] applied بـ0.5 وwindow_attribute');
  const k16 = readingOf(F71[2][1]).scanConditions.brightnessLock;
  eq([k16.stateState.kind, k16.stateState.detail, k16.value, k16.methodState.kind], ['apply_failed', 'the window refused the brightness attribute', 0.4, 'window_attribute'], '[ب][fv71-cond][16ch] apply_failed بنصّ الخطأ، ومعه value وmethod (حضورهما مع الفشل يقبله القارئ)');
  eq(F71.map(([, s]) => readingOf(s).scanConditions.startLevelVsWindow), ['WITHIN', 'WITHIN', 'WITHIN'], '[ب][fv71-cond] بداية الشحن 43 داخل 30–85 في الثلاث (BELOW_MIN وABOVE_MAX لا تغطّيهما عيّنة المُنتِج)');
  // ما قبل 71: المفاتيح الجديدة «لم توجد بعد» (لا ABSENT) والأساس القديم مُعلَن؛ لا حكم على نافذة 25
  for (const suffix of ['app-payload-11ch-nothing-admitted.json', 'app-payload-fv70-11ch-nothing-admitted.json', 'fv67-request-1.0.10-62507f4.json']) {
    const sc = readingOf(suffix).scanConditions;
    eq([sc.state, sc.header.powerSaveStateStatus, sc.root.powerSaveStateStatus, sc.brightnessLock.status, sc.batteryWindow.status, sc.powerSaveBasis, sc.batteryWindowBasis],
        ['NOT_IN_FIELDS_VERSION', S.NOT_IN_FIELDS_VERSION, S.NOT_IN_FIELDS_VERSION, S.NOT_IN_FIELDS_VERSION, S.NOT_IN_FIELDS_VERSION, 'LEGACY_BOOLEAN_ONLY', 'LEGACY_FIXED_MIN_NO_MAX'], `[ب][fv71-cond][${suffix}] ختم < 71: المفاتيح الثلاثة NOT_IN_FIELDS_VERSION، والأساسان القديمان مُعلَنان (25 ولا حدّ أعلى)`);
  }
}

console.log(`\nfv68ReadingsGolden.test.js: ${n}/${n} assertions passed`);

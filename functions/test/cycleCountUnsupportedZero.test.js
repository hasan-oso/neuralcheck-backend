'use strict';

// cycleCountUnsupportedZero.test.js — صفر الدورات من EXTRA_CYCLE_COUNT ⟵ «غير مدعوم» (قرار المستخدم 2026-10-13 +03، src/analysis/cycleCountClassification.js).
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): «التطبيق يرسل القيمة الخامّة كما هي (القاعدة 20). والخادم يصنّف الصفر من extra_api34 «غير مدعوم»: لا يذهب B-08 إلى النموذج،
// ولا يُعرض، ولا يدخل computeScanSignature رقماً، بل حالةً. مع اختبار.» و«الشرط كما كتبتَه (cycleCountState == "read" وcycleCountSource == "extra_api34" وcycleCount === 0 ⇐ unsupported:zero_from_extra_api34)
// معتمد، باسمه، ولكل العلامات.»
//
// ما يغطّيه (الأمر: كلٌّ من الشروط الثلاثة كاذباً وحده ⟵ لا تصنيف · الثلاثة صادقة ⟵ الوسم · علامتان مختلفتان ⟵ النتيجة نفسها · الحقل غائباً — القاعدة 22 · الحمولة · البصمة · قاعدة 37):
//   ١ الوسم قيمة واحدة مُصدَّرة، بحروفه، ومعرّف B-08 مصدره واحد.
//   ٢ الشرط على القارئ الحقيقي (readFv68 وreadBatteryHealthOnly) بكل توليفات الحالة × المصدر × القيمة (168) — لا بواحدة (القاعدة 30): الوسم إن وقعت الثلاثة معاً وحدها.
//   ٣ لكل العلامات: Samsung وXiaomi وGoogle وبلا كائن device ⟵ النتيجة نفسها.
//   ٤ computeCategoryStates: الوسم يُسقط B-08 من testResults وحده؛ الفئات والحروف والمشاكل والبصمات والبوّابات بلا تغيير بايتاً؛ وغير الوسم يُرمى صراحةً.
//   ٥ **المسار الكامل (القاعدة 37)**: runAnalysisInternal الحقيقية بكل ما تحتها (القارئ، categoryStates، buildV7Payload، resolveV7Report، الحارس) — يُستبدَل globalThis.fetch وحده (الشبكة) وFirestore بفخّ.
//      حمولة النموذج المُرسَلة فعلاً: B-08 غائب عنها في حالة الصفر (لا قيمة ولا حالة ولا معرّف)، وحاضر كما كان في غيرها.
//   ٦ الخامّ لا يُمسّ: lightenFingerprintForStorage تُبقي B-08 والتذييل كما شُحنا.
//   ٧ العرض (جرد هذا المستودع): لا سطح بناه الخادم يحمل B-08 (aiResult المعروض والمخزَّن).
//   ٨ البصمة: الحالة بدل الرقم؛ وسلوك signatureDifference وreevaluationDecision من رقم 0 (التنسيق القديم) إلى الحالة وعكسه — لا انجراف ولا إشارة كاذبة.
//
// Run: node functions/test/cycleCountUnsupportedZero.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m}`); n++; };
const throwsWith = (fn, re, m) => { assert.throws(fn, re, m); n++; };

// ─── الاستبدال الوحيد (القاعدة 37): الشبكة. يلتقط كل طلب نحو المزوّد ويردّ بجسم V7 سليم. Firestore: فخّ (settings 404 كالإنتاج؛ وأيّ مجموعة أخرى ترمي). ──────────────────────
const fetchCalls = [];
global.fetch = async (url, opts) => {
  fetchCalls.push({url: String(url), body: opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null});
  const {validV7ModelResponse, deepSeekHttpResponse} = require('./lib/v7ProviderStub');
  return deepSeekHttpResponse(validV7ModelResponse());
};
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: (name) => {
      if (name === 'settings') return {doc: () => ({get: async () => ({exists: false})})};
      throw new Error(`TRAP: unexpected collection "${name}"`);
    }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const N = require('../src/analysis/fv68Names');
const {readFv68, readBatteryHealthOnly} = require('../src/analysis/fv68Reader');
const {classifyCycleCount} = require('../src/analysis/cycleCountClassification');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {computeFindings} = require('../src/analysis/findings');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {toTestResult, CYCLE_COUNT_TEST_ID, EXTRA_TO_SPEC_NO_SOURCE_IN_APP} = require('../src/analysis/testKinds');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const {computeScanSignature} = require('../src/signatures/computeScanSignature');
const {signatureDifference} = require('../src/signatures/signatureDifference');
const {reevaluationDecision} = require('../src/signatures/reevaluationDecision');
const {PIPELINE_VERSION} = require('../src/signatures/constants');
const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');

const TAG = N.CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34;
const SUFFIX = '\n\nProduce the analysis JSON now.';
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEM = 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const clone = (x) => JSON.parse(JSON.stringify(x));
const load13 = () => clone(JSON.parse(fs.readFileSync(path.join(GOLDEN, `${STEM}13ch-selinux-blocked-policy.json`), 'utf8')));
const load11 = () => clone(JSON.parse(fs.readFileSync(path.join(GOLDEN, `${STEM}11ch-nothing-admitted.json`), 'utf8')));
const ABSENT = Symbol('absent'); // «المفتاح غائب» (لا undefined: القيمة الافتراضية في fingerprint() تُملأ بها)
const B08 = (rawValue) => ({testId: 'B-08', categoryName: 'battery', componentName: 'cycles', status: 'pass', rawValue, rawValueUnit: 'cycles'});

/** بصمة اختبارية من الذهبية 13ch (الحقيقية الشكل): حقول الدورات الثلاثة بالقيم المطلوبة (ABSENT = يُحذف المفتاح)، وB-08 اختيارياً. */
function fingerprint({state = 'read', source = 'extra_api34', value = 0, device, b08} = {}) {
  const p = load13();
  delete p.device.deviceProfileKey; // لا قراءة ملفّ جهاز (Firestore فخّ)
  const bh = p.timeSeries.footer.batteryHealth;
  for (const [k, v] of [[N.BATTERY_HEALTH.CYCLE_COUNT_STATE, state], [N.BATTERY_HEALTH.CYCLE_COUNT_SOURCE, source], [N.BATTERY_HEALTH.CYCLE_COUNT, value]]) {
    if (v === ABSENT) delete bh[k]; else bh[k] = v;
  }
  if (device === null) delete p.device; else if (device) p.device = {...p.device, ...device};
  if (b08 !== undefined) p.functionalResults.push(B08(b08));
  return p;
}
const classOf = (fp) => classifyCycleCount(readFv68(fp).batteryHealth.cycleCount);

// ═══════════════════════════════════════════════════════════════════════
// ١ — الوسم قيمة واحدة مُصدَّرة، بحروفه؛ ومعرّف B-08 مصدره واحد (القاعدة 24)
// ═══════════════════════════════════════════════════════════════════════
{
  eq(TAG, 'unsupported:zero_from_extra_api34', '[١] الوسم بحروفه كما في القرار');
  eq(typeof TAG, 'string', '[١] قيمة نصّية واحدة (لا كائن)');
  eq(CYCLE_COUNT_TEST_ID, 'B-08', '[١] معرّف اختبار الدورات');
  deq([...EXTRA_TO_SPEC_NO_SOURCE_IN_APP], [CYCLE_COUNT_TEST_ID], '[١] قائمة B-08 SPEC مبنيّة من المعرّف نفسه (لا نسختان)');
  // المصدر الواحد: لا نصّ حرفي للوسم ولا لـ'B-08' في كود الخادم خارج مصدره (التعليقات لا تُحتسب)
  const SRC = path.join(__dirname, '..', 'src');
  const listJs = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return (e.name === 'prompts' || e.name === 'lab') ? [] : listJs(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
  const isComment = (l) => { const t = l.trim(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };
  const hitsOf = (needle, exceptFile) => listJs(SRC).filter((f) => path.basename(f) !== exceptFile).flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/)
      .map((line, i) => ({line, i})).filter(({line}) => !isComment(line) && (line.includes(`'${needle}'`) || line.includes(`"${needle}"`) || line.includes(`\`${needle}\``)))
      .map(({i}) => `${path.relative(SRC, f)}:${i + 1}`));
  deq(hitsOf(TAG, 'fv68Names.js'), [], '[١] الوسم بنصّه الحرفي في fv68Names.js وحده');
  deq(hitsOf('B-08', 'testKinds.js'), [], "[١] 'B-08' بنصّه الحرفي في testKinds.js وحده");
  ok(hitsOf(TAG, '__none__').length === 1 && hitsOf('B-08', '__none__').length === 1, '[١] ضابط إيجابي: كلٌّ منهما في موضع واحد بالضبط في المصدر');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — الشرط على القارئ الحقيقي: كل توليفة (الحالة × المصدر × القيمة) — الوسم إن وقعت الثلاثة معاً وحدها
// ═══════════════════════════════════════════════════════════════════════
{
  const STATES = {read: 'read', notRead: 'not_read:extra_unsupported_by_device', junk: 'readx', absent: ABSENT};
  const SOURCES = {extra: 'extra_api34', sysfs: 'sysfs:/sys/class/power_supply/battery/cycle_count', unavailable: 'unavailable', junk: 'extra_api35', prefixedExtra: 'extra_api34:x', absent: ABSENT};
  const VALUES = {zero: 0, one: 1, big: 187, fraction: 0.5, string: '0', nullValue: null, absent: ABSENT};
  let combos = 0;
  let tagged = 0;
  for (const [sn, sv] of Object.entries(STATES)) {
    for (const [srcName, src] of Object.entries(SOURCES)) {
      for (const [vn, vv] of Object.entries(VALUES)) {
        const fp = fingerprint({state: sv, source: src, value: vv});
        const want = (sn === 'read' && srcName === 'extra' && vn === 'zero') ? TAG : null;
        const full = classOf(fp);
        const narrow = classifyCycleCount(readBatteryHealthOnly(fp).cycleCount);
        combos++;
        if (full === TAG) tagged++;
        eq(full, want, `[٢] readFv68: state=${sn} source=${srcName} value=${vn}`);
        eq(narrow, want, `[٢] readBatteryHealthOnly: state=${sn} source=${srcName} value=${vn}`);
      }
    }
  }
  eq(combos, 4 * 6 * 7, '[٢] عدد التوليفات المفحوصة (4 حالات × 6 مصادر × 7 قيم)');
  eq(tagged, 1, '[٢] توليفة واحدة فقط من 168 تُنتج الوسم: (read، extra_api34، 0)');
  // الثلاثة صادقة ⟵ الوسم بالقارئين، وكل شرط كاذباً وحده ⟵ لا تصنيف (بأسمائها)
  eq(classOf(fingerprint()), TAG, '[٢] الثلاثة صادقة ⟵ الوسم');
  eq(classOf(fingerprint({state: 'not_read:extra_unsupported_by_device'})), null, '[٢] الحالة وحدها كاذبة ⟵ لا تصنيف');
  eq(classOf(fingerprint({source: 'sysfs:/sys/class/power_supply/battery/cycle_count'})), null, '[٢] المصدر وحده كاذب (صفر من sysfs) ⟵ لا تصنيف');
  eq(classOf(fingerprint({value: 1})), null, '[٢] القيمة وحدها كاذبة (1 من extra_api34) ⟵ لا تصنيف');
  // الغياب (القاعدة 22): الحقل غائباً ⟵ لا تصنيف ولا «غير مدعوم»، والقارئ يُعلن الغياب بحالته
  for (const absentKey of [N.BATTERY_HEALTH.CYCLE_COUNT_STATE, N.BATTERY_HEALTH.CYCLE_COUNT_SOURCE, N.BATTERY_HEALTH.CYCLE_COUNT]) {
    const fp = fingerprint();
    delete fp.timeSeries.footer.batteryHealth[absentKey];
    const r = readFv68(fp);
    eq(classifyCycleCount(r.batteryHealth.cycleCount), null, `[٢] ${absentKey} غائب ⟵ لا تصنيف`);
    const c = r.batteryHealth.cycleCount;
    const status = absentKey === N.BATTERY_HEALTH.CYCLE_COUNT ? c.valueStatus : (absentKey === N.BATTERY_HEALTH.CYCLE_COUNT_STATE ? c.stateStatus : c.sourceStatus);
    ok(status !== N.KEY_STATUS.PRESENT, `[٢] ${absentKey} غائب: القارئ يعلن الغياب بحالته (${status}) لا قيمة`);
  }
  { // بلا batteryHealth أصلاً، وبلا تذييل، وبلا بصمة، ومُدخلات ليست كتلاً
    const noBh = fingerprint();
    delete noBh.timeSeries.footer.batteryHealth;
    eq(classOf(noBh), null, '[٢] التذييل بلا batteryHealth ⟵ لا تصنيف');
    for (const bad of [undefined, null, 0, 'x', [], {}, {value: 0}, {state: {kind: 'read'}, source: {kind: 'extra_api34'}, value: 0}]) {
      eq(classifyCycleCount(bad), null, `[٢] مُدخل ليس كتلة قارئ كاملة (${JSON.stringify(bad)}) ⟵ لا تصنيف ولا رمي`);
    }
    eq(readBatteryHealthOnly(null).cycleCount, null, '[٢] readBatteryHealthOnly(null): كتلة الدورات null لا رمي');
    eq(classifyCycleCount(readFv68(null).batteryHealth && readFv68(null).batteryHealth.cycleCount), null, '[٢] بصمة null ⟵ لا تصنيف');
  }
  // fieldsVersion 67 القديم: بلا حالة ولا مصدر بنصّ العقد الجديد ⟵ لا تصنيف حتى بصفر
  {
    const legacy = fingerprint({state: ABSENT, source: 'sysfs_cycle_count', value: 0});
    legacy.timeSeries.footer.fieldsVersion = 67;
    eq(classOf(legacy), null, '[٢] ختم 67 بمصدر القديم وصفر وبلا حالة ⟵ لا تصنيف');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — لكل العلامات: علامتان مختلفتان وأكثر ⟵ النتيجة نفسها
// ═══════════════════════════════════════════════════════════════════════
{
  const makes = [
    {manufacturer: 'samsung', model: 'SM-G991B'}, {manufacturer: 'Samsung', model: 'SM-G977B'}, {manufacturer: 'xiaomi', model: 'M2101K9AG'},
    {manufacturer: 'google', model: 'Pixel 8'}, {manufacturer: 'HONOR', model: 'MTN-NX1'}, {manufacturer: '', model: ''}, {manufacturer: 'غير معروف', model: 'X'},
  ];
  for (const d of makes) {
    eq(classOf(fingerprint({device: d})), TAG, `[٣] ${d.manufacturer || '(فارغ)'}/${d.model || '(فارغ)'} ⟵ الوسم نفسه`);
    eq(classOf(fingerprint({device: d, value: 187})), null, `[٣] ${d.manufacturer || '(فارغ)'}: 187 ⟵ لا تصنيف (الشرط لا يتغيّر بالعلامة)`);
  }
  eq(classOf(fingerprint({device: null})), TAG, '[٣] بلا كائن device أصلاً ⟵ الوسم نفسه (لا شرط على المصنّع)');
}

// ═══════════════════════════════════════════════════════════════════════
// ٤ — computeCategoryStates: الوسم يُسقط B-08 وحده؛ الباقي بلا تغيير؛ غير الوسم يُرمى صراحةً
// ═══════════════════════════════════════════════════════════════════════
{
  const fp = fingerprint({b08: '0'});
  const findings = computeFindings(fp);
  const battery = sampleInputsFromRaw(fp);
  const run = (extra) => computeCategoryStates({
    functionalResults: fp.functionalResults, manualResults: fp.manualResults, dev: null, findings,
    batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design, analyzedAtMs: 1_800_000_000_000, ...extra,
  });
  const without = run({});
  const withTag = run({cycleCountClassification: TAG});
  ok(without.testResults.some((r) => r.testId === CYCLE_COUNT_TEST_ID), '[٤] بلا وسم: B-08 في testResults (السلوك القائم)');
  ok(!withTag.testResults.some((r) => r.testId === CYCLE_COUNT_TEST_ID), '[٤] بالوسم: B-08 غائب من testResults');
  eq(withTag.testResults.length, without.testResults.length - 1, '[٤] وحده: عنصر واحد أقلّ');
  deq(withTag.testResults, without.testResults.filter((r) => r.testId !== CYCLE_COUNT_TEST_ID), '[٤] سائر الثلاثيات بلا تغيير وبالترتيب نفسه');
  for (const key of ['categories', 'overall', 'issues', 'issueSetHash', 'lettersHash', 'numbersHash', 'gates']) {
    deq(withTag[key], without[key], `[٤] ${key} بلا تغيير (B-08 SPEC، healthBearing=false)`);
  }
  for (const none of [undefined, null]) {
    deq(run({cycleCountClassification: none}), without, `[٤] cycleCountClassification=${none} ⟵ كما بلا مفتاح (لا تصنيف)`);
  }
  for (const bad of ['unsupported', 'unsupported:other', TAG.toUpperCase(), '', true, 0, {}]) {
    throwsWith(() => run({cycleCountClassification: bad}), /cycleCountClassification قيمة غير معروفة/, `[٤] قيمة غير الوسم (${JSON.stringify(bad)}) ترمي صراحةً — لا تُقرأ «لا تصنيف» ولا «غير مدعوم»`);
  }
  // B-08 بلا وسم يبقى SPEC: INFO_ONLY بقيمته (لا تغيير في تصنيفه الأصلي)
  const b08 = without.testResults.find((r) => r.testId === CYCLE_COUNT_TEST_ID);
  eq(b08.outcome, 'INFO_ONLY', '[٤] B-08 بلا وسم: SPEC كما كان');
  eq(b08.evidence, '0', '[٤] B-08 بلا وسم: قيمته كما شُحنت');
}

// ═══════════════════════════════════════════════════════════════════════
// ٥ — المسار الكامل (القاعدة 37): runAnalysisInternal الحقيقية — الشبكة وحدها مستبدَلة
// ═══════════════════════════════════════════════════════════════════════
async function viaRealChain(fp, scanId) {
  fetchCalls.length = 0;
  const saved = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  let out;
  try {
    out = await runAnalysisInternal({fingerprint: fp, language: 'ar', deepseekKey: 'not-a-real-key', geminiKey: undefined, scanContext: {scanId}, analyzedAtMs: 1_800_000_000_000});
  } finally {
    console.log = saved.log; console.warn = saved.warn; console.error = saved.error;
  }
  ok(fetchCalls.length >= 1 && fetchCalls.every((c) => c.url.includes('api.deepseek.com')), `[٥] ${scanId}: النداءات كلّها نحو مزوّد النموذج المعلوم فقط (${fetchCalls.length}) — لا مضيف آخر`);
  const user = fetchCalls[0].body.messages.find((m) => m.role === 'user').content;
  ok(user.endsWith(SUFFIX), `[٥] ${scanId}: رسالة المستخدم بالشكل المعهود`);
  const body = JSON.parse(user.slice(0, user.length - SUFFIX.length));
  return {out, user, body};
}

(async () => {
  const ZERO_CASES = [
    ['Samsung', {manufacturer: 'samsung', model: 'SM-G991B'}], ['Xiaomi', {manufacturer: 'xiaomi', model: 'M2101K9AG'}], ['بلا device', null],
  ];
  for (const [label, device] of ZERO_CASES) {
    const {out, user, body} = await viaRealChain(fingerprint({device, b08: '0'}), `zero-${label}`);
    eq(out.cycleCountClassification, TAG, `[٥] ${label}: runAnalysisInternal تُعيد الوسم`);
    ok(out.aiResult && !out.aiFailed, `[٥] ${label}: التحليل اكتمل (لا فشل صلب)`);
    eq(body.testResults.filter((t) => t.testId === 'B-08').length, 0, `[٥] ${label}: B-08 غائب عن testResults في ما أُرسل للنموذج`);
    ok(!user.includes('B-08'), `[٥] ${label}: لا معرّف B-08 في أيّ موضع من الحمولة المُرسَلة (قيمة ولا حالة ولا معرّف)`);
    ok(!user.includes('"cycles"') && !user.includes('cycleCount') && !user.includes('extra_api34'), `[٥] ${label}: لا وحدة الدورات ولا اسم حقلها ولا مصدرها في الحمولة`);
    ok(!user.includes('evaluationRulesVersion'), `[٥] ${label}: ولا ختم قواعد التقييم في الحمولة`);
    ok(!JSON.stringify(out.aiResult).includes('B-08'), `[٧] ${label}: B-08 غائب عن aiResult المعروض/المخزَّن`);
    // الخامّ لا يُمسّ (القاعدة 20): ما سيُخزَّن في reportRaw
    const lightened = lightenFingerprintForStorage(fingerprint({device, b08: '0'}));
    const rawB08 = lightened.functionalResults.find((r) => r.testId === 'B-08');
    eq(rawB08 && rawB08.rawValue, '0', `[٦] ${label}: B-08 الخامّ محفوظ كما شُحن (rawValue="0")`);
    const rawBh = lightened.timeSeries.footer.batteryHealth;
    deq([rawBh.cycleCount, rawBh.cycleCountSource, rawBh.cycleCountState], [0, 'extra_api34', 'read'], `[٦] ${label}: حقول الدورات الثلاثة في التذييل كما شُحنت`);
  }
  // الباقي: B-08 حاضر كما كان بالضبط، والتصنيف null، والحمولة هي نفسها التي كانت تُبنى
  const OTHERS = [
    ['187 من extra_api34', {value: 187}, '187'],
    ['1 من extra_api34', {value: 1}, '1'],
    ['صفر من sysfs', {source: 'sysfs:/sys/class/power_supply/battery/cycle_count', value: 0}, '0'],
    ['صفر وحالة not_read', {state: 'not_read:extra_unsupported_by_device'}, '0'],
    ['صفر من unavailable', {source: 'unavailable'}, '0'],
    ['حقول الدورات غائبة', {state: ABSENT, source: ABSENT, value: ABSENT}, 'N/A'],
  ];
  for (const [label, opts, raw] of OTHERS) {
    const fp = fingerprint({...opts, b08: raw});
    const {out, user, body} = await viaRealChain(fp, `other-${label}`);
    eq(out.cycleCountClassification, null, `[٥] ${label}: لا تصنيف`);
    const got = body.testResults.filter((t) => t.testId === 'B-08');
    eq(got.length, 1, `[٥] ${label}: B-08 حاضر في الحمولة كما اليوم`);
    const entry = B08(raw);
    const expected = {category: 'battery', raw: entry, ...toTestResult(entry, null, null, {isManual: false})};
    delete expected.unstable; // يُحذف من نسخة النموذج لكل اختبار (sanitizeTestResultsForModelPayload)
    deq(got[0], expected, `[٥] ${label}: عنصر B-08 كما يبنيه toTestResult بلا حجب ولا إسقاط (SPEC يبقى كما هو)`);
    ok(user.includes('B-08'), `[٥] ${label}: المعرّف في الحمولة`);
    ok(!JSON.stringify(out.aiResult).includes('B-08'), `[٧] ${label}: ومع حضوره في الحمولة، لا B-08 في aiResult المعروض (لا سطح عرض يحمله في هذا المستودع)`);
  }
  // الفرق الوحيد بين حمولة الصفر وحمولة نظيرتها بلا إسقاط: عنصر B-08 (بايتاً) — القياس نفسه الذي أُجري قبل/بعد الالتزام
  {
    const withB08Zero = await viaRealChain(fingerprint({b08: '0'}), 'diff-zero');
    const asIfNoB08 = await viaRealChain(fingerprint({b08: undefined}), 'diff-zero'); // scanId نفسه لتتطابق الحقول؛ B-08 لم يُرسَل أصلاً
    eq(withB08Zero.user, asIfNoB08.user, '[٥] حمولة الصفر مع B-08 الخامّ = حمولة فحص لم يُرسل B-08 أصلاً، بايتاً بايتاً (الإسقاط لا يترك أثراً آخر)');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ٨ — البصمة: الحالة بدل الرقم؛ وسلوك signatureDifference وreevaluationDecision من رقم 0 إلى الحالة
  // ═════════════════════════════════════════════════════════════════════
  {
    const sigZero = computeScanSignature(fingerprint());
    eq(sigZero.battery.cycleCount, null, '[٨] صفر extra_api34: sig.battery.cycleCount = null (لا الرقم 0)');
    eq(sigZero.battery.cycleCountClassification, TAG, '[٨] والحالة محفوظة بالوسم');
    for (const [label, opts, wantNumber] of [['187 من extra', {value: 187}, 187], ['1 من extra', {value: 1}, 1], ['صفر من sysfs', {source: 'sysfs:/sys/class/power_supply/battery/cycle_count', value: 0}, 0],
      ['صفر وحالة not_read', {state: 'not_read:extra_unsupported_by_device'}, 0], ['صفر من unavailable', {source: 'unavailable'}, 0]]) {
      const sig = computeScanSignature(fingerprint(opts));
      eq(sig.battery.cycleCount, wantNumber, `[٨] ${label}: الرقم كما كان في البصمة`);
      ok(!Object.prototype.hasOwnProperty.call(sig.battery, 'cycleCountClassification'), `[٨] ${label}: لا مفتاح تصنيف (البصمة كما كانت بايتاً)`);
    }
    {
      const absent = fingerprint({state: ABSENT, source: ABSENT, value: ABSENT});
      const sig = computeScanSignature(absent);
      eq(sig.battery.cycleCount, null, '[٨] الحقول غائبة: null كما كان');
      ok(!Object.prototype.hasOwnProperty.call(sig.battery, 'cycleCountClassification'), '[٨] الحقول غائبة: لا مفتاح تصنيف');
    }
    eq(sigZero.pipelineVersion, PIPELINE_VERSION, '[٨] PIPELINE_VERSION هو المستورَد نفسه');
    eq(PIPELINE_VERSION, 'v4-2026-09-24-decision-76-3', '[٨] PIPELINE_VERSION لم يُرفع (قرار المستخدم: ختم القواعد لا رفعه)');

    // البصمة السابقة (تنسيق ما قبل القرار) = رقم 0؛ والجديدة = الحالة
    const oldFormat = clone(sigZero);
    oldFormat.battery.cycleCount = 0;
    delete oldFormat.battery.cycleCountClassification;
    eq(oldFormat.battery.cycleCount, 0, '[٨] (ضابط) البصمة القديمة تحمل الرقم 0');
    eq(signatureDifference(sigZero, oldFormat), 0, '[٨] signatureDifference(الجديدة، القديمة 0) = 0: لا انجراف');
    eq(signatureDifference(oldFormat, sigZero), 0, '[٨] وعكسها = 0');
    deq(Object.keys(sigZero.verification), Object.keys(oldFormat.verification), '[٨] ولا مفتاح تحقّق جديد يدخل المقارنة');
    for (const [a, b, label] of [[sigZero, oldFormat, 'الجديدة ثمّ القديمة'], [oldFormat, sigZero, 'القديمة ثمّ الجديدة']]) {
      const d = reevaluationDecision(a, b);
      eq(d.forceReevaluate, false, `[٨] reevaluationDecision(${label}): لا إعادة تقييم قسرية`);
      deq(d.reasons, [], `[٨] reevaluationDecision(${label}): لا سبب («battery:cycleCount» ولا غيره) — لا إشارة بطارية مستبدَلة كاذبة`);
      eq(d.maintenanceSuspected, false, `[٨] reevaluationDecision(${label}): ولا اشتباه صيانة`);
    }
    // الجديدة مع نفسها
    eq(signatureDifference(sigZero, computeScanSignature(fingerprint())), 0, '[٨] بصمتان جديدتان لفحصين صفريين: لا فرق');
    deq(reevaluationDecision(sigZero, computeScanSignature(fingerprint())).reasons, [], '[٨] ولا سبب');
    // تحوّل لاحق إلى قراءة حقيقية من جهاز نفسه (بعد تحديث نظام مثلاً): السابقة بالحالة ⟵ لا «قفزة +N» (كانت 0 ⟵ N قفزة كاذبة)
    const later = computeScanSignature(fingerprint({value: 300}));
    eq(later.battery.cycleCount, 300, '[٨] قراءة حقيقية لاحقة (300) تُحفظ رقماً');
    deq(reevaluationDecision(later, sigZero).reasons, [], '[٨] السابقة «غير مدعوم» ثمّ 300: لا إشارة «battery:cycleCount +300» (لا سابق رقمياً يُقارَن به)');
  }

  console.log(`\ncycleCountUnsupportedZero.test.js: ${n} assertions passed`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});

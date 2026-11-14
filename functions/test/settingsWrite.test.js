'use strict';

// settingsWrite.test.js — التحقّق من رقعة إعدادات البروتوكول ودمجها (S-P6-14، 2026-10-21 +03). وحدة بلا شبكة ولا محاكٍ؛ الكتابة الحقيقية (معاملة + history) في protocolAdmin.e2e.test.js.
//
// المواصفة: PLAN-06 §٦-ب-١ (:767-793) وdocs/PROTOCOL_CONTRACT.md §٢ A10: «تتحقّق من المدى، وترفع version، وتحفظ السابقة في history». الدوالّ نقيّة (القاعدة 41).
// **القيم المتوقَّعة حرفيّات هنا عمداً** (مرجع مستقلّ عن الوحدة).
//   ١ validateSettingsPatch: كل حقل بكل قيمه (الحدّان داخلان، وكل نوع خاطئ)، والمفاتيح المجهولة، والمعلّقان (symptomChips وtargets)، ولا مسح (null/undefined)
//   ٢ returnReasons: الشكل الكامل، التفرّد، النصّان، الحدود، وتشذيب النصوص
//   ٣ applySettingsPatch: الدمج، وما تغيّر فعلاً (مقارنة قانونية لا تتأثّر بترتيب المفاتيح)، و«الإيقاف بدل الحذف» (مفتاح محفوظ لا يُحذف)، وعدم تعديل المدخلات
//   ٤ الردود: لكل رمز ردّ، لا نصّ عربي جديد
//   ٥ بنية الشيفرة: لا I/O ولا حذف، لا حرفيّة اسم حقل مكرَّرة خارج المصدر
//
// Run: node functions/test/settingsWrite.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const W = require('../src/protocol/settingsWrite');
const {SETTINGS_FIELD} = require('../src/protocol/protocolSettings');

const val = (patch) => W.validateSettingsPatch(patch);
const refusal = (patch) => { const r = val(patch); return r.ok ? null : [r.refusal, r.field || null, r.extra || '']; };

// ═══ ١ — validateSettingsPatch ═══
{
  for (const bad of [undefined, null, 5, 'x', [], [{repeatRate: 0.1}], {}]) {
    deq(refusal(bad), ['SETTINGS_PATCH_REQUIRED', null, ''], `[١] settings ${JSON.stringify(bad)} ⟵ SETTINGS_PATCH_REQUIRED`);
  }
  deq(refusal({repeatRate: 0.1, zzz: 1}), ['SETTINGS_FIELD_UNKNOWN', 'zzz', ' field=zzz'], '[١] مفتاح مجهول ⟵ SETTINGS_FIELD_UNKNOWN بتسمية الحقل (يسبق التحقّق من القيم)');
  deq(refusal({version: 9}), ['SETTINGS_FIELD_UNKNOWN', 'version', ' field=version'], '[١] version ليس حقلاً يُكتب من العميل');
  deq(refusal({updatedAt: 1}), ['SETTINGS_FIELD_UNKNOWN', 'updatedAt', ' field=updatedAt'], '[١] ولا updatedAt');
  deq(refusal({symptomChips: ['battery_swollen']}), ['SETTINGS_FIELD_NOT_SPECIFIED', 'symptomChips', ' field=symptomChips'], '[١] symptomChips معلّق: مواصفة غائبة ⟵ SETTINGS_FIELD_NOT_SPECIFIED');
  deq(refusal({targets: {a: 1}}), ['SETTINGS_FIELD_NOT_SPECIFIED', 'targets', ' field=targets'], '[١] targets معلّق');
  deq(refusal({symptomChips: [], repeatRate: 5}), ['SETTINGS_FIELD_NOT_SPECIFIED', 'symptomChips', ' field=symptomChips'], '[١] المعلّق يسبق خطأ قيمة حقل آخر');
  deq([...W.SETTINGS_FIELDS_NOT_SPECIFIED].sort(), ['symptomChips', 'targets'], '[١] الحقلان المعلّقان');
  deq([...W.SETTINGS_WRITABLE_FIELDS].sort(), ['blindnessAlertBelowPct', 'collectionPhase', 'doubleEvalRate', 'minAppVersion', 'openBeforeValidityHours', 'repeatRate', 'returnReasons'], '[١] الحقول السبعة المقبولة');
  deq([...W.SETTINGS_WRITABLE_FIELDS, ...W.SETTINGS_FIELDS_NOT_SPECIFIED].sort(), Object.values(SETTINGS_FIELD).sort(), '[١] المقبولة + المعلّقة = كل SETTINGS_FIELD (لا حقل بلا حكم)');
  // لا مسح
  for (const f of W.SETTINGS_WRITABLE_FIELDS) {
    for (const v of [null, undefined]) deq(refusal({[f]: v}), ['SETTINGS_FIELD_INVALID', f, ` field=${f} cause=CANNOT_CLEAR`], `[١] ${f} = ${v} ⟵ CANNOT_CLEAR (لا مسح لحقل: القاعدة 42)`);
  }
  // النسب
  for (const f of ['repeatRate', 'doubleEvalRate']) {
    for (const v of [0, 0.05, 0.25, 0.3, 0.9999, 1]) deq(val({[f]: v}), {ok: true, values: {[f]: v}}, `[١] ${f} = ${v} صالحة (الحدّان 0 و1 داخلان)`);
    for (const [v, cause] of [[-0.0001, 'OUT_OF_RANGE'], [1.0001, 'OUT_OF_RANGE'], [25, 'OUT_OF_RANGE'], ['0.25', 'NOT_A_FINITE_NUMBER'], [NaN, 'NOT_A_FINITE_NUMBER'], [Infinity, 'NOT_A_FINITE_NUMBER'], [true, 'NOT_A_FINITE_NUMBER'], [{}, 'NOT_A_FINITE_NUMBER'], [[0.1], 'NOT_A_FINITE_NUMBER'], ['', 'NOT_A_FINITE_NUMBER']]) {
      deq(refusal({[f]: v}), ['SETTINGS_FIELD_INVALID', f, ` field=${f} cause=${cause}`], `[١] ${f} = ${JSON.stringify(v)} ⟵ ${cause}`);
    }
  }
  // الساعات
  for (const v of [1, 24, 168, 8760]) deq(val({openBeforeValidityHours: v}), {ok: true, values: {openBeforeValidityHours: v}}, `[١] openBeforeValidityHours = ${v} صالحة (الحدّان 1 و8760 داخلان)`);
  for (const [v, cause] of [[0, 'OUT_OF_RANGE'], [-1, 'OUT_OF_RANGE'], [8761, 'OUT_OF_RANGE'], [1.5, 'NOT_AN_INTEGER'], [168.0001, 'NOT_AN_INTEGER'], ['168', 'NOT_A_FINITE_NUMBER'], [NaN, 'NOT_A_FINITE_NUMBER']]) {
    deq(refusal({openBeforeValidityHours: v}), ['SETTINGS_FIELD_INVALID', 'openBeforeValidityHours', ` field=openBeforeValidityHours cause=${cause}`], `[١] openBeforeValidityHours = ${JSON.stringify(v)} ⟵ ${cause}`);
  }
  // العمى
  for (const v of [0, 50, 80, 99.5, 100]) deq(val({blindnessAlertBelowPct: v}), {ok: true, values: {blindnessAlertBelowPct: v}}, `[١] blindnessAlertBelowPct = ${v} صالحة (الحدّان داخلان)`);
  for (const [v, cause] of [[-1, 'OUT_OF_RANGE'], [100.5, 'OUT_OF_RANGE'], ['80', 'NOT_A_FINITE_NUMBER']]) {
    deq(refusal({blindnessAlertBelowPct: v}), ['SETTINGS_FIELD_INVALID', 'blindnessAlertBelowPct', ` field=blindnessAlertBelowPct cause=${cause}`], `[١] blindnessAlertBelowPct = ${JSON.stringify(v)} ⟵ ${cause}`);
  }
  // مرحلة الجمع
  for (const v of [true, false]) deq(val({collectionPhase: v}), {ok: true, values: {collectionPhase: v}}, `[١] collectionPhase = ${v}`);
  for (const v of ['true', 'false', 1, 0, {}, [], 'yes']) deq(refusal({collectionPhase: v}), ['SETTINGS_FIELD_INVALID', 'collectionPhase', ' field=collectionPhase cause=NOT_A_BOOLEAN'], `[١] collectionPhase = ${JSON.stringify(v)} ليست منطقية ⟵ NOT_A_BOOLEAN`);
  // الإصدار الأدنى
  for (const v of ['1.0', '1.0.14', '1.0.8-v6beta', '12.34.56.78', '1.0.14+build.5']) deq(val({minAppVersion: v}), {ok: true, values: {minAppVersion: v}}, `[١] minAppVersion = ${v} صالحة`);
  for (const [v, cause] of [['', 'FORMAT_INVALID'], [' 1.0.14', 'FORMAT_INVALID'], ['1.0.14 ', 'FORMAT_INVALID'], ['1', 'FORMAT_INVALID'], ['v1.0.14', 'FORMAT_INVALID'], ['1.0.14.1.2', 'FORMAT_INVALID'], ['1..0', 'FORMAT_INVALID'], ['1.0.' + 'x'.repeat(40), 'FORMAT_INVALID'], [1.014, 'NOT_A_STRING'], [null, 'CANNOT_CLEAR']]) {
    deq(refusal({minAppVersion: v}), ['SETTINGS_FIELD_INVALID', 'minAppVersion', ` field=minAppVersion cause=${cause}`], `[١] minAppVersion = ${JSON.stringify(v)} ⟵ ${cause}`);
  }
  // الرقعة الجزئية تعيد ما كُتب وحده
  deq(val({repeatRate: 0.25, collectionPhase: true}), {ok: true, values: {repeatRate: 0.25, collectionPhase: true}}, '[١] رقعة جزئية: القيم المكتوبة وحدها (لا افتراضي لغيرها)');
  // ترتيب الرفض: أوّل حقل خاطئ بترتيب SETTINGS_WRITABLE_FIELDS لا بترتيب مفاتيح الرقعة
  deq(refusal({minAppVersion: 'bad', repeatRate: 7}), ['SETTINGS_FIELD_INVALID', 'repeatRate', ' field=repeatRate cause=OUT_OF_RANGE'], '[١] أوّل خطأ بترتيب العقد (repeatRate قبل minAppVersion) لا بترتيب مفاتيح الرقعة');
  // حدود getProtocolSettings تساوي ما يُطبَّق
  deq(W.SETTINGS_LIMITS.rate, {min: 0, max: 1}, '[١] حدّ النسب المعلَن');
  deq(W.SETTINGS_LIMITS.openBeforeValidityHours, {min: 1, max: 8760, integer: true}, '[١] حدّ الساعات المعلَن');
  deq(W.SETTINGS_LIMITS.blindnessAlertBelowPct, {min: 0, max: 100}, '[١] حدّ العمى المعلَن');
  ok(Object.isFrozen(W.SETTINGS_LIMITS) && Object.isFrozen(W.SETTINGS_LIMITS.rate) && Object.isFrozen(W.SETTINGS_LIMITS.returnReasons), '[١] الحدود مجمَّدة');
}

// ═══ ٢ — returnReasons ═══
const RR = (extra = {}) => ({key: 'late_complaint', ar: 'نصّ اختبار عربي', tr: 'test metni', active: true, ...extra});
{
  const good = val({returnReasons: [RR(), RR({key: 'another_reason', active: false})]});
  deq(good, {ok: true, values: {returnReasons: [{key: 'late_complaint', ar: 'نصّ اختبار عربي', tr: 'test metni', active: true}, {key: 'another_reason', ar: 'نصّ اختبار عربي', tr: 'test metni', active: false}]}}, '[٢] قائمة صالحة بعنصرين');
  deq(val({returnReasons: []}), {ok: true, values: {returnReasons: []}}, '[٢] قائمة فارغة صالحة (لا أسباب: الجزء returns غير مفعَّل: E17)');
  deq(val({returnReasons: [RR({ar: '  نصّ  ', tr: '  metin  '})]}).values.returnReasons[0], {key: 'late_complaint', ar: 'نصّ', tr: 'metin', active: true}, '[٢] النصّان يُشذَّبان');
  deq(Object.keys(val({returnReasons: [{active: true, tr: 'a', ar: 'b', key: 'k'}]}).values.returnReasons[0]), ['key', 'ar', 'tr', 'active'], '[٢] ترتيب مفاتيح العنصر ثابت (key, ar, tr, active)');
  const cause = (list) => refusal({returnReasons: list});
  const bad = (c) => ['SETTINGS_FIELD_INVALID', 'returnReasons', ` field=returnReasons cause=${c}`];
  for (const v of ['x', 5, {}, true]) deq(cause(v), bad('NOT_AN_ARRAY'), `[٢] ${JSON.stringify(v)} ليست مصفوفة`);
  deq(cause(Array.from({length: 51}, (_, i) => RR({key: `k${i}`}))), bad('TOO_MANY_ENTRIES'), '[٢] 51 عنصراً ⟵ TOO_MANY_ENTRIES');
  eq(val({returnReasons: Array.from({length: 50}, (_, i) => RR({key: `k${i}`}))}).ok, true, '[٢] 50 عنصراً صالحة (الحدّ داخل)');
  for (const v of [null, 'x', 5, [], undefined]) deq(cause([v]), bad('ENTRY_NOT_AN_OBJECT'), `[٢] عنصر ${JSON.stringify(v)} ليس كائناً`);
  deq(cause([RR({extra: 1})]), bad('ENTRY_UNKNOWN_KEY'), '[٢] مفتاح غريب في العنصر');
  for (const k of ['', 'Late', 'late-complaint', '1late', '_late', 'a'.repeat(41), 'عربي', 5, null, undefined]) deq(cause([RR({key: k})]), bad('KEY_INVALID'), `[٢] المفتاح ${JSON.stringify(k)} ⟵ KEY_INVALID`);
  eq(val({returnReasons: [RR({key: 'a'.repeat(40)})]}).ok, true, '[٢] مفتاح 40 حرفاً صالح (الحدّ داخل)');
  eq(val({returnReasons: [RR({key: 'a'})]}).ok, true, '[٢] مفتاح حرف واحد صالح');
  deq(cause([RR(), RR({ar: 'غيره'})]), bad('KEY_DUPLICATE'), '[٢] مفتاح مكرَّر');
  for (const lang of ['ar', 'tr']) {
    for (const v of [undefined, null, '', '   ', 5, 'x'.repeat(121)]) deq(cause([RR({[lang]: v})]), bad(`${lang.toUpperCase()}_INVALID`), `[٢] ${lang} = ${String(JSON.stringify(v)).slice(0, 12)} ⟵ ${lang.toUpperCase()}_INVALID`);
    eq(val({returnReasons: [RR({[lang]: 'x'.repeat(120)})]}).ok, true, `[٢] ${lang} بطول 120 صالح (الحدّ داخل)`);
  }
  for (const v of [undefined, null, 'true', 1, 0]) deq(cause([RR({active: v})]), bad('ACTIVE_NOT_BOOLEAN'), `[٢] active ${JSON.stringify(v)} ⟵ ACTIVE_NOT_BOOLEAN`);
  // المدخل لا يُعدَّل
  const input = [RR({ar: '  x  '})];
  val({returnReasons: input});
  deq(input, [RR({ar: '  x  '})], '[٢] لا تعدّل مدخلاتها');
}

// ═══ ٣ — applySettingsPatch ═══
{
  const apply = (current, patch) => W.applySettingsPatch({current, values: val(patch).values});
  // أوّل كتابة: كل حقول الرقعة تغيّرت
  const first = apply(null, {repeatRate: 0.25, collectionPhase: true});
  deq([first.ok, first.next, first.changed], [true, {repeatRate: 0.25, collectionPhase: true}, ['repeatRate', 'collectionPhase']], '[٣] أوّل كتابة: next = الرقعة وكل حقولها متغيّرة');
  // الدمج: ما لم تمسّه الرقعة يبقى، وحقول المستند الأخرى (version وupdatedAt وغيرها) تبقى لا تضيع
  const cur = {version: 3, updatedBy: '#abc', repeatRate: 0.25, collectionPhase: true, extraFromConsole: 'x'};
  const merged = apply(cur, {repeatRate: 0.1});
  deq([merged.ok, merged.next, merged.changed], [true, {version: 3, updatedBy: '#abc', repeatRate: 0.1, collectionPhase: true, extraFromConsole: 'x'}, ['repeatRate']], '[٣] الدمج: حقل واحد تغيّر والباقي (ومنه ما كتبته وحدة التحكّم) باقٍ');
  deq(apply(cur, {repeatRate: 0.25, collectionPhase: true}).changed, [], '[٣] القيم نفسها ⟵ لا تغيّر');
  deq(apply(cur, {repeatRate: 0.25, doubleEvalRate: 0.1}).changed, ['doubleEvalRate'], '[٣] حقل جديد غائب سابقاً ⟵ يتغيّر (والمكرَّر لا)');
  // 0 ليس غياباً
  deq(apply({version: 1}, {repeatRate: 0}).changed, ['repeatRate'], '[٣] 0 قيمة (تُكتب) لا غياب');
  deq(apply({version: 1, repeatRate: 0}, {repeatRate: 0}).changed, [], '[٣] 0 بـ0 لا تغيّر');
  // مقارنة قانونية لقائمة المرتجع: ترتيب مفاتيح العنصر المخزَّن لا يغيّر الحكم
  const stored = {version: 2, returnReasons: [{tr: 'test metni', active: true, ar: 'نصّ اختبار عربي', key: 'late_complaint'}]};
  deq(apply(stored, {returnReasons: [RR()]}).changed, [], '[٣] قائمة بالمحتوى نفسه بترتيب مفاتيح مختلف ⟵ لا تغيّر');
  deq(apply(stored, {returnReasons: [RR({active: false})]}).changed, ['returnReasons'], '[٣] الإيقاف (active false) ⟵ تغيّر');
  deq(apply(stored, {returnReasons: [RR({ar: 'نصّ جديد'})]}).changed, ['returnReasons'], '[٣] تعديل النصّ مع بقاء المفتاح ⟵ تغيّر');
  // الإيقاف بدل الحذف
  const two = {version: 2, returnReasons: [RR(), RR({key: 'second'})]};
  const removed = apply(two, {returnReasons: [RR()]});
  deq([removed.ok, removed.refusal, removed.field, removed.extra], [false, 'SETTINGS_RETURN_REASON_KEY_REMOVED', 'returnReasons', ' field=returnReasons cause=KEY_REMOVED'], '[٣] حذف مفتاح محفوظ ⟵ SETTINGS_RETURN_REASON_KEY_REMOVED (الإيقاف بدل الحذف)');
  eq(apply(two, {returnReasons: [RR({key: 'second', active: false}), RR()]}).ok, true, '[٣] إيقاف مفتاح مع بقائه (ولو بترتيب مختلف) مقبول');
  eq(apply(two, {returnReasons: [RR(), RR({key: 'second'}), RR({key: 'third'})]}).ok, true, '[٣] إضافة مفتاح جديد مقبولة');
  eq(apply(two, {returnReasons: []}).ok, false, '[٣] تفريغ القائمة حذف لكل المفاتيح ⟵ مرفوض');
  eq(apply({version: 1}, {returnReasons: []}).ok, true, '[٣] وأوّل قائمة (بلا سابقة) تكون فارغة مقبولة');
  eq(apply({version: 1, returnReasons: 'garbage'}, {returnReasons: [RR()]}).ok, true, '[٣] قائمة محفوظة مشوَّهة ليست مصفوفة: لا مفاتيح محفوظة تُحرس');
  eq(apply({version: 1, returnReasons: [null, 5, {nokey: 1}, RR()]}, {returnReasons: [RR()]}).ok, true, '[٣] عناصر مشوَّهة في المحفوظ لا تُعامَل مفاتيح (والمفتاح السليم باقٍ)');
  // رقعة لا تمسّ returnReasons لا تفحصها
  eq(apply(two, {repeatRate: 0.2}).ok, true, '[٣] رقعة بلا returnReasons لا تُفحَص بالاستمرارية');
  // لا تعدّل مدخلاتها
  const before = JSON.parse(JSON.stringify(cur));
  apply(cur, {repeatRate: 0.9});
  deq(cur, before, '[٣] لا تعدّل المستند الحاضر');
  // canonical
  eq(W.canonical({b: 1, a: [2, {d: 1, c: 2}]}), W.canonical({a: [2, {c: 2, d: 1}], b: 1}), '[٣] canonical: ترتيب المفاتيح لا يؤثّر');
  ok(W.canonical([1, 2]) !== W.canonical([2, 1]), '[٣] canonical: ترتيب المصفوفة يؤثّر');
  ok(W.canonical(0) !== W.canonical(null) && W.canonical(false) !== W.canonical(null), '[٣] canonical: 0 وfalse ليسا null');
}

// ═══ ٤ — الردود ═══
{
  const codes = Object.values(W.SETTINGS_WRITE_REFUSAL);
  deq(Object.keys(W.REFUSAL_RESPONSE).sort(), [...codes].sort(), '[٤] لكل رمز رفض ردّ، ولا ردّ بلا رمز');
  for (const [reason, spec] of Object.entries(W.REFUSAL_RESPONSE)) {
    deq(Object.keys(spec).sort(), ['clientReasonCode', 'code', 'message'], `[٤] ${reason}: ردّ بثلاثة مفاتيح`);
    eq(spec.message, reason, `[٤] ${reason}: الرسالة رمزه التقني (لا نصّ عربي جديد: القرار ٩٠)`);
    eq(spec.clientReasonCode, reason, `[٤] ${reason}: يصل العميل بالرمز نفسه`);
    ok(['invalid-argument', 'failed-precondition'].includes(spec.code), `[٤] ${reason}: رمز HttpsError معروف (${spec.code})`);
  }
  ok(Object.isFrozen(W.SETTINGS_WRITE_REFUSAL) && Object.isFrozen(W.REFUSAL_RESPONSE), '[٤] مجمَّدان');
}

// ═══ ٥ — بنية الشيفرة ═══
{
  const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  const code = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol', 'settingsWrite.js'), 'utf8'));
  deq([...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]), ['./protocolSettings'], '[٥] مستورد واحد نقيّ (لا Firestore ولا admin)');
  ok(!/\.delete\(|FieldValue|recursiveDelete|bulkWriter|\.batch\(|collection\(|\.doc\(|runTransaction|\.where\(|Math\.random/.test(code), '[٥] لا قراءة Firestore ولا كتابة ولا حذف ولا استعلام (القاعدة 42/43؛ الدالّة نقيّة)');
  ok(!/["'`](repeatRate|doubleEvalRate|openBeforeValidityHours|collectionPhase|blindnessAlertBelowPct|returnReasons|symptomChips|targets|minAppVersion)["'`]/.test(code), '[٥] لا اسم حقل حرفياً: كلّها من SETTINGS_FIELD (مصدر واحد: القاعدة 24)');
}

console.log(`\nsettingsWrite.test.js: ${n}/${n} assertions passed`);

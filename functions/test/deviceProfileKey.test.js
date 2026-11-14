'use strict';

// deviceProfileKey.test.js — المُطبِّع الواحد لمفتاح الجهاز (V8 قبل نشر الأمان، 2026-10-09 +03). وحدة بلا شبكة ولا محاكٍ.
//
// قرار المستخدم (بنصّه): «القراءة المتوافقة للاسمين (deviceProfileKey.a وprimary معاً) تدخل نشر الأمان هذا، بنداً رابعاً لوكيل الخادم،
// مع اختبار على الحمولتين.» والمسار الحقيقي على المعالج (analyzeDevice على المحاكي): deviceProfileKeyShapes.e2e.test.js.
//   ١ — الأسماء: نسخة مستقلّة من نصّ الأمر = ما في المُطبِّع = جدول العقد §١١ (لا تدور الشيفرة على نفسها).
//   ٢ — جدول حمولات: كل شكل (FULL_NAMES · R8_SHORT_NAMES · MIXED_FORMS · BOTH_FORMS_AGREE · BOTH_FORMS_CONFLICT · UNRECOGNIZED · NOT_AN_OBJECT · ABSENT)
//       وغياب الأساسي وعدم صلاحه والطبقات الغائبة، بما يُرجعه المُطبِّع: الشكل، وقابلية الاستعمال، والسبب، والقيم، وما لم يجده.
//   ٣ — الحمولتان الحقيقيتان: الأسماء الكاملة (عيّنة fv67 الذهبية) وحمولة R8 (المشتقّة منها بالأسماء المنقولة).
//   ٤ — حارس بنيوي على src: لا قراءة مباشرة لـ.a/.primary/.layerX خارج المُطبِّع، وكل قارئ حيّ يستورده، وقائمة القرّاء مثبَّتة (قارئ جديد يُفشل).
//
// Run: node functions/test/deviceProfileKey.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const D = require('../src/profiles/deviceProfileKey');
const {SHAPE, UNUSABLE_REASON: U, normalizeDeviceProfileKey: norm, describeDeviceProfileKey: describe} = D;

// ═══════════════════════════════════════════════════════════════════
// ١ — الأسماء: نسخة مستقلّة (منقولة من نصّ الأمر، غير متحقَّقة من التطبيق) = المُطبِّع = جدول العقد
// ═══════════════════════════════════════════════════════════════════
const ORDER_MAPPING = Object.freeze({primary: 'a', layerA_keystore: 'b', layerB_firebaseId: 'c', layerC_androidId: 'd', layerD_buildSig: 'e', layerE_sensorSig: 'f'});
deq(Object.fromEntries(D.FIELDS.map((f) => [f.full, f.short])), {...ORDER_MAPPING}, '[١] أسماء المُطبِّع = النسخة المستقلّة المنقولة من نصّ الأمر (primary→a … layerE_sensorSig→f)');
const contract = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'V7_DISPLAY_SHAPE_CONTRACT.md'), 'utf8').replace(/\r\n/g, '\n');
const section11 = contract.slice(contract.indexOf('## ١١ ·'), contract.indexOf('## ١٢'));
const contractRows = [...section11.matchAll(/^\| `(\w+)` \| `([a-f])` \|$/gm)].map((m) => [m[1], m[2]]);
deq(Object.fromEntries(contractRows), {...ORDER_MAPPING}, '[١] جدول العقد §١١ (docs/V7_DISPLAY_SHAPE_CONTRACT.md) = نفس الأسماء الستّة');
ok(Object.isFrozen(D.FIELDS) && Object.isFrozen(SHAPE) && Object.isFrozen(U), '[١] الجداول مجمَّدة');
for (const [k, v] of Object.entries(SHAPE)) eq(v, k, `[١] قيمة الشكل ${k} = اسمه`);
for (const [k, v] of Object.entries(U)) eq(v, k, `[١] قيمة السبب ${k} = اسمه`);
eq(D.UNKNOWN_PRIMARY, 'unknown_fp', '[١] قيمة الأساسي الاحتياطي التي يرسلها التطبيق');

// ═══════════════════════════════════════════════════════════════════
// ٢ — جدول الحمولات
// ═══════════════════════════════════════════════════════════════════
const FULL = {primary: 'P', layerA_keystore: 'KA', layerB_firebaseId: 'FB', layerC_androidId: 'AC', layerD_buildSig: 'SD', layerE_sensorSig: 'SE'};
const R8 = {a: 'P', b: 'KA', c: 'FB', d: 'AC', e: 'SD', f: 'SE'};
const KEY = {...FULL}; // المفتاح المُطبَّع المنتظر للحمولات الكاملة الصحيحة
const NULL_LAYERS = {layerA_keystore: null, layerB_firebaseId: null, layerC_androidId: null, layerD_buildSig: null, layerE_sensorSig: null};
const ALL_FULL = ['primary', 'layerA_keystore', 'layerB_firebaseId', 'layerC_androidId', 'layerD_buildSig', 'layerE_sensorSig'];
const ROWS = [
  // [label, raw, {shape, usable, reason, key, missing, invalid, conflicts}]
  ['أسماء كاملة', FULL, {shape: SHAPE.FULL_NAMES, usable: true, reason: null, key: KEY, missing: [], invalid: [], conflicts: []}],
  ['أسماء R8 a..f', R8, {shape: SHAPE.R8_SHORT_NAMES, usable: true, reason: null, key: KEY, missing: [], invalid: [], conflicts: []}],
  ['الشكلان معاً بالقيم نفسها', {...FULL, ...R8}, {shape: SHAPE.BOTH_FORMS_AGREE, usable: true, reason: null, key: KEY, missing: [], invalid: [], conflicts: []}],
  ['الشكلان معاً، حقل واحد مذكور بالاسمين بقيمة واحدة والباقي موزّع', {primary: 'P', a: 'P', b: 'KA', layerB_firebaseId: 'FB'},
    {shape: SHAPE.BOTH_FORMS_AGREE, usable: true, reason: null, key: {...KEY, layerC_androidId: null, layerD_buildSig: null, layerE_sensorSig: null}, missing: ['layerC_androidId', 'layerD_buildSig', 'layerE_sensorSig'], invalid: [], conflicts: []}],
  ['مختلط: a + طبقات بالأسماء الكاملة (شكل اختبارات قائمة)', {a: 'P', layerA_keystore: 'KA', layerB_firebaseId: 'FB', layerC_androidId: 'AC', layerD_buildSig: 'SD', layerE_sensorSig: 'SE'},
    {shape: SHAPE.MIXED_FORMS, usable: true, reason: null, key: KEY, missing: [], invalid: [], conflicts: []}],
  ['مختلط: primary + b..f', {primary: 'P', b: 'KA', c: 'FB', d: 'AC', e: 'SD', f: 'SE'}, {shape: SHAPE.MIXED_FORMS, usable: true, reason: null, key: KEY, missing: [], invalid: [], conflicts: []}],
  ['تعارض في الأساسي (a ≠ primary)', {...FULL, ...R8, a: 'OTHER'}, {shape: SHAPE.BOTH_FORMS_CONFLICT, usable: false, reason: U.FORMS_CONFLICT, key: null, missing: [], invalid: [], conflicts: ['primary']}],
  ['تعارض في طبقة فقط (الأساسي متّفق)', {...FULL, ...R8, c: 'OTHER-FB'}, {shape: SHAPE.BOTH_FORMS_CONFLICT, usable: false, reason: U.FORMS_CONFLICT, key: null, missing: [], invalid: [], conflicts: ['layerB_firebaseId']}],
  ['تعارضان', {...FULL, ...R8, a: 'X', f: 'Y'}, {shape: SHAPE.BOTH_FORMS_CONFLICT, usable: false, reason: U.FORMS_CONFLICT, key: null, missing: [], invalid: [], conflicts: ['primary', 'layerE_sensorSig']}],
  ['R8 بالأساسي وحده (الطبقات غائبة)', {a: 'P'}, {shape: SHAPE.R8_SHORT_NAMES, usable: true, reason: null, key: {primary: 'P', ...NULL_LAYERS}, missing: ALL_FULL.slice(1), invalid: [], conflicts: []}],
  ['أسماء كاملة بالأساسي وحده', {primary: 'P'}, {shape: SHAPE.FULL_NAMES, usable: true, reason: null, key: {primary: 'P', ...NULL_LAYERS}, missing: ALL_FULL.slice(1), invalid: [], conflicts: []}],
  ['الأساسي غائب (طبقات فقط، R8)', {b: 'KA', c: 'FB'}, {shape: SHAPE.R8_SHORT_NAMES, usable: false, reason: U.PRIMARY_MISSING, key: null, missing: ['primary', 'layerC_androidId', 'layerD_buildSig', 'layerE_sensorSig'], invalid: [], conflicts: []}],
  ['الأساسي غائب (طبقات فقط، كاملة)', {layerA_keystore: 'KA'}, {shape: SHAPE.FULL_NAMES, usable: false, reason: U.PRIMARY_MISSING, key: null, missing: ['primary', 'layerB_firebaseId', 'layerC_androidId', 'layerD_buildSig', 'layerE_sensorSig'], invalid: [], conflicts: []}],
  ['الأساسي رقم', {...R8, a: 12345}, {shape: SHAPE.R8_SHORT_NAMES, usable: false, reason: U.PRIMARY_INVALID, key: null, missing: [], invalid: ['primary'], conflicts: []}],
  ['الأساسي فراغ', {...FULL, primary: '   '}, {shape: SHAPE.FULL_NAMES, usable: false, reason: U.PRIMARY_INVALID, key: null, missing: [], invalid: ['primary'], conflicts: []}],
  ['الأساسي null', {...R8, a: null}, {shape: SHAPE.R8_SHORT_NAMES, usable: false, reason: U.PRIMARY_INVALID, key: null, missing: [], invalid: ['primary'], conflicts: []}],
  ['طبقة غير صالحة (رقم) والأساسي سليم', {...FULL, layerD_buildSig: 7}, {shape: SHAPE.FULL_NAMES, usable: true, reason: null, key: {...KEY, layerD_buildSig: null}, missing: [], invalid: ['layerD_buildSig'], conflicts: []}],
  ['حقل undefined = غائب', {...FULL, layerE_sensorSig: undefined}, {shape: SHAPE.FULL_NAMES, usable: true, reason: null, key: {...KEY, layerE_sensorSig: null}, missing: ['layerE_sensorSig'], invalid: [], conflicts: []}],
  ['مفاتيح زائدة تُهمَل', {...R8, g: 'extra', unrelated: 1}, {shape: SHAPE.R8_SHORT_NAMES, usable: true, reason: null, key: KEY, missing: [], invalid: [], conflicts: []}],
  ['كائن بلا أيّ اسم معروف', {x: 1, g: 'y'}, {shape: SHAPE.UNRECOGNIZED, usable: false, reason: U.NO_RECOGNIZED_FIELD, key: null, missing: ALL_FULL, invalid: [], conflicts: []}],
  ['كائن فارغ', {}, {shape: SHAPE.UNRECOGNIZED, usable: false, reason: U.NO_RECOGNIZED_FIELD, key: null, missing: ALL_FULL, invalid: [], conflicts: []}],
  ['خصائص موروثة لا تُقرأ', Object.create({a: 'P'}), {shape: SHAPE.UNRECOGNIZED, usable: false, reason: U.NO_RECOGNIZED_FIELD, key: null, missing: ALL_FULL, invalid: [], conflicts: []}],
  ['نصّ (الشكل القديم)', 'abcdef123456', {shape: SHAPE.NOT_AN_OBJECT, usable: false, reason: U.KEY_NOT_AN_OBJECT, key: null, missing: [], invalid: [], conflicts: []}],
  ['رقم', 42, {shape: SHAPE.NOT_AN_OBJECT, usable: false, reason: U.KEY_NOT_AN_OBJECT, key: null, missing: [], invalid: [], conflicts: []}],
  ['مصفوفة', ['P', 'KA'], {shape: SHAPE.NOT_AN_OBJECT, usable: false, reason: U.KEY_NOT_AN_OBJECT, key: null, missing: [], invalid: [], conflicts: []}],
  ['منطقي', true, {shape: SHAPE.NOT_AN_OBJECT, usable: false, reason: U.KEY_NOT_AN_OBJECT, key: null, missing: [], invalid: [], conflicts: []}],
  ['null', null, {shape: SHAPE.ABSENT, usable: false, reason: U.KEY_ABSENT, key: null, missing: [], invalid: [], conflicts: []}],
  ['undefined', undefined, {shape: SHAPE.ABSENT, usable: false, reason: U.KEY_ABSENT, key: null, missing: [], invalid: [], conflicts: []}],
  ['الأساسي الاحتياطي unknown_fp (مقبول هنا؛ القرّاء يتخطّونه)', {...R8, a: 'unknown_fp'}, {shape: SHAPE.R8_SHORT_NAMES, usable: true, reason: null, key: {...KEY, primary: 'unknown_fp'}, missing: [], invalid: [], conflicts: []}],
  ['قيم الحارس من التطبيق تمرّ كما هي (لا يُعاد تفسيرها)', {...R8, b: 'no_keystore', c: 'no_fid'}, {shape: SHAPE.R8_SHORT_NAMES, usable: true, reason: null, key: {...KEY, layerA_keystore: 'no_keystore', layerB_firebaseId: 'no_fid'}, missing: [], invalid: [], conflicts: []}],
];
for (const [label, raw, exp] of ROWS) {
  const r = norm(raw);
  eq(r.shape, exp.shape, `[٢] الشكل — ${label}`);
  eq(r.usable, exp.usable, `[٢] usable — ${label}`);
  eq(r.unusableReason, exp.reason, `[٢] السبب — ${label}`);
  deq(r.key, exp.key, `[٢] المفتاح المُطبَّع — ${label}`);
  deq([...r.missing].sort(), [...exp.missing].sort(), `[٢] ما لم يجده — ${label}`);
  deq(r.invalid, exp.invalid, `[٢] غير الصالح — ${label}`);
  deq(r.conflicts, exp.conflicts, `[٢] المتعارض — ${label}`);
  eq(r.usable, r.key !== null, `[٢] usable ⇔ key ليس null — ${label}`);
}
for (const shape of Object.values(SHAPE)) ok(ROWS.some(([, , e]) => e.shape === shape), `[٢] الجدول يمرّ بالشكل ${shape}`);
for (const reason of Object.values(U)) ok(ROWS.some(([, , e]) => e.reason === reason), `[٢] الجدول يمرّ بسبب عدم الاستعمال ${reason}`);

// الوصف للسجلّ: أسماء لا قيم
const goldenKey = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden', 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json'), 'utf8')).fingerprint.device.deviceProfileKey;
const described = describe(norm({...goldenKey, layerA_keystore: 5}));
ok(/shape=FULL_NAMES usable=true/.test(described) && /invalid=\[layerA_keystore\]/.test(described), '[٢] الوصف يسمّي الشكل وغير الصالح');
ok(!Object.values(goldenKey).some((v) => described.includes(v)), '[٢] والوصف بلا أيّ قيمة (الأساسي والطبقات معرّفات جهاز)');
eq(describe(norm({...FULL, ...R8, a: 'X'})), 'shape=BOTH_FORMS_CONFLICT usable=false reason=FORMS_CONFLICT conflicts=[primary]', '[٢] وصف التعارض حرفياً');
eq(describe(norm(null)), 'shape=ABSENT usable=false reason=KEY_ABSENT', '[٢] وصف الغياب حرفياً');

// ═══════════════════════════════════════════════════════════════════
// ٣ — الحمولتان الحقيقيتان: الأسماء الكاملة (عيّنة fv67 الذهبية، بُنيت في JVM) وحمولة R8 (مشتقّة منها بالأسماء المنقولة)
// ═══════════════════════════════════════════════════════════════════
const rn = norm(goldenKey);
eq(rn.shape, SHAPE.FULL_NAMES, '[٣] عيّنة fv67 الذهبية: الأسماء الكاملة');
ok(rn.usable && rn.key.primary === 'synthetic-golden-primary' && rn.key.layerA_keystore === 'synthetic-golden-layer-a' && rn.key.layerE_sensorSig === 'synthetic-golden-layer-e', '[٣] المفتاح المُطبَّع من العيّنة: الأساسي والطبقات قيمها (قيم بديلة synthetic-golden-* في العيّنة)');
const r8Derived = Object.fromEntries(Object.entries(goldenKey).map(([k, v]) => [ORDER_MAPPING[k], v]));
deq(Object.keys(r8Derived).sort(), ['a', 'b', 'c', 'd', 'e', 'f'], '[٣] حمولة R8 المشتقّة: a..f وحدها');
const rr = norm(r8Derived);
eq(rr.shape, SHAPE.R8_SHORT_NAMES, '[٣] حمولة R8: الشكل R8_SHORT_NAMES');
deq(rr.key, rn.key, '[٣] والمفتاح المُطبَّع من R8 = المُطبَّع من الأسماء الكاملة (الجهاز نفسه، الأساسي والطبقات نفسها)');

// ═══════════════════════════════════════════════════════════════════
// ٤ — حارس بنيوي على src
// ═══════════════════════════════════════════════════════════════════
const SRC = path.join(__dirname, '..', 'src');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const srcFiles = [];
(function walk(d) { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) srcFiles.push(p); } })(SRC);
const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/');
const mention = srcFiles.filter((p) => /deviceProfileKey|layer[A-E]_(?:keystore|firebaseId|androidId|buildSig|sensorSig)/.test(strip(fs.readFileSync(p, 'utf8')))).map(rel).sort();
// 2026-10-18 (S-P6-01، البند ١): أُضيف profiles/deviceIdentityHmac.js — **يستورد من المُطبِّع قيمة UNKNOWN_PRIMARY وحدها** (حارس الأساسي، مصدرها الواحد) ولا يقرأ حقلاً من المفتاح؛ وهو لا يطابق النمط إلا باسم الاستيراد. إضافته هنا إعلان لا تساهل (القاعدة 25).
deq(mention, ['analysis/analyzeDevice.js', 'analysis/runAnalysisInternal.js', 'profiles/createDeviceProfile.js', 'profiles/deviceIdentityHmac.js', 'profiles/deviceProfileKey.js', 'profiles/findDeviceProfile.js'],
    '[٤] ملفّات src التي تقرأ المفتاح أو أسماء الطبقات (بلا التعليقات): قائمة القرّاء مثبَّتة — قارئ جديد يلزمه المُطبِّع وإضافته هنا (القاعدة 25)');
const direct = [];
for (const p of srcFiles) {
  if (rel(p) === 'profiles/deviceProfileKey.js') continue;
  const text = strip(fs.readFileSync(p, 'utf8'));
  for (const m of text.matchAll(/deviceProfileKey\??\.(?:a|b|c|d|e|f|primary|layer[A-E]_[A-Za-z]+)\b/g)) direct.push(`${rel(p)}: ${m[0]}`);
}
deq(direct, [], '[٤] لا قراءة مباشرة لحقول المفتاح (.a أو .primary أو .layerX_) خارج المُطبِّع');
for (const f of ['analysis/analyzeDevice.js', 'analysis/runAnalysisInternal.js', 'profiles/createDeviceProfile.js', 'profiles/findDeviceProfile.js']) {
  ok(/require\("(?:\.\.\/profiles|\.)\/deviceProfileKey"\)/.test(strip(fs.readFileSync(path.join(SRC, f), 'utf8'))), `[٤] ${f} يستورد المُطبِّع`);
}
const unknownFp = srcFiles.filter((p) => rel(p) !== 'profiles/deviceProfileKey.js' && /["']unknown_fp["']/.test(strip(fs.readFileSync(p, 'utf8')))).map(rel);
deq(unknownFp, [], '[٤] قيمة unknown_fp في المُطبِّع وحده (UNKNOWN_PRIMARY — القاعدة 24)، لا نسخة في القرّاء');

console.log(`\ndeviceProfileKey.test.js: ${n}/${n} assertions passed`);

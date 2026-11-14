'use strict';

// doubleEval.test.js — قرعة التقييم المزدوج عند إنشاء الجلسة (S-P6-10، 2026-10-21 +03). وحدة بلا شبكة ولا محاكٍ؛ المسار الحقيقي على المحاكي في doubleEval.e2e.test.js.
//
// المواصفة: PLAN-06 §١٠-ب-٦ (:1300-1309) و§٦-ج (:893) وdocs/PROTOCOL_CONTRACT.md §٢ A7 (E9: doubleEvalDraw {selected, draw, rate, settingsVersion, decidedAt} + reason اقتراحي). الدالّة نقيّة (القاعدة 41).
// **القيم المتوقَّعة حرفيّات هنا عمداً** (مرجع مستقلّ عن الوحدة).
//   ١ buildDoubleEvalDraw: الأسباب بترتيبها (إعدادات ← جزء doubleEval ← نسبة doubleEvalRate) والقرعة draw < rate بحدّها، ولا قيمة افتراضية (random وdecidedAt صريحان)
//   ٢ الاستقلال عن التكرار: نسبة التكرار والجزء coldRepeat لا يمسّان قرعة التقييم المزدوج (والعكس)
//   ٣ شكل الناتج: ستّة مفاتيح بالترتيب، selected منطقي دائماً (يقرؤه technicianForm.doubleEvalState)، وتوافقه مع قارئ الاستمارة
//   ٤ بنية الشيفرة: لا I/O ولا حذف ولا Math.random ولا حرفيّة مفردة
//
// Run: node functions/test/doubleEval.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
function throwsWith(fn, re, m) {
  let e = null;
  try { fn(); } catch (x) { e = x; }
  ok(e && re.test(e.message), `${m} (${e ? e.message : 'لم يرمِ'})`);
}

const {buildDoubleEvalDraw} = require('../src/protocol/doubleEval');
const {readSettingsDocument} = require('../src/protocol/protocolSettings');
process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const STAMP = {__stamp: 'decidedAt-marker'};
const PARTS = (extra = {}) => ({purposes: false, batteryBeforeAfter: false, coldRepeat: false, returns: false, doubleEval: true, consent: false, ...extra});
const SETTINGS = (extra = {}) => readSettingsDocument({version: 6, doubleEvalRate: 0.1, repeatRate: 0.25, ...extra});
const NEVER = () => { throw new Error('random لا يجوز استدعاؤها قبل اجتياز كل الشروط'); };
const draw = (o) => buildDoubleEvalDraw({settings: SETTINGS(), parts: PARTS(), random: () => 0.5, decidedAt: STAMP, ...o});

// ═══ ١ — الأسباب والقرعة ═══
{
  deq(draw({settings: readSettingsDocument(null), parts: PARTS({doubleEval: false}), random: NEVER}), {selected: false, reason: 'SETTINGS_ABSENT', draw: null, rate: null, settingsVersion: 'SETTINGS_ABSENT', decidedAt: STAMP}, '[١] إعدادات غائبة تسبق الجزء: SETTINGS_ABSENT (P:893: لا يُفترض 10%)، ولا قرعة (draw وrate null)');
  deq(draw({settings: readSettingsDocument({repeatRate: 1}), random: NEVER}).reason, 'SETTINGS_ABSENT', '[١] مستند إعدادات بلا version ⟵ SETTINGS_ABSENT');
  deq(draw({parts: PARTS({doubleEval: false}), random: NEVER}), {selected: false, reason: 'PART_NOT_ENABLED', draw: null, rate: null, settingsVersion: 6, decidedAt: STAMP}, '[١] الجزء غير مفعَّل: PART_NOT_ENABLED ونسخة الإعدادات تُذكر');
  for (const bad of [undefined, null, 'true', 1, {}]) eq(draw({parts: PARTS({doubleEval: bad}), random: NEVER}).reason, 'PART_NOT_ENABLED', `[١] الجزء ${JSON.stringify(bad)} ليس true بالضبط ⟵ PART_NOT_ENABLED`);
  eq(draw({parts: undefined, random: NEVER}).reason, 'PART_NOT_ENABLED', '[١] parts غائبة ⟵ PART_NOT_ENABLED');
  deq(draw({settings: SETTINGS({doubleEvalRate: undefined}), random: NEVER}).reason, 'RATE_ABSENT', '[١] النسبة غائبة ⟵ RATE_ABSENT');
  for (const bad of [1.01, -0.01, '0.1', NaN, Infinity]) eq(draw({settings: SETTINGS({doubleEvalRate: bad}), random: NEVER}).reason, 'RATE_INVALID', `[١] النسبة ${JSON.stringify(bad)} ⟵ RATE_INVALID`);
  // القرعة وحدّها
  deq(draw({random: () => 0.0999}), {selected: true, reason: null, draw: 0.0999, rate: 0.1, settingsVersion: 6, decidedAt: STAMP}, '[١] draw 0.0999 < 0.1 ⟵ selected، ويُخزَّن draw وrate (فالسحب يُعاد حسابه)');
  deq(draw({random: () => 0.1}), {selected: false, reason: null, draw: 0.1, rate: 0.1, settingsVersion: 6, decidedAt: STAMP}, '[١] draw = rate بالضبط ⟵ غير مختار (الاختيار draw < rate)');
  eq(draw({random: () => 0}).selected, true, '[١] draw 0 ⟵ مختار');
  eq(draw({random: () => 0.99999}).selected, false, '[١] draw قرب 1 ⟵ غير مختار');
  eq(draw({settings: SETTINGS({doubleEvalRate: 1}), random: () => 0.999999}).selected, true, '[١] نسبة 1 تختار دائماً');
  deq(draw({settings: SETTINGS({doubleEvalRate: 0}), random: () => 0}), {selected: false, reason: null, draw: 0, rate: 0, settingsVersion: 6, decidedAt: STAMP}, '[١] نسبة 0 لا تختار أبداً ولو draw = 0، وتُخزَّن 0 لا null (القرعة جرت)');
  // لا قيمة افتراضية
  for (const bad of [undefined, null, 0.5]) throwsWith(() => buildDoubleEvalDraw({settings: SETTINGS(), parts: PARTS(), random: bad, decidedAt: STAMP}), /random مُعامل صريح/, `[١] random = ${JSON.stringify(bad)} ⟵ خطأ (لا افتراضي: القاعدة 22)`);
  for (const bad of [-0.1, 1, 2, NaN, null]) throwsWith(() => draw({random: () => bad}), /خارج \[0, 1\)/, `[١] random تعيد ${JSON.stringify(bad)} ⟵ خطأ`);
  eq(draw({decidedAt: undefined}).decidedAt, undefined, '[١] decidedAt كما مُرِّر (لا وقت يُختلق في الدالّة النقيّة)');
}

// ═══ ٢ — الاستقلال عن التكرار ═══
{
  eq(draw({settings: SETTINGS({repeatRate: 0, doubleEvalRate: 1}), parts: PARTS({coldRepeat: false}), random: () => 0.9}).selected, true, '[٢] نسبة التكرار 0 والجزء coldRepeat مُطفأ لا يمنعان التقييم المزدوج');
  eq(draw({settings: SETTINGS({repeatRate: 1, doubleEvalRate: 0}), parts: PARTS({coldRepeat: true}), random: () => 0}).selected, false, '[٢] ونسبة التكرار 1 لا تُنقذ تقييماً مزدوجاً بنسبة 0');
  eq(draw({settings: SETTINGS({repeatRate: undefined, doubleEvalRate: 0.5}), random: () => 0.4}).selected, true, '[٢] غياب repeatRate لا يمسّ (النسبة المقروءة doubleEvalRate)');
  eq(draw({settings: SETTINGS({doubleEvalRate: undefined, repeatRate: 1}), random: NEVER}).reason, 'RATE_ABSENT', '[٢] وغياب doubleEvalRate لا يُعوَّض بـrepeatRate (لا افتراضي من حقل آخر)');
}

// ═══ ٣ — الشكل وقارئ الاستمارة ═══
{
  const d = draw({random: () => 0.01});
  deq(Object.keys(d), ['selected', 'reason', 'draw', 'rate', 'settingsVersion', 'decidedAt'], '[٣] ستّة مفاتيح بهذا الترتيب (E9 الخمسة + reason)');
  for (const r of [0, 0.05, 0.5, 0.9999]) eq(typeof draw({random: () => r}).selected, 'boolean', `[٣] selected منطقي دائماً (draw ${r})`);
  eq(typeof draw({parts: PARTS({doubleEval: false})}).selected, 'boolean', '[٣] وselected منطقي حين لا قرعة (false لا null)');
  ok(Object.values(d).every((v) => v !== undefined) || d.decidedAt === STAMP, '[٣] لا قيمة undefined (Firestore يرفضها)');
  // القارئ الحقيقي لشكل doubleEvalDraw (S-P6-08)
  const F = require('../src/evaluations/technicianForm');
  const read = (draw) => F.doubleEvalState({doubleEvalDraw: draw});
  const S = F.DOUBLE_EVAL_STATE;
  eq(read(draw({random: () => 0.01})), S.SELECTED, '[٣] المختار ⟵ SELECTED عند قارئ الاستمارة');
  eq(read(draw({random: () => 0.9})), S.NOT_SELECTED, '[٣] غير المختار ⟵ NOT_SELECTED');
  for (const o of [{settings: readSettingsDocument(null)}, {parts: PARTS({doubleEval: false})}, {settings: SETTINGS({doubleEvalRate: undefined})}, {settings: SETTINGS({doubleEvalRate: 7})}]) {
    eq(read(draw({...o, random: NEVER})), S.NOT_SELECTED, '[٣] لا قرعة (سبب مسمّى) ⟵ NOT_SELECTED (لا SELECTED ولا MALFORMED)');
  }
  const before = {settings: SETTINGS(), parts: PARTS()};
  draw(before);
  deq([before.settings.version, before.parts.doubleEval], [6, true], '[٣] لا تعدّل مدخلاتها');
}

// ═══ ٤ — بنية الشيفرة ═══
{
  const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  const code = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol', 'doubleEval.js'), 'utf8'));
  deq([...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]).sort(), ['./protocolSelection', './protocolSettings', './protocolVocabulary'], '[٤] ثلاثة مستورَدات نقيّة (لا Firestore ولا admin)');
  ok(!/\.delete\(|FieldValue|recursiveDelete|bulkWriter|\.batch\(|collection\(|\.doc\(|runTransaction|\.where\(|Math\.random/.test(code), '[٤] لا I/O ولا حذف ولا Math.random (القاعدة 42؛ الدالّة نقيّة)');
  ok(!/["'`](SETTINGS_ABSENT|PART_NOT_ENABLED|RATE_ABSENT|RATE_INVALID|doubleEval|doubleEvalRate)["'`]/.test(code), '[٤] لا حرفيّة مفردة: المفردات من protocolVocabulary وأسماء الحقول من SETTINGS_FIELD (القاعدة 24)');
  deq(Object.keys(require('../src/protocol/doubleEval')), ['buildDoubleEvalDraw', 'DOUBLE_EVAL_DRAW_FIELD'], '[٤] التصدير: الدالّة واحدة واسم الحقل');
  // اسم الحقل مصدر واحد مصدَّر (القاعدة 24): قيمته E9 حرفيّة هنا (مرجع مستقلّ)، ولا حرفيّة ثانية له في أيّ كود تحت src (الكاتب والقارئ يستوردانه).
  eq(require('../src/protocol/doubleEval').DOUBLE_EVAL_DRAW_FIELD, 'doubleEvalDraw', '[٤] DOUBLE_EVAL_DRAW_FIELD = doubleEvalDraw (E9)');
  const srcRoot = path.join(__dirname, '..', 'src');
  const literal = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.js$/.test(e.name) && /["'`]doubleEvalDraw["'`]|\.doubleEvalDraw\b|\bdoubleEvalDraw\s*:/.test(strip(fs.readFileSync(p, 'utf8')))) literal.push(path.relative(srcRoot, p).replace(/\\/g, '/'));
    }
  })(srcRoot);
  deq(literal, ['protocol/doubleEval.js'], '[٤] حرفيّة اسم الحقل doubleEvalDraw (نصّاً أو خاصّيّة أو مفتاحاً) في كود src (بلا تعليقات) في ملفّ واحد: مصدرها');
  for (const f of ['evaluations/technicianForm.js', 'sessions/createScanSession.js']) {
    const text = fs.readFileSync(path.join(srcRoot, f), 'utf8');
    ok(/require\("\.\.\/protocol\/doubleEval"\)/.test(text) && (strip(text).match(/DOUBLE_EVAL_DRAW_FIELD/g) || []).length >= 2, `[٤] ${f} يستورد اسم الحقل من doubleEval.js ويستعمله (استيراد + استعمال على الأقلّ)`);
  }
}

console.log(`\ndoubleEval.test.js: ${n}/${n} assertions passed`);

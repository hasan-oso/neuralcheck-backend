'use strict';

// evaluationEnabledState.test.js — حالات evaluationEnabled المسمّاة في joinScanSession (V8 قبل النشر، 2026-10-09 +03). وحدة بلا شبكة ولا محاكي:
// الأسباب مجمَّدة ومن مصدر واحد، والقيمة المُعادة مطابقة للتعبير القديم owner?.evaluationEnabled === true على كل مُدخل (الردّ إلى التطبيق لا
// يتغيّر)، وحارس بنيوي على joinScanSession.js: سطر السجلّ واحد، والردّ يأخذ decision.value، وكل ما يُستوفى في السطر حالة أو معرّف مُهشَّر.
// المسار الحقيقي على المحاكي: joinScanSessionEvaluationEnabledLog.e2e.test.js.
//
// Run: node functions/test/evaluationEnabledState.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const {EVALUATION_ENABLED_REASON: R, evaluationEnabledDecision, valueTypeForLog} = require('../src/sessions/evaluationEnabledState');

// ═══════════════════════════════════════════════════════════════════
// ١ — الأسباب: مجمَّدة، قيمتها اسمها، خمسة
// ═══════════════════════════════════════════════════════════════════
ok(Object.isFrozen(R), '[١] EVALUATION_ENABLED_REASON مجمَّد');
for (const [k, v] of Object.entries(R)) eq(v, k, `[١] قيمة ${k} = اسمها`);
deq(Object.keys(R).sort(), ['FLAG_ABSENT', 'FLAG_FALSE', 'FLAG_NOT_BOOLEAN', 'FLAG_TRUE', 'OWNER_DOC_MISSING'], '[١] الحالات الخمس: المالك غائب، العلم true/false/غائب/غير منطقي');

// ═══════════════════════════════════════════════════════════════════
// ٢ — القرار: السبب لكل مُدخل، والقيمة مطابقة للتعبير القديم حرفياً
// ═══════════════════════════════════════════════════════════════════
const oldExpression = (owner) => owner?.evaluationEnabled === true; // نصّ joinScanSession.js:97 عند b194da4
const ROWS = [
  [null, R.OWNER_DOC_MISSING, null, 'المالك غائب (null)'],
  [undefined, R.OWNER_DOC_MISSING, null, 'المالك غائب (undefined)'],
  [{}, R.FLAG_ABSENT, null, 'مستند بلا الحقل'],
  [{language: 'ar'}, R.FLAG_ABSENT, null, 'مستند بحقول أخرى بلا الحقل'],
  [{evaluationEnabled: undefined}, R.FLAG_ABSENT, null, 'الحقل undefined = غائب'],
  [{evaluationEnabled: true}, R.FLAG_TRUE, null, 'true'],
  [{evaluationEnabled: false}, R.FLAG_FALSE, null, 'false'],
  [{evaluationEnabled: 'true'}, R.FLAG_NOT_BOOLEAN, 'string', 'نصّ "true" — ليس منطقياً فلا يُفتح'],
  [{evaluationEnabled: 'false'}, R.FLAG_NOT_BOOLEAN, 'string', 'نصّ "false"'],
  [{evaluationEnabled: ''}, R.FLAG_NOT_BOOLEAN, 'string', 'نصّ فارغ'],
  [{evaluationEnabled: 1}, R.FLAG_NOT_BOOLEAN, 'number', 'رقم 1'],
  [{evaluationEnabled: 0}, R.FLAG_NOT_BOOLEAN, 'number', 'رقم 0'],
  [{evaluationEnabled: null}, R.FLAG_NOT_BOOLEAN, 'null', 'null مخزَّناً (حقل موجود بقيمة فارغة ≠ غائب)'],
  [{evaluationEnabled: {}}, R.FLAG_NOT_BOOLEAN, 'object', 'خريطة'],
  [{evaluationEnabled: {enabled: true}}, R.FLAG_NOT_BOOLEAN, 'object', 'خريطة بداخلها true'],
  [{evaluationEnabled: []}, R.FLAG_NOT_BOOLEAN, 'array', 'مصفوفة'],
  [{evaluationEnabled: [true]}, R.FLAG_NOT_BOOLEAN, 'array', 'مصفوفة بداخلها true'],
];
for (const [owner, reason, valueType, label] of ROWS) {
  const d = evaluationEnabledDecision(owner);
  eq(d.reason, reason, `[٢] السبب — ${label}`);
  eq(d.valueType, valueType, `[٢] نوع القيمة (لا القيمة) — ${label}`);
  eq(d.value, oldExpression(owner), `[٢] القيمة المُعادة = التعبير القديم owner?.evaluationEnabled === true — ${label}`);
  eq(typeof d.value, 'boolean', `[٢] والقيمة منطقية دائماً — ${label}`);
}
eq(new Set(ROWS.map((r) => r[1])).size, 5, '[٢] الجدول يمرّ بالأسباب الخمسة كلها');
eq(valueTypeForLog(null), 'null', '[٢] valueTypeForLog(null)');
eq(valueTypeForLog([]), 'array', '[٢] valueTypeForLog([])');
eq(valueTypeForLog({}), 'object', '[٢] valueTypeForLog({})');
eq(valueTypeForLog('x'), 'string', '[٢] valueTypeForLog("x")');

// ═══════════════════════════════════════════════════════════════════
// ٣ — حارس بنيوي على joinScanSession.js
// ═══════════════════════════════════════════════════════════════════
const raw = fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'joinScanSession.js'), 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');
const source = strip(raw);
ok(!/evaluationEnabled\s*===/.test(source), '[٣] لا قرار evaluationEnabled مكتوب في joinScanSession.js نفسه (المصدر الوحيد evaluationEnabledState.js — القاعدة 24)');
ok(/evaluationEnabled: decision\.value,/.test(source), '[٣] الردّ يأخذ decision.value');
ok(/evaluationEnabledDecision\(owner\)/.test(source), '[٣] والقرار من المالك المقروء أصلاً (صفر قراءة إضافية)');
const logCalls = [...source.matchAll(/console\.log\(([\s\S]*?)\);\n/g)].map((m) => m[1]).filter((b) => /evaluationEnabled=/.test(b));
eq(logCalls.length, 1, '[٣] سطر سجلّ evaluationEnabled واحد في الملفّ');
const exprs = [...logCalls[0].matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
const allowed = [/^decision\.value$/, /^decision\.reason$/, /^decision\.valueType$/, /^hashIdForLog\((sessionId|session\.ownerId|joinerUid)\)$/];
for (const e of exprs) ok(allowed.some((re) => re.test(e)), `[٣] كل ما يُستوفى في السطر حالة أو معرّف مُهشَّر: \${${e}}`);
deq(exprs.filter((e) => /^hashIdForLog/.test(e)).sort(), ['hashIdForLog(joinerUid)', 'hashIdForLog(session.ownerId)', 'hashIdForLog(sessionId)'], '[٣] المعرّفات الثلاثة: الجلسة والمالك والمنضمّ');
ok(!/\bcode\b/.test(logCalls[0]), '[٣] ولا رمز الجلسة (code) في السطر');
// الفاحص نفسه يرفض الشكل الخامّ
ok(!allowed.some((re) => re.test('session.ownerId')) && !allowed.some((re) => re.test('sessionId')) && !allowed.some((re) => re.test('joinerUid')), '[٣] الفاحص: المعرّف الخامّ مرفوض');

console.log(`\nevaluationEnabledState.test.js: ${n}/${n} assertions passed`);

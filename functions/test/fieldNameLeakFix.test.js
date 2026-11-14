'use strict';

// fieldNameLeakFix.test.js — أمر مستخدم 2026-09-23 +03 (بعد القياس
// العشاري)، البند ٤ الأصلي: "ثغرتا الأسماء: تطبيق لا توسيع... يُقسم الاسم
// المركّب إلى أجزائه (vsyncLockFraction60 → vsync)، ويُضاف اسم الجذر
// findings."
//
// **تحديث لاحق، قرار المستخدم بعد A125 (نُقل حرفياً)**: "يُلغى تقسيم
// الأسماء المركّبة، ويبقى اسم الجذر findings... الخطر ليس في الكلمات
// الشائعة، بل في كل قيمة تشترك حروفها مع جزء من اسم حقل." التقسيم
// (splitCamelCaseParts) أدخل التوكِن "partial" من
// categoryStates.overall.partialAssessment/partialAssessmentTag إلى فهرس
// الاستثناء، فقيمة state حقيقية "PARTIAL" التي يكتبها النموذج صارت تمرّ
// الحارس بصمت — اكتشفه اختبار البند ٥ (statePromptTranslationHint.test.js)
// لا هذا الملفّ. **أُلغي التقسيم وحده هنا**: vsync يعود مرفوضاً كما كان
// قبل 695e862 (نُقل من positive إلى negativeControls في الثابت المُجمَّد،
// بلا حذف — القاعدة 8)، وfindings (اسم جذر كامل غير مُقسَّم) يبقى مقبولاً.
//
// النصوص الحقيقية مُجمَّدة في test/fixtures/frozen-real-model-text-field-
// name-leak-2026-09-23.json — لا قراءة من scripts/out هنا.
//
// Run: node functions/test/fieldNameLeakFix.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
function loadFrozen(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')); }

const {guardV7Response, collectFindingsFieldNameTokens} = require('../src/analysis/reportShapeV7');
const {V7_PAYLOAD_ROOT_KEYS} = require('../src/analysis/buildV7Payload');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

function build(scanId, tsFile) {
  const raw = loadGolden(tsFile);
  const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
  const functional = frMap[scanId];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  return {findings, categoryStates};
}
const b45 = build('b45c8cf6-e376-4765-8703-f68e9bc69844', 'b45c8cf6.ts.json');
const d34 = build('34dff2b8-ce9e-4b40-86a9-1976c878e195', '34dff2b8.ts.json');
const ctx = {b45c8cf6: b45, '34dff2b8': d34};

function minimalParsed(detailsText) {
  return {
    narrative: {summary: 's', details: detailsText, verdict: 'v', buyerAdvice: {casual: 'n', gamer: 'n', photographer: 'n'}, issueDescriptions: {}},
    crossChecks: [], adjustments: [], modelObservations: [],
  };
}

const fixture = loadFrozen('frozen-real-model-text-field-name-leak-2026-09-23.json');

// ═══════════════════════════════════════════════════════════════════════
// ١ — حالة التطبيق الباقية (positive): findings (اسم جذر كامل) يمرّ (صفر
// leaks). vsync لم تعد هنا — انتقلت إلى negativeControls (القاعدة 23).
// ═══════════════════════════════════════════════════════════════════════
for (const c of fixture.positive) {
  const target = ctx[c.targetCategoryStatesFixture];
  const guard = guardV7Response(minimalParsed(c.text), {findings: target.findings, categoryStates: target.categoryStates});
  eq(guard.languageLeaks.length, 0, `[١] "${c.id}": صفر leaks — النصّ الحقيقي يمرّ (${JSON.stringify(guard.languageLeaks)})`);
}
console.log('تحقّق ١: حالة التطبيق الباقية (findings، اسم جذر كامل) تمرّ — صفر leaks');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — الضوابط السلبية: تشمل الآن vsync (بعد إلغاء التقسيم، القاعدة 23 —
// التوقّع استُبدل لا أُضيف إليه) زائداً الثلاثة الأصلية. كلّها يجب أن
// تبقى مرفوضة (عدا الضابط التأكيدي near_56pct).
// ═══════════════════════════════════════════════════════════════════════
for (const c of fixture.negativeControls) {
  const target = ctx[c.targetCategoryStatesFixture];
  const guard = guardV7Response(minimalParsed(c.text), {findings: target.findings, categoryStates: target.categoryStates});
  if (c.mustStayRejected) {
    ok(guard.languageLeaks.length > 0, `[٢] "${c.id}": مرفوض (leaks حاضرة فعلياً) — ${JSON.stringify(guard.languageLeaks.map((l) => l.tokens))}`);
  } else {
    eq(guard.languageLeaks.length, 0, `[٢-ضابط تأكيدي] "${c.id}": ${c.note}`);
  }
}
console.log('تحقّق ٢: الضوابط السلبية الأربعة (vsync بعد إلغاء التقسيم، USB debugging، Boşta، نحو 56%) — النتيجة كما هو متوقَّع لكلٍّ');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — أسماء الجذر: كل مفتاح من V7_PAYLOAD_ROOT_KEYS حاضر في فهرس
// الاستثناء (مصدر واحد — القاعدة 24، لا نسخة يدوية).
// ═══════════════════════════════════════════════════════════════════════
{
  const tokens = collectFindingsFieldNameTokens(b45.findings, b45.categoryStates);
  for (const rootKey of V7_PAYLOAD_ROOT_KEYS) {
    ok(tokens.has(rootKey.toLowerCase()), `[٣] اسم الجذر "${rootKey}" حاضر في فهرس الاستثناء`);
  }
}
console.log(`تحقّق ٣: كل أسماء الجذر الثمانية (${V7_PAYLOAD_ROOT_KEYS.join('، ')}) حاضرة في الفهرس`);

// ═══════════════════════════════════════════════════════════════════════
// ٤ — القاعدة 24: V7_PAYLOAD_ROOT_KEYS يطابق مفاتيح body الحقيقية فعلياً
// (لا انجراف صامت لو أُضيف حقل حمولة جديد ونُسي هنا).
// ═══════════════════════════════════════════════════════════════════════
{
  const {buildV7Payload} = require('../src/analysis/buildV7Payload');
  const {body} = buildV7Payload({
    findings: b45.findings, categoryStates: b45.categoryStates, language: 'ar',
    scanId: 'x', isFreeTrial: false, previousScan: null, priorRejection: null,
  });
  const actualKeys = Object.keys(body).sort();
  const declaredKeys = [...V7_PAYLOAD_ROOT_KEYS].sort();
  assert.deepStrictEqual(actualKeys, declaredKeys,
      `[٤] V7_PAYLOAD_ROOT_KEYS يطابق Object.keys(body) الفعلية حرفياً — لا انجراف صامت`);
  n++;
}
console.log('تحقّق ٤: V7_PAYLOAD_ROOT_KEYS مطابقة فعلياً لمفاتيح body الحقيقية من buildV7Payload — مُتحقَّق لا مُفترَض');

// ═══════════════════════════════════════════════════════════════════════
// ٥ — بعد إلغاء التقسيم: "قِس بعد الإلغاء: كم توكِناً جديداً بقي في
// الفهرس؟ المتوقّع أسماء الجذر وحدها، لكن اطبعه ولا تفترضه. وهل بقيت
// partial في الفهرس؟" (نصّ المستخدم حرفياً). القياس هنا ضدّ خطّ الأساس
// الحقيقي — ما قبل 695e862 كلياً (بلا أسماء جذر وبلا تقسيم) — لا ضدّ خطّ
// أساس وسيط.
// ═══════════════════════════════════════════════════════════════════════
{
  const LEAK_TOKEN_RE_LOCAL = /[A-Za-z][A-Za-z0-9]+/g;
  function preFix695e862Collect(findings, categoryStates) {
    const tokens = new Set();
    function addTokensFrom(str) {
      LEAK_TOKEN_RE_LOCAL.lastIndex = 0;
      let m;
      while ((m = LEAK_TOKEN_RE_LOCAL.exec(str)) !== null) tokens.add(m[0].toLowerCase());
    }
    function walkKeys(obj, depth) {
      if (depth > 12 || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { for (const v of obj) walkKeys(v, depth + 1); return; }
      for (const [k, v] of Object.entries(obj)) {
        addTokensFrom(k);
        if (typeof v === 'boolean') tokens.add(String(v));
        walkKeys(v, depth + 1);
      }
    }
    walkKeys(findings, 0);
    walkKeys(categoryStates, 0);
    const nmf = (findings && Array.isArray(findings.notMeasuredFields)) ? findings.notMeasuredFields : [];
    for (const entry of nmf) if (entry && typeof entry.field === 'string') addTokensFrom(entry.field);
    return tokens;
  }
  const baselineTokens = preFix695e862Collect(b45.findings, b45.categoryStates);
  const newTokens = collectFindingsFieldNameTokens(b45.findings, b45.categoryStates);
  const added = [...newTokens].filter((t) => !baselineTokens.has(t)).sort();
  const hasPartial = newTokens.has('partial');

  console.log(`\n⚠️ تقرير (بعد إلغاء التقسيم): ${added.length} توكِناً جديداً بقي في الفهرس مقارنةً بخطّ الأساس (ما قبل 695e862 كلياً): ${JSON.stringify(added)}`);
  console.log(`⚠️ "partial" (بالتحديد، لا "partialassessment" الكاملة) حاضرة في الفهرس؟ ${hasPartial}`);
  console.log('⚠️ المتوقَّع: أسماء الجذر الثمانية فقط (بعضها كان موجوداً أصلاً كمفتاح حقيقي مُطابَق فلا يُحتسَب "جديداً") — مُقاس أعلاه لا مُفترَض.\n');

  const nonRootKeyAdditions = added.filter((t) => !V7_PAYLOAD_ROOT_KEYS.map((k) => k.toLowerCase()).includes(t));
  eq(nonRootKeyAdditions.length, 0,
      `[٥] كل توكِن جديد هو اسم جذر من V7_PAYLOAD_ROOT_KEYS — صفر إضافة أخرى (لا تقسيم بعد الآن) — إضافات غير جذرية: ${JSON.stringify(nonRootKeyAdditions)}`);
  eq(hasPartial, false, '[٥] "partial" غائبة عن الفهرس بعد إلغاء التقسيم — A125 مُصلَح هنا');
}
console.log('تحقّق ٥: بعد إلغاء التقسيم — التوكِنات الجديدة أسماء الجذر فقط، و"partial" غائبة (A125)');

console.log(`\nfieldNameLeakFix.test.js: ${n}/${n} assertions passed`);

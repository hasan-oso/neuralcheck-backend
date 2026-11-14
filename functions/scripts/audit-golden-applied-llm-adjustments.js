#!/usr/bin/env node
'use strict';

// audit-golden-applied-llm-adjustments — القرار ٩٥ (أ) (نصّ المستخدم
// حرفياً): "بعد التزام البند ١ من ٩٤، وبأداة على كل ملفّ في
// functions/test/fixtures/golden/: هل فيه letterSource: "LLM_ADJUSTED"؟
// أو تعديل applied === true في audit من مخرَج مولّده؟"
//
// أداة قراءة فقط — لا كتابة، لا شبكة. شقّان معاً على كل ملفّ فعلي في
// golden/:
//   (أ) مسح نصّي مباشر للثابت الحرفي "LLM_ADJUSTED" — يغطّي كل ملفّ (19)
//       بصرف النظر عن كونه مولَّداً أو مُدخلاً أو توثيقاً (القاعدة 22 —
//       لا افتراض أن غير المولَّد لا يحمله، الفحص شامل فعلاً لا انتقائي).
//   (ب) لكل ملفّ GENERATED_AND_GUARDED (مصدره
//       goldenFixturesGuardCoverage.test.js، القرار ٩٢-٢) يُستورَد مولّده
//       (بأمان — كل الثمانية تُصدِّر دالّة بناء محضة خلف require.main،
//       مُتحقَّق أدناه)، تُستدعى الدالّة، ويُمشى الكائن المُعاد بالكامل
//       (walk عميق) بحثاً عن أيّ عنصر مصفوفة يحمل الشكل {category,
//       applied, rejectedReason?} — توقيع سجلّ adjustments في
//       applyV7Adjustments (buildV7Payload.js) — ويُسجَّل applied===true
//       بمساره الكامل. هذا يغطّي audit.adjustments (V7 client-payload)
//       وaiAudit.adjustments (مستند reports) معاً بلا حاجة لمعرفة شكل كل
//       مولّد سلفاً (V6 وverifyReport لا يحملان هذا الحقل أصلاً — يمشيان
//       بلا نتيجة، وهذا متوقَّع لا عطب).
//
// Run: node functions/scripts/audit-golden-applied-llm-adjustments.js

const fs = require('fs');
const path = require('path');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const SCRIPTS_DIR = __dirname;

// نفس قائمة GENERATED_AND_GUARDED من goldenFixturesGuardCoverage.test.js
// (القاعدة 24 — نسخة حرفية موسومة بمصدرها، لا استيراد: ذلك الملفّ اختبار
// لا وحدة مُصدَّرة، والقائمة لا تتغيّر إلا حين يتغيّر مجلّد golden/ نفسه).
const GENERATED_AND_GUARDED = {
  'v7-client-payload-sample.json': {generator: 'generate-v7-client-payload-sample.js', buildFnName: 'buildClientPayloadSample'},
  'v7-client-payload-sample-llm-adjusted.json': {generator: 'generate-v7-client-payload-sample-llm-adjusted.js', buildFnName: 'buildClientPayloadSampleLlmAdjusted'},
  'v7-reports-document-sample.json': {generator: 'generate-v7-reports-document-sample.js', buildFnName: 'buildReportsDocumentSample'},
  'v7-reports-document-sample-honor.json': {generator: 'generate-v7-reports-document-sample-honor.js', buildFnName: 'buildReportsDocumentSampleHonor'},
  'v7-verifyReport-response-sample.json': {generator: 'generate-v7-verifyReport-response-sample.js', buildFnName: 'buildVerifyReportResponseSample'},
  'v7-verifyReport-response-sample-honor.json': {generator: 'generate-v7-verifyReport-response-sample-honor.js', buildFnName: 'buildVerifyReportResponseSampleHonor'},
  'v6-reports-document-sample.json': {generator: 'generate-v6-reports-document-sample.js', buildFnName: 'buildReportsDocumentSampleV6'},
  'v6-verifyReport-response-sample.json': {generator: 'generate-v6-verifyReport-response-sample.js', buildFnName: 'buildVerifyReportResponseSampleV6'},
};

function isAdjustmentRecordShaped(x) {
  return x && typeof x === 'object' && !Array.isArray(x) &&
      typeof x.category === 'string' && typeof x.applied === 'boolean';
}

// يمشي كائناً بالكامل (بلا حدّ عمق صناعي — الكائنات هنا JSON محدودة
// الحجم، لا خطر حلقة لا نهائية لأنها نواتج build نظيفة لا بيانات مستخدم
// حرّة) ويجمع كل عنصر مصفوفة يطابق شكل سجلّ adjustment، بمساره الكامل.
function collectAdjustmentRecords(value, pathStr, out) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (isAdjustmentRecordShaped(item)) {
        out.push({path: `${pathStr}[${i}]`, category: item.category, applied: item.applied, rejectedReason: item.rejectedReason ?? null});
      } else {
        collectAdjustmentRecords(item, `${pathStr}[${i}]`, out);
      }
    });
    return;
  }
  for (const k of Object.keys(value)) {
    collectAdjustmentRecords(value[k], pathStr ? `${pathStr}.${k}` : k, out);
  }
}

function main() {
  const actualFiles = fs.readdirSync(GOLDEN_DIR).filter((f) => fs.statSync(path.join(GOLDEN_DIR, f)).isFile());
  console.log(`=== (أ) مسح نصّي — "LLM_ADJUSTED" حرفياً في كل ملفّ (${actualFiles.length} ملفّاً في golden/) ===`);
  let anyLetterSourceLlmAdjusted = false;
  for (const file of actualFiles.sort()) {
    const full = path.join(GOLDEN_DIR, file);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      console.log(`  ${file}: تعذّرت القراءة كنصّ (${e.message}) — يُتجاوَز (ملفّ غير نصّي، مثل .py يُقرأ لاحقاً كنصّ أيضاً فعلياً)`);
      continue;
    }
    const count = (text.match(/LLM_ADJUSTED/g) || []).length;
    if (count > 0) {
      anyLetterSourceLlmAdjusted = true;
      console.log(`  ⚠️ ${file}: ${count} ظهوراً لِـ"LLM_ADJUSTED"`);
    }
  }
  if (!anyLetterSourceLlmAdjusted) {
    console.log('  صفر ظهور لِـ"LLM_ADJUSTED" في أيّ ملفّ من الـ' + actualFiles.length + ' — لا letterSource="LLM_ADJUSTED" في أي عيّنة ذهبية.');
  }

  console.log(`\n=== (ب) applied===true في مخرَج كل مولّد (${Object.keys(GENERATED_AND_GUARDED).length} مولّداً) ===`);
  let anyAppliedTrue = false;
  for (const [file, info] of Object.entries(GENERATED_AND_GUARDED)) {
    const generatorPath = path.join(SCRIPTS_DIR, info.generator);
    let built;
    try {
      const mod = require(generatorPath);
      const buildFn = mod[info.buildFnName];
      if (typeof buildFn !== 'function') {
        console.log(`  ${file}: ⚠️ مولّده (${info.generator}) لا يُصدِّر ${info.buildFnName} كدالّة — يُتجاوَز، راجع يدوياً`);
        continue;
      }
      built = buildFn();
    } catch (e) {
      console.log(`  ${file}: ⚠️ تعذّر استدعاء المولّد (${info.generator}): ${e.message} — يُتجاوَز، راجع يدوياً`);
      continue;
    }
    const records = [];
    collectAdjustmentRecords(built, '', records);
    const applied = records.filter((r) => r.applied === true);
    if (applied.length > 0) {
      anyAppliedTrue = true;
      console.log(`  ⚠️ ${file} (${info.generator}): ${applied.length} تعديلاً applied=true — ${JSON.stringify(applied)}`);
    } else if (records.length > 0) {
      console.log(`  ${file}: ${records.length} سجلّ adjustments، كلّها applied=false — ${JSON.stringify(records.map((r) => ({category: r.category, rejectedReason: r.rejectedReason})))}`);
    } else {
      console.log(`  ${file}: لا سجلّ adjustments في مخرَج مولّده إطلاقاً (شكل V6/verifyReport لا يحمل هذا الحقل أصلاً)`);
    }
  }
  if (!anyAppliedTrue) {
    console.log('\n  صفر تعديل applied=true في مخرَج أيّ من الثمانية مولّدات.');
  }

  console.log(`\n=== الخلاصة ===`);
  console.log(`letterSource="LLM_ADJUSTED" في أي عيّنة ذهبية: ${anyLetterSourceLlmAdjusted ? 'نعم' : 'لا'}`);
  console.log(`تعديل applied=true في مخرَج أي مولّد: ${anyAppliedTrue ? 'نعم' : 'لا'}`);
}

if (require.main === module) {
  main();
}

module.exports = {collectAdjustmentRecords, isAdjustmentRecordShaped, GENERATED_AND_GUARDED};

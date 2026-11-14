'use strict';

// expectedV7PayloadBytes.test.js — بوّابة السويت العادية على حجم حمولة
// V7 (أمر مستخدم 2026-09-23 +03، البند ٤: "الثابتان في وحدة واحدة
// مُصدَّرة، يستوردها الاختبار الجديد وmeasure-callAIv7-live.js معاً").
//
// **لماذا هذا الاختبار يوجد الآن**: قبل هذه المهمّة، ثابت payloadBytes
// عاش فقط داخل scripts/measure-callAIv7-live.js — سكربت لا يُشغَّل مع
// `node test/*.test.js` العادي. فخمسة التزامات كبَّرت الحمولة 5490
// بايتاً (30ef54a + 4b52c8f) بلا أن يفشل أي اختبار — السويت كان أخضر
// بالكامل. هذا الاختبار يُشغَّل مع السويت العادي فيصير أي نموّ غير
// مُسمّى في الحمولة إخفاقاً فورياً، لا صامتاً حتى --dry-run يدوي.
//
// Run: node functions/test/expectedV7PayloadBytes.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {EXPECTED_V7_PAYLOAD_BYTES, GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

ok(Array.isArray(EXPECTED_V7_PAYLOAD_BYTES) && EXPECTED_V7_PAYLOAD_BYTES.length === 2,
    'إعداد: EXPECTED_V7_PAYLOAD_BYTES يحمل فِخّين بالضبط');

const frMap = loadJson('functionalResults-by-scanid.json').byScanId;

// أمر مستخدم 2026-09-24 +03 (القرار ٧٥ البند ٤) — analyzedAtMs صار مُدخَلاً
// لـcomputeCategoryStates (بوّابة PATCH_AGE). هذا الاختبار يقيس **الحمولة
// الحقيقية كما يبنيها الإنتاج فعلياً** (exports.analyzeDevice يمرّر
// functionStartTime حقيقياً دائماً) — فقيمة ثابتة موسومة هنا (لا Date.now()،
// يكسر تكراريّة الرقم المرجعي) تمثّل ذلك الواقع، لا حالة "الساعة غائبة"
// (PATCH_AGE=UNKNOWN) التي لا تقع في الإنتاج الحيّ إطلاقاً.
// ⚠️ **تصحيح 2026-10-01 +03**: كانت هذه القيمة مُعرَّفة محلّياً هنا فقط —
// GOLDEN_ANALYZED_AT_MS الآن مصدر واحد مُصدَّر من expectedV7PayloadBytes.js
// (القاعدة 24)، يستورده measure-resolveV7Report-live.js (المسار الذهبي)
// أيضاً، فتتطابق بوّابة البايتات بين الاختبار والسكربت الحيّ.

for (const target of EXPECTED_V7_PAYLOAD_BYTES) {
  const raw = loadJson(target.tsFile);
  const functional = frMap[target.scanId];
  ok(Array.isArray(functional) && functional.length > 0, `إعداد: functionalResults حقيقية لـ${target.scanId} موجودة`);

  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
    analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  const {userMessage} = buildV7Payload({
    findings, categoryStates, language: 'ar', scanId: target.scanId, isFreeTrial: false, previousScan: null,
  });

  eq(userMessage.length, target.expectedPayloadBytes,
      `[${target.scanId}] payloadBytes = ${target.expectedPayloadBytes} — أي فرق يعني حقلاً جديداً وصل حمولة النموذج بلا تسمية ` +
      `(راجع src/analysis/expectedV7PayloadBytes.js لتاريخ الرقم حقلاً حقلاً، وscripts/measure-payload-history.js لإعادة القياس)`);
}

console.log(`\nexpectedV7PayloadBytes.test.js: ${n}/${n} assertions passed`);

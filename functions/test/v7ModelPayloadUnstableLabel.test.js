'use strict';

// v7ModelPayloadUnstableLabel.test.js — وسم «غير مستقرّ» لا يصل النموذج، بنصّ قرارَي المستخدم.
//   أمر 2026-10-07 +03 (أوّل): «يُحجب unstable وclass وlabel للاختبارات الأربعة في UNSTABLE_IDS (C-03 وC-04 وS-04 وS-05) في نسخة النموذج.»
//   قرار 2026-10-07 +03 (لاحق، يستبدل الأوّل — القاعدة 23؛ سببه: «unstable» لا يبلغ صفراً بالأوّل لأن unstable:false بقي على غير الأربعة
//   والمفتاح unstableMeasurements نفسه يحوي الكلمة): «(أ) يُحذف حقل unstable من كل اختبار. (ب) تُحذف findings.unstableMeasurements كلّها.
//   ثم يُعدّ بالأداة: «unstable» و«غير مستقر» و«UNSTABLE» = 0 في الحمولة.» + «السطر 108 («UNSTABLE موسوم صراحةً…») يُحذف، ولا بديل له.»
//   كلّه في نسخة النموذج وحدها — والمخزَّن (findings وcategoryStates) لا يتغيّر (بصمة sha256).
//
// الاختبار القديم في هذا الملفّ (يثبّت بقاء unstable:false وبقاء المفتاح unstableMeasurements في الحمولة) استُبدل هنا ولم يُضَف إليه.
//
// Run: node functions/test/v7ModelPayloadUnstableLabel.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildV7Payload, _internal} = require('../src/analysis/buildV7Payload');
const {MODEL_STATE_TEXT} = require('../src/analysis/v7ModelPayloadWhitelist');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {computeFindings} = require('../src/analysis/findings');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');
const {UNSTABLE_IDS} = require('../src/analysis/testKinds');
const {getSystemPromptV7} = require('../src/prompts/systemPromptV7');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
const FR = loadJson('functionalResults-by-scanid.json').byScanId;
const SCANS = [
  ['b45c8cf6', 'b45c8cf6.ts.json', 'b45c8cf6-e376-4765-8703-f68e9bc69844'],
  ['34dff2b8', '34dff2b8.ts.json', '34dff2b8-ce9e-4b40-86a9-1976c878e195'],
  ['Honor', 'e4b65a2f-honor.ts.json', 'e4b65a2f-3a0c-4f11-939d-17eab7d0912f'],
  ['S10', '8909e850-s10.ts.json', '8909e850-b10c-466c-899a-ce97cb5c4fbe'],
];
const count = (text, re) => (text.match(re) || []).length;
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

eq(JSON.stringify([...UNSTABLE_IDS].sort()), JSON.stringify(['C-03', 'C-04', 'S-04', 'S-05']), '[١] UNSTABLE_IDS = C-03 وC-04 وS-04 وS-05 (مصدرها testKinds.js)');
eq(_internal.MODEL_FINDINGS_POLICY.unstableMeasurements, 'REMOVE', '[١] MODEL_FINDINGS_POLICY.unstableMeasurements = REMOVE');
eq(_internal.MODEL_FINDINGS_POLICY.advisoryMeasurements, 'TESTS', '[١] advisoryMeasurements (S-06) لم تُمسّ');

let storedFlagTrue = 0;
let storedFlagFalse = 0;
for (const [label, tsFile, scanId] of SCANS) {
  const raw = loadJson(tsFile);
  const functional = FR[scanId];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  const storedBefore = sha({findings, categoryStates});
  const {body, userMessage} = buildV7Payload({findings, categoryStates, language: 'ar', scanId, isFreeTrial: false, previousScan: null});
  const bodyText = JSON.stringify(body);

  // ═══ المخزَّن لا يتغيّر، ويحمل ما حُجب (فالصفر أدناه فعل نسخة النموذج لا غياب المصدر) ═══
  eq(sha({findings, categoryStates}), storedBefore, `[٢][${label}] المخزَّن (findings + categoryStates) بصمته sha256 لم تتغيّر`);
  ok('unstableMeasurements' in findings, `[٢][${label}][إعداد] المخزَّن يحمل findings.unstableMeasurements`);
  for (const t of categoryStates.testResults) {
    if (t.unstable === true) storedFlagTrue++;
    else if (t.unstable === false) storedFlagFalse++;
  }

  // ═══ (أ) حقل unstable: لا اختبار في نسخة النموذج يحمله ═══
  // (Honor بلا functionalResults: testResults فارغة في المخزَّن وفي الحمولة معاً — الغياب يبقى غياباً)
  eq(body.testResults.length, categoryStates.testResults.length, `[٣][${label}] عدد اختبارات الحمولة = المخزَّن (${body.testResults.length})`);
  ok(body.testResults.every((t) => !('unstable' in t)), `[٣][${label}] لا اختبار في testResults يحمل حقل unstable`);
  // حالات الأربعة وقيمها كما كانت: «مقيس…» أو «غير مقيس» (حجب الاختبارات الأربعة لا يتعلّق بهذا القرار)
  for (const id of UNSTABLE_IDS) {
    const t = body.testResults.find((x) => x.testId === id);
    const stored = categoryStates.testResults.find((x) => x.testId === id);
    eq(!!t, !!stored, `[٣][${label}] ${id}: وجوده في testResults المُرسَل = وجوده في المخزَّن`);
    if (t) ok(t.outcome === MODEL_STATE_TEXT.measured || t.outcome === MODEL_STATE_TEXT.notMeasured, `[٣][${label}] ${id}: حالته «مقيس…» أو «غير مقيس» لا حكماً`);
  }

  // ═══ (ب) findings.unstableMeasurements: محذوفة كلّها؛ وبقيّة مفاتيح findings كما كانت ═══
  ok(!('unstableMeasurements' in body.findings), `[٤][${label}] body.findings.unstableMeasurements محذوفة`);
  ok('advisoryMeasurements' in body.findings, `[٤][${label}] findings.advisoryMeasurements (S-06) باقية`);

  // ═══ العدّ: «unstable» (بلا اعتبار لحالة الأحرف) و«غير مستقر» و«UNSTABLE» = 0 في userMessage وفي body ═══
  eq(count(userMessage, /unstable/gi), 0, `[٥][${label}] «unstable» (/unstable/i) في userMessage = 0`);
  eq(count(bodyText, /unstable/gi), 0, `[٥][${label}] «unstable» (/unstable/i) في body = 0`);
  eq(count(userMessage, /غير مستقر/g), 0, `[٥][${label}] «غير مستقر» في userMessage = 0`);
  eq(count(userMessage, /UNSTABLE/g), 0, `[٥][${label}] «UNSTABLE» في userMessage = 0`);
}
ok(storedFlagTrue > 0 && storedFlagFalse > 0, `[٦][إعداد] المخزَّن يحمل unstable:true (${storedFlagTrue}) وunstable:false (${storedFlagFalse}) — فغيابهما عن الحمولة فعل البناء`);

// ═══ التعليمات (ar وtr): لا ذكر للوسم بعد حذف السطر 108 ═══
for (const lang of ['ar', 'tr']) {
  const prompt = getSystemPromptV7(lang);
  eq(count(prompt, /unstable/gi), 0, `[٧][${lang}] «unstable» (/unstable/i) في التعليمات = 0`);
  eq(count(prompt, /غير مستقر/g), 0, `[٧][${lang}] «غير مستقر» و«غير مستقرّ» في التعليمات = 0`);
}

console.log(`v7ModelPayloadUnstableLabel.test.js: ${n}/${n} assertions passed`);

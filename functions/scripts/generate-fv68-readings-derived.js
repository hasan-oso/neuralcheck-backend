#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-fv68-readings-derived — الفخّ الذهبي لقرّاء fv68 في الخادم (القاعدة 39)
// ===================================================================
//
// الغرض (أمر المنسّق 2026-10-09 +03، PLAN-05 الدفعة ٤، البند ٩): «يُعاد توليد الفخّ الذهبي في الالتزام نفسه». قارئ fv68 الجديد
// (functions/src/analysis/fv68Reader.js) يُنتج كائن «قراءات» لكل حمولة. هذا السكربت يبني ذلك الكائن من الحمولات الأربع التي
// تُختبَر بها القرّاء (القاعدة 41) ويكتبه ملفّاً ذهبياً لكل منها، فيُمسك حارسُه (test/fv68ReadingsGolden.test.js) أيَّ تغيير في القارئ
// أو في عقده بلا إعادة توليد.
//
// المُدخلات (كلّها مُلتزَمة في المستودع، بلا شبكة وبلا Firestore وبلا مزوّد نموذج):
//   ٥-٧) حمولات fv70 الثلاث وحمولات fv71 الثلاث (أدناه). ١-٣) حمولات fv69 الثلاث المشتقّة (الدفعة ١٠، 2026-10-10؛ كانت fv68 — نسخ حرفية من NeuralChek، test/fixtures/golden/fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-*.json).
//   ٤)   حمولة 1.0.10 (fv67) — نسخة حرفية من مجلّد المنسّق (fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json)، الحقل fingerprint.
//
// ⚠️ **المُدخلات مشتقّة لا مسجَّلة من جهاز يعمل بـfv69** (ولم يُشحن fv68 في أيّ APK) (مرحلة ٢: عيّنة جهاز حقيقية بعد صدور APK fv68 — قيد مُعلَن). فالقراءات المولَّدة
// مشتقّة كذلك: تثبّت ما يقوله القارئ عن شكل العقد، لا ما يفعله جهاز حقيقي.
//
// الكتابة: **لا يكتب إلا مع `--write`** (التوليد قرار، لا أثر جانبي لتشغيل عابر). بلا وسيط: يطبع حالة كل ملفّ (مطابق/مختلف/غائب) ولا يكتب.
// وظيفة buildReadingsSamples() نقيّة في الذاكرة — يستوردها الحارس.
//
// Run:  node functions/scripts/generate-fv68-readings-derived.js            (يقارن فقط)
//       node functions/scripts/generate-fv68-readings-derived.js --write    (يكتب الملفّات العشرة: الأربعة الأصلية وثلاثة fv70 وثلاثة fv71 من **عيّنات المُنتِج** — حلّت (2026-10-18، مزامنة fv71) محلّ ست عيّنات كنتُ بنيتها من العقد)
// ===================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {readFv68} = require('../src/analysis/fv68Reader');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const APP_PAYLOAD_STEM = 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-';
// 2026-10-13 +03 (قرّاء D في fv70): حمولات fv70 الثلاث (نسخ حرفية من NeuralChek@80ca8c3، §٧-ط). fv69 تبقى مُدخلاً (التطبيقات القديمة ما زالت ترسل 69).
const APP_PAYLOAD_FV70_STEM = 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const FV67_REQUEST_FILE = 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json';
// 2026-10-18 +03 (مزامنة fv71): حمولات fv71 الثلاث **من المُنتِج** (NeuralChek@f9e0571: A-M02 وA-VOL وA-P6-13، صنعها اختبار التطبيق الذهبي من سلسلته الحقيقية، نسخة حرفية بـsha256 في test/fv68AppPayloadGoldenCopy.test.js).
// **حلّت محلّ العيّنات الست المبنيّة من العقد** (synthetic-from-contract, producer sample pending A-M02/A-VOL/A-P6-13 — حُذفت ومولّداتها واختباراتها: القاعدة 23، لا تُترك بجانبها). مشتقّة لا مسجَّلة من جهاز (appVersion مولَّد في التطبيق).
const APP_PAYLOAD_FV71_STEM = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const OUT_STEM = 'fv68-readings-derived-from-';

// outFile ← مصدره. اسم الملفّ يقول إنه «مشتقّ»، والمصدر يُسمّى (القاعدة 12: ما يُشتقّ من المسجَّل يُكتب في ملفّ جديد باسم يقول ذلك).
const INPUTS = [
  {outFile: `${OUT_STEM}app-payload-11ch-nothing-admitted.json`, source: `${APP_PAYLOAD_STEM}11ch-nothing-admitted.json`, fingerprintOf: (j) => j},
  {outFile: `${OUT_STEM}app-payload-13ch-selinux-blocked-policy.json`, source: `${APP_PAYLOAD_STEM}13ch-selinux-blocked-policy.json`, fingerprintOf: (j) => j},
  {outFile: `${OUT_STEM}app-payload-16ch-four-policies-truncated-failures.json`, source: `${APP_PAYLOAD_STEM}16ch-four-policies-truncated-failures.json`, fingerprintOf: (j) => j},
  {outFile: `${OUT_STEM}fv67-request-1.0.10-62507f4.json`, source: FV67_REQUEST_FILE, fingerprintOf: (j) => j.fingerprint},
  {outFile: `${OUT_STEM}app-payload-fv70-11ch-nothing-admitted.json`, source: `${APP_PAYLOAD_FV70_STEM}11ch-nothing-admitted.json`, fingerprintOf: (j) => j},
  {outFile: `${OUT_STEM}app-payload-fv70-13ch-selinux-blocked-policy.json`, source: `${APP_PAYLOAD_FV70_STEM}13ch-selinux-blocked-policy.json`, fingerprintOf: (j) => j},
  {outFile: `${OUT_STEM}app-payload-fv70-16ch-four-policies-truncated-failures.json`, source: `${APP_PAYLOAD_FV70_STEM}16ch-four-policies-truncated-failures.json`, fingerprintOf: (j) => j},
  {outFile: `${OUT_STEM}app-payload-fv71-11ch-nothing-admitted.json`, source: `${APP_PAYLOAD_FV71_STEM}11ch-nothing-admitted.json`, fingerprintOf: (j) => j},
  {outFile: `${OUT_STEM}app-payload-fv71-13ch-selinux-blocked-policy.json`, source: `${APP_PAYLOAD_FV71_STEM}13ch-selinux-blocked-policy.json`, fingerprintOf: (j) => j},
  {outFile: `${OUT_STEM}app-payload-fv71-16ch-four-policies-truncated-failures.json`, source: `${APP_PAYLOAD_FV71_STEM}16ch-four-policies-truncated-failures.json`, fingerprintOf: (j) => j},
];

const serialize = (readings) => JSON.stringify(readings, null, 2) + '\n';
const sha256Of = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// نقيّة: تقرأ الحمولات المُلتزَمة وتُرجع الكائنات والنصوص المتسلسلة. لا تكتب شيئاً.
function buildReadingsSamples() {
  return INPUTS.map((inp) => {
    const raw = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, inp.source), 'utf8'));
    const readings = readFv68(inp.fingerprintOf(raw));
    const text = serialize(readings);
    return {outFile: inp.outFile, source: inp.source, destPath: path.join(GOLDEN_DIR, inp.outFile), readings, text, sha256: sha256Of(text)};
  });
}

function main() {
  const write = process.argv.includes('--write');
  const samples = buildReadingsSamples();
  for (const s of samples) {
    let state;
    if (!fs.existsSync(s.destPath)) state = 'غائب';
    else state = sha256Of(fs.readFileSync(s.destPath, 'utf8').replace(/\r\n/g, '\n')) === s.sha256 ? 'مطابق' : 'مختلف';
    if (write) {
      fs.writeFileSync(s.destPath, s.text, 'utf8');
      console.log(`كُتب ${s.outFile}\t(كان: ${state})\t${s.sha256}`);
    } else {
      console.log(`${state}\t${s.outFile}\t${s.sha256}`);
    }
  }
  if (!write) console.log('\nلم يُكتب شيء (بلا --write).');
}

if (require.main === module) {
  main();
}

module.exports = {buildReadingsSamples, serialize, sha256Of, INPUTS, GOLDEN_DIR};

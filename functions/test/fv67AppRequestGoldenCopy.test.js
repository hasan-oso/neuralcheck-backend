'use strict';

// fv67AppRequestGoldenCopy.test.js — ما قبل أوّل نشر V8، البند ٥ (2026-10-09 +03).
//
// يحرس **النسخة الحرفية** لثلاثة ملفّات في test/fixtures/golden/ نُسخت بايتاً ببايت من مجلّد المنسّق
// evidence/v8-phase0/fv67-1010-request-from-34dff2b8/ (طلب analyzeDevice كما يرسله 1.0.10، NeuralChek@62507f4، من 34dff2b8.ts.json — الملفّ
// الزمني من 1.0.8-v6beta، fieldsVersion 67). مشتقّ لا مسجَّل. قارئه: analyzeDevice1010Compat.e2e.test.js.
//
// ثلاثة فحوص (على نمط fv68AppPayloadGoldenCopy.test.js)، ثم ما يلزم قارئه:
//   ١) sha256 للملفّات الثلاثة على البايتات الخام — مصدرها SHA256SUMS في مجلّد المنسّق (وأمر المنسّق: الطلب 9551a9c6…، الـkeys 830a65bc…).
//   ٢) الطلب JSON يُفكّ.
//   ٣) مفاتيحه تطابق ملفّ .keys.txt الذي بجانبه — مطابقة نصّية كاملة (192 سطراً).
//   ٤) ثوابت الطلب التي يقوم عليها قارئه: المفاتيح العليا الأربعة بلا sessionId، usePrecomputed=true، scanId يطابق header.scanId، 1606 عيّنة، fieldsVersion 67،
//      appVersion 1.0.8-v6beta — فلو أُعيد نسخ ملفّ آخر باسم هذا الملفّ فشل هنا لا في e2e بعد دقائق.
//
// Run: node functions/test/fv67AppRequestGoldenCopy.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const STEM = 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8';
const EXPECTED_SHA256 = {
  [`${STEM}.json`]: '9551a9c6c5f0c7a08737c4e13e5fafac561b642f12040399811e6cd84f143d89',
  [`${STEM}.keys.txt`]: '830a65bc5512f2e959e2f6e7b81b55f3ccda69dadfec3a26d532e2e5f4e77d8f',
  [`${STEM}.README.md`]: 'eb25a29991e06507bfcb6c31f97e0a9a47c4aa37c8a4ce2ce63a5811dabe7b33',
};
const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// نفس بناء مسارات الأمر («مسار منقوط، و[] بعد المصفوفة، والأسطر مرتّبة») — راجع fv68AppPayloadGoldenCopy.test.js لتفصيله.
function buildKeysText(root) {
  const paths = new Set();
  const walk = (value, prefix) => {
    if (Array.isArray(value)) {
      for (const el of value) if (el !== null && typeof el === 'object') walk(el, `${prefix}[]`);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const p = prefix === '' ? key : `${prefix}.${key}`;
        paths.add(p);
        walk(value[key], p);
      }
    }
  };
  walk(root, '');
  return [...paths].sort().map((p) => `${p}\n`).join('');
}

// ١ — sha256 على البايتات الخام
for (const [file, want] of Object.entries(EXPECTED_SHA256)) {
  const full = path.join(GOLDEN_DIR, file);
  ok(fs.existsSync(full), `[١] ${file} موجود`);
  eq(sha256Hex(fs.readFileSync(full)), want, `[١] sha256 ${file} = ما في SHA256SUMS (نسخة حرفية، لا تحويل أسطر ولا تعديل)`);
}
eq(fs.statSync(path.join(GOLDEN_DIR, `${STEM}.json`)).size, 204096, '[١] حجم الطلب 204096 بايتاً (أمر المنسّق)');

// ٢ — تفكيك
const request = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, `${STEM}.json`), 'utf8'));
ok(request && typeof request === 'object' && !Array.isArray(request), '[٢] الطلب كائن JSON');

// ٣ — مطابقة .keys.txt
const keysText = fs.readFileSync(path.join(GOLDEN_DIR, `${STEM}.keys.txt`), 'utf8');
eq(buildKeysText(request), keysText, '[٣] مفاتيح الطلب = .keys.txt حرفياً (مطابقة نصّية كاملة)');
eq(keysText.split('\n').filter(Boolean).length, 192, '[٣] 192 سطراً (أمر المنسّق)');

// ٤ — ثوابت الطلب
eq(Object.keys(request).sort().join(','), 'fingerprint,language,scanId,usePrecomputed', '[٤] المفاتيح العليا الأربعة وحدها — بلا sessionId (يُضاف في حالة QR وحدها)');
ok(!('sessionId' in request), '[٤] لا sessionId');
eq(request.usePrecomputed, true, '[٤] usePrecomputed=true (يرسله 1.0.10، ولا يقرؤه analyzeDevice — analyzeDevice.js يفكّ scanId/fingerprint/language/sessionId فقط)');
eq(request.language, 'ar', '[٤] language=ar');
const ts = request.fingerprint.timeSeries;
eq(request.scanId, ts.header.scanId, '[٤] scanId = timeSeries.header.scanId');
eq(request.scanId, 'bcab2f02-a4a3-45e0-831e-190bb2c1a0a4', '[٤] scanId القيمة البديلة الثابتة في الملفّ (README المجلّد)');
eq(ts.footer.fieldsVersion, 67, '[٤] fieldsVersion=67');
eq(ts.header.appVersion, '1.0.8-v6beta', '[٤] header.appVersion=1.0.8-v6beta (الملفّ الزمني من 1.0.8-v6beta)');
eq(ts.samples.length, 1606, '[٤] 1606 عيّنة');
eq(typeof ts.header.deviceFingerprint, 'string', '[٤] header.deviceFingerprint نصّ (يُشتقّ منه مسار Storage)');
ok(request.fingerprint.functionalResults.length > 0 && request.fingerprint.device.model, '[٤] functionalResults وdevice.model حاضران');
for (const f of ['buildFingerprint', 'buildBoard', 'buildHardware', 'buildBootloader']) {
  ok(!(f in request.fingerprint.device), `[٤] device.${f} غائب كما في README المجلّد (null في JVM)`);
}

console.log(`\nfv67AppRequestGoldenCopy.test.js: ${n}/${n} assertions passed`);

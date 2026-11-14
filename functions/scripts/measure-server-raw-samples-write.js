#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-server-raw-samples-write — القرار ٨٦ البند ٢ (نصّ الأمر
// حرفياً): "يُقاس أثر الكتابة على زمن analyzeDevice، والحدّ 130,000 كما
// قيس... وزمن الرفع إلى Storage لا يُقاس بلا شبكة. فقِس ما يُقاس محلّياً
// (زمن الضغط، والحجم)، واكتب «غير مقيس» للباقي. واذكر كيف يُقاس في
// الإنتاج."
//
// ⚠️ **صفر شبكة، صفر Storage حقيقي** (قيد الجولة: "لا نشر، ولا شبكة").
// يقيس فقط ما يمكن قياسه محلّياً على الآلة الحالية: تسلسل JSON.stringify
// وضغط gzip لعيّنات حقيقية من فخّ ذهبي — بلا bucket.file().save() فعلي.
//
// ─── هل الكتابة تمسّ DEEPSEEK_TIMEOUT_MS (130,000ms، callDeepSeek.js:25)؟
// لا — بالتصميم (analyzeDevice.js: saveServerRawSamples تبدأ **قبل**
// `await runAnalysisInternal` مباشرة، على وعد منفصل غير مُنتظَر إلا بعد
// عودة runAnalysisInternal). زمن نداء DeepSeek/Gemini الفعلي (داخل
// runAnalysisInternal) لا يتغيّر بحرف واحد بوجود هذا الوعد الموازي أو
// غيابه — حلقة الأحداث تُقدِّم كليهما معاً. الأثر الوحيد الممكن نظرياً:
// لو تجاوز زمن (تسلسل + ضغط + رفع) هذا وحده مدّة نداء النموذج الفعلي على
// نفس الفحص — عندها الـ await النهائي (قبل buildReportDocument) سينتظر
// الفارق. هذا القياس يقيس الجزء المحلّي فقط (تسلسل+ضغط)؛ الرفع نفسه غير
// مقيس هنا (يحتاج شبكة) — راجع القسم الأخير لكيفية قياسه في الإنتاج.
//
// Usage: node functions/scripts/measure-server-raw-samples-write.js [--iterations N]
// ===================================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const FIXTURES = ['b45c8cf6.ts.json', '34dff2b8.ts.json', 'e4b65a2f-honor.ts.json'];

function loadSamples(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
  const samples = raw.samples || (raw.timeSeries && raw.timeSeries.samples) || [];
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`measure-server-raw-samples-write: ${name} بلا samples فعلية — توقّف`);
  }
  return samples;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function measureOne(name, iterations) {
  const samples = loadSamples(name);
  const json = JSON.stringify(samples);
  const rawBytes = Buffer.byteLength(json, 'utf-8');

  // الضغط المتزامن (gzipSync) — نفس الخوارزمية التي يستعملها الرفع
  // الفعلي (لكن الكود الحقيقي في serverRawSamplesStorage.js يستعمل
  // zlib.gzip **غير المتزامن**، لا Sync — راجع تعليق gzipAsync هناك: هذا
  // القياس المتزامن يقيس تكلفة CPU الخام للخوارزمية فقط، بمعزل عن حلقة
  // الأحداث، وهو ما يهمّنا هنا (زمن حجب محتمل لو استُعملت Sync خطأً).
  const durationsMs = [];
  let compressedBytes = null;
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    const gz = zlib.gzipSync(Buffer.from(json, 'utf-8'));
    const t1 = process.hrtime.bigint();
    durationsMs.push(Number(t1 - t0) / 1e6);
    compressedBytes = gz.length;
  }

  return {
    name,
    sampleCount: samples.length,
    rawBytes,
    compressedBytes,
    compressionRatio: compressedBytes ? (rawBytes / compressedBytes) : null,
    durationsMs,
    medianMs: median(durationsMs),
    maxMs: Math.max(...durationsMs),
    minMs: Math.min(...durationsMs),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const iterIdx = argv.indexOf('--iterations');
  const iterations = iterIdx !== -1 ? parseInt(argv[iterIdx + 1], 10) : 20;

  console.log(`=== measure-server-raw-samples-write — ${iterations} تكراراً لكل فخّ ===\n`);

  const results = FIXTURES.map((f) => measureOne(f, iterations));
  for (const r of results) {
    console.log(`${r.name}:`);
    console.log(`  عدد العيّنات: ${r.sampleCount}`);
    console.log(`  الحجم الخام (JSON.stringify): ${r.rawBytes.toLocaleString()} بايت`);
    console.log(`  الحجم بعد gzip: ${r.compressedBytes.toLocaleString()} بايت (نسبة ${r.compressionRatio.toFixed(2)}×)`);
    console.log(`  زمن الضغط (${iterations} تكراراً): وسيط=${r.medianMs.toFixed(3)}ms أدنى=${r.minMs.toFixed(3)}ms أقصى=${r.maxMs.toFixed(3)}ms`);
    console.log('');
  }

  const allMedians = results.map((r) => r.medianMs);
  console.log(`الوسيط الأقصى عبر الفِخّاخ الثلاثة: ${Math.max(...allMedians).toFixed(3)}ms`);
  console.log('');
  console.log('=== غير مقيس هنا (يحتاج شبكة) ===');
  console.log('  - زمن bucket.file(path).save() الفعلي (رفع Cloud Storage الحقيقي).');
  console.log('  - زمن التسلسل غير المتزامن (zlib.gzip الفعلي، لا gzipSync) تحت حمل Cloud Functions الحقيقي.');
  console.log('');
  console.log('=== كيف يُقاس في الإنتاج (نفس منهج RESERVED_FOR_DOCUMENT_WRITE_MS، analyzeDevice.js:22-30) ===');
  console.log('  لفّ الـ await على saveServerRawSamples بزمن Date.now() قبل/بعد (أو الاعتماد على');
  console.log('  console.time داخل saveServerRawSamples نفسها)، وجمع عيّنة من سجلّات Cloud Logging');
  console.log('  عبر عدّة فحوص حقيقية (نفس أسلوب "8 طلبات مربوطة من سجلّات الإنتاج" الموثَّق هناك) —');
  console.log('  لا رقم واحد يُعمَّم من قياس محلّي بلا شبكة.');
  console.log('');
  console.log('=== الأثر على ميزانية 130,000ms (DEEPSEEK_TIMEOUT_MS، callDeepSeek.js:25) ===');
  console.log('  لا أثر بالتصميم — الحفظ يبدأ موازياً لـ runAnalysisInternal (قبل الـ await)،');
  console.log('  لا داخل مهلة نداء DeepSeek/Gemini نفسها. راجع تعليق رأس هذا الملفّ للتفصيل.');
}

if (require.main === module) {
  main();
}

module.exports = {measureOne, loadSamples};

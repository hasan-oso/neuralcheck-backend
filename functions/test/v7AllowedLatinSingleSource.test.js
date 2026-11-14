'use strict';

// v7AllowedLatinSingleSource.test.js — قرار مستخدم 2026-10-07 +03 (بنصّه): «القائمة: NeuralCheck، والحروف A وB وC وD، وQR، وUSB، وWi-Fi، وBluetooth،
// وNFC، وGPS، وVulkan، وOpenGL. ومعها، كما هو اليوم، أسماء الأجهزة والشرائح والعلامات والوحدات الواردة في بيانات الجهاز. يقرؤها من الملفّ نفسه:
// التعليمات، وحارس اللغة، وسكربت فحص S5 (بدل ALLOWED_LATIN_BARE). اختبار: «Bluetooth» و«QR» و«Vulkan» تُقبل على جهاز لا تذكرها بياناته
// (Honor وS10)، وكلمة لاتينية خارج القائمة تُرفض.»
//
// يستبدل v7LanguageGuardInterfaceNames.test.js (القاعدة 23: كان يثبّت قائمة من اسمين، ولا يثبّت Bluetooth وQR عمداً لأن الحارس كان يرفضهما).
//
// المقيس قبل القرار (scratchpad/r3-measure.js على computeLeaksV7، جملة «الجهاز يدعم <الاسم> بشكل جيد.»): Bluetooth وQR وVulkan وOpenGL مرفوضة بلا ctx
// وعلى Honor وS10؛ وعلى b45c8cf6 و34dff2b8 تمرّ Bluetooth وVulkan وOpenGL بحكم البيانات وحدها وتُرفض QR.
//
// المسار الحقيقي كاملاً (القاعدة 37): guardV7Response وcheckS5Rules نفساهما بلا استبدال طبقة. وضوابط سلبية: كلمة لاتينية خارج القائمة تبقى مرفوضة.
//
// Run: node functions/test/v7AllowedLatinSingleSource.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {ALLOWED_LATIN, ALLOWED_LATIN_LIST, ALLOWED_LATIN_TOKENS} = require('../src/analysis/allowedLatin');
const {guardV7Response, buildLeakExemptionIndex, computeLeaksV7} = require('../src/analysis/reportShapeV7');
const {checkS5Rules} = require('../scripts/check-s5-narrative-rules');
const {getSystemPromptV7} = require('../src/prompts/systemPromptV7');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {computeFindings} = require('../src/analysis/findings');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');

const ROOT = path.join(__dirname, '..');
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
const FR = loadJson('functionalResults-by-scanid.json').byScanId;
const SCANS = [
  ['b45c8cf6', 'b45c8cf6.ts.json', 'b45c8cf6-e376-4765-8703-f68e9bc69844'],
  ['34dff2b8', '34dff2b8.ts.json', '34dff2b8-ce9e-4b40-86a9-1976c878e195'],
  ['Honor', 'e4b65a2f-honor.ts.json', 'e4b65a2f-3a0c-4f11-939d-17eab7d0912f'],
  ['S10', '8909e850-s10.ts.json', '8909e850-b10c-466c-899a-ce97cb5c4fbe'],
];

// ═══ ١ — المصدر: القرار بترتيبه حرفاً ═══
deepEq([...ALLOWED_LATIN_LIST], ['NeuralCheck', 'A', 'B', 'C', 'D', 'QR', 'USB', 'Wi-Fi', 'Bluetooth', 'NFC', 'GPS', 'Vulkan', 'OpenGL'],
    '[١] القائمة المسطّحة = القرار بترتيبه: NeuralCheck، A B C D، QR، USB، Wi-Fi، Bluetooth، NFC، GPS، Vulkan، OpenGL');
deepEq([...ALLOWED_LATIN_TOKENS], ['neuralcheck', 'a', 'b', 'c', 'd', 'qr', 'usb', 'wi', 'fi', 'bluetooth', 'nfc', 'gps', 'vulkan', 'opengl'],
    '[١] التوكِنز (lowercase، مقسَّمة على غير الحرف والرقم): Wi-Fi ← wi وfi');
ok(Object.isFrozen(ALLOWED_LATIN) && Object.isFrozen(ALLOWED_LATIN_LIST) && Object.isFrozen(ALLOWED_LATIN_TOKENS), '[١] كلّها مجمّدة');

// ═══ ٢ — المصدر وحده: لا نسخة في القرّاء الثلاثة (القاعدة 24) ═══
const readers = {
  'src/analysis/reportShapeV7.js': "require('./allowedLatin')",
  'src/prompts/systemPromptV7.js': "require('../analysis/allowedLatin')",
  'scripts/check-s5-narrative-rules.js': "require('../src/analysis/allowedLatin')",
};
for (const [rel, importText] of Object.entries(readers)) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  ok(src.includes(importText), `[٢] ${rel} يستورد المصدر الواحد`);
  // نسخة = قائمة/Set حرفية (بين [ ]) تحمل اسماً من القائمة بين علامتَي اقتباس، خارج التعليقات. (ذكر GPS في رسالة قاعدة GPS_NAMING ليس نسخة.)
  const codeLines = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//'));
  const copies = codeLines.filter((l) => /\[[^\]]*['"`](NeuralCheck|QR|USB|Wi-Fi|Wi|Fi|Bluetooth|NFC|GPS|Vulkan|OpenGL)['"`][^\]]*\]/i.test(l));
  deepEq(copies, [], `[٢] ${rel}: لا قائمة/Set حرفية تحمل اسماً من القائمة (نسخة)`);
}
ok(!fs.readFileSync(path.join(ROOT, 'scripts/check-s5-narrative-rules.js'), 'utf8').includes("new Set(['neuralcheck'"), '[٢] ALLOWED_LATIN_BARE لم يعد قائمة حرفية');

// ═══ ٣ — حارس اللغة (guardV7Response الحقيقية): بلا ctx وعلى المدخلات الأربعة ═══
const base = (summary, extra) => ({
  narrative: Object.assign({
    summary,
    details: 'نصّ تفاصيل عادي.',
    verdict: 'خلاصة عادية.',
    buyerAdvice: {casual: 'نصّ.', gamer: 'ومعالج الرسومات Mali-G76 يدعم Vulkan.', photographer: 'نصّ.'},
    issueDescriptions: {},
  }, extra || {}),
  crossChecks: [], adjustments: [], modelObservations: [],
});
const ALLOWED_TEXT = 'تقرير NeuralCheck يعرض الحرف A أو B أو C أو D، ويذكر QR وUSB وWi-Fi وBluetooth وNFC وGPS وVulkan وOpenGL.';

const ctxs = [['بلا ctx', undefined]];
const cs4 = {};
for (const [label, tsFile, scanId] of SCANS) {
  const raw = loadJson(tsFile);
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: FR[scanId], manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: FR[scanId], manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  ctxs.push([label, {findings, categoryStates}]);
  cs4[label] = {findings, categoryStates};
}
const NAMED = ['NeuralCheck', 'QR', 'USB', 'Bluetooth', 'NFC', 'GPS', 'Vulkan', 'OpenGL'];
for (const [label, ctx] of ctxs) {
  const g = guardV7Response(base(ALLOWED_TEXT), ctx);
  eq(g.shape.ok, true, `[٣][${label}] الشكل سليم`);
  deepEq(g.languageLeaks, [], `[٣][${label}] حارس اللغة لا يرفض أيّاً من القائمة (NeuralCheck وA-D وQR وUSB وWi-Fi وBluetooth وNFC وGPS وVulkan وOpenGL)`);
  eq(g.ok, true, `[٣][${label}] guardV7Response.ok = true`);
  const excl = g.excluded.languageTokens;
  for (const w of [...NAMED, 'Wi', 'Fi']) {
    const e = excl.filter((x) => x.token === w);
    ok(e.length >= 1, `[٣][${label}] ${w} مُسجَّل في excluded`);
    ok(e.every((x) => x.category === 'allowed_latin'), `[٣][${label}] ${w}: الفئة allowed_latin — الصريحة تسبق فئات البيانات`);
  }
}

// «Bluetooth» و«QR» و«Vulkan» على جهاز لا تذكرها بياناته: Honor وS10 — الشرط المسبق بالمُجمِّعات المُصدَّرة (بيانات الجهاز لا تحمل أيّاً منها)
for (const label of ['Honor', 'S10']) {
  const {findings, categoryStates} = cs4[label];
  const dev = require('../src/analysis/reportShapeV7').collectDeviceReference(categoryStates).tokens;
  const R = require('../src/analysis/reportShapeV7');
  const dataTokens = new Set([...dev, ...R.collectFindingsFieldNameTokens(findings, categoryStates), ...R.collectGateNameTokens(findings, categoryStates),
    ...R.collectMeasurementUnitTokens(findings, categoryStates)]);
  for (const w of ['bluetooth', 'qr', 'vulkan']) ok(!dataTokens.has(w), `[٣][${label}][إعداد] بيانات الجهاز لا تذكر ${w} (لا يُقبل بحكم البيانات)`);
  const ctx = {findings, categoryStates};
  for (const w of ['Bluetooth', 'QR', 'Vulkan']) {
    deepEq(computeLeaksV7({narrative: {summary: `الجهاز يدعم ${w} بشكل جيد.`}}, ctx).leaks, [], `[٣][${label}] ${w} تُقبل على جهاز لا تذكرها بياناته`);
  }
}

// ═══ ٤ — التوكِنة وحالة الأحرف (تُبلَّغ وتُختبَر) ═══
// «Wi-Fi» يقسّمها findEnglishLeaks عند الشرطة إلى توكِنَين wi وfi، والفهرس يحمل الاثنين؛ و«NeuralCheck» توكِن واحد، والمقارنة بـtoLowerCase.
const idx = buildLeakExemptionIndex();
eq(idx.get('wi'), 'allowed_latin', '[٤] wi ← allowed_latin (نصف Wi-Fi)');
eq(idx.get('fi'), 'allowed_latin', '[٤] fi ← allowed_latin (نصف Wi-Fi)');
eq(idx.get('neuralcheck'), 'allowed_latin', '[٤] neuralcheck ← allowed_latin');
for (const variant of ['NeuralCheck', 'neuralcheck', 'NEURALCHECK']) {
  deepEq(computeLeaksV7({narrative: {summary: `تطبيق ${variant} يعرض التقرير.`}}).leaks, [], `[٤] «${variant}»: لا اعتبار لحالة الأحرف في الحارس`);
}
deepEq(computeLeaksV7({narrative: {summary: 'الاتصال عبر Wi-Fi مستقرّ.'}}).leaks, [], '[٤] «Wi-Fi» تُقبل (التوكِنان wi وfi)');
deepEq(computeLeaksV7({narrative: {summary: 'الحرف A ثم B ثم C ثم D.'}}).leaks, [], '[٤] الحروف A وB وC وD: توكِن بحرف واحد لا يستخرجه الحارس أصلاً (يشترط حرفين فأكثر)');
// رموز الوحدات الثابتة لم تتأثّر بنقل Wi/Fi/NFC/USB إلى القائمة الجديدة
eq(idx.get('ghz'), 'unit_symbol', '[٤] ghz ما زالت unit_symbol');
eq(idx.get('esim'), 'unit_symbol', '[٤] esim ما زالت unit_symbol');
eq(idx.get('api'), 'unit_symbol', '[٤] api ما زالت unit_symbol');
eq(idx.get('nfc'), 'allowed_latin', '[٤] nfc صارت allowed_latin (كانت unit_symbol — مصدر واحد، لا نسخة في قائمة الوحدات)');

// ═══ ٥ — ضوابط سلبية: كلمة لاتينية خارج القائمة تُرفض (بلا ctx وعلى الأربعة) ═══
for (const [label, ctx] of ctxs) {
  for (const other of ['Metal', 'DirectX', 'Firebase']) {
    const g = guardV7Response(base(`الجهاز يدعم ${other} بشكل جيد.`), ctx);
    ok(g.languageLeaks.length === 1 && g.languageLeaks[0].tokens.includes(other), `[٥][${label}] ${other} (خارج القائمة) تبقى مرفوضة`);
    eq(g.ok, false, `[٥][${label}] guardV7Response.ok = false بسبب ${other}`);
  }
}

// ═══ ٦ — سكربت فحص S5 (checkS5Rules الحقيقية، بلا ctx): يقرأ المصدر نفسه ═══
const s5 = (summary) => checkS5Rules({narrative: {summary, details: 'تفصيل عادي.', verdict: 'حكم عادي.', buyerAdvice: {casual: 'نصيحة.', gamer: 'نصيحة.', photographer: 'نصيحة.'}}}, null);
const latinViolations = (res) => res.violations.filter((v) => v.rule === 'LATIN_OUTSIDE_ALLOWLIST').map((v) => v.match.toLowerCase());
deepEq(latinViolations(s5(ALLOWED_TEXT)), [], '[٦] نصّ فيه كل القائمة: صفر LATIN_OUTSIDE_ALLOWLIST');
deepEq(latinViolations(s5('الجهاز يدعم Metal وDirectX.')).sort(), ['directx', 'metal'], '[٦] كلمتان خارج القائمة: مُبلَّغ بهما');

// ═══ ٧ — التعليمات (ar وtr): الجملة من المصدر، بترتيب القرار، وصفر «غير مستقر» ═══
const COMM = `رموز التواصل القياسية ${ALLOWED_LATIN.communicationSymbols.join(' و')}،`;
const IFACE = `أسماء الواجهات التقنية ${ALLOWED_LATIN.interfaceNames.join(' و')}،`;
for (const lang of ['ar', 'tr']) {
  const prompt = getSystemPromptV7(lang).split('\r\n').join('\n');
  const start = prompt.indexOf('المسموح اليوم حصراً:');
  ok(start > -1, `[٧][${lang}] فقرة اللاتيني المسموح موجودة`);
  const para = prompt.slice(start, prompt.indexOf('لا كلمة إنجليزية تقنية أخرى تتسرّب', start));
  ok(para.includes('اسم المنتج NeuralCheck، الحروف A إلى D\n(الحرف الدرجة)، ' + COMM + '\n' + IFACE + '\n'),
      `[٧][${lang}] الجملة: اسم المنتج، الحروف A إلى D، ${COMM} ${IFACE}`);
  const order = ['NeuralCheck', 'A إلى D', 'QR', 'USB', 'Wi-Fi', 'Bluetooth', 'NFC', 'GPS', 'Vulkan', 'OpenGL'].map((t) => para.indexOf(t));
  ok(order.every((p, i) => p > -1 && (i === 0 || p > order[i - 1])), `[٧][${lang}] ظهور الأسماء والحروف في الفقرة بترتيب القرار`);
  for (const t of ['NeuralCheck', 'QR', 'USB', 'Wi-Fi', 'Bluetooth', 'NFC', 'GPS', 'Vulkan', 'OpenGL']) {
    eq(para.split(t).length - 1, 1, `[٧][${lang}] ${t} مرّة واحدة في الفقرة`);
  }
  eq((prompt.match(/unstable/gi) || []).length, 0, `[٧][${lang}] «unstable» (بلا اعتبار لحالة الأحرف) في التعليمات = 0`);
  eq((prompt.match(/غير مستقر/g) || []).length, 0, `[٧][${lang}] «غير مستقر» (ومنها «غير مستقرّ») في التعليمات = 0`);
  ok(prompt.includes('SPEC لا يدخل حرفاً أبداً،\n   not_tested/unavailable لهما سبب مُسمّى لا "فشل".'), `[٧][${lang}] الجملة بعد حذف عبارة UNSTABLE: «SPEC لا يدخل حرفاً أبداً، not_tested/unavailable…»`);
}

console.log(`v7AllowedLatinSingleSource.test.js: ${n}/${n} assertions passed`);

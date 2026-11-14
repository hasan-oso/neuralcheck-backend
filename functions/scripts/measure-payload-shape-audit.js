#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-payload-shape-audit — قياس كلفة "قائمة بيضاء عند البناء"
// (اقتراح المستخدم، أمر 2026-09-23) على حمولة V7 الفعلية (buildV7Payload.body،
// لا userMessage النصّي) — **قبل** أي قرار تنفيذ. لا يُعدِّل أي كود إنتاجي.
//
// يقيس على الشجرة الحالية، لكلا الفِخّين الذهبيَّين (b45c8cf6/34dff2b8):
//   (أ) عدد مسارات الأوراق الفريدة — خاماً (فهارس مصفوفة/أسماء فئة حرفية)
//       ثم مطويّاً (فهارس المصفوفات → [] ، categories.<cat> → *).
//   (ب) عدد أشكال الكائنات المتمايزة (بصمة = مجموعة المفاتيح مُرتَّبة)،
//       مع تسمية يدوية لكل بصمة معروفة (gate/testResult/categoryEntry/...).
//   (ج) هل مفاتيح findings.* ثابتة أم مولَّدة ديناميكياً — بمقارنة مباشرة
//       بين الفِخّين: أي مفتاح يظهر في أحدهما ويغيب عن الآخر هو دليل مباشر
//       على أنه ليس اسماً ثابتاً في الكود.
//   (د) طول قائمة الاستبعاد الحالية (MODEL_PAYLOAD_EXCLUDED_*_FIELDS) وما
//       تصير عليه لو أُضيف MODEL_PAYLOAD_EXCLUDED_GATE_FIELDS المقترَح.
//   (هـ) الخيار الوسط: قائمة بيضاء لكل *نوع كائن* (لا للشجرة كاملةً) —
//       gate يُسقَط لحقول مُسمّاة صراحة، findings/testResults/categoryEntry
//       تمرّ كما هي. عدد الحقول المُسمّاة في هذا الخيار.
//   (و) عدد الحقول التي سرَدها buildCategoryEntryForStorage (A104) فعلياً،
//       بملفّ وسطر، للمقارنة.
//
// Usage: node functions/scripts/measure-payload-shape-audit.js [--out path]
// ===================================================================

const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const GOLDEN = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN, name), 'utf8')); }

const TARGETS = [
  {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json'},
  {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json'},
];

function buildBodyFor(scanId, tsFile) {
  const raw = loadJson(tsFile);
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const functional = frMap[scanId];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const cs = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  const {body} = buildV7Payload({
    findings, categoryStates: cs, language: 'ar', scanId, isFreeTrial: false, previousScan: null,
  });
  return body;
}

// ─── (أ) مسارات الأوراق — خام ومطويّ ────────────────────────────────────
function collectLeafPaths(node, rawPath, foldedPath, rawSet, foldedSet) {
  if (node === null || typeof node !== 'object') {
    rawSet.add(rawPath);
    foldedSet.add(foldedPath);
    return;
  }
  if (Array.isArray(node)) {
    if (node.length === 0) {
      // مصفوفة فارغة — ورقة فعلياً من منظور "شكل الحمولة" (لا عناصر لعدّها).
      rawSet.add(rawPath + '[]');
      foldedSet.add(foldedPath + '[]');
      return;
    }
    node.forEach((item, i) => {
      collectLeafPaths(item, `${rawPath}[${i}]`, `${foldedPath}[]`, rawSet, foldedSet);
    });
    return;
  }
  const keys = Object.keys(node);
  if (keys.length === 0) {
    rawSet.add(rawPath + '{}');
    foldedSet.add(foldedPath + '{}');
    return;
  }
  for (const k of keys) {
    // طيّ categoryStates.categories.<cat> إلى نجمة واحدة — نفس طيّ
    // categories.* في القرار الموصوف.
    const isCategoryLevel = /\.categories$/.test(rawPath) || rawPath === 'categoryStates.categories';
    const foldedKey = isCategoryLevel ? '*' : k;
    collectLeafPaths(node[k], `${rawPath}.${k}`, `${foldedPath}.${foldedKey}`, rawSet, foldedSet);
  }
}

// ─── (ب) بصمات أشكال الكائنات ────────────────────────────────────────────
const KNOWN_SHAPES = {
  // gate object (categoryStates.js: applyCeilings/applyOverallCeilings/
  // computeGates) — التوقيعان الممكنان (category-level بـcappedThisLetter،
  // overall-level بـcappedOverall).
  'category,ceilingLetter,coveragePct,name,source,status': 'gate (بلا capped*/belowThreshold — NOT_WIRED/DISABLED قبل applyCeilings)',
  'allNonMeasurement,belowThreshold,category,ceilingLetter,coveragePct,name,source,status': 'gate خام (قبل applyCeilings — لا يظهر فعلياً في الحمولة، احتياطي)',
  'allNonMeasurement,belowThreshold,cappedThisLetter,category,ceilingLetter,coveragePct,name,source,status': 'gate على مستوى الفئة (categories.<cat>.gatesApplied[])',
  'allNonMeasurement,belowThreshold,cappedOverall,category,ceilingLetter,coveragePct,name,source,status': 'gate على مستوى overall (overall.gatesApplied[])',
  'allNonMeasurement,belowThreshold,cappedThisLetter,category,ceilingLetter,coveragePct,name,note,source,status': 'gate فئة + note ("السقف أسوأ من الحرف الأساسي")',
  'allNonMeasurement,belowThreshold,cappedOverall,category,ceilingLetter,coveragePct,name,note,source,status': 'gate overall + note',
};

function shapeSignature(obj) {
  return Object.keys(obj).sort().join(',');
}

function collectObjectShapes(node, pathHint, shapeMap) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectObjectShapes(item, pathHint, shapeMap));
    return;
  }
  const sig = shapeSignature(node);
  if (!shapeMap.has(sig)) shapeMap.set(sig, {count: 0, examplePath: pathHint, keys: Object.keys(node)});
  shapeMap.get(sig).count++;
  for (const k of Object.keys(node)) collectObjectShapes(node[k], `${pathHint}.${k}`, shapeMap);
}

// ─── (ج) findings.* — مقارنة أسماء المفاتيح بين فِخّين مختلفين ──────────
function collectKeyPathsWithDepth(node, curPath, maxDepth, depth, out) {
  if (depth > maxDepth || node === null || typeof node !== 'object' || Array.isArray(node)) return;
  for (const k of Object.keys(node)) {
    const p = curPath ? `${curPath}.${k}` : k;
    out.add(p);
    collectKeyPathsWithDepth(node[k], p, maxDepth, depth + 1, out);
  }
}

// ═══════════════════════════════════════════════════════════════════════
const report = {generatedAt: new Date().toISOString(), scans: {}};

for (const {scanId, tsFile} of TARGETS) {
  const body = buildBodyFor(scanId, tsFile);
  const scanReport = {};

  // (أ)
  const rawSet = new Set(); const foldedSet = new Set();
  collectLeafPaths(body, '', '', rawSet, foldedSet);
  scanReport.leafPaths = {raw: rawSet.size, folded: foldedSet.size};

  // (ب)
  const shapeMap = new Map();
  collectObjectShapes(body, 'body', shapeMap);
  const shapes = [...shapeMap.entries()].map(([sig, info]) => ({
    signature: sig, count: info.count, examplePath: info.examplePath,
    fieldCount: info.keys.length, label: KNOWN_SHAPES[sig] || '(بلا تسمية يدوية)',
  })).sort((a, b) => b.count - a.count);
  scanReport.distinctObjectShapes = shapes.length;
  scanReport.shapes = shapes;

  // (ج) — findings فقط، أعماق 1-3
  const findingsKeys = new Set();
  collectKeyPathsWithDepth(body.findings, 'findings', 4, 0, findingsKeys);
  scanReport.findingsKeyPathCount = findingsKeys.size;
  scanReport._findingsKeysList = [...findingsKeys].sort();

  report.scans[scanId] = scanReport;
}

// مقارنة مفاتيح findings بين الفِخّين — أي مفتاح ظاهر في أحدهما وغائب عن
// الآخر دليل مباشر أنه ليس اسماً ثابتاً في الكود (دليل تجريبي، لا قراءة
// كود فقط).
const scanIds = TARGETS.map((t) => t.scanId);
const setA = new Set(report.scans[scanIds[0]]._findingsKeysList);
const setB = new Set(report.scans[scanIds[1]]._findingsKeysList);
const onlyInA = [...setA].filter((k) => !setB.has(k));
const onlyInB = [...setB].filter((k) => !setA.has(k));
report.findingsKeyDiffBetweenScans = {
  onlyIn_b45c8cf6: scanIds[0].startsWith('b45c8cf6') ? onlyInA : onlyInB,
  onlyIn_34dff2b8: scanIds[0].startsWith('b45c8cf6') ? onlyInB : onlyInA,
  note: 'أي مفتاح هنا موجود في فحص واحد وغائب عن الآخر — دليل تجريبي مباشر أنه مفتاح ديناميكي (اسم قناة/معرّف اختبار)، لا اسم ثابت في findings.js',
};
delete report.scans[scanIds[0]]._findingsKeysList;
delete report.scans[scanIds[1]]._findingsKeysList;

// (د) طول قائمة الاستبعاد الحالية
const buildV7PayloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', 'buildV7Payload.js'), 'utf8');
const {MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS, MODEL_PAYLOAD_EXCLUDED_OVERALL_FIELDS} =
  require('../src/analysis/buildV7Payload')._internal || {};
report.currentExclusionList = {
  category: MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS || 'غير مُصدَّرة عبر _internal — راجع buildV7Payload.js مباشرة',
  overall: MODEL_PAYLOAD_EXCLUDED_OVERALL_FIELDS || 'غير مُصدَّرة عبر _internal — راجع buildV7Payload.js مباشرة',
};

// (و) A104 — buildCategoryEntryForStorage field count، بملفّ وسطر.
// استخراج بعدّ الأقواس (لا تعبير نمطي هشّ) — الدالّة تحمل كائنات متداخلة
// (letterCeilingReason) قد تُخفق معها نهاية غير جشعة بسيطة.
const analyzeDeviceSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', 'analyzeDevice.js'), 'utf8');
const fnStartMarker = 'function buildCategoryEntryForStorage(cat, entry) {';
const fnStartIdx = analyzeDeviceSrc.indexOf(fnStartMarker);
if (fnStartIdx === -1) {
  console.error('⚠ (و) لم أجد buildCategoryEntryForStorage في analyzeDevice.js — تحقّق من اسم الدالّة/التوقيع');
} else {
  const bodyStart = fnStartIdx + fnStartMarker.length - 1; // عند '{' الافتتاحية
  let depth = 0; let endIdx = -1;
  for (let i = bodyStart; i < analyzeDeviceSrc.length; i++) {
    if (analyzeDeviceSrc[i] === '{') depth++;
    else if (analyzeDeviceSrc[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  const fnLineStart = analyzeDeviceSrc.slice(0, fnStartIdx).split('\n').length;
  const body2 = endIdx > -1 ? analyzeDeviceSrc.slice(fnStartIdx, endIdx + 1) : analyzeDeviceSrc.slice(fnStartIdx, fnStartIdx + 2000);
  // حقول out{...} الحرفية (4 مسافات بادئة، "اسم:") — الحقول المشتركة.
  const topLevelKeyMatches = [...body2.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  // حقول out.<name> = ... (البطارية فقط، شرط cat === "battery").
  const batteryExtraMatches = [...body2.matchAll(/^\s{4}out\.(\w+)\s*=/gm)].map((m) => m[1]);
  report.a104Reference = {
    file: 'functions/src/analysis/analyzeDevice.js',
    functionStartLine: fnLineStart,
    function: 'buildCategoryEntryForStorage',
    commonFieldsListed: topLevelKeyMatches,
    commonFieldsCount: topLevelKeyMatches.length,
    batteryExtraFieldsListed: batteryExtraMatches,
    batteryExtraFieldsCount: batteryExtraMatches.length,
    totalFieldsListedForBatteryCategory: topLevelKeyMatches.length + batteryExtraMatches.length,
  };
}

// (هـ) الخيار الوسط — قائمة بيضاء لكل نوع كائن، لا للشجرة كاملةً: كائن
// gate يُسقَط لحقول مُسمّاة، findings/testResults/categoryEntry تمرّ كما
// هي. نحدّد "كائن gate" بنيوياً (يحمل name+ceilingLetter+status معاً —
// بصمة فريدة في هذه الحمولة، لا افتراض شكل واحد) بدل قائمة بصمات يدوية
// قد تفوت شكلاً. نُعيد اتّحاد كل مفاتيحه عبر الحمولة كلّها (الحقل الكامل
// اليوم)، ثم نُبلغ حجم القائمة المُقترَحة (name/category/ceilingLetter/
// status + حقل سبب واحد) للمقارنة — بلا تطبيقها.
function collectGateLikeObjects(node, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((item) => collectGateLikeObjects(item, out)); return; }
  const keys = Object.keys(node);
  if (keys.includes('name') && keys.includes('ceilingLetter') && keys.includes('status')) out.push(node);
  for (const k of keys) collectGateLikeObjects(node[k], out);
}
{
  const bodyForGateScan = buildBodyFor(TARGETS[0].scanId, TARGETS[0].tsFile);
  const gateObjs = [];
  collectGateLikeObjects(bodyForGateScan, gateObjs);
  const unionKeys = new Set();
  for (const g of gateObjs) for (const k of Object.keys(g)) unionKeys.add(k);
  const proposedMinimal = ['name', 'category', 'ceilingLetter', 'status', 'source']; // source = "سبب موجز" مرشَّح، راجع التقرير
  report.middleGroundOption = {
    description: 'قائمة بيضاء على نوع "كائن gate" فقط (يُعرَّف بنيوياً: name+ceilingLetter+status معاً) — كل نوع آخر (findings/testResults/categoryEntry/إلخ) يمرّ بلا قائمة',
    gateObjectsFoundByStructure: gateObjs.length,
    currentGateObjectFieldUnion: [...unionKeys].sort(),
    currentGateObjectFieldCount: unionKeys.size,
    proposedMinimalGateFields: proposedMinimal,
    proposedMinimalGateFieldCount: proposedMinimal.length,
    note: 'source مُدرَج هنا كـ"سبب موجز" مرشَّح — راجع تقرير المهمّة لمناقشة هل هو تفصيل أم الحاجة نفسها؛ لم يُطبَّق شيء هنا، قياس فقط',
  };
  console.log(`\n(هـ) الخيار الوسط — كائنات gate بنيوية: ${gateObjs.length}، اتّحاد حقولها الحالي: ${unionKeys.size} (${[...unionKeys].sort().join(', ')})`);
  console.log(`  المُقترَح للمقارنة (بلا تطبيق): ${proposedMinimal.length} حقول — ${proposedMinimal.join(', ')}`);
}

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, {recursive: true});
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outPath = outIdx >= 0 ? argv[outIdx + 1] : path.join(OUT_DIR, `payload-shape-audit-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log('═══ measure-payload-shape-audit — موجز ═══\n');
for (const {scanId} of TARGETS) {
  const s = report.scans[scanId];
  console.log(`── ${scanId} ──`);
  console.log(`  (أ) مسارات الأوراق: خام=${s.leafPaths.raw}  مطويّ=${s.leafPaths.folded}`);
  console.log(`  (ب) أشكال كائنات متمايزة: ${s.distinctObjectShapes}`);
  for (const sh of s.shapes) {
    console.log(`      × ${String(sh.count).padStart(3)}  حقول=${sh.fieldCount}  ${sh.label}  (مثال: ${sh.examplePath})`);
  }
  console.log(`  (ج) مسارات مفاتيح findings (أعماق 1-4، بلا فهارس مصفوفة): ${s.findingsKeyPathCount}`);
  console.log('');
}
console.log('(ج) فرق مفاتيح findings بين الفِخّين (دليل الديناميكية):');
console.log(`  فقط في b45c8cf6: ${report.findingsKeyDiffBetweenScans.onlyIn_b45c8cf6.length} مفتاحاً`);
console.log(`  فقط في 34dff2b8: ${report.findingsKeyDiffBetweenScans.onlyIn_34dff2b8.length} مفتاحاً`);
console.log(`  أمثلة (حتى 10): ${[...report.findingsKeyDiffBetweenScans.onlyIn_b45c8cf6, ...report.findingsKeyDiffBetweenScans.onlyIn_34dff2b8].slice(0, 10).join(' | ')}`);

console.log(`\n(د) قائمة الاستبعاد الحالية:`);
console.log(`  category (${(report.currentExclusionList.category || []).length}): ${JSON.stringify(report.currentExclusionList.category)}`);
console.log(`  overall  (${(report.currentExclusionList.overall || []).length}): ${JSON.stringify(report.currentExclusionList.overall)}`);

if (report.a104Reference) {
  console.log(`\n(و) A104 مرجع — ${report.a104Reference.file}:buildCategoryEntryForStorage`);
  console.log(`  حقول مشتركة مسرودة: ${report.a104Reference.commonFieldsCount} — ${JSON.stringify(report.a104Reference.commonFieldsListed)}`);
  console.log(`  حقول بطارية إضافية: ${report.a104Reference.batteryExtraFieldsCount} — ${JSON.stringify(report.a104Reference.batteryExtraFieldsListed)}`);
}

console.log(`\nمخرَج كامل محفوظ في: ${outPath}`);

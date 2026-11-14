#!/usr/bin/env node
'use strict';

// ===================================================================
// audit-fixtures-hidden-number-citations — يكشف أرقاماً في نصوص ردود النموذج
// المصنوعة/المشتقّة (functions/test/fixtures/) **تطابق قيمة صارت محجوبة عن حمولة
// النموذج** ولا توجد في الحمولة الحالية. أمر مستخدم 2026-10-06 (D6): "فلا
// يستشهد أيٌّ منها برقم محجوب."
// ===================================================================
//
// ما هو «رقم محجوب»: ورقة (leaf) رقمية في حمولة النموذج **قبل** إخفاء القيم
// (الالتزام الأساس BASELINE_SHA، آخر التزام قبل f709219) تغيّرت قيمتها أو غابت
// من حمولة الشجرة الحالية (وليس بين أرقام نصّية مُضمَّنة في أوراق نصّية ما زالت فيها) — بنفس المدخلات بالضبط (computeFindings/
// computeCategoryStates الحاليّتان، لا تغيير عليهما بين الالتزامين). والرقم في
// النصّ «يستشهد» به إن ساوى قيمة محجوبة **بمنازله هو** (0.575 تساوي 0.5751 لا
// 0.58) ولا توجد ورقة في الحمولة الحالية تساويه بالمنازل نفسها.
//
// لماذا لا يكفي نجاح الحارس (guard.ok): numberMatches (reportShapeV7.js:706-713)
// تسامحه max(0.05, 1%) فيقبل رقماً محجوباً لقربه من رقم آخر (3778.29 قرب
// battery_voltage_mv=3760). هذا المقياس صارم على التطابق بالمنازل.
//
// الأساس يُستخرَج وقت التشغيل بـ`git archive BASELINE_SHA functions/src` إلى
// مجلّد مؤقّت خارج المستودع (لا رابط مجلّد، القاعدة 11 في تعريف الوكيل) —
// يحتاج git في PATH.
//
// Run: node functions/scripts/audit-fixtures-hidden-number-citations.js
//   (بلا وسائط: الملفّات الخمسة المعروفة أدناه) — رمز الخروج 1 إن وُجد استشهاد.
// ===================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execSync} = require('child_process');

const FUNCTIONS_DIR = path.join(__dirname, '..');
const GOLDEN_DIR = path.join(FUNCTIONS_DIR, 'test', 'fixtures', 'golden');
const FIXTURES_DIR = path.join(FUNCTIONS_DIR, 'test', 'fixtures');
// آخر التزام قبل f709219 (إخفاء القيم غير المعايَرة): `git log --oneline -6` على 9377a7f.
const BASELINE_SHA = 'a2bde6f';

const SCANS = Object.freeze({
  b45c8cf6: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json'},
  '34dff2b8': {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json'},
});

function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

function ensureBaselineSrc() {
  const dir = path.join(os.tmpdir(), `nc-baseline-${BASELINE_SHA}`);
  if (!fs.existsSync(path.join(dir, 'functions', 'src', 'analysis', 'buildV7Payload.js'))) {
    fs.mkdirSync(dir, {recursive: true});
    // مسار بالشرطة المائلة: tar (GNU) يفسّر \n في مسار ويندوز الخلفي كحرف هروب.
    const dirFwd = dir.split(path.sep).join('/');
    execSync(`git archive --format=tar ${BASELINE_SHA} functions/src | tar -x -C "${dirFwd}"`,
        {cwd: path.join(FUNCTIONS_DIR, '..'), stdio: 'pipe'});
  }
  return path.join(dir, 'functions', 'src');
}

const numOf = (v) => (typeof v === 'number' ? v :
  (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null));
const decimals = (n) => { const t = String(n); return t.includes('.') ? t.split('.')[1].length : 0; };
const roundTo = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);

function leaves(v, p, out) {
  if (v === null || typeof v !== 'object') { out.set(p, v); return out; }
  if (Array.isArray(v)) { if (v.length === 0) out.set(p, '[]'); v.forEach((x, i) => leaves(x, `${p}[${i}]`, out)); return out; }
  const ks = Object.keys(v);
  if (ks.length === 0) out.set(p, '{}');
  for (const k of ks) leaves(v[k], p ? `${p}.${k}` : k, out);
  return out;
}

/**
 * @param {string} scanKey 'b45c8cf6' | '34dff2b8'
 * @param {Array|null} functionalOverride functionalResults معدَّلة (مثل C-06→fail) أو null
 * @return {{hidden: Array<[number, string]>, present: number[], beforeBody: Object, afterBody: Object}}
 */
function buildHiddenSets(scanKey, functionalOverride) {
  const baselineSrc = ensureBaselineSrc();
  const repoSrc = path.join(FUNCTIONS_DIR, 'src');
  const {computeFindings} = require(path.join(repoSrc, 'analysis', 'findings'));
  const {computeCategoryStates} = require(path.join(repoSrc, 'analysis', 'categoryStates'));
  const {sampleInputsFromRaw} = require(path.join(repoSrc, 'analysis', 'sampleInputsFromRaw'));
  const {GOLDEN_ANALYZED_AT_MS} = require(path.join(repoSrc, 'analysis', 'expectedV7PayloadBytes'));
  const after = require(path.join(repoSrc, 'analysis', 'buildV7Payload'));
  const before = require(path.join(baselineSrc, 'analysis', 'buildV7Payload'));

  const sc = SCANS[scanKey];
  const raw = loadGolden(sc.tsFile);
  const functional = functionalOverride || loadGolden('functionalResults-by-scanid.json').byScanId[sc.scanId];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inp = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inp.sampleInputs, batteryDesignCapacityMah: inp.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  const args = {findings, categoryStates, language: 'ar', scanId: sc.scanId, isFreeTrial: false, previousScan: null};
  const beforeBody = before.buildV7Payload(args).body;
  const afterBody = after.buildV7Payload(args).body;
  const lb = leaves(beforeBody, '', new Map());
  const la = leaves(afterBody, '', new Map());
  const present = [];
  for (const [, v] of la) {
    const n = numOf(v);
    if (n !== null) present.push(n);
    // أرقام مُضمَّنة في نصّ ورقة ما زالت في الحمولة (مثل "% (71.5 GB)") — مرئية للنموذج فليست «محجوبة»
    if (typeof v === 'string' && n === null) for (const m of v.match(/-?\d+(?:\.\d+)?/g) || []) present.push(Number(m));
  }
  const hidden = [];
  for (const [p, v] of lb) {
    if (la.has(p) && la.get(p) === v) continue;
    const n = numOf(v);
    if (n !== null) hidden.push([n, p]);
  }
  return {hidden, present, beforeBody, afterBody};
}

/**
 * مصدر القيمة المحجوبة إن كان الرقم النصّي يستشهد بها، وإلّا null.
 * أمر 2026-10-07: «حاضر بالتقريب» (45.9 ← 46) يكفي سنداً إلّا حين يكون المحجوب قيمة اختبار (testResults) والحاضر بمنازل أكثر
 * ممّا كُتب (2.73 ← 2.7 مع R-02 المحجوب 2.7): هذا استشهاد بالقيمة المحجوبة نفسها لا تقريب لقيمة حاضرة.
 */
function citesHidden(n, sets) {
  const d = decimals(n);
  const h = sets.hidden.find(([v]) => roundTo(v, d) === n);
  const hiddenIsTestValue = !!h && /^testResults/.test(h[1]);
  if (sets.present.some((p) => roundTo(p, d) === n && (decimals(p) <= d || !hiddenIsTestValue))) return null;
  return h ? h[1] : null;
}

// استخراج متساهل: نمط الحارس نفسه لكن الحرف المجاور المانع لاتينيّ فقط — فالرقم المتبوع بفاصلة عربية «4400،» أو الملتصق بواو العطف «و2.6»
// (U+060C داخل نطاق \u0600-\u06FF الذي يستثني به الحارس) يُستخرَج هنا. الحارس نفسه لم يُمسّ (أمر 2026-10-07 ٦).
const LENIENT_NUMBER_RE = /(?<!\d)-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<!\d)-?\d+(?:\.\d+)?/g;
function extractNumbersLenient(text) {
  const out = [];
  LENIENT_NUMBER_RE.lastIndex = 0;
  let m;
  while ((m = LENIENT_NUMBER_RE.exec(text)) !== null) {
    const before = text[m.index - 1]; const after = text[m.index + m[0].length];
    const letter = (c) => c && /[A-Za-z]/.test(c);
    if (letter(before) || letter(after)) continue;
    const v = Number(m[0].replace(/,/g, ''));
    if (isFinite(v)) out.push(v);
  }
  return out;
}
function citationNumbers(text, extractNumbers) {
  return [...new Set([...extractNumbers(text), ...extractNumbersLenient(text)])];
}

function textFields(parsed) {
  const out = [];
  const nar = parsed.narrative || {};
  for (const k of ['summary', 'details', 'verdict']) out.push([`narrative.${k}`, nar[k]]);
  for (const [k, v] of Object.entries(nar.buyerAdvice || {})) out.push([`narrative.buyerAdvice.${k}`, v]);
  for (const [k, v] of Object.entries(nar.issueDescriptions || {})) out.push([`narrative.issueDescriptions[${k}]`, v]);
  (parsed.crossChecks || []).forEach((c, i) => out.push([`crossChecks[${i}].description`, c && c.description]));
  (parsed.adjustments || []).forEach((a, i) => out.push([`adjustments[${i}].reason`, a && a.reason]));
  (parsed.modelObservations || []).forEach((o, i) => out.push([`modelObservations[${i}].text`, o && o.text]));
  return out;
}

// الملفّات المُدقَّقة: {file, scan, modifiedC06} — الصنف: مصنوع (FAKE، يُحدَّث في مكانه)
// أو مشتقّ (DERIVED، نسخة جديدة موسومة، D6).
const DEFAULT_TARGETS = Object.freeze([
  {file: 'frozen-fake-model-response-cpu-down-c06-fail-modified-input-2026-09-25.json', scan: 'b45c8cf6', modifiedC06: true},
  {file: 'frozen-fake-model-response-security-down-sec04-fail-2026-09-25.json', scan: 'b45c8cf6', modifiedC06: false},
  {file: 'derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix-v3-2026-10-07.json', scan: 'b45c8cf6', modifiedC06: false},
  {file: 'derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted-v4-2026-10-07.json', scan: 'b45c8cf6', modifiedC06: false},
  {file: 'derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted-v3-2026-10-07.json', scan: '34dff2b8', modifiedC06: false},
]);

function auditFile(target, extractNumbers) {
  const w = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, target.file), 'utf8'));
  const parsed = JSON.parse(w.rawEnvelope.choices[0].message.content);
  let override = null;
  if (target.modifiedC06) {
    const sc = SCANS[target.scan];
    override = loadGolden('functionalResults-by-scanid.json').byScanId[sc.scanId]
        .map((r) => (r.testId === 'C-06' ? Object.assign({}, r, {status: 'fail'}) : r));
  }
  const sets = buildHiddenSets(target.scan, override);
  const cites = [];
  for (const [field, text] of textFields(parsed)) {
    if (typeof text !== 'string') continue;
    for (const n of citationNumbers(text, extractNumbers)) {
      const src = citesHidden(n, sets);
      if (src) cites.push({field, number: n, hiddenSource: src.replace(/\[\d+\]/g, '[*]')});
    }
  }
  return cites;
}

function main() {
  const {extractNumbers} = require(path.join(FUNCTIONS_DIR, 'src', 'analysis', 'reportShapeV7'));
  const files = process.argv.slice(2);
  const targets = files.length ?
      files.map((f) => {
        const [file, scan, c06] = f.split(':'); // اختياري: file:scan[:c06]
        return DEFAULT_TARGETS.find((t) => t.file === file) || {file, scan: scan || 'b45c8cf6', modifiedC06: c06 === 'c06'};
      }) :
      DEFAULT_TARGETS;
  let total = 0;
  for (const t of targets) {
    if (!fs.existsSync(path.join(FIXTURES_DIR, t.file))) { console.log(`\n== ${t.file} ==\n(غير موجود — يُتجاوَز)`); continue; }
    const cites = auditFile(t, extractNumbers);
    total += cites.length;
    console.log(`\n== ${t.file} (scan ${t.scan}) ==`);
    for (const c of cites) console.log(`${c.field}: ${c.number}  (مصدر محجوب: ${c.hiddenSource})`);
    console.log(`استشهادات برقم محجوب: ${cites.length}`);
  }
  console.log(`\nالمجموع: ${total}`);
  process.exit(total === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = {buildHiddenSets, citesHidden, citationNumbers, extractNumbersLenient, textFields, leaves, numOf, decimals, roundTo, BASELINE_SHA, SCANS, ensureBaselineSrc, auditFile, DEFAULT_TARGETS};

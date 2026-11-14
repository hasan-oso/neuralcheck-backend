'use strict';

// ===================================================================
// payloadSnapshots — أدوات مشتركة لسكربتات قياس حمولة النموذج (V7) عبر التزامات مختلفة:
//   • measure-hidden-numbers-guard.js  (أمر 2026-10-06 البند ٥)
//   • report-model-payload-hiding.js   (أمر 2026-10-06 القوائم أ–و)
// كلاهما يحتاج بناء الحمولة بنسخة `functions/src` من التزام معيّن **وقت التشغيل** — لا نسخة
// محفوظة في مستودع ولا رابط مجلّد (القاعدة 11 في تعريف الوكيل): `git archive <sha> functions/src`
// إلى مجلّد مؤقّت في os.tmpdir() خارج المستودع، ثم require منه. «tree» = الشجرة الحالية (بما فيها غير الملتزَم).
//
// يحتاج git وtar في PATH. لا شبكة ولا Firestore ولا نداء نموذج.
// ===================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {execSync} = require('child_process');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');
const REPO_DIR = path.join(FUNCTIONS_DIR, '..');
const GOLDEN_DIR = path.join(FUNCTIONS_DIR, 'test', 'fixtures', 'golden');
// تثبيت تاريخ التحليل للفِخاخ الذهبية — مصدر واحد مُصدَّر (القاعدة 24): src/analysis/expectedV7PayloadBytes.js.
const {GOLDEN_ANALYZED_AT_MS} = require('../../src/analysis/expectedV7PayloadBytes');

const SCANS = Object.freeze({
  b45c8cf6: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json'},
  '34dff2b8': {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json'},
  honor: {scanId: 'e4b65a2f-3a0c-4f11-939d-17eab7d0912f', tsFile: 'e4b65a2f-honor.ts.json'},
  s10: {scanId: '8909e850-b10c-466c-899a-ce97cb5c4fbe', tsFile: '8909e850-s10.ts.json'},
});

function git(args) {
  return execSync(`git ${args}`, {cwd: REPO_DIR, stdio: ['ignore', 'pipe', 'pipe']}).toString().trim();
}

/** @return {{sha: string, dirty: boolean}} HEAD المختصر وهل في الشجرة تعديل متتبَّع غير ملتزَم. */
function headInfo() {
  const sha = git('rev-parse --short HEAD');
  const dirty = git('status --porcelain --untracked-files=no').length > 0;
  return {sha, dirty};
}

/** يستخرج functions/src من التزام إلى مجلّد مؤقّت (مرّة واحدة) ويُعيد مساره. */
function extractSrc(sha) {
  const resolved = git(`rev-parse --short ${sha}`);
  const dir = path.join(os.tmpdir(), `nc-src-${resolved}`);
  if (!fs.existsSync(path.join(dir, 'functions', 'src', 'analysis', 'buildV7Payload.js'))) {
    fs.mkdirSync(dir, {recursive: true});
    // مسار بالشرطة المائلة: tar (GNU) يفسّر \n في مسار ويندوز الخلفي كحرف هروب.
    const dirFwd = dir.split(path.sep).join('/');
    execSync(`git archive --format=tar ${resolved} functions/src | tar -x -C "${dirFwd}"`, {cwd: REPO_DIR, stdio: 'pipe'});
  }
  return path.join(dir, 'functions', 'src');
}

/** @param {string} spec 'tree' أو sha */
function loadSnapshot(spec) {
  const src = spec === 'tree' ? path.join(FUNCTIONS_DIR, 'src') : extractSrc(spec);
  const req = (m) => require(path.join(src, m));
  return {
    spec, src,
    label: spec === 'tree' ? 'tree' : git(`rev-parse --short ${spec}`),
    computeFindings: req('analysis/findings').computeFindings,
    computeCategoryStates: req('analysis/categoryStates').computeCategoryStates,
    sampleInputsFromRaw: req('analysis/sampleInputsFromRaw').sampleInputsFromRaw,
    buildV7Payload: req('analysis/buildV7Payload'),
    reportShapeV7: req('analysis/reportShapeV7'),
  };
}

function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

/**
 * يبني مدخلات الفحص (findings، categoryStates) بوحدات اللقطة نفسها.
 * @param {Object} snap من loadSnapshot
 * @param {string} scanKey مفتاح في SCANS
 * @return {{raw: Object, functional: Array, findings: Object, categoryStates: Object, args: Object, scanId: string}}
 */
function buildScanInputs(snap, scanKey) {
  const sc = SCANS[scanKey];
  if (!sc) throw new Error(`buildScanInputs: scanKey غير معروف: ${scanKey}`);
  const raw = loadGolden(sc.tsFile);
  const functional = loadGolden('functionalResults-by-scanid.json').byScanId[sc.scanId];
  // undefined = لا مدخل مسجَّل لهذا الفِخّ (خطأ)؛ null = «تعذّر الجلب» صراحةً (Honor e4b65a2f — مستند 404، HARNESS_ERROR) فيمرّ كما هو.
  if (functional === undefined) throw new Error(`buildScanInputs: لا functionalResults لـ${sc.scanId}`);
  const findings = snap.computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inp = snap.sampleInputsFromRaw(raw);
  const categoryStates = snap.computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inp.sampleInputs, batteryDesignCapacityMah: inp.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  const args = {findings, categoryStates, language: 'ar', scanId: sc.scanId, isFreeTrial: false, previousScan: null};
  return {raw, functional, findings, categoryStates, args, scanId: sc.scanId};
}

/** مرجع الحارس كما يبنيه callAI.js: body.findings + body.categoryStates مدموجاً معها body.testResults. */
function guardContext(body) {
  return {findings: body.findings, categoryStates: Object.assign({}, body.categoryStates, {testResults: body.testResults})};
}

function numOf(v) {
  if (typeof v === 'number') return v;
  return (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) ? Number(v) : null;
}

/** أوراق شجرة → Map(مسار → قيمة). مصفوفة/كائن فارغ يُسجَّل بقيمة '[]'/'{}'. */
function leaves(v, p, out) {
  if (v === null || typeof v !== 'object') { out.set(p, v); return out; }
  if (Array.isArray(v)) { if (v.length === 0) out.set(p, '[]'); v.forEach((x, i) => leaves(x, `${p}[${i}]`, out)); return out; }
  const ks = Object.keys(v);
  if (ks.length === 0) out.set(p, '{}');
  for (const k of ks) leaves(v[k], p ? `${p}.${k}` : k, out);
  return out;
}

/** JSON بمفاتيح مرتّبة — لبصمات sha256 لا تتأثّر بترتيب الإدراج. */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
function sha256(v) { return crypto.createHash('sha256').update(typeof v === 'string' ? v : stableStringify(v)).digest('hex'); }

/** يُسقِط فهارس المصفوفات من المسار لتجميع الأنماط. */
function pathPattern(p) { return p.replace(/\[\d+\]/g, '[*]'); }

/** تقريب منزلتين (كما roundPayloadNumbersDeep). */
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * ردود النموذج الحقيقية المسجَّلة لفِخّين لهما مدخلات محلّية (b45c8cf6 و34dff2b8): scripts/out/resolve-v7-live-*.json،
 * attempts[].rawResponseText — قراءة فقط. لا يُعدَّل ولا يُحذف أيّ منها.
 * @return {Array<{file: string, attempt: number, scanKey: string, parsed: Object}>}
 */
function realResponses() {
  const dir = path.join(FUNCTIONS_DIR, 'scripts', 'out');
  const files = fs.readdirSync(dir).filter((f) => /^resolve-v7-live-.*\.json$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    const scanId = (f.match(/^resolve-v7-live-([0-9a-f-]{36})-/) || [])[1];
    const scanKey = Object.keys(SCANS).find((k) => SCANS[k].scanId === scanId && ['b45c8cf6', '34dff2b8'].includes(k));
    if (!scanKey) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    (j.attempts || []).forEach((a, i) => {
      let parsed = null;
      try { parsed = JSON.parse(a.rawResponseText); } catch (e) { parsed = null; }
      if (parsed && parsed.narrative) out.push({file: f, attempt: i + 1, scanKey, parsed});
    });
  }
  return out;
}

/** حقول النصّ الحرّ في ردّ V7 [مسار، نصّ]. */
function textFieldsOf(parsed) {
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

module.exports = {
  FUNCTIONS_DIR, REPO_DIR, GOLDEN_DIR, GOLDEN_ANALYZED_AT_MS, SCANS,
  git, headInfo, extractSrc, loadSnapshot, loadGolden, buildScanInputs, guardContext,
  numOf, leaves, stableStringify, sha256, pathPattern, r2, realResponses, textFieldsOf,
};

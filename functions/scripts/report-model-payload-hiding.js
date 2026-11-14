#!/usr/bin/env node
'use strict';

// ===================================================================
// report-model-payload-hiding — تقرير بالأداة لحمولة النموذج بعد مبدأ 2026-10-06
//   «لا تصل إلى النموذج قيمة لا يُبنى عليها حرف ولا عتبة معايَرة لها. يصله عنها «مقيس» أو «غير مقيس»
//   وحده. وما يُحسب ويُخزَّن لا يتغيّر: المستند، والعيّنات، وcategoryStates.»
// يُنتج القوائم التي طلبها المستخدم قبل الالتزام (كلها من تشغيل فعلي، القاعدة 40):
//   A  مسارات findings: عدد الأرقام والبايتات لكل مسار (مخزَّن / ما يصل النموذج بنسخة a2bde6f و01d8ba8 والشجرة)،
//      وقارئ كل مسار بملفّ:سطر، وإثبات أن computeCategoryStates لا يقرأ findings إطلاقاً (Proxy تتبّع).
//   B  الاختبارات خارج الحرف بمجموعاتها: أيّ اختبار يغيّر انقلابُ حالته حرفاً أو عطباً (طفرة فعلية على المدخل)،
//      وقبل/بعد hideTestResultForModel لكل مجموعة لم تُطبَّق عليها (إعدادات الجهاز، SPEC، هوية الجهاز، البطارية).
//   C  أسطر التعليمات (systemPromptV7.js) المرشَّحة لطلب قيمة محجوبة (مفردات مُشتقَّة بالأداة + قاموس عربي يدوي موسوم).
//   D  أثر نصّ الاستبدال (الكلمة وحدها مقابل الثابت الحالي) على طول الحمولة.
//   E  بصمات sha256 لمخرجات الحساب على ثلاثة مدخلات عبر النسخ الثلاث (لا تغيّر في المحسوب/المخزَّن).
//   F  أثر الحارس: حجم المرجع، أرقام الجهاز (9820…)، وأثر الحمولة الجديدة على ردود نموذج حقيقية مسجَّلة.
//
// كل النسخ بوحدات functions/src من الالتزام نفسه (git archive إلى os.tmpdir)، لا رابط مجلّد ولا نسخة محفوظة.
// لا شبكة، لا Firestore، لا نداء نموذج. القراءة وحدها: المخرَج الوحيد ملفّ JSON مسمّى بـHEAD.
//
// Run: node functions/scripts/report-model-payload-hiding.js [--only A,B,C,D,E,F]
// المخرَج: functions/scripts/out/model-payload-hiding-report-<HEAD>[-dirty].json
// ===================================================================

const fs = require('fs');
const path = require('path');
const lib = require('./lib/payloadSnapshots');

const BASELINE_SHA = 'a2bde6f'; // قبل أوّل جولة إخفاء
const PRIOR_SHA = '01d8ba8'; // بعد الجولة الأولى + D1–D6
const SCAN_KEYS = ['b45c8cf6', '34dff2b8', 'honor', 's10'];
const SRC_DIR = path.join(lib.FUNCTIONS_DIR, 'src');
const PROMPT_FILE = path.join(SRC_DIR, 'prompts', 'systemPromptV7.js');

function argValue(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

const snaps = {};
function snap(spec) { return snaps[spec] || (snaps[spec] = lib.loadSnapshot(spec)); }
const countNum = (v) => [...lib.leaves(v, '', new Map()).values()].filter((x) => lib.numOf(x) !== null).length;
const bytes = (v) => (v === undefined ? 0 : JSON.stringify(v).length);
const readLines = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/);

function bodyAt(spec, scanKey) {
  const s = snap(spec);
  const inp = lib.buildScanInputs(s, scanKey);
  return {s, inp, ...s.buildV7Payload.buildV7Payload(inp.args)};
}

// ───────────────────────── A ─────────────────────────
function walkJsFiles(dir, out) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** أسطر كود (لا تعليق ولا نصّ تعليمات) تقرأ findings.<key> أو findings.<key>.<sub> — من src/ باستثناء findings.js (المُنتِج). */
function staticReaders(key, sub) {
  const re = new RegExp(`\\bfindings\\??\\.${key}\\b` + (sub ? `\\??\\.${sub}\\b` : ''));
  const hits = [];
  for (const f of walkJsFiles(SRC_DIR, [])) {
    const rel = path.relative(lib.FUNCTIONS_DIR, f).split(path.sep).join('/');
    if (rel === 'src/analysis/findings.js' || rel.startsWith('src/prompts/') || rel.startsWith('src/lab/')) continue;
    readLines(f).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (re.test(line)) hits.push(`${rel}:${i + 1}`);
    });
  }
  return hits;
}

/** موضع دالّة بنيوية (تقرأ كل الأوراق/الأسماء) بملفّ:سطر — بالأداة لا بالذاكرة. */
function locate(file, re) {
  const lines = readLines(file);
  const i = lines.findIndex((l) => re.test(l));
  return i < 0 ? null : `${path.relative(lib.FUNCTIONS_DIR, file).split(path.sep).join('/')}:${i + 1}`;
}

function recordingProxy(obj, prefix, log) {
  return new Proxy(obj, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof k !== 'string') return v;
      const p = prefix ? `${prefix}.${k}` : k;
      log.add(p);
      return (v && typeof v === 'object') ? recordingProxy(v, p, log) : v;
    },
    ownKeys(t) { log.add(`${prefix}(ownKeys)`); return Reflect.ownKeys(t); },
  });
}

function sectionA() {
  const tree = snap('tree');
  const policy = tree.buildV7Payload._internal.MODEL_FINDINGS_POLICY;
  const out = {perScan: {}, readers: {}, structuralReaders: {}, letterTrace: {}};
  const structural = {
    guardReferenceNumbers: locate(path.join(SRC_DIR, 'analysis', 'reportShapeV7.js'), /^function collectNumbers\b/),
    guardFieldNameTokens: locate(path.join(SRC_DIR, 'analysis', 'reportShapeV7.js'), /^function collectFindingsFieldNameTokens\b/),
    guardNotMeasuredFieldsRead: locate(path.join(SRC_DIR, 'analysis', 'reportShapeV7.js'), /findings\.notMeasuredFields/),
    modelPayloadSanitizer: locate(path.join(SRC_DIR, 'analysis', 'buildV7Payload.js'), /^function sanitizeFindingsForModelPayload\b/),
    modelPayloadStateBuilder: locate(path.join(SRC_DIR, 'analysis', 'buildV7Payload.js'), /^function buildFindingsState\b/),
    adjustmentsEvidenceRoot: locate(path.join(SRC_DIR, 'analysis', 'buildV7Payload.js'), /refRoot === 'findings'\) return false/),
    storedByPipeline: locate(path.join(SRC_DIR, 'analysis', 'resolveV7Report.js'), /findings: p\.findings,/),
  };
  out.structuralReaders = structural;

  for (const scanKey of SCAN_KEYS) {
    const at = {};
    for (const spec of [BASELINE_SHA, PRIOR_SHA, 'tree']) at[spec] = bodyAt(spec, scanKey);
    const stored = at.tree.inp.findings;
    const rows = [];
    for (const key of Object.keys(stored)) {
      const row = {
        path: `findings.${key}`, action: policy[key] || 'UNCLASSIFIED',
        stored: {numeric: countNum(stored[key]), bytes: bytes(stored[key])},
        reachesModel: {},
      };
      for (const spec of [BASELINE_SHA, PRIOR_SHA, 'tree']) {
        const v = at[spec].body.findings ? at[spec].body.findings[key] : undefined;
        row.reachesModel[spec] = {numeric: countNum(v), bytes: bytes(v)};
      }
      rows.push(row);
      // مستوى ثانٍ للمفاتيح التي تُحوَّل أو تُحذَف
      if (['channels', 'thermal', 'storage', 'graphics', 'sustainedCeiling', 'battery'].includes(key) && stored[key] && typeof stored[key] === 'object') {
        for (const sub of Object.keys(stored[key])) {
          rows.push({
            path: `findings.${key}.${sub}`, action: policy[key] || 'UNCLASSIFIED',
            stored: {numeric: countNum(stored[key][sub]), bytes: bytes(stored[key][sub])},
            reachesModel: {
              [BASELINE_SHA]: {numeric: countNum(at[BASELINE_SHA].body.findings[key] && at[BASELINE_SHA].body.findings[key][sub]), bytes: bytes(at[BASELINE_SHA].body.findings[key] && at[BASELINE_SHA].body.findings[key][sub])},
              [PRIOR_SHA]: {numeric: countNum(at[PRIOR_SHA].body.findings[key] && at[PRIOR_SHA].body.findings[key][sub]), bytes: bytes(at[PRIOR_SHA].body.findings[key] && at[PRIOR_SHA].body.findings[key][sub])},
              tree: {numeric: countNum(at.tree.body.findings[key] && at.tree.body.findings[key][sub]), bytes: bytes(at.tree.body.findings[key] && at.tree.body.findings[key][sub])},
            },
          });
        }
      }
    }
    const totals = {stored: {numeric: countNum(stored), bytes: bytes(stored)}};
    for (const spec of [BASELINE_SHA, PRIOR_SHA, 'tree']) {
      totals[spec] = {findingsNumeric: countNum(at[spec].body.findings), findingsBytes: bytes(at[spec].body.findings), payloadLength: at[spec].userMessage.length,
        payloadNumericLeaves: countNum(at[spec].body)};
    }
    out.perScan[scanKey] = {rows, totals};

    // Proxy: هل يقرأ computeCategoryStates (= كل ما يُنتج الحرف) أيّ مسار من findings؟
    const log = new Set();
    const prox = recordingProxy(JSON.parse(JSON.stringify(stored)), '', log);
    const inp = lib.buildScanInputs(tree, scanKey);
    tree.computeCategoryStates({
      functionalResults: inp.functional, manualResults: [], dev: null, findings: prox,
      batterySampleInputs: tree.sampleInputsFromRaw(inp.raw).sampleInputs,
      batteryDesignCapacityMah: tree.sampleInputsFromRaw(inp.raw).design, analyzedAtMs: lib.GOLDEN_ANALYZED_AT_MS,
    });
    out.letterTrace[scanKey] = {findingsPathsReadByComputeCategoryStates: [...log].sort()};
  }
  // قرّاء ساكنون لكل مفتاح علوي وللثنائيات المعروفة
  const keys = new Set();
  for (const k of SCAN_KEYS) for (const r of out.perScan[k].rows) if (r.path.split('.').length === 2) keys.add(r.path.split('.')[1]);
  for (const key of keys) out.readers[`findings.${key}`] = staticReaders(key);
  out.readers['findings.battery.socAtStart'] = staticReaders('battery', 'socAtStart');
  out.readers['findings.battery.socAtEnd'] = staticReaders('battery', 'socAtEnd');
  return out;
}

// ───────────────────────── B ─────────────────────────
const LETTER_FIELDS_OVERALL = (o) => o;
function influenceSig(cs) {
  return {
    letter: lib.stableStringify({overall: LETTER_FIELDS_OVERALL(cs.overall), categories: cs.categories}),
    issues: lib.stableStringify(cs.issues),
  };
}

function groupOf(t, tk) {
  if (tk.THERMAL_UNCALIBRATED_IDS.includes(t.testId) || tk.UNCALIBRATED_THRESHOLD_IDS.includes(t.testId)) return '١ غير معايَر';
  if (tk.UNSTABLE_IDS.includes(t.testId)) return '٢ UNSTABLE';
  if (tk.USER_SETTING_IDS.includes(t.testId)) return '٣ إعدادات الجهاز (USER_SETTING_IDS)';
  if (tk.USER_CONTENT_OR_RUNTIME_IDS.includes(t.testId)) return '٤ محتوى المستخدم/تشغيل (USER_CONTENT_OR_RUNTIME_IDS)';
  if (tk.APP_CONSTANT_NOT_READ_IDS.includes(t.testId)) return '٥ث SEC-08 (غير مقيس دائماً)';
  if (t.kind === 'SPEC') return '٥ SPEC (INFO_ONLY)';
  if (tk.BATTERY_STATE_TEST_IDS.includes(t.testId)) return '٦ اختبارات البطارية B-01..B-07';
  if (t.attested) return '٧ بشهادة الفنّي';
  return '٨ باقي STATE/MEASUREMENT';
}

function sectionB() {
  const tree = snap('tree');
  const tk = require(path.join(SRC_DIR, 'analysis', 'testKinds'));
  const {MODEL_HIDDEN_TEST_IDS, MODEL_JUDGMENT_HIDDEN_TEST_IDS, MODEL_ALWAYS_NOT_MEASURED_TEST_IDS} = tree.buildV7Payload._internal;
  const treatmentOf = (id) => (MODEL_HIDDEN_TEST_IDS.includes(id) ? 'حجب كامل (حالة + قيمة)' :
    MODEL_JUDGMENT_HIDDEN_TEST_IDS.includes(id) ? 'حجب الحكم وتبقى القيمة' :
      MODEL_ALWAYS_NOT_MEASURED_TEST_IDS.includes(id) ? 'غير مقيس دائماً' : 'كما هو');
  const out = {perScan: {}, definition: {}};
  out.definition = {
    influence: 'لكل اختبار في functionalResults تُقلَب حالته إلى fail ثم pass (ما يخالف الأصلية) ويُعاد computeCategoryStates؛ feedsLetter = تغيّر overall أو categories (ما عدا testResults)، feedsIssues = تغيّر issues.',
    groups: 'التصنيف من ثوابت testKinds.js المُصدَّرة + kind + attested (لا قائمة معرّفات في هذا السكربت).',
    hiddenFull: [...MODEL_HIDDEN_TEST_IDS], judgmentOnly: [...MODEL_JUDGMENT_HIDDEN_TEST_IDS], alwaysNotMeasured: [...MODEL_ALWAYS_NOT_MEASURED_TEST_IDS],
  };
  for (const scanKey of SCAN_KEYS) {
    const inp = lib.buildScanInputs(tree, scanKey);
    const bat = tree.sampleInputsFromRaw(inp.raw);
    const run = (functional) => tree.computeCategoryStates({
      functionalResults: functional, manualResults: [], dev: null, findings: inp.findings,
      batterySampleInputs: bat.sampleInputs, batteryDesignCapacityMah: bat.design, analyzedAtMs: lib.GOLDEN_ANALYZED_AT_MS,
    });
    const base = influenceSig(inp.categoryStates);
    const influence = {};
    for (const fr of (inp.functional || [])) {
      let feedsLetter = false; let feedsIssues = false;
      const alts = ['fail', 'pass'].filter((s) => s !== String(fr.status).toLowerCase());
      for (const alt of alts) {
        const cs = run(inp.functional.map((x) => (x === fr ? {...x, status: alt} : x)));
        const sg = influenceSig(cs);
        if (sg.letter !== base.letter) feedsLetter = true;
        if (sg.issues !== base.issues) feedsIssues = true;
      }
      influence[fr.testId] = {feedsLetter, feedsIssues};
    }
    const groups = {};
    const deviceIdentity = [];
    // هوية الجهاز بتعريف الحارس تُحسَب على ما يصل النموذج فعلاً (body.testResults بعد الإخفاء) لا على المخزَّن.
    const bodyTests = tree.buildV7Payload.buildV7Payload(inp.args).body.testResults;
    for (const t of inp.categoryStates.testResults) {
      const g = groupOf(t, tk);
      const inf = influence[t.testId] || {feedsLetter: null, feedsIssues: null};
      // الفرق الفعلي بين ما يُخزَّن وما يُرسَل (لا فرضية): كل ورقة تغيّرت
      const sentEntry = bodyTests.find((x) => x.testId === t.testId) || t;
      const changed = {};
      const ls = lib.leaves(t, '', new Map()); const lt = lib.leaves(sentEntry, '', new Map());
      for (const [p, v] of ls) if (!lt.has(p) || lt.get(p) !== v) changed[p] = {before: v, after: lt.has(p) ? lt.get(p) : '(حُذف)'};
      const storedIdentityNumbers = (t.kind !== 'MEASUREMENT') ? [...tree.reportShapeV7.collectDeviceReference({testResults: [t]}).numbers] : [];
      (groups[g] = groups[g] || []).push({
        testId: t.testId, category: t.category, kind: t.kind, healthBearing: t.healthBearing, attested: !!t.attested,
        treatment: treatmentOf(t.testId),
        feedsLetter: inf.feedsLetter, feedsIssues: inf.feedsIssues,
        changedFields: changed,
        // انتماء مزدوج: هويّة جهاز بتعريف الحارس (يغذّي أرقاماً في deviceRef) داخل مجموعة تُحجب — القائمة المُسمّاة تغلب
        identityAndHidden: storedIdentityNumbers.length > 0 && treatmentOf(t.testId) !== 'كما هو' ? storedIdentityNumbers : undefined,
      });
      // هوية الجهاز بتعريف الحارس (فئة ١): اختبار kind≠MEASUREMENT يغذّي رقماً في deviceRef
      if (t.kind !== 'MEASUREMENT') {
        const sent = bodyTests.find((x) => x.testId === t.testId) || t;
        const nums = [...tree.reportShapeV7.collectDeviceReference({testResults: [sent]}).numbers];
        if (nums.length) deviceIdentity.push({testId: t.testId, numbers: nums, group: g, feedsLetter: inf.feedsLetter, feedsIssues: inf.feedsIssues});
      }
    }
    const summary = {};
    for (const [g, arr] of Object.entries(groups)) {
      summary[g] = {
        tests: arr.length,
        hiddenFull: arr.filter((x) => x.treatment.startsWith('حجب كامل')).length,
        judgmentOnly: arr.filter((x) => x.treatment.startsWith('حجب الحكم')).length,
        alwaysNotMeasured: arr.filter((x) => x.treatment === 'غير مقيس دائماً').length,
        feedLetter: arr.filter((x) => x.feedsLetter === true).length,
        feedIssuesOnly: arr.filter((x) => x.feedsLetter !== true && x.feedsIssues === true).length,
        feedNothing: arr.filter((x) => x.feedsLetter === false && x.feedsIssues === false).length,
        notInFunctionalResults: arr.filter((x) => x.feedsLetter === null).length,
      };
    }
    out.perScan[scanKey] = {summary, groups, deviceIdentity};
  }
  return out;
}

// ───────────────────────── C ─────────────────────────
// جذوع بلا «ال» كي تلتقط «بحرارة» و«الحرارة» معاً (النسخة الأولى بالتعريف فاتها سطر 221).
const ARABIC_VOCAB_MANUAL = Object.freeze([
  'سقف مستدام', 'أداء مستدام', 'تعافي', 'رسوميات', 'بطارية', 'تخزين', 'حرارة', 'إطارات',
  'قناة', 'قنوات', 'متوسط والوسيط', 'سعة', 'تردّد', 'تردد', 'شحنة', 'جهد', 'مقاومة',
]);

function hiddenVocabulary() {
  const tree = snap('tree');
  const {MODEL_HIDDEN_TEST_IDS, MODEL_FINDINGS_POLICY} = tree.buildV7Payload._internal;
  const names = new Set([...MODEL_HIDDEN_TEST_IDS]);
  const addKeys = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 2) return;
    if (Array.isArray(obj)) return;
    for (const k of Object.keys(obj)) { if (/^[A-Za-z][A-Za-z0-9_-]{4,}$/.test(k)) names.add(k); addKeys(obj[k], depth + 1); }
  };
  for (const scanKey of SCAN_KEYS) {
    const inp = lib.buildScanInputs(tree, scanKey);
    for (const key of Object.keys(inp.findings)) {
      if (MODEL_FINDINGS_POLICY[key] === 'KEEP') continue;
      names.add(key);
      addKeys(inp.findings[key], 1);
    }
    for (const id of Object.keys(inp.categoryStates.categories.battery.batteryIndicators || {})) names.add(id);
  }
  // أسماء إحصاء عامّة لا تدلّ على قيمة محجوبة بعينها
  for (const generic of ['status', 'reason', 'median', 'class', 'label', 'phase1', 'phase2', 'notMeasuredReason', 'meta', 'note', 'found', 'combined']) names.delete(generic);
  return [...names].sort();
}

function sectionC() {
  const vocab = hiddenVocabulary();
  const lines = readLines(PROMPT_FILE);
  const startIdx = lines.findIndex((l) => l.includes('const SYSTEM_PROMPT_V7 = `'));
  const endIdx = lines.findIndex((l, i) => i > startIdx && l.trim() === '`;');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hits = [];
  for (let i = startIdx + 1; i < endIdx; i++) {
    const text = lines[i];
    const v1 = vocab.filter((w) => new RegExp(`(^|[^A-Za-z0-9_])${esc(w)}($|[^A-Za-z0-9_])`).test(text));
    const v2 = ARABIC_VOCAB_MANUAL.filter((w) => text.includes(w));
    if (v1.length || v2.length) hits.push({line: i + 1, text: text.trim(), v1, v2});
  }
  return {
    file: path.relative(lib.FUNCTIONS_DIR, PROMPT_FILE).split(path.sep).join('/'),
    promptLines: endIdx - startIdx - 1,
    vocabularyDerivedByTool: vocab,
    vocabularyManualArabic: ARABIC_VOCAB_MANUAL,
    candidateLines: hits.length,
    candidateLinesByVocabulary: {english: hits.filter((h) => h.v1.length).length, arabicManualOnly: hits.filter((h) => !h.v1.length && h.v2.length).length},
    hits,
    note: 'التصنيف «يطلب قيمة» مقابل «يذكر فحسب» عدّ يدوي في التقرير النصّي — الأداة تعطي المرشَّحات وحدها.',
  };
}

// ───────────────────────── D ─────────────────────────
function sectionD() {
  const tree = snap('tree');
  const {UNCALIBRATED_MEASUREMENT_NOTE} = require(path.join(SRC_DIR, 'analysis', 'v7ModelPayloadWhitelist'));
  const out = {currentConstant: UNCALIBRATED_MEASUREMENT_NOTE, currentConstantLength: UNCALIBRATED_MEASUREMENT_NOTE.length, perScan: {}};
  for (const scanKey of SCAN_KEYS) {
    const {userMessage} = bodyAt('tree', scanKey);
    const occ = userMessage.split(UNCALIBRATED_MEASUREMENT_NOTE).length - 1;
    const wordOnly = userMessage.split(UNCALIBRATED_MEASUREMENT_NOTE).join('مقيس');
    out.perScan[scanKey] = {
      payloadLength: userMessage.length, occurrencesOfConstant: occ,
      lengthIfWordOnly: wordOnly.length, delta: wordOnly.length - userMessage.length,
      occurrencesOfWordAlreadyElsewhere: (userMessage.split(UNCALIBRATED_MEASUREMENT_NOTE).join('').match(/مقيس/g) || []).length,
    };
  }
  out.note = 'الاستبدال بالكلمة وحدها يُقاس هنا بالنصّ فقط؛ لم يُطبَّق في الشيفرة ولا في أيّ ملفّ.';
  return out;
}

// ───────────────────────── E ─────────────────────────
function sectionE() {
  const out = {perScan: {}, definition: 'sha256 على JSON بمفاتيح مرتّبة (stableStringify) لمخرَج وحدات كل نسخة بعينها'};
  for (const scanKey of ['b45c8cf6', '34dff2b8', 'honor']) {
    const sc = lib.SCANS[scanKey];
    const rawText = fs.readFileSync(path.join(lib.GOLDEN_DIR, sc.tsFile), 'utf8');
    const row = {
      inputs: {
        tsFile: sc.tsFile, tsSha256: lib.sha256(rawText),
        functionalResultsSha256: lib.sha256(lib.loadGolden('functionalResults-by-scanid.json').byScanId[sc.scanId]),
      },
      versions: {},
    };
    for (const spec of [BASELINE_SHA, PRIOR_SHA, 'tree']) {
      const s = snap(spec);
      const inp = lib.buildScanInputs(s, scanKey);
      const before = {
        findings: lib.sha256(inp.findings), categoryStates: lib.sha256(inp.categoryStates),
        testResults: lib.sha256(inp.categoryStates.testResults), samples: lib.sha256(inp.raw),
      };
      s.buildV7Payload.buildV7Payload(inp.args);
      const after = {
        findings: lib.sha256(inp.findings), categoryStates: lib.sha256(inp.categoryStates),
        testResults: lib.sha256(inp.categoryStates.testResults), samples: lib.sha256(inp.raw),
      };
      row.versions[s.label] = {
        before, afterBuildV7Payload: after,
        unchangedByBuild: JSON.stringify(before) === JSON.stringify(after),
      };
    }
    const labels = Object.keys(row.versions);
    row.identicalAcrossVersions = {};
    for (const f of ['findings', 'categoryStates', 'testResults', 'samples']) {
      row.identicalAcrossVersions[f] = new Set(labels.map((l) => row.versions[l].before[f])).size === 1;
    }
    out.perScan[scanKey] = row;
  }
  // المستند: العيّنات الذهبية الناتجة عن المسار الكامل (المولّدات) — أيّها تغيّر عن HEAD، وبأيّ مسارات
  const {execSync} = require('child_process');
  const goldenRel = 'functions/test/fixtures/golden';
  const docs = ['v7-reports-document-sample.json', 'v7-reports-document-sample-honor.json', 'v7-client-payload-sample.json', 'v7-client-payload-sample-llm-adjusted.json',
    'v7-reports-document-sample-cpu-c06-downgrade.json', 'v7-reports-document-sample-security-downgrade.json',
    'v7-verifyReport-response-sample.json', 'v7-verifyReport-response-sample-honor.json',
    'v7-verifyReport-response-sample-cpu-c06-downgrade.json', 'v7-verifyReport-response-sample-security-downgrade.json'];
  out.goldenDocuments = {};
  for (const f of docs) {
    const rel = `${goldenRel}/${f}`;
    let headText = null;
    try { headText = execSync(`git show HEAD:${rel}`, {cwd: lib.REPO_DIR, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024}).toString(); } catch (e) { headText = null; }
    const cur = fs.readFileSync(path.join(lib.GOLDEN_DIR, f), 'utf8');
    if (headText === null) { out.goldenDocuments[f] = {status: 'غير موجود في HEAD'}; continue; }
    const a = JSON.parse(headText); const b = JSON.parse(cur);
    const la = lib.leaves(a, '', new Map()); const lb = lib.leaves(b, '', new Map());
    const changed = new Set();
    for (const [p, v] of la) if (!lb.has(p) || lb.get(p) !== v) changed.add(p);
    for (const [p] of lb) if (!la.has(p)) changed.add(p);
    const patterns = {};
    for (const p of changed) { const k = lib.pathPattern(p).split('.').slice(0, 3).join('.'); patterns[k] = (patterns[k] || 0) + 1; }
    out.goldenDocuments[f] = {changedLeaves: changed.size, changedUnderPrefix: patterns};
  }
  return out;
}

// ───────────────────────── F ─────────────────────────
const DEVICE_PROBES = [9820, 4400, 1080, 2280, 420, 60, 7.1, 2021];

function guardSizes(spec, scanKey) {
  const {s, body} = bodyAt(spec, scanKey);
  const ctx = lib.guardContext(body);
  const rs = s.reportShapeV7;
  const ref = rs.collectReferenceNumbers(ctx.findings, ctx.categoryStates);
  const dev = rs.collectDeviceReference(ctx.categoryStates);
  const idx = rs.buildLeakExemptionIndex(ctx);
  const probes = {};
  for (const n of DEVICE_PROBES) {
    const g = rs.validateNumberGrounding({narrative: {summary: `قيمة ${n} هنا`}}, ctx.findings, ctx.categoryStates);
    probes[n] = g.unmatchedFields.length === 0 ? (g.excludedDevice.length ? 'مقبول بمرجع الجهاز' : 'مقبول بمرجع القياس') : 'مرفوض';
  }
  return {referenceNumbers: ref.size, deviceNumbers: dev.numbers.size, deviceTokens: dev.tokens.size, leakExemptionTokens: idx.size, probes};
}

const {realResponses, textFieldsOf} = lib;

function sectionF() {
  const out = {sizes: {}, realResponses: {}};
  for (const scanKey of SCAN_KEYS) {
    out.sizes[scanKey] = {};
    for (const spec of [BASELINE_SHA, PRIOR_SHA, 'tree']) out.sizes[scanKey][snap(spec).label] = guardSizes(spec, scanKey);
  }
  // ردود حقيقية مسجَّلة (read-only): أرقامها تحت مرجع كل نسخة، وتصنيف ما فقد سنده بين 01d8ba8 والشجرة
  const resp = realResponses();
  const extract = snap('tree').reportShapeV7.extractNumbers;
  const decimals = (n) => { const t = String(n); return t.includes('.') ? t.split('.')[1].length : 0; };
  const roundTo = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
  const ctxCache = {};
  const ctxAt = (spec, scanKey) => {
    const k = `${spec}|${scanKey}`;
    if (!ctxCache[k]) {
      const {s, body} = bodyAt(spec, scanKey);
      const ctx = lib.guardContext(body);
      ctxCache[k] = {s, body, ctx, leavesMap: lib.leaves({findings: ctx.findings, categoryStates: ctx.categoryStates}, '', new Map())};
    }
    return ctxCache[k];
  };
  // مجموعات «محجوب» و«موجود» للتصنيف: baseline مقابل tree
  const hiddenSets = {};
  for (const scanKey of ['b45c8cf6', '34dff2b8']) {
    const b = bodyAt(BASELINE_SHA, scanKey).body; const t = bodyAt('tree', scanKey).body;
    const lb = lib.leaves(b, '', new Map()); const lt = lib.leaves(t, '', new Map());
    const hidden = []; const present = [];
    for (const [, v] of lt) {
      const n = lib.numOf(v); if (n !== null) present.push(n);
      if (typeof v === 'string' && n === null) for (const m of v.match(/-?\d+(?:\.\d+)?/g) || []) present.push(Number(m));
    }
    for (const [p, v] of lb) { if (lt.has(p) && lt.get(p) === v) continue; const n = lib.numOf(v); if (n !== null) hidden.push([n, p]); }
    hiddenSets[scanKey] = {hidden, present};
  }
  // أرقام مضمَّنة في أوراق نصّية من حمولة الشجرة (مثل «(61.8 شهراً)» في source بوّابة PATCH_AGE) — يراها النموذج
  // ولا يقرؤها الحارس (collectNumbers لا يستخرج أرقاماً من داخل نصّ مركَّب، reportShapeV7.js:277 وتعليقه).
  const embeddedCache = {};
  const embeddedNumbers = (scanKey) => {
    if (!embeddedCache[scanKey]) {
      const out = [];
      for (const [, v] of lib.leaves(ctxAt('tree', scanKey).body, '', new Map())) {
        if (typeof v === 'string' && lib.numOf(v) === null) for (const m of v.match(/-?\d+(?:\.\d+)?/g) || []) out.push(Number(m));
      }
      embeddedCache[scanKey] = out;
    }
    return embeddedCache[scanKey];
  };
  const tol = (m) => Math.max(0.05, Math.abs(m) * 0.01);
  // ترتيب التصنيف: (١) قيمة محجوبة بالمبدأ (تساوي ورقة baseline تبدّلت/غابت، بمنازل الرقم نفسه)، (٢) رقم مضمَّن في نصّ ورقة
  // (بتسامح الحارس)، (٣) سند بالتسامح في ورقة findings.channels عند 01d8ba8، (٤) غير ذلك.
  const classify = (n, scanKey) => {
    const hs = hiddenSets[scanKey]; const d = decimals(n);
    const prior = ctxAt(PRIOR_SHA, scanKey);
    if (hs.hidden.some(([v]) => roundTo(v, d) === n)) return 'قيمة محجوبة بالمبدأ';
    if (embeddedNumbers(scanKey).some((m) => Math.abs(n - m) <= tol(m))) return 'مضمَّن في نصّ ورقة بالحمولة (الحارس لا يقرأ الأرقام داخل النصوص)';
    for (const [p, v] of prior.leavesMap) {
      const m = lib.numOf(v); if (m === null || !p.startsWith('findings.channels.')) continue;
      if (Math.abs(n - m) <= tol(m)) return 'سندها في 01d8ba8 ورقة findings.channels بالتسامح (محذوفة الآن)';
    }
    return 'غير مصنَّف';
  };
  const rows = [];
  for (const r of resp) {
    const per = {};
    for (const spec of [BASELINE_SHA, PRIOR_SHA, 'tree']) {
      const c = ctxAt(spec, r.scanKey);
      const g = c.s.reportShapeV7.validateNumberGrounding(r.parsed, c.ctx.findings, c.ctx.categoryStates);
      per[c.s.label] = g.unmatchedFields.map((u) => ({field: u.field, numbers: u.numbers}));
    }
    const key = (u) => `${u.field}|${u.numbers.join(',')}`;
    const priorSet = new Map(per[snap(PRIOR_SHA).label].map((u) => [u.field, new Set(u.numbers)]));
    const newly = [];
    for (const u of per.tree) {
      const had = priorSet.get(u.field) || new Set();
      for (const n of u.numbers) if (!had.has(n)) newly.push({field: u.field, number: n, class: classify(n, r.scanKey)});
    }
    const total = (arr) => arr.reduce((a, u) => a + u.numbers.length, 0);
    const cited = textFieldsOf(r.parsed).reduce((a, [, t]) => a + extract(t).length, 0);
    rows.push({
      file: r.file, attempt: r.attempt, scanKey: r.scanKey, citedNumbers: cited,
      unmatchedNumbers: {[snap(BASELINE_SHA).label]: total(per[snap(BASELINE_SHA).label]), [snap(PRIOR_SHA).label]: total(per[snap(PRIOR_SHA).label]), tree: total(per.tree)},
      rejectedFieldsOutsideDetails: {
        [snap(PRIOR_SHA).label]: per[snap(PRIOR_SHA).label].filter((u) => u.field !== 'narrative.details').length,
        tree: per.tree.filter((u) => u.field !== 'narrative.details').length,
      },
      newlyUnmatchedAtTree: newly,
    });
    void key;
  }
  const agg = {};
  for (const row of rows) for (const n of row.newlyUnmatchedAtTree) agg[n.class] = (agg[n.class] || 0) + 1;
  out.realResponses = {
    corpus: 'scripts/out/resolve-v7-live-*.json (b45c8cf6 و34dff2b8 فقط — لهما مدخلات محلّية)، attempts[].rawResponseText — قراءة فقط',
    responses: rows.length,
    newlyUnmatchedByClass: agg,
    rows,
    caveat: 'الردود كُتبت على حمولات أقدم (قبل a2bde6f وقبل الإخفاء)، فالقياس يُظهر ما كان النموذج يستشهد به لا ما سيكتبه على الحمولة الجديدة.',
  };
  return out;
}

// ───────────────────────── G ─────────────────────────
// تسرّب مباشر: قيمة محجوبة (ورقة رقمية في حمولة a2bde6f غابت/تبدّلت في الشجرة؛ منزلة عشرية أو |n|>=100) تظهر بحرفها
// (مقرَّبة منزلتين) في ورقة أخرى أو داخل نصّ ورقة من حمولة الشجرة؟ (القاعدة 33: مخرَج العملية لا يعود إليها.)
function sectionG() {
  const out = {};
  const re = /-?\d+(?:\.\d+)?/g;
  for (const scanKey of SCAN_KEYS) {
    const b = bodyAt(BASELINE_SHA, scanKey).body; const t = bodyAt('tree', scanKey).body;
    const lb = lib.leaves(b, '', new Map()); const lt = lib.leaves(t, '', new Map());
    const hidden = [];
    for (const [p, v] of lb) {
      if (lt.has(p) && lt.get(p) === v) continue;
      const n = lib.numOf(v); if (n === null) continue;
      if (Number.isInteger(n) && Math.abs(n) < 100) continue;
      if (lt.has(p) && lib.numOf(lt.get(p)) !== null && lib.r2(lib.numOf(lt.get(p))) === lib.r2(n)) continue; // تقريب فقط
      hidden.push([p, n]);
    }
    const present = new Map();
    for (const [p, v] of lt) {
      const n = lib.numOf(v);
      if (n !== null) { const k = lib.r2(n); (present.get(k) || present.set(k, []).get(k)).push(p); }
      else if (typeof v === 'string') for (const m of v.match(re) || []) { const k = lib.r2(Number(m)); (present.get(k) || present.set(k, []).get(k)).push(p + ' (داخل نصّ)'); }
    }
    const leaks = [];
    for (const [p, n] of hidden) { const where = present.get(lib.r2(n)); if (where) leaks.push({hiddenPath: lib.pathPattern(p), value: n, appearsAt: where.slice(0, 3).map(lib.pathPattern)}); }
    out[scanKey] = {hiddenNumericLeaves: hidden.length, appearingElsewhere: leaks.length, examples: leaks.slice(0, 25)};
  }
  return out;
}

// ───────────────────────── H ─────────────────────────
// هل يحمل شيءٌ غير اختباري SEC-05/SEC-06 (وضع المطوّر، تصحيح USB) في حمولة النموذج؟ ولو أُخفيا (تعميم البند ٣ على إعدادات الجهاز)
// أيّ معلومة تزول؟ + كم ردّاً حقيقياً مسجَّلاً ذكرها وفي أيّ حقل (علاقتها بسطر (و) وبقرار buyerAdvice.casual).
function sectionH() {
  const tk = require(path.join(SRC_DIR, 'analysis', 'testKinds'));
  const ids = ['SEC-05', 'SEC-06'];
  const out = {settingTestIds: [...tk.USER_SETTING_IDS], carriers: {}, realResponseMentions: {}};
  for (const scanKey of ['b45c8cf6', '34dff2b8']) {
    const {body, inp} = bodyAt('tree', scanKey);
    const carriers = [];
    for (const [p, v] of lib.leaves(body, '', new Map())) {
      const m = p.match(/^testResults\[(\d+)\]/);
      if (m && ids.includes(body.testResults[Number(m[1])].testId)) {
        const id = body.testResults[Number(m[1])].testId;
        const storedEntry = inp.categoryStates.testResults.find((x) => x.testId === id);
        const storedLeaf = lib.leaves(storedEntry, '', new Map()).get(p.replace(/^testResults\[\d+\]\.?/, ''));
        if (['outcome', 'raw.status', 'evidence', 'raw.rawValue'].some((k) => p.endsWith('].' + k))) carriers.push(lib.pathPattern(p) + ' [' + id + '] مُرسَل=' + JSON.stringify(v).slice(0, 40) + ' مخزَّن=' + JSON.stringify(storedLeaf).slice(0, 40));
      }
    }
    out.carriers[scanKey] = carriers;
  }
  const re = /وضع المطوّر|وضع المطور|التصحيح عبر|تصحيح USB|USB/;
  const resp = realResponses();
  const per = {};
  let withMention = 0; let casualMention = 0;
  for (const r of resp) {
    const fields = textFieldsOf(r.parsed).filter(([, text]) => typeof text === 'string' && re.test(text)).map(([fld]) => fld);
    if (fields.length) withMention++;
    if (fields.includes('narrative.buyerAdvice.casual')) casualMention++;
    for (const fld of fields) per[fld] = (per[fld] || 0) + 1;
  }
  out.realResponseMentions = {responses: resp.length, responsesMentioningDevModeOrUsb: withMention, casualMentions: casualMention, byField: per,
    corpus: 'scripts/out/resolve-v7-live-*.json (b45c8cf6 و34dff2b8) attempts[].rawResponseText — قراءة فقط'};
  return out;
}

// ───────────────────────── I ─────────────────────────
// «لو» أُخفيت مجموعة إضافية (ما لم يُقرَّ بعد): كم من «الأرقام المحجوبة الأربعين» (measure-hidden-numbers-guard.js) يقبلها الحارس؟
// يُطبَّق hideTestResultForModel على اختبارات المجموعة في body.testResults بعد البناء (لا تغيير في الشيفرة الإنتاجية)، ثم يُقاس القبول
// بالحارس الحقيقي على الحمولة المعدَّلة. الأربعون نفسها (من measure-hidden-numbers-guard.hiddenCandidates).
function sectionI() {
  const tk = require(path.join(SRC_DIR, 'analysis', 'testKinds'));
  const guardScript = require('./measure-hidden-numbers-guard');
  const tree = snap('tree');
  const {hideTestResultForModel} = tree.buildV7Payload._internal;
  const groups = {
    'الحالة الحالية (بعد قرار 2026-10-07)': () => false,
    'SPEC كاملة (T-04, CM-11, B-08) — قيمتها وحالتها': (t) => t.kind === 'SPEC' && !tk.APP_CONSTANT_NOT_READ_IDS.includes(t.testId),
    'إعدادات الجهاز كاملة (قيمة وحالة)': (t) => tk.USER_SETTING_IDS.includes(t.testId),
  };
  const out = {note: 'ما-لو: لم يُطبَّق في الشيفرة.', perScan: {}};
  for (const scanKey of ['b45c8cf6', '34dff2b8']) {
    const cands = guardScript.hiddenCandidates(scanKey);
    const {body} = bodyAt('tree', scanKey);
    out.perScan[scanKey] = {};
    for (const [name, pred] of Object.entries(groups)) {
      const b2 = {...body, testResults: body.testResults.map((t) => (pred(t) ? hideTestResultForModel(t) : t))};
      const ctx = lib.guardContext(b2);
      let accepted = 0;
      for (const c of cands) {
        const g = tree.reportShapeV7.validateNumberGrounding({narrative: {summary: `قيمة ${lib.r2(c.value)} هنا`}}, ctx.findings, ctx.categoryStates);
        if (g.unmatchedFields.length === 0) accepted++;
      }
      out.perScan[scanKey][name] = {accepted, total: cands.length, referenceNumbers: tree.reportShapeV7.collectReferenceNumbers(ctx.findings, ctx.categoryStates).size,
        deviceNumbers: tree.reportShapeV7.collectDeviceReference(ctx.categoryStates).numbers.size};
    }
  }
  return out;
}

// ───────────────────────── main ─────────────────────────
function main() {
  const only = (argValue('--only') || 'A,B,C,D,E,F,G,H,I').split(',').map((s) => s.trim().toUpperCase());
  const head = lib.headInfo();
  const result = {tool: 'functions/scripts/report-model-payload-hiding.js', head: head.sha, dirty: head.dirty, baseline: BASELINE_SHA, prior: PRIOR_SHA};
  const run = {A: sectionA, B: sectionB, C: sectionC, D: sectionD, E: sectionE, F: sectionF, G: sectionG, H: sectionH, I: sectionI};
  const names = {A: 'A_findings', B: 'B_tests', C: 'C_promptLines', D: 'D_replacementText', E: 'E_unchangedProof', F: 'F_guardEffect', G: 'G_directLeakScan', H: 'H_deviceSettingsInfo', I: 'I_whatIfExtraGroups'};
  for (const k of only) if (run[k]) { process.stderr.write(`[${k}] ...\n`); result[names[k]] = run[k](); }
  const outDir = path.join(lib.FUNCTIONS_DIR, 'scripts', 'out');
  fs.mkdirSync(outDir, {recursive: true});
  const file = path.join(outDir, `model-payload-hiding-report-${head.sha}${head.dirty ? '-dirty' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`كُتب: ${path.relative(lib.REPO_DIR, file).split(path.sep).join('/')}`);
}

if (require.main === module) main();

module.exports = {sectionA, sectionB, sectionC, sectionD, sectionE, sectionF, sectionG, sectionH, sectionI, hiddenVocabulary};

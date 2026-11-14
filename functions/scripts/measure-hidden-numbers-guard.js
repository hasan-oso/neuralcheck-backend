#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-hidden-numbers-guard — كم من «الأرقام المحجوبة الأربعين» يقبلها حارس الأرقام الحقيقي؟
// أمر المستخدم 2026-10-06 (البند ٥)، بنصّه: «يُعاد قياس الوكيل نفسه، دون نداءات: كم من الأرقام
// المحجوبة الأربعين يقبلها الحارس على b45c8cf6 و34dff2b8 بعد البنود ١ إلى ٣. وكان 30 من 40 و22
// من 40. ويُحفظ القياس في ملفّ مسمّى (القاعدة 32).»
// ===================================================================
//
// **مصدر الأرقام (الأربعين)** — لا من الذاكرة (القاعدة 40)، تُشتقّ وقت التشغيل لكل فِخّ:
//   حمولة النموذج على المدخلات نفسها بنسختين من functions/src:
//     BASELINE   a2bde6f — آخر التزام قبل أوّل جولة إخفاء.
//     FIRST_ROUND f709219 — أوّل جولة إخفاء (src مطابق حرفياً لـ9377a7f؛ يثبته git diff f709219 9377a7f
//                -- functions/src فارغاً).
//   «محجوب» = ورقة (leaf) في حمولة BASELINE إمّا **غابت** من حمولة FIRST_ROUND، أو **بقيت وتبدّلت قيمتها
//   وهي تحت testResults** (استُبدلت بنصّ «مقيس…» — لا تقريب عددي). ثم تُرشَّح لرقمية (عدد أو نصّ رقمي) بمنزلة
//   عشرية أو |n| ≥ 100 — لا الأعداد الصحيحة الشائعة (0/1/2…).  (مطابق لتعريف leakcheck المستعمل في القياس
//   الأوّل: اختلاف رقم→رقم = تقريب، لا حجب.)
//
// **ما يُقاس** لكل رقم محجوب n: يُكتب مقرَّباً لمنزلتين في ملخّص ردّ نموذج مُصطنَع
//   `{narrative:{summary:"قيمة <n> هنا"}}` ويُمرَّر إلى `validateNumberGrounding` من **النسخة المقيسة**
//   على **حمولتها** (مرجع الحارس كما يبنيه callAI.js: body.findings + body.categoryStates + testResults).
//   يُقبَل إن لم يُرفَض حقل (unmatchedFields فارغة) — يشمل القبول بمرجع الجهاز (deviceRef، فئة ١).
//   كل رقم مقبول يُسجَّل مع الورقة التي طابقته بالتسامح (max(0.05, 1%)): «via».
//
// **النسخ المقيسة** (--measure، افتراضياً: 9377a7f ثم 01d8ba8 ثم tree): 9377a7f هي الحالة التي قِيس فيها 30/40 و22/40
// (للتحقّق من إعادة إنتاج القياس الأوّل بالأداة نفسها)، وtree هي الشجرة الحالية. **القياس المعتمَد بعد الالتزامات
// = الملفّ المسمّى بـHEAD بلا `-dirty`** (القاعدة 32): ملفّ `-dirty` تجريبي على شجرة غير ملتزَمة.
//
// **صيغ الالتصاق** (أمر 2026-10-07، البند ١): كل رقم يُكتب أيضاً ملاصقاً لحرف عربي أو علامة («و<n>» و«<n>،» و«بـ<n>»)، لأن الحارس قبل
// التعديل كان لا يرى الرقم الملاصق فيقبله بلا مطابقة (قبول زائف)؛ يُحصى القبول لكل صيغة على حدة (acceptedByForm). الصيغة العارية (bare)
// هي المعتمَدة في العدّ الرئيسي كما كانت.
//
// **حقل عمر الرقعة** (أمر 2026-10-07، البند ٤): لكل رقم مقبول يُعاد الفحص على الحمولة نفسها بعد حذف كل حقل ageMonths من نسختَي
// بوّابة PATCH_AGE — إن صار مرفوضاً فهو مقبول بذلك الحقل وحده (acceptedOnlyViaPatchAgeField). النسخ التي لا تحمل الحقل (9377a7f، 01d8ba8): 0.
//
// لا شبكة ولا Firestore ولا نداء نموذج — حمولة محلّية وحارس محلّي.
//
// Run: node functions/scripts/measure-hidden-numbers-guard.js [--measure 9377a7f,tree] [--out-dir <dir>]
// المخرَج: functions/scripts/out/hidden-numbers-guard-<HEAD>[-dirty].json
// ===================================================================

const fs = require('fs');
const path = require('path');
const lib = require('./lib/payloadSnapshots');

const BASELINE_SHA = 'a2bde6f';
const FIRST_ROUND_SHA = 'f709219';
const DEFAULT_MEASURE = ['9377a7f', '01d8ba8', '6bc7d5d', 'tree'];
// صيغ كتابة الرقم في الجملة المُصطنَعة (الملاصقة لحرف عربي أو علامة عربية كانت غير مرئية للحارس قبل 7749977).
const FORMS = Object.freeze({
  bare: (x) => `قيمة ${x} هنا`,
  waw: (x) => `قيمة و${x} هنا`,
  arabicComma: (x) => `قيمة ${x}، هنا`,
  baa: (x) => `قيمة بـ${x} هنا`,
});
const SCAN_KEYS = ['b45c8cf6', '34dff2b8'];

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

/** الأرقام المحجوبة لفِخّ: [{path, value, kind}] — kind: removed | stateReplaced. */
function hiddenCandidates(scanKey) {
  const base = lib.loadSnapshot(BASELINE_SHA);
  const first = lib.loadSnapshot(FIRST_ROUND_SHA);
  const inputs = lib.buildScanInputs(first, scanKey); // findings/categoryStates لا يتغيّران بين الالتزامين (git diff)
  const lb = lib.leaves(base.buildV7Payload.buildV7Payload(inputs.args).body, '', new Map());
  const la = lib.leaves(first.buildV7Payload.buildV7Payload(inputs.args).body, '', new Map());
  const out = [];
  for (const [p, v] of lb) {
    let kind = null;
    if (!la.has(p)) kind = 'removed';
    else if (la.get(p) !== v && p.startsWith('testResults') && !(typeof v === 'number' && typeof la.get(p) === 'number')) kind = 'stateReplaced';
    if (!kind) continue;
    const n = lib.numOf(v);
    if (n === null) continue;
    if (Number.isInteger(n) && Math.abs(n) < 100) continue;
    out.push({path: p, value: n, kind});
  }
  return out;
}

function nearestLeaf(n, body) {
  const ctx = lib.guardContext(body);
  const lv = lib.leaves({findings: ctx.findings, categoryStates: ctx.categoryStates}, '', new Map());
  let best = null;
  for (const [p, v] of lv) {
    const m = lib.numOf(v);
    if (m === null) continue;
    const tol = Math.max(0.05, Math.abs(m) * 0.01);
    const d = Math.abs(n - m);
    if (d <= tol && (!best || d < best.d)) best = {path: p, value: m, d};
  }
  return best;
}

/** نسخة من سياق الحارس بلا أي حقل ageMonths في بوّابات الفئات وoverall. */
function ctxWithoutAgeField(ctx) {
  const strip = (arr) => (Array.isArray(arr) ? arr.map((g) => {
    if (!g || typeof g !== 'object' || !('ageMonths' in g)) return g;
    const c = Object.assign({}, g); delete c.ageMonths; return c;
  }) : arr);
  const cs = ctx.categoryStates;
  return {
    findings: ctx.findings,
    categoryStates: Object.assign({}, cs, {
      overall: cs.overall ? Object.assign({}, cs.overall, {gatesApplied: strip(cs.overall.gatesApplied)}) : cs.overall,
      categories: cs.categories ? Object.fromEntries(Object.entries(cs.categories).map(([k, v]) => [k, (v && typeof v === 'object') ? Object.assign({}, v, {gatesApplied: strip(v.gatesApplied)}) : v])) : cs.categories,
    }),
  };
}

/** يقيس قبول الحارس لكل مرشَّح على نسخة مقيسة. */
function measure(spec, scanKey, candidates) {
  const snap = lib.loadSnapshot(spec);
  const inputs = lib.buildScanInputs(snap, scanKey);
  const {body} = snap.buildV7Payload.buildV7Payload(inputs.args);
  const ctx = lib.guardContext(body);
  const ctxNoAge = ctxWithoutAgeField(ctx);
  const rows = candidates.map((c) => {
    const text = String(lib.r2(c.value));
    const g = snap.reportShapeV7.validateNumberGrounding({narrative: {summary: `قيمة ${text} هنا`}}, ctx.findings, ctx.categoryStates);
    const accepted = g.unmatchedFields.length === 0;
    const row = {path: c.path, kind: c.kind, value: c.value, citedAs: text, accepted, formsAccepted: {}};
    for (const [name, wrap] of Object.entries(FORMS)) {
      const gf = snap.reportShapeV7.validateNumberGrounding({narrative: {summary: wrap(text)}}, ctx.findings, ctx.categoryStates);
      row.formsAccepted[name] = gf.unmatchedFields.length === 0;
    }
    if (accepted) {
      const g2 = snap.reportShapeV7.validateNumberGrounding({narrative: {summary: `قيمة ${text} هنا`}}, ctxNoAge.findings, ctxNoAge.categoryStates);
      row.acceptedOnlyViaPatchAgeField = g2.unmatchedFields.length > 0;
      row.viaDevice = g.excludedDevice.length > 0;
      const v = row.viaDevice ? null : nearestLeaf(Number(text), body);
      row.via = v ? {path: v.path, value: v.value} : null;
    }
    return row;
  });
  const referenceSize = snap.reportShapeV7.collectReferenceNumbers(ctx.findings, ctx.categoryStates).size;
  return {
    measuredAt: snap.label, payloadLength: JSON.stringify(body).length,
    accepted: rows.filter((r) => r.accepted).length, total: rows.length, referenceSetSize: referenceSize,
    acceptedOnlyViaPatchAgeField: rows.filter((r) => r.acceptedOnlyViaPatchAgeField === true).length,
    acceptedByForm: Object.fromEntries(Object.keys(FORMS).map((k) => [k, rows.filter((r) => r.formsAccepted[k]).length])), rows,
  };
}

function main() {
  const head = lib.headInfo();
  const measureSpecs = (argValue('--measure') || DEFAULT_MEASURE.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const outDir = argValue('--out-dir') || path.join(lib.FUNCTIONS_DIR, 'scripts', 'out');
  const result = {
    tool: 'functions/scripts/measure-hidden-numbers-guard.js',
    head: head.sha, dirty: head.dirty,
    definition: {
      baseline: BASELINE_SHA, firstRound: FIRST_ROUND_SHA,
      candidates: 'ورقة في حمولة baseline غابت من حمولة firstRound، أو تبدّلت قيمتها تحت testResults (نصّ بدل رقم)؛ رقمية؛ منزلة عشرية أو |n|>=100',
      acceptance: 'validateNumberGrounding({narrative:{summary:"قيمة <n بمنزلتين> هنا"}}, body.findings, categoryStates+testResults) بلا unmatchedFields',
      note: head.dirty ? 'تجريبي — شجرة غير ملتزَمة؛ القياس المعتمَد هو الملفّ المسمّى بـHEAD بلا -dirty بعد الالتزامات' : 'مقيس على HEAD ملتزَم',
    },
    scans: {},
  };
  const summary = [];
  for (const scanKey of SCAN_KEYS) {
    const cands = hiddenCandidates(scanKey);
    const perSpec = {};
    for (const spec of measureSpecs) perSpec[spec] = measure(spec, scanKey, cands);
    result.scans[scanKey] = {candidateCount: cands.length, candidates: cands, measured: perSpec};
    for (const spec of measureSpecs) {
      const m = perSpec[spec];
      summary.push(`${scanKey} @${m.measuredAt}: ${m.accepted} من ${m.total} يقبلها الحارس (حجم مرجع الحارس ${m.referenceSetSize}؛ منها بحقل عمر الرقعة وحده: ${m.acceptedOnlyViaPatchAgeField}؛ بالصيغ: ${Object.entries(m.acceptedByForm).map(([k, v]) => `${k}=${v}`).join(' ')})`);
    }
  }
  fs.mkdirSync(outDir, {recursive: true});
  const file = path.join(outDir, `hidden-numbers-guard-${head.sha}${head.dirty ? '-dirty' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(summary.join('\n'));
  // تجميع القبول بنمط المسار المصدر (ما الذي لا يزال يُقبَل ولماذا)
  for (const scanKey of SCAN_KEYS) {
    for (const spec of measureSpecs) {
      const m = result.scans[scanKey].measured[spec];
      const agg = new Map();
      for (const r of m.rows.filter((x) => x.accepted)) {
        const k = `${lib.pathPattern(r.path)}  ←  ${r.viaDevice ? 'deviceRef' : (r.via ? lib.pathPattern(r.via.path) : 'مرجع بلا ورقة مطابقة')}`;
        agg.set(k, (agg.get(k) || 0) + 1);
      }
      if (agg.size) {
        console.log(`\n[${scanKey} @${m.measuredAt}] المقبول بنمط (المحجوب ← الورقة التي طابقته):`);
        for (const [k, c] of agg) console.log(`  ${c}× ${k}`);
      }
    }
  }
  console.log(`\nكُتب: ${path.relative(lib.REPO_DIR, file).split(path.sep).join('/')}`);
}

if (require.main === module) main();

module.exports = {hiddenCandidates, measure, ctxWithoutAgeField, BASELINE_SHA, FIRST_ROUND_SHA};

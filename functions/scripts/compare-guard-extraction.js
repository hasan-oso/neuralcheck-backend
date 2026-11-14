#!/usr/bin/env node
'use strict';

// ===================================================================
// compare-guard-extraction — مقارنة استخراج الأرقام في حارس V7 قبل التعديل وبعده، على سرود مسجَّلة، بالمرجع نفسه.
// أمر المستخدم 2026-10-07 +03 (البند ١): «مقارنة على السرود… عدد ما يرفضه الحارس قبل الإصلاح وبعده، مع ذكر كل رفض جديد
// بنصّه. فإن ظهر رفض لاسم جهاز، يُعرض عليّ قبل الالتزام.»
//
// ما يُقارَن هو **الاستخراج وحده** (reportShapeV7.js extractNumbers): السرد نفسه، المرجع نفسه (findings + categoryStates + testResults
// من حمولة النسخة الحالية — الحمولة لا تتأثّر بالاستخراج)، والتسامح نفسه. «قبل» = --before <sha> (الافتراضي 6bc7d5d)، «بعد» = الشجرة.
//
// الأوضاع (لا شبكة ولا Firestore ولا نداء نموذج — قراءة ملفّات فقط، ولا يُعدَّل ولا يُحذف ملفّ مُدخَل):
//   --recorded
//       الردود الحقيقية الـ17 المسجَّلة في المستودع (scripts/out/resolve-v7-live-*.json لـb45c8cf6 و34dff2b8) بمدخلاتها الذهبية،
//       مع اختبار «اسم الجهاز منقولاً حرفاً» على المدخلات الأربعة (b45c8cf6، 34dff2b8، Honor، S10).
//   --live <path> [--live <path> ...] --replay-input <path>
//       ملفّ/ملفّات نداء حيّ (resolve-v7-live-*.json، attempts[].rawResponseText) لفحص واحد، ومُدخَل إعادة التشغيل
//       (مخرَج export-v7-replay-inputs-readonly.js) لبناء المرجع. وقت التحليل لبوّابة PATCH_AGE = --analyzed-at (ISO أو ms)
//       وإلّا requestedAt في أول ملفّ حيّ.
//   --live <path> --golden <scanKey>     نفس السابق بمدخلات ذهبية من المستودع (b45c8cf6 | 34dff2b8 | honor | s10).
//   --live <path>                        بلا مرجع: الاستخراج وحده (الأرقام التي صارت مرئية بسياقها)، **دون** قياس قبول/رفض.
//
// لكل ردّ: عدد الحقول والأرقام التي يرفضها الحارس قبل وبعد، وكل رفض جديد بحقله ورقمه وسياقه ونوع التصاقه، وتنبيه صريح
// «اسم جهاز مرفوض» إن كان السياق اسم جهاز/شريحة. المخرَج: functions/scripts/out/guard-extraction-compare-<HEAD>[-dirty]-<وسم>.json
//
// Run: node functions/scripts/compare-guard-extraction.js --recorded
//      node functions/scripts/compare-guard-extraction.js --live <live.json> [--live <live2.json>] --replay-input <replay.json>
// ===================================================================

const fs = require('fs');
const path = require('path');
const lib = require('./lib/payloadSnapshots');

function argValues(name) {
  const out = [];
  process.argv.forEach((a, i) => { if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1]); });
  return out;
}
const argValue = (name) => argValues(name)[0] || null;
const hasFlag = (name) => process.argv.includes(name);

/** مطابقات الرقم بنمط الحارس مع نوع الالتصاق والسياق (للتقرير فقط — الاستخراج الفعلي في الحارس نفسه). */
function numberMatchesWithContext(text) {
  const norm = text
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
      .replace(/٫/g, '.').replace(/٬/g, ',');
  const re = /(?<!\d)-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<!\d)-?\d+(?:\.\d+)?/g;
  const out = [];
  let m;
  while ((m = re.exec(norm)) !== null) {
    const start = m.index; const end = start + m[0].length;
    const before = norm[start - 1]; const after = norm[end];
    const rawSpan = text.slice(start, end);
    const glue = [];
    if (/[A-Za-z]/.test(before || '') || /[A-Za-z]/.test(after || '')) glue.push('لاتيني');
    if (/[ء-ي]/.test(before || '') || /[ء-ي]/.test(after || '')) glue.push('حرف عربي');
    if (/[،؛؟]/.test(before || '') || /[،؛؟]/.test(after || '')) glue.push('علامة عربية');
    if (/[٠-٩۰-۹٫٬]/.test(rawSpan)) glue.push('أرقام هندية/فارسية');
    out.push({value: Number(m[0].replace(/,/g, '')), glue: glue.length ? glue.join('+') : 'لا التصاق',
      context: text.slice(Math.max(0, start - 18), end + 18).replace(/\s+/g, ' ')});
  }
  return out;
}

function multisetMinus(a, b) {
  const cnt = new Map();
  for (const x of b) cnt.set(x, (cnt.get(x) || 0) + 1);
  const out = [];
  for (const x of a) { const c = cnt.get(x) || 0; if (c > 0) cnt.set(x, c - 1); else out.push(x); }
  return out;
}

const DEVICE_NAME_RE = /(Galaxy|Samsung|Honor|Huawei|Xiaomi|Redmi|Pixel|Exynos|Snapdragon|Mali|Adreno|Kirin|Dimensity|MTN|SM-)/i;
const classify = (context) => (DEVICE_NAME_RE.test(context) ? 'اسم جهاز/شريحة' : (/[A-Z]{1,3}-\d/.test(context) ? 'معرّف اختبار' : 'قيمة'));

/** بناء مرجع الحارس لفحص: من مدخلات ذهبية أو من ملفّ إعادة التشغيل (الشجرة الحالية). */
function buildReference(tree, source, analyzedAtMs) {
  let findings; let categoryStates; let scanId; let language = 'ar'; let isFreeTrial = false;
  if (source.golden) {
    const inp = lib.buildScanInputs(tree, source.golden);
    ({findings, categoryStates, scanId} = inp);
  } else {
    const replay = JSON.parse(fs.readFileSync(path.resolve(source.replay), 'utf8'));
    const fp = replay.fingerprint;
    if (!fp || typeof fp !== 'object') throw new Error(`${source.replay}: بلا .fingerprint صالح`);
    findings = tree.computeFindings(fp);
    const bat = tree.sampleInputsFromRaw(fp.timeSeries || {});
    categoryStates = tree.computeCategoryStates({
      functionalResults: fp.functionalResults, manualResults: fp.manualResults || [], dev: null, findings,
      batterySampleInputs: bat.sampleInputs, batteryDesignCapacityMah: bat.design, analyzedAtMs,
    });
    scanId = replay.scanId;
    if (typeof replay.language === 'string') language = replay.language;
    isFreeTrial = !!replay.isFreeTrial;
  }
  const {body} = tree.buildV7Payload.buildV7Payload({findings, categoryStates, language, scanId, isFreeTrial, previousScan: null});
  return lib.guardContext(body);
}

const countNumbers = (g) => g.unmatchedFields.reduce((a, u) => a + u.numbers.length, 0);

/** مقارنة ردّ واحد. ctx = null ← الاستخراج وحده. */
function compareResponse(before, after, ctx, parsed) {
  const row = {extractionNewlyVisible: [], guard: null};
  for (const [field, text] of lib.textFieldsOf(parsed)) {
    if (typeof text !== 'string') continue;
    const fresh = multisetMinus(after.reportShapeV7.extractNumbers(text), before.reportShapeV7.extractNumbers(text));
    if (!fresh.length) continue;
    const ms = numberMatchesWithContext(text);
    for (const n of fresh) {
      const mm = ms.find((x) => x.value === n) || {glue: '?', context: ''};
      row.extractionNewlyVisible.push({field, number: n, glue: mm.glue, context: mm.context});
    }
  }
  if (ctx) {
    const gb = before.reportShapeV7.validateNumberGrounding(parsed, ctx.findings, ctx.categoryStates);
    const ga = after.reportShapeV7.validateNumberGrounding(parsed, ctx.findings, ctx.categoryStates);
    const newRej = [];
    for (const u of ga.unmatchedFields) {
      const was = gb.unmatchedFields.find((x) => x.field === u.field);
      const fresh = multisetMinus(u.numbers, was ? was.numbers : []);
      const text = lib.textFieldsOf(parsed).find(([f]) => f === u.field)[1];
      const ms = numberMatchesWithContext(text);
      for (const n of fresh) {
        const mm = ms.find((x) => x.value === n) || {glue: '?', context: ''};
        newRej.push({field: u.field, number: n, glue: mm.glue, context: mm.context, kind: classify(mm.context), outsideDetails: u.field !== 'narrative.details'});
      }
    }
    row.guard = {
      before: {rejectedFields: gb.unmatchedFields.length, rejectedNumbers: countNumbers(gb), rejectedFieldsOutsideDetails: gb.unmatchedFields.filter((u) => u.field !== 'narrative.details').length},
      after: {rejectedFields: ga.unmatchedFields.length, rejectedNumbers: countNumbers(ga), rejectedFieldsOutsideDetails: ga.unmatchedFields.filter((u) => u.field !== 'narrative.details').length},
      newRejections: newRej,
    };
  }
  return row;
}

function summarize(rows) {
  const s = {responses: rows.length, extractionNewlyVisibleNumbers: 0, measured: false,
    before: {rejectedFields: 0, rejectedNumbers: 0, responsesWithRejectedFieldOutsideDetails: 0},
    after: {rejectedFields: 0, rejectedNumbers: 0, responsesWithRejectedFieldOutsideDetails: 0},
    newRejections: 0, newRejectionsByKind: {}, deviceNameRejections: []};
  for (const r of rows) {
    s.extractionNewlyVisibleNumbers += r.extractionNewlyVisible.length;
    if (!r.guard) continue;
    s.measured = true;
    for (const side of ['before', 'after']) {
      s[side].rejectedFields += r.guard[side].rejectedFields;
      s[side].rejectedNumbers += r.guard[side].rejectedNumbers;
      if (r.guard[side].rejectedFieldsOutsideDetails > 0) s[side].responsesWithRejectedFieldOutsideDetails++;
    }
    for (const n of r.guard.newRejections) {
      s.newRejections++;
      s.newRejectionsByKind[n.kind] = (s.newRejectionsByKind[n.kind] || 0) + 1;
      if (n.kind === 'اسم جهاز/شريحة') s.deviceNameRejections.push(`${r.file || ''}#${r.attempt || ''} ${n.field}: ${n.number} «${n.context}»`);
    }
  }
  return s;
}

function runRecorded(before, after) {
  const responses = lib.realResponses();
  const refCache = {};
  const rows = [];
  for (const r of responses) {
    const ctx = refCache[r.scanKey] || (refCache[r.scanKey] = buildReference(after, {golden: r.scanKey}, lib.GOLDEN_ANALYZED_AT_MS));
    rows.push(Object.assign({file: r.file, attempt: r.attempt, scanKey: r.scanKey}, compareResponse(before, after, ctx, r.parsed)));
  }
  // اسم الجهاز منقولاً حرفاً من الحمولة، على المدخلات الأربعة
  const deviceNames = {};
  for (const scanKey of ['b45c8cf6', '34dff2b8', 'honor', 's10']) {
    const ctx = refCache[scanKey] || buildReference(after, {golden: scanKey}, lib.GOLDEN_ANALYZED_AT_MS);
    const inp = lib.buildScanInputs(after, scanKey);
    const model = String(after.buildV7Payload.buildV7Payload(inp.args).body.findings.meta.deviceModel || '');
    const parsed = {narrative: {summary: `جهاز ${model} اجتاز الفحص، بمعالج Mali-G76 ونظام 5G.`, details: '', verdict: '', buyerAdvice: {casual: '', gamer: '', photographer: ''}, issueDescriptions: {}}, crossChecks: [], adjustments: [], modelObservations: []};
    const gb = before.reportShapeV7.validateNumberGrounding(parsed, ctx.findings, ctx.categoryStates);
    const ga = after.reportShapeV7.validateNumberGrounding(parsed, ctx.findings, ctx.categoryStates);
    deviceNames[scanKey] = {deviceModel: model, extractedAfter: after.reportShapeV7.extractNumbers(parsed.narrative.summary),
      rejectedBefore: countNumbers(gb), rejectedAfter: countNumbers(ga)};
  }
  return {rows, deviceNames};
}

function runLive(before, after) {
  const lives = argValues('--live');
  const replay = argValue('--replay-input');
  const golden = argValue('--golden');
  const analyzedAtArg = argValue('--analyzed-at');
  const parsedLives = lives.map((p) => ({path: p, json: JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'))}));
  let ctx = null;
  let reference = 'لا مرجع (الاستخراج وحده — قبول/رفض الحارس غير مقيس)';
  if (replay || golden) {
    const analyzedAt = analyzedAtArg ? (/^\d+$/.test(analyzedAtArg) ? Number(analyzedAtArg) : Date.parse(analyzedAtArg)) : Date.parse(parsedLives[0].json.requestedAt);
    if (!Number.isFinite(analyzedAt)) throw new Error('تعذّر تحديد وقت التحليل — مرّر --analyzed-at');
    ctx = buildReference(after, replay ? {replay} : {golden}, analyzedAt);
    reference = replay ? `--replay-input ${replay} (analyzedAt=${new Date(analyzedAt).toISOString()})` : `--golden ${golden}`;
  }
  const rows = [];
  for (const l of parsedLives) {
    (l.json.attempts || []).forEach((a, i) => {
      let parsed = null;
      try { parsed = JSON.parse(a.rawResponseText); } catch (e) { parsed = null; }
      if (!parsed || !parsed.narrative) { rows.push({file: path.basename(l.path), attempt: i + 1, skipped: 'rawResponseText ليس ردّ V7 صالحاً'}); return; }
      rows.push(Object.assign({file: path.basename(l.path), attempt: i + 1}, compareResponse(before, after, ctx, parsed)));
    });
  }
  return {rows: rows.filter((r) => !r.skipped), skipped: rows.filter((r) => r.skipped), reference};
}

function main() {
  const head = lib.headInfo();
  const before = lib.loadSnapshot(argValue('--before') || '6bc7d5d');
  const after = lib.loadSnapshot('tree');
  const result = {tool: 'functions/scripts/compare-guard-extraction.js', head: head.sha, dirty: head.dirty, before: before.label, after: 'tree'};
  let tag;
  if (hasFlag('--recorded')) {
    tag = 'recorded';
    const r = runRecorded(before, after);
    result.mode = '--recorded'; result.deviceNames = r.deviceNames; result.rows = r.rows; result.summary = summarize(r.rows);
  } else if (argValues('--live').length) {
    const r = runLive(before, after);
    const first = JSON.parse(fs.readFileSync(path.resolve(argValues('--live')[0]), 'utf8'));
    tag = String(first.scanId || 'live').slice(0, 8);
    result.mode = '--live'; result.reference = r.reference; result.rows = r.rows; result.skipped = r.skipped; result.summary = summarize(r.rows);
  } else {
    console.error('استعمال: --recorded | --live <path> [--live <path>] [--replay-input <path> | --golden <key>] [--analyzed-at <ISO|ms>] [--before <sha>]');
    process.exit(2);
  }
  const outDir = path.join(lib.FUNCTIONS_DIR, 'scripts', 'out');
  fs.mkdirSync(outDir, {recursive: true});
  const file = path.join(outDir, `guard-extraction-compare-${head.sha}${head.dirty ? '-dirty' : ''}-${tag}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', 'utf8');
  const s = result.summary;
  console.log(`ردود: ${s.responses}؛ أرقام صارت مرئية بالاستخراج: ${s.extractionNewlyVisibleNumbers}`);
  if (s.measured) {
    console.log(`الحارس قبل: ${s.before.rejectedFields} حقلاً/${s.before.rejectedNumbers} رقماً مرفوضاً (ردود بحقل مرفوض خارج details: ${s.before.responsesWithRejectedFieldOutsideDetails})`);
    console.log(`الحارس بعد: ${s.after.rejectedFields} حقلاً/${s.after.rejectedNumbers} رقماً مرفوضاً (ردود بحقل مرفوض خارج details: ${s.after.responsesWithRejectedFieldOutsideDetails})`);
    console.log(`رفض جديد: ${s.newRejections} — بحسب النوع: ${JSON.stringify(s.newRejectionsByKind)}`);
    if (s.deviceNameRejections.length) console.log(`⚠️ رفض لاسم جهاز/شريحة: ${s.deviceNameRejections.length}`);
    else console.log('رفض لاسم جهاز/شريحة: 0');
  } else {
    console.log(`قبول/رفض الحارس: غير مقيس — ${result.reference || 'لا مرجع'}`);
  }
  if (result.deviceNames) for (const [k, v] of Object.entries(result.deviceNames)) console.log(`اسم الجهاز [${k}] «${v.deviceModel}»: يُستخرَج منه ${JSON.stringify(v.extractedAfter)}؛ مرفوض قبل ${v.rejectedBefore} وبعد ${v.rejectedAfter}`);
  console.log(`كُتب: ${path.relative(lib.REPO_DIR, file).split(path.sep).join('/')}`);
}

if (require.main === module) main();

module.exports = {numberMatchesWithContext, multisetMinus, compareResponse, summarize};

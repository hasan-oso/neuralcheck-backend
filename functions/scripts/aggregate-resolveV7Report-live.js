#!/usr/bin/env node
'use strict';

// ===================================================================
// aggregate-resolveV7Report-live — أداة تجميع محفوظة (القاعدة 32) —
// أمر مستخدم 2026-09-23 +03، القرار ٥: "أداة تجميع محفوظة، تقرأ ملفّات
// المخرَج وتُخرج جدولاً... الأخير يُغلق P1.8 بأرقام V7 الحقيقية."
//
// **لا تُشغّل أي نداء شبكة** — تقرأ فقط ملفّات resolve-v7-live-*.json
// المحفوظة مسبقاً في functions/scripts/out/ (نتاج تشغيل حقيقي مُصرَّح به
// من المستخدم عبر measure-resolveV7Report-live.js، أو محاكاة).
//
// Usage:
//   node functions/scripts/aggregate-resolveV7Report-live.js
//   node functions/scripts/aggregate-resolveV7Report-live.js --glob "resolve-v7-live-*-2026-09-23*.json"
//   node functions/scripts/aggregate-resolveV7Report-live.js --out summary.json   # يكتب أيضاً ملخّصاً JSON
// ===================================================================

const fs = require('fs');
const path = require('path');
const {stripCodeFence} = require('../src/analysis/stripCodeFence');

const OUT_DIR = path.join(__dirname, 'out');
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const GLOB_PREFIX = argValue('--glob') || 'resolve-v7-live-*.json';
const OUT_JSON = argValue('--out');

// مطابقة نمط بسيطة (* فقط) — لا حاجة لمكتبة glob كاملة لهذا الاستعمال.
function globToRegex(g) {
  return new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}
const pattern = globToRegex(GLOB_PREFIX);

const files = fs.readdirSync(OUT_DIR).filter((f) => pattern.test(f)).sort();

if (files.length === 0) {
  console.error(`لا ملفّات مطابقة للنمط "${GLOB_PREFIX}" في ${OUT_DIR} — توقّف.`);
  process.exit(1);
}

// ─── القاعدة 38 الجديدة (CLAUDE.md، مساحة العمل): "الأداة التي تقرأ
// مخرَج النظام تُقاس بمصدر مستقلّ قبل أن يُبنى على رقمها. وإلّا نقلت عطب
// النظام بوصفه نتيجة." — وقع هذا حرفياً: هذه الأداة كانت تقرأ
// finalResult.audit.adjustments وحده (المصدر المُشتقّ من resolveV7Report،
// المُتأثِّر بعطب A122 — applyV7Adjustments لم تكن تُستدعى، فالحقل فارغ
// دائماً بصرف النظر عمّا اقترحه النموذج فعلياً)، فقالت "اقتُرح 0" وهي
// تنقل عطب النظام لا تقيسه. المصدر المستقلّ هنا: rawResponseText (نصّ
// النموذج الخام كما وصل فعلياً، محفوظ لكل محاولة بمعزل عن أي معالجة
// لاحقة) — إن اختلف العددان يُطبَع "تعارض" صراحة، لا يُسكَت عنه ولا
// يُرجَّح أحدهما تلقائياً. ─────────────────────────────────────────────
function countAdjustmentsFromRaw(rawText) {
  if (typeof rawText !== 'string' || !rawText) return null; // غير معروف — لا خام محفوظ
  try {
    const parsed = JSON.parse(stripCodeFence(rawText));
    return Array.isArray(parsed.adjustments) ? parsed.adjustments.length : 0;
  } catch (e) {
    return null; // تعذّر التحليل (قد يحتاج jsonrepair) — غير معروف لا صفر
  }
}

// ─── هل جسم نصّي (rawResponseText) احتاج jsonrepair فعلياً؟ ─────────────
// نفس اختبار الإنتاج بالضبط: JSON.parse(stripCodeFence(text)) — نجاحه
// يعني "بلا إصلاح"، فشله يعني أن ensureReportShape (الإنتاج) سلك مسار
// jsonrepair لإنتاج الناتج المحفوظ. لا نسخة من منطق آخر — نفس الدالّة
// المُصدَّرة التي يستهلكها الإنتاج (src/analysis/stripCodeFence.js).
function neededRepair(rawText) {
  if (typeof rawText !== 'string' || !rawText) return null; // غير معروف — لا خام محفوظ لهذه المحاولة
  try {
    JSON.parse(stripCodeFence(rawText));
    return false;
  } catch (e) {
    return true;
  }
}

const perRun = [];
for (const file of files) {
  const j = JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
  const attempts = Array.isArray(j.attempts) ? j.attempts : [];
  const finalResult = j.finalResult;

  const attemptDetails = attempts.map((a) => {
    const net = Array.isArray(a.network) ? a.network : [];
    const repaired = neededRepair(a.rawResponseText);
    return {
      seq: a.seq,
      threw: a.threw || null,
      guardOk: a.result ? (a.result.guard && a.result.guard.ok) : null,
      languageLeaksCount: a.result && a.result.guard ? (a.result.guard.languageLeaks || []).length : null,
      durationMs: a.result ? a.result.duration : null,
      jsonRepaired: repaired,
      rawResponseTextLength: typeof a.rawResponseText === 'string' ? a.rawResponseText.length : null,
      network: net.map((n) => ({
        headerMs: n.headerMs != null ? n.headerMs : null,
        model: n.model || null,
        finishReason: n.finishReason || null,
        completionTokens: n.usage ? (n.usage.completion_tokens || null) : null,
        reasoningTokens: n.usage && n.usage.completion_tokens_details ? (n.usage.completion_tokens_details.reasoning_tokens || null) : null,
        status: n.status != null ? n.status : null,
        blocked: !!n.blocked,
      })),
    };
  });

  const adjustments = (finalResult && finalResult.audit && Array.isArray(finalResult.audit.adjustments)) ?
      finalResult.audit.adjustments : [];
  const adjustmentsAccepted = adjustments.filter((a) => a.applied === true);
  const adjustmentsRejected = adjustments.filter((a) => a.rejectedReason);

  // القاعدة 38 — العدّ المستقلّ من rawResponseText، لمحاولة "النتيجة
  // النهائية" تحديداً (آخر محاولة قُبلت (guardOk===true)، وإلا آخر محاولة
  // على الإطلاق — نفس ما يُمثِّله finalResult مفهومياً في resolveV7Report.js).
  const acceptedAttempt = [...attemptDetails].reverse().find((a) => a.guardOk === true) ||
      attemptDetails[attemptDetails.length - 1] || null;
  const adjustmentsFromRaw = acceptedAttempt ?
      countAdjustmentsFromRaw((attempts[attemptDetails.indexOf(acceptedAttempt)] || {}).rawResponseText) : null;
  const adjustmentsConflict = (adjustmentsFromRaw !== null && adjustmentsFromRaw !== adjustments.length);

  const rejectedReasonsAllRounds = (finalResult && finalResult.audit && finalResult.audit.regeneration &&
      Array.isArray(finalResult.audit.regeneration.rounds)) ?
      finalResult.audit.regeneration.rounds.flatMap((r) => r.rejectedReasons || []) : [];

  perRun.push({
    file,
    scanId: j.scanId,
    requestedAt: j.requestedAt,
    wallMs: j.wallMs,
    threw: j.threw || null,
    attemptsCount: attempts.length,
    neededSecondAttempt: attempts.length > 1,
    guardFinalOk: finalResult ? (finalResult.guardFinal && finalResult.guardFinal.ok) : null,
    narrativeIncomplete: finalResult ? finalResult.narrativeIncomplete : null,
    rejectedReasonsAllRounds,
    adjustments: {
      proposed: adjustments.length,
      accepted: adjustmentsAccepted.length,
      rejected: adjustmentsRejected.length,
      rejectedReasons: adjustmentsRejected.map((a) => ({category: a.category, reason: a.rejectedReason})),
      // القاعدة 38 — proposedFromRawIndependent هو المصدر المستقلّ
      // (rawResponseText للمحاولة النهائية)؛ conflict=true حين يختلف عن
      // proposed أعلاه (audit.adjustments) — دليل مباشر على عطب في النظام
      // لا في هذه الأداة (الأداة تكتفي بالإبلاغ، لا الترجيح).
      proposedFromRawIndependent: adjustmentsFromRaw,
      conflict: adjustmentsConflict,
    },
    // القاعدة 22 — الغياب لا يُقرأ قياساً. ملفّات سابقة لالتقاط الخام
    // (البند ٢، هذا الأمر) لا تحمل rawResponseText إطلاقاً، فـneededRepair
    // يُعيد null (غير معروف) لا false (لم يُصلَح). true إن أُصلحت محاولة
    // واحدة على الأقلّ فعلياً؛ false فقط إن عُرفت **كل** المحاولات بلا
    // إصلاح (لا محاولة واحدة مجهولة)؛ وإلا 'unknown_no_raw_captured'.
    jsonRepairedAnyAttempt: attemptDetails.some((a) => a.jsonRepaired === true) ? true :
        (attemptDetails.every((a) => a.jsonRepaired === false) ? false : 'unknown_no_raw_captured'),
    languageLeakAnyAttempt: attemptDetails.some((a) => (a.languageLeaksCount || 0) > 0),
    attempts: attemptDetails,
  });
}

// ─── الإجماليات ──────────────────────────────────────────────────────
const totalRuns = perRun.length;
const runsNeedingSecondAttempt = perRun.filter((r) => r.neededSecondAttempt).length;
const totalAdjustmentsProposed = perRun.reduce((s, r) => s + r.adjustments.proposed, 0);
const totalAdjustmentsAccepted = perRun.reduce((s, r) => s + r.adjustments.accepted, 0);
const totalAdjustmentsRejected = perRun.reduce((s, r) => s + r.adjustments.rejected, 0);
const rejectedReasonCounts = {};
for (const r of perRun) {
  for (const rr of r.adjustments.rejectedReasons) {
    rejectedReasonCounts[rr.reason] = (rejectedReasonCounts[rr.reason] || 0) + 1;
  }
}
const longestRun = perRun.reduce((max, r) => (r.wallMs > (max ? max.wallMs : -1) ? r : max), null);
// === true حصراً — لا 'unknown_no_raw_captured' الصادقة (Rule 22 مجدداً:
// "غير معروف" لا يُحسب "لم يقع").
const jsonRepairRuns = perRun.filter((r) => r.jsonRepairedAnyAttempt === true);
const jsonRepairUnknownRuns = perRun.filter((r) => r.jsonRepairedAnyAttempt === 'unknown_no_raw_captured');

// ─── P1.8 (منقول من PLAN-01-ROADMAP.md §P1.8، خارج هذا المستودع — غير
// متحقَّق من هنا، القاعدة 29): T = t_header + p99(completion_tokens) /
// p5(rate_tok_per_s) + margin؛ قيد الميزانية: T + 55000 (Gemini) ≤ 265000؛
// rate = completion_tokens / (duration - header). تُحسَب من العيّنات، لا
// تُثبَّت قبل عشرة نداءات على الأقلّ (نصّ الخطّة). ─────────────────────
function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const samples = []; // {headerMs, completionTokens, durationMs, rateTokPerS}
for (const r of perRun) {
  for (const a of r.attempts) {
    for (const n of a.network) {
      if (n.headerMs == null || n.completionTokens == null || a.durationMs == null) continue;
      const genMs = a.durationMs - n.headerMs;
      if (genMs <= 0) continue; // بيانات غير متّسقة — لا تُحسَب (لا قسمة على صفر/سالب)
      samples.push({
        headerMs: n.headerMs, completionTokens: n.completionTokens,
        durationMs: a.durationMs, rateTokPerS: n.completionTokens / (genMs / 1000),
      });
    }
  }
}

const MIN_SAMPLES_BEFORE_FIXING_NUMBER = 10; // نصّ الخطّة حرفياً — لا رقم قبل هذا العدد
let p18;
if (samples.length < MIN_SAMPLES_BEFORE_FIXING_NUMBER) {
  p18 = {
    ok: false,
    reason: `عيّنات غير كافية (${samples.length}/${MIN_SAMPLES_BEFORE_FIXING_NUMBER} على الأقلّ) — ` +
        `"لا يُثبَّت رقم قبل عشرة نداءات على الأقلّ" (PLAN-01-ROADMAP.md §P1.8، منقول غير متحقَّق).`,
    sampleCount: samples.length,
  };
} else {
  const tHeaderP99 = percentile(samples.map((s) => s.headerMs), 99);
  const completionP99 = percentile(samples.map((s) => s.completionTokens), 99);
  const rateP5 = percentile(samples.map((s) => s.rateTokPerS), 5);
  const margin = tHeaderP99; // هامش مبدئي = t_header نفسه (تحفّظي) — لا رقم من خارج العيّنات؛ راجع تقرير المهمّة
  const T = rateP5 > 0 ? (tHeaderP99 + (completionP99 / rateP5) * 1000 + margin) : null;
  const budgetOk = T !== null ? (T + 55000 <= 265000) : null;
  p18 = {
    ok: true, sampleCount: samples.length,
    tHeaderP99Ms: tHeaderP99, completionTokensP99: completionP99, rateTokPerSP5: rateP5,
    marginMs: margin, T_ms: T, budgetCheck265000: budgetOk,
    formula: 'T = t_header(p99) + completion_tokens(p99) / rate_tok_per_s(p5) + margin؛ قيد: T + 55000 (Gemini) ≤ 265000',
    note: 'منقول من PLAN-01-ROADMAP.md §P1.8 (خارج هذا المستودع) — الصيغة غير متحقَّقة من هذا المستودع، القيم محسوبة من العيّنات الفعلية أدناه فقط.',
  };
}

// ─── الطباعة — جدول + إجماليات ──────────────────────────────────────
console.log(`═══ تجميع ${totalRuns} تشغيلة (${GLOB_PREFIX}) ═══\n`);
console.log('scanId'.padEnd(38), 'attempts', 'guardFinal.ok', 'wallMs', 'jsonRepaired', 'adj(audit/raw)', 'languageLeak');
for (const r of perRun) {
  const adjPair = `${r.adjustments.proposed}/${r.adjustments.proposedFromRawIndependent === null ? '?' : r.adjustments.proposedFromRawIndependent}`;
  console.log(
      String(r.scanId).slice(0, 36).padEnd(38),
      String(r.attemptsCount).padEnd(8),
      String(r.guardFinalOk).padEnd(13),
      String(r.wallMs).padEnd(6),
      String(r.jsonRepairedAnyAttempt).padEnd(12),
      (r.adjustments.conflict ? `⚠ ${adjPair} تعارض` : adjPair).padEnd(16),
      String(r.languageLeakAnyAttempt),
  );
}

const conflictRuns = perRun.filter((r) => r.adjustments.conflict);
const totalAdjustmentsProposedFromRaw = perRun.reduce(
    (s, r) => s + (r.adjustments.proposedFromRawIndependent || 0), 0);

console.log('\n── الإجماليات ──');
console.log(`تشغيلات احتاجت محاولة٢: ${runsNeedingSecondAttempt}/${totalRuns}`);
console.log(`تعديلات (من audit.adjustments — القراءة القديمة وحدها): اقتُرح ${totalAdjustmentsProposed}، قُبل ${totalAdjustmentsAccepted}، رُفض ${totalAdjustmentsRejected}`);
console.log(`تعديلات (من rawResponseText — المصدر المستقلّ، القاعدة 38): اقتُرح ${totalAdjustmentsProposedFromRaw}`);
if (conflictRuns.length > 0) {
  console.log(`⚠⚠⚠ تعارض بين المصدرين في ${conflictRuns.length}/${totalRuns} تشغيلة — audit.adjustments لا يُطابق rawResponseText:`);
  for (const r of conflictRuns) {
    console.log(`  ${r.file}: audit=${r.adjustments.proposed} raw=${r.adjustments.proposedFromRawIndependent}`);
  }
}
console.log(`أسباب الرفض: ${JSON.stringify(rejectedReasonCounts)}`);
console.log(`أطول مدّة كلّية (wallMs): ${longestRun ? longestRun.wallMs + 'ms — ' + longestRun.file : 'n/a'}`);
console.log(`عطب JSON (احتاج jsonrepair فعلاً، مؤكَّد): ${jsonRepairRuns.length}/${totalRuns} تشغيلة — ${jsonRepairRuns.map((r) => r.file).join(', ') || '(لا شيء)'}`);
if (jsonRepairUnknownRuns.length > 0) {
  console.log(`⚠ غير معروف (لا rawResponseText محفوظ — ملفّات سابقة للبند ٢): ${jsonRepairUnknownRuns.length}/${totalRuns} تشغيلة — ${jsonRepairUnknownRuns.map((r) => r.file).join(', ')}`);
}
console.log(`\n── P1.8 (منقول، غير متحقَّق من هذا المستودع — راجع الحقل note) ──`);
console.log(JSON.stringify(p18, null, 2));

if (OUT_JSON) {
  const summary = {
    generatedAt: new Date().toISOString(), glob: GLOB_PREFIX, totalRuns,
    runsNeedingSecondAttempt, totalAdjustmentsProposed, totalAdjustmentsAccepted, totalAdjustmentsRejected,
    totalAdjustmentsProposedFromRaw, // القاعدة 38 — المصدر المستقلّ
    conflictRuns: conflictRuns.map((r) => ({file: r.file, audit: r.adjustments.proposed, raw: r.adjustments.proposedFromRawIndependent})),
    rejectedReasonCounts, longestRun: longestRun ? {file: longestRun.file, wallMs: longestRun.wallMs} : null,
    jsonRepairRuns: jsonRepairRuns.map((r) => r.file), p18, perRun,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
  console.log(`\nملخّص JSON محفوظ في: ${OUT_JSON}`);
}

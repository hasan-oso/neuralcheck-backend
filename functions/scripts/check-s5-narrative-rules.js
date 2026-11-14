#!/usr/bin/env node
'use strict';

// ===================================================================
// check-s5-narrative-rules — أداة فحص قواعد S5 (أمر مستخدم 2026-10-01
// +03، البند ٦: "أداة فحص قواعد S5 على السرد الناتج. القواعد الآلية
// تُعدّ بموضعها... والدلالية... تُعلَّم جملها للمراجعة، وتوسم 'عدّ يدوي'").
// ===================================================================
//
// نصّ S5 الكامل (أمر مستخدم 2026-09-30 +03، منقول في أمر هذه الجولة):
//   - لا رقم اختبار، ولا اسم بوّابة، ولا «الحمولة»، ولا كلمة لاتينية، إلا
//     أسماء الأجهزة والشرائح والعلامات والوحدات.
//   - لا حكم صحّة، لا إيجابي ولا سلبي، لفئة بلا حرف (البطارية والحرارة).
//   - لا حكم من قياس بلا عتبة معايَرة، ولا ذكر لتخفيض يقترحه النموذج.
//   - gpu_fps لا يُسمّى «معدّل إطارات».
//   - لا أرقام دقّة للكاميرا ولا عدد كاميراتها.
//   - الفئة تُسمّى «الموقع (GPS)».
//
// ─── الآلي مقابل الدلالي (نصّ الأمر حرفياً) ──────────────────────────────
// "القواعد الآلية تُعدّ بموضعها: رقم اختبار، واسم بوّابة، و«الحمولة»،
// ولاتيني خارج المسموح، و«معدّل إطارات»، وأرقام دقّة الكاميرا وعددها،
// وتسمية «الموقع (GPS)». والدلالية (حكم صحّة لفئة بلا حرف، وحكم من قياس
// بلا عتبة معايَرة، وذكر تخفيض مقترح) تُعلَّم جملها للمراجعة، وتوسم
// 'عدّ يدوي'." — الآلية أدناه `violations` (قطعية، بموضع دقيق)؛ الدلالية
// `manualReviewCandidates` (جمل مُرشَّحة فقط، **ليست** أحكاماً — القسم
// نفسه يُعيد النصّ الكامل للمُراجِع البشري، لا تصنيفاً نهائياً).
//
// ⚠️ **حدّ صادق لهذه الأداة (يُذكر لا يُخفى)**: الفحص الدلالي الثلاثة
// أعلاه غير قابل للحسم آلياً بثقة — "حكم صحّة" و"حكم من قياس غير معايَر"
// و"ذكر تخفيض مقترح" أحكام لغوية، لا مطابقة نمط. الأداة تُرشِّح جملاً
// تحتوي كلمات دالّة (قائمة أدناه) **لمراجعة بشرية**، ولا تقرّر "خرق" أو
// "سليم" — القرار النهائي دائماً بشري. أي استخدام لهذه الأداة كحارس آلي
// حاسم على القسم الدلالي مخالف لتصميمها المُعلَن هنا.
//
// ⚠️ **حدّ صادق ثانٍ — أسماء البوّابات**: القائمة KNOWN_GATE_NAMES أدناه
// **نسخة محلّية مقصودة** من الأسماء الحرفية في categoryStates.js
// (computeGates) — وليست مصدراً واحداً مُصدَّراً (القاعدة 24 مثالياً
// تقتضي استيراداً من src/analysis/buildDisplayShapeV7.js:KNOWN_GATE_NAMES
// الذي يحمل نفس القائمة). لم يُستورَد عمداً: ذلك الثابت جزء من تغييرات S1
// **غير المُلتزَمة بعد** في هذه الجولة (راجع تقرير المهمّة) — وهذا الملفّ
// يُلتزَم بمفرده الآن (بند "الأدوات الثلاث: التزام منفصل"). حين يُلتزَم
// S1، يُفضَّل توحيد المصدر هنا (نقل الاستيراد بدل هذه النسخة).
//
// Run (CLI): node functions/scripts/check-s5-narrative-rules.js <path-to-narrative.json>
// أو استورد checkS5Rules(narrativeLike, ctx) من كود آخر.
// ===================================================================

const fs = require('fs');
const path = require('path');

// نفس الأسماء الستّة حرفياً — راجع تحذير "حدّ صادق ثانٍ" أعلاه.
const KNOWN_GATE_NAMES = Object.freeze([
  'ROOT_DETECTED', 'PATCH_AGE', 'LOW_CATEGORY_COVERAGE',
  'BATTERY_MAX_ONE_BAND', 'STORAGE_VERIFY_ERRORS', 'GPU_HASH_MISMATCH', 'SUSTAINED_CEILING',
]);

// نمط معرّف اختبار: 1-4 حروف كبيرة، شرطة، رقم أو رقمان (SEC-04، C-01،
// CM-10، N-03، L-02، T-01، M-07، G-05...). لا يطابق "Wi-Fi"/"S10"/"A52"
// (بلا رقمين بعد شرطة، أو بلا شرطة أصلاً).
const TEST_ID_RE = /\b[A-Z]{1,4}-\d{1,2}\b/g;

// كلمة "الحمولة" — بحث حرفي مباشر (لا \b عربية بسيطة في JS regex).
function containsPayloadWord(text) {
  return text.includes('الحمولة');
}

// "معدّل إطارات" / "معدّل الإطارات" — الصيغتان المتوقَّعتان.
const FRAME_RATE_MISNOMER_RE = /معدّل\s+(الإطارات|إطارات)/;

// دقّة/عدد الكاميرا — استدلال لا حصر: رقم قريب من "ميغابكسل"/"MP"/"دقة
// الكاميرا"، أو "عدد" قريب من "كاميرا(ت)". **تقريبي بتصميم** (نصّ حرّ لا
// نمطاً ثابتاً) — إيجابيات كاذبة ممكنة، تُراجَع كأي مُخرَج آلي هنا.
const CAMERA_RESOLUTION_RE = /(\d+(\.\d+)?\s*(ميغابكسل|MP\b))|(دقة\s+الكاميرا[^.،؛]{0,20}\d)/;
const CAMERA_COUNT_RE = /(عدد\s+الكاميرات[^.،؛]{0,20}\d)|(\d+\s*كاميرات)/;

// تسمية GPS — الاسم القديم صريح الخطأ؛ "GPS" مجرّدة (بلا "الموقع (" قبلها
// مباشرة) تُرشَّح أيضاً (قد تكون سليمة لو "الموقع (GPS)" الكاملة، فنستثني
// تلك الصيغة تحديداً بدل رفض أي ذكر لـ"GPS").
const OLD_GPS_NAME = 'نظام تحديد المواقع';
const CANONICAL_GPS_PHRASE = 'الموقع (GPS)';
function findGpsNamingIssues(text) {
  const issues = [];
  if (text.includes(OLD_GPS_NAME)) issues.push({rule: 'GPS_NAMING', detail: `الاسم القديم "${OLD_GPS_NAME}" — المطلوب "${CANONICAL_GPS_PHRASE}"`});
  // GPS بلا "الموقع (" قبلها بثلاثة أحرف فأقلّ (يسمح بفراغ اختياري).
  const bareGpsRe = /GPS/g;
  let m;
  while ((m = bareGpsRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (!before.includes('الموقع (') && !before.includes('الموقع(')) {
      issues.push({rule: 'GPS_NAMING', detail: `"GPS" مجرّدة بلا "الموقع (" قبلها — السياق: "...${before.slice(-12)}GPS..."`});
    }
  }
  return issues;
}

// ─── الفئة الدلالية — كلمات دالّة تُرشِّح جملة للمراجعة، لا تحكم عليها ────
const NO_LETTER_CATEGORY_WORDS = ['البطارية', 'الحرارة', 'الإدارة الحرارية'];
const JUDGMENT_WORDS = ['سليم', 'سليمة', 'جيد', 'جيدة', 'ممتاز', 'ممتازة', 'ضعيف', 'ضعيفة', 'سيّئ', 'سيئة', 'متدهور', 'متدهورة', 'صحّي', 'صحّية'];
const UNCALIBRATED_CONTEXT_WORDS = ['غير معايَر', 'غير معايرة', 'عتبة غير معايَرة', 'لم يُعايَر'];
const SUGGESTED_DOWNGRADE_PHRASES = ['أقترح خفض', 'ينبغي أن ينخفض', 'يجب أن ينخفض', 'أرى أن.*ينخفض', 'اقترح تخفيض', 'يستحقّ تخفيضاً'];

function splitSentences(text) {
  return text.split(/(?<=[.؟!])\s+/).map((s) => s.trim()).filter(Boolean);
}

function findSemanticCandidates(text) {
  const out = [];
  for (const sentence of splitSentences(text)) {
    if (NO_LETTER_CATEGORY_WORDS.some((w) => sentence.includes(w)) &&
        JUDGMENT_WORDS.some((w) => sentence.includes(w))) {
      out.push({rule: 'HEALTH_JUDGMENT_NO_LETTER', sentence});
    }
    if (UNCALIBRATED_CONTEXT_WORDS.some((w) => sentence.includes(w)) &&
        JUDGMENT_WORDS.some((w) => sentence.includes(w))) {
      out.push({rule: 'UNCALIBRATED_MEASUREMENT_JUDGMENT', sentence});
    }
    if (SUGGESTED_DOWNGRADE_PHRASES.some((p) => new RegExp(p).test(sentence))) {
      out.push({rule: 'SELF_SUGGESTED_DOWNGRADE_MENTION', sentence});
    }
  }
  return out;
}

/**
 * فحص نصّ واحد (حقل واحد) بكل القواعد الآلية.
 * @param {string} text
 * @param {string} fieldPath للتقرير فقط
 * @param {Set<string>} latinLeakTokensLowercase توكِنز لاتينية "متسرّبة"
 *   محسوبة مسبقاً (اختياري — عبر reportShapeV7.computeLeaksV7 إن توفّر
 *   ctx.findings/ctx.categoryStates، القاعدة 24: لا إعادة تصنيف لاتيني
 *   مستقلّة هنا؛ خارج ذلك، كل توكِن لاتيني غير في القائمة المسموحة يُبلَّغ).
 * @return {Array<Object>} مخالفات آلية
 */
// قرار مستخدم 2026-10-07 +03: المصدر الواحد src/analysis/allowedLatin.js (القاعدة 24) بدل النسخة المحلّية التي كانت هنا
// (neuralcheck، qr، usb، wi، fi، bluetooth، nfc، gps، a، b، c، d) — تضيف عليها vulkan وopengl، وgps كانت فيها.
const ALLOWED_LATIN_BARE = new Set(require('../src/analysis/allowedLatin').ALLOWED_LATIN_TOKENS);
function checkAutomaticRulesOnText(text, fieldPath, latinLeakTokensLowercase) {
  const violations = [];

  let m;
  TEST_ID_RE.lastIndex = 0;
  while ((m = TEST_ID_RE.exec(text)) !== null) {
    violations.push({rule: 'TEST_ID_MENTION', field: fieldPath, match: m[0], index: m.index});
  }

  for (const name of KNOWN_GATE_NAMES) {
    let idx = text.indexOf(name);
    while (idx !== -1) {
      violations.push({rule: 'GATE_NAME_MENTION', field: fieldPath, match: name, index: idx});
      idx = text.indexOf(name, idx + 1);
    }
  }

  if (containsPayloadWord(text)) {
    violations.push({rule: 'FORBIDDEN_WORD_PAYLOAD', field: fieldPath, match: 'الحمولة', index: text.indexOf('الحمولة')});
  }

  const frameMatch = FRAME_RATE_MISNOMER_RE.exec(text);
  if (frameMatch) {
    violations.push({rule: 'FRAME_RATE_MISNOMER', field: fieldPath, match: frameMatch[0], index: frameMatch.index});
  }

  const camRes = CAMERA_RESOLUTION_RE.exec(text);
  if (camRes) violations.push({rule: 'CAMERA_RESOLUTION_MENTION', field: fieldPath, match: camRes[0], index: camRes.index});
  const camCount = CAMERA_COUNT_RE.exec(text);
  if (camCount) violations.push({rule: 'CAMERA_COUNT_MENTION', field: fieldPath, match: camCount[0], index: camCount.index});

  for (const issue of findGpsNamingIssues(text)) {
    violations.push({rule: issue.rule, field: fieldPath, detail: issue.detail});
  }

  // لاتيني خارج المسموح — إن توفّرت latinLeakTokensLowercase (من الحارس
  // الحقيقي reportShapeV7.computeLeaksV7 حين ctx متاح)، نستعملها كما هي
  // (القاعدة 24: لا تصنيف لاتيني ثانٍ). خلاف ذلك، استدلال محلّي مباشر —
  // كل توكِن لاتيني بحرفين فأكثر غير ضمن ALLOWED_LATIN_BARE يُبلَّغ (قد
  // يُبلِّغ خطأً عن اسم جهاز/شريحة حقيقي — يُراجَع بشرياً، لا يُرفض تلقائياً).
  if (latinLeakTokensLowercase) {
    for (const tok of latinLeakTokensLowercase) {
      violations.push({rule: 'LATIN_OUTSIDE_ALLOWLIST', field: fieldPath, match: tok});
    }
  } else {
    const latinRe = /[A-Za-z][A-Za-z0-9]*/g;
    let lm;
    while ((lm = latinRe.exec(text)) !== null) {
      const lower = lm[0].toLowerCase();
      if (!ALLOWED_LATIN_BARE.has(lower)) {
        violations.push({rule: 'LATIN_OUTSIDE_ALLOWLIST', field: fieldPath, match: lm[0], index: lm.index,
          note: 'تقديري بلا ctx.findings/categoryStates — قد يكون اسم جهاز/شريحة حقيقياً، راجع يدوياً'});
      }
    }
  }

  return violations;
}

/**
 * يجمع كل حقول النثر البشري من كائن narrative-like (أو aiAnalysis كامل).
 * @param {Object} input
 * @return {Array<{path: string, text: string}>}
 */
function collectProseFields(input) {
  const out = [];
  const nar = (input && input.narrative && typeof input.narrative === 'object') ? input.narrative : (input || {});
  for (const key of ['summary', 'details', 'verdict']) {
    if (typeof nar[key] === 'string') out.push({path: `narrative.${key}`, text: nar[key]});
  }
  if (nar.buyerAdvice && typeof nar.buyerAdvice === 'object') {
    for (const [profile, text] of Object.entries(nar.buyerAdvice)) {
      if (typeof text === 'string') out.push({path: `narrative.buyerAdvice.${profile}`, text});
    }
  }
  if (nar.issueDescriptions && typeof nar.issueDescriptions === 'object') {
    for (const [id, text] of Object.entries(nar.issueDescriptions)) {
      if (typeof text === 'string') out.push({path: `narrative.issueDescriptions[${id}]`, text});
    }
  }
  const crossChecks = Array.isArray(input && input.crossChecks) ? input.crossChecks : [];
  crossChecks.forEach((cc, i) => {
    if (cc && typeof cc.description === 'string') out.push({path: `crossChecks[${i}].description`, text: cc.description});
  });
  const adjustments = Array.isArray(input && input.adjustments) ? input.adjustments : [];
  adjustments.forEach((a, i) => {
    if (a && typeof a.reason === 'string') out.push({path: `adjustments[${i}].reason`, text: a.reason});
  });
  const modelObservations = Array.isArray(input && input.modelObservations) ? input.modelObservations : [];
  modelObservations.forEach((o, i) => {
    if (o && typeof o.text === 'string') out.push({path: `modelObservations[${i}].text`, text: o.text});
  });
  return out;
}

/**
 * الدالّة الرئيسة — تفحص كائناً narrative-like (أو aiAnalysis كاملاً) بكل
 * قواعد S5 الآلية والدلالية.
 * @param {Object} input كائن يحمل narrative (وربما crossChecks/adjustments/
 *   modelObservations) — شكل مخرَج النموذج الخام، لا display.
 * @param {Object} [ctx] {findings, categoryStates} اختياري — إن تو��ّر،
 *   يُستعمَل تصنيف اللاتيني الحقيقي (reportShapeV7.computeLeaksV7) بدل
 *   الاستدلال المحلّي (القاعدة 24، دقّة أعلى).
 * @return {{violations: Array, manualReviewCandidates: Array, fieldsChecked: number}}
 */
function checkS5Rules(input, ctx) {
  const fields = collectProseFields(input);
  let latinLeaksByField = null;
  if (ctx && (ctx.findings || ctx.categoryStates)) {
    try {
      // eslint-disable-next-line global-require
      const {computeLeaksV7} = require('../src/analysis/reportShapeV7');
      const leakResult = computeLeaksV7(input, ctx);
      latinLeaksByField = new Map();
      for (const leak of leakResult.leaks) {
        const set = latinLeaksByField.get(leak.path) || new Set();
        for (const t of leak.tokens) set.add(t.toLowerCase());
        latinLeaksByField.set(leak.path, set);
      }
    } catch (e) {
      // لا يُسقِط الأداة كلّها — يسقط إلى الاستدلال المحلّي (مُعلَن في
      // مخرَج كل مخالفة لاتينية عبر note، راجع checkAutomaticRulesOnText).
      latinLeaksByField = null;
    }
  }

  const violations = [];
  const manualReviewCandidates = [];
  for (const {path: fieldPath, text} of fields) {
    const tokensForField = latinLeaksByField ? (latinLeaksByField.get(fieldPath) || new Set()) : null;
    violations.push(...checkAutomaticRulesOnText(text, fieldPath, tokensForField));
    for (const candidate of findSemanticCandidates(text)) {
      manualReviewCandidates.push({...candidate, field: fieldPath, label: 'عدّ يدوي'});
    }
  }

  return {violations, manualReviewCandidates, fieldsChecked: fields.length};
}

function printReport(result) {
  console.log(`حقول مفحوصة: ${result.fieldsChecked}`);
  console.log(`مخالفات آلية: ${result.violations.length}`);
  for (const v of result.violations) {
    console.log(`  [${v.rule}] ${v.field}${v.match ? ` — "${v.match}"` : ''}${v.detail ? ` — ${v.detail}` : ''}${v.note ? ` (${v.note})` : ''}`);
  }
  console.log(`مُرشَّحات للمراجعة البشرية (دلالية، عدّ يدوي): ${result.manualReviewCandidates.length}`);
  for (const c of result.manualReviewCandidates) {
    console.log(`  [${c.rule}][عدّ يدوي] ${c.field} — "${c.sentence}"`);
  }
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('الاستعمال: node check-s5-narrative-rules.js <path-to-narrative-or-aiAnalysis.json>');
    process.exit(1);
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  const result = checkS5Rules(input, null);
  printReport(result);
  process.exit(result.violations.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {checkS5Rules, checkAutomaticRulesOnText, collectProseFields, findSemanticCandidates, KNOWN_GATE_NAMES, TEST_ID_RE};

// ===================================================
// rebuildCategoryScores — يُعيد بناء category_scores خادمياً من:
//   • functionalResults + manualResults (العدّ والتغطية)
//   • aiResult.category_scores (رأي النموذج إن وصل)
//   • aiResult.issues (مسار احتياطي إن لم تصل درجات النموذج)
//
// fix/category-grading — لماذا أُعيدت كتابة الدالة:
//   1. المسار الاحتياطي القديم كان يكتب grade "A" لكل فئة لا يجد لها issue
//      مطابقة، بلا علاقة بالنتيجة (7/10 → A، 0/0 → A، 0/1 → A). وقد ظهر ذلك
//      فعلاً في الإنتاج عندما بُترت استجابة Gemini قبل issues/categoryScores.
//   2. لم يكن يفرّق بين "فُحصت ونجحت" و"لم تُفحص إطلاقاً" (total_count = 0).
//   3. كان يُسقط not_tested/unavailable بلا أثر، فتظهر gpu كـ 2/2 بينما
//      ثلاثة اختبارات لم تُنفَّذ.
//   4. كان يقرأ functionalResults فقط، فكل الفحوص اليدوية خارج العدّ.
//   5. قائمة الفئات كانت 13 (بلا audio/input) ومكرّرة في ملفين.
//   6. مطابقة issues[].category كانت حرفية، فتنكسر إن ترجم النموذج القيمة.
//
// المبدأ الجديد: الحرف لا يتجاوز ما تدعمه الاختبارات المنفَّذة. النموذج يستطيع
// تخفيض الدرجة (حكم خبير) لا رفعها فوق نسبة النجاح. الرقم والحرف يُقفلان معاً
// على نفس النطاق (A≥85, B≥70, C≥55, D<55 — نفس عتبات applySeverityPenalty
// والبرومبت).
//
// دلالة الحالات:
//   pass / fail / warning       → اختبار مُنفَّذ (يدخل total_count)
//   not_tested                  → المستخدم تخطّاه = لا شهادة، لا فشل
//   unavailable                 → الجهاز لا يوفّر القياس = لا شهادة، لا فشل
//   total_count = 0             → grade "?" وscore 0 و"لا اختبارات متاحة"
//
// شكل كل فئة في المخرج (الحقول القديمة كما هي + حقول تغطية إضافية):
//   grade, score, pass_count, total_count, note,
//   fail_count, warning_count, not_tested_count, unavailable_count,
//   excluded_count, declared_count, measured, grade_source,
//   expected_range? (إن وصل من النموذج), ai_grade? (إن خالف الحرف النهائي)
// ===================================================
const {
  CATEGORIES,
  normalizeCategory,
  manualCategoryFor,
} = require("../utils/categories");

const EXECUTED_STATUSES = new Set(["pass", "fail", "warning"]);
const LETTER_ORDER = {A: 0, B: 1, C: 2, D: 3, F: 4};
const BAND_MAX = {A: 100, B: 84, C: 69, D: 54, F: 20};
const AI_LETTER_PATTERN = /^[ABCD][+-]?$|^F$/;

const NO_TESTS_NOTE = {
  ar: "لا اختبارات متاحة لهذه الفئة",
  tr: "Bu kategori için test mevcut değil",
  en: "No tests available for this category",
};

function noTestsNote(language) {
  return NO_TESTS_NOTE[language] || NO_TESTS_NOTE.ar;
}

// A≥85, B≥70, C≥55, D<55 — مطابق لـ callAI.applySeverityPenalty وGRADING GUIDANCE.
function letterFromScore(score) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

function baseLetter(grade) {
  return typeof grade === "string" && grade.length > 0 ? grade[0].toUpperCase() : null;
}

// يُرجع الأسوأ من حرفين (يحتفظ بلاحقة +/- للحرف الفائز).
function worseOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ra = LETTER_ORDER[baseLetter(a)];
  const rb = LETTER_ORDER[baseLetter(b)];
  if (ra === undefined) return b;
  if (rb === undefined) return a;
  return rb > ra ? b : a;
}

// فحص اتساق نهائي: الحرف لا يجوز أن يكون أفضل من نطاق الرقم (A مع 70 مثلاً).
// يُخفَّض الحرف إلى نطاق الرقم؛ الرقم لا يُرفَع أبداً. الحرف الأسوأ من الرقم
// مسموح (حكم أشدّ من النموذج بعد قصّ الرقم على سقف نطاقه).
function enforceConsistency(entry) {
  if (!entry || typeof entry.grade !== "string") return entry;
  const base = baseLetter(entry.grade);
  if (!(base in LETTER_ORDER) || base === "F") return entry;
  if (typeof entry.score !== "number" || entry.score < 0 || entry.score > 100) return entry;
  const scoreLetter = letterFromScore(entry.score);
  if (LETTER_ORDER[scoreLetter] > LETTER_ORDER[base]) {
    entry.grade = scoreLetter;
    entry.reconciled = true;
  }
  return entry;
}

// خريطة {فئة مُطبَّعة → مدخل النموذج}. تقبل مفاتيح مُترجمة أو بحالة مختلفة.
function indexAiCategoryScores(aiResult) {
  const raw = aiResult?.category_scores ?? aiResult?.categoryScores ?? null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const cat = normalizeCategory(key);
    if (cat && val && typeof val === "object" && !out[cat]) out[cat] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// حرف النموذج المقبول أو null. السنتينلات (INSUFFICIENT_*) و"?" تُعاد كما هي
// ليُعالجها المنادي؛ أي قيمة أخرى (فارغة/غير معروفة) → null.
function parseAiGrade(aiCat) {
  if (!aiCat || typeof aiCat.grade !== "string") return null;
  const g = aiCat.grade.trim();
  if (!g) return null;
  if (g === "?" || g === "INSUFFICIENT_DATA" || g === "INSUFFICIENT_STRESS_DATA") return g;
  const up = g.toUpperCase();
  return AI_LETTER_PATTERN.test(up) ? up : null;
}

function severityRank(sev) {
  const s = String(sev || "").toLowerCase();
  if (s === "critical" || s === "danger") return 3;
  if (s === "high" || s === "warning") return 2;
  if (s === "medium" || s === "info" || s === "low") return 1;
  return 0;
}

function rebuildCategoryScores(aiResult, functionalResults, manualResults, options) {
  const language = (options && options.language) || "ar";
  const functional = Array.isArray(functionalResults) ? functionalResults : [];
  const manual = Array.isArray(manualResults) ? manualResults : [];
  const issues = Array.isArray(aiResult?.issues) ? aiResult.issues : [];
  const aiScores = indexAiCategoryScores(aiResult);

  // تجميع مسبق: كل اختبار → فئته المُطبَّعة (functional عبر categoryName،
  // manual عبر categoryName ثم خريطة testId القديمة).
  const bucket = {};
  for (const cat of CATEGORIES) bucket[cat] = [];
  for (const r of functional) {
    const cat = normalizeCategory(r?.categoryName);
    if (cat && bucket[cat]) bucket[cat].push(r);
  }
  for (const r of manual) {
    const cat = manualCategoryFor(r);
    if (cat && bucket[cat]) bucket[cat].push(r);
  }

  const issuesByCat = {};
  for (const i of issues) {
    const cat = normalizeCategory(i?.category);
    if (!cat) continue;
    (issuesByCat[cat] = issuesByCat[cat] || []).push(i);
  }

  const result = {};

  for (const cat of CATEGORIES) {
    const tests = bucket[cat];
    const counts = {pass: 0, fail: 0, warning: 0, not_tested: 0, unavailable: 0};
    for (const r of tests) {
      const st = String(r?.status || "").toLowerCase();
      if (st in counts) counts[st]++;
      else counts.not_tested++; // حالة غير معروفة = لا شهادة
    }
    const executed = counts.pass + counts.fail + counts.warning;
    const excluded = counts.not_tested + counts.unavailable;
    const passRate = executed > 0 ? Math.round((counts.pass / executed) * 100) : 0;

    const aiCat = aiScores ? aiScores[cat] : null;
    const aiGrade = parseAiGrade(aiCat);
    const aiNote = aiCat ? (aiCat.verdict || aiCat.note || "") : "";
    const expectedRange = aiCat ? (aiCat.expected_range || aiCat.expectedRange || "") : "";

    const entry = {
      grade: "?",
      score: 0,
      pass_count: counts.pass,
      total_count: executed,
      note: "",
      fail_count: counts.fail,
      warning_count: counts.warning,
      not_tested_count: counts.not_tested,
      unavailable_count: counts.unavailable,
      excluded_count: excluded,
      declared_count: tests.length,
      measured: executed > 0,
      grade_source: "unmeasured",
    };

    if (aiGrade === "INSUFFICIENT_STRESS_DATA") {
      // V3: stress test لم يصل للإشباع — sentinel يُستثنى من overallScore في الـ UI.
      entry.grade = aiGrade;
      entry.score = -1;
      entry.measured = false;
      entry.grade_source = "ai_sentinel";
      entry.note = aiNote;
    } else if (executed === 0) {
      // لا اختبار مُنفَّذ: لا حرف نجاح مهما قال النموذج. حكم النموذج (إن وُجد)
      // يُحفَظ في ai_grade للشفافية فقط.
      entry.note = noTestsNote(language) + (aiNote ? "؛ " + aiNote : "");
      if (aiGrade && aiGrade !== "?" && aiGrade !== "INSUFFICIENT_DATA") {
        entry.ai_grade = aiGrade;
      }
    } else {
      const rateLetter = letterFromScore(passRate);
      const aiLetter = (aiGrade && AI_LETTER_PATTERN.test(aiGrade)) ? aiGrade : null;

      if (aiLetter) {
        // المسار الأساسي: الأسوأ من (حرف النموذج، حرف نسبة النجاح).
        const finalGrade = worseOf(aiLetter, rateLetter);
        entry.grade = finalGrade;
        entry.score = Math.min(passRate, BAND_MAX[baseLetter(finalGrade)]);
        entry.grade_source = baseLetter(finalGrade) === baseLetter(aiLetter) ?
            "ai" : "tests";
        if (baseLetter(aiLetter) !== baseLetter(finalGrade)) entry.ai_grade = aiLetter;
        entry.note = aiNote;
      } else {
        // المسار الاحتياطي: نسبة النجاح أولاً، ثم تخفيض بشدّة issues المطابقة.
        const catIssues = issuesByCat[cat] || [];
        let rank = 0;
        for (const i of catIssues) rank = Math.max(rank, severityRank(i.severity));
        let grade = rateLetter;
        let score = passRate;
        if (rank === 3) {
          grade = worseOf(grade, "D"); score = Math.min(score, 40);
        } else if (rank === 2) {
          grade = worseOf(grade, "C"); score = Math.min(score, 60);
        } else if (rank === 1) {
          grade = worseOf(grade, "B"); score = Math.min(score, 80);
        }
        entry.grade = grade;
        entry.score = score;
        entry.grade_source = (rank > 0 && grade !== rateLetter) ? "issues" : "tests";
        entry.note = aiNote || catIssues
            .map((i) => i.title || "").filter(Boolean).join("؛ ");
      }
    }

    if (expectedRange) entry.expected_range = expectedRange;

    result[cat] = enforceConsistency(entry);
  }

  return result;
}

module.exports = {
  rebuildCategoryScores,
  letterFromScore,
  worseOf,
  enforceConsistency,
  NO_TESTS_NOTE,
  // مُصدَّر لأجل buildV7Payload.js (applyV7Adjustments) — نفس القصّ
  // بالضبط المُطبَّق هنا (سطر 210: entry.score = Math.min(passRate,
  // BAND_MAX[baseLetter(finalGrade)])) حين حرف يتفوّق على نسبة نجاح خام:
  // الرقم يُقصّ إلى سقف نطاق الحرف الجديد، لا يُرفَع أبداً. applyV7Adjustments
  // تحتاج نفس القاعدة حين تُخفِّض حرف فئة (adjustments[] من V7) — بلا هذا
  // التصدير كانت ستُضطرّ لنسخ الجدول يدوياً (مصدر انحراف لاحق مضمون).
  BAND_MAX,
};

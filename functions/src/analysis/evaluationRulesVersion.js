'use strict';

// ===================================================================
// evaluationRulesVersion.js — ختم قواعد التقييم (P6-26، الجزء الأوّل، 2026-10-13 +03)
// ===================================================================
//
// جواب المستخدم، بنصّه (2026-10-13؛ منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): "Start P6-26's stamp now (Recommended)"، ووصف الخيار كما عُرض: "One exported constant,
// written to every new report as `evaluationRulesVersion` (not displayed, not in verifyReport). First value marks this change; named in the contract. The rest of P6-26 stays planned."
// وتصميم P6-26 المعتمد (منقول، غير متحقَّق: plan/PLAN-06-DATA-COLLECTION.md:1139): «ختم في كل تقرير: إصدار الخادم (التزام النشر)، وإصدار التطبيق (قائم…)، ونسخة قواعد التقييم (`thresholdSet`…)».
// **المنفَّذ هنا: ثابت قواعد التقييم وحده.** إصدار الخادم وبقيّة P6-26 ليست منفَّذة.
//
// ─── ما هو، وأين يُكتب، وأين لا يصل ────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   ثابت واحد مُصدَّر (EVALUATION_RULES_VERSION)، يُكتب في جذر كل مستند reports/{scanId} جديد باسم EVALUATION_RULES_VERSION_FIELD (= evaluationRulesVersion) — analyzeDevice.js: buildReportDocument.
//   لا يُعرض، ولا يدخل ردّ verifyReport (قائمته البيضاء)، ولا شكل العرض (aiResponse)، ولا الإرجاع إلى العميل. غائب عن حمولة النموذج.
//   اسم الحقل قيمة حرفية يقوم عليها تمييز، فمصدره هنا أيضاً (القاعدة 24) — لا نصّ حرفي منه في analyzeDevice.js ولا في مولّدات العيّنات الذهبية.
//   العقد: docs/V7_DISPLAY_SHAPE_CONTRACT.md §١٥ (الغياب في تقرير قديم «كُتب قبل الختم»؛ ومسار التقرير المخبَّأ).
//
// ─── لماذا ملفّ مستقلّ لا بجوار thresholdSet (findings.js:155) ولا بجوار PIPELINE_VERSION (signatures/constants.js) ──────────────────────────────────
//   • thresholdSet مدخل واحد من مدخلات القواعد (عتبتان اليوم)؛ وقواعد التقييم موزَّعة على testKinds.js وcategoryStates.js وfindings.js وcycleCountClassification.js وغيرها. وضع الختم عند عتبة واحدة يوحي بأنه ختمها وحدها.
//   • PIPELINE_VERSION بوّابة كاش (تغيّره يُسقط إعادة الاستعمال لكل المستخدمين)، والمستخدم اختار ختم القواعد لا رفع PIPELINE_VERSION (أمر 2026-10-13). فلا يُبنى الاثنان في ملفّ واحد يُرفعان معاً بالخطأ.
//   • ملفّ بلا أيّ require: يُحمَّل من analyzeDevice.js ومن المولّدات والاختبارات بلا جرّ findings.js.
//
// ─── القيمة الأولى ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   «rules-2026-10-13-zero-cycles-unsupported» تسمّي هذا التغيير وتاريخه: صفر الدورات من EXTRA_CYCLE_COUNT صار «غير مدعوم» (cycleCountClassification.js). بلا ادّعاء سبب لم يُقَل (نمط PIPELINE_VERSION:
//   signatures/constants.js). ما الذي يستوجب تغيير الختم لاحقاً: غير محسوم (بقيّة P6-26 مخطَّطة)؛ لا يُرفع تلقائياً ولا يُرفع بلا قرار.
//
// ─── القيمة الحالية (الرفع الأوّل، 2026-10-23 +03) ──────────────────────────────────────────────────────────────────────────────────────────────
//   «rules-2026-10-23-hardware-absent-coverage»: ق٢ (INV:112) غيّر تعريف تغطية الفئة — ما أعلن الفنّي غيابه (outcome=NOT_MEASURED وnotMeasuredReason=HARDWARE_ABSENT) خرج من مقام التغطية
//   (categoryStates.js: computeHealthBearingStats)، فتغيّرت تغطية الفئة وتفاصيل بوّابة LOW_CATEGORY_COVERAGE وحالة الفئة (PARTIAL ⟵ MEASURED) في تقارير الأجهزة التي ضغط فنّيها «غير متوفر».
//   قرار حسن 2026-10-23، بنصّه من أمر المستخدم (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): «ق٢ (INV:112): يُرفع evaluationRulesVersion قبل النشر ليميّز التقارير قبل ق٢ وبعده.»
//   التقارير المخزَّنة قبل الرفع تحتفظ بختمها السابق في مستنداتها (لا يُعاد ملؤه ولا يُعاد تقييمها) وتقارير ما قبل الختم بلا الحقل (docs/V7_DISPLAY_SHAPE_CONTRACT.md §١٥).
//   لا يُرفع تلقائياً ولا يُرفع بلا قرار — القاعدة نفسها بعد هذا الرفع.
// ===================================================================

/** اسم الحقل في جذر مستند reports/{scanId}. */
const EVALUATION_RULES_VERSION_FIELD = 'evaluationRulesVersion';

/** ختم قواعد التقييم المطبَّقة في هذا الإصدار من الخادم. */
const EVALUATION_RULES_VERSION = 'rules-2026-10-23-hardware-absent-coverage';

module.exports = {EVALUATION_RULES_VERSION, EVALUATION_RULES_VERSION_FIELD};

'use strict';

// goldenFixturesGuardCoverage.test.js — القرار ٩٢ البند ٢ (نصّ المستخدم
// حرفياً): "اختبار يعدّد كل ملفّ في مجلّد العيّنات الذهبية، ويفشل إن وُجد
// ملفّ لا يعيد الحارس توليده ولا يقارنه." السبب المباشر: v7-client-payload-
// sample-llm-adjusted.json عاش أشهراً بلا أي حارس (القرار ٩٢ البند ١)،
// ولا آلية كانت تكتشف ذلك — هذا الاختبار يمنع تكرار الفجوة لأي ملفّ جديد.
//
// ⚠️ **لا افتراض (القاعدة 13)**: ليست كل الملفّات في هذا المجلّد "عيّنات
// ذهبية مولَّدة" — بعضها **مُدخلات** (سلاسل زمنية خام، قِيَم مرجعية من
// سكربتات Python خارجية، التقاط Firestore بالقراءة فقط) وبعضها توثيق. كل
// ملفّ أدناه مُصنَّف صراحة بحالته الأربع الممكنة، بمصدره/مولّده/حارسه
// بالسطر — لا "مولَّد افتراضاً" لمجرّد أنه JSON. **قبول كل استثناء (حالة
// INPUT/DOC) قرار المستخدم** — مذكور بارزاً في تقرير المهمّة، لا مطموساً
// هنا.
//
// ─── منهج التصنيف (مصدره test/fixtures/golden/README.md وREADME-variance-
// golden.md، وتحقّق مباشر بـgrep لكل ملفّ — لا نقل من الذاكرة) ───────────
//
// (أ) GENERATED_AND_GUARDED — ملفّ ناتج فعلياً عن سكربت `generate-*.js` في
//     functions/scripts/، وحارسه (اختبار في functions/test/) يعيد بناءه
//     من مُدخلاته الحقيقية ويقارنه بالثابت المُلتزَم (تطابق كامل)، أو
//     يتحقّق من كل حكم مُعلَن عليه مباشرة حين لا يمكن إعادة البناء الكاملة
//     (v6-reports-document-sample.json — مُدخله الخام خارج المستودع
//     بتصميم، README.md:186-192) — كلا النمطين "يقارنه" بمعنى نصّ الأمر
//     ("لا يعيد توليده ولا يقارنه" — كافٍ أن يتحقّق أحدهما).
//
// (ب) DOCUMENTED_INPUT — ملفّ **لا يُولِّده أي سكربت في هذا المستودع من
//     مُدخلات أخرى مُلتزَمة** — التقاط خارجي (سلسلة زمنية من جهاز حقيقي،
//     أو استخراج Firestore بالقراءة فقط يحتاج شبكة/بيانات اعتماد، أو
//     مخرَج سكربت Python خارج شجرة functions/) — لا "حارس" ممكن له بمعنى
//     إعادة التوليد المحلّية؛ هو نفسه مُدخل لمولّدات/اختبارات أخرى. كل
//     سطر يحمل قارئه المؤكَّد بالسطر أيضاً — إن لم يكن له قارئ حالياً
//     (EXPECTED-compare_runs.json)، يُذكر ذلك صراحةً لا يُخفى.
//
// (ج) DOCUMENTATION — ليس بيانات اختبار إطلاقاً (Markdown/مرجع خوارزمية).
//
// أيّ ملفّ في المجلّد **لا** يظهر في إحدى القوائم الثلاث أدناه ⇒ فشل فوري
// مُسمًّى (لا تجاهل صامت) — هذا هو جوهر الحماية المطلوبة.
//
// Run: node functions/test/goldenFixturesGuardCoverage.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const TEST_DIR = __dirname;

// ═══════════════════════════════════════════════════════════════════════
// (أ) مولَّدة ومحروسة — {generator, generatorDestLine, guard, guardLine}
// ═══════════════════════════════════════════════════════════════════════
const GENERATED_AND_GUARDED = {
  'v7-client-payload-sample.json': {
    generator: 'generate-v7-client-payload-sample.js', generatorDestLine: 120,
    guard: 'v7ClientPayloadContractGuard.test.js', guardLine: 42,
  },
  'v7-client-payload-sample-llm-adjusted.json': {
    // القرار ٩٢ البند ١ أعاد توليدها (كانت متأخّرة منذ 488c32f، 2026-09-22)،
    // والبند ٢ (هذا الالتزام) أغلق فجوتها الحقيقية: استُخرجت
    // buildClientPayloadSampleLlmAdjusted() من main() (كانت غير قابلة
    // للاستيراد بأمان — main() تُستدعى غير مشروطة، فأي require() سابق
    // كان سيكتب الملفّ فوراً) وبُني لها حارس مثل شقيقتيها تماماً.
    generator: 'generate-v7-client-payload-sample-llm-adjusted.js', generatorDestLine: 106,
    guard: 'v7ClientPayloadLlmAdjustedContractGuard.test.js', guardLine: 22,
  },
  'v7-reports-document-sample.json': {
    generator: 'generate-v7-reports-document-sample.js', generatorDestLine: 175,
    guard: 'v7ReportsDocumentContractGuard.test.js', guardLine: 37,
  },
  'v7-reports-document-sample-honor.json': {
    generator: 'generate-v7-reports-document-sample-honor.js', generatorDestLine: 86,
    guard: 'v7ReportsDocumentHonorContractGuard.test.js', guardLine: 23,
  },
  'v7-verifyReport-response-sample.json': {
    generator: 'generate-v7-verifyReport-response-sample.js', generatorDestLine: 57,
    guard: 'v7VerifyReportResponseContractGuard.test.js', guardLine: 39,
  },
  'v7-verifyReport-response-sample-honor.json': {
    generator: 'generate-v7-verifyReport-response-sample-honor.js', generatorDestLine: 27,
    guard: 'v7VerifyReportResponseHonorContractGuard.test.js', guardLine: 20,
  },
  'v6-reports-document-sample.json': {
    generator: 'generate-v6-reports-document-sample.js', generatorDestLine: 57,
    // لا إعادة بناء كاملة (مُدخله الخام خارج المستودع بتصميم، golden/README.md:186-192)
    // — الحارس يتحقّق من كل حكم مُعلَن مباشرة على الملفّ المُلتزَم.
    guard: 'v6ReportsDocumentContractGuard.test.js', guardLine: 30,
  },
  'v6-verifyReport-response-sample.json': {
    generator: 'generate-v6-verifyReport-response-sample.js', generatorDestLine: 37,
    guard: 'v6VerifyReportResponseContractGuard.test.js', guardLine: 34,
  },
  // القرار ٩٥ البند ٣ (2026-09-25 +03) — أوّل عيّنتين تحملان letterSource=
  // "LLM_ADJUSTED" فعلياً بعد إغلاق القرار ٩٤-١ (صفر عيّنة أخرى تحمله —
  // مُتحقَّق: audit-golden-applied-llm-adjustments.js). عبر السلسلة
  // الحقيقية الكاملة (resolveV7Report/applyV7Adjustments/buildReportDocument)،
  // بردّ نموذج مصنوع (functions/test/fixtures/frozen-fake-model-response-
  // security-down-sec04-fail-2026-09-25.json) يستشهد بدليل حقيقي — SEC-04،
  // outcome=FAIL — لا حرف ولا بوّابة.
  'v7-reports-document-sample-security-downgrade.json': {
    generator: 'generate-v7-reports-document-sample-security-downgrade.js', generatorDestLine: 80,
    guard: 'v7ReportsDocumentSecurityDowngradeContractGuard.test.js', guardLine: 23,
  },
  'v7-verifyReport-response-sample-security-downgrade.json': {
    generator: 'generate-v7-verifyReport-response-sample-security-downgrade.js', generatorDestLine: 39,
    guard: 'v7VerifyReportResponseSecurityDowngradeContractGuard.test.js', guardLine: 22,
  },
  // القرار ٩٨ البند ٢ (2026-09-25 +03) — عيّنة LLM_ADJUSTED بحرف يتغيّر
  // ظاهرياً فعلاً (cpu: B→C)، بدليل FAIL في اختبار قياس (C-06) داخل الفئة
  // نفسها. مدخل معدَّل عنصراً واحداً (C-06: pass→fail، موسوم صراحة) + ردّ
  // نموذج مصنوع (frozen-fake-model-response-cpu-down-c06-fail-modified-input-2026-09-25.json).
  'v7-reports-document-sample-cpu-c06-downgrade.json': {
    generator: 'generate-v7-reports-document-sample-cpu-c06-downgrade.js', generatorDestLine: 77,
    guard: 'v7ReportsDocumentCpuC06DowngradeContractGuard.test.js', guardLine: 23,
  },
  'v7-verifyReport-response-sample-cpu-c06-downgrade.json': {
    generator: 'generate-v7-verifyReport-response-sample-cpu-c06-downgrade.js', generatorDestLine: 31,
    guard: 'v7VerifyReportResponseCpuC06DowngradeContractGuard.test.js', guardLine: 22,
  },
  // مهمّة A (2026-10-07 +03، أمر المستخدم: «عيّنة مشتقّة يولّدها الخادم نفسه من مُدخل لا تُقاس فيه أي فئة، فيمتلئ zeroMeasuredMessage وabstentionReasons ... وتُنسخ إلى
  // التطبيق والموقع (القاعدة 39)») — ستّ عيّنات (متغيّران بثلاثة أشكال: مستند reports وردّ analyzeDevice وردّ verifyReport) + ملفّ المصدر والتحويل (_meta،
  // ملفّ مستقلّ لأن القاعدة 41 تمنع مفتاح _meta داخل عيّنة يُفترَض أن تطابق مُنتِجها). مولَّدة بالسلسلة الحقيقية من 34dff2b8 محوَّلاً (التحويل مكتوب في _meta).
  'v7-reports-document-sample-zero-measured.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 109,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 28,
  },
  'v7-client-payload-sample-zero-measured.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 109,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 28,
  },
  'v7-verifyReport-response-sample-zero-measured.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 109,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 28,
  },
  'v7-reports-document-sample-zero-measured-battery-harness-error.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 109,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 28,
  },
  'v7-client-payload-sample-zero-measured-battery-harness-error.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 109,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 28,
  },
  'v7-verifyReport-response-sample-zero-measured-battery-harness-error.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 109,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 28,
  },
  // V8 نقل الخامّ (2026-10-09) — عيّنات مستند reportRaw/{scanId} الستّ، شقيقة عيّنات مستند التقرير المقروء: الخامّ (rawFingerprint،
  // sessionId، deviceFingerprintSha، timeSeriesStoragePath، aiAudit) انتقل من المستند المقروء إلى reportRaw. تُولَّد بالمولّد نفسه
  // في الجولة نفسها من المُدخلات نفسها (buildReportRawDocument)، ويحرسها الحارس نفسه (إعادة بناء ومقارنة، القاعدة 39).
  'v7-report-raw-sample.json': {
    generator: 'generate-v7-reports-document-sample.js', generatorDestLine: 177,
    guard: 'v7ReportsDocumentContractGuard.test.js', guardLine: 40,
  },
  'v7-report-raw-sample-honor.json': {
    generator: 'generate-v7-reports-document-sample-honor.js', generatorDestLine: 88,
    guard: 'v7ReportsDocumentHonorContractGuard.test.js', guardLine: 26,
  },
  'v7-report-raw-sample-security-downgrade.json': {
    generator: 'generate-v7-reports-document-sample-security-downgrade.js', generatorDestLine: 93,
    guard: 'v7ReportsDocumentSecurityDowngradeContractGuard.test.js', guardLine: 28,
  },
  'v7-report-raw-sample-cpu-c06-downgrade.json': {
    generator: 'generate-v7-reports-document-sample-cpu-c06-downgrade.js', generatorDestLine: 79,
    guard: 'v7ReportsDocumentCpuC06DowngradeContractGuard.test.js', guardLine: 26,
  },
  'v7-report-raw-sample-zero-measured.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 117,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 32,
  },
  'v7-report-raw-sample-zero-measured-battery-harness-error.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 128,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 38,
  },
  'v7-zero-measured-samples-meta.json': {
    generator: 'generate-v7-reports-document-sample-zero-measured.js', generatorDestLine: 97,
    guard: 'v7ZeroMeasuredSamplesContractGuard.test.js', guardLine: 40,
  },
  // V8 الدفعة ٤ (2026-10-09 +03، أمر المنسّق، البند ٩، القاعدة 39) — قراءات fv68 المشتقّة: ما يُخرجه قارئ الخادم (fv68Reader.readFv68) من الحمولات الأربع
  // المُلتزَمة (ثلاث fv68 مشتقّة + طلب 1.0.10). مشتقّة لا مسجَّلة من جهاز (القاعدة 41: مرحلة ٢ لم تُنجَز). الحارس يعيد البناء ويقارن بايتاً ببايت ويحمل أحكام معنى باليد.
  'fv68-readings-derived-from-app-payload-11ch-nothing-admitted.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 66,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 50,
  },
  'fv68-readings-derived-from-app-payload-13ch-selinux-blocked-policy.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 66,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 50,
  },
  'fv68-readings-derived-from-app-payload-16ch-four-policies-truncated-failures.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 66,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 50,
  },
  'fv68-readings-derived-from-fv67-request-1.0.10-62507f4.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 66,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 50,
  },
  // 2026-10-13 +03 (قرّاء D في fv70) — قراءات الحمولات الثلاث fv70 (الغربال بـsieveLimit، والمتروك skipped:time_budget، والحالة partial:time_budget). المولّد والحارس نفساهما.
  'fv68-readings-derived-from-app-payload-fv70-11ch-nothing-admitted.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 66,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 50,
  },
  'fv68-readings-derived-from-app-payload-fv70-13ch-selinux-blocked-policy.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 66,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 50,
  },
  'fv68-readings-derived-from-app-payload-fv70-16ch-four-policies-truncated-failures.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 66,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 50,
  },
  // مزامنة fv71 (2026-10-18 +03، أمر المنسّق، القاعدتان 39 و41) — قراءات حمولات fv71 الثلاث **من المُنتِج** (NeuralChek@f9e0571: A-M02 وA-VOL وA-P6-13). مولَّدة بـgenerate-fv68-readings-derived.js ومحروسة
  // بـfv68ReadingsGolden.test.js (يعيد البناء ويقارن بايتاً ببايت + أحكام معنى باليد من الحمولة). حلّت محلّ ست قراءات لعيّنات بنيتُها من العقد (حُذفت: القاعدة 23). وحمولاتها نفسها نسخ حرفية في (ب) أدناه.
  'fv68-readings-derived-from-app-payload-fv71-11ch-nothing-admitted.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 84,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 50,
  },
  'fv68-readings-derived-from-app-payload-fv71-13ch-selinux-blocked-policy.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 84,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 51,
  },
  'fv68-readings-derived-from-app-payload-fv71-16ch-four-policies-truncated-failures.json': {
    generator: 'generate-fv68-readings-derived.js', generatorDestLine: 84,
    guard: 'fv68ReadingsGolden.test.js', guardLine: 52,
  },
  // A-SUB الموجة الأولى (القرار ١٤، 2026-10-17 +03، القاعدتان 39 و41) — أجسام الرفض على السلك (حالة HTTP + {error}) وردّ checkSubscription بشكله الحالي، من الدوالّ المُصدَّرة الحقيقية خلف غلاف onCall الحقيقي
  // (db وحده مستبدَل في الذاكرة؛ بلا محاكٍ). الحارس يعيد البناء ويقارن حرفاً بحرف، ويقارن القوائم المغلقة بالوحدات وبالعقد §٦-د-١. checkSubscription ستُعاد عند تنفيذ القرار ٨ (مؤجَّل).
  'refusal-wire-samples-asub-wave1.json': {
    generator: 'generate-refusal-wire-samples.js', generatorDestLine: 215,
    guard: 'refusalWireGoldenGuard.test.js', guardLine: 52,
  },
  'check-subscription-wire-samples-current-shape.json': {
    generator: 'generate-refusal-wire-samples.js', generatorDestLine: 216,
    guard: 'refusalWireGoldenGuard.test.js', guardLine: 53,
  },
  // ربط «قبل/بعد صيانة» (أمر المستخدم 2026-10-22، المرحلة S7، القاعدتان 39 و41) — **ردود** listOpenMaintenanceBefores وconfirmMaintenanceAfterLink ورفوض نوع العطل في setSessionPurpose على السلك، من الدالّات المُصدَّرة الحقيقية خلف غلاف onCall الحقيقي (db وحده مستبدَل في الذاكرة).
  // الحارس يعيد البناء ويقارن حرفاً بحرف، ويغطّي القوائم المغلقة والعقد A3 ويفحص الظهور؛ بلا عيّنة طلب من التطبيق (يُنتجها كاتب التطبيق ثم تُنسخ).
  'maintenance-pair-wire-samples-2026-10-22.json': {
    generator: 'generate-maintenance-pair-wire-samples.js', generatorDestLine: 39,
    guard: 'maintenancePairWireSamplesGuard.test.js', guardLine: 83,
  },
};

// ═══════════════════════════════════════════════════════════════════════
// (ب) مُدخلات موثَّقة — لا يُولِّدها أي سكربت من مُدخلات أخرى مُلتزَمة هنا.
// كل سطر: source (من أين أتت فعلياً) + consumers (من يقرؤها اليوم، بالسطر)
// ═══════════════════════════════════════════════════════════════════════

// V8 الدفعة ٣ الجزء ٣ (2026-10-08 +03؛ **مُحدَّثة إلى fv69 في 2026-10-10 +03، الدفعة ١٠**) — ستّ ملفّات نُسخت حرفياً من NeuralChek@a04b4f0
// (كانت fv68 على 738da89، وقبلها cfa9ef3 حتى 2026-10-08) (app/src/test/resources/derived/): ثلاثة .json لحمولة التطبيق (fv69) وثلاثة .keys.txt بجانبها.
// **مشتقّة لا فحص حقيقي**، ولا يُولِّدها سكربت هنا — تُولَّد في التطبيق وتُنسخ (القاعدة 39). تفصيلها
// وsha256 الستّة في golden/README.md (القسم الأخير). **منقول من نصّ الأمر، غير متحقَّق عندي:**
// المستودع المصدر خارج حدودي.
const FV69_STEM = 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const FV69_SOURCE = 'نسخة حرفية من NeuralChek@a04b4f0 (fieldsVersion 69، الدفعة ١٠؛ كانت fv68 على 738da89 وقبلها cfa9ef3؛ app/src/test/resources/derived/؛ sha256 تطابق SHA256SUMS.txt في مجلّد المنسّق evidence/v8-phase0/fv69-for-backend/) — مشتقّة لا فحص حقيقي: المصدر الخامّ 34dff2b8.ts.json ثم السلسلة الحقيقية للتطبيق في JVM بقيم مصنوعة معلنة في README التطبيق (منقول من نصّ الأمر، غير متحقَّق هنا). تُعاد توليدها في التطبيق وتُنسخ ثانيةً (القاعدة 39)، ولا تُعدَّل هنا (golden/README.md، قسما fv68 وتحديث fv69). fv68 لم يُشحن في أيّ APK.';
const FV69_CONSUMERS = [
  'test/fv68AppPayloadGoldenCopy.test.js (sha256 والتفكيك ومطابقة .keys.txt)',
  'test/fv68Reader.test.js وfindingsFv68Readers.test.js وfv68RawPreservation.test.js وfv68Names.test.js وscanSignatureAbsence.test.js وrunConsistencyTestByName.test.js (القرّاء على العيّنات، القاعدتان 37 و41)',
  'scripts/generate-fv68-readings-derived.js (يولّد منها القراءات الذهبية) وtest/fv68ReadingsGolden.test.js',
  'test/analyzeDeviceFv68.e2e.test.js (تمرّ بـanalyzeDevice الحقيقية على المحاكي وتصل reportRaw)',
];
const FV69_ENTRIES = Object.fromEntries([
  '11ch-nothing-admitted.json',
  '11ch-nothing-admitted.keys.txt',
  '13ch-selinux-blocked-policy.json',
  '13ch-selinux-blocked-policy.keys.txt',
  '16ch-four-policies-truncated-failures.json',
  '16ch-four-policies-truncated-failures.keys.txt',
].map((suffix) => [`${FV69_STEM}${suffix}`, {source: FV69_SOURCE, consumers: FV69_CONSUMERS}]));

// 2026-10-13 +03 (قرّاء D في fv70) — ستّ ملفّات نُسخت حرفياً من NeuralChek@80ca8c3 (مجلّد المنسّق scratchpad/be-d-readers-2026-10-13/goldens-from-app-80ca8c3/ ومعه SHA256SUMS.txt): الحمولات الثلاث نفسها
// بعد أن غيّر التطبيق عيّناته (sieveLimit، skipped:time_budget، partial:time_budget — §٧-ط من عقد التطبيق، منقول، غير متحقَّق من هذا المستودع) وثلاثة .keys.txt. **عيّنات fv69 أعلاه تبقى** (1.0.11 ما زال في الميدان).
// مشتقّة لا فحص حقيقي، ولا يُولِّدها سكربت هنا (تُولَّد في التطبيق وتُنسخ، القاعدة 39). sha256 في test/fv68AppPayloadGoldenCopy.test.js وفي golden/README.md.
const FV70_STEM = 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const FV70_SOURCE = 'نسخة حرفية من NeuralChek@80ca8c3 (fieldsVersion 70، §٧-ط؛ منقول من أمر المنسّق 2026-10-13، غير متحقَّق من المستودع المصدر) عبر مجلّد المنسّق be-d-readers-2026-10-13/goldens-from-app-80ca8c3/ (SHA256SUMS.txt)؛ sha256 مُتحقَّق بـsha256sum -c قبل النسخ وبعد الالتزام';
const FV70_CONSUMERS = [
  'test/fv68AppPayloadGoldenCopy.test.js (sha256 والتفكيك ومطابقة .keys.txt)',
  'test/cpuKnownAnswerFv70.test.js (قرّاء D على العيّنات الثلاث: القارئ والتوقيع وحمولة النموذج وسكربتا الفحص ٠٣ والعناقيد)',
  'test/deviceCheck03Round2.test.js (جدول توقّعات الجولة ٢ للفحص ٠٣ من main الحقيقية: عيّنتا 11ch و13ch من fv70 بتعديل مكتوب لكل وسم)',
  'scripts/generate-fv68-readings-derived.js (يولّد منها القراءات الذهبية) وtest/fv68ReadingsGolden.test.js',
];
const FV70_ENTRIES = Object.fromEntries([
  '11ch-nothing-admitted.json',
  '11ch-nothing-admitted.keys.txt',
  '13ch-selinux-blocked-policy.json',
  '13ch-selinux-blocked-policy.keys.txt',
  '16ch-four-policies-truncated-failures.json',
  '16ch-four-policies-truncated-failures.keys.txt',
].map((suffix) => [`${FV70_STEM}${suffix}`, {source: FV70_SOURCE, consumers: FV70_CONSUMERS}]));

// 2026-10-18 +03 (مزامنة fv71) — ستّ ملفّات نُسخت حرفياً من NeuralChek@f9e0571 عبر مجلّد المنسّق evidence/run-2026-10-18/fv71-producer-goldens/: الحمولات الثلاث نفسها بعد A-M02 وA-VOL وA-P6-13 (fieldsVersion 71، قسم
// §٧-ي من عقد التطبيق، منقول، غير متحقَّق من المستودع المصدر) وثلاثة .keys.txt. **صنعها اختبار التطبيق الذهبي من سلسلته الحقيقية** (لا من العقد)، فهي الحمولة بشكل المُنتِج (القاعدة 41) — وهي التي حلّت محلّ عيّناتي الست المبنيّة من العقد.
// مشتقّة لا فحص حقيقي، ولا يُولِّدها سكربت هنا (تُولَّد في التطبيق وتُنسخ، القاعدة 39). sha256 الستّة في test/fv68AppPayloadGoldenCopy.test.js وفي golden/README.md (محسوبة هنا؛ بلا README مصدر قابل للقراءة بالقيم الكاملة).
const FV71_STEM = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-';
// **2026-10-21 +03 (M-02 «إطار + X»، أمر الباك اند ٤):** استُبدلت بايتات الستّة بما أعاد التطبيق توليده من مُنتِجه الحقيقي (NeuralChek@4c0102c) — الأسماء نفسها.
// **2026-10-22 +03 (M-02 بشكل اختبار اللمس في قائمة سامسونج، أمر الباك اند ٧):** استُبدلت بايتات الثلاثة .json ثانيةً بما أعاد التطبيق توليده (NeuralChek@3810146؛ الـ.keys.txt الثلاثة بلا تغيير)؛ والتفصيل في golden/README.md وfv71-producer-goldens-3810146.SOURCE.txt (حلّ محلّ سجلّ 4c0102c بـgit mv).
const FV71_SOURCE = 'نسخة حرفية من NeuralChek@3810146 (fieldsVersion 71؛ نُسخت بـcp من شجرة التطبيق بقراءة فقط، وsha256 الستّة تطابق الكتلة بين golden-sha256:begin وgolden-sha256:end في app/src/test/resources/derived/README.md هناك كاملةً — sha256sum -c وcmp؛ أمر المنسّق 2026-10-22)؛ مشتقّة لا فحص حقيقي';
const FV71_CONSUMERS = [
  'test/fv68AppPayloadGoldenCopy.test.js (sha256 والتفكيك ومطابقة .keys.txt)',
  'test/fv71ProducerSamples.test.js (القارئ الحقيقي على العيّنات الثلاث، وطبقات التمرير والتخزين، وأحكام بالبناء بمرجع مستقلّ)',
  'test/fv71M02FrameXReader.test.js («إطار + X»: القارئ الحقيقي على العيّنات الثلاث بلا مُستبدِل، وكل قيمة وكل علاقة وكل غياب)',
  'test/fv71TouchGridReader.test.js وfv71VolumeButtonReader.test.js وfv71ScanConditionsReader.test.js وfv71ModelPayloadRaw.test.js (القرّاء ومسار النموذج على العيّنات)',
  'scripts/generate-fv68-readings-derived.js (يولّد منها القراءات الذهبية) وtest/fv68ReadingsGolden.test.js',
  'test/analyzeDeviceFv71ProducerSamples.e2e.test.js (تمرّ بـanalyzeDevice الحقيقية على المحاكي وتصل reportRaw ولا تصل النموذج)',
];
const FV71_ENTRIES = Object.fromEntries([
  '11ch-nothing-admitted.json',
  '11ch-nothing-admitted.keys.txt',
  '13ch-selinux-blocked-policy.json',
  '13ch-selinux-blocked-policy.keys.txt',
  '16ch-four-policies-truncated-failures.json',
  '16ch-four-policies-truncated-failures.keys.txt',
].map((suffix) => [`${FV71_STEM}${suffix}`, {source: FV71_SOURCE, consumers: FV71_CONSUMERS}]));

// 2026-10-21 +03 (M-02 «إطار + X») — حمولتان من مجموعة fv71 **السابقة** (NeuralChek@f9e0571، قبل gridPattern وnotRequiredCells) باقيتان بأسماء جديدة، نسختين حرفيتين من blob التزام الخادم السابق (sha256: c52d8ebf… و1c0e0391…):
// دليل **مُنتِج حقيقي** على ما يرسله بناء الجولة 324578f وما قبله (بلا المفتاحين ⟵ NOT_DECLARED، لا شذوذ) — حالة لا تُصنع اصطناعاً (القاعدة 41). لا قراءات ذهبية مولَّدة منهما (القراءات الذهبية للعيّنات الجديدة).
const FV71_LEGACY_STEM = 'fv71-before-m02-frame-x-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const FV71_LEGACY_SOURCE = 'نسخة حرفية من مجموعة fv71 السابقة (NeuralChek@f9e0571) كما كانت في هذا المستودع قبل 2026-10-21 (git show HEAD:… ثم sha256sum: c52d8ebf… للـ11ch و1c0e0391… للـ13ch)؛ مشتقّة لا فحص حقيقي؛ لا تُعدَّل (القاعدة 12)';
const FV71_LEGACY_CONSUMERS = ['test/fv71M02FrameXReader.test.js (حالة NOT_DECLARED: تقرير ختم 71 بلا المفتاحين من مُنتِج حقيقي — sha256 وقراءة القارئ الحقيقي)'];
const FV71_LEGACY_ENTRIES = Object.fromEntries([
  '11ch-nothing-admitted.json',
  '13ch-selinux-blocked-policy.json',
].map((suffix) => [`${FV71_LEGACY_STEM}${suffix}`, {source: FV71_LEGACY_SOURCE, consumers: FV71_LEGACY_CONSUMERS}]));

// 2026-10-09 (ما قبل أوّل نشر V8، البند ٥) — طلب 1.0.10 (fv67): نسخة حرفية من مجلّد المنسّق
// evidence/v8-phase0/fv67-1010-request-from-34dff2b8/ (بنته وكيل التطبيق بكود 62507f4 من 34dff2b8.ts.json في JVM). مشتقّ لا مسجَّل.
const FV67_STEM = 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8';
const FV67_SOURCE = 'نسخة حرفية (sha256 مُثبَّت في test/fv67AppRequestGoldenCopy.test.js) من مجلّد المنسّق evidence/v8-phase0/fv67-1010-request-from-34dff2b8/ — طلب analyzeDevice كما يرسله 1.0.10 (NeuralChek@62507f4) من ملفّ fv67 (34dff2b8.ts.json، 1.0.8-v6beta): حالة إعادة تحليل ملفّ fv67. مشتقّ لا مسجَّل: لم يُرسَل من جهاز ولا من الإنتاج (منقول من README المجلّد، غير متحقَّق من هذا المستودع). لا يُعدَّل هنا.';
const FV67_CONSUMERS = ['test/analyzeDevice1010Compat.e2e.test.js (الطلب كما هو عبر analyzeDevice الحقيقية)', 'test/fv67AppRequestGoldenCopy.test.js (sha256 والتفكيك ومطابقة .keys.txt)'];
const FV67_ENTRIES = {
  [`${FV67_STEM}.json`]: {source: FV67_SOURCE, consumers: FV67_CONSUMERS},
  [`${FV67_STEM}.keys.txt`]: {source: FV67_SOURCE, consumers: FV67_CONSUMERS},
};

// 2026-10-22 +03 (ربط «قبل/بعد صيانة»، أمر المنسّق بعد 29baa10) — خمس عيّنات **طلبات** من التطبيق (لا ردود الخادم: تلك maintenance-pair-wire-samples-2026-10-22.json المولَّدة أعلاه): نسخ حرفية (-text) من NeuralChek@fed7d12
// app/src/test/resources/derived/، صنعها **بُناة التطبيق الحقيقيون** (SessionPurposeWire وPairLinkWire). مشتقّة لا مسجَّلة من جهاز؛ تُولَّد في التطبيق وتُنسخ (القاعدة 39). sha256 الخمس في السجلّ المسمّى وفي الاختبار القارئ.
const MAINT_PAIR_REQ_SOURCE = 'نسخة حرفية من NeuralChek@fed7d12 (app/src/test/resources/derived/maintenance-pair-request-*.json؛ آخر تغيير لها 830ff31)؛ sha256 الخمس تطابق كتلة maintenance-pair-sha256 في README التطبيق وgit show على المصدر وsha256sum -c على النسخ (السجلّ: maintenance-pair-app-requests-fed7d12.SOURCE.txt)؛ مشتقّة لا فحص حقيقي؛ لا تُعدَّل (القاعدة 12)';
const MAINT_PAIR_REQ_CONSUMERS = ['test/maintenancePairAppRequestSamples.test.js (البصمة والشكل مفتاحاً مفتاحاً، ثم تمرّ بـsetSessionPurpose وlistOpenMaintenanceBefores وconfirmMaintenanceAfterLink الحقيقية عبر غلاف onCall بقاعدة في الذاكرة)'];
const MAINT_PAIR_REQ_ENTRIES = Object.fromEntries([
  'set-session-purpose-maintenance-before-battery',
  'set-session-purpose-maintenance-after-charging-port',
  'set-session-purpose-normal-no-defect-type',
  'list-open-maintenance-befores',
  'confirm-maintenance-after-link',
].map((name) => [`maintenance-pair-request-${name}.json`, {source: MAINT_PAIR_REQ_SOURCE, consumers: MAINT_PAIR_REQ_CONSUMERS}]));

const DOCUMENTED_INPUTS = {
  ...MAINT_PAIR_REQ_ENTRIES,
  ...FV69_ENTRIES,
  ...FV70_ENTRIES,
  ...FV71_ENTRIES,
  ...FV71_LEGACY_ENTRIES,
  ...FV67_ENTRIES,
  '8909e850-s10.ts.json': {
    source: 'التقاط سلسلة زمنية حقيقية من جهاز S10 — rebuld/s10-timeseries.json (خارج المستودعات الثلاثة، golden/README.md:11)',
    consumers: ['test/categoryStates.test.js (s10Raw)', 'test/batteryLayer.test.js'],
  },
  'e4b65a2f-honor.ts.json': {
    source: 'التقاط سلسلة زمنية حقيقية من جهاز Honor — rebuld/honor-timeseries.json (golden/README.md:12)',
    consumers: ['test/categoryStates.test.js (honorRaw)', 'test/buildDisplayShapeV7.test.js'],
  },
  'b45c8cf6.ts.json': {
    source: 'التقاط سلسلة زمنية حقيقية — rebuld/VARIANCE-inputs/run1-b45c8cf6.ts.json (golden/README.md:13)',
    consumers: ['test/buildV7Payload.test.js', 'test/categoryStates.test.js', 'test/expectedV7PayloadBytes.test.js', 'وغيرها — الفخّ الأكثر استهلاكاً في السويت'],
  },
  '34dff2b8.ts.json': {
    source: 'التقاط سلسلة زمنية حقيقية — rebuld/VARIANCE-inputs/run2-34dff2b8.ts.json (golden/README.md:14)',
    consumers: ['scripts/generate-v7-client-payload-sample.js', 'scripts/generate-v7-client-payload-sample-llm-adjusted.js', 'test/expectedV7PayloadBytes.test.js'],
  },
  'functionalResults-by-scanid.json': {
    source: 'استخراج Firestore بالقراءة فقط (REST + gcloud auth) — scripts/fetch-functional-results-golden.js:32 (OUT_FILE) — يحتاج شبكة/بيانات اعتماد ليُعاد توليده، لا يُشغَّل هنا (golden/README.md:37-60)',
    consumers: ['test/testKinds.test.js', 'test/categoryStates.test.js', 'test/buildV7Payload.test.js', 'وأغلب سويت V7 — يحمل rawFingerprint.functionalResults الحقيقية لأربعة فحوص'],
  },
  'EXPECTED-timeseries_stats.json': {
    source: 'مخرَج سكربت Python خارجي timeseries_stats.py (rebuld/scripts/) — مرجع تنفيذي، لا يُشغَّل من هذا المستودع (golden/README.md:20،31-35)',
    consumers: ['test/findings.test.js:60'],
  },
  'EXPECTED-timeseries_stats-variance.json': {
    source: 'نفس سكربت Python أعلاه، مُشغَّلاً على فحصين إضافيّين لإكمال الأربعة (golden/README-variance-golden.md، بصمة SHA-256 موثَّقة هناك)',
    consumers: ['test/findings.test.js:61'],
  },
  'derived-from-NC-TM7PDN-governing-gate-reason-2026-09-30.json': {
    // أمر مستخدم 2026-09-30 +03 (إصلاح governingGateReason، التزام c3b7b6c)
    // — مشتقّ من تصدير حقيقي (export-v7-report-readonly.js على جهاز حقيقي،
    // shortId=NC-TM7PDN)، لا سكربت في هذا المستودع يُنتجه من مُدخلات
    // مُلتزَمة (المصدر الكامل خارج المستودع، في مجلّد القيادة بمساحة
    // العمل — راجع _meta داخل الملفّ نفسه). لا حارس بمعنى إعادة البناء —
    // نفس فئة EXPECTED-*.json (مخرَج خارجي مُلتقَط، لا مُولَّد محلياً).
    source: 'مشتقّ (لا نسخة) من تصدير حقيقي واحد خارج المستودع — v7-report-export-NC-TM7PDN.json (export-v7-report-readonly.js، shortId=NC-TM7PDN). _meta داخل الملفّ يحمل المصدر الكامل وقائمة التعديلات الثلاثة (القاعدة 12).',
    consumers: ['test/buildDisplayShapeV7.test.js (قسم "NC-TM7PDN حقيقي (مشتقّ)")'],
  },
  'EXPECTED-compare_runs.json': {
    // القرار ١٠٤ البند ٩٦.١ (2026-09-26 +03) — نصّ سبب الاستثناء مُملًى
    // حرفياً في القرار ٩٦ البند ١ (منقول من plan/PLAN-01-ROADMAP.md:2057
    // في مساحة العمل — ليس في هذا المستودع، القاعدة 29): "لا قارئ في
    // الكود. محفوظ دليلاً (golden/README.md:5، القاعدة 8)، وفيه
    // inference_cv_pct_3_runs = 5.7 (السطر 2971)، وهي قيمة
    // UNSTABLE_REFERENCE_CV_PCT (findings.js:69)." **المراجع الثلاثة
    // مُتحقَّق منها مباشرة في هذا المستودع قبل الكتابة (لا افتراض)**:
    // golden/README.md:5 يطابق حرفياً ("لا تُحذف (القاعدة 8) — هي الدليل
    // الوحيد داخل المستودع على المخرَج المتوقَّع")؛
    // EXPECTED-compare_runs.json:2971 يطابق حرفياً ("inference_cv_pct_3_runs":
    // 5.7,)؛ findings.js:69 يطابق حرفياً (`const UNSTABLE_REFERENCE_CV_PCT
    // = 5.7;`). **صفر فرق — لا تصحيح لزم على النصّ المُملى.**
    source: 'لا قارئ في الكود. محفوظ دليلاً (golden/README.md:5، القاعدة 8)، وفيه inference_cv_pct_3_runs = 5.7 (السطر 2971)، وهي قيمة UNSTABLE_REFERENCE_CV_PCT (findings.js:69).',
    consumers: ['لا قارئ حالي في functions/ — مُتحقَّق بـgrep، القاعدة 22 (الغياب مُعلَن لا مُخفى)'],
  },
};

// ═══════════════════════════════════════════════════════════════════════
// (ج) توثيق فقط — ليست بيانات اختبار
// ═══════════════════════════════════════════════════════════════════════
const DOCUMENTATION_FILES = new Set([
  'README.md',
  'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.README.md', // README المجلّد المصدر (المصدر والسلسلة والقيود) — نسخة حرفية
  'README-variance-golden.md',
  'fv71-producer-goldens-3810146.SOURCE.txt', // سجلّ مصدر مجموعة fv71 الحالية (NeuralChek@3810146؛ كان fv71-producer-goldens-4c0102c.SOURCE.txt حتى 2026-10-21) وsha256 كاملة — نصّ لا بيانات اختبار (2026-10-22)
  'maintenance-pair-app-requests-fed7d12.SOURCE.txt', // سجلّ مصدر عيّنات طلبات التطبيق الخمس (NeuralChek@fed7d12) وsha256 كاملة — نصّ لا بيانات اختبار (2026-10-22)
  'REFERENCE-timeseries_stats.py', // مرجع خوارزمية خارجي، "لا يُشغَّل في الإنتاج" (golden/README.md:35) — ليس عيّنة JSON
]);

// ─── التحقّق الفعلي ───────────────────────────────────────────────────
const actualFiles = fs.readdirSync(GOLDEN_DIR).filter((f) => {
  const st = fs.statSync(path.join(GOLDEN_DIR, f));
  return st.isFile();
});
ok(actualFiles.length > 0, '[إعداد] مجلّد golden/ يحمل ملفّات فعلاً (لا تحقّق على مجلّد فارغ بالخطأ)');

const accountedFor = new Set([
  ...Object.keys(GENERATED_AND_GUARDED),
  ...Object.keys(DOCUMENTED_INPUTS),
  ...DOCUMENTATION_FILES,
]);

// (١) كل ملفّ فعلي في المجلّد يجب أن يكون معدوداً في إحدى القوائم الثلاث —
// هذا هو الفحص الجوهري المطلوب صراحةً.
for (const file of actualFiles) {
  ok(accountedFor.has(file),
      `[القرار ٩٢-٢] "${file}" موجود في test/fixtures/golden/ لكنه غير مُصنَّف في أيٍّ من القوائم الثلاث (مولَّد ومحروس / مُدخل موثَّق / توثيق) — ملفّ غير محروس ولا مُبرَّر، أضِفه إلى إحدى القوائم أعلاه صراحةً`);
}

// (٢) العكس أيضاً — لا إدخال وهمي في القوائم لملفّ لم يعد موجوداً (دفاع في
// العمق: يمنع بقاء تصنيف قديم لملفّ حُذف يوهم بأن التصنيف محدَّث).
for (const file of accountedFor) {
  ok(actualFiles.includes(file),
      `[دفاع في العمق] "${file}" مُصنَّف في هذا الاختبار لكنه لم يعد في test/fixtures/golden/ فعلياً — التصنيف بحاجة تحديث`);
}

// (٣) لكل عنصر GENERATED_AND_GUARDED: يُتحقَّق فعلياً أن سكربت المولّد
// موجود، وأن ملفّ الحارس (إن ذُكر) موجود ويذكر اسم هذا الملفّ الذهبي
// حرفياً في نصّه (لا ادّعاء ربط بلا أثر حقيقي في الحارس).
for (const [file, info] of Object.entries(GENERATED_AND_GUARDED)) {
  const generatorPath = path.join(SCRIPTS_DIR, info.generator);
  ok(fs.existsSync(generatorPath), `[القرار ٩٢-٢] مولّد "${file}" (${info.generator}) موجود فعلاً في functions/scripts/`);
  if (info.guard) {
    const guardPath = path.join(TEST_DIR, info.guard);
    ok(fs.existsSync(guardPath), `[القرار ٩٢-٢] حارس "${file}" (${info.guard}) موجود فعلاً في functions/test/`);
    if (fs.existsSync(guardPath)) {
      const guardSource = fs.readFileSync(guardPath, 'utf8');
      ok(guardSource.includes(file), `[القرار ٩٢-٢] ${info.guard} يذكر اسم الملفّ "${file}" حرفياً في نصّه — ربط حقيقي لا ادّعاء`);
    }
  } else {
    // مُعلَنة صراحة بلا حارس (الفجوة المفتوحة الموثَّقة أعلاه) — لا فشل
    // هنا (القرار لم يطلب بناء حارس تلقائي كامل لهذا الملفّ تحديداً)، لكن
    // إعلان صريح بدل صمت — القاعدة 22.
    console.warn(`⚠️ [فجوة مُعلَنة] "${file}" مولَّدة (${info.generator}) بلا حارس تلقائي (إعادة توليد+مقارنة) — أُعيد توليدها يدوياً مرّة (القرار ٩٢-١)، لا آلية تلقائية تكتشف انجرافها لاحقاً. راجع تقرير المهمّة.`);
  }
}

// (٤) لكل عنصر DOCUMENTED_INPUT: حقلا source/consumers غير فارغين — لا
// إدخال بلا سبب (القاعدة 13/22).
for (const [file, info] of Object.entries(DOCUMENTED_INPUTS)) {
  ok(typeof info.source === 'string' && info.source.length > 0, `[القرار ٩٢-٢] "${file}": source موثَّق (غير فارغ)`);
  ok(Array.isArray(info.consumers) && info.consumers.length > 0, `[القرار ٩٢-٢] "${file}": consumers مُعدَّدون صراحة (حتى لو كانت القيمة "لا قارئ حالي")`);
}

eq(Object.keys(GENERATED_AND_GUARDED).length + Object.keys(DOCUMENTED_INPUTS).length + DOCUMENTATION_FILES.size,
    accountedFor.size, '[إعداد] لا تكرار اسم ملفّ واحد بين القوائم الثلاث (المجموع الحسابي = حجم المجموعة الموحَّدة)');

const guardedCount = Object.values(GENERATED_AND_GUARDED).filter((i) => i.guard).length;
const gapCount = Object.values(GENERATED_AND_GUARDED).filter((i) => !i.guard).length;
console.log(`تحقّق [القرار ٩٢-٢]: ${actualFiles.length} ملفّاً في golden/ — ${Object.keys(GENERATED_AND_GUARDED).length} مولَّداً (${guardedCount} منها بحارس فعلي، ${gapCount} بفجوة مُعلَنة) + ${Object.keys(DOCUMENTED_INPUTS).length} مُدخلاً موثَّقاً + ${DOCUMENTATION_FILES.size} توثيقاً — كلّها محسوبة`);

console.log(`\ngoldenFixturesGuardCoverage.test.js: ${n}/${n} assertions passed`);

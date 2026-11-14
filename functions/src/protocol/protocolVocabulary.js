"use strict";

// ===================================================
// protocolVocabulary — مصدر واحد لمفردات بروتوكول جمع البيانات (P6-23، 2026-10-15 +03)
// ===================================================
//
// القاعدة 24 (بنصّها): «القيمة الحرفية التي يقوم عليها تمييز — وسم، مفتاح، اسم حقل — لها حكم رقم القياس: مصدر واحد مُصدَّر، لا نسخة في كل ملفّ.»
// بند الخطة (PLAN-06 §٠-ب، منقول عن مستخلص المنسّق، غير متحقَّق من هذا المستودع: plan/PLAN-06-DATA-COLLECTION.md:201-203): «وحدة خادمية واحدة
// protocolVocabulary.js («اسم مقترح») تُصدِّر الأغراض والحالات وطرق الربط وPROTOCOL_VERSION»، والتطبيق والموقع يحملان مرآة تُختبر بعيّنة ذهبية.
//
// ما هذا الملفّ: ثوابت مُصدَّرة وحدها. لا require ولا قراءة ولا كتابة ولا دالّة (أمر P6-23: «لا قارئ ولا كاتب»). كلّ تصدير إمّا عدد/نصّ مفرد
// وإمّا كائن مجمَّد قيمه نصوص.
// مَن يحكمه: docs/PROTOCOL_CONTRACT.md §٨ (جدولا المفردات). protocolVocabulary.test.js يثبّت أن كل اسم في الجدولين يساوي ما تُصدّره هذه الوحدة والعكس،
// وأن ما أُسقط (القائمة في §٨-ج) لا يُصدَّر. تغيير هنا بلا تغيير في الوثيقة يُفشل الاختبار؛ والعكس.
// يستورده اليوم (S-P6-03، 2026-10-18): scanProtocolDocument.js وsessionNames.js وreportRawStore.js وcreateScanSession.js وsetSessionPurpose.js وanalyzeDevice.js (وdeviceIdentityHmac.js من S-P6-01، غير موصول بدالّة بعد)؛
// فدوالّ createScanSession وanalyzeDevice وsetSessionPurpose تصل إليه، وقائمة النشر (scripts/deploy-list.js) تحسبها بالأداة. (كان هنا: «لا يستورده شيء بعد» — صار غير صحيح بهذا الالتزام.)
// (2026-10-22، ربط «قبل/بعد صيانة»): مفردات الصيانة (DEFECT_TYPE وmaintenance_* ورفوض الزوج) تستوردها وحدة protocol/maintenancePair.js ودالّتا القائمة والتأكيد، وهذا الالتزام (S1) يضيف المفردات وحدها بلا مستورد بعد.
//
// ─── الوسوم في التعليقات ────────────────────────────────────────────────────────────────────────────────────────
// design   اسم أو قيمة من التصميم (PLAN-06 كما اعتُمد؛ «معتمد كما هو»، الأسماء اجتهاد وكيل التصميم). السطر P:<n> = ذلك الملفّ في مساحة العمل — منقول، غير متحقَّق هنا.
// proposal مقترح الوكيل، للاعتماد (موضع بلا اسم في التصميم). **لا يُستعمل في كود قبل اعتماد المستخدم.** A<n> = القسم §٢ من الوثيقة الذي يحمل الاقتراح (بعد أمر S-SWEEP، 2026-10-15، لا قيمة في الوحدة بهذا الوسم:
//          رُفع EXCLUSION_STATE (E45) وDISAGREEMENT_DIRECTION (E46) إلى decided؛ وقائمة المفتوح في §٧-ب من الوثيقة).
//          **استثناء بأمر المستخدم 2026-10-22 (ربط «قبل الصيانة» بـ«بعد الصيانة»)، بنصّه كما نُقل في الأمر:** «كل ما تبنيه يعمل خلف الحوارس الحالية أو حارس جديد مُطفأ». فالقيم الموسومة proposal في المجموعات
//          SCAN_PURPOSE وSETTABLE_SESSION_PURPOSE وPURPOSE_REFUSAL وPAIR_LINK_REFUSAL وPAIR_CALL_REFUSAL (A2 وA3: الأغراض maintenance_* ورفوضها وأسماء الدالّتين) **تُستعمل في كود البناء خلف جزأَي المحلّ القائمين**
//          purposes وbatteryBeforeAfter (كلاهما مُطفأ ما لم يُكتب) **قبل اعتماد المستخدم لها**؛ واعتمادها بيد حسن في ورقة قراراته (ق33: أسماء الدالّتين والأغراض والرفوض). ويبقى وسمها proposal حتى يعتمدها، والاختبار يحرس أن
//          الوسم والمصدر في الجدول والكود متساويان. أنواع العطل الخمسة وكونها قائمة مغلقة (DEFECT_TYPE) قرار المستخدم 2026-10-22 (decided E47).
//          **(2026-10-22، ق31، أقرّه حسن)** PURPOSE_REFUSAL.PART_NOT_ENABLED (PURPOSE_PART_NOT_ENABLED): **السلوك مقرّ من حسن بتاريخ 2026-10-22** (رفض setSessionPurpose لمحلّ بلا الجزء اللازم للغرض)؛ **واسم الرمز اقتراح** فيبقى وسمه proposal A2 تحت الاستثناء نفسه.
//          **(2026-10-22، ق36 أ، أقرّه حسن)** LINK_MODEL_CHECK (LINK_MODEL_MATCH · LINK_MODEL_MISMATCH · LINK_MODEL_ABSENT): **السلوك مقرّ من حسن بتاريخ 2026-10-22** (ملاحظة خادمية على «بعد» حين يختلف طراز تقريرَي الزوج، بلا رفض ولا نصّ ولا حقل على السلك)؛
//          **والأسماء الثلاثة اقتراح الوكيل** (LINK_MODEL_MISMATCH من نصّ أمر المنسّق) فيبقى وسمها proposal A3 تحت الاستثناء نفسه.
// decided  معتمد: حسمه المستخدم بنصّه، أو المنسّق بتوصية الوكيل بإذن المستخدم (2026-10-15): يُستعمل في كود. E<n> = صفّه المحسوم في §٧-أ من الوثيقة (نصّ القرار أو الإذن هناك).
//          ووسوم التعليقات هذه (الوسم ومصدره) تساوي عمودَي الوسم والمصدر في جدولَي §٨ من الوثيقة، والاختبار يحرس التساوي (القسم ٣-ب فيه).
//
// ─── ما لا تُصدّره الوحدة (وكل بند مسجَّل في الوثيقة) ───────────────────────────────────────────────────────────────
//  • مفردات جلسة الفحص (الحالات وأسباب الإلغاء ورموز الرفض): مصدرها sessions/sessionNames.js ولا نسخة هنا (القاعدة 24).
//  • أسماء الحقول (scanPurpose وlinkedScanId …): لا تُصدَّر (E36، معتمد 2026-10-15)؛ المصدَّر هنا القيم والمجموعات والإصدارات، وتُضاف الحقول حين يكتبها أول كاتب مع جدولها في §٨.
//  • القيم الافتراضية للإعدادات (0.25، 168، …): «اقتراح للعرض لا للكود» (P:773).
//  • ما يخصّ حمولة fv71 (M-02، أزرار الصوت، P6-13): قسم في docs/FV68_CONTRACT.md بالتطبيق، وتُنسخ إلى هنا قبل قرّائها.
//  • ما أُسقط (قرار 2026-10-10): returnRecords وreturn وreturn_not_working.
//  • batteryPairs: الاسم الذي سمّاه التصميم لمفتاح الجزء في protocolParts (P:787) هو نفسه اسم حقل حمولة fv68 القائم (analysis/fv68Names.js FOOTER.BATTERY_PAIRS)،
//    وتحرس fv68Names.test.js ألّا يظهر نصّاً حرفياً خارجه (القاعدة 24). حُسم التصادم (E42، 2026-10-15): المفتاح يُصدَّر باسم batteryBeforeAfter في PROTOCOL_PART،
//    والاسم القديم لا يُصدَّر (يمنعه الاختبار، وهو مذكور في §٨-ج).
//  • مفردات موجودة في الكود: KEY_ABSENT (profiles/deviceProfileKey.js UNUSABLE_REASON) وأخواتها تُكرَّر قيمةً هنا حيث يلزم التمييز، والاختبار يثبّت التطابق.

// ─── الإصدارات والثوابت المفردة ─────────────────────────────────────────────────────────────────────────────────
// الاسم «ثابت مُصدَّر» في التصميم (P:487-492)؛ قيمته غير مسمّاة فيه، واعتُمدت 1 (E39، 2026-10-15). صحيح موجب لأن المقارنة داخل «الإصدار الرئيسي نفسه» (القاعدة 1 في CLAUDE.md) تحتاج ترتيباً.
const PROTOCOL_VERSION = 1; // decided E39

// formContractVersion: 2 في technicianForms.
const FORM_CONTRACT_VERSION = 2; // design P:1236

// الاستمارة القديمة تُقبل موسومة contractVersion: 1 (لا تُرفض صامتةً ولا تُخلط بالجديد).
const FORM_LEGACY_CONTRACT_VERSION = 1; // design P:1237

// الاسم consentTextVersion من التصميم (P:1389)؛ القيمة معتمدة (E11، 2026-10-15). والموافقة مرّة لكل تثبيت بتخزين محلّي مفتاحه textVersion: رفع القيمة يسأل ثانيةً.
// (2026-10-23، تفويض حسن 2026-10-22 عبر المنسّق) رُفعت من 1 إلى 2: نصّ شاشة الموافقة تغيّر في التطبيق (م٢ وم٣ مُعدَّلان وم٤ تُحذف) فترتفع نسخته إلى 2 (ScanConsent.kt:50، منقول، قرأتُ القيمة الحالية 1 منه).
// النسخة 1 تبقى مقبولة (consent.js: «الأقدم مقبول») والسجلّات المخزَّنة بنسخة 1 تُقرأ كما هي؛ وكل ما فوق 2 يُرفض ABOVE_CURRENT_VERSION. لا مفتاح جديد ولا حقل. المصدر الوحيد (القاعدة 24): consent.js وrecordScanConsent.js يقرآنها من هنا.
const CONSENT_TEXT_VERSION = 2; // decided E11

// الحقل identityRuleVersion من التصميم (P:382-383)؛ القيمة معتمدة (E3، 2026-10-15).
const IDENTITY_RULE_VERSION = 1; // decided E3

// الحقل hotStart.ruleVersion من التصميم (P:1440-1442)؛ القيمة معتمدة (E12، 2026-10-15).
const HOT_START_RULE_VERSION = 1; // decided E12

// خارج مفاتيح الأعراض الاثني عشر (P:1278) ويميّزها؛ يحيل إليه SYMPTOM.NONE_NOTICED (مصدر واحد لا حرفيتان). القيمة نفسها قائمة في VALID_VISIBLE_DEFECTS
// (evaluationContract.js:51) بمعنى آخر (العيوب الظاهرة)؛ والاختبار يثبّت التطابق.
const SYMPTOM_NONE_NOTICED = "none_noticed"; // design P:1278

// ─── المجموعات ─────────────────────────────────────────────────────────────────────────────────────────────────

/** أسماء المجموعات الخادمية الجديدة. returnRecords أُسقطت (قرار 2026-10-10، P:686) فلا تُصدَّر. */
const PROTOCOL_COLLECTION = Object.freeze({
  SCAN_PROTOCOL: "scanProtocol", // design P:184
  PROTOCOL_PENDING: "protocolPending", // design P:185
  TECHNICIAN_FORMS: "technicianForms", // design P:186
  REPORT_DISAGREEMENTS: "reportDisagreements", // design P:188
  PROTOCOL_CORRECTIONS: "protocolCorrections", // design P:189
  PROTOCOL_SETTINGS: "protocolSettings", // design P:190
  TECHNICIANS: "technicians", // design P:191
  DAILY_SUMMARIES: "dailySummaries", // design P:192
  RECOMMENDATIONS: "recommendations", // design P:193
  DATA_SNAPSHOTS: "dataSnapshots", // design P:194
  MARKETING_NAMES: "marketingNames", // decided E14
});

/** معرّفات داخل protocolSettings: المستند الحالي والمجموعة الفرعية للنسخ السابقة. */
const PROTOCOL_SETTINGS_PATH = Object.freeze({
  CURRENT_DOC: "current", // design P:190
  HISTORY_SUBCOLLECTION: "history", // design P:190
});

/**
 * قيم scanProtocol.scanPurpose. return و return_not_working أُسقطتا (P:686) فلا تُصدَّران.
 * battery_before وbattery_after **قيمتا قراءة تاريخيتان** (أمر المستخدم 2026-10-22): تبقيان هنا ولا تُحذفان (القاعدتان 22 و42)، وليستا في SETTABLE_SESSION_PURPOSE فلا تُختاران بعد اليوم؛
 * والغرض المختار للصيانة maintenance_before وmaintenance_after (اقتراح A2: اسما القيمتين من أمر المستخدم 2026-10-22 ينتظران اعتماده؛ ق33).
 */
const SCAN_PURPOSE = Object.freeze({
  NORMAL: "normal", // design P:468-471
  BATTERY_BEFORE: "battery_before", // design P:468-471
  BATTERY_AFTER: "battery_after", // design P:468-471
  MAINTENANCE_BEFORE: "maintenance_before", // proposal A2
  MAINTENANCE_AFTER: "maintenance_after", // proposal A2
  REPEAT_COLD: "repeat_cold", // design P:468-471
  REPEAT_HOT: "repeat_hot", // design P:468-471
  REPEAT_UNCLASSIFIED: "repeat_unclassified", // design P:669
  NO_SESSION: "NO_SESSION", // design P:468-471
  UNDECLARED: "UNDECLARED", // design P:502-504
});

/**
 * ما يقبله setSessionPurpose ما دامت الجلسة pending (P:468، P:483-484). مجموعة جزئية من SCAN_PURPOSE.
 * (2026-10-22، أمر المستخدم): maintenance_before وmaintenance_after **تحلّان محلّ** battery_before وbattery_after في ما يُختار؛ والأخيرتان باقيتان في SCAN_PURPOSE قيمتَي قراءة تاريخيتين غير قابلتين للاختيار.
 */
const SETTABLE_SESSION_PURPOSE = Object.freeze({
  NORMAL: "normal", // design P:468-471
  MAINTENANCE_BEFORE: "maintenance_before", // proposal A2
  MAINTENANCE_AFTER: "maintenance_after", // proposal A2
});

/**
 * أنواع العطل في فحص الصيانة: **خمسة وقائمة مغلقة** (قرار المستخدم 2026-10-22، E47): لا «أخرى» ولا نصّ حرّ؛ الشاشة ليست نوعاً؛ SOFTWARE هي المجموعة الضابطة.
 * يرفض الخادم أيّ قيمة خارجها (DEFECT_TYPE_INVALID) — بحالة الأحرف نفسها: «battery» بأحرف صغيرة قيمة خارج القائمة.
 */
const DEFECT_TYPE = Object.freeze({
  BATTERY: "BATTERY", // decided E47
  CHARGING_PORT: "CHARGING_PORT", // decided E47
  THERMAL: "THERMAL", // decided E47
  MOTHERBOARD: "MOTHERBOARD", // decided E47
  SOFTWARE: "SOFTWARE", // decided E47
});

/** قيم scanProtocol.purposeSource. */
const PURPOSE_SOURCE = Object.freeze({
  DEFAULT: "default", // design P:473-477
  SELECTED: "selected", // design P:473-477
  REPEAT_FLOW: "repeat_flow", // design P:473-477
  FEATURE_DISABLED: "feature_disabled", // design P:473-477
});

/** قيم scanProtocol.linkState. */
const LINK_STATE = Object.freeze({
  NONE: "none", // design P:487-492
  ACTIVE: "active", // design P:487-492
  MISSING: "missing", // design P:487-492
  UNLINKED_BY_ADMIN: "unlinked_by_admin", // design P:487-492
  RELINKED_BY_ADMIN: "relinked_by_admin", // design P:487-492
});

/** قيم linkMethod؛ والغائب null صريح حين linkState = none (ليس قيمة هنا). */
const LINK_METHOD = Object.freeze({
  AUTO_CONFIRMED: "auto_confirmed", // design P:487-492
  MANUAL: "manual", // design P:487-492
});

/**
 * قيم pair.state على «قبل». SUPERSEDED موسوم اجتهاداً في التصميم (P:567).
 * (2026-10-22): المخزَّن OPEN وCOMPLETED وحدهما؛ EXPIRED يُحسب عند القراءة ولا يُخزَّن؛ **SUPERSEDED تبقى هنا غير مستعملة حتى مفتاح HMAC** (تحتاج هويّة الجهاز).
 */
const PAIR_STATE = Object.freeze({
  OPEN: "OPEN", // design P:538-539
  COMPLETED: "COMPLETED", // design P:558-560
  EXPIRED: "EXPIRED", // design P:563-564
  SUPERSEDED: "SUPERSEDED", // design P:567
});

/**
 * رفوض ربط «بعد» بـ«قبل». SESSION_CODE_NOT_REPORT_CODE يُكتشف في التطبيق (P:575-577).
 * (2026-10-22): BEFORE_WRONG_DEFECT_TYPE جديد (نوع «قبل» ≠ نوع «بعد»: اقتراح A3). **AMBIGUOUS_SHORT_ID وSESSION_CODE_NOT_REPORT_CODE غير مستعملتين في هذه المرحلة** (الطريق اليدوي بمسح رمز التقرير
 * مرحلة ثانية، WIRE-SPEC §٤)؛ تبقيان في المفردات بوسمهما ولا يُكتب كود لهما.
 */
const PAIR_LINK_REFUSAL = Object.freeze({
  BEFORE_NOT_FOUND: "BEFORE_NOT_FOUND", // design P:575-577
  BEFORE_NOT_OWNED: "BEFORE_NOT_OWNED", // design P:575-577
  BEFORE_WRONG_PURPOSE: "BEFORE_WRONG_PURPOSE", // design P:575-577
  BEFORE_WRONG_DEFECT_TYPE: "BEFORE_WRONG_DEFECT_TYPE", // proposal A3
  BEFORE_ALREADY_PAIRED: "BEFORE_ALREADY_PAIRED", // design P:575-577
  BEFORE_EXPIRED: "BEFORE_EXPIRED", // design P:575-577
  AMBIGUOUS_SHORT_ID: "AMBIGUOUS_SHORT_ID", // design P:555
  SESSION_CODE_NOT_REPORT_CODE: "SESSION_CODE_NOT_REPORT_CODE", // design P:575-577
});

/**
 * رفوض دالّتَي القائمة والتأكيد (listOpenMaintenanceBefores وconfirmMaintenanceAfterLink) **غير الربطية** (2026-10-22، اقتراح A3: لا رمز معتمداً لها؛ الأسماء الثلاثة من WIRE-SPEC §٣-أ، والباقية اقتراح الوكيل لحالات
 * لا بدّ لها من رمز مسمّى: القاعدتان 21 و22). رفوض الجلسة العامّة (جلسة غير موجودة/لا مشاركة، منتهية، حالة مجهولة) تُعيد رموز sessionNames.js (SESSION_NOT_PARTICIPANT · SESSION_EXPIRED · SESSION_EXPIRES_AT_INVALID · SESSION_STATUS_UNKNOWN: مصدر واحد).
 */
const PAIR_CALL_REFUSAL = Object.freeze({
  NOT_AUTHENTICATED: "PAIR_NOT_AUTHENTICATED", // proposal A3
  SESSION_ID_REQUIRED: "PAIR_SESSION_ID_REQUIRED", // proposal A3
  SESSION_NOT_AFTER: "PAIR_SESSION_NOT_AFTER", // proposal A3
  SESSION_NOT_ACTIVE: "PAIR_SESSION_NOT_ACTIVE", // proposal A3
  SESSION_DEFECT_TYPE_ABSENT: "PAIR_SESSION_DEFECT_TYPE_ABSENT", // proposal A3
  PART_NOT_ENABLED: "PAIR_PART_NOT_ENABLED", // proposal A3
  VALIDITY_SETTING_ABSENT: "PAIR_VALIDITY_SETTING_ABSENT", // proposal A3
  BEFORE_SCAN_ID_REQUIRED: "PAIR_BEFORE_SCAN_ID_REQUIRED", // proposal A3
  BEFORE_UNREADABLE: "PAIR_BEFORE_UNREADABLE", // proposal A3
  SCAN_CAP_EXCEEDED: "PAIR_SCAN_CAP_EXCEEDED", // proposal A3 (S8: السقف لكل محلّ لا للمشروع كلّه)
  OWNER_MISMATCH: "PAIR_OWNER_MISMATCH", // proposal A3 (S8): pair.ownerId على «قبل» ≠ userId في تقريرها: شذوذ مسمّى يُعلَن ولا يُقرأ تطابقاً
});

/**
 * حالات ملاحظة الطراز `linkModelCheck` على سجلّ «بعد» التي حُلّ هدف ربطها (ق36 أ، 2026-10-22، أقرّه حسن؛ docs/PROTOCOL_CONTRACT.md §٢ A3 البند ٤ وA11): **خادمية لا تصل السلك**.
 * MATCH طرازا تقريرَي الزوج متطابقان (حرفياً)؛ MISMATCH مختلفان؛ MODEL_ABSENT الطراز غائب عن أحدهما أو عنهما (فلا «متطابق» ولا «مختلف» ولا قيمة افتراضية: القاعدة 22).
 * غياب المقارنة نفسها (لا هدف محلول) = `null` في الحقل لا حالة هنا.
 */
const LINK_MODEL_CHECK = Object.freeze({
  MATCH: "LINK_MODEL_MATCH", // proposal A3 (ق36 أ)
  MISMATCH: "LINK_MODEL_MISMATCH", // proposal A3 (ق36 أ؛ نصّ أمر المنسّق)
  MODEL_ABSENT: "LINK_MODEL_ABSENT", // proposal A3 (ق36 أ)
});

/** تحذيران لا يمنعان الربط. */
const PAIR_WARNING = Object.freeze({
  DIFFERENT_DEVICE: "DIFFERENT_DEVICE", // design P:580-581
  DIFFERENT_MODEL: "DIFFERENT_MODEL", // design P:580-581
});

/** قيمة pairSuggestion حين لا اقتراح قويّ. */
const PAIR_SUGGESTION = Object.freeze({
  NO_STRONG_SUGGESTION: "NO_STRONG_SUGGESTION", // design P:583
});

/** قيم scanProtocol.identityState. لا قائمة مغلقة في التصميم؛ القائمة المغلقة معتمدة (E3، 2026-10-15): الأسماء من جدول الغياب (P:417-428) ودرجات الاقتراح (P:392-397)؛ KEY_ABSENT قائم في deviceProfileKey.js UNUSABLE_REASON (المصدر هناك، والاختبار يثبّت التطابق). */
const IDENTITY_STATE = Object.freeze({
  SUGGESTED_STRONG: "SUGGESTED_STRONG", // design P:392-397
  SUGGESTED_WEAK: "SUGGESTED_WEAK", // design P:392-397
  NO_SUGGESTION: "NO_SUGGESTION", // design P:392-397
  CONFLICT: "CONFLICT", // design P:392-397
  KEY_ABSENT: "KEY_ABSENT", // design P:417-428
  KEY_GENERATION_FAILED: "KEY_GENERATION_FAILED", // design P:417-428
  IDENTIFIER_UNAVAILABLE: "IDENTIFIER_UNAVAILABLE", // design P:417-428
  IDENTIFIER_FAILED: "IDENTIFIER_FAILED", // decided E3 — مستنتَج («IDENTIFIER_UNAVAILABLE / FAILED»)، يُتحقَّق منه في أمر P6-01
  WIDEVINE_UNAVAILABLE: "WIDEVINE_UNAVAILABLE", // design P:417-428
  NOT_COLLECTED_KVKK_PENDING: "NOT_COLLECTED_KVKK_PENDING", // design P:417-428
  LOOKUP_FAILED: "LOOKUP_FAILED", // design P:417-428
  HMAC_KEY_UNAVAILABLE: "HMAC_KEY_UNAVAILABLE", // design P:417-428
  MATCHED: "MATCHED", // decided E3
  NEW_DEVICE: "NEW_DEVICE", // decided E3
});

/** قيم scanProtocol.matchedBy (E3): الطريقتان الآليتان (Widevine مُطفأ، P:348) والحلّ اليدوي (resolveIdentityConflict، P:858). */
const MATCHED_BY = Object.freeze({
  ANDROID_ID: "android_id", // decided E3
  HARDWARE_FINGERPRINT: "hardware_fingerprint", // decided E3
  ADMIN_RESOLVED: "admin_resolved", // decided E3
  NONE: "none", // decided E3
});

/** وسم «قبل HMAC» على reportRaw (E4): PRE_HMAC للتقارير القائمة، وHMAC لما بعد. */
const IDENTITY_SCHEME = Object.freeze({
  PRE_HMAC: "pre_hmac", // decided E4
  HMAC: "hmac", // decided E4
});

/** حالات غياب صريحة عامّة (القاعدة 22). */
const PROTOCOL_ABSENCE_STATE = Object.freeze({
  SETTINGS_ABSENT: "SETTINGS_ABSENT", // design P:893
});

/** حالة إعفاء الحجز لفحوص البروتوكول (P:657، «اجتهاد في الآلية»). يُكتب الإعفاء في scanProtocol. */
const CREDIT_EXEMPTION = Object.freeze({
  PROTOCOL_EXEMPT: "PROTOCOL_EXEMPT", // design P:657
});

/** قيم repeat.state. NOT_ELIGIBLE تُكتب في التصميم NOT_ELIGIBLE:{reason}؛ فُصل السبب (E8، معتمد 2026-10-15). */
const REPEAT_STATE = Object.freeze({
  NOT_ELIGIBLE: "NOT_ELIGIBLE", // design P:661-666
  NOT_SELECTED: "NOT_SELECTED", // design P:661-666
  SELECTED: "SELECTED", // design P:661-666
  PROMPT_DELIVERED: "PROMPT_DELIVERED", // design P:661-666
  DECLINED: "DECLINED", // design P:661-666
  WAITING_COOLING: "WAITING_COOLING", // design P:661-666
  STARTED: "STARTED", // design P:661-666
  COMPLETED_COLD: "COMPLETED_COLD", // design P:661-666
  COMPLETED_HOT: "COMPLETED_HOT", // design P:661-666
  EXPIRED: "EXPIRED", // design P:661-666
  // أمر S-P6-07 (2026-10-21): «حرارة البدء الأولى غائبة ⇐ COOLING_REFERENCE_ABSENT. فالفحص الثاني repeat_unclassified، لا بارد» (P:669) — والحالات العشر لا تحمل اكتمالاً لفحص ثانٍ غير مصنَّف:
  // COMPLETED_COLD تعني «بارد» وCOMPLETED_HOT تعني «ساخن» فلا تصلحان له (القاعدة 22: لا حالة تقول ما لم يُقَل). اقتراح، ينتظر اعتماد المستخدم (§٢ A4 «ما بُني في أمر S-P6-07»).
  COMPLETED_UNCLASSIFIED: "COMPLETED_UNCLASSIFIED", // proposal A4
});

/**
 * أسباب NOT_ELIGIBLE (E8، معتمد 2026-10-15). **ناقصة بالضرورة** (ملحوظة المنسّق): شروط الأهلية «اجتهاد» في P:619 ولم تصلني؛ **تُستكمل في أمر P6-07 بوسمها.**
 * أمر S-P6-07 (2026-10-21) استكملها من نصّ P:619 (شروط الاختيار: «الغرض normal، والمحلّ مفعَّل له التكرار، والهاتف بلا تكرار سابق مكتمل [اجتهاد]») ومن E44 (الأمّ بلا joinedBy)
 * ومن غياب نسبة الإعدادات (P:893 «إعدادات غائبة ⇐ SETTINGS_ABSENT» يخصّ غياب المستند كلّه؛ وغياب الحقل وحده أو فساده حالتان مسمّاتان). الشرط الثالث («بلا تكرار سابق مكتمل») لا قيمة له هنا: لا يُقيَّم قبل هويّة الجهاز
 * (S-P6-01، مفتاح HMAC)، وحالته المعلنة في السجلّ `priorRepeatCheck` لا سبب رفض (§٢ A4 «ما عُلِّق»).
 * التقسيم: SETTINGS_ABSENT وPART_NOT_ENABLED معتمدتان؛ الأربع الباقية اقتراح A4 ينتظر اعتماد المستخدم، ومنها اسم E44 الجديد (PARENT_JOINER_UNKNOWN) الذي أمر E44 بأن يقترحه أمر P6-07 «بوسمه».
 * وتستعملها كذلك قرعة التقييم المزدوج (S-P6-10) لأسبابها المشتركة (إعدادات/جزء/نسبة): مصدر واحد للقيمة، لا نسخة (القاعدة 24).
 */
const REPEAT_NOT_ELIGIBLE_REASON = Object.freeze({
  SETTINGS_ABSENT: "SETTINGS_ABSENT", // design P:893
  PART_NOT_ENABLED: "PART_NOT_ENABLED", // decided E8
  PURPOSE_NOT_NORMAL: "PURPOSE_NOT_NORMAL", // proposal A4
  PARENT_JOINER_UNKNOWN: "PARENT_JOINER_UNKNOWN", // proposal A4
  RATE_ABSENT: "RATE_ABSENT", // proposal A4
  RATE_INVALID: "RATE_INVALID", // proposal A4
});

/**
 * رموز رفض الدوالّ التي تنشئ جلسة التكرار الابنة (E41، معتمد بتعديل 2026-10-15، §٦-و): **المعتمَد اسماً واحد** — «منضمّ الجلسة الأمّ غير معروف»، يُكتب في أمر P6-07 «بمجموعة REPEAT_REFUSAL مع سائر رفوض النداء».
 * سائر رفوض النداء أسماء اقتراحية تُعلَن في functions/src/protocol/repeatScan.js وحدها (وسم proposal «لا يُستعمل في كود قبل اعتماده»: لا تُصدَّر من هذه الوحدة، كما فعل أمر S-P6-08 بأسماء الاستمارة).
 */
const REPEAT_REFUSAL = Object.freeze({
  PARENT_JOINER_UNKNOWN: "REPEAT_PARENT_JOINER_UNKNOWN", // decided E41
});

/** غياب حرارة البدء الأولى (P:669). */
const REPEAT_ABSENCE_STATE = Object.freeze({
  COOLING_REFERENCE_ABSENT: "COOLING_REFERENCE_ABSENT", // design P:669
});

/** الفئات الأربع في عقد الاستمارة v2 (P:1244). تختلف عن RATING_CATEGORIES القائمة (evaluationContract.js:39) المستعملة بعقد v1. */
const TECHNICIAN_GRADE_CATEGORY = Object.freeze({
  BATTERY: "battery", // design P:1244
  PERFORMANCE: "performance", // design P:1244
  THERMAL: "thermal", // design P:1244
  OVERALL: "overall", // design P:1244
});

/** المستويات الأربعة (P:1245؛ TL:11). مطابقة لقيم VALID_RATINGS القائمة عدا not_tested. */
const GRADE_LEVEL = Object.freeze({
  EXCELLENT: "excellent", // design P:1245
  GOOD: "good", // design P:1245
  FAIR: "fair", // design P:1245
  WEAK: "weak", // design P:1245
});

/** خيارات الجواب الخمسة: المستويات الأربعة ومعها not_tested «خيار خامس، لا مستوى» (TL:11). مساوية لـVALID_RATINGS القائمة (evaluationContract.js:44). */
const GRADE_OPTION = Object.freeze({
  EXCELLENT: "excellent", // design P:1245
  GOOD: "good", // design P:1245
  FAIR: "fair", // design P:1245
  WEAK: "weak", // design P:1245
  NOT_TESTED: "not_tested", // design TL:11
});

/** القائمة الوظيفية الستّ (P:1250). */
const FUNCTIONAL_CHECK = Object.freeze({
  SCREEN_TOUCH: "screen_touch", // design P:1250
  CAMERA: "camera", // design P:1250
  AUDIO: "audio", // design P:1250
  BUTTONS: "buttons", // design P:1250
  CHARGING: "charging", // design P:1250
  NETWORK: "network", // design P:1250
});

/** جواب كل بند وظيفي؛ غير المُجاب null صريح (P:1252) وليس قيمة هنا. */
const FUNCTIONAL_ANSWER = Object.freeze({
  WORKS: "works", // design P:1251
  FAULTY: "faulty", // design P:1251
  NOT_TESTED: "not_tested", // design P:1251
});

/** العيوب الظاهرة الثلاثة صفوفاً (✓ س١٨، P:1254). المفاتيح غير مسمّاة في التصميم (E10): المعتمَد (2026-10-15) إعادة استعمال أسماء القائمة في evaluationContract.js:49-52 لا اختراع أسماء ثانية. */
const VISIBLE_DEFECT = Object.freeze({
  REPLACED_SCREEN: "replaced_screen", // decided E10
  WATER_DAMAGE: "water_damage", // decided E10
  PRIOR_REPAIR: "prior_repair", // decided E10
});

/**
 * مفاتيح الأعراض (E37): ثلاثة عشر مفتاحاً — الاثنا عشر المعتمدة بالعربية (P:1262، P:1266-1277؛ المصدر يسمّي المفاتيح «مقترحة [اجتهاد]» وتُكتب كما هي: E2)
 * ومعها none_noticed خارجها (P:1278) تحيل إلى SYMPTOM_NONE_NOTICED. العمود الثاني في جدول docs/PROTOCOL_CONTRACT.md §٥-ج يساويها قيمةً وترتيباً (الاختبار).
 * الترتيب هو ترتيب الجدول في المصدر، والأرقام 1 إلى 12 في الوثيقة.
 */
const SYMPTOM = Object.freeze({
  BATTERY_DIES_BEFORE_DAY_END: "battery_dies_before_day_end", // design P:1266-1277 (#1)
  BATTERY_JUMPS_OR_SHUTS_DOWN: "battery_jumps_or_shuts_down", // design P:1266-1277 (#2)
  BATTERY_SWOLLEN: "battery_swollen", // design P:1266-1277 (#3)
  HOT_WHILE_CHARGING: "hot_while_charging", // design P:1266-1277 (#4)
  CHARGING_SLOW: "charging_slow", // design P:1266-1277 (#5)
  SLOW_OR_FREEZES_DAILY: "slow_or_freezes_daily", // design P:1266-1277 (#6)
  RESTARTS_UNDER_LOAD: "restarts_under_load", // design P:1266-1277 (#7)
  HEATS_FAST_IN_USE: "heats_fast_in_use", // design P:1266-1277 (#8)
  SYSTEM_HEAT_WARNING: "system_heat_warning", // design P:1266-1277 (#9)
  GAME_STUTTER_AFTER_MINUTES: "game_stutter_after_minutes", // design P:1266-1277 (#10)
  GAME_SCREEN_LINES_OR_FLICKER: "game_screen_lines_or_flicker", // design P:1266-1277 (#11)
  GAMES_FREEZE_OR_CLOSE: "games_freeze_or_close", // design P:1266-1277 (#12)
  NONE_NOTICED: SYMPTOM_NONE_NOTICED, // design P:1278 — خارج الاثنتي عشرة
});

/** قيم batteryHealth.kind (✓ قرار المستخدم ٤، P:1290). */
const BATTERY_HEALTH_KIND = Object.freeze({
  PERCENT: "percent", // design P:1290
  STATE: "state", // design P:1290
  NOT_SHOWN: "not_shown", // design P:1290
});

/** قيم stateKey (P:1291). */
const BATTERY_HEALTH_STATE = Object.freeze({
  NORMAL: "normal", // design P:1291
  WEAK: "weak", // design P:1291
  BAD: "bad", // design P:1291
});

/** حالة الحقل غير المملوء (P:1293). */
const FORM_ANSWER_STATE = Object.freeze({
  NOT_ANSWERED: "not_answered", // design P:1293
});

/** قيم blindness (P:1318). */
const BLINDNESS = Object.freeze({
  BLIND: "blind", // design P:1318
  NOT_BLIND: "not_blind", // design P:1318
  UNVERIFIABLE: "unverifiable", // design P:1318
});

/** أساس الحكم بالعمى. الاسم الثاني من التصميم (P:1322)، والأول معتمد (E6، 2026-10-15). */
const BLINDNESS_BASIS = Object.freeze({
  REPORT_FIRST_OPENED: "report_first_opened", // decided E6
  CREATED_AT_FALLBACK: "created_at_fallback", // design P:1322
});

/** قيم formState. الثلاث الأولى من التصميم (P:1358-1359)، والرابعة معتمدة (E10، 2026-10-15) لتمييز «أُرسلت» من الغياب (القاعدة 22). */
const FORM_STATE = Object.freeze({
  NOT_SUBMITTED: "not_submitted", // design P:1358
  ABANDONED: "abandoned", // design P:1358
  NOT_ENABLED: "not_enabled", // design P:1359
  SUBMITTED: "submitted", // decided E10
});

/** مفاتيح قواعد التناقض (E10، معتمد 2026-10-15). القاعدة الجديدة وحدها وصلتني (P:1352؛ TL:64). */
const FORM_CONTRADICTION_RULE = Object.freeze({
  OVERALL_HIGH_WITH_WEAK_CATEGORY: "overall_high_with_weak_category", // decided E10
});

/**
 * رموز رفض setSessionPurpose (E5، الرموز معتمدة 2026-10-15؛ نصّ الرفض الذي يراه المستخدم غير مكتوب ويأتي المستخدمَ للاعتماد مع أمر الكاتب: القرار ٩٠). غيرها من الرفوض العامّة (الجلسة غير موجودة، لا مشاركة) يُعاد استعمال رموز sessionNames.js.
 * (2026-10-22): ثلاثة رموز لنوع العطل (أسماؤها من أمر المستخدم، اقتراح A2): REQUIRED لغياب النوع مع maintenance_*؛ INVALID لأيّ قيمة خارج DEFECT_TYPE (بما فيها null والنصّ الفارغ والرقم والأحرف الصغيرة)؛ NOT_APPLICABLE لنوع مُرسَل مع normal.
 * (2026-10-22، ق31، أقرّه حسن): PART_NOT_ENABLED برمز واحد لرفض نداء محلّ بلا الجزء اللازم للغرض (purposes لغير normal، وbatteryBeforeAfter لـmaintenance_* أيضاً)؛ اسم الجزء الناقص في سطر سجلّ الخادم لا في الرمز ولا في جسم الردّ.
 */
const PURPOSE_REFUSAL = Object.freeze({
  SESSION_NOT_PENDING: "PURPOSE_SESSION_NOT_PENDING", // decided E5
  DEFECT_TYPE_REQUIRED: "DEFECT_TYPE_REQUIRED", // proposal A2
  DEFECT_TYPE_INVALID: "DEFECT_TYPE_INVALID", // proposal A2
  DEFECT_TYPE_NOT_APPLICABLE: "DEFECT_TYPE_NOT_APPLICABLE", // proposal A2
  PART_NOT_ENABLED: "PURPOSE_PART_NOT_ENABLED", // proposal A2 (ق31: السلوك مقرّ من حسن 2026-10-22)
});

/** رموز رفض دالّة الاستمارة، واحد لكل مُدخل (E5، معتمدة 2026-10-15؛ لا نصّ مكتوب لرفضها: القرار ٩٠). التسمية FORM_<المُدخل>_<المشكلة> على سابقة SUBMIT_EVALUATION_REFUSAL (submitEvaluationRefusal.js). */
const FORM_REFUSAL = Object.freeze({
  CONTRACT_VERSION_INVALID: "FORM_CONTRACT_VERSION_INVALID", // decided E5
  SLOT_INVALID: "FORM_SLOT_INVALID", // decided E5
  SLOT_SAME_TECHNICIAN: "FORM_SLOT_SAME_TECHNICIAN", // decided E5
  TECHNICIAN_UNKNOWN: "FORM_TECHNICIAN_UNKNOWN", // decided E5
  GRADES_INVALID: "FORM_GRADES_INVALID", // decided E5
  FUNCTIONAL_INVALID: "FORM_FUNCTIONAL_INVALID", // decided E5
  DEFECTS_INVALID: "FORM_DEFECTS_INVALID", // decided E5
  SYMPTOMS_INVALID: "FORM_SYMPTOMS_INVALID", // decided E5
  SYMPTOM_ORDER_INVALID: "FORM_SYMPTOM_ORDER_INVALID", // decided E5
  BATTERY_HEALTH_INVALID: "FORM_BATTERY_HEALTH_INVALID", // decided E5
  KNOWN_FAULT_INVALID: "FORM_KNOWN_FAULT_INVALID", // decided E5
  GAME_TRIED_INVALID: "FORM_GAME_TRIED_INVALID", // decided E5
  NOTE_INVALID: "FORM_NOTE_INVALID", // decided E5
  TIMES_INVALID: "FORM_TIMES_INVALID", // decided E5
  EMPTY: "FORM_EMPTY", // decided E5
});

/** قيم consent.state (P:1393-1394، P:1401). تسمية الحقل متعارضة في التصميم (E11): القيم لا تتعارض. */
const CONSENT_STATE = Object.freeze({
  ACCEPTED: "accepted", // design P:1393
  DECLINED: "declined", // design P:1394
  NOT_COLLECTED: "not_collected", // design P:1401
  // (ق14، 2026-10-23، قرار حسن 2026-10-22 «ترث الجلسة الابنة موافقة الأمّ») الجلسة الابنة للتكرار لم تُسجِّل موافقة بنفسها (لا شاشة لها: الهاتف نفسه وافق عند الأمّ) وموافقة أمّها المسجَّلة مقبولة:
  // تحمل نسخة النصّ ولغته ووقت قبول الأمّ بالمفاتيح الأربعة نفسها بحالة وراثة مسمّاة صريحة، لا not_collected ولا accepted (ما سجّله هذا الفحص بنفسه). الاسم اقتراحي (التصميم لا يسمّيه).
  INHERITED: "inherited", // proposal A8 (ق14: السلوك مقرّ من حسن 2026-10-22؛ الاسم اقتراح الوكيل)
});

/**
 * قيم consent.locale — لغة النصّ الذي عُرض على الهاتف المفحوص: العربية والتركية (النصّ معتمد بهما وحدهما: evidence/plan-06/consent-text-proposal-2026-10-09.md:44-54). التصميم يسمّي الحقل `locale` (P:1393) ولا قيمه:
 * القيمتان اقتراح الوكيل (S-P6-12، §٢ A8) ينتظر اعتماد المستخدم، وكلّ لغة غيرهما يرفضها recordScanConsent.
 */
const CONSENT_LOCALE = Object.freeze({
  AR: "ar", // proposal A8
  TR: "tr", // proposal A8
});

/** قيم hotStart.state المحسوبة في الخادم (القاعدة 20). حالتا الغياب من التصميم (P:1446-1447)، والإيجابيتان معتمدتان (E12، 2026-10-15). */
const HOT_START_STATE = Object.freeze({
  START_TEMP_ABSENT: "start_temp_absent", // design P:1446
  INSUFFICIENT_DAY_SAMPLE: "insufficient_day_sample", // design P:1447
  START_WITHIN_RANGE: "start_within_range", // decided E12
  START_HOT: "start_hot", // decided E12
});

/** مفاتيح users/{uid}.protocolParts (P:787). الغائب «غير مفعَّل» (P:788). المفتاح الثاني سمّاه التصميم batteryPairs (P:787) واصطدم باسم حقل حمولة fv68 القائم (analysis/fv68Names.js FOOTER.BATTERY_PAIRS)؛ أُعيدت تسميته batteryBeforeAfter (E42، 2026-10-15) والاسم القديم لا يُصدَّر. */
const PROTOCOL_PART = Object.freeze({
  PURPOSES: "purposes", // design P:787-788
  BATTERY_BEFORE_AFTER: "batteryBeforeAfter", // decided E42
  COLD_REPEAT: "coldRepeat", // design P:787-788
  RETURNS: "returns", // design P:787-788
  DOUBLE_EVAL: "doubleEval", // design P:787-788
  CONSENT: "consent", // design P:787-788
});

/** أفعال correctProtocolRecord (P:856-859). */
const CORRECTION_ACTION = Object.freeze({
  UNLINK: "unlink", // design P:856-859
  RELINK: "relink", // design P:856-859
  EXCLUDE: "exclude", // design P:856-859
  UNEXCLUDE: "unexclude", // design P:856-859
  RESOLVE_IDENTITY_CONFLICT: "resolveIdentityConflict", // design P:856-859
});

/** أسباب الاستبعاد (P:858، P:1487). */
const EXCLUSION_REASON = Object.freeze({
  TEST: "test", // design P:856-859
  WRONG: "wrong", // design P:856-859
  GOLDEN_REFERENCE: "golden_reference", // design P:1487
});

/** قيم exclusion.state (P:862): القيم غير مسمّاة في التصميم؛ القيمتان معتمدتان (E45، أمر S-SWEEP 2026-10-15). */
const EXCLUSION_STATE = Object.freeze({
  EXCLUDED: "excluded", // decided E45
  NOT_EXCLUDED: "not_excluded", // decided E45
});

/** قيم recommendations.state (P:848، P:851) — P6-17 بعد التسليم. */
const RECOMMENDATION_STATE = Object.freeze({
  OPEN: "open", // design P:848
  ACCEPTED: "accepted", // design P:851
  IGNORED: "ignored", // design P:851
});

/** حالات خلايا getProtocolProgress (P:888-891) — P6-16 بعد التسليم. NOT_MEASURED حرفية قائمة في الكود بلا مصدر مُصدَّر (E43). */
const PROGRESS_CELL_STATE = Object.freeze({
  N_BELOW_40: "N_BELOW_40", // design P:888-891
  DEPENDENCY_NOT_BUILT: "DEPENDENCY_NOT_BUILT", // design P:888-891
  NOT_MEASURED: "NOT_MEASURED", // design P:888-891
  IDENTITY_UNRESOLVED: "IDENTITY_UNRESOLVED", // design P:888-891
});

/** قيم modelKeySource في getProtocolProgress (P:801) — P6-16 بعد التسليم. */
const MODEL_KEY_SOURCE = Object.freeze({
  MARKETING_NAME_INTERIM: "marketing_name_interim", // design P:801
});

/**
 * قيم حلّ الاسم التجاري (S-P6-20، §٢ A12): `name_unmapped` من التصميم (PLAN-06:1535: «والطراز غير الموجود يُعرض `Build.MODEL` كما هو، موسوماً `name_unmapped`»)، و`mapped` اقتراح الوكيل (التصميم لا يسمّي حالة الطراز الموجود)
 * ينتظر اعتماد المستخدم. أسباب name_unmapped قائمة مغلقة في protocol/marketingNames.js (NAME_UNMAPPED_REASON).
 */
const MARKETING_NAME_STATE = Object.freeze({
  MAPPED: "mapped", // proposal A12
  NAME_UNMAPPED: "name_unmapped", // design P:1535
});

/** قيم direction في reportDisagreements (P:1508) — P6-21 بعد التسليم. غير مسمّاة في التصميم؛ القيمتان معتمدتان (E46، أمر S-SWEEP 2026-10-15). */
const DISAGREEMENT_DIRECTION = Object.freeze({
  REPORT_TOO_HIGH: "report_too_high", // decided E46
  REPORT_TOO_LOW: "report_too_low", // decided E46
});

module.exports = {
  PROTOCOL_VERSION,
  FORM_CONTRACT_VERSION,
  FORM_LEGACY_CONTRACT_VERSION,
  CONSENT_TEXT_VERSION,
  IDENTITY_RULE_VERSION,
  HOT_START_RULE_VERSION,
  SYMPTOM_NONE_NOTICED,
  PROTOCOL_COLLECTION,
  PROTOCOL_SETTINGS_PATH,
  SCAN_PURPOSE,
  SETTABLE_SESSION_PURPOSE,
  DEFECT_TYPE,
  PURPOSE_SOURCE,
  LINK_STATE,
  LINK_METHOD,
  PAIR_STATE,
  PAIR_LINK_REFUSAL,
  PAIR_CALL_REFUSAL,
  LINK_MODEL_CHECK,
  PAIR_WARNING,
  PAIR_SUGGESTION,
  IDENTITY_STATE,
  MATCHED_BY,
  IDENTITY_SCHEME,
  PROTOCOL_ABSENCE_STATE,
  CREDIT_EXEMPTION,
  REPEAT_STATE,
  REPEAT_NOT_ELIGIBLE_REASON,
  REPEAT_REFUSAL,
  REPEAT_ABSENCE_STATE,
  TECHNICIAN_GRADE_CATEGORY,
  GRADE_LEVEL,
  GRADE_OPTION,
  FUNCTIONAL_CHECK,
  FUNCTIONAL_ANSWER,
  VISIBLE_DEFECT,
  SYMPTOM,
  BATTERY_HEALTH_KIND,
  BATTERY_HEALTH_STATE,
  FORM_ANSWER_STATE,
  BLINDNESS,
  BLINDNESS_BASIS,
  FORM_STATE,
  FORM_CONTRADICTION_RULE,
  PURPOSE_REFUSAL,
  FORM_REFUSAL,
  CONSENT_STATE,
  CONSENT_LOCALE,
  HOT_START_STATE,
  PROTOCOL_PART,
  CORRECTION_ACTION,
  EXCLUSION_REASON,
  EXCLUSION_STATE,
  RECOMMENDATION_STATE,
  PROGRESS_CELL_STATE,
  MODEL_KEY_SOURCE,
  MARKETING_NAME_STATE,
  DISAGREEMENT_DIRECTION,
};

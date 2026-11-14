"use strict";

// ===================================================
// sessionNames — مصدر واحد لمفردات جلسة الفحص: الحالات، وأسباب الإلغاء، ورموز الرفض (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03)
// ===================================================
//
// القاعدة 24 (بنصّها): «القيمة الحرفية التي يقوم عليها تمييز — وسم، مفتاح، اسم حقل — لها حكم رقم القياس: مصدر واحد مُصدَّر، لا نسخة في كل ملفّ.»
// قرار المستخدم (2026-10-10، بنصّه، منقول من أمر المنسّق): «الإلغاء: المالك والجهاز المنضمّ، قبل اكتمال الفحص. الحالة «ملغاة» مع سبب مسمّى،
// بلا حذف (القاعدة 42)…» و«الانتهاء: بلا منظّف مجدوَل. تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها.»
// وأمر المنسّق للتمييز في joinScanSession: «رمز غير صالح» و«انضُمّ إليها» و«ملغاة» و«منتهية»، كلٌّ برمز مسمّى من مصدر واحد في `details`.
//
// قبل هذا الملفّ كانت الحالات نصوصاً حرفية في ستّة مواضع (createScanSession · joinScanSession · analyzeDevice · submitEvaluation · الجرد
// scripts/lib/activeSessions.js · ومنظّف checkExpiringSubscriptions.js:201 الذي لم يُمسّ هنا — انظر تقرير المهمّة)، ولا مفردات للإلغاء أصلاً.
// ما تُصدِّره هذه الوحدة هو ما تستورده الدوالّ؛ وحارس بنيوي (sessionNames.test.js) يرفض عودة النصّ الحرفي للحالات في الملفّات التي هُجِّرت.
//
// دورة الحالة (الدفعة ٩):
//   pending ──انضمام──▶ scanning ──اكتمال التحليل──▶ completed        (نهائية)
//      │                   │
//      ├── إلغاء ──────────┤──▶ cancelled                                (نهائية؛ cancelledAt وcancelReason)
//      └── مسّ بعد expiresAt ─┴──▶ expired                              (نهائية؛ expiredAt)
// لا انتقال من نهائية إلى أخرى (الإلغاء بعد completed يُرفض برمز مسمّى؛ والإلغاء الثاني نداء متكافئ لا انتقال).

const {SESSION_EXPIRY_REASON} = require("./sessionTimeout");
const {PURPOSE_REFUSAL} = require("../protocol/protocolVocabulary");

/** حالات مستند scanSessions/{id}.status — القيمة نفسها المكتوبة في Firestore. */
const SESSION_STATUS = Object.freeze({
  PENDING: "pending",
  SCANNING: "scanning",
  COMPLETED: "completed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

/** الحالتان الجاريتان (يستعملهما جرد «الجلسات الجارية» قبل النشر). */
const ACTIVE_SESSION_STATUSES = Object.freeze([SESSION_STATUS.PENDING, SESSION_STATUS.SCANNING]);
/** النهائية: لا يجري عليها عمل ولا تمنع نشراً. */
const TERMINAL_SESSION_STATUSES = Object.freeze([
  SESSION_STATUS.COMPLETED, SESSION_STATUS.EXPIRED, SESSION_STATUS.CANCELLED,
]);
/** كل ما تعرفه الشيفرة؛ ما خرج عنها «حالة غير معروفة» تُعلَن (القاعدة 22). */
const KNOWN_SESSION_STATUSES = Object.freeze(Object.values(SESSION_STATUS));

/** دور المستدعي في الجلسة، يُشتقّ من الخادم لا من العميل. */
const SESSION_ROLE = Object.freeze({
  OWNER: "owner", // ownerId == uid المستدعي
  JOINER: "joiner", // joinedBy == uid المستدعي (الجهاز المنضمّ)
});

/**
 * أسباب الإلغاء المخزَّنة في cancelReason. ثلاثة بنصّ أمر المنسّق: consent_declined · left_by_customer · cancelled_by_owner.
 * consent_declined: الزبون رفض الموافقة (PLAN-06 §٨-ج: «رفض الموافقة ⇐ … والجلسة تُلغى بنداء الإلغاء من الدفعة ٩»).
 * left_by_customer: الزبون غادر الجلسة. cancelled_by_owner: صاحب المحلّ ألغاها.
 */
const CANCEL_REASON = Object.freeze({
  CONSENT_DECLINED: "consent_declined",
  LEFT_BY_CUSTOMER: "left_by_customer",
  CANCELLED_BY_OWNER: "cancelled_by_owner",
});

/**
 * أيّ سبب يجوز لأيّ دور (الخادم يعرف الدور فلا يُقبل من العميل سبب لا يناسبه): المالك لا يدّعي «رفض الموافقة» نيابةً عن الزبون،
 * والمنضمّ لا يدّعي «ألغاه المالك».
 */
const CANCEL_REASONS_BY_ROLE = Object.freeze({
  [SESSION_ROLE.OWNER]: Object.freeze([CANCEL_REASON.CANCELLED_BY_OWNER]),
  [SESSION_ROLE.JOINER]: Object.freeze([CANCEL_REASON.CONSENT_DECLINED, CANCEL_REASON.LEFT_BY_CUSTOMER]),
});

/**
 * رموز رفض joinScanSession في `details.reasonCode`. الأوّل والأخيران من الحالات الأربع في أمر المنسّق؛ الباقيان (غياب expiresAt، وحالة غير معروفة)
 * حالتان صريحتان تفرضهما القاعدة 22 بدل أن يُقرأ الغياب صلاحيةً.
 * SESSION_EXPIRED وSESSION_EXPIRES_AT_INVALID من sessionTimeout.js (مصدرهما هناك — analyzeDevice وsubmitEvaluation تستعملان القيمتين نفسيهما).
 *
 * إعادة انضمام الجهاز نفسه (2026-10-10، قرار المستخدم بنصّه: ««سبق الانضمام إلى هذه الجلسة»: يُعرض على جهاز آخر فقط. والجهاز المنضمّ نفسه إن أعاد الانضمام
 * (عودة من الإعدادات، أو إعادة مسح) يُقبل بلا رسالة ولا أثر جانبي.» وجوابه: «Accepted silently only while the session is «scanning» … After completion: a separate
 * reason code SESSION_COMPLETED with the current visible text»):
 *   ALREADY_JOINED  لجهاز **آخر** (أو بلا هوية) — الجلسة scanning أو completed.
 *   COMPLETED       الجهاز **نفسه** والجلسة completed. **القيمة نفسها** CANCEL_REFUSAL.COMPLETED (رمز واحد في الدالّتين، كما STATUS_UNKNOWN) لا نسخة.
 * والجهاز نفسه والجلسة scanning لا رفض له: يُقبل (joinScanSession.js).
 */
const JOIN_REFUSAL = Object.freeze({
  CODE_INVALID: "SESSION_CODE_INVALID", // لا جلسة بهذا الرمز أصلاً
  ALREADY_JOINED: "SESSION_ALREADY_JOINED", // الجلسة انضُمّ إليها جهاز آخر (scanning أو completed) — أو المستدعي بلا هوية
  COMPLETED: "SESSION_COMPLETED", // الجهاز المنضمّ نفسه يعيد الانضمام بعد اكتمال الفحص — مصدر الرمز هنا، وCANCEL_REFUSAL.COMPLETED يشير إليه
  CANCELLED: "SESSION_CANCELLED", // الجلسة ملغاة
  EXPIRED: SESSION_EXPIRY_REASON.EXPIRED, // الجلسة منتهية (مسجَّلة، أو انقضى expiresAt عند هذا المسّ)
  EXPIRES_AT_INVALID: SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID, // expiresAt غائب أو تالف: لا تُقرأ صالحة
  STATUS_UNKNOWN: "SESSION_STATUS_UNKNOWN", // حالة غائبة أو لا تعرفها الشيفرة
});

/** رموز رفض cancelScanSession (تُكتب في السجلّ كلّها؛ وما يصل العميل في details.reasonCode مذكور في cancelScanSession.js). */
const CANCEL_REFUSAL = Object.freeze({
  NOT_AUTHENTICATED: "CANCEL_NOT_AUTHENTICATED", // لا request.auth
  SESSION_ID_REQUIRED: "CANCEL_SESSION_ID_REQUIRED",
  REASON_REQUIRED: "CANCEL_REASON_REQUIRED", // لا قيمة افتراضية تسدّ الغياب
  REASON_INVALID: "CANCEL_REASON_INVALID", // خارج المفردات الثلاث
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  NOT_PARTICIPANT: "SESSION_NOT_PARTICIPANT", // لا مالك ولا منضمّ
  REASON_NOT_ALLOWED_FOR_ROLE: "CANCEL_REASON_NOT_ALLOWED_FOR_ROLE",
  COMPLETED: JOIN_REFUSAL.COMPLETED, // اكتمل الفحص: لا إلغاء (الرمز نفسه في joinScanSession: مصدر واحد، لا نسخة)
  EXPIRED: SESSION_EXPIRY_REASON.EXPIRED,
  EXPIRES_AT_INVALID: SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID,
  STATUS_UNKNOWN: JOIN_REFUSAL.STATUS_UNKNOWN,
  ANALYSIS_IN_FLIGHT: "SESSION_ANALYSIS_IN_FLIGHT", // قفل scanClaims حديث للجلسة: تحليل يجري
  CLAIM_AGE_UNKNOWN: "SESSION_CLAIM_AGE_UNKNOWN", // قفل للجلسة بلا claimedAtMs مقروء: عمره مجهول فلا يُدَّعى قديماً
});

/**
 * رموز رفض analyzeDevice على الجلسة في `details.reasonCode` (A-SUB الموجة الأولى، قرار المستخدم ١٢ «التقرير المخزَّن أولاً مع reasonCode»، 2026-10-17). **كلّها من المصادر القائمة** (القاعدة 24)
 * إلا اثنين جديدين (NOT_STARTED، وREPORT_NOT_AVAILABLE من البند ٢ 2026-10-17): الرمز والنصّ على السلك كما كانا («جلسة الفحص غير صالحة» permission-denied، و«الجلسة منتهية» failed-precondition) ويُضاف `details.reasonCode` وحده.
 *   NOT_PARTICIPANT   المستدعي ليس مالك الجلسة ولا الجهاز المنضمّ (أو لا جلسة بهذا المعرّف): **لا تُكشَف حالة جلسة لغير طرفيها** — الرمز نفسه لغياب الجلسة (كما cancelScanSession: لا وسيط وجود).
 *   NOT_STARTED       الجلسة pending: لم ينضمّ إليها جهاز بعد (الرمز الجديد الوحيد).
 *   COMPLETED         اكتملت ولا ردّ مخزَّناً يُقدَّم لهذا الطالب (القيمة نفسها JOIN_REFUSAL.COMPLETED، رمز واحد في الدوالّ الثلاث).
 *   CANCELLED / EXPIRED / EXPIRES_AT_INVALID / STATUS_UNKNOWN  من JOIN_REFUSAL (والاثنان الأوسطان أصلهما sessionTimeout.js).
 *   REPORT_NOT_AVAILABLE  (البند ٢، 2026-10-17 — قرار المنسّق، منقول): جلسة scanning صالحة لكن التقرير المخزَّن لـscanId الطلب لا تطابق ملكيته ownerId الجلسة (ownerCheckState ≠ MATCH:
 *                     مالك آخر، أو userId غائب في التقرير، أو ownerId غائب في الجلسة). **رمز جديد** لأنّ لا قائم يصلح: SESSION_COMPLETED يعني «اكتمل ولا ردّ لك» وهذه جلسة لم تكتمل؛ NOT_PARTICIPANT يكشف
 *                     أنّ المستدعي ليس طرفاً وهو هنا قد يكون طرفاً مشروعاً (أو حائز sessionId)؛ والرمز واحد لكل الحالات الثلاث كي لا يُكشَف وجود التقرير ولا حاله (الحالة الدقيقة في سطر السجلّ وحده).
 *                     النصّ على السلك «جلسة الفحص غير صالحة» permission-denied كما سائر رفوض الجلسة. المسار الشخصي رمزه STORED_REPORT_REFUSAL.NOT_AVAILABLE في analysis/storedReportAccess.js.
 */
const ANALYZE_SESSION_REFUSAL = Object.freeze({
  NOT_PARTICIPANT: CANCEL_REFUSAL.NOT_PARTICIPANT,
  NOT_STARTED: "SESSION_NOT_STARTED", // الجلسة pending: لم ينضمّ جهاز بعد
  COMPLETED: JOIN_REFUSAL.COMPLETED,
  CANCELLED: JOIN_REFUSAL.CANCELLED,
  EXPIRED: SESSION_EXPIRY_REASON.EXPIRED,
  EXPIRES_AT_INVALID: SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID,
  STATUS_UNKNOWN: JOIN_REFUSAL.STATUS_UNKNOWN,
  REPORT_NOT_AVAILABLE: "SESSION_REPORT_NOT_AVAILABLE", // التقرير المخزَّن لا تطابق ملكيته مالك الجلسة (جلسة scanning) — البند ٢
});

/**
 * رموز رفض createScanSession في `details.reasonCode` **التي ليست من SCAN_REFUSAL** (A-SUB، البند ١، 2026-10-17 — قرار المنسّق، منقول من نصّ الأمر، غير متحقَّق من هذا المستودع).
 * رفضا الرصيد والانتهاء (SHOP_NO_CREDIT وSHOP_SUBSCRIPTION_EXPIRED) أصلهما SCAN_REFUSAL في analysis/scanRefusal.js ولم يُنقلا.
 *   SHOP_PLAN_REQUIRED  باقة المالك لا تسمح بإنشاء جلسة («فحص جهاز آخر عبر كود» ميزة باقات المحلّ): الحكم isSessionOwnerPlan في utils/plans.js، ويأتي بعد شرطَي الرصيد والانتهاء
 *                      فلا يتغيّر رفض قائم ولا نصّه. النصّ العربي في createScanSession.js (CREATE_SESSION_PLAN_REQUIRED_TEXT)؛ الرمز `permission-denied` كسائر رفوض المالك.
 */
const CREATE_SESSION_REFUSAL = Object.freeze({
  SHOP_PLAN_REQUIRED: "SHOP_PLAN_REQUIRED",
});

/**
 * رموز رفض setSessionPurpose (S-P6-03، 2026-10-18 +03، docs/PROTOCOL_CONTRACT.md §٢ A2). **المعتمَد اسماً واحد فقط:** NOT_PENDING = PURPOSE_SESSION_NOT_PENDING (E5، 2026-10-15) ومصدره protocolVocabulary.PURPOSE_REFUSAL
 * (لا نسخة هنا). **الباقي أسماء اقترحتُها بنسق CANCEL_REFUSAL** (لا أسماء معتمدة؛ تُراجَع مع عقد التطبيق): NOT_AUTHENTICATED · SESSION_ID_REQUIRED · PURPOSE_REQUIRED · PURPOSE_INVALID · NOT_OWNER.
 * وما له قيمة قائمة يأخذها منها: SESSION_NOT_FOUND وSTATUS_UNKNOWN وEXPIRED وEXPIRES_AT_INVALID (مصدر واحد، القاعدة 24)، وNOT_OWNER لا يصل العميل باسمه: الردّ نفسه NOT_PARTICIPANT (لا يُكشف وجود جلسة).
 *   NOT_OWNER   المستدعي ليس مالك الجلسة (الجهاز المنضمّ أو غريب أو ownerId غائب): السجلّ يفرّق، والعميل يرى SESSION_NOT_PARTICIPANT.
 *   NOT_PENDING الجلسة ليست pending (انضمّ إليها جهاز، أو اكتملت، أو أُلغيت، أو انتهت): «بعد الانضمام تُقفل الرقائق» (PLAN-06:484).
 */
const SET_PURPOSE_REFUSAL = Object.freeze({
  NOT_AUTHENTICATED: "SET_PURPOSE_NOT_AUTHENTICATED", // لا request.auth
  SESSION_ID_REQUIRED: "SET_PURPOSE_SESSION_ID_REQUIRED",
  PURPOSE_REQUIRED: "SET_PURPOSE_REQUIRED", // لا قيمة افتراضية تسدّ الغياب
  PURPOSE_INVALID: "SET_PURPOSE_INVALID", // خارج SETTABLE_SESSION_PURPOSE
  SESSION_NOT_FOUND: CANCEL_REFUSAL.SESSION_NOT_FOUND,
  NOT_PARTICIPANT: CANCEL_REFUSAL.NOT_PARTICIPANT, // ما يراه العميل لغير المالك ولجلسة غير موجودة
  NOT_OWNER: "SESSION_NOT_OWNER", // للسجلّ وحده
  NOT_PENDING: PURPOSE_REFUSAL.SESSION_NOT_PENDING, // E5
  EXPIRED: SESSION_EXPIRY_REASON.EXPIRED,
  EXPIRES_AT_INVALID: SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID,
  STATUS_UNKNOWN: JOIN_REFUSAL.STATUS_UNKNOWN,
  // (2026-10-22، أمر ربط «قبل/بعد صيانة»: A2) نوع العطل: القيم من protocolVocabulary.PURPOSE_REFUSAL (proposal A2)، قبل أيّ قراءة للجلسة.
  DEFECT_TYPE_REQUIRED: PURPOSE_REFUSAL.DEFECT_TYPE_REQUIRED, // maintenance_* بلا نوع
  DEFECT_TYPE_INVALID: PURPOSE_REFUSAL.DEFECT_TYPE_INVALID, // نوع مُرسَل خارج DEFECT_TYPE (بما فيه null والفارغ والأحرف الصغيرة)
  DEFECT_TYPE_NOT_APPLICABLE: PURPOSE_REFUSAL.DEFECT_TYPE_NOT_APPLICABLE, // نوع مُرسَل مع normal
  // (2026-10-22، ق31، أقرّه حسن) رفض نداء محلّ بلا الجزء اللازم للغرض: بعد فحوص الجلسة وقبل أيّ كتابة؛ القيمة من protocolVocabulary.PURPOSE_REFUSAL (proposal A2).
  PART_NOT_ENABLED: PURPOSE_REFUSAL.PART_NOT_ENABLED,
});

/**
 * رموز رفض recordScanConsent (S-P6-12، 2026-10-21 +03، docs/PROTOCOL_CONTRACT.md §٢ A8). **كلّها أسماء اقترحتُها** بنسق CANCEL_REFUSAL وSET_PURPOSE_REFUSAL (لا رمز معتمداً لها: التصميم يسمّي الموافقة ولا يسمّي دالّة ترفضها):
 * NOT_AUTHENTICATED · SESSION_ID_REQUIRED · TEXT_VERSION_REQUIRED · TEXT_VERSION_INVALID · LOCALE_REQUIRED · LOCALE_INVALID · NOT_JOINER (للسجلّ وحده) · NOT_SCANNING · STORED_UNREADABLE.
 * وما له قيمة قائمة يأخذها منها: SESSION_NOT_FOUND وSTATUS_UNKNOWN وEXPIRED وEXPIRES_AT_INVALID (مصدر واحد، القاعدة 24)، وNOT_JOINER لا يصل العميل باسمه: الردّ نفسه NOT_PARTICIPANT (لا يُكشف وجود جلسة).
 *   NOT_JOINER       المستدعي ليس الجهاز المنضمّ (المالك أو غريب أو joinedBy غائب): السجلّ يفرّق، والعميل يرى SESSION_NOT_PARTICIPANT.
 *   NOT_SCANNING     الجلسة ليست scanning (لم ينضمّ جهاز بعد لا يصل هنا: NOT_JOINER؛ هذا لما بعد الانضمام: اكتملت أو أُلغيت أو انتهت): «الموافقة بعد الانضمام وقبل الفحص» (PLAN-06:1388).
 *   STORED_UNREADABLE في protocolPending سجلّ موافقة بشكل لا يُقرأ (كتابة يدوية): لا يُكتب فوقه ولا يُقرأ موافقةً (القاعدة 22).
 */
const RECORD_CONSENT_REFUSAL = Object.freeze({
  NOT_AUTHENTICATED: "CONSENT_NOT_AUTHENTICATED", // لا request.auth
  SESSION_ID_REQUIRED: "CONSENT_SESSION_ID_REQUIRED",
  TEXT_VERSION_REQUIRED: "CONSENT_TEXT_VERSION_REQUIRED", // لا قيمة افتراضية تسدّ الغياب
  TEXT_VERSION_INVALID: "CONSENT_TEXT_VERSION_INVALID", // ليست عدداً صحيحاً في [1, CONSENT_TEXT_VERSION]
  LOCALE_REQUIRED: "CONSENT_LOCALE_REQUIRED",
  LOCALE_INVALID: "CONSENT_LOCALE_INVALID", // خارج CONSENT_LOCALE
  SESSION_NOT_FOUND: CANCEL_REFUSAL.SESSION_NOT_FOUND,
  NOT_PARTICIPANT: CANCEL_REFUSAL.NOT_PARTICIPANT, // ما يراه العميل لغير المنضمّ ولجلسة غير موجودة
  NOT_JOINER: "SESSION_NOT_JOINER", // للسجلّ وحده
  NOT_SCANNING: "CONSENT_SESSION_NOT_SCANNING",
  EXPIRED: SESSION_EXPIRY_REASON.EXPIRED,
  EXPIRES_AT_INVALID: SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID,
  STATUS_UNKNOWN: JOIN_REFUSAL.STATUS_UNKNOWN,
  STORED_UNREADABLE: "CONSENT_STORED_UNREADABLE",
  // (ق40، 2026-10-23، أقرّه حسن 2026-10-22 مع ق15) المحلّ بلا جزء `consent` مفعَّل (users/{ownerId}.protocolParts.consent !== true، أو مستند المالك غائب): يُرفض التسجيل، فلا موافقة تُسجَّل لمحلّ لم يُفعِّل الجزء. على نمط PURPOSE_PART_NOT_ENABLED (ق31).
  PART_NOT_ENABLED: "CONSENT_PART_NOT_ENABLED",
});

// ─── الكنس الآمن ومسارا الاكتمال (S-SWEEP، 2026-10-15 +03) ──────────────────────────────────────────────────────────────────────────────
// القاعدة 24: كل قيمة حرفية يقوم عليها تمييز في سطور السجلّ المسمّاة أدناه مصدرها هنا وحده؛ sweepExpiredSessions.js وsessionCompletion.js وsessionLifecycle.js
// تستوردها، ويثبّتها sessionNames.test.js بنصّها الحرفي (فانجراف قيمة يُفشل الاختبار قبل أن يغيّر سطراً يقرؤه من يراقب السجلّ).
// العقد: docs/PROTOCOL_CONTRACT.md §٦-ج (الكنس) و§٦-د (مسارا الاكتمال).

/**
 * حالات سطر الكنس E34 (`state=`): **قائمة مغلقة** (§٦-ج، حسم المنسّق بإذن المستخدم 2026-10-15). كل حالة تحدّد أيّ أعداد السطر أعداد وأيّها NOT_RUN:
 *   COMPLETED         قُرئ الاستعلامان وعولج كل المرشَّح.
 *   CAPPED            بلغت محاولات الكتابة سقف SWEEP_WRITE_CAP وبقي مرشَّح لنداء لاحق (E33).
 *   BUDGET_EXHAUSTED  نفدت ميزانية الزمن وبقي مرشَّح (E34).
 *   READ_FAILED       فشل أحد الاستعلامين (أو نفدت الميزانية والقراءة لم تنتهِ): يتوقّف الكنس كلّه بلا كتابة، والأعداد NOT_RUN.
 *   NOT_RUN_NO_KEY    انضمام بمعرّف غائب أو null أو فارغ: لا كنس ولا استعلام (E24)، والأعداد وزمن الكنس NOT_RUN.
 */
const SWEEP_STATE = Object.freeze({
  COMPLETED: "COMPLETED",
  CAPPED: "CAPPED",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  READ_FAILED: "READ_FAILED",
  NOT_RUN_NO_KEY: "NOT_RUN_NO_KEY",
});

/** النداء الذي يكنس (`from=`). القيمة اسم الدالّة نفسه. الإلغاء لا يكنس (E25)، وanalyzeDevice وsubmitEvaluation لا تكنسان. */
const SWEEP_CALLER = Object.freeze({
  CREATE_SCAN_SESSION: "createScanSession",
  JOIN_SCAN_SESSION: "joinScanSession",
});

/** مفتاح الكنس (`key=`): اسم حقل مستند الجلسة الذي يُستعلَم عنه بمساواة. الإنشاء بالمالك، والانضمام بالجهاز المنضمّ (E24). */
const SWEEP_KEY_FIELD = Object.freeze({
  OWNER_ID: "ownerId",
  JOINED_BY: "joinedBy",
});

/** عدّاد لم يجرِ ما يُعدّ: يُكتب في السطر كلمةً لا صفراً (القاعدة 22: `written=0` تعني أن الكنس جرى ولم يكتب). */
const SWEEP_NOT_RUN = "NOT_RUN";

/**
 * سبب تخطّي مرشَّحة (سطر `skipped` لكل مرشَّحة، لا في سطر E34 المعتمد نصّه): قائمة مغلقة.
 *   CLAIM_IN_FLIGHT   لها قفل scanClaims عمره < SCAN_CLAIM_TTL_MS: تحليل يجري (E32).
 *   CLAIM_AGE_UNKNOWN لها قفل بلا claimedAtMs مقروء: عمره مجهول فلا يُدَّعى قديماً (كما cancelScanSession: SESSION_CLAIM_AGE_UNKNOWN).
 *   NO_LONGER_DUE     لم تعد مستحقّة داخل المعاملة (سبقها اكتمال أو إلغاء أو انتهاء، أو تغيّر وقتها).
 */
const SWEEP_SKIP_REASON = Object.freeze({
  CLAIM_IN_FLIGHT: "claim_in_flight",
  CLAIM_AGE_UNKNOWN: "claim_age_unknown",
  NO_LONGER_DUE: "no_longer_due",
});

/** مسار كتابة «اكتملت» (`path=`): فحص جديد (analyzeDevice بعد حفظ التقرير) أو ردّ مخزَّن (تقرير موجود لهذا scanId). */
const COMPLETION_PATH = Object.freeze({
  FRESH_SCAN: "fresh-scan",
  CACHED_RESPONSE: "cached-response",
});

/**
 * سبب عدم كتابة «اكتملت» (سطر `completed-skipped`): قائمة مغلقة. NOT_SCANNING يُطبع `status=<الحالة>`؛ والآخران `reason=<القيمة>`.
 *   NOT_SCANNING          الجلسة ليست scanning (cancelled أو expired أو completed أو حالة غائبة/مجهولة): لا تُطمَس.
 *   SESSION_MISSING       مستند الجلسة غير موجود.
 *   REPORT_OWNER_MISMATCH E35 (المسار ب): userId في التقرير المخزَّن لا يساوي ownerId الجلسة (أو أحدهما غائب).
 */
const COMPLETION_SKIP = Object.freeze({
  NOT_SCANNING: "not_scanning",
  SESSION_MISSING: "session_missing",
  REPORT_OWNER_MISMATCH: "report_owner_mismatch",
});

/** حالة حارس الملكية E35 (تُلحَق بسطر `completed-skipped reason=report_owner_mismatch` كي لا يُقرأ الغياب تطابقاً أو عدم تطابق، القاعدة 22). */
const OWNER_CHECK_STATE = Object.freeze({
  MATCH: "MATCH",
  MISMATCH: "MISMATCH",
  REPORT_USER_ABSENT: "REPORT_USER_ABSENT",
  SESSION_OWNER_ABSENT: "SESSION_OWNER_ABSENT",
});

module.exports = {
  SESSION_STATUS,
  ACTIVE_SESSION_STATUSES,
  TERMINAL_SESSION_STATUSES,
  KNOWN_SESSION_STATUSES,
  SESSION_ROLE,
  CANCEL_REASON,
  CANCEL_REASONS_BY_ROLE,
  JOIN_REFUSAL,
  CANCEL_REFUSAL,
  ANALYZE_SESSION_REFUSAL,
  CREATE_SESSION_REFUSAL,
  SET_PURPOSE_REFUSAL,
  RECORD_CONSENT_REFUSAL,
  SWEEP_STATE,
  SWEEP_CALLER,
  SWEEP_KEY_FIELD,
  SWEEP_NOT_RUN,
  SWEEP_SKIP_REASON,
  COMPLETION_PATH,
  COMPLETION_SKIP,
  OWNER_CHECK_STATE,
};

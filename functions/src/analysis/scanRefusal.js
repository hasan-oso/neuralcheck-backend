"use strict";

// ===================================================
// scanRefusal — أسباب رفض الفحص عند بوّابة analyzeDevice، ونصوصها، وسطر السجلّ، والحكم الواحد (S-SUB، 2026-10-16 +03)
// ===================================================
//
// قرارات المستخدم (بنصّها، منقولة من أمر المنسّق، غير متحقَّقة من هذا المستودع — القاعدة 29):
//   2026-10-14: «وفي المحطّة ٢: التطبيق يتحقّق من التاريخ قبل القياس بنصّ يُعرض عليّ، وسطر سجلّ بسبب مسمّى لرفض analyzeDevice المبكّر (NO_CREDIT / SUBSCRIPTION_EXPIRED / FREE_DEVICE_USED).»
//   2026-10-15 (خطّة المحطّة ٢): «التحقّق من الاشتراك قبل القياس: رفض مصنَّف، ونصوص المحلّ، وscanRefusal.js بسطر الرفض المسمّى، والرفض المبكّر عند الانضمام».
//
// ─── ما كان قبل ─────────────────────────────────────────────────────────────────────────────────────────────
// الرفض المبكّر في analyzeDevice.js (ثلاثة مواضع `throw new HttpsError`) ورفض معاملة الحجز في scanReservation.js (ثلاثة أخرى) كان كلٌّ منهما يحمل نسخته
// الحرفية من النصوص الثلاثة (scanReservation.js: SCAN_RESERVATION_MESSAGES، وanalyzeDevice.js: سلاسل حرفية، ولا يستورد الأولى)، ورفض المبكّر بلا سطر سجلّ أصلاً
// (تشخيص S21 احتاج استنتاجاً بعد الواقعة)، ورفض المعاملة بسطر `[scanReservation] refused scanId=<خامّ> reason=…`. وشرط «رصيد»/«منتهٍ»/«جهاز مجاني» مكتوب مرّتين.
//
// ─── ما هذا الملفّ ──────────────────────────────────────────────────────────────────────────────────────────
// المصدر الواحد (القاعدة 24) لـ: (١) الأسباب SCAN_REFUSAL (قيم مجمَّدة)، (٢) النصوص العربية SCAN_REFUSAL_TEXT، (٣) موضع الرمي الوحيد لها refuseScan، (٤) الحكم الواحد
// للبوّابة scanGateVerdict (الرصيد ثم الانتهاء ثم الجهاز المجاني — الترتيب نفسه الذي كان)، وجزؤه غير المعتمد على الجهاز الذي يردّ به checkSubscription.
//
// ─── ما لا يتغيّر على السلك (أجهزة 1.0.12–1.0.14) ──────────────────────────────────────────────────────────
// رمز HttpsError `permission-denied` ونصّه العربي حرفياً كما كانا. يُضاف `details.reasonCode` وحده (1.0.12 لا يقرأ details أصلاً — منقول عن أمر المنسّق، التصميم الموحَّد §١
// البند ٤، غير متحقَّق من هنا). **ولا نصّ عربي أو تركي جديد على الخادم:** نسختا SHOP_* تحملان النصّ القائم نفسه؛ نصوص المحلّ (للفنّي) تأتي المستخدمَ للاعتماد مع أمر
// التطبيق، ويقرأ التطبيق الجديد `reasonCode` فيعرض نصّه.
//
// ─── جلسة المحلّ (isSessionScan) ─────────────────────────────────────────────────────────────────────────────
// في فحص الجلسة userId = ownerId (analyzeDevice.js): المرفوض هو الفنّي بنصّ موجَّه للمالك. فحين isSessionScan يخرج الرمز بنسخة SHOP_ (NO_CREDIT ← SHOP_NO_CREDIT،
// SUBSCRIPTION_EXPIRED ← SHOP_SUBSCRIPTION_EXPIRED) ليميّز التطبيق الجديد «اشتراك المحلّ» من «اشتراكك». FREE_DEVICE_USED بلا نسخة SHOP_ (الجهاز المفحوص هو المقصود في
// الحالتين، والنصّ يصلح له). `isSessionScan` مُعامل **صريح** (لا يُستنتَج من sessionId على القفل): غيابه أو غير البولي خطأ برمجي صريح (القاعدة 22).
//
// ─── رفض الانضمام المبكّر ────────────────────────────────────────────────────────────────────────────────────
// joinScanSession ترفض جلسةً مالكها منتهٍ اشتراكه بالرمز SHOP_SUBSCRIPTION_EXPIRED وبنصّه القائم نفسه (scanRefusalWire) — لا تستعمل refuseScan (سطرها `[joinScanSession] refused`
// من refuse الخاصّة بها). الحكم «منتهٍ» هنا هو isSubscriptionExpired نفسها (utils/subscription.js) التي يستعملها scanGateVerdict: مصدر واحد.
//
// ─── رفضا إنشاء الجلسة (A-SUB الموجة الأولى، قرار المستخدم ٤، 2026-10-17) ────────────────────────────────────────
// createScanSession (المالك نفسه المستدعي) يحمل رفضاه `details.reasonCode`: الانتهاء بالرمز SHOP_SUBSCRIPTION_EXPIRED عبر scanRefusalWire (النصّ نفسه)، والرصيد بالرمز SHOP_NO_CREDIT
// ونصّه الخاصّ القائم «لا يوجد رصيد فحوصات» (CREATE_SESSION_NO_CREDIT_TEXT في createScanSession.js — **لا يُوحَّد** مع SCAN_REFUSAL_TEXT.NO_CREDIT بقرار المستخدم، فلا scanRefusalWire للرصيد هناك).

const {HttpsError} = require("firebase-functions/v2/https");
const {hashIdForLog} = require("../utils/logRedaction");
const {isSubscriptionExpired} = require("../utils/subscription");

/** أسباب الرفض. قيمة كل سبب اسمه (تُكتب في السجلّ وتصل التطبيق في details.reasonCode). */
const SCAN_REFUSAL = Object.freeze({
  NO_CREDIT: "NO_CREDIT", // لا رصيد فحوصات
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED", // الاشتراك انتهى (expiresAt في الماضي)
  FREE_DEVICE_USED: "FREE_DEVICE_USED", // الفحص المجاني استُعمل على هذا الجهاز
  SHOP_NO_CREDIT: "SHOP_NO_CREDIT", // NO_CREDIT في فحص جلسة محلّ: الرصيد رصيد المحلّ لا رصيد الهاتف
  SHOP_SUBSCRIPTION_EXPIRED: "SHOP_SUBSCRIPTION_EXPIRED", // SUBSCRIPTION_EXPIRED في جلسة محلّ (أو عند الانضمام): اشتراك المحلّ
});

/** مرحلتا الرفض في سطر السجلّ: الفحص المبكّر (بلا كتابة) ومعاملة الحجز (التي تحسم التزامن). */
const SCAN_REFUSAL_STAGE = Object.freeze({EARLY: "early", RESERVATION: "reservation"});

// النصوص القائمة حرفياً قبل هذا الملفّ (analyzeDevice.js و scanReservation.js عند c17a053). الفاصلة في «انتهى اشتراكك، يرجى التجديد» هي الفاصلة العربية U+060C.
const TEXT_NO_CREDIT = "لا يوجد رصيد فحوصات. يرجى شراء اشتراك.";
const TEXT_SUBSCRIPTION_EXPIRED = "انتهى اشتراكك، يرجى التجديد";
const TEXT_FREE_DEVICE_USED = "تم استخدام الفحص المجاني لهذا الجهاز سابقاً";

/** نصّ كل سبب على السلك (يراه 1.0.12–1.0.14). نسختا SHOP_* هما النصّ القائم نفسه بالمرجع لا بنسخة ثانية. */
const SCAN_REFUSAL_TEXT = Object.freeze({
  [SCAN_REFUSAL.NO_CREDIT]: TEXT_NO_CREDIT,
  [SCAN_REFUSAL.SUBSCRIPTION_EXPIRED]: TEXT_SUBSCRIPTION_EXPIRED,
  [SCAN_REFUSAL.FREE_DEVICE_USED]: TEXT_FREE_DEVICE_USED,
  [SCAN_REFUSAL.SHOP_NO_CREDIT]: TEXT_NO_CREDIT,
  [SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED]: TEXT_SUBSCRIPTION_EXPIRED,
});

/** رمز HttpsError الظاهر لكل أسباب هذا الملفّ — كما كان. */
const SCAN_REFUSAL_CODE = "permission-denied";

/** الأسباب التي يمرّر بها المستدعي refuseScan (الأساسية)؛ النسخة SHOP_ تُختار داخلها. */
const BASE_REASONS = Object.freeze(new Set([
  SCAN_REFUSAL.NO_CREDIT, SCAN_REFUSAL.SUBSCRIPTION_EXPIRED, SCAN_REFUSAL.FREE_DEVICE_USED,
]));
const SESSION_VARIANT = Object.freeze({
  [SCAN_REFUSAL.NO_CREDIT]: SCAN_REFUSAL.SHOP_NO_CREDIT,
  [SCAN_REFUSAL.SUBSCRIPTION_EXPIRED]: SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED,
});
const ALL_REASONS = Object.freeze(new Set(Object.values(SCAN_REFUSAL)));
const STAGES = Object.freeze(new Set(Object.values(SCAN_REFUSAL_STAGE)));

/**
 * الرمز والنصّ والسبب على السلك لسبب من SCAN_REFUSAL. للمستدعي الذي يملك سطر سجلّه ورميه (joinScanSession.refuse)، فلا نصّ حرفي خارج هذا الملفّ.
 * @param {string} reason سبب من SCAN_REFUSAL (أيّ من الخمسة)
 * @return {{code: string, message: string, reasonCode: string}}
 */
function scanRefusalWire(reason) {
  if (!ALL_REASONS.has(reason)) throw new Error(`scanRefusal: سبب رفض غير مُدرَج: ${String(reason)}`);
  return {code: SCAN_REFUSAL_CODE, message: SCAN_REFUSAL_TEXT[reason], reasonCode: reason};
}

/**
 * **موضع الرمي الوحيد لأسباب البوّابة** (يحرسه scanRefusalGuard.test.js): يكتب سطر الرفض المسمّى ثم يرمي
 * HttpsError("permission-denied", <النصّ العربي القائم>, {reasonCode}).
 * السطر: `[analyzeDevice] refused reason=<…> stage=early|reservation scanId=#<هاش> session=yes|no` — بلا معرّف مستخدم ولا رمز جلسة ولا scanId خامّ (القاعدة 36، سياسة السجلّات).
 * @param {string} reason سبب أساسي: NO_CREDIT أو SUBSCRIPTION_EXPIRED أو FREE_DEVICE_USED (النسخة SHOP_ تُختار هنا بـisSessionScan)
 * @param {{stage: string, isSessionScan: boolean, scanId: ?string}} ctx
 * @return {never}
 */
function refuseScan(reason, {stage, isSessionScan, scanId} = {}) {
  if (!BASE_REASONS.has(reason)) throw new Error(`scanRefusal: سبب رفض غير مُدرَج أو ليس أساسياً: ${String(reason)}`);
  if (!STAGES.has(stage)) throw new Error(`scanRefusal: مرحلة رفض غير مُدرَجة: ${String(stage)}`);
  if (typeof isSessionScan !== "boolean") throw new Error("scanRefusal: isSessionScan مُعامل صريح (true أو false)");
  const onWire = (isSessionScan && SESSION_VARIANT[reason]) || reason;
  const wire = scanRefusalWire(onWire);
  console.warn(`[analyzeDevice] refused reason=${wire.reasonCode} stage=${stage} scanId=${hashIdForLog(scanId)} ` +
      `session=${isSessionScan ? "yes" : "no"}`);
  throw new HttpsError(wire.code, wire.message, {reasonCode: wire.reasonCode});
}

/**
 * الجزء غير المعتمد على الجهاز من الحكم: الرصيد ثم الانتهاء (الترتيب الذي كان في analyzeDevice.js و scanReservation.js: الرصيد يسبق الانتهاء).
 * شرط الرصيد `(scansRemaining || 0) >= 1` — شرط معاملة الحجز (الأشدّ). كان الفحص المبكّر `<= 0`؛ والفرق في رصيد كسري (0<x<1) أو غير رقمي وحده، لا يقع في
 * الإنتاج (الرصيد يُغيَّر بـincrement(±1))، والنتيجة نفسها NO_CREDIT بالنصّ نفسه، وتُرفض الآن مبكّراً بلا كتابة.
 * @param {?Object} userData مستند users/{uid} أو null (غائب ⟵ رصيد 0 ⟵ NO_CREDIT، كما كان)
 * @param {Date} now
 * @return {?string} NO_CREDIT أو SUBSCRIPTION_EXPIRED أو null
 */
function deviceIndependentVerdict(userData, now) {
  const balance = (userData && userData.scansRemaining) || 0;
  if (!(balance >= 1)) return SCAN_REFUSAL.NO_CREDIT;
  if (isSubscriptionExpired(userData, now)) return SCAN_REFUSAL.SUBSCRIPTION_EXPIRED;
  return null;
}

/**
 * الحكم الواحد للبوّابة — يستعمله الفحص المبكّر في analyzeDevice ومعاملة الحجز في scanReservation (فلا نسختان). الترتيب: الرصيد، فالانتهاء، فالجهاز المجاني (باقة free وحدها).
 * @param {?Object} userData مستند users/{uid} أو null
 * @param {{deviceFP: string, now?: Date}} ctx deviceFP نصّ (مفتاح الجهاز للفحص المجاني) — غيابه خطأ برمجي لا «لا فحص جهاز» صامتاً (للحكم بلا جهاز: checkSubscriptionVerdict)
 * @return {?string} سبب أساسي من SCAN_REFUSAL أو null (يُسمح)
 */
function scanGateVerdict(userData, {deviceFP, now = new Date()} = {}) {
  if (typeof deviceFP !== "string") throw new Error("scanRefusal: scanGateVerdict تحتاج deviceFP نصّاً (للحكم بلا جهاز: checkSubscriptionVerdict)");
  const early = deviceIndependentVerdict(userData, now);
  if (early !== null) return early;
  const isFreeTrial = (userData.plan || "free") === "free";
  if (isFreeTrial && (userData.freeTrialUsedDevices || []).includes(deviceFP)) return SCAN_REFUSAL.FREE_DEVICE_USED;
  return null;
}

// ─── حقل الحكم في ردّ checkSubscription ─────────────────────────────────────────────────────────────────────
// الاسم والقيم **اقتراح الوكيل `[م]`** (أمر S-SUB: «الاسم والقيم يقترحهما الوكيل»)، وتُسجَّل في docs/PROTOCOL_CONTRACT.md §١٠. الحقول القائمة في الردّ لا تتغيّر (قرّاء 1.0.14 والموقع).
/** اسم الحقل في ردّ checkSubscription. */
const CHECK_SUBSCRIPTION_VERDICT_FIELD = "scanVerdict";
/** القائمة المغلقة لقيمه: يُسمح، أو سبب من SCAN_REFUSAL مما يحسمه الخادم بلا جهاز (الرصيد والانتهاء). FREE_DEVICE_USED غائب عمداً: ردّ checkSubscription لا يحمل جهازاً. */
const CHECK_SUBSCRIPTION_VERDICT = Object.freeze({
  ALLOWED: "ALLOWED",
  NO_CREDIT: SCAN_REFUSAL.NO_CREDIT,
  SUBSCRIPTION_EXPIRED: SCAN_REFUSAL.SUBSCRIPTION_EXPIRED,
});

/**
 * حكم checkSubscription: الجزء غير المعتمد على الجهاز من حكم البوّابة نفسه (deviceIndependentVerdict، مصدره الذي يقرؤه scanGateVerdict). **لا يعني «ALLOWED» أن analyzeDevice
 * لن ترفض** بـFREE_DEVICE_USED (يحتاج الجهاز المفحوص، ولا يحمله هذا النداء) — مُعلَن في العقد.
 * @param {?Object} userData مستند users/{uid} أو null
 * @param {Date} [now]
 * @return {string} قيمة من CHECK_SUBSCRIPTION_VERDICT
 */
function checkSubscriptionVerdict(userData, now = new Date()) {
  const refusal = deviceIndependentVerdict(userData, now);
  return refusal === null ? CHECK_SUBSCRIPTION_VERDICT.ALLOWED : refusal;
}

module.exports = {
  SCAN_REFUSAL,
  SCAN_REFUSAL_STAGE,
  SCAN_REFUSAL_TEXT,
  SCAN_REFUSAL_CODE,
  CHECK_SUBSCRIPTION_VERDICT_FIELD,
  CHECK_SUBSCRIPTION_VERDICT,
  scanRefusalWire,
  refuseScan,
  scanGateVerdict,
  checkSubscriptionVerdict,
};

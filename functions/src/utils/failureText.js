"use strict";

// ===================================================
// failureText — تنقية نصّ الخطأ قبل طباعته في سجلّ أو إعادته سبباً (S-SUB-2، 2026-10-17 +03)
// ===================================================
//
// قرار المستخدم (بنصّه، منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع — القاعدة 29): «السطران الخامّان (verifyReport.js:227،233) ونصّ e.message من التخزين: (أ) التزام صغير قبل النشر.»
//
// ─── لماذا ──────────────────────────────────────────────────────────────────────────────────────────────────
// نصّ خطأ Firestore أو GCS يحمل غالباً مسار المستند أو الكائن بمعرّفه — `projects/…/documents/aiRawResponses/<scanId>` أو `serverSamples/<scanId>.json.gz` (ومشفَّراً `%2F` في عنوان طلب GCS) —
// فيعود scanId إلى السجلّ بعد أن هُشِّر في كل سطر يطبعه باسمه (S-SUB البند ٤). المواضع الثلاثة: `serverRawSamplesStorage.js` (سطر فشل الحفظ)، و`writeRawAiResponses.js` (سطر فشل الكتابة، والسبب
// المُعاد `WRITE_FAILED: …` الذي تطبعه `runAnalysisInternal.js` في سطر `[analysis][v7] aiRawResponses write skipped/failed`). القاعدة 36: ردّ الطرف الآخر قد يحمل سرّك فيُنقّى قبل الطباعة.
//
// ─── المصدر الواحد (القاعدة 24) ─────────────────────────────────────────────────────────────────────────────
// المنقّيان هنا وحدهما: `sanitizeRawText` (كان في analysis/writeRawAiResponses.js) و`sanitizeFailureText` (كان في evaluations/submitEvaluationRefusal.js). نُقلا بلا تغيير في سلوك الأوّل، وبتوسعة
// الثاني (أدناه)، لأن writeRawAiResponses.js وserverRawSamplesStorage.js صارا يحتاجان الثاني وsubmitEvaluationRefusal.js يستورد الأوّل من writeRawAiResponses.js — فدورة استيراد لو بقي كلٌّ في مكانه.
// **المستوردون:** writeRawAiResponses.js (يستعملهما، ويُعيد تصدير sanitizeRawText لمن يستورده منه: createScanSession.js وscripts/export-v7-report-readonly.js)، وserverRawSamplesStorage.js،
// وsubmitEvaluationRefusal.js (يُعيد تصدير sanitizeFailureText لمن يستورده منه: submitEvaluation.js). لا تعريف ثانٍ لأيٍّ من الاسمين في functions/src (يحرسه test/failureText.test.js).
//
// ─── ما توسّع في sanitizeFailureText ────────────────────────────────────────────────────────────────────────
//  ١ المسارات المُخفاة: كانت reports · reportRaw · evaluations · scanSessions · scanClaims · users؛ أُضيفت **aiRawResponses** و**serverSamples** (موضعا الكتابة الجديدان).
//  ٢ المسار يُخفى بعد الشرطة المائلة كلّه إلى أوّل فراغ أو علامة اقتباس أو قوس (كان ينقطع عند أوّل `/`، فمعرّف فيه شرطة مائلة يسرّب نصفه)، وبالشكل المشفَّر `%2F`.
//  ٣ معرّفات يعرفها المستدعي (`{knownIds: [scanId]}`): كل ورود لقيمتها يُخفى أيّاً كان سياقه ومشفَّراً — فمعرّف أقصر من 24 محرفاً (فلا يلتقطه نمط الرمز الطويل) يُخفى ولو لم يرد في مسار.
//     **حدّ مُعلَن:** المعرّف الأقصر من KNOWN_ID_MIN_LENGTH لا يُخفى بقيمته (استبدال «ab» في كل نصّ يشوّه الرسالة)، ويبقى مُخفى حين يرد في مسار مجموعة من القائمة. scanId الحقيقي UUID (36).
//
// ─── أشكال النصّ التي تحمل المعرّف (مقيسة على محاكي Firestore المحلّي في test/failureText.e2e.test.js، لا مفترَضة) ─────────────────────────────────────
//  • `6 ALREADY_EXISTS: entity already exists: EntityRef[partitionRef=dev~demo-nc, path=/aiRawResponses/<id>]`  ← يُخفيه نمط المسار.
//  • `5 NOT_FOUND: no entity to update: app: "dev~demo-nc"\npath <\n  Element {\n    type: "aiRawResponses"\n    name: "<id>"\n  }\n>`  ← لا شرطة مائلة بعد اسم المجموعة: لا يُخفيه إلا المعرّف المعروف
//    (أو نمط الرمز الطويل إن بلغ 24 محرفاً).
//  • خطأ التحقّق من وسائط Admin SDK: `Value for argument "documentPath" must point to a document, but was "<id>"` ← المعرّف وحده بلا اسم مجموعة: المعرّف المعروف أيضاً.
// أمّا نصّ خطأ GCS (`serverSamples/<id>.json.gz` أو `serverSamples%2F<id>.json.gz` في عنوان الطلب) فمبنيّ في الاختبار لا مقيس: لا Storage ولا شبكة هنا.
//
// ─── قناع البريد (البند ٤-د، 2026-10-18 +03) ────────────────────────────────────────────────────────────────────
// قرار المستخدم: «القاعدة 43 وتنقية السجلّات» (منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع — القاعدة 29)؛ القاعدة 36: ردّ الطرف الآخر قد يحمل سرّك. ردّ خادم SMTP يعيد عنوان المستلم
// (`550 5.1.1 <victim@example.com>: Recipient address rejected`، `Invalid recipient user@gmail.com`) وكان المنقّي لا يُزيله (قيس: 5 من 6 عيّنات تبقى فيها العناوين، test/failureText.test.js §١-ب).
// كل عنوان بريد في نصّ الخطأ يُستبدَل بـ FAILURE_EMAIL_PLACEHOLDER (`<email>`) — داخل `<…>` أو مجرّداً أو داخل JSON — **قبل** مسح المسارات والرموز الطويلة (جزء محلّي طويل يلتقطه نمط الرمز
// الطويل فيبقى «@نطاق») **وقبل** القصّ إلى 200 (عنوان على الحدّ يبقى نصفه). **sanitizeRawText بلا قناع عمداً:** الخام المحفوظ (ردّ النموذج) بيانات لا نصّ خطأ مزوّد (القاعدة 12).
// **حدّ مُعلَن:** النمط يقبل نطاقاً بلا نقطة (`user@localhost`) ويُقنّع كل «جزء@جزء» ولو لم يكن بريداً (`pkg@1.2.3` في مكدّس) — تغليب الإخفاء؛ و«@» بلا جزء محلّي أو بلا نطاق لا تُمسّ.

/**
 * تنقية القاعدة 36 — لا طرف مفتاح في الخام المكتوب. نمط بنيوي عام
 * ("api key: ****xxxx" أو "api_key":"...") — لا نسخة من دالّة سكربت
 * القياس (تلك محلّية للسكربت، لا يجوز لكود الإنتاج الاعتماد على ملفّ
 * scripts/)، لكن نفس الفكرة: رد النموذج الخام لا يُفترَض أن يحمل مفتاحاً
 * أصلاً (هو نصّ تحليل لا رسالة خطأ مزوّد)، لكن التنقية دفاع في العمق لا
 * افتراض بالسلامة.
 * @param {?string} text النصّ الخام
 * @return {?string} النصّ بعد التنقية، أو null إن كان الدخل غير نصّي
 */
function sanitizeRawText(text) {
  if (typeof text !== "string") return null;
  return text.replace(/api[_\s-]?key["']?\s*[:=]\s*["']?[*\w-]{4,}/gi, "api key: [KEY-REDACTED]");
}

/** المجموعات (أو مقاطع Storage) التي يُخفى معرّف مستندها/كائنها في نصّ الخطأ — مصدر واحد. */
const FAILURE_PATH_COLLECTIONS = Object.freeze([
  "reports", "reportRaw", "evaluations", "scanSessions", "scanClaims", "users", "aiRawResponses", "serverSamples",
]);
/** أقصر معرّف معروف يُخفى بقيمته (انظر الحدّ المُعلَن في الرأس). */
const KNOWN_ID_MIN_LENGTH = 8;
/** سقف طول الرسالة بعد التنقية. */
const FAILURE_TEXT_MAX_LENGTH = 200;

// المعرّف يمتدّ إلى أوّل فراغ أو علامة اقتباس أو قوس (لا إلى نهاية السطر): رسالة المحاكي `…EntityRef[partitionRef=…, path=/aiRawResponses/<id>]` تنتهي بـ«]» بعد المعرّف.
const PATH_PATTERN = new RegExp(`\\b(${FAILURE_PATH_COLLECTIONS.join("|")})(?:/|%2[Ff])[^\\s"')\\]]+`, "g");
const LONG_TOKEN_PATTERN = /[A-Za-z0-9_-]{24,}/g;

/** النصّ الذي يحلّ محلّ كل عنوان بريد في نصّ الخطأ — مصدر واحد (القاعدة 24): لا موضع آخر في functions/src يكتب هذه الحرفية. */
const FAILURE_EMAIL_PLACEHOLDER = "<email>";
// جزء محلّي بنقاط وزائد وشرطات وشرطة سفلية، ثم «@»، ثم نطاق (فرعي أو لا، بنقطة أو بلا) — حروف وأرقام يونيكود. لا شرطة مائلة ولا «=» في الجزء المحلّي: `to=user@x` يبقى مفتاحه.
const EMAIL_ADDRESS = String.raw`[\p{L}\p{N}._%+'!#$&*-]+@[\p{L}\p{N}](?:[\p{L}\p{N}.-]*[\p{L}\p{N}])?`;
// بالأقواس الزاوية إن وُجدت معاً (`<x@y.z>` ⟵ `<email>` لا `<<email>>`)، وإلا العنوان وحده.
const EMAIL_PATTERN = new RegExp(`<${EMAIL_ADDRESS}>|${EMAIL_ADDRESS}`, "gu");
/** المدخل يُقصّ قبل التنقية: الناتج يُقصّ إلى 200 أصلاً، والنمط يمسح الجزء المحلّي من كل موضع بداية (تربيعي على نصّ طويل بلا «@»). */
const FAILURE_TEXT_SCAN_LIMIT = 2000;

/**
 * يُخفي كل ورود لقيمة معرّف معروف (ومشفَّرةً بـencodeURIComponent).
 * @param {string} text
 * @param {Array<*>} knownIds
 * @return {string}
 */
function maskKnownIds(text, knownIds) {
  let out = text;
  for (const id of knownIds) {
    if (typeof id !== "string" || id.length < KNOWN_ID_MIN_LENGTH) continue;
    out = out.split(id).join("[id]");
    const encoded = encodeURIComponent(id);
    if (encoded !== id) out = out.split(encoded).join("[id]");
  }
  return out;
}

/**
 * يُخفي من رسالة الخطأ ما يحمل معرّفاً: المعرّفات المعروفة، ثم عناوين البريد، ثم مسارات المجموعات، ثم الرموز الطويلة.
 * @param {string} text
 * @param {Array<*>} knownIds
 * @return {string}
 */
function redactMessage(text, knownIds) {
  return maskKnownIds(text, knownIds).replace(EMAIL_PATTERN, FAILURE_EMAIL_PLACEHOLDER).replace(PATH_PATTERN, "$1/[id]").replace(LONG_TOKEN_PATTERN, "[token]");
}

/**
 * نصّ خطأ غير متوقَّع منقّى للسجلّ (القاعدة 36): رمز الخطأ واسم الصنف + رسالة تُخفى فيها مسارات المستندات والكائنات (معرّفها) والمعرّفات التي يعرفها المستدعي والرموز الطويلة وأنماط
 * المفاتيح، وتُقصّ.
 * @param {*} e الخطأ (أو أيّ قيمة: غير الخطأ لا يرمي)
 * @param {{knownIds?: Array<*>}} [opts] knownIds معرّفات يعرفها المستدعي (scanId) تُخفى حيث وردت
 * @return {string}
 */
function sanitizeFailureText(e, {knownIds = []} = {}) {
  const code = (e && e.code !== undefined) ? String(e.code) : "NO_CODE";
  const className = (e && e.constructor && e.constructor.name) || typeof e;
  let msg = (e && typeof e.message === "string") ? e.message : String(e);
  msg = sanitizeRawText(msg.slice(0, FAILURE_TEXT_SCAN_LIMIT)) || "";
  // الرمز يُخفى منه المعرّف المعروف وحده (لا قاعدة الرمز الطويل): رموز Node الطويلة مثل ERR_STREAM_PREMATURE_CLOSE (26 محرفاً) تشخيص لا سرّ.
  return `[${className}] code=${maskKnownIds(code, knownIds)} ${redactMessage(msg, knownIds).slice(0, FAILURE_TEXT_MAX_LENGTH)}`;
}

/** الوسم الذي يضعه من يرمي خطأً رسالتُه مبنيّة من نصوص مزوّد نُقّيت عند البناء (القاعدة 36). مصدر واحد (القاعدة 24). */
const FAILURE_TEXT_SANITIZED_FLAG = "failureTextSanitized";

/**
 * يَسِم خطأً رسالتُه مُنقّاة عند بنائها، فلا تُنقّى ثانيةً متداخلة.
 * @param {Error} err
 * @return {Error} الخطأ نفسه
 */
function markFailureTextSanitized(err) {
  err[FAILURE_TEXT_SANITIZED_FLAG] = true;
  return err;
}

/**
 * نصّ خطأ للسجلّ أو للتخزين أو للإعادة، **بتنقية واحدة لا متداخلة**: الخطأ الموسوم (رمته طبقة نقّت رسالتها عند البناء — DeepSeekError وGeminiError وخطأ «Both … failed») يُعاد نصّه كما هو
 * (وإلّا قصّت التنقية الثانية التشخيصَ عند السقف وأضافت بادئة «[Error] code=NO_CODE» على كل طبقة)، وكل ما عداه يُنقّى بـsanitizeFailureText.
 * @param {*} e
 * @param {{knownIds?: Array<*>}} [opts]
 * @return {string}
 */
function failureTextOnce(e, opts) {
  if (e && e[FAILURE_TEXT_SANITIZED_FLAG] === true && typeof e.message === "string") return e.message;
  return sanitizeFailureText(e, opts);
}

module.exports = {
  sanitizeRawText,
  sanitizeFailureText,
  failureTextOnce,
  markFailureTextSanitized,
  FAILURE_TEXT_SANITIZED_FLAG,
  FAILURE_PATH_COLLECTIONS,
  FAILURE_EMAIL_PLACEHOLDER,
  KNOWN_ID_MIN_LENGTH,
  FAILURE_TEXT_MAX_LENGTH,
};

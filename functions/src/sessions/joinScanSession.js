const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {isSubscriptionExpired} = require("../utils/subscription");
const {SCAN_REFUSAL, scanRefusalWire} = require("../analysis/scanRefusal");
const {evaluationEnabledDecision} = require("./evaluationEnabledState");
const {consentPartDecision} = require("./consentPartState");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("./sessionTimeout");
const {SESSION_STATUS, JOIN_REFUSAL: J, SWEEP_CALLER} = require("./sessionNames");
const {sweepAndLog} = require("./sweepExpiredSessions");
const {
  JOIN_DECISION, classifyStatus, expiredWriteFields, decideJoinForNonPending, pickLatestSession,
} = require("./sessionLifecycle");

// ===================================================
// Cloud Function: joinScanSession (callable)
// جهاز الزبون يربط بالجلسة عبر الكود — لا يحتاج تسجيل دخول
// ===================================================
//
// ─── الدفعة ٩ «مسار الجلسة» (2026-10-10 +03): تمييز أسباب الرفض برمز مسمّى ─────────────────────────────────────────────
// خطّة PLAN-05 (PLAN-05-EVIDENCE-REPORT.md:530، بنصّها منقولاً من أمر المنسّق): «تمييز «جلسة انضُمّ إليها» من «رمز غير صالح» في الخادم: اليوم not-found
// واحد للحالتين.» وأمر المنسّق: ««رمز غير صالح» و«انضُمّ إليها» و«ملغاة» و«منتهية»، كلٌّ برمز مسمّى من مصدر واحد (القاعدة 24) في `details`. ونصّ «انضُمّ
// إليها» بالعربية والتركية «مقترح للاعتماد» (القرار ٩٠)… ولا يصل إلى مستخدم قبل اعتماد المستخدم. فإن احتاج الكود نصّاً الآن، فالنصّ القائم «الكود غير صالح أو
// منتهي الصلاحية» يبقى معروضاً، والرمز المسمّى هو ما يميّز.»
//
// فكلّ رفض يرمي HttpsError(code, message, {reasonCode}) — **رمز HttpsError ونصّه الظاهران للتطبيق هما القائمان قبل هذه الدفعة حرفياً** (JOIN_TEXT أدناه، منقولة
// من joinScanSession.js عند 83d7750)، والتمييز في details.reasonCode من sessionNames.js (JOIN_REFUSAL):
//   SESSION_CODE_INVALID   لا جلسة بهذا الرمز أصلاً                       ← not-found «الكود غير صالح أو منتهي الصلاحية»
//   SESSION_ALREADY_JOINED الجلسة انضُمّ إليها **جهاز آخر** (scanning أو completed)، أو المستدعي بلا هوية ← not-found «الكود غير صالح أو منتهي الصلاحية» (كما كان اليوم)
//   SESSION_COMPLETED      الجهاز **نفسه** يعيد الانضمام بعد اكتمال الفحص ← not-found «الكود غير صالح أو منتهي الصلاحية» (النصّ القائم نفسه؛ انظر «إعادة الانضمام»)
//   SESSION_CANCELLED      الجلسة ملغاة                                    ← not-found «الكود غير صالح أو منتهي الصلاحية» (كما كان)
//   SESSION_EXPIRED        الجلسة منتهية (مسجَّلة أو انقضى expiresAt الآن)  ← deadline-exceeded «انتهت صلاحية الكود» (النصّ القائم للانتهاء)
//   SESSION_EXPIRES_AT_INVALID  expiresAt غائب/تالف                       ← permission-denied «جلسة الفحص غير صالحة» (نصّ sessionTimeout.js القائم)
//   SESSION_STATUS_UNKNOWN حالة غائبة أو لا تعرفها الشيفرة                 ← not-found «الكود غير صالح أو منتهي الصلاحية»
// والمستحدَث سلوكاً: (١) «منتهية» تُكتب فعلاً — كانت `tx.update({status: "expired"})` ثمّ `throw` داخل المعاملة، والرمي يُسقط المعاملة فلا تُكتب (مقيس في
// scanSessionJoinStates.e2e.test.js)؛ تُرجَع الآن نتيجةٌ من المعاملة وتُرمى بعد إتمامها. (٢) جلسة pending بلا expiresAt (أو تالفه) كانت تُقبل بلا حدّ
// (`new Date(undefined) < now` تُعطي false) — صارت مرفوضة بـSESSION_EXPIRES_AT_INVALID بلا كتابة (القاعدة 22). (٣) البحث بالرمز وحده ثم تصفية الحالة في الذاكرة
// (كان بالرمز وpending معاً)، كي تُعرَف حالة الجلسة غير الـpending.
// سطر سجلّ مسمّى لكلّ رفض: `[joinScanSession] refused reason=… stage=lookup|transaction [session=#…] joiner=#…` — المعرّفات عبر hashIdForLog، ولا رمز الجلسة.
//
// ─── إعادة الانضمام: الجهاز نفسه يُقبل بلا رسالة ولا أثر جانبي (2026-10-10 +03، إصلاح قبل نشر المحطّة ١) ──────────────────────────────────────────────
// قبل الإصلاح (مقيس بالمحاكي عند 5d62334): كلّ نداء ثانٍ لجلسة scanning يُرفض SESSION_ALREADY_JOINED بلا مقارنة المستدعي بـ`joinedBy` — فالجهاز الذي انضمّ يُرفض إن عاد
// من الإعدادات أو أعاد المسح. قرار المستخدم (2026-10-10، بنصّه): ««سبق الانضمام إلى هذه الجلسة»: يُعرض على جهاز آخر فقط. والجهاز المنضمّ نفسه إن أعاد الانضمام (عودة من
// الإعدادات، أو إعادة مسح) يُقبل بلا رسالة ولا أثر جانبي.» وجوابه على السؤالين: (١) «The app signs in anonymously before calling joinScanSession … The server accepts a re-join
// from the same uid without a message or side effect: no new joinedAt, no second notification to the owner, the same response.» (٢) «Accepted silently only while the session is
// «scanning» (returning from settings or re-scanning before the scan finishes). After completion: a separate reason code SESSION_COMPLETED with the current visible text …
// Cancelled and expired keep their current refusals.»
//   • المستدعي «الجهاز نفسه» = joinerUid غير غائب ويساوي `joinedBy` المخزَّن (isJoinedBy في sessionLifecycle.js، مصدر المقارنة الواحد مع الإلغاء). **joinerUid الغائب لا يطابق أبداً**
//     (القاعدة 22: الغياب ليس هوية): من ينضمّ بلا auth يُكتب joinedBy=null له، وإعادته (بلا auth أيضاً) تبقى SESSION_ALREADY_JOINED.
//   • الجهاز نفسه والجلسة scanning ⟵ نجاح بالشكل نفسه {sessionId, ownerId, status:"scanning", evaluationEnabled}، **بلا أيّ كتابة** على مستند الجلسة (لا joinedAt جديد ولا status ولا
//     غيرهما — updateTime لا يتغيّر) و**بلا إشعار FCM ثانٍ** للمالك. وثيقة المالك تُقرأ (للقيمة evaluationEnabled فقط)، فسطر evaluationEnabled القائم يُكتب كما لكلّ انضمام ناجح. **ولا كنس** (2026-10-16، قرار المستخدم بنصّه، منقول عن أمر المنسّق: «الكنس عند إعادة الانضمام: (ب) لا كنس. السطر الواحد مع اختباره.»): فلا استعلام كنس ولا كتابة على جلسات أخرى ولا سطر E34 (sweepAndLog) — الانضمام الأوّل يكنس كما كان؛ وكانت إعادة الانضمام في الشجرة تكنس من التزام S-SWEEP 2026-10-15 حتى 2026-10-16 (قرار تنفيذ أُبلغ، ولم يُنشر).
//     وسطر سجلّ مسمّى `[joinScanSession] rejoined seen=lookup|transaction session=#… owner=#… joiner=#…` (المعرّفات عبر hashIdForLog، ولا رمز الجلسة).
//   • **المرحلتان**: مرحلة البحث ترى الجلسة scanning بمنضمّها ⟵ seen=lookup؛ ومرحلة المعاملة ترى أنّها صارت scanning بين البحث والمعاملة بانضمام الجهاز نفسه (سباق ضغطتين) ⟵
//     seen=transaction. **والقبول في الحالتين يمرّ بالمعاملة** (قراءة طازجة، بلا كتابة): في الأولى يُسلَّم المرشَّح من البحث إلى المعاملة بدل أن يُقبل من لقطة الاستعلام وحدها.
//     وفي سباق ضغطتين متزامنتين على pending: واحدة تكتب الانضمام، والأخرى تقرأ scanning بالمنضمّ نفسه فتُقبل بلا كتابة — كلتاهما نجاح، وكتابة انضمام واحدة.
//   • **الجهاز نفسه والجلسة completed** ⟵ SESSION_COMPLETED برمز HttpsError ونصّه القائمين (not-found «الكود غير صالح أو منتهي الصلاحية»؛ وفي مرحلة المعاملة failed-precondition
//     «الجلسة ليست متاحة للانضمام» كما لسائر رفض تغيّر الحالة). **لا نصّ جديد يصل مستخدماً** (القرار ٩٠): نصّ SESSION_COMPLETED المعتمد يأتي مع نصف التطبيق.
//   • **الملغاة والمنتهية: رفضهما القائم بلا تغيير، للجهاز نفسه ولغيره.** وجهاز آخر (uid مختلف) على scanning أو completed ⟵ SESSION_ALREADY_JOINED كما كان.
//   • **انقضاء الوقت على إعادة الانضمام** (لم يرد في الأمر — يُبلَّغ في تقرير المهمّة): جلسة scanning انقضى expiresAt لها تُحكَم كما تُحكَم pending منقضية (قرار المستخدم ٢ في
//     sessionLifecycle.js: «تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها») ⟵ SESSION_EXPIRED بالنصّ القائم وتُكتب «منتهية»؛ وغياب expiresAt أو تلفه ⟵
//     SESSION_EXPIRES_AT_INVALID بلا كتابة (القاعدة 22). فلا يُقبل بصمتٍ جهازٌ في جلسة لا يقبل analyzeDevice منها شيئاً.

// ─── الرفض المبكّر لجلسة مالكها منتهٍ اشتراكه (S-SUB، 2026-10-16 +03، البند ٢) ──────────────────────────────────────────────────────────────────────────
// الأمر (بنصّه، من المنسّق، غير متحقَّق من هذا المستودع): «joinScanSession يرفض جلسةً مالكُها منتهٍ اشتراكه (SHOP_SUBSCRIPTION_EXPIRED)، قبل أن يقيس الفنّي ثماني دقائق. ورفض «بلا رصيد» عند الانضمام لم يُقرَّر.
// رفض استشاري لا يحجز شيئاً. بالحكم نفسه الذي تستعمله البوّابة (مصدر واحد). إعادة الانضمام (الجهاز نفسه وجلسته scanning) لا تُرفض بهذا الفحص. والكنس عند الانضمام كما هو.»
// قبل هذا: لا فحص لاشتراك المالك أصلاً عند الانضمام، فالفنّي يقيس ثماني دقائق ثم يُرفض في analyzeDevice (الجهاز الممسوح مجهول الهويّة فلا يستطيع التطبيق فحصاً مسبقاً).
//   • **متى:** في المعاملة، بعد فحص الجلسة نفسها (الحالة، ثم انقضاء الوقت — تُكتب «منتهية» كما كانت) وبعد عودة إعادة الانضمام، وقبل كتابة الانضمام. فالأسبقية: ما يخصّ الجلسة يسبق حكم المالك؛ وإعادة الانضمام
//     (الجهاز نفسه والجلسة scanning) تُقبل ولو انتهى اشتراك المالك بعد الانضمام الأوّل (الجلسة قائمة؛ وإن رفضتها analyzeDevice بعد ذلك فالرفض هناك). **لا كتابة** على الجلسة (لا status ولا joinedAt ولا joinedBy)، ولا FCM
//     للمالك، ولا كنس (يعود قبل نقطة الكنس كسائر الرفض) — فالرفض استشاري لا يترك أثراً، وبعد تجديد المالك ينضمّ الجهاز نفسه كأنّ شيئاً لم يكن.
//   • **الحكم:** isSubscriptionExpired(owner) نفسها التي يستعملها scanGateVerdict (scanRefusal.js) للبوّابة في analyzeDevice وردّ checkSubscription — مصدر «منتهٍ» الواحد (غياب expiresAt أو تلفه = لا انتهاء؛ وثيقة المالك الغائبة
//     لا يُحكم عليها هنا فتُترك للبوّابة). **ولا فحص رصيد:** «بلا رصيد» عند الانضمام لم يُقرَّر (يُقترح في تقرير المهمّة، لا يُنفَّذ). والحكم على الانتهاء وحده ولو كان الرصيد 0 (البوّابة هناك تحكم NO_CREDIT أوّلاً).
//   • **على السلك:** HttpsError("permission-denied", «انتهى اشتراكك، يرجى التجديد» — نصّ الانتهاء القائم نفسه، من scanRefusal.js، ولا نصّ جديد)، و`details.reasonCode` = SHOP_SUBSCRIPTION_EXPIRED (من SCAN_REFUSAL، لا من JOIN_REFUSAL: مصدر واحد
//     لرموز الجلسة SHOP_ في analyzeDevice وهنا). رمز الخطأ permission-denied وارد أصلاً في مسار الانضمام (SESSION_EXPIRES_AT_INVALID «جلسة الفحص غير صالحة»). **ما يعرضه تطبيق 1.0.14 لهذا الرفض غير متحقَّق من هذا المستودع**
//     (خارج حدودي: المستودع الآخر).
//   • **السطر:** على نسق `[joinScanSession] refused reason=… stage=… session=#… joiner=#…` القائم، ويُضاف ` owner=#…` (المالك مُهشَّر، ولا رمز جلسة ولا معرّف خامّ): stage=transaction.
//   • **وثيقة المالك** تُقرأ مرّة واحدة **قبل** المعاملة (كانت بعدها): للحكم أعلاه، ولإشعار FCM (الانضمام الأوّل) ولقيمة evaluationEnabled — عدد القراءات للانضمام الناجح كما كان (واحدة)، ويزيد واحدة لرفض مرحلة المعاملة.

/** نصوص الرفض القائمة قبل الدفعة ٩ حرفياً (joinScanSession.js عند 83d7750) — لا نصّ جديد يصل مستخدماً. */
const JOIN_TEXT = Object.freeze({
  INVALID_OR_EXPIRED: "الكود غير صالح أو منتهي الصلاحية", // 83d7750:26
  SESSION_MISSING: "الجلسة غير موجودة", // :39
  NOT_AVAILABLE: "الجلسة ليست متاحة للانضمام", // :43
  CODE_EXPIRED: "انتهت صلاحية الكود", // :48
});
const JOIN_STAGE = Object.freeze({LOOKUP: "lookup", TRANSACTION: "transaction"});

/**
 * رمز الخطأ ونصّه الظاهران لرفض مرحلة البحث (لا جلسة pending بالرمز). «رمز غير صالح» و«انضُمّ إليها» و«اكتملت» (الجهاز نفسه، SESSION_COMPLETED) و«ملغاة» والحالة غير المعروفة: not-found والنصّ القائم
 * (التمييز في details وحده)؛ و«منتهية»: النصّ والرمز القائمان للانتهاء.
 * @param {string} reason من JOIN_REFUSAL
 * @return {{code: string, message: string}}
 */
function lookupResponse(reason) {
  if (reason === J.EXPIRED) return {code: "deadline-exceeded", message: JOIN_TEXT.CODE_EXPIRED};
  return {code: "not-found", message: JOIN_TEXT.INVALID_OR_EXPIRED};
}

/**
 * مرحلة المعاملة: الحالة تغيّرت بين البحث والمعاملة (انضمّ آخر قبلنا، أو أُلغيت، أو سُجّلت منتهية). الرمز والنصّ القائمان لهذه الحالة كما كانا
 * («الجلسة ليست متاحة للانضمام» failed-precondition)، وللمنتهية نصّها القائم.
 * @param {string} reason من JOIN_REFUSAL
 * @return {{code: string, message: string}}
 */
function transactionStatusResponse(reason) {
  if (reason === J.EXPIRED) return {code: "deadline-exceeded", message: JOIN_TEXT.CODE_EXPIRED};
  return {code: "failed-precondition", message: JOIN_TEXT.NOT_AVAILABLE};
}

// أسباب JOIN_REFUSAL كلّها + SHOP_SUBSCRIPTION_EXPIRED من scanRefusal.js (الرفض المبكّر لاشتراك المالك)؛ ولا غيره من SCAN_REFUSAL («بلا رصيد» عند الانضمام لم يُقرَّر).
const JOIN_REASONS = new Set([...Object.values(J), SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED]);

/**
 * يسجّل سطر الرفض ثم يرمي — **موضع رمي رفض الجلسة الوحيد** (الآخر: «الكود مطلوب» قبل البحث؛ يحرسهما joinScanSessionGuard.test.js).
 * @param {string} reason من JOIN_REFUSAL
 * @param {{stage: string, code: string, message: string, sessionId?: ?string, joinerUid?: ?string, extra?: string}} ctx
 */
function refuse(reason, {stage, code, message, sessionId = null, joinerUid = null, extra = ""}) {
  if (!JOIN_REASONS.has(reason)) throw new Error(`joinScanSession: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[joinScanSession] refused reason=${reason} stage=${stage}` +
      (sessionId ? ` session=${hashIdForLog(sessionId)}` : "") + ` joiner=${hashIdForLog(joinerUid)}${extra}`);
  throw new HttpsError(code, message, {reasonCode: reason});
}

exports.joinScanSession = onCall(
    {timeoutSeconds: 10, memory: "256MiB"},
    async (request) => {
      // بدء النداء — منه totalMs في سطر الكنس E34 (يشمل الكنس نفسه، وهو آخر ما يُكتب قبل الإرجاع).
      const callStartMs = Date.now();
      const {code} = request.data || {};
      if (!code) {
        throw new HttpsError("invalid-argument", "الكود مطلوب");
      }

      // معرّف المنضم (لقواعد القراءة في Firestore Rules)
      const joinerUid = request.auth?.uid || null;

      // البحث عن الجلسة (خارج الـ transaction — الاستعلامات لا تعمل داخلها). بالرمز وحده (كان بالرمز وpending معاً) ثم تصفية الحالة هنا،
      // كي تُعرَف حالة الجلسة حين لا pending: الرمز فريد بين pending وقت الإنشاء فقط، فقد يحمله مستند تاريخي أو أكثر — pending أوّلاً، ثم الأحدث إنشاءً.
      const matchSnap = await db.collection("scanSessions")
          .where("code", "==", code.toUpperCase())
          .get();
      const entries = matchSnap.docs.map((d) => ({id: d.id, ref: d.ref, data: d.data()}));
      const pending = pickLatestSession(entries.filter((e) => e.data.status === SESSION_STATUS.PENDING));

      // الجلسة التي تُجرى عليها المعاملة: pending (انضمام أوّل)، أو — إن لم تكن pending — جلسة scanning انضمّ إليها هذا الجهاز نفسه (إعادة انضمام، انظر رأس الملفّ).
      // ما عدا ذلك يُرفض هنا بسببه المسمّى.
      let candidate = pending;
      if (candidate === null) {
        if (entries.length === 0) {
          refuse(J.CODE_INVALID, {stage: JOIN_STAGE.LOOKUP, joinerUid, ...lookupResponse(J.CODE_INVALID)});
        }
        const target = pickLatestSession(entries);
        const verdict = decideJoinForNonPending(target.data, joinerUid);
        if (verdict.decision === JOIN_DECISION.REFUSE) {
          const reason = verdict.reason;
          refuse(reason, {
            stage: JOIN_STAGE.LOOKUP, sessionId: target.id, joinerUid, ...lookupResponse(reason),
            extra: ` matches=${entries.length}` + (reason === J.STATUS_UNKNOWN ? ` statusState=${classifyStatus(target.data).state}` : ""),
          });
        }
        candidate = target; // JOIN_DECISION.REJOIN: الجهاز نفسه والجلسة scanning — تُتحقَّق في المعاملة (قراءة طازجة ثم الانقضاء)
      }
      // أين رُئيت الجلسة scanning بمنضمّها (للسجلّ وحده): في البحث، أم تغيّرت إليها بين البحث والمعاملة (سباق ضغطتين).
      const rejoinSeenAt = pending === null ? JOIN_STAGE.LOOKUP : JOIN_STAGE.TRANSACTION;

      const sessionRef = candidate.ref;
      const sessionId = candidate.id;

      // وثيقة المالك تُقرأ مرّة واحدة **قبل** المعاملة (S-SUB، رأس الملفّ): للرفض المبكّر لاشتراكه (أدناه، في المعاملة بعد فحص الجلسة نفسها وقبل كتابة الانضمام)، ولإشعار FCM (الانضمام الأوّل وحده)،
      // ولقيمة evaluationEnabled (الانضمام الأوّل وإعادته). كانت تُقرأ بعد المعاملة فكان الرفض لو وُجد يأتي بعد كتابة الانضمام.
      const ownerDoc = await db.collection("users").doc(candidate.data.ownerId).get();
      const owner = ownerDoc.exists ? ownerDoc.data() : null;

      // Transaction: قراءة + تحقق + تحديث ذرّياً (يمنع double-join). **تُرجِع قراراً ولا ترمي**: الرمي داخل المعاملة يُسقطها، فكتابة «منتهية» التي
      // قبله كانت تُلغى (انظر رأس الملفّ)؛ فتُرمى الأخطاء بعد إتمامها.
      const outcome = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(sessionRef);
        if (!fresh.exists) {
          return {refusal: {reason: J.CODE_INVALID, code: "not-found", message: JOIN_TEXT.SESSION_MISSING}};
        }
        const data = fresh.data();
        // الحالة تغيّرت عمّا رآه البحث، أو المرشَّح جلسة scanning لإعادة انضمام: القرار من القراءة الطازجة هذه. الجهاز نفسه والجلسة scanning ⟵ REJOIN (يُقبل بلا كتابة بعد فحص الانتهاء
        // أدناه)؛ وغيره رفض بسببه المسمّى (decideJoinForNonPending: جهاز آخر ⟵ ALREADY_JOINED، الجهاز نفسه بعد completed ⟵ COMPLETED، الملغاة والمنتهية كما كانتا).
        let rejoin = false;
        if (data.status !== SESSION_STATUS.PENDING) {
          const verdict = decideJoinForNonPending(data, joinerUid);
          if (verdict.decision === JOIN_DECISION.REFUSE) {
            const reason = verdict.reason;
            return {refusal: {
              reason, ...transactionStatusResponse(reason),
              extra: reason === J.STATUS_UNKNOWN ? ` statusState=${classifyStatus(data).state}` : "",
            }};
          }
          rejoin = true;
        }
        // الانتهاء: expiresAt من sessionTimeout.js (مصدر واحد للفحص والرمز) — الغياب/التلف حالة صريحة لا «صالحة» (القاعدة 22)، والانقضاء يُكتب «منتهية»
        // في المعاملة نفسها (قرار المستخدم ٢: «تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها»).
        const expiry = sessionExpiryRefusal(data);
        if (expiry !== null) {
          if (expiry.reason === SESSION_EXPIRY_REASON.EXPIRED) {
            tx.update(sessionRef, expiredWriteFields(admin.firestore.FieldValue));
            return {refusal: {reason: J.EXPIRED, code: "deadline-exceeded", message: JOIN_TEXT.CODE_EXPIRED, extra: " expiredRecorded=true"}};
          }
          return {refusal: {reason: J.EXPIRES_AT_INVALID, code: expiry.code, message: expiry.message}};
        }
        // إعادة الانضمام: لا كتابة إطلاقاً (لا joinedAt ولا status ولا joinedBy) — المنضمّ الأوّل وجلسته كما كانا. وهي لا تُرفض باشتراك المالك (رأس الملفّ: الجلسة قائمة).
        if (rejoin) return {session: data, rejoined: true};
        // الانضمام الأوّل وحده: جلسة مالكها منتهٍ اشتراكه ⟵ SHOP_SUBSCRIPTION_EXPIRED **قبل** كتابة الانضمام (رفض استشاري بلا أثر) — الحكم isSubscriptionExpired نفسها التي تحكم بها البوّابة،
        // والرمز والنصّ من scanRefusal.js (نصّ الانتهاء القائم). تُرجِع قراراً ولا ترمي (الرمي داخل المعاملة يُسقطها).
        if (isSubscriptionExpired(owner)) {
          const wire = scanRefusalWire(SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED);
          return {refusal: {reason: wire.reasonCode, code: wire.code, message: wire.message, extra: ` owner=${hashIdForLog(data.ownerId)}`}};
        }
        tx.update(sessionRef, {
          status: SESSION_STATUS.SCANNING,
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
          joinedBy: joinerUid,
        });
        return {session: data, rejoined: false};
      });
      if (outcome.refusal) {
        const {reason, code: refusalCode, message, extra} = outcome.refusal;
        refuse(reason, {stage: JOIN_STAGE.TRANSACTION, sessionId, joinerUid, code: refusalCode, message, extra});
      }
      const session = outcome.session;

      // وثيقة المالك (owner) قُرئت مرّة واحدة قبل المعاملة (أعلاه) — لإشعار FCM (الانضمام الأوّل وحده) ولقيمة evaluationEnabled (الانضمام الأوّل وإعادته).
      if (outcome.rejoined) {
        // إعادة انضمام: لا إشعار ثانٍ للمالك (الأوّل أُرسل عند الانضمام الأوّل) — سطر مسمّى بدله، بمعرّفات مُهشَّرة ولا رمز جلسة.
        console.log(`[joinScanSession] rejoined seen=${rejoinSeenAt} session=${hashIdForLog(sessionId)} owner=${hashIdForLog(session.ownerId)} joiner=${hashIdForLog(joinerUid)}`);
      } else if (owner?.fcmToken) {
        // إرسال FCM لصاحب المحل أن الجهاز ربط بنجاح
        try {
          await admin.messaging().send({
            token: owner.fcmToken,
            notification: {
              title: owner.language === "tr" ?
                "Cihaz bağlandı ✓" :
                "تم ربط الجهاز ✓",
              body: owner.language === "tr" ?
                "Tarama başlatılabilir" :
                "يمكن بدء الفحص الآن",
            },
            data: {
              type: "session_joined",
              sessionId: sessionId,
            },
          });
        } catch (e) {
          console.error("FCM to owner failed:", sanitizeFailureText(e));
        }
      } else {
        console.warn("joinScanSession — no fcmToken for owner", hashIdForLog(session.ownerId));
      }

      // evaluationEnabled — هل يعرض التطبيق شاشة تقييم الفنّي في هذه الجلسة؟
      //
      // يُكشف هنا تحديداً لأن joinScanSession هو النداء الوحيد الذي يجريه
      // الجهاز المفحوص قبل الفحص، فلا نضيف رحلة شبكة لسؤال عن علم واحد.
      // ووثيقة المالك مقروءة أصلاً أعلاه لأجل FCM → صفر قراءات إضافية.
      //
      // القيمة من حساب مالك الجلسة (ownerId) لا من المستدعي: المستدعي جهاز
      // الزبون بهوية مجهولة ولا وثيقة له. الافتراض false — الميزة تُمنَح
      // صراحةً ولا تُفتَح لكل المتاجر تلقائياً.
      //
      // V8 قبل النشر (2026-10-09 +03، قرار المستخدم): سطر سجلّ واحد لكل انضمام ناجح بالقيمة المُعادة وسببها المسمّى
      // (evaluationEnabledState.js — مصدر الحالات والقرار معاً؛ القيمة نفسها owner?.evaluationEnabled === true كما كانت).
      // المعرّفات الثلاثة (الجلسة والمالك والمنضمّ) عبر hashIdForLog — الغائب يُكتب «missing» لا تهشيراً للفراغ (القاعدة 22) —
      // ولا رمز الجلسة (code) ولا معرّف خامّ. الردّ إلى التطبيق لا يتغيّر: القيمة وحدها.
      const decision = evaluationEnabledDecision(owner);
      console.log(`[joinScanSession] evaluationEnabled=${decision.value} reason=${decision.reason}` +
          (decision.valueType ? ` valueType=${decision.valueType}` : "") +
          ` session=${hashIdForLog(sessionId)} owner=${hashIdForLog(session.ownerId)} joiner=${hashIdForLog(joinerUid)}`);
      // consentEnabled (ق15، 2026-10-23، قرار حسن 2026-10-22: «جزء consent للمحلّ يتحكّم بظهور شاشة الموافقة، والخادم يرفض التسجيل لمحلّ بلا الجزء»): هل جزء الموافقة مفعَّل لمحلّ مالك الجلسة؟
      // يعرفه الجهاز المفحوص من هذا الردّ قبل أن يعرض الشاشة (كان عند تطبيق المالك وحده، من createScanSession). إضافة على الردّ لا تغيّر ما قبلها، على نمط evaluationEnabled تماماً:
      // مستند المالك مقروء أصلاً أعلاه (صفر قراءات إضافية)، والقيمة منطقية دائماً (الغياب يُعلَن بسببه المسمّى في سطر السجلّ لا false مسدوداً، القاعدة 22)، والقيمة من المالك لا من المنضمّ، وتُقرأ عند كل نداء
      // (الانضمام الأوّل وإعادته) فلا تُخزَّن في الجلسة. الحكم مصدره consentPartState.js وحده — وهو نفسه الذي يرفض به recordScanConsent (CONSENT_PART_NOT_ENABLED): ما يراه الجهاز هو ما سيحكم به الخادم.
      const consentDecision = consentPartDecision(owner);
      console.log(`[joinScanSession] consentEnabled=${consentDecision.value} reason=${consentDecision.reason}` +
          (consentDecision.valueType ? ` valueType=${consentDecision.valueType}` : "") +
          ` session=${hashIdForLog(sessionId)} owner=${hashIdForLog(session.ownerId)} joiner=${hashIdForLog(joinerUid)}`);
      // الكنس الآمن (S-SWEEP، 2026-10-15 +03، docs/PROTOCOL_CONTRACT.md §٦-ج): الانضمام **الأوّل** يكنس جلسات الجهاز المنضمّ (joinedBy == joinerUid) المنقضية الجارية فتُكتب «منتهية».
      // **joinerUid null أو غائب ⟵ لا كنس ولا استعلام** (joinedBy == null يطال جلسات غير الفاعل): السطر يُكتب بحالة NOT_RUN_NO_KEY. الجلسة المنضمّ إليها مُستثناة (تحكمها معاملتها).
      // هذه النقطة بعد رفض الجلسة وبعد معاملة الانضمام وإشعار المالك: المرفوض قبلها لا سطر كنس له، ولا يتأخّر إشعار المالك بالكنس. أفضل جهد: لا يرمي ولا يغيّر الردّ، وميزانيته 3 ث.
      // **إعادة انضمام الجهاز نفسه لا تكنس ولا تكتب سطر E34** (قرار المستخدم 2026-10-16، بنصّه: «الكنس عند إعادة الانضمام: (ب) لا كنس. السطر الواحد مع اختباره.»): تُقبل بلا كتابة ولا إشعار ثانٍ،
      // وهذا الشرط على outcome.rejoined هو «السطر الواحد». نقطة الكنس تبقى واحدة (sweepExpiredSessions.test.js ١٣)؛ ويحرس الشرطَ joinScanSessionGuard.test.js §٥ وsweepOnCreateJoin.e2e.test.js المشهد ٥.
      if (!outcome.rejoined) {
        await sweepAndLog({
          db, FieldValue: admin.firestore.FieldValue, from: SWEEP_CALLER.JOIN_SCAN_SESSION,
          uid: joinerUid, excludeSessionId: sessionId, callStartMs,
        });
      }
      return {
        sessionId: sessionId,
        ownerId: session.ownerId,
        status: SESSION_STATUS.SCANNING,
        evaluationEnabled: decision.value,
        consentEnabled: consentDecision.value, // ق15: إضافة (2026-10-23) — راجع PROTOCOL_CONTRACT A8
      };
    },
);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.JOIN_TEXT = JOIN_TEXT;
exports.JOIN_STAGE = JOIN_STAGE;
exports.lookupResponse = lookupResponse;
exports.transactionStatusResponse = transactionStatusResponse;
exports.refuse = refuse;

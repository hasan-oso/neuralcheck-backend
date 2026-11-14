const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {isSubscriptionExpired} = require("../utils/subscription");
const {sanitizeFailureText} = require("../utils/failureText");
const {hashIdForLog} = require("../utils/logRedaction");
const {SCAN_REFUSAL, SCAN_REFUSAL_CODE, scanRefusalWire} = require("../analysis/scanRefusal");
const {SESSION_STATUS, SWEEP_CALLER, CREATE_SESSION_REFUSAL} = require("./sessionNames");
const {isSessionOwnerPlan, sessionOwnerPlanState} = require("../utils/plans");
const {sweepAndLog} = require("./sweepExpiredSessions");
const {readProtocolParts, decidePurposeAtCreation} = require("../protocol/scanProtocolDocument");
const {PROTOCOL_COLLECTION} = require("../protocol/protocolVocabulary");
const {readProtocolSettings} = require("../protocol/protocolSettings");
const {buildDoubleEvalDraw, DOUBLE_EVAL_DRAW_FIELD} = require("../protocol/doubleEval");

// ===================================================
// Cloud Function: createScanSession (callable)
// صاحب المحل يولّد جلسة فحص بكود قصير — صالحة ساعة واحدة من إنشائها،
// للانضمام والتحليل والتقييم معاً.
// ===================================================
//
// ⚠️ قرار مستخدم 2026-09-30 +03 («قرار — مهلة الجلسة ساعة») يحلّ محلّ
// المهلتين المنفصلتين السابقتين (15 دقيقة للانضمام، ثم — لفترة وجيزة في
// fbcc74c — 60 دقيقة أخرى من الانضمام للتحليل). واقعة حقيقية مقيسة لا
// مستنتَجة، بنصّ المستخدم: "الفحص في الجلسة اكتمل، لكني تأخّرت في الضغط
// على زرّ الإرسال، فانتهت الجلسة، ولم يعد تقرير. فمهلة الـ15 دقيقة تُضيّع
// فحص الزبون كاملاً." نافذة واحدة الآن: 60 دقيقة من `createdAt` هنا، مخزَّنة
// في `expiresAt` — وكل قارئ لها (joinScanSession.js:43-46،
// sessionTimeout.js عبر analyzeDevice.js/submitEvaluation.js،
// checkExpiringSubscriptions.js:187-195) يقرأ الحقل نفسه بلا تعديل، فسرى
// عليه التغيير تلقائياً (أقلّ تغيير ممكن، بنصّ المستخدم وحكم المدقّق).
//
// SESSION_VALIDITY_MINUTES مصدر واحد (القاعدة 24) للرقم — يُستعمَل أدناه
// في expiresAt وexpiresInMinutes معاً، فلا ينجرفان عن بعضهما كما وقع سابقاً
// (fbcc74c نقل التحقّق إلى ملفّ آخر بالخطأ فانفصل الرقمان — هذه المرّة
// الرقم في مكان واحد فقط، الكاتب الوحيد لـexpiresAt).
const SESSION_VALIDITY_MINUTES = 60;

// ─── رسالة الخطأ الداخلي الثابتة (أمر مستخدم 2026-09-30 +03) ───────────────
// كانت `:76` (قبل هذا الإصلاح) تطبع `error.message || String(error)` خاماً
// إلى العميل — أيّ نصّ خطأ من Firestore/الشبكة قد يحمل جزءاً من مسار داخلي
// أو معرّف (القاعدة 36). **النصّ العربي التالي جديد — لا نصّ قائم يطابق
// معنى "خطأ داخلي غير متوقَّع" في هذا الملفّ** (الرسائل الأخرى كلّها
// أسباب رفض محدَّدة: "لا يوجد رصيد"، "انتهى اشتراكك"، إلخ)، فاقترحته هنا
// بأسلوب الملفّ نفسه ("تعذّر توليد كود فريد" — نفس صيغة "تعذّر X"):
const CREATE_SESSION_INTERNAL_ERROR_MESSAGE = "تعذّر إنشاء جلسة الفحص، حاول مرة أخرى";
// رمز السبب في details — للتشخيص (سجلّات/دعم فنّي)، لا للعرض. **للعلم
// (نصّ المدقّق)**: التطبيق يعرض `session_error_generic` دائماً بصرف النظر
// عن نصّ الرسالة أو details (ViewModels.kt:2348-2351) — لم أمسّ التطبيق.
const CREATE_SESSION_INTERNAL_ERROR_REASON_CODE = "CREATE_SESSION_INTERNAL_ERROR";
// نصّ «لا رصيد» الخاصّ بهذا النداء (المالك نفسه المستدعي) — كما كان حرفياً، بلا الجملة الثانية في SCAN_REFUSAL_TEXT.NO_CREDIT. قرار المستخدم ٤ (A-SUB، 2026-10-17، بنصّه عن أمر المنسّق: «لا يُوحَّد نصّ NO_CREDIT في createScanSession.js:82 مع SCAN_REFUSAL_TEXT»): لا يتغيّر ما يراه 1.0.14.
const CREATE_SESSION_NO_CREDIT_TEXT = "لا يوجد رصيد فحوصات";

// نصّ رفض «الباقة لا تسمح بإنشاء جلسة» (A-SUB، البند ١، 2026-10-17): نصّ عربي **جديد محايد** — لا نصّ قائم بهذا المعنى (النصّان القائمان: الرصيد والانتهاء). لا يذكر اسم باقة.
// تطبيق 1.0.14 لا يقرأ reasonCode للإنشاء ويعرض النصّ العام (منقول، غير متحقَّق من هذا المستودع)، فلا نصّ جديد يظهر للمستخدم اليوم.
const CREATE_SESSION_PLAN_REQUIRED_TEXT = "هذه الميزة غير متاحة في باقتك الحالية";

/**
 * يلفّ خطأً غير متوقَّع (ليس HttpsError) في رسالة عربية ثابتة + رمز سبب في
 * details — القاعدة 36 (لا نصّ خامّ يصل العميل). دالّة خالصة قابلة
 * للاختبار بلا Firestore/onCall.
 * @param {*} error الخطأ الخام كما وصل catch
 * @return {{sanitizedForLog: string, httpsError: HttpsError}}
 */
function wrapUnexpectedCreateSessionError(error) {
  // القاعدة 36: المنقّي الواحد (مفاتيح + مسارات المستندات ومعرّفاتها + الرموز الطويلة)، لا تنقية المفاتيح وحدها.
  const sanitizedForLog = sanitizeFailureText(error);
  const httpsError = new HttpsError("internal", CREATE_SESSION_INTERNAL_ERROR_MESSAGE,
      {reasonCode: CREATE_SESSION_INTERNAL_ERROR_REASON_CODE});
  return {sanitizedForLog, httpsError};
}

exports.createScanSession = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      // بدء النداء — منه totalMs في سطر الكنس E34 (يشمل الكنس نفسه، وهو آخر ما يُكتب قبل الإرجاع).
      const callStartMs = Date.now();
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
        }
        const userId = request.auth.uid;
        console.log("1 - Start createScanSession, userId:", hashIdForLog(userId));

        // التحقق من الرصيد
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : null;
        // V8 الدفعة ١ (الخصوصية، 2026-10-08 +03): كان هنا JSON.stringify(userData)
        // — مستند users/{uid} كاملاً (بريد، رمز FCM، …) في السجلّ. ما بقي هو الواقعة
        // الوحيدة التي لا تأتي من محتوى المستند: هل هو موجود؟ أمّا الرصيد والانتهاء
        // فرفضهما يُسجَّل في catch أدناه (error.code / error.message).
        console.log("2 - User doc exists:", userDoc.exists);
        if (!userData || (userData.scansRemaining || 0) <= 0) {
          // A-SUB الموجة الأولى (قرار المستخدم ٤، 2026-10-17): `details.reasonCode` = SHOP_NO_CREDIT (المالك نفسه المستدعي: رصيد المحلّ). **النصّ لا يتغيّر** (قرار المستخدم بنصّه: لا يُوحَّد مع SCAN_REFUSAL_TEXT.NO_CREDIT، فلا يتغيّر ما يراه 1.0.14)؛ فلا scanRefusalWire هنا (نصّها الطويل) بل الرمز والسبب من المصدر الواحد scanRefusal.js.
          throw new HttpsError(SCAN_REFUSAL_CODE, CREATE_SESSION_NO_CREDIT_TEXT, {reasonCode: SCAN_REFUSAL.SHOP_NO_CREDIT});
        }
        // فرض صلاحية الاشتراك الشهري: صاحب محل منتهٍ لا يُنشئ جلسة QR جديدة
        // (متّسق مع بوابة analyzeDevice). غياب expiresAt = لا انتهاء.
        // النصّ نفسه الذي كان هنا حرفياً (بلا تغيير على السلك: المستدعي هنا هو المالك نفسه فنصّه صحيح)، لكن من مصدره الواحد scanRefusal.js (القاعدة 24، S-SUB 2026-10-16) لا نسخة ثانية.
        // (قرار S-SUB «createScanSession يبقى نصّه كما هو» يبقى للنصّين؛ وأُضيف في A-SUB الموجة الأولى `details.reasonCode` وحده.) ورسالة الرصيد أعلاه نصّ آخر («لا يوجد رصيد فحوصات» بلا «يرجى شراء اشتراك») فليست نسخة منه.
        if (isSubscriptionExpired(userData)) {
          // A-SUB الموجة الأولى (قرار المستخدم ٤): الآن بـdetails.reasonCode = SHOP_SUBSCRIPTION_EXPIRED عبر scanRefusalWire كما يفعل joinScanSession؛ الرمز والنصّ على السلك كما كانا حرفياً.
          const expired = scanRefusalWire(SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED);
          throw new HttpsError(expired.code, expired.message, {reasonCode: expired.reasonCode});
        }

        // A-SUB البند ١ (قرار المنسّق 2026-10-17): «فحص جهاز آخر عبر كود» ميزة باقات المحلّ. كان الشرطان أعلاه (الرصيد، الانتهاء) الوحيدَين على حساب المالك، فمستخدم free/single برصيد ≥ 1 ينشئ جلسة
        // ويُفوتَر فحصها على رصيده خارج ميزة باقته. الفحص **بعد** الشرطين القائمين (فلا يتغيّر رفض قائم ولا نصّه). الحكم isSessionOwnerPlan يطابق دلالة الواجهة (basic أو pro دون اعتبار الأحرف) —
        // **لا isShop ولا normalizePlan** (isShop في checkSubscription.js:44 مساواة صارمة تُخرج professional، وهي باقة مالك ترى الزرّ؛ وnormalizePlan لا يحوّلها)؛ انظر utils/plans.js. السجلّ: السبب ومعرّف مُهشَّر وحالة الباقة، **لا قيمة الباقة الخام**.
        if (!isSessionOwnerPlan(userData.plan)) {
          console.warn(`[createScanSession] refused reason=${CREATE_SESSION_REFUSAL.SHOP_PLAN_REQUIRED} user=${hashIdForLog(userId)} planState=${sessionOwnerPlanState(userData.plan)}`);
          throw new HttpsError(SCAN_REFUSAL_CODE, CREATE_SESSION_PLAN_REQUIRED_TEXT, {reasonCode: CREATE_SESSION_REFUSAL.SHOP_PLAN_REQUIRED});
        }

        // توليد كود قصير فريد (NC-XXXXXX) — 6 أحرف/أرقام base36
        let code;
        let foundUnique = false;
        for (let attempts = 0; attempts < 10; attempts++) {
          code = "NC-" + Math.random().toString(36).substring(2, 8).toUpperCase();
          const existing = await db.collection("scanSessions")
              .where("code", "==", code)
              .where("status", "==", SESSION_STATUS.PENDING)
              .get();
          if (existing.empty) {
            foundUnique = true;
            break;
          }
        }
        if (!foundUnique) {
          throw new HttpsError("resource-exhausted", "تعذّر توليد كود فريد");
        }
        // [3] كان هنا `console.log("3 - Generated code:", code)` — رمز الجلسة (كود الانضمام) خامّاً في السجلّ. حُذف (2026-10-16): لا قارئ له في المستودع (git grep -F "Generated code" لا يجد غير السطر نفسه)، والرمز يدخله من يعرفه وفضاؤه 36^6 قابل للتعداد فلا يكفي تهشيره؛ ويرفض piiLogGuard أيّ طباعة له ولو مُهشَّراً (قاعدة session-code). ترقيم 1 و2 و4 و5 باقٍ كما هو. والسطر [4] أدناه صار يطبع hashIdForLog(ref.id) (كان ref.id خامّاً): مفتاح الربط بسطور joinScanSession وsweepExpiredSessions (`session=#…`).

        // إنشاء الجلسة — صالحة SESSION_VALIDITY_MINUTES (60) دقيقة من الآن
        // أمر مستخدم 2026-10-01 +03 ("قواعد قراءة الجلسات"، القرار الأصل):
        // ownerEmail حُذف من هنا — كان يصل كل من يقرأ المستند (أيّ حساب
        // مسجَّل، قبل تضييق firestore.rules:scanSessions)، ولا قارئ فعلي
        // له اليوم (الكاتب الوحيد كان هنا؛ export-session-evaluation-
        // readonly.js يسرد اسمه فقط ضمن sessionFieldsNotPrinted، لا يقرأ
        // قيمته). المستندات القديمة تبقى تحمله — تحميها قاعدة القراءة
        // الجديدة (مالك/منضمّ وحدهما)، لا حاجة لهجرة بيانات.
        // S-P6-03 (2026-10-18 +03): جزء الأغراض لهذا المحلّ («الغائب غير مفعَّل») والغرض الافتراضي ومصدره. docs/PROTOCOL_CONTRACT.md §٢ A2 وPLAN-06 §٢-ب-٣/٦: «تبقى الجلسة تُنشأ فوراً بـnormal/default… يقرؤها createScanSession من
        // مستند المالك الذي يقرؤه أصلاً ويعيدها في ردّه لتُرسم الرقائق». المصدر feature_disabled حين لا جزء (المحلّ بلا تفعيل الغرض) فيتميّز من «عادي» الافتراضي.
        const protocolParts = readProtocolParts(userData);
        const purposeDecision = decidePurposeAtCreation(protocolParts);
        const session = {
          code: code,
          ownerId: userId,
          // الدفعة ٩ (2026-10-10): pending → scanning → completed، وأيّ جارية تُلغى (cancelled، cancelScanSession) أو تُسجَّل منتهية (expired) عند أوّل مسّ بعد expiresAt.
          // المفردات من sessionNames.js (القاعدة 24).
          status: SESSION_STATUS.PENDING,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: new Date(Date.now() + SESSION_VALIDITY_MINUTES * 60 * 1000),
          scanId: null,
          deviceModel: null,
          // يقرؤه المالك والمنضمّ بالقواعد القائمة، ولا يكتبه العميل (A0 البند ٤). **الغرض وحده هنا**؛ مصدره في protocolPending (خادمي).
          purpose: purposeDecision.purpose,
        };

        // S-P6-10 (2026-10-21 +03): قرعة التقييم المزدوج «عند إنشاء الجلسة بنسبة doubleEvalRate، ويخزّن السحب» (PLAN-06 :1301؛ docs/PROTOCOL_CONTRACT.md A7). الإعدادات تُقرأ هنا بمعرّف المستند (كسائر قراءات الدالّة)؛ فشل قراءتها يُفشل الإنشاء
        // (لا قيمة مختلَقة: القاعدة 22). الأجزاء من protocolParts أعلاه (مستند المالك المقروء أصلاً). القرعة واحدة لكل جلسة تُنشأ؛ ردّ الإنشاء لا يحملها (يعلمها جهاز الفنّي من getTechnicianFormConfig).
        const doubleEvalDraw = buildDoubleEvalDraw({
          settings: await readProtocolSettings({db}),
          parts: protocolParts,
          random: Math.random,
          decidedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // الجلسة ومستند protocolPending (مصدر الغرض + سحب التقييم المزدوج) في دفعة ذرّية واحدة (لا جلسة بغرض بلا مصدره ولا بلا سحبها، ولا العكس). المعرّف يُولَّد قبل الكتابة (كما كان add) ويشترك فيه المستندان. protocolPending خادمي بلا match في القواعد (A0 البند ١).
        const ref = db.collection("scanSessions").doc();
        const batch = db.batch();
        batch.set(ref, session);
        batch.set(db.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(ref.id), {purposeSource: purposeDecision.purposeSource, [DOUBLE_EVAL_DRAW_FIELD]: doubleEvalDraw});
        await batch.commit();
        console.log("4 - Session saved:", hashIdForLog(ref.id));

        // الكنس الآمن (S-SWEEP، 2026-10-15 +03، docs/PROTOCOL_CONTRACT.md §٦-ج): إنشاء جلسة يكنس جلسات المالك (ownerId == uid) المنقضية الجارية فتُكتب «منتهية»؛
        // الجلسة الجديدة مُستثناة، والصالحة لا تُمسّ ولا تُلغى. أفضل جهد: لا يرمي ولا يغيّر الردّ، وميزانيته 10 ث (SWEEP_PLAN). سطر E34 يُكتب هنا مرّة واحدة بالضبط،
        // وهو آخر سطر يُكتب قبل الإرجاع (فيشمل totalMs الكنس). لا حذف (القاعدة 42) ولا فهرس جديد (القاعدة 43). الجلسة أُنشئت قبل الكنس، فالمالك يملك رمزه ولو فشل الكنس.
        console.log("5 - Returning session");
        await sweepAndLog({
          db, FieldValue: admin.firestore.FieldValue, from: SWEEP_CALLER.CREATE_SCAN_SESSION,
          uid: userId, excludeSessionId: ref.id, callStartMs,
        });
        return {
          sessionId: ref.id,
          code: code,
          expiresInMinutes: SESSION_VALIDITY_MINUTES,
          // لرسم الرقائق (A2: «createScanSession تعيد protocolParts في ردّها»): لكل جزء true/false؛ الغائب false («غير مفعَّل»، PLAN-06:788).
          protocolParts: protocolParts,
        };
      } catch (error) {
        // إعادة رمي HttpsError كما هي (unauthenticated/permission-denied) —
        // نصوصها ثابتة آمنة أصلاً، كتبها هذا الملفّ نفسه أعلاه.
        if (error instanceof HttpsError) {
          console.error("createScanSession FAILED (خطأ معروف):", error.code, error.message);
          throw error;
        }
        // خطأ غير متوقَّع (شبكة/Firestore/إلخ) — نصّه الخام قد يحمل جزءاً من
        // سرّ (القاعدة 36): لا يصل العميل أبداً، ولا يُطبَع خاماً حتى في
        // سجلّ الخادم.
        const {sanitizedForLog, httpsError} = wrapUnexpectedCreateSessionError(error);
        console.error("createScanSession FAILED (خطأ داخلي غير متوقَّع، سجلّ الخادم وحده):", sanitizedForLog);
        throw httpsError;
      }
    },
);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
module.exports.SESSION_VALIDITY_MINUTES = SESSION_VALIDITY_MINUTES;
module.exports.CREATE_SESSION_INTERNAL_ERROR_MESSAGE = CREATE_SESSION_INTERNAL_ERROR_MESSAGE;
module.exports.CREATE_SESSION_INTERNAL_ERROR_REASON_CODE = CREATE_SESSION_INTERNAL_ERROR_REASON_CODE;
module.exports.CREATE_SESSION_NO_CREDIT_TEXT = CREATE_SESSION_NO_CREDIT_TEXT;
module.exports.CREATE_SESSION_PLAN_REQUIRED_TEXT = CREATE_SESSION_PLAN_REQUIRED_TEXT;
module.exports.wrapUnexpectedCreateSessionError = wrapUnexpectedCreateSessionError;

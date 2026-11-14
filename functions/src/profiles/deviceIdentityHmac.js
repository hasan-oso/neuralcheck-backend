"use strict";

// ===================================================
// deviceIdentityHmac — الجزء الممكن على الخادم من S-P6-01 بلا السرّ: HMAC للمعرّف وحالة المفتاح الصريحة (2026-10-18 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١-ب-٣ (:360-371) وdocs/PROTOCOL_CONTRACT.md §٢ A1. قرار المستخدم (بنصّه، منقول عن PLAN-06:360، غير متحقَّق من هذا المستودع — القاعدة 29): «التطبيق يبقى يرسل SHA-256 بلا مفتاح،
// والخادم يطبّق HMAC بمفتاحه السرّي على ما يصله قبل أيّ تخزين.» والمفتاح: «سرّ في Secret Manager… لا يُدوَّر… ولا يُولَّد بيد وكيل: يولّده المستخدم وحده في طرفيّته، والكود يقرؤه باسمه… لا غير.» (PLAN-06:364-371، منقول).
//
// ما يفعله هذا الملفّ **وحده**:
//   (١) يقرأ المفتاح من **بيئة التشغيل** باسم السرّ `DEVICE_ID_HMAC_KEY` (E4، معتمد 2026-10-15) — لا من سطر أمر ولا من ملفّ ولا من Secret Manager مباشرةً (لا `gcloud secrets` ولا SDK).
//   (٢) **غياب المفتاح حالة صريحة** تظهر في أعلى النتيجة: `state = HMAC_KEY_UNAVAILABLE` (من IDENTITY_STATE) وسببها (القاعدة 22: لا قيمة افتراضية، ولا مفتاح فارغ يُقبل، ولا HMAC بمفتاح مُختلَق).
//   (٣) يحسب `HMAC(K, تجزئة التطبيق)` ويرجعه سداسياً صغيراً (hex). **ويرفض أن يحسب HMAC لقيمة حارسة** (`no_android_id` وأخواتها): فالحارس يتّفق عليه كل جهاز عجز عن قراءة معرّفه، وHMAC له معرّف واحد مشترك
//       بين أجهزة مختلفة — تصادم قطعي («واحتياطي sha256(MODEL) لا يُستعمل في المطابقة: تصادم قطعي»، PLAN-06:354) — والعقد يقول «ولا قيمة حارسة في حقل القيمة» (PLAN-06:421).
//   (٤) **لا يطبع ولا يعيد المفتاح ولا مُدخله** في أيّ موضع: المفتاح في إغلاق (closure) لا خاصّية، فلا يظهر في JSON.stringify ولا util.inspect، ولا يستعمل console إطلاقاً (القاعدة 36، وحارس سجلّ المعرّفات).
//
// ما **لا** يفعله (معلّق: بيد المستخدم، أو يحتاج قراراً ليس عندي — يُسرد بنصّه في docs/PROTOCOL_CONTRACT.md §٢ A1 «ما بُني في S-P6-01 وما عُلِّق»):
//   • لا يُنشئ السرّ ولا يقرؤه من Secret Manager ولا **يربطه بدالّة** (`secrets: [...]` في خيارات analyzeDevice): الربط قبل أن ينشئ المستخدم السرّ يُفشل النشر التالي (السرّ غير موجود).
//   • لا يُستدعى من مسار الإنتاج بعد: لا كتابة في deviceProfiles ولا reportRaw ولا scanProtocol ولا Storage (تغيير ما يُكتب يحتاج السرّ + قراءة المستخدم لـdeviceFingerprintSha للستّة + عقد التطبيق لشكل {value, state}).
//
// **الخوارزمية SHA-256 [اجتهاد]:** القرار يقول «HMAC» ولا يسمّي الدالّة؛ SHA-256 على نسق HMAC-SHA256 المسمّى للقطات (PROTOCOL_CONTRACT §P6-19) وتجزئة التطبيق نفسها SHA-256. **وترميز السرّ [اجتهاد]:** نصّ البيئة كما هو بترميز UTF-8
// (بلا فكّ hex ولا base64): كتلة حفظ المفتاح يكتبها المنسّق (HMAC-KEY-CUSTODY-STEPS-2026-10-09.md:22 و:27، «يكتبها المنسّق حين يحين وقتها») ولم تصلني؛ فإن اختارت ترميزاً غير النصّ المباشر عُدِّلت (٢) هنا وفي الاختبار (المتّجه RFC 4231 يثبّت النصّ المباشر).

const crypto = require("crypto");
const {IDENTITY_STATE} = require("../protocol/protocolVocabulary");
const {UNKNOWN_PRIMARY} = require("./deviceProfileKey"); // قيمة حارس الأساسي من مصدرها الوحيد (القاعدة 24، ويحرسه deviceProfileKey.test.js الكتلة ٤)

/** اسم السرّ (E4، معتمد 2026-10-15): على أسلوب الأسماء القائمة في utils/secrets.js. مصدر واحد في الكود (القاعدة 24). */
const HMAC_KEY_ENV_NAME = "DEVICE_ID_HMAC_KEY";
/** دالّة HMAC [اجتهاد: انظر الرأس]. */
const HMAC_ALGORITHM = "sha256";

/** سبب عدم توفّر المفتاح — **أسماء خادم داخلية** لا تُكتب على السلك ولا في مستند (القاعدة 22). */
const HMAC_KEY_UNAVAILABLE_REASON = Object.freeze({
  NOT_SET: "NOT_SET", // المتغيّر غير مضبوط (ولا مربوط بالدالّة)
  NOT_A_STRING: "NOT_A_STRING", // مضبوط بنوع غير نصّ
  EMPTY: "EMPTY", // نصّ فارغ أو فراغات وحدها
});

/** حالات نتيجة تطبيق HMAC على معرّف — **أسماء خادم داخلية**؛ ما يُكتب منها في `identityState` أو `identifiers.*.state` يُحسم مع عقد التطبيق (معلّق). */
const IDENTIFIER_HMAC_STATE = Object.freeze({
  COMPUTED: "COMPUTED",
  HMAC_KEY_UNAVAILABLE: IDENTITY_STATE.HMAC_KEY_UNAVAILABLE, // من مفردة البروتوكول نفسها، لا نسخة نصّية ثانية
  INPUT_MISSING: "INPUT_MISSING", // تجزئة التطبيق غائبة أو ليست نصّاً أو فارغة
  INPUT_IS_GUARD_VALUE: "INPUT_IS_GUARD_VALUE", // قيمة حارسة (التطبيق عجز عن حساب المعرّف)
});

/**
 * القيم الحارسة التي يكتبها التطبيق لطبقة عجز عن حسابها (المفاتيح هنا أسماء وصفية لا أسماء حقول المفتاح: قارئ حقول المفتاح الوحيد هو deviceProfileKey.js، ويحرس ذلك deviceProfileKey.test.js الكتلة ٤) (وتكتبها createDeviceProfile عند غيابها). مصدرها: findDeviceProfile.js (sentinel لكل مرحلة) وcreateDeviceProfile.js (قيم الحارس) وdeviceProfileKey.js (UNKNOWN_PRIMARY)،
 * ويثبّت اختبار deviceIdentityHmac.test.js أن كل قيمة هنا تظهر حرفياً في الملفّ الذي يقرؤها.
 */
const LAYER_GUARD_VALUES = Object.freeze({
  primary: UNKNOWN_PRIMARY,
  keystore: "no_keystore",
  firebaseId: "no_fid",
  androidId: "no_android_id",
  buildSig: "unknown",
  sensorSig: "no_sensors",
});
const GUARD_SET = new Set(Object.values(LAYER_GUARD_VALUES));

function unavailable(reason) {
  return Object.freeze({
    available: false,
    state: IDENTITY_STATE.HMAC_KEY_UNAVAILABLE,
    reason,
  });
}

/**
 * يقرأ المفتاح من البيئة ويعيد «حاسباً» لا يكشف المفتاح، أو حالة عدم توفّر صريحة.
 * @param {Object<string, *>} [env] بيئة التشغيل (الافتراضي process.env)؛ يمرَّر كائن في الاختبارات بمفتاح وهمي محلّي.
 * @return {{available: false, state: string, reason: string}|{available: true, hmacHex: function(string): string}}
 */
function getHmacHasher(env = process.env) {
  const raw = env === null || typeof env !== "object" ? undefined : env[HMAC_KEY_ENV_NAME];
  if (raw === undefined || raw === null) return unavailable(HMAC_KEY_UNAVAILABLE_REASON.NOT_SET);
  if (typeof raw !== "string") return unavailable(HMAC_KEY_UNAVAILABLE_REASON.NOT_A_STRING);
  if (raw.trim() === "") return unavailable(HMAC_KEY_UNAVAILABLE_REASON.EMPTY);
  const key = Buffer.from(raw, "utf8");
  // المفتاح في الإغلاق وحده: لا خاصّية عليه، فلا يُسلسَل ولا يُفحَص من الخارج
  return Object.freeze({
    available: true,
    hmacHex: (data) => crypto.createHmac(HMAC_ALGORITHM, key).update(data, "utf8").digest("hex"),
  });
}

/**
 * يطبّق HMAC على تجزئة التطبيق لمعرّف واحد، بحالة صريحة لكل مآل.
 * @param {{available: boolean, state?: string, reason?: string, hmacHex?: function}} hasher ناتج getHmacHasher
 * @param {*} appHash ما أرسله التطبيق (SHA-256 بلا مفتاح، نصّاً)
 * @return {{state: string, hmac: ?string, reason: ?string}} hmac سداسي صغير (64 محرفاً) حين COMPUTED وإلا null؛ reason للحالات غير COMPUTED
 */
function applyIdentifierHmac(hasher, appHash) {
  if (!hasher || hasher.available !== true) {
    return {state: IDENTIFIER_HMAC_STATE.HMAC_KEY_UNAVAILABLE, hmac: null, reason: hasher && typeof hasher.reason === "string" ? hasher.reason : HMAC_KEY_UNAVAILABLE_REASON.NOT_SET};
  }
  if (typeof appHash !== "string") return {state: IDENTIFIER_HMAC_STATE.INPUT_MISSING, hmac: null, reason: appHash === undefined || appHash === null ? "ABSENT" : "NOT_A_STRING"};
  if (appHash.trim() === "") return {state: IDENTIFIER_HMAC_STATE.INPUT_MISSING, hmac: null, reason: "EMPTY"};
  if (GUARD_SET.has(appHash)) return {state: IDENTIFIER_HMAC_STATE.INPUT_IS_GUARD_VALUE, hmac: null, reason: "GUARD_VALUE"};
  return {state: IDENTIFIER_HMAC_STATE.COMPUTED, hmac: hasher.hmacHex(appHash), reason: null};
}

module.exports = {
  HMAC_KEY_ENV_NAME, HMAC_ALGORITHM, HMAC_KEY_UNAVAILABLE_REASON, IDENTIFIER_HMAC_STATE, LAYER_GUARD_VALUES,
  getHmacHasher, applyIdentifierHmac,
};

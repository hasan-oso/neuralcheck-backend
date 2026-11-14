// ===================================================
// categories — المصدر الوحيد لقائمة الفئات المُقيَّمة + تطبيع أسمائها
// ===================================================
// كانت القائمة مكرّرة (13 فئة) في rebuildCategoryScores.js و
// languageValidator.js، وسقطت منها audio/input بعد أن أضافهما برومبت V6
// (commit 377a086). هذا الملف يوحّدها في 15 فئة ويقدّم:
//   • CATEGORIES            — القائمة الكاملة بترتيب العرض
//   • LEGACY_MANUAL_CATEGORY — testId → فئة للفحوص اليدوية القديمة التي
//                              تصل بلا categoryName (يطابق Step 6 في V6)
//   • normalizeCategory()   — يُرجع مفتاح الفئة الإنجليزي من قيمة قد تكون
//                              مُترجمة (عربي/تركي) أو مختلفة الحالة/المسافات
//   • manualCategoryFor()   — فئة فحص يدوي: categoryName من التطبيق أولاً،
//                              ثم الخريطة القديمة
//
// ملاحظة: computeScanSignature.js يحمل نسخته الخاصة من الـ13 عن قصد —
// تغييرها يغيّر توقيع الفحص ويُبطل الكاش، وهو خارج نطاق هذا الإصلاح.
// ===================================================

const CATEGORIES = [
  "battery", "thermal", "cpu", "gpu", "display",
  "memory", "storage", "camera", "gps", "security",
  "sensors", "cellular", "wireless",
  "audio", "input",
];

const CATEGORY_SET = new Set(CATEGORIES);

// أسماء الفئات الخمس عشرة بالعربية/التركية — **نُقلت إلى هنا من
// systemPromptV7.js** (أمر مستخدم 2026-10-01 +03، S2: "أسماء الفئات
// بالعربية من مصدر واحد قائم إن وُجد... اذكر المصدر، ولا تنشئ جدولاً
// ثانياً"). كانت مُعرَّفة في systemPromptV7.js وحده؛ categoryStates.js
// احتاجها الآن أيضاً (عناوين issues[].title، S2) — واستيرادها مباشرة من
// systemPromptV7.js كان سيُنتج استيراداً دائرياً (systemPromptV7.js يستورد
// CATEGORY_STATE_VALUES من categoryStates.js أصلاً)، فنُقل المصدر إلى هذا
// الملفّ الطرفي (لا يستورد من أي ملفّ آخر في هذا المستودع) — القاعدة 24:
// مصدر واحد مُصدَّر، لا نسخة. systemPromptV7.js يستوردهما من هنا الآن
// ويُعيد تصديرهما بلا تغيير (test/systemPromptV7.test.js غير مُعدَّل).
//
// gps: 'الموقع (GPS)' — S5 (أمر مستخدم 2026-10-01 +03، البند الأخير):
// "الفئة تُسمّى «الموقع (GPS)»" — كانت 'نظام تحديد المواقع'. GPS استثناء
// لاتيني صريح لهذا الاسم تحديداً (بنصّ المستخدم)، لا اللائحة اللاتينية
// العامّة.
//
// ⚠️ **تصحيح المنسّق 2026-10-01 +03 (قرار «أسماء الفئات»، بنصّه) — نسخة من
// قائمة واحدة مرجعها ذلك الأمر، لا تُعدَّل هنا باجتهاد محلّي**: القائمتان
// أدناه (عربي وتركي) اعتُمدتا معاً كاملتين — خمس قيم عربية وأربع تركية كانت
// مختلفة هنا عن القرار قبل هذا التصحيح (storage/thermal/memory/gpu/input
// بالعربية؛ thermal/storage/gps/input بالتركية) — راجع تقرير المهمّة لجدول
// المقارنة الكامل قبل/بعد. التطبيق والموقع وعناوين الخادم (categoryStates.js
// issues[].title) وتعليمات النموذج (systemPromptV7.js) تأخذ الأسماء من هذه
// القائمة، كلٌّ في مستودعه.
const CATEGORY_NAME_AR = Object.freeze({
  battery: 'البطارية', thermal: 'الحرارة', cpu: 'المعالج',
  gpu: 'معالج الرسومات', display: 'الشاشة', memory: 'الذاكرة',
  storage: 'التخزين', camera: 'الكاميرا', gps: 'الموقع (GPS)',
  security: 'الأمان', sensors: 'المستشعرات', cellular: 'الشبكة الخلوية',
  wireless: 'الاتصال اللاسلكي', audio: 'الصوت', input: 'اللمس والأزرار',
});

const CATEGORY_NAME_TR = Object.freeze({
  battery: 'Pil', thermal: 'Isı', cpu: 'İşlemci',
  gpu: 'Grafik İşlemci', display: 'Ekran', memory: 'Bellek',
  storage: 'Depolama', camera: 'Kamera', gps: 'Konum (GPS)',
  security: 'Güvenlik', sensors: 'Sensörler', cellular: 'Hücresel Ağ',
  wireless: 'Kablosuz Bağlantı', audio: 'Ses', input: 'Dokunma ve Tuşlar',
});

// الفحوص اليدوية بلا categoryName (فحوص قديمة قبل rebucketing التطبيق).
// المصدر: systemPromptV6 — Step 6 (display/audio/input/sensors/camera/security).
// M-07 متقاعد في التطبيق، M-13 وM-16 غير موجودين.
const LEGACY_MANUAL_CATEGORY = {
  "M-01": "display", "M-02": "display", "M-03": "display",
  "M-04": "audio", "M-05": "audio", "M-06": "audio", "M-07": "audio", "M-08": "audio",
  "M-09": "input", "M-10": "input", "M-11": "input",
  "M-12": "sensors", "M-14": "sensors", "M-15": "sensors", "M-22": "sensors",
  "M-17": "camera", "M-18": "camera", "M-19": "camera",
  "M-20": "security", "M-21": "security",
};

// مرادفات مُترجمة/شائعة → مفتاح إنجليزي. النموذج مُطالَب بترجمة "كل كلمة
// إنجليزية" في البرومبت، وقد يطبّق ذلك على قيمة issues[].category فتنكسر
// المطابقة الحرفية. التطبيع يقبل: اختلاف الحالة، مسافات/شرطات، الجمع
// الإنجليزي، والأسماء العربية/التركية المستخدمة في fixLeaksLocally وجدول
// الترجمة في البرومبت.
const CATEGORY_ALIASES = {
  // battery
  "batt": "battery", "البطارية": "battery", "بطارية": "battery",
  "pil": "battery", "batarya": "battery",
  // thermal
  "temperature": "thermal", "heat": "thermal", "الحرارة": "thermal",
  "حراري": "thermal", "الحراري": "thermal", "الإدارة الحرارية": "thermal",
  "ısı": "thermal", "termal": "thermal", "sıcaklık": "thermal",
  // cpu
  "processor": "cpu", "المعالج": "cpu", "معالج": "cpu", "işlemci": "cpu",
  // gpu
  "graphics": "gpu", "معالج الرسوميات": "gpu", "الرسوميات": "gpu",
  "رسوميات": "gpu", "grafik": "gpu", "grafik işlemcisi": "gpu",
  // display
  "screen": "display", "الشاشة": "display", "شاشة": "display",
  "ekran": "display",
  // memory
  "ram": "memory", "الذاكرة": "memory", "ذاكرة": "memory",
  "الذاكرة العشوائية": "memory", "bellek": "memory",
  // storage
  "disk": "storage", "التخزين": "storage", "تخزين": "storage",
  "التخزين الداخلي": "storage", "depolama": "storage",
  // camera
  "cameras": "camera", "الكاميرا": "camera", "كاميرا": "camera",
  "kamera": "camera",
  // gps
  "location": "gps", "الموقع": "gps", "تحديد الموقع": "gps", "konum": "gps",
  // security
  "الأمان": "security", "أمان": "security", "الأمن": "security",
  "الحماية": "security", "güvenlik": "security",
  // sensors
  "sensor": "sensors", "المستشعرات": "sensors", "مستشعرات": "sensors",
  "الحساسات": "sensors", "sensörler": "sensors", "sensör": "sensors",
  // cellular
  "network": "cellular", "mobile": "cellular", "الشبكة": "cellular",
  "الشبكة الخلوية": "cellular", "خلوي": "cellular", "hücresel": "cellular",
  // wireless
  "wifi": "wireless", "wi fi": "wireless", "bluetooth": "wireless",
  "اللاسلكي": "wireless", "لاسلكي": "wireless", "الاتصال اللاسلكي": "wireless",
  "kablosuz": "wireless",
  // audio
  "sound": "audio", "speaker": "audio", "speakers": "audio",
  "الصوت": "audio", "صوت": "audio", "السماعات": "audio", "ses": "audio",
  // input
  "buttons": "input", "button": "input", "keys": "input",
  "الأزرار": "input", "أزرار": "input", "الإدخال": "input", "إدخال": "input",
  "tuşlar": "input", "düğmeler": "input", "giriş": "input",
};

// تنظيف نصّي مشترك: حالة صغيرة، إزالة "ال" التعريف لا تُطبَّق (المرادفات
// تغطي الشكلين)، توحيد الفواصل، وإزالة الفراغات الطرفية.
function canon(value) {
  return String(value)
      .trim()
      .toLowerCase()
      .replace(/[_\-]+/g, " ")
      .replace(/\s+/g, " ");
}

// يُرجع مفتاح الفئة الإنجليزي أو null إن لم يُعرف.
function normalizeCategory(value) {
  if (typeof value !== "string") return null;
  const c = canon(value);
  if (!c) return null;
  if (CATEGORY_SET.has(c)) return c;
  if (CATEGORY_ALIASES[c]) return CATEGORY_ALIASES[c];
  // "wireless network" / "cpu performance" ... → أول كلمة تُطابق فئة أو مرادفاً
  for (const tok of c.split(" ")) {
    if (CATEGORY_SET.has(tok)) return tok;
    if (CATEGORY_ALIASES[tok]) return CATEGORY_ALIASES[tok];
  }
  return null;
}

// فئة فحص يدوي: categoryName من التطبيق (مُطبَّع) أولاً، ثم الخريطة القديمة.
function manualCategoryFor(entry) {
  if (!entry || typeof entry !== "object") return null;
  const fromApp = normalizeCategory(entry.categoryName);
  if (fromApp) return fromApp;
  const id = typeof entry.testId === "string" ? entry.testId.trim().toUpperCase() : "";
  return LEGACY_MANUAL_CATEGORY[id] || null;
}

module.exports = {
  CATEGORIES,
  LEGACY_MANUAL_CATEGORY,
  CATEGORY_ALIASES,
  CATEGORY_NAME_AR,
  CATEGORY_NAME_TR,
  normalizeCategory,
  manualCategoryFor,
};

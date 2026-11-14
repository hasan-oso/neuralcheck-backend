'use strict';

// allowedLatin.js — مصدر واحد مُصدَّر (القاعدة 24) للاتيني المسموح في نصّ المشتري في V7. لا نسخة له في أيّ ملفّ آخر.
//
// قرار مستخدم 2026-10-07 +03 (بنصّه): «القائمة: NeuralCheck، والحروف A وB وC وD، وQR، وUSB، وWi-Fi، وBluetooth، وNFC، وGPS، وVulkan، وOpenGL.
// ومعها، كما هو اليوم، أسماء الأجهزة والشرائح والعلامات والوحدات الواردة في بيانات الجهاز. يقرؤها من الملفّ نفسه: التعليمات، وحارس اللغة،
// وسكربت فحص S5 (بدل ALLOWED_LATIN_BARE).»
//
// يستورده:
//   • prompts/systemPromptV7.js — جملة اللاتيني المسموح تُبنى من المجموعات أدناه بترتيبها.
//   • analysis/reportShapeV7.js — حارس اللغة V7 (فئة الاستثناء 'allowed_latin' في buildLeakExemptionIndex).
//   • scripts/check-s5-narrative-rules.js — قائمة اللاتيني المسموح (كانت ALLOWED_LATIN_BARE).
// لا يستورده languageValidator.js: ذاك مشترك مع مسار V6 (callAI.js) ولم يشمله القرار.
//
// «ومعها أسماء الأجهزة والشرائح والعلامات والوحدات الواردة في بيانات الجهاز»: ليست هنا — تُشتقّ من بيانات الجهاز في الحارس (device_spec/
// platform_identifier/measurement_unit/findings_field_name/gate_name) ومن UNIT_LEAK_TOKENS (رموز الوحدات الثابتة) كما كانت.
// إضافة اسم هنا تُغيّر الحارس والتعليمات والسكربت معاً؛ ولا يُضاف اسم إلا بقرار مستخدم صريح.

// المجموعات بترتيب القرار: NeuralCheck، A B C D، QR USB Wi-Fi Bluetooth NFC، GPS Vulkan OpenGL. التقسيم إلى مجموعات لصياغة جملة التعليمات
// وحدها (كل مجموعة تحمل عنوانها الحالي في الجملة)؛ والقائمة المسطّحة أدناه هي القرار بترتيبه.
const ALLOWED_LATIN = Object.freeze({
  productName: Object.freeze(['NeuralCheck']),
  gradeLetters: Object.freeze(['A', 'B', 'C', 'D']),
  communicationSymbols: Object.freeze(['QR', 'USB', 'Wi-Fi', 'Bluetooth', 'NFC']),
  interfaceNames: Object.freeze(['GPS', 'Vulkan', 'OpenGL']),
});

/** القائمة المسطّحة بترتيب القرار حرفياً. */
const ALLOWED_LATIN_LIST = Object.freeze([
  ...ALLOWED_LATIN.productName, ...ALLOWED_LATIN.gradeLetters, ...ALLOWED_LATIN.communicationSymbols, ...ALLOWED_LATIN.interfaceNames,
]);

/**
 * التوكِنز (lowercase) كما يقسّمها قارئاها: الحارس وسكربت S5 كلاهما يقسّم النصّ على غير الحرف والرقم، فـ«Wi-Fi» توكِنان wi وfi
 * (وكلّ توكِن بحرف واحد — A وB وC وD — لا يستخرجه الحارس أصلاً: يشترط حرفين فأكثر؛ ويستخرجه السكربت). المقارنة بلا اعتبار لحالة الأحرف.
 */
const ALLOWED_LATIN_TOKENS = Object.freeze([
  ...new Set(ALLOWED_LATIN_LIST.flatMap((e) => e.match(/[A-Za-z0-9]+/g) || []).map((t) => t.toLowerCase())),
]);

module.exports = {ALLOWED_LATIN, ALLOWED_LATIN_LIST, ALLOWED_LATIN_TOKENS};

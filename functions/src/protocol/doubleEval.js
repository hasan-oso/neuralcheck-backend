"use strict";

// ===================================================
// doubleEval — قرعة التقييم المزدوج عند إنشاء الجلسة (S-P6-10، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٠-ب-٦ (:1300-1309) وdocs/PROTOCOL_CONTRACT.md §٢ A7:
//   «٦. التقييم المزدوج (القرار ٤): الخادم يختار عند إنشاء الجلسة بنسبة `doubleEvalRate`، ويخزّن السحب. والاستمارة الثانية `slot: 2`: يرفضها الخادم إن كان `technicianId` هو الأوّل (رفض مسمّى). ولا يُعيد الخادم
//   استمارةً لأيّ عميل ... وهويّة الفنّي: قائمة أسماء من المشرف، يُختار منها بلمسة.»
//   و`protocolPending/{sessionId}.doubleEvalDraw {selected, draw, rate, settingsVersion, decidedAt}` «حقل السحب على نسق `repeat`» (A7، E9 معتمد 2026-10-15).
//   و«إعدادات غائبة ⇐ SETTINGS_ABSENT. والخادم لا يختار تكراراً ولا تقييماً مزدوجاً حينها، ويكتب السبب. لا يُفترض 10%.» (P:893).
// **دالّة نقيّة بلا I/O** (القاعدة 41)؛ القرار نفسه في protocolSelection.decideSelection (مصدر واحد مع التكرار: القاعدة 24).
// **اسم الحقل في protocolPending مصدر واحد مصدَّر** (DOUBLE_EVAL_DRAW_FIELD: القاعدة 24): الكاتب (createScanSession) والقارئ (technicianForm.doubleEvalState) يستوردانه، فلا حرفيّة ثانية في src.
//
// الشكل: `{selected, reason, draw, rate, settingsVersion, decidedAt}` — المفاتيح الخمسة المعتمدة (E9) **ومعها `reason`** (اقتراحي، على سابقة `repeat.reason` المعتمدة E8: «ويكتب السبب»، P:893): `reason` نصّ من REPEAT_NOT_ELIGIBLE_REASON
// حين لا قرعة (إعدادات غائبة · الجزء `doubleEval` غير مفعَّل · نسبة غائبة/خارج المدى) وإلا `null`؛ و`draw` و`rate` `null` حين لا قرعة (لا صفراً يشبه سحباً: القاعدة 22). `selected` منطقي دائماً (يقرؤه technicianForm.doubleEvalState: «selected: boolean»).
// الاختيار `selected: true` إن اجتيزت كل الشروط وكان `draw < rate`.

const {PROTOCOL_PART, REPEAT_STATE} = require("./protocolVocabulary");
const {SETTINGS_FIELD} = require("./protocolSettings");
const {decideSelection} = require("./protocolSelection");

/** اسم حقل السحب في `protocolPending/{sessionId}` (E9) — المصدر الواحد لكاتبه وقارئه. */
const DOUBLE_EVAL_DRAW_FIELD = "doubleEvalDraw";

/**
 * @param {Object} p
 * @param {{state: string, version: ?number, data: ?Object}} p.settings الإعدادات مقروءةً
 * @param {Object<string, boolean>} p.parts أجزاء المحلّ (readProtocolParts)
 * @param {function(): number} p.random للقرعة — **يُمرَّر صراحةً** (لا افتراضي)
 * @param {*} p.decidedAt وقت القرار (FieldValue.serverTimestamp() حيّاً) — يُمرَّر صراحةً
 * @return {{selected: boolean, reason: ?string, draw: ?number, rate: ?number, settingsVersion: (number|string), decidedAt: *}}
 */
function buildDoubleEvalDraw({settings, parts, random, decidedAt}) {
  const s = decideSelection({settings, parts, partKey: PROTOCOL_PART.DOUBLE_EVAL, rateField: SETTINGS_FIELD.DOUBLE_EVAL_RATE, gates: [], random});
  return {selected: s.state === REPEAT_STATE.SELECTED, reason: s.reason, draw: s.draw, rate: s.rate, settingsVersion: s.settingsVersion, decidedAt};
}

module.exports = {buildDoubleEvalDraw, DOUBLE_EVAL_DRAW_FIELD};

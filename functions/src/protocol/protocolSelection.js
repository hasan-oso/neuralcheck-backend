"use strict";

// ===================================================
// protocolSelection — قرار «الاختيار بنسبة» الخادمي: التكرار البارد (S-P6-07) والتقييم المزدوج (S-P6-10)، 2026-10-21 +03
// ===================================================
//
// المواصفة: PLAN-06 §٤-ب-١/٢ (:617-626): «الاختيار في الخادم (القاعدة 20) ... ويُخزَّن خامّاً: `repeat: {state, draw, rate, settingsVersion, decidedAt}`. فالسحب يُعاد حسابه.» و§١٠-ب-٦ (:1300-1301):
// «الخادم يختار عند إنشاء الجلسة بنسبة `doubleEvalRate`، ويخزّن السحب.» و§٦-ج (:893): «إعدادات غائبة ⇐ SETTINGS_ABSENT. والخادم لا يختار تكراراً ولا تقييماً مزدوجاً حينها، ويكتب السبب. لا يُفترض 10%.»
// **دالّة نقيّة بلا I/O** (القاعدة 41): الإعدادات والأجزاء والبوّابات تُمرَّر مقروءة، والعشوائية تُمرَّر دالّةً **صراحةً** (لا قيمة افتراضية: القاعدة 22) فيُختبر الحدّ بقيمة معلومة.
//
// الترتيب (أوّل شرط يسقط يُسمّى سبباً ولا يُقرأ ما بعده): الإعدادات (SETTINGS_ABSENT) ← الجزء المفعَّل للمحلّ (PART_NOT_ENABLED) ← بوّابات الاستدعاء بترتيبها (مثلاً PURPOSE_NOT_NORMAL ثم PARENT_JOINER_UNKNOWN للتكرار)
// ← النسبة (RATE_ABSENT غائبة · RATE_INVALID خارج [0,1]) ← القرعة: `draw` من [0,1) و**يُختار إن كان draw < rate** (فنسبة 1 تختار دائماً، ونسبة 0 لا تختار أبداً).
// لا قرعة إلا بعد اجتياز كل ما سبق: `draw` و`rate` يبقيان null حين لا قرعة (لا صفراً يشبه سحباً: القاعدة 22).
//
// الأسباب من REPEAT_NOT_ELIGIBLE_REASON (مصدر واحد: القاعدة 24)، ويستعملها التقييم المزدوج لأسبابه المشتركة (إعدادات/جزء/نسبة).

const {REPEAT_STATE, REPEAT_NOT_ELIGIBLE_REASON} = require("./protocolVocabulary");
const {SETTINGS_STATE, FIELD_STATE, readRateField, settingsVersionOf} = require("./protocolSettings");

/**
 * @param {Object} p
 * @param {{state: string, version: ?number, data: ?Object}} p.settings ناتج readSettingsDocument/readProtocolSettings
 * @param {Object<string, boolean>} p.parts ناتج readProtocolParts (مفتاح لكل جزء)
 * @param {string} p.partKey من PROTOCOL_PART
 * @param {string} p.rateField من SETTINGS_FIELD (حقل النسبة)
 * @param {Array<{reason: string, passes: boolean}>} p.gates بوّابات الاستدعاء بعد الجزء وقبل النسبة، بترتيبها
 * @param {function(): number} p.random يعيد عدداً في [0, 1) — **يُمرَّر دائماً** (لا افتراضي)
 * @return {{state: string, reason: ?string, draw: ?number, rate: ?number, settingsVersion: (number|string)}}
 *   state ∈ {NOT_ELIGIBLE, NOT_SELECTED, SELECTED} من REPEAT_STATE (أسماء الحالات الثلاث مشتركة بين الميزتين: «NOT_ELIGIBLE · NOT_SELECTED · SELECTED» P:661-662)
 */
function decideSelection({settings, parts, partKey, rateField, gates, random}) {
  if (typeof random !== "function") throw new Error("decideSelection: random مُعامل صريح (دالّة) — لا قيمة افتراضية");
  if (!Array.isArray(gates)) throw new Error("decideSelection: gates مصفوفة صريحة");
  const settingsVersion = settingsVersionOf(settings);
  const notEligible = (reason) => ({state: REPEAT_STATE.NOT_ELIGIBLE, reason, draw: null, rate: null, settingsVersion});
  if (settings.state !== SETTINGS_STATE.PRESENT) return notEligible(REPEAT_NOT_ELIGIBLE_REASON.SETTINGS_ABSENT);
  if (!parts || parts[partKey] !== true) return notEligible(REPEAT_NOT_ELIGIBLE_REASON.PART_NOT_ENABLED);
  for (const gate of gates) {
    if (gate.passes !== true) return notEligible(gate.reason);
  }
  const rate = readRateField(settings, rateField);
  if (rate.state === FIELD_STATE.ABSENT) return notEligible(REPEAT_NOT_ELIGIBLE_REASON.RATE_ABSENT);
  if (rate.state === FIELD_STATE.INVALID) return notEligible(REPEAT_NOT_ELIGIBLE_REASON.RATE_INVALID);
  const draw = random();
  if (typeof draw !== "number" || !Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error("decideSelection: random أعادت قيمة خارج [0, 1)");
  return {
    state: draw < rate.value ? REPEAT_STATE.SELECTED : REPEAT_STATE.NOT_SELECTED,
    reason: null,
    draw,
    rate: rate.value,
    settingsVersion,
  };
}

module.exports = {decideSelection};

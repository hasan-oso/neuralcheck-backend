'use strict';

// v7ProviderStub — ردّ مزوّد V7 سليم لاختبارات e2e التي تشغّل analyzeDevice الحقيقية (2026-10-09، «ملفّات e2e الستّ»).
//
// لماذا: ستّة ملفّات e2e كانت تُرجع من global.fetch جسماً بشكل V6 (`{grade, score, summary, details, verdict, issues, ...}`).
// على المسار الحيّ V7 (منذ fd3a6ce) يرفض validateV7Shape هذا الجسم (`need one of narrative`)، فتعدّه resolveV7Report فشلَ مزوّد
// وتبني عرضاً حتمياً بلا سرد — فكانت اختبارات «النجاح» تمرّ على مسار فشل المزوّد لا النجاح. هذا الجسم بشكل V7 الذي يقبله الحارس
// (narrative بحقوله الستّة + المصفوفات الثلاث)، بلا أرقام ولا لاتينية (حارس الأرقام واللغة)، وبلا issueDescriptions (فحص
// صريح: ما لم يُوصَف يبقى بلا وصف لا يُخترع).
//
// الاستبدال هنا للشبكة وحدها (القاعدة 37): ما خلف global.fetch هو الشيفرة الحقيقية كلّها (callAIv7 ← الحارس ← resolveV7Report).

/** @return {Object} جسم ردّ نموذج V7 سليم الشكل. */
function validV7ModelResponse() {
  return {
    narrative: {
      summary: 'ملخّص اختبار سليم الشكل',
      details: 'تفاصيل اختبار سليمة الشكل',
      verdict: 'حكم اختبار سليم الشكل',
      buyerAdvice: {
        casual: 'نصيحة اختبار للمشتري العادي',
        gamer: 'نصيحة اختبار للاعب',
        photographer: 'نصيحة اختبار للمصوّر',
      },
      issueDescriptions: {},
    },
    crossChecks: [],
    adjustments: [],
    modelObservations: [],
  };
}

/** غلاف HTTP كما يردّه DeepSeek (chat/completions) حول جسم معيّن. */
function deepSeekHttpResponse(contentObject) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{message: {content: JSON.stringify(contentObject)}, finish_reason: 'stop'}],
      usage: {prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 20},
    }),
    text: async () => '',
  };
}

/**
 * يستبدل global.fetch بكعب يردّ بما يعيده contentFactory(callNumber). يسجّل كل نداء.
 * @param {function(number): Object} [contentFactory] افتراضياً: ردّ V7 سليم دائماً.
 * @return {Array<{url: string, body: ?Object}>} سجلّ النداءات (يُملأ أثناء التشغيل).
 */
function installDeepSeekStub(contentFactory = () => validV7ModelResponse()) {
  const calls = [];
  global.fetch = async (url, opts) => {
    let body = null;
    try {
      body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    } catch (e) {
      body = null;
    }
    calls.push({url: String(url), body});
    return deepSeekHttpResponse(contentFactory(calls.length));
  };
  return calls;
}

module.exports = {validV7ModelResponse, deepSeekHttpResponse, installDeepSeekStub};

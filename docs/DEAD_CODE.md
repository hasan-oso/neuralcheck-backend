# كود ميت معروف — مُبقًى عمداً

سجلّ لما عُرف أنه ميت ولم يُحذف، مع سبب الإبقاء وشرط الحذف. الغرض أن يُحذف
يوماً بقرار موثَّق لا أن يُنسى، وألّا يُعاد اكتشافه من الصفر في كل جولة.

آخر تحديث: `chore/remove-v3-precompute` (حُذف فيه مسارا V3 وV5).

---

## ١. `precompute.js` و `chartToText.js`

**الحالة**: لا يستدعيهما شيء في مسار الإنتاج.

`precompute.js` كان قلب مسار V5 (`buildUserMessageV5` يستورده، و`chartToText`
يستورده `precompute`). حُذف V5 في `chore/remove-v3-precompute` فانقطع كل
مستهلك إنتاجي.

**لماذا بقيا**: `functions/test/precompute_smoke.test.js` ما زال يستوردهما
ويختبرهما (`precompute`, `PRIMITIVE_GRID`, `CORRELATION_PAIRS`). حذف
الملفّين يوجب إعادة كتابة ذلك الاختبار أو حذفه، وهو توسيع لنطاق جولة
الحذف لا يستحقّ الخلط.

فهما **كود ميت يُبقيه اختبار حيّ** — والاختبار نفسه يصف نفسه بأنه
`Not deployed. Not part of Cloud Functions runtime.`

**شرط الحذف**: قرار في `precompute_smoke.test.js` أوّلاً — يُحذف أم يُعاد
توجيهه إلى ما يختبره فعلاً في V6. بعدها يذهب الملفّان معه.

| الملفّ | أسطر |
|---|---|
| `src/analysis/precompute.js` | ~365 |
| `src/analysis/chartToText.js` | — |
| `test/precompute_smoke.test.js` | — |

---

## ٢. تعليق معلَّق في `systemPromptV4.js:8`

```
// To activate V4: see runAnalysisInternal.js where SYSTEM_PROMPT is selected.
```

`SYSTEM_PROMPT` كان صادر `systemPromptV3.js`، وقد حُذف الملفّ. ولم يعد في
`runAnalysisInternal.js` أي اختيار برومبت — المسار واحد.

**لماذا بقي**: تعليق داخل ملفّ نائب (`systemPromptV4.js`) لمسار مختبَري
موقوف. تعديله خارج نطاق جولة الحذف، وأثره صفر على التشغيل.

**شرط الحذف**: حين يُبتّ في مصير V4 — يُفعَّل فيُكتب له مسار حقيقي، أو
يُحذف الملفّ النائب معه.

---

## ملاحظة على `usePrecomputed`

الراية حُذفت من `analyzeDevice` و`callAI` و`runAnalysisInternal` و
`runConsistencyTest`. لكن **اختبارات e2e ما زالت تمرّرها** في نداءاتها
(`{data: {…, usePrecomputed: true}}`). تمريرها بلا ضرر — خاصّية زائدة
تُتجاهَل — وأبقيتُها لتقليل الضجيج في تلك الملفّات.

و`pipelineField.test.js` يُثبت أن تسرّب `usePrecomputed: false` **لا يُحيي**
تسمية `v3_legacy`، فالإهمال موثَّق باختبار لا بافتراض.

---

# بنود فُحصت ولم تتأكّد

ما رُفع كعطب ثم لم يُعِد الفحص إنتاجه. يُسجَّل كي لا يُعاد فحصه من الصفر،
ومعه الاختبار الذي يُعيد التحقّق في ثوانٍ.

## `not_tested` في مقام `passRate` — غير مُعاد إنتاجه

**الملاحظة المرفوعة** (2026-09-16):

> `rebuildCategoryScores` يُدخل `notTested` في مقام `passRate` — فئة بثلاثة
> `not_tested` من عشرة تُعطى 70% وحرف C. يتعارض مع تعريف `not_tested` الذي
> وحّدناه في البرومبت (غياب معلومة لا فشل). الإصلاح المقترح: استبعادها من
> المقام. يمسّ درجات كل التقارير ويحتاج جولة مستقلة بقياس.

**نتيجة الفحص: لم تتأكّد.** المقام يستبعدها أصلاً.

مسار واحد لحساب `passRate` في الملفّ كلّه — `rebuildCategoryScores.js:164-165`:

```js
const executed = counts.pass + counts.fail + counts.warning;
const passRate = executed > 0 ? Math.round((counts.pass / executed) * 100) : 0;
```

`executed` لا يضمّ `not_tested` ولا `unavailable` ([:41](../functions/src/analysis/rebuildCategoryScores.js#L41)
`EXECUTED_STATUSES = new Set(["pass", "fail", "warning"])`). والسطور 203 و210
و221 تستهلك `passRate` نفسه، فلا حساب ثانٍ.

والتشغيل على الحالة الموصوفة حرفياً:

```
الحالة                     grade  score  pass  total  excluded
7 pass + 3 not_tested       A      100     7     7       3
7 pass + 3 unavailable      A      100     7     7       3
7 pass + 3 fail             B       70     7    10       0
10 pass                     A      100    10    10       0
```

المقام **7 لا 10**، والنتيجة **100 لا 70**، والحرف **A لا C**. و`70`/`B` هما
ناتج ثلاثة **`fail`** — الحالة المعاكسة.

**إعادة التحقّق** (ثوانٍ، بلا شبكة ولا محاكٍ):

```bash
node -e 'const {rebuildCategoryScores}=require("./functions/src/analysis/rebuildCategoryScores");const t=[...Array(7).fill("pass"),"not_tested","not_tested","not_tested"].map((s,i)=>({testId:"SN-"+i,categoryName:"sensors",status:s}));console.log(rebuildCategoryScores({},t,[],"ar").sensors);'
```

**إن ظهر خلاف ذلك يوماً** فالتغيير وقع في `EXECUTED_STATUSES` أو في السطر
165، وهما الموضعان الوحيدان اللذان يحدّدان المقام.

**ملاحظة على السياق**: العطل الذي أثار الملاحظة كان في `variance.json` تشغيل
4، عنوانه «ثلاثة مستشعرات غير متوفّرة على هذا الموديل»، شدّته `info`،
ومبنيّ على `SN-07/08/09` بحالة **`unavailable`** لا `not_tested`. ودرجة
`sensors` كانت `A/100` في التشغيلات الخمسة كلّها — فلم تُخفَّض.

---

# فروع حُذفت

## `fix/not-tested-prompt-semantics` — حُذف 2026-09-20، فارغاً

أُنشئ لإصلاح دلالة `not_tested` في البرومبت، ثم **لم يُلتزَم فيه شيء**:
رأسه بقي `a3f529e` — رأس `master` نفسه وقتها — وصفر التزام لا يوجد في
`master`. ولم يُدفَع إلى البعيد.

**العمل نفسه لم يضِع.** جرى في شجرة العمل ثم التُزم على فرع آخر:

```
625e9b9  fix(prompt): define absence, and stop it being read as a defect
   ↑ على feat/model-switch-admin
   ↓ وصل master عبر
217c58d  merge: switch the DeepSeek model from Firestore, and define absence…
```

تحقّق في أي وقت: `git merge-base --is-ancestor 625e9b9 master`.

**لماذا انتهى هناك**: التزاما الفرعين تراكما في شجرة عمل واحدة، فالتزمتُ
إصلاح البرومبت منفصلاً على الفرع الذي كنتُ عليه (`feat/model-switch-admin`)
بدل خلطه بميزة تبديل النموذج. الفصل في التاريخ سليم؛ اسم الفرع وحده هو
الذي صار مضلّلاً.

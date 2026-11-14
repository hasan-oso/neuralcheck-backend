# ⛔ قبل أي `firebase deploy --only functions:…` — شغّل هذا أولاً

```bash
cd functions
node scripts/deploy-list.js $(cd .. && git diff --name-only <آخر-التزام-منشور> master | grep '^functions/src/')
```

الأداة تطبع **قائمة الدوال الواجب نشرها**، مشتقّة من رسم `require` الفعلي لا من
الذاكرة، مع الأمر جاهزاً للنسخ.

## لماذا وُجد هذا الملف

ثلاث مرّات بقي كود صحيح — مدموج في `master` ومدفوع — **غير منشور**، واكتُشفت كلها
بالمصادفة لا بفحص:

| المرّة | الدالة المُغفَلة | كيف انكشف |
|---|---|---|
| ١ | `analyzeDevice` | أول تسمية تقييم حقيقية وصلت بحقول ربط فارغة — التقرير كُتب بنسخة من يونيو |
| ٢ | `joinScanSession` | انتبه المستخدم أن `evaluationEnabled` لن يصل التطبيق |
| ٣ | `analyzeDevice` مجدّداً | فحص يدوي لأوقات النشر |

والسبب واحد في الثلاث: **قائمة النشر كُتبت من الذاكرة.** وتغييرُ ملفٍ مشترك يمسّ
دوالّ لا تخطر بالبال — أول تشغيل للأداة وجد `runConsistencyTest` معتمدةً على
`callAI` عبر `runAnalysisInternal`، وهي سلسلة لا يستحضرها أحد وقت النشر.

## ما تفعله الأداة

1. تقرأ `index.js` وتستخرج كل دالة مُصدَّرة ونقطة دخولها.
2. تتتبّع `require` النسبية **متعدّياً** من كل نقطة دخول.
3. تقاطع الرسم مع الملفات المتغيّرة.
4. تطبع الدوال المتأثّرة + الأمر، وتُحذّر إن تعذّر تتبّع أي دالة.

**اقرأ سطر «المُتتبَّع»**: إن ظهر أي `⚠` فالقائمة ناقصة — لا تنشر قبل حلّه.

## خطّ الأساس

`<آخر-التزام-منشور>` هو الالتزام الذي نُشرت منه الدالة **آخر مرّة**، لا آخر التزام
على `master`. وقد تختلف الدوال في خطّ أساسها، فإن نُشرت دفعات متفرّقة شغّل الأداة
مرّة لكل خطّ أساس. لمعرفة وقت نشر دالة:

```bash
gcloud functions describe <اسم-الدالة> --region us-central1 \
  --project neuralchek-9b6d7 --format="value(updateTime)"
```

> مشغّلات Firestore تسكن منطقة قاعدة البيانات — `resolvePendingEvaluation` في
> `europe-west1` لا `us-central1`.

## مثال

```
$ node scripts/deploy-list.js src/prompts/systemPromptV6.js

الدالة                      نشر؟  السبب
analyzeDevice               ✅    src/prompts/systemPromptV6.js
runConsistencyTest          ✅    src/prompts/systemPromptV6.js
submitEvaluation            —     3 ملفاً، لا تقاطع
…
يجب نشرها (2/16): analyzeDevice, runConsistencyTest

الأمر:
firebase deploy --only functions:analyzeDevice,functions:runConsistencyTest --project neuralchek-9b6d7
```

## حدودها

- تتتبّع `require` **النسبية** فقط (`./` و`../`). تغيير حزمة في `node_modules`
  أو سرّ في Secret Manager لا تراه الأداة.
- لا تعرف ما هو منشور فعلاً — تعتمد خطّ الأساس الذي تعطيه إياه.
- لا تغطّي القواعد ولا الفهارس. تغيّرت `firestore.rules`؟ انشرها بنفسك.
  و`firestore.indexes.json` له تحذيره الخاص في
  [FIRESTORE_INDEXES.md](FIRESTORE_INDEXES.md).


---

## خطّ الأساس المنشور

الأداة تشتقّ القائمة من فرقٍ بين التزامين. هذا هو الطرف الأيسر: **آخر التزام
نُشر فعلاً**.

| | |
|---|---|
| الالتزام | `d7651e2` — `merge: rate limit verifyReport, and teach deploy-list multi-name imports` |
| ما نُشر منه | `verifyReport` وحدها (1 من 16) |
| وقت النشر | `2026-09-19T22:06:30.307617218Z` |

> **كان يقول (قبل 2026-09-20):** «1 من 18». العدد الحقيقي للدوالّ **الحيّة
> على Firebase** هو **16** لا 18 — بالإحالة إلى
> `docs/deploy-log/functions-list-2026-09-20T063236+03.json` (16 عنصراً في
> `result`؛ عُدّت بالأداة لا بالعين). لا حذف — القاعدة ٨ — هذا سطر تصحيح لا
> استبدال صامت.
>
> **الرقمان 16 و18 كلاهما صحيح — يجيبان سؤالين مختلفين:**
> `node scripts/deploy-list.js` نفسها تطبع «(2/**18**)» في المثال أعلاه، لأنها
> تعدّ الدوالّ **المُصدَّرة من `functions/index.js` على `master`** (تحقّق
> ذاتي: `exports.*` في `index.js` = 18 سطراً، منها `getAiConfig`
> و`setAiModel`). أمّا «16 دالّة حيّة» فمصدرها Firebase نفسه
> (`functions:list`) — الاثنتان الغائبتان `getAiConfig`/`setAiModel` مدموجتان
> في `master` (`feat/model-switch-admin`، U6) لكن **غير منشورتين بعد**؛
> تُنشران تلقائياً مع أول نشرة `P1` (`PLAN-01-ROADMAP.md:49`). فالأداة لم
> تُخطئ قط — كانت تُجيب «كم دالّة في الكود؟» بينما جدول هذا القسم يدّعي
> إجابة عن «كم دالّة حيّة؟» بلا مصدر آلي يفرّق بينهما. قسم «بعد كل نشرة —
> سجلّ آلي إلزامي (P0.7)» أدناه هو ذلك المصدر.

```bash
cd functions
node scripts/deploy-list.js $(cd .. && git diff --name-only d7651e2 master | grep '^functions/src/' | sed 's|^functions/||')
```

**الدوالّ الخمس عشرة الأخرى أقدم**: `analyzeDevice` و`runConsistencyTest`
عند دمج حذف V3/V5، والباقي عند 2026-08-29. فالأداة لا تُخبرك بما هو قديم —
تُخبرك بما تغيّر منذ الطرف الذي تمرّره. مرّر هذا الالتزام لتعرف ما استجدّ
بعد آخر نشر، لا ما اختلف عن حالة أقدم.

**ولا تُمرَّر الملفات المحذوفة**: الأداة تحلّ رسم `require` من ملفات قائمة،
فملفّ حُذف لا يُحلّ. مرّر الباقي منها — الدوالّ التي كانت تعتمد المحذوف
تعتمد عليه عبر ملفات باقية، فتظهر في القائمة على أي حال.

---

## بعد كل نشرة — سجلّ آلي إلزامي (P0.7)

سبب هذه الخطوة: قسم «خطّ الأساس المنشور» أعلاه سجلّ **يدوي يستشهد بنفسه** —
الوقت المدوَّن فيه (`وقت النشر`) لم يكن خلفه ملفّ قياس، فرصده مدقّق مستقلّ
(`verifier`، 2026-09-20). الإصلاح: بعد كل نشرة فعلية يُحفَظ دليل آلي في
[`deploy-log/`](deploy-log/) بدل الاكتفاء بتحديث الجدول أعلاه يدوياً.

**الخطوة إلزامية بعد كل `firebase deploy --only functions:…`:**

```bash
# 1. القائمة الكاملة (تفاصيل كل دالّة — بلا وقت التحديث، انظر الملاحظة أدناه)
firebase functions:list --project neuralchek-9b6d7 --json \
  > docs/deploy-log/functions-list-<التاريخ+03>.json

# 2. وقت النشر الفعلي — لكل دالّة
gcloud functions list --project neuralchek-9b6d7 \
  --format="table(name,state,updateTime)" \
  | tee docs/deploy-log/gcloud-functions-updatetime-<التاريخ+03>.txt

# نسخة JSON من نفس الاستعلام (لاستخراج updateTime برمجياً لاحقاً)
gcloud functions list --project neuralchek-9b6d7 --format=json \
  > docs/deploy-log/gcloud-functions-updatetime-<التاريخ+03>.json
```

`<التاريخ+03>` بصيغة `YYYY-MM-DDTHHMMSS+03` (مثال: `2026-09-20T063236+03`) —
بتوقيت +03 دائماً (القاعدة ١١).

**واقعة مقيسة اليوم (2026-09-20)، لا افتراضاً:** `firebase functions:list --json`
**لا يحمل حقل `updateTime` إطلاقاً** — تحقّق ذاتي على
`docs/deploy-log/functions-list-2026-09-20T063236+03.json` (22 مفتاحاً لكل
دالّة، لا واحد منها `updateTime`؛ القائمة: `platform, id, project, region,
eventTrigger, entryPoint, runtime, source, ingressSettings,
environmentVariables, timeoutSeconds, uri, serviceAccount,
availableMemoryMb, cpu, maxInstances, concurrency, labels, runServiceId,
codebase, hash, state`). **وقت النشر يأتي حصراً من `gcloud functions list
--format="table(name,state,updateTime)"`** أو من `gcloud functions describe
<اسم> --format="value(updateTime)"` (الأمر القديم في قسم «خطّ الأساس» أعلاه،
لدالّة واحدة). لا تُستنتَج ساعة النشر من `functions:list` ولا من ذاكرة
المُنشِر — القاعدة ٥.

كلا الأمرين **قراءة فقط** (لا `--force`، لا تعديل حالة) ومسموحان لأي جلسة
دون اعتبارهما نشراً.

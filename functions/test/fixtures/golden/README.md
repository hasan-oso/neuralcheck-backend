# فِخاخ الاختبار الذهبية — `P1.1`

**نُقلت 2026-09-20 (+03)** من `C:\Users\Efendi.Tec\rebuld\` — مجلّد تحليل Fable، **خارج المستودعات الثلاثة**.
نُسخت هنا كي يعمل `P1.1` داخل حدود `neuralcheck-backend` بلا قراءة من خارجه.
**لا تُحذف** (القاعدة 8) — هي الدليل الوحيد داخل المستودع على المخرَج المتوقَّع.

## المدخلات — أربع سلاسل زمنية

| الملفّ | الفحص | المصدر الأصلي |
|---|---|---|
| `8909e850-s10.ts.json` | `8909e850-b10c-466c-899a-ce97cb5c4fbe` (S10) | `rebuld/s10-timeseries.json` |
| `e4b65a2f-honor.ts.json` | `e4b65a2f-3a0c-4f11-939d-17eab7d0912f` (Honor) | `rebuld/honor-timeseries.json` |
| `b45c8cf6.ts.json` | `b45c8cf6-e376-4765-8703-f68e9bc69844` | `rebuld/VARIANCE-inputs/run1-b45c8cf6.ts.json` |
| `34dff2b8.ts.json` | `34dff2b8-ce9e-4b40-86a9-1976c878e195` | `rebuld/VARIANCE-inputs/run2-34dff2b8.ts.json` |

## المخرَج المتوقَّع — ⚠️ **مصدران بمخطَّطين مختلفين**

| الملفّ | يغطّي | المخطَّط |
|---|---|---|
| `EXPECTED-timeseries_stats.json` | **مفتاحان فقط: `s10` و`honor`** ← الفحصان `8909e850` و`e4b65a2f` | مخرَج `timeseries_stats.py` |
| `EXPECTED-compare_runs.json` | `b45c8cf6` و`34dff2b8` (ومعهما فحص الأمس) | مخرَج `variance_compare_runs.py` — **مخطَّط مختلف تماماً** |

**لا يوجد `EXPECTED-timeseries_stats.json` للفحصين `b45c8cf6` و`34dff2b8`.**
`timeseries_stats.json` يحمل مفتاحين اثنين لا أربعة — تحقَّقتُ:
`json.load(...)` → `['s10', 'honor']`.

فالمطابقة «حقلاً حقلاً ±0.01 مقابل `timeseries_stats.json`» تسري **على فحصين من أربعة** كما هي.
**الحلّ المقترح ولم يُنفَّذ:** تشغيل `REFERENCE-timeseries_stats.py` على `b45c8cf6.ts.json` و`34dff2b8.ts.json`
لتوليد المدخلين الناقصين بالمخطَّط نفسه. **يحتاج إذناً** — يُغيّر ملفّ المخرَج المتوقَّع.

## المرجع التنفيذي

`REFERENCE-timeseries_stats.py` — نسخة من `rebuld/scripts/timeseries_stats.py`.
`PLAN-01` `P1.1` ينصّ: «المرجع التنفيذي لكل معادلة: `scripts/timeseries_stats.py` (الدوال بأسمائها)».
**لا يُشغَّل في الإنتاج** — مرجع صياغة معادلات فقط.

## إضافة — `functionalResults-by-scanid.json` (سدّ الفجوة 2، 2026-09-20 +03)

**لا يُعدِّل ولا يستبدل** أياً من الملفّات أعلاه — يُضاف بجوارها فقط. الملفّات
الأربعة أعلاه (`footer/header/samples/variables`) لا تحمل `functionalResults`
إطلاقاً، فوسم `UNSTABLE` (`C-04/S-04/S-05/C-03`) و`ADVISORY` (`S-06`) في
`findings.js` كان بلا اختبار ذهبي حتى الآن.

`functionalResults-by-scanid.json` يحمل `rawFingerprint.functionalResults` كما
وردت فعلياً من مستندات `Firestore reports/{scanId}` — جُلبت بـ
`functions/scripts/fetch-functional-results-golden.js` (قراءة فقط، REST +
`gcloud auth print-access-token`، بنفس نمط `measure-deepseek-only-variance.js`).

**⚠️ اثنان من أربعة فقط.** `b45c8cf6-e376-4765-8703-f68e9bc69844` و
`34dff2b8-ce9e-4b40-86a9-1976c878e195` أعادا 200 مع 85 عنصر `functionalResults`
لكلّ منهما. `8909e850-b10c-466c-899a-ce97cb5c4fbe` (S10) و
`e4b65a2f-3a0c-4f11-939d-17eab7d0912f` (Honor) أعادا **404 NOT_FOUND** — لا
مستند لهما في مجموعة `reports` إطلاقاً (`GET` مباشر بمعرّف السكان نفسه، نمط
`.doc(scanId)` في `src/analysis/analyzeDevice.js:71`). يطابق ما هو موثَّق أعلاه
في هذا الملفّ: مصدر هذين الفحصين `rebuld/s10-timeseries.json` و
`rebuld/honor-timeseries.json` — سلسلتان زمنيتان خارجيتان لم تمرّا بمسار
`analyzeDevice` الذي يكتب مستند `reports` كاملاً بـ`functionalResults`.
القيمتان `null` في الملفّ لهذين المعرّفين تعكسان ذلك صراحة، لا نقصاً في
الجلب. اختبار ذهبي حقيقي على `C-04/S-04/S-05/C-03/S-06` قائم في
`findings.test.js` (قسم "٤-ب") على الفحصين المتوفّرين فقط.

## إضافة — `v7-reports-document-sample.json` (القرار ٧٥ البند ٢-أ، 2026-09-24 +03)

**المولّد:** `functions/scripts/generate-v7-reports-document-sample.js` —
يستهلك `buildClientPayloadSample()` (من `generate-v7-client-payload-sample.js`،
لا إعادة اشتقاق مستقلّة) ثم `buildReportDocument()` المُصدَّرة من
`src/analysis/analyzeDevice.js` (استُخرجت في نفس المهمّة، الالتزام `01c5aac`)
— على نفس مُدخلات `34dff2b8` الحقيقية، صفر نداء نموذج، صفر Firestore.

**السبب:** قرّاء V7 في `wepsite` يقرؤون مستند `reports/{scanId}` مباشرة
(§٤/٨، `docs/V7_DISPLAY_SHAPE_CONTRACT.md`) — شكل مختلف عن عيّنة إرجاع
`analyzeDevice` (`v7-client-payload-sample.json`) التي بُنيت عليها اختبارات
سابقة فقط. هذه العيّنة تسدّ تلك الفجوة.

**علامة مسمّاة واحدة فعلياً** (لا مصدر لها في أي فخّ مخزون): `userId` =
`{"__marker": "NOT_FROM_FIRESTORE_OR_AUTH_USERID"}`. `createdAt` يحمل
`SERVER_TIMESTAMP_MARKER` (نفس علامة `buildReportDocument` القائمة أصلاً،
لا علامة جديدة). راجع رأس المولّد لتفصيل كل حقل آخر ومصدره الحقيقي — بما
فيها فرق موثَّق عن نصّ أمر المهمّة الأصلي حول `deviceFingerprintSha`/
`timeSeriesStoragePath` (الكود يشتقّهما من ترويسة السلسلة الزمنية، لا من
Firestore، فاستُعملت القيمة الحقيقية بدل علامة).

**الحارس:** `test/v7ReportsDocumentContractGuard.test.js` — يعيد البناء في
الذاكرة ويقارن بالثابت المُلتزَم (القاعدة 39).

## إضافة — `v7-verifyReport-response-sample.json` (القرار ٧٥ البند ٢-ب، 2026-09-24 +03)

**المولّد:** `functions/scripts/generate-v7-verifyReport-response-sample.js` —
يبني `reportDocument` من `buildReportsDocumentSample()` أعلاه، ثم يُشغِّله
عبر **نفس تقنية الاستخراج** التي يستعملها `test/verifyReportV7Whitelist.test.js`
(`new Function` على المقطع بين `const report = reportDoc.data();` و
`res.json(response);` في `src/reports/verifyReport.js`، بلا أي تعديل على
ذلك الملفّ). صفر Firestore، صفر نداء نموذج.

⚠️ `response.date` يحمل نفس علامة `createdAt` المُجمَّدة من عيّنة البند أ
(`SERVER_TIMESTAMP_MARKER`) — تمريرة مباشرة كما يفعل `verifyReport.js:311`
حرفياً، لا تاريخاً حقيقياً مُخترَعاً.

**المطابقة بالعقد:** `functions/scripts/compare-verifyReport-v7-contract.js`
يقارن مفاتيح `response.aiResponse` (مُسطَّحة) بجدول
`docs/V7_DISPLAY_SHAPE_CONTRACT.md` §٨-أ ("الحقول — الوصف الحالي") —
مُشتقّاً من نصّ العقد وقت التشغيل، لا نسخة يدوية. **الفرق فعلياً: صفر في
الاتّجاهين** (24 مساراً في كلا الطرفين، `node functions/scripts/compare-verifyReport-v7-contract.js`
→ exit 0). حقول الغلاف (`scanId`/`shortId`/`deviceModel`/`deviceMarketingName`/
`date`/`language`/`isFreeTrial`/`verified`) خارج نطاق جدول §٨-أ بنصّ العقد
نفسه (يوثّق `response.aiResponse` فقط) — لا فرقاً، مُسجَّلة للعلم.

**الحارس:** `test/v7VerifyReportResponseContractGuard.test.js` — يعيد
البناء في الذاكرة ويقارن بالثابت المُلتزَم (القاعدة 39).

## إضافة — عيّنتا Honor (`e4b65a2f`، القرار ٧٩ البند أ، 2026-09-24 +03، الجولة الثانية)

`v7-reports-document-sample-honor.json` و`v7-verifyReport-response-sample-honor.json`
— نفس زوج العيّنتين أعلاه، لكن على فحص Honor (`e4b65a2f-3a0c-4f11-939d-17eab7d0912f`)
بدل `34dff2b8`: **الحالة المقابلة**، `functionalResults` **غائبة** (404
حقيقي، موثَّق أعلاه في هذا الملفّ) → `categoryStates.js` يُنتج
`harnessError: true`/`harnessErrorReason: 'FUNCTIONAL_RESULTS_UNAVAILABLE'`/
`letter: null` بدل حرف حقيقي.

⚠️ **لا ردّ نموذج مسجَّل لهذا الفحص** (لا `v7-live-e4b65a2f-*.json`، بخلاف
`b45c8cf6`/`34dff2b8`). سؤال حُسم بالكود لا بالافتراض: هل يستدعي مسار V7
النموذج لتقرير فيه `harnessError`؟ **نعم** — لا فحص لهذا الشرط قبل نداء
النموذج في أي مكان بين `runAnalysisInternal.js`/`resolveV7Report.js`/`callAI.js`
(`resolveV7Report.js` يستدعي `callAIv7(p)` غير مشروط أوّل سطر). فهذه العيّنة
تبني ما تبنيه `resolveV7Report.js` نفسها حين **يغيب ردّ النموذج تماماً**
(فرع `providerFailedNoFallback` في `callAI.js:538-546`، أُعيد بناؤه يدوياً
بنفس القيم الحقيقية — بلا نداء فعلي، القيد الصريح)، عبر الدوال المُصدَّرة
فعلياً من `resolveV7Report.js` (`_internal.sanitizeNarrativeForDisplay`/
`_internal.expandDroppedDisplayFields`) — لا نسخة مستقلّة من منطقهما.
النتيجة: `narrativeIncomplete: true` وكل حقول `narrative.*` السبعة مُسقَطة.
راجع رأس `functions/scripts/generate-v7-reports-document-sample-honor.js`
للتفصيل الكامل.

**المولّدان:** `functions/scripts/generate-v7-reports-document-sample-honor.js`
و`functions/scripts/generate-v7-verifyReport-response-sample-honor.js`
(نفس بصمة `honorFp`/`honorFindings`/`honorCategoryStates` في
`test/buildDisplayShapeV7.test.js` §"Honor (e4b65a2f)" حرفياً).

**الحارسان:** `test/v7ReportsDocumentHonorContractGuard.test.js` و
`test/v7VerifyReportResponseHonorContractGuard.test.js`.

## إضافة — القيم الحقيقية في عيّنات V7 استُبدلت بقيم من الشكل نفسه (القرار ٨٢ البند ٢، 2026-09-24 +03)

`34dff2b8.ts.json` و`e4b65a2f-honor.ts.json`: `header.deviceFingerprint`
و`header.scanId` و`footer.samplesSha256` كانت قيماً حقيقية (فحصان
حقيقيان) — استُبدلت بقيم عشوائية من الشكل نفسه (UUID لـscanId، 64 خانة
سداسية عشرية للبصمة وsamplesSha256). العيّنات الأربع المشتقّة
(`v7-reports-document-sample*.json`، `v7-verifyReport-response-sample*.json`)
أُعيد توليدها بعد ذلك عبر مولّداتها الفعلية — لا تحرير يدوي. **أسماء ملفّات
الفِخّين لم تُعَد تسميتها هذه الجولة** (لا تزال تحمل بادئة scanId حقيقي
كبادئة اسم — القيمة الداخلية وحدها استُبدلت؛ نفس الشيء يسري على
`b45c8cf6.ts.json` و`8909e850-s10.ts.json`، خارج نطاق هذه الجولة أصلاً).

⛔ **N-06 (اسم المشغّل، "Turkcell") لم يُستبدل.** حكم المدقّق (2026-09-24
+03): النموذج يقرأها فعلياً في الحمولة (`buildV7Payload.js:141`) وتدخل
فهرس إعفاء حارس `device_spec` (`reportShapeV7.js`) — شرط التوقّف بنصّ
المهمّة وقع، بانتظار قرار المستخدم. القيمة باقية حرفياً في
`v7-reports-document-sample.json` وحدها (Honor بلا `functionalResults`
أصلاً).

## إضافة — عيّنتا V6 الذهبيتان (القرار ٨٢ البند ١ + الملحق ٨٠-أ، 2026-09-24 +03)

`v6-reports-document-sample.json` و`v6-verifyReport-response-sample.json`
— أوّل عيّنتين ذهبيتين على مستند V6 حقيقي (`pipeline: "v6_raw_timeseries"`)
في هذا المستودع.

**المصدر:** مخرَج `export-v6-report-readonly.js` على فحص حقيقي —
**الملفّ الخام لا يدخل هذا المستودع مطلقاً** (قرار صريح: "ملفّ evidence/
يبقى في مجلّد القيادة"). راجعه المنسّق حقلاً حقلاً (سبعة عشر حقلاً في
`forReview_notRedacted`، وفحص أنماط على 1115 ورقة في `document`) —
مراجعة `v6-report-review-2026-09-24.md`، توقيعها `SHA256SUMS` مُتحقَّق
وقت التوليد، خارج هذا المستودع أيضاً.

**المولّدان:** `functions/scripts/generate-v6-reports-document-sample.js`
(يأخذ مسار ملفّ التصدير الخام **وسيطاً إلزامياً، بلا افتراضي** — يطبّق
حكمَي مراجعة إضافيَّين لم يلتقطهما `export-v6-report-readonly.js`:
`aiResponse.shortId` نسخة ثانية ⇐ استبدال بقيمة من الشكل نفسه،
`…footer.samplesSha256` ⇐ حذف كامل) و
`generate-v6-verifyReport-response-sample.js` (يستهلك المستند المُلتزَم
أعلاه، بنفس تقنية `new Function` على `verifyReport.js` — فرع V6
`buildV6Response` حقيقي، لا شكل مُخترَع).

⛔ **N-06 ("Turkcell") لم يُستبدل هنا أيضاً** — نفس شرط التوقّف أعلاه، نفس
القرار المُعلَّق.

**الحارسان يختلفان بنيوياً عن حرّاس V7**: `test/v6VerifyReportResponseContractGuard.test.js`
يعيد بناءً كاملاً (مُدخله — مستند V6 — مُلتزَم في المستودع). أمّا
`test/v6ReportsDocumentContractGuard.test.js` **فلا يستطيع** إعادة بناء
كاملة (مُدخله الخام خارج المستودع بتصميم) — يتحقّق بدلاً من ذلك من كل حكم
من أحكام المراجعة مباشرة على الملفّ المُلتزَم (حقول غائبة، حقول
"[REDACTED]"، شكل shortId الثانوي، غياب samplesSha256، وN-06 لا يزال
"Turkcell" حرفياً). راجع رأس كل حارس للتفصيل.

## إضافة — عيّنات zero-measured المشتقّة (مهمّة A، 2026-10-07 +03)

ستّ عيّنات + ملفّ مصدر/تحويل، من مُدخل حقيقي **محوَّل** (`34dff2b8`) — **مشتقّة، ليست فحصاً حقيقياً**:
متغيّران (`default`: البطارية `NO_CALIBRATED_THRESHOLD`؛ `battery-harness-error`: `timeSeries.samples=[]` فالبطارية `HARNESS_ERROR`)
بثلاثة أشكال لكلٍّ منهما — مستند reports، وردّ analyzeDevice (للتطبيق)، وردّ verifyReport (للموقع، يُسطِّح `overall` داخل `aiResponse`):

| الملفّ | الشكل |
|---|---|
| `v7-reports-document-sample-zero-measured.json` وشقيقه `…-battery-harness-error.json` | مستند `reports/{scanId}` |
| `v7-client-payload-sample-zero-measured.json` وشقيقه `…-battery-harness-error.json` | ما يصل التطبيق من `analyzeDevice` |
| `v7-verifyReport-response-sample-zero-measured.json` وشقيقه `…-battery-harness-error.json` | ردّ `verifyReport` |
| `v7-zero-measured-samples-meta.json` | **المصدر والتحويل** (`_meta`) — ملفّ مستقلّ عمداً: القاعدة 41 تمنع مفتاحاً غريباً داخل عيّنة يُفترَض أن تطابق مُنتِجها |

التعريف من الكود: `noDataAtAll = (measuredCategoriesMean === null)` أي **لا فئة أنتجت حرفاً** (لا «لم يُقَس شيء»)،
و`zeroMeasuredMessage` مملوء حين `overall.letter === null && noDataAtAll`. **السلسلة الحقيقية وحدها:** `runAnalysisInternal` ثم ما يفعله
معالج `analyzeDevice` — والمُستبدَل نداء المزوّد وحده (`callAIv7` يُعيد قيمة «فشل المزوّد بلا احتياطي» الموثَّقة؛ لا نداء نموذج ولا شبكة، والسرد غائب
`narrativeIncomplete=true`). **المولّد:** `functions/scripts/generate-v7-reports-document-sample-zero-measured.js`، **الحارس:**
`functions/test/v7ZeroMeasuredSamplesContractGuard.test.js` (يعيد البناء في الذاكرة ويقارن حرفاً بحرف باستثناء `shortId`).
الرموز المُغطّاة: `NO_HEALTH_BEARING_TESTS_DECLARED`، `DECLARED_BUT_NONE_EXECUTED`، `NO_CALIBRATED_THRESHOLD`، `HARNESS_ERROR`.
غير الممكنة من مُدخل حقيقي بلا اختلاق (أسبابها في `_meta.codesNotReachable`): `MANUAL_ATTESTATION_ONLY`، `NO_BATTERY_INDICATORS_MEASURED`.

## إضافة — عيّنات حمولة التطبيق (fv68 ثم fv69)، نسخ حرفي (V8 الدفعة ٣ الجزء ٣، 2026-10-08 +03؛ **على fv69 منذ 2026-10-10 +03، الدفعة ١٠**)

ستّة ملفّات — ثلاثة `.json` وثلاثة `.keys.txt` بجانبها — **نُسخت بايتاً ببايت** ولم يُعدَّل منها حرف.
**⚠️ مُحدَّث 2026-10-10 +03: الملفّات الستّة الآن `fv69-app-request-payload-derived-from-…` (fieldsVersion 69، NeuralChek@`a04b4f0`)؛ حلّت محلّ نسخ fv68 بـ`git mv` ثم نسخ فوقها (يبقى تاريخها). fv68 لم يُشحن في أيّ APK (1.0.10 على fv67)، فلا نسخة fv68 باقية هنا ولا اختبار يلزمها.** انظر «تحديث إلى fv69» أدناه.

**المصدر (الأصل، fv68):** NeuralChek@`738da89`، والمسار هناك `app/src/test/resources/derived/`. (كانت `cfa9ef3` حتى 2026-10-08 — انظر «تحديث بعد ت-02» أدناه.) **والمصدر الحالي (fv69):** NeuralChek@`a04b4f0`، المسار نفسه — نسخها المنسّق بـ`git show` إلى `evidence/v8-phase0/fv69-for-backend/` ثم نُسخت هنا بـ`cp`، وsha256 كلٍّ مطابق لـ`SHA256SUMS.txt` هناك ولجدول عقد التطبيق §٧-ح (**منقول، غير متحقَّق من مستودع التطبيق** — خارج حدودي).
**منقول من نصّ أمر المنسّق، غير متحقَّق عندي** — مستودع التطبيق خارج حدودي (وكيل الباك اند لا يقرؤه). النسخ المطابقة التي نُسخت منها استُخرجت بـ`git show 738da89:<المسار>` في مساحة العمل، وكان `cmp` بينها وبين ما هنا صفراً.

### مشتقّة، لا فحص حقيقي

المصدر الخامّ هو `34dff2b8.ts.json` الذي في هذا المجلّد، ثم السلسلة الحقيقية للتطبيق في JVM، **مع قيم مصنوعة معلنة في README التطبيق**. (**منقول من نصّ الأمر، غير متحقَّق عندي** — لا أرى README التطبيق ولا السلسلة.)
فهي عيّنة لشكل ما يرسله التطبيق، لا ردّ جهاز حقيقي ولا فحص حقيقي.

### sha256 الستّة (fv69، NeuralChek@`a04b4f0`)

مصدرها نصّ الأمر و`evidence/v8-phase0/fv69-for-backend/SHA256SUMS.txt` (وتطابق جدول «sha256 بعد» في عقد التطبيق §٧-ح، `docs/FV68_CONTRACT.md`)، وهي ما يتحقّق منه `test/fv68AppPayloadGoldenCopy.test.js` (اسمه ما زال fv68 وهو يحرس fv69):

```
2e8b03444a8e29ffa37a06aca94e87f25130aeae2fdb412b290816cbd9425672  fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json
5c75fb73f12e395f678762d806f1be8ffcbe5163da2bed3509a99979dc31a9b8  fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.keys.txt
0d40ab66dd37034cc16a1c89b53a9729b63255caae36c35ab38f8375be1be1a9  fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json
e60894a7ed099162b26975ce2366bf5d4125df22fff7aa6b202ea5cd50749dd6  fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.keys.txt
b42e8211fef8e1920b841fd2c962b23ef990f31a60f4d2365695c65aaa74b041  fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json
86d1675fc49d49df46387bc73cb3da1e3123897abf0222eb17bd76651ba8ed6b  fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.keys.txt
```

**وكانت (fv68، NeuralChek@`738da89`، أسماؤها `fv68-app-request-payload-derived-from-…`) — للتاريخ، لا يتحقّق منها شيء بعد اليوم:**

```
58e88edd36c7f9ebcc9941d225e3befb93ea45c78cedf97d653487eabaac4cd0  …-11ch-nothing-admitted.json
4399e5bf2232ea4d889a8a4567b4af8e47de501102fccee9a72561ebeb02596a  …-11ch-nothing-admitted.keys.txt
a8f5d498d84aafac686b6d932ca028b4011752d351661ea73584c45e5e8f046f  …-13ch-selinux-blocked-policy.json
bfcaea2d0aab68e3d2ac3d0a0a9b9752087b2e8683a01f1d73aeb27abb9bff71  …-13ch-selinux-blocked-policy.keys.txt
3b30649a1d6c3bd1d2e6f629a7614be6dd9f7c918ad10e7d6e1cb173851c1248  …-16ch-four-policies-truncated-failures.json
67a5baf073b579e8275f972fb928a4f391b371dcc46c53e30240ef1f60107122  …-16ch-four-policies-truncated-failures.keys.txt
```

### شكل `.keys.txt` (مُتحقَّق بالاختبار هنا)

قائمة مسارات مفاتيح الـ`.json` الذي بجانبه: مسار منقوط (`device.model`)، و`[]` بعد المصفوفة حين تحمل عناصرها كائنات (`functionalResults[].testId`)، سطر لكل مسار بلا تكرار، مرتّبة، وبعد كل سطر `\n`. الاختبار يبني القائمة من الـ`.json` ويقارنها بالملفّ نصّاً كاملاً (277 و294 و293 سطراً للثلاثة بالترتيب بعد تحديث 738da89؛ كانت 277 و293 و292). **حالتان لا تمرّان في الملفّات الستّة، فسلوك الباني فيهما غير مُتحقَّق من كود التطبيق:** قيمة `null`، ومصفوفة داخل مصفوفة.

### لا تُعدَّل هنا

إن تغيّر الشكل، **تُعاد توليدها في التطبيق وتُنسخ إلى هنا ثانيةً** (القاعدة 39: الفخّ الذهبي يتبع العقد، وإعادة التوليد جزء من التزام تغيير العقد). لا تعديل يدوي ولا إعادة تسمية.
وملفّ `.gitattributes` في جذر المستودع يضع `-text` على هذه الملفّات وحدها، بنمط اسمها: بلا ذلك يحوّل `core.autocrlf=true` (إعداد Git النظامي على هذه الآلة) نهايات الأسطر عند السحب فيتغيّر sha256.

### قرّاؤها

**لا قارئ إنتاجي يقرؤها اليوم** (القاعدة 22 — الغياب مُعلَن). قرّاؤها في الدفعة ٤: **كل قارئ يُختبر عليها** (القاعدتان 37 و41). والمحرَّر هنا اليوم اختبار واحد فقط (`test/fv68AppPayloadGoldenCopy.test.js`: sha256 والتفكيك ومطابقة المفاتيح) وتصنيفها في `test/goldenFixturesGuardCoverage.test.js` ضمن «المُدخلات الموثَّقة».

### القراران اللذان يقوم عليهما النسخ — بنصّهما

**منقولان من نصّ أمر المنسّق، وهو ينقلهما من `PLAN-01-ROADMAP.md` و`FV68-DECISIONS-2026-10-08.md` في مساحة العمل — لا أراهما، غير متحقَّق عندي:**

- **س-25، 2026-10-08:** «عيّنة ذهبية لحمولة التطبيق تُنسخ إلى المستودعين — نعم (القاعدتان 37 و41)، في التزام تغيير العقد (القاعدة 39)».
- **وعدّله المستخدم في اليوم نفسه:** «فالعيّنة الذهبية لحمولة التطبيق تُنسخ إلى الخادم وحده.»

### تحديث بعد ت-02 (2026-10-08 +03، NeuralChek@`738da89`)

أعاد التطبيق توليد عيّنتَي `13ch-selinux-blocked-policy` و`16ch-four-policies-truncated-failures` في NeuralChek@`e7fa26e` ووثّقهما في `738da89`؛ فتغيّرت أربعة ملفّات هنا (`.json` و`.keys.txt` لكلٍّ منهما) وبقي ملفّا `11ch-nothing-admitted` كما كانا (`cmp` صفر مع نسخ مساحة العمل، وsha256 لم يتغيّر). **كانت `cfa9ef3` حتى 2026-10-08.** الأسماء لم تتغيّر.
**ما تغيّر — منقول من تقرير وكيل التطبيق عبر نصّ أمر المنسّق، غير متحقَّق عندي من كود التطبيق:** حقول الدورات في `footer.batteryHealth` — `cycleCount`، و`cycleCountSource` بمفرداته الجديدة `extra_api34 | sysfs:<path> | unavailable`، و`cycleCountState` — **وAPI 34 مصنوع** في الترويسة وفي `device.apiLevel` و`androidVersion` كي تُقرأ الدورات من الإضافة.
**ومُلاحَظ من فرق النسختين هنا (مقارنة أوراق JSON بين blob `HEAD` والملفّ الجديد):** ستّة فروق في كلٍّ من الملفّين `.json`، لا غير: `device.androidVersion` ("11" إلى "14")، `device.apiLevel` (30 إلى 34)، `timeSeries.header.androidApiLevel` (30 إلى 34)، `batteryHealth.cycleCountSource` ("unavailable" إلى `extra_api34` في 13ch و`sysfs:/sys/class/power_supply/battery/cycle_count` في 16ch)، `batteryHealth.cycleCountState` (`not_read:sysfs_not_readable_or_absent_and_api_below_34` إلى `read`)، وحقل **جديد** `batteryHealth.cycleCount` (187 في 13ch و212 في 16ch). والفرق في `.keys.txt` سطر واحد في كلٍّ منهما: `timeSeries.footer.batteryHealth.cycleCount`. أي أن `cycleCountSource` و`cycleCountState` كانا موجودين قبل التحديث بقيم أخرى.

**قرار المستخدم الذي يقوم عليه التحديث — بنصّه (BATCH3-CLOSE، البند ٢)، منقول من نصّ أمر المنسّق، غير متحقَّق عندي:**

> «التنفيذ: EXTRA_CYCLE_COUNT من بثّ البطارية على API ≥ 34، وcycleCountSource بمفرداته، وغيابه حالة معلنة. ثم تُحدَّث العيّنة الذهبية، وتُنسخ إلى الخادم بالتحقّق من sha256.»

### تحديث إلى fv69 (2026-10-10 +03، NeuralChek@`a04b4f0`، الدفعة ١٠ — خطوات الفنّي)

أعاد التطبيق توليد العيّنات الثلاث على fieldsVersion 69 فتغيّرت الملفّات الستّة كلّها. **الفروق بين نسخة fv68 (blob `HEAD` قبل التبديل) ونسخة fv69 — مُلاحَظة هنا بمقارنة أوراق JSON بسكربت مؤقّت (لا من كود التطبيق):**

- في الثلاث: `timeSeries.footer.fieldsVersion` 68 ← 69؛ `manualResultsHeader` **جذر جديد** (`{"hiddenByModel": …}`: `[]` في 11ch و16ch و`["M-14","M-15"]` في 13ch)؛ `functionalResults` 12 ← 13 (أُضيف `SN-04` بخامّه: `windowMs` و`coverPromptAtMs` و`readingsBeforeCover[]` و`readingsDuringCover[]` بعناصر `{t, values}`)؛ `manualResults` 4 ← 6 (أُضيف `M-08` بحالة `unavailable` و`M-19` بحالة `fail`؛ و`M-09` بحالة `warning` كان في عيّنات fv68 — مصنوع باليد في التطبيق).
- `manualResults[M-02]`: 11ch — `touchedCells` 87 ← 120، `elapsedMs` 4250 ← 4165، و`timeToFirstTouchMs` جديد (1730)؛ 13ch — الحالة pass ← fail، `endReason` auto_complete ← user_marked_not_working، `elapsedMs` 4250 ← 13800، `maxSimultaneousPointers` 3 ← 1، `timeToFirstTouchMs` جديد (2400)؛ 16ch — الحالة pass ← not_tested، `endReason` ← user_marked_not_tested، `touchedCells` 87 ← 0، `maxSimultaneousPointers` 3 ← 0، و`elapsedMs` **غائب** (لا لمسة، فلا `timeToFirstTouchMs` أيضاً).
- **حالات اليدوي الخمس كلّها في العيّنات:** `pass` و`fail` و`not_tested` و`unavailable` و`warning` (الأخيرة مصنوعة باليد؛ يرسلها التطبيق ≤ fv68 من M-02 عند عتبة 80% — **منقول، غير متحقَّق من مستودع التطبيق**).
- عدد أسطر `.keys.txt`: 288 و305 و302 (كانت 277 و294 و293)؛ والمسارات الجديدة مقابل عيّنة fv67: 138 (كانت 127).
- **لا تُعدَّل هنا** (القاعدة 12)، وتُعاد توليدها في التطبيق وتُنسخ (القاعدة 39). و`.gitattributes` يضع `-text` على `fv69-app-request-payload-derived-from-*` (كان على `fv68-…`).
- **قرّاؤها:** كل قارئ يُختبر عليها (القاعدتان 37 و41)؛ و`test/analyzeDeviceFv68.e2e.test.js` يمرّرها بـ`analyzeDevice` الحقيقية على المحاكي ويثبت أن الحقول الجديدة تصل `reportRaw/{scanId}` كما أُرسلت. **قراءات fv68 المشتقّة أدناه أُعيد توليدها من fv69** (أسماؤها ما زالت `fv68-readings-derived-from-…` لأن القارئ `readFv68`).

## إضافة — نقل الخامّ إلى reportRaw: عيّنات مستند التقرير بلا الخامّ وعيّنات الخامّ الستّ (V8 الجزء ١-ج، 2026-10-09 +03)

الحقول الخمسة `rawFingerprint` و`sessionId` و`deviceFingerprintSha` و`timeSeriesStoragePath` و`aiAudit` انتقلت من مستند `reports/{scanId}` المقروء إلى `reportRaw/{scanId}` (التفصيل: `docs/V7_DISPLAY_SHAPE_CONTRACT.md` §١٤).

- **أُعيد توليد ستّ عيّنات مستند تقرير بمولّداتها الفعلية** (مفاتيحها الخمسة غائبة الآن): `v7-reports-document-sample.json` و`-honor` و`-security-downgrade` و`-cpu-c06-downgrade` و`-zero-measured` و`-zero-measured-battery-harness-error`. الفرق عن النسخة السابقة: المفاتيح الخمسة المحذوفة فقط، وما هو عشوائي أو مقيس بتصميمه (`shortId`، و`aiDurationMs`، و`v5Metrics.bodyBuildMs` في عيّنتَي security وcpu) — مُتحقَّق بمقارنة الأوراق.
- **ستّ عيّنات خامّ جديدة** تُولَّد في التشغيل نفسه من المُدخلات نفسها (`buildReportRawDocument`): `v7-report-raw-sample.json` و`-honor` و`-security-downgrade` و`-cpu-c06-downgrade` و`-zero-measured` و`-zero-measured-battery-harness-error`. يحرسها الحارس نفسه (إعادة بناء ومقارنة)، وتصنَّف في `goldenFixturesGuardCoverage.test.js` ضمن «مولَّد ومحروس».
- **لم تُعَد:** `v6-reports-document-sample.json` (مولّدها يحتاج ملفّ تصدير خامّاً خارج المستودع)، و`v7-client-payload-sample*.json`، و`v7-verifyReport-response-sample*.json` — لا تحمل الحقول المنقولة، وsha256 لم يتغيّر. وأعيد أربعة ملفّات zero-measured (حمولة العميل وردّ verifyReport للمتغيّرين) إلى بايتاتها السابقة بعد أن غيّر المولّد `shortId` العشوائي فيها وحده.
- **اختبارات تقرأ المستند بالشكلين (تحديث 2026-10-09، الجزء ٢):** `exportV6ReportReadonly` و`exportV7ReportReadonly` و`exportV7ReplayInputsReadonly` صارت سكربتاتها تقرأ بـ`readReportRaw` (`scripts/lib/reportRawReaders.js`)، فتُختبر على الشكلين: `test/lib/legacyEmbeddedReport.js` (العيّنتان مدموجتَين: `EMBEDDED_LEGACY`) وعيّنتا المقروء والخامّ منفصلتين (`PRIVATE`)، ويُشترط أن يكون المخرَج واحداً.

## إضافة — طلب `analyzeDevice` كما يرسله 1.0.10 من ملفّ fv67: نسخة حرفية (ما قبل أوّل نشر V8، 2026-10-09 +03)

ثلاثة ملفّات بايتاً ببايت من مجلّد المنسّق `evidence/v8-phase0/fv67-1010-request-from-34dff2b8/` (بنى الطلب وكيل التطبيق بكود 1.0.10 نفسه، `NeuralChek@62507f4`، من `34dff2b8.ts.json` — sha256 `e451306b…` — في JVM):

| الملفّ | sha256 |
|---|---|
| `fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json` (204096 بايتاً) | `9551a9c6c5f0c7a08737c4e13e5fafac561b642f12040399811e6cd84f143d89` |
| `….keys.txt` (192 سطراً) | `830a65bc5512f2e959e2f6e7b81b55f3ccda69dadfec3a26d532e2e5f4e77d8f` |
| `….README.md` (README المجلّد المصدر: المصدر والسلسلة والقيود) | `eb25a29991e06507bfcb6c31f97e0a9a47c4aa37c8a4ce2ce63a5811dabe7b33` |

- **ما هو:** خريطة `data` التي يمرّرها 1.0.10 إلى `callable.call`: `{fingerprint, language: "ar", scanId, usePrecomputed: true}` **بلا `sessionId`** (يُضاف في حالة جلسة QR وحدها). الملفّ الزمني من `1.0.8-v6beta` (fieldsVersion 67) والطلب مبنيّ بكود 1.0.10: **حالة إعادة تحليل ملفّ fv67، كما يحدث فعلاً بعد التحديث** (قرار المستخدم، بنصّه).
- **مشتقّ لا مسجَّل** (القاعدة 9): لم يُرسَل من جهاز ولا من الإنتاج. وصفوف `TestResult` الستّة عشر و`DeviceInfo` و`deviceProfileKey` (قيم `synthetic-golden-*`، بأسمائها الكاملة لا a..f) مُبرمَجة؛ و`device.buildFingerprint/buildBoard/buildHardware/buildBootloader` غائبة (`null` في JVM)، ولا قراءة لها في `functions/src` (صفر نتيجة، مُتحقَّق بـ`git grep`)؛ و`measurements` غائبة من صفوف الاختبارات (لا حقل لها في 1.0.10). هذا كلّه من README المجلّد المصدر، منقول، غير متحقَّق من مستودع التطبيق.
- **لا تُعدَّل هنا** (القاعدة 12). `-text` في `.gitattributes` يمنع تحويل الأسطر. وتُحرَس بـ`test/fv67AppRequestGoldenCopy.test.js` (sha256 والتفكيك ومطابقة `.keys.txt`).
- **قارئها:** `test/analyzeDevice1010Compat.e2e.test.js` — الطلب كما هو عبر `analyzeDevice` الحقيقية على المحاكي (فردي، وجلسة QR بإضافة `sessionId`)، شرط النشر بقرار المستخدم.

## إضافة — قراءات fv68 المشتقّة: الفخّ الذهبي لقرّاء الخادم (V8 الدفعة ٤، 2026-10-09 +03)

أربعة ملفّات `fv68-readings-derived-from-*.json` — **مشتقّة** من المُدخلات المُلتزَمة أعلاه بقارئ fv68 في الخادم (`functions/src/analysis/fv68Reader.js`، الدالّة `readFv68`). لا نسخة حرفية من مستودع آخر ولا ردّ جهاز ولا فحص حقيقي.

| الملفّ | مُدخله (نسخة حرفية أعلاه) |
|---|---|
| `fv68-readings-derived-from-app-payload-11ch-nothing-admitted.json` | `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json` (fv69 منذ 2026-10-10؛ كانت fv68) |
| `fv68-readings-derived-from-app-payload-13ch-selinux-blocked-policy.json` | `…-13ch-selinux-blocked-policy.json` |
| `fv68-readings-derived-from-app-payload-16ch-four-policies-truncated-failures.json` | `…-16ch-four-policies-truncated-failures.json` |
| `fv68-readings-derived-from-fv67-request-1.0.10-62507f4.json` | `fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json`، الحقل `fingerprint` |
| `fv68-readings-derived-from-app-payload-fv70-11ch-nothing-admitted.json` | `fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json` (fv70، 2026-10-13: `partial:time_budget` ومتروكان) |
| `fv68-readings-derived-from-app-payload-fv70-13ch-selinux-blocked-policy.json` | `fv70-…-13ch-selinux-blocked-policy.json` (`ran`، وعدم تطابق في المرحلة 5: 78499) |
| `fv68-readings-derived-from-app-payload-fv70-16ch-four-policies-truncated-failures.json` | `fv70-…-16ch-four-policies-truncated-failures.json` (`ran`، و`native_call_failed` وnot_reached) |
| `fv68-readings-derived-from-app-payload-fv71-11ch-nothing-admitted.json` | `fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json` — **من المُنتِج** (NeuralChek@f9e0571 ثم 4c0102c ثم **3810146** نسخة حرفية، 2026-10-22 شكل اختبار اللمس في قائمة سامسونج): M-02 pass بـ`auto_complete` (18×33 = 594 خليّة منها 188 مطلوبة بنمط «إطار + X» و406 `notRequiredCells`، خليّة مربّعة 4 مم، 858 نقطة، `MATCH`؛ كانت 12×24 و108 و180 و624 على 4c0102c) · M-09 بحدث مفتاح وM-10 بتغيّر المستوى · `off`/`off` وبرمجة السطوع `not_attempted:value_not_decided` |
| `fv68-readings-derived-from-app-payload-fv71-13ch-selinux-blocked-policy.json` | `…-13ch-selinux-blocked-policy.json` — **من المُنتِج**: M-02 fail بثقب كاميرا (أربع خلايا: [8, 9, 26, 27]) على شبكة 18×35 و194 مطلوبة (97 ملموسة؛ كانت خليّتين و106 و75 على 4c0102c) وقفزتين (`gap_jump` و`coord_jump`) وراحة يد (`cancel_flagged`) وعلامتي `edge_exit` · M-09 «يعمل» بيد الفنّي وM-10 «لا يعمل» · `applied` بـ0.5 |
| `fv68-readings-derived-from-app-payload-fv71-16ch-four-policies-truncated-failures.json` | `…-16ch-four-policies-truncated-failures.json` — **من المُنتِج**: M-02 «لم أختبر» (194 مطلوبة، 6 ملموسة؛ كانت 106 و4 على 4c0102c) بـ15,000 نقطة (`pathCap.reached`، و300 مُسقَطة) وثلاثة غيابات بـ`read_failed:<نصّ>` · M-09 «لم أختبر» وM-10 `dismissed` · `read_failed` والمنطقيّان غائبان · `apply_failed` |

**المولّد:** `functions/scripts/generate-fv68-readings-derived.js` (يطبع الحالة بلا وسيط، ولا يكتب إلا مع `--write`).
**الحارس:** `functions/test/fv68ReadingsGolden.test.js` — (أ) يعيد البناء في الذاكرة ويقارن بالمُلتزَم بايتاً ببايت، (ب) أحكام المعنى مكتوبة باليد من العقد ومن الحمولة (لا نسخة من مخرَج القارئ) — فلا يتحوّل خطأ في القارئ إلى ذهب (القاعدة 30).
**التصنيف:** `test/goldenFixturesGuardCoverage.test.js` — مولَّدة ومحروسة. و`.gitattributes` يضع `-text` عليها (بلا ذلك يحوّل `core.autocrlf=true` نهايات الأسطر فيتغيّر sha256).

**القيد المُعلَن (القاعدة 41):** المُدخلات مشتقّة لا مسجَّلة من جهاز يعمل بـfv68. مرحلة ٢ — عيّنة جهاز حقيقية بعد صدور APK fv68 — لم تُنجَز. وحمولة 1.0.10 المشتقّة تحمل `appVersion = 1.0.8-v6beta` في ترويستها (ورثتها من `34dff2b8.ts.json`)، فوحدة الإنتاجية فيها «غير محدَّدة» لا MiB/s.

**(2026-10-18 +03، مزامنة fv71، أمر الباك اند ٢ البند ٠):** حلّت **ثلاث قراءات من حمولات المُنتِج** (`fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-*.json`، نسخ حرفية من NeuralChek@f9e0571 — القسم أدناه) محلّ **ست قراءات** كانت لعيّنات بنيتُها من العقد (M-02 وأزرار الصوت وP6-13 مرّتين لكلٍّ؛ حُذفت العيّنات ومولّداتها واختباراتها وREADMEs الثلاثة: القاعدة 23، لا تُترك بجانب عيّنة المُنتِج). والقراءات الأخرى السبع لم تتغيّر (فُحص بالفرق: sha256 أدناه لها كما كانت)؛ وأُعيد توليد القراءات الثلاث الجديدة بعد تعديل القارئ في الالتزام نفسه (القاعدة 39): `densityCheckUnrecognized` و`resampledFlagStateState` في `touchGrid.path`، وحذف شذوذ `TOUCH_PATH_CAP_INCONSISTENT`. **ما لا تغطّيه عيّنات المُنتِج** (يبقى بلا دليل مُنتِج ويُغطّى باختبارات وحدة بحمولات معدَّلة منها): الجدول في القسم التالي.

**sha256 العشرة** (كانت ثلاثة عشر قبل مزامنة fv71 2026-10-18: حذفت الست المبنيّة من العقد وأضيفت الثلاث من المُنتِج) (القاعدة 39: تُحدَّث عند كل إعادة توليد، والحارس يتحقّق منها؛ **الأربعة الأولى أُعيد توليدها 2026-10-13 +03** لأن قارئ D تغيّر شكل مخرَجه — عدّادا `sieveSkipped`/`shaSkipped` وحقول `skipped` و`sieve.limit` و`referencePrimeCount` و`primeCountVsReference` — والثلاثة الأخيرة جديدة من حمولات fv70). **أُعيد توليد السبعة كلّها مرّة ثانية 2026-10-13 +03 (الجزء الخامس):** أضاف القارئ عدّادَي `sieveCancelled` و`shaCancelled` (حالة `cancelled` معروفة للحالتين، ليست من EXECUTED_STATUSES) — فرق كل ملفّ سطران، والـsha256 أدناه بعد ذلك. لا حمولة من التطبيق فيها `cancelled` ولا `alloc_failed` للغربال بعد (عيّنات fv70 الثلاث لا تحملهما)، فاختبارهما في test/cpuKnownAnswerFv70.test.js بحمولات مشتقّة من العيّنات الذهبية بتعديل عنصر واحد، لا عيّنات ذهبية جديدة:

**(2026-10-21 +03، S-B5a، أمر الباك اند ٦ — القاعدة 39):** أُعيد توليد العشرة لأنّ `readFv68` صار يقرأ مفتاحين جديدين في قسم `verification`: `gpuFragmentHash` (`matches` و`total` وحالتاهما) و`gpuFenceTimeout` (`count` وحالته) — من المفاتيح `gpuFragmentHashMatches` و`gpuFragmentHashTotal` و`gpuFenceTimeoutCount` القائمة في تذييل كل حمولة (عقد fv68 :249، :261). لا فرق آخر في أيّ ملفّ (فرق كل ملفّ 10 أسطر مضافة بين `gpuGemm` و`criticalDefect`، بـ`git diff`). **الحمولات المُدخَلة لم تتغيّر.** الجداول أدناه بالتجزئات الجديدة.

```
524bc4a9106cb43c3228335e1bb7fd16041d0d76688227c8b709b5944e875214  fv68-readings-derived-from-app-payload-11ch-nothing-admitted.json
2b1a9e9c1a345043ed76f7824a95c41ab24d96f9ab24e6a824e422b320fb4cb1  fv68-readings-derived-from-app-payload-13ch-selinux-blocked-policy.json
a2abe20817d535b3cc27472b251af060827bf939ab0d7b82db5845223bdfb6c8  fv68-readings-derived-from-app-payload-16ch-four-policies-truncated-failures.json
edc435a3e21b1b9ae2662288e120f49752231ebb428f412d6c444b76aab237dd  fv68-readings-derived-from-fv67-request-1.0.10-62507f4.json
a4e48a3e6f7b59a2f94e8d1f259945da7d2b9a1231cab203f65a9996fd746c0c  fv68-readings-derived-from-app-payload-fv70-11ch-nothing-admitted.json
2ca6f515d36b92f0a13cb56a9f9c06de746097cf76d3f2dd5607df20efa97234  fv68-readings-derived-from-app-payload-fv70-13ch-selinux-blocked-policy.json
9c4c7ddeed257fd8306b8d43ceec49e3b144219220d52441f82b13eefae0b9c2  fv68-readings-derived-from-app-payload-fv70-16ch-four-policies-truncated-failures.json
ce321cd809e92ead718b8d4a31787bc6f6f266c172db902037bd5ca50e0698da  fv68-readings-derived-from-app-payload-fv71-11ch-nothing-admitted.json
d21671d1266a139b79249ff8e29565c17c28512f8bce8570d84ff3a878494013  fv68-readings-derived-from-app-payload-fv71-13ch-selinux-blocked-policy.json
c31acf46e18cef5d538eba70b84b1b1e5f628ab5fec2039a7e7f63ebd17ba8b4  fv68-readings-derived-from-app-payload-fv71-16ch-four-policies-truncated-failures.json
```

## إضافة — حمولات التطبيق على fv71 من المُنتِج: نسخ حرفية (مزامنة 2026-10-18 +03، أمر الباك اند ٢ البند ٠، القاعدتان 7 و41)

ستّ ملفّات بايتاً ببايت من `NeuralChek@f9e0571` — **ثم استُبدلت بايتاتها 2026-10-21 بما أعاد التطبيق توليده في `4c0102c` (انظر القسم «M-02 إطار + X»؛ أحجامها 229,202 و257,018 و545,521 بايتاً) ثم استُبدلت الـ`.json` الثلاثة ثانيةً 2026-10-22 بتوليد `3810146` (القسم الأخير؛ أحجامها 232,478 و256,929 و472,206 بايتاً؛ الـ`.keys.txt` بلا تغيير)** (fieldsVersion 71: A-M02 وA-VOL وA-P6-13؛ **منقول من أمر المنسّق، غير متحقَّق من المستودع المصدر**) عبر مجلّد المنسّق `evidence/run-2026-10-18/fv71-producer-goldens/`: ثلاثة `.json` (228,287 و256,334 و545,414 بايتاً) وثلاثة `.keys.txt`. **صنعها اختبار التطبيق الذهبي من سلسلته الحقيقية** (لا من العقد كما كانت عيّناتي التي حلّت هذه محلّها) — فهي الحمولة بشكل المُنتِج (القاعدة 41)، **مشتقّة لا مسجَّلة من جهاز** (`appVersion` مولَّد في التطبيق).

```
ffaa4c0eb639436f81fac7154046b0e1d23abd78e270db961459010adc5e4268  fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json
76bd343269d75fe024390a8a9a5b2c84ec79fc4c08ad1e752ce7f64b36b9b335  fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json
82c11219cea5e917a9693bd85e455e65a84f1928c370779bca1d57f81247106a  fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json
41115aafd3cedd2f5a4dc8d5f6c8b99edefdb8f80a12cb9ed3a417195739775e  fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.keys.txt
98f7884e8adaeff66ad63bce8dc24026f389d942a169e18ece07ecc1b1931b5e  fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.keys.txt
4765ebae1fe675ea164f796b2e607ab3be0219ffce1ac6dc95bc4e519ff2f3a3  fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.keys.txt
```

- **sha256:** محسوبة هنا بـ`sha256sum` على الملفّات المنسوخة؛ بادئات الثلاثة الأولى تطابق نصّ الأمر (`c52d8ebf…` · `1c0e0391…` · `7e786b56…`). **لا README في مجلّد المنسّق** يحمل القيم الكاملة، فالتطابق الكامل مع README التطبيق **منقول، غير متحقَّق**. تُحرس بـ`test/fv68AppPayloadGoldenCopy.test.js` (مجموعة ثالثة FV71: sha256 والتفكيك ومطابقة `.keys.txt`). `.gitattributes`: `-text` عليها.
- **لا تُعدَّل هنا** (القاعدة 12). **قرّاؤها:** `test/fv71ProducerSamples.test.js` (القارئ الحقيقي وأحكام بمرجع مستقلّ وبصمة تغطية) · `test/fv71TouchGridReader.test.js` وfv71VolumeButtonReader وfv71ScanConditionsReader وfv71ModelPayloadRaw · `test/analyzeDeviceFv71ProducerSamples.e2e.test.js` (analyzeDevice الحقيقية على المحاكي) · `scripts/generate-fv68-readings-derived.js` (ثلاث قراءات ذهبية).
- **ما تُظهره:** M-02 بـpass/auto_complete وfail (ثقب · قفزتان · راحة يد · edge_exit) وnot_tested بسقف 15,000؛ وكل endReason الخمس لأزرار الصوت وكلتا detectionSource؛ وpowerSaveState `off`/`off`/`read_failed`؛ وbrightnessLock الثلاث (`not_attempted:value_not_decided` · `applied` · `apply_failed`).

### الفروق بين افتراضاتي التركيبية وما أنتجه المُنتِج (الجدول، 2026-10-18)
| الموضع | افتراضي التركيبي | المُنتِج (العيّنات والقسم) | ما فعلتُه |
|---|---|---|---|
| أسماء شروط `densityCheck` | نصّ حرّ يمرّ بلا تصنيف | القسم [ق]: خمسة (`xdpi_or_ydpi_not_positive` · `xdpi_ydpi_differ_over_5pct` · `phone_width_outside_55_85mm` · `both_candidates_plausible` · `display_width_unknown`)، و«[] ما لم يُستعمل DENSITY_DPI_FALLBACK»؛ والعيّنات الثلاث `[]` | عدّلتُ القارئ: تعداد + شذوذ للمجهول + علاقة الاحتياط. **الأسماء من نصّ القسم وحده** (لا عيّنة تحملها) و[ق] لم تُعتمد |
| قيم `resampledFlagState` | نصّ حرّ | القسم [ق، معلّق: مواصفة غائبة]: `not_available_api` (API < 35) · `not_read_by_app` (API ≥ 35)؛ العيّنات `not_available_api` | عدّلتُ: تعداد القيمتين وشذوذ للمجهول. **دلالة المفتاح معلّقة** فلا يحكم بها القارئ |
| اصطلاح الخلية والحافّة | `floor(x ÷ cellWidthPx)` مقصوصة؛ الحافّة حافّة السطح المحلّي | touchedCells/untouchedCells/cutoutCells المشحونة = عدّ مستقلّ (0.25 بكسل) في الثلاث، و`cells.state = MATCH`؛ القسم: x/y في إطار السطح المحلّي | لا تعديل في المنطق؛ حُدّث نصّ `conventions` |
| موضع `batteryWindowPct` | التذييل (ملتبس في جدول القسم: «جذر الحمولة/التذييل») | `timeSeries.footer` في الثلاث، وليس في الجذر | لا تعديل |
| المفاتيح الثلاثة معاً | اشترطتُ حضورها معاً في ≥ 71 | حاضرة معاً في الثلاث (الترويسة والجذر والتذييل) | لا تعديل |
| المنطقيّان عند `read_failed` | غائبان لا `false` | غائبان في 16ch (لا `isPowerSaveMode` ولا `powerSaveMode`) | لا تعديل |
| سقف النقاط وحجم الخامّ | تركيبي: 15,000 نقطة بخمس منازل = M-02 448,355 بايتاً ومستند 467,128؛ فقدّرتُ أن الحارس 900,000 يُخفق عند نحو 29.5 ألف نقطة | سقف 15,000 معلَن ومعتمد (E18). **المقيس من ملفّ 16ch:** M-02 = 275,515 بايتاً لـ15,000 نقطة (18.37/نقطة) ومستند reportRaw = 318,535. القسم: 443,706 بايتاً لـ15,000 نقطة (`TouchGridRecorderTest`: **منقول، غير متحقَّق**) | لا تعديل؛ الحارس لا يُبلَغ بالسقف في الرقمين (حسابٌ تركيبي) |
| `pathCap.reached` و`pointsDropped` | `reached=false` مع `pointsDropped>0` تناقض (`TOUCH_PATH_CAP_INCONSISTENT`) | القسم: «عيّنة غير منتهية لا تُكتب وتُعدّ في `pathCap.pointsDropped`»؛ `reached` = بلغت المسجَّلة maxPoints | عدّلتُ: أُزيل الشذوذ؛ أُضيف `TOUCH_PATH_CAP_REACHED_POINTS_MISMATCH`، وصار `TOUCH_PATH_POINTS_EXCEED_CAP` عند ≥ لا > |
| مفاتيح الكثافة الخمسة | REASONED (غيابها بسبب مقبول) | قائمة `absentFieldReasons` في القسم عشرة أسماء ليس بينها الكثافة؛ والعيّنات تحملها | عدّلتُ: ALWAYS |
| `unbufferedDispatch` | منطقيّ REASONED | القسم: `true` إن نجح الطلب وإلا غائب بسببه | أُضيف شذوذ لـ`false` |
| عدّادا الصوت وعائلة المفاتيح | معنى العدّادين معلّق فلا تُفرض علاقتهما بـevents[] | القسم: «ضغطات down بـrepeat = 0»، والمسجَّل «عائلة الصوت 24 · 25 · 164» وغيرها يُهمَل | عدّلتُ: علاقة العدّادين بـevents[] حين القائمة كاملة + شذوذ لمفتاح خارج العائلة |
| `brightnessLock` عند `apply_failed` | `method: system_setting` و`value: 0.5` | `method: window_attribute` و`value: 0.4` (حاضران مع الفشل)؛ و`not_attempted:value_not_decided` بلا value ولا method | لا تعديل (القارئ يقبل الحالتين) |
| `edge_exit` | يكشفه الخادم من قفزة أو رفع بعودة | المُنتِج يعرضه عند up قرب الحافّة بحسب الاتجاه (13ch: علامتان لم يكشفهما الخادم) | لا تعديل: «معروض لا مكشوف» يُرى؛ **معلّق:** قاعدة المُنتِج (الهامش والاتجاه) غير محدَّدة في القسم |

### ما لا تغطّيه عيّنات المُنتِج الثلاث (يبقى بلا دليل مُنتِج؛ يُغطّى باختبارات وحدة بحمولات معدَّلة منها — والبصمة مكتوبة في `fv71ProducerSamples.test.js` الكتلة «هـ»)
M-02: `pass` بلا measurements (بعد 5f90ce1) · **`gridPattern = ALL_CELLS`** (الثلاث كلّها FRAME_AND_DIAGONALS؛ تُغطّى بحمولات معدَّلة في `fv71M02FrameXReader.test.js`) · **غياب `gridPattern`/`notRequiredCells` (NOT_DECLARED) تغطّيه نسختان حقيقيتان من المُنتِج السابق** (`fv71-before-m02-frame-x-*`) · `endReason = dismissed` · `strokes[].end = cancel` · `toolType` غير touch · `densitySource = DENSITY_DPI_FALLBACK` وأيّ عنصر في `densityCheck` · `resampledFlagState = not_read_by_app` · أسباب الغياب `api_below_<n>` و`not_reported_by_device` · `reached = true` مع `pointsDropped` من عيّنة غير منتهية · أزرار الصوت: قائمة events فوق 64 وقيم `flags` · P6-13: `powerSaveState = on` · `not_attempted:no_scan_screen_reported` · طريقة `system_setting` · بداية الشحن خارج 30–85 (`BELOW_MIN`/`ABOVE_MAX`).

## إضافة — `evaluationRulesVersion` في عيّنات مستند التقرير (ختم قواعد التقييم، 2026-10-13 +03، القاعدة 39)

ستّ عيّنات مستند `reports/{scanId}` أُعيد توليدها بمولّداتها (`generate-v7-reports-document-sample*.js`) في الالتزام نفسه الذي أضاف الحقل إلى `buildReportDocument`:
`v7-reports-document-sample.json` و`-cpu-c06-downgrade` و`-honor` و`-security-downgrade` و`-zero-measured` و`-zero-measured-battery-harness-error`.
**الفرق في كلٍّ منها سطر واحد مُضاف: `"evaluationRulesVersion": "rules-2026-10-13-zero-cycles-unsupported"`** (يلي `appVersion`). `shortId` (عشوائي بتصميمه) و`bodyBuildMs` (زمن) أُبقيا بقيمتيهما المُلتزَمتين.
لم تتغيّر: عيّنات `reportRaw` و`v7-client-payload-sample*` و`v7-verifyReport-response-sample*` (الختم لا يصل الإرجاع ولا `verifyReport`)، ولا `v6-reports-document-sample.json` (مستند «كُتب قبل الختم» بلا الحقل — مولّدها بلا مُدخل في المستودع، `docs/V7_DISPLAY_SHAPE_CONTRACT.md` §١٤).
العقد: `docs/V7_DISPLAY_SHAPE_CONTRACT.md` §١٥. حارس الحقل: `test/evaluationRulesVersion.test.js`.

## إضافة — رفع ختم قواعد التقييم: إعادة توليد عيّنات مستند التقرير الستّ (2026-10-23 +03، قرار حسن، القاعدة 39)

العيّنات الستّ نفسها (`v7-reports-document-sample.json` و`-cpu-c06-downgrade` و`-honor` و`-security-downgrade` و`-zero-measured` و`-zero-measured-battery-harness-error`) أُعيد توليدها بمولّداتها في الالتزام نفسه الذي رفع `EVALUATION_RULES_VERSION`.
**الفرق في كلٍّ منها سطر واحد: `"evaluationRulesVersion"` من `"rules-2026-10-13-zero-cycles-unsupported"` إلى `"rules-2026-10-23-hardware-absent-coverage"`.** `shortId` و`aiDurationMs` و`bodyBuildMs` (عشوائي/زمن بتصميمها) أُبقيت بقيمها المُلتزَمة.
لم يتغيّر شيء آخر في هذا المجلّد: عيّنات `reportRaw` و`v7-client-payload-sample*` و`v7-verifyReport-response-sample*` و`v6-reports-document-sample.json` (مخرَج مسجَّل من جهاز لا يُعدَّل ولا يُعاد توليده).
العقد: `docs/V7_DISPLAY_SHAPE_CONTRACT.md` §١٥. حارس الحقل: `test/evaluationRulesVersion.test.js`.

## إضافة — حمولات التطبيق على fv70: نسخ حرفية (قرّاء D، 2026-10-13 +03)

ستّ ملفّات بايتاً ببايت من `NeuralChek@80ca8c3` (§٧-ط من عقد التطبيق؛ **منقول من أمر المنسّق، غير متحقَّق من المستودع المصدر**) عبر مجلّد المنسّق `scratchpad/be-d-readers-2026-10-13/goldens-from-app-80ca8c3/` ومعه `SHA256SUMS.txt`. تحقّقتُ من كل sha بـ`sha256sum -c` قبل النسخ وبعد الالتزام (`git show HEAD:<path> | sha256sum`). الأسماء `fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-{11ch-nothing-admitted,13ch-selinux-blocked-policy,16ch-four-policies-truncated-failures}.{json,keys.txt}`.
**المجلّد القديم `goldens-from-app-dc5e5ce` لم يُستعمل** (صار قديماً: غيّر التطبيق العيّنات في `80ca8c3`).

```
1f85392014ecd79c0d2bd89b4985c36f0c785c0471647204b3434db46db4dadb  fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json
a46f60f163d3ed71c14d82d9ff86df77304de4d81cec96c3b6f59dee5b525e92  fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json
841dbd4ff0fdce3a7392d862cd094bafbeb5c588e5550c9af2635f410b85cb9e  fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json
0dc19ce36290f17fa5b528ca6968fcca6eec4dac97aa9446083c591059d589b3  fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.keys.txt
1634ec58f3b4cb3ab0799ac64047a4f0076635e96de587ac6c244c4f27113c32  fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.keys.txt
2e5f17855a5a252a4521c836f648a7d7b5e2240ce19fb9269f2a81e08863285a  fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.keys.txt
```

- **ما تحمله (D للمعالج):** `cpuKnownAnswerRuns[].sieveLimit` (1000000) · `sievePrimeCount` 78498 · القيمة `skipped:time_budget` في `sieveStatus` و`sha256Status` · `cpuKnownAnswerState = partial:time_budget` (11ch: عنصران متروكان في المرحلة 3 بمفاتيحه الأربعة وحدها `phase`/`plannedAtPct`/`sieveStatus`/`sha256Status`، ومجموع المرحلة 3 = 410) · 13ch: `ran` وعدم تطابق (78499) · 16ch: `ran` مع `native_call_failed` و`not_reached`. وعيّنات التطبيق زادت معها SN-08/SN-09 وتفاصيل L-02 في `functionalResults` (مقروءة بلا شذوذ).
- **مشتقّة لا مسجَّلة من جهاز** (القاعدة 41)، وترويستها `appVersion = 1.0.11` (مولَّدة في التطبيق): لا يُستنتج منها إصدار تطبيق.
- **عيّنات fv69 تبقى — السبب:** التطبيقات القديمة (1.0.11) ما زالت ترسل 69، وعيّنات fv69 هي الدليل الوحيد بشكل المنتِج الحقيقي على دلالتين يجب أن يبقى القارئ يقرؤهما: «بلا `sieveLimit` ⟵ N = 10000000 والمرجع 664579» و«`ran` بلا متروك». حذفها يُسقط حراسة ما يصل فعلاً من الميدان. تبقى بـ`-text` وsha256 في `test/fv68AppPayloadGoldenCopy.test.js` (مجموعتان: fv69 وfv70).
- **`.gitattributes`:** `fv70-app-request-payload-derived-from-*.json` و`*.keys.txt` بـ`-text` (بلا ذلك يحوّل `core.autocrlf=true` نهايات الأسطر فيتغيّر sha256).
- **قرّاؤها:** `test/cpuKnownAnswerFv70.test.js` وفخّ القراءات `fv68ReadingsGolden.test.js` (ثلاثة ملفّات قراءات جديدة، أعلاه).

## إضافة — أجسام الرفض الجديدة وردّ checkSubscription بشكله الحالي (A-SUB الموجة الأولى، القرار ١٤، 2026-10-17 +03، القاعدتان 39 و41)

ملفّان **مولَّدان** بـ`scripts/generate-refusal-wire-samples.js` ومحروسان بـ`test/refusalWireGoldenGuard.test.js` (يعيد البناء ويقارن حرفاً بحرف، ويقارن القوائم المغلقة بالوحدات وبالعقد §٦-د-١):
- `refusal-wire-samples-asub-wave1.json` — 26 عيّنة (الأربع قبل الأخيرتين من البند ٢ 2026-10-17: التقرير المخزَّن لمالكه وحده، SESSION_REPORT_NOT_AVAILABLE وSCAN_REPORT_NOT_AVAILABLE؛ وعيّنتا البند ١ 2026-10-17: `createScanSession.SHOP_PLAN_REQUIRED.free` و`.plan-absent`): رفضا `createScanSession` (SHOP_NO_CREDIT وSHOP_SUBSCRIPTION_EXPIRED) ورفض الباقة عند الإنشاء (SHOP_PLAN_REQUIRED، من sessionNames.js CREATE_SESSION_REFUSAL)، ورموز رفض `analyzeDevice` على الجلسة (SESSION_NOT_PARTICIPANT · NOT_STARTED · COMPLETED · CANCELLED · EXPIRED · EXPIRES_AT_INVALID · STATUS_UNKNOWN)، وبوّابة `analyzeDevice` المبكّرة (الخمسة القائمة منذ S-SUB ولم تُسجَّل ذهبياً من قبل)، ورفض `requestPayment` للمجهول.
- `check-subscription-wire-samples-current-shape.json` — 7 عيّنات لردّ `checkSubscription` **بالشكل الحالي** (قبل القرار ٨ المؤجَّل — بصمة الجهاز؛ ستُعاد عند تنفيذه): ALLOWED · SUBSCRIPTION_EXPIRED (Timestamp، نصّ ISO، رقم ms) · NO_CREDIT · free بلا expiresAt · بلا مستند users.
**ما هو «الجسم»:** حالة HTTP + جسم الردّ كما يكتبهما غلاف onCall الحقيقي (`{error: HttpsError.toJSON()}` أو `{result: encode(...)}`)، لا HttpsError في الذاكرة. **حقيقي:** الغلاف والدوالّ المُصدَّرة والحرّاس وفئة Timestamp من firebase-admin. **مستبدَل:** `db` في الذاكرة بمستندات اصطناعية، وتوكن غير موقَّع بميزة skipTokenVerification. **غير متحقَّق:** أشكال `expiresAt` في الإنتاج، وسلوك التطبيق عند هذه الأجسام؛ ولم تُولَّد عيّنة من محاكي Firestore (غير مأذون في هذه الموجة).

## إضافة — M-02 «إطار + X»: استبدال عيّنات المُنتِج بالتوليد الجديد (2026-10-21 +03، أمر الباك اند ٤، القواعد 7 و12 و23 و39 و41)

الملفّات الستّة `fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-*` **استُبدلت بايتاتها** بما أعاد التطبيق توليده من مُنتِجه الحقيقي (`NeuralChek@4c0102c`، `NC_REGENERATE_GOLDEN=1`)؛ منقولة من مجلّد المنسّق `evidence/run-2026-10-18/fv71-producer-goldens-4c0102c/` بـ`cp` بايتاً ببايت **بلا تعديل حرف** (`sha256sum -c SHA256SUMS.txt` هناك: OK للستّة، وsha256 هنا = تلك القيم؛ المصدر في `fv71-producer-goldens-4c0102c.SOURCE.txt`). أسماؤها لم تتغيّر فلا يلزم تغيير مسار قارئ.

**ما تغيّر في الحمولات (فرق مقيس بين المجموعتين، `git diff` على الملفّات):** مفتاحان جديدان في `manualResults[M-02].measurements` — `gridPattern = "FRAME_AND_DIAGONALS"` و`notRequiredCells` (180 فهرساً في الثلاث) — و`totalCells`/`touchedCells`/`untouchedCells` صارت للخلايا **المطلوبة** وحدها (إطار وقطران ناقصاً الكاميرا): `288 ← 108` في 11ch، و`286 ← 106` في 13ch وفي 16ch، و`touchedCells` 208 ← 75 (13ch) و12 ← 4 (16ch)، و`untouchedCells` أقصر. **لا مفتاح آخر أضيف ولا سُمّي من جديد.**

**الحاكم:** `docs/FV71_CONTRACT_SECTION.md`، الحاشية «تحديث 2026-10-21 (أمر وكيل التطبيق ٨)» (عقد السلك: البنود 1–8). **القارئ:** `fv68Reader.js` (`readGridPatternKeys` و`readTouchPath` ← `requiredCellsBasis`) و`touchPath.js` (`recomputeCells`: المطلوب = الشبكة − cutoutCells − notRequiredCells)؛ **المصدر الواحد للأسماء:** `fv68Names.js` (`TOUCH_GRID_PATTERN_KEYS` · `TOUCH_GRID_PATTERN` · `TOUCH_GRID_PATTERN_STATE` · `TOUCH_GRID_REQUIRED_CELLS_BASIS` · `TOUCH_GRID_PATTERN_ANOMALY`).

**القراءات الذهبية الثلاث `fv68-readings-derived-from-app-payload-fv71-*` أُعيد توليدها** بـ`scripts/generate-fv68-readings-derived.js --write` في الالتزام نفسه (القاعدة 39): والسبع الأخرى **مطابقة بايتاً** قبل الكتابة (حكم المولّد «مطابق» لها كلّها: لم يتغيّر سلوك القارئ على ختم ≤ 70، وهو شرط الأمر). sha256 الجديدة في الجدول أعلاه.

**نسختان باقيتان من المجموعة السابقة (القاعدة 12: لا تُعدَّل؛ مقروءتان من blob الالتزام السابق):**

```
c52d8ebf6ae213eb35edf1c856f40bd1dfcb78728ef7ce0dcaff3978842d0e7f  fv71-before-m02-frame-x-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json
1c0e0391887afad2634bfb8aac4d47269c228ed5513db1aa504a908b85b5f4ba  fv71-before-m02-frame-x-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json
```

دليل **مُنتِج حقيقي** على ما يرسله بناء الجولة 324578f وما قبله: ختم 71 **بلا** `gridPattern` ولا `notRequiredCells` ⟵ `gridPatternState = NOT_DECLARED` (حالة صريحة، **ليست شذوذاً**، وتبقى العلاقتان القديمتان). يقرؤهما `test/fv71M02FrameXReader.test.js` (sha256 + القارئ الحقيقي). تُصنَّف في `goldenFixturesGuardCoverage.test.js` مُدخلاً موثَّقاً. لا قراءة ذهبية مولَّدة منهما.

### الفروق بين العقد والمُنتِج الحقيقي في «إطار + X» (فُحصت بالقارئ والعدّ المستقلّ)
| الموضع | العقد (wire-m02-frame-x، البنود 1–8) | المُنتِج (العيّنات الثلاث) | الحكم |
|---|---|---|---|
| العلاقة 2 `totalCells = cols×rows − عدد cutoutCells − عدد notRequiredCells` | حاكمة | 108 = 288−0−180 · 106 = 288−2−180 · 106 | تطابق (`fv71ProducerSamples.test.js` + `fv68ReadingsGolden.test.js`) |
| العلاقة 1 انفصال القائمتين | منفصلتان | `cutoutCells` = [5, 6] (الصفّ الأوّل) و`notRequiredCells` لا تحوي 5 ولا 6 | تطابق |
| حدّ الإطار الأدنى (البند 6) | لا خلية من الحواف الأربع في `notRequiredCells` | لا واحدة في الثلاث (عدّ مستقلّ في الاختبار) | تطابق |
| العلاقة 3 `touchedCells` للمطلوبة وحدها | لمسة في غير مطلوبة لا تُحسب، والخامّ لا يُمسّ | 11ch: المسار يلمس 288 خلية (180 غير مطلوبة)، و`touchedCells` = 108 | تطابق (`cells.state = MATCH` والمسار يحصي اللمس خارج المطلوب بجانبها: `pathTouchedNotRequiredCount`) |
| `gridPattern` | قيمتان | `FRAME_AND_DIAGONALS` في الثلاث | تطابق (`ALL_CELLS` غائبة عن العيّنات: تُغطّى بحمولات معدَّلة منها) |
| هندسة القطرين | للتطبيق وحده (القاعدة 24) | — | **لا تُنسخ إلى الخادم**؛ الخادم يقرأ `notRequiredCells` كما شُحنت |

> **(2026-10-22 +03)** أرقام الجدول أعلاه (12×24 و108 و106 و180) هي أرقام `4c0102c`؛ **استُبدلت بأرقام `3810146` في القسم التالي** (الثلاثة `.json` وحدها؛ الـ`.keys.txt` الثلاثة والعلاقات نفسها).

## إضافة — M-02 بشكل اختبار اللمس في قائمة سامسونج: استبدال الـ`.json` الثلاثة بتوليد التطبيق (2026-10-22 +03، أمر الباك اند ٧، القواعد 12 و23 و29 و39 و41)

الملفّات الثلاثة `fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-{11ch,13ch,16ch}-*.json` **استُبدلت بايتاتها** بما أعاد التطبيق توليده من مُنتِجه الحقيقي (`NeuralChek@3810146`)، والـ`.keys.txt` الثلاثة **بلا تغيير** (sha256 نفسها: لا مفتاح جديد ولا مُعاد تسميته؛ `gridPattern` كما هو). نُسخت بـ`cp` بايتاً ببايت من شجرة التطبيق بقراءة فقط؛ **sha256 الستّة تطابق الكتلة بين `golden-sha256:begin` و`golden-sha256:end` في `app/src/test/resources/derived/README.md` هناك كاملةً** (`sha256sum -c` و`cmp`: OK للستّة). المصدر وقيم sha256 كاملة في `fv71-producer-goldens-3810146.SOURCE.txt` (حلّ محلّ سجلّ `4c0102c` بـ`git mv`). **sha256 الجديدة للثلاثة `.json`** في القسم الأعلى («حمولات التطبيق على fv71 من المُنتِج») مُحدَّثة.

**ما تغيّر في الحمولات (فرق مقيس: فرق أوراق JSON بين المجموعتين، ثم عدّ مستقلّ من الملفّ نفسه بأخذ عيّنات نقطية — لا من مخرَج القارئ):**

| الحقل | 11ch | 13ch | 16ch |
|---|---|---|---|
| الخليّة (`cellTargetMm`) والبُعد | 6 ← **4** مم؛ 90×87.5 ← **60×60** بكسل | 6 ← **4**؛ 120×123.33 ← **80×80** | 6 ← **4**؛ 120×123.33 ← **80×80** |
| `gridCols`×`gridRows` | 12×24 ← **18×33** (594 خليّة) | 12×24 ← **18×35** (630) | 12×24 ← **18×35** (630) |
| الشريط العلويّ الفارغ (`surfaceOriginYPx`) و`surfaceHeightPx` | 0 ← **120**؛ 2100 ← **1980** | 0 ← **160**؛ 2960 ← **2800** | 0 ← **160**؛ 2960 ← **2800** |
| `cutoutCells` | [] (بلا تغيّر) | [5, 6] ← **[8, 9, 26, 27]**؛ `cutoutRectsPx[0]`: bottom 64 ← **250**، right 740 ← **780** | كما 13ch |
| `notRequiredCells` | 180 ← **406** | 180 ← **432** | 180 ← **432** |
| المطلوبة (`totalCells`) | 108 ← **188** | 106 ← **194** | 106 ← **194** |
| `touchedCells` | 108 ← **188** | 75 ← **97** | 4 ← **6** |
| `untouchedCells` | 0 | 31 ← **97** | 102 ← **188** |
| النقاط | 624 ← **858** (خطّ واحد) | 438 (ثلاثة خطوط، بلا تغيّر) | 15,000 (بلا تغيّر؛ 300 مُسقَطة، `reached`) |
| حجم `.json` بالبايت | 229,202 ← **232,478** | 257,018 ← **256,929** | 545,521 ← **472,206** |

**العلاقات على العيّنات الجديدة (عدّ مستقلّ من الملفّ):** العلاقة 2 `totalCells = cols×rows − |cutoutCells| − |notRequiredCells|`: 188 = 594−0−406 · 194 = 630−4−432 · 194 = 630−4−432. انفصال القائمتين: بلا تقاطع في الثلاث. حدّ الإطار الأدنى (البند 6): لا خلية من الحواف الأربع في `notRequiredCells` في الثلاث. العلاقة 3: 11ch يلمس مساره الخلايا الـ594 كلّها (188 مطلوبة و406 غير مطلوبة) و`touchedCells` = 188؛ 13ch: 314 خلية ملموسة منها 97 مطلوبة (و213 غير مطلوبة)؛ 16ch: 18 خلية ملموسة منها 6 مطلوبة (و12 غير مطلوبة). **المطلوب في 11ch وفي 13ch/16ch (188 و194) والمضاءة في 16ch (6) هي الأرقام التي سمّاها أمر المنسّق قبل التشغيل** (تطابق).

**الاختبارات التي كانت تثبّت أرقام العيّنات السابقة واستُبدلت أرقامها** (القاعدة 23: بالاستبدال لا بالإضافة؛ **لا كود إنتاج عُدِّل** ولا قارئ؛ والأرقام الجديدة من عدٍّ مستقلّ من الملفّ نفسه لا من مخرَج القارئ): `fv68AppPayloadGoldenCopy.test.js` (جدول sha256 للثلاثة `.json`) · `fv71M02FrameXReader.test.js` (الأبعاد وعدّ المطلوبة وغير المطلوبة والملموسة والفهارس الخارجة عن الشبكة وفهارس الإطار) · `fv71TouchGridReader.test.js` (الكتلة «ز»: 858 نقطة والعلاقات وفهارس cutoutCells) · `fv71ProducerSamples.test.js` (الخليّة 4 مم و406 و432، وتكرار خطّ 16ch خمس مرّات لا أربع) · `fv68ReadingsGolden.test.js` (سطر 13ch: مقصاة [8، 9، 26، 27] و194 و97) · `goldenFixturesGuardCoverage.test.js` (اسم سجلّ المصدر) · `analyzeDeviceFv71ProducerSamples.e2e.test.js` (تكرار الخطّ؛ **عُدِّل ولم يُشغَّل**: e2e تحت المحاكي وحده).
**الحجم المقيس على العيّنات الجديدة** (طباعة `fv71ProducerSamples.test.js` من الملفّات): M-02 في 16ch = 201,940 بايتاً لـ15,000 نقطة (13.46 للنقطة؛ كانت 275,595 و18.37) ومستند reportRaw = 244,960 (كان 318,615، وأربع مرّات 1,138,311)؛ وتكرار خطّه أربع مرّات يعطي مستنداً 839,656 بايتاً (تحت الحارس 900,000)، وخمساً 1,037,888 (فوقه) — قياس `buildReportRawDocument` و`measureReportRawBytes` نفسيهما.

**القراءات الذهبية الثلاث `fv68-readings-derived-from-app-payload-fv71-*` أُعيد توليدها** بـ`scripts/generate-fv68-readings-derived.js --write` (الأداة الوحيدة التي تولّدها؛ القاعدة 39) في الالتزام نفسه، **والسبع الأخرى مطابقة بايتاً قبل الكتابة وبعدها** (حكم المولّد «مطابق» لها كلّها). الفرق في الثلاث كلّه تحت `measurements.items[4].touchGrid` (الشبكة والعدّادات والسطح وحواف المسار و`analysis.cells.*` و`notRequiredCells` و`untouchedCells` و`cutout*` و`strokes`)؛ **`anomalies` فارغة كما كانت** و`readerVersion`/`fieldsVersion` بلا تغيير. sha256 الجديدة في الجدول أعلاه.

## إضافة — عيّنات طلبات التطبيق لربط «قبل/بعد صيانة»: خمس نسخ حرفية من NeuralChek@fed7d12 (2026-10-22 +03، أمر المنسّق بعد 29baa10؛ القواعد 12 و25 و29 و37 و39 و41)

خمسة ملفّات `maintenance-pair-request-*.json` هي **طلبات** (حقل `data` للدوالّ الثلاث) كما يبنيها التطبيق بـ`SessionPurposeWire.request` و`PairLinkWire.listRequest` و`PairLinkWire.confirmRequest` — **لا ردود الخادم** (ردودنا عيّنتها `maintenance-pair-wire-samples-2026-10-22.json` المولَّدة هنا) و**لا حمولة التحليل** (لا `fieldsVersion`). نسخ حرفية بـ`-text`؛ المعرّفات فيها مختلَقة (`sess-golden-*`، `scan-golden-before-1`). سجلّ المصدر والبصمات الكاملة: `maintenance-pair-app-requests-fed7d12.SOURCE.txt`.

| الملفّ | ما يُظهره | sha256 |
|---|---|---|
| `maintenance-pair-request-set-session-purpose-maintenance-before-battery.json` | `{sessionId, purpose: maintenance_before, defectType: BATTERY}` | `cc0589180dc89bdc4ddba094e9ce03d6c76364b5a0e61b871195758f37c1683e` |
| `maintenance-pair-request-set-session-purpose-maintenance-after-charging-port.json` | `{sessionId, purpose: maintenance_after, defectType: CHARGING_PORT}` | `1cd639ca23ee64198e2042f9e53282da5ef13420a213f684f03730c23bb684bb` |
| `maintenance-pair-request-set-session-purpose-normal-no-defect-type.json` | `{sessionId, purpose: normal}` — مفتاح `defectType` **غائب** لا null (الحاضر يُعدّ مُرسَلاً: `DEFECT_TYPE_NOT_APPLICABLE`) | `04ab287ab80679ffc32e79324d2db729607d5b51e1a595cdf5fbc16078e74bcb` |
| `maintenance-pair-request-list-open-maintenance-befores.json` | `{sessionId}` وحده | `661fdbabc87f26d7ab15f0222252ff7fcc24e386118f90eedd3ce5ee090cf2f7` |
| `maintenance-pair-request-confirm-maintenance-after-link.json` | `{sessionId, beforeScanId}` | `4481f33e1df3c384c58e3ffbc765c2827998f0e502a7f5037f574ad9e45375d1` |

**القارئ:** `test/maintenancePairAppRequestSamples.test.js` — يثبّت البصمة والشكل مفتاحاً مفتاحاً (مفتاح جديد في طلب التطبيق يُفشله: القاعدة 25)، ثم يمرّر كل طلب بالدالّة المُصدَّرة الحقيقية عبر غلاف `onCall` الحقيقي بقاعدة في الذاكرة (`lib/pairFakeDb.js`، الاستبدال المُعلَن: القاعدة 37)، ويؤكّد ما يقبله الخادم وما يكتبه (نوع العطل في `protocolPending` لا `scanSessions`؛ `normal` بلا نوع يُقبل ويكتب `defectType: null`؛ القائمة بلا كتابة؛ التأكيد يكتب اختيار الربط في `protocolPending` وحده). **غير متحقَّق هنا:** السلوك على Firestore الحقيقي (`maintenancePair.e2e.test.js`) وما يفعله التطبيق بالردّ. التصنيف في `goldenFixturesGuardCoverage.test.js`: خمسة مُدخلات موثَّقة (مشتقّة لا مسجَّلة من جهاز) وسجلّ المصدر توثيق.

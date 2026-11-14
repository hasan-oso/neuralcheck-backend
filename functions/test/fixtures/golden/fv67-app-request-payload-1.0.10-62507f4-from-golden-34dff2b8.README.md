# طلب `analyzeDevice` كما يرسله 1.0.10 من ملفّ fv67 — مشتقّ، 2026-10-09 (+03)

**الملفّ الزمني من 1.0.8-v6beta (fv67)، والطلب مبنيّ بكود 1.0.10 (`62507f4`) — حالة إعادة تحليل ملفّ fv67، كما يحدث فعلاً بعد التحديث.**

مشتقّ، لا مسجَّل: لم يُرسَل هذا الطلب من جهاز ولا من الإنتاج. بُني في JVM من الملفّ المخزَّن بكود 1.0.10 نفسه (القاعدة 9: الاسم يقول إنه مشتقّ، وقائمة ما صُنع بنصّه أدناه).

## القرار (المستخدم، 2026-10-09، بنصّه كما نقله المنسّق)
> «مصدر طلب fv67: الخيار (أ). يبنيه وكيل التطبيق من 34dff2b8.ts.json بكود 1.0.10 نفسه (62507f4)، في نسخة git archive خارج المستودع، ولا يُنقل إليها إلا المولّد. فلا التزام في NeuralChek. المخرَج ملفّ JSON وsha256، يدخل أمر ما قبل النشر.»

## المُدخل (يُقرأ بمساره ولا يُنسخ)
- `C:\Users\Efendi.Tec\neuralcheck-workspace\evidence\v8-phase0\fv67-golden-for-app-test\34dff2b8.ts.json`
- sha256 `e451306b31e74b6c77d6513989341cfe7a5f0408ed2119bcc085bf251b1720d3` (`sha256sum`؛ ويطابق `f1c7db9:app/src/test/resources/derived/fv67-golden-1.0.8-v6beta-from-neuralcheck-backend-19fc7bc-34dff2b8.ts.json` بـ`git show | sha256sum`). والمولّد يتحقّق منه قبل البناء ويتوقّف إن اختلف.
- `header.appVersion` = `1.0.8-v6beta` و`footer.fieldsVersion` = 67، 1606 عيّنة، 11 متغيّراً (قيمٌ يؤكّدها اختبار المولّد من الملفّ المقروء ومن الطلب الناتج، لا من الذاكرة).

## المخرَج
- `fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json` — **خريطة `data` نفسها التي تُمرَّر إلى `callable.call(data)`، بلا `sessionId`**: `{ fingerprint, language: "ar", scanId, usePrecomputed: true }`.
  - `scanId` = `header.scanId` من الملفّ نفسه (قيمة بديلة ثابتة في الملفّ، قرار ٨٢-٢)؛ وفي التطبيق يساوي `scanReport.scanId` المطابق لاسم الملفّ (`TimeSeriesFileReader.kt:45`). وهي نفسها `fingerprint.timeSeries.header.scanId` (يتحقّق منها الاختبار).
  - النصّ قانونيّ: المفاتيح مرتّبة، وكلّ رقم صحيح بلا كسر (`3` لا `3.0`) — كما وصفه `AnalysisRequestSerializer.kt` عند `f1c7db9` عن ترميز Firebase SDK (منقول، لم أتحقّق منه هنا). ترتيب المفاتيح على السلك يتبع إعلان الـDTO؛ المقارنة بالشجرة لا بالنصّ.
- `….keys.txt` — مسار لكلّ مفتاح بصيغة `GoldenJson.keyPaths` نفسها التي لنظيره في fv68 (`a.b[].c`، مرتّبة).
- `SHA256SUMS` — sha256 لكلّ ملفّ في هذا المجلّد عدا نفسه.

## السلسلة في 1.0.10 (`62507f4`)، بملفّ وسطر
الأسطر المُثبَتة باختبار المولّد (`theChainIsTheOneTheGeneratorCalls` و`theReplicaIsTheProductionStatementsAtTheirLines`) تُقارَن بنصّ الشجرة فتفشل إن انجرفت؛ وغيرها قرأتُه بـ`git show 62507f4:` ولا يحرسه اختبار (موسوم «م»).

| الخطوة | الموضع | الحالة في المولّد |
|---|---|---|
| تقرير مخزَّن: صفّ Room موجود | `ViewModels.kt:864` | مُثبَت |
| لا ردّ ذكاء مخزَّن في Room ⟵ يسقط إلى التحليل | `ViewModels.kt:877`، `:891-927` (م) | مُثبَت عند `:891` |
| `ScanReport` يُبنى من Room | `ViewModels.kt:947-976` (م) | **مُبرمَج** (انظر أدناه) |
| `scoringEngine.calculateScore(scanReport)` | `ViewModels.kt:979` | مُثبَت |
| قراءة الملفّ الزمني | `AiScoringEngine.kt:79` ⟵ `TimeSeriesFileReader.kt:44-47` (`filesDir/timeseries/<scanId>.ts.json.gz`، `:22`، `:45`) | **حقيقي** (المولّد يضع الملفّ هناك ويستدعي `readFile(scanId)`) |
| `BehaviorFingerprintBuilder.build` | `AiScoringEngine.kt:119-123` ⟵ `BehaviorFingerprintBuilder.kt:51-95` (م) | **حقيقي** |
| لا ردّ كامل في Firestore ⟵ `analyzeDevice` | `AiScoringEngine.kt:175-190` (م؛ `:185-189` مُثبَت) | — |
| DTO ⟵ JSON ⟵ `Map<String, Any>` | `FirebaseAnalysisService.kt:82`، `:122-126` | **نسخة** (`GsonBuilder().create()` ثم `toJson`/`fromJson`) |
| خريطة `data` | `FirebaseAnalysisService.kt:128-139`، و`sessionId` عند `:140-142` | **نسخة** (دون `sessionId` بأمر المنسّق) |
| `callable.call(data)` | `FirebaseAnalysisService.kt:162` | مُثبَت |

**لماذا نسخة:** الجملتان داخل دالّة suspend تستدعي `requireAuth()` ثم Firebase Functions، ولا تعملان في JVM؛ وفي 1.0.10 ليستا دالّة مستقلّة (دالّة `AnalysisRequestSerializer` من fieldsVersion 68). النسخة هي النصّ المُثبَت بالسطر، وإن غُيِّر سطرٌ منها في الشجرة فشل الاختبار.

## ما هو حقيقيّ وما هو مُبرمَج
- **حقيقي:** `TimeSeriesFileReader.readFile(scanId)` على الملفّ المخزَّن **كما هو** (gzip وحده حاوية يقرؤها القارئ)، و`BehaviorFingerprintBuilder.build`. لا صفّ `MODIFIED` ولا `SCRIPTED` في الزمنيّ: لا تحويل وحدات ولا تصفير ولا إضافة حقل fv68. (مولّد fv68 يُعيد **كتابة** ملفّ fv68 بكاتب حقيقي وقيم مُبرمَجة لمنتجي fv68؛ وإعادة تحليل 1.0.10 لا تكتب شيئاً، فذلك كلّه محذوف لا مُكيَّف.)
- **مُبرمَج، وهو نفسه مولّد fv68 لحالة `11ch-nothing-admitted`:** `DeviceInfo` (`samsung`، `"11"`، API 30، `1440x3040`، من ترويسة الملفّ لباقيها)، وصفوف `TestResult` الستّة عشر (الحالات الستّ كلّها)، و`DeviceProfileKey` بقيم `synthetic-golden-*`، و`antiTamperFlags` فارغة (كما في `ViewModels.kt:973`).
- **الفرق الوحيد في المُدخلات غير الزمنية:** `TestResult` في 1.0.10 بلا حقل `measurements` (جاء مع fieldsVersion 68، `2afd392`)، فسقطت خريطتا `measurements` لـL-02 وM-02. و`ScanMetadata.appVersion` = ترويسة الملفّ (`1.0.8-v6beta`) بدل `1.0.11`؛ ولا يقرؤه البنّاء (اختبار `theBuilderReadsOnlyTheScanReportFieldsTheScriptedInputsCover`: ما يقرؤه البنّاء من `ScanReport` هو `antiTamperFlags` و`deviceInfo` و`functionalResults` فقط، ومن `deviceInfo` الحقول `androidVersion` و`apiLevel` و`model` فقط).

## ما يخالف طلب الجهاز الحقيقي، أو يُقرأ بخلاف ظاهره
- **`device.buildFingerprint` و`buildBoard` و`buildHardware` و`buildBootloader`:** الـDTO يعلنها (`AiAnalysisRequest.kt:181-184`) والبنّاء يملؤها من `android.os.Build.*` (`BehaviorFingerprintBuilder.kt:474-477`). في اختبار JVM (`unitTests.isReturnDefaultValues = true`) قيمها `null` فيُسقطها Gson. **غائبة من الطلب (والدليل غيابها من `.keys.txt`)، وغائبة أيضاً من عيّنات fv68.** على الجهاز أربعة مفاتيح نصّية تحت `device`.
- **`deviceProfileKey`:** قيم بديلة؛ الحقيقية مرتبطة بالجهاز.
- **`fingerprint.timeSeries.footer.verificationResults.aiDelegateInitError`:** `""` لا غائب، لأن 1.0.10 يكتب `v.aiDelegateInitError ?: ""` (`BehaviorFingerprintBuilder.kt:312`)، والملفّ المخزَّن فيه `null` (من `check-request-against-stored-file.txt`).

## الفروق البنيوية عن عيّنة fv68 (`f1c7db9`، حالة `11ch-nothing-admitted`)
عيّنة fv68 هي `fingerprint` وحدها لا خريطة `data` (مفاتيحها الستّة: `antiTamperFlags` `device` `functionalResults` `manualResults` `powerSaveMode` `timeSeries`)؛ فالمقارنة بين `data.fingerprint` في هذا الطلب والعيّنة. الأرقام من `structural-comparison-vs-fv68.txt` (الأداة `compare-structure-vs-fv68.js`، بعد أن طابقت مسارات الأداة ملفّي `.keys.txt` الصادرين عن Kotlin):
- مسارات `fingerprint` هنا 188، وفي العيّنة 277، المشترك 178، **في fv67 وحده 10، وفي fv68 وحده 99**؛ ولا مسار مشترك يختلف نوع قيمته. والطلب كلّه 192 مساراً (188 + المفاتيح الأربعة: `fingerprint` و`language` و`scanId` و`usePrecomputed`).
- **في fv67 وحده (10):** `batteryHealth.chargeCounterUah`، `footer.maxCpuTemp`، `verificationResults.{aiDelegateInitError, storageSlcCacheSizeMb, workersPinnedBig/Mid/Little, workersPinFailedBig/Mid/Little}`.
- **الأختام:** `timeSeries.footer.fieldsVersion` = 67 هنا و68 في العيّنة؛ `timeSeries.header.appVersion` = `"1.0.8-v6beta"` هنا و`"1.0.11"` في العيّنة.
- 1606 صفّاً × 11 متغيّراً في الاثنين؛ `functionalResults` 12 و`manualResults` 4 في الاثنين.

## فحص مستقلّ للطلب مقابل الملفّ المخزَّن (`check-request-against-stored-file.txt`، بأداة لا تشارك المولّد كوداً)
- العيّنات: 1606 صفّاً متساوية (`phase` و`ts` وكلّ `v[i]` مقارَنة float32)، وبلا صفّ مختلف. الترويسة: 12 مفتاحاً بلا فرق. `variables`: متساوية.
- ذيل الملفّ: 147 مسار مفتاح في الملفّ المخزَّن، 132 في الطلب، والـ15 الغائبة: عشرة منها `null` مخزَّنة (يُسقطها Gson بلا `serializeNulls`)، وخمسة مفاتيح لا يمرّرها بنّاء 1.0.10 وقيمها غير `null`: `calibration` و`calibration.applied` و`preScanWarnings` (مصفوفة فارغة) و`stressEffectiveness.c4RatioStressWindow` و`stressEffectiveness.peakBigFreqKhzInStressPhases` (العدّ من `check-request-against-stored-file.txt`).
- **ملاحظة تخصّ سؤال «هل هو ملفّ الجهاز نفسه أم نسخة الخادم؟» في `README.md` المُدخل:** في الملفّ مفاتيح ذيل لا يمرّرها بنّاء 1.0.10 أصلاً (منها غير `null`: `calibration`، `c4RatioStressWindow`، `peakBigFreqKhzInStressPhases`). نسخة خادم من حمولة 1.0.10 لا تحملها، فهذا يرجّح أنه ملفّ الجهاز. **استنتاج، غير حاسم.**

## النسخة والتشغيل
- نسخة `git archive 62507f4` في `…\scratchpad\fv67-1010-request\tree\` (498 ملفّاً متتبَّعاً = 498 مستخرَجاً). **أُضيف إليها:** `AppRequestPayloadGolden.kt` و`AppRequestPayloadGoldenTest.kt` (في `app/src/test/java/net/neuralcheck/files/`)، و`local.properties` (غير متتبَّع، نُسخ بايتاً ببايت دون طباعة، للوصول إلى SDK؛ لا `keystore.properties`). وما عدا ذلك مخرَجات البناء (`.gradle` و`app/build`).
- **`app/src/main` لم يُمسّ:** `diff -r` بين `app/src/main` في النسخة ومخرَج `git archive 62507f4 app/src/main` = فارغ، خروج 0، 258 ملفّاً في كلّ طرف.
- لأن `app/build.gradle.kts:59` ينفّذ `git rev-parse HEAD` وقت التهيئة والنسخة بلا `.git`، يُشغَّل الأمر بـ`GIT_DIR` يشير إلى مستودع فارغ خارج النسخة (`…\fv67-1010-request\git-meta`) رأسه `62507f4` ويقرأ كائنات NeuralChek للقراءة فقط عبر `objects/info/alternates`. فلم يُضَف `.git` إلى النسخة، ويُثبت الاختبار `BuildConfig.GIT_COMMIT_SHA == 62507f42c9a4dfb71b9858f15a91d300bae72f2e`.
- الأمر (Git Bash، قوس فرعي، jbr داخل الأمر وحده، بلا تغيير للبيئة):
```
( cd "<scratchpad>/fv67-1010-request/tree" && export JAVA_HOME="C:\Program Files\Android\Android Studio\jbr" && export PATH="/c/Program Files/Android/Android Studio/jbr/bin:$PATH" && export GIT_DIR="<scratchpad>/fv67-1010-request/git-meta" && export NC_FV67_INPUT="C:/Users/Efendi.Tec/neuralcheck-workspace/evidence/v8-phase0/fv67-golden-for-app-test/34dff2b8.ts.json" && export NC_FV67_OUT_DIR="<scratchpad>/fv67-1010-request/out" && ./gradlew --no-daemon --offline cleanTestLaunchDebugUnitTest testLaunchDebugUnitTest --tests net.neuralcheck.files.AppRequestPayloadGoldenTest )
```
- النتيجة: `BUILD SUCCESSFUL in 2m 32s`؛ `TEST-net.neuralcheck.files.AppRequestPayloadGoldenTest.xml`: `tests="8" skipped="0" failures="0" errors="0"`. لا APK (`app/build/outputs/apk` غير موجود قبل التشغيل وبعده، و`find app/build -name '*.apk'` فارغ). (`NeuralCheck.apk` في جذر النسخة ملفّ متتبَّع في `62507f4` مستخرَج، لا بناء.)
- السجلّ الكامل: `generator/gradle-run.log`.

## المولّد
- `generator/AppRequestPayloadGolden.kt` و`generator/AppRequestPayloadGoldenTest.kt` كما استُعملا.
- `generator/generator-diff-vs-f1c7db9.diff` — `diff -u` بين `f1c7db9:app/src/test/java/net/neuralcheck/files/AppRequestPayloadGolden.kt` (911 سطراً) والنسخة المستعمَلة (433 سطراً). الفرق كبير لا طفيف: سطور مضافة/محذوفة 353/831 (`git diff --no-index --numstat`)، لأن كلّ جهاز المنتجين المُبرمَجين لـfv68 (القنوات والقوائم الحرارية وأزواج البطارية والتحقّقات والفحوص المعروفة الإجابة) محذوف، إذ لا شيء منه في سلسلة 1.0.10. والمُبقى: `DEVICE_PROFILE_KEY` و`results()` (دون `measurements`) و`scanReport()` وقناع `Context` وخطوة القراءة. وجسم `GoldenJson` مضمَّن حرفياً (نصّ مطابق لـ`f1c7db9:…/GoldenJson.kt` من السطر 10 إلى آخره؛ `diff -q` = لا فرق، وsha256 للجسمين `249128e8d53d893ac5691ce0efea2c804b09fc6384cf6c679e4db87fcbaf9597`)، لأن المسموح ملفّ مولّد واحد وملفّ اختباره.
- ملفّ الاختبار جديد كلّه (اختبار `f1c7db9` يقارن عيّنات مُلتزَمة بالسلسلة؛ هذا يبني من مدخل ويتحقّق من الأسطر ويكتب المخرَج).

## ما لم يُفعل
- لا README ولا SHA256SUMS داخل المستودع، ولا التزام، ولا شيء في `NEURALCHECK-FINDINGS.md`.
- لا جهاز ولا Firebase ولا شبكة (`--offline`).

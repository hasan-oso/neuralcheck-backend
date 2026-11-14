# جرد قرّاء fv68 في neuralcheck-backend — قبل أيّ تعديل كود (القاعدة 25)

**التاريخ:** 2026-10-09 +03 · **الأساس:** كود `0a0da7e` (المنشور في الإنتاج) + `522fbbf` (نسخة العقد، لا كود) · **الدفعة:** PLAN-05 رقم ٤.
**العقد:** `docs/FV68_CONTRACT.md` (نسخة بايتاً ببايت من NeuralChek `738da89`، sha256 في `docs/FV68_CONTRACT.SOURCE.txt`). كل «عقد §» أو «عقد :سطر» أدناه يعني هذا الملفّ.
**ما هذا الملفّ:** جدول بالأداة لكل حقل أو حالة جديدة أو محذوفة في fv68: أين يقرؤه الخادم اليوم، وأين يجب أن يُقرأ ولا يُقرأ، وأيّ قسم من العقد يحكمه.
ما يقرؤه الخادم = **كود** في `functions/src` و`functions/index.js` (أسطر التعليق مفروزة). الأرقام من أمر مذكور في كل قسم، لا من الذاكرة (القاعدة 40).

## ٠ — الأوامر

```
# أ) مواضع قراءة كل اسم (يفرز أسطر التعليق؛ يحتمل CRLF — ملفّات signatures/*.js في الشجرة CRLF
#    وأوّل صيغة من السكربت أسقطتها بصمت، فأُصلحت قبل اعتماد أيّ رقم هنا — القاعدة 16):
node inventory.js <اسم> …        # سكربت مؤقّت، يشغّل: git -C <repo> grep -n -F -e <اسم> -- functions/src functions/index.js
# ب) القراءة بالفهرس:
git grep -n -F -e "s.v[" -e "samples.map" -e ".v?.[" -e colByIndex -- functions/src functions/index.js
# ج) من يستورد المسارات التي يُظنّ أنها ميّتة:
git grep -n -E "require\([\"'](\.|\.\.)/(.*/)?(precompute|lab/|runLabPipeline)" -- functions/src functions/index.js functions/scripts
# د) هل المسار V6 (callAI + footerIntegrity) قابل للوصول: runAnalysisInternal.js:404 `return {` ثم :426-433 تعليق «غير قابل للوصول أبداً»
```

## ١ — الحقول والحالات (ما يقرؤه الخادم اليوم ← ما يجب أن يُقرأ)

«لا قارئ» = صفر موضع كود بالأمر (أ). «يجب» = ما يلزمه العقد؛ و«الفعل» = ما تفعله هذه الدفعة (التزام الكود التالي).

### ١.١ — المحذوفة والمتغيّرة الدلالة

| الحقل | تغيّره في fv68 (عقد) | الخادم يقرؤه اليوم (كود) | يجب ولا يُقرأ | الفعل |
|---|---|---|---|---|
| `footer.maxCpuTemp` | يغادر في ≥ 68 ويحلّ محلّه `cpuTempFinalC`+`cpuTempFinalSource` (ت-10 :517-526، س-33 :1032-1036) | `analysis/findings.js:912,913,915` — فرع `fieldsVersion ≤ 67` في `buildNotMeasuredFields` (:891-932)، شرطه `maxCpuTemp === -1` | `cpuTempFinalC`/`cpuTempFinalSource`: لا قارئ | قارئ جديد؛ وفي ≥ 68 يُعلن الغياب `absent:<سبب>` حقلاً غير مقيس |
| `verificationResults.storageSlcCacheSizeMb` | محذوف (ت-08 :509-511) | `findings.js:904,906` — يعدّ الصفر «افتراض بنيوي» لـ≤ 67 | لا شيء: غيابه في ≥ 68 هو الحال | لا تعديل في ≤ 67؛ وغيابه في ≥ 68 لا يُقرأ خللاً |
| `verificationResults.aiDelegateInitError` | غائب لا `""` (ت-18 صفّ 12 :654) | لا قارئ | يُقرأ «لا خطأ» من `aiActiveDelegate` لا من غياب المفتاح | قارئ جديد بحالة صريحة |
| `verificationResults.cpuFmaErrors` | لا يعود بدلالة جديدة؛ يحلّ محلّه `cpuKnownAnswer*` (ت-20 :675-684؛ §7-د :1216) | `findings.js:84` (قائمة A76 لـ≤ 67) · `signatures/computeScanSignature.js:45` (`vr.cpuFmaErrors \|\| 0`) · `signatures/reevaluationDecision.js:28` (`ERROR_COUNTERS`) | غيابه يُعلَن غائباً لا صفراً | يُصحَّح (بند ٢-٥) |
| `verificationResults.cpuPrimeSieveCorrect` | كالسابق | `findings.js:84` · `computeScanSignature.js:46` (`!== false`) · `reevaluationDecision.js:19` (`DETERMINISTIC_BOOLS`) | كالسابق | يُصحَّح |
| `verificationResults.memoryMarchPassed` / `memoryWalkingOnesPassed` | لا يُشحنان؛ العدد الخامّ `memoryMarchErrors`/`memoryWalkingOnesErrors` يُشحن والخادم يشتقّ `…Passed` (س-30 :1014-1018؛ ت-17 :630) | `findings.js:84,85` · `computeScanSignature.js:47,48` (`!== false`) · `reevaluationDecision.js:20,21` | `memoryMarchErrors`/`memoryWalkingOnesErrors`/`memoryVerifyState`: لا قارئ | اشتقاق صريح من الخامّ + حالة |
| `verificationResults.memoryRandomVerifyErrors` | يبقى الاسم؛ `Int?` يغيب حين لا يجري التحقّق (ت-17 :627-631) | `findings.js:85` · `computeScanSignature.js:49` (`\|\| 0`) · `reevaluationDecision.js:29` | غيابه ≠ صفر | يُصحَّح |
| `verificationResults.storageWriteVerifyErrors` / `storageReadVerifyErrors` | `Int?`؛ تغيب حتى يجري تحقّق؛ الكتابة تُشحن متى جرت الكتابة (ت-16 :605-619؛ §7-د البند 4 :1245) | `computeScanSignature.js:50,51` (`\|\| 0`) · `reevaluationDecision.js:30,31` · بوّابة `STORAGE_VERIFY_ERRORS` `NOT_WIRED` في `categoryStates.js:410` | `storageVerifyState`/`storageVerifyBytesCompared`/`storageVerifyDurationMs`/`storageVerifyMethod`/`storageVerifyBytesPlanned`: لا قارئ | يُصحَّح التوقيع؛ قارئ جديد؛ **البوّابة لا تُوصَل هنا** (حرف فئة، خارج العقد §0 :12) |
| `verificationResults.gpuComputeGemmCorrect` | `Boolean?`؛ `null` حين لم تُنفَّذ المرحلة + `gpuComputeGemmState` (ت-18 صفّ 1 :643) | `computeScanSignature.js:52` (`!== false`) · `reevaluationDecision.js:22` | `gpuComputeGemmState`: لا قارئ | يُصحَّح؛ قارئ جديد |
| `verificationResults.criticalDefectDetected` | `Boolean?`؛ مجمَّع انتقالي (س-31 :1020-1024؛ ت-18 صفّ 2 :644) | `computeScanSignature.js:53` (`=== true`) · `reevaluationDecision.js:72,73` | `criticalDefectInputsNotRun[]`: لا قارئ | الغياب يُعلَن؛ قارئ جديد |
| `verificationResults.workersPinned*`/`workersPinFailed*` | `Int?` + `workersPinState` (ت-13 :552-558) | لا قارئ | `workersPinState` | قارئ جديد |
| `footer.batteryHealth.chargeCounterUah` (+`…State`) | الصفر الحقيقي قيمة؛ `chargeCounterUahState` (ت-18 صفّ 10 :652؛ §7-ج :1192) | `findings.js:687` (لقطة `computeChargeCounter`) | `chargeCounterUahState`/`energyCounterNwhState`: لا قارئ | قارئ جديد؛ الغياب بسببه |
| `footer.batteryHealth.cycleCount`/`cycleCountSource` | مفردات `extra_api34`·`sysfs:<path>`·`unavailable`؛ `cycleCountState` (ت-02 :433-444؛ §7-ز :1394-1398) | `computeScanSignature.js:93` (`typeof number`) · `reevaluationDecision.js:90-93` | `cycleCountState`: لا قارئ؛ `cycleCountSource` لا يُقرأ (عقد :773) | قارئ حالة؛ لا تغيير في القراءة الرقمية — **حُدِّث 2026-10-13: صفر الدورات من `extra_api34` ⟵ «غير مدعوم»، انظر §٥ أسفل** |
| `footer.batteryHealth.{dischargeRateUnderLoadMa,voltageStabilityMv,batteryTempRiseC,levelDropPct,dischargeVsDesignRatioMah}` | تغيب بحالة `<الاسم>State` بدل `0.0` (ت-18 صفّ 9 :651؛ §7-ب :1121،§7-ج :1193) | `findings.js:526,528` (تُحسب من العيّنات لا من الحقل) · `computeScanSignature.js:94-97` (`typeof number` ⇒ `null`) · `reevaluationDecision.js:95-104` | `…State`: لا قارئ | قارئ حالات |

### ١.٢ — المضافة (لا قارئ اليوم: صفر موضع بالأمر (أ))

| المفتاح | العقد | الفعل |
|---|---|---|
| `variables[]` بطول متغيّر (`charge_counter_raw` · `cpu_freq_policy{N}_khz`) | §٢.١ :398-412؛ ق-10 :736؛ §٤.٢ :777-789 | قراءة الأعمدة بالاسم؛ الفهرس = موضع `variables[]` إن غاب `index` (الحمولة بلا `index` — قيس على العيّنات الثلاث) |
| `footer.channelReadFailures` + `channelReadFailureCounts` | س-27 :996-1001؛ §٧ بند 1 :1091 | كل قارئ لعمود قناة يستثني الفهارس الفاشلة، ويُعلن «مبتورة»/«غير متتبَّعة» |
| `footer.thermalHeadroomReadings[]` + `thermalHeadroomState` | ت-03 :446-455؛ س-35 :1044-1048؛ §٧-ب :1135 | قارئ جديد |
| `footer.thermalStatusEvents[]` + `thermalStatusState` | ت-04 :457-466 | قارئ جديد |
| `footer.cpuPolicies[]` | ت-05 :468-478؛ N-06 :29 | قارئ جديد |
| `footer.batteryPairs[]` + `batteryPairsState` | ت-06 :492-503؛ س-28 :1003-1006 | قارئ جديد (الخام؛ الوحدة لا تُستنتج هنا — يحسمها الخادم لاحقاً) |
| `footer.channelDiscovery.reasons` | :480-490؛ N-07 :30؛ ق-12 :738 | قارئ جديد؛ التمييز بنصّ الخطأ (القاعدة 21) |
| `footer.cpuTempFinalC` + `cpuTempFinalSource` | ت-10 :517-526 | قارئ جديد |
| `footer.transitionalAggregates[]` · `unmeasuredDefaults[]` (بأسماء منقوطة) | N-23 :46؛ §٧-ب بند 3 :1137 | قارئ جديد |
| `footer.preScanWarningsState` · `scanStillness.stillnessState` | ت-18 صفّ 6-7 :648-649 | قارئ جديد؛ `isStill`/`accelStdDev` تصدق مع `measured` وحدها |
| `footer.fieldsNotInFile[]` · `timeSeries.timeSeriesState` | §٧-ج :1191؛ §٧-ب بند 5 :1139 | قارئ جديد؛ يحكم تصنيف «غائب» (في الملفّ/ليس في الملفّ) |
| `verificationResults.memoryVerify*` (`State`·`Bytes`·`BufferBytes`·`TimeCapMs`·`DurationMs`·`FreeBytes`) + `memoryPhaseWindows[]` | ت-17 :621-635؛ §٧-ج :1185؛ §٧-هـ :1292 | قارئ جديد |
| `verificationResults.storageThroughputSegmentsUnit` · وحدة `variables[8]`/`[9]` | ت-19 :659-673؛ س-19 :952-958؛ س-36 :1050 | قارئ الوحدة: `1.0.9`/`1.0.10` ⇒ MiB/s؛ `1.0.8-v6beta` ⇒ «غير محدَّدة»؛ من fv68 بالمعلَن |
| `verificationResults.cpuKnownAnswerState` · `cpuKnownAnswerRuns[]` · `cpuKnownAnswerTotalMsByPhase` | ت-20 :675-684؛ §٧-ج :1187؛ §٧-د :1252-1254 | قارئ جديد |
| `functionalResults[].measurements` · `manualResults[].measurements` | ت-11 :528-538؛ ت-14 :560-570؛ ت-15 :572-603؛ §٧-ب بند 7-8 :1141-1142 | قارئ جديد؛ الأسماء الحالية [م] تُعلَن |

### ١.٣ — مذكورة في العقد ولا تصل في fv68 (لا قارئ يُكتب)

`manualResultsHeader.hiddenByModel` و`status = "unavailable"` من الإجابات اليدوية و`not_measured` و`TestStatus` الجديدة: الدفعة ١٠ (عقد §٧-و :1361) و`not_measured` لا يرسله التطبيق (عقد :41، :1029). لا قارئ يُكتب لها هنا. `phaseBoundaries` لا يبلغ الحمولة (عقد §٧-د البند 5 :1246): النوافذ في `verificationResults.memoryPhaseWindows`.

## ٢ — القراءة بالفهرس لا بالاسم (أمر (ب))

| الموضع | يقرأ | حكمه |
|---|---|---|
| `analysis/findings.js:1042,1044,1046-1051` | `v[0]` ثم `colByIndex(1..5)` و`(10)` | **يتحوّل إلى الاسم** (الأمر البند ٢) |
| `analysis/findings.js:234-248` (`resolveChannelNames`) + `:1054-1060` | أسماء من `variables[].index` (يشترط `index > 0`)، ويُكمل من `FALLBACK_CHANNEL_NAMES_BY_INDEX` (:57-62). **الحمولة بلا `index`** ⇒ يعمل الجدول الثابت وحده؛ و`charge_counter_uah` لا يُجدَّى حتى لو طابق الاسم | يتحوّل إلى الاسم بموضع `variables[]` |
| `analysis/findings.js:306-313` (`buildPerChannelUpdateCount`) | فهارس 1..4 بأسماء ثابتة | يتحوّل إلى الاسم |
| `analysis/sampleInputsFromRaw.js:45,47,49` | `v[0]` و`v[1..4]` | فهارس ≤ 10 ثابتة بالعقد (:398-402) — تبقى، **ويثبّتها اختبار على الاسم** (القاعدة 25) |
| `admin/runConsistencyTest.js:43-80` (الشرط `:50`) · `:92,96,119,126,135,150,160,167` | تخطيط قديم 18 قناة، و`v.length < 18` ⇒ **لا ضجيج إطلاقاً على 11 قناة**، وعلى 18 قناة (ست سياسات) ضجيج على قنوات خاطئة (عقد :412، :779) | **يتحوّل إلى الاسم** (الأمر البند ٢) |
| `analysis/precompute.js:100,104,166` · `lab/**` | فهارس تخطيط 22 قناة قديم | **ميّت**: أمر (ج) لا يُظهر استيراداً لـ`precompute.js` ولا `runLabPipeline.js` ولا `lab/` من أيّ ملفّ خارجها (تستوردان `lab/` وحدهما، ولا أحد يستوردهما) — لا تعديل |
| `analysis/callAI.js:191-262` (V6) · `analysis/footerIntegrity.js` | يقرأ `footer`/`variables` | **ميّت**: `runAnalysisInternal.js:404` يُرجع قبل نداء `callAI` (أمر (د)) — لا تعديل. وللعلم `footerIntegrity` يعلن الغياب `null` أصلاً |

## ٣ — طبقات الحفظ والإعادة (الأمر البند ٨)

| الطبقة | الحكم من الكود | يلزم |
|---|---|---|
| `analysis/lightenFingerprintForStorage.js:7-15` | يحذف `timeSeries.samples` وحدها ويُبقي ما سواها (نشر `...`) | اختبار على العيّنات الثلاث: كل مفتاح fv68 باقٍ بايتاً |
| `analysis/reportRawStore.js:84-97` (`buildReportRawDocument`) + `:111-118` (`assertReportRawFits`، الحدّ 900000) | يخزّن `lighten(fingerprint)`؛ الحجم المقيس لعيّنات fv68 17,732 · 19,091 · 41,144 بايتاً | اختبار؛ والقياس مكرَّر في الاختبار |
| `analysis/rehydrateReportSamples.js:73-79` | يستبدل `timeSeries.samples` وحدها | اختبار على العيّنات الثلاث |
| `ensureReportShape` | **لا تقرأ fingerprint**: `analysis/callDeepSeek.js:75` و`callGemini.js:76` تتحقّقان من شكل **ردّ النموذج** (`shapeKeys`/`coreKeyGroups`) وتُرجعان `r.report` بلا قراءة أيّ حقل من الحمولة. فالأمر يذكرها ضمن «المفاتيح الجديدة» وهي لا تمرّ بها | **فرق بين الأمر وكودي** — يُبلَّغ؛ ولا قارئ لـ`ensureReportShape` يُكتب |

## ٤ — ما يخالف الأمر في كودي (القاعدة 14: يُبلَّغ)

1. الأمر يذكر `findings.js:84-85` لقرّاء `cpuPrimeSieveCorrect`/`cpuFmaErrors`: **السطر 84 وحده** يحملهما (مع `memoryMarchPassed`)؛ والسطر 85 يحمل `memoryWalkingOnesPassed` و`memoryRandomVerifyErrors`.
2. مواضع الأمر المنقولة صحيحة عند `0a0da7e`: `findings.js:1046-1051` · `:1055-1060` · `:912-915` · `:84-85` (بالفرق أعلاه) · `reevaluationDecision.js:18-31` · `computeScanSignature.js:45-46` (و:47-53 من النمط نفسه).
3. `ensureReportShape` — انظر §٣.
4. ملفّات `signatures/computeScanSignature.js` و`reevaluationDecision.js` **CRLF** في شجرة العمل (`core.autocrlf=true`)؛ يُراعى عند التحرير.

## ٥ — صفر الدورات من `EXTRA_CYCLE_COUNT` ⟵ «غير مدعوم» — تحديث 2026-10-13 +03 (قرار المستخدم)

> هذا القسم **يحدّث** صفّ `footer.batteryHealth.cycleCount`/`cycleCountSource` في §١.١ أعلاه (الذي كُتب 2026-10-09 قبل أيّ كود: «قارئ حالة؛ لا تغيير في القراءة الرقمية»). النصّ القديم بلا مساس (القاعدة 8)؛ الحاكم من هنا. القراءة الرقمية نفسها لم تتغيّر: `fv68Reader.readBatteryHealth` يسلّم الخامّ مع حالته كما كان، والحكم في وحدة مستقلّة (`cycleCountClassification.js`).

**قرار المستخدم، بنصّه** (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي: الملفّات في مساحة العمل لا في هذا المستودع):
> (2026-10-13) «التطبيق يرسل القيمة الخامّة كما هي (القاعدة 20). والخادم يصنّف الصفر من extra_api34 «غير مدعوم»: لا يذهب B-08 إلى النموذج، ولا يُعرض، ولا يدخل computeScanSignature رقماً، بل حالةً. مع اختبار.»
> (2026-10-13) «صفر الدورات: الشرط كما كتبتَه (cycleCountState == "read" وcycleCountSource == "extra_api34" وcycleCount === 0 ⇐ unsupported:zero_from_extra_api34) معتمد، باسمه، ولكل العلامات. وB-08 لا يذهب إلى النموذج، ولا يُعرض في التطبيق ولا الموقع ولا PDF (بالجرد الذي ذكرتَه)، وبصمة الجهاز تحفظ الحالة. وإصدار قواعد التقييم يتغيّر، لا إصدار الحقول. والعقد يكتب: «غير موثَّق من Samsung، وإعدادات الـS21 لا تعرض الدورات، ومرجع AOSP يرسل 0 حين لا عدّاد»، بمصادر بحث 2026-10-11.»

**نصّ العقد (بحرفه كما في القرار):** **غير موثَّق من Samsung، وإعدادات الـS21 لا تعرض الدورات، ومرجع AOSP يرسل 0 حين لا عدّاد.**

**مصادر البحث (تقرير الباحث 2026-10-11؛ منقولة من أمر المنسّق، غير متحقَّقة، ولم تُفتح):**
- A1 `https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android14-release/core/java/android/os/BatteryManager.java`
- A2 `https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android14-release/services/core/java/com/android/server/BatteryService.java`
- A3 `https://android.googlesource.com/platform/hardware/interfaces/+/refs/heads/android14-release/health/aidl/android/hardware/health/HealthInfo.aidl`
- A4 `https://android.googlesource.com/platform/system/core/+/refs/heads/android14-release/healthd/BatteryMonitor.cpp`

**خلاصة الباحث بنصّها:** «وشيفرة AOSP تضع الحقل في كل بثّ، ولا تعرّف له قيمة «غير معروف»، وتتركه صفراً حين لا يجد الـHAL عقدة `cycle_count` (وهذا غير متحقَّق على Samsung). فالصفر من الحقل وحده لا يُميَّز عن صفر حقيقي.» **و**«لا تقول Samsung ولا Google في أيّ مصدر وجدته إن الصفر من `EXTRA_CYCLE_COUNT` على Samsung يعني «غير مدعوم».» ⟵ فالتصنيف **قرار خادم مُعلَن**، لا حقيقة مثبتة عن المصنِّع.

### ٥.١ — الشرط والوسم

| | |
|---|---|
| **الشرط (ثلاثة معاً، لكل العلامات)** | حالة الدورات `read` **و** مصدرها `extra_api34` **و** قيمتها `=== 0` |
| **الأسماء الثلاثة على السلك** | `cycleCountState` · `cycleCountSource` · `cycleCount` — في `footer.batteryHealth` (`fv68Names.BATTERY_HEALTH.CYCLE_COUNT_STATE/_SOURCE/CYCLE_COUNT`، عقد التطبيق §٧-ز: `docs/FV68_CONTRACT.md:1396-1399` في نسخة a04b4f0 — الأرقام في §١.١ أعلاه من نسخة 738da89). قيم الحالة والمصدر من المفردتين المغلقتين (`fv68Names.STATE_KIND.READ` و`.EXTRA_API34`). |
| **الوسم** | `unsupported:zero_from_extra_api34` — **قيمة واحدة مُصدَّرة** `fv68Names.CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34` (اسم خادم، لا يُكتب على السلك؛ القاعدة 24). |
| **القرار** | `functions/src/analysis/cycleCountClassification.js`: `classifyCycleCount(block)` على كتلة `readFv68(...).batteryHealth.cycleCount` (أو `readBatteryHealthOnly(...).cycleCount`) ⟵ الوسم أو `null`. **لا شرط على المصنّع ولا الطراز ولا إصدار أندرويد.** |
| **كل ما سوى الشرط يبقى كما هو** | الصفر من مصدر آخر (`sysfs:<path>`) · قيمة 1 فما فوق من `extra_api34` · الحالات غير `read` (`not_read:<سبب>`) · المصدر `unavailable` أو غير المعروف · الحقول غائبة (ختم < 68): `classifyCycleCount` ⟵ `null`. **الغياب يبقى غياباً** (القاعدة 22): لا يُقرأ «غير مدعوم» (مُختبَر بـ168 توليفة: الحالة × المصدر × القيمة؛ توليفة واحدة تُنتج الوسم). |

### ٥.٢ — من يستهلك التصنيف، وما لا يتغيّر

| الموضع | الأثر |
|---|---|
| **حمولة النموذج** | `runAnalysisInternal.js` يمرّر الوسم إلى `computeCategoryStates({cycleCountClassification})` فيُسقط اختبار **B-08** (`testKinds.CYCLE_COUNT_TEST_ID`) من `categoryStates.testResults`: **لا قيمة ولا حالة ولا معرّف** في ما يُرسَل (ولا في مرجع حارس الأرقام ولا في مرجع الأدلّة: فهارس `testResults` واحدة في كل ما يقرؤها). B-08 SPEC (`healthBearing=false`): الفئات والحروف والمشاكل والبصمات والبوّابات **بلا تغيير بايتاً** (مُختبَر). في غير الحالة: B-08 يصل كما كان بايتاً بايتاً (مقيس قبل/بعد). |
| **الخامّ** | لا يُمسّ (القاعدة 20): `reportRaw.rawFingerprint.functionalResults` (B-08) والتذييل (`cycleCount: 0`، `cycleCountSource`، `cycleCountState`) كما شُحنا. |
| **العرض (جرد هذا المستودع)** | **لا سطح بناه الخادم يحمل B-08:** (أ) `aiResult`/`aiResponse` المعروض والمخزَّن لا يحمل «B-08» في الحالتين (مُختبَر)؛ (ب) فئة البطارية تُبنى من العيّنات (`computeBatteryCategory`) **بلا `testIds`**، فمعرّف B-08 لا يظهر في `display.categories.*.testIds`؛ (ج) B-08 SPEC `healthBearing=false` فلا يدخل `issues[]` (`categoryStates.js` `buildDeterministicIssues`)؛ (د) PDF الخادم صورة لصفحة `/print` في الموقع (`src/reports/generateReportPdf.js:20,29-31`) — لا يبني الخادم نصّه. **لا تغيير في العرض.** (الموقع والتطبيق: خارج الحدود، لم يُفحصا؛ جردهما منقول من الكشّاف: `testIds` يُفكَّك في الموقع `lib/reportReaders/v7.js:649` ولا يُعرض — غير متحقَّق من هنا.) |
| **بصمة الجهاز** | `computeScanSignature` يحفظ **الحالة لا الرقم**: `sig.battery.cycleCount = null` و`sig.battery.cycleCountClassification = "unsupported:zero_from_extra_api34"`؛ والمفتاح الثاني **لا يُكتب إلا حين وقع التصنيف** (سائر التواقيع بلا تغيير بايتاً). `PIPELINE_VERSION` لم يُرفع (`"v4-2026-09-24-decision-76-3"`): المستخدم اختار ختم القواعد لا رفعه. |
| **`signatureDifference` من رقم 0 إلى الحالة** | **لا انجراف:** لا تمرّ على `sig.battery` إطلاقاً (تُقارن `verification` و`functional` وحدهما) — فبصمة سابقة للجهاز نفسه بـ`cycleCount: 0` (تنسيق ما قبل القرار) وجديدة بالحالة تُنتج `0`، في الاتجاهين (مُقاس: `test/cycleCountUnsupportedZero.test.js` §٨). |
| **`reevaluationDecision` من رقم 0 إلى الحالة** | **لا إشارة كاذبة:** تقرأ `cycleCount` بـ`num()` فالـ`null` لا يُقارَن؛ فلا `battery:cycleCount +N` ولا `forceReevaluate` ولا `maintenanceSuspected` في الاتجاهين. ولو قرأ الجهاز لاحقاً رقماً حقيقياً (300 مثلاً) بعد بصمة بالحالة: لا إشارة «قفزة +300» (السابق لا رقم فيه). **ما لم يتغيّر ولم يُقصَد:** بصمة **قديمة محفوظة** برقم 0 ثم قراءة حقيقية لاحقاً فوق 150 ما زالت تُطلق «battery:cycleCount +N» (سلوك `reevaluationDecision` القائم، `cycleCountJump = 150`)؛ ولا تُعاد كتابة بصمات محفوظة. |
| **ختم قواعد التقييم** | يتغيّر (لا إصدار الحقول): `evaluationRulesVersion` — `docs/V7_DISPLAY_SHAPE_CONTRACT.md` §١٥. |
| **قارئ fv68 وعيّناته الذهبية** | لم تتغيّر: `readFv68` بلا حقل تصنيف (القارئ لا يحكم)؛ `fv68-readings-derived-*.json` بلا إعادة توليد (حارسها `fv68ReadingsGolden.test.js` يمرّ كما هو). |

### ٥.٣ — قيد معروف غير مُصلَح

**بطارية بصفر دورات حقيقي** (جهاز جديد) على `extra_api34` **تُصنَّف «غير مدعوم» أيضاً** ولا يصل النموذج صفرها: الشرط بنصّ المستخدم لا يميّز، والبحث نفسه يقول إن الصفر من الحقل وحده لا يُميَّز عن صفر حقيقي. **لا يُصلَح هنا** — قرار المستخدم. يُراجَع إن ثبت بقياس على جهاز أن الجهاز الجديد يُرسل 0 فعلاً.

### ٥.٤ — نسخة التطبيق من العقد

`docs/FV68_CONTRACT.md` هنا **نسخة بايتاً ببايت** من NeuralChek (`docs/FV68_CONTRACT.SOURCE.txt`): لا تُحرَّر هنا؛ فلم يُكتب فيها شيء. إن لزم نصّ مماثل في نسخة التطبيق (§٧-ز: «ما يضعه البثّ الحقيقي في الإضافة على جهاز حقيقي لم يُقَس … والخادم هو الذي يحكم بما يعنيه الصفر») فهو لوكيل التطبيق، **بنصّ العقد أعلاه**.

## ٦ — قرّاء D للمعالج في fv70 (`skipped:time_budget` و`partial:time_budget` و`sieveLimit`) — تحديث 2026-10-13 +03 (أمر المنسّق، الجزء الرابع)

> هذا القسم **يحدّث** صفوف D في §١.٢ أعلاه (حقول `cpuKnownAnswer*` المضافة في 68، كُتبت قبل أيّ كود). النصّ القديم بلا مساس (القاعدة 8)؛ الحاكم من هنا. **لا نسخ لـ`docs/FV68_CONTRACT.md`** (أمر لاحق يجلبها): نصّ العقد المنقول أدناه من أمر المنسّق، **منقول، غير متحقَّق** من المستودع المصدر.

**قرار المستخدم، بنصّه** (منقول من أمر المنسّق، غير متحقَّق):
> «وقرّاء الخادم يعرفون skipped:time_budget قبل أن يُرسله أيّ تطبيق (القاعدة 25)، فهو نشر خادم قبل 1.0.12 أو معه.»

واختياره لاسم الحالة الإجمالية: **«Accept partial:time_budget (Recommended)»**.

**ما أرسله التطبيق (§٧-ط من عقد التطبيق؛ منقول، غير متحقَّق؛ والعيّنات الثلاث نسخ حرفية من `NeuralChek@80ca8c3`، sha256 في `functions/test/fixtures/golden/README.md` وفي `test/fv68AppPayloadGoldenCopy.test.js`):**

| الحقل | القيمة |
|---|---|
| `sieveLimit` | عدد صحيح (1000000 اليوم)؛ يُشحن مع `match` و`mismatch`؛ يغيب مع `native_call_failed` و`native_result_unreadable` و`not_reached` و`skipped:time_budget` |
| المرجع π(N) | بحسب `sieveLimit` لا بثابت: 1000000 ⟵ 78498؛ وختم 68 و69 بلا `sieveLimit` فيهما N = 10000000 ⟵ 664579 |
| `sieveStatus` و`sha256Status` | القيمة الجديدة `skipped:time_budget` (حرفية كاملة، بلا بادئة مفتوحة) |
| `cpuKnownAnswerState` | `ran` = بلا متروك · `partial:time_budget` = أُبلغ نصف فحص واحد على الأقلّ وتُرك تشغيل · `not_run:<سبب>` متى لم يُبلَّغ أيّ نصف |
| العنصر المتروك | مفاتيحه الأربعة وحدها: `phase` و`plannedAtPct` و`sieveStatus` و`sha256Status`؛ ويبقى في القائمة (ثلاثة عناصر لكل مرحلة) |
| `cpuKnownAnswerTotalMsByPhase` | لا يدخله المتروك |
| `fieldsVersion` | 70 |

### ٦.١ — جواب سؤال وكيل التطبيق، من كودي (الأرقام: التزام `c2e5e49` قبل الإصلاح؛ والشجرة الحالية بعده)

| السؤال | الجواب | الموضع قبل الإصلاح (`c2e5e49`) | الموضع بعد الإصلاح |
|---|---|---|---|
| هل يفترض قارئ **ثلاثة تشغيلات منفَّذة**؟ | **لا قارئ إنتاج.** لا فهرسة بالموضع ولا فحص عدد التشغيلات (`git grep` على `src` و`scripts` عند `c2e5e49` بنمطَي `length === 3` و«runs قرب 3»: ما طابق `length === 3` موضعان فقط هما `scripts/lib/clusterFreqWindows.js:333` و`scripts/lib/deviceCheck03After.js:1481` وكلاهما غير ذي صلة: عدّ قنوات في عيّنة ذاتية، وعدّ وسوم في اختبار تفكيك). **لكن قارئَين افترضا ضمناً أنّ كل عنصر يحمل الحقول كلّها** (t وtEnd والعدد والزمن) فكان المتروك سيُقرأ غياباً غير مُعلَن: | `scripts/lib/clusterFreqWindows.js:247` (فرع `NOT_COMPUTED` ⟵ `WINDOW_FIELDS_NOT_PRESENT`) · `scripts/lib/deviceCheck03After.js:556-567` (`cells` ⟵ `notPresent`) | `clusterFreqWindows.js:248` (فرع المتروك قبل `NOT_COMPUTED`: `RUN_SKIPPED_TIME_BUDGET`) · `deviceCheck03After.js` `readCpuRunDetail` (`skipped` لا يدخل `notPresent`) |
| هل يقارن أيّ قارئ **`sievePrimeCount` بثابت**؟ | **لا قارئ إنتاج.** القارئ يسلّم العدد خاماً. الموضع الوحيد الذي يحمل 664579 في `src` و`scripts` هو بيانات عيّنة ذاتية داخل السكربت لا مقارنة. | `scripts/lib/deviceCheck03After.js:1472-1473` (عيّنة ذاتية) | المرجع بحسب N: `src/analysis/fv68Reader.js:944` من الجدول الواحد `fv68Names.SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT` (`fv68Names.js:244`) |
| هل يقرأ أحدهم **`cpuKnownAnswerState` بالمساواة `'ran'` وحدها**؟ | **نعم، قراءتان** (وفوقهما مفردات القارئ: `fv68Names.js:363` `exact: [K.RAN]` ⟵ `partial:time_budget` كانت ستُقرأ «غير معروفة»): | `src/analysis/fv68Reader.js:922` `k === K.RAN ? عدم_تطابق : null` ⟵ الجزئي **null** (يضيع منه عدم تطابق حقيقي، ومعه `cpuKnownAnswerMismatches` في توقيع الجهاز `src/signatures/computeScanSignature.js:65`) · `scripts/lib/deviceCheck03After.js:1156` `kind !== RAN` ⟵ `CPU_D_SHARE` **NOT_MEASURED** للجزئي | `fv68Reader.js:984` (ran وpartial) · `deviceCheck03After.js:1256` · `fv68Names.js:385` (المفردات) |

### ٦.٢ — كل قارئ لـD: ما يعرفه الآن

| القارئ | يعرف القيمتين | المرجع بحسب `sieveLimit` | المتروك: لا نجاح ولا فشل ولا صفر |
|---|---|---|---|
| `fv68Reader.readCpuKnownAnswer` (`fv68Reader.js` ~:880-986) | المفردات `fv68Names.js:385-388`؛ `skipped:<سبب آخر>` و`partial:<سبب آخر>` ⟵ `UNRECOGNIZED_STATE` علناً | `:944`؛ N غائب في 68/69 ⟵ `SIEVE_LIMIT_WHEN_ABSENT_FV68_69`؛ غائب في ≥ 70 ⟵ شذوذ `SIEVE_LIMIT_ABSENT`؛ في أقدم/مجهول ⟵ لا N ولا مرجع | العنصر `skipped=true`؛ t وtEnd والعدد والزمن وN **null** (لا صفر)؛ المتروك لا يدخل `sieveMatch` ولا `sieveMismatch` ولا `shaMatch` ولا `shaMismatch`؛ عدّادان صريحان `sieveSkipped` و`shaSkipped`؛ شذوذ `SKIPPED_WITH_VALUES` إن حمل قيمة |
| عدّاد عدم التطابق `cpuKnownAnswer.mismatches` | ran وpartial:time_budget يُحسبان (`:984`) | — | الأنصاف المتروكة لا تُعدّ عدم تطابق؛ `not_run` وغير المعروفة وغياب الحالة ⟵ **null** |
| توقيع الجهاز `computeScanSignature` (`:66` `cpuKnownAnswerMismatches`) | يأخذ العدّاد من القارئ، فالجزئي صار يعطي رقماً (0 أو أكثر) لا null | — | تعليق فقط في الملفّ؛ لا تغيير في الشيفرة |
| `reevaluationDecision` (`:36`) | يقرأ حقل التوقيع | — | جزئي بعدم تطابق بعد فحص نظيف ⟵ سبب مسمّى `verification:cpuKnownAnswerMismatches 0→1`؛ fv69 (ran) ثمّ fv70 (جزئي) بلا عدم تطابق ⟵ لا سبب كاذب (مُختبَر) |
| حمولة النموذج (`runAnalysisInternal`) | **لا يصلها D بأيّ شكل** (لا قبل ولا بعد): مُختبَر بالمسار الكامل والشبكة وحدها مستبدَلة (القاعدة 37)، والحمولة بلا حقول D = الحمولة بها بايتاً بايتاً على العيّنات الثلاث | — | لا أثر |
| `findings.js` وقرّاء `verificationResults` الأخرى في `src` | لا يقرؤون D (`git grep cpuKnownAnswer` خارج الأسماء والقارئ: التوقيع وإعادة التقييم وحسب) | — | لا أثر |
| `scripts/lib/deviceCheck03After.js` (فحص الجهاز ٠٣) | `CPU_D_SHARE` يُحسب في ran وpartial (`:1256`) | الجولة الثانية: `sievePrimeCount` = المرجع لـ`sieveLimit` المتوقَّع (`ROUND2_EXPECTED_SIEVE_PRIME_COUNT` من الجدول الواحد) | المتروك لا يدخل مجموع D؛ يُذكر عدده في الأساس |
| `scripts/lib/clusterFreqWindows.js` (سكربت العناقيد) | التشغيل المتروك | — | حالة صريحة `RUN_SKIPPED_TIME_BUDGET` (لا نافذة ولا `WINDOW_FIELDS_NOT_PRESENT`)، `channels: null`؛ `runsSkippedTimeBudget` في الملخّص |

### ٦.٣ — فحص الجهاز ٠٣، الجولة الثانية (صفّ لكل مرحلة)

الحكم المجمَّع `CPU_D_R2` يُصدَر دائماً؛ وقبل fv70: `NOT_MEASURED` بسبب `BEFORE_FV70` بلا صفوف عائلة. وبعد fv70، لكل مرحلة (لاحقة `_<مرحلة>`):

| الصفّ | ما يحمله | الحكم |
|---|---|---|
| `CPU_D_R2_SUMMARY_<ph>` | مجموع D ونسبته من زمن المرحلة وعدد التشغيلات المنفَّذة والمتروكة وغير المبلَّغة وقيم `sieveLimit` و`sievePrimeCount` | INFO |
| `CPU_D_SHARE_PHASE_<ph>` | نسبة D (القائم) | PASS إن ≤ 1% |
| `CPU_D_R2_FIRST_RUN_<ph>` | التشغيل الأوّل حاضر دائماً: منفَّذ وبـt وtEnd | FAIL إن كان متروكاً (`FIRST_RUN_SKIPPED`) أو `not_reached` أو بلا t/tEnd |
| `CPU_D_R2_SIEVE_LIMIT_<ph>` | كل تشغيل يُشحن معه N يحمله = 1000000 | FAIL: غائب أو بنوع خاطئ أو قيمة أخرى (يُسرد)؛ NOT_MEASURED: لا غربال منفَّذ في المرحلة |
| `CPU_D_R2_SIEVE_PRIME_COUNT_<ph>` | العدد = 78498 | FAIL: غائب في تشغيل `match` أو قيمة أخرى (يُسرد بترتيبه وحالته) |

**لا حكم بالتخمين على `APP_VERSION`:** وسم بلا توقّعات بختم ≥ 70 ⟵ INFO بسببه (إصدار الجولة الثانية لم يُعطَ في الأمر). القيم المتوقَّعة (1000000 و78498 وأوّل تشغيل حاضر و≤ 1%) من أمر المنسّق؛ **منقولة، غير متحقَّقة** من المستودع المصدر.

### ٦.٤ — عيّنات fv69: تبقى — والسبب

عيّنات `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-*` (الستّ) **تبقى** بجانب fv70، لسببين مكتوبين: (١) **1.0.11 ما زال في الميدان** ويُرسل ختم 69 بلا `sieveLimit` ولا متروك، والقارئ مُلزَم بقراءة الختمين (ختم 68 و69 ⟵ N = 10000000)؛ فحذفها يترك هذا المسار بلا اختبار على عيّنة ذهبية (القاعدة 41). (٢) الاختبار يقارن الختمين صراحةً: حمولة fv69 تعطي 664579 مرجعاً، وfv70 تعطي 78498، والعدد 664580 في fv69 يخالفه (`test/cpuKnownAnswerFv70.test.js`). **لا يُحذف شيء** (القاعدة 8)؛ وإن أُغلق 1.0.11 يُقرَّر حذفها بقرار مستخدم لا هنا.

### ٦.٥ — قيود معروفة غير مُصلَحة

1. **`alloc_failed` للغربال — حُسم في الجزء الخامس (2026-10-13 +03، انظر §٦.٦):** كانت قيداً معروفاً غير مُصلَح (الأمر المنقول يعدّدها حاملةً لـ`sieveLimit` وكانت مفرداتنا تعدّها للـSHA وحده). أجاب المنسّق بأدلّة من الكود: الغربال يُرجعها ومعها N. أُدخلت في مفردات الغربال وفي `SIEVE_STATUS_KINDS_CARRYING_LIMIT`، واستُبدل الاختبار الذي كان يثبّتها «غير معروفة» (القاعدة 23).
2. **N متوقَّع ثابتاً (1000000) في الجولة الثانية:** إن غيّر التطبيق N لاحقاً يُخفق `CPU_D_R2_SIEVE_LIMIT` عمداً حتى يُحدَّث الثابت (من جدول المرجع الواحد).
3. **حالة إجمالية غير معروفة** (`partial:<سبب آخر>`) ⟵ `CPU_D_SHARE` NOT_MEASURED بأساس «لم يجرِ فحص D» (نصّ الأساس القائم) والتفصيل في `READER_ANOMALIES` FAIL؛ النصّ لم يُعدَّل.

### ٦.٦ — الجزء الخامس (2026-10-13 +03): `alloc_failed` للغربال و`cancelled` للحالتين، ونسخة العقد 450d9ed

> يحدّث ٦.٢ و٦.٣ و٦.٥. النصّ القديم بلا مساس (القاعدة 8)؛ الحاكم من هنا. الأدلّة من NeuralChek **منقولة من أمر المنسّق (قرأها بـ`git show`)، غير متحقَّقة عندي**؛ وما في `docs/FV68_CONTRACT.md` هنا (نسخة 450d9ed) **محقَّق عندي بالأداة**.

**١ — جواب سؤال ٦.٥-١: `alloc_failed` للغربال أيضاً.** سطر العقد في نسخة a04b4f0 (:1188، وهو في نسخة 450d9ed :1189) يعدّد **أسباب فشل SHA** («لكل سبب فشل SHA حالة (`self_test_failed` · `alloc_failed` · `mismatch`)») ولا ينفي `alloc_failed` عن الغربال؛ وقراءتي له نفياً كانت خطأ مني. أدلّة المنسّق (غير متحقَّقة): `450d9ed:app/src/main/java/net/neuralcheck/data/local/files/CpuKnownAnswer.kt:224` `SieveReading(STATUS_ALLOC_FAILED, null, duration, limit)` (الغربال يُرجعها **ومعها `limit`**)؛ و`c22251f:…/CpuKnownAnswer.kt:177` (قبل fv70: **الفجوة عندي سابقة لـfv70**)؛ و`c22251f:app/src/main/cpp/stress/known_answer.cpp:22` («prime_sieve_count's sentinel for a failed allocation»)؛ و`EXECUTED_STATUSES` = `match` · `mismatch` · `alloc_failed` · `self_test_failed`. **وفي نسخة 450d9ed هنا (محقَّق):** :1616 مفردات الحالتين `match · mismatch · alloc_failed · self_test_failed (SHA) · cancelled · not_reached · native_*`؛ :1660 `ran` = نصف على الأقلّ بحالة من `EXECUTED_STATUSES`؛ :1669 «**حاضر** في كل مصفوفة مقروءة: `match` · `mismatch` · `alloc_failed` (N الذي حاول) · `native_status_unknown:<n>`» و«غياب `sieveLimit`: (1) تشغيل لم يبدأ (`not_reached` · `skipped:time_budget`)؛ (2) نداء الغربال رمى (`native_call_failed:*`) أو أعاد مصفوفة غير مقروءة (`native_result_unreadable:size=<n>`)».

**٢ — ما تغيّر في القرّاء:**

| القارئ | التغيير |
|---|---|
| `fv68Names.js` | `alloc_failed` في مفردات الغربال (`:391`)؛ والحامل في `:339`؛ `cancelled` (`STATE_KIND.CANCELLED`) في مفردات الحالتين؛ `SIEVE_STATUS_KINDS_CARRYING_LIMIT` = `match` · `mismatch` · `alloc_failed` · `native_status_unknown` (مصدر واحد للقارئ وللفحص ٠٣). **`self_test_failed` تبقى للـSHA وحده** («self_test_failed (SHA)» في العقد) — للغربال غير معروفة وتُعلَن |
| `fv68Reader.readCpuKnownAnswer` | عدّادان صريحان `sieveCancelled` و`shaCancelled`: `cancelled` **لا تدخل Error ولا Match ولا Mismatch ولا عدّاد عدم التطابق، ولا تجعل الحالة الإجمالية `ran`** (الحالة تُقرأ من الحمولة كما حكم بها التطبيق بـ`EXECUTED_STATUSES`). `alloc_failed` للغربال تُحسب «خطأ» (لم يجرِ الفحص) كما للـSHA، ومعها N والمرجع بحسبه |
| `sieveLimit` مع `cancelled` | غيابه معلوم بالتصميم (`NOT_SHIPPED_BY_DESIGN`، لا `SIEVE_LIMIT_ABSENT`)، **وحضوره شذوذ جديد `CANCELLED_WITH_SIEVE_LIMIT`** (والقيمة تُعرض كما شُحنت). **المصدر الكود لا العقد** (العقد صامت: غائب من قائمتَي :1669): `450d9ed:…/CpuKnownAnswerScheduler.kt:147-158` (منقول، غير متحقَّق) — عند إلغاء الغربال `sieveStatus = got?.status ?: STATUS_CANCELLED` و`sieveLimit = got?.limit` وgot فارغ، فالغياب دائم؛ وإلغاء SHA وحده (`:175-176`، `:192-197`) يترك حالة الغربال وN كما أبلغهما. وسيُضاف سطر العقد في دفعة التطبيق التالية (قول المنسّق) |
| `deviceCheck03After` | `cancelled` لا تُعدّ منفَّذة (`executedRuns`) ويُعدّ منفصلاً (`cancelledRuns`)؛ أوّل تشغيل `cancelled` ⟵ `FIRST_RUN_CANCELLED` (FAIL: الأوّل «حاضر» = منفَّذ، **افتراض الوكيل المعلَن**)؛ حكم `sieveLimit` يشمل `alloc_failed` و`native_status_unknown`؛ حكم `sievePrimeCount` يبقى على `match` و`mismatch` (لا عدد لغيرهما) |
| `computeScanSignature` وسكربت العناقيد وحمولة النموذج | لا تغيير: `cancelled` لا تدخل عدّاد عدم التطابق في التوقيع (مُختبَر)؛ ولا يصل D النموذج |

**٣ — صفوف الجولة الثانية في فحص الجهاز ٠٣ (1.0.12 بعد النشر).** كلّها لختم ≥ 70؛ قبله `NOT_MEASURED:BEFORE_FV70`.

| الصفّ | ما يفحصه | الحكم |
|---|---|---|
| `EVALUATION_RULES_STAMP` | `evaluationRulesVersion` في جذر مستند `reports` = `EVALUATION_RULES_VERSION` (الثابت الواحد في `evaluationRulesVersion.js`؛ والاسم من `EVALUATION_RULES_VERSION_FIELD`، لا نسخة حرفية هنا) | PASS = الثابت؛ **FAIL: غائب أو بنوع خاطئ أو قيمة أخرى في تقرير كُتب بعد النشر**؛ NOT_MEASURED: `pipeline=cached` والمفتاح غائب (المخبَّأ يحمل ختم الأصل إن حمله وإلا يغيب — `analyzeDevice.js` `evaluationRulesStampFields`) أو مستند التقرير لم يُقرأ للختم؛ **وبعد رفع الختم 2026-10-23 (V7 §١٥): تقرير كُتب بالختم السابق `rules-2026-10-13-zero-cycles-unsupported` يُحكم عليه FAIL («قيمة أخرى») — الصفّ يقيس تقارير النشر الحالي وحده** |
| `CYCLE_CLASSIFICATION` | `classifyCycleCount(batteryHealth.cycleCount)` من القارئ نفسه (`readBatteryHealthOnly` يعطي الكتلة نفسها). **التوقّع لكل وسم وسيط** `--cycle-expect الوسم=classified\|none` (`classified` = `unsupported:zero_from_extra_api34` من الثابت الواحد، `none` = `null`)، لا ثابت في الكود | PASS/FAIL مقابل التوقّع؛ INFO بلا توقّع للوسم (لا حكم بالتخمين). **الأمر:** الـS21 Ultra (API 34) `classified`، والـS10 5G (API 30) `none` — يُمرَّر في سطر الأمر |
| `CYCLE_CLASSIFICATION_SIGNATURE` | ما حُفظ في `deviceProfiles/{primary}.scanHistory[scanId].signature.battery.cycleCountClassification` — **قراءة doc واحدة** (المفتاح من `deviceProfileKey` بالمُطبِّع نفسه `normalizeDeviceProfileKey`؛ أحدث 5 فحوص فقط؛ المعرّف مُهشَّر) | INFO. كل تعذّر حالة مسمّاة: `PROFILE_BY_PRIMARY_NOT_FOUND` (قد يكون الملفّ وُجد بطبقة A/B/C لا بـprimary — لا تعني غياب الملفّ) · `SCAN_NOT_IN_HISTORY` · `SIGNATURE_NULL` · `KEY_ABSENT` (المفتاح لا يُكتب إلا حين وقع التصنيف) … |
| وصول B-08 إلى النموذج | **لا صفّ** (القاعدة 22): حمولة النموذج لا تُخزَّن. كتلة صريحة في المخرَج `b08ModelPayload.state = NOT_READABLE_FROM_PRODUCTION` تسمّي الدليل الوحيد | — |

سطر السجلّ الوحيد الذي يدلّ (بلا `scanId`، فيُربط بنافذة الوقت): `runAnalysisInternal.js:302-304` يطبع **حين يقع التصنيف وحده**:
`[cycleCount] classification=<الوسم> — B-08 omitted from categoryStates.testResults (not sent to the model)`
(مثلاً `[cycleCount] classification=unsupported:zero_from_extra_api34 — B-08 omitted from categoryStates.testResults (not sent to the model)`). غيابه **لا يثبت** أن B-08 وصل.

**٤ — نسخة العقد 450d9ed (`docs/FV68_CONTRACT.md`).** نُسخت بـ`cp` بايتاً ببايت من `evidence/build-1.0.12/fv70-for-backend/FV68_CONTRACT-NeuralChek-450d9ed.md` (sha256 `f1bf6b1f7fb94f9e2fa7afd45bfed00e0f611f1bd9170e5101524b174d6c99b7`، 1901 سطراً، 388048 بايتاً؛ مُتحقَّق قبل النسخ وبعدها وبعد الالتزام) — والتفصيل وجدول الإزاحة في `docs/FV68_CONTRACT.SOURCE.txt`. الإزاحة عن نسخة a04b4f0 مُتحقَّقة بالأداة على **كل سطر لم يتغيّر** (نصّه يساوي نصّ السطر المقابل بالجدول): :N ≤ 6 كما هي؛ 7..1399 ⟵ N+1؛ 1400..1509 ⟵ N+2؛ 1511..1582 ⟵ N+4؛ N ≥ 1583 ⟵ N+215. وعن نسخة 738da89: N+2 حتى :1398.

**٥ — استشهادات هذا الجرد بسطور العقد، مُتحقَّقة مقابل النسخة الجديدة** (لكل استشهاد: نصّ السطر في نسخة المصدر يوجد حرفياً في 450d9ed عند السطر الجديد؛ أسطر الاستشهاد في §١ و§٢ و§٥ من نسخة 738da89، وأسطر §٥.١ و§٦.٥ من نسخة a04b4f0). **كلّها صالحة بعد الإزاحة؛ لم أُعدّل نصّها القديم:**

| الاستشهاد في الجرد | المصدر | السطر القديم | السطر في 450d9ed |
|---|---|---|---|
| §١: «العقد §0 :12» (حرف فئة) | 738da89 | :12 | :14 |
| §١: «عقد :773» (`cycleCountSource` لا يُقرأ) | 738da89 | :773 | :775 |
| §١: «عقد §٧-و :1361» (ما حدّده العقد للدفعة ١٠) | 738da89 (السطر عُدِّل في a04b4f0 فلا يطابق حرفياً؛ وُجد بعبارته «ما حدّده العقد للدفعة ١٠ ولم يدخل fv68» وهو في a04b4f0 :1362) | :1361 | :1363 |
| §١: «عقد :41» و«:1029» (`not_measured`) | 738da89 | :41 و:1029 | :43 و:1031 |
| §١: «عقد §٧-د البند 5 :1246» (`phaseBoundaries`) | 738da89 | :1246 | :1248 |
| §٢: «:398-402» (فهارس ≤ 10) | 738da89 | :398-402 | :400-404 (السطران الفارغ وسياج الكود يتكرّران في الملفّ فلا يُطابقان حرفياً؛ يُطابَق :398 ⟵ :400 و:401 ⟵ :403 و:402 ⟵ :404) |
| §٢: «عقد :412» و«:779» (ضجيج على قنوات خاطئة) | 738da89 | :412 و:779 | :414 و:781 |
| §٥.١: «`docs/FV68_CONTRACT.md:1396-1399` في نسخة a04b4f0» (الدورات §٧-ز) | a04b4f0 | :1396-1399 | :1397-1400 |
| §٦.٥: «:1188» (أسباب فشل SHA) | a04b4f0 | :1188 | :1189 |

والاستشهادات بأسطر العقد في **تعليقات الكود** (`functions/src` و`functions/scripts` و`functions/test`) لم تُعدَّل: كُتبت بأرقام نسخ سابقة وتسمّي القسم أيضاً (نمط SOURCE.txt: «re-find by the section text»)؛ وما كتبتُه في هذا الجزء يحمل أسطر 450d9ed (:1616 و:1630 و:1660 و:1669).

### ٦.٧ — الجزء السادس (2026-10-14 +03): جدول توقّعات الجولة ٢ لسكربت الفحص ٠٣ (`--round 2`)

> سكربتات واختبارات ووثائق فقط؛ لا `functions/src`. الأسطر والاقتباسات **منقولة من أمر المنسّق (2026-10-14) عن `DEVICE-CHECK-03-2026-10-10.md`، غير متحقَّقة عندي** (الوثيقة في مساحة العمل خارج مستودعي).

**المشكلة (بالأداة عند `d14c558`):** `TAG_EXPECTATIONS` للجولة ١ (B1 · B2 · S1 · S2 · WAIT؛ 1.0.11 وختم 69) — فكان S1/S2 على 1.0.12 وختم 70 يخرجان فشلاً كاذباً في الإصدار، وB8 (فحص مستقلّ على الـS21 Ultra) بلا توقّعات.

**الحلّ:** جدول ثانٍ `TAG_EXPECTATIONS_R2` (B8 · S1 · S2) يُختار بـ`--round 2`. **الغائب = الجولة ١ كما كانت**، وأيّ قيمة غير `1` أو `2` USAGE برمز 2 قبل أيّ قراءة (القاعدة 22) — في `parseArgs` وفي `evaluateReport` نفسها (`roundOf`). جدول الجولة ١ وقواعده **لم تتغيّر**: sha256 لـ`JSON.stringify(TAG_EXPECTATIONS)` و`JSON.stringify(ITEM_RULES)` عند `d14c558` (مقيسة بـ`git archive` ثم `require`) تساوي الحالية، والاختبار يثبّتهما. 1.0.12 **مصدر واحد مُصدَّر** `EXPECTED_APP_VERSION_R2`، والختم `N.FIELDS_VERSION_70`.

| الوسم | الأسطر (مصدرها `DEVICE-CHECK-03-2026-10-10.md:<سطر>`) |
|---|---|
| **B8** (`sessionStrict: false`) | الإصدار والختم `:278` · `EXPECT_M02_AUTO_COMPLETE_FULL_GRID` `:295` · `EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT` `:294` |
| **S1** (`sessionStrict: true`) | الإصدار والختم `:278` · `EXPECT_M02_NOT_WORKING_PARTIAL_GRID` `:303 + :268` · M-15 `:302` · `SESSION_STATUS` و`SESSION_JOINED_BY` `:297` · `EVALUATION_DOC` `:297 + :191` |
| **S2** (`sessionStrict: true`) | الإصدار والختم `:278` · M-15 `:302` · `SESSION_STATUS` و`SESSION_JOINED_BY` `:297` · `EVALUATION_DOC` `:297 + :191` — **ولا توقّع لـM-02** |

- **M-15 تحديداً** (`EXPECT_R2.M15_UNAVAILABLE_HARDWARE_ABSENT`، كائن مستقلّ عن `EXPECT` فلا يُمسّ حارس الجولة ١): PASS = صفّ `M-15` في `manualResults` حالته `unavailable` وتصنيفه في الخادم `NOT_MEASURED/HARDWARE_ABSENT`؛ FAIL = غائب (الإجابة مطلوبة عمداً) أو حالته أخرى أو تصنيفه آخر. `unavailable` على اختبار آخر (M-08 مثلاً) **لا يكفي**.
- **الدورات:** لا في الجدول (`:293`): التوقّع وسيط `--cycle-expect B8=classified,S1=none,S2=none` كما بُني في الجزء الخامس.
- **لا صفّ لـ`EVALUATION_NO_MOVED_IDS` في سطور S1/S2:** لا سطر وثيقة منقول له في هذه الجولة، فلا يُختلَق مصدر (الصفّ العامّ يبقى لكل وسم).
- **ما لا يُحكم به من الخادم (القاعدة 22): ظهور البطاقة على شاشة الزبون (`:193`)** — سجلّ الهاتف، **يُحكم به من ج٨**. لا صفّ، ويُكتب في المخرَج `expectations.notJudgedFromServer` باسمه.
- **وسم الجولة ١ في الجولة ٢** (B1 أو B2 أو WAIT): القواعد العامّة وحدها، ويُعلَن بلا توقّعات خاصّة باسم وسوم الجولة ٢.
- المخرَج يحمل `input.round` (1 أو 2) و`expectations.round` (2 فقط) و`rules` للجولة المختارة (`ITEM_RULES_R2` للثانية).

**أمر التشغيل للجولة ٢ (يشغّله المستخدم بيده؛ البريد من متغيّر البيئة `DEVICE_CHECK_03_OWNER_EMAIL` لا من السطر):**
`node functions/scripts/device-check-03-after-readonly.js --tokens "B8=NC-XXXXXX,S1=NC-XXXXXX,S2=NC-XXXXXX" --round 2 --cycle-expect "B8=classified,S1=none,S2=none" --out <evidence>/device-check-03-after-r2-<تاريخ+03>.json`
وإن لم تُجرَ الجلسة الثانية: `--tokens "B8=NC-XXXXXX,S1=NC-XXXXXX" --round 2 --cycle-expect "B8=classified,S1=none"` — **`--cycle-expect` لا يقبل وسماً ليس في `--tokens`** (USAGE). وبرمز S2 لا مستند له: `REPORT_FOUND` FAIL ورمز الخروج 1، وكل بند S2 آخر `NOT_MEASURED:REPORT_ABSENT` (لا PASS).

الاختبار: `test/deviceCheck03Round2.test.js` (من `main` الحقيقية، عيّنتا 11ch و13ch من fv70 بتعديل مكتوب لكل وسم).

### ٦.٨ — الجزء السابع (2026-10-14 +03): الإصدار لكل مجموعة في جدول الجولة ٢ (S1 وS2 على 1.0.14، وB8 على 1.0.12)

> سكربتات واختبارات ووثائق فقط؛ لا `functions/src`. السطر **منقول من أمر المنسّق (2026-10-14) عن `DEVICE-CHECK-03-2026-10-10.md:343`، غير متحقَّق عندي** (الوثيقة في مساحة العمل خارج مستودعي). والأمر يقول: لا تغيير في شكل الحمولة (`fieldsVersion` 70 كما هو، منقول من تقرير وكيل التطبيق، غير متحقَّق عندي).

**ما تغيّر عمّا في ٦.٧:** إصدار التطبيق المتوقَّع في جدول الجولة ٢ لم يعد واحداً للجولة. B8 يبقى 1.0.12 (`EXPECTED_APP_VERSION_R2_B8`، ومصدر إصداره `:278` كما كان)، وS1 وS2 صارا 1.0.14 (`EXPECTED_APP_VERSION_R2_SESSIONS`، ومصدر إصدارهما `:343`، ومصدر ختمهما `:342` — انظر أدناه). الاقتباس جزء حرفي من السطر **بلا رمز التقرير**: «S1 وS2 على 1.0.14، وB8 على 1.0.12 كما جرى». والثابت `EXPECTED_APP_VERSION_R2` المذكور في ٦.٧ **حُذف** (لا مستهلك له غير الاختبار الذي استُبدل). وصفّا الإصدار والختم لـS1 وS2 في جدول ٦.٧ أعلاه صارا `:343` و`:342`.

- **الختم (التزام لاحق):** صفّ `FIELDS_VERSION` (70 بالضبط) لـS1 وS2 يستشهد بـ`:342` بدل `:278`، والاقتباس بلا رموز markdown: «وfieldsVersion 70 كما هو، ولا تغيير في الخادم.» (نصّه الخامّ منقول من أمر المنسّق: «- **و`fieldsVersion` 70 كما هو، ولا تغيير في الخادم.**»؛ منقول، غير متحقَّق عندي). فأُغلق القيد الذي كان مذكوراً هنا عند الالتزام الأوّل (اقتباس `:278` عن بناء 1.0.12 في سطر ختم وسمَين على 1.0.14).
- **الباقي على `:278`:** B8 للسطرين (الإصدار والختم).
- **الاختبار:** `test/deviceCheck03Round2.test.js` — حُكم الإصدار بالقيم الأربع عبر `main` الحقيقية (`--round 2`): S1 وS2 بـ1.0.14 PASS وبـ1.0.12 FAIL، وB8 بـ1.0.12 PASS وبـ1.0.14 FAIL، والغائب NOT_MEASURED. واستُبدل فيه اختباران كانا يثبّتان «كل وسم في الجدول الثاني = 1.0.12»؛ واستُبدل في موضعه صفّا `FIELDS_VERSION` لـS1 وS2 في `EXPECTED_LINES` (كانا يثبّتان `:278`)، فالختم يعود إلى `:278` ⟵ الاختبار يُخفق.


## ٧ — قرّاء fv71 في الخادم (محطّة ٢) — S-M02 (M-02 الشبكة الجديدة بالخامّ) — 2026-10-18 +03

> **الأمر:** `evidence/run-2026-10-18/order-backend-engineer-1-fv71-readers.md` (في مساحة العمل، منقول بمساره لا بنصّه) — بند S-M02، الخيار «ب» (الخامّ بلا فقد، والخادم يكشف). **العقد الحاكم:** `docs/FV71_CONTRACT_SECTION.md` (نسخة **قسم** §٧-ي وحده من NeuralChek@0af0b5c، sha256 `7130b544…`؛ `docs/FV71_CONTRACT_SECTION.SOURCE.txt`) — **الملفّ كلّه `docs/FV68_CONTRACT.md` ما زال 450d9ed ولا يحمل القسم** (مُتحقَّق: `git grep -n "gridBasis\|FIXED_8X15\|MM_TARGET" -- docs/FV68_CONTRACT.md` ⟵ لا شيء؛ `fv71` يظهر فيه في خمسة أسطر إحالة فقط: `:7 :1603 :1605 :1728 :1771`). **التصميم:** `design-m02-touch-grid-2026-10-13.md` في مساحة العمل (§3 §6.3 §6.6) حيث يسكت القسم؛ وقراءتي له بالأداة، لا نسخة منه هنا.
> **حالة العيّنات (تحديث 2026-10-18، §٧.٧):** حلّت **حمولات المُنتِج الثلاث** (NeuralChek@f9e0571) محلّ العيّنتين المبنيّتين من العقد — **بند «استبدال بعيّنة المُنتِج» أُنجز**؛ والقسم المنسوخ صار f9e0571 (§٧.٧). ما تحت هذا العنوان في §٧.١–٧.٦ كُتب قبل المزامنة؛ وما نُسخ أو تغيّر مذكور في §٧.٧ وموسوم هنا بـ«(تحديث ٧.٧)».

### ٧.١ — جواب أسئلة وكيل التطبيق الثلاثة (تقريره `app-engineer-m7-diagnosis-0af0b5c-2026-10-18.md` البند ٤؛ منقولة، والأجوبة من كودي)

| السؤال | الجواب | الموضع **قبل** (8e5c426) | الموضع **بعد** |
|---|---|---|---|
| (١) هل `gridBasis` في القارئ يُشتقّ من الختم وحده أم من gridCols/gridRows؟ | **لم يكن موجوداً أصلاً** (`git grep gridBasis 8e5c426 -- functions` ⟵ لا شيء). الآن: **من الختم وحده** — `FIXED_8X15` لكل ختم < 71 (ومنه 70)، `MM_TARGET` ≥ 71، `UNDETERMINED_NO_FIELDS_VERSION` بلا ختم. الأبعاد **لا تشتقّ الأساس**: تُطابَقه ويُعلَن تناقضها (`TOUCH_GRID_DIMENSIONS_DISAGREE_WITH_BASIS` لـ8×15 تحت ختم < 71 فقط) | — | `fv68Reader.js:1227` (`gridBasis`) · القيم `fv68Names.TOUCH_GRID_GRID_BASIS` · الاختبار `test/fv71TouchGridReader.test.js` الكتلة «ب» (القيم الثلاث، والختوم 67..72 و100، ومنع الاشتقاق من الأبعاد في الاتّجاهين) |
| (٢) هل `checkM02` أو قارئ آخر يفترض 8×15/120؟ | **لا.** `checkM02` يقارن نسبياً: `touchedCells !== totalCells` (FULL) أو `<` (PARTIAL) — `scripts/lib/deviceCheck03After.js:1100-1118` (المقارنة `:1114`)، ونصوص قواعده `:178 :225 :312 :391` تقول «touchedCells = totalCells» بلا رقم. 120 و8 و15 لا تظهر في `src` ولا في `scripts` إلا في تعريفات الاختبارات الاصطناعية (`test/fv68Reader.test.js:659,698`) وفي حارس الأبعاد الجديد (`fv68Names.TOUCH_GRID_FIXED_DIMENSIONS`). **تنبيه:** توقّع B8 `EXPECT.M02_AUTO_COMPLETE_FULL_GRID` (`:1190`) يشترط M-02 **بـmeasurements وauto_complete** ⟵ بعد NeuralChek@5f90ce1 (نقرة «يعمل» تكتب pass بلا شبكة) قد يُخفق بالتصميم؛ **لم أمسّ الأداة** (قرار المنسّق) | `deviceCheck03After.js:1100-1118` | بلا تغيير في الأداة |
| (٣) ماذا يقرأ الخادم لـM-02 = pass **بلا measurements** عند ختم 70 و71؟ | **قبل:** لا شيء — `readMeasurements` تعود عند غياب المفتاح قبل دفع العنصر (`fv68Reader.js` السطر `if (!has(entry, N.MEASUREMENTS_KEY)) return;`)، وقائمة «الغائب المتوقَّع» لا تضمّ M-02 اليدوي، فلا عنصر ولا إعلان ولا شذوذ (والاختبار القائم `test/fv68Reader.test.js` الكتلة «ي-٢» البند ٥ يثبّت ذلك، وما زال صحيحاً: لا عنصر ولا `expectedButAbsent`). **بعد:** قسم أعلى المخرَج `touchGridAnswer` بحالة صريحة: `PASS_WITHOUT_RAW` لـpass بلا measurements — **حالة مشروعة لا شذوذ** (أمر المنسّق 2026-10-18 عن NeuralChek@5f90ce1: نقرة «يعمل» تكتب pass بلا فتح الشبكة؛ **منقول، غير متحقَّق من مستودعي**)؛ و`RAW_PRESENT` مع علاقة `BACKS_PASS` (خامّ auto_complete) أو `DOES_NOT_BACK_PASS` (خامّ سابق لا يسند الجواب: E21-٣) أو `UNDETERMINED_NO_END_REASON`؛ ولا مقارنة لحالات غير pass (القارئ **لا يستنتج الحالة من endReason**) | `fv68Reader.js:1245` و`:1250-1251` عند 8e5c426 (`return` قبل الدفع، والقائمة بلا M-02 اليدوي) | `fv68Reader.js:1643` `readTouchGridAnswer` · الحالات `fv68Names.TOUCH_GRID_ANSWER_STATE` و`TOUCH_GRID_PASS_RAW_RELATION` · الاختبار `fv71TouchGridReader.test.js` الكتلة «ط»: الختوم 69 و70 و71 × كل الحالات |

### ٧.٢ — قرّاء M-02 في الخادم: ما يقرؤه كلٌّ وأثر fv71 (القاعدة 25)

| الموضع | يقرأ | أثر fv71 / الفعل |
|---|---|---|
| `functions/src/analysis/fv68Reader.js` `readTouchGrid` (`:1189`) | المفاتيح الثمانية + الجديدة | **يتوسّع:** `gridBasis` وكتلة `path` (`readTouchPath` `:1476`: اثنان وثلاثون مفتاحاً بنوعها وحضورها وحالتها وسبب غيابها) + `readStrokes` `:1297` و`readDisplayedSuspects` `:1420` و`readPathCap` `:1455` |
| `functions/src/analysis/touchPath.js` (جديد) | خطوط مُصحَّحة من القارئ | معدّل العيّنات (الوسيط والمئين 95)، والمواضع المشتبهة (`gap_jump` · `coord_jump` · `lift_break` [اسم خادم] · `edge_exit`) مع `detector.version` والعتبات، وتغطية الخلايا (عبور Amanatides–Woo) مقابل `touchedCells`/`untouchedCells`، وأقرب بُعد من كل حافّة، وفرق علامات العرض عمّا كشفه الخادم. **بلا إحداثيات خامّ في المخرَج** |
| `functions/src/analysis/fv68Names.js` | الأسماء والعتبات والمفردات | مصدر واحد (القاعدة 24): `TOUCH_PATH_*`، `TOUCH_GRID_GRID_BASIS`، `TOUCH_GRID_ANSWER_STATE`، `FIELDS_VERSION_71`، `MODEL_HIDDEN_RAW_MEASUREMENT_KEYS` |
| `functions/src/analysis/runAnalysisInternal.js:300-301` | `readFv68(fingerprint)` ثم `summarizeForLog` | **بلا تغيير**: القراءات تُعاد مع النتيجة ولا تصل analyzeDevice ولا مستنداً ولا عميلاً (مُثبَت بالـe2e: لا `readerVersion` ولا `strokes` في الردّ ولا مستند التقرير) |
| `functions/src/analysis/lightenFingerprintForStorage.js` · `reportRawStore.js` `buildReportRawDocument` | البصمة كاملة بلا `samples` | **تمرّر ولا تُسقط**: خامّ M-02 (strokes بإحداثيّاتها) يصل `reportRaw/{scanId}` بايتاً ببايت (`test/fv71ProducerSamples.test.js` الكتلة «جـ» + `analyzeDeviceFv71ProducerSamples.e2e.test.js` على المحاكي؛ تحديث ٧.٧) |
| `functions/src/analysis/reportRawStore.js` `assertReportRawFits` (`REPORT_RAW_MAX_BYTES = 900000`) | **مستند reportRaw كاملاً** (JSON مضغوط، بلا `createdAt`) لا حقل منه | فوقه `REPORT_RAW_TOO_LARGE` ⟵ `analyzeDevice.js:817-822` `resource-exhausted` **بعد** نداء النموذج و**قبل** الكتابة الذرّية؛ الرصيد يعود 5 (مُثبَت e2e). **(تحديث ٧.٧ — مقيس من ملفّ المُنتِج 16ch، 15,000 نقطة):** M-02 = 275,515 بايتاً ومستند reportRaw = 318,535 بايتاً (`fv71ProducerSamples.test.js`)؛ كان القياس التركيبي 448,355 و467,128 وحُذف مع عيّناته. القسم يذكر 443,706 بايتاً لـ15,000 نقطة بالمُنتِج (`TouchGridRecorderTest`: **منقول، غير متحقَّق**) |
| `functions/src/analysis/buildV7Payload.js` `sanitizeTestResultsForModelPayload` | `testResults[].raw` = عنصر manualResults كلّه | **عُدِّل (وُجد بالأداة):** كان خامّ M-02 كلّه — وبعد fv71 `strokes` بآلاف النقاط — يصل **النموذج** (`categoryStates.buildAllTestResults` `raw: r`، ولا قائمة بيضاء لـtestResults). صار `hideRawMeasurementKeysForModel` يُسقط **مفاتيح fv71 وحدها** (من `MODEL_HIDDEN_RAW_MEASUREMENT_KEYS`) من نسخة النموذج؛ **والمخزَّن لا يتغيّر**، والمفاتيح الثمانية القديمة تصل بايتاً ببايت (لا تغيير لختم ≤ 70). الاختبار `fv71ModelPayloadRaw.test.js` + e2e |
| `functions/scripts/lib/deviceCheck03After.js` (`checkM02` `:1100` · كتلة M-02 `:1335`) | `touchGrid.*` الثمانية | **بلا تغيير**: لا يعرض `gridBasis` ولا `path` ولا `touchGridAnswer` (لم يُطلب). قرّاء `touchedCells`/`totalCells` الآخرون: `fv68Reader.js` و`fv68Names.js` فقط (`git grep touchedCells -- functions/src`) |
| `functions/src/analysis/findings.js` · `signatures/*` · `categoryStates.js` | — | **لا يقرؤون M-02 ولا measurements**: M-02 فيها صفّ حالة (`utils/categories.js:72`، `testKinds.js:316`) ولا يدخل الحرف من خامّه |
| الموقع (`wepsite`) | — | لا قارئ (التصميم §6.7؛ خارج حدودي، منقول) |

### ٧.٣ — قرارات اتّخذتُها (القاعدة 45: سطر لكل قرار)

1. **`touchGridAnswer` أعلى المخرَج لكل الأختام** (لا لـ≥ 71 وحدها): الحالة تتبع صفّ M-02 اليدوي لا الختم، وpass بلا measurements ممكن من ختم 70.
2. **كتلة `path` تحمل حالتها وحدها تحت ختم < 71** (لا ٣٢ مفتاحاً بـNOT_IN_FIELDS_VERSION): يُبقي مخرَج الأختام القديمة كما كان عدا مفتاحين وقسم (فُحص بالفرق: كل فروق القراءات الذهبية السبع «مضافة» في `touchGrid.gridBasis` و`touchGrid.path` و`touchGridAnswer` وحدها).
3. **REASONED لمفاتيح لا يحدّد القسم حضورها** (`xdpi` `ydpi` `densityDpi` `pxPerMm` `densitySource` `unbufferedDispatch`): غياب بلا سبب شذوذ، وغياب بسبب حالة معلنة — أقلّ افتراضاً. **(تحديث ٧.٧: مفاتيح الكثافة الخمسة صارت ALWAYS — قائمة `absentFieldReasons` في قسم f9e0571 لا تسمّيها؛ و`unbufferedDispatch` يبقى REASONED.)**
4. **الكاشف بعتبات design §3 كما هي** ([اجتهاد] غير مُعايرة) في `fv68Names.TOUCH_PATH_DETECTOR` مع `version`، تُغيَّر هنا بلا APK؛ و`lift_break` اسم خادم لما لا اسم له على السلك. تفاصيل ما قرّرتُه حيث يسكت التصميم في رأس `touchPath.js` وفي `detector.notes`.
5. **`cancel_flagged` يُعامَل كـ`cancel`** (القسم لا يشرحه: «تُنقل في أمر البناء» ولم تُنقل).
6. **الحافّة = حافّة سطح اللمس** بإحداثيّاته المحلّية لا حافّة الشاشة الفيزيائية.
7. **مقارنة الخلايا** بـ`floor(x / cellWidthPx)` مقصوصة إلى الشبكة — **اصطلاح غير منصوص عليه في القسم؛ (تحديث ٧.٧) أيّدته عيّنات المُنتِج الثلاث: ما شحنه المُنتِج = عدّ مستقلّ بخطوة 0.25 بكسل = ما حسبه القارئ (`MATCH`)**؛ و`DISAGREE` شذوذ معلَن لا حكم.
8. **مفاتيح غير معروفة في ختم ≥ 71** شذوذ (`TOUCH_GRID_UNKNOWN_KEY`)، وحضور مفاتيح fv71 تحت ختم أقدم شذوذ (`TOUCH_PATH_KEYS_PRESENT_BEFORE_FV71`) — القاعدة 25.
9. **تصحيح الحساب العائم** في الكاشف: السرعة بالضرب في 1000 قبل القسمة على الملّيثانيات، والزاوية مقرَّبة إلى 1e-9 درجة، فتُختبَر الحدود **بالمساواة الحقيقية** (20 مم/ث بالضبط، 45° بالضبط).

### ٧.٤ — معلّق ولا يُدَّعى (القاعدة 22 والأمر)

| البند | السبب | الاقتباس |
|---|---|---|
| ~~استبدال العيّنتين بعيّنة المُنتِج بعد A-M02 (القاعدة 41)~~ **أُنجز 2026-10-18 (تحديث ٧.٧)** | كان: لا منتِج لـfv71 | الأمر: «ابنِ العيّنات من العقد ووسمها صراحةً… وسجّل… بنداً معلّقاً» — ثم صدرت عيّنات المُنتِج فاستُبدلت |
| أسماء شروط `densityCheck` الفاشلة | القسم ف-02: «**لا أخترعها هنا**» | **(تحديث ٧.٧)** عُدِّدت خمسة [ق] من قسم f9e0571 وصار القارئ يصنّفها؛ [ق] = قرار تقني للتطبيق لم يُعتمد؛ ولا عيّنة مُنتِج تحمل أيّاً منها |
| قيم `resampledFlagState` | القسم ف-03: «**قيمه لا تصلني**… تُنقل في أمر البناء» ولم تُنقل | **(تحديث ٧.٧)** عُدِّدت قيمتان [ق، معلّق: مواصفة غائبة] (`not_available_api` · `not_read_by_app`) والدلالة لا يحكم بها القارئ |
| دلالة `cancel_flagged` | القسم ف-03: «**لا أشرحها هنا**» | تُعامَل كـ`cancel` (٧.٣-٥). **(تحديث ٧.٧)** قسم f9e0571 يسمّي منشأه: `cancel_flagged` (`FLAG_CANCELED`)؛ والتعامل لم يتغيّر |
| حدّ مداخل الفهرس لكل مستند في Firestore مقابل مصفوفات أرقام كبيرة في `reportRaw` | **سؤال بحث خارجي** (القاعدة 44): لا أعرف إن كانت الكتابة تُرفض بسبب فهرسة عناصر المصفوفات (`x` `y` `dtMs` `touchMajorPx` × حتى 15,000 نقطة)؛ المحاكي لا يفرضه؛ لا `fieldOverrides` لـ`reportRaw` في `firestore.indexes.json` (والفهارس قرار مستخدم، القاعدة 43) | يُكتب للمستخدم ليجيب من التوثيق |

### ٧.٥ — S-VOL: قارئ أحداث أزرار الصوت الخامّة (M-09/M-10، fv71) — 2026-10-18 +03

> **الصفّ:** `S-VOL server day 6.75-7.25 | 8-9 قارئ أحداث أزرار الصوت الخامّة fv71 [C]` (لا تقدير مكتوباً للخادم). **المواصفة:** `docs/FV71_CONTRACT_SECTION.md` ف-04 وE22. **قرار المستخدم (2026-10-14، `NEURALCHECK-FINDINGS.md:9453`، بنصّه عن الأمر):** «Station 2, fv71, with raw (Recommended)».
> **الأسماء [م] «مقترحة، تنتظر إقرار المنسّق» (VK:191) — لم تُقرّ بعد** (القسم ف-04 بنصّه): تُقرأ بوسمها. **لا حكم هنا:** العتبات تُحسب على الخادم لاحقاً («الخامّ لا يحمل حكماً: العتبات على الخادم»، القسم)، والقارئ يسلّم الخامّ بحالته وعلاقاته.
> **حالة العيّنات (تحديث ٧.٧):** عيّنات المُنتِج الثلاث (NeuralChek@f9e0571) حلّت محلّ المبنيّتين من العقد؛ البند المعلّق «استبدال بعيّنة المُنتِج بعد A-VOL» **أُنجز**.

| الموضع | ما يفعله |
|---|---|
| `fv68Reader.js` `readVolumeButton` (يُستدعى من `readOneMeasurements` لـM-09 وM-10) | أربعة عشر مفتاحاً بنوعها وحضورها (`fv68Names.VOLUME_BUTTON_FIELD_SPEC`): `ALWAYS` غيابه شذوذ؛ `WHEN_EXPECTED_DOWN` (`timeToFirstExpectedDownMs`) غيابه مع `expectedDownCount = 0` حالة معلنة بلا صفر؛ `WHEN_UP_RECEIVED` (`holdMs`) غيابه حالة معلنة حين لا `up` في قائمة كاملة؛ `WHEN_AUTO_DETECTED` (`detectionSource`) حاضر ⟺ `endReason = auto_detected`؛ اختياريّة (`flags` ومستويات الصوت) غيابها حالة، وشذوذ فقط حين يقوم عليها قرار الكشف بتغيّر المستوى |
| `readVolumeEvents` | عناصر `events[]` الستّة (`tMs` `keyCode` `action` `repeat` `deviceId` `source`)، والسقف 64 [م] و`eventsTotal` (`> 64` ⟵ `eventsTruncated = true` مُعلَن)، وكل مشكلة عنصر بشذوذ واحد بعدده؛ و`[]` تُقرأ `EMPTY` **ولا تعني «لم يضغط»** |
| `pressEvidence` (اسم خادم) | `KEY_EVENT_SEEN` · `LEVEL_CHANGE_ONLY` · `NOT_ESTABLISHED` — دليل بلا حكم؛ لا نجاح ولا فشل من `events` وحدها (القسم: «لا يقرأ القارئ `[]` بمفردها نجاحاً ولا فشلاً») |
| `readVolumeButtonAnswers` (قسم أعلى المخرَج) | لكل من M-09 وM-10: `NOT_IN_MANUAL_RESULTS` · `WITHOUT_RAW` · `RAW_UNREADABLE` · `RAW_PRESENT` — **صفّ بلا measurements حالة صريحة لا خطأ**؛ ختم < 71: الكتلة `NOT_IN_FIELDS_VERSION` (القسم: measurements «غائب (null)» في fv70) وحضور مفاتيحها مبكّراً شذوذ |
| `buildV7Payload.hideRawMeasurementKeysForModel` | كل مفاتيح measurements لأزرار الصوت (جديدة في fv71) تُحذف من **نسخة النموذج** (المخزَّن بلا تغيير) — وإلا وصلت events إلى النموذج (وُجد بالأداة: `testResults[].raw` = العنصر كلّه) |

**معلّق (لا تخمين — القسم لا يحدّده):** أيّ الاختبارين رفع الصوت وأيّهما خفضه (يقول فقط `expectedKeyCode` ∈ {24، 25}) — القارئ **لا يفرض** تطابقاً (مُختبَر: M-09 بـ25 وM-10 بـ24 مقبولان)؛ نوع `flags` وشكله («FLAG_FROM_SYSTEM على العنصر أو الخامّ») — يمرّ كما وصل؛ معنى `expectedDownCount` (أيعدّ التكرار `repeat > 0`؟) و`otherKeyDownCount` (أيعدّ غير الصوت؟) — **(تحديث ٧.٧: أجاب عنهما قسم f9e0571 — «ضغطات down بـrepeat = 0»، والمسجَّل «عائلة الصوت 24 · 25 · 164» وغيرها يُهمَل — فصارت العلاقة تُفرض حين القائمة كاملة)**؛ إقرار الأسماء [م] (E22: «أوصي بإقرار أسماء VK:193-202 كما هي، مع إضافتي `detectionSource` و`volumeStreamMax`/`volumeLevelAtOpen`/`volumeLevelAtEnd`»)؛ إلحاق M-09/M-10 بـ`PASS_OPENS_DIALOG` (قرار في التطبيق).
**من الاختبار:** `test/fv71VolumeButtonReader.test.js` (القيم المعدَّدة كلّها بالقاعدة 30، والحضور والغياب، والسقف، والعلاقات) · القراءات الذهبية في `test/fv68ReadingsGolden.test.js` · `test/fv71ProducerSamples.test.js` · `test/analyzeDeviceFv71ProducerSamples.e2e.test.js` (المسار الكامل على المحاكي؛ تحديث ٧.٧: حلّا محلّ fv71VolumeSynthetic وanalyzeDeviceFv71Volume.e2e المحذوفين) · `test/fv71ModelPayloadRaw.test.js` الكتلة «د».

### ٧.٦ — S-P6-13: قارئ توحيد الظروف (`powerSaveState` · `brightnessLock` · `batteryWindowPct`، fv71) — 2026-10-18 +03

> **الصفّ:** `S-P6-13 server day 7.25-7.75 | 9-10 P6-13 توحيد الظروف (fv71) (PLAN-06:1052)` — **والصفّ في الملفّ اليوم عند `PLAN-06-DATA-COLLECTION.md:1054` لا `:1052` (انجرف سطرين؛ فُحص بـgrep)**. **المواصفة:** `docs/FV71_CONTRACT_SECTION.md` ف-05 (N71-06 وN71-07 وN71-08) والخطّة §١٢ (`:1419-1451`).
> **الأسماء [م] «اقتراحي» لم تُقرّ بعد** (القسم بنصّه): `batteryWindowPct` وحقول `brightnessLock` وقيم `state` و`method`. تُقرأ بوسمها. **والخادم لا يحمل 30 ولا 85** (القسم: «فلا يحمل الخادم نسخة من الرقمين»): النافذة تُعلَن في الحمولة والقارئ يقرأ ما أُعلِن.
> **حالة العيّنات (تحديث ٧.٧):** عيّنات المُنتِج الثلاث (NeuralChek@f9e0571) حلّت محلّ المبنيّتين من العقد؛ البند المعلّق «استبدال بعيّنة المُنتِج بعد A-P6-13» **أُنجز**.

| الموضع | ما يفعله |
|---|---|
| `fv68Reader.js` `readScanConditions` (قسم أعلى المخرَج `scanConditions`) | حالة القسم بحسب الختم: `NOT_IN_FIELDS_VERSION` (< 71) · `UNDETERMINED_NO_FIELDS_VERSION` (بلا ختم) · `READ` (≥ 71)؛ كل مفتاح بقيمته وحالته `<مفتاح>Status` |
| `powerSaveState` (الترويسة والجذر) | `off` · `on` · `read_failed` (وغيرها `UNRECOGNIZED_STATE`)؛ والمنطقيّان القديمان يُقرآن دائماً ويُحكم علاقتهما: `on` ⟸ `true`، `off` ⟸ `false`، **`read_failed` ⟸ غائب (لا `false`)** — **غيابهما مع `read_failed` حالة `ABSENT_DECLARED`** (تشرحه حالة شقيقة حاضرة، تعريف `KEY_STATUS`)، ومع `off`/`on` شذوذ `POWER_SAVE_BOOLEAN_ABSENT_FOR_STATE`؛ واختلاف الموضعين شذوذ؛ وأساس الحالة `LEGACY_BOOLEAN_ONLY` (< 71: فشل القراءة يُكتب `false` فلا يتميّز) أو `STATE_DECLARED` |
| `brightnessLock` (التذييل) | `{state, value, method}`: `state` ∈ `applied` · `apply_failed:<نصّ>` · `not_attempted:<سبب>`؛ `value` في [0، 1]؛ `method` ∈ `window_attribute` · `system_setting`؛ **`value` و`method` غائبان مع `not_attempted` حالة معلنة بلا صفر** (`ABSENT_DECLARED`) وحضورهما شذوذ؛ وغيابهما مع `applied` شذوذ؛ مفتاح مجهول شذوذ |
| `batteryWindowPct` (التذييل) | `{minPct, maxPct}` أعدادٌ في [0، 100] و`minPct ≤ maxPct`؛ **أساس النافذة** `DECLARED_IN_PAYLOAD` (مُعلَنة) أو `LEGACY_FIXED_MIN_NO_MAX` (< 71: 25 ولا حدّ أعلى، القسم) أو `NO_VALID_WINDOW` (بلا ختم وبلا نافذة معلَنة: لا يُفترض 25 ولا 30–85) |
| `batteryLevelStart` مقابل النافذة | `startLevelVsWindow` ∈ `WITHIN` · `BELOW_MIN` · `ABOVE_MAX` · `START_LEVEL_UNKNOWN` (غائب أو `-1`) · `START_LEVEL_INVALID` · `NO_WINDOW` — **وصف بلا حكم** (القسم: سلوك التطبيق خارج النافذة غير محسوم). والحدود بالمساواة مُختبَرة |
| ختم < 71 وحضور المفاتيح الثلاثة | `SCAN_CONDITIONS_KEYS_PRESENT_BEFORE_FV71` (القاعدة 25) ويُسرد في `unexpectedKeys`؛ **والقيمة `null` لا تُحسب حضوراً** |

**قرارات اتّخذتُها (القاعدة 45: سطر لكل قرار):**
1. **غياب المنطقيّين مع `read_failed` ⟵ `ABSENT_DECLARED` لا `ABSENT`:** هذا تعريف `KEY_STATUS.ABSENT_DECLARED` في `fv68Names.js` («غاب وتشرح غيابَه حالةٌ شقيقة حاضرة»)، وهو ما فعلتُه في أزرار الصوت (M-10) و`brightnessLock`. (كتبتُه أوّلاً `ABSENT` ثم صحّحتُه في الالتزام نفسه واستبدلتُ الاختبار الذي كان يثبّت `ABSENT` — القاعدة 23.) وتحت ختم < 71 يبقى `ABSENT` لأن السبب المُعلَن عقدُ ≥ 71 وحده.
2. **النافذة لا تُثبَّت في الخادم** — يقرؤها من الحمولة (القاعدة 24؛ القسم)، ولا حكم من الخادم على «تحت 30».
3. **حمولات fv71 الأربع السابقة (M-02 وأزرار الصوت) أُعيد توليدها بمفاتيح P6-13 الثلاثة بقيم سليمة** (المتغيّر `offAppliedWithin`): حمولة fv71 بلا هذه المفاتيح شذوذ يعلنه القارئ (القاعدة 39: الفخّ يتبع العقد). (تحديث ٧.٧: لم يعد لها لزوم — الحمولات الثلاث من المُنتِج تحمل المفاتيح الثلاثة معاً، ويحرس ذلك `fv71ProducerSamples.test.js` الكتلة «أ».)
4. **حقول P6-13 لا تصل النموذج** — لا قرار منها في هذا البند؛ فحصٌ في e2e بسطوحه الثلاثة (حمولة النموذج وردّ التطبيق ومستند التقرير المقروء).

**معلّق (لا تخمين):** **وسم «البداية الساخنة» `hotStart`** (الخطّة §١٢-ب `:1439-1442`: «يحسبها الخادم في الحساب اليومي… `hotStart: {state, dayMedian, delta, ruleVersion}`») — حساب يومي عبر فحوص، لا مُدخل له في القسم المنسوخ، ويعتمد الخلاصة اليومية (P6-15 ⛔) فلم أبنِه؛ سلوك التطبيق خارج النافذة 30–85% ونصّه (القرار ٩٠؛ القسم: «غير محسوم»)؛ نصّ `read_failed` الذي يراه المستخدم (القسم: «غير موجود ولا أنشئه»)؛ إقرار الأسماء [م] (N71-06/07/08)؛ ما يُفعل بالمستوى المجهول (البوّابة متسامحة).
**فحص الطفرات (`readScanConditions`، 54 طفرة نصّية، كلٌّ في نسخة تُستعاد في `finally`):** نجا أربع؛ اثنتان قُوّي لهما الاختبار فقُتلتا (حضور مفتاح جديد بقيمة `null` تحت 71، وحضور `read_failed` مبكّراً بلا المنطقيّ)، واثنتان **مكافئتان بالبناء** لا يُقتلان: (١) شرط `since` في شذوذ `POWER_SAVE_STATE_ABSENT` (غير قابل للبلوغ: `newCell` يحوّل الغياب تحت 71 إلى `NOT_IN_FIELDS_VERSION` قبله)، و(٢) `maxPct: 100` بدل `null` في النافذة القديمة (لا أثر في المخرَج: مستوى فوق 100 يُحكم `START_LEVEL_INVALID` قبل الوصول إلى المقارنة).
**من الاختبار:** `test/fv71ScanConditionsReader.test.js` (القيم المعدَّدة كلّها بالقاعدة 30: مصفوفة `powerSaveState` × الموضعان × المنطقيّ، و`brightnessLock` بكل حالاته وطرقه، والنافذة، والحدود بالمساواة، والمسار الكامل على العيّنتين) · القراءات الذهبية في `test/fv68ReadingsGolden.test.js` · `test/fv71ProducerSamples.test.js` · `test/analyzeDeviceFv71ProducerSamples.e2e.test.js` (المسار الكامل على المحاكي؛ تحديث ٧.٧: حلّا محلّ المحذوفين).

### ٧.٧ — مزامنة fv71 مع المُنتِج: عقد NeuralChek@f9e0571 وحمولاته الثلاث — 2026-10-18 +03 (أمر الباك اند ٢ البند ٠؛ القاعدتان 7 و41)

> **الأمر:** `evidence/run-2026-10-18/order-backend-engineer-2-sync-p6.md` (في مساحة العمل، منقول بمساره). **العقد:** نسخة القسم صارت f9e0571 (215 سطراً؛ sha256 `e8330a5f…c913`؛ 13 قطعة فرق مسرودة في `docs/FV71_CONTRACT_SECTION.SOURCE.txt`؛ التزام 123fbd3) — **وسوم الاعتماد** (E18–E22 والأسماء N71-01..08 معتمدة 2026-10-15) **وM-02 «يعمل» بلا فتح بعد 5f90ce1 وملاحظات تنفيذ المُنتِج**. **العيّنات:** ستّ ملفّات نسخ حرفية بـsha256 في `test/fv68AppPayloadGoldenCopy.test.js` وقسم README المجلّد الذهبي، والعيّنات الست المبنيّة من العقد **حُذفت** (القاعدة 23) مع مولّداتها واختباراتها.

**ما تغيّر في القرّاء حيث خالف المُنتِجُ افتراضاً وأيّده القسم** (الجدول الكامل — 13 صفّاً، بالافتراض والمُنتِج والفعل — في `test/fixtures/golden/README.md` قسم «الفروق…»):
| التعديل | الموضع | الاختبار |
|---|---|---|
| مفاتيح الكثافة الخمسة ALWAYS (كانت REASONED) | `fv68Names.TOUCH_PATH_FIELD_SPEC` | `fv71TouchGridReader` «أ» (جدول اليد) و«د» |
| عناصر `densityCheck` الخمسة [ق] + شذوذ المجهول + علاقة «[] ما لم يُستعمل DENSITY_DPI_FALLBACK» | `fv68Names.TOUCH_PATH_DENSITY_CHECK_CONDITIONS` · `readTouchPath` | «هـ» |
| `resampledFlagState` قيمتان [ق، معلّق] + شذوذ المجهول | `TOUCH_PATH_RESAMPLED_FLAG_STATE` · VOCAB | «هـ» |
| `unbufferedDispatch = false` شذوذ (القسم: true أو غائب بسببه) | `readTouchPath` | «هـ» |
| `pathCap`: أُزيل `TOUCH_PATH_CAP_INCONSISTENT` (عيّنة غير منتهية تُعدّ في pointsDropped مع reached=false)؛ أُضيف `TOUCH_PATH_CAP_REACHED_POINTS_MISMATCH`؛ و`TOUCH_PATH_POINTS_EXCEED_CAP` عند ≥ | `readTouchPath` | «ز» (استُبدل اختبار التناقض القديم: القاعدة 23) |
| عدّادا الصوت = عدّ مستقلّ من `events[]` حين القائمة كاملة؛ ومفتاح خارج `24 · 25 · 164` شذوذ | `readVolumeButton` · `readVolumeEvents` · `VOLUME_BUTTON_EVENT_KEY_CODES` | `fv71VolumeButtonReader` «ح» |
| نصوص `conventions` و`CANCEL_FLAGGED_AS_CANCEL` تحدّثت | `touchPath.js` · `fv68Names` | القراءات الذهبية (أُعيد توليدها: القاعدة 39) |

**فحص الطفرات:** 15 طفرة على فروع الحكم أعلاه، قُتلت كلّها (`survived=0`)؛ الملفّات سُلّمت بلا بقايا (md5 قبل/بعد مطابق).

**ما أجابه المُنتِج من أسئلة تقريري السابق (ج)** (مصدره قسم f9e0571، لا افتراضي): أسماء `densityCheck` (خمسة [ق]) · قيم `resampledFlagState` (قيمتان [ق، معلّق]) · اصطلاح الخلية (تؤيّده العيّنات) · سقف النقاط (15,000، معتمد E18) · معنى العدّادين (ضغطات down بـrepeat=0) · موضع `batteryWindowPct` (التذييل، عيّنات) · المنطقيّان الغائبان عند `read_failed` (غائبان، عيّنة 16ch) · المفاتيح الثلاثة معاً (حاضرة معاً، عيّنات) · `cancel_flagged` (= `FLAG_CANCELED`).
**ما بقي بلا جواب ويبقى معلّقاً:** أيّ الاختبارين رفع الصوت (العيّنات: M-09 ⟵ 24 وM-10 ⟵ 25 في الثلاث والقسم صامت) · نوع `flags` (لا عيّنة تحمله) · دلالة `resampledFlagState` · قاعدة المُنتِج لـ`edge_exit` (الهامش والاتجاه: في 13ch علامتان عرضهما المُنتِج ولم يكشفهما الخادم) · ما يضعه التطبيق 71 في `powerSaveState` جذر البصمة حين يعيد تحليل ملفّ بختم < 71 (القارئ يعدّ حضوره شذوذاً قبل 71) · نصوص E21 الستّة وسؤال «لا يفتح» على M-09/M-10 (قرار المستخدم) · إقرار [ق] (أسماء densityCheck وresampledFlagState).
**ما لا تغطّيه العيّنات** (يُغطّى باختبارات وحدة بحمولات معدَّلة): قائمة مكتوبة في README المجلّد الذهبي وفي بصمة التغطية `fv71ProducerSamples.test.js` «هـ».

### ٧.٨ — M-02 «إطار + X»: المجموعة المطلوبة جزء من الشبكة — 2026-10-21 +03 (أمر الباك اند ٤؛ أساس `fd730ac`)

> **العقد الحاكم:** `docs/FV71_CONTRACT_SECTION.md`، الحاشية «تحديث 2026-10-21 (أمر وكيل التطبيق ٨)» (عقد السلك الواحد، البنود 1–8، منقول فيها بحرفه من NeuralChek@4c0102c)؛ والنسخة صارت 4c0102c (`docs/FV71_CONTRACT_SECTION.SOURCE.txt`). **العيّنات:** `test/fixtures/golden/fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-*` استُبدلت بايتاتها بتوليد المُنتِج الحقيقي (4c0102c)، ونسختان من السابقة باقيتان بأسماء `fv71-before-m02-frame-x-*` دليلَ ما يرسله بناء ≤ 324578f (golden/README.md: القسم الأخير).

**التشخيص (القاعدة 6) — كل موضع يقرأ حقول M-02 الشبكية، مقروءاً عند `fd730ac` (`git grep -n "gridCols\|totalCells\|touchedCells\|untouchedCells\|cutoutCells" -- functions/src functions/scripts`):**

| الموضع (عند fd730ac) | ما يقرؤه | هل يفترض أن كل خلية غير مقصوصة مطلوبة؟ | الفعل |
|---|---|---|---|
| `fv68Reader.js:1198-1258` `readTouchGrid` | `gridCols` `gridRows` `totalCells` `touchedCells` أعداداً صحيحة | لا (يقرأ الأعداد وحالتها فقط) | بلا تغيير في الأعداد؛ يستدعي `readTouchPath` |
| `fv68Reader.js:1616-1620` | علاقة `totalCells = cols×rows − عدد cutoutCells` ⟵ `TOUCH_GRID_TOTAL_CELLS_RELATION_BROKEN` | **نعم** | **تغيّرت:** المطلوب = الشبكة − cutoutCells − notRequiredCells؛ الاسم القديم يبقى لـNOT_DECLARED، والجديد `TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN` لـDECLARED |
| `fv68Reader.js:1621-1630` | `touched + عدد untouchedCells = total` · `auto_complete` ⟹ `untouched = ∅` و`touched = total` | لا (علاقات بين أعداد المجموعة نفسها، وصحيحة للمطلوبة) | بلا تغيير |
| `fv68Reader.js:1497` | مفاتيح معروفة (غيرها شذوذ `TOUCH_GRID_UNKNOWN_KEY`) | — | أُضيف المفتاحان (وإلا صارا «مفتاحاً مجهولاً» في كل تقرير جديد) |
| `fv68Reader.js:1600-1613` `cleanIndexes` | فهارس `untouchedCells` و`cutoutCells` | لا | تشمل الآن `notRequiredCells` بالرمز القائم `TOUCH_GRID_CELL_INDEX_INVALID` |
| `touchPath.js:298-300` `recomputeCells` | تغطية الخلايا من المسار | **نعم** (`mandatory = كل الخلايا − cutout`) | **تغيّرت:** `− notRequired`؛ `notRequired` مُدخل صريح (غيابه `UNDETERMINED_REQUIRED_SET_UNKNOWN` لا `[]` افتراضية) |
| `fv68Names.js:526-527` `MODEL_HIDDEN_RAW_MEASUREMENT_KEYS` | مفاتيح M-02 المخفيّة عن النموذج | — | أُضيف المفتاحان (قائمة فهارس لا يُبنى عليها حرف؛ والثمانية القديمة تصل كما كانت) |
| `scripts/lib/deviceCheck03After.js:1112-1115` `checkM02` | `touchedCells` مقابل `totalCells` (FULL: مساويان، PARTIAL: أقلّ) | لا: يقارن العدّين وكلاهما للمجموعة نفسها | **بلا تغيير** (صحيح بالعقد الجديد: كلاهما للمطلوبة) — يثبّته `fv71M02FrameXReader.test.js` الكتلة «ز» على العيّنات الجديدة |
| `findings.js` · `signatures/*` · `categoryStates.js` · `analyzeDevice` · `sessionCompletion` | — | لا يقرؤون حقول M-02 الشبكية (`git grep` ⟵ لا نتيجة) | لا شيء |

**ما يفعله القارئ الآن (ختم ≥ 71)، كتلة `touchGrid.path`:** `gridPattern` و`notRequiredCells` بقيمتهما وحالتهما (`<مفتاح>Status`) و**`gridPatternState`** ∈ `DECLARED` · `NOT_DECLARED` (غيابهما معاً: **ليس شذوذاً**، العلاقتان القديمتان) · `INVALID_VALUE` · `WRONG_TYPE` · `ONE_KEY_ABSENT` (أحدهما غائب: شذوذ)؛ و**`requiredCellsBasis`** ∈ `NOT_REQUIRED_CELLS_DECLARED` · `ALL_NON_CUTOUT_PATTERN_NOT_DECLARED` · `UNDETERMINED_PATTERN_NOT_READABLE`. تحت ختم < 71: لا حالة جديدة (الكتلة `NOT_IN_FIELDS_VERSION` كما كانت)، وحضور المفتاحين شذوذ `TOUCH_GRID_PATTERN_KEYS_PRESENT_BEFORE_FV71` ويُسرد في `unexpectedKeys`. **مخرَج القراءات الذهبية السبع لما قبل fv71 لم يتغيّر بايتاً** (حكم المولّد «مطابق» لها قبل الكتابة).

**الأسماء الجديدة (مصدر واحد `fv68Names.js`، القاعدة 24)** — الشذوذ: `TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN` · `TOUCH_GRID_CUTOUT_NOT_REQUIRED_OVERLAP` · `TOUCH_GRID_UNTOUCHED_CELL_NOT_REQUIRED` · `TOUCH_GRID_PATTERN_FRAME_CELL_NOT_REQUIRED` · `TOUCH_GRID_PATTERN_ALL_CELLS_WITH_NOT_REQUIRED` · `TOUCH_GRID_PATTERN_VALUE_INVALID` · `TOUCH_GRID_PATTERN_KEYS_INCOMPLETE` · `TOUCH_GRID_PATTERN_KEYS_PRESENT_BEFORE_FV71`؛ والحالات `gridPatternState` الخمس و`requiredCellsBasis` الثلاث وحالة `cells.state` الجديدة `UNDETERMINED_REQUIRED_SET_UNKNOWN`، والحقلان الجديدان في `cells`: `notRequiredCells` (العدد) و`pathTouchedNotRequiredCount`.

**قرارات اتّخذتُها (القاعدة 45: سطر لكل قرار):**
1. **المفتاحان خارج `TOUCH_PATH_FIELD_SPEC`**: حضور ALWAYS كان سيجعل غيابهما (البند 7) شذوذاً؛ فلهما قراءة مستقلّة `readGridPatternKeys`.
2. **تحت NOT_DECLARED تبقى أسماء العلاقتين القديمتين وتفاصيلهما بلا تغيير** (لا شذوذ جديد على تقرير قديم)؛ وحمولة «إطار + X» جُرِّد منها المفتاحان تُعلن العلاقة القديمة مكسورة (106 ≠ 286) — لا تأويل صامت.
3. **أسماء جديدة لعلاقات المطلوب تحت DECLARED** (الأمر: «أسماء جديدة في fv68Names.js»)؛ فهرس خارج الشبكة في `notRequiredCells` يستعمل الرمز القائم `TOUCH_GRID_CELL_INDEX_INVALID` بالمفتاح في التفصيل (لا اسم ثانٍ لدلالة واحدة).
4. **حدّ الإطار الأدنى يُفرَض تحت `FRAME_AND_DIAGONALS` وحدها** (التعريف في العقد تحت ذلك النمط)؛ نمط مجهول لا حدّ له؛ و`ALL_CELLS` تُفحص قائمتها الفارغة (`…ALL_CELLS_WITH_NOT_REQUIRED`). **لا هندسة قطرين في الخادم** (القاعدة 24).
5. **`INVALID_VALUE` وقائمة سليمة**: العلاقة 2 لا تتوقّف على قيمة النمط فتُفحص؛ و`WRONG_TYPE`/`ONE_KEY_ABSENT` لا مجموعة مطلوبة فلا علاقة تُحسب (القاعدة 22: لا `[]` افتراضية).
6. **العلاقة 4 (untouched بلا مقصاة ولا غير مطلوبة) تُفحص تحت DECLARED وحدها**: لم تُفحص قبل على التقارير القديمة فلا شذوذ جديد عليها.
7. **لمسة المسار في خلية غير مطلوبة تُعدّ بجانبها** (`pathTouchedNotRequiredCount`) ولا تدخل `touchedCount` (العلاقة 3، والخامّ لا يُمسّ).

**ما لم يُصلَح (قيد معروف):** `touchPath.js:recomputeCells` ما زال يقرأ `reported.cutout || []` (غياب `cutoutCells` يُحسب «لا مقصاة» عند مقارنة الخلايا؛ يُعلَن غيابه شذوذاً مستقلّاً `TOUCH_PATH_REQUIRED_KEY_ABSENT`) — سابق لهذا الأمر وخارجه.

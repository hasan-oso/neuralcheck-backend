# تصميم: نقل البيانات الخامّة (`rawFingerprint`) من مستند التقرير المقروء إلى موضع لا يقرؤه العميل

**وثيقة تصميم بلا كود — للاعتماد.** المستودع: `neuralcheck-backend` · الأساس: `6a26163` · 2026-10-09 +03 · الكاتب: وكيل الباك اند.

> **ما لم يُلمَس:** لا `functions/src`، ولا `firestore.rules`، ولا `storage.rules`، ولا `firestore.indexes.json`، ولا اختبار. نصوص القواعد أدناه **مقترحة**، لم تُكتب في الملفّ. **ولا نشر ولا رفع.**
> **ما لا أراه:** مستودعا التطبيق والموقع. كل ما يخصّهما هنا **منقول** من ثلاثة ملفّات للمنسّق (`rawfingerprint-browser-exposure-2026-10-08.md` و`report-raw-readers-inventory-2026-10-08.txt` و`scout-client-reads-of-reports-2026-10-09.md`، ويُرمَز للأخير «س:N» = سطر N منه) وموسوم «منقول، غير متحقَّق» (القاعدة 29).
> **ما يُعاد ولا يُحسم:** تعارض نصّ القرار بين «لا يقرؤه إلا الخادم» و«المالك والخادم يقرآنه» — §٤، وأسئلة المستخدم §١١ (القاعدة 13).

---

## ٠ · الملخّص

1. **الحال:** كاتب واحد لمستند التقرير في الإنتاج (`analyzeDevice.js:693`)، يكتب `rawFingerprint` (`:274`، بعد حذف `timeSeries.samples` فقط، `lightenFingerprintForStorage.js:7-15`) والحقول الجذرية `deviceFingerprintSha` و`timeSeriesStoragePath` و`sessionId` و`userId` (`:264-292`) **في المستند نفسه الذي تقرؤه القواعد** — `firestore.rules:59-66`: المالك، **وأيّ مصادَق** لتقرير `listingStatus ∈ {for_sale, sold}`.
2. **المقترح:** مجموعة مستقلّة `reportRaw/{scanId}` (الاسم قابل للتغيير)، بمعرّف التقرير نفسه، تُكتب مع مستند التقرير في **كتابة دفعة واحدة ذرّية**، بلا قاعدة قراءة للعميل أصلاً (خيار ب) أو بقاعدة مالك (خيار أ — قرار المستخدم). سابقتان في المستودع نفسه: `aiRawResponses/{scanId}` (`writeRawAiResponses.js:28`، بقرار المستخدم 2026-09-23 «مجموعة منفصلة») و`serverSamples/{scanId}.json.gz` في Storage (`serverRawSamplesStorage.js`).
3. **ما يُنقل:** `rawFingerprint` + الجذور الأربعة. `userId` **يبقى** بنصّ القرار 2026-10-09.
4. **ما يغيّر أكثر مما يبدو:** (أ) `resolvePendingEvaluation` مشغّل `onDocumentCreated` يقرأ **`event.data` للتقرير** ويستخرج منه الربط بالخامّ (`evaluationContract.js:110-129`) — بعد النقل لن يجده في المستند، فالنقل يمسّ **ثلاث دوالّ منشورة** (مشتقّة بالأداة: `analyzeDevice` و`submitEvaluation` و`resolvePendingEvaluation`، 3 من 18). (ب) ثمانية تقارير ذهبية (V6 وستّة V7 + عيّنة `functionalResults`) تحمل `rawFingerprint` فتتغيّر مع العقد (القاعدة 39). (ج) `firestore.rules:65-66` **لا يمكن تضييقها بالحقول** — القواعد لا تُرشّح حقولاً — فإمّا تضييق القراءة كلّها أو مستند إسقاط عامّ (§٥).
5. **ثلاثة أشياء وجدتُها في الكود لم يذكرها الأمر** (§٤-٣، §٥-١، §١١-٤): نطاق «لا يحمل إلا ما يعرضه» يشمل `aiAudit` وغيره؛ قاعدة المشرف الشاملة `:26-28` تقرأ أيّ مسار جديد في Firestore مهما كان الخيار؛ والتطبيق يسجّل دخولاً **مجهولاً** على أجهزة الزبائن فيصير «أيّ مصادَق» أوسع ممّا قاله ملفّ الفحص.
6. **من جرد الكشّاف (منقول، غير متحقَّق، §٢):** لا عميل يقرأ `rawFingerprint` ولا الجذور الثلاثة بالاسم، فالنقل لا يكسر قارئاً؛ لكن **كل قارئ مباشر ينسخ المستند كاملاً** (خمسة مواضع في الموقع وأربعة في التطبيق)، وصفحة الإدارة الرئيسية **تحفظ عشرة مستندات كاملة في `sessionStorage` خمس دقائق**، وصفحة تقارير الإدارة تعرض المستند JSON كاملاً. فالخامّ يصل اليوم إلى ذاكرة كل عميل وإلى تخزين متصفّح المشرف دون أن يقرأه أحد.
7. **الكلفة (تقدير، غير مقيس):** 7 إلى 11 يوماً للباك اند وحده بلا خيار (ن٢/ن٤) — §١٠. وللأسئلة المفتوحة §١١.

---

## ١ · الحال عند `6a26163` — بالملفّ والسطر

### ١-١ · كاتبو مستند التقرير

| الكاتب | الملفّ والسطر | ما يكتبه |
|---|---|---|
| **الوحيد في الإنتاج** | `functions/src/analysis/analyzeDevice.js:693` (`await reportRef.set(reportDocument)`؛ `reportRef` من `:395`؛ `createdAt` يُستبدَل بوقت الخادم في `:692`) | المستند كلّه، بُني بـ`buildReportDocument(p)` (`:262-327`)، دالّة نقيّة مُصدَّرة |
| المالك من العميل | `firestore.rules:69-72` | `price` و`currency` و`sellerNote` و`listingStatus` وحدها (`hasOnly`) — فلا يستطيع كتابة الخامّ |
| سكربت لمرّة واحدة | `functions/scripts/regenerate-report.js:96` (`reports/${SCAN_ID}`، `PATCH` بـ`updateMask`) | حقول التحليل؛ `PROTECTED` (`:83-85`) يمنعه من لمس `userId` و`sessionId` و`deviceFingerprintSha` و`timeSeriesStoragePath` و`rawFingerprint` |

> **لا كاتب آخر في `functions/src`:** `git grep -n 'collection("reports")' -- src index.js` يعطي موضعاً واحداً للكتابة (`analyzeDevice.js:395`) وثلاثة مواضع قراءة (§١-٣).

### ١-٢ · جذور المستند التي يكتبها الخادم — 25 مفتاحاً (V7)، وقرّاؤها في الخادم

العدد 25 من `Object.keys` على `functions/test/fixtures/golden/v7-reports-document-sample.json` (مولَّد بـ`buildReportDocument` الحقيقية). V6 يضيف `grade` و`score` (`analyzeDevice.js:288-290`، شرط `pipeline`). **حكم «ينتقل؟» في العمود الأخير مبنيّ على جرد قرّاء العميل (§٢-٢).** قرّاء الخادم من بحث بنمط `(report|reportData|rep|existingData|existing|cur|reportDoc|reportDocument)?\.<key>` في `functions/src` (أسطر الشيفرة وحدها) — **نمط محدّد، لا يلتقط القراءة بتفكيك** (`const {x} = report`)؛ وقد راجعتُ يدوياً الأمكنة المذكورة.

| المفتاح | سطر الكتابة | قرّاء الخادم (`ملفّ:سطر`) | ينتقل؟ |
|---|---|---|---|
| `userId` | `:264` | `submitEvaluation.js:261` · `resolvePendingEvaluation.js:54,55,57` · `generateReportPdf.js:113` | **يبقى** (قرار 2026-10-09) |
| `deviceFingerprint` (نصّ موديل الجهاز لا البصمة، `:265`) | `:265` | لا قارئ | سؤال §١١-٤ |
| `deviceModel` | `:266` | `evaluationContract.js:118` · `verifyReport.js:309,310,376,377` | يبقى (يقرؤه عميل) |
| `deviceMarketingName` | `:267` | `verifyReport.js:310,377` | يبقى (يقرؤه عميل) |
| **`deviceFingerprintSha`** | `:270` | `evaluationContract.js:117` | **ينتقل** |
| **`timeSeriesStoragePath`** | `:271` | `rehydrateReportSamples.js:131` · `evaluationContract.js:116` | **ينتقل** |
| `fieldsVersion` | `:272` | `evaluationContract.js:126` | سؤال §١١-٤ |
| `appVersion` | `:273` | `evaluationContract.js:127` | سؤال §١١-٤ |
| **`rawFingerprint`** | `:274` | `rehydrateReportSamples.js:139` · `evaluationContract.js:110` | **ينتقل** |
| `aiResponse` | `:275` | `analyzeDevice.js:404,405` · `evaluationContract.js:113` · `verifyReport.js:272,371` | يبقى (هو المعروض) |
| `aiAudit` | `:280` | لا قارئ (`verifyReport.js` لا يقرؤه، مُثبَت بـ`verifyReportAuditExclusion.test.js`) | **سؤال §١١-٤ — مهمّ** |
| `aiModel` · `aiDurationMs` · `aiFallbackReason` | `:281-283` | `evaluationContract.js:128` (`aiModel`) فقط | `aiModel` يبقى (Gson في التطبيق، §٢-٢)؛ الاثنان الآخران سؤال §١١-٤ |
| `language` · `shortId` · `isFreeTrial` · `pipeline` | `:291,293,295,297` | `generateReportPdf.js:120,128,129` · `verifyReport.js:221,234,304,308,312,313,375,381,382` · `evaluationContract.js:129,137,142,147` | يبقى (يقرؤها عميل، §٢-٢) |
| **`sessionId`** | `:292` | لا قارئ بالنمط؛ يقرؤه استعلام `count-qr-session-timeseries-storage-readonly.js:129` | **ينتقل** |
| `scoringEngine` · `v5Metrics` · `analyzedAt` | `:294,298,311` | لا قارئ | `analyzedAt` يبقى (يقرؤه التطبيق، §٢-٢)؛ الآخران سؤال §١١-٤ |
| `serverSamplesStoragePath` · `serverSamplesSaved` | `:322,323` | لا قارئ (`V7_DISPLAY_SHAPE_CONTRACT.md:761`) | سؤال §١١-٤ (مؤشّرا Storage) |
| `createdAt` | `:324` ثم `:692` | `verifyReport.js:311,380` | يبقى (يقرؤه عميل) |
| `grade` · `score` (V6) | شرطيّان (`:288-290`) | `evaluationContract.js:139,140,144,145` · `verifyReport.js:378,379,393,394` | يبقى (بوّابات العميل، §٢-٢) |
| `price` · `currency` · `sellerNote` · `listingStatus` | **المالك** (`rules:72`) | لا قارئ خادمي؛ `listingStatus` في `rules:66` وفهرس `firestore.indexes.json:14-18` | يبقى |

### ١-٣ · كل قارئ في الخادم لمستند التقرير — ومن يقرؤه كاملاً ويمرّره

أربع قراءات بالنمط `collection("reports")` في `functions/src` (`analyzeDevice` و`submitEvaluation` و`generateReportPdf` و`verifyReport`)، **ومعها مشغّل Firestore** `resolvePendingEvaluation` يتلقّى المستند في حمولة الحدث:

| القارئ | الموضع | يقرأ المستند كاملاً؟ | ماذا يمرّر / يُخرج | أثر النقل |
|---|---|---|---|---|
| `analyzeDevice` (فرع التكافؤ) | `analyzeDevice.js:395-410` | `existingReport.data()` | يُرجع `aiResponse` وحده (V7 بلا `narrative.details/verdict`) | **لا أثر** |
| `submitEvaluation` | `submitEvaluation.js:255-261` | `reportSnap.data()` | يمرّره كلّه إلى `buildReportSnapshot(report)` (`:265`) فيُنسخ إلى `evaluations/{scanId}`: `timeSeriesStoragePath` و`deviceFingerprintSha` و`deviceModel` و`androidVersion` و`apiLevel` و`fieldsVersion` و`appVersion` و`aiModel` و`pipeline` والدرجات (`evaluationContract.js:90-150`)؛ و`sessionId` يُكتب من الجلسة لا من التقرير (`submitEvaluation.js:295`) | **يتأثّر**: الربط بالخامّ يصير قراءة ثانية |
| `resolvePendingEvaluation` | `resolvePendingEvaluation.js:26-33,54-57` | `event.data?.data()` — **حمولة المشغّل نفسها** | يمرّره كلّه إلى `buildReportSnapshot(report)` (`:67`) | **يتأثّر أشدّ**: المستند في الحدث لن يحمل الخامّ؛ فيحتاج قراءة، ويجب أن يكون الخامّ مكتوباً **قبل** أن يُطلَق المشغّل (§٣-٤) |
| `generateReportPdf` | `generateReportPdf.js:106-129` | `reportDoc.data()` | يقرأ `userId` و`isFreeTrial` و`shortId` و`language` فقط | **لا أثر** |
| `verifyReport` | `verifyReport.js:142-182` | `reportDoc.data()` | **لا يمرّر المستند**: `buildV7Response` (`:271`) و`buildV6Response` (`:370`) كائنان حرفيان بمفاتيح معدودة؛ لا `rawFingerprint` ولا الجذور الأربعة فيهما. حارسه `verifyReportV7Whitelist.test.js` (87 تأكيداً في تشغيل هذه الجلسة) | **لا أثر** (والاختبار يبقى حارساً) |

> **«A23» (من نصّ الأمر):** لا أجده في مستودعي (السجلّ خارج حدودي). ما وجدتُه بالكود هو الجدول أعلاه: لا قارئ خادمي يمرّر المستند كاملاً إلى العميل. إن كان A23 يخصّ شيئاً آخر فأرجو المصدر (القاعدة 27).

### ١-٤ · قرّاء `rawFingerprint` الباقون في `src` — ليسوا قراءة لمستند مخزون

(من ملحق الجرد؛ ملفّاً وسطراً.) **لا نقل يمسّها**:

- `runConsistencyTest.js:272,281,282,320,446`: `data.rawFingerprint` من **طلب المستدعي** (مشرف)، لا من مستند.
- `callAI.js:209`: جسم طلب V6 يبنيه محلّياً (`rawFingerprintForAi`). `buildV7Payload.js:449`: `assertNoRawSamples` فحص دفاعي على الحمولة. `systemPromptV6.js:46-738`: **نصّ تعليمات** يسمّي الحقول.
- `lab/layer1/index.js:29` و`lab/layer3/utils/tier_lookup.js:61,64`: يقرآن بصمة **في الذاكرة** من `runLabPipeline.js:37` (`normalizeScanData(fingerprint)`).
- `rehydrateReportSamples.js:73,74,76,139`: **يقرأ مستند مخزون** — لكن رأس الملفّ يقول «غير مُستهلَك من أيّ مسار حيّ»، و`deploy-list.js` لا يجده في رسم تبعيات أيّ دالّة. يتأثّر ولا أثر إنتاجياً.

### ١-٥ · القواعد والفهارس الآن

- **`firestore.rules:26-28`: `match /{document=**} { allow read, write: if isAdmin(); }`** — تشمل كل مسار جديد. `isAdmin()` (`:5-12`) = `request.auth.token.email in [ثلاثة بريدات]` **بلا فحص `email_verified`**.
- `:59-73` التقارير: قراءة المالك (`:61-62`)، وقراءة **أيّ مصادَق** للمعروض (`:65-66`)، وتحديث المالك للحقول الأربعة (`:69-72`).
- `:88-92` `evaluations`: قراءة المالك (`ownerId`)، والكتابة مغلقة. **وفيها `timeSeriesStoragePath` و`deviceFingerprintSha` منسوخين** (§١-٣) — فالمالك يقرؤهما أصلاً.
- `storage.rules:19-22`: `scans/{fingerprint}/{file}` — كتابة لأيّ مصادَق، **القراءة `false`** (يقرؤه الخادم وحده). `:28-30` `reports/{scanId}/{file}` مغلق. **لا `match` لـ`serverSamples/**` فهو مرفوض افتراضياً** (`serverRawSamplesStorage.js` رأس الملفّ).
- **الفهارس** (`firestore.indexes.json`): `reports(userId ASC, createdAt DESC)` و`reports(userId ASC, listingStatus ASC, createdAt DESC)` و`fieldOverrides` لـ`shortId`. **لا فهرس على الخامّ.** غير المعلَن يُفهرَس تلقائياً بفهرس مفرد لكل ورقة، وكلفته غير مقيسة هنا.
- **اختبارات القواعد القائمة:** `rules-test/firestore.rules.test.js` (104 سطراً) يغطّي **`users`** وحدها — `git grep reports -- rules-test` لا يجد فيه شيئاً عن `reports`. (`scanSessions.rules.test.js` سابقة ملفّ لكل مجموعة.)

### ١-٦ · الأحجام — مقيسة اليوم على العيّنات الذهبية

بسكربت `node` لحظي في جلسة الكتابة (غير محفوظ في المستودع)، **حجم JSON مضغوط UTF-8** — **ليس حجم Firestore المحسوب** (أسماء الحقول + القيم + عبء) ولا مستنداً إنتاجياً. الحدّ الصلب للمستند 1 MiB = 1,048,576 بايتاً (وهو سبب `lightenFingerprintForStorage.js:2-5`).

| العيّنة | الحجم بالبايت |
|---|---|
| مستند V7 الذهبي كاملاً (6 عيّنات V7) | 14,323 إلى 57,516 |
| `rawFingerprint` داخلها | 6,707 إلى 19,788 (وعيّنة V6: 20,487) |
| `aiAudit` داخلها (V7) | 1,136 إلى 13,785 |
| حمولة التطبيق fv68 بعد `lighten` (3 عيّنات) | **17,571** و**18,930** و**40,983** |

أعلى قياس 40,983 = 3.9% من 1 MiB. **لا قياس إنتاجي** — حجم أكبر مستند حقيقي يعطيه التشغيل الجافّ للترحيل (§٧). النموّ بين fv67 (≈17.5K) وعيّنة fv68 ذات 16 قناة (≈41K) يُنبّه إلى أن الخامّ يكبر مع كل إضافة (`footer.batteryPairs`، `cpuPolicies`…).

### ١-٧ · سوابق «الخامّ حيث لا يقرؤه العميل» في المستودع

1. **`aiRawResponses/{scanId}`** (`writeRawAiResponses.js:28,75`): مجموعة منفصلة بمعرّف التقرير، **بلا `match` في القواعد**، فلا يقرؤها إلا `isAdmin()` بالقاعدة الشاملة. اختارها المستخدم بنصّه (رأس الملفّ، 2026-09-23، القرار ٤): «(أ) مجموعة منفصلة — والقواعد الحالية تمنع غير المشرف من قراءتها، فلا نشر لازم».
2. **`serverSamples/{scanId}.json.gz` في Storage** (`serverRawSamplesStorage.js`): مسار بلا `match` فمرفوض افتراضياً؛ ويكتب المستند حقلَي المؤشّر `serverSamplesStoragePath/serverSamplesSaved` (`analyzeDevice.js:322-323`).
3. **`scans/{fingerprint}/{scanId}.ts.json.gz`:** `read: false` صريح (`storage.rules:19-22`).

---

## ٢ · ما يحمله المستند المقروء

**المصدر:** جرد الكشّاف `scout-client-reads-of-reports-2026-10-09.md` (wepsite@`add0bfb`، NeuralChek@`738da89`) — **منقول، غير متحقَّق عندي** (القاعدة 29)، وتحقّق المنسّق من عيّنة منه (س:2-7). **«س:N» = السطر N من ذلك الملفّ.** حدوده بنصّه: لم يتحقّق الكشّاف من حالة الشجرة غير الملتزمة (س:15)، ولم يبحث في `scripts/` و`docs/` و`contract/` ولا في `ReportScreen.kt` و`ReportPdfGenerator.kt` (س:18)، ولم يتتبّع عرض كل حقل داخل شاشات التطبيق (س:184,204) — **فـ«يقرؤه» لا يساوي «يعرضه»**.

### ٢-١ · كيف يقرأ العميل المستند: **كاملاً**

**كل ادّعاء في الجدول منقول، غير متحقَّق، وسطره في عمود «المصدر».**

| الموضع | ما يفعله بالمستند | المصدر |
|---|---|---|
| الموقع: `shop/[slug]/ShopClient.js:127`، `dashboard/page.js:96`، `tech/page.js:103`، `admin/reports/page.js:116`، `admin/page.js:99` | `{id: d.id, ...d.data()}` — المستند كاملاً في حالة الصفحة | س:42,72,93,106,140,355 |
| الموقع: `admin/page.js:50-51,150,206,291` | **آخر عشرة مستندات كاملة في `sessionStorage`** (`nc_admin_stats_v1`) خمس دقائق | س:149,352 (وتحقّق المنسّق س:3-4) |
| الموقع: `admin/reports/page.js:110-114` | **كل** المستندات (بلا `where` وبلا `limit`) | س:106 |
| الموقع: `admin/reports/page.js:533` | `JSON.stringify(report, null, 2)` داخل `<details>` «البيانات الخام (JSON)» | س:137,351 |
| التطبيق: `FirebaseAnalysisService.kt:194` (`fetchExistingReport`) | يقرأ المستند بمعرّفه، ثم `flattenReportDocument` (`:651-659`) ثم **`gson.toJson(flat)`** للمستند كلّه (`:208`) | س:158-164,359 (وتحقّق المنسّق س:6) |
| التطبيق: `ViewModels.kt:216` و`:2230` | استعلام `userId == uid` ويقرأ `data` كاملاً | س:187-190,207-208 |
| التطبيق: `ViewModels.kt:1183` | `getString("shortId")` وحده | س:202 |

**ما يعنيه:** `rawFingerprint` والجذور الثلاثة (`sessionId` و`deviceFingerprintSha` و`timeSeriesStoragePath`) تصل اليوم **إلى ذاكرة كل عميل يقرأ تقريراً** — وإلى **`sessionStorage` المشرف** (عشرة مستندات) — **ولا يقرؤها أيّ عميل بالاسم**: لا ذكر لها في القائمة الموحّدة (س:233-301) ولا في حقول `AiAnalysisResponse` (س:175-179)، وتحقّق المنسّق أن `git grep rawFingerprint` في الموقع = 0 (س:7).

### ٢-٢ · كل جذر يكتبه الخادم: هل يقرؤه عميل؟

**كل خانة «الموقع» و«التطبيق» أدناه منقولة، غير متحقَّق، وسطرها في س: بجانبها.** عمودا «المفتاح» و«الحكم المقترح» من عندي.

الرمز: «منطق» = استعلام/فرع/بوّابة/نقل؛ «معروض» = يصل نصاً أو حرفاً؛ «Gson» = حقل في `AiAnalysisResponse` (س:175) يُفكَّك عند وجوده في الجذر، **وعرضه غير متتبَّع** (س:184).

| الجذر | الموقع | التطبيق | الحكم المقترح |
|---|---|---|---|
| `userId` | منطق: `where` في shop:120 وdashboard:91 وtech:84 (س:239) | منطق: `where` في VM:217 وVM:2231 (س:239) | **يبقى** (قرار 2026-10-09) |
| `aiResponse` | حاوية (س:265) | بوّابة `FBAS:579`، و`V7OverallSummaryReader:50` (س:265) | يبقى |
| `pipeline` | منطق (س:258) | منطق + بوّابة `FBAS:578` (س:258) | يبقى |
| `createdAt` | منطق + معروض (س:235) | `Timestamp` خام `FBAS:619-620`، VM:223-227،2238-2242 (س:235) | يبقى |
| `shortId` | معروض (س:248) | `getString` VM:1186 + Gson (س:248) | يبقى |
| `deviceModel` · `deviceMarketingName` | معروض (س:249,252) | معروض عبر VM:309،2125 وGson (س:249,252) | يبقى |
| `grade` · `score` (V6) | `grade` معروض؛ `score` معروض في `admin/reports:257-258,407-408` (س:256,257) | `grade` معروض + منطق؛ **`score` بوّابة `FBAS:583` (نوع `Number`)** (س:256,257) | يبقى — **جذور تعتمد عليها بوّابات القراءة، لا يمسّها النقل** |
| `price` · `currency` · `sellerNote` · `listingStatus` | معروضة، وتُكتب من `dashboard/page.js:117` (س:90,242-245,303) | لا (س:303) | يبقى |
| `language` · `aiModel` · `isFreeTrial` | لا | **Gson فقط** (س:268) | يبقى (Gson يفكّكها)، عرضها غير متتبَّع |
| `analyzedAt` | لا | Gson → VM:1148 (`analyzedAt ?: createdAtMs`) منطق (س:269) | يبقى |
| **`rawFingerprint`** | **لا** (س:7) | **لا** (س:175-179) | **ينتقل** — لا يكسر قارئاً بالاسم |
| **`deviceFingerprintSha`** · **`timeSeriesStoragePath`** · **`sessionId`** | **لا** (غائبة عن س:233-301) | **لا** (غائبة عن س:175-179) | **ينتقل** — كذلك |
| `deviceFingerprint` · `fieldsVersion` · `appVersion` | لا | لا | **سؤال §١١-٤** |
| `aiAudit` · `aiDurationMs` · `aiFallbackReason` · `scoringEngine` · `v5Metrics` | لا | لا | **سؤال §١١-٤** |
| `serverSamplesStoragePath` · `serverSamplesSaved` | لا | لا | **سؤال §١١-٤** |

**العدّ** (من الجدولين أعلاه، بالأسطر): من 25 جذراً (V7) + `grade`/`score` + حقول المالك الأربعة: **ينتقل بنصّ القرار** (BATCH3-CLOSE البند ١: `rawFingerprint` والثلاثة)، **ويبقى** `userId` ومجموعة ما يقرؤه عميل، و**لا قارئ عميل معروف لعشرة أخرى غير منصوص عليها** (`deviceFingerprint` · `fieldsVersion` · `appVersion` · `aiAudit` · `aiDurationMs` · `aiFallbackReason` · `scoringEngine` · `v5Metrics` · `serverSamplesStoragePath` · `serverSamplesSaved`). **«لا قارئ معروف» ≠ «لا قارئ»:** حدود الكشّاف أعلاه، والقرّاء الخادميون لبعضها (`fieldsVersion`/`appVersion`/`aiModel` في `evaluationContract.js:126-128`).

### ٢-٣ · ما يحمله المستند المقروء بعد النقل — **المقترح**

1. **بنصّ القرار:** يُسحب `rawFingerprint` والجذور الثلاثة (`sessionId` و`deviceFingerprintSha` و`timeSeriesStoragePath`)؛ **`userId` يبقى**.
2. **يبقى بالضرورة** (يقرؤه عميل، §٢-٢): `userId` · `aiResponse` · `pipeline` · `createdAt` · `shortId` · `deviceModel` · `deviceMarketingName` · `grade`/`score` (V6) · `price`/`currency`/`sellerNote`/`listingStatus` · وما يفكّكه Gson من الجذر (`language`/`aiModel`/`isFreeTrial`/`analyzedAt`).
3. **العشرة الباقية:** تُترك للمستخدم (§١١-٤) — لا أنقلها من عندي؛ **بالقاعدة نفسها «لا يحمل إلا ما يعرضه» كلّها مرشَّحة**، وأثقلها `aiAudit` (≈ 1.1 إلى 13.8 KB في العيّنات، §١-٦، «يُحفَظ ولا يُعرض» بالقرارين 4 و6 في `V7_DISPLAY_SHAPE_CONTRACT.md:450`).
4. **أثر جانبي مرجَّح، غير مقيس:** مستند أصغر (الخامّ ≈ 6.7 إلى 41 KB من 14 إلى 58 KB في العيّنات، §١-٦) يُنقل في كل قراءة: صفحة `admin/reports` تقرأ **كل** المستندات بلا حدّ (س:106)، وتخزين `sessionStorage` المشرف (س:149)، وكل `fetchExistingReport`.

---

## ٣ · أين يذهب الخامّ

### ٣-١ · ما الذي ينتقل
`rawFingerprint` كما يُخزَّن اليوم (بعد `lighten`: بلا `samples`، مع `samplesCount`) + `deviceFingerprintSha` + `timeSeriesStoragePath` + `sessionId`. **بلا أيّ تحويل** (القاعدة 20: «الخامّ يُخزَّن حيث لا يقرؤه العميل» — والإصلاح يُطبَّق على الخامّ لا مكانه). نقل حرفي.

### ٣-٢ · الخيارات الثلاثة

| | **م١: مستند فرعي** `reports/{scanId}/private/raw` | **م٢: مجموعة مستقلّة** `reportRaw/{scanId}` | **م٣: Storage** `reportRaw/{scanId}.json.gz` |
|---|---|---|---|
| الحدّ 1 MiB | نعم، للمستند الفرعي (حرّ من حجم التقرير) | نعم، للمستند (حرّ من حجم التقرير) | **لا حدّ** (حتى 5 TiB للكائن، غير متحقَّق هنا) |
| ذرّية الكتابة مع التقرير | **نعم** (دفعة Firestore واحدة) | **نعم** | **لا** — كتابتان مستقلّتان (سابقة `serverSamples`: فشلها لا يُفشل التحليل ويُكتب `saved:false`) |
| يراه مشغّل `resolvePendingEvaluation` عند إنشاء التقرير | نعم، إن كُتب في الدفعة نفسها | نعم، كذلك | **غير مضمون**، إلا بترتيب «الخامّ أولاً ثم التقرير» |
| من يقرؤه بالقواعد | الشاملة `:26-28` (مشرف) + ما أُضيف | الشاملة + ما أُضيف | **لا أحد بالقواعد** (`storage.rules` لا تحمل شاملة المشرف) |
| خيار (أ) المالك يقرأ | قاعدة على المستند الفرعي | قاعدة على المستند | **غير عملي** (قاعدة Storage تحتاج `firestore.get` عبر الخدمات) — فم٣ يناسب (ب) وحده |
| الاستعلام (`where`/`select`) | ممكن (`collectionGroup`) | **ممكن** (يعيد `count-qr…:129` استعلامه كما هو على المجموعة الجديدة) | **غير ممكن** |
| الفهرسة التلقائية لكل ورقة | تحدث؛ تُعالَج بإعفاء (٤-٦) | تحدث؛ تُعالَج بإعفاء (٤-٦) | لا فهرسة |
| دورة الحياة | حذف التقرير **لا** يحذف الفرعي | مستقلّة (كذلك لا حذف تلقائي) | مستقلّة |
| سابقة في المستودع | لا | **نعم** (`aiRawResponses`، بقرار المستخدم) | **نعم** (`serverSamples`) |

### ٣-٣ · معرّفه وارتباطه بالتقرير

- **المعرّف = `scanId`**: معرّف مستند التقرير نفسه (`analyzeDevice.js:395`: `.doc(scanId)`)، علاقة 1:1. فلا مؤشّر لازم على مستند التقرير — **وهذا مقصود:** إضافة حقل مؤشّر إلى المستند المقروء تناقض «لا يحمل إلا ما يعرضه». القارئ يحسب المسار من `scanId`.
- **حقول مستند الخامّ (مقترح):** `scanId` · `userId` (نسخة، **لازمة لخيار (أ) وحده** لأن القاعدة لا تقرأ مستنداً آخر بلا `get()` مدفوعة) · `rawFingerprint` · `deviceFingerprintSha` · `timeSeriesStoragePath` · `sessionId` · `createdAt` (وقت الخادم) · وسم المصدر `source: "analyzeDevice" | "migration"` (للترحيل، §٧).
- **غياب القيمة يبقى غياباً** (القاعدة 22): `sessionId` و`deviceFingerprintSha` و`timeSeriesStoragePath` تُنسخ **كما كُتبت**، `null` حيث كُتبت `null`؛ ولا يُنشأ مستند خامّ فارغ لتقرير بلا خامّ (§٧).

### ٣-٤ · الكتابة والقراءة

- **الكتابة:** `db.batch()` واحدة: `set(reportRaw/{scanId})` ثم `set(reports/{scanId})`. المشغّل `onDocumentCreated` يُطلَق بعد الإيداع، فيجد الخامّ.
- **الفشل:** الدفعة ذرّية — إمّا الاثنان أو لا شيء. (الفرق عن `serverSamples`: لا حالة «تقرير بلا خامّ» للتقارير الجديدة.) الخصم `scansRemaining` يقع **بعد** `set` (`analyzeDevice.js:693-703`) فلا يُخصَم بلا تقرير.
- **قارئ واحد مُصدَّر** (القاعدة 24: مصدر واحد، لا نسخة في كل ملفّ): دالّة `readReportRaw(db, scanId)` تُعيد **حالة صريحة** لا قيمة افتراضية: `PRIVATE` (المستند موجود) · `EMBEDDED_LEGACY` (غير موجود **وفي التقرير `rawFingerprint`**، نافذة الترحيل وحدها) · `ABSENT` (لا هذا ولا ذاك). كل قارئ يعالج الحالات الثلاث بالاسم. **وفرع `EMBEDDED_LEGACY` يُحذف بعد اكتمال الترحيل** (§٩).
- **حارس الحجم:** قياس `JSON.stringify` قبل الدفعة؛ فوق عتبة (مقترح 900,000 بايت) **خطأ صريح** لا اقتطاع (القاعدة 20) ولا فشل Firestore بنصّ عامّ. الهامش اليوم ≈ 25 ضعفاً على أعلى قياس (§١-٦).

### ٣-٥ · اقتراحي وسببه

**م٢ — `reportRaw/{scanId}`**، لأن: (١) سابقة `aiRawResponses` **بقرار المستخدم نفسه**؛ (٢) ذرّية مع التقرير وتصل المشغّلَ؛ (٣) لا يربط دورة حياة بالتقرير ولا `collectionGroup`؛ (٤) يبقى استعلام السكربتات (`count-qr…`) ممكناً؛ (٥) يحتمل خيارَي (أ) و(ب) بتغيير سطر في القواعد، بخلاف م٣. **ما يرجّح م٣ بدلاً منه:** إن أراد المستخدم ألّا يقرأه حتى حسابات المشرف الثلاثة عبر القواعد (§٤-٣) — بثمن فقدان الذرّية والاستعلام. **اسم المجموعة قرار تسمية لا أثر معماري.**

---

## ٤ · القواعد الجديدة — بنصّها المقترح

### ٤-١ · خيار (أ): المالك يقرأ الخامّ من العميل

```
    // ===== الخامّ المنقول من التقرير =====
    match /reportRaw/{scanId} {
      allow read: if request.auth != null &&
        resource.data.userId == request.auth.uid;
      allow write: if false;
    }
```
- الاستعلام (`list`) يُقبل **فقط** إن قيّد نفسه بـ`where('userId','==',uid)` (سلوك Firestore نفسه، موثَّق في `firestore.rules:125-129` للجلسات).
- **يتطلّب `userId` منسوخاً في مستند الخامّ.**
- **الأثر:** يُصبح للعميل (التطبيق أو الموقع) مسار قراءة الخامّ كلّه — فيه `functionalResults` (بينها `N-06` اسم المشغّل، `golden/README.md`) ومعرّفات الجهاز المجزَّأة — لحساب المالك. **في جلسات المحل المالك هو صاحب المحل، والجهاز المفحوص جهاز الزبون** (`analyzeDevice.js:364-376`، `userId = sessionDoc.data().ownerId`): فخامّ جهاز الزبون يصل متصفّح صاحب المحل.
- **الكلفة:** سطران في القواعد + اختبارات §٨؛ لا دالّة جديدة؛ **لا قارئ عميل للخامّ اليوم** (منقول، §٢-٢) فهي قناة بلا مستهلك حالي.

### ٤-٢ · خيار (ب): العميل ممنوع كلّياً، والمالك عبر دالّة خادم إن احتاجه

```
    match /reportRaw/{scanId} {
      allow read, write: if false;
    }
```
- (يُغني عنها غياب `match` أصلاً — كحال `aiRawResponses` — لكن الصريح يوثّق، سابقة `deviceProfiles` `:160-162`.)
- **للمالك إن احتاج:** دالّة قابلة للاستدعاء جديدة (اسم مقترح `getReportRaw`)، تقرأ `reports/{scanId}.userId` وتقارنه بـ`request.auth.uid` ثم تُرجع الخامّ؛ بمعدّل محدود كـ`verifyReport.js:120-130`. **لا تُبنى الآن** (لا مستهلك) — تُبنى حين يظهر مستهلك؛ فلا نشر دالّة جديدة في هذه الدفعة.
- **الأثر:** لا مسار عميل للخامّ البتّة؛ وخامّ جهاز الزبون لا يصل متصفّح صاحب المحل إلا بدالّة يفحصها الخادم.
- **الكلفة:** سطر في القواعد، ودالّة عند الطلب (يوم تقريباً، §١٠).

### ٤-٣ · ما يشترك فيه الخياران — **لا يمنعه أيٌّ منهما**

1. **القاعدة الشاملة `:26-28` تبقى سارية على `reportRaw`**: الحسابات الثلاثة في `isAdmin()` تقرأ وتكتب الخامّ مباشرةً من متصفّح، مهما كانت القاعدة الخاصّة، لأن القواعد **جمعٌ بالـOR لا فيها منع** (استثناء موثَّق بنصّ المستخدم في رأس `firestore.rules:14-25`). «لا يقرؤه إلا الخادم» صحيحة **لغير المشرف** وحده، في Firestore. للمنع الكامل: م٣ (Storage) أو إعادة بناء القاعدة الشاملة (خارج هذه الوثيقة، وتمسّ كل المجموعات).
2. **`isAdmin()` بلا `email_verified`** (`:5-12`) — **ملاحظة لا إصلاح:** حساب بريد/كلمة مرور غير مؤكَّد بأحد البريدات الثلاثة، إن كان مزوّد الدخول هذا مفعّلاً ولم يكن البريد مسجَّلاً سلفاً بمزوّد آخر، يحمل `request.auth.token.email` المطابق. (`firestore.rules.test.js:52-53` يختبر المشرف بـ`email` فقط، بلا `email_verified`، ويمرّ.) **لم أتحقّق من إعدادات Auth في المشروع** (لا شبكة، ولا وحدة تحكّم) — سؤال §١١-٨. تزيد أهمّيتها كلّما صار في Firestore مسار يقرؤه المشرف وحده.
3. **المالك يقرأ أصلاً `timeSeriesStoragePath` و`deviceFingerprintSha` و`sessionId` من `evaluations/{scanId}`** (`evaluationContract.js:116-117`، `submitEvaluation.js:295`، قاعدة `:88-92`). فـ«(ب): العميل ممنوع كلّياً» **لا يصدق على هذه الحقول الثلاثة** ما لم يُغيَّر نسخها إلى `evaluations` — وهي لازمة للربط بالتدريب (`LINKAGE_FIELDS`، `evaluationContract.js:65-70`). سؤال §١١-٦.

### ٤-٤ · قاعدة `reports` بعد النقل
- **`:69-72` (تحديث المالك)** تبقى كما هي: `hasOnly` يمنع المالك من كتابة الخامّ في التقرير.
- **`:65-66`** — الفصل التالي.

### ٤-٥ · Storage
م٢ لا تمسّ `storage.rules`. م٣: مسار جديد بلا `match` مرفوض افتراضياً (سابقة `serverSamples`)؛ ويمكن إضافة `match /reportRaw/{file} { allow read, write: if false; }` للتوثيق، ويُغطّى باختبار في `rules-test/storage.rules.test.js`.

### ٤-٦ · الفهارس (م٢)
إعفاء الفهرسة التلقائية عن **`rawFingerprint` وحده** (لا عن الجذور: `sessionId` يُستعلَم به في `count-qr…:129`) عبر `fieldOverrides` في `firestore.indexes.json`، يُنشر **قبل** أوّل كتابة. **«هل يشمل إعفاء حقل خريطة أبناءه» غير متحقَّق عندي** (لا شبكة ولا مصدر هنا) — يُحسم بتجربة المحاكي أو بتوثيق Firestore قبل التنفيذ. وتنبيه `docs/FIRESTORE_INDEXES.md`: **أيّ تعديل على الملفّ يُقرأ ذلك المستند أولاً**، ونشر الفهارس يحذف ما ليس في الملفّ.

---

## ٥ · مراجعة `firestore.rules:65-66`

### ٥-١ · ما تفعله الآن
`allow read: if request.auth != null && resource.data.listingStatus in ["for_sale","sold"];` — **أيّ حساب مصادَق** يقرأ **المستند كلّه** لأيّ تقرير معروض أو مباع، وسرده بـ`where('listingStatus','in',[...])`.

- **لماذا الكلّ؟** القواعد لا ترشّح حقولاً: تسمح بالمستند أو تمنعه. فما في المستند المقروء **مقروء كلّه** لكل من اجتاز الشرط. وهذا سبب أن «المستند المقروء لا يحمل إلا ما يعرضه» **هو** الوسيلة الوحيدة لتقليل ما تكشفه القاعدة.
- **لماذا وُجدت؟** لا سبب مكتوب: ظهرت في أوّل التزام (`a190946`، 2026-05-05، «No git history before this point»)، وتعليقها وحده «أي مستخدم مسجّل يقرأ التقارير المعروضة للبيع أو المباعة» (`:64`). لم تتغيّر منذ ذلك (منقول من ملفّ الفحص:23، ومُتحقَّق: `git log -S`).
- **«مصادَق» أوسع ممّا قاله ملفّ الفحص.** الملفّ يقول «لزائر غير مسجَّل: لا» لأن الموقع لا يسجّل دخولاً مجهولاً (`:7,29`). لكن **التطبيق يسجّل دخولاً مجهولاً على جهاز الزبون** (`analyzeDevice.js:353-355`، `storage.rules:14-16`)، فمزوّد الدخول المجهول **مفعَّل في المشروع** (استنتاج من هذا). `request.auth != null` صادقة لمجهول، فيكفي زائراً أن يسجّل دخولاً مجهولاً بإعدادات المشروع العلنية ثم يسرد المعروض. **مستنتَج من الكود والقواعد، لم يُشغَّل.** يُنقّح جواب «لزائر غير مسجَّل: لا» في ملفّ الفحص.
- **ما يكشفه اليوم لقارئ المعروض:** `userId` (معرّف البائع) · `rawFingerprint` كاملاً · `deviceFingerprintSha` (تجزئة ثابتة للجهاز: تربط **كل تقارير الجهاز نفسه** بين البائعين) · `timeSeriesStoragePath` (يحمل التجزئة نفسها) · `sessionId` · `aiAudit` (≈1.1 إلى 13.8 KB في العيّنات) · مؤشّرا `serverSamples*`. بعد نقل الخامّ والجذور الأربعة يبقى `userId` و`aiAudit` وأخواتهما — حسب §١١-٤.

### ٥-٢ · ما يحتاجه المتجر فعلاً — من جرد الكشّاف (منقول، غير متحقَّق)

**ما يقرؤه** (`ShopClient.js:117-124`، س:41): `reports` حيث `userId == doc0.id` و`listingStatus in ['for_sale','sold']`، `orderBy createdAt desc`، `limit(50)`؛ ويُنسخ المستند **كاملاً** إلى الحالة (`:127`، س:42).

**ما يصل الشاشة** (س:44-59): `listingStatus` (شارة) · `createdAt` ثم `scannedAt`/`timestamp`/`date` احتياطاً (تاريخ) · `grade` أو `aiResponse.overallGrade` (V6) · `aiResponse.overall.letter` (V7) · اسم الجهاز (ستّة مسارات: `deviceMarketingName` و`deviceModel` و`device` و`model` و`brand`+`modelName`) · `price` · `currency` · `sellerNote` · `scanId`/`id` لرابط `/verify/?scanId=` · ومن `aiResponse.overall` عبر `V7Notices`: `zeroMeasuredMessage` و`harnessError` و`harnessErrorMessage` و`governingGateReason.text` و`abstentionReasons[].{category,reason}` (س:61-67).

**ما يقرؤه ولا يعرضه** (س:69،218-226): `coverage` و`coveragePct` و`partialAssessment` و`partialAssessmentTag.*` و`noDataAtAll` و`harnessErrorReason` و`governingGateReason.{name,ceilingLetter,source}` من `readOverall`؛ و`pipeline` منطقاً. **ولا يقرأ `shortId`** (س:226,375). **ولا يعرض `userId`** — مرشِّحاً في الاستعلام فقط (س:46). (عدّ يدوي من س:61-69: سبعة مسارات من `overall` تُعرض وإحدى عشر تُقرأ بلا عرض.)

**فالمتجر لا يحتاج:** `rawFingerprint` ولا الجذور الثلاثة ولا `aiAudit` ولا أيّاً من العشرة في §٢-٢. **ويحتاج من الجذر:** `userId` (للاستعلام) · `listingStatus` · `createdAt` · `pipeline` · `grade` · أسماء الجهاز · حقول المالك الأربعة · وبعض `aiResponse.overall`.

**من يبلغ `:65-66` اليوم؟**
- **صفحة المتجر:** استعلامها يقيّد `userId == doc0.id`، **وخطوتها الأولى** تقرأ `users` بـ`where shopSlug == slug` وقاعدة `users:43` تشترط `request.auth.uid == uid` فتُرفض لغير صاحب المتجر والمشرف (ملفّ الفحص:34، `ShopClient.js:87-92` — منقول). فعارض غير المالك **لا يبلغ الاستعلام الثاني**.
- **`dashboard` و`tech` والتطبيق** (`ViewModels.kt:217,2231`): `userId == uid` — بقاعدة المالك `:61-62` (س:239).
- **الإدارة:** القاعدة الشاملة `:26-28`.
- **`fetchExistingReport`** (`FirebaseAnalysisService.kt:194`، س:158): قراءة بالمعرّف بلا `where`. لتقرير يملكه غير المصادَق عليه (جلسات المحل: `userId` صاحب المحل، والجهاز المفحوص مجهول) لا تمرّ إلا إن كان `listingStatus` معروضاً أو مباعاً (`:65-66`). **أيّ رفض → `null`** (`:196-198,250-259`، س:344)، فيمضي التطبيق إلى `analyzeDevice` الذي يعيد المحفوظ بـAdmin SDK (`analyzeDevice.js:395-410`). *استنتاج من النصّ، لم يُشغَّل.*

**الخلاصة:** لا قارئ معروف يحتاج `:65-66` لعارض غير المالك **إلا صفحة المتجر العلنية بوصفها فكرة**، وهي بحسب ملفّ الفحص لا تبلغه فعلياً لغير صاحبها. **غير متحقَّق من الموقع المنشور**، وحدود الكشّاف في §٢ (لم يفحص الكشّاف `scripts/` ولا `contract/`، س:18).

### ٥-٣ · خيارات التضييق، وأثر كلٍّ

| | القاعدة | أثره على صفحة المتجر | الاستعلامات والفهارس | `userId` ظاهر لغير المالك؟ | كلفة إضافية |
|---|---|---|---|---|---|
| **ن٠** | تبقى كما هي (نقل الخامّ وحده) | لا أثر | لا تغيير | **نعم** | صفر |
| **ن١** | **حذف `:65-66`** (مالك + مشرف فقط) | يعمل لصاحب المتجر (قاعدة المالك). **لا قارئ مباشر معروف يتعطّل** سوى عارض غير المالك للمتجر العلني (خطوته الأولى مرفوضة أصلاً، §٥-٢) و`fetchExistingReport` لتقرير معروض يملكه غيره (يعود `null` ثم يُعيد `analyzeDevice` المحفوظ، §٥-٢ — استنتاج) | **لا تغيير في الفهرسين** (`userId+listingStatus+createdAt` يخدم استعلام المالك) | **لا** | سطران؛ اختبارات §٨؛ ينسّق مع نشر الموقع إن لزم |
| **ن٢** | مستند إسقاط عامّ `shopListings/{scanId}` بما يعرضه المتجر فقط (§٥-٢: `listingStatus` و`createdAt` و`pipeline` و`grade` وأسماء الجهاز وحقول المالك الأربعة و`overall.{letter,zeroMeasuredMessage,harnessError,harnessErrorMessage,governingGateReason.text,abstentionReasons}`، ومعرّف مُشغِّل المتجر لا `userId`)، و`:65-66` تُحذف من `reports` | تغيير استعلام صفحة المتجر إلى المجموعة الجديدة (في الموقع) | **فهرس مركّب جديد** على المجموعة الجديدة (يُضاف إلى `firestore.indexes.json` أولاً) | **لا** (إن حُذف من الإسقاط) | **مشغّل جديد** `onDocumentUpdated(reports)` يبني الإسقاط ويحذفه عند خروج التقرير من المعروض (المالك يغيّر `listingStatus` من العميل بلا دالّة) + ترحيل + دالّة منشورة جديدة |
| **ن٣** | قصر `:65-66` على غير المجهول: `request.auth.token.firebase.sign_in_provider != "anonymous"` | لا أثر على الحساب الحقيقي | لا تغيير | **نعم** لأيّ حساب غير مجهول | سطر؛ **حماية جزئية فقط**: من يستطيع إنشاء حساب بريد/كلمة مرور يتجاوزها (يتوقّف على فتح التسجيل — سؤال §١١-٨) |
| **ن٤** | حذف `:65-66`، وقراءة المعروض عبر دالّة قابلة للاستدعاء `getShopListings(slug)` بقائمة بيضاء (كـ`verifyReport.js`) | صفحة المتجر تستدعي الدالّة بدل Firestore (في الموقع) | لا حاجة للفهرس الثاني لغير المالك | **لا** | دالّة جديدة منشورة + نمط تحديد معدّل + تغيير الموقع + اختبارات |

**ما أعرضه ولا أحسمه:** ن٠ يترك ظهور `userId` الذي قال القرار إنه «يُعالَج في هذه المراجعة»؛ ن١ هو الأرخص لو ثبت أنّ لا عارض آخر؛ ن٢ ون٤ يُبقيان المتجر العلني لمن يريده **ويُخرجان `userId` والتجزئة من متناول غير المالك** بكلفة دالّة ومشغّل جديدَين. ن٣ لا يكفي وحده.

---

## ٦ · أثر النقل على كل قارئ وكاتب

### ٦-١ · الخادم — الدوالّ (`functions/src`)

| الملفّ | التغيير المطلوب | دالّة منشورة تتأثّر |
|---|---|---|
| `analysis/analyzeDevice.js` | `buildReportDocument` **بلا** الحقول المنقولة؛ دالّة نقيّة جديدة تبني مستند الخامّ؛ `db.batch()` بدل `reportRef.set` (`:693`)؛ حارس الحجم | `analyzeDevice` |
| `analysis/` (جديد) `reportRawStore.js` | `readReportRaw` (الحالات الثلاث §٣-٤) + اسم المجموعة (مصدر واحد، القاعدة 24) + بنّاء المستند | — |
| `evaluations/evaluationContract.js` | `buildReportSnapshot(report)` يقرأ `rawFingerprint`/`timeSeriesStoragePath`/`deviceFingerprintSha` من المستند (`:110-129`) → يصير `buildReportSnapshot(report, rawState)`؛ **وحالة «الخامّ غائب» تُعلَن بسبب مسمّى** (`RAW_ABSENT`) لا أن تُقرأ «ربط ناقص» كما لو كان تقريراً قديماً (`LINKAGE_FIELDS` `:65-70`، و`linkageStatus` `:204`) — القاعدة 22 | `submitEvaluation` و`resolvePendingEvaluation` |
| `evaluations/submitEvaluation.js` | قراءة إضافية لمستند الخامّ بعد `:255` | `submitEvaluation` |
| `evaluations/resolvePendingEvaluation.js` | قراءة إضافية؛ **لا يعتمد على `event.data` للخامّ** | `resolvePendingEvaluation` |
| `analysis/rehydrateReportSamples.js` | `rehydrateReportFingerprint(admin, reportData)` (`:130-139`) يأخذ الخامّ من القارئ الجديد | لا أحد (غير مستهلَك) |
| `reports/verifyReport.js` · `reports/generateReportPdf.js` | **لا تغيير** | — |
| `admin/runConsistencyTest.js` · `analysis/callAI.js` · `analysis/buildV7Payload.js` · `lab/**` · `prompts/systemPromptV6.js` | **لا تغيير** (تعمل على بصمة في الذاكرة أو طلب، §١-٤) | — |

**القائمة المشتقّة بالأداة** (`functions/scripts/deploy-list.js` على الملفّات الخمسة الموجودة أعلاه: `analyzeDevice.js`، `evaluationContract.js`، `submitEvaluation.js`، `resolvePendingEvaluation.js`، `rehydrateReportSamples.js`): **يجب نشرها 3 من 18 — `analyzeDevice`، `submitEvaluation`، `resolvePendingEvaluation`.** ولا تُحسب الدالّة الجديدة (ب) ولا الإسقاط (ن٢/ن٤) إلا بعد كتابتها.

### ٦-٢ · الخادم — السكربتات (`functions/scripts`)

| السكربت | الموضع | ما يقرؤه من مستند التقرير | الأثر |
|---|---|---|---|
| `audit-device-profiles-readonly.js` | `:190-193` | `rawFingerprint.device.deviceProfileKey.a` (Admin SDK) | يقرأ من القارئ الجديد؛ فرع `EMBEDDED_LEGACY` مؤقّت |
| `export-v6-report-readonly.js` | `:118-126` (قائمة تنقية)، `:238` | مسارات `rawFingerprint.*` | تُحدَّث المسارات؛ التصدير يجمع المستندين |
| `export-v7-report-readonly.js` | `:92`، `:169-173` | `rawFingerprint.functionalResults` (`compareTestIds`) | يقرأ من الخامّ |
| `export-v7-replay-inputs-readonly.js` | `:170` | `redacted.rawFingerprint` من **ملفّ تصدير**، لا من Firestore | يتبع شكل التصدير الجديد |
| `fetch-functional-results-golden.js` | `:79,103` | REST على `reports/{scanId}` ثم `rawFingerprint.functionalResults` | مسار REST الجديد |
| `measure-deepseek-only-variance.js` | `:202,237-258` | REST، `cur.rawFingerprint` | مسار REST الجديد |
| `regenerate-report.js` | `:96,301-321` | `cur.rawFingerprint` (REST) — **سكربت لتقرير واحد مثبَّت** (`SCAN_ID`، `:68-70`) | **تاريخي**: يُوسَم أو يُحدَّث؛ ليس في أيّ مسار حيّ |
| `count-qr-session-timeseries-storage-readonly.js` | `:129-136` | `where('sessionId','!=',null).select('timeSeriesStoragePath')` | **ينتقل استعلامه كما هو** إلى `reportRaw` (الحقلان معاً هناك) |
| `generate-v6-reports-document-sample.js` + خمسة مولّدات V7 (`generate-v7-reports-document-sample{,-honor,-security-downgrade,-cpu-c06-downgrade,-zero-measured}.js`) | `buildReportDocument(p)` | — | تُعيد التوليد؛ **`generate-v6` يفحص وجود `rawFingerprint.*` في المستند صراحةً** (`:117-143`) فيُعاد نصّه |
| `audit-scan-charge-race-readonly.js` | `:204,268-279` | `userId` وحده | **لا أثر** |
| `measure-v6-vs-v7-payload.js` | `:85-102` | يبني حمولة محلّياً | **لا أثر** |

### ٦-٣ · الاختبارات والعيّنات الذهبية

- **الاختبارات التي تذكر الحقول** (أسطر شيفرة، من ملحق الجرد): `rawFingerprint` في **14 ملفّاً** (أكبرها `exportV6ReportReadonly.test.js` 15 و`v6ReportsDocumentContractGuard.test.js` 15 و`exportV7ReportReadonly.test.js` 8)، والحقول الأخرى في 8 إلى 12 ملفّاً. **e2e (تعمل بالمحاكي وتكتب Firestore):** `evaluation_linkage` و`report_training_links` و`session_evaluation` و`submit_evaluation` و`qr_report_idempotency` و`session_billing` — تزرع مستندات تقرير بهذه الحقول وتفحص الربط.
- **العيّنات الذهبية المتأثّرة (القاعدة 39: تتبع العقد):** `golden/v6-reports-document-sample.json` وستّ عيّنات `v7-reports-document-sample{,-honor,-security-downgrade,-cpu-c06-downgrade,-zero-measured,-zero-measured-battery-harness-error}.json` تحمل `rawFingerprint` (كلٌّ بموضع واحد في `git grep -c`)، و`functionalResults-by-scanid.json` (يذكره في `_source`). **تُعاد توليد السبع من مولّداتها** وتُحدَّث حرّاسها (`v7ReportsDocument*ContractGuard`، `v6ReportsDocumentContractGuard`)، **وتُنسخ إلى الموقع والتطبيق** حيث تُختبر قراءتهما (القاعدتان 39 و41) — **منقول من القاعدتين، لم أتحقّق من مواضع النسخ هناك**. `goldenFixturesGuardCoverage.test.js` يحتاج تصنيفاً لأيّ ملفّ ذهبي جديد.
- **التوثيق:** `docs/V7_DISPLAY_SHAPE_CONTRACT.md` §١١ (`rawFingerprint.device.deviceProfileKey`، `:653`) و§١٣ (مؤشّرا `serverSamples*`، `:751`) و`golden/README.md`.

### ٦-٤ · التطبيق والموقع — **منقول من جرد الكشّاف، غير متحقَّق** (س:N = `scout-client-reads-of-reports-2026-10-09.md`)

1. **لا قارئ بالاسم لـ`rawFingerprint` ولا للجذور الثلاثة** (س:7 تحقّق المنسّق؛ س:233-301؛ س:175-179) — فالنقل **لا يكسر قارئاً بالاسم** في أيّ من المستودعين.
2. **ما يتأثّر بحجم المستند وشكله لا بأسماء حقوله:**
   - **الموقع:** خمس صفحات تنسخ المستند كاملاً إلى الحالة (س:355)؛ `admin/reports/page.js:110-114` تقرأ **كل** المستندات بلا حدّ (س:106) — فكل بايت من الخامّ يُنقل لكل تقرير؛ وتعرض `JSON.stringify(report, null, 2)` (`:533`، س:137,351): **بعد النقل لا يظهر الخامّ هناك** إلا إن عُدّلت الصفحة لتقرأ `reportRaw` (المشرف يقرؤها بالقاعدة الشاملة) — سؤال §١١-٧.
   - **الموقع:** `admin/page.js:50-51,150,206,291` يحفظ آخر عشرة مستندات **كاملة** في `sessionStorage` (`nc_admin_stats_v1`) خمس دقائق (س:149,352): **بعد النقل يغيب الخامّ والجذور الثلاثة عن هذا التخزين**، وتبقى سائر الحقول فيه (ومنها `aiAudit` إن لم يُنقل، §١١-٤).
   - **التطبيق:** `fetchExistingReport` يحوّل المستند كاملاً بـ`gson.toJson(flat)` (`FirebaseAnalysisService.kt:208`، س:359) بعد `flattenReportDocument` (`:651-659`، س:163) الذي ينسخ أبناء `aiResponse` وأخواتها إلى الجذر إن غابت هناك. الحقول المنقولة **ليست أبناء حاويات**، فلا أثر على هذا النسخ (استنتاج من وصف الكشّاف).
   - **التطبيق:** `FBAS:201-204` يطبع `data?.keys` في logcat (س:360-361): قائمة الأسماء المطبوعة تتقلّص بعد النقل، ولا أثر آخر.
3. **جذور تعتمد عليها بوّابات القراءة — لا تُنقل:** `FBAS:578-583` تفحص `pipeline` و`aiResponse` و`aiResponse.overall` و`overall.letterSource` و`grade` و`score` (نوع `Number`) (س:162)؛ والموقع `pipeline` منطقاً في كل صفحاته (س:258).
4. **`userId` يُقرأ منطقاً فقط** (`where`) في الموقع والتطبيق (س:239): يبقى بنصّ القرار.
5. **الكتابة:** لا كتابة إلى `reports` من التطبيق (س:303,379)؛ والموقع كتابة وحيدة `dashboard/page.js:117` بحقول المالك الأربعة (س:29,90) — لا تمسّ الخامّ، وقاعدة `:69-72` (`hasOnly`) تمنع غير ذلك.
6. **العيّنات الذهبية لمستند التقرير:** القاعدتان 39 و41 تُلزمان بنسخها وباختبار كل قارئ عليها (منقول من القاعدتين، لم أتحقّق من مواضع النسخ). **بعد النقل تُعاد توليدها (§٦-٣)** — فتتغيّر لدى القرّاء الذين يقرؤون `aiResponse` ولا يقرؤون الخامّ، **دون أن يتغيّر ما يقرؤونه**؛ والاختبار الذي يجب أن يمرّ عليهم هو أن المستند الجديد **لا يُسقط** شيئاً مقروءاً (القاعدة 25).
7. **ما لم يفحصه الكشّاف** (س:18): `scripts/` و`docs/` و`contract/` في الموقع، و`src/test/` في التطبيق، و`ReportScreen.kt` و`ReportPdfGenerator.kt` (تتبّع العرض حقلاً حقلاً). فقد يوجد قارئ في أحدها لا أراه.

---

## ٧ · خطّة سكربت الترحيل للتقارير الموجودة

> **تحديث 2026-10-09 (الجزء ٢ من نقل الخامّ) — ما نُفِّذ، وما يخالف هذا القسم:** السكربت `functions/scripts/migrate-report-raw.js` (والمنطق في
> `functions/scripts/lib/reportRawMigration.js`). **الفروق عمّا يلي:** (١) المفاتيح المنقولة **خمسة** (`REPORT_RAW_FIELDS`، ومنها `aiAudit`، قرار المستخدم ٤)
> لا أربعة؛ (٢) الكتابة لكل تقرير **دفعة ذرّية واحدة** (`create` لمستند الخامّ + `update` بحذف المفاتيح بشرط `lastUpdateTime`) بنصّ أمر المنسّق، بدل «create ثم
> قراءة ومقارنة ثم update» في ٧-٢ (٣-٥)؛ المقارنة قبل الإرسال (في الذاكرة) وبعد الإيداع (قراءة المستند المكتوب)، والنسخة الاحتياطية تسبق أيّ حذف، والحالة
> `HALF` تبقى مُصنَّفة (لحالة يصنعها غير السكربت)؛ (٣) `--restore` (٧-١) مُنفَّذ: معاينة بلا كتابة، ومعه `--apply` يكتب؛ (٤) `evaluations` (قيد ٤ في ١١) تُعالَج في السكربت
> نفسه: المعرّفات الثلاثة تُحذف منها إن كانت قيمتها في reportRaw (أو في الخامّ المضمَّن لتقرير لم يُرحَّل)، وتُنقل إلى reportRaw إن كان التقييم النسخة الوحيدة، وتبقى
> (وتُعدّ) إن لم يوجد تقرير؛ (٥) `--apply` يشترط `--backup` و`--plan` كلاهما؛ (٦) الاسم `migrate-report-raw.js` لا `migrate-report-raw-to-private.js`.
> **ما لم يتغيّر:** الجافّ افتراضي عبر `wrapReadOnly`، المعروض والمُباع أوّلاً، `create` لا `set`، تعارض خامّ قائم يوقف ويُعَدّ، تقرير بلا أيّ من المفاتيح يُعدّ ولا يُكتب
> له شيء، رمز خروج `--verify` غير 0 ما دام باقٍ في `reports`.

**يشغّله المستخدم بيده** («لا يُكتب شيء في الإنتاج إلا بيدي»)؛ لا الجلسة الآلية. الاعتماد من بيئة الطرفية وحدها (ADC أو `GOOGLE_APPLICATION_CREDENTIALS`) — لا مفتاح في سطر أمر (سابقة `verify-scansessions-rules-postdeploy-readonly.js`، `backup-firestore-rules-before-deploy.js`). اسم مقترح: `functions/scripts/migrate-report-raw-to-private.js`.

### ٧-١ · الأوضاع
- **افتراضي = تشغيل جافّ**: لا يكتب شيئاً. يعيد استعمال **`wrapReadOnly`** من `audit-device-profiles-readonly.js` (مصدر واحد، القاعدة 24 — مغلِّف يرمي عند أيّ كتابة).
- **`--apply`**: يكتب. **لا يبدأ** قبل أن يوجد ملفّ النسخة الاحتياطية (٧-٣) غير فارغ ومقروءاً. يطلب `--plan <ملفّ-التشغيل-الجافّ>` ويقارن ملخّص أعداده بأعداد اللحظة؛ إن اختلفت اختلافاً يتجاوز عتبة معلنة يتوقّف.
- **`--verify`**: قراءة بحتة بعد الترحيل (٧-٥).
- **`--restore <نسخة>`**: التراجع (٧-٣).

### ٧-٢ · الخوارزمية لكل تقرير R (ترتيب بمعرّف المستند، مؤشّر استئناف، دفعات صغيرة)

الحقول المنقولة M = `{rawFingerprint, deviceFingerprintSha, timeSeriesStoragePath, sessionId}`.

1. اقرأ R كاملاً؛ احفظ `updateTime`.
2. **صنّف** (القاعدة 22 — حالة صريحة، لا قراءة غياب نجاحاً):
   - `MIGRATE`: في R حقل من M (ولو `null` كُتب صراحةً) ولا مستند خامّ.
   - `HALF`: مستند الخامّ موجود **وفي R ما زالت حقول M** (انقطع بين الخطوتين) ⇒ تحقّق ثم أكمل.
   - `DONE`: مستند الخامّ موجود ولا حقول M في R ⇒ لا كتابة (إعادة التشغيل بلا أثر مضاعف).
   - `NO_RAW`: R بلا `rawFingerprint` **ولا** أيّ من الجذور الثلاثة ولا مستند خامّ ⇒ يُسجَّل ولا يُنشأ مستند فارغ.
   - `CONFLICT`: مستند خامّ موجود **بمحتوى يخالف** R ⇒ **توقّف كامل** (لا يُكتب فوقه أبداً).
3. اكتب مستند الخامّ بـ`create` (لا `set`) من نسخة حرفية، `source:"migration"`، وقت الترحيل.
4. **اقرأه وقارن** بـ M من R (مقارنة بنيوية أو تجزئة JSON قانونية). مخالفة ⇒ توقّف.
5. **فقط بعد التطابق:** حدِّث R بحذف حقول M (`FieldValue.delete()`) **بشرط `lastUpdateTime` = ما قرأتَه** — إن عدّل المالك (`price`/`listingStatus`) في الأثناء يفشل الشرط ويُعاد التقرير؛ **لا دوس** على تعديل المالك.
6. أضف سطراً إلى سجلّ JSONL (خارج المستودع).

- **الاستئناف:** الحقيقة في Firestore (التصنيف أعلاه يُشتقّ كل مرّة)؛ السجلّ والمؤشّر للتقدّم والتقرير وحدهما.
- **الترتيب لتقصير النافذة:** المرحلة ١: `where('listingStatus','in',['for_sale','sold'])` (المقروءة من غير مالكها اليوم)؛ المرحلة ٢: الباقي.
- **المعدّل:** دفعات ≤ 50 تقريراً (≈ 100 كتابة، وحجم الدفعة ≪ حدّها)، مع تهدئة وفق توصية Firestore لمجموعة جديدة (500 كتابة/ثانية ثم زيادة تدريجية) — **من معرفتي بالتوثيق، لم أتحقّق منه هنا**.

### ٧-٣ · النسخة الاحتياطية والتراجع
1. **إلزامي:** ملفّ JSONL **خارج المستودع** يحمل لكل تقرير M كما قُرئ + `updateTime`، يُكتب ويُغلق (`fsync`) **قبل** أيّ حذف في الخطوة 5. حجمه ≈ مجموع أحجام M (≈ 6.7K إلى 41K لكل تقرير في العيّنات، §١-٦) — **العدد الحقيقي يعطيه التشغيل الجافّ.**
2. **اختياري، بقرار المستخدم:** تصدير Firestore المُدار (`gcloud firestore export`) لمجموعة `reports` قبل `--apply`. يحتاج حاوية Storage وله كلفة؛ لا أقدّرها.
3. **التراجع (`--restore`):** يكتب M إلى R من النسخة (بشرط `updateTime`) ثم يحذف **مستندات الخامّ التي أنشأها الترحيل وحدها** (`source:"migration"`). **تحذير:** النسخة الاحتياطية **تحمل المعرّفات الخام لتقارير ما قبل `3ab4efb`** (§٧-٤) — تُحفظ بحسب قرار المستخدم ومدّة يحدّدها.

### ٧-٤ · حالات خاصّة — بنصّ الأمر
- **تقرير بلا `rawFingerprint`:** `NO_RAW`. لا مستند خامّ، ولا حقل قيمة افتراضية. يُعدّ في الملخّص بالاسم. وإن حمل جذراً من الثلاثة (`deviceFingerprintSha`/`timeSeriesStoragePath`/`sessionId`) فهو `MIGRATE` للجذور وحدها (`rawFingerprint` غائب في مستند الخامّ، لا `null`).
- **تقرير يحمل معرّفَي `layerB_firebaseId`/`layerC_androidId` خامّين (قبل `3ab4efb`، 2026-09-20):** يُنقل **حرفياً** (القاعدة 20: لا تعديل للخامّ في الترحيل). تُعَدّ في التشغيل الجافّ **بالاستدلال** (غير تجزئة 64 خانة سداسية وغير علامة الغياب `hashedOrSentinel`، منقول من ملفّ الفحص:54) — **عدّ استدلالي لا قطعي**. وبعد الترحيل لا تُقرأ من التقرير المقروء. *هل بقي منها في الإنتاج معروض أو مباع: غير متحقَّق* (ملفّ الفحص:57)، ويُجيب عنه التشغيل الجافّ.
- **تقرير V6** (`pipeline` غائب أو V6): نفس الخوارزمية؛ `grade`/`score` لا يُمسّان.
- **تقرير يحمل `serverSamplesStoragePath/serverSamplesSaved`:** حسب §١١-٤.

### ٧-٥ · الأعداد قبل وبعد (يطبعها السكربت)
**قبل (جافّ):** عدد التقارير · عدد الحاملة لكل حقل من M (موجود/`null`/غائب) · عدد `for_sale`+`sold` · **التصنيف** (`MIGRATE`/`HALF`/`DONE`/`NO_RAW`/`CONFLICT`) · مجموع وأكبر حجم لـM · عدد ما فوق عتبة الحجم · عدد الاستدلالي للمعرّفات الخام.
**بعد (`--verify`):** عدد التقارير التي ما زالت تحمل أيّ حقل من M (**يجب 0**) · عدد مستندات الخامّ (= `MIGRATE`+`HALF` المنجزة) · عدد المخالفات في المقارنة (**0**) · `NO_RAW` كما كان.

### ٧-٦ · اختبار السكربت بالمحاكي قبل أيّ تشغيل حقيقي
(§٨-٣) — بذور: تقرير عادي، بلا خامّ، نصف مُرحَّل، مُعدَّل من المالك أثناء التشغيل، بمعرّفات خام، بحجم قريب من العتبة، V6، وتكرار التشغيل (يجب صفر أثر)، وقتل منتصف التشغيل ثم الاستئناف.

---

## ٨ · خطّة اختبارات المحاكي

التشغيل: `firebase emulators:exec --only firestore --project demo-nc "node rules-test/<ملفّ>"` (يحتاج JDK 21+، كما في رأس `rules-test/firestore.rules.test.js`)، على النمط القائم (`initializeTestEnvironment` + `check(...)` + `assertSucceeds/assertFails`، `authenticatedContext(uid)` و`withSecurityRulesDisabled` لزرع الخادم). **`rules-test/firestore.rules.test.js` القائم لا يغطّي `reports` اليوم** (§١-٥): تُضاف الأقسام إليه كما في الأمر، أو ملفّ مجاور على سابقة `scanSessions.rules.test.js` — اختيار تنظيمي.

### ٨-١ · القواعد (محاكي Firestore)
| # | الحالة | (أ) | (ب) |
|---|---|---|---|
| 1 | **مسجَّل غريب** (`uid` ≠ المالك) `get(reportRaw/X)` | يفشل | يفشل |
| 2 | مسجَّل غريب يسرد `reportRaw` (بقيد أو بلا قيد) | يفشل | يفشل |
| 3 | **مجهول** (`sign_in_provider: "anonymous"`) `get` | يفشل | يفشل |
| 4 | غير مصادَق `get` | يفشل | يفشل |
| 5 | **المالك** `get(reportRaw/X)` | **ينجح** | **يفشل** |
| 6 | المالك يسرد بـ`where('userId','==',uid)` | **ينجح** | يفشل |
| 7 | المالك يسرد **بلا** قيد `userId` | يفشل | يفشل |
| 8 | المالك يكتب/ينشئ/يحذف مستند الخامّ | يفشل | يفشل |
| 9 | **الخادم** (`withSecurityRulesDisabled`) يقرأ ويكتب | ينجح | ينجح |
| 10 | **المشرف** (`email` من القائمة) `get` | ينجح (القاعدة الشاملة — يُوثَّق) | ينجح (توثيق §٤-٣) |
| 11 | مشرف **بلا** `email_verified` ينجح | **اختبار توثيقي للثغرة** (§٤-٣-٢): ينجح اليوم، ويُعكَس إن عولجت | كذلك |
| 12 | المالك يحدّث `reports/X` بـ`rawFingerprint` أو أيّ حقل خارج الأربعة | يفشل (`hasOnly`، `:69-72`) | يفشل |

### ٨-٢ · `reports` بعد اختيار §٥ — **مسجَّل غريب يقرأ المعروض بلا الخامّ إن بقيت `:65-66`**
| # | الحالة | ن٠ | ن١ | ن٣ |
|---|---|---|---|---|
| 13 | غريب مصادَق `get(reports/X)` و`listingStatus="for_sale"` | ينجح | **يفشل** | ينجح (غير مجهول) |
| 14 | مجهول، المستند نفسه | ينجح | يفشل | **يفشل** |
| 15 | غريب `get` وليس معروضاً (`listingStatus` غائب) | يفشل | يفشل | يفشل |
| 16 | غريب يسرد `where('listingStatus','in',[...])` | ينجح | **يفشل** | ينجح (غير مجهول) |
| 17 | غريب يسرد بلا قيد | يفشل | يفشل | يفشل |
| 18 | المالك يسرد `where('userId','==',uid)` + `orderBy('createdAt','desc')` | ينجح | ينجح | ينجح |

ويُزرَع في الاختبارات **شكل المستند الجديد** (بلا الحقول المنقولة) كي تثبت أنّ «ما يقرؤه الغريب» هو المقروء الجديد. **غياب الحقل لا تُثبته القواعد**، فيُثبت باختبار وحدة (٨-٣).

### ٨-٣ · وحدة وسلسلة (بلا محاكي أو معه)
- **وحدة، السويت غير e2e:** مستند `buildReportDocument` **لا يحمل أيّاً** من الحقول الأربعة ولا `rawFingerprint`؛ بنّاء مستند الخامّ يحمل كلّها حرفياً؛ `readReportRaw` بالحالات الثلاث؛ `buildReportSnapshot` بالحالات الثلاث (و`RAW_ABSENT` بسببه المسمّى)؛ حارس الحجم؛ العيّنات الذهبية المعاد توليدها. **القاعدة 37:** ولا يُستبدَل في أحدها ما قد يرفض (الطبقة الحقيقية).
- **e2e بالمحاكي (Firestore + Functions):** `analyzeDevice` ⇒ المستندان موجودان وذرّيان؛ فشل الدفعة ⇒ لا واحد منهما؛ `resolvePendingEvaluation` ⇒ يجد الخامّ ويُكمل `pending` بلا `linkageIncomplete` خاطئ؛ `submitEvaluation` على تقرير مُرحَّل وغير مُرحَّل.
- **سكربت الترحيل بالمحاكي:** بذور §٧-٦؛ التأكيدات: أعداد §٧-٥، صفر أثر مضاعف عند التكرار، لا دوس على تعديل المالك، `CONFLICT` يوقف.
- **Storage (م٣ فقط):** حالة في `rules-test/storage.rules.test.js` — مسار الخامّ مغلق قراءةً وكتابةً لمصادَق ومجهول.

---

## ٩ · ترتيب النشر ونافذة الخطر

**الأمر المنقول:** الدوالّ، ثم القواعد، ثم الترحيل. **وشرط (ج): لا حمولة fv68 في الإنتاج قبل اكتمال (ب).**
**هذه الوثيقة لا تُنفّذ شيئاً ولا تقترح أمر نشر.**

| الخطوة | ما يحدث | ما يضمنها |
|---|---|---|
| **٠** (بلا أثر على الإنتاج) | الكود والاختبارات والعيّنات الذهبية، بعد اعتماد هذه الوثيقة | السويت + المحاكي |
| **٠-ب** (إن اختير الإعفاء من الفهرسة) | `firestore.indexes.json` **قبل** أوّل كتابة | قراءة `docs/FIRESTORE_INDEXES.md` ومقارنة المنشور |
| **١** | **الدوالّ** (3 من 18 بالأداة، + دالّة (ب)/ن٢/ن٤ إن بُنيت): تكتب مستند الخامّ ومستند التقرير بلا الخامّ؛ القارئ الجديد يقبل `EMBEDDED_LEGACY` | القارئ يتعامل مع الاثنين |
| **٢** | **القواعد**: القاعدة الصريحة لـ`reportRaw` + (إن اختير) تضييق `:65-66` | نسخة القواعد المنشورة محفوظة قبلها (`backup-firestore-rules-before-deploy.js`) + اختبارات §٨ |
| **٣** | **الترحيل** بيد المستخدم: جافّ ⇒ نسخة ⇒ `--apply` (المعروضة أولاً) ⇒ `--verify` | §٧ |
| **٤** (بعد تحقّق صفر) | حذف فرع `EMBEDDED_LEGACY` ونشر الدوالّ ثانيةً | `--verify` = 0 |

### نوافذ الخطر بين نشر وآخر
1. **بعد ١ وقبل ٢:** المجموعة الجديدة **مغلقة افتراضياً** (مسار بلا `match`، لا يقرؤها إلا المشرف) — فلا فتح بين الخطوتين. **التقارير القديمة** ما زالت تحمل الخامّ مقروءاً لأيّ مصادَق: **هو الوضع الحالي لا أسوأ منه.**
2. **بعد ٢ وقبل نشر الموقع** (إن تضمّنت §٥ ن١/ن٢/ن٤): **ن١** أثرها على الموقع منخفض بحسب الجرد (§٥-٢: عارض غير المالك لا يبلغ الاستعلام أصلاً)؛ **ن٢/ن٤** يتطلّبان تغيير صفحة المتجر، فيُنشر الموقع **قبل** حذف `:65-66` وإلا تعطّلت. تنسيق مع وكيل الموقع.
3. **أثناء نشر الدوالّ المتدرّج:** قد تكتب نسخة قديمة تقريراً بالشكل القديم (خامّ مضمَّن) لحظات بعد بدء الخطوة ١. **تعالجها دورة الترحيل** (تصنيف `MIGRATE`) ومرور `--verify` النهائي — ولهذا يُجرى الترحيل **بعد اكتمال انتشار ١**.
4. **سباق المشغّل:** `resolvePendingEvaluation` يُطلَق بعد إيداع التقرير؛ الدفعة الذرّية تضمن أن الخامّ مودَع قبله (§٣-٤). **اختبار e2e إلزامي** (§٨-٣).
5. **التراجع عن ١:** إعادة الدوالّ السابقة تُنتج تقارير بالشكل القديم من جديد، **وتجهل مستندات الخامّ** المكتوبة بين الخطوتين (فربط `evaluations` لها يظهر ناقصاً). فيُراعى قبل أيّ تراجع. تراجع ٢: القواعد المحفوظة.
6. **شرط (ج) وfv68:** الحمولة تصل الإنتاج حين يُصدر التطبيق إصداراً بها؛ ما يضمنه الخادم بعد الخطوة ١ أنّ **خامّ التقارير الجديدة** لا يُكتب في المستند المقروء. وما يلزم لـ«اكتمال (ب)» بالمعنى الذي قاله المستخدم (جرد + نقل + **ترحيل الموجود** + اختبار المحاكي) هو الخطوات ٠-٣. **أقترح ربط إصدار fv68 بنجاح `--verify`** — قرار المستخدم؛ والجدول لا يفرضه الخادم.

---

## ١٠ · الكلفة — **تقدير بالأيام والملفّات، غير مقيس**

| البند | الملفّات | الأيام (تقدير) |
|---|---|---|
| الكاتب + القارئ المُصدَّر + بنّاء الخامّ | `analyzeDevice.js` + `reportRawStore.js` (جديد) | 1 إلى 1.5 |
| قرّاء الدوالّ (ربط التقييم) | `evaluationContract.js` · `submitEvaluation.js` · `resolvePendingEvaluation.js` · `rehydrateReportSamples.js` | 1 إلى 1.5 |
| السكربتات الثمانية القارئة | `audit-device-profiles` · `export-v6` · `export-v7` · `export-v7-replay-inputs` · `fetch-functional-results-golden` · `measure-deepseek-only-variance` · `regenerate-report` · `count-qr-…` | 1 إلى 1.5 |
| إعادة توليد 7 عيّنات ذهبية + حرّاسها + تصنيف الحارس الشامل | 6 مولّدات + 7 عيّنات + حرّاس `v6/v7ReportsDocument*` + `goldenFixturesGuardCoverage.test.js` | 1 إلى 1.5 |
| القواعد + اختبارات المحاكي §٨-١ و٨-٢ | `firestore.rules` · `rules-test/firestore.rules.test.js` (أو ملفّ مجاور) | 1 إلى 1.5 |
| اختبارات وحدة + e2e بالمحاكي (§٨-٣) | ≈ 3 ملفّات جديدة + تعديل e2e القائمة | 1 إلى 1.5 |
| سكربت الترحيل + اختباره بالمحاكي | سكربت جديد + اختباره | 2 إلى 3 |
| التوثيق | `V7_DISPLAY_SHAPE_CONTRACT.md` · `golden/README.md` · `FIRESTORE_INDEXES.md` إن تغيّرت الفهارس | 0.5 |
| **المجموع بلا خيار** | ≈ 20 إلى 25 ملفّاً | **7 إلى 11 يوماً** |
| **+ خيار (ب)** (دالّة `getReportRaw` عند الطلب) | دالّة + اختبار | +1 |
| **+ ن٢** (إسقاط عامّ) | مشغّل + مجموعة + فهرس + ترحيل + الموقع | +3 إلى 4 (الباك اند) + الموقع |
| **+ ن٤** (`getShopListings`) | دالّة + حدّ معدّل + اختبار + الموقع | +1.5 إلى 2 (الباك اند) + الموقع |

**ما لا تشمله:** عمل وكيلَي التطبيق والموقع (نسخ العيّنات الذهبية، وتعديل صفحة الإدارة، وصفحة المتجر)، وأيام المستخدم (النشر، وتشغيل الترحيل، وقراءة تقاريره). **الأرقام تخمين مهنيّ**؛ لا قياس سابق لعمل مماثل في المستودع.

---

## ١١ · الأسئلة المفتوحة للمستخدم — كلٌّ بخياراته

1. **(التعارض في نصّ القرار) من يقرأ الخامّ؟**
   - **(أ)** المالك والخادم: قاعدة قراءة للمالك. لا دالّة جديدة؛ تُنسَخ `userId` إلى مستند الخامّ؛ **يصل خامّ جهاز الزبون إلى متصفّح صاحب المحل**؛ قناة بلا مستهلك اليوم.
   - **(ب)** الخادم وحده: لا قاعدة. دالّة `getReportRaw` تُبنى عند ظهور حاجة. **والمشرف يبقى قارئاً بالقاعدة الشاملة** في Firestore (إلا م٣). (§٤)
2. **موضع الخامّ:** م٢ مجموعة مستقلّة (مقترحي) · م١ مستند فرعي · م٣ Storage (ينفي قراءة المشرف بالقواعد، يفقد الذرّية والاستعلام، ولا يناسب (أ)). (§٣)
3. **`:65-66`:** ن٠ تبقى · ن١ تُحذف · ن٢ إسقاط عامّ · ن٣ غير مجهول فقط · ن٤ دالّة. **الجرد يقول** (§٥-٢): لا قارئ معروف يحتاجها لغير المالك، وصفحة المتجر لا تبلغها لغير صاحبها بحسب ملفّ الفحص — فن١ هي الأرخص إن أكّد المستخدم أنّ المتجر العلني لعارض غريب غير مقصود اليوم؛ وإن كان مقصوداً فن٢/ن٤. (§٥)
4. **نطاق «لا يحمل إلا ما يعرضه»:** (أ) الخامّ + الجذور الأربعة فقط (نصّ القرار) · (ب) **ويضاف `aiAudit`** (≈ 1.1 إلى 13.8 KB، لا قارئ خادمي ولا عميل معروف — §٢-٢ — قرارا 4 و6 في `V7_DISPLAY_SHAPE_CONTRACT.md:450` «يُحفَظ ولا يُعرض») · (ج) **وأيضاً** العشرة التي لا قارئ عميل معروفاً لها: `deviceFingerprint` و`fieldsVersion` و`appVersion` و`aiAudit` و`aiDurationMs` و`aiFallbackReason` و`scoringEngine` و`v5Metrics` و`serverSamplesStoragePath` و`serverSamplesSaved` (ولا أنقل `aiModel` و`analyzedAt` و`language` و`isFreeTrial`: يفكّكها Gson في التطبيق، §٢-٢). **سؤال خاصّ:** `fieldsVersion` و`appVersion` مرآة «كل التقارير بإصدار حقول 65» (`analyzeDevice.js:635-637` تعليق) — تبقى للاستعلام أم تنتقل (والمشرف يستعلم الخامّ بالقاعدة الشاملة)؟
5. **ارتباط الحمولة fv68 بالترحيل:** يُحجَب إصدار التطبيق حتى `--verify` = 0 (اقتراح) · أو يكفي ١ و٢ (التقارير الجديدة محمية). (§٩-٦)
6. **`evaluations`:** تُنسخ منها `timeSeriesStoragePath` و`deviceFingerprintSha` و`sessionId` إلى مستند يقرؤه المالك (`rules:88-92`). تبقى (للربط بالتدريب) · أو تُحجَب عن العميل بنقلها هي أيضاً. (§٤-٣-٣)
7. **صفحة إدارة الموقع (`admin/reports/page.js:533` تعرض المستند كاملاً):** تعرض الخامّ بعد النقل بقراءة `reportRaw` (تعديل في الموقع؛ المشرف يقرؤها بالقاعدة الشاملة) · أو لا تعرضه (يبقى في المستند `<details>` «البيانات الخام (JSON)» ما يبقى، س:137). **وملاحظة:** `admin/page.js` يحفظ عشرة مستندات كاملة في `sessionStorage` خمس دقائق (س:149) — بعد النقل يخرج الخامّ منها تلقائياً. 
8. **ثغرتان محتملتان في الأساس، لم أتحقّق منهما (لا وحدة تحكّم):**
   - هل مزوّد «بريد/كلمة مرور» مفعّل في Authentication، وهل التسجيل مفتوح؟ (يحسم قيمة ن٣ ومخاطر `isAdmin()` بلا `email_verified`، §٤-٣-٢.)
   - هل تُفرض Firebase App Check على قراءة Firestore من الموقع؟ (لا أثر له في الكود هنا.)
9. **النسخة الاحتياطية للترحيل:** JSONL محلّي فقط (إلزامي) · + تصدير Firestore المُدار (كلفة وحاوية) · ومدّة الاحتفاظ بها (تحمل معرّفات خامّة لتقارير قديمة محتملة).
10. **ترتيب الترحيل:** المعروضة للبيع أولاً (مقترحي) · أو دفعة واحدة.
11. **اسم المجموعة:** `reportRaw` (مقترح) · غيره.

---

## ١٢ · ما لم أتحقّق منه

- **كل ما في التطبيق والموقع** (§٢، §٥-٢، §٦-٤): منقول من ثلاثة ملفّات للمنسّق، غير متحقَّق عندي. **وحدود الكشّاف بنصّه** (س:15-18): لم يتحقّق من الشجرة غير الملتزمة، ولم يبحث في `scripts/` و`docs/` و`contract/` في الموقع ولا `src/test/` و`ReportScreen.kt` و`ReportPdfGenerator.kt` في التطبيق، ولم يتتبّع عرض حقول التطبيق داخل الشاشات (س:184,204). فـ«لا قارئ معروف» في §٢-٢ **ليست «لا قارئ»**.
- **عدد التقارير في الإنتاج، والمعروض منها، وحجم أكبرها، وما فيه معرّفات خامّة:** لا شبكة (القاعدة 9)؛ يعطيه التشغيل الجافّ بيد المستخدم.
- **سلوك إعفاء الفهرسة على حقل خريطة وأبنائه، وكلفة الفهرسة التلقائية للورقة:** غير متحقَّق، غير مقيس.
- **إعدادات Authentication** (مزوّد المجهول مفعَّل — استنتاج من الكود فقط؛ مزوّد البريد وكلمة المرور؛ التحقّق من البريد).
- **أسعار Firestore/Storage:** لم أقدّر كلفة مالية — لا مصدر مُتحقَّق منه هنا.
- **المحاكي:** لم أشغّله؛ هذه وثيقة تصميم.
- **A23** (§١-٣).

---

## ملحق · جرد الخادم بالملفّ والسطر عند `6a26163`

**الطريقة** (مولَّدة بسكربت `node` مؤقّت في مجلّد الجلسة، غير ملتزَم): ملفّات `.js` و`.rules` **المتتبَّعة** (`git ls-files`)، بلا أيّ مسار يبدأ بـ`functions/test/fixtures` (بادئة فضفاضة؛ تعطي 294 ملفّاً، وبالبادئة بشرطة مائلة 295)؛ تطابق كلمة كاملة (`rawFingerprint` لا `rawFingerprintForAi`)؛ سطر **التعليق** = ما يبدأ بـ`//` أو `*` أو `/*` بعد المسافات؛ أعداد الفئات للشيفرة وحدها، وأسطر التعليق منفصلة. التصنيف: `SRC` = `functions/src` و`functions/index.js`؛ `SCRIPT` = `functions/scripts`؛ `TEST` = `functions/test` و`rules-test`؛ `RULES` = `*.rules`.

**المقارنة بجرد المنسّق** (`report-raw-readers-inventory-2026-10-08.txt:78-358`، عند `0e2ce2d`): **مطابق في كل عدد** — `rawFingerprint` و`sessionId` و`deviceFingerprintSha` و`timeSeriesStoragePath` (كل الفئات وأسطر التعليق وعدد ملفّات الاختبار) و`userId` في `src` و`script` و`test` و`comment` — **عدا فرق واحد:** `userId` في `RULES`: **5 عندي، 3 عنده.** الاثنان الزائدان `storage.rules:7,10` (`{userId}` **متغيّر مسار** لـ`/shops/{userId}/logo.jpg`، لا حقل تقرير)؛ جرده يقتصر على `firestore.rules` (`:62,70,97`، أي قاعدة التقارير `:62,70` وقاعدة الدفعات `:97`). **ولا أثر للفرق على الاستنتاج.** وكذلك `sessionId` في `RULES` = `firestore.rules:130` متغيّر مسار لـ`/scanSessions/{sessionId}` لا حقل تقرير. (مستودعا التطبيق والموقع: لا جرد لي، §٦-٤.)


### الأعداد وقوائم الأسطر (مخرَج السكربت حرفياً)

```
scanned files=294
-- rawFingerprint: src=29 script=39 rules=0 other=0 test=55 (in 14 files) comment-lines=62
-- userId: src=44 script=12 rules=5 other=0 test=70 (in 12 files) comment-lines=24
-- sessionId: src=16 script=17 rules=1 other=0 test=44 (in 10 files) comment-lines=35
-- deviceFingerprintSha: src=8 script=21 rules=0 other=0 test=23 (in 8 files) comment-lines=20
-- timeSeriesStoragePath: src=9 script=24 rules=0 other=0 test=26 (in 8 files) comment-lines=23
```

### `rawFingerprint`

- **SRC** (29 سطراً في 9 ملفّاً):
  - `functions/src/admin/runConsistencyTest.js`: 225، 229، 237، 272، 281، 282، 320، 446
  - `functions/src/analysis/analyzeDevice.js`: 274
  - `functions/src/analysis/buildV7Payload.js`: 449
  - `functions/src/analysis/callAI.js`: 209
  - `functions/src/analysis/rehydrateReportSamples.js`: 73، 74، 76، 139
  - `functions/src/evaluations/evaluationContract.js`: 110
  - `functions/src/lab/layer1/index.js`: 29
  - `functions/src/lab/layer3/utils/tier_lookup.js`: 61، 64
  - `functions/src/prompts/systemPromptV6.js`: 46، 51، 127، 141، 143، 147، 181، 202، 203، 738
- **SCRIPT** (39 سطراً في 9 ملفّاً):
  - `functions/scripts/audit-device-profiles-readonly.js`: 190، 191، 192، 193
  - `functions/scripts/export-v6-report-readonly.js`: 118، 119، 121، 126
  - `functions/scripts/export-v7-replay-inputs-readonly.js`: 170
  - `functions/scripts/export-v7-report-readonly.js`: 169، 173
  - `functions/scripts/fetch-functional-results-golden.js`: 103، 107، 128
  - `functions/scripts/generate-v6-reports-document-sample.js`: 64، 65، 117، 119، 121، 122، 135، 137، 143، 165، 166، 167
  - `functions/scripts/measure-deepseek-only-variance.js`: 237، 239، 258
  - `functions/scripts/measure-v6-vs-v7-payload.js`: 102
  - `functions/scripts/regenerate-report.js`: 84، 301، 303، 312، 317، 318، 319، 320، 321
- **RULES:** لا شيء.
- **TEST** (55 سطراً في 14 ملفّاً):
  - `functions/test/auditDeviceProfilesReadonly.test.js`: 1
  - `functions/test/buildV7Payload.test.js`: 1
  - `functions/test/evaluation_linkage.e2e.test.js`: 1
  - `functions/test/exportV6ReportReadonly.test.js`: 15
  - `functions/test/exportV7ReplayInputsReadonly.test.js`: 3
  - `functions/test/exportV7ReportReadonly.test.js`: 8
  - `functions/test/goldenFixturesGuardCoverage.test.js`: 1
  - `functions/test/runConsistencyTestAnalyzedAtMs.test.js`: 1
  - `functions/test/sampleInputsFromRaw.test.js`: 2
  - `functions/test/serverRawSamplesStorage.test.js`: 3
  - `functions/test/session_evaluation.e2e.test.js`: 1
  - `functions/test/submit_evaluation.e2e.test.js`: 1
  - `functions/test/v6ReportsDocumentContractGuard.test.js`: 15
  - `functions/test/v7ProfileAndEvaluationBranching.test.js`: 2
- **أسطر التعليق** (لا قارئ ولا كاتب): 62.

### `userId`

- **SRC** (44 سطراً في 11 ملفّاً):
  - `functions/src/analysis/analyzeDevice.js`: 264، 361، 376، 379، 414، 495، 680، 703
  - `functions/src/evaluations/resolvePendingEvaluation.js`: 54، 55، 57
  - `functions/src/evaluations/submitEvaluation.js`: 261
  - `functions/src/notifications/sendNotificationEmail.js`: 21، 23، 43، 79، 85 — *غير مستند التقرير (مجال آخر)*
  - `functions/src/payments/confirmPayment.js`: 60، 72، 79، 117، 122 — *غير مستند التقرير (مجال آخر)*
  - `functions/src/payments/rejectPayment.js`: 38، 47، 92، 97 — *غير مستند التقرير (مجال آخر)*
  - `functions/src/payments/requestPayment.js`: 26 — *غير مستند التقرير (مجال آخر)*
  - `functions/src/reports/generateReportPdf.js`: 113
  - `functions/src/sessions/createScanSession.js`: 65، 66، 69، 114 — *غير مستند التقرير (مجال آخر)*
  - `functions/src/users/redeemPromoCode.js`: 27، 40، 72، 107، 118، 127، 168، 173 — *غير مستند التقرير (مجال آخر)*
  - `functions/src/users/registerUser.js`: 20، 26، 30، 57 — *غير مستند التقرير (مجال آخر)*
- **SCRIPT** (12 سطراً في 9 ملفّاً):
  - `functions/scripts/audit-scan-charge-race-readonly.js`: 268، 279
  - `functions/scripts/export-v6-report-readonly.js`: 114
  - `functions/scripts/generate-v6-reports-document-sample.js`: 60، 113
  - `functions/scripts/generate-v7-reports-document-sample-cpu-c06-downgrade.js`: 205
  - `functions/scripts/generate-v7-reports-document-sample-honor.js`: 198
  - `functions/scripts/generate-v7-reports-document-sample-security-downgrade.js`: 217
  - `functions/scripts/generate-v7-reports-document-sample-zero-measured.js`: 314
  - `functions/scripts/generate-v7-reports-document-sample.js`: 226، 287
  - `functions/scripts/regenerate-report.js`: 83
- **RULES** (5 سطراً في 2 ملفّاً):
  - `firestore.rules`: 62، 70، 97
  - `storage.rules`: 7، 10 — *غير مستند التقرير (مجال آخر)*
- **TEST** (70 سطراً في 12 ملفّاً):
  - `functions/test/auditScanChargeRaceReadonly.test.js`: 2
  - `functions/test/evaluation_linkage.e2e.test.js`: 2
  - `functions/test/exportV6ReportReadonly.test.js`: 2
  - `functions/test/exportV7ReplayInputsReadonly.test.js`: 4
  - `functions/test/exportV7ReportReadonly.test.js`: 1
  - `functions/test/piiLogGuardSeeded.test.js`: 49
  - `functions/test/qr_report_idempotency.e2e.test.js`: 2
  - `functions/test/session_billing.e2e.test.js`: 2
  - `functions/test/session_evaluation.e2e.test.js`: 3
  - `functions/test/submit_evaluation.e2e.test.js`: 1
  - `functions/test/subscription_expiry.e2e.test.js`: 1
  - `functions/test/v6ReportsDocumentContractGuard.test.js`: 1
- **أسطر التعليق** (لا قارئ ولا كاتب): 24.

### `sessionId`

- **SRC** (16 سطراً في 4 ملفّاً):
  - `functions/src/analysis/analyzeDevice.js`: 292، 349، 364، 366، 683، 706، 708، 716
  - `functions/src/evaluations/submitEvaluation.js`: 71، 73، 74، 295
  - `functions/src/sessions/createScanSession.js`: 127 — *غير مستند التقرير (مجال آخر)*
  - `functions/src/sessions/joinScanSession.js`: 29، 74، 94 — *غير مستند التقرير (مجال آخر)*
- **SCRIPT** (17 سطراً في 11 ملفّاً):
  - `functions/scripts/count-qr-session-timeseries-storage-readonly.js`: 130
  - `functions/scripts/export-session-evaluation-readonly.js`: 194، 197، 203، 261، 264
  - `functions/scripts/export-v6-report-readonly.js`: 115
  - `functions/scripts/generate-v6-reports-document-sample.js`: 61، 113
  - `functions/scripts/generate-v7-reports-document-sample-cpu-c06-downgrade.js`: 211
  - `functions/scripts/generate-v7-reports-document-sample-honor.js`: 215
  - `functions/scripts/generate-v7-reports-document-sample-security-downgrade.js`: 223
  - `functions/scripts/generate-v7-reports-document-sample-zero-measured.js`: 317
  - `functions/scripts/generate-v7-reports-document-sample.js`: 243
  - `functions/scripts/regenerate-report.js`: 83
  - `functions/scripts/verify-scansessions-rules-postdeploy-readonly.js`: 176، 177
- **RULES** (1 سطراً في 1 ملفّاً):
  - `firestore.rules`: 130
- **TEST** (44 سطراً في 10 ملفّاً):
  - `functions/test/ai_failure_behavior.e2e.test.js`: 1
  - `functions/test/evaluation_linkage.e2e.test.js`: 6
  - `functions/test/exportSessionEvaluationReadonly.test.js`: 4
  - `functions/test/exportV6ReportReadonly.test.js`: 2
  - `functions/test/exportV7ReplayInputsReadonly.test.js`: 3
  - `functions/test/exportV7ReportReadonly.test.js`: 1
  - `functions/test/qr_report_idempotency.e2e.test.js`: 2
  - `functions/test/session_billing.e2e.test.js`: 6
  - `functions/test/session_evaluation.e2e.test.js`: 18
  - `functions/test/v6ReportsDocumentContractGuard.test.js`: 1
- **أسطر التعليق** (لا قارئ ولا كاتب): 35.

### `deviceFingerprintSha`

- **SRC** (8 سطراً في 2 ملفّاً):
  - `functions/src/analysis/analyzeDevice.js`: 270، 627، 631، 632، 680
  - `functions/src/evaluations/evaluationContract.js`: 67، 96، 117
- **SCRIPT** (21 سطراً في 8 ملفّاً):
  - `functions/scripts/export-v6-report-readonly.js`: 116
  - `functions/scripts/generate-v6-reports-document-sample.js`: 62، 114
  - `functions/scripts/generate-v7-reports-document-sample-cpu-c06-downgrade.js`: 191، 192، 206
  - `functions/scripts/generate-v7-reports-document-sample-honor.js`: 177، 178، 201
  - `functions/scripts/generate-v7-reports-document-sample-security-downgrade.js`: 203، 204، 218
  - `functions/scripts/generate-v7-reports-document-sample-zero-measured.js`: 302، 303، 314
  - `functions/scripts/generate-v7-reports-document-sample.js`: 200، 201، 202، 229، 288
  - `functions/scripts/regenerate-report.js`: 84
- **RULES:** لا شيء.
- **TEST** (23 سطراً في 8 ملفّاً):
  - `functions/test/evaluation_linkage.e2e.test.js`: 2
  - `functions/test/exportSessionEvaluationReadonly.test.js`: 3
  - `functions/test/exportV6ReportReadonly.test.js`: 3
  - `functions/test/exportV7ReportReadonly.test.js`: 1
  - `functions/test/report_training_links.e2e.test.js`: 7
  - `functions/test/session_evaluation.e2e.test.js`: 1
  - `functions/test/submit_evaluation.e2e.test.js`: 5
  - `functions/test/v6ReportsDocumentContractGuard.test.js`: 1
- **أسطر التعليق** (لا قارئ ولا كاتب): 20.

### `timeSeriesStoragePath`

- **SRC** (9 سطراً في 3 ملفّاً):
  - `functions/src/analysis/analyzeDevice.js`: 271، 631، 681
  - `functions/src/analysis/rehydrateReportSamples.js`: 100، 131، 133
  - `functions/src/evaluations/evaluationContract.js`: 66، 95، 116
- **SCRIPT** (24 سطراً في 10 ملفّاً):
  - `functions/scripts/count-qr-session-timeseries-storage-readonly.js`: 131، 136
  - `functions/scripts/export-v6-report-readonly.js`: 117
  - `functions/scripts/generate-v6-reports-document-sample.js`: 63، 114
  - `functions/scripts/generate-v7-reports-document-sample-cpu-c06-downgrade.js`: 192، 206
  - `functions/scripts/generate-v7-reports-document-sample-honor.js`: 178، 202
  - `functions/scripts/generate-v7-reports-document-sample-security-downgrade.js`: 204، 218
  - `functions/scripts/generate-v7-reports-document-sample-zero-measured.js`: 208، 303، 314
  - `functions/scripts/generate-v7-reports-document-sample.js`: 201، 230، 289
  - `functions/scripts/measure-deepseek-only-variance.js`: 341، 342، 345، 346
  - `functions/scripts/regenerate-report.js`: 84، 287، 472
- **RULES:** لا شيء.
- **TEST** (26 سطراً في 8 ملفّاً):
  - `functions/test/evaluation_linkage.e2e.test.js`: 4
  - `functions/test/exportSessionEvaluationReadonly.test.js`: 2
  - `functions/test/exportV6ReportReadonly.test.js`: 2
  - `functions/test/report_training_links.e2e.test.js`: 7
  - `functions/test/sampleInputsFromRaw.test.js`: 3
  - `functions/test/session_evaluation.e2e.test.js`: 2
  - `functions/test/submit_evaluation.e2e.test.js`: 5
  - `functions/test/v6ReportsDocumentContractGuard.test.js`: 1
- **أسطر التعليق** (لا قارئ ولا كاتب): 23.


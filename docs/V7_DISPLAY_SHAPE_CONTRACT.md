# عقد شكل العرض V7 — `buildDisplayShapeV7`

**المستودع:** `neuralcheck-backend`
**المصدر:** `functions/src/analysis/buildDisplayShapeV7.js`
**الحالة: حيّ منذ التبديل (fd3a6ce، 2026-09-23 +03).** `runAnalysisInternal.js` يستدعي `resolveV7Report` (→ `callAIv7`) كمصدر حيّ وحيد — `callAI` (V6) لم يعد يُستدعى إطلاقاً (كود V6 لم يُحذف، فقط غير قابل للوصول). هذا العقد يصف ما **يُنتجه** المسار فعلياً اليوم.

~~**الوصف القديم — مُبقًى موسوماً (القاعدة 8):** الحالة: غير حيّ بعد. `runAnalysisInternal.js:300` ينادي `callAI` (V6) لا `callAIv7` — هذا العقد يصف ما سينتجه المسار حين يُبدَّل (بعد معايرة الحارس وإعادة النداءين، PLAN-01-ROADMAP.md §🔒 البند ١٧)، لا ما يصل المستخدم اليوم.~~
**تاريخ الكتابة:** 2026-09-21 +03. **مصدر القرارات:** `PLAN-01-ROADMAP.md` §🔒 «قرارات شكل الاستجابة» (القرارات ١-١٨).
**آخر تحديث:** 2026-09-21 +03 — إضافة §٠ (قُرّاء الشكل، القاعدة 25). القرارات ٢٣/٢٤/٢٥ (`verifyReport` قائمة بيضاء V7 · `buyerAdvice` ثلاثة حقول · إسقاط `predicted_problems`). §٣ (`display.narrative`) و§٨-أ (جديد) هما موضع التغيير عند تلك الجلسة. ~~⚠️ **§٣ و§٨-أ لم يُحدَّثا بعد** ليعكسا عمل جلسة إضافة §٠ (`pipelineTags.js`، A103-A106، توسيع قائمة `verifyReport` البيضاء إلى الشكل الكامل) — راجع «ملاحظة نطاق» في نهاية §٠.~~
**تحديث لاحق 2026-09-21 +03 (جلسة منفصلة، بند صريح من المنسّق: "§٣ و§٨-أ في العقد — تُحدَّث الآن"):** الجملة المشطوبة أعلاه لم تعد صحيحة — §٣ و§٨-أ حُدِّثا فعلاً (راجع «تحديث» تحت §٣ · display.narrativeIncomplete/narrativeIncompleteFields، وراجع §٨-أ كاملاً — الوصف القديم «ثمانية حقول و45 تحقّقاً» موسوم لا محذوف، مُستبدَل بالشكل الكامل و85 تحقّقاً `verifyReportV7Whitelist.test.js` مُتحقَّقاً بتشغيل فعلي: `node functions/test/verifyReportV7Whitelist.test.js` → `85/85 assertions passed`). أُبقيت الجملة الأصلية مشطوبة بدل حذفها (القاعدة 8).

**تحديث لاحق 2026-09-21 +03 (مهمّة منفصلة أخرى، القرار ٣٤ + القاعدة 25 — الحارس ثنائي الاتّجاه):** إضافة `functions/src/analysis/v7ContractFieldMap.js` (مصدر واحد مُصدَّر لقائمة حقول العقد، القاعدة 24) و`functions/test/v7ContractFieldsGuard.test.js` (يقارنها بمخرَج خط الأنابيب الفعلي في الاتّجاهين معاً — `130/130 assertions passed`). تحديث §٠ (قائمة حقول V7 التي يقرؤها التطبيق فعلياً تحت القارئ ٣) و§٣ (توضيح تجانس `indicators`/`issues[].evidence`/حضور مفاتيح `overall`/`categories.battery` دائماً) و§١٠ (تصحيح عددين انحرفا — `buildDisplayShapeV7.test.js` 254←255، `buildV7Payload.test.js` 88←110 — غير ناتجين عن هذه المهمّة، مُسجَّلان لا مُصلَحان). راجع تقرير هذه المهمّة تحت «الفرق بين ما أُمرت به وما فعلت» لتفصيل تناقض واحد بين نصّ أمر المهمّة والوثيقة القائمة (القاعدة 14).

**تحديث لاحق 2026-09-22 +03 (مهمّة وثائقية محدودة — سؤال من وكيل `wepsite` عن شكل `adjustmentEvidence`/`adjustmentReason` الحقيقي، القاعدة 5/29):** إضافة إلى §٣ تحت جدول `display.categories.<category>` — تتبّع كامل بـ`file:line` من `applyV7Adjustments` (`buildV7Payload.js`) عبر `buildDisplayShapeV7.js` إلى `buildV7ResponseForStorage` (`analyzeDevice.js`)، يُثبت أن `adjustmentEvidence` مصفوفة **نصوص مسار كود داخلية خام غير محلولة** (مثل `"categoryStates.categories.cpu.deterministicLetter"`) تصل فعلاً `display`/التخزين/العميل حين `letterSource==="LLM_ADJUSTED"` — لا نصّاً بشرياً، ولا قيماً محلولة. عيّنة حيّة حقيقية واحدة من `functions/scripts/out/v7-live-34dff2b8-*.json` (تعديل رُفض فعلياً — `EVIDENCE_NOT_PROVEN`) + عيّنة ثانية **مُصطنَعة** جديدة (`functions/test/fixtures/golden/v7-client-payload-sample-llm-adjusted.json`، تعديل واحد مُصطنَع على `storage` بدليل حقيقي — `deterministicLetter="C"` — بلا نداء نموذج ولا قيمة قياس مُختلَقة) تُظهِر أوّل مثال في هذا المستودع لحالة `LLM_ADJUSTED` فعلية بانخفاض حرف مرئي (C→D). لا تعديل على أي كود — وثائقي/بيانات فقط. راجع الإضافة الكاملة تحت §٣ للتفصيل، وتقرير المهمّة لسبب اختيار `storage` تحديداً.

**تحديث لاحق 2026-09-22 +03 (مهمّة منفصلة أخرى — سدّ فجوة §٣ "مستوى الشحن لكل مؤشّر"):** الفقرة "⚠️ فرق موثَّق عن نصّ الخطّة" تحت جدول `categories.battery` في §٣ (كانت مُشار إليها بالسطر `:199` في نصّ أمر هذه المهمّة — **انحرفت إلى `:249` فعلياً عند بداية هذه الجلسة**، تحقّق مباشر بالأداة، نفس نمط انحراف الأسطر الموثَّق أعلاه — القاعدة 2) **مُوسَمة محلولة الآن** (القاعدة 8: لا حذف). `batteryLayer.js` صار يُرفِق `socAtWindowStart`/`socAtWindowEnd` (خام من `lvl[]`، بلا تحويل — القاعدة 20) على كل مؤشّر من الأربعة، كنطاق نافذة العيّنات المُستعملة فعلاً في حسابه — لا نقطة `socAtStart` مفردة كما ورد حرفياً في نصّ الخطّة (تحقّق مباشر: **لا مؤشّر من الأربعة نقطة عيّنة واحدة** فعلياً — BAT-THERMAL-EFF/BAT-COULOMB نافذتاهما الفحص كاملاً 0..n-1 حرفياً، BAT-R-APPARENT/BAT-FCC أضيق. راجع التفصيل حقلاً حقلاً تحت جدول `indicators` في §٣ أدناه، ورأس `functions/src/analysis/batteryLayer.js`). صفر تعديل لزم في `buildDisplayShapeV7.js`/`analyzeDevice.js`/`verifyReport.js`/`v7ContractFieldMap.js` (الحقلان يقعان داخل الكائن المُبهَم `indicators.<ID>` نفسه، تمريرة كاملة في الأربعة — القرار ٢٥، راجع §٠ أدناه). مُتحقَّق بتشغيل فعلي: `node functions/test/batteryLayer.test.js` → `61/61 assertions passed` (كان 24/24 قبل هذه المهمّة)، وكل اختبارات خطّ الأنابيب المتأثّرة (`v7ContractFieldsGuard.test.js`/`buildDisplayShapeV7.test.js`/`categoryStates.test.js`/إلخ) بلا تغيير في عددها — راجع تقرير هذه المهمّة.

**تحديث لاحق 2026-10-01 +03 (S6، أمر مستخدم — "الحذف عند الإرجاع وحده"):** `narrative.details`/`narrative.verdict` تُحذَفان الآن من ردّ العميل V7 في موقعين (`analyzeDevice.js`: دالّة جديدة `stripNarrativeDetailsVerdictFromV7Response`، و`verifyReport.js`: `buildV7Response` لم يَعُد يطلبهما عبر `pickNarrative`) — **المستند المخزون بلا أي مساس**، أوّل انفراط فعلي لمبدأ "سطحان لا ثلاثة" منذ كتابة هذا العقد، وعلى `narrative` وحدها. تحديث §٣ (`display.narrative`، فقرة جديدة) و§٨-أ (تحديث الجدول) و`v7ContractFieldMap.js` (`NARRATIVE_RETURNED_FIELDS` جديد بجانب `NARRATIVE_FIELDS` المخزون بلا تغيير) و`v7ContractFieldsGuard.test.js` (§٦ جديد يحرس الشكل العائد فعلياً، `stripNarrativeDetailsVerdictFromV7Response` الحقيقية نفسها لا نسخة منطق). V6 بلا أي مساس. راجع تقرير هذه المهمّة.

**تحديث لاحق 2026-10-01 +03 (S1-S5، أمر مستخدم — بطاقات السقف/عناوين الملاحظات/رموز التعطّل/نصّ سقف الفئة/تعليمات النموذج):** نصوص عرض جديدة بالكامل — `overall.governingGateReason.text` وcategories.<cat>.letterCeilingReason.text (مُعاد صياغته) وoverall.harnessErrorMessage (حقل جديد) — بلا اسم بوّابة ولا معرّف اختبار ولا مصدر خامّ. categoryStates.js:buildDeterministicIssues (S2) issues[].title صار "<تنبيه|فشل|غير مقيس|لا أعطاب> — <اسم الفئة بالعربية>" (testId يبقى في id فقط). CATEGORY_NAME_AR/TR نُقلا إلى utils/categories.js (مصدر واحد، القاعدة 24) — gps: "الموقع (GPS)" لا "نظام تحديد المواقع". systemPromptV7.js (S5): منع مطلق لذكر معرّف اختبار/اسم بوّابة/كلمة "الحمولة" في نثر النموذج (عكس السماح السابق)، ومنع حكم صحّي لفئة بلا حرف، وحكم من قياس غير معايَر، وذكر تخفيض مقترح من النموذج نفسه، وتسمية gpu_fps "معدّل إطارات"، وأرقام دقّة/عدد الكاميرا. صفر تغيير حرف على كل العيّنات الذهبية العشر (مُتحقَّق بالأداة).

**تحديث لاحق 2026-10-01 +03 (تطبيق قرار «قرارات الملفّ PENDING-FOR-PLANNING»، القسم ٥، ثم الالتزام):** تصحيحات على نصوص S1-S5 أعلاه قبل الالتزام — S-1/S-5/S-6/S-7: حُذفت "في هذا الإصدار" (لم تكن قيداً مؤقّتاً فعلياً لهذه الأربعة). S-2: الرقم (36 شهراً) صار يُقرأ من ثابت مُصدَّر `PATCH_AGE_MAX_MONTHS` (categoryStates.js:96) لا حرفياً في النصّ. S-4: نصّ `BATTERY_MAX_ONE_BAND` استُبدل بالكامل. S-3 بقي بلا تغيير (قرار صريح: "في هذا الإصدار" صادقة هناك). S-13: `HARNESS_ERROR_MESSAGE_AR` (categoryStates.js:184) صار "تعذّر تجهيز نتائج الاختبارات لهذا الفحص، وهذا ليس حكماً على الجهاز." ليطابق النصّ الاحتياطي المعتمَد للموقع (W6) — بقراءة المنسّق لكلمة "يطابق"، لا نصّ مستخدم حرفي بعينه لهذا الحقل. **أسماء الفئات** (CATEGORY_NAME_AR/TR، utils/categories.js:52-66): خمس قيم عربية (storage/thermal/memory/gpu/input) وأربع تركية (thermal/storage/gps/input) كانت مختلفة عن القرار المُعتمَد — صُحِّحت لتطابقه حرفياً. **ملحق verifyReport** (جديد، خارج نطاق S1-S5 الأصلي): `overall.harnessErrorMessage` أُضيف إلى القائمة البيضاء في `verifyReport.js:335` (كان غائباً عن ردّ `/verifyReport` رغم وجوده في `display`/`analyzeDevice`). راجع تقرير هذه المهمّة للجدول الكامل بكل نصّ نهائي وموضعه، وجدول حروف قبل/بعد (صفر تغيير، 10 عيّنات).

---

## ٠ · قُرّاء شكل `display` — إلزامي (القاعدة 25)

**هذا القسم ليس توثيقاً وصفياً بل قائمة إلزام.** القاعدة 25 (أُضيفت إلى `CLAUDE.md` بسبب هذا القسم بالذات): «كل طبقة تقرأ شكلاً خارجياً بأسماء ثابتة — قائمة بيضاء، تفكيك، مخطَّط — تُعلن ما طلبته ولم تجده. ولا يُقبل شكل جديد إلا بتحديث كل قارئ له، مُعدَّداً في العقد.» **أربعة قُرّاء اليوم.** أي تغيير على `display` (§٣) يوجب المرور على الأربعة قبل الدمج — لا وصفاً بعد الحقيقة، بل شرطاً قبلها.

### ١. `analyzeDevice` — الإرجاع (يصل التطبيق عبر RPC) + التخزين (مستند `reports`)

~~- **الإرجاع**: `functions/src/analysis/analyzeDevice.js:514-516`.~~
~~- **التخزين** (`reportRef.set({aiResponse: ...})`): `functions/src/analysis/analyzeDevice.js:360-378` (`aiResponseToSave`)، مبنيّ عبر `buildV7ResponseForStorage` (`analyzeDevice.js:41-73`).~~
~~- **متطابقان على فرع V7**... مُتحقَّق بتشغيل فعلي عبر محاكي Firestore (`aiAuditWiring.e2e.test.js`، 22/22 تحقّقاً — كان 8 قبل هذه الجلسة).~~

⚠️ **تحديث 2026-09-21 +03 (القرار ٤٢، جلسة لاحقة) — أرقام السطور أعلاه كانت** *بالفعل* **قديمة قبل بداية هذه الجلسة** (منقولة حرفياً من تقرير مهمّة سابقة، لا مُعاد اشتقاقها بالأداة عند كل تحديث — بالضبط ما تحذّر منه القاعدة 2). تحقّق مباشر بـ`grep`/قراءة الملفّ عند بداية هذه الجلسة أظهر القيم الحقيقية عندها `:605-607`/`:106-155` (لا `:514-516`/`:360-378`/`:41-73`) — وبعد تعديلات هذه الجلسة نفسها (القرار ٤٢ البنود ٣/٥: حقول `letterSource`/`adjustmentReason`/`adjustmentEvidence` على `buildCategoryEntryForStorage`، وبناء الإرجاع من `V7_OPERATIONAL_FIELDS` بدل أربعة أسطر حرفية) انحرفت مجدداً. **القيم أدناه مُشتقّة بالأداة الآن (`grep -n`) في نهاية هذه الجلسة تحديداً — ستنحرف هي نفسها مع أي تعديل لاحق؛ لا تُعتمَد كثابتة، تحقّق دائماً بالأداة:**

- **الإرجاع**: `functions/src/analysis/analyzeDevice.js:641-643` (`return (pipeline === V7_PIPELINE_TAG) ? {...aiResponseToSave, ...operationalExtras} : {...aiResult, shortId}`) — `operationalExtras` مبنيّة من `V7_OPERATIONAL_FIELDS` (`analyzeDevice.js:638-640`)، لا أربعة حقول حرفية بمعزل عنها (v7OperationalFields.js — راجع §٠-٣ أدناه).
- **التخزين** (`reportRef.set({aiResponse: ...})`): `functions/src/analysis/analyzeDevice.js:449-451` (`aiResponseToSave`)، مبنيّ عبر `buildV7ResponseForStorage` (`analyzeDevice.js:120-169`، وليس `:41-73` — تلك أرقام `buildCategoryEntryForStorage`/`buildIssueForStorage` قبل هذه الجلسة، صارت `analyzeDevice.js:60-101` بعدها بعد إضافة حقول `letterSource`/`adjustmentReason`/`adjustmentEvidence`).
- **متطابقان على فرع V7** — كلاهما يُشتقّ من نفس كائن `aiResponseToSave`، لا نسختين منفصلتين قد تنجرفان عن بعضهما. الفرق الوحيد: أربعة حقول تشغيلية (`V7_OPERATIONAL_FIELDS` — `shortId`/`isFreeTrial`/`aiModel`/`deviceMarketingName`، لا ثلاثة كما كانت قبل A112) تُضاف صراحةً فوق الإرجاع فقط — ليست من `display`، ولا تصل التخزين. مُتحقَّق بتشغيل فعلي عبر محاكي Firestore (`aiAuditWiring.e2e.test.js`، **33/33 تحقّقاً** — كان 28/28 قبل هذه الجلسة، و8 قبل جلسة سابقة لها؛ الخمسة الجديدة: حالة 7 الكاملة (تحقّقان، A112 — القائمة التشغيلية مُحاسِبة لا عُرفية) + تحقّقا A112 داخل حالة 5 (`deviceMarketingName` حاضر في الإرجاع/غائب عن المخزون) + تحقّق واحد داخل حالة 6 (letterSource/adjustmentReason/adjustmentEvidence تصل المخزون سليمة — القرار ٤٢ البند ٣)).
- فرع V6: بلا أي تغيير — `{...aiResult, shortId}` حرفياً كما كان دائماً على الفرعين معاً.

### ٢. `verifyReport` — إسقاط بقائمته البيضاء الخاصّة

`functions/src/reports/verifyReport.js:271-355` (`buildV7Response`) — قائمة بيضاء **مستقلّة تماماً عن §٣**، أضيق عمداً (راجع §٨-أ لتفصيلها والفجوات المُوثَّقة فيها، بعضها أُغلق منذ كتابة §٨-أ ولم يُحدَّث نصّها بعد — راجع «ملاحظة نطاق» أسفل هذا القسم). أي حقل جديد في `display` **لا يصل** `/verify` تلقائياً — يجب إضافته صراحةً هنا أيضاً، بنفس منطق §٣ («كائن حرفي، لا `spread`»)، مُطبَّقاً بقائمة منفصلة تماماً عن قائمة القارئ ١.

### ٣. `NeuralChek` (التطبيق) — تحديث بتقرير وكيل التطبيق (2026-09-23 +03)

⚠️ **الوصف القديم أدناه (حتى نهاية هذه الفقرة) — مُبقًى موسوماً، لا مُحذوفاً (القاعدة 8).** كُتب قبل التزام التبديل في `neuralcheck-backend` وقبل تقرير وكيل `NeuralChek` نفسه — كلاهما يُسقطانه اليوم:

~~**خارج حدودي — لم أتحقّق من هذا بنفسي؛ منقول حرفياً من رسالة المنسّق الذي فحص ذلك المستودع:**~~
~~- `AiAnalysisResponse.kt` يُفكّك ردّ `analyzeDevice` إلى **سبعة عشر حقلاً من V6، وصفر حقل من V7** — كلّها `= null` افتراضياً.~~
~~- `AiScoringEngine.kt:353` — `overallGrade = response.grade ?: "?"`.~~
~~**الأثر**: على فرع V7 (غير حيّ إنتاجياً اليوم...) يصل التطبيق كائناً كلّه `null` ويعرض تقريراً فارغاً بلا أي خطأ ظاهر.~~
~~**إغلاق القارئ ١ (analyzeDevice) وحده لا يكفي... `A107` — مهمّة منفصلة، مُكلَّف بها لاحقاً.**~~

**التحديث (منقول من المنسّق — القاعدة 29، خارج حدودي، غير متحقَّق من هذا المستودع).** المصدر: `app/src/test/java/net/neuralcheck/data/remote/model/V7FullDocumentReadCoverageTest.kt` @ NeuralChek `3b68ca3`. تشغيل المنسّق لسويت التطبيق: **408/408**.

- **مصدر التقرير في التطبيق مساران معاً**، كلاهما يُغذّي `AiAnalysisResponse` نفسه:
  - `FirebaseAnalysisService.analyzeDevice()` — إرجاع RPC، عند `:158-167`.
  - `fetchExistingReport()` — قراءة `reports/{scanId}`، عند `:209-226`.
- **كل حقل في `v7ContractFieldMap.js` يُقرأ** (62 سطراً في مخرَج الاختبار).
- **ويُعرض كلّه، إلا ثلاثة**:
  - `language`: يُقرأ ولا يُعرض.
  - `narrativeIncomplete`/`narrativeIncompleteFields`: يُقرأان ولا يُعرضان.
  - `aiModel`: يُقرأ ولا يُعرض.
- **`letterCeilingReason` يُعرض في `ReportScreen` ولا يُعرض في PDF.**
- **والغائب مُميَّز عن `null`** بآلية جديدة، `V7RawFieldPresence.kt`.

~~**تحديث 2026-09-21 +03 (جلسة لاحقة) — جدول قابل للاستعمال...** عمود «V7 اليوم» **مُتحقَّق منه بالكود في هذا المستودع** (`buildV7ResponseForStorage`، `analyzeDevice.js:106-155,605-607`) — لا من المنسّق:~~

⚠️ **تحديث 2026-09-21 +03 (القرار ٤٢ البند ٥/A112، جلسة لاحقة أخرى)** — سطرا الأرقام أعلاه (`:106-155,605-607`) كانا **صحيحين عند كتابتهما**، انحرفا الآن (راجع §٠-١ فوق هذا القسم لتفصيل الانحراف والأرقام الحالية `:120-169`/`:641-643`). والأهمّ: **صفّ `deviceMarketingName` أدناه لم يعد صحيحاً** — كان "غائباً من الاستجابة المُعادة للعميل"؛ أُغلق في هذه الجلسة (القرار ٤٢ البند ٥، A112): أُضيف صراحةً فوق `aiResponseToSave` بنفس منهج `aiModel`/A108، مُشتقّاً من قائمة مُعلَنة مُصدَّرة جديدة `functions/src/analysis/v7OperationalFields.js` (`V7_OPERATIONAL_FIELDS = ['shortId', 'isFreeTrial', 'aiModel', 'deviceMarketingName']`) — **أربعة حقول تشغيلية لا ثلاثة** من الآن. مُتحقَّق بتشغيل فعلي: `aiAuditWiring.e2e.test.js` حالة 5 (`clientResponse2.deviceMarketingName === "P"`) وحالة 7 الجديدة (تتحقّق آلياً أن كل مفتاح top-level في الإرجاع إمّا من `aiResponseToSave` أو من `V7_OPERATIONAL_FIELDS` بالضبط — لا ثالث صامت؛ أعيد إنتاج الكسر فعلياً بإضافة مفتاح مُختلَق مؤقّت للإرجاع، فأخفقت حالتا 5 و7 كما يُفترَض، ثم أُزيل والاختبار عاد 33/33). الجدول أدناه (الصفوف الأخرى) **مُبقًى كما هو، لم يُراجَع بنداً بنداً في هذه الجلسة** — فقط `deviceMarketingName` مُحدَّث (القاعدة 8: لا حذف، تصحيح بارز فقط):

| الحقل (V6، يقرؤه `AiScoringEngine.kt`) | في استجابة V7 المُعادة للعميل اليوم؟ | التفصيل |
|---|---|---|
| `shortId` | **موجود** | مُضاف صراحةً فوق `aiResponseToSave` عبر `V7_OPERATIONAL_FIELDS` — `analyzeDevice.js:638-643` |
| `isFreeTrial` | **موجود** | نفس الموضع |
| `aiModel` | **موجود** | نفس الموضع |
| `deviceMarketingName` | **موجود الآن** (أُغلق في هذه الجلسة — A112) ✅ | نفس الموضع؛ يُكتب أيضاً إلى مستند `reports` top-level (`analyzeDevice.js:445`) — احتياطي `rawDeviceModel` مشترك بين الاثنين |
| `grade` | غائب | لا top-level، لا داخل `aiResponse` — القرار ٥ (بناءً لا حذفاً)، مُثبَت `aiAuditWiring.e2e.test.js` تحقّق 3 |
| `score` | غائب | نفس القرار ٥ |
| `summary` / `details` / `verdict` | موجود **بمسار متداخل مختلف** | `aiResponse.narrative.{summary,details,verdict}` لا `aiResponse.{summary,details,verdict}` المسطَّح — قراءة `response.summary` مباشرة تصل `undefined` ما لم يقرأ Kotlin المسار المتداخل تحديداً (لا أعرف أيّهما يقرأ فعلياً — خارج حدودي) |
| `buyerAdvice` | موجود **بشكل مختلف كلياً** | `aiResponse.narrative.buyerAdvice.{casual,gamer,photographer}` (ثلاثة نصوص، القرار ٢٤) لا حقل `buyerAdvice` مسطَّح واحد |
| `issues` | موجود بالاسم، **شكل مختلف محتمل** | V7: `{id, category, severity, title, description, evidence?, evidenceUnit?}` — نفس فخّ "issues وحدها نجت" الموثَّق في §٨-أ (A101): تطابق الاسم لا يضمن توافق التفكيك |
| `categoryScores` | غائب | لا مكافئ مسطَّح — V7 `categories.<cat>` بشكل مختلف (`state`/`letter`/`coverage`/`reason`/`testIds`، لا درجة رقمية) |
| `predictedProblems` | غائب **عمداً** | القرار ٢٥ — مُسقَط من `display` كلياً، ليس سهواً |
| `changeAnalysis` | غائب | V6 فقط — §٨ يُدرجها ضمن الحقول التي "تختفي" بعد التبديل |
| `categoryNotes` / `rootCause` / `expectedPerformance` | غائبة | لا مكافئ مُسمّى في §٣ |

**القراءة العملية:** لو تبدَّل فرع V7 حيّاً اليوم (لم يتبدَّل بعد)، `AiScoringEngine.kt` يرى ثلاثة حقول فقط من السبعة عشر (`shortId`/`isFreeTrial`/`aiModel`) — الأربعة عشر الباقية تسقط إلى `null` الافتراضي **بلا خطأ ظاهر**، تماماً كما تصف "الأثر" أعلاه، لكن الآن بتفصيل حقل حقل لا بجملة عامّة.

⚠️ **تحديث 2026-09-21 +03 (مهمّة لاحقة، القرار ٣٤ + القاعدة 25) — قائمة الحقول V7 التي يقرؤها/سيقرؤها التطبيق فعلياً، لا التي كان يقرؤها بشكل V6 أعلاه:**

**خارج حدودي — لم أتحقّق من هذا بنفسي؛ منقولة حرفياً من تقرير وكيل التطبيق، مصدرها المُصرَّح به تفكيك فعلي لعيّنة حيّة وتشغيل اختبار `327/327` على جانب التطبيق — لم أرَ ذلك التقرير ولا ذلك التشغيل بنفسي، فلا أستطيع تأكيد عدد "36 حقلاً" ولا "327/327" بالأداة من هذا المستودع (`NeuralChek` خارج حدودي، القاعدة نفسها أعلى هذا القسم):**

```
الجذر:
pipeline · language · overall · categories · issues · narrative ·
narrativeIncomplete · narrativeIncompleteFields ·
shortId · isFreeTrial · aiModel · deviceMarketingName

overall:
letter · letterSource · coverage · coveragePct · partialAssessment ·
partialAssessmentTag.{label,coveragePct,text} ·
governingGateReason.{name,ceilingLetter,source} ·
noDataAtAll · zeroMeasuredMessage · abstentionReasons ·
harnessError · harnessErrorReason

categories.*:
state · letter · letterSource · adjustmentReason · adjustmentEvidence ·
coverage · reason · testIds ·
confidence · tag · indicators · socAtStart · socAtEnd     (البطارية وحدها)

issues[]:
id · category · severity · title · evidence · evidenceUnit · description

narrative:
summary · details · verdict · buyerAdvice.{casual,gamer,photographer}
```

⚠️ **تحديث 2026-09-22 +03 (مهمّة لاحقة أخرى — الشرط الأوّل، `letterCeilingReason`) — الكتلة أعلاه لا تحمل الحقل الجديد.** الكتلة منقولة حرفياً من تقرير وكيل `NeuralChek` (راجع التحذير أعلى §٠-٣: "خارج حدودي — لم أتحقّق من هذا بنفسي") — **لا تُعدَّل هنا** (القاعدة 29: نقل بلا مصدر قابل للقراءة من هذا المستودع يبقى كما وصل، لا يُصحَّح ضمناً). الحقل الجديد الذي **يصف الكود في هذا المستودع فعلاً** (راجع الفقرة التالية والجدول تحت `categories.<category>` في §٣):
```
categories.*:
  ... (كما أعلاه) ...
  letterCeilingReason.{name,ceilingLetter,text}    (جديد — راجع §٣)
```
`NeuralChek`/`wepsite` خارج حدود هذا الوكيل — لا يمكن تحديث تفكيكهما من هنا. الاسم والنوع يُنقَلان في تقرير هذه المهمّة كي يصلا الوكيلين المسؤولين.

**مُطابَقة بالكود من طرف `neuralcheck-backend` لا التطبيق:** هذه بالضبط قائمة `functions/src/analysis/v7ContractFieldMap.js` (المصدر المُصدَّر الوحيد لهذه القائمة — القاعدة 24، لا نسخة يدوية ثانية) مقسَّمة `ROOT_FIELDS`/`OVERALL_FIELDS`/`CATEGORY_COMMON_FIELDS`+`CATEGORY_BATTERY_EXTRA_FIELDS`/`ISSUE_FIELDS`/`NARRATIVE_FIELDS`+`BUYER_ADVICE_PROFILES` — **باستثناء واحد مقصود**: `categories.battery.indicators` مكتوب هنا حقلاً واحداً بلا تفصيل داخلي، وكذلك في `v7ContractFieldMap.js` (مُعلَن `OPAQUE` صراحة) — راجع الملاحظة تحت جدول `indicators` في §٣ لماذا (لا مخطَّط ثابت لمحتواه، `batteryLayer.js`). **مُتحقَّق آلياً بتشغيل فعلي من هذا المستودع**: كل حقل في هذه القائمة (عدا داخل `indicators`) يصل فعلاً مخرَج `buildV7ResponseForStorage`+`V7_OPERATIONAL_FIELDS`، ولا حقل آخر يصل بصمت — `node functions/test/v7ContractFieldsGuard.test.js` → `130/130 assertions passed`.

**ملاحظة عدد بلا حسم (القاعدة 14 — لا تخمين لسدّ فجوة):** عددت حقول القائمة أعلاه بعدّة طرق (مسارات فريدة/أسماء فريدة مع حذف التكرار) ولم أصل إلى ٣٦ بالضبط بأيّ منها بثقة كافية لأثبته رقماً — العدّ يعتمد على ما إذا كانت الحقول المتداخلة (`partialAssessmentTag.label` مثلاً) تُحسَب مسارات كاملة أم أسماء أوراق، وهل يُحسَب `categories.*` مرّة واحدة أم لكل فئة. لا أصحّح رقم "36" ولا أتبنّاه — أنقل القائمة الحرفية فقط، وهي المصدر الفعلي المُختبَر (لا الرقم).

⚠️ **تحديث 2026-09-22 +03 (مهمّة لاحقة — سدّ فجوة §٣ "مستوى الشحن لكل مؤشّر"):** `socAtWindowStart`/`socAtWindowEnd` المُضافان الآن داخل كل عنصر من `categories.battery.indicators.<ID>` (راجع §٣ أدناه) **لا يظهران في القائمة أعلاه ولا في أي من الأربعة قُرّاء هنا بتعديل فعلي** — الأربعة كلّهم يمرّرون `indicators` تمريرة كاملة بالمرجع (`buildDisplayShapeV7.js`: `out.indicators = entry.batteryIndicators || null`؛ `analyzeDevice.js`/`buildCategoryEntryForStorage`: نفس التمريرة؛ `verifyReport.js`: `categories` تمريرة كاملة، §٣ نقطة ٣ أعلاه؛ `wepsite`/`NeuralChek`: قارئ عام بلا مخطَّط على `indicators` بحسب القارئ ٣/٤). هذا **مثال حيّ** على القاعدة 25 حين يقع الحقل الجديد داخل حقل مُعلَن `OPAQUE` أصلاً — التزام القرّاء الأربعة قائم فعلاً (تمريرة عامّة لا تعداد حقول)، فلا يلزم "تحديث" حرفي لأيٍّ منهم، ويكفي التوثيق هنا + في `v7ContractFieldMap.js` (تعليق رأسه، لا قائمة `OPAQUE_FIELDS` نفسها — تبقى `categories.battery.indicators` مفتاحاً واحداً مُبهَماً كما كانت).

**الجداول في هذا الملفّ (§٠/§٣) نصّ Markdown بشري — لا تُقرَأ آلياً.** تحليل جدول Markdown بالتعبير النمطي هو بالضبط ما جعل حارس `A102` يمرّ بلا أن يفحص شيئاً فعلياً (راجع رأس `v7ContractFieldMap.js`). **المصدر المُختبَر آلياً الوحيد** لقائمة الحقول هو `functions/src/analysis/v7ContractFieldMap.js` + `functions/test/v7ContractFieldsGuard.test.js` — يقارنان القائمة بمخرَج خط الأنابيب الفعلي (`buildDisplayShapeV7` → `buildV7ResponseForStorage` → `+V7_OPERATIONAL_FIELDS`) **في الاتّجاهين معاً**: حقل في القائمة وليس في المخرَج (عقد ميّت)، وحقل في المخرَج وليس في القائمة (تسريب صامت — بالضبط عطب `aiModel` ثم `deviceMarketingName` الذي فتح هذه الحلقة ثلاث مرّات). الجداول في هذا الملفّ وصف بشري يجب أن يبقى مطابقاً لذلك الملفّ يدوياً؛ لا ضمانة آلية أن نصّ Markdown نفسه صحيح، فقط أن الكود يطابق `v7ContractFieldMap.js`.

### ٤. `wepsite` (الموقع) — سبع صفحات، قراءة مباشرة من Firestore لا عبر `verifyReport`

**خارج حدودي — لم أتحقّق من هذا بنفسي؛ منقول حرفياً من رسالة المنسّق:**

```
app/verify/page.js:42-46, 274
app/print/[shortId]/PrintClient.js:26-30, 229
app/dashboard/page.js:67, 367
app/shop/[slug]/ShopClient.js:56-58, 416
app/admin/reports/page.js:122, 206, 209, 275, 293
app/admin/page.js:479
```

ستّة ملفّات (إحداها — `app/admin/reports/page.js` — بخمسة مواضع منفصلة، فيصير المجموع سبع نقاط قراءة كما ورد في نصّ الأمر) تقرأ `report.aiResponse` **مباشرة من Firestore**، لا عبر `/verify` — أي أن قائمة `verifyReport.js` البيضاء (القارئ ٢) **لا تحميها إطلاقاً**. كل تغيير في `display` يوجب المرور على هذه الصفحات بالاسم — لا افتراض أن `verifyReport` كافٍ كطبقة حماية وحيدة لكل مستهلكي الشكل.

**تحديث 2026-09-21 +03 (جلسة لاحقة) — ماذا يقرأ تحديداً (من رسالة المنسّق، لم أتحقّق بنفسي)، وحالته على V7 (مُتحقَّق منه بالكود هنا):**

| الحقل الذي تقرؤه هذه الصفحات | في مستند V7 اليوم؟ |
|---|---|
| `grade` (مباشرة من المستند top-level) | **غائب** — القرار ٥، `aiAuditWiring.e2e.test.js` تحقّق 3 |
| `score` (مباشرة من المستند top-level) | **غائب** — نفس القرار |
| `aiResponse.score` (سلسلة احتياط) | **غائب** — `buildV7ResponseForStorage` لا يحمل مفتاح `score` بأي مستوى |
| `ai.score` (سلسلة احتياط، حيث `ai` غالباً اسم محلّي لِـ`aiResponse`) | **غائب** — نفس السبب |
| `aiResponse.overallGrade` (سلسلة احتياط) | **غائب** — لا `overallGrade` في V7؛ المكافئ الحقيقي `aiResponse.overall.letter` باسم مختلف تماماً |

**كل مسارات القراءة الخمسة المذكورة تصل `undefined` على مستند V7** — لا سلسلة احتياط واحدة من الخمس تنجو، لأن جميعها تبحث عن أسماء V6 المسطَّحة (`grade`/`score`/`overallGrade`) التي لا وجود لها في شكل V7 (`overall.letter`/`overall.coverage`) بأي مستوى تداخل.

⚠️ **تصحيح 2026-09-23 +03 (مسح نصوص المرحلة المتجاوَزة، القاعدة 29).** الجملة التالية كانت تصف الخطر بأنه كامن لأن فرع V7 في `neuralcheck-backend` غير حيّ — ذلك **لم يعد صحيحاً**: التبديل (`fd3a6ce`) جعل V7 المسار الحيّ الوحيد، فأي مستند تقرير جديد اليوم V7 الشكل. **حال `wepsite` نفسها غير مُتحقَّقة من هذا المستودع** (خارج حدودي) — لا أعرف هل قرّاؤها حُدِّثا، فلا أزعم عرضاً فارغاً فعلياً ولا أنفيه:

~~**الوصف القديم — مُبقًى موسوماً:** هذا غير حيّ إنتاجياً اليوم (نفس تحذير القارئ ٣ أعلاه) — لا عرض فعلي فارغ على `wepsite` بعد، لكن الخطر كامن بنفس الآلية.~~

---

**ملاحظة نطاق** (2026-09-21 +03): هذا القسم (§٠) وحده أُضيف استجابةً لبند صريح من المنسّق. ~~بقيّة هذا الملف — تحديداً جدول §٣ (لا يذكر بعد أن `narrativeIncompleteFields` يُضاف فوق `display` بواسطة `resolveV7Report.js`، غير مُدرَج في جدول `overall`/`narrative` أصلاً لأنه ليس منهما) و§٨-أ (لا يزال يصف قائمة `verifyReport` البيضاء بثمانية حقول و45 تحقّقاً — صارت القائمة الكاملة بعد جلسة تالية، 85 تحقّقاً، `functions/test/verifyReportV7Whitelist.test.js`) — **لم تُحدَّث** لتعكس ذلك العمل (`pipelineTags.js`، `A103`-`A106`). لم يُطلب تحديثها في هذا البند، فبقيت كما هي بدل تخمين نطاق أوسع لم يُطلَب (القاعدة 13).~~
**أُغلقت 2026-09-21 +03 (جلسة لاحقة، بند صريح منفصل):** كلا الفجوتين المذكورتين أعلاه مُغلقتان الآن — راجع الفقرة الجديدة تحت `display.narrative` في §٣، وراجع §٨-أ كاملاً (الوصف القديم موسوم لا محذوف). أُبقيت الفقرة الأصلية أعلاه مشطوبة (القاعدة 8: لا حذف دليل).

---

## ١ · لماذا هذا الملف

`runAnalysisInternal.js:402-536` (قبل هذه المهمّة) كان يبني `aiResult` من `aiAnalysis.grade` · `.overallScore` · `.score` · `.issues` · `.category_scores` — حقول **V6 حصراً**. مخطَّط V7 (`reportShapeV7.js:FORBIDDEN_TOP_LEVEL_KEYS`) **يمنعها صراحةً**. فالتبديل بلا طبقة تحويل كان سيُسقط كل فحص في `grade="C"` · `score=50` · `issues=[]` — الاستنتاج المحايد الصامت (نفس فخّ حادثة الفحص `629485e9`، لكن بمصدر مختلف). هذا الملف هو تلك الطبقة.

---

## ٢ · ترتيب التركيب (مُلزِم)

```
1. computeFindings(fingerprint)                              → findings           (findings.js)
2. computeCategoryStates({...})                               → categoryStatesRaw  (categoryStates.js)
3. applyV7Adjustments(categoryStatesRaw, aiAnalysis.adjustments)
                                                                → categoryStatesAdjusted (buildV7Payload.js)
4. buildDisplayShapeV7({categoryStates: categoryStatesAdjusted,
                        findings, aiAnalysis, language})       → {display, audit}
```

`buildDisplayShapeV7` **يبدأ من الخطوة ٤ فقط**. لا يستدعي `applyV7Adjustments` داخلياً (مسؤولية واحدة: تنسيق العرض، لا تطبيق تعديلات النموذج). ولا يفحص `guard.ok` — قرار قبول/رفض الاستجابة يخصّ طبقة الاستدعاء الأعلى، لا هذه الدالّة (راجع §٧ أدناه).

`aiAnalysis` هو مخرَج `callAIv7` الخام: `{narrative: {summary, details, verdict, buyerAdvice, issueDescriptions}, crossChecks[], adjustments[], modelObservations[]}` — شكل `reportShapeV7.js`.

### كيف يصل هذا من `runAnalysisInternal.js` (حيّ منذ التبديل، `fd3a6ce`)

`runAnalysisInternal.js` يستهلك `buildDisplayShapeV7` فعلياً (سطر ~449 فما بعد)، لكن فقط حين `pipeline === "v7_findings_based"` — قيمة لا تصل أبداً طالما `:292` ينادي `callAI` (V6). النتيجة المُعادة من `runAnalysisInternal` على ذلك الفرع:

```js
{
  aiResult: displayShape.display,       // المعروض — راجع §٣
  aiResultAudit: displayShape.audit,    // يُحفَظ ولا يُعرض — راجع §٤
  pipeline: "v7_findings_based",
  categoryStates: categoryStatesAdjusted,  // بعد applyV7Adjustments
  findings, v5Metrics, aiModel, duration, aiDurationMs,
  aiFallbackReason, existingProfile, deviceProfileKey, aiFailed,
}
```

`aiResultAudit` حقل top-level **جديد**، منفصل عمداً عن `aiResult` — القرار ٥ («كسر نظيف. لا شكل مزدوج») يمنع دفن حقول غير معروضة داخل الكائن المعروض.

⚠️ **تحديث 2026-09-21 (+03) — القرار ٢٠، مهمّة لاحقة**: `analyzeDevice.js` صار يستقبل `aiResultAudit` من `runAnalysisInternal` ويكتبه تحت مفتاح `aiAudit` منفصل عن `aiResponse` (نفس الحقلين المذكورين هنا)، مُثبَتاً باختبار محاكي (`aiAuditWiring.e2e.test.js`) — راجع تقرير تلك المهمّة. ~~**الوصف القديم — مُبقًى موسوماً:** لا يزال الفرع V7 غير حيّ فـ`aiAudit=null` على كل فحص حقيقي اليوم؛ هذا يصف الوصل البنيوي فقط، لا تفعيل المسار.~~ **تصحيح 2026-09-23 +03 (بعد التبديل، `fd3a6ce`):** الفرع V7 حيّ الآن — `aiAudit` يحمل قيمة حقيقية (لا `null`) على كل فحص جديد. الجملة أدناه («لا يكتب Firestore… غير مُعدَّل في هذه المهمّة») كانت صحيحة عند كتابة هذا العقد ولم تعد كذلك — أُبقيت العبارة الأصلية في §٧ بند ٢ موسومة بالتصحيح بدل حذفها (القاعدة 8: لا حذف دليل).

---

## ٣ · `display` — الكائن المعروض للمستخدم

### `display.overall`

| الحقل | النوع | المعنى | المصدر | القرار |
|---|---|---|---|---|
| `letter` | `"A"\|"B"\|"C"\|"D"\|null` | الدرجة العامة. `null` **فقط** حين لا فئة أنتجت حرفاً (`noDataAtAll`) أو `HARNESS_ERROR` | `categoryStates.overall.letter` (تمريرة) | ١، ٧ |
| `letterSource` | `string` | `"BAND"` · `"GATE:<name>"` · `"NO_DATA"` · `"HARNESS_ERROR"` | `categoryStates.overall.letterSource` (تمريرة) | ١٦ |
| `coverage` | `number\|null` | كسر 0..1. `null` فقط في `HARNESS_ERROR` | `categoryStates.overall.coverage` (تمريرة) | ١٠، ١٢ |
| `coveragePct` | `number\|null` | نفس `coverage`×100، مقرَّب لمنزلة واحدة. **حقل جديد** (لم يكن في `categoryStates.js`) — يضمن عرض النسبة دائماً لا فقط داخل `partialAssessmentTag` | مُشتقّ هنا | تصميم إضافي (§٦ أدناه) |
| `partialAssessment` | `boolean` | `true` حين `coverage < 0.6` | تمريرة | ١، ١١ |
| `partialAssessmentTag` | `{label, coveragePct, text}\|null` | الوسم الكامل بنصّه («تقييم جزئي — تغطية X%») | تمريرة | ١ |
| `governingGateReason` | `{name, ceilingLetter, source}\|null` | تفسير `letterSource` حين يبدأ بـ`GATE:` — **بلا استنتاج من القارئ** | مُشتقّ من `overall.gatesApplied` (audit) بمطابقة الاسم | ١٦، ٦ |

⚠️ **تحديث 2026-10-01 +03 (S1، أمر مستخدم) — `text` حقل رابع جديد** على `governingGateReason` (`{name, ceilingLetter, source, text}|null` الآن، بلا تغيير على الثلاثة الأولى): جملة عرض عربية جاهزة (`buildDisplayShapeV7.js:buildGoverningGateDisplayText`، جدول بالأسماء الستّة المعروفة لِـ`gatesApplied[].name`) — بلا اسم البوّابة ولا مصدرها الخام. `name`/`source` يبقيان — للّوحة الإدارية، لا للعرض للمشتري (قرار عرض في طبقة العميل، لا حذف حقل هنا). `v7ContractFieldMap.js`: `GOVERNING_GATE_REASON_FIELDS`/`GOVERNING_GATE_REASON_UNMATCHED_FIELDS` كلاهما يحملان `text` الآن.
| `noDataAtAll` | `boolean` | صفر فئة `MEASURED` (بيانات وصلت، لا حرف من أيّها) | تمريرة | ٧ |
| `zeroMeasuredMessage` | `"لم يُقَس شيء قابل للحكم"\|null` | يظهر **فقط** حين `letter===null && noDataAtAll` — لا يظهر في `HARNESS_ERROR` (رسالة مختلفة كلياً) | مُشتقّ هنا | ٧ |
| `abstentionReasons` | `Array<{category, reason}>\|null` | قائمة سبب كل فئة لم تُنتج حرفاً — تُبنى **فقط** حين `zeroMeasuredMessage` غير `null` | مُشتقّ هنا | ٧ |
| `harnessError` | `boolean` | `true` حين `functionalResults=null` (تعذّر تجهيز، لا "غير مقيس") | تمريرة | ١٢، ١٣ (A97#2) |
| `harnessErrorReason` | `string\|null` | مثال: `"FUNCTIONAL_RESULTS_UNAVAILABLE"` | تمريرة | ١٣ |
| `harnessErrorMessage` | `string|null` | جملة عرض عربية جاهزة للعميل (S3، أمر مستخدم 2026-10-01 +03) — مثال: "تعذّر تجهيز نتائج الاختبارات لهذا الفحص." — بجوار `harnessErrorReason` الخامّ (يبقى بلا تغيير، للّوحة) | `categoryStates.js:harnessErrorDisplayMessage` | S3 |

**غائب عمداً من `overall`:** `measuredCategoriesMean` (القرار ٦)، `score` (V6، ممنوع بالبناء لا بالحذف)، `adjustments`/`disputed` (القرار ٤ — إلى `audit`).

⚠️ **توضيح 2026-09-21 +03 (مهمّة لاحقة، جدول §٠-٣/القرار ٣٤) — "اختياري" في وصف النوع (`number|null`) يخصّ **القيمة**، لا **حضور المفتاح**:** الاثنا عشر حقلاً في الجدول أعلاه (بما فيها `coverage`/`coveragePct`) حقول الكائن الحرفي `display.overall = {...}` (`buildDisplayShapeV7.js:265-278`) — كلّها تُسنَد بلا شرط، بصرف النظر عن أي فرع. `overall.coverage`/`coveragePct` تحديداً: حتى حين `categoryStates.overall` غائب كلّياً، `buildDisplayShapeV7.js:244` يُسقِطه إلى `{}` فتبقى `coverage`/`coveragePct` مفتاحين حاضرين بقيمة `null` (`buildDisplayShapeV7.js:259-260,268-269`) — لا يسقطان من الكائن. مُتحقَّق آلياً: `v7ContractFieldsGuard.test.js` يقارن `Object.keys(actual.overall)` بكامل قائمة `OVERALL_FIELDS` (12 مفتاحاً) على كل تشغيلة — لا مجرّد افتراض.

### `display.categories.<category>` (لكل الفئات الـ15: `battery, thermal, cpu, gpu, display, memory, storage, camera, gps, security, sensors, cellular, wireless, audio, input`)

| الحقل | النوع | المعنى | القرار |
|---|---|---|---|
| `state` | `"MEASURED"\|"PARTIAL"\|"ATTESTED_ONLY"\|"UNMEASURED"\|"HARNESS_ERROR"` | حالة الفئة — **حاضرة دائماً، لا إسقاط صامت** | ٢ |
| `letter` | `string\|null` | حرف الفئة (A-D للفئات العادية؛ **للبطارية: أحد ثلاث درجات وصفية** — راجع أدناه). **من `finalLetter` لا `deterministicLetter`** — راجع الإضافة أدناه | ٢، ٣ |
| `coverage` | `number\|null` | executed/declared على الاختبارات الحاملة للصحّة | — |
| `reason` | `string\|null` | سبب الامتناع حين `letter===null`؛ `null` حين توجد درجة فعلاً. **رموز مُشتقّة هنا** — راجع §٥ | ٢ |
| `testIds` | `string[]` | معرّفات الاختبارات المُدرَجة في هذه الفئة (فارغة للبطارية — لا `testId` مُفرد لكل مؤشّر) | — |

⚠️ **إضافة 2026-09-21 +03 (القرار ٤٢ البند ٢/٣، A62، جلسة لاحقة) — ثلاثة حقول جديدة على `display.categories.<category>` (القرار ٢٥: شكل جديد، قرّاؤه مُحدَّثون أدناه):**

| الحقل | النوع | المعنى | المصدر |
|---|---|---|---|
| `letterSource` | `"DETERMINISTIC"\|"LLM_ADJUSTED"` | هل `letter` أعلاه هو الحرف الحتمي كما هو (`DETERMINISTIC`) أم بعد تخفيض نموذج مقبول (`LLM_ADJUSTED`) | `!!entry.adjustmentApplied` (`buildDisplayShapeV7.js:buildCategoryDisplay`) |
| `adjustmentReason` | `string\|null` | نصّ سبب التخفيض من النموذج — `null` إن `letterSource==="DETERMINISTIC"` | `entry.adjustmentReason` (`applyV7Adjustments`، `buildV7Payload.js`) |
| `adjustmentEvidence` | `string[]\|null` | مصفوفة `evidenceRefs` التي مرّت التحقّق (القرار ٤٢ البند ١) وبرّرت التخفيض — `null` إن `letterSource==="DETERMINISTIC"` | نفس المصدر |

**لماذا الآن لا قبل**: قبل هذه الجلسة كان `buildCategoryDisplay` يعرض `entry.deterministicLetter` مباشرة، و`applyV7Adjustments` كانت **تكتب فوق** `deterministicLetter` نفسه عند DOWN مقبول (A62 — عطب مُصلَح: "لا يُحفَظ رأي النموذج حين يفوز القياس، ولا رأي القياس حين يفوز النموذج"). الإصلاح: `deterministicLetter` **لا يُكتَب فوقه بعد الآن أبداً** — يبقى ما قاله القياس الحتمي وحده (لكنه **audit فقط من الآن** — لم يعد يظهر مباشرة في `display`؛ `categoryStates.categories.<cat>.deterministicLetter` يبقى متاحاً في `categoryStates`/`aiResultAudit.categoryLlmSuggestedLetters` للمراجع لا للمشتري). `finalLetter` (حقل جديد أيضاً على `categoryStates`، لا `display` — يُهيَّأ بنفس قيمة `deterministicLetter` عند البناء في `categoryStates.js` قبل أي تعديل) هو ما يُعرَض فعلياً عبر `letter` أعلاه.

**قُرّاء هذا الشكل الجديد الثلاثة، محدَّثون معه (القرار ٢٥):**
1. `buildDisplayShapeV7.js` (`buildCategoryDisplay`) — الكاتب نفسه.
2. `analyzeDevice.js` (`buildCategoryEntryForStorage`، A104) — يبني `letterSource`/`adjustmentReason`/`adjustmentEvidence` حقلاً حقلاً مثل بقيّة الحقول (لا حاجة لقائمة ثانية في `verifyReport.js` — راجع الملاحظة التالية).
3. `verifyReport.js` — **لا يحتاج تعديلاً فعلياً**: `categories` تصله تمريرة كاملة بالمرجع من المستند المخزون (`verifyReport.js:294-295,330`، مُثبَت `deepEqual` في `verifyReportV7Whitelist.test.js:299`) — أيّ حقل يكتبه `buildCategoryEntryForStorage` (القارئ ٢) يصل `/verify` تلقائياً بلا قائمة بيضاء ثانية على مستوى الفئة. هذا **فرق موثَّق عن نصّ أمر المهمّة** ("تُضاف إلى قائمة `verifyReport` البيضاء V7") — تحقّقتُ بالكود أن لا قائمة كهذه موجودة أصلاً على مستوى الفئة (فقط `overall`/`narrative` مُعاد بناؤهما حقلاً حقلاً؛ `categories`/`issues` تمريرة دائماً)، فلا فعل مطلوب هناك تحديداً — راجع تقرير المهمّة تحت «الفرق بين ما أُمرت به وما فعلت».

⚠️ **إضافة 2026-09-22 +03 (مهمّة لاحقة أخرى — "الشرط الأوّل"، `letterCeilingReason`) — حقل رابع جديد على `display.categories.<category>` (القرار ٢٥: شكل جديد، قرّاؤه مُحدَّثون أدناه)، **مُميَّز عمداً عن `reason` أعلاه**:**

| الحقل | النوع | المعنى | المصدر |
|---|---|---|---|
| `letterCeilingReason` | `{name, ceilingLetter, text}\|null` | سبب *تسقيف* حرف **موجود فعلاً** (لا سبب امتناعه — ذلك `reason`) حين بوّابة مسمّاة أسقفته. `null` إن لم تُسقِّف أي بوّابة letter هذه الفئة | `buildCategoryLetterCeilingReason` (`buildDisplayShapeV7.js`)، مُشتقّ من `entry.gatesApplied` |

**التمييز عن `reason` (نصّ حرفي، لا استنتاج):** `reason` سبب امتناع الفئة عن إنتاج حرف أصلاً (`UNMEASURED`/`ATTESTED_ONLY`/`HARNESS_ERROR` — `letter===null`). `letterCeilingReason` سبب تسقيف حرف **أُنتِج فعلاً** (`letter!==null`، الفئة `PARTIAL` أو `MEASURED`، لكن بوّابة أنزلته). الحالتان لا تتداخلان على فئة واحدة أبداً — مُختبَر بقيمتين حقيقيتين متعاكستين على `b45c8cf6`: `gpu` (`letter='B'`، `reason=null`، `letterCeilingReason≠null`) و`thermal` (`letter=null`، `reason='DECLARED_BUT_NONE_EXECUTED'`، `letterCeilingReason=null`) — `v7ContractFieldsGuard.test.js`/`buildDisplayShapeV7.test.js`.

**نصّان لا واحد — التمييز audit/display القائم أصلاً في هذا الملفّ (§٣/§٤) يمتدّ إلى مستوى الفئة:**
- **تقنيّ (`audit`، بلا تغيير هنا):** `overall.gatesApplied` (عبر `audit`، تمريرة **كل** البوّابات بلا استثناء — راجع §٤) يحمل نصّها التقني كما كان دائماً، مثال حقيقي (`gpu`، `b45c8cf6`): `"coverage=40.0% < 60.0%؛ 2/2 اختبار منفَّذ من صنف STATE — صفر MEASUREMENT"`.
- **بشري (`letterCeilingReason.text`، جديد):** يُبنى من القيم الفعلية لهذه الفئة بالذات (`executedCount`/`declaredCount`/`belowThreshold`/`allNonMeasurement`) — **لا قالباً ثابتاً**. نفس المثال (`gpu`، `b45c8cf6`): `"تغطية منخفضة — اختباران من خمسة، وكلاهما اختبار تعريف لا أداء"`. فئة أخرى بأرقام مختلفة (`gps`: 1/3) تُنتج نصّاً مختلفاً فعلياً: `"تغطية منخفضة — اختبار واحد من ثلاثة، وهو اختبار تعريف لا أداء"` — لا نسخة مُعاد استعمالها.

⚠️ **نطاق مقصود — بوّابة LOW_CATEGORY_COVERAGE فقط، لا كل بوّابة قد تُسقِّف letter فئة (القاعدة 13):** أمر هذه المهمّة بالكامل ("الشرط الأوّل") موضوعه هذه البوّابة تحديداً. `buildCategoryLetterCeilingReason` تبحث عن `gatesApplied[].name === 'LOW_CATEGORY_COVERAGE'` **حصراً** — بوّابة أخرى مُسقِّفة فعلياً لفئة (مثال نظري: `ROOT_DETECTED`/`PATCH_AGE` على `security`، لولا أنها `D` أصلاً بقاعدة `STATE_FAIL_FLOOR` على كل فحص حقيقي متاح اليوم فتسبقها) **لا تُنتج نصّاً هنا** — `letterCeilingReason=null` رغم أنها الحاكمة فعلياً. لا معلومة مفقودة (`audit.gatesApplied` يحملها كما هو دائماً)، فقط لا نصّ بشري لها بعد. تعميمه لبقيّة البوّابات الأربع خارج نطاق هذه المهمّة — لم يُطلَب، لم يُنفَّذ.

**قُرّاء هذا الشكل الجديد، محدَّثون معه (القرار ٢٥):**
1. `buildDisplayShapeV7.js` (`buildCategoryLetterCeilingReason`/`buildLowCoverageCeilingDisplayText`/`arabicTestCount`، تُستدعى من `buildCategoryDisplay`) — الكاتب نفسه.
2. `v7ContractFieldMap.js` — `letterCeilingReason` أُضيف إلى `CATEGORY_COMMON_FIELDS` (9 حقول الآن، كانت 8) + `CATEGORY_LETTER_CEILING_REASON_FIELDS` جديدة (`name`/`ceilingLetter`/`text`) لحراسة الشكل المتداخل، على نمط `GOVERNING_GATE_REASON_FIELDS`. `v7ContractFieldsGuard.test.js` يفحص الحضور (كل فئة) + الشكل المتداخل (`gpu`، != null) + القيمة `null` الحقيقية (`cpu`) — **134/134 assertions passed** (كان 130).
3. `analyzeDevice.js` (`buildCategoryEntryForStorage`) — يبني `letterCeilingReason` حقلاً حقلاً (`name`/`ceilingLetter`/`text`، كلٌّ بفحص نوع مستقلّ) لا تمريرة `?? null` خفيفة كسابقتها `overall.governingGateReason` — قصداً: هذه الدالّة بالذات (لا `buildV7ResponseForStorage.overall`) تنضبط بفحص نوع صريح لكل حقل من كل حقل آخر في الفئة (A104)، فلا يُستثنى هذا الحقل الجديد وحده.
4. `verifyReport.js` — **لا يحتاج تعديلاً**، لنفس سبب البند 3 أعلاه بالضبط (`categories` تمريرة كاملة).
5. `NeuralChek`/`wepsite` — **خارج حدود وكيل `neuralcheck-backend`**. الاسم (`letterCeilingReason`) والنوع (`{name, ceilingLetter, text}\|null`) والنصّ الفعلي على مثالين حقيقيَّين (`gpu`/`gps` أعلاه) يُنقَلان في تقرير هذه المهمّة.

⚠️ **توضيح 2026-09-22 +03 (مهمّة وثائقية محدودة — سؤال من `wepsite`: "شكل `adjustmentEvidence`/`adjustmentReason` الحقيقي عند `LLM_ADJUSTED`" — القاعدة 5/29):** الجدول أعلاه يذكر النوعين (`string|null`/`string[]|null`) دون وصف **ما تحمله فعلياً** ودون تتبّع السلسلة حتى الشكل الواصل للمشتري. تتبّع كامل بـ`file:line`:

1. **الأصل — `applyV7Adjustments` (`buildV7Payload.js`).** `evidenceRefs` (`buildV7Payload.js:383`: `const evidenceRefs = Array.isArray(a.evidenceRefs) ? a.evidenceRefs : [];`) هي **حرفياً** مصفوفة `evidenceRefs` كما كتبها النموذج في `adjustments[i].evidenceRefs` — نصوص مسار خام (`"findings.a.b[0].c"`/`"categoryStates.a.b[0].c"`)، **غير محلولة إلى قيمة**. حين يُقبَل التعديل (كل عنصر اجتاز `evaluateEvidenceRef` — `buildV7Payload.js:404-413`)، هذه المصفوفة نفسها **بالمرجع، بلا نسخ ولا تحويل** تُكتَب على `categories[category].adjustmentEvidence` في كلا فرعي القبول: `buildV7Payload.js:498` (الفئة أصلاً D — لا انخفاض مرئي) و`buildV7Payload.js:514` (تغيّر الرتبة فعلاً). `adjustmentReason` معها: `a.reason || null` حرفياً (`buildV7Payload.js:499`/`515`) — أياً ما كتبه النموذج في `.reason`، **بلا فحص نوع في هذه الدالّة نفسها**.

   مثال حيّ حقيقي (لا مُختلَق) — `functions/scripts/out/v7-live-34dff2b8-ce9e-4b40-86a9-1976c878e195.json`، `.parsedResponse.adjustments[0].evidenceRefs`:
   ```
   ["categoryStates.categories.cpu.deterministicLetter",
    "categoryStates.categories.cpu.gatesApplied[0].name",
    "categoryStates.categories.cpu.gatesApplied[0].ceilingLetter",
    "categoryStates.categories.cpu.gatesApplied[0].status",
    "findings.sustainedCeiling.phase3.meanWindowMaxRatio",
    "findings.sustainedCeiling.phase5.meanWindowMaxRatio",
    "findings.sustainedCeiling.combined.meanWindowMaxRatio",
    "findings.channels.cpu_freq_max_khz.CPU_SUSTAINED.mean"]
   ```
   هذه أسماء حقول داخلية في `findings`/`categoryStates` كما يخاطبها الكود بالضبط — لا نصّ بشري مُعاد صياغته. (هذا التعديل بعينه رُفض فعلياً — `rejectedReason: "EVIDENCE_NOT_PROVEN"`، `gatesApplied[0].status` هنا `"DISABLED"` لا `"FIRED"` — مُتحقَّق بتشغيل فعلي، راجع تقرير المهمّة. الشكل وحده هو ما يُثبته هذا المثال، لا القبول.)

2. **`adjustmentReason` — نصّ حرّ، مضمون النوع مُتأخِّراً لا مُبكِّراً.** نصّ عربي حرّ يكتبه النموذج (المثال الحقيقي أعلاه يحمل +700 حرف). `reportShapeV7.js:validateV7Shape` (حلقة `adjustments[]`، `reportShapeV7.js:108-118`) تتحقّق من `category`/`direction`/`evidenceRefs` فقط — **لا `typeof a.reason === 'string'` في أي مكان بهذا المخطَّط**. لو أرسل النموذج `reason` رقماً أو كائناً، `applyV7Adjustments`/`buildDisplayShapeV7` يُمرِّرانه بلا تغيير (`a.reason || null` ثم `entry.adjustmentReason || null`، `buildDisplayShapeV7.js:157`) — **أوّل تحقّق نوع فعلي** يقع في `analyzeDevice.js:76-77` (`buildCategoryEntryForStorage`، طبقة التخزين النهائية): `(e.adjustmentReason === null || typeof e.adjustmentReason === "string") ? e.adjustmentReason : null`. فالنوع `string|null` في الجدول أعلاه **صحيح لِما يصل المخزون/العميل فعلاً**، لكن الضمان دفاع في العمق في آخر حلقة، لا عقد مُبكر — ثغرة موثَّقة لا مُصلَحة هنا (خارج نطاق هذه المهمّة الوثائقية، القاعدة 14).

3. **`adjustmentEvidence` — مصفوفة نصوص مسار، لا كائنات ولا قيماً محلولة.** نفس النمط: `buildDisplayShapeV7.js:158` تتحقّق `Array.isArray(entry.adjustmentEvidence)` فقط (لا نوع عناصرها)، و`analyzeDevice.js:78` كذلك (`Array.isArray(e.adjustmentEvidence) ? e.adjustmentEvidence : null` — لا فحص أن كل عنصر نصّ). **الضمان الوحيد أن كل عنصر نصّ مسار صالح** بنائي لا دفاعي: يأتي من `evaluateEvidenceRef`/`parseEvidencePath` (`buildV7Payload.js:235-248،340-350`) — تعديل **يصل هذا الحقل أصلاً فقط إن مرّ كل عنصر في `evidenceRefs` بالتحقّق الثلاثي** (موجود ← غير غائب ← مُثبِت، `buildV7Payload.js:342-349`). فبالبناء، حين `adjustmentEvidence !== null`، كل عنصر نصّ مسار مطابق لـ`EVIDENCE_PATH_SEGMENT_RE` — لكن لا فحص دفاعي مباشر لهذا في `analyzeDevice.js`؛ يعتمد على أن الكاتب الوحيد (`applyV7Adjustments`) صحيح.

4. **هل تصل هذه المسارات الخام المشتري فعلاً؟ نعم — مُتحقَّق لا مُفترَض.** السلسلة الكاملة: `applyV7Adjustments` (يكتب الحقلين على `categoryStates.categories.<cat>`) ← `buildDisplayShapeV7.js:buildCategoryDisplay` (`buildDisplayShapeV7.js:151-158`، يُدخِلهما في `display.categories.<cat>` — **`display` لا `audit`**) ← `analyzeDevice.js:buildCategoryEntryForStorage` (`analyzeDevice.js:74-78`، يكتبهما على الشكل المخزَّن في Firestore والمُعاد للعميل عبر RPC) ← `v7ContractFieldMap.js:83` (`CATEGORY_COMMON_FIELDS`) يُعلنهما حقلين متوقَّعين دائماً على كل فئة، يحرسهما `v7ContractFieldsGuard.test.js` (`130/130 assertions passed`) بمقارنة مباشرة مع مخرَج `buildV7ResponseForStorage` الفعلي. هذا التسلسل **مُتحقَّق بتشغيل فعلي** في هذه المهمّة (`functions/scripts/generate-v7-client-payload-sample-llm-adjusted.js`، مُلتزَم بالمستودع، استهلك `applyV7Adjustments`/`buildDisplayShapeV7`/`buildV7ResponseForStorage` المُصدَّرة فعلياً بلا تعديل عليها — راجع تقرير المهمّة تحت «قياس قبل/بعد») لا افتراضاً من قراءة الكود وحدها.

   ⚠️ **تضارب ظاهري مع تعليق موجود، محسوم بالتتبّع أعلاه:** `resolveV7Report.js:38-43` يقول صراحةً: "`crossChecks/adjustments/modelObservations` **لا تصل `display` أصلاً في أي حال**... `buildDisplayShapeV7.js` يضعها في `audit` حصراً". هذا **صحيح فقط للقائمة الجذرية `parsed.adjustments`/`aiAnalysis.adjustments`** — القائمة الكاملة بكل عناصرها المقبولة والمرفوضة، التي تصل فعلاً `audit.adjustments` حصراً (`buildDisplayShapeV7.js:336`) ولا تصل `display` بأي شكل. لكنه **لا يشمل** `categories.<cat>.adjustmentEvidence`/`.adjustmentReason` — حقلان بنفس الجذر اللفظي (`adjustment*`) لكن مساراً ومصدراً مختلفَين كلياً (نتيجة *تعديل واحد بعد قبوله على فئة واحدة*، لا سجلّ كل المحاولات) — وهذان **يصلان `display` فعلاً**، موثَّقان في الجدول أعلى هذا القسم منذ 2026-09-21 +03. تشابه الاسم بين الحقلين قد يُضلِّل قارئاً مستقبلياً لتعليق `resolveV7Report.js` ليظنّ أن لا دليل تعديل يصل المستخدم إطلاقاً — **ليس كذلك**. لا تعديل على `resolveV7Report.js` هنا (خارج نطاق هذه المهمّة الوثائقية) — يُسجَّل التضارب هنا فقط.

**الخلاصة العملية لسطحي العرض (`wepsite`/`NeuralChek`):** `adjustmentEvidence` حين `letterSource==="LLM_ADJUSTED"` هو **مصفوفة مسارات كود داخلية حرفية** (مثل `"categoryStates.categories.cpu.deterministicLetter"`) — لا نصوصاً صالحة للعرض المباشر للمشتري بلا معالجة. عرضها كنصّ خام (كما يفعل `wepsite` دفاعياً اليوم — نصّ فقط يُعرض) **قرار عرض يخصّ المستخدم لا افتراضاً تقنياً**: يحتاج قراراً صريحاً — تُترجَم لعرض مقروء (مثلاً "بوّابة اكتشاف الروت أُطلقت")، أو تبقى في وضع مراجعة داخلي فقط ولا تصل واجهة المشتري، أو تُعرض كما هي بوعي أنها نصّ تقني (Debug-ish). لا قرار مُتَّخذ هنا (خارج نطاق هذه المهمّة الوثائقية) — يُسجَّل السؤال صراحة ليقرّره المستخدم/فريق المنتج.

### عيّنة `LLM_ADJUSTED` — مُصطنَعة محلياً (لا نداء نموذج)

العيّنة الحقيقية الوحيدة المتاحة اليوم (`v7-client-payload-sample.json`) تحمل `letterSource: "DETERMINISTIC"`/`adjustmentEvidence: null` على الفئات الـ15 كلّها — لأن التعديل الحقيقي الوحيد المُلتقَط لهذا الفحص (`cpu`، المثال أعلاه) رُفض فعلياً (`EVIDENCE_NOT_PROVEN`، مُتحقَّق بتشغيل فعلي في هذه المهمّة). **صفر عيّنة حقيقية لحالة `LLM_ADJUSTED` موجودة في هذا المستودع اليوم.**

عيّنة ثانية **مُصطنَعة مُعلَنة** (2026-09-22 +03): **`functions/test/fixtures/golden/v7-client-payload-sample-llm-adjusted.json`** — مُولَّدة بسكربت مُلتزَم بالمستودع، **`functions/scripts/generate-v7-client-payload-sample-llm-adjusted.js`** (نفس سابقة `generate-v7-client-payload-sample.js`، القاعدة 32: العيّنة مخرَج، لا يبقى بلا سكربت مُلتزَم يُعيد توليده). **مُصطنَعة بالكامل في جزء `adjustments` فقط — لا نداء نموذج، لا قيمة قياس مُختلَقة.** البناء: نفس `findings`/`categoryStates` الحقيقيان لسيناريو `34dff2b8` (نفس مُدخل العيّنة الأولى، `functions/scripts/generate-v7-client-payload-sample.js`) + نفس `aiAnalysis.narrative/crossChecks/modelObservations` الحقيقية + `adjustments[]` = التعديل الحقيقي المرفوض (`cpu`، أعلاه) **زائد** تعديل واحد مُصطنَع وحيد:

```json
{
  "category": "storage",
  "direction": "DOWN",
  "evidenceRefs": ["categoryStates.categories.storage.deterministicLetter"],
  "reason": "[عيّنة مُصطنَعة محلياً — لا نداء نموذج، ...] حرف التخزين الحتمي المقيس فعلياً هو C — يُستعمَل كدليل \"مُثبَت\" بنصّ الكود (letter C/D) لتوليد انخفاض مرئي فعلي (C→D)..."
}
```

`categoryStates.categories.storage.deterministicLetter === "C"` **حقيقي فعلاً** لهذا الفحص (تحقّق مباشر بتشغيل `computeCategoryStates` — لا اختلاق). **المُصطنَع الوحيد هو قرار التعديل نفسه** (إقران فئة+اتّجاه+دليل+سبب) — لا أي قيمة قياس. مرّ التعديل بشروط القبول الثمانية فعلياً عبر `applyV7Adjustments` (تشغيل حقيقي، لا محاكاة). النتيجة في العيّنة الثانية — `categories.storage` (شكل التخزين النهائي، `buildV7ResponseForStorage`):

```json
{
  "state": "MEASURED",
  "letter": "D",
  "letterSource": "LLM_ADJUSTED",
  "adjustmentReason": "[عيّنة مُصطنَعة محلياً — لا نداء نموذج...] ...",
  "adjustmentEvidence": ["categoryStates.categories.storage.deterministicLetter"],
  "coverage": 1,
  "reason": null,
  "testIds": ["S-01", "S-02", "S-03", "S-04", "S-05", "S-06"]
}
```

`audit.adjustments` في هذه العيّنة (لا يصل العميل، للمرجع فقط) يحمل العنصرَين معاً — الرفض الحقيقي (`cpu`) والقبول المُصطنَع (`storage`، `fromLetter:"C"→toLetter:"D"`) — فتُقرأ منه سياسة الرفض/القبول الفعلية جنباً إلى جنب. `overall.letter`/`overall.letterSource` في العيّنة الثانية **مطابقان حرفياً** للعيّنة الأولى (`"C"`/`"GATE:ROOT_DETECTED"`) — بوّابة `security.ROOT_DETECTED` تحكم السقف العام بصرف النظر عن `storage`، فالتعديل المُصطنَع معزول الأثر على فئته وحدها، كما هو متوقَّع.

⚠️ **إعادة تشغيل السكربت — حقل واحد غير حتمي، لا العيّنة كلّها.** تحقّق فعلي (هذه المهمّة): تشغيل `generate-v7-client-payload-sample-llm-adjusted.js` مرّتين يُنتج ملفّين مختلفين بـ`diff` بسطر واحد فقط — `shortId` (مثال: `"NC-WTK4HT"` مقابل `"NC-GXAR44"`). السبب: `generateShortId()` (`../src/utils/generateShortId.js`) تستعمل `Math.random()` — نفس سلوك `generate-v7-client-payload-sample.js` الأصلي (موروث من التصميم القائم، لا عطب جديد هنا). **كل حقل آخر في الملفّ حتمي بالكامل** بين تشغيلتين (نفس المُدخلات الحقيقية الثابتة + نفس نصّ التعديل المُصطنَع الثابت) — `diff` فعلي أظهر سطراً واحداً مُختلِفاً من أصل 24000+ سطر. النسخة على القرص اليوم هي نتيجة آخر تشغيل فعلي للسكربت المُلتزَم — لم تُعدَّل يدوياً بعده.

⚠️ **لماذا `storage` تحديداً — قيد صريح على اختيار العيّنة:** تحقّق شامل على الفئات الـ15 لهذا الفحص أظهر أن **الفئتين الوحيدتين** اللتين تحملان دليلاً "مُثبَتاً" حقيقياً (بنصّ `isProvenSupportiveEvidence`: `status="FIRED"`/`outcome="FAIL"`/حرف `C`/`D`) بلا اختلاق قيمة قياس هما `security` (بوّابة `ROOT_DETECTED` مُطلَقة، واختبار `SEC-04` فاشل فعلاً) و`storage` (`deterministicLetter="C"`). `security` أصلاً `D` — تخفيضها لا يُغيّر `letter` ظاهرياً (فرع "الفئة أصلاً D"، `buildV7Payload.js:489-506`) فلا يُظهر انخفاضاً مرئياً. **`storage` اختيرت** لأنها الوحيدة التي تُنتج انخفاضاً مرئياً فعلياً (C→D) بدليل حقيقي بلا اختلاق. بقيّة الفئات الـ13 (بلا دليل مُثبَت حقيقي على هذا الفحص) لا يمكن توليد `LLM_ADJUSTED` عليها هنا إلا باختلاق قيمة قياس — **ممنوع بنصّ المهمّة، لم يُنفَّذ**.

🛑 **تصحيح 2026-09-25 +03 (القرار ٩٤ البند ١ ثم القرار ٩٥ البند ٣) — القسم أعلاه («عيّنة `LLM_ADJUSTED` — مُصطنَعة محلياً») بات تاريخياً غير صحيح على الملفّ الحيّ اليوم، يبقى للسياق فقط:**
القرار ٩٤ البند ١ أغلق قبول الحرف دليلاً للتخفيض **حتى من فئته هو** (نصّ القرار: "لا يُقبل حرف من أيّ فئة... بعد ربط الدليل بالفئة لم يبقَ من أدلّة الحروف إلا حرف الفئة نفسها، وهذا استدلال دائري" — ومثاله الحيّ المذكور في نصّ القرار نفسه هو تعديل `storage` أعلاه بالضبط). نتيجة ذلك: التعديل الاصطناعي أعلاه (`storage`، دليله `categoryStates.categories.storage.deterministicLetter`) **يُرفَض الآن `EVIDENCE_NOT_PROVEN`** — `v7-client-payload-sample-llm-adjusted.json` بعد إعادة توليده لا يحمل أي `letterSource: "LLM_ADJUSTED"` بتاتاً (مُتحقَّق: `grep -c LLM_ADJUSTED` = 0). كتل JSON أعلاه (`"letter": "D"`/`"letterSource": "LLM_ADJUSTED"` على `storage`) **تصف نسخة تاريخية من الملفّ، لا محتواه الحالي** — أُبقيت بلا حذف لتوثيق سياق القرار (القاعدة 17)، لا كوصف دقيق لليوم.

**العيّنة الحقيقية الحالية لحالة `LLM_ADJUSTED` (القرار ٩٥ البند ٣، 2026-09-25 +03)**: بعد أن صار صفر عيّنة ذهبية تحمل `LLM_ADJUSTED` (مُتحقَّق آلياً — `functions/scripts/audit-golden-applied-llm-adjustments.js`)، وُلِّدت عيّنتان جديدتان **عبر السلسلة الحقيقية الكاملة** (`resolveV7Report`→`applyV7Adjustments`→`buildDisplayShapeV7`→`buildReportDocument`، لا استدعاء يدوي مبتور لأجزائها — الفرق الجوهري عن العيّنة أعلاه) بردّ نموذج **مصنوع** (لا نداء فعلي — موسوم بذلك في بياناته الوصفية ومساره مُسجَّل) يستشهد بدليل **حقيقي غير مُختلَق**: `categoryStates.testResults[61].outcome === "FAIL"` لاختبار `SEC-04` (فئة `security`) — الشكل الوحيد الباقي المقبول بعد القرار ٩٤-١:
- **الملفّ المصنوع** (خارج `golden/`، اسمه يُعلن أنه مصنوع): `functions/test/fixtures/frozen-fake-model-response-security-down-sec04-fail-2026-09-25.json`.
- **الشكل B** (مستند `reports/{scanId}`): `functions/test/fixtures/golden/v7-reports-document-sample-security-downgrade.json` (المولّد: `functions/scripts/generate-v7-reports-document-sample-security-downgrade.js`).
- **الشكل C** (ردّ `verifyReport`): `functions/test/fixtures/golden/v7-verifyReport-response-sample-security-downgrade.json` (المولّد: `functions/scripts/generate-v7-verifyReport-response-sample-security-downgrade.js`).
`security` أصلاً `D` (أسوأ درجة) على فِخّ S10 — فالتعديل "يُطبَّق" منطقياً (`applied:true`، `letterSource:"LLM_ADJUSTED"`) بلا انخفاض حرف ظاهري (`fromLetter:"D"`→`toLetter:"D"`، نفس آلية "الفئة أصلاً D" الموثَّقة في `buildV7Payload.js`) — لا انخفاضاً مرئياً كمثال `storage` القديم، لكنه **حقيقي الشكل بالكامل بلا أي جزء مُصطنَع في الدليل نفسه** (الفرق الجوهري: مثال `storage` أعلاه اصطنع قرار التعديل كلّه يدوياً خارج أي ردّ نموذج؛ هذان يمرّان فعلاً عبر حارس الإنتاج نفسه — `guardFinal.ok===true` — على ردّ بمحتوى مصنوع فقط).

⚠️ **توضيح 2026-09-21 +03 (مهمّة لاحقة، جدول §٠-٣/القرار ٣٤) — نطاق الجدول التالي وحضور مفاتيحه:** الحقول الخمسة أدناه (`letter` الوصفي/`confidence`/`tag`/`indicators`/`socAtStart`/`socAtEnd`) **تظهر على `categories.battery` فقط، ولا تظهر على أي فئة أخرى بأي مفتاح** — مُتحقَّق بشرط الكود الوحيد `buildDisplayShapeV7.js:146` (`if (entry.category === 'battery')`)، وبتشغيل فعلي (`v7ContractFieldsGuard.test.js` يفحص غياب `indicators` تحديداً عن الفئات الـ14 الأخرى صراحة). حين الفئة `battery`، الخمسة **حاضرة دائماً كمفاتيح** (`buildDisplayShapeV7.js:151-153` تُسنِد `confidence`/`tag`/`indicators` بلا شرط إضافي داخل كتلة `if`؛ `buildDisplayShapeV7.js:302-309` تُسنِد `socAtStart`/`socAtEnd` بلا شرط كذلك) — القيمة وحدها قد تكون `null` (كما في عيّنة `b45c8cf6`: `confidence=null`، `letter=null` — بطارية بلا عتبة معايَرة، راجع رأس `batteryLayer.js:32-44`).

**حقول إضافية على `categories.battery` فقط** (القرار ٣ — «ثلاث درجات + ثقة، **لا رقم مئوي إطلاقاً**»):

| الحقل | النوع | المعنى |
|---|---|---|
| `letter` | `"سليمة"\|"مؤشّرات تقادم"\|"تقادم واضح"\|null` | ⚠️ **overload متعمَّد لاسم الحقل**: هنا نصّ عربي وصفي، **ليس A-D**. اليوم `null` دائماً على كل فحص متاح (لا عتبة معايَرة بعد — `batteryLayer.js`، `PLAN-03`) |
| `confidence` | `"عالية"\|"متوسّطة"\|"منخفضة"\|null` | ثقة الدرجة (قاعدة الجمع §٤-ج) |
| `tag` | `"ESTIMATED"\|null` | يُعلِم الواجهة أن هذه تقديرات أثر لا قياس مباشر للسعة |
| `indicators` | `Object` | المؤشّرات الأربعة الخام (`BAT-THERMAL-EFF`/`BAT-R-APPARENT`/`BAT-FCC`/`BAT-COULOMB`) بقيمها الفيزيائية ووحداتها (°C/Wh، mΩ، mAh) — **ليست نسبة مئوية**، فلا تخالف القرار ٣. **منذ 2026-09-22 +03**: كل عنصر `indicators.<ID>` يحمل أيضاً `socAtWindowStart`/`socAtWindowEnd` (خام من `lvl[]`، `number\|null`) — راجع الفقرة المُحدَّثة أسفل هذا الجدول |
| `socAtStart` | `number\|null` | مستوى الشحن عند بداية الفحص كلّه (%) |
| `socAtEnd` | `number\|null` | مستوى الشحن عند نهاية الفحص كلّه (%) |

⚠️ **تحديث 2026-09-21 +03 (مهمّة لاحقة، جدول §٠-٣/القرار ٣٤) — `indicators` ليس مخطَّطاً ثابتاً، تحقّق مباشر من `batteryLayer.js`:**
عيّنة حقيقية (`functions/test/fixtures/golden/v7-client-payload-sample.json:categories.battery.indicators`) تُظهر أربع مفاتيح (`BAT-THERMAL-EFF`/`BAT-R-APPARENT`/`BAT-FCC`/`BAT-COULOMB`) بأشكال **غير متجانسة**:
- **مشترك دائماً**: `id`/`status`/`verdict` (من مُساعدَي `abstain()`/`measured()` أنفسهما، `batteryLayer.js:57-63` — كل نداء لأيّ من الدالّتين يمرّ بهما) و`gate` (كل مسار عودة في الملفّ يمرّره صراحة).
- **`gate` نفسها تختلف مفاتيحها** — ليس فقط بين المؤشّرات الأربعة، بل *داخل المؤشّر الواحد* بحسب فرع الامتناع: `BAT-COULOMB` وحدها تُنتج `{n}` فقط عند `n < 2` (`batteryLayer.js:158`) مقابل `{qIntMah, required, passes}` عند فشل بوّابة `Q_int` (`batteryLayer.js:160`) — لا مخطَّط واحد حتى لمؤشّر واحد بعينه.
- **`value`/`unit` مشروطان لا مشتركان**: حاضران فقط حين `status === "MEASURED"` (عبر `measured()`، `batteryLayer.js:61-63`). الاستثناء الوحيد المُتحقَّق منه: `BAT-FCC` مسار `DESIGN_PINNED` (`batteryLayer.js:147-151`) — حالته `ABSTAINED` رغم ذلك، ويحمل `value`/`ratioToDesign`/`designCapacityMah` **بلا** `unit`.
- بقيّة الحقول (`deltaTC`/`energyWh`/`comparedToModelBaseline`/`note` لِـ`BAT-THERMAL-EFF`؛ `vFirst10sMv`/`vUnderLoadMv`/`iUnderLoadUa`/`unitCaveat` لِـ`BAT-R-APPARENT`؛ `intervalCount`/`designCapacityMah`/`ratioToDesign` لِـ`BAT-FCC`؛ `consistencyGateNote`/`consistencyK` لِـ`BAT-COULOMB`) خاصّة بمؤشّر واحد فقط — لا تظهر على الثلاثة الباقية بأي اسم.
- **إضافة 2026-09-22 +03**: `socAtWindowStart`/`socAtWindowEnd` (`number\|null`) — الاستثناء الوحيد للقاعدة أعلاه: **مشتركان على الأربعة كلّهم دائماً** (حتى `ABSTAINED`، ما دامت هناك نافذة عيّنات فعلية استُعملت — راجع الفقرة المُحدَّثة تحت هذه القائمة). القيمة خام من `lvl[]` (v[4]) عند حدّي نافذة العيّنات المُستعملة فعلاً في حساب ذلك المؤشّر تحديداً — لا نقطة واحدة، ولا وسط/تقريب. `null`/`null` حين لا نافذة استُعملت أصلاً (مثلاً `BAT-R-APPARENT` بصفر عيّنة في طور تحت الحمل) — غياب حقيقي، القاعدة 22.

**الأثر على العقد**: تعداد `indicators` حقلاً حقلاً هنا كان سيخترع مخطَّطاً ثابتاً لا وجود له في الكود (تحفّظ صرّح به وكيل التطبيق عند تفكيك العيّنة، مؤكَّد هنا من `batteryLayer.js` لا منفياً). `functions/src/analysis/v7ContractFieldMap.js` (§٠-٣ الآلي، راجع الملاحظة الجديدة أعلى §٠) يُعلِن `categories.battery.indicators` حقلاً **مُبهَماً (OPAQUE) بالاسم صراحة** — الحارس الآلي (`v7ContractFieldsGuard.test.js`) يتحقّق من وجود المفتاح نفسه فقط على `battery` (وغيابه على كل فئة أخرى)، لا مما بداخله. هذا يبقى صحيحاً بعد إضافة `socAtWindowStart`/`socAtWindowEnd` — لم تُعدَّل `v7ContractFieldMap.js`/الحارس (راجع الفقرة التالية).

> ⚠️ **فرق موثَّق عن نصّ الخطّة** (رُصِد أثناء التنفيذ، رُفِق بالكود والاختبارات): P1.5 يقول «مؤشّرات البطارية تُعرض مع مستوى الشحن الذي قيست عنده» و٤-ج يقول «كلّها تُسجَّل مع `socAtStart`» — أي **لكل مؤشّر على حدة**. `batteryLayer.js` **لا يُنتج ذلك فعلياً** — تحقّق مباشر: لا حقل `socAtStart` في أيٍّ من دوال `computeBatThermalEff`/`computeBatRApparent`/`computeBatFcc`/`computeBatCoulomb`. المُنفَّذ هنا: مستوى شحن **واحد لكامل الفحص** (`findings.battery.socAtStart/socAtEnd`)، لا لكل مؤشّر. يحتاج تعديلاً في `batteryLayer.js` (خارج نطاق هذه المهمّة) إن أُريد المستوى الأدقّ.
>
> ✅ **مُغلَقة 2026-09-22 +03 (مهمّة لاحقة، مُوسَمة لا محذوفة — القاعدة 8).** `batteryLayer.js` يُرفِق الآن `socAtWindowStart`/`socAtWindowEnd` على كل مؤشّر من الأربعة (راجع الصفّ الجديد أعلى هذا الجدول والفقرة أدناه لتفصيل حقلاً حقلاً). **الاسم يختلف عمداً عن `socAtStart`/`socAtEnd` الحرفي** في نصّ الخطّة: تحقّق مباشر بقراءة الأربع دوال أظهر أن **لا مؤشّر منها نقطة عيّنة واحدة** — كلّها نوافذ (`BAT-THERMAL-EFF`/`BAT-COULOMB`: 0..n-1، الفحص كاملاً حرفياً، مطابقتان لبعضهما تماماً — لا `BAT-COULOMB` وحدها كما قد يُفهَم من صياغة الفقرة الأصلية أعلاه؛ `BAT-R-APPARENT`: اتّحاد أوّل 10 ثوان وطور تحت الحمل؛ `BAT-FCC`: اتّحاد الفواصل المؤهَّلة بين انتقالات المستوى، الأكثر تجزّؤاً). فنقطة واحدة كانت ستكون قيمة مُخترَعة — النطاق هو التنفيذ الصحيح غير المُخمَّن (نفس المنطق الذي حسم به نصّ أمر هذه المهمّة نفسه: "نطاق أصدق من نقطة مخترَعة"). مُتحقَّق بتشغيل فعلي: `node functions/test/batteryLayer.test.js` → `61/61 assertions passed` (كان 24/24)، يشمل مقارنة مباشرة بـ`sampleInputs.lvl` الخام (لا بالدالّة نفسها) على أربع فِخاخ حقيقية + حالتَي غياب حقيقي (`null`/`null`) اصطناعيتان مُعلَّمتان.

⚠️ **تحديث 2026-09-21 +03 (مهمّة لاحقة، جدول §٠-٣/القرار ٣٤) — تحقّق من صلة `socAtStart`/`socAtEnd` بـ"القرار ٢٢" (اقتراح منقول بنصّ أمر تلك المهمّة: `socAtWindowStart`/`socAtWindowEnd` لكل مؤشّر):**
- **`PLAN-01-ROADMAP.md` غير موجود في هذا المستودع** — تحقّق مباشر: `find . -iname "PLAN*" -not -path "*/node_modules/*"` يُعيد `functions/src/utils/plans.js` فقط (ملفّ كود غير ذي صلة)، صفر نتيجة لأي ملفّ باسم مطابق. `grep -rn "socAtWindowStart\|socAtWindowEnd"` (مُستثنياً `node_modules`/`.claude`) على كامل المستودع يُعيد **صفر نتيجة** أيضاً. فنصّ "القرار ٢٢" وأرقام القرارات المذكورة في رأس هذا الملفّ (`§🔒`، القرارات ١-١٨) **غير قابلة للتحقّق من داخل هذا المستودع** — نفس ما يسجّله رأس `batteryLayer.js:17-18` صراحةً بشأن `REPORT-TO-COORDINATOR.md §٣.١` ("خارج هذا المستودع — لا نسخة منه هنا"). لا يُخمَّن نصّ القرار، يُسجَّل غياب المصدر كما هو (القاعدة 13/14).
- **ما يمكن تأكيده بالكود وحده** (لا افتراض): `socAtStart`/`socAtEnd` المُنفَّذان اليوم مختلفان عن أي اقتراح `socAtWindowStart`/`socAtWindowEnd` لكل مؤشّر في **بُعدين مُتحقَّق منهما**، لا اسم فقط — (أ) **الدقّة**: مستوى شحن واحد لكامل الفحص (`findings.battery.socAtStart/socAtEnd`، مصدره `findings.js` لا `batteryLayer.js`)، لا قيمة مستقلّة لكل من المؤشّرات الأربعة؛ (ب) **موضع الإلحاق**: `buildDisplayShapeV7.js:302-309` يُلحقهما بعد `buildCategoryDisplay` مباشرة على `display.categories.battery` نفسها (مستوى الفئة)، لا داخل كل عنصر من `indicators{}` (مستوى المؤشّر). فإن كان "القرار ٢٢" يقصد حقلاً منفصلاً مُلحَقاً بكل عنصر داخل `indicators.<ID>` فهو **شيء آخر لم يُبنَ بعد**، لا نفس الحقلين بأسماء مختلفة — لا توحيد بالتخمين.
- **تصحيح لملاحظة نُقلت بنصّ أمر مهمّة أخرى**: أمر تلك المهمّة افترض أن `socAtStart`/`socAtEnd` "غير مذكورين في العقد إطلاقاً" — هذا **يخالف ما في هذا الملفّ نفسه** أعلى هذه الفقرة مباشرة (جدول "حقول إضافية على `categories.battery` فقط"، صفّا `socAtStart`/`socAtEnd`) — موجودان وموثَّقان منذ ما قبل هذه الجلسة. راجع رأس هذا الملفّ (القاعدة 14: الأمر ناقض ما في الكود/الوثيقة، فتوقّفتُ وأبلغت بدل تنفيذ تصحيح لشيء غير مكسور).
- ✅ **"الشيء الآخر" أُنجِز الآن 2026-09-22 +03 (موسوم لا محذوف — القاعدة 8):** الحقل المنفصل المُلحَق بكل عنصر داخل `indicators.<ID>` الذي توقّعت الفقرة أعلاه أنه "لم يُبنَ بعد" — مبنيّ الآن باسم `socAtWindowStart`/`socAtWindowEnd` (لا `socAtWindowStart`/`socAtWindowEnd` بنصّ "القرار ٢٢" حرفياً، ذلك النصّ يبقى غير قابل للتحقّق كما هو مُسجَّل أعلاه — لكن نفس الفكرة البنيوية: حقل لكل مؤشّر لا لكل فئة). `socAtStart`/`socAtEnd` على مستوى الفئة **لم يُمسّا ولم يُوحَّدا** مع الجديد (نصّ أمر هذه المهمّة صراحة).

### `display.issues[]`

كل عنصر = عنصر `categoryStates.issues[]` الحتمي (`{id, category, severity, title, evidence?, evidenceUnit?}`) + حقل واحد مُضاف:

| الحقل | النوع | المعنى |
|---|---|---|
| `description` | `string\|null` | نصّ النموذج من `aiAnalysis.narrative.issueDescriptions[id]`. `null` إن لم يكتب النموذج وصفاً لهذا المعرّف — **لا نصّ مُختلَق** |

**المعرّفات نفسها حتمية** (`ISS-<testId>` للفشل/التنبيه، `DISC-<testId>` للإفصاح، `POS-<category>` للإيجابي) — النموذج **يكتب أوصافاً لا يؤلّف قائمة** (P1.4، تعديل 2026-09-20).

⚠️ **تحديث 2026-09-21 +03 (مهمّة لاحقة، جدول §٠-٣/القرار ٣٤) — `evidence?`/`evidenceUnit?` أعلاه (بعلامة "قد يغيب") يصف شكلاً وسيطاً، لا الشكل الذي يصل التخزين/التطبيق فعلياً:**
- **الشكل الخام** (`categoryStates.js:446-460`، `buildDeterministicIssues`): عناصر `ISS-*` (فشل/تنبيه) تحمل `evidence: r.evidence, evidenceUnit: r.evidenceUnit` صراحة (`categoryStates.js:449`) — أمّا عناصر `DISC-*` (`categoryStates.js:452-456`) و`POS-*` (`categoryStates.js:460`) فـ**لا تحمل هذين المفتاحين إطلاقاً** — غياب حقيقي للمفتاح، لا `null`.
- **`buildDisplayShapeV7.js` نفسه لا يُغيّر ذلك**: `buildIssuesDisplay` (`buildDisplayShapeV7.js:206-212`) يبني كل عنصر بـ`Object.assign({}, it, {description})` — يُبقي نفس الغياب على `DISC-*`/`POS-*`، يضيف `description` فقط. فـ`display.issues[]` كما تُنتجه `buildDisplayShapeV7` وحدها **غير متجانس فعلاً**.
- **التطبيع الحقيقي طبقة لاحقة**: `buildIssueForStorage` (`analyzeDevice.js:104-114`) — المُطبَّقة عبر `buildV7ResponseForStorage` على كل من التخزين (`reportRef.set`) والإرجاع للعميل معاً (§٠-١ أعلاه) — تضمن المفاتيح السبعة كلّها حاضرة دائماً على كل عنصر، `evidence`/`evidenceUnit` يسقطان إلى `null` صراحة حين غائبين (`(typeof it.evidence === "string" || typeof it.evidence === "number") ? it.evidence : null`). **هذا هو الشكل الذي يصل `verifyReport`/التطبيق/المخزون** — لا الشكل الخام أعلاه. مُتحقَّق بتشغيل فعلي: `v7ContractFieldsGuard.test.js` يبني عنصر `ISS-*` واحداً على الأقلّ وعنصر `DISC-*`/`POS-*` واحداً على الأقلّ من عيّنة `b45c8cf6` الحقيقية، ويفحص أن كليهما يحملان المفاتيح السبعة نفسها بعد `buildV7ResponseForStorage` — `130/130 assertions passed`.
- **الخلاصة العملية**: علامة `?` في جدول هذا القسم صحيحة لوصف `categoryStates.issues[]` وحده (السطر الأوّل من هذا القسم) — **مضلِّلة** لو قُرئت كوصف لِما يصل التطبيق فعلياً عبر `aiResult`/`aiResponse`. القائمة الآلية المُختبَرة (`v7ContractFieldMap.js:ISSUE_FIELDS`) تصف الشكل النهائي المُطبَّع فقط — سبعة مفاتيح بلا علامة استفهام، كلّها حاضرة دائماً.

### `display.narrative`

تمريرة مباشرة من `aiAnalysis.narrative`، **بلا** `issueDescriptions` (دُمجت في `issues[]` أعلاه بدل تكرارها):

```
{
  summary: string|null, details: string|null, verdict: string|null,
  buyerAdvice: { casual: string|null, gamer: string|null, photographer: string|null }
}
```

`null` حين `aiAnalysis.narrative` غائب أو مشوَّه — لا رمي.

⚠️ **تحديث 2026-09-21 (+03) — القرار ٢٤ (مهمّة `verifyReport` V7، لاحقة لكتابة هذا العقد أصلاً)**: `buyerAdvice` كان نصّاً واحداً `string|null` — **كان ذلك فقدان وظيفة لا إعادة تسمية**: مشترٍ عادي ومهتمّ بالألعاب ومصوّر يحتاجون نصيحة مختلفة من نفس القياسات. صار كائناً بثلاثة ملفّات، كلٌّ منها `string|null` مستقلّ (بُني حقلاً حقلاً في `buildBuyerAdviceDisplay`، لا تمريرة كائن كاملة — كي لا يتسرّب مفتاح رابع يكتبه النموذج بالخطأ). `reportShapeV7.js` يفرض الشكل والمطابقة الرقمية واللغة على الثلاثة كلٌّ على حدة (`narrative.buyerAdvice.<profile>` في `unmatchedFields`/`languageLeaks`، لا مسار واحد كما كان). `resolveV7Report.js` (§٧ بند ١) يحذف كل ملفّ مرفوض على حدة أيضاً — رفض `gamer` وحده لا يُسقط `casual`/`photographer` السليمين.

⚠️ **`predicted_problems` — القرار ٢٥ (نفس المهمّة)، لا يظهر هنا ولا في أي مكان من `display`.** إسقاط مقصود مُعلَّل لا سهو: البوّابات المسمّاة (`ROOT_DETECTED`/`PATCH_AGE` عبر `overall.governingGateReason`) تُخبر المشتري بدليل قياسي مباشر، وتوقّع النموذج (إن وُجد) مكانه `audit.modelObservations` — للمراجع الداخلي لا المشتري. `reportShapeV7.FORBIDDEN_TOP_LEVEL_KEYS` يرفض `predicted_problems`/`predictedProblems` دفاعاً في العمق لو كتبها النموذج رغم أن `systemPromptV7.js` لا يطلبها أصلاً.

⚠️ **S6 (أمر مستخدم 2026-10-01 +03) — انفراط "سطحان لا ثلاثة" على `narrative` تحديداً، أوّل مرّة منذ كتابة هذا العقد:** كل ما سبق في هذا القسم (الكائن بأربعة الحقول، `details`/`verdict` ضمنها) يصف بدقّة **ما يُبنى ويُخزَّن** (`aiResponseToSave`/مستند `reports` — بلا أي تغيير في S6) — **لا يصف ما يصل العميل فعلياً بعد S6**. كلا الموقعين اللذين يُعيدان `narrative` لعميل V7:
- `analyzeDevice.js` — دالّة جديدة `stripNarrativeDetailsVerdictFromV7Response` تُطبَّق على نسخة الإرجاع فقط (الإرجاع النهائي، وإرجاع تقرير V7 محفوظ سلفاً عبر مسار "موجود بالفعل") — المستند المُخزَّن (`reportRef.set`) لا يمرّ بها إطلاقاً.
- `verifyReport.js` — `buildV7Response` لم يَعُد يستدعي `pickNarrative("details", …)`/`pickNarrative("verdict", …)` أصلاً — لا القيمة تُحذَف فقط، بل المفتاحان لا يدخلان `missingKeys` أبداً بصرف النظر عن حضورهما الحقيقي في المستند.

فالشكل العائد للعميل V7 اليوم هو `{summary: string|null, buyerAdvice: {casual, gamer, photographer}}` — بلا `details`/`verdict` إطلاقاً (لا حتى `null`). **الشكل المخزون وحده لا يزال أربعة الحقول** كما في الكتلة أعلاه. الثابت المُصدَّر الآلي المُطابِق لكلّ منهما: `v7ContractFieldMap.js` → `NARRATIVE_FIELDS` (مخزون، بلا تغيير) و`NARRATIVE_RETURNED_FIELDS` (عائد، جديد) — يحرسهما `v7ContractFieldsGuard.test.js` §٥/§٦ معاً. **السبب المُعلَن** (بنصّ الأمر، غير مُتحقَّق من هذا المستودع — القاعدة 29): لا قارئ لـ`details`/`verdict` في الموقع ولا في التطبيق اليوم. **أثر جانبي على تطبيق "datacollect"**: إن كان أحد فروعه يقرأ `aiResponse.narrative.details`/`.verdict` من ردّ `analyzeDevice`/`verifyReport` مباشرة، فسيفقدهما — البديل الموثَّق هنا (لا مُنفَّذ، خارج حدود هذا المستودع): قراءتهما من لوحة المشرف (تقرأ المستند المخزون كاملاً، غير المتأثّر). **`V6` بلا أي مساس** — بنية مختلفة كليّاً، `details`/`verdict` على جذر `aiResult` لا داخل `narrative` متداخلة (`runAnalysisInternal.js`).

### `display.narrativeIncomplete` / `display.narrativeIncompleteFields`

⚠️ **تحديث 2026-09-21 +03 (جلسة لاحقة) — سدّ فجوة مُوثَّقة في «ملاحظة نطاق» أعلى §٠.** حقلان **ليسا** جزءاً من `buildDisplayShapeV7.js` نفسه ولا من جدولَي `overall`/`narrative` أعلاه — بل يُضافان فوق `display` بواسطة طبقة الاستدعاء الأعلى `resolveV7Report.js:316-317` (`display.narrativeIncomplete = narrativeIncomplete; display.narrativeIncompleteFields = droppedDisplayFields;`) **قبل** أن يصل الكائن `analyzeDevice.js`/`verifyReport.js`. ~~**الوصف القديم — مُبقًى موسوماً:** غير حيّين اليوم بنفس سبب §٧ بند ١ (`resolveV7Report.js` غير موصولة بـ`runAnalysisInternal.js`).~~ **تصحيح 2026-09-23 +03 (بعد التبديل، `fd3a6ce`):** حيّان الآن — `resolveV7Report.js` هي المصدر الوحيد لـ`runAnalysisInternal.js`، والحقلان يصلان فعلياً على كل فحص جديد.

| الحقل | النوع | المعنى | المصدر |
|---|---|---|---|
| `narrativeIncomplete` | `boolean` | `true` إن حذف الحارس حقلاً سردياً واحداً على الأقل بعد محاولتي إعادة توليد (القرار ٢١) | `resolveV7Report.js:313,316` (`droppedDisplayFields.length > 0`) |
| `narrativeIncompleteFields` | `string[]` | أسماء الحقول السردية المحذوفة تحديداً (مثال: `["narrative.buyerAdvice.gamer"]`) | `resolveV7Report.js:317` (`droppedDisplayFields`) |

على المسار الحيّ اليوم (`buildDisplayShapeV7` وحده، بلا `resolveV7Report.js`) كلا الحقلين **غائبان تماماً** من `aiResult` — لا `false`/`[]` افتراضيَين، غياب حقيقي (القاعدة 22). هذا هو بالضبط ما يجعل `verifyReport.js` يُسجِّلهما ضمن `missingKeys` على كل تقرير V7 حقيقي اليوم (راجع §٨-أ أدناه — `narrativeIncomplete`/`narrativeIncompleteFields` من ضمن الحقول التي يحرسها اختبار الانحدار).

### `display.pipeline` / `display.language`

`pipeline` ثابت حرفي `"v7_findings_based"` — يميّز شكل الاستجابة نفسه (بالإضافة إلى الحقل top-level `pipeline` في نتيجة `runAnalysisInternal`). `language` = `"ar"|"tr"` كما وصل.

---

## ٤ · `audit` — يُحفَظ ولا يُعرض (القرار ٤ + ٦)

> ⚠️ **تحديث 2026-10-09 (V8 نقل الخامّ):** `aiAudit` لم يعد في مستند `reports/{scanId}` بل في `reportRaw/{scanId}.aiAudit` — انظر §١٤. محتوى `audit` أدناه كما هو.

| الحقل | المعنى |
|---|---|
| `measuredCategoriesMean` | متوسّط الفئات `MEASURED` وحدها (الاسم القديم: `score`). **للتدقيق فقط — لا يصل الواجهة أبداً** |
| `gatesApplied` | البوّابات المسمّاة (خمس مُسمّاة + `LOW_CATEGORY_COVERAGE` لكل فئة) بحالاتها الكاملة — خمس قيم ممكنة منذ 2026-09-23 +03: `FIRED`/`NOT_FIRED`/`INPUT_ABSENT` (مُدخل البوّابة غائب أو غير قابل للقراءة — لا "قِيست ولم يتحقّق الشرط"؛ كانت تُقرَأ خطأً `NOT_FIRED` قبل هذا التاريخ)/`NOT_WIRED`/`DISABLED` — لا حذف صامت |
| `partialBadLetterUngated` | كاشف: فئة `PARTIAL` بحرف C/D سقطت من `overall` بلا بوّابة تمسكها |
| `adjustments` | سجلّ كامل لكل `adjustment` اقترحه النموذج — مُطبَّق/مرفوض وسببه |
| `disputed` | `true` إن اقترح النموذج تعديلاً صعوداً (يُحفَظ ولا يُطبَّق أبداً) |
| `categoryLlmSuggestedLetters` | `{<category>: letter\|null}` — اقتراح النموذج المخالف لكل فئة (إن وُجد) |
| `crossChecks` | تمريرة من `aiAnalysis.crossChecks[]` — للمراجع لا للمشتري |
| `modelObservations` | تمريرة من `aiAnalysis.modelObservations[]` (حدّ ٢، قرار 8) — **للمراجع فقط حتى تكرارية ≥ 9/10** |
| `issueSetHash` / `lettersHash` / `numbersHash` | التجزئات الثلاث من `categoryStates` — انحدار آلي |
| `regeneration` | سجلّ جولات `resolveV7Report.js` (القرار ٢١) — رفض/إعادة توليد. ⚠️ كان غائباً عن هذا الجدول قبل 2026-10-01 +03 رغم وجوده في الكود منذ القرار ٢١ — وثائقي فقط، لا يُختبَر آلياً (راجع تعليق رأس `v7ContractFieldMap.js`: هذا الملفّ عمداً لا يغطّي `audit`). |
| `detailsGuardWaived` | **جديد 2026-10-01 +03** (مهمّة إخفاء القيم غير المعايَرة عن حمولة النموذج، البند ٤) — `{numbers, languageTokens}\|null`. خرق حارس الأرقام/اللغة في `narrative.details` وحده لا يرفض الردّ (details لا يصل المشتري) — يُسجَّل هنا بدل الرفض. `null` إن لم يقع خرق في `details` تحديداً (خرق في حقل آخر يبقى يرفض الردّ كما كان، ولا يظهر هنا). راجع `reportShapeV7.js:guardV7Response`/`DETAILS_WAIVED_FIELD_PATH`. |

---

## ٥ · `reason` على الفئات — رموز مُشتقّة (افتراض تصميم، القاعدة 13)

`PLAN-01` لا ينصّ على قاموس رموز لسبب امتناع الفئة. الرموز أدناه **مُشتقّة حصراً** من حقول موجودة فعلاً في `categoryStates.js` — لا نصّ جديد يُخترَع:

| الرمز | الشرط |
|---|---|
| `HARNESS_ERROR` | `state==="HARNESS_ERROR"` (functionalResults=null)، أو بطارية بلا `batterySampleInputs` |
| `MANUAL_ATTESTATION_ONLY` | `state==="ATTESTED_ONLY"` |
| `NO_HEALTH_BEARING_TESTS_DECLARED` | `state==="UNMEASURED"` و`declaredCount===0` |
| `DECLARED_BUT_NONE_EXECUTED` | `state==="UNMEASURED"` و`declaredCount>0` و`executedCount===0` |
| *(نصّ حرّ)* | البطارية: `categories.battery.noLetterReason` كما ورد من `batteryLayer.js` حرفياً (مثال: `"NO_CALIBRATED_THRESHOLD (PLAN-03 لم يُنجَز — انظر batteryLayer.js)"`) |

---

## ٦ · تصميم إضافي غير منصوص حرفياً (القاعدة 13)

- **`overall.coveragePct`**: القرار ٦ يطلب عرض التغطية دائماً، لا فقط عند `partialAssessment`. `partialAssessmentTag.coveragePct` موجود فقط حين `< 60%`. أضفتُ نسخة على مستوى `overall` مباشرة كي لا يُضطرّ المستهلك لاشتقاق نسبة مئوية من كسر يدوياً.
- **تقسيم `{display, audit}`**: القرار ٤/٦ يقولان «تُحفَظ ولا تُعرض» بلا تحديد آلية. اخترتُ فصلاً صريحاً بكائنين منفصلين بدل الاعتماد على اصطلاح تسمية (مثل بادئة `_internal`) — أقلّ عرضة لتسرّب طارئ إلى الواجهة.

---

## ٧ · ما لا يفعله هذا العقد (خارج نطاقه صراحةً)

1. **لا يفحص `guard.ok`.** استجابة رفضها الحارس (`reportShapeV7.js`) تُنسَّق بنفس الشكل هنا لو استُدعيت — سياسة القبول/الرفض/إعادة التوليد تخصّ طبقة استدعاء أعلى. ⚠️ **تحديث 2026-09-21 — تلك الطبقة صارت موجودة**: `functions/src/analysis/resolveV7Report.js` (القرار ٢١: إعادة توليد مرّة عند رفض الحارس مع قائمة ما رُفض، ثم عرض جزئي عند الرفض الثاني — `narrativeIncomplete`/`narrativeIncompleteFields` على `display`، `audit.regeneration` بسجلّ الجولات). **غير مُوصَلة بـ`runAnalysisInternal.js`** (لا تُستدعى من أي مسار حيّ) — مبنيّة ومُختبَرة بمحاكاة كاملة فقط (`resolveV7Report.test.js`، 63 تحقّقاً)، صفر نداء نموذج حقيقي.
2. **لا يكتب Firestore ولا يحدّد ما يصل التطبيق فعلياً.** ~~ذلك `analyzeDevice.js` — غير مُعدَّل في هذه المهمّة.~~ **لم يعد دقيقاً** — راجع الملاحظة أعلى §٣ (تحديث 2026-09-21، القرار ٢٠): `analyzeDevice.js` يكتب `aiAudit` الآن. يبقى صحيحاً أن `buildDisplayShapeV7.js` نفسه (هذا الملف) لا يكتب Firestore مباشرة — الكتابة تمرّ عبر `analyzeDevice.js` بعد أن يمرّ المخرَج بطبقة الاستدعاء الأعلى (`resolveV7Report.js` حين تُوصَل).
3. **لا يبدّل `runAnalysisInternal.js:292`.** المسار الحيّ اليوم V6 بلا تغيير سلوكي (مُتحقَّق بالاختبار) — يبقى صحيحاً بعد مهمّتَي القرار ٢٠/٢١ أيضاً.
4. **لا نصوص واجهة (UI copy).** الحقول `tag`/`state`/`reason` مفاتيح آلية يترجمها التطبيق/الموقع إلى نصّ — النصوص الثلاثة الإلزامية لعرض البطارية (P1.5: «مؤشّرات البطارية تشير إلى تقادم» إلخ) مسؤولية `NeuralChek`/`wepsite` (بند ٣ من جدول P1.5)، لا هذا الملف.

---

## ٨ · ما يلزم كل مستودع (مُلزِم بنصّ الخطّة — القرار ٥: كسر نظيف)

### `NeuralChek` (التطبيق) — شاشة التقرير (P1.5 البند ٣، لم تُنفَّذ بعد)

**حقول V6 تختفي** (لا تصل بعد التبديل — كسر نظيف، لا قراءة مزدوجة):
`grade` · `score` · `issues[]` (الشكل المسطَّح القديم بلا `id`/`description` منفصلين) · `category_scores`/`categoryScores` · `root_cause` · `predicted_problems` · `buyer_advice` (المفتاح القديم) · `category_notes` · `comparison_with_previous` · `change_analysis` · `overall_score_label` · `confidence_level` · `confidence_note` · `shortId` · `aiModelFromV5` · `performanceContext` · `reasoning_trace`.

**حقول جديدة تصل بدلاً منها** — كل حقول §٣ أعلاه، عبر `aiResult` (لا `aiResultAudit`، ولا `categoryStates`/`findings` الخامّين — تلك للتدقيق الداخلي فقط ما لم يُقرَّر خلاف ذلك).

**تحديداً:** `aiResult.grade` → `aiResult.overall.letter` + `aiResult.overall.letterSource` (اعرض `governingGateReason` حين `letterSource` يبدأ بـ`GATE:`)؛ `aiResult.score` → **لا يوجد بديل مباشر — لا يُعرض إطلاقاً** (القرار ٦)؛ `aiResult.issues[]` → `aiResult.issues[]` (شكل جديد، بحقل `description` منفصل)؛ `aiResult.category_scores.<cat>.grade` → `aiResult.categories.<cat>.letter` + `.state` + `.reason`.

### `wepsite` (الموقع) — نفس شاشة التقرير (P1.5 البند ٣، لم تُنفَّذ بعد)

نفس القائمة تماماً — **القرار ٥ يُلزم التطابق البصري بين الموقع والتطبيق** (U3/U4 في الخطّة). أي حقل يُترجَم في أحد المستودعين يُترجَم بنفس القاموس في الآخر.

---

## ٨-أ · `verifyReport` — قائمة بيضاء V7 العامّة (القرار ٢٣، مهمّة 2026-09-21 +03 لاحقة)

**المصدر:** `functions/src/reports/verifyReport.js`. مسار HTTP عام بلا مصادقة (`?scanId=`) — يخدم مسح رمز QR على تقرير مطبوع/مُرسَل، لا شاشة التقرير داخل التطبيق/الموقع (تلك تقرأ مستند Firestore مباشرة، §٨ أعلاه). ~~**قائمة بيضاء مستقلّة تماماً عن §٣**، أضيق عمداً (لا `narrative`، لا `audit`) — راجع «الفجوات المفتوحة» أسفل هذا القسم.~~
⚠️ **تحديث 2026-09-21 +03 (جلسة لاحقة، بند صريح: "الوصف القديم: ثمانية حقول و45 تحقّقاً. الواقع: الشكل الكامل و85 تحقّقاً"):** الجملة المشطوبة لم تعد دقيقة. `verifyReport.js:271-355` (`buildV7Response`) اليوم يبني **الشكل الكامل** من §٣ تقريباً حرفاً بحرف — بما فيه `narrative` كاملاً (لم يكن في القائمة القديمة) — **الاستثناء الوحيد المتبقّي `audit`/`measuredCategoriesMean`** (القرار ٤/٦: يُحفَظان ولا يُعرضان، بتصميم لا سهواً). راجع الجدول المحدَّث أدناه بدل الجدول القديم (المُبقى موسوماً لا محذوفاً — القاعدة 8) الذي يليه.

### A101 — لماذا هذا القسم موجود

القائمة القديمة (قبل هذه المهمّة) كانت مبنيّة على مفاتيح V6 حصراً وتقرأ `report.aiResponse` بشكله المسطَّح القديم. حين يصير `aiResponse` بشكل V7 (§٣ أعلاه)، كانت تلك القائمة تُعيد افتراضات فارغة لخمسة عشر من ستّة عشر مفتاحاً (`issues` وحدها نجت — تطابق بنيوي مصادف: كلاهما مصفوفة بنفس الاسم) **بلا أي خطأ ظاهر** — الدالّة لا تُخفق، فـ`/verify` تصير فارغة وظيفياً بصمت. الإصلاح: قائمتان بيضاوان صريحتان منفصلتان تماماً، يُختار بينهما بحقل `report.pipeline`.

### التمييز — `report.pipeline`

```
"v7_findings_based"   →  قائمة V7 البيضاء (أدناه)
"v6_raw_timeseries"   →  قائمة V6 البيضاء — دون تغيير سلوكي عمّا كانت عليه
غياب الحقل (undefined/null) →  قائمة V6 — كل المخزون قبل هذه المهمّة، بلا استثناء واحد
أي قيمة أخرى غير متوقَّعة  →  تُسجَّل بتحذير (console.warn، لا صمت — القاعدة 22)، وتُعامَل قائمة V6 احتياطاً
```

⚠️ **كسر نظيف يخصّ ما يُنتَج من الآن، لا ما صدر وبيد الناس.** ورمز QR مطبوع على تقرير قديم يجب أن يظلّ يعمل — القرار ٥ («لا شكل مزدوج») يخصّ شكل الإنتاج، لا قراءة المخزون. الازدواج هنا في القراءة وحدها ومؤقّت، والتمييز صريح بحقل لا باستنتاج من وجود مفاتيح.

**موعد إزالة قائمة V6:** بعد أن يُعاد توليد كل التقارير عبر V7 (`P1.6`)، تبقى قائمة V6 في الكود **ستّة أشهر** إضافية (كل تقرير غير مُعاد توليده لا يزال يُعرض بها)، ثم تُزال. **هذا التاريخ مرجعي فقط** — لا `P1.6` منجَزة بعد ولا تاريخ نشر V7 الأول معروف وقت كتابة هذا القسم؛ عدّ الستّة أشهر يبدأ من تاريخ اكتمال `P1.6` الفعلي لا من تاريخ هذا القسم.

⚠️ **نزاع مصدر — مُوثَّق لا محسوم بالتخمين (القاعدة 14):** أمر منسّق أثناء هذه المهمّة نصّ على القيمة `"v7_deterministic"` للتمييز. البحث في كامل المستودع (`grep -rn "v7_deterministic"`، مُستثنياً `node_modules`/`.claude`) يُعيد **صفر نتيجة**؛ بينما `"v7_findings_based"` تظهر في 14 ملفاً منها اختبارات حيّة تُثبت السلوك فعلياً: `pipelineField.test.js`، `runAnalysisInternalV7Branch.test.js`، `buildDisplayShapeV7.test.js`، `callAIv7.test.js` — إضافة إلى المصدر نفسه: `buildDisplayShapeV7.js:64` (`PIPELINE_TAG`)، `runAnalysisInternal.js:459`، `analyzeDevice.js:323`. القيمة المُطبَّقة في `verifyReport.js` هي `"v7_findings_based"` — مأخوذة من الكود/الاختبارات القائمة، **لا من نصّ أمر المنسّق**. `functions/test/verifyReportV7Whitelist.test.js` (تحقّق 0) يحرس تطابق `verifyReport.js` مع `buildDisplayShapeV7.PIPELINE_TAG` آلياً فلا يفترق الملفّان صامتاً. يُترَك للمستخدم أن يقرّر: هل `"v7_deterministic"` اسم كان مقصوداً (فيلزم تغيير `PIPELINE_TAG` نفسه في كل الملفّات الأربعة عشر) أم سهو في نصّ الأمر؟

### الحقول — الوصف القديم (قبل 2026-09-21 +03، مُبقًى موسوماً — القاعدة 8، لا يُعتمَد)

~~على `pipeline === "v7_findings_based"`، `verifyReport` يبني `response.aiResponse` من هذه المفاتيح **فقط** — كائن حرفي، لا تمرير لمستند `report`/`ai` كاملاً:~~

~~| الحقل | المصدر في `aiResponse` المخزون | ملاحظة |~~
~~|---|---|---|~~
~~| `pipeline` | ثابت `"v7_findings_based"` | يُعلن الشكل للمستهلك |~~
~~| `letter` | `overall.letter` | |~~
~~| `coverage` | `overall.coverage` | كسر 0..1 — **ليس** `coveragePct` |~~
~~| `partialAssessment` | `overall.partialAssessment` | boolean |~~
~~| `letterSource` | `overall.letterSource` | |~~
~~| `governingGateReason` | `overall.governingGateReason` | تمريرة حرفية `{name, ceilingLetter, source}\|null` |~~
~~| `categories` | `aiResponse.categories` | تمريرة كاملة |~~
~~| `narrativeIncomplete` | `aiResponse.narrativeIncomplete` | — |~~
~~| `issues` | `aiResponse.issues` | نجت من القائمة القديمة |~~

~~هذه الثمانية + `issues` الناجية كانت القائمة الكاملة. حقول أخرى من §٣ (`partialAssessmentTag`، `noDataAtAll`/`zeroMeasuredMessage`/`abstentionReasons`، `harnessError`/`harnessErrorReason`، `narrative` بأكمله) كانت "فجوات مفتوحة" موثَّقة — غير مُضافة لأن نصّ أمر تلك الجلسة لم يذكرها.~~ `functions/test/verifyReportV7Whitelist.test.js` وقتها: 45 تحقّقاً.

### الحقول — الوصف الحالي (2026-09-21 +03، جلسة لاحقة: "الشكل الكامل")

على `pipeline === "v7_findings_based"`، `verifyReport.js:271-355` (`buildV7Response`) يبني `response.aiResponse` من هذه المفاتيح **فقط** — كائن حرفي، لا `spread`. **كل الفجوات المذكورة في النسخة القديمة أعلاه أُغلقت** — القائمة صارت مطابقة لِـ§٣ بالكامل عدا `audit`/`measuredCategoriesMean` (باقيان مُستبعَدان بتصميم، القرار ٤/٦):

| الحقل | المصدر في `aiResponse` المخزون | ملاحظة |
|---|---|---|
| `pipeline` | ثابت `"v7_findings_based"` | يُعلن الشكل للمستهلك (`verifyReport.js:316`) |
| `language` | `ai.language` أو `rep.language` أو `"ar"` | `verifyReport.js:303-304,317` |
| `letter` | `overall.letter` | `verifyReport.js:318` |
| `letterSource` | `overall.letterSource` | `verifyReport.js:319` |
| `coverage` | `overall.coverage` | كسر 0..1 — `verifyReport.js:320` |
| `coveragePct` | `overall.coveragePct` | **مُضافة الآن** (كانت غائبة في القائمة القديمة) — `verifyReport.js:321` |
| `partialAssessment` | `overall.partialAssessment` | boolean — `verifyReport.js:322` |
| `partialAssessmentTag` | `overall.partialAssessmentTag` | **مُضافة الآن** — `{label, coveragePct, text}\|null` — `verifyReport.js:323` |
| `governingGateReason` | `overall.governingGateReason` | تمريرة حرفية `{name, ceilingLetter, source}\|null` — `verifyReport.js:324` |
| `noDataAtAll` | `overall.noDataAtAll` | **مُضافة الآن** — boolean — `verifyReport.js:325` |
| `zeroMeasuredMessage` | `overall.zeroMeasuredMessage` | **مُضافة الآن** — `verifyReport.js:326` |
| `abstentionReasons` | `overall.abstentionReasons` | **مُضافة الآن** — `verifyReport.js:327` |
| `harnessError` | `overall.harnessError` | **مُضافة الآن** — boolean — `verifyReport.js:328` |
| `harnessErrorReason` | `overall.harnessErrorReason` | **مُضافة الآن** — `verifyReport.js:329` |
| `harnessErrorMessage` | `overall.harnessErrorMessage` | **مُضافة الآن** (ملحق verifyReport، أمر مستخدم 2026-10-01 +03، القسم ٥) — جملة عرض عربية جاهزة بجوار `harnessErrorReason` الخامّ (S3، `categoryStates.js:harnessErrorDisplayMessage`) — `verifyReport.js:335` |
| `categories` | `aiResponse.categories` | تمريرة كاملة (كل الفئات الـ15 بحقولها من §٣) — `verifyReport.js:336` |
| `issues` | `aiResponse.issues` | شكل V7 الغنيّ `{id, category, severity, title, description, ...}` — `verifyReport.js:337` |
| `narrative.summary` | `narrative.summary` | **مُضافة الآن** — كانت فجوة موثَّقة بالكامل — `verifyReport.js:347` |
| `narrative.details` | `narrative.details` | ~~مُضافة الآن~~ — **لم تَعُد تصف الكود اليوم (S6)**، راجع تنبيه 2026-10-01 +03 أسفل الجدول |
| `narrative.verdict` | `narrative.verdict` | ~~مُضافة الآن~~ — **لم تَعُد تصف الكود اليوم (S6)**، راجع نفس التنبيه |
| `narrative.buyerAdvice.casual/gamer/photographer` | `narrative.buyerAdvice.<profile>` | **مُضافة الآن** — ثلاثة حقول مستقلّة (القرار ٢٤) — `verifyReport.js:349-351` |
| `narrativeIncomplete` | `aiResponse.narrativeIncomplete` | `resolveV7Report.js` (غير مُوصَل بعد) يُنتجها فعلياً — على المسار الحيّ اليوم تصل دائماً `undefined` فتُسجَّل «غائبة» وتُعامَل `false` — `verifyReport.js:298-299,354` |
| `narrativeIncompleteFields` | `aiResponse.narrativeIncompleteFields` | **مُضافة الآن** — `verifyReport.js:300-302,355` |

**ملاحظة تحديث سطور 2026-10-01 +03**: إضافة `harnessErrorMessage` (6 أسطر، تعليق+كود) أزاحت كل سطر `verifyReport.js` بعدها بمقدار 6 — الأرقام أعلاه مُحدَّثة لتعكس ذلك (`categories` كانت `:330`، صارت `:336`؛ وهكذا).

**خارج القائمة بتصميم لا سهواً:** `audit`/`measuredCategoriesMean`/`gatesApplied`/`crossChecks`/`modelObservations`/إلخ (القرار ٤/٦: للتدقيق الداخلي لا للمستهلك العام عبر QR). `aiAudit` (حقل المستند) **خارج هذه القائمة كما كان** (القرار ٢٠) — `verifyReport.js` لا يقرأه من `report` أصلاً. الاختبار الذي يحرس غيابه (`verifyReportAuditExclusion.test.js`، 25/25) **بقي بلا تعديل** — يبني `response` من `report.aiResponse` القديم (V6)، فيسقط في فرع V6 كما كان، ويُثبت الاستبعاد على ذلك الفرع. `verifyReportV7Whitelist.test.js` يُثبت الاستبعاد على فرع V7 تحديداً كدفاع في العمق.

**اختبار الانحدار (القاعدة 22):** أيّ حقل من القائمة أعلاه غائب فعلياً من `aiResponse` المخزون → قيمة افتراضية آمنة (`null`/`false`/`{}`/`[]` بحسب النوع) **مع تحذير مُسجَّل يسمّي الحقل بالضبط** (`verifyReport — تقرير V7 (scanId=...) بلا حقول display متوقَّعة: [...]`) — لا `{}`/`[]`/`null` بلا أثر. مُتحقَّق بتشغيل فعلي: `node functions/test/verifyReportV7Whitelist.test.js` → `85/85 assertions passed` (راجع تقرير المهمّة تحت «قياس قبل/بعد»).

⚠️ **تحديث 2026-10-01 +03 (S6، أمر مستخدم) — الصفّان `narrative.details`/`narrative.verdict` في الجدول أعلاه لم يَعُودا يصفان `verifyReport.js` اليوم.** `buildV7Response` لم يَعُد يستدعي `pickNarrative("details", …)`/`pickNarrative("verdict", …)` أصلاً — الحقلان غائبان تماماً عن `narrative` في الردّ (لا `null` حتى)، ولا يدخلان `missingKeys`/التحذير أبداً (بخلاف بقيّة الجدول). الصفّان أعلاه **مُبقيان موسومَين لا مُعدَّلين** (القاعدة 8: لا حذف) — الوصف الصحيح اليوم في الفقرة الجديدة تحت `display.narrative` في §٣ أعلاه (`NARRATIVE_RETURNED_FIELDS`). المستند المخزون بلا أي مساس. `verifyReportV7Whitelist.test.js` يحرس هذا صراحة الآن (سطور S6 فيه) — ~~84/84~~ **87/87 assertions passed** (تحديث لاحق أدناه).

⚠️ **تحديث 2026-10-01 +03 (ملحق verifyReport، أمر مستخدم، القسم ٥) — `harnessErrorMessage` انضمّ إلى الجدول أعلاه** (`overall.harnessErrorMessage` → `verifyReport.js:335`، صفّ جديد بجوار `harnessErrorReason`) — ثلاثة عشر حقلاً داخل `overall` الآن لا اثني عشر. مُتحقَّق بتشغيل فعلي: `node functions/test/verifyReportV7Whitelist.test.js` → `87/87 assertions passed` (كان 84/84 قبل هذا الملحق — +3: السطر الإيجابي، سطر القيمة الافتراضية، وانضمامه لقائمة الحقول الناقصة المُتوقَّعة).

### الفجوات المفتوحة — الوصف القديم (لم تعد فجوات، مُبقًى موسوماً — القاعدة 8)

~~القائمة أعلاه الثمانية المذكورة صراحةً في أمر المهمّة فقط... `partialAssessmentTag` · `noDataAtAll`/`zeroMeasuredMessage`/`abstentionReasons` · `harnessError`/`harnessErrorReason` · `narrative` كاملاً — كانت غائبة عمداً، القرار بشأنها للمستخدم.~~

**أُغلقت جميعها 2026-09-21 +03 (جلسة لاحقة)** — الجدول أعلاه («الوصف الحالي») يحمل الأربعة كلّها فعلياً الآن (كل صف مُعلَّم «مُضافة الآن»). لا فجوة مفتوحة معروفة اليوم بين §٣ والقائمة البيضاء هنا عدا `audit`/`measuredCategoriesMean` (باقيان بتصميم، ليسا فجوة).

---

## ٩ · مثال كامل — `b45c8cf6` (S10 مجذَّر)، استجابة نموذج حقيقية

**المصدر:** `functions/scripts/out/v7-display-shape-b45c8cf6-example.json` — ناتج تشغيل فعلي لـ`buildDisplayShapeV7` على `categoryStates`/`findings` الحقيقيَّين لـ`b45c8cf6` + `aiAnalysis.narrative` **حقيقي** من `functions/scripts/out/v7-live-b45c8cf6-e376-4765-8703-f68e9bc69844.json` (أحد النداءين المأذونين الحقيقيَّين على `callAIv7`، مهمّة سابقة).

⚠️ **تنبيه أمانة**: ذلك النداء نفسه حمل `guard.ok=false` (`numbers.ok=false` — أرقام في `narrative.details`/`buyerAdvice`/`modelObservations` لم تُطابق مرجعاً؛ راجع `v7-live-b45c8cf6-*.json:guard`). أي أن هذا **السرد تحديداً** كان سيُرفَض/يُعاد توليده في الإنتاج — لكن **بنية `display`/`audit`** (الفئات، `overall`، `issues[]`، `audit.*`) صحيحة ومُشتقّة بالكامل من بيانات حتمية (`categoryStates`/`findings`)، لا من النموذج، فتبقى الاستجابة تشخيصاً موثوقاً لِـ"كيف يبدو الشكل" بصرف النظر عن مصير هذا السرد بعينه.

راجع الملف الكامل (660 سطراً) للنصّ الحرفي؛ ملخّص `overall`:

```json
{
  "letter": "C", "letterSource": "GATE:ROOT_DETECTED",
  "coverage": 0.4503809523809524, "coveragePct": 45,
  "partialAssessment": true,
  "partialAssessmentTag": {"label": "تقييم جزئي", "coveragePct": 45, "text": "تقييم جزئي — تغطية 45%"},
  "governingGateReason": {"name": "ROOT_DETECTED", "ceilingLetter": "C", "source": "SEC-04=fail"},
  "noDataAtAll": false, "zeroMeasuredMessage": null, "abstentionReasons": null,
  "harnessError": false, "harnessErrorReason": null
}
```

15 فئة، 31 عطباً (بوصف نموذج حقيقي على معظمها)، `audit.measuredCategoriesMean=100` (لا يُعرض)، `audit.gatesApplied` يحمل البوّابات الخمس.

---

## ١٠ · الاختبارات المرجعية

- `functions/test/batteryLayer.test.js` — **61 تحقّقاً** (كان 24 قبل 2026-09-22 +03 — 37 تحقّقاً جديداً لـ`socAtWindowStart`/`socAtWindowEnd`، سدّ فجوة §٣ "مستوى الشحن لكل مؤشّر"؛ الاختبار نفسه أقدم من هذه المهمّة، لم يكن مُدرَجاً في هذه القائمة — سهو في القسم لا في الاختبار، مثل ملاحظة `buildV7Payload.test.js` أدناه). مُتحقَّق بتشغيل فعلي `node functions/test/batteryLayer.test.js` → `61/61 assertions passed`: مقارنة مباشرة بـ`sampleInputs.lvl` الخام (لا بالدالّة نفسها) على أربع فِخاخ حقيقية لِـ`BAT-THERMAL-EFF`/`BAT-COULOMB` (نافذة الفحص كاملاً) وإعادة اشتقاق مستقلّة لِـ`BAT-R-APPARENT` (اتّحاد أوّل 10ث وتحت الحمل)، + `BAT-FCC` (`MEASURED` فعلياً على 8909e850، النافذة داخل مدى الفحص) + حالتَي غياب حقيقي (`null`/`null`) اصطناعيتان مُعلَّمتان تُميِّزان الغياب عن الامتناع عن الحكم (`BAT-THERMAL-EFF` يمتنع لكن نافذته معروفة).
- `functions/test/buildDisplayShapeV7.test.js` — ~~202 تحقّقاً (كان 200 قبل القرار ٢٤)~~ ~~254 تحقّقاً~~ ~~255 تحقّقاً~~ **276 تحقّقاً** (2026-09-22 +03، مهمّة لاحقة أخرى — `letterCeilingReason`، 21 تحقّقاً جديداً: قيمة النصّ الفعلي على `gpu`/`gps`/`display` من `b45c8cf6` الحقيقي + `null` على `cpu`/`security` + وحدات `arabicTestCount`/`buildLowCoverageCeilingDisplayText`/`buildCategoryLetterCeilingReason`). مُتحقَّق بتشغيل فعلي: `node functions/test/buildDisplayShapeV7.test.js` → `276/276 assertions passed`.
- `functions/test/buildV7Payload.test.js` — ~~88 تحقّقاً~~ **110 تحقّقاً** (القرار ٤٢: البند ١ — التحقّق من الدليل (وجود/غياب صريح)، والبند ٢ — A62 (`finalLetter` لا `deterministicLetter`)). **تصحيح 2026-09-21 +03 (مهمّة لاحقة أخرى):** الرقم "88" أعلاه كان صحيحاً عند كتابته؛ تحقّق مباشر بتشغيل فعلي في هذه المهمّة (مرّتين متتاليتين) `node functions/test/buildV7Payload.test.js` → `110/110 assertions passed` كلا المرّتين. نفس ملاحظة `buildDisplayShapeV7.test.js` أعلاه — انحراف غير مُفسَّر، غير ناتج عن عمل هذه المهمّة، مُسجَّل لا مُخمَّن. غير مُدرَج في هذه القائمة قبل الجلسة التي أضافته (سهو في القسم، لا الاختبار — الملفّ موجود منذ P1.4).
- `functions/test/v7ContractFieldsGuard.test.js` — ~~130 تحقّقاً~~ **134 تحقّقاً** (مهمّة 2026-09-21 +03، القرار ٣٤ + القاعدة 25 — الحارس ثنائي الاتّجاه لعقد شكل V7؛ راجع §٠ أعلاه و`v7ContractFieldMap.js`. تحديث 2026-09-22 +03: +4 تحقّقات لشكل `categories.<cat>.letterCeilingReason` المتداخل — حضور != null على `gpu`، مطابقة `CATEGORY_LETTER_CEILING_REASON_FIELDS`، وقيمة `null` الحقيقية على `cpu`). يبني الخرج الفعلي من عيّنة `b45c8cf6` عبر خط الأنابيب الكامل (`applyV7Adjustments`→`buildDisplayShapeV7`→`buildV7ResponseForStorage`→`+V7_OPERATIONAL_FIELDS`) ويقارن مفاتيحه بـ`v7ContractFieldMap.js` في الاتّجاهين معاً على كل مستوى (الجذر/`overall`/`partialAssessmentTag`/`governingGateReason`/كل فئة حاضرة/`issues[]`/`narrative`/`buyerAdvice`) — مُتحقَّق بتشغيل فعلي `node functions/test/v7ContractFieldsGuard.test.js` → `134/134 assertions passed`. مُتحقَّق أيضاً أن مقارنة المفاتيح نفسها ليست حارساً صامتاً (نفس عطب `A102`): تشغيل يدوي بمدخلات اصطناعية مُختلَقة قصداً (حقل زائد/حقل ناقص) أظهر فشلاً فعلياً برسالة تسمّي الحقل — لا اختبار "يمرّ لأنه لا يفحص".
- `functions/test/runAnalysisInternalV7Branch.test.js` — 20 تحقّقاً، الوصل الفعلي داخل `runAnalysisInternal.js`.
- `functions/test/reportShapeV7.test.js` — 57 تحقّقاً، الحارس (شكل/أرقام/لغة) — يشمل القرار ٢٤ (buyerAdvice ثلاثة حقول) والقرار ٢٥ (`predicted_problems`/`predictedProblems` مرفوضان دفاعاً في العمق).
- `functions/test/resolveV7Report.test.js` — 66 تحقّقاً، سياسة رفض الحارس (القرار ٢١) — يشمل حذف ملفّ `buyerAdvice` واحد بدقّة دون الآخرين.
- `functions/test/callAIv7.test.js` — 19 تحقّقاً، نداء V7 الكامل (مُحاكى).
- `functions/test/verifyReportV7Whitelist.test.js` — (القرار ٢٣) — ~~45 تحقّقاً~~ ~~85 تحقّقاً~~ **87 تحقّقاً** (آخرها 2026-10-01 +03، ملحق verifyReport — `harnessErrorMessage`؛ مُتحقَّق بتشغيل فعلي `87/87 assertions passed`): تقرير V7 كامل، تقرير V7 ناقص (اختبار الانحدار — حقل غائب يُسجَّل لا يُصمَت)، `pipeline` صريحة V6، `pipeline` غائبة، `pipeline` غير معروفة، وحراسة تطابق `V7_PIPELINE_TAG` مع `buildDisplayShapeV7.PIPELINE_TAG`.
- `functions/test/verifyReportAuditExclusion.test.js` — 25 تحقّقاً، **بلا تعديل** في هذه المهمّة (القرار ٢٠) — يبقى على فرع V6.
- `functions/test/aiAuditWiring.e2e.test.js` — ~~28 تحقّقاً~~ **33 تحقّقاً** (2026-09-21 +03، جلسة لاحقة — القرار ٤٢: حالة 7 جديدة (A112 — كل مفتاح top-level في الإرجاع V7 من `aiResponseToSave` أو `V7_OPERATIONAL_FIELDS`، لا ثالث صامت) + تحقّقان داخل حالة 5 (`deviceMarketingName`) + تحقّق داخل حالة 6 (`letterSource`/`adjustmentReason`/`adjustmentEvidence`)؛ يحتاج محاكي Firestore — `firebase emulators:exec --only firestore --project demo-nc "node functions/test/aiAuditWiring.e2e.test.js"` — مُتحقَّق بتشغيل فعلي `33/33 assertions passed`).

---

> **ملاحظة ترقيم (وكيل الباك اند، 2026-09-24 +03):** القسم أدناه وصلني نصّاً
> جاهزاً من المنسّق مرقَّماً "## ١٠" (القرار ٧٥ البند ٨/القرار ٧٣ س١) —
> يُصادم عنوان §١٠ القائم أعلاه ("الاختبارات المرجعية"). غيّرتُ رقم العنوان
> فقط إلى "١١" (الأقرب لموضع الإلحاق الفعلي، آخر الملفّ) — لم أُغيّر حرفاً
> واحداً من المتن. هذا تصحيح ترقيم لا تعديل محتوى (القاعدة 14 تخصّ تناقض
> الكود، لا تعارض ترقيم داخل نصّ مصدره خارج هذا المستودع؛ أُبلغ به هنا
> بدل تنفيذه بصمت).

## ١١ · `rawFingerprint.device.deviceProfileKey` — **أسماء يضعها R8، لا مخطَّط** · 2026-09-24 (+03)

> ⚠️ **تحديث 2026-10-09 (V8 نقل الخامّ):** `rawFingerprint` صار في `reportRaw/{scanId}.rawFingerprint`، فالمسار الحالي `reportRaw.rawFingerprint.device.deviceProfileKey` — انظر §١٤. وتقارير ما قبل الترحيل تحمله مضمَّناً في المستند حتى يقول التحقّق 0.

> **كتبه المنسّق** بقرار المستخدم (القرار ٧٣ س١، والقرار ٧٥ البند ٨): «يُكتب قسماً في وثيقة العقد القائمة … أسماء الحقول a..f، ومصدرها R8، ومرجعها mapping.txt بـ pg-map-id، وأثرها».
> **ما يخصّ التطبيق منقول، ومتحقَّق بالأداة في مساحة العمل. لكنه غير متحقَّق من هذا المستودع** (القاعدة 29).

**ما ترسله نسخة الإصدار (`launchRelease`):** `deviceProfileKey = {a, b, c, d, e, f}`.

| الحقل في الكود | في الإصدار |
|---|---|
| `primary` | `a` |
| `layerA_keystore` | `b` |
| `layerB_firebaseId` | `c` |
| `layerC_androidId` | `d` |
| `layerD_buildSig` | `e` |
| `layerE_sensorSig` | `f` |

- **مصدر الأسماء R8، لا قرار تصميم.** الصنف `net.neuralcheck.util.DeviceProfileKey` (`NeuralChek:app/src/main/java/net/neuralcheck/util/DeviceFingerprint.kt:49-56`) حقوله بلا `@SerializedName`. ولا قاعدة keep في `app/proguard-rules.pro` تشمل `net.neuralcheck.util`.
- **المرجع** (محفوظ في مساحة العمل، في `evidence/`):
  - بناء 2026-06-09: `mapping.txt:520096-520101`، و`pg_map_id: 34e6950`.
    - **وهو يطابق APK الموقع** `wepsite/public/download/NeuralCheck.apk`: sha256 `5a3d3169…`، و`"pg-map-id":"34e6950"` في DEX.
  - بناء 2026-09-20: `mapping.txt:522855-522860`، و`pg_map_id: f84417b`، ويطابق `dist/NeuralCheck-launch-release-97b88c9.apk`.
    - **الحروف نفسها لكل حقل في البناءين.**
- **نسخة التطوير (debug، بلا تصغير) ترسل الأسماء الكاملة.**

**ما يقرؤه هذا المستودع:**
- `a`، في `profiles/findDeviceProfile.js:17` و`analysis/analyzeDevice.js:597` و`profiles/createDeviceProfile.js`.
- **والطبقات بالأسماء الكاملة:** `layerA_keystore … layerE_sensorSig`، في `findDeviceProfile.js:48-50,76-77` عند `e5296f0`.

**الأثر:**
- **البحث الاحتياطي بالطبقات معطَّل منذ 2026-05-14** (`6e8f548`).
- `createDeviceProfile` **يكتب الطبقات الخمس قيمَ حارس**: `no_keystore` · `no_fid` · `no_android_id` · `unknown` · `no_sensors`.
- **ونسخة التطوير لا تُنشئ ملفّ جهاز**، لأن المستودع يشترط `a`.

**الحارس:** بناء release في التطبيق يرفض أيّ تغيّر في هذه الحروف (`NeuralChek` `checkDeviceProfileKeyMapping`، `d900682`).

**المؤجَّل:** تثبيت الأسماء بـ`@SerializedName`، مع قراءة `b..f` هنا، **بعد الفحص الميداني الثاني.** «ويُقاس أثره على مطابقة الأجهزة قبل تنفيذه». — **نُفِّذ جانب الخادم 2026-10-09 (انظر التحديث أدناه)؛ وجانب التطبيق بيد وكيل التطبيق.**

### تحديث 2026-10-09 (+03) — القراءة المتوافقة للاسمين (V8 قبل نشر الأمان)

> **قرار المستخدم، بنصّه:** «القراءة المتوافقة للاسمين (deviceProfileKey.a وprimary معاً) تدخل نشر الأمان هذا، بنداً رابعاً لوكيل الخادم، مع اختبار على الحمولتين.»
> **ومعه سياقه:** «أسماء R8 (a..f) في deviceProfiles: هو الخطوة الأولى في إصلاح مفتاح الجهاز. keep أو SerializedName في التطبيق، وقراءة متوافقة في الخادم، واختبار على حمولة الإصدار الحقيقية لا debug.»

- **مُطبِّع واحد** (القاعدة 24): `functions/src/profiles/deviceProfileKey.js` · `normalizeDeviceProfileKey(raw)` يقبل الشكلين ويُرجع الأسماء الكاملة الستّة، ويُعلن ما لم يجده (القاعدتان 22 و25). **ولا قارئ حيّ يقرأ `.a` أو `.primary` أو `.layerX_…` مباشرةً بعد اليوم:** يُفشل ذلك `functions/test/deviceProfileKey.test.js` (§٤ فيه)، وهو يثبّت قائمة القرّاء الخمسة أدناه (قارئ جديد يُضاف هنا وفي الاختبار معاً).
- **الأسماء** (جدول هذا القسم أعلاه؛ والاختبار يقارنه بنسخة مستقلّة من نصّ الأمر وبالمُطبِّع): `primary→a` · `layerA_keystore→b` · `layerB_firebaseId→c` · `layerC_androidId→d` · `layerD_buildSig→e` · `layerE_sensorSig→f`.

**الأشكال الثمانية** (يُكتب اسم الشكل في سطر السجلّ `[ProfileLookup] deviceProfileKey shape=… usable=…`، بأسماء الحقول لا قيمها):

| الشكل | معناه | يُستعمل؟ |
|---|---|---|
| `FULL_NAMES` | الأسماء الكاملة وحدها (debug، أو التطبيق بعد keep/@SerializedName) | نعم |
| `R8_SHORT_NAMES` | `a..f` وحدها (إصدار 1.0.10 المُصغَّر) | نعم |
| `MIXED_FORMS` | الشكلان معاً بلا حقل منطقي مذكور مرّتين (مثل `a` + `layerA_keystore`) | نعم (لا غموض) |
| `BOTH_FORMS_AGREE` | الشكلان معاً، وحقل مذكور بالاسمين بقيمة واحدة، بلا تعارض | نعم |
| `BOTH_FORMS_CONFLICT` | الشكلان معاً، وحقل مذكور بالاسمين بقيمتين مختلفتين | **لا** — المفتاح كلّه مرفوض |
| `UNRECOGNIZED` | كائن بلا أيّ اسم من الاثني عشر | لا |
| `NOT_AN_OBJECT` | نصّ أو رقم أو مصفوفة أو منطقي | لا |
| `ABSENT` | `null`/غائب | لا |

- **قرار الشكلين المتعارضين:** لا يُستعمل أيّ منهما؛ لا بحث ولا كتابة لملفّ الجهاز، ويمضي الفحص كأوّل فحص (كاش فائت لا غير). **السبب:** الأساسي يحدّد ملفّ الجهاز وقرار إعادة التقرير المخبَّأ؛ فاختيار الاسم الخطأ يُلحق بجهاز تاريخ جهاز آخر ويُعيد له تقريره. وتعارض كهذا لا يصدر من تطبيق سليم، فهو عطب أو عبث، والفشل المغلق أرخص من تخمين. ويُسجَّل `reason=FORMS_CONFLICT conflicts=[<أسماء كاملة>]`.
- **الأساسي** الغائب أو غير الصالح (`PRIMARY_MISSING` / `PRIMARY_INVALID`) يجعل المفتاح غير قابل للاستعمال؛ والأساسي `unknown_fp` (القيمة الاحتياطية التي يرسلها التطبيق، `UNKNOWN_PRIMARY` في المُطبِّع وحده) تتخطّاه القرّاء بسطر مسمّى `primary is unknown_fp`.

**القرّاء الحيّون الخمسة** (كلهم عبر المُطبِّع؛ أرقام الأسطر عند الالتزام):

| الملفّ:السطر | ما يقرؤه |
|---|---|
| `profiles/findDeviceProfile.js:17` | الأساسي ثم الطبقات (البحث بالأساسي، ثم `layerA/B/C` فيطابق بحقولها في المستند، ثم `layerD+E`) |
| `profiles/createDeviceProfile.js:40` | الأساسي معرّفاً للمستند، والطبقات الخمس |
| `analysis/analyzeDevice.js:764` | بوّابة كتلة تحديث `deviceProfiles` (كانت `deviceProfileKey?.a` وحدها فتتخطّى الأسماء الكاملة صامتةً؛ والتخطّي الآن مسمّى في السجلّ) |
| `analysis/runAnalysisInternal.js:129` | بادئة الأساسي في أسطر `[cache]` (للقراءة في السجلّ) ثم تسليم المفتاح لـ`findDeviceProfile` |
| `profiles/deviceProfileKey.js` | المُطبِّع نفسه |

**ما يتغيّر في `deviceProfiles` (بالأسماء):**
- **الطبقات الخمس** `layerA_keystore` · `layerB_firebaseId` · `layerC_androidId` · `layerD_buildSig` · `layerE_sensorSig` تُكتب **القيم الحقيقية من الحمولة** لا الحرّاس (`no_keystore` · `no_fid` · `no_android_id` · `unknown` · `no_sensors`) حين تحملها الحمولة (كانت طبقات نسخة R8 غير مقروءة فتُكتب حرّاساً كلّها). وطبقة لا تحملها الحمولة تبقى تُكتب قيمة الحارس كالسابق، لكن الغياب مُعلَن في سطر `[ProfileCreate]` لا صامت.
- **ملفّ الجهاز يُكتب الآن لحمولة الأسماء الكاملة** (كان يُتخطّى كلّه).
- **لا يتغيّر:** معرّف المستند (= الأساسي) · `primaryFingerprint` · `metadata` · `scanHistory` · `flags` · أسماء الحقول وأنواعها.
- **أثر جانبي:** البحث الاحتياطي بالطبقات (المراحل ٢-٥ في `findDeviceProfile`) **يعمل الآن لحمولة R8 لأوّل مرّة** حين يفوت البحث بالأساسي (كان غير مقروء الطبقات فلا يجري)؛ وملفّات الإنتاج الموجودة طبقاتها حرّاس كلّها (**منقول، غير متحقَّق من هذا المستودع:** «الطبقات الخمس كلّها قيم حارس» — FINDINGS:5244، ويعدّها `audit-device-profiles-readonly.js` في `defaultLayerValueCounts`) فلا تطابق (الحرّاس تُتخطّى)، فلا مطابقة خاطئة على الموجود، وتبدأ المطابقة بالطبقات على ما يُكتب بعد النشر. وكلفته: حتى أربعة استعلامات إضافية في فحص أوّل لجهاز جديد (كانت صفراً لـR8).

**قرّاء لا يمرّون بالمُطبِّع ولم يُغيَّروا** (أدوات تعمل على خامّ مخزَّن، ليست مساراً حيّاً):
- `scripts/audit-device-profiles-readonly.js:121` يقرأ `rawFingerprint.device.deviceProfileKey.a` وحده من الخامّ المخزَّن — **تقارير نسخة الأسماء الكاملة لن تُطابَق فيه**؛ والسكربت في قائمة تبعية الترحيل فلم يُمسّ.
- `scripts/lib/reportRawMigration.js:252-258` (`hasLegacyRawLayerIdentifier`) يقرأ `c`/`d` و`layerB_firebaseId`/`layerC_androidId` معاً — يغطّي الشكلين أصلاً.
- `scripts/export-v6-report-readonly.js` و`generate-v6-reports-document-sample.js`: يمرّان بالكائن كاملاً بلا قراءة أسماء.

> **تحقّق وكيل الباك اند من الجزء الخاصّ بهذا المستودع (2026-09-24 +03) —
> بالكود لا بالنقل:**
> - `findDeviceProfile.js:15-49` يقرأ `deviceProfileKey.a` (السطر الفعلي 15
>   لا 17 — انجراف سطر طفيف، لا تناقض محتوى) للأساسي، و`layerA_keystore`/
>   `layerB_firebaseId`/`layerC_androidId`/`layerD_buildSig`/`layerE_sensorSig`
>   بالأسماء الكاملة للطبقات (السطور 47-51،75-79 فعلياً — انجراف طفيف مماثل) — **مطابق**.
> - `analyzeDevice.js` يقرأ `deviceProfileKey?.a` فعلاً — عند السطر 602
>   لا 597 (انجراف طفيف، القيمة/السلوك مطابقان).
> - `createDeviceProfile.js:38,46` يشترط `deviceProfileKey?.a` ويستعمله
>   `profileId` — **مطابق**؛ وسطر 50-54 يكتب القيَم الحارسة الخمس حرفياً
>   كما وصفها النصّ (`no_keystore`/`no_fid`/`no_android_id`/`unknown`/`no_sensors`)
>   عند غياب الأسماء الكاملة — **مطابق**.
> - الالتزام `6e8f548` (2026-05-14 +03) موجود فعلاً في تاريخ هذا المستودع،
>   وعنوانه ومتنه يطابقان الوصف: بدّل `.primary` إلى `.a` في خمسة مواضع،
>   **ولم يبدّل أسماء الطبقات** (بقيت الأسماء الكاملة) — هذا بالضبط ما
>   يُفسِّر "البحث الاحتياطي بالطبقات معطَّل منذ ذلك الالتزام" أعلاه —
>   **مطابق، لا تناقض**.
> - لا مخالفة وُجدت بين هذا النصّ وكود هذا المستودع — الفروق الوحيدة
>   أرقام أسطر طفيفة (±2)، لا سلوكاً.

---

## ١٢ · `analyzedAt` — وقت الخادم عند بدء التحليل (القرار ٧٥ البند ٤، 2026-09-24 +03)

**الحقل:** `reports/{scanId}.analyzedAt` — رقم (epoch milliseconds)، مستوى جذر المستند (شقيق `pipeline`/`aiAudit`/`createdAt`، ليس داخل `aiResponse`).

**المصدر:** `functions/src/analysis/analyzeDevice.js` — `functionStartTime = Date.now()` (أوّل سطر تنفيذي في `exports.analyzeDevice`، "قبل أي await"، نفس المتغيّر المُستعمَل أصلاً لحساب `aiCallDeadline` — مصدر واحد، القاعدة 24). **وقت خادم حقيقي معروف فوراً** — ليس `admin.firestore.FieldValue.serverTimestamp()` (ذلك سِنتينل يُحسَم على خادم Firestore بعد اكتمال الكتابة، غير معروف وقت حساب `categoryStates` — راجع تعليق تاريخي في `categoryStates.js` قبل هذا القرار). يُكتب في المستند **مرّة واحدة** لكل فحص، لا يُحدَّث لاحقاً. **هذا الحقل نفسه (`reports/{scanId}.analyzedAt`) يُكتب من `analyzeDevice.js` فقط** — `runConsistencyTest.js` (أدناه) لا يكتب مستند `reports` إطلاقاً (اختبار إداري، لا فحص حقيقي)، فيستهلك `analyzedAtMs` داخلياً فقط، لا يكتبه.

**القارّاءان المؤكَّدان اليوم لِـ`analyzedAtMs`** (كمُدخَل دالّة، لا حقل مستند بالضرورة): `src/analysis/categoryStates.js` (`computeGates`، بوّابة `PATCH_AGE`) — يستهلكه لحساب عمر رقعة الأمان (`SEC-03`) بدل `Date.now()` المباشر (كان يُقاس وقت **حساب** `categoryStates`، لا وقت **كتابة** المستند — نفس القيمة عملياً على المسار الحيّ لأن كليهما لحظة واحدة تقريباً، لكن الفرق مبدئي: الآن قيمة مُمرَّرة صراحة، لا `Date.now()` ضمنية). **يُمرِّرها مستدعيان حيّان اليوم** (تحديث الجولة الثالثة، 2026-09-24 +03 — بعد اكتشاف المدقّق بالأداة أن `runConsistencyTest.js` لم تكن تُمرّرها، فتسقط `PATCH_AGE` إلى `UNKNOWN` صامتة في اختبار الاتّساق بينما الإنتاج الحقيقي لنفس البصمة يُنتج `FIRED`/`NOT_FIRED`):
  - `analyzeDevice.js` → `runAnalysisInternal.js` → `computeCategoryStates` — نفس `functionStartTime`.
  - `functions/src/admin/runConsistencyTest.js` (`exports.runConsistencyTest`) → `runAnalysisInternal.js` → `computeCategoryStates` — نفس `startedAt` (مُلتقَطة قبل أي `await` أيضاً، أعيد استعمالها بدل قيمة ثانية — لكل تكرارات الدفعة الواحدة نفس القيمة، لا `Date.now()` منفصل لكل تكرار).

**ثلاث حالات لبوّابة `PATCH_AGE`** (لا حالتان كما كان قبل هذا القرار):
| `analyzedAtMs` | `SEC-03` | حالة `PATCH_AGE` |
|---|---|---|
| رقم صالح | تاريخ صالح | `FIRED`/`NOT_FIRED` (حسب الأشهر، >36 يُطلق) |
| **غائب/غير رقمي** | تاريخ صالح | **`UNKNOWN`** (جديدة — لا `Date.now()` بديلاً أبداً، نصّ الأمر: "فإن لم يوجد وقت مخزون، تُعلَن حالة PATCH_AGE «غير معروفة»") |
| أيّ قيمة | غير صالح/غائب | `INPUT_ABSENT` (كما كانت) |

`UNKNOWN` تسلك سلوك `INPUT_ABSENT`/`NOT_WIRED`/`DISABLED` تماماً — أي قيمة `status` غير الحرفية `'FIRED'` لا تُسقِف حرفاً (`applyCeilings`/`applyOverallCeilings` قائمة بيضاء لـ`FIRED` وحدها، `categoryStates.js` تعليق صريح — لا تعديل لزم هناك).

**مستند بلا `analyzedAt`** (تقارير قديمة سبقت هذا القرار، أو مستدعٍ لا يمرّره — كل استدعاءات `computeCategoryStates`/`computeGates` القائمة في `test/`/`scripts/` قبل هذه الجلسة لا تمرّره، فتصير `PATCH_AGE=UNKNOWN` تلقائياً بدل `FIRED`/`NOT_FIRED` المبنيّ على `Date.now()` وقت التشغيل):

⚠️ **تصحيح (الجولة الثالثة، 2026-09-24 +03 — بعد قياس المدقّق بالأداة)**: الفقرة السابقة هنا ادّعت "لا يوجد اليوم في هذا المستودع مسار يقرأ مستنداً قديماً ويُعيد حساب `categoryStates` منه (لا سكربت 'إعادة تحليل' قائم)" — **غير دقيقة**. `functions/scripts/regenerate-report.js` يفعل هذا بالضبط: `SCAN_ID` ثابت مكتوب في الكود (`:58`)، `DOC_PATH = reports/${SCAN_ID}` (`:96`) يقرأ مستنداً مخزوناً فعلياً، ثم يستدعي `runAnalysisInternal` (`:339-351`) على بصمته — بلا تمرير `analyzedAtMs` (فتصير `PATCH_AGE=UNKNOWN` على هذا المسار أيضاً، لا يختلف عن بقيّة المستدعين غير المُحدَّثين). والسكربت نفسه **يرفض أي ناتج بلا `grade`/`score`** (`:357-358`، `if (!/^[ABCD][+-]?$/.test(...) || typeof r.score !== 'number') abort(...)`) — وهما حقلا V6 حصراً (لا يصلان V7 إطلاقاً، A103) — أي أن هذا السكربت **يرفض كل ناتج V7 بتصميمه الحالي**، بصرف النظر عن `analyzedAtMs`. **لا تغيير على السكربت نفسه هذه الجولة** (لم يُطلَب) — فقط تصحيح هذه الفقرة: سلوك "يُحسب من وقت الكتابة المخزون (`createdAt`) إن وُجد" الذي وصفه نصّ الأمر الأصلي **لم يُنفَّذ هنا رغم وجود مستدعٍ حقيقي** (`regenerate-report.js`) — ذلك المستدعي مبنيّ لمسار V6 فقط ولا يُموَّل بـ`analyzedAtMs`/`createdAt` أصلاً؛ أيّ تحديث له خارج نطاق هذه الجولة.

**لا يصل `verifyReport`:** `buildV7Response` (`verifyReport.js`) لا يقرأ `report.analyzedAt` — غير موجود في قائمته البيضاء (§٨-أ)، لم يُطلَب إضافته هذه الجولة. **لا يصل `display`/`aiResponse` المخزون أو المُعاد للعميل** — حقل تشغيلي داخلي (شبيه بمفهوم `V7_OPERATIONAL_FIELDS` لكنه على مستند التخزين لا الإرجاع، وغير مُدرَج في تلك القائمة لأنه لا يصل الإرجاع أصلاً).

**قارئ التطبيق (القرار ١٠٤ البند ٧٥.٤، 2026-09-26 +03 — منقول من NeuralChek، غير موجود في هذا المستودع، لم يُتحقَّق منه مباشرة هنا — القاعدة 27/29/31):** `app/src/main/java/net/neuralcheck/data/remote/model/AiAnalysisResponse.kt:125-126` — `@SerializedName(value = "analyzedAt", alternate = ["analyzed_at"])`. يُستعمَل وقتاً للتقرير في `loadFromRemoteFallback` (`presentation/viewmodel/ViewModels.kt`، التزام `f8d048e` في مستودع التطبيق). **الموقع لم يُطلَب فحصه — لا يُكتب عنه هنا شيء غير ما كان مُوثَّقاً أصلاً.**

---

## ١٢-أ · `createdAt` — وقت الكتابة الفعلي (Firestore server timestamp)

**الحقل:** `reports/{scanId}.createdAt` — مستوى جذر المستند (شقيق `analyzedAt`/`pipeline`/`aiAudit`، ليس داخل `aiResponse`). **المصدر:** `functions/src/analysis/analyzeDevice.js:288` — `createdAt: SERVER_TIMESTAMP_MARKER` عند بناء `reportDocument` (علامة مُجمَّدة، لا قيمة زمنية بعد)؛ يُستبدَل فعلياً بـ`admin.firestore.FieldValue.serverTimestamp()` عند الكتابة الحقيقية (`analyzeDevice.js:649`) — سِنتينل Firestore يُحسَم على خادم Firestore بعد اكتمال الكتابة (الفرق عن `analyzedAt` أعلاه: ذاك رقم معروف فوراً وقت الحساب، هذا يُحسَم لاحقاً).

**قارئ التطبيق (القرار ١٠٤ البند ٧٥.٤، 2026-09-26 +03 — منقول من NeuralChek، غير موجود في هذا المستودع، لم يُتحقَّق منه مباشرة هنا — القاعدة 27/29/31):** `app/src/main/java/net/neuralcheck/data/remote/FirebaseAnalysisService.kt:625` — `(data["createdAt"] as? com.google.firebase.Timestamp)?.toDate()?.time`، احتياطي لـ`analyzedAt` في المسار نفسه (نفس التزام `f8d048e` في مستودع التطبيق). **الموقع لم يُطلَب فحصه.**

**لم يكن هذا الحقل معدوداً في هذا العقد بمدخل مستقلّ قبل هذا الالتزام** (وُجد فقط اسماً عرضياً كشقيق في §١٢/§١٣ وفي فقرة `regenerate-report.js`) — أُضيف هنا بقارئه فقط، بلا إعادة اشتقاق تاريخه الكامل (خارج نطاق هذا البند).

---

## ١٣ · `serverSamplesStoragePath`/`serverSamplesSaved` — نسخة الخادم من العيّنات الخام (القرار ٨٦ البند ٢، 2026-09-25 +03)

**الحقلان:** `reports/{scanId}.serverSamplesStoragePath` (نصّ أو `null`) و`reports/{scanId}.serverSamplesSaved` (منطقي) — مستوى جذر المستند (شقيقا `timeSeriesStoragePath`/`pipeline`/`aiAudit`/`analyzedAt`، ليسا داخل `aiResponse` ولا داخل `aiAudit`). أسماء الحقلين مُصدَّرة من مصدر واحد: `SERVER_SAMPLES_STORAGE_PATH_FIELD`/`SERVER_SAMPLES_SAVED_FIELD` (`functions/src/analysis/serverRawSamplesStorage.js`، القاعدة 24) — لا نصّ حرفي مكرَّر في `analyzeDevice.js` أو في مولّدات العيّنات الذهبية.

**السبب (نصّ الأمر حرفياً):** "حفظ الملفّ الخام في مسار الشريك متروك لسباق داخل التطبيق، والخادم لا يحفظ العيّنات اليوم. والمسار المنفصل يمنع أن يكتب كاتبان في الملفّ نفسه." — الخادم يحفظ الآن نسخته الخاصّة من `fingerprint.timeSeries.samples` (كما استلمها، بلا أي تحويل) في مسار Storage منفصل تماماً عن مسار رفع التطبيق (`timeSeriesStoragePath` أعلاه، `scans/{deviceFingerprintSha}/{scanId}.ts.json.gz`) — المسار الجديد: `serverSamples/{scanId}.json.gz` (`computeServerSamplesStoragePath`).

**المصدر:** `functions/src/analysis/analyzeDevice.js` — `exports.analyzeDevice` يبدأ `saveServerRawSamples({bucket: admin.storage().bucket(), scanId, samples: fingerprint.timeSeries.samples})` **موازياً** لِـ`runAnalysisInternal` (قبل الـ`await` عليها مباشرة، لا بعده) وينتظر النتيجة فقط قبل بناء `reportDocument` — تصميم "لا يزيد زمن الدالّة" (نصّ الأمر). فشل الحفظ (`bucket.file().save()` يرمي، أو `scanId`/`samples` غائبان) **لا يُفشل التحليل**: `saveServerRawSamples` لا ترمي أبداً، تُعيد `{path, saved:false}` صراحة (القاعدة 22 — لا نجاح مُختلَق، لا قيمة افتراضية تسدّ غياباً).

**لماذا top-level لا `aiAudit`** (قرار صريح مطلوب في نصّ المهمّة، لا افتراض): `aiAuditWiring.e2e.test.js` يُثبت أن `aiAudit` المخزون يجب أن يطابق حرفياً (`JSON.stringify` مباشرة) ما أعادته `runAnalysisInternal` (`aiResultAudit`) — "لا نسخة ثانية منه" هو نفس مبدأ القاعدة 24 مطبَّقاً على الكائن كلّه. دمج حقلين غريبين داخل `aiAudit` في طبقة `buildReportDocument` كان سيكسر هذا الثابت المُختبَر عمداً بلا أي فائدة أمنية مقابلة: **كلا الموضعين (top-level أو داخل `aiAudit`) معرَّضان بالتساوي** لقراءة العميل المباشرة عبر `firestore.rules` (`match /reports/{scanId} { allow read: if ... resource.data.userId == request.auth.uid; }` وأيضاً `allow read` لأي مستخدم مسجَّل حين `listingStatus in ["for_sale","sold"]`) — Firestore لا يملك قواعد أمان على مستوى الحقل، فالمستند كاملاً يصل العميل المخوَّل بصرف النظر عن هذا الاختيار (نفس ما وثّقه حادث القاعدة 20: "نصّ ردّ النموذج الأصلي كاد يُحفظ في `aiAudit`، والتطبيق يقرأ مستند التقرير كاملاً إلى جهاز المشتري"). **هذان الحقلان ليسا "الخام"** الذي تحكمه القاعدة 20 (الخام — مصفوفة العيّنات نفسها — لا يدخل Firestore هنا إطلاقاً، يذهب إلى Storage وحده) بل نصّ مسار وقيمة منطقية، فلا يخالفان تلك القاعدة بذاتهما في أيّ من الموضعين. الاختيار إذن تنظيمي لا أمني: top-level، بنفس نمط `timeSeriesStoragePath` (أقرب نظير فعلي — مسار Storage آخر لعيّنات نفس الفحص).

**القارّئ الوحيد المؤكَّد اليوم:** لا أحد. حقلان جديدان بلا مستهلك اليوم (لا `verifyReport.js`، لا `rehydrateReportSamples.js`، لا كود تطبيق/موقع من هذا المستودع) — فلا شكل قائم يُكسَر بإضافتهما (القاعدة 25 لا تُلزم تحديث قارئ لا وجود له). **مرشَّح مستقبلي واحد مذكور صراحة، غير مُوصَّل هذه الجولة:** `functions/src/analysis/rehydrateReportSamples.js` يقرأ اليوم حصراً `report.timeSeriesStoragePath` (مسار رفع التطبيق، عرضة لسباق العميل الموثَّق أعلاه في السبب) — يمكن تحديثه لاحقاً ليُفضِّل `report.serverSamplesStoragePath` (حين `serverSamplesSaved===true`) كمصدر أوثق؛ **لم يُطلَب في هذه المهمّة ولم يُنفَّذ**.

**لا يصل `verifyReport`:** `buildV7Response` (`verifyReport.js`) لا يقرأ `report.aiAudit` ولا أي حقل top-level باسم `serverSamples*` إطلاقاً — يبني استجابته حصراً من `report.aiResponse.*` زائد ثمانية حقول غلاف مُسمّاة صراحة (`scanId`/`shortId`/`deviceModel`/`deviceMarketingName`/`date`/`language`/`isFreeTrial`/`verified`، مُثبَتة بالأداة: `compare-verifyReport-v7-contract.js`) — استبعاد هيكلي، لا وعد بعدم الإضافة لاحقاً فقط. **لا يصل `display`/`aiResponse`** — نفس سبب `analyzedAt` أعلاه: حقلا تخزين داخليان، لا تشغيليان بمعنى `V7_OPERATIONAL_FIELDS` (تلك الأربعة تصل *الإرجاع* للعميل عند اكتمال الفحص؛ هذان الحقلان لا يصلان حتى ذلك — لا في `aiResponseToSave` ولا في الإرجاع المباشر).

**قرّاء التطبيق/الموقع:** غير مُتحقَّق منهم من هذا المستودع (القاعدة 27/31).

**الاختبار:** `functions/test/serverRawSamplesStorage.test.js` — نقيّ (`computeServerSamplesStoragePath`)، بكعب `bucket` (نجاح/فشل GCS/غياب `scanId`/غياب `samples`، صفر شبكة)، ومسار كامل (القاعدة 30): عيّنات `b45c8cf6` الحقيقية عبر `saveServerRawSamples` ثم فكّ ضغط يدوي → نفس `batteryIndicators`/`state`/`deterministicLetter` حرفياً مقارنةً بالحساب المباشر من الفخّ بلا مرور بالتخزين.

**العيّنتان الذهبيتان المتأثّرتان:** `v7-reports-document-sample.json` و`v7-reports-document-sample-honor.json` (كلاهما أعيد توليدهما بمولّدَيهما — `generate-v7-reports-document-sample.js`/`-honor.js` — في نفس التزام هذه المهمّة، القاعدة 39). `v7-client-payload-sample*.json`/`v7-verifyReport-response-sample*.json` **غير متأثّرتين** — الحقلان الجديدان لا يدخلان `aiResponseToSave`/إرجاع `analyzeDevice`/استجابة `verifyReport` إطلاقاً (راجع أعلاه).

---

## ١٤ · نقل الخامّ إلى `reportRaw/{scanId}` (V8 الجزء ١-ج، 2026-10-09 +03)

**قرار المستخدم** (BATCH3-CLOSE البند ١ و2026-10-09، بنصّه، منقول من أمر المنسّق): «ينتقل الخامّ إلى مستند لا يقرؤه إلا الخادم (القواعد تمنع العميل)، ومستند التقرير المقروء لا يحمل إلا ما يعرضه.» و«١: الخادم وحده يقرأ الخامّ. ٢: reportRaw/{scanId}، في كتابة ذرّية واحدة مع التقرير. ٤: يخرج من المستند المقروء الخامّ والمعرّفات الثلاثة وaiAudit، والحقول التسعة الأخرى لاحقاً واحداً واحداً. ٦: لا نسخ للمعرّفات في evaluations، والربط في جانب الخادم.» التصميم: [`RAW_FINGERPRINT_PLACEMENT_DESIGN.md`](RAW_FINGERPRINT_PLACEMENT_DESIGN.md) §٣ و§٦-١.

### ما تغيّر في الشكل
| | قبل | بعد |
|---|---|---|
| `reports/{scanId}` (المقروء) | يحمل `rawFingerprint` و`sessionId` و`deviceFingerprintSha` و`timeSeriesStoragePath` و`aiAudit` | **لا يحملها** (مفتاحها غائب لا `null`). `userId` يبقى بقرار 2026-10-09 |
| `reportRaw/{scanId}` | غير موجود | `scanId` · `rawFingerprint` (بعد `lightenFingerprintForStorage`) · `sessionId` · `deviceFingerprintSha` · `timeSeriesStoragePath` · `aiAudit` · `source` · `createdAt`. **بلا `userId`** — الخادم وحده يقرؤه |
| الكتابة | `reportRef.set` | **دفعة Firestore واحدة** للمستندين (`reportRawStore.writeReportAndRaw`): إمّا الاثنان أو لا شيء؛ المشغّل `resolvePendingEvaluation` يُطلَق بعد الإيداع فيجد الخامّ |

- **المصدر الواحد:** `functions/src/analysis/reportRawStore.js` — `REPORT_RAW_COLLECTION` و`REPORT_RAW_FIELDS` (القاعدة 24)، وبنّاء المستند، وحارس الحجم (900,000 بايت، خطأ صريح لا اقتطاع)، والقارئ `readReportRaw` بحالات صريحة `PRIVATE` | `EMBEDDED_LEGACY` | `ABSENT` (القاعدة 22).
- **لا قاعدة عميل:** لا `match` لـ`reportRaw` في `firestore.rules` (سابقة `aiRawResponses`) — مرفوض افتراضياً لكل عميل؛ يقرؤه المشرف المؤكَّد بالقاعدة الشاملة والخادم (Admin SDK). مُثبَت بـ`rules-test/reports.rules.test.js`.
- **`verifyReport` لا يتأثّر:** قائمته البيضاء صريحة (§٨-أ) ولا تقرأ أيّاً من الحقول المنقولة.
- **`evaluations/{scanId}`** (يقرؤها المالك من العميل): لا تحمل بعد الآن `timeSeriesStoragePath` ولا `deviceFingerprintSha` ولا `sessionId` (القرار ٦: «لا نسخ للمعرّفات في evaluations، والربط في جانب الخادم»). الربط بمعرّف الفحص نفسه: `evaluations/{scanId}` ↔ `reportRaw/{scanId}` (1:1). وحقل جديد **`linkageRawState`** (`PRIVATE` | `EMBEDDED_LEGACY` | `ABSENT`، و`null` ما دام التقييم معلّقاً) يُسجّل حالة الخامّ وقت التقييم، فاكتمال الربط (`linkageIncomplete` و`missingLinkageFields`) يُحسَب من حالة الخامّ لا من لقطة تحمل المعرّفين (`evaluationContract.js`: `RAW_LINKAGE_FIELDS`، `linkageStatus(snapshot, pending, rawRead)`، و`buildReportSnapshot(report, rawRead)` يرمي إن غاب `rawRead` مع تقرير موجود). والمشغّل `resolvePendingEvaluation` يقرأ `reportRaw` داخل المعاملة لا من `event.data`. **تقييمات كُتبت قبل هذا التغيير** قد تحمل المعرّفات الثلاثة؛ تنظيفها بند ترحيل (الجزء ٢) لا يُنفَّذ هنا.
- **قرّاء العميل** (التطبيق والموقع): لا أحد منهما يقرأ `rawFingerprint` ولا الحقول الثلاثة ولا `aiAudit` بالاسم (جرد الكشّاف 2026-10-09، منقول، غير متحقَّق من هذا المستودع) — فلا قارئ عميل يُكسَر بهذا النقل.

### `evaluations/{scanId}.linkageRawState` — عقد الحقل، ولا قارئ له اليوم (2026-10-09 +03)
**قرار المستخدم، بنصّه (منقول من أمر المنسّق):** «linkageRawState: معتمد كما هو، ويُكتب في عقد evaluations أن لا قارئ له اليوم.»

| | |
|---|---|
| **ما هو** | حالة الخامّ التي وجدها الخادم حين قيّم الربط بين التقييم وبيانات التدريب: هل الخامّ في `reportRaw/{scanId}`، أم مضمَّن في مستند تقرير لم يُرحَّل، أم غائب كلّياً. تُحسَب من ناتج `readReportRaw` (`evaluationContract.js:235`) فتُسجَّل بجانب `linkageIncomplete` و`missingLinkageFields` اللذين تُفسَّر بها. |
| **القيم** | `"PRIVATE"` (يوجد `reportRaw/{scanId}`) · `"EMBEDDED_LEGACY"` (لا مستند خامّ، وفي مستند التقرير حقل من الخمسة المنقولة — تقرير كُتب قبل النقل ولم يُرحَّل) · `"ABSENT"` (لا هذا ولا ذاك، **الربط ناقص بسبب غياب الخامّ لا بسبب شكل تقرير قديم**) · `null` ما دام التقييم **معلَّقاً** (`pending=true`: لا تقرير بعدُ فلا خامّ يُقرأ). غياب المفتاح نفسه = تقييم كُتب قبل هذا الحقل. |
| **المصدر الواحد** | `RAW_STATE` في `functions/src/analysis/reportRawStore.js:53-57` (القاعدة 24)؛ لا نسخة حرفية للقيم الثلاث في `evaluationContract.js` ولا في الكاتبين. |
| **الكاتبان** | `functions/src/evaluations/submitEvaluation.js:324` (كتابة التقييم، `tx.set`) و`functions/src/evaluations/resolvePendingEvaluation.js:97` (إكمال تقييم معلَّق، `tx.update`). مُثبَتان بـ`evaluationContractRawLink.test.js` و`evaluation_linkage` و`submit_evaluation` و`session_evaluation` و`reportRawPlacement` (e2e). |
| **القرّاء في هذا المستودع** | **لا أحد.** (تحقّق بالأداة، 2026-10-09: `grep -rn linkageRawState functions/src functions/scripts rules-test firestore.rules` لا يُظهر غير الكاتبَين وبناء القيمة في `evaluationContract.js` وسطرَي سجلّ يطبعان المتغيّر المحلّي لا الحقل المخزَّن؛ ولا يقرؤه `export-session-evaluation-readonly.js` — قائمته البيضاء لا تذكره.) |
| **القرّاء خارج هذا المستودع** | **منقول من المنسّق، غير متحقَّق من هذا المستودع (القاعدة 29):** (١) **wepsite** — `lib/techEval.js:29` و`app/tech/page.js:89` يقرآن مجموعة `evaluations`، **ولا يذكران `linkageRawState` ولا المعرّفات الثلاثة**، ولا قراءة عامّة (`JSON.stringify` أو `Object.keys`/`entries`/`values`) في `app/tech` و`lib/techEval.js` (فلا يصلهما الحقل ضمناً). (٢) **NeuralChek** عند `f1c7db9` — صفر استعمال لـ`evaluations` في `app/src/main`. |
| **أثر هذا للقرّاء** | الحقل **يصل المالك** مع باقي مستند `evaluations` (القاعدة `firestore.rules` للمالك تقرؤه كلّه) لكنه ليس معرّفاً ولا يكشف شيئاً عن الجهاز؛ ولا قارئ يعتمد عليه. أيّ قارئ جديد يُضاف إلى هذه القائمة قبل أن يُبنى، ويقرأ الحالات الثلاث كلّها لا بعضها (القاعدة 30). |

### العيّنات الذهبية (القاعدة 39 — أُعيد توليدها في التزام تغيير الشكل نفسه)
- **عيّنات مستند التقرير المقروء** — بلا الحقول المنقولة، من مولّداتها الفعلية: `v7-reports-document-sample.json` و`-honor` و`-security-downgrade` و`-cpu-c06-downgrade` و`-zero-measured` و`-zero-measured-battery-harness-error`.
- **عيّنات مستند الخامّ الشقيقة (جديدة)** — من المولّدات نفسها في التشغيل نفسه: `v7-report-raw-sample.json` و`-honor` و`-security-downgrade` و`-cpu-c06-downgrade` و`-zero-measured` و`-zero-measured-battery-harness-error`. ما كانت حرّاس `aiAudit` تفحصه داخل المستند صار يُفحَص عليها.
- **`v6-reports-document-sample.json` لم يُعَد توليدها:** مولّدها يأخذ ملفّ تصدير خامّاً خارج المستودع بتصميم (مُدخل إلزامي بلا افتراضي)، فلا يمكن إعادة بنائها هنا. تبقى ممثّلةً شكل مستند V6 **المضمَّن قبل النقل** (`EMBEDDED_LEGACY`) — وهو ما تحمله الإنتاج حتى يُرحَّل.
- **لم تتغيّر:** `v7-client-payload-sample*.json` و`v7-verifyReport-response-sample*.json` — لا تحمل الحقول المنقولة (ومُتحقَّق: sha256 لم يتغيّر).

## ١٥ · `evaluationRulesVersion` — ختم قواعد التقييم في مستند التقرير (P6-26 الجزء الأوّل، 2026-10-13 +03)

**جواب المستخدم، بنصّه** (2026-10-13؛ منقول من أمر المنسّق، غير متحقَّق من مصدره عندي: الملفّ في مساحة العمل): "Start P6-26's stamp now (Recommended)"، ووصف الخيار كما عُرض: "One exported constant, written to every new report as `evaluationRulesVersion` (not displayed, not in verifyReport). First value marks this change; named in the contract. The rest of P6-26 stays planned." **وتصميم P6-26 المعتمد** (منقول، غير متحقَّق: `plan/PLAN-06-DATA-COLLECTION.md:1139`): «ختم في كل تقرير: إصدار الخادم (التزام النشر)، وإصدار التطبيق (قائم…)، ونسخة قواعد التقييم (`thresholdSet`…)». **المنفَّذ هنا: ثابت قواعد التقييم وحده.** إصدار الخادم وبقيّة P6-26 لم تُنفَّذ.

| | |
|---|---|
| **الحقل** | `reports/{scanId}.evaluationRulesVersion` — نصّ، مستوى جذر المستند (شقيق `fieldsVersion`/`appVersion`، يلي `appVersion` في الترتيب؛ ليس داخل `aiResponse` ولا `aiAudit`). |
| **الثابت (مصدر واحد، القاعدة 24)** | `EVALUATION_RULES_VERSION` واسم الحقل `EVALUATION_RULES_VERSION_FIELD` — `functions/src/analysis/evaluationRulesVersion.js` (ملفّ بلا `require`). لا نصّ حرفي منهما في أيّ ملفّ كود آخر (يحرسه `test/evaluationRulesVersion.test.js`). |
| **القيمة الأولى (تاريخية)** | `"rules-2026-10-13-zero-cycles-unsupported"` — تسمّي هذا التغيير وتاريخه: صفر الدورات من `EXTRA_CYCLE_COUNT` صار «غير مدعوم» (`cycleCountClassification.js`، `docs/FV68_READERS_INVENTORY.md` §٥). بلا ادّعاء سبب لم يُقَل (نمط `PIPELINE_VERSION`، `functions/src/signatures/constants.js`). **ما الذي يستوجب تغيير الختم لاحقاً: غير محسوم** (بقيّة P6-26 مخطَّطة) — لا يُرفع تلقائياً. |
| **القيمة الحالية (الرفع الأوّل، 2026-10-23 +03)** | `"rules-2026-10-23-hardware-absent-coverage"` — تسمّي ق٢ وتاريخه: **ق٢ يغيّر تعريف تغطية الفئة** — ما أعلن الفنّي غيابه (`outcome=NOT_MEASURED` و`notMeasuredReason=HARDWARE_ABSENT`) صار خارج مقام التغطية (`categoryStates.js` `computeHealthBearingStats`، §١٦)، فتتغيّر تغطية الفئة وتفاصيل بوّابة `LOW_CATEGORY_COVERAGE` وحالة الفئة (`PARTIAL` ⟵ `MEASURED`) في تقارير الأجهزة التي ضغط فنّيها «غير متوفر» (أزرار 1.0.14: M-08 وM-12 وM-14 وM-15). **قرار حسن 2026-10-23، بنصّه من أمر المستخدم** (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): «ق٢ (INV:112): يُرفع evaluationRulesVersion قبل النشر ليميّز التقارير قبل ق٢ وبعده.» النسق نفسه `rules-<تاريخ>-<وصف إنجليزي قصير>`؛ التاريخ تاريخ القرار. الثابت: `functions/src/analysis/evaluationRulesVersion.js:39` (الحقل :36). |
| **كيف يميّز الختم التقارير بعد الرفع** | تقرير ختمه `rules-2026-10-23-hardware-absent-coverage` كُتب بقواعد ما بعد ق٢. وتقرير ختمه `rules-2026-10-13-zero-cycles-unsupported` أو **غاب ختمه** كُتب قبلها. **التقارير المخزَّنة قبل الرفع تحتفظ بختمها السابق في مستنداتها: لا يُعاد ملؤه ولا يُعاد تقييمها ولا يُكتب فيها** (مُثبَت تشغيلاً أدناه). وتقرير `pipeline='cached'` الجديد يحمل **ختم أصله** (السابق إن كان الأصل سابقاً) لا الحالي: المحتوى المُعاد أنتجته قواعد الأصل. |
| **الرفع لا يُطلق شيئاً** | لا قارئ للقيمة يقرّر إعادة تقييم أو إعادة استعمال أو جدولة: `resolvePendingEvaluation` (المشغّل الوحيد على `reports/{scanId}`، `onDocumentCreated`) لا يقرأ الختم؛ `reevaluationDecision.js` يقرأ بصمة الجهاز وحدها؛ `resolveCacheConfig.js` يقرأ `settings/cache.reuseEnabled` وحده؛ `verifyReport` يبني ردّه من قائمة بيضاء ليس الختم فيها. **أُثبت تشغيلاً على محاكي Firestore (demo-nc)**: مستندات مخزَّنة بالختم القديم (تقريران من `analyzeDevice` وعيّنتان ذهبيتان: V7 بختم، وV6 بلا ختم) قُرئت بكود الثابت القديم وبكود الثابت الجديد عبر `verifyReport` (4 طلبات) وإعادة فتح `analyzeDevice` بالمعرّف نفسه ومشغّل `resolvePendingEvaluation` و`submitEvaluation` على المسار المصادَق: **صفر إضافة/حذف/تعديل لأي مستند في `reports`**، ولقطة المحاكي كلّها (كل مستند، كل حقل، `updateTime`) متطابقة قبل/بعد الخطوات الخمس القارئة المحضة؛ والمسار الكاتب (المشغّل و`submitEvaluation`) يكتب `evaluations/*` وحده، بفروق صفر بين الثابتين (عدا الطوابع الزمنية). والردود متطابقة بين الثابتين حقلاً حقلاً. ختم المستندات المخزَّنة بعد القراءة = قبلها في الشجرتين. ختم تقرير جديد: `rules-2026-10-13-…` بالثابت القديم و`rules-2026-10-23-…` بالثابت الجديد، ولا ردّ (`analyzeDevice` أو `verifyReport`) يحمل اسم الحقل ولا قيمته. **ما لم يُقَس تشغيلاً:** مسار المخبَّأ على المحاكي — كتابة التقرير المخبَّأ تُرفض اليوم في الشجرتين (`analyzeDevice.js` `buildReportDocument`: `grade`/`score`=undefined لـ`pipeline`≠V7 وAdmin SDK يرفض undefined)، والمسار مطفأ افتراضياً (`resolveCacheConfig.js` `DEFAULT_REUSE_ENABLED=false`)؛ يغطّيه `test/evaluationRulesVersion.test.js` §٥ (Firestore ذاكرة) نصّاً. |
| **الكاتب** | `analyzeDevice.js`: `buildReportDocument` (الدالّة النقيّة `evaluationRulesStampFields`) — في كل مستند `reports/{scanId}` جديد، V7 وV6 معاً. |
| **لماذا ليس بجوار `thresholdSet` (`findings.js:155`)** | `thresholdSet` مدخل واحد من مدخلات القواعد (عتبتان اليوم)، والقواعد موزَّعة على `testKinds.js` و`categoryStates.js` و`findings.js` و`cycleCountClassification.js` وغيرها؛ فوضع الختم عند عتبة واحدة يوحي بأنه ختمها وحدها. |
| **ولماذا ليس بجوار `PIPELINE_VERSION`** | `PIPELINE_VERSION` بوّابة كاش: رفعه يُسقط إعادة الاستعمال لكل المستخدمين. والمستخدم اختار ختم القواعد لا رفع `PIPELINE_VERSION` (أمر 2026-10-13) — فلا يُبنى الاثنان في ملفّ يُرفعان معاً بالخطأ. `PIPELINE_VERSION` لم يتغيّر: `"v4-2026-09-24-decision-76-3"`. |
| **لا يُعرض** | ليس في `aiResponse` المخزَّن ولا المُعاد إلى العميل، وليس في حمولة النموذج، وليس في بصمة الجهاز (`computeScanSignature`). |
| **لا يصل `verifyReport`** | `buildV7Response` يبني ردّه من `report.aiResponse.*` وثمانية حقول غلاف مُسمّاة (§١٣) — والحقل ليس بينها. مُثبَت بالأداة: ردّ `verifyReport` المبنيّ من مستند يحمل الختم فعلاً (`buildVerifyReportResponseSample()` في الذاكرة) لا يحمل اسم الحقل ولا قيمته (`test/evaluationRulesVersion.test.js` §٤). |
| **القرّاء (في هذا المستودع، حتى 2026-10-23)** | الكاتب: `analyzeDevice.js` `evaluationRulesStampFields` (:295) ثمّ `...evaluationRulesStampFields(p)` في `buildReportDocument` (:319). قارئ ختم الأصل لمسار المخبَّأ: `runAnalysisInternal.js:200-201` (يمرّره إلى `analyzeDevice.js:721` ثمّ :861). سكربتا قراءة بحتة: `scripts/lib/ownerActivityWindow.js` (:35 و:55 و:203: يصف الحقل ولا يحكم عليه) و`scripts/lib/deviceCheck03After.js` (:39 و:424 و:590 و:1693-1699: **يقارن ختم التقرير بالثابت الحيّ: PASS إن تساويا، FAIL إن اختلفا — فتقرير كُتب بالختم السابق يُحكم عليه FAIL بعد الرفع، والصفّ يقيس تقارير النشر الحالي وحده**). لا قارئ في `verifyReport` ولا `generateReportPdf` ولا `resolvePendingEvaluation` ولا `reevaluationDecision` ولا `resolveCacheConfig` ولا `functions/index.js` ولا `firestore.rules` (`git grep`: صفر). التطبيق والموقع: **لم يُفحصا** (خارج الحدود) — وهما يقرآن مستند `reports` مباشرةً (§٤)، فمفتاح جذر لا يمسّ قارئاً يفكّك بالأسماء؛ **غير متحقَّق منهما.** |
| **مستند قديم (كُتب قبل الختم)** | **المفتاح غائب** — لا `null` ولا قيمة افتراضية (القاعدة 22). يُقرأ الغياب: **«كُتب قبل الختم»**. لا يُعاد ملؤه لتقارير قائمة. (`v6-reports-document-sample.json` المؤرَّخة نموذج لمستند كهذا: بلا الحقل.) |
| **مسار التقرير المخبَّأ (`pipeline: 'cached'`)** | `runAnalysisInternal` يعيد تقريراً سابقاً بلا نداء نموذج، فيحمل المستند الجديد **محتوى أنتجته قواعد التقرير الأصل** لا قواعد هذا الإصدار؛ فختم هذا الإصدار عليه ادّعاء كاذب. **القرار:** يحمل المستند الجديد **ختم التقرير الأصل** إن كان للأصل ختم (`reusedEvaluationRulesVersion`، يقرؤه `runAnalysisInternal` من مستند التقرير المُعاد ويمرّره إلى `buildReportDocument`)، **وإلّا يغيب المفتاح** (الأصل «كُتب قبل الختم»). لا ختم هذا الإصدار على محتوى مخبَّأ أبداً. **وليس هذا مسار «إعادة فتح تقرير محفوظ بالمعرّف نفسه»** (`analyzeDevice.js`، فرع «التكافؤ أولاً»: `existingReport.exists` ⟵ يُعيد `aiResponse` المخزَّن ولا يكتب مستنداً): لا ختم يُكتب فيه ولا يُمسّ — يبقى ما كُتب أوّل مرّة. (وسم `'cached'` يكتبه `runAnalysisInternal.js` عند إصابة الكاش وحده، `CACHED_PIPELINE_TAG`.) **ملاحظة موثَّقة، لا إصلاح:** إعادة الاستعمال مطفأة افتراضياً (`utils/resolveCacheConfig.js`: `DEFAULT_REUSE_ENABLED=false`) فلا أثر عملي اليوم. |
| **أين يُكتب الفحص الجديد** | `buildReportDocument` في المسار الحيّ: `analyzeDevice.js` عند `reportDocument = buildReportDocument({...})` — والمولّدات الذهبية تستدعيها نفسها. |

### العيّنات الذهبية (القاعدة 39 — أُعيد توليدها في التزام الإضافة نفسه)
- **ستّ عيّنات مستند التقرير المقروء** أُعيد توليدها بمولّداتها (`generate-v7-reports-document-sample*.js`): `v7-reports-document-sample.json` و`-cpu-c06-downgrade` و`-honor` و`-security-downgrade` و`-zero-measured` و`-zero-measured-battery-harness-error` — **الفرق الوحيد في كلٍّ منها سطر `evaluationRulesVersion`** (`git diff` سطر واحد مُضاف لكلٍّ). `shortId` (عشوائي بتصميمه) و`bodyBuildMs` (زمن) أُبقيا بقيمتيهما المُلتزَمتين فلا ضجيج في الفرق.
- **لم تتغيّر:** عيّنات الخامّ `v7-report-raw-sample*.json` (الختم في المستند المقروء لا في `reportRaw`) و`v7-client-payload-sample*.json` و`v7-verifyReport-response-sample*.json` (الختم لا يصل الإرجاع ولا `verifyReport`) — مُتحقَّق: حارساها يمرّان بلا إعادة توليد.
- **الرفع الأوّل للختم (2026-10-23، قرار حسن): أُعيد توليد العيّنات الستّ نفسها في الالتزام نفسه** (القاعدة 39) بمولّداتها `generate-v7-reports-document-sample*.js`، **والفرق في كلٍّ منها سطر واحد: `"evaluationRulesVersion": "rules-2026-10-13-zero-cycles-unsupported"` ⟵ `"rules-2026-10-23-hardware-absent-coverage"`**؛ `shortId` و`aiDurationMs` و`bodyBuildMs` (عشوائي/زمن بتصميمها) أُبقيت بقيمها المُلتزَمة. لم تتغيّر عيّنات `reportRaw` ولا `v7-client-payload-sample*` ولا `v7-verifyReport-response-sample*` ولا `v6-reports-document-sample.json`. حارس الحقل (§٣ في `test/evaluationRulesVersion.test.js`) يتبع الثابت.
- **نسخ مستودعَي التطبيق والموقع من عيّنات «مستند التقرير»** (`app/src/test/resources/contract/*reports-document*` وما يقابلها في الموقع — منقول، غير متحقَّق من هنا) **تحتاج تحديثاً بنسخة هذه الستّ** إن كانت تحرس شكل المستند بالمطابقة (مفتاح جذر جديد)؛ لم تُمسّ.

## ١٦ · ثلاثة قرارات خادم صغيرة: سبب الحالة اليدوية غير المعروفة · العتاد الغائب خارج مقام التغطية · `unavailable→fail` يُعيد التقييم (ق١–ق٣، 2026-10-23 +03)

**المصدر:** قرارات حسن (تفويض 2026-10-22) المنقولة في ورقة القرارات `DECISIONS-FOR-HASAN-2026-10-21.md` ق١–ق٣، وأمر المستخدم 2026-10-23: «القياس قبل التبنّي هو الشرط الحاكم». **منقول، غير متحقَّق من هذا المستودع:** نصّ المقترحات الثلاثة (محفوظ حرفياً في رؤوس التزاماتها).

**الالتزامات (كلٌّ منها كود + اختبار يفشل قبله ويمرّ بعده + مطفّرات):** ق١ `65c3030` · ق٢ `99e13f8` · ق٣ `60abbab`.

### ما تغيّر في الشكل (إضافة وحيدة، لا حقل جديد)
| | |
|---|---|
| **ق١ — مفردة `notMeasuredReason` لاختبار يدوي** | القيم الثلاث الممكنة اليوم لصفّ يدوي غير مقيس: `HARDWARE_ABSENT` (حالته `unavailable`) · `OPERATOR_SKIPPED` (حالته `not_tested` وحدها) · **`UNKNOWN_MANUAL_STATUS` (جديدة)** — كل حالة أخرى أو غائبة (نصّ غريب · `null` · لا مفتاح · غير نصّ). الصفّ `outcome:"NOT_MEASURED"` في الثلاث. المصدر الواحد: `NOT_MEASURED_REASON` في `functions/src/analysis/testKinds.js` (مُصدَّر ومجمَّد). الوظيفي لم يتغيّر (غير المعروف `HARNESS_ERROR`). |
| **أين تظهر** | `categoryStates.testResults[].notMeasuredReason` (المستند المقروء `reports/{scanId}` وحمولة النموذج) — حقل قائم، قيمته الجديدة فقط. |
| **قرّاء هذا المستودع** | لا كود هنا يتفرّع على قيمة السبب (`git grep -n "OPERATOR_SKIPPED" -- functions/src` ⟵ `testKinds.js` وحده)؛ `buildDeterministicIssues` يكتب `DISC-<testId>` لأي NOT_MEASURED بسبب، بنصّ عنوان واحد لا يتبع القيمة. |
| **قرّاء التطبيق والموقع** | **لم يُفحصا** (خارج الحدود). أيّ قارئ يتفرّع على `OPERATOR_SKIPPED` أو يفترض مفردة مغلقة بأربع قيم يحتاج تحديثاً بالقيمة الجديدة (القاعدة 25) — **القارئ المُعدَّد: غير مُعدَّد من هنا**. |
| **ق٢ — مقام التغطية** | `computeHealthBearingStats` (`categoryStates.js`) تستثني من المقام صفّاً `outcome==="NOT_MEASURED" && notMeasuredReason==="HARDWARE_ABSENT"`. الحقول المتأثّرة وحدها: `categories.<cat>.coverage` و`declaredCount` (فئة فيها عتاد غائب)، وفي بوّابة `LOW_CATEGORY_COVERAGE` لتلك الفئة: `coveragePct` و`belowThreshold` و`source`. فئة كلّها غائبة العتاد: `declaredCount:0` و`state:"UNMEASURED"`. التغطية العامّة (`overall.coverage`) تقرأ تغطيات الفئات فتتبع. حرف الفئة ودرجتها وحالتها لا تتغيّر في أيّ مدخل مُقاس (§القياس)، لكن **قد** تتغيّر في مدخل لم يُقَس: فئة تغطيتها دون العتبة بسبب العتاد الغائب وحده كانت تُسقَّف B (`LOW_CATEGORY_COVERAGE`) ولم تعد. |
| **ق٣ — إعادة التقييم** | `reevaluationDecision` يُطلق `manual:<testId> unavailable→fail` (مُطلِق رابع، بلا `maintenanceSuspected`). لا أثر عملي اليوم: `DEFAULT_REUSE_ENABLED=false` (`utils/resolveCacheConfig.js:27`). |

### القياس قبل التبنّي (القاعدة الحاكمة: لا تبنٍّ إن تغيّر مخرَج مسجَّل من جهاز)
**الأدوات (مسمّاة):** `measure-golden.js` (يبني اثنتي عشرة عيّنة ذهبية بمولّداتها ويقارن كل ورقة بالمُلتزَم) و`measure-deterministic.js` + `compare-deterministic.js` (يشغّلان `computeCategoryStates` على 22 مدخلاً حتمياً من `test/fixtures`: أربعة مسوحات خامّ + 18 كائناً يحمل `functionalResults`) في `scratchpad/backend-delegated/`. الخط الأساس على `0dfe892`: 0 أوراق متغيّرة (`measure-baseline.json`).

| المقترح | عيّنات ذهبية متغيّرة (من 12) | مدخلات حتمية متغيّرة (من 22) | منها مسجَّلة من جهاز | الحكم |
|---|---|---|---|---|
| ق١ | 0 (`measure-P1-q1.json`) | 0 (`det-diff-P1.json`) | 0 | يُبنى |
| ق٢ | 0 (`measure-P2-q2.json`) | 11 مدخلاً · 65 ورقة (`det-diff-P2.json`) | 0 | يُبنى |
| ق٣ | 0 (`measure-P3-q3.json`) | 0 (`det-diff-P3.json`) | 0 | يُبنى |

**ق٢ — ما تغيّر بالضبط:** المدخلات الأحد عشر كلّها `SYNTHETIC_DERIVED` (حمولات `fv69`/`fv70`/`fv71` المشتقّة من `fv67`، المصنوعة بحالات يدوية محقونة)، والأوراق كلّها في فئة `audio` (وزنها 0) وبوّابتها: `coverage` (0.5 ⟵ 1 · 0.667 ⟵ 1) و`declaredCount` (2 ⟵ 1 · 3 ⟵ 2) و`coveragePct` و`belowThreshold` و`source`. **لا حرف ولا حالة ولا درجة ولا درجة عامة.** المدخلات المسجَّلة من جهاز (أربعة مسوحات خامّ + تصدير الإنتاج v6) لا تحمل صفّاً يدوياً `unavailable`، فلم يتغيّر فيها شيء.

### العيّنات الذهبية (القاعدة 39)
**لم يُعَد توليد شيء:** لا مخرَج ذهبي مُلتزَم يحمل القيم المتغيّرة (الحمولات المتأثّرة مُدخلات لا مخرَجات)، والحرّاس الثلاثة عشر (`*ContractGuard`) تمرّ بلا تعديل. نسخ التطبيق والموقع من العيّنات: منقول، غير متحقَّق — لا تغيّر فيها بهذا الالتزام.

### ما لم يُفعَل
- **ختم `evaluationRulesVersion` لم يُرفع** (§١٥: «لا يُرفع تلقائياً ولا يُرفع بلا قرار»): الالتزامات الثلاثة تغيّر قواعد التقييم ظاهراً، ويبقى الختم `rules-2026-10-13-zero-cycles-unsupported`. **قرار المستخدم:** هل يُرفع؟ **← رُفع لاحقاً (2026-10-23)، بقرار حسن بنصّه: «ق٢ (INV:112): يُرفع evaluationRulesVersion قبل النشر ليميّز التقارير قبل ق٢ وبعده.» — الختم الحالي `rules-2026-10-23-hardware-absent-coverage` (§١٥ «القيمة الحالية»).**

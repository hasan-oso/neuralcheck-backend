'use strict';

// ===================================================================
// expectedV7PayloadBytes.js — مصدر واحد مُصدَّر (القاعدة 24) لثابت
// payloadBytes المتوقَّع على كلا الفِخّين الذهبيَّين. يستورده
// `test/expectedV7PayloadBytes.test.js` (بوّابة السويت العادية —
// تُشغَّل مع كل `node test/*.test.js`) و`scripts/measure-callAIv7-live.js`
// (بوّابة --dry-run قبل أي نداء DeepSeek) **معاً** — نسخة واحدة، لا
// نسختان قد تنجرفان.
//
// ⚠️ **لماذا هذا الملفّ وُلد (أمر مستخدم 2026-09-23 +03، البند ٤، نصّه
// حرفياً)**: "هذا يُغلق العلّة لا الحالة: خمسة التزامات مرّت والاختبارات
// خضراء والحمولة كبرت 5490 بايتاً — لأن البوّابة كانت داخل سكربت النداء
// وحده." الثابت كان يعيش فقط داخل measure-callAIv7-live.js — سكربت لا
// يُشغَّل تلقائياً مع السويت (يحتاج --dry-run يدوياً) — فتغيّرات حقيقية
// في شكل الحمولة (30ef54a: بوّابة LOW_CATEGORY_COVERAGE كاملة، 4b52c8f:
// findings.storage.capacityDerived) مرّت بلا أن يُلاحَظ نموّها، لأن لا
// اختبار في السويت العادي كان يقرأ هذا الرقم أصلاً.
//
// كل رقم أدناه بمصدره حقلاً حقلاً (القاعدة 32 — لا رقم من الذاكرة):
// ===================================================================

// ─── b45c8cf6 ────────────────────────────────────────────────────────────
// 64782  commit 9514421 ("test(v7-payload): تحديث ثابت payloadBytes حقلاً
//        حقلاً بعد استبعاد الأربعة") — القيمة المرجعية قبل هذه الجولة.
// +5250  commit 30ef54a (بوّابة LOW_CATEGORY_COVERAGE بأكملها — 14 كائن
//        gate جديد، سابقة لهذه الجولة تماماً، لم تُقَس عند إضافتها).
// +0     commit efeebe7 (صنف استثناء حارس reportShapeV7.js — لا صلة
//        بالحمولة).
// +240   commit 4b52c8f (findings.storage.capacityDerived — حقل جديد).
// +0     commit 2cce881 (اختبارات فقط — لا كود إنتاجي).
// +0     هذه الجلسة، صافياً: أُضيف belowThreshold/allNonMeasurement على
//        كائن gate (+1146 — letterCeilingReason)، ثم اسُتبعِدا من
//        الحمولة فوراً في نفس الجلسة (−1146 — البند ٢) — الحقلان يبقيان
//        في categoryStates/display/المستند، لا في حمولة النموذج فقط.
// −18    llmOverall أُضيف إلى الاستبعاد (البند ٦ — حقل ميّت، null دائماً).
// = 64782+5250+0+240+0+0-18 = 70254 (رقم الجولة السابقة — 2026-09-23 +03 الأولى)
//
// ⚠️ **تحديث لاحق (نفس اليوم +03) — حالة بوّابة خامسة INPUT_ABSENT**
// (أمر مستخدم، القرار "ب": NOT_FIRED كانت تُعطى لمُدخل غائب/غير قابل
// للقراءة، لا لقياس فعلي بشرط=false — القاعدة 22 في موضعها السادس).
// +12  categoryStates.js: computeLowCategoryCoverageGate (فرع
//      executed.length===0) صار يُعيد status='INPUT_ABSENT' لا 'NOT_FIRED'.
//      على b45c8cf6/34dff2b8 كليهما: 4 كائنات LOW_CATEGORY_COVERAGE
//      تتأثّر (thermal/camera/audio/input — الفئات الأربع UNMEASURED،
//      executedCount=0 فعلاً؛ مُتحقَّق بتشغيل فعلي) — كلّها في
//      overall.gatesApplied فقط (صفر في categories.<cat>.gatesApplied
//      الخاصّة بها — تلك الفئات UNMEASURED لا MEASURED/PARTIAL، فلا تصل
//      applyCeilings أصلاً، gatesApplied تبقى [] هناك). طول
//      "INPUT_ABSENT" (12 حرفاً) − طول "NOT_FIRED" (9 أحرف) = +3 حرفاً/
//      بايتاً لكلّ ظهور (كلاهما ASCII، حرف=بايت) × 4 ظهورات = +12 بايتاً.
//      ROOT_DETECTED/PATCH_AGE لم يتغيّرا على هذين الفِخّين تحديداً (SEC-04=
//      'fail'، SEC-03 تاريخ صالح — كلاهما FIRED كما كان قبل إعادة
//      التصنيف، القيمة الفعلية لم تتغيّر وإن تغيّر منطق التصنيف خلفها).
// = 70254+12 = 70266
//
// مُتحقَّق بأداتين مستقلّتين محفوظتين (كلا التحديثين):
//   functions/scripts/measure-payload-history.js (worktree منفصلة لكل
//   التزام أعلاه، zero remainder — functions/scripts/out/
//   payload-history-b45c8cf6-34dff2b8-2026-09-23.json — يسبق تحديث
//   INPUT_ABSENT، يوثّق السلسلة حتى 70254/70349 فقط)
//   functions/scripts/measure-whitelist-vs-exclusion-equality.js (تطابق
//   === حرفي بين أسلوبَي الاستبعاد والقائمة البيضاء، أُعيد تشغيله بعد
//   INPUT_ABSENT فأعطى 70266/70361 — functions/scripts/out/
//   whitelist-vs-exclusion-equality-2026-09-23.json، أحدث نسخة)
//
// ─── 34dff2b8 — نفس السلسلة بالضبط، بما فيها +12 الأخيرة (نفس الفئات
// الأربع UNMEASURED بنفس التوزيع، مُتحقَّق منفرداً) ──────────────────────
// 64824+5303+0+240+0+0-18+12 = 70361
//
// ⚠️ **تحديث لاحق (2026-09-25 +03، القرار ٨٨ البند ٢)** — sanitizeTestResultsForModelPayload
// (buildV7Payload.js) تحذف raw.status من عناصر testResults التي
// notMeasuredReason==='ENVIRONMENT_UNSUITABLE' (N-10/N-05/N-06/N-08/
// L-02/L-03/SN-03/SN-08/SN-09 — ENVIRONMENT_EFFECT_IDS، testKinds.js).
// **+0 على كلا الفِخّين هنا تحديداً** — كل هذه المعرّفات pass/not_tested/
// unavailable فعلياً على b45c8cf6/34dff2b8 (لا واحد منها ENVIRONMENT_UNSUITABLE)
// فالدالّة لا تُغيّر شيئاً على هذين الفِخّين — مُتحقَّق بتشغيل فعلي
// (expectedV7PayloadBytes.test.js: 5/5 بلا تغيير في الرقمين، لا تخمين).
// الأثر الفعلي (حذف حقيقي لـraw.status) مُختبَر اصطناعياً في
// buildV7Payload.test.js §1-ب (لا فِخّ حقيقي يحمل الحالة اليوم).
//
// ⚠️ **تحديث لاحق (2026-09-25 +03، القرار ٩٥ البند ١ ج)** — قالب عنوان
// DISC في categoryStates.js:buildDeterministicIssues صار `غير مقيس:
// ${testId}` (كان `غير مقيس: ${testId} (${notMeasuredReason})`) — رمز
// السبب لم يعد يظهر بين قوسين في العنوان، وtitle حقل يصل حمولة النموذج
// (testResults[].evidence لا، لكن categoryStates.issues[].title نعم —
// جزء من body.categoryStates.issues). **−447 بايتاً على كلا الفِخّين معاً**
// (23 ملاحظة DISC على كل منهما — S10/34dff2b8 — نفس العدد ونفس رموز
// الأسباب حرفياً، فنفس الفارق بالبايت بالضبط):
//   b45c8cf6: 70266 → 69819
//   34dff2b8: 70361 → 69914
// مُتحقَّق بتشغيل فعلي مباشر (expectedV7PayloadBytes.test.js، بعد تحديث
// الرقمين أدناه: 2/2 بلا فشل) — لا تخمين حسابي.
//
// ⚠️ **تحديث لاحق (2026-09-27 +03 → 2026-09-30 +03، أمر «الإعدادات لا
// تُنزل الحرف»)** — testKinds.js: SEC-01/05/06/07 وCM-08 وT-01/T-02 صارت
// healthBearing=false (ثلاث مجموعات بأسبابها، راجع testKinds.js). الأثر
// على الحمولة: buildDeterministicIssues (categoryStates.js:653، `if
// (!r.healthBearing) continue`) لم تعد تُنتج عناصر issues[] لهذه السبعة —
// عناصر أقلّ في body.categoryStates.issues تصل حمولة النموذج. **−845
// بايتاً على b45c8cf6، −871 على 34dff2b8** (رقمان مختلفان — عدد
// الملاحظات المحذوفة وأطوال نصوصها ليست مطابقة بين الفِخّين):
//   b45c8cf6: 69819 → 68974
//   34dff2b8: 69914 → 69043
// مُتحقَّق بتشغيل فعلي مباشر (expectedV7PayloadBytes.test.js بعد تحديث
// الرقمين أدناه: 2/2 بلا فشل) — لا حساب يدوي لعدد الحروف المحذوفة.
//
// ⚠️ **تحديث لاحق (2026-10-01 +03، أمر «C-07 وS-06» البند ١)** —
// testKinds.js: C-07/S-06 صارتا healthBearing=false (المجموعة الرابعة
// «عتبة غير معايَرة»). الأثر على الحمولة: (أ) declaredCount/executedCount/
// coveragePct المُضمَّنة في body.categoryStates.cpu/storage تتغيّر رقمياً
// (أرقام أقصر/أطول بالبايت)، و(ب) buildDeterministicIssues لم تعد تُنتج
// ISS-S-06 على 34dff2b8 (S-06=warning هناك) — عنصر issues[] أقلّ. **+6
// بايتاً على b45c8cf6 (لا ISS محذوف هناك — S-06/C-07 كلاهما pass، فقط أرقام
// التغطية تغيّرت)، −77 بايتاً على 34dff2b8 (نفس تغيّر الأرقام + حذف عنصر
// ISS-S-06 واحد)**:
//   b45c8cf6: 68974 → 68980
//   34dff2b8: 69043 → 68966
// مُتحقَّق بتشغيل فعلي مباشر (expectedV7PayloadBytes.test.js بعد تحديث
// الرقمين أدناه: 2/2 بلا فشل) — لا حساب يدوي.
//
// ⚠️ **تحديث لاحق (2026-10-01 +03، S1-S5)** — categoryStates.js:
// buildDeterministicIssues (S2) صارت تبني issues[].title بقالب "<تنبيه|
// فشل|غير مقيس|لا أعطاب> — <اسم الفئة بالعربية>" بدل القالب القديم الذي
// يحمل testId/مفتاح فئة لاتيني — title حقل يصل حمولة النموذج (نفس ملاحظة
// 2026-09-27 أعلاه: جزء من body.categoryStates.issues). **+39 بايتاً على
// كلا الفِخّين معاً** (فارق متطابق بالمصادفة — عدد/توزيع issues[] مختلف
// بين الفِخّين، لكن الفارق الصافي بالبايت تطابق رقمياً؛ مُتحقَّق بتشغيل
// فعلي لا افتراضاً):
//   b45c8cf6: 68980 → 69019
//   34dff2b8: 68966 → 69005
// مُتحقَّق بتشغيل فعلي مباشر (expectedV7PayloadBytes.test.js بعد تحديث
// الرقمين أدناه: 2/2 بلا فشل) — لا حساب يدوي.
//
// ⚠️ **تحديث لاحق (2026-10-01 +03، قرار المستخدم «أسماء الفئات» — تطبيق
// S1-S5 + ملحق verifyReport)** — CATEGORY_NAME_AR (utils/categories.js)
// تغيّرت لخمس فئات (storage/thermal/memory/gpu/input) — تصل حمولة النموذج
// عبر issues[].title (نفس ملاحظتَي 2026-09-27/S1-S5 أعلاه). **−30 بايتاً
// على كلا الفِخّين معاً** (فارق متطابق فعلياً هذه المرّة، لا بالمصادفة فقط
// — الأسماء الأقصر الثلاثة "التخزين"/"الحرارة"/"الذاكرة" طغت على الاسم
// الأطول الوحيد "اللمس والأزرار" (input) بنفس المقدار على كلا الفِخّين،
// لأن توزيع عدد عناصر issues[] لكل فئة متطابق بينهما على هذا الحقل
// تحديداً من الصدفة الحسابية لا تصميم). harnessErrorMessage/gate text
// (governingGateReason.text) **لا تصل حمولة النموذج** — مُستبعَدة صراحة
// (v7ModelPayloadWhitelist.js) — فلا أثر لها هنا:
//   b45c8cf6: 69019 → 68989
//   34dff2b8: 69005 → 68975
// مُتحقَّق بتشغيل فعلي مباشر (expectedV7PayloadBytes.test.js بعد تحديث
// الرقمين أدناه: 2/2 بلا فشل) — لا حساب يدوي.
//
// ⚠️ **تحديث لاحق (2026-10-01 +03، مهمّة "إخفاء القيم غير المعايَرة عن
// حمولة النموذج"، بنود ٢-٣ من أمر المستخدم)** — تغييران معاً في نفس
// القياس (لا فاصل بينهما بتشغيل منفصل، القاعدة 23: الثابت يُستبدَل لا
// يُضاف إليه):
//   (أ) البند ٢ يحجب عن الحمولة: findings.sustainedCeiling/graphics/battery
//       كاملةً (تُستبدَل بـ{status,notMeasuredReason,note} أو {note} فقط)،
//       مؤشّرات البطارية BAT-FCC/BAT-R-APPARENT/BAT-COULOMB/BAT-THERMAL-EFF
//       (تُستبدَل كل واحدة بـ{id,status,note})، وrawValue لكل اختبار في
//       THERMAL_UNCALIBRATED_IDS/UNCALIBRATED_THRESHOLD_IDS (buildV7Payload.js).
//       هذا تخفيض كبير — عشرات الحقول الرقمية الدقيقة (نِسَب بعشر منازل
//       عشرية، قيم mAh/mA/mΩ/mV/kHz) تستبدلها عبارة نصّية ثابتة واحدة
//       مُكرَّرة ("مقيس، ولا حكم عليه في هذا الإصدار").
//   (ب) البند ٣ يُقرِّب كل عدد عشري متبقٍّ في الحمولة إلى منزلتين عشريتين
//       (roundPayloadNumbersDeep، نقطة واحدة في buildV7Payload.js) — يُقصِّر
//       أرقاماً طويلة مثل "0.7142857142857143"→"0.71"، فرق أصغر بكثير من (أ).
// **−4509 بايتاً على كلا الفِخّين معاً** (فارق متطابق فعلياً بالمصادفة
// الحسابية — عدد/أطوال الحقول المحجوبة ليست مطابقة بنيوياً بين الفِخّين،
// لكن الفارق الصافي بالبايت تطابق رقمياً؛ مُتحقَّق بتشغيل فعلي مباشر، لا
// حساب يدوي ولا افتراض أن التطابق سيتكرّر لتغييرات لاحقة):
//   b45c8cf6: 68989 → 64480
//   34dff2b8: 68975 → 64466
// مُتحقَّق بتشغيل فعلي مباشر (node -e عبر buildV7Payload+EXPECTED_V7_PAYLOAD_BYTES
// الحاليين قبل هذا التحديث، ثم expectedV7PayloadBytes.test.js بعده: 5/5 بلا
// فشل) — راجع تقرير المهمّة لقياس «قبل/بعد» الكامل.
//
// ⚠️ **تحديث لاحق (2026-10-06 +03، أمر المستخدم على تقرير الحمولة — D1/D2/D3)**:
//   D1: evidence (نسخة من rawValue) لاختبارات C-07/S-06 يُحجَب أيضاً؛ D2: findings
//   .advisoryMeasurements.S-06.rawValue يُحجَب؛ D3: «مقيس» يُكتب حين توجد قيمة وحدها
//   (findings.battery يصير {status,note} لا {note}، وfindings.sustainedCeiling/graphics
//   بلا تغيير في الشكل على هذين الفِخّين لأن status=MEASURED). الأثر **+48 بايتاً على
//   كلا الفِخّين** (مفتاح status الجديد في findings.battery + نصّان محجوبان في evidence
//   + نصّ محجوب في advisoryMeasurements.S-06.rawValue بدل الرقم):
//   b45c8cf6: 64480 → 64528
//   34dff2b8: 64466 → 64514
// مُتحقَّق بتشغيل فعلي (expectedV7PayloadBytes.test.js بعد التحديث: 5/5) — لا حساب يدوي.
//
// ⚠️ **تحديث لاحق (2026-10-06 +03، أمر المستخدم: المبدأ «لا تصل إلى النموذج قيمة لا يُبنى عليها حرف
//   ولا عتبة معايَرة لها» — البنود ٢–٤)**: (أ) findings.channels وfindings.perChannelUpdateCount
//   تُحذفان من الحمولة (تبقيان في المستند)، (ب) findings.thermal/storage تصلان بحالتهما وحدها، و
//   findings.unstableMeasurements/advisoryMeasurements بحالتها «مقيس»/«غير مقيس» دون criterion/
//   referenceCvPct/referenceNote، (ج) UNSTABLE_IDS (C-03/C-04/S-04/S-05) تصل في testResults بحالتها
//   وحدها. (نصّ systemPromptV7 لا يدخل userMessage فلا أثر له هنا.) القياس: userMessage.length
//   (ثم expectedV7PayloadBytes.test.js). الأثر **−10790 على b45c8cf6 و−10774
//   على 34dff2b8** (استُبدل الثابت لا أُضيف إليه، القاعدة 23):
//   b45c8cf6: 64528 → 53738
//   34dff2b8: 64514 → 53740
//
// ⚠️ **تحديث لاحق (2026-10-07 +03، أمر المستخدم على القوائم)** — (١) حجب كامل (الحالة + القيمة + raw.notes + أرقام الوحدة) لاختبارات
//   S-02/R-02/R-03 وB-01..B-07، (٢) إعدادات الجهاز SEC-01/05/06/07 وL-01 وCM-08 تُحجب حالتها (outcome/raw.status) وتبقى قيمتها،
//   (٣) SEC-08 «غير مقيس» دائماً، (٤) findings.meta بلا wallMs/sampleCount/expectedSamples وnotMeasuredFields بلا value،
//   (٥) حقل ageMonths رقماً في بوّابة PATCH_AGE (نسختا البوّابة)، (٦) تعديل نصوص systemPromptV7 (لا يدخل userMessage). الثابت «مقيس، ولا حكم
//   عليه في هذا الإصدار» (33 حرفاً) أطول من القيم الصغيرة التي يحلّ محلّها (نصّ المستخدم: يبقى الثابت) فالحمولة **تكبر**:
//   b45c8cf6: 53738 → 54862
//   34dff2b8: 53740 → 54864
// القياس: userMessage.length (scratchpad bytes.js ثم expectedV7PayloadBytes.test.js). استُبدل الثابت لا أُضيف إليه (القاعدة 23).
//
// ⚠️ **تحديث لاحق (2026-10-07 +03، أمر المستخدم البند ٣ — «سقف»)**: ملاحظتا البوّابة في نسخة النموذج تصيران «… أدنى من حدّ هذه البوّابة
//   أصلاً — لا أثر» بدل «… أسوأ من السقف أصلاً — لا أثر» (أطول بـ11 حرفاً للأساسي و11 للعامّ) في 12 موضعاً على كل من الفِخّين
//   (النصّ المخزَّن لم يتغيّر). **+132 على كلا الفِخّين**:
//   b45c8cf6: 54862 → 54994
//   34dff2b8: 54864 → 54996
//
// ⚠️ **تحديث لاحق (2026-10-07 +03، أمر المستخدم البند ٢ — وسم «غير مستقرّ»)**: يُحجب في نسخة النموذج حقل unstable (testResults[]) وclass وlabel
//   (findings.unstableMeasurements[id]) للاختبارات الأربعة في UNSTABLE_IDS (C-03/C-04/S-04/S-05)؛ والمخزَّن لا يتغيّر. **−248 على كلا الفِخّين**
//   (القياس: userMessage.length، scratchpad bytes.js ثم expectedV7PayloadBytes.test.js؛ استُبدل الثابت لا أُضيف إليه، القاعدة 23):
//   b45c8cf6: 54994 → 54746
//   34dff2b8: 54996 → 54748
//
// ⚠️ **تحديث لاحق (2026-10-07 +03، قرار المستخدم على «غير مستقرّ»)** — يحلّ محلّ التحديث السابق (استُبدل الثابت لا أُضيف إليه، القاعدة 23):
//   (أ) حقل unstable يُحذف من كل اختبار في نسخة النموذج (لا من الأربعة وحدها)؛ (ب) findings.unstableMeasurements تُحذف كلّها (MODEL_FINDINGS_POLICY: REMOVE)
//   — بدل حجب class/label للأربعة وحدها. حالات الأربعة تصل في testResults وحدها. (تعليمات systemPromptV7 لا تدخل userMessage: حذف عبارة UNSTABLE وجملة اللاتيني
//   المسموح لا أثر لهما هنا.) **−2123 على كلا الفِخّين** (القياس: userMessage.length، scratchpad bytes.js ثم expectedV7PayloadBytes.test.js):
//   b45c8cf6: 54746 → 52623
//   34dff2b8: 54748 → 52625
const EXPECTED_V7_PAYLOAD_BYTES = Object.freeze([
  Object.freeze({
    scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844',
    tsFile: 'b45c8cf6.ts.json',
    expectedPayloadBytes: 52623,
  }),
  Object.freeze({
    scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195',
    tsFile: '34dff2b8.ts.json',
    expectedPayloadBytes: 52625,
  }),
]);

// ─── GOLDEN_ANALYZED_AT_MS — مصدر واحد مُصدَّر (القاعدة 24) ──────────────
// أمر مستخدم 2026-10-01 +03 ("fix measure-resolveV7Report-live.js قبل
// النداءات الحيّة"، البند ٢): كانت قيمة `ANALYZED_AT_MS` مكرّرة محلّياً في
// expectedV7PayloadBytes.test.js وحده؛ measure-resolveV7Report-live.js
// (المسار الذهبي، buildScanInputs) لم يكن يمرّر analyzedAtMs إطلاقاً، فكان
// `--dry-run` بلا مُدخلات يقيس رقماً مختلفاً عمّا يثبته هذا الاختبار
// (68986 لا 68989 — بوّابة PATCH_AGE تصل UNKNOWN بدل FIRED/NOT_FIRED، ونصّ
// `source` يختلف طولاً). كلاهما يستورد من هنا الآن — لا نسخة ثانية.
//
// القيمة ثابتة موسومة (لا Date.now()، يكسر تكراريّة الرقم المرجعي) —
// تمثّل واقع الإنتاج (functionStartTime حقيقي دائماً، القرار ٧٥ البند ٤)
// بقيمة قابلة لإعادة الإنتاج لغرض اختبار الانحدار وحده.
const GOLDEN_ANALYZED_AT_MS = Date.parse('2026-09-24T00:00:00.000Z');

module.exports = {EXPECTED_V7_PAYLOAD_BYTES, GOLDEN_ANALYZED_AT_MS};

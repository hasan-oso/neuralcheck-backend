// ===================================================
// testKinds.js — جدول الأنواع والثلاثية TestResult (P1.2، PLAN-01-ROADMAP
// §المرحلة ١، P1.2) + تعديل 2026-09-20 (إضافة UNSTABLE، البطارية ESTIMATED)
// ===================================================
// يُصنِّف كل testId في functionalResults/manualResults إلى kind واحد من
// {SPEC, STATE, MEASUREMENT} (نصّ P1.2 حرفياً)، مع وسم إضافي `unstable`
// (تعديل 2026-09-20: "جدول الأنواع يضيف UNSTABLE" — وسم إلى جانب kind لا
// قيمة رابعة لـkind؛ C-04/S-04/S-05/C-03 هي أصلاً MEASUREMENT numeric
// بحسب طبيعتها، ويحملن الوسم unstable=true فوق ذلك) ثم يبني TestResult
// عبر toTestResult().
//
// ─── مصدر التصنيف — ما هو موثَّق حرفياً في PLAN-01-ROADMAP.md مقابل ما
//     هو افتراض مهندس هنا (يُذكر في تقرير المهمّة تحت "افتراضات") ────────
//
// موثَّق حرفياً (P1.2، §تعديل 2026-09-20، وتعليمات المهمّة):
//   • C-04, S-04, S-05, C-03  → MEASUREMENT + unstable=true (لا حرف ولا عطب)
//   • C-06, G-03, G-04, G-05  → "MEASUREMENT معطَّلة حتى P2" — نُفِّذت هنا:
//     kind=MEASUREMENT، والنتيجة المُبلَّغة من التطبيق تُستهلَك كما وصلت
//     (لا نجاح يُقلَب NOT_MEASURED)، مع علم disabledUntilPhase2=true يعني
//     فقط أن التحقّق المتقاطع مع Findings (evidence gate) غير موصول بعد
//     (ذلك P2.3/P2.6/P2.7) — "معطَّلة" قرأتُها تعطيلاً للبوّابة الإضافية
//     لا لقبول النتيجة نفسها؛ **هذا تأويل**، غير حرفي 100%، مذكور بارزاً.
//   • T-04, SEC-08, CM-11     → SPEC (healthBearing=false)
//   • B-08 (تعليمات المهمّة، خارج نصّ PLAN-01 P1.2 القديم): تُلحَق بالسبب
//     نفسه (لا يمكن أن ينجح على untrusted_app) → SPEC (healthBearing=false)
//   • الفحوص اليدوية (manualResults) → STATE(manual)، attested=true.
//
// **الـ"12 CLAIM" المذكورة في النصّ ("الـ12 CLAIM تُوزَّع") — تسعة فقط
// مُسمَّاة صراحةً (C-06, G-03..05, S-04, S-05, T-04, SEC-08, CM-11).
// الثلاثة الباقية غير مُسمّاة في أي مصدر متاح لي داخل هذا المستودع أو
// PLAN-01-ROADMAP.md — لم أخترعها. راجع تقرير المهمّة.**
//
// افتراض مهندس صريح لكل ما تبقّى (~73 من 85 معرّف functionalResults):
//   kind افتراضي = STATE. أغلب هذه المعرّفات حقائق حالة ثنائية أو نصّية
//   (SIM جاهزة/غير جاهزة، Wi-Fi متصل، مستشعر يقرأ/لا يقرأ) لا قياساً
//   تدريجياً بمعنى P1.1 (channel stats). هذا افتراض عريض غير مُتحقَّق لكل
//   معرّف على حدة — يُراجَع لاحقاً معرّفاً معرّفاً عند توفّر تصنيف رسمي.
//
// ─── اليدوي `unavailable` ⟵ NOT_MEASURED/HARDWARE_ABSENT (الدفعة ١٠، 2026-10-10 +03) ─────────────
// قرار المستخدم، بنصّه: «غير متوفر في هذا الجهاز» ⇒ HARDWARE_ABSENT: معتمد.
// مصدر الدلالة: عقد التطبيق §٧-ح (أ) (docs/FV68_CONTRACT.md:1452، نسخة NeuralChek a04b4f0): `unavailable` = «الفنّي يُعلن أن الطراز لا يملك المكوّن»،
// و`not_tested` = «لم يختبر»؛ والفرق كان مطموساً في fv68 (كلاهما not_tested). فهو إعلان فنّي عن غياب العتاد: لا «تخطّى الفنّي» (OPERATOR_SKIPPED) ولا «محجوب» (CAPABILITY_BLOCKED).
// ما كان قبل: فرع اليدوي في toTestResult يقرأ كل ما ليس pass/fail/warning ⟵ NOT_MEASURED/OPERATOR_SKIPPED — فكان `unavailable` يُقرأ «تخطّاه الفنّي».
//   (جرد 2026-10-10 كتب CAPABILITY_BLOCKED لليدوي، وذلك فرع الوظيفي أدناه؛ الكود يخالفه — فالذي تغيّر OPERATOR_SKIPPED ⟵ HARDWARE_ABSENT.)
// والوظيفي يبقى كما هو (نصّ الأمر): unavailable ⟵ CAPABILITY_BLOCKED إلا إن شهدت قاعدة طراز ⟵ HARDWARE_ABSENT. و`not_tested` اليدوي يبقى OPERATOR_SKIPPED.
//
// ─── اليدوي: حالة غير معروفة أو غائبة ⟵ NOT_MEASURED/UNKNOWN_MANUAL_STATUS (ق١، 2026-10-23 +03) ─────────────
// قرار المستخدم (تفويض حسن 2026-10-22، «القرارات» ق١): ما سوى pass/fail/warning/unavailable/not_tested في حالة اختبار يدوي لا يُقرأ «تخطّاه الفنّي».
// كان الفرع يُسقط كل ما سوى الأربع (ومنه الحالة الغائبة والنصّ الغريب) على OPERATOR_SKIPPED — قيمة افتراضية تسدّ غياباً (القاعدة 22، الملحق).
// الآن: `not_tested` وحدها ⟵ OPERATOR_SKIPPED؛ وكل غيرها ⟵ UNKNOWN_MANUAL_STATUS (حالة صريحة تظهر في الحمولة، لا نجاح ولا تخطٍّ مفترض).
// القياس قبل التبنّي: لا مدخل في test/fixtures يحمل حالة غير معروفة (الأداة: scratchpad/backend-delegated/measure-golden.js، statusTally) — فلا أثر على أي عيّنة ذهبية.
// ===================================================

'use strict';

const KIND = Object.freeze({SPEC: 'SPEC', STATE: 'STATE', MEASUREMENT: 'MEASUREMENT'});

// أسباب «غير مقيس» المُعلَنة في فرع اليدوي (وHARDWARE_ABSENT في الوظيفي) — مصدر واحد مُصدَّر (القاعدة 24): categoryStates.js يقرأ HARDWARE_ABSENT من هنا
// ولا ينسخه. القيم الحرفية كما كانت في الشجرة قبل ق١ (HARDWARE_ABSENT · OPERATOR_SKIPPED) + الاسم الجديد.
const NOT_MEASURED_REASON = Object.freeze({
  HARDWARE_ABSENT: 'HARDWARE_ABSENT',
  OPERATOR_SKIPPED: 'OPERATOR_SKIPPED',
  UNKNOWN_MANUAL_STATUS: 'UNKNOWN_MANUAL_STATUS',
});

// أربعة مؤشّرات البطارية الجديدة (batteryLayer.js، §٤-ج) — ليست
// functionalResults من التطبيق؛ مُحتسَبة على الخادم من samples. مُدرجة هنا
// بنفس شكل الجدول كي يُقرأ الجدول مصدراً واحداً لكل شيء "صحّي".
const BATTERY_LAYER_IDS = Object.freeze([
  'BAT-THERMAL-EFF', 'BAT-R-APPARENT', 'BAT-FCC', 'BAT-COULOMB',
]);

// ENVIRONMENT_EFFECT_IDS — اختبارات تقيس خاصّية الشبكة/المكان لا الجهاز
// (قوّة الإشارة، السرعة، دقّة تحديد الموقع — نصّ المستخدم 2026-09-25 +03،
// القرار ٨٦ البند ١، مبنيّ على P1.2: "قراءة الإشارة أثر للمكان"). fail
// وwarning من هذه المعرّفات تصير NOT_MEASURED/ENVIRONMENT_UNSUITABLE — لا
// تدخل حرفاً ولا عطباً (STATE_FAIL_FLOOR/STATE_WARNING_CEILING،
// categoryStates.js) لأن السبب المرجَّح بيئي (مكان الفحص) لا عطب جهاز،
// وقد يتكرّر الأثر نفسه في المحلّ نفسه بصرف النظر عن حالة الجهاز.
//
// القائمة تُبنى تباعاً بأمر المستخدم بعد فحص كل اختبار على حدة (لا تخمين
// جماعي هنا). أمر مستخدم 2026-09-25 +03 (القرار ٨٧ البند ١) يحلّ محلّ
// القرار ٨٦ البند ١ الجزئي (كان يحصر N-10/N-05 وحدهما، ويُبقي الباقي
// "بانتظار قرار") — المعيار الحاسم الآن بنصّه: "نتيجة الاختبار لا تُنزل
// حرفاً إلا إذا كانت تدلّ على الجهاز لا على المكان. ما يضبطه البروتوكول:
// يُضبط في البروتوكول، ويبقى الاختبار كما هو. وما لا يضبطه: تصير نتيجته
// fail أو warning إلى NOT_MEASURED/ENVIRONMENT_UNSUITABLE.":
//   N-10 — قوّة إشارة Wi-Fi (wireless).
//   N-05 — مستوى الإشارة الخلوية (cellular). كلاهما منقول من تقرير مدقّق
//        على NeuralChek@b3e46cf (مستودع آخر، غير مُتحقَّق من هذا المستودع،
//        القاعدة 27/29): "التطبيق يرسل fail حين level==0، وwarning حين
//        level 1..2 (NetworkTests.kt:172-176)."
//   N-06 — اسم المشغّل فارغ والشريحة موجودة (cellular). التطبيق **لا
//        يُنتج fail لهذا الاختبار** (نصّ الأمر) — warning فقط واقعياً؛
//        فرع fail هنا دفاعي محض ("الخادم يقلب ما يصله" بصرف النظر عمّا
//        يُنتجه التطبيق فعلياً اليوم)، لا مطابقة لمُنتِج حقيقي.
//   N-08 — Wi-Fi مفعّل وغير متّصل (wireless). نفس ملاحظة N-06: **لا fail
//        حقيقي لها**، fail هنا دفاعي فقط.
//   L-02/L-03 — كل الفروع (gps)، لا فرعاً واحداً ("GPS معطّل" فقط كما
//        كان مسوَّداً سابقاً). التعليل بنصّه: "لا تُميَّز فروعهما إلا
//        بنصّ مترجم (notes)، وهذا تصنيف بالاسم" — فالإصلاح لا يقرأ notes
//        إطلاقاً (لم يقرأها من قبل أيضاً)، فكل fail/warning من L-02/L-03
//        يُعامَل بلا تمييز فرعي، بصرف النظر عن نصّ notes أو غيابه.
//   SN-08 — كاشف الخطوات (sensors). أمر مستخدم 2026-09-25 +03 (القرار
//        ٨٧ البند ١، تتمّة — حكم مدقّق منقول، مستودع آخر، غير مُتحقَّق من
//        هذا المستودع، القاعدة 27/29): فرع WARNING "لا قراءة" يدلّ على
//        سكون الجهاز أثناء الفحص (حالة الفحص لا الجهاز) — "والبروتوكول
//        لا يضبطه، فالمشي يناقض الضغط الجاري." المصدر: SensorTests.kt:
//        39,99-103. **لا fail حقيقي لها** (نفس ملاحظة N-06/N-08) — fail
//        هنا دفاعي فقط.
//   SN-09 — عدّاد الخطوات (sensors). SN-03 — مستشعر القرب (sensors). أمر
//        مستخدم 2026-09-25 +03 (القرار ٨٨ البند ١): "SN-09: يُقلب بكل
//        فروعه." · "SN-03: يُقلب تحذيره كلّه، بفرعيه." التعليل بنصّه:
//        "فرع 'لا قراءة' غير محسوم بقياس جهاز واحد، والخادم لا يميّز
//        الفرعين إلا بنصّ مترجم. وهذا ما حُسم في L-02 وL-03" — فالإصلاح
//        لا يقرأ notes هنا أيضاً، بصرف النظر عن الفرع. **لا فرع fail
//        لأيّهما** (حكم مدقّق منقول: "لا فرع fail في testSensor
//        [SensorTests.kt]، والوحيد في الملفّ :172 لـSN-13" — خارج هذه
//        القائمة، غير مطلوب) — warning وحدها لكليهما، لا فرع fail دفاعي
//        هنا (خلافاً لِـN-06/N-08/SN-08 حيث طُلب فرع fail دفاعي صراحة رغم
//        غياب مُنتِج حقيقي؛ هنا النصّ يشترط "إن وُجد له فرع fail" ولا يوجد).
//
// **قُرِّر ألّا تُقلَب** (نصّ الأمر صراحة، لا سهواً):
//   SN-04 — "يُضبط في البروتوكول" (calibration، لا مكان).
//   B-03  — "لا أثر له في حرف" (لا فائدة من قلبه).
const ENVIRONMENT_EFFECT_IDS = Object.freeze([
  'N-10', 'N-05', 'N-06', 'N-08', 'L-02', 'L-03', 'SN-08', 'SN-09', 'SN-03',
]);

// «الإعدادات لا تُنزل الحرف» — أمر مستخدم 2026-09-27 +03 (البند ١). ثلاث
// مجموعات، كل واحدة بسببها المكتوب بنصّ المستخدم حرفياً. الآلية: healthBearing
// فقط (لا تغيير kind ولا مسار outcome) — مطابقة لآلية UNSTABLE_IDS القائمة،
// وتحقَّق بالكود أن computeHealthBearingStats (categoryStates.js:446-452)
// يُصفّي declaredHb/executed بـr.healthBearing **قبل** أي استعمال لاحق —
// فالسقف/الأرضية (:561-562، يفحصان executed لا testResults الخام)،
// والدرجة (:559، 100*passCount/executed.length)، والتغطية (declared/executed
// نفسهما)، وقائمة الأعطال (:653 `if (!r.healthBearing) continue`) — الأربعة
// تُستبعَد معاً بحقل واحد، بلا حاجة لتعديل categoryStates.js. outcome يبقى
// الحالة الحقيقية (FAIL/WARNING) — لا تحويل NOT_MEASURED (ذلك ENVIRONMENT_
// EFFECT_IDS، آلية مختلفة أعلاه، لا تُستعمَل هنا).
//
// المجموعة ١ — «إعداد يغيّره المستخدم»:
const USER_SETTING_IDS = Object.freeze([
  'SEC-01', // قفل الشاشة
  'SEC-05', // خيارات المطوّر
  'SEC-06', // تصحيح USB
  'SEC-07', // إذن تثبيت التطبيقات
  'L-01', // مفتاح الموقع
  'CM-08', // تسجيل البصمة
]);
// المجموعة ٢ — «يصف محتوى المستخدم أو ما يعمل على الجهاز، لا الجهاز»:
const USER_CONTENT_OR_RUNTIME_IDS = Object.freeze([
  'S-02', // المساحة الحرّة
  'R-02', // الذاكرة الحرّة في لحظة الفحص
  'R-03', // الذاكرة الحرّة في لحظة الفحص
]);
// المجموعة ٣ — «لا حرف للحرارة قبل معايرة عتباتها، وتتأثّر بالغرفة»:
const THERMAL_UNCALIBRATED_IDS = Object.freeze([
  'T-01',
  'T-02',
]);
// المجموعة ٤ — «عتبة غير معايَرة» (أمر مستخدم 2026-09-30 +03، «ملحق —
// الجوابان، وقرار C-07 وS-06»، البند ٢)، بنصّه حرفياً: "C-07 (تباين الأداء)
// وS-06 (الكتابة العشوائية) يُضافان إلى آلية الاختبارات غير المعايَرة (على
// نمط THERMAL_UNCALIBRATED_IDS). فيُقاسان، ويُعرضان، ويُحفظان، ولا يحملان
// الصحّة." التعليل بنصّه:
//   • "عتبتاهما في التطبيق منذ 6fd8edc بلا قياس مُسمّى يسندها
//     (CpuTests.kt:238-242، StorageTests.kt:197-201)" — منقول من تقرير
//     مدقّق، مستودع آخر (NeuralChek)، غير مُتحقَّق من هذا المستودع
//     (القاعدة 27/29).
//   • "وهما من صنف STATE: التحذير يسقف الفئة عند C، والفشل يفرض D" —
//     مُتحقَّق هنا: kindOf(C-07)/kindOf(S-06) لا يطابقان أيّ مجموعة أعلاه
//     (BATTERY_LAYER_IDS/CLAIM_TO_SPEC/EXTRA_TO_SPEC_NO_SOURCE_IN_APP/
//     UNSTABLE_IDS/CLAIM_TO_MEASUREMENT_PENDING_P2) فيسقطان على الافتراض
//     STATE (kindOf أدناه، بلا تغيير هنا — هذه المجموعة تُقصي عن
//     healthBearing فقط، لا تُغيّر kind، بنفس آلية THERMAL_UNCALIBRATED_IDS
//     تماماً).
//   • "وS-06 متناقض داخل الخادم: findings.js:67 يسمّيه إرشادياً، وtestKinds.js
//     يُدخله الحرف" — مُتحقَّق: findings.js:67 (ADVISORY_TEST_IDS=["S-06"])
//     يَسِم S-06 بـentersGrade:false/entersFault:false في findings.advisoryMeasurements
//     (findings.js:811-812 عبر buildAdvisoryMeasurements) — **لكن ذلك
//     الكائن يُستهلَك فقط في حمولة النموذج/السرد** (reportShapeV7.js:453،
//     v7ModelPayloadWhitelist.js:22؛ تحقّق سلبي: صفر ذكر لـ"advisoryMeasurements"
//     في buildDisplayShapeV7.js/analyzeDevice.js/verifyReport.js) — لا يمسّ
//     الحساب الحتمي إطلاقاً، الذي يعتمد وحده على isHealthBearing هنا. قبل
//     هذا التعديل، isHealthBearing('S-06') كانت true (لا استثناء)، فكانت
//     S-06 تدخل حرف/عطب فئة storage الحتمي فعلياً — يناقض ما يُقال للنموذج.
//     **الإصلاح في هذا الملفّ وحده يُزيل التناقض** (findings.js:67 لم
//     يتغيّر — كان صحيحاً أصلاً، testKinds.js هو من كان يخالفه).
//   • "وعلى الـS10 نفسه أعطى S-06 التخزين C ثم B (2735 ثم 3069، والعتبة
//     3000)" — نتيجتان حقيقيتان تحادّان العتبة غير المعايَرة نفسها من
//     جهتين، دليل إضافي أنها غير مستقرّة بعد.
//   • "وC-07 هو ما سقف المعالج عند C في NC-TM7PDN" — تصدير حقيقي
//     (v7-report-export-NC-TM7PDN.json، خارج هذا المستودع): C-06=34.2%
//     warning، C-07=10.1%RSD warning، كلاهما ساهم في letter="C" لفئة cpu.
//
// الآلية: healthBearing فقط (لا تغيير kind ولا مسار outcome) — نفس نمط
// UNSTABLE_IDS/THERMAL_UNCALIBRATED_IDS القائم: تُقاسان (outcome الحقيقي
// يبقى)، وتُحفظان (rawFingerprint.functionalResults لا يُقصي أحداً —
// lightenFingerprintForStorage.js لا يمسّ .functionalResults، تحقّق مباشر:
// صفر ذكر له في ذلك الملفّ)، ويبقى معرّفاهما في categories.<cat>.testIds
// (categoryStates.js:545 testIds:testResults.map(r=>r.testId) — بلا فلتر
// healthBearing) — لكن **لا** يدخلان issues[] (categoryStates.js:653
// `if (!r.healthBearing) continue;` داخل buildDeterministicIssues يُسقطهما
// قبل بناء أيّ ISS-C-07/ISS-S-06) ولا يؤثّران في score/letter/coverage
// (computeHealthBearingStats، categoryStates.js:446-452، تُصفّي بـ
// r.healthBearing قبل أي استعمال لاحق — القرار نفسه المذكور في تعليق تلك
// الدالّة).
const UNCALIBRATED_THRESHOLD_IDS = Object.freeze([
  'C-07',
  'S-06',
]);
// ─── مجموعتان تخصّان حمولة النموذج وحدها (أمر مستخدم 2026-10-07 +03، قرار القوائم) — لا أثر على kind ولا
// healthBearing ولا أيّ حساب مخزَّن؛ يستهلكهما buildV7Payload.js (حمولة النموذج) فقط، القاعدة 24: مصدر واحد مُصدَّر.
// B-01..B-07 — اختبارات البطارية STATE: «تُحجب قيمها. وقائمة الأعطال تُحسب في الخادم ولا تتغيّر» (بنصّ المستخدم).
// B-08 SPEC خارجها عمداً («تبقى كما هي. فالمواصفة ليست قياساً»).
const BATTERY_STATE_TEST_IDS = Object.freeze(['B-01', 'B-02', 'B-03', 'B-04', 'B-05', 'B-06', 'B-07']);
// SEC-08 (Play Protect) — «تُحجب قيمته دائماً («غير مقيس»): فالإصدار 1.0.9 يرسل «مفعّل» ثابتة دون قراءة،
// والنموذج لا يُعطى ادّعاءً كاذباً» (بنصّ المستخدم). استثناء من SPEC: لا يصل النموذج منه أيّ قيمة أو حالة وصلت.
const APP_CONSTANT_NOT_READ_IDS = Object.freeze(['SEC-08']);
// لا يُمسّ (نصّ الأمر صراحة): CM-10 (لا يُنتج إلا pass/unavailable)،
// SEC-02/N-02/N-03/D-03 (مختلطة). SEC-04 يبقى كما هو (الجذر، يفرض D).
// C-06 يبقى كما هو (نصّ الأمر صراحة، 2026-09-30 +03): MEASUREMENT
// (CLAIM_TO_MEASUREMENT_PENDING_P2 أعلاه) — لم يُمَسّ هنا، ومعه عيّنة
// cpu-c06-downgrade وحرّاسها.

const UNSTABLE_IDS = Object.freeze(['C-04', 'S-04', 'S-05', 'C-03']);
const CLAIM_TO_MEASUREMENT_PENDING_P2 = Object.freeze(['C-06', 'G-03', 'G-04', 'G-05']);
// S-04/S-05 مذكورة في نفس مجموعة "CLAIM → MEASUREMENT" وأيضاً UNSTABLE —
// المجموعتان لا تتعارضان (kind واحد + وسم unstable)، فتُدرَجان في القسم
// أدناه بمصدرين معاً.
const CLAIM_TO_SPEC = Object.freeze(['T-04', 'SEC-08', 'CM-11']);
// تعليمات المهمّة (خارج نصّ PLAN-01 الأصلي): B-08 لا يمكن أن ينجح على
// untrusted_app (A56/A93 — صفر نجاح من 30 عقدة) — يُعامَل كـSEC-08/T-04:
// لا يدخل حرفاً ولا عطباً على الباك اند. الحذف الفعلي من نكهة launch عمل
// تطبيق (خارج هذا المستودع).
// B-08 (دورات الشحن) معرّفاً منفرداً — القاعدة 24: قيمة يقوم عليها تمييز، فمصدرها هنا مرّة واحدة: القائمة أدناه تبنيها منه، وcategoryStates.js يُسقطه حين يُصنَّف صفر الدورات «غير مدعوم»
// (cycleCountClassification.js). لا نسخة ثانية من 'B-08' في كود الخادم. B-08 يقرأ القارئ نفسه الذي يقرؤه التذييل (BatteryCycleCount، عقد التطبيق §٧-ز) — فتصنيفه تصنيف التذييل.
const CYCLE_COUNT_TEST_ID = 'B-08';
const EXTRA_TO_SPEC_NO_SOURCE_IN_APP = Object.freeze([CYCLE_COUNT_TEST_ID]);

// معرّفات not_tested تُقرأ PERMISSION_DENIED باسم إذن أندرويد (نصّ P1.2:
// "CM-* not_tested وL-02/L-03 not_tested وN-04 not_tested → PERMISSION_DENIED
// باسم الإذن"). أسماء الأذونات هنا معرفة منصّة أندرويد العامة، لا حقلاً في
// هذا المستودع: CAMERA لكاميرا، ACCESS_FINE_LOCATION للموقع (يطابق حرفياً
// notes="إذن الموقع مرفوض" في L-02/L-03 بالفخّ الذهبي). READ_PHONE_STATE
// لـN-04 (نوع الشبكة) **أقلّ ثقة** — لا "notes" في الفخّ يؤكّدها؛ أفضل
// معرفة عامة متاحة، مذكورة بارزاً في تقرير المهمّة.
const PERMISSION_DENIED_PREFIXES = Object.freeze([
  {test: (id) => /^CM-/.test(id) && id !== 'CM-11', permission: 'android.permission.CAMERA'},
  {test: (id) => id === 'L-02' || id === 'L-03', permission: 'android.permission.ACCESS_FINE_LOCATION'},
  {test: (id) => id === 'N-04', permission: 'android.permission.READ_PHONE_STATE'},
]);

function permissionForNotTested(testId) {
  for (const rule of PERMISSION_DENIED_PREFIXES) {
    if (rule.test(testId)) return rule.permission;
  }
  return null;
}

function kindOf(testId) {
  if (BATTERY_LAYER_IDS.includes(testId)) return KIND.MEASUREMENT;
  if (CLAIM_TO_SPEC.includes(testId)) return KIND.SPEC;
  if (EXTRA_TO_SPEC_NO_SOURCE_IN_APP.includes(testId)) return KIND.SPEC;
  if (UNSTABLE_IDS.includes(testId)) return KIND.MEASUREMENT;
  if (CLAIM_TO_MEASUREMENT_PENDING_P2.includes(testId)) return KIND.MEASUREMENT;
  return KIND.STATE; // الافتراض العريض — انظر تعليق أعلى الملف
}

function isUnstable(testId) {
  return UNSTABLE_IDS.includes(testId);
}

function isHealthBearing(testId) {
  // SPEC لا يدخل حرفاً ولا عطباً (P1.2)؛ UNSTABLE كذلك (تعديل 2026-09-20:
  // "لا يُنتج DEGRADED ولا يدخل الأرضية الإلزامية للأعطال" — ومثله في
  // findings.js: entersGrade:false, entersFault:false).
  if (kindOf(testId) === KIND.SPEC) return false;
  if (isUnstable(testId)) return false;
  // «الإعدادات لا تُنزل الحرف» (أمر 2026-09-27 +03، البند ١) — ثلاث مجموعات
  // أعلاه، كل واحدة بسببها المكتوب. kind يبقى STATE (لا تغيير)، وoutcome
  // يبقى الحالة الحقيقية — الاستبعاد من الحرف/العطب فقط.
  if (USER_SETTING_IDS.includes(testId)) return false;
  if (USER_CONTENT_OR_RUNTIME_IDS.includes(testId)) return false;
  if (THERMAL_UNCALIBRATED_IDS.includes(testId)) return false;
  // المجموعة ٤ — «عتبة غير معايَرة» (أمر مستخدم 2026-09-30 +03) — راجع
  // تعليق UNCALIBRATED_THRESHOLD_IDS أعلاه للتعليل الكامل.
  if (UNCALIBRATED_THRESHOLD_IDS.includes(testId)) return false;
  return true;
}

// ─── toTestResult — القواعد الثابتة (P1.2 حرفياً) ──────────────────────
//
// @param {Object} entry عنصر functionalResults أو manualResults كما وصل
//   {testId, categoryName, status, rawValue, rawValueUnit, notes, ...}
// @param {Object} dev سياق الجهاز (deviceModelBaseline hooks — اختياري)
// @param {Object} findings (اختياري) — غير مُستهلَك في P1.2/P1.3 (ذلك P1.4)؛
//   يُمرَّر للتوقيع مطابقةً لنص P1.2 "toTestResult(status, testId, dev, findings)"
// @param {Object} opts {isManual: bool}
// @return {Object} TestResult
function toTestResult(entry, dev, findings, opts) {
  const o = opts || {};
  const isManual = !!o.isManual;
  const testId = entry && entry.testId;
  const status = String((entry && entry.status) || '').toLowerCase();
  const kind = kindOf(testId);
  const unstable = isUnstable(testId);
  const healthBearing = isHealthBearing(testId);

  const base = {
    testId,
    kind,
    unstable,
    healthBearing,
    entersGrade: healthBearing,
    entersFault: healthBearing,
    attested: isManual,
    evidence: (entry && (entry.rawValue ?? null)),
    evidenceUnit: (entry && entry.rawValueUnit) || null,
    confidence: isManual ? 'HALF_WEIGHT_ATTESTED' : 'AUTOMATIC',
  };

  // فحوص يدوية بلا startedAt/durationMs (كل fv ≤ 67) — تُقبل بوسم
  // «بشهادة الفنّي» وتدخل بنصف وزن (P1.2). لا يُنتج حرفاً وحدها — ذلك
  // يُقرَّر على مستوى الفئة (ATTESTED_ONLY) لا هنا على مستوى اختبار واحد.
  if (isManual) {
    const hasTiming = entry && typeof entry.startedAt !== 'undefined' &&
        typeof entry.durationMs !== 'undefined';
    // pass/fail/warning ← نتيجة (warning: قيمة ≤ fv68 — كان M-02 يرسلها من عتبة 80%؛ تبقى معروفة). unavailable ← HARDWARE_ABSENT (رأس الملفّ).
    // not_tested ← OPERATOR_SKIPPED. وكل ما سواها (الحالة الغائبة والنصّ غير المعروف) ← UNKNOWN_MANUAL_STATUS (ق١، رأس الملفّ):
    // لا قيمة افتراضية تسدّ الغياب (القاعدة 22). على الوظيفي يخرج ذلك HARNESS_ERROR أدناه.
    // الحالة تُقرأ نصّاً فقط: غير النصّ (مصفوفة بعنصر واحد مثلاً، تُحوَّل String إلى نصّ عنصرها) ليس حالة — غائبة.
    const manualStatus = (entry && typeof entry.status === 'string') ? status : '';
    const isResult = manualStatus === 'pass' || manualStatus === 'fail' || manualStatus === 'warning';
    let reason = null;
    if (!isResult) {
      reason = manualStatus === 'unavailable' ? NOT_MEASURED_REASON.HARDWARE_ABSENT :
        manualStatus === 'not_tested' ? NOT_MEASURED_REASON.OPERATOR_SKIPPED :
          NOT_MEASURED_REASON.UNKNOWN_MANUAL_STATUS;
    }
    return Object.assign(base, {
      outcome: isResult ? manualStatus.toUpperCase() : 'NOT_MEASURED',
      notMeasuredReason: reason,
      attestedLabel: hasTiming ? null : 'بشهادة الفنّي',
      timingPresent: !!hasTiming,
    });
  }

  // SPEC — لا يُقرأ شيئاً صحّياً (T-04/SEC-08/CM-11/B-08). يُعرض كما وصل
  // للعلم فقط، بلا دخول حرف أو عطب (healthBearing أعلاه يمنع ذلك في
  // categoryStates.js).
  if (kind === KIND.SPEC) {
    return Object.assign(base, {
      outcome: 'INFO_ONLY',
      notMeasuredReason: null,
    });
  }

  // T-04 warning → NOT_MEASURED/CAPABILITY_BLOCKED (G1 — لا مسار حرارة
  // حقيقياً على هذه الطُرُز؛ 0 zones ليس عطباً في الجهاز، بل غياب المسار).
  if (testId === 'T-04' && status === 'warning') {
    return Object.assign(base, {outcome: 'NOT_MEASURED', notMeasuredReason: 'CAPABILITY_BLOCKED'});
  }

  // ENVIRONMENT_EFFECT_IDS (N-10, N-05, ...) warning/fail →
  // NOT_MEASURED/ENVIRONMENT_UNSUITABLE (الرقم يُعرض معلومةً). راجع تعليق
  // تعريف القائمة أعلى الملفّ للسبب والمصدر لكل معرّف على حدة — سابقاً كانت
  // fail تمرّ STATE عادياً فتفرض D على فئتها (STATE_FAIL_FLOOR،
  // categoryStates.js) لأثر بيئي (مكان الفحص) قد يتكرّر في المحلّ نفسه.
  if (ENVIRONMENT_EFFECT_IDS.includes(testId) && (status === 'warning' || status === 'fail')) {
    return Object.assign(base, {
      outcome: 'NOT_MEASURED',
      notMeasuredReason: 'ENVIRONMENT_UNSUITABLE',
      displayValueDespiteNotMeasured: true,
    });
  }

  // CM-*/L-02/L-03/N-04 not_tested → PERMISSION_DENIED باسم الإذن.
  if (status === 'not_tested') {
    const permission = permissionForNotTested(testId);
    if (permission) {
      return Object.assign(base, {
        outcome: 'NOT_MEASURED',
        notMeasuredReason: 'PERMISSION_DENIED',
        permission,
      });
    }
    return Object.assign(base, {outcome: 'NOT_MEASURED', notMeasuredReason: 'NOT_TESTED'});
  }

  // unavailable → HARDWARE_ABSENT إن شهدت قاعدة الطراز، وإلا CAPABILITY_BLOCKED.
  // لا قاعدة طراز في هذا المستودع اليوم (modelBaselines فارغة، §٤-ج) —
  // فكل unavailable يُصنَّف CAPABILITY_BLOCKED حتى تُبنى القاعدة. **مذكور
  // بارزاً في تقرير المهمّة كافتراض، لا حقيقة مثبتة عن كل طراز.**
  if (status === 'unavailable') {
    const attests = !!(dev && typeof dev.attestsHardwareAbsent === 'function' &&
        dev.attestsHardwareAbsent(testId));
    return Object.assign(base, {
      outcome: 'NOT_MEASURED',
      notMeasuredReason: attests ? NOT_MEASURED_REASON.HARDWARE_ABSENT : 'CAPABILITY_BLOCKED',
    });
  }

  if (status === 'pass' || status === 'fail' || status === 'warning') {
    return Object.assign(base, {outcome: status.toUpperCase(), notMeasuredReason: null});
  }

  // حالة غير معروفة — لا نملأها نجاحاً (S§4.3 المُلغاة): HARNESS_ERROR.
  return Object.assign(base, {outcome: 'NOT_MEASURED', notMeasuredReason: 'HARNESS_ERROR'});
}

module.exports = {
  KIND,
  NOT_MEASURED_REASON,
  ENVIRONMENT_EFFECT_IDS,
  UNSTABLE_IDS,
  CLAIM_TO_MEASUREMENT_PENDING_P2,
  CLAIM_TO_SPEC,
  EXTRA_TO_SPEC_NO_SOURCE_IN_APP,
  CYCLE_COUNT_TEST_ID,
  BATTERY_LAYER_IDS,
  USER_SETTING_IDS,
  USER_CONTENT_OR_RUNTIME_IDS,
  THERMAL_UNCALIBRATED_IDS,
  UNCALIBRATED_THRESHOLD_IDS,
  BATTERY_STATE_TEST_IDS,
  APP_CONSTANT_NOT_READ_IDS,
  kindOf,
  isUnstable,
  isHealthBearing,
  permissionForNotTested,
  toTestResult,
};

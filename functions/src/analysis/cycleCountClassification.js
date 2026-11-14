'use strict';

// ===================================================================
// cycleCountClassification.js — صفر الدورات من EXTRA_CYCLE_COUNT ⟵ «غير مدعوم» (2026-10-13 +03)
// ===================================================================
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي: الملفّات في مساحة العمل لا في هذا المستودع):
//   «(2026-10-13) التطبيق يرسل القيمة الخامّة كما هي (القاعدة 20). والخادم يصنّف الصفر من extra_api34 «غير مدعوم»: لا يذهب B-08 إلى النموذج، ولا يُعرض،
//   ولا يدخل computeScanSignature رقماً، بل حالةً. مع اختبار.»
//   «(2026-10-13) صفر الدورات: الشرط كما كتبتَه (cycleCountState == "read" وcycleCountSource == "extra_api34" وcycleCount === 0 ⇐ unsupported:zero_from_extra_api34)
//   معتمد، باسمه، ولكل العلامات. وB-08 لا يذهب إلى النموذج، ولا يُعرض في التطبيق ولا الموقع ولا PDF (بالجرد الذي ذكرتَه)، وبصمة الجهاز تحفظ الحالة. وإصدار قواعد التقييم يتغيّر،
//   لا إصدار الحقول. والعقد يكتب: «غير موثَّق من Samsung، وإعدادات الـS21 لا تعرض الدورات، ومرجع AOSP يرسل 0 حين لا عدّاد»، بمصادر بحث 2026-10-11.»
//
// ─── الشرط بالضبط (ثلاثة معاً، ولكل العلامات — لا شرط على المصنّع ولا الطراز ولا إصدار أندرويد) ────────────────────────────────────────────────────
//   حالة الدورات `read`  +  مصدرها `extra_api34`  +  قيمتها `=== 0`   ⟵   CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34.
// الأسماء الثلاثة على السلك من fv68Names.BATTERY_HEALTH (cycleCountState وcycleCountSource وcycleCount) ويقرؤها fv68Reader.readBatteryHealth؛ وقيمها من المفردة المغلقة (STATE_KIND.READ
// وSTATE_KIND.EXTRA_API34) — لا نصّ حرفي منها هنا (القاعدة 24). وغياب أيّ من الثلاثة، أو نوع خاطئ، أو حالة غير معروفة ⟵ لا تصنيف (القاعدة 22: الغائب يبقى غائباً ولا يُقرأ «غير مدعوم»).
//
// ─── وكل ما سوى الشرط يبقى كما هو اليوم ───────────────────────────────────────────────────────────────────────────────────────────────────────────
//   الصفر من مصدر آخر (sysfs:<path>) · قيمة 1 فما فوق من extra_api34 · حالة غير `read` (not_read:<سبب>) · مصدر `unavailable` أو غير معروف · الحقول غائبة (ختم < 68): classifyCycleCount ⟵ null.
//
// ─── لماذا القرار هنا لا في fv68Reader ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// fv68Reader «يسلّم الخامّ مع حالته ليحكم من يحكم لاحقاً؛ لا يحكم هو» (رأس ذلك الملفّ). هذا حكم خادم على الخامّ، فمكانه خارجه، ويستهلك مخرَج القارئ نفسه (readFv68(...).batteryHealth.cycleCount
// أو readBatteryHealthOnly(...).cycleCount) — لا قراءة ثانية للحقول.
//
// ─── من يستهلك التصنيف (ثلاثة مواضع، لا غير) ─────────────────────────────────────────────────────────────────────────────────────────────────────
//   ١) runAnalysisInternal.js ⟵ computeCategoryStates({cycleCountClassification}) ⟵ يُسقط اختبار B-08 (testKinds.CYCLE_COUNT_TEST_ID) من categoryStates.testResults، فلا يصل حمولة النموذج
//      (قيمة ولا حالة ولا معرّف) ولا مرجع حارس الأرقام ولا مرجع الأدلّة. الخامّ يبقى كما شُحن في reportRaw.rawFingerprint.functionalResults وفي التذييل (القاعدة 20).
//   ٢) signatures/computeScanSignature.js ⟵ sig.battery.cycleCount = null وsig.battery.cycleCountClassification = الوسم (الحالة بدل الرقم).
//   ٣) سطر سجلّ واحد في runAnalysisInternal.js يقول إن التصنيف وقع.
//
// ─── مصدر البحث (منقول من تقرير الباحث 2026-10-11 كما ورد في أمر المنسّق؛ غير متحقَّق من المصادر عندي، ولا فُتحت) ────────────────────────────────────────────────
//   A1 https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android14-release/core/java/android/os/BatteryManager.java
//   A2 https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android14-release/services/core/java/com/android/server/BatteryService.java
//   A3 https://android.googlesource.com/platform/hardware/interfaces/+/refs/heads/android14-release/health/aidl/android/hardware/health/HealthInfo.aidl
//   A4 https://android.googlesource.com/platform/system/core/+/refs/heads/android14-release/healthd/BatteryMonitor.cpp
//   خلاصة الباحث بنصّها: «وشيفرة AOSP تضع الحقل في كل بثّ، ولا تعرّف له قيمة «غير معروف»، وتتركه صفراً حين لا يجد الـHAL عقدة `cycle_count` (وهذا غير متحقَّق على Samsung). فالصفر من الحقل وحده لا يُميَّز عن صفر حقيقي.»
//   و«لا تقول Samsung ولا Google في أيّ مصدر وجدته إن الصفر من `EXTRA_CYCLE_COUNT` على Samsung يعني «غير مدعوم».»
//   فالتصنيف **قرار خادم مُعلَن**، لا حقيقة مثبتة عن المصنِّع. والقيد المعروف الذي يحمله: جهاز يحمل بطارية بصفر دورات حقيقي (جديدة) يُصنَّف «غير مدعوم» أيضاً — فلا يصل النموذج صفره.
// ===================================================================

const N = require('./fv68Names');

const K = N.STATE_KIND;

/**
 * يصنّف كتلة الدورات كما يُخرجها fv68Reader (batteryHealth.cycleCount): `{value, valueStatus, state, stateStatus, source, sourceStatus}`.
 * دالّة خالصة لا ترمي. أيّ مُدخل ليس كتلة (null/undefined/غير كائن: التذييل بلا batteryHealth، أو readFv68 أعادت readerError) ⟵ null، أي «لا تصنيف».
 * @param {?Object} block
 * @return {?string} CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34 أو null
 */
function classifyCycleCount(block) {
  if (block === null || typeof block !== 'object') return null;
  const stateIsRead = block.state !== null && typeof block.state === 'object' && block.state.kind === K.READ;
  const sourceIsExtraApi34 = block.source !== null && typeof block.source === 'object' && block.source.kind === K.EXTRA_API34;
  const valueIsZero = block.valueStatus === N.KEY_STATUS.PRESENT && block.value === 0;
  return stateIsRead && sourceIsExtraApi34 && valueIsZero ? N.CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34 : null;
}

module.exports = {classifyCycleCount};

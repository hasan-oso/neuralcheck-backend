#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix
// — يبني نسخة مُشتقّة من الردّ الحقيقي المجمَّد
// frozen-real-model-output-b45c8cf6-adjustments-2026-09-23.json، بعد أن
// صار ذلك الردّ نفسه مرفوضاً من الحارس (guardFinal.ok=false) على
// categoryStates الجديدة — أمر مستخدم 2026-09-27 +03 «الإعدادات لا تُنزل
// الحرف» (testKinds.js: SEC-01/05/06/07، CM-08، T-01/T-02 صارت
// healthBearing=false)، ثم أمر مستخدم 2026-09-30 +03 «الردّ الحقيقي
// المسجَّل لا يُعدَّل»: الردّ الحقيقي نفسه يعود إلى أصله بلا مساس، وأي
// اختبار يحتاج ردّاً *يقبله* الحارس يستعمل ملفّاً مشتقّاً منفصلاً — هذا
// الملفّ.
// ===================================================================
//
// ─── لماذا الردّ الأصلي صار مرفوضاً (مُتحقَّق بالكود، لا نقلاً) ──────────
// guardV7Response(parsedContent, {findings, categoryStates}) على الردّ
// الأصلي غير المعدَّل، مقابل categoryStates المبنيّة بـtestKinds.js
// الحالي، تُعطي:
//   issueKeys.ok=false، inventedIds=[DISC-T-01, DISC-T-02, DISC-CM-08,
//     ISS-SEC-05, ISS-SEC-06, DISC-SEC-07] — ستّ فئات صارت
//     healthBearing=false فلم تعد تُنتج عناصر issues[] (categoryStates.js:653
//     `if (!r.healthBearing) continue`)، فمفاتيح narrative.issueDescriptions
//     المقابلة لها صارت "مُخترَعة" (validateIssueDescriptionKeys،
//     reportShapeV7.js:176-184).
//   numbers.ok=false، unmatchedFields=[{field:"narrative.details",
//     numbers:[10]}] — جملة إحصاء الأمان "من 10 اختبارات معلنة نُفِّذ 9"
//     تصف declaredCount/executedCount القديمين (10/9، قبل استبعاد
//     SEC-01/05/06/07)؛ الرقم الجديد الحقيقي 6/6 (categoryStates.categories.
//     security.declaredCount/executedCount) — "10" لم يعد له مصدر حقيقي في
//     findings/categoryStates فيُرفَض (validateNumberGrounding،
//     reportShapeV7.js:733-779).
// (⚠️ ملاحظة تصحيح: تقرير المدير نقل أن السبب الثاني "45% خارج السماح
// النسبي 1% من 45.9%" — هذا **غير صحيح بقياس مباشر**: الرقم "45" الوارد
// في كل الحقول (summary/details/verdict/buyerAdvice/crossChecks) يطابق
// رقماً حقيقياً آخر تماماً بالصدفة (findings.channels.battery_level_pct.
// {GPU_SUSTAINED,COMBINED}.{median,min,p10,max,p90}=45 — قناة بطارية غير
// متعلقة بالتغطية إطلاقاً)، فلا يُرفَض. السبب الرقمي الحقيقي الوحيد هو
// "10" في narrative.details كما تحقَّق أعلاه. راجع تقرير هذه المهمّة.)
//
// ─── التعديلان بالضبط (لا تعديل آخر في أي حقل) ──────────────────────────
// (مُتحقَّقان ببرمجة: مقارنة JSON.stringify لكل حقل بين الأصل والمُشتقّ —
// crossChecks/adjustments/modelObservations/summary/verdict/buyerAdvice
// كلّها متطابقة حرفياً؛ الاختلاف الوحيد في narrative.details ونقص ستّة
// مفاتيح من narrative.issueDescriptions.)
//   ١. narrative.issueDescriptions: حذف المفاتيح الستّة المخترَعة أعلاه
//      (DISC-T-01, DISC-T-02, DISC-CM-08, ISS-SEC-05, ISS-SEC-06,
//      DISC-SEC-07) — 25 مفتاحاً يبقى من 31.
//   ٢. narrative.details: ثلاثة استبدالات نصّية داخل الفقرة نفسها (لا حقل
//      آخر يمسّ 45/10 — الفحص المباشر يمرّ):
//      أ) "والتغطية العامة 45%" ⇐ "والتغطية العامة 46%" — تدوير الرقم
//         الحقيقي overall.partialAssessmentTag.coveragePct=45.9 (categoryStates.js
//         :787) بدل 45 القديم (لم يكن هذا التبديل ضرورياً لعبور الحارس
//         رقمياً — 45 يمرّ بالفعل بالمصادفة أعلاه — لكنه إصلاح دلالي صحيح:
//         45.9 يُقرَّب فعلياً إلى 46 لا 45).
//      ب) "من 10 اختبارات معلنة نُفِّذ 9، فيها 6 نجاحات وفشل واحد وتنبيهان:
//         SEC-04 كشف صلاحيات الروت (فشل)، SEC-05 وضع المطوّر مفعّل
//         (تنبيه)، SEC-06 التصحيح عبر الكابل مفعّل (تنبيه)، ورقعة..."
//         ⇐ "من 6 اختبارات معلنة نُفِّذ 6، فيها 5 نجاحات وفشل واحد:
//         SEC-04 كشف صلاحيات الروت (فشل)، ورقعة..." — الأرقام الحقيقية
//         الجديدة (categoryStates.categories.security: declaredCount=6،
//         executedCount=6، passCount=5، failCount=1، warningCount=0)، وحذف
//         ذكر SEC-05/SEC-06 كتنبيهين بما أنهما لم يعودا يدخلان الحرف ولا
//         التغطية.
//      ج) "نظام تحديد المواقع B بتغطية 33.3%،" ⇐ "نظام تحديد المواقع بلا
//         حرف لأن الاختبار الوحيد المنفَّذ (L-01) لم يعد يدخل الحرف،" —
//         L-01 كانت اختبار gps الوحيد، استبعادها من healthBearing يُفرغ
//         executed تماماً (categoryStates.gps.state=UNMEASURED،
//         deterministicLetter=null)، فحرف B القديم لم يعد صحيحاً.
//
// ─── التحقّق ─────────────────────────────────────────────────────────
// يرمي إن لم يطابق sourceBlob المُتوقَّع (الأصل لم يتغيّر)، أو إن لم يمرّ
// الناتج المُشتقّ بـguardV7Response الحقيقي (guard.ok===true) — لا يُكتب
// ملفّ من محتوى كان سيُرفَض في الإنتاج.
//
// Run: node functions/scripts/generate-derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix.js
// ===================================================================

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {guardV7Response} = require('../src/analysis/reportShapeV7');
// تحديث 2026-10-01 +03 — الحارس الحقيقي في المسار الفعلي (callAI.js) يقارن
// الآن بـbody.findings/body.categoryStates (المُنقَّيين، بعد buildV7Payload)
// لا categoryStates/findings الخام — نفس المصدر هنا (القاعدة 24)، كي يتحقّق
// هذا السكربت من نفس ما يتحقّق منه المسار الحقيقي بالضبط.
const {buildV7Payload} = require('../src/analysis/buildV7Payload');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');
const SOURCE_REL_PATH = 'functions/test/fixtures/frozen-real-model-output-b45c8cf6-adjustments-2026-09-23.json';
const SOURCE_FILE = path.join(FIXTURES_DIR, 'frozen-real-model-output-b45c8cf6-adjustments-2026-09-23.json');
// أمر مستخدم 2026-10-06 (D6): «المشتقّة تُكتب نسخة جديدة موسومة» — لا تُعدَّل النسخة السابقة
// derived-…-adjustments-usersettings-fix.json في مكانها (قرّاؤها حُوِّلوا إلى هذا الملفّ).
const DEST_FILE = path.join(FIXTURES_DIR, 'derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix-v3-2026-10-07.json');
const SCAN_ID = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
// آخر بصمة معروفة لهذا الملفّ عند HEAD (2717920) — مُتحقَّقة يدوياً
// بـ`git hash-object` قبل كتابة هذا السكربت. إن اختلفت: الأصل تغيّر منذ
// ذلك الحين، والسكربت يتوقّف بدل الاشتقاق من نسخة غير متوقَّعة.
const EXPECTED_SOURCE_BLOB = '5d9b19157ae0511361c329a3fd1c3de9a263ae13';

const REMOVED_ISSUE_DESCRIPTION_KEYS = Object.freeze([
  'DISC-T-01', 'DISC-T-02', 'DISC-CM-08', 'ISS-SEC-05', 'ISS-SEC-06', 'DISC-SEC-07',
]);

const DETAILS_REPLACEMENTS = Object.freeze([
  {
    from: 'والتغطية العامة 45%',
    to: 'والتغطية العامة 46%',
  },
  {
    from: 'من 10 اختبارات معلنة نُفِّذ 9، فيها 6 نجاحات وفشل واحد وتنبيهان: ' +
        'SEC-04 كشف صلاحيات الروت (فشل)، SEC-05 وضع المطوّر مفعّل (تنبيه)، ' +
        'SEC-06 التصحيح عبر الكابل مفعّل (تنبيه)، ورقعة',
    to: 'من 6 اختبارات معلنة نُفِّذ 6، فيها 5 نجاحات وفشل واحد: ' +
        'SEC-04 كشف صلاحيات الروت (فشل)، ورقعة',
  },
  {
    from: 'نظام تحديد المواقع B بتغطية 33.3%،',
    to: 'نظام تحديد المواقع بلا حرف لأن الاختبار الوحيد المنفَّذ (L-01) لم يعد يدخل الحرف،',
  },
]);

// ─── تحديث 2026-10-01 +03 (أمر مستخدم "لا قيم لما ليس معايَراً في الحمولة") ─
// ثلاثة أرقام في هذه العيّنة مصدرها مسارات صارت الآن تصل النموذج بحالتها
// وحدها لا بقيمتها (findings.sustainedCeiling/graphics/battery، وbattery
// Indicators.BAT-FCC.value/.designCapacityMah) — guardV7Response الحقيقي
// يرفضها الآن فعلياً (مُتحقَّق: 68986→رفض قبل هذا التصحيح، راجع تقرير
// المهمّة). الاستبدالات الثلاثة أدناه تُزيل الرقم المحدَّد وحده من كل جملة
// — لا إعادة صياغة الجملة كاملة، ولا مساس بـadjustments[] (خارج نطاق هذا
// التصحيح — راجع تقرير المهمّة لمناقشة أثر هذا الالتزام على evidenceRefs
// التي تستشهد بنفس المسارات المحجوبة الآن).
const POST_REDACTION_REPLACEMENTS_2026_10_01 = Object.freeze([
  {
    path: 'narrative.buyerAdvice.gamer',
    from: 'كبح حراري 9.1%',
    to: 'كبح حراري ملحوظ',
  },
  {
    path: 'narrative.buyerAdvice.photographer',
    from: 'سرعة الكتابة المقيسة 188 MB/s',
    to: 'سرعة الكتابة المقيسة متوسطة',
  },
  {
    path: 'crossChecks[3].description',
    from: 'مقابل سعة تصميمية 4400 وبنسبة إلى التصميم 0.8587، وكمية شحن مقيسة 143.84 ملي أمبير-ساعة',
    to: 'مقابل سعة التصميم المعلَنة — وهو ما لا يحمل حكماً بلا عتبة معايَرة',
  },
]);

const {
  applyTextEdits, B45_FAMILY_COMMON, B45_FAMILY_TREE_2026_10_06, B45_FAMILY_TREE_2026_10_07, B45_ADJ_CPU_SUSTAINED, B45_ADJ_GPU_SUSTAINED,
} = require('./lib/fixtureTextEdits');

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function applyEdits(parsedContent) {
  const out = JSON.parse(JSON.stringify(parsedContent)); // نسخة عميقة — لا مساس بالمصدر

  // ١ — حذف المفاتيح الستّة المخترَعة
  for (const key of REMOVED_ISSUE_DESCRIPTION_KEYS) {
    if (!(key in out.narrative.issueDescriptions)) {
      throw new Error(`generate-derived: توقّف — المفتاح المتوقَّع حذفه "${key}" غير موجود أصلاً في issueDescriptions`);
    }
    delete out.narrative.issueDescriptions[key];
  }

  // ٢ — استبدالات narrative.details النصّية الثلاثة (كل استبدال يرمي إن
  // لم يجد النصّ المتوقَّع بالضبط — لا استبدال صامت لنصّ غير متوقَّع)
  let details = out.narrative.details;
  for (const {from, to} of DETAILS_REPLACEMENTS) {
    if (!details.includes(from)) {
      throw new Error(`generate-derived: توقّف — النصّ المتوقَّع غير موجود في narrative.details: ${JSON.stringify(from)}`);
    }
    if (details.split(from).length - 1 !== 1) {
      throw new Error(`generate-derived: توقّف — النصّ "${from}" يتكرّر أكثر من مرّة واحدة، الاستبدال غير آمن`);
    }
    details = details.split(from).join(to);
  }
  out.narrative.details = details;

  // ٣ — تحديث 2026-10-01 +03 — ثلاثة استبدالات نصّية بعد المسار المُحدَّد
  // (path على شكل 'a.b' أو 'crossChecks[i].description') — نفس انضباط
  // التحقّق أعلاه: يتوقّف إن لم يجد النصّ بالضبط مرّة واحدة.
  function getByPath(obj, p) {
    const m = p.match(/^crossChecks\[(\d+)\]\.description$/);
    if (m) return {get: () => obj.crossChecks[Number(m[1])].description, set: (v) => { obj.crossChecks[Number(m[1])].description = v; }};
    const parts = p.split('.');
    let ref = obj;
    for (let i = 0; i < parts.length - 1; i++) ref = ref[parts[i]];
    const last = parts[parts.length - 1];
    return {get: () => ref[last], set: (v) => { ref[last] = v; }};
  }
  for (const {path: fieldPath, from, to} of POST_REDACTION_REPLACEMENTS_2026_10_01) {
    const accessor = getByPath(out, fieldPath);
    const text = accessor.get();
    if (typeof text !== 'string' || !text.includes(from)) {
      throw new Error(`generate-derived: توقّف — النصّ المتوقَّع غير موجود في ${fieldPath}: ${JSON.stringify(from)}`);
    }
    if (text.split(from).length - 1 !== 1) {
      throw new Error(`generate-derived: توقّف — النصّ "${from}" يتكرّر أكثر من مرّة واحدة في ${fieldPath}، الاستبدال غير آمن`);
    }
    accessor.set(text.split(from).join(to));
  }

  // ٤ — أمر 2026-10-06 (D6): لا استشهاد برقم محجوب — راجع scripts/lib/fixtureTextEdits.js
  // لمصدر كل رقم، والتحقّق بـaudit-fixtures-hidden-number-citations.js.
  applyTextEdits(out, [...B45_FAMILY_COMMON, ...B45_FAMILY_TREE_2026_10_06, ...B45_ADJ_CPU_SUSTAINED, ...B45_ADJ_GPU_SUSTAINED, ...B45_FAMILY_TREE_2026_10_07], 'generate-derived');

  return out;
}

(function main() {
  // ─── تحقّق أن الأصل لم يتغيّر منذ آخر قياس ─────────────────────────
  let actualSourceBlob;
  try {
    actualSourceBlob = execFileSync('git', ['hash-object', SOURCE_REL_PATH], {cwd: REPO_ROOT, encoding: 'utf8'}).trim();
  } catch (e) {
    throw new Error(`generate-derived: توقّف — تعذّر قراءة بصمة git للأصل: ${e.message}`);
  }
  if (actualSourceBlob !== EXPECTED_SOURCE_BLOB) {
    throw new Error(`generate-derived: توقّف — بصمة الأصل تغيّرت (متوقَّع ${EXPECTED_SOURCE_BLOB}، والفعلي ${actualSourceBlob}). ` +
        `الأصل قد يكون عُدِّل أو أُعيد إلى حالة مختلفة — راجع قبل تحديث EXPECTED_SOURCE_BLOB هنا.`);
  }

  const sourceFixture = loadJson(SOURCE_FILE);
  const originalContent = JSON.parse(sourceFixture.rawEnvelope.choices[0].message.content);
  const derivedContent = applyEdits(originalContent);

  // ─── بناء categoryStates/findings الحقيقيَّين (نفس فِخّ b45c8cf6) ──────
  const raw = loadJson(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'));
  const frMap = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId;
  const functional = frMap[SCAN_ID];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });

  // ─── الحارس الحقيقي — يرمي إن لم ينجح ──────────────────────────────
  const {body} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: SCAN_ID, isFreeTrial: false, previousScan: null});
  const categoryStatesForGuard = Object.assign({}, body.categoryStates, {testResults: body.testResults});
  const guard = guardV7Response(derivedContent, {findings: body.findings, categoryStates: categoryStatesForGuard});
  if (!guard.ok) {
    throw new Error(`generate-derived: توقّف — الناتج المُشتقّ مرفوض من الحارس الحقيقي: ${JSON.stringify(guard)}`);
  }

  const derivedEnvelope = Object.assign({}, sourceFixture.rawEnvelope, {
    choices: [Object.assign({}, sourceFixture.rawEnvelope.choices[0], {
      message: Object.assign({}, sourceFixture.rawEnvelope.choices[0].message, {
        content: JSON.stringify(derivedContent),
      }),
    })],
  });

  const output = {
    _provenance: sourceFixture._provenance,
    _derived: {
      label: 'مشتقّ، ليس ردّاً حقيقياً',
      source: SOURCE_REL_PATH,
      sourceBlob: EXPECTED_SOURCE_BLOB,
      reason: 'الردّ الحقيقي الأصلي صار مرفوضاً من الحارس (guardFinal.ok=false) على categoryStates ' +
          'بعد أمر «الإعدادات لا تُنزل الحرف» (2026-09-27 +03) — راجع رأس هذا السكربت للتفاصيل الكاملة ' +
          'والقياس المباشر لكل سبب.',
      generatedBy: 'functions/scripts/generate-derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix.js',
      generatedAt: '2026-10-07T00:00:00.000Z',
      supersedes: 'derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix-v2-2026-10-06.json — النسخة السابقة (مُلتزَمة بـ01d8ba8، لم تُمَسّ في أمر 2026-10-07): تبقى في المستودع بلا قارئ بعد تحويل قرّائها (D6، القاعدة 34)؛ وهي نفسها حلّت محلّ derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix.json',
      edits: [
        {
          path: 'narrative.issueDescriptions',
          change: 'DELETE_KEYS',
          keys: REMOVED_ISSUE_DESCRIPTION_KEYS,
          reason: 'صارت هذه المعرّفات "مخترَعة" — categoryStates.issues لم يعد يُنتج عناصر لها بعد ' +
              'استبعاد SEC-05/SEC-06/CM-08/T-01/T-02 من healthBearing (validateIssueDescriptionKeys).',
        },
        {
          path: 'narrative.details',
          change: 'TEXT_REPLACE',
          replacements: DETAILS_REPLACEMENTS,
          reason: 'ثلاث جمل تصف أرقام/حروف قديمة (10/9 اختبارات أمان، تنبيها SEC-05/SEC-06، gps=B بتغطية ' +
              '33.3%) لم تعد صحيحة على categoryStates الجديدة — الرقم "10" تحديداً كان يفشل ' +
              'validateNumberGrounding فعلياً (مُتحقَّق: لا مصدر حقيقي له بعد التعديل).',
        },
        {
          path: 'narrative.buyerAdvice.gamer / narrative.buyerAdvice.photographer / crossChecks[3].description',
          change: 'TEXT_REPLACE',
          replacements: POST_REDACTION_REPLACEMENTS_2026_10_01,
          reason: 'تحديث 2026-10-01 +03 (أمر مستخدم "لا قيم لما ليس معايَراً في الحمولة") — ثلاثة أرقام ' +
              'مصدرها الآن مسارات تصل النموذج بحالتها وحدها (findings.sustainedCeiling/graphics، ' +
              'وcategoryStates.categories.battery.batteryIndicators.BAT-FCC.value/.designCapacityMah) — ' +
              'guardV7Response الحقيقي (بعد تمرير body.findings/body.categoryStates المُنقَّيين، لا الخام) ' +
              'يرفضها الآن فعلياً. لم تُمَسّ adjustments[] (cpu/gpu DOWN) ولا evidenceRefs فيها — خارج نطاق ' +
              'هذا التصحيح، راجع تقرير المهمّة لمناقشة الأثر الأعمق لاحتمال استشهاد evidenceRefs بمسارات ' +
              'صارت محجوبة عن النموذج فعلياً.',
        },
        {
          path: 'narrative.details / narrative.buyerAdvice.gamer / crossChecks[3].description / adjustments[0].reason / adjustments[1].reason',
          change: 'TEXT_REPLACE',
          replacements: [...B45_FAMILY_COMMON, ...B45_FAMILY_TREE_2026_10_06, ...B45_ADJ_CPU_SUSTAINED, ...B45_ADJ_GPU_SUSTAINED],
          reason: 'أمر مستخدم 2026-10-06 (D6) — لا استشهاد برقم صار محجوباً عن حمولة النموذج (0.69/0.85/0.714 من findings.sustainedCeiling، ' +
              '0.575 من findings.graphics، 3778.29/0.8587 من BAT-FCC). 4400 يبقى (B-02 في testResults).',
        },
        {
          path: 'narrative.details / narrative.buyerAdvice.photographer',
          change: 'TEXT_REPLACE',
          replacements: B45_FAMILY_TREE_2026_10_07,
          reason: "أمر مستخدم 2026-10-07 (قرار القوائم) — لا استشهاد برقم محجوب عن حمولة النموذج: 31.3% و71.5 GB (S-02)، 2.7/2.6 GB (R-02)، 4400 mAh (B-02)، 32.4/32.8 °C (B-03)؛ وإزالة «7.4 °C» (ارتفاع حرارة البطارية، findings.thermal) و«43%» (مستوى الشحن، findings.channels) حيث يصادف رقمهما قيمةً حاضرة فلا يكشفهما التدقيق الرقمي وحده. نسخة جديدة موسومة (D6): v2 تبقى في المستودع بلا قارئ بعد تحويل قرّائها (القاعدة 34).",
        },
      ],
      guardVerifiedAtGenerationTime: true,
      guardResultAtGenerationTime: guard,
    },
    rawEnvelope: derivedEnvelope,
  };

  fs.writeFileSync(DEST_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`generate-derived: كُتب ${DEST_FILE}`);
  console.log(`guard.ok=${guard.ok} (issueKeys.ok=${guard.issueKeys.ok}, numbers.ok=${guard.numbers.ok}, shape.ok=${guard.shape.ok}, languageLeaks=${guard.languageLeaks.length})`);
})();

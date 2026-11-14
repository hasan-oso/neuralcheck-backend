#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted
// — نسخة مُشتقّة من frozen-real-envelope-34dff2b8-accepted-2026-09-23.json
// (يستهلكه test/resolveV7ReportSimulateScenarios.test.js، سيناريو ١
// "نجاح من المحاولة الأولى" وسيناريو ٦ "دورات متعدّدة"). أمر مستخدم
// 2026-09-30 +03 «الردّ الحقيقي المسجَّل لا يُعدَّل»: الأصل بلا مساس
// (tracked، نظيف) — هذا ملفّ منفصل، موسوم صراحة أنه ليس ردّاً حقيقياً.
// ===================================================================
//
// لماذا صار الأصل مرفوضاً (مُتحقَّق بتشغيل مباشر لا نقلاً): بعد أمر
// «الإعدادات لا تُنزل الحرف» (2026-09-27 +03، testKinds.js):
//   issueKeys.ok=false — نفس الستّة المفاتيح المخترَعة (DISC-T-01/T-02/
//     CM-08، ISS-SEC-05/06، DISC-SEC-07) — نفس آلية b45c8cf6، جهاز مختلف.
//   numbers.ok=false — "45" غير مطابق في أربعة حقول (narrative.summary/
//     details/verdict، crossChecks[1].description) — التغطية الحقيقية
//     الجديدة على 34dff2b8 هي أيضاً 45.9% (نفس رقم b45c8cf6 بالصدفة —
//     نفس بنية اختبارات مُعلَنة)، فـ"45" لم يعد يطابق أي مرجع (خلافاً
//     لـb45c8cf6 حيث طابقت 45 رقماً آخر غير متعلّق بالمصادفة).
//
// ⚠️ **تحديث لاحق (2026-10-01 +03، أمر «C-07 وS-06» البند ١)** — testKinds.js:
// S-06 صارت healthBearing=false أيضاً (المجموعة الرابعة «عتبة غير معايَرة»).
// S-06=warning على 34dff2b8 كانت تُنتج ISS-S-06 حتمياً من قبل — لم تعد
// كذلك، فصار مفتاح `narrative.issueDescriptions.ISS-S-06` (موجود في الأصل
// المجمَّد) "مخترَعاً" هو أيضاً — أُضيف إلى REMOVED_ISSUE_DESCRIPTION_KEYS
// أدناه (سبعة الآن لا ستّة). **لا تعديل رقمي إضافي لزم** (التغطية 45.9%
// نفسها لم تتغيّر بإقصاء S-06 وحدها عن قدر يُغيّر التقريب إلى 46).
//
// ─── التعديلات بالضبط (لا تعديل آخر — مُتحقَّق ببرمجة، راجع تحقّق أدناه) ──
//   ١. narrative.issueDescriptions: حذف المفاتيح السبعة أعلاه (كانت ستّة).
//   ٢. أربعة استبدالات نصّية حرفية "45%" ⇐ "46%" (تدوير 45.9 الحقيقي)،
//      كل واحد في حقل مختلف: narrative.summary، narrative.details،
//      narrative.verdict، crossChecks[1].description. لا رقم آخر يُمسّ —
//      كل الأرقام الأخرى في هذه الحقول (71.4%، 75%، 33.3%، 93.75%، إلخ)
//      تجتاز الحارس فعلاً كما هي (مُتحقَّق: لم تظهر في unmatchedFields).
//   ٣. تعديل وصفي إضافي (لا يُغيّر أي رقم مُتحقَّق بالحارس، تصحيح دلالي
//      بحت): جملة "الخليوي والمستشعرات وتحديد المواقع: حروف B بقيد
//      التغطية (71.4% و75% و33.3%)" ⇐ "الخليوي والمستشعرات: حرفا B بقيد
//      التغطية (71.4% و75%)، وتحديد المواقع بلا حرف لأن الاختبار الوحيد
//      المنفَّذ (L-01) لم يعد يدخل الحرف" — gps.state=UNMEASURED فعلياً
//      الآن (نفس تفصيل b45c8cf6). "33.3" كان يجتاز الحارس بالمصادفة، لكن
//      إبقاء الجملة بصيغتها القديمة كان سيصف حرفاً لم يعد موجوداً — نفس
//      معيار الدقّة المُطبَّق على b45c8cf6 (generate-derived-from-frozen-
//      real-2026-09-23-adjustments-usersettings-fix.js).
//
// Run: node functions/scripts/generate-derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted.js
// ===================================================================

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {guardV7Response} = require('../src/analysis/reportShapeV7');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {applyTextEdits, D34_ACCEPTED_EDITS, D34_ACCEPTED_TREE_2026_10_07} = require('./lib/fixtureTextEdits');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');
const SOURCE_REL_PATH = 'functions/test/fixtures/frozen-real-envelope-34dff2b8-accepted-2026-09-23.json';
const SOURCE_FILE = path.join(FIXTURES_DIR, 'frozen-real-envelope-34dff2b8-accepted-2026-09-23.json');
// أمر مستخدم 2026-10-06 (D6): نسخة جديدة موسومة لا تعديل في مكان النسخة السابقة.
const DEST_FILE = path.join(FIXTURES_DIR, 'derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted-v3-2026-10-07.json');
const SCAN_ID = '34dff2b8-ce9e-4b40-86a9-1976c878e195';
const EXPECTED_SOURCE_BLOB = '5f8451a747aa133712752ccc8ddf3d0db3274324';

const REMOVED_ISSUE_DESCRIPTION_KEYS = Object.freeze([
  'DISC-T-01', 'DISC-T-02', 'DISC-CM-08', 'ISS-SEC-05', 'ISS-SEC-06', 'DISC-SEC-07',
  // أمر مستخدم 2026-10-01 +03 («C-07 وS-06» البند ١) — S-06 صارت
  // healthBearing=false، فمفتاحها هنا صار مخترَعاً هو أيضاً.
  'ISS-S-06',
]);

const TEXT_REPLACEMENTS = Object.freeze([
  {path: 'narrative.summary', from: 'الفحص جزئي (تغطية 45%)', to: 'الفحص جزئي (تغطية 46%)'},
  {path: 'narrative.verdict', from: 'تقييم جزئي بتغطية 45%', to: 'تقييم جزئي بتغطية 46%'},
  {path: 'crossChecks[1].description', from: 'تغطية عامة 45% مقابل متوسط فئات مقيسة', to: 'تغطية عامة 46% مقابل متوسط فئات مقيسة'},
  {
    path: 'narrative.details',
    from: 'لأن التغطية 45% مقابل متوسط فئات مقيسة 93.75%',
    to: 'لأن التغطية 46% مقابل متوسط فئات مقيسة 93.75%',
  },
  {
    path: 'narrative.details',
    from: 'الخليوي والمستشعرات وتحديد المواقع: حروف B بقيد التغطية (71.4% و75% و33.3%)،',
    to: 'الخليوي والمستشعرات: حرفا B بقيد التغطية (71.4% و75%)، وتحديد المواقع بلا حرف لأن الاختبار الوحيد المنفَّذ (L-01) لم يعد يدخل الحرف،',
  },
]);

// ─── تعديلات ثانية — أضيفت 2026-10-01 +03 (S5، أمر مستخدم "لا رقم
// اختبار... في أي نثر بشري تكتبه" — إعادة كتابة systemPromptV7.js) ────────
// نفس سبب/آلية التعديل المُقابل في generate-derived-from-frozen-real-
// 2026-09-23-envelope-b45c8cf6-accepted.js (راجع تعليق ذلك الملفّ
// للتفصيل الكامل لآلية collectGateNameTokens/title): S2 (نفس الأمر) أزال
// testId من categoryStates.issues[].title، فتوقَّف استثناء توكِني
// "cm"/"sn" في هذا الردّ المُشتقّ تحديداً — 13 تسرّباً ظهرت فعلياً
// (مُتحقَّق بتشغيل guardV7Response قبل هذا التعديل). **مُتحقَّق أن لا رقم
// جديد اختُلق** — لا عدّ صريح مكان "SN-07/08/09" في narrative.details
// (كان سيحتاج "ثلاثة" غير موثَّق)، اختيرت صياغة عامّة بدلاً منه.
const TEST_ID_TEXT_REMOVALS = Object.freeze([
  {path: 'DISC-CM-01', from: 'يُقَس CM-01 (الكاميرا الخلفية)', to: 'تُقَس الكاميرا الخلفية'},
  {path: 'DISC-CM-02', from: 'يُقَس CM-02 (الكاميرا الأمامية)', to: 'تُقَس الكاميرا الأمامية'},
  {path: 'DISC-CM-03', from: 'CM-03 (التركيز التلقائي)', to: 'التركيز التلقائي'},
  {path: 'DISC-CM-04', from: 'CM-04 (الفلاش)', to: 'الفلاش'},
  {path: 'DISC-CM-05', from: 'CM-05 (تسجيل الفيديو)', to: 'تسجيل الفيديو'},
  {path: 'DISC-CM-06', from: 'CM-06 (دقّة الكاميرا الخلفية)', to: 'دقّة الكاميرا الخلفية'},
  {path: 'DISC-CM-07', from: 'CM-07 (دقّة الكاميرا الأمامية)', to: 'دقّة الكاميرا الأمامية'},
  {path: 'DISC-CM-10', from: 'CM-10 (التعرّف على الوجه)', to: 'التعرّف على الوجه'},
  {path: 'DISC-SN-07', from: 'يُقَس SN-07 (درجة الحرارة المحيطة)', to: 'تُقَس درجة الحرارة المحيطة'},
  {path: 'DISC-SN-08', from: 'SN-08 (كاشف الخطوات)', to: 'كاشف الخطوات'},
  {path: 'DISC-SN-09', from: 'SN-09 (عدّاد الخطوات)', to: 'عدّاد الخطوات'},
  {path: 'buyerAdvice.photographer', from: '(CM-01 حتى CM-08 وCM-10) ', to: ''},
  {path: 'narrative.details', from: 'وSN-07 وSN-08 وSN-09 (غير متوفرة على الجهاز)', to: 'ومستشعرات غير متوفّرة على الجهاز'},
]);

// ─── تعديل رابع — أضيف 2026-10-01 +03 (مهمّة إخفاء القيم غير المعايَرة عن
// حمولة النموذج، البند ٢) ──────────────────────────────────────────────
// نفس سبب/آلية التعديل المُقابل في generate-derived-from-frozen-real-2026-
// 09-23-envelope-b45c8cf6-accepted.js: buildV7Payload.js صار يحجب
// findings.sustainedCeiling/graphics ومؤشّرات البطارية غير المعايَرة عن
// الحمولة، وguard الإنتاج الحقيقي صار يُحكَّم بالحمولة المحجوبة فعلاً لا
// الخام. أربعة أرقام في هذا الردّ (نفس النصّ الحرفي الأصلي، بلا مساس قبل
// اليوم) صارت بلا مصدر في الحمولة — مُتحقَّق بتشغيل مباشر عبر buildV7Payload
// الحقيقية، لا تخمين:
//   buyerAdvice.gamer: 0.8483 (نسبة سقف مستدام، phase3.meanWindowMaxRatio)
//     و530 (vsyncLockSampleCount، عدد عيّنات قفل التزامن في الرسوميات).
//   crossChecks[2].description: 530 (نفس vsyncLockSampleCount).
//   modelObservations[0].text: 0.8483 (نفس phase3.meanWindowMaxRatio).
//   modelObservations[1].text: 0.8597 (نسبة سعة البطارية الفعلية إلى
//     التصميمية — مشتقّة من مؤشّر بطارية محجوب).
// كل رقم آخر مجاور (0.7016، 0.7143، 0.7806، 3782.75، 4400) يبقى مطابَقاً
// فعلاً (لا يظهر في unmatchedFields، مُتحقَّق) فلا تعديل عليه — الاستبدال
// سطر واحد لكل رقم مرفوض وحده، بلا حذف رقم سليم مجاور.
const BATTERY_GRAPHICS_REDACTION_REPLACEMENTS_2026_10_01 = Object.freeze([
  {path: 'buyerAdvice.gamer', from: 'يسجّل 0.8483 ثم 0.7016', to: 'يسجّل نسبة مرتفعة ثم 0.7016'},
  {path: 'buyerAdvice.gamer', from: 'ولم يُرصد قفل تزامن في 530 عيّنة', to: 'ولم يُرصد قفل تزامن في عيّنات القياس'},
  {path: 'crossChecks[2].description', from: 'وصفر قفل تزامن في 530 عيّنة', to: 'وصفر قفل تزامن في عيّنات القياس'},
  {path: 'modelObservations[0].text', from: 'نِسَب أقصى نافذة 0.8483 ثم 0.7016', to: 'نِسَب أقصى نافذة مرتفعة ثم 0.7016'},
  {path: 'modelObservations[1].text', from: 'بنسبة 0.8597 من السعة التصميمية', to: 'بنسبة غير محكومة بعتبة معايَرة من السعة التصميمية'},
]);

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function replaceOnce(text, from, to, fieldLabel) {
  if (!text.includes(from)) {
    throw new Error(`generate-derived(34d-accepted): توقّف — النصّ المتوقَّع غير موجود في ${fieldLabel}: ${JSON.stringify(from)}`);
  }
  if (text.split(from).length - 1 !== 1) {
    throw new Error(`generate-derived(34d-accepted): توقّف — النصّ "${from}" يتكرّر أكثر من مرّة في ${fieldLabel}`);
  }
  return text.split(from).join(to);
}

function applyEdits(parsedContent) {
  const out = JSON.parse(JSON.stringify(parsedContent));
  for (const key of REMOVED_ISSUE_DESCRIPTION_KEYS) {
    if (!(key in out.narrative.issueDescriptions)) {
      throw new Error(`generate-derived(34d-accepted): توقّف — المفتاح المتوقَّع حذفه "${key}" غير موجود أصلاً`);
    }
    delete out.narrative.issueDescriptions[key];
  }
  out.narrative.summary = replaceOnce(out.narrative.summary,
      TEXT_REPLACEMENTS[0].from, TEXT_REPLACEMENTS[0].to, 'narrative.summary');
  out.narrative.verdict = replaceOnce(out.narrative.verdict,
      TEXT_REPLACEMENTS[1].from, TEXT_REPLACEMENTS[1].to, 'narrative.verdict');
  out.crossChecks[1].description = replaceOnce(out.crossChecks[1].description,
      TEXT_REPLACEMENTS[2].from, TEXT_REPLACEMENTS[2].to, 'crossChecks[1].description');
  let details = out.narrative.details;
  details = replaceOnce(details, TEXT_REPLACEMENTS[3].from, TEXT_REPLACEMENTS[3].to, 'narrative.details');
  details = replaceOnce(details, TEXT_REPLACEMENTS[4].from, TEXT_REPLACEMENTS[4].to, 'narrative.details');
  out.narrative.details = details;

  // TEST_ID_TEXT_REMOVALS — path إمّا مفتاح issueDescriptions، أو
  // 'buyerAdvice.<profile>'، أو 'narrative.details' حرفياً.
  for (const {path: key, from, to} of TEST_ID_TEXT_REMOVALS) {
    if (key === 'narrative.details') {
      out.narrative.details = replaceOnce(out.narrative.details, from, to, 'narrative.details');
      continue;
    }
    if (key.startsWith('buyerAdvice.')) {
      const profile = key.slice('buyerAdvice.'.length);
      out.narrative.buyerAdvice[profile] = replaceOnce(out.narrative.buyerAdvice[profile], from, to, key);
      continue;
    }
    if (!(key in out.narrative.issueDescriptions)) {
      throw new Error(`generate-derived(34d-accepted): توقّف — المفتاح "${key}" غير موجود (حُذف أعلاه أم لم يكن موجوداً أصلاً؟)`);
    }
    out.narrative.issueDescriptions[key] = replaceOnce(out.narrative.issueDescriptions[key], from, to, `issueDescriptions[${key}]`);
  }

  // BATTERY_GRAPHICS_REDACTION_REPLACEMENTS_2026_10_01 — path إمّا
  // 'buyerAdvice.<profile>'، أو 'crossChecks[N].description'، أو
  // 'modelObservations[N].text'.
  for (const {path: fieldPath, from, to} of BATTERY_GRAPHICS_REDACTION_REPLACEMENTS_2026_10_01) {
    if (fieldPath.startsWith('buyerAdvice.')) {
      const profile = fieldPath.slice('buyerAdvice.'.length);
      out.narrative.buyerAdvice[profile] = replaceOnce(out.narrative.buyerAdvice[profile], from, to, fieldPath);
      continue;
    }
    const ccMatch = fieldPath.match(/^crossChecks\[(\d+)\]\.description$/);
    if (ccMatch) {
      const idx = Number(ccMatch[1]);
      out.crossChecks[idx].description = replaceOnce(out.crossChecks[idx].description, from, to, fieldPath);
      continue;
    }
    const moMatch = fieldPath.match(/^modelObservations\[(\d+)\]\.text$/);
    if (moMatch) {
      const idx = Number(moMatch[1]);
      out.modelObservations[idx].text = replaceOnce(out.modelObservations[idx].text, from, to, fieldPath);
      continue;
    }
    throw new Error(`generate-derived(34d-accepted): توقّف — مسار غير مدعوم في applyEdits: ${fieldPath}`);
  }
  // أمر 2026-10-06 (D6): لا استشهاد برقم محجوب — scripts/lib/fixtureTextEdits.js
  applyTextEdits(out, [...D34_ACCEPTED_EDITS, ...D34_ACCEPTED_TREE_2026_10_07], 'generate-derived(34d-accepted)');
  return out;
}

(function main() {
  let actualSourceBlob;
  try {
    actualSourceBlob = execFileSync('git', ['hash-object', SOURCE_REL_PATH], {cwd: REPO_ROOT, encoding: 'utf8'}).trim();
  } catch (e) {
    throw new Error(`generate-derived(34d-accepted): توقّف — تعذّر قراءة بصمة git للأصل: ${e.message}`);
  }
  if (actualSourceBlob !== EXPECTED_SOURCE_BLOB) {
    throw new Error(`generate-derived(34d-accepted): توقّف — بصمة الأصل تغيّرت (متوقَّع ${EXPECTED_SOURCE_BLOB}، والفعلي ${actualSourceBlob})`);
  }

  const sourceFixture = loadJson(SOURCE_FILE);
  const originalContent = JSON.parse(sourceFixture.rawEnvelope.choices[0].message.content);
  const derivedContent = applyEdits(originalContent);

  const raw = loadJson(path.join(GOLDEN_DIR, '34dff2b8.ts.json'));
  const frMap = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId;
  const functional = frMap[SCAN_ID];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });

  // التحقّق الذاتي ضدّ الحمولة المحجوبة فعلاً (مهمّة 2026-10-01، البند ٢) —
  // لا الخام، نفس تصحيح callAI.js: body.findings/body.categoryStates+
  // testResults (لا categoryStates.testResults منفصل في بناء buildV7Payload).
  const {body} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: SCAN_ID, isFreeTrial: false, previousScan: null});
  const categoryStatesForGuard = Object.assign({}, body.categoryStates, {testResults: body.testResults});
  const guard = guardV7Response(derivedContent, {findings: body.findings, categoryStates: categoryStatesForGuard});
  if (!guard.ok) {
    throw new Error(`generate-derived(34d-accepted): توقّف — الناتج مرفوض من الحارس الحقيقي: ${JSON.stringify(guard)}`);
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
      reason: 'الأصل صار مرفوضاً من الحارس (issueKeys+numbers) بعد أمر «الإعدادات لا تُنزل الحرف» (2026-09-27 +03) — ' +
          'يستهلكه resolveV7ReportSimulateScenarios.test.js سيناريو ١ وسيناريو ٦ (يحتاجان ردّاً مقبولاً). ' +
          'تعديل إضافي 2026-10-01 +03 (أمر «C-07 وS-06» البند ١): ISS-S-06 صارت مخترَعة أيضاً (S-06 healthBearing=false).',
      generatedBy: 'functions/scripts/generate-derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted.js',
      generatedAt: '2026-10-07T00:00:00.000Z',
      supersedes: 'derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted-v2-2026-10-06.json — النسخة السابقة (مُلتزَمة بـ01d8ba8، لم تُمَسّ في أمر 2026-10-07): تبقى في المستودع بلا قارئ بعد تحويل قرّائها (D6، القاعدة 34)؛ وهي نفسها حلّت محلّ derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted.json',
      edits: [
        {
          path: 'narrative.issueDescriptions',
          change: 'DELETE_KEYS',
          keys: REMOVED_ISSUE_DESCRIPTION_KEYS,
          reason: 'صارت "مخترَعة" — نفس سبب b45c8cf6. ISS-S-06 أُضيفت 2026-10-01 +03 (أمر «C-07 وS-06» البند ١ — S-06 healthBearing=false).',
        },
        {
          path: 'narrative.summary / narrative.verdict / narrative.details / crossChecks[1].description',
          change: 'TEXT_REPLACE',
          replacements: TEXT_REPLACEMENTS,
          reason: '"45%" لم يعد يطابق أي رقم حقيقي (التغطية الجديدة 45.9% تُقرَّب إلى 46 لا 45)؛ وجملة gps ' +
              'وصفت حرفاً/تغطية لم يعودا موجودين بعد استبعاد L-01 من healthBearing.',
        },
        {
          path: 'narrative.issueDescriptions[DISC-CM-*/DISC-SN-*] / narrative.buyerAdvice.photographer / narrative.details',
          change: 'TEXT_REPLACE',
          replacements: TEST_ID_TEXT_REMOVALS,
          reason: 'S5 (أمر مستخدم 2026-10-01 +03) يمنع ذكر أي معرّف اختبار في نثر بشري — إزالة الرمز ' +
              '(CM-01 إلخ) مع تصحيح تذكير/تأنيث الفعل حين يتغيّر الفاعل بعد الحذف. أثر جانبي غير مباشر: ' +
              'استعاد أيضاً تطابق النصّ مع collectGateNameTokens بعد أن توقّف عن استخراج "cm"/"sn" من ' +
              'title (S2 غيّر title). راجع تقرير المهمّة.',
        },
        {
          path: 'narrative.buyerAdvice.gamer / crossChecks[2].description / modelObservations[0].text / modelObservations[1].text',
          change: 'TEXT_REPLACE',
          replacements: BATTERY_GRAPHICS_REDACTION_REPLACEMENTS_2026_10_01,
          reason: 'مهمّة إخفاء القيم غير المعايَرة عن حمولة النموذج (2026-10-01 +03، البند ٢) — ' +
              '0.8483 (findings.sustainedCeiling.phase3.meanWindowMaxRatio)، 530 (findings.graphics.' +
              'vsyncLockSampleCount)، و0.8597 (نسبة سعة بطارية فعلية/تصميمية، مشتقّة من مؤشّر محجوب) ' +
              'صارت بلا مصدر في الحمولة المحجوبة فعلاً — مرفوضة من حارس الأرقام خارج narrative.details ' +
              '(لا تُعفى بالبند ٤). الأرقام المجاورة (0.7016/0.7143/0.7806/3782.75/4400) تبقى مطابَقة ' +
              'فعلاً فلا تُمَسّ.',
        },
        {
          path: 'narrative.details / narrative.buyerAdvice.gamer,photographer / crossChecks[2,4] / modelObservations[0,1]',
          change: 'TEXT_REPLACE',
          replacements: D34_ACCEPTED_EDITS,
          reason: 'أمر مستخدم 2026-10-06 (D6) — لا استشهاد برقم محجوب: 0.8483/0.7016/0.7806/0.7143 (findings.sustainedCeiling)، ' +
              '1920.3/1083.5/0.5642/0.8536/530 (findings.graphics)، 2597 (S-06)، 3782.75/0.8597 (BAT-FCC)، ' +
              '139.91/1647.85/46.46/1.57 (findings.battery).',
        },
        {
          path: 'narrative.summary / narrative.details / narrative.buyerAdvice.casual,photographer / crossChecks[3,4].description / modelObservations[1].text',
          change: 'TEXT_REPLACE',
          replacements: D34_ACCEPTED_TREE_2026_10_07,
          reason: "أمر مستخدم 2026-10-07 (قرار القوائم) — لا استشهاد برقم محجوب عن حمولة النموذج: 31.3% و71.5 GB (S-02)، 2.7/2.6 GB (R-02)، 4400 mAh (B-02)، 32.4/32.8 °C (B-03)؛ وإزالة «7.4 °C» (ارتفاع حرارة البطارية، findings.thermal) و«43%» (مستوى الشحن، findings.channels) حيث يصادف رقمهما قيمةً حاضرة فلا يكشفهما التدقيق الرقمي وحده. نسخة جديدة موسومة (D6): v2 تبقى في المستودع بلا قارئ بعد تحويل قرّائها (القاعدة 34).",
        },
      ],
      guardVerifiedAtGenerationTime: true,
      guardResultAtGenerationTime: guard,
    },
    rawEnvelope: derivedEnvelope,
  };

  fs.writeFileSync(DEST_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`generate-derived(34d-accepted): كُتب ${DEST_FILE}`);
  console.log(`guard.ok=${guard.ok} (issueKeys.ok=${guard.issueKeys.ok}, numbers.ok=${guard.numbers.ok}, shape.ok=${guard.shape.ok}, languageLeaks=${guard.languageLeaks.length})`);
})();

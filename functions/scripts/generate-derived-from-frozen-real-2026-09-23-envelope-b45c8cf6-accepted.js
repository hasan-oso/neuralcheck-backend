#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted
// — نسخة مُشتقّة من frozen-real-envelope-b45c8cf6-accepted-2026-09-23.json
// (يستهلكه test/resolveV7ReportSimulateScenarios.test.js، سيناريو ٢ "رفض
// ثم نجاح"). أمر مستخدم 2026-09-30 +03 «الردّ الحقيقي المسجَّل لا يُعدَّل»:
// الملفّ الأصلي بلا مساس (tracked، نظيف) — هذا ملفّ منفصل، موسوم صراحة
// أنه ليس ردّاً حقيقياً.
// ===================================================================
//
// لماذا صار الأصل مرفوضاً: بعد أمر «الإعدادات لا تُنزل الحرف»
// (2026-09-27 +03، testKinds.js) صارت SEC-01/05/06/07 وCM-08 وT-01/T-02
// healthBearing=false — categoryStates.issues لم تعد تُنتج عناصر لهذه
// السبعة (categoryStates.js:653)، فستّة مفاتيح narrative.issueDescriptions
// صارت "مُخترَعة" (validateIssueDescriptionKeys). مُتحقَّق بتشغيل مباشر:
// guardV7Response على هذا الملفّ غير المعدَّل، مقابل categoryStates
// الحالية لـb45c8cf6 → issueKeys.ok=false (نفس الستّة)، numbers.ok=true
// (خلافاً لملفّ frozen-real-model-output — لا رقم يحتاج تصحيحاً هنا،
// كل الأرقام في هذا النصّ تطابق مراجع حقيقية أخرى بالمصادفة أو ما زالت
// صحيحة رقمياً رغم عدم دقّتها الدلالية الآن).
//
// ─── التعديل الوحيد (لا تعديل آخر) ───────────────────────────────────
// narrative.issueDescriptions: حذف المفاتيح الستّة (DISC-T-01, DISC-T-02,
// DISC-CM-08, ISS-SEC-05, ISS-SEC-06, DISC-SEC-07). لا تعديل نصّي — كل
// نصّ آخر (summary/details/verdict/crossChecks/adjustments/
// modelObservations) حرفي من الأصل بلا مساس، **بما فيه أرقام صارت غير
// دقيقة دلالياً لكنها لا تزال تجتاز الحارس** (مثال: "فئة الأمان... نقاط
// 66.67 وتغطية 90%" — الرقمان الحقيقيان الجديدان 83.33/100% بعد استبعاد
// SEC-01/05/06/07، لكن 66.67 و90 يطابقان مرجعَين حقيقيَّين آخرَين
// بالمصادفة فلا يُرفضان؛ و"نظام تحديد المواقع جزئي بتغطية 33.3%" —
// gps.state=UNMEASURED فعلياً الآن، لكن "33.3" يطابق مرجعاً آخر أيضاً).
// هذا التوثيق تسجيل صريح لعدم الدقّة، لا إصلاح لها — الحارس لا يفحص
// الدقّة الدلالية، فقط الأرقام/المفاتيح/الشكل/تسرّب اللغة (القاعدة 22:
// الغائب يبقى غائباً حتى يُعلنه قارئه؛ هذا الملفّ يُعلن الفجوة هنا بدل
// إخفائها).
//
// Run: node functions/scripts/generate-derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted.js
// ===================================================================

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {guardV7Response} = require('../src/analysis/reportShapeV7');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {applyTextEdits, B45_ACCEPTED_EDITS, B45_ACCEPTED_TREE_2026_10_07, B45_ACCEPTED_UNSTABLE_LABEL_2026_10_07} = require('./lib/fixtureTextEdits');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');
const SOURCE_REL_PATH = 'functions/test/fixtures/frozen-real-envelope-b45c8cf6-accepted-2026-09-23.json';
const SOURCE_FILE = path.join(FIXTURES_DIR, 'frozen-real-envelope-b45c8cf6-accepted-2026-09-23.json');
// أمر مستخدم 2026-10-06 (D6): نسخة جديدة موسومة لا تعديل في مكان النسخة السابقة. (v4: قرار 2026-10-07 — وسم «غير مستقرّ» لا يصل النموذج.)
const DEST_FILE = path.join(FIXTURES_DIR, 'derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted-v4-2026-10-07.json');
const SCAN_ID = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
const EXPECTED_SOURCE_BLOB = '0160ee99a97cf16e551611bf6ea18172c18d856d';

const REMOVED_ISSUE_DESCRIPTION_KEYS = Object.freeze([
  'DISC-T-01', 'DISC-T-02', 'DISC-CM-08', 'ISS-SEC-05', 'ISS-SEC-06', 'DISC-SEC-07',
]);

// ─── تعديل ثانٍ — أضيف 2026-10-01 +03 (S5، أمر مستخدم "لا رقم اختبار...
// في أي نثر بشري تكتبه" — إعادة كتابة systemPromptV7.js) ──────────────────
// السبب: categoryStates.js:buildDeterministicIssues (S2، نفس الأمر) لم
// يَعُد يضع رقم الاختبار داخل title — فتوقَّف collectGateNameTokens
// (reportShapeV7.js:476-497، يقرأ GATE_VOCAB_KEYS ومنها 'title') عن
// استخراج توكِني "cm"/"sn" من title واستثنائهما من فحص تسرّب اللغة. هذا
// الردّ المُشتقّ (وحده، لا الأصل frozen-real المحمي) يستشهد بمعرّف
// الاختبار حرفياً داخل 11 وصفاً من narrative.issueDescriptions (مسموح
// وقت كتابة النصّ الأصلي بالسياسة القديمة، ممنوع الآن) — فيصير "تسرّباً"
// حقيقياً غير مُستثنى (مُتحقَّق بتشغيل فعلي: guardV7Response.languageLeaks
// كان 0، صار 12 توكِناً بعد S2/S5 بلا هذا التعديل). **مُتحقَّق بتشغيل فعلي
// أن دلالة النصّ لا تتغيّر** — إزالة الرمز بين قوسين فقط
// (" (CM-01)"/" (SN-07)"…)، لا كلمة أخرى.
const TEST_ID_PARENTHETICAL_REMOVALS = Object.freeze([
  {path: 'DISC-CM-01', from: ' (CM-01)', to: ''},
  {path: 'DISC-CM-02', from: ' (CM-02)', to: ''},
  {path: 'DISC-CM-03', from: ' (CM-03)', to: ''},
  {path: 'DISC-CM-04', from: ' (CM-04)', to: ''},
  {path: 'DISC-CM-05', from: ' (CM-05)', to: ''},
  {path: 'DISC-CM-06', from: ' (CM-06)', to: ''},
  {path: 'DISC-CM-07', from: ' (CM-07)', to: ''},
  {path: 'DISC-CM-10', from: ' (CM-10)', to: ''},
  {path: 'DISC-SN-07', from: ' (SN-07)', to: ''},
  {path: 'DISC-SN-08', from: ' (SN-08)', to: ''},
  {path: 'DISC-SN-09', from: ' (SN-09)', to: ''},
  // narrative.buyerAdvice.photographer (لا narrative.issueDescriptions) —
  // مسار مختلف، اكتُشف بتشغيل فعلي (تحقّق ثانٍ بعد التعديل الأوّل أعلاه:
  // languageLeaks لم يصل صفراً من أوّل تشغيلة — "CM" بقيت هنا). لا رقم
  // جديد يُخترَع (لا "9 اختبارات" ولا أي عدد) — القاعدة 22: العدد الدقيق
  // بعد حذف CM-08 من REMOVED_ISSUE_DESCRIPTION_KEYS أعلاه لم يعد "CM-01
  // إلى CM-08 وCM-10" صحيحاً أصلاً (ثماني نقاط لا سبع)، فالحذف بلا رقم
  // بديل أصدق من رقم قد يُخمَّن خطأً.
  {path: 'buyerAdvice.photographer', from: 'كل اختبارات الكاميرا من CM-01 إلى CM-08 وCM-10 غير مقيسة', to: 'كل اختبارات الكاميرا غير مقيسة'},
]);

// ─── تعديل ثالث — أضيف 2026-10-01 +03 (مهمّة إخفاء القيم غير المعايَرة عن
// حمولة النموذج، البند ٢) ──────────────────────────────────────────────
// السبب: buildV7Payload.js صار يحجب مؤشّرات البطارية غير المعايَرة
// (BAT-FCC/BAT-R-APPARENT/BAT-COULOMB/BAT-THERMAL-EFF) عن الحمولة، وguard
// الإنتاج الحقيقي (callAI.js) صار يُحكَّم بالحمولة المحجوبة فعلاً لا الخام
// (تصحيح أمني من نفس المهمّة). modelObservations[0].text يستشهد بـ"132.79"
// (المقاومة الظاهرة BAT-R-APPARENT، مُحجوبة الآن) — مُتحقَّق بتشغيل مباشر:
// guardV7Response عبر buildV7Payload الحقيقية يرفضه (numbers.unmatchedFields
// يحمل modelObservations[0].text:[132.79] وحده خارج narrative.details، لا
// يُعفى بالبند ٤ لأنه ليس details). الرقمان الآخران في نفس الجملة (0.8587
// نسبة السعة، 32.4°C حرارة) يبقيان مطابَقين (لا تغيير عليهما). نفس الرقم
// (132.79) يظهر أيضاً في narrative.details — هناك مُعفًى من الرفض (البند ٤)
// فلا تعديل عليه (توثيق فقط، راجع knownStaleButGuardPassing أدناه).
const BATTERY_REDACTION_REPLACEMENTS_2026_10_01 = Object.freeze([
  {
    path: 'modelObservations[0].text',
    from: 'والمقاومة الظاهرة 132.79 mΩ',
    to: 'والمقاومة الظاهرة مقيسة بلا عتبة معايَرة',
  },
]);

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function applyEdits(parsedContent) {
  const out = JSON.parse(JSON.stringify(parsedContent));
  for (const key of REMOVED_ISSUE_DESCRIPTION_KEYS) {
    if (!(key in out.narrative.issueDescriptions)) {
      throw new Error(`generate-derived(b45-accepted): توقّف — المفتاح المتوقَّع حذفه "${key}" غير موجود أصلاً`);
    }
    delete out.narrative.issueDescriptions[key];
  }
  for (const {path: key, from, to} of TEST_ID_PARENTHETICAL_REMOVALS) {
    // path إمّا مفتاح issueDescriptions مباشرة (مثل 'DISC-CM-01') أو
    // 'buyerAdvice.<profile>' (حقل مختلف تماماً — راجع التعليق أعلاه).
    const isBuyerAdvice = key.startsWith('buyerAdvice.');
    const container = isBuyerAdvice ? out.narrative.buyerAdvice : out.narrative.issueDescriptions;
    const leaf = isBuyerAdvice ? key.slice('buyerAdvice.'.length) : key;
    const value = container[leaf];
    if (typeof value !== 'string' || !value.includes(from)) {
      throw new Error(`generate-derived(b45-accepted): توقّف — النصّ المتوقَّع "${from}" غير موجود في ${key}: ${JSON.stringify(value)}`);
    }
    container[leaf] = value.split(from).join(to);
  }
  for (const {path: fieldPath, from, to} of BATTERY_REDACTION_REPLACEMENTS_2026_10_01) {
    const m = fieldPath.match(/^modelObservations\[(\d+)\]\.text$/);
    if (!m) throw new Error(`generate-derived(b45-accepted): توقّف — مسار غير مدعوم في applyEdits: ${fieldPath}`);
    const idx = Number(m[1]);
    const value = out.modelObservations[idx] && out.modelObservations[idx].text;
    if (typeof value !== 'string' || !value.includes(from)) {
      throw new Error(`generate-derived(b45-accepted): توقّف — النصّ المتوقَّع "${from}" غير موجود في ${fieldPath}: ${JSON.stringify(value)}`);
    }
    if (value.split(from).length - 1 !== 1) {
      throw new Error(`generate-derived(b45-accepted): توقّف — النصّ "${from}" يتكرّر أكثر من مرّة في ${fieldPath}، الاستبدال غير آمن`);
    }
    out.modelObservations[idx].text = value.split(from).join(to);
  }
  // أمر 2026-10-06 (D6): لا استشهاد برقم محجوب — scripts/lib/fixtureTextEdits.js
  applyTextEdits(out, [...B45_ACCEPTED_EDITS, ...B45_ACCEPTED_TREE_2026_10_07, ...B45_ACCEPTED_UNSTABLE_LABEL_2026_10_07], 'generate-derived(b45-accepted)');
  return out;
}

(function main() {
  let actualSourceBlob;
  try {
    actualSourceBlob = execFileSync('git', ['hash-object', SOURCE_REL_PATH], {cwd: REPO_ROOT, encoding: 'utf8'}).trim();
  } catch (e) {
    throw new Error(`generate-derived(b45-accepted): توقّف — تعذّر قراءة بصمة git للأصل: ${e.message}`);
  }
  if (actualSourceBlob !== EXPECTED_SOURCE_BLOB) {
    throw new Error(`generate-derived(b45-accepted): توقّف — بصمة الأصل تغيّرت (متوقَّع ${EXPECTED_SOURCE_BLOB}، والفعلي ${actualSourceBlob})`);
  }

  const sourceFixture = loadJson(SOURCE_FILE);
  const originalContent = JSON.parse(sourceFixture.rawEnvelope.choices[0].message.content);
  const derivedContent = applyEdits(originalContent);

  const raw = loadJson(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'));
  const frMap = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId;
  const functional = frMap[SCAN_ID];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });

  // التحقّق الذاتي ضدّ الحمولة المحجوبة فعلاً (body.findings/body.categoryStates+
  // testResults) لا الخام — مطابق لتصحيح callAI.js (مهمّة 2026-10-01، البند ٢)،
  // وإلّا مرّ هذا المولّد نصّاً يستشهد بأرقام حُجبت عن النموذج فعلاً دون أن يكتشفه.
  const {body} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: SCAN_ID, isFreeTrial: false, previousScan: null});
  const categoryStatesForGuard = Object.assign({}, body.categoryStates, {testResults: body.testResults});
  const guard = guardV7Response(derivedContent, {findings: body.findings, categoryStates: categoryStatesForGuard});
  if (!guard.ok) {
    throw new Error(`generate-derived(b45-accepted): توقّف — الناتج مرفوض من الحارس الحقيقي: ${JSON.stringify(guard)}`);
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
      reason: 'الأصل صار مرفوضاً من الحارس (issueKeys) بعد أمر «الإعدادات لا تُنزل الحرف» (2026-09-27 +03) — ' +
          'يستهلكه resolveV7ReportSimulateScenarios.test.js سيناريو ٢ (يحتاج ردّاً مقبولاً لاختبار آلية "رفض ثم نجاح").',
      generatedBy: 'functions/scripts/generate-derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted.js',
      generatedAt: '2026-10-07T00:00:00.000Z',
      supersedes: 'derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted-v3-2026-10-07.json — النسخة السابقة (مُلتزَمة، لم تُمَسّ): تبقى في المستودع بلا قارئ بعد تحويل قرّائها (D6، القاعدة 34)؛ وهي حلّت محلّ derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted-v2-2026-10-06.json، وتلك محلّ derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted.json',
      edits: [
        {
          path: 'narrative.issueDescriptions',
          change: 'DELETE_KEYS',
          keys: REMOVED_ISSUE_DESCRIPTION_KEYS,
          reason: 'صارت "مخترَعة" — categoryStates.issues لم يعد يُنتج عناصر لها بعد استبعاد ' +
              'SEC-05/SEC-06/CM-08/T-01/T-02 من healthBearing.',
        },
        {
          path: 'narrative.issueDescriptions[DISC-CM-01,02,03,04,05,06,07,10 / DISC-SN-07,08,09]',
          change: 'TEXT_REPLACE',
          replacements: TEST_ID_PARENTHETICAL_REMOVALS,
          reason: 'S5 (أمر مستخدم 2026-10-01 +03) يمنع ذكر أي معرّف اختبار في نثر بشري — ' +
              'إزالة الرمز بين قوسين وحده (" (CM-01)" إلخ)، بلا تغيير في بقيّة الجملة. ' +
              'أثر جانبي غير مباشر: هذا استعاد أيضاً تطابق النصّ مع collectGateNameTokens ' +
              '(reportShapeV7.js) بعد أن توقّف عن استخراج "cm"/"sn" من title (S2 غيّر title، ' +
              'لم يعد يحمل testId) — راجع تقرير المهمّة.',
        },
        {
          path: 'modelObservations[0].text',
          change: 'TEXT_REPLACE',
          replacements: BATTERY_REDACTION_REPLACEMENTS_2026_10_01,
          reason: 'مهمّة إخفاء القيم غير المعايَرة عن حمولة النموذج (2026-10-01 +03، البند ٢) — ' +
              '"132.79" (المقاومة الظاهرة BAT-R-APPARENT) صار بلا مصدر في الحمولة المحجوبة فعلاً، ' +
              'فرفضه حارس الأرقام (خارج narrative.details، لا يُعفى بالبند ٤). نفس الرقم في ' +
              'narrative.details لم يُمَسّ (مُعفًى هناك — راجع knownStaleButGuardPassing).',
        },
        {
          path: 'narrative.details / narrative.buyerAdvice.gamer / narrative.issueDescriptions[POS-storage] / crossChecks[0,2] / adjustments[0] / modelObservations[0]',
          change: 'TEXT_REPLACE',
          replacements: B45_ACCEPTED_EDITS,
          reason: 'أمر مستخدم 2026-10-06 (D6) — لا استشهاد برقم محجوب: 3265 (S-06)، 132.79/1691.67/46.04 (BAT-R-APPARENT/findings.battery)، ' +
              '2065.37/1187.86/0.575 (findings.graphics)، 0.8587 (BAT-FCC)، و1.854 (findings.thermal، صار 1.85 بتقريب البند ٣).',
        },
        {
          path: 'narrative.details / narrative.buyerAdvice.photographer / narrative.issueDescriptions[POS-memory] / modelObservations[0].text',
          change: 'TEXT_REPLACE',
          replacements: B45_ACCEPTED_TREE_2026_10_07,
          reason: "أمر مستخدم 2026-10-07 (قرار القوائم) — لا استشهاد برقم محجوب عن حمولة النموذج: 31.3% و71.5 GB (S-02)، 2.7/2.6 GB (R-02)، 4400 mAh (B-02)، 32.4/32.8 °C (B-03)؛ وإزالة «7.4 °C» (ارتفاع حرارة البطارية، findings.thermal) و«43%» (مستوى الشحن، findings.channels) حيث يصادف رقمهما قيمةً حاضرة فلا يكشفهما التدقيق الرقمي وحده. نسخة جديدة موسومة (D6): v2 تبقى في المستودع بلا قارئ بعد تحويل قرّائها (القاعدة 34).",
        },
        {
          path: 'modelObservations[1].text',
          change: 'TEXT_REPLACE',
          replacements: B45_ACCEPTED_UNSTABLE_LABEL_2026_10_07,
          reason: "قرار مستخدم 2026-10-07 (وسم «غير مستقرّ» لا يصل النموذج: تُحذف findings.unstableMeasurements وحقل unstable) — الملاحظة كتب فيها النموذج «وُسمت UNSTABLE… مصنّفة غير حاسمة وفق معيار الاتساق» وصفاً مأخوذاً من الوسم الذي لم يعد يصل؛ والحارس يرفض «UNSTABLE» الآن تسرّباً لاتينياً (كان يُعفيها لأنها اسم حقل في findings.unstableMeasurements). يُحذف الوصف المأخوذ من الوسم وحده. نسخة جديدة موسومة (D6): v3 تبقى في المستودع بلا قارئ (القاعدة 34). والعنصر التالي (طبقة قرار القوائم 2026-10-07) كان في v3 داخل knownStaleButGuardPassing بالخطأ، فنُقل هنا إلى edits.",
        },
      ],
      knownStaleButGuardPassing: [
        'narrative.details: "نقاط 66.67 وتغطية 90%" لفئة الأمان — الرقمان الحقيقيان الجديدان 83.33/100 ' +
            'بعد استبعاد SEC-01/05/06/07، لكن 66.67/90 يطابقان مرجعَين حقيقيَّين آخرَين بالمصادفة فيمرّان من الحارس دون تصحيح.',
        'narrative.details: "نظام تحديد المواقع جزئي بتغطية 33.3%" — gps.state=UNMEASURED فعلياً الآن (L-01 ' +
            'لم تعد healthBearing)، لكن "33.3" يطابق مرجعاً آخر بالمصادفة فيمرّ من الحارس دون تصحيح.',
        'narrative.details (مهمّة 2026-10-01، البند ٤): "مقاومة ظاهرة 132.79 mΩ، وتيار تفريغ تحت الحمل ' +
            '1691.67 mA" — كلاهما مؤشّر بطارية محجوب الآن عن الحمولة (BAT-R-APPARENT/BAT-COULOMB أو ما ' +
            'يصنَّف تحته)؛ details حقل مُعفًى من الرفض (لا يصل المشتري، القرار المرافق) فلا تعديل نصّي ' +
            'عليه — يُسجَّل في aiAudit.detailsGuardWaived عند التشغيل الحقيقي بدل تصحيحه هنا.',
      ],
      guardVerifiedAtGenerationTime: true,
      guardResultAtGenerationTime: guard,
    },
    rawEnvelope: derivedEnvelope,
  };

  fs.writeFileSync(DEST_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`generate-derived(b45-accepted): كُتب ${DEST_FILE}`);
  console.log(`guard.ok=${guard.ok} (issueKeys.ok=${guard.issueKeys.ok}, numbers.ok=${guard.numbers.ok}, shape.ok=${guard.shape.ok}, languageLeaks=${guard.languageLeaks.length})`);
})();

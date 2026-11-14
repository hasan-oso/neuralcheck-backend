'use strict';

// v7ZeroMeasuredSamplesContractGuard.test.js — القاعدة 39 للعيّنات المشتقّة zero-measured (الأمر: «عيّنة مشتقّة يولّدها الخادم نفسه من مُدخل لا تُقاس فيه أي فئة،
// فيمتلئ zeroMeasuredMessage وabstentionReasons. ومصدرها مكتوب، وتطابق ما ينتجه الخادم (القاعدة 41)، وتُنسخ إلى التطبيق والموقع (القاعدة 39)»).
// يحرس الثوابت المُلتزَمة السبعة (ستّ عيّنات بثلاثة أشكال لكل من متغيّرين + ملفّ المصدر/التحويل):
//   v7-reports-document-sample-zero-measured.json                          v7-reports-document-sample-zero-measured-battery-harness-error.json
//   v7-client-payload-sample-zero-measured.json                            v7-client-payload-sample-zero-measured-battery-harness-error.json
//   v7-verifyReport-response-sample-zero-measured.json                     v7-verifyReport-response-sample-zero-measured-battery-harness-error.json
//   v7-zero-measured-samples-meta.json  (المصدر والتحويل — ملفّ مستقلّ لأن القاعدة 41 تمنع مفتاح _meta داخل مستند/ردّ يُفترَض أن يطابق مُنتِجه)
// يعيد بناءها كلّها **في الذاكرة** عبر السلسلة الحقيقية (runAnalysisInternal وresolveV7Report وbuildDisplayShapeV7 وbuildReportDocument…) ويقارنها حرفاً بحرف بالمُلتزَم
// (باستثناء shortId على المستوى الأعلى — عشوائي بتصميمه). بلا كتابة، بلا شبكة، بلا نداء نموذج (فخّ fetch في المولّد).
//
// Run: node functions/test/v7ZeroMeasuredSamplesContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const gen = require('../scripts/generate-v7-reports-document-sample-zero-measured');
const {REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');

// الأسماء الحرفية (الربط مع goldenFixturesGuardCoverage.test.js يشترط ذكر كل اسم حرفياً في نصّ الحارس).
const FILES = {
  default: {
    reportsDocument: 'v7-reports-document-sample-zero-measured.json',
    rawDocument: 'v7-report-raw-sample-zero-measured.json',
    clientPayload: 'v7-client-payload-sample-zero-measured.json',
    verifyReport: 'v7-verifyReport-response-sample-zero-measured.json',
  },
  batteryHarnessError: {
    reportsDocument: 'v7-reports-document-sample-zero-measured-battery-harness-error.json',
    rawDocument: 'v7-report-raw-sample-zero-measured-battery-harness-error.json',
    clientPayload: 'v7-client-payload-sample-zero-measured-battery-harness-error.json',
    verifyReport: 'v7-verifyReport-response-sample-zero-measured-battery-harness-error.json',
  },
};
const META_NAME = 'v7-zero-measured-samples-meta.json';
for (const k of Object.keys(FILES)) deepEq(gen.VARIANTS[k].files, FILES[k], `[ربط] أسماء ملفّات المتغيّر ${k} في المولّد = أسماء الحارس`);
eq(path.basename(gen.META_FILE), META_NAME, '[ربط] اسم ملفّ _meta في المولّد = اسمه في الحارس');

const allNames = [...Object.values(FILES).flatMap((o) => Object.values(o)), META_NAME];
const load = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
const committed = Object.fromEntries(allNames.map((nm) => [nm, load(nm)]));
const mtimesBefore = Object.fromEntries(allNames.map((nm) => [nm, fs.statSync(path.join(GOLDEN_DIR, nm)).mtimeMs]));

function diffPaths(a, b, p, out) {
  if (p === 'shortId') return; // المستوى الأعلى وحده — عشوائي بتصميمه (generateShortId)
  if (typeof a !== typeof b) { out.push(`${p}: النوع ${typeof a} ≠ ${typeof b}`); return; }
  if (a === null || b === null) { if (a !== b) out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${p}: طول المصفوفة ${a.length} ≠ ${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) diffPaths(a[i], b[i], `${p}[${i}]`, out);
    return;
  }
  if (typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p ? `${p}.${k}` : k, out);
    return;
  }
  if (a !== b) out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

(async () => {
  const {files: fresh, meta} = await gen.buildAllZeroMeasuredFiles();
  const mtimesAfter = Object.fromEntries(allNames.map((nm) => [nm, fs.statSync(path.join(GOLDEN_DIR, nm)).mtimeMs]));
  deepEq(mtimesAfter, mtimesBefore, '[بناء] إعادة البناء في الذاكرة لم تكتب/تلمس أيّاً من الملفّات التسعة (mtime بلا تغيير)');
  deepEq(Object.keys(fresh).sort(), [...allNames].sort(), '[بناء] المولّد يُنتج الملفّات التسعة نفسها بالضبط');

  // ═══ ١ — المُلتزَم يطابق ما يُنتجه المولّد الآن (الطرف الثاني من القاعدة 39) ═══
  for (const nm of allNames) {
    const diffs = [];
    diffPaths(fresh[nm], committed[nm], '', diffs);
    if (diffs.length > 0) {
      console.error(`\n⚠️ ${nm} لا يطابق ما يُنتجه المولّد فعلياً — ${diffs.length} فرقاً (باستثناء shortId):`);
      for (const d of diffs.slice(0, 40)) console.error(`  ${d}`);
      console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample-zero-measured.js ثم git add/commit للثوابت المُحدَّثة (القاعدة 39).\n');
    }
    ok(diffs.length === 0, `[١] ${nm}: المُلتزَم = مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId) — ${diffs.length} فرقاً`);
  }

  // ═══ ٢ — الدلالة: كل عيّنة بلا حرف، وبالحقلين مملوءين، في الأشكال الثلاثة ═══
  const overallOf = {
    reportsDocument: (d) => d.aiResponse.overall,
    clientPayload: (d) => d.overall,
    verifyReport: (d) => d.aiResponse, // verifyReport يُسطِّح overall داخل aiResponse (pickOverall)
  };
  const codeOf = (reason) => String(reason).split(' ')[0];
  const codesOfVariant = {};
  for (const [variant, byShape] of Object.entries(FILES)) {
    let refReasons = null; let refMessage = null;
    for (const [shape, nm] of Object.entries(byShape)) {
      if (shape === 'rawDocument') continue; // الخامّ ليس شكل عرض — لا overall فيه (يُفحَص أدناه: aiAudit وغياب الحقول المنقولة من المقروء)
      const ov = overallOf[shape](committed[nm]);
      eq(ov.letter, null, `[٢] ${nm}: overall.letter = null`);
      eq(ov.noDataAtAll, true, `[٢] ${nm}: noDataAtAll = true`);
      ok(typeof ov.zeroMeasuredMessage === 'string' && ov.zeroMeasuredMessage.length > 0, `[٢] ${nm}: zeroMeasuredMessage نصّ غير فارغ`);
      ok(Array.isArray(ov.abstentionReasons) && ov.abstentionReasons.length > 0 &&
          ov.abstentionReasons.every((a) => a && typeof a === 'object' && typeof a.category === 'string' && typeof a.reason === 'string' && a.reason.length > 0),
      `[٢] ${nm}: abstentionReasons مصفوفة كائنات {category, reason} غير فارغة`);
      ok(!('_meta' in committed[nm]), `[٢] ${nm}: لا مفتاح _meta داخل العيّنة (القاعدة 41 — العيّنة تطابق مُنتِجها)`);
      if (refReasons === null) { refReasons = ov.abstentionReasons; refMessage = ov.zeroMeasuredMessage; } else {
        deepEq(ov.abstentionReasons, refReasons, `[٢] ${nm}: abstentionReasons = نظيرها في الأشكال الأخرى للمتغيّر ${variant}`);
        eq(ov.zeroMeasuredMessage, refMessage, `[٢] ${nm}: zeroMeasuredMessage = نظيره في الأشكال الأخرى للمتغيّر ${variant}`);
      }
    }
    codesOfVariant[variant] = [...new Set(refReasons.map((a) => codeOf(a.reason)))].sort();
    const battery = refReasons.find((a) => a.category === 'battery');
    eq(codeOf(battery.reason), gen.VARIANTS[variant].expectBatteryCode, `[٢] ${variant}: سبب البطارية = ${gen.VARIANTS[variant].expectBatteryCode}`);
    ok(codesOfVariant[variant].includes('NO_HEALTH_BEARING_TESTS_DECLARED') && codesOfVariant[variant].includes('DECLARED_BUT_NONE_EXECUTED'),
        `[٢] ${variant}: الرمزان NO_HEALTH_BEARING_TESTS_DECLARED وDECLARED_BUT_NONE_EXECUTED حاضران`);
    // علامة المحاكاة في مستند reports (aiAudit) — لا نداء نموذج، معلَن لا مموَّه
    const rounds = committed[byShape.rawDocument].aiAudit.regeneration.rounds; // V8: aiAudit انتقل إلى reportRaw
    ok(rounds.length === 1 && rounds[0].rejectedReasons[0].includes(gen.PROVIDER_STUB_MARKER), `[٢] ${variant}: aiAudit.regeneration يحمل علامة المحاكاة (لا نداء نموذج)`);
    eq(committed[byShape.reportsDocument].aiResponse.narrativeIncomplete, true, `[٢] ${variant}: narrativeIncomplete = true (لا سرد مُختلَق)`);
  }

  // ═══ ٢-ب — V8 نقل الخامّ: المقروء بلا الحقول المنقولة، والخامّ يحملها وبلا userId ═══
  for (const [variant, byShape] of Object.entries(FILES)) {
    for (const f of REPORT_RAW_FIELDS) {
      ok(!(f in committed[byShape.reportsDocument]), `[٢-ب] ${variant}: المستند المقروء لا يحمل "${f}"`);
      ok(f in committed[byShape.rawDocument], `[٢-ب] ${variant}: عيّنة الخامّ تحمل "${f}"`);
    }
    ok(!('userId' in committed[byShape.rawDocument]), `[٢-ب] ${variant}: عيّنة الخامّ بلا userId`);
    ok('userId' in committed[byShape.reportsDocument], `[٢-ب] ${variant}: المستند المقروء يحمل userId`);
  }

  // ═══ ٣ — _meta: الرموز مشتقّة من العيّنات المُلتزَمة لا مكتوبة باليد، وغير الممكنة معلَنة بسببها ═══
  const m = committed[META_NAME]._meta;
  deepEq(m.codesCoveredAcrossVariants, [...new Set(Object.values(codesOfVariant).flat())].sort(),
      '[٣] _meta.codesCoveredAcrossVariants = اتّحاد رموز العيّنات المُلتزَمة (مشتقّ لا مكتوب باليد)');
  deepEq(m.codesCoveredAcrossVariants, ['DECLARED_BUT_NONE_EXECUTED', 'HARNESS_ERROR', 'NO_CALIBRATED_THRESHOLD', 'NO_HEALTH_BEARING_TESTS_DECLARED'],
      '[٣] الرموز المُغطّاة بالعيّنتين: أربعة من الستّة');
  deepEq(m.codesNotReachable.map((c) => c.code).sort(), ['MANUAL_ATTESTATION_ONLY', 'NO_BATTERY_INDICATORS_MEASURED'],
      '[٣] غير الممكن من مُدخل حقيقي بلا اختلاق: MANUAL_ATTESTATION_ONLY وNO_BATTERY_INDICATORS_MEASURED');
  ok(m.codesNotReachable.every((c) => typeof c.reason === 'string' && c.reason.length > 40), '[٣] لكل رمز غير ممكن سبب مكتوب');
  for (const [variant, v] of Object.entries(m.variants)) {
    deepEq(v.codesCovered, codesOfVariant[variant], `[٣] _meta.variants.${variant}.codesCovered = رموز العيّنات المُلتزَمة`);
    ok(Array.isArray(v.transformation) && v.transformation.length >= 3 && v.transformation.every((t) => t.target && t.reason), `[٣] ${variant}: التحويل مكتوب بهدفه وسببه`);
  }
  ok(!m.codesCoveredAcrossVariants.some((c) => m.codesNotReachable.some((u) => u.code === c)), '[٣] لا رمز مُدرَج مُغطّى وغير ممكن معاً');
  eq(meta._meta.simulated.marker, gen.PROVIDER_STUB_MARKER, '[٣] علامة المحاكاة في _meta = ثابت المولّد');

  // ═══ ٤ — الأصل الحقيقي لم يُمَسّ: الملفّان الحقيقيان لا يحملان أثر التحويل ═══
  const realFr = load('functionalResults-by-scanid.json').byScanId['34dff2b8-ce9e-4b40-86a9-1976c878e195'];
  eq(realFr.find((r) => r.testId === gen.PATCH_TEST_ID).rawValue, '2021-08-01', `[٤] ${gen.PATCH_TEST_ID} في الملفّ الحقيقي ما زال بتاريخه الأصلي`);
  ok(realFr.filter((r) => gen.SUPPRESSED_LETTER_CATEGORIES.includes(r.categoryName)).some((r) => r.status === 'pass'),
      '[٤] الملفّ الحقيقي ما زال يحمل نتائج pass في الفئات التسع التي غُيِّرت حالتها في النسخة المشتقّة');
  ok(load('34dff2b8.ts.json').samples.length > 0, '[٤] 34dff2b8.ts.json الحقيقي ما زال بعيّناته (التحويل نسخة في الذاكرة)');

  console.log(`\nv7ZeroMeasuredSamplesContractGuard.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });

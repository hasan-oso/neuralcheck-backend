'use strict';

// verifyReportAuditExclusion.test.js — القرار ٢٠ (PLAN-01-ROADMAP.md §🔒
// "٢٠ · سلك display وaudit"): "verifyReport لا يُرجع aiAudit إطلاقاً —
// الإسقاط فيه قائمة بيضاء صريحة (verifyReport.js:185-224)، فيبقى خارجها
// بلا تدخّل. تحقّق ولا تُضفه." — مُثبَت هنا **باختبار**، لا بالقراءة وحدها
// (نفس نصّ أمر المهمّة تحت "في تقريرك").
//
// نفس أسلوب verifyReportLimits.test.js: استخراج المنطق الخالص من المصدر
// (بلا تحميل firebase-functions/onRequest كاملة) عبر تقطيع نصّي، ثمّ
// تنفيذه بمُدخلات مُصطنَعة. verifyReport.js لا يحتاج Firestore حقيقياً
// لاختبار بناء كائن `response` نفسه — ذلك المنطق يقرأ `report`/`ai` فقط.
//
// Run: node functions/test/verifyReportAuditExclusion.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
// ثابت واحد مُصدَّر — مصدر الحقيقة الوحيد لعلامتَي pipeline. المقطع
// المُستخرَج أدناه من verifyReport.js يستهلك V7_PIPELINE_TAG/V6_PIPELINE_TAG
// كمتغيّرين حرّين (verifyReport.js يستوردهما أعلى ملفّه الحقيقي، خارج
// نطاق هذا الاستخراج) — new Function لا تُغلِق على نطاق تلك الوحدة، فهنا
// وحدهما مصدر قيمتيهما لهذا الاختبار، عبر require مباشر لا سلسلة حرفية.
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} =
    require('../src/analysis/pipelineTags');
const {hashIdForLog} = require('../src/utils/logRedaction');

const SRC = path.join(__dirname, '..', 'src', 'reports', 'verifyReport.js');
const src = fs.readFileSync(SRC, 'utf8');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── استخراج بناء `response` كدالّة خالصة ────────────────────────────────
// من "const report = reportDoc.data();" حتى قبل "res.json(response);" —
// يغطّي بناء `ai`, `response`, وشرط `_wasReused`. القسمان الوحيدان اللذان
// يستهلكهما هذا المقطع من خارج نطاقه (غير reportDoc/report) هما
// V7_PIPELINE_TAG وV6_PIPELINE_TAG — مُمرَّران كوسيطين صريحين أدناه (القاعدة
// 16: أُصلحت الأداة نفسها لتقبل المعرِّفين وسيطين، لا الملتفّ عليها بتكرار
// السلسلة الحرفية هنا).
{
  const startMarker = 'const report = reportDoc.data();';
  const endMarker = 'res.json(response);';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  ok(startIdx > -1 && endIdx > -1 && endIdx > startIdx,
      'إعداد: العلامتان موجودتان في verifyReport.js بنفس الترتيب المتوقَّع — وإلا فالمصدر تغيّر ولزم تحديث الاستخراج');

  const bodySrc = src.slice(startIdx, endIdx);
  // console.log داخل المقطع يشير إلى reportDoc.id/shortId — نُسكِتها بدالّة فارغة.
  const buildResponse = new Function(
      'reportDoc', 'console', 'V7_PIPELINE_TAG', 'V6_PIPELINE_TAG', 'hashIdForLog', // hashIdForLog: S-SUB 2026-10-16 — سطر تحذير V7 يُهشِّر scanId؛ وسيط صريح (القاعدة 16: إصلاح الأداة)
      bodySrc + '\nreturn response;');
  const quietConsole = {log: () => {}, warn: () => {}, error: () => {}};

  // ─── تقرير مُصطنَع يحمل aiAudit حقيقياً على مستوى المستند (كما يكتبه
  // analyzeDevice.js منذ هذه المهمّة — القرار ٢٠) + حمولة sensitve تجريبية
  // للتأكّد أنها لا تتسرّب عبر أي مسار (لا حتى داخل aiResponse).
  const fakeAudit = {
    measuredCategoriesMean: 42,
    gatesApplied: [{name: 'ROOT_DETECTED', status: 'FIRED'}],
    crossChecks: [{description: 'ملاحظة داخلية للمراجع فقط', evidenceRefs: []}],
    modelObservations: [{text: 'ملاحظة نموذج داخلية', evidenceRefs: []}],
    regeneration: {attempts: 2, narrativeIncomplete: true, droppedFields: ['narrative.verdict'], rounds: []},
    SECRET_MARKER_SHOULD_NEVER_LEAK: 'leak-canary-9f3c',
  };
  const fakeReportDoc = {
    id: 'scan-audit-exclusion-test',
    data: () => ({
      deviceModel: 'P', deviceMarketingName: 'Test', shortId: 'NC-ABCD1234',
      grade: 'C', score: 60, createdAt: '2026-09-21T00:00:00Z', language: 'ar',
      isFreeTrial: false,
      aiResponse: {
        summary: 's', verdict: 'v', issues: [], predicted_problems: [],
        category_scores: {}, buyer_advice: {}, category_notes: {},
        expected_performance: {}, change_analysis: {},
      },
      // الحقل الجديد (القرار ٢٠) — شقيق aiResponse على مستوى المستند.
      aiAudit: fakeAudit,
    }),
  };

  const response = buildResponse(
      fakeReportDoc, quietConsole, V7_PIPELINE_TAG, V6_PIPELINE_TAG, hashIdForLog);

  ok(response && typeof response === 'object', 'إعداد: buildResponse أنتجت كائناً فعلاً');
  ok(!('aiAudit' in response), 'response لا تحمل مفتاح aiAudit على المستوى الأعلى');
  ok(response.aiResponse && typeof response.aiResponse === 'object', 'إعداد: response.aiResponse موجود');
  ok(!('aiAudit' in response.aiResponse), 'response.aiResponse لا يحمل مفتاح aiAudit');

  const serialized = JSON.stringify(response);
  ok(!serialized.includes('aiAudit'), 'التسلسل الكامل (ما يصل res.json فعلياً) خالٍ من السلسلة "aiAudit"');
  ok(!serialized.includes('SECRET_MARKER_SHOULD_NEVER_LEAK'), 'مفتاح داخل aiAudit لا يتسرّب بالاسم');
  ok(!serialized.includes('leak-canary-9f3c'), 'قيمة داخل aiAudit لا تتسرّب بالمحتوى');
  ok(!serialized.includes('measuredCategoriesMean'), 'حقل audit معروف (measuredCategoriesMean) غائب تماماً عن الاستجابة');
  ok(!serialized.includes('ROOT_DETECTED') , 'gatesApplied من audit لا يصل — (القرار ٤: يُحفَظ ولا يُعرض)');

  // ─── القائمة البيضاء نفسها — توثيق صريح لِما يمرّ فعلاً، كي تصبح أي
  // إضافة مستقبلية لحقل جديد قراراً واعياً لا تسرّباً صامتاً.
  const TOP_LEVEL_ALLOW_LIST = [
    'scanId', 'shortId', 'deviceModel', 'deviceMarketingName', 'grade', 'score',
    'date', 'language', 'isFreeTrial', 'verified', 'summary', 'verdict',
    'issueCount', 'aiResponse',
  ];
  eq(new Set(Object.keys(response)).size, TOP_LEVEL_ALLOW_LIST.length,
      `عدد مفاتيح response الفعلي (${Object.keys(response).length}) يطابق القائمة البيضاء الموثَّقة هنا (${TOP_LEVEL_ALLOW_LIST.length}) — أي حقل جديد يجب أن يُضاف هنا عمداً بعد مراجعة (لا يمرّ صامتاً)`);
  for (const k of Object.keys(response)) {
    ok(TOP_LEVEL_ALLOW_LIST.includes(k), `المفتاح "${k}" ضمن القائمة البيضاء الموثَّقة`);
  }
}
console.log('تحقّق: verifyReport لا يُرجع aiAudit إطلاقاً — لا على المستوى الأعلى ولا داخل aiResponse، مُثبَت بتشغيل فعلي لمنطق بناء الاستجابة');

console.log(`\nverifyReportAuditExclusion.test.js: ${n}/${n} assertions passed`);

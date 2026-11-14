#!/usr/bin/env node
'use strict';

// ===================================================================
// fetch-functional-results-golden — يجلب rawFingerprint.functionalResults
// من مستندات reports/{scanId} في Firestore للفحوص الأربعة التي تملك
// فِخاخاً ذهبية في functions/test/fixtures/golden/ (footer/header/samples/
// variables) لكنها لا تحمل functionalResults — سدّاً للفجوة 2 (UNSTABLE
// بلا اختبار ذهبي).
//
// القراءة REST + gcloud auth print-access-token. V8 نقل الخامّ (الجزء ٢، 2026-10-09):
// rawFingerprint صار في reportRaw/{scanId} للتقارير الجديدة والمُرحَّلة (ومضمَّناً في
// تقرير لم يُرحَّل بعد)، فالقراءة تمرّ بـfetchReportWithRawRest (scripts/lib/
// reportRawReaders.js: واجهة collection().doc().get() فوق REST تمرّ بها readReportRaw
// نفسها)، وحالة الخامّ الصريحة (PRIVATE | EMBEDDED_LEGACY | ABSENT) تُطبع لكل فحص.
// ملفّ المخرَج functionalResults-by-scanid.json لم يتغيّر شكله (يقرؤه اختبار ذهبي).
//
// ─── القيود ─────────────────────────────────────────────────────────────
//   • قراءة فقط (GET). لا PATCH ولا POST ولا حذف على أي مستند.
//   • لا يلمس functions/test/fixtures/golden/*.ts.json الحالية إطلاقاً —
//     يكتب ملفّاً جديداً بجوارها فقط: functionalResults-by-scanid.json.
//   • لا يبني حمولة DeepSeek ولا يستدعي أي نموذج — هذا استخراج حقل واحد
//     من مستند مخزون، لا إعادة تحليل.
//
// Usage:
//   node functions/scripts/fetch-functional-results-golden.js

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {fetchReportWithRawRest} = require('./lib/reportRawReaders');

const PROJECT = 'neuralchek-9b6d7';
const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const OUT_FILE = path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json');

// نفس أربعة الفحوص المذكورة في golden/README.md (القائمة نفسها، لا تغيير).
const SCAN_IDS = [
  'b45c8cf6-e376-4765-8703-f68e9bc69844',
  '34dff2b8-ce9e-4b40-86a9-1976c878e195',
  '8909e850-b10c-466c-899a-ce97cb5c4fbe',
  'e4b65a2f-3a0c-4f11-939d-17eab7d0912f',
];

const GCLOUD = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

function gcloudToken() {
  return execFileSync(GCLOUD, ['auth', 'print-access-token'],
      {shell: process.platform === 'win32'}).toString().trim();
}

/**
 * التقرير بالشكل المضمَّن (المقروء + الخامّ) وحالة الخامّ الصريحة. قراءة فقط.
 * @param {string} scanId
 * @return {Promise<{cur: Object, rawState: string}>}
 */
async function fetchReportDoc(scanId) {
  const {merged, rawRead} = await fetchReportWithRawRest({project: PROJECT, getToken: gcloudToken, scanId});
  return {cur: merged, rawState: rawRead.state};
}

(async () => {
  console.log(`═══ fetch-functional-results-golden (project=${PROJECT}, قراءة فقط) ═══`);
  const byScanId = {};

  for (const scanId of SCAN_IDS) {
    console.log(`[fetch][${scanId}] جلب المستند من Firestore...`);
    let cur;
    try {
      let rawState;
      ({cur, rawState} = await fetchReportDoc(scanId));
      console.log(`[fetch][${scanId}] rawState=${rawState}`);
      if (rawState === 'ABSENT') {
        console.error(`[fetch][${scanId}] ✗ الخامّ ABSENT (لا reportRaw ولا rawFingerprint مضمَّن) — يُكتَب null.`);
        byScanId[scanId] = null;
        continue;
      }
    } catch (err) {
      console.error(`[fetch][${scanId}] ✗ فشل الجلب: ${err.message || err}`);
      byScanId[scanId] = null;
      continue;
    }
    const fr = (cur.rawFingerprint && cur.rawFingerprint.functionalResults) || null;

    if (!Array.isArray(fr)) {
      console.error(`[fetch][${scanId}] ✗ لا functionalResults مصفوفة في ` +
          `rawFingerprint (typeof=${typeof fr}) — يُكتَب null، يجب فحص هذا يدوياً.`);
      byScanId[scanId] = null;
      continue;
    }

    byScanId[scanId] = fr;
    console.log(`[fetch][${scanId}] ✓ functionalResults: ${fr.length} عنصراً. ` +
        `storedGrade=${cur.grade}/${cur.score}`);
    for (const testId of ['C-04', 'S-04', 'S-05', 'C-03', 'S-06']) {
      const entry = fr.find((r) => r && r.testId === testId);
      if (entry) {
        console.log(`    ${testId}: status=${entry.status} rawValue=${entry.rawValue} ` +
            `rawValueUnit=${entry.rawValueUnit} categoryName=${entry.categoryName}`);
      } else {
        console.log(`    ${testId}: absent from functionalResults`);
      }
    }
  }

  fs.mkdirSync(GOLDEN_DIR, {recursive: true});
  const record = {
    _source: 'Firestore reports/{scanId}.rawFingerprint.functionalResults — قراءة فعلية ' +
        `عبر functions/scripts/fetch-functional-results-golden.js، project=${PROJECT}`,
    _fetchedAt: new Date().toISOString(),
    _note: 'يُضاف بجوار الفِخاخ الذهبية الحالية (footer/header/samples/variables) — لا يعدّلها ' +
        'ولا يستبدلها (سدّ الفجوة 2: UNSTABLE بلا اختبار ذهبي على functionalResults).',
    byScanId,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(record, null, 2), 'utf-8');
  console.log(`\n✓ كُتب ${OUT_FILE}`);
})().catch((e) => {
  console.error('\n✗ توقّف بخطأ:', e.message || e);
  process.exit(1);
});

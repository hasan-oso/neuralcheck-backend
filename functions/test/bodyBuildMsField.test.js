'use strict';

// bodyBuildMsField.test.js — precomputeMs -> bodyBuildMs rename (task A65,
// 2026-09-21, base HEAD daaf006).
//
// `precomputeMs` measured the time to build the outgoing `body` object
// (incl. rawFingerprintForAi) and JSON.stringify it — never a precompute
// step; V6 has none. The name was kept for back-compat until the data
// contract was checked (NeuralChek app + wepsite: zero references to either
// name; verifyReport.js allow-list does not include it either), which
// cleared the way to rename it to what it actually measures.
//
// Firestore documents written BEFORE this change still carry
// `v5Metrics.precomputeMs`. They are NOT migrated (out of scope — see
// callAI.js:167-174 and runAnalysisInternal.js's v5Metrics comment). This
// test only guards the live pipeline going forward: new writes must carry
// `bodyBuildMs`, and the old name must not silently reappear.
//
// تحديث 2026-09-23 +03 (أمر التبديل، القاعدة 23): كان يكعّب callAI (V6) —
// المسار الحيّ الآن resolveV7Report وحده. bodyBuildMs يصل v5Metrics من
// resolveV7Report.bodyBuildMs (runAnalysisInternal.js، القسم "2. تحليل AI"
// الجديد) لا من callAI.aiAnalysis. الفحص السلوكي نفسه (الاسم الجديد يصل،
// القديم لا يظهر) بلا تغيير — فقط مصدر الكعب ومسار القراءة يطابقان الآن
// المسار الحيّ الفعلي.
//
// Run: node functions/test/bodyBuildMsField.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ─── كعب utils/admin: لا Firestore ───────────────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => {
      throw new Error('Firestore must not be touched by this test');
    }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعب resolveV7Report — المسار الحيّ الوحيد بعد التبديل ─────────────
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
require.cache[resolveV7ReportPath] = {
  id: resolveV7ReportPath, filename: resolveV7ReportPath, loaded: true,
  exports: {
    resolveV7Report: async () => ({
      display: {overall: {letter: 'A'}, narrativeIncomplete: false, narrativeIncompleteFields: []},
      audit: {gatesApplied: [], adjustments: [], regeneration: {attempts: 1, rounds: []}},
      aiModel: 'deepseek-flash',
      duration: 1000,
      pipeline: 'v7_findings_based',
      bodyBuildMs: 3,
      guardFinal: {ok: true},
      rawResponseLog: [],
    }),
  },
};

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');

const fingerprint = {device: {model: 'SM-G977B', manufacturer: 'samsung'}};

/** @return {Promise<Object>} النتيجة */
async function run() {
  const realLog = console.log;
  console.log = () => {};
  try {
    return await runAnalysisInternal({
      fingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
      scanContext: {},
    });
  } finally {
    console.log = realLog;
  }
}

(async () => {
  // ─── 1. الاسم الجديد يصل v5Metrics بقيمته ──────────────────────────
  {
    const out = await run();
    assert.ok(
        Object.prototype.hasOwnProperty.call(out.v5Metrics, 'bodyBuildMs'),
        'v5Metrics must carry the new name bodyBuildMs');
    assert.strictEqual(out.v5Metrics.bodyBuildMs, 3,
        'bodyBuildMs must pass callAI\'s value through unchanged');
  }

  // ─── 2. الاسم القديم لا يظهر على المسار الحيّ ──────────────────────
  {
    const out = await run();
    assert.ok(
        !Object.prototype.hasOwnProperty.call(out.v5Metrics, 'precomputeMs'),
        'v5Metrics must NOT carry the retired name precomputeMs on a ' +
        'fresh write — only pre-rename Firestore documents have it');
  }

  // ─── 3. المصدر: precomputeMs لم يعد معرَّفاً حيّاً في مسار الحساب ───
  //
  // التعليقات التاريخية (تشرح إعادة التسمية والمستندات القديمة) مقصودة
  // ويجب أن تبقى — الفحص هنا على كود حيّ فقط، لا على أسطر '//'.
  {
    for (const f of ['resolveV7Report.js', 'runAnalysisInternal.js']) {
      const src = fs.readFileSync(
          path.join(__dirname, '..', 'src', 'analysis', f), 'utf8');
      const liveCode = src.split('\n')
          .filter((l) => !l.trim().startsWith('//'))
          .join('\n');
      assert.ok(!/\bprecomputeMs\b/.test(liveCode),
          `${f} must not declare/read/return precomputeMs as live code ` +
          '(comments documenting the old name are fine, live code is not)');
      assert.ok(/\bbodyBuildMs\b/.test(liveCode),
          `${f} must use the new name bodyBuildMs in live code`);
    }
  }

  console.log('bodyBuildMsField: 3/3 sections passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

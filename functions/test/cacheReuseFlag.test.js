'use strict';

// cacheReuseFlag.test.js — راية settings/cache.reuseEnabled تتحكّم بإعادة
// استخدام تقرير سابق (P0.5، PLAN-01-ROADMAP.md المرحلة ٠).
//
// قبل هذا التغيير: `diffRatio < 0.20` وحده (مع عدم فرض إعادة تقييم) كان
// يكفي لإعادة تقرير قديم، بحشو نوم 45 ثانية (padCacheHitToTarget) كي يبدو
// زمن الاستجابة كفحص طازج — ادّعاء كاذب أن الفحص تحليل جديد (S§2.7؛ A79
// في NEURALCHECK-FINDINGS.md).
//
// بعده: راية resolveCacheConfig (DEFAULT_REUSE_ENABLED=false) معطّلة
// افتراضياً أثناء التجربة الميدانية الجارية — كل فحص يُحلَّل من جديد بصرف
// النظر عن diffRatio، ولا حشو إطلاقاً (الدالّة أُزيلت من الكود، لا عُطِّلت).
// تفعيل الراية صراحة في مستند settings/cache يُعيد سلوك إعادة الاستخدام،
// مع حقل جديد لم يكن موجوداً من قبل: aiResult.reusedFromScanId — كي تعرضه
// الواجهة لاحقاً (P1.5، خارج نطاق هذا المستودع) بدل الصمت عن إعادة الاستخدام.
//
// «فحصان متتاليان لجهاز واحد» بنص الخارطة هو تحقّق ميداني مؤجَّل (القاعدة
// ١٩)؛ هذا اختبار وحدة يثبت نفس السلوك من الكود مباشرة، بكعوب لا بشبكة.
//
// Run: node functions/test/cacheReuseFlag.test.js

const assert = require('assert');

// ─── بصمة صحّية ثابتة: فحصان بهذه البصمة نفسها → diffRatio=0، بلا عيب ───
// (نفس بنية fp() في reevaluation.test.js، لأن computeScanSignature الحقيقي
// يُستعمَل هنا بلا تعكيب.)
function fp() {
  return {
    device: {model: 'TEST-DEVICE', deviceProfileKey: {a: 'a'.repeat(20)}},
    timeSeries: {
      footer: {
        verificationResults: {
          cpuPrimeSieveCorrect: true, memoryMarchPassed: true,
          memoryWalkingOnesPassed: true, gpuComputeGemmCorrect: true,
          criticalDefectDetected: false, cpuFmaErrors: 0,
          memoryRandomVerifyErrors: 0, storageWriteVerifyErrors: 0,
          storageReadVerifyErrors: 0,
        },
        stressEffectiveness: {passedSaturationThreshold: true},
        dataQuality: {},
        batteryHealth: {
          designCapacityMah: 5000, cycleCount: 200,
          voltageStabilityMv: 30, dischargeRateUnderLoadMa: 2500,
          batteryTempRiseC: 5,
        },
      },
    },
    functionalResults: [],
    manualResults: [],
  };
}

const OLD_SCAN_ID = 'prev-scan-id';
const OLD_REPORT_AI_RESPONSE = {grade: 'B', score: 80, summary: 'قديم'};

let settingsCacheDoc; // undefined = المستند غير موجود → الافتراضي (معطّل)
let freshCallCount;

/**
 * يُعيد تحميل runAnalysisInternal الحقيقي (غير مكعوب) مع كعوب جديدة
 * لـ admin/db، findDeviceProfile، وcallAI. إعادة الحذف من require.cache
 * في كل استدعاء تضمن أن resolveCacheConfig يبدأ بكاش داخلي فارغ لكل قسم
 * اختبار (لا تسرّب TTL بين الأقسام الثلاثة أدناه).
 * @return {Function} runAnalysisInternal الحقيقي
 */
function loadRunAnalysisInternal() {
  const adminPath = require.resolve('../src/utils/admin');
  const findDevicePath = require.resolve('../src/profiles/findDeviceProfile');
  const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
  const cacheConfigPath = require.resolve('../src/utils/resolveCacheConfig');
  const runPath = require.resolve('../src/analysis/runAnalysisInternal');

  for (const p of [adminPath, findDevicePath, resolveV7ReportPath, cacheConfigPath, runPath]) {
    delete require.cache[p];
  }

  require.cache[adminPath] = {
    id: adminPath, filename: adminPath, loaded: true, exports: {
      admin: {},
      db: {
        // resolveCacheConfig هو المستدعي الوحيد لـ db.collection() على هذا
        // المسار (findDeviceProfile مكعوب بالكامل أدناه).
        collection: (name) => {
          assert.strictEqual(name, 'settings', 'cache config collection name');
          return {
            doc: (d) => {
              assert.strictEqual(d, 'cache', 'cache config doc name');
              return {
                get: async () => ({
                  exists: settingsCacheDoc !== undefined,
                  data: () => settingsCacheDoc,
                }),
              };
            },
          };
        },
        // مسار قراءة التقرير القديم عند إعادة الاستخدام: db.doc(reportRef).
        doc: (path) => ({
          get: async () => ({
            exists: path === `reports/${OLD_SCAN_ID}`,
            data: () => ({aiResponse: OLD_REPORT_AI_RESPONSE}),
          }),
        }),
      },
      ADMIN_EMAILS: [], requireAdmin: () => {},
    },
  };

  require.cache[findDevicePath] = {
    id: findDevicePath, filename: findDevicePath, loaded: true, exports: {
      findDeviceProfile: async () => {
        // computeScanSignature الحقيقي (غير مكعوب) — نفس التوقيع الذي
        // سينتجه الفحص الجديد، فـ diffRatio = 0.
        const {computeScanSignature} =
            require('../src/signatures/computeScanSignature');
        return {
          profileId: 'test-profile',
          matchedBy: 'primary',
          data: {
            scanHistory: [{
              scanId: OLD_SCAN_ID,
              reportRef: `reports/${OLD_SCAN_ID}`,
              scanDate: new Date(),
              signature: computeScanSignature(fp()),
            }],
          },
        };
      },
    },
  };

  // تحديث 2026-09-23 +03 (أمر التبديل، القاعدة 23): callAI (V6) لم تعد
  // تُستدعى — resolveV7Report هي المسار الحيّ. الضمانة نفسها (النموذج لا
  // يُستدعى إطلاقاً حين تُصيب الكاش) تنتقل معه.
  require.cache[resolveV7ReportPath] = {
    id: resolveV7ReportPath, filename: resolveV7ReportPath, loaded: true, exports: {
      resolveV7Report: async () => {
        freshCallCount++;
        return {
          display: {overall: {letter: 'A'}, narrativeIncomplete: false, narrativeIncompleteFields: []},
          audit: {gatesApplied: [], adjustments: [], regeneration: {attempts: 1, rounds: []}},
          aiModel: 'deepseek-flash',
          duration: 1234,
          pipeline: 'v7_findings_based',
          bodyBuildMs: 1,
          guardFinal: {ok: true},
          rawResponseLog: [],
        };
      },
    },
  };

  return require(runPath).runAnalysisInternal;
}

/**
 * يُشغّل فحصاً واحداً، مع كتم السجلّ (الكود يطبع كثيراً عمداً — انظر
 * تعليقات [cache]/[ScanCompare] في runAnalysisInternal.js).
 * @param {Function} runAnalysisInternal الدالّة المطلوب اختبارها
 * @return {Promise<Object>} نتيجة runAnalysisInternal
 */
async function scan(runAnalysisInternal) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await runAnalysisInternal({
      fingerprint: fp(),
      language: 'ar',
      deepseekKey: 'k',
      geminiKey: 'g',
      scanContext: {scanId: 'new-scan-id'},
    });
  } finally {
    console.log = real.log;
    console.warn = real.warn;
    console.error = real.error;
  }
}

(async () => {
  // ─── 1. الراية مُطفأة (الافتراضي، لا مستند settings/cache) ───────────
  // فحصان متتاليان لنفس البصمة → كلاهما يستدعي النموذج، cacheHit=false
  // مرّتين، وcachePaddingMs غائب تماماً (نص التحقّق في P0.5 حرفياً).
  {
    settingsCacheDoc = undefined;
    freshCallCount = 0;
    const runAnalysisInternal = loadRunAnalysisInternal();

    const first = await scan(runAnalysisInternal);
    const second = await scan(runAnalysisInternal);

    assert.strictEqual(freshCallCount, 2,
        'both scans must call the model — cache reuse is disabled by default');

    for (const [label, out] of [['first', first], ['second', second]]) {
      assert.strictEqual(out.pipeline, 'v7_findings_based',
          `${label}: pipeline must be the fresh path, not "cached"`);
      assert.strictEqual(out.v5Metrics.cacheHit, false,
          `${label}: v5Metrics.cacheHit must be false when reuse is disabled`);
      assert.ok(!Object.prototype.hasOwnProperty.call(out.v5Metrics, 'cachePaddingMs'),
          `${label}: cachePaddingMs must be entirely absent, not null/undefined-but-present`);
      assert.ok(!out.aiResult.reusedFromScanId,
          `${label}: reusedFromScanId must not appear on a freshly analyzed report`);
      assert.ok(/^reuse_disabled/.test(out.v5Metrics.cacheReason),
          `${label}: cacheReason must name the disabled flag, got "${out.v5Metrics.cacheReason}"`);
    }
  }

  // ─── 2. قيمة فاسدة في المستند (ليست boolean) → تسقط إلى معطّل أيضاً ──
  {
    settingsCacheDoc = {reuseEnabled: 'yes'}; // خطأ نوع
    freshCallCount = 0;
    const runAnalysisInternal = loadRunAnalysisInternal();

    const out = await scan(runAnalysisInternal);
    assert.strictEqual(freshCallCount, 1,
        'a malformed flag value must fail SAFE to disabled, not silently enable reuse');
    assert.strictEqual(out.v5Metrics.cacheHit, false);
    assert.ok(/^reuse_disabled\(default_rejected_value\)/.test(out.v5Metrics.cacheReason),
        `cacheReason must show the rejected-value source, got "${out.v5Metrics.cacheReason}"`);
  }

  // ─── 3. الراية مُفعَّلة صراحة → يعود سلوك إعادة الاستخدام، بلا حشو ────
  // ومع reusedFromScanId — حقل لم يكن موجوداً قبل P0.5.
  {
    settingsCacheDoc = {reuseEnabled: true};
    freshCallCount = 0;
    const runAnalysisInternal = loadRunAnalysisInternal();

    const startedAt = Date.now();
    const out = await scan(runAnalysisInternal);
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(freshCallCount, 0,
        'the model must NOT be called when the flag enables reuse and drift is below threshold');
    assert.strictEqual(out.pipeline, 'cached');
    assert.strictEqual(out.aiModel, 'cached_signature_match');
    assert.strictEqual(out.v5Metrics.cacheHit, true);
    assert.strictEqual(out.v5Metrics.cacheReason, 'hit');
    assert.ok(!Object.prototype.hasOwnProperty.call(out.v5Metrics, 'cachePaddingMs'),
        'cachePaddingMs must stay absent even on a reused report — padCacheHitToTarget no longer exists');
    assert.ok(elapsedMs < 2000,
        `a reused report must return near-instantly (no 45s pad), took ${elapsedMs}ms`);

    assert.strictEqual(out.aiResult.reusedFromScanId, OLD_SCAN_ID,
        'the reused report must carry reusedFromScanId so the UI can display it (P1.5)');
    assert.strictEqual(out.aiResult.grade, OLD_REPORT_AI_RESPONSE.grade,
        'the reused report content must be the OLD report, unchanged');
    assert.strictEqual(out.aiResult._wasReused, true,
        'the pre-existing _wasReused marker must still be set');
  }

  // ─── 4. الدالّتان القديمتان لم تعودا مُصدَّرتين إطلاقاً ───────────────
  {
    const runExports = require('../src/analysis/runAnalysisInternal');
    assert.strictEqual(runExports.padCacheHitToTarget, undefined,
        'padCacheHitToTarget must be removed, not merely unused');
    assert.strictEqual(runExports.CACHED_RESPONSE_TARGET_MS, undefined,
        'CACHED_RESPONSE_TARGET_MS must be removed, not merely unused');
  }

  console.log('cacheReuseFlag: 4/4 sections passed');
})().catch((e) => {
  console.error('cacheReuseFlag test failed:', e);
  process.exit(1);
});

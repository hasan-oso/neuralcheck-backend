'use strict';

// serverRawSamplesStorage.test.js — القرار ٨٦ البند ٢ (نصّ الأمر حرفياً):
// "analyzeDevice يكتب ما استلمه من عيّنات كما استلمه، في كل فحص، إلى
// مسار في Storage منفصل عن مسار رفع التطبيق... اختبار: الحساب من نسخة
// الخادم يطابق الحساب من الفخّ في العيّنات الذهبية، حرفاً وحالة."
//
// ثلاث كتل:
//   1. computeServerSamplesStoragePath — دالّة نقيّة، حتمي.
//   2. saveServerRawSamples — بكعب bucket (صفر شبكة، صفر Storage حقيقي):
//      نجاح، فشل bucket.file().save() (لا يرمي، يُعيد saved:false)،
//      scanId غائب، samples غائبة/فارغة.
//   3. **تكافؤ كامل (استُبدل — القاعدة 23 — عن نسخة سابقة كانت تقارن
//      البطارية وحدها، أمر مستخدم 2026-09-25 +03)**: محاكاة الإنتاج
//      الكاملة — fingerprint كامل → lightenFingerprintForStorage الحقيقية
//      (ما يُكتب فعلياً في rawFingerprint) + saveServerRawSamples (ما
//      يُحفَظ في Storage) → إعادة بناء fingerprint من الاثنين معاً →
//      computeFindings/computeCategoryStates كاملتين، مقارنَتين بالحساب
//      المباشر من الفخّ الأصلي: الفئات الخمس عشرة (state/deterministicLetter)
//      وoverall (letter/letterSource/coverage) — مطابقة حرفياً، بلا فقد.
//
// Run: node functions/test/serverRawSamplesStorage.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  SERVER_SAMPLES_STORAGE_PATH_FIELD, SERVER_SAMPLES_SAVED_FIELD,
  computeServerSamplesStoragePath, saveServerRawSamples,
} = require('../src/analysis/serverRawSamplesStorage');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {CATEGORIES} = require('../src/utils/categories');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ═══════════════════════════════════════════════════════════════════════
// 0. أسماء الحقلين — مصدر واحد مُصدَّر (القاعدة 24)
// ═══════════════════════════════════════════════════════════════════════
eq(SERVER_SAMPLES_STORAGE_PATH_FIELD, 'serverSamplesStoragePath', 'اسم حقل المسار مُصدَّر');
eq(SERVER_SAMPLES_SAVED_FIELD, 'serverSamplesSaved', 'اسم حقل النجاح مُصدَّر');

// ═══════════════════════════════════════════════════════════════════════
// 1. computeServerSamplesStoragePath — نقيّة
// ═══════════════════════════════════════════════════════════════════════
eq(computeServerSamplesStoragePath('abc-123'), 'serverSamples/abc-123.json.gz',
    'مسار: serverSamples/{scanId}.json.gz حرفياً');
eq(computeServerSamplesStoragePath(''), null, 'scanId فارغ (بعد trim) → null');
eq(computeServerSamplesStoragePath('   '), null, 'scanId بياض فقط → null');
eq(computeServerSamplesStoragePath(null), null, 'scanId=null → null');
eq(computeServerSamplesStoragePath(undefined), null, 'scanId=undefined → null');
eq(computeServerSamplesStoragePath(123), null, 'scanId رقم لا نصّ → null (لا تحويل ضمنيّ)');
// منفصل فعلياً عن مسار رفع التطبيق (scans/{fingerprint}/{scanId}.ts.json.gz)
// — مقطع أوّل مختلف كلّياً، لا نفس البادئة بأي طول.
ok(!computeServerSamplesStoragePath('x').startsWith('scans/'),
    'المسار الجديد لا يبدأ بـ"scans/" — منفصل عن مسار رفع التطبيق');

// ═══════════════════════════════════════════════════════════════════════
// 2. saveServerRawSamples — بكعب bucket، صفر شبكة
// ═══════════════════════════════════════════════════════════════════════
function makeFakeBucket({throwOnSave = false} = {}) {
  const saved = {};
  return {
    saved,
    file(p) {
      return {
        save: async (buf, opts) => {
          if (throwOnSave) throw Object.assign(new Error('عطب GCS اصطناعي'), {code: 403});
          saved[p] = {buf, opts};
        },
      };
    },
  };
}

(async function main() {
  // ─── نجاح ──────────────────────────────────────────────────────────
  {
    const bucket = makeFakeBucket();
    const samples = [{phase: 0, ts: 1, v: [1, 2, 3]}, {phase: 1, ts: 2, v: [4, 5, 6]}];
    const result = await saveServerRawSamples({bucket, scanId: 'scan-1', samples});
    eq(result.path, 'serverSamples/scan-1.json.gz', 'نجاح: path صحيح');
    eq(result.saved, true, 'نجاح: saved=true');
    ok(!!bucket.saved['serverSamples/scan-1.json.gz'], 'نجاح: bucket.file(path).save() استُدعيت فعلياً بنفس المسار');
    const captured = bucket.saved['serverSamples/scan-1.json.gz'];
    eq(captured.opts.contentType, 'application/json', 'نجاح: contentType=application/json');
    eq(captured.opts.metadata.contentEncoding, 'gzip', 'نجاح: metadata.contentEncoding=gzip');
    const recovered = JSON.parse(zlib.gunzipSync(captured.buf).toString('utf-8'));
    assert.deepStrictEqual(recovered, samples, 'نجاح: المحتوى المحفوظ (بعد فكّ الضغط) مطابق حرفياً لِـsamples كما وصلت — بلا أي تحويل');
    n++;
  }

  // ─── فشل bucket.file().save() — لا يرمي، يُعيد saved:false ──────────
  {
    const bucket = makeFakeBucket({throwOnSave: true});
    const samples = [{phase: 0, ts: 1, v: [1]}];
    let threw = false;
    let result;
    try {
      result = await saveServerRawSamples({bucket, scanId: 'scan-2', samples});
    } catch (e) {
      threw = true;
    }
    ok(!threw, 'فشل الحفظ لا يرمي — نصّ الأمر: "فشل الحفظ لا يُفشل التحليل"');
    eq(result.path, 'serverSamples/scan-2.json.gz', 'فشل: path حاضر رغم الفشل (نُعِلم أين حاول الحفظ)');
    eq(result.saved, false, 'فشل: saved=false صراحة (القاعدة 22 — لا نجاح مُختلَق)');
  }

  // ─── scanId غائب ─────────────────────────────────────────────────────
  {
    const bucket = makeFakeBucket();
    const result = await saveServerRawSamples({bucket, scanId: null, samples: [{v: [1]}]});
    eq(result.path, null, 'scanId غائب: path=null');
    eq(result.saved, false, 'scanId غائب: saved=false');
    eq(Object.keys(bucket.saved).length, 0, 'scanId غائب: لا نداء save() إطلاقاً');
  }

  // ─── samples غائبة (فحص بلا timeSeries) ──────────────────────────────
  {
    const bucket = makeFakeBucket();
    const result = await saveServerRawSamples({bucket, scanId: 'scan-3', samples: undefined});
    eq(result.path, 'serverSamples/scan-3.json.gz', 'samples غائبة: path محسوب رغم ذلك (معلوماتي)');
    eq(result.saved, false, 'samples غائبة: saved=false — لا مصفوفة فارغة تُكتب بصمت كنجاح');
    eq(Object.keys(bucket.saved).length, 0, 'samples غائبة: لا نداء save() إطلاقاً');
  }

  // ─── samples مصفوفة فارغة فعلاً ──────────────────────────────────────
  {
    const bucket = makeFakeBucket();
    const result = await saveServerRawSamples({bucket, scanId: 'scan-4', samples: []});
    eq(result.saved, false, 'samples=[]: saved=false (لا شيء لحفظه فعلياً)');
  }

  console.log(`تحقّق 2: saveServerRawSamples — نجاح/فشل GCS/scanId غائب/samples غائبة أو فارغة، كلّها بلا شبكة حقيقية`);

  // ═══════════════════════════════════════════════════════════════════
  // 3. **استُبدل لا أُضيف (القاعدة 23)** — أمر مستخدم 2026-09-25 +03: "واختبارك
  // serverRawSamplesStorage.test.js يطابق البطارية وحدها. ونسختك تحفظ samples
  // وحدها، والباقي من السلسلة (header وvariables وfooter) في
  // reports.rawFingerprint.timeSeries بعد lightenFingerprintForStorage.
  // فالمطلوب: يُعاد بناء timeSeries من المستند المخفَّف ونسخة الخادم معاً،
  // ثم computeFindings وcomputeCategoryStates كاملين. ويُطابَقان بالحساب
  // المباشر من الفخّ: الفئات الخمس عشرة كلّها (state وdeterministicLetter)،
  // وoverall (letter وletterSource وcoverage)."
  //
  // المسار الكامل المحاكى هنا حرفياً كما يقع في الإنتاج فعلياً:
  //   ١. analyzeDevice يستلم fingerprint كاملاً (timeSeries.samples فيه).
  //   ٢. lightenFingerprintForStorage يحذف timeSeries.samples قبل الكتابة
  //      إلى Firestore (report.rawFingerprint) — header/footer/variables
  //      تبقى كما هي (lightenFingerprintForStorage.js:11 `{...ts}` نسخ
  //      سطحي، لا يمسّ أي حقل غير samples/samplesCount).
  //   ٣. saveServerRawSamples (بالتوازي) يحفظ fingerprint.timeSeries.samples
  //      نفسها — قبل الحذف — إلى Storage (serverSamplesStoragePath).
  //   ٤. إعادة البناء لاحقاً: rawFingerprint المخفَّف (من المستند) +
  //      samples المُستعادة (من Storage) → timeSeries كامل من جديد.
  // ═══════════════════════════════════════════════════════════════════
  {
    const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
    const {computeFindings} = require('../src/analysis/findings');

    const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
    const s10Raw = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'), 'utf8'));
    ok(Array.isArray(s10Raw.samples) && s10Raw.samples.length > 0,
        '[إعداد] b45c8cf6.ts.json.samples حقيقية وغير فارغة');
    const frMap = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json'), 'utf8')).byScanId;
    const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
    ok(Array.isArray(s10Functional) && s10Functional.length === 85,
        '[إعداد] functionalResults حقيقية لِـb45c8cf6 (85 عنصراً) — نفس فخّ categoryStates.test.js/buildV7Payload.test.js');

    // fingerprint الكامل كما يستلمه analyzeDevice فعلاً (نفس بنية fp في
    // categoryStates.test.js/buildV7Payload.test.js — device/timeSeries/
    // functionalResults/manualResults).
    const fullFingerprint = {
      device: {model: 'SM-G977B'},
      timeSeries: s10Raw.timeSeries || s10Raw,
      functionalResults: s10Functional,
      manualResults: [],
    };

    // ─── (أ) الحساب المباشر من الفخّ الكامل — بلا مرور بالتخزين إطلاقاً. ──
    const directFindings = computeFindings(fullFingerprint);
    const directInputs = sampleInputsFromRaw(fullFingerprint);
    const directCs = computeCategoryStates({
      functionalResults: s10Functional, manualResults: [], dev: null, findings: directFindings,
      batterySampleInputs: directInputs.sampleInputs, batteryDesignCapacityMah: directInputs.design,
    });

    // ─── (ب) محاكاة الإنتاج الكاملة ────────────────────────────────────
    // ٢. ما يُكتب فعلياً إلى Firestore (rawFingerprint المخفَّف) —
    // lightenFingerprintForStorage الحقيقية، لا محاكاة يدوية لسلوكها.
    const lightenedFingerprint = lightenFingerprintForStorage(fullFingerprint);
    ok(!('samples' in lightenedFingerprint.timeSeries),
        '[إعداد][محاكاة الإنتاج] rawFingerprint المخفَّف فعلاً بلا timeSeries.samples (lightenFingerprintForStorage الحقيقية)');
    eq(lightenedFingerprint.timeSeries.samplesCount, s10Raw.samples.length,
        '[إعداد][محاكاة الإنتاج] samplesCount محفوظ بدل samples (نفس العدد الحقيقي)');

    // ٣. ما يحفظه الخادم إلى Storage — samples الأصلية، قبل الحذف (نفس ما
    // يستلمه fullFingerprint.timeSeries.samples، لا نسخة من lightenedFingerprint
    // التي لم تعد تحملها أصلاً).
    const bucket = makeFakeBucket();
    const saveResult = await saveServerRawSamples({bucket, scanId: 'b45c8cf6-golden-roundtrip', samples: fullFingerprint.timeSeries.samples});
    eq(saveResult.saved, true, '[محاكاة الإنتاج] الحفظ نجح على عيّنة b45c8cf6 الحقيقية');
    const capturedBuf = bucket.saved[saveResult.path].buf;
    const recoveredSamples = JSON.parse(zlib.gunzipSync(capturedBuf).toString('utf-8'));
    eq(recoveredSamples.length, s10Raw.samples.length, '[محاكاة الإنتاج] عدد العيّنات المُستعادة من Storage مطابق (لا فقد ولا تكرار)');

    // ٤. إعادة البناء — rawFingerprint المخفَّف + samples المُستعادة معاً.
    // هذا بالضبط ما يجب أن يفعله أي قارئ مستقبلي (rehydrateReportSamples.js
    // مرشَّح طبيعي، غير موصول بهذا اليوم — راجع تقرير المهمّة) قبل تمرير
    // الناتج إلى computeFindings/computeCategoryStates.
    const reconstructedFingerprint = {
      ...lightenedFingerprint,
      timeSeries: {...lightenedFingerprint.timeSeries, samples: recoveredSamples},
    };
    ok(Array.isArray(reconstructedFingerprint.timeSeries.samples) &&
        reconstructedFingerprint.timeSeries.samples.length === s10Raw.samples.length,
    '[إعداد][إعادة البناء] fingerprint المُعاد بناؤه يحمل samples كاملة مجدَّداً');

    const reconstructedFindings = computeFindings(reconstructedFingerprint);
    const reconstructedInputs = sampleInputsFromRaw(reconstructedFingerprint);
    const reconstructedCs = computeCategoryStates({
      functionalResults: reconstructedFingerprint.functionalResults, manualResults: [], dev: null, findings: reconstructedFindings,
      batterySampleInputs: reconstructedInputs.sampleInputs, batteryDesignCapacityMah: reconstructedInputs.design,
    });

    // ─── المطابقة المطلوبة صراحةً: الفئات الخمس عشرة (state/deterministicLetter) ──
    for (const cat of CATEGORIES) {
      eq(reconstructedCs.categories[cat].state, directCs.categories[cat].state,
          `[القرار ٨٦-٢][تكافؤ كامل] categories.${cat}.state مطابق (${directCs.categories[cat].state})`);
      eq(reconstructedCs.categories[cat].deterministicLetter, directCs.categories[cat].deterministicLetter,
          `[القرار ٨٦-٢][تكافؤ كامل] categories.${cat}.deterministicLetter مطابق (${JSON.stringify(directCs.categories[cat].deterministicLetter)})`);
    }
    // ─── overall: letter/letterSource/coverage ──────────────────────────
    eq(reconstructedCs.overall.letter, directCs.overall.letter, `[القرار ٨٦-٢][تكافؤ كامل] overall.letter مطابق (${directCs.overall.letter})`);
    eq(reconstructedCs.overall.letterSource, directCs.overall.letterSource, `[القرار ٨٦-٢][تكافؤ كامل] overall.letterSource مطابق (${directCs.overall.letterSource})`);
    eq(reconstructedCs.overall.coverage, directCs.overall.coverage, `[القرار ٨٦-٢][تكافؤ كامل] overall.coverage مطابق (${directCs.overall.coverage})`);

    // ─── تحقّق أعمق (لا يُطلَب صراحةً لكن يُثبت "لا شيء آخر انحرف" —
    // القاعدة 30): batteryIndicators حرفياً + findings كاملة حرفياً. ──────
    assert.deepStrictEqual(reconstructedCs.categories.battery.batteryIndicators, directCs.categories.battery.batteryIndicators,
        '[القرار ٨٦-٢][تكافؤ كامل][أعمق] batteryIndicators مطابقة حرفياً');
    assert.deepStrictEqual(reconstructedFindings, directFindings,
        '[القرار ٨٦-٢][تكافؤ كامل][أعمق] computeFindings كاملة مطابقة حرفياً — لا حقل واحد انحرف عبر lighten+حفظ+استعادة');

    // ─── ما لا يُستعاد من الفخّ (نصّ الأمر: "وإن كان في الفخّ ما لا يُستعاد،
    // فاذكره") — فحص صريح لا افتراض: هل rawFingerprint المخفَّف يحمل كل
    // حقل آخر من timeSeries (header/footer/variables) حرفياً كما وصل؟ ────
    for (const key of Object.keys(fullFingerprint.timeSeries)) {
      if (key === 'samples') continue; // المُستعاد أعلاه بالفعل، ليس بالمساواة المرجعية
      assert.deepStrictEqual(lightenedFingerprint.timeSeries[key], fullFingerprint.timeSeries[key],
          `[القرار ٨٦-٢][لا فقد] timeSeries.${key} محفوظ حرفياً في rawFingerprint المخفَّف (غير samples، القاعدة نفسها)`);
    }
    ok(true, '[القرار ٨٦-٢][الخلاصة] لا شيء في هذا الفخّ لا يُستعاد — lightenFingerprintForStorage تحذف samples وحدها، وsaveServerRawSamples تحفظها كاملة؛ إعادة البناء بالدمج البسيط أعلاه كافية ولا فقد فيها');

    console.log(`تحقّق 3 [القرار ٨٦-٢][تكافؤ كامل]: b45c8cf6 — الفئات الـ15 + overall (letter=${directCs.overall.letter} letterSource=${directCs.overall.letterSource} coverage=${directCs.overall.coverage}) مطابقة حرفياً بين الحساب المباشر وإعادة البناء من (rawFingerprint المخفَّف + samples من Storage)`);
  }

  console.log(`\nserverRawSamplesStorage.test.js: ${n}/${n} assertions passed`);
})();

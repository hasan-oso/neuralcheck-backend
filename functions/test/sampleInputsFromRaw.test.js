'use strict';

// sampleInputsFromRaw.test.js — P1.4 (PLAN-01-ROADMAP.md §١٤ "A98"، البند
// الأوّل من القائمة الملزمة: "اكتب sampleInputsFromRaw في src/ لا في
// الاختبارات"). يختبر الملف الموحَّد src/analysis/sampleInputsFromRaw.js
// و src/analysis/rehydrateReportSamples.js (البند الثاني: تعميم نمط
// إعادة الجلب من Storage).
//
// Run: node functions/test/sampleInputsFromRaw.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {
  rehydrateFingerprintSamples,
  fetchSamplesFromStorage,
  rehydrateReportFingerprint,
} = require('../src/analysis/rehydrateReportSamples');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ═══════════════════════════════════════════════════════════════════════
// 1. sampleInputsFromRaw — على فِخّ حقيقي (b45c8cf6، S10، design=4400)
// ═══════════════════════════════════════════════════════════════════════
{
  const raw = loadJson('b45c8cf6.ts.json');
  const {sampleInputs, design} = sampleInputsFromRaw(raw);
  ok(sampleInputs !== null, 'b45c8cf6: sampleInputs غير null (عيّنات حقيقية موجودة)');
  eq(design, 4400, 'b45c8cf6: design=4400 من footer.batteryHealth.designCapacityMah');
  const ts = raw.timeSeries || raw;
  const samples = ts.samples || raw.samples;
  eq(sampleInputs.n, samples.length, 'b45c8cf6: n يطابق عدد العيّنات فعلياً');
  eq(sampleInputs.t.length, samples.length, 'b45c8cf6: t بنفس الطول');
  eq(sampleInputs.temp[0], samples[0].v[1], 'b45c8cf6: temp[0]=v[1] للعيّنة الأولى');
  eq(sampleInputs.volt[0], samples[0].v[2], 'b45c8cf6: volt[0]=v[2]');
  eq(sampleInputs.cur[0], samples[0].v[3], 'b45c8cf6: cur[0]=v[3]');
  eq(sampleInputs.lvl[0], samples[0].v[4], 'b45c8cf6: lvl[0]=v[4]');
  eq(sampleInputs.ph[0], samples[0].phase, 'b45c8cf6: ph[0]=phase الأولى');
}

// ═══════════════════════════════════════════════════════════════════════
// 2. sampleInputsFromRaw — حارس المصفوفة الفارغة/الغائبة (لا رمي، لا اختلاق)
// ═══════════════════════════════════════════════════════════════════════
{
  const r1 = sampleInputsFromRaw({});
  eq(r1.sampleInputs, null, 'كائن فارغ: sampleInputs=null لا استثناء');
  eq(r1.design, null, 'كائن فارغ: design=null');

  const r2 = sampleInputsFromRaw({timeSeries: {samples: []}});
  eq(r2.sampleInputs, null, 'samples=[] صراحة: sampleInputs=null لا مصفوفات فارغة مُختلَقة');

  const r3 = sampleInputsFromRaw(null);
  eq(r3.sampleInputs, null, 'raw=null: sampleInputs=null بلا رمي');

  const r4 = sampleInputsFromRaw(undefined);
  eq(r4.sampleInputs, null, 'raw=undefined: sampleInputs=null بلا رمي');
}

// ═══════════════════════════════════════════════════════════════════════
// 3. sampleInputsFromRaw — صيغة مسطَّحة {samples, footer} (بلا timeSeries)
//    — يطابق شكل بعض ملفّات rebuld/ المنقولة (raw.samples مباشرة).
// ═══════════════════════════════════════════════════════════════════════
{
  const raw = loadJson('e4b65a2f-honor.ts.json');
  const ts = raw.timeSeries || raw;
  const flatRaw = {samples: ts.samples, footer: ts.footer};
  const nested = sampleInputsFromRaw(raw);
  const flat = sampleInputsFromRaw(flatRaw);
  eq(flat.sampleInputs.n, nested.sampleInputs.n, 'الصيغة المسطَّحة تُنتج نفس n كالمتداخلة');
  eq(flat.design, nested.design, 'الصيغة المسطَّحة تُنتج نفس design كالمتداخلة');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. تحقّق تكافؤ — نفس القيم التي كانت الاختبارات الذهبية تنتجها بنسختيها
//    القديمتين المكرَّرتين (categoryStates.test.js وbatteryLayer.test.js)
//    قبل التوحيد. يضمن أن التوحيد لم يغيّر السلوك على الفِخاخ الأربعة.
// ═══════════════════════════════════════════════════════════════════════
for (const name of ['8909e850-s10.ts.json', 'b45c8cf6.ts.json', '34dff2b8.ts.json', 'e4b65a2f-honor.ts.json']) {
  const raw = loadJson(name);
  const {sampleInputs, design} = sampleInputsFromRaw(raw);
  ok(sampleInputs !== null, `${name}: sampleInputs محسوب`);
  ok(Array.isArray(sampleInputs.temp) && Array.isArray(sampleInputs.volt) &&
      Array.isArray(sampleInputs.cur) && Array.isArray(sampleInputs.lvl),
  `${name}: أربعة أعمدة بطارية كمصفوفات`);
  ok(design === null || typeof design === 'number', `${name}: design رقم أو null، لا نوع آخر`);
}
console.log(`تحقّق 1-4: sampleInputsFromRaw موحَّدة في src/ — ${n} فحصاً`);

// ═══════════════════════════════════════════════════════════════════════
// 5. rehydrateFingerprintSamples — دمج نقي (نفس نمط regenerate-report.js:301-306)
// ═══════════════════════════════════════════════════════════════════════
{
  // مستند مخزون نموذجي: rawFingerprint بلا samples (lightenFingerprintForStorage)،
  // مع حقول أخرى (header/footer/functionalResults) يجب أن تبقى كما هي.
  const storedRawFingerprint = {
    timeSeries: {
      header: {scanId: 'x', deviceModel: 'S10'},
      footer: {fieldsVersion: 67},
      // لا samples هنا — lightenFingerprintForStorage حذفتها
      samplesCount: 1500,
    },
    functionalResults: [{testId: 'SEC-04', status: 'fail'}],
    device: {model: 'SM-G977B'},
  };
  const fetchedSamples = [{v: [0, 1, 2, 3, 4], phase: 0}, {v: [100, 1, 2, 3, 4], phase: 0}];

  const rehydrated = rehydrateFingerprintSamples(storedRawFingerprint, fetchedSamples);

  eq(rehydrated.timeSeries.samples, fetchedSamples, 'العيّنات المُعاد جلبها مدموجة في timeSeries.samples');
  eq(rehydrated.timeSeries.header.scanId, 'x', 'header يبقى كما كان (لا استبدال بنسخة Storage الأغنى)');
  eq(rehydrated.timeSeries.footer.fieldsVersion, 67, 'footer يبقى كما كان');
  eq(rehydrated.timeSeries.samplesCount, 1500, 'samplesCount (حقل lighten) يبقى — لا حذف صامت لحقول أخرى');
  eq(rehydrated.functionalResults.length, 1, 'functionalResults على مستوى الجذر يبقى كما هو');
  eq(rehydrated.device.model, 'SM-G977B', 'device يبقى كما هو');

  // الآن computeFindings الحقيقي يجب أن يحسب من هذا الفينجربرنت المُعاد بناؤه
  // بدل السقوط في HARNESS_ERROR (كان سيقع لو مُرِّر rawFingerprint وحده بلا
  // إعادة جلب — وهذا بالضبط عطب "فرع الـ45% على كل تقرير يُعاد" المذكور
  // في PLAN-01).
  const {computeFindings} = require('../src/analysis/findings');
  const realRaw = loadJson('b45c8cf6.ts.json');
  const realTs = realRaw.timeSeries || realRaw;
  const storedWithoutSamples = {
    timeSeries: {header: realTs.header, footer: realTs.footer, variables: realTs.variables},
    functionalResults: [],
  };
  const brokenFindings = computeFindings(storedWithoutSamples);
  eq(brokenFindings.notMeasuredReason, 'HARNESS_ERROR',
      'بلا إعادة جلب: computeFindings يسقط في HARNESS_ERROR (العطب الذي يمنعه هذا الملف)');

  const fixedFingerprint = rehydrateFingerprintSamples(storedWithoutSamples, realTs.samples);
  const fixedFindings = computeFindings(fixedFingerprint);
  eq(fixedFindings.status, 'MEASURED',
      'بعد إعادة الجلب: computeFindings يحسب فعلياً — لا فرع الـ45% الزائف');
}
console.log('تحقّق 5: rehydrateFingerprintSamples يمنع فرع HARNESS_ERROR الزائف على تقرير مُعاد');

// ═══════════════════════════════════════════════════════════════════════
// 6. fetchSamplesFromStorage — كعب admin.storage() (لا شبكة حقيقية)
// ═══════════════════════════════════════════════════════════════════════
async function testFetchSamplesFromStorage() {
  const payload = {samples: [{v: [0, 1, 2, 3, 4], phase: 0}]};
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf-8'));

  let requestedPath = null;
  const fakeAdmin = {
    storage: () => ({
      bucket: () => ({
        file: (p) => {
          requestedPath = p;
          return {
            exists: async () => [true],
            download: async () => [gz],
          };
        },
      }),
    }),
  };

  const result = await fetchSamplesFromStorage(fakeAdmin, 'scans/abc/def.ts.json.gz');
  eq(requestedPath, 'scans/abc/def.ts.json.gz', 'fetchSamplesFromStorage يطلب المسار المُمرَّر بالضبط');
  eq(result.samples.length, 1, 'فكّ الضغط وتحليل JSON نجحا');
  n++;

  // ملفّ غير موجود → رمي صريح، لا null صامت.
  const missingAdmin = {
    storage: () => ({
      bucket: () => ({
        file: () => ({exists: async () => [false]}),
      }),
    }),
  };
  let threw = false;
  try {
    await fetchSamplesFromStorage(missingAdmin, 'scans/missing.ts.json.gz');
  } catch (e) {
    threw = true;
    ok(/غير موجود/.test(e.message), 'رسالة الخطأ تذكر أن الملفّ غير موجود');
  }
  ok(threw, 'ملفّ غير موجود في Storage: رمي صريح لا سقوط صامت');

  // storagePath غائب → رمي صريح فوراً بلا لمس admin.storage() إطلاقاً.
  let threwNoPath = false;
  try {
    await fetchSamplesFromStorage(fakeAdmin, null);
  } catch (e) {
    threwNoPath = true;
    ok(/storagePath/.test(e.message), 'رسالة الخطأ تذكر غياب storagePath');
  }
  ok(threwNoPath, 'storagePath=null: رمي صريح فوراً');

  // ─── rehydrateReportFingerprint — التركيب الكامل ────────────────────
  const {computeFindings} = require('../src/analysis/findings');
  const realRaw = loadJson('34dff2b8.ts.json');
  const realTs = realRaw.timeSeries || realRaw;
  const fullPayload = {header: realTs.header, footer: realTs.footer, samples: realTs.samples};
  const fullGz = zlib.gzipSync(Buffer.from(JSON.stringify(fullPayload), 'utf-8'));
  const reportAdmin = {
    storage: () => ({
      bucket: () => ({
        file: () => ({exists: async () => [true], download: async () => [fullGz]}),
      }),
    }),
  };
  const storedReportData = {
    timeSeriesStoragePath: 'scans/xyz/34dff2b8.ts.json.gz',
    rawFingerprint: {
      timeSeries: {header: realTs.header, footer: realTs.footer, variables: realTs.variables},
      functionalResults: [],
    },
  };
  const rehydratedFp = await rehydrateReportFingerprint(reportAdmin, storedReportData);
  const rehydratedFindings = computeFindings(rehydratedFp);
  eq(rehydratedFindings.status, 'MEASURED',
      'rehydrateReportFingerprint: التركيب الكامل (جلب+دمج) يُنتج Findings حقيقية من مستند مخزون');
  n++;

  // timeSeriesStoragePath غائب من المستند → رمي صريح (القرار ١٢: "تعذّر
  // التجهيز" لا "غير مقيس" — المستدعي يقرّر كيف يعامل الاستثناء).
  let threwNoStoragePath = false;
  try {
    await rehydrateReportFingerprint(reportAdmin, {rawFingerprint: {}});
  } catch (e) {
    threwNoStoragePath = true;
    ok(/timeSeriesStoragePath/.test(e.message), 'رسالة الخطأ تذكر الحقل الغائب بالاسم');
  }
  ok(threwNoStoragePath, 'مستند بلا timeSeriesStoragePath: رمي صريح — تعذّر التجهيز');

  // V8 نقل الخامّ (2026-10-09): المصدر المُمرَّر قد يكون raw من readReportRaw (reportRaw/{scanId}) لا مستند التقرير.
  // نفس التركيب، نفس Findings، من raw بشكل PRIVATE — وABSENT (raw=null) يرمي صراحةً.
  const {readReportRaw, RAW_STATE} = require('../src/analysis/reportRawStore');
  const privateRawDoc = {scanId: 'x', ...storedReportData, sessionId: null, deviceFingerprintSha: 'x', aiAudit: null, source: 'analyzeDevice'};
  const fakeDb = {collection: () => ({doc: () => ({get: async () => ({exists: true, data: () => privateRawDoc})})})};
  const privateRead = await readReportRaw({db: fakeDb, scanId: 'x', reportData: {userId: 'o'}});
  eq(privateRead.state, RAW_STATE.PRIVATE, 'readReportRaw: مستند الخامّ موجود ⇒ PRIVATE');
  const rehydratedFromRaw = await rehydrateReportFingerprint(reportAdmin, privateRead.raw);
  eq(computeFindings(rehydratedFromRaw).status, 'MEASURED',
      'rehydrateReportFingerprint من raw بشكل reportRaw (PRIVATE): نفس التركيب ينتج Findings حقيقية');
  n++;
  let threwAbsent = false;
  try {
    await rehydrateReportFingerprint(reportAdmin, null); // ABSENT ⇒ raw=null
  } catch (e) {
    threwAbsent = /timeSeriesStoragePath/.test(e.message);
  }
  ok(threwAbsent, 'raw=null (ABSENT): رمي صريح — لا يُقرأ غياب الخامّ نجاحاً');

  console.log('تحقّق 6: fetchSamplesFromStorage + rehydrateReportFingerprint (كعب admin.storage(), بلا شبكة حقيقية)');
}

testFetchSamplesFromStorage().then(() => {
  console.log(`\nsampleInputsFromRaw.test.js: ${n}/${n} assertions passed`);
}).catch((e) => {
  console.error('sampleInputsFromRaw.test.js FAILED:', e);
  process.exit(1);
});

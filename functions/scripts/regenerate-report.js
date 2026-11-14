#!/usr/bin/env node
'use strict';

// ===================================================
// regenerate-report — إعادة توليد تقرير ضاع نصّه، مع أثر تدقيق
// ===================================================
//
// حالة واحدة بعينها: تقرير خُزّن بـ C/50 وحقول نصّية فارغة لأن jsonrepair
// لفّ مخرَج النموذج في مصفوفة، فقُرئ كل حقل undefined وحلّ السقوط المحايد
// محلّ تقرير كامل. المدخلات محفوظة بالكامل، فإعادة التوليد ممكنة بمدخلات
// مطابقة بايتاً ببايت.
//
// ─── مرحلتان، ولهما سبب ────────────────────────────────────────────
//
// temperature = 0.1 وليست صفراً. تشغيلان بالمدخلات نفسها أعطيا B/78 بسبعة
// أعطال ثم B/79 بتسعة. فلو ولّد السكربت وكتب في خطوة واحدة، لكان المكتوب
// شيئاً لم يره أحد قبل كتابته.
//
//   --generate            يُحلّل، ويحفظ المرشّح في ملف، ويطبعه كاملاً.
//                         لا يكتب على Firestore إطلاقاً.
//   --commit <ملف>        يكتب ذلك الملفّ بعينه. لا تحليل جديد.
//
// فما تراجعه هو ما يُكتب حرفياً.
//
// ─── ما يُكتب وما لا يُكتب ─────────────────────────────────────────
// PATCH بـ updateMask، لا set. وقائمة PROTECTED أدناه تُفحَص قبل الكتابة:
// إن تسرّب أيّ منها إلى القناع توقّف السكربت. الحماية تأكيد صريح لا
// مصادفة ترتيب.
//
// ─── الحواجز ───────────────────────────────────────────────────────
//   1. المستند ما زال C/50 وملخّصه فارغ — وإلا فليس الحالة المقصودة.
//   2. لا حقل aiRegeneration سابق — فلا تُعاد الكتابة مرّتين.
//   3. طول الحمولة المُعاد بناؤها = payloadBytes المسجَّل بالضبط (176278).
//   4. الناتج يحمل درجة صالحة وملخّصاً غير فارغ.
//   5. (عند الكتابة) لا حقل محميّ في القناع.
//   6. الإصلاح منشور فعلاً: آخر تحديث لـ analyzeDevice أحدث من التزام
//      الدمج. حقل التدقيق يشهد بأن الاسترداد جرى بعد نشر الإصلاح، ولا
//      يجوز أن يشهد بما لم يقع — فيُقرأ وقت النشر من Cloud Functions
//      ويُقارَن، ويُخزَّن كما هو دليلاً.
// أيّ حاجز يسقط ⇒ توقّف بلا كتابة.
//
// Usage:
//   export DEEPSEEK_API_KEY=$(gcloud secrets versions access latest \
//       --secret=DEEPSEEK_API_KEY --project neuralchek-9b6d7)
//   node functions/scripts/regenerate-report.js --generate
//   # راجع الملفّ المطبوع مساره، ثم:
//   node functions/scripts/regenerate-report.js --commit <ذلك الملف>

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {execFileSync} = require('child_process');
const {createRestReadDb} = require('./lib/reportRawReaders');
const {readReportRaw} = require('../src/analysis/reportRawStore');

// ─── ثوابت الحالة ────────────────────────────────────────────────────
const PROJECT = 'neuralchek-9b6d7';
const BUCKET = 'neuralchek-9b6d7.firebasestorage.app';
const SCAN_ID = '629485e9-1620-4059-9896-82ef4a6b0c97';
const LOGGED_PAYLOAD_BYTES = 176278;
const LOGGED_SAMPLE_COUNT = 1607;

// الالتزام الذي أصلح العطب، والدمج الذي أدخله master.
const FIX_COMMIT = 'd8b25b4';
const FIX_MERGE_COMMIT = '0e8887d';
const FIX_RANGE = 'ab29e7d..0e8887d';
const REASON = 'array-extraction bug in jsonrepair path';

// وقت التزام الدمج بالتوقيت العالمي. أي نشر أقدم منه لا يحمل الإصلاح.
const FIX_MERGE_ISO = '2026-09-15T14:47:01Z';

// الدالّة التي تُنتج التقارير. نشرها هو المعيار: runConsistencyTest في
// قائمة النشر أيضاً لكنها لا تكتب تقارير المستخدمين.
const REGION = 'us-central1';
const GATE_FUNCTION = 'analyzeDevice';

// على ويندوز الأمر gcloud.cmd. نسمّيه صراحةً بدل shell:true — فالأخيرة
// تُمرّر الوسائط بلا تهريب وتُطلق تحذير إهمال، ولا حاجة إليها هنا.
const GCLOUD = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

// حقول لا تُكتب أبداً — الهويّة والفوترة والمدخلات الخام.
// تُفحَص فعلياً قبل الكتابة، لا بالاعتماد على أن القناع لا يذكرها.
const PROTECTED = [
  'userId', 'createdAt', 'isFreeTrial', 'sessionId', 'shortId',
  'deviceFingerprintSha', 'timeSeriesStoragePath', 'rawFingerprint',
  'fieldsVersion', 'appVersion', 'language', 'scoringEngine',
  'deviceModel', 'deviceFingerprint',
];

const argv = process.argv.slice(2);
const GENERATE = argv.includes('--generate');
const commitIdx = argv.indexOf('--commit');
const COMMIT_FILE = commitIdx >= 0 ? argv[commitIdx + 1] : null;

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}` +
    '/databases/(default)/documents';
const DOC_PATH = `reports/${SCAN_ID}`;

// ─── تعطيل Firestore داخل خطّ التحليل ────────────────────────────────
// runAnalysisInternal يبحث عن ملفّ الجهاز حين يجد deviceProfileKey. الفحص
// الأصلي سجّل cacheReason=first_scan أي أنه بحث فلم يجد، فنُعطّل البحث
// نفسه ليردّ null — وهو الشرط الأصلي بعينه، بلا اعتماد على قاعدة البيانات.
//
// ولا تُمسّ البصمة: إسقاط deviceProfileKey منها يُنقص الحمولة 437 بايت
// فتختلف عن المُرسَل يوم الحادثة. المفتاح يبقى، والبحث وحده هو المعطَّل.
// وكعب db شرك: يرمي إن لمس أي مسار آخر قاعدة البيانات.
const repoFunctions = path.resolve(__dirname, '..');
const findProfilePath = require.resolve(
    path.join(repoFunctions, 'src/profiles/findDeviceProfile'));
require.cache[findProfilePath] = {
  id: findProfilePath, filename: findProfilePath, loaded: true,
  exports: {findDeviceProfile: async () => null},
};
const adminPath = require.resolve(path.join(repoFunctions, 'src/utils/admin'));
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => {
      throw new Error('this script must not touch Firestore through admin');
    }},
    ADMIN_EMAILS: [],
    requireAdmin: () => {},
  },
};

// ─── أدوات ───────────────────────────────────────────────────────────

/** @return {string} رمز وصول من gcloud */
function token() {
  // .cmd على ويندوز يحتاج صَدَفة — الوسائط ثابتة ولا مدخلات فيها.
  return execFileSync(GCLOUD, ['auth', 'print-access-token'],
      {shell: process.platform === 'win32'}).toString().trim();
}

/**
 * طلب HTTP.
 * @param {string} url العنوان
 * @param {Object} [opts] الخيارات
 * @return {Promise<Object>} الجسم المحلَّل
 */
async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + token(),
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}\n${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/**
 * يفكّ قيمة Firestore المُطبَّعة إلى JS عادي.
 * @param {Object} v القيمة
 * @return {*} القيمة العادية
 */
function decode(v) {
  const [t, val] = Object.entries(v)[0];
  if (t === 'nullValue') return null;
  if (t === 'integerValue' || t === 'doubleValue') return Number(val);
  if (t === 'booleanValue') return val;
  if (t === 'arrayValue') return (val.values || []).map(decode);
  if (t === 'mapValue') {
    const o = {};
    for (const [k, x] of Object.entries(val.fields || {})) o[k] = decode(x);
    return o;
  }
  return val;
}

/**
 * يُطبّع قيمة JS إلى تمثيل Firestore.
 * @param {*} v القيمة
 * @return {Object} القيمة المُطبَّعة
 */
function encode(v) {
  if (v === null || v === undefined) return {nullValue: null};
  if (typeof v === 'boolean') return {booleanValue: v};
  if (typeof v === 'number') {
    return Number.isInteger(v) ?
        {integerValue: String(v)} :
        {doubleValue: v};
  }
  if (typeof v === 'string') return {stringValue: v};
  if (Array.isArray(v)) return {arrayValue: {values: v.map(encode)}};
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, x] of Object.entries(v)) fields[k] = encode(x);
    return {mapValue: {fields}};
  }
  return {stringValue: String(v)};
}

/** @param {*} v القيمة @return {string} عرض مختصر */
function brief(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') {
    return v === '' ? '(فارغ)' : JSON.stringify(v.slice(0, 70));
  }
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === 'object') return `map{${Object.keys(v).length}}`;
  return String(v);
}

/** @param {string} m الرسالة */
function abort(m) {
  console.error('\n✗ توقّف بلا كتابة: ' + m);
  process.exit(1);
}

/**
 * يقرأ وقت آخر نشر للدالّة المنتِجة للتقارير، ويتحقّق أنه بعد الإصلاح.
 *
 * هذا ليس تجميلاً: حقل التدقيق سيقول إن الاسترداد جرى بعد نشر الإصلاح،
 * وتلك شهادة لا تصحّ إلا بالتحقّق. النشر الأقدم من الدمج يعني أن الإنتاج
 * ما زال يحمل العطب — فيُكتب تقرير مُصحَّح بينما الفحوص الجديدة معرّضة
 * للعطب نفسه، وتصير الشهادة كاذبة.
 *
 * @return {string} وقت النشر كما ردّه Cloud Functions
 */
async function requireFixDeployed() {
  const url = 'https://cloudfunctions.googleapis.com/v2/projects/' +
      PROJECT + '/locations/' + REGION + '/functions/' + GATE_FUNCTION;
  let deployed = '';
  try {
    deployed = (await api(url)).updateTime || '';
  } catch (e) {
    abort(`تعذّرت قراءة وقت نشر ${GATE_FUNCTION}: ${e.message}`);
  }
  if (!deployed) abort(`لا وقت نشر لـ ${GATE_FUNCTION}`);

  if (new Date(deployed) < new Date(FIX_MERGE_ISO)) {
    abort('الإصلاح غير منشور.\n' +
        `    ${GATE_FUNCTION} آخر تحديث : ${deployed}\n` +
        `    التزام الدمج ${FIX_MERGE_COMMIT}  : ${FIX_MERGE_ISO}\n` +
        '    انشر أولاً:\n' +
        '    firebase deploy --only functions:analyzeDevice,' +
        `functions:runConsistencyTest --project ${PROJECT}`);
  }
  console.log(`  ✓ الإصلاح منشور — ${GATE_FUNCTION} حُدّث ${deployed}`);
  return deployed;
}

/**
 * يجلب المستند الحالي ويفحص الحواجز المشتركة.
 * V8 نقل الخامّ (الجزء ٢، 2026-10-09): rawFingerprint وtimeSeriesStoragePath لم يعودا في
 * مستند التقرير بعد الترحيل؛ يُقرآن بـreadReportRaw (واجهة REST) ويُعادان في `raw` منفصلاً
 * عن `cur` (فلا تظهر مفاتيح الخامّ في «ما لن يُمسّ» من مستند لا يحملها). ABSENT يوقف بلا كتابة.
 * @param {{needRaw?: boolean}} [opts] needRaw=false لمرحلة الكتابة (--commit): لا تحتاج الخامّ، فلا يُقرأ ولا يوقفها غيابه.
 * @return {Promise<{doc: Object, cur: Object, raw: ?Object, rawState: ?string, deployedAt: string}>} المستند
 */
async function loadAndCheck({needRaw = true} = {}) {
  const doc = await api(`${FS_BASE}/${DOC_PATH}`);
  const cur = {};
  for (const [k, v] of Object.entries(doc.fields || {})) cur[k] = decode(v);

  let raw = null;
  let rawState = null;
  if (needRaw) {
    const rawRead = await readReportRaw({
      db: createRestReadDb({project: PROJECT, getToken: token}), scanId: SCAN_ID, reportData: cur,
    });
    rawState = rawRead.state;
    console.log(`  rawState=${rawState}`);
    if (rawState === 'ABSENT') {
      abort('الخامّ غائب (ABSENT): لا reportRaw ولا rawFingerprint مضمَّن — لا يمكن إعادة بناء الحمولة.');
    }
    raw = rawRead.raw;
    if (typeof raw.timeSeriesStoragePath !== 'string' || !raw.rawFingerprint) {
      abort('الخامّ ناقص: timeSeriesStoragePath أو rawFingerprint غائب منه (حالة ' + rawState + ').');
    }
  }

  console.log('\n═══ الحواجز ═══');
  const deployedAt = await requireFixDeployed();

  if (cur.grade !== 'C' || cur.score !== 50) {
    abort(`المستند ليس C/50 بل ${cur.grade}/${cur.score} — ` +
        'إمّا أُعيد توليده أو أنه ليس الحالة المقصودة.');
  }
  console.log('  ✓ المستند ما زال C/50');

  const curSummary = (cur.aiResponse || {}).summary;
  if (curSummary !== '' && curSummary != null) {
    abort('الملخّص الحالي ليس فارغاً — لا تُستبدَل بيانات قائمة.');
  }
  console.log('  ✓ الملخّص الحالي فارغ');

  if (cur.aiRegeneration) {
    abort('حقل aiRegeneration موجود — أُعيد التوليد سابقاً بتاريخ ' +
        (cur.aiRegeneration.regeneratedAt || '؟'));
  }
  console.log('  ✓ لا إعادة توليد سابقة');

  return {doc, cur, raw, rawState, deployedAt};
}

// ─── المرحلة 1: التوليد ──────────────────────────────────────────────

/** يولّد المرشّح ويحفظه. */
async function generate() {
  const {cur, raw, deployedAt} = await loadAndCheck();

  // السلسلة الزمنية من Storage
  const objectPath = encodeURIComponent(raw.timeSeriesStoragePath);
  const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/` +
      `${objectPath}?alt=media`;
  const res = await fetch(url, {headers: {Authorization: 'Bearer ' + token()}});
  if (!res.ok) abort(`تعذّر جلب السلسلة الزمنية: ${res.status}`);
  const ts = JSON.parse(
      zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf-8'));

  // إعادة بناء البصمة كما أُرسلت.
  //
  // نسخة Storage أغنى من المُرسَل: footer فيها calibration و
  // earlyStopReason و preScanWarnings، و variables أطول. و
  // lightenFingerprintForStorage لا تحذف إلا samples، فنسخة المستند هي
  // المُرسَل حرفياً. إذن: المستند لكل شيء، والعيّنات وحدها من Storage.
  const docTs = (raw.rawFingerprint || {}).timeSeries || {};
  const fingerprint = {
    ...raw.rawFingerprint,
    timeSeries: {...docTs, samples: ts.samples},
  };

  // نفس بناء callAI، لقياس الطول قبل أي استدعاء.
  const probe = JSON.stringify({
    scanId: SCAN_ID,
    language: cur.language || 'ar',
    isFreeTrial: cur.isFreeTrial === true,
    rawFingerprint: {
      header: docTs.header || {},
      footer: docTs.footer || {},
      samples: ts.samples || [],
      variables: docTs.variables || [],
      functionalResults: raw.rawFingerprint.functionalResults || [],
      manualResults: raw.rawFingerprint.manualResults || [],
      device: raw.rawFingerprint.device || {},
      antiTamperFlags: raw.rawFingerprint.antiTamperFlags || [],
      powerSaveMode: !!raw.rawFingerprint.powerSaveMode,
    },
    previousScan: null,
  }) + '\n\nProduce the analysis JSON now.';

  if ((ts.samples || []).length !== LOGGED_SAMPLE_COUNT) {
    abort(`عدد العيّنات ${(ts.samples || []).length} ≠ ${LOGGED_SAMPLE_COUNT}`);
  }
  if (probe.length !== LOGGED_PAYLOAD_BYTES) {
    abort(`طول الحمولة ${probe.length} ≠ ${LOGGED_PAYLOAD_BYTES} ` +
        `(فارق ${probe.length - LOGGED_PAYLOAD_BYTES}) — ` +
        'المدخلات ليست المدخلات الأصلية.');
  }
  console.log(`  ✓ الحمولة ${probe.length} بايت — مطابقة للمسجَّل`);
  console.log(`  ✓ العيّنات ${ts.samples.length}`);

  if (!process.env.DEEPSEEK_API_KEY) abort('DEEPSEEK_API_KEY غير مضبوط');

  const {runAnalysisInternal} =
      require(path.join(repoFunctions, 'src/analysis/runAnalysisInternal'));

  console.log('\n═══ إعادة التحليل ═══');
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const out = await runAnalysisInternal({
    fingerprint,
    language: cur.language || 'ar',
    deepseekKey: process.env.DEEPSEEK_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY || '',
    scanContext: {scanId: SCAN_ID, isFreeTrial: cur.isFreeTrial === true},
    usePrecomputed: true,
  });
  const ms = Date.now() - t0;

  if (out.aiFailed || !out.aiResult) {
    abort(`فشل التحليل (${out.aiFallbackReason || 'غير معروف'}) بعد ${ms}ms`);
  }
  const r = out.aiResult;
  if (!/^[ABCD][+-]?$/.test(String(r.grade)) || typeof r.score !== 'number') {
    abort(`الناتج بلا درجة صالحة (${r.grade}/${r.score})`);
  }
  if (!r.summary || !String(r.summary).trim()) {
    abort('الناتج بلا ملخّص — لا نستبدل فارغاً بفارغ.');
  }

  const updates = {
    aiResponse: r,
    grade: r.grade,
    score: r.score,
    deviceMarketingName: r.deviceMarketingName || cur.deviceMarketingName,
    aiModel: out.aiModel,
    aiDurationMs: out.aiDurationMs || out.duration || ms,
    aiFallbackReason: out.aiFallbackReason || null,
    v5Metrics: out.v5Metrics || null,
    pipeline: out.pipeline || cur.pipeline || null,

    // أثر التدقيق. بدونه يستحيل على خطّ بيانات التدريب لاحقاً أن يميّز
    // تقريراً أصلياً من تقرير أُعيد توليده — وهو تمييز جوهري، لأن هذا
    // النصّ وُلد بعد الحادثة بمدخلات الفحص لا في أثنائه.
    aiRegeneration: {
      regenerated: true,
      notFromOriginalScan: true,
      note: 'This text was generated after the fact from the stored scan ' +
          'inputs. It is NOT the analysis the original scan produced; that ' +
          'output was never persisted and is unrecoverable.',
      reason: REASON,

      // ما خرج للمستخدم يوم الفحص.
      originalGrade: 'C',
      originalScore: 50,
      originalAiDurationMs: cur.aiDurationMs ?? null,
      originalSummaryEmpty: true,

      // ما أنتجته هذه العملية بعينها — لا تشغيل تجريبي سابق. النموذج غير
      // حتمي (temperature 0.1)، فتشغيلات مختلفة بالمدخلات نفسها تعطي
      // درجات متقاربة لا متطابقة. المسجَّل هنا هو المكتوب أعلاه حرفياً.
      reanalysisNote: 'This is a RE-ANALYSIS of the stored inputs, not a ' +
          'clone or a recovery of the original output. The model is ' +
          'non-deterministic (temperature 0.1): another run over the same ' +
          'bytes can return a different grade, score and issue set. The ' +
          'values recorded here are the ones actually written to this ' +
          'document, from the single run named by analysisStartedAt.',
      regeneratedGrade: r.grade,
      regeneratedScore: r.score,
      regeneratedIssueCount: (r.issues || []).length,
      regeneratedSummaryChars: String(r.summary).length,

      // تشغيلات سابقة على الحمولة نفسها، بأرقامها المقيسة.
      //
      // ليست زينة: القيمة المكتوبة أعلاه رقم واحد من توزيع، ومن يقرأ هذا
      // المستند لاحقاً — أو يدرّب عليه — يحتاج أن يعرف عرض ذلك التوزيع.
      // رقم واحد بلا نطاق يُقرأ كأنه حتمي وليس كذلك.
      //
      // القياسان أُخذا في 2026-09-15 بالحمولة نفسها (176278 بايت) والبرومبت
      // نفسه: الأول من سكربت إعادة تشغيل للقراءة فقط، والثاني من تشغيل
      // --generate جافّ لهذا السكربت.
      priorRuns: [
        {grade: 'B', score: 79, issueCount: 8,
          reasoningTokens: 16334, outputTokens: 20934,
          context: 'variance measurement run 1'},
        {grade: 'B', score: 76, issueCount: 8,
          reasoningTokens: 14692, outputTokens: 19392,
          context: 'variance measurement run 2'},
        {grade: 'B', score: 78, issueCount: 8,
          reasoningTokens: 21947, outputTokens: 26462,
          context: 'variance measurement run 3'},
        {grade: 'B', score: 78, issueCount: 8,
          reasoningTokens: 19230, outputTokens: 23716,
          context: 'variance measurement run 4'},
        {grade: 'B', score: 76, issueCount: 8,
          reasoningTokens: 24264, outputTokens: 29397,
          context: 'variance measurement run 5'},
      ],
      priorRunsNote: 'Same 176278-byte payload, same deployed prompt, ' +
          'temperature 0.1, 5 consecutive real calls to deepseek-flash ' +
          'on 2026-09-15. Grade was B in all five; score 76-79. Issue ' +
          'COUNT was 8 every time, but the issue SET was not stable: 12 ' +
          'distinct category:severity pairs appeared across the runs and ' +
          'only 4 of them (battery:info, cpu:warning, security:high, ' +
          'thermal:info) were present in all five. Category letters moved ' +
          'in camera, gpu and storage. Reasoning tokens 14692-24264. ' +
          'Recorded so the committed values are readable against real ' +
          'measured variance rather than assumed determinism.',

      // إصدار حقول التطبيق عند الفحص، وعند إعادة التحليل.
      //
      // الحمولة تُقرأ اليوم بشيفرة تعرف دلالات 67 — و storagePercent و
      // availableStorageGb و maxBatteryTemp غيّرت معناها عند 66 و67 مع بقاء
      // الاسم والنوع. فلو اختلف الرقمان لكانت إعادة التحليل تقرأ الأرقام
      // بدلالة غير التي كُتبت بها، وذلك وحده يُفسّر فرقاً في الدرجة.
      //
      // تسجيلهما منفصلين يجعل ذلك قابلاً للفحص بدل أن يُفترَض: الأول من
      // مرآة الإصدار في المستند، والثاني ممّا قرأه checkFooterIntegrity
      // فعلاً في هذا التشغيل.
      fieldsVersionAtScan: cur.fieldsVersion ?? null,
      fieldsVersionAtRegen: (out.v5Metrics || {}).fieldsVersion ?? null,

      // الإصلاح ونشره. fixDeployedAt مقروء من Cloud Functions لا مكتوب
      // يدوياً، و recoveredAfterFixDeploy لا تصير true إلا بعد أن يجتاز
      // الحاجز السادس المقارنة.
      fixCommit: FIX_COMMIT,
      fixMergeCommit: FIX_MERGE_COMMIT,
      fixRange: FIX_RANGE,
      fixMergedAt: FIX_MERGE_ISO,
      fixDeployedAt: deployedAt,
      recoveredAfterFixDeploy: true,

      analysisStartedAt: startedAt,
      regeneratedAt: new Date().toISOString(),
      payloadBytesVerified: probe.length,
      sampleCountVerified: ts.samples.length,
      sourceTimeSeries: raw.timeSeriesStoragePath,
      regeneratedBy: 'scripts/regenerate-report.js',
    },
  };

  const outFile = path.join(os.tmpdir(),
      `regen-${SCAN_ID}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(updates, null, 2), 'utf-8');

  console.log(`  ✓ ${r.grade}/${r.score} في ${ms}ms — ` +
      `${(r.issues || []).length} عطلاً، ` +
      `ملخّص ${String(r.summary).length} محرفاً`);
  if (out.v5Metrics && out.v5Metrics.aiResponseIncomplete === true) {
    console.log('  ⚠ الناتج ناقص: ' +
        (out.v5Metrics.aiResponseMissingKeys || []).join(','));
  }

  console.log('\n═══ المرشّح ═══');
  console.log('  الدرجة  :', r.grade, '/', r.score);
  console.log('\n  الملخّص :', r.summary);
  console.log('\n  الحكم   :', r.verdict || '(فارغ)');
  console.log('\n  التفاصيل:', r.details || '(فارغ)');
  console.log(`\n  الأعطال (${(r.issues || []).length}):`);
  for (const i of (r.issues || [])) {
    console.log(`    • [${i.severity}] ${i.category}: ${i.title}`);
    if (i.description) console.log(`        ${i.description}`);
  }
  const cs = r.category_scores || r.categoryScores || {};
  console.log(`\n  درجات الفئات (${Object.keys(cs).length}):`);
  console.log('   ', Object.keys(cs)
      .map((k) => `${k}=${cs[k].grade}`).join(' '));

  console.log('\n  شهادة التدقيق:');
  console.log(`    الأصلي      : ${updates.aiRegeneration.originalGrade}/` +
      `${updates.aiRegeneration.originalScore}`);
  console.log(`    المُعاد      : ${updates.aiRegeneration.regeneratedGrade}/` +
      `${updates.aiRegeneration.regeneratedScore} ` +
      `(${updates.aiRegeneration.regeneratedIssueCount} عطلاً)`);
  console.log('    تشغيلات سابقة: ' +
      updates.aiRegeneration.priorRuns
          .map((x) => `${x.grade}/${x.score} (${x.issueCount})`).join('  '));
  console.log(`    إصدار الحقول: فحص=` +
      `${updates.aiRegeneration.fieldsVersionAtScan} ` +
      `إعادة=${updates.aiRegeneration.fieldsVersionAtRegen}` +
      `${updates.aiRegeneration.fieldsVersionAtScan ===
        updates.aiRegeneration.fieldsVersionAtRegen ?
          ' (متطابقان — الدلالات نفسها)' :
          ' ⚠ مختلفان — الدلالات قد تختلف'}`);
  console.log(`    الإصلاح     : ${FIX_RANGE} — نُشر ${deployedAt}`);

  console.log('\n═══ المرشّح محفوظ ═══');
  console.log('  ' + outFile);
  console.log('\n  راجعه، ثم للكتابة:');
  console.log(`  node ${path.relative(process.cwd(), __filename)
      .replace(/\\/g, '/')} --commit "${outFile}"`);
  console.log('\n(لم يُكتب شيء على Firestore.)');
}

// ─── المرحلة 2: الكتابة ──────────────────────────────────────────────

/** يكتب المرشّح المحفوظ كما هو. */
async function commit() {
  if (!fs.existsSync(COMMIT_FILE)) abort(`الملفّ غير موجود: ${COMMIT_FILE}`);
  const updates = JSON.parse(fs.readFileSync(COMMIT_FILE, 'utf-8'));

  if (!updates.aiRegeneration || !updates.grade) {
    abort('الملفّ ليس مرشّحاً صالحاً (لا aiRegeneration أو لا grade).');
  }

  const {doc, cur} = await loadAndCheck({needRaw: false});

  // الحاجز 5: لا حقل محميّ في القناع.
  const leaked = Object.keys(updates).filter((k) => PROTECTED.includes(k));
  if (leaked.length) {
    abort(`حقول محميّة في القناع: ${leaked.join(', ')}`);
  }
  console.log(`  ✓ لا حقل محميّ في القناع (${PROTECTED.length} محروساً)`);

  console.log('\n═══ ما سيتغيّر ═══');
  for (const k of Object.keys(updates)) {
    console.log(`  ${k}`);
    console.log(`      قبل : ${brief(cur[k])}`);
    console.log(`      بعد : ${brief(updates[k])}`);
  }
  console.log('\n═══ ما لن يُمسّ ═══');
  console.log('  ' + Object.keys(cur)
      .filter((k) => !(k in updates)).join(', '));

  const backup = path.join(os.tmpdir(), `report-${SCAN_ID}-before.json`);
  fs.writeFileSync(backup, JSON.stringify(doc, null, 2), 'utf-8');
  console.log(`\n  نسخة المستند قبل الكتابة: ${backup}`);

  const mask = Object.keys(updates)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join('&');
  const fields = {};
  for (const [k, v] of Object.entries(updates)) fields[k] = encode(v);

  await api(`${FS_BASE}/${DOC_PATH}?${mask}`, {
    method: 'PATCH',
    body: JSON.stringify({fields}),
  });
  console.log(`\n  ✓ كُتب ${Object.keys(updates).length} حقلاً على ${DOC_PATH}`);
  console.log(`  الدرجة: ${cur.grade}/${cur.score} → ` +
      `${updates.grade}/${updates.score}`);
}

// ─── المدخل ──────────────────────────────────────────────────────────
(async () => {
  if (GENERATE && COMMIT_FILE) abort('اختر --generate أو --commit، لا كليهما.');
  if (GENERATE) {
    console.log('═══ الوضع: توليد — لا كتابة ═══');
    await generate();
  } else if (COMMIT_FILE) {
    console.log('═══ الوضع: كتابة ═══');
    console.log('  المرشّح: ' + COMMIT_FILE);
    await commit();
  } else {
    console.log('الاستعمال:');
    console.log('  --generate           يُحلّل ويحفظ مرشّحاً (لا كتابة)');
    console.log('  --commit <ملف>       يكتب ذلك المرشّح بعينه');
    process.exit(1);
  }
})().catch((e) => {
  console.error('\n✗ خطأ:', e.message);
  process.exit(1);
});

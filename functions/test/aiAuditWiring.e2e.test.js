// E2E test: aiAudit wiring in the saved report document (القرار ٢٠،
// PLAN-01-ROADMAP.md §🔒 "٢٠ · سلك display وaudit").
//
// يثبت أربعة معاً، بتشغيل analyzeDevice() الحقيقية عبر محاكي Firestore —
// لا بالقراءة وحدها (نصّ أمر المهمّة: "مُثبَتاً باختبار لا بالقراءة وحدها"):
//
//   1. مسار V6 (pipeline="v6_raw_timeseries"، عبر كعب مباشر لـ
//      runAnalysisInternal — V6 نفسه ميت منذ التبديل، fd3a6ce، فهذا
//      يختبر شكل الكتابة حين تصل هذه القيمة، لا مساراً حيّاً فعلياً):
//      aiResultAudit undefined (buildDisplayShapeV7/audit خاصّان بـV7)،
//      فالمستند المحفوظ يحمل aiAudit=null — حقل حاضر بنيوياً بلا أثر.
//   2. حين runAnalysisInternal يُنتج aiResultAudit فعلاً (يُحاكى هنا عبر
//      استبدال الوحدة في require.cache — هذا الفرع صار الوحيد الحيّ فعلياً
//      منذ التبديل، لا محاكاة لفرع غير مُتاح كما كان سابقاً): يُكتب
//      المستند بـ aiAudit مطابقاً حرفياً لِما أعادته runAnalysisInternal،
//      و**لا يصل أبداً** إلى القيمة التي تُعاد للعميل (استجابة RPC).
//   3. A103 (مهمّة 2026-09-21 +03، القاعدة 23 — يستبدل ما كان case 2 يُثبته
//      ضمناً، لا يُضاف بجواره): fakeDisplay أدناه كان يحمل grade/score
//      مُصطنَعتين فقط لتفادي عطب حقيقي — Firestore Admin SDK يرفض قيمة
//      undefined صريحة، وanalyzeDevice.js:313-314 (قبل هذه المهمّة) كان
//      يكتب grade: aiResult.grade بلا شرط، وaiResult الحقيقي على فرع V7
//      (buildDisplayShapeV7.display) لا يحمل grade/score أبداً (القرار ٥) —
//      فكان .set() سيرمي فعلياً لحظة يُوصَل فرع V7. أُزيلتا هنا الآن
//      (fakeDisplay صار يطابق الشكل الحقيقي بدقّة)، وcase 2 يُثبت أن
//      .set() ينجح بلا استثناء وأن المستند لا يحمل مفتاحَي grade/score
//      إطلاقاً — لا undefined يُكسر الكتابة، ولا null يُقرأ "قِيس فلم يوجد"
//      خطأً (القاعدة 22).
//   4. A104 (نفس المهمّة، اكتشاف مرتبط بنفس منهج A103): deviceMarketingName
//      **أيضاً** غائب من buildDisplayShapeV7.display (كانت مُصطنَعة سابقاً
//      لنفس السبب) — أُصلح بنفس احتياطي V6 (rawDeviceModel). ومفتاحان
//      مُختلَقان (SECRET_LEAK_OVERALL متداخل، unexpectedTopLevelKey سطحي)
//      يثبتان أن buildV7ResponseForStorage (analyzeDevice.js) يبني ما
//      يُكتب إلى Firestore حقلاً حقلاً — فلا يصل مفتاح غير مُسمّى صراحةً
//      إلى المستند المحفوظ، حتى لو حمله aiResult.
//      ⚠️ العبارة الأصلية هنا كانت: "الحدّ موثَّق أيضاً: استجابة العميل
//      (RPC) نفسها لا تُصفّى (aiResult يصل كما هو) — هذه الدالّة تحرس
//      الكتابة إلى Firestore فقط." **لم تعد صحيحة بعد A106 أدناه** —
//      أُبقيت هنا موسومة بالتصحيح بدل حذفها (القاعدة 8: لا حذف دليل).
//   5. A106 (مهمّة 2026-09-21 +03، نصّ المستخدم حرفياً): "ثلاثة أسطح
//      بثلاثة مرشِّحات لا يجوز أن تبقى: قيمة الإرجاع للتطبيق → spread
//      كامل بلا تصفية، مستند reports → حقلاً حقلاً، /verify → قائمة
//      بيضاء... الإصلاح: analyzeDevice.js:480 يُرجع المبنيّ بحقول مُسمّاة،
//      لا spread." الحدّ المذكور في البند 4 أعلاه أُغلق: على فرع V7،
//      analyzeDevice.js يُعيد الآن نفس aiResponseToSave المكتوب في
//      aiResponse (+ shortId/isFreeTrial المُسمَّيان صراحةً — لا من
//      display) بدل aiResult الخام. فالمفتاحان المُختلَقان (السطر
//      162-167 أدناه) **لا يصلان استجابة العميل بعد الآن أيضاً** —
//      يُستبدَل التحقّق الذي كان يُثبت وصولهما (case 2 كان يحمل هذا
//      التحقّق) لا يُضاف إليه تحقّق جديد بجواره (القاعدة 23، نفس منهج
//      A103). أُعيد إنتاج الوصول قبل الإصلاح فعلياً: تشغيل هذا الملف
//      بعينه (بلا تعديل) بعد تطبيق إصلاح analyzeDevice.js:480 وحده —
//      أي بالتحقّق القديم في case 2 ("استجابة العميل هي aiResult كما هو
//      بلا تصفية") — أعاد `FAIL` صريحاً على ذلك السطر تحديداً (14
//      تحقّقاً، فشل واحد) لأن الإصلاح قطع الوصول فعلاً؛ 13 التحقّقات
//      الأخرى بقيت PASS. راجع تقرير المهمّة تحت "قياس قبل/بعد" لنصّ
//      المخرَج الحرفي لذلك التشغيل. فرع V6 (case 1) بلا أي تغيير سلوكي —
//      اختبار قائم يبقى أخضر (نفس تحقّقات case 1 الأربعة، بلا تعديل).
//   6. A104 في العمق (مهمّة 2026-09-21 +03، نصّ المستخدم حرفياً):
//      "buildV7ResponseForStorage يبني categories و issues حقلاً حقلاً
//      كما يبني overall و narrative. طبقة واحدة لا تكفي". قبل هذه
//      المهمّة fakeDisplay.categories/.issues كانا فارغين ({}/[]) —
//      فالمفتاحان المُختلَقان في case 2/4 (SECRET_LEAK_OVERALL/
//      unexpectedTopLevelKey) يفحصان المستوى الأوّل من aiResponse فقط،
//      ولا يوجد تحقّق سابق على مفتاح مُختلَق **داخل** categories[cat] أو
//      داخل عنصر issues[i] — لا شيء يُستبدَل هنا (القاعدة 23 لا تنطبق:
//      هذا تحقّق جديد على سطح لم يُختبَر من قبل، لا استبدال لتحقّق قديم
//      كان يُثبت سلوكاً خاطئاً). أُضيف SECRET_LEAK_CATEGORY داخل
//      fakeDisplay.categories.battery وSECRET_LEAK_ISSUE داخل عنصر
//      fakeDisplay.issues[0] بنفس منهج المفتاحين أعلاه بالضبط. أُعيد
//      إنتاج الوصول فعلياً: تشغيل هذا الملف (بعد إضافة المفتاحين
//      والتحقّقات أدناه فقط، **قبل** تعديل buildV7ResponseForStorage)
//      أظهر كِلا المفتاحين داخل savedAiResponseSerialized — مُثبِتاً أن
//      `categories: (r.categories...) ? r.categories : {}` و
//      `issues: Array.isArray(r.issues) ? r.issues : []` (المرحلة السابقة
//      لهذه المهمّة) يمرّران محتوى categories[cat]/issues[i] بالمرجع
//      الكامل بلا حراسة على المستوى الثاني. راجع تقرير المهمّة تحت "قياس
//      قبل/بعد" لنصّ المخرَج الحرفي لذلك التشغيل. الإصلاح: buildCategoryEntryForStorage/
//      buildIssueForStorage في analyzeDevice.js يُعمِّمان نمط
//      buildDisplayShapeV7.js:121-139 (buildCategoryDisplay) وbuildIssuesDisplay
//      (:189-195) — حقلاً حقلاً لا تمريرة بالمرجع، لنفس المستوى الثاني.
//   7. A112 (القرار ٤٢ البند ٥، مهمّة 2026-09-21 +03 لاحقة): deviceMarketingName
//      كان غائباً من استجابة العميل V7 (مُوثَّق في docs/V7_DISPLAY_SHAPE_CONTRACT.md
//      §٠-٣ قبل هذه المهمّة) — أُصلح بنفس منهج aiModel (A108): يُضاف
//      صراحةً فوق aiResponseToSave، مُشتقّاً الآن من قائمة مُعلَنة مُصدَّرة
//      (v7OperationalFields.js) لا أربعة أسطر مبعثرة. حالة 7 الجديدة أدناه
//      تحرس الاستقراء العكسي: كل مفتاح top-level في استجابة العميل V7
//      إمّا من aiResponseToSave أو من تلك القائمة — لا ثالث صامت (نفس نمط
//      A106/A108 معمَّماً إلى قاعدة دائمة بدل تحقّق نقطي لكل حقل جديد).
//
// 2026-10-09 (ملفّات e2e الستّ قبل أوّل نشر V8، القاعدة 23 — استبدال لا إضافة) — أربعة تأكيدات كانت تفشل لسببين:
//   (أ) الحالة 1 كانت تُشغّل runAnalysisInternal **الحقيقية** وتفترض أنها V6 (`pipeline === "v6_raw_timeseries"`، `aiAudit === null`،
//       الإرجاع = {...aiResponse, shortId}). المسار الحيّ منذ fd3a6ce V7 (resolveV7Report المصدر الوحيد): pipeline=v7_findings_based،
//       و aiAudit كائن حقيقي (measuredCategoriesMean/gatesApplied/regeneration...)، والإرجاع V7 المبنيّ. فصارت الحالة 1 تؤكّد ما
//       ينتجه المسار الحيّ. (فرع V6 في analyzeDevice.js ميت منذ التبديل؛ لم تُبقَ له تغطية هنا.) وكعب ردّ المزوّد صار جسم V7 سليماً
//       (lib/v7ProviderStub.js) بدل جسم V6 الذي يرفضه الحارس.
//   (ب) الحالة 5 كانت تقارن الاستجابة بـr2.aiResponse حرفياً بعد طرح أربعة حقول تشغيلية. S6 (2026-10-01) يحذف narrative.details/verdict
//       من الإرجاع وحده (analyzeDevice.js:240 و:860) والمخزَّن كامل — فالمقارنة الصحيحة بعد طرحهما أيضاً من المخزَّن (نسخة عميقة صريحة).
//
// Run:
//   JAVA_HOME="<jdk>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/aiAuditWiring.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// Gemini stub — never used on the success path here either.
const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {generateContent: async () => {
        throw new Error("stub gemini fail");
      }};
    }
  }},
};

// الاستبدال للشبكة وحدها (القاعدة 37): ردّ مزوّد V7 سليم الشكل.
const {installDeepSeekStub} = require("./lib/v7ProviderStub");
installDeepSeekStub();

const {db} = require("../src/utils/admin");

// ─── كعب runAnalysisInternal — يُنتج مخرَجاً مصنوعاً بمفاتيح مُختلَقة (canaries) ليُثبت أن الكتابة حقلاً حقلاً وأن
// الوصل يعمل حين يُنتَج aiResultAudit بقيم معروفة (الحالات 2-7). الوحدة الحقيقية تُستدعى في الحالة 1 (المسار الحيّ V7) —
// اعتراض قابل للتبديل يُمرّر إلى الأصل افتراضياً.
const runAnalysisInternalPath = require.resolve("../src/analysis/runAnalysisInternal");
const {runAnalysisInternal: realRunAnalysisInternal} =
    require(runAnalysisInternalPath);
let override = null; // null = استعمل التنفيذ الحقيقي (المسار الحيّ V7)
require.cache[runAnalysisInternalPath] = {
  id: runAnalysisInternalPath, filename: runAnalysisInternalPath, loaded: true,
  exports: {
    runAnalysisInternal: async (args) =>
      (override ? override(args) : realRunAnalysisInternal(args)),
  },
};

const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {V7_OPERATIONAL_FIELDS} = require("../src/analysis/v7OperationalFields");

const future = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

function fp(profileSuffix) {
  return {
    device: {
      model: "P", androidVersion: "14", totalRamGb: 8,
      deviceProfileKey: {a: `h_${profileSuffix}`},
    },
    timeSeries: {
      header: {}, footer: {}, samples: [], variables: [],
    },
    functionalResults: [], manualResults: [],
  };
}

const getReport = async (s) => (await db.collection("reports").doc(s).get()).data();
// S6: ما يُعاد للعميل يفقد narrative.details/verdict وحدهما — نسخة عميقة صريحة من المخزَّن بعد ذلك الطرح.
function withoutNarrativeDetailsVerdict(aiResponse) {
  const copy = JSON.parse(JSON.stringify(aiResponse));
  if (copy.narrative) {
    delete copy.narrative.details;
    delete copy.narrative.verdict;
  }
  return copy;
}
// V8 نقل الخامّ (2026-10-09): aiAudit لم يعد في المستند المقروء بل في reportRaw/{scanId}.aiAudit (القرار ٤).
const getRaw = async (s) => (await db.collection("reportRaw").doc(s).get()).data();

async function run({data, auth}) {
  return analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
}

async function seedUser(uid) {
  await db.collection("users").doc(uid).set({
    scansRemaining: 20, scansTotal: 20, plan: "shop_pro",
    isActive: true, expiresAt: future(),
  });
}

const results = []; let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}

// A106 — مقارنة عميقة مستقرّة الترتيب: JSON.stringify العادية تعتمد ترتيب
// إدراج المفاتيح، وFirestore (حتى المحاكي) لا يضمن نفس الترتيب عند القراءة
// الذي كان عند الكتابة. بدون هذا الفرز، مقارنة clientResponse2 بـr2.aiResponse
// (تحقّق "السطحان متطابقان" أدناه) قد تُخفق زوراً لمجرد اختلاف ترتيب
// المفاتيح لا القيم — لا علاقة لهذا بصحّة الإصلاح نفسه.
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

(async () => {
  // ===== Case 1: المسار الحيّ V7 (بلا اعتراض) — aiResultAudit حقيقي من resolveV7Report يُكتب في reportRaw =====
  await seedUser("u1");
  const clientResponse1 = await run({
    data: {scanId: "audit-s1", fingerprint: fp("1")},
    auth: {uid: "u1"},
  });
  const r1 = await getReport("audit-s1");
  const w1 = await getRaw("audit-s1");
  assert(w1 && "aiAudit" in w1, "1. الحقل aiAudit حاضر بنيوياً في كل مستند reportRaw (قابل للاستعلام دائماً)");
  assert(!("aiAudit" in r1), "1. [V8] المستند المقروء لا يحمل aiAudit (انتقل إلى reportRaw)");
  assert(w1.aiAudit !== null && typeof w1.aiAudit === "object" && Array.isArray(w1.aiAudit.gatesApplied) &&
      "measuredCategoriesMean" in w1.aiAudit && w1.aiAudit.regeneration && w1.aiAudit.regeneration.attempts === 1,
  "1. المسار الحيّ V7 اليوم → aiAudit كائن حقيقي (gatesApplied/measuredCategoriesMean/regeneration) لا null — aiResultAudit يصل من resolveV7Report");
  assert(r1.pipeline === "v7_findings_based", "1. تأكيد: هذا فعلاً المسار الحيّ V7 (منذ fd3a6ce) لا فرعاً آخر");
  assert(!("aiAudit" in clientResponse1),
      "1. الاستجابة المُعادة للعميل (RPC) لا تحمل aiAudit إطلاقاً — حتى حين null");
  // A106 + S6 على المسار الحيّ: الاستجابة المُعادة = المخزَّن (بعد طرح narrative.details/verdict وحدهما) + الحقول التشغيلية الأربعة.
  {
    const {shortId: _s1, isFreeTrial: _f1, aiModel: _m1, deviceMarketingName: _d1, ...clientResponse1Core} = clientResponse1;
    assert(r1.aiResponse.narrative && "details" in r1.aiResponse.narrative && "verdict" in r1.aiResponse.narrative &&
        !("details" in clientResponse1.narrative) && !("verdict" in clientResponse1.narrative),
    "1. [S6] المخزَّن يحمل narrative.details/verdict والمُعاد للعميل لا يحملهما");
    assert(stableStringify(clientResponse1Core) === stableStringify(withoutNarrativeDetailsVerdict(r1.aiResponse)),
        "1. [A106+S6] V7 الحيّ: الاستجابة المُعادة للعميل (بعد طرح الحقول التشغيلية الأربعة) = r1.aiResponse المخزَّن بعد طرح narrative.details/verdict وحدهما");
  }

  // ===== Case 2: fرع V7 مُحاكى — aiResultAudit موجود → يُكتب تحت aiAudit =====
  const fakeAudit = {
    measuredCategoriesMean: 77, gatesApplied: [{name: "ROOT_DETECTED", status: "FIRED"}],
    crossChecks: [], modelObservations: [],
    regeneration: {attempts: 1, narrativeIncomplete: false, droppedFields: [], rounds: []},
  };
  // A103: لا grade/score هنا — الشكل الحقيقي لـbuildDisplayShapeV7.display
  // (القرار ٥) لا يحملهما أبداً. كانا مُصطنَعين سابقاً لتفادي عطب حقيقي في
  // analyzeDevice.js (راجع تعليق رأس الملفّ) — الآن مُصلَح، فالفحص الحقيقي
  // يبدأ من شكل حقيقي دقيق، لا فيه ما يُخفي العطب.
  //
  // A104 — اكتشاف مرتبط أثناء نفس المهمّة، بنفس منهج A103 (مُتحقَّق بتشغيل
  // فعلي لا بالقراءة): deviceMarketingName **أيضاً** غائب من
  // buildDisplayShapeV7.display (صفر نتيجة في buildDisplayShapeV7.js كاملاً)
  // — كان مُصطنَعاً هنا سابقاً ("Test V7") لنفس سبب grade/score. أُزيل، وأُضيف
  // احتياطي حقيقي في analyzeDevice.js (rawDeviceModel — نفس صيغة احتياطي V6
  // الفعلي في runAnalysisInternal.js:512). و**مفتاحان مُختلَقان** أدناه
  // (SECRET_LEAK_OVERALL/unexpectedTopLevelKey) يُثبتان القيمة العملية
  // لـbuildV7ResponseForStorage (analyzeDevice.js، A104): تصل استجابة
  // العميل (لا تُصفّى) لكنهما **لا تصلان أبداً** إلى المستند المحفوظ.
  const fakeDisplay = {
    pipeline: "v7_findings_based",
    overall: {letter: "C", coverage: 0.45, SECRET_LEAK_OVERALL: "leak-canary-overall"},
    // 6. A104 في العمق — راجع تعليق رأس الملفّ. battery.SECRET_LEAK_CATEGORY
    // (مستوى ثانٍ داخل categories[cat]) وissues[0].SECRET_LEAK_ISSUE (مستوى
    // ثانٍ داخل عنصر مصفوفة issues) بنفس منهج SECRET_LEAK_OVERALL أعلاه —
    // بجوار حقول حقيقية (state/letter/coverage/testIds، id/category/
    // severity/title/evidence/evidenceUnit) لإثبات أن الإصلاح يبني الحقول
    // المعروفة لا يمحو الكائن كلّه.
    categories: {
      battery: {
        state: "MEASURED", letter: "B", coverage: 0.82, testIds: ["BAT-01"],
        // القرار ٤٢ البند ٣ (letterSource، مهمّة 2026-09-21 +03 لاحقة) —
        // ثلاثة حقول جديدة على buildCategoryDisplay (A62) — تُختبَر هنا
        // بنفس منهج الحقول المجاورة (تصل المخزون سليمة رغم إعادة البناء
        // حقلاً حقلاً في buildCategoryEntryForStorage).
        letterSource: "LLM_ADJUSTED", adjustmentReason: "اختبار A62", adjustmentEvidence: ["findings.x"],
        confidence: "عالية", tag: null, indicators: {}, socAtStart: 55, socAtEnd: 40,
        SECRET_LEAK_CATEGORY: "leak-canary-category",
      },
    },
    issues: [
      {
        id: "ISS-BAT-01", category: "battery", severity: "WARNING",
        title: "تنبيه في الاختبار BAT-01", evidence: 12.5, evidenceUnit: "mAh",
        SECRET_LEAK_ISSUE: "leak-canary-issue",
      },
    ],
    narrative: {summary: "س7"},
    unexpectedTopLevelKey: "leak-canary-top",
  };
  override = async () => ({
    aiResult: fakeDisplay,
    aiResultAudit: fakeAudit,
    aiFailed: false,
    rawDeviceModel: "P",
    aiModel: "deepseek-flash",
    aiDurationMs: 123,
    aiFallbackReason: null,
    pipeline: "v7_findings_based",
    v5Metrics: {cacheHit: false, cacheReason: "first_scan"},
    existingProfile: null,
    deviceProfileKey: null,
  });

  await seedUser("u2");
  const clientResponse2 = await run({
    data: {scanId: "audit-s2", fingerprint: fp("2")},
    auth: {uid: "u2"},
  });
  const r2 = await getReport("audit-s2");
  const w2 = await getRaw("audit-s2");
  assert(JSON.stringify(w2.aiAudit) === JSON.stringify(fakeAudit),
      "2. aiAudit المحفوظ في reportRaw مطابق حرفياً لِما أعادته runAnalysisInternal (aiResultAudit)");
  assert(!("aiAudit" in r2), "2. [V8] ولا يظهر في المستند المقروء");
  assert(!("aiAudit" in clientResponse2),
      "2. حتى حين aiAudit غير null فعلياً، الاستجابة المُعادة للعميل لا تحمله — لا يُعرض في أي واجهة");
  // A106 — يستبدل هذا التحقّق التحقّقَ القديم (القاعدة 23، نفس منهج
  // A103): كان يُثبت أن المفتاحين المُختلَقين يصلان استجابة العميل (حدّ
  // A104 المُوثَّق في تعليق رأس الملفّ). أُعيد إنتاج ذلك الوصول فعلياً:
  // تشغيل هذا الملفّ (14 تحقّقاً) بعد تطبيق إصلاح analyzeDevice.js:480
  // وحده لكن **قبل** تعديل هذا الملفّ — أي بالسطر القديم أعلاه حرفياً —
  // أعاد `FAIL` صريحاً على ذلك التحقّق تحديداً (13 PASS/1 FAIL)، مُثبِتاً
  // أن الإصلاح قطع الوصول الذي كان التحقّق القديم يفترضه. الثلاثة أدناه
  // تحلّ محلّه.
  assert(!("SECRET_LEAK_OVERALL" in (clientResponse2.overall || {})),
      "2. [A106] المفتاح المتداخل المُختلَق (overall.SECRET_LEAK_OVERALL) لا يصل استجابة العميل (RPC) بعد الإصلاح — كان يصلها قبله");
  assert(!("unexpectedTopLevelKey" in clientResponse2),
      "2. [A106] المفتاح السطحي المُختلَق (unexpectedTopLevelKey) لا يصل استجابة العميل (RPC) بعد الإصلاح — كان يصلها قبله");
  assert(!JSON.stringify(clientResponse2).includes("leak-canary"),
      "2. [A106] لا أثر لأيّ من قيمتَي canary المُختلَقتين في استجابة العميل كاملةً — لا فقط غياب اسمَي المفتاحين");

  // 3. A103 — أهمّ ما في هذا case الآن: .set() لم يرمِ (لولا ذلك لَسقط كل
  // الاختبار عبر catch أسفل الملفّ)، والمستند V7 لا يحمل grade/score إطلاقاً.
  assert(!("grade" in r2),
      "3. [A103] وثيقة V7 المحفوظة لا تحمل مفتاح grade إطلاقاً — لا undefined كسر الكتابة، لا null قيمة خاطئة (القاعدة 22)");
  assert(!("score" in r2),
      "3. [A103] وثيقة V7 المحفوظة لا تحمل مفتاح score إطلاقاً");
  assert(r2.pipeline === "v7_findings_based",
      "3. [A103] المستند يُميَّز بـpipeline لا بغياب/وجود grade/score");

  // 4. A104 — الضمانة عند الكاتب: المفتاحان المُختلَقان أعلاه لا يصلان
  // المستند المحفوظ إطلاقاً، وdeviceMarketingName يسقط إلى rawDeviceModel
  // الحقيقي لا يبقى undefined (لولا الإصلاح لكان .set() رمى هنا أيضاً —
  // نفس استثناء A103 حرفياً، أُعيد إنتاجه فعلياً بإزالة القيمة المُصطنَعة
  // مؤقّتاً أثناء هذه المهمّة قبل الإصلاح).
  assert(r2.deviceMarketingName === "P",
      "4. [A104] deviceMarketingName المحفوظ = rawDeviceModel (احتياطي حقيقي، لا undefined يكسر الكتابة)");
  const savedAiResponseSerialized = JSON.stringify(r2.aiResponse);
  assert(!savedAiResponseSerialized.includes("leak-canary-overall"),
      "4. [A104] المفتاح المتداخل المُختلَق (overall.SECRET_LEAK_OVERALL) لا يصل المستند المحفوظ — buildV7ResponseForStorage يبنيه حقلاً حقلاً");
  assert(!savedAiResponseSerialized.includes("leak-canary-top"),
      "4. [A104] المفتاح السطحي المُختلَق (unexpectedTopLevelKey) لا يصل المستند المحفوظ");
  assert(!("isFreeTrial" in r2.aiResponse),
      "4. [A104] aiResult.isFreeTrial (تُضاف بالمرجع لاستجابة العميل فقط — تعليق analyzeDevice.js) لا تتسرّب إلى aiResponse المحفوظ أيضاً");

  // 5. A106 — السطحان (المخزون والمُعاد) متطابقان على فرع V7، عدا shortId
  // وisFreeTrial المُضافين صراحةً فوق aiResponseToSave (نصّ الأمر: "سمِّهما
  // في التقرير ولا تُسقطهما بصمت" — راجع analyzeDevice.js:480 وتعليقه).
  // نطرح الحقلين الاثنين من clientResponse2 ونقارن الباقي حرفياً (ترتيب
  // مفاتيح مستقرّ عبر stableStringify — راجع تعليقها أعلاه) بـr2.aiResponse:
  // نفس الكائن المصدر (aiResponseToSave، بناء buildV7ResponseForStorage
  // نفسه) لا نسخة ثانية منه.
  //
  // A108 (مهمّة 2026-09-21 +03) — aiModel أُضيف بجواره صراحةً فوق
  // aiResponseToSave أيضاً (نفس منهج shortId/isFreeTrial) — فالطرح هنا
  // صار ثلاثة حقول لا اثنين. **تحديث ضروري لا استبدال قاعدة 23**: هذا
  // ليس تحقّقاً كان يُثبت سلوكاً خاطئاً يُستبدَل، بل افتراض بنيوي ("الفرق
  // بين السطحين حقلان فقط") صار غير دقيق بعد إضافة حقل ثالث شرعي — أُعيد
  // إنتاج الكسر فعلياً: تشغيل هذا الملف بعد إضافة aiModel في analyzeDevice.js
  // (item 1) لكن **قبل** تحديث هذا الطرح هنا أعاد `FAIL` صريحاً على هذا
  // التحقّق بعينه (راجع تقرير المهمّة تحت "قياس قبل/بعد" لنصّ المخرَج).
  //
  // A112 (القرار ٤٢ البند ٥، مهمّة 2026-09-21 +03 لاحقة) — deviceMarketingName
  // أُضيف بجواره صراحةً أيضاً (v7OperationalFields.js — القائمة الأربعة
  // المُعلَنة، لا ثلاثة). **نفس نمط تحديث A108 أعلاه — تحديث ضروري لا
  // استبدال قاعدة 23**: أُعيد إنتاج الكسر فعلياً (تشغيل حقيقي عبر محاكي
  // Firestore، لا بالقراءة): بعد إضافة deviceMarketingName إلى الإرجاع في
  // analyzeDevice.js لكن **قبل** تحديث هذا الطرح هنا، `firebase emulators:exec
  // --only firestore --project demo-nc "node functions/test/aiAuditWiring.e2e.test.js"`
  // أعاد `FAIL` صريحاً على هذا التحقّق بعينه (27 PASS/1 FAIL، 28 تحقّقاً) —
  // نفس آلية فشل A108 بالضبط، بحقل رابع لا ثالث.
  const {shortId: _s2, isFreeTrial: _f2, aiModel: _m2, deviceMarketingName: _d2, ...clientResponse2Core} = clientResponse2;
  assert(stableStringify(clientResponse2Core) === stableStringify(withoutNarrativeDetailsVerdict(r2.aiResponse)),
      "5. [A106+S6] استجابة العميل (بعد طرح shortId/isFreeTrial/aiModel/deviceMarketingName) مطابقة حرفياً لِـr2.aiResponse المخزون بعد طرح narrative.details/verdict وحدهما (S6) — سطحان لا ثلاثة، من نفس aiResponseToSave");
  assert(typeof clientResponse2.shortId === "string" && clientResponse2.shortId.length > 0,
      "5. [A106] shortId حاضر صراحةً في استجابة العميل رغم غيابه من aiResponseToSave/display — مُضاف إليه لا جزء منه (نصّ الأمر)");
  assert(clientResponse2.isFreeTrial === false,
      "5. [A106] isFreeTrial حاضر صراحةً في استجابة العميل (u2 على خطّة shop_pro لا مجانية → false) — لم يُسقَط صامتاً بعد التبديل من aiResult الخام إلى aiResponseToSave المُصفّى");
  assert(!("shortId" in r2.aiResponse),
      "5. [A106] shortId يبقى غائباً عن aiResponse المخزون (buildV7ResponseForStorage لا يحمله في قائمته — مُتَّسِق مع القرار ٥/شكل display الحقيقي)");
  assert(!("isFreeTrial" in r2.aiResponse),
      "5. [A106] isFreeTrial يبقى غائباً عن aiResponse المخزون أيضاً (نفس تحقّق 4 أعلاه — بلا تغيّر بعد A106)");
  assert(clientResponse2.aiModel === "deepseek-flash",
      "5. [A108] aiModel حاضر صراحةً في استجابة العميل (نفس قيمة aiModel المُعادة من runAnalysisInternal، override أعلاه) — التطبيق يقرؤه (AiScoringEngine.kt:305)");
  assert(clientResponse2.deviceMarketingName === "P",
      "5. [A112] deviceMarketingName حاضر صراحةً في استجابة العميل الآن (احتياطي rawDeviceModel، fakeDisplay لا يحمل هذا الحقل — نفس مسار الاحتياط الحقيقي في r2 top-level تحقّق 4)");
  assert(!("deviceMarketingName" in r2.aiResponse),
      "5. [A112] deviceMarketingName يبقى غائباً عن aiResponse المخزون (buildV7ResponseForStorage لا يحمله في قائمته — يُكتَب على مستوى المستند الأعلى وحده، analyzeDevice.js:445)");
  assert(!("aiModel" in r2.aiResponse),
      "5. [A108] aiModel يبقى غائباً عن aiResponse المخزون (buildV7ResponseForStorage لا يحمله في قائمته — مطابق لمكانه الفعلي: حقل مستقلّ على مستوى المستند، analyzeDevice.js:400)");

  // 6. A104 في العمق — نفس منهج المفتاحين أعلاه، على مستوى ثانٍ. المفتاحان
  // المُختلَقان لا يصلان المستند المحفوظ...
  assert(!savedAiResponseSerialized.includes("leak-canary-category"),
      "6. [A104 في العمق] المفتاح داخل categories.battery المُختلَق (SECRET_LEAK_CATEGORY) لا يصل المستند المحفوظ — buildCategoryEntryForStorage يبنيه حقلاً حقلاً");
  assert(!savedAiResponseSerialized.includes("leak-canary-issue"),
      "6. [A104 في العمق] المفتاح داخل issues[0] المُختلَق (SECRET_LEAK_ISSUE) لا يصل المستند المحفوظ — buildIssueForStorage يبنيه حقلاً حقلاً");
  // ...بينما الحقول الحقيقية المجاورة تصل سليمة — إثبات أن الإصلاح يبني لا يمحو.
  assert(r2.aiResponse.categories &&
      r2.aiResponse.categories.battery &&
      r2.aiResponse.categories.battery.state === "MEASURED" &&
      r2.aiResponse.categories.battery.letter === "B" &&
      r2.aiResponse.categories.battery.coverage === 0.82 &&
      JSON.stringify(r2.aiResponse.categories.battery.testIds) === JSON.stringify(["BAT-01"]) &&
      r2.aiResponse.categories.battery.confidence === "عالية" &&
      r2.aiResponse.categories.battery.socAtStart === 55 &&
      r2.aiResponse.categories.battery.socAtEnd === 40,
      "6. [A104 في العمق] categories.battery المحفوظة تحمل كل الحقول الحقيقية (state/letter/coverage/testIds/confidence/socAtStart/socAtEnd) سليمة رغم إعادة البناء حقلاً حقلاً");
  // القرار ٤٢ البند ٣ — letterSource/adjustmentReason/adjustmentEvidence
  // (A62) تصل المخزون سليمة أيضاً — buildCategoryEntryForStorage مُحدَّثة.
  assert(r2.aiResponse.categories.battery.letterSource === "LLM_ADJUSTED" &&
      r2.aiResponse.categories.battery.adjustmentReason === "اختبار A62" &&
      JSON.stringify(r2.aiResponse.categories.battery.adjustmentEvidence) === JSON.stringify(["findings.x"]),
      "6. [القرار ٤٢/٣] categories.battery.letterSource/adjustmentReason/adjustmentEvidence (A62) تصل المخزون سليمة — buildCategoryEntryForStorage مُحدَّثة لهذا الشكل الجديد");
  assert(Array.isArray(r2.aiResponse.issues) && r2.aiResponse.issues.length === 1 &&
      r2.aiResponse.issues[0].id === "ISS-BAT-01" &&
      r2.aiResponse.issues[0].category === "battery" &&
      r2.aiResponse.issues[0].severity === "WARNING" &&
      r2.aiResponse.issues[0].title === "تنبيه في الاختبار BAT-01" &&
      r2.aiResponse.issues[0].evidence === 12.5 &&
      r2.aiResponse.issues[0].evidenceUnit === "mAh",
      "6. [A104 في العمق] issues[0] المحفوظ يحمل كل الحقول الحقيقية (id/category/severity/title/evidence/evidenceUnit) سليمة رغم إعادة البناء حقلاً حقلاً");

  // 7. A112 (القرار ٤٢ البند ٥) — "التعداد يصير مُنفَّذاً لا عُرفاً": كل
  // مفتاح top-level في استجابة العميل V7 إمّا (أ) من الشكل المُشتقّ
  // (aiResponseToSave — نفس ما وصل r2.aiResponse بالضبط، مُتحقَّق منه
  // حرفياً في تحقّق 5 أعلاه) أو (ب) من V7_OPERATIONAL_FIELDS المُصدَّرة
  // (v7OperationalFields.js) — لا ثالث صامت (نمط A106/A108/A112: حقل
  // يُضاف للإرجاع بلا تسجيل في أيّ من الاثنين). هذا تحقّق **على الكائن
  // الحيّ الفعلي** من هذا التشغيل بعينه — لا افتراض شكل، ولا قراءة جدول
  // §٠-٣ في docs/V7_DISPLAY_SHAPE_CONTRACT.md نصّياً (ذلك جدول وصفي يتبع
  // منقولاً من رسالة المنسّق عن مستودع آخر خارج حدودي — راجع تقرير
  // المهمّة تحت "افتراضات": هذا التحقّق يُنفِّذ **جوهر** الشرط ("حقل ليس
  // في display ولا في تلك القائمة") على بيانات حقيقية بدل تحليل ماركداون).
  const knownDisplayKeys = new Set(Object.keys(r2.aiResponse));
  const allowedOperational = new Set(V7_OPERATIONAL_FIELDS);
  const unaccountedKeys = Object.keys(clientResponse2).filter(
      (k) => !knownDisplayKeys.has(k) && !allowedOperational.has(k));
  assert(unaccountedKeys.length === 0,
      `7. [A112] كل مفتاح top-level في استجابة العميل V7 مُحاسَب — إمّا من aiResponseToSave (${[...knownDisplayKeys].join(",")}) ` +
      `أو من V7_OPERATIONAL_FIELDS (${[...allowedOperational].join(",")}) — لا مفتاح ثالث صامت` +
      (unaccountedKeys.length ? ` (وُجد: ${unaccountedKeys.join(",")})` : ""));
  assert(V7_OPERATIONAL_FIELDS.length === 4 &&
      allowedOperational.has("shortId") && allowedOperational.has("isFreeTrial") &&
      allowedOperational.has("aiModel") && allowedOperational.has("deviceMarketingName"),
      "7. [A112] V7_OPERATIONAL_FIELDS تحمل الأربعة المُتَّفَق عليها بالضبط (v7OperationalFields.js — مصدر واحد مُصدَّر، القاعدة 24)");

  override = null; // إعادة الحال الافتراضي

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});

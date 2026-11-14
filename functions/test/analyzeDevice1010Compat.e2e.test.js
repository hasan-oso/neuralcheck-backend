// E2E test: التوافق مع 1.0.10 — شرط النشر (ما قبل أوّل نشر V8، البند ٥، 2026-10-09 +03).
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق): «التوافق مع 1.0.10: الهواتف تبقى على 1.0.10 (fv67) بعد نشر الخادم وحتى صدور التطبيق الجديد.
// فاختبار e2e على العيّنة الذهبية الحقيقية fv67 (34dff2b8) عبر analyzeDevice بالكود الجديد: تقرير يصدر، والخامّ في reportRaw، والرصيد يُحجز
// ويُخصم مرّة واحدة. ومثله لجلسة QR من 1.0.10. بلا ذلك لا نشر.»
//
// **الملفّ الزمني من 1.0.8-v6beta (fv67)، والطلب مبنيّ بكود 1.0.10. فهو حالة إعادة تحليل ملفّ fv67، كما يحدث فعلاً بعد التحديث.** (بنصّ قرار المستخدم.)
// الطلب مشتقّ لا مسجَّل (لم يُرسَل من جهاز ولا من الإنتاج): test/fixtures/golden/fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json —
// نسخة حرفية من مجلّد المنسّق (sha256 9551a9c6… في fv67AppRequestGoldenCopy.test.js)، بنيت بكود NeuralChek@62507f4 من 34dff2b8.ts.json.
// **يُرسَل كما هو**؛ يُضاف إليه sessionId في حالة QR وحدها.
//
// ما يُنفَّذ (المعالجات الحقيقية كلّها عبر .run()، وglobal.fetch وحده مستبدَل — القاعدة 37):
//   أ. طلب فردي: analyzeDevice بـ{scanId, fingerprint, language, usePrecomputed:true}، بمستخدم مسجَّل (password).
//   ب. جلسة QR: المالك createScanSession (بلا بيانات)، والزبون المجهول joinScanSession {code} ثم analyzeDevice بالطلب نفسه + sessionId.
//   جـ. الطلب الفردي نفسه بردّ المزوّد **الحقيقي المجمَّد** لهذا الفحص (انظر أدناه).
//
// ردّ المزوّد المُستبدَل (أ وب) — **ما أعاده global.fetch وسببه:** جسم V7 سليم **مبنيّ من معرّفات الأعطال التي أرسلها الخادم فعلاً**: الكعب يقرأ
// حمولة المستخدم من جسم الطلب إلى DeepSeek (categoryStates.issues[].id) ويُعيد narrative بحقوله الستّة ووصفاً نصّياً عربياً بلا أرقام لكل معرّف + المصفوفات
// الثلاث الفارغة. السبب: **وُجد ردّ مزوّد حقيقي مجمَّد لهذا الفحص** (fixtures/frozen-real-envelope-34dff2b8-accepted-2026-09-23.json — مغلّف DeepSeek
// الفعلي المقبول عند الالتقاط) وجُرِّب أوّلاً على هذا الطلب بعينه فرفضه الحارس الحالي (issueKeys=false numbers=false languageLeaks=14، مرّتين): صفوف
// الاختبارات الستّة عشر في طلب 1.0.10 مُبرمَجة (معرّفات أعطال مثل DISC-CM-01) لا صفوف التشغيل الذي أنتج الردّ المجمَّد (DISC-T-01...). فلا يصلح
// ذلك الردّ مساراً سعيداً لهذا الطلب. فالمسار في أ وب: **سرد كامل مقبول** (v7GuardOk=true، محاولة واحدة، narrativeIncomplete=false).
// وجـ يُبقي الردّ الحقيقي المجمَّد على الطلب نفسه: يُنتج **عرضاً حتمياً بلا سرد** (محاولتان مرفوضتان، narrativeIncomplete=true) وتبقى الضمانات نفسها
// (تقرير، خامّ، خصم واحد) — القيمة المقيسة وقت الكتابة مطبوعة، ولا يُؤكَّد الرفض نفسه (قد يتغيّر الحارس).
//
// بنية الردّ تُقارَن بعيّنة test/fixtures/golden/v7-client-payload-sample.json (سرد كامل مقبول، لغة ar، بلا تعديل نموذج): هي الموافقة لمسار أ وب.
// **لا عيّنة لمسار جـ** (سرد غائب بعد رفض حارس بفحص مقيس غير صفري): لا تُقارَن بعيّنة ولا تُصنَع واحدة — يُبلَّغ بذلك. والمقارنة بنيوية: المفاتيح
// الثابتة مطابقة تماماً؛ وما يظهر شرطياً (letterCeilingReason وgoverningGateReason عند إطلاق بوّابة) يطابق شكل العيّنة؛ ومفاتيح issues[] لا تزيد عليها؛ و
// وصف الأعطال يُدمج في issues[].description (لا narrative.issueDescriptions في الردّ). shortId قيمة عشوائية: يُتحقَّق مفتاحاً وصيغةً (صيغة العيّنة) لا قيمةً.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/analyzeDevice1010Compat.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const REAL_FETCH = global.fetch; // لتفريغ المحاكي وحده (عنوانه محلّي أعلاه)؛ global.fetch نفسه يُستبدَل بكعب المزوّد أدناه

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// Gemini: لا يُستدعى (DeepSeek هو الوحيد؛ الراية مطفأة افتراضياً) — كعب يرمي فيفشل أيّ مرور عليه بصوت عالٍ لا بشبكة.
const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {generateContent: async () => {
        throw new Error("stub gemini: must not be called");
      }};
    }
  }},
};

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {REPORT_RAW_FIELDS} = require("../src/analysis/reportRawStore");
const {V7_PIPELINE_TAG} = require("../src/analysis/pipelineTags");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, "fixtures", "golden");
const REQUEST_FILE = path.join(GOLDEN, "fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json");
const readRequest = () => JSON.parse(fs.readFileSync(REQUEST_FILE, "utf8")); // نسخة جديدة لكل نداء: لا مشاركة كائن بين السيناريوهات
const SAMPLE = JSON.parse(fs.readFileSync(path.join(GOLDEN, "v7-client-payload-sample.json"), "utf8"));
const FROZEN_REAL_ENVELOPE = require("./fixtures/frozen-real-envelope-34dff2b8-accepted-2026-09-23.json").rawEnvelope;

const future = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const MIN = 60 * 1000;

async function reset() {
  const project = process.env.GCLOUD_PROJECT || "demo-nc";
  const res = await REAL_FETCH(`http://${HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, {method: "DELETE"});
  assert.ok(res.ok, "تعذّر تفريغ المحاكي");
}
const getDoc = async (col, id) => (await db.collection(col).doc(id).get());
const call = (data, auth) => analyzeDevice.run({data, auth, rawRequest: {headers: {}}});

// ─── كعب المزوّد (الشبكة وحدها) ───────────────────────────────────────────────────────────────────────────────────
// كلّ نداء: يسجَّل، ويُقرأ رصيد المستخدم المعنيّ لحظة النداء (يثبت أن الفحصة محجوزة قبل نداء النموذج).
function installProvider({kind, watchUid}) {
  const state = {calls: 0, balanceAtCall: [], issueIdsSent: []};
  global.fetch = async (url, opts) => {
    state.calls++;
    if (watchUid) state.balanceAtCall.push((await getDoc("users", watchUid)).data().scansRemaining);
    let envelope;
    if (kind === "frozen-real") {
      envelope = JSON.parse(JSON.stringify(FROZEN_REAL_ENVELOPE));
    } else {
      const body = JSON.parse(opts.body);
      const userMessage = body.messages.find((m) => m.role === "user").content;
      const payload = JSON.parse(userMessage.replace(/\n\nProduce the analysis JSON now\.$/, ""));
      const ids = ((payload.categoryStates && payload.categoryStates.issues) || []).map((i) => i.id);
      state.issueIdsSent = ids;
      const content = {
        narrative: {
          summary: "ملخّص اختبار سليم الشكل", details: "تفاصيل اختبار سليمة الشكل", verdict: "حكم اختبار سليم الشكل",
          buyerAdvice: {casual: "نصيحة اختبار للمشتري العادي", gamer: "نصيحة اختبار للاعب", photographer: "نصيحة اختبار للمصوّر"},
          issueDescriptions: Object.fromEntries(ids.map((id) => [id, "وصف اختبار للعطب"])),
        },
        crossChecks: [], adjustments: [], modelObservations: [],
      };
      envelope = {choices: [{message: {content: JSON.stringify(content)}, finish_reason: "stop"}],
        usage: {prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 20}};
    }
    return {ok: true, status: 200, json: async () => envelope, text: async () => ""};
  };
  return state;
}

// ─── مقارنة بنية الردّ بالعيّنة ───────────────────────────────────────────────────────────────────────────────────
function pathsOf(root) {
  const out = new Map(); // path -> Set(kinds)
  const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  const walk = (v, p) => {
    if (Array.isArray(v)) {
      for (const el of v) if (el !== null && typeof el === "object") walk(el, `${p}[]`);
      return;
    }
    if (v !== null && typeof v === "object") {
      for (const k of Object.keys(v)) {
        const q = p ? `${p}.${k}` : k;
        if (!out.has(q)) out.set(q, new Set());
        out.get(q).add(kind(v[k]));
        walk(v[k], q);
      }
    }
  };
  walk(root, "");
  return out;
}
const COND_RE = /(^|\.)(letterCeilingReason|governingGateReason)\./;
const genericCond = (p) => p.replace(/^categories\.[^.]+\./, "categories.*.");
function compareStructure(resp, sample) {
  const a = pathsOf(resp);
  const b = pathsOf(sample);
  const problems = [];
  const fixed = (m) => [...m.keys()].filter((p) => !COND_RE.test(p) && !p.includes("[]"));
  const fa = new Set(fixed(a));
  const fb = new Set(fixed(b));
  for (const p of fb) if (!fa.has(p)) problems.push(`missing fixed path: ${p}`);
  for (const p of fa) if (!fb.has(p)) problems.push(`unknown fixed path: ${p}`);
  for (const p of a.keys()) {
    if (p.includes("[]") && !b.has(p)) problems.push(`unknown array-element path: ${p}`);
  }
  const condSample = new Set([...b.keys()].filter((p) => COND_RE.test(p)).map(genericCond));
  for (const p of a.keys()) if (COND_RE.test(p) && !condSample.has(genericCond(p))) problems.push(`unknown conditional path: ${p}`);
  // الأنواع على المسار العامّ (categories.* مجموعة عبر الفئات الخمس عشرة): حقل قابل للقيمة الخالية يظهر null في فئة وسلسلة في أخرى،
  // فالمقارنة فئة بفئة بين فحصين مختلفين ضجيج لا انجراف. null متوافق مع أيّ نوع (غياب قيمة، لا نوع آخر).
  const kindsByGeneric = (m) => {
    const g = new Map();
    for (const [p, kinds] of m) {
      const key = genericCond(p);
      if (!g.has(key)) g.set(key, new Set());
      for (const k of kinds) g.get(key).add(k);
    }
    return g;
  };
  const ga = kindsByGeneric(a);
  const gb = kindsByGeneric(b);
  for (const [p, kinds] of ga) {
    if (!gb.has(p)) continue;
    const sampleNonNull = [...gb.get(p)].filter((k) => k !== "null");
    if (sampleNonNull.length === 0) {
      // العيّنة لا تحمل قيمة غير خالية على هذا المسار: لا تُنمِّطه — يُعلَن (لا يُقرأ تطابقاً) ويُطبع في آخر التشغيل.
      if ([...kinds].some((k) => k !== "null")) UNTYPED_BY_SAMPLE.add(p);
      continue;
    }
    for (const k of kinds) {
      if (k !== "null" && !sampleNonNull.includes(k)) problems.push(`kind drift at ${p}: ${k} not in [${sampleNonNull}]`);
    }
  }
  return problems;
}
const UNTYPED_BY_SAMPLE = new Set();
const SHORT_ID_FORMAT =/^NC-[A-Z0-9]{6}$/;
const dropNarrativeDetailsVerdict = (aiResponse) => {
  const copy = JSON.parse(JSON.stringify(aiResponse));
  if (copy.narrative) {
    delete copy.narrative.details;
    delete copy.narrative.verdict;
  }
  return copy;
};
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};

// تأكيدات الأثر المشتركة: تقرير مقروء بلا الخمسة، وخامّ في reportRaw، وقفل محوّ.
async function assertReportAndRaw({scanId, request, expectedUserId, expectedSessionId, label, expectedPipelineAttempts}) {
  const rep = await getDoc("reports", scanId);
  ok(rep.exists, `${label}: reports/{scanId} موجود (التقرير صدر)`);
  const r = rep.data();
  eq(r.pipeline, V7_PIPELINE_TAG, `${label}: pipeline=V7`);
  eq(r.userId, expectedUserId, `${label}: التقرير منسوب إلى ${expectedUserId === "u-1010" ? "المستخدم" : "مالك الجلسة"} لا إلى الجهاز`);
  ok(REPORT_RAW_FIELDS.every((f) => !(f in r)), `${label}: المفاتيح الخمسة غائبة من التقرير المقروء`);
  eq(r.fieldsVersion, 67, `${label}: fieldsVersion=67 مرآة في المستند (من footer الطلب)`);
  eq(r.appVersion, "1.0.8-v6beta", `${label}: appVersion من header الملفّ الزمني`);
  ok(typeof r.shortId === "string" && SHORT_ID_FORMAT.test(r.shortId), `${label}: shortId مولَّد في المستند بصيغة العيّنة`);

  const rawSnap = await getDoc("reportRaw", scanId);
  ok(rawSnap.exists, `${label}: reportRaw/{scanId} موجود (الخامّ في مستند لا يقرؤه العميل)`);
  const raw = rawSnap.data();
  const ts = request.fingerprint.timeSeries;
  eq(raw.source, "analyzeDevice", `${label}: source=analyzeDevice`);
  eq(raw.scanId, scanId, `${label}: scanId`);
  eq(raw.sessionId, expectedSessionId, `${label}: sessionId في reportRaw ${expectedSessionId ? "= معرّف الجلسة" : "null (فحص مباشر)"}`);
  eq(raw.deviceFingerprintSha, ts.header.deviceFingerprint, `${label}: deviceFingerprintSha = header.deviceFingerprint من الطلب`);
  eq(raw.timeSeriesStoragePath, `scans/${ts.header.deviceFingerprint}/${scanId}.ts.json.gz`, `${label}: مسار Storage المشتقّ`);
  ok(!("userId" in raw), `${label}: reportRaw بلا userId`);
  eq(raw.rawFingerprint.timeSeries.samplesCount, 1606, `${label}: البصمة المخزَّنة مخفَّفة: samplesCount=1606`);
  ok(!("samples" in raw.rawFingerprint.timeSeries), `${label}: وبلا samples`);
  eq(raw.rawFingerprint.timeSeries.header.appVersion, "1.0.8-v6beta", `${label}: header.appVersion حرفياً من الطلب`);
  eq(raw.rawFingerprint.timeSeries.footer.fieldsVersion, 67, `${label}: footer.fieldsVersion=67 حرفياً`);
  eq(raw.rawFingerprint.functionalResults.length, request.fingerprint.functionalResults.length, `${label}: functionalResults كلّها (${request.fingerprint.functionalResults.length})`);
  eq(stable(raw.rawFingerprint.device.deviceProfileKey), stable(request.fingerprint.device.deviceProfileKey), `${label}: device.deviceProfileKey حرفياً (القيم البديلة synthetic-golden-*)`);
  ok(raw.aiAudit && typeof raw.aiAudit === "object" && raw.aiAudit.regeneration && raw.aiAudit.regeneration.attempts === expectedPipelineAttempts,
      `${label}: aiAudit في reportRaw، محاولات النموذج = ${expectedPipelineAttempts}`);
  ok(!(await getDoc("scanClaims", scanId)).exists, `${label}: قفل scanClaims محوّ (لا حجز عالق)`);
  return {report: r, raw};
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // أ — طلب فردي من 1.0.10
  // ═══════════════════════════════════════════════════════════════════
  await reset();
  const UID = "u-1010";
  await db.collection("users").doc(UID).set({scansRemaining: 5, scansTotal: 5, plan: "single", isActive: true, expiresAt: future()});
  const requestA = readRequest();
  const scanId = requestA.scanId;
  const providerA = installProvider({kind: "synthetic-valid", watchUid: UID});
  const retA = await call(readRequest(), {uid: UID, token: tokenOf("password")});

  eq(providerA.calls, 1, "[أ] نداء واحد للمزوّد (سرد مقبول من أوّل محاولة)");
  deepEq(providerA.balanceAtCall, [4], "[أ] الرصيد لحظة نداء المزوّد = 4: الفحصة حُجزت قبل النداء");
  const {report: repA} = await assertReportAndRaw({scanId, request: requestA, expectedUserId: UID, expectedSessionId: null, label: "[أ]", expectedPipelineAttempts: 1});
  eq((await getDoc("users", UID)).data().scansRemaining, 4, "[أ] الرصيد بعد الفحص: 5 ← 4 (خُصمت فحصة واحدة)");
  eq(repA.v5Metrics.v7GuardOk, true, "[أ] الحارس قبل الردّ (المسار: سرد كامل)");
  eq(retA.narrativeIncomplete, false, "[أ] narrativeIncomplete=false (لا حقل سرد مفقود)");
  eq(retA.pipeline, V7_PIPELINE_TAG, "[أ] الردّ pipeline=V7");
  eq(retA.isFreeTrial, false, "[أ] isFreeTrial=false (خطّة single)");
  ok(typeof retA.shortId === "string" && SHORT_ID_FORMAT.test(retA.shortId) && SHORT_ID_FORMAT.test(SAMPLE.shortId), "[أ] shortId في الردّ والعيّنة بالصيغة نفسها NC-XXXXXX (القيمة عشوائية فلا تُقارَن)");
  eq(retA.shortId, repA.shortId, "[أ] وshortId الردّ = المحفوظ");
  const problemsA = compareStructure(retA, SAMPLE);
  deepEq(problemsA, [], "[أ] بنية الردّ مطابقة لعيّنة v7-client-payload-sample.json (المفاتيح الثابتة، الأنواع، الشرطيات، عناصر issues[])");
  ok(["narrative", "narrativeIncompleteFields"].every((k) => k in retA), "[أ] مفاتيح السرد حاضرة");
  ok(!("details" in retA.narrative) && !("verdict" in retA.narrative), "[أ] narrative.details/verdict محذوفان من الردّ (S6) ومحفوظان في المستند");
  ok("details" in repA.aiResponse.narrative && "verdict" in repA.aiResponse.narrative, "[أ] والمحفوظ يحملهما");
  ok(!("issueDescriptions" in retA.narrative), "[أ] لا narrative.issueDescriptions في الردّ: الوصف يُدمج في issues[].description (كما في العيّنة)");
  ok(retA.issues.length === providerA.issueIdsSent.length && retA.issues.length > 0 && retA.issues.every((i) => i.description === "وصف اختبار للعطب"),
      "[أ] لكل عطب أرسله الخادم وصف من ردّ المزوّد في issues[].description");
  // استُبدل (القاعدة 23، V8 قبل نشر الأمان 2026-10-09) تأكيد «لا ملفّ جهاز: deviceProfileKey بأسمائه الكاملة بلا مفتاح a» — كان يُثبت العطب نفسه (analyzeDevice
  // يتخطّى كتلة deviceProfiles كلّها حين يغيب `.a`) — بتأكيد الحال الصحيحة: المُطبِّع يقرأ الأسماء الكاملة (بُنيت هذه الحمولة في JVM) فيُكتب ملفّ الجهاز بطبقاته
  // الحقيقية (القيم البديلة synthetic-golden-*) لا الحرّاس. وحمولة R8 (a..f) والشكلان المتعارضان وغيرهما: deviceProfileKeyShapes.e2e.test.js.
  const keyA = requestA.fingerprint.device.deviceProfileKey;
  const profA = await getDoc("deviceProfiles", keyA.primary);
  ok(profA.exists, "[أ] ملفّ جهاز مكتوب: deviceProfileKey بأسمائه الكاملة يُقرأ فلا تُتخطَّى كتلة deviceProfiles");
  const profAData = profA.data();
  eq(profAData.primaryFingerprint, "synthetic-golden-primary", "[أ] ملفّ الجهاز: primaryFingerprint من الحقل primary");
  ok(["layerA_keystore", "layerB_firebaseId", "layerC_androidId", "layerD_buildSig", "layerE_sensorSig"].every((k) => profAData[k] === keyA[k] && /^synthetic-golden-layer-[a-e]$/.test(profAData[k])),
      "[أ] وطبقاته الخمس القيم الحقيقية من الحمولة لا قيم الحارس");
  eq(profAData.scanHistory.length, 1, "[أ] وتاريخه فحص واحد");

  // إعادة الطلب بالمعرّف نفسه
  const retryA = await call(readRequest(), {uid: UID, token: tokenOf("password")});
  eq(providerA.calls, 1, "[أ] إعادة الطلب: لا نداء ثانٍ للمزوّد");
  eq((await getDoc("users", UID)).data().scansRemaining, 4, "[أ] إعادة الطلب: لا خصم ثانٍ (4)");
  eq(stable(retryA), stable(dropNarrativeDetailsVerdict(repA.aiResponse)), "[أ] إعادة الطلب تُرجع المحفوظ حرفياً (بعد طرح narrative.details/verdict وحدهما)");
  deepEq(compareStructure({...retryA}, (() => { const {shortId: _s, isFreeTrial: _f, aiModel: _m, deviceMarketingName: _d, ...core} = SAMPLE; return core; })()), [],
      "[أ] وبنية المُعاد من التقرير الموجود مطابقة للعيّنة بعد طرح الحقول التشغيلية الأربعة (لا تُعاد من التقرير الموجود)");
  console.log("تحقّق أ: الطلب الفردي من 1.0.10");

  // ═══════════════════════════════════════════════════════════════════
  // ب — جلسة QR من 1.0.10 (المالك ينشئ، الزبون المجهول ينضمّ ثم يحلّل)
  // ═══════════════════════════════════════════════════════════════════
  await reset();
  const OWNER = "owner-1010";
  const ANON = "anon-device-1010";
  await db.collection("users").doc(OWNER).set({scansRemaining: 5, scansTotal: 5, plan: "shop_pro", isActive: true, expiresAt: future()});
  const providerB = installProvider({kind: "synthetic-valid", watchUid: OWNER});
  const created = await createScanSession.run({data: {}, auth: {uid: OWNER, token: tokenOf("google.com")}, rawRequest: {headers: {}}});
  ok(created && typeof created.sessionId === "string" && /^NC-[A-Z0-9]{6}$/.test(created.code), "[ب] المالك أنشأ الجلسة بلا بيانات (كما يفعل 1.0.10)");
  eq((await getDoc("users", OWNER)).data().scansRemaining, 5, "[ب] إنشاء الجلسة لا يخصم");
  const joined = await joinScanSession.run({data: {code: created.code}, auth: {uid: ANON, token: tokenOf("anonymous")}, rawRequest: {headers: {}}});
  eq(joined.sessionId, created.sessionId, "[ب] الزبون المجهول انضمّ بـ{code} وأخذ sessionId");
  eq(joined.status, "scanning", "[ب] الجلسة scanning");
  const requestB = readRequest();
  const dataB = {...readRequest(), sessionId: joined.sessionId}; // الطلب كما هو + sessionId (حالة QR وحدها)
  const retB = await call(dataB, {uid: ANON, token: tokenOf("anonymous")});

  eq(providerB.calls, 1, "[ب] نداء واحد للمزوّد");
  deepEq(providerB.balanceAtCall, [4], "[ب] رصيد المالك لحظة نداء المزوّد = 4: حُجزت فحصته قبل النداء");
  const {report: repB} = await assertReportAndRaw({scanId: requestB.scanId, request: requestB, expectedUserId: OWNER, expectedSessionId: joined.sessionId, label: "[ب]", expectedPipelineAttempts: 1});
  eq((await getDoc("users", OWNER)).data().scansRemaining, 4, "[ب] المالك: 5 ← 4 (خُصم مرّة واحدة)");
  ok(!(await getDoc("users", ANON)).exists, "[ب] لا مستند للزبون المجهول (لا رصيد ولا مستند)");
  const anonScans = (await db.collection("users").where("scansRemaining", ">=", 0).get()).docs.map((d) => d.id);
  deepEq(anonScans, [OWNER], "[ب] ولم يُنشأ لأحد غير المالك مستند رصيد");
  eq(repB.isFreeTrial, false, "[ب] isFreeTrial=false (خطّة المالك shop_pro)");
  const sess = (await getDoc("scanSessions", joined.sessionId)).data();
  eq(sess.status, "completed", "[ب] الجلسة completed");
  eq(sess.scanId, requestB.scanId, "[ب] والجلسة تحمل scanId");
  eq(retB.shortId, repB.shortId, "[ب] shortId الردّ = المحفوظ");
  eq(sess.shortId, repB.shortId, "[ب] shortId في الجلسة = المحفوظ");
  deepEq(compareStructure(retB, SAMPLE), [], "[ب] بنية الردّ مطابقة لعيّنة v7-client-payload-sample.json");
  eq(retB.isFreeTrial, false, "[ب] isFreeTrial=false في الردّ");

  // إعادة الطلب بالمعرّف نفسه بعد اكتمال الجلسة. A-SUB الموجة الأولى (قرار المستخدم ١٢، «التقرير المخزَّن أولاً مع reasonCode»): كان يُرفض «جلسة الفحص غير صالحة» (الردّ الضائع يضيع)؛ الآن الجهاز
  // المنضمّ نفسه (ANON) بـscanId الجلسة نفسه وتقرير مخزَّن ملكيته لمالك الجلسة ⟵ يُقدَّم الردّ المخزَّن بعينه، بلا خصم ثانٍ ولا نداء مزوّد (استُبدل ما كان يثبّت الرفض، القاعدة 23).
  const retryRes = await call({...readRequest(), sessionId: joined.sessionId}, {uid: ANON, token: tokenOf("anonymous")});
  eq(stable(retryRes), stable(dropNarrativeDetailsVerdict(repB.aiResponse)), "[ب] إعادة الطلب بـsessionId بعد اكتمال الجلسة من الجهاز المنضمّ نفسه: يُقدَّم الردّ المخزَّن لا الرفض");
  // غير الطرف بالجلسة نفسها: يُرفض ولا يُسرَّب (الرمز والنصّ القائمان + reasonCode)
  let strangerErr = null;
  try {
    await call({...readRequest(), sessionId: joined.sessionId}, {uid: "stranger-1010", token: tokenOf("anonymous")});
  } catch (e) {
    strangerErr = e;
  }
  ok(strangerErr && strangerErr.code === "permission-denied" && /جلسة الفحص غير صالحة/.test(strangerErr.message) && strangerErr.details && strangerErr.details.reasonCode === "SESSION_NOT_PARTICIPANT",
      "[ب] إعادة الطلب بـsessionId من غير طرف الجلسة: تُرفض («جلسة الفحص غير صالحة») بالرمز SESSION_NOT_PARTICIPANT");
  eq(providerB.calls, 1, "[ب] ولا نداء ثانٍ للمزوّد");
  eq((await getDoc("users", OWNER)).data().scansRemaining, 4, "[ب] ولا خصم ثانٍ من المالك (4)");
  // المالك يعيد فتح التقرير بمعرّفه (بلا sessionId): يُعاد المحفوظ بلا خصم
  const reopen = await call({scanId: requestB.scanId, usePrecomputed: true}, {uid: OWNER, token: tokenOf("google.com")});
  eq(stable(reopen), stable(dropNarrativeDetailsVerdict(repB.aiResponse)), "[ب] المالك يعيد فتح التقرير بمعرّفه: يُعاد المحفوظ");
  eq((await getDoc("users", OWNER)).data().scansRemaining, 4, "[ب] بلا خصم (4)");
  eq(providerB.calls, 1, "[ب] وبلا نداء مزوّد");
  console.log("تحقّق ب: جلسة QR من 1.0.10");

  // ═══════════════════════════════════════════════════════════════════
  // جـ — الطلب الفردي نفسه بردّ المزوّد الحقيقي المجمَّد لـ34dff2b8
  // ═══════════════════════════════════════════════════════════════════
  await reset();
  await db.collection("users").doc(UID).set({scansRemaining: 5, scansTotal: 5, plan: "single", isActive: true, expiresAt: future()});
  const providerC = installProvider({kind: "frozen-real", watchUid: UID});
  const requestC = readRequest();
  const retC = await call(readRequest(), {uid: UID, token: tokenOf("password")});
  ok(providerC.calls >= 1 && providerC.calls <= 2, "[جـ] محاولة أو محاولتان للمزوّد (الأولى ثم إعادة توليد واحدة)");
  ok(providerC.balanceAtCall.every((b) => b === 4), "[جـ] الرصيد عند كلّ نداء = 4 (محجوز قبل النداء)");
  const {report: repC, raw: rawC} = await assertReportAndRaw({scanId: requestC.scanId, request: requestC, expectedUserId: UID, expectedSessionId: null, label: "[جـ]", expectedPipelineAttempts: providerC.calls});
  eq((await getDoc("users", UID)).data().scansRemaining, 4, "[جـ] الرصيد 5 ← 4 (خصم واحد حتى مع محاولتين للنموذج)");
  eq(retC.pipeline, V7_PIPELINE_TAG, "[جـ] الردّ V7");
  ok(typeof retC.overall === "object" && "categories" in retC && Array.isArray(retC.issues), "[جـ] الردّ يحمل overall وcategories وissues");
  console.log(`[جـ] المسار المقيس: v7GuardOk=${repC.v5Metrics.v7GuardOk} narrativeIncomplete=${retC.narrativeIncomplete} محاولات=${providerC.calls} ` +
      `مفاتيح السرد المحذوفة=${rawC.aiAudit.regeneration.droppedFields.length} — لا عيّنة لهذا المسار فلا مقارنة بنيوية (يُبلَّغ ولا تُصنَع)`);
  console.log("تحقّق جـ: الطلب الفردي بردّ المزوّد الحقيقي المجمَّد");

  console.log(`[مقارنة العيّنة] مسارات تحمل قيمة غير خالية في الردّ وخالية دائماً في العيّنة (العيّنة لا تُنمِّطها: لا تطابقاً ولا انجرافاً): ${[...UNTYPED_BY_SAMPLE].sort().join(", ") || "لا شيء"}`);
  await admin.app().delete().catch(() => {});
  console.log(`\nALL PASS (${n} assertions)`);
})().catch((e) => {
  console.error("FAIL:", e && e.stack || e);
  process.exit(1);
});

function deepEq(a, b, m) {
  assert.deepStrictEqual(a, b, m);
  n++;
}

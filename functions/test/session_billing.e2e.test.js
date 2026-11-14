// End-to-end test for the shop-session billing fix (fix/shop-session-billing).
//
// Exercises the REAL analyzeDevice callable (via its v2 `.run()` test entry)
// against the Firestore EMULATOR. The AI HTTP call is stubbed (global.fetch),
// so no network and no DeepSeek/Gemini spend.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/session_billing.e2e.test.js"
//
// 2026-10-09 (ملفّات e2e الستّ قبل أوّل نشر V8، القاعدة 23 — استبدال لا إضافة): الحالتان 1 و4 كانتا تؤكّدان
// `typeof ret.grade === "string"` وCANNED_AI بشكل V6؛ المسار الحيّ V7 بلا grade (القرار ٥) وجسم V6 يرفضه الحارس. صار الكعب
// جسم V7 سليماً (lib/v7ProviderStub.js) والتأكيد على pipeline=V7 و`overall`.
//
// Covers the auth-gate priority (sessionId BEFORE request.auth):
//   1. valid session  -> bill the OWNER, report.userId=owner, session=completed
//   2. owner no credit -> rejected on the OWNER (not the anonymous device)
//   3. invalid session (completed) + 3b expired -> not billed, correct fallback
//   4. personal scan (no sessionId) -> bills the signed-in user (no regression)

// ---- env + AI stub (must be set before requiring the function) ----
require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";

// الاستبدال للشبكة وحدها (القاعدة 37): ردّ مزوّد V7 سليم الشكل.
const {installDeepSeekStub} = require("./lib/v7ProviderStub");
installDeepSeekStub();
const {V7_PIPELINE_TAG} = require("../src/analysis/pipelineTags");
const isV7Analysis = (r) => !!(r && r.pipeline === V7_PIPELINE_TAG && r.overall && typeof r.overall === "object");

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {joinScanSession} = require("../src/sessions/joinScanSession");

const FINGERPRINT = {
  device: {model: "TestPhone", androidVersion: "14", totalRamGb: 8},
  timeSeries: {header: {}, footer: {}, samples: [], variables: []},
  functionalResults: [],
  manualResults: [],
};

const results = [];
let failures = 0;
function assert(cond, name) {
  if (cond) {
    results.push(`PASS  ${name}`);
  } else {
    failures++;
    results.push(`FAIL  ${name}`);
  }
}

function future() {
  return new Date(Date.now() + 10 * 60 * 1000); // +10 min
}
// قرار مستخدم 2026-09-30 +03 («قرار — مهلة الجلسة ساعة»، يُبطل نافذة
// "60 من الانضمام" في fbcc74c بالكامل): نافذة واحدة، 60 دقيقة من الإنشاء،
// مخزَّنة في scanSessions.expiresAt (createScanSession.js) — للانضمام
// والتحليل والتقييم معاً. "n دقيقة مضت منذ الإنشاء" — expiresAt المقابلة
// = "الآن" + (60-n) دقيقة (الجلسة أُنشئت قبل n دقيقة، فتنتهي بعد 60-n
// دقيقة من الآن).
function expiresAtForMinutesAfterCreation(n) {
  return new Date(Date.now() + (60 - n) * 60 * 1000);
}

// Invoke the real callables through their v2 test entry points.
async function callAnalyze({data, auth}) {
  return analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
}
async function callJoin({data, auth}) {
  return joinScanSession.run({data, auth, rawRequest: {headers: {}}});
}

async function seedUser(uid, fields) {
  await db.collection("users").doc(uid).set(fields);
}
async function seedSession(id, fields) {
  await db.collection("scanSessions").doc(id).set(fields);
}
async function getUserScans(uid) {
  const s = await db.collection("users").doc(uid).get();
  return s.exists ? (s.data().scansRemaining) : null;
}

(async () => {
  // ===== Case 1: valid session -> bill OWNER =====
  {
    await seedUser("ownerA", {scansRemaining: 5, scansTotal: 5, plan: "shop_basic"});
    await seedSession("sessA", {
      ownerId: "ownerA", status: "scanning", expiresAt: future(), code: "NC-T1",
    });
    let threw = null; let ret = null;
    try {
      ret = await callAnalyze({
        data: {scanId: "scan-c1", fingerprint: FINGERPRINT, sessionId: "sessA", usePrecomputed: true},
        auth: {uid: "anon-c1", token: {}},
      });
    } catch (e) {
      threw = e;
    }
    assert(threw === null, "1. valid session: no error thrown (no 'no credit')");
    assert(isV7Analysis(ret), "1. valid session: analysis returned (the V7 analysis)");
    assert((await getUserScans("ownerA")) === 4, "1. valid session: OWNER scansRemaining 5 -> 4");
    const rep = await db.collection("reports").doc("scan-c1").get();
    assert(rep.exists && rep.data().userId === "ownerA", "1. valid session: report.userId == ownerId");
    const anon = await db.collection("users").doc("anon-c1").get();
    assert(!anon.exists, "1. valid session: anonymous device NOT billed (no user doc)");
    const sess = await db.collection("scanSessions").doc("sessA").get();
    assert(sess.data().status === "completed", "1. valid session: session -> completed");
  }

  // ===== Case 2: owner has no credit -> rejected on OWNER =====
  {
    await seedUser("ownerB", {scansRemaining: 0, scansTotal: 0, plan: "shop_basic"});
    await seedSession("sessB", {ownerId: "ownerB", status: "scanning", expiresAt: future()});
    let threw = null;
    try {
      await callAnalyze({
        data: {scanId: "scan-c2", fingerprint: FINGERPRINT, sessionId: "sessB", usePrecomputed: true},
        auth: {uid: "anon-c2", token: {}},
      });
    } catch (e) {
      threw = e;
    }
    assert(threw && threw.code === "permission-denied" && /رصيد/.test(threw.message),
        "2. owner no credit: rejected with 'no credit' on the owner");
    assert((await getUserScans("ownerB")) === 0, "2. owner no credit: owner stays at 0 (not negative)");
    const rep = await db.collection("reports").doc("scan-c2").get();
    assert(!rep.exists, "2. owner no credit: no report created");
  }

  // ===== Case 3: invalid session (completed) -> not billed =====
  {
    await seedUser("ownerC", {scansRemaining: 5, scansTotal: 5, plan: "shop_basic"});
    await seedSession("sessC", {ownerId: "ownerC", status: "completed", expiresAt: future()});
    let threw = null;
    try {
      await callAnalyze({
        data: {scanId: "scan-c3", fingerprint: FINGERPRINT, sessionId: "sessC", usePrecomputed: true},
        auth: {uid: "anon-c3", token: {}},
      });
    } catch (e) {
      threw = e;
    }
    assert(threw && threw.code === "permission-denied" && /غير صالحة/.test(threw.message),
        "3. invalid session (completed): rejected as invalid");
    assert((await getUserScans("ownerC")) === 5, "3. invalid session: owner NOT billed (stays 5)");
  }

  // ═══════════════════════════════════════════════════════════════════
  // الحالات 3b-3e أدناه استُبدلت بالكامل (القاعدة 23) — قرار مستخدم لاحق
  // («قرار — مهلة الجلسة ساعة»، 2026-09-30 +03) أبطل نافذتَي fbcc74c
  // (15 للانضمام، ثم 60 أخرى من الانضمام) وردّهما إلى نافذة واحدة: 60
  // دقيقة من الإنشاء (expiresAt)، للانضمام والتحليل والتقييم معاً. الحالتان
  // القديمتان "انضمام في الدقيقة 16 يُرفض" و"تحليل 66 دقيقة بعد الانضمام
  // يُرفض" كانتا صحيحتين تحت قاعدة fbcc74c فقط — تحت القاعدة الجديدة
  // الانضمام في الدقيقة 16 **يُقبل** (لا يزال ضمن الساعة)، فتركهما كما
  // هما كان سيُثبت سلوكاً خاطئاً الآن.
  // ═══════════════════════════════════════════════════════════════════

  // ===== Case 3b (بديل — نصّ الأمر حرفياً): "تحليل في الدقيقة 61 يُرفض" =====
  {
    await seedUser("ownerD", {scansRemaining: 5, scansTotal: 5, plan: "shop_basic"});
    await seedSession("sessD", {
      ownerId: "ownerD", status: "scanning", expiresAt: expiresAtForMinutesAfterCreation(61),
    });
    let threw = null;
    try {
      await callAnalyze({
        data: {scanId: "scan-c3b", fingerprint: FINGERPRINT, sessionId: "sessD", usePrecomputed: true},
        auth: {uid: "anon-c3b", token: {}},
      });
    } catch (e) {
      threw = e;
    }
    assert(threw && threw.code === "failed-precondition" && /منتهية/.test(threw.message),
        "3b. [نصّ الأمر حرفياً] analysis at minute 61: rejected as expired (same code/text, unchanged)");
    assert((await getUserScans("ownerD")) === 5, "3b. session expired: owner NOT billed (stays 5)");
  }

  // ===== Case 3c (بديل — نصّ الأمر حرفياً): "تحليل في الدقيقة 50 يُقبل" =====
  {
    await seedUser("ownerE", {scansRemaining: 5, scansTotal: 5, plan: "shop_basic"});
    await seedSession("sessE3c", {
      ownerId: "ownerE", status: "scanning", expiresAt: expiresAtForMinutesAfterCreation(50),
    });
    let threw = null; let ret = null;
    try {
      ret = await callAnalyze({
        data: {scanId: "scan-c3c", fingerprint: FINGERPRINT, sessionId: "sessE3c", usePrecomputed: true},
        auth: {uid: "anon-c3c", token: {}},
      });
    } catch (e) {
      threw = e;
    }
    assert(threw === null, "3c. [نصّ الأمر حرفياً] analysis at minute 50: ACCEPTED — no error");
    // (كان هنا تعليق عن ركود CANNED_AI وفشل الحالتين 1/4 — أُصلحا في 2026-10-09: الكعب جسم V7، والتأكيد على الشكل الحيّ.)
    assert(isV7Analysis(ret), "3c. analysis returned (the V7 analysis)");
    assert((await getUserScans("ownerE")) === 4, "3c. owner charged (5 -> 4)");
  }

  // ===== Case 3d (جديد بنصّ الأمر): session "scanning" بلا expiresAt إطلاقاً —
  // تعارض داخلي لا يُفترَض وقوعه (createScanSession.js يكتبه دائماً عند
  // الإنشاء)، لكن الغياب لا يُقرأ "صالحة بلا حدّ" (القاعدة 22). كتابة مباشرة
  // لا عبر seedSession كي لا يحمل المستند مفتاح expiresAt إطلاقاً. =====
  {
    await seedUser("ownerF", {scansRemaining: 5, scansTotal: 5, plan: "shop_basic"});
    await db.collection("scanSessions").doc("sessF3d").set({
      ownerId: "ownerF", status: "scanning", code: "NC-T3D",
    });
    let threw = null;
    try {
      await callAnalyze({
        data: {scanId: "scan-c3d", fingerprint: FINGERPRINT, sessionId: "sessF3d", usePrecomputed: true},
        auth: {uid: "anon-c3d", token: {}},
      });
    } catch (e) {
      threw = e;
    }
    assert(threw && threw.code === "permission-denied" && /غير صالحة/.test(threw.message),
        "3d. [نصّ الأمر: جلسة بلا expiresAt تُرفض] rejected — «جلسة الفحص غير صالحة» (permission-denied), not unlimited validity");
    assert((await getUserScans("ownerF")) === 5, "3d. session without expiresAt: owner NOT billed (stays 5)");
  }

  // ===== Case 3e (بديل — نصّ الأمر حرفياً): "انضمام في الدقيقة 30 يُقبل" =====
  // (joinScanSession.js لم يتغيّر — يقرأ expiresAt نفسها، فسرى عليه توحيد
  // النافذة تلقائياً؛ هذا أوّل اختبار لـjoinScanSession في هذا المستودع.)
  {
    await seedSession("sessE3e", {
      ownerId: "ownerG", status: "pending", code: "NC-T30",
      expiresAt: expiresAtForMinutesAfterCreation(30),
    });
    let threw = null; let ret = null;
    try {
      ret = await callJoin({data: {code: "NC-T30"}, auth: null});
    } catch (e) {
      threw = e;
    }
    assert(threw === null, "3e. [نصّ الأمر حرفياً] join at minute 30: ACCEPTED — no error");
    assert(ret && ret.status === "scanning", "3e. join accepted: response status=scanning");
    const sessAfter = await db.collection("scanSessions").doc("sessE3e").get();
    assert(sessAfter.data().status === "scanning", "3e. join accepted: session flipped to scanning");
    assert(!!sessAfter.data().joinedAt, "3e. join accepted: joinedAt recorded (joinScanSession.js:50, unchanged)");
  }

  // ===== Case 3f (إضافي — يحافظ على تغطية "انضمام مرفوض" بعد استبدال
  // 3e القديمة؛ ويحافظ على اكتشاف عرَضي سابق حقيقي، لا افتراضاً): انضمام
  // بعد الساعة الموحَّدة -> مرفوض، بنفس رمز/نصّ joinScanSession.js:46
  // (لم يتغيّر). =====
  {
    await seedSession("sessE3f", {
      ownerId: "ownerH", status: "pending", code: "NC-T65",
      expiresAt: expiresAtForMinutesAfterCreation(65),
    });
    let threw = null;
    try {
      await callJoin({data: {code: "NC-T65"}, auth: null});
    } catch (e) {
      threw = e;
    }
    assert(threw && threw.code === "deadline-exceeded" && /انتهت/.test(threw.message),
        "3f. join at minute 65 (beyond the unified 60-min window): rejected as expired code — same code/text, unchanged");
    // الدفعة ٩ (2026-10-10 +03) — القاعدة 23: استبدال لا إضافة. كان هنا تأكيدٌ يُثبت العطب الذي اكتُشف بتشغيل فعلي على المحاكي: joinScanSession كانت
    // تستدعي `tx.update(sessionRef, {status: "expired"})` ثمّ ترمي داخل دالّة المعاملة نفسها، وFirestore تُسقِط كل كتابات المعاملة حين ترمي دالّتها،
    // فكان التأكيد `status === "pending"` («الجلسة تبقى pending»). أُصلح العطب (تُرجِع المعاملة قراراً وتُرمى الأخطاء بعد إتمامها) — فصار التأكيد
    // على السلوك الصحيح: تُكتب «منتهية» ومعها expiredAt، والرمز والنصّ الظاهران كما كانا (deadline-exceeded). قرار المستخدم 2026-10-10: «تُكتب «منتهية»
    // حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها.»
    const sessAfter = await db.collection("scanSessions").doc("sessE3f").get();
    assert(sessAfter.data().status === "expired" && sessAfter.data().expiredAt && typeof sessAfter.data().expiredAt.toMillis === "function",
        "3f. join after the window: \"expired\" IS written (status=expired + expiredAt) — the write is committed, not rolled back by the throw");
    assert(!("joinedBy" in sessAfter.data()) && !("joinedAt" in sessAfter.data()),
        "3f. and nobody joined (no joinedBy / joinedAt)");
  }

  // ===== Case 4: personal scan, no sessionId -> bills the signed-in user =====
  {
    await seedUser("realuser", {scansRemaining: 3, scansTotal: 3, plan: "single"});
    let threw = null; let ret = null;
    try {
      ret = await callAnalyze({
        data: {scanId: "scan-c4", fingerprint: FINGERPRINT, usePrecomputed: true},
        auth: {uid: "realuser", token: {}},
      });
    } catch (e) {
      threw = e;
    }
    assert(threw === null, "4. personal scan: no error (normal path intact)");
    assert(isV7Analysis(ret), "4. personal scan: analysis returned (the V7 analysis)");
    assert((await getUserScans("realuser")) === 2, "4. personal scan: user scansRemaining 3 -> 2");
    const rep = await db.collection("reports").doc("scan-c4").get();
    assert(rep.exists && rep.data().userId === "realuser", "4. personal scan: report.userId == signed-in user");
  }

  console.log("\n===== SESSION BILLING E2E RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  await admin.app().delete().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});

"use strict";

// ===================================================
// emulatorGuardCore — منطق الحارس بلا أثر جانبي (V8 قبل النشر، 2026-10-09 +03): لا يعمل اختبار يكتب في Firestore إلا على المحاكي
// ومشروعُه مشروع اختبار. الملفّ الذي تستورده الاختبارات هو emulatorOnlyGuard.js (ينفّذ الفحص عند الاستيراد)؛ وهذا الملفّ المنطق وحده،
// فتستورده اختبارات الحارس نفسه بلا أن تخرج العملية.
// ===================================================
//
// قرار المستخدم (بنصّه، منقول من أمر المنسّق): «حارس المحاكي في اختبارات e2e: نعم، قبل النشر. لا يعمل أيّ اختبار يحذف إلا إذا كان
// FIRESTORE_EMULATOR_HOST مضبوطاً، والمشروع مشروع اختبار لا neuralchek-9b6d7، وإلا يتوقّف قبل أيّ نداء. واختبار يثبت الحارس.»
//
// الاستعمال: السطر الأوّل من الشيفرة في كل ملفّ اختبار يكتب في Firestore (قبل أيّ require لـfirebase-admin أو لوحدة من src أو لـ
// @firebase/rules-unit-testing):
//     require("./lib/emulatorOnlyGuard");           // functions/test/*.js
//     require("../functions/test/lib/emulatorOnlyGuard");  // rules-test/*.js
// التنفيذ عند الاستيراد نفسه (لا دالّة يُنسى نداؤها): إن وُجدت مشكلة طُبعت وخرجت العملية برمز 2 قبل أن يُحمَّل أيّ شيء بعده.
// ملفّات الاختبار التي يجب أن تستورده تُشتقّ بالأداة لا بقائمة يدوية: functions/test/lib/emulatorGuardInventory.js، ويُفشل
// functions/test/emulatorGuardCoverage.test.js أيّ ملفّ منها لا يستورده أوّلاً.
//
// ما يرفضه (كل مشكلة اسم، وكلها تُطبع):
//   FIRESTORE_EMULATOR_HOST_MISSING     المتغيّر غير مضبوط أو فارغ
//   FIRESTORE_EMULATOR_HOST_NOT_LOCAL   مضبوط على غير 127.0.0.1 / localhost / [::1] (بمنفذ اختياري) — فالمضيف البعيد لا يُقبل
//   PROJECT_ABSENT                      لا مشروع في البيئة ولا في إعداد التطبيق
//   PROJECT_IS_PRODUCTION               مشروع من أيّ مصدر = neuralchek-9b6d7
//   FIREBASE_CONFIG_UNREADABLE          FIREBASE_CONFIG مضبوط ولا يُقرأ (فلا يُعرف مشروعه)
//
// «المشروع من البيئة ومن إعداد التطبيق»: المصادر الثلاثة التي تقرؤها firebase-admin نفسها حين تُستدعى initializeApp() بلا وسائط
// (functions/src/utils/admin.js:8-10 — بلا projectId): GCLOUD_PROJECT وGOOGLE_CLOUD_PROJECT وprojectId داخل FIREBASE_CONFIG (نصّ JSON أو
// مسار ملفّ، كما تقبله SDK). وfirebase emulators:exec يضبط GCLOUD_PROJECT وFIREBASE_CONFIG من --project، وبدونه من .firebaserc
// (default = neuralchek-9b6d7) — وهذه بالذات الحالة التي يلتقطها الحارس (قيس 2026-10-09: بلا --project صار GCLOUD_PROJECT=neuralchek-9b6d7).
//
// ما لا يغطّيه: وجهة initializeApp({projectId}) المكتوبة في الشيفرة. ثلاثة اختبارات (migrateReportRaw وstuckReservations
// وanalyzeDevice1010Compat) تشغّل سكربتات مثبَّتة على مشروع الإنتاج بالتصميم، وأمانها أن المضيف محلّي (يفرضه هذا الحارس) فكل مستنداتها في المحاكي.

const fs = require("fs");

/** القاعدة 24: المعرّف الحرفي الذي يقوم عليه التمييز — مصدره هنا، ويربطه functions/test/emulatorOnlyGuard.test.js بـ.firebaserc. */
const PRODUCTION_PROJECT_ID = "neuralchek-9b6d7";
/** المضيف المحلّي المقبول: ثلاثة أسماء بمنفذ اختياري، بلا شيء قبلها أو بعدها. */
const LOCAL_EMULATOR_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
const PROJECT_ENV_VARS = Object.freeze(["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"]);

const PROBLEM = Object.freeze({
  HOST_MISSING: "FIRESTORE_EMULATOR_HOST_MISSING",
  HOST_NOT_LOCAL: "FIRESTORE_EMULATOR_HOST_NOT_LOCAL",
  PROJECT_ABSENT: "PROJECT_ABSENT",
  PROJECT_IS_PRODUCTION: "PROJECT_IS_PRODUCTION",
  CONFIG_UNREADABLE: "FIREBASE_CONFIG_UNREADABLE",
});

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const normalize = (id) => String(id).trim().toLowerCase();

/**
 * projectId من FIREBASE_CONFIG كما تقرؤه firebase-admin: نصّ يبدأ بـ{ هو JSON، وغير ذلك مسار ملفّ JSON.
 * @param {string} value
 * @return {{ok: boolean, projectId: ?string}} ok=false إن لم يُقرأ؛ projectId=null إن قُرئ بلا الحقل
 */
function projectIdFromFirebaseConfig(value) {
  try {
    const text = String(value).trim().startsWith("{") ? String(value) : fs.readFileSync(String(value).trim(), "utf8");
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {ok: false, projectId: null};
    return {ok: true, projectId: isBlank(parsed.projectId) ? null : String(parsed.projectId)};
  } catch (e) {
    return {ok: false, projectId: null};
  }
}

/**
 * @param {Object} [env] البيئة (process.env افتراضياً؛ تُحقَن للاختبار)
 * @return {{problems: Array<{code: string, detail: string}>, projects: Array<{source: string, id: string}>}}
 *   problems فارغة = مقبول. projects = ما قُرئ من البيئة (للتقرير).
 */
function emulatorEnvProblems(env = process.env) {
  const problems = [];
  const projects = [];

  const host = env.FIRESTORE_EMULATOR_HOST;
  if (isBlank(host)) {
    problems.push({code: PROBLEM.HOST_MISSING, detail: "FIRESTORE_EMULATOR_HOST غير مضبوط — بلا محاكٍ يتّجه عميل Admin إلى Firestore الحقيقي"});
  } else if (!LOCAL_EMULATOR_HOST.test(String(host))) {
    problems.push({code: PROBLEM.HOST_NOT_LOCAL, detail: `FIRESTORE_EMULATOR_HOST=${String(host).slice(0, 80)} ليس مضيفاً محلّياً (127.0.0.1 أو localhost أو [::1])`});
  }

  for (const name of PROJECT_ENV_VARS) {
    if (!isBlank(env[name])) projects.push({source: name, id: String(env[name]).trim()});
  }
  if (!isBlank(env.FIREBASE_CONFIG)) {
    const cfg = projectIdFromFirebaseConfig(env.FIREBASE_CONFIG);
    if (!cfg.ok) {
      problems.push({code: PROBLEM.CONFIG_UNREADABLE, detail: "FIREBASE_CONFIG مضبوط ولا يُقرأ (ليس JSON ولا مسار ملفّ JSON) — فلا يُعرف مشروع التطبيق"});
    } else if (cfg.projectId !== null) {
      projects.push({source: "FIREBASE_CONFIG.projectId", id: cfg.projectId});
    }
  }

  if (projects.length === 0 && !problems.some((p) => p.code === PROBLEM.CONFIG_UNREADABLE)) {
    problems.push({code: PROBLEM.PROJECT_ABSENT, detail: "لا مشروع في GCLOUD_PROJECT ولا GOOGLE_CLOUD_PROJECT ولا FIREBASE_CONFIG — شغّل بـ --project <مشروع اختبار> (مثل demo-nc)"});
  }
  for (const p of projects) {
    if (normalize(p.id) === PRODUCTION_PROJECT_ID) {
      problems.push({code: PROBLEM.PROJECT_IS_PRODUCTION, detail: `${p.source}=${PRODUCTION_PROJECT_ID} (مشروع الإنتاج) — بلا --project يأخذ firebase مشروع .firebaserc الافتراضي`});
    }
  }
  return {problems, projects};
}

/**
 * يرفض ويخرج برمز 2 إن وُجدت مشكلة؛ وإلا يعود بصمت.
 * @param {Object} [env]
 * @param {function(number): void} [exit] تُحقَن للاختبار
 * @return {{problems: Array, projects: Array}}
 */
function assertEmulatorOnly(env = process.env, exit = (code) => process.exit(code)) {
  const result = emulatorEnvProblems(env);
  if (result.problems.length > 0) {
    console.error("REFUSING TO RUN: هذا الاختبار يكتب في Firestore ولا يعمل إلا على المحاكي ومشروع اختبار — يتوقّف قبل أيّ نداء.");
    for (const p of result.problems) console.error(`  - ${p.code}: ${p.detail}`);
    console.error("  الأمر الصحيح: firebase emulators:exec --only firestore --project demo-nc \"node <الملفّ>\"");
    exit(2);
  }
  return result;
}

module.exports = {PRODUCTION_PROJECT_ID, LOCAL_EMULATOR_HOST, PROJECT_ENV_VARS, PROBLEM, emulatorEnvProblems, assertEmulatorOnly, projectIdFromFirebaseConfig};

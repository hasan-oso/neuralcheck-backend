#!/usr/bin/env node
'use strict';

// ===================================================================
// backup-firestore-rules-before-deploy — قراءة فقط. يحفظ **القواعد
// المنشورة الآن فعلياً** (لا الملفّ المحلّي firestore.rules) إلى ملفّ
// خارج المستودع، هدفاً للتراجع — بنصّ أمر المستخدم 2026-10-01 +03
// ("قواعد قراءة الجلسات"، البند ٥): "القواعد المنشورة الآن تُحفظ قبل
// النشر." يُشغِّله المستخدم من طرفيّته **قبل** نشر قواعد هذه الجولة —
// لا تُشغِّله الجلسة الآلية (نفس قيد كل سكربتات *-readonly.js الحيّة).
// ===================================================================
//
// ⚠️ **لماذا REST مباشرة لا firebase-tools CLI**: firebase-tools 15.28.2
// (المثبَّتة، لا ترقية) لا تعرض أمر "اقرأ القواعد المنشورة الآن" مباشرة
// (deploy يكتب فقط، لا يقرأ). الواجهة الموثَّقة الوحيدة لقراءة Ruleset
// منشور فعلياً هي Firebase Rules REST API
// (https://firebase.google.com/docs/reference/rules/rest) — نداءان:
//   ١) GET .../releases/cloud.firestore → rulesetName الحالي (الإصدار
//      النشِط فعلياً على Firestore، لا أحدث إصدار مرفوع بالضرورة لو
//      فشل تفعيله).
//   ٢) GET .../{rulesetName} → source.files[].content (نصّ القواعد
//      الفعلي حرفياً كما هو على الخادم الآن).
//
// ─── الاعتماد ────────────────────────────────────────────────────────
// admin.credential.applicationDefault() — نفس اعتماد كل سكربتات
// *-readonly.js الأخرى (GOOGLE_APPLICATION_CREDENTIALS أو
// gcloud auth application-default login من بيئة الطرفية وحدها، القاعدة
// 8 في تعريف الوكيل: لا سطر أمر، لا طباعة). نطاق OAuth المطلوب لقراءة
// Firebase Rules تحديداً: `https://www.googleapis.com/auth/firebase`
// أو `cloud-platform` (الاعتماد الافتراضي لمعظم حسابات gcloud يحمل
// cloud-platform أصلاً) — **لم أُشغِّل هذا السكربت لأتحقّق من كفاية
// النطاق فعلياً (لا قراءة من الإنتاج مني)**؛ إن رفض الخادم بـ403، النصّ
// أدناه يطبع الرابط الرسمي لمنح الدور بدل تخمين السبب.
//
// Usage (المستخدم من طرفيّته فقط):
//   node functions/scripts/backup-firestore-rules-before-deploy.js <outPath.json>
// مثال:
//   node functions/scripts/backup-firestore-rules-before-deploy.js ../../evidence/firestore-rules-backup-before-2026-10-01.json
// ===================================================================

const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'neuralchek-9b6d7'; // .firebaserc:3 — مصدر واحد مذكور في تعريف الوكيل

const RULES_API_BASE = 'https://firebaserules.googleapis.com/v1';

/**
 * تنقية نصّ خطأ قبل طباعته/كتابته — القاعدة 36. ردّ Google APIs قد يحمل
 * تفاصيل OAuth (نادراً أجزاء توكن) في رسائل 401/403 — لا نصّ خام غير محدود.
 * نفس نمط sanitizeErrorMessage في export-v7-replay-inputs-readonly.js
 * (دالّة محلّية مستقلّة — راجع تعليق تلك الدالّة لسبب عدم استيراد سكربت
 * آخر لهذا الغرض تحديداً).
 * @param {*} err
 * @return {string}
 */
function sanitizeErrorMessage(err) {
  const raw = (err && typeof err.message === 'string') ? err.message : String(err);
  let out = raw.slice(0, 500);
  // "name=value" (access_token=xxx) — لا يلتقط "Bearer xxx" (مفصول بمسافة
  // لا = ولا :، نمط Authorization الحقيقي) — ذلك نمط منفصل أدناه. (مُتحقَّق
  // بالتشغيل: نفس عطب وُجد ومُصلِح سابقاً في export-v7-replay-inputs-
  // readonly.js:sanitizeErrorMessage لنفس السبب بالضبط.)
  out = out.replace(/\b(access_token|id_token|refresh_token)[=:]\s*[^\s&"']+/gi, '$1=[REDACTED]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  return out;
}

/**
 * تطبيق Firebase Admin منفصل — نفس اسم appName فريد كي لا يتصادم لو
 * استُورد مع سكربتات أخرى. بلا storageBucket (لا حاجة — لا Storage هنا).
 * @return {Object} admin.app محلّية
 */
function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'backup-firestore-rules-before-deploy';
  return admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
}

/**
 * يجلب رمز وصول OAuth2 حقيقياً من اعتماد Admin SDK (ADC) — بلا طباعته،
 * بلا كتابته. القاعدة 8 في تعريف الوكيل بامتدادها على كل رمز وصول.
 * @param {Object} app admin.app محلّية (من initReadOnlyAdmin)
 * @return {Promise<string>} access_token الخامّ
 */
async function getAccessToken(app) {
  const credential = app.options.credential;
  if (!credential || typeof credential.getAccessToken !== 'function') {
    throw new Error('getAccessToken: اعتماد Admin SDK لا يعرض getAccessToken() — ' +
        'تحقّق من GOOGLE_APPLICATION_CREDENTIALS/gcloud auth application-default login');
  }
  const {access_token: accessToken} = await credential.getAccessToken();
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('getAccessToken: الاستجابة بلا access_token صالح');
  }
  return accessToken;
}

/**
 * يقرأ القواعد المنشورة فعلياً الآن على Firestore لهذا المشروع — نداءان
 * REST بالتوكن الحقيقي، صفر كتابة. دالّة خالصة الشكل (كل اعتمادها
 * الشبكي صريح عبر accessToken المُمرَّر، لا توكن ضمني) لتسهيل اختبارها
 * لاحقاً بكعب fetch لو لزم.
 * @param {string} accessToken
 * @return {Promise<{rulesetName: string, rulesContent: string, fetchedAt: string}>}
 */
async function fetchCurrentlyDeployedFirestoreRules(accessToken) {
  const releaseUrl = `${RULES_API_BASE}/projects/${PROJECT_ID}/releases/cloud.firestore`;
  const releaseRes = await fetch(releaseUrl, {headers: {Authorization: `Bearer ${accessToken}`}});
  if (!releaseRes.ok) {
    const bodyText = sanitizeErrorMessage(new Error(await releaseRes.text().catch(() => '(تعذّرت قراءة النصّ)')));
    throw new Error(`fetchCurrentlyDeployedFirestoreRules: فشل جلب الإصدار النشِط — ` +
        `HTTP ${releaseRes.status} ${releaseRes.statusText} — ${bodyText} — ` +
        `إن كان 403: امنح حساب الخدمة دور "Firebase Rules System" أو "Viewer" على المشروع ` +
        `(https://console.firebase.google.com/project/${PROJECT_ID}/settings/iam).`);
  }
  const releaseJson = await releaseRes.json();
  const rulesetName = releaseJson && releaseJson.rulesetName;
  if (!rulesetName || typeof rulesetName !== 'string') {
    throw new Error('fetchCurrentlyDeployedFirestoreRules: الاستجابة بلا rulesetName صالح — ' +
        `${sanitizeErrorMessage(new Error(JSON.stringify(releaseJson).slice(0, 300)))}`);
  }

  const rulesetUrl = `${RULES_API_BASE}/${rulesetName}`;
  const rulesetRes = await fetch(rulesetUrl, {headers: {Authorization: `Bearer ${accessToken}`}});
  if (!rulesetRes.ok) {
    const bodyText = sanitizeErrorMessage(new Error(await rulesetRes.text().catch(() => '(تعذّرت قراءة النصّ)')));
    throw new Error(`fetchCurrentlyDeployedFirestoreRules: فشل جلب نصّ Ruleset ${rulesetName} — ` +
        `HTTP ${rulesetRes.status} ${rulesetRes.statusText} — ${bodyText}`);
  }
  const rulesetJson = await rulesetRes.json();
  const files = (rulesetJson && rulesetJson.source && Array.isArray(rulesetJson.source.files)) ?
      rulesetJson.source.files : [];
  // القاعدة 22 — لا افتراض أن أوّل ملفّ هو المطلوب صامتاً؛ Firestore
  // Ruleset واحد يحمل ملفّاً واحداً عادةً (firestore.rules) لكن الشكل
  // العام يسمح بأكثر — نُسجِّل الكل، لا نختار واحداً تخميناً.
  if (files.length === 0) {
    throw new Error(`fetchCurrentlyDeployedFirestoreRules: Ruleset ${rulesetName} بلا source.files إطلاقاً — ` +
        'شكل استجابة غير متوقَّع، توقّف بلا تخمين');
  }
  const rulesContent = files.map((f) => f.content || '').join('\n');
  return {rulesetName, rulesContent, fetchedAt: new Date().toISOString()};
}

async function main() {
  const outPathArg = process.argv[2];
  if (!outPathArg) {
    console.error('Usage: node backup-firestore-rules-before-deploy.js <outPath.json>');
    console.error('مثال: node backup-firestore-rules-before-deploy.js ../../evidence/firestore-rules-backup-before-2026-10-01.json');
    process.exit(1);
  }
  const outPath = path.resolve(outPathArg);

  // دفاع في العمق — لا كتابة داخل هذا المستودع نفسه (نفس قيد export-v7-
  // replay-inputs-readonly.js).
  const REPO_ROOT = path.join(__dirname, '..', '..');
  if (outPath.startsWith(REPO_ROOT + path.sep) || outPath === REPO_ROOT) {
    console.error(`✗ توقّف: المسار المطلوب (${outPath}) داخل المستودع (${REPO_ROOT}) — يجب أن يكون خارجه صراحة.`);
    process.exit(1);
  }

  const app = initReadOnlyAdmin();
  const accessToken = await getAccessToken(app);
  const {rulesetName, rulesContent, fetchedAt} = await fetchCurrentlyDeployedFirestoreRules(accessToken);

  const output = {
    projectId: PROJECT_ID,
    fetchedAt,
    rulesetName,
    purpose: 'نسخة احتياطية من القواعد المنشورة فعلياً قبل نشر قواعد الجلسات — هدف التراجع (أمر مستخدم 2026-10-01 +03)',
    rules: rulesContent,
  };

  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  // stdout — ميتاداتا فقط، لا رمز وصول، لا نصّ خطأ خامّ.
  console.log(JSON.stringify({
    projectId: PROJECT_ID,
    rulesetName,
    fetchedAt,
    rulesByteLength: rulesContent.length,
    writtenTo: outPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`✗ توقّف بخطأ: ${sanitizeErrorMessage(e)}`);
    process.exit(1);
  });
}

module.exports = {
  PROJECT_ID, RULES_API_BASE,
  sanitizeErrorMessage, initReadOnlyAdmin, getAccessToken, fetchCurrentlyDeployedFirestoreRules,
};

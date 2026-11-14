#!/usr/bin/env node
'use strict';

// ===================================================================
// verify-scansessions-rules-postdeploy-readonly — فحص ما بعد نشر قواعد scanSessions، **للقراءة وحدها**. يُشغّله المستخدم من طرفيّته بعد النشر؛
// **لا تُشغّله الجلسة الآلية** (شبكة حقيقية نحو المشروع الحقيقي). قرار المستخدم 2026-10-07 +03 (الخيار «ب»)، بنصّه:
//   «- نسخة للقراءة وحدها من verify-scansessions-rules-postdeploy.js: دخول مجهول، ثم محاولة قراءة مستند جلسة حقيقي بمعرّفه، ثم محاولة سرد
//   الجلسات بلا فلتر. والمتوقَّع PERMISSION_DENIED في الاثنين. ولا كتابة في Firestore.
//   - معرّف الجلسة الحقيقي يُقرأ بحساب الإدارة (ADC) في السكربت نفسه، ولا يُطبع خاماً.
//   - الحساب المجهول الذي يُنشئه الدخول: كتابة صغيرة في Firebase Auth. يُسجَّل ذلك، ويُعاد استعمال الحساب نفسه إن أمكن، ويُذكر uid مُهشَّراً في المخرَج.
//   - قراءة المالك تُثبَت في فحص الجهاز (مسار QR: شاشة الانتظار تتحدّث). وسطر «المنضمّ يقرأ» لا مستهلك له اليوم، فلا يُفحص في الإنتاج. ويكفي فيه المحاكي (19/19).
//   - النسخة التي تكتب (الخيار أ) لا تُشغَّل ... أو تُحذف إن لم يقرأها شيء.»
// ⟵ **حُذفت** النسخة الكاتبة verify-scansessions-rules-postdeploy.js في الالتزام نفسه: `git grep` على اسمها قبل الحذف لا يجد أيّ قارئ خارجها (صفر مرجع في package.json أو
//   اختبار أو توثيق أو سكربت آخر داخل المستودع)، وكانت تكتب في Firestore (مستند اختبار) وفي Auth (حسابات). تبقى في تاريخ git (a2bde6f) لمن يريدها.
//
// ─── ما يفعله ──────────────────────────────────────────────────────────
//   ١. بحساب الإدارة (ADC، Admin SDK مُغلَّف بـwrapReadOnly): يقرأ حتى ADMIN_SESSION_SCAN_LIMIT مستنداً من scanSessions بحقل createdAt وحده (select)،
//      ويختار معرّف جلسة حقيقية (chooseSessionId — الأحدث، وعند التعادل/الغياب الأصغر نصّاً). المعرّف لا يُطبع خاماً: يُهشَّر بـhashId (المصدر الواحد).
//   ٢. دخول مجهول عبر REST (Identity Toolkit، بلا مكتبة عميل): يُعاد استعمال الحساب نفسه من ذاكرة محلّية خارج المستودع (رمز التحديث) إن وُجدت وصحّت، وإلا
//      يُنشَأ حساب مجهول جديد (**الكتابة الوحيدة في Firebase Auth**، تُسجَّل في المخرَج) ويُحفَظ رمزه في الذاكرة المحلّية.
//   ٣. بهوية ذلك الحساب (رمز هوية Firebase — فالقواعد تُقيَّم): GET لمستند الجلسة بمعرّفه ثم GET لسرد scanSessions بلا فلتر (pageSize=1). المتوقَّع في الاثنين:
//      HTTP 403 برسالة «Missing or insufficient permissions» وstatus PERMISSION_DENIED. التمييز بنصّ الرفض لا بالرمز وحده (القاعدة 21): 403 آخر (واجهة
//      معطَّلة مثلاً) = INCONCLUSIVE لا PASS. غياب أيّ جزء = INCONCLUSIVE (القاعدة 22) — لا يُقرأ الغياب نجاحاً.
//   ٤. لا كتابة في Firestore إطلاقاً: قراءة الإدارة عبر wrapReadOnly، وقراءات الحساب المجهول GET فقط. جسم أي ردّ 200 (لو ثُقبت القواعد) **لا يُقرأ ولا يُطبع**.
//
// ─── إعادة استعمال الحساب المجهول ───────────────────────────────────────
// Firebase يُنشئ مستخدماً مجهولاً جديداً عند كل signUp، ولا شيء يبقى بين عمليتَي Node. فالمُعاد استعماله هو رمز التحديث (refresh token) لمستخدم مجهول
// سبق إنشاؤه، يُحفَظ في ملفّ محلّي **خارج المستودع** (الافتراضي ~/.neuralcheck/postdeploy-anon-session.json، أو NEURALCHECK_POSTDEPLOY_ANON_CACHE)،
// ويُرفَض أي مسار داخل المستودع كي لا يُلتزَم رمز بالخطأ (assertCachePathOutsideRepo). لا يُطبع ولا يُسجَّل. إن فسد/انتهى → يُنشأ حساب جديد ويُعلَن ذلك.
// يحذفه المستخدم متى شاء (الملفّ، وحساب Auth المجهول من لوحة Firebase).
//
// ─── الاعتماد (من بيئة الطرفية وحدها — القاعدة 8: لا سطر أمر، لا طباعة ولو مقنَّعة) ────
//   • GOOGLE_APPLICATION_CREDENTIALS أو gcloud auth application-default login — قراءة Firestore بحساب الإدارة.
//   • FIREBASE_WEB_API_KEY — مفتاح تطبيق الويب (علني بتصميم Firebase، لكنه لا يُطبع ولا يُكتب) لنداءَي Identity Toolkit/securetoken. لا قيمة افتراضية.
//
// ─── رمز الخروج ──────────────────────────────────────────────────────
//   0 PASS (الاثنان PERMISSION_DENIED)  ·  1 FAIL (قراءة أُتيحت لحساب مجهول — ثغرة قواعد)  ·  2 INCONCLUSIVE (لم يكتمل أو ردّ غير متوقَّع)
//
// ─── ما لا يُختبر بلا شبكة (الاختبار test/verifyScansessionsRulesPostdeployReadonly.test.js يغطّي الأجزاء الخالصة والتنسيق بـfetch مزيَّف) ───
//   سلوك الخادم الحقيقي: نصّ رفض القواعد على REST بالحرف، توفّر الدخول المجهول في المشروع، صلاحية ADC لقراءة scanSessions، انتهاء رمز التحديث، ردّ Firestore
//   على المستند/السرد. هذه تُحسَم بتشغيل المستخدم وحده.
//
// Usage (المستخدم من طرفيّته، بعد النشر فقط):
//   node functions/scripts/verify-scansessions-rules-postdeploy-readonly.js
// ===================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

// المصدر الواحد لـ hashId وwrapReadOnly وPROJECT_ID (القاعدة 24) — لا نسخة ثانية هنا.
const {wrapReadOnly, hashId, PROJECT_ID} = require('./audit-device-profiles-readonly');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SESSIONS_COLLECTION = 'scanSessions';
const ADMIN_SESSION_SCAN_LIMIT = 50;
const IDENTITY_TOOLKIT_BASE = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const FIRESTORE_REST_BASE = 'https://firestore.googleapis.com/v1';
const CACHE_FILE_VERSION = 1;
// نصّ رفض القواعد على Firestore REST — منقول، غير مُتحقَّق منه بلا شبكة (القاعدة 29)؛ إن اختلف الحرف سقط الحكم إلى INCONCLUSIVE لا إلى PASS.
const RULES_DENIAL_MESSAGE_FRAGMENT = 'Missing or insufficient permissions';

const CLASSIFICATION = Object.freeze({
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  READ_ALLOWED: 'READ_ALLOWED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN_OTHER: 'FORBIDDEN_OTHER',
  NOT_RUN: 'NOT_RUN',
  OTHER: 'OTHER',
});
const VERDICT = Object.freeze({PASS: 'PASS', FAIL: 'FAIL', INCONCLUSIVE: 'INCONCLUSIVE'});
const EXIT_CODE = Object.freeze({[VERDICT.PASS]: 0, [VERDICT.FAIL]: 1, [VERDICT.INCONCLUSIVE]: 2});

// ═══ الأجزاء الخالصة (تُختبَر بلا شبكة) ═══════════════════════════════════

/**
 * تنقية نصّ خطأ/ردّ قبل طباعته (القاعدة 36): قيم الأسرار الحيّة بالحرف + أنماط (مفتاح Google، JWT، Bearer، name=value) + تقصير.
 * @param {*} input نصّ أو خطأ
 * @param {Array<string>} [secrets] قيم حيّة (مفتاح، رموز) تُحجَب حيثما ظهرت ولو بلا نمط
 * @param {number} [maxLen]
 * @return {string}
 */
function sanitizeErrorText(input, secrets, maxLen) {
  let out = (input && typeof input.message === 'string') ? input.message : String(input);
  for (const s of (Array.isArray(secrets) ? secrets : [])) {
    if (typeof s === 'string' && s.length >= 6) out = out.split(s).join('[REDACTED]');
  }
  out = out.replace(/\b(access_token|id_token|refresh_token|idToken|refreshToken|apiKey|api_key|key)(=|":\s*"|:\s*)[^\s&"',}]+/gi, '$1$2[REDACTED]');
  out = out.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]');
  out = out.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[REDACTED]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  return out.slice(0, typeof maxLen === 'number' ? maxLen : 300);
}

function toMillis(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (v && typeof v.toMillis === 'function') { const m = v.toMillis(); return (typeof m === 'number' && isFinite(m)) ? m : null; }
  if (v instanceof Date) { const m = v.getTime(); return isFinite(m) ? m : null; }
  return null;
}

/**
 * اختيار معرّف جلسة حقيقية من مدخلات قراءة الإدارة: الأحدث createdAt، وعند التعادل أو غياب createdAt في كلّها الأصغر نصّاً. معرّف غير صالح
 * (غير نصّ، فارغ، يحمل "/") يُهمَل. لا مدخل صالح → null (يُعلَن، لا يُخترَع).
 * @param {Array<{id: *, createdAt: *}>} entries
 * @return {{id: string, chosenBy: string}|null}
 */
function chooseSessionId(entries) {
  const valid = (Array.isArray(entries) ? entries : [])
      .filter((e) => e && typeof e.id === 'string' && e.id.length > 0 && !e.id.includes('/'))
      .map((e) => ({id: e.id, ms: toMillis(e.createdAt)}));
  if (valid.length === 0) return null;
  const withTime = valid.filter((e) => e.ms !== null);
  if (withTime.length > 0) {
    const maxMs = Math.max(...withTime.map((e) => e.ms));
    const latest = withTime.filter((e) => e.ms === maxMs).map((e) => e.id).sort();
    return {id: latest[0], chosenBy: latest.length > 1 ? 'LATEST_CREATED_AT_TIE_SMALLEST_ID' : 'LATEST_CREATED_AT'};
  }
  return {id: valid.map((e) => e.id).sort()[0], chosenBy: 'NO_CREATED_AT_SMALLEST_ID'};
}

/**
 * تحليل جسم خطأ REST (Google JSON): {error:{code,message,status}} أو [{error:…}] — دون لمس أيّ حقل آخر. لا يُعيد نصّاً غير message/status.
 * @param {string} text
 * @return {{errorStatus: (string|null), message: (string|null)}}
 */
function parseErrorBody(text) {
  let j = null;
  try { j = JSON.parse(text); } catch (e) { j = null; }
  const e = Array.isArray(j) ? (j[0] && j[0].error) : (j && j.error);
  if (!e || typeof e !== 'object') return {errorStatus: null, message: null};
  return {
    errorStatus: typeof e.status === 'string' ? e.status : null,
    message: typeof e.message === 'string' ? e.message : null,
  };
}

/**
 * تصنيف نتيجة قراءة REST — بنصّ الرفض لا برمز HTTP وحده (القاعدة 21).
 *   PERMISSION_DENIED  = 403 + status PERMISSION_DENIED + رسالة «Missing or insufficient permissions» (رفض القواعد نفسه).
 *   FORBIDDEN_OTHER    = 403 بغير ذلك (واجهة معطَّلة، حصّة…) — ليس جواب القواعد.
 *   READ_ALLOWED       = 200 (القراءة أُتيحت — ثغرة، وجسم الردّ لا يُقرأ).
 *   UNAUTHENTICATED    = 401 أو status UNAUTHENTICATED (رمز الهوية لم يُقبَل — ليس جواب القواعد).
 *   NOT_FOUND          = 404 (لا جواب قواعد: المستند غير موجود أو القواعد سمحت).
 *   OTHER              = كل ما عداه، ومنه غياب httpStatus (فشل شبكة).
 * @param {{httpStatus: (number|null), errorStatus: (string|null), message: (string|null)}} r
 * @return {string} إحدى قيم CLASSIFICATION
 */
function classifyReadResult(r) {
  const s = r && r.httpStatus;
  if (s === 200) return CLASSIFICATION.READ_ALLOWED;
  if (s === 401 || (r && r.errorStatus === 'UNAUTHENTICATED')) return CLASSIFICATION.UNAUTHENTICATED;
  if (s === 403) {
    return (r.errorStatus === 'PERMISSION_DENIED' && typeof r.message === 'string' && r.message.includes(RULES_DENIAL_MESSAGE_FRAGMENT)) ?
        CLASSIFICATION.PERMISSION_DENIED : CLASSIFICATION.FORBIDDEN_OTHER;
  }
  if (s === 404) return CLASSIFICATION.NOT_FOUND;
  return CLASSIFICATION.OTHER;
}

/**
 * الحكم النهائي: PASS إن كان كل فحص PERMISSION_DENIED؛ FAIL إن أُتيحت أيّ قراءة (READ_ALLOWED)؛ وغير ذلك INCONCLUSIVE (القاعدة 22 — لا PASS بالغياب).
 * @param {Array<{classification: string}>} checks
 * @return {string} إحدى قيم VERDICT
 */
function computeVerdict(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (list.length === 0) return VERDICT.INCONCLUSIVE;
  if (list.some((c) => c.classification === CLASSIFICATION.READ_ALLOWED)) return VERDICT.FAIL;
  if (list.every((c) => c.classification === CLASSIFICATION.PERMISSION_DENIED)) return VERDICT.PASS;
  return VERDICT.INCONCLUSIVE;
}

function buildDocUrl(projectId, sessionId) {
  return `${FIRESTORE_REST_BASE}/projects/${projectId}/databases/(default)/documents/${SESSIONS_COLLECTION}/${encodeURIComponent(sessionId)}`;
}
function buildListUrl(projectId) {
  return `${FIRESTORE_REST_BASE}/projects/${projectId}/databases/(default)/documents/${SESSIONS_COLLECTION}?pageSize=1`;
}

function defaultCachePath(env, homeDir) {
  const override = env && env.NEURALCHECK_POSTDEPLOY_ANON_CACHE;
  if (typeof override === 'string' && override.length > 0) return path.resolve(override);
  return path.join(homeDir, '.neuralcheck', 'postdeploy-anon-session.json');
}

/** يرفض مساراً داخل المستودع (كي لا يُلتزَم رمز بالخطأ). يرمي نصاً مُسمّى. */
function assertCachePathOutsideRepo(cachePath, repoRoot) {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(cachePath));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error('NEURALCHECK_POSTDEPLOY_ANON_CACHE يشير إلى داخل المستودع — مرفوض (رمز تحديث لا يجوز أن يقع تحت git)');
  }
  return cachePath;
}

/**
 * يتحقّق من محتوى ملفّ الذاكرة المحلّية ويُعيد {localId, refreshToken} أو null (مع سبب). القاعدة 22: الفاسد/المختلف مشروعاً يُعلَن لا يُستعمَل.
 * @param {*} obj JSON المُحلَّل
 * @param {string} projectId
 * @return {{value: ({localId: string, refreshToken: string}|null), problem: (string|null)}}
 */
function parseCachedSession(obj, projectId) {
  if (!obj || typeof obj !== 'object') return {value: null, problem: 'NOT_AN_OBJECT'};
  if (obj.version !== CACHE_FILE_VERSION) return {value: null, problem: 'VERSION_MISMATCH'};
  if (obj.projectId !== projectId) return {value: null, problem: 'PROJECT_MISMATCH'};
  if (typeof obj.localId !== 'string' || obj.localId.length === 0) return {value: null, problem: 'LOCAL_ID_ABSENT'};
  if (typeof obj.refreshToken !== 'string' || obj.refreshToken.length < 10) return {value: null, problem: 'REFRESH_TOKEN_ABSENT'};
  return {value: {localId: obj.localId, refreshToken: obj.refreshToken}, problem: null};
}

// رموز خطأ securetoken التي تعني «هذا الحساب/الرمز لم يعد صالحاً» (لا عطب مؤقّت) — عندها يُنشأ حساب جديد.
const STALE_REFRESH_ERRORS = Object.freeze(['TOKEN_EXPIRED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED', 'CREDENTIAL_MISMATCH']);

// ═══ التنسيق (يُختبَر بـfetch مزيَّف وكائنات مُحقَنة — لا شبكة) ═══════════════════

/** يقرأ الردّ نصّاً (لخطأ فقط) — لا يُستدعى على ردّ 200 لفحص Firestore (لا يُقرأ جسم قد يحمل بيانات). */
async function readText(res) {
  try { return await res.text(); } catch (e) { return ''; }
}

/**
 * يضمن حساباً مجهولاً: يُعيد استعمال المخزَّن بتحديث رمزه إن أمكن، وإلا يُنشئ جديداً (الكتابة الوحيدة في Auth).
 * @param {Object} deps {apiKey, projectId, fetchImpl, cacheStore:{read(),write(obj)}, nowIso}
 * @return {Promise<{idToken: string, localId: string, mode: string, cacheState: string, authWrites: number, cacheWritten: boolean}>}
 */
async function ensureAnonymousUser(deps) {
  const {apiKey, projectId, fetchImpl, cacheStore} = deps;
  const cached = cacheStore.read(); // {state: 'ABSENT'|'UNREADABLE'|'PRESENT', value}
  let cacheState = cached.state;
  if (cached.state === 'PRESENT') {
    const parsed = parseCachedSession(cached.value, projectId);
    if (parsed.value) {
      const res = await fetchImpl(`${SECURE_TOKEN_URL}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(parsed.value.refreshToken)}`,
      });
      if (res.status === 200) {
        const j = await res.json();
        if (typeof j.id_token === 'string' && j.id_token.length > 0 && typeof j.user_id === 'string' && j.user_id.length > 0) {
          return {idToken: j.id_token, localId: j.user_id, mode: 'REUSED', cacheState: 'PRESENT_VALID', authWrites: 0, cacheWritten: false};
        }
        cacheState = 'PRESENT_REFRESH_RESPONSE_INCOMPLETE';
      } else {
        const body = parseErrorBody(await readText(res));
        const code = body.message || '';
        if (res.status === 400 && STALE_REFRESH_ERRORS.some((c) => code.includes(c))) {
          cacheState = `PRESENT_STALE:${STALE_REFRESH_ERRORS.find((c) => code.includes(c))}`;
        } else {
          // عطب مؤقّت/غير مفهوم — لا يُنشأ حساب جديد على عطب لم نفهمه (كتابة بلا داعٍ، القاعدة 22).
          throw new Error(`REFRESH_FAILED_UNCLASSIFIED: HTTP ${res.status} ${sanitizeErrorText(code, [apiKey])}`);
        }
      }
    } else {
      cacheState = `PRESENT_INVALID:${parsed.problem}`;
    }
  }
  // إنشاء حساب مجهول جديد — الكتابة الوحيدة في Firebase Auth.
  const res = await fetchImpl(`${IDENTITY_TOOLKIT_BASE}/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({returnSecureToken: true}),
  });
  if (res.status !== 200) {
    const body = parseErrorBody(await readText(res));
    throw new Error(`ANONYMOUS_SIGNUP_FAILED: HTTP ${res.status} ${sanitizeErrorText(body.message || '', [apiKey])}`);
  }
  const j = await res.json();
  if (typeof j.idToken !== 'string' || typeof j.refreshToken !== 'string' || typeof j.localId !== 'string' || !j.idToken || !j.refreshToken || !j.localId) {
    throw new Error('ANONYMOUS_SIGNUP_RESPONSE_INCOMPLETE');
  }
  let cacheWritten = false;
  try {
    cacheStore.write({version: CACHE_FILE_VERSION, projectId, localId: j.localId, refreshToken: j.refreshToken, savedAt: deps.nowIso || null});
    cacheWritten = true;
  } catch (e) {
    cacheState = `${cacheState}|CACHE_WRITE_FAILED:${sanitizeErrorText(e, [apiKey, j.refreshToken, j.idToken])}`;
  }
  return {idToken: j.idToken, localId: j.localId, mode: 'CREATED', cacheState, authWrites: 1, cacheWritten};
}

async function runRead(fetchImpl, url, idToken, secrets) {
  try {
    const res = await fetchImpl(url, {method: 'GET', headers: {Authorization: `Bearer ${idToken}`}});
    let errorStatus = null; let message = null;
    if (res.status !== 200) {
      const b = parseErrorBody(await readText(res));
      errorStatus = b.errorStatus; message = b.message;
    } else if (res.body && typeof res.body.cancel === 'function') {
      // جسم الـ200 (لو ثُقبت القواعد قد يحمل بيانات جلسة) لا يُقرأ ولا يُطبع — يُلغى فقط.
      try { await res.body.cancel(); } catch (e) { /* لا أثر */ }
    }
    return {httpStatus: res.status, errorStatus, message: message === null ? null : sanitizeErrorText(message, secrets, 200)};
  } catch (e) {
    return {httpStatus: null, errorStatus: null, message: `NETWORK_ERROR: ${sanitizeErrorText(e, secrets, 200)}`};
  }
}

/**
 * التنسيق الكامل — كل اعتماد خارجي مُحقَن (fetch، قراءة الإدارة، مخزن الذاكرة) فيُختبَر بلا شبكة. لا يرمي؛ أي عطب يصير INCONCLUSIVE مُعلَناً بسببه.
 * @param {Object} deps {apiKey, projectId, fetchImpl, listAdminSessions: async()=>Array<{id, createdAt}>, cacheStore, nowIso, hash}
 * @return {Promise<Object>} التقرير (لا أسرار، لا معرّف خام)
 */
async function runCheck(deps) {
  const hash = deps.hash || hashId;
  const secrets = [deps.apiKey];
  const report = {
    projectId: deps.projectId,
    generatedAtPlus03: deps.nowIso || null,
    expected: CLASSIFICATION.PERMISSION_DENIED,
    session: null, auth: null, checks: [], writes: {firestore: 0, authUsersCreated: 0, localCacheFileWritten: false},
    notChecked: [
      'قراءة المالك: تُثبَت في فحص الجهاز (مسار QR: شاشة الانتظار تتحدّث) — لا هنا',
      'قراءة المنضمّ: لا مستهلك لها اليوم، فلا تُفحص في الإنتاج — يكفي المحاكي (19/19)',
    ],
    verdict: VERDICT.INCONCLUSIVE, inconclusiveReason: null, exitCode: EXIT_CODE[VERDICT.INCONCLUSIVE],
  };
  const finish = () => { report.verdict = computeVerdict(report.checks); report.exitCode = EXIT_CODE[report.verdict]; return report; };

  // ١ — معرّف جلسة حقيقي بحساب الإدارة (قراءة وحدها)
  let chosen = null;
  try {
    chosen = chooseSessionId(await deps.listAdminSessions());
  } catch (e) {
    report.inconclusiveReason = `ADMIN_READ_FAILED: ${sanitizeErrorText(e, secrets)}`;
    return finish();
  }
  if (!chosen) {
    report.inconclusiveReason = 'NO_REAL_SESSION_FOUND — لا مستند في scanSessions يُقرأ بحساب الإدارة؛ أنشئ جلسة (مسار QR) ثم أعد التشغيل. لم يُنشأ حساب Auth.';
    return finish();
  }
  report.session = {idHash: hash(chosen.id), chosenBy: chosen.chosenBy};
  secrets.push(chosen.id); // رسالة خطأ شبكة قد تحمل الرابط (فيه المعرّف الخام) — يُحجَب كالسرّ (القاعدة 36، ولا يُطبع خاماً)

  // ٢ — حساب مجهول (الكتابة الوحيدة، Auth)
  let user;
  try {
    user = await ensureAnonymousUser(deps);
  } catch (e) {
    report.inconclusiveReason = `ANONYMOUS_AUTH_FAILED: ${sanitizeErrorText(e, secrets)}`;
    return finish();
  }
  secrets.push(user.idToken, user.localId);
  report.auth = {mode: user.mode, uidHash: hash(user.localId), cacheState: user.cacheState};
  report.writes.authUsersCreated = user.authWrites;
  report.writes.localCacheFileWritten = user.cacheWritten;

  // ٣ — القراءتان بهوية الحساب المجهول
  const get = await runRead(deps.fetchImpl, buildDocUrl(deps.projectId, chosen.id), user.idToken, secrets);
  report.checks.push({name: 'get-real-session-by-id', ...get, classification: classifyReadResult(get)});
  const list = await runRead(deps.fetchImpl, buildListUrl(deps.projectId), user.idToken, secrets);
  report.checks.push({name: 'list-sessions-unfiltered', ...list, classification: classifyReadResult(list)});
  return finish();
}

// ═══ الاعتماديات الحقيقية (لا تُختبَر بلا شبكة) ═══════════════════════════════

/**
 * قارئ جلسات الإدارة — Admin SDK مُغلَّف بـwrapReadOnly (أي كتابة تُرمى). يقرأ createdAt وحده (select) كي لا تدخل الذاكرة بيانات جلسة.
 * @param {Object} db Firestore Admin
 * @return {function(): Promise<Array<{id: string, createdAt: *}>>}
 */
function buildAdminSessionLister(db) {
  const ro = wrapReadOnly(db);
  return async () => {
    const snap = await ro.collection(SESSIONS_COLLECTION).select('createdAt').limit(ADMIN_SESSION_SCAN_LIMIT).get();
    return snap.docs.map((d) => ({id: d.id, createdAt: d.get ? d.get('createdAt') : (d.data() || {}).createdAt}));
  };
}

function buildFsCacheStore(cachePath) {
  return {
    path: cachePath,
    read() {
      let text;
      try { text = fs.readFileSync(cachePath, 'utf8'); } catch (e) {
        return e && e.code === 'ENOENT' ? {state: 'ABSENT', value: null} : {state: 'UNREADABLE', value: null};
      }
      try { return {state: 'PRESENT', value: JSON.parse(text)}; } catch (e) { return {state: 'UNREADABLE', value: null}; }
    },
    write(obj) {
      fs.mkdirSync(path.dirname(cachePath), {recursive: true});
      fs.writeFileSync(cachePath, JSON.stringify(obj) + '\n', {encoding: 'utf8', mode: 0o600});
    },
  };
}

function nowPlus03Iso() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

async function main() {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    console.error('✗ توقّف: FIREBASE_WEB_API_KEY غائب من بيئة الطرفية — لا قيمة افتراضية، لا تخمين، ولا يُكتب في سطر أمر.');
    process.exit(EXIT_CODE[VERDICT.INCONCLUSIVE]);
  }
  const cachePath = assertCachePathOutsideRepo(defaultCachePath(process.env, os.homedir()), REPO_ROOT);

  // eslint-disable-next-line global-require
  const admin = require('firebase-admin');
  const appName = 'verify-scansessions-rules-postdeploy-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ? admin.app(appName) : admin.initializeApp({projectId: PROJECT_ID}, appName);

  const report = await runCheck({
    apiKey, projectId: PROJECT_ID, fetchImpl: fetch,
    listAdminSessions: buildAdminSessionLister(app.firestore()),
    cacheStore: buildFsCacheStore(cachePath), nowIso: nowPlus03Iso(), hash: hashId,
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n${report.verdict} — get/list على scanSessions بحساب مجهول؛ المتوقَّع ${report.expected} في الاثنين. كتابات: Firestore ${report.writes.firestore}، حسابات Auth أُنشئت ${report.writes.authUsersCreated}.`);
  process.exit(report.exitCode);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`✗ توقّف بخطأ: ${sanitizeErrorText(e, [process.env.FIREBASE_WEB_API_KEY])}`);
    process.exit(EXIT_CODE[VERDICT.INCONCLUSIVE]);
  });
}

module.exports = {
  CLASSIFICATION, VERDICT, EXIT_CODE, STALE_REFRESH_ERRORS, RULES_DENIAL_MESSAGE_FRAGMENT, ADMIN_SESSION_SCAN_LIMIT,
  sanitizeErrorText, chooseSessionId, parseErrorBody, classifyReadResult, computeVerdict,
  buildDocUrl, buildListUrl, defaultCachePath, assertCachePathOutsideRepo, parseCachedSession,
  ensureAnonymousUser, runCheck, buildAdminSessionLister, buildFsCacheStore,
};

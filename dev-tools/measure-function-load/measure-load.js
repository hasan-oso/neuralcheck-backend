'use strict';
// measure-load.js (مسودّة قيد الاختبار في scratchpad — النسخة النهائية
// تُنسَخ إلى functions/scripts/ بعد التحقّق) — يقيس زمن تحميل كود الدوالّ
// بنفس طريقة CLI: إطلاق node_modules/.bin/firebase-functions <functionsDir>
// (فعلياً: node lib/bin/firebase-functions.js <functionsDir>، لتفادي
// مشاكل .cmd على ويندوز عبر spawn)، cwd=functionsDir، PORT حرّ،
// FUNCTIONS_CONTROL_API=true، بلا FUNCTIONS_MANIFEST_OUTPUT_PATH (يبقي
// مسار الخادم/HTTP كما وصفه المدقّق) — المؤقّت من الإطلاق إلى أوّل 200 من
// GET /__/functions.yaml، ثم GET /__/quitquitquit.

const http = require('http');
const path = require('path');
const net = require('net');
const {spawn} = require('child_process');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {timeout: timeoutMs}, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout')); });
  });
}

async function pollUntil200(url, deadlineMs, intervalMs) {
  const start = Date.now();
  for (;;) {
    try {
      const status = await httpGet(url, 2000);
      if (status === 200) return true;
    } catch (e) { /* not ready yet */ }
    if (Date.now() - start > deadlineMs) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * تشغيل واحد: يقيس الزمن من spawn إلى أوّل 200، ثم quitquitquit.
 * @param {Object} opts {functionsDir, firebaseFunctionsBin, requireTimerPath, requireTimerOutput}
 * @return {Promise<{ok:boolean, ms:?number, error:?string, port:number, stdout:string, stderr:string}>}
 */
async function runOnce(opts) {
  const port = await getFreePort();
  const timerPort = opts.requireTimerPath ? await getFreePort() : null;
  const env = {
    ...process.env, // نُصفّي أدناه إلى مجموعة مضبوطة — راجع buildMinimalEnv/buildCliLikeEnv
    PORT: String(port),
    FUNCTIONS_CONTROL_API: 'true',
  };
  const builder = opts.envPattern === 'cliLike' ? buildCliLikeEnv : buildMinimalEnv;
  const builtEnv = builder(env, opts, timerPort);
  const finalEnv = opts.extraEnv ? {...builtEnv, ...opts.extraEnv} : builtEnv;
  const readyTimeoutMs = typeof opts.readyTimeoutMs === 'number' ? opts.readyTimeoutMs : 30000;

  const child = spawn(process.execPath, [opts.firebaseFunctionsBin, opts.functionsDir], {
    cwd: opts.functionsDir,
    env: finalEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let servingAtMs = null; // زمن ظهور "Serving at port" في stdout — يفصل
  // مرحلة إقلاع express (spawn ⇐ الاستماع) عن مرحلة تحميل كود المستخدم
  // الفعلي (الاستماع ⇐ أوّل 200 على /__/functions.yaml)، بأمر المنسّق
  // اليوم استناداً إلى مخرَج التشغيل الجافّ الحقيقي (بند ١): "Serving at
  // port" يُطبَع (bin/firebase-functions.js:90-91) قبل استماع loadStack
  // لأوّل طلب /__/functions.yaml (:73-76 — يُستدعى داخل معالج الطلب).
  child.stdout.on('data', (d) => {
    const s = d.toString();
    stdout += s;
    if (servingAtMs === null && /Serving at port/.test(s)) servingAtMs = Date.now();
  });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const spawnedAtMs = Date.now();
  const url = `http://127.0.0.1:${port}/__/functions.yaml`;
  const ready = await pollUntil200(url, readyTimeoutMs, 25);
  const readyAtMs = Date.now();

  let ok = ready;
  let ms = ready ? (readyAtMs - spawnedAtMs) : null;
  let startupMs = (ready && servingAtMs !== null) ? (servingAtMs - spawnedAtMs) : null;
  let loadMs = (ready && servingAtMs !== null) ? (readyAtMs - servingAtMs) : null;
  let error = ready ? null : `timeout waiting for /__/functions.yaml 200 (${readyTimeoutMs}ms)`;

  // بيانات التوقيت (إن طُلبت) — تُجلَب عبر قناة HTTP جانبية من نفس العملية
  // **قبل** أي إنهاء لها، لا بعده. اكتُشف تجريبياً على ويندوز: SIGTERM لا
  // يُسلَّم بمعناه POSIX أصلاً — توثيق Node صريح: على ويندوز `child.kill(sig)`
  // يُنهي العملية فوراً (مثل SIGKILL) بصرف النظر عن الإشارة المطلوبة، فمعالج
  // 'SIGTERM' في العملية الفرعية لا يُستدعى إطلاقاً مهما طالت المهلة — وهذا
  // يفسّر ENOENT المتكرّر رغم exitedBySignal:'SIGTERM' في المحاولة السابقة.
  // فالتصميم هنا لا يعتمد على أي إشارة إطلاقاً لأجل البيانات: نقرأها من
  // الخادم الحيّ عبر timerPort فور نجاح /__/functions.yaml، ثم الإنهاء
  // (SIGKILL مباشرة) آمن لأن البيانات وصلت فعلاً.
  let timings = null;
  let timingsError = null;
  if (ready && timerPort) {
    try {
      timings = await httpGetJson(`http://127.0.0.1:${timerPort}/`, 2000);
    } catch (e) {
      timingsError = String((e && e.message) || e);
    }
  }

  // إيقاف — /__/quitquitquit (أفضل جهد)، ثم إنهاء فوري. لا حاجة لخروج نظيف
  // بعد الآن (البيانات جُلبت أعلاه إن وُجدت) — SIGKILL مباشرة يكفي ويتفادى
  // انتظار مهلة إغلاق غير مضمونة (مقابض خلفية من firebase-admin تُبقي
  // العملية حيّة حتى بعد server.close()، مُلاحَظ تجريبياً في هذا القياس).
  let exitedBySignal = null; // 'natural' | 'SIGKILL' | null
  const exitPromise = new Promise((resolve) => child.once('exit', resolve));
  try {
    await httpGet(`http://127.0.0.1:${port}/__/quitquitquit`, 2000);
  } catch (e) { /* best effort */ }
  const naturalExit = await Promise.race([exitPromise.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]);
  if (naturalExit) {
    exitedBySignal = 'natural';
  } else {
    try { child.kill('SIGKILL'); } catch (e) { /* already dead */ }
    await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 2000))]);
    exitedBySignal = 'SIGKILL';
  }

  return {ok, ms, startupMs, loadMs, servingAtMs, error, port, stdout, stderr: sanitizeText(stderr), exitedBySignal, timings, timingsError};
}

/**
 * تنقية نصّ قبل طباعته/كتابته — القاعدة 36: ردّ العملية الفرعية (stderr) قد
 * يحمل شظايا أسرار حتى بلا استدعاء شبكة حقيقي (متغيّرات بيئة، مسارات
 * تحوي أسماء مستخدمين، إلخ). تُقصّ الأسطر الطويلة جداً، وتُستبدَل تسلسلات
 * تشبه المفاتيح/التوكِنات (hex/base64 طويلة) وأي سطر يذكر Authorization/
 * Bearer/api_key/secret بنص محايد. لا تعتمد على أنها شاملة — أفضل جهد.
 * @param {string} text
 * @return {string}
 */
function sanitizeText(text) {
  if (!text) return text;
  let out = text;
  out = out.replace(/[A-Za-z0-9_\-]{32,}/g, '[REDACTED-TOKEN-LIKE]');
  out = out.split('\n')
      .map((line) => /authorization|bearer|api[_-]?key|secret|password/i.test(line) ? '[REDACTED-LINE: matched credential-like keyword]' : line)
      .join('\n');
  if (out.length > 4000) out = out.slice(0, 4000) + '\n…[truncated]';
  return out;
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {timeout: timeoutMs}, (res) => {
      let body = '';
      res.on('data', (d) => { body += d.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout')); });
  });
}

/**
 * بيئة مضبوطة — تُطابق ما يصفه المدقّق أنّ firebase-tools يمرّره (env
 * الدوالّ المحمَّلة + FUNCTIONS_CONTROL_API + PORT + HOME + PATH + NODE_ENV)
 * **بلا** قراءة functions/.env — القيد باقٍ: لا يُقرأ ولا يُطبع ولا يُمرَّر.
 * تحقّق ثابت بالقراءة (Grep على functions/src): صفر مطابقة لـ"process.env."
 * أو "process.env[" في كل الوحدات الـ66 القابلة للوصول من index.js — فلا
 * أثر متوقَّع من غياب .env على زمن التحميل نفسه (لا فرع كودي يقرأ متغيّراً
 * بيئياً عند التحميل في src/؛ نطاق هذا التحقّق src/ فقط لا node_modules).
 * @param {Object} baseEnv
 * @param {Object} opts
 * @param {?number} timerPort منفذ القناة الجانبية لـrequire-timer، إن وُجد
 * @return {Object}
 */
function buildMinimalEnv(baseEnv, opts, timerPort) {
  const keep = ['PORT', 'FUNCTIONS_CONTROL_API', 'HOME', 'PATH', 'NODE_ENV', 'SystemRoot', 'TEMP', 'TMP', 'ComSpec'];
  const out = {};
  for (const k of keep) if (typeof baseEnv[k] !== 'undefined') out[k] = baseEnv[k];
  if (opts.requireTimerPath) {
    out.NODE_OPTIONS = `--require ${opts.requireTimerPath}`;
    if (timerPort) out.REQUIRE_TIMER_PORT = String(timerPort);
  }
  return out;
}

// القيمة التقريبية لـFIREBASE_CONFIG/CLOUD_RUNTIME_CONFIG — غير سرّية،
// وغير مطابقة بالضرورة لما يجلبه CLI الحقيقي من الشبكة (قد يحمل حقولاً
// إضافية: databaseURL، locationId، إلخ). PROJECT_ID مطابق لـ.firebaserc:3.
const APPROX_PROJECT_ID = 'neuralchek-9b6d7';
const APPROX_FIREBASE_CONFIG = {
  projectId: APPROX_PROJECT_ID,
  storageBucket: `${APPROX_PROJECT_ID}.firebasestorage.app`,
};

/**
 * نمط بيئة CLI — بأمر المنسّق 2026-09-27 (متابعة)، بعد أن أثبت أن نمط
 * buildMinimalEnv أعلاه معاكس تماماً لما يحتاجه ويندوز فعلياً: العملية
 * الفرعية الحقيقية (PowerShell التي شغّل منها المستخدم firebase) عملت
 * بلا SystemRoot/TEMP/TMP/ComSpec/HOME/USERPROFILE/APPDATA (HOME وNODE_ENV
 * كانا فارغين في تلك الجلسة، وNode يُسقط undefined من env تلقائياً)، ومع
 * GCLOUD_PROJECT وGOOGLE_CLOUD_QUOTA_PROJECT وFIREBASE_CONFIG و
 * CLOUD_RUNTIME_CONFIG — منقولة من قراءة المنسّق لِـfirebase-tools@15.28.2
 * (خارج هذا المستودع؛ **غير متحقَّقة هنا**):
 *   lib/deploy/functions/prepare.js:532-535،
 *   lib/functions/env.js:275-279،
 *   lib/deploy/functions/runtimes/node/index.js:116-127.
 * لا HOME ولا SystemRoot ولا TEMP ولا TMP ولا ComSpec ولا USERPROFILE ولا
 * APPDATA — بعكس buildMinimalEnv تماماً. PATH يبقى فرقاً غير قابل للمطابقة
 * (Git Bash ≠ PowerShell — يُذكر في التقرير لا يُصلَح هنا).
 * @param {Object} baseEnv
 * @param {Object} opts
 * @param {?number} timerPort
 * @return {Object}
 */
function buildCliLikeEnv(baseEnv, opts, timerPort) {
  const out = {
    PORT: baseEnv.PORT,
    FUNCTIONS_CONTROL_API: baseEnv.FUNCTIONS_CONTROL_API,
    PATH: baseEnv.PATH,
    GCLOUD_PROJECT: APPROX_PROJECT_ID,
    GOOGLE_CLOUD_QUOTA_PROJECT: APPROX_PROJECT_ID,
    FIREBASE_CONFIG: JSON.stringify(APPROX_FIREBASE_CONFIG),
    CLOUD_RUNTIME_CONFIG: JSON.stringify({firebase: APPROX_FIREBASE_CONFIG}),
  };
  if (opts.requireTimerPath) {
    out.NODE_OPTIONS = `--require ${opts.requireTimerPath}`;
    if (timerPort) out.REQUIRE_TIMER_PORT = String(timerPort);
  }
  return out;
}

module.exports = {
  runOnce, getFreePort, pollUntil200, buildMinimalEnv, buildCliLikeEnv,
  sanitizeText, APPROX_PROJECT_ID, APPROX_FIREBASE_CONFIG,
};

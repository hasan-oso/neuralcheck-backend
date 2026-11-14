'use strict';

// failureText.test.js — تنقية نصّ الخطأ بمنقٍّ واحد في المواضع الثلاثة (S-SUB-2، 2026-10-17 +03). وحدة بلا شبكة ولا محاكٍ؛ الأشكال الحقيقية من المحاكي في failureText.e2e.test.js.
//
// قرار المستخدم (بنصّه، منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع): «السطران الخامّان (verifyReport.js:227،233) ونصّ e.message من التخزين: (أ) التزام صغير قبل النشر.»
// المطلوب (الأمر): لا scanId خامّ ولا مسار مستند يحمله في سطر serverRawSamplesStorage ولا سطر writeRawAiResponses ولا السبب المُعاد الذي تطبعه runAnalysisInternal — بمنقٍّ واحد (القاعدة 24).
//
// **عن أشكال الأخطاء المستعملة هنا:** المستخدمة في §٣ **مبنيّة** بيد هذا الاختبار — الأولى بصياغة ما قاسه failureText.e2e.test.js على محاكي Firestore (نسخ لشكلها لا لنصّ حقيقي بمعرّف حقيقي)،
// وخطأ GCS **مبنيّ كلّه** لا مأخوذ من GCS حقيقي (لا Storage ولا شبكة هنا). لا شيء منها مأخوذ من Firestore أو GCS الإنتاجيَّين.
//
//   ١ المنقّي: القائمة المغلقة للمسارات، الأشكال (مسار، مشفَّر، متداخل، مغلَق بـ«]»)، والمعرّفات المعروفة (قصير، مشفَّر، متكرّر، غير نصّي)، وما لا يُخفى (الحدّ المُعلَن، الرمز الطويل، الكلمة المجرّدة)،
//   ٢ المصدر الواحد: لا تعريف ثانٍ في functions/src، والمستوردون، ومواضع الطباعة الثلاثة لا تطبع e.message، وreportDoc.id في verifyReport.js مُهشَّر — مع طفرات في الذاكرة (القاعدة 39)،
//   ٣ سلوك الموضعين بأخطاء مبنيّة: السطر والسبب المُعاد لا يحملان المعرّف، والتشخيص باقٍ.
//
// Run: node functions/test/failureText.test.js

const assert = require('assert');
const {IMPORTERS} = require('./lib/failureTextSites');
const fs = require('fs');
const path = require('path');

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// كاتب Firestore محقون (كما في writeRawAiResponses.test.js) — بلا محاكٍ ولا شبكة.
let writeError = null;
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {firestore: {FieldValue: {serverTimestamp: () => 'SERVER_TIMESTAMP_SENTINEL'}}},
    db: {collection: () => ({doc: () => ({set: async () => { if (writeError) throw writeError; }})})},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const F = require('../src/utils/failureText');
const W = require('../src/analysis/writeRawAiResponses');
const S = require('../src/analysis/serverRawSamplesStorage');
const R = require('../src/evaluations/submitEvaluationRefusal');
const {hashIdForLog} = require('../src/utils/logRedaction');

const SCAN = '3f9d2c1e-77aa-4b0e-9c55-0a1b2c3d4e5f'; // UUID: 36 محرفاً (يلتقطه نمط الرمز الطويل أيضاً)
const SHORT = 'scan-abc-123'; // 12 محرفاً: أقصر من 24 فلا يلتقطه نمط الرمز الطويل
const mkErr = (msg, code) => Object.assign(new Error(msg), code === undefined ? {} : {code});

(async () => {
  // ═══ ١ — المنقّي ═══
  deq([...F.FAILURE_PATH_COLLECTIONS].sort(),
      ['aiRawResponses', 'evaluations', 'reportRaw', 'reports', 'scanClaims', 'scanSessions', 'serverSamples', 'users'],
      '[١] القائمة المغلقة: الستّ القديمة + aiRawResponses + serverSamples');
  ok(Object.isFrozen(F.FAILURE_PATH_COLLECTIONS), '[١] مجمَّدة');
  for (const c of F.FAILURE_PATH_COLLECTIONS) {
    const out = F.sanitizeFailureText(mkErr(`failed at projects/p/databases/(default)/documents/${c}/${SHORT} now`));
    ok(out.includes(`${c}/[id]`) && !out.includes(SHORT), `[١] مسار ${c}: المعرّف يُخفى ويبقى اسم المجموعة`);
  }
  // الأشكال
  let out = F.sanitizeFailureText(mkErr(`6 ALREADY_EXISTS: entity already exists: EntityRef[partitionRef=dev~demo-nc, path=/aiRawResponses/${SHORT}]`, 6));
  ok(!out.includes(SHORT) && out.includes('aiRawResponses/[id]]') && out.includes('code=6') && out.includes('ALREADY_EXISTS'), '[١] الشكل المغلَق بـ«]» (محاكي Firestore): المعرّف يُخفى وتبقى «]» والتشخيص');
  out = F.sanitizeFailureText(mkErr(`upload failed: https://storage.googleapis.com/upload/storage/v1/b/bkt/o?uploadType=multipart&name=serverSamples%2F${SHORT}.json.gz&x=1`, 403));
  ok(!out.includes(SHORT) && out.includes('serverSamples/[id]') && out.includes('code=403'), '[١] عنوان طلب GCS مشفَّراً %2F: المعرّف يُخفى');
  out = F.sanitizeFailureText(mkErr(`gs://bkt/serverSamples%2f${SHORT}.json.gz not writable`));
  ok(!out.includes(SHORT) && out.includes('serverSamples/[id]'), '[١] %2f بحرف صغير أيضاً');
  out = F.sanitizeFailureText(mkErr(`object serverSamples/${SHORT}.json.gz denied`));
  ok(!out.includes(SHORT) && out.includes('serverSamples/[id]'), '[١] اسم الكائن serverSamples/<id>.json.gz');
  out = F.sanitizeFailureText(mkErr(`bad path aiRawResponses/${SHORT}/sub/leaf-secret end`));
  ok(!out.includes(SHORT) && !out.includes('leaf-secret') && out.includes('aiRawResponses/[id]'), '[١] المسار المتداخل يُخفى كلّه (كان ينقطع عند أوّل «/» فيسرّب النصف الباقي)');
  // المعرّفات المعروفة
  const elementForm = `5 NOT_FOUND: no entity to update: app: "dev~demo-nc"\npath <\n  Element {\n    type: "aiRawResponses"\n    name: "${SHORT}"\n  }\n>\n`;
  ok(F.sanitizeFailureText(mkErr(elementForm, 5)).includes(SHORT), '[١] ضابط: شكل Element (بلا شرطة مائلة) لا يُخفيه المسار ولا الرمز الطويل لمعرّف أقصر من 24 — فالمعرّف المعروف ضرورة');
  out = F.sanitizeFailureText(mkErr(elementForm, 5), {knownIds: [SHORT]});
  ok(!out.includes(SHORT) && out.includes('NOT_FOUND') && out.includes('type: "aiRawResponses"'), '[١] المعرّف المعروف يُخفيه في شكل Element ويبقى التشخيص واسم المجموعة');
  out = F.sanitizeFailureText(mkErr(`Value for argument "documentPath" must point to a document, but was "${SHORT}". again ${SHORT}`), {knownIds: [SHORT]});
  ok(!out.includes(SHORT) && out.split('[id]').length - 1 === 2 && out.includes('documentPath'), '[١] المعرّف وحده بلا مجموعة (تحقّق وسائط Admin SDK) وبتكرار: كلّ ورود يُخفى');
  const odd = 'scan id/with:special';
  out = F.sanitizeFailureText(mkErr(`bad ${odd} and ${encodeURIComponent(odd)} end`), {knownIds: [odd]});
  ok(!out.includes(odd) && !out.includes(encodeURIComponent(odd)), '[١] المعرّف المعروف يُخفى بقيمته وبصيغة encodeURIComponent');
  out = F.sanitizeFailureText(mkErr(`code in text ${SHORT}`, `E-${SHORT}`), {knownIds: [SHORT]});
  ok(!out.includes(SHORT), '[١] وفي حقل code أيضاً');
  // الحدّ المُعلَن: أقصر من KNOWN_ID_MIN_LENGTH لا يُخفى بقيمته، ويُخفى في المسار
  eq(F.KNOWN_ID_MIN_LENGTH, 8, '[١] الحدّ الأدنى للمعرّف المعروف 8');
  out = F.sanitizeFailureText(mkErr('value ab12 here, reports/ab12 there'), {knownIds: ['ab12']});
  ok(out.includes('value ab12 here') && out.includes('reports/[id]'), '[١] معرّف أقصر من الحدّ: لا يُخفى بقيمته (حدّ مُعلَن) ويُخفى في المسار');
  let threw = null;
  try { out = F.sanitizeFailureText(mkErr('plain failure'), {knownIds: [null, undefined, 123, {}, '', 'x']}); } catch (e) { threw = e; }
  ok(threw === null && out.endsWith('plain failure'), '[١] عناصر knownIds غير النصّية والفارغة تُتجاهَل بلا رمي');
  ok(F.sanitizeFailureText(mkErr('x')) === F.sanitizeFailureText(mkErr('x'), {}) && F.sanitizeFailureText(mkErr('x'), {knownIds: []}).endsWith(' x'), '[١] بلا خيارات: السلوك القائم');
  // ما لا يُخفى
  out = F.sanitizeFailureText(mkErr('Permission denied; see reports and users lists', 'ERR_STREAM_PREMATURE_CLOSE'));
  ok(out === '[Error] code=ERR_STREAM_PREMATURE_CLOSE Permission denied; see reports and users lists', '[١] الكلمة المجرّدة (بلا «/») ورمز Node الطويل (26 محرفاً) لا يُمسّان');
  // السلوك القديم باقٍ
  out = F.sanitizeFailureText(mkErr('9 FAILED_PRECONDITION: no entity: projects/p/databases/(default)/documents/evaluations/scan-ABC-secret-id-1 token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 api_key: sk-secretvalue123', 9));
  ok(!/scan-ABC-secret/.test(out) && !/ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(out) && !/sk-secretvalue/.test(out) && /\[Error\] code=9 /.test(out) && /evaluations\/\[id\]/.test(out), '[١] المفتاح والرمز الطويل ومعرّف المسار القديم كما كانت');
  ok(F.sanitizeFailureText(new Error('x'.repeat(500))).length <= 240 && /NO_CODE/.test(F.sanitizeFailureText(null)) && /NO_CODE/.test(F.sanitizeFailureText('plain')), '[١] القصّ وغير الخطأ كما كانا');

  // ═══ ١-ب — قناع البريد في أخطاء المزوّد (البند ٤-د، 2026-10-18 +03) ═══
  // القاعدة 36: ردّ خادم SMTP يعيد عنوان المستلم (`550 5.1.1 <victim@…>: Recipient address rejected`)، والمنقّي لم يكن يُزيله. الأخطاء هنا **مبنيّة** بصياغة ردود SMTP الشائعة (لا شبكة ولا مزوّد)، بعناوين مختلَقة.
  eq(F.FAILURE_EMAIL_PLACEHOLDER, '<email>', '[١-ب] النصّ الثابت للقناع مُصدَّر من المنقّي (مصدر واحد، القاعدة 24)');
  const noAt = (t) => !t.includes('@');
  out = F.sanitizeFailureText(mkErr('550 5.1.1 <a.b+c@sub.example.co.uk>: Recipient address rejected', 'EENVELOPE'));
  eq(out, '[Error] code=EENVELOPE 550 5.1.1 <email>: Recipient address rejected', '[١-ب] EENVELOPE: عنوان بنقاط وزائد ونطاق فرعي داخل <…> يُستبدَل ويبقى الرمز والتشخيص');
  out = F.sanitizeFailureText(mkErr('Invalid recipient user@gmail.com'));
  eq(out, '[Error] code=NO_CODE Invalid recipient <email>', '[١-ب] عنوان مجرّد في نصّ حرّ');
  out = F.sanitizeFailureText(mkErr('554 5.7.1 <x@y.z>: Relay access denied'));
  eq(out, '[Error] code=NO_CODE 554 5.7.1 <email>: Relay access denied', '[١-ب] نطاق قصير جدّاً x@y.z');
  out = F.sanitizeFailureText(mkErr('getaddrinfo ENOTFOUND smtp.gmail.com'));
  eq(out, '[Error] code=NO_CODE getaddrinfo ENOTFOUND smtp.gmail.com', '[١-ب] نصّ بلا عنوان لا يُشوَّه (اسم المضيف باقٍ)');
  out = F.sanitizeFailureText(mkErr('rejected victim.one@example.com and Victim_Two@mail.example.org by server'));
  eq(out, '[Error] code=NO_CODE rejected <email> and <email> by server', '[١-ب] عنوانان في نصّ واحد');
  out = F.sanitizeFailureText(mkErr('{"to":"jane-doe@corp.example.com","reason":"bounce"}'));
  eq(out, '[Error] code=NO_CODE {"to":"<email>","reason":"bounce"}', '[١-ب] عنوان داخل JSON');
  out = F.sanitizeFailureText(mkErr('bad address user@localhost and jürgen@müller.de end'));
  eq(out, '[Error] code=NO_CODE bad address <email> and <email> end', '[١-ب] نطاق بلا نقطة وعنوان بحروف يونيكود');
  out = F.sanitizeFailureText(mkErr('rejected: a-very-long-local-part-with-many-chars-1234567890@example.com now'));
  eq(out, '[Error] code=NO_CODE rejected: <email> now', '[١-ب] جزء محلّي أطول من 24 محرفاً: يُقنَّع كلّه (لا يسبقه نمط الرمز الطويل فيترك «@example.com»)');
  out = F.sanitizeFailureText(mkErr('x'.repeat(185) + ' user.name@example.com tail'));
  ok(noAt(out) && !/user.n/.test(out) && out.includes('<email>'), '[١-ب] عنوان يقع عند حدّ القصّ 200: يُقنَّع قبل القصّ فلا يبقى نصفه');
  out = F.sanitizeFailureText(mkErr('failed at projects/p/databases/(default)/documents/users/jane@example.com now'));
  ok(noAt(out) && !out.includes('jane') && out.includes('users/[id]'), '[١-ب] عنوان داخل مسار مستند: لا يبقى');
  out = F.sanitizeFailureText(mkErr(`bounce to owner@shop.example for ${SHORT} at reports/${SHORT}`), {knownIds: [SHORT]});
  ok(noAt(out) && !out.includes(SHORT) && out.includes('<email>') && out.includes('reports/[id]'), '[١-ب] مع المعرّفات المعروفة والمسار: كلّها تعمل معاً');
  out = F.sanitizeFailureText(mkErr('Invalid recipient user@gmail.com', 'EENVELOPE'));
  eq(F.sanitizeFailureText({message: out, code: 'X'}).endsWith('Invalid recipient <email>'), true, '[١-ب] إعادة التنقية لا تُفسد القناع (<email> ليس عنواناً)');
  out = F.sanitizeFailureText(mkErr('see @scope/pkg and a @ b and 100@'));
  eq(out, '[Error] code=NO_CODE see @scope/pkg and a @ b and 100@', '[١-ب] «@» بلا جزء محلّي وبلا نطاق ليست عنواناً: لا تُشوَّه');
  // sanitizeRawText بلا قناع عمداً: ردّ النموذج الخام المحفوظ بيانات (القاعدة 12) لا رسالة خطأ مزوّد.
  eq(F.sanitizeRawText('mail me at a@b.com'), 'mail me at a@b.com', '[١-ب] sanitizeRawText لا تُقنِّع البريد (الخام المحفوظ بيانات لا نصّ خطأ)');

  // ═══ ٢ — المصدر الواحد والبنية ═══
  eq(W.sanitizeRawText, F.sanitizeRawText, '[٢] writeRawAiResponses تُعيد تصدير sanitizeRawText نفسها (لا نسخة)');
  eq(R.sanitizeFailureText, F.sanitizeFailureText, '[٢] submitEvaluationRefusal تُعيد تصدير sanitizeFailureText نفسها (لا نسخة)');
  const FN = path.join(__dirname, '..');
  const walk = (dir, o = []) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, o); else if (e.name.endsWith('.js')) o.push(p);
    }
    return o;
  };
  const rel = (p) => path.relative(FN, p).split(path.sep).join('/');
  const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
  const SRC = {};
  for (const f of walk(path.join(FN, 'src'))) SRC[rel(f)] = strip(fs.readFileSync(f, 'utf8'));
  const SELF = 'src/utils/failureText.js';
  const STORAGE = 'src/analysis/serverRawSamplesStorage.js';
  const WRITER = 'src/analysis/writeRawAiResponses.js';
  const REFUSAL = 'src/evaluations/submitEvaluationRefusal.js';
  const RUNNER = 'src/analysis/runAnalysisInternal.js';
  const VERIFY = 'src/reports/verifyReport.js';
  ok(Object.keys(SRC).length >= 50 && SRC[SELF] && SRC[STORAGE] && SRC[WRITER] && SRC[REFUSAL] && SRC[RUNNER] && SRC[VERIFY], `[٢] الحارس يرى ${Object.keys(SRC).length} ملفّاً ويرى الملفّات الستّة (فحص غير فارغ)`);

  /** الانتهاكات المسمّاة. دالّة نقيّة: الطفرات في الذاكرة تمرّ بها. */
  function violations(src) {
    const v = new Set();
    for (const [f, t] of Object.entries(src)) {
      if (f === SELF) continue;
      if (/function\s+sanitize(?:Failure|Raw)Text\b|(?:const|let|var)\s+sanitize(?:Failure|Raw)Text\s*=/.test(t)) v.add(`SECOND_DEFINITION:${f}`);
      if (/\(reports\|reportRaw/.test(t)) v.add(`SECOND_PATH_PATTERN:${f}`);
    }
    const importers = Object.keys(src).filter((f) => f !== SELF && /require\(\s*["'](?:\.\.?\/)+(?:utils\/)?failureText["']\s*\)/.test(src[f])).sort();
    // A-SUB الموجة الأولى (البند ١٣، القاعدة 23 تستبدل الحارس): المستوردون صاروا كل مواضع التنقية المسمّاة؛ مصدر القائمة واحد: test/lib/failureTextSites.js (ويحرسها failureTextSites.test.js).
    if (JSON.stringify(importers) !== JSON.stringify(IMPORTERS)) v.add(`IMPORTERS:${importers.join(',')}`);
    for (const f of [STORAGE, WRITER]) {
      const t = src[f] || '';
      if (/\be\.message\b/.test(t)) v.add(`RAW_E_MESSAGE:${f}`);
      if (!/sanitizeFailureText\(e,\s*\{knownIds:\s*\[scanId\]\}\)/.test(t)) v.add(`NOT_SANITIZED_WITH_KNOWN_ID:${f}`);
    }
    if (/reason:\s*`WRITE_FAILED:\s*\$\{(?!failure\})/.test(src[WRITER] || '') || !/reason:\s*`WRITE_FAILED:\s*\$\{failure\}`/.test(src[WRITER] || '')) v.add('RETURNED_REASON_NOT_THE_SANITIZED_TEXT');
    const printLine = ((src[RUNNER] || '').match(/aiRawResponses write skipped\/failed[^\n]*/) || [''])[0];
    if (!/\$\{writeResult\.reason\}/.test(printLine) || /\.message/.test(printLine)) v.add('RUNNER_PRINT_NOT_ONLY_REASON');
    // verifyReport.js: كل ورود لـreportDoc.id إمّا مُهشَّر أو يُمرَّر إلى بنّاءَي الردّ (لا طباعة)
    const verify = src[VERIFY] || '';
    const all = (verify.match(/reportDoc\.id/g) || []).length;
    const hashed = (verify.match(/hashIdForLog\(reportDoc\.id\)/g) || []).length;
    const builders = (verify.match(/build(?:V7|V6)Response\(reportDoc\.id\b/g) || []).length;
    if (hashed !== 2 || builders !== 2 || all !== hashed + builders) v.add('VERIFY_REPORT_RAW_REPORTDOC_ID');
    // قناع البريد: الحرفية الثابتة <email> في المنقّي وحده (القاعدة 24) — كل موضع آخر يستورد FAILURE_EMAIL_PLACEHOLDER أو يمرّ بالمنقّي.
    for (const [f, t] of Object.entries(src)) if (f !== SELF && /["'`]<email>["'`]|<email>/.test(t)) v.add(`SECOND_EMAIL_PLACEHOLDER:${f}`);
    return [...v].sort();
  }
  deq(violations(SRC), [], '[٢] المصادر الحقيقية: تعريف واحد، المستوردون كما في test/lib/failureTextSites.js، الموضعان لا يطبعان e.message، والسبب المُعاد منقّى، وreportDoc.id مُهشَّر');
  const mutant = (file, from, to) => {
    ok(SRC[file].includes(from), `[٢] الطفرة: النصّ المستهدَف موجود في ${file} — ${from.slice(0, 44)}`);
    return violations({...SRC, [file]: SRC[file].replace(from, to)});
  };
  const appended = (file, extra) => violations({...SRC, [file]: SRC[file] + '\n' + extra + '\n'});
  ok(appended('src/sessions/joinScanSession.js', 'function sanitizeFailureText(e) { return String(e); }').includes('SECOND_DEFINITION:src/sessions/joinScanSession.js'), '[٢] طفرة: تعريف ثانٍ للمنقّي ⟵ يُكشَف (القاعدة 24)');
  ok(appended('src/sessions/createScanSession.js', 'const sanitizeRawText = (t) => t;').includes('SECOND_DEFINITION:src/sessions/createScanSession.js'), '[٢] طفرة: sanitizeRawText معرَّفة ثانيةً ⟵ يُكشَف');
  ok(appended('src/sessions/joinScanSession.js', 'const re = /\\b(reports|reportRaw|evaluations)\\//;').includes('SECOND_PATH_PATTERN:src/sessions/joinScanSession.js'), '[٢] طفرة: نمط إخفاء مسارات ثانٍ ⟵ يُكشَف');
  ok(appended('src/sessions/cancelScanSession.js', 'const {sanitizeFailureText} = require("../utils/failureText");').some((x) => x.startsWith('IMPORTERS:')), '[٢] طفرة: مستورد غير معدَّد في test/lib/failureTextSites.js ⟵ يُكشَف (يُبيَّن من يستورد)');
  ok(mutant(STORAGE, 'const failure = sanitizeFailureText(e, {knownIds: [scanId]});', 'const failure = e.message;').includes(`RAW_E_MESSAGE:${STORAGE}`), '[٢] طفرة: serverRawSamplesStorage يطبع e.message خامّاً ⟵ يُكشَف');
  ok(mutant(STORAGE, 'const failure = sanitizeFailureText(e, {knownIds: [scanId]});', 'const failure = sanitizeFailureText(e);').includes(`NOT_SANITIZED_WITH_KNOWN_ID:${STORAGE}`), '[٢] طفرة: التنقية بلا المعرّف المعروف ⟵ يُكشَف');
  ok(mutant(WRITER, 'const failure = sanitizeFailureText(e, {knownIds: [scanId]});', 'const failure = e.message || e;').includes(`RAW_E_MESSAGE:${WRITER}`), '[٢] طفرة: writeRawAiResponses يطبع e.message خامّاً ⟵ يُكشَف');
  ok(mutant(WRITER, 'reason: `WRITE_FAILED: ${failure}`', 'reason: `WRITE_FAILED: ${e}`').includes('RETURNED_REASON_NOT_THE_SANITIZED_TEXT'), '[٢] طفرة: السبب المُعاد من الخطأ الخام ⟵ يُكشَف (سطر runAnalysisInternal الثالث)');
  ok(mutant(RUNNER, '${writeResult.reason}', '${writeResult.reason} ${writeResult.error && writeResult.error.message}').includes('RUNNER_PRINT_NOT_ONLY_REASON'), '[٢] طفرة: runAnalysisInternal تطبع غير السبب ⟵ يُكشَف');
  ok(appended('src/sessions/joinScanSession.js', 'const EMAIL_MASK = "<email>";').includes('SECOND_EMAIL_PLACEHOLDER:src/sessions/joinScanSession.js'), '[٢] طفرة: حرفية قناع البريد مكرَّرة خارج المنقّي ⟵ يُكشَف (القاعدة 24)');
  ok(mutant(VERIFY, 'لـ scanId=${hashIdForLog(reportDoc.id)}', 'لـ scanId=${reportDoc.id}').includes('VERIFY_REPORT_RAW_REPORTDOC_ID'), '[٢] طفرة: reportDoc.id خامّاً في سطر التحذير ⟵ يُكشَف');
  ok(mutant(VERIFY, '"verifyReport — found:", hashIdForLog(reportDoc.id),', '"verifyReport — found:", reportDoc.id,').includes('VERIFY_REPORT_RAW_REPORTDOC_ID'), '[٢] طفرة: reportDoc.id خامّاً في سطر found ⟵ يُكشَف');

  // ═══ ٣ — سلوك الموضعين بأخطاء مبنيّة (انظر الرأس) ═══
  const lines = [];
  const real = {error: console.error, warn: console.warn, log: console.log};
  const capture = () => { for (const k of Object.keys(real)) console[k] = (...a) => { lines.push(a.join(' ')); }; };
  const release = () => { for (const k of Object.keys(real)) console[k] = real[k]; };
  const log1 = [{attempt: 1, rawResponseText: 'خام', rawResponseProvider: 'deepseek', durationMs: 1}];

  // أشكال بصياغة ما قاسه failureText.e2e.test.js على محاكي Firestore (مبنيّة هنا بمعرّفات هذا الاختبار)
  const shapes = [
    ['ALREADY_EXISTS (محاكي: مسار مغلَق بـ«]»)', (id) => mkErr(`6 ALREADY_EXISTS: entity already exists: EntityRef[partitionRef=dev~demo-nc, path=/aiRawResponses/${id}]`, 6), 'ALREADY_EXISTS'],
    ['NOT_FOUND (محاكي: شكل Element بلا شرطة مائلة)', (id) => mkErr(`5 NOT_FOUND: no entity to update: app: "dev~demo-nc"\npath <\n  Element {\n    type: "aiRawResponses"\n    name: "${id}"\n  }\n>\n`, 5), 'NOT_FOUND'],
    ['تحقّق وسائط Admin SDK (المعرّف وحده)', (id) => mkErr(`Value for argument "documentPath" must point to a document, but was "${id}". Your path does not contain an even number of components.`), 'documentPath'],
  ];
  for (const id of [SCAN, SHORT]) {
    for (const [label, build, diagnostic] of shapes) {
      writeError = build(id);
      lines.length = 0;
      capture();
      let res;
      try { res = await W.writeRawAiResponses(id, log1); } finally { release(); writeError = null; }
      const text = lines.join('\n') + '\n' + res.reason;
      ok(res.written === false && /^WRITE_FAILED: \[Error\] code=/.test(res.reason), `[٣] writeRawAiResponses (${label}, id ${id.length} محرفاً): written=false والسبب WRITE_FAILED بالصيغة المنقّاة`);
      ok(!text.includes(id) && !text.includes(`aiRawResponses/${id}`), `[٣] لا معرّف خامّ ولا مسار مستند في السطر ولا السبب المُعاد (${label}, ${id.length} محرفاً)`);
      ok(lines.length === 1 && lines[0].startsWith(`[writeRawAiResponses] FAILED for scanId=${hashIdForLog(id)}: [Error] code=`) && lines[0].includes(diagnostic) && res.reason.includes(diagnostic), `[٣] السطر يحمل scanId مُهشَّراً والتشخيص باقٍ (${diagnostic}) والسبب المُعاد يحمله أيضاً`);
    }
  }
  // GCS: مبنيّ كلّه
  const gcsShapes = [
    ['اسم الكائن في الرسالة', (id) => mkErr(`Anonymous caller does not have storage.objects.create access to the Google Cloud Storage object serverSamples/${id}.json.gz`, 403)],
    ['عنوان الطلب مشفَّراً %2F', (id) => mkErr(`Request failed: https://storage.googleapis.com/upload/storage/v1/b/bkt/o?uploadType=multipart&name=serverSamples%2F${id}.json.gz`, 403)],
  ];
  for (const id of [SCAN, SHORT]) {
    for (const [label, build] of gcsShapes) {
      const bucket = {file: () => ({save: async () => { throw build(id); }})};
      lines.length = 0;
      capture();
      let res;
      try { res = await S.saveServerRawSamples({bucket, scanId: id, samples: [{ts: 1, v: [1]}]}); } finally { release(); }
      const text = lines.join('\n');
      eq(res.saved, false, `[٣] saveServerRawSamples (GCS مبنيّ: ${label}, ${id.length} محرفاً): saved=false (لا رمي)`);
      ok(lines.length === 1 && lines[0].startsWith(`[serverRawSamplesStorage] فشل حفظ scanId=${hashIdForLog(id)} إلى serverSamples/<scanId>.json.gz: [Error] code=403 `), `[٣] السطر: scanId مُهشَّر والرمز 403 باقٍ (${label}, ${id.length} محرفاً)`);
      ok(!text.includes(id) && !text.includes(encodeURIComponent(id)) && text.includes('serverSamples/[id]'), `[٣] لا معرّف خامّ ولا مشفَّر في السطر، ويبقى اسم المقطع (${label}, ${id.length} محرفاً)`);
    }
  }

  console.log(`\nfailureText.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

'use strict';

// submitEvaluationRefusalGuard.test.js — سطر سجلّ قبل كل رفض في submitEvaluation (V8 قبل أوّل نشر، البند ٦، 2026-10-09). وحدة بلا شبكة ولا محاكي:
// الأسباب مجمَّدة ومن مصدر واحد، وحارس بنيوي (لا `throw new HttpsError` في submitEvaluation.js خارج الدالّة المسجِّلة refuse، فرمي جديد بلا
// سبب يُفشل هنا)، وكل سبب مستعمَل، وrefuse ترفض سبباً غير مُدرَج وتكتب سطرها، ومنقّي نصّ الفشل غير المتوقَّع.
// المسارات نفسها على المعالج الحقيقي: submitEvaluationRefusalLog.e2e.test.js.
//
// Run: node functions/test/submitEvaluationRefusalGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const {SUBMIT_EVALUATION_REFUSAL: R, REFUSAL_REASONS, sanitizeFailureText} = require('../src/evaluations/submitEvaluationRefusal');
const {SESSION_EXPIRY_REASON, sessionExpiryRefusal, assertSessionNotExpired} = require('../src/sessions/sessionTimeout');
const {refuse} = require('../src/evaluations/submitEvaluation');
const {hashIdForLog} = require('../src/utils/logRedaction');

// ═══════════════════════════════════════════════════════════════════
// ١ — الأسباب: مجمَّدة، قيمتها اسمها، فريدة، ومن مصدر واحد
// ═══════════════════════════════════════════════════════════════════
ok(Object.isFrozen(R), '[١] SUBMIT_EVALUATION_REFUSAL مجمَّد');
ok(Object.isFrozen(SESSION_EXPIRY_REASON), '[١] SESSION_EXPIRY_REASON مجمَّد');
for (const [k, v] of Object.entries(R)) eq(v, k, `[١] قيمة ${k} = اسمها (لا قيمة تُكتب في السجلّ بخلاف ما يُبحث به)`);
eq(new Set(Object.values(R)).size, Object.keys(R).length, '[١] لا قيمتان متطابقتان');
eq(Object.keys(R).length, 26, '[١] 26 سبباً: 25 رفضاً مسمّى (20 موضعاً في submitEvaluation.js، منها optionalEnum لثلاثة حقول، وفحص الجلسة لسببين، + رفضا sessionTimeout) + الفشل غير المتوقَّع');
eq(R.SESSION_EXPIRES_AT_INVALID, SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID, '[١] سبب انتهاء الجلسة الأوّل من sessionTimeout.js (مصدره هناك) لا نسخة');
eq(R.SESSION_EXPIRED, SESSION_EXPIRY_REASON.EXPIRED, '[١] والثاني كذلك');
ok(REFUSAL_REASONS.has(R.UNEXPECTED_FAILURE) && REFUSAL_REASONS.size === Object.keys(R).length, '[١] REFUSAL_REASONS = كل الأسباب');

// ═══════════════════════════════════════════════════════════════════
// ٢ — sessionTimeout: السبب والرمز والنصّ من الدالّة نفسها التي ترمي منها analyzeDevice (لا تغيير في سلوكها)
// ═══════════════════════════════════════════════════════════════════
const now = new Date('2026-10-09T12:00:00Z');
deq(sessionExpiryRefusal({expiresAt: new Date('2026-10-09T13:00:00Z')}, now), null, '[٢] جلسة صالحة: لا رفض');
deq(sessionExpiryRefusal({}, now), {reason: 'SESSION_EXPIRES_AT_INVALID', code: 'permission-denied', message: 'جلسة الفحص غير صالحة'}, '[٢] expiresAt غائب: السبب والرمز والنصّ القائمان');
deq(sessionExpiryRefusal({expiresAt: 'not-a-date'}, now), {reason: 'SESSION_EXPIRES_AT_INVALID', code: 'permission-denied', message: 'جلسة الفحص غير صالحة'}, '[٢] expiresAt تالف: نفسه');
deq(sessionExpiryRefusal({expiresAt: new Date('2026-10-09T11:00:00Z')}, now), {reason: 'SESSION_EXPIRED', code: 'failed-precondition', message: 'الجلسة منتهية'}, '[٢] expiresAt في الماضي: السبب والرمز والنصّ القائمان');
let thrown = null;
try { assertSessionNotExpired({expiresAt: new Date('2026-10-09T11:00:00Z')}, now); } catch (e) { thrown = e; }
ok(thrown && thrown.code === 'failed-precondition' && thrown.message === 'الجلسة منتهية', '[٢] assertSessionNotExpired (ما تستعمله analyzeDevice) ترمي الرمز والنصّ نفسيهما كما كانا');
let thrown2 = null;
try { assertSessionNotExpired({}, now); } catch (e) { thrown2 = e; }
ok(thrown2 && thrown2.code === 'permission-denied' && thrown2.message === 'جلسة الفحص غير صالحة', '[٢] وللغياب كذلك');
assertSessionNotExpired({expiresAt: new Date('2026-10-09T13:00:00Z')}, now);
n++;

// ═══════════════════════════════════════════════════════════════════
// ٣ — الحارس البنيوي على submitEvaluation.js
// ═══════════════════════════════════════════════════════════════════
const rawSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'evaluations', 'submitEvaluation.js'), 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');
const source = strip(rawSource);
const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
eq(throwSites.length, 1, '[٣] `throw new HttpsError` واحد فقط في الشيفرة (التعليقات مستثناة)');
const refuseDef = source.indexOf('function refuse(');
const nextFn = source.indexOf('\n}\n', refuseDef);
ok(refuseDef >= 0 && throwSites[0].index > refuseDef && throwSites[0].index < nextFn, '[٣] وهو داخل الدالّة المسجِّلة refuse — فرمي جديد بلا سبب يُفشل هذا الاختبار');
ok(!/\bassertSessionNotExpired\b/.test(source), '[٣] ولا نداء لـassertSessionNotExpired (كانت ترمي من sessionTimeout.js بلا سطر)');
const throwKinds = [...source.matchAll(/\bthrow\s+(new HttpsError|new Error|e)\b/g)].map((m) => m[1]).sort();
deq(throwKinds, ['e', 'new Error', 'new HttpsError'], '[٣] ثلاثة throw فقط: رمي refuse (HttpsError)، وخطأ السبب غير المُدرَج داخلها، وإعادة رمي الفشل غير المتوقَّع كما كان (throw e) — لا غيرها (عدّ المنسّق لغير HttpsError: 0)');
// كل سبب مستعمَل في الملفّ (R.NAME) — عدا سببَي الجلسة (يصلان بـexpiry.reason من sessionTimeout.js)
const viaExpiry = new Set([R.SESSION_EXPIRES_AT_INVALID, R.SESSION_EXPIRED]);
for (const name of Object.keys(R)) {
  if (viaExpiry.has(R[name])) continue;
  ok(new RegExp(`\\bR\\.${name}\\b`).test(source), `[٣] السبب ${name} مستعمَل في submitEvaluation.js`);
}
ok(/refuse\(expiry\.reason, null, expiry\.code, expiry\.message\)/.test(source), '[٣] وسببا الجلسة الباقيان يمرّان بـexpiry.reason (المصدر الواحد في sessionTimeout.js)');
const calls = [...source.matchAll(/\brefuse\(/g)].length - 1; // الأولى تعريف الدالّة
eq(calls, 22, '[٣] 22 نداء refuse: 20 موضع throw سابقاً (الجلسة منها تفرّعت إلى نداءين) + نداء الصلاحية (موضعا sessionTimeout.js)');
// كلّ نداء بسبب من R أو متغيّر السبب المُمرَّر (optionalEnum) أو expiry.reason — لا سلسلة حرفية
const literalReason = [...source.matchAll(/\brefuse\(\s*["'`]/g)];
eq(literalReason.length, 0, '[٣] لا نداء refuse بسبب سلسلة حرفية (الأسباب من المصدر الواحد المُصدَّر وحده)');

// ═══════════════════════════════════════════════════════════════════
// ٤ — refuse: تكتب سطرها ثم ترمي ما أُعطيت، وترفض سبباً غير مُدرَج
// ═══════════════════════════════════════════════════════════════════
const warns = [];
const realWarn = console.warn;
console.warn = (...a) => { warns.push(a.join(' ')); };
let refused = null;
try { refuse(R.SCAN_ID_REQUIRED, null, 'invalid-argument', 'scanId مطلوب'); } catch (e) { refused = e; }
let refusedWithId = null;
try { refuse(R.REPORT_NOT_FOUND, 'secret-scan-id-123', 'not-found', 'التقرير غير موجود'); } catch (e) { refusedWithId = e; }
let unlisted = null;
try { refuse('MADE_UP_REASON', null, 'invalid-argument', 'x'); } catch (e) { unlisted = e; }
console.warn = realWarn;
ok(refused && refused.code === 'invalid-argument' && refused.message === 'scanId مطلوب', '[٤] ترمي الرمز والنصّ المُمرَّرَين كما هما');
eq(warns[0], '[submitEvaluation] refused reason=SCAN_ID_REQUIRED', '[٤] السطر: السبب وحده حين لا scanId');
eq(warns[1], `[submitEvaluation] refused reason=REPORT_NOT_FOUND scanId=${hashIdForLog('secret-scan-id-123')}`, '[٤] ومع scanId مُهشَّراً بـhashIdForLog');
ok(!warns.join('\n').includes('secret-scan-id-123'), '[٤] لا scanId خامّ في السطر');
ok(refusedWithId && refusedWithId.code === 'not-found', '[٤] والرمي كما هو');
ok(unlisted instanceof Error && !(unlisted.code) && /غير مُدرَج/.test(unlisted.message) && warns.length === 2, '[٤] سبب غير مُدرَج: خطأ برمجي صريح، ولا سطر يُكتب بسبب مختلَق');

// ═══════════════════════════════════════════════════════════════════
// ٥ — منقّي نصّ الفشل غير المتوقَّع (القاعدة 36)
// ═══════════════════════════════════════════════════════════════════
const err = Object.assign(new Error('9 FAILED_PRECONDITION: no entity: projects/p/databases/(default)/documents/evaluations/scan-ABC-secret-id-1 token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 api_key: sk-secretvalue123'), {code: 9});
const clean = sanitizeFailureText(err);
ok(!/scan-ABC-secret/.test(clean) && !/ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(clean) && !/sk-secretvalue/.test(clean), '[٥] لا معرّف مستند ولا رمز طويل ولا مفتاح في النصّ المنقّى');
ok(/\[Error\] code=9 /.test(clean) && /evaluations\/\[id\]/.test(clean), '[٥] الصنف والرمز باقيان، والمسار بلا معرّف');
ok(sanitizeFailureText(new Error('x'.repeat(500))).length <= 240, '[٥] ويُقصّ');
ok(/NO_CODE/.test(sanitizeFailureText(null)) && /NO_CODE/.test(sanitizeFailureText('plain string')), '[٥] مُدخل غير خطأ لا يرمي (NO_CODE)');

// ═══════════════════════════════════════════════════════════════════
// ٦ — لا scanId ولا sessionId خامّاً في أيّ سطر سجلّ من submitEvaluation.js (قرار المستخدم، 2026-10-09 +03، بنصّه:
// «scanId في submitEvaluation.js:309 و:380: يُهشَّر بـ hashIdForLog، في التزام صغير قبل قائمة النشر، مع اختبار.»)
// الفحص على الشيفرة بلا تعليقات: كل نداء console.* يُؤخذ كاملاً، ثم يُحذف منه الاستعمال المُهشَّر (hashIdForLog(scanId)) والتسمية الحرفية
// (scanId=) والشرط (scanId ? ...)، وما بقي من الاسمين فاستعمال خامّ (${scanId} أو وسيط مباشر أو جمع نصّي). حدّه: يرى الاسمين المباشرين فقط،
// لا معرّفاً يمرّ عبر متغيّر آخر — والمسارات الحقيقية تفحصها submitEvaluationScanIdLog.e2e.test.js بأخذ كل سطر يُكتب أثناء النداء.
// ═══════════════════════════════════════════════════════════════════
function rawIdLogViolations(src) {
  const out = [];
  for (const m of src.matchAll(/console\.(?:log|warn|error|info|debug)\(([\s\S]*?)\);\n/g)) {
    const rest = m[1]
        .replace(/hashIdForLog\((?:scanId|sessionId)\)/g, '')
        .replace(/\(scanId \? /g, '(')
        .replace(/\b(?:scanId|sessionId)=/g, '');
    const raw = rest.match(/\b(?:scanId|sessionId)\b/g);
    if (raw) out.push(m[0].split('\n')[0].trim());
  }
  return out;
}
const consoleCalls = [...source.matchAll(/console\.(?:log|warn|error|info|debug)\(/g)].length;
eq(consoleCalls, 4, '[٦] أربعة نداءات console في submitEvaluation.js: سطر الرفض، والربط الناقص، والتقييم الناجح، والفشل غير المتوقَّع (نداء جديد يُعدّ هنا قبل أن يمرّ)');
deq(rawIdLogViolations(source), [], '[٦] لا نداء console في submitEvaluation.js يكتب scanId أو sessionId خامّاً');
// الفاحص نفسه يُرفَض به الشكل القديم ويقبل الجديد (وإلا مرّ كل شيء بصمت)
ok(rawIdLogViolations('console.error(`[submitEvaluation] LINKAGE INCOMPLETE scanId=${scanId} ` +\n    `missing=[x]`);\n').length === 1, '[٦] الفاحص: الشكل القديم scanId=${scanId} يُرفَض');
ok(rawIdLogViolations('console.log(`[submitEvaluation] scanId=${scanId} owner=${hashIdForLog(ownerId)} ` +\n    `source=a`);\n').length === 1, '[٦] الفاحص: السطر القديم (المالك مُهشَّر وscanId خامّ) يُرفَض');
ok(rawIdLogViolations('console.log("x", sessionId);\n').length === 1, '[٦] الفاحص: sessionId وسيطاً مباشراً يُرفَض');
ok(rawIdLogViolations('console.log("x " + scanId);\n').length === 1, '[٦] الفاحص: scanId بجمع نصّي يُرفَض');
eq(rawIdLogViolations('console.error(`[a] LINKAGE INCOMPLETE scanId=${hashIdForLog(scanId)} ` +\n    `missing=[x]`);\n').length, 0, '[٦] الفاحص: الشكل المُهشَّر يُقبل');
eq(rawIdLogViolations('console.warn(`[a] refused reason=${r}` + (scanId ? ` scanId=${hashIdForLog(scanId)}` : ""));\n').length, 0, '[٦] الفاحص: شكل سطر الرفض (شرط + مُهشَّر) يُقبل');

console.log(`\nsubmitEvaluationRefusalGuard.test.js: ${n}/${n} assertions passed`);

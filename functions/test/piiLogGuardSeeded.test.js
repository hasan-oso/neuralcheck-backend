'use strict';

// piiLogGuardSeeded.test.js — V8 الدفعة ١ (الخصوصية)، 2026-10-08 +03.
//
// يُثبِت أن الماسح (test/lib/logPiiScanner.js) **يميّز**: عيّنة مزروعة — نصّ داخل
// هذا الاختبار نفسه، لا ملفّ في src — فيها نداء مخالف من كل صنف، يجب أن يرفضها
// كلّها، وعيّنة سليمة يجب أن يقبلها. بدونه، نجاح piiLogGuard.test.js على src قد
// يعني «لا مخالفة» أو «الماسح لا يرى شيئاً» (القاعدة 22).
//
// الرمز ~ في العيّنات يُستبدَل بـ` (الشرطة المائلة الخلفية) كي لا نهرب قوالب
// داخل قوالب. العيّنات نصّ يُمسَح لا يُنفَّذ.
//
// Run: node functions/test/piiLogGuardSeeded.test.js

const assert = require('assert');
const scanner = require('./lib/logPiiScanner');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const q =(s) => s.replace(/~/g, '`');
const scan = (src) => scanner.scanSource('seed.js', q(src));
const rulesOf = (src) => new Set(scan(src).violations.map((v) => v.rule));

const IMPORT = 'const {hashIdForLog, presenceForLog} = require("../utils/logRedaction");\n';

// ═══ ١ — يجب أن يُرفَض: نداء مخالف من كل صنف (بنصّ قرار المستخدم) ═══════════
const REJECT = [
  // —— مستند/كائن مستخدم ——
  ['JSON.stringify(userData)', 'console.log("2 - User data:", JSON.stringify(userData));', ['json-stringify-user-object']],
  ['JSON.stringify(user)', 'console.log(JSON.stringify(user));', ['json-stringify-user-object']],
  ['JSON.stringify على حقل من مستخدم', 'console.log(JSON.stringify(user.settings));', ['json-stringify-user-object']],
  ['.data() لمستند مستخدم', 'console.log("doc:", userDoc.data());', ['document-dump']],
  ['.data() عبر سلسلة', 'console.log(await db.collection("users").doc(id).get().then((d) => d.data()));', ['document-dump']],
  ['JSON.stringify(.data())', 'console.log(JSON.stringify(userDoc.data()));', ['document-dump']],
  ['كائن مستخدم كاملاً', 'console.log("user", user);', ['whole-user-object']],
  ['كائن مالك كاملاً', 'console.log("owner", owner);', ['whole-user-object']],
  ['اختزال خاصّية {user}', 'console.log({user});', ['whole-user-object']],
  ['انتشار {...user}', 'console.log({...user});', ['whole-user-object']],
  ['داخل قالب', 'console.log(~u=${userData}~);', ['whole-user-object']],
  // —— بريد ——
  ['user.email', 'console.log("email:", user.email);', ['secret-field']],
  ['user?.email', 'console.log("email:", user?.email);', ['secret-field']],
  ['user["email"]', 'console.log(user["email"]);', ['secret-field']],
  ['email في قالب', 'console.log(~to ${user.email}~);', ['secret-field']],
  ['ownerEmail', 'console.log(session.ownerEmail);', ['secret-field']],
  ['request.auth.token.email', 'console.log(request.auth.token.email);', ['secret-field']],
  ['actor.email || actor.uid', 'console.log(~by ${actor.email || actor.uid}~);', ['secret-field', 'id-field']],
  // —— هاتف ——
  ['user.phone', 'console.log(user.phone);', ['secret-field']],
  ['user.phoneNumber', 'console.log(user.phoneNumber);', ['secret-field']],
  ['phone_number', 'console.log(request.auth.token.phone_number);', ['secret-field']],
  // —— اسم ——
  ['displayName', 'console.log(user.displayName);', ['secret-field']],
  ['fullName', 'console.log(profileData.fullName);', ['secret-field']],
  ['user.name', 'console.log(user.name);', ['secret-field']],
  ['owner.name', 'console.log(owner?.name);', ['secret-field']],
  // —— رمز FCM: كاملاً أو جزءاً ——
  ['fcmToken كاملاً', 'console.log("rejectPayment FCM token:", user?.fcmToken);', ['secret-field']],
  ['fcmToken أوّل 20', 'console.log(user.fcmToken.substring(0, 20) + "...");', ['secret-field']],
  ['fcmToken آخر 6', 'console.log(user.fcmToken.slice(-6));', ['secret-field']],
  ['fcmToken طوله', 'console.log(user.fcmToken.length);', ['secret-field']],
  ['fcmToken في شرطي', 'console.log("fcmToken:", user.fcmToken ? user.fcmToken.substring(0, 20) : "MISSING");', ['secret-field']],
  ['ownerFcmToken', 'console.log(ownerFcmToken);', ['secret-field']],
  // —— معرّف مستخدم خامّ ——
  ['uid', 'console.log(uid);', ['id-field']],
  ['userId', 'console.log("userId:", userId);', ['id-field']],
  ['ownerId', 'console.log(session.ownerId);', ['id-field']],
  ['technicianId', 'console.log(technicianId);', ['id-field']],
  ['customerId', 'console.log(customerId);', ['id-field']],
  ['auth.uid', 'console.log(request.auth.uid);', ['id-field']],
  ['auth?.uid', 'console.log(request.auth?.uid);', ['id-field']],
  ['joinerUid', 'console.log(joinerUid);', ['id-field']],
  ['sessionOwnerId', 'console.log(sessionOwnerId);', ['id-field']],
  ['معرّف في قالب', 'console.error(~owner=${ownerId}~);', ['id-field']],
  ['معرّف في اختزال {userId}', 'console.log({userId});', ['id-field']],
  ['معرّف في وسيط ثانٍ متعدّد الأسطر', 'console.log(\n    "confirmPayment —",\n    "userId:",\n    payment.userId,\n);', ['id-field']],
  ['logger.warn', 'logger.warn("x", userId);', ['id-field']],
  ['functions.logger.error', 'functions.logger.error("x", payment.userId);', ['id-field']],
  ['require(...).logger.info', 'require("firebase-functions").logger.info("x", ownerId);', ['id-field']],
  // —— تهشير لا يكفي: قصّ، أو غلاف خاطئ، أو تهشير ثم الخامّ معه ——
  ['String(userId)', 'console.log(String(userId));', ['id-field']],
  ['userId.slice(0, 6) — جزء من المعرّف', 'console.log(userId.slice(0, 6));', ['id-field']],
  ['JSON.stringify({userId})', 'console.log(JSON.stringify({userId}));', ['id-field']],
  ['hashIdForLog على بريد (غلاف الصنف الخطأ)', IMPORT + 'console.log(hashIdForLog(user.email));', ['secret-field']],
  ['presenceForLog على معرّف (غلاف الصنف الخطأ)', IMPORT + 'console.log(presenceForLog(userId));', ['id-field']],
  ['هاش ثم الخامّ بجانبه', IMPORT + 'console.log(hashIdForLog(userId), userId);', ['id-field']],
  ['هاش ثم الخامّ بالجمع', IMPORT + 'console.log(hashIdForLog(userId) + userId);', ['id-field']],
  ['غلاف يُغلق قبل الخامّ', IMPORT + 'console.log(hashIdForLog(a), (b), userId);', ['id-field']],
  // —— رمز العرض ——
  ['codeData.code', 'console.log("code:", codeData.code);', ['promo-code']],
  ['promoCode', 'console.log(promoCode);', ['promo-code']],
  // —— رمز الجلسة (كود الانضمام): يُرفض خامّاً **ومُهشَّراً** (فضاؤه 36^6 قابل للتعداد) ——
  ['رمز الجلسة خامّاً', 'console.log("3 - Generated code:", code);', ['session-code']],
  ['رمز الجلسة مُهشَّراً لا يكفي', IMPORT + 'console.log("3 - Generated code:", hashIdForLog(code));', ['session-code']],
  ['رمز الجلسة في قالب', 'console.log(~code=${code}~);', ['session-code']],
  ['رمز الجلسة في اختزال {code}', 'console.log({code});', ['session-code']],
  ['session.code', 'console.log(session.code);', ['session-code']],
  ['sessionData?.code', 'console.log(sessionData?.code);', ['session-code']],
  ['request.data.code (مُدخل الانضمام)', 'console.log(request.data.code);', ['session-code']],
  ['رمز الجلسة بعد التفكيك في وسيط ثانٍ متعدّد الأسطر', 'console.log(\n  "createScanSession —",\n  "code:",\n  code,\n);', ['session-code']],
  // —— معرّف مستند الجلسة: يُرفض خامّاً، ويُقبل مُهشَّراً ——
  ['معرّف الجلسة ref.id', 'console.log("4 - Session saved:", ref.id);', ['session-id']],
  ['sessionId', 'console.log(sessionId);', ['session-id']],
  ['sessionRef.id', 'console.log(sessionRef.id);', ['session-id']],
  ['sessionDoc?.id', 'console.log(sessionDoc?.id);', ['session-id']],
  ['excludeSessionId', 'console.log(excludeSessionId);', ['session-id']],
  ['request.data.sessionId', 'console.log(request.data.sessionId);', ['session-id']],
  ['معرّف الجلسة في قالب', 'console.log(~session=${sessionId}~);', ['session-id']],
  ['sessionId في فرع شرطي يُطبَع (لا اختبار حضور)', 'console.log(a ? sessionId : "none");', ['session-id']],
  ['sessionId بجانب هاشه', IMPORT + 'console.log(hashIdForLog(sessionId), sessionId);', ['session-id']],
  ['presenceForLog على معرّف الجلسة (غلاف الصنف الخطأ)', IMPORT + 'console.log(presenceForLog(sessionId));', ['session-id']],
  ['String(ref.id)', 'console.log(String(ref.id));', ['session-id']],
  // —— معرّف الفحص (scanId): يُرفض خامّاً، ويُقبل مُهشَّراً (S-SUB، 2026-10-16) ——
  ['scanId خامّاً وسيطاً', 'console.warn("hard AI failure scanId=", scanId);', ['scan-id']],
  ['scanId في قالب', 'console.warn(~[analyzeDevice] duplicate request for scanId=${scanId} ~ +\n    ~(retry storm guard)~);', ['scan-id']],
  ['scanContext?.scanId', 'console.log(~[v6][deepseek] calling: scanId=${scanContext?.scanId} ~);', ['scan-id']],
  ['body.scanId', 'console.log(body.scanId);', ['scan-id']],
  ['request.data.scanId', 'console.log(request.data.scanId);', ['scan-id']],
  ['claimRef.id (قفل scanClaims = scanId)', 'console.warn(~[scanReservation] refused scanId=${claimRef.id} reason=${reason}~);', ['scan-id']],
  ['excludeScanId (اسم ينتهي بـScanId)', 'console.log(excludeScanId);', ['scan-id']],
  ['scanId بجانب هاشه', IMPORT + 'console.log(hashIdForLog(scanId), scanId);', ['scan-id']],
  ['scanId بالجمع بعد هاش غيره', IMPORT + 'console.log(hashIdForLog(a) + scanId);', ['scan-id']],
  ['presenceForLog على scanId (غلاف الصنف الخطأ)', IMPORT + 'console.log(presenceForLog(scanId));', ['scan-id']],
  ['String(scanId)', 'console.log(String(scanId));', ['scan-id']],
  ['scanId في فرع شرطي يُطبَع (لا اختبار حضور)', 'console.log(a ? scanId : "none");', ['scan-id']],
  ['scanId في وسيط ثانٍ متعدّد الأسطر', 'console.log(\n  "generateReportPdf — scanId:",\n  scanId,\n  "shortId:", shortId,\n);', ['scan-id']],
  ['scanId عبر معامل مراقَب (cons)', 'function emit(a, cons) {\n  cons.warn(~x scanId=${scanId}~);\n}\nemit(r, console);', ['scan-id']],
  // —— reportDoc.id: مستند reports/{scanId} في verifyReport.js، هو scanId بعينه (S-SUB-2، 2026-10-17) ——
  ['reportDoc.id خامّاً وسيطاً', 'console.log("verifyReport — found:", reportDoc.id, "shortId:", report.shortId);', ['scan-id']],
  ['reportDoc.id في قالب', 'console.warn(~لـ scanId=${reportDoc.id} — تُعامَل V6 احتياطاً~);', ['scan-id']],
  ['reportDoc?.id', 'console.log(reportDoc?.id);', ['scan-id']],
  ['reportDoc.id بجانب هاشه', IMPORT + 'console.log(hashIdForLog(reportDoc.id), reportDoc.id);', ['scan-id']],
  ['presenceForLog على reportDoc.id (غلاف الصنف الخطأ)', IMPORT + 'console.log(presenceForLog(reportDoc.id));', ['scan-id']],
  ['reportDoc.id عبر معامل مراقَب (cons)', 'function emit(a, cons) {\n  cons.warn(~x ${reportDoc.id}~);\n}\nemit(r, console);', ['scan-id']],
  ['scanId في النداء الثاني من سلسلة', IMPORT + 'console.log(hashIdForLog(scanId));\nconsole.log(scanId);', ['scan-id']],
  // —— paymentId / reportId / shortId / doc.id / متغيّر مشتقّ (البند ٤-ج، 2026-10-18): يُرفض خامّاً، ويُقبل مُهشَّراً ——
  ['paymentId خامّاً في قالب', 'console.warn(~[confirmPayment] refused paymentId=${paymentId} userId=${hashIdForLog(u)}~);', ['payment-id']],
  ['request.data.paymentId', 'console.log(request.data.paymentId);', ['payment-id']],
  ['payment.id', 'console.log("paid", payment.id);', ['payment-id']],
  ['paymentRef.id', 'console.log(paymentRef.id);', ['payment-id']],
  ['lastPaymentId (اسم ينتهي بـPaymentId)', 'console.log(lastPaymentId);', ['payment-id']],
  ['paymentId بجانب هاشه', IMPORT + 'console.log(hashIdForLog(paymentId), paymentId);', ['payment-id']],
  ['presenceForLog على paymentId (غلاف الصنف الخطأ)', IMPORT + 'console.log(presenceForLog(paymentId));', ['payment-id']],
  ['reportId خامّاً', 'console.log("report", reportId);', ['report-id']],
  ['reportRef خامّاً في قالب (runAnalysisInternal.js:204)', 'console.warn(~[ScanCompare] reportRef ${oldReportRef} not found — falling through to AI~);', ['report-id']],
  ['lastReportId (اسم ينتهي بـReportId)', 'console.log(lastReportId);', ['report-id']],
  ['shortId خامّاً بعد نصّ التسمية', 'console.log("generateReportPdf — shortId:", shortId, "size:", n);', ['short-id']],
  ['report.shortId خامّاً', 'console.log("found", report.shortId || "(none)");', ['short-id']],
  ['shortId في فرع شرطي يُطبَع', 'console.log(a ? shortId : "none");', ['short-id']],
  ['inputShortId (اسم ينتهي بـShortId)', 'console.log(inputShortId);', ['short-id']],
  ['shortId بجانب هاشه', IMPORT + 'console.log(hashIdForLog(shortId), shortId);', ['short-id']],
  ['doc.id خامّاً (معرّف مستخدم/جلسة/فحص بلا اسمه)', 'console.error("Failed to send expired email for user", doc.id, e);', ['doc-id']],
  ['doc.id في قالب', 'console.log(~[ProfileLookup] Found: ${doc.id}~);', ['doc-id']],
  ['doc?.id', 'console.log(doc?.id);', ['doc-id']],
  ['doc.id بجانب هاشه', IMPORT + 'console.log(hashIdForLog(doc.id), doc.id);', ['doc-id']],
  ['متغيّر مشتقّ: String(scanId).trim() ثم طباعته (verifyReport.js:141)',
    'const inputId = String(scanId).trim();\nconst upperId = inputId.toUpperCase();\nconsole.log("verifyReport — input:", inputId, "upper:", upperId);', ['derived-id']],
  ['اشتقاق من مشتقّ: "NC-" + upperId', 'const inputId = String(scanId).trim();\nconst upperId = inputId.toUpperCase();\nconst withPrefix = "NC-" + upperId;\nconsole.log(withPrefix);', ['derived-id']],
  ['اشتقاق قالبي من shortId (generateReportPdf.js:34)', 'const printUrl = ~${BASE}/print/${encodeURIComponent(shortId)}/?lang=${lang}~;\nconsole.log(~launching ${printUrl}~);', ['derived-id']],
  ['اشتقاق من uid', 'const who = String(request.auth.uid);\nconsole.log("by", who);', ['derived-id']],
  ['اشتقاق من doc.id', 'const key = doc.id.toLowerCase();\nconsole.log(key);', ['derived-id']],
  ['مشتقّ في وسيط ثانٍ متعدّد الأسطر', 'const t = userId.trim();\nconsole.warn(\n  "x",\n  t,\n);', ['derived-id']],
  ['مشتقّ بجانب هاشه', IMPORT + 'const t = userId.trim();\nconsole.log(hashIdForLog(t), t);', ['derived-id']],
  ['مشتقّ عبر معامل مراقَب (cons)', 'const t = String(scanId);\nfunction emit(a, cons) {\n  cons.warn(~x ${t}~);\n}\nemit(r, console);', ['derived-id']],
  ['اشتقاق من تصريح بفاصلة (const a = 1, b = scanId)', 'const a = 1, b = String(scanId);\nconsole.log(b);', ['derived-id']],
  // —— التفاف على النداء ——
  ['نسخ console.log إلى متغيّر', 'const log = console.log;\nlog(userId);', ['console-alias']],
  ['console.error مُمرَّراً كدالّة', 'p.catch(console.error);', ['console-alias']],
  ['console مُمرَّر لدالّة غير معرَّفة هنا', 'consume(console);', ['console-alias']],
  ['logger.error غير مستدعى', 'const f = logger.error;', ['console-alias']],
  ['console مُمرَّر لدالّة، والنداء داخلها بمعرّف خام',
    'function emit(a, cons) {\n  cons.warn("x", a.userId);\n}\nemit(r, console);', ['id-field']],
  ['console مُمرَّر لدالّة، والنداء داخلها ببريد',
    'function emit(c) { c.log(user.email); }\nemit(console);', ['secret-field']],
  ['المعامِل المُراقَب يُمرَّر ثانيةً', 'function emit(c) { other(c); }\nemit(console);', ['console-alias']],
  // —— المحلّل: بنى تُخفي النداء عن محلّل ساذج ——
  ['نداء بعد قسمة (لا regex)', 'const a = x / 2; console.log(userId); const b = y / 3;', ['id-field']],
  ['نداء بعد regex فيه علامة اقتباس', 'const re = /["\']/g; console.log(userId);', ['id-field']],
  ['نداء بعد regex فيه /*', 'const re = /\\/\\*/; console.log(userId); /* */', ['id-field']],
  ['نداء بعد سلسلة فيها //', 'const u = "http://x"; console.log(userId);', ['id-field']],
  ['نداء بعد قالب فيه /*', 'const t = ~/* ${x} */~; console.log(userId);', ['id-field']],
  ['تعليق كتلة داخل الوسائط', 'console.log(/* بريئة */ userId /* ... */);', ['id-field']],
  ['تعليق سطر بين الوسائط', 'console.log(\n  "a", // ملاحظة\n  userId,\n);', ['id-field']],
  ['قالب متداخل', 'console.log(~a ${~b ${userId}~}~);', ['id-field']],
  ['قالب فيه كائن بأقواس معقوفة', 'console.log(~${ {k: 1}.k } ${userId}~);', ['id-field']],
  ['نداء مضمَّن داخل ردّ نداء', 'items.forEach((i) => { console.log(i, userId); });', ['id-field']],
  ['console.log بمسافة قبل القوس', 'console.log (userId);', ['id-field']],
];

for (const [label, src, expectRules] of REJECT) {
  const r = scan(src);
  ok(r.violations.length > 0, `[١] يُرفَض: ${label}`);
  const got = rulesOf(src);
  for (const rule of expectRules) ok(got.has(rule), `[١] ${label} → القاعدة ${rule} (ظهر: ${[...got].join(',') || 'لا شيء'})`);
}
// كل أصناف الماسح ظهرت فعلاً في العيّنة (لا صنف ميّت). العدد عشرة (2026-10-16: أُضيف session-code وsession-id إلى السبعة، ثم scan-id)، يُثبَّت هنا لا يُكتب باليد.
// القاعدة 23: كان هنا «تسعة» — يثبّت الحالة قبل scan-id، ثم «عشرة» قبل البند ٤-ج (2026-10-18: أُضيفت payment-id وreport-id وshort-id وdoc-id وderived-id → خمسة عشر).
const seenRules = new Set(REJECT.flatMap(([, src]) => [...rulesOf(src)]));
eq(scanner.RULES.length, 15, '[١] أصناف الماسح خمسة عشر (السبعة الأولى + session-code + session-id + scan-id + payment-id + report-id + short-id + doc-id + derived-id)');
for (const rule of scanner.RULES) ok(seenRules.has(rule), `[١] صنف ${rule} مغطّى بعيّنة تُرفَض`);

// استعمال المنقّي بلا استيراد/بتعريف محلّي = مشكلة مستقلّة (القاعدة 24).
ok(scan('console.log(hashIdForLog(a));').helperImportProblems.length > 0, '[١] hashIdForLog بلا require → مشكلة استيراد');
ok(scan('const {hashIdForLog} = require("../utils/logRedaction");\nconsole.log(presenceForLog(a));').helperImportProblems.length > 0,
    '[١] presenceForLog مستعمَل لكن التفكيك لا يحمله → مشكلة (ReferenceError عند التشغيل)');
ok(scan('const x = require("../utils/logRedaction");\nconsole.log(hashIdForLog(a));').helperImportProblems.length > 0,
    '[١] require بلا تفكيك يحمل الاسم → مشكلة');
ok(scan('function hashIdForLog(x) { return "#"; }\nconsole.log(hashIdForLog(a));').helperImportProblems.length > 0, '[١] hashIdForLog معرَّف محلّياً → مشكلة');
ok(scan('const presenceForLog = (x) => x;\nconsole.log(presenceForLog(a));').helperImportProblems.length > 0, '[١] presenceForLog معرَّف محلّياً → مشكلة');
eq(scan(IMPORT + 'console.log(hashIdForLog(a), presenceForLog(b));').helperImportProblems.length, 0, '[١] الاستيراد من utils/logRedaction → لا مشكلة');

// ═══ ٢ — الأسطر الاثنان والعشرون القديمة (6289f97) تُرفَض كلّها ════════════
// نصّ حرفي من functions/src عند 6289f97 قبل هذه الدفعة (git show 6289f97:<file>).
const OLD_22 = [
  ['sessions/createScanSession.js:65', 'console.log("1 - Start createScanSession, userId:", userId);'],
  ['sessions/createScanSession.js:70', 'console.log("2 - User data:", JSON.stringify(userData));'],
  ['sessions/joinScanSession.js:80', 'console.warn("joinScanSession — no fcmToken for owner", session.ownerId);'],
  ['evaluations/submitEvaluation.js:343-348',
    'console.log(~[submitEvaluation] scanId=${scanId} owner=${ownerId} ~ +\n' +
    '    ~source=${isSessionScan ? "session" : "auth"} pending=${pending} ~ +\n' +
    '    ~gradeRaw=${technicianGradeRaw} grade=${technicianGrade} ~ +\n' +
    '    ~appGrade=${snapshot.appGrade} distance=${gradeDistance} ~ +\n' +
    '    ~ratings=${Object.keys(categoryRatings).length} ~ +\n' +
    '    ~defects=${visibleDefects.length} revision=${written.revisionCount}~);'],
  ['evaluations/resolvePendingEvaluation.js:55-56',
    'console.warn(~[resolvePendingEvaluation] owner mismatch scanId=${scanId} ~ +\n' +
    '    ~report.userId=${report.userId} evaluation.ownerId=${evaluation.ownerId}~);'],
  ['notifications/sendNotificationEmail.js:39-44',
    'console.log(\n    "sendNotificationEmail — template:", templateName,\n    "userId:", userId,\n' +
    '    "email:", user.email,\n' +
    '    "fcmToken:", user.fcmToken ? user.fcmToken.substring(0, 20) + "..." : "MISSING",\n);'],
  ['notifications/sendNotificationEmail.js:78', 'console.log("sendNotificationEmail — FCM sent OK to", userId);'],
  ['notifications/sendNotificationEmail.js:83', 'console.warn("sendNotificationEmail — grantSubscription but no fcmToken for user", userId);'],
  ['payments/confirmPayment.js:76-80',
    'console.log(\n    "confirmPayment — userId:", payment.userId,\n    "email:", user?.email,\n' +
    '    "fcmToken:", user?.fcmToken ? user.fcmToken.substring(0, 20) + "..." : "MISSING",\n);'],
  ['payments/confirmPayment.js:115', 'console.log("confirmPayment — FCM sent OK to", payment.userId);'],
  ['payments/confirmPayment.js:120', 'console.warn("confirmPayment — no fcmToken for user", payment.userId);'],
  ['payments/rejectPayment.js:42', 'console.log("rejectPayment FCM token:", user?.fcmToken);'],
  ['payments/rejectPayment.js:43-47',
    'console.log(\n    "rejectPayment — userId:", payment.userId,\n    "email:", user?.email,\n    "reason:", reason || "(none)",\n);'],
  ['payments/rejectPayment.js:88', 'console.log("rejectPayment — FCM sent OK to", payment.userId);'],
  ['payments/rejectPayment.js:93', 'console.warn("rejectPayment — no fcmToken for user", payment.userId);'],
  ['notifications/checkExpiringSubscriptions.js:88', 'console.error("Failed to send expired email to", user.email, e.message || e);'],
  ['notifications/checkExpiringSubscriptions.js:145', 'console.error("Failed to send expiring email to", user.email, e.message || e);'],
  ['notifications/checkExpiringSubscriptions.js:178', 'console.error("Failed to send low-scans email to", user.email, e);'],
  ['admin/aiModelConfig.js:124-125',
    'console.log(~[aiConfig] model ${before.deepseekModel} → ${next} ~ +\n    ~by ${actor.email || actor.uid}~);'],
  ['users/redeemPromoCode.js:121-126',
    'console.log(\n    "redeemPromoCode — userId:", userId,\n    "code:", codeData.code,\n    "plan:", codeData.plan,\n    "scans:", codeData.scans,\n);'],
  ['users/redeemPromoCode.js:164', 'console.log("redeemPromoCode — FCM sent OK to", userId);'],
  ['users/redeemPromoCode.js:169', 'console.warn("redeemPromoCode — no fcmToken for user", userId);'],
];
eq(OLD_22.length, 22, '[٢] اثنان وعشرون موضعاً (9 بيانات شخصية + 13 معرّفاً خامّاً)');
for (const [label, src] of OLD_22) {
  const r = scan(src);
  eq(r.calls.length, 1, `[٢] ${label}: نداء واحد مرئيّ للماسح`);
  ok(r.violations.length > 0, `[٢] الكود القديم يُرفَض: ${label}`);
}

// ═══ ٢-ب — السطران الخامّان في createScanSession.js عند 83a7531 يُرفضان بصيغتهما القديمة (2026-10-16) ═══
// نصّ حرفي من functions/src/sessions/createScanSession.js:106 و:129 عند 83a7531 (git show 83a7531:functions/src/sessions/createScanSession.js). مرّا بالحارس قبل هذه
// الدفعة لأن قواعده كانت أسماء معرّفات المستخدمين والأسرار ورمز العرض وحدها: `code` المجرّدة و`ref.id` ليستا في أيّ منها — والماسح كان يرى النداءين (calls=1) ويحكم
// بلا مخالفة (scratchpad/be-rejoin-rawlog/before-scan-old-lines.txt: violations=[] للسطرين، وللملفّ كلّه calls=7 violations=0).
const OLD_RAW_SESSION = [
  ['sessions/createScanSession.js:106 (رمز الجلسة)', 'console.log("3 - Generated code:", code);', 'session-code'],
  ['sessions/createScanSession.js:129 (معرّف الجلسة)', 'console.log("4 - Session saved:", ref.id);', 'session-id'],
];
eq(OLD_RAW_SESSION.length, 2, '[٢-ب] سطران خامّان');
for (const [label, src, rule] of OLD_RAW_SESSION) {
  const r = scan(src);
  eq(r.calls.length, 1, `[٢-ب] ${label}: نداء واحد مرئيّ للماسح`);
  deq(r.violations.map((v) => v.rule), [rule], `[٢-ب] الكود القديم يُرفَض بقاعدته وحدها: ${label}`);
}

// ═══ ٢-ج — الأسطر الخامّة بـscanId عند c17a053 (24 نداء) تُرفض بصيغتها القديمة (S-SUB، 2026-10-16) ═══
// قرار المستخدم (بنصّه، منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع): «scanId: (أ) يُهشَّر في كل سجلّات الخادم». النصوص حرفية من functions/src عند c17a053 (git show c17a053:<file>)، استخرجتها أداة بالماسح
// نفسه (functions/scripts لا تحوي الأداة: سكربت مؤقّت في مجلّد المهمّة). مرّت كلّها بالحارس قبل هذه الدفعة لأن قواعده كانت أسماء معرّفات المستخدمين والأسرار ورمز العرض ورمز الجلسة ومعرّف الجلسة — لا scanId.
// نداء verifyReport.js (cons.warn) يمرّ عبر معامل مراقَب: يُلفّ هنا بدالّة تستقبل console كما تفعل buildV7Response (verifyReport.js: `buildV7Response(..., console)`).
const OLD_RAW_SCANID = [
  ["src/analysis/analyzeDevice.js:573", "console.warn(`[analyzeDevice] duplicate request for scanId=${scanId} ` +\n            `(retry storm guard)`);"],
  ["src/analysis/analyzeDevice.js:593", "console.warn(`[analyzeDevice] adopted a stale reservation scanId=${scanId} — no second charge`);"],
  ["src/analysis/analyzeDevice.js:658", "console.warn(`[analyzeDevice] hard AI failure scanId=${scanId} ` +\n              `reason=${aiFallbackReason || \"unknown\"} — not charging, not saving`);"],
  ["src/analysis/analyzeDevice.js:792", "console.error(`[analyzeDevice] ${e.message} scanId=${scanId}`);"],
  ["src/analysis/analyzeDevice.js:936", "console.error(`[analyzeDevice] reservation release FAILED scanId=${scanId} — the claim keeps ` +\n                `the reservation: ${releaseErr.message || releaseErr}`);"],
  ["src/analysis/analyzeDevice.js:948", "console.error(`[analyzeDevice] claim cleanup failed for ${scanId}:`,\n                e.message || e);"],
  ["src/analysis/callAI.js:233", "console.log(`[v6][deepseek] calling: scanId=${scanContext?.scanId} ` +\n      `fieldsVersion=${integrity.fieldsVersion === null ? \"n/a\" : integrity.fieldsVersion} ` +\n      `payloadBytes=${userMessage.length} sampleCount=${rawFingerprintForAi.samples.length} ` +\n      `buildMs=${bodyBuildMs}`);"],
  ["src/analysis/callAI.js:243", "console.error(`[v6][integrity] maxBatteryTemp MISMATCH scanId=${scanContext?.scanId} ` +\n        `fieldsVersion=${integrity.fieldsVersion} ` +\n        `delta=${integrity.maxBatteryTempDeltaC}°C — at ${integrity.fieldsVersion} ` +\n        `maxBatteryTemp must equal batteryHealth.batteryTempMaxC; one of them is stale`);"],
  ["src/analysis/callAI.js:252", "console.error(`[v6][integrity] storagePercent INVALID scanId=${scanContext?.scanId} ` +\n        `value=${rawFingerprintForAi.device?.storagePercent} ` +\n        `fieldsVersion=${integrity.fieldsVersion === null ? \"n/a\" : integrity.fieldsVersion} ` +\n        `— above 100, so it is a ≤66 write speed in MB/s, not a percentage`);"],
  ["src/analysis/callAI.js:258", "console.error(`[v6][integrity] availableStorageGb INVALID ` +\n        `scanId=${scanContext?.scanId} ` +\n        `free=${rawFingerprintForAi.device?.availableStorageGb} > ` +\n        `total=${rawFingerprintForAi.device?.totalStorageGb} ` +\n        `fieldsVersion=${integrity.fieldsVersion === null ? \"n/a\" : integrity.fieldsVersion} ` +\n        `— free space cannot exceed capacity; the value is a ≤66 percentage`);"],
  ["src/analysis/callAI.js:498", "console.log(`[v7][deepseek] calling: scanId=${body.scanId} ` +\n      `payloadBytes=${userMessage.length} testResultCount=${body.testResults.length} ` +\n      `buildMs=${bodyBuildMs}`);"],
  ["src/analysis/scanReservation.js:90", "console.warn(`[scanReservation] refused scanId=${claimRef.id} reason=${reason}`);"],
  ["src/analysis/serverRawSamplesStorage.js:96", "console.warn(`[serverRawSamplesStorage] scanId=${scanId}: لا عيّنات لحفظها ` +\n        '(samples غائبة أو فارغة — فحص بلا timeSeries، أو مصفوفة فارغة فعلاً)');"],
  ["src/analysis/serverRawSamplesStorage.js:101", "console.error(`[serverRawSamplesStorage] scanId=${scanId}: bucket غير صالح — لا حفظ`);"],
  ["src/analysis/serverRawSamplesStorage.js:116", "console.error(`[serverRawSamplesStorage] فشل حفظ scanId=${scanId} إلى ${path}: ` +\n        `${(e && e.code) ? e.code + ' ' : ''}${(e && e.message) ? e.message : String(e)}`);"],
  ["src/analysis/writeRawAiResponses.js:83", "console.error(`[writeRawAiResponses] FAILED for scanId=${scanId}: ${e.message || e} — ` +\n        `الفحص يتابع بلا توقّف (القيد الصريح: فشل الكتابة لا يُسقط الفحص)`);"],
  ["src/evaluations/resolvePendingEvaluation.js:57", "console.warn(`[resolvePendingEvaluation] owner mismatch scanId=${scanId} ` +\n                `report.userId=${hashIdForLog(report.userId)} ` +\n                `evaluation.ownerId=${hashIdForLog(evaluation.ownerId)}`);"],
  ["src/evaluations/resolvePendingEvaluation.js:85", "console.error(`[resolvePendingEvaluation] LINKAGE INCOMPLETE ` +\n                `scanId=${scanId} missing=[${missingLinkageFields.join(\",\")}] rawState=${linkageRawState} — ` +\n                `التسمية غير قابلة للربط بالقراءات الخام (ABSENT: لا reportRaw ولا حقول مضمَّنة؛ ` +\n                `وغير ذلك: التقرير كُتب بنسخة analyzeDevice أقدم من e45237e أو بترويسة بلا بصمة)`);"],
  ["src/evaluations/resolvePendingEvaluation.js:102", "console.log(`[resolvePendingEvaluation] resolved scanId=${scanId} ` +\n              `appGrade=${snapshot.appGrade} techGrade=${evaluation.technicianGrade} ` +\n              `distance=${gradeDistance} linkageIncomplete=${linkageIncomplete}`);"],
  ["src/evaluations/resolvePendingEvaluation.js:109", "console.error(`[resolvePendingEvaluation] failed for ${scanId}: ` +\n            `${e.message || e}`);"],
  ["src/profiles/appendScanToHistory.js:82", "console.log(`[ProfileAppend] Appended scan ${scanId} to profile ${profileId}`);"],
  ["src/profiles/createDeviceProfile.js:96", "console.log(`[ProfileCreate] Created profile ${profileId} for scan ${scanId}`);"],
  ["src/reports/generateReportPdf.js:190", "console.log(\n          \"generateReportPdf — scanId:\", scanId,\n          \"shortId:\", shortId,\n          \"size:\", pdfBuffer.length, \"bytes\",\n      );"],
  ["src/reports/verifyReport.js:360", "function emit(a, cons) {\n  cons.warn(\n                `verifyReport — تقرير V7 (scanId=${scanId}) بلا حقول display متوقَّعة: ` +\n                `[${missingKeys.join(\", \")}] — عُوِّضت بقيمة افتراضية آمنة، لا صمت (القاعدة 22، A101)`,\n            );\n}\nemit(r, console);"],
];
eq(OLD_RAW_SCANID.length, 24, '[٢-ج] أربعة وعشرون سطراً خامّاً بـscanId عند c17a053 (الأداة: scanner.findLogCalls على git show c17a053)');
for (const [label, src] of OLD_RAW_SCANID) {
  const r = scan(src);
  ok(r.calls.length >= 1, `[٢-ج] ${label}: نداء log مرئيّ للماسح`);
  // القاعدة 23 (البند ٤-ج): كان «scan-id وحدها»؛ وبعض هذه الأسطر يحمل shortId خامّاً أيضاً (generateReportPdf.js:190) فصار يُرفض بقاعدته كذلك — scan-id حاضرة دائماً وما عداها short-id وحدها.
  const rules2c = [...new Set(r.violations.map((v) => v.rule))];
  ok(rules2c.includes('scan-id') && rules2c.every((x) => x === 'scan-id' || x === 'short-id'), `[٢-ج] الكود القديم يُرفَض بقاعدة scan-id (ومعها short-id حيث يرد shortId): ${label} → ${rules2c.join(',')}`);
}

// ═══ ٢-د — السطران الخامّان بـreportDoc.id في verifyReport.js عند 81e4dc4 يُرفضان بصيغتهما القديمة (S-SUB-2، 2026-10-17) ═══
// قرار المستخدم (بنصّه، منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع): «السطران الخامّان (verifyReport.js:227،233) ونصّ e.message من التخزين: (أ) التزام صغير قبل النشر.» النصّان حرفيان من
// functions/src عند 81e4dc4 (git show 81e4dc4:functions/src/reports/verifyReport.js)، استخرجتهما أداة بالماسح نفسه. `reportDoc.id` هو scanId بعينه (buildV7Response(reportDoc.id, …) تسمّيه scanId)،
// فمرّا بالحارس بعد S-SUB لأن قاعدة scan-id كانت بالاسم scanId وclaimRef.id وحدهما؛ صار المستقبِل reportDoc منها.
const OLD_RAW_REPORTDOC = [
  ["src/reports/verifyReport.js:227", "console.warn(\n              `verifyReport — قيمة pipeline غير معروفة \"${pipelineValue}\" ` +\n              `لـ scanId=${reportDoc.id} — تُعامَل V6 احتياطاً، لا صامتة (القاعدة 22)`,\n          );"],
  ["src/reports/verifyReport.js:233", "console.log(\n            \"verifyReport — found:\", reportDoc.id,\n            \"shortId:\", report.shortId || \"(none)\",\n            \"pipeline:\", pipelineValue === undefined ? \"(missing→v6)\" : pipelineValue,\n        );"],
];
eq(OLD_RAW_REPORTDOC.length, 2, '[٢-د] سطران خامّان بـreportDoc.id عند 81e4dc4 (الأداة: scanner.findLogCalls على git show 81e4dc4)');
for (const [label, src] of OLD_RAW_REPORTDOC) {
  const r = scan(src);
  ok(r.calls.length >= 1, `[٢-د] ${label}: نداء log مرئيّ للماسح`);
  const rules2d = [...new Set(r.violations.map((v) => v.rule))];
  ok(rules2d.includes('scan-id') && rules2d.every((x) => x === 'scan-id' || x === 'short-id'), `[٢-د] الكود القديم يُرفَض بقاعدة scan-id (ومعها short-id في سطر found) — القاعدة 23: كان «scan-id وحدها»: ${label} → ${rules2d.join(',')}`);
}

// ═══ ٢-هـ — السطور الخامّة بالمُدخل العلني وshortId وreportRef عند 2261b0b تُرفض بصيغتها القديمة (البند ٤-ب/٤-ج، 2026-10-18) ═══
// قرار المستخدم: «القاعدة 43 وتنقية السجلّات» (منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع). النصوص حرفية من functions/src عند 2261b0b (git show 2261b0b:<file>) — التصريحات التي تشتقّ منها المتغيّرات
// مضمّنة في العيّنة (الماسح يحتاجها لقاعدة derived-id). مرّت كلّها بالحارس قبل هذه الدفعة: قواعده كانت بأسماء scanId/uid/sessionId لا shortId ولا المدخل المشتقّ ولا reportRef.
const OLD_RAW_4C = [
  ['src/reports/verifyReport.js:139-141 (المُدخل وupper)',
    'const inputId = String(scanId).trim();\n        const upperId = inputId.toUpperCase();\n        console.log("verifyReport — input:", inputId, "upper:", upperId);', ['derived-id']],
  ['src/reports/verifyReport.js:153-156 (shortId query for:)',
    'const upperId = String(scanId).trim().toUpperCase();\n          console.log(\n              "verifyReport — shortId query size:", shortSnap.size,\n              "for:", upperId,\n          );', ['derived-id']],
  ['src/reports/verifyReport.js:164-172 (fallback with prefix:)',
    'const upperId = String(scanId).trim().toUpperCase();\n          const withPrefix = "NC-" + upperId;\n          console.log(\n              "verifyReport — fallback with prefix:", withPrefix,\n              "size:", fallbackSnap.size,\n          );', ['derived-id']],
  ['src/reports/verifyReport.js:179 (not found for:)',
    'const inputId = String(scanId).trim();\n          console.warn("verifyReport — not found for:", inputId);', ['derived-id']],
  ['src/reports/verifyReport.js:233-237 (found: … shortId:)',
    'console.log(\n            "verifyReport — found:", hashIdForLog(reportDoc.id),\n            "shortId:", report.shortId || "(none)",\n            "pipeline:", pipelineValue === undefined ? "(missing→v6)" : pipelineValue,\n        );', ['short-id']],
  ['src/reports/generateReportPdf.js:31-34 (printUrl فيه shortId)',
    'const printUrl =\n    ~${PRINT_BASE_URL}/print/${encodeURIComponent(shortId)}/~ +\n    ~?lang=${safeLang}~;\n  console.log(~[generateReportPdf] launching headless Chrome for ${printUrl}~);', ['derived-id']],
  ['src/reports/generateReportPdf.js:194-198 (shortId:)',
    'console.log(\n          "generateReportPdf — scanId:", hashIdForLog(scanId),\n          "shortId:", shortId,\n          "size:", pdfBuffer.length, "bytes",\n      );', ['short-id']],
  ['src/analysis/runAnalysisInternal.js:204 (reportRef)',
    'console.warn(~[ScanCompare] reportRef ${oldReportRef} not found — falling through to AI~);', ['report-id']],
];
eq(OLD_RAW_4C.length, 8, '[٢-هـ] ثمانية أسطر خامّة عند 2261b0b (الأداة: scanner.inventorySource على git show 2261b0b — scratchpad/logs-4c/before-4c-inventory.txt)');
for (const [label, src, rules] of OLD_RAW_4C) {
  const r = scan(src);
  ok(r.calls.length >= 1, `[٢-هـ] ${label}: نداء log مرئيّ للماسح`);
  deq([...new Set(r.violations.map((v) => v.rule))].sort(), [...rules].sort(), `[٢-هـ] الكود القديم يُرفَض بقاعدته: ${label}`);
}

// ═══ ٣ — يجب أن يُقبَل: عيّنة سليمة (والمرشَّحات الكاذبة) ════════════════════
const ACCEPT = [
  ['المنقّيان مستخدَمان', IMPORT + 'console.log("x", hashIdForLog(userId), presenceForLog(user.fcmToken), presenceForLog(user?.email));'],
  // القاعدة 23: كانت هنا scanId=${scanId} خامّاً مقبولةً (صيغة السطر القديمة في resolvePendingEvaluation.js) — العيّنة تثبّت الحالة قبل قاعدة scan-id؛ صارت بالشكل المُهشَّر الذي يكتبه الكود الآن.
  ['معرّف مُهشَّر في قالب',
    IMPORT + 'console.warn(~owner mismatch scanId=${hashIdForLog(scanId)} report.userId=${hashIdForLog(report.userId)} ~ +\n    ~evaluation.ownerId=${hashIdForLog(evaluation.ownerId)}~);'],
  ['scanId مُهشَّر في سطر الرفض المسمّى (analyzeDevice)', IMPORT + 'console.warn(~[analyzeDevice] duplicate request for scanId=${hashIdForLog(scanId)} ~ +\n    ~(retry storm guard)~);'],
  ['scanContext?.scanId مُهشَّر', IMPORT + 'console.log(~[v6][deepseek] calling: scanId=${hashIdForLog(scanContext?.scanId)} ~ +\n    ~payloadBytes=${n}~);'],
  ['body.scanId مُهشَّر', IMPORT + 'console.log(~[v7][deepseek] calling: scanId=${hashIdForLog(body.scanId)} ~);'],
  ['claimRef.id مُهشَّر', IMPORT + 'console.warn(~refused scanId=${hashIdForLog(claimRef.id)}~);'],
  ['اختبار حضور scanId ثم هاشه (سطر الرفض في submitEvaluation.js)', IMPORT + 'console.warn(~[submitEvaluation] refused reason=${reason}~ + (scanId ? ~ scanId=${hashIdForLog(scanId)}~ : ""));'],
  ['scanId مفتاحاً لكائن قيمته مُهشَّرة', IMPORT + 'console.log({scanId: hashIdForLog(scanId)});'],
  ['scanId في نصّ ثابت فقط', 'console.log("scanId: غائب أو غير نصّي", ~scanId غائب~);'],
  ['النداء الذي يمرّر console معامِلاً ويهشّر scanId', IMPORT + 'function emit(a, cons) {\n  cons.warn(~x scanId=${hashIdForLog(scanId)}~);\n}\nemit(r, console);'],
  ['متعدّد الأسطر كما بعد الإصلاح',
    IMPORT + 'console.log(\n    "rejectPayment — userId:", hashIdForLog(payment.userId),\n    "email:", presenceForLog(user?.email),\n' +
    '    "fcmToken:", presenceForLog(user?.fcmToken),\n    "reason:", presenceForLog(reason),\n);'],
  ['هاش حول تعبير مركَّب', IMPORT + 'console.log(hashIdForLog(String(userId)), hashIdForLog(a ? ownerId : userId), hashIdForLog(request.auth?.uid));'],
  ['مفتاح كائن يحمل اسم معرّف وقيمته مُهشَّرة', IMPORT + 'console.log({userId: hashIdForLog(uid), ownerId: hashIdForLog(o)});'],
  ['حقول غير حسّاسة من المستخدم', 'console.log(user.plan, user?.language, userDoc.exists, userData.scansRemaining, owner?.evaluationEnabled);'],
  ['رمز خطأ ورسالته', 'console.error("FCM failed:", e.code || "", e.message || e);'],
  ['code ليس رمز عرض', 'console.log(err.code, error?.code, response.code);'],
  ['errorCode(e) ليس رمز جلسة', 'console.log(~[x] write FAILED code=${errorCode(e)}~);'],
  ['معرّف الجلسة مُهشَّر (بعد إصلاح createScanSession.js:129)', IMPORT + 'console.log("4 - Session saved:", hashIdForLog(ref.id));'],
  ['اختبار حضور sessionId ثم هاشه (cancelScanSession.js:153)',
    IMPORT + 'console.warn(~[cancelScanSession] refused reason=${reason}~ + (sessionId ? ~ session=${hashIdForLog(sessionId)}~ : "") + ~ caller=${hashIdForLog(uid)}${extra}~);'],
  ['sessionRef.id مُهشَّر (sessionLifecycle.js:156)', IMPORT + 'console.log(~[sessionLifecycle] recorded expired from=${source} session=${hashIdForLog(sessionRef.id)}~);'],
  // القاعدة 23: كانت هنا `reportDoc.id` ضمن «ما لا يُرفض» (حدّ مُعلَن) — يثبّت الحالة قبل S-SUB-2؛ صار reportDoc مستقبِلاً لقاعدة scan-id (مستند reports/{scanId})، فالعيّنة تثبّت الحدّ الباقي وحده.
  // القاعدة 23 (البند ٤-ج): كانت هنا `doc.id, reportRef.id, c.id` ضمن «ما لا يُرفض» (حدّ مُعلَن) — يثبّت الحالة قبل doc-id وreport-id؛ صار doc.id وreportRef (الاسم) يُرفضان خامّين وبقي الحدّ على المستقبلات غير المعروفة.
  ['حدّ معلن: .id على مستقبل غير معروف بالاسم (c وx) لا يُرفض؛ وclaimRef وreportDoc تحكمهما scan-id وdoc تحكمه doc-id', 'console.log(c.id, x.id);'],
  // القاعدة 23 (البند ٤-ب): كان shortId هنا خامّاً مقبولاً (صيغة verifyReport.js بعد S-SUB-2) — يثبّت الحالة قبل short-id؛ صار مُهشَّراً.
  ['reportDoc.id مُهشَّراً (verifyReport.js بعد S-SUB-2) وshortId مُهشَّراً (بعد ٤-ب)', IMPORT + 'console.log("verifyReport — found:", hashIdForLog(reportDoc.id), "shortId:", hashIdForLog(report.shortId));'],
  ['scanId=reportDoc.id مُهشَّراً في قالب', IMPORT + 'console.warn(~لـ scanId=${hashIdForLog(reportDoc.id)} — تُعامَل V6 احتياطاً~);'],
  ['قيمة رمز العرض غائبة والباقي سليم', 'console.log("redeemPromoCode — plan:", codeData.plan, "scans:", codeData.scans);'],
  ['حالة وجود المستند لا محتواه', 'console.log("2 - User doc exists:", userDoc.exists);'],
  ['تعليق سطر فيه نداء مخالف', '// console.log(userId);\nconsole.log("ok");'],
  ['تعليق كتلة فيه نداء مخالف', '/* console.log(user.email); */\nconsole.log("ok");'],
  ['نداء مخالف داخل نصّ', 'const s = "console.log(userId)"; console.log(s);'],
  ['نداء مخالف في نصّ قالب ثابت', 'console.log(~console.log(userId) — نصّ لا شيفرة~);'],
  ['اسم المعرّف في نصّ ثابت فقط', 'console.log("userId: غائب، email: غائب، fcmToken: MISSING");'],
  ['نداء غير log يحمل بيانات (ليس موضوع الحارس)', 'await transporter.sendMail({to: user.email});\nawait admin.messaging().send({token: user.fcmToken});\nconsole.log("sent");'],
  ['معامِل مُراقَب وفيه نداء سليم', IMPORT + 'function emit(c) { c.warn("x", hashIdForLog(uid)); }\nemit(console);'],
  // —— البند ٤-ج: الصيغ المُهشَّرة وما لا يُرفض ——
  ['paymentId مُهشَّراً (confirmPayment.js)', IMPORT + 'console.warn(~[confirmPayment] refused reason=${r} paymentId=${hashIdForLog(paymentId)} userIdState=${s}~);'],
  ['paymentId مفتاحاً لكائن قيمته مُهشَّرة', IMPORT + 'console.log({paymentId: hashIdForLog(paymentId)});'],
  ['اختبار حضور paymentId لا طباعته', 'console.log(paymentId ? "has payment" : "none");'],
  ['shortId مُهشَّراً (verifyReport.js بعد ٤-ب)', IMPORT + 'console.log("verifyReport — found:", hashIdForLog(reportDoc.id), "shortId:", hashIdForLog(report.shortId));'],
  ['reportRef مُهشَّراً بعد نزع البادئة (runAnalysisInternal.js)', IMPORT + 'const staleScanId = typeof oldReportRef === "string" ? oldReportRef.replace(/^reports\\//, "") : null;\nconsole.warn(~[ScanCompare] reportRef ${hashIdForLog(staleScanId)} not found~);'],
  ['مشتقّ مُهشَّر داخل hashIdForLog', IMPORT + 'const inputId = String(scanId).trim();\nconsole.log("verifyReport — input:", hashIdForLog(inputId), "upper:", hashIdForLog(inputId.toUpperCase()));'],
  ['مشتقّ من مُهشَّر لا يُعدّ مشتقّاً من معرّف خامّ', IMPORT + 'const sid = hashIdForLog(sessionRef && sessionRef.id);\nconsole.warn(~x session=${sid}~);'],
  ['رابط بُني من shortId مُهشَّر (generateReportPdf.js بعد ٤-ج)', IMPORT + 'const printUrlForLog = ~${BASE}/print/${hashIdForLog(shortId)}/?lang=${safeLang}~;\nconsole.log(~launching ${printUrlForLog}~);'],
  ['كائن حرفي فيه scanId ليس اشتقاقاً (callAI.js:206)', 'const body = {scanId: scanContext.scanId, language: l};\nconsole.log(body.language, userMessage.length);'],
  ['نتيجة نداء دالّة على معرّف ليست اشتقاقاً نصّياً', 'const report = await loadReport(scanId);\nconsole.log(report.exists, report.size);'],
  ['متغيّر مشتقّ من غير معرّف', 'const label = String(count).trim();\nconsole.log(label, doc.exists);'],
  ['حدّ معلن: .id على مستقبل غير معروف بالاسم (c وx) لا يُرفض؛ و doc.id مُهشَّراً مقبول', IMPORT + 'console.log(c.id, x.id, hashIdForLog(doc.id));'],
  // المرشَّحات الكاذبة (أسطر حرفية من functions/src عند 6289f97)
  ['err.name — callDeepSeek.js:167-168',
    'console.error(~[deepseek] ${isTimeout ? "TIMEOUT" : "NETWORK"} after ${ms}ms ~ +\n' +
    '    ~(limit=${DEEPSEEK_TIMEOUT_MS}ms): ${err.name}: ${err.message || "no message"}~);'],
  ['err.name — callGemini.js:146-147',
    'console.error(~[gemini] FAILED after ${ms}ms (limit=${GEMINI_TIMEOUT_MS}ms): ~ +\n    ~${err.name || "Error"}: ${err.message || "no message"}~);'],
  ['رموز النموذج — callDeepSeek.js:203-207',
    'console.log(~[deepseek] resp in ${ms}ms model=${envelope.model || "?"} ~ +\n' +
    '    ~finish=${finishReason} ~ +\n    ~cache_hit=${usage.prompt_cache_hit_tokens || 0} ~ +\n' +
    '    ~cache_miss=${usage.prompt_cache_miss_tokens || 0} ~ +\n    ~output=${usage.completion_tokens || 0}/${DEEPSEEK_MAX_TOKENS} ~ +\n' +
    '    ~reasoning=${rt} content_len=${contentLen}~);'],
  ['رموز النموذج — callDeepSeek.js:233-235',
    'console.error(~[deepseek] BUDGET EXHAUSTED: thinking consumed the whole ~ +\n' +
    '    ~allowance — output=${usage.completion_tokens || 0}/${DEEPSEEK_MAX_TOKENS} ~ +\n    ~reasoning=${rt} → no tokens left for the answer~);'],
  ['رموز النموذج — callGemini.js:161-165',
    'console.log(~[gemini] resp in ${ms}ms finish=${finishReason} ~ +\n    ~prompt=${usage.promptTokenCount || 0} ~ +\n' +
    '    ~output=${usage.candidatesTokenCount || 0}/${GEMINI_MAX_OUTPUT_TOKENS} ~ +\n' +
    '    ~thoughts=${th}/${GEMINI_THINKING_BUDGET} ~ +\n    ~total=${usage.totalTokenCount || 0} raw_length=${rawText.length}~);'],
  ['رموز مُستبدَلة — fixLeaksLocally.js:368-369',
    'console.log(~[v5][local-fix] tokensReplaced=${tokensReplaced} ~ +\n    ~tokensSkipped=${tokensSkipped} fieldsFixed=${Object.keys(fixes).length}~);'],
  ['اسم بوّابة — buildDisplayShapeV7.js:538-540',
    'console.warn(~[buildDisplayShapeV7][governingGateReason] letterSource=GATE:${name} ~ +\n' +
    '    \'بلا عنصر gatesApplied بالاسم نفسه يحمل cappedOverall=true (أو بنية سقف \' +\n' +
    '    \'البطارية بلا الحقل) — تعارض داخلي، governingGateReason.status=UNMATCHED\');'],
  ['اسم بوّابة — buildDisplayShapeV7.js:550-551',
    'console.warn(~[buildDisplayShapeV7][governingGateReason] بوّابة أطلقت (${hit.name}) بلا نصّ ~ +\n' +
    '    \'عرض عربي في buildGoverningGateDisplayText — أضِف حالة جديدة هناك (S1).\');'],
  ['اسم خاصّية name على غير مستخدم', 'console.log(stage.name, gate.name, err.name, error.name, hit.name);'],
];
for (const [label, src] of ACCEPT) {
  const r = scan(src);
  ok(r.calls.length > 0, `[٣] العيّنة السليمة فيها نداء log يراه الماسح (ليست فارغة): ${label}`);
  eq(r.violations.map((v) => `${v.rule}:${v.name}@${v.line}`).join(','), '', `[٣] يُقبَل: ${label}`);
  eq(r.helperImportProblems.join('|'), '', `[٣] استيراد المنقّيَين سليم: ${label}`);
}

// ═══ ٤ — الشكل الذي لا يفهمه الماسح يرمي — لا يمرّ بصمت (القاعدة 22) ═══════
for (const [label, src] of [
  ['قوس نداء غير مغلق', 'console.log(userId'],
  ['نصّ غير منتهٍ', 'console.log("abc'],
  ['قالب غير منتهٍ', 'console.log(~abc'],
  ['تعليق كتلة غير منتهٍ', 'console.log(1); /* x'],
  ['تعبير قالب غير مغلق', 'console.log(~a ${b~);'],
]) {
  assert.throws(() => scan(src), Error, `[٤] يرمي: ${label}`);
  n++;
}

console.log(`piiLogGuardSeeded.test.js: ${n}/${n} assertions passed (${REJECT.length} rejected samples, ${OLD_22.length} old sites, ${ACCEPT.length} accepted samples)`);

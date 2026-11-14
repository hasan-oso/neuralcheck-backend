// E2E test: تنقية نصّ الخطأ بأخطاء Firestore **حقيقية** من المحاكي المحلّي (S-SUB-2، 2026-10-17 +03).
//
// الأمر (منقول، غير متحقَّق من هذا المستودع): «وصِف شكل النصّ الذي اختبرت به بأنه مبنيّ، لا مأخوذ من GCS أو Firestore حقيقيين، إلا إن أخرجته من المحاكي (Firestore المحلّي يرمي خطأ حقيقياً لكتابة
// مرفوضة مثلاً). قل أيّهما فعلت.»
// **ما هنا مأخوذ من المحاكي أو من التحقّق الحيّ في Admin SDK لا مبنيّ:** (١) ALREADY_EXISTS من `create()` ثانية على المستند نفسه، (٢) NOT_FOUND من `update()` على مستند غائب، (٣) خطأ التحقّق من وسائط
// SDK لمعرّف فيه شرطة مائلة، (٤) كتابة مرفوضة حقاً من المحاكي لمستند أكبر من الحدّ — كلّها بمعرّفات هذا الاختبار، لا نصّ نسخته من الإنتاج. **أمّا خطأ GCS فمبنيّ كلّه** في failureText.test.js (لا Storage ولا شبكة).
// الاستبدال: لا شيء. المعالج الحقيقي writeRawAiResponses على Firestore المحاكى.
//
// ما يثبته:
//   ١ كل شكل حقيقي يحمل المعرّف فعلاً في رسالته الخام (يُثبَّت ذلك أولاً: لا نختبر تنقية نصّ لا يحمله)، والمنقّي بالمعرّف المعروف يُخفيه — ولو كان أقصر من 24 محرفاً (فلا يلتقطه نمط الرمز الطويل).
//   ٢ الشكل ذو المسار (ALREADY_EXISTS) يُخفيه نمط المسار وحده (بلا معرّف معروف).
//   ٣ writeRawAiResponses الحقيقية تفشل كتابتها حقاً (معرّف فيه «/»؛ مستند أكبر من الحدّ): written=false، وسطر السجلّ والسبب المُعاد (الذي تطبعه runAnalysisInternal) بلا المعرّف ولا المسار، ويبقى التشخيص.
//   ٤ الكتابة الناجحة بلا تغيير: written=true والمستند موجود بمفتاح scanId.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/failureText.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {db} = require("../src/utils/admin");
const F = require("../src/utils/failureText");
const {writeRawAiResponses, RAW_RESPONSES_COLLECTION} = require("../src/analysis/writeRawAiResponses");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const UUID = "7c1e5a90-2b3d-4f6a-8e1c-9d0b1a2c3d4e"; // scanId كالإنتاج: 36 محرفاً
const SHORT = "scan-e2e-short-01"; // 17 محرفاً: أقصر من 24
const failing = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

(async () => {
  const shapesSeen = [];
  for (const id of [UUID, SHORT]) {
    // (١) ALREADY_EXISTS: create() ثانية على المستند نفسه
    await db.collection(RAW_RESPONSES_COLLECTION).doc(id).create({seed: 1});
    const dup = await failing(() => db.collection(RAW_RESPONSES_COLLECTION).doc(id).create({seed: 2}));
    // (٢) NOT_FOUND: update() على مستند غائب
    const missingId = id === UUID ? `${UUID}-missing` : "e2e-miss-0001"; // الثاني 13 محرفاً: اسم المستند الغائب نفسه أقصر من 24 فلا يلتقطه نمط الرمز الطويل
    const missing = await failing(() => db.collection(RAW_RESPONSES_COLLECTION).doc(missingId).update({a: 1}));
    // (٣) تحقّق وسائط SDK: معرّف فيه شرطة مائلة
    const slashId = `has/slash-${id}`;
    const bad = await failing(() => db.collection(RAW_RESPONSES_COLLECTION).doc(slashId).set({a: 1}));

    ok(dup && dup.code === 6 && dup.message.includes(id), `[١] ALREADY_EXISTS حقيقي من المحاكي (code=6) ورسالته الخام تحمل المعرّف (${id.length} محرفاً)`);
    ok(missing && missing.code === 5 && missing.message.includes(missingId), `[١] NOT_FOUND حقيقي من المحاكي (code=5) ورسالته الخام تحمل المعرّف (${id.length} محرفاً)`);
    ok(bad && bad.code === undefined && bad.message.includes(slashId), `[١] خطأ التحقّق الحيّ في Admin SDK يحمل المعرّف كاملاً بشرطته المائلة (${id.length} محرفاً)`);
    shapesSeen.push({id: id.length, dup: dup.message.replace(id, '<id>'), missing: missing.message.replace(missingId, '<missing-id>').replace(/\n/g, '\\n'), bad: bad.message.replace(slashId, '<slash-id>')});

    const dupOut = F.sanitizeFailureText(dup, {knownIds: [id]});
    ok(!dupOut.includes(id) && dupOut.includes('ALREADY_EXISTS') && dupOut.includes('code=6'), `[١] ALREADY_EXISTS بعد التنقية بالمعرّف المعروف: بلا معرّف، والتشخيص باقٍ (${id.length})`);
    const dupPathOnly = F.sanitizeFailureText(dup);
    ok(!dupPathOnly.includes(id) && dupPathOnly.includes('aiRawResponses/[id]'), `[٢] ALREADY_EXISTS بنمط المسار وحده (بلا معرّف معروف) يُخفي المعرّف (${id.length})`);
    const missOut = F.sanitizeFailureText(missing, {knownIds: [missingId]});
    ok(!missOut.includes(missingId) && missOut.includes('NOT_FOUND') && missOut.includes('type: "aiRawResponses"'), `[١] NOT_FOUND (شكل Element) بالمعرّف المعروف: بلا معرّف، والتشخيص واسم المجموعة باقيان (${id.length})`);
    const missBare = F.sanitizeFailureText(missing);
    eq(missBare.includes(missingId), missingId.length < 24, `[١] NOT_FOUND بلا معرّف معروف: يُسرّب المعرّفُ الأقصر من 24 ويُخفيه نمط الرمز الطويل لما بلغها (${id.length} محرفاً) — لذلك يُمرَّر المعرّف المعروف`);
    const badOut = F.sanitizeFailureText(bad, {knownIds: [slashId]});
    ok(!badOut.includes(id) && badOut.includes('documentPath'), `[١] خطأ التحقّق بالمعرّف المعروف كاملاً: بلا معرّف، والتشخيص باقٍ (${id.length})`);
  }
  console.log('أشكال الرسائل الخام المقيسة (المعرّف مستبدَل بـ<id>): ' + JSON.stringify(shapesSeen[0]));

  // (٣) writeRawAiResponses الحقيقية: فشل كتابة حقيقي
  const lines = [];
  const real = {error: console.error, warn: console.warn, log: console.log};
  const capture = () => { for (const k of Object.keys(real)) console[k] = (...a) => { lines.push(a.join(" ")); }; };
  const release = () => { for (const k of Object.keys(real)) console[k] = real[k]; };
  const log1 = [{attempt: 1, rawResponseText: "خام", rawResponseProvider: "deepseek", durationMs: 1}];

  for (const id of [`has/slash-${UUID}`, `has/slash-${SHORT}`]) {
    lines.length = 0;
    capture();
    let res;
    try { res = await writeRawAiResponses(id, log1); } finally { release(); }
    const text = `${lines.join("\n")}\n${res.reason}`;
    ok(res.written === false && /^WRITE_FAILED: \[Error\] code=NO_CODE /.test(res.reason), `[٣] writeRawAiResponses بمعرّف فيه «/»: written=false والسبب WRITE_FAILED (فشل حقيقي من Admin SDK) — ${id.length} محرفاً`);
    ok(!text.includes(id) && !text.includes(id.split("/")[1]), `[٣] لا معرّف خامّ ولا نصفه بعد الشرطة المائلة في السطر ولا السبب المُعاد (${id.length} محرفاً)`);
    ok(lines.length === 1 && lines[0].startsWith(`[writeRawAiResponses] FAILED for scanId=${hashIdForLog(id)}: `) && res.reason.includes("documentPath"), `[٣] السطر يحمل scanId مُهشَّراً، والتشخيص (documentPath) باقٍ في السطر والسبب`);
  }
  // كتابة مرفوضة حقاً من المحاكي: مستند أكبر من الحدّ (1 MiB)
  {
    const id = `big-${UUID}`;
    const huge = [{attempt: 1, rawResponseText: "س".repeat(1_200_000), rawResponseProvider: "deepseek", durationMs: 1}];
    lines.length = 0;
    capture();
    let res;
    try { res = await writeRawAiResponses(id, huge); } finally { release(); }
    const text = `${lines.join("\n")}\n${res.reason}`;
    ok(res.written === false && res.reason.startsWith("WRITE_FAILED: [Error] code="), "[٣] مستند أكبر من الحدّ: المحاكي يرفض حقاً والنتيجة written=false بالسبب المنقّى");
    ok(!text.includes(id) && !text.includes("س".repeat(50)), "[٣] لا معرّف خامّ ولا شيء من الخام المكتوب في السطر أو السبب");
    ok(res.reason.length <= "WRITE_FAILED: ".length + 260, `[٣] والسبب مقصوص (${res.reason.length} محرفاً)`);
    console.log("رفض الحجم من المحاكي (السبب المُعاد): " + JSON.stringify(res.reason));
  }
  // (٤) الكتابة الناجحة بلا تغيير
  {
    const id = `ok-${UUID}`;
    lines.length = 0;
    capture();
    let res;
    try { res = await writeRawAiResponses(id, log1); } finally { release(); }
    const snap = await db.collection(RAW_RESPONSES_COLLECTION).doc(id).get();
    ok(res.written === true && res.reason === null && snap.exists && snap.data().scanId === id && lines.length === 0, "[٤] الكتابة الناجحة بلا تغيير: written=true، المستند موجود بمفتاح scanId، ولا سطر");
  }

  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});

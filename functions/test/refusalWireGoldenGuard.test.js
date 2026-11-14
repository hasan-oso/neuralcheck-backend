'use strict';

// refusalWireGoldenGuard.test.js — حارس العيّنتين الذهبيتين: أجسام الرفض الجديدة (refusal-wire-samples-asub-wave1.json) وردّ checkSubscription بشكله الحالي (check-subscription-wire-samples-current-shape.json).
// A-SUB الموجة الأولى، البند ١٤، 2026-10-17 +03 — القاعدتان 39 و41. بلا شبكة وبلا محاكٍ وبلا نداء نموذج.
//
// قرار المستخدم ١٤ (بنصّه، منقول عن أمر المنسّق — غير متحقَّق من هذا المستودع): «بعد ٤ و١٢» — العيّنات الذهبية (القاعدتان 39 و41) لأجسام الرفض الجديدة ولـcheckSubscription بشكله الحالي؛ «والفخّ الذهبي يتبع العقد (39)».
//
// ما يحرسه:
//   ١ الطرف الثاني للعقد (39): الملفّان المُلتزَمان يطابقان ما يُنتجه المولّد الآن حرفاً بحرف (يعيد المولّد البناء من الدوالّ المُصدَّرة الحقيقية خلف غلاف onCall الحقيقي)، ولا يكتب شيئاً.
//   ٢ تغطية القوائم المغلقة: كل رمز في ANALYZE_SESSION_REFUSAL وSCAN_REFUSAL (الخمسة) وCHECK_SUBSCRIPTION_VERDICT له عيّنة، ولا عيّنة بسبب خارج الوحدة. فإضافة رمز بلا عيّنة، أو عيّنة بلا رمز، تُسقط الاختبار.
//   ٣ العقد نفسه: كل رمز من ANALYZE_SESSION_REFUSAL مذكور في §٦-د-١ من docs/PROTOCOL_CONTRACT.md، ولا رمز SESSION_* في ذلك القسم خارج الوحدة (فالوثيقة والكود والعيّنة ثلاثة تتّفق).
//   ٤ النصوص والرموز على السلك كما كانت (permission-denied 403، failed-precondition 400، unauthenticated 401) وبلا تسريب من تقرير مخزَّن في أيّ جسم، وشكل Timestamp على السلك {_seconds,_nanoseconds}.
//   ٥ طفرات في الذاكرة (القاعدة 39): كل خلل مصطنع في الملفّ المُلتزَم أو في الوثيقة يُفشل الحارس بسببه.
//
// Run: node functions/test/refusalWireGoldenGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// المولّد أوّلاً: يضبط المتغيّرين قبل أيّ تحميل لـfirebase-functions في هذه العملية.
const G = require('../scripts/generate-refusal-wire-samples');
const {ANALYZE_SESSION_REFUSAL, CREATE_SESSION_REFUSAL, OWNER_CHECK_STATE} = require('../src/sessions/sessionNames');
const {SCAN_REFUSAL, SCAN_REFUSAL_TEXT, CHECK_SUBSCRIPTION_VERDICT, CHECK_SUBSCRIPTION_VERDICT_FIELD} = require('../src/analysis/scanRefusal');
const {CREATE_SESSION_NO_CREDIT_TEXT, CREATE_SESSION_PLAN_REQUIRED_TEXT} = require('../src/sessions/createScanSession');
const {STORED_REPORT_REFUSAL, STORED_REPORT_REFUSAL_TEXT} = require('../src/analysis/storedReportAccess');

const REFUSAL_PATH = G.REFUSAL_DEST;
const CHECK_PATH = G.CHECK_SUBSCRIPTION_DEST;
const committedRefusal = JSON.parse(fs.readFileSync(REFUSAL_PATH, 'utf8'));
const committedCheck = JSON.parse(fs.readFileSync(CHECK_PATH, 'utf8'));

function diffPaths(a, b, p, out) {
  if (typeof a !== typeof b) { out.push(`${p}: النوع ${typeof a} ≠ ${typeof b}`); return; }
  if (a === null || b === null) { if (a !== b) out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${p}: طول المصفوفة ${a.length} ≠ ${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) diffPaths(a[i], b[i], `${p}[${i}]`, out);
    return;
  }
  if (typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p ? `${p}.${k}` : k, out);
    return;
  }
  if (a !== b) out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
const diff = (fresh, committed) => { const out = []; diffPaths(fresh, committed, '', out); return out; };

(async () => {
  // ═══ ١ — الطرف الثاني للعقد: المُلتزَم = ما يُنتجه المولّد الآن ═══
  const mtimes = [REFUSAL_PATH, CHECK_PATH].map((p) => fs.statSync(p).mtimeMs);
  const freshRefusal = JSON.parse(JSON.stringify({...G.provenance('refusal bodies'), ...(await G.buildRefusalWireSamples())}));
  const freshCheck = JSON.parse(JSON.stringify({...G.provenance('checkSubscription reply, current shape (before decision 8)'), ...(await G.buildCheckSubscriptionWireSamples())}));
  deq([REFUSAL_PATH, CHECK_PATH].map((p) => fs.statSync(p).mtimeMs), mtimes, '[١] البناء لم يكتب ولم يلمس الملفَّين المُلتزَمَين (mtime بلا تغيير)');
  const d1 = diff(freshRefusal, committedRefusal);
  const d2 = diff(freshCheck, committedCheck);
  if (d1.length + d2.length > 0) {
    console.error(`\n⚠️ العقد المُلتزَم لا يطابق ما يُنتجه المولّد فعلياً — ${d1.length + d2.length} فرقاً:`);
    for (const d of [...d1, ...d2].slice(0, 40)) console.error(`  ${d}`);
    console.error('\nالإصلاح: node scripts/generate-refusal-wire-samples.js ثم git add/commit للثابتين المُحدَّثَين (القاعدة 39: في الالتزام نفسه الذي غيّر العقد).\n');
  }
  eq(d1.length, 0, '[١] refusal-wire-samples-asub-wave1.json يطابق مخرَج المولّد الطازج حرفاً بحرف');
  eq(d2.length, 0, '[١] check-subscription-wire-samples-current-shape.json يطابق مخرَج المولّد الطازج حرفاً بحرف');

  // ═══ ٢ — تغطية القوائم المغلقة ═══
  const refusals = committedRefusal.samples;
  const byPrefix = (p) => refusals.filter((s) => s.id.startsWith(p));
  const reasonOf = (s) => (s.body.error && s.body.error.details && s.body.error.details.reasonCode) || null;
  const sessionReasons = new Set(byPrefix('analyzeDevice.session.').map(reasonOf));
  deq([...sessionReasons].sort(), Object.values(ANALYZE_SESSION_REFUSAL).sort(), '[٢] أسباب عيّنات analyzeDevice.session.* = قيم ANALYZE_SESSION_REFUSAL بالضبط (كلها مغطّاة، ولا سبب خارجها)');
  // البند ٢ (2026-10-17): رمز التقرير المخزَّن للمسار الشخصي — عيّنة لكل قيمة في STORED_REPORT_REFUSAL ولا قيمة خارجها
  const personalReasons = new Set(byPrefix('analyzeDevice.storedReport.personal.').map(reasonOf));
  deq([...personalReasons].sort(), Object.values(STORED_REPORT_REFUSAL).sort(), '[٢] أسباب عيّنات analyzeDevice.storedReport.personal.* = قيم STORED_REPORT_REFUSAL بالضبط');
  const gateReasons = new Set([...byPrefix('analyzeDevice.gate.'), ...byPrefix('createScanSession.')].map(reasonOf));
  // البند ١ (A-SUB، 2026-10-17): createScanSession تُضيف رمزاً من sessionNames.js (CREATE_SESSION_REFUSAL) لا من SCAN_REFUSAL — فالمجموعة المغطّاة = الخمسة + قيم CREATE_SESSION_REFUSAL
  deq([...gateReasons].sort(), [...Object.values(SCAN_REFUSAL), ...Object.values(CREATE_SESSION_REFUSAL)].sort(), '[٢] أسباب عيّنات البوّابة وcreateScanSession = القيم الخمس لـSCAN_REFUSAL + قيم CREATE_SESSION_REFUSAL بالضبط');
  const verdicts = new Set(committedCheck.samples.map((s) => s.body.result[CHECK_SUBSCRIPTION_VERDICT_FIELD]));
  deq([...verdicts].sort(), Object.values(CHECK_SUBSCRIPTION_VERDICT).sort(), '[٢] قيم scanVerdict في عيّنات checkSubscription = CHECK_SUBSCRIPTION_VERDICT بالضبط');
  eq(new Set(refusals.map((s) => s.id)).size, refusals.length, '[٢] لا معرّف عيّنة مكرَّر');

  // ═══ ٣ — العقد نفسه: القسم ٦-د-١ ═══
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'PROTOCOL_CONTRACT.md'), 'utf8');
  const sectionOf = (text) => {
    const a = text.indexOf('### ٦-د-١');
    const b = text.indexOf('### ٦-هـ', a);
    return a < 0 || b < 0 ? '' : text.slice(a, b);
  };
  const docViolations = (text) => {
    const sec = sectionOf(text);
    const v = [];
    if (sec === '') return ['SECTION_MISSING'];
    for (const code of [...Object.values(ANALYZE_SESSION_REFUSAL), ...Object.values(STORED_REPORT_REFUSAL), ...Object.values(CREATE_SESSION_REFUSAL)]) if (!sec.includes(code)) v.push(`CODE_NOT_IN_DOC:${code}`);
    const mentioned = new Set(sec.match(/(?<![A-Z_])SESSION_[A-Z_]+/g) || []);
    // حالات ownerCheck (OWNER_CHECK_STATE) تُذكر في القسم لأنها في سطر السجلّ؛ إحداها بادئتها SESSION_ (SESSION_OWNER_ABSENT) وليست رمز رفض، فتُستثنى بمصدرها.
    const known = [...Object.values(ANALYZE_SESSION_REFUSAL), ...Object.values(OWNER_CHECK_STATE)];
    for (const m of mentioned) if (!known.includes(m)) v.push(`DOC_CODE_NOT_IN_MODULE:${m}`);
    return v;
  };
  deq(docViolations(doc), [], '[٣] §٦-د-١ تذكر كل رمز من ANALYZE_SESSION_REFUSAL ولا رمزاً خارجه');

  // ═══ ٤ — النصوص والرموز على السلك، وبلا تسريب ═══
  const find = (id) => refusals.find((s) => s.id === id);
  const wire = (id, status, httpStatus, message, reason) => {
    const s = find(id);
    ok(s, `[٤] عيّنة ${id} موجودة`);
    eq(s.httpStatus, httpStatus, `[٤] ${id}: حالة HTTP`);
    eq(s.body.error.status, status, `[٤] ${id}: status`);
    eq(s.body.error.message, message, `[٤] ${id}: النصّ العربي القائم`);
    deq(s.body.error.details, reason === null ? undefined : {reasonCode: reason}, `[٤] ${id}: details`);
  };
  const INVALID = 'جلسة الفحص غير صالحة';
  wire('createScanSession.SHOP_NO_CREDIT', 'PERMISSION_DENIED', 403, CREATE_SESSION_NO_CREDIT_TEXT, 'SHOP_NO_CREDIT');
  ok(CREATE_SESSION_NO_CREDIT_TEXT !== SCAN_REFUSAL_TEXT[SCAN_REFUSAL.NO_CREDIT], '[٤] ونصّ رصيد createScanSession ليس نصّ البوّابة (قرار المستخدم ٤: لا يُوحَّد)');
  wire('createScanSession.SHOP_SUBSCRIPTION_EXPIRED', 'PERMISSION_DENIED', 403, SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SUBSCRIPTION_EXPIRED], 'SHOP_SUBSCRIPTION_EXPIRED');
  for (const [reason, id] of [['NO_CREDIT', 'NO_CREDIT'], ['SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_EXPIRED'], ['FREE_DEVICE_USED', 'FREE_DEVICE_USED'], ['SHOP_NO_CREDIT', 'SHOP_NO_CREDIT'], ['SHOP_SUBSCRIPTION_EXPIRED', 'SHOP_SUBSCRIPTION_EXPIRED']]) {
    wire(`analyzeDevice.gate.${id}`, 'PERMISSION_DENIED', 403, SCAN_REFUSAL_TEXT[reason], reason);
  }
  // البند ١ (A-SUB، 2026-10-17): رفض الباقة عند الإنشاء — النصّ الجديد المحايد، وجسم واحد للحالتين (free وغياب الحقل)، ولا اسم باقة في الجسم
  wire('createScanSession.SHOP_PLAN_REQUIRED.free', 'PERMISSION_DENIED', 403, CREATE_SESSION_PLAN_REQUIRED_TEXT, 'SHOP_PLAN_REQUIRED');
  wire('createScanSession.SHOP_PLAN_REQUIRED.plan-absent', 'PERMISSION_DENIED', 403, CREATE_SESSION_PLAN_REQUIRED_TEXT, 'SHOP_PLAN_REQUIRED');
  deq(find('createScanSession.SHOP_PLAN_REQUIRED.free').body, find('createScanSession.SHOP_PLAN_REQUIRED.plan-absent').body, '[٤] free وغياب الحقل: جسم **واحد** على السلك (لا وسيط يفرّق)');
  eq(CREATE_SESSION_PLAN_REQUIRED_TEXT, 'هذه الميزة غير متاحة في باقتك الحالية', '[٤] نصّ رفض الباقة بنصّه (محايد: لا يذكر اسم باقة)');
  ok(![CREATE_SESSION_NO_CREDIT_TEXT, SCAN_REFUSAL_TEXT[SCAN_REFUSAL.NO_CREDIT], SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SUBSCRIPTION_EXPIRED], SCAN_REFUSAL_TEXT[SCAN_REFUSAL.FREE_DEVICE_USED]].includes(CREATE_SESSION_PLAN_REQUIRED_TEXT), '[٤] ونصّ رفض الباقة ليس نصّاً قائماً');
  wire('analyzeDevice.session.NOT_PARTICIPANT.stranger', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_NOT_PARTICIPANT');
  wire('analyzeDevice.session.NOT_PARTICIPANT.missing', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_NOT_PARTICIPANT');
  deq(find('analyzeDevice.session.NOT_PARTICIPANT.stranger').body, find('analyzeDevice.session.NOT_PARTICIPANT.missing').body, '[٤] جلسة موجودة (ملغاة) وجلسة غائبة تُرى لغير الطرف بجسم **واحد** (لا وسيط وجود)');
  wire('analyzeDevice.session.NOT_STARTED', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_NOT_STARTED');
  for (const id of ['no-stored-report', 'report-not-owners', 'other-scan']) wire(`analyzeDevice.session.COMPLETED.${id}`, 'PERMISSION_DENIED', 403, INVALID, 'SESSION_COMPLETED');
  wire('analyzeDevice.session.CANCELLED', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_CANCELLED');
  wire('analyzeDevice.session.EXPIRED.recorded', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_EXPIRED');
  wire('analyzeDevice.session.EXPIRED.by-time', 'FAILED_PRECONDITION', 400, 'الجلسة منتهية', 'SESSION_EXPIRED');
  wire('analyzeDevice.session.EXPIRES_AT_INVALID', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_EXPIRES_AT_INVALID');
  wire('analyzeDevice.session.EXPIRED.by-time.stranger', 'FAILED_PRECONDITION', 400, 'الجلسة منتهية', 'SESSION_NOT_PARTICIPANT');
  wire('analyzeDevice.session.STATUS_UNKNOWN', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_STATUS_UNKNOWN');
  // البند ٢ (2026-10-17): التقرير المخزَّن لا يُردّ إلا لمالكه — رمزان (جلسة، وشخصي) بنصّ محايد، وجسم واحد للملكية الأخرى والغياب (لا وسيط وجود ولا حالة)
  wire('analyzeDevice.session.REPORT_NOT_AVAILABLE.not-owners', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_REPORT_NOT_AVAILABLE');
  wire('analyzeDevice.session.REPORT_NOT_AVAILABLE.report-user-absent', 'PERMISSION_DENIED', 403, INVALID, 'SESSION_REPORT_NOT_AVAILABLE');
  wire('analyzeDevice.storedReport.personal.NOT_AVAILABLE.not-owner', 'PERMISSION_DENIED', 403, STORED_REPORT_REFUSAL_TEXT, 'SCAN_REPORT_NOT_AVAILABLE');
  wire('analyzeDevice.storedReport.personal.NOT_AVAILABLE.report-user-absent', 'PERMISSION_DENIED', 403, STORED_REPORT_REFUSAL_TEXT, 'SCAN_REPORT_NOT_AVAILABLE');
  eq(STORED_REPORT_REFUSAL_TEXT, 'تعذّر إتمام الطلب', '[٤] نصّ الرفض الشخصي بنصّه (محايد: لا يذكر تقريراً ولا مالكاً)');
  deq(find('analyzeDevice.session.REPORT_NOT_AVAILABLE.not-owners').body, find('analyzeDevice.session.REPORT_NOT_AVAILABLE.report-user-absent').body, '[٤] «تقرير لغيرك» و«تقرير بلا userId» (جلسة): جسم **واحد** (لا يُكشَف وجود التقرير ولا حاله)');
  deq(find('analyzeDevice.storedReport.personal.NOT_AVAILABLE.not-owner').body, find('analyzeDevice.storedReport.personal.NOT_AVAILABLE.report-user-absent').body, '[٤] «تقرير لغيرك» و«تقرير بلا userId» (شخصي): جسم **واحد**');
  for (const s of refusals) ok(!JSON.stringify(s.body).includes('MUST-NOT-LEAK'), `[٤] ${s.id}: لا شيء من تقرير مخزَّن في الجسم`);
  wire('requestPayment.anonymous', 'UNAUTHENTICATED', 401, 'غير مصادق', null);
  ok(!JSON.stringify(find('analyzeDevice.session.COMPLETED.report-not-owners').body).includes('MUST-NOT-LEAK'), '[٤] جسم رفض «تقرير بملكية غير مالك الجلسة» لا يحمل شيئاً من التقرير المخزَّن');
  eq(Object.keys(find('analyzeDevice.session.COMPLETED.report-not-owners').body).join(','), 'error', '[٤] والجسم مفتاح error وحده');
  for (const id of ['analyzeDevice.session.EXPIRED.by-time', 'analyzeDevice.session.EXPIRED.by-time.stranger']) {
    deq(find(id).transactionWrites, [`scanSessions/${id.endsWith('stranger') ? 'sess-10' : 'sess-8'}`], `[٤] ${id}: كتابة «منتهية» الوحيدة (المعاملة)`);
  }
  for (const s of refusals.filter((x) => !x.id.includes('by-time'))) ok(s.transactionWrites === undefined, `[٤] ${s.id}: لا كتابة (الرفض قبل أيّ تغيير)`);

  // checkSubscription: الحقول القائمة وشكل expiresAt على السلك
  const EXISTING_FIELDS = ['plan', 'scansRemaining', 'scansTotal', 'expiresAt', 'isActive', 'isFreeTrial', 'features', CHECK_SUBSCRIPTION_VERDICT_FIELD];
  for (const s of committedCheck.samples) {
    eq(s.httpStatus, 200, `[٤] checkSubscription.${s.id}: 200`);
    deq(Object.keys(s.body.result), EXISTING_FIELDS, `[٤] checkSubscription.${s.id}: الحقول القائمة بترتيبها والحقل الجديد آخرها`);
  }
  const cs = (id) => committedCheck.samples.find((s) => s.id === id).body.result;
  deq(Object.keys(cs('active').expiresAt).sort(), ['_nanoseconds', '_seconds'], '[٤] expiresAt Timestamp على السلك = {_seconds, _nanoseconds} وحدهما (من فئة Timestamp الحقيقية)');
  eq(typeof cs('expired.iso-string').expiresAt, 'string', '[٤] expiresAt المخزَّن نصّاً يخرج نصّاً كما خُزِّن');
  eq(typeof cs('expired.ms-number').expiresAt, 'number', '[٤] expiresAt المخزَّن رقماً يخرج رقماً كما خُزِّن');
  eq(cs('free.no-expiresAt').expiresAt, null, '[٤] بلا expiresAt ⟵ null (غياب لا انتهاء)');
  deq([cs('no-users-document').plan, cs('no-users-document').scansRemaining, cs('no-users-document').isActive, cs('no-users-document')[CHECK_SUBSCRIPTION_VERDICT_FIELD]], ['free', 0, false, 'NO_CREDIT'], '[٤] مستخدم بلا مستند ⟵ free ورصيد 0 وNO_CREDIT (لا حالة «غير مسجَّل»، القرار ٨ مؤجَّل: العيّنة بالشكل الحالي)');
  deq([cs('active')[CHECK_SUBSCRIPTION_VERDICT_FIELD], cs('expired.timestamp')[CHECK_SUBSCRIPTION_VERDICT_FIELD], cs('no-credit')[CHECK_SUBSCRIPTION_VERDICT_FIELD]], ['ALLOWED', 'SUBSCRIPTION_EXPIRED', 'NO_CREDIT'], '[٤] الأحكام الثلاثة');

  // ═══ ٥ — طفرات القاعدة 39 ═══
  const mutRefusal = (fn) => { const c = JSON.parse(JSON.stringify(committedRefusal)); fn(c); return diff(freshRefusal, c); };
  const mutCheck = (fn) => { const c = JSON.parse(JSON.stringify(committedCheck)); fn(c); return diff(freshCheck, c); };
  ok(mutRefusal((c) => { c.samples[0].body.error.details.reasonCode = 'X'; }).length > 0, '[٥] طفرة: رمز سبب في عيّنة مُلتزَمة يُغيَّر ⟵ المقارنة تكشفه');
  ok(mutRefusal((c) => { c.samples.pop(); }).length > 0, '[٥] طفرة: عيّنة تُحذف ⟵ تُكشَف');
  ok(mutRefusal((c) => { c.samples[2].httpStatus = 500; }).length > 0, '[٥] طفرة: حالة HTTP تُغيَّر ⟵ تُكشَف');
  ok(mutRefusal((c) => { c.samples[2].body.error.message = 'نصّ آخر'; }).length > 0, '[٥] طفرة: النصّ العربي يُغيَّر ⟵ تُكشَف');
  ok(mutCheck((c) => { c.samples[0].body.result.scanVerdict = 'NO_CREDIT'; }).length > 0, '[٥] طفرة: حكم checkSubscription يُغيَّر ⟵ تُكشَف');
  ok(mutCheck((c) => { delete c.samples[0].body.result.features; }).length > 0, '[٥] طفرة: حقل قائم يُحذف من الردّ ⟵ تُكشَف');
  ok(mutCheck((c) => { c.samples[1].body.result.expiresAt = '2025-01-01'; }).length > 0, '[٥] طفرة: شكل expiresAt على السلك يُغيَّر ⟵ تُكشَف');
  ok(mutRefusal((c) => { c._provenance.whatIsStubbed = 'x'; }).length > 0, '[٥] طفرة: بيان ما هو مستبدَل يُغيَّر ⟵ يُكشَف (البيان جزء من العيّنة)');
  ok(docViolations(doc.replace(/SESSION_NOT_STARTED/g, 'SESSION_NOT_BEGUN')).some((x) => x.startsWith('CODE_NOT_IN_DOC:SESSION_NOT_STARTED')), '[٥] طفرة: رمز يُحذف من الوثيقة ⟵ يُكشَف');
  ok(docViolations(doc.replace('### ٦-هـ', '- `SESSION_PHANTOM_CODE`\n\n### ٦-هـ')).includes('DOC_CODE_NOT_IN_MODULE:SESSION_PHANTOM_CODE'), '[٥] طفرة: رمز في الوثيقة لا وجود له في الوحدة ⟵ يُكشَف');
  ok(docViolations(doc.replace('### ٦-د-١', '### ٦-د-٢')).includes('SECTION_MISSING'), '[٥] طفرة: القسم يُعاد تسميته ⟵ يُكشَف (لا فحص فارغ)');
  ok(docViolations(doc.replace(/SCAN_REPORT_NOT_AVAILABLE/g, 'SCAN_REPORT_GONE')).includes('CODE_NOT_IN_DOC:SCAN_REPORT_NOT_AVAILABLE'), '[٥] طفرة: رمز الرفض الشخصي يُحذف من الوثيقة ⟵ يُكشَف');
  ok(docViolations(doc.replace(/SESSION_REPORT_NOT_AVAILABLE/g, 'SESSION_REPORT_GONE')).includes('CODE_NOT_IN_DOC:SESSION_REPORT_NOT_AVAILABLE'), '[٥] طفرة: رمز رفض الجلسة يُحذف من الوثيقة ⟵ يُكشَف');
  ok(mutRefusal((c) => { c.samples.find((s) => s.id.startsWith('analyzeDevice.storedReport.personal.')).body.error.details.reasonCode = 'X'; }).length > 0, '[٥] طفرة: رمز عيّنة التقرير المخزَّن الشخصية يُغيَّر ⟵ تُكشَف');
  ok(docViolations(doc.replace(/SHOP_PLAN_REQUIRED/g, 'SHOP_PLAN_GONE')).includes('CODE_NOT_IN_DOC:SHOP_PLAN_REQUIRED'), '[٥] طفرة: رمز رفض الباقة عند الإنشاء يُحذف من القسم ٦-د-١ ⟵ يُكشَف');
  ok(mutRefusal((c) => { c.samples = c.samples.filter((s) => !s.id.startsWith('createScanSession.SHOP_PLAN_REQUIRED.')); }).length > 0, '[٥] طفرة: عيّنتا رفض الباقة عند الإنشاء تُحذفان ⟵ تُكشَف');
  ok(mutRefusal((c) => { c.samples.find((s) => s.id === 'createScanSession.SHOP_PLAN_REQUIRED.free').body.error.message = 'نصّ آخر'; }).length > 0, '[٥] طفرة: نصّ رفض الباقة يُغيَّر ⟵ يُكشَف');
  ok(mutRefusal((c) => { c.samples = c.samples.filter((s) => !s.id.startsWith('analyzeDevice.session.REPORT_NOT_AVAILABLE.')); }).length > 0, '[٥] طفرة: عيّنتا رفض الجلسة بالتقرير المخزَّن تُحذفان ⟵ تُكشَفان');

  console.log(`refusalWireGoldenGuard.test.js: ${n}/${n} assertions passed (${committedRefusal.samples.length} refusal samples, ${committedCheck.samples.length} checkSubscription samples)`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});

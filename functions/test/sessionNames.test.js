'use strict';

// sessionNames.test.js — مفردات جلسة الفحص من مصدر واحد (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03). وحدة بلا شبكة ولا محاكٍ.
//
// القاعدة 24 (بنصّها): «القيمة الحرفية التي يقوم عليها تمييز — وسم، مفتاح، اسم حقل — لها حكم رقم القياس: مصدر واحد مُصدَّر، لا نسخة في كل ملفّ.»
// قرار المستخدم (2026-10-10، بنصّه): «الإلغاء: … الحالة «ملغاة» مع سبب مسمّى…» — ومفردات السبب الثلاث من أمر المنسّق: consent_declined · left_by_customer ·
// cancelled_by_owner.
//   ١ — الحالات: القيم الخمس بنصّها الحرفي المكتوب في Firestore (فخّ: انجراف قيمة يُفشل هنا قبل أن يُسقط قارئاً).
//   ٢ — أسباب الإلغاء والأدوار: كل سبب لدور واحد بالضبط، ولا سبب بلا دور.
//   ٣ — رموز الرفض: مجمَّدة، قيمتها اسمها (إلا ما يأتي من sessionTimeout.js فمصدره هناك)، فريدة داخل كل مجموعة.
//   ٤ — حارس بنيوي: لا نصّ حرفي لحالة جلسة ولا لسبب إلغاء في الملفّات التي هُجِّرت إلى المصدر الواحد (والاستثناء المعروف الوحيد مسمّى بعدده).
//
// Run: node functions/test/sessionNames.test.js

const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const N = require('../src/sessions/sessionNames');
const {SESSION_EXPIRY_REASON} = require('../src/sessions/sessionTimeout');
const {PURPOSE_REFUSAL} = require('../src/protocol/protocolVocabulary');

// ═══ ١ — الحالات ═══
ok(Object.isFrozen(N.SESSION_STATUS), '[١] SESSION_STATUS مجمَّد');
deq({...N.SESSION_STATUS}, {PENDING: 'pending', SCANNING: 'scanning', COMPLETED: 'completed', EXPIRED: 'expired', CANCELLED: 'cancelled'}, '[١] القيم الخمس بنصّها الحرفي في Firestore');
eq(new Set(Object.values(N.SESSION_STATUS)).size, 5, '[١] لا قيمتان متطابقتان');
ok(Object.isFrozen(N.ACTIVE_SESSION_STATUSES) && Object.isFrozen(N.TERMINAL_SESSION_STATUSES) && Object.isFrozen(N.KNOWN_SESSION_STATUSES), '[١] القوائم الثلاث مجمَّدة');
deq([...N.ACTIVE_SESSION_STATUSES], ['pending', 'scanning'], '[١] الجاريتان: pending وscanning');
deq([...N.TERMINAL_SESSION_STATUSES], ['completed', 'expired', 'cancelled'], '[١] النهائية: completed وexpired وcancelled');
deq([...N.KNOWN_SESSION_STATUSES].sort(), Object.values(N.SESSION_STATUS).sort(), '[١] المعروفة = كل قيم SESSION_STATUS');
const union = new Set([...N.ACTIVE_SESSION_STATUSES, ...N.TERMINAL_SESSION_STATUSES]);
eq(union.size, N.KNOWN_SESSION_STATUSES.length, '[١] الجارية والنهائية تغطّيان كل الحالات المعروفة بلا تداخل');
ok(N.ACTIVE_SESSION_STATUSES.every((s) => !N.TERMINAL_SESSION_STATUSES.includes(s)), '[١] ولا حالة في القائمتين معاً');

// ═══ ٢ — أسباب الإلغاء والأدوار ═══
ok(Object.isFrozen(N.CANCEL_REASON) && Object.isFrozen(N.SESSION_ROLE) && Object.isFrozen(N.CANCEL_REASONS_BY_ROLE), '[٢] الأسباب والأدوار وجدولها مجمَّدة');
deq({...N.CANCEL_REASON}, {CONSENT_DECLINED: 'consent_declined', LEFT_BY_CUSTOMER: 'left_by_customer', CANCELLED_BY_OWNER: 'cancelled_by_owner'}, '[٢] الأسباب الثلاثة بنصّ أمر المنسّق');
deq({...N.SESSION_ROLE}, {OWNER: 'owner', JOINER: 'joiner'}, '[٢] الدوران');
deq(Object.keys(N.CANCEL_REASONS_BY_ROLE).sort(), ['joiner', 'owner'], '[٢] جدول الأسباب لكل دور، لا دور غيرهما');
ok(Object.values(N.CANCEL_REASONS_BY_ROLE).every((l) => Object.isFrozen(l)), '[٢] وقوائمه مجمَّدة');
deq([...N.CANCEL_REASONS_BY_ROLE.owner], ['cancelled_by_owner'], '[٢] المالك: cancelled_by_owner وحده');
deq([...N.CANCEL_REASONS_BY_ROLE.joiner].sort(), ['consent_declined', 'left_by_customer'], '[٢] المنضمّ: consent_declined وleft_by_customer');
for (const reason of Object.values(N.CANCEL_REASON)) {
  const roles = Object.keys(N.CANCEL_REASONS_BY_ROLE).filter((r) => N.CANCEL_REASONS_BY_ROLE[r].includes(reason));
  eq(roles.length, 1, `[٢] السبب ${reason} لدور واحد بالضبط (لا سبب بلا دور ولا لدورين)`);
}
for (const [role, list] of Object.entries(N.CANCEL_REASONS_BY_ROLE)) {
  ok(list.every((r) => Object.values(N.CANCEL_REASON).includes(r)), `[٢] كل سبب لدور ${role} من المفردات الثلاث`);
}

// ═══ ٣ — رموز الرفض ═══
ok(Object.isFrozen(N.JOIN_REFUSAL) && Object.isFrozen(N.CANCEL_REFUSAL), '[٣] رموز الرفض مجمَّدة');
const fromTimeout = new Set([SESSION_EXPIRY_REASON.EXPIRED, SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID]);
for (const [group, table] of [['JOIN_REFUSAL', N.JOIN_REFUSAL], ['CANCEL_REFUSAL', N.CANCEL_REFUSAL]]) {
  eq(new Set(Object.values(table)).size, Object.keys(table).length, `[٣] ${group}: لا قيمتان متطابقتان`);
  for (const [k, v] of Object.entries(table)) {
    ok(typeof v === 'string' && v.length > 0 && v === v.toUpperCase() && /^[A-Z_]+$/.test(v), `[٣] ${group}.${k} رمز بحروف كبيرة وشرطة سفلية`);
  }
}
eq(N.JOIN_REFUSAL.EXPIRED, SESSION_EXPIRY_REASON.EXPIRED, '[٣] انتهاء الصلاحية في join من sessionTimeout.js (مصدره هناك) لا نسخة');
eq(N.JOIN_REFUSAL.EXPIRES_AT_INVALID, SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID, '[٣] وغياب expiresAt كذلك');
eq(N.CANCEL_REFUSAL.EXPIRED, SESSION_EXPIRY_REASON.EXPIRED, '[٣] وفي cancel');
eq(N.CANCEL_REFUSAL.EXPIRES_AT_INVALID, SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID, '[٣] وفي cancel الغياب');
eq(N.CANCEL_REFUSAL.STATUS_UNKNOWN, N.JOIN_REFUSAL.STATUS_UNKNOWN, '[٣] والحالة غير المعروفة رمز واحد في الدالّتين');
// القاعدة 23: استبدال لا إضافة — كان هنا الجدول بستّة مفاتيح؛ صار بسبعة بإضافة COMPLETED (2026-10-10: الجهاز نفسه يعيد الانضمام بعد اكتمال الفحص، قرار المستخدم بنصّه في joinScanSession.js).
deq(Object.keys(N.JOIN_REFUSAL).sort(), ['ALREADY_JOINED', 'CANCELLED', 'CODE_INVALID', 'COMPLETED', 'EXPIRED', 'EXPIRES_AT_INVALID', 'STATUS_UNKNOWN'], '[٣] join: الحالات الأربع في أمر المنسّق + حالتا الغياب (القاعدة 22) + COMPLETED (الجهاز نفسه بعد الاكتمال)');
eq(N.JOIN_REFUSAL.CODE_INVALID, 'SESSION_CODE_INVALID', '[٣] رمز «رمز غير صالح»');
eq(N.JOIN_REFUSAL.ALREADY_JOINED, 'SESSION_ALREADY_JOINED', '[٣] رمز «انضُمّ إليها»');
eq(N.JOIN_REFUSAL.CANCELLED, 'SESSION_CANCELLED', '[٣] رمز «ملغاة»');
eq(N.JOIN_REFUSAL.EXPIRED, 'SESSION_EXPIRED', '[٣] رمز «منتهية»');
eq(N.JOIN_REFUSAL.COMPLETED, 'SESSION_COMPLETED', '[٣] رمز «الجهاز نفسه بعد اكتمال الفحص»');
eq(N.CANCEL_REFUSAL.COMPLETED, N.JOIN_REFUSAL.COMPLETED, '[٣] ورمز الإلغاء بعد الاكتمال هو القيمة نفسها (مصدر واحد: CANCEL_REFUSAL.COMPLETED يشير إلى JOIN_REFUSAL.COMPLETED لا نسخة)');
// A-SUB البند ١ (2026-10-17): رمز رفض createScanSession لباقة لا تسمح — مصدره هنا (لا من SCAN_REFUSAL)، وقيمته الحرفية مثبَّتة (يقرؤها التطبيق وحارس العيّنات الذهبية)
deq({...N.CREATE_SESSION_REFUSAL}, {SHOP_PLAN_REQUIRED: 'SHOP_PLAN_REQUIRED'}, '[٣] رموز رفض الإنشاء الخاصة بهذا المصدر: SHOP_PLAN_REQUIRED وحده');
ok(Object.isFrozen(N.CREATE_SESSION_REFUSAL), '[٣] CREATE_SESSION_REFUSAL مجمَّدة');
ok(fromTimeout.size === 2, '[٣] قيمتا sessionTimeout.js متمايزتان');
// S-P6-03 (2026-10-18 +03): رموز رفض setSessionPurpose. المعتمَد منها واحد (PURPOSE_SESSION_NOT_PENDING، E5 2026-10-15) ومصدره protocolVocabulary؛ والباقي أسماء مقترحة بنسق CANCEL_REFUSAL (تُراجَع مع عقد التطبيق).
{
  const S = N.SET_PURPOSE_REFUSAL;
  ok(Object.isFrozen(S), '[٣] SET_PURPOSE_REFUSAL مجمَّدة');
  eq(new Set(Object.values(S)).size, Object.keys(S).length, '[٣] SET_PURPOSE_REFUSAL: لا قيمتان متطابقتان (NOT_OWNER للسجلّ مغاير لـNOT_PARTICIPANT الذي يراه العميل)');
  for (const [k, v] of Object.entries(S)) ok(typeof v === 'string' && /^[A-Z_]+$/.test(v), `[٣] SET_PURPOSE_REFUSAL.${k} رمز بحروف كبيرة وشرطة سفلية`);
  // (2026-10-22، القاعدة 23: كان «أحد عشر» يثبّت الرموز قبل أمر ربط «قبل/بعد صيانة»؛ استُبدل بأربعة عشر: أُضيفت DEFECT_TYPE_REQUIRED وDEFECT_TYPE_INVALID وDEFECT_TYPE_NOT_APPLICABLE، ومصدر قيمها protocolVocabulary.PURPOSE_REFUSAL)
deq(Object.keys(S).sort(), ['DEFECT_TYPE_INVALID', 'DEFECT_TYPE_NOT_APPLICABLE', 'DEFECT_TYPE_REQUIRED', 'EXPIRED', 'EXPIRES_AT_INVALID', 'NOT_AUTHENTICATED', 'NOT_OWNER', 'NOT_PARTICIPANT', 'NOT_PENDING', 'PART_NOT_ENABLED', 'PURPOSE_INVALID', 'PURPOSE_REQUIRED', 'SESSION_ID_REQUIRED', 'SESSION_NOT_FOUND', 'STATUS_UNKNOWN'], '[٣] خمسة عشر رمزاً بأسمائها (ق31، 2026-10-22: +PART_NOT_ENABLED؛ القاعدة 23: كانت أربعة عشر)');
for (const k of ['DEFECT_TYPE_REQUIRED', 'DEFECT_TYPE_INVALID', 'DEFECT_TYPE_NOT_APPLICABLE', 'PART_NOT_ENABLED']) eq(S[k], PURPOSE_REFUSAL[k], `[٣] ${k} مصدره protocolVocabulary.PURPOSE_REFUSAL (لا نسخة حرفية)`);
eq(S.PART_NOT_ENABLED, 'PURPOSE_PART_NOT_ENABLED', '[٣] (ق31) رمز رفض جزء المحلّ بنصّه الحرفي');
  eq(S.NOT_PENDING, 'PURPOSE_SESSION_NOT_PENDING', '[٣] الرمز المعتمَد (E5) بنصّه الحرفي');
  eq(S.NOT_PENDING, PURPOSE_REFUSAL.SESSION_NOT_PENDING, '[٣] ومصدره protocolVocabulary.PURPOSE_REFUSAL (لا نسخة حرفية)');
  eq(S.SESSION_NOT_FOUND, N.CANCEL_REFUSAL.SESSION_NOT_FOUND, '[٣] SESSION_NOT_FOUND هو قيمة الإلغاء نفسها (مصدر واحد)');
  eq(S.NOT_PARTICIPANT, N.CANCEL_REFUSAL.NOT_PARTICIPANT, '[٣] NOT_PARTICIPANT هو قيمة الإلغاء نفسها');
  eq(S.EXPIRED, SESSION_EXPIRY_REASON.EXPIRED, '[٣] EXPIRED من sessionTimeout.js');
  eq(S.EXPIRES_AT_INVALID, SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID, '[٣] EXPIRES_AT_INVALID من sessionTimeout.js');
  eq(S.STATUS_UNKNOWN, N.JOIN_REFUSAL.STATUS_UNKNOWN, '[٣] STATUS_UNKNOWN رمز واحد في الدوالّ كلّها');
  eq(S.NOT_OWNER, 'SESSION_NOT_OWNER', '[٣] NOT_OWNER للسجلّ وحده: SESSION_NOT_OWNER (لا يصل العميل: ردّه NOT_PARTICIPANT)');
}

// S-P6-12 (2026-10-21 +03): رموز رفض recordScanConsent — كلّها أسماء مقترحة بنسق CANCEL_REFUSAL وSET_PURPOSE_REFUSAL (A8)، وما له قيمة قائمة يأخذها منها (مصدر واحد).
{
  const C = N.RECORD_CONSENT_REFUSAL;
  ok(Object.isFrozen(C), '[٣] RECORD_CONSENT_REFUSAL مجمَّدة');
  eq(new Set(Object.values(C)).size, Object.keys(C).length, '[٣] RECORD_CONSENT_REFUSAL: لا قيمتان متطابقتان (NOT_JOINER للسجلّ مغاير لـNOT_PARTICIPANT الذي يراه العميل)');
  for (const [k, v] of Object.entries(C)) ok(typeof v === 'string' && /^[A-Z_]+$/.test(v), `[٣] RECORD_CONSENT_REFUSAL.${k} رمز بحروف كبيرة وشرطة سفلية`);
  // (ق40، 2026-10-23، القاعدة 23: كانت أربعة عشر؛ استُبدلت بخمسة عشر: أُضيف PART_NOT_ENABLED)
  deq(Object.keys(C).sort(), ['EXPIRED', 'EXPIRES_AT_INVALID', 'LOCALE_INVALID', 'LOCALE_REQUIRED', 'NOT_AUTHENTICATED', 'NOT_JOINER', 'NOT_PARTICIPANT', 'NOT_SCANNING', 'PART_NOT_ENABLED', 'SESSION_ID_REQUIRED', 'SESSION_NOT_FOUND', 'STATUS_UNKNOWN', 'STORED_UNREADABLE', 'TEXT_VERSION_INVALID', 'TEXT_VERSION_REQUIRED'], '[٣] خمسة عشر رمزاً بأسمائها');
  eq(C.PART_NOT_ENABLED, 'CONSENT_PART_NOT_ENABLED', '[٣] (ق40) رمز رفض جزء الموافقة للمحلّ بنصّه الحرفي (يقرؤه التطبيق بـdetails.reasonCode)');
  deq([C.NOT_AUTHENTICATED, C.SESSION_ID_REQUIRED, C.TEXT_VERSION_REQUIRED, C.TEXT_VERSION_INVALID, C.LOCALE_REQUIRED, C.LOCALE_INVALID, C.NOT_JOINER, C.NOT_SCANNING, C.STORED_UNREADABLE],
    ['CONSENT_NOT_AUTHENTICATED', 'CONSENT_SESSION_ID_REQUIRED', 'CONSENT_TEXT_VERSION_REQUIRED', 'CONSENT_TEXT_VERSION_INVALID', 'CONSENT_LOCALE_REQUIRED', 'CONSENT_LOCALE_INVALID', 'SESSION_NOT_JOINER', 'CONSENT_SESSION_NOT_SCANNING', 'CONSENT_STORED_UNREADABLE'],
    '[٣] القيم الحرفية التسع الجديدة (يقرؤها التطبيق بـdetails.reasonCode)');
  eq(C.SESSION_NOT_FOUND, N.CANCEL_REFUSAL.SESSION_NOT_FOUND, '[٣] SESSION_NOT_FOUND هو قيمة الإلغاء نفسها (مصدر واحد)');
  eq(C.NOT_PARTICIPANT, N.CANCEL_REFUSAL.NOT_PARTICIPANT, '[٣] NOT_PARTICIPANT هو قيمة الإلغاء نفسها');
  eq(C.EXPIRED, SESSION_EXPIRY_REASON.EXPIRED, '[٣] EXPIRED من sessionTimeout.js');
  eq(C.EXPIRES_AT_INVALID, SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID, '[٣] EXPIRES_AT_INVALID من sessionTimeout.js');
  eq(C.STATUS_UNKNOWN, N.JOIN_REFUSAL.STATUS_UNKNOWN, '[٣] STATUS_UNKNOWN رمز واحد في الدوالّ كلّها');
}

// ═══ ٤ — حارس بنيوي (القاعدة 24): لا نسخة حرفية في الملفّات المهجَّرة ═══
const fs = require('fs');
const path = require('path');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const SRC = path.join(__dirname, '..', 'src');
const read = (rel) => strip(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n'));
const LITERAL = /["'`](pending|scanning|completed|expired|cancelled|consent_declined|left_by_customer|cancelled_by_owner)["'`]/g;
const migrated = fs.readdirSync(path.join(SRC, 'sessions')).filter((f) => f.endsWith('.js') && f !== 'sessionNames.js').map((f) => `sessions/${f}`)
    .concat(['analysis/analyzeDevice.js', 'analysis/scanReservation.js', 'evaluations/submitEvaluation.js']);
ok(migrated.length >= 9, `[٤] الفحص ليس فارغاً: ${migrated.length} ملفّاً (≥9: ما في src/sessions عدا sessionNames.js + analyzeDevice وscanReservation وsubmitEvaluation)`);
for (const rel of migrated) {
  const found = [...read(rel).matchAll(LITERAL)].map((m) => m[1]);
  deq(found, [], `[٤] ${rel}: لا نصّ حرفي لحالة جلسة ولا لسبب إلغاء (المفردات من sessionNames.js)`);
}
// الاستثناء المعروف الوحيد كان: منظّف الجلسات المنتهية في checkExpiringSubscriptions.js (حرفان: "pending" في الاستعلام و"expired" في الكتابة). A-SUB البند ٤-أ (2026-10-17، القاعدة 23 — استبدال):
// القسم (د) حُذف كلّه (قرار 2026-10-10: لا منظّف مجدوَل)، فلا استثناء بعد الآن — الملفّ بلا نصّ حرفي لحالة جلسة (والاختبار يفشل إن عاد منظّف).
deq([...read('notifications/checkExpiringSubscriptions.js').matchAll(LITERAL)].map((m) => m[1]).sort(), [], '[٤] checkExpiringSubscriptions.js بلا نصّ حرفي لحالة جلسة (الاستثناء المعروف زال بحذف القسم د)');
// SESSION_COMPLETED رمز واحد في الدالّتين (الانضمام والإلغاء، 2026-10-10): الحرف يُكتب مرّة واحدة في sessionNames.js، ولا يظهر حرفياً في أيّ ملفّ آخر من src (القاعدة 24)
{
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const q = path.join(dir, e.name);
      if (e.isDirectory()) walk(q, out);
      else if (e.name.endsWith('.js')) out.push(q);
    }
    return out;
  };
  const holders = walk(SRC).filter((f) => /SESSION_COMPLETED/.test(strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')))).map((f) => path.relative(SRC, f).split(path.sep).join('/'));
  deq(holders, ['sessions/sessionNames.js'], '[٤] الحرف SESSION_COMPLETED في شيفرة src (بلا تعليقات) في sessionNames.js وحده — الإلغاء والانضمام يستوردانه');
}
// وكل مستهلك لمفردات الجلسة يستوردها من الملفّ نفسه
for (const rel of ['sessions/cancelScanSession.js', 'sessions/joinScanSession.js', 'sessions/sessionLifecycle.js', 'analysis/analyzeDevice.js', 'evaluations/submitEvaluation.js', 'sessions/createScanSession.js']) {
  ok(/require\(["']\.{1,2}\/(?:sessions\/)?sessionNames["']\)/.test(read(rel)), `[٤] ${rel} يستورد sessionNames.js`);
}


// ═══ ٥ — مفردات الكنس الآمن (S-SWEEP، 2026-10-15 +03؛ docs/PROTOCOL_CONTRACT.md §٦-ج) ═══
// القاعدة 24: كل قيمة حرفية يقوم عليها تمييز في سطور السجلّ المسمّاة مصدرها هنا وحده. القوائم مغلقة: إضافة قيمة تُفشل هذا القسم فيُحدَّث العقد معها.
for (const name of ['SWEEP_STATE', 'SWEEP_CALLER', 'SWEEP_KEY_FIELD', 'SWEEP_SKIP_REASON']) {
  ok(Object.isFrozen(N[name]), `[٥] ${name} مجمَّد`);
  eq(new Set(Object.values(N[name])).size, Object.keys(N[name]).length, `[٥] ${name}: لا قيمتان متطابقتان`);
}
deq({...N.SWEEP_STATE}, {COMPLETED: 'COMPLETED', CAPPED: 'CAPPED', BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED', READ_FAILED: 'READ_FAILED', NOT_RUN_NO_KEY: 'NOT_RUN_NO_KEY'}, '[٥] حالات سطر E34 الخمس بنصّها (قائمة مغلقة، حسم المنسّق 2026-10-15)');
deq({...N.SWEEP_CALLER}, {CREATE_SCAN_SESSION: 'createScanSession', JOIN_SCAN_SESSION: 'joinScanSession'}, '[٥] النداءان اللذان يكنسان (الإلغاء لا يكنس: E25)');
deq({...N.SWEEP_KEY_FIELD}, {OWNER_ID: 'ownerId', JOINED_BY: 'joinedBy'}, '[٥] مفتاحا الكنس (E24)');
eq(N.SWEEP_NOT_RUN, 'NOT_RUN', '[٥] كلمة NOT_RUN (لا تُستبدل صفراً: القاعدة 22)');
deq({...N.SWEEP_SKIP_REASON}, {CLAIM_IN_FLIGHT: 'claim_in_flight', CLAIM_AGE_UNKNOWN: 'claim_age_unknown', NO_LONGER_DUE: 'no_longer_due'}, '[٥] أسباب تخطّي المرشَّحة الثلاثة (E32)');
// القيمة الحرفية الفريدة تُكتب في sessionNames.js وحده من شيفرة src (القاعدة 24: لا نسخة في كل ملفّ). (مفردات الاكتمال: sessionCompletion.test.js §١.)
{
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const q = path.join(dir, e.name);
      if (e.isDirectory()) walk(q, out);
      else if (e.name.endsWith('.js')) out.push(q);
    }
    return out;
  };
  const files = walk(SRC).map((f) => [path.relative(SRC, f).split(path.sep).join('/'), strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))]);
  for (const v of ['claim_in_flight', 'claim_age_unknown', 'no_longer_due', 'NOT_RUN_NO_KEY', 'BUDGET_EXHAUSTED', 'READ_FAILED', 'CAPPED', 'NOT_RUN']) {
    const re = new RegExp(`["'\`]${v}["'\`]`);
    deq(files.filter(([, text]) => re.test(text)).map(([rel]) => rel), ['sessions/sessionNames.js'], `[٥] «${v}» حرفية في sessionNames.js وحده`);
  }
  // والمستهلك الجديد يستوردها من الملفّ نفسه
  for (const rel of ['sessions/sweepExpiredSessions.js']) {
    const text = files.find(([r]) => r === rel)[1];
    ok(/require\(["']\.\/sessionNames["']\)/.test(text), `[٥] ${rel} يستورد sessionNames.js`);
    deq([...text.matchAll(LITERAL)].map((m) => m[1]), [], `[٥] ${rel}: لا نصّ حرفي لحالة جلسة (المفردات من sessionNames.js)`);
  }
}

console.log(`\nsessionNames.test.js: ${n}/${n} assertions passed`);

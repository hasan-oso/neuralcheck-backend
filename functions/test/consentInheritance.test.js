'use strict';

// consentInheritance.test.js — ق14 (قرار حسن 2026-10-22، أمر المستخدم 2026-10-23: «الجلسة الابنة للتكرار ترث موافقة أمّها: إن كانت موافقة الأمّ المسجَّلة مقبولة يُكتب للابنة حالة وراثة مسمّاة صريحة (لا not_collected)؛
// وإن غابت أو لم تكن مقبولة تبقى الابنة كما هي (غياب صريح)»). اليوم (قبل التغيير): الجلسة الابنة بلا شاشة موافقة (الهاتف نفسه وافق عند الأمّ) فيُكتب لها not_collected/NOT_RECORDED.
//
// ما يُختبَر (القاعدتان 30 و37؛ والمسار الكامل على المحاكي في repeatScan.e2e.test.js المشهد ٤-ز):
//   ١ المفردة: CONSENT_STATE.INHERITED = "inherited" وCONSENT_BASIS.INHERITED = "INHERITED" (مصدر واحد، القاعدة 24).
//   ٢ consentForScanProtocol: الابن + موافقة أمّ مقبولة + لا سجلّ ذاتي ⟵ inherited (المفاتيح الأربعة: نسخة النصّ واللغة ووقت القبول من الأمّ)؛ وكل ما سواه كما كان:
//      سجلّ ذاتي مقروء يفوز (RECORDED)، ومخزَّن ذاتي غير مقروء لا يُغطّى بالوراثة (UNREADABLE)، وأمّ غائبة أو بلا موافقة أو not_collected أو غير مقروءة أو inherited ⟵ not_collected/NOT_RECORDED، وغير الابن لا يرث،
//      وفحص بلا جلسة NO_SESSION.
//   ٣ buildScanProtocolDocument: الشكل الكامل للابن (المستند والملاحظات وauthority الأساس) وparentProtocolData صريحاً للابن (غيابه خطأ لا افتراض).
//
// **يُكتب قبل العلاج ويفشل عليه** (أمر المستخدم): كل تأكيد يُسجَّل فشله بنصّه ولا يوقف التشغيل، وينتهي بتقرير كامل (الخروج 1 إن فشل أي منها).
//
// Run: node functions/test/consentInheritance.test.js

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const failures = [];
const rec = (c, m) => { n++; if (!c) failures.push(m); };
const ok = (c, m) => rec(!!c, m);
const eq = (a, b, m) => rec(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const deq = (a, b, m) => {
  let same = true;
  try { assert.deepStrictEqual(a, b); } catch (e) { same = false; }
  rec(same, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const V = require('../src/protocol/protocolVocabulary');
const C = require('../src/protocol/consent');
const doc = require('../src/protocol/scanProtocolDocument');
const {computeCreditStub} = {};
void computeCreditStub;

const T0 = {toMillis: () => 1760000000000};
const T1 = {toMillis: () => 1760000999000};
const ACCEPTED = (over = {}) => ({state: 'accepted', textVersion: 1, locale: 'ar', acceptedAt: T0, ...over});
const NC = {state: 'not_collected', textVersion: null, locale: null, acceptedAt: null};
const PARENT = (consent) => ({repeat: {state: 'STARTED'}, consent});

(async () => {
  // ═══ ١ — المفردة ═══
  eq(V.CONSENT_STATE.INHERITED, 'inherited', '[١] CONSENT_STATE.INHERITED = "inherited"');
  eq(C.CONSENT_BASIS.INHERITED, 'INHERITED', '[١] CONSENT_BASIS.INHERITED = "INHERITED"');
  deq(Object.values(C.CONSENT_BASIS).sort(), ['INHERITED', 'NOT_RECORDED', 'NO_SESSION', 'RECORDED', 'UNREADABLE'], '[١] أسس الكتابة الخمسة قائمة مغلقة');
  deq(Object.values(V.CONSENT_STATE).sort(), ['accepted', 'declined', 'inherited', 'not_collected'], '[١] حالات الموافقة الأربع');

  // ═══ ٢-أ — buildInheritedRecord مباشرةً (القيم تُنسخ من سجلّ الأمّ لا من ثوابت) ═══
  {
    ok(typeof C.buildInheritedRecord === 'function', '[٢-أ] buildInheritedRecord مُصدَّرة');
    if (typeof C.buildInheritedRecord === 'function') {
      const src = {textVersion: 7, locale: 'tr', acceptedAt: T1};
      deq(C.buildInheritedRecord(src), {state: 'inherited', textVersion: 7, locale: 'tr', acceptedAt: T1}, '[٢-أ] نسخة النصّ ولغتها ووقتها كلّها من سجلّ الأمّ (لا ثابت: ولو ارتفعت CONSENT_TEXT_VERSION)');
      ok(C.buildInheritedRecord(src) !== src, '[٢-أ] كائن جديد');
      deq(Object.keys(C.buildInheritedRecord(src)), ['state', 'textVersion', 'locale', 'acceptedAt'], '[٢-أ] المفاتيح الأربعة بالترتيب نفسه');
    }
  }

  // ═══ ٢ — consentForScanProtocol ═══
  const inherit = (pendingData, parentProtocolData, isSessionScan = true) => C.consentForScanProtocol({isSessionScan, pendingData, inheritFrom: {parentProtocolData}});
  {
    const r = inherit({purposeSource: 'repeat_flow'}, PARENT(ACCEPTED({locale: 'tr', acceptedAt: T1})));
    deq([r.basis, r.record], ['INHERITED', {state: 'inherited', textVersion: 1, locale: 'tr', acceptedAt: T1}], '[٢] ابن بلا سجلّ ذاتي + أمّ بموافقة مقبولة ⟵ inherited بنسخة النصّ ولغته ووقت قبول الأمّ');
    deq(Object.keys(r.record), ['state', 'textVersion', 'locale', 'acceptedAt'], '[٢] المفاتيح الأربعة بالترتيب نفسه (قارئ واحد)');
    ok(r.record.acceptedAt === T1, '[٢] الوقت هو وقت قبول الأمّ نفسه (لا وقت التحليل)');
  }
  // (2026-10-23) الأمّ بنسخة من 1 إلى الحالية تُورَّث بنسختها (السجلّ القديم بنسخة 1 مقبول بعد رفع الحالية)
  for (const v of [1, 2]) { // 1 القديمة و2 الجديدة
    const r = inherit({purposeSource: 'repeat_flow'}, PARENT(ACCEPTED({textVersion: v})));
    deq([r.basis, r.record.textVersion], ['INHERITED', v], `[٢] أمّ بنسخة ${v} (من 1 إلى الحالية) ⟵ تُورَّث بنسختها`);
  }
  {
    const parent = PARENT(ACCEPTED());
    const before = JSON.stringify(parent);
    const r = inherit(null, parent);
    eq(r.basis, 'INHERITED', '[٢] ابن بلا مستند protocolPending أصلاً ⟵ يرث');
    eq(JSON.stringify(parent), before, '[٢] مستند الأمّ لا يُحوَّر');
    ok(r.record !== parent.consent, '[٢] السجلّ الموروث كائن جديد (لا مشاركة مرجع مع مستند الأمّ)');
  }
  {
    // السجلّ الذاتي المقروء يفوز: الموافقة المسجَّلة على جهاز الابن أقوى من الموروثة
    const own = ACCEPTED({locale: 'tr', acceptedAt: T1});
    const r = inherit({consent: own}, PARENT(ACCEPTED()));
    deq([r.basis, r.record], ['RECORDED', own], '[٢] سجلّ ذاتي مقروء ⟵ RECORDED ولا وراثة');
  }
  {
    // مخزَّن ذاتي غير مقروء: يبقى غير مقروء (لا تُغطّيه الوراثة)
    const r = inherit({consent: ACCEPTED({state: 'declined'})}, PARENT(ACCEPTED()));
    deq([r.basis, r.record], ['UNREADABLE', NC], '[٢] مخزَّن ذاتي غير مقروء ⟵ not_collected/UNREADABLE (لا تغطّيه الوراثة)');
  }
  // الأمّ غير مقبولة ⟵ الابن كما هو (غياب صريح)
  for (const [label, parent] of [
    ['مستند الأمّ غائب (null)', null],
    ['مستند الأمّ undefined', undefined],
    ['مستند الأمّ ليس كائناً', 'x'],
    ['الأمّ بلا مفتاح consent', {repeat: {state: 'STARTED'}}],
    ['الأمّ not_collected', PARENT(NC)],
    ['الأمّ declined', PARENT(ACCEPTED({state: 'declined'}))],
    ['الأمّ inherited (لا سلسلة وراثة)', PARENT({state: 'inherited', textVersion: 1, locale: 'ar', acceptedAt: T0})],
    ['الأمّ نسخة لا يعرفها الخادم (الحالية + 1)', PARENT(ACCEPTED({textVersion: V.CONSENT_TEXT_VERSION + 1}))],
    ['الأمّ نسخة صفر', PARENT(ACCEPTED({textVersion: 0}))],
    ['الأمّ لغة مجهولة', PARENT(ACCEPTED({locale: 'en'}))],
    ['الأمّ وقت غائب', PARENT(ACCEPTED({acceptedAt: undefined}))],
    ['الأمّ وقت نصّ', PARENT(ACCEPTED({acceptedAt: '2026-10-21'}))],
    ['الأمّ consent null', PARENT(null)],
    ['الأمّ consent نصّ', PARENT('accepted')],
    ['الأمّ consent مصفوفة', PARENT([ACCEPTED()])],
  ]) {
    const r = inherit({purposeSource: 'repeat_flow'}, parent);
    deq([r.basis, r.record], ['NOT_RECORDED', NC], `[٢] ${label} ⟵ الابن not_collected/NOT_RECORDED كما كان (لا وراثة من غير مقبول)`);
  }
  // غير الابن لا يرث، وفحص بلا جلسة
  {
    const r = C.consentForScanProtocol({isSessionScan: true, pendingData: {purposeSource: 'default'}, inheritFrom: null});
    deq([r.basis, r.record], ['NOT_RECORDED', NC], '[٢] غير الابن (inheritFrom=null) بلا سجلّ ⟵ NOT_RECORDED كما كان');
    const r2 = C.consentForScanProtocol({isSessionScan: true, pendingData: {purposeSource: 'default'}});
    deq([r2.basis, r2.record], ['NOT_RECORDED', NC], '[٢] ولا inheritFrom أصلاً (النداء القديم) ⟵ كما كان');
    const r3 = inherit(null, PARENT(ACCEPTED()), false);
    deq([r3.basis, r3.record], ['NO_SESSION', NC], '[٢] فحص بلا جلسة لا يرث ولو مُرِّر له أمّ (NO_SESSION)');
  }

  // ═══ ٣ — buildScanProtocolDocument ═══
  {
    const NOT_CHILD = {isChild: false, parentSessionId: null, parentScanId: null, reference: {state: 'ABSENT', valueC: null}, startedBeforeCooling: null};
    const CHILD = {isChild: true, parentSessionId: 'P-S', parentScanId: 'P-C', reference: {state: 'PRESENT', valueC: 30}, startedBeforeCooling: false};
    const ABSENT_SETTINGS = {state: 'ABSENT', version: null, data: null};
    const base = {
      isSessionScan: true, sessionData: {}, pendingData: {purposeSource: 'repeat_flow'}, createdAt: 'TS',
      settings: ABSENT_SETTINGS, parts: {purposes: false, batteryBeforeAfter: false, coldRepeat: false, returns: false, doubleEval: false, consent: false},
      random: () => 0.5, startTemp: {state: 'PRESENT', valueC: 30.2}, creditExemption: null,
    };
    const build = (extra) => doc.buildScanProtocolDocument({...base, ...extra});
    const r = build({childContext: CHILD, parentProtocolData: PARENT(ACCEPTED({locale: 'tr'}))});
    deq(r.document.consent, {state: 'inherited', textVersion: 1, locale: 'tr', acceptedAt: T0}, '[٣] الابن + أمّ مقبولة ⟵ document.consent موروثة بالمفاتيح الأربعة');
    deq(r.consent, {state: 'inherited', basis: 'INHERITED'}, '[٣] وملخّص الحالة وأساسه للسجلّ');
    deq(r.notes, [], '[٣] بلا ملاحظات');
    const r2 = build({childContext: CHILD, parentProtocolData: null});
    deq([r2.document.consent, r2.consent], [NC, {state: 'not_collected', basis: 'NOT_RECORDED'}], '[٣] الابن + مستند أمّ غائب (null صريح) ⟵ not_collected كما كان');
    const r3 = build({childContext: NOT_CHILD, pendingData: {purposeSource: 'default'}});
    deq([r3.document.consent, r3.consent.basis], [NC, 'NOT_RECORDED'], '[٣] غير الابن بلا parentProtocolData ⟵ كما كان (لا يُشترط)');
    const r4 = build({childContext: NOT_CHILD, pendingData: {purposeSource: 'default'}, parentProtocolData: PARENT(ACCEPTED())});
    eq(r4.consent.basis, 'NOT_RECORDED', '[٣] وغير الابن لا يرث ولو مُرِّر له أمّ');
    let thrown = null;
    try { build({childContext: CHILD}); } catch (e) { thrown = e; }
    ok(thrown !== null && /parentProtocolData/.test(thrown.message), `[٣] الابن بلا parentProtocolData ⟵ خطأ صريح يسمّيه (لا افتراض: القاعدة 22) — ${thrown ? thrown.message : 'لم يرمِ'}`);
    const r5 = build({childContext: CHILD, parentProtocolData: PARENT(ACCEPTED()), pendingData: {purposeSource: 'repeat_flow', consent: ACCEPTED({state: 'declined'})}});
    deq([r5.document.consent, r5.consent.basis, r5.notes], [NC, 'UNREADABLE', ['CONSENT_NOT_RECOGNIZED']], '[٣] الابن بمخزَّن ذاتي غير مقروء ⟵ UNREADABLE وملاحظة CONSENT_NOT_RECOGNIZED (لا تغطّيه الوراثة)');
  }

  // ═══ ٤ — حراسة المصدر ═══
  {
    const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', ...rel), 'utf8').replace(/\r\n/g, '\n');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
    const ad = strip(read(['analysis', 'analyzeDevice.js']));
    ok(/childContext: repeatChild, creditExemption, parentProtocolData/.test(ad), '[٤] analyzeDevice تمرّر parentProtocolData المقروءة أصلاً (لا قراءة إضافية)');
    eq((ad.match(/SCAN_PROTOCOL\)\.doc\(repeatChild\.parentScanId\)\.get\(\)/g) || []).length, 1, '[٤] قراءة واحدة لمستند الأمّ في analyzeDevice (كما كانت)');
    const cs = strip(read(['protocol', 'consent.js']));
    ok(/CONSENT_STATE\.INHERITED/.test(cs) && /CONSENT_BASIS\.INHERITED|INHERITED:/.test(cs), '[٤] consent.js يستعمل CONSENT_STATE.INHERITED من المفردات');
    ok(!/["'`]inherited["'`]/.test(cs) && !/["'`]inherited["'`]/.test(strip(read(['protocol', 'scanProtocolDocument.js']))), '[٤] لا نصّ حرفي "inherited" في المصدر (protocolVocabulary وحده، القاعدة 24)');
    ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(cs), '[٤] لا حذف في consent.js (القاعدة 42)');
  }

  if (failures.length > 0) {
    console.error(`\nconsentInheritance.test.js: ${failures.length} من ${n} تأكيداً فشلت:`);
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  console.log(`consentInheritance.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(2); });

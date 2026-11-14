'use strict';

// consentPartState.test.js — ق15 (قرار حسن 2026-10-22: «جزء consent للمحلّ يتحكّم بظهور شاشة الموافقة، والخادم يرفض التسجيل لمحلّ بلا الجزء»؛ أمر المستخدم 2026-10-23):
// الجهاز المفحوص (المنضمّ) يجب أن يعرف قبل عرض الشاشة هل جزء الموافقة مفعَّل لمحلّ المالك، والمعلومة اليوم عند تطبيق المالك وحده (protocolParts من createScanSession).
// فيُضاف حقل `consentEnabled` إلى ردّ joinScanSession على نمط `evaluationEnabled` (مستند المالك مقروء أصلاً هناك: صفر قراءات إضافية). هذا الملفّ يختبر **القرار النقيّ** consentPartDecision:
//   ١ كل شكل لمستند المالك ⟵ القيمة المنطقية (الغياب يُعلَن بسببه المسمّى لا false مسدوداً، القاعدة 22) والسبب ونوع القيمة غير المنطقية.
//   ٢ القيمة = `readProtocolParts(owner).consent === true` على كل شكل (مصدر واحد للجزء، القاعدة 24)، وتساوي ما يحكم به recordScanConsent (decideConsentPart): الحقل ⟺ القبول، فلا يُظهر الخادم شاشة يرفض تسجيلها.
//   ٣ حراسة المصدر: joinScanSession.js يستعمل القرار نفسه ولا يكرّر التعبير، والردّ يحمل consentEnabled بقيمته، والقراءات لم تزد.
//
// **يُكتب قبل العلاج ويفشل عليه** (أمر المستخدم): كل تأكيد يُسجَّل فشله بنصّه ولا يوقف التشغيل، وينتهي بتقرير كامل (الخروج 1 إن فشل أي منها).
//
// Run: node functions/test/consentPartState.test.js

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

let mod = null;
try { mod = require('../src/sessions/consentPartState'); } catch (e) { failures.push(`require consentPartState: ${e.message}`); }
const {readProtocolParts} = require('../src/protocol/scanProtocolDocument');
const {PROTOCOL_PART} = require('../src/protocol/protocolVocabulary');

(async () => {
  if (mod === null) {
    n++;
    console.error(`\nconsentPartState.test.js: ${failures.length} من ${n} تأكيداً فشلت:`);
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  const {CONSENT_PART_REASON: R, consentPartDecision} = mod;

  // ═══ ١ — الأسباب: قائمة مجمَّدة بقيمها الحرفية (تُقرأ في سطر السجلّ) ═══
  ok(Object.isFrozen(R), '[١] CONSENT_PART_REASON مجمَّدة');
  deq(R, {
    OWNER_DOC_MISSING: 'OWNER_DOC_MISSING', PARTS_ABSENT: 'PARTS_ABSENT', PARTS_NOT_OBJECT: 'PARTS_NOT_OBJECT',
    PART_ABSENT: 'PART_ABSENT', PART_TRUE: 'PART_TRUE', PART_FALSE: 'PART_FALSE', PART_NOT_BOOLEAN: 'PART_NOT_BOOLEAN',
  }, '[١] سبع حالات مسمّاة بقيمها الحرفية');

  // ═══ ٢ — الجدول: وثيقة المالك ⟵ {value, reason, valueType} ═══
  const CASES = [
    [null, false, R.OWNER_DOC_MISSING, null, 'مستند المالك غائب (null)'],
    [undefined, false, R.OWNER_DOC_MISSING, null, 'مستند المالك undefined'],
    [[], false, R.OWNER_DOC_MISSING, null, 'مستند مصفوفة ليس كائناً'],
    ['x', false, R.OWNER_DOC_MISSING, null, 'مستند نصّ ليس كائناً'],
    [{}, false, R.PARTS_ABSENT, null, 'مستند بلا protocolParts'],
    [{plan: 'shop_pro'}, false, R.PARTS_ABSENT, null, 'مستند بحقول أخرى بلا protocolParts'],
    [{protocolParts: null}, false, R.PARTS_NOT_OBJECT, null, 'protocolParts null'],
    [{protocolParts: 'garbage'}, false, R.PARTS_NOT_OBJECT, null, 'protocolParts نصّ'],
    [{protocolParts: [true]}, false, R.PARTS_NOT_OBJECT, null, 'protocolParts مصفوفة'],
    [{protocolParts: 5}, false, R.PARTS_NOT_OBJECT, null, 'protocolParts رقم'],
    [{protocolParts: {}}, false, R.PART_ABSENT, null, 'protocolParts فارغة'],
    [{protocolParts: {purposes: true, batteryBeforeAfter: true, coldRepeat: true, returns: true, doubleEval: true}}, false, R.PART_ABSENT, null, 'كل الأجزاء الأخرى مفعَّلة ومفتاح consent غائب'],
    [{protocolParts: {consent: undefined}}, false, R.PART_ABSENT, null, 'consent undefined = غائب'],
    [{protocolParts: {consent: true}}, true, R.PART_TRUE, null, 'consent true'],
    [{protocolParts: {consent: true, purposes: false}}, true, R.PART_TRUE, null, 'consent true والأجزاء الأخرى مُطفأة'],
    [{protocolParts: {consent: false}}, false, R.PART_FALSE, null, 'consent false'],
    [{protocolParts: {consent: 'true'}}, false, R.PART_NOT_BOOLEAN, 'string', 'consent نصّ «true»'],
    [{protocolParts: {consent: 1}}, false, R.PART_NOT_BOOLEAN, 'number', 'consent رقم 1'],
    [{protocolParts: {consent: 0}}, false, R.PART_NOT_BOOLEAN, 'number', 'consent رقم 0'],
    [{protocolParts: {consent: null}}, false, R.PART_NOT_BOOLEAN, 'null', 'consent null مخزَّناً (≠ غائب)'],
    [{protocolParts: {consent: {enabled: true}}}, false, R.PART_NOT_BOOLEAN, 'object', 'consent خريطة'],
    [{protocolParts: {consent: [true]}}, false, R.PART_NOT_BOOLEAN, 'array', 'consent مصفوفة'],
  ];
  for (const [owner, value, reason, valueType, label] of CASES) {
    const d = consentPartDecision(owner);
    deq(d, {value, reason, valueType}, `[٢] ${label}`);
    eq(typeof d.value, 'boolean', `[٢] ${label}: القيمة منطقية دائماً (لا غياب على السلك)`);
    // ٣ — القيمة = القراءة المعتمدة للأجزاء (مصدر واحد) = ما يحكم به recordScanConsent
    eq(d.value, readProtocolParts(owner)[PROTOCOL_PART.CONSENT] === true, `[٣] ${label}: القيمة = readProtocolParts(owner).consent === true`);
  }
  // valueType يُملأ مع PART_NOT_BOOLEAN وحدها
  for (const [owner, , reason, valueType, label] of CASES) {
    eq(consentPartDecision(owner).valueType !== null, reason === R.PART_NOT_BOOLEAN, `[٢] ${label}: valueType يُملأ مع PART_NOT_BOOLEAN وحدها`);
    if (reason === R.PART_NOT_BOOLEAN) eq(consentPartDecision(owner).valueType, valueType, `[٢] ${label}: نوع القيمة`);
  }
  // المُدخل لا يُحوَّر ولو كان مجمَّداً
  {
    const frozen = Object.freeze({protocolParts: Object.freeze({consent: true})});
    deq(consentPartDecision(frozen), {value: true, reason: R.PART_TRUE, valueType: null}, '[٢] مدخل مجمَّد');
  }

  // ═══ ٣ — الاتّساق مع recordScanConsent: القيمة ⟺ قبول decideConsentPart (الحقل الذي يراه الجهاز = ما سيحكم به الخادم) ═══
  {
    const consentModule = require('../src/sessions/recordScanConsent');
    ok(typeof consentModule.decideConsentPart === 'function', '[٣] decideConsentPart مُصدَّرة');
    if (typeof consentModule.decideConsentPart === 'function') {
      for (const [owner, value, , , label] of CASES) {
        eq(consentModule.decideConsentPart({ownerData: owner}).ok, value, `[٣] ${label}: consentEnabled ⟺ قبول التسجيل`);
      }
    }
  }

  // ═══ ٤ — حراسة المصدر: joinScanSession.js ═══
  {
    const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', ...rel), 'utf8').replace(/\r\n/g, '\n');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
    const src = strip(read(['sessions', 'joinScanSession.js']));
    ok(/require\("\.\/consentPartState"\)/.test(src) && /consentPartDecision\(owner\)/.test(src), '[٤] joinScanSession.js يستعمل consentPartDecision(owner) من consentPartState.js');
    ok(/consentEnabled: [A-Za-z]+\.value,/.test(src), '[٤] الردّ يحمل consentEnabled بقيمة القرار');
    ok(!/protocolParts/.test(src) && !/PROTOCOL_PART/.test(src) && !/readProtocolParts/.test(src), '[٤] ولا قرار جزء مكتوب في joinScanSession.js نفسه (المصدر consentPartState.js وحده، القاعدة 24)');
    eq((src.match(/db\.collection\("users"\)/g) || []).length, 1, '[٤] قراءة واحدة لمجموعة users في joinScanSession.js (مستند المالك المقروء أصلاً: صفر قراءات إضافية)');
    ok(/\[joinScanSession\] consentEnabled=\$\{[A-Za-z]+\.value\} reason=\$\{[A-Za-z]+\.reason\}/.test(src), '[٤] سطر سجلّ مسمّى consentEnabled= reason=');
    ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(src), '[٤] لا حذف (القاعدة 42)');
    const state = strip(read(['sessions', 'consentPartState.js']));
    ok(/readProtocolParts\(/.test(state) && /PROTOCOL_PART\.CONSENT/.test(state), '[٤] consentPartState.js يقرأ الجزء بـreadProtocolParts وPROTOCOL_PART.CONSENT (مصدر واحد)');
    ok(!/require\(["']\.\.?\/utils\/admin["']\)|firebase-functions|firebase-admin/.test(state), '[٤] وحدة نقيّة: لا Firestore ولا onCall');
    const rec = strip(read(['sessions', 'recordScanConsent.js']));
    ok(/consentPartDecision\(/.test(rec), '[٤] recordScanConsent.js يحكم بالقرار نفسه (consentPartDecision) لا بنسخة');
  }

  if (failures.length > 0) {
    console.error(`\nconsentPartState.test.js: ${failures.length} من ${n} تأكيداً فشلت:`);
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  console.log(`consentPartState.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(2); });

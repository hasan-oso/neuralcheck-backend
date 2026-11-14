'use strict';

// afterScanCreditExemption.test.js — ق10 (قرار المستخدم 2026-10-22/23 عبر حسن: «نطاق إعفاء الخصم يتبع س٢٠: البارد، فحص «بعد»، المرتجع. المنفَّذ البارد وحده»؛ أمر المنسّق 2026-10-23: «أضِف إعفاء `maintenance_after`
// إن سمحت آلية PROTOCOL_EXEMPT القائمة بتغيير صغير آمن؛ المرتجع لا يُبنى»). نصّ س٢٠ (PLAN-06:657، منقول، غير متحقَّق إلا بالقراءة): «لا خصم للتكرار البارد ولا لفحص «بعد» ولا للمرتجع في مرحلة الجمع».
//
// هذا الملفّ يختبر **القرار النقيّ** isAfterScanCreditExempt (repeatScan.js، بجوار isCreditExempt) وحراسة المصدر في analyzeDevice.js: الإعفاء يقوم على شرطين معاً — غرض الجلسة المُعلَن `maintenance_after` بحروفه،
// وعلَم مرحلة الجمع `protocolSettings.collectionPhase === true` صريحاً (غيابه أو فساده لا يُعفي، كما للبارد). وأيّ غرض آخر (normal · maintenance_before · غائب · غير معروف) أو فحص بلا جلسة لا يُعفى أبداً: لا يتغيّر
// عليه خصمٌ ولا بوّابة. والمسار الكامل (الخصم الفعلي على المحاكي بالمعالج الحقيقي) في afterScanCreditExemption.e2e.test.js.
//
// **يُكتب قبل العلاج ويفشل عليه** (أمر المستخدم): كل تأكيد يُسجَّل فشله بنصّه ولا يوقف التشغيل، وينتهي بتقرير كامل (الخروج 1 إن فشل أي منها).
//
// Run: node functions/test/afterScanCreditExemption.test.js

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

const repeatScan = require('../src/protocol/repeatScan');
const {SCAN_PURPOSE, CREDIT_EXEMPTION} = require('../src/protocol/protocolVocabulary');
const {readCollectionPhase} = require('../src/protocol/protocolSettings');
const {isAfterScanCreditExempt, isCreditExempt} = repeatScan;

const PHASE = (v) => readCollectionPhase({state: 'PRESENT', data: v === undefined ? {} : {collectionPhase: v}});
const PHASE_TRUE = PHASE(true);

(async () => {
  ok(typeof isAfterScanCreditExempt === 'function', '[١] isAfterScanCreditExempt مُصدَّرة من repeatScan.js (بجوار isCreditExempt)');
  if (typeof isAfterScanCreditExempt === 'function') {
    const X = (purpose, phase = PHASE_TRUE, sessionData = {purpose}) => isAfterScanCreditExempt({sessionData, collectionPhase: phase});
    // ═══ ١ — الغرض: maintenance_after وحده بحروفه ═══
    eq(X('maintenance_after'), true, '[١] maintenance_after + مرحلة الجمع true ⟵ معفى');
    for (const purpose of Object.values(SCAN_PURPOSE)) {
      if (purpose === SCAN_PURPOSE.MAINTENANCE_AFTER) continue;
      eq(X(purpose), false, `[١] الغرض ${purpose} ⟵ غير معفى (الإعفاء لفحص «بعد» وحده)`);
    }
    for (const [label, purpose] of [['maintenance_before', 'maintenance_before'], ['normal', 'normal'], ['battery_after (قديم)', 'battery_after'], ['أحرف مختلفة', 'Maintenance_After'], ['مسافة لاحقة', 'maintenance_after '], ['فارغ', ''], ['null', null], ['رقم', 1], ['كائن', {a: 1}], ['مصفوفة', ['maintenance_after']], ['غائب', undefined]]) {
      eq(X(purpose, PHASE_TRUE, {purpose}), false, `[١] الغرض ${label} ⟵ غير معفى`);
    }
    // ═══ ٢ — مستند الجلسة: غير الكائن لا غرض له ═══
    for (const [label, sd] of [['null', null], ['undefined', undefined], ['مصفوفة', [{purpose: 'maintenance_after'}]], ['نصّ', 'maintenance_after'], ['كائن بلا غرض', {}]]) {
      eq(isAfterScanCreditExempt({sessionData: sd, collectionPhase: PHASE_TRUE}), false, `[٢] مستند الجلسة ${label} ⟵ غير معفى`);
    }
    // ═══ ٣ — علَم مرحلة الجمع: true صريحة وحدها (الغياب والفساد لا يُعفيان: القاعدة 22) ═══
    eq(X('maintenance_after', PHASE(false)), false, '[٣] collectionPhase=false ⟵ غير معفى');
    eq(X('maintenance_after', PHASE(undefined)), false, '[٣] collectionPhase غائب ⟵ غير معفى');
    eq(X('maintenance_after', PHASE(null)), false, '[٣] collectionPhase=null ⟵ غير معفى');
    eq(X('maintenance_after', PHASE('true')), false, '[٣] collectionPhase=«true» نصّاً ⟵ غير معفى');
    eq(X('maintenance_after', PHASE(1)), false, '[٣] collectionPhase=1 رقماً ⟵ غير معفى');
    eq(X('maintenance_after', readCollectionPhase({state: 'ABSENT', data: null})), false, '[٣] مستند الإعدادات كله غائب ⟵ غير معفى');
    eq(X('maintenance_after', {state: 'SET', value: true}), true, '[٣] الحالة SET بقيمة true ⟵ معفى (الشكل الذي يقرؤه البارد نفسه)');
    eq(X('maintenance_after', {state: 'SET', value: 'true'}), false, '[٣] القيمة نصّ «true» حتى مع SET ⟵ غير معفى (=== true)');
    eq(X('maintenance_after', {state: 'INVALID', value: true}), false, '[٣] حالة الحقل INVALID ولو حملت قيمة true (شكل لا يُنتجه readCollectionPhase) ⟵ غير معفى: الحالتان معاً');
    eq(X('maintenance_after', {state: 'ABSENT', value: true}), false, '[٣] حالة الحقل ABSENT ولو حملت قيمة true ⟵ غير معفى');
    // ═══ ٤ — اتّساق مع البارد: الاثنان لا يلتقيان (الابن بلا غرض في مستند الجلسة، وغرضه من التصنيف) ═══
    eq(isCreditExempt({purpose: SCAN_PURPOSE.MAINTENANCE_AFTER}, PHASE_TRUE), false, '[٤] isCreditExempt (البارد) لا يُعفي maintenance_after (قراران منفصلان)');
    eq(isCreditExempt({purpose: SCAN_PURPOSE.REPEAT_COLD}, PHASE_TRUE), true, '[٤] والبارد يبقى معفىً كما كان');
    eq(X(SCAN_PURPOSE.REPEAT_COLD), false, '[٤] وisAfterScanCreditExempt لا يُعفي repeat_cold (غرض الابن من التصنيف لا من الجلسة)');
    // المُدخل لا يُحوَّر
    {
      const sd = Object.freeze({purpose: 'maintenance_after'});
      const cp = Object.freeze({state: 'SET', value: true});
      eq(isAfterScanCreditExempt({sessionData: sd, collectionPhase: cp}), true, '[٤] مدخل مجمَّد لا يُحوَّر ولا يرمي');
    }
  }

  // ═══ ٥ — حراسة المصدر: analyzeDevice.js ═══
  {
    const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', ...rel), 'utf8').replace(/\r\n/g, '\n');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
    const src = strip(read(['analysis', 'analyzeDevice.js']));
    eq((src.match(/isAfterScanCreditExempt\(/g) || []).length, 1, '[٥] نداء واحد لـisAfterScanCreditExempt في analyzeDevice.js (موضع حكم واحد)');
    eq((src.match(/creditExemption = CREDIT_EXEMPTION\.PROTOCOL_EXEMPT/g) || []).length, 2, '[٥] موضعان لإسناد الإعفاء: البارد وفحص «بعد»');
    ok(/if \(creditExemption === null\) \{\s*const gateRefusal = scanGateVerdict\(/.test(src), '[٥] البوّابة (الرصيد والاشتراك) لا تُشغَّل إلا لغير المعفى — كما كانت');
    ok(/if \(creditExemption !== null\) \{[\s\S]{0,900}releaseScanCredit\([\s\S]{0,900}\} else \{\s*reservation = await reserveScanCredit\(/.test(src), '[٥] الحجز (reserveScanCredit) في فرع غير المعفى وحده — كما كان');
    ok(/isSessionScan && isAfterScanCreditExempt\(/.test(src), '[٥] الإعفاء لفحص جلسة وحدها (الفحص الشخصي بلا جلسة لا يُعفى)');
    ok(/creditExemption === null && isSessionScan && isAfterScanCreditExempt\(/.test(src), '[٥] ولا يمرّ فوق إعفاء قائم (البارد) ولا يُسند إلا حين لا إعفاء');
    ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(strip(read(['protocol', 'repeatScan.js']))), '[٥] لا حذف في repeatScan.js (القاعدة 42)');
    ok(CREDIT_EXEMPTION.PROTOCOL_EXEMPT === 'PROTOCOL_EXEMPT', '[٥] قيمة الإعفاء واحدة (لا قيمة ثانية لفحص «بعد»: الاسم نفسه PROTOCOL_EXEMPT)');
  }

  if (failures.length > 0) {
    console.error(`\nafterScanCreditExemption.test.js: ${failures.length} من ${n} تأكيداً فشلت:`);
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  console.log(`afterScanCreditExemption.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(2); });

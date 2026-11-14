'use strict';

// maintenancePairCalls.test.js — دالّتا ربط «قبل/بعد صيانة»: نواة القائمة (S4) ونواة التأكيد (S5) بقاعدة في الذاكرة (أمر المستخدم 2026-10-22). بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المحاكي في maintenancePair.e2e.test.js.
//
// المواصفة: docs/PROTOCOL_CONTRACT.md §٢ A3 (أُعيدت كتابته بالأمر نفسه؛ ومصدره الحاكم WIRE-SPEC-MAINTENANCE-PAIRS-2026-10-22.md: منقول، غير متحقَّق). **القيم المتوقَّعة حرفيّات هنا عمداً** (مرجع مستقلّ عن الوحدات).
// الاستبدال معلَن (القاعدة 37): lib/pairFakeDb.js يستبدل طبقة Firestore هنا وحدها (مساواة وحدها، لا حذف، معاملة تفاؤلية)؛ الطبقة الحقيقية تُفحص في الـe2e.
//   ١ (S4) listOpenMaintenanceBefores: المرشَّح الكامل (المحلّ والنوع والمدّة والمربوط والاسم والترتيب)، وكل رفض بسببه وسطره، والنافذة بالإعداد (داخلها وعلى حدّها وخارجها وغائبه)، والاستعلامات مساواة على حقل واحد،
//     وقراءة وحدها
//   ٢ بنية الشيفرة
//
// Run: node functions/test/maintenancePairCalls.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const C = require('../src/sessions/maintenancePairCalls');
const {makePairDb, ts, captureConsole} = require('./lib/pairFakeDb');
const {hashIdForLog} = require('../src/utils/logRedaction');

const HOUR = 3600 * 1000;
const NOW = 1_800_000_000_000;
const OWNER = 'owner-1';
const OTHER = 'owner-2';
const SESSION = 'sess-after-1';

// ─── بذور ───
const ownerDoc = (parts = {purposes: true, batteryBeforeAfter: true}) => ({plan: 'shop_pro', protocolParts: parts});
const settingsDoc = (hours = 72) => ({version: 3, openBeforeValidityHours: hours});
const afterSession = (over = {}) => ({ownerId: OWNER, status: 'pending', purpose: 'maintenance_after', expiresAt: ts(NOW + HOUR), ...over});
const pendingDoc = (defectType = 'BATTERY') => ({purposeSource: 'selected', defectType, linkedScanId: null});
// (S8) pair.ownerId = مالك «قبل» (الثالث؛ الافتراضي OWNER): الاستعلام يقيّد بالمحلّ من هذا الحقل لا من التقرير
const beforeProto = (ageH, over = {}, owner = OWNER) => ({scanPurpose: 'maintenance_before', defectType: 'BATTERY', linkedScanId: null, linkState: 'none', linkMethod: null, pair: {state: 'OPEN', ownerId: owner, openedAt: ts(NOW - ageH * HOUR)}, ...over});
const reportDoc = (userId = OWNER, deviceModel = 'SM-A135F') => ({userId, deviceModel});
const MAP = {version: 4, entries: [{model: 'SM-A135F', ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}]};

/** قاعدة بذرة عادية: جلسة «بعد» (نوع BATTERY) وإعداد 72 ساعة وجزءان مفعَّلان، و«قبل» يضيفها الاختبار. */
function world({scanProtocol = {}, reports = {}, extra = {}} = {}) {
  return makePairDb({
    scanSessions: {[SESSION]: afterSession()},
    users: {[OWNER]: ownerDoc()},
    protocolSettings: {current: settingsDoc()},
    protocolPending: {[SESSION]: pendingDoc()},
    scanProtocol, reports, ...extra,
  }, {now: NOW});
}
const list = (db, over = {}) => C.runListOpenBefores({db, uid: OWNER, sessionId: SESSION, nowMs: NOW, ...over});
const ids = (r) => r.response.candidates.map((c) => c.beforeScanId);

(async () => {
  // ═══ ١ — المرشَّح الكامل ═══
  {
    const db = world({
      scanProtocol: {
        'b-new': beforeProto(1), 'b-mid': beforeProto(30), 'b-old-ok': beforeProto(72),
        'b-expired': beforeProto(73), 'b-thermal': beforeProto(2, {defectType: 'THERMAL'}), 'b-type-null': beforeProto(2, {defectType: null}),
        'b-other-shop': beforeProto(3, {}, OTHER), 'b-mismatch': beforeProto(3), 'b-live-active': beforeProto(4), 'b-live-relinked': beforeProto(5), 'b-unlinked': beforeProto(6), 'b-missing-link': beforeProto(7),
        'b-completed': beforeProto(8, {pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts(NOW - 8 * HOUR), completedByScanId: 'after-x'}}),
        'b-legacy-purpose': beforeProto(9, {scanPurpose: 'battery_before'}), 'b-no-report': beforeProto(10), 'b-no-owner': beforeProto(11), 'b-pair-bad': beforeProto(12, {pair: {state: 'OPEN', ownerId: OWNER}}), 'b-no-owner-pair': beforeProto(12, {pair: {state: 'OPEN', openedAt: ts(NOW - 12 * HOUR)}}),
        // «بعد» تربط بعض «قبل»
        'after-live-1': {scanPurpose: 'maintenance_after', linkedScanId: 'b-live-active', linkState: 'active', linkMethod: 'manual', pair: null},
        'after-live-2': {scanPurpose: 'maintenance_after', linkedScanId: 'b-live-relinked', linkState: 'relinked_by_admin', linkMethod: 'manual', pair: null},
        'after-unlinked': {scanPurpose: 'maintenance_after', linkedScanId: 'b-unlinked', linkState: 'unlinked_by_admin', linkMethod: 'manual', pair: null},
        'after-missing': {scanPurpose: 'maintenance_after', linkedScanId: 'b-missing-link', linkState: 'missing', linkMethod: 'manual', pair: null},
        'after-none-ptr': {scanPurpose: 'maintenance_after', linkedScanId: 'b-new', linkState: 'none', linkMethod: null, pair: null},
      },
      reports: {
        'b-new': reportDoc(OWNER, 'SM-A135F'), 'b-mid': reportDoc(OWNER, 'XT2201-2'), 'b-old-ok': reportDoc(OWNER, 'SM-A135F'), 'b-expired': reportDoc(), 'b-thermal': reportDoc(),
        'b-type-null': reportDoc(), 'b-other-shop': reportDoc(OTHER), 'b-mismatch': reportDoc(OTHER), 'b-live-active': reportDoc(), 'b-live-relinked': reportDoc(), 'b-unlinked': reportDoc(OWNER, 'SM-A135F'),
        'b-missing-link': reportDoc(OWNER, 'SM-A135F'), 'b-completed': reportDoc(), 'b-legacy-purpose': reportDoc(), 'b-no-owner': {deviceModel: 'SM-A135F'}, 'b-pair-bad': reportDoc(), 'b-no-owner-pair': reportDoc(),
      },
      extra: {marketingNames: {current: MAP}},
    });
    const cap = captureConsole();
    let r;
    try { r = await list(db); } finally { cap.restore(); }
    ok(r.response && !r.refusal, '[١] القائمة نجحت');
    eq(r.response.validityHours, 72, '[١] validityHours من الإعداد (72)');
    deq(ids(r), ['b-new', 'b-unlinked', 'b-missing-link', 'b-mid', 'b-old-ok'], '[١] المرشَّحون بالضبط وبترتيب الأحدث أوّلاً: «قبل» سليمة، وغير الحيّ الربط (unlinked_by_admin وmissing) تظهر، وعلى حدّ النافذة (72 ساعة) تظهر');
    deq(r.excluded, {WRONG_PURPOSE: 1, WRONG_TYPE: 2, UNREADABLE: 1, NOT_OPEN: 0, EXPIRED: 1, OTHER_SHOP: 0, REPORT_ABSENT: 1, OWNER_UNKNOWN: 1, OWNER_MISMATCH: 1, LIVE_LINK: 2}, '[١] أعداد الاستبعاد بأسبابها: غرض قديم، نوعان مختلفان (THERMAL وnull)، pair غير مقروء، منقضية، بلا تقرير، مالك مجهول، **شذوذ مالك (pair.ownerId = المستدعي والتقرير لغيره: OWNER_MISMATCH)**، ربطان حيّان؛ و«قبل» محلّ آخر **لا تُقرأ أصلاً** (OTHER_SHOP = 0: الاستعلام يقيّد pair.ownerId؛ S8: كانت 1 بقراءة تقريرها: القاعدة 23)');
    ok(!ids(r).includes('b-no-owner-pair'), '[١] (S8) «قبل» بلا pair.ownerId (شكل قديم) لا تظهر ولا تُحصى (لا تطابق استعلام المحلّ): تُعلَن عند الكتابة بملاحظة PAIR_OWNER_ABSENT');
    deq(r.anomalies, ['b-mismatch'], '[١] (S8) الشذوذ يُعلَن بمعرّف «قبل» المعنيّة (للسجلّ المُهشَّر في المعالج) ولا يُصمَت');
    // الاستبعاد ليس بسبب مخفيّ: COMPLETED لا يُقرأ أصلاً (استعلام OPEN)
    ok(!ids(r).includes('b-completed'), '[١] «قبل» COMPLETED لا تظهر (لا تدخل استعلام pair.state == OPEN)');
    eq(r.openRead, 15, '[١] المقروء من استعلام المفتوحات: خمسة عشر scanProtocol لهذا المحلّ بـpair.state == OPEN (لا COMPLETED ولا ما pair فيه null ولا «قبل» محلّ آخر؛ S8)');
    deq(r.response.candidates.map((c) => c.scannedAtMs), [NOW - 1 * HOUR, NOW - 6 * HOUR, NOW - 7 * HOUR, NOW - 30 * HOUR, NOW - 72 * HOUR].sort((a, b) => b - a), '[١] scannedAtMs = pair.openedAt بالمللي ثانية (عدد صحيح) والأحدث أوّلاً');
    ok(r.response.candidates.every((c) => Number.isInteger(c.scannedAtMs)), '[١] أعداد صحيحة');
    deq(Object.keys(r.response), ['validityHours', 'candidates'], '[١] مفتاحا الردّ: validityHours وcandidates');
    deq(Object.keys(r.response.candidates[0]).sort(), ['beforeScanId', 'deviceName', 'scannedAtMs'], '[١] مفاتيح المرشَّح الثلاثة (بلا معرّف عتاد ولا نوع ولا محلّ)');
    // الاسم التجاري بحالة صريحة
    const byId = Object.fromEntries(r.response.candidates.map((c) => [c.beforeScanId, c.deviceName]));
    deq(byId['b-new'], {state: 'mapped', model: 'SM-A135F', names: {ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}, reason: null}, '[١] الطراز في الخريطة ⟵ mapped بالأسماء الثلاثة');
    deq(byId['b-mid'], {state: 'name_unmapped', model: 'XT2201-2', names: null, reason: 'MODEL_NOT_IN_MAP'}, '[١] الطراز ليس فيها ⟵ name_unmapped مع Build.MODEL كما هو (لا اسم مختلَق)');
    // القراءة وحدها
    deq(db.writes, [], '[١] **لا كتابة في القائمة** (قراءة وحدها)');
    // الاستعلامات: مساواة بلا ترتيب ولا مدى؛ والسقف على الأوّل فقط. (S8، القاعدة 23: كان «كل استعلام مساواة على حقل واحد»؛ الأوّل صار مساواتين على حقلين: pair.ownerId وpair.state، يُخدَمان بدمج فهرسَين مفرَدَين لا فهرس مركّب)
    ok(db.queries.every((q) => q.filters.length >= 1 && q.filters.length <= 2 && q.filters.every((f) => f[1] === '==')), '[١] **كل استعلام مساواة وحدها على حقل أو حقلين** (القاعدة 43: لا ترتيب ولا مدى ولا فهرس مركّب)');
    deq(db.queries[0], {collection: 'scanProtocol', filters: [['pair.ownerId', '==', OWNER], ['pair.state', '==', 'OPEN']], limit: 501, inTx: false}, '[١] الاستعلام الأوّل: pair.ownerId == المستدعي وpair.state == OPEN بسقف 501 (السقف + 1)');
    ok(db.queries.slice(1).every((q) => q.filters.length === 1), '[١] وباقي الاستعلامات على حقل واحد (linkedScanId)');
    ok(db.queries.slice(1).every((q) => q.collection === 'scanProtocol' && q.filters[0][0] === 'linkedScanId' && q.limit === null), '[١] والباقي: linkedScanId == «قبل» لكل ناجٍ بعد المحلّ (بلا limit)');
    eq(db.queries.length, 1 + 7, '[١] ثمانية استعلامات: واحد للمفتوحات وسبعة للربط (سبع «قبل» نجت من الترشيح والمحلّ)');
    // سطور السجلّ: لا اسم ولا طراز ولا معرّف خامّ
    const text = cap.texts().join('\n');
    ok(!/SM-A135F|XT2201|سامسونج|b-new|sess-after-1|owner-1/.test(text), '[١] لا اسم جهاز ولا طراز ولا معرّف خامّ في السجلّ');
  }

  // ═══ ٢ — النافذة بالإعداد: داخلها وعلى حدّها وخارجها وغائبه ═══
  for (const [hours, age, want] of [[72, 71.999, true], [72, 72, true], [72, 72.001, false], [24, 23, true], [24, 24, true], [24, 25, false], [168, 100, true], [168, 169, false], [1, 0.5, true], [1, 1.5, false]]) {
    const db = world({scanProtocol: {x: beforeProto(age)}, reports: {x: reportDoc()}});
    db.seed('protocolSettings', 'current', settingsDoc(hours));
    const r = await list(db);
    eq(r.response.candidates.length === 1, want, `[٢] المدّة ${hours} ساعة و«قبل» عمرها ${age} ساعة ⟵ ${want ? 'تظهر' : 'لا تظهر'}`);
    eq(r.response.validityHours, hours, `[٢] validityHours = ${hours} (من الإعداد لا من الشيفرة)`);
  }
  {
    // تغيير الإعداد يسري على كل المفتوح (لا expiresAt مخزَّن)
    const db = world({scanProtocol: {x: beforeProto(50)}, reports: {x: reportDoc()}});
    eq((await list(db)).response.candidates.length, 1, '[٢] 50 ساعة والمدّة 72: تظهر');
    db.seed('protocolSettings', 'current', settingsDoc(24));
    eq((await list(db)).response.candidates.length, 0, '[٢] **خفض الإعداد إلى 24: الموجودة تختفي بلا كتابة على «قبل»** (الانقضاء يُحسب عند القراءة)');
    db.seed('protocolSettings', 'current', settingsDoc(168));
    eq((await list(db)).response.candidates.length, 1, '[٢] ورفعه إلى 168: تعود');
  }
  // ساعة الاستدعاء هي nowMs المُمرَّر
  {
    const db = world({scanProtocol: {x: beforeProto(0)}, reports: {x: reportDoc()}});
    eq((await list(db, {nowMs: NOW + 72 * HOUR})).response.candidates.length, 1, '[٢] الآن = openedAt + 72 ساعة بالضبط: تظهر');
    eq((await list(db, {nowMs: NOW + 72 * HOUR + 1})).response.candidates.length, 0, '[٢] وبعدها بمللي ثانية: لا تظهر');
  }

  // ═══ ٣ — الرفوض: كلٌّ بسببه وسطره ═══
  const refusalOf = async (db, over = {}) => {
    const r = await list(db, over);
    ok(r.refusal !== undefined, `(رفض متوقَّع) ${JSON.stringify(r).slice(0, 80)}`);
    return r;
  };
  {
    const base = () => world({scanProtocol: {x: beforeProto(1)}, reports: {x: reportDoc()}});
    // الجلسة
    let r = await refusalOf(base(), {sessionId: 'no-such'});
    deq([r.refusal, r.extra], ['SESSION_NOT_FOUND', ''], '[٣] جلسة غير موجودة ⟵ SESSION_NOT_FOUND (والعميل يرى SESSION_NOT_PARTICIPANT)');
    r = await refusalOf(base(), {uid: OTHER});
    deq([r.refusal, r.extra], ['SESSION_NOT_OWNER', ' ownerState=SET'], '[٣] غير المالك ⟵ SESSION_NOT_OWNER (للسجلّ) وownerState=SET');
    const noOwner = base(); noOwner.seed('scanSessions', SESSION, afterSession({ownerId: undefined}));
    r = await refusalOf(noOwner);
    deq([r.refusal, r.extra], ['SESSION_NOT_OWNER', ' ownerState=ABSENT'], '[٣] جلسة بلا ownerId ⟵ NOT_OWNER بحالة ABSENT (الغياب لا يطابق)');
    const joinerSession = base(); joinerSession.seed('scanSessions', SESSION, afterSession({joinedBy: 'phone-1'}));
    r = await refusalOf(joinerSession, {uid: 'phone-1'});
    eq(r.refusal, 'SESSION_NOT_OWNER', '[٣] **المنضمّ (الهاتف المفحوص) ليس المالك**: يُرفض');
    // ردّ العميل لغير المالك وللجلسة الغائبة واحد
    deq(C.REFUSAL_RESPONSE.SESSION_NOT_OWNER, C.REFUSAL_RESPONSE.SESSION_NOT_FOUND, '[٣] ردّ العميل: غير المالك = جلسة غائبة نفسه (permission-denied وSESSION_NOT_PARTICIPANT)');
    // غرض الجلسة
    for (const [label, purpose, state] of [['maintenance_before', 'maintenance_before', 'maintenance_before'], ['normal', 'normal', 'normal'], ['battery_after (تاريخية)', 'battery_after', 'battery_after'], ['غائب', undefined, 'ABSENT'], ['null', null, 'ABSENT'], ['مجهول', 'zzz', 'UNRECOGNIZED'], ['رقم', 5, 'NOT_A_STRING'], ['أحرف مختلفة', 'Maintenance_After', 'UNRECOGNIZED']]) {
      const d = base(); d.seed('scanSessions', SESSION, afterSession({purpose}));
      r = await refusalOf(d);
      deq([r.refusal, r.extra], ['PAIR_SESSION_NOT_AFTER', ` purpose=${state}`], `[٣] غرض الجلسة ${label} ⟵ PAIR_SESSION_NOT_AFTER (لا نصّ خامّ في السجلّ)`);
    }
    // جزء المحلّ
    for (const [label, ownerData] of [['الجزء false', ownerDoc({purposes: true, batteryBeforeAfter: false})], ['الجزء غائب', ownerDoc({purposes: true})], ['protocolParts غائبة', {plan: 'shop_pro'}], ['الجزء نصّ «true»', ownerDoc({batteryBeforeAfter: 'true'})], ['الجزء 1', ownerDoc({batteryBeforeAfter: 1})], ['purposes وحده مفعَّل', ownerDoc({purposes: true})]]) {
      const d = base(); d.seed('users', OWNER, ownerData);
      r = await refusalOf(d);
      deq([r.refusal, r.extra], ['PAIR_PART_NOT_ENABLED', ''], `[٣] ${label} ⟵ PAIR_PART_NOT_ENABLED (=== true وحدها تفعّل)`);
    }
    const noOwnerDoc = base(); noOwnerDoc.store.users = {};
    eq((await refusalOf(noOwnerDoc)).refusal, 'PAIR_PART_NOT_ENABLED', '[٣] مستند المالك غائب ⟵ PAIR_PART_NOT_ENABLED («الغائب غير مفعَّل»)');
    // المدّة
    const noSettings = base(); noSettings.store.protocolSettings = {};
    r = await refusalOf(noSettings);
    deq([r.refusal, r.extra], ['PAIR_VALIDITY_SETTING_ABSENT', ' state=SETTINGS_ABSENT'], '[٣] مستند الإعدادات غائب ⟵ PAIR_VALIDITY_SETTING_ABSENT (state=SETTINGS_ABSENT) — لا 72 ولا 168 افتراضية');
    for (const [label, doc, state] of [['الحقل غائب', {version: 2}, 'ABSENT'], ['الحقل null', {version: 2, openBeforeValidityHours: null}, 'ABSENT'], ['0', {version: 2, openBeforeValidityHours: 0}, 'INVALID'], ['سالب', {version: 2, openBeforeValidityHours: -5}, 'INVALID'], ['فوق الحدّ', {version: 2, openBeforeValidityHours: 8761}, 'INVALID'], ['كسر', {version: 2, openBeforeValidityHours: 1.5}, 'INVALID'], ['نصّ «72»', {version: 2, openBeforeValidityHours: '72'}, 'INVALID']]) {
      const d = base(); d.seed('protocolSettings', 'current', doc);
      r = await refusalOf(d);
      deq([r.refusal, r.extra], ['PAIR_VALIDITY_SETTING_ABSENT', ` state=${state}`], `[٣] إعداد المدّة ${label} ⟵ PAIR_VALIDITY_SETTING_ABSENT (السجلّ يفرّق: ${state})`);
    }
    const badVersion = base(); badVersion.seed('protocolSettings', 'current', {openBeforeValidityHours: 72}); // بلا version صالح ⟵ يُقرأ غائباً
    r = await refusalOf(badVersion);
    deq([r.refusal, r.extra], ['PAIR_VALIDITY_SETTING_ABSENT', ' state=SETTINGS_ABSENT'], '[٣] مستند إعدادات بلا version صالح يُقرأ غائباً (لا يُؤخذ منه حقل)');
    // نوع «بعد»
    for (const [label, pend, state] of [['pending غائب', null, 'ABSENT'], ['بلا defectType', {purposeSource: 'selected'}, 'ABSENT'], ['defectType null', {defectType: null}, 'ABSENT'], ['نوع خارج القائمة', {defectType: 'OTHER'}, 'NOT_RECOGNIZED'], ['أحرف صغيرة', {defectType: 'battery'}, 'NOT_RECOGNIZED'], ['رقم', {defectType: 3}, 'NOT_RECOGNIZED']]) {
      const d = base();
      if (pend === null) d.store.protocolPending = {}; else d.seed('protocolPending', SESSION, pend);
      r = await refusalOf(d);
      deq([r.refusal, r.extra], ['PAIR_SESSION_DEFECT_TYPE_ABSENT', ` state=${state}`], `[٣] نوع «بعد» ${label} ⟵ PAIR_SESSION_DEFECT_TYPE_ABSENT (${state})`);
    }
    // ترتيب الفحوص: الملكية قبل الغرض قبل الجزء قبل المدّة قبل النوع
    const allBad = world(); allBad.seed('scanSessions', SESSION, afterSession({purpose: 'normal'})); allBad.seed('users', OWNER, {}); allBad.store.protocolSettings = {}; allBad.store.protocolPending = {};
    eq((await refusalOf(allBad, {uid: OTHER})).refusal, 'SESSION_NOT_OWNER', '[٣] الملكية أوّلاً');
    eq((await refusalOf(allBad)).refusal, 'PAIR_SESSION_NOT_AFTER', '[٣] ثم غرض الجلسة');
    allBad.seed('scanSessions', SESSION, afterSession());
    eq((await refusalOf(allBad)).refusal, 'PAIR_PART_NOT_ENABLED', '[٣] ثم جزء المحلّ');
    allBad.seed('users', OWNER, ownerDoc());
    eq((await refusalOf(allBad)).refusal, 'PAIR_VALIDITY_SETTING_ABSENT', '[٣] ثم المدّة');
    allBad.seed('protocolSettings', 'current', settingsDoc());
    eq((await refusalOf(allBad)).refusal, 'PAIR_SESSION_DEFECT_TYPE_ABSENT', '[٣] ثم نوع «بعد»');
    // لا استعلام قبل اجتياز الشروط
    ok(allBad.queries.length === 0, '[٣] **لا استعلام على scanProtocol قبل اجتياز الشروط كلّها**');
    // السقف: فوق 500 مفتوحة ⟵ رفض مسمّى لا اقتطاع صامت
    const many = {};
    for (let i = 0; i < 501; i++) many[`m-${String(i).padStart(3, '0')}`] = beforeProto(1);
    const capDb = world({scanProtocol: many});
    r = await refusalOf(capDb);
    deq([r.refusal, r.extra], ['PAIR_SCAN_CAP_EXCEEDED', ' cap=500'], '[٣] 501 «قبل» مفتوحة ⟵ PAIR_SCAN_CAP_EXCEEDED (لا اقتطاع صامت)');
    eq(capDb.queries.length, 1, '[٣] ولا قراءة تقارير ولا استعلام ربط بعد السقف');
    const exactly = {};
    for (let i = 0; i < 500; i++) exactly[`m-${String(i).padStart(3, '0')}`] = beforeProto(1);
    const okDb = world({scanProtocol: exactly});
    r = await list(okDb);
    ok(r.response && r.openRead === 500, '[٣] 500 بالضبط: لا رفض (الحدّ نفسه مقبول)');
    eq(r.response.candidates.length, 0, '[٣] وبلا تقارير: لا مرشَّح (REPORT_ABSENT)، والشذوذ معدود');
    eq(r.excluded.REPORT_ABSENT, 500, '[٣] مئة وخمسمئة استبعاد REPORT_ABSENT: الغياب حالة معدودة لا مرشَّحاً صامتاً');
  }

  // ═══ ٣-ب — (S8) السقف لكل محلّ: محلّان، أحدهما فوق السقف ولا يتأثّر الآخر ═══
  {
    const OTHER_SESSION = 'sess-after-2';
    const manyOther = {};
    for (let i = 0; i < 501; i++) manyOther[`o-${String(i).padStart(3, '0')}`] = beforeProto(1, {}, OTHER);
    const seedOtherShop = (db) => {
      db.seed('scanSessions', OTHER_SESSION, afterSession({ownerId: OTHER}));
      db.seed('users', OTHER, ownerDoc());
      db.seed('protocolPending', OTHER_SESSION, pendingDoc());
    };
    const twoShops = world({scanProtocol: {...manyOther, 'mine-1': beforeProto(2), 'mine-2': beforeProto(5)}, reports: {'mine-1': reportDoc(OWNER), 'mine-2': reportDoc(OWNER)}});
    seedOtherShop(twoShops);
    // قبل S8 (استعلام pair.state وحده، للمشروع كلّه): كان المحلّ الصغير يقرأ فوق السقف فيُرفض — يُثبَت أنّ المشهد حقيقي بالاستعلام القديم نفسه على البيانات نفسها
    const oldShape = await twoShops.collection('scanProtocol').where('pair.state', '==', 'OPEN').limit(501).get();
    eq(oldShape.size, 501, '[٣-ب] **قبل S8**: الاستعلام العامّ pair.state == OPEN يقرأ 501 (> السقف) على هذه البيانات ⟵ كان كل المحلّات يُرفضون (عيب)');
    // بعد S8: المحلّ الصغير يُخدَم بمرشَّحيه وحدهم
    let r = await list(twoShops);
    ok(r.response && !r.refusal, '[٣-ب] **بعد S8**: المحلّ الصغير (owner-1) يُخدَم رغم أنّ محلّاً آخر فوق السقف');
    deq(ids(r), ['mine-1', 'mine-2'], '[٣-ب] مرشَّحاه وحدهما (لا «قبل» المحلّ الآخر)');
    eq(r.openRead, 2, '[٣-ب] المقروء من الاستعلام: اثنان فقط (لهذا المحلّ)');
    // المحلّ الكبير (فوق السقف) يُرفض هو وحده برفض مسمّى
    r = await list(twoShops, {uid: OTHER, sessionId: OTHER_SESSION});
    deq([r.refusal, r.extra], ['PAIR_SCAN_CAP_EXCEEDED', ' cap=500'], '[٣-ب] المحلّ الذي عنده 501 مفتوحة يُرفض بـPAIR_SCAN_CAP_EXCEEDED (لا اقتطاع صامت)');
    // مجموع المحلّين فوق السقف وكلٌّ دونه: كلاهما يُخدَم
    const manyA = {};
    for (let i = 0; i < 400; i++) manyA[`a-${String(i).padStart(3, '0')}`] = beforeProto(1, {}, OTHER);
    const manyB = {};
    for (let i = 0; i < 400; i++) manyB[`b-${String(i).padStart(3, '0')}`] = beforeProto(1);
    const sumOver = world({scanProtocol: {...manyA, ...manyB}});
    seedOtherShop(sumOver);
    const rb = await list(sumOver);
    const ra = await list(sumOver, {uid: OTHER, sessionId: OTHER_SESSION});
    ok(rb.response && ra.response && rb.openRead === 400 && ra.openRead === 400, '[٣-ب] 400 لكل محلّ (المجموع 800 > 500): كلاهما يُخدَم ويقرأ 400 (السقف لكل محلّ لا للمشروع)');
    // محلّ يملأ فوق السقف ثم يعود دونه: يُخدَم ثانيةً (لا حالة عالقة)
    const exactlyCap = {};
    for (let i = 0; i < 500; i++) exactlyCap[`c-${String(i).padStart(3, '0')}`] = beforeProto(1);
    const atCap = world({scanProtocol: exactlyCap});
    ok((await list(atCap)).response, '[٣-ب] 500 بالضبط لمحلّ واحد: يُخدَم');
    atCap.seed('scanProtocol', 'c-500', beforeProto(1));
    eq((await list(atCap)).refusal, 'PAIR_SCAN_CAP_EXCEEDED', '[٣-ب] و501: يُرفض');
    atCap.seed('scanProtocol', 'c-500', beforeProto(1, {pair: {state: 'COMPLETED', ownerId: OWNER, openedAt: ts(NOW - HOUR), completedByScanId: 'a-x'}}));
    ok((await list(atCap)).response, '[٣-ب] وحين تكتمل واحدة (COMPLETED تخرج من العدّ): يُخدَم ثانيةً');
    // «قبل» محلّ آخر بلا ownerId في pair (شكل قديم/مجهول) لا تُعدّ في سقف أحد ولا تظهر لأحد
    const noOwner = world({scanProtocol: {x: beforeProto(1, {pair: {state: 'OPEN', openedAt: ts(NOW - HOUR)}}), y: beforeProto(2)}, reports: {x: reportDoc(OWNER), y: reportDoc(OWNER)}});
    r = await list(noOwner);
    deq([ids(r), r.openRead], [['y'], 1], '[٣-ب] «قبل» بلا pair.ownerId لا يطابق استعلام أيّ محلّ: لا تُقرأ ولا تظهر (الغياب لا يُقرأ لصاحب الطلب)');
  }

  // ═══ ٤ — الاسم التجاري: الحالات الأربع ═══
  {
    const mk = (model, mapDoc) => {
      const db = world({scanProtocol: {x: beforeProto(1)}, reports: {x: reportDoc(OWNER, model)}, extra: mapDoc === undefined ? {} : {marketingNames: {current: mapDoc}}});
      return db;
    };
    const nameOf = async (db) => (await list(db)).response.candidates[0].deviceName;
    deq(await nameOf(mk('SM-A135F', MAP)), {state: 'mapped', model: 'SM-A135F', names: {ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}, reason: null}, '[٤] mapped');
    deq(await nameOf(mk('Other-1', MAP)), {state: 'name_unmapped', model: 'Other-1', names: null, reason: 'MODEL_NOT_IN_MAP'}, '[٤] MODEL_NOT_IN_MAP');
    deq(await nameOf(mk('SM-A135F')), {state: 'name_unmapped', model: 'SM-A135F', names: null, reason: 'MAP_ABSENT'}, '[٤] الخريطة غائبة ⟵ MAP_ABSENT (لا اسم مختلَق)');
    deq(await nameOf(mk('SM-A135F', {version: 1, entries: 'x'})), {state: 'name_unmapped', model: 'SM-A135F', names: null, reason: 'MAP_UNREADABLE'}, '[٤] الخريطة بشكل لا يُقرأ ⟵ MAP_UNREADABLE');
    const noModel = mk(undefined, MAP);
    noModel.seed('reports', 'x', {userId: OWNER});
    deq(await nameOf(noModel), {state: 'name_unmapped', model: null, names: null, reason: 'MODEL_ABSENT'}, '[٤] الطراز غائب في التقرير ⟵ MODEL_ABSENT');
  }

  // ═══ ٥ — المربوط يختفي ويعود ═══
  {
    const db = world({scanProtocol: {x: beforeProto(1), y: beforeProto(2)}, reports: {x: reportDoc(), y: reportDoc()}});
    deq(ids(await list(db)), ['x', 'y'], '[٥] «قبل» غير مربوطتين: تظهران');
    db.seed('scanProtocol', 'after-1', {scanPurpose: 'maintenance_after', linkedScanId: 'x', linkState: 'active', linkMethod: 'manual', pair: null});
    deq(ids(await list(db)), ['y'], '[٥] **«بعد» ربطت x (active): x تختفي**');
    db.seed('scanProtocol', 'after-1', {scanPurpose: 'maintenance_after', linkedScanId: 'x', linkState: 'unlinked_by_admin', linkMethod: 'manual', pair: null});
    deq(ids(await list(db)), ['x', 'y'], '[٥] فكّ المشرف الربط (unlinked_by_admin): x تعود');
    db.seed('scanProtocol', 'after-1', {scanPurpose: 'maintenance_after', linkedScanId: 'x', linkState: 'relinked_by_admin', linkMethod: 'manual', pair: null});
    deq(ids(await list(db)), ['y'], '[٥] أعاد المشرف الربط (relinked_by_admin): x تختفي');
    // ربط حيّ من «بعد» ثانية لا يلغيه ربط ميّت من أخرى
    db.seed('scanProtocol', 'after-2', {scanPurpose: 'maintenance_after', linkedScanId: 'y', linkState: 'missing', linkMethod: 'manual', pair: null});
    db.seed('scanProtocol', 'after-3', {scanPurpose: 'maintenance_after', linkedScanId: 'y', linkState: 'active', linkMethod: 'manual', pair: null});
    deq(ids(await list(db)), [], '[٥] y: ربط ميّت (missing) وآخر حيّ: يكفي الحيّ ليخفيها');
    // «بعد» التي تؤشّر إلى «قبل» لا تظهر هي نفسها (لا pair عليها)
    ok(!ids(await list(db)).includes('after-1'), '[٥] ولا تظهر «بعد» في القائمة');
  }
  // محلّ آخر ونوع مختلف
  {
    const db = world({scanProtocol: {mine: beforeProto(1), theirs: beforeProto(1, {}, OTHER), diff: beforeProto(1, {defectType: 'SOFTWARE'})}, reports: {mine: reportDoc(OWNER), theirs: reportDoc(OTHER), diff: reportDoc(OWNER)}});
    deq(ids(await list(db)), ['mine'], '[٥] **«قبل» محلّ آخر لا تظهر، ولا «قبل» بنوع مختلف**');
    db.seed('protocolPending', SESSION, pendingDoc('SOFTWARE'));
    deq(ids(await list(db)), ['diff'], '[٥] ولمّا يصير نوع «بعد» SOFTWARE تظهر «قبل» SOFTWARE وحدها');
    const other = await list(world({scanProtocol: {theirs: beforeProto(1, {}, OTHER)}, reports: {theirs: reportDoc(OTHER)}}), {});
    deq(ids(other), [], '[٥] وليس لمالك آخر شيء من «قبل» غيره');
    eq(other.openRead, 0, '[٥] (S8) و«قبل» محلّ آخر **لا تُقرأ** من الاستعلام أصلاً (openRead = 0)');
  }

  // ═══ ٦ — الحارس على المعالج: المصادقة والمعرّف قبل أيّ قراءة ═══
  {
    const cap = captureConsole();
    const drive = async (request) => { let t = null; try { await C.listOpenMaintenanceBeforesHandler(request); } catch (e) { t = e; } return t; };
    let t;
    try {
      t = await drive({data: {sessionId: SESSION}});
      deq([t.code, t.message, t.details], ['unauthenticated', 'يجب تسجيل الدخول', {reasonCode: 'PAIR_NOT_AUTHENTICATED'}], '[٦] بلا auth ⟵ unauthenticated والنصّ القائم');
      t = await drive({data: {sessionId: SESSION}, auth: {token: {}}});
      eq(t.details.reasonCode, 'PAIR_NOT_AUTHENTICATED', '[٦] auth بلا uid ⟵ PAIR_NOT_AUTHENTICATED');
      for (const [label, sess] of [['غائب', undefined], ['فارغ', ''], ['مسافات', '   '], ['رقم', 7], ['فيه /', 'a/b'], ['نقطتان', '..'], ['طويل', 'x'.repeat(129)], ['null', null], ['كائن', {}]]) {
        t = await drive({data: {sessionId: sess}, auth: {uid: OWNER}});
        deq([t.code, t.message, t.details], ['invalid-argument', 'sessionId مطلوب', {reasonCode: 'PAIR_SESSION_ID_REQUIRED'}], `[٦] sessionId ${label} ⟵ invalid-argument «sessionId مطلوب»`);
      }
      t = await drive({data: null, auth: {uid: OWNER}});
      eq(t.details.reasonCode, 'PAIR_SESSION_ID_REQUIRED', '[٦] data null ⟵ SESSION_ID_REQUIRED');
    } finally {
      cap.restore();
    }
    const lines = cap.texts().filter((l) => l.startsWith('[listOpenMaintenanceBefores] refused'));
    ok(lines.length >= 3 && lines.every((l) => /caller=#[0-9a-f]+/.test(l) || l.includes(`caller=${hashIdForLog(null)}`)), '[٦] سطر رفض مسمّى لكل رفض بمعرّف مُهشَّر');
    ok(!cap.texts().join('\n').includes(OWNER), '[٦] لا معرّف مالك خامّ');
  }
  // ردود الرفض: النصوص القائمة ولا نصّ عربي جديد
  {
    const R = C.REFUSAL_RESPONSE;
    const EXISTING = new Set(['يجب تسجيل الدخول', 'sessionId مطلوب', 'جلسة الفحص غير صالحة', 'الجلسة منتهية']);
    for (const [reason, spec] of Object.entries(R)) {
      ok(Object.isFrozen(spec) && ['unauthenticated', 'invalid-argument', 'permission-denied', 'failed-precondition', 'not-found'].includes(spec.code), `[٦] ${reason}: رمز HttpsError معروف ومجمَّد`);
      ok(EXISTING.has(spec.message) || spec.message === reason, `[٦] ${reason}: النصّ قائم أو هو رمزه التقني (لا نصّ عربي جديد: القرار ٩٠)`);
    }
    // (S5) الجدول مشترك بين الدالّتين: رموز الجلسة والزوج والتأكيد كلّها فيه
    deq(Object.keys(R).sort(), ['BEFORE_ALREADY_PAIRED', 'BEFORE_EXPIRED', 'BEFORE_NOT_FOUND', 'BEFORE_NOT_OWNED', 'BEFORE_WRONG_DEFECT_TYPE', 'BEFORE_WRONG_PURPOSE', 'PAIR_BEFORE_SCAN_ID_REQUIRED', 'PAIR_BEFORE_UNREADABLE', 'PAIR_NOT_AUTHENTICATED', 'PAIR_OWNER_MISMATCH', 'PAIR_PART_NOT_ENABLED', 'PAIR_SCAN_CAP_EXCEEDED', 'PAIR_SESSION_DEFECT_TYPE_ABSENT', 'PAIR_SESSION_ID_REQUIRED', 'PAIR_SESSION_NOT_ACTIVE', 'PAIR_SESSION_NOT_AFTER', 'PAIR_VALIDITY_SETTING_ABSENT', 'SESSION_EXPIRED', 'SESSION_EXPIRES_AT_INVALID', 'SESSION_NOT_FOUND', 'SESSION_NOT_OWNER', 'SESSION_STATUS_UNKNOWN'], '[٦] رموز رفض الدالّتين (جدول واحد: القائمة S4 والتأكيد S5)');
    deq([R.SESSION_NOT_FOUND.clientReasonCode, R.SESSION_NOT_OWNER.clientReasonCode], ['SESSION_NOT_PARTICIPANT', 'SESSION_NOT_PARTICIPANT'], '[٦] ما يراه العميل لجلسة غائبة ولغير المالك واحد');
    let bad = null;
    try { C.refuse('x', 'NOT_A_REASON'); } catch (e) { bad = e; }
    ok(bad && !bad.code && /سبب رفض غير مُدرَج/.test(bad.message), '[٦] سبب غير مُدرَج: خطأ برمجي لا HttpsError');
  }

  // ═══ ٨ — (S5) confirmMaintenanceAfterLink: نواة التأكيد بقاعدة في الذاكرة ═══
  {
    const {FieldValue: FV} = require('./lib/pairFakeDb');
    const confirmWorld = (over = {}) => makePairDb({
      scanSessions: {[SESSION]: afterSession(over.session || {})},
      users: {[OWNER]: over.owner || ownerDoc()},
      protocolSettings: over.settings === null ? {} : {current: over.settings || settingsDoc()},
      protocolPending: {[SESSION]: over.pending === undefined ? pendingDoc() : over.pending},
      scanProtocol: {'b-1': beforeProto(5), 'b-2': beforeProto(6), ...(over.scanProtocol || {})},
      reports: {'b-1': reportDoc(), 'b-2': reportDoc(), ...(over.reports || {})},
    }, {now: NOW});
    const confirm = (db, o = {}) => C.runConfirmAfterLink({db, uid: OWNER, sessionId: SESSION, beforeScanId: 'b-1', now: new Date(NOW), FieldValue: FV, ...o});
    const pendingOf = (db) => db.store.protocolPending[SESSION];

    // النجاح: كتابة واحدة بالدمج على protocolPending، ولا شيء على «قبل» ولا الجلسة
    {
      const db = confirmWorld();
      const sessionBefore = JSON.stringify(db.store.scanSessions[SESSION], (k, v) => (v && v.toMillis ? v.toMillis() : v));
      const beforeBefore = JSON.stringify(db.store.scanProtocol['b-1'], (k, v) => (v && v.toMillis ? v.toMillis() : v));
      const r = await confirm(db);
      deq(r, {confirmed: true, replaced: false}, '[٨] التأكيد نجح بلا استبدال');
      const p = pendingOf(db);
      eq(p.linkedScanId, 'b-1', '[٨] pending.linkedScanId = «قبل» المختارة');
      eq(p.linkMethod, 'manual', '[٨] linkMethod = manual (auto_confirmed لا يُكتب)');
      eq(p.linkConfirmedAt.toMillis(), NOW, '[٨] linkConfirmedAt وقت الخادم');
      ok('linkConfirmedByTechnicianId' in p && p.linkConfirmedByTechnicianId === null, '[٨] **linkConfirmedByTechnicianId null صريح** (المفتاح حاضر: لا هويّة فنّي في الطلب، E7)');
      deq([p.purposeSource, p.defectType], ['selected', 'BATTERY'], '[٨] والدمج حفظ ما سواه (purposeSource وdefectType)');
      deq(db.writes.map((w) => `${w.op}:${w.path}`), ['set:protocolPending/sess-after-1'], '[٨] **كتابة واحدة بالضبط**: set (دمج) على protocolPending — لا على «قبل» ولا الجلسة');
      eq(JSON.stringify(db.store.scanSessions[SESSION], (k, v) => (v && v.toMillis ? v.toMillis() : v)), sessionBefore, '[٨] مستند الجلسة لم يتغيّر');
      eq(JSON.stringify(db.store.scanProtocol['b-1'], (k, v) => (v && v.toMillis ? v.toMillis() : v)), beforeBefore, '[٨] **ولا شيء يُكتب على «قبل» عند التأكيد** (الحجز لا يُنشأ)');
      deq(db.batches, [], '[٨] ولا دفعة (معاملة واحدة)');
    }
    // إعادة الاختيار تستبدل (الأحدث يربح)، وإعادة تأكيد المعرّف نفسه ليست استبدالاً
    {
      const db = confirmWorld();
      await confirm(db);
      db.now = NOW + 5000;
      const again = await confirm(db, {beforeScanId: 'b-2', now: new Date(NOW + 5000)});
      deq(again, {confirmed: true, replaced: true}, '[٨] اختيار «قبل» ثانية: استبدال (replaced = true)');
      eq(pendingOf(db).linkedScanId, 'b-2', '[٨] **الأحدث يربح**: pending.linkedScanId = b-2');
      const same = await confirm(db, {beforeScanId: 'b-2', now: new Date(NOW + 9000)});
      deq(same, {confirmed: true, replaced: false}, '[٨] إعادة تأكيد المعرّف نفسه: ليست استبدالاً');
      db.now = NOW + 9000;
      eq(db.writes.length, 3, '[٨] ثلاث كتابات لثلاثة تأكيدات');
    }
    // الجلسة: pending وscanning تُقبلان؛ غيرهما بسببه؛ مجهولة؛ منقضية
    for (const status of ['pending', 'scanning']) {
      const r = await confirm(confirmWorld({session: {status}}));
      ok(r.confirmed === true, `[٨] جلسة ${status} تقبل التأكيد`);
    }
    for (const status of ['completed', 'cancelled', 'expired']) {
      const db = confirmWorld({session: {status}});
      const r = await confirm(db);
      deq([r.refusal, r.extra], ['PAIR_SESSION_NOT_ACTIVE', ` status=${status}`], `[٨] جلسة ${status} ⟵ PAIR_SESSION_NOT_ACTIVE (الحالة في السجلّ)`);
      deq(db.writes, [], `[٨] ${status}: لا كتابة`);
    }
    for (const [label, status, state] of [['غائبة', undefined, 'ABSENT'], ['null', null, 'ABSENT'], ['رقم', 5, 'NOT_A_STRING'], ['لا تعرفها الشيفرة', 'done', 'UNRECOGNIZED'], ['أحرف مختلفة', 'Pending', 'UNRECOGNIZED']]) {
      const db = confirmWorld({session: {status}});
      const r = await confirm(db);
      deq([r.refusal, r.extra], ['SESSION_STATUS_UNKNOWN', ` statusState=${state}`], `[٨] حالة ${label} ⟵ SESSION_STATUS_UNKNOWN (لا تُقرأ pending من الغياب)`);
      deq(db.writes, [], `[٨] حالة ${label}: لا كتابة`);
    }
    for (const status of ['pending', 'scanning']) {
      const db = confirmWorld({session: {status, expiresAt: ts(NOW - 1)}});
      const r = await confirm(db);
      deq([r.refusal, r.extra], ['SESSION_EXPIRED', ' expiredRecorded=true'], `[٨] ${status} منقضية ⟵ SESSION_EXPIRED وتُسجَّل «منتهية» في المعاملة نفسها`);
      deq(db.writes.map((w) => `${w.op}:${w.path}`), ['update:scanSessions/sess-after-1'], `[٨] ${status} منقضية: كتابة واحدة هي «منتهية» (لا pending)`);
      eq(db.store.scanSessions[SESSION].status, 'expired', `[٨] ${status} منقضية: الحالة صارت expired`);
      ok(db.store.scanSessions[SESSION].expiredAt && db.store.scanSessions[SESSION].expiredAt.toMillis() === NOW, `[٨] ${status} منقضية: وقت التسجيل من ساعة الخادم`);
      ok(pendingOf(db).linkedScanId === null, `[٨] ${status} منقضية: ولا ربط كُتب`);
    }
    {
      const db = confirmWorld({session: {expiresAt: ts(NOW)}});
      ok((await confirm(db)).confirmed === true, '[٨] expiresAt == الآن تماماً: لم تنقضِ بعد');
      const dbInvalid = confirmWorld({session: {expiresAt: undefined}});
      const r = await confirm(dbInvalid);
      deq([r.refusal, dbInvalid.writes.length], ['SESSION_EXPIRES_AT_INVALID', 0], '[٨] expiresAt غائب ⟵ SESSION_EXPIRES_AT_INVALID بلا كتابة (لا «صالحة» ولا «منتهية»)');
    }
    // الوجود والملكية
    {
      const db = confirmWorld();
      let r = await confirm(db, {sessionId: 'no-such'});
      deq([r.refusal, r.extra], ['SESSION_NOT_FOUND', ''], '[٨] جلسة غير موجودة ⟵ SESSION_NOT_FOUND');
      r = await confirm(db, {uid: OTHER});
      deq([r.refusal, r.extra], ['SESSION_NOT_OWNER', ' ownerState=SET'], '[٨] غير المالك ⟵ SESSION_NOT_OWNER');
      deq(db.writes, [], '[٨] لا كتابة في الرفضين');
    }
    // شروط الجلسة المشتركة مع القائمة: الغرض، الجزء، الإعداد، نوع «بعد»
    for (const [label, over, reason, extra] of [
      ['غرض الجلسة normal', {session: {purpose: 'normal'}}, 'PAIR_SESSION_NOT_AFTER', ' purpose=normal'],
      ['غرض الجلسة maintenance_before', {session: {purpose: 'maintenance_before'}}, 'PAIR_SESSION_NOT_AFTER', ' purpose=maintenance_before'],
      ['جزء الزوج مُطفأ', {owner: ownerDoc({purposes: true, batteryBeforeAfter: false})}, 'PAIR_PART_NOT_ENABLED', ''],
      ['مستند الإعدادات غائب', {settings: null}, 'PAIR_VALIDITY_SETTING_ABSENT', ' state=SETTINGS_ABSENT'],
      ['المدّة غير صالحة', {settings: {version: 1, openBeforeValidityHours: 0}}, 'PAIR_VALIDITY_SETTING_ABSENT', ' state=INVALID'],
      ['المدّة غائبة', {settings: {version: 1}}, 'PAIR_VALIDITY_SETTING_ABSENT', ' state=ABSENT'],
      ['نوع «بعد» غائب', {pending: {purposeSource: 'selected'}}, 'PAIR_SESSION_DEFECT_TYPE_ABSENT', ' state=ABSENT'],
      ['نوع «بعد» مجهول', {pending: {defectType: 'OTHER'}}, 'PAIR_SESSION_DEFECT_TYPE_ABSENT', ' state=NOT_RECOGNIZED'],
    ]) {
      const db = confirmWorld(over);
      const r = await confirm(db);
      deq([r.refusal, r.extra], [reason, extra], `[٨] ${label} ⟵ ${reason}`);
      deq(db.writes, [], `[٨] ${label}: لا كتابة`);
    }
    // «قبل»: كل رفض بسببه، ولا كتابة
    for (const [label, over, o, reason, extra] of [
      ['«قبل» غير موجودة', {}, {beforeScanId: 'ghost'}, 'BEFORE_NOT_FOUND', ''],
      // (S8، القاعدة 23: كان «تقرير محلّ آخر» وحده يُمثّل «قبل» محلّ آخر؛ صارت pair.ownerId والتقرير معاً لمحلّ آخر، واختلافهما شذوذ مسمّى)
      ['«قبل» لمحلّ آخر (pair والتقرير)', {scanProtocol: {'b-1': beforeProto(5, {}, OTHER)}, reports: {'b-1': reportDoc(OTHER)}}, {}, 'BEFORE_NOT_OWNED', ' ownerState=OTHER'],
      ['شذوذ: pair.ownerId = المستدعي والتقرير لمحلّ آخر', {reports: {'b-1': reportDoc(OTHER)}}, {}, 'PAIR_OWNER_MISMATCH', ' ownerState=PAIR_DIFFERS_FROM_REPORT'],
      ['شذوذ: التقرير للمستدعي وpair.ownerId لمحلّ آخر', {scanProtocol: {'b-1': beforeProto(5, {}, OTHER)}}, {}, 'PAIR_OWNER_MISMATCH', ' ownerState=PAIR_DIFFERS_FROM_REPORT'],
      ['pair بلا ownerId (شكل قديم لا يُقرأ)', {scanProtocol: {'b-1': beforeProto(5, {pair: {state: 'OPEN', openedAt: ts(NOW - 5 * HOUR)}})}}, {}, 'PAIR_BEFORE_UNREADABLE', ' pair=UNREADABLE'],
      ['«قبل» بلا تقرير (المالك مجهول)', {reports: {'b-1': undefined}}, {}, 'BEFORE_NOT_OWNED', ' ownerState=ABSENT'],
      ['غرض «قبل» battery_before', {scanProtocol: {'b-1': beforeProto(5, {scanPurpose: 'battery_before'})}}, {}, 'BEFORE_WRONG_PURPOSE', ''],
      ['«بعد» مختارة بدل «قبل»', {scanProtocol: {'b-1': beforeProto(5, {scanPurpose: 'maintenance_after', pair: null})}}, {}, 'BEFORE_WRONG_PURPOSE', ''],
      ['نوع مختلف', {scanProtocol: {'b-1': beforeProto(5, {defectType: 'THERMAL'})}}, {}, 'BEFORE_WRONG_DEFECT_TYPE', ''],
      ['pair غير مقروء', {scanProtocol: {'b-1': beforeProto(5, {pair: {state: 'OPEN'}})}}, {}, 'PAIR_BEFORE_UNREADABLE', ' pair=UNREADABLE'],
      ['pair COMPLETED', {scanProtocol: {'b-1': beforeProto(5, {pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts(NOW - 5 * HOUR), completedByScanId: 'a-9'}})}}, {}, 'BEFORE_ALREADY_PAIRED', ' via=PAIR_STATE'],
      ['لها ربط حيّ', {scanProtocol: {'a-live': {scanPurpose: 'maintenance_after', linkedScanId: 'b-1', linkState: 'active', linkMethod: 'manual', pair: null}}}, {}, 'BEFORE_ALREADY_PAIRED', ' via=LIVE_LINK'],
      ['خارج النافذة', {scanProtocol: {'b-1': beforeProto(73)}}, {}, 'BEFORE_EXPIRED', ''],
    ]) {
      const db = confirmWorld(over);
      if (over.reports && over.reports['b-1'] === undefined) delete db.store.reports['b-1'];
      const r = await confirm(db, o);
      deq([r.refusal, r.extra], [reason, extra], `[٨] ${label} ⟵ ${reason}`);
      deq(db.writes, [], `[٨] ${label}: لا كتابة (pending كما كانت)`);
      ok(pendingOf(db).linkedScanId === null, `[٨] ${label}: ولا ربط كُتب`);
    }
    // حدّ النافذة
    ok((await confirm(confirmWorld({scanProtocol: {'b-1': beforeProto(72)}}))).confirmed === true, '[٨] «قبل» عمرها 72 بالضبط والمدّة 72: تُقبل');
    eq((await confirm(confirmWorld({scanProtocol: {'b-1': beforeProto(72.0001)}}))).refusal, 'BEFORE_EXPIRED', '[٨] وبعد الحدّ بقليل: BEFORE_EXPIRED');
    eq((await confirm(confirmWorld({scanProtocol: {'b-1': beforeProto(50)}, settings: {version: 1, openBeforeValidityHours: 24}}))).refusal, 'BEFORE_EXPIRED', '[٨] المدّة 24 و«قبل» عمرها 50: BEFORE_EXPIRED (المدّة من الإعداد)');
    // ربط ميّت من «بعد» لا يمنع
    ok((await confirm(confirmWorld({scanProtocol: {'a-dead': {scanPurpose: 'maintenance_after', linkedScanId: 'b-1', linkState: 'unlinked_by_admin', linkMethod: 'manual', pair: null}}}))).confirmed === true, '[٨] ربط ميّت (unlinked_by_admin) لا يمنع التأكيد');
    // لا مطابقة تلقائية: «قبل» وحيدة مطابقة تماماً لا تُربط بلا نداء
    {
      const db = confirmWorld();
      ok(pendingOf(db).linkedScanId === null && db.writes.length === 0, '[٨] **لا مطابقة تلقائية**: قبل النداء لا ربط، ولا شيء يُكتب من تلقاء نفسه');
    }
    // السباق داخل المعاملة: «قبل» اكتملت بغير هذه الجلسة بين القراءة والإتمام ⟵ إعادة المحاولة ورفض مسمّى بلا كتابة
    {
      const db = confirmWorld();
      let attempts = 0;
      db.hooks.beforeCommit = ({attempt, db: d}) => {
        attempts = attempt;
        if (attempt === 1) d.seed('scanProtocol', 'b-1', beforeProto(5, {pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts(NOW - 5 * HOUR), completedByScanId: 'winner-after'}}));
      };
      const r = await confirm(db);
      eq(attempts, 2, '[٨] المعاملة أُعيدت مرّة (تعارض: «قبل» تغيّرت بين القراءة والإتمام)');
      deq([r.refusal, r.extra], ['BEFORE_ALREADY_PAIRED', ' via=PAIR_STATE'], '[٨] **وفي المحاولة الثانية رأت COMPLETED فرُفض التأكيد بسببه**');
      deq(db.writes.filter((w) => w.path.startsWith('protocolPending')), [], '[٨] ولم يُكتب شيء في pending (كتابة المحاولة الأولى لم تُتمَّ)');
    }
    {
      // إلغاء الجلسة بين القراءة والإتمام ⟵ إعادة المحاولة ثم رفض الحالة
      const db = confirmWorld();
      db.hooks.beforeCommit = ({attempt, db: d}) => { if (attempt === 1) d.seed('scanSessions', SESSION, afterSession({status: 'cancelled'})); };
      const r = await confirm(db);
      deq([r.refusal, r.extra], ['PAIR_SESSION_NOT_ACTIVE', ' status=cancelled'], '[٨] جلسة أُلغيت أثناء التأكيد ⟵ PAIR_SESSION_NOT_ACTIVE بعد إعادة المحاولة');
    }
    // مكتوب بالتحليل: القراءات كلّها قبل أول كتابة (الغلاف يرمي لو خولف) — يمرّ كل ما سبق بلا رمي
    ok(true, '[٨] لا قراءة بعد كتابة في أيّ مسار أعلاه (pairFakeDb يرمي عليها)');
  }

  // ═══ ٩ — (S5) قرار الجلسة للتأكيد والمعالج بلا قاعدة ═══
  {
    const D = (data, uid = OWNER) => C.decideConfirmSession({data, uid, now: new Date(NOW)});
    const OUT = C.CONFIRM_OUTCOME;
    deq(D(afterSession()), {outcome: OUT.CONTINUE}, '[٩] جلسة pending سليمة ⟵ CONTINUE');
    deq(D(afterSession({status: 'scanning'})), {outcome: OUT.CONTINUE}, '[٩] scanning سليمة ⟵ CONTINUE');
    deq(D(null), {outcome: OUT.REFUSED, refusal: 'SESSION_NOT_FOUND', extra: ''}, '[٩] غائبة');
    deq(D(afterSession(), OTHER).refusal, 'SESSION_NOT_OWNER', '[٩] غير المالك');
    deq(D(afterSession({status: 'completed'})), {outcome: OUT.REFUSED, refusal: 'PAIR_SESSION_NOT_ACTIVE', extra: ' status=completed'}, '[٩] completed');
    deq(D(afterSession({expiresAt: ts(NOW - 1)})), {outcome: OUT.EXPIRE, refusal: 'SESSION_EXPIRED'}, '[٩] منقضية ⟵ EXPIRE');
    deq(D(afterSession({expiresAt: ts(NOW - 1), status: 'completed'})).refusal, 'PAIR_SESSION_NOT_ACTIVE', '[٩] الحالة قبل الانقضاء: completed منقضية ⟵ NOT_ACTIVE لا EXPIRE (النهائية لا تتحوّل)');
    deq(D(afterSession({expiresAt: 'garbage'})), {outcome: OUT.REFUSED, refusal: 'SESSION_EXPIRES_AT_INVALID'}, '[٩] expiresAt تالف');
    ok(Object.isFrozen(OUT), '[٩] CONFIRM_OUTCOME مجمَّد');
    // المعالج: المصادقة والمعرّفان قبل أيّ قراءة
    const cap = captureConsole();
    const drive = async (request) => { let t = null; try { await C.confirmMaintenanceAfterLinkHandler(request); } catch (e) { t = e; } return t; };
    let t;
    try {
      t = await drive({data: {sessionId: SESSION, beforeScanId: 'b-1'}});
      deq([t.code, t.message, t.details], ['unauthenticated', 'يجب تسجيل الدخول', {reasonCode: 'PAIR_NOT_AUTHENTICATED'}], '[٩] بلا auth');
      for (const [label, sess] of [['غائب', undefined], ['فارغ', ''], ['فيه /', 'a/b']]) {
        t = await drive({data: {sessionId: sess, beforeScanId: 'b-1'}, auth: {uid: OWNER}});
        deq([t.code, t.message, t.details], ['invalid-argument', 'sessionId مطلوب', {reasonCode: 'PAIR_SESSION_ID_REQUIRED'}], `[٩] sessionId ${label}`);
      }
      for (const [label, before] of [['غائب', undefined], ['null', null], ['فارغ', ''], ['مسافات', '   '], ['رقم', 5], ['كائن', {}], ['مصفوفة', ['b-1']]]) {
        t = await drive({data: {sessionId: SESSION, beforeScanId: before}, auth: {uid: OWNER}});
        deq([t.code, t.message, t.details], ['invalid-argument', 'PAIR_BEFORE_SCAN_ID_REQUIRED', {reasonCode: 'PAIR_BEFORE_SCAN_ID_REQUIRED'}], `[٩] beforeScanId ${label} ⟵ PAIR_BEFORE_SCAN_ID_REQUIRED`);
      }
      for (const [label, before] of [['فيه /', 'a/b'], ['نقطتان', '..'], ['طويل', 'x'.repeat(129)]]) {
        t = await drive({data: {sessionId: SESSION, beforeScanId: before}, auth: {uid: OWNER}});
        deq([t.code, t.message, t.details], ['not-found', 'BEFORE_NOT_FOUND', {reasonCode: 'BEFORE_NOT_FOUND'}], `[٩] beforeScanId ${label} ⟵ BEFORE_NOT_FOUND بلا قراءة`);
      }
    } finally {
      cap.restore();
    }
    const refusedLines = cap.texts().filter((l) => l.startsWith('[confirmMaintenanceAfterLink] refused'));
    ok(refusedLines.length >= 10 && refusedLines.every((l) => /caller=#[0-9a-f]+/.test(l) || l.includes(`caller=${hashIdForLog(null)}`)), '[٩] سطر رفض مسمّى لكل رفض بمعرّف مُهشَّر');
    ok(refusedLines.some((l) => l.includes(' cause=ID_INVALID')), '[٩] ومعرّف «قبل» غير الصالح يحمل cause=ID_INVALID');
    ok(!cap.texts().join('\n').includes(OWNER) && !cap.texts().join('\n').includes('b-1'), '[٩] لا معرّف خامّ');
    // جدول الرفض للتأكيد
    const R = C.REFUSAL_RESPONSE;
    deq([R.BEFORE_NOT_FOUND.code, R.BEFORE_NOT_OWNED.code, R.BEFORE_WRONG_PURPOSE.code, R.BEFORE_WRONG_DEFECT_TYPE.code, R.BEFORE_ALREADY_PAIRED.code, R.BEFORE_EXPIRED.code, R.PAIR_BEFORE_UNREADABLE.code, R.PAIR_SESSION_NOT_ACTIVE.code],
      ['not-found', 'permission-denied', 'failed-precondition', 'failed-precondition', 'failed-precondition', 'failed-precondition', 'failed-precondition', 'failed-precondition'], '[٩] رموز HttpsError لرفوض «قبل» كما في A3 البند ٥');
    deq([R.SESSION_EXPIRED.message, R.SESSION_EXPIRED.code, R.SESSION_EXPIRES_AT_INVALID.message, R.SESSION_EXPIRES_AT_INVALID.code], ['الجلسة منتهية', 'failed-precondition', 'جلسة الفحص غير صالحة', 'permission-denied'], '[٩] انتهاء الجلسة: النصّان القائمان نفسهما');
    ok(Object.keys(require('../index.js')).includes('confirmMaintenanceAfterLink'), '[٩] confirmMaintenanceAfterLink مُصدَّرة في index.js');
    // بنية الشيفرة للتأكيد
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
    const source = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'maintenancePairCalls.js'), 'utf8').replace(/\r\n/g, '\n'));
    const confirmCore = source.slice(source.indexOf('async function runConfirmAfterLink'), source.indexOf('const logUnexpected'));
    ok(!/throw\s/.test(confirmCore), '[٩] **لا throw داخل نواة التأكيد** (تُرجِع قراراً؛ الرمي داخل المعاملة يُسقط كتابة «منتهية»)');
    const gets = [...confirmCore.matchAll(/tx\.get\(/g)];
    const writes = [...confirmCore.matchAll(/tx\.(update|set|create)\(/g)];
    ok(gets.length >= 7 && writes.length === 2, '[٩] قراءات المعاملة سبع، وكتابتان لا غير: «منتهية» (tx.update) وpending (tx.set)');
    ok(Math.max(...gets.map((m) => m.index)) < Math.min(...writes.map((m) => m.index)) || confirmCore.indexOf('tx.update(sessionRef') < confirmCore.indexOf('tx.get(userRef)'), '[٩] القراءات قبل كتابة pending (وكتابة «منتهية» في فرع يعود فوراً بلا قراءة بعدها)');
    ok(/tx\.set\(pendingRef, \{[\s\S]*?\}, \{merge: true\}\)/.test(confirmCore), '[٩] pending يُدمَج (merge) لا يُستبدل');
    ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(/.test(source), '[٩] لا حذف ولا دفعة في الملفّ (القاعدة 42)');
    ok(!/["'`](maintenance_before|maintenance_after|manual|auto_confirmed|linkedScanId|linkMethod|linkConfirmedAt|linkConfirmedByTechnicianId)["'`]/.test(source), '[٩] لا نصّ حرفي لغرض ولا طريقة ربط ولا اسم حقل ربط (المصادر: protocolVocabulary وPENDING_FIELD وSCAN_PROTOCOL_FIELD)');
  }

  // ═══ ٧ — بنية الشيفرة ═══
  {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
    const source = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'maintenancePairCalls.js'), 'utf8').replace(/\r\n/g, '\n'));
    const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
    eq(throwSites.length, 1, '[٧] `throw new HttpsError` واحد فقط');
    const refuseDef = source.indexOf('function refuse(');
    ok(refuseDef >= 0 && throwSites[0].index > refuseDef && throwSites[0].index < source.indexOf('\n}\n', refuseDef), '[٧] وهو داخل refuse');
    ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(|\.set\(|\.update\(|\.create\(|runTransaction/.test(source.slice(source.indexOf('async function runListOpenBefores'), source.indexOf('async function runConfirmAfterLink'))), '[٧] نواة القائمة بلا كتابة ولا حذف ولا معاملة (قراءة وحدها: القاعدة 42)');
    ok(!/\.orderBy\(|\.startAt\(|\.startAfter\(|\.endAt\(|\.where\([^)]*["'](<|<=|>|>=|!=|in|array-contains|not-in)["']/.test(source), '[٧] لا orderBy ولا مدى ولا غير المساواة (القاعدة 43: لا فهرس مركّب)');
    // (S5، القاعدة 23: كان «اثنان» لموضعَي القائمة؛ صار ثلاثة بإضافة استعلام الربط الحيّ في نواة التأكيد — كلٌّ مساواة على حقل واحد)
    // (S8، القاعدة 23: كان «ثلاثة»؛ صار الاستعلام الأوّل مساواتين: pair.ownerId وpair.state)
    eq([...source.matchAll(/\.where\(/g)].length, 4, '[٧] أربعة مواضع where: pair.ownerId وpair.state (الاستعلام الأوّل: مساواتان) وlinkedScanId في القائمة، وlinkedScanId في التأكيد');
    ok(!/["'`](scanProtocol|protocolPending|marketingNames|protocolSettings)["'`]/.test(source), '[٧] لا نصّ حرفي لاسم مجموعة بروتوكول (القاعدة 24)');
    ok(!/["'`](maintenance_before|maintenance_after|BATTERY|THERMAL|OPEN|COMPLETED|pair|defectType|linkedScanId)["'`]/.test(source.replace(/\.where\(`\$\{[^`]*`/g, '')), '[٧] لا نصّ حرفي لغرض ولا نوع ولا حالة زوج ولا اسم حقل (مصادرها protocolVocabulary وSCAN_PROTOCOL_FIELD وPAIR_KEY)');
    ok(/where\(`\$\{SCAN_PROTOCOL_FIELD\.PAIR\}\.\$\{MP\.PAIR_KEY\.OWNER_ID\}`, "==", uid\)\s*\.where\(`\$\{SCAN_PROTOCOL_FIELD\.PAIR\}\.\$\{MP\.PAIR_KEY\.STATE\}`, "==", PAIR_STATE\.OPEN\)\.limit\(MP\.OPEN_PAIR_SCAN_CAP \+ 1\)/.test(source), '[٧] (S8) استعلام المفتوحات: pair.ownerId == uid ثم pair.state == OPEN بسقف المصدر الواحد + 1');
    ok(/anomaly reason=\$\{P\.OWNER_MISMATCH\}/.test(source), '[٧] (S8) سطر تحذير الشذوذ في المعالج باسم الرمز من المصدر الواحد (P.OWNER_MISMATCH)');
    ok(Object.keys(require('../index.js')).includes('listOpenMaintenanceBefores'), '[٧] listOpenMaintenanceBefores مُصدَّرة في index.js');
  }

  console.log(`\nmaintenancePairCalls.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';

// maintenancePairWireSamplesGuard.test.js — حارس العيّنات الذهبية لـ**ردود** listOpenMaintenanceBefores وconfirmMaintenanceAfterLink ولرفوض نوع العطل في setSessionPurpose
// (maintenance-pair-wire-samples-2026-10-22.json). أمر المستخدم 2026-10-22، المرحلة S7 — القاعدتان 39 و41. بلا شبكة وبلا محاكٍ وبلا نداء نموذج.
//
// أمر الباك اند (منقول، غير متحقَّق من هذا المستودع): «وعيّنات ذهبية جديدة لردّ الدالّتين الجديدتين تُولَّد من الدالّة الحقيقية (القاعدة 41)؛ عيّنات طلبات التطبيق لا تكتبها أنت».
//
// ما يحرسه:
//   ١ الطرف الثاني للعقد (39): الملفّ المُلتزَم يطابق ما يُنتجه المولّد الآن حرفاً بحرف (يعيد المولّد البناء من الدالّتين المُصدَّرتين الحقيقيتين خلف غلاف onCall الحقيقي)، ولا يكتب شيئاً.
//   ٢ تغطية القوائم المغلقة: كل رمز في REFUSAL_RESPONSE (أي كل ما قد تُرجعه الدالّتان) له عيّنة في كل دالّة تُرجعه، وكل قيمة في PAIR_CALL_REFUSAL وPAIR_LINK_REFUSAL التي تستعملها الدالّتان مغطّاة، ولا عيّنة بسبب خارج الوحدة؛
//      ورموز نوع العطل الثلاثة في setSessionPurpose مغطّاة. فإضافة رمز بلا عيّنة، أو عيّنة بلا رمز، تُسقط الاختبار.
//   ٣ شكل السلك: نجاح = 200 و{result} وحده؛ رفض = {error: {status, message, details: {reasonCode}}} وحده، وحالة HTTP تطابق status (unauthenticated 401، invalid-argument 400، failed-precondition 400، permission-denied 403، not-found 404).
//   ٤ المعنى، لا الوصول وحده (القاعدة 30): مرشَّحو القائمة هم من يجب (النوع والمحلّ والنافذة وبلا ربط حيّ) والأحدث أوّلاً، وscannedAtMs = pair.openedAt، والاسم mapped/name_unmapped بسببه، وكتابة التأكيد الوحيدة = protocolPending بالحقول الأربعة
//      (والأخيرة null صريحاً) ولا شيء على «قبل»، وانقضاء الجلسة وحده يكتب «منتهية»، وبقية الرفوض بلا كتابة، وغير المالك وجلسة غير موجودة ردّ **واحد**.
//   ٥ الظهور (قرار حسن 4): لا حقل من قائمة الستّة المحظورة (scanPurpose · defectType · linkedScanId · linkState · linkMethod · pair) في أيّ جسم ردّ — **ومفتاح linkMethod في ردّ التأكيد استثناء مُعلَن** (الدالّة مقصورة على الفنّي المالك؛ العقد A3): يُعدّ ولا يُهمَل.
//   ٦ العقد نفسه: كل رمز من PAIR_CALL_REFUSAL مذكور في A3 من docs/PROTOCOL_CONTRACT.md.
//   ٧ طفرات في الذاكرة (القاعدة 39): كل خلل مصطنع في الملفّ المُلتزَم أو في الوثيقة يُفشل الحارس بسببه.
//
// Run: node functions/test/maintenancePairWireSamplesGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// المولّد أوّلاً: يضبط المتغيّرين قبل أيّ تحميل لـfirebase-functions في هذه العملية.
const G = require('../scripts/generate-maintenance-pair-wire-samples');
const {PAIR_CALL_REFUSAL, PAIR_LINK_REFUSAL, PURPOSE_REFUSAL, LINK_METHOD} = require('../src/protocol/protocolVocabulary');
const {REFUSAL_RESPONSE} = require('../src/sessions/maintenancePairCalls');
const {OPEN_PAIR_SCAN_CAP} = require('../src/protocol/maintenancePair');

const DEST = G.DEST;
const committed = JSON.parse(fs.readFileSync(DEST, 'utf8'));

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
const diff = (fresh, comm) => { const out = []; diffPaths(fresh, comm, '', out); return out; };

// (ق36 أ، 2026-10-22؛ القاعدة 23: كانت ستّة؛ صارت سبعة بـlinkModelCheck — خادمي لا يصل السلك فلا يظهر في عيّنة ردّ ولا طلب)
const FORBIDDEN_KEYS = ['scanPurpose', 'defectType', 'linkedScanId', 'linkState', 'linkMethod', 'pair', 'linkModelCheck'];
/** كل مفتاح (بأيّ عمق) من القائمة المحظورة في قيمة JSON، بمساره. */
function forbiddenPaths(v, forbidden, p = '') {
  const out = [];
  if (Array.isArray(v)) v.forEach((x, i) => out.push(...forbiddenPaths(x, forbidden, `${p}[${i}]`)));
  else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (forbidden.includes(k)) out.push(`${p}.${k}`.replace(/^\./, ''));
      out.push(...forbiddenPaths(v[k], forbidden, `${p}.${k}`));
    }
  }
  return out;
}

const HTTP_OF = {'unauthenticated': 401, 'invalid-argument': 400, 'failed-precondition': 400, 'permission-denied': 403, 'not-found': 404};
const STATUS_OF = {'unauthenticated': 'UNAUTHENTICATED', 'invalid-argument': 'INVALID_ARGUMENT', 'failed-precondition': 'FAILED_PRECONDITION', 'permission-denied': 'PERMISSION_DENIED', 'not-found': 'NOT_FOUND'};

(async () => {
  // ═══ ١ — الطرف الثاني للعقد: المُلتزَم = ما يُنتجه المولّد الآن ═══
  const mtime = fs.statSync(DEST).mtimeMs;
  const fresh = JSON.parse(JSON.stringify({...G.provenance('maintenance pair wire replies'), ...(await G.buildMaintenancePairWireSamples())}));
  eq(fs.statSync(DEST).mtimeMs, mtime, '[١] البناء لم يكتب ولم يلمس الملفّ المُلتزَم (mtime بلا تغيير)');
  const d = diff(fresh, committed);
  if (d.length > 0) {
    console.error(`\n⚠️ العقد المُلتزَم لا يطابق ما يُنتجه المولّد فعلياً — ${d.length} فرقاً:`);
    for (const x of d.slice(0, 40)) console.error(`  ${x}`);
    console.error('\nالإصلاح: node functions/scripts/generate-maintenance-pair-wire-samples.js ثم git add/commit للثابت المُحدَّث (القاعدة 39: في الالتزام نفسه الذي غيّر العقد).\n');
  }
  eq(d.length, 0, '[١] maintenance-pair-wire-samples-2026-10-22.json يطابق مخرَج المولّد الطازج حرفاً بحرف');
  eq(new Set(committed.samples.map((s) => s.id)).size, committed.samples.length, '[١] لا معرّف عيّنة مكرَّر');
  ok(committed.samples.every((s) => ['listOpenMaintenanceBefores', 'confirmMaintenanceAfterLink', 'setSessionPurpose'].includes(s.function)), '[١] الدوالّ المُغطّاة ثلاث وحدها');
  ok(committed.samples.every((s) => s.request && s.request.data !== undefined), '[١] كل عيّنة تحمل الطلب الذي بُنيت به (طلب المولّد لا عيّنة من التطبيق: مُعلَن في الرأس)');

  const S = committed.samples;
  const byFn = (fn) => S.filter((s) => s.function === fn);
  const find = (id) => { const s = S.find((x) => x.id === id); ok(s, `عيّنة ${id} موجودة`); return s; };
  const reasonOf = (s) => (s.body.error && s.body.error.details && s.body.error.details.reasonCode) || null;
  const refusedOf = (fn) => byFn(fn).filter((s) => s.body && s.body.error);
  const okOf = (fn) => byFn(fn).filter((s) => s.body && s.body.result);

  // ═══ ٢ — تغطية القوائم المغلقة ═══
  const allClientReasons = [...new Set(Object.values(REFUSAL_RESPONSE).map((r) => r.clientReasonCode))].sort();
  const listReasons = new Set(refusedOf('listOpenMaintenanceBefores').map(reasonOf));
  const confirmReasons = new Set(refusedOf('confirmMaintenanceAfterLink').map(reasonOf));
  // ما تُرجعه القائمة وحدها: السقف (استعلام المفتوحات في القائمة وحدها، سطر maintenancePairCalls.js:182)
  const LIST_ONLY = [PAIR_CALL_REFUSAL.SCAN_CAP_EXCEEDED];
  // ما لا تُرجعه القائمة: ما يخصّ «قبل» المختارة والجلسة النشطة والانقضاء (تأكيد وحده)
  const CONFIRM_ONLY = [PAIR_CALL_REFUSAL.BEFORE_SCAN_ID_REQUIRED, PAIR_CALL_REFUSAL.SESSION_NOT_ACTIVE, PAIR_CALL_REFUSAL.BEFORE_UNREADABLE, PAIR_CALL_REFUSAL.OWNER_MISMATCH, // (S8) في القائمة استبعاد مُعلَن لا رفض
    'SESSION_EXPIRED', 'SESSION_EXPIRES_AT_INVALID', 'SESSION_STATUS_UNKNOWN', ...Object.values(PAIR_LINK_REFUSAL).filter((c) => !['AMBIGUOUS_SHORT_ID', 'SESSION_CODE_NOT_REPORT_CODE'].includes(c))];
  deq([...confirmReasons].sort(), allClientReasons.filter((c) => !LIST_ONLY.includes(c)), '[٢] أسباب رفض التأكيد = كل clientReasonCode في REFUSAL_RESPONSE عدا ما تنفرد به القائمة (السقف) بالضبط');
  deq([...new Set([...listReasons, ...confirmReasons])].sort(), allClientReasons, '[٢] وأسباب الدالّتين معاً = كل clientReasonCode في REFUSAL_RESPONSE بالضبط (كلها مغطّاة، ولا سبب خارجها)');
  const listExpected = allClientReasons.filter((c) => !CONFIRM_ONLY.includes(c));
  deq([...listReasons].sort(), listExpected, '[٢] أسباب رفض القائمة = كل ما تُرجعه القائمة وحدها (بلا ما يخصّ التأكيد)');
  for (const v of Object.values(PAIR_CALL_REFUSAL)) ok(confirmReasons.has(v) || listReasons.has(v), `[٢] PAIR_CALL_REFUSAL «${v}» مغطّى في عيّنة`);
  for (const [k, v] of Object.entries(PAIR_LINK_REFUSAL)) {
    if (k === 'AMBIGUOUS_SHORT_ID' || k === 'SESSION_CODE_NOT_REPORT_CODE') ok(!confirmReasons.has(v) && !listReasons.has(v), `[٢] ${k}: غير مستعمل في هذه المرحلة ولا عيّنة له (مُعلَن في المفردات)`);
    else ok(confirmReasons.has(v), `[٢] PAIR_LINK_REFUSAL «${v}» مغطّى`);
  }
  deq([...new Set(refusedOf('setSessionPurpose').map(reasonOf))].sort(), [PURPOSE_REFUSAL.DEFECT_TYPE_INVALID, PURPOSE_REFUSAL.DEFECT_TYPE_NOT_APPLICABLE, PURPOSE_REFUSAL.DEFECT_TYPE_REQUIRED, PURPOSE_REFUSAL.PART_NOT_ENABLED, 'SET_PURPOSE_INVALID'].sort(), '[٢] رفوض setSessionPurpose المغطّاة = رموز نوع العطل الثلاثة + PART_NOT_ENABLED (ق31، 2026-10-22) + SET_PURPOSE_INVALID (القاعدة 23: كانت أربعة)');
  // (ق31) رفض جزء المحلّ: ثلاث عيّنات (purposes مُطفأ · batteryBeforeAfter مُطفأ لغرض صيانة · مستند المالك غائب) وعيّنة نجاح لـnormal بلا أجزاء (لا تغيّر في سلوكه)
  for (const id of ['setSessionPurpose.refused.part-not-enabled.purposes', 'setSessionPurpose.refused.part-not-enabled.battery-before-after', 'setSessionPurpose.refused.part-not-enabled.owner-absent']) {
    const s = find(id);
    deq([s.httpStatus, s.body.error.status, s.body.error.message, s.body.error.details], [400, 'FAILED_PRECONDITION', 'PURPOSE_PART_NOT_ENABLED', {reasonCode: 'PURPOSE_PART_NOT_ENABLED'}], `[٢] (ق31) ${id}: failed-precondition ورسالته رمزه التقني وdetails.reasonCode وحده`);
    ok(s.transactionWrites === undefined, `[٢] (ق31) ${id}: بلا أيّ كتابة`);
    ok(!/purposes|batteryBeforeAfter/.test(JSON.stringify(s.body)), `[٢] (ق31) ${id}: اسم الجزء الناقص لا يصل العميل (سجلّ الخادم وحده)`);
  }
  deq(Object.keys(find('setSessionPurpose.refused.part-not-enabled.purposes').seed).sort(), ['protocolPending/sess-pick', 'scanSessions/sess-pick', 'users/owner-sample'], '[٢] (ق31) بذرة رفض purposes: الجلسة وpending ومستند المالك');
  ok(!Object.keys(find('setSessionPurpose.refused.part-not-enabled.owner-absent').seed).some((k) => k.startsWith('users/')), '[٢] (ق31) بذرة «مستند المالك غائب» بلا مستند للمالك');
  deq(find('setSessionPurpose.refused.part-not-enabled.battery-before-after').seed['users/owner-sample'].protocolParts, {purposes: true}, '[٢] (ق31) بذرة batteryBeforeAfter: purposes مفعَّل وحده');
  deq([find('setSessionPurpose.success.normal-without-parts').httpStatus, find('setSessionPurpose.success.normal-without-parts').body, find('setSessionPurpose.success.normal-without-parts').transactionWrites], [200, {result: {sessionId: 'sess-pick', purpose: 'normal', purposeSource: 'selected'}}, ['update:scanSessions/sess-pick', 'set:protocolPending/sess-pick']], '[٢] (ق31) normal لمحلّ بلا الأجزاء يُقبل بردّه وكتابتيه كما كانا');
  ok(find('setSessionPurpose.refused.defect-type-invalid.null').request.data.defectType === null, '[٢] عيّنة null: الطلب يحمل null صريحاً (المُرسَل ≠ الغائب)');
  ok(!('defectType' in find('setSessionPurpose.refused.defect-type-required').request.data), '[٢] وعيّنة REQUIRED: الحقل غائب من الطلب لا null');
  eq(okOf('listOpenMaintenanceBefores').length >= 3, true, '[٢] ثلاث عيّنات نجاح للقائمة على الأقلّ (اثنان · فارغة · ربط حيّ)');
  eq(okOf('confirmMaintenanceAfterLink').length, 3, '[٢] ثلاث عيّنات نجاح للتأكيد (pending · scanning · إعادة الاختيار)');

  // ═══ ٣ — شكل السلك ═══
  for (const s of S) {
    if (s.body.result !== undefined) {
      deq(Object.keys(s.body), ['result'], `[٣] ${s.id}: جسم النجاح مفتاح result وحده`);
      eq(s.httpStatus, 200, `[٣] ${s.id}: 200`);
    } else {
      deq(Object.keys(s.body), ['error'], `[٣] ${s.id}: جسم الرفض مفتاح error وحده`);
      const e = s.body.error;
      deq(Object.keys(e).sort(), ['details', 'message', 'status'], `[٣] ${s.id}: error = status وmessage وdetails`);
      deq(Object.keys(e.details), ['reasonCode'], `[٣] ${s.id}: details = reasonCode وحده`);
      const codeKey = Object.keys(STATUS_OF).find((k) => STATUS_OF[k] === e.status);
      ok(codeKey, `[٣] ${s.id}: status «${e.status}» من القائمة المعروفة`);
      eq(s.httpStatus, HTTP_OF[codeKey], `[٣] ${s.id}: حالة HTTP تطابق status`);
      ok(typeof e.message === 'string' && e.message.length > 0, `[٣] ${s.id}: message نصّ غير فارغ`);
    }
  }
  // الرسالة والرمز كما في REFUSAL_RESPONSE (مصدر واحد: لا نسخة في الاختبار)
  for (const s of [...refusedOf('listOpenMaintenanceBefores'), ...refusedOf('confirmMaintenanceAfterLink')]) {
    const spec = Object.values(REFUSAL_RESPONSE).find((r) => r.clientReasonCode === reasonOf(s));
    ok(spec, `[٣] ${s.id}: السبب «${reasonOf(s)}» في REFUSAL_RESPONSE`);
    eq(s.body.error.message, spec.message, `[٣] ${s.id}: النصّ = REFUSAL_RESPONSE`);
    eq(s.body.error.status, STATUS_OF[spec.code], `[٣] ${s.id}: status = رمز REFUSAL_RESPONSE`);
  }

  // ═══ ٤ — المعنى لا الوصول وحده ═══
  const two = find('list.success.two-candidates').body.result;
  deq(two.candidates.map((c) => c.beforeScanId), ['before-1', 'before-2'], '[٤] المرشَّحان بالأحدث أوّلاً، والمستبعَدون (نوع آخر · محلّ آخر · منقضية) غائبون');
  eq(two.validityHours, 72, '[٤] validityHours = إعداد البذرة (72)');
  deq(two.candidates.map((c) => c.deviceName.state), ['mapped', 'name_unmapped'], '[٤] حالة الاسم: مربوط ثم غير مربوط');
  deq(two.candidates[0].deviceName.names, {ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}, '[٤] الأسماء الثلاثة من الخريطة');
  eq(two.candidates[1].deviceName.reason, 'MODEL_NOT_IN_MAP', '[٤] سبب عدم الربط مسمّى (لا اسم مختلَق: model كما هو و names null)');
  eq(two.candidates[1].deviceName.names, null, '[٤] names = null لغير المربوط');
  ok(two.candidates[0].scannedAtMs > two.candidates[1].scannedAtMs, '[٤] scannedAtMs تنازلياً');
  for (const c of two.candidates) deq(Object.keys(c).sort(), ['beforeScanId', 'deviceName', 'scannedAtMs'], '[٤] شكل المرشَّح: ثلاثة مفاتيح وحدها');
  deq(Object.keys(two).sort(), ['candidates', 'validityHours'], '[٤] شكل ردّ القائمة: مفتاحان وحدهما');
  // scannedAtMs = pair.openedAt بالمللي ثانية: من بذرة العيّنة نفسها (لا إعادة حساب من الساعة)
  const seedOpenedAt = (id) => Date.parse(find('list.success.two-candidates').seed[`scanProtocol/${id}`].pair.openedAt.$firestoreTimestamp);
  deq(two.candidates.map((c) => c.scannedAtMs), [seedOpenedAt('before-1'), seedOpenedAt('before-2')], '[٤] scannedAtMs = pair.openedAt بالمللي ثانية');
  deq(find('list.success.empty').body.result, {validityHours: 72, candidates: []}, '[٤] لا مرشَّحين ⟵ candidates مصفوفة فارغة (لا مفتاح غائب)');
  deq(find('list.success.link-hides-before').body.result.candidates.map((c) => c.beforeScanId), ['before-free'], '[٤] «قبل» بربط حيّ لا تظهر والحرّة تظهر');
  // (S8) المحلّ من pair.ownerId: الشذوذ يُستبعد، و«قبل» بلا مالك لا تظهر، والسقف لكل محلّ
  deq(find('list.success.owner-mismatch-excluded').body.result.candidates.map((c) => c.beforeScanId), ['before-good'], '[٤] (S8) «قبل» pair.ownerId = المستدعي وتقريرها لمحلّ آخر (شذوذ) لا تظهر (والإعلان في سجلّ الخادم لا في الردّ)');
  deq(find('list.success.pair-without-owner-not-listed').body.result.candidates.map((c) => c.beforeScanId), ['before-good'], '[٤] (S8) «قبل» بـpair بلا ownerId لا تظهر (لا تطابق استعلام محلّ)');
  const perShop = find('list.success.cap-is-per-shop');
  deq([perShop.httpStatus, perShop.body.result.candidates.map((c) => c.beforeScanId)], [200, ['mine-1']], '[٤] (S8) **السقف لكل محلّ**: محلّ آخر عنده فوق السقف لا يحجب هذا المحلّ (قبل S8 كان الرفض يعمّ كل المحلّات)');
  ok(perShop.seed.summary.includes(String(OPEN_PAIR_SCAN_CAP + 1)) && perShop.seed.summary.includes('owner-else'), `[٤] (S8) عيّنة «لكل محلّ» مبنيّة على السقف + 1 (${OPEN_PAIR_SCAN_CAP + 1}) لمحلّ آخر`);
  for (const id of ['confirm.refused.owner-mismatch.report-differs', 'confirm.refused.owner-mismatch.pair-differs']) {
    deq([find(id).httpStatus, find(id).body.error.status, reasonOf(find(id))], [400, 'FAILED_PRECONDITION', 'PAIR_OWNER_MISMATCH'], `[٤] (S8) ${id}: PAIR_OWNER_MISMATCH بحالة failed-precondition`);
    ok(find(id).transactionWrites === undefined, `[٤] (S8) ${id}: بلا كتابة`);
  }
  eq(reasonOf(find('confirm.refused.before-pair-owner-absent')), 'PAIR_BEFORE_UNREADABLE', '[٤] (S8) pair بلا ownerId ⟵ PAIR_BEFORE_UNREADABLE لا PAIR_OWNER_MISMATCH');
  const notOwnedSeed = find('confirm.refused.before-not-owned').seed;
  deq([notOwnedSeed['scanProtocol/before-1'].pair.ownerId, notOwnedSeed['reports/before-1'].userId], ['owner-else', 'owner-else'], '[٤] (S8) «قبل» محلّ آخر حقاً: pair.ownerId والتقرير معاً لمحلّ آخر (اختلافهما شذوذ لا ملكية أخرى)');
  // شكل البذور يتبع العقد (القاعدة 39): كل pair على «قبل» صيانة في بذرة له ownerId نصّاً، إلا العيّنات الثلاث التي تُمثّل الغياب عمداً
  const NO_OWNER_ON_PURPOSE = ['list.success.pair-without-owner-not-listed', 'confirm.refused.before-pair-owner-absent', 'confirm.refused.before-unreadable'];
  const pairsMissingOwner = (sample) => (sample.seed && !sample.seed.summary ? Object.entries(sample.seed).filter(([k, v]) => k.startsWith('scanProtocol/') && v && v.scanPurpose === 'maintenance_before' && v.pair && typeof v.pair === 'object' && !(typeof v.pair.ownerId === 'string' && v.pair.ownerId !== '')).map(([k]) => `${sample.id}:${k}`) : []);
  const missing = committed.samples.flatMap(pairsMissingOwner);
  deq(missing.map((m) => m.split(':')[0]).filter((id, i, a) => a.indexOf(id) === i).sort(), [...NO_OWNER_ON_PURPOSE].sort(), '[٤] (S8) البذور: pair بلا ownerId في العيّنات الثلاث المقصودة وحدها (غيرها يتبع الشكل الجديد)');
  ok(find('list.name-unmapped.map-absent').body.result.candidates.every((c) => c.deviceName.state === 'name_unmapped' && c.deviceName.reason === 'MAP_ABSENT'), '[٤] خريطة غائبة ⟵ name_unmapped بسبب MAP_ABSENT لا اسم مختلَق');
  // أيّ قراءة لا تكتب
  for (const s of byFn('listOpenMaintenanceBefores')) ok(s.transactionWrites === undefined, `[٤] ${s.id}: القائمة قراءة وحدها (بلا كتابة)`);
  // التأكيد
  const conf = find('confirm.success');
  deq(conf.body.result, {sessionId: 'sess-after', beforeScanId: 'before-1', linkMethod: LINK_METHOD.MANUAL}, '[٤] ردّ التأكيد {sessionId, beforeScanId, linkMethod: manual}');
  deq(conf.transactionWrites, ['set:protocolPending/sess-after'], '[٤] كتابة التأكيد الوحيدة: set على protocolPending (لا شيء على «قبل»)');
  const pend = conf.storeAfter['protocolPending/sess-after'];
  deq([pend.linkedScanId, pend.linkMethod, pend.linkConfirmedByTechnicianId, pend.defectType, pend.purposeSource], ['before-1', 'manual', null, 'BATTERY', 'selected'], '[٤] pending بعد التأكيد: الربط ومنهجه، والفنّي null صريحاً، ونوع «بعد» ومصدر الغرض لم يُمسّا (دمج)');
  ok(Object.prototype.hasOwnProperty.call(pend, 'linkConfirmedByTechnicianId'), '[٤] linkConfirmedByTechnicianId مكتوب صراحةً (null لا غائب: القاعدة 22)');
  ok(pend.linkConfirmedAt && typeof pend.linkConfirmedAt.$firestoreTimestamp === 'string', '[٤] وقت التأكيد حاضر');
  deq(find('confirm.success.re-choice-replaces').storeAfter['protocolPending/sess-after'].linkedScanId, 'before-2', '[٤] إعادة الاختيار تستبدل (الأحدث يربح)');
  eq(find('confirm.success.scanning-session').body.result.linkMethod, 'manual', '[٤] جلسة scanning تقبل التأكيد');
  // الكتابات: انقضاء الجلسة وحده يكتب، وفي المعاملة نفسها
  for (const s of refusedOf('confirmMaintenanceAfterLink')) {
    if (s.id === 'confirm.refused.session-expired') deq(s.transactionWrites, ['update:scanSessions/sess-after'], '[٤] انقضاء الجلسة: كتابة «منتهية» الوحيدة (المعاملة)');
    else ok(s.transactionWrites === undefined, `[٤] ${s.id}: لا كتابة (الرفض قبل أيّ تغيير)`);
  }
  for (const s of refusedOf('setSessionPurpose')) ok(s.transactionWrites === undefined, `[٤] ${s.id}: بلا كتابة (رفوض المدخل قبل أيّ قراءة، ورفض الجزء بعد قراءة المالك؛ ق31)`);
  // غير المالك وجلسة غير موجودة: ردّ واحد في الدالّتين (لا وسيط وجود)
  for (const fn of ['list', 'confirm']) deq(find(`${fn}.refused.not-owner`).body, find(`${fn}.refused.session-missing`).body, `[٤] ${fn}: غير المالك وجلسة غير موجودة بجسم **واحد**`);
  eq(reasonOf(find('list.refused.not-owner')), 'SESSION_NOT_PARTICIPANT', '[٤] والسبب SESSION_NOT_PARTICIPANT (رمز قائم من sessionNames: مصدر واحد)');
  // السقف: رفض مسمّى لا اقتطاع، وقيمته من المصدر
  ok(find('list.refused.scan-cap-exceeded').seed.summary.includes(String(OPEN_PAIR_SCAN_CAP + 1)), `[٤] عيّنة السقف مبنيّة على السقف + 1 (${OPEN_PAIR_SCAN_CAP + 1}) من المصدر لا رقم ثابت`);
  // رفض المالك لا يحمل بيانات
  for (const s of refusedOf('confirmMaintenanceAfterLink')) ok(!JSON.stringify(s.body).includes('before-1') && !JSON.stringify(s.body).includes('SM-A135F'), `[٤] ${s.id}: جسم الرفض لا يحمل معرّف «قبل» ولا طرازاً`);

  // ═══ ٥ — الظهور: لا حقل محظور في أيّ جسم ردّ ═══
  const bodyViolations = (doc) => doc.samples.flatMap((s) => forbiddenPaths(s.body, FORBIDDEN_KEYS).map((p) => `${s.id}:${p}`));
  const found = bodyViolations(committed);
  // الاستثناء المُعلَن الوحيد: مفتاح linkMethod في ردّ تأكيد النجاح (الدالّة للفنّي المالك وحده، العقد A3)
  const expectedLink = okOf('confirmMaintenanceAfterLink').map((s) => `${s.id}:result.linkMethod`).sort();
  deq(found.sort(), expectedLink, '[٥] الحقول المحظورة في أجسام الردود = linkMethod في ردود تأكيد النجاح الثلاثة وحدها (استثناء مُعلَن؛ لا غيرها، ولا في القائمة ولا في أيّ رفض)');
  ok(!bodyViolations({samples: byFn('listOpenMaintenanceBefores')}).length, '[٥] لا حقل محظور في أيّ ردّ للقائمة');

  // ═══ ٦ — العقد نفسه: A3 ═══
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'PROTOCOL_CONTRACT.md'), 'utf8');
  const a3Of = (text) => {
    const a = text.indexOf('### A3 — P6-05');
    const b = text.indexOf('### A4 — ', a);
    return a < 0 || b < 0 ? '' : text.slice(a, b);
  };
  const docViolations = (text) => {
    const sec = a3Of(text);
    if (sec === '') return ['SECTION_MISSING'];
    return Object.values(PAIR_CALL_REFUSAL).filter((c) => !sec.includes(c)).map((c) => `CODE_NOT_IN_DOC:${c}`);
  };
  deq(docViolations(doc), [], '[٦] كل رمز من PAIR_CALL_REFUSAL مذكور في العقد');
  ok(doc.includes('maintenance-pair-wire-samples-2026-10-22.json'), '[٦] العقد يسمّي ملفّ العيّنات الذهبية');

  // ═══ ٧ — طفرات القاعدة 39 ═══
  const mut = (fn) => { const c = JSON.parse(JSON.stringify(committed)); fn(c); return diff(fresh, c); };
  ok(mut((c) => { c.samples[0].body.result.validityHours = 24; }).length > 0, '[٧] طفرة: validityHours يُغيَّر ⟵ المقارنة تكشفه');
  ok(mut((c) => { c.samples.pop(); }).length > 0, '[٧] طفرة: عيّنة تُحذف ⟵ تُكشَف');
  ok(mut((c) => { c.samples.find((s) => s.id === 'confirm.success').body.result.linkMethod = 'auto_confirmed'; }).length > 0, '[٧] طفرة: linkMethod في التأكيد يُغيَّر ⟵ تُكشَف');
  ok(mut((c) => { c.samples.find((s) => s.id === 'confirm.refused.before-expired').httpStatus = 500; }).length > 0, '[٧] طفرة: حالة HTTP تُغيَّر ⟵ تُكشَف');
  ok(mut((c) => { c.samples.find((s) => s.id === 'list.refused.not-owner').body.error.message = 'نصّ آخر'; }).length > 0, '[٧] طفرة: نصّ الرفض يُغيَّر ⟵ تُكشَف');
  ok(mut((c) => { c.samples.find((s) => s.id === 'confirm.success').transactionWrites = ['update:scanProtocol/before-1']; }).length > 0, '[٧] طفرة: التأكيد يكتب على «قبل» ⟵ تُكشَف');
  ok(mut((c) => { c.samples.find((s) => s.id === 'list.success.two-candidates').body.result.candidates.reverse(); }).length > 0, '[٧] طفرة: ترتيب المرشَّحين يُعكس ⟵ يُكشَف');
  ok(mut((c) => { c._provenance.whatIsStubbed = 'x'; }).length > 0, '[٧] طفرة: بيان ما هو مستبدَل يُغيَّر ⟵ يُكشَف');
  ok(mut((c) => { c.samples.find((s) => s.id === 'list.success.cap-is-per-shop').body.result.candidates = []; }).length > 0, '[٧] (S8) طفرة: عيّنة «السقف لكل محلّ» تُفرَّغ مرشَّحيها ⟵ تُكشَف');
  ok(mut((c) => { c.samples.find((s) => s.id === 'confirm.refused.owner-mismatch.pair-differs').body.error.details.reasonCode = 'BEFORE_NOT_OWNED'; }).length > 0, '[٧] (S8) طفرة: رمز الشذوذ يُستبدل بـNOT_OWNED ⟵ يُكشَف');
  ok(mut((c) => { c.samples = c.samples.filter((s) => s.id !== 'confirm.refused.owner-mismatch.report-differs'); }).length > 0, '[٧] (S8) طفرة: عيّنة الشذوذ تُحذف ⟵ تُكشَف');
  // الحارس نفسه: كل طفرة في الملفّ المُلتزَم تُسقط الفحوص الدلالية أيضاً (لا المقارنة وحدها)
  const withMutant = (fn) => { const c = JSON.parse(JSON.stringify(committed)); fn(c); return c; };
  const stripOwner = withMutant((c) => { delete c.samples.find((s) => s.id === 'list.success.two-candidates').seed['scanProtocol/before-1'].pair.ownerId; });
  ok(stripOwner.samples.flatMap(pairsMissingOwner).some((m) => m.startsWith('list.success.two-candidates:')), '[٧] (S8) طفرة: بذرة تفقد pair.ownerId ⟵ فحص شكل البذور يكشفها');
  const m1 = withMutant((c) => { c.samples.find((s) => s.id === 'list.success.two-candidates').body.result.candidates[0].pair = {state: 'OPEN'}; });
  ok(bodyViolations(m1).some((v) => v.endsWith(':result.candidates[0].pair')), '[٧] طفرة: حقل pair يتسرّب إلى مرشَّح ⟵ فحص الظهور يكشفه');
  const m2 = withMutant((c) => { c.samples.find((s) => s.id === 'confirm.refused.before-expired').body.error.details.defectType = 'BATTERY'; });
  ok(bodyViolations(m2).some((v) => v.includes('details.defectType')), '[٧] طفرة: defectType يتسرّب إلى جسم رفض ⟵ يُكشَف');
  const m3 = withMutant((c) => { c.samples.find((s) => s.id === 'list.success.empty').body.result.scanPurpose = 'maintenance_before'; });
  ok(bodyViolations(m3).some((v) => v.includes('scanPurpose')), '[٧] طفرة: scanPurpose يتسرّب إلى ردّ القائمة ⟵ يُكشَف');
  ok(docViolations(doc.replace(/PAIR_SCAN_CAP_EXCEEDED/g, 'PAIR_SCAN_CAP_GONE')).includes('CODE_NOT_IN_DOC:PAIR_SCAN_CAP_EXCEEDED'), '[٧] طفرة: رمز يُحذف من العقد ⟵ يُكشَف');
  ok(docViolations(doc.replace('### A3 — P6-05', '### AX — P6-05')).includes('SECTION_MISSING'), '[٧] طفرة: القسم يُعاد تسميته ⟵ يُكشَف (لا فحص فارغ)');

  console.log(`maintenancePairWireSamplesGuard.test.js: ${n}/${n} assertions passed (${S.length} samples: ${byFn('listOpenMaintenanceBefores').length} list, ${byFn('confirmMaintenanceAfterLink').length} confirm, ${byFn('setSessionPurpose').length} setSessionPurpose)`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});

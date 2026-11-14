'use strict';

// marketingNames.test.js — خريطة الأسماء التجارية بالعربية: التحقّق والدمج والقراءة والحلّ وحرّاس بنية setMarketingNames/getMarketingNames (S-P6-20، 2026-10-21 +03).
// وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المحاكي في marketingNames.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٥-أ-١ (:1527-1536) وdocs/PROTOCOL_CONTRACT.md §٢ A12: «مصدر واحد في الخادم بالعربية والتركية والإنجليزية، من بيانات يحرّرها المشرف. وخريطة التطبيق تبقى للعرض دون شبكة،
// ويُختبر تطابقها مع مصدر الخادم بعيّنة ذهبية. والطراز غير الموجود يُعرض `Build.MODEL` كما هو، موسوماً `name_unmapped`.» وE14: `marketingNames/current` بـ`version` و`entries[] {model, ar, tr, en}` + `history/{version}`.
//   ١ validateEntriesPatch: المفاتيح الأربعة إلزامية · الحدود · التكرار · كل سبب رفض
//   ٢ readMarketingNamesDocument: حاضر · غائب · تالف بسببه
//   ٣ mergeEntries: تحديث بالطراز وإلحاق، بلا حذف ولا إعادة ترتيب، والسقف
//   ٤ resolveMarketingName: mapped وname_unmapped بأسبابها الأربعة (الغياب حالة صريحة)
//   ٥ ردود الرفض وحرّاس البنية: موضع رمي واحد · tx.create للنسخة السابقة · لا حذف · لا استعلام · لا اسم ولا طراز في السجلّ
//
// Run: node functions/test/marketingNames.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const M = require('../src/protocol/marketingNames');
const A = require('../src/admin/marketingNamesAdmin');
const V = require('../src/protocol/protocolVocabulary');
const {hashIdForLog} = require('../src/utils/logRedaction');
const R = M.MARKETING_NAMES_REFUSAL;
const L = M.MARKETING_NAMES_LIMITS;

// بيانات اختبار وهمية موسومة (لا أسماء حقيقية: الخريطة يدخلها المشرف)
const E = (model, over = {}) => ({model, ar: `FAKE-AR-${model}`, tr: `FAKE-TR-${model}`, en: `FAKE-EN-${model}`, ...over});
const val = (entries) => M.validateEntriesPatch(entries);
const bad = (entries) => { const r = val(entries); return r.ok ? null : [r.refusal, r.extra]; };

// ═══ ١ — validateEntriesPatch ═══
deq(val([E('FAKE-M1')]), {ok: true, entries: [E('FAKE-M1')]}, '[١] مدخل صحيح بمفاتيحه الأربعة');
deq(val([E('FAKE-M1'), E('FAKE-M2')]).entries.map((e) => e.model), ['FAKE-M1', 'FAKE-M2'], '[١] مدخلان بترتيبهما');
deq(val([E('FAKE-M1', {ar: '  اسم  ', tr: ' x ', en: ' y '})]).entries[0], {model: 'FAKE-M1', ar: 'اسم', tr: 'x', en: 'y'}, '[١] الأسماء الثلاثة تُشذَّب، والطراز كما هو');
deq(val([E('FAKE/M 1')]).entries[0].model, 'FAKE/M 1', '[١] طراز يحمل `/` ومسافة داخلية مقبول (لذلك مصفوفة لا معرّف مستند: E14)');
deq(val([E('SM-S908B/DS')]).ok, true, '[١] `/` في الطراز مقبولة');
for (const e of [undefined, null, {}, 'x', 5, []]) deq(bad(e), [R.ENTRIES_REQUIRED, ''], `[١] entries ${JSON.stringify(e)} ⟵ ENTRIES_REQUIRED (غائبة أو ليست مصفوفة أو فارغة)`);
deq(bad(new Array(L.maxEntries + 1).fill(0).map((_, i) => E(`FAKE-${i}`))), [R.TOO_MANY_ENTRIES, ` count=${L.maxEntries + 1}`], `[١] فوق ${L.maxEntries} في نداء واحد ⟵ TOO_MANY_ENTRIES`);
eq(val(new Array(L.maxEntries).fill(0).map((_, i) => E(`FAKE-${i}`))).ok, true, `[١] ${L.maxEntries} بالضبط مقبولة`);
for (const [label, entry, cause] of [
  ['ليس كائناً', 'x', 'ENTRY_NOT_AN_OBJECT'], ['مصفوفة', [1], 'ENTRY_NOT_AN_OBJECT'], ['null', null, 'ENTRY_NOT_AN_OBJECT'],
  ['مفتاح زائد', {...E('FAKE-1'), note: 'x'}, 'ENTRY_UNKNOWN_KEY'], ['مفتاح active (غير معتمد في E14)', {...E('FAKE-1'), active: true}, 'ENTRY_UNKNOWN_KEY'],
  ['model غائب', {ar: 'a', tr: 'b', en: 'c'}, 'MODEL_MISSING'], ['ar غائب', {model: 'FAKE-1', tr: 'b', en: 'c'}, 'AR_MISSING'], ['tr غائب', {model: 'FAKE-1', ar: 'a', en: 'c'}, 'TR_MISSING'], ['en غائب', {model: 'FAKE-1', ar: 'a', tr: 'b'}, 'EN_MISSING'],
  ['tr null', {...E('FAKE-1'), tr: null}, 'TR_MISSING'],
  ['model فارغ', {...E('FAKE-1'), model: ''}, 'MODEL_INVALID'], ['model رقم', {...E('FAKE-1'), model: 5}, 'MODEL_INVALID'], ['model بمسافة في أوّله', {...E('FAKE-1'), model: ' FAKE-1'}, 'MODEL_NOT_TRIMMED'],
  ['model بمسافة في آخره', {...E('FAKE-1'), model: 'FAKE-1 '}, 'MODEL_NOT_TRIMMED'], ['model بمحرف تحكّم', {...E('FAKE-1'), model: 'FAKE\n1'}, 'MODEL_INVALID'], ['model أطول من الحدّ', {...E('FAKE-1'), model: 'x'.repeat(L.modelMaxLength + 1)}, 'MODEL_INVALID'],
  ['ar فارغ بعد التشذيب', {...E('FAKE-1'), ar: '   '}, 'AR_INVALID'], ['ar رقم', {...E('FAKE-1'), ar: 5}, 'AR_INVALID'], ['tr أطول من الحدّ', {...E('FAKE-1'), tr: 'x'.repeat(L.nameMaxLength + 1)}, 'TR_INVALID'],
  ['en بمحرف تحكّم', {...E('FAKE-1'), en: 'a\tb'}, 'EN_INVALID'],
]) {
  deq(bad([E('FAKE-0'), entry]), [R.ENTRY_INVALID, ` index=1 cause=${cause}`], `[١] مدخل ${label} ⟵ ENTRY_INVALID بسببه ${cause} وفهرسه (لا القيمة)`);
}
eq(val([E('x'.repeat(L.modelMaxLength))]).ok, true, '[١] طراز بالحدّ بالضبط مقبول');
eq(val([E('FAKE-1', {ar: 'ع'.repeat(L.nameMaxLength)})]).ok, true, '[١] واسم بالحدّ بالضبط مقبول');
deq(bad([E('FAKE-1'), E('FAKE-2'), E('FAKE-1', {ar: 'آخر'})]), [R.DUPLICATE_MODEL, ' index=2'], '[١] طراز مكرَّر في المرسَل ⟵ DUPLICATE_MODEL (لا يُختار أحدهما صامتاً)');
eq(val([E('FAKE-A'), E('fake-a')]).ok, true, '[١] المطابقة حساسة لحالة الأحرف: FAKE-A وfake-a طرازان (حرفيّة: لا تطبيع)');
deq([...M.MARKETING_ENTRY_KEYS], ['model', 'ar', 'tr', 'en'], '[١] model · ar · tr · en (E14)');
deq(L, {maxEntries: 1000, modelMaxLength: 64, nameMaxLength: 120}, '[١] الحدود (تقنية، من اختياري: لا أرقام في التصميم)');
ok(Object.isFrozen(L) && Object.isFrozen(M.MARKETING_ENTRY_KEYS) && Object.isFrozen(R), '[١] الحدود والمفاتيح والرموز مجمَّدة');

// ═══ ٢ — readMarketingNamesDocument ═══
const DOC = (over = {}) => ({version: 3, entries: [E('FAKE-1'), E('FAKE-2')], updatedAt: {toMillis: () => 1}, updatedBy: '#abc', ...over});
deq(M.readMarketingNamesDocument(null), {state: 'ABSENT', anomaly: null, version: null, entries: []}, '[٢] مستند غائب ⟵ ABSENT');
deq(M.readMarketingNamesDocument(undefined), {state: 'ABSENT', anomaly: null, version: null, entries: []}, '[٢] undefined ⟵ ABSENT');
{
  const r = M.readMarketingNamesDocument(DOC());
  deq([r.state, r.anomaly, r.version, r.entries], ['PRESENT', null, 3, [E('FAKE-1'), E('FAKE-2')]], '[٢] مستند صحيح ⟵ PRESENT بنسخته ومداخله');
  ok(r.entries[0] !== DOC().entries[0], '[٢] المداخل المقروءة نسخ');
  eq(M.readMarketingNamesDocument(DOC({entries: []})).state, 'PRESENT', '[٢] قائمة فارغة بنسخة صحيحة ⟵ PRESENT (موجودة وفارغة لا غائبة)');
}
for (const [label, d, anomaly] of [
  ['ليس كائناً', 'x', 'DOCUMENT_NOT_AN_OBJECT'], ['مصفوفة', [], 'DOCUMENT_NOT_AN_OBJECT'],
  ['version غائبة', DOC({version: undefined}), 'VERSION_UNUSABLE'], ['version صفر', DOC({version: 0}), 'VERSION_UNUSABLE'], ['version كسر', DOC({version: 1.5}), 'VERSION_UNUSABLE'], ['version نصّ', DOC({version: '3'}), 'VERSION_UNUSABLE'],
  ['entries غائبة', DOC({entries: undefined}), 'ENTRIES_NOT_AN_ARRAY'], ['entries كائن', DOC({entries: {}}), 'ENTRIES_NOT_AN_ARRAY'],
  ['مدخل ليس كائناً', DOC({entries: ['x']}), 'ENTRY_UNUSABLE'], ['مدخل بلا tr', DOC({entries: [{model: 'a', ar: 'b', en: 'c'}]}), 'ENTRY_UNUSABLE'], ['مدخل بـen فارغ', DOC({entries: [E('FAKE-1', {en: ''})]}), 'ENTRY_UNUSABLE'],
  ['طراز مكرَّر', DOC({entries: [E('FAKE-1'), E('FAKE-1', {ar: 'x'})]}), 'DUPLICATE_MODEL'],
]) {
  deq(M.readMarketingNamesDocument(d), {state: 'UNREADABLE', anomaly, version: null, entries: []}, `[٢] مستند ${label} ⟵ UNREADABLE بسببه ${anomaly} (لا يُقرأ غائباً ولا يُخمَّن)`);
}
deq(Object.values(M.MARKETING_NAMES_STATE).sort(), ['ABSENT', 'PRESENT', 'UNREADABLE'], '[٢] الحالات الثلاث');

// ═══ ٣ — mergeEntries ═══
{
  const cur = [E('FAKE-1'), E('FAKE-2'), E('FAKE-3')];
  const same = M.mergeEntries(cur, [E('FAKE-2')]);
  deq([same.ok, same.added, same.updated], [true, 0, 0], '[٣] مدخل مطابق لما حاضر ⟵ لا إضافة ولا تحديث');
  const upd = M.mergeEntries(cur, [E('FAKE-2', {ar: 'جديد'})]);
  deq([upd.added, upd.updated, upd.next.map((e) => e.model), upd.next[1].ar], [0, 1, ['FAKE-1', 'FAKE-2', 'FAKE-3'], 'جديد'], '[٣] تحديث الاسم العربي ⟵ يُستبدل في موضعه (لا إعادة ترتيب)');
  const add = M.mergeEntries(cur, [E('FAKE-9'), E('FAKE-8')]);
  deq([add.added, add.updated, add.next.map((e) => e.model)], [2, 0, ['FAKE-1', 'FAKE-2', 'FAKE-3', 'FAKE-9', 'FAKE-8']], '[٣] الجديد يُلحَق في الآخر بترتيب المرسَل');
  const mixed = M.mergeEntries(cur, [E('FAKE-3', {tr: 'x'}), E('FAKE-7'), E('FAKE-1')]);
  deq([mixed.added, mixed.updated, mixed.next.length], [1, 1, 4], '[٣] تحديث وإلحاق ومطابق معاً');
  ok(cur.length === 3 && cur[1].ar === 'FAKE-AR-FAKE-2', '[٣] المدخل (الحاضر) لا يُعدَّل: نسخ');
  deq(M.mergeEntries(cur, [E('FAKE-1', {en: 'z'})]).next.filter((e) => e.model === 'FAKE-1').length, 1, '[٣] لا تكرار بعد الدمج');
  ok(cur.every((e) => M.mergeEntries(cur, [E('FAKE-0')]).next.some((x) => x.model === e.model)), '[٣] **لا حذف**: كل ما كان حاضراً يبقى بعد أيّ دمج');
  const full = new Array(L.maxEntries).fill(0).map((_, i) => E(`FAKE-${i}`));
  deq(M.mergeEntries(full, [E('FAKE-NEW')]), {ok: false, refusal: R.TOO_MANY_ENTRIES, extra: ` total=${L.maxEntries + 1}`}, '[٣] ما بعد الدمج فوق السقف ⟵ TOO_MANY_ENTRIES');
  eq(M.mergeEntries(full, [E('FAKE-5', {ar: 'تحديث'})]).ok, true, '[٣] والتحديث عند السقف مقبول (لا يزيد العدد)');
  deq(M.mergeEntries([], [E('FAKE-1')]).next, [E('FAKE-1')], '[٣] دمج في قائمة فارغة');
}

// ═══ ٤ — resolveMarketingName ═══
{
  const present = M.readMarketingNamesDocument(DOC());
  const hit = M.resolveMarketingName({model: 'FAKE-2', source: present});
  deq(hit, {state: 'mapped', model: 'FAKE-2', names: {ar: 'FAKE-AR-FAKE-2', tr: 'FAKE-TR-FAKE-2', en: 'FAKE-EN-FAKE-2'}, reason: null, version: 3}, '[٤] طراز موجود ⟵ mapped بالأسماء الثلاثة ونسخة الخريطة');
  const miss = M.resolveMarketingName({model: 'FAKE-99', source: present});
  deq(miss, {state: 'name_unmapped', model: 'FAKE-99', names: null, reason: 'MODEL_NOT_IN_MAP', version: 3}, '[٤] **طراز غير موجود** ⟵ name_unmapped (P:1535)، والطراز يُعاد كما هو ليُعرض Build.MODEL، والسبب MODEL_NOT_IN_MAP');
  deq(M.resolveMarketingName({model: 'FAKE-2', source: M.readMarketingNamesDocument(null)}), {state: 'name_unmapped', model: 'FAKE-2', names: null, reason: 'MAP_ABSENT', version: null}, '[٤] خريطة غائبة ⟵ name_unmapped بسبب MAP_ABSENT (لا اسم افتراضي)');
  deq(M.resolveMarketingName({model: 'FAKE-2', source: M.readMarketingNamesDocument(DOC({version: 0}))}), {state: 'name_unmapped', model: 'FAKE-2', names: null, reason: 'MAP_UNREADABLE', version: null}, '[٤] خريطة تالفة ⟵ name_unmapped بسبب MAP_UNREADABLE');
  for (const m of [undefined, null, '', 5, {}]) {
    deq(M.resolveMarketingName({model: m, source: present}), {state: 'name_unmapped', model: null, names: null, reason: 'MODEL_ABSENT', version: 3}, `[٤] طراز ${JSON.stringify(m)} ⟵ MODEL_ABSENT (لا يُحلّ ما لا طراز له)`);
  }
  eq(M.resolveMarketingName({model: 'fake-2', source: present}).state, 'name_unmapped', '[٤] المطابقة حرفيّة: fake-2 ≠ FAKE-2');
  eq(M.resolveMarketingName({model: 'FAKE-2 ', source: present}).state, 'name_unmapped', '[٤] ولا تشذيب صامت: «FAKE-2 » ≠ FAKE-2');
  deq(Object.values(V.MARKETING_NAME_STATE).sort(), ['mapped', 'name_unmapped'], '[٤] حالتا الحلّ من المفردات: name_unmapped (التصميم) وmapped (اقتراحي)');
  deq(Object.values(M.NAME_UNMAPPED_REASON).sort(), ['MAP_ABSENT', 'MAP_UNREADABLE', 'MODEL_ABSENT', 'MODEL_NOT_IN_MAP'], '[٤] أسباب name_unmapped الأربعة قائمة مغلقة');
}

// ═══ ٥ — ردود الرفض وحرّاس البنية ═══
ok(Object.isFrozen(A.REFUSAL_RESPONSE), '[٥] REFUSAL_RESPONSE مجمَّد');
deq(Object.keys(A.REFUSAL_RESPONSE).sort(), Object.values(R).sort(), '[٥] لكلّ رمز في MARKETING_NAMES_REFUSAL ردّ، ولا ردّ بلا رمز');
for (const [reason, spec] of Object.entries(A.REFUSAL_RESPONSE)) {
  ok(['invalid-argument', 'failed-precondition'].includes(spec.code), `[٥] ${reason}: رمز HttpsError معروف (${spec.code})`);
  eq(spec.message, reason, `[٥] ${reason}: الرسالة هي الرمز نفسه (لا نصّ عربي جديد: القرار ٩٠)`);
  eq(spec.clientReasonCode, reason, `[٥] ${reason}: رمز العميل هو الرمز`);
}
eq(A.REFUSAL_RESPONSE[R.CURRENT_UNREADABLE].code, 'failed-precondition', '[٥] المستند الحاضر التالف: failed-precondition');
{
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    let thrown = null;
    try { A.refuse(R.ENTRY_INVALID, {uid: 'uid-admin-1', extra: ' index=3 cause=TR_MISSING'}); } catch (e) { thrown = e; }
    deq([thrown.code, thrown.message, thrown.details], ['invalid-argument', 'MARKETING_NAMES_ENTRY_INVALID', {reasonCode: 'MARKETING_NAMES_ENTRY_INVALID'}], '[٥] refuse: الرمز والرسالة والتفصيل');
    eq(warns[0], `[setMarketingNames] refused reason=MARKETING_NAMES_ENTRY_INVALID caller=${hashIdForLog('uid-admin-1')} index=3 cause=TR_MISSING`, '[٥] والسجلّ بمعرّف مُهشَّر وسبب القراءة (لا قيمة ولا اسم)');
    ok(!warns[0].includes('uid-admin-1'), '[٥] لا معرّف خامّ');
    let bad2 = null;
    warns.length = 0;
    try { A.refuse('NOT_A_REASON'); } catch (e) { bad2 = e; }
    ok(bad2 && !bad2.code && /سبب رفض غير مُدرَج/.test(bad2.message) && warns.length === 0, '[٥] سبب غير مُدرَج: خطأ برمجي بلا سطر');
  } finally {
    console.warn = realWarn;
  }
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const source = strip(read('src', 'admin', 'marketingNamesAdmin.js'));
{
  const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
  eq(throwSites.length, 1, '[٥] `throw new HttpsError` واحد فقط (الشيفرة بلا تعليقات)');
  const refuseDef = source.indexOf('function refuse(');
  const refuseEnd = source.indexOf('\n}\n', refuseDef);
  ok(refuseDef >= 0 && throwSites[0].index > refuseDef && throwSites[0].index < refuseEnd, '[٥] وهو داخل refuse');
  const throwKinds = [...source.matchAll(/\bthrow\s+(new HttpsError|new Error|e)\b/g)].map((m) => m[1]).sort();
  deq(throwKinds, ['e', 'new Error', 'new HttpsError'], '[٥] ثلاثة throw: رمي refuse، وخطأ السبب غير المُدرَج داخلها، وإعادة رمي الفشل غير المتوقَّع كما هو');
  for (const name of Object.keys(R)) ok(new RegExp(`\\bR\\.${name}\\b`).test(source), `[٥] الرمز ${name} مستعمَل في marketingNamesAdmin.js`);
  ok(!/refuse\(\s*["'`]/.test(source), '[٥] ولا نداء refuse بسبب نصّ حرفي');
  ok((source.match(/requireAdmin\(request\);/g) || []).length === 2, '[٥] الدالّتان كلتاهما بـrequireAdmin');
  ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(|tx\.delete\(/.test(source), '[٥] **لا حذف في marketingNamesAdmin.js** (القاعدة 42)');
  ok(!/\.where\(|\.limit\(|\.orderBy\(/.test(source), '[٥] لا استعلام (قراءة بمعرّف مستند وحده: لا فهرس، القاعدة 43)');
  ok(!/request\.data/.test(source.slice(source.indexOf('const getMarketingNamesHandler'))), '[٥] getMarketingNames لا يقرأ request.data أصلاً (`{}` وnull وغيابه سواء)');
  const txStart = source.indexOf('db.runTransaction(');
  const txEnd = source.indexOf('} catch (e) {', txStart);
  const txBody = source.slice(txStart, txEnd);
  ok(txStart > 0 && txEnd > txStart && !/throw\s/.test(txBody), '[٥] لا throw داخل دالّة المعاملة — تُرجِع قراراً');
  const gets = [...txBody.matchAll(/tx\.get\(/g)];
  const writes = [...txBody.matchAll(/tx\.(update|set|create)\(/g)];
  eq(gets.length, 1, '[٥] قراءة واحدة: المستند الحاضر');
  eq(writes.length, 2, '[٥] كتابتان لا غير: النسخة السابقة (create) والحاضر (set)');
  ok(Math.max(...gets.map((m) => m.index)) < Math.min(...writes.map((m) => m.index)), '[٥] القراءة قبل أول كتابة');
  ok(/tx\.create\(ref\.collection\(PROTOCOL_SETTINGS_PATH\.HISTORY_SUBCOLLECTION\)\.doc\(String\(currentVersion\)\)/.test(txBody), '[٥] النسخة السابقة بـtx.create (لا يُكتب فوق نسخة محفوظة)');
  ok(/PROTOCOL_COLLECTION\.MARKETING_NAMES\)\.doc\(PROTOCOL_SETTINGS_PATH\.CURRENT_DOC\)/.test(source), '[٥] المستند marketingNames/current بأسمائه من protocolVocabulary');
  ok(!/["'`]marketingNames["'`]|["'`]history["'`]|["'`]current["'`]/.test(source), '[٥] لا حرفيّة لاسم المجموعة ولا history ولا current (مصدر واحد)');
  ok(!/console\.(log|warn|error)\([^)]*\b(model|entries|ar|tr|en)\b[^)]*\$\{[^}]*\.(model|ar|tr|en)\b/.test(source), '[٥] لا اسم ولا طراز في أيّ سطر سجلّ');
}
{
  const mn = strip(read('src', 'protocol', 'marketingNames.js'));
  ok(!/require\(["']firebase-admin["']\)|utils\/admin|\bdb\b\./.test(mn), '[٥] marketingNames.js نقيّ: لا Firestore ولا admin (القاعدة 41)');
  ok(!/Date\.now|new Date\(|Math\.random/.test(mn), '[٥] ولا وقت ولا عشوائية داخله');
  ok(!/FAKE|Samsung|Xiaomi|Galaxy|iPhone|Redmi|Huawei|OPPO|vivo|Pixel/i.test(mn), '[٥] **لا اسم تجاري ولا طراز في الكود**: الخريطة بيانات يدخلها المشرف (لا مدخل من الوكيل)');
}

console.log(`\nmarketingNames.test.js: ${n}/${n} assertions passed`);

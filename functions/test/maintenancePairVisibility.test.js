'use strict';

// maintenancePairVisibility.test.js — حارس «ظهور» ربط «قبل/بعد صيانة» (قرار حسن 4): الزوج **للفنّي ولوحة المشرف وحدهما**، فلا شيء منه في ما يصل العميل أو البائع أو الزائر العام.
// أمر المستخدم 2026-10-22، المرحلة S7 — القواعد 22 و30 و37 و41. بلا شبكة وبلا محاكٍ وبلا نداء نموذج (الفحص على المحاكي: المشهد ٧ في maintenancePair.e2e.test.js).
//
// القرار (منقول عن docs/PROTOCOL_CONTRACT.md §٢ A2، سطر «الظهور»، المنقول بدوره عن WIRE-SPEC-MAINTENANCE-PAIRS-2026-10-22.md — غير متحقَّق من هذا المستودع):
//   «قبل/بعد صيانة» للفنّي ولوحة المشرف وحدهما: لا في تقرير العميل ولا البائع ولا ردّ analyzeDevice ولا verifyReport ولا الصفحة العامة. يفشل الاختبار إن ظهر أيّ من
//   scanPurpose · defectType · linkedScanId · linkState · linkMethod · pair في ردّ analyzeDevice أو verifyReport أو مستند reports، وإن ذكر أيّ ملفّ تحت functions/src/reports الاسمَ scanProtocol.
//   (ق36 أ، أقرّه حسن 2026-10-22؛ القاعدتان 41 و37) ومعها linkModelCheck: ملاحظة الطراز الخادمية على سجلّ «بعد» — **سابعاً** في القائمة؛ فلا شيء منها يصل السلك، ويفشل الاختبار إن تسرّب (حقنٌ عدائي وطفرة مصدر verifyReport بها).
//
// ما يحرسه (كلٌّ مما يصل العميل فعلاً، لا ما نتخيّله):
//   ١ الماسح نفسه: يجد المفتاح بأيّ عمق وفي المصفوفات، ولا يعدّ **القيمة** مفتاحاً (نصّ «pair» في قيمة ليس تسرّباً)، ولا يُغفل بحالة الأحرف (الاسم بحرفه).
//   ٢ العيّنات الذهبية المُلتزَمة لكل ما يصل القارئ: مستندات reports (V6 وV7) · ردود verifyReport (V6 وV7) · ما يصل التطبيق من analyzeDevice (حمولة العميل V7) · الخامّ reportRaw (لا يقرؤه العميل، لكنّ العقد يمنع الحقول فيه)؛
//      **وكل ملفّ جديد بهذه الأنماط يُفحَص تلقائياً** (القائمة تُجرَد من المجلّد لا تُكتب باليد) مع حدّ أدنى لعددها (لا نجاح من مجلّد فارغ: القاعدة 22).
//   ٣ **تسرّب عدائي عبر الدالّة الحقيقية** (القاعدة 37): تُحقَن الحقول الستّة (وغيرها من حقول scanProtocol) على مستند reports في الجذر وفي aiResponse، فيُمرَّر المستند بـverifyReport الحقيقية (يُستخرَج مصدرها وقت الاختبار نفسه كما في
//      verifyReportV7Whitelist.test.js)، وتُحقَن على aiResult فتُمرَّر بـbuildV7ResponseForStorage وstripNarrativeDetailsVerdictFromV7Response الحقيقيتين: لا شيء منها يخرج. وضابط حيّ: حقل مسموح بقيمة علامة يخرج (فالتجربة تقرأ المستند فعلاً).
//   ٤ بنيوي: لا ملفّ تحت functions/src/reports يذكر scanProtocol أو أيّ من الأسماء الستّة أو protocolPending أو protocolCorrections أو maintenancePair، ولا يستورد من ../protocol/؛ وV7_OPERATIONAL_FIELDS لا تحمل أيّاً منها؛
//      وfirestore.rules لا يفتح مجموعات البروتوكول لغير المشرف (لا match لها: الرفض الافتراضي).
//   ٥ طفرات في الذاكرة (القاعدة 39): مصدر verifyReport يُطفَّر بتمرير report كلّه أو بحقل واحد ⟵ يُكشَف؛ والماسح المبتور (سطحي · بلا مصفوفات · يطابق القيم) يُسقطه اختبار الماسح.
//
// Run: node functions/test/maintenancePairVisibility.test.js

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const {SCAN_PROTOCOL_FIELD} = require('../src/protocol/protocolCorrection');
const {PROTOCOL_COLLECTION} = require('../src/protocol/protocolVocabulary');
const {buildResponse, fakeDoc} = require('../scripts/generate-v7-verifyReport-response-sample');
const {buildClientPayloadSample} = require('../scripts/generate-v7-client-payload-sample');
const {buildReportsDocumentSample} = require('../scripts/generate-v7-reports-document-sample');
const {buildV7ResponseForStorage, stripNarrativeDetailsVerdictFromV7Response} = require('../src/analysis/analyzeDevice');
const {V7_OPERATIONAL_FIELDS} = require('../src/analysis/v7OperationalFields');
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {hashIdForLog} = require('../src/utils/logRedaction');

const FN_DIR = path.join(__dirname, '..');
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const REPORTS_SRC_DIR = path.join(FN_DIR, 'src', 'reports');
const VERIFY_REPORT_SRC = path.join(REPORTS_SRC_DIR, 'verifyReport.js');
const RULES = path.join(FN_DIR, '..', 'firestore.rules');
const PROTOCOL_HOLDERS = [PROTOCOL_COLLECTION.SCAN_PROTOCOL, PROTOCOL_COLLECTION.PROTOCOL_PENDING, PROTOCOL_COLLECTION.PROTOCOL_CORRECTIONS];

// ─── القائمة المحظورة: من مصدرها الواحد (القاعدة 24)، ومثبَّتة على ما في العقد حرفياً ───
// (ق36 أ، القاعدة 23: كانت القائمة ستّةً؛ صارت سبعةً بـlinkModelCheck — الاسم من SCAN_PROTOCOL_FIELD لا حرفاً مكرَّراً)
const FORBIDDEN = [SCAN_PROTOCOL_FIELD.SCAN_PURPOSE, SCAN_PROTOCOL_FIELD.DEFECT_TYPE, SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID, SCAN_PROTOCOL_FIELD.LINK_STATE, SCAN_PROTOCOL_FIELD.LINK_METHOD, SCAN_PROTOCOL_FIELD.PAIR, SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK];
deq([...FORBIDDEN].sort(), ['defectType', 'linkMethod', 'linkModelCheck', 'linkState', 'linkedScanId', 'pair', 'scanPurpose'], 'القائمة المحظورة = الستّة المسمّاة في العقد A2 (قرار حسن 4) + linkModelCheck (ق36 أ، 2026-10-22) بأسمائها');
// أسماء أخرى من scanProtocol/protocolPending لا يراها العميل أيضاً (أضفتُها: لا اسم في العقد، والمشهد ٧ في e2e يفحصها كذلك)
const SERVER_ONLY_EXTRA = ['purposeSource'];
const ALL_HIDDEN = [...FORBIDDEN, ...SERVER_ONLY_EXTRA];

/** كل مفتاح من القائمة بأيّ عمق (كائنات ومصفوفات)، بمساره. القيم لا تُعدّ. */
function hiddenPaths(v, hidden = ALL_HIDDEN, p = '') {
  const out = [];
  if (Array.isArray(v)) v.forEach((x, i) => out.push(...hiddenPaths(x, hidden, `${p}[${i}]`)));
  else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (hidden.includes(k)) out.push(`${p}.${k}`.replace(/^\./, ''));
      out.push(...hiddenPaths(v[k], hidden, `${p}.${k}`));
    }
  }
  return out;
}

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
const goldenFiles = (re) => fs.readdirSync(GOLDEN).filter((f) => re.test(f)).sort();

// ═══ ١ — الماسح نفسه ═══
{
  deq(hiddenPaths({a: 1}), [], '[١] لا مفتاح محظور ⟵ لا مسار');
  deq(hiddenPaths({pair: {state: 'OPEN'}}, FORBIDDEN), ['pair'], '[١] مفتاح في الجذر');
  deq(hiddenPaths({a: {b: {c: {defectType: 'X'}}}}, FORBIDDEN), ['a.b.c.defectType'], '[١] مفتاح بعمق ثلاثة');
  deq(hiddenPaths({list: [{ok: 1}, {linkState: 'active'}]}, FORBIDDEN), ['list[1].linkState'], '[١] مفتاح داخل عنصر مصفوفة');
  deq(hiddenPaths([[{linkedScanId: 'x'}]], FORBIDDEN), ['[0][0].linkedScanId'], '[١] مصفوفة في مصفوفة');
  deq(hiddenPaths({note: 'pair', k: ['defectType', 'scanPurpose']}, FORBIDDEN), [], '[١] القيمة النصّية «pair» أو «defectType» ليست مفتاحاً');
  deq(hiddenPaths({Pair: 1, PAIR: 2, defecttype: 3, pairs: 4}, FORBIDDEN), [], '[١] الاسم بحرفه: حالة الأحرف والجمع ليست المفتاح المحظور');
  deq(hiddenPaths({pair: {pair: 1}}, FORBIDDEN), ['pair', 'pair.pair'], '[١] المفتاح المتكرّر في العمق يُعدّ كذلك');
  deq(hiddenPaths(null, FORBIDDEN), [], '[١] null بلا خطأ');
  deq(hiddenPaths({a: null, b: undefined, c: 3, d: 'pair'}, FORBIDDEN), [], '[١] قيم أولية بلا خطأ');
  deq(hiddenPaths({scanPurpose: 1, defectType: 2, linkedScanId: 3, linkState: 4, linkMethod: 5, pair: 6, linkModelCheck: 7}, FORBIDDEN).length, 7, '[١] كل واحد من السبعة يُلتقط (ومنها linkModelCheck، ق36 أ)');
  deq(hiddenPaths({a: {linkModelCheck: 'LINK_MODEL_MISMATCH'}, list: [{linkModelCheck: null}]}, FORBIDDEN), ['a.linkModelCheck', 'list[0].linkModelCheck'], '[١] linkModelCheck يُلتقط بأيّ عمق وفي المصفوفات (قيمة نصّ أو null)');
  deq(hiddenPaths({note: 'LINK_MODEL_MISMATCH', k: ['linkModelCheck']}, FORBIDDEN), [], '[١] ونصّ القيمة LINK_MODEL_MISMATCH أو الاسم كقيمة ليس مفتاحاً');
  deq(hiddenPaths({purposeSource: 'x'}), ['purposeSource'], '[١] والقائمة الموسَّعة تلتقط purposeSource');
  // الماسح المبتور يُسقطه هذا القسم نفسه (طفرات الماسح): كلٌّ منها يخطئ في حالة بعينها
  const shallow = (v) => (v && typeof v === 'object' ? Object.keys(v).filter((k) => FORBIDDEN.includes(k)) : []);
  const noArrays = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).flatMap((k) => [...(FORBIDDEN.includes(k) ? [k] : []), ...noArrays(v[k])]) : []);
  const byValue = (v) => JSON.stringify(v).split('"').filter((t) => FORBIDDEN.includes(t)).length > 0;
  ok(shallow({a: {pair: 1}}).length === 0 && hiddenPaths({a: {pair: 1}}, FORBIDDEN).length === 1, '[١] طفرة: ماسح سطحي يُغفل المتداخل — الماسح الحقيقي يجده');
  ok(noArrays({a: [{pair: 1}]}).length === 0 && hiddenPaths({a: [{pair: 1}]}, FORBIDDEN).length === 1, '[١] طفرة: ماسح بلا مصفوفات يُغفل عنصرها — الحقيقي يجده');
  ok(byValue({note: 'pair'}) === true && hiddenPaths({note: 'pair'}, FORBIDDEN).length === 0, '[١] طفرة: ماسح يطابق القيم يتّهم بريئاً — الحقيقي لا');
}

// ═══ ٢ — العيّنات الذهبية المُلتزَمة ═══
const GROUPS = [
  {name: 'مستندات reports (V6 وV7)', re: /^(v6|v7)-reports-document-sample.*\.json$/, min: 7},
  {name: 'ردود verifyReport (V6 وV7)', re: /^(v6|v7)-verifyReport-response-sample.*\.json$/, min: 7},
  {name: 'حمولة analyzeDevice التي تصل التطبيق (V7)', re: /^v7-client-payload-sample.*\.json$/, min: 4},
  {name: 'الخامّ reportRaw (V7)', re: /^v7-report-raw-sample.*\.json$/, min: 6},
];
{
  for (const g of GROUPS) {
    const files = goldenFiles(g.re);
    ok(files.length >= g.min, `[٢] ${g.name}: ${files.length} ملفّاً على الأقلّ ${g.min} (لا نجاح من مجلّد فارغ أو ناقص)`);
    for (const f of files) {
      const doc = readJson(f);
      ok(doc !== null && typeof doc === 'object' && Object.keys(doc).length > 0, `[٢] ${f}: ملفّ غير فارغ`);
      deq(hiddenPaths(doc), [], `[٢] ${f}: لا حقل محظور بأيّ عمق`);
    }
  }
  // ولدى المُولِّد الحيّ الآن (لا الملفّ المُلتزَم وحده): مستند reports V7 وحمولة العميل V7
  const freshReports = buildReportsDocumentSample();
  deq(hiddenPaths(freshReports.reportDocument), [], '[٢] مستند reports الطازج من buildReportDocument الحقيقية: لا حقل محظور');
  const freshPayload = buildClientPayloadSample();
  deq(hiddenPaths(freshPayload.clientPayload), [], '[٢] حمولة العميل الطازجة: لا حقل محظور');
}

// ═══ ٣ — تسرّب عدائي عبر الدالّة الحقيقية ═══
// استخراج مصدر verifyReport كما يفعل المُولِّد (العلامتان نفسهما)، لتجربة مصدر مُطفَّر في ٥ بلا لمس الملفّ.
function buildFromSource(src, reportDoc) {
  const startMarker = 'const report = reportDoc.data();';
  const endMarker = 'res.json(response);';
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker);
  if (!(a > -1 && b > a)) throw new Error('العلامتان غير موجودتين في verifyReport.js بالترتيب المتوقَّع');
  const cons = {log: () => {}, warn: () => {}, error: () => {}};
  return new Function('reportDoc', 'console', 'V7_PIPELINE_TAG', 'V6_PIPELINE_TAG', 'hashIdForLog', src.slice(a, b) + '\nreturn response;')(reportDoc, cons, V7_PIPELINE_TAG, V6_PIPELINE_TAG, hashIdForLog);
}
const verifySrc = fs.readFileSync(VERIFY_REPORT_SRC, 'utf8');
const LEAK = 'MUST-NOT-LEAK';
const injection = () => Object.fromEntries(ALL_HIDDEN.map((k) => [k, k === 'pair' ? {state: 'OPEN', openedAt: LEAK} : LEAK]));
function hostileDoc(base) {
  const d = JSON.parse(JSON.stringify(base));
  Object.assign(d, injection());
  if (d.aiResponse && typeof d.aiResponse === 'object' && !Array.isArray(d.aiResponse)) {
    Object.assign(d.aiResponse, injection());
    if (d.aiResponse.overall && typeof d.aiResponse.overall === 'object') Object.assign(d.aiResponse.overall, injection());
  }
  return d;
}
{
  const docs = goldenFiles(/^(v6|v7)-reports-document-sample.*\.json$/);
  let v7 = 0; let v6 = 0;
  for (const f of docs) {
    const base = readJson(f);
    const sentinelBase = JSON.parse(JSON.stringify(base));
    sentinelBase.deviceModel = 'SENTINEL-DEVICE';
    const live = buildResponse(fakeDoc('scan-vis', sentinelBase), []);
    eq(live.deviceModel, 'SENTINEL-DEVICE', `[٣] ${f}: ضابط حيّ — حقل مسموح بقيمة علامة يخرج (التجربة تقرأ المستند فعلاً)`);
    eq(live.aiResponse && live.aiResponse.pipeline === V7_PIPELINE_TAG ? 'v7' : 'v6', (base.pipeline === V7_PIPELINE_TAG) ? 'v7' : 'v6', `[٣] ${f}: الفرع المُجرَّب هو فرع المستند (V6 أو V7)`);
    if (base.pipeline === V7_PIPELINE_TAG) v7++; else v6++;
    const hostile = hostileDoc(base);
    ok(hiddenPaths(hostile).length >= ALL_HIDDEN.length, `[٣] ${f}: الحقن وصل المستند (ضابط: ${hiddenPaths(hostile).length} موضعاً)`);
    const resp = buildResponse(fakeDoc('scan-vis', hostile), []);
    deq(hiddenPaths(resp), [], `[٣] ${f}: لا حقل محظور في ردّ verifyReport الحقيقية بعد حقنه في الجذر وaiResponse وoverall`);
    ok(!JSON.stringify(resp).includes(LEAK), `[٣] ${f}: ولا قيمة العلامة في أيّ موضع من الردّ`);
    deq(buildFromSource(verifySrc, fakeDoc('scan-vis', hostile)), resp, `[٣] ${f}: وبناء المصدر المستخرَج هنا = مُولِّد الردّ الذهبي (الأداة التي تُطفَّر في ٥ أمينة)`);
  }
  ok(v7 >= 6 && v6 >= 1, `[٣] فرعا V7 (${v7}) وV6 (${v6}) كلاهما مُجرَّب بالحقن`);
  // ما يصل التطبيق من analyzeDevice: whitelist buildV7ResponseForStorage
  const payload = buildClientPayloadSample();
  const aiHostile = JSON.parse(JSON.stringify(payload.aiResult));
  Object.assign(aiHostile, injection());
  Object.assign(aiHostile.overall, injection());
  if (aiHostile.narrative) Object.assign(aiHostile.narrative, injection());
  for (const c of Object.keys(aiHostile.categories)) Object.assign(aiHostile.categories[c], injection());
  for (const it of (aiHostile.issues || [])) Object.assign(it, injection());
  ok(hiddenPaths(aiHostile).length >= ALL_HIDDEN.length * 3, `[٣] الحقن وصل aiResult (${hiddenPaths(aiHostile).length} موضعاً)`);
  const operationalValues = {shortId: 'S', isFreeTrial: false, aiModel: 'm', deviceMarketingName: 'D'};
  const extras = {};
  for (const f of V7_OPERATIONAL_FIELDS) extras[f] = operationalValues[f];
  const clientHostile = {...stripNarrativeDetailsVerdictFromV7Response(buildV7ResponseForStorage(aiHostile)), ...extras};
  deq(hiddenPaths(clientHostile), [], '[٣] حمولة analyzeDevice (القائمة البيضاء الحقيقية) لا تُخرج حقلاً محظوراً حُقن في aiResult أو overall أو narrative أو فئة أو issue');
  ok(!JSON.stringify(clientHostile).includes(LEAK), '[٣] ولا قيمة العلامة في الحمولة');
  ok(Object.keys(clientHostile).length > 5, '[٣] والحمولة ممتلئة (الفحص ليس على كائن فارغ)');
  deq(V7_OPERATIONAL_FIELDS.filter((f) => ALL_HIDDEN.includes(f)), [], '[٣] V7_OPERATIONAL_FIELDS لا تحمل حقلاً محظوراً');
  // حدّ معروف مثبَّت (اكتُشف بالتجربة 2026-10-22): verifyReport تمرّر aiResponse.categories وaiResponse.issues كما خُزِّنتا (تمريرة كاملة؛ verifyReport.js، باني V7: categoriesOut وissuesOut)، فلا حماية لهما على جهة القراءة.
  // الحماية على جهة الكتابة: buildV7ResponseForStorage (أعلاه) تُجرِّد كل فئة وكل issue إلى حقولها المُسمّاة، وفحص العيّنات المخزَّنة (٢) يكشف أيّ مستند يحمل المفتاح. إن صارت verifyReport تُسقط هذين المفتاحين يوماً فهذا السطر يُستبدَل (القاعدة 23).
  const passDoc = JSON.parse(JSON.stringify(readJson('v7-reports-document-sample.json')));
  const catKey = Object.keys(passDoc.aiResponse.categories)[0];
  passDoc.aiResponse.categories[catKey].pair = {state: 'OPEN'};
  passDoc.aiResponse.issues[0].defectType = LEAK;
  deq(hiddenPaths(buildResponse(fakeDoc('scan-vis', passDoc), [])).sort(), [`aiResponse.categories.${catKey}.pair`, 'aiResponse.issues[0].defectType'].sort(), '[٣] حدّ معروف مثبَّت: verifyReport تمرّر categories وissues كما خُزِّنتا فمفتاح محظور مخزَّن داخلهما يصل الصفحة العامة؛ والحماية على جهة الكتابة وفحص العيّنات المخزَّنة');
}

// ═══ ٤ — بنيوي ═══
/** مخالفات مصدر ملفّ تحت src/reports: ذكر الأسماء المحظورة، أو الاستيراد من وحدات البروتوكول. */
function staticViolations(src) {
  const v = [];
  if (/scanProtocol/i.test(src)) v.push('MENTIONS_scanProtocol');
  for (const k of ALL_HIDDEN) {
    const word = k === 'pair' ? /(?:^|[^A-Za-z0-9_])pair(?:[^A-Za-z0-9_]|$)/ : new RegExp(`(?:^|[^A-Za-z0-9_])${k}(?:[^A-Za-z0-9_]|$)`);
    if (word.test(src)) v.push(`MENTIONS_${k}`);
  }
  for (const name of [PROTOCOL_COLLECTION.PROTOCOL_PENDING, PROTOCOL_COLLECTION.PROTOCOL_CORRECTIONS, 'maintenancePair']) if (src.includes(name)) v.push(`MENTIONS_${name}`);
  if (/require\(\s*["'][^"']*\/protocol\//.test(src)) v.push('REQUIRES_protocol_module');
  if (/require\(\s*["'][^"']*\/sessions\//.test(src)) v.push('REQUIRES_sessions_module');
  return v;
}
{
  const files = fs.readdirSync(REPORTS_SRC_DIR).filter((f) => f.endsWith('.js'));
  deq(files.sort(), ['generateReportPdf.js', 'verifyReport.js'], '[٤] ملفّا functions/src/reports هما generateReportPdf وverifyReport (ملفّ جديد يدخل الفحص: يُحدَّث هذا الجرد عمداً)');
  for (const f of files) deq(staticViolations(fs.readFileSync(path.join(REPORTS_SRC_DIR, f), 'utf8')), [], `[٤] ${f}: لا يذكر scanProtocol ولا أيّاً من الأسماء المحظورة ولا يستورد من البروتوكول`);
  deq(PROTOCOL_HOLDERS, ['scanProtocol', 'protocolPending', 'protocolCorrections'], '[٤] مجموعات البروتوكول التي تحمل حقول الزوج (من مصدرها الواحد): scanProtocol وprotocolPending وprotocolCorrections');
  // قواعد Firestore: لا قاعدة تفتح مجموعات البروتوكول (الرفض الافتراضي لغير المشرف)
  const rules = fs.readFileSync(RULES, 'utf8');
  const ruleViolations = (text) => PROTOCOL_HOLDERS.filter((c) => new RegExp(`match\\s+/${c}\\b`).test(text));
  deq(ruleViolations(rules), [], '[٤] firestore.rules: لا match لأيّ من مجموعات البروتوكول (لا قراءة لغير المشرف والخادم)');
  ok(/match\s+\/scanSessions\/\{sessionId\}/.test(rules), '[٤] (ضابط) والقواعد تُقرأ: match scanSessions موجود');

  // ═══ ٥ — طفرات ═══
  ok(staticViolations(verifySrc + '\n// reads scanProtocol').includes('MENTIONS_scanProtocol'), '[٥] طفرة: ذكر scanProtocol في ملفّ التقارير ⟵ يُكشَف');
  ok(staticViolations(verifySrc + '\nconst x = rep.pair;').includes('MENTIONS_pair'), '[٥] طفرة: قراءة rep.pair ⟵ يُكشَف');
  ok(staticViolations(verifySrc + '\nconst d = {defectType: 1};').includes('MENTIONS_defectType'), '[٥] طفرة: ذكر defectType ⟵ يُكشَف');
  ok(staticViolations(verifySrc + '\nconst p = require("../protocol/maintenancePair");').includes('REQUIRES_protocol_module'), '[٥] طفرة: استيراد وحدة بروتوكول ⟵ يُكشَف');
  ok(staticViolations(verifySrc + '\nconst c = "protocolPending";').includes('MENTIONS_protocolPending'), '[٥] طفرة: ذكر protocolPending ⟵ يُكشَف');
  deq(staticViolations(verifySrc + '\nconst repaired = 1; // pairs? repair'), [], '[٥] ولا اتّهام بريء: «repaired» و«pairs» ليستا pair');
  ok(ruleViolations(rules + '\nmatch /scanProtocol/{id} { allow read: if request.auth != null; }').includes('scanProtocol'), '[٥] طفرة: قاعدة تفتح scanProtocol ⟵ تُكشَف');
  ok(ruleViolations(rules + '\nmatch /protocolPending/{id} { allow read: if true; }').length === 1, '[٥] طفرة: قاعدة تفتح protocolPending ⟵ تُكشَف');

  // طفرات مصدر verifyReport: كل واحدة تُسرّب إلى الردّ، فيجب أن يكشفها فحص ٣ نفسه
  const baseDoc = readJson('v7-reports-document-sample.json');
  const hostile = hostileDoc(baseDoc);
  const leaksWith = (src) => hiddenPaths(buildFromSource(src, fakeDoc('scan-vis', hostile)));
  deq(leaksWith(verifySrc), [], '[٥] (ضابط) المصدر الحقيقي لا يُسرّب');
  const SPREAD = 'deviceModel: rep.deviceModel,';
  eq(verifySrc.split(SPREAD).length - 1, 2, '[٥] (ضابط) موضعا الطفرة: باني V7 وباني V6 في المصدر (تُطفَّر كلتاهما)');
  const mutateBoth = (extra) => verifySrc.split(SPREAD).join(`${SPREAD} ${extra}`);
  ok(leaksWith(mutateBoth('...rep,')).length > 0, '[٥] طفرة: تمرير report كلّه إلى الردّ ⟵ فحص التسرّب العدائي يكشفها');
  ok(leaksWith(mutateBoth('pair: rep.pair,')).includes('pair'), '[٥] طفرة: pair: rep.pair في الردّ ⟵ يُكشَف');
  ok(leaksWith(mutateBoth('defectType: rep.defectType,')).includes('defectType'), '[٥] طفرة: defectType: rep.defectType ⟵ يُكشَف');
  ok(leaksWith(mutateBoth('scanPurpose: rep.scanPurpose,')).includes('scanPurpose'), '[٥] طفرة: scanPurpose ⟵ يُكشَف');
  ok(leaksWith(mutateBoth('linkModelCheck: rep.linkModelCheck,')).includes('linkModelCheck'), '[٥] (ق36 أ) طفرة: linkModelCheck: rep.linkModelCheck في الردّ ⟵ يُكشَف');
  ok(staticViolations(verifySrc + '\nconst m = rep.linkModelCheck;').includes('MENTIONS_linkModelCheck'), '[٥] (ق36 أ) طفرة: قراءة rep.linkModelCheck في ملفّ التقارير ⟵ يُكشَف');
  // طفرة في باني V6 وحده (الموضع الثاني): تُكشَف بمستند V6 العدائي ولا يمسّ مستند V7 (فالفرعان مُجرَّبان كلٌّ بمستنده)
  const at2 = verifySrc.lastIndexOf(SPREAD);
  const mutV6Only = verifySrc.slice(0, at2) + SPREAD + ' pair: rep.pair,' + verifySrc.slice(at2 + SPREAD.length);
  const v6Hostile = hostileDoc(readJson('v6-reports-document-sample.json'));
  ok(hiddenPaths(buildFromSource(mutV6Only, fakeDoc('scan-vis', v6Hostile))).includes('pair'), '[٥] طفرة: pair في باني V6 وحده ⟵ يكشفها حقن مستند V6');
  deq(hiddenPaths(buildFromSource(mutV6Only, fakeDoc('scan-vis', hostile))), [], '[٥] وطفرة V6 وحدها لا تظهر في ردّ مستند V7 (كل فرع بمستنده)');
  // ومستند حقيقي بحقل محظور (كتابة خاطئة في analyzeDevice مثلاً) يُكشَف من الماسح على العيّنة
  const leakyReport = JSON.parse(JSON.stringify(baseDoc));
  leakyReport.pair = {state: 'OPEN'};
  ok(hiddenPaths(leakyReport).includes('pair'), '[٥] طفرة: مستند reports بحقل pair ⟵ الماسح على العيّنة يكشفه');
  const leakyPayload = JSON.parse(JSON.stringify(readJson('v7-client-payload-sample.json')));
  leakyPayload.categories.cpu.linkedScanId = 'x';
  ok(hiddenPaths(leakyPayload).includes('categories.cpu.linkedScanId'), '[٥] طفرة: حقل ربط داخل فئة في حمولة العميل ⟵ يُكشَف بمساره');
  const leakyModel = JSON.parse(JSON.stringify(baseDoc));
  leakyModel.linkModelCheck = 'LINK_MODEL_MISMATCH';
  ok(hiddenPaths(leakyModel).includes('linkModelCheck'), '[٥] (ق36 أ) طفرة: مستند reports بحقل linkModelCheck ⟵ الماسح على العيّنة يكشفه');
  const leakyRaw = JSON.parse(JSON.stringify(readJson('v7-report-raw-sample.json')));
  leakyRaw.defectType = 'BATTERY';
  ok(hiddenPaths(leakyRaw).includes('defectType'), '[٥] طفرة: حقل في الخامّ ⟵ يُكشَف');
}

console.log(`maintenancePairVisibility.test.js: ${n}/${n} assertions passed`);

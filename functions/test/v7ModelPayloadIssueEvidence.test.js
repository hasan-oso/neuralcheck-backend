'use strict';

// v7ModelPayloadIssueEvidence.test.js — أمر مستخدم 2026-10-07 +03 (البند ٢):
//   «قيمة العطل لاختبارات B-xx (مثل «48.5 °C») تُحجب في نسخة النموذج وحدها. وقائمة الأعطال المخزّنة لا تتغيّر.»
// الواقعة (قياس): عطب B-03 فاشل بقيمة 48.5 كان يصل النموذج في issues[ISS-B-03].evidence رغم أن testResults حجبت القيمة نفسها.
// الاختبار: كل B-01..B-07 بحالتي FAIL وWARNING تُحجب قيمتها في نسخة النموذج، والمخزَّن (categoryStates.issues) بصمته sha256 لا تتغيّر،
// واختبار داخل الحرف فاشل يحتفظ بقيمته، وDISC (غير مقيس) بلا evidence يمرّ كما هو، والحارس يرفض ذكر القيمة المحجوبة.
//
// Run: node functions/test/v7ModelPayloadIssueEvidence.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildV7Payload, _internal} = require('../src/analysis/buildV7Payload');
const {MODEL_STATE_TEXT} = require('../src/analysis/v7ModelPayloadWhitelist');
const {validateNumberGrounding} = require('../src/analysis/reportShapeV7');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');
const {BATTERY_STATE_TEST_IDS} = require('../src/analysis/testKinds');

const M = MODEL_STATE_TEXT.measured;
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
const SCAN_ID = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
const raw = loadJson('b45c8cf6.ts.json');
const functional0 = loadJson('functionalResults-by-scanid.json').byScanId[SCAN_ID];
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

function build(mutate) {
  const functional = mutate ? functional0.map(mutate) : functional0;
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  const before = sha({findings, categoryStates});
  const built = buildV7Payload({findings, categoryStates, language: 'ar', scanId: SCAN_ID, isFreeTrial: false, previousScan: null});
  return {findings, categoryStates, body: built.body, storedUnchanged: before === sha({findings, categoryStates})};
}
const flip = (id, status, rawValue) => (r) => (r.testId === id ? Object.assign({}, r, {status, rawValue}) : r);
const issueOf = (list, id) => list.find((i) => i.id === id);

// ═══ ١ — المثال المأمور: B-03 فاشل بقيمة 48.5 °C ═══
{
  const r = build(flip('B-03', 'fail', '48.5'));
  const stored = issueOf(r.categoryStates.issues, 'ISS-B-03');
  const sent = issueOf(r.body.categoryStates.issues, 'ISS-B-03');
  ok(stored && sent, '[١][إعداد] ISS-B-03 موجود في المخزَّن وفي نسخة النموذج');
  eq(stored.evidence, '48.5', '[١] المخزَّن: evidence = «48.5» كما حسبه الخادم');
  eq(stored.evidenceUnit, '°C', '[١] المخزَّن: الوحدة °C');
  eq(sent.evidence, M, '[١] نسخة النموذج: evidence «مقيس…» لا «48.5»');
  eq(sent.evidenceUnit, '°C', '[١] الوحدة (رمز) تبقى');
  eq(sent.severity, 'FAIL', '[١] severity بلا مساس — الخادم هو من قرّر العطل');
  eq(sent.title, stored.title, '[١] العنوان بلا مساس');
  eq(sent.id, 'ISS-B-03', '[١] المعرّف بلا مساس');
  eq(r.storedUnchanged, true, '[١] المخزَّن (findings + categoryStates بما فيها issues) بصمته sha256 لم تتغيّر بعد buildV7Payload');
  eq(r.categoryStates.issues.filter((i) => i.evidence === M).length, 0, '[١] «مقيس…» لم تدخل المخزَّن');
  const t = r.body.testResults.find((x) => x.testId === 'B-03');
  eq(t.evidence, M, '[١] testResults: القيمة محجوبة أيضاً (اتّساق الموضعين)');
  ok(!JSON.stringify(r.body).includes('48.5'), '[١] «48.5» غائبة عن الحمولة كلّها');
}

// ═══ ٢ — كل B-01..B-07 بحالتي FAIL وWARNING ═══
for (const id of BATTERY_STATE_TEST_IDS) {
  for (const status of ['fail', 'warning']) {
    const value = id === 'B-07' ? 'LiPo-X' : (id === 'B-01' ? 'DEAD' : '77.7');
    const r = build(flip(id, status, value));
    const stored = issueOf(r.categoryStates.issues, `ISS-${id}`);
    const sent = issueOf(r.body.categoryStates.issues, `ISS-${id}`);
    ok(stored && sent, `[٢] ${id}/${status}: العطب موجود`);
    eq(stored.evidence, value, `[٢] ${id}/${status}: المخزَّن بقيمته`);
    eq(sent.evidence, M, `[٢] ${id}/${status}: نسخة النموذج محجوبة`);
    eq(sent.severity, status.toUpperCase(), `[٢] ${id}/${status}: severity كما هي`);
    eq(r.storedUnchanged, true, `[٢] ${id}/${status}: المخزَّن لم يتغيّر`);
    ok(!JSON.stringify(r.body).includes(value) || value.length < 3, `[٢] ${id}/${status}: القيمة «${value}» غائبة عن الحمولة`);
  }
}

// ═══ ٣ — ما لا يُمَسّ ═══
{
  // اختبار داخل الحرف فاشل (C-06): قيمته في issues تبقى
  const c06 = build(flip('C-06', 'fail', '41.2'));
  eq(issueOf(c06.body.categoryStates.issues, 'ISS-C-06').evidence, '41.2', '[٣] C-06 (داخل الحرف) فاشل: evidence يبقى «41.2»');
  // DISC (غير مقيس) بلا evidence: كما هو
  const disc = build(flip('B-03', 'unavailable', 'N/A'));
  const d = issueOf(disc.body.categoryStates.issues, 'DISC-B-03');
  ok(d && !('evidence' in d), '[٣] DISC-B-03 (غير مقيس): بلا evidence ويمرّ كما هو');
  deepEq(d, issueOf(disc.categoryStates.issues, 'DISC-B-03'), '[٣] DISC بلا فرق عن المخزَّن');
  // POS وبقيّة العناصر
  const base = build(null);
  const pos = base.body.categoryStates.issues.filter((i) => i.id.startsWith('POS-'));
  ok(pos.length > 0, '[٣][إعداد] عناصر POS موجودة');
  deepEq(pos, base.categoryStates.issues.filter((i) => i.id.startsWith('POS-')).map((i) => ({id: i.id, category: i.category, severity: i.severity, title: i.title})),
      '[٣] عناصر POS كما هي بحقولها المسموحة');
  deepEq(base.body.categoryStates.issues.map((i) => i.id), base.categoryStates.issues.map((i) => i.id), '[٣] قائمة الأعطال بمعرّفاتها كما حسبها الخادم (لا حذف ولا إضافة)');
  // الدالّة مباشرة: null وعناصر غير كائن
  eq(_internal.hideIssueValuesForModel(null), null, '[٣] null بلا رمي');
  deepEq(_internal.hideIssueValuesForModel([null, 'x']), [null, 'x'], '[٣] عناصر غير كائن تمرّ');
  deepEq(_internal.hideIssueValuesForModel([{id: 'ISS-B-03', severity: 'FAIL', evidence: null}])[0], {id: 'ISS-B-03', severity: 'FAIL', evidence: null}, '[٣] evidence=null يبقى null — لا «مقيس» لغائب');
}

// ═══ ٤ — الحارس: القيمة المحجوبة لا تُقبَل بعد الآن ═══
{
  const r = build(flip('B-03', 'fail', '48.5'));
  const ctx = {findings: r.body.findings, categoryStates: Object.assign({}, r.body.categoryStates, {testResults: r.body.testResults})};
  const resp = (summary) => ({
    narrative: {summary, details: 'تفاصيل بلا أرقام.', verdict: 'خلاصة بلا أرقام.', buyerAdvice: {casual: 'نصّ.', gamer: 'نصّ.', photographer: 'نصّ.'}, issueDescriptions: {}},
    crossChecks: [], adjustments: [], modelObservations: [],
  });
  const g = validateNumberGrounding(resp('حرارة البطارية 48.5 درجة.'), ctx.findings, ctx.categoryStates);
  eq(g.unmatchedFields.length, 1, '[٤] ذكر «48.5» (قيمة عطل محجوبة) يُرفَض');
  const g2 = validateNumberGrounding(resp('حرارة البطارية و48.5، درجة.'), ctx.findings, ctx.categoryStates);
  eq(g2.unmatchedFields.length, 1, '[٤] ذكر «و48.5،» يُرفَض أيضاً');
}

console.log(`\nv7ModelPayloadIssueEvidence.test.js: ${n}/${n} assertions passed`);

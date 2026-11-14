'use strict';

// deviceCheck03Round2.test.js — جدول توقّعات الجولة الثانية لسكربت الفحص ٠٣ (الجزء السادس، 2026-10-14 +03). لا functions/src.
//
// الأمر (منقول من المنسّق، غير متحقَّق من الوثيقة): الجولة ٢ بختم 70 بالوسوم B8 (فحص مستقلّ على الـS21 Ultra) وS1 وS2 (الجلستان، والـS10 5G هاتف الزبون)، فجدول الجولة ١ (B1 · B2 · S1 · S2 · WAIT، 1.0.11 وختم 69)
// كان يُخرج لـS1/S2 فشلاً كاذباً في الإصدار، وB8 بلا توقّعات. **والإصدار لكل مجموعة (الجزء السابع، 2026-10-14؛ DEVICE-CHECK-03-2026-10-10.md:343 كما نُقل): B8 على 1.0.12 وS1 وS2 على 1.0.14** — لا إصدار واحد للجولة. `--round 2` يختار الجدول الثاني TAG_EXPECTATIONS_R2؛ وغيابه الجولة ١ كما كانت؛ وأيّ قيمة غير 1 أو 2 USAGE (القاعدة 22). جدول الجولة ١ وحارسه لا يُمسّان.
//
// ما يغطّيه: (١) الاختيار من main الحقيقية (كما في de05f19) لا من evaluateReport وحدها: --round 2 يختار الثاني، وغيابه و--round 1 الأوّل، وغير ذلك USAGE (رمز 2 قبل أيّ قراءة).
// (٢) كل سطر في الجدول الثاني: مصدره DEVICE-CHECK-03-2026-10-10.md:<سطر>، واقتباسه حرفياً (مكتوب هنا مستقلّاً عن الكود)، وقاعدته. (٣) أحكام الوسوم الثلاثة: إيجابية ثم سلبية لكل توقّع، ومنها M-15 تحديداً.
// (٤) ما لا يُحكم به من الخادم (بطاقة شاشة الزبون :193) لا صفّ له. (٥) جدول الجولة ١ لم يتغيّر (sha256 لتسلسله).
// (٦) الحكم على الإصدار بالقيم الأربع عبر main الحقيقية (--round 2) لا بقراءة الجدول: S1 وS2 بـ1.0.14 PASS وبـ1.0.12 FAIL، وB8 بـ1.0.12 PASS وبـ1.0.14 FAIL، والغائب NOT_MEASURED.
//
// Run: node functions/test/deviceCheck03Round2.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const N = require('../src/analysis/fv68Names');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const {EVALUATION_RULES_VERSION, EVALUATION_RULES_VERSION_FIELD} = require('../src/analysis/evaluationRulesVersion');
const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const D = require('../scripts/lib/deviceCheck03After');
const C = require('../scripts/lib/deviceCheck03Common');
const H = require('./lib/deviceCheck03Harness');
const {makeMemDb} = require('./lib/memFirestore');
const {main} = require('../scripts/device-check-03-after-readonly');

const V = D.VERDICT;
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEM = 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const clone = (x) => JSON.parse(JSON.stringify(x));
const goldenOf = (suffix) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `${STEM}${suffix}.json`), 'utf8'));
const NOW = 1_800_000_000_000;
// الجولة ١ كما سُلِّمت عند d14c558، مقيسة بالأداة: `git archive d14c558` إلى مجلّد مؤقّت ثم require للوحدة ثم sha256 لـJSON.stringify (2026-10-14)؛ والتعليق أن جدول الجولة ١ وقواعدها لا يُمسّان.
const ROUND1_TABLE_SHA256 = '28aee75c8aaae5cb1b43fdac53a87fc59c4db4000a5f75149ddf03df51b71250';
const ROUND1_RULES_SHA256 = '75fe970562195c50ce9d40eb019b43c9342f4029f5daac6bebd55684b33fe149';
const OWNER_UID = 'uid-OWNER-R2-424242';
const EMAIL = 'owner-r2@example.test';
const ts = (ms) => ({toMillis: () => ms});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc03-round2-'));
let counter = 0;
const nextOut = () => path.join(tmp, `r2-${++counter}.json`);
const storageFileOf = (payload) => { const {timeSeriesState, ...file} = payload.timeSeries; void timeSeriesState; return file; };
const {auth} = H.makeRecordingAuth(async (email) => { if (email !== EMAIL) throw Object.assign(new Error('no user'), {code: 'auth/user-not-found'}); return {uid: OWNER_UID}; });

// ─── الحمولات: عيّنات fv70 الحقيقية بتعديل مكتوب ───
// إصدار كل وسم كما يحمله فحصه (DEVICE-CHECK-03-2026-10-10.md:343 كما نُقل: «S1 وS2 على 1.0.14، وB8 على 1.0.12 كما جرى») — **مكتوب هنا مستقلّاً عن ثوابت الكود** (تُحكم النتيجة لا وصول القيمة)، مُدخلاً لا توقّعاً مقارَناً بالثابت نفسه.
const BUILD_OF = Object.freeze({B8: '1.0.12', S1: '1.0.14', S2: '1.0.14'});
const withApp = (p, tag) => { p.timeSeries.header.appVersion = BUILD_OF[tag]; return p; }; // العيّنات الذهبية تحمل ترويسة 1.0.11 (ملفّها الزمني أقدم)؛ وفحص كل وسم يحمل إصداره
const toM15 = (p) => { p.manualResults.find((e) => e.testId === 'M-08').testId = D.M15_TEST_ID; return p; }; // M-08 unavailable في العيّنة ⟵ M-15 unavailable (بطاقة SD)
const cleanC13 = () => { const p = clone(goldenOf('13ch-selinux-blocked-policy')); Object.assign(p.timeSeries.footer.verificationResults.cpuKnownAnswerRuns[4], {sieveStatus: 'match', sievePrimeCount: 78498}); return p; }; // بلا عدم تطابق D الذي في العيّنة (لا يخصّ هذا الجدول)
const zeroCycles = (p) => { Object.assign(p.timeSeries.footer.batteryHealth, {cycleCount: 0, cycleCountSource: 'extra_api34', cycleCountState: 'read'}); return p; };
const PAYLOADS = {
  B8: () => zeroCycles(toM15(withApp(clone(goldenOf('11ch-nothing-admitted')), 'B8'))), // M-02 auto_complete وشبكة كاملة، وصفر دورات من extra_api34
  S1: () => toM15(withApp(cleanC13(), 'S1')), // M-02 user_marked_not_working وشبكة جزئية، و187 دورة
  S2: () => toM15(withApp(cleanC13(), 'S2')),
};
const SHORT = {B8: 'NC-R2B800', S1: 'NC-R2S100', S2: 'NC-R2S200'};

function world(over = {}) {
  const reports = {}; const reportRaw = {}; const objects = {};
  for (const tag of ['B8', 'S1', 'S2']) {
    const payload = (over.payloads && over.payloads[tag]) ? over.payloads[tag](PAYLOADS[tag]()) : PAYLOADS[tag]();
    const scan = `r2-scan-${tag}`;
    const sp = `scans/sha-${tag}/${scan}.ts.json.gz`;
    reports[scan] = {shortId: SHORT[tag], userId: OWNER_UID, [EVALUATION_RULES_VERSION_FIELD]: EVALUATION_RULES_VERSION, pipeline: V7_PIPELINE_TAG};
    reportRaw[scan] = {scanId: scan, rawFingerprint: clone(lightenFingerprintForStorage(payload)), sessionId: tag === 'B8' ? null : `sess-r2-${tag}`, deviceFingerprintSha: `sha-${tag}`, timeSeriesStoragePath: sp, aiAudit: null};
    objects[sp] = H.gz(storageFileOf(payload));
  }
  const scanSessions = {};
  for (const tag of ['S1', 'S2']) scanSessions[`sess-r2-${tag}`] = {status: 'completed', joinedBy: `anon-${tag}`, joinedAt: ts(NOW - 5000), scanId: `r2-scan-${tag}`, ownerId: OWNER_UID, ...((over.sessions && over.sessions[tag]) || {})};
  const evaluations = {};
  for (const tag of ['S1', 'S2']) if (!(over.noEval || []).includes(tag)) evaluations[`r2-scan-${tag}`] = {pending: false, ownerMismatch: false, linkageIncomplete: false, linkageRawState: 'PRIVATE', missingLinkageFields: [], source: 'session', revisionCount: 0};
  return {collections: {reports, reportRaw, users: {[OWNER_UID]: {}}, scanSessions, evaluations}, objects};
}

// --cycle-expect يقبل وسوم --tokens وحدها؛ فتشغيل بوسم واحد أو اثنين يحمل توقّعاتهما فقط (التوقّع نفسه لكل وسم: B8 classified وS1/S2 none).
const CYCLE_EXPECT_BY_TAG = {B8: 'classified', S1: 'none', S2: 'none'};
const roundArgs = (tags) => ['--round', '2', '--cycle-expect', tags.map((t) => `${t}=${CYCLE_EXPECT_BY_TAG[t]}`).join(',')];
const ROUND2 = roundArgs(['B8', 'S1', 'S2']);
async function run(extraArgsIn, over = {}, tags = ['B8', 'S1', 'S2']) {
  const extraArgs = extraArgsIn === ROUND2 ? roundArgs(tags) : extraArgsIn;
  const {collections, objects} = world(over);
  const out = nextOut();
  const db = makeMemDb(collections);
  const r = await H.runMain(main, ['--tokens', tags.map((t) => `${t}=${SHORT[t]}`).join(','), '--out', out, ...extraArgs], {env: {[C.OWNER_EMAIL_ENV]: EMAIL}, now: () => NOW, db, auth, bucket: H.makeStubBucket(objects).bucket});
  return {...r, db, json: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null};
}
const cell = (j, tag, item) => j.table.find((x) => x.tag === tag && x.item === item);

(async () => {
  // ═════════ ١ — الاختيار من main الحقيقية ═════════
  const r2 = await run(ROUND2);
  eq(r2.code, 0, `[١] --round 2 على الوسوم الثلاثة المطابقة: رمز الخروج 0 (${(r2.errs || []).join(' | ').slice(0, 200)})`);
  deq(r2.json.table.filter((x) => x.verdict === V.FAIL).map((x) => `${x.tag}:${x.item}:${x.basis.slice(0, 80)}`), [], '[١] ولا FAIL في الجدول');
  deq([r2.json.input.round, r2.json.expectations.round, r2.json.expectations.tagsWithExpectations], [2, 2, ['B8', 'S1', 'S2']], '[١] المخرَج: input.round وexpectations.round = 2، وجدول التوقّعات B8 وS1 وS2');
  deq(r2.json.expectations.thisRun, [{tag: 'B8', special: true}, {tag: 'S1', special: true}, {tag: 'S2', special: true}], '[١] الوسوم الثلاثة ذات توقّعات خاصّة');
  deq(JSON.parse(JSON.stringify(r2.json.rules)), JSON.parse(JSON.stringify(D.ITEM_RULES_R2)), '[١] rules في المخرَج = قواعد الجولة ٢ (ITEM_RULES_R2) لا الجولة ١');
  deq(['B8', 'S1', 'S2'].map((t) => r2.json.rules.APP_VERSION.includes(`${t}: PASS: header.appVersion = ${BUILD_OF[t]}؛`)), [true, true, true], '[١] وقاعدة APP_VERSION تذكر لكل وسم إصداره: B8 بـ1.0.12 وS1 وS2 بـ1.0.14');
  ok(!r2.json.rules.APP_VERSION.includes('B1:') && !r2.json.rules.APP_VERSION.includes(`S1: PASS: header.appVersion = ${BUILD_OF.B8}`) && !r2.json.rules.APP_VERSION.includes(`B8: PASS: header.appVersion = ${BUILD_OF.S1}`), '[١] وبلا وسوم الجولة ١، ولا إصدار وسمٍ منسوباً إلى وسم آخر في القاعدة');
  for (const tag of ['B8', 'S1', 'S2']) {
    const rep = r2.json.reports.find((x) => x.tag === tag);
    deq([rep.expectations.special, rep.expectations.round, rep.expectations.appVersion, rep.expectations.fieldsVersion, rep.versions && rep.versions.appVersion, rep.versions && rep.versions.fieldsVersion], [true, 2, BUILD_OF[tag], 70, BUILD_OF[tag], 70], `[١] ${tag}: توقّعات ${BUILD_OF[tag]} وختم 70 والمرصود يطابقها`);
    deq([cell(r2.json, tag, 'APP_VERSION').verdict, cell(r2.json, tag, 'FIELDS_VERSION').verdict], [V.PASS, V.PASS], `[١] ${tag}: صفّا الإصدار PASS (لا فشل كاذباً 1.0.11/69)`);
  }
  // (يُستبدَل بهذين ما كان يثبّت «كل وسم في الجدول الثاني = 1.0.12»: الإصدار صار لكل مجموعة، فمصدراه المُصدَّران مختلفان، وكل مجموعة تحمل مصدرها وحده (لا نسخة حرفية في سطر). والحكم بالقيم الأربع في [٣] عبر main الحقيقية.)
  eq(D.EXPECTED_APP_VERSION_R2_B8 !== D.EXPECTED_APP_VERSION_R2_SESSIONS && D.EXPECTED_APP_VERSION_R2_B8 === D.TAG_EXPECTATIONS_R2.B8.appVersion, true, '[١] مصدران مُصدَّران مختلفان؛ B8 يحمل مصدره');
  eq(['S1', 'S2'].every((t) => D.TAG_EXPECTATIONS_R2[t].appVersion === D.EXPECTED_APP_VERSION_R2_SESSIONS) && Object.values(D.TAG_EXPECTATIONS_R2).every((e) => e.fieldsVersion === N.FIELDS_VERSION_70), true, '[١] S1 وS2 يحملان مصدرهما المشترك، وكل وسم بختم 70');

  // الغياب = الجولة ١ كما اليوم؛ و--round 1 مثله
  for (const [label, args] of [['بلا --round', []], ['--round 1', ['--round', '1']]]) {
    const r1 = await run(args);
    deq([r1.json.input.round, r1.json.expectations.tagsWithExpectations, r1.json.expectations.thisRun], [1, ['B1', 'B2', 'S1', 'S2', 'WAIT'], [{tag: 'B8', special: false, note: 'بلا توقّعات خاصّة: القواعد العامّة وحدها'}, {tag: 'S1', special: true}, {tag: 'S2', special: true}]], `[١] ${label}: جدول الجولة ١ (B8 بلا توقّعات خاصّة)`);
    deq([cell(r1.json, 'S1', 'APP_VERSION').verdict, /expected=1\.0\.11/.test(cell(r1.json, 'S1', 'APP_VERSION').basis), cell(r1.json, 'S1', 'FIELDS_VERSION').verdict, /expected=69/.test(cell(r1.json, 'S1', 'FIELDS_VERSION').basis)], [V.FAIL, true, V.FAIL, true], `[١] ${label}: S1 على 1.0.14/70 يُحكم عليه بتوقّعات الجولة ١ (1.0.11 وختم 69) ⟵ FAIL — وهذا ما كان يُخرجه السكربت`);
    eq(r1.json.rules.APP_VERSION.includes('B1: PASS: header.appVersion = 1.0.10'), true, `[١] ${label}: قواعد الجولة ١ في المخرَج`);
  }
  // قيمة غير 1 أو 2 ⟵ USAGE برمز 2 قبل أيّ قراءة
  for (const bad of ['3', '0', '', 'two', '2.0', ' 2', '02', '-1']) {
    const rr = await run(['--round', bad]);
    ok(rr.code === 2 && rr.errs.some((e) => /USAGE: --round: 1 أو 2/.test(e)) && rr.db.reads.length === 0 && rr.json === null, `[١] --round "${bad}": USAGE (2) قبل أيّ قراءة ولا مخرَج`);
  }
  {
    const rr = await run(['--round']);
    ok(rr.code === 2 && rr.db.reads.length === 0, '[١] --round بلا قيمة: خطأ (2) قبل أيّ قراءة');
    const dup = await run(['--round', '1', '--round', '2']);
    ok(dup.code === 2 && dup.db.reads.length === 0, '[١] --round مكرَّر: خطأ (2)');
    const pre = await H.runMain(main, ['--preflight', '--round', '2'], {env: {[C.OWNER_EMAIL_ENV]: EMAIL}});
    ok(pre.code === 2 && /--preflight وحدها/.test(pre.errs.join('')), '[١] --preflight مع --round: USAGE');
    let thrown = null;
    try { D.evaluateReport({tag: 'B8', found: 0}, {accountHash: 'u', round: 3}); } catch (e) { thrown = e; }
    ok(thrown && /USAGE: --round: 1 أو 2/.test(thrown.message), '[١] evaluateReport نفسها ترفض جولة غير 1 و2 (لا اختيار صامت)');
    deq([D.roundOf(undefined), D.roundOf(1), D.roundOf(2)], [1, 1, 2], '[١] roundOf: الغائب 1');
    for (const v of [0, 3, '2', null, NaN]) { let e = null; try { D.roundOf(v); } catch (x) { e = x; } ok(e !== null, `[١] roundOf(${JSON.stringify(v)}) يرمي`); }
  }
  const pf = D.preflightChecks({});
  ok(pf.ok && pf.checks.some((c) => /الجولة ٢: --round/.test(c.name)) && pf.checks.some((c) => /جدول الجولة ٢/.test(c.name)), '[١] الفحص الذاتي (--preflight) يغطّي الجولة ٢ ويمرّ');

  // ═════════ ٢ — كل سطر في الجدول الثاني: مصدر واحد باسم الوثيقة وسطرها، واقتباس حرفي، وقاعدة ═════════
  // الاقتباسات مكتوبة هنا مستقلّةً عن الكود (منقولة من أمر المنسّق 2026-10-14، غير متحقَّقة من الوثيقة، بلا علامات markdown)
  const QUOTE = {
    278: 'البناء صار 1.0.12 = ce7c517 (APK 5401331c…، 36738226 بايتاً؛ evidence/apk-build-2026-10-13-ce7c517-launchRelease/).',
    343: 'S1 وS2 على 1.0.14، وB8 على 1.0.12 كما جرى', // جزء حرفي من السطر بلا رمز التقرير (لا رمز تقرير حقيقي في المستودع)
    342: 'وfieldsVersion 70 كما هو، ولا تغيير في الخادم.', // نصّه الخامّ في الأمر «- **و`fieldsVersion` 70 كما هو، ولا تغيير في الخادم.**»؛ الاقتباس بلا markdown كما في 297
    295: 'و«يعمل» على M-02: يجب أن تفتح الشبكة. أكملها.',
    294: 'وشريحة «غير متوفر»: اضغطها على M-15 (بطاقة SD، غائبة فعلاً في الـS21 Ultra بنصّك)؛',
    303: 'وفي ب٣ الشبكة بزرّ الفنّي كما في الخطّة (لمس خلايا قليلة، ثم ~15 ث، ثم «لا يعمل»).',
    268: 'شبكة اللمس بزرّ الفنّي: المس خلايا قليلة، وانتظر نحو 15 ثانية، واضغط «لا يعمل».',
    302: 'شريحة «غير متوفر» على M-15: الـS10 5G (SM-G977N) بلا مكان لبطاقة SD، فهي إجابة صادقة لا مصطنعة (بنصّك)؛',
    297: 'ب٣ وب٤، مع ج٨ يعمل على الكمبيوتر طوال كل جلسة: blocks/c8-s10-logcat-session.ps1 -Label S1 ثم -Label S2.',
    191: 'لا مستند تقييم بعد أيّ من الجلستين (البند ٦: شرط توقّف قبل الشريك).',
  };
  const DOC = 'DEVICE-CHECK-03-2026-10-10.md';
  const src = (...ls) => ls.map((l) => `${DOC}:${l}`).join(' + ');
  const qt = (...ls) => ls.map((l) => QUOTE[l]).join(' / ');
  const EXPECTED_LINES = {
    B8: [
      ['APP_VERSION', src(278), qt(278)], ['FIELDS_VERSION', src(278), qt(278)],
      ['EXPECT_M02_AUTO_COMPLETE_FULL_GRID', src(295), qt(295)],
      ['EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT', src(294), qt(294)],
    ],
    S1: [
      ['APP_VERSION', src(343), qt(343)], ['FIELDS_VERSION', src(342), qt(342)], // ختم S1 وS2 من :342 (الجزء السابع) لا :278 (بناء 1.0.12)
      ['EXPECT_M02_NOT_WORKING_PARTIAL_GRID', src(303, 268), qt(303, 268)],
      ['EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT', src(302), qt(302)],
      ['SESSION_STATUS', src(297), qt(297)], ['SESSION_JOINED_BY', src(297), qt(297)], ['EVALUATION_DOC', src(297, 191), qt(297, 191)],
    ],
    S2: [
      ['APP_VERSION', src(343), qt(343)], ['FIELDS_VERSION', src(342), qt(342)],
      ['EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT', src(302), qt(302)],
      ['SESSION_STATUS', src(297), qt(297)], ['SESSION_JOINED_BY', src(297), qt(297)], ['EVALUATION_DOC', src(297, 191), qt(297, 191)],
    ],
  };
  for (const tag of ['B8', 'S1', 'S2']) {
    const lines = r2.json.expectations.table[tag].lines;
    deq(lines.map((l) => [l.item, l.source, l.quote]), EXPECTED_LINES[tag], `[٢] ${tag}: أسطر الجدول بأسمائها ومصادرها (DEVICE-CHECK-03-2026-10-10.md:<سطر>) واقتباساتها الحرفية`);
    ok(lines.every((l) => new RegExp(`^${DOC.replace('.', '\\.')}:\\d+( \\+ ${DOC.replace('.', '\\.')}:\\d+)*$`).test(l.source) && l.quote.length > 0 && l.rule.length > 0), `[٢] ${tag}: كل سطر بمصدر ممَّيز واقتباس غير فارغ وقاعدة مكتوبة`);
    ok(lines.every((l) => !/\*\*|`/.test(l.quote)), `[٢] ${tag}: الاقتباسات بلا علامات markdown`);
    ok(lines.filter((l) => /^EXPECT_/.test(l.item)).every((l) => typeof r2.json.rules[l.item] === 'string' && r2.json.rules[l.item].includes(`${DOC}:`) && r2.json.rules[l.item].includes('«')), `[٢] ${tag}: وكل صفّ EXPECT فيه له قاعدة في rules بنصّه واقتباسه وسطر وثيقته`);
  }
  ok(!r2.json.expectations.table.S2.lines.some((l) => /M02/.test(l.item)), '[٢] S2: لا توقّع لـM-02 (بنصّ الأمر)');
  ok(!/NC-/.test(JSON.stringify(D.TAG_EXPECTATIONS_R2)) && !/NC-/.test(JSON.stringify(D.ITEM_RULES_R2)), '[٢] لا رمز تقرير (NC-…) في جدول الجولة ٢ ولا في قواعدها: اقتباس :343 بلا الرمز');
  ok(!r2.json.expectations.table.B8.lines.some((l) => /CYCLE/.test(l.item)) && !Object.values(D.TAG_EXPECTATIONS_R2).some((e) => e.lines.some((l) => /CYCLE/.test(l.item))), '[٢] الدورات بوسيط --cycle-expect لا في الجدول');
  // الاقتباس الفعلي في الكود يطابق نصّ الأمر المكتوب هنا حرفاً بحرف
  eq(JSON.stringify(Object.values(D.TAG_EXPECTATIONS_R2).flatMap((e) => e.lines.map((l) => [l.source, l.quote]))), JSON.stringify(Object.values(EXPECTED_LINES).flatMap((ls) => ls.map(([, s, q]) => [s, q]))), '[٢] مصادر الجدول واقتباساته في الكود = المكتوبة هنا');

  // ═════════ ٣ — الأحكام: إيجابية ثم سلبية لكل توقّع ═════════
  deq(['B8', 'S1', 'S2'].map((t) => cell(r2.json, t, 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').verdict), [V.PASS, V.PASS, V.PASS], '[٣] M-15 unavailable ⟵ PASS للثلاثة');
  ok(/M-15:status=unavailable NOT_MEASURED\/HARDWARE_ABSENT/.test(cell(r2.json, 'B8', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').basis), '[٣] وأساسه: حالة M-15 وتصنيفه NOT_MEASURED/HARDWARE_ABSENT');
  eq(cell(r2.json, 'B8', 'EXPECT_M02_AUTO_COMPLETE_FULL_GRID').verdict, V.PASS, '[٣] B8: M-02 auto_complete وشبكة كاملة PASS');
  eq(cell(r2.json, 'S1', 'EXPECT_M02_NOT_WORKING_PARTIAL_GRID').verdict, V.PASS, '[٣] S1: M-02 user_marked_not_working وشبكة جزئية PASS');
  eq(r2.json.table.some((x) => x.tag === 'S2' && /EXPECT_M02/.test(x.item)), false, '[٣] S2: لا صفّ M-02 توقّعاً');
  deq(['S1', 'S2'].flatMap((t) => ['SESSION_STATUS', 'SESSION_JOINED_BY', 'EVALUATION_DOC'].map((i) => cell(r2.json, t, i).verdict)), Array(6).fill(V.PASS), '[٣] الجلستان: الحالة وjoinedBy ومستند التقييم PASS');
  deq(['B8', 'S1', 'S2'].map((t) => cell(r2.json, t, 'CYCLE_CLASSIFICATION').verdict), [V.PASS, V.PASS, V.PASS], '[٣] الدورات بوسيط --cycle-expect: B8 classified وS1/S2 none ⟵ PASS');
  deq(['B8', 'S1', 'S2'].map((t) => cell(r2.json, t, 'EVALUATION_RULES_STAMP').verdict), [V.PASS, V.PASS, V.PASS], '[٣] ختم القواعد PASS');
  // سلبية
  const mutateM15 = (fn) => ({payloads: {B8: (mk) => { const p = mk; fn(p); return p; }}});
  {
    const absent = await run(ROUND2, mutateM15((p) => { p.manualResults = p.manualResults.filter((e) => e.testId !== D.M15_TEST_ID); }), ['B8']);
    deq([cell(absent.json, 'B8', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').verdict, /NO_M15_ENTRY/.test(cell(absent.json, 'B8', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').basis), absent.code], [V.FAIL, true, 1], '[٣] M-15 غائب من manualResults ⟵ FAIL (الإجابة مطلوبة عمداً) ورمز 1');
    const passed = await run(ROUND2, mutateM15((p) => { p.manualResults.find((e) => e.testId === D.M15_TEST_ID).status = 'pass'; }), ['B8']);
    deq([cell(passed.json, 'B8', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').verdict, /status=pass/.test(cell(passed.json, 'B8', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').basis)], [V.FAIL, true], '[٣] M-15 حالته pass ⟵ FAIL');
    const notTested = await run(ROUND2, mutateM15((p) => { p.manualResults.find((e) => e.testId === D.M15_TEST_ID).status = 'not_tested'; }), ['B8']);
    eq(cell(notTested.json, 'B8', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').verdict, V.FAIL, '[٣] M-15 حالته not_tested ⟵ FAIL');
    const otherUnavailable = await run(ROUND2, mutateM15((p) => { p.manualResults.find((e) => e.testId === D.M15_TEST_ID).testId = 'M-08'; }), ['B8']);
    deq([cell(otherUnavailable.json, 'B8', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').verdict, cell(otherUnavailable.json, 'B8', 'EXPECT_MANUAL_UNAVAILABLE_HARDWARE_ABSENT')], [V.FAIL, undefined], '[٣] unavailable على M-08 لا يكفي: الحكم على M-15 تحديداً (لا «أيّ unavailable»)');
    const notWorking = await run(ROUND2, mutateM15((p) => { const m = p.manualResults.find((e) => e.testId === 'M-02'); m.status = 'fail'; m.measurements.endReason = 'user_marked_not_working'; m.measurements.touchedCells = 10; }), ['B8']);
    eq(cell(notWorking.json, 'B8', 'EXPECT_M02_AUTO_COMPLETE_FULL_GRID').verdict, V.FAIL, '[٣] B8: M-02 «لا يعمل» ⟵ FAIL (يجب أن تفتح الشبكة وتُكمَل)');
    const wrongVersion = await run(ROUND2, mutateM15((p) => { p.timeSeries.header.appVersion = '1.0.11'; }), ['B8']);
    deq([cell(wrongVersion.json, 'B8', 'APP_VERSION').verdict, /expected=1\.0\.12/.test(cell(wrongVersion.json, 'B8', 'APP_VERSION').basis)], [V.FAIL, true], '[٣] B8 بترويسة 1.0.11 ⟵ FAIL (التوقّع 1.0.12)');
    const wrongFv = await run(ROUND2, mutateM15((p) => { p.timeSeries.footer.fieldsVersion = 69; }), ['B8']);
    deq([cell(wrongFv.json, 'B8', 'FIELDS_VERSION').verdict, /expected=70 \(exact\)/.test(cell(wrongFv.json, 'B8', 'FIELDS_VERSION').basis)], [V.FAIL, true], '[٣] B8 بختم 69 ⟵ FAIL (التوقّع 70 بالضبط)');
    const noMeta = await run(ROUND2, {payloads: {S1: (p) => { p.manualResults = p.manualResults.filter((e) => e.testId !== D.M15_TEST_ID); return p; }}}, ['S1']);
    eq(cell(noMeta.json, 'S1', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').verdict, V.FAIL, '[٣] S1: M-15 غائب ⟵ FAIL');
    const s2NoM15 = await run(ROUND2, {payloads: {S2: (p) => { p.manualResults = p.manualResults.filter((e) => e.testId !== D.M15_TEST_ID); return p; }}}, ['S2']);
    eq(cell(s2NoM15.json, 'S2', 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').verdict, V.FAIL, '[٣] S2: M-15 غائب ⟵ FAIL');
    const s1Full = await run(ROUND2, {payloads: {S1: (p) => { const m = p.manualResults.find((e) => e.testId === 'M-02'); m.status = 'pass'; m.measurements.endReason = 'auto_complete'; m.measurements.touchedCells = 120; return p; }}}, ['S1']);
    eq(cell(s1Full.json, 'S1', 'EXPECT_M02_NOT_WORKING_PARTIAL_GRID').verdict, V.FAIL, '[٣] S1: شبكة كاملة بدل «لا يعمل» ⟵ FAIL');
    const noEval = await run(ROUND2, {noEval: ['S1']}, ['S1']);
    eq(cell(noEval.json, 'S1', 'EVALUATION_DOC').verdict, V.FAIL, '[٣] S1: لا مستند تقييم ⟵ FAIL (شرط التوقّف)');
    const noJoined = await run(ROUND2, {sessions: {S2: {joinedBy: ''}}}, ['S2']);
    eq(cell(noJoined.json, 'S2', 'SESSION_JOINED_BY').verdict, V.FAIL, '[٣] S2: joinedBy فارغ ⟵ FAIL');
    const pendingSession = await run(ROUND2, {sessions: {S1: {status: 'scanning'}}}, ['S1']);
    eq(cell(pendingSession.json, 'S1', 'SESSION_STATUS').verdict, V.FAIL, '[٣] S1: الجلسة scanning لا completed ⟵ FAIL');
    // الدورات بالوسيط: عكس التوقّع ⟵ FAIL
    const swappedCycles = await run(['--round', '2', '--cycle-expect', 'B8=none,S1=classified,S2=classified']);
    deq(['B8', 'S1', 'S2'].map((t) => cell(swappedCycles.json, t, 'CYCLE_CLASSIFICATION').verdict), [V.FAIL, V.FAIL, V.FAIL], '[٣] --cycle-expect معكوساً ⟵ FAIL للثلاثة (الجدول لا يحمل توقّع الدورات)');
  }
  // غياب S2 (جلسة ثانية لم تُجرَ): الأمر بوسمين يعمل، وبرمز S2 غير موجود ⟵ REPORT_FOUND FAIL باسمه لا نجاح صامت
  {
    const two = await run(['--round', '2', '--cycle-expect', 'B8=classified,S1=none'], {}, ['B8', 'S1']);
    deq([two.code, two.json.input.tags.map((t) => t.tag), two.json.table.some((x) => x.tag === 'S2')], [0, ['B8', 'S1'], false], '[٣] بلا S2 (الجلسة الثانية لم تُجرَ): الأمر بوسمين يمرّ (0) وبلا صفوف S2');
    const {collections, objects} = world();
    const out = nextOut();
    const miss = await H.runMain(main, ['--tokens', `B8=${SHORT.B8},S1=${SHORT.S1},S2=NC-NOSUCH`, '--out', out, '--round', '2', '--cycle-expect', 'B8=classified,S1=none,S2=none'], {env: {[C.OWNER_EMAIL_ENV]: EMAIL}, now: () => NOW, db: makeMemDb(collections), auth, bucket: H.makeStubBucket(objects).bucket});
    const mj = JSON.parse(fs.readFileSync(out, 'utf8'));
    deq([miss.code, cell(mj, 'S2', 'REPORT_FOUND').verdict, mj.table.filter((x) => x.tag === 'S2' && x.verdict === V.PASS).length], [1, V.FAIL, 0], '[٣] برمز S2 لا مستند له: REPORT_FOUND FAIL ورمز 1، وكل بند S2 آخر NOT_MEASURED:REPORT_ABSENT (لا PASS)');
    ok(mj.table.filter((x) => x.tag === 'S2' && x.item === 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT').every((x) => x.verdict === V.NOT_MEASURED && /REPORT_ABSENT/.test(x.basis)), '[٣] وصفّ M-15 للوسم الغائب NOT_MEASURED:REPORT_ABSENT (توقّعات الجولة ٢ تصل حتى حالة الغياب)');
  }

  // ═════════ ٤ — ما لا يُحكم به من الخادم ═════════
  ok(!r2.json.table.some((x) => /CARD|SCREEN|CUSTOMER|بطاقة/i.test(x.item)), '[٤] لا صفّ لظهور البطاقة على شاشة الزبون (:193) — لا يُقرأ من الخادم (القاعدة 22)');
  deq(r2.json.expectations.notJudgedFromServer, [{what: 'ظهور البطاقة على شاشة الزبون', source: `${DOC}:193`, judgedBy: 'ج٨ (سجلّ الهاتف)', reason: 'لا يُقرأ من الخادم (القاعدة 22): لا صفّ يدّعيه'}], '[٤] المخرَج يذكر أنه يُحكم به من ج٨');
  eq(r1Has('notJudgedFromServer'), false, '[٤] ولا يظهر في مخرَج الجولة ١');
  function r1Has(key) { return Object.prototype.hasOwnProperty.call(D.expectationsOutput(['B1']), key); }

  // ═════════ ٥ — جدول الجولة ١ وحارسه لم يتغيّرا ═════════
  deq(Object.keys(D.TAG_EXPECTATIONS), ['B1', 'B2', 'S1', 'S2', 'WAIT'], '[٥] الجولة ١: الوسوم الخمسة بأسمائها');
  eq(crypto.createHash('sha256').update(JSON.stringify(D.TAG_EXPECTATIONS)).digest('hex'), ROUND1_TABLE_SHA256, '[٥] تسلسل TAG_EXPECTATIONS (الجولة ١) كما كان عند d14c558 بايتاً (sha256)');
  eq(crypto.createHash('sha256').update(JSON.stringify(D.ITEM_RULES)).digest('hex'), ROUND1_RULES_SHA256, '[٥] ITEM_RULES (قواعد الجولة ١) كما كانت عند d14c558 بايتاً (sha256)');
  deq(D.expectationsOutput(['B1', 'S2']).tagsWithExpectations, ['B1', 'B2', 'S1', 'S2', 'WAIT'], '[٥] expectationsOutput بلا جولة = الجولة ١');
  deq([D.tagExpectation('B8'), D.tagExpectation('B8', 1)], [null, null], '[٥] B8 بلا توقّعات في الجولة ١');
  deq([D.tagExpectation('B1', 2), D.tagExpectation('B2', 2), D.tagExpectation('WAIT', 2)], [null, null, null], '[٥] وسوم الجولة ١ بلا توقّعات في الجولة ٢ (القواعد العامّة وحدها ويُعلَن)');
  deq(D.expectationBlock('B1', 2), {special: false, note: 'وسم بلا توقّعات خاصّة: القواعد العامّة وحدها (الوسوم ذات التوقّعات في الجولة 2: B8 · S1 · S2)'}, '[٥] وسم الجولة ١ في الجولة ٢ يُعلَن بلا توقّعات خاصّة باسم وسوم الجولة ٢');
  eq(Object.values(D.EXPECT).every((id) => D.ITEM_RULES[id].includes(`${DOC}:`)), true, '[٥] قواعد EXPECT في الجولة ١ كما كانت (كلّها بسطر وثيقة)');
  ok(!('EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT' in D.ITEM_RULES) && Object.values(D.EXPECT_R2).every((id) => typeof D.ITEM_RULES_R2[id] === 'string' && !(id in D.ITEM_RULES)), '[٥] صفّ M-15 للجولة ٢ وحدها: لا قاعدة له في الجولة ١ (EXPECT نفسه لم يُمسّ)');

  // ═════════ ٦ — الإصدار: الحكم بالقيم الأربع عبر main الحقيقية (--round 2)، لا بقراءة الجدول ═════════
  // الحمولة تحمل الإصدار في ترويستها (header.appVersion) والحكم يخرج من الملفّ المكتوب كما يُشغَّل السكربت. القيم مُدخلات مكتوبة هنا (BUILD_OF) لا ثوابت الكود.
  {
    const withVersion = (tag, version) => ({payloads: {[tag]: (mk) => { if (version === null) delete mk.timeSeries.header.appVersion; else mk.timeSeries.header.appVersion = version; return mk; }}});
    const at = async (tag, version) => { const r = await run(ROUND2, withVersion(tag, version), [tag]); const c = cell(r.json, tag, 'APP_VERSION'); return {verdict: c.verdict, basis: c.basis, code: r.code, seen: r.json.reports.find((x) => x.tag === tag).versions.appVersion}; };
    const GOOD = {B8: BUILD_OF.B8, S1: BUILD_OF.S1, S2: BUILD_OF.S2};
    const OTHER = {B8: BUILD_OF.S1, S1: BUILD_OF.B8, S2: BUILD_OF.B8}; // الإصدار الذي يخصّ المجموعة الأخرى
    for (const tag of ['B8', 'S1', 'S2']) {
      const good = await at(tag, GOOD[tag]);
      deq([good.verdict, good.basis, good.code], [V.PASS, `appVersion=${GOOD[tag]} expected=${GOOD[tag]}`, 0], `[٦] ${tag} بـ${GOOD[tag]} ⟵ PASS (رمز الخروج 0)`);
      const other = await at(tag, OTHER[tag]);
      deq([other.verdict, other.basis, other.code], [V.FAIL, `appVersion=${OTHER[tag]} expected=${GOOD[tag]}`, 1], `[٦] ${tag} بـ${OTHER[tag]} (إصدار المجموعة الأخرى) ⟵ FAIL (رمز الخروج 1)`);
      const absent = await at(tag, null);
      deq([absent.verdict, absent.basis, absent.seen], [V.NOT_MEASURED, 'header.appVersion غائب', null], `[٦] ${tag} بلا header.appVersion ⟵ NOT_MEASURED لا PASS ولا FAIL`);
    }
    // لا يمرّ بالجولة ١ (1.0.11) ولا بإصدار قريب في الجولة ٢
    for (const [tag, v] of [['S1', '1.0.11'], ['S2', '1.0.13'], ['B8', '1.0.11'], ['B8', '1.0.13']]) {
      const x = await at(tag, v);
      eq(x.verdict, V.FAIL, `[٦] ${tag} بـ${v} ⟵ FAIL (لا يمرّ بإصدار الجولة ١ ولا بإصدار قريب)`);
    }
  }

  fs.rmSync(tmp, {recursive: true, force: true}); // مجلّد الاختبار المؤقّت الذي أنشأه هذا الاختبار وحده
  console.log(`\ndeviceCheck03Round2.test.js: ${n} assertions passed`);
})().catch((e) => {
  try { fs.rmSync(tmp, {recursive: true, force: true}); } catch (x) { void x; }
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});


'use strict';

// deviceCheck03After.test.js — السكربت device-check-03-after-readonly.js ومكتبته scripts/lib/deviceCheck03After.js (فحص الجهاز ٠٣، الكتلتان ج٣ وج٤، 2026-10-10 +03).
// وحدة بلا شبكة ولا محاكٍ؛ المسار على المحاكي: deviceCheck03.e2e.test.js؛ وحارس «لا كتابة» وطفراته: deviceCheck03ReadOnlyGuard.test.js.
//
// أمر المنسّق (بنصّه المنقول): السكربت ٢ — لكل رمز: reports ⟵ scanId ⟵ reportRaw/{scanId}، ثم قرّاؤنا (readFv68 وtestKinds). ويُخرج: header.appVersion وfooter.fieldsVersion · M-02 · SN-04 · اليدوي وتصنيف unavailable
// وhiddenByModel · «D للمعالج» (مجموع زمن D في كل مرحلة ÷ زمنها، وحكم ≤ 1%) · سلوك الجهاز · الجلسة وevaluations · عدد تقارير المالك · جدول واحد بالبنود وحكم كلٍّ، والحكم من قيم المخرَج.
//   ١ — الوسائط والرموز.  ٢ — العيّنات الذهبية الثلاث (القاعدة 41): كل بند بقيمته، والأرقام تُحسَب هنا بكود مستقلّ عن السكربت.  ٣ — «D للمعالج»: الحدّ والفشل وكل غياب.
//   ٤ — الإصدارات والشذوذ.  ٥ — M-02.  ٦ — SN-04.  ٧ — اليدوي.  ٨ — بنود السلوك وشذوذ أقسامها.  ٩ — الدورات وB-08.  ١٠ — الجلسة وevaluations.  ١١ — غياب التقرير/الخامّ/Storage.
//   ١٢ — جمع الحقائق على db مزيَّف.  ١٣ — main: المخرَج بلا بريد ولا معرّف خامّ، والملفّ wx، وأخطاء Storage.
//
// الاستبدال معلَن (القاعدة 37): db وbucket وAuth مزيَّفة في الوحدة وحدها؛ وملفّ Storage يُشتقّ من timeSeries حمولة fv69 الذهبية (لا ملفّ Storage حقيقي مُلتزَم لـfv69). الطبقة الحقيقية في الـe2e.
//
// Run: node functions/test/deviceCheck03After.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const C = require('../scripts/lib/deviceCheck03Common');
const D = require('../scripts/lib/deviceCheck03After');
const {main} = require('../scripts/device-check-03-after-readonly');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const {REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');
const {RAW_LINKAGE_FIELDS} = require('../src/evaluations/evaluationContract');
const N = require('../src/analysis/fv68Names');
const readFv68Of = require('../src/analysis/fv68Reader').readFv68;
const {makeMemDb} = require('./lib/memFirestore');
const H = require('./lib/deviceCheck03Harness');

const V = D.VERDICT;
const I = D.ITEM;
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEM = 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const KEYS = {c11: '11ch-nothing-admitted', c13: '13ch-selinux-blocked-policy', c16: '16ch-four-policies-truncated-failures'};
const FV67_FILE = 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json'; // طلب 1.0.10 (ختم 67): جذره الطلب، والبصمة في .fingerprint
const payloadOf = (k) => (k === 'fv67' ? JSON.parse(fs.readFileSync(path.join(GOLDEN, FV67_FILE), 'utf8')).fingerprint : JSON.parse(fs.readFileSync(path.join(GOLDEN, `${STEM}${KEYS[k]}.json`), 'utf8')));
const clone = (x) => JSON.parse(JSON.stringify(x));

const SECRET_EMAIL = 'owner.s10.secret@example.test';
const OWNER_UID = 'uid-OWNER-SECRET-424242';
const ACCOUNT_HASH = C.hashIdForLog(OWNER_UID);
const NOW = 1_800_000_000_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc03-after-unit-'));
let counter = 0;
const nextOut = () => path.join(tmp, `after-${++counter}.json`);
const ts = (ms) => ({toMillis: () => ms});

/** ملفّ Storage كما يرفعه التطبيق: timeSeries الحمولة بلا timeSeriesState (مشتقّ — استبدال معلَن). */
const storageFileOf = (payload) => { const {timeSeriesState, ...file} = payload.timeSeries; void timeSeriesState; return file; };

/**
 * حقائق تقرير من حمولة (بعد تطبيق mutate عليها). الخامّ = lightenFingerprintForStorage(الحمولة) كما يكتبه analyzeDevice الحقيقي؛ وStorage = timeSeries الحمولة.
 */
function factsOf(key, {mutate = null, tag = 'G1', storage = undefined, session = {state: 'NOT_A_SESSION_SCAN'}, evaluation = {exists: false}, ownerMatches = true, rawState = 'PRIVATE'} = {}) {
  const payload = payloadOf(key);
  if (mutate) mutate(payload);
  const lightened = clone(lightenFingerprintForStorage(payload));
  return {
    payload,
    facts: {
      tag, shortIdHash: C.hashIdForLog(`NC-${tag}`), found: 1, scanIdHash: C.hashIdForLog(`scan-${tag}`), userHash: ACCOUNT_HASH, ownerMatches,
      rawRead: {state: rawState, raw: {rawFingerprint: lightened, sessionId: null, deviceFingerprintSha: 'sha', timeSeriesStoragePath: 'p', aiAudit: null}},
      storage: storage === undefined ? {state: 'DOWNLOADED', json: storageFileOf(payload)} : storage,
      session, evaluation,
    },
  };
}
const evalOf = (key, opts) => { const {facts, payload} = factsOf(key, opts); return {...D.evaluateReport(facts, {accountHash: ACCOUNT_HASH}), facts, payload}; };
const rowOf = (res, item) => res.rows.find((r) => r.item === item);
const verdictOf = (res, item) => { const r = rowOf(res, item); return r ? r.verdict : undefined; };
const basisHas = (res, item, re) => { const r = rowOf(res, item); return !!r && re.test(r.basis); };
const setVr = (p, patch) => { Object.assign(p.timeSeries.footer.verificationResults, patch); };
const m02Of = (p) => p.manualResults.find((m) => m.testId === 'M-02');
const sn04Of = (p) => p.functionalResults.find((f) => f.testId === 'SN-04');

(async () => {
  // ═══ ١ — الوسائط والرموز ═══
  {
    const pt = D.parseTokens;
    deq(pt('B1=NC-AAAAAA,B2=NC-BBBBBB,S1=NC-CCCCCC,S2=NC-DDDDDD,WAIT=NC-EEEEEE').map((t) => t.tag), ['B1', 'B2', 'S1', 'S2', 'WAIT'], '[١] مثال الأمر بوسومه الخمسة');
    deq(pt(' B1 = NC-AAAAAA '.replace(/ = /, '=')).length, 1, '[١] مسافات حول العنصر تُقصّ');
    const bad = (text, re, m) => { let e = null; try { pt(text); } catch (x) { e = x; } ok(e && re.test(e.message), `${m} — ${e && e.message}`); };
    bad('', /فارغ/, '[١] فارغة');
    bad('NC-AAAAAA', /الوسم=NC-XXXXXX/, '[١] بلا وسم');
    bad('B1=NC-AAAAAA,B1=NC-BBBBBB', /وسم مكرَّر/, '[١] وسم مكرَّر');
    bad('B1=NC-AAAAAA,B2=NC-AAAAAA', /رمز مكرَّر/, '[١] رمز مكرَّر');
    bad('B1=nc-aaaaaa', /NC-XXXXXX/, '[١] حروف صغيرة');
    bad('B1=NC-AAAAA', /NC-XXXXXX/, '[١] رمز قصير');
    bad('1B=NC-AAAAAA', /وسم غير صالح/, '[١] وسم يبدأ برقم');
    bad('B 1=NC-AAAAAA', /وسم غير صالح/, '[١] وسم بمسافة');
    bad(`${'A'.repeat(25)}=NC-AAAAAA`, /وسم غير صالح/, '[١] وسم أطول من 24');
    bad(Array.from({length: 21}, (_, i) => `T${i}=NC-${String(i).padStart(6, '0')}`).join(','), /أكثر من 20/, '[١] أكثر من عشرين');
    bad('B1=NC-AAAAAA,,B2=NC-BBBBBB', /بلا =/, '[١] عنصر فارغ بين فاصلتين');
    const pa = D.parseArgs;
    deq(pa(['--tokens', 'B1=NC-AAAAAA', '--out', 'a.json']).useStorage, true, '[١] Storage مفعَّل افتراضياً');
    deq(pa(['--tokens', 'B1=NC-AAAAAA', '--out', 'a.json', '--no-storage']).useStorage, false, '[١] --no-storage يعطّله');
    // القاعدة 23: كان {mode, tokens, out, useStorage}؛ أُضيف cycleExpect (الجزء الخامس، 2026-10-13 +03).
    deq(pa(['--preflight']), {mode: 'preflight', tokens: null, out: null, useStorage: null, cycleExpect: null, round: null}, '[١] --preflight');
    deq(pa(['--tokens', 'B1=NC-AAAAAA', '--out', 'a.json']).cycleExpect, {}, '[١] بلا --cycle-expect: توقّع فارغ (لا افتراض لوسم)');
    deq(pa(['--tokens', 'S1=NC-AAAAAA,B1=NC-BBBBBB', '--out', 'a.json', '--cycle-expect', 'S1=classified,B1=none']).cycleExpect, {S1: 'classified', B1: 'none'}, '[١] --cycle-expect: وسيط لكل وسم');
    const badA = (argv, re, m) => { let e = null; try { pa(argv); } catch (x) { e = x; } ok(e && re.test(e.message), `${m} — ${e && e.message}`); };
    badA([], /USAGE: --tokens/, '[١] بلا وسائط');
    badA(['--tokens', 'B1=NC-AAAAAA'], /USAGE/, '[١] بلا --out');
    badA(['--out', 'a.json'], /USAGE/, '[١] بلا --tokens');
    badA(['--preflight', '--no-storage'], /--preflight وحدها/, '[١] --preflight مع --no-storage');
    badA(['--tokens', 'B1=NC-AAAAAA', '--out', 'a.json', '--email', 'x@y.z'], /وسيط مجهول --email/, '[١] البريد لا يُقبل من سطر الأمر');
    badA(['--tokens', 'B1=NC-AAAAAA', '--out', 'a.json', '--download-to', 'x'], /وسيط مجهول --download-to/, '[١] ولا مسار لحفظ الملفّ المنزَّل');
    badA(['--tokens', 'B1=NC-AAAAAA', '--tokens', 'B2=NC-BBBBBB', '--out', 'a.json'], /مكرَّر/, '[١] --tokens مكرَّر');
    badA(['--no-storage', '--no-storage', '--tokens', 'B1=NC-AAAAAA', '--out', 'a.json'], /مكرَّر/, '[١] --no-storage مكرَّر');
    const ce = (v) => ['--tokens', 'S1=NC-AAAAAA,B1=NC-BBBBBB', '--out', 'a.json', '--cycle-expect', v];
    badA(ce('S9=classified'), /ليس في --tokens/, '[١] --cycle-expect: وسم ليس في --tokens');
    badA(ce('S1=unsupported:zero_from_extra_api34'), /classified أو none/, '[١] --cycle-expect: القيمة ليست الوسم الحرفي (الكلمتان وحدهما)');
    badA(ce('S1=classified,S1=none'), /وسم مكرَّر/, '[١] --cycle-expect: وسم مكرَّر');
    badA(ce('S1'), /بلا =/, '[١] --cycle-expect: عنصر بلا =');
    badA(['--preflight', '--cycle-expect', 'S1=classified'], /--preflight وحدها/, '[١] --preflight مع --cycle-expect');
  }

  // ═══ ٢ — العيّنات الذهبية الثلاث: كل بند بقيمته (الأرقام بكود مستقلّ عن السكربت) ═══
  {
    const everyRowValid = (res, label) => ok(res.rows.every((r) => [V.PASS, V.FAIL, V.NOT_MEASURED, V.INFO].includes(r.verdict) && typeof r.basis === 'string' && r.basis.length > 0), `[٢] ${label}: كل صفّ بحكم من الأربعة وبأساس مكتوب`);
    // أرقام مستقلّة من الحمولة نفسها
    const independent = (payload) => {
      const samples = payload.timeSeries.samples;
      const ti = payload.timeSeries.variables.findIndex((v) => v.name === 'timestamp_ms');
      const gi = payload.timeSeries.variables.findIndex((v) => v.name === 'gpu_fps');
      const phase = {};
      for (const s of samples) { const p = (phase[s.phase] = phase[s.phase] || []); p.push(s.v[ti]); }
      const dur = (p) => Math.max(...phase[p]) - Math.min(...phase[p]);
      const t = samples.map((s) => s.v[ti]);
      const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
      const med = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
      let zeros = 0;
      for (let i = samples.length - 1; i >= 0 && samples[i].v[gi] === 0; i--) zeros++;
      const mean = (list) => { const xs = list.flatMap((e) => e.values); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
      const sn = sn04Of(payload).measurements;
      return {
        dur3: dur(3), dur5: dur(5), count: samples.length, span: Math.max(...t) - Math.min(...t), med, maxGap: gaps[gaps.length - 1], zeros, tail: samples.slice(-10).map((s) => s.v[gi]),
        snBefore: sn.readingsBeforeCover.length, snDuring: sn.readingsDuringCover.length, snMeanBefore: mean(sn.readingsBeforeCover), snMeanDuring: mean(sn.readingsDuringCover),
      };
    };
    const rnd = (x) => Math.round(x * 10000) / 10000;
    for (const k of ['c11', 'c13', 'c16']) {
      const res = evalOf(k);
      const p = res.payload;
      const x = independent(p);
      const L = `[٢] ${k}`;
      everyRowValid(res, k);
      deq([verdictOf(res, I.REPORT_FOUND), verdictOf(res, I.REPORT_OWNER), verdictOf(res, I.RAW_STATE), verdictOf(res, I.STORAGE_COPY)], [V.PASS, V.PASS, V.PASS, V.INFO], `${L}: التقرير ومالكه والخامّ PRIVATE وStorage`);
      deq([verdictOf(res, I.APP_VERSION), verdictOf(res, I.FIELDS_VERSION), verdictOf(res, I.READER_ANOMALIES)], [V.PASS, V.PASS, V.PASS], `${L}: 1.0.11 وfv69 وبلا شذوذ`);
      deq(res.block.versions, {appVersion: '1.0.11', fieldsVersion: 69}, `${L}: header.appVersion وfooter.fieldsVersion`);
      // M-02
      const mm = m02Of(p).measurements;
      const m = res.block.m02;
      deq([m.endReason, m.touchedCells, m.totalCells, m.manualStatus], [mm.endReason, mm.touchedCells, mm.totalCells, m02Of(p).status], `${L}: M-02 endReason/touchedCells/totalCells/الحالة اليدوية كما في الحمولة`);
      deq([m.elapsedMs, m.timeToFirstTouchMs], [mm.elapsedMs === undefined ? null : mm.elapsedMs, mm.timeToFirstTouchMs === undefined ? null : mm.timeToFirstTouchMs], `${L}: elapsedMs وtimeToFirstTouchMs (null حين لا لمسة، بحالة ABSENT_DECLARED)`);
      deq([verdictOf(res, I.M02_RAW), verdictOf(res, I.M02_MANUAL_STATUS), verdictOf(res, I.M02_END_REASON_VS_STATUS)], [V.PASS, V.INFO, V.PASS], `${L}: M-02 خامّ كامل ومتّسق مع حالته`);
      // SN-04
      const s4 = res.block.sn04;
      deq([s4.before.count, s4.during.count, s4.windowMs, s4.coverPromptAtMs], [x.snBefore, x.snDuring, 4000, 1000], `${L}: SN-04 عددا القائمتين وwindowMs وcoverPromptAtMs`);
      eq(s4.before.mean, rnd(x.snMeanBefore), `${L}: SN-04 متوسّط قبل التغطية (رقم واحد لا القراءات)`);
      eq(s4.during.mean, rnd(x.snMeanDuring), `${L}: SN-04 متوسّط أثناء التغطية`);
      deq([verdictOf(res, I.SN04_RAW), verdictOf(res, I.SN04_COVER_WINDOWS)], [V.PASS, V.INFO], `${L}: SN-04 الخامّ سليم، ولا حكم على أثر التغطية`);
      // اليدوي
      deq([verdictOf(res, I.MANUAL_STATUS_VOCAB), verdictOf(res, I.MANUAL_UNAVAILABLE_CLASS), verdictOf(res, I.MANUAL_HIDDEN_BY_MODEL)], [V.PASS, V.PASS, V.PASS], `${L}: الحالات الخمس معروفة، وunavailable ⟵ HARDWARE_ABSENT، وhiddenByModel حاضرة`);
      deq(res.block.manual.entries.find((e) => e.testId === 'M-08'), {testId: 'M-08', status: 'unavailable', outcome: 'NOT_MEASURED', notMeasuredReason: 'HARDWARE_ABSENT'}, `${L}: M-08 unavailable ⟵ NOT_MEASURED/HARDWARE_ABSENT (testKinds.toTestResult)`);
      deq(res.block.manual.entries.find((e) => e.testId === 'M-11'), {testId: 'M-11', status: 'not_tested', outcome: 'NOT_MEASURED', notMeasuredReason: 'OPERATOR_SKIPPED'}, `${L}: وM-11 not_tested ⟵ OPERATOR_SKIPPED (سببان مختلفان)`);
      deq(res.block.manual.hiddenByModel, {state: 'PRESENT', list: p.manualResultsHeader.hiddenByModel}, `${L}: hiddenByModel بقائمتها`);
      // D للمعالج
      const totals = p.timeSeries.footer.verificationResults.cpuKnownAnswerTotalMsByPhase;
      const ph = Object.fromEntries(res.block.cpuD.phases.map((e) => [e.phase, e]));
      deq([ph['3'].totalMs, ph['3'].phaseDurationMs, ph['3'].percent, ph['3'].verdict], [totals['3'], x.dur3, rnd((totals['3'] * 100) / x.dur3), V.PASS], `${L}: D المرحلة 3: المجموع ÷ امتداد v[0] (${x.dur3}ms)`);
      deq([ph['5'].totalMs, ph['5'].phaseDurationMs, ph['5'].verdict], [totals['5'], k === 'c16' ? 41762 : x.dur5, V.PASS], `${L}: D المرحلة 5`);
      deq([verdictOf(res, I.CPU_D_SHARE), verdictOf(res, `${I.CPU_D_SHARE_PHASE}_3`), verdictOf(res, `${I.CPU_D_SHARE_PHASE}_5`)], [V.PASS, V.PASS, V.PASS], `${L}: حكم D ≤ 1% في كل مرحلة`);
      deq(res.block.cpuD.criterion, {text: 'والقبول: مجموع زمن D في المرحلة ≤ 1% من زمنها.', maxPercent: 1}, `${L}: نصّ قرار المستخدم 2026-10-08 بنصّه`);
      // العيّنات
      deq(res.block.sampling, {state: 'READ', sampleCount: x.count, spanMs: x.span, medianIntervalMs: x.med, maxIntervalMs: x.maxGap, monotonic: true}, `${L}: عدد العيّنات وامتدادها ومتوسّط الفاصل وأقصاه`);
      deq([res.block.gpuFpsTail.tail, res.block.gpuFpsTail.trailingZeroRun, res.block.gpuFpsTail.tailCount], [x.tail, x.zeros, 10], `${L}: ذيل gpu_fps وطول الصفر المتّصل`);
      eq(verdictOf(res, I.PAYLOAD_BYTES), V.INFO, `${L}: حجم الحمولة INFO`);
      ok(res.block.payload.reportRawBytes > 1000 && res.block.payload.reportRawBytes < 900000 && res.block.payload.requestWireBytes.state === 'NOT_CARRIED', `${L}: حجم reportRaw بالبايت، وحجم السلك NOT_CARRIED (لا صفر)`);
      ok(res.block.payload.rehydratedFingerprintBytes > res.block.payload.reportRawBytes, `${L}: والبصمة المُعاد تركيبها أكبر من reportRaw (بالعيّنات)`);
      // الذاكرة والتخزين والدورات
      const vr = p.timeSeries.footer.verificationResults;
      deq([res.block.memoryKernel.state, res.block.memoryKernel.durationMs, res.block.memoryKernel.timeCapMs, res.block.memoryKernel.memoryVerifyFreeBytes], [vr.memoryVerifyState, vr.memoryVerifyDurationMs, vr.memoryVerifyTimeCapMs, vr.memoryVerifyFreeBytes], `${L}: نواة الذاكرة: الحالة والزمن والسقف والحرّة`);
      deq([res.block.storageVerify.state, res.block.storageVerify.method, res.block.storageVerify.writeErrors_stamp, res.block.storageVerify.readErrors_readBack],
          [vr.storageVerifyState, vr.storageVerifyMethod, vr.storageWriteVerifyErrors, vr.storageReadVerifyErrors], `${L}: التخزين: الحالة والطريقة وأخطاء الكتابة والقراءة الراجعة`);
      eq(res.block.storageVerify.oDirect, vr.storageVerifyMethod === 'o_direct_sequential', `${L}: O_DIRECT من الطريقة`);
    }
    // فروق كل عيّنة
    const r11 = evalOf('c11'); const r13 = evalOf('c13'); const r16 = evalOf('c16');
    deq([r11.block.memoryKernel.reachedCap, r11.block.memoryKernel.partialTimeCapReached, r11.block.memoryKernel.notRunInsufficientFreeMemory], [false, false, false], '[٢] c11: النواة ran: لا سقف ولا نقص ذاكرة');
    deq([r13.block.memoryKernel.reachedCap, r13.block.memoryKernel.partialTimeCapReached], [true, true], '[٢] c13: النواة partial:time_cap_reached وبلغت السقف (30000 ≥ 30000)');
    deq([r16.block.memoryKernel.notRunInsufficientFreeMemory, r16.block.memoryKernel.memoryVerifyFreeBytes], [true, 461373440], '[٢] c16: not_run:insufficient_free_memory ومعه memoryVerifyFreeBytes');
    deq([r13.block.storageVerify.oDirect, r13.block.storageVerify.writeErrors_stamp], [false, 2], '[٢] c13: التخزين بلا O_DIRECT (رجوع إلى DONTNEED) وبخطأَي كتابة');
    deq([r16.block.storageVerify.state, r16.block.storageVerify.notRunNoTimeLeft], ['partial:time_cap_reached', false], '[٢] c16: التخزين partial لا no_time_left');
    deq([r11.block.thermalHeadroom.nanCount, r13.block.thermalHeadroom.nanCount, r13.block.thermalHeadroom.byKind], [0, 1, {ok: 46, nan: 1, exception: 1}], '[٢] getThermalHeadroom: NaN وحالة الحجب (exception) بأعدادها');
    deq([r11.block.batteryBroadcasts.broadcastCount, r16.block.batteryBroadcasts.broadcastCount, r16.block.batteryBroadcasts.droppedByCap, r16.block.batteryBroadcasts.kept], [24, 354, 154, 200], '[٢] بثّات البطارية: العدد والمُسقَط بالسقف والمحفوظ');
    deq([r11.block.l02.engineState, r11.block.l02.timeToFirstFixMs, r11.block.l02.functionalStatus], ['SATELLITES_MEASURED', 8123, 'pass'], '[٢] L-02: حالة المحرّك وtimeToFirstFix والحالة الوظيفية');
    ok(/timeToFirstFixState=absent/.test(rowOf(r11, I.L02).basis) && /gnssCallbackState=absent/.test(rowOf(r11, I.L02).basis), '[٢] L-02: ما لم يُشحن يُكتب absent لا null');
    deq([verdictOf(r11, I.CYCLE_COUNT), r11.block.cycleCount.state, r11.block.cycleCount.source], [V.NOT_MEASURED, 'not_read:sysfs_not_readable_or_absent_and_api_below_34', 'unavailable'], '[٢] c11: الدورات not_read ⟵ NOT_MEASURED بحالتها ومصدرها');
    deq([verdictOf(r13, I.CYCLE_COUNT), r13.block.cycleCount.value, r13.block.cycleCount.source, r13.block.cycleCount.sourceIsExtraApi34], [V.INFO, 187, 'extra_api34', true], '[٢] c13: الدورات 187 من extra_api34');
    deq([r16.block.cycleCount.value, r16.block.cycleCount.sourceIsExtraApi34], [212, false], '[٢] c16: الدورات 212 من sysfs لا extra_api34');
    eq(verdictOf(r13, I.CYCLE_COUNT_MATCHES_B08), V.NOT_MEASURED, '[٢] B-08 غائب من الحمولة الذهبية: NOT_MEASURED لا مطابقة مختلَقة');
    deq([r11.block.m02.touchState, r16.block.m02.touchState, r16.block.m02.elapsedMsStatus, r16.block.m02.timeToFirstTouchMsStatus], ['TOUCHED', 'NO_TOUCH', 'ABSENT_DECLARED', 'ABSENT_DECLARED'], '[٢] M-02: لا لمسة ⟵ الزمنان غائبان بإعلان (لا صفر)');
    eq(r16.block.m02.elapsedMs, null, '[٢] وelapsedMs القيمة null لا 0');
  }

  // ═══ ٣ — «D للمعالج»: الحدّ والفشل وكل غياب ═══
  {
    const base = (mut, opts = {}) => evalOf('c11', {mutate: mut, ...opts});
    const T = (r, p) => r.block.cpuD.phases.find((x) => x.phase === String(p));
    // فشل: 800ms في مرحلة 74978ms = 1.0670٪
    let r = base((p) => setVr(p, {cpuKnownAnswerTotalMsByPhase: {3: 800, 5: 360}}));
    deq([verdictOf(r, I.CPU_D_SHARE), verdictOf(r, `${I.CPU_D_SHARE_PHASE}_3`), verdictOf(r, `${I.CPU_D_SHARE_PHASE}_5`)], [V.FAIL, V.FAIL, V.PASS], '[٣] مرحلة تتجاوز 1٪ ⟵ FAIL للمرحلة وللمجمَّع، والأخرى PASS');
    eq(T(r, 3).percent, 1.067, '[٣] والنسبة 1.067٪ (800×100÷74978)');
    // الحدّ: مرحلة بامتداد 100000ms
    const boundary = (total) => base((p) => {
      const base11 = p.timeSeries.variables.length;
      const row0 = (t, phase) => ({phase, ts: 1, v: Array.from({length: base11}, (_, i) => (i === 0 ? t : 0))});
      p.timeSeries.samples = [row0(0, 3), row0(100000, 3), row0(100001, 5), row0(160001, 5)];
      setVr(p, {cpuKnownAnswerTotalMsByPhase: {3: total, 5: 600}});
    });
    r = boundary(1000);
    deq([T(r, 3).phaseDurationMs, T(r, 3).percent, T(r, 3).verdict], [100000, 1, V.PASS], '[٣] 1٪ بالضبط (1000 من 100000) ⟵ PASS (≤)');
    r = boundary(1001);
    deq([T(r, 3).percent, T(r, 3).verdict, verdictOf(r, I.CPU_D_SHARE)], [1.001, V.FAIL, V.FAIL], '[٣] 1001 من 100000 ⟵ FAIL');
    // الغيابات
    r = base((p) => { setVr(p, {cpuKnownAnswerState: 'not_run:disabled_in_build'}); delete p.timeSeries.footer.verificationResults.cpuKnownAnswerRuns; delete p.timeSeries.footer.verificationResults.cpuKnownAnswerTotalMsByPhase; });
    ok(verdictOf(r, I.CPU_D_SHARE) === V.NOT_MEASURED && basisHas(r, I.CPU_D_SHARE, /not_run:disabled_in_build/), '[٣] D لم يجرِ (not_run): NOT_MEASURED بحالته');
    r = base((p) => { delete p.timeSeries.footer.verificationResults.cpuKnownAnswerState; delete p.timeSeries.footer.verificationResults.cpuKnownAnswerRuns; delete p.timeSeries.footer.verificationResults.cpuKnownAnswerTotalMsByPhase; });
    ok(verdictOf(r, I.CPU_D_SHARE) === V.NOT_MEASURED && basisHas(r, I.CPU_D_SHARE, /cpuKnownAnswerState (ABSENT|NOT_IN_FILE|NOT_IN_FIELDS_VERSION)/), '[٣] حالة D غائبة: NOT_MEASURED بحالة غيابها');
    r = base((p) => setVr(p, {cpuKnownAnswerTotalMsByPhase: {}}));
    ok(verdictOf(r, I.CPU_D_SHARE) === V.NOT_MEASURED && basisHas(r, I.CPU_D_SHARE, /فارغة/), '[٣] المجاميع {} (لم يبدأ تشغيل): NOT_MEASURED لا PASS');
    r = base((p) => { delete p.timeSeries.footer.verificationResults.cpuKnownAnswerTotalMsByPhase; });
    ok(verdictOf(r, I.CPU_D_SHARE) === V.NOT_MEASURED && basisHas(r, I.CPU_D_SHARE, /cpuKnownAnswerTotalMsByPhase/), '[٣] المجاميع غائبة: NOT_MEASURED');
    r = base((p) => setVr(p, {cpuKnownAnswerTotalMsByPhase: {3: 360, 9: 100}}));
    deq([verdictOf(r, `${I.CPU_D_SHARE_PHASE}_3`), verdictOf(r, `${I.CPU_D_SHARE_PHASE}_9`), verdictOf(r, I.CPU_D_SHARE)], [V.PASS, V.NOT_MEASURED, V.NOT_MEASURED], '[٣] مرحلة بلا عيّنات موسومة: NOT_MEASURED لها، والمجمَّع NOT_MEASURED (لا PASS مع غياب)');
    r = base(null, {storage: {state: 'FILE_NOT_FOUND'}});
    ok(verdictOf(r, I.CPU_D_SHARE) === V.NOT_MEASURED && basisHas(r, I.CPU_D_SHARE, /SAMPLES_UNAVAILABLE\(storage=FILE_NOT_FOUND\)/), '[٣] Storage غائب: D NOT_MEASURED (زمن المرحلة من العيّنات)');
    deq([verdictOf(r, I.GPU_FPS_TAIL), verdictOf(r, I.SAMPLING_TIME), verdictOf(r, I.STORAGE_COPY)], [V.NOT_MEASURED, V.NOT_MEASURED, V.FAIL], '[٣] وذيل gpu_fps وزمن العيّنة NOT_MEASURED، ونسخة Storage FAIL (المسار في reportRaw ولا كائن)');
    r = base(null, {storage: {state: 'STORAGE_NOT_READ_BY_OPTION'}});
    ok(basisHas(r, I.CPU_D_SHARE, /STORAGE_NOT_READ_BY_OPTION/) && verdictOf(r, I.STORAGE_COPY) === V.NOT_MEASURED, '[٣] --no-storage: D وStorage NOT_MEASURED بالسبب المعلَن');
    eq(r.block.sampling.state, 'STORAGE_NOT_READ_BY_OPTION', '[٣] وحالة العيّنات في الكتلة');
    r = base(null, {storage: {state: 'DOWNLOADED', json: {header: {}, footer: {}, variables: []}}});
    deq([verdictOf(r, I.STORAGE_COPY), verdictOf(r, I.CPU_D_SHARE)], [V.FAIL, V.NOT_MEASURED], '[٣] ملفّ Storage بلا samples: FAIL لنسخة Storage وD NOT_MEASURED');
    r = base(null, {storage: {state: 'DOWNLOADED', json: {samples: []}}});
    ok(verdictOf(r, I.CPU_D_SHARE) === V.NOT_MEASURED && basisHas(r, I.CPU_D_SHARE, /NO_SAMPLES/), '[٣] samples فارغة: D NOT_MEASURED (NO_SAMPLES)');
    r = base((p) => { p.timeSeries.samples = p.timeSeries.samples.slice(0, 1); });
    ok(verdictOf(r, I.CPU_D_SHARE) === V.NOT_MEASURED, '[٣] عيّنة واحدة: لا امتداد فلا حكم');
    r = base(null, {storage: {state: 'DOWNLOADED', json: storageFileOf(payloadOf('c11')).samples}});
    eq(r.block.storage.topLevel, 'array', '[٣] ملفّ Storage مصفوفة عيّنات (الشكل القديم) يُقبل: samples منها');
  }

  // ═══ ٤ — الإصدارات والشذوذ ═══
  {
    let r = evalOf('c11', {mutate: (p) => { p.timeSeries.header.appVersion = '1.0.10'; }});
    ok(verdictOf(r, I.APP_VERSION) === V.FAIL && basisHas(r, I.APP_VERSION, /appVersion=1\.0\.10 expected=1\.0\.11/), '[٤] appVersion 1.0.10 ⟵ FAIL');
    r = evalOf('c11', {mutate: (p) => { delete p.timeSeries.header.appVersion; }});
    eq(verdictOf(r, I.APP_VERSION), V.NOT_MEASURED, '[٤] appVersion غائب ⟵ NOT_MEASURED');
    r = evalOf('c11', {mutate: (p) => { p.timeSeries.footer.fieldsVersion = 68; }});
    ok(verdictOf(r, I.FIELDS_VERSION) === V.FAIL && verdictOf(r, I.MANUAL_HIDDEN_BY_MODEL) === V.NOT_MEASURED, '[٤] fieldsVersion 68 ⟵ FAIL، وhiddenByModel NOT_MEASURED (لا معرفة)');
    r = evalOf('c11', {mutate: (p) => { p.timeSeries.footer.fieldsVersion = 70; }});
    eq(verdictOf(r, I.FIELDS_VERSION), V.PASS, '[٤] fieldsVersion 70 ⟵ PASS (عتبة لا مساواة)');
    r = evalOf('c11', {mutate: (p) => { delete p.timeSeries.footer.fieldsVersion; }});
    eq(verdictOf(r, I.FIELDS_VERSION), V.NOT_MEASURED, '[٤] fieldsVersion غائب ⟵ NOT_MEASURED');
    r = evalOf('c11', {mutate: (p) => { p.timeSeries.footer.cpuTempFinalSource = 'bogus_source'; }});
    ok(verdictOf(r, I.READER_ANOMALIES) === V.FAIL && basisHas(r, I.READER_ANOMALIES, /cpuTempFinalSource:UNRECOGNIZED_STATE/), '[٤] شذوذ يعلنه القارئ ⟵ READER_ANOMALIES FAIL باسمه');
    eq(r.block.readerAnomalies.length, 1, '[٤] والكتلة تسرده');
  }

  // ═══ ٥ — M-02 ═══
  {
    const m02 = (mut, opts) => evalOf('c11', {mutate: mut, ...opts});
    let r = m02((p) => { p.manualResults = p.manualResults.filter((m) => m.testId !== 'M-02'); });
    deq([verdictOf(r, I.M02_RAW), verdictOf(r, I.M02_MANUAL_STATUS), verdictOf(r, I.M02_END_REASON_VS_STATUS)], [V.NOT_MEASURED, V.NOT_MEASURED, V.NOT_MEASURED], '[٥] M-02 غائب من manualResults: ثلاثة NOT_MEASURED');
    r = m02((p) => { delete m02Of(p).measurements; });
    deq([verdictOf(r, I.M02_RAW), verdictOf(r, I.M02_MANUAL_STATUS), verdictOf(r, I.M02_END_REASON_VS_STATUS)], [V.NOT_MEASURED, V.INFO, V.NOT_MEASURED], '[٥] M-02 بلا measurements: NOT_MEASURED، والحالة اليدوية INFO');
    r = m02((p) => { m02Of(p).measurements.endReason = 'weird'; });
    ok(verdictOf(r, I.M02_RAW) === V.FAIL && basisHas(r, I.M02_RAW, /endReason:UNRECOGNIZED/), '[٥] endReason خارج الأربع ⟵ FAIL');
    eq(verdictOf(r, I.M02_END_REASON_VS_STATUS), V.NOT_MEASURED, '[٥] ولا مطابقة للحالة');
    r = m02((p) => { m02Of(p).measurements.touchedCells = '87'; });
    ok(verdictOf(r, I.M02_RAW) === V.FAIL && basisHas(r, I.M02_RAW, /touchedCells:WRONG_TYPE/), '[٥] touchedCells نصّ ⟵ FAIL (WRONG_TYPE)');
    r = m02((p) => { delete m02Of(p).measurements.touchedCells; });
    ok(verdictOf(r, I.M02_RAW) === V.FAIL && basisHas(r, I.M02_RAW, /touchedCells:ABSENT/), '[٥] touchedCells غائب ⟵ FAIL');
    r = m02((p) => { delete m02Of(p).measurements.elapsedMs; });
    ok(verdictOf(r, I.M02_RAW) === V.FAIL && basisHas(r, I.M02_RAW, /elapsedMs:ABSENT/) && basisHas(r, I.M02_RAW, /TOUCH_GRID_TIMING_ABSENT_DESPITE_TOUCH/), '[٥] elapsedMs غائب مع لمسة ⟵ FAIL (غياب بلا سبب + شذوذ القارئ)');
    r = m02((p) => { delete m02Of(p).measurements.timeToFirstTouchMs; });
    ok(verdictOf(r, I.M02_RAW) === V.FAIL && basisHas(r, I.M02_RAW, /timeToFirstTouchMs:ABSENT/), '[٥] timeToFirstTouchMs غائب مع لمسة ⟵ FAIL');
    r = m02((p) => { m02Of(p).measurements.touchedCells = 0; });
    ok(verdictOf(r, I.M02_RAW) === V.FAIL && basisHas(r, I.M02_RAW, /TOUCH_GRID_TIMING_PRESENT_WITHOUT_TOUCH/), '[٥] زمنان حاضران مع touchedCells=0 ⟵ FAIL (تناقض)');
    r = m02((p) => { m02Of(p).status = 'fail'; });
    ok(verdictOf(r, I.M02_END_REASON_VS_STATUS) === V.FAIL && basisHas(r, I.M02_END_REASON_VS_STATUS, /endReason=auto_complete expectedStatus=pass status=fail/), '[٥] endReason=auto_complete والحالة fail ⟵ FAIL');
    r = m02((p) => { m02Of(p).measurements.endReason = 'dismissed'; });
    eq(verdictOf(r, I.M02_END_REASON_VS_STATUS), V.INFO, '[٥] dismissed ⟵ INFO (لا حالة جديدة بالعقد)');
    for (const [reason, status] of [['auto_complete', 'pass'], ['user_marked_not_working', 'fail'], ['user_marked_not_tested', 'not_tested']]) {
      r = m02((p) => { m02Of(p).measurements.endReason = reason; m02Of(p).status = status; });
      eq(verdictOf(r, I.M02_END_REASON_VS_STATUS), V.PASS, `[٥] ${reason} ⟵ ${status}: PASS`);
    }
    deq(D.END_REASON_STATUS, {auto_complete: 'pass', user_marked_not_working: 'fail', user_marked_not_tested: 'not_tested'}, '[٥] جدول endReason ⟵ الحالة (مفاتيحه من fv68Names)');
    r = m02((p) => { m02Of(p).status = 7; });
    eq(r.block.m02.manualStatus, null, '[٥] حالة يدوية ليست نصّاً: null في الكتلة');
  }

  // ═══ ٦ — SN-04 ═══
  {
    const sn = (mut, opts) => evalOf('c11', {mutate: mut, ...opts});
    let r = sn((p) => { p.functionalResults = p.functionalResults.filter((f) => f.testId !== 'SN-04'); });
    deq([verdictOf(r, I.SN04_RAW), verdictOf(r, I.SN04_COVER_WINDOWS)], [V.NOT_MEASURED, V.NOT_MEASURED], '[٦] SN-04 غائب: NOT_MEASURED');
    r = sn((p) => { delete sn04Of(p).measurements; });
    deq([verdictOf(r, I.SN04_RAW), verdictOf(r, I.SN04_COVER_WINDOWS)], [V.FAIL, V.NOT_MEASURED], '[٦] measurements غائب في fv69 ⟵ FAIL (عقد: حاضر دائماً)');
    r = sn((p) => { delete sn04Of(p).measurements; p.timeSeries.footer.fieldsVersion = 68; });
    eq(verdictOf(r, I.SN04_RAW), V.NOT_MEASURED, '[٦] وفي fv68 ⟵ NOT_MEASURED (لم يوجد بعد)');
    r = sn((p) => { delete sn04Of(p).measurements.readingsDuringCover; });
    ok(verdictOf(r, I.SN04_RAW) === V.FAIL && basisHas(r, I.SN04_RAW, /readingsDuringCover:absent/), '[٦] قائمة أثناء التغطية غائبة ⟵ FAIL');
    eq(r.block.sn04.during.state, 'ABSENT', '[٦] وحالتها ABSENT في الكتلة');
    r = sn((p) => { sn04Of(p).measurements.readingsBeforeCover = 'x'; });
    ok(verdictOf(r, I.SN04_RAW) === V.FAIL && basisHas(r, I.SN04_RAW, /readingsBeforeCover:not_an_array/), '[٦] قائمة ليست مصفوفة ⟵ FAIL');
    r = sn((p) => { delete sn04Of(p).measurements.windowMs; delete sn04Of(p).measurements.coverPromptAtMs; });
    ok(verdictOf(r, I.SN04_RAW) === V.FAIL && basisHas(r, I.SN04_RAW, /windowMs:absent/) && basisHas(r, I.SN04_RAW, /coverPromptAtMs:absent/), '[٦] windowMs وcoverPromptAtMs غائبان ⟵ FAIL');
    r = sn((p) => { sn04Of(p).measurements.readingsBeforeCover = []; sn04Of(p).measurements.readingsDuringCover = []; });
    deq([verdictOf(r, I.SN04_RAW), verdictOf(r, I.SN04_COVER_WINDOWS), r.block.sn04.before.state, r.block.sn04.before.mean, r.block.sn04.during.count], [V.PASS, V.INFO, 'EMPTY_DECLARED', null, 0], '[٦] قائمتان فارغتان معلنتان: PASS، والمتوسّط null لا 0 (لا قراءات ≠ صفر)');
    r = sn((p) => { sn04Of(p).measurements.readingsBeforeCover.push({t: 5000, values: [1]}); });
    ok(verdictOf(r, I.SN04_RAW) === V.FAIL && basisHas(r, I.SN04_RAW, /readingsBeforeCover:boundary_violations=1/), '[٦] قراءة قبل التغطية بطابع ≥ الفاصل ⟵ FAIL (الفاصل يقسم القائمتين)');
    r = sn((p) => { sn04Of(p).measurements.readingsDuringCover.push({t: 10, values: [1]}); });
    ok(verdictOf(r, I.SN04_RAW) === V.FAIL && basisHas(r, I.SN04_RAW, /readingsDuringCover:boundary_violations=1/), '[٦] وأثناءها بطابع < الفاصل ⟵ FAIL');
    r = sn((p) => { sn04Of(p).measurements.readingsDuringCover.push({t: 2000, values: ['x']}); sn04Of(p).measurements.readingsBeforeCover.push({values: [1]}); });
    ok(verdictOf(r, I.SN04_RAW) === V.FAIL && basisHas(r, I.SN04_RAW, /readingsDuringCover:malformed_elements=1/) && basisHas(r, I.SN04_RAW, /readingsBeforeCover:malformed_elements=1/), '[٦] عناصر مشوَّهة ⟵ FAIL بعددها');
    r = sn((p) => { sn04Of(p).measurements.readingsBeforeCover = [{t: 100, values: [3, 5]}, {t: 200, values: [4]}]; sn04Of(p).measurements.readingsDuringCover = [{t: 1500, values: [10, 20, 30]}]; });
    deq([r.block.sn04.before.mean, r.block.sn04.before.componentsMax, r.block.sn04.during.mean, r.block.sn04.during.componentsMax], [4, 2, 20, 3], '[٦] متوسّط كل القيم في النافذة (متعدّد المكوّنات) وأقصى عدد مكوّنات');
    deq(Object.keys(r.block.sn04).sort(), ['before', 'coverPromptAtMs', 'during', 'functionalStatus', 'keysPresent', 'present', 'problems', 'windowMs'], '[٦] كتلة SN-04: أعداد وأرقام وحالات (لا قراءات)');
    ok(!JSON.stringify(r.block).includes('"values"'), '[٦] ولا مصفوفة values في أيّ موضع من الكتلة');
  }

  // ═══ ٧ — اليدوي ═══
  {
    const mv = (mut, opts) => evalOf('c13', {mutate: mut, ...opts});
    let r = mv((p) => { p.manualResults[1].status = 'maybe'; });
    ok(verdictOf(r, I.MANUAL_STATUS_VOCAB) === V.FAIL && basisHas(r, I.MANUAL_STATUS_VOCAB, /unknown=\["M-07:maybe"\]/), '[٧] حالة يدوية خارج الخمس ⟵ FAIL باسمها');
    r = mv((p) => { delete p.manualResults[1].status; });
    ok(verdictOf(r, I.MANUAL_STATUS_VOCAB) === V.FAIL && basisHas(r, I.MANUAL_STATUS_VOCAB, /M-07:absent/), '[٧] حالة غائبة ⟵ FAIL (لا تُقرأ نجاحاً)');
    r = mv((p) => { p.manualResults = []; });
    deq([verdictOf(r, I.MANUAL_STATUS_VOCAB), verdictOf(r, I.MANUAL_UNAVAILABLE_CLASS)], [V.NOT_MEASURED, V.NOT_MEASURED], '[٧] manualResults فارغة: NOT_MEASURED');
    r = mv((p) => { p.manualResults = p.manualResults.filter((m) => m.status !== 'unavailable'); });
    ok(verdictOf(r, I.MANUAL_UNAVAILABLE_CLASS) === V.NOT_MEASURED && basisHas(r, I.MANUAL_UNAVAILABLE_CLASS, /لا `unavailable`/), '[٧] لا unavailable في التقرير: NOT_MEASURED (لا يُختبر ما لا يوجد)');
    r = mv((p) => { p.manualResults.push({testId: 'M-20', categoryName: 'x', componentName: 'y', status: 'unavailable'}); });
    ok(verdictOf(r, I.MANUAL_UNAVAILABLE_CLASS) === V.PASS && basisHas(r, I.MANUAL_UNAVAILABLE_CLASS, /M-08:NOT_MEASURED\/HARDWARE_ABSENT M-20:NOT_MEASURED\/HARDWARE_ABSENT/), '[٧] كل unavailable ⟵ HARDWARE_ABSENT');
    r = mv((p) => { delete p.manualResultsHeader; });
    ok(verdictOf(r, I.MANUAL_HIDDEN_BY_MODEL) === V.FAIL && r.block.manual.hiddenByModel.state === 'HEADER_ABSENT', '[٧] الرأس غائب في fv69 ⟵ FAIL (HEADER_ABSENT)');
    r = mv((p) => { p.manualResultsHeader = {}; });
    ok(verdictOf(r, I.MANUAL_HIDDEN_BY_MODEL) === V.FAIL && r.block.manual.hiddenByModel.state === 'HIDDEN_BY_MODEL_ABSENT', '[٧] hiddenByModel غائبة ⟵ FAIL');
    r = mv((p) => { p.manualResultsHeader = {hiddenByModel: 'M-14'}; });
    ok(verdictOf(r, I.MANUAL_HIDDEN_BY_MODEL) === V.FAIL && r.block.manual.hiddenByModel.state === 'HIDDEN_BY_MODEL_WRONG_TYPE', '[٧] hiddenByModel نصّ لا مصفوفة ⟵ FAIL');
    r = mv((p) => { p.manualResultsHeader = {hiddenByModel: [1]}; });
    eq(r.block.manual.hiddenByModel.state, 'HIDDEN_BY_MODEL_WRONG_TYPE', '[٧] عناصرها ليست نصوصاً ⟵ WRONG_TYPE');
    r = mv((p) => { p.manualResultsHeader = []; });
    eq(r.block.manual.hiddenByModel.state, 'HEADER_WRONG_TYPE', '[٧] الرأس مصفوفة ⟵ HEADER_WRONG_TYPE');
    r = mv((p) => { p.manualResultsHeader = {hiddenByModel: []}; });
    deq([verdictOf(r, I.MANUAL_HIDDEN_BY_MODEL), r.block.manual.hiddenByModel], [V.PASS, {state: 'PRESENT', list: []}], '[٧] قائمة فارغة حاضرة: PASS («لم يُخفَ شيء» إعلان لا غياب)');
  }

  // ═══ ٨ — بنود السلوك وشذوذ أقسامها ═══
  {
    const bh = (mut, opts) => evalOf('c11', {mutate: mut, ...opts});
    // التخزين: no_time_left معلَن
    let r = bh((p) => { setVr(p, {storageVerifyState: 'not_run:no_time_left'}); for (const k of ['storageWriteVerifyErrors', 'storageReadVerifyErrors', 'storageVerifyBytesCompared', 'storageVerifyDurationMs']) delete p.timeSeries.footer.verificationResults[k]; });
    deq([verdictOf(r, I.STORAGE_VERIFY), r.block.storageVerify.notRunNoTimeLeft, r.block.storageVerify.state], [V.INFO, true, 'not_run:no_time_left'], '[٨] التخزين not_run:no_time_left: INFO ومعلَن (يُعدّ)');
    // التخزين: شذوذ القارئ في قسمه ⟵ FAIL
    r = bh((p) => { setVr(p, {storageVerifyState: 'not_run:no_time_left'}); });
    ok(verdictOf(r, I.STORAGE_VERIFY) === V.FAIL && basisHas(r, I.STORAGE_VERIFY, /READ_ERRORS_WITH_NON_RAN_STATE/), '[٨] عدّاد قراءة راجعة مع not_run ⟵ STORAGE_VERIFY FAIL بشذوذه');
    eq(verdictOf(r, I.READER_ANOMALIES), V.FAIL, '[٨] وREADER_ANOMALIES FAIL أيضاً');
    eq(verdictOf(r, I.MEMORY_KERNEL), V.INFO, '[٨] وبند آخر (الذاكرة) لا يتأثّر بشذوذ قسم غيره');
    // الذاكرة: شذوذ
    r = bh((p) => { setVr(p, {memoryVerifyState: 'partial:time_cap_reached', memoryVerifyBytes: 5000, memoryVerifyBufferBytes: 4000}); });
    ok(verdictOf(r, I.MEMORY_KERNEL) === V.FAIL && basisHas(r, I.MEMORY_KERNEL, /PARTIAL_WITH_FULL_COVERAGE/), '[٨] partial مع تغطية كاملة ⟵ MEMORY_KERNEL FAIL');
    // الذاكرة: غائبة
    r = bh((p) => { for (const k of Object.keys(p.timeSeries.footer.verificationResults)) if (k.startsWith('memory')) delete p.timeSeries.footer.verificationResults[k]; });
    ok(verdictOf(r, I.MEMORY_KERNEL) === V.NOT_MEASURED && basisHas(r, I.MEMORY_KERNEL, /memoryVerifyState (ABSENT|NOT_IN_FILE|NOT_IN_FIELDS_VERSION)/), '[٨] حالة الذاكرة غائبة ⟵ NOT_MEASURED (لا نجاح)');
    // بثّات البطارية: غائبة
    r = bh((p) => { delete p.timeSeries.footer.batteryPairsState; delete p.timeSeries.footer.batteryPairs; });
    eq(verdictOf(r, I.BATTERY_BROADCASTS), V.NOT_MEASURED, '[٨] بثّات البطارية غائبة ⟵ NOT_MEASURED');
    // بثّات البطارية: شذوذ العدّ
    r = bh((p) => { p.timeSeries.footer.batteryPairsState.broadcastCount = 999; });
    ok(verdictOf(r, I.BATTERY_BROADCASTS) === V.FAIL && basisHas(r, I.BATTERY_BROADCASTS, /COUNTS_DO_NOT_ADD_UP/), '[٨] أعداد البثّ لا تجمع ⟵ FAIL');
    // الحرارة: غائبة
    r = bh((p) => { delete p.timeSeries.footer.thermalHeadroomState; delete p.timeSeries.footer.thermalHeadroomReadings; });
    eq(verdictOf(r, I.THERMAL_HEADROOM), V.NOT_MEASURED, '[٨] getThermalHeadroom غائب ⟵ NOT_MEASURED');
    r = bh((p) => { p.timeSeries.footer.thermalHeadroomReadings.push({t: 99999, headroom: 0.5, state: 'nan'}); });
    ok(verdictOf(r, I.THERMAL_HEADROOM) === V.FAIL && basisHas(r, I.THERMAL_HEADROOM, /VALUE_WITH_NON_OK_STATE/), '[٨] قيمة مع حالة nan ⟵ FAIL (شذوذ القارئ)');
    // L-02
    r = bh((p) => { p.functionalResults = p.functionalResults.filter((f) => f.testId !== 'L-02'); });
    ok(verdictOf(r, I.L02) === V.NOT_MEASURED && basisHas(r, I.L02, /L-02 غائب/), '[٨] L-02 غائب ⟵ NOT_MEASURED');
    r = bh((p) => { delete p.functionalResults.find((f) => f.testId === 'L-02').measurements; });
    ok(verdictOf(r, I.L02) === V.NOT_MEASURED && basisHas(r, I.L02, /L-02 بلا measurements/), '[٨] L-02 بلا measurements ⟵ NOT_MEASURED');
    r = bh((p) => { Object.assign(p.functionalResults.find((f) => f.testId === 'L-02').measurements, {satelliteStatusCallbacks: 0, visibleSatellites: 0, timeToFirstFixMs: 5000, timeToFirstFixState: 'no_fix', gnssCallbackState: 'registered'}); });
    ok(verdictOf(r, I.L02) === V.INFO && basisHas(r, I.L02, /engineState=ENGINE_DID_NOT_REPORT/) && basisHas(r, I.L02, /timeToFirstFixState=no_fix/), '[٨] L-02 بلا استدعاءات: حالة المحرّك ENGINE_DID_NOT_REPORT وحالة timeToFirstFix كما شُحنت');
    // gpu_fps: ذيل بصفر متّصل وقيم غير رقمية
    r = bh((p) => { const gi = p.timeSeries.variables.findIndex((v) => v.name === 'gpu_fps'); const s = p.timeSeries.samples; s[s.length - 1].v[gi] = null; s[s.length - 2].v[gi] = 'x'; });
    deq([r.block.gpuFpsTail.trailingNonNumericRun, r.block.gpuFpsTail.nonNumericCount, r.block.gpuFpsTail.tail.slice(-2)], [2, 2, [null, null]], '[٨] gpu_fps: قيمة غير رقمية في الذيل تُعدّ ولا تُقرأ صفراً');
    r = bh((p) => { p.timeSeries.variables = p.timeSeries.variables.filter((v) => v.name !== 'gpu_fps'); for (const s of p.timeSeries.samples) s.v = s.v.slice(0, 10); });
    ok(verdictOf(r, I.GPU_FPS_TAIL) === V.NOT_MEASURED && basisHas(r, I.GPU_FPS_TAIL, /gpu_fps غير محلول/), '[٨] عمود gpu_fps غير موجود في التخطيط ⟵ NOT_MEASURED (لا ذيل مختلَق)');
    r = bh((p) => { p.timeSeries.variables = p.timeSeries.variables.filter((v) => v.name !== 'timestamp_ms'); });
    ok(verdictOf(r, I.SAMPLING_TIME) === V.NOT_MEASURED && verdictOf(r, I.CPU_D_SHARE) === V.NOT_MEASURED, '[٨] عمود timestamp_ms غير محلول ⟵ زمن العيّنة وD NOT_MEASURED');
    // بلا بصمة
    const noFp = evalOf('c11', {});
    void noFp;
    // الذاكرة: غياب الزمن لا يُقرأ بلوغ سقف
    r = bh((p) => { delete p.timeSeries.footer.verificationResults.memoryVerifyDurationMs; });
    eq(r.block.memoryKernel.reachedCap, null, '[٨] زمن النواة غائب ⟵ reachedCap null (لا true ولا false)');
  }

  // ═══ ٩ — الدورات وB-08 ═══
  {
    const b08 = (rawValue, extra = {}) => evalOf('c13', {mutate: (p) => { p.functionalResults.push({testId: 'B-08', categoryName: 'battery', componentName: 'cycles', status: 'pass', rawValue, rawValueUnit: 'cycles', ...extra}); }});
    let r = b08('187');
    ok(verdictOf(r, I.CYCLE_COUNT_MATCHES_B08) === V.PASS && basisHas(r, I.CYCLE_COUNT_MATCHES_B08, /cycleCount=187 B-08=187/), '[٩] B-08 = cycleCount ⟵ PASS');
    r = b08('190');
    ok(verdictOf(r, I.CYCLE_COUNT_MATCHES_B08) === V.FAIL && basisHas(r, I.CYCLE_COUNT_MATCHES_B08, /cycleCount=187 B-08=190/), '[٩] يختلفان ⟵ FAIL');
    r = b08('187.0');
    eq(verdictOf(r, I.CYCLE_COUNT_MATCHES_B08), V.PASS, '[٩] "187.0" رقم يطابق');
    r = b08('N/A');
    ok(verdictOf(r, I.CYCLE_COUNT_MATCHES_B08) === V.NOT_MEASURED && basisHas(r, I.CYCLE_COUNT_MATCHES_B08, /ليس رقماً/), '[٩] rawValue ليس رقماً ⟵ NOT_MEASURED');
    r = b08(187);
    eq(verdictOf(r, I.CYCLE_COUNT_MATCHES_B08), V.PASS, '[٩] rawValue رقماً (لا نصّاً) يُقبل');
    r = evalOf('c11', {mutate: (p) => { p.functionalResults.push({testId: 'B-08', categoryName: 'battery', componentName: 'cycles', status: 'pass', rawValue: '0', rawValueUnit: 'cycles'}); }});
    ok(verdictOf(r, I.CYCLE_COUNT_MATCHES_B08) === V.NOT_MEASURED && basisHas(r, I.CYCLE_COUNT_MATCHES_B08, /cycleCount غائب \(B-08=0\)/), '[٩] cycleCount not_read وB-08=0: NOT_MEASURED (الصفر لا يطابق الغياب)');
    r = evalOf('c13', {mutate: (p) => { delete p.timeSeries.footer.batteryHealth; }});
    ok(verdictOf(r, I.CYCLE_COUNT) === V.NOT_MEASURED && r.block.cycleCount.state === 'ABSENT', '[٩] batteryHealth غائب ⟵ الدورات NOT_MEASURED (ABSENT)');
    r = evalOf('c13', {mutate: (p) => { p.timeSeries.footer.batteryHealth.cycleCountSource = 'mystery'; }});
    ok(verdictOf(r, I.CYCLE_COUNT) === V.FAIL && basisHas(r, I.CYCLE_COUNT, /UNRECOGNIZED_STATE/), '[٩] مصدر دورات خارج المفردة ⟵ FAIL (يُعلَن لا يُسقَط)');
  }

  // ═══ ١٠ — الجلسة وevaluations ═══
  {
    const sd = (over = {}) => ({status: 'completed', joinedBy: 'anon-joiner-uid', joinedAt: ts(NOW - 5000), scanId: 'scan-S1', ownerId: OWNER_UID, ...over});
    const sessFacts = (over = {}, state = 'READ', extra = {}) => { const d = sd(over); return {state, data: d, sessionIdHash: C.hashIdForLog('sess-1'), scanIdMatches: typeof d.scanId === 'string' && d.scanId !== '' ? d.scanId === 'scan-S1' : null, ownerMatches: typeof d.ownerId === 'string' && d.ownerId !== '' ? d.ownerId === OWNER_UID : null, ...extra}; };
    let r = evalOf('c16', {tag: 'SX', session: sessFacts()});
    deq([verdictOf(r, I.SESSION_SCAN), verdictOf(r, I.SESSION_STATUS), verdictOf(r, I.SESSION_JOINED_BY), verdictOf(r, I.SESSION_SCAN_LINK)], [V.INFO, V.PASS, V.INFO, V.PASS], '[١٠] جلسة سليمة: completed ومربوطة بالتقرير وبالمالك');
    deq([r.block.session.joinedByPresent, r.block.session.joinedByHash, r.block.session.joinedAtPlus03], [true, C.hashIdForLog('anon-joiner-uid'), '2027-01-15T10:59:55.000+03:00'], '[١٠] joinedBy حاضر (مُهشَّراً) وjoinedAt بتوقيت +03');
    ok(!JSON.stringify(r.block).includes('anon-joiner-uid') && !JSON.stringify(r.rows).includes('anon-joiner-uid'), '[١٠] ولا joinedBy خامّ');
    r = evalOf('c16', {tag: 'SX', session: sessFacts({joinedBy: undefined})});
    deq([r.block.session.joinedByPresent, r.block.session.joinedByHash, verdictOf(r, I.SESSION_JOINED_BY)], [false, 'missing', V.INFO], '[١٠] joinedBy غائب (انضمام بلا هوية): «missing» لا تهشير للفراغ، والبند INFO');
    r = evalOf('c16', {tag: 'SX', session: sessFacts({joinedAt: undefined})});
    deq([r.block.session.joinedAtPresent, r.block.session.joinedAtPlus03], [false, null], '[١٠] joinedAt غائب: null لا وقت مختلَق');
    r = evalOf('c16', {tag: 'SX', session: sessFacts({joinedAt: new Date(NOW)})});
    eq(r.block.session.joinedAtPresent, true, '[١٠] joinedAt من نوع Date يُقرأ');
    for (const [status, expect] of [['scanning', V.FAIL], ['pending', V.FAIL], ['cancelled', V.FAIL], ['expired', V.FAIL], ['Weird', V.FAIL]]) {
      r = evalOf('c16', {tag: 'SX', session: sessFacts({status})});
      eq(verdictOf(r, I.SESSION_STATUS), expect, `[١٠] status=${status} ⟵ ${expect}`);
    }
    r = evalOf('c16', {tag: 'SX', session: sessFacts({status: undefined})});
    ok(verdictOf(r, I.SESSION_STATUS) === V.FAIL && basisHas(r, I.SESSION_STATUS, /status=ABSENT/), '[١٠] status غائب ⟵ FAIL (ABSENT)');
    r = evalOf('c16', {tag: 'SX', session: sessFacts({scanId: 'other-scan'})});
    ok(verdictOf(r, I.SESSION_SCAN_LINK) === V.FAIL && basisHas(r, I.SESSION_SCAN_LINK, /scanIdMatchesReport=false/), '[١٠] scanId الجلسة ≠ scanId التقرير ⟵ FAIL');
    r = evalOf('c16', {tag: 'SX', session: sessFacts({ownerId: 'someone-else'})});
    ok(verdictOf(r, I.SESSION_SCAN_LINK) === V.FAIL && basisHas(r, I.SESSION_SCAN_LINK, /ownerMatchesAccount=false/), '[١٠] ownerId الجلسة حساب آخر ⟵ FAIL');
    r = evalOf('c16', {tag: 'SX', session: sessFacts({scanId: undefined})});
    ok(verdictOf(r, I.SESSION_SCAN_LINK) === V.FAIL && basisHas(r, I.SESSION_SCAN_LINK, /scanIdMatchesReport=null/), '[١٠] scanId الجلسة غائب ⟵ FAIL (null لا يطابق)');
    r = evalOf('c16', {tag: 'SX', session: {state: 'SESSION_DOC_ABSENT', sessionIdHash: C.hashIdForLog('sess-1')}});
    deq([verdictOf(r, I.SESSION_STATUS), verdictOf(r, I.SESSION_JOINED_BY), verdictOf(r, I.SESSION_SCAN_LINK)], [V.NOT_MEASURED, V.NOT_MEASURED, V.NOT_MEASURED], '[١٠] مستند الجلسة غائب: NOT_MEASURED');
    r = evalOf('c16', {tag: 'SX', session: {state: 'SESSION_ID_UNREADABLE'}});
    eq(verdictOf(r, I.SESSION_SCAN), V.FAIL, '[١٠] sessionId ليس نصّاً ⟵ FAIL');
    r = evalOf('c11', {tag: 'SX'});
    ok(verdictOf(r, I.SESSION_SCAN) === V.FAIL && !rowOf(r, I.SESSION_STATUS), '[١٠] وسم S بلا sessionId ⟵ FAIL، ولا بنود جلسة أخرى');
    r = evalOf('c11', {tag: 'G1'});
    ok(verdictOf(r, I.SESSION_SCAN) === V.INFO && !rowOf(r, I.SESSION_STATUS) && !rowOf(r, I.SESSION_SCAN_LINK), '[١٠] وسم B بلا sessionId ⟵ INFO (فحص فردي)، ولا بنود جلسة');
    // evaluations
    const evOf = (over = {}) => ({exists: true, data: {scanId: 'x', pending: false, ownerMismatch: false, linkageIncomplete: false, linkageRawState: 'PRIVATE', missingLinkageFields: [], source: 'session', revisionCount: 0, resolvedAt: ts(NOW), technicianName: 'SECRET TECH NAME', ...over}});
    r = evalOf('c16', {tag: 'SX', session: sessFacts(), evaluation: evOf()});
    deq([verdictOf(r, I.EVALUATION_DOC), verdictOf(r, I.EVALUATION_NO_MOVED_IDS)], [V.PASS, V.PASS], '[١٠] تقييم مستكمل بلا معرّفات منقولة: PASS');
    deq([r.block.evaluation.pending, r.block.evaluation.linkageRawState, r.block.evaluation.linkageIncomplete, r.block.evaluation.movedKeysFound, r.block.evaluation.source, r.block.evaluation.revisionCount], [false, 'PRIVATE', false, [], 'session', 0], '[١٠] حالة التقييم: pending وlinkageRawState وlinkageIncomplete والمصدر وعدد المراجعات');
    ok(!JSON.stringify(r.block).includes('SECRET TECH NAME') && !JSON.stringify(r.rows).includes('SECRET TECH NAME'), '[١٠] ولا اسم الفنّي في أيّ مخرَج');
    r = evalOf('c16', {tag: 'SX', session: sessFacts(), evaluation: evOf({pending: true})});
    eq(verdictOf(r, I.EVALUATION_DOC), V.INFO, '[١٠] pending=true ⟵ INFO (لم يُستكمل)');
    r = evalOf('c16', {tag: 'SX', session: sessFacts(), evaluation: evOf({pending: undefined})});
    ok(verdictOf(r, I.EVALUATION_DOC) === V.INFO && r.block.evaluation.pending === null, '[١٠] pending غائب ⟵ INFO وnull في الكتلة (لا false مختلَق)');
    for (const key of [...REPORT_RAW_FIELDS, ...RAW_LINKAGE_FIELDS, 'sessionId']) {
      r = evalOf('c16', {tag: 'SX', session: sessFacts(), evaluation: evOf({nested: {deep: [{[key]: 'v'}]}})});
      ok(verdictOf(r, I.EVALUATION_NO_MOVED_IDS) === V.FAIL && r.block.evaluation.movedKeysFound.includes(key), `[١٠] ${key} على عمق ⟵ FAIL (EVALUATION_NO_MOVED_IDS)`);
    }
    r = evalOf('c16', {tag: 'SX', session: sessFacts(), evaluation: {exists: false}});
    deq([verdictOf(r, I.EVALUATION_DOC), verdictOf(r, I.EVALUATION_NO_MOVED_IDS)], [V.NOT_MEASURED, V.NOT_MEASURED], '[١٠] فحص جلسة بلا تقييم: NOT_MEASURED (لم يُرسَل بعد)');
    r = evalOf('c11', {tag: 'G1', evaluation: evOf({source: 'authenticated'})});
    eq(verdictOf(r, I.EVALUATION_DOC), V.INFO, '[١٠] تقرير فردي بتقييم مستكمل: INFO');
    deq(D.ITEM_RULES[I.EVALUATION_NO_MOVED_IDS].includes('evaluationContract.js:72-80'), true, '[١٠] قاعدة البند تذكر مصدر المعرّفات (evaluationContract.js:72-80)');
    deq(RAW_LINKAGE_FIELDS, ['timeSeriesStoragePath', 'deviceFingerprintSha'], '[١٠] المعرّفان المنقولان بنصّ evaluationContract (مصدر واحد)');
  }

  // ═══ ١١ — غياب التقرير/الخامّ ═══
  {
    const allItems = Object.values(I).filter((x) => ![I.CPU_D_SHARE_PHASE, I.CPU_D_RUN, I.CPU_D_BREAKDOWN, I.CPU_D_R2_SUMMARY, I.CPU_D_R2_FIRST_RUN, I.CPU_D_R2_SIEVE_LIMIT, I.CPU_D_R2_SIEVE_PRIME_COUNT].includes(x)); // بنود بلاحقة: صفوفها الديناميكية من بندها الأمّ (CPU_D_R2 حكمه المجمَّع يبقى في القائمة)
    let res = D.evaluateReport({tag: 'G1', shortIdHash: C.hashIdForLog('x'), found: 0}, {accountHash: ACCOUNT_HASH});
    eq(verdictOf(res, I.REPORT_FOUND), V.FAIL, '[١١] لا تقرير ⟵ REPORT_FOUND FAIL');
    ok(allItems.filter((x) => x !== I.REPORT_FOUND).every((x) => verdictOf(res, x) === V.NOT_MEASURED && /REPORT_ABSENT/.test(rowOf(res, x).basis)), '[١١] وكل بند آخر NOT_MEASURED:REPORT_ABSENT (لا بند يُحذف صامتاً)');
    eq(res.block.found, false, '[١١] والكتلة found=false');
    res = D.evaluateReport({tag: 'G1', shortIdHash: C.hashIdForLog('x'), found: 0, vanished: true}, {accountHash: ACCOUNT_HASH});
    ok(/غاب عند القراءة/.test(rowOf(res, I.REPORT_FOUND).basis), '[١١] وُجد بالاستعلام وغاب عند القراءة: يُعلَن');
    res = D.evaluateReport({tag: 'G1', shortIdHash: C.hashIdForLog('x'), found: 2}, {accountHash: ACCOUNT_HASH});
    ok(verdictOf(res, I.REPORT_FOUND) === V.NOT_MEASURED && /SHORT_ID_AMBIGUOUS/.test(rowOf(res, I.REPORT_FOUND).basis) && res.block.reportsFoundByShortId === 2, '[١١] رمز ملتبس (مستندان): NOT_MEASURED، والعدد في الكتلة');
    // تقرير حساب آخر / userId غائب
    let r = evalOf('c11', {ownerMatches: false});
    ok(verdictOf(r, I.REPORT_OWNER) === V.FAIL && verdictOf(r, I.REPORT_FOUND) === V.PASS, '[١١] تقرير حساب آخر ⟵ REPORT_OWNED_BY_OWNER_ACCOUNT FAIL');
    r = evalOf('c11', {ownerMatches: null});
    eq(verdictOf(r, I.REPORT_OWNER), V.NOT_MEASURED, '[١١] userId غائب ⟵ NOT_MEASURED');
    // الخامّ غائب
    const rawAbsent = factsOf('c11').facts;
    rawAbsent.rawRead = {state: 'ABSENT', raw: null};
    rawAbsent.storage = {state: 'RAW_ABSENT'};
    res = D.evaluateReport(rawAbsent, {accountHash: ACCOUNT_HASH});
    deq([verdictOf(res, I.RAW_STATE), verdictOf(res, I.STORAGE_COPY), verdictOf(res, I.APP_VERSION), verdictOf(res, I.M02_RAW), verdictOf(res, I.CPU_D_SHARE), verdictOf(res, I.PAYLOAD_BYTES)], [V.FAIL, V.NOT_MEASURED, V.NOT_MEASURED, V.NOT_MEASURED, V.NOT_MEASURED, V.NOT_MEASURED], '[١١] لا خامّ: RAW_STATE FAIL وما يعتمد عليه NOT_MEASURED');
    ok(basisHas(res, I.APP_VERSION, /RAW_FINGERPRINT_ABSENT/), '[١١] بسبب RAW_FINGERPRINT_ABSENT');
    // legacy مضمَّن
    r = evalOf('c11', {rawState: 'EMBEDDED_LEGACY'});
    ok(verdictOf(r, I.RAW_STATE) === V.FAIL && basisHas(r, I.RAW_STATE, /state=EMBEDDED_LEGACY/) && verdictOf(r, I.APP_VERSION) === V.PASS, '[١١] EMBEDDED_LEGACY ⟵ RAW_STATE FAIL (تقرير جديد يجب أن يكون PRIVATE) والبنود الأخرى تُحسَب');
    // بصمة بلا timeSeries
    const noTs = factsOf('c11').facts;
    noTs.rawRead.raw.rawFingerprint = {device: {}, manualResults: [], functionalResults: []};
    noTs.storage = {state: 'STORAGE_PATH_ABSENT'};
    res = D.evaluateReport(noTs, {accountHash: ACCOUNT_HASH});
    ok(verdictOf(res, I.APP_VERSION) === V.NOT_MEASURED && verdictOf(res, I.FIELDS_VERSION) === V.NOT_MEASURED, '[١١] بصمة بلا timeSeries: الإصدارات NOT_MEASURED');
    ok(allItems.filter((x) => ![I.REPORT_FOUND].includes(x)).filter((x) => !String(x).startsWith('SESSION_') || x === I.SESSION_SCAN).every((x) => rowOf(res, x)), '[١١] وكل بند له صفّ (لا حذف صامت)');
    // خطأ Storage بأنواعه
    for (const [state, expected] of [['DOWNLOADED_NOT_GZIP', V.FAIL], ['GUNZIP_ERROR', V.FAIL], ['DOWNLOAD_ERROR', V.FAIL], ['FILE_NOT_FOUND', V.FAIL], ['STORAGE_PATH_ABSENT', V.NOT_MEASURED], ['STORAGE_NOT_READ_BY_OPTION', V.NOT_MEASURED]]) {
      r = evalOf('c11', {storage: {state, ...(state === 'DOWNLOAD_ERROR' ? {errorCode: '403', errorClass: 'Error'} : {})}});
      eq(verdictOf(r, I.STORAGE_COPY), expected, `[١١] نسخة Storage ${state} ⟵ ${expected}`);
    }
    r = evalOf('c11', {storage: {state: 'DOWNLOAD_ERROR', errorCode: '403', errorClass: 'Error'}});
    deq([r.block.storage.errorCode, r.block.storage.errorClass], ['403', 'Error'], '[١١] خطأ Storage: الرمز والصنف في الكتلة');
  }

  // ═══ ١٢ — جمع الحقائق على db مزيَّف ═══
  const SCANS = {B1: 'scan-B1-secret-0001', B2: 'scan-B2-secret-0002', S1: 'scan-S1-secret-0003', S2: 'scan-S2-secret-0004'};
  const SHORT = {B1: 'NC-BBB001', B2: 'NC-BBB002', S1: 'NC-SSS001', S2: 'NC-SSS002', WAIT: 'NC-WAIT01'};
  const SESSION_ID = 'sess-SECRET-0001';
  const makeWorld = ({tags = ['B1', 'B2', 'S1'], keyOf = {B1: 'c11', B2: 'c13', S1: 'c16', S2: 'c16'}, sessionDoc = undefined, evaluations = {}, extraReports = {}} = {}) => {
    const reports = {};
    const reportRaw = {};
    const objects = {};
    for (const tag of tags) {
      const payload = payloadOf(keyOf[tag]);
      const isSession = tag.startsWith('S');
      reports[SCANS[tag]] = {shortId: SHORT[tag], userId: OWNER_UID, pipeline: 'v7_findings_based'};
      const sp = `scans/sha-${tag}/${SCANS[tag]}.ts.json.gz`;
      reportRaw[SCANS[tag]] = {scanId: SCANS[tag], rawFingerprint: clone(lightenFingerprintForStorage(payload)), sessionId: isSession ? SESSION_ID : null, deviceFingerprintSha: `sha-${tag}`, timeSeriesStoragePath: sp, aiAudit: null, source: 'analyzeDevice'};
      objects[sp] = H.gz(storageFileOf(payload));
    }
    const sessions = sessionDoc === null ? {} : {[SESSION_ID]: {status: 'completed', joinedBy: 'anon-joiner-uid', joinedAt: ts(NOW - 5000), scanId: SCANS.S1, ownerId: OWNER_UID, ...(sessionDoc || {})}};
    return {collections: {reports: {...reports, ...extraReports}, reportRaw, users: {[OWNER_UID]: {}}, scanSessions: sessions, evaluations}, objects};
  };
  {
    const {collections, objects} = makeWorld({evaluations: {[SCANS.S1]: {pending: false, linkageRawState: 'PRIVATE', linkageIncomplete: false, source: 'session', ownerMismatch: false, revisionCount: 0, technicianName: 'SECRET TECH NAME'}}});
    const db = makeMemDb(collections);
    const {bucket, calls} = H.makeStubBucket(objects);
    const rb = C.wrapReadOnlyBucket(bucket);
    const facts = await D.gatherReportFacts({db: C.wrapReadOnly(db), bucket: rb, tag: 'SX', shortId: SHORT.S1, accountHash: ACCOUNT_HASH, useStorage: true});
    deq([facts.found, facts.ownerMatches, facts.rawRead.state, facts.storage.state, facts.session.state, facts.evaluation.exists], [1, true, 'PRIVATE', 'DOWNLOADED', 'READ', true], '[١٢] حقائق جلسة S1: واحد، المالك، PRIVATE، Storage، الجلسة، التقييم');
    deq([facts.session.scanIdMatches, facts.session.ownerMatches], [true, true], '[١٢] ربط الجلسة بالتقرير والمالك');
    eq(facts.scanIdHash, C.hashIdForLog(SCANS.S1), '[١٢] scanId مُهشَّر');
    ok(!JSON.stringify({...facts, rawRead: undefined, storage: undefined, session: {...facts.session, data: undefined}, evaluation: undefined}).includes(SCANS.S1), '[١٢] ولا scanId خامّ في الحقائق الخارجة (غير الخامّ المقروء)');
    deq(calls.map((c) => c.op), ['exists', 'download'], '[١٢] نداءان لـStorage: exists ثم download');
    deq(calls[1].opts, {decompress: false}, '[١٢] download بـ{decompress:false} وحده');
    deq(db.writeAttempts, [], '[١٢] لا كتابة');
    const b1 = await D.gatherReportFacts({db: C.wrapReadOnly(makeMemDb(collections)), bucket: rb, tag: 'G1', shortId: SHORT.B1, accountHash: ACCOUNT_HASH, useStorage: true});
    deq([b1.session.state, b1.evaluation.exists], ['NOT_A_SESSION_SCAN', false], '[١٢] B1: ليس فحص جلسة ولا تقييم');
    const none = await D.gatherReportFacts({db: C.wrapReadOnly(makeMemDb(collections)), bucket: rb, tag: 'G1', shortId: 'NC-NOSUCH', accountHash: ACCOUNT_HASH, useStorage: true});
    deq([none.found, none.rawRead], [0, undefined], '[١٢] رمز غير موجود: found=0 بلا قراءة خامّ');
    const dup = makeWorld({extraReports: {dupDoc: {shortId: SHORT.B1, userId: OWNER_UID}}});
    const d2 = await D.gatherReportFacts({db: C.wrapReadOnly(makeMemDb(dup.collections)), bucket: rb, tag: 'G1', shortId: SHORT.B1, accountHash: ACCOUNT_HASH, useStorage: true});
    eq(d2.found, 2, '[١٢] رمز مكرَّر: found=2 بلا قراءة أخرى');
    const nos = await D.gatherReportFacts({db: C.wrapReadOnly(makeMemDb(collections)), bucket: null, tag: 'G1', shortId: SHORT.B1, accountHash: ACCOUNT_HASH, useStorage: false});
    eq(nos.storage.state, 'STORAGE_NOT_READ_BY_OPTION', '[١٢] --no-storage: لا نداء Storage (bucket=null) وحالة صريحة');
    // sessionId غير نصّ
    const weird = makeWorld();
    weird.collections.reportRaw[SCANS.S1].sessionId = 12345;
    const w = await D.gatherReportFacts({db: C.wrapReadOnly(makeMemDb(weird.collections)), bucket: rb, tag: 'SX', shortId: SHORT.S1, accountHash: ACCOUNT_HASH, useStorage: true});
    eq(w.session.state, 'SESSION_ID_UNREADABLE', '[١٢] sessionId ليس نصّاً: SESSION_ID_UNREADABLE');
    // مستند الجلسة غائب
    const noSess = makeWorld({sessionDoc: null});
    const ns = await D.gatherReportFacts({db: C.wrapReadOnly(makeMemDb(noSess.collections)), bucket: rb, tag: 'SX', shortId: SHORT.S1, accountHash: ACCOUNT_HASH, useStorage: true});
    eq(ns.session.state, 'SESSION_DOC_ABSENT', '[١٢] مستند الجلسة غائب: SESSION_DOC_ABSENT');
    // تقرير حساب آخر
    const other = makeWorld();
    other.collections.reports[SCANS.B1].userId = 'someone-else-uid';
    const o = await D.gatherReportFacts({db: C.wrapReadOnly(makeMemDb(other.collections)), bucket: rb, tag: 'G1', shortId: SHORT.B1, accountHash: ACCOUNT_HASH, useStorage: true});
    eq(o.ownerMatches, false, '[١٢] تقرير حساب آخر: ownerMatches=false');
    other.collections.reports[SCANS.B1].userId = undefined;
    delete other.collections.reports[SCANS.B1].userId;
    const o2 = await D.gatherReportFacts({db: C.wrapReadOnly(makeMemDb(other.collections)), bucket: rb, tag: 'G1', shortId: SHORT.B1, accountHash: ACCOUNT_HASH, useStorage: true});
    eq(o2.ownerMatches, null, '[١٢] بلا userId: ownerMatches=null');
  }

  // ═══ ١٣ — main ═══
  const ENV = {[C.OWNER_EMAIL_ENV]: SECRET_EMAIL};
  const authOk = {getUserByEmail: async (email) => {
    if (email !== SECRET_EMAIL) throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
    return {uid: OWNER_UID};
  }};
  const secretIn = (text, extra = []) => [SECRET_EMAIL, OWNER_UID, 'owner.s10', 'anon-joiner-uid', 'SECRET TECH NAME', SESSION_ID, ...Object.values(SCANS), ...Object.values(SHORT), 'sha-B1', 'sha-S1', ...extra].filter((s) => text.includes(s));
  const evaluationsS1 = {[SCANS.S1]: {pending: false, linkageRawState: 'PRIVATE', linkageIncomplete: false, source: 'session', ownerMismatch: false, revisionCount: 0, technicianName: 'SECRET TECH NAME'}};
  {
    const {collections, objects} = makeWorld({evaluations: evaluationsS1});
    const db = makeMemDb(collections);
    const {bucket, calls, writeAttempts} = H.makeStubBucket(objects);
    const outPath = nextOut();
    const fsSpy = H.spyFsWrites();
    const netGuard = H.blockNonLocalNetwork();
    let r;
    try {
      r = await H.runMain(main, ['--tokens', `G1=${SHORT.B1},G2=${SHORT.B2},SX=${SHORT.S1}`, '--out', outPath], {env: ENV, now: () => NOW, db, auth: authOk, bucket});
    } finally {
      fsSpy.restore(); netGuard.restore();
    }
    eq(r.code, 0, '[١٣] النجاح بلا FAIL: 0');
    deq(fsSpy.writes.map((w) => w.path), [path.resolve(outPath)], '[١٣] الكتابة الوحيدة على القرص: ملفّ المخرَج');
    deq([netGuard.blocked, writeAttempts, db.writeAttempts], [[], [], []], '[١٣] لا شبكة خارجية ولا كتابة Storage ولا Firestore');
    eq(calls.filter((c) => c.op === 'download').length, 3, '[١٣] ثلاثة تنزيلات (واحد لكل تقرير)');
    ok(calls.filter((c) => c.op === 'download').every((c) => JSON.stringify(c.opts) === '{"decompress":false}'), '[١٣] كلّها بـ{decompress:false} بلا destination');
    const bytes = fs.readFileSync(outPath);
    ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), '[١٣] UTF-8 بلا BOM');
    const text = bytes.toString('utf8');
    deq(secretIn(`${text}\n${r.text}`), [], '[١٣] لا بريد ولا uid ولا scanId ولا shortId ولا sessionId ولا joinedBy ولا اسم فنّي ولا بصمة جهاز في الملفّ ولا stdout ولا stderr');
    const j = JSON.parse(text);
    deq([Object.keys(j)[0], j.projectId, j.mode, j.schema], ['projectId', 'neuralchek-9b6d7', 'device-check-03-after', 1], '[١٣] projectId أوّل حقل، وmode وschema');
    eq(j.owner.accountHash, ACCOUNT_HASH, '[١٣] حساب المالك مُهشَّر');
    eq(j.owner.accountReportsCount, 3, '[١٣] عدد تقارير حساب المالك (للمقارنة بالسكربت ١)');
    deq(j.input.tags.map((t) => [t.tag, t.shortIdHash]), [['G1', C.hashIdForLog(SHORT.B1)], ['G2', C.hashIdForLog(SHORT.B2)], ['SX', C.hashIdForLog(SHORT.S1)]], '[١٣] الوسوم برموزها مُهشَّرة');
    deq(j.criteria.cpuDShare, {text: 'والقبول: مجموع زمن D في المرحلة ≤ 1% من زمنها.', maxPercent: 1, source: 'user decision 2026-10-08, quoted in the order'}, '[١٣] نصّ معيار D بنصّ قرار المستخدم');
    deq(j.rules, JSON.parse(JSON.stringify(D.ITEM_RULES)), '[١٣] قاعدة كل بند مكتوبة في المخرَج');
    ok(j.table.every((x) => ['tag', 'item', 'verdict', 'basis'].every((k) => typeof x[k] === 'string')) && j.table.every((x) => [V.PASS, V.FAIL, V.NOT_MEASURED, V.INFO].includes(x.verdict)), '[١٣] الجدول: tag وitem وverdict من الأربعة وbasis');
    const counts = {PASS: 0, FAIL: 0, NOT_MEASURED: 0, INFO: 0};
    for (const x of j.table) counts[x.verdict]++;
    deq([j.summary.rows, j.summary.verdicts, j.summary.hasFail], [j.table.length, counts, false], '[١٣] الملخّص = عدّ الجدول نفسه (من المخرَج لا باليد)');
    deq(Object.keys(j.summary.byTag).sort(), ['G1', 'G2', 'SX'], '[١٣] وبحسب الوسم');
    deq(j.reports.map((x) => x.tag), ['G1', 'G2', 'SX'], '[١٣] كتل التقارير بالترتيب');
    deq([j.table.filter((x) => x.tag === 'G1' && x.item.startsWith('CPU_D_RUN_')).length, j.table.filter((x) => x.tag === 'G1' && x.item.startsWith('CPU_D_BREAKDOWN_')).length, j.table.filter((x) => x.tag === 'G1' && x.item === 'CPU_D_RUNS').map((x) => x.verdict)], [6, 2, ['INFO']], '[١٣] المخرَج الحقيقي: ستّة صفوف تشغيل وصفّان للمرحلتين وملخّص D (INFO) لتقرير G1');
    deq([j.reports[0].cpuD.runDetail.runs.map((r) => r.index), Object.keys(j.reports[0].cpuD.runDetail.byPhase), j.reports[0].cpuD.runDetail.byPhase['3'].diff], [[0, 1, 2, 3, 4, 5], ['3', '5'], {sumMs: 360, runsCounted: 3}], '[١٣] وكتلة التقرير تحمل runDetail بتشغيلاتها ومجاميع مراحلها');
    ok(['CPU_D_RUNS', 'CPU_D_RUN', 'CPU_D_BREAKDOWN'].every((it) => typeof j.rules[it] === 'string'), '[١٣] وقواعد البنود الثلاثة مكتوبة في المخرَج');
    deq(['ENERGY_COUNTER_NWH', 'CPU_TEMP_FINAL_SOURCE', 'WORKERS_PIN_STATE', 'MEMORY_VERIFY_STATE', 'TIME_TO_FIRST_FIX_STATE'].map((it) => j.table.find((x) => x.tag === 'G1' && x.item === it).verdict), ['INFO', 'INFO', 'INFO', 'INFO', 'INFO'], '[١٣] المخرَج الحقيقي: صفوف القيم الإضافية الخمسة INFO لتقرير G1');
    deq(Object.keys(j.reports[0].stateValues).sort(), ['cpuTempFinalSource', 'energyCounterNwh', 'memoryVerifyState', 'timeToFirstFixState', 'workersPinState'], '[١٣] وكتلة التقرير تحمل stateValues (بلا حقل داخلي)');
    ok(['ENERGY_COUNTER_NWH', 'CPU_TEMP_FINAL_SOURCE', 'WORKERS_PIN_STATE', 'MEMORY_VERIFY_STATE', 'TIME_TO_FIRST_FIX_STATE'].every((it) => typeof j.rules[it] === 'string'), '[١٣] وقواعدها مكتوبة في المخرَج');
    ok(/^device-check-03 after written: tags=G1,G2,SX rows=\d+ PASS=\d+ FAIL=0 NOT_MEASURED=\d+ INFO=\d+ accountReportsCount=3$/.test(r.outs[0]), `[١٣] سطر الملخّص — ${r.outs[0]}`);
    eq(rowOfTable(j.table, 'SX', 'EVALUATION_NO_MOVED_IDS').verdict, V.PASS, '[١٣] جدول S1: التقييم بلا معرّفات منقولة');
    eq(rowOfTable(j.table, 'G2', 'M02_RAW').verdict, V.PASS, '[١٣] جدول B2: M02_RAW');
    // wx
    const r2 = await H.runMain(main, ['--tokens', `G1=${SHORT.B1}`, '--out', outPath], {env: ENV, now: () => NOW, db, auth: authOk, bucket});
    eq(r2.code, 2, '[١٣] ملفّ موجود: 2 (لا استبدال)');
    ok(r2.errs.some((e) => /OUT_EXISTS/.test(e)), '[١٣] OUT_EXISTS');
    eq(fs.readFileSync(outPath, 'utf8'), text, '[١٣] والملفّ القائم لم يُمسّ');
  }
  function rowOfTable(table, tag, item) { return table.find((x) => x.tag === tag && x.item === item); }
  {
    // رمز الخروج 1 عند FAIL: تقرير حساب آخر
    const {collections, objects} = makeWorld();
    collections.reports[SCANS.B1].userId = 'someone-else-uid';
    const {bucket} = H.makeStubBucket(objects);
    const outPath = nextOut();
    const r = await H.runMain(main, ['--tokens', `G1=${SHORT.B1}`, '--out', outPath], {env: ENV, now: () => NOW, db: makeMemDb(collections), auth: authOk, bucket});
    eq(r.code, 1, '[١٣] FAIL واحد على الأقلّ: 1');
    const j = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    eq(rowOfTable(j.table, 'G1', 'REPORT_OWNED_BY_OWNER_ACCOUNT').verdict, V.FAIL, '[١٣] REPORT_OWNED_BY_OWNER_ACCOUNT FAIL');
    eq(j.summary.hasFail, true, '[١٣] hasFail=true');
    ok(!secretIn(`${fs.readFileSync(outPath, 'utf8')}\n${r.text}`, ['someone-else-uid']).length, '[١٣] ولا uid الحساب الآخر خامّاً');
    // رمز غير موجود
    const r2 = await H.runMain(main, ['--tokens', 'G1=NC-NOSUCH', '--out', nextOut()], {env: ENV, now: () => NOW, db: makeMemDb(collections), auth: authOk, bucket});
    eq(r2.code, 1, '[١٣] رمز غير موجود: FAIL (REPORT_FOUND): 1');
    // --no-storage
    const {collections: c3, objects: o3} = makeWorld();
    const stub = H.makeStubBucket(o3);
    const out3 = nextOut();
    const r3 = await H.runMain(main, ['--tokens', `G1=${SHORT.B1}`, '--out', out3, '--no-storage'], {env: ENV, now: () => NOW, db: makeMemDb(c3), auth: authOk});
    eq(r3.code, 0, '[١٣] --no-storage بلا bucket: ينجح (0)');
    const j3 = JSON.parse(fs.readFileSync(out3, 'utf8'));
    deq([rowOfTable(j3.table, 'G1', 'CPU_D_SHARE').verdict, rowOfTable(j3.table, 'G1', 'GPU_FPS_TAIL').verdict, rowOfTable(j3.table, 'G1', 'STORAGE_COPY').verdict, j3.input.storageRead], [V.NOT_MEASURED, V.NOT_MEASURED, V.NOT_MEASURED, 'not read (--no-storage)'], '[١٣] --no-storage: بنود العيّنات NOT_MEASURED بالسبب، وتُعلَن في المدخل');
    ok(/STORAGE_NOT_READ_BY_OPTION/.test(rowOfTable(j3.table, 'G1', 'CPU_D_SHARE').basis), '[١٣] وسببها STORAGE_NOT_READ_BY_OPTION');
    eq(stub.calls.length, 0, '[١٣] ولا نداء Storage');
    // أخطاء مسمّاة قبل أيّ قراءة
    const dbNoRead = makeMemDb(c3);
    const e1 = await H.runMain(main, ['--tokens', `G1=${SHORT.B1}`, '--out', path.join(tmp, 'no-such-dir', 'x.json')], {env: ENV, db: dbNoRead, auth: authOk});
    ok(e1.code === 2 && e1.errs.some((e) => /OUT_DIR_MISSING/.test(e)) && dbNoRead.reads.length === 0, '[١٣] مجلّد المخرَج غائب: 2 قبل أيّ قراءة');
    const e2 = await H.runMain(main, ['--tokens', `G1=${SHORT.B1}`, '--out', nextOut()], {env: {}, db: dbNoRead, auth: authOk});
    ok(e2.code === 2 && e2.errs.some((e) => /OWNER_EMAIL_ENV_MISSING/.test(e)) && dbNoRead.reads.length === 0, '[١٣] لا متغيّر بيئة: 2 قبل أيّ قراءة');
    const e3 = await H.runMain(main, ['--tokens', `G1=${SHORT.B1}`, '--out', nextOut()], {env: {[C.OWNER_EMAIL_ENV]: 'other@example.test'}, db: dbNoRead, auth: authOk});
    ok(e3.code === 2 && e3.errs.some((e) => /OWNER_ACCOUNT_NOT_FOUND \(code=auth\/user-not-found\)/.test(e)) && !e3.text.includes('other@example.test'), '[١٣] حساب غير موجود: 2 بلا بريد في النصّ');
    const boom = {getUserByEmail: async (email) => { throw Object.assign(new Error(`boom ${email} token=SECRETTOKEN`), {code: 'auth/internal-error'}); }};
    const e4 = await H.runMain(main, ['--tokens', `G1=${SHORT.B1}`, '--out', nextOut()], {env: ENV, db: dbNoRead, auth: boom});
    ok(e4.code === 2 && /AUTH_LOOKUP_FAILED \(code=auth\/internal-error\)/.test(e4.errs.join('')) && !e4.text.includes('SECRETTOKEN') && !e4.text.includes(SECRET_EMAIL), '[١٣] فشل Auth: الرمز وحده (القاعدة 36)');
    const e5 = await H.runMain(main, ['--tokens', 'bad', '--out', nextOut()], {env: ENV, db: dbNoRead, auth: authOk});
    eq(e5.code, 2, '[١٣] رموز خاطئة: 2');
    // الجدول يُظهر خطأ Storage باسمه
    const objectsErr = {};
    const {collections: c4} = makeWorld();
    const sp = Object.values(c4.reportRaw)[0].timeSeriesStoragePath;
    objectsErr[sp] = Object.assign(new Error(`AccessDenied ${sp} owner@example.test token=SECRETTOKEN`), {code: 403});
    const out4 = nextOut();
    const r4 = await H.runMain(main, ['--tokens', `G1=${SHORT.B1}`, '--out', out4], {env: ENV, now: () => NOW, db: makeMemDb(c4), auth: authOk, bucket: H.makeStubBucket(objectsErr).bucket});
    const t4 = fs.readFileSync(out4, 'utf8');
    eq(r4.code, 1, '[١٣] DOWNLOAD_ERROR ⟵ STORAGE_COPY FAIL ⟵ 1');
    ok(/DOWNLOAD_ERROR code=403 class=Error/.test(rowOfTable(JSON.parse(t4).table, 'G1', 'STORAGE_COPY').basis), '[١٣] الصفّ: DOWNLOAD_ERROR بالرمز والصنف');
    ok(!t4.includes('SECRETTOKEN') && !t4.includes('AccessDenied') && !t4.includes(sp) && !t4.includes('owner@example.test'), '[١٣] ولا نصّ خطأ ولا مسار Storage ولا بريد (القاعدة 36)');
    const pf = await H.runMain(main, ['--preflight'], {env: ENV});
    const pfj = JSON.parse(pf.outs.join('\n'));
    deq([pf.code, pfj.mode, pfj.network, pfj.readOnly, pfj.ok, pfj.ownerEmailEnvPresent], [0, 'preflight', false, true, true, true], '[١٣] --preflight: بلا شبكة، قراءة فقط، سليم، المتغيّر مضبوط (حضوره وحده)');
    ok(pfj.checks.length >= 15 && pfj.checks.every((c) => c.ok), '[١٣] وفحوصه كلّها مرّت');
    ok(!pf.text.includes(SECRET_EMAIL), '[١٣] preflight لا يطبع البريد');
  }

  // ═══ ١٤ — جولة التصحيح: جدول التوقّعات لكل وسم (B1 · B2 · S1 · S2 · WAIT) ═══
  // مصدر التوقّعات: DEVICE-CHECK-03-2026-10-10.md (مساحة العمل) — منقولة في أمر المنسّق، غير متحقَّقة عندي؛ كل سطر في الجدول يحمل سطره. القاعدة 30: كل قيمة ممكنة من التعداد لا واحدة.
  {
    const E = D.EXPECT;
    const T = D.TAG_EXPECTATIONS;
    const SESS = (over = {}) => { const d = {status: 'completed', joinedBy: 'anon-joiner-uid', joinedAt: ts(NOW - 5000), scanId: 'scan-S1', ownerId: OWNER_UID, ...over}; return {state: 'READ', data: d, sessionIdHash: C.hashIdForLog('sess-1'), scanIdMatches: typeof d.scanId === 'string' && d.scanId !== '' ? d.scanId === 'scan-S1' : null, ownerMatches: typeof d.ownerId === 'string' && d.ownerId !== '' ? d.ownerId === OWNER_UID : null}; };
    const EVD = (over = {}) => ({exists: true, data: {scanId: 'x', pending: false, ownerMismatch: false, linkageIncomplete: false, linkageRawState: 'PRIVATE', missingLinkageFields: [], source: 'session', revisionCount: 0, resolvedAt: ts(NOW), ...over}});
    const bh = (p) => p.timeSeries.footer.batteryHealth;
    const sessionOpts = (over = {}, evOver = {}) => ({session: SESS(over), evaluation: EVD(evOver)});
    const items = (r) => r.rows.map((x) => x.item);
    const anyFail = (r) => r.rows.some((x) => x.verdict === V.FAIL);
    const failing = (r) => r.rows.filter((x) => x.verdict === V.FAIL).map((x) => x.item);
    const v67 = (p) => { p.timeSeries.header.appVersion = '1.0.10'; }; // عيّنة fv67 الذهبية تحمل header.appVersion = 1.0.8-v6beta (ملفّها الزمني أقدم)؛ فحص 1.0.10 الحقيقي يكتب 1.0.10

    // ── ١٤-أ — سلامة الجدول ──
    deq(Object.keys(T), ['B1', 'B2', 'S1', 'S2', 'WAIT'], '[١٤-أ] الوسوم الخمسة ثابتة بأسمائها');
    for (const tag of Object.keys(T)) {
      ok(T[tag].lines.length >= 2 && T[tag].lines.every((l) => (/^DEVICE-CHECK-03-2026-10-10\.md:\d+(-\d+)?/.test(l.source) || l.source === D.ORDER1_SOURCE) && l.quote.length > 0 && l.rule.length > 0), `[١٤-أ] ${tag}: كل سطر بمصدر (سطر الوثيقة أو أمر المنسّق الأوّل) واقتباس وقاعدة`);
    }
    for (const tag of ['B2', 'S1', 'S2', 'WAIT']) deq([T[tag].appVersion, T[tag].fieldsVersion], ['1.0.11', 69], `[١٤-أ] ${tag}: 1.0.11 وختم 69`);
    deq([T.B1.appVersion, T.B1.fieldsVersion, T.B1.scan], ['1.0.10', 67, 'LEGACY_FV67'], '[١٤-أ] B1: 1.0.10 وختم 67 (فحص قديم أُعيد تحليله)');
    deq(Object.values(T).map((e) => e.sessionStrict), [false, false, true, true, false], '[١٤-أ] التشديد للجلسة لـS1 وS2 وحدهما');
    ok(T.B1.lines[0].quote.includes('بختم **67** (فحص 1.0.10، والخادم يقرؤه)، وتقريره صدر بـ`reportRaw` كاملاً.') && T.B1.lines[0].source === 'DEVICE-CHECK-03-2026-10-10.md:79', '[١٤-أ] B1: اقتباس :79 حرفياً');
    eq(T.B2.lines.find((l) => l.item === E.M02_AUTO_COMPLETE_FULL_GRID).quote, 'M-02: `endReason = auto_complete`، و`elapsedMs` و`timeToFirstTouchMs` حاضران، و`touchedCells = totalCells`.', '[١٤-أ] B2: اقتباس M-02 حرفياً');
    eq(T.B2.lines.find((l) => l.item === E.M02_AUTO_COMPLETE_FULL_GRID).source, 'DEVICE-CHECK-03-2026-10-10.md:94-95', '[١٤-أ] ومصدره :94-95');
    eq(T.B2.lines.find((l) => l.item === E.CYCLE_NOT_READ_DECLARED).quote, 'البند ٤-أ (الـS10، API 30): غياب `cycleCount` معلن.', '[١٤-أ] B2: اقتباس الدورات :98 حرفياً');
    eq(T.S1.lines.find((l) => l.item === E.M02_NOT_WORKING_PARTIAL_GRID).quote, 'M-02: `endReason = user_marked_not_working`، والحالة `fail`، و`touchedCells < totalCells`.', '[١٤-أ] S1: اقتباس M-02 حرفياً (:110-112)');
    eq(T.S2.lines.find((l) => l.item === 'SESSION_JOINED_BY').source, 'DEVICE-CHECK-03-2026-10-10.md:126-127', '[١٤-أ] S2: joinedBy :126-127');
    ok(T.S1.lines.find((l) => l.item === E.CYCLE_EXTRA_API34_POSITIVE).quote.startsWith('`cycleCount` في حمولة فحص الـS21 من `EXTRA_CYCLE_COUNT`، ومصدره `extra_api34`.') && T.S1.lines.find((l) => l.item === 'EVALUATION_DOC').source.includes(':167'), '[١٤-أ] S1: اقتباس الدورات (:141-142) وشرط توقّف التقييم (:167)');
    eq(T.WAIT.lines.find((l) => l.item === 'SESSION_SCAN').quote, 'الـS10، فحص من الرئيسية، فحصة رابعة', '[١٤-أ] WAIT: اقتباس :130');
    for (const id of Object.values(E)) ok(D.ITEM_RULES[id].includes('DEVICE-CHECK-03-2026-10-10.md:') && D.ITEM_RULES[id].includes('«'), `[١٤-أ] rules: ${id} بنصّه واقتباسه وسطر وثيقته`);
    ok(D.ITEM_RULES.APP_VERSION.includes('B1: PASS: header.appVersion = 1.0.10') && D.ITEM_RULES.FIELDS_VERSION.includes('= 69 بالضبط (لا ≥)') && D.ITEM_RULES.SESSION_JOINED_BY.includes('S2:') && D.ITEM_RULES.EVALUATION_DOC.includes(':167'), '[١٤-أ] rules: بنود الإصدار والجلسة والتقييم تذكر متغيّرات الوسوم بأسطرها');
    for (const t of ['b1', 'B3', 'WAIT2', 'G1', '', undefined, null, 'B1 ']) eq(D.tagExpectation(t), null, `[١٤-أ] وسم «${t}» بلا توقّعات خاصّة (الأسماء حرفية، حسّاسة للحالة)`);
    deq(D.expectationBlock('G1'), {special: false, note: 'وسم بلا توقّعات خاصّة: القواعد العامّة وحدها (الوسوم ذات التوقّعات: B1 · B2 · S1 · S2 · WAIT)'}, '[١٤-أ] وسم بلا توقّعات: يُعلَن في كتلته');
    const eo = D.expectationsOutput(['B1', 'G1', 'S2']);
    deq([eo.thisRun.map((x) => [x.tag, x.special]), eo.tagsWithExpectations, eo.document], [[['B1', true], ['G1', false], ['S2', true]], ['B1', 'B2', 'S1', 'S2', 'WAIT'], 'DEVICE-CHECK-03-2026-10-10.md'], '[١٤-أ] expectationsOutput: وسوم التشغيل وأيّها بلا توقّعات خاصّة');
    ok(/غير متحقَّق/.test(eo.transcription), '[١٤-أ] وتُوسَم الوثيقة «منقول، غير متحقَّق»');

    // ── ١٤-ب — B1: فحص 1.0.10 (ختم 67) أُعيد تحليله ──
    {
      const real = evalOf('fv67', {tag: 'B1', mutate: v67});
      eq(failing(real).length, 0, `[١٤-ب] B1 من عيّنة fv67 الحقيقية (بعد header 1.0.10): لا FAIL في الجدول — ${failing(real).join(',')}`);
      deq([verdictOf(real, I.APP_VERSION), verdictOf(real, I.FIELDS_VERSION), verdictOf(real, I.RAW_STATE), verdictOf(real, D.EXPECT.B1_LEGACY_FV67_SCAN)], [V.PASS, V.PASS, V.PASS, V.PASS], '[١٤-ب] B1: 1.0.10 وختم 67 وPRIVATE وتوقّع الفحص القديم PASS');
      deq(real.block.versions, {appVersion: '1.0.10', fieldsVersion: 67}, '[١٤-ب] B1: الإصدار والختم من القارئ');
      const legacyItems = Object.keys(D.LEGACY_BY_NATURE);
      ok(legacyItems.every((it) => verdictOf(real, it) === V.NOT_MEASURED && /^LEGACY_FV67_SCAN: /.test(rowOf(real, it).basis)), '[١٤-ب] كل بند لا تحمله حمولة fv67 بطبيعتها ⟵ NOT_MEASURED بسبب LEGACY_FV67_SCAN (لا FAIL)');
      deq(real.block.legacyByNature.items.map((x) => x.item).sort(), [...legacyItems].sort(), '[١٤-ب] وتُسرَد في الكتلة بأسمائها');
      eq(legacyItems.length, 15, '[١٤-ب] خمسة عشر بنداً (ستّة من fv69 وتسعة من fv68: الثامن CPU_D_SHARE والتاسع تفصيل D CPU_D_RUNS — أُضيف 2026-10-11)');
      deq(legacyItems.filter((it) => D.LEGACY_BY_NATURE[it].since === 69).sort(), [I.M02_RAW, I.M02_END_REASON_VS_STATUS, I.SN04_RAW, I.SN04_COVER_WINDOWS, I.MANUAL_UNAVAILABLE_CLASS, I.MANUAL_HIDDEN_BY_MODEL].sort(), '[١٤-ب] ما أُضيف في fv69');
      for (const keep of [I.MANUAL_STATUS_VOCAB, I.M02_MANUAL_STATUS, I.GPU_FPS_TAIL, I.SAMPLING_TIME, I.PAYLOAD_BYTES, I.READER_ANOMALIES]) ok(!/^LEGACY_FV67_SCAN/.test(rowOf(real, keep).basis), `[١٤-ب] ${keep} يبقى بقاعدته العامّة (fv67 يحمله)`);
      deq([verdictOf(real, I.MANUAL_STATUS_VOCAB), verdictOf(real, I.M02_MANUAL_STATUS), verdictOf(real, I.READER_ANOMALIES)], [V.PASS, V.INFO, V.PASS], '[١٤-ب] وأحكامها: PASS وINFO وPASS');
      // مطابقة الجدول للقارئ والحمولة (لا من الذاكرة): ما يعلنه القارئ غائباً بـNOT_IN_FIELDS_VERSION، وما تفتقده الحمولة من خامّ fv69
      const fp = payloadOf('fv67');
      const rd = readFv68Of(fp);
      const NIF = N.KEY_STATUS.NOT_IN_FIELDS_VERSION;
      const absentByReader = [];
      if (rd.thermal.headroom.readings.status === NIF) absentByReader.push(I.THERMAL_HEADROOM);
      if (rd.batteryPairs.state.status === NIF) absentByReader.push(I.BATTERY_BROADCASTS);
      if (rd.measurements.expectedButAbsent.some((x) => x.testId === 'L-02' && x.status === NIF)) absentByReader.push(I.L02);
      if (rd.verification.memory.state.status === NIF) absentByReader.push(I.MEMORY_KERNEL);
      if (rd.verification.storage.state.status === NIF) absentByReader.push(I.STORAGE_VERIFY);
      if (rd.verification.cpuKnownAnswer.state.status === NIF) absentByReader.push(I.CPU_D_SHARE);
      if (rd.verification.cpuKnownAnswer.runs.status === NIF) absentByReader.push(I.CPU_D_RUNS);
      if (rd.batteryHealth.cycleCount.valueStatus === NIF) absentByReader.push(I.CYCLE_COUNT, I.CYCLE_COUNT_MATCHES_B08);
      const m02e = fp.manualResults.find((m) => m.testId === 'M-02');
      if (!('measurements' in m02e)) absentByReader.push(I.M02_RAW, I.M02_END_REASON_VS_STATUS);
      const sn = fp.functionalResults.find((f) => f.testId === 'SN-04');
      if (!sn || !('measurements' in sn) || sn.measurements === null) absentByReader.push(I.SN04_RAW, I.SN04_COVER_WINDOWS);
      if (!fp.manualResults.some((m) => m.status === 'unavailable')) absentByReader.push(I.MANUAL_UNAVAILABLE_CLASS);
      if (!('manualResultsHeader' in fp)) absentByReader.push(I.MANUAL_HIDDEN_BY_MODEL);
      deq([...new Set(absentByReader)].sort(), [...legacyItems].sort(), '[١٤-ب] جدول LEGACY_BY_NATURE = ما يعلنه القارئ (NOT_IN_FIELDS_VERSION) وما تفتقده حمولة fv67 فعلاً — لا أكثر ولا أقلّ');
      // ضابط سلبي: على حمولة fv69 الأقسام نفسها حاضرة (فالجدول غير فارغ المعنى)
      const rd69 = readFv68Of(payloadOf('c11'));
      ok(rd69.thermal.headroom.readings.status === N.KEY_STATUS.PRESENT && rd69.verification.memory.state.status === N.KEY_STATUS.PRESENT && rd69.verification.cpuKnownAnswer.state.status === N.KEY_STATUS.PRESENT, '[١٤-ب] (ضابط سلبي) على حمولة fv69 أقسام fv68 حاضرة: الغياب خاصّية fv67 لا خلل القارئ');
      // الفرق المُبلَّغ: عيّنة fv67 كما هي تحمل 1.0.8-v6beta
      const asIs = evalOf('fv67', {tag: 'B1'});
      ok(verdictOf(asIs, I.APP_VERSION) === V.FAIL && basisHas(asIs, I.APP_VERSION, /appVersion=1\.0\.8-v6beta expected=1\.0\.10/), '[١٤-ب] عيّنة fv67 كما هي (header.appVersion = 1.0.8-v6beta) ⟵ APP_VERSION FAIL: الفرق الذي يُبلَّغ به');
      eq(verdictOf(asIs, I.FIELDS_VERSION), V.PASS, '[١٤-ب] وختمها 67 مطابق لـ:79');
    }
    // التعداد: كل قيمة إصدار ممكنة لـB1
    for (const [v, want] of [['1.0.10', V.PASS], ['1.0.11', V.FAIL], ['1.0.9', V.FAIL], ['1.0.8-v6beta', V.FAIL], ['1.0.10-debug', V.FAIL]]) {
      eq(verdictOf(evalOf('fv67', {tag: 'B1', mutate: (p) => { p.timeSeries.header.appVersion = v; }}), I.APP_VERSION), want, `[١٤-ب] B1 appVersion=${v} ⟵ ${want}`);
    }
    eq(verdictOf(evalOf('fv67', {tag: 'B1', mutate: (p) => { delete p.timeSeries.header.appVersion; }}), I.APP_VERSION), V.NOT_MEASURED, '[١٤-ب] B1 appVersion غائب ⟵ NOT_MEASURED');
    for (const [fv, want] of [[66, V.FAIL], [67, V.PASS], [68, V.FAIL], [69, V.FAIL], [70, V.FAIL]]) {
      const r = evalOf('fv67', {tag: 'B1', mutate: (p) => { v67(p); p.timeSeries.footer.fieldsVersion = fv; }});
      deq([verdictOf(r, I.FIELDS_VERSION), verdictOf(r, E.B1_LEGACY_FV67_SCAN)], [want, want], `[١٤-ب] B1 fieldsVersion=${fv} ⟵ ${want} (الختم ≥ 68: الوسم لا يطابق الفحص)`);
      eq(r.block.legacyByNature === undefined, fv !== 67, `[١٤-ب] B1 fieldsVersion=${fv}: ${fv === 67 ? 'يُطبَّق' : 'لا يُطبَّق'} استبدال LEGACY_FV67_SCAN`);
    }
    eq(verdictOf(evalOf('fv67', {tag: 'B1', mutate: (p) => { v67(p); delete p.timeSeries.footer.fieldsVersion; }}), I.FIELDS_VERSION), V.NOT_MEASURED, '[١٤-ب] B1 fieldsVersion غائب ⟵ NOT_MEASURED');
    {
      const r69 = evalOf('c11', {tag: 'B1'});
      deq([verdictOf(r69, I.APP_VERSION), verdictOf(r69, I.FIELDS_VERSION), verdictOf(r69, E.B1_LEGACY_FV67_SCAN)], [V.FAIL, V.FAIL, V.FAIL], '[١٤-ب] B1 بحمولة fv69 وإصدار 1.0.11: FAIL في الإصدار والختم والتوقّع (الوسم لا يطابق الفحص)');
      ok(basisHas(r69, E.B1_LEGACY_FV67_SCAN, /الوسم لا يطابق الفحص: ختم ≥ 68/), '[١٤-ب] وبسببه المسمّى');
      ok(r69.rows.filter((x) => D.LEGACY_BY_NATURE[x.item]).every((x) => !/^LEGACY_FV67_SCAN/.test(x.basis)) && verdictOf(r69, I.M02_RAW) === V.PASS, '[١٤-ب] ولا استبدال LEGACY: بنود fv68+ تُحكَم بقواعدها العامّة (حمولتها تحملها)');
    }
    for (const [st, want] of [['PRIVATE', V.PASS], ['ABSENT', V.FAIL], ['EMBEDDED_LEGACY', V.FAIL]]) eq(verdictOf(evalOf('fv67', {tag: 'B1', mutate: v67, rawState: st}), I.RAW_STATE), want, `[١٤-ب] B1 RAW_STATE=${st} ⟵ ${want} (:79 «reportRaw كاملاً»)`);
    {
      const nr = D.evaluateReport({...factsOf('fv67', {tag: 'B1', mutate: v67}).facts, rawRead: {state: 'ABSENT', raw: null}, storage: {state: 'RAW_ABSENT'}}, {accountHash: ACCOUNT_HASH});
      deq([verdictOf(nr, E.B1_LEGACY_FV67_SCAN), verdictOf(nr, I.RAW_STATE)], [V.NOT_MEASURED, V.FAIL], '[١٤-ب] B1 بلا خامّ: التوقّع NOT_MEASURED (لا بصمة تُقرأ) وRAW_STATE FAIL');
    }

    // ── ١٤-ج — الفحوص الجديدة: الإصدار 1.0.11 وختم 69 بالضبط ──
    for (const tag of ['B2', 'S1', 'S2', 'WAIT']) {
      const so = tag.startsWith('S') ? sessionOpts() : {};
      deq([verdictOf(evalOf('c11', {tag, ...so}), I.APP_VERSION), verdictOf(evalOf('c11', {tag, ...so}), I.FIELDS_VERSION)], [V.PASS, V.PASS], `[١٤-ج] ${tag}: 1.0.11 وختم 69 ⟵ PASS`);
      for (const [v, want] of [['1.0.11', V.PASS], ['1.0.10', V.FAIL], ['1.0.8-v6beta', V.FAIL], ['1.0.12', V.FAIL]]) eq(verdictOf(evalOf('c11', {tag, ...so, mutate: (p) => { p.timeSeries.header.appVersion = v; }}), I.APP_VERSION), want, `[١٤-ج] ${tag} appVersion=${v} ⟵ ${want}`);
      eq(verdictOf(evalOf('c11', {tag, ...so, mutate: (p) => { delete p.timeSeries.header.appVersion; }}), I.APP_VERSION), V.NOT_MEASURED, `[١٤-ج] ${tag} appVersion غائب ⟵ NOT_MEASURED`);
      for (const [fv, want] of [[66, V.FAIL], [67, V.FAIL], [68, V.FAIL], [69, V.PASS], [70, V.FAIL], [100, V.FAIL]]) {
        eq(verdictOf(evalOf('c11', {tag, ...so, mutate: (p) => { p.timeSeries.footer.fieldsVersion = fv; }}), I.FIELDS_VERSION), want, `[١٤-ج] ${tag} fieldsVersion=${fv} ⟵ ${want} (= 69 بالضبط لا ≥: شرط التوقّف :166)`);
      }
      eq(verdictOf(evalOf('c11', {tag, ...so, mutate: (p) => { delete p.timeSeries.footer.fieldsVersion; }}), I.FIELDS_VERSION), V.NOT_MEASURED, `[١٤-ج] ${tag} fieldsVersion غائب ⟵ NOT_MEASURED`);
    }
    // وسم بلا توقّعات: القاعدة العامّة (≥ 69) كما كانت
    for (const [fv, want] of [[67, V.FAIL], [68, V.FAIL], [69, V.PASS], [70, V.PASS]]) eq(verdictOf(evalOf('c11', {tag: 'G1', mutate: (p) => { p.timeSeries.footer.fieldsVersion = fv; }}), I.FIELDS_VERSION), want, `[١٤-ج] وسم بلا توقّعات خاصّة، fieldsVersion=${fv} ⟵ ${want} (≥ 69 كما كان)`);

    // ── ١٤-د — B2: الـS10 من الرئيسية ──
    {
      const ok2 = evalOf('c11', {tag: 'B2'});
      eq(failing(ok2).length, 0, `[١٤-د] B2 بحمولة 11ch الذهبية: لا FAIL — ${failing(ok2).join(',')}`);
      deq(D.expectItemsOf('B2').map((id) => verdictOf(ok2, id)), [V.PASS, V.PASS, V.PASS, V.INFO, V.PASS], '[١٤-د] صفوف B2 الخمسة: M-02 وunavailable وhiddenByModel وSN-04 INFO والدورات');
      deq(D.expectItemsOf('B2'), [E.M02_AUTO_COMPLETE_FULL_GRID, E.MANUAL_UNAVAILABLE_HARDWARE_ABSENT, E.HIDDEN_BY_MODEL_EMPTY, E.SN04_COVER_NO_THRESHOLD, E.CYCLE_NOT_READ_DECLARED], '[١٤-د] وأسماؤها المميَّزة');
      ok(!items(ok2).includes(E.M02_NOT_WORKING_PARTIAL_GRID) && !items(ok2).includes(E.CYCLE_EXTRA_API34_POSITIVE) && !items(ok2).includes(E.B1_LEGACY_FV67_SCAN), '[١٤-د] ولا صفوف وسوم أخرى');
      // M-02: كل endReason ممكن
      for (const [er, want] of [['auto_complete', V.PASS], ['user_marked_not_working', V.FAIL], ['user_marked_not_tested', V.FAIL], ['dismissed', V.FAIL], ['weird', V.FAIL]]) {
        eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { m02Of(p).measurements.endReason = er; }}), E.M02_AUTO_COMPLETE_FULL_GRID), want, `[١٤-د] B2 endReason=${er} ⟵ ${want}`);
      }
      eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { delete m02Of(p).measurements.endReason; }}), E.M02_AUTO_COMPLETE_FULL_GRID), V.FAIL, '[١٤-د] B2 endReason غائب ⟵ FAIL');
      // M-02: الزمنان والعدّادان
      let r = evalOf('c11', {tag: 'B2', mutate: (p) => { delete m02Of(p).measurements.elapsedMs; }});
      ok(verdictOf(r, E.M02_AUTO_COMPLETE_FULL_GRID) === V.FAIL && basisHas(r, E.M02_AUTO_COMPLETE_FULL_GRID, /elapsedMs:ABSENT/), '[١٤-د] B2 elapsedMs غائب ⟵ FAIL');
      r = evalOf('c11', {tag: 'B2', mutate: (p) => { delete m02Of(p).measurements.timeToFirstTouchMs; }});
      ok(verdictOf(r, E.M02_AUTO_COMPLETE_FULL_GRID) === V.FAIL && basisHas(r, E.M02_AUTO_COMPLETE_FULL_GRID, /timeToFirstTouchMs:ABSENT/), '[١٤-د] B2 timeToFirstTouchMs غائب ⟵ FAIL');
      r = evalOf('c11', {tag: 'B2', mutate: (p) => { m02Of(p).measurements.touchedCells = 0; delete m02Of(p).measurements.elapsedMs; delete m02Of(p).measurements.timeToFirstTouchMs; }});
      ok(verdictOf(r, E.M02_AUTO_COMPLETE_FULL_GRID) === V.FAIL, '[١٤-د] B2 بلا لمسة (الزمنان غائبان بإعلان، touchedCells=0) ⟵ FAIL: المطلوب «حاضران»');
      for (const [tc, want] of [[120, V.PASS], [119, V.FAIL], [0, V.FAIL], [121, V.FAIL], ['120', V.FAIL]]) {
        eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { m02Of(p).measurements.touchedCells = tc; }}), E.M02_AUTO_COMPLETE_FULL_GRID), want, `[١٤-د] B2 touchedCells=${JSON.stringify(tc)} مع totalCells=120 ⟵ ${want}`);
      }
      eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { delete m02Of(p).measurements.totalCells; }}), E.M02_AUTO_COMPLETE_FULL_GRID), V.FAIL, '[١٤-د] B2 totalCells غائب ⟵ FAIL');
      r = evalOf('c11', {tag: 'B2', mutate: (p) => { delete m02Of(p).measurements; }});
      ok(verdictOf(r, E.M02_AUTO_COMPLETE_FULL_GRID) === V.FAIL && basisHas(r, E.M02_AUTO_COMPLETE_FULL_GRID, /M02_MEASUREMENTS_ABSENT/), '[١٤-د] B2 M-02 بلا measurements ⟵ FAIL (الإجابة مطلوبة)');
      r = evalOf('c11', {tag: 'B2', mutate: (p) => { p.manualResults = p.manualResults.filter((m) => m.testId !== 'M-02'); }});
      ok(verdictOf(r, E.M02_AUTO_COMPLETE_FULL_GRID) === V.FAIL && basisHas(r, E.M02_AUTO_COMPLETE_FULL_GRID, /M02_ABSENT_FROM_MANUAL_RESULTS/), '[١٤-د] B2 M-02 غائب ⟵ FAIL');
      // unavailable
      for (const [st, want] of [['unavailable', V.PASS], ['not_tested', V.FAIL], ['pass', V.FAIL], ['fail', V.FAIL], ['warning', V.FAIL]]) {
        eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { p.manualResults.find((m) => m.testId === 'M-08').status = st; }}), E.MANUAL_UNAVAILABLE_HARDWARE_ABSENT), want, `[١٤-د] B2 حالة M-08=${st} (الوحيدة المحتملة unavailable) ⟵ ${want}`);
      }
      eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { delete p.manualResults.find((m) => m.testId === 'M-08').status; }}), E.MANUAL_UNAVAILABLE_HARDWARE_ABSENT), V.FAIL, '[١٤-د] B2 حالة M-08 غائبة ⟵ FAIL');
      r = evalOf('c11', {tag: 'B2', mutate: (p) => { p.manualResults = p.manualResults.filter((m) => m.testId !== 'M-08'); }});
      ok(verdictOf(r, E.MANUAL_UNAVAILABLE_HARDWARE_ABSENT) === V.FAIL && basisHas(r, E.MANUAL_UNAVAILABLE_HARDWARE_ABSENT, /NO_UNAVAILABLE_ENTRY/), '[١٤-د] B2 لا unavailable ⟵ FAIL (الإجابة مطلوبة عمداً)');
      r = evalOf('c11', {tag: 'B2', mutate: (p) => { p.manualResults.push({testId: 'M-20', categoryName: 'x', componentName: 'y', status: 'unavailable'}); }});
      eq(verdictOf(r, E.MANUAL_UNAVAILABLE_HARDWARE_ABSENT), V.PASS, '[١٤-د] B2 unavailable اثنان ⟵ PASS (واحد على الأقلّ)');
      ok(basisHas(r, E.MANUAL_UNAVAILABLE_HARDWARE_ABSENT, /M-08:NOT_MEASURED\/HARDWARE_ABSENT M-20:NOT_MEASURED\/HARDWARE_ABSENT/), '[١٤-د] وبتصنيف كلٍّ');
      // hiddenByModel
      for (const [hv, want] of [[[], V.PASS], [['M-14'], V.FAIL], [['M-14', 'M-15'], V.FAIL]]) {
        eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { p.manualResultsHeader = {hiddenByModel: hv}; }}), E.HIDDEN_BY_MODEL_EMPTY), want, `[١٤-د] B2 hiddenByModel=${JSON.stringify(hv)} ⟵ ${want}`);
      }
      for (const [name, mut] of [['الرأس غائب', (p) => { delete p.manualResultsHeader; }], ['hiddenByModel غائبة', (p) => { p.manualResultsHeader = {}; }], ['نصّ', (p) => { p.manualResultsHeader = {hiddenByModel: 'M-14'}; }], ['عناصر غير نصوص', (p) => { p.manualResultsHeader = {hiddenByModel: [1]}; }], ['الرأس مصفوفة', (p) => { p.manualResultsHeader = []; }], ['null', (p) => { p.manualResultsHeader = {hiddenByModel: null}; }]]) {
        eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: mut}), E.HIDDEN_BY_MODEL_EMPTY), V.FAIL, `[١٤-د] B2 hiddenByModel: ${name} ⟵ FAIL`);
      }
      // SN-04: لا عتبة فلا حكم
      deq([verdictOf(ok2, E.SN04_COVER_NO_THRESHOLD), basisHas(ok2, E.SN04_COVER_NO_THRESHOLD, /before_mean=.* during_mean=.*لا عتبة رقمية في القرار فلا حكم/)], [V.INFO, true], '[١٤-د] B2 SN-04: INFO بالمتوسّطين، ولا عتبة تُخترَع');
      for (const [mn, mut] of [['قيم الثانية أعلى', (p) => { sn04Of(p).measurements.readingsDuringCover = [{t: 1500, values: [9999]}]; }], ['قيم الثانية أدنى', (p) => { sn04Of(p).measurements.readingsDuringCover = [{t: 1500, values: [0.5]}]; }], ['قائمتان فارغتان', (p) => { sn04Of(p).measurements.readingsBeforeCover = []; sn04Of(p).measurements.readingsDuringCover = []; }]]) {
        eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: mut}), E.SN04_COVER_NO_THRESHOLD), V.INFO, `[١٤-د] B2 SN-04 (${mn}) ⟵ INFO دائماً`);
      }
      eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { p.functionalResults = p.functionalResults.filter((f) => f.testId !== 'SN-04'); }}), E.SN04_COVER_NO_THRESHOLD), V.NOT_MEASURED, '[١٤-د] B2 SN-04 غائب ⟵ NOT_MEASURED');
      eq(verdictOf(evalOf('c11', {tag: 'B2', mutate: (p) => { delete sn04Of(p).measurements; }}), E.SN04_COVER_NO_THRESHOLD), V.NOT_MEASURED, '[١٤-د] B2 SN-04 بلا measurements ⟵ NOT_MEASURED');
      // الدورات: غير مقروءة بحالة معلنة
      const cyc = (mut) => verdictOf(evalOf('c11', {tag: 'B2', mutate: mut}), E.CYCLE_NOT_READ_DECLARED);
      eq(cyc(() => {}), V.PASS, '[١٤-د] B2 الدورات: not_read:sysfs_not_readable_or_absent_and_api_below_34 بلا قيمة ⟵ PASS');
      eq(cyc((p) => { bh(p).cycleCountState = 'not_read:other_reason'; }), V.PASS, '[١٤-د] B2 الدورات: not_read بسبب آخر ⟵ PASS (سبب الحالة حرّ)');
      eq(cyc((p) => { bh(p).cycleCountState = 'not_read'; }), V.FAIL, '[١٤-د] B2 الدورات: not_read بلا «:سبب» ⟵ FAIL (مفردة العقد `not_read:<سبب>`؛ القارئ يقرؤها غير معروفة)');
      eq(cyc((p) => { bh(p).cycleCountState = 'read'; bh(p).cycleCount = 187; bh(p).cycleCountSource = 'extra_api34'; }), V.FAIL, '[١٤-د] B2 الدورات: رقم بحالة read ⟵ FAIL');
      eq(cyc((p) => { bh(p).cycleCountState = 'read'; bh(p).cycleCount = 0; }), V.FAIL, '[١٤-د] B2 الدورات: صفر بحالة read ⟵ FAIL');
      eq(cyc((p) => { bh(p).cycleCountState = 'read'; }), V.FAIL, '[١٤-د] B2 الدورات: read بلا قيمة ⟵ FAIL');
      eq(cyc((p) => { delete bh(p).cycleCountState; }), V.FAIL, '[١٤-د] B2 الدورات: لا حالة ولا قيمة (غياب بلا حالة) ⟵ FAIL');
      eq(cyc((p) => { delete bh(p).cycleCountState; bh(p).cycleCount = 187; }), V.FAIL, '[١٤-د] B2 الدورات: قيمة بلا حالة ⟵ FAIL');
      eq(cyc((p) => { delete p.timeSeries.footer.batteryHealth; }), V.FAIL, '[١٤-د] B2 الدورات: batteryHealth غائب ⟵ FAIL');
      eq(cyc((p) => { bh(p).cycleCountState = 'mystery'; }), V.FAIL, '[١٤-د] B2 الدورات: حالة غير معروفة ⟵ FAIL');
      eq(cyc((p) => { bh(p).cycleCount = 55; }), V.FAIL, '[١٤-د] B2 الدورات: قيمة مع not_read ⟵ FAIL');
      eq(cyc((p) => { bh(p).cycleCountState = 'computed'; }), V.FAIL, '[١٤-د] B2 الدورات: حالة من مفردة أخرى ⟵ FAIL');
      // لا بصمة / لا تقرير
      const nofp = D.evaluateReport({...factsOf('c11', {tag: 'B2'}).facts, rawRead: {state: 'ABSENT', raw: null}, storage: {state: 'RAW_ABSENT'}}, {accountHash: ACCOUNT_HASH});
      ok(D.expectItemsOf('B2').every((id) => verdictOf(nofp, id) === V.NOT_MEASURED && /RAW_FINGERPRINT_ABSENT/.test(rowOf(nofp, id).basis)), '[١٤-د] B2 بلا بصمة: كل صفّ EXPECT NOT_MEASURED:RAW_FINGERPRINT_ABSENT');
      const norep = D.evaluateReport({tag: 'B2', shortIdHash: C.hashIdForLog('x'), found: 0}, {accountHash: ACCOUNT_HASH});
      ok(D.expectItemsOf('B2').every((id) => verdictOf(norep, id) === V.NOT_MEASURED && /REPORT_ABSENT/.test(rowOf(norep, id).basis)) && verdictOf(norep, I.REPORT_FOUND) === V.FAIL, '[١٤-د] B2 بلا تقرير: REPORT_FOUND FAIL وصفوف EXPECT NOT_MEASURED:REPORT_ABSENT (لا صفّ يُحذف صامتاً)');
      const norepG = D.evaluateReport({tag: 'G1', shortIdHash: C.hashIdForLog('x'), found: 0}, {accountHash: ACCOUNT_HASH});
      ok(!items(norepG).some((id) => id.startsWith('EXPECT_')), '[١٤-د] وسم بلا توقّعات وبلا تقرير: لا صفوف EXPECT');
    }

    // ── ١٤-هـ — S1: الجلسة الأولى (الـS21) ──
    {
      const good = evalOf('c13', {tag: 'S1', ...sessionOpts()});
      eq(failing(good).length, 0, `[١٤-هـ] S1 بحمولة 13ch الذهبية وجلسة وتقييم سليمين: لا FAIL — ${failing(good).join(',')}`);
      deq(D.expectItemsOf('S1'), [E.M02_NOT_WORKING_PARTIAL_GRID, E.CYCLE_EXTRA_API34_POSITIVE], '[١٤-هـ] صفوف S1: M-02 والدورات');
      deq([verdictOf(good, E.M02_NOT_WORKING_PARTIAL_GRID), verdictOf(good, E.CYCLE_EXTRA_API34_POSITIVE), verdictOf(good, I.SESSION_STATUS), verdictOf(good, I.SESSION_JOINED_BY), verdictOf(good, I.EVALUATION_DOC), verdictOf(good, I.EVALUATION_NO_MOVED_IDS)], [V.PASS, V.PASS, V.PASS, V.PASS, V.PASS, V.PASS], '[١٤-هـ] S1: M-02 والدورات والجلسة وjoinedBy والتقييم');
      // M-02: endReason × الحالة
      const m02 = (mut) => verdictOf(evalOf('c13', {tag: 'S1', ...sessionOpts(), mutate: mut}), E.M02_NOT_WORKING_PARTIAL_GRID);
      for (const [er, want] of [['auto_complete', V.FAIL], ['user_marked_not_working', V.PASS], ['user_marked_not_tested', V.FAIL], ['dismissed', V.FAIL], ['weird', V.FAIL]]) eq(m02((p) => { m02Of(p).measurements.endReason = er; }), want, `[١٤-هـ] S1 endReason=${er} ⟵ ${want}`);
      for (const [st, want] of [['fail', V.PASS], ['pass', V.FAIL], ['not_tested', V.FAIL], ['warning', V.FAIL], ['unavailable', V.FAIL]]) eq(m02((p) => { m02Of(p).status = st; }), want, `[١٤-هـ] S1 الحالة اليدوية=${st} ⟵ ${want}`);
      eq(m02((p) => { delete m02Of(p).status; }), V.FAIL, '[١٤-هـ] S1 الحالة اليدوية غائبة ⟵ FAIL');
      for (const [tc, want] of [[0, V.PASS], [1, V.PASS], [87, V.PASS], [119, V.PASS], [120, V.FAIL], [121, V.FAIL], ['87', V.FAIL]]) eq(m02((p) => { m02Of(p).measurements.touchedCells = tc; }), want, `[١٤-هـ] S1 touchedCells=${JSON.stringify(tc)} مع totalCells=120 ⟵ ${want} (< لا ≤)`);
      eq(m02((p) => { delete m02Of(p).measurements.touchedCells; }), V.FAIL, '[١٤-هـ] S1 touchedCells غائب ⟵ FAIL');
      eq(m02((p) => { delete m02Of(p).measurements; }), V.FAIL, '[١٤-هـ] S1 M-02 بلا measurements ⟵ FAIL');
      eq(m02((p) => { p.manualResults = p.manualResults.filter((m) => m.testId !== 'M-02'); }), V.FAIL, '[١٤-هـ] S1 M-02 غائب ⟵ FAIL');
      // الدورات: المصدر والحالة والقيمة
      const cy = (mut) => verdictOf(evalOf('c13', {tag: 'S1', ...sessionOpts(), mutate: mut}), E.CYCLE_EXTRA_API34_POSITIVE);
      const cyBasis = (mut) => rowOf(evalOf('c13', {tag: 'S1', ...sessionOpts(), mutate: mut}), E.CYCLE_EXTRA_API34_POSITIVE).basis;
      eq(cy(() => {}), V.PASS, '[١٤-هـ] S1 الدورات: extra_api34 وread و187 ⟵ PASS');
      eq(cy((p) => { bh(p).cycleCount = 1; }), V.PASS, '[١٤-هـ] S1 الدورات: القيمة 1 ⟵ PASS (> 0)');
      ok(cy((p) => { bh(p).cycleCount = 0; }) === V.FAIL && /CYCLE_COUNT_ZERO_WITH_READ_STATE/.test(cyBasis((p) => { bh(p).cycleCount = 0; })), '[١٤-هـ] S1 الدورات: 0 بحالة read ⟵ FAIL بسببه CYCLE_COUNT_ZERO_WITH_READ_STATE');
      ok(cy((p) => { bh(p).cycleCount = -3; }) === V.FAIL && /CYCLE_COUNT_NEGATIVE/.test(cyBasis((p) => { bh(p).cycleCount = -3; })), '[١٤-هـ] S1 الدورات: سالبة ⟵ FAIL');
      for (const src of ['sysfs:/sys/class/power_supply/battery/cycle_count', 'unavailable', 'mystery']) {
        ok(cy((p) => { bh(p).cycleCountSource = src; }) === V.FAIL && /CYCLE_COUNT_SOURCE_NOT_EXTRA_API34/.test(cyBasis((p) => { bh(p).cycleCountSource = src; })), `[١٤-هـ] S1 الدورات: المصدر ${src.slice(0, 12)} ⟵ FAIL (CYCLE_COUNT_SOURCE_NOT_EXTRA_API34)`);
      }
      ok(cy((p) => { delete bh(p).cycleCountSource; }) === V.FAIL && /CYCLE_COUNT_SOURCE_NOT_EXTRA_API34\(source=absent\)/.test(cyBasis((p) => { delete bh(p).cycleCountSource; })), '[١٤-هـ] S1 الدورات: المصدر غائب ⟵ FAIL');
      ok(cy((p) => { bh(p).cycleCountState = 'not_read:x'; delete bh(p).cycleCount; }) === V.FAIL && /CYCLE_COUNT_NOT_READ/.test(cyBasis((p) => { bh(p).cycleCountState = 'not_read:x'; delete bh(p).cycleCount; })), '[١٤-هـ] S1 الدورات: not_read ⟵ FAIL (CYCLE_COUNT_NOT_READ)');
      ok(cy((p) => { delete bh(p).cycleCountState; }) === V.FAIL && /CYCLE_COUNT_STATE_ABSENT/.test(cyBasis((p) => { delete bh(p).cycleCountState; })), '[١٤-هـ] S1 الدورات: لا حالة ⟵ FAIL (CYCLE_COUNT_STATE_ABSENT)');
      ok(cy((p) => { delete bh(p).cycleCount; }) === V.FAIL && /CYCLE_COUNT_VALUE_ABSENT/.test(cyBasis((p) => { delete bh(p).cycleCount; })), '[١٤-هـ] S1 الدورات: read بلا قيمة ⟵ FAIL (CYCLE_COUNT_VALUE_ABSENT)');
      ok(cy((p) => { delete p.timeSeries.footer.batteryHealth; }) === V.FAIL && /CYCLE_COUNT_ABSENT/.test(cyBasis((p) => { delete p.timeSeries.footer.batteryHealth; })), '[١٤-هـ] S1 الدورات: الحقل غائب ⟵ FAIL (CYCLE_COUNT_ABSENT)');
      eq(cy((p) => { bh(p).cycleCountState = 'mystery'; }), V.FAIL, '[١٤-هـ] S1 الدورات: حالة غير معروفة ⟵ FAIL');
      // مطابقة B-08: كما كانت (لا تتغيّر)
      eq(verdictOf(evalOf('c13', {tag: 'S1', ...sessionOpts(), mutate: (p) => { p.functionalResults.push({testId: 'B-08', categoryName: 'battery', componentName: 'c', status: 'pass', rawValue: '187', rawValueUnit: 'cycles'}); }}), I.CYCLE_COUNT_MATCHES_B08), V.PASS, '[١٤-هـ] S1 مطابقة B-08 كما كانت (PASS عند التطابق)');
      eq(verdictOf(evalOf('c13', {tag: 'S1', ...sessionOpts(), mutate: (p) => { p.functionalResults.push({testId: 'B-08', categoryName: 'battery', componentName: 'c', status: 'pass', rawValue: '190', rawValueUnit: 'cycles'}); }}), I.CYCLE_COUNT_MATCHES_B08), V.FAIL, '[١٤-هـ] وFAIL عند الاختلاف');
      // joinedBy
      for (const [jb, want] of [['anon-joiner-uid', V.PASS], [undefined, V.FAIL], ['', V.FAIL], [null, V.FAIL], [42, V.FAIL]]) eq(verdictOf(evalOf('c13', {tag: 'S1', session: SESS({joinedBy: jb}), evaluation: EVD()}), I.SESSION_JOINED_BY), want, `[١٤-هـ] S1 joinedBy=${JSON.stringify(jb)} ⟵ ${want}`);
      // حالة الجلسة
      for (const [st, want] of [['completed', V.PASS], ['scanning', V.FAIL], ['pending', V.FAIL], ['cancelled', V.FAIL], ['expired', V.FAIL], ['Weird', V.FAIL], [undefined, V.FAIL]]) eq(verdictOf(evalOf('c13', {tag: 'S1', session: SESS({status: st}), evaluation: EVD()}), I.SESSION_STATUS), want, `[١٤-هـ] S1 حالة الجلسة=${JSON.stringify(st)} ⟵ ${want}`);
      // التقييم الصارم
      const evv = (evOpts) => evalOf('c13', {tag: 'S1', session: SESS(), evaluation: evOpts});
      let r = evv({exists: false});
      ok(verdictOf(r, I.EVALUATION_DOC) === V.FAIL && basisHas(r, I.EVALUATION_DOC, /EVALUATION_ABSENT_AFTER_SESSION/), '[١٤-هـ] S1 لا مستند تقييم ⟵ FAIL (شرط توقّف :167)');
      eq(verdictOf(r, I.EVALUATION_NO_MOVED_IDS), V.NOT_MEASURED, '[١٤-هـ] والمعرّفات المنقولة NOT_MEASURED (لا مستند)');
      for (const [name, over, code] of [
        ['pending=true', {pending: true}, 'EVALUATION_PENDING_NOT_LINKED_AFTER_REPORT'], ['pending غائب', {pending: undefined}, 'EVALUATION_PENDING_FLAG_UNREADABLE'],
        ['pending نصّ', {pending: 'false'}, 'EVALUATION_PENDING_FLAG_UNREADABLE'],
        ['linkageIncomplete=true', {linkageIncomplete: true, missingLinkageFields: ['timeSeriesStoragePath']}, 'EVALUATION_LINKAGE_INCOMPLETE'], ['linkageIncomplete غائب', {linkageIncomplete: undefined}, 'EVALUATION_LINKAGE_FLAG_UNREADABLE'],
        ['ownerMismatch=true', {ownerMismatch: true}, 'EVALUATION_OWNER_MISMATCH'], ['ownerMismatch غائب', {ownerMismatch: undefined}, 'EVALUATION_OWNER_MISMATCH_FLAG_UNREADABLE'],
        ['linkageRawState=ABSENT', {linkageRawState: 'ABSENT'}, 'EVALUATION_LINKAGE_RAW_STATE_NOT_PRIVATE'], ['linkageRawState=EMBEDDED_LEGACY', {linkageRawState: 'EMBEDDED_LEGACY'}, 'EVALUATION_LINKAGE_RAW_STATE_NOT_PRIVATE'],
        ['linkageRawState غائب', {linkageRawState: undefined}, 'EVALUATION_LINKAGE_RAW_STATE_NOT_PRIVATE'],
      ]) {
        r = evv(EVD(over));
        ok(verdictOf(r, I.EVALUATION_DOC) === V.FAIL && basisHas(r, I.EVALUATION_DOC, new RegExp(code)), `[١٤-هـ] S1 تقييم: ${name} ⟵ FAIL بسببه ${code}`);
      }
      r = evv(EVD({pending: true, linkageIncomplete: true, ownerMismatch: true, linkageRawState: 'ABSENT'}));
      ok(['EVALUATION_PENDING_NOT_LINKED_AFTER_REPORT', 'EVALUATION_LINKAGE_INCOMPLETE', 'EVALUATION_OWNER_MISMATCH', 'EVALUATION_LINKAGE_RAW_STATE_NOT_PRIVATE'].every((c) => basisHas(r, I.EVALUATION_DOC, new RegExp(c))), '[١٤-هـ] وتُسرد كل الأسباب معاً حين تجتمع');
      for (const key of [...REPORT_RAW_FIELDS, ...RAW_LINKAGE_FIELDS, 'sessionId']) {
        r = evv(EVD({nested: {deep: [{[key]: 'v'}]}}));
        deq([verdictOf(r, I.EVALUATION_DOC), verdictOf(r, I.EVALUATION_NO_MOVED_IDS)], [V.PASS, V.FAIL], `[١٤-هـ] S1 تقييم بمفتاح منقول ${key}: المستند مرتبط (PASS) والمعرّفات المنقولة FAIL`);
      }
      // الربط بالتقرير والمالك
      for (const [name, over] of [['scanId آخر', {scanId: 'other'}], ['ownerId آخر', {ownerId: 'x'}], ['scanId غائب', {scanId: undefined}]]) eq(verdictOf(evalOf('c13', {tag: 'S1', session: SESS(over), evaluation: EVD()}), I.SESSION_SCAN_LINK), V.FAIL, `[١٤-هـ] S1 الجلسة: ${name} ⟵ SESSION_SCAN_LINK FAIL`);
      // بلا sessionId أصلاً
      r = evalOf('c13', {tag: 'S1'});
      ok(verdictOf(r, I.SESSION_SCAN) === V.FAIL && !anyFail(evalOf('c13', {tag: 'S1', ...sessionOpts()})), '[١٤-هـ] S1 بلا sessionId ⟵ SESSION_SCAN FAIL');
      // حمولة S1 خاطئة (16ch): M-02 not_tested ودورات sysfs
      r = evalOf('c16', {tag: 'S1', ...sessionOpts()});
      deq([verdictOf(r, E.M02_NOT_WORKING_PARTIAL_GRID), verdictOf(r, E.CYCLE_EXTRA_API34_POSITIVE)], [V.FAIL, V.FAIL], '[١٤-هـ] S1 بحمولة 16ch (not_tested، ودورات sysfs): FAIL في الصفّين');
    }

    // ── ١٤-و — S2: الجلسة الثانية (الـS21) ──
    {
      const good = evalOf('c13', {tag: 'S2', ...sessionOpts()});
      eq(failing(good).length, 0, `[١٤-و] S2 بحمولة 13ch وجلسة وتقييم سليمين: لا FAIL — ${failing(good).join(',')}`);
      deq(D.expectItemsOf('S2'), [E.CYCLE_EXTRA_API34_POSITIVE], '[١٤-و] صفّ S2 الوحيد: الدورات (M-02 في S2 بلا توقّع)');
      ok(!items(good).includes(E.M02_NOT_WORKING_PARTIAL_GRID) && !items(good).includes(E.M02_AUTO_COMPLETE_FULL_GRID), '[١٤-و] S2: لا صفّ M-02 خاصّ (القواعد العامّة)');
      for (const er of ['auto_complete', 'user_marked_not_working', 'user_marked_not_tested', 'dismissed']) {
        const r = evalOf('c13', {tag: 'S2', ...sessionOpts(), mutate: (p) => { m02Of(p).measurements.endReason = er; m02Of(p).status = er === 'auto_complete' ? 'pass' : (er === 'user_marked_not_tested' ? 'not_tested' : 'fail'); }});
        ok(!failing(r).some((x) => x.startsWith('EXPECT_M02')) && !items(r).some((x) => x.startsWith('EXPECT_M02')), `[١٤-و] S2 endReason=${er}: لا حكم خاصّ على M-02`);
      }
      for (const [jb, want] of [['anon-joiner-uid', V.PASS], [undefined, V.FAIL], ['', V.FAIL]]) eq(verdictOf(evalOf('c13', {tag: 'S2', session: SESS({joinedBy: jb}), evaluation: EVD()}), I.SESSION_JOINED_BY), want, `[١٤-و] S2 joinedBy=${JSON.stringify(jb)} ⟵ ${want} (:126)`);
      for (const [st, want] of [['completed', V.PASS], ['scanning', V.FAIL], ['pending', V.FAIL], ['cancelled', V.FAIL], ['expired', V.FAIL]]) eq(verdictOf(evalOf('c13', {tag: 'S2', session: SESS({status: st}), evaluation: EVD()}), I.SESSION_STATUS), want, `[١٤-و] S2 الحالة=${st} ⟵ ${want} (completed بعد الفحص)`);
      eq(verdictOf(evalOf('c13', {tag: 'S2', session: SESS()}), I.EVALUATION_DOC), V.FAIL, '[١٤-و] S2 بلا تقييم ⟵ FAIL (التقييم الثاني مطلوب)');
      eq(verdictOf(evalOf('c13', {tag: 'S2', session: SESS(), evaluation: EVD({pending: true})}), I.EVALUATION_DOC), V.FAIL, '[١٤-و] S2 تقييم pending ⟵ FAIL (لم يُربط بتقريره)');
      eq(verdictOf(evalOf('c13', {tag: 'S2', session: SESS(), evaluation: EVD()}), I.EVALUATION_DOC), V.PASS, '[١٤-و] S2 تقييم مرتبط ⟵ PASS');
      for (const [src, want] of [['extra_api34', V.PASS], ['sysfs:/x', V.FAIL], ['unavailable', V.FAIL]]) eq(verdictOf(evalOf('c13', {tag: 'S2', ...sessionOpts(), mutate: (p) => { bh(p).cycleCountSource = src; }}), E.CYCLE_EXTRA_API34_POSITIVE), want, `[١٤-و] S2 مصدر الدورات=${src.slice(0, 11)} ⟵ ${want}`);
      eq(verdictOf(evalOf('c16', {tag: 'S2', ...sessionOpts()}), E.CYCLE_EXTRA_API34_POSITIVE), V.FAIL, '[١٤-و] S2 بحمولة 16ch (sysfs) ⟵ FAIL');
    }

    // ── ١٤-ز — WAIT: فحص فردي، القواعد العامّة للفحوص الجديدة ──
    {
      const good = evalOf('c11', {tag: 'WAIT'});
      eq(failing(good).length, 0, `[١٤-ز] WAIT (فردي، 11ch): لا FAIL — ${failing(good).join(',')}`);
      eq(D.expectItemsOf('WAIT').length, 0, '[١٤-ز] WAIT بلا صفوف EXPECT (القواعد العامّة تكفي)');
      deq([verdictOf(good, I.SESSION_SCAN), verdictOf(good, I.EVALUATION_DOC)], [V.INFO, V.INFO], '[١٤-ز] WAIT: SESSION_SCAN INFO وEVALUATION_DOC INFO (لا تشديد)');
      eq(verdictOf(evalOf('c11', {tag: 'WAIT', ...sessionOpts()}), I.SESSION_JOINED_BY), V.INFO, '[١٤-ز] WAIT بجلسة: joinedBy يبقى INFO (التشديد لـS1 وS2 وحدهما)');
      eq(verdictOf(evalOf('c11', {tag: 'WAIT', session: SESS(), evaluation: {exists: false}}), I.EVALUATION_DOC), V.NOT_MEASURED, '[١٤-ز] WAIT بجلسة بلا تقييم: NOT_MEASURED كالقاعدة العامّة لا FAIL');
      eq(verdictOf(evalOf('fv67', {tag: 'WAIT', mutate: v67}), I.FIELDS_VERSION), V.FAIL, '[١٤-ز] WAIT بحمولة fv67 ⟵ FIELDS_VERSION FAIL (69 بالضبط)');
    }

    // ── ١٤-ح — وسم بلا توقّعات خاصّة: القواعد العامّة وحدها، ويُعلَن ──
    for (const tag of ['G1', 'b1', 'X9', 'SX']) {
      const r = evalOf('c11', {tag, ...(tag === 'SX' ? sessionOpts() : {})});
      ok(items(r).every((id) => !id.startsWith('EXPECT_')) && r.block.expectations.special === false && /بلا توقّعات خاصّة/.test(r.block.expectations.note), `[١٤-ح] ${tag}: لا صفوف EXPECT، ويُعلَن في كتلته أنّه بلا توقّعات خاصّة`);
    }
    {
      const r = evalOf('fv67', {tag: 'G1', mutate: v67});
      deq([verdictOf(r, I.APP_VERSION), verdictOf(r, I.FIELDS_VERSION)], [V.FAIL, V.FAIL], '[١٤-ح] حمولة fv67 بوسم غير B1: القاعدة العامّة (1.0.11 وختم ≥ 69) ⟵ FAIL (لا تسامح مع القديم خارج B1)');
      ok(r.block.legacyByNature === undefined, '[١٤-ح] ولا استبدال LEGACY خارج B1');
    }
    {
      const rB1 = evalOf('c11', {tag: 'B1'});
      deq(rB1.block.expectations.lines.map((l) => l.item), T.B1.lines.map((l) => l.item), '[١٤-ح] كتلة B1 تسرد أسطر جدولها');
      eq(rB1.block.expectations.document, 'DEVICE-CHECK-03-2026-10-10.md', '[١٤-ح] والوثيقة');
    }

    // ── ١٤-ط — main: الخمسة تطابق توقّعاتها ⟵ 0، وكل وسم بحالة سلبية ⟵ 1 ──
    {
      const fv67Fp = payloadOf('fv67');
      v67(fv67Fp);
      const mk = (tag, payload, sessionId) => {
        const scan = `five-scan-${tag}`;
        const sp = `scans/sha-${tag}/${scan}.ts.json.gz`;
        return {tag, scan, sp, payload, sessionId, short: `NC-${tag.padEnd(6, '0').slice(0, 6).toUpperCase()}`};
      };
      const set = {B1: mk('B1', fv67Fp, null), B2: mk('B2', payloadOf('c11'), null), S1: mk('S1', payloadOf('c13'), 'sess-five-S1'), S2: mk('S2', payloadOf('c13'), 'sess-five-S2'), WAIT: mk('WAIT', payloadOf('c11'), null)};
      const world = (over = {}) => {
        const reports = {}; const reportRaw = {}; const objects = {};
        for (const w of Object.values(set)) {
          const payload = (over.payloads && over.payloads[w.tag]) || w.payload;
          reports[w.scan] = {shortId: w.short, userId: OWNER_UID};
          reportRaw[w.scan] = {scanId: w.scan, rawFingerprint: clone(lightenFingerprintForStorage(payload)), sessionId: w.sessionId, deviceFingerprintSha: `sha-${w.tag}`, timeSeriesStoragePath: w.sp, aiAudit: null};
          objects[w.sp] = H.gz(storageFileOf(payload));
        }
        const scanSessions = {};
        for (const tag of ['S1', 'S2']) scanSessions[set[tag].sessionId] = {status: 'completed', joinedBy: `anon-${tag}`, joinedAt: ts(NOW - 5000), scanId: set[tag].scan, ownerId: OWNER_UID, ...((over.sessions && over.sessions[tag]) || {})};
        const evaluations = {};
        for (const tag of ['S1', 'S2']) if (!(over.noEval || []).includes(tag)) evaluations[set[tag].scan] = {pending: false, ownerMismatch: false, linkageIncomplete: false, linkageRawState: 'PRIVATE', missingLinkageFields: [], source: 'session', revisionCount: 0};
        return {collections: {reports, reportRaw, users: {[OWNER_UID]: {}}, scanSessions, evaluations}, objects};
      };
      const five = async (over, tagsToRun = ['B1', 'B2', 'S1', 'S2', 'WAIT'], swap = {}) => {
        const {collections, objects} = world(over);
        const outPath = nextOut();
        const tokens = tagsToRun.map((t) => `${t}=${(swap[t] || set[t]).short}`).join(',');
        const r = await H.runMain(main, ['--tokens', tokens, '--out', outPath], {env: ENV, now: () => NOW, db: makeMemDb(collections), auth: authOk, bucket: H.makeStubBucket(objects).bucket});
        return {...r, json: JSON.parse(fs.readFileSync(outPath, 'utf8'))};
      };
      const base = await five();
      eq(base.code, 0, '[١٤-ط] الخمسة تطابق توقّعاتها (B1 فحص 1.0.10 بختم 67، وB2 وWAIT على 11ch، وS1 وS2 على 13ch بجلسة وتقييم): 0');
      deq(base.json.table.filter((x) => x.verdict === V.FAIL), [], '[١٤-ط] ولا FAIL في الجدول الواحد');
      eq(base.json.summary.hasFail, false, '[١٤-ط] hasFail=false');
      for (const tag of ['B1', 'B2', 'S1', 'S2', 'WAIT']) ok(base.json.table.some((x) => x.tag === tag), `[١٤-ط] صفوف ${tag} في الجدول`);
      ok(base.json.table.filter((x) => x.tag === 'B1' && D.LEGACY_BY_NATURE[x.item]).every((x) => x.verdict === V.NOT_MEASURED && /^LEGACY_FV67_SCAN/.test(x.basis)), '[١٤-ط] B1: بنود fv68+ NOT_MEASURED بسببها');
      ok(base.json.table.some((x) => x.tag === 'B2' && x.item === E.CYCLE_NOT_READ_DECLARED && x.verdict === V.PASS) && base.json.table.some((x) => x.tag === 'S1' && x.item === E.M02_NOT_WORKING_PARTIAL_GRID && x.verdict === V.PASS), '[١٤-ط] صفوف EXPECT في الجدول الواحد بأسمائها');
      deq(base.json.expectations.thisRun.map((x) => [x.tag, x.special]), [['B1', true], ['B2', true], ['S1', true], ['S2', true], ['WAIT', true]], '[١٤-ط] المخرَج: الوسوم الخمسة ذات توقّعات');
      deq(Object.keys(base.json.expectations.table), ['B1', 'B2', 'S1', 'S2', 'WAIT'], '[١٤-ط] وجدول التوقّعات كلّه في المخرَج');
      ok(Object.values(E).every((id) => typeof base.json.rules[id] === 'string' && base.json.rules[id].includes('DEVICE-CHECK-03-2026-10-10.md:')), '[١٤-ط] rules تحمل نصّ كل توقّع وسطر وثيقته');
      ok(base.json.expectations.legacyByNature.items.length === 15 && base.json.expectations.legacyByNature.reason === 'LEGACY_FV67_SCAN', '[١٤-ط] والبنود القديمة بطبيعتها مسرودة بمصادرها في العقد');
      deq(base.json.reports.map((x) => x.expectations.special), [true, true, true, true, true], '[١٤-ط] وكل كتلة تقرير تحمل توقّعاتها');
      // وسم بلا توقّعات في التشغيل نفسه يُعلَن
      const mixed = await five({}, ['B2', 'ZZ'], {ZZ: set.WAIT});
      deq(mixed.json.expectations.thisRun, [{tag: 'B2', special: true}, {tag: 'ZZ', special: false, note: 'بلا توقّعات خاصّة: القواعد العامّة وحدها'}], '[١٤-ط] وسم بلا توقّعات في التشغيل نفسه: يُعلَن في المخرَج');
      eq(mixed.code, 0, '[١٤-ط] وبلا FAIL: 0');
      // حالة سلبية لكل وسم ⟵ 1
      const negs = [
        ['B1', {}, ['B1'], {B1: set.B2}, ['FIELDS_VERSION', 'APP_VERSION', E.B1_LEGACY_FV67_SCAN]],
        ['B2', {}, ['B2'], {B2: set.S1}, [E.M02_AUTO_COMPLETE_FULL_GRID, E.HIDDEN_BY_MODEL_EMPTY, E.CYCLE_NOT_READ_DECLARED]],
        ['S1', {noEval: ['S1']}, ['S1'], {}, ['EVALUATION_DOC']],
        ['S2', {sessions: {S2: {joinedBy: ''}}}, ['S2'], {}, ['SESSION_JOINED_BY']],
        ['WAIT', {}, ['WAIT'], {WAIT: set.B1}, ['APP_VERSION', 'FIELDS_VERSION']],
      ];
      for (const [tag, over, run, swap, must] of negs) {
        const r = await five(over, run, swap);
        eq(r.code, 1, `[١٤-ط] ${tag}: حالة سلبية ⟵ 1`);
        const fl = r.json.table.filter((x) => x.verdict === V.FAIL).map((x) => x.item);
        ok(must.every((m) => fl.includes(m)), `[١٤-ط] ${tag}: FAIL في ${must.join(' و')} — الفعلي: ${fl.join(',')}`);
      }
      // B1 كما هي عيّنة fv67 بلا تعديل header: APP_VERSION FAIL ⟵ 1 (الفرق الذي يُبلَّغ به)
      const asIs = await five({payloads: {B1: payloadOf('fv67')}}, ['B1']);
      deq([asIs.code, asIs.json.table.filter((x) => x.verdict === V.FAIL).map((x) => x.item)], [1, ['APP_VERSION']], '[١٤-ط] B1 بعيّنة fv67 كما هي (header 1.0.8-v6beta): FAIL في APP_VERSION وحده ⟵ 1');
    }
  }

  // ═══ ١٥ — تفصيل D لكل تشغيل (طلب المنسّق 2026-10-11 +03): صفوف INFO وحدها، القيم كما شُحنت، والغائب غائب لا صفر ═══
  // لا حساب للخيارين («تشغيل واحد لكل مرحلة» و«غربال حتى مليون»): القيم وحدها. ولا يتغيّر حكم أيّ بند قائم.
  {
    const RUNS = N.VERIFICATION.CPU_KNOWN_ANSWER_RUNS;
    const vrOf = (p) => p.timeSeries.footer.verificationResults;
    const runsOf = (p) => vrOf(p)[RUNS];
    const inFamily = (item) => item === I.CPU_D_RUNS || item.startsWith(`${I.CPU_D_RUN}_`) || item.startsWith(`${I.CPU_D_BREAKDOWN}_`);
    const runRowsOf = (res) => res.rows.filter((r) => r.item.startsWith(`${I.CPU_D_RUN}_`));
    const brkRowsOf = (res) => res.rows.filter((r) => r.item.startsWith(`${I.CPU_D_BREAKDOWN}_`));
    const det = (res) => res.block.cpuD.runDetail;
    const outside = (res) => res.rows.filter((r) => !inFamily(r.item));
    const L = '[١٥]';

    // ── (أ) تشغيل كامل: العيّنة الذهبية 11ch — ستّة تشغيلات كاملة ──
    {
      const res = evalOf('c11');
      const rr = runRowsOf(res);
      deq(rr.map((r) => r.item), ['CPU_D_RUN_3_1', 'CPU_D_RUN_3_2', 'CPU_D_RUN_3_3', 'CPU_D_RUN_5_1', 'CPU_D_RUN_5_2', 'CPU_D_RUN_5_3'], `${L}-أ صفّ لكل تشغيل: CPU_D_RUN_<مرحلة>_<ترتيب في المرحلة>`);
      ok(res.rows.filter((r) => inFamily(r.item)).every((r) => r.verdict === V.INFO), `${L}-أ كل صفوف التفصيل INFO (لا PASS ولا FAIL: لا حكم)`);
      eq(rr[0].basis, 'index=0 phase=3 order=1 plannedAtPct=25 t=184695 tEnd=184815 diffMs=120 sieveStatus=match sievePrimeCount=664579 sieveDurationMs=90 sha256Status=match sha256DurationMs=30 remainderMs=0', `${L}-أ قيم التشغيل الأوّل حرفياً بأسماء العقد`);
      eq(rr[5].basis, 'index=5 phase=5 order=3 plannedAtPct=92 t=368943 tEnd=369063 diffMs=120 sieveStatus=match sievePrimeCount=664579 sieveDurationMs=90 sha256Status=match sha256DurationMs=30 remainderMs=0', `${L}-أ وقيم الأخير`);
      eq(rowOf(res, 'CPU_D_BREAKDOWN_3').basis, 'runs=3 sumDiffMs=360(n=3) sumSieveMs=270(n=3) sumSha256Ms=90(n=3) remainderMs=0(n=3) shippedTotalMs=360 diffSumVsShipped=EQUAL', `${L}-أ مجاميع المرحلة 3 بعدد التشغيلات ومقارنتها بالمجموع المشحون`);
      eq(rowOf(res, 'CPU_D_BREAKDOWN_5').basis, 'runs=3 sumDiffMs=360(n=3) sumSieveMs=270(n=3) sumSha256Ms=90(n=3) remainderMs=0(n=3) shippedTotalMs=360 diffSumVsShipped=EQUAL', `${L}-أ والمرحلة 5`);
      eq(rowOf(res, I.CPU_D_RUNS).basis, 'cpuKnownAnswerState=ran runs=6 phases=[3,5] runsWithFieldsNotPresent=0', `${L}-أ الملخّص`);
      deq(brkRowsOf(res).map((r) => r.item), ['CPU_D_BREAKDOWN_3', 'CPU_D_BREAKDOWN_5'], `${L}-أ صفّ لكل مرحلة`);
      // أرقام بحلقة مستقلّة عن السكربت من مصفوفة الحمولة نفسها
      for (const ph of [3, 5]) {
        let d = 0; let s = 0; let h = 0; let c = 0;
        for (const e of runsOf(res.payload)) if (e.phase === ph) { d += e.tEnd - e.t; s += e.sieveDurationMs; h += e.sha256DurationMs; c++; }
        const b = det(res).byPhase[ph];
        deq([b.diff.sumMs, b.sieve.sumMs, b.sha256.sumMs, b.remainder.sumMs, b.runs, b.diff.runsCounted], [d, s, h, d - s - h, c, c], `${L}-أ المرحلة ${ph}: المجاميع = حلقة مستقلّة من الحمولة`);
      }
      deq(det(res).runs[0].sieve, {status: 'match', kind: 'match', recognized: true, primeCount: 664579, durationMs: 90}, `${L}-أ كتلة الغربال: الحالة بنصّها وصنفها ومعرفتها وعدده الأوّلي وزمنه`);
      deq(det(res).runs[0].sha256, {status: 'match', kind: 'match', recognized: true, durationMs: 30}, `${L}-أ وكتلة SHA`);
      deq(JSON.parse(JSON.stringify(det(res))), det(res), `${L}-أ التفصيل قابل للتسلسل بلا undefined (يخرج كما هو في JSON)`);
      eq(det(res).source.includes('cpuKnownAnswerRuns') && det(res).source.includes('reportRaw'), true, `${L}-أ المصدر معلَن: cpuKnownAnswerRuns في reportRaw`);
      // لا تغيير في حكم أيّ بند قائم: حذف الأزمنة والعدد الأوّلي (تفصيلاً وحدها) لا يغيّر صفّاً خارج العائلة
      // (2026-10-13: كانت الطفرة `e.sievePrimeCount = 1` مع بقاء الحالة match — صار القارئ يعلن هذا التناقض شذوذاً PRIME_COUNT_DISAGREES_WITH_STATUS (القاعدة 25)، فيتغيّر READER_ANOMALIES وCPU_D_SHARE عمداً؛ والتناقض نفسه يُختبَر في cpuKnownAnswerFv70.test.js. فصارت الطفرة حذف العدد.)
      const alt = evalOf('c11', {mutate: (p) => { for (const e of runsOf(p)) { delete e.sieveDurationMs; delete e.sha256DurationMs; delete e.sievePrimeCount; } }});
      // PAYLOAD_BYTES وحده يتبع حجم الحمولة (حذف حقول يُصغّرها): يُقارَن حكمه لا أساسه
      const sansBytes = (r) => outside(r).filter((x) => x.item !== I.PAYLOAD_BYTES);
      deq(sansBytes(alt), sansBytes(res), `${L}-أ لا يتغيّر صفّ خارج عائلة التفصيل (الحكم والأساس) حين تتغيّر الأزمنة التفصيلية`);
      eq(verdictOf(alt, I.PAYLOAD_BYTES), verdictOf(res, I.PAYLOAD_BYTES), `${L}-أ وحكم PAYLOAD_BYTES كما هو (أساسه حجم بايتات فيتغيّر بحذف الحقول)`);
      eq(outside(alt).length, outside(res).length, `${L}-أ وعدد الصفوف خارج العائلة نفسه`);
      deq([verdictOf(res, I.CPU_D_SHARE), verdictOf(res, `${I.CPU_D_SHARE_PHASE}_3`), verdictOf(res, `${I.CPU_D_SHARE_PHASE}_5`)], [V.PASS, V.PASS, V.PASS], `${L}-أ ومعيار D كما هو (PASS لـ360 من 74978)`);
    }

    // ── (ب) قيم تشبه تشغيل الإنتاج (مرحلة 3: مجموع 911 ms): الفرق والغربال وSHA والباقي، والحكم القائم يبقى FAIL ──
    {
      const set3 = [[1000, 1300, 200, 40], [2000, 2250, 150, 35], [3000, 3361, 260, 45]]; // [t, tEnd, sieve, sha]
      const res = evalOf('c11', {mutate: (p) => {
        const rs = runsOf(p);
        set3.forEach(([t, tEnd, sv, sh], i) => { Object.assign(rs[i], {t, tEnd, sieveDurationMs: sv, sha256DurationMs: sh}); });
        setVr(p, {cpuKnownAnswerTotalMsByPhase: {3: 911, 5: 360}});
      }});
      const b = det(res).byPhase[3];
      deq([b.diff.sumMs, b.sieve.sumMs, b.sha256.sumMs, b.remainder.sumMs], [911, 610, 120, 181], `${L}-ب مجاميع المرحلة 3: 300+250+361 و200+150+260 و40+35+45 والباقي 60+65+56`);
      deq(det(res).runs.slice(0, 3).map((r) => [r.diffMs, r.remainderMs]), [[300, 60], [250, 65], [361, 56]], `${L}-ب فرق كل تشغيل وباقيه`);
      eq(rowOf(res, 'CPU_D_BREAKDOWN_3').basis, 'runs=3 sumDiffMs=911(n=3) sumSieveMs=610(n=3) sumSha256Ms=120(n=3) remainderMs=181(n=3) shippedTotalMs=911 diffSumVsShipped=EQUAL', `${L}-ب صفّ المرحلة 3`);
      deq([verdictOf(res, I.CPU_D_SHARE), verdictOf(res, `${I.CPU_D_SHARE_PHASE}_3`), verdictOf(res, `${I.CPU_D_SHARE_PHASE}_5`), det(res).runs.every((r) => true)], [V.FAIL, V.FAIL, V.PASS, true], `${L}-ب حكم المعيار كما كان: 911 من 74978 ⟵ FAIL للمرحلة 3 (لا يغيّره التفصيل)`);
      eq(rowOf(res, `${I.CPU_D_SHARE_PHASE}_3`).basis.includes('totalMs=911 phaseDurationMs=74978 percent=1.215 '), true, `${L}-ب والنسبة 911 من 74978 = 1.215٪ (مخرَج الإنتاج المنقول 1.2149 على عيّنة زمن مرحلتها 74985: الفرق من زمن المرحلة لا من التفصيل)`);
    }

    // ── (ج) العيّنة 16ch: تشغيل مقطوع بحالة native_call_failed بلا زمن الغربال، وتشغيل not_reached بلا t ولا tEnd ──
    {
      const res = evalOf('c16');
      const r31 = rowOf(res, 'CPU_D_RUN_3_2');
      eq(r31.basis, 'index=1 phase=3 order=2 plannedAtPct=60 t=210945 tEnd=210975 diffMs=30 sieveStatus=native_call_failed:sieve kernel aborted: out of memory sievePrimeCount=ABSENT sieveDurationMs=ABSENT sha256Status=match sha256DurationMs=30 remainderMs=NOT_COMPUTED(sieveDurationMs:ABSENT)', `${L}-ج تشغيل بفشل أصلي: الغربال بلا عدد ولا زمن ⟵ ABSENT لا صفر، والباقي NOT_COMPUTED`);
      const r53 = rowOf(res, 'CPU_D_RUN_5_3');
      eq(r53.basis, 'index=5 phase=5 order=3 plannedAtPct=92 t=ABSENT tEnd=ABSENT diffMs=NOT_COMPUTED(t:ABSENT,tEnd:ABSENT) sieveStatus=not_reached sievePrimeCount=ABSENT sieveDurationMs=ABSENT sha256Status=not_reached sha256DurationMs=ABSENT remainderMs=NOT_COMPUTED(t:ABSENT,tEnd:ABSENT,sieveDurationMs:ABSENT,sha256DurationMs:ABSENT)', `${L}-ج تشغيل not_reached: بلا t ولا tEnd ولا أزمنة ⟵ كلّها ABSENT (عقد :1253 «غياب لا صفر»)`);
      eq(rowOf(res, 'CPU_D_BREAKDOWN_3').basis, 'runs=3 sumDiffMs=270(n=3) sumSieveMs=180(n=2) sumSha256Ms=90(n=3) remainderMs=0(n=2) remainderExcluded=[{"index":1,"reason":"NOT_COMPUTED(sieveDurationMs:ABSENT)"}] shippedTotalMs=270 diffSumVsShipped=EQUAL', `${L}-ج المرحلة 3: مجموع الغربال من تشغيلين لا ثلاثة (n=2) والمستثنى من الباقي مسمّى`);
      eq(rowOf(res, 'CPU_D_BREAKDOWN_5').basis, 'runs=3 sumDiffMs=240(n=2) sumSieveMs=180(n=2) sumSha256Ms=60(n=2) remainderMs=0(n=2) remainderExcluded=[{"index":5,"reason":"NOT_COMPUTED(t:ABSENT,tEnd:ABSENT,sieveDurationMs:ABSENT,sha256DurationMs:ABSENT)"}] shippedTotalMs=240 diffSumVsShipped=EQUAL', `${L}-ج المرحلة 5: not_reached لا يدخل أيّ مجموع، ومجموع الفرق يطابق المشحون 240`);
      deq([det(res).runs[1].sieve.kind, det(res).runs[1].sieve.recognized, det(res).runs[5].sieve.kind, det(res).runs[5].sha256.kind], ['native_call_failed', true, 'not_reached', 'not_reached'], `${L}-ج أصناف الحالات من parseState بمفردة العقد`);
      deq(det(res).runs[5].notPresent, ['t:ABSENT', 'tEnd:ABSENT', 'sievePrimeCount:ABSENT', 'sieveDurationMs:ABSENT', 'sha256DurationMs:ABSENT'], `${L}-ج قائمة الحقول غير الحاضرة للتشغيل not_reached`);
      eq(rowOf(res, I.CPU_D_RUNS).basis, 'cpuKnownAnswerState=ran runs=6 phases=[3,5] runsWithFieldsNotPresent=2', `${L}-ج الملخّص: تشغيلان فيهما حقول غير حاضرة`);
      eq(verdictOf(res, I.CPU_D_SHARE), V.PASS, `${L}-ج وحكم المعيار كما هو`);
    }

    // ── (د) مجموع بلا أيّ قيمة ⟵ null لا 0 (القاعدة 22) ──
    {
      const res = evalOf('c11', {mutate: (p) => { for (const e of runsOf(p)) if (e.phase === 3) delete e.sieveDurationMs; }});
      const b = det(res).byPhase[3];
      deq([b.sieve.sumMs, b.sieve.runsCounted, b.remainder.sumMs, b.remainder.runsCounted, b.remainder.excluded.length, b.diff.sumMs], [null, 0, null, 0, 3, 360], `${L}-د مجموع الغربال والباقي بلا أيّ قيمة ⟵ null (لا 0)، ومجموع الفرق باقٍ 360`);
      eq(rowOf(res, 'CPU_D_BREAKDOWN_3').basis.startsWith('runs=3 sumDiffMs=360(n=3) sumSieveMs=ABSENT(n=0) sumSha256Ms=90(n=3) remainderMs=ABSENT(n=0) remainderExcluded='), true, `${L}-د في الصفّ: ABSENT(n=0) لا 0`);
      deq(det(res).byPhase[5].sieve, {sumMs: 270, runsCounted: 3}, `${L}-د والمرحلة الأخرى لا تتأثّر`);
    }

    // ── (هـ) الصفر الحاضر ليس غياباً: sieveDurationMs = 0 و tEnd = t ──
    {
      const res = evalOf('c11', {mutate: (p) => { const e = runsOf(p)[0]; e.sieveDurationMs = 0; e.tEnd = e.t; }});
      const r = det(res).runs[0];
      deq([r.sieve.durationMs, r.fieldStates.sieveDurationMs, r.diffMs, r.diffState, r.remainderMs], [0, 'PRESENT', 0, 'COMPUTED', -30], `${L}-هـ الصفر الحاضر يُحسب: الغربال 0 والفرق 0 والباقي 0−0−30 = −30 (لا يُخلط بالغياب)`);
      ok(rowOf(res, 'CPU_D_RUN_3_1').basis.includes('sieveDurationMs=0 ') && rowOf(res, 'CPU_D_RUN_3_1').basis.includes('diffMs=0 '), `${L}-هـ ويظهر 0 في الصفّ`);
      deq([det(res).byPhase[3].sieve.runsCounted, det(res).byPhase[3].sieve.sumMs, det(res).byPhase[3].diff.sumMs], [3, 180, 240], `${L}-هـ ودخل المجموعين (n=3)`);
    }

    // ── (و) النوع الخاطئ ⟵ WRONG_TYPE(<النوع>) لا صفر ولا غياب ──
    {
      const res = evalOf('c11', {mutate: (p) => {
        const rs = runsOf(p);
        rs[0].sieveDurationMs = '90'; rs[0].sha256DurationMs = null; rs[1].t = []; rs[1].tEnd = {}; rs[2].plannedAtPct = true; rs[2].sievePrimeCount = '664579'; rs[3].sieveStatus = 7; rs[4].sha256Status = null;
      }});
      const rs = det(res).runs;
      deq([rs[0].fieldStates.sieveDurationMs, rs[0].fieldStates.sha256DurationMs, rs[1].fieldStates.t, rs[1].fieldStates.tEnd, rs[2].fieldStates.plannedAtPct, rs[2].fieldStates.sievePrimeCount, rs[3].fieldStates.sieveStatus, rs[4].fieldStates.sha256Status],
        ['WRONG_TYPE(string)', 'WRONG_TYPE(null)', 'WRONG_TYPE(array)', 'WRONG_TYPE(object)', 'WRONG_TYPE(boolean)', 'WRONG_TYPE(string)', 'WRONG_TYPE(number)', 'WRONG_TYPE(null)'], `${L}-و حالة الحقل: النوع الخاطئ بنوعه (ومنه null)`);
      deq([rs[0].sieve.durationMs, rs[0].sha256.durationMs, rs[1].t, rs[1].diffMs, rs[3].sieve.status, rs[3].sieve.kind, rs[4].sha256.status], [null, null, null, null, null, null, null], `${L}-و والقيمة null لا صفر`);
      eq(rowOf(res, 'CPU_D_RUN_3_1').basis.includes('sieveDurationMs=WRONG_TYPE(string)') && rowOf(res, 'CPU_D_RUN_3_1').basis.includes('sha256DurationMs=WRONG_TYPE(null)') && rowOf(res, 'CPU_D_RUN_3_1').basis.includes('remainderMs=NOT_COMPUTED(sieveDurationMs:WRONG_TYPE(string),sha256DurationMs:WRONG_TYPE(null))'), true, `${L}-و الصفّ يكتب النوع الخاطئ ويسمّي سبب عدم حساب الباقي`);
      eq(rowOf(res, 'CPU_D_RUN_3_2').basis.includes('t=WRONG_TYPE(array) tEnd=WRONG_TYPE(object) diffMs=NOT_COMPUTED(t:WRONG_TYPE(array),tEnd:WRONG_TYPE(object))'), true, `${L}-و وt وtEnd بنوع خاطئ ⟵ الفرق NOT_COMPUTED`);
      deq([det(res).byPhase[3].diff.runsCounted, det(res).byPhase[3].diff.sumMs], [2, 240], `${L}-و والمجموع من التشغيلين السليمين وحدهما`);
    }

    // ── (ز) كل حالة غربال وSHA: مفردة العقد بكل قيمها، وما خرج عنها «غير معروف» لا يُسقَط ──
    {
      const kindOf = (field, raw) => {
        const res = evalOf('c11', {mutate: (p) => { runsOf(p)[0][field] = raw; }});
        const c = field === 'sieveStatus' ? det(res).runs[0].sieve : det(res).runs[0].sha256;
        return [c.status, c.kind, c.recognized];
      };
      const U = N.READER_STATE.UNRECOGNIZED;
      const sieve = [['match', 'match', true], ['mismatch', 'mismatch', true], ['not_reached', 'not_reached', true], ['native_call_failed:boom', 'native_call_failed', true], ['native_result_unreadable:size=3', 'native_result_unreadable', true],
        // الجزء الخامس (2026-10-13 +03)، القاعدة 23: كان هنا alloc_failed للغربال «غير معروفة» — صارت معروفة (العقد :1616 و:1669 في نسخة 450d9ed: الغربال يُرجعها ومعها N). وcancelled معروفة للحالتين.
        // self_test_failed تبقى للـSHA وحده («self_test_failed (SHA)» في العقد)، وcancelled بلا بادئة مفتوحة.
        ['native_status_unknown:7', 'native_status_unknown', true], ['self_test_failed', U, false], ['alloc_failed', 'alloc_failed', true], ['cancelled', 'cancelled', true], ['cancelled:x', U, false], ['skipped:time_budget', 'skipped:time_budget', true], ['weird', U, false], ['MATCH', U, false], ['', U, false]];
      for (const [raw, kind, rec] of sieve) deq(kindOf('sieveStatus', raw), [raw, kind, rec], `${L}-ز حالة الغربال «${raw}» ⟵ ${kind} (${rec ? 'معروفة' : 'غير معروفة'})`);
      const sha = [['match', 'match', true], ['mismatch', 'mismatch', true], ['not_reached', 'not_reached', true], ['self_test_failed', 'self_test_failed', true], ['alloc_failed', 'alloc_failed', true],
        ['native_call_failed:boom', 'native_call_failed', true], ['native_result_unreadable:size=3', 'native_result_unreadable', true], ['native_status_unknown:7', 'native_status_unknown', true], ['cancelled', 'cancelled', true], ['cancelled:x', U, false], ['skipped:time_budget', 'skipped:time_budget', true], ['weird', U, false], ['self_test_failed:x', U, false]];
      for (const [raw, kind, rec] of sha) deq(kindOf('sha256Status', raw), [raw, kind, rec], `${L}-ز حالة SHA «${raw}» ⟵ ${kind} (${rec ? 'معروفة' : 'غير معروفة'})`);
      // غياب الحالة نفسها
      const res = evalOf('c11', {mutate: (p) => { delete runsOf(p)[0].sieveStatus; delete runsOf(p)[0].sha256Status; }});
      deq([det(res).runs[0].sieve.status, det(res).runs[0].sieve.kind, det(res).runs[0].fieldStates.sieveStatus, det(res).runs[0].fieldStates.sha256Status], [null, null, 'ABSENT', 'ABSENT'], `${L}-ز حالة غائبة ⟵ ABSENT (لا «match» ضمنية)`);
      ok(rowOf(res, 'CPU_D_RUN_3_1').basis.includes('sieveStatus=ABSENT') && rowOf(res, 'CPU_D_RUN_3_1').basis.includes('sha256Status=ABSENT'), `${L}-ز وتظهر ABSENT في الصفّ`);
    }

    // ── (ح) عناصر ليست كائنات، ومرحلة غائبة أو غير صحيحة ──
    {
      const res = evalOf('c11', {mutate: (p) => { runsOf(p).push(5, null, 'x', [], {phase: 3.5, t: 1, tEnd: 0}, {t: 10, tEnd: 20}); }});
      const rr = runRowsOf(res);
      deq(rr.slice(6).map((r) => r.item), ['CPU_D_RUN_NA_i6', 'CPU_D_RUN_NA_i7', 'CPU_D_RUN_NA_i8', 'CPU_D_RUN_NA_i9', 'CPU_D_RUN_NA_i10', 'CPU_D_RUN_NA_i11'], `${L}-ح عنصر بلا مرحلة صحيحة: CPU_D_RUN_NA_i<موضع>`);
      deq(rr.slice(6, 10).map((r) => r.basis), ['index=6 element=NOT_OBJECT(number)', 'index=7 element=NOT_OBJECT(null)', 'index=8 element=NOT_OBJECT(string)', 'index=9 element=NOT_OBJECT(array)'], `${L}-ح العنصر غير الكائن بنوعه`);
      eq(rr[10].basis, 'index=10 phase=3.5 order=ABSENT plannedAtPct=ABSENT t=1 tEnd=0 diffMs=-1(NEGATIVE) sieveStatus=ABSENT sievePrimeCount=ABSENT sieveDurationMs=ABSENT sha256Status=ABSENT sha256DurationMs=ABSENT remainderMs=NOT_COMPUTED(sieveDurationMs:ABSENT,sha256DurationMs:ABSENT)', `${L}-ح مرحلة غير صحيحة (3.5): تُكتب كما شُحنت ولا ترتيب لها، والفرق السالب يُعلَن NEGATIVE`);
      eq(rr[11].basis.startsWith('index=11 phase=ABSENT order=ABSENT '), true, `${L}-ح مرحلة غائبة ⟵ ABSENT`);
      deq(Object.keys(det(res).byPhase), ['3', '5', 'NA'], `${L}-ح المراحل مرتَّبة والمجموعة بلا مرحلة آخراً (NA)`);
      deq([det(res).byPhase.NA.runs, det(res).byPhase.NA.diff.sumMs, det(res).byPhase.NA.diff.runsCounted, det(res).byPhase.NA.diffSumVsShipped, det(res).byPhase.NA.shippedTotalState], [2, 9, 2, 'ONLY_IN_RUNS', 'ABSENT_FOR_PHASE'], `${L}-ح مجموعة NA: تشغيلان وفرقهما −1+10 = 9، وغير موجودة في المشحون`);
      deq([det(res).byPhase[3].runs, det(res).byPhase[5].runs], [3, 3], `${L}-ح والمرحلتان 3 و5 لا تتأثّران بالعناصر الأخرى`);
      eq(rowOf(res, I.CPU_D_RUNS).basis, 'cpuKnownAnswerState=ran runs=12 phases=[3,5,NA] runsWithFieldsNotPresent=6', `${L}-ح الملخّص: 12 عنصراً، ستّة فيها ما ليس حاضراً`);
      eq(verdictOf(res, I.READER_ANOMALIES), V.FAIL, `${L}-ح وشذوذ القارئ (عنصر ليس كائناً) يبقى FAIL كما كان — حكم قائم لا يمسّه التفصيل`);
    }

    // ── (ط) حالات خلايا المصفوفة والحالة ──
    {
      let res = evalOf('c11', {mutate: (p) => { delete vrOf(p)[RUNS]; }});
      deq([verdictOf(res, I.CPU_D_RUNS), rowOf(res, I.CPU_D_RUNS).basis, det(res).runs, det(res).byPhase, runRowsOf(res).length, brkRowsOf(res).length], [V.NOT_MEASURED, 'cpuKnownAnswerRuns ABSENT', null, null, 0, 0], `${L}-ط المصفوفة غائبة ⟵ NOT_MEASURED بحالتها، وruns=null (لا مصفوفة فارغة)، ولا صفوف تشغيل`);
      eq(verdictOf(res, I.CPU_D_SHARE), V.PASS, `${L}-ط وحكم المعيار كما كان (PASS من المجاميع المشحونة)`);
      res = evalOf('c11', {mutate: (p) => { vrOf(p)[RUNS] = 'x'; }});
      deq([verdictOf(res, I.CPU_D_RUNS), rowOf(res, I.CPU_D_RUNS).basis, det(res).runs], [V.NOT_MEASURED, 'cpuKnownAnswerRuns WRONG_TYPE', null], `${L}-ط المصفوفة بنوع خاطئ ⟵ NOT_MEASURED:WRONG_TYPE`);
      res = evalOf('c11', {mutate: (p) => { vrOf(p)[RUNS] = []; }});
      deq([verdictOf(res, I.CPU_D_RUNS), rowOf(res, I.CPU_D_RUNS).basis, det(res).runs, runRowsOf(res).length], [V.INFO, 'cpuKnownAnswerState=ran runs=0 phases=[3,5] runsWithFieldsNotPresent=0', [], 0], `${L}-ط مصفوفة فارغة ⟵ INFO بصفر تشغيلات (runs=[] لا null)، والمراحل من المجاميع المشحونة`);
      eq(rowOf(res, 'CPU_D_BREAKDOWN_3').basis, 'runs=0 sumDiffMs=ABSENT(n=0) sumSieveMs=ABSENT(n=0) sumSha256Ms=ABSENT(n=0) remainderMs=ABSENT(n=0) shippedTotalMs=360 diffSumVsShipped=ONLY_IN_SHIPPED', `${L}-ط مرحلة في المشحون بلا تشغيلات: ONLY_IN_SHIPPED ومجاميعها ABSENT`);
      res = evalOf('c11', {mutate: (p) => { vrOf(p)[RUNS] = []; setVr(p, {cpuKnownAnswerTotalMsByPhase: {}}); }});
      deq([det(res).byPhase, brkRowsOf(res).length, rowOf(res, I.CPU_D_RUNS).basis], [{}, 0, 'cpuKnownAnswerState=ran runs=0 phases=[] runsWithFieldsNotPresent=0'], `${L}-ط مصفوفة فارغة ومجاميع فارغة: لا مرحلة`);
      res = evalOf('c11', {mutate: (p) => { setVr(p, {cpuKnownAnswerState: 'not_run:disabled_in_build'}); }});
      deq([verdictOf(res, I.CPU_D_RUNS), rowOf(res, I.CPU_D_RUNS).basis.startsWith('cpuKnownAnswerState=not_run:disabled_in_build runs=6 ')], [V.INFO, true], `${L}-ط not_run مع مصفوفة حاضرة: تُعرض القيم كما شُحنت وتُسمّى الحالة (والشذوذ يعلنه القارئ لا هذا الصفّ)`);
      res = evalOf('c11', {mutate: (p) => { delete vrOf(p)[RUNS]; delete vrOf(p).cpuKnownAnswerTotalMsByPhase; setVr(p, {cpuKnownAnswerState: 'not_run:disabled_in_build'}); }});
      deq([verdictOf(res, I.CPU_D_RUNS), rowOf(res, I.CPU_D_RUNS).basis], [V.NOT_MEASURED, 'cpuKnownAnswerRuns ABSENT'], `${L}-ط D لم يجرِ بلا مصفوفة ⟵ NOT_MEASURED`);
      res = evalOf('c11', {mutate: (p) => { delete vrOf(p).cpuKnownAnswerState; delete vrOf(p)[RUNS]; delete vrOf(p).cpuKnownAnswerTotalMsByPhase; }});
      eq(verdictOf(res, I.CPU_D_RUNS), V.NOT_MEASURED, `${L}-ط حالة D غائبة بلا مصفوفة ⟵ NOT_MEASURED`);
      res = D.evaluateReport({...factsOf('c11').facts, rawRead: {state: 'ABSENT', raw: null}, storage: {state: 'RAW_ABSENT'}}, {accountHash: ACCOUNT_HASH});
      deq([verdictOf(res, I.CPU_D_RUNS), rowOf(res, I.CPU_D_RUNS).basis, res.block.cpuD.runDetail, res.rows.some((r) => r.item.startsWith(`${I.CPU_D_RUN}_`))], [V.NOT_MEASURED, 'RAW_FINGERPRINT_ABSENT', {state: 'RAW_FINGERPRINT_ABSENT'}, false], `${L}-ط لا بصمة ⟵ NOT_MEASURED:RAW_FINGERPRINT_ABSENT`);
      res = D.evaluateReport({tag: 'G1', shortIdHash: C.hashIdForLog('x'), found: 0}, {accountHash: ACCOUNT_HASH});
      deq([verdictOf(res, I.CPU_D_RUNS), /REPORT_ABSENT/.test(rowOf(res, I.CPU_D_RUNS).basis), res.rows.some((r) => r.item.startsWith(`${I.CPU_D_RUN}_`) || r.item.startsWith(`${I.CPU_D_BREAKDOWN}_`))], [V.NOT_MEASURED, true, false], `${L}-ط لا تقرير ⟵ NOT_MEASURED:REPORT_ABSENT بلا صفوف تشغيل`);
    }

    // ── (ي) المجموع المشحون ومقارنته ──
    {
      let res = evalOf('c11', {mutate: (p) => { setVr(p, {cpuKnownAnswerTotalMsByPhase: {3: 999, 5: 360}}); }});
      deq([det(res).byPhase[3].diffSumVsShipped, det(res).byPhase[3].shippedTotalMs, det(res).byPhase[5].diffSumVsShipped], ['DIFFERENT', 999, 'EQUAL'], `${L}-ي مجموع مشحون يخالف مجموع التشغيلات ⟵ DIFFERENT (يُعلَن ولا يُحكم)`);
      deq([verdictOf(res, `${I.CPU_D_SHARE_PHASE}_3`), verdictOf(res, I.CPU_D_SHARE)], [V.FAIL, V.FAIL], `${L}-ي والمعيار يقرأ المشحون (999 من 74978 ⟵ FAIL) لا مجموع التشغيلات`);
      res = evalOf('c11', {mutate: (p) => { setVr(p, {cpuKnownAnswerTotalMsByPhase: {3: 360}}); }});
      deq([det(res).byPhase[5].diffSumVsShipped, det(res).byPhase[5].shippedTotalState, det(res).byPhase[5].shippedTotalMs], ['ONLY_IN_RUNS', 'ABSENT_FOR_PHASE', null], `${L}-ي مرحلة بلا مدخل في المشحون ⟵ ONLY_IN_RUNS`);
      res = evalOf('c11', {mutate: (p) => { delete vrOf(p).cpuKnownAnswerTotalMsByPhase; }});
      deq([det(res).byPhase[3].diffSumVsShipped, det(res).byPhase[3].shippedTotalState, verdictOf(res, I.CPU_D_SHARE)], ['RUNS_ONLY(shipped:ABSENT)', 'ABSENT', V.NOT_MEASURED], `${L}-ي المجاميع المشحونة غائبة: التفصيل يظهر والمعيار NOT_MEASURED كما كان`);
      res = evalOf('c11', {mutate: (p) => { for (const e of runsOf(p)) if (e.phase === 5) { delete e.t; delete e.tEnd; } setVr(p, {cpuKnownAnswerTotalMsByPhase: {3: 360, 5: 360}}); }});
      deq([det(res).byPhase[5].diff.sumMs, det(res).byPhase[5].diffSumVsShipped], [null, 'ONLY_IN_SHIPPED'], `${L}-ي مشحون بلا مجموع من التشغيلات ⟵ ONLY_IN_SHIPPED`);
      res = evalOf('c11', {mutate: (p) => { for (const e of runsOf(p)) if (e.phase === 5) { delete e.t; delete e.tEnd; } setVr(p, {cpuKnownAnswerTotalMsByPhase: {3: 360}}); }});
      deq([det(res).byPhase[5].diff.sumMs, det(res).byPhase[5].diffSumVsShipped], [null, 'BOTH_ABSENT'], `${L}-ي لا مجموع في الجهتين ⟵ BOTH_ABSENT`);
    }

    // ── (ك) الترتيب: بحسب موضع العنصر في المصفوفة، والمراحل مرتَّبة عددياً ──
    {
      const res = evalOf('c11', {mutate: (p) => { vrOf(p)[RUNS] = [...runsOf(p).slice(3), ...runsOf(p).slice(0, 3)]; }});
      deq(runRowsOf(res).map((r) => r.item), ['CPU_D_RUN_5_1', 'CPU_D_RUN_5_2', 'CPU_D_RUN_5_3', 'CPU_D_RUN_3_1', 'CPU_D_RUN_3_2', 'CPU_D_RUN_3_3'], `${L}-ك الترتيب بموضع العنصر في المصفوفة (مراحل 5 قبل 3 في الملفّ)`);
      deq(det(res).runs.map((r) => [r.index, r.phase, r.orderInPhase, r.plannedAtPct]), [[0, 5, 1, 25], [1, 5, 2, 60], [2, 5, 3, 92], [3, 3, 1, 25], [4, 3, 2, 60], [5, 3, 3, 92]], `${L}-ك الموضع والمرحلة والترتيب وplannedAtPct`);
      deq(Object.keys(det(res).byPhase), ['3', '5'], `${L}-ك والمراحل في byPhase عددياً`);
    }

    // ── (ل) فحص قديم (fv67): التفصيل بنداً بطبيعته لا تحمله الحمولة ──
    {
      const v67 = (p) => { p.timeSeries.header.appVersion = '1.0.10'; };
      let res = evalOf('fv67', {tag: 'B1', mutate: v67});
      ok(verdictOf(res, I.CPU_D_RUNS) === V.NOT_MEASURED && /^LEGACY_FV67_SCAN: /.test(rowOf(res, I.CPU_D_RUNS).basis) && res.rows.filter((r) => r.item.startsWith(`${I.CPU_D_RUN}_`) || r.item.startsWith(`${I.CPU_D_BREAKDOWN}_`)).length === 0, `${L}-ل B1 (fv67): CPU_D_RUNS NOT_MEASURED:LEGACY_FV67_SCAN بلا صفوف تشغيل`);
      res = evalOf('fv67', {tag: 'G1'});
      deq([verdictOf(res, I.CPU_D_RUNS), rowOf(res, I.CPU_D_RUNS).basis], [V.NOT_MEASURED, 'cpuKnownAnswerRuns NOT_IN_FIELDS_VERSION'], `${L}-ل وسم بلا توقّعات على fv67: السبب بحالة القارئ (NOT_IN_FIELDS_VERSION)`);
      ok(D.LEGACY_BY_NATURE[I.CPU_D_RUNS] && D.LEGACY_BY_NATURE[I.CPU_D_RUNS].since === 68 && /^docs\/FV68_CONTRACT\.md:\d+/.test(D.LEGACY_BY_NATURE[I.CPU_D_RUNS].source), `${L}-ل وفي جدول البنود القديمة بطبيعتها (since 68 بمصدر عقد)`);
    }

    // ── (م) تظلّ الصفوف مع وسوم التوقّعات ──
    {
      const res = evalOf('c11', {tag: 'B2'});
      deq([runRowsOf(res).length, brkRowsOf(res).length, verdictOf(res, I.CPU_D_RUNS)], [6, 2, V.INFO], `${L}-م وسم ذو توقّعات (B2): صفوف التفصيل نفسها`);
    }

    // ── (ن) القواعد والفحص الذاتي ──
    {
      for (const it of [I.CPU_D_RUNS, I.CPU_D_RUN, I.CPU_D_BREAKDOWN]) ok(typeof D.ITEM_RULES[it] === 'string' && D.ITEM_RULES[it].length > 0, `${L}-ن قاعدة ${it} مكتوبة في rules`);
      ok(D.ITEM_RULES[I.CPU_D_RUNS].includes('لا حساب') && D.ITEM_RULES[I.CPU_D_RUNS].includes('ABSENT') && D.ITEM_RULES[I.CPU_D_RUNS].includes('INFO'), `${L}-ن قاعدة التفصيل تقول: INFO، الغائب ABSENT، لا حساب للخيارين`);
      const pf = D.preflightChecks({});
      ok(pf.ok === true, `${L}-ن الفحص الذاتي كلّه سليم — ${pf.checks.filter((c) => !c.ok).map((c) => c.name).join(' | ')}`);
      ok(pf.checks.some((c) => c.name.includes('تفصيل D') && c.ok), `${L}-ن وفيه فحص تفصيل D`);
      // الدالّة النقيّة مباشرةً على كائن verificationResults
      const k = readFv68Of(payloadOf('c11')).verification.cpuKnownAnswer;
      const direct = D.readCpuRunDetail(payloadOf('c11').timeSeries.footer.verificationResults, k);
      deq([direct.runs.length, Object.keys(direct.byPhase)], [6, ['3', '5']], `${L}-ن readCpuRunDetail مباشرةً`);
      deq(D.readCpuRunDetail(null, k).runs, null, `${L}-ن بلا verificationResults ⟵ runs=null`);
    }
  }

  // ═══ ١٦ — قيم الحالات والنصوص الإضافية (طلب المنسّق 2026-10-11 +03): INFO وحدها، من الطلب ومن ملفّ Storage، الغائب والـnull الصريح متمايزان ═══
  {
    const L = '[١٦]';
    const FIVE = [I.ENERGY_COUNTER_NWH, I.CPU_TEMP_FINAL_SOURCE, I.WORKERS_PIN_STATE, I.MEMORY_VERIFY_STATE, I.TIME_TO_FIRST_FIX_STATE];
    const footerOf = (p) => p.timeSeries.footer;
    const bhOf = (p) => footerOf(p).batteryHealth;
    const vrOf = (p) => footerOf(p).verificationResults;
    const l02Of = (p) => p.functionalResults.find((f) => f.testId === 'L-02');
    const fileWith = (key, fn) => { const f = storageFileOf(payloadOf(key)); fn(f); return {state: 'DOWNLOADED', json: f}; };
    const basisOf = (res, item) => rowOf(res, item).basis;
    const sv = (res) => res.block.stateValues;

    // ── (أ) العيّنات الذهبية الثلاث: الأساس حرفياً، والقيم بقراءة مستقلّة من الحمولة ──
    {
      const want = {
        c11: {src: "absent:no live CPU read (readCpuTemp returned -1.0, not > 0) and the sampler's temperature source was 'headroom', not 'cpu'", pin: 'not_attempted:ai_workload_path', mem: 'ran'},
        c13: {src: 'live_read_at_finalize', pin: 'not_attempted:ai_workload_path', mem: 'partial:time_cap_reached'},
        c16: {src: 'sampler_max_cpu', pin: 'attempted', mem: 'not_run:insufficient_free_memory'},
      };
      for (const k of ['c11', 'c13', 'c16']) {
        const res = evalOf(k);
        const p = res.payload;
        deq([footerOf(p).cpuTempFinalSource, vrOf(p).workersPinState, vrOf(p).memoryVerifyState], [want[k].src, want[k].pin, want[k].mem], `${L} ${k}: قيم الحمولة الذهبية كما يُتوقَّع (قراءة مستقلّة)`);
        eq(basisOf(res, I.CPU_TEMP_FINAL_SOURCE), `cpuTempFinalSource=${want[k].src}`, `${L} ${k}: cpuTempFinalSource كما شُحن`);
        eq(basisOf(res, I.WORKERS_PIN_STATE), `workersPinState=${want[k].pin}`, `${L} ${k}: workersPinState كما شُحن`);
        eq(basisOf(res, I.MEMORY_VERIFY_STATE), `memoryVerifyState=${want[k].mem}`, `${L} ${k}: memoryVerifyState كما شُحن`);
        eq(basisOf(res, I.ENERGY_COUNTER_NWH), `request.energyCounterNwh=ABSENT request.energyCounterNwhState=${bhOf(p).energyCounterNwhState} file.energyCounterNwh=ABSENT comparison=ABSENT_BOTH`, `${L} ${k}: الطاقة: الطلب بلا رقم وحالته not_read، والملفّ بلا رقم ⟵ ABSENT_BOTH`);
        eq(basisOf(res, I.TIME_TO_FIRST_FIX_STATE), 'L-02 timeToFirstFixState=ABSENT', `${L} ${k}: العيّنة الذهبية لا تحمل timeToFirstFixState ⟵ ABSENT لا صفر ولا نجاح`);
        ok(FIVE.every((it) => verdictOf(res, it) === V.INFO), `${L} ${k}: الصفوف الخمسة INFO (لا حكم)`);
        deq(JSON.parse(JSON.stringify(sv(res))), sv(res), `${L} ${k}: block.stateValues قابل للتسلسل بلا undefined`);
        ok(!('_cells' in sv(res)), `${L} ${k}: ولا حقل داخلي في المخرَج`);
      }
    }

    // ── (ب) طاقة العدّاد: كل ثنائي (فئة الملفّ × فئة الطلب) بتسميته ──
    {
      const reqSet = {NUMBER: 7, NULL: null, ABSENT: undefined};
      const fileSet = {NUMBER: 7, NULL: null, ABSENT: undefined};
      const expected = {
        'NUMBER/NUMBER': 'SAME_NUMBER', 'NUMBER/NULL': 'NUMBER_IN_FILE_NULL_IN_REQUEST', 'NUMBER/ABSENT': 'NUMBER_IN_FILE_ABSENT_IN_REQUEST',
        'NULL/NUMBER': 'NULL_IN_FILE_NUMBER_IN_REQUEST', 'NULL/NULL': 'NULL_BOTH', 'NULL/ABSENT': 'NULL_IN_FILE_ABSENT_IN_REQUEST',
        'ABSENT/NUMBER': 'ABSENT_IN_FILE_NUMBER_IN_REQUEST', 'ABSENT/NULL': 'ABSENT_IN_FILE_NULL_IN_REQUEST', 'ABSENT/ABSENT': 'ABSENT_BOTH',
      };
      for (const f of Object.keys(fileSet)) {
        for (const r of Object.keys(reqSet)) {
          const res = evalOf('c11', {
            mutate: (p) => { if (r === 'ABSENT') delete bhOf(p).energyCounterNwh; else bhOf(p).energyCounterNwh = reqSet[r]; },
            storage: fileWith('c11', (file) => { if (f === 'ABSENT') delete file.footer.batteryHealth.energyCounterNwh; else file.footer.batteryHealth.energyCounterNwh = fileSet[f]; }),
          });
          eq(sv(res).energyCounterNwh.comparison, expected[`${f}/${r}`], `${L}-ب الملفّ ${f} والطلب ${r} ⟵ ${expected[`${f}/${r}`]}`);
          const show = (c) => (c === 'NUMBER' ? '7' : c);
          ok(basisOf(res, I.ENERGY_COUNTER_NWH).includes(`request.energyCounterNwh=${show(r)} `) && basisOf(res, I.ENERGY_COUNTER_NWH).includes(` file.energyCounterNwh=${show(f)} comparison=`), `${L}-ب والصفّ يكتب القيمتين: ${f}/${r}`);
          eq(verdictOf(res, I.ENERGY_COUNTER_NWH), V.INFO, `${L}-ب ${f}/${r}: INFO بلا حكم (حتى الرقم في الملفّ والغائب من الطلب)`);
        }
      }
      // رقمان مختلفان، وصفر حاضر ليس غياباً ولا null
      let res = evalOf('c11', {mutate: (p) => { bhOf(p).energyCounterNwh = 7; }, storage: fileWith('c11', (file) => { file.footer.batteryHealth.energyCounterNwh = 8; })});
      eq(sv(res).energyCounterNwh.comparison, 'DIFFERENT_NUMBER', `${L}-ب رقمان مختلفان ⟵ DIFFERENT_NUMBER`);
      res = evalOf('c11', {mutate: (p) => { bhOf(p).energyCounterNwh = 0; }, storage: fileWith('c11', (file) => { file.footer.batteryHealth.energyCounterNwh = 0; })});
      deq([sv(res).energyCounterNwh.comparison, sv(res).energyCounterNwh.request, sv(res).energyCounterNwh.file], ['SAME_NUMBER', {state: 'PRESENT', value: 0}, {state: 'PRESENT', value: 0}], `${L}-ب الصفر الحاضر رقم (لا غياب ولا null)`);
      // نوع خاطئ وحاويات
      res = evalOf('c11', {mutate: (p) => { bhOf(p).energyCounterNwh = '5'; bhOf(p).energyCounterNwhState = 9; }});
      deq([sv(res).energyCounterNwh.request.state, sv(res).energyCounterNwh.requestState.state, sv(res).energyCounterNwh.comparison], ['WRONG_TYPE(string)', 'WRONG_TYPE(number)', 'WRONG_TYPE(string)_BOTH'], `${L}-ب نوع خاطئ في الطلب يُعلَن بنوعه (وملفّ Storage الافتراضي في الاختبار مشتقّ من الحمولة المعدَّلة نفسها فيحمل النوع نفسه)`);
      res = evalOf('c11', {mutate: (p) => { bhOf(p).energyCounterNwh = '5'; }, storage: fileWith('c11', () => {})});
      eq(sv(res).energyCounterNwh.comparison, 'ABSENT_IN_FILE_WRONG_TYPE(string)_IN_REQUEST', `${L}-ب نوع خاطئ في الطلب وغياب في الملفّ ⟵ ABSENT_IN_FILE_WRONG_TYPE(string)_IN_REQUEST`);
      res = evalOf('c11', {mutate: (p) => { delete footerOf(p).batteryHealth; }});
      deq([sv(res).energyCounterNwh.request.state, sv(res).energyCounterNwh.requestState.state], ['CONTAINER_ABSENT(batteryHealth)', 'CONTAINER_ABSENT(batteryHealth)'], `${L}-ب batteryHealth غائب ⟵ CONTAINER_ABSENT`);
      res = evalOf('c11', {mutate: (p) => { footerOf(p).batteryHealth = null; }});
      eq(sv(res).energyCounterNwh.request.state, 'CONTAINER_NULL(batteryHealth)', `${L}-ب batteryHealth null ⟵ CONTAINER_NULL`);
      res = evalOf('c11', {mutate: (p) => { footerOf(p).batteryHealth = 'x'; }});
      eq(sv(res).energyCounterNwh.request.state, 'CONTAINER_WRONG_TYPE(batteryHealth:string)', `${L}-ب batteryHealth نصّ ⟵ CONTAINER_WRONG_TYPE`);
      res = evalOf('c11', {storage: fileWith('c11', (file) => { delete file.footer.batteryHealth; })});
      deq([sv(res).energyCounterNwh.file.state, sv(res).energyCounterNwh.comparison], ['CONTAINER_ABSENT(footer.batteryHealth)', 'CONTAINER_ABSENT(footer.batteryHealth)_IN_FILE_ABSENT_IN_REQUEST'], `${L}-ب ملفّ بلا batteryHealth ⟵ حاوية غائبة باسمها الكامل`);
      res = evalOf('c11', {storage: fileWith('c11', (file) => { delete file.footer; })});
      eq(sv(res).energyCounterNwh.file.state, 'CONTAINER_ABSENT(footer)', `${L}-ب ملفّ بلا footer ⟵ CONTAINER_ABSENT(footer)`);
      res = evalOf('c11', {storage: fileWith('c11', (file) => { file.footer = 'x'; })});
      eq(sv(res).energyCounterNwh.file.state, 'CONTAINER_WRONG_TYPE(footer:string)', `${L}-ب footer بنوع خاطئ في الملفّ`);
    }

    // ── (ج) ملفّ Storage لم يُقرأ أو بشكل آخر: لا مقارنة، والسبب معلَن ──
    {
      const cases = [
        [{state: 'STORAGE_NOT_READ_BY_OPTION'}, 'STORAGE_FILE_NOT_READ(STORAGE_NOT_READ_BY_OPTION)'],
        [{state: 'FILE_NOT_FOUND'}, 'STORAGE_FILE_NOT_READ(FILE_NOT_FOUND)'],
        [{state: 'DOWNLOAD_ERROR'}, 'STORAGE_FILE_NOT_READ(DOWNLOAD_ERROR)'],
        [{state: 'DOWNLOADED', json: [{phase: 3, v: [0]}]}, 'STORAGE_FILE_IS_SAMPLES_ARRAY(no footer)'],
        [{state: 'DOWNLOADED', json: 'x'}, 'STORAGE_FILE_NOT_OBJECT(string)'],
        [{state: 'DOWNLOADED', json: null}, 'STORAGE_FILE_NOT_OBJECT(null)'],
      ];
      for (const [storage, why] of cases) {
        const res = evalOf('c11', {storage});
        deq([sv(res).energyCounterNwh.comparison, sv(res).energyCounterNwh.file.state], [`FILE_NOT_COMPARED(${why})`, why], `${L}-ج ${why}`);
        ok(basisOf(res, I.ENERGY_COUNTER_NWH).includes(`file.energyCounterNwh=${why} comparison=FILE_NOT_COMPARED(${why})`) && basisOf(res, I.ENERGY_COUNTER_NWH).includes('request.energyCounterNwh=ABSENT'), `${L}-ج والصفّ يقول السبب ويكتب الطلب وحده`);
        eq(verdictOf(res, I.ENERGY_COUNTER_NWH), V.INFO, `${L}-ج INFO`);
        ok(['CPU_TEMP_FINAL_SOURCE', 'WORKERS_PIN_STATE', 'MEMORY_VERIFY_STATE'].every((it) => verdictOf(res, it) === V.INFO), `${L}-ج وبقيّة القيم (من الطلب) لا تتأثّر بغياب الملفّ`);
      }
    }

    // ── (د) نصّ طويل: يُقطع عند 200 حرف ويُعلَن ──
    {
      const src = (n) => `absent:${'y'.repeat(n - 7)}`;
      let res = evalOf('c11', {mutate: (p) => { footerOf(p).cpuTempFinalSource = src(200); }});
      eq(basisOf(res, I.CPU_TEMP_FINAL_SOURCE), `cpuTempFinalSource=${src(200)}`, `${L}-د 200 حرفاً بالضبط: كما هو بلا قطع`);
      eq(sv(res).cpuTempFinalSource.truncated, undefined, `${L}-د ولا علم قطع في JSON`);
      res = evalOf('c11', {mutate: (p) => { footerOf(p).cpuTempFinalSource = src(201); }});
      eq(basisOf(res, I.CPU_TEMP_FINAL_SOURCE), `cpuTempFinalSource=${src(201).slice(0, 200)}[TRUNCATED_TO_200_CHARS length=201]`, `${L}-د 201 حرفاً: يُقطع عند 200 ويُعلَن القطع وطول الأصل`);
      deq(sv(res).cpuTempFinalSource, {state: 'PRESENT', value: src(201).slice(0, 200), truncated: true, length: 201}, `${L}-د وفي JSON: القيمة مقطوعة، وtruncated وlength`);
      res = evalOf('c11', {mutate: (p) => { footerOf(p).cpuTempFinalSource = src(5000); }});
      ok(basisOf(res, I.CPU_TEMP_FINAL_SOURCE).endsWith('[TRUNCATED_TO_200_CHARS length=5000]') && basisOf(res, I.CPU_TEMP_FINAL_SOURCE).length < 260, `${L}-د نصّ من 5000 حرف ⟵ قُطع (الصفّ أقصر من 260)`);
      res = evalOf('c11', {mutate: (p) => { vrOf(p).memoryVerifyState = `not_run:${'z'.repeat(400)}`; vrOf(p).workersPinState = `pin_result_unreadable:${'w'.repeat(400)}`; }});
      ok(basisOf(res, I.MEMORY_VERIFY_STATE).includes('[TRUNCATED_TO_200_CHARS length=408]') && basisOf(res, I.WORKERS_PIN_STATE).includes('[TRUNCATED_TO_200_CHARS length=422]'), `${L}-د السقف نفسه لكل نصّ حالة`);
    }

    // ── (هـ) نصوص الحالات: مفردة العقد كما شُحنت، والغياب والـnull والنوع الخاطئ بحالتها ──
    {
      for (const raw of ['attempted', 'not_attempted:ai_workload_path', 'pin_result_unreadable:size=3', 'mystery', '']) {
        const res = evalOf('c11', {mutate: (p) => { vrOf(p).workersPinState = raw; }});
        eq(basisOf(res, I.WORKERS_PIN_STATE), `workersPinState=${raw}`, `${L}-هـ workersPinState «${raw}» كما شُحنت`);
      }
      for (const raw of ['ran', 'partial:time_cap_reached', 'not_run:insufficient_free_memory', 'mystery', '']) {
        const res = evalOf('c11', {mutate: (p) => { vrOf(p).memoryVerifyState = raw; }});
        eq(basisOf(res, I.MEMORY_VERIFY_STATE), `memoryVerifyState=${raw}`, `${L}-هـ memoryVerifyState «${raw}» كما شُحنت`);
      }
      for (const raw of ['live_read_at_finalize', 'sampler_max_cpu', 'absent:no live CPU read', 'mystery']) {
        const res = evalOf('c11', {mutate: (p) => { footerOf(p).cpuTempFinalSource = raw; }});
        eq(basisOf(res, I.CPU_TEMP_FINAL_SOURCE), `cpuTempFinalSource=${raw}`, `${L}-هـ cpuTempFinalSource «${raw}» كما شُحنت`);
      }
      const states = [
        [(p) => { delete vrOf(p).workersPinState; delete vrOf(p).memoryVerifyState; delete footerOf(p).cpuTempFinalSource; }, ['ABSENT', 'ABSENT', 'ABSENT']],
        [(p) => { vrOf(p).workersPinState = null; vrOf(p).memoryVerifyState = null; footerOf(p).cpuTempFinalSource = null; }, ['NULL', 'NULL', 'NULL']],
        [(p) => { vrOf(p).workersPinState = 3; vrOf(p).memoryVerifyState = true; footerOf(p).cpuTempFinalSource = {}; }, ['WRONG_TYPE(number)', 'WRONG_TYPE(boolean)', 'WRONG_TYPE(object)']],
        [(p) => { delete footerOf(p).verificationResults; }, ['CONTAINER_ABSENT(verificationResults)', 'CONTAINER_ABSENT(verificationResults)', null]],
        [(p) => { footerOf(p).verificationResults = null; }, ['CONTAINER_NULL(verificationResults)', 'CONTAINER_NULL(verificationResults)', null]],
      ];
      for (const [mut, want] of states) {
        const res = evalOf('c11', {mutate: mut});
        const got = [sv(res).workersPinState.state, sv(res).memoryVerifyState.state, sv(res).cpuTempFinalSource.state];
        deq(got.slice(0, want[2] === null ? 2 : 3), want.slice(0, want[2] === null ? 2 : 3), `${L}-هـ حالات الغياب: ${JSON.stringify(want)}`);
        ok(sv(res).workersPinState.value === null && sv(res).memoryVerifyState.value === null, `${L}-هـ والقيمة null لا نصّ مختلَق`);
      }
    }

    // ── (و) timeToFirstFixState من L-02 الوظيفية ──
    {
      const ttff = (mut) => basisOf(evalOf('c11', {mutate: mut}), I.TIME_TO_FIRST_FIX_STATE);
      eq(ttff((p) => { l02Of(p).measurements.timeToFirstFixState = 'fix_obtained'; }), 'L-02 timeToFirstFixState=fix_obtained', `${L}-و الحالة كما شُحنت`);
      eq(ttff((p) => { l02Of(p).measurements.timeToFirstFixState = 'no_fix:timeout'; }), 'L-02 timeToFirstFixState=no_fix:timeout', `${L}-و حالة بسبب`);
      eq(ttff((p) => { delete l02Of(p).measurements.timeToFirstFixState; }), 'L-02 timeToFirstFixState=ABSENT', `${L}-و المفتاح غائب ⟵ ABSENT`);
      eq(ttff((p) => { l02Of(p).measurements.timeToFirstFixState = null; }), 'L-02 timeToFirstFixState=NULL', `${L}-و null صريحة ⟵ NULL`);
      eq(ttff((p) => { l02Of(p).measurements.timeToFirstFixState = 12; }), 'L-02 timeToFirstFixState=WRONG_TYPE(number)', `${L}-و نوع خاطئ`);
      eq(ttff((p) => { delete l02Of(p).measurements; }), 'L-02 timeToFirstFixState=CONTAINER_ABSENT(measurements)', `${L}-و measurements غائبة`);
      eq(ttff((p) => { l02Of(p).measurements = 'x'; }), 'L-02 timeToFirstFixState=CONTAINER_WRONG_TYPE(measurements:string)', `${L}-و measurements بنوع خاطئ`);
      eq(ttff((p) => { p.functionalResults = p.functionalResults.filter((f) => f.testId !== 'L-02'); }), 'L-02 timeToFirstFixState=L02_ABSENT', `${L}-و L-02 غائب من functionalResults`);
      eq(ttff((p) => { delete p.functionalResults; }), 'L-02 timeToFirstFixState=L02_ABSENT', `${L}-و functionalResults غائب كلّه`);
    }

    // ── (ز) لا حكم ولا تأثير على بند آخر: ملفّ Storage وحده يتغيّر ⟵ صفّ الطاقة وحده (وحجم الحمولة) ──
    {
      const base = evalOf('c11');
      const alt = evalOf('c11', {storage: fileWith('c11', (file) => { file.footer.batteryHealth.energyCounterNwh = 99999; })});
      const not = (res) => res.rows.filter((r) => r.item !== I.ENERGY_COUNTER_NWH && r.item !== I.PAYLOAD_BYTES);
      deq(not(alt), not(base), `${L}-ز تغيير ملفّ Storage وحده لا يغيّر أيّ صفّ غير صفّ الطاقة وحجم الحمولة (الحكم والأساس)`);
      eq(alt.rows.length, base.rows.length, `${L}-ز وعدد الصفوف نفسه`);
      deq([base.rows.filter((r) => r.verdict === V.FAIL).length, alt.rows.filter((r) => r.verdict === V.FAIL).length], [0, 0], `${L}-ز ولا FAIL (حتى رقم في الملفّ وغائب من الطلب)`);
    }

    // ── (ح) لا بصمة ⟵ NOT_MEASURED بسببها؛ B1 (fv67) بحالات الغياب لا استبدال LEGACY؛ القواعد؛ الفحص الذاتي ──
    {
      const noFp = D.evaluateReport({...factsOf('c11').facts, rawRead: {state: 'ABSENT', raw: null}, storage: {state: 'RAW_ABSENT'}}, {accountHash: ACCOUNT_HASH});
      ok(FIVE.every((it) => verdictOf(noFp, it) === V.NOT_MEASURED && rowOf(noFp, it).basis === 'RAW_FINGERPRINT_ABSENT'), `${L}-ح لا بصمة ⟵ الخمسة NOT_MEASURED:RAW_FINGERPRINT_ABSENT`);
      eq(noFp.block.stateValues, undefined, `${L}-ح ولا كتلة قيم`);
      const old = evalOf('fv67', {tag: 'B1', mutate: (p) => { p.timeSeries.header.appVersion = '1.0.10'; }});
      ok(FIVE.every((it) => verdictOf(old, it) === V.INFO && !/^LEGACY_FV67_SCAN/.test(rowOf(old, it).basis)), `${L}-ح B1 (fv67): الخمسة INFO بحالات الغياب لا NOT_MEASURED:LEGACY (قيم مقروءة لا بنود حمولة)`);
      deq([sv(old).energyCounterNwh.request.state, sv(old).cpuTempFinalSource.state, sv(old).memoryVerifyState.state.startsWith('CONTAINER_') || sv(old).memoryVerifyState.state === 'ABSENT'], ['ABSENT', 'ABSENT', true], `${L}-ح وحمولة fv67: الطاقة وcpuTempFinalSource غائبان (ABSENT)`);
      eq(old.rows.filter((r) => r.verdict === V.FAIL).length, 0, `${L}-ح وB1 بلا FAIL كما كان`);
      for (const it of FIVE) ok(typeof D.ITEM_RULES[it] === 'string' && D.ITEM_RULES[it].includes('INFO'), `${L}-ح قاعدة ${it} مكتوبة وتقول INFO`);
      ok(D.ITEM_RULES[I.ENERGY_COUNTER_NWH].includes('NUMBER_IN_FILE_ABSENT_IN_REQUEST') && D.ITEM_RULES[I.ENERGY_COUNTER_NWH].includes('بلا حكم') && D.ITEM_RULES[I.CPU_TEMP_FINAL_SOURCE].includes('200'), `${L}-ح قاعدة الطاقة تسمّي الحالة وتقول بلا حكم، وقاعدة المصدر تذكر 200`);
      eq(D.STATE_TEXT_CAP, 200, `${L}-ح سقف النصّ 200`);
      const noReaderRes = D.evaluateReport({...factsOf('c11').facts, rawRead: {state: 'PRIVATE', raw: {rawFingerprint: {timeSeries: 'not-an-object'}}}}, {accountHash: ACCOUNT_HASH});
      ok(FIVE.every((it) => verdictOf(noReaderRes, it) === V.INFO), `${L}-ح بصمة مشوَّهة (timeSeries ليس كائناً): القيم تُعلَن بحالات الغياب لا استثناء`);
      const pf = D.preflightChecks({});
      ok(pf.ok === true && pf.checks.some((c) => c.name.includes('قيم الحالات') && c.ok), `${L}-ح الفحص الذاتي سليم وفيه فحص قيم الحالات — ${pf.checks.filter((c) => !c.ok).map((c) => c.name).join(' | ')}`);
    }
  }

  // ═══ ١٧ — MANUAL_STATUS_VOCAB: الحالات من manualResults[].status في البصمة كما شُحنت، بلا تطبيع (طلب المنسّق 2026-10-11) ═══
  {
    const L = '[١٧]';
    const res = evalOf('c11');
    eq(rowOf(res, I.MANUAL_STATUS_VOCAB).basis, 'statuses=["M-02:pass","M-07:pass","M-11:not_tested","M-09:warning","M-08:unavailable","M-19:fail"]', `${L} الحالات الستّ كما في الحمولة الذهبية حرفياً: unavailable تبقى unavailable ولا تصير not_tested`);
    // الاختبارات الأربعة التي ذكرها وكيل التطبيق (M-08 وM-12 وM-14 وM-15) بحالة unavailable، وغيرها not_tested: كلّ منها كما شُحن
    const mix = evalOf('c11', {mutate: (p) => {
      p.manualResults = [['M-08', 'unavailable'], ['M-12', 'unavailable'], ['M-14', 'unavailable'], ['M-15', 'unavailable'], ['M-07', 'not_tested'], ['M-11', 'not_tested']].map(([testId, status]) => ({testId, status}));
    }});
    eq(rowOf(mix, I.MANUAL_STATUS_VOCAB).basis, 'statuses=["M-08:unavailable","M-12:unavailable","M-14:unavailable","M-15:unavailable","M-07:not_tested","M-11:not_tested"]', `${L} أربع unavailable وحالتان not_tested كما شُحنت (لا تحويل بينهما)`);
    deq(mix.block.manual.entries.map((e) => [e.testId, e.status, e.outcome, e.notMeasuredReason]), [['M-08', 'unavailable', 'NOT_MEASURED', 'HARDWARE_ABSENT'], ['M-12', 'unavailable', 'NOT_MEASURED', 'HARDWARE_ABSENT'], ['M-14', 'unavailable', 'NOT_MEASURED', 'HARDWARE_ABSENT'], ['M-15', 'unavailable', 'NOT_MEASURED', 'HARDWARE_ABSENT'], ['M-07', 'not_tested', 'NOT_MEASURED', 'OPERATOR_SKIPPED'], ['M-11', 'not_tested', 'NOT_MEASURED', 'OPERATOR_SKIPPED']], `${L} والحالة الخام تبقى في الكتلة، وتصنيف الخادم (toTestResult) منفصل عنها: unavailable ⟵ HARDWARE_ABSENT وnot_tested ⟵ OPERATOR_SKIPPED`);
    deq([verdictOf(mix, I.MANUAL_STATUS_VOCAB), verdictOf(mix, I.MANUAL_UNAVAILABLE_CLASS)], [V.PASS, V.PASS], `${L} وحكما البندين على الحالات كما شُحنت`);
    // الحمولة الحقيقية في reportRaw تحمل manualResults بلا مسّ (lightenFingerprintForStorage يحذف samples وحدها)
    const p0 = payloadOf('c11');
    deq(JSON.parse(JSON.stringify(lightenFingerprintForStorage(p0).manualResults)), p0.manualResults, `${L} manualResults في الخامّ المخزَّن = الطلب حرفياً`);
  }
  fs.rmSync(tmp, {recursive: true, force: true}); // ملفّات الاختبار المؤقّتة وحدها
  console.log(`\ndeviceCheck03After.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});

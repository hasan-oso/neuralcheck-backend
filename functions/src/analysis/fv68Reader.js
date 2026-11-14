'use strict';

// ===================================================================
// fv68Reader.js — قارئ الخادم لحمولة fieldsVersion 68
// (V8 / PLAN-05 الدفعة ٤، 2026-10-09 +03)
// ===================================================================
//
// يقرأ ما يرسله التطبيق (1.0.11 فصاعداً) ويُخرج **حالة صريحة لكل مفتاح وحالة**:
// ما وُجد، وما غاب وسبب غيابه، وما جاء بنوع لا يطابق العقد، وما جاء بحالة نصّية
// خارج المفردة المعروفة. لا قيمة افتراضية تسدّ غياباً، ولا صفر ولا نجاح
// (القاعدة 22)؛ وكل ما يُقرأ يُعلَن (القاعدة 25: «الطبقة تُعلن ما طلبته ولم تجده»).
//
// **المصدر:** docs/FV68_CONTRACT.md (نسخة NeuralChek a04b4f0؛ كانت 738da89 حتى 2026-10-10، وأسطر «عقد :N» أدناه من 738da89 — انظر docs/FV68_CONTRACT.SOURCE.txt) — موضع كل قسم في العقد مذكور
// عنده. ما لم يحسمه العقد وسمّيتُه أنا (أسماء داخلية للخادم لا تُكتب على السلك) موسوم «اسم خادم».
// **fv71 (S-M02، 2026-10-18):** قسم §٧-ي في docs/FV71_CONTRACT_SECTION.md (نسخة قسم وحده من NeuralChek@0af0b5c؛ الملفّ كلّه هنا ما زال 450d9ed). M-02 الجديد (الشبكة بالخامّ) يقرؤه readTouchPath أدناه
// وتحكم على مساره touchPath.js؛ وجواب M-02 اليدوي وعلاقته بالخامّ readTouchGridAnswer. والجرد: docs/FV68_READERS_INVENTORY.md §٧.
//
// ما يفعله: دوال نقيّة. لا شبكة، لا Firestore، لا حالة مشتركة، لا يرمي أبداً
// (readFv68 تلتقط كل استثناء وتُعيد readerError صريحاً).
// ما لا يفعله: لا حرف ولا بوّابة ولا حكم على فئة (خارج العقد §٠ :12). «الخادم يحكم» (س-27..س-35)
// تعني أن هذا القارئ يسلّم الخامّ مع حالته ليحكم من يحكم لاحقاً؛ لا يحكم هو.
//
// ─── من يستورده ──────────────────────────────────────────────────────
//   findings.js        readColumnsAndFailures/columnIndex/failedReads (قراءة الأعمدة بالاسم + استثناء العيّنات الفاشلة، س-27)
//   runAnalysisInternal.js  readFv68 + summarizeForLog (سطر سجلّ واحد لكل فحص، وإعادة المخرَج مع النتيجة)
//   signatures/computeScanSignature.js  readVerificationOnly (اشتقاق صريح بلا `|| 0` ولا `!== false`) وreadBatteryHealthOnly (الدورات: تصنيف cycleCountClassification.js يحفظ الحالة لا الرقم)
//   admin/runConsistencyTest.js  resolveLayout/columnIndex (الضجيج بالاسم)
//   test/fv68Reader.test.js وfv68ReadingsGolden.test.js

const N = require('./fv68Names');
const {analyzeTouchPath} = require('./touchPath');
// القاعدة 36: نصّ أيّ استثناء يُنقّى قبل أن يُكتب في المخرَج أو الشذوذ (حارس test/failureTextSites.test.js)
const {sanitizeFailureText} = require('../utils/failureText');

const K = N.STATE_KIND;

// ─── أدوات صغيرة ─────────────────────────────────────────────────────
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const numOrNull = (v) => (isFiniteNum(v) ? v : null);
const strOrNull = (v) => (isStr(v) ? v : null);
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const TYPE_CHECKS = {
  number: isFiniteNum,
  int: Number.isInteger,
  string: isStr,
  boolean: (v) => typeof v === 'boolean',
  array: Array.isArray,
  object: isObj,
};

function getPath(root, dotted) {
  let cur = root;
  for (const part of dotted.split('.')) {
    if (!isObj(cur) || !has(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

// ─── سياق القراءة: الختم، والمفاتيح التي سمّاها fieldsNotInFile، وما يُجمَع من شذوذ ──────
function makeCtx(parts) {
  const footer = parts.footer;
  const fieldsVersion = isFiniteNum(footer.fieldsVersion) ? footer.fieldsVersion : null;
  const applicable = fieldsVersion !== null && fieldsVersion >= N.FIELDS_VERSION_68;
  // fv71 (M-02 الخامّ وأزرار الصوت): ختم ≥ 71 — مقارنة عتبة واحدة هنا يستعملها كل قارئ fv71 (fieldsVersionThresholds.test.js يعدّدها)
  const sinceFv71 = fieldsVersion !== null && fieldsVersion >= N.FIELDS_VERSION_71;
  const listed = Array.isArray(footer[N.FOOTER.FIELDS_NOT_IN_FILE]) ?
      footer[N.FOOTER.FIELDS_NOT_IN_FILE].filter(isStr) : [];
  const ctx = {
    parts, footer, fieldsVersion, applicable, sinceFv71,
    notInFile: new Set(listed),
    anomalies: [],
    anomaly(section, code, detail) {
      ctx.anomalies.push({section, code, detail: detail === undefined ? null : detail});
    },
  };
  return ctx;
}

// حالة غياب مفتاح: سمّاه fieldsNotInFile ← NOT_IN_FILE؛ ختم ≥ 68 ← ABSENT؛ غير ذلك ← NOT_IN_FIELDS_VERSION.
function absentStatus(ctx, footerRelativePath) {
  if (ctx.notInFile.has(footerRelativePath)) return N.KEY_STATUS.NOT_IN_FILE;
  return ctx.applicable ? N.KEY_STATUS.ABSENT : N.KEY_STATUS.NOT_IN_FIELDS_VERSION;
}

// خلية مفتاح مقروءة: {status, value} — الغياب لا يتحوّل إلى قيمة.
// `null` على السلك يُقرأ غياباً (Gson يُسقط المفاتيح الفارغة، عقد :360).
function cell(ctx, container, key, type, footerRelativePath) {
  if (!isObj(container) || !has(container, key) || container[key] === null || container[key] === undefined) {
    return {status: absentStatus(ctx, footerRelativePath), value: null};
  }
  const v = container[key];
  const check = TYPE_CHECKS[type];
  if (check && !check(v)) {
    ctx.anomaly(footerRelativePath, 'WRONG_TYPE', {expected: type, found: typeOf(v)});
    return {status: N.KEY_STATUS.WRONG_TYPE, value: null, foundType: typeOf(v)};
  }
  return {status: N.KEY_STATUS.PRESENT, value: v};
}

// مفتاح حذفه العقد من ≥ 68: غيابه في ≥ 68 هو التصميم (REMOVED_IN_FV68)، وحضوره مخالفة (يُعلنها المستدعي)؛
// وفي < 68 يبقى غياباً صريحاً (A76: لم يصل قطّ من بنائه منذ 1.7.B) لا «لم يوجد بعد».
function removedCell(ctx, container, key, type, footerRelativePath) {
  const c = cell(ctx, container, key, type, footerRelativePath);
  if (ctx.applicable && c.status === N.KEY_STATUS.ABSENT) return {...c, status: N.KEY_STATUS.REMOVED_IN_FV68};
  if (!ctx.applicable && c.status === N.KEY_STATUS.NOT_IN_FIELDS_VERSION) return {...c, status: N.KEY_STATUS.ABSENT};
  return c;
}

// غياب مفتاح تشرحه حالة شقيقة حاضرة: ABSENT ← ABSENT_DECLARED (القاعدة 22: الغياب بسببه، لا غياب صامت).
function declaredIf(status, isDeclared) {
  return status === N.KEY_STATUS.ABSENT && isDeclared ? N.KEY_STATUS.ABSENT_DECLARED : status;
}
const kindIn = (stateObj, kinds) => stateObj !== null && stateObj !== undefined && kinds.includes(stateObj.kind);

// يحلّل نصّ حالة حسب مفردتها: {raw, kind, detail, recognized} أو null إن لم يكن نصّاً.
function parseState(raw, vocabularyKey) {
  if (!isStr(raw)) return null;
  const vocab = N.STATE_VOCABULARY[vocabularyKey];
  if (vocab.exact.includes(raw)) return {raw, kind: raw, detail: null, recognized: true};
  const i = raw.indexOf(':');
  if (i > 0) {
    const prefix = raw.slice(0, i);
    if (vocab.prefixed.includes(prefix)) return {raw, kind: prefix, detail: raw.slice(i + 1), recognized: true};
  }
  return {raw, kind: N.READER_STATE.UNRECOGNIZED, detail: null, recognized: false};
}

// خلية حالة نصّية: {status, state}. الحالة غير المعروفة تُعلَن ولا تُسقَط.
function stateCell(ctx, container, key, vocabularyKey, footerRelativePath) {
  const c = cell(ctx, container, key, 'string', footerRelativePath);
  if (c.status !== N.KEY_STATUS.PRESENT) return {status: c.status, state: null};
  const state = parseState(c.value, vocabularyKey);
  if (!state.recognized) ctx.anomaly(footerRelativePath, 'UNRECOGNIZED_STATE', {raw: state.raw});
  if (state.detail !== null && state.detail.length > N.REASON_TEXT_CAP_CHARS) {
    ctx.anomaly(footerRelativePath, 'REASON_TEXT_OVER_CAP', {length: state.detail.length, cap: N.REASON_TEXT_CAP_CHARS});
  }
  return {status: c.status, state};
}

// ─── الأجزاء من fingerprint — نفس ترتيب findings.js وcallAI.js (timeSeries أولاً ثم الجذر للتوافق) ──
function extractParts(fingerprint) {
  const fp = isObj(fingerprint) ? fingerprint : {};
  const ts = isObj(fp.timeSeries) ? fp.timeSeries : {};
  const pick = (k) => ts[k] || fp[k]; // نفس `ts.x || fingerprint.x` في findings.js وcallAI.js
  const header = pick(N.TIME_SERIES.HEADER);
  const footer = pick(N.TIME_SERIES.FOOTER);
  const samples = pick(N.TIME_SERIES.SAMPLES);
  const variables = pick(N.TIME_SERIES.VARIABLES);
  return {
    ts,
    header: isObj(header) ? header : {},
    footer: isObj(footer) ? footer : {},
    samples: Array.isArray(samples) ? samples : [],
    variables: Array.isArray(variables) ? variables : [],
    root: fp,
    functionalResults: Array.isArray(fp.functionalResults) ? fp.functionalResults : [],
    manualResults: Array.isArray(fp.manualResults) ? fp.manualResults : [],
  };
}

// ═══════════════════════════════════════════════════════════════════
// ١) تخطيط الأعمدة — القراءة بالاسم (عقد §٢.١ :398-412؛ ق-10 :736؛ §٤.٢ :777-789)
// ═══════════════════════════════════════════════════════════════════
// الحمولة تحمل variables[] بـ{name, source, unit} **بلا index** (قيس على عيّنات fv67 وfv68 الذهبية)؛
// فالفهرس = موضع العنصر في variables[]، وهو عمود v[] نفسه (عقد :409 «الاسم هو المميِّز»).
// إن حمل كل عنصر index صحيحاً (ملفّ السلاسل في Storage، والعيّنات الذهبية القديمة) فهو المرجع.

function sampleVectorLength(samples) {
  let max = null;
  let min = null;
  for (const s of samples) {
    if (!isObj(s) || !Array.isArray(s.v)) continue;
    max = max === null ? s.v.length : Math.max(max, s.v.length);
    min = min === null ? s.v.length : Math.min(min, s.v.length);
  }
  return {max, min};
}

function resolveLayout(variables, samples) {
  const vars = Array.isArray(variables) ? variables : [];
  const declaredIndexForAll = vars.length > 0 && vars.every((v) => isObj(v) && Number.isInteger(v.index) && v.index >= 0);
  const columns = [];
  vars.forEach((v, pos) => {
    if (!isObj(v)) {
      columns.push({index: pos, name: null, unit: null, indexFrom: 'position', malformed: true});
      return;
    }
    columns.push({
      index: declaredIndexForAll ? v.index : pos,
      name: strOrNull(v.name) && v.name.trim() !== '' ? v.name : null,
      unit: strOrNull(v.unit),
      indexFrom: declaredIndexForAll ? 'declared' : 'position',
    });
  });

  const byName = {};
  const duplicateNames = [];
  for (const c of columns) {
    if (c.name === null) continue;
    if (has(byName, c.name)) {
      if (!duplicateNames.includes(c.name)) duplicateNames.push(c.name);
    } else {
      byName[c.name] = c.index;
    }
  }

  const {max: vMax, min: vMin} = sampleVectorLength(samples);
  const sampleWidthConsistent = vMax === null ? null : vMax === vMin;
  const named = new Set(columns.map((c) => c.index));
  const unresolvedIndices = [];
  if (vMax !== null) for (let i = 0; i < vMax; i++) if (!named.has(i)) unresolvedIndices.push(i);
  const columnsBeyondSamples = vMax === null ? [] : columns.filter((c) => c.index >= vMax).map((c) => c.name);

  // القناة الأساسية في موضعها (عقد :401 «v[0..10] كما هي»).
  const baseMismatches = [];
  const baseMissing = [];
  N.BASE_CHANNEL_ORDER.forEach((expected, i) => {
    if (!has(byName, expected)) {
      baseMissing.push(expected);
    } else if (byName[expected] !== i) {
      baseMismatches.push({name: expected, expectedIndex: i, foundIndex: byName[expected]});
    }
  });
  let baseLayout;
  if (columns.length === 0) baseLayout = 'NO_VARIABLES';
  else if (baseMissing.length === 0 && baseMismatches.length === 0) baseLayout = 'MATCHES';
  else if (baseMissing.length > 0 && baseMismatches.length === 0) baseLayout = 'INCOMPLETE';
  else baseLayout = 'MISMATCH';

  const extraChannels = columns.filter((c) => c.name !== null && !N.BASE_CHANNEL_ORDER.includes(c.name))
      .map((c) => ({name: c.name, index: c.index}));
  const policyChannels = [];
  for (const e of extraChannels) {
    const m = N.CPU_FREQ_POLICY_CHANNEL_RE.exec(e.name);
    if (m) policyChannels.push({name: e.name, index: e.index, policy: Number(m[1])});
  }
  const cc = columns.find((c) => c.name === N.CHARGE_COUNTER_CHANNEL) || null;

  return {
    columnCount: columns.length,
    sampleVectorLength: vMax,
    sampleWidthConsistent,
    indexFrom: columns.length === 0 ? null : (declaredIndexForAll ? 'declared' : 'position'),
    columns,
    byName,
    duplicateNames,
    unresolvedIndices,
    columnsBeyondSamples,
    baseLayout,
    baseMissing,
    baseMismatches,
    extraChannels,
    policyChannels,
    chargeCounter: cc === null ? null : {index: cc.index, unit: cc.unit},
  };
}

// فهرس عمود باسمه، أو null إن لم يكن في التخطيط. (لا يُعيد 0 ولا يخمّن.)
function columnIndex(layout, name) {
  return layout && has(layout.byName, name) ? layout.byName[name] : null;
}

// ═══════════════════════════════════════════════════════════════════
// ٢) العيّنات الفاشلة لكل قناة — س-27 (عقد :996-1001؛ §٧ بند 1 :1091)
// ═══════════════════════════════════════════════════════════════════
// القيمة في v[] عند الفشل «آخر قيمة صالحة» (بذرة الاكتشاف قبل أول قراءة صالحة): رقم صالح الشكل وكاذب القياس.
// فكل قارئ يمرّ على عمود قناة يستثني هذه الفهارس (شرط المستخدم، عقد :845)، ويُعلن:
//   COMPLETE    القائمة كاملة (count == طولها) ← الاستثناء تامّ
//   TRUNCATED   count > طولها (سقف 200) ← بعض الفاشلة غير مسمّاة، الاستثناء ناقص
//   COUNT_ABSENT القائمة موجودة بلا count ← لا برهان على اكتمالها
//   UNTRACKED   لا مفتاح للقناة في channelReadFailures (عقد :1091 «المفتاح الغائب = غير متتبَّع»)
//   NOT_TRACKED_BY_DESIGN  أعمدة v[0..10]: «حرّاسها قيد معروف غير مُصلَح بنصّ الحسم» (عقد :70 (7))
// القائمة الفارغة الكاملة = «لا فشل» (≠ غياب المفتاح).

const EXCLUSION = Object.freeze({
  COMPLETE: 'COMPLETE',
  TRUNCATED: 'TRUNCATED',
  COUNT_ABSENT: 'COUNT_ABSENT',
  UNTRACKED: 'UNTRACKED',
  NOT_TRACKED_BY_DESIGN: 'NOT_TRACKED_BY_DESIGN',
});

function readChannelFailures(ctx, layout, sampleCount) {
  const footer = ctx.footer;
  const mapCell = cell(ctx, footer, N.FOOTER.CHANNEL_READ_FAILURES, 'object', N.FOOTER.CHANNEL_READ_FAILURES);
  const countsCell = cell(ctx, footer, N.FOOTER.CHANNEL_READ_FAILURE_COUNTS, 'object', N.FOOTER.CHANNEL_READ_FAILURE_COUNTS);
  const map = mapCell.status === N.KEY_STATUS.PRESENT ? mapCell.value : null;
  const counts = countsCell.status === N.KEY_STATUS.PRESENT ? countsCell.value : null;

  const channels = {};
  for (const col of layout.columns) {
    if (col.name === null) continue;
    const isExtra = !N.BASE_CHANNEL_ORDER.includes(col.name);
    if (!isExtra) {
      channels[col.name] = {tracking: EXCLUSION.NOT_TRACKED_BY_DESIGN, failedIndices: [], listedCount: null, count: null};
      continue;
    }
    if (map === null || !has(map, col.name)) {
      channels[col.name] = {tracking: EXCLUSION.UNTRACKED, failedIndices: [], listedCount: null, count: null};
      continue;
    }
    const rawList = map[col.name];
    if (!Array.isArray(rawList)) {
      ctx.anomaly(N.FOOTER.CHANNEL_READ_FAILURES, 'WRONG_TYPE', {channel: col.name, found: typeOf(rawList)});
      channels[col.name] = {tracking: EXCLUSION.UNTRACKED, failedIndices: [], listedCount: null, count: null, malformedList: true};
      continue;
    }
    const valid = new Set();
    let invalid = 0;
    let outOfRange = 0;
    let duplicates = 0;
    for (const idx of rawList) {
      if (!Number.isInteger(idx) || idx < 0) {
        invalid++;
      } else if (sampleCount > 0 && idx >= sampleCount) {
        outOfRange++; // فهرس عيّنة غير موجودة: لا يُستثنى به شيء
      } else if (valid.has(idx)) {
        duplicates++; // سباق DisciplinedSampler.restart() قد يكرّر فهرساً (عقد §٧-ب قيد :1104)
      } else {
        valid.add(idx);
      }
    }
    const count = counts !== null && has(counts, col.name) && Number.isInteger(counts[col.name]) && counts[col.name] >= 0 ?
        counts[col.name] : null;
    let tracking;
    if (count === null) tracking = EXCLUSION.COUNT_ABSENT;
    else if (count > rawList.length) tracking = EXCLUSION.TRUNCATED;
    else tracking = EXCLUSION.COMPLETE;
    if (count !== null && count < rawList.length) {
      ctx.anomaly(N.FOOTER.CHANNEL_READ_FAILURES, 'LIST_LONGER_THAN_COUNT', {channel: col.name, listed: rawList.length, count});
    }
    if (rawList.length > N.CHANNEL_READ_FAILURE_LIST_CAP) {
      ctx.anomaly(N.FOOTER.CHANNEL_READ_FAILURES, 'LIST_OVER_CAP', {channel: col.name, listed: rawList.length, cap: N.CHANNEL_READ_FAILURE_LIST_CAP});
    }
    channels[col.name] = {
      tracking,
      failedIndices: [...valid].sort((a, b) => a - b),
      listedCount: rawList.length,
      count,
      invalidIndexCount: invalid,
      outOfRangeCount: outOfRange,
      duplicateIndexCount: duplicates,
    };
  }

  // مفاتيح في الخريطة بلا عمود في variables[] (تخطيط لا يطابق التذييل).
  const unknownChannels = [];
  for (const m of [map, counts]) {
    if (m === null) continue;
    for (const name of Object.keys(m)) {
      if (!has(layout.byName, name) && !unknownChannels.includes(name)) unknownChannels.push(name);
    }
  }
  if (unknownChannels.length > 0) ctx.anomaly(N.FOOTER.CHANNEL_READ_FAILURES, 'CHANNEL_WITHOUT_COLUMN', unknownChannels);

  return {
    map: {status: mapCell.status},
    counts: {status: countsCell.status},
    channels,
    unknownChannels,
  };
}

// مجموعة الفهارس التي يجب على القارئ استثناؤها لقناة، مع اكتمال الاستثناء. القارئ الذي يهمل `exclusion` يقرأ
// الغياب نجاحاً: إن لم يكن COMPLETE أو NOT_TRACKED_BY_DESIGN فليُعلن ذلك في مخرَجه.
function failedReads(failures, channelName) {
  const ch = failures && failures.channels && has(failures.channels, channelName) ? failures.channels[channelName] : null;
  if (ch === null) return {exclusion: EXCLUSION.UNTRACKED, indices: new Set(), count: null};
  return {exclusion: ch.tracking, indices: new Set(ch.failedIndices), count: ch.count};
}

// verificationResults وحدها (لمن لا يحتاج بقيّة الأقسام: التوقيع). `verificationResults` تُقرأ من التذييل ثم من الجذر للتوافق.
function readVerificationOnly(fingerprint) {
  const fp = isObj(fingerprint) ? fingerprint : {};
  const ts = isObj(fp.timeSeries) ? fp.timeSeries : {};
  const footer = isObj(ts.footer) ? ts.footer : {};
  const vr = isObj(footer[N.FOOTER.VERIFICATION_RESULTS]) ? footer[N.FOOTER.VERIFICATION_RESULTS] :
    (isObj(fp[N.FOOTER.VERIFICATION_RESULTS]) ? fp[N.FOOTER.VERIFICATION_RESULTS] : null);
  const effectiveFooter = vr === null ? footer : {...footer, [N.FOOTER.VERIFICATION_RESULTS]: vr};
  const ctx = makeCtx({footer: effectiveFooter, ts});
  return {...readVerification(ctx), applicable: ctx.applicable};
}

// batteryHealth وحده (لمن لا يحتاج بقيّة الأقسام: التوقيع) — القارئ نفسه الذي يُخرجه readFv68 (readBatteryHealth)، فلا قراءة ثانية للدورات. الأجزاء من extractParts
// (التذييل من timeSeries ثم من الجذر للتوافق)، كما يقرؤها readFv68. لا يرمي لمُدخل ناقص: بلا تذييل ⟵ حالة غياب صريحة لا قيمة.
function readBatteryHealthOnly(fingerprint) {
  const ctx = makeCtx(extractParts(fingerprint));
  return {...readBatteryHealth(ctx), applicable: ctx.applicable};
}

// الأعمدة وفشل قراءتها من الأجزاء وحدها (لقرّاء العيّنات: findings.js): بلا قراءة بقيّة الأقسام.
function readColumnsAndFailures({footer, samples, variables}) {
  const parts = {footer: isObj(footer) ? footer : {}, samples: Array.isArray(samples) ? samples : [], variables: Array.isArray(variables) ? variables : []};
  const ctx = makeCtx(parts);
  const layout = resolveLayout(parts.variables, parts.samples);
  const failures = readChannelFailures(ctx, layout, parts.samples.length);
  return {layout, failures, anomalies: ctx.anomalies};
}

// ═══════════════════════════════════════════════════════════════════
// ٣) وحدة v[8]/v[9] والمقاطع — س-19 المصحَّح (عقد :840، :669-670)
// ═══════════════════════════════════════════════════════════════════
// الأمر بنصّه: «وحدة v[8]/v[9] بـappVersion: 1.0.9 و1.0.10 تُقرآن MiB/s. و1.0.8-v6beta «الوحدة غير محدَّدة».
// ومن fv68 بالوحدة المعلنة.» الترويسة تحمل appVersion من **ملفّ** الفحص (عقد :1191)، فتصدق حتى على ملفّ قديم يعيد تحليله 1.0.11.
function resolveThroughputUnit(ctx, layout) {
  const appVersion = strOrNull(ctx.parts.header[N.HEADER.APP_VERSION]);
  const trimmed = appVersion !== null && appVersion.trim() !== '' ? appVersion.trim() : null;
  const declaredOf = (name) => {
    const col = layout.columns.find((c) => c.name === name);
    return col ? col.unit : null;
  };
  const segUnit = cell(ctx, ctx.footer[N.FOOTER.VERIFICATION_RESULTS], N.VERIFICATION.STORAGE_THROUGHPUT_SEGMENTS_UNIT,
      'string', `${N.FOOTER.VERIFICATION_RESULTS}.${N.VERIFICATION.STORAGE_THROUGHPUT_SEGMENTS_UNIT}`);
  const declared = {
    [N.BASE_CHANNELS.STORAGE_THROUGHPUT_MBPS]: declaredOf(N.BASE_CHANNELS.STORAGE_THROUGHPUT_MBPS),
    [N.BASE_CHANNELS.MEMORY_BANDWIDTH_MBPS]: declaredOf(N.BASE_CHANNELS.MEMORY_BANDWIDTH_MBPS),
    segments: segUnit.value,
  };

  let unit = null;
  let basis;
  if (ctx.applicable) {
    const declaredUnits = Object.values(declared).filter((u) => isStr(u) && u.trim() !== '');
    const distinct = [...new Set(declaredUnits)];
    if (distinct.length === 1) {
      unit = distinct[0];
      basis = N.THROUGHPUT_UNIT_BASIS.DECLARED_IN_PAYLOAD;
    } else if (distinct.length === 0) {
      basis = N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_NO_DECLARED_UNIT;
      ctx.anomaly('throughputUnit', 'NO_DECLARED_UNIT_IN_FV68', null);
    } else {
      basis = N.THROUGHPUT_UNIT_BASIS.DECLARED_UNITS_DISAGREE;
      ctx.anomaly('throughputUnit', N.THROUGHPUT_UNIT_BASIS.DECLARED_UNITS_DISAGREE, distinct);
    }
  } else if (trimmed !== null && N.APP_VERSIONS_READ_AS_MIB_PER_S.includes(trimmed)) {
    unit = N.THROUGHPUT_UNIT_MIB_PER_S;
    basis = N.THROUGHPUT_UNIT_BASIS.APP_VERSION_RULE;
  } else if (trimmed === N.APP_VERSION_UNIT_UNDETERMINED) {
    basis = N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_APP_VERSION_V6BETA;
  } else if (trimmed === null) {
    basis = N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_NO_APP_VERSION;
  } else {
    basis = N.THROUGHPUT_UNIT_BASIS.UNDETERMINED_APP_VERSION_NOT_IN_RULE;
  }
  return {appVersion: trimmed, fieldsVersion: ctx.fieldsVersion, declared, unit, basis};
}

// ═══════════════════════════════════════════════════════════════════
// ٤) قوائم الحرارة (عقد ت-03 :446-455، ت-04 :457-466، س-35 :1044-1048)
// ═══════════════════════════════════════════════════════════════════
function readThermalLists(ctx) {
  const f = ctx.footer;
  const headroomState = stateCell(ctx, f, N.FOOTER.THERMAL_HEADROOM_STATE, N.VOCAB.THERMAL_HEADROOM_STATE, N.FOOTER.THERMAL_HEADROOM_STATE);
  const hrCell = cell(ctx, f, N.FOOTER.THERMAL_HEADROOM_READINGS, 'array', N.FOOTER.THERMAL_HEADROOM_READINGS);
  const readings = [];
  const byKind = {};
  let lastT = null;
  if (hrCell.status === N.KEY_STATUS.PRESENT) {
    hrCell.value.forEach((el, i) => {
      if (!isObj(el)) {
        ctx.anomaly(N.FOOTER.THERMAL_HEADROOM_READINGS, 'ELEMENT_NOT_OBJECT', {index: i});
        return;
      }
      const state = parseState(el[N.THERMAL_HEADROOM_ELEMENT.STATE], N.VOCAB.THERMAL_HEADROOM_READING);
      const kind = state === null ? N.READER_STATE.ABSENT : state.kind;
      byKind[kind] = (byKind[kind] || 0) + 1;
      const hasHeadroom = isFiniteNum(el[N.THERMAL_HEADROOM_ELEMENT.HEADROOM]);
      if (state !== null && !state.recognized) ctx.anomaly(N.FOOTER.THERMAL_HEADROOM_READINGS, 'UNRECOGNIZED_STATE', {index: i, raw: state.raw});
      if (kind === K.OK && !hasHeadroom) ctx.anomaly(N.FOOTER.THERMAL_HEADROOM_READINGS, 'OK_WITHOUT_VALUE', {index: i});
      if (kind !== K.OK && hasHeadroom) ctx.anomaly(N.FOOTER.THERMAL_HEADROOM_READINGS, 'VALUE_WITH_NON_OK_STATE', {index: i, kind});
      const t = Number.isInteger(el[N.THERMAL_HEADROOM_ELEMENT.T]) ? el[N.THERMAL_HEADROOM_ELEMENT.T] : null;
      if (t === null) ctx.anomaly(N.FOOTER.THERMAL_HEADROOM_READINGS, 'ELEMENT_WITHOUT_T', {index: i});
      if (t !== null && lastT !== null && t < lastT) ctx.anomaly(N.FOOTER.THERMAL_HEADROOM_READINGS, 'T_NOT_NON_DECREASING', {index: i});
      if (t !== null) lastT = t;
      readings.push({
        t,
        // قيمة headroom لا تُقرأ إلا مع state=ok (عقد :453: NaN لا يُكتب رقماً؛ الغياب مع حالته).
        headroom: kind === K.OK && hasHeadroom ? el[N.THERMAL_HEADROOM_ELEMENT.HEADROOM] : null,
        kind,
        detail: state === null ? null : state.detail,
      });
    });
  }
  const okValues = readings.filter((r) => r.kind === K.OK && r.headroom !== null).map((r) => r.headroom);

  const statusState = stateCell(ctx, f, N.FOOTER.THERMAL_STATUS_STATE, N.VOCAB.THERMAL_STATUS_STATE, N.FOOTER.THERMAL_STATUS_STATE);
  const evCell = cell(ctx, f, N.FOOTER.THERMAL_STATUS_EVENTS, 'array', N.FOOTER.THERMAL_STATUS_EVENTS);
  const events = [];
  let maxStatus = null;
  if (evCell.status === N.KEY_STATUS.PRESENT) {
    evCell.value.forEach((el, i) => {
      if (!isObj(el)) {
        ctx.anomaly(N.FOOTER.THERMAL_STATUS_EVENTS, 'ELEMENT_NOT_OBJECT', {index: i});
        return;
      }
      const status = el[N.THERMAL_STATUS_ELEMENT.STATUS];
      const valid = Number.isInteger(status) && status >= 0 && status <= 6; // NONE=0 … SHUTDOWN=6 (عقد :462)
      if (!valid) ctx.anomaly(N.FOOTER.THERMAL_STATUS_EVENTS, 'STATUS_OUT_OF_RANGE', {index: i, found: status === undefined ? 'missing' : typeOf(status)});
      const t = Number.isInteger(el[N.THERMAL_STATUS_ELEMENT.T]) ? el[N.THERMAL_STATUS_ELEMENT.T] : null;
      events.push({t, status: valid ? status : null});
      if (valid) maxStatus = maxStatus === null ? status : Math.max(maxStatus, status);
    });
  }

  return {
    headroom: {
      state: headroomState,
      readings: {status: hrCell.status, items: readings, byKind, okCount: okValues.length,
        okMin: okValues.length ? Math.min(...okValues) : null, okMax: okValues.length ? Math.max(...okValues) : null},
    },
    status: {
      state: statusState,
      events: {status: evCell.status, items: events, maxStatus},
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// ٥) سياسات المعالج (عقد ت-05 :468-478)
// ═══════════════════════════════════════════════════════════════════
function readCpuPolicies(ctx, layout) {
  const c = cell(ctx, ctx.footer, N.FOOTER.CPU_POLICIES, 'array', N.FOOTER.CPU_POLICIES);
  const policies = [];
  if (c.status === N.KEY_STATUS.PRESENT) {
    c.value.forEach((el, i) => {
      if (!isObj(el) || !Number.isInteger(el[N.CPU_POLICY_ELEMENT.POLICY])) {
        ctx.anomaly(N.FOOTER.CPU_POLICIES, 'ELEMENT_WITHOUT_POLICY', {index: i});
        return;
      }
      const max = el[N.CPU_POLICY_ELEMENT.CPUINFO_MAX_FREQ_KHZ];
      const reason = el[N.CPU_POLICY_ELEMENT.UNREADABLE_REASON];
      let maxFreq;
      if (isFiniteNum(max)) {
        maxFreq = {state: 'READ', valueKhz: max, reason: null};
        if (isStr(reason)) ctx.anomaly(N.FOOTER.CPU_POLICIES, 'VALUE_WITH_UNREADABLE_REASON', {policy: el[N.CPU_POLICY_ELEMENT.POLICY]});
      } else if (isStr(reason)) {
        // «يحمل unreadableReason سبب غياب relatedCpus أيضاً» (عقد §٧ بند 4 :1094) — فالسبب لا يخصّ cpuinfoMaxFreqKhz وحده.
        maxFreq = {state: 'UNREADABLE', valueKhz: null, reason};
      } else {
        maxFreq = {state: 'ABSENT_WITHOUT_REASON', valueKhz: null, reason: null};
        ctx.anomaly(N.FOOTER.CPU_POLICIES, 'MAX_FREQ_ABSENT_WITHOUT_REASON', {policy: el[N.CPU_POLICY_ELEMENT.POLICY]});
      }
      policies.push({
        policy: el[N.CPU_POLICY_ELEMENT.POLICY],
        relatedCpus: strOrNull(el[N.CPU_POLICY_ELEMENT.RELATED_CPUS]),
        maxFreq,
      });
    });
  }
  const channelPolicies = layout.policyChannels.map((p) => p.policy);
  const listed = policies.map((p) => p.policy);
  return {
    status: c.status,
    policies,
    // قناة بلا عنصر في cpuPolicies (تخطيط لا يطابق التذييل) وعنصر بلا قناة (سياسة محجوبة: لا تُدرج، عقد :425).
    channelsWithoutPolicyEntry: channelPolicies.filter((p) => !listed.includes(p)),
    policiesWithoutChannel: listed.filter((p) => !channelPolicies.includes(p)),
  };
}

// ═══════════════════════════════════════════════════════════════════
// ٦) أزواج البطارية الخامّ (عقد ت-06 :492-503؛ س-28 :1003-1006)
// ═══════════════════════════════════════════════════════════════════
// الوحدة لا تُستنتج هنا: voltageRaw/levelRaw/levelScale خام بلا قسمة (س-28 المصحَّح)، و«الخادم يستنتج الوحدة»
// قرار لاحق لم يُحدَّد له شرط في العقد (القاعدة 13) — يُسلَّم الخام مع حالته.
function readBatteryPairs(ctx) {
  const f = ctx.footer;
  const stateCellRaw = cell(ctx, f, N.FOOTER.BATTERY_PAIRS_STATE, 'object', N.FOOTER.BATTERY_PAIRS_STATE);
  const pairsCell = cell(ctx, f, N.FOOTER.BATTERY_PAIRS, 'array', N.FOOTER.BATTERY_PAIRS);
  const S = N.BATTERY_PAIRS_STATE;
  let state = null;
  if (stateCellRaw.status === N.KEY_STATUS.PRESENT) {
    const o = stateCellRaw.value;
    const registered = typeof o[S.RECEIVER_REGISTERED] === 'boolean' ? o[S.RECEIVER_REGISTERED] : null;
    const broadcastCount = Number.isInteger(o[S.BROADCAST_COUNT]) ? o[S.BROADCAST_COUNT] : null;
    const droppedByCap = Number.isInteger(o[S.DROPPED_BY_CAP]) ? o[S.DROPPED_BY_CAP] : null;
    const invalidReads = Number.isInteger(o[S.INVALID_READS]) ? o[S.INVALID_READS] : null;
    for (const [k, v] of [[S.RECEIVER_REGISTERED, registered], [S.BROADCAST_COUNT, broadcastCount],
      [S.DROPPED_BY_CAP, droppedByCap], [S.INVALID_READS, invalidReads]]) {
      if (v === null) ctx.anomaly(N.FOOTER.BATTERY_PAIRS_STATE, 'MEMBER_ABSENT_OR_WRONG_TYPE', {member: k});
    }
    // ثلاث حالات صريحة للغياب (عقد :499): المستقبِل لم يُسجَّل / سُجّل ولم يصل بثّ / وصل n بثّاً.
    let kind;
    if (registered === false) kind = 'RECEIVER_NOT_REGISTERED';
    else if (registered === true && broadcastCount === 0) kind = 'NO_BROADCAST_RECEIVED';
    else if (registered === true && broadcastCount !== null && broadcastCount > 0) kind = 'BROADCASTS_RECEIVED';
    else kind = N.READER_STATE.UNRECOGNIZED;
    state = {kind, receiverRegistered: registered, broadcastCount, droppedByCap, invalidReads};
  }
  const items = [];
  if (pairsCell.status === N.KEY_STATUS.PRESENT) {
    pairsCell.value.forEach((el, i) => {
      if (!isObj(el)) {
        ctx.anomaly(N.FOOTER.BATTERY_PAIRS, 'ELEMENT_NOT_OBJECT', {index: i});
        return;
      }
      const E = N.BATTERY_PAIR_ELEMENT;
      // حقل غير صالح يُحذف من العنصر ويُعدّ في invalidReads (عقد :500) — فالغائب هنا غائب لا صفر.
      items.push({
        t: Number.isInteger(el[E.T]) ? el[E.T] : null,
        voltageRaw: numOrNull(el[E.VOLTAGE_RAW]),
        currentRaw: numOrNull(el[E.CURRENT_RAW]),
        chargeCounterRaw: numOrNull(el[E.CHARGE_COUNTER_RAW]),
        levelRaw: numOrNull(el[E.LEVEL_RAW]),
        levelScale: numOrNull(el[E.LEVEL_SCALE]),
        tempRaw: numOrNull(el[E.TEMP_RAW]),
      });
    });
  }
  if (pairsCell.status === N.KEY_STATUS.PRESENT && state !== null && state.broadcastCount !== null && state.droppedByCap !== null) {
    // المحفوظ أوّل 200 (عقد :499): البثّات = المحفوظ + ما أُسقط بالسقف.
    if (items.length + state.droppedByCap !== state.broadcastCount) {
      ctx.anomaly(N.FOOTER.BATTERY_PAIRS, 'COUNTS_DO_NOT_ADD_UP', {kept: items.length, droppedByCap: state.droppedByCap, broadcastCount: state.broadcastCount});
    }
  }
  if (items.length > N.BATTERY_PAIRS_CAP) ctx.anomaly(N.FOOTER.BATTERY_PAIRS, 'OVER_CAP', {kept: items.length, cap: N.BATTERY_PAIRS_CAP});
  return {state: {status: stateCellRaw.status, ...(state === null ? {} : state)}, pairs: {status: pairsCell.status, items}};
}

// ═══════════════════════════════════════════════════════════════════
// ٧) batteryHealth: حالات المؤشّرات والدورات والعدّادات (عقد ت-02 :433-444، ت-18 :651-652، §٧-ز)
// ═══════════════════════════════════════════════════════════════════
function readBatteryHealth(ctx) {
  const bh = ctx.footer[N.FOOTER.BATTERY_HEALTH];
  const base = N.FOOTER.BATTERY_HEALTH;
  const B = N.BATTERY_HEALTH;
  if (!isObj(bh)) {
    return {status: absentStatus(ctx, base), indicators: {}, cycleCount: null, chargeCounter: null, energyCounter: null, designCapacityMah: null};
  }
  const out = {status: N.KEY_STATUS.PRESENT, indicators: {}};
  // قيمة تغيب حين لا تُحسب، ومفتاح الحالة حاضر (عقد :651). صفر «غير محسوب» لم يعد يظهر.
  for (const [valueKey, stateKey] of Object.entries(B.INDICATORS)) {
    const value = cell(ctx, bh, valueKey, 'number', `${base}.${valueKey}`);
    const state = stateCell(ctx, bh, stateKey, N.VOCAB.BATTERY_INDICATOR_STATE, `${base}.${stateKey}`);
    if (state.state !== null && state.state.kind === K.COMPUTED && value.status !== N.KEY_STATUS.PRESENT) {
      ctx.anomaly(`${base}.${valueKey}`, 'COMPUTED_WITHOUT_VALUE', null);
    }
    if (state.state !== null && state.state.kind === K.NOT_COMPUTED && value.status === N.KEY_STATUS.PRESENT) {
      ctx.anomaly(`${base}.${valueKey}`, 'VALUE_WITH_NOT_COMPUTED_STATE', null);
    }
    out.indicators[valueKey] = {
      value: value.value,
      valueStatus: declaredIf(value.status, kindIn(state.state, [K.NOT_COMPUTED])),
      state: state.state,
      stateStatus: state.status,
    };
  }
  const readBlock = (valueKey, stateKey, vocab, extra) => {
    const value = cell(ctx, bh, valueKey, 'number', `${base}.${valueKey}`);
    const state = stateCell(ctx, bh, stateKey, vocab, `${base}.${stateKey}`);
    if (state.state !== null && state.state.kind === K.READ && value.status !== N.KEY_STATUS.PRESENT) {
      ctx.anomaly(`${base}.${valueKey}`, 'READ_WITHOUT_VALUE', null);
    }
    if (state.state !== null && state.state.kind === K.NOT_READ && value.status === N.KEY_STATUS.PRESENT) {
      ctx.anomaly(`${base}.${valueKey}`, 'VALUE_WITH_NOT_READ_STATE', null);
    }
    return {
      value: value.value,
      valueStatus: declaredIf(value.status, kindIn(state.state, [K.NOT_READ])),
      state: state.state,
      stateStatus: state.status,
      ...extra,
    };
  };
  // مصدر الدورات: extra_api34 · sysfs:<path> · unavailable (عقد :1396)؛ الصفر يُشحن كما قُرئ (عقد :1395).
  const srcCell = cell(ctx, bh, B.CYCLE_COUNT_SOURCE, 'string', `${base}.${B.CYCLE_COUNT_SOURCE}`);
  const src = srcCell.status === N.KEY_STATUS.PRESENT ? parseState(srcCell.value, N.VOCAB.CYCLE_COUNT_SOURCE) : null;
  if (src !== null && !src.recognized) ctx.anomaly(`${base}.${B.CYCLE_COUNT_SOURCE}`, 'UNRECOGNIZED_STATE', {raw: src.raw});
  out.cycleCount = readBlock(B.CYCLE_COUNT, B.CYCLE_COUNT_STATE, N.VOCAB.CYCLE_COUNT_STATE, {source: src, sourceStatus: srcCell.status});
  out.chargeCounter = readBlock(B.CHARGE_COUNTER_UAH, B.CHARGE_COUNTER_UAH_STATE, N.VOCAB.CHARGE_COUNTER_UAH_STATE, {});
  out.energyCounter = readBlock(B.ENERGY_COUNTER_NWH, B.ENERGY_COUNTER_NWH_STATE, N.VOCAB.ENERGY_COUNTER_NWH_STATE, {});
  const dc = cell(ctx, bh, B.DESIGN_CAPACITY_MAH, 'number', `${base}.${B.DESIGN_CAPACITY_MAH}`);
  out.designCapacityMah = {value: dc.value, status: dc.status};
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// ٨) حرارة المعالج النهائية (عقد ت-10 :517-526؛ س-33 :1032-1036)
// ═══════════════════════════════════════════════════════════════════
function readCpuTemp(ctx) {
  const f = ctx.footer;
  const value = cell(ctx, f, N.FOOTER.CPU_TEMP_FINAL_C, 'number', N.FOOTER.CPU_TEMP_FINAL_C);
  const source = stateCell(ctx, f, N.FOOTER.CPU_TEMP_FINAL_SOURCE, N.VOCAB.CPU_TEMP_FINAL_SOURCE, N.FOOTER.CPU_TEMP_FINAL_SOURCE);
  const kind = source.state === null ? null : source.state.kind;
  if (kind === K.ABSENT && value.status === N.KEY_STATUS.PRESENT) ctx.anomaly(N.FOOTER.CPU_TEMP_FINAL_C, 'VALUE_WITH_ABSENT_SOURCE', null);
  if ((kind === K.LIVE_READ_AT_FINALIZE || kind === K.SAMPLER_MAX_CPU) && value.status !== N.KEY_STATUS.PRESENT) {
    ctx.anomaly(N.FOOTER.CPU_TEMP_FINAL_C, 'SOURCE_WITHOUT_VALUE', {kind});
  }
  // الحقل القديم يغادر في ≥ 68 (عقد ت-10 :524)؛ يبقى مقروءاً في ≤ 67 (findings.js يقرؤه هناك).
  const legacy = removedCell(ctx, f, N.FOOTER.MAX_CPU_TEMP_LEGACY, 'number', N.FOOTER.MAX_CPU_TEMP_LEGACY);
  if (ctx.applicable && legacy.status === N.KEY_STATUS.PRESENT) ctx.anomaly(N.FOOTER.MAX_CPU_TEMP_LEGACY, 'LEGACY_KEY_PRESENT_IN_FV68', null);
  let state;
  if (kind === K.LIVE_READ_AT_FINALIZE) state = N.CPU_TEMP_STATE.LIVE_READ_AT_FINALIZE;
  else if (kind === K.SAMPLER_MAX_CPU) state = N.CPU_TEMP_STATE.SAMPLER_MAX_CPU;
  else if (kind === K.ABSENT) state = N.CPU_TEMP_STATE.ABSENT_DECLARED;
  else if (source.status === N.KEY_STATUS.PRESENT) state = N.READER_STATE.UNRECOGNIZED;
  else state = N.READER_STATE.ABSENT;
  return {
    state,
    valueC: kind === K.ABSENT ? null : value.value,
    valueStatus: declaredIf(value.status, kind === K.ABSENT),
    source: source.state,
    sourceStatus: source.status,
    legacyMaxCpuTemp: {status: legacy.status, value: legacy.value},
  };
}

// ═══════════════════════════════════════════════════════════════════
// ٩) verificationResults (عقد ت-13 :552-558، ت-16 :605-619، ت-17 :621-635، ت-18 :637-657، ت-20 :675-684)
// ═══════════════════════════════════════════════════════════════════
const VR_BASE = N.FOOTER.VERIFICATION_RESULTS;

function readVerification(ctx) {
  const vr = ctx.footer[VR_BASE];
  const V = N.VERIFICATION;
  const vrPresent = isObj(vr);
  const c = (key, type) => cell(ctx, vrPresent ? vr : null, key, type, `${VR_BASE}.${key}`);
  const s = (key, vocab) => stateCell(ctx, vrPresent ? vr : null, key, vocab, `${VR_BASE}.${key}`);
  const r = (key, type) => removedCell(ctx, vrPresent ? vr : null, key, type, `${VR_BASE}.${key}`);

  // ── GPU والعيب الحرج: Boolean? يغيب حين لم تُنفَّذ المرحلة (ت-18 صفّان 1-2) ──
  const gemmCorrect = c(V.GPU_COMPUTE_GEMM_CORRECT, 'boolean');
  const gemmState = s(V.GPU_COMPUTE_GEMM_STATE, N.VOCAB.GPU_COMPUTE_GEMM_STATE);
  const gk = gemmState.state === null ? null : gemmState.state.kind;
  if ((gk === K.PASSED && gemmCorrect.value !== true) || (gk === K.FAILED && gemmCorrect.value !== false) ||
      (gk === K.NOT_RUN && gemmCorrect.status === N.KEY_STATUS.PRESENT)) {
    ctx.anomaly(`${VR_BASE}.${V.GPU_COMPUTE_GEMM_STATE}`, 'STATE_DISAGREES_WITH_VALUE', {state: gk, correct: gemmCorrect.value});
  }
  // تجزئة الشظايا ومهلة السياج (S-B5a، 2026-10-21): تُقرأ بحالتها كما هي. عقد fv68 :249 و:261: «0 من 0» و«0 مهلة» يظهران أيضاً حين لم تُنفَّذ المرحلة — فالصفر لا يُقرأ سلامةً هنا؛
  // الحكم (advisoryLetters.js: بوّابة GPU_HASH_MISMATCH وحرف الرسوميات) يشترط total > 0 ويعلن ما غاب. عدّ سالب أو مطابقات فوق المجموع شذوذ يُعلَن لا يُصحَّح.
  const hashMatches = c(V.GPU_FRAGMENT_HASH_MATCHES, 'int');
  const hashTotal = c(V.GPU_FRAGMENT_HASH_TOTAL, 'int');
  const fenceTimeouts = c(V.GPU_FENCE_TIMEOUT_COUNT, 'int');
  if (hashMatches.value !== null && hashTotal.value !== null && hashMatches.value > hashTotal.value) {
    ctx.anomaly(`${VR_BASE}.${V.GPU_FRAGMENT_HASH_MATCHES}`, 'MATCHES_EXCEED_TOTAL', {matches: hashMatches.value, total: hashTotal.value});
  }
  for (const [key, cellRead] of [[V.GPU_FRAGMENT_HASH_MATCHES, hashMatches], [V.GPU_FRAGMENT_HASH_TOTAL, hashTotal], [V.GPU_FENCE_TIMEOUT_COUNT, fenceTimeouts]]) {
    if (cellRead.value !== null && cellRead.value < 0) ctx.anomaly(`${VR_BASE}.${key}`, 'NEGATIVE_COUNT', {found: cellRead.value});
  }
  const defect = c(V.CRITICAL_DEFECT_DETECTED, 'boolean');
  const inputs = c(V.CRITICAL_DEFECT_INPUTS_NOT_RUN, 'array');
  const inputsNotRun = inputs.status === N.KEY_STATUS.PRESENT ? inputs.value.filter(isStr) : null;
  if (defect.status !== N.KEY_STATUS.PRESENT && inputs.status === N.KEY_STATUS.PRESENT && inputsNotRun.length === 0) {
    ctx.anomaly(`${VR_BASE}.${V.CRITICAL_DEFECT_DETECTED}`, 'ABSENT_WITH_EMPTY_INPUTS_NOT_RUN', null);
  }

  // ── تثبيت العمّال ──
  const pinState = s(V.WORKERS_PIN_STATE, N.VOCAB.WORKERS_PIN_STATE);
  const pinned = {};
  const pinFailed = {};
  V.WORKERS_PINNED.forEach((k) => { pinned[k] = c(k, 'int').value; });
  V.WORKERS_PIN_FAILED.forEach((k) => { pinFailed[k] = c(k, 'int').value; });
  const pk = pinState.state === null ? null : pinState.state.kind;
  const anyPinValue = Object.values(pinned).concat(Object.values(pinFailed)).some((x) => x !== null);
  if (pk !== null && pk !== K.ATTEMPTED && anyPinValue) ctx.anomaly(`${VR_BASE}.${V.WORKERS_PIN_STATE}`, 'COUNTERS_WITH_NOT_ATTEMPTED_STATE', {kind: pk});

  // ── الذاكرة: العدد الخامّ يُشحن والخادم يشتقّ …Passed (س-30 :1014-1018) ──
  const memState = s(V.MEMORY_VERIFY_STATE, N.VOCAB.MEMORY_VERIFY_STATE);
  const mk = memState.state === null ? null : memState.state.kind;
  const march = c(V.MEMORY_MARCH_ERRORS, 'int');
  const walking = c(V.MEMORY_WALKING_ONES_ERRORS, 'int');
  const random = c(V.MEMORY_RANDOM_VERIFY_ERRORS, 'int');
  const memCounters = [march, walking, random];
  if (mk === K.NOT_RUN && memCounters.some((x) => x.status === N.KEY_STATUS.PRESENT)) {
    ctx.anomaly(`${VR_BASE}.${V.MEMORY_VERIFY_STATE}`, 'COUNTERS_WITH_NOT_RUN_STATE', null);
  }
  const verifiedBytes = c(V.MEMORY_VERIFY_BYTES, 'number');
  const bufferBytes = c(V.MEMORY_VERIFY_BUFFER_BYTES, 'number');
  if (mk === K.PARTIAL && verifiedBytes.status === N.KEY_STATUS.PRESENT && bufferBytes.status === N.KEY_STATUS.PRESENT &&
      verifiedBytes.value >= bufferBytes.value) {
    ctx.anomaly(`${VR_BASE}.${V.MEMORY_VERIFY_STATE}`, 'PARTIAL_WITH_FULL_COVERAGE', null);
  }
  // …Passed (اسم خادم): خطأ موجب ⇒ false في أيّ حالة جرى فيها العدّ (الخطأ المرصود حقيقي)؛ صفر أخطاء ⇒ true مع ran وحدها؛
  // صفر على partial لا يُقرأ نجاحاً (لم يُغطَّ كل المخزن)؛ غير ذلك ⇒ null (غير مشتقّ).
  const derivePassed = (errors) => {
    if (errors.status !== N.KEY_STATUS.PRESENT) return null;
    if (errors.value > 0) return false;
    return mk === K.RAN ? true : null;
  };
  const phaseWindows = [];
  const pwCell = c(V.MEMORY_PHASE_WINDOWS, 'array');
  if (pwCell.status === N.KEY_STATUS.PRESENT) {
    pwCell.value.forEach((el, i) => {
      const W = N.MEMORY_PHASE_WINDOW_ELEMENT;
      if (!isObj(el) || !isStr(el[W.NAME]) || !Number.isInteger(el[W.START_MS]) || !Number.isInteger(el[W.END_MS])) {
        ctx.anomaly(`${VR_BASE}.${V.MEMORY_PHASE_WINDOWS}`, 'ELEMENT_MALFORMED', {index: i});
        return;
      }
      phaseWindows.push({name: el[W.NAME], startMs: el[W.START_MS], endMs: el[W.END_MS]});
    });
  }
  const memory = {
    state: memState,
    errors: {march: march.value, walkingOnes: walking.value, randomVerify: random.value},
    derived: {marchPassed: derivePassed(march), walkingOnesPassed: derivePassed(walking)},
    bytes: {
      verified: verifiedBytes.value,
      buffer: bufferBytes.value,
      freeBytes: c(V.MEMORY_VERIFY_FREE_BYTES, 'number').value,
      testedByWorkload: c(V.MEMORY_TESTED_BYTES, 'number').value,
    },
    timeCapMs: c(V.MEMORY_VERIFY_TIME_CAP_MS, 'number').value,
    durationMs: c(V.MEMORY_VERIFY_DURATION_MS, 'number').value,
    phaseWindows: {status: pwCell.status, items: phaseWindows},
  };

  // ── التخزين: الكتابة تُشحن متى جرت (قرار 2-ج بند 4 :1245)، والقراءة الراجعة مع ran/partial ──
  const stState = s(V.STORAGE_VERIFY_STATE, N.VOCAB.STORAGE_VERIFY_STATE);
  const sk = stState.state === null ? null : stState.state.kind;
  const stMethod = s(V.STORAGE_VERIFY_METHOD, N.VOCAB.STORAGE_VERIFY_METHOD);
  const writeErr = c(V.STORAGE_WRITE_VERIFY_ERRORS, 'int');
  const readErr = c(V.STORAGE_READ_VERIFY_ERRORS, 'int');
  // «الصفر مقيس حقيقي فقط مع storageVerifyState = ran» (عقد :615): عدّاد القراءة بلا ran/partial مخالفة معلنة.
  if (readErr.status === N.KEY_STATUS.PRESENT && sk !== null && sk !== K.RAN && sk !== K.PARTIAL) {
    ctx.anomaly(`${VR_BASE}.${V.STORAGE_READ_VERIFY_ERRORS}`, 'READ_ERRORS_WITH_NON_RAN_STATE', {kind: sk});
  }
  const storage = {
    state: stState,
    method: stMethod,
    errors: {write: writeErr.value, read: readErr.value},
    // كُتب الملفّ ⇒ عدّاد الكتابة حاضر؛ وغيابه مع ran مخالفة.
    writeErrorsStatus: declaredIf(writeErr.status, sk === K.NOT_RUN),
    readErrorsStatus: declaredIf(readErr.status, sk === K.NOT_RUN),
    bytes: {compared: c(V.STORAGE_VERIFY_BYTES_COMPARED, 'number').value, planned: c(V.STORAGE_VERIFY_BYTES_PLANNED, 'number').value},
    durationMs: c(V.STORAGE_VERIFY_DURATION_MS, 'number').value,
  };
  if (sk === K.RAN && (readErr.status !== N.KEY_STATUS.PRESENT || writeErr.status !== N.KEY_STATUS.PRESENT)) {
    ctx.anomaly(`${VR_BASE}.${V.STORAGE_VERIFY_STATE}`, 'RAN_WITHOUT_ERROR_COUNTERS', {write: writeErr.status, read: readErr.status});
  }

  // ── معالج: نتيجة معروفة مسبقاً (ت-20) ──
  const cpuState = s(V.CPU_KNOWN_ANSWER_STATE, N.VOCAB.CPU_KNOWN_ANSWER_STATE);
  const runsCell = c(V.CPU_KNOWN_ANSWER_RUNS, 'array');
  const totalCell = c(V.CPU_KNOWN_ANSWER_TOTAL_MS_BY_PHASE, 'object');
  const cpuKnown = readCpuKnownAnswer(ctx, cpuState, runsCell, totalCell);

  // ── مندوب الذكاء: لا خطأ يُقرأ من aiActiveDelegate لا من سلسلة فارغة (ت-18 صفّ 12 :654) ──
  const delegate = c(V.AI_ACTIVE_DELEGATE, 'string');
  const initErr = c(V.AI_DELEGATE_INIT_ERROR, 'string');
  const aiDelegate = {
    delegate: delegate.value,
    delegateStatus: delegate.status,
    initErrorText: initErr.value,
    initErrorStatus: declaredIf(initErr.status, delegate.status === N.KEY_STATUS.PRESENT),
    // «لا خطأ» يُعلَن فقط حين يحضر المندوب ويغيب الخطأ؛ بلا مندوب لا حكم.
    noInitErrorDeclared: delegate.status === N.KEY_STATUS.PRESENT && initErr.status !== N.KEY_STATUS.PRESENT,
  };

  // ── مفاتيح قديمة: تُقرأ إن وصلت (حمولات أقدم)، وغيابها يُعلَن غياباً لا صفراً ولا نجاحاً ──
  const legacy = {
    cpuFmaErrors: r(V.CPU_FMA_ERRORS_LEGACY, 'number'),
    cpuPrimeSieveCorrect: r(V.CPU_PRIME_SIEVE_CORRECT_LEGACY, 'boolean'),
    memoryMarchPassed: r(V.MEMORY_MARCH_PASSED_LEGACY, 'boolean'),
    memoryWalkingOnesPassed: r(V.MEMORY_WALKING_ONES_PASSED_LEGACY, 'boolean'),
  };
  const removed = r(V.STORAGE_SLC_CACHE_SIZE_MB_REMOVED, 'number');
  if (ctx.applicable && removed.status === N.KEY_STATUS.PRESENT) {
    ctx.anomaly(`${VR_BASE}.${V.STORAGE_SLC_CACHE_SIZE_MB_REMOVED}`, 'REMOVED_KEY_PRESENT_IN_FV68', null);
  }
  const unitSeg = c(V.STORAGE_THROUGHPUT_SEGMENTS_UNIT, 'string');

  return {
    status: vrPresent ? N.KEY_STATUS.PRESENT : absentStatus(ctx, VR_BASE),
    gpuGemm: {correct: gemmCorrect.value, correctStatus: declaredIf(gemmCorrect.status, gk === K.NOT_RUN), state: gemmState},
    gpuFragmentHash: {matches: hashMatches.value, total: hashTotal.value, matchesStatus: hashMatches.status, totalStatus: hashTotal.status},
    gpuFenceTimeout: {count: fenceTimeouts.value, status: fenceTimeouts.status},
    criticalDefect: {
      value: defect.value,
      valueStatus: declaredIf(defect.status, inputsNotRun !== null && inputsNotRun.length > 0),
      inputsNotRun,
      inputsNotRunStatus: inputs.status,
    },
    workersPin: {state: pinState, pinned, failed: pinFailed},
    memory,
    storage,
    cpuKnownAnswer: cpuKnown,
    aiDelegate,
    legacy: Object.fromEntries(Object.entries(legacy).map(([k, x]) => [k, {status: x.status, value: x.value}])),
    storageSlcCacheSizeMbStatus: removed.status,
    storageThroughputSegmentsUnit: {status: unitSeg.status, value: unitSeg.value},
  };
}

function readCpuKnownAnswer(ctx, state, runsCell, totalCell) {
  const R = N.CPU_KNOWN_ANSWER_RUN_ELEMENT;
  const base = `${VR_BASE}.${N.VERIFICATION.CPU_KNOWN_ANSWER_RUNS}`;
  const runs = [];
  const counts = {
    runs: 0, sieveMatch: 0, sieveMismatch: 0, sieveNotReached: 0, sieveSkipped: 0, sieveCancelled: 0, sieveError: 0,
    shaMatch: 0, shaMismatch: 0, shaNotReached: 0, shaSkipped: 0, shaCancelled: 0, shaError: 0, unrecognized: 0,
  };
  const classify = (status, which) => {
    const kind = status === null ? null : status.kind;
    if (kind === K.MATCH) counts[`${which}Match`]++;
    else if (kind === K.MISMATCH) counts[`${which}Mismatch`]++;
    else if (kind === K.NOT_REACHED) counts[`${which}NotReached`]++;
    else if (kind === K.SKIPPED_TIME_BUDGET) counts[`${which}Skipped`]++; // fv70: متروك لضيق الوقت — لا نجاح ولا فشل ولا صفر، ولا يدخل عدّاد عدم التطابق
    else if (kind === K.CANCELLED) counts[`${which}Cancelled`]++; // بدأ وقطعته المرحلة: ليس من EXECUTED_STATUSES — لا نجاح ولا فشل ولا عدم تطابق، ولا يُحسب «خطأ» (لا يُخلَط بـnative_*)
    else if (kind === N.READER_STATE.UNRECOGNIZED || kind === null) counts.unrecognized++;
    else counts[`${which}Error`]++; // native_* و self_test_failed و alloc_failed: لا يُحكم على الجهاز منها (لم يجرِ الفحص)
  };
  // الغربال الذي يُنتظَر معه sieveLimit (§٧-ط): N.SIEVE_STATUS_KINDS_CARRYING_LIMIT (match وmismatch وalloc_failed وnative_status_unknown:*). ويغيب مع native_call_failed وnative_result_unreadable وnot_reached وskipped:time_budget وcancelled.
  const shipsSieveLimit = (sieve) => sieve !== null && N.SIEVE_STATUS_KINDS_CARRYING_LIMIT.includes(sieve.kind);
  const REFERENCE = N.SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT;
  const fv = ctx.fieldsVersion; // باسم fv ليلتقط حارسُ العتبات الساكن (test/fieldsVersionThresholds.test.js) كل مقارنة إصدار هنا
  if (runsCell.status === N.KEY_STATUS.PRESENT) {
    runsCell.value.forEach((el, i) => {
      if (!isObj(el)) {
        ctx.anomaly(base, 'ELEMENT_NOT_OBJECT', {index: i});
        return;
      }
      const sieve = parseState(el[R.SIEVE_STATUS], N.VOCAB.CPU_KNOWN_ANSWER_SIEVE_STATUS);
      const sha = parseState(el[R.SHA256_STATUS], N.VOCAB.CPU_KNOWN_ANSWER_SHA256_STATUS);
      if (sieve === null || !sieve.recognized) ctx.anomaly(base, 'UNRECOGNIZED_STATE', {index: i, field: R.SIEVE_STATUS, raw: sieve === null ? null : sieve.raw});
      if (sha === null || !sha.recognized) ctx.anomaly(base, 'UNRECOGNIZED_STATE', {index: i, field: R.SHA256_STATUS, raw: sha === null ? null : sha.raw});
      counts.runs++;
      classify(sieve, 'sieve');
      classify(sha, 'sha');
      const t = Number.isInteger(el[R.T]) ? el[R.T] : null;
      const tEnd = Number.isInteger(el[R.T_END]) ? el[R.T_END] : null;
      // التشغيل not_reached بلا t ولا tEnd: غياب لا صفر (عقد :1252).
      if (sieve !== null && sieve.kind === K.NOT_REACHED && (t !== null || tEnd !== null)) ctx.anomaly(base, 'NOT_REACHED_WITH_TIMES', {index: i});
      if (t !== null && tEnd !== null && tEnd < t) ctx.anomaly(base, 'T_END_BEFORE_T', {index: i});
      const primeCount = numOrNull(el[R.SIEVE_PRIME_COUNT]);
      const sieveDurationMs = numOrNull(el[R.SIEVE_DURATION_MS]);
      const shaDurationMs = numOrNull(el[R.SHA256_DURATION_MS]);
      // ─── fv70 (§٧-ط) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
      // المتروك: بلا t ولا tEnd ولا عدد ولا زمن ولا sieveLimit (غياب لا صفر). يُعلَن شذوذاً إن حمل شيئاً منها.
      const sieveSkipped = sieve !== null && sieve.kind === K.SKIPPED_TIME_BUDGET;
      const shaSkipped = sha !== null && sha.kind === K.SKIPPED_TIME_BUDGET;
      const limitCell = cell(ctx, el, R.SIEVE_LIMIT, 'int', `${base}[${i}].${R.SIEVE_LIMIT}`);
      if ((sieveSkipped && (primeCount !== null || sieveDurationMs !== null || limitCell.status === N.KEY_STATUS.PRESENT)) ||
          (shaSkipped && shaDurationMs !== null) || (sieveSkipped && shaSkipped && (t !== null || tEnd !== null))) {
        ctx.anomaly(base, 'SKIPPED_WITH_VALUES', {index: i});
      }
      // cancelled في الغربال: sieveLimit غائب دائماً (عند إلغاء الغربال sieveStatus = got?.status ?: cancelled وsieveLimit = got?.limit وgot فارغ: CpuKnownAnswerScheduler.kt:147-158 عند NeuralChek@450d9ed —
      // المصدر الكود لا العقد؛ منقول من أمر المنسّق، غير متحقَّق). فغيابه معه معلوم بالتصميم (لا SIEVE_LIMIT_ABSENT)، وحضوره معه شذوذ. وإلغاء SHA وحده لا يمسّ الغربال: حالته وN كما أبلغهما.
      if (sieve !== null && sieve.kind === K.CANCELLED && limitCell.status === N.KEY_STATUS.PRESENT) ctx.anomaly(base, 'CANCELLED_WITH_SIEVE_LIMIT', {index: i});
      // N والمرجع π(N) **بحسب sieveLimit لا بثابت**. الغياب: ختم 68 و69 ⟵ N = SIEVE_LIMIT_WHEN_ABSENT_FV68_69 (§٧-ط)؛ ختم ≥ 70 ⟵ شذوذ إن كان الغربال ممّا يُشحن معه (لا N مفترَض)؛
      // ختم أقدم أو مجهول ⟵ لا N ولا مرجع (لا يُخمَّن). ما لا يُشحن معه بالتصميم (متروك، not_reached، native_*) ⟵ لا N ولا شذوذ.
      let limit;
      let limitBasis;
      if (limitCell.status === N.KEY_STATUS.PRESENT) {
        limit = limitCell.value;
        limitBasis = 'SHIPPED';
      } else if (limitCell.status === N.KEY_STATUS.WRONG_TYPE) {
        limit = null;
        limitBasis = 'WRONG_TYPE';
      } else if (!shipsSieveLimit(sieve)) {
        limit = null;
        limitBasis = 'NOT_SHIPPED_BY_DESIGN';
      } else if (fv !== null && fv >= N.FIELDS_VERSION_70) {
        limit = null;
        limitBasis = 'ABSENT_IN_FV70';
        ctx.anomaly(base, 'SIEVE_LIMIT_ABSENT', {index: i});
      } else if (fv !== null && fv >= N.FIELDS_VERSION_68) {
        limit = N.SIEVE_LIMIT_WHEN_ABSENT_FV68_69;
        limitBasis = 'LEGACY_FV68_69_DEFAULT';
      } else {
        limit = null;
        limitBasis = 'FIELDS_VERSION_BEFORE_68_OR_UNKNOWN';
      }
      const referencePrimeCount = limit !== null && Object.prototype.hasOwnProperty.call(REFERENCE, limit) ? REFERENCE[limit] : null;
      // مقارنة العدد الخامّ بمرجع N نفسه — **معلومة لا حكم** (الحكم حالة التطبيق match/mismatch): غير القابل للمقارنة يُسمَّى بسببه.
      let primeCountVsReference;
      if (primeCount === null) primeCountVsReference = 'NOT_COMPARABLE:NO_PRIME_COUNT';
      else if (limit === null) primeCountVsReference = 'NOT_COMPARABLE:NO_SIEVE_LIMIT';
      else if (referencePrimeCount === null) primeCountVsReference = 'NOT_COMPARABLE:LIMIT_NOT_IN_REFERENCE_TABLE';
      else primeCountVsReference = primeCount === referencePrimeCount ? 'EQUAL' : 'DIFFERENT';
      if (sieve !== null && (sieve.kind === K.MATCH || sieve.kind === K.MISMATCH) &&
          ((sieve.kind === K.MATCH && primeCountVsReference === 'DIFFERENT') || (sieve.kind === K.MISMATCH && primeCountVsReference === 'EQUAL'))) {
        ctx.anomaly(base, 'PRIME_COUNT_DISAGREES_WITH_STATUS', {index: i, status: sieve.kind, primeCountVsReference});
      }
      runs.push({
        phase: Number.isInteger(el[R.PHASE]) ? el[R.PHASE] : null,
        plannedAtPct: numOrNull(el[R.PLANNED_AT_PCT]),
        t,
        tEnd,
        skipped: sieveSkipped || shaSkipped,
        sieve: {
          status: sieve, primeCount, durationMs: sieveDurationMs,
          limit: {value: limit, basis: limitBasis}, referencePrimeCount, primeCountVsReference, // (بلا مفتاح باسم status: غياب sieveLimit في fv68/69 بالتصميم، وbasis يقول لماذا؛ وغيابه المخالف يُعلَن شذوذاً SIEVE_LIMIT_ABSENT)
        },
        sha256: {status: sha, durationMs: shaDurationMs},
      });
    });
  }
  const k = state.state === null ? null : state.state.kind;
  const total = {};
  if (totalCell.status === N.KEY_STATUS.PRESENT) {
    for (const [phase, ms] of Object.entries(totalCell.value)) {
      if (isFiniteNum(ms)) total[phase] = ms;
      else ctx.anomaly(`${VR_BASE}.${N.VERIFICATION.CPU_KNOWN_ANSWER_TOTAL_MS_BY_PHASE}`, 'VALUE_NOT_NUMBER', {phase});
    }
  }
  if (k === K.NOT_RUN && runs.length > 0) ctx.anomaly(`${VR_BASE}.${N.VERIFICATION.CPU_KNOWN_ANSWER_STATE}`, 'RUNS_WITH_NOT_RUN_STATE', null);
  // fv70 (§٧-ط): `ran` يعني «بلا متروك» و`partial:time_budget` «أُبلغ نصف فحص واحد على الأقلّ وتُرك تشغيل». تناقض الحالة مع العناصر يُعلَن (القاعدة 25) ولا يُصحَّح بصمت.
  const skippedHalves = counts.sieveSkipped + counts.shaSkipped;
  if (k === K.RAN && skippedHalves > 0) ctx.anomaly(`${VR_BASE}.${N.VERIFICATION.CPU_KNOWN_ANSWER_STATE}`, 'RAN_WITH_SKIPPED_RUNS', {skippedHalves});
  if (k === K.PARTIAL_TIME_BUDGET && skippedHalves === 0) ctx.anomaly(`${VR_BASE}.${N.VERIFICATION.CPU_KNOWN_ANSWER_STATE}`, 'PARTIAL_WITHOUT_SKIPPED_RUNS', null);
  // عدد الفحوص المصنَّفة «عدم تطابق» (اسم خادم): null حين لم يجرِ فحص (غياب الحالة أو not_run) — لا صفر. **في `partial:time_budget` يُحسب على الأنصاف المُبلَّغة وحدها** (أُبلغ نصف على الأقلّ):
  // المتروك ليس عدم تطابق ولا تطابقاً (لا يدخل عدّاد أيّ منهما)، فالعدّاد فيه حقيقي لا مفقود (كان `=== K.RAN` وحده يُسقطه إلى null).
  const mismatches = (k === K.RAN || k === K.PARTIAL_TIME_BUDGET) ? counts.sieveMismatch + counts.shaMismatch : null;
  return {
    state,
    runs: {status: runsCell.status, items: runs},
    totalMsByPhase: {status: totalCell.status, byPhase: total},
    counts,
    mismatches,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ١٠) باقي الحالات: السكون، تحذيرات ما قبل الفحص، الاكتشاف، السلسلة الزمنية، المفاتيح الناقصة، تشخيص التذييل
// ═══════════════════════════════════════════════════════════════════
function readStillness(ctx) {
  const ss = ctx.footer[N.FOOTER.SCAN_STILLNESS];
  const base = N.FOOTER.SCAN_STILLNESS;
  if (!isObj(ss)) return {status: absentStatus(ctx, base), state: null, isStill: null, accelStdDev: null};
  const state = stateCell(ctx, ss, N.SCAN_STILLNESS.STILLNESS_STATE, N.VOCAB.STILLNESS_STATE, `${base}.${N.SCAN_STILLNESS.STILLNESS_STATE}`);
  const isStill = cell(ctx, ss, N.SCAN_STILLNESS.IS_STILL, 'boolean', `${base}.${N.SCAN_STILLNESS.IS_STILL}`);
  const std = cell(ctx, ss, N.SCAN_STILLNESS.ACCEL_STD_DEV, 'number', `${base}.${N.SCAN_STILLNESS.ACCEL_STD_DEV}`);
  const kind = state.state === null ? null : state.state.kind;
  // isStill/accelStdDev تصدقان مع measured وحدها (عقد ت-18 صفّ 6 :648): مع غيرها تُقرآن غائبتين لا «ثابت».
  const valid = kind === K.MEASURED;
  if (kind === K.INSUFFICIENT_ACCEL_SAMPLES && (isStill.status === N.KEY_STATUS.PRESENT || std.status === N.KEY_STATUS.PRESENT)) {
    ctx.anomaly(base, 'VALUES_WITH_INSUFFICIENT_SAMPLES', null);
  }
  return {
    status: N.KEY_STATUS.PRESENT,
    state: state.state,
    stateStatus: state.status,
    isStill: valid ? isStill.value : null,
    accelStdDev: valid ? std.value : null,
    sampleCount: numOrNull(ss[N.SCAN_STILLNESS.SAMPLE_COUNT]),
  };
}

function readPreScanWarnings(ctx) {
  const s = stateCell(ctx, ctx.footer, N.FOOTER.PRE_SCAN_WARNINGS_STATE, N.VOCAB.PRE_SCAN_WARNINGS_STATE, N.FOOTER.PRE_SCAN_WARNINGS_STATE);
  return {status: s.status, state: s.state};
}

// تصنيف الخادم لنصّ سبب القناة (القاعدة 21: بنصّه لا بصنف الاستثناء).
function classifyChannelReason(text) {
  if (!isStr(text)) return N.CHANNEL_REASON_KIND.OTHER;
  if (/EACCES|Permission denied/i.test(text)) return N.CHANNEL_REASON_KIND.BLOCKED_ACCESS_DENIED;
  if (/ENOENT|No such file or directory/i.test(text)) return N.CHANNEL_REASON_KIND.ABSENT_NO_SUCH_FILE;
  if (/Long\.MIN_VALUE|unsupported marker/i.test(text)) return N.CHANNEL_REASON_KIND.UNSUPPORTED_BY_PLATFORM;
  if (/does not expose its error text/i.test(text)) return N.CHANNEL_REASON_KIND.ERROR_TEXT_NOT_EXPOSED;
  return N.CHANNEL_REASON_KIND.OTHER;
}

function readChannelDiscovery(ctx) {
  const cd = ctx.footer[N.FOOTER.CHANNEL_DISCOVERY];
  const base = N.FOOTER.CHANNEL_DISCOVERY;
  const D = N.CHANNEL_DISCOVERY;
  if (!isObj(cd)) return {status: absentStatus(ctx, base), lists: null, reasons: null};
  const list = (k) => (Array.isArray(cd[k]) ? cd[k].filter(isStr) : null);
  const reasonsCell = cell(ctx, cd, D.REASONS, 'object', `${base}.${D.REASONS}`);
  const reasons = {};
  if (reasonsCell.status === N.KEY_STATUS.PRESENT) {
    for (const [name, text] of Object.entries(reasonsCell.value)) {
      if (!isStr(text)) {
        ctx.anomaly(`${base}.${D.REASONS}`, 'REASON_NOT_STRING', {channel: name});
        continue;
      }
      if (text.length > N.REASON_TEXT_CAP_CHARS) ctx.anomaly(`${base}.${D.REASONS}`, 'REASON_TEXT_OVER_CAP', {channel: name, length: text.length});
      reasons[name] = {text, kind: classifyChannelReason(text)};
    }
  }
  const lists = {
    attempted: list(D.ATTEMPTED), available: list(D.AVAILABLE), blockedBySelinux: list(D.BLOCKED_BY_SELINUX), missing: list(D.MISSING),
  };
  // قناة غير متاحة بلا سبب: غياب السبب يُعلَن (عقد :488 «لكل قناة غير متاحة»).
  const unavailable = [...(lists.blockedBySelinux || []), ...(lists.missing || [])];
  const withoutReason = reasonsCell.status === N.KEY_STATUS.PRESENT ? unavailable.filter((n) => !has(reasons, n)) : null;
  if (withoutReason !== null && withoutReason.length > 0) ctx.anomaly(`${base}.${D.REASONS}`, 'UNAVAILABLE_WITHOUT_REASON', withoutReason);
  return {status: N.KEY_STATUS.PRESENT, lists, reasonsStatus: reasonsCell.status, reasons, unavailableWithoutReason: withoutReason};
}

function readTimeSeriesState(ctx) {
  const key = N.TIME_SERIES.TIME_SERIES_STATE;
  const c = cell(ctx, ctx.parts.ts, key, 'string', `timeSeries.${key}`);
  if (c.status !== N.KEY_STATUS.PRESENT) return {status: c.status, state: null};
  const state = parseState(c.value, N.VOCAB.TIME_SERIES_STATE);
  if (!state.recognized) ctx.anomaly(`timeSeries.${key}`, 'UNRECOGNIZED_STATE', {raw: state.raw});
  return {status: c.status, state};
}

// تشخيص بناء التذييل في التطبيق: «ok» أو «ok:<تفصيل>» أو «fail:<صنف>» لكل قسم (عقد ١.٧ :228). fail يعني أن القسم
// لم يُبنَ في التطبيق — فغياب مفاتيحه ليس من الجهاز؛ يُعلَن شذوذاً صريحاً ولا يُقرأ غياباً عادياً.
function readFooterDiagnostics(ctx) {
  const c = cell(ctx, ctx.footer, N.FOOTER.FOOTER_DIAGNOSTICS, 'object', N.FOOTER.FOOTER_DIAGNOSTICS);
  if (c.status !== N.KEY_STATUS.PRESENT) return {status: c.status, entries: {}};
  const entries = {};
  for (const [name, raw] of Object.entries(c.value)) {
    const st = parseState(raw, N.VOCAB.FOOTER_DIAGNOSTIC);
    if (st === null) {
      ctx.anomaly(N.FOOTER.FOOTER_DIAGNOSTICS, 'WRONG_TYPE', {section: name, found: typeOf(raw)});
      entries[name] = {kind: N.READER_STATE.UNRECOGNIZED, detail: null};
      continue;
    }
    if (!st.recognized) ctx.anomaly(N.FOOTER.FOOTER_DIAGNOSTICS, 'UNRECOGNIZED_STATE', {section: name, raw: st.raw});
    if (st.kind === K.FAIL) ctx.anomaly(N.FOOTER.FOOTER_DIAGNOSTICS, 'FOOTER_SECTION_FAILED', {section: name, detail: st.detail});
    entries[name] = {kind: st.kind, detail: st.detail};
  }
  return {status: c.status, entries};
}

function readStringLists(ctx) {
  const lists = {};
  for (const key of [N.FOOTER.FIELDS_NOT_IN_FILE, N.FOOTER.UNMEASURED_DEFAULTS, N.FOOTER.TRANSITIONAL_AGGREGATES]) {
    const name = key; // اسم القسم في المخرَج = اسم مفتاح التذييل
    const c = cell(ctx, ctx.footer, key, 'array', key);
    if (c.status !== N.KEY_STATUS.PRESENT) {
      lists[name] = {status: c.status, names: null};
      continue;
    }
    const names = c.value.filter(isStr);
    if (names.length !== c.value.length) ctx.anomaly(key, 'ELEMENT_NOT_STRING', {dropped: c.value.length - names.length});
    lists[name] = {status: c.status, names};
  }
  // مفتاح سمّاه fieldsNotInFile وهو حاضر: تناقض معلن (عقد :1191 «مفاتيح تُحذف من حمولة الملفّ القديم»).
  for (const name of ctx.notInFile) {
    const v = getPath(ctx.footer, name);
    if (v !== undefined && v !== null) ctx.anomaly(N.FOOTER.FIELDS_NOT_IN_FILE, 'NAMED_KEY_IS_PRESENT', {name});
  }
  return lists;
}

// ═══════════════════════════════════════════════════════════════════
// ١١) measurements على نتائج الاختبارات (عقد ت-11 :528-538، ت-14 :560-570، §٧-ب بند 7-8 :1141-1142)
// ═══════════════════════════════════════════════════════════════════
// الأسماء بعد الأرقام الأربعة في العيّنات الذهبية (visibleSatellites · usedSatellites · satelliteStatusCallbacks · timeToFirstFixMs)
// منقولة من العقد وحده — لا عيّنة حقيقية تحملها: **[منقول، غير متحقَّق]** حتى فحص الجهاز بعد 1.0.11.
// تسمية حالات L-02 (اسم خادم): «التطبيق يرسل الأرقام والخادم يسمّي الحالة» (س-34 :1038-1042) ولم يحدّد العقد الأسماء.
function readOneMeasurements(ctx, source, entry, index) {
  const path = `${source}[${index}].${N.MEASUREMENTS_KEY}`;
  const raw = entry[N.MEASUREMENTS_KEY];
  if (!isObj(raw)) {
    ctx.anomaly(path, 'WRONG_TYPE', {expected: 'object', found: typeOf(raw)});
    return {status: N.KEY_STATUS.WRONG_TYPE, keys: []};
  }
  const out = {
    status: N.KEY_STATUS.PRESENT,
    keys: Object.keys(raw).sort(),
    // إعلان صريح لفشل الترميز/الفكّ بدل null أو استثناء (عقد §٧ بند 5 :1095).
    unencodable: has(raw, N.MEASUREMENTS_UNENCODABLE_KEY) ? raw[N.MEASUREMENTS_UNENCODABLE_KEY] : null,
    unreadable: has(raw, N.MEASUREMENTS_UNREADABLE_KEY) ? raw[N.MEASUREMENTS_UNREADABLE_KEY] : null,
  };
  const id = entry.testId;
  if (id === N.MEASURED_TEST_IDS.GPS_SATELLITES) {
    const L = N.L02_MEASUREMENT_KEYS;
    const asInt = (k) => (Number.isInteger(raw[k]) ? raw[k] : null);
    const callbacks = asInt(L.SATELLITE_STATUS_CALLBACKS);
    const visible = asInt(L.VISIBLE_SATELLITES);
    out.l02 = {
      satelliteStatusCallbacks: callbacks,
      visibleSatellites: visible,
      usedSatellites: asInt(L.USED_SATELLITES),
      timeToFirstFixMs: asInt(L.TIME_TO_FIRST_FIX_MS),
      locationUpdateCount: asInt(L.LOCATION_UPDATE_COUNT),
      gpsProviderEnabled: typeof raw[L.GPS_PROVIDER_ENABLED] === 'boolean' ? raw[L.GPS_PROVIDER_ENABLED] : null,
      gnssCallbackState: strOrNull(raw[L.GNSS_CALLBACK_STATE]),
      locationUpdatesState: strOrNull(raw[L.LOCATION_UPDATES_STATE]),
      timeToFirstFixState: strOrNull(raw[L.TIME_TO_FIRST_FIX_STATE]),
      // «المحرّك لم يعمل» مقابل «0 أقمار مقاسة» (س-34): الأرقام وحدها تفصل بينهما؛ بلا عدد استدعاءات لا حكم.
      engineState: callbacks === null ? 'UNDETERMINED_NO_CALLBACK_COUNT' :
        callbacks === 0 ? 'ENGINE_DID_NOT_REPORT' :
          (visible === 0 ? 'ZERO_SATELLITES_MEASURED' : (visible === null ? 'UNDETERMINED_NO_SATELLITE_COUNT' : 'SATELLITES_MEASURED')),
    };
  } else if (id === N.MEASURED_TEST_IDS.STEP_SENSOR_A || id === N.MEASURED_TEST_IDS.STEP_SENSOR_B) {
    const Q = N.STEP_SENSOR_MEASUREMENT_KEYS;
    const readingsRaw = raw[Q.READINGS];
    let readings = null;
    if (Array.isArray(readingsRaw)) {
      readings = readingsRaw.filter((x) => isObj(x) && Number.isInteger(x.t) && Array.isArray(x.values) && x.values.every(isFiniteNum))
          .map((x) => ({t: x.t, values: x.values.slice()}));
      if (readings.length !== readingsRaw.length) ctx.anomaly(path, 'READINGS_ELEMENT_MALFORMED', {dropped: readingsRaw.length - readings.length});
    }
    // «لا قراءات» = قائمة فارغة معلنة لا غياب (عقد :1030) — فالفارغة تُقرأ «لم تُسجَّل قراءة»، وغيابها «لم يُشحن».
    out.stepSensor = {
      windowMs: Number.isInteger(raw[Q.WINDOW_MS]) ? raw[Q.WINDOW_MS] : null,
      readings,
      readingsState: readings === null ? 'ABSENT' : (readings.length === 0 ? 'EMPTY_DECLARED' : 'HAS_READINGS'),
    };
  } else if (id === N.MEASURED_TEST_IDS.TOUCH_GRID) {
    out.touchGrid = readTouchGrid(ctx, raw, path);
  } else if (N.VOLUME_BUTTON_TEST_IDS.includes(id)) {
    out.volumeButton = readVolumeButton(ctx, raw, path, ctx.sinceFv71);
  }
  return out;
}

// M-02 (شبكة اللمس) — خامّ الفنّي: عقد §٧-ح (ب) (docs/FV68_CONTRACT.md:1458-1476، نسخة a04b4f0؛ N-19 المعدَّل بقرار المستخدم 2026-10-10).
//   • كل مفتاح خامّ يُخرج قيمته (أو null) **وحالته** `<مفتاح>Status` (القاعدة 22: لا null صامت). والحالات من KEY_STATUS.
//   • elapsedMs وtimeToFirstTouchMs **غائبان إن لم تقع لمسة** (عقد :1470-1471): فغيابهما مع touchedCells = 0 هو التصميم ⇒ ABSENT_DECLARED
//     (السبب في touchState = NO_TOUCH)؛ وغيابهما مع لمسة، أو مع touchedCells نفسه غائب، شذوذ معلن ⇒ ABSENT + anomaly. وحضورهما مع touchedCells = 0
//     تناقض معلن كذلك. ولا قيمة تُخترع لهما.
//   • elapsedMs دلالته **تغيّرت**: من أوّل لمسة (≥ 69) — فيُخرَج elapsedMsBasis ليقرأه من يقارن زمناً بزمن (القاعدة 20). أمّا ≤ 68 فالعقد كان يسأل
//     «من أول لمسة؟ أم من فتح الشبكة؟» (عقد :592 في نسخة a04b4f0 قبل الحسم) فالأساس «غير محدَّد» ولا يُخمَّن.
//   • timeToFirstTouchMs [م] لم يوجد قبل fv69: غيابه في ≤ 68 NOT_IN_FIELDS_VERSION لا ABSENT.
//   • endReason: أربع قيم (TOUCH_GRID_END_REASON)؛ ما خرج عنها UNRECOGNIZED ويُعلَن (القاعدة 25). لا يُستنتج منه حكم هنا (الخادم يقرأ ولا يحكم، §٠).
// ما لا يفعله: لا يطابق endReason بحالة M-02 (pass/fail/not_tested) ولا يقرأ غياب measurements عن M-02 كلّه (العقد نفسه يجعله مشروعاً عند «dismissed» بلا لمسة، :1475).
function readTouchGrid(ctx, raw, path) {
  const G = N.TOUCH_GRID_MEASUREMENT_KEYS;
  const S = N.KEY_STATUS;
  const T = N.TOUCH_GRID_TOUCH_STATE;
  const fv = ctx.fieldsVersion;
  const sinceFv69 = fv !== null && fv >= N.FIELDS_VERSION_69;
  const at = (key) => `${path}.${key}`;
  const intCell = (key) => cell(ctx, raw, key, 'int', at(key));

  const touched = intCell(G.TOUCHED_CELLS);
  const touchState = touched.status !== S.PRESENT ? T.UNDETERMINED_NO_TOUCHED_CELLS_COUNT : (touched.value === 0 ? T.NO_TOUCH : T.TOUCHED);

  const timing = (key) => {
    const c = intCell(key);
    if (c.status === S.PRESENT) {
      if (sinceFv69 && touchState === T.NO_TOUCH) ctx.anomaly(at(key), 'TOUCH_GRID_TIMING_PRESENT_WITHOUT_TOUCH', {touchedCells: touched.value});
      return c;
    }
    if (c.status === S.WRONG_TYPE) return c;
    // غائب: المفتاح نفسه
    if (!sinceFv69) return key === G.TIME_TO_FIRST_TOUCH_MS ? {...c, status: S.NOT_IN_FIELDS_VERSION} : c;
    if (touchState === T.NO_TOUCH) return {...c, status: S.ABSENT_DECLARED};
    ctx.anomaly(at(key), touchState === T.TOUCHED ? 'TOUCH_GRID_TIMING_ABSENT_DESPITE_TOUCH' : 'TOUCH_GRID_TIMING_ABSENT_TOUCH_COUNT_UNKNOWN',
        {touchedCells: touched.value});
    return {...c, status: S.ABSENT};
  };

  const cols = intCell(G.GRID_COLS);
  const rows = intCell(G.GRID_ROWS);
  const total = intCell(G.TOTAL_CELLS);
  const pointers = intCell(G.MAX_SIMULTANEOUS_POINTERS);
  const elapsed = timing(G.ELAPSED_MS);
  const firstTouch = timing(G.TIME_TO_FIRST_TOUCH_MS);
  const endReason = stateCell(ctx, raw, G.END_REASON, N.VOCAB.TOUCH_GRID_END_REASON, at(G.END_REASON));

  // fv71: أساس الشبكة من **الختم وحده** (القسم ف-01) لا من gridCols/gridRows؛ والأبعاد تُطابَق به لا يُشتقّ منها (ختم < 71 ⇒ 8×15 ثابتة: تناقضه يُعلَن).
  const sinceFv71 = ctx.sinceFv71;
  const GB = N.TOUCH_GRID_GRID_BASIS;
  const gridBasis = fv === null ? GB.UNDETERMINED_NO_FIELDS_VERSION : (sinceFv71 ? GB.MM_TARGET : GB.FIXED_8X15);
  if (gridBasis === GB.FIXED_8X15 && cols.status === S.PRESENT && rows.status === S.PRESENT &&
      (cols.value !== N.TOUCH_GRID_FIXED_DIMENSIONS.COLS || rows.value !== N.TOUCH_GRID_FIXED_DIMENSIONS.ROWS)) {
    ctx.anomaly(at(G.GRID_COLS), 'TOUCH_GRID_DIMENSIONS_DISAGREE_WITH_BASIS', {gridBasis, gridCols: cols.value, gridRows: rows.value});
  }
  const pathBlock = readTouchPath(ctx, raw, path, {sinceFv71, cols, rows, total, touched, endReason});

  return {
    gridCols: cols.value, gridColsStatus: cols.status,
    gridRows: rows.value, gridRowsStatus: rows.status,
    totalCells: total.value, totalCellsStatus: total.status,
    touchedCells: touched.value, touchedCellsStatus: touched.status,
    maxSimultaneousPointers: pointers.value, maxSimultaneousPointersStatus: pointers.status,
    touchState,
    elapsedMs: elapsed.value, elapsedMsStatus: elapsed.status,
    elapsedMsBasis: fv === null ? N.TOUCH_GRID_ELAPSED_BASIS.UNDETERMINED_NO_FIELDS_VERSION :
      (sinceFv69 ? N.TOUCH_GRID_ELAPSED_BASIS.FROM_FIRST_TOUCH : N.TOUCH_GRID_ELAPSED_BASIS.UNDETERMINED_BEFORE_FV69),
    timeToFirstTouchMs: firstTouch.value, timeToFirstTouchMsStatus: firstTouch.status,
    endReason: strOrNull(raw[G.END_REASON]), endReasonStatus: endReason.status, endReasonState: endReason.state,
    gridBasis,
    path: pathBlock,
  };
}

// M-02 «إطار + X» (fv71، 2026-10-21): مفتاحا المجموعة المطلوبة gridPattern وnotRequiredCells بحالتيهما الصريحتين. **ختم ≥ 71 وحده** (تحت 71 تقرؤهما readTouchPath حضوراً شاذّاً لا قيمة).
// العقد (docs/FV71_CONTRACT_SECTION.md، الحاشية «تحديث 2026-10-21 (أمر وكيل التطبيق ٨)»، البندان 6–8):
//   • غيابهما معاً ⟵ gridPatternState = NOT_DECLARED، **لا شذوذ** (بناء الجولة 324578f وما قبله لم يكتبهما)؛ المفتاحان يُحالان ABSENT_DECLARED (غاب وتشرح غيابَه الحالةُ).
//   • نمط خارج القيمتين ⟵ INVALID_VALUE وشذوذ؛ نوع خاطئ ⟵ WRONG_TYPE (شذوذ cell()) ؛ أحدهما حاضر والآخر غائب ⟵ ONE_KEY_ABSENT وشذوذ (التطبيق يكتبهما معاً دائماً).
//   • القيمة لا تُفترض: النمط الغائب لا يصير ALL_CELLS، وnotRequiredCells الغائبة لا تصير [] إلا بحالة NOT_DECLARED الصريحة (المحسوبة في readTouchPath: requiredCellsBasis).
function readGridPatternKeys(ctx, raw, basePath) {
  const K = N.TOUCH_GRID_PATTERN_KEYS;
  const PS = N.TOUCH_GRID_PATTERN_STATE;
  const S = N.KEY_STATUS;
  const at = (k) => `${basePath}.${k}`;
  const pattern = cell(ctx, raw, K.GRID_PATTERN, 'string', at(K.GRID_PATTERN));
  const list = cell(ctx, raw, K.NOT_REQUIRED_CELLS, 'array', at(K.NOT_REQUIRED_CELLS));
  const isAbsent = (c) => c.status !== S.PRESENT && c.status !== S.WRONG_TYPE;
  const patternAbsent = isAbsent(pattern);
  const listAbsent = isAbsent(list);
  const out = {
    gridPattern: pattern.status === S.PRESENT ? pattern.value : null, gridPatternStatus: pattern.status,
    notRequiredCells: list.status === S.PRESENT ? list.value : null, notRequiredCellsStatus: list.status,
  };
  if (patternAbsent && listAbsent) {
    out.gridPatternStatus = S.ABSENT_DECLARED;
    out.notRequiredCellsStatus = S.ABSENT_DECLARED;
    out.gridPatternState = PS.NOT_DECLARED;
    return out;
  }
  if (patternAbsent !== listAbsent) {
    ctx.anomaly(basePath, N.TOUCH_GRID_PATTERN_ANOMALY.KEYS_INCOMPLETE, {absent: patternAbsent ? K.GRID_PATTERN : K.NOT_REQUIRED_CELLS, present: patternAbsent ? K.NOT_REQUIRED_CELLS : K.GRID_PATTERN});
  }
  const validValue = pattern.status === S.PRESENT && Object.values(N.TOUCH_GRID_PATTERN).includes(pattern.value);
  if (pattern.status === S.PRESENT && !validValue) ctx.anomaly(at(K.GRID_PATTERN), N.TOUCH_GRID_PATTERN_ANOMALY.VALUE_INVALID, {raw: pattern.value.slice(0, 64)});
  if (pattern.status === S.WRONG_TYPE || list.status === S.WRONG_TYPE) out.gridPatternState = PS.WRONG_TYPE;
  else if (pattern.status === S.PRESENT && !validValue) out.gridPatternState = PS.INVALID_VALUE;
  else if (patternAbsent !== listAbsent) out.gridPatternState = PS.ONE_KEY_ABSENT;
  else out.gridPatternState = PS.DECLARED;
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// ١١-ب) M-02 في fv71 — الشبكة الجديدة بالخامّ (الخيار «ب»): القسم §٧-ي ف-02 وف-03 (docs/FV71_CONTRACT_SECTION.md) — S-M02، 2026-10-18 +03
// ═══════════════════════════════════════════════════════════════════
// الحاكم: القسم المنسوخ؛ والتصميم (design-m02-touch-grid-2026-10-13.md §6.6) حيث يسكت. كل مفتاح يُخرج قيمته **وحالته** `<مفتاح>Status` (القاعدة 22)، وسببَ غيابه `<مفتاح>Reason` إن غاب بسبب معلَن.
//   • ختم < 71: الكتلة `{state: NOT_IN_FIELDS_VERSION}` وحدها (غيابها هو الحال)؛ وحضور أيّ مفتاح جديد تحت ختم أقدم شذوذ (القاعدة 25). لا ختم: UNDETERMINED_NO_FIELDS_VERSION.
//   • ختم ≥ 71: كل مفتاح بحضوره (TOUCH_PATH_FIELD_SPEC): ALWAYS ⇒ غيابه شذوذ؛ REASONED ⇒ غيابه بسبب في absentFieldReasons حالة ABSENT_DECLARED، وبلا سبب شذوذ؛ مفتاح غير معروف شذوذ.
//   • «إطار + X» (2026-10-21): gridPattern وnotRequiredCells خارج TOUCH_PATH_FIELD_SPEC عمداً (غيابهما معاً NOT_DECLARED لا شذوذ): تُقرآن في readGridPatternKeys، وعلاقات «المطلوب» في readTouchPath (requiredCellsBasis).
//   • الخامّ لا يخرج من هنا: strokes تُلخَّص (أعداد وأنواع) ويُحلَّل مسارها في touchPath.js؛ الإحداثيات تبقى في reportRaw كما شُحنت (القاعدة 20).
//   • ما يعلّقه القسم يمرّ نصّاً بلا تصنيف: أسماء شروط densityCheck وقيم resampledFlagState (معلّق: مواصفة غائبة).
const PATH_KEYS = N.TOUCH_PATH_MEASUREMENT_KEYS;
const PATH_SPEC = N.TOUCH_PATH_FIELD_SPEC;
const PATH_PRESENCE = N.TOUCH_PATH_PRESENCE;
const PATH_LIST_CAP = N.TOUCH_PATH_OUTPUT_LIST_CAP;
const cappedList = (list) => ({items: list.slice(0, PATH_LIST_CAP), total: list.length, truncated: list.length > PATH_LIST_CAP});
const isRect = (o) => isObj(o) && Object.values(N.TOUCH_PATH_RECT_KEYS).every((k) => Number.isInteger(o[k]));
const isRadii = (o) => isObj(o) && Object.values(N.TOUCH_PATH_ROUNDED_CORNER_KEYS).every((k) => Number.isInteger(o[k]));

// سبب غياب مفتاح: not_reported_by_device · read_failed:<نصّ> · api_below_<n> (نمط). غير ذلك UNRECOGNIZED.
function parseAbsentReason(raw) {
  const st = parseState(raw, N.VOCAB.TOUCH_PATH_ABSENT_REASON);
  if (st === null || st.recognized) return st;
  const m = N.TOUCH_PATH_ABSENT_REASON_API_BELOW_RE.exec(raw);
  return m ? {raw, kind: N.TOUCH_PATH_ABSENT_REASON.API_BELOW, detail: m[1], recognized: true} : st;
}

// يجمع مشاكل عناصر القائمة بالرمز: شذوذ واحد لكل رمز بعدده وأوّل فهارسه (لا ألف شذوذ لقائمة معطوبة).
function makeProblemCollector() {
  const map = new Map();
  return {
    add(code, index, example) {
      let e = map.get(code);
      if (!e) {
        e = {count: 0, firstIndexes: [], examples: []};
        map.set(code, e);
      }
      e.count++;
      if (e.firstIndexes.length < 10) e.firstIndexes.push(index);
      if (example !== undefined && e.examples.length < 5 && !e.examples.includes(example)) e.examples.push(example);
    },
    flush(ctx, section, prefix) {
      for (const [code, e] of map) ctx.anomaly(section, `${prefix}${code}`, {count: e.count, firstIndexes: e.firstIndexes, examples: e.examples});
      return [...map.keys()];
    },
  };
}

// خطوط strokes[]: يُعيد {status, value: ملخّص بلا إحداثيات، normalized: خطوط التحليل}
function readStrokes(ctx, raw, at, reasons) {
  const S = N.KEY_STATUS;
  const SK = N.TOUCH_PATH_STROKE_KEYS;
  const c = cell(ctx, raw, PATH_KEYS.STROKES, 'array', at(PATH_KEYS.STROKES));
  if (c.status !== S.PRESENT) {
    if (c.status !== S.WRONG_TYPE) ctx.anomaly(at(PATH_KEYS.STROKES), 'TOUCH_PATH_REQUIRED_KEY_ABSENT', {key: PATH_KEYS.STROKES});
    return {status: c.status, value: null, normalized: null};
  }
  const problems = makeProblemCollector();
  const normalized = [];
  const summaries = [];
  const endCounts = {};
  const toolCounts = {};
  let withTouchMajor = 0;
  let withoutTouchMajor = 0;
  let pointsTotal = 0;
  const countKind = (bag, kind) => {
    bag[kind] = (bag[kind] || 0) + 1;
  };
  c.value.forEach((el, index) => {
    if (!isObj(el)) {
      problems.add('NOT_OBJECT', index, typeOf(el));
      normalized.push({index, usable: false});
      summaries.push({index, usable: false, problems: ['NOT_OBJECT']});
      return;
    }
    const mine = [];
    const bad = (code, example) => {
      problems.add(code, index, example);
      mine.push(code);
    };
    let unusable = false;
    if (!Number.isInteger(el[SK.POINTER_ID])) bad('POINTER_ID_INVALID', typeOf(el[SK.POINTER_ID]));
    // toolType / end: مفردة مغلقة (+ unknown:<n> لنوع الأداة)؛ الغائب أو غير النصّ مشكلة، وغير المعروف يُعلَن ولا يُلحَق بأقرب قيمة
    let tool = null;
    if (!isStr(el[SK.TOOL_TYPE])) {
      bad('TOOL_TYPE_INVALID', typeOf(el[SK.TOOL_TYPE]));
    } else {
      tool = parseState(el[SK.TOOL_TYPE], N.VOCAB.TOUCH_PATH_TOOL_TYPE);
      if (!tool.recognized) bad('TOOL_TYPE_UNRECOGNIZED', el[SK.TOOL_TYPE]);
      countKind(toolCounts, tool.kind);
    }
    let end = null;
    if (!isStr(el[SK.END])) {
      bad('END_INVALID', typeOf(el[SK.END]));
      countKind(endCounts, N.READER_STATE.UNRECOGNIZED);
    } else {
      end = parseState(el[SK.END], N.VOCAB.TOUCH_PATH_STROKE_END);
      if (!end.recognized) bad('END_UNRECOGNIZED', el[SK.END]);
      countKind(endCounts, end.kind);
    }
    if (!Number.isInteger(el[SK.DOWN_AT_MS])) {
      bad('DOWN_AT_INVALID', typeOf(el[SK.DOWN_AT_MS]));
      unusable = true;
    }
    const dt = el[SK.DT_MS];
    const xs = el[SK.X];
    const ys = el[SK.Y];
    if (!Array.isArray(dt) || !Array.isArray(xs) || !Array.isArray(ys)) {
      bad('ARRAYS_INVALID', `${typeOf(dt)}/${typeOf(xs)}/${typeOf(ys)}`);
      unusable = true;
    } else {
      // «طول dtMs = طول x = طول y دائماً؛ خلافه ⇒ شذوذ» (القسم ف-03)
      if (dt.length !== xs.length || xs.length !== ys.length) {
        bad('LENGTH_MISMATCH', `${dt.length}/${xs.length}/${ys.length}`);
        unusable = true;
      }
      if (!dt.every((v) => Number.isInteger(v) && v >= 0)) {
        bad('DT_INVALID');
        unusable = true;
      } else if (dt.length > 0 && dt[0] !== 0) {
        bad('DT_FIRST_NONZERO', dt[0]); // «dtMs[0] = 0» [م]: يُعلَن ولا يُسقِط الخطّ (الزمن المطلق للعيّنة الأولى downAtMs)
      }
      if (!xs.every(isFiniteNum) || !ys.every(isFiniteNum)) {
        bad('COORD_NOT_FINITE'); // «أعداد منتهية فقط» (القسم): عيّنة غير منتهية لا تُكتب
        unusable = true;
      }
    }
    // touchMajorPx: اختيارية؛ غيابها بسببه في absentFieldReasons['strokes.touchMajorPx'] لا أصفاراً
    let touchMajor = null;
    if (has(el, SK.TOUCH_MAJOR_PX) && el[SK.TOUCH_MAJOR_PX] !== null) {
      const tm = el[SK.TOUCH_MAJOR_PX];
      if (!Array.isArray(tm) || !tm.every(isFiniteNum) || (Array.isArray(xs) && tm.length !== xs.length)) {
        bad('TOUCH_MAJOR_INVALID', typeOf(tm));
      } else {
        touchMajor = tm;
        withTouchMajor++;
      }
    } else {
      withoutTouchMajor++;
    }
    const points = Array.isArray(xs) ? xs.length : 0;
    pointsTotal += unusable ? 0 : points;
    normalized.push({
      index, usable: !unusable, pointerId: el[SK.POINTER_ID], end: end === null ? null : end.kind, endRecognized: end !== null && end.recognized,
      downAtMs: el[SK.DOWN_AT_MS], dtMs: dt, x: xs, y: ys, touchMajorPx: touchMajor,
    });
    summaries.push({
      index, pointerId: Number.isInteger(el[SK.POINTER_ID]) ? el[SK.POINTER_ID] : null, toolType: tool, end, downAtMs: Number.isInteger(el[SK.DOWN_AT_MS]) ? el[SK.DOWN_AT_MS] : null,
      points, usable: !unusable, problems: mine,
    });
  });
  const touchMajorReason = has(reasons, N.TOUCH_PATH_TOUCH_MAJOR_REASON_KEY);
  if (withoutTouchMajor > 0 && !touchMajorReason) {
    ctx.anomaly(at(PATH_KEYS.STROKES), 'TOUCH_PATH_ABSENT_WITHOUT_REASON', {key: N.TOUCH_PATH_TOUCH_MAJOR_REASON_KEY, strokesWithout: withoutTouchMajor});
  }
  if (withTouchMajor > 0 && withoutTouchMajor === 0 && touchMajorReason) {
    ctx.anomaly(at(PATH_KEYS.STROKES), 'TOUCH_PATH_REASON_FOR_PRESENT_KEY', {key: N.TOUCH_PATH_TOUCH_MAJOR_REASON_KEY});
  }
  const problemCodes = problems.flush(ctx, at(PATH_KEYS.STROKES), 'TOUCH_PATH_STROKE_');
  const usableCount = normalized.filter((s) => s.usable).length;
  return {
    status: S.PRESENT,
    value: {
      count: c.value.length, usableCount, unusableCount: c.value.length - usableCount, pointsTotal, endCounts, toolCounts,
      touchMajor: {withPoints: withTouchMajor, withoutPoints: withoutTouchMajor, reasonDeclared: touchMajorReason},
      problemCodes, summaries: cappedList(summaries),
    },
    normalized,
  };
}

// displayedSuspects: غائب ⇒ لم تُعرض علامات (حالة معلنة لا شذوذ)؛ حاضر و[] ⇒ عُرضت ولم تُرَ مواضع. العنصر {kind, strokeIndex, fromPointIndex, toPointIndex} (E19).
function readDisplayedSuspects(ctx, raw, at, strokesRead) {
  const S = N.KEY_STATUS;
  const E = N.TOUCH_PATH_SUSPECT_ELEMENT;
  const DS = N.TOUCH_PATH_DISPLAYED_STATE;
  const c = cell(ctx, raw, PATH_KEYS.DISPLAYED_SUSPECTS, 'array', at(PATH_KEYS.DISPLAYED_SUSPECTS));
  if (c.status === S.WRONG_TYPE) return {status: c.status, value: {state: null}, items: null};
  if (c.status !== S.PRESENT) return {status: S.ABSENT_DECLARED, value: {state: DS.NOT_DISPLAYED}, items: null};
  const problems = makeProblemCollector();
  const items = [];
  c.value.forEach((el, i) => {
    if (!isObj(el)) {
      problems.add('NOT_OBJECT', i, typeOf(el));
      return;
    }
    const kind = isStr(el[E.KIND]) ? parseState(el[E.KIND], N.VOCAB.TOUCH_PATH_DISPLAYED_SUSPECT_KIND) : null;
    if (kind === null) problems.add('KIND_INVALID', i, typeOf(el[E.KIND]));
    else if (!kind.recognized) problems.add('KIND_UNRECOGNIZED', i, el[E.KIND]);
    const idxOk = [E.STROKE_INDEX, E.FROM_POINT_INDEX, E.TO_POINT_INDEX].every((k) => Number.isInteger(el[k]) && el[k] >= 0);
    if (!idxOk) problems.add('INDEX_INVALID', i);
    if (kind === null || !idxOk) return;
    // الفهارس تربط العلامة بالخامّ: فهرس خارج المدى يعني علامة بلا موضع في المسار
    const s = strokesRead.normalized === null ? null : strokesRead.normalized[el[E.STROKE_INDEX]];
    if (strokesRead.normalized !== null && (s === undefined || (s.usable && (el[E.FROM_POINT_INDEX] >= s.x.length || el[E.TO_POINT_INDEX] >= s.x.length)))) {
      problems.add('INDEX_OUT_OF_RANGE', i);
    }
    items.push({kind: kind.kind, kindRecognized: kind.recognized, strokeIndex: el[E.STROKE_INDEX], fromPointIndex: el[E.FROM_POINT_INDEX], toPointIndex: el[E.TO_POINT_INDEX]});
  });
  const codes = problems.flush(ctx, at(PATH_KEYS.DISPLAYED_SUSPECTS), 'TOUCH_PATH_DISPLAYED_SUSPECT_');
  return {
    status: S.PRESENT,
    value: {state: c.value.length === 0 ? DS.DISPLAYED_NONE : DS.DISPLAYED, count: c.value.length, problemCodes: codes, items: cappedList(items)},
    items,
  };
}

function readPathCap(ctx, raw, at) {
  const S = N.KEY_STATUS;
  const K2 = N.TOUCH_PATH_PATH_CAP_KEYS;
  const c = cell(ctx, raw, PATH_KEYS.PATH_CAP, 'object', at(PATH_KEYS.PATH_CAP));
  if (c.status !== S.PRESENT) {
    if (c.status !== S.WRONG_TYPE) ctx.anomaly(at(PATH_KEYS.PATH_CAP), 'TOUCH_PATH_REQUIRED_KEY_ABSENT', {key: PATH_KEYS.PATH_CAP});
    return {status: c.status, value: null};
  }
  const sub = (key, type) => cell(ctx, c.value, key, type, at(`${PATH_KEYS.PATH_CAP}.${key}`));
  const max = sub(K2.MAX_POINTS, 'int');
  const reached = sub(K2.REACHED, 'boolean');
  const dropped = sub(K2.POINTS_DROPPED, 'int');
  for (const [k, r] of [[K2.MAX_POINTS, max], [K2.REACHED, reached], [K2.POINTS_DROPPED, dropped]]) {
    if (r.status === S.ABSENT) ctx.anomaly(at(`${PATH_KEYS.PATH_CAP}.${k}`), 'TOUCH_PATH_REQUIRED_KEY_ABSENT', {key: `${PATH_KEYS.PATH_CAP}.${k}`});
  }
  return {
    status: S.PRESENT,
    value: {maxPoints: max.value, maxPointsStatus: max.status, reached: reached.value, reachedStatus: reached.status, pointsDropped: dropped.value, pointsDroppedStatus: dropped.status},
  };
}

function readTouchPath(ctx, raw, basePath, known) {
  const PS = N.TOUCH_PATH_STATE;
  const S = N.KEY_STATUS;
  const G = N.TOUCH_GRID_MEASUREMENT_KEYS;
  const at = (k) => `${basePath}.${k}`;
  const isPresent = (k) => has(raw, k) && raw[k] !== null && raw[k] !== undefined;
  const presentNew = Object.keys(PATH_SPEC).filter(isPresent);
  // «إطار + X» (2026-10-21، البند 8): مفتاحا gridPattern وnotRequiredCells جديدان في fv71 أيضاً — حضورهما تحت ختم < 71 شذوذ باسمه (مصدر واحد: fv68Names.TOUCH_GRID_PATTERN_ANOMALY)، ويُسردان في unexpectedKeys
  const patternPresent = Object.values(N.TOUCH_GRID_PATTERN_KEYS).filter(isPresent);
  if (!known.sinceFv71) {
    if (presentNew.length > 0) ctx.anomaly(basePath, 'TOUCH_PATH_KEYS_PRESENT_BEFORE_FV71', {keys: presentNew});
    if (patternPresent.length > 0) ctx.anomaly(basePath, N.TOUCH_GRID_PATTERN_ANOMALY.KEYS_PRESENT_BEFORE_FV71, {keys: patternPresent});
    return {state: ctx.fieldsVersion === null ? PS.UNDETERMINED_NO_FIELDS_VERSION : PS.NOT_IN_FIELDS_VERSION, unexpectedKeys: [...presentNew, ...patternPresent]};
  }
  const out = {state: PS.READ};
  // مفتاح خارج العقد في ختم ≥ 71: «لا يُقبل شكل جديد إلا بتحديث كل قارئ له» (القاعدة 25)
  const knownKeys = new Set([...Object.values(G), ...Object.keys(PATH_SPEC), ...Object.values(N.TOUCH_GRID_PATTERN_KEYS), N.MEASUREMENTS_UNENCODABLE_KEY, N.MEASUREMENTS_UNREADABLE_KEY]);
  out.unknownKeys = Object.keys(raw).filter((k) => !knownKeys.has(k)).sort();
  if (out.unknownKeys.length > 0) ctx.anomaly(basePath, 'TOUCH_GRID_UNKNOWN_KEY', {keys: out.unknownKeys});

  // «إطار + X» (القاعدة 22): gridPattern وnotRequiredCells بحالتيهما الصريحتين — غيابهما معاً NOT_DECLARED (لا شذوذ)، وأيّ خلل آخر شذوذ بحالته
  Object.assign(out, readGridPatternKeys(ctx, raw, basePath));

  // absentFieldReasons (N71-01 [م]): اسم الحقل ← سبب غيابه
  const reasonsCell = cell(ctx, raw, PATH_KEYS.ABSENT_FIELD_REASONS, 'object', at(PATH_KEYS.ABSENT_FIELD_REASONS));
  const reasons = {};
  if (reasonsCell.status === S.PRESENT) {
    for (const [name, text] of Object.entries(reasonsCell.value)) {
      const st = isStr(text) ? parseAbsentReason(text) : null;
      if (st === null) {
        ctx.anomaly(at(PATH_KEYS.ABSENT_FIELD_REASONS), 'REASON_NOT_STRING', {key: name});
        continue;
      }
      if (!st.recognized) ctx.anomaly(at(PATH_KEYS.ABSENT_FIELD_REASONS), 'UNRECOGNIZED_STATE', {raw: st.raw, key: name});
      if (st.detail !== null && st.detail.length > N.REASON_TEXT_CAP_CHARS) ctx.anomaly(at(PATH_KEYS.ABSENT_FIELD_REASONS), 'REASON_TEXT_OVER_CAP', {key: name, length: st.detail.length});
      reasons[name] = st;
    }
    const legit = new Set([...Object.keys(PATH_SPEC).filter((k) => PATH_SPEC[k].presence === PATH_PRESENCE.REASONED), N.TOUCH_PATH_TOUCH_MAJOR_REASON_KEY]);
    for (const name of Object.keys(reasons)) {
      if (!legit.has(name)) ctx.anomaly(at(PATH_KEYS.ABSENT_FIELD_REASONS), 'TOUCH_PATH_REASON_FOR_UNKNOWN_KEY', {key: name});
    }
  }
  out.absentFieldReasons = reasons;
  out.absentFieldReasonsStatus = reasonsCell.status === S.PRESENT ? S.PRESENT : (reasonsCell.status === S.WRONG_TYPE ? S.WRONG_TYPE : S.ABSENT_DECLARED);

  const readField = (key) => {
    const spec = PATH_SPEC[key];
    const c = cell(ctx, raw, key, spec.type, at(key));
    if (c.status === S.PRESENT) {
      if (has(reasons, key)) ctx.anomaly(at(key), 'TOUCH_PATH_REASON_FOR_PRESENT_KEY', {key});
      return {value: c.value, status: S.PRESENT};
    }
    if (c.status === S.WRONG_TYPE) return {value: null, status: S.WRONG_TYPE};
    if (spec.presence === PATH_PRESENCE.REASONED && has(reasons, key)) return {value: null, status: S.ABSENT_DECLARED, reason: reasons[key]};
    ctx.anomaly(at(key), spec.presence === PATH_PRESENCE.REASONED ? 'TOUCH_PATH_ABSENT_WITHOUT_REASON' : 'TOUCH_PATH_REQUIRED_KEY_ABSENT', {key});
    return {value: null, status: c.status};
  };
  const put = (key, r) => {
    out[key] = r.value;
    out[`${key}Status`] = r.status;
    if (r.reason !== undefined) out[`${key}Reason`] = r.reason;
  };
  const special = new Set([PATH_KEYS.STROKES, PATH_KEYS.PATH_CAP]);
  for (const key of Object.keys(PATH_SPEC)) {
    const p = PATH_SPEC[key].presence;
    if ((p === PATH_PRESENCE.ALWAYS || p === PATH_PRESENCE.REASONED) && !special.has(key)) put(key, readField(key));
  }
  const shape = (key, valid) => {
    if (out[`${key}Status`] === S.PRESENT && !valid(out[key])) ctx.anomaly(at(key), 'TOUCH_PATH_SHAPE_INVALID', {key});
  };
  shape(PATH_KEYS.GESTURE_INSETS_PX, isRect);
  shape(PATH_KEYS.MANDATORY_GESTURE_INSETS_PX, isRect);
  shape(PATH_KEYS.EXCLUSION_RECTS_PX, (v) => v.every(isRect));
  shape(PATH_KEYS.CUTOUT_RECTS_PX, (v) => v.every(isRect));
  shape(PATH_KEYS.DENSITY_CHECK, (v) => v.every(isStr)); // أسماء الشروط غير معدَّدة في القسم: تمرّ نصوصاً كما وصلت
  if (out[`${PATH_KEYS.DENSITY_SOURCE}Status`] === S.PRESENT) {
    const st = parseState(out[PATH_KEYS.DENSITY_SOURCE], N.VOCAB.TOUCH_PATH_DENSITY_SOURCE);
    if (!st.recognized) ctx.anomaly(at(PATH_KEYS.DENSITY_SOURCE), 'UNRECOGNIZED_STATE', {raw: st.raw});
    out.densitySourceState = st;
  } else {
    out.densitySourceState = null;
  }
  // عناصر densityCheck: خمسة أسماء [ق] معدَّدة من نصّ قسم f9e0571 (لا عيّنة مُنتِج تحمل أيّاً منها)؛ اسم خارجها شذوذ معلَن (القاعدة 25). و«[] ما لم يُستعمل DENSITY_DPI_FALLBACK»: قائمة غير فارغة مع مصدر آخر معروف شذوذ تناقض.
  out.densityCheckUnrecognized = cappedList([]);
  if (out[`${PATH_KEYS.DENSITY_CHECK}Status`] === S.PRESENT && out[PATH_KEYS.DENSITY_CHECK].every(isStr)) {
    const knownConditions = Object.values(N.TOUCH_PATH_DENSITY_CHECK_CONDITIONS);
    const unknownConditions = out[PATH_KEYS.DENSITY_CHECK].filter((c) => !knownConditions.includes(c));
    out.densityCheckUnrecognized = cappedList(unknownConditions);
    if (unknownConditions.length > 0) ctx.anomaly(at(PATH_KEYS.DENSITY_CHECK), 'TOUCH_PATH_DENSITY_CHECK_UNRECOGNIZED', {count: unknownConditions.length, names: unknownConditions.slice(0, 10)});
    const src = out.densitySourceState;
    if (out[PATH_KEYS.DENSITY_CHECK].length > 0 && src !== null && src.recognized && src.kind !== N.TOUCH_PATH_DENSITY_SOURCE.DENSITY_DPI_FALLBACK) {
      ctx.anomaly(at(PATH_KEYS.DENSITY_CHECK), 'TOUCH_PATH_DENSITY_CHECK_WITHOUT_FALLBACK', {densitySource: src.kind, count: out[PATH_KEYS.DENSITY_CHECK].length});
    }
  }
  // resampledFlagState: قيمتان [ق، معلّق: مواصفة غائبة] — الأسماء تُعدَّد والدلالة لا يحكم بها القارئ؛ خارجهما شذوذ غير معروف
  if (out[`${PATH_KEYS.RESAMPLED_FLAG_STATE}Status`] === S.PRESENT) {
    const st = parseState(out[PATH_KEYS.RESAMPLED_FLAG_STATE], N.VOCAB.TOUCH_PATH_RESAMPLED_FLAG_STATE);
    if (!st.recognized) ctx.anomaly(at(PATH_KEYS.RESAMPLED_FLAG_STATE), 'UNRECOGNIZED_STATE', {raw: st.raw});
    out.resampledFlagStateState = st;
  } else {
    out.resampledFlagStateState = null;
  }
  // unbufferedDispatch: «true إن نجح الطلب وإلا غائب بسببه» (قسم f9e0571): false لا يُكتب أبداً — حضوره false شذوذ معلَن لا قيمة تُقرأ
  if (out[`${PATH_KEYS.UNBUFFERED_DISPATCH}Status`] === S.PRESENT && out[PATH_KEYS.UNBUFFERED_DISPATCH] === false) {
    ctx.anomaly(at(PATH_KEYS.UNBUFFERED_DISPATCH), 'TOUCH_PATH_UNBUFFERED_DISPATCH_FALSE', null);
  }
  // roundedCornerRadiiPx أو roundedCornersState: «أحدهما حاضر دائماً» (القسم ف-02)
  {
    const radii = cell(ctx, raw, PATH_KEYS.ROUNDED_CORNER_RADII_PX, 'object', at(PATH_KEYS.ROUNDED_CORNER_RADII_PX));
    const rstate = stateCell(ctx, raw, PATH_KEYS.ROUNDED_CORNERS_STATE, N.VOCAB.TOUCH_PATH_ROUNDED_CORNERS_STATE, at(PATH_KEYS.ROUNDED_CORNERS_STATE));
    put(PATH_KEYS.ROUNDED_CORNER_RADII_PX, {value: radii.value, status: radii.status});
    put(PATH_KEYS.ROUNDED_CORNERS_STATE, {value: strOrNull(raw[PATH_KEYS.ROUNDED_CORNERS_STATE]), status: rstate.status});
    out.roundedCornersStateState = rstate.state;
    shape(PATH_KEYS.ROUNDED_CORNER_RADII_PX, isRadii);
    if (radii.status === S.PRESENT && rstate.status === S.PRESENT) ctx.anomaly(basePath, 'TOUCH_PATH_ROUNDED_CORNERS_BOTH_PRESENT', null);
    if (radii.status !== S.PRESENT && rstate.status !== S.PRESENT && radii.status !== S.WRONG_TYPE && rstate.status !== S.WRONG_TYPE) {
      ctx.anomaly(basePath, 'TOUCH_PATH_ROUNDED_CORNERS_ABSENT', null);
    }
  }

  // خلايا: الفهارس صالحة، والعلاقات التي يفرضها القسم
  const cellCount = known.cols.status === S.PRESENT && known.rows.status === S.PRESENT ? known.cols.value * known.rows.value : null;
  const cleanIndexes = (key) => {
    if (out[`${key}Status`] !== S.PRESENT) return null;
    const list = out[key];
    const good = list.filter((v) => Number.isInteger(v) && v >= 0 && (cellCount === null || v < cellCount));
    if (good.length !== list.length) ctx.anomaly(at(key), 'TOUCH_GRID_CELL_INDEX_INVALID', {key, invalid: list.length - good.length});
    return good;
  };
  const untouched = cleanIndexes(PATH_KEYS.UNTOUCHED_CELLS);
  const cutout = cleanIndexes(PATH_KEYS.CUTOUT_CELLS);
  const notRequiredList = cleanIndexes(N.TOUCH_GRID_PATTERN_KEYS.NOT_REQUIRED_CELLS);

  // ── «إطار + X» (2026-10-21): ما «المطلوب» الذي تُقاس به totalCells؟ ──
  //   NOT_DECLARED (المفتاحان غائبان معاً، بناء ≤ 324578f): المطلوب = الشبكة − cutoutCells، وتبقى العلاقتان القديمتان بأسمائهما (notRequiredCells ≡ ∅) — لا شذوذ جديد على تقرير قديم.
  //   DECLARED (أو INVALID_VALUE بقائمة سليمة: العلاقة 2 لا تتوقّف على قيمة النمط): المطلوب = الشبكة − cutoutCells − notRequiredCells، والخلل بأسماء جديدة (fv68Names.TOUCH_GRID_PATTERN_ANOMALY).
  //   غير ذلك (نوع خاطئ · نمط ناقص): لا مجموعة مطلوبة — لا علاقة تُحسب والشذوذ في مكانه (القاعدة 22: لا قيمة افتراضية تسدّ غياباً).
  const PGS = N.TOUCH_GRID_PATTERN_STATE;
  const PAN = N.TOUCH_GRID_PATTERN_ANOMALY;
  const RB = N.TOUCH_GRID_REQUIRED_CELLS_BASIS;
  let requiredBasis = RB.UNDETERMINED_PATTERN_NOT_READABLE;
  let notRequired = null;
  if (out.gridPatternState === PGS.NOT_DECLARED) {
    requiredBasis = RB.ALL_NON_CUTOUT_PATTERN_NOT_DECLARED;
    notRequired = [];
  } else if (notRequiredList !== null && (out.gridPatternState === PGS.DECLARED || out.gridPatternState === PGS.INVALID_VALUE)) {
    requiredBasis = RB.NOT_REQUIRED_CELLS_DECLARED;
    notRequired = notRequiredList;
  }
  out.requiredCellsBasis = requiredBasis;
  if (cellCount !== null && known.total.status === S.PRESENT && cutout !== null && notRequired !== null) {
    const expected = cellCount - cutout.length - notRequired.length;
    if (known.total.value !== expected) {
      if (requiredBasis === RB.NOT_REQUIRED_CELLS_DECLARED) {
        ctx.anomaly(at(G.TOTAL_CELLS), PAN.REQUIRED_CELLS_RELATION_BROKEN, {
          gridCols: known.cols.value, gridRows: known.rows.value, cutoutCells: cutout.length, notRequiredCells: notRequired.length, totalCells: known.total.value, expected,
        });
      } else {
        ctx.anomaly(at(G.TOTAL_CELLS), 'TOUCH_GRID_TOTAL_CELLS_RELATION_BROKEN', {
          gridCols: known.cols.value, gridRows: known.rows.value, cutoutCells: cutout.length, totalCells: known.total.value, expected,
        });
      }
    }
  }
  if (cutout !== null && notRequiredList !== null) { // العلاقة 1: cutoutCells وnotRequiredCells منفصلتان
    const cutoutSet = new Set(cutout);
    const both = notRequiredList.filter((i) => cutoutSet.has(i));
    if (both.length > 0) ctx.anomaly(at(N.TOUCH_GRID_PATTERN_KEYS.NOT_REQUIRED_CELLS), PAN.CUTOUT_NOT_REQUIRED_OVERLAP, {count: both.length, firstIndexes: both.slice(0, 10)});
  }
  if (requiredBasis === RB.NOT_REQUIRED_CELLS_DECLARED && untouched !== null && cutout !== null) { // العلاقة 4: untouchedCells «لا تحوي مقصوصة ولا غير مطلوبة»
    const cutoutSet = new Set(cutout);
    const notRequiredSet = new Set(notRequired);
    const inCutout = untouched.filter((i) => cutoutSet.has(i));
    const inNotRequired = untouched.filter((i) => notRequiredSet.has(i));
    if (inCutout.length > 0 || inNotRequired.length > 0) {
      ctx.anomaly(at(PATH_KEYS.UNTOUCHED_CELLS), PAN.UNTOUCHED_CELL_NOT_REQUIRED, {
        inCutout: inCutout.length, inNotRequired: inNotRequired.length, firstIndexes: [...inCutout, ...inNotRequired].slice(0, 10),
      });
    }
  }
  if (out.gridPatternState === PGS.DECLARED && notRequiredList !== null) {
    if (out.gridPattern === N.TOUCH_GRID_PATTERN.ALL_CELLS && notRequiredList.length > 0) { // «فارغة [] لـALL_CELLS»
      ctx.anomaly(at(N.TOUCH_GRID_PATTERN_KEYS.NOT_REQUIRED_CELLS), PAN.ALL_CELLS_WITH_NOT_REQUIRED, {count: notRequiredList.length});
    }
    // حدّ الخادم الأدنى للنمط FRAME_AND_DIAGONALS (البند 6): لا خلية من الحواف الأربع في notRequiredCells. **لا هندسة قطرين هنا** (القاعدة 24: الهندسة للتطبيق وحده).
    if (out.gridPattern === N.TOUCH_GRID_PATTERN.FRAME_AND_DIAGONALS && known.cols.status === S.PRESENT && known.rows.status === S.PRESENT && known.cols.value > 0 && known.rows.value > 0) {
      const cols = known.cols.value;
      const rows = known.rows.value;
      const onFrame = notRequiredList.filter((i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        return r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      });
      if (onFrame.length > 0) ctx.anomaly(at(N.TOUCH_GRID_PATTERN_KEYS.NOT_REQUIRED_CELLS), PAN.FRAME_CELL_NOT_REQUIRED, {count: onFrame.length, firstIndexes: onFrame.slice(0, 10)});
    }
  }
  if (known.touched.status === S.PRESENT && known.total.status === S.PRESENT && untouched !== null && known.touched.value + untouched.length !== known.total.value) {
    ctx.anomaly(at(G.TOUCHED_CELLS), 'TOUCH_GRID_TOUCHED_UNTOUCHED_SUM_MISMATCH', {touchedCells: known.touched.value, untouchedCells: untouched.length, totalCells: known.total.value});
  }
  const endKind = known.endReason.state === null ? null : known.endReason.state.kind;
  if (endKind === N.TOUCH_GRID_END_REASON.AUTO_COMPLETE && ((untouched !== null && untouched.length > 0) ||
      (known.touched.status === S.PRESENT && known.total.status === S.PRESENT && known.touched.value !== known.total.value))) {
    ctx.anomaly(at(G.END_REASON), 'TOUCH_GRID_AUTO_COMPLETE_NOT_COMPLETE', {
      touchedCells: known.touched.value, totalCells: known.total.value, untouchedCells: untouched === null ? null : untouched.length,
    });
  }

  // الخامّ والعلامات والسقف
  const cap = readPathCap(ctx, raw, at);
  out.pathCap = cap.value;
  out.pathCapStatus = cap.status;
  const strokesRead = readStrokes(ctx, raw, at, reasons);
  out.strokes = strokesRead.value;
  out.strokesStatus = strokesRead.status;
  const displayed = readDisplayedSuspects(ctx, raw, at, strokesRead);
  out.displayedSuspects = displayed.value;
  out.displayedSuspectsStatus = displayed.status;
  // «reached = بلغت العيّنات المسجَّلة maxPoints (15,000) ولو لم تُسقَط عيّنة»، و«عيّنة غير منتهية لا تُكتب وتُعدّ في pathCap.pointsDropped» (قسم f9e0571، «حالة التنفيذ ← pathCap» و«strokes[]»):
  // فالنقاط المسقطة تجتمع مع reached=false (عيّنة غير منتهية) — **كان هنا شذوذ «reached=false مع pointsDropped>0» (TOUCH_PATH_CAP_INCONSISTENT)؛ خالفه افتراضٌ لي وأيّد القسمُ المُنتِجَ فأُزيل**؛
  // والباقي قائم: reached=false والمسجَّلة ≥ maxPoints تناقض (بلغت ولم يُعلَن)، وreached=true والمسجَّلة ≠ maxPoints تناقض (لا يُحكم إلا حين كل الخطوط صالحة فالعدّ كامل).
  if (strokesRead.value !== null && cap.value !== null && cap.value.maxPointsStatus === S.PRESENT && cap.value.reachedStatus === S.PRESENT) {
    if (cap.value.reached === false && strokesRead.value.pointsTotal >= cap.value.maxPoints) {
      ctx.anomaly(at(PATH_KEYS.PATH_CAP), 'TOUCH_PATH_POINTS_EXCEED_CAP', {maxPoints: cap.value.maxPoints, pointsTotal: strokesRead.value.pointsTotal});
    }
    if (cap.value.reached === true && strokesRead.value.unusableCount === 0 && strokesRead.value.pointsTotal !== cap.value.maxPoints) {
      ctx.anomaly(at(PATH_KEYS.PATH_CAP), 'TOUCH_PATH_CAP_REACHED_POINTS_MISMATCH', {maxPoints: cap.value.maxPoints, pointsTotal: strokesRead.value.pointsTotal});
    }
  }

  // أحكام الخادم على الخامّ (touchPath.js). لا تُسقط بقيّة القراءات: استثناء ⇒ ANALYSIS_ERROR معلَن
  const DET = N.TOUCH_PATH_DETECTION_STATE;
  if (strokesRead.normalized === null) {
    out.analysis = {detector: {state: DET.UNDETERMINED_NO_STROKES_READ}};
  } else {
    try {
      out.analysis = analyzeTouchPath({
        strokes: strokesRead.normalized,
        geometry: {
          surfaceWidthPx: out[PATH_KEYS.SURFACE_WIDTH_PX], surfaceHeightPx: out[PATH_KEYS.SURFACE_HEIGHT_PX], pxPerMm: out[PATH_KEYS.PX_PER_MM],
          gridCols: known.cols.value, gridRows: known.rows.value, cellWidthPx: out[PATH_KEYS.CELL_WIDTH_PX], cellHeightPx: out[PATH_KEYS.CELL_HEIGHT_PX],
        },
        reportedCells: {cutout, notRequired, untouched, touchedCount: known.touched.status === S.PRESENT ? known.touched.value : null},
        displayed: displayed.items,
      });
      const cellsCheck = out.analysis.cells;
      if (cellsCheck.state === N.TOUCH_PATH_CELLS_CHECK.DISAGREE) {
        ctx.anomaly(basePath, 'TOUCH_GRID_CELLS_DISAGREE_WITH_PATH', {
          pathTouchedCount: cellsCheck.pathTouchedCount, reportedTouchedCount: cellsCheck.reportedTouchedCount,
          touchedByPathNotByApp: cellsCheck.touchedByPathNotByApp.total, touchedByAppNotByPath: cellsCheck.touchedByAppNotByPath.total,
        });
      }
    } catch (e) {
      const message = sanitizeFailureText(e);
      out.analysis = {detector: {state: DET.ANALYSIS_ERROR, error: message}};
      ctx.anomaly(basePath, 'TOUCH_PATH_ANALYSIS_ERROR', {message});
    }
  }
  return out;
}

// جواب M-02 اليدوي وعلاقته بالخامّ — حالة صريحة في أعلى المخرَج (القاعدة 22). السبب والحدود: fv68Names.TOUCH_GRID_ANSWER_STATE.
function readTouchGridAnswer(ctx, measurements) {
  const A = N.TOUCH_GRID_ANSWER_STATE;
  const R = N.TOUCH_GRID_PASS_RAW_RELATION;
  const id = N.MEASURED_TEST_IDS.TOUCH_GRID;
  const index = ctx.parts.manualResults.findIndex((e) => isObj(e) && e.testId === id);
  if (index < 0) return {state: A.NOT_IN_MANUAL_RESULTS, manualStatus: null, passRawRelation: R.NOT_APPLICABLE_NO_RAW, rawEndReason: null};
  const entry = ctx.parts.manualResults[index];
  const manualStatus = isStr(entry.status) ? entry.status : null;
  const item = measurements.items.find((i) => i.source === 'manualResults' && i.testId === id) || null;
  const isPass = manualStatus === N.MANUAL_STATUS_PASS;
  if (item === null) {
    return {state: isPass ? A.PASS_WITHOUT_RAW : A.OTHER_STATUS_WITHOUT_RAW, manualStatus, passRawRelation: R.NOT_APPLICABLE_NO_RAW, rawEndReason: null};
  }
  if (item.touchGrid === undefined) {
    return {state: A.RAW_UNREADABLE, manualStatus, passRawRelation: R.UNDETERMINED_NO_END_REASON, rawEndReason: null};
  }
  const tg = item.touchGrid;
  const kind = tg.endReasonState && tg.endReasonState.recognized ? tg.endReasonState.kind : null;
  let relation = R.NOT_APPLICABLE_STATUS_NOT_PASS;
  if (isPass) {
    if (kind === null) relation = R.UNDETERMINED_NO_END_REASON;
    else relation = kind === N.TOUCH_GRID_END_REASON.AUTO_COMPLETE ? R.BACKS_PASS : R.DOES_NOT_BACK_PASS;
  }
  return {state: A.RAW_PRESENT, manualStatus, passRawRelation: relation, rawEndReason: tg.endReason};
}

// ═══════════════════════════════════════════════════════════════════
// ١١-جـ) أزرار الصوت M-09/M-10 في fv71 — أحداث المفاتيح الخامّة: القسم §٧-ي ف-04 (docs/FV71_CONTRACT_SECTION.md) — S-VOL، 2026-10-18 +03
// ═══════════════════════════════════════════════════════════════════
// نفس منهج M-02: كل مفتاح بقيمته وحالته `<مفتاح>Status` وسبب غيابه حين يُعلَن (القاعدة 22)، وكتلة بحالتها وحدها تحت ختم < 71 (القسم: measurements «غائب (null)» في fv70)، ومفتاح غير معروف
// أو مبكّر شذوذ (القاعدة 25). **الأسماء [م] لم تُقرّ بعد** (القسم ف-04) وما يعلّقه القسم مُدرَج في fv68Names (أيّ الاختبارين رفع وأيّهما خفض، نوع flags، معنى العدّادين).
// ما يحسبه القارئ بلا حكم: eventsTruncated (eventsTotal > السقف)، وحالة events (EMPTY لا تعني «لم يضغط»)، وpressEvidence (دليل الضغط: حدث مفتاح · تغيّر مستوى · غير مثبَت).
const VOL_KEYS = N.VOLUME_BUTTON_MEASUREMENT_KEYS;
const VOL_SPEC = N.VOLUME_BUTTON_FIELD_SPEC;
const VOL_EVENT = N.VOLUME_BUTTON_EVENT_KEYS;

function readVolumeEvents(ctx, raw, at, put) {
  const S = N.KEY_STATUS;
  const c = cell(ctx, raw, VOL_KEYS.EVENTS, 'array', at(VOL_KEYS.EVENTS));
  const total = cell(ctx, raw, VOL_KEYS.EVENTS_TOTAL, 'int', at(VOL_KEYS.EVENTS_TOTAL));
  const problems = makeProblemCollector();
  const items = [];
  if (c.status === S.PRESENT) {
    c.value.forEach((el, i) => {
      if (!isObj(el)) {
        problems.add('NOT_OBJECT', i, typeOf(el));
        return;
      }
      const intKeys = [VOL_EVENT.T_MS, VOL_EVENT.KEY_CODE, VOL_EVENT.REPEAT, VOL_EVENT.DEVICE_ID, VOL_EVENT.SOURCE];
      const badKeys = intKeys.filter((k) => !Number.isInteger(el[k]));
      for (const k of badKeys) problems.add('FIELD_INVALID', i, k);
      if (Number.isInteger(el[VOL_EVENT.REPEAT]) && el[VOL_EVENT.REPEAT] < 0) problems.add('FIELD_INVALID', i, VOL_EVENT.REPEAT);
      // «عائلة الصوت (24 · 25 · 164 كتم)؛ وغيرها يُهمَل» (قسم f9e0571): مفتاح خارجها في events[] لا يكتبه التطبيق
      if (Number.isInteger(el[VOL_EVENT.KEY_CODE]) && !N.VOLUME_BUTTON_EVENT_KEY_CODES.includes(el[VOL_EVENT.KEY_CODE])) problems.add('KEY_OUTSIDE_FAMILY', i, el[VOL_EVENT.KEY_CODE]);
      const action = isStr(el[VOL_EVENT.ACTION]) ? parseState(el[VOL_EVENT.ACTION], N.VOCAB.VOLUME_BUTTON_EVENT_ACTION) : null;
      if (action === null) problems.add('ACTION_INVALID', i, typeOf(el[VOL_EVENT.ACTION]));
      else if (!action.recognized) problems.add('ACTION_UNRECOGNIZED', i, el[VOL_EVENT.ACTION]);
      items.push({
        tMs: el[VOL_EVENT.T_MS], keyCode: el[VOL_EVENT.KEY_CODE], action: action === null ? null : action.kind, actionRecognized: action !== null && action.recognized,
        repeat: el[VOL_EVENT.REPEAT], deviceId: el[VOL_EVENT.DEVICE_ID], source: el[VOL_EVENT.SOURCE],
      });
    });
  }
  const problemCodes = problems.flush(ctx, at(VOL_KEYS.EVENTS), 'VOLUME_EVENT_');
  const cap = N.VOLUME_BUTTON_EVENTS_CAP;
  const listed = c.status === S.PRESENT ? c.value.length : null;
  const totalValue = total.status === S.PRESENT ? total.value : null;
  // السقف والعدّ: «eventsTotal: العدد قبل السقف؛ eventsTotal > 64 ⇒ قُصَّت القائمة، ويُعلنه القارئ»
  if (listed !== null && listed > cap) ctx.anomaly(at(VOL_KEYS.EVENTS), 'VOLUME_EVENTS_OVER_CAP', {listed, cap});
  if (listed !== null && totalValue !== null) {
    if (totalValue < listed) ctx.anomaly(at(VOL_KEYS.EVENTS_TOTAL), 'VOLUME_EVENTS_TOTAL_BELOW_LIST', {listed, eventsTotal: totalValue});
    else if (totalValue <= cap && totalValue !== listed) ctx.anomaly(at(VOL_KEYS.EVENTS_TOTAL), 'VOLUME_EVENTS_TOTAL_MISMATCH', {listed, eventsTotal: totalValue});
    else if (totalValue > cap && listed !== cap && listed <= cap) ctx.anomaly(at(VOL_KEYS.EVENTS_TOTAL), 'VOLUME_EVENTS_TRUNCATION_INCONSISTENT', {listed, eventsTotal: totalValue, cap});
  }
  const truncated = totalValue === null ? null : totalValue > cap;
  const complete = listed !== null && totalValue !== null && totalValue <= cap && listed === totalValue && problemCodes.length === 0;
  for (const [key, r] of [[VOL_KEYS.EVENTS, c], [VOL_KEYS.EVENTS_TOTAL, total]]) {
    if (r.status === S.ABSENT) ctx.anomaly(at(key), 'VOLUME_REQUIRED_KEY_ABSENT', {key});
  }
  put(VOL_KEYS.EVENTS, {value: c.status === S.PRESENT ? {state: listed === 0 ? 'EMPTY' : 'HAS_EVENTS', count: listed, problemCodes, items} : null, status: c.status});
  put(VOL_KEYS.EVENTS_TOTAL, {value: totalValue, status: total.status});
  return {items: c.status === S.PRESENT ? items : null, listed, total: totalValue, truncated, complete};
}

function readVolumeButton(ctx, raw, basePath, sinceFv71) {
  const S = N.KEY_STATUS;
  const VS = N.VOLUME_BUTTON_STATE;
  const P = N.VOLUME_BUTTON_PRESENCE;
  const at = (k) => `${basePath}.${k}`;
  const presentNew = Object.keys(VOL_SPEC).filter((k) => has(raw, k) && raw[k] !== null && raw[k] !== undefined);
  if (!sinceFv71) {
    if (presentNew.length > 0) ctx.anomaly(basePath, 'VOLUME_KEYS_PRESENT_BEFORE_FV71', {keys: presentNew});
    return {state: ctx.fieldsVersion === null ? VS.UNDETERMINED_NO_FIELDS_VERSION : VS.NOT_IN_FIELDS_VERSION, unexpectedKeys: presentNew};
  }
  const out = {state: VS.READ};
  const knownKeys = new Set([...Object.keys(VOL_SPEC), N.MEASUREMENTS_UNENCODABLE_KEY, N.MEASUREMENTS_UNREADABLE_KEY]);
  out.unknownKeys = Object.keys(raw).filter((k) => !knownKeys.has(k)).sort();
  if (out.unknownKeys.length > 0) ctx.anomaly(basePath, 'VOLUME_UNKNOWN_KEY', {keys: out.unknownKeys});
  const put = (key, r) => {
    out[key] = r.value;
    out[`${key}Status`] = r.status;
    if (r.reason !== undefined) out[`${key}Reason`] = r.reason;
  };
  const intCell = (key) => cell(ctx, raw, key, 'int', at(key));
  const required = (key, r) => {
    if (r.status === S.ABSENT) ctx.anomaly(at(key), 'VOLUME_REQUIRED_KEY_ABSENT', {key});
    return {value: r.value, status: r.status};
  };

  const ev = readVolumeEvents(ctx, raw, at, put);
  out.eventsTruncated = ev.truncated;

  // expectedKeyCode: 24 أو 25 (الاسمان KEYCODE_VOLUME_UP/DOWN)؛ غير ذلك شذوذ (لا يُلحَق بأقربهما). أيّ الاختبارين أيّهما معلّق.
  const keyCode = required(VOL_KEYS.EXPECTED_KEY_CODE, intCell(VOL_KEYS.EXPECTED_KEY_CODE));
  put(VOL_KEYS.EXPECTED_KEY_CODE, keyCode);
  if (keyCode.status === S.PRESENT && !Object.values(N.VOLUME_BUTTON_KEY_CODE).includes(keyCode.value)) {
    ctx.anomaly(at(VOL_KEYS.EXPECTED_KEY_CODE), 'VOLUME_EXPECTED_KEY_CODE_UNRECOGNIZED', {value: keyCode.value});
  }
  const expectedDown = required(VOL_KEYS.EXPECTED_DOWN_COUNT, intCell(VOL_KEYS.EXPECTED_DOWN_COUNT));
  const otherDown = required(VOL_KEYS.OTHER_KEY_DOWN_COUNT, intCell(VOL_KEYS.OTHER_KEY_DOWN_COUNT));
  const windowMs = required(VOL_KEYS.WINDOW_MS, intCell(VOL_KEYS.WINDOW_MS));
  put(VOL_KEYS.EXPECTED_DOWN_COUNT, expectedDown);
  put(VOL_KEYS.OTHER_KEY_DOWN_COUNT, otherDown);
  put(VOL_KEYS.WINDOW_MS, windowMs);
  for (const r of [expectedDown, otherDown]) {
    if (r.status === S.PRESENT && r.value < 0) ctx.anomaly(basePath, 'VOLUME_COUNT_NEGATIVE', {value: r.value});
  }
  // العدّادان «يعدّان ضغطات (down بـrepeat = 0)؛ تكرارات المفتاح المضغوط في events[] بـrepeat > 0 فقط» (قسم f9e0571): حين القائمة كاملة (eventsTotal = المسرود ≤ السقف ولا مشكلة في عناصرها)
  // يطابق كلٌّ منهما عدّاً مستقلاً من events[] — وإلا شذوذ. (كان تعريفهما معلّقاً قبل القسم؛ ولا يُحكم بالتطابق مع قائمة مبتورة.)
  if (ev.complete && ev.items !== null && keyCode.status === S.PRESENT && expectedDown.status === S.PRESENT && otherDown.status === S.PRESENT) {
    const presses = ev.items.filter((e) => e.action === N.VOLUME_BUTTON_EVENT_ACTION.DOWN && e.repeat === 0);
    const derivedExpected = presses.filter((e) => e.keyCode === keyCode.value).length;
    const derivedOther = presses.length - derivedExpected;
    if (derivedExpected !== expectedDown.value) {
      ctx.anomaly(at(VOL_KEYS.EXPECTED_DOWN_COUNT), 'VOLUME_COUNT_DISAGREES_WITH_EVENTS', {key: VOL_KEYS.EXPECTED_DOWN_COUNT, shipped: expectedDown.value, derived: derivedExpected});
    }
    if (derivedOther !== otherDown.value) {
      ctx.anomaly(at(VOL_KEYS.OTHER_KEY_DOWN_COUNT), 'VOLUME_COUNT_DISAGREES_WITH_EVENTS', {key: VOL_KEYS.OTHER_KEY_DOWN_COUNT, shipped: otherDown.value, derived: derivedOther});
    }
  }

  // endReason: القيم الخمس؛ وغيرها يُعلَن غير معروف
  const end = stateCell(ctx, raw, VOL_KEYS.END_REASON, N.VOCAB.VOLUME_BUTTON_END_REASON, at(VOL_KEYS.END_REASON));
  if (end.status === S.ABSENT) ctx.anomaly(at(VOL_KEYS.END_REASON), 'VOLUME_REQUIRED_KEY_ABSENT', {key: VOL_KEYS.END_REASON});
  put(VOL_KEYS.END_REASON, {value: strOrNull(raw[VOL_KEYS.END_REASON]), status: end.status});
  out.endReasonState = end.state;
  const endKind = end.state !== null && end.state.recognized ? end.state.kind : null;
  const endAuto = endKind === N.VOLUME_BUTTON_END_REASON.AUTO_DETECTED;

  // detectionSource: حاضر ⟺ endReason = auto_detected (لا قيمة افتراضية)
  const det = stateCell(ctx, raw, VOL_KEYS.DETECTION_SOURCE, N.VOCAB.VOLUME_BUTTON_DETECTION_SOURCE, at(VOL_KEYS.DETECTION_SOURCE));
  let detStatus = det.status;
  if (det.status === S.PRESENT) {
    if (endKind !== null && !endAuto) ctx.anomaly(at(VOL_KEYS.DETECTION_SOURCE), 'VOLUME_DETECTION_SOURCE_WITHOUT_AUTO_DETECTED', {endReason: endKind, detectionSource: raw[VOL_KEYS.DETECTION_SOURCE]});
  } else if (det.status === S.ABSENT) {
    if (endAuto) ctx.anomaly(at(VOL_KEYS.DETECTION_SOURCE), 'VOLUME_DETECTION_SOURCE_ABSENT_WHEN_AUTO_DETECTED', null);
    else if (endKind !== null) detStatus = S.ABSENT_DECLARED; // endReason ≠ auto_detected: غيابه هو التصميم
  }
  put(VOL_KEYS.DETECTION_SOURCE, {value: strOrNull(raw[VOL_KEYS.DETECTION_SOURCE]), status: detStatus});
  out.detectionSourceState = det.state;
  const detKind = det.state !== null && det.state.recognized ? det.state.kind : null;
  if (detKind === N.VOLUME_BUTTON_DETECTION_SOURCE.KEY_EVENT && expectedDown.status === S.PRESENT && expectedDown.value === 0) {
    ctx.anomaly(at(VOL_KEYS.DETECTION_SOURCE), 'VOLUME_KEY_EVENT_SOURCE_WITHOUT_KEY_DOWN', null);
  }

  // timeToFirstExpectedDownMs ⟷ expectedDownCount
  const ttf = intCell(VOL_KEYS.TIME_TO_FIRST_EXPECTED_DOWN_MS);
  const edc = expectedDown.status === S.PRESENT ? expectedDown.value : null;
  let ttfStatus = ttf.status;
  if (ttf.status === S.PRESENT) {
    if (edc === 0) ctx.anomaly(at(VOL_KEYS.TIME_TO_FIRST_EXPECTED_DOWN_MS), 'VOLUME_TIME_TO_FIRST_DOWN_WITHOUT_EXPECTED_DOWN', null);
  } else if (ttf.status === S.ABSENT) {
    if (edc === 0) ttfStatus = S.ABSENT_DECLARED; // «غائب إن لم يحدث ضغط مطلوب»
    else if (edc !== null && edc > 0) ctx.anomaly(at(VOL_KEYS.TIME_TO_FIRST_EXPECTED_DOWN_MS), 'VOLUME_TIME_TO_FIRST_DOWN_ABSENT_DESPITE_DOWN', {expectedDownCount: edc});
  }
  put(VOL_KEYS.TIME_TO_FIRST_EXPECTED_DOWN_MS, {value: ttf.value, status: ttfStatus});

  // holdMs: «غائب إن لم يصل up بعد ضغط مطلوب»
  const hold = intCell(VOL_KEYS.HOLD_MS);
  let holdStatus = hold.status;
  const upAfterDown = () => {
    if (ev.items === null) return null;
    const code = keyCode.status === S.PRESENT ? keyCode.value : null;
    if (code === null) return null;
    const firstDown = ev.items.findIndex((e) => e.keyCode === code && e.action === N.VOLUME_BUTTON_EVENT_ACTION.DOWN);
    if (firstDown < 0) return false;
    return ev.items.some((e, i) => i > firstDown && e.keyCode === code && e.action === N.VOLUME_BUTTON_EVENT_ACTION.UP);
  };
  if (hold.status === S.PRESENT) {
    if (edc === 0) ctx.anomaly(at(VOL_KEYS.HOLD_MS), 'VOLUME_HOLD_WITHOUT_EXPECTED_DOWN', null);
  } else if (hold.status === S.ABSENT) {
    if (edc === 0) holdStatus = S.ABSENT_DECLARED;
    else if (edc !== null && ev.complete) {
      const up = upAfterDown();
      if (up === true) ctx.anomaly(at(VOL_KEYS.HOLD_MS), 'VOLUME_HOLD_ABSENT_DESPITE_UP', null);
      else if (up === false) holdStatus = S.ABSENT_DECLARED; // ضغط بلا up في قائمة كاملة
    }
  }
  put(VOL_KEYS.HOLD_MS, {value: hold.value, status: holdStatus});

  // flags: النوع غير محدَّد في القسم (معلّق): حضوره وقيمته كما وصلت بلا فحص
  put(VOL_KEYS.FLAGS, has(raw, VOL_KEYS.FLAGS) && raw[VOL_KEYS.FLAGS] !== null && raw[VOL_KEYS.FLAGS] !== undefined ?
    {value: raw[VOL_KEYS.FLAGS], status: S.PRESENT} : {value: null, status: absentStatus(ctx, at(VOL_KEYS.FLAGS))});

  // مستويات الصوت: أعداد صحيحة؛ مُدخلات قرار الكشف بتغيّر المستوى (القاعدة 20)
  const lvl = {};
  for (const key of [VOL_KEYS.VOLUME_STREAM_MAX, VOL_KEYS.VOLUME_LEVEL_AT_OPEN, VOL_KEYS.VOLUME_LEVEL_AT_END]) {
    lvl[key] = intCell(key);
    put(key, {value: lvl[key].value, status: lvl[key].status});
    if (lvl[key].status === S.PRESENT && lvl[key].value < 0) ctx.anomaly(at(key), 'VOLUME_LEVEL_NEGATIVE', {value: lvl[key].value});
    if (lvl[key].status === S.ABSENT && detKind === N.VOLUME_BUTTON_DETECTION_SOURCE.VOLUME_LEVEL_CHANGE) {
      ctx.anomaly(at(key), 'VOLUME_LEVEL_INPUT_ABSENT_FOR_LEVEL_DETECTION', {key});
    }
  }
  const max = lvl[VOL_KEYS.VOLUME_STREAM_MAX];
  if (max.status === S.PRESENT) {
    for (const key of [VOL_KEYS.VOLUME_LEVEL_AT_OPEN, VOL_KEYS.VOLUME_LEVEL_AT_END]) {
      if (lvl[key].status === S.PRESENT && lvl[key].value > max.value) ctx.anomaly(at(key), 'VOLUME_LEVEL_ABOVE_STREAM_MAX', {value: lvl[key].value, volumeStreamMax: max.value});
    }
    if (max.value < 2 && (lvl[VOL_KEYS.VOLUME_LEVEL_AT_OPEN].status === S.PRESENT || lvl[VOL_KEYS.VOLUME_LEVEL_AT_END].status === S.PRESENT)) {
      ctx.anomaly(at(VOL_KEYS.VOLUME_STREAM_MAX), 'VOLUME_LEVELS_PRESENT_BELOW_MIN_RANGE', {volumeStreamMax: max.value}); // «الضبط لا يجري إن لم يكن maxVol ≥ 2»
    }
  }

  // دليل الضغط بلا حكم
  const PE = N.VOLUME_BUTTON_PRESS_EVIDENCE;
  out.pressEvidence = edc !== null && edc > 0 ? PE.KEY_EVENT_SEEN :
    (detKind === N.VOLUME_BUTTON_DETECTION_SOURCE.VOLUME_LEVEL_CHANGE ? PE.LEVEL_CHANGE_ONLY : PE.NOT_ESTABLISHED);
  return out;
}

// جواب M-09/M-10 اليدوي — حالة صريحة لكل اختبار (القاعدة 22): بلا measurements ليس خطأً ولا نجاحاً مفترَضاً
function readVolumeButtonAnswers(ctx, measurements) {
  const A = N.VOLUME_BUTTON_ANSWER_STATE;
  const out = {};
  for (const id of N.VOLUME_BUTTON_TEST_IDS) {
    const index = ctx.parts.manualResults.findIndex((e) => isObj(e) && e.testId === id);
    if (index < 0) {
      out[id] = {state: A.NOT_IN_MANUAL_RESULTS, manualStatus: null};
      continue;
    }
    const entry = ctx.parts.manualResults[index];
    const manualStatus = isStr(entry.status) ? entry.status : null;
    const item = measurements.items.find((i) => i.source === 'manualResults' && i.testId === id) || null;
    if (item === null) out[id] = {state: A.WITHOUT_RAW, manualStatus};
    else out[id] = {state: item.volumeButton === undefined ? A.RAW_UNREADABLE : A.RAW_PRESENT, manualStatus};
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// ١١-د) P6-13 توحيد الظروف في fv71: powerSaveState · brightnessLock · batteryWindowPct — القسم §٧-ي ف-05 (docs/FV71_CONTRACT_SECTION.md) — S-P6-13، 2026-10-18 +03
// ═══════════════════════════════════════════════════════════════════
// قسم علوي `scanConditions`: كل مفتاح بقيمته وحالته `<مفتاح>Status` (القاعدة 22). تحت ختم < 71 المفاتيح الثلاثة الجديدة NOT_IN_FIELDS_VERSION وحضورها شذوذ (القاعدة 25) ويُقرأ المنطقيّان القديمان
// بأساسهما (LEGACY_BOOLEAN_ONLY: فشل القراءة يُكتب false فلا يتميّز). **الخادم لا يحمل 30 ولا 85** (القسم N71-06): النافذة تُعلَن في الحمولة. و«البداية الساخنة» معلّقة (fv68Names).
// لا حكم هنا: startLevelVsWindow وصف (داخل/تحت/فوق/مجهول) يُسلَّم مع الخامّ.
function readScanConditions(ctx, timeSeriesState) {
  const S = N.KEY_STATUS;
  const K2 = N.SCAN_CONDITIONS_KEYS;
  const SS = N.SCAN_CONDITIONS_STATE;
  const header = ctx.parts.header;
  const root = ctx.parts.root;
  const footer = ctx.footer;
  const since = ctx.sinceFv71;
  const out = {state: ctx.fieldsVersion === null ? SS.UNDETERMINED_NO_FIELDS_VERSION : (since ? SS.READ : SS.NOT_IN_FIELDS_VERSION)};
  // مفتاح جديد غائب تحت ختم < 71: «لم يوجد بعد» لا ABSENT (absentStatus يعدّ ≥ 68 مُنطبِقاً)
  const newCell = (container, key, type, path) => {
    const c = cell(ctx, container, key, type, path);
    return !since && c.status === S.ABSENT ? {...c, status: S.NOT_IN_FIELDS_VERSION} : c;
  };
  const early = [];
  const presentNew = (container, key, where) => {
    if (isObj(container) && has(container, key) && container[key] !== null && container[key] !== undefined) early.push(where);
  };
  presentNew(header, K2.POWER_SAVE_STATE, `header.${K2.POWER_SAVE_STATE}`);
  presentNew(root, K2.POWER_SAVE_STATE, `root.${K2.POWER_SAVE_STATE}`);
  presentNew(footer, K2.BRIGHTNESS_LOCK, `footer.${K2.BRIGHTNESS_LOCK}`);
  presentNew(footer, K2.BATTERY_WINDOW_PCT, `footer.${K2.BATTERY_WINDOW_PCT}`);
  if (!since && early.length > 0) ctx.anomaly('scanConditions', 'SCAN_CONDITIONS_KEYS_PRESENT_BEFORE_FV71', {keys: early});
  out.unexpectedKeys = since ? [] : early;

  // ─── توفير الطاقة: المنطقيّان القديمان (يُقرآن دائماً) والحالة الجديدة في الموضعين ───
  const location = (container, stateKey, boolKey, where, boolPath) => {
    const bool = cell(ctx, container, boolKey, 'boolean', boolPath);
    const st = newCell(container, stateKey, 'string', `${where}.${stateKey}`);
    const parsed = st.status === S.PRESENT ? parseState(st.value, N.VOCAB.POWER_SAVE_STATE) : null;
    if (parsed !== null && !parsed.recognized) ctx.anomaly(`${where}.${stateKey}`, 'UNRECOGNIZED_STATE', {raw: parsed.raw});
    if (since && st.status === S.ABSENT) ctx.anomaly(`${where}.${stateKey}`, 'POWER_SAVE_STATE_ABSENT', {where});
    if (since && parsed !== null && parsed.recognized) {
      // «on ⇒ true، off ⇒ false، read_failed ⇒ غائب (لا false)» (القسم ف-05)
      if (parsed.kind === N.POWER_SAVE_STATE.READ_FAILED) {
        if (bool.status === S.PRESENT) ctx.anomaly(boolPath, 'POWER_SAVE_BOOLEAN_PRESENT_FOR_READ_FAILED', {where, value: bool.value});
      } else if (bool.status === S.ABSENT) {
        ctx.anomaly(boolPath, 'POWER_SAVE_BOOLEAN_ABSENT_FOR_STATE', {where, state: parsed.kind});
      } else if (bool.status === S.PRESENT && bool.value !== (parsed.kind === N.POWER_SAVE_STATE.ON)) {
        ctx.anomaly(boolPath, 'POWER_SAVE_BOOLEAN_DISAGREES_WITH_STATE', {where, state: parsed.kind, value: bool.value});
      }
    }
    // «read_failed ⇒ غائب (لا false)» (القسم ف-05): غيابٌ تشرحه حالةٌ شقيقة حاضرة ⇒ ABSENT_DECLARED (تعريف fv68Names.KEY_STATUS) لا ABSENT؛ وغيابه مع off/on يبقى ABSENT (+ شذوذ أعلاه)
    const boolStatus = since && bool.status === S.ABSENT && parsed !== null && parsed.recognized && parsed.kind === N.POWER_SAVE_STATE.READ_FAILED ? S.ABSENT_DECLARED : bool.status;
    return {
      [boolKey]: bool.value, [`${boolKey}Status`]: boolStatus,
      [stateKey]: st.status === S.PRESENT ? st.value : null, [`${stateKey}Status`]: st.status, [`${stateKey}State`]: parsed,
    };
  };
  out.header = location(header, K2.POWER_SAVE_STATE, K2.IS_POWER_SAVE_MODE, 'header', `header.${K2.IS_POWER_SAVE_MODE}`);
  out.root = location(root, K2.POWER_SAVE_STATE, K2.POWER_SAVE_MODE, 'root', `root.${K2.POWER_SAVE_MODE}`);
  const hs = out.header[K2.POWER_SAVE_STATE];
  const rs = out.root[K2.POWER_SAVE_STATE];
  if (hs !== null && rs !== null && hs !== rs) ctx.anomaly('scanConditions', 'POWER_SAVE_STATE_HEADER_ROOT_DISAGREE', {header: hs, root: rs});
  out.powerSaveBasis = ctx.fieldsVersion === null ? N.POWER_SAVE_BASIS.UNDETERMINED_NO_FIELDS_VERSION : (since ? N.POWER_SAVE_BASIS.STATE_DECLARED : N.POWER_SAVE_BASIS.LEGACY_BOOLEAN_ONLY);

  // ─── قفل السطوع {state, value, method} ───
  {
    const BL = N.BRIGHTNESS_LOCK_KEYS;
    const c = newCell(footer, K2.BRIGHTNESS_LOCK, 'object', K2.BRIGHTNESS_LOCK);
    const block = {status: c.status};
    if (since && c.status === S.ABSENT) ctx.anomaly(K2.BRIGHTNESS_LOCK, 'BRIGHTNESS_LOCK_ABSENT', null);
    if (c.status === S.PRESENT) {
      const at = (k) => `${K2.BRIGHTNESS_LOCK}.${k}`;
      const known = new Set(Object.values(BL));
      block.unknownKeys = Object.keys(c.value).filter((k) => !known.has(k)).sort();
      if (block.unknownKeys.length > 0) ctx.anomaly(K2.BRIGHTNESS_LOCK, 'BRIGHTNESS_LOCK_UNKNOWN_KEY', {keys: block.unknownKeys});
      const st = stateCell(ctx, c.value, BL.STATE, N.VOCAB.BRIGHTNESS_LOCK_STATE, at(BL.STATE));
      if (st.status === S.ABSENT) ctx.anomaly(at(BL.STATE), 'BRIGHTNESS_LOCK_STATE_ABSENT', null);
      const value = cell(ctx, c.value, BL.VALUE, 'number', at(BL.VALUE));
      const method = stateCell(ctx, c.value, BL.METHOD, N.VOCAB.BRIGHTNESS_LOCK_METHOD, at(BL.METHOD));
      const kind = st.state !== null && st.state.recognized ? st.state.kind : null;
      let valueStatus = value.status;
      let methodStatus = method.status;
      if (kind === N.BRIGHTNESS_LOCK_STATE.NOT_ATTEMPTED) {
        // «value وmethod غائبان حين state = not_attempted:* (لا صفر)»
        if (value.status === S.PRESENT) ctx.anomaly(at(BL.VALUE), 'BRIGHTNESS_VALUE_WITH_NOT_ATTEMPTED', {value: value.value});
        else if (value.status === S.ABSENT) valueStatus = S.ABSENT_DECLARED;
        if (method.status === S.PRESENT) ctx.anomaly(at(BL.METHOD), 'BRIGHTNESS_METHOD_WITH_NOT_ATTEMPTED', {method: strOrNull(c.value[BL.METHOD])});
        else if (method.status === S.ABSENT) methodStatus = S.ABSENT_DECLARED;
      } else if (kind === N.BRIGHTNESS_LOCK_STATE.APPLIED) {
        if (value.status === S.ABSENT) ctx.anomaly(at(BL.VALUE), 'BRIGHTNESS_VALUE_ABSENT_FOR_APPLIED', null);
        if (method.status === S.ABSENT) ctx.anomaly(at(BL.METHOD), 'BRIGHTNESS_METHOD_ABSENT_FOR_APPLIED', null);
      }
      if (value.status === S.PRESENT && !(value.value >= 0 && value.value <= 1)) ctx.anomaly(at(BL.VALUE), 'BRIGHTNESS_VALUE_OUT_OF_RANGE', {value: value.value}); // «عشرية في [0, 1]»
      block.state = strOrNull(c.value[BL.STATE]);
      block.stateStatus = st.status;
      block.stateState = st.state;
      block.value = value.value;
      block.valueStatus = valueStatus;
      block.method = strOrNull(c.value[BL.METHOD]);
      block.methodStatus = methodStatus;
      block.methodState = method.state;
    }
    out.brightnessLock = block;
  }

  // ─── نافذة الشحن {minPct, maxPct}: يعلنها التطبيق، ولا يحمل الخادم نسخة منها ───
  let window = null;
  {
    const BW = N.BATTERY_WINDOW_KEYS;
    const c = newCell(footer, K2.BATTERY_WINDOW_PCT, 'object', K2.BATTERY_WINDOW_PCT);
    const block = {status: c.status};
    if (since && c.status === S.ABSENT) ctx.anomaly(K2.BATTERY_WINDOW_PCT, 'BATTERY_WINDOW_ABSENT', null);
    if (c.status === S.PRESENT) {
      const at = (k) => `${K2.BATTERY_WINDOW_PCT}.${k}`;
      const known = new Set(Object.values(BW));
      block.unknownKeys = Object.keys(c.value).filter((k) => !known.has(k)).sort();
      if (block.unknownKeys.length > 0) ctx.anomaly(K2.BATTERY_WINDOW_PCT, 'BATTERY_WINDOW_UNKNOWN_KEY', {keys: block.unknownKeys});
      const min = cell(ctx, c.value, BW.MIN_PCT, 'int', at(BW.MIN_PCT));
      const max = cell(ctx, c.value, BW.MAX_PCT, 'int', at(BW.MAX_PCT));
      for (const [k, r] of [[BW.MIN_PCT, min], [BW.MAX_PCT, max]]) {
        if (r.status === S.ABSENT) ctx.anomaly(at(k), 'BATTERY_WINDOW_KEY_ABSENT', {key: k});
        else if (r.status === S.PRESENT && (r.value < 0 || r.value > 100)) ctx.anomaly(at(k), 'BATTERY_WINDOW_OUT_OF_RANGE', {key: k, value: r.value});
      }
      block.minPct = min.value;
      block.minPctStatus = min.status;
      block.maxPct = max.value;
      block.maxPctStatus = max.status;
      if (min.status === S.PRESENT && max.status === S.PRESENT) {
        if (min.value > max.value) ctx.anomaly(K2.BATTERY_WINDOW_PCT, 'BATTERY_WINDOW_MIN_ABOVE_MAX', {minPct: min.value, maxPct: max.value});
        else if (min.value >= 0 && max.value <= 100) window = {minPct: min.value, maxPct: max.value};
      }
    }
    out.batteryWindow = block;
  }
  if (window !== null) out.batteryWindowBasis = N.BATTERY_WINDOW_BASIS.DECLARED_IN_PAYLOAD;
  else if (ctx.fieldsVersion !== null && !since) {
    out.batteryWindowBasis = N.BATTERY_WINDOW_BASIS.LEGACY_FIXED_MIN_NO_MAX;
    window = {minPct: N.BATTERY_WINDOW_LEGACY_MIN_PCT, maxPct: null};
  } else out.batteryWindowBasis = N.BATTERY_WINDOW_BASIS.NO_VALID_WINDOW;

  // ─── بداية الشحن (خامّ كما اليوم) مقابل النافذة ───
  {
    const lvl = cell(ctx, header, K2.BATTERY_LEVEL_START, 'int', `header.${K2.BATTERY_LEVEL_START}`);
    // مستردّ من نسخة التذييل الاحتياطية: لا ترويسة فلا بداية (القسم ف-05: «Int? في البصمة، null حين الملفّ مستردّ من نسخة التذييل الاحتياطية»)
    const fromBackup = timeSeriesState && timeSeriesState.state && timeSeriesState.state.kind !== N.STATE_KIND.FILE;
    const status = lvl.status === S.ABSENT && fromBackup ? S.ABSENT_DECLARED : lvl.status;
    out.batteryLevelStart = lvl.value;
    out.batteryLevelStartStatus = status;
    const SV = N.START_LEVEL_VS_WINDOW;
    let vs;
    if (lvl.status === S.WRONG_TYPE) vs = SV.START_LEVEL_INVALID;
    else if (lvl.status !== S.PRESENT) vs = SV.START_LEVEL_UNKNOWN;
    else if (lvl.value === N.BATTERY_LEVEL_UNKNOWN_SENTINEL) vs = SV.START_LEVEL_UNKNOWN;
    else if (lvl.value < 0 || lvl.value > 100) {
      vs = SV.START_LEVEL_INVALID;
      ctx.anomaly(`header.${K2.BATTERY_LEVEL_START}`, 'BATTERY_LEVEL_START_OUT_OF_RANGE', {value: lvl.value});
    } else if (window === null) vs = SV.NO_WINDOW;
    else if (lvl.value < window.minPct) vs = SV.BELOW_MIN;
    else if (window.maxPct !== null && lvl.value > window.maxPct) vs = SV.ABOVE_MAX;
    else vs = SV.WITHIN;
    out.startLevelVsWindow = vs;
  }
  return out;
}

function readMeasurements(ctx) {
  const items = [];
  const seen = new Set();
  for (const [source, list] of [['functionalResults', ctx.parts.functionalResults], ['manualResults', ctx.parts.manualResults]]) {
    list.forEach((entry, i) => {
      if (!isObj(entry)) return;
      seen.add(`${source}:${entry.testId}`);
      if (!has(entry, N.MEASUREMENTS_KEY)) return;
      items.push({source, testId: isStr(entry.testId) ? entry.testId : null, ...readOneMeasurements(ctx, source, entry, i)});
    });
  }
  // اختبارات يعرف العقد شكل measurements لها وحضرت بلا measurements في ختم ≥ 68: غياب معلن (لا قراءة الغياب نجاحاً).
  const expected = [['functionalResults', N.MEASURED_TEST_IDS.GPS_SATELLITES], ['functionalResults', N.MEASURED_TEST_IDS.STEP_SENSOR_A],
    ['functionalResults', N.MEASURED_TEST_IDS.STEP_SENSOR_B]];
  const missing = [];
  for (const [source, testId] of expected) {
    if (!seen.has(`${source}:${testId}`)) continue; // الاختبار نفسه غائب: لا شيء يُقال عن measurements
    if (!items.some((x) => x.source === source && x.testId === testId)) {
      missing.push({source, testId, status: absentStatus(ctx, `${source}.${testId}.${N.MEASUREMENTS_KEY}`)});
    }
  }
  return {items, expectedButAbsent: missing};
}

// ملخّص الغياب في أعلى المخرَج (القاعدة 22: «حالة صريحة تظهر في أعلى مستوى»): كل خلية حالتها غياب، بمسارها في هذا المخرَج.
// ABSENT (غياب بلا سبب معلن) وABSENT_DECLARED (بسبب في حالة شقيقة) وNOT_IN_FILE تُسرد مساراتها؛ NOT_IN_FIELDS_VERSION (ختم < 68)
// وREMOVED_IN_FV68 تُعدّان فقط — غيابهما متوقَّع بالإصدار/بالعقد.
const ABSENCE_STATUSES = [N.KEY_STATUS.ABSENT, N.KEY_STATUS.ABSENT_DECLARED, N.KEY_STATUS.NOT_IN_FILE,
  N.KEY_STATUS.NOT_IN_FIELDS_VERSION, N.KEY_STATUS.REMOVED_IN_FV68];
function summarizeAbsences(sections) {
  const byStatus = {[N.KEY_STATUS.ABSENT]: [], [N.KEY_STATUS.ABSENT_DECLARED]: [], [N.KEY_STATUS.NOT_IN_FILE]: []};
  let notInFieldsVersion = 0;
  let removedInFv68 = 0;
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const p = path === '' ? k : `${path}.${k}`;
      if (isStr(v) && ABSENCE_STATUSES.includes(v) && /status$/i.test(k)) {
        if (v === N.KEY_STATUS.NOT_IN_FIELDS_VERSION) notInFieldsVersion++;
        else if (v === N.KEY_STATUS.REMOVED_IN_FV68) removedInFv68++;
        else byStatus[v].push(p);
      } else {
        walk(v, p);
      }
    }
  };
  walk(sections, '');
  return {
    ABSENT: byStatus.ABSENT,
    ABSENT_DECLARED: byStatus.ABSENT_DECLARED,
    NOT_IN_FILE: byStatus.NOT_IN_FILE,
    notInFieldsVersionCount: notInFieldsVersion,
    removedInFv68Count: removedInFv68,
  };
}

// سطر سجلّ واحد لكل فحص (بلا معرّفات ولا قيم قياس): ما وصل وما غاب وما شذّ — يُقرأ في فحص الجهاز بعد 1.0.11.
function summarizeForLog(r) {
  if (!r || r.readerError) return `[fv68] readerError=${r && r.readerError}`;
  const failures = Object.entries((r.channelReadFailures && r.channelReadFailures.channels) || {})
      .filter(([, v]) => v.tracking !== EXCLUSION.NOT_TRACKED_BY_DESIGN && (v.tracking !== EXCLUSION.COMPLETE || v.failedIndices.length > 0))
      .map(([k, v]) => `${k}:${v.tracking}(${v.count === null ? 'n/a' : v.count})`);
  const a = r.absences || {};
  const codes = [...new Set((r.anomalies || []).map((x) => `${x.section}:${x.code}`))];
  return `[fv68] fieldsVersion=${r.fieldsVersion} appVersion=${r.appVersion} applicable=${r.applicable} ` +
      `columns=${r.layout.columnCount} baseLayout=${r.layout.baseLayout} indexFrom=${r.layout.indexFrom} ` +
      `unit=${r.throughputUnit.unit}(${r.throughputUnit.basis}) readFailures=[${failures.join(',')}] ` +
      `absent=${(a.ABSENT || []).length} absentDeclared=${(a.ABSENT_DECLARED || []).length} notInFile=${(a.NOT_IN_FILE || []).length} ` +
      `anomalies=[${codes.join(',')}]`;
}

// ═══════════════════════════════════════════════════════════════════
// نقطة الدخول
// ═══════════════════════════════════════════════════════════════════
/**
 * يقرأ حمولة fv68 (أو أيّ ختم) ويُعيد حالة صريحة لكل مفتاح وحالة. لا يرمي.
 * @param {Object} fingerprint كما يصل من التطبيق ({timeSeries:{header,footer,samples,variables,timeSeriesState}, functionalResults, manualResults, ...}).
 * @return {Object} JSON قابل للتسلسل: لا Map ولا Set ولا undefined.
 */
function readFv68(fingerprint) {
  try {
    const parts = extractParts(fingerprint);
    const ctx = makeCtx(parts);
    const layout = resolveLayout(parts.variables, parts.samples);
    const channelReadFailures = readChannelFailures(ctx, layout, parts.samples.length);
    const measurements = readMeasurements(ctx);
    const timeSeriesState = readTimeSeriesState(ctx);
    const sections = {
      timeSeriesState,
      lists: readStringLists(ctx),
      footerDiagnostics: readFooterDiagnostics(ctx),
      layout,
      throughputUnit: resolveThroughputUnit(ctx, layout),
      channelReadFailures,
      channelDiscovery: readChannelDiscovery(ctx),
      cpuPolicies: readCpuPolicies(ctx, layout),
      thermal: readThermalLists(ctx),
      batteryPairs: readBatteryPairs(ctx),
      batteryHealth: readBatteryHealth(ctx),
      cpuTemp: readCpuTemp(ctx),
      verification: readVerification(ctx),
      stillness: readStillness(ctx),
      preScanWarnings: readPreScanWarnings(ctx),
      measurements,
      touchGridAnswer: readTouchGridAnswer(ctx, measurements),
      volumeButtonAnswers: readVolumeButtonAnswers(ctx, measurements),
      scanConditions: readScanConditions(ctx, timeSeriesState),
    };
    if (layout.baseLayout !== 'MATCHES' && layout.baseLayout !== 'NO_VARIABLES') {
      ctx.anomaly('variables', `BASE_LAYOUT_${layout.baseLayout}`, {missing: layout.baseMissing, mismatched: layout.baseMismatches});
    }
    if (layout.duplicateNames.length > 0) ctx.anomaly('variables', 'DUPLICATE_COLUMN_NAMES', layout.duplicateNames);
    if (layout.unresolvedIndices.length > 0) ctx.anomaly('variables', 'SAMPLE_COLUMNS_WITHOUT_NAME', layout.unresolvedIndices);
    if (layout.sampleWidthConsistent === false) ctx.anomaly('samples', 'SAMPLE_WIDTH_VARIES', null);
    return {
      readerVersion: 1,
      fieldsVersion: ctx.fieldsVersion,
      appVersion: strOrNull(parts.header[N.HEADER.APP_VERSION]),
      applicable: ctx.applicable,
      anomalies: ctx.anomalies,
      absences: summarizeAbsences(sections),
      ...sections,
    };
  } catch (e) {
    return {readerVersion: 1, readerError: String((e && e.message) || e), anomalies: []};
  }
}

module.exports = {
  readFv68,
  summarizeForLog,
  extractParts,
  makeCtx,
  resolveLayout,
  columnIndex,
  readChannelFailures,
  readColumnsAndFailures,
  failedReads,
  EXCLUSION,
  resolveThroughputUnit,
  readVerification,
  readVerificationOnly,
  readBatteryHealthOnly,
  parseState,
  classifyChannelReason,
};

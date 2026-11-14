'use strict';

// ===================================================================
// scanColumns.js — أعمدة العيّنات بأسمائها ووحداتها المعلنة، لقرّاء مكتبة الخصائص واللحظات (V8 / PLAN-05 الدفعة ٥، S-B5)
// ===================================================================
// قارئ واحد للأعمدة يستعمله featureLibrary.js وmoments.js، بنمط findings.js نفسه: القراءة **بالاسم** من variables[] (القاعدة 24)،
// والوحدة تُؤخذ من variables[].unit المعلنة لا من حجم الرقم (A38/A100، القاعدة 22). لا يرمي: عمود أساسي لا يُحَلّ اسمه أو عيّنة مشوَّهة ⟵
// {ok:false, reason: HARNESS_ERROR} بالوسم نفسه الذي يُخرجه findings.js في الحالة نفسها (buildHarnessErrorFindings) — لا قراءة بفهرس مخمَّن.

const N = require('./fv68Names');
const {extractParts, readColumnsAndFailures} = require('./fv68Reader');
const {_internal: FI} = require('./findings');
// القاعدة 36: نصّ أيّ استثناء يُنقّى قبل أن يُكتب في المخرَج (حارس test/failureTextSites.test.js)
const {sanitizeFailureText} = require('../utils/failureText');
const {REASON} = require('./featureNames');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// معاملات التحويل إلى الوحدة الأساسية، من النصّ المعلَن حرفياً (µ/μ تُوحَّد). وحدة غير معروفة أو غائبة ⟵ null (لا قسمة افتراضية).
function normalizeUnitToken(u) {
  return typeof u === 'string' ? u.trim().replace(/[μµ]/g, 'u') : null;
}
const VOLT_UNITS = Object.freeze({mV: 1e-3, V: 1}); //                 ← إلى فولت
const AMPERE_UNITS = Object.freeze({uA: 1e-6, mA: 1e-3, A: 1}); //     ← إلى أمبير
const SECOND_UNITS = Object.freeze({ms: 1e-3, s: 1}); //               ← إلى ثانية
const WATT_UNITS = Object.freeze({mW: 1e-3, W: 1}); //                 ← إلى واط
function unitScale(declaredUnit, table) {
  const token = normalizeUnitToken(declaredUnit);
  return token !== null && Object.prototype.hasOwnProperty.call(table, token) ? table[token] : null;
}

/**
 * @param {Object} fingerprint كما يصل من التطبيق ({timeSeries:{header,footer,samples,variables}, …}).
 * @return {Object} {ok:true, n, header, footer, fieldsVersion, layout, samples, t, ph, col(name), unitOf(name)} أو {ok:false, reason, detail}
 */
function readScanColumns(fingerprint) {
  const parts = extractParts(fingerprint);
  const footer = parts.footer;
  const header = parts.header;
  const fieldsVersion = num(footer.fieldsVersion);
  if (parts.samples.length === 0) return {ok: false, reason: REASON.HARNESS_ERROR, detail: 'NO_SAMPLES'};
  try {
    const {layout} = readColumnsAndFailures({footer, samples: parts.samples, variables: parts.variables});
    const base = FI.resolveBaseColumns(layout, fieldsVersion);
    const samples = parts.samples;
    const colAt = (idx) => samples.map((s) => s.v[idx]);
    const col = (name) => colAt(base.byName[name]);
    const unitOf = (name) => {
      const c = layout.columns.find((x) => x.name === name);
      return c ? c.unit : null; // بلا variables[] (مسار ≤ 67 القديم) ⟵ وحدة غير معلنة: null
    };
    const t = col(N.BASE_CHANNELS.TIMESTAMP_MS);
    const ph = samples.map((s) => s.phase);
    return {ok: true, n: samples.length, header, footer, fieldsVersion, layout, base, samples, t, ph, col, unitOf};
  } catch (e) {
    return {ok: false, reason: REASON.HARNESS_ERROR, detail: sanitizeFailureText(e)};
  }
}

// فهارس عيّنات مرحلة واحدة (بترتيب الزمن كما وصلت).
function indicesInPhase(ph, p) {
  const out = [];
  for (let i = 0; i < ph.length; i++) if (ph[i] === p) out.push(i);
  return out;
}

// هل كل قيم العمود عند هذه الفهارس أرقام منتهية؟ (لا تُهمَل عيّنة غير رقمية صامتةً — القاعدة 22)
function allFinite(col, indices) {
  for (const i of indices) if (typeof col[i] !== 'number' || !Number.isFinite(col[i])) return false;
  return true;
}

module.exports = {readScanColumns, indicesInPhase, allFinite, unitScale, normalizeUnitToken, VOLT_UNITS, AMPERE_UNITS, SECOND_UNITS, WATT_UNITS};

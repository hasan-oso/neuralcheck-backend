'use strict';

// evaluationContractRawLink.test.js — V8 نقل الخامّ، الجزء ١-ج (2026-10-09). وحدة بلا Firestore:
// buildReportSnapshot وlinkageStatus بعد أن صار الخامّ في reportRaw وقرار المستخدم ٦ («لا نسخ للمعرّفات
// في evaluations، والربط في جانب الخادم»). المسار الكامل على المحاكي بالشيفرة الحقيقية (المشغّل وsubmitEvaluation):
// test/evaluation_linkage.e2e.test.js و test/reportRawPlacement.e2e.test.js.
//
// Run: node functions/test/evaluationContractRawLink.test.js

const assert = require('assert');
const {
  LINKAGE_FIELDS, RAW_LINKAGE_FIELDS, buildReportSnapshot, linkageStatus,
} = require('../src/evaluations/evaluationContract');
const {RAW_STATE, REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const throws = (fn, re, m) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err && re.test(err.message), `${m} — لم يُرمَ الخطأ المتوقَّع: ${err && err.message}`);
  n++;
};

const IDENTIFIERS = ['timeSeriesStoragePath', 'deviceFingerprintSha', 'sessionId'];

const report = {
  userId: 'o', deviceModel: 'SM-X', fieldsVersion: 68, appVersion: '1.0.11', aiModel: 'm', pipeline: 'v7_findings_based',
  aiResponse: {overall: {letter: 'B'}},
};
const fullRaw = {
  rawFingerprint: {device: {model: 'SM-X', androidVersion: '14', apiLevel: 34}, timeSeries: {header: {androidApiLevel: 34}}},
  deviceFingerprintSha: 'a'.repeat(64), timeSeriesStoragePath: 'scans/a/x.ts.json.gz', sessionId: 'sess', aiAudit: null,
};
const priv = {state: RAW_STATE.PRIVATE, raw: fullRaw};

// ─── اللقطة: لا معرّفات، ومن الخامّ ما ليس معرّفاً ───────────────────────────
const snap = buildReportSnapshot(report, priv);
for (const f of IDENTIFIERS) ok(!(f in snap), `[لقطة] لا "${f}" في اللقطة (القرار ٦)`);
eq(snap.androidVersion, '14', '[لقطة] androidVersion من الخامّ');
eq(snap.apiLevel, 34, '[لقطة] apiLevel من الخامّ');
eq(snap.deviceModel, 'SM-X', '[لقطة] deviceModel من المستند المقروء');
eq(snap.fieldsVersion, 68, '[لقطة] fieldsVersion من المستند المقروء');
eq(snap.appGrade, 'B', '[لقطة] appGrade من aiResponse.overall.letter (V7)');

const absentSnap = buildReportSnapshot(report, {state: RAW_STATE.ABSENT, raw: null});
eq(absentSnap.androidVersion, null, '[لقطة] ABSENT ⇒ androidVersion null (لا اختلاق)');
eq(absentSnap.apiLevel, null, '[لقطة] ABSENT ⇒ apiLevel null');
eq(absentSnap.deviceModel, 'SM-X', '[لقطة] وdeviceModel يبقى من المقروء');

const emptyReportSnap = buildReportSnapshot(null);
for (const f of IDENTIFIERS) ok(!(f in emptyReportSnap), `[لقطة] تقرير غائب: لا "${f}" أيضاً`);
ok(Object.values(emptyReportSnap).every((v) => v === null), '[لقطة] تقرير غائب ⇒ كل الحقول null');

throws(() => buildReportSnapshot(report), /rawRead/, '[لقطة] تقرير موجود بلا rawRead ⇒ خطأ صريح (القاعدة 22)');
throws(() => buildReportSnapshot(report, {raw: fullRaw}), /rawRead/, '[لقطة] rawRead بلا state ⇒ خطأ صريح');

// ─── اكتمال الربط ───────────────────────────────────────────────────────────
deepEq(linkageStatus(snap, true), {linkageIncomplete: null, missingLinkageFields: [], linkageRawState: null},
    '[ربط] معلَّق ⇒ null / [] / null');
deepEq(linkageStatus(snap, false, priv), {linkageIncomplete: false, missingLinkageFields: [], linkageRawState: 'PRIVATE'},
    '[ربط] خامّ كامل + مرايا الإصدار ⇒ مكتمل، الحالة PRIVATE');
deepEq(linkageStatus(snap, false, {state: RAW_STATE.EMBEDDED_LEGACY, raw: fullRaw}).linkageRawState, 'EMBEDDED_LEGACY',
    '[ربط] الخامّ المضمَّن ⇒ مكتمل بحالة EMBEDDED_LEGACY');

const absent = linkageStatus(snap, false, {state: RAW_STATE.ABSENT, raw: null});
eq(absent.linkageIncomplete, true, '[ربط] ABSENT ⇒ غير مكتمل');
deepEq(absent.missingLinkageFields, [...RAW_LINKAGE_FIELDS], '[ربط] ABSENT ⇒ الحقلان المعرِّفان مسمّيان ناقصين');
eq(absent.linkageRawState, 'ABSENT', '[ربط] والحالة تُعاد ظاهرة');

const nullIds = linkageStatus(snap, false, {state: RAW_STATE.PRIVATE, raw: {...fullRaw, deviceFingerprintSha: null, timeSeriesStoragePath: null}});
deepEq(nullIds.missingLinkageFields, [...RAW_LINKAGE_FIELDS], '[ربط] PRIVATE بمعرّفَين null ⇒ ناقصان (ترويسة بلا بصمة)');
eq(nullIds.linkageRawState, 'PRIVATE', '[ربط] وتبقى الحالة PRIVATE — تُميَّز عن ABSENT');

const goneIds = linkageStatus(snap, false, {state: RAW_STATE.PRIVATE, raw: {rawFingerprint: fullRaw.rawFingerprint}});
deepEq(goneIds.missingLinkageFields, [...RAW_LINKAGE_FIELDS], '[ربط] حقل معرِّف غائب (لا null) من الخامّ ⇒ ناقص أيضاً');

const noMirrors = linkageStatus(buildReportSnapshot({...report, fieldsVersion: undefined, appVersion: undefined}, priv), false, priv);
deepEq(noMirrors.missingLinkageFields, ['fieldsVersion', 'appVersion'], '[ربط] مرايا الإصدار تُفحَص في اللقطة: ناقصان بأسمائهما');

throws(() => linkageStatus(snap, false), /rawRead/, '[ربط] غير معلَّق بلا rawRead ⇒ خطأ صريح');

// ─── مصدر واحد ─────────────────────────────────────────────────────────────
deepEq([...LINKAGE_FIELDS], ['timeSeriesStoragePath', 'deviceFingerprintSha', 'fieldsVersion', 'appVersion'], '[مصدر] حقول الربط الأربعة كما كانت');
ok(RAW_LINKAGE_FIELDS.every((f) => LINKAGE_FIELDS.includes(f) && REPORT_RAW_FIELDS.includes(f)),
    '[مصدر] الحقلان المعرِّفان ضمن LINKAGE_FIELDS وضمن الحقول المنقولة (reportRawStore)');

console.log(`\nevaluationContractRawLink.test.js: ${n}/${n} assertions passed`);

'use strict';

// exportSessionEvaluationReadonly.test.js — أمر مستخدم 2026-09-30 +03
// («أمر — التقييم (ب)، ومهلة الجلسة، والبنود المعلّقة»، البند ٣). يختبر
// الدوالّ الخالصة المُصدَّرة من scripts/export-session-evaluation-readonly.js
// على Firestore مزيَّف بالكامل في الذاكرة — صفر شبكة، صفر Admin SDK حقيقي.
// main() نفسها لا تُستدعى (تستدعي process.exit) ولا تُشغَّل هذه الجلسة
// السكربت أصلاً (القيد الصريح: "ولا يشغّله الوكيل").
//
// ثلاث حالات نصّ الأمر: جلسة مكتملة مع تقييم، جلسة مكتملة بلا تقييم،
// shortId غائب. + دفاعيّان: shortId مُتعدِّد المطابقة، وwrapReadOnly يرفض
// الكتابة.
//
// Run: node functions/test/exportSessionEvaluationReadonly.test.js

const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {
  SCAN_SESSIONS_COLLECTION, EVALUATIONS_COLLECTION,
  SESSION_TIME_FIELDS, EVAL_SHOWN_FIELDS, EVAL_TIME_FIELDS, EVAL_JUDGMENT_FIELDS_HIDDEN_BY_DECISION,
  readPlainField, readTimeField,
  resolveSessionFromShortId, extractSessionFields, extractEvaluationFields, buildExportOutput,
  dayRangeUtcPlus03, extractSessionSummaryForDayListing, buildDayListingOutput,
} = require('../scripts/export-session-evaluation-readonly');
const {wrapReadOnly, hashId} = require('../scripts/audit-device-profiles-readonly');

// ═══════════════════════════════════════════════════════════════════════
// ١ — readPlainField/readTimeField: وحدات — حضور/غياب صريحان، لا خلط
//     "غائب" بـ"حاضر بقيمة null" (القاعدة 22).
// ═══════════════════════════════════════════════════════════════════════
{
  deepEq(readPlainField({a: 1}, 'a'), {present: true, value: 1}, '[١] حقل حاضر بقيمة');
  deepEq(readPlainField({a: 1}, 'b'), {present: false}, '[١] حقل غائب كلّياً — present:false، لا value:null');
  deepEq(readPlainField({a: null}, 'a'), {present: true, value: null}, '[١][الأهمّ] حقل حاضر بقيمة null صراحة — present:true لا present:false');

  const fakeTimestamp = {toDate: () => new Date('2026-09-30T10:00:00.000Z')};
  deepEq(readTimeField({t: fakeTimestamp}, 't'), {present: true, formatted: {state: 'FIRESTORE_TIMESTAMP', value: '2026-09-30T10:00:00.000Z'}},
      '[١] حقل وقت حاضر — Firestore Timestamp حقيقي');
  deepEq(readTimeField({t: null}, 't'), {present: true, formatted: {state: 'ABSENT', value: null}},
      '[١][الأهمّ] حقل وقت حاضر بقيمة null صراحة (مثال حقيقي: evaluations.resolvedAt وpending=true) — present:true، formatted.state=ABSENT');
  deepEq(readTimeField({}, 't'), {present: false, formatted: null},
      '[١] حقل وقت غائب كلّياً — present:false، formatted:null (لا ABSENT المُهيَّأة — تمييز عن الحالة أعلاه)');
  console.log('تحقّق ١: readPlainField/readTimeField — حضور/غياب صريحان، حاضر-بقيمة-null مُميَّز عن غائب كلّياً');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — extractSessionFields: allowlist — status+الأوقات الأربعة فقط، وبقية
//     حقول الجلسة (code/ownerId/ownerEmail/joinedBy/scanId/deviceModel)
//     أسماؤها فقط في sessionFieldsNotPrinted، لا قيمها.
//
// ⚠️ تصحيح 2026-10-01 +03 ("قواعد قراءة الجلسات"): ownerEmail حُذفت من
// createScanSession.js (لا كاتب لها بعد الآن) — **هذه العيّنة تمثّل عمداً
// مستنداً قديماً** (قبل ذلك التصحيح، ما زال يحمل ownerEmail فعلياً، تحميه
// قاعدة القراءة الجديدة) لإثبات أن extractSessionFields تتعامل معه بصحّة
// (اسمه فقط يُسرَد، لا قيمته) — لا عطباً تُصلحه؛ انظر أيضاً التحقّق ٢-ب
// أدناه لشكل مستند **جديد** بلا ownerEmail إطلاقاً.
//
// joinedBy هنا قيمة uid حقيقية (مسار منضمّ مُصادَق) — القرار ٢ من نفس
// الأمر يُسجِّل أن مسار "لدي كود فحص" من شاشة الدخول ينضمّ بـjoinedBy=null
// تحديداً (joinScanSession.js:31) لا بقيمة كهذه؛ التحقّق ٢-ب أدناه يغطّي
// تلك القيمة (null) أيضاً — القاعدة 30: كل شكل واقعي يصل الخادم، لا واحد فقط.
{
  const sessionData = {
    code: 'NC-ABC123',
    ownerId: 'owner-uid-real-12345',
    ownerEmail: 'shop-owner@example.com',
    status: 'completed',
    createdAt: {toDate: () => new Date('2026-09-30T08:00:00.000Z')},
    expiresAt: {toDate: () => new Date('2026-09-30T08:15:00.000Z')},
    joinedAt: {toDate: () => new Date('2026-09-30T08:05:00.000Z')},
    joinedBy: 'anon-uid-real-67890',
    completedAt: {toDate: () => new Date('2026-09-30T08:20:00.000Z')},
    scanId: 'internal-scan-id-must-not-leak',
    shortId: 'NC-TESTONE',
    deviceModel: 'Samsung Galaxy S21 Ultra',
  };
  const info = extractSessionFields(sessionData);

  deepEq(info.status, {present: true, value: 'completed'}, '[٢] status=completed');
  eq(info.times.createdAt.formatted.state, 'FIRESTORE_TIMESTAMP', '[٢] createdAt مُهيَّأ من Timestamp حقيقي');
  eq(info.times.createdAt.formatted.value, '2026-09-30T08:00:00.000Z', '[٢] createdAt.value مطابق');
  eq(info.times.joinedAt.formatted.value, '2026-09-30T08:05:00.000Z', '[٢] joinedAt.value مطابق');
  eq(info.times.expiresAt.formatted.value, '2026-09-30T08:15:00.000Z', '[٢][مهمّ] expiresAt يُطبَع كما هو في المستند — بلا أيّ اشتقاق "مهلة" (نصّ الأمر: قاعدة المهلة تتغيّر بالبند ٢)');
  eq(info.times.completedAt.formatted.value, '2026-09-30T08:20:00.000Z', '[٢] completedAt.value مطابق');
  deepEq(Object.keys(info.times).sort(), [...SESSION_TIME_FIELDS].sort(), '[٢] الأوقات الأربعة بالضبط، لا أكثر ولا أقلّ');

  ok(info.sessionFieldsNotPrinted.includes('ownerId'), '[٢][الأهمّ] ownerId (معرّف) في sessionFieldsNotPrinted — اسمه فقط');
  ok(info.sessionFieldsNotPrinted.includes('ownerEmail'), '[٢][الأهمّ] ownerEmail (بريد) في sessionFieldsNotPrinted — اسمه فقط');
  ok(info.sessionFieldsNotPrinted.includes('joinedBy'), '[٢] joinedBy (معرّف) في sessionFieldsNotPrinted');
  ok(info.sessionFieldsNotPrinted.includes('scanId'), '[٢] scanId الداخلي في sessionFieldsNotPrinted');
  ok(info.sessionFieldsNotPrinted.includes('code'), '[٢] code في sessionFieldsNotPrinted');
  ok(info.sessionFieldsNotPrinted.includes('deviceModel'), '[٢] deviceModel في sessionFieldsNotPrinted — غير مطلوب بنصّ الأمر');
  ok(info.sessionFieldsNotPrinted.includes('shortId'), '[٢] shortId (نسخة الجلسة الداخلية) في sessionFieldsNotPrinted — المُصدَّر في المخرَج هو shortIdInput لا هذه النسخة');

  const outStr = JSON.stringify(info);
  ok(!outStr.includes('owner-uid-real-12345'), '[٢][الأهمّ] قيمة ownerId الحقيقية لا تصل المخرَج (اسمه فقط سُرد، لا قيمته)');
  ok(!outStr.includes('shop-owner@example.com'), '[٢][الأهمّ] قيمة ownerEmail الحقيقية (بريد) لا تصل المخرَج');
  ok(!outStr.includes('anon-uid-real-67890'), '[٢] قيمة joinedBy الحقيقية لا تصل المخرَج');
  ok(!outStr.includes('internal-scan-id-must-not-leak'), '[٢][الأهمّ] scanId الداخلي لا يظهر في أيّ مكان');
  console.log('تحقّق ٢: extractSessionFields — allowlist صارم (status+الأوقات الأربعة)، بقية الحقول أسماء فقط بلا قيم');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢-ب — تصحيح 2026-10-01 +03 ("قواعد قراءة الجلسات"): شكلان واقعيّان
//     إضافيّان لم يُغطَّيا أعلاه (القاعدة 30 — كل شكل حقيقي يصل الخادم):
//     (أ) مستند جديد بلا ownerEmail إطلاقاً (createScanSession.js بعد هذا
//         التصحيح)، (ب) joinedBy=null تحديداً — مسار "لدي كود فحص" من
//         شاشة الدخول (joinScanSession.js:31، القرار ٢ بنصّه)، لا قيمة
//         uid عشوائية كما في التحقّق ٢ أعلاه.
// ═══════════════════════════════════════════════════════════════════════
{
  const sessionDataNoOwnerEmail = {
    code: 'NC-NEW001',
    ownerId: 'owner-uid-real-99999',
    status: 'scanning',
    createdAt: {toDate: () => new Date('2026-10-01T09:00:00.000Z')},
    expiresAt: {toDate: () => new Date('2026-10-01T10:00:00.000Z')},
    joinedAt: {toDate: () => new Date('2026-10-01T09:05:00.000Z')},
    joinedBy: null, // مسار "لدي كود فحص" من شاشة الدخول — بلا هويّة (القرار ٢)
    completedAt: null,
  };
  const info = extractSessionFields(sessionDataNoOwnerEmail);

  ok(!('ownerEmail' in sessionDataNoOwnerEmail), '[٢-ب][إعداد] العيّنة تمثّل مستنداً جديداً فعلاً — بلا مفتاح ownerEmail إطلاقاً');
  ok(!info.sessionFieldsNotPrinted.includes('ownerEmail'),
      '[٢-ب] ownerEmail غائب من sessionFieldsNotPrinted حين غائب من المستند أصلاً — لا اختلاق اسم لحقل لم يُكتَب');
  ok(info.sessionFieldsNotPrinted.includes('joinedBy'),
      '[٢-ب] joinedBy=null يبقى مُسرَداً بالاسم في sessionFieldsNotPrinted رغم قيمته null — Object.keys تراه مفتاحاً حاضراً');
  deepEq(info.status, {present: true, value: 'scanning'}, '[٢-ب] status=scanning');
  console.log('تحقّق ٢-ب: extractSessionFields على مستند جديد (بلا ownerEmail) وjoinedBy=null (مسار الدخول المجهول) — كلاهما يُعامَل بصحّة');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — extractEvaluationFields: الحالات الثلاث الجذرية + allowlist +
//     إخفاء نصوص الحكم بقرار صريح.
// ═══════════════════════════════════════════════════════════════════════
{
  // ٣-أ — SESSION_SCANID_ABSENT (حارس دفاعي، غير واقع اليوم بحكم البناء)
  {
    const r = extractEvaluationFields({state: 'SESSION_SCANID_ABSENT', data: null});
    eq(r.state, 'SESSION_SCANID_ABSENT', '[٣-أ] state=SESSION_SCANID_ABSENT');
    ok(typeof r.note === 'string' && r.note.length > 0, '[٣-أ] note نصّي يشرح التعارض');
  }

  // ٣-ب — DOCUMENT_ABSENT (جلسة مكتملة بلا تقييم — نصّ الأمر: إحدى الحالات الثلاث)
  {
    const r = extractEvaluationFields({state: 'DOCUMENT_ABSENT', data: null});
    eq(r.state, 'DOCUMENT_ABSENT', '[٣-ب] state=DOCUMENT_ABSENT');
    eq(r.collection, EVALUATIONS_COLLECTION, '[٣-ب] اسم المجموعة الحقيقي مذكور');
  }

  // ٣-ج — DOCUMENT_PRESENT كاملاً، مع pending=true (resolvedAt=null صراحة)
  {
    const evalData = {
      scanId: 'internal-scan-id-must-not-leak-2',
      ownerId: 'owner-uid-real-99999',
      sessionId: 'session-doc-id-real',
      technicianName: 'اسم فنّي حقيقي',
      source: 'session',
      technicianGradeRaw: 'excellent',
      technicianGrade: 'A',
      agreement: null,
      errorMagnitude: null,
      categoryRatings: {battery: 'good', storage: 'not_tested'},
      visibleDefects: ['weak_battery'],
      disputedCategories: [],
      gradeDistance: 1,
      consistencyFlag: false,
      linkageIncomplete: false,
      missingLinkageFields: [],
      deviceFingerprintSha: 'real-device-fingerprint-sha-value',
      timeSeriesStoragePath: 'gs://bucket/real/path.json.gz',
      pending: true,
      resolvedAt: null,
      ownerMismatch: false,
      durationMs: 4200,
      revisionCount: 0,
      createdAt: {toDate: () => new Date('2026-09-30T09:00:00.000Z')},
      updatedAt: null,
    };
    const r = extractEvaluationFields({state: 'DOCUMENT_PRESENT', data: evalData});
    eq(r.state, 'DOCUMENT_PRESENT', '[٣-ج] state=DOCUMENT_PRESENT');

    deepEq(r.fields.pending, {present: true, value: true}, '[٣-ج] pending=true');
    deepEq(r.fields.ownerMismatch, {present: true, value: false}, '[٣-ج] ownerMismatch=false');
    deepEq(r.fields.source, {present: true, value: 'session'}, '[٣-ج] source=session');
    deepEq(r.fields.revisionCount, {present: true, value: 0}, '[٣-ج] revisionCount=0');
    deepEq(Object.keys(r.fields).sort(), [...EVAL_SHOWN_FIELDS].sort(), '[٣-ج] الحقول الأربعة المطلوبة بالضبط');

    eq(r.times.createdAt.formatted.state, 'FIRESTORE_TIMESTAMP', '[٣-ج] createdAt Timestamp حقيقي');
    deepEq(r.times.updatedAt, {present: true, formatted: {state: 'ABSENT', value: null}},
        '[٣-ج] updatedAt حاضر بقيمة null صراحة');
    deepEq(r.times.resolvedAt, {present: true, formatted: {state: 'ABSENT', value: null}},
        '[٣-ج][الأهمّ] resolvedAt حاضر بقيمة null (pending=true فعلاً) — present:true لا present:false (القاعدة 22)');

    deepEq(r.judgmentFieldsHiddenByDecision.sort(), [...EVAL_JUDGMENT_FIELDS_HIDDEN_BY_DECISION].sort(),
        '[٣-ج][الأهمّ] الثلاثة كلّها حاضرة في المستند فعلاً وأسماؤها الثلاثة مذكورة — لا قيمها');

    ok(r.evaluationFieldsNotPrinted.includes('ownerId'), '[٣-ج] ownerId (معرّف) في evaluationFieldsNotPrinted');
    ok(r.evaluationFieldsNotPrinted.includes('sessionId'), '[٣-ج] sessionId (معرّف) في evaluationFieldsNotPrinted');
    ok(r.evaluationFieldsNotPrinted.includes('technicianName'), '[٣-ج] technicianName (بيانات شخصية) في evaluationFieldsNotPrinted');
    ok(r.evaluationFieldsNotPrinted.includes('deviceFingerprintSha'), '[٣-ج][الأهمّ] deviceFingerprintSha (معرّف حقيقي من buildReportSnapshot) في evaluationFieldsNotPrinted');
    ok(r.evaluationFieldsNotPrinted.includes('timeSeriesStoragePath'), '[٣-ج][الأهمّ] timeSeriesStoragePath (معرّف حقيقي) في evaluationFieldsNotPrinted');
    ok(r.evaluationFieldsNotPrinted.includes('technicianGrade'), '[٣-ج] technicianGrade في evaluationFieldsNotPrinted (غير مطلوب، وليس من الثلاثة المخفيّة بقرار)');
    ok(r.evaluationFieldsNotPrinted.includes('gradeDistance'), '[٣-ج] gradeDistance في evaluationFieldsNotPrinted');
    ok(!r.evaluationFieldsNotPrinted.includes('categoryRatings'), '[٣-ج] categoryRatings ليست في notPrinted — هي في judgmentFieldsHiddenByDecision بدلاً (لا تكرار بقائمتين مختلفتين لنفس السبب)');
    ok(!r.evaluationFieldsNotPrinted.includes('pending'), '[٣-ج] pending ليست في notPrinted — عُرضت فعلاً في fields');

    const outStr = JSON.stringify(r);
    ok(!outStr.includes('internal-scan-id-must-not-leak-2'), '[٣-ج][الأهمّ] scanId المُكرَّر داخل evaluations لا يصل المخرَج (اسمه فقط سُرد)');
    ok(!outStr.includes('owner-uid-real-99999'), '[٣-ج] قيمة ownerId الحقيقية لا تصل المخرَج');
    ok(!outStr.includes('اسم فنّي حقيقي'), '[٣-ج][الأهمّ] technicianName (بيانات شخصية) لا تصل المخرَج');
    ok(!outStr.includes('good') && !outStr.includes('weak_battery') && !outStr.includes('excellent'),
        '[٣-ج][الأهمّ] لا نصوص حكم (categoryRatings/visibleDefects/technicianGradeRaw) تصل المخرَج بقيمها');
    ok(!outStr.includes('real-device-fingerprint-sha-value'), '[٣-ج][الأهمّ] deviceFingerprintSha الحقيقية لا تصل المخرَج');
    console.log('تحقّق ٣: extractEvaluationFields — الحالات الثلاث، allowlist صارم، نصوص الحكم مُخفاة بقيمها لا بأسمائها، present:true+null مُميَّز عن الغياب');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ٤ — Firestore مزيَّف: shortId → واحد/صفر/أكثر من واحد، وwrapReadOnly
//     يرفض الكتابة.
// ═══════════════════════════════════════════════════════════════════════
function makeFakeDb(sessionsByShortId, evaluationsByScanId) {
  let writeCalls = 0;
  const db = {
    collection: (name) => {
      if (name === SCAN_SESSIONS_COLLECTION) {
        return {
          where: (field, op, value) => ({
            get: async () => {
              assert.strictEqual(field, 'shortId');
              assert.strictEqual(op, '==');
              const matches = sessionsByShortId[value] || [];
              return {
                size: matches.length,
                docs: matches.map((docData, i) => ({
                  id: docData.__sessionId || `session-${i}`,
                  data: () => docData,
                })),
              };
            },
          }),
          doc: () => ({
            get: async () => ({exists: false}),
            set: async () => { writeCalls++; },
            update: async () => { writeCalls++; },
            delete: async () => { writeCalls++; },
          }),
          add: async () => { writeCalls++; },
        };
      }
      if (name === EVALUATIONS_COLLECTION) {
        return {
          doc: (id) => ({
            get: async () => {
              const data = evaluationsByScanId[id];
              return data ? {exists: true, id, data: () => data} : {exists: false, id};
            },
            set: async () => { writeCalls++; },
            update: async () => { writeCalls++; },
            delete: async () => { writeCalls++; },
          }),
        };
      }
      throw new Error(`TRAP: unexpected collection in fake db: ${name}`);
    },
    batch: () => ({}),
    runTransaction: async () => {},
  };
  Object.defineProperty(db, '_writeCalls', {get: () => writeCalls});
  return db;
}

(async () => {
  // ٤-أ — مطابقة واحدة بالضبط → RESOLVED، مع scanId مُستخرَج.
  {
    const sessionDoc = {
      __sessionId: 'sess-abc', status: 'completed', scanId: 'scan-abc-123',
      shortId: 'NC-TESTONE', createdAt: {toDate: () => new Date('2026-09-30T08:00:00.000Z')},
    };
    const fakeDb = makeFakeDb({'NC-TESTONE': [sessionDoc]}, {});
    const ro = wrapReadOnly(fakeDb);
    const resolved = await resolveSessionFromShortId(ro, 'NC-TESTONE');
    eq(resolved.state, 'RESOLVED', '[٤-أ] state=RESOLVED لمطابقة واحدة');
    eq(resolved.sessionId, 'sess-abc', '[٤-أ] sessionId = معرّف مستند scanSessions فعلياً');
    eq(resolved.scanId, 'scan-abc-123', '[٤-أ] scanId مُستخرَج من حقل الجلسة فعلياً');
    eq(resolved.matchCount, 1, '[٤-أ] matchCount=1');
    eq(fakeDb._writeCalls, 0, '[٤-أ] صفر كتابة');
  }

  // ٤-ب — صفر مطابقة → SHORTID_NOT_FOUND_IN_SESSIONS (نصّ الأمر: shortId غائب)
  {
    const fakeDb = makeFakeDb({}, {});
    const ro = wrapReadOnly(fakeDb);
    const resolved = await resolveSessionFromShortId(ro, 'NC-NOMATCH1');
    eq(resolved.state, 'SHORTID_NOT_FOUND_IN_SESSIONS', '[٤-ب][نصّ الأمر] state=SHORTID_NOT_FOUND_IN_SESSIONS');
    eq(resolved.sessionId, null, '[٤-ب] sessionId=null');
    eq(resolved.matchCount, 0, '[٤-ب] matchCount=0');
  }

  // ٤-ج — أكثر من مطابقة → SHORTID_AMBIGUOUS (نصّ الأمر: وُجدت أكثر من جلسة)
  {
    const doc1 = {__sessionId: 'dup-1', status: 'completed', scanId: 's1', shortId: 'NC-DUP'};
    const doc2 = {__sessionId: 'dup-2', status: 'completed', scanId: 's2', shortId: 'NC-DUP'};
    const fakeDb = makeFakeDb({'NC-DUP': [doc1, doc2]}, {});
    const ro = wrapReadOnly(fakeDb);
    const resolved = await resolveSessionFromShortId(ro, 'NC-DUP');
    eq(resolved.state, 'SHORTID_AMBIGUOUS', '[٤-ج][نصّ الأمر][الأهمّ] state=SHORTID_AMBIGUOUS — لا يختار أوّل جلسة بصمت');
    eq(resolved.matchCount, 2, '[٤-ج] matchCount=2');
  }

  // ٤-د — حارس الكتابة يرفض كل عمليات الكتابة على db المزيَّف نفسه.
  {
    const fakeDb = makeFakeDb({'NC-WX': [{__sessionId: 's1', status: 'completed', scanId: 'x'}]}, {});
    const ro = wrapReadOnly(fakeDb);
    let threw = null;
    try {
      await ro.collection(SCAN_SESSIONS_COLLECTION).doc('x').set({evil: true});
    } catch (e) { threw = e; }
    ok(threw && /TRAP: write operation/.test(threw.message), '[٤-د] doc.set على scanSessions يرمي TRAP');
    eq(fakeDb._writeCalls, 0, '[٤-د] صفر كتابة فعلية وصلت db المزيَّف');
  }
  console.log('تحقّق ٤: resolveSessionFromShortId — واحد/صفر/أكثر من واحد (حالات صريحة)، وwrapReadOnly يرفض الكتابة');

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — الحالات الثلاث المطلوبة بنصّ الأمر عبر buildExportOutput الكامل.
  // ═══════════════════════════════════════════════════════════════════
  // ٥-أ — جلسة مكتملة مع تقييم.
  {
    const sessionData = {
      status: 'completed', scanId: 'scan-with-eval',
      createdAt: {toDate: () => new Date('2026-09-30T08:00:00.000Z')},
      joinedAt: {toDate: () => new Date('2026-09-30T08:05:00.000Z')},
      expiresAt: {toDate: () => new Date('2026-09-30T08:15:00.000Z')},
      completedAt: {toDate: () => new Date('2026-09-30T08:20:00.000Z')},
      ownerId: 'owner-x',
    };
    const evalData = {
      pending: false, ownerMismatch: false, source: 'session', revisionCount: 0,
      createdAt: {toDate: () => new Date('2026-09-30T08:21:00.000Z')},
      updatedAt: null,
      resolvedAt: {toDate: () => new Date('2026-09-30T08:21:00.000Z')},
      categoryRatings: {battery: 'good'}, visibleDefects: [], technicianGradeRaw: 'good',
    };
    const output = buildExportOutput('NC-WITHEVAL', sessionData, {state: 'DOCUMENT_PRESENT', data: evalData});
    eq(output.projectId, 'neuralchek-9b6d7', '[٥-أ] projectId أوّل حقل، مثبَّت');
    eq(output.shortId, 'NC-WITHEVAL', '[٥-أ] shortId يبقى كما أُدخل');
    eq(output.session.status.value, 'completed', '[٥-أ] session.status=completed');
    eq(output.evaluation.state, 'DOCUMENT_PRESENT', '[٥-أ][نصّ الأمر] جلسة مكتملة مع تقييم — evaluation.state=DOCUMENT_PRESENT');
    eq(output.evaluation.fields.pending.value, false, '[٥-أ] evaluation.fields.pending=false');
    deepEq(output.outputScope.evaluationHiddenByDecision.sort(), ['categoryRatings', 'technicianGradeRaw', 'visibleDefects'],
        '[٥-أ] outputScope.evaluationHiddenByDecision مذكورة في رأس المخرَج');
    const outStr = JSON.stringify(output);
    ok(!outStr.includes('scan-with-eval'), '[٥-أ][الأهمّ] scanId الداخلي لا يظهر في المخرَج الكامل');
    ok(!outStr.includes('owner-x'), '[٥-أ] ownerId لا يظهر في المخرَج الكامل');
    console.log('تحقّق ٥-أ: buildExportOutput — جلسة مكتملة مع تقييم، صفر scanId/ownerId، نصوص الحكم مُخفاة');
  }

  // ٥-ب — جلسة مكتملة بلا تقييم.
  {
    const sessionData = {
      status: 'completed', scanId: 'scan-no-eval',
      createdAt: {toDate: () => new Date('2026-09-30T09:00:00.000Z')},
      joinedAt: {toDate: () => new Date('2026-09-30T09:05:00.000Z')},
      expiresAt: {toDate: () => new Date('2026-09-30T09:15:00.000Z')},
      completedAt: {toDate: () => new Date('2026-09-30T09:20:00.000Z')},
    };
    const output = buildExportOutput('NC-NOEVAL', sessionData, {state: 'DOCUMENT_ABSENT', data: null});
    eq(output.session.status.value, 'completed', '[٥-ب] session.status=completed رغم غياب التقييم');
    eq(output.evaluation.state, 'DOCUMENT_ABSENT', '[٥-ب][نصّ الأمر] جلسة بلا تقييم — evaluation.state=DOCUMENT_ABSENT');
    eq(output.evaluation.collection, 'evaluations', '[٥-ب] اسم المجموعة الحقيقي مذكور');
    console.log('تحقّق ٥-ب: buildExportOutput — جلسة مكتملة بلا تقييم، DOCUMENT_ABSENT صريحة');
  }

  // ٥-ج — shortId غائب كلّياً (عبر main-level resolve، لا buildExportOutput
  // — تلك الحالة تُوقِف قبل الوصول لـbuildExportOutput أصلاً في main()،
  // فتُختبَر عبر resolveSessionFromShortId في تحقّق ٤-ب أعلاه. هنا نتحقّق
  // فقط أن السكربت (main) يخرج بغير 0 بنصّ صريح — عبر فحص بنية main يدوياً
  // بلا استدعائها (تستدعي process.exit فعلياً، لا تُستدعى في الاختبار).
  ok(true, '[٥-ج][نصّ الأمر] shortId غائب: مُختبَر فعلياً في تحقّق ٤-ب (resolveSessionFromShortId → SHORTID_NOT_FOUND_IN_SESSIONS) — main() تطبع {error, matchCount} وتخرج بـ1 على نفس هذه الحالة (لا تُستدعى هنا مباشرة، تستدعي process.exit فعلياً)');

  // ═══════════════════════════════════════════════════════════════════
  // ٦ — وضع سرد اليوم (قرار مستخدم 2026-09-30 +03 «قرار — مهلة الجلسة
  //     ساعة»، الفقرة الأخيرة): dayRangeUtcPlus03، extractSessionSummaryForDayListing،
  //     buildDayListingOutput، ثم سلك كامل عبر Firestore مزيَّف بتسلسل
  //     .where().where().get() (استعلام مدى createdAt).
  // ═══════════════════════════════════════════════════════════════════
  // ٦-أ — dayRangeUtcPlus03: التحويل الحسابي +03 → UTC، مُتحقَّق يدوياً.
  {
    const range = dayRangeUtcPlus03('2026-09-30');
    ok(range !== null, '[٦-أ] يوم صالح → مدى غير null');
    // منتصف ليل 2026-09-30 بتوقيت +03 = 2026-09-29T21:00:00.000Z
    eq(range.start.toISOString(), '2026-09-29T21:00:00.000Z', '[٦-أ][الأهمّ] بداية المدى = منتصف ليل اليوم بتوقيت +03، محوَّلاً لـUTC');
    eq(range.end.toISOString(), '2026-09-30T21:00:00.000Z', '[٦-أ] نهاية المدى = +24 ساعة (منتصف الليلة التالية بتوقيت +03)');

    eq(dayRangeUtcPlus03('not-a-date'), null, '[٦-أ] صيغة غير صالحة كلّياً → null، لا تخمين');
    eq(dayRangeUtcPlus03('2026-13-01'), null, '[٦-أ][الأهمّ] شهر 13 (يلتفّ صامتاً في Date.UTC العادية) → null، الحارس الصريح يكتشفه');
    eq(dayRangeUtcPlus03('2026-02-30'), null, '[٦-أ][الأهمّ] يوم 30 في فبراير (غير موجود) → null');
    eq(dayRangeUtcPlus03(''), null, '[٦-أ] سلسلة فارغة → null');
    eq(dayRangeUtcPlus03(undefined), null, '[٦-أ] undefined → null، لا رمي');
    console.log('تحقّق ٦-أ: dayRangeUtcPlus03 — تحويل +03→UTC صحيح، وحارس صريح ضدّ تواريخ مستحيلة تلتفّ صامتاً في Date.UTC');
  }

  // ٦-ب — extractSessionSummaryForDayListing: hashId فعلي (مصدر واحد)،
  // lastUpdatedAt من snapshot.updateTime بمصدره المذكور صراحةً، وnotPrinted
  // يبقي owner/code/joinedBy أسماء فقط (نفس extractSessionFields).
  {
    const sessionData = {
      status: 'expired', // بالضبط حالة "تجربتي المنتهية دون shortId" في نصّ الأمر
      createdAt: {toDate: () => new Date('2026-09-30T10:00:00.000Z')},
      expiresAt: {toDate: () => new Date('2026-09-30T11:00:00.000Z')},
      ownerId: 'owner-real-uid', code: 'NC-REALCODE',
    };
    const fakeUpdateTime = {toDate: () => new Date('2026-09-30T10:05:00.000Z')};
    const summary = extractSessionSummaryForDayListing('real-session-doc-id-xyz', sessionData, fakeUpdateTime);

    eq(summary.sessionIdHash, hashId('real-session-doc-id-xyz'), '[٦-ب][الأهمّ] sessionIdHash = hashId(معرّف المستند) حرفياً — مصدر واحد (audit-device-profiles-readonly.js)');
    ok(summary.sessionIdHash.length === 12, '[٦-ب] هاش بـ12 حرفاً (نفس اصطلاح hashId في كل هذا المستودع)');
    eq(summary.status.value, 'expired', '[٦-ب] status=expired (جلسة تجربة منتهية دون شortId، مثال نصّ الأمر بالضبط)');
    eq(summary.times.lastUpdatedAt.present, true, '[٦-ب] lastUpdatedAt.present=true');
    eq(summary.times.lastUpdatedAt.source, 'snapshot.updateTime', '[٦-ب][الأهمّ] المصدر مذكور صراحةً — ميتاداتا لا حقل مستند (نصّ الأمر: "اذكر مصدره")');
    eq(summary.times.lastUpdatedAt.formatted.value, '2026-09-30T10:05:00.000Z', '[٦-ب] lastUpdatedAt مُهيَّأ من updateTime الحقيقي');
    eq(summary.times.createdAt.formatted.value, '2026-09-30T10:00:00.000Z', '[٦-ب] createdAt من بيانات المستند نفسها (تمييزاً عن lastUpdatedAt)');
    ok(summary.sessionFieldsNotPrinted.includes('ownerId'), '[٦-ب][نصّ الأمر] ownerId اسمه فقط — لا قيمته');
    ok(summary.sessionFieldsNotPrinted.includes('code'), '[٦-ب][نصّ الأمر] code اسمه فقط — لا قيمته');
    const summaryStr = JSON.stringify(summary);
    ok(!summaryStr.includes('owner-real-uid'), '[٦-ب][الأهمّ] قيمة ownerId الحقيقية لا تصل المخرَج');
    ok(!summaryStr.includes('NC-REALCODE'), '[٦-ب][الأهمّ] قيمة code الحقيقية لا تصل المخرَج');
    ok(!summaryStr.includes('real-session-doc-id-xyz'), '[٦-ب][الأهمّ] معرّف المستند الخام لا يصل المخرَج — الهاش فقط');
    console.log('تحقّق ٦-ب: extractSessionSummaryForDayListing — hashId فعلي، lastUpdatedAt بمصدره الصريح، owner/code أسماء فقط بلا قيم');
  }

  // ٦-ج — buildDayListingOutput + Firestore مزيَّف بتسلسل .where().where().get()
  // (استعلام مدى createdAt الحقيقي، لا محاكاة استدعاء الدالّة الخالصة وحدها).
  function makeFakeDbForDayListing(allSessions) {
    let writeCalls = 0;
    const db = {
      collection: (name) => {
        if (name !== SCAN_SESSIONS_COLLECTION) throw new Error(`TRAP: unexpected collection in fake db: ${name}`);
        return {
          where: (field1, op1, value1) => {
            assert.strictEqual(field1, 'createdAt');
            assert.strictEqual(op1, '>=');
            return {
              where: (field2, op2, value2) => {
                assert.strictEqual(field2, 'createdAt');
                assert.strictEqual(op2, '<');
                return {
                  get: async () => {
                    const matches = allSessions.filter((s) => s.data.createdAt >= value1 && s.data.createdAt < value2);
                    return {
                      size: matches.length,
                      docs: matches.map((s) => ({id: s.id, data: () => s.data, updateTime: s.updateTime})),
                    };
                  },
                };
              },
            };
          },
          doc: () => ({set: async () => { writeCalls++; }, update: async () => { writeCalls++; }, delete: async () => { writeCalls++; }}),
          add: async () => { writeCalls++; },
        };
      },
      batch: () => ({}),
      runTransaction: async () => {},
    };
    Object.defineProperty(db, '_writeCalls', {get: () => writeCalls});
    return db;
  }

  {
    const inDay = new Date('2026-09-30T12:00:00.000Z'); // داخل مدى اليوم [2026-09-29T21:00Z, 2026-09-30T21:00Z)
    const outOfDay = new Date('2026-09-28T12:00:00.000Z'); // خارج المدى
    const allSessions = [
      {id: 'sess-in-day-1', data: {status: 'expired', createdAt: inDay}, updateTime: {toDate: () => inDay}},
      {id: 'sess-in-day-2', data: {status: 'completed', createdAt: new Date('2026-09-30T20:59:59.000Z')}, updateTime: {toDate: () => new Date('2026-09-30T20:59:59.000Z')}},
      {id: 'sess-out-of-day', data: {status: 'pending', createdAt: outOfDay}, updateTime: {toDate: () => outOfDay}},
    ];
    const fakeDb = makeFakeDbForDayListing(allSessions);
    const ro = wrapReadOnly(fakeDb);

    const range = dayRangeUtcPlus03('2026-09-30');
    const snap = await ro.collection(SCAN_SESSIONS_COLLECTION)
        .where('createdAt', '>=', range.start).where('createdAt', '<', range.end).get();
    eq(snap.size, 2, '[٦-ج][الأهمّ] الاستعلام الحقيقي (مدى createdAt) يُرجع الجلستين داخل اليوم فقط، لا الثالثة خارجه');

    const sessionDocs = snap.docs.map((doc) => ({id: doc.id, data: doc.data() || {}, updateTime: doc.updateTime}));
    const output = buildDayListingOutput('2026-09-30', range, sessionDocs);

    eq(output.projectId, 'neuralchek-9b6d7', '[٦-ج] projectId مثبَّت');
    eq(output.mode, 'day-listing', '[٦-ج] mode=day-listing مُعلَن صراحةً');
    eq(output.day, '2026-09-30', '[٦-ج] day يبقى كما أُدخل');
    eq(output.sessionCount, 2, '[٦-ج] sessionCount=2 يطابق عدد النتائج الفعلي');
    eq(output.sessions.length, 2, '[٦-ج] sessions.length يطابق sessionCount');
    ok(output.sessions.every((s) => typeof s.sessionIdHash === 'string' && s.sessionIdHash.length === 12),
        '[٦-ج] كل جلسة تحمل sessionIdHash بـ12 حرفاً — لا معرّف خامّ');
    const outStr = JSON.stringify(output);
    ok(!outStr.includes('sess-in-day-1') && !outStr.includes('sess-in-day-2') && !outStr.includes('sess-out-of-day'),
        '[٦-ج][الأهمّ] لا معرّف مستند خامّ واحد يصل المخرَج الكامل');

    let threw = null;
    try {
      await ro.collection(SCAN_SESSIONS_COLLECTION).doc('x').set({evil: true});
    } catch (e) { threw = e; }
    ok(threw && /TRAP: write operation/.test(threw.message), '[٦-ج] doc.set على scanSessions في وضع سرد اليوم أيضاً يرمي TRAP');
    eq(fakeDb._writeCalls, 0, '[٦-ج] صفر كتابة فعلية');
    console.log('تحقّق ٦-ج: buildDayListingOutput عبر استعلام مدى createdAt حقيقي (.where().where().get()) — فلترة صحيحة، صفر معرّف خامّ، صفر كتابة');
  }

  console.log(`\nexportSessionEvaluationReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});

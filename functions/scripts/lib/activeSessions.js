'use strict';

// ===================================================================
// activeSessions — معيار «جلسة جارية» وعدّها، يستعمله count-active-sessions-readonly.js (قراءة بحتة). قبل نشر الأمان، 2026-10-09 +03.
//
// قرار المستخدم (القاعدة 1 الجديدة في CLAUDE.md، بنصّها، منقول من أمر المنسّق):
//   «"جلسة جارية" تُثبَت بالأداة لا بالذاكرة: كتلة قراءة قبل كل نشر تعدّ جلسات pending/scanning المنشأة في آخر ساعتين، وأقفال scanClaims
//    الحديثة، والنشر يتوقّف إن لم يكن الناتج صفراً.»
//   «والجلستان العالقتان القديمتان خارج الحدّ.»
//
// ─── المعيار ──────────────────────────────────────────────────────────────────────────────────────────────────────
// الجلسات: scanSessions بـstatus = pending أو scanning، و**createdAt في آخر 120 دقيقة** (SESSIONS_WINDOW_MIN، رقم القرار). الأقدم خارج الحدّ:
// يُعدّ في «olderThanWindow» ولا يمنع (الجلستان العالقتان القديمتان بنصّ القرار).
// الأقفال: scanClaims بـ**claimedAtMs في آخر نافذة يحدّدها الوسيط --claims-window-min**. **الافتراضي 120 مؤقّت:** «الحديثة» بلا رقم في القرار،
// والمنسّق يسأل المستخدم (CLAIMS_WINDOW_MIN_DEFAULT). ومن الأقفال الحديثة يُعدّ منفصلاً ما عليه reservation غير null.
// «في النافذة» = العمر ≤ النافذة (العمر المساوي لها تماماً داخل؛ الأحدث من الآن — عطب ساعة — داخل أيضاً).
//
// ─── الغياب لا يُقرأ قِدَماً (القاعدة 22) ──────────────────────────────────────────────────────────────────────────
// جلسة بلا createdAt (غائب أو null) أو بقيمة غير مقروءة (ليست Timestamp ولا Date) تُعدّ **مستقلّة** (CREATED_AT_ABSENT / CREATED_AT_UNREADABLE)
// **وتمنع**: لا يُعرف عمرها، فلا يُدَّعى أنها قديمة. وكذلك قفل بلا claimedAtMs رقمي (CLAIMED_AT_ABSENT / CLAIMED_AT_UNREADABLE).
//
// ─── الحالات (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03) ─────────────────────────────────────────────────────────────────
// قرار المنسّق في الأمر (بنصّه): «`cancelled` و`expired` لا يُعدّان جاريين. وكل حالة لا تعرفها الأداة تُعلن صراحةً (القاعدة 22)، ولا تُعدّ «لا تمنع» بصمت.»
// الجرد صار يمرّ على scanSessions كلّها (لا على pending وscanning بعينهما) كي تُرى كل حالة، ويقرأ حقلَي status وcreatedAt وحدهما (select) — فلا يمرّ بالأداة
// رمز جلسة ولا معرّف مالك أصلاً. تُصنَّف كل جلسة بالمصدر الواحد (src/sessions/sessionLifecycle.js: classifyStatus، والمفردات sessionNames.js — القاعدة 24):
//   ACTIVE           pending أو scanning: تُصنَّف بـcreatedAt كما كانت (داخل النافذة تمنع، وأقدم لا تمنع، والغائب وغير المقروء يمنعان).
//   TERMINAL         completed أو expired أو cancelled: تُعدّ في sessions.terminal وحدها، لا جارية ولا تمنع.
//   STATUS_ABSENT    status غائب أو null.            STATUS_UNREADABLE  status ليس نصّاً.
//   STATUS_UNKNOWN   نصّ لا تعرفه الأداة (حتى بأحرف مختلفة: Cancelled ≠ cancelled): يُعدّ مستقلاً ويُطبَع اسمه إن بدا اسم حالة (snake_case قصير) وإلا يُجمَع في (unprintable).
//   الثلاث الأخيرة **تمنع** النشر (لا يُعرَف أنها ليست جارية) — تُعلَن في blockingCounts بأسمائها.
//
// ─── المخرَج: أعداد وحدها ──────────────────────────────────────────────────────────────────────────────────────────
// لا معرّف جلسة ولا رمزها (code) ولا معرّف مستخدم، ولا مهشَّر. (القاعدة 36، وقرار المنسّق: «المخرَج أعداد وحدها».)
// رمز الخروج: 0 كل عدد مانع صفر؛ 3 غير ذلك؛ 2 خطأ أو مدخل غير مقروء.
// ===================================================================

const {ACTIVE_SESSION_STATUSES, TERMINAL_SESSION_STATUSES} = require('../../src/sessions/sessionNames');
const {classifyStatus, STATUS_STATE} = require('../../src/sessions/sessionLifecycle');

const SESSIONS_COLLECTION = 'scanSessions';
const CLAIMS_COLLECTION = 'scanClaims';
/** الحالتان الجاريتان (pending وscanning) — من المصدر الواحد sessionNames.js. */
const ACTIVE_STATUSES = ACTIVE_SESSION_STATUSES;
/** النهائية المعروفة (completed وexpired وcancelled): ليست جارية ولا تمنع. */
const TERMINAL_STATUSES = TERMINAL_SESSION_STATUSES;

/** رقم القرار: آخر ساعتين. */
const SESSIONS_WINDOW_MIN = 120;
/** مؤقّت: «الحديثة» بلا رقم في القرار. يسأل المنسّق المستخدم. */
const CLAIMS_WINDOW_MIN_DEFAULT = 120;
/** سقف عقلاني للوسيط (أسبوع) كي لا يُمرَّر رقم بلا معنى. */
const CLAIMS_WINDOW_MIN_MAX = 7 * 24 * 60;
const MS_PER_MIN = 60 * 1000;
const PAGE_SIZE = 200;

const SESSION_STATE = Object.freeze({
  IN_WINDOW: 'IN_WINDOW',
  OLDER_THAN_WINDOW: 'OLDER_THAN_WINDOW',
  CREATED_AT_ABSENT: 'CREATED_AT_ABSENT',
  CREATED_AT_UNREADABLE: 'CREATED_AT_UNREADABLE',
});
const CLAIM_STATE = Object.freeze({
  IN_WINDOW: 'IN_WINDOW',
  OLDER_THAN_WINDOW: 'OLDER_THAN_WINDOW',
  CLAIMED_AT_ABSENT: 'CLAIMED_AT_ABSENT',
  CLAIMED_AT_UNREADABLE: 'CLAIMED_AT_UNREADABLE',
});

/** نوع الجلسة من جهة حالتها (قبل تصنيف الجارية بـcreatedAt). */
const STATUS_KIND = Object.freeze({
  ACTIVE: 'ACTIVE',
  TERMINAL: 'TERMINAL',
  STATUS_ABSENT: 'STATUS_ABSENT',
  STATUS_UNREADABLE: 'STATUS_UNREADABLE',
  STATUS_UNKNOWN: 'STATUS_UNKNOWN',
});
/** اسم حالة غير معروفة يُطبَع إن بدا اسم حالة (snake_case قصير)؛ غيره لا يُطبَع (قد يحمل أيّ شيء) ويُجمَع تحت هذا المفتاح. */
const PRINTABLE_STATUS_NAME = /^[a-z][a-z_]{0,31}$/;
const UNPRINTABLE_STATUS_KEY = '(unprintable)';

const EXIT = Object.freeze({OK: 0, ERROR: 2, BLOCKS_DEPLOY: 3});

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * وقت createdAt بالمللي ثانية، أو سبب عدم القراءة. Timestamp (toMillis) أو Date فقط — رقم أو نصّ = غير مقروء (لا تخمين).
 * @param {*} v
 * @return {{ms: ?number, state: ?string}}
 */
function readCreatedAt(v) {
  if (v === undefined || v === null) return {ms: null, state: SESSION_STATE.CREATED_AT_ABSENT};
  if (typeof v === 'object' && typeof v.toMillis === 'function') {
    const ms = v.toMillis();
    return isFiniteNumber(ms) ? {ms, state: null} : {ms: null, state: SESSION_STATE.CREATED_AT_UNREADABLE};
  }
  if (v instanceof Date) {
    const ms = v.getTime();
    return isFiniteNumber(ms) ? {ms, state: null} : {ms: null, state: SESSION_STATE.CREATED_AT_UNREADABLE};
  }
  return {ms: null, state: SESSION_STATE.CREATED_AT_UNREADABLE};
}

/**
 * يصنّف جلسة. دالّة نقيّة.
 * @param {{data: ?Object, nowMs: number, windowMs: number}} p
 * @return {{state: string}}
 */
function classifySession({data, nowMs, windowMs}) {
  const r = readCreatedAt(data ? data.createdAt : undefined);
  if (r.state) return {state: r.state};
  return {state: (nowMs - r.ms) <= windowMs ? SESSION_STATE.IN_WINDOW : SESSION_STATE.OLDER_THAN_WINDOW};
}

/**
 * يصنّف جلسة من جهة حالتها: جارية، نهائية معروفة، أو حالة غائبة/غير مقروءة/غير معروفة (تُعلَن). دالّة نقيّة.
 * @param {?Object} data scanSessions/{id}.data() (status وcreatedAt)
 * @return {{kind: string, status?: string, name?: string}}
 */
function classifySessionStatus(data) {
  const {state, status} = classifyStatus(data);
  if (state === STATUS_STATE.ABSENT) return {kind: STATUS_KIND.STATUS_ABSENT};
  if (state === STATUS_STATE.NOT_A_STRING) return {kind: STATUS_KIND.STATUS_UNREADABLE};
  if (state === STATUS_STATE.UNRECOGNIZED) {
    return {kind: STATUS_KIND.STATUS_UNKNOWN, name: PRINTABLE_STATUS_NAME.test(data.status) ? data.status : UNPRINTABLE_STATUS_KEY};
  }
  return ACTIVE_STATUSES.includes(status) ? {kind: STATUS_KIND.ACTIVE, status} : {kind: STATUS_KIND.TERMINAL, status};
}

/**
 * يصنّف قفل scanClaims. دالّة نقيّة.
 * @param {{data: ?Object, nowMs: number, windowMs: number}} p
 * @return {{state: string, hasReservation: boolean}}
 */
function classifyClaim({data, nowMs, windowMs}) {
  const hasReservation = !!data && data.reservation !== null && data.reservation !== undefined;
  const v = data ? data.claimedAtMs : undefined;
  if (v === undefined || v === null) return {state: CLAIM_STATE.CLAIMED_AT_ABSENT, hasReservation};
  if (!isFiniteNumber(v)) return {state: CLAIM_STATE.CLAIMED_AT_UNREADABLE, hasReservation};
  return {state: (nowMs - v) <= windowMs ? CLAIM_STATE.IN_WINDOW : CLAIM_STATE.OLDER_THAN_WINDOW, hasReservation};
}

/** مولِّد صفحات استعلام بترتيب معرّف المستند (يطابق الترتيب الافتراضي فلا فهرس مركَّب). */
async function* iteratePages(makeQuery, pageSize = PAGE_SIZE) {
  const {FieldPath} = require('firebase-admin/firestore');
  let last = null;
  for (;;) {
    let q = makeQuery().orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    last = snap.docs[snap.docs.length - 1];
    yield snap.docs;
    if (snap.size < pageSize) return;
  }
}

/**
 * جرد قراءة بحتة: يعدّ الجلسات الجارية والأقفال. لا يحفظ معرّفاً ولا رمزاً ولا قيمة حقل — أعداد وحدها.
 * @param {Object} p
 * @param {Object} p.db Firestore (مغلَّف بـwrapReadOnly في الاستعمال).
 * @param {number} p.nowMs
 * @param {number} [p.claimsWindowMin]
 * @param {number} [p.pageSize]
 * @return {Promise<{sessions: Object, claims: Object}>}
 */
async function collectActive({db, nowMs, claimsWindowMin = CLAIMS_WINDOW_MIN_DEFAULT, pageSize = PAGE_SIZE}) {
  const sessionsWindowMs = SESSIONS_WINDOW_MIN * MS_PER_MIN;
  const claimsWindowMs = claimsWindowMin * MS_PER_MIN;
  const zero = () => Object.fromEntries([['total', 0], ...Object.values(SESSION_STATE).map((s) => [s, 0])]);
  const sessions = {
    byStatus: Object.fromEntries(ACTIVE_STATUSES.map((s) => [s, zero()])),
    terminal: Object.fromEntries(TERMINAL_STATUSES.map((s) => [s, 0])),
    unclassified: {statusAbsent: 0, statusUnreadable: 0, statusUnknown: 0, unknownNames: {}},
  };
  // كل الجلسات (لا pending وscanning بعينهما) كي تُرى كل حالة؛ وحقلا status وcreatedAt وحدهما (select): لا رمز جلسة ولا معرّف مالك يمرّ بالأداة.
  for await (const docs of iteratePages(() => db.collection(SESSIONS_COLLECTION).select('status', 'createdAt'), pageSize)) {
    for (const doc of docs) {
      const data = doc.data() || {};
      const c = classifySessionStatus(data);
      if (c.kind === STATUS_KIND.ACTIVE) {
        const {state} = classifySession({data, nowMs, windowMs: sessionsWindowMs});
        sessions.byStatus[c.status].total++;
        sessions.byStatus[c.status][state]++;
      } else if (c.kind === STATUS_KIND.TERMINAL) {
        sessions.terminal[c.status]++;
      } else if (c.kind === STATUS_KIND.STATUS_ABSENT) {
        sessions.unclassified.statusAbsent++;
      } else if (c.kind === STATUS_KIND.STATUS_UNREADABLE) {
        sessions.unclassified.statusUnreadable++;
      } else {
        sessions.unclassified.statusUnknown++;
        sessions.unclassified.unknownNames[c.name] = (sessions.unclassified.unknownNames[c.name] || 0) + 1;
      }
    }
  }
  const claims = {
    total: 0, inWindow: 0, inWindowWithReservation: 0,
    [CLAIM_STATE.OLDER_THAN_WINDOW]: 0, [CLAIM_STATE.CLAIMED_AT_ABSENT]: 0, [CLAIM_STATE.CLAIMED_AT_UNREADABLE]: 0,
  };
  for await (const docs of iteratePages(() => db.collection(CLAIMS_COLLECTION), pageSize)) {
    for (const doc of docs) {
      const {state, hasReservation} = classifyClaim({data: doc.data() || {}, nowMs, windowMs: claimsWindowMs});
      claims.total++;
      if (state === CLAIM_STATE.IN_WINDOW) {
        claims.inWindow++;
        if (hasReservation) claims.inWindowWithReservation++;
      } else {
        claims[state]++;
      }
    }
  }
  return {sessions, claims};
}

/**
 * ما يمنع النشر: الأعداد الأربعة والأعداد المستقلّة للغائب وغير المقروء. الأقدم من النافذة لا يمنع.
 * @param {{sessions: Object, claims: Object}} collected
 * @return {{blocksDeploy: boolean, blockingCounts: Object, reasons: string[]}}
 */
function verdictOf(collected) {
  const sum = (key) => ACTIVE_STATUSES.reduce((n, s) => n + collected.sessions.byStatus[s][key], 0);
  const un = collected.sessions.unclassified;
  // الغياب حالة صريحة (القاعدة 22): جرد بلا unclassified ليس «لا شيء غير مصنَّف» بل جرد ناقص — يُرمى لا يُقرأ صفراً.
  if (!un || ![un.statusAbsent, un.statusUnreadable, un.statusUnknown].every((v) => Number.isInteger(v) && v >= 0)) {
    throw new Error('verdictOf: الجرد بلا sessions.unclassified مقروء — لا يُعدّ غير المصنَّف صفراً');
  }
  const blockingCounts = {
    sessionsInWindow: sum(SESSION_STATE.IN_WINDOW),
    sessionsCreatedAtAbsent: sum(SESSION_STATE.CREATED_AT_ABSENT),
    sessionsCreatedAtUnreadable: sum(SESSION_STATE.CREATED_AT_UNREADABLE),
    sessionsStatusAbsent: un.statusAbsent,
    sessionsStatusUnreadable: un.statusUnreadable,
    sessionsStatusUnknown: un.statusUnknown,
    claimsInWindow: collected.claims.inWindow,
    claimsClaimedAtAbsent: collected.claims[CLAIM_STATE.CLAIMED_AT_ABSENT],
    claimsClaimedAtUnreadable: collected.claims[CLAIM_STATE.CLAIMED_AT_UNREADABLE],
  };
  const reasons = Object.entries(blockingCounts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`);
  return {blocksDeploy: reasons.length > 0, blockingCounts, reasons};
}

/**
 * ملخّص المخرَج (أعداد وحدها).
 * @param {{sessions: Object, claims: Object}} collected
 * @param {{claimsWindowMin: number, claimsWindowIsDefault: boolean}} opts
 * @return {Object}
 */
function summarize(collected, {claimsWindowMin, claimsWindowIsDefault}) {
  return {
    criteria: {
      sessions: {
        collection: SESSIONS_COLLECTION, statuses: [...ACTIVE_STATUSES], createdAtWithinMinutes: SESSIONS_WINDOW_MIN, source: 'قرار المستخدم (القاعدة 1 في CLAUDE.md): آخر ساعتين',
        terminalStatuses: [...TERMINAL_STATUSES],
        statusRule: 'completed وexpired وcancelled ليست جارية ولا تمنع؛ وكل حالة غائبة أو غير مقروءة أو لا تعرفها الأداة تُعدّ مستقلّة وتمنع (القاعدة 22) — لا تُعدّ «لا تمنع» بصمت',
      },
      claims: {
        collection: CLAIMS_COLLECTION, claimedAtMsWithinMinutes: claimsWindowMin, windowIsDefault: claimsWindowIsDefault,
        note: claimsWindowIsDefault ? 'الافتراضي 120 مؤقّت: «الحديثة» بلا رقم في القرار؛ يحدّده المستخدم بـ--claims-window-min' : 'مُمرَّر بـ--claims-window-min',
        inWindowWithReservationIsPartOfInWindow: true,
      },
      absenceRule: 'جلسة بلا createdAt أو بقيمة غير مقروءة، وقفل بلا claimedAtMs رقمي: يُعدّ مستقلاً ويمنع (القاعدة 22)',
    },
    sessions: collected.sessions,
    claims: collected.claims,
    verdict: verdictOf(collected),
  };
}

/**
 * وسيط مجهول = خطأ صريح (القاعدة 22). --claims-window-min يقبل رقماً موجباً منتهياً حتى أسبوع.
 * @param {string[]} argv
 * @return {{preflight: boolean, claimsWindowMin: number, claimsWindowIsDefault: boolean}}
 */
function parseArgs(argv) {
  const out = {preflight: false, claimsWindowMin: CLAIMS_WINDOW_MIN_DEFAULT, claimsWindowIsDefault: true};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preflight') {
      out.preflight = true;
    } else if (a === '--claims-window-min') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error('USAGE: --claims-window-min يحتاج قيمة (دقائق)');
      i++;
      if (!/^\d+(\.\d+)?$/.test(v)) throw new Error('USAGE: --claims-window-min يقبل رقماً موجباً (دقائق)');
      const n = Number(v);
      if (!(n > 0) || n > CLAIMS_WINDOW_MIN_MAX) throw new Error(`USAGE: --claims-window-min خارج المدى (أكبر من 0 وحتى ${CLAIMS_WINDOW_MIN_MAX})`);
      out.claimsWindowMin = n;
      out.claimsWindowIsDefault = false;
    } else {
      throw new Error(`USAGE: وسيط مجهول ${a.startsWith('--') ? a : '(موضعي)'} — المتاح: --preflight، --claims-window-min <دقائق>`);
    }
  }
  return out;
}

/**
 * فحص ذاتي بلا شبكة: حالات اصطناعية للمعيار (على الحدّ، الغائب، غير المقروء، الأقدم) والحكم. حالة فاشلة = البرنامج لا يُشغَّل على الإنتاج.
 * @return {{ok: boolean, checks: Array<{name: string, ok: boolean}>}}
 */
function preflightChecks() {
  const NOW = 1_800_000_000_000;
  const W = SESSIONS_WINDOW_MIN * MS_PER_MIN;
  const ts = (ms) => ({toMillis: () => ms});
  const s = (createdAt) => classifySession({data: {createdAt}, nowMs: NOW, windowMs: W}).state;
  const c = (claimedAtMs, reservation) => classifyClaim({data: {claimedAtMs, reservation}, nowMs: NOW, windowMs: 30 * MS_PER_MIN});
  const checks = [
    ['جلسة قبل 5 دقائق: داخل النافذة', s(ts(NOW - 5 * MS_PER_MIN)) === SESSION_STATE.IN_WINDOW],
    ['جلسة على الحدّ تماماً (120 دقيقة): داخل (العمر ≤ النافذة)', s(ts(NOW - W)) === SESSION_STATE.IN_WINDOW],
    ['جلسة بعد الحدّ بمللي ثانية: خارج', s(ts(NOW - W - 1)) === SESSION_STATE.OLDER_THAN_WINDOW],
    ['جلسة بتاريخ مستقبلي (عطب ساعة): داخل لا خارج', s(ts(NOW + 60_000)) === SESSION_STATE.IN_WINDOW],
    ['createdAt غائب: CREATED_AT_ABSENT', s(undefined) === SESSION_STATE.CREATED_AT_ABSENT],
    ['createdAt null: CREATED_AT_ABSENT', s(null) === SESSION_STATE.CREATED_AT_ABSENT],
    ['createdAt نصّ: CREATED_AT_UNREADABLE', s('2026-10-09') === SESSION_STATE.CREATED_AT_UNREADABLE],
    ['createdAt رقم: CREATED_AT_UNREADABLE (لا تخمين وحدة الرقم)', s(NOW) === SESSION_STATE.CREATED_AT_UNREADABLE],
    ['createdAt Date: يُقرأ', s(new Date(NOW - 1000)) === SESSION_STATE.IN_WINDOW],
    ['createdAt Date غير صالح: CREATED_AT_UNREADABLE', s(new Date('nope')) === SESSION_STATE.CREATED_AT_UNREADABLE],
    ['قفل قبل 10 دقائق بنافذة 30: داخل، وحجزه مُعلَن', (() => { const r = c(NOW - 10 * MS_PER_MIN, {userId: 'x'}); return r.state === CLAIM_STATE.IN_WINDOW && r.hasReservation === true; })()],
    ['قفل بلا حجز: داخل، hasReservation=false', (() => { const r = c(NOW - 10 * MS_PER_MIN, null); return r.state === CLAIM_STATE.IN_WINDOW && r.hasReservation === false; })()],
    ['قفل قبل 31 دقيقة بنافذة 30: خارج', c(NOW - 31 * MS_PER_MIN, null).state === CLAIM_STATE.OLDER_THAN_WINDOW],
    ['قفل بلا claimedAtMs: CLAIMED_AT_ABSENT', c(undefined, null).state === CLAIM_STATE.CLAIMED_AT_ABSENT],
    ['claimedAtMs نصّ: CLAIMED_AT_UNREADABLE', c('x', null).state === CLAIM_STATE.CLAIMED_AT_UNREADABLE],
    ['claimedAtMs NaN: CLAIMED_AT_UNREADABLE', c(NaN, null).state === CLAIM_STATE.CLAIMED_AT_UNREADABLE],
  ];
  const zeroSessions = () => ({
    byStatus: Object.fromEntries(ACTIVE_STATUSES.map((st) => [st, Object.fromEntries([['total', 0], ...Object.values(SESSION_STATE).map((x) => [x, 0])])])),
    terminal: Object.fromEntries(TERMINAL_STATUSES.map((st) => [st, 0])),
    unclassified: {statusAbsent: 0, statusUnknown: 0, statusUnreadable: 0, unknownNames: {}},
  });
  const emptyClaims = () => ({total: 0, inWindow: 0, inWindowWithReservation: 0, OLDER_THAN_WINDOW: 0, CLAIMED_AT_ABSENT: 0, CLAIMED_AT_UNREADABLE: 0});
  const oldOnly = {sessions: zeroSessions(), claims: emptyClaims()};
  oldOnly.sessions.byStatus.pending.OLDER_THAN_WINDOW = 2;
  oldOnly.claims.OLDER_THAN_WINDOW = 3;
  checks.push(['الأقدم من النافذة وحده لا يمنع (الجلستان العالقتان القديمتان)', verdictOf(oldOnly).blocksDeploy === false]);
  const oneUnreadable = {sessions: zeroSessions(), claims: emptyClaims()};
  oneUnreadable.sessions.byStatus.scanning.CREATED_AT_UNREADABLE = 1;
  checks.push(['جلسة غير مقروءة وحدها تمنع', verdictOf(oneUnreadable).blocksDeploy === true]);
  const kind = (status) => classifySessionStatus({status});
  checks.push(['pending وscanning: ACTIVE', kind('pending').kind === STATUS_KIND.ACTIVE && kind('scanning').kind === STATUS_KIND.ACTIVE]);
  checks.push(['completed وexpired وcancelled: TERMINAL لا جارية', ['completed', 'expired', 'cancelled'].every((s) => kind(s).kind === STATUS_KIND.TERMINAL && kind(s).status === s)]);
  checks.push(['status غائب وnull: STATUS_ABSENT', classifySessionStatus({}).kind === STATUS_KIND.STATUS_ABSENT && kind(null).kind === STATUS_KIND.STATUS_ABSENT]);
  checks.push(['status رقم: STATUS_UNREADABLE', kind(5).kind === STATUS_KIND.STATUS_UNREADABLE]);
  checks.push(['status لا تعرفه الأداة (done): STATUS_UNKNOWN باسمه', kind('done').kind === STATUS_KIND.STATUS_UNKNOWN && kind('done').name === 'done']);
  checks.push(['Cancelled بأحرف كبيرة: STATUS_UNKNOWN (لا تطبيع صامت)', kind('Cancelled').kind === STATUS_KIND.STATUS_UNKNOWN]);
  checks.push(['اسم حالة لا يبدو اسم حالة: لا يُطبَع', kind('NC-ABC123').name === UNPRINTABLE_STATUS_KEY]);
  const terminalOnly = {sessions: zeroSessions(), claims: emptyClaims()};
  terminalOnly.sessions.terminal.cancelled = 4;
  terminalOnly.sessions.terminal.expired = 3;
  checks.push(['cancelled وexpired وحدهما لا تمنع (ليستا جاريتين)', verdictOf(terminalOnly).blocksDeploy === false]);
  for (const key of ['statusAbsent', 'statusUnreadable', 'statusUnknown']) {
    const one = {sessions: zeroSessions(), claims: emptyClaims()};
    one.sessions.unclassified[key] = 1;
    checks.push([`${key} وحدها تمنع (حالة غير مصنَّفة لا تُعدّ «لا تمنع» بصمت)`, verdictOf(one).blocksDeploy === true]);
  }
  checks.push(['جرد بلا sessions.unclassified يُرمى لا يُقرأ صفراً', (() => { try { verdictOf({sessions: {byStatus: zeroSessions().byStatus}, claims: emptyClaims()}); return false; } catch (e) { return /unclassified/.test(e.message); } })()]);
  checks.push(['خطأ في الوسيط: --claims-window-min بلا قيمة يُرفض', (() => { try { parseArgs(['--claims-window-min']); return false; } catch (e) { return /USAGE/.test(e.message); } })()]);
  checks.push(['--claims-window-min 0 يُرفض', (() => { try { parseArgs(['--claims-window-min', '0']); return false; } catch (e) { return /خارج المدى/.test(e.message); } })()]);
  checks.push(['--claims-window-min 45 يُقبل', (() => { const a = parseArgs(['--claims-window-min', '45']); return a.claimsWindowMin === 45 && a.claimsWindowIsDefault === false; })()]);
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), checks: results};
}

module.exports = {
  SESSIONS_COLLECTION, CLAIMS_COLLECTION, ACTIVE_STATUSES, TERMINAL_STATUSES, SESSIONS_WINDOW_MIN, CLAIMS_WINDOW_MIN_DEFAULT, CLAIMS_WINDOW_MIN_MAX,
  SESSION_STATE, CLAIM_STATE, STATUS_KIND, UNPRINTABLE_STATUS_KEY, EXIT, PAGE_SIZE,
  readCreatedAt, classifySession, classifySessionStatus, classifyClaim, collectActive, verdictOf, summarize, parseArgs, preflightChecks,
};

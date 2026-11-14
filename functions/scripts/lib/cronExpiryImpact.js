'use strict';

// ===================================================================
// cronExpiryImpact — عدّ بالقراءة لما ستفعله المهمّة المجدولة checkExpiringSubscriptions في أوّل تشغيل بعد أن يوجد الفهرس المفقود، 2026-10-14 +03. قراءة بحتة. يستعمله cron-expiry-impact-readonly.js.
//
// السبب (نصّ المستخدم، 2026-10-14، منقول من أمر المنسّق، غير متحقَّق): المهمّة فشلت يومياً بـ«9 FAILED_PRECONDITION: The query requires an index» (users: isActive + expiresAt) فلم تصفّر شيئاً — وعند وجود الفهرس
// ستُطفئ دفعةً واحدة كل حساب انقضى اشتراكه وتصفّر رصيده وتراسله. هذا السكربت يعدّ ذلك **قبل** أيّ قرار، بالشرط نفسه حرفاً بحرف (checkExpiringSubscriptions.js:59-62 للقسم أ).
//
// ⚠️ تحديث A-SUB البند ٤-أ (2026-10-17): المهمّة **لم تعد تصفّر الرصيد ولا تنظّف الجلسات** (حُذف القسم د، والقسم أ يطفئ isActive فقط). فأعداد «القسم أ» هنا = حسابات ستُعطَّل **ورصيدها يبقى** (withBalanceGt0/balanceSumGt0 رصيد يبقى لا يُصفَّر)، وقسم الجلسات (sectionD) = عدّ تاريخي لما كان سيمسّه المنظّف المحذوف لا كتابات قادمة. شروط الاستعلام لم تتغيّر (القاعدة 43: لا فهرس).
//
// ─── كيف يعدّ بلا الفهرس المفقود ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   users:        where isActive == true  (مساواة على حقل واحد: يخدمها الفهرس المفرد التلقائي) ثم **تصفية في الذاكرة** بـexpiresAt من نوع Timestamp و<= الآن (القسم أ، :61)، وبنافذة الأيام الثلاثة (القسم ب، :113-114)،
//                 وبـ0 < scansRemaining <= 3 (القسم ج، :165-166). select() يحصر الحقول المجلوبة بتسعة (USER_FIELDS) — لا اسم ولا هاتف ولا أيّ مفتاح آخر يغادر Firestore.
//   scanSessions: where status == 'pending' ثم where status == 'scanning' (مساواة بحقل واحد لكلٍّ)، وتصفية expiresAt في الذاكرة (القسم د، :195). select() يحصر الحقول بثلاثة (SESSION_FIELDS).
//   **لا استعلام هنا يجمع مساواة ومدى على حقلين مختلفين**، فلا يحتاج فهرساً مركّباً (يحرس ذلك الاختبار بمصدر هذا الملفّ).
//
// ─── ما يُطبَع ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   أعداد ومجاميع وتوزيع بحسب الباقة. وجود email وfcmToken يُقرأ في الذاكرة **منطقياً فقط** (يُعدّ ولا تُطبَع قيمته). صفوف مُهشَّرة (hashIdForLog) لحسابات المحلّات (shop_basic/shop_pro) المطابقة للقسم أ، ولكل جلسة عالقة.
//   لا بريد، ولا uid خامّ، ولا معرّف جلسة خامّ، ولا اسم ولا هاتف. حساب المالك (DEVICE_CHECK_03_OWNER_EMAIL) يُفحَص عضويّته في المجموعة بالـuid في الذاكرة وحدها.
//
// القاعدة 22: الغياب حالة صريحة (balanceAbsent، expiresAtType، checked=false)، وغير الرقم رصيداً يُعدّ بنوعه. المستخدمون الذين isActive عندهم ليس true لا يُجلَبون (المهمّة لا تلمسهم أيضاً) — يُعلَن ذلك في المخرَج.
// ===================================================================

const C = require('./deviceCheck03Common');
const SUB = require('./subscriptionState');
const {SESSION_STATUS} = require('../../src/sessions/sessionNames'); // مصدر واحد لمفردات الحالات (القاعدة 24)

const MODE = 'cron-expiry-impact';
const USERS_COLLECTION = 'users';
const SESSIONS_COLLECTION = 'scanSessions';

/** الحقول التسعة المجلوبة من users (مصدر واحد، القاعدة 24). email وfcmToken لوجودهما فقط. */
const USER_FIELDS = Object.freeze(['isActive', 'expiresAt', 'scansRemaining', 'plan', 'subExpiredNotified', 'subExpiryEmailSent', 'subExpiryFcmDate', 'email', 'fcmToken']);
/** الحقول الثلاثة المجلوبة من scanSessions. */
const SESSION_FIELDS = Object.freeze(['status', 'createdAt', 'expiresAt']);
/** حدّ القسم د في المهمّة: .limit(500) (checkExpiringSubscriptions.js:196). */
const SESSION_CRON_LIMIT = 500;
/** أقصى صفوف تُطبَع لكل قائمة (الأعداد دائماً كاملة). */
const MAX_ROWS = 50;

const SHOP_PLANS = SUB.CRON.shopPlans;
const MIN_MS = 60 * 1000;

/** مفتاح الباقة للتجميع: الاسم إن كان قابلاً للطباعة بأمان، وإلا وصف الغياب/النوع. */
function planKey(plan) {
  if (plan === undefined) return '(absent)';
  if (typeof plan !== 'string') return `(${SUB.valueKind(plan)})`;
  return SUB.PRINTABLE_STRING.test(plan) ? plan : '(unprintable)';
}

/**
 * تصنيف مستند مستخدم (isActive == true مجلوب أصلاً) بشروط المهمّة، عند لحظتين: الآن، وعند المشغَّل التالي.
 * @param {Object} data الحقول المجلوبة
 * @param {number} nowMs
 * @param {number} nextRunMs
 * @return {Object}
 */
function classifyUser(data, nowMs, nextRunMs) {
  const isActiveTrue = data.isActive === true; // where("isActive","==",true)
  const expKind = SUB.valueKind(data.expiresAt);
  const expMs = expKind === 'timestamp' ? SUB.timestampMs(data.expiresAt) : null; // استعلام Firestore بـDate لا يطابق إلا قيماً من نوع timestamp
  const inA = (t) => isActiveTrue && expMs !== null && expMs <= t; // :59-62
  const inB = (t) => isActiveTrue && expMs !== null && expMs <= t + SUB.CRON.reminderWindowDays * SUB.DAY_MS && expMs > t; // :111-115
  const bal = data.scansRemaining;
  const balKind = SUB.valueKind(bal);
  const inC = isActiveTrue && balKind === 'number' && bal <= SUB.CRON.lowScansMax && bal > 0; // :163-167
  return {
    isActiveTrue, expKind, expMs,
    A_now: inA(nowMs), A_next: inA(nextRunMs), B_now: inB(nowMs), B_next: inB(nextRunMs), C: inC,
    balKind, balance: balKind === 'number' ? bal : null,
    plan: data.plan, planKey: planKey(data.plan),
    alreadyNotified: !!data.subExpiredNotified, // :76
    hasEmail: !!data.email, hasPush: !!data.fcmToken, // :78 و:39-40
    emailSentFlag: !!data.subExpiryEmailSent, // :136
    fcmDate: data.subExpiryFcmDate,
  };
}

/** مجمِّع القسم أ لشرطٍ معيَّن (A_now أو A_next). */
function aggregateA(classified, which) {
  const agg = {
    matched: 0, withBalanceGt0: 0, balanceSumGt0: 0, balanceAbsent: 0, balanceNotANumber: 0,
    byPlan: {},
    notification: {skippedBecauseAlreadyNotified: 0, wouldBeNotified: 0, wouldEmail: 0, wouldPush: 0},
  };
  for (const u of classified) {
    if (!u[which]) continue;
    agg.matched++;
    const p = (agg.byPlan[u.planKey] = agg.byPlan[u.planKey] || {matched: 0, withBalanceGt0: 0, balanceSumGt0: 0});
    p.matched++;
    if (u.balKind === 'number') {
      if (u.balance > 0) { agg.withBalanceGt0++; agg.balanceSumGt0 += u.balance; p.withBalanceGt0++; p.balanceSumGt0 += u.balance; }
    } else if (u.balKind === 'absent') agg.balanceAbsent++;
    else agg.balanceNotANumber++;
    if (u.alreadyNotified) agg.notification.skippedBecauseAlreadyNotified++;
    else {
      agg.notification.wouldBeNotified++;
      if (u.hasEmail) agg.notification.wouldEmail++;
      if (u.hasPush) agg.notification.wouldPush++;
    }
  }
  return agg;
}

/**
 * تقدير تاريخ «اليوم» الذي تستعمله المهمّة لمنع تكرار الإشعار (checkExpiringSubscriptions.js:35: toISOString().slice(0,10)، أي بتاريخ UTC).
 * @param {number} ms
 * @return {string}
 */
function todayStrOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * قسم المستخدمين: كل الأعداد من مجموعة isActive == true المجلوبة.
 * @param {Array<{id: string, data: Object}>} docs
 * @param {number} nowMs
 * @param {{ownerUid: ?string}} [opts]
 * @return {{users: Object, ownerRow: ?Object}}
 */
function summarizeUsers(docs, nowMs, opts = {}) {
  const run = SUB.nextCronRun(nowMs);
  const rows = docs.map((d) => ({id: d.id, ...classifyUser(d.data, nowMs, run.next.ms)}));
  const typeCounts = {};
  for (const u of rows) typeCounts[u.expKind] = (typeCounts[u.expKind] || 0) + 1;

  const sectionB = (which) => {
    const m = rows.filter((u) => u[which]);
    const todayStr = todayStrOf(which === 'B_now' ? nowMs : run.next.ms);
    return {
      matched: m.length,
      wouldEmail: m.filter((u) => !u.emailSentFlag && u.hasEmail).length, // :136
      wouldPush: m.filter((u) => u.hasPush && u.fcmDate !== todayStr).length, // :123-125
    };
  };
  const lowRows = rows.filter((u) => u.C);
  const shopRows = rows.filter((u) => u.A_next && SHOP_PLANS.includes(u.plan)).sort((a, b) => (a.expMs - b.expMs));
  const ownerRow = opts.ownerUid ? (rows.find((u) => u.id === opts.ownerUid) || null) : null;

  const users = {
    isActiveTrueLoaded: rows.length,
    notLoadedNote: 'users whose isActive is not boolean true are not loaded (the cron queries never touch them either)',
    expiresAtTypeAmongLoaded: typeCounts,
    expiresAtNotATimestamp: rows.filter((u) => u.expKind !== 'timestamp' && u.expKind !== 'absent').length,
    sectionA: {
      mirrorOf: 'checkExpiringSubscriptions.js:59-62 (query) :67-72 (writes) :76-101 (email + push)',
      writesIfMatched: {isActive: false, subExpiredNotified: true, subExpiredAt: 'serverTimestamp'}, // A-SUB البند ٤-أ (2026-10-17): لا تصفير؛ الرصيد يبقى (withBalanceGt0/balanceSumGt0 أدناه = رصيد يبقى لا رصيد يُصفَّر)
      atThisRunNow: aggregateA(rows, 'A_now'),
      atNextScheduledRun: {runPlus03: run.next.plus03, ...aggregateA(rows, 'A_next')},
    },
    sectionB: {mirrorOf: 'checkExpiringSubscriptions.js:111-158', atThisRunNow: sectionB('B_now'), atNextScheduledRun: sectionB('B_next')},
    sectionC: {
      mirrorOf: 'checkExpiringSubscriptions.js:163-186 (daily email with no de-duplication flag; plan must be shop_basic or shop_pro and email present)',
      matchedQuery: lowRows.length,
      wouldEmail: lowRows.filter((u) => SHOP_PLANS.includes(u.plan) && u.hasEmail).length,
    },
    shopAccountsInSectionAAtNextRun: {
      total: shopRows.length,
      rows: shopRows.slice(0, MAX_ROWS).map((u) => ({
        accountHash: C.hashIdForLog(u.id), plan: u.plan, scansRemaining: u.balKind === 'number' ? u.balance : `(${u.balKind})`,
        expiresAtPlus03: u.expMs === null ? null : SUB.toPlus03(u.expMs), matchesNow: u.A_now, subExpiredNotified: u.alreadyNotified, hasEmail: u.hasEmail,
      })),
      rowsTruncated: shopRows.length > MAX_ROWS,
    },
  };
  return {
    users,
    ownerRow: ownerRow ? {
      accountHash: C.hashIdForLog(ownerRow.id), plan: ownerRow.planKey,
      scansRemaining: ownerRow.balKind === 'number' ? ownerRow.balance : `(${ownerRow.balKind})`,
      expiresAtType: ownerRow.expKind, expiresAtPlus03: ownerRow.expMs === null ? null : SUB.toPlus03(ownerRow.expMs),
      matchesSectionANow: ownerRow.A_now, matchesSectionAAtNextRun: ownerRow.A_next, subExpiredNotified: ownerRow.alreadyNotified,
    } : null,
  };
}

/** عمر بالدقائق من createdAt، أو null. */
function ageMinutes(createdMs, nowMs) {
  return createdMs === null ? null : Math.round((nowMs - createdMs) / MIN_MS);
}

/** شريحة العمر (من createdAt) لجلسة يمسّها القسم د. */
function ageBucket(min) {
  if (min === null) return 'createdAt_unusable';
  if (min < 60) return 'lt_1h';
  if (min < 24 * 60) return 'h1_to_d1';
  if (min < 7 * 24 * 60) return 'd1_to_d7';
  if (min < 30 * 24 * 60) return 'd7_to_d30';
  return 'gte_d30';
}

/**
 * قسم الجلسات: ما سيغيّره القسم د (pending منقضية)، وكل جارية (pending/scanning) عالقة (منقضية أو بلا expiresAt قابل للمقارنة).
 * @param {Array<{id: string, data: Object}>} docs جلسات pending وscanning المجلوبة
 * @param {number} nowMs
 * @return {Object}
 */
function summarizeSessions(docs, nowMs) {
  const rows = docs.map((d) => {
    const status = typeof d.data.status === 'string' && SUB.PRINTABLE_STRING.test(d.data.status) ? d.data.status : '(unprintable)';
    const cKind = SUB.valueKind(d.data.createdAt);
    const eKind = SUB.valueKind(d.data.expiresAt);
    const createdMs = cKind === 'timestamp' ? SUB.timestampMs(d.data.createdAt) : null;
    const expMs = eKind === 'timestamp' ? SUB.timestampMs(d.data.expiresAt) : null;
    const expiredByTime = expMs !== null && expMs < nowMs; // :195 expiresAt < now (صارمة، نوع timestamp وحده)
    const age = ageMinutes(createdMs, nowMs);
    return {
      id: d.id, status, createdMs, expMs, cKind, eKind, expiredByTime, age,
      wouldBeChangedBySectionD: status === SESSION_STATUS.PENDING && expiredByTime, // :193-203 status == pending AND expiresAt < now
      stuck: expMs === null || expiredByTime, // جارية بلا expiresAt قابل للمقارنة، أو منقضية
    };
  });
  const pending = rows.filter((r) => r.status === SESSION_STATUS.PENDING);
  const scanning = rows.filter((r) => r.status === SESSION_STATUS.SCANNING);
  const sectionD = rows.filter((r) => r.wouldBeChangedBySectionD);
  const byAge = {};
  for (const r of sectionD) byAge[ageBucket(r.age)] = (byAge[ageBucket(r.age)] || 0) + 1;
  const stuck = rows.filter((r) => r.stuck).sort((a, b) => (a.createdMs === null ? -1 : b.createdMs === null ? 1 : a.createdMs - b.createdMs));
  return {
    sectionD: {
      mirrorOf: 'REMOVED from checkExpiringSubscriptions.js (A-SUB item 4a, 2026-10-17): the scheduled job no longer touches scanSessions; the counts below describe the pending sessions the OLD section D would have changed (stale), not future writes',
      query: "scanSessions where status == 'pending' AND expiresAt < now, .limit(500) (no orderBy)",
      writesIfMatched: {status: 'expired'}, // :201 — بلا expiredAt (خلافاً لـsessionLifecycle.js:112)، وبلا فحص حجز
      cronLimit: SESSION_CRON_LIMIT,
      pendingLoaded: pending.length,
      wouldBeChanged: sectionD.length,
      exceedsCronLimit: sectionD.length > SESSION_CRON_LIMIT,
      wouldBeChangedThisRun: Math.min(sectionD.length, SESSION_CRON_LIMIT),
      pendingWithoutTimestampExpiresAt: pending.filter((r) => r.eKind !== 'timestamp').length,
      byAgeOfCreatedAt: byAge,
    },
    scanningLoaded: scanning.length,
    scanningNotTouchedBySectionD: scanning.length,
    stuckActive: {
      criterion: 'status in (pending, scanning) AND (expiresAt is not a Timestamp OR expiresAt < now)',
      total: stuck.length,
      pending: stuck.filter((r) => r.status === SESSION_STATUS.PENDING).length,
      scanning: stuck.filter((r) => r.status === SESSION_STATUS.SCANNING).length,
      rows: stuck.slice(0, MAX_ROWS).map((r) => ({
        sessionHash: C.hashIdForLog(r.id), status: r.status,
        createdAtPlus03: r.createdMs === null ? null : SUB.toPlus03(r.createdMs), createdAtType: r.cKind,
        expiresAtPlus03: r.expMs === null ? null : SUB.toPlus03(r.expMs), expiresAtType: r.eKind,
        ageMinutesFromCreatedAt: r.age, wouldBeChangedBySectionD: r.wouldBeChangedBySectionD,
      })),
      rowsTruncated: stuck.length > MAX_ROWS,
    },
  };
}

/** قراءة مجموعة كاملة بمساواة واحدة وإسقاط حقول (لا فهرس مركّب). */
async function readEq(db, collection, field, value, fields) {
  const snap = await db.collection(collection).where(field, '==', value).select(...fields).get();
  return snap.docs.map((d) => ({id: d.id, data: d.data() || {}}));
}

/**
 * القراءة والتلخيص. الاستعلامات كلّها مساواة بحقل واحد.
 * @param {{db: Object, auth: Object, email: ?string, nowMs: number}} p email=null ⇒ لا فحص لحساب المالك (يُعلَن)
 * @return {Promise<Object>}
 */
async function collectImpact({db, auth, email, nowMs}) {
  let owner = {checked: false, reason: 'OWNER_EMAIL_ENV_MISSING'};
  let ownerUid = null;
  if (email !== null) {
    const r = await C.resolveOwner({auth, email});
    ownerUid = r.uid;
    owner = {checked: true, accountHash: r.accountHash};
  }
  const users = await readEq(db, USERS_COLLECTION, 'isActive', true, USER_FIELDS);
  const pending = await readEq(db, SESSIONS_COLLECTION, 'status', SESSION_STATUS.PENDING, SESSION_FIELDS);
  const scanning = await readEq(db, SESSIONS_COLLECTION, 'status', SESSION_STATUS.SCANNING, SESSION_FIELDS);
  const {users: usersSummary, ownerRow} = summarizeUsers(users, nowMs, {ownerUid});
  const ownerAccount = owner.checked ?
    {...owner, inIsActiveTrueSet: ownerRow !== null, ...(ownerRow !== null ? {details: ownerRow} : {note: 'not in the isActive == true set: isActive is false, absent, or the user document does not exist (not distinguished here)'})} :
    owner;
  return {
    nowPlus03: SUB.toPlus03(nowMs),
    users: usersSummary,
    ownerAccount,
    sessions: summarizeSessions([...pending, ...scanning], nowMs),
    indexesRequiredByTheCronQueries: [
      'users (isActive ASC, expiresAt ASC) — sections a and b',
      'users (isActive ASC, scansRemaining ASC) — section c',
      'scanSessions (status ASC, expiresAt ASC) — section d',
    ],
    countingMethod: 'single-field equality queries + in-memory filtering; none of the queries in this script needs a composite index',
  };
}

module.exports = {
  MODE, USERS_COLLECTION, SESSIONS_COLLECTION, USER_FIELDS, SESSION_FIELDS, SESSION_CRON_LIMIT, MAX_ROWS,
  planKey, classifyUser, aggregateA, todayStrOf, summarizeUsers, ageBucket, summarizeSessions, collectImpact,
};

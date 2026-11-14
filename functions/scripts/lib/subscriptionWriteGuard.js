'use strict';

// ===================================================================
// subscriptionWriteGuard — غلاف الكتابة الوحيد في set-account-subscription.js، 2026-10-14 +03.
//
// قرار المستخدم (2026-10-14، منقول من أمر المنسّق بحروفه): «تاريخ انتهاء حسابات الشريك لا يُضبط بيدي في الكونسول. اكتب كتلة صغيرة مختبرة (تشغيل جافّ أوّلاً، ثم كتابة بأمري) تضبط expiresAt
// بنوع Timestamp لكل حساب أسمّيه، والرصيد إن طلبتُه، وتطبع القيم قبل وبعد. أشغّلها مرّة واحدة قبل التسليم.» وجوابه عن نطاق الكتابة: «Writes expiresAt, and scansRemaining only on lines that ask
// ("add N" also adds N to scansTotal, as every grant does; "set N" leaves scansTotal). Never touches plan, isActive or the reminder flags».
// وقرار المستخدم (2026-10-09، القاعدة 42، بنصّه): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج إلا بأمر صريح منّي ونسخة احتياطية.»
//
// ─── ما يسمح به هذا الملفّ ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// **معاملة Firestore واحدة** (createGuardedWriter(db).runTransaction)، وفيها يُعطى الكود غلاف المعاملة لا المعاملة نفسها. الغلاف يعرض:
//   readUsers(uids)  قراءة users/{uid} (tx.getAll) ← {exists, data}؛ لا مرجع مستند يخرج من هذا الملفّ (فلا يملك الكود الخارجي .update/.delete على مرجع).
//   update(uid, data) tx.update على users/{uid} وحده، وبمفاتيح ضمن ALLOWED_KEYS وحدها، وبقيم من نوعين لا ثالث لهما: expiresAt = Timestamp ؛ scansRemaining/scansTotal = عدد صحيح آمن ≥ 0.
//                    وكل ما سواه TRAP: مفتاح آخر · قيمة من نوع آخر (ومنها FieldValue.delete() وincrement وserverTimestamp وDate وnull) · كائن غير عاديّ (accessor أو رمز أو مفتاح غير مُعدَّد)
//                    · أكثر من وسيطين (شرط مسبق أو صيغة مسار حقل) · هدف ليس معرّفاً مجرّداً.
//   set / create / delete  موجودة وترمي TRAP دائماً (لتُسمَّى العملية في الرسالة لا تُنتج TypeError صامتة)؛ وعلى الكاتب نفسه: batch / bulkWriter / recursiveDelete ترمي TRAP.
// النسخة التي تُمرَّر إلى tx.update **نسخة جديدة** مُتحقَّق من قيمها (لا الكائن الأصلي): لا ثغرة TOCTOU بـgetter يُرجع قيمة أخرى في القراءة الثانية.
//
// ما لا يحرسه: أيّ كود يستورد firebase-admin ويكتب بنفسه. وحارسه الساكن في functions/test/setAccountSubscription.test.js: لا `.update(` ولا `.set(` ولا `.delete(` ولا `FieldValue` ولا `runTransaction(` ولا `batch(` في السكربت ولا مكتبته،
// و`.update(` و`runTransaction(` مرّة واحدة هنا وحدها.
//
// رسائل TRAP تُسمّي العملية فقط: لا معرّف مستخدم ولا قيمة ولا اسم مفتاح غير مسموح (القاعدة 36: لا شيء يُنسخ من مُدخل إلى نصّ خطأ).
// ===================================================================

const {Timestamp} = require('firebase-admin/firestore');

const USERS_COLLECTION = 'users';
/** المفاتيح الثلاثة الوحيدة المسموح كتابتها (مصدر واحد، القاعدة 24: تستورده المكتبة والاختبارات). */
const ALLOWED_KEYS = Object.freeze(['expiresAt', 'scansRemaining', 'scansTotal']);
const TRAP_PREFIX = 'TRAP: ';

/** @param {string} name اسم العملية الممنوعة @param {string} [why] سبب ثابت (لا يُنسخ إليه شيء من المُدخل) @return {Error} */
function trap(name, why) {
  return new Error(`${TRAP_PREFIX}write operation "${name}" is forbidden in set-account-subscription${why ? ` (${why})` : ''}; the only write allowed is one Firestore transaction whose only operation is update on ${USERS_COLLECTION}/{uid} with keys within {${ALLOWED_KEYS.join(', ')}}`);
}

/** @param {*} e @return {boolean} */
function isTrap(e) {
  return !!e && typeof e.message === 'string' && e.message.startsWith(TRAP_PREFIX);
}

const isBareUid = (uid) => typeof uid === 'string' && uid !== '' && !uid.includes('/');

/**
 * يتحقّق من تحديث واحد ويُرجع **نسخة جديدة** منه، أو يرمي TRAP.
 * @param {*} uid
 * @param {*} data
 * @param {number} argCount عدد الوسائط التي استُدعي بها update
 * @return {Object<string, (Timestamp|number)>}
 */
function sanitizeUpdate(uid, data, argCount) {
  if (argCount !== 2) throw trap('tx.update', 'exactly (uid, data): no precondition and no field-path form');
  if (!isBareUid(uid)) throw trap('tx.update', 'the target must be a bare user id');
  if (data === null || typeof data !== 'object' || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) {
    throw trap('tx.update', 'data must be a plain object');
  }
  const keys = Object.keys(data);
  if (Object.getOwnPropertySymbols(data).length > 0 || Object.getOwnPropertyNames(data).length !== keys.length) {
    throw trap('tx.update', 'symbol or non-enumerable properties are not allowed');
  }
  if (keys.length === 0) throw trap('tx.update', 'an empty update');
  const clean = {};
  for (const key of keys) {
    if (!ALLOWED_KEYS.includes(key)) throw trap('tx.update', 'a key outside the allowed set');
    const desc = Object.getOwnPropertyDescriptor(data, key);
    if (!('value' in desc)) throw trap('tx.update', 'accessor properties are not allowed');
    const value = desc.value;
    if (key === 'expiresAt') {
      if (!(value instanceof Timestamp) || !Number.isFinite(value.toMillis())) throw trap('tx.update', 'expiresAt must be a Timestamp');
    } else if (!(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
      throw trap('tx.update', 'scansRemaining and scansTotal must be non-negative safe integers');
    }
    clean[key] = value;
  }
  return clean;
}

/**
 * غلاف المعاملة: القراءة وupdate المحروس، وset/create/delete ترمي.
 * @param {Object} tx معاملة Firestore
 * @param {Object} db
 * @return {Object}
 */
function guardTransaction(tx, db) {
  const refOf = (uid) => db.collection(USERS_COLLECTION).doc(uid);
  return Object.freeze({
    readUsers: async (uids) => {
      if (!Array.isArray(uids) || uids.length === 0 || !uids.every(isBareUid)) throw new Error('GUARD_READ_USERS_NEEDS_BARE_UIDS');
      const snaps = await tx.getAll(...uids.map(refOf));
      return snaps.map((snap) => ({exists: snap.exists === true, data: snap.exists === true ? (snap.data() || {}) : null}));
    },
    update: (...args) => {
      const clean = sanitizeUpdate(args[0], args[1], args.length);
      tx.update(refOf(args[0]), clean);
    },
    set: () => { throw trap('tx.set'); },
    create: () => { throw trap('tx.create'); },
    delete: () => { throw trap('tx.delete'); },
  });
}

/**
 * الكاتب: الاستدعاء الوحيد الذي يصل إلى Firestore للكتابة. يُبنى من db الخام (لا من المغلَّف بـwrapReadOnly: ذاك يرمي عند runTransaction).
 * @param {Object} db Firestore
 * @return {{runTransaction: function(function(Object): Promise<*>): Promise<*>}}
 */
function createGuardedWriter(db) {
  if (!db || typeof db.runTransaction !== 'function' || typeof db.collection !== 'function') throw new Error('GUARDED_WRITER_NEEDS_A_FIRESTORE_DB');
  return Object.freeze({
    runTransaction: (fn) => db.runTransaction((tx) => fn(guardTransaction(tx, db))),
    batch: () => { throw trap('db.batch'); },
    bulkWriter: () => { throw trap('db.bulkWriter'); },
    recursiveDelete: () => { throw trap('db.recursiveDelete'); },
  });
}

module.exports = {USERS_COLLECTION, ALLOWED_KEYS, TRAP_PREFIX, isTrap, sanitizeUpdate, guardTransaction, createGuardedWriter};

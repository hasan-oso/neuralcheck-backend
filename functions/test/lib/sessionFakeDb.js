'use strict';

// sessionFakeDb — db مزيَّف في الذاكرة لاختبارات وحدة الكنس ومسارَي الاكتمال (S-SWEEP، 2026-10-15 +03). بلا شبكة ولا محاكٍ.
// الاستبدال معلَن (القاعدة 37): يستبدل طبقة Firestore في اختبارات الوحدة وحدها؛ الطبقة الحقيقية تُفحص في الـe2e على المحاكي (sweepOnCreateJoin.e2e.test.js وsessionCompletion.e2e.test.js).
// ما يدعمه على قدر ما تستعمله الوحدتان: collection(name).doc(id) · collection(name).where(f,'==',v)… .get() · runTransaction(cb) بـtx.get(مرجع أو استعلام) وtx.update(مرجع، حقول).
// - الكتابة في المعاملة تُطبَّق عند نجاحها فقط (تُهمَل إن رمت)، وتُسجَّل في db.writes. **لا توجد delete/set/add/batch**: أيّ نداء لها TypeError فيُفشل الاختبار (لا حذف: القاعدة 42).
// - كل استعلام يُسجَّل في db.queries بمرشّحاته وبـorderBy/limit إن استُعملا (فاختبار «مساواة وحدها» يقرأ هذا السجلّ).
// - ماسكات حقن: hooks.beforeTx(db) قبل كل معاملة (لتغيير الحالة بين الاستعلام والمعاملة)، hooks.failCommit(id, n) ⟵ Error يُرمى عند إتمام المعاملة (n: ترتيب محاولات الكتابة لهذا المعرّف)،
//   hooks.queryError(q) ⟵ Error يُرفض به الاستعلام، hooks.queryHangs(q) ⟵ true فلا يعود أبداً، hooks.onTx(db) بعد كل معاملة ناجحة (لتقديم ساعة مزيَّفة).
// - ignoreStatusFilter / ignoreKeyFilter: استعلام «مهمل» يعيد ما لا يطابق، ليُثبَت أن الوحدة تدافع عن نفسها (نهائية/مجهولة/فاعل آخر لا تُمسّ ولو أُعيدت).

const FieldValue = Object.freeze({serverTimestamp: () => ({__serverTimestamp: true})});

/**
 * @param {{scanSessions?: Object, scanClaims?: Object}} seed {مجموعة: {معرّف: بيانات}}
 * @param {{ignoreStatusFilter?: boolean, ignoreKeyFilter?: boolean}} [opts]
 * @return {Object}
 */
function makeSessionFakeDb(seed, opts = {}) {
  const store = {};
  for (const [col, docs] of Object.entries(seed)) {
    store[col] = {};
    for (const [id, data] of Object.entries(docs)) store[col][id] = {...data};
  }
  const queries = [];
  const writes = [];
  const txs = [];
  const writeAttempts = {};
  const hooks = {beforeTx: null, failCommit: null, queryError: null, queryHangs: null, onTx: null};

  const refOf = (col, id) => ({id, path: `${col}/${id}`, collection: col});
  const snapOf = (col, id) => {
    const data = (store[col] || {})[id];
    return {id, exists: data !== undefined, data: () => (data === undefined ? undefined : {...data}), ref: refOf(col, id)};
  };

  function makeQuery(col, state) {
    const self = {
      __isQuery: true,
      where: (field, op, value) => makeQuery(col, {...state, filters: [...state.filters, [field, op, value]]}),
      orderBy: () => makeQuery(col, {...state, orderBy: true}),
      limit: () => makeQuery(col, {...state, limit: true}),
      startAfter: () => makeQuery(col, {...state, startAfter: true}),
      select: () => makeQuery(col, {...state, select: true}),
      get: async () => runQuery(col, state, false),
    };
    self.__col = col;
    self.__state = state;
    return self;
  }

  function evaluate(col, state) {
    return Object.keys(store[col] || {}).sort().filter((id) => state.filters.every(([field, op, value]) => {
      if (op !== '==') return false;
      if (opts.ignoreStatusFilter && field === 'status') return true;
      if (opts.ignoreKeyFilter && (field === 'ownerId' || field === 'joinedBy')) return true;
      return store[col][id][field] === value;
    }));
  }

  async function runQuery(col, state, inTx) {
    const q = {collection: col, filters: state.filters.map((f) => [...f]), inTx, orderBy: !!state.orderBy, limit: !!state.limit, startAfter: !!state.startAfter, select: !!state.select};
    queries.push(q);
    if (hooks.queryError) {
      const err = hooks.queryError(q);
      if (err) throw err;
    }
    if (hooks.queryHangs && hooks.queryHangs(q)) return new Promise(() => {});
    const docs = evaluate(col, state).map((id) => snapOf(col, id));
    return {docs, size: docs.length, empty: docs.length === 0};
  }

  const db = {
    store, queries, writes, txs, hooks,
    collection: (col) => ({
      doc: (id) => refOf(col, id),
      where: (field, op, value) => makeQuery(col, {filters: [[field, op, value]]}),
    }),
    runTransaction: async (cb) => {
      if (hooks.beforeTx) hooks.beforeTx(db);
      const pending = [];
      const tx = {
        get: async (target) => (target.__isQuery ? runQuery(target.__col, target.__state, true) : snapOf(target.collection, target.id)),
        update: (ref, fields) => { pending.push({ref, fields}); },
      };
      const result = await cb(tx);
      for (const w of pending) {
        const key = `${w.ref.collection}/${w.ref.id}`;
        writeAttempts[key] = (writeAttempts[key] || 0) + 1;
        if (hooks.failCommit) {
          const err = hooks.failCommit(w.ref.id, writeAttempts[key]);
          if (err) throw err;
        }
      }
      for (const w of pending) {
        store[w.ref.collection][w.ref.id] = {...store[w.ref.collection][w.ref.id], ...w.fields};
        writes.push({collection: w.ref.collection, id: w.ref.id, fields: {...w.fields}});
      }
      txs.push({reads: 0, writes: pending.length});
      if (hooks.onTx) hooks.onTx(db);
      return result;
    },
  };
  return db;
}

/** يلتقط كل مخرَج console (log/warn/error/info) في مصفوفة أسطر، ويعيده عند restore(). */
function captureConsole() {
  const lines = [];
  const real = {log: console.log, warn: console.warn, error: console.error, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(' ')}); };
  return {lines, texts: () => lines.map((l) => l.text), restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}

module.exports = {FieldValue, makeSessionFakeDb, captureConsole};

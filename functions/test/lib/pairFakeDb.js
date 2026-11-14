'use strict';

// pairFakeDb — Firestore مزيَّف في الذاكرة لاختبارات وحدة ربط «قبل/بعد صيانة» (أمر المستخدم 2026-10-22). بلا شبكة ولا محاكٍ.
// الاستبدال معلَن (القاعدة 37): يستبدل طبقة Firestore في اختبارات الوحدة وحدها؛ الطبقة الحقيقية تُفحص في maintenancePair.e2e.test.js على المحاكي.
// ما يدعمه على قدر ما تستعمله الدالّتان والمعاملة: collection(name).doc(id) · .where(حقل منقَّط, '==', قيمة) (مساواة وحدها: غيرها يرمي) · .limit(n) · .get() · doc.get/set/update/create ·
// db.batch() · db.runTransaction(cb) بـtx.get(مرجع أو استعلام) وtx.set/update/create.
// - **المعاملة تفاؤلية كـFirestore**: كل قراءة تسجّل نسخة المستند (واستعلام يسجّل نسخة المجموعة)؛ عند الإتمام يتغيّر أيٌّ منها ⟵ تُعاد المحاولة (حتى خمس، ثم خطأ ABORTED). **القراءة بعد كتابة تُرمى** (شرط Firestore: القراءات كلّها قبل أول كتابة).
//   ماسك الحقن hooks.beforeCommit({attempt, db}) يُستدعى بعد القراءات وقبل الإتمام: يُغيّر فيه الاختبار المخزَن كأنّ كاتباً آخر التزم في الأثناء (السباق).
// - **لا حذف**: لا delete على المرجع ولا الدفعة ولا المعاملة، ولا FieldValue.delete (القاعدة 42): أيّ نداء TypeError فيُفشل الاختبار.
// - الكتابة المنقَّطة في update ('pair.state': ...) تُطبَّق على الحقل المتداخل؛ وserverTimestamp يُحَلّ عند الكتابة بساعة المخزن (db.clock).
// - db.queries تسجّل كل استعلام بمرشّحاته وlimit (فاختبار «مساواة وحدها بلا ترتيب ولا مدى» يقرأ هذا السجلّ)؛ db.writes كل كتابة مُتمَّة؛ db.reads كل قراءة.

const FieldValue = Object.freeze({serverTimestamp: () => ({__serverTimestamp: true})});
const ts = (ms) => ({toMillis: () => ms, toDate: () => new Date(ms), __ts: ms}); // كـTimestamp الحقيقي: toMillis وtoDate
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.toMillis !== 'function' && !v.__serverTimestamp && !(v instanceof Date);

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlain(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = clone(v[k]); return o; }
  return v;
}
function getPath(obj, dotted) {
  let cur = obj;
  for (const k of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isPlain(cur[keys[i]])) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * @param {Object<string, Object<string, Object>>} seed {مجموعة: {معرّف: بيانات}}
 * @param {{now?: number}} [opts] ساعة المخزن الابتدائية (ms)
 * @return {Object}
 */
function makePairDb(seed = {}, opts = {}) {
  const store = {};
  const versions = {};
  const colVersion = {};
  const queries = [];
  const writes = [];
  const reads = [];
  const batches = [];
  const hooks = {beforeCommit: null};
  let txStarts = 0; // (set-maintenance-settings) عدد نداءات runTransaction: «المعاينة بلا معاملة»
  let clockMs = opts.now === undefined ? 1_800_000_000_000 : opts.now;
  const bump = (col, id) => { versions[`${col}/${id}`] = (versions[`${col}/${id}`] || 0) + 1; colVersion[col] = (colVersion[col] || 0) + 1; };
  for (const [col, docs] of Object.entries(seed)) {
    store[col] = {};
    for (const [id, data] of Object.entries(docs)) { store[col][id] = clone(data); bump(col, id); }
  }
  const resolve = (v) => {
    if (v && v.__serverTimestamp) return ts(clockMs);
    if (Array.isArray(v)) return v.map(resolve);
    if (isPlain(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = resolve(v[k]); return o; }
    return v;
  };

  const refOf = (col, id) => ({id, path: `${col}/${id}`, __col: col, __isRef: true}); // (__col لا collection: doc().collection(sub) دالّة كالـSDK، فلا يُحجَب اسمها بنصّ)
  const snapOf = (col, id) => {
    const data = (store[col] || {})[id];
    return {id, exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)), ref: refOf(col, id)};
  };

  function applyWrite(w) {
    const {op, col, id} = w;
    store[col] = store[col] || {};
    const cur = store[col][id];
    if (op === 'create') {
      if (cur !== undefined) throw Object.assign(new Error('ALREADY_EXISTS'), {code: 6});
      store[col][id] = clone(resolve(w.data));
    } else if (op === 'set') {
      if (w.merge && cur !== undefined) {
        for (const [k, v] of Object.entries(resolve(w.data))) store[col][id][k] = clone(v);
      } else {
        store[col][id] = clone(resolve(w.data));
      }
    } else if (op === 'update') {
      if (cur === undefined) throw Object.assign(new Error('NOT_FOUND'), {code: 5});
      for (const [k, v] of Object.entries(w.data)) {
        if (v && v.__delete) throw new TypeError('pairFakeDb: FieldValue.delete غير مدعوم (القاعدة 42)');
        setPath(store[col][id], k, clone(resolve(v)));
      }
    }
    bump(col, id);
    writes.push({op, path: `${col}/${id}`, data: clone(w.data)});
  }

  function makeQuery(col, state) {
    const self = {
      __isQuery: true, __col: col, __state: state,
      where: (field, op, value) => {
        if (op !== '==') throw new Error(`pairFakeDb: عامل ${op} غير مدعوم (المساواة وحدها: القاعدة 43)`);
        return makeQuery(col, {...state, filters: [...state.filters, [field, op, value]]});
      },
      orderBy: () => { throw new Error('pairFakeDb: orderBy ممنوع (القاعدة 43)'); },
      limit: (n) => makeQuery(col, {...state, limit: n}),
      // (set-maintenance-settings، 2026-10-22) قناع حقول كـFirestore: الحقول المسمّاة وحدها تصل (select() بلا حقول = معرّفات المستندات وحدها)؛ يُسجَّل في db.queries حين يُستعمل فقط (بقيّة الاختبارات تقارن العناصر كاملةً)
      select: (...fields) => makeQuery(col, {...state, select: fields}),
      get: async () => runQuery(col, state, false),
    };
    return self;
  }
  function runQuery(col, state, inTx) {
    queries.push({collection: col, filters: state.filters.map((f) => [...f]), limit: state.limit, inTx, ...(state.select ? {select: [...state.select]} : {})});
    let ids = Object.keys(store[col] || {}).sort().filter((id) => state.filters.every(([field, , value]) => getPath(store[col][id], field) === value));
    if (state.limit !== null) ids = ids.slice(0, state.limit);
    const docs = ids.map((id) => {
      const snap = snapOf(col, id);
      if (!state.select) return snap;
      const full = snap.data();
      const masked = {};
      for (const f of state.select) if (full !== undefined && Object.prototype.hasOwnProperty.call(full, f)) masked[f] = clone(full[f]);
      return {...snap, data: () => clone(masked)};
    });
    return {docs, size: docs.length, empty: docs.length === 0};
  }

  const db = {
    store, queries, writes, reads, batches, hooks, FieldValue,
    get txStarts() { return txStarts; },
    get now() { return clockMs; },
    set now(v) { clockMs = v; },
    clock: () => clockMs,
    collection: (col) => ({
      doc: (id) => {
        const ref = refOf(col, id);
        return {
          ...ref,
          // (set-maintenance-settings) مجموعة فرعية: تُخزَّن تحت مفتاح مسارها (protocolSettings/current/history)
          collection: (sub) => db.collection(`${col}/${id}/${sub}`),
          get: async () => { reads.push({kind: 'doc', path: ref.path, inTx: false}); return snapOf(col, id); },
          set: async (data, o) => { applyWrite({op: 'set', col, id, data, merge: !!(o && o.merge)}); },
          update: async (data) => { applyWrite({op: 'update', col, id, data}); },
          create: async (data) => { applyWrite({op: 'create', col, id, data}); },
        };
      },
      ...makeQuery(col, {filters: [], limit: null}),
    }),
    seed(col, id, data) { store[col] = store[col] || {}; store[col][id] = clone(data); bump(col, id); },
    batch: () => {
      const pending = [];
      const b = {
        set: (ref, data, o) => { pending.push({op: 'set', col: ref.__col, id: ref.id, data, merge: !!(o && o.merge)}); return b; },
        update: (ref, data) => { pending.push({op: 'update', col: ref.__col, id: ref.id, data}); return b; },
        create: (ref, data) => { pending.push({op: 'create', col: ref.__col, id: ref.id, data}); return b; },
        commit: async () => { batches.push(pending.map((w) => `${w.op}:${w.col}/${w.id}`)); for (const w of pending) applyWrite(w); },
      };
      return b;
    },
    runTransaction: async (cb) => {
      txStarts++;
      let lastErr = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const readDocs = new Map(); // path -> version
        const readCols = new Map(); // col -> colVersion (استعلامات)
        const pending = [];
        let wrote = false;
        const guardRead = () => { if (wrote) throw new Error('pairFakeDb: قراءة بعد كتابة داخل معاملة (القراءات كلّها قبل أول كتابة)'); };
        const tx = {
          get: async (target) => {
            guardRead();
            if (target.__isQuery) {
              readCols.set(target.__col, colVersion[target.__col] || 0);
              return runQuery(target.__col, target.__state, true);
            }
            readDocs.set(target.path, versions[target.path] || 0);
            reads.push({kind: 'doc', path: target.path, inTx: true});
            return snapOf(target.__col, target.id);
          },
          set: (ref, data, o) => { wrote = true; pending.push({op: 'set', col: ref.__col, id: ref.id, data, merge: !!(o && o.merge)}); return tx; },
          update: (ref, data) => { wrote = true; pending.push({op: 'update', col: ref.__col, id: ref.id, data}); return tx; },
          create: (ref, data) => { wrote = true; pending.push({op: 'create', col: ref.__col, id: ref.id, data}); return tx; },
        };
        const result = await cb(tx);
        if (hooks.beforeCommit) hooks.beforeCommit({attempt, db});
        let conflict = false;
        for (const [path, v] of readDocs) if ((versions[path] || 0) !== v) conflict = true;
        for (const [col, v] of readCols) if ((colVersion[col] || 0) !== v) conflict = true;
        if (conflict) { lastErr = Object.assign(new Error('ABORTED: contention'), {code: 10}); continue; }
        for (const w of pending) applyWrite(w);
        return result;
      }
      throw lastErr;
    },
  };
  return db;
}

/** يلتقط كل مخرَج console في مصفوفة أسطر، ويعيده عند restore(). */
function captureConsole() {
  const lines = [];
  const real = {log: console.log, warn: console.warn, error: console.error, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(' ')}); };
  return {lines, texts: () => lines.map((l) => l.text), restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}

module.exports = {makePairDb, FieldValue, ts, captureConsole};

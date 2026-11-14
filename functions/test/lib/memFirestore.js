'use strict';

// memFirestore — db مزيَّف في الذاكرة لاختبارات الوحدة (بلا شبكة ولا محاكٍ)، على قدر ما تستعمله سكربتا القراءة قبل نشر الأمان:
// collection(name).doc(id).get() · collection(name).where(field, '==', value) · .orderBy() · .limit() · .startAfter(snap) · .select() · .count().get() · .get().
// أيّ كتابة (set/update/delete/create/add/batch/runTransaction) تُسجَّل في db.writeAttempts وترمي — فاختبار «لا كتابة» يقرأ هذا السجلّ.
// الاستبدال معلَن (القاعدة 37): هذا الملفّ يستبدل طبقة Firestore في اختبارات الوحدة وحدها؛ الطبقة الحقيقية تُفحص في الـe2e على المحاكي.

/**
 * @param {Object<string, Object<string, Object>>} collections {اسم: {معرّف: بيانات}}
 * @param {{createTimes?: Object<string, {seconds: number, nanoseconds: number}>}} [opts] createTime لكل "collection/id"
 * @return {Object}
 */
function makeMemDb(collections, opts = {}) {
  const createTimes = opts.createTimes || {};
  const writeAttempts = [];
  const reads = [];
  const trap = (name) => () => { writeAttempts.push(name); throw new Error(`memFirestore: write "${name}" attempted`); };

  function snapOf(col, id, data) {
    const exists = data !== undefined;
    return {
      id, exists,
      data: () => (exists ? data : undefined),
      createTime: exists ? (createTimes[`${col}/${id}`] || {seconds: 1_700_000_000, nanoseconds: 0}) : undefined,
      ref: {id, path: `${col}/${id}`},
    };
  }

  function query(col, state) {
    const run = () => {
      let ids = Object.keys(collections[col] || {}).sort();
      for (const f of state.filters) ids = ids.filter((id) => collections[col][id] && collections[col][id][f.field] === f.value);
      if (state.after) ids = ids.filter((id) => id > state.after);
      if (state.limit !== null) ids = ids.slice(0, state.limit);
      return ids;
    };
    const project = (data) => {
      if (!state.select) return data;
      const o = {};
      for (const k of state.select) if (Object.prototype.hasOwnProperty.call(data, k)) o[k] = data[k];
      return o;
    };
    const q = {
      where: (field, op, value) => {
        if (op !== '==') throw new Error(`memFirestore: operator ${op} not supported`);
        return query(col, {...state, filters: [...state.filters, {field, value}]});
      },
      orderBy: () => query(col, state),
      limit: (n) => query(col, {...state, limit: n}),
      startAfter: (snap) => query(col, {...state, after: snap.id}),
      select: (...fields) => query(col, {...state, select: fields}),
      count: () => ({get: async () => { reads.push(`count:${col}`); return {data: () => ({count: run().length})}; }}),
      get: async () => {
        reads.push(`query:${col}`);
        const docs = run().map((id) => snapOf(col, id, project(collections[col][id])));
        return {empty: docs.length === 0, size: docs.length, docs};
      },
    };
    return q;
  }

  return {
    writeAttempts, reads,
    collection: (col) => ({
      doc: (id) => ({
        get: async () => { reads.push(`doc:${col}/${id}`); return snapOf(col, id, (collections[col] || {})[id]); },
        set: trap('doc.set'), update: trap('doc.update'), delete: trap('doc.delete'), create: trap('doc.create'),
      }),
      add: trap('collection.add'),
      ...query(col, {filters: [], select: null, limit: null, after: null}),
    }),
    batch: trap('db.batch'), runTransaction: trap('db.runTransaction'), bulkWriter: trap('db.bulkWriter'), recursiveDelete: trap('db.recursiveDelete'),
  };
}

module.exports = {makeMemDb};

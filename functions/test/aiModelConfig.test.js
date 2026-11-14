'use strict';

// aiModelConfig.test.js — تبديل النموذج من الإعداد (feat/model-switch-admin).
//
// أربعة أضلاع:
//   1. القراءة من Firestore تصل فعلاً إلى ما يُرسَل للمزوّد
//   2. السقوط إلى الافتراضي عند الغياب والفشل والقيمة الفاسدة
//   3. رفض قيمة خارج القائمة — في الكتابة وفي القراءة معاً
//   4. تسجيل التبديل: من، وإلى، ومتى، ومن غيّره
//
// لماذا الرفض في الموضعين: القائمة المغلقة تُحرس عند الكتابة، لكن مستند
// settings/ai قد يُكتب بطرق أخرى (ترحيل، وحدة تحكّم، خطأ يدوي). فلو حرسنا
// الكتابة وحدها لوصلت قيمة فاسدة إلى المزوّد يوماً. القراءة تحرس أيضاً
// وتسقط إلى الافتراضي بدل نقل الفساد.
//
// Run: node functions/test/aiModelConfig.test.js

const assert = require('assert');

// ─── كعب Firestore: مستند واحد + مجموعة فرعية للسجلّ ──────────────────
let docData = null; // null = المستند غير موجود
let readThrows = false;
const history = [];
let lastSet = null;

const historyCol = {
  add: async (entry) => {
    history.push(entry);
    return {id: 'h' + history.length};
  },
};

const settingsDoc = {
  get: async () => {
    if (readThrows) throw new Error('firestore unavailable');
    return {exists: docData !== null, data: () => docData};
  },
  set: async (data, opts) => {
    lastSet = {data, opts};
    docData = {...(docData || {}), ...data};
  },
  collection: (name) => {
    assert.strictEqual(name, 'modelHistory', 'history subcollection name');
    return historyCol;
  },
};

const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {firestore: {FieldValue: {serverTimestamp: () => 'TS'}}},
    db: {
      collection: (c) => {
        assert.strictEqual(c, 'settings', 'config collection name');
        return {doc: (d) => {
          assert.strictEqual(d, 'ai', 'config doc name');
          return settingsDoc;
        }};
      },
    },
    ADMIN_EMAILS: [],
    requireAdmin: () => {},
  },
};

const {
  resolveAiConfig, isAllowedModel, clearAiConfigCache,
  ALLOWED_DEEPSEEK_MODELS, DEFAULT_DEEPSEEK_MODEL,
} = require('../src/utils/resolveAiConfig');

/** يُعيد الحالة إلى الصفر بين الحالات. */
function reset() {
  docData = null;
  readThrows = false;
  history.length = 0;
  lastSet = null;
  clearAiConfigCache();
}

(async () => {
  // ─── 1. القائمة المغلقة ────────────────────────────────────────────
  {
    assert.ok(ALLOWED_DEEPSEEK_MODELS.length >= 2,
        'a list of one defeats the purpose — there must be a fallback to ' +
        'switch to if the provider retires the current model');
    assert.ok(ALLOWED_DEEPSEEK_MODELS.some(
        (m) => m.id === DEFAULT_DEEPSEEK_MODEL),
    'the built-in default must itself be allowed');

    for (const m of ALLOWED_DEEPSEEK_MODELS) {
      assert.ok(m.id && m.label && m.note, `${m.id} must carry UI metadata`);
      assert.strictEqual(m.thinkingSupported, true,
          `${m.id} must be verified to accept the thinking parameter we send`);
      assert.ok(['production', 'probe-only'].includes(m.verified),
          `${m.id} must say how far it was verified`);
    }

    // المرادف الصامت مستبعَد: يعمل، لكن التقرير يسجّل اسماً آخر.
    assert.ok(!isAllowedModel('deepseek-v4-flash'),
        'the silent alias must not be selectable — a report produced under ' +
        'it records aiModel=deepseek-flash, breaking later isolation by model');
    assert.ok(!isAllowedModel('gpt-4'), 'foreign names rejected');
    assert.ok(!isAllowedModel(''), 'empty rejected');
    assert.ok(!isAllowedModel(null), 'null rejected');
  }

  // ─── 2. القراءة من Firestore ───────────────────────────────────────
  {
    reset();
    docData = {deepseekModel: 'deepseek-v4-pro'};
    const cfg = await resolveAiConfig();
    assert.strictEqual(cfg.deepseekModel, 'deepseek-v4-pro');
    assert.strictEqual(cfg.source, 'firestore');
  }

  // ─── 3. السقوط: الغياب، والفشل، والقيمة الفاسدة ────────────────────
  {
    reset(); // المستند غير موجود
    let cfg = await resolveAiConfig();
    assert.strictEqual(cfg.deepseekModel, DEFAULT_DEEPSEEK_MODEL);
    assert.strictEqual(cfg.source, 'default');

    reset();
    docData = {};
    cfg = await resolveAiConfig();
    assert.strictEqual(cfg.deepseekModel, DEFAULT_DEEPSEEK_MODEL,
        'a document without the field falls back');

    reset();
    readThrows = true;
    cfg = await resolveAiConfig();
    assert.strictEqual(cfg.deepseekModel, DEFAULT_DEEPSEEK_MODEL,
        'a Firestore outage must not stop scans');
    assert.strictEqual(cfg.source, 'default_read_error');

    // الأهمّ: قيمة فاسدة تسرّبت إلى المستند بطريق يتجاوز setAiModel.
    reset();
    docData = {deepseekModel: 'deepsek-flash'}; // خطأ إملائي
    const realErr = console.error;
    const logged = [];
    console.error = (...a) => logged.push(a.join(' '));
    cfg = await resolveAiConfig();
    console.error = realErr;
    assert.strictEqual(cfg.deepseekModel, DEFAULT_DEEPSEEK_MODEL,
        'a typo in the document must not reach the provider');
    assert.strictEqual(cfg.source, 'default_rejected_value');
    assert.ok(logged.some((l) => l.includes('deepsek-flash')),
        'the rejected value must be named in the log, not silently swapped');

    reset();
    docData = {deepseekModel: 42};
    cfg = await resolveAiConfig();
    assert.strictEqual(cfg.deepseekModel, DEFAULT_DEEPSEEK_MODEL,
        'a non-string falls back');
  }

  // ─── 4. الكاش ──────────────────────────────────────────────────────
  {
    reset();
    docData = {deepseekModel: 'deepseek-v4-pro'};
    assert.strictEqual((await resolveAiConfig()).deepseekModel,
        'deepseek-v4-pro');

    // تغيير المستند بلا إفراغ الكاش: القيمة القديمة تبقى — وهذا مقصود،
    // فالبديل قراءة Firestore على كل فحص.
    docData = {deepseekModel: 'deepseek-flash'};
    assert.strictEqual((await resolveAiConfig()).deepseekModel,
        'deepseek-v4-pro', 'the cache holds within its TTL');

    clearAiConfigCache();
    assert.strictEqual((await resolveAiConfig()).deepseekModel,
        'deepseek-flash', 'clearing the cache picks the new value up');
  }

  // ─── 5. النموذج المُحلّ يصل الطلب فعلاً ─────────────────────────────
  //
  // القراءة الصحيحة لا تكفي: ما يهمّ أن القيمة تُكتب في حقل model من جسم
  // الطلب. نلتقطه بكعب fetch بلا شبكة.
  {
    reset();
    const {callDeepSeek} = require('../src/analysis/callDeepSeek');
    let sent = null;
    global.fetch = async (url, opts) => {
      sent = JSON.parse(opts.body);
      return {
        ok: true, status: 200,
        json: async () => ({
          model: sent.model,
          choices: [{message: {content: '{"grade":"A","score":90}'},
            finish_reason: 'stop'}],
          usage: {completion_tokens: 10},
        }),
        text: async () => '',
      };
    };

    await callDeepSeek('u', 's', 'k', 'deepseek-v4-pro');
    assert.strictEqual(sent.model, 'deepseek-v4-pro',
        'the resolved model must land in the request body');

    await callDeepSeek('u', 's', 'k');
    assert.strictEqual(sent.model, DEFAULT_DEEPSEEK_MODEL,
        'omitting the argument keeps the built-in default');

    await callDeepSeek('u', 's', 'k', '   ');
    assert.strictEqual(sent.model, DEFAULT_DEEPSEEK_MODEL,
        'a blank argument falls back rather than sending whitespace');
  }

  // ─── 6. تسجيل التبديل ──────────────────────────────────────────────
  {
    reset();
    const {setAiModel} = require('../src/admin/aiModelConfig');
    const run = (data, auth) => setAiModel.run({data, auth});

    // رفض قيمة خارج القائمة — قبل أي كتابة.
    let threw = null;
    try {
      await run({deepseekModel: 'gpt-4'},
          {uid: 'u1', token: {email: 'a@b.c'}});
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'an out-of-list value must be rejected');
    assert.ok(/gpt-4/.test(threw.message),
        'the error must name the value it rejected');
    assert.ok(/deepseek-flash/.test(threw.message),
        'the error must list what IS allowed, so the UI needs no code change');
    assert.strictEqual(lastSet, null, 'nothing was written on rejection');
    assert.strictEqual(history.length, 0, 'nothing was logged on rejection');

    // تبديل صحيح.
    const res = await run({deepseekModel: 'deepseek-v4-pro'},
        {uid: 'u1', token: {email: 'admin@example.com'}});
    assert.strictEqual(res.changed, true);
    assert.strictEqual(res.from, DEFAULT_DEEPSEEK_MODEL);
    assert.strictEqual(res.current, 'deepseek-v4-pro');
    assert.strictEqual(docData.deepseekModel, 'deepseek-v4-pro');

    assert.strictEqual(history.length, 1, 'the switch must be recorded');
    const h = history[0];
    assert.strictEqual(h.from, DEFAULT_DEEPSEEK_MODEL, 'from');
    assert.strictEqual(h.to, 'deepseek-v4-pro', 'to');
    assert.strictEqual(h.at, 'TS', 'when — a server timestamp, not client');
    assert.strictEqual(h.byUid, 'u1', 'who (uid)');
    assert.strictEqual(h.byEmail, 'admin@example.com', 'who (email)');

    // القيمة نفسها ليست تبديلاً — لا سجلّ.
    const again = await run({deepseekModel: 'deepseek-v4-pro'},
        {uid: 'u1', token: {email: 'admin@example.com'}});
    assert.strictEqual(again.changed, false);
    assert.strictEqual(again.reason, 'same_value');
    assert.strictEqual(history.length, 1,
        'a no-op must not pad the switch history');
  }

  // ─── 7. getAiConfig يكفي الواجهة وحده ──────────────────────────────
  {
    reset();
    const {getAiConfig} = require('../src/admin/aiModelConfig');
    const out = await getAiConfig.run({data: {}, auth: {uid: 'u1', token: {}}});

    assert.strictEqual(out.current, DEFAULT_DEEPSEEK_MODEL);
    assert.strictEqual(out.source, 'default');
    assert.deepStrictEqual(out.allowed, ALLOWED_DEEPSEEK_MODELS,
        'the UI must be able to render options without duplicating the list');
    assert.ok(/api-docs\.deepseek\.com/.test(out.pricingDocUrl),
        'the pricing link must be served, since prices are not in any API');
    assert.strictEqual(out.pricingAvailableFromApi, false,
        'the UI must be told not to expect prices from us');
    assert.strictEqual(typeof out.cacheTtlMs, 'number',
        'the UI needs the propagation delay to set expectations');
  }

  console.log('aiModelConfig: 7/7 sections passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

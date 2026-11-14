'use strict';

// backupFirestoreRulesBeforeDeploy.test.js — أمر مستخدم 2026-10-01 +03
// ("قواعد قراءة الجلسات"، البند ٥). يختبر الجزء القابل للاختبار بلا شبكة
// حقيقية من scripts/backup-firestore-rules-before-deploy.js:
// fetchCurrentlyDeployedFirestoreRules (بـglobal.fetch مُستبدَلاً — كعب
// محلّي لا نداء حقيقي، القاعدة 37: الطبقة التي قد ترفض تُفحَص لا تُستبدَل
// كلّياً عن الاختبار) وsanitizeErrorMessage. main()/initReadOnlyAdmin/
// getAccessToken لا تُستدعى (تحتاج Admin SDK/شبكة حقيقية — القيد الصريح).
//
// Run: node functions/test/backupFirestoreRulesBeforeDeploy.test.js

const assert = require('assert');
const {
  fetchCurrentlyDeployedFirestoreRules, sanitizeErrorMessage,
} = require('../scripts/backup-firestore-rules-before-deploy');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

(async () => {
  // ═══════════════════════════════════════════════════════════════════════
  // ١ — fetchCurrentlyDeployedFirestoreRules: نداءان REST (release → ruleset)
  //     بـglobal.fetch مُستبدَل، يحاكي استجابة Firebase Rules API الحقيقية
  //     شكلاً (موثَّقة: https://firebase.google.com/docs/reference/rules/rest).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({url, authHeader: opts && opts.headers && opts.headers.Authorization});
      if (url.includes('/releases/cloud.firestore')) {
        return {
          ok: true,
          json: async () => ({
            name: 'projects/neuralchek-9b6d7/releases/cloud.firestore',
            rulesetName: 'projects/neuralchek-9b6d7/rulesets/RULESET123',
          }),
        };
      }
      if (url.includes('/rulesets/RULESET123')) {
        return {
          ok: true,
          json: async () => ({
            name: 'projects/neuralchek-9b6d7/rulesets/RULESET123',
            source: {files: [{name: 'firestore.rules', content: "rules_version = '2';\nservice cloud.firestore { }"}]},
          }),
        };
      }
      throw new Error(`fetch غير متوقَّع في الاختبار: ${url}`);
    };
    try {
      const result = await fetchCurrentlyDeployedFirestoreRules('fake-access-token-for-test');
      eq(result.rulesetName, 'projects/neuralchek-9b6d7/rulesets/RULESET123', '[١] rulesetName يُستخرَج من الاستجابة الأولى');
      ok(result.rulesContent.includes("rules_version = '2';"), '[١] rulesContent يحمل نصّ القواعد الحقيقي من الاستجابة الثانية');
      ok(typeof result.fetchedAt === 'string' && !isNaN(Date.parse(result.fetchedAt)), '[١] fetchedAt طابع زمني ISO صالح');
      eq(calls.length, 2, '[١] نداءان بالضبط (release ثم ruleset) — لا أكثر');
      ok(calls[0].authHeader === 'Bearer fake-access-token-for-test', '[١] التوكن يصل كترويسة Authorization في كلا النداءين');
      ok(calls[1].authHeader === 'Bearer fake-access-token-for-test', '[١] نفس التوكن في النداء الثاني');
    } finally {
      global.fetch = realFetch;
    }
  }
  console.log('تحقّق ١: fetchCurrentlyDeployedFirestoreRules يبني نداءين REST صحيحين (release→ruleset) ويستخرج rulesContent/rulesetName فعلياً');

  // ═══════════════════════════════════════════════════════════════════════
  // ٢ — فشل النداء الأوّل (403) — خطأ صريح يحمل رابط منح الدور، لا تخمين
  //     سبب، لا رمي غامض (القاعدة 22).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const realFetch = global.fetch;
    global.fetch = async () => ({ok: false, status: 403, statusText: 'Forbidden', text: async () => 'Permission denied'});
    try {
      let threw = null;
      try {
        await fetchCurrentlyDeployedFirestoreRules('fake-token');
      } catch (e) {
        threw = e;
      }
      ok(threw, '[٢] فشل 403 يرمي خطأً صريحاً — لا يعود بقيمة صامتة');
      ok(/403/.test(threw.message), '[٢] نصّ الخطأ يحمل رمز الحالة 403');
      ok(/iam/i.test(threw.message), '[٢] نصّ الخطأ يحمل إرشاداً لمنح الصلاحية (رابط IAM) — لا سبباً مخمَّناً');
    } finally {
      global.fetch = realFetch;
    }
  }
  console.log('تحقّق ٢: فشل 403 من release API يرمي خطأً صريحاً يحمل إرشاد منح الصلاحية — لا تخمين، لا قيمة صامتة');

  // ═══════════════════════════════════════════════════════════════════════
  // ٣ — ruleset بلا source.files إطلاقاً — حالة صريحة، لا افتراض أوّل ملفّ
  //     صامتاً (القاعدة 22 — نفس تعليق الدالّة).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const realFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.includes('/releases/cloud.firestore')) {
        return {ok: true, json: async () => ({rulesetName: 'projects/x/rulesets/EMPTY'})};
      }
      return {ok: true, json: async () => ({name: 'projects/x/rulesets/EMPTY', source: {files: []}})};
    };
    try {
      let threw = null;
      try {
        await fetchCurrentlyDeployedFirestoreRules('fake-token');
      } catch (e) {
        threw = e;
      }
      ok(threw, '[٣] ruleset بلا source.files يرمي خطأً صريحاً');
      ok(/بلا source\.files/.test(threw.message), '[٣] نصّ الخطأ يسمّي المشكلة بالضبط');
    } finally {
      global.fetch = realFetch;
    }
  }
  console.log('تحقّق ٣: ruleset بلا source.files يُعامَل بحالة صريحة — لا سقوط صامت لمصفوفة فارغة');

  // ═══════════════════════════════════════════════════════════════════════
  // ٤ — sanitizeErrorMessage: تنقية توكن/بيانات اعتماد محتملة من نصّ خطأ،
  //     بنفس نمط export-v7-replay-inputs-readonly.js (القاعدة 24 بامتدادها
  //     — الفكرة نفسها، لا استيراد سكربت آخر لنفس الأسباب الموثَّقة هناك).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const msg = sanitizeErrorMessage(new Error('failed: access_token=abc123SECRET.xyz789 Bearer deadbeefTOKEN'));
    ok(!msg.includes('abc123SECRET.xyz789'), '[٤] قيمة access_token لا تصل النصّ المنقّى');
    ok(!msg.includes('deadbeefTOKEN'), '[٤] قيمة Bearer لا تصل النصّ المنقّى');
    eq(sanitizeErrorMessage(undefined), 'undefined', '[٤] مُدخل undefined لا يرمي — String() صراحة');
  }
  console.log('تحقّق ٤: sanitizeErrorMessage ينقّي أنماط access_token/Bearer من نصّ الخطأ قبل أي طباعة محتملة');

  console.log(`\nbackupFirestoreRulesBeforeDeploy.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('✗ backupFirestoreRulesBeforeDeploy.test.js فشل:', e);
  process.exit(1);
});

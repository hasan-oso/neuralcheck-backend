'use strict';

// sessionOwnerPlan.test.js — isSessionOwnerPlan (utils/plans.js): من تسمح باقته بإنشاء جلسة فحص بكود (A-SUB، البند ١، 2026-10-17 +03). بلا شبكة وبلا محاكٍ.
//
// القرار (المنسّق، منقول من نصّ الأمر، غير متحقَّق من هذا المستودع): دالّة واحدة تطابق دلالة الواجهة حرفياً — نصّ غير فارغ وفيه `basic` أو `pro` دون اعتبار الأحرف؛ أيّ شيء آخر ⟵ false.
// (الواجهة: HomeScreen.kt:121-123، منقول.)
//
// **`professional` مقبولة عمداً** (قرار A-SUB رقم 9، منقول: باقة الشريك في شهرها الأوّل)، **خلافاً لـ`isShop` في checkSubscription.js:44** الذي يعرّفه بالمساواة الصارمة مع shop_basic وshop_pro
// على القيمة المخزَّنة كما هي (بلا normalizePlan، كما قرأتُه من المصدر: `const plan = user.plan || "free"` ثم المساواة) فيُخرج professional، بل ويُخرج basic وpro أيضاً: الواجهة تعرض لصاحبها
// زرّ «فحص جهاز آخر» لأن اسمها يحوي «pro»، فلو حكمنا بـisShop لحُرم مالك يرى الزرّ. الاختبار يثبت الفرق صراحةً.
//
// Run: node functions/test/sessionOwnerPlan.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const {isSessionOwnerPlan, sessionOwnerPlanState, SESSION_OWNER_PLAN_STATE} = require('../src/utils/plans');

const show = (plan) => (plan === undefined ? 'undefined' : JSON.stringify(plan));

// ═══ ١ — جدول المطابقة (القيمة ⟵ الحكم ⟵ الحالة) ═══
const TABLE = [
  ['shop_basic', true, 'allowed'], ['shop_pro', true, 'allowed'], ['basic', true, 'allowed'], ['pro', true, 'allowed'],
  ['PRO', true, 'allowed'], ['Basic', true, 'allowed'],
  ['professional', true, 'allowed'], ['Professional-Month1', true, 'allowed'],
  ['free', false, 'not_owner_plan'], ['single', false, 'not_owner_plan'], ['', false, 'not_owner_plan'],
  [null, false, 'absent'], [undefined, false, 'absent'],
  [123, false, 'not_a_string'], [{}, false, 'not_a_string'],
  ['unlimited', false, 'not_owner_plan'], ['custom', false, 'not_owner_plan'],
];
for (const [plan, verdict, state] of TABLE) {
  eq(isSessionOwnerPlan(plan), verdict, `[١] isSessionOwnerPlan(${show(plan)})`);
  eq(sessionOwnerPlanState(plan), state, `[١] sessionOwnerPlanState(${show(plan)})`);
}
eq(isSessionOwnerPlan(), false, '[١] بلا وسيط ⟵ false (الغياب لا يُقرأ إذناً)');
eq(isSessionOwnerPlan(['pro']), false, '[١] مصفوفة تحوي pro ⟵ false (ليست نصّاً)');
eq(isSessionOwnerPlan(new String('pro')), false, '[١] كائن String ⟵ false (typeof ليس string)');

// ═══ ٢ — الحالات قائمة مغلقة، والحكم مشتقّ منها (لا شرطان) ═══
deq({...SESSION_OWNER_PLAN_STATE}, {ALLOWED: 'allowed', ABSENT: 'absent', NOT_A_STRING: 'not_a_string', NOT_OWNER_PLAN: 'not_owner_plan'}, '[٢] الحالات الأربع');
ok(Object.isFrozen(SESSION_OWNER_PLAN_STATE), '[٢] الحالات مجمَّدة');
for (const [plan] of TABLE) eq(isSessionOwnerPlan(plan), sessionOwnerPlanState(plan) === SESSION_OWNER_PLAN_STATE.ALLOWED, `[٢] الحكم = (الحالة == allowed) لـ${show(plan)}`);

// ═══ ٣ — الفرق عن isShop في checkSubscription (مقصود، مثبَّت) ═══
// حكم isShop يُقرأ من سطره في المصدر ويُنفَّذ كما هو (لا يُنسخ من ذاكرتنا) ثم يُقارَن.
const csSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'users', 'checkSubscription.js'), 'utf8').replace(/\r\n/g, '\n');
const isShopLine = csSource.split('\n').find((l) => /const isShop\s*=/.test(l));
ok(isShopLine, '[٣] سطر isShop موجود في checkSubscription.js');
const expr = isShopLine.match(/const isShop\s*=\s*(.+);/)[1];
const isShopOf = new Function('plan', `return ${expr};`);
ok(isShopOf('shop_basic') === true && isShopOf('shop_pro') === true && isShopOf('free') === false, `[٣] إعادة بناء isShop (${expr.trim()}) تقبل القانونيتين وتُخرج free`);
eq(isShopOf('professional'), false, '[٣] **isShop يُخرج professional**');
eq(isSessionOwnerPlan('professional'), true, '[٣] **وisSessionOwnerPlan تقبلها** — الفرق المقصود (قرار A-SUB 9: باقة الشريك في شهرها الأوّل، والواجهة تقبلها)');
eq(isSessionOwnerPlan('Professional-Month1'), true, '[٣] وProfessional-Month1 كذلك');
for (const plan of ['basic', 'pro', 'PRO', 'Basic']) {
  eq(isShopOf(plan), false, `[٣] isShop (مساواة صارمة على المخزَّن) تُخرج ${plan}`);
  eq(isSessionOwnerPlan(plan), true, `[٣] وisSessionOwnerPlan (احتواء بلا اعتبار الأحرف) تقبلها: ${plan}`);
}

// ═══ ٤ — لا اعتماد على isShop/normalizePlan في الدالّة ولا في createScanSession (الفخّ الذي سمّاه المنسّق) ═══
const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
const plansSrc = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'plans.js'), 'utf8'));
const fnBody = (plansSrc.match(/function sessionOwnerPlanState\([\s\S]*?\n}\n/) || [''])[0];
ok(fnBody.length > 0 && !/normalizePlan|isShop|PLAN_ALIASES/.test(fnBody), '[٤] sessionOwnerPlanState لا تستعمل normalizePlan ولا isShop ولا PLAN_ALIASES');
const createSrc = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'createScanSession.js'), 'utf8'));
ok(!/\bnormalizePlan\b|\bisShop\b/.test(createSrc), '[٤] createScanSession لا تستعمل normalizePlan ولا isShop');
ok(/isSessionOwnerPlan\(userData\.plan\)/.test(createSrc), '[٤] createScanSession تحكم بـisSessionOwnerPlan(userData.plan)');
ok(!/isSessionOwnerPlan/.test(strip(csSource)), '[٤] checkSubscription لم تُمسّ (لا تستعمل الدالّة الجديدة)');

console.log(`sessionOwnerPlan.test.js: ${n}/${n} assertions passed`);

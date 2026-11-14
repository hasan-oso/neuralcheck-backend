'use strict';

// fv68AppPayloadGoldenCopy.test.js — V8 الدفعة ٣ الجزء ٣، الشقّ الخاصّ بالخادم (2026-10-08 +03)؛ **مُحدَّث 2026-10-10 +03 إلى fv69 (الدفعة ١٠)**.
//
// يحرس **النسخة الحرفية** لست ملفّات ذهبية لحمولة التطبيق في test/fixtures/golden/ — **على fv69 الآن** (fieldsVersion 69) —
// نُسخت من NeuralChek@a04b4f0 (app/src/test/resources/derived/، sha256 الستّة تطابق SHA256SUMS.txt في مجلّد المنسّق
// evidence/v8-phase0/fv69-for-backend/ وجدول عقد التطبيق §٧-ح) كما هي، بلا تعديل هنا.
// تاريخها: كانت fv68 على NeuralChek@738da89 (وقبلها cfa9ef3 حتى 2026-10-08: أعاد التطبيق توليد 13ch و16ch في e7fa26e بعد ت-02)؛ وأعاد التطبيق
// توليدها على fv69 في a04b4f0 (الحالات الأربع وmanualResultsHeader وخامّ M-02 وSN-04)، فحلّت محلّ نسخ fv68 هنا بـgit mv ثم نسخ فوقها (يبقى تاريخها).
// ⚠️ اسم هذا الملفّ ما زال fv68AppPayloadGoldenCopy لأن أمر المهمّة سمّاه بهذا الاسم؛ والمحروس فيه fv69 (البادئة والـsha256 أدناه).
// ⚠️ **fv68 لم يُشحن في أيّ APK** (1.0.10 على fv67): لا منتِج لشكل fv68 في الميدان، فلا عيّنة fv68 باقية ولا اختبار يلزمه.
// قرّاؤها: كل قارئ يُختبر عليها (القاعدتان 37 و41) — fv68Reader.test.js وfindingsFv68Readers.test.js وfv68RawPreservation.test.js وغيرها،
// وanalyzeDeviceFv68.e2e.test.js يمرّرها بـanalyzeDevice الحقيقية على المحاكي.
// هذا الاختبار يثبّت ما لا يُثبَت بغيره: أن الملفّات التي سيقرؤها القرّاء **هي** ما أنتجه التطبيق.
//
// ثلاثة فحوص (نصّ الأمر)، لا غير:
//   ١) sha256 للملفّات الستّة — يُحسب على البايتات الخام (لا على نصّ مفكوك)، فيلتقط كل تحويل
//      للأسطر (core.autocrlf=true في هذه الآلة، وهو ما يمنعه `.gitattributes` بـ`-text`) وكل تعديل يدوي.
//   ٢) كل ملفّ .json يُفكّ JSON.
//   ٣) مفاتيح كل .json تطابق ملفّ .keys.txt الذي بجانبه — مطابقة نصّية كاملة، لا مجموعة وحسب.
//
// وبعدها بابٌ مُعلَن لا فحص رابع: المجلّد لا يحمل ملفّاً سابعاً يبدأ بالبادئة نفسها ولم يُعدَّد هنا
// (القاعدة 25 — الطبقة تُعلن ما طلبته ولم تجده؛ لا تُسقط ملفّاً صامتةً).
//
// ─── طريقة بناء قائمة المسارات — **مُستنتَجة من نصّ الأمر ومُتحقَّقة بالمطابقة، لا منقولة من كود التطبيق** ───
// نصّ الأمر: «مسار منقوط، و[] بعد المصفوفة، والأسطر مرتّبة». وهذا بناء مطابق **حرفاً بحرف** للملفّات
// الثلاثة (288 و305 و302 سطراً على fv69 a04b4f0؛ كانت 277 و294 و293 على fv68 738da89، و277 و293 و292 على cfa9ef3):
//   - كل مفتاح في كائن يُضاف بمساره المنقوط (الحاويّات أيضاً: `device` و`functionalResults`).
//   - النزول إلى عنصر كائن في مصفوفة يُلحق `[]` بمسار المصفوفة (`functionalResults[].testId`).
//     ولا يُضاف مسار `functionalResults[]` بذاته.
//   - عناصر المصفوفة غير الكائنات (نصوص، أرقام: `timeSeries.samples[].v`) لا تُنتج مساراً.
//   - مجموعة بلا تكرار (عناصر المصفوفة تكرّر المسار)، ثم فرز افتراضي (ترتيب وحدات UTF-16)، ثم `\n` بعد كل سطر.
// ⚠️ **حالتان لا يمرّ بهما أيّ من الملفّات الستّة، فسلوك الباني فيهما غير مُتحقَّق من كود التطبيق:**
// قيمة null، ومصفوفة داخل مصفوفة. فإن ظهرت إحداهما في نسخة مُعاد توليدها فقد يفشل الفحص ٣ —
// وهذا مقصود: يُبلَّغ بالفرق ولا يُخمَّن (نصّ الأمر).
//
// ═══ إضافة 2026-10-13 +03 (قرّاء D في fv70) — **المحروس الآن مجموعتان:** fv69 (أعلاه، تبقى) وfv70 (جديدة). ═══
// fv70 = الستّ نفسها بعد أن غيّر التطبيق عيّناته (NeuralChek@80ca8c3، §٧-ط من عقد التطبيق: sieveLimit، وskipped:time_budget، وpartial:time_budget) — نُسخت بايتاً ببايت من مجلّد المنسّق
// scratchpad/be-d-readers-2026-10-13/goldens-from-app-80ca8c3/ (ومعه SHA256SUMS.txt، تحقّقتُ من كل sha قبل الالتزام وبعده). **fv69 تبقى**: التطبيقات القديمة (1.0.11) ما زالت ترسل 69، وعيّنات fv69 هي الدليل
// الوحيد بشكل المنتِج الحقيقي على دلالتي «بلا sieveLimit ⟵ N = 10000000» و«ran بلا متروك». حذفها يُسقط حراسة القرّاء على ما يصل فعلاً من الميدان. (أمر المنسّق: «قرّر هل تبقى، واكتب السبب».)
// ملاحظة: ترويسة عيّنات fv70 تحمل appVersion=1.0.11 (مولَّدة في التطبيق، مشتقّة لا مسجَّلة) — لا يُستنتج منها إصدار تطبيق.
//
// ═══ إضافة 2026-10-18 +03 (مزامنة fv71، S-SYNC) — **المحروس الآن ثلاث مجموعات:** fv69 وfv70 وfv71. ═══
// fv71 = الحمولات الثلاث نفسها بعد A-M02 وA-VOL وA-P6-13 في التطبيق (NeuralChek@f9e0571، fieldsVersion 71): **صنعها اختبار التطبيق الذهبي من سلسلته الحقيقية** (لا من العقد كما كانت عيّناتي التركيبية التي حلّت هذه محلّها)،
// ونُسخت بايتاً ببايت من مجلّد المنسّق evidence/run-2026-10-18/fv71-producer-goldens/ (ثلاثة .json بأحجام 228287 و256334 و545414 بايتاً وثلاثة .keys.txt).
// **sha256 الستّة محسوبة هنا من الملفّات المنسوخة** (sha256sum)، وثلاثة منها تبدأ بما في نصّ الأمر: c52d8ebf… (11ch) · 1c0e0391… (13ch) · 7e786b56… (16ch). لا README في مجلّد المنسّق يحمل القيم الكاملة
// ولا أقرأ README التطبيق (خارج حدودي) — فالتطابق الكامل مع README التطبيق **منقول، غير متحقَّق**؛ والمحروس هنا ثباتها على ما نُسخ (القاعدة 12).
// تحمل ترويسة عيّناتها appVersion مولَّداً في التطبيق (مشتقّة لا مسجَّلة من جهاز): لا يُستنتج منها إصدار تطبيق.
//
// ═══ إضافة 2026-10-21 +03 (M-02 «إطار + X»، أمر الباك اند ٤) — **مجموعة fv71 استُبدلت بما أعاد التطبيق توليده من مُنتِجه الحقيقي (NeuralChek@4c0102c).** ═══
// الأسماء نفسها والبايتات الجديدة: ستّة ملفّات بأحجام 229202 و257018 و545521 بايتاً (.json) وثلاثة .keys.txt، نُسخت بايتاً ببايت من evidence/run-2026-10-18/fv71-producer-goldens-4c0102c/ (SHA256SUMS.txt هناك
// يطابق sha256 هنا كاملاً: فُحص بـsha256sum -c). **ما تغيّر في M-02 وحده:** المفتاحان gridPattern وnotRequiredCells، وtotalCells وtouchedCells وuntouchedCells صارت للخلايا **المطلوبة** (إطار + قطران).
// المجموعة السابقة (f9e0571: c52d8ebf… و1c0e0391… و7e786b56…) لا تُحذف من التاريخ (git)؛ ونسختان منها (11ch و13ch) باقيتان بأسماء fv71-before-m02-frame-x-… دليلاً على ما يرسله بناء ≤ 324578f (بلا المفتاحين)
// وتُحرَسان بـsha256 في test/fv71M02FrameXReader.test.js (حالة NOT_DECLARED من مُنتِج حقيقي لا من عيّنة اصطناعية، القاعدة 41).
//
// ═══ إضافة 2026-10-22 +03 (M-02 بشكل اختبار اللمس في قائمة سامسونج، أمر الباك اند ٧) — **الثلاثة .json في مجموعة fv71 استُبدلت ثانيةً بما أعاد التطبيق توليده (NeuralChek@3810146).** ═══
// الأسماء نفسها والبايتات الجديدة: ثلاثة .json بأحجام 232478 و256929 و472206 بايتاً، والـ.keys.txt الثلاثة **بلا تغيير** (القيم نفسها: لا مفتاح جديد ولا مُعاد تسميته؛ gridPattern كما هو)، نُسخت بـcp بايتاً ببايت من NeuralChek app/src/test/resources/derived/
// وsha256 الستّة تطابق الكتلة بين golden-sha256:begin وgolden-sha256:end في README ذلك المجلّد كاملةً (فُحصت هنا بـsha256sum -c وcmp). **ما تغيّر في M-02 وحده** (فرق مقيس بين المجموعتين): الخليّة مربّعة 4 مم (كانت 6)، 18 عموداً (كانت 12)، 33 صفّاً لـ11ch و35 لـ13ch و16ch (كانت 24)،
// وشريط علويّ فارغ (surfaceOriginYPx 120 و160) فسطح اللمس = الشبكة لا النافذة، وغير المطلوبة 406 و432 (كانت 180) والمطلوبة 188 و194 (كانت 108 و106)، وcutoutCells [8, 9, 26, 27] لـ13ch و16ch (كانت [5, 6]). المجموعة السابقة (4c0102c: 6ca263d5… 01601fb9… 6501b367…) لا تُحذف من التاريخ (git).
//
// Run: node functions/test/fv68AppPayloadGoldenCopy.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const FV69 = {
  label: 'fv69',
  prefix: 'fv69-app-request-payload-derived-from-',
  stem: 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-',
  // sha256 الستّة (fv69، NeuralChek@a04b4f0) — مصدرها نصّ أمر المنسّق ومجلّده evidence/v8-phase0/fv69-for-backend/SHA256SUMS.txt
  // (وتطابق جدول عقد التطبيق §٧-ح «sha256 بعد»)، وتُسرد أيضاً في test/fixtures/golden/README.md.
  // (كانت fv68، 738da89: 58e88edd… 4399e5bf… a8f5d498… bfcaea2d… 3b30649a… 67a5baf0… — مسرودة كاملةً بتاريخها في README.md.)
  expected: null,
};
FV69.expected = {
  [`${FV69.stem}11ch-nothing-admitted.json`]: '2e8b03444a8e29ffa37a06aca94e87f25130aeae2fdb412b290816cbd9425672',
  [`${FV69.stem}11ch-nothing-admitted.keys.txt`]: '5c75fb73f12e395f678762d806f1be8ffcbe5163da2bed3509a99979dc31a9b8',
  [`${FV69.stem}13ch-selinux-blocked-policy.json`]: '0d40ab66dd37034cc16a1c89b53a9729b63255caae36c35ab38f8375be1be1a9',
  [`${FV69.stem}13ch-selinux-blocked-policy.keys.txt`]: 'e60894a7ed099162b26975ce2366bf5d4125df22fff7aa6b202ea5cd50749dd6',
  [`${FV69.stem}16ch-four-policies-truncated-failures.json`]: 'b42e8211fef8e1920b841fd2c962b23ef990f31a60f4d2365695c65aaa74b041',
  [`${FV69.stem}16ch-four-policies-truncated-failures.keys.txt`]: '86d1675fc49d49df46387bc73cb3da1e3123897abf0222eb17bd76651ba8ed6b',
};
const FV70 = {
  label: 'fv70',
  prefix: 'fv70-app-request-payload-derived-from-',
  stem: 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-',
  // sha256 الستّة (fv70، NeuralChek@80ca8c3) — من SHA256SUMS.txt المرفق بالنسخ (مجلّد المنسّق be-d-readers-2026-10-13/goldens-from-app-80ca8c3/)، تحقّقتُ منها بـsha256sum -c قبل النسخ وبعد الالتزام.
  expected: null,
};
FV70.expected = {
  [`${FV70.stem}11ch-nothing-admitted.json`]: '1f85392014ecd79c0d2bd89b4985c36f0c785c0471647204b3434db46db4dadb',
  [`${FV70.stem}11ch-nothing-admitted.keys.txt`]: '0dc19ce36290f17fa5b528ca6968fcca6eec4dac97aa9446083c591059d589b3',
  [`${FV70.stem}13ch-selinux-blocked-policy.json`]: 'a46f60f163d3ed71c14d82d9ff86df77304de4d81cec96c3b6f59dee5b525e92',
  [`${FV70.stem}13ch-selinux-blocked-policy.keys.txt`]: '1634ec58f3b4cb3ab0799ac64047a4f0076635e96de587ac6c244c4f27113c32',
  [`${FV70.stem}16ch-four-policies-truncated-failures.json`]: '841dbd4ff0fdce3a7392d862cd094bafbeb5c588e5550c9af2635f410b85cb9e',
  [`${FV70.stem}16ch-four-policies-truncated-failures.keys.txt`]: '2e5f17855a5a252a4521c836f648a7d7b5e2240ce19fb9269f2a81e08863285a',
};
const FV71 = {
  label: 'fv71',
  prefix: 'fv71-app-request-payload-derived-from-',
  stem: 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-',
  // sha256 الستّة (fv71، NeuralChek@3810146 منذ 2026-10-22؛ كانت 4c0102c ثم f9e0571) — الكتلة بين golden-sha256:begin وgolden-sha256:end في NeuralChek app/src/test/resources/derived/README.md، وتطابقها sha256sum على الملفّات المنسوخة هنا.
  // (كانت 4c0102c: 6ca263d5… 41115aaf… 01601fb9… 98f7884e… 6501b367… 4765ebae… — الثلاثة .json وحدها تغيّرت؛ الـ.keys.txt الثلاثة بلا تغيير: gridPattern كما هو.)
  expected: null,
};
FV71.expected = {
  [`${FV71.stem}11ch-nothing-admitted.json`]: 'ffaa4c0eb639436f81fac7154046b0e1d23abd78e270db961459010adc5e4268',
  [`${FV71.stem}11ch-nothing-admitted.keys.txt`]: '41115aafd3cedd2f5a4dc8d5f6c8b99edefdb8f80a12cb9ed3a417195739775e',
  [`${FV71.stem}13ch-selinux-blocked-policy.json`]: '76bd343269d75fe024390a8a9a5b2c84ec79fc4c08ad1e752ce7f64b36b9b335',
  [`${FV71.stem}13ch-selinux-blocked-policy.keys.txt`]: '98f7884e8adaeff66ad63bce8dc24026f389d942a169e18ece07ecc1b1931b5e',
  [`${FV71.stem}16ch-four-policies-truncated-failures.json`]: '82c11219cea5e917a9693bd85e455e65a84f1928c370779bca1d57f81247106a',
  [`${FV71.stem}16ch-four-policies-truncated-failures.keys.txt`]: '4765ebae1fe675ea164f796b2e607ab3be0219ffce1ac6dc95bc4e519ff2f3a3',
};
// أسماء fv69 المستعمَلة في الضوابط السلبية أدناه (لم تتغيّر)
const STEM = FV69.stem;
const EXPECTED_SHA256 = FV69.expected;

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// يبني نصّ ملفّ .keys.txt المتوقَّع من قيمة JSON مفكوكة (انظر الرأس).
function buildKeysText(root) {
  const paths = new Set();
  const walk = (value, prefix) => {
    if (Array.isArray(value)) {
      for (const el of value) {
        if (el !== null && typeof el === 'object') walk(el, `${prefix}[]`);
      }
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const p = prefix === '' ? key : `${prefix}.${key}`;
        paths.add(p);
        walk(value[key], p);
      }
    }
  };
  walk(root, '');
  return [...paths].sort().map((p) => `${p}\n`).join('');
}

// فرق مقروء بين نصَّي مفاتيح — يُعرَض في رسالة الفشل لا تخميناً.
function diffLines(builtText, fileText) {
  const a = builtText.split('\n').filter((l) => l !== '');
  const b = fileText.split('\n').filter((l) => l !== '');
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyBuilt: a.filter((l) => !sb.has(l)).slice(0, 5),
    onlyFile: b.filter((l) => !sa.has(l)).slice(0, 5),
  };
}

for (const set of [FV69, FV70, FV71]) {
  // ─── (إعلان) المجلّد لا يحمل ملفّاً سابعاً بالبادئة نفسها ولم يُعدَّد ───────
  const actualNames = fs.readdirSync(GOLDEN_DIR).filter((f) => f.startsWith(set.prefix)).sort();
  const expectedNames = Object.keys(set.expected).sort();
  eq(JSON.stringify(actualNames), JSON.stringify(expectedNames),
      `[إعلان][${set.label}] ملفّات "${set.prefix}*" في golden/ هي الستّة المعدَّدة هنا بالضبط — لا ناقص ولا زائد`);
  eq(expectedNames.length, 6, '[إعلان] ستّة ملفّات معدَّدة: ثلاثة .json وثلاثة .keys.txt');
  eq(expectedNames.filter((f) => f.endsWith('.json')).length, 3, '[إعلان] ثلاثة .json');
  eq(expectedNames.filter((f) => f.endsWith('.keys.txt')).length, 3, '[إعلان] ثلاثة .keys.txt');

  // ─── (١) sha256 على البايتات الخام ─────────────────────────────────────────
  for (const name of expectedNames) {
    const full = path.join(GOLDEN_DIR, name);
    ok(fs.existsSync(full), `[١] "${name}" موجود في golden/`);
    const bytes = fs.readFileSync(full);
    eq(sha256Hex(bytes), set.expected[name], `[١] sha256 "${name}" — الملفّ نسخة حرفية من مصدره (لا تحويل أسطر ولا تعديل)`);
  }

  // ─── (٢) و(٣) كل .json يُفكّ JSON، ومفاتيحه تطابق .keys.txt بجانبه ──────────
  for (const jsonName of expectedNames.filter((f) => f.endsWith('.json'))) {
    const keysName = jsonName.replace(/\.json$/, '.keys.txt');
    ok(Object.prototype.hasOwnProperty.call(set.expected, keysName), `[٣] "${jsonName}" له شقيقه "${keysName}" في القائمة`);

    let parsed;
    let parseError = null;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, jsonName), 'utf8'));
    } catch (e) {
      parseError = e.message;
    }
    eq(parseError, null, `[٢] "${jsonName}" يُفكّ JSON`);
    ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), `[٢] "${jsonName}": الجذر كائن`);

    const fileText = fs.readFileSync(path.join(GOLDEN_DIR, keysName), 'utf8');
    const builtText = buildKeysText(parsed);
    const d = diffLines(builtText, fileText);
    eq(builtText === fileText, true,
        `[٣] مفاتيح "${jsonName}" تطابق "${keysName}" نصّاً كاملاً — فقط في المبنيّ: ${JSON.stringify(d.onlyBuilt)}، فقط في الملفّ: ${JSON.stringify(d.onlyFile)}`);
    ok(fileText.split('\n').length - 1 >= 200, `[٣] "${keysName}": مئتا سطر على الأقلّ (لا مطابقة على قائمتين فارغتين)`);
  }
}

// ─── ضوابط سلبية (القاعدة 30) — أن المقارنة تكشف فعلاً لا أنها تنجح دائماً ────
{
  const jsonName = `${STEM}11ch-nothing-admitted.json`;
  const keysName = `${STEM}11ch-nothing-admitted.keys.txt`;
  const parsed = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, jsonName), 'utf8'));
  const fileText = fs.readFileSync(path.join(GOLDEN_DIR, keysName), 'utf8');

  // مفتاح زائد في الكائن ⇒ تختلف المطابقة.
  const withExtra = JSON.parse(JSON.stringify(parsed));
  withExtra.device.__negativeControlExtraKey = 1;
  ok(buildKeysText(withExtra) !== fileText, 'ضابط سلبي: مفتاح زائد في JSON يُكتشف');

  // سطر ناقص في ملفّ المفاتيح ⇒ تختلف المطابقة.
  const lines = fileText.split('\n');
  const withoutOne = [...lines.slice(0, 10), ...lines.slice(11)].join('\n');
  ok(buildKeysText(parsed) !== withoutOne, 'ضابط سلبي: سطر ناقص في .keys.txt يُكتشف');

  // بايت واحد مختلف ⇒ يختلف sha256 (الحساب على البايتات الخام فعلاً).
  const bytes = Buffer.from(fs.readFileSync(path.join(GOLDEN_DIR, jsonName)));
  bytes[0] = bytes[0] ^ 1;
  ok(sha256Hex(bytes) !== EXPECTED_SHA256[jsonName], 'ضابط سلبي: بايت واحد مختلف يغيّر sha256');

  // تحويل نهايات الأسطر (ما تفعله core.autocrlf=true بلا -text) يغيّر sha256.
  const crlf = Buffer.from(fs.readFileSync(path.join(GOLDEN_DIR, keysName), 'utf8').replace(/\n/g, '\r\n'));
  ok(sha256Hex(crlf) !== EXPECTED_SHA256[keysName], 'ضابط سلبي: تحويل \\n إلى \\r\\n يغيّر sha256 (وهو ما يمنعه -text في .gitattributes)');
}

console.log(`\nfv68AppPayloadGoldenCopy.test.js: ${n}/${n} assertions passed`);

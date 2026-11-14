'use strict';

// fieldsVersionThresholds.test.js — جرد الدفعة ١٠ (قارئ ق٨)، 2026-10-10 +03، القاعدتان 25 و37.
//
// السؤال: هل يُقرأ ختم fieldsVersion 69 «غير قديم» في كل مقارنة إصدار في الخادم، وهل في الخادم قائمة بيضاء بالإصدارات تُسقط ما لا تعرفه؟
// الجرد (batch10-server-readers-inventory-2026-10-10.md، ق٨، بالأداة عند 83d7750): كلّ المقارنات عتبات (≥ 68 أو ≤ 67) ولا قائمة بيضاء. هذا الاختبار
// يحوّل ذلك من «قراءة» إلى حارس دائم + إثبات سلوكي، بالعيّنات الحقيقية (القاعدة 41) لا بحمولة مصنوعة:
//
//   (أ) ساكن: لا مقارنة مساواة/عدم مساواة بين fieldsVersion (أو ثوابت FIELDS_VERSION_6x) وعدد، ولا مصفوفة أعداد تُفحَص بها (لا «إصدارات معروفة»).
//       وكل مقارنة عتبة من العدد المُعدَّد أدناه — فإن زيدت مقارنة جديدة أُخفق الاختبار ليُراجَع الإصدار (القاعدة 25: «كل قارئ يُعدَّد»).
//   (ب) سلوكي: على عيّنات fv69 الثلاث (حمولة التطبيق كما تصل analyzeDevice): نتيجة computeFindings واحدة لـ68 و69 و70 (بعد إخفاء قيمة الختم نفسها)،
//       وcheckFooterIntegrity كذلك، وreadFv68 (ما عدا measurements وabsences — الأولى تتبع الختم 69 بقصد). **ضابط سلبي** (القاعدة 30): الختم 67 يُغيّر
//       النتائج، فالمقارنة حسّاسة فعلاً لا ثابتة.
//
// ما لا يغطّيه: analyzeDevice.js يُرسل الختم إلى مستند التقرير مرآةً بلا مقارنة (fieldsVersion: tsFooter.fieldsVersion) — يُثبَّت في analyzeDeviceFv68.e2e.test.js
// (eq(r.fieldsVersion, 69)) على المحاكي.
//
// Run: node functions/test/fieldsVersionThresholds.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {computeFindings} = require('../src/analysis/findings');
const {checkFooterIntegrity} = require('../src/analysis/footerIntegrity');
const {readFv68} = require('../src/analysis/fv68Reader');
const N = require('../src/analysis/fv68Names');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const SRC = path.join(__dirname, '..', 'src');
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');

// ═══════════════════════════════════════════════════════════════════
// (أ) ساكن
// ═══════════════════════════════════════════════════════════════════
const listJs = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return (e.name === 'prompts' || e.name === 'lab') ? [] : listJs(p);
  return e.name.endsWith('.js') ? [p] : [];
});
const isCommentLine = (l) => { const t = l.trim(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };

// كل سطر كود فيه fieldsVersion أو FIELDS_VERSION_6x مع معامل مقارنة
const COMPARE_RE = /(fieldsVersion|FIELDS_VERSION_6\d|\bfv\b)\s*(===|!==|==|!=|<=|>=|<|>)\s*([A-Za-z_.0-9]+)|([A-Za-z_.0-9]+)\s*(===|!==|==|!=|<=|>=|<|>)\s*(fieldsVersion|N\.FIELDS_VERSION_6\d)/g;
const sites = [];
for (const file of listJs(SRC)) {
  if (path.basename(file) === 'fv68Names.js') continue; // التعريف والتصدير
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (isCommentLine(line)) return;
    COMPARE_RE.lastIndex = 0;
    let m;
    while ((m = COMPARE_RE.exec(line)) !== null) {
      const subject = m[1] || m[6];
      const op = m[2] || m[5];
      const other = m[3] || m[4];
      sites.push({file: path.relative(SRC, file).replace(/\\/g, '/'), line: i + 1, subject, op, other});
    }
  });
}
// المقارنات بـnull (فحص الغياب) ليست عتبة إصدار
const versionSites = sites.filter((s) => s.other !== 'null');
ok(versionSites.length >= 7, `(أ) وُجدت مقارنات الإصدار (${versionSites.length}) — وإلا انهار البحث الساكن`);
eq(versionSites.filter((s) => ['===', '!==', '==', '!='].includes(s.op)), [],
    '(أ) لا مقارنة مساواة أو عدم مساواة بين الختم وعدد في الخادم: لا إصدار «معروف» يُسقَط ما سواه (ق٨: فـ69 يُقرأ غير قديم)');
// العتبات المُعدَّدة: ملفّ ← قائمة معاملات (العتبة نفسها) — ≥ 68 أو ≤ 67 أو ≥ 69 (M-02) أو ≥ 66 (maxBatteryTemp)
const summary = {};
for (const s of versionSites) (summary[s.file] = summary[s.file] || []).push(`${s.op} ${s.other}`);
for (const k of Object.keys(summary)) summary[k].sort();
eq(summary, {
  'analysis/findings.js': ['< N.FIELDS_VERSION_68', '<= 67', '<= 67', '<= 67'],
  'analysis/footerIntegrity.js': ['>= TRUE_MAX_BATTERY_TEMP_SINCE'],
  // 2026-10-13 +03 (قرّاء D في fv70، الجزء الرابع): مقارنتان جديدتان في readCpuKnownAnswer — ختم >= 70 ⟵ غياب sieveLimit في نصف يُنتظَر معه شذوذٌ مُعلَن؛ وختم 68 و69 ⟵ N الافتراضي 10000000 (§٧-ط، منقول)؛ وكلتاهما عتبة لا مساواة.
  // 2026-10-18 +03 (S-M02، fv71): مقارنة واحدة جديدة في readTouchGrid — ختم >= 71 ⟵ gridBasis=MM_TARGET وقراءة مفاتيح M-02 الجديدة (القسم §٧-ي ف-01). touchPath.js لا يقارن ختماً (يستلم الحالة من القارئ).
  'analysis/fv68Reader.js': ['>= N.FIELDS_VERSION_68', '>= N.FIELDS_VERSION_68', '>= N.FIELDS_VERSION_69', '>= N.FIELDS_VERSION_70', '>= N.FIELDS_VERSION_71'],
}, '(أ) مقارنات الإصدار في الخادم كلّها عتبات (≥ أو ≤ أو <)، وهذه قائمتها الكاملة — مقارنة جديدة تُخفق هذا الاختبار حتى تُراجَع وتُعدَّد');
// لا مصفوفة أعداد تُفحَص بها الأختام (قائمة بيضاء): [67, 68].includes(fieldsVersion) أو مفتاح كائن بأرقام الإصدار
{
  const whitelistRe = /\[\s*\d+\s*(,\s*\d+\s*)+\]\.(includes|indexOf)\(\s*[^)]*(fieldsVersion|\bfv\b)|(fieldsVersion|\bfv\b)[^;\n]*\bin\s*\{|(MAX|SUPPORTED|KNOWN)_(FIELDS_)?VERSIONS?/;
  const hits = [];
  for (const file of listJs(SRC)) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (isCommentLine(line)) return;
      if (whitelistRe.test(line)) hits.push(`${path.relative(SRC, file)}:${i + 1}`);
    });
  }
  eq(hits, [], '(أ) لا قائمة بيضاء بالإصدارات (مصفوفة أعداد أو MAX/SUPPORTED/KNOWN_VERSIONS)');
}
// ضابط سلبي للبحث الساكن: سطر مساواة يُلتقط، وعتبة لا تُلتقط كمساواة
{
  const probe = (line) => { COMPARE_RE.lastIndex = 0; const m = COMPARE_RE.exec(line); return m ? (m[2] || m[5]) : null; };
  eq(probe('if (fieldsVersion === 68) {'), '===', '(أ) ضابط سلبي: «fieldsVersion === 68» يُلتقط مساواةً');
  eq(probe('if (69 !== fieldsVersion) {'), '!==', '(أ) ضابط سلبي: «69 !== fieldsVersion» يُلتقط');
  eq(probe('const legacy = fieldsVersion <= 67;'), '<=', '(أ) ضابط سلبي: العتبة تُلتقط عتبةً لا مساواة');
}

// ═══════════════════════════════════════════════════════════════════
// (ب) سلوكي — عيّنات fv69 الحقيقية (حمولة التطبيق كما تصل analyzeDevice)
// ═══════════════════════════════════════════════════════════════════
const STEMS = ['11ch-nothing-admitted', '13ch-selinux-blocked-policy', '16ch-four-policies-truncated-failures'];
const load = (stem) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-${stem}.json`), 'utf8'));
const withVersion = (stem, v) => { const c = JSON.parse(JSON.stringify(load(stem))); c.timeSeries.footer.fieldsVersion = v; return c; };
// قيمة الختم نفسها تظهر في خرج الدوالّ (meta.fieldsVersion…): تُخفى لتُقارَن بقيّة النتيجة
const mask = (o) => JSON.stringify(o).replace(/"fieldsVersion":\d+/g, '"fieldsVersion":0');
const safe = (fn) => { try { return mask(fn()); } catch (e) { return `THROWS: ${e.message}`; } };

for (const stem of STEMS) {
  eq(load(stem).timeSeries.footer.fieldsVersion, 69, `(ب)[${stem}] العيّنة المُلتزَمة مختومة 69 (القاعدة 41: المُدخل هو ما يُنتجه التطبيق)`);
  const F = {};
  for (const v of [67, 68, 69, 70]) F[v] = safe(() => computeFindings(withVersion(stem, v)));
  ok(!F[69].startsWith('THROWS'), `(ب)[${stem}] computeFindings على fv69 لا ترمي`);
  eq(F[69] === F[68], true, `(ب)[${stem}] findings: fv69 تُقرأ كما fv68 تماماً (كل المقارنات في findings.js عتبات ≥ 68)`);
  eq(F[69] === F[70], true, `(ب)[${stem}] findings: وكما fv70 (لا سقف علوي)`);
  eq(F[67] === F[69], false, `(ب)[${stem}] ضابط سلبي: fv67 تُغيّر نتيجة findings — فالمقارنة حسّاسة للإصدار فعلاً`);

  const FI = {};
  for (const v of [65, 68, 69, 70]) FI[v] = JSON.stringify(checkFooterIntegrity(withVersion(stem, v).timeSeries.footer, withVersion(stem, v).device)).replace(/"fieldsVersion":\d+/, '"fieldsVersion":0');
  eq([FI[69] === FI[68], FI[69] === FI[70]], [true, true], `(ب)[${stem}] footerIntegrity: fv69 كما fv68 وfv70 (maxBatteryTemp يُفحَص من 66)`);
  eq(FI[65] === FI[69], false, `(ب)[${stem}] ضابط سلبي: fv65 (قبل 66) تُغيّر النتيجة — لا فحص لما قبل 66`);

  const RD = {};
  for (const v of [67, 68, 69, 70]) {
    const r = readFv68(withVersion(stem, v));
    RD[v] = {applicable: r.applicable, rest: mask((() => { const c = JSON.parse(JSON.stringify(r)); delete c.measurements; delete c.absences; return c; })())};
  }
  eq([RD[68].applicable, RD[69].applicable, RD[70].applicable], [true, true, true], `(ب)[${stem}] readFv68: مُنطبِق عند 68 و69 و70 (عتبة ≥ 68)`);
  eq(RD[67].applicable, false, `(ب)[${stem}] ضابط سلبي: وغير مُنطبِق عند 67`);
  // 2026-10-13 +03 (قرّاء D في fv70) — القاعدة 23: كان هنا «RD[69].rest === RD[70].rest»، يثبّت أن الختم 70 لا يغيّر القراءة. هذا لم يعد صحيحاً **بقرار**: ختم >= 70 ينتظر sieveLimit (§٧-ط)،
  // وعيّنة fv69 التي أُعيد ختمها 70 هنا لا تحمله، فيخرج الفرق الوحيد: أساس N للغربال المنفَّذ «ABSENT_IN_FV70» وشذوذ SIEVE_LIMIT_ABSENT بعدد عناصر الغربال المنفَّذ، لا غير.
  // الاستبدال يحرس الاتجاهين: 68 و69 بلا فرق، و70 يختلف بهذا الفرق وحده (تُنزَع الحقول الثلاثة وشذوذه فيتطابق ما عداه).
  const dropSieveLimitReading = (r) => {
    const c = JSON.parse(JSON.stringify(r));
    delete c.measurements; delete c.absences;
    for (const it of c.verification.cpuKnownAnswer.runs.items) { delete it.sieve.limit; delete it.sieve.referencePrimeCount; delete it.sieve.primeCountVsReference; }
    c.anomalies = c.anomalies.filter((a) => a.code !== 'SIEVE_LIMIT_ABSENT');
    return mask(c);
  };
  eq(RD[69].rest === RD[68].rest, true, `(ب)[${stem}] readFv68: ما عدا measurements وabsences لا يتغيّر بين 68 و69`);
  eq(RD[70].rest === RD[69].rest, false, `(ب)[${stem}] ضابط سلبي: وعند 70 تتغيّر القراءة (ينتظر sieveLimit فيُعلَن غيابه) — العتبة حسّاسة فعلاً`);
  eq(dropSieveLimitReading(readFv68(withVersion(stem, 70))) === dropSieveLimitReading(readFv68(withVersion(stem, 69))), true, `(ب)[${stem}] readFv68: بين 69 و70 فرق sieveLimit وحده (ما عداه متطابق)`);
  {
    const items70 = readFv68(withVersion(stem, 70)).verification.cpuKnownAnswer.runs.items;
    const carriers = items70.filter((it) => it.sieve.status !== null && N.SIEVE_STATUS_KINDS_CARRYING_LIMIT.includes(it.sieve.status.kind));
    eq(readFv68(withVersion(stem, 70)).anomalies.filter((a) => a.code === 'SIEVE_LIMIT_ABSENT').length, carriers.length, `(ب)[${stem}] عند 70: شذوذ SIEVE_LIMIT_ABSENT لكل غربال منفَّذ بلا N (${carriers.length})`);
    eq(carriers.every((it) => it.sieve.limit.basis === 'ABSENT_IN_FV70' && it.sieve.limit.value === null), true, `(ب)[${stem}] وأساسه ABSENT_IN_FV70 بلا قيمة مفترَضة (القاعدة 22)`);
  }
  // measurements تتبع الختم 69 بقصد: timeToFirstTouchMs «ليس في هذا الإصدار» عند 68 ومقروء عند 69
  const tg = (v) => readFv68(withVersion(stem, v)).measurements.items.find((i) => i.testId === 'M-02').touchGrid;
  eq(tg(69).elapsedMsBasis, N.TOUCH_GRID_ELAPSED_BASIS.FROM_FIRST_TOUCH, `(ب)[${stem}] M-02: عند 69 elapsedMs «من أوّل لمسة»`);
  eq(tg(68).elapsedMsBasis, N.TOUCH_GRID_ELAPSED_BASIS.UNDETERMINED_BEFORE_FV69, `(ب)[${stem}] وعند 68 «غير محدَّد» (لا يُقرأ بدلالة 69)`);
}

console.log(`\nfieldsVersionThresholds.test.js: ${n}/${n} assertions passed`);

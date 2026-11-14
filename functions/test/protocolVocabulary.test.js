'use strict';

// protocolVocabulary.test.js — مفردات بروتوكول جمع البيانات: الوثيقة والوحدة وجهان لمصدر واحد (P6-23، 2026-10-15 +03). وحدة بلا شبكة ولا محاكٍ.
//
// أمر P6-23 (منقول، غير متحقَّق): «ثوابت مُصدَّرة وحدها، لا قارئ ولا كاتب (القاعدة 24). واختبار يتحقّق أن كل اسم في جدول مفردات الوثيقة يساوي ما تصدّره
// الوحدة، والعكس. فإن اختلفا، أخفق.»
// القاعدة 24 (بنصّها): «القيمة الحرفية التي يقوم عليها تمييز — وسم، مفتاح، اسم حقل — لها حكم رقم القياس: مصدر واحد مُصدَّر، لا نسخة في كل ملفّ.»
//
// الأقسام:
//   ١ — الوحدة والوثيقة: كل مجموعة وكل مفتاح وكل قيمة، وكل ثابت مفرد، في الاتجاهين (جدولا §٨-أ و§٨-ب من docs/PROTOCOL_CONTRACT.md).
//   ٢ — الوحدة ثوابت وحدها: لا require ولا دالّة ولا معاملات؛ كل تصدير عدد أو نصّ أو كائن مجمَّد قيمه نصوص؛ لا مجموعة فارغة ولا قيمة مكرَّرة داخل مجموعة.
//   ٣ — الوسوم: design بمصدر P:/TL: ، proposal بمرجع E/A موجود فعلاً في الوثيقة (فلا مقترح بلا موضع للاعتماد) **وبلا صفّ محسوم له في §٧-أ** (وإلّا وجب decided)، decided بمرجع E<n> له صفّ في §٧-أ (ما حُسم، ونصّ قراره أو إذنه).
//   ٣-ب — وسم التعليق في الوحدة (// decided E3 …) على كل مفتاح وثابت يساوي الوسم ومصدره في جدولَي §٨ من الوثيقة، في الاتجاهين؛ ولا مفتاح بلا وسم (2026-10-15: رُفعت وسوم الصفوف المعتمدة معاً).
//   ٣-ج — صفوف §٧ الستّة والعشرون (أمر حسم §٧، 2026-10-15): كلٌّ في §٧-أ بوسم «معتمد 2026-10-15» أو «معتمد بتعديل 2026-10-15»، ولا واحد منها خارجه؛ خمسة بقرار المستخدم وواحد وعشرون بحسم المنسّق.
//   ٤ — علاقات داخل الوحدة، ومع كود قائم (مصدره هناك، والتطابق يُثبَّت هنا لا نسخة بلا حارس): VALID_RATINGS · VALID_VISIBLE_DEFECTS · UNUSABLE_REASON.KEY_ABSENT.
//   ٤-ب — الأعراض (E37): SYMPTOM ثلاثة عشر مفتاحاً، none_noticed فيها هو الثابت المفرد وحده، وجدول §٥-ج (SYMPTOM-TEXT) يساويها قيمةً وترتيباً وترقيماً، وتركيّته معتمدة 2026-10-16 (بلا «(öneri)»؛ و#5 وحده بـ«✓» وله صفّه الأوّل في السجلّ؛ ونصوص #2 و#10 و#11 هي نصّ المستخدم بحرفه).
//   ٤-ج — المستويات (E38): جدول §٥-ب (LEVEL-TEXT) فيه الستّة عشر (4 فئات × 4 مستويات) بمفاتيح الوحدة، والكلمات العربية الأربع، وحالة التركية «معتمد 2026-10-16» على كل صفّ عدا الصفّين المؤجَّلين (E28)، ووسم عتبات البطارية باقٍ؛ والصفّان battery.note وthermal.review_note «يُحسم في P6-08» بلا تركية. وقرارات المستخدم 2026-10-16 مثبَّتة بنصّها: Pil لا Batarya · Isınma · Kontrol etmedim (وقاعدة 3) · «şarj yüzdesi» في أوّل ذكر لنسبة الشحن · siz في كل النصوص · thermal.good (عربية وتركية) · thermal.weak · Zayıf/Weak وKötü/Bad · overall.excellent.
//   ٤-د — سجلّ اعتماد التركية (E28): كتلة TURKISH-APPROVALS لكل صفّ فيها تاريخ بصيغته أو «غير مسجَّل في المنقول» صريحاً، ونصّها يظهر في موضعه من الوثيقة، وكل خانة تركية موسومة «✓» في §٥-ج لها صفّ فيها؛ وصفّ الكتلة (2026-10-16: يسمّي LEVEL-TEXT وSYMPTOM-TEXT) بتاريخه ونصّ المستخدم الأخير بحرفه، وصفّ تعديل thermal.good العربي (قديمه وجديده).
//   ٤-هـ — قرارات المستخدم 2026-10-16 على خانات التركية بنصّها (checkTurkishDecisions): الخانات الحرفية، و«şarj yüzdesi» في أوّل ذكر، وما سقط (Batarya · Test etmedim)، وsiz (لا رمز مفرد، ورمز siz في الصفوف التي تخاطب الفنّي)، وthermal.good وthermal.weak وoverall.excellent، وعربية thermal.good الجديدة.
//   ٥ — ما لا يُصدَّر (returnRecords · return · return_not_working: قرار 2026-10-10؛ batteryPairs: الاسم القديم المصطدم باسم fv68 — أُعيدت تسميته batteryBeforeAfter، E42)، ولا قيمة هنا تساوي قيمة من مفردات الجلسة (sessionNames.js: مصدر واحد).
//   ٦ — مفردات الجلسة في الوثيقة (§٨-د) تساوي sessionNames.js في الاتجاهين.
//   ٧ — حارس بنيوي: أسماء المجموعات لا تظهر نصّاً حرفياً في أيّ ملفّ من functions/src أو index.js غير الوحدة.
//   ٨ — طفرات في الذاكرة (القاعدة 39): كل خلل مصطنع في الوثيقة أو في الوحدة يجب أن يُفشل verify() بسببه — فلا يمرّ الحارس على نسخة بلا حراسة.
//   ٩ — مفردات ربط «قبل/بعد صيانة» (أمر المستخدم 2026-10-22): DEFECT_TYPE خمسة مغلقة (decided E47)، وSETTABLE = normal وmaintenance_*، وbattery_* قيمتا قراءة تاريخيتان، والرفوض الجديدة بأسمائها، والاستثناء الصريح في الرأس والعقد بنصّ الأمر وإحالة ق33، والوسم والمصدر؛ مع طفراتها في آخر القسم ٨.
//
// verify() دالّة نقيّة تأخذ النصوص والكائنات وتعيد قائمة إخفاقات؛ فالطفرات تُجرى في الذاكرة لا بتعديل ملفّ في الشجرة.
//
// Run: node functions/test/protocolVocabulary.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(__dirname, '..', 'src');
const DOC_PATH = path.join(ROOT, 'docs', 'PROTOCOL_CONTRACT.md');
const MODULE_REL = 'protocol/protocolVocabulary.js';

const normalize = (s) => s.replace(/\r\n/g, '\n');
const V = require('../src/protocol/protocolVocabulary');
const N = require('../src/sessions/sessionNames');
const {VALID_RATINGS, VALID_VISIBLE_DEFECTS} = require('../src/evaluations/evaluationContract');
const {UNUSABLE_REASON} = require('../src/profiles/deviceProfileKey');

const PROV = new Set(['design', 'proposal', 'decided']);
const DESIGN_SRC = /^(?:P|TL):\d+(?:-\d+)?$/;
const PROPOSAL_SRC = /^(?:E|A)\d+$/;
const DECIDED_SRC = /^E\d+$/;
/**
 * ما لا يُصدَّر، ويجب أن تذكره الوثيقة في §٨-ج: الثلاثة الأُول أُسقطت بقرار المستخدم 2026-10-10 (P:686، P:723)؛ والرابع `batteryPairs` الاسم الذي سمّاه التصميم لمفتاح جزء (P:787)
 * وهو اسم حقل حمولة fv68 القائم (fv68Names.js FOOTER.BATTERY_PAIRS) وتحرس fv68Names.test.js ألّا يظهر حرفياً خارجه؛ أُعيدت تسمية المفتاح batteryBeforeAfter (E42) فلا يعود الاسم القديم.
 */
const MUST_STAY_OUT = Object.freeze(['returnRecords', 'return', 'return_not_working', 'batteryPairs']);

const unq = (c) => c.trim().replace(/^`/, '').replace(/`$/, '');

/**
 * صفوف §٧ الستّة والعشرون التي حُسمت بأمر حسم §٧ (2026-10-15، منقولة من نصّ الأمر)، وما فيها بقرار المستخدم، وما اعتُمد بتعديل.
 * تُكتب هنا بالأسماء لأن العدد (26 = 5 + 21) يُثبَّت بها: فإن نقص صفّ أو زاد في الوثيقة أخفق الاختبار.
 */
const SECTION7_USER_DECISIONS = Object.freeze(['E11', 'E17', 'E28', 'E34', 'E41']);
const SECTION7_COORDINATOR_DECISIONS = Object.freeze(['E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E12', 'E13', 'E14', 'E15', 'E16', 'E31', 'E32', 'E33', 'E35', 'E36', 'E39', 'E40', 'E43']);
const SECTION7_MODIFIED = Object.freeze(['E15', 'E41']); // «معتمد بتعديل»: E15 (حسم المنسّق) وE41 («تعديلك معتمد»: المستخدم)
const LABEL_APPROVED = '**معتمد 2026-10-15**';
const LABEL_APPROVED_MODIFIED = '**معتمد بتعديل 2026-10-15**';
const LABEL_E44 = '**معتمد (أ) 2026-10-16**'; // E44: قرار المستخدم 2026-10-16
const E44_EXECUTED = 'نُفِّذ في أمر P6-07 (2026-10-21)'; // اسم السبب الجديد في REPEAT_NOT_ELIGIBLE_REASON: كان «مؤجَّل بقرار ⇐ P6-07»، فاقترحه ونفّذه أمر S-P6-07 (القاعدة 23: استُبدل الاختبار الذي كان يثبّت التأجيل)
const E44_REASON_NAME = 'PARENT_JOINER_UNKNOWN';
const BY_USER = 'قرار المستخدم';
const BY_COORDINATOR = 'حسمه المنسّق بإذن المستخدم';
const NO_DATE_IN_SOURCE = 'غير مسجَّل في المنقول';

// ═══ اعتماد التركية 2026-10-16 (منقول عن أمر الباك اند، غير متحقَّق عندي: evidence/station2-plan/user-approval-turkish-levels-symptoms-2026-10-16.md في مساحة العمل) ═══
// قيم حرفية يقوم عليها تمييز: مصدر واحد هنا (القاعدة 24).
const TURKISH_APPROVAL_DATE = '2026-10-16';
const STATUS_TURKISH_APPROVED = `معتمد ${TURKISH_APPROVAL_DATE}`;
const USER_REVIEW_SENTENCE = 'راجعتُها بنفسي، لا متحدّث أصلي. فإن ظهر في يوم التجربة ما لا يفهمه مالك تركي، يُعدَّل.'; // نصّ المستخدم الأخير بحرفه
const TURKISH_BLOCKS = Object.freeze(['LEVEL-TEXT', 'SYMPTOM-TEXT']); // الكتلتان اللتان يغطّيهما صفّ كتلة في سجلّ §٥-د
// thermal.good: «وهذا تعديل منّي على عربية معتمدة» (المستخدم): المثال يتغيّر في اللغتين
const THERMAL_GOOD_AR_OLD = 'تشعر بالحرارة بوضوح، ولا تريد أن تتركه.';
const THERMAL_GOOD_AR_NEW = 'تشعر بالحرارة بوضوح، لكنك لا تحتاج أن تضعه.';
const THERMAL_GOOD_TR_EXAMPLE = 'Isıyı belirgin şekilde hissediyorsunuz, ama elinizden bırakma ihtiyacı duymuyorsunuz.';
const THERMAL_WEAK_TR_EXAMPLE = 'Ekranda telefonun ısındığına dair bir sistem uyarısı.'; // لا يقتبس نصّ النظام (النقطة 5)
const THERMAL_WEAK_AR_EXAMPLE_KEPT = 'رسالة «الهاتف ساخن» على الشاشة'; // العربية باقية (النقطة 5)
const OVERALL_EXCELLENT_TR_HEAD = '**Mükemmel** — Donanım olarak sorunsuz çalışıyor, hiçbir not yok.';
// نصوص المستخدم الثلاثة في الأعراض (العرض 2 والعرض 10 والعرض 11)، بحرفها
const SYMPTOM_TR_USER_TEXT = Object.freeze({
  battery_jumps_or_shuts_down: 'Şarj yüzdesi aniden düşüyor veya sıfıra inmeden kapanıyor',
  game_stutter_after_minutes: 'Oyunlar birkaç dakika sonra takılıyor',
  game_screen_lines_or_flicker: 'Oyun sırasında ekranda çizgiler veya titreme oluyor',
});
// خانات تركية بحرفها (النقاط 1 و2 وتعديل option.not_tested وقاعدة 3)
const LEVEL_TR_EXACT = Object.freeze({
  'category.battery': '**Pil**',
  'category.thermal': '**Isınma**',
  'option.not_tested': '**Kontrol etmedim**',
  'rule.3': '**Kategoriyi kontrol etmediyseniz «Kontrol etmedim» seçin.** Tahmin yürütmeyin.',
});
// «yüzde» حيث تعني نسبة الشحن ⟵ «şarj yüzdesi» في أوّل ذكر في كل خانة (قراءة «أوّل ذكر في كل نصّ»: الخانة التركية الواحدة نصّ). **أكّد المستخدم القراءة 2026-10-16** (منقول عن أمر الباك اند، غير متحقَّق):
// «"şarj yüzdesi" في الذكر الأوّل داخل كل مدخل فقط: هذا ما قصدتُه. والذكر الثاني يبقى "yüzde".» — فالذكر الثاني (مثال النسبة في battery.excellent وbattery.fair) يبقى «yüzde» بلا «şarj».
const CHARGE_PERCENT_ANCHORS = Object.freeze(['battery.excellent', 'battery.good', 'battery.fair', 'battery.weak']);
const CHARGE_PERCENT_USER_TEXT = '«şarj yüzdesi» في الذكر الأوّل داخل كل مدخل فقط: هذا ما قصدتُه. والذكر الثاني يبقى «yüzde».'; // نصّ المستخدم بحرفه (كما نقله الأمر)
// «ısı» ⇐ «ısınma» في موضعين بالاسم وحدهما (قرار المستخدم 2026-10-16، منقول عن أمر الباك اند، غير متحقَّق): لتطابق اسم الفئة category.thermal = «Isınma». ولا تُمسّ «ısı» في غيرهما (thermal.* وغيرها).
const ISINMA_USER_TEXT = '«ısı» في overall.intro ومثال overall.excellent ⇐ «ısınma»، لتطابق اسم الفئة.'; // نصّ المستخدم بحرفه (كما نقله الأمر)
const OVERALL_INTRO_TR_ISINMA = '(pil, performans, ısınma ve işlevler)';
const OVERALL_EXCELLENT_TR_EXAMPLE = '**Örnek:** Pil, performans, ısınma ve işlevlerin hepsinde not yok.';
const ISINMA_REGISTER_TR = 'performans, ısınma ve işlevler'; // خانة النصّ التركي في صفّ السجلّ: مشترك بين المقدّمة والمثال، فيظهر في موضعيه حرفاً بحرف
const ISI_UNTOUCHED_ANCHORS = Object.freeze(['thermal.excellent', 'thermal.weak']); // «ısı» تبقى فيهما (لا تُمسّ): حارس ضدّ استبدال شامل
// محظور في أيّ خانة تركية من الكتلتين: ما سقط بقرار المستخدم
const TURKISH_FORBIDDEN = Object.freeze([[/batarya/i, 'Batarya'], [/test etmedim/i, 'Test etmedim']]);
// siz في كل النصوص: رموز صيغة المفرد التي لا تُقبل في خانة تركية (رموز كاملة بعد التقطيع، لا أجزاء)، وفي المقابل رموز siz المطلوبة في الصفوف التي تخاطب الفنّي
const SEN_TOKENS = Object.freeze(['sen', 'senin', 'sana', 'seni', 'sende', 'senden', 'seç', 'ver', 'bırak', 'gözünle', 'elinden', 'bildiğin', 'hissediyorsun', 'duymuyorsun', 'geçiriyorsun', 'denediysen', 'etmediysen', 'yaptığın']);
const SIZ_MARKERS = Object.freeze({
  'rule.1': ['gözünüzle', 'verin'],
  'rule.2': ['seçin'],
  'rule.3': ['etmediyseniz', 'seçin'],
  'battery.health_thresholds': ['verin'],
  'performance.intro': ['yaptığınız'],
  'performance.excellent': ['denediyseniz'],
  'performance.fair': ['denediyseniz'],
  'performance.weak': ['denediyseniz'],
  'thermal.intro_2': ['verin', 'bildiğiniz'],
  'thermal.good': ['bildiğinizden', 'hissediyorsunuz', 'elinizden', 'duymuyorsunuz'],
  'thermal.fair': ['elinizden', 'geçiriyorsunuz'],
});
const turkishTokens = (s) => s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

/** قرارات المستخدم 2026-10-16 على خانات التركية، مثبَّتة بنصّها. L: {موضع: {word, ar, tr, status}} من LEVEL-TEXT؛ S: {مفتاح: {tr}} من SYMPTOM-TEXT. */
function checkTurkishDecisions(L, S, fails) {
  const must = (cond, msg) => { if (!cond) fails.push(`turkish: ${msg}`); };
  const trOf = (a) => (L[a] ? L[a].tr : undefined);
  for (const [a, want] of Object.entries(LEVEL_TR_EXACT)) must(trOf(a) === want, `${a} تركيتها «${want}» (قرار المستخدم ${TURKISH_APPROVAL_DATE})`);
  for (const a of CHARGE_PERCENT_ANCHORS) {
    const lower = (trOf(a) || '').toLowerCase();
    const i = lower.indexOf('yüzde');
    must(i >= 5 && lower.slice(i - 5, i) === 'şarj ', `${a}: أوّل ذكر لـ«yüzde» يجب أن يكون «şarj yüzdesi»`);
    // الذكر الثاني (وما بعده) يبقى «yüzde» بلا «şarj» (تأكيد المستخدم 2026-10-16)
    for (let j = lower.indexOf('yüzde', i + 1); j >= 0; j = lower.indexOf('yüzde', j + 1)) {
      must(!(j >= 5 && lower.slice(j - 5, j) === 'şarj '), `${a}: الذكر الثاني لـ«yüzde» يبقى «yüzde» بلا «şarj» (تأكيد المستخدم ${TURKISH_APPROVAL_DATE})`);
    }
  }
  // «ısı» ⇐ «ısınma» في مقدّمة overall وفي مثال overall.excellent، لا «ısı»؛ و«ısı» باقية حيث لم يسمِّها المستخدم
  must((trOf('overall.intro') || '').includes(OVERALL_INTRO_TR_ISINMA), `overall.intro تركيتها تحمل «${OVERALL_INTRO_TR_ISINMA}» (قرار المستخدم ${TURKISH_APPROVAL_DATE}: «ısınma» لا «ısı»)`);
  must(!turkishTokens(trOf('overall.intro') || '').includes('ısı'), 'overall.intro: «ısı» عادت (يجب «ısınma»)');
  must((trOf('overall.excellent') || '').endsWith(OVERALL_EXCELLENT_TR_EXAMPLE), `overall.excellent مثالها التركي «${OVERALL_EXCELLENT_TR_EXAMPLE}» (قرار المستخدم ${TURKISH_APPROVAL_DATE})`);
  must(!turkishTokens(trOf('overall.excellent') || '').includes('ısı'), 'overall.excellent: «ısı» عادت (يجب «ısınma»)');
  for (const a of ISI_UNTOUCHED_ANCHORS) must(turkishTokens(trOf(a) || '').includes('ısı'), `${a}: «ısı» باقية (نصّ المستخدم يسمّي overall.intro ومثال overall.excellent وحدهما؛ لا تُمسّ في غيرهما)`);
  must((trOf('battery.health_thresholds') || '').includes('«Zayıf/Weak»'), 'battery.health_thresholds: «Zayıf/Weak» تبقى بالكلمتين');
  must((trOf('battery.health_thresholds') || '').includes('«Kötü/Bad»'), 'battery.health_thresholds: «Kötü/Bad» تبقى بالكلمتين');
  must((trOf('thermal.good') || '').endsWith(`**Örnek:** ${THERMAL_GOOD_TR_EXAMPLE}`), `thermal.good مثالها التركي نصّ المستخدم بحرفه «${THERMAL_GOOD_TR_EXAMPLE}»`);
  must(L['thermal.good'] !== undefined && L['thermal.good'].ar.endsWith(`**مثال:** ${THERMAL_GOOD_AR_NEW}`), `thermal.good عربيتها تنتهي بمثالها الجديد «${THERMAL_GOOD_AR_NEW}»`);
  must(L['thermal.good'] !== undefined && !L['thermal.good'].ar.includes(THERMAL_GOOD_AR_OLD), 'thermal.good عربيتها لا تحمل مثالها القديم (ولا تريد أن تتركه)');
  must((trOf('thermal.weak') || '').endsWith(`**Örnek:** ${THERMAL_WEAK_TR_EXAMPLE}`), `thermal.weak مثالها التركي «${THERMAL_WEAK_TR_EXAMPLE}»`);
  must(!(trOf('thermal.weak') || '').includes('Telefon ısındı'), 'thermal.weak مثالها لا يقتبس نصّ النظام «Telefon ısındı»');
  must(L['thermal.weak'] !== undefined && L['thermal.weak'].ar.includes(THERMAL_WEAK_AR_EXAMPLE_KEPT), 'thermal.weak عربيتها باقية بمثالها «الهاتف ساخن»');
  must((trOf('overall.excellent') || '').startsWith(OVERALL_EXCELLENT_TR_HEAD), `overall.excellent تركيتها تبدأ بـ«${OVERALL_EXCELLENT_TR_HEAD}»`);
  must(!(trOf('overall.excellent') || '').includes('İçeriden'), 'overall.excellent لا تحمل «İçeriden» القديمة');
  for (const [k, want] of Object.entries(SYMPTOM_TR_USER_TEXT)) must(S[k] !== undefined && S[k].tr === want, `عَرَض «${k}» نصّه نصّ المستخدم بحرفه «${want}»`);
  const all = Object.entries(L).map(([a, v]) => [a, v.tr]).concat(Object.entries(S).map(([k, v]) => [`symptom:${k}`, v.tr]));
  for (const [id, text] of all) {
    for (const [re, label] of TURKISH_FORBIDDEN) must(!re.test(text), `${id}: «${label}» عادت (سقطت بقرار المستخدم ${TURKISH_APPROVAL_DATE})`);
    for (const t of turkishTokens(text)) must(!SEN_TOKENS.includes(t), `${id}: رمز صيغة المفرد «${t}» (siz في كل النصوص)`);
  }
  for (const [a, toks] of Object.entries(SIZ_MARKERS)) {
    const have = new Set(turkishTokens(trOf(a) || ''));
    for (const t of toks) must(have.has(t), `${a}: رمز siz «${t}» غائب (siz في كل النصوص)`);
  }
}

/** وسوم التعليقات في الوحدة: «// <وسم> <مصدر>» على سطر المفتاح (داخل Object.freeze) أو الثابت المفرد. يعيد {مفتاح: {prov, src}} ومعه قائمة مفاتيح بلا وسم. */
function moduleTags(moduleSource) {
  const tags = {};
  const untagged = [];
  let group = null;
  for (const line of moduleSource.split('\n')) {
    const g = line.match(/^const ([A-Z_0-9]+) = Object\.freeze\(\{\s*$/);
    if (g) { group = g[1]; continue; }
    if (group !== null && /^\}\);\s*$/.test(line)) { group = null; continue; }
    const tag = line.match(/\/\/ (design|proposal|decided) (\S+)/);
    if (group !== null) {
      const e = line.match(/^\s+([A-Z_0-9]+):\s/);
      if (!e) continue;
      if (tag) tags[`${group}.${e[1]}`] = {prov: tag[1], src: tag[2]};
      else untagged.push(`${group}.${e[1]}`);
    } else {
      const s = line.match(/^const ([A-Z_0-9]+) = [^;]+;\s*(.*)$/);
      if (!s) continue;
      const t = s[2].match(/^\/\/ (design|proposal|decided) (\S+)/);
      if (t) tags[s[1]] = {prov: t[1], src: t[2]}; // ثابت بلا وسم يُكتشف من جهة الوثيقة (الثابت المفرد في جدول §٨-ب بلا وسم في الوحدة)
    }
  }
  return {tags, untagged};
}

function extractBlock(doc, name, fails) {
  const found = [...doc.matchAll(new RegExp(`<!-- ${name}:BEGIN -->\\n([\\s\\S]*?)<!-- ${name}:END -->`, 'g'))];
  if (found.length !== 1) {
    fails.push(`doc: الكتلة ${name} ظهرت ${found.length} مرّة (المطلوب مرّة واحدة)`);
    return null;
  }
  return found[0][1];
}

function tableRows(text, nCols, label, fails) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (lines.length < 2 || !/^\|[\s|:-]+\|$/.test(lines[1])) {
    fails.push(`doc: ${label}: لا ترويسة وفاصل جدول`);
    return [];
  }
  const rows = [];
  for (const l of lines.slice(2)) {
    const cells = l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length !== nCols) {
      fails.push(`doc: ${label}: صفّ بـ${cells.length} خانة (المطلوب ${nCols}): ${l.slice(0, 80)}`);
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

/** يقسّم تصديرات الوحدة إلى ثوابت مفردة ومجموعات، ويُعلن ما ليس ثابتاً (دالّة، مصفوفة، كائن غير مجمَّد، قيمة ليست نصّاً). */
function classifyExports(vocab, fails) {
  const scalars = {};
  const groups = {};
  for (const [name, v] of Object.entries(vocab)) {
    if (typeof v === 'string' || (typeof v === 'number' && Number.isInteger(v))) {
      scalars[name] = v;
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (!Object.isFrozen(v)) fails.push(`module: ${name} كائن غير مجمَّد`);
      if (Object.keys(v).length === 0) fails.push(`module: ${name} مجموعة فارغة`);
      for (const [k, val] of Object.entries(v)) {
        if (typeof val !== 'string' || val === '' || /\s/.test(val)) fails.push(`module: ${name}.${k} ليست نصّاً غير فارغ بلا فراغ`);
      }
      if (new Set(Object.values(v)).size !== Object.values(v).length) fails.push(`module: ${name} قيمتان متطابقتان في مجموعة واحدة`);
      groups[name] = {...v};
    } else {
      fails.push(`module: ${name} ليس ثابتاً (النوع ${Array.isArray(v) ? 'array' : typeof v})`);
    }
  }
  return {scalars, groups};
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * @param {Object} p
 * @param {string} p.doc نصّ docs/PROTOCOL_CONTRACT.md
 * @param {Object} p.vocab ما تصدّره الوحدة
 * @param {string} p.moduleSource نصّ الوحدة
 * @param {Object<string, string>} p.srcFiles مسار نسبي (من functions/) ⟵ نصّ، لكل ملفّ في src ومعه index.js
 * @param {Object} p.sessionNames sessions/sessionNames.js
 * @param {Object} p.code {VALID_RATINGS, VALID_VISIBLE_DEFECTS, UNUSABLE_REASON}
 * @return {{fails: string[], stats: Object}}
 */
function verify({doc, vocab, moduleSource, srcFiles, sessionNames, code}) {
  const fails = [];
  const stats = {docGroups: 0, docEntries: 0, docScalars: 0, design: 0, proposal: 0, decided: 0, proposalNames: [], moduleTagged: 0, symptomRows: 0, levelRows: 0, levelCells: 0, levelApproved: 0, symptomBlockApproved: 0, turkishApprovals: 0, section7Rows: 0};
  const {scalars: modScalars, groups: modGroups} = classifyExports(vocab, fails);

  // ─── ١ الجدولان في الاتجاهين ───
  const gText = extractBlock(doc, 'VOCAB-GROUPS', fails);
  const docGroups = {};
  const docMeta = [];
  if (gText !== null) {
    for (const [g, k, v, prov, src] of tableRows(gText, 5, 'VOCAB-GROUPS', fails)) {
      const [G, K, VAL] = [unq(g), unq(k), unq(v)];
      docGroups[G] = docGroups[G] || {};
      if (Object.prototype.hasOwnProperty.call(docGroups[G], K)) fails.push(`doc: ${G}.${K} مكرَّر`);
      docGroups[G][K] = VAL;
      docMeta.push({G, K, prov, src});
    }
  }
  stats.docGroups = Object.keys(docGroups).length;
  stats.docEntries = docMeta.length;
  for (const g of Object.keys(docGroups)) if (!modGroups[g]) fails.push(`doc→module: المجموعة ${g} في الوثيقة ولا تصدّرها الوحدة`);
  for (const g of Object.keys(modGroups)) {
    if (!docGroups[g]) { fails.push(`module→doc: المجموعة ${g} تصدّرها الوحدة وليست في الوثيقة`); continue; }
    for (const k of Object.keys(docGroups[g])) if (!(k in modGroups[g])) fails.push(`doc→module: ${g}.${k} في الوثيقة ولا تصدّره الوحدة`);
    for (const k of Object.keys(modGroups[g])) {
      if (!(k in docGroups[g])) fails.push(`module→doc: ${g}.${k} تصدّره الوحدة وليس في الوثيقة`);
      else if (docGroups[g][k] !== modGroups[g][k]) fails.push(`قيمة ${g}.${k} تختلف: الوثيقة «${docGroups[g][k]}» والوحدة «${modGroups[g][k]}»`);
    }
  }

  const sText = extractBlock(doc, 'VOCAB-SCALARS', fails);
  const docScalars = {};
  const scalarMeta = [];
  if (sText !== null) {
    for (const [name, value, type, prov, src] of tableRows(sText, 5, 'VOCAB-SCALARS', fails)) {
      const NAME = unq(name);
      if (type !== 'number' && type !== 'string') fails.push(`doc: ${NAME} نوعه «${type}» (number أو string)`);
      if (Object.prototype.hasOwnProperty.call(docScalars, NAME)) fails.push(`doc: الثابت ${NAME} مكرَّر`);
      docScalars[NAME] = type === 'number' ? Number(unq(value)) : unq(value);
      scalarMeta.push({NAME, prov, src, type});
    }
  }
  stats.docScalars = scalarMeta.length;
  for (const name of Object.keys(docScalars)) if (!(name in modScalars)) fails.push(`doc→module: الثابت ${name} في الوثيقة ولا تصدّره الوحدة`);
  for (const name of Object.keys(modScalars)) {
    if (!(name in docScalars)) { fails.push(`module→doc: الثابت ${name} تصدّره الوحدة وليس في الوثيقة`); continue; }
    if (docScalars[name] !== modScalars[name]) fails.push(`قيمة الثابت ${name} تختلف: الوثيقة ${JSON.stringify(docScalars[name])} والوحدة ${JSON.stringify(modScalars[name])}`);
    const meta = scalarMeta.find((m) => m.NAME === name);
    if (meta && meta.type !== typeof modScalars[name]) fails.push(`نوع الثابت ${name}: الوثيقة ${meta.type} والوحدة ${typeof modScalars[name]}`);
  }
  for (const name of Object.keys(modScalars)) if (name in modGroups) fails.push(`module: ${name} ثابت ومجموعة معاً`);

  // ─── ٢ الوحدة ثوابت وحدها ───
  const code0 = stripComments(moduleSource);
  if (!/^\s*"use strict";/.test(moduleSource)) fails.push('module: لا "use strict" في أوّل الملفّ');
  for (const [re, label] of [[/\brequire\s*\(/, 'require'], [/\bimport\b/, 'import'], [/=>/, 'دالّة سهمية'], [/\bfunction\b/, 'function'], [/\bclass\b/, 'class'],
    [/\basync\b/, 'async'], [/\bawait\b/, 'await'], [/\bprocess\b/, 'process'], [/\bconsole\b/, 'console'], [/\bnew\b/, 'new'], [/\bfetch\b/, 'fetch']]) {
    if (re.test(code0)) fails.push(`module: الشيفرة (بلا تعليقات) تحمل ${label} — الوحدة ثوابت مُصدَّرة وحدها`);
  }

  // ─── ٣ الوسوم ───
  const resolvedMatch = doc.match(/^### ٧-أ[^\n]*\n([\s\S]*?)^### ٧-ب/m);
  if (!resolvedMatch) fails.push('doc: لا قسم §٧-أ قبل §٧-ب');
  const resolvedSection = resolvedMatch ? resolvedMatch[1] : '';
  const allMeta = docMeta.map((m) => ({where: `${m.G}.${m.K}`, prov: m.prov, src: m.src}))
      .concat(scalarMeta.map((m) => ({where: m.NAME, prov: m.prov, src: m.src})));
  for (const m of allMeta) {
    if (!PROV.has(m.prov)) { fails.push(`doc: ${m.where} وسمه «${m.prov}» (design أو proposal أو decided)`); continue; }
    stats[m.prov]++;
    if (m.prov === 'proposal') stats.proposalNames.push(m.where);
    if (m.prov === 'design' && !DESIGN_SRC.test(m.src)) fails.push(`doc: ${m.where} من التصميم ومصدره «${m.src}» ليس P:<سطر> أو TL:<سطر>`);
    if (m.prov === 'proposal') {
      if (!PROPOSAL_SRC.test(m.src)) fails.push(`doc: ${m.where} مقترح ومرجعه «${m.src}» ليس E<n> أو A<n>`);
      else if (m.src.startsWith('E') && !new RegExp(`^\\| ${m.src} \\|`, 'm').test(doc)) fails.push(`doc: ${m.where} يحيل إلى ${m.src} ولا صفّ له في §٧`);
      else if (m.src.startsWith('E') && new RegExp(`^\\| ${m.src} \\|`, 'm').test(resolvedSection)) fails.push(`doc: ${m.where} مقترح ومرجعه ${m.src} وله صفّ محسوم في §٧-أ: يجب أن يكون decided`);
      else if (m.src.startsWith('A') && !new RegExp(`^### ${m.src} —`, 'm').test(doc)) fails.push(`doc: ${m.where} يحيل إلى ${m.src} ولا قسم له في §٢`);
    }
    if (m.prov === 'decided') {
      if (!DECIDED_SRC.test(m.src)) fails.push(`doc: ${m.where} محسوم ومرجعه «${m.src}» ليس E<n>`);
      else if (!new RegExp(`^\\| ${m.src} \\|`, 'm').test(resolvedSection)) fails.push(`doc: ${m.where} محسوم ومرجعه ${m.src} ولا صفّ له في §٧-أ`);
    }
  }

  // ─── ٣-ب وسوم التعليقات في الوحدة تساوي وسوم الجدولين (الاتجاهان) ───
  const {tags: modTags, untagged: modUntagged} = moduleTags(moduleSource);
  stats.moduleTagged = Object.keys(modTags).length;
  for (const k of modUntagged) fails.push(`tags: module ${k} بلا وسم في التعليق على سطره (// design|proposal|decided <مصدر>)`);
  for (const m of allMeta) {
    const t = modTags[m.where];
    if (!t) { if (!modUntagged.includes(m.where)) fails.push(`tags: ${m.where} في الوثيقة ولا وسم له في تعليق الوحدة`); continue; }
    if (t.prov !== m.prov || t.src !== m.src) fails.push(`tags: ${m.where} وسمه في الوثيقة «${m.prov} ${m.src}» وفي تعليق الوحدة «${t.prov} ${t.src}»`);
  }
  const docWheres = new Set(allMeta.map((m) => m.where));
  for (const k of Object.keys(modTags)) if (!docWheres.has(k)) fails.push(`tags: ${k} وسمه في تعليق الوحدة ولا صفّ له في جدولَي §٨`);

  // ─── ٣-ج صفوف §٧ الستّة والعشرون ───
  const outsideResolved = resolvedMatch ? doc.replace(resolvedSection, '') : doc;
  const section7Ids = [...SECTION7_USER_DECISIONS, ...SECTION7_COORDINATOR_DECISIONS];
  if (section7Ids.length !== 26 || new Set(section7Ids).size !== 26) fails.push(`test: قائمة صفوف §٧ ${section7Ids.length} (المطلوب 26 فريدة)`);
  for (const id of section7Ids) {
    const rowRe = new RegExp(`^\\| ${id} \\|(.*)$`, 'm');
    const found = resolvedSection.match(rowRe);
    if (!found) { fails.push(`section7: ${id} لا صفّ له في §٧-أ`); continue; }
    stats.section7Rows++;
    const text = found[1];
    const modified = SECTION7_MODIFIED.includes(id);
    const want = modified ? LABEL_APPROVED_MODIFIED : LABEL_APPROVED;
    const other = modified ? LABEL_APPROVED : LABEL_APPROVED_MODIFIED;
    if (!text.includes(`${want} (`)) fails.push(`section7: ${id} حالته ليست «${want}»`);
    if (text.includes(`${other} (`)) fails.push(`section7: ${id} يحمل «${other}» وهو غير المطلوب له`);
    const by = SECTION7_USER_DECISIONS.includes(id) ? BY_USER : BY_COORDINATOR;
    if (!text.includes(`${want} (${by})`)) fails.push(`section7: ${id} الجهة الحاسمة ليست «${by}» (نصّ الإذن أو القرار في صفّه)`);
    if (new RegExp(`^\\| ${id} \\|`, 'm').test(outsideResolved)) fails.push(`section7: ${id} له صفّ ثانٍ خارج §٧-أ`);
  }
  // E44 (قرار المستخدم 2026-10-16، منقول عن أمر الباك اند: «E44: (أ) يُخفى العرض بسبب «not eligible» جديد، في أمر P6-07.»): «معتمد (أ)» في §٧-أ؛ واسم السبب الجديد نُفِّذ في أمر S-P6-07 (2026-10-21) بوسم proposal A4
  {
    const e44 = resolvedSection.match(/^\| E44 \|(.*)$/m);
    if (!e44) {
      fails.push('section7: E44 لا صفّ له في §٧-أ (قرار المستخدم 2026-10-16)');
    } else {
      if (!e44[1].includes(`${LABEL_E44} (${BY_USER})`)) fails.push(`section7: E44 حالته ليست «${LABEL_E44}» بقرار المستخدم`);
      if (!e44[1].includes(E44_EXECUTED)) fails.push(`section7: E44 لا يقول «${E44_EXECUTED}» (اسم السبب الجديد نفّذه أمر P6-07)`);
      if (!e44[1].includes(E44_REASON_NAME)) fails.push(`section7: E44 لا يسمّي السبب الجديد ${E44_REASON_NAME}`);
    }
    if (/^\| E44 \|/m.test(outsideResolved)) fails.push('section7: E44 له صفّ ثانٍ خارج §٧-أ');
  }

  // ─── ٤ علاقات ───
  const vals = (g) => (modGroups[g] ? Object.values(modGroups[g]) : []);
  const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  if (!vals('SETTABLE_SESSION_PURPOSE').every((x) => vals('SCAN_PURPOSE').includes(x))) fails.push('module: SETTABLE_SESSION_PURPOSE ليست جزءاً من SCAN_PURPOSE');
  if (!setEq(vals('GRADE_OPTION'), vals('GRADE_LEVEL').concat(['not_tested']))) fails.push('module: GRADE_OPTION ≠ GRADE_LEVEL + not_tested');
  if (modGroups.REPEAT_NOT_ELIGIBLE_REASON && modGroups.PROTOCOL_ABSENCE_STATE &&
      modGroups.REPEAT_NOT_ELIGIBLE_REASON.SETTINGS_ABSENT !== modGroups.PROTOCOL_ABSENCE_STATE.SETTINGS_ABSENT) {
    fails.push('module: SETTINGS_ABSENT بقيمتين مختلفتين');
  }
  if (modScalars.SYMPTOM_NONE_NOTICED !== 'none_noticed') fails.push('module: SYMPTOM_NONE_NOTICED ≠ none_noticed');
  if (!setEq(vals('GRADE_OPTION'), code.VALID_RATINGS)) fails.push('code: GRADE_OPTION ≠ VALID_RATINGS (evaluationContract.js:44)');
  if (!vals('VISIBLE_DEFECT').every((x) => code.VALID_VISIBLE_DEFECTS.includes(x))) fails.push('code: VISIBLE_DEFECT خارج VALID_VISIBLE_DEFECTS (evaluationContract.js:49-52)');
  if (!code.VALID_VISIBLE_DEFECTS.includes(modScalars.SYMPTOM_NONE_NOTICED)) fails.push('code: none_noticed ليست في VALID_VISIBLE_DEFECTS');
  if (!modGroups.IDENTITY_STATE || modGroups.IDENTITY_STATE.KEY_ABSENT !== code.UNUSABLE_REASON.KEY_ABSENT) {
    fails.push('code: IDENTITY_STATE.KEY_ABSENT ≠ UNUSABLE_REASON.KEY_ABSENT (deviceProfileKey.js:67، مصدره هناك)');
  }

  // ─── ٤-ب الأعراض (E37): الوحدة، ثم جدول §٥-ج ───
  const SYMPTOM_USER_EDITED_TURKISH = 'charging_slow'; // #5: «Şarj yavaş oluyor» بتعديل المستخدم (P:1270 في المنقول)
  const symMod = modGroups.SYMPTOM;
  if (!symMod) {
    fails.push('module: SYMPTOM غائبة');
  } else {
    const symVals = Object.values(symMod);
    if (symVals.length !== 13) fails.push(`module: SYMPTOM ${symVals.length} مفتاحاً (المطلوب 13: اثنا عشر ومعها none_noticed)`);
    if (symMod.NONE_NOTICED !== modScalars.SYMPTOM_NONE_NOTICED) fails.push('module: SYMPTOM.NONE_NOTICED ≠ SYMPTOM_NONE_NOTICED (مصدر واحد)');
    if (symVals.filter((x) => x === modScalars.SYMPTOM_NONE_NOTICED).length !== 1) fails.push('module: SYMPTOM لا تحمل none_noticed مرّة واحدة بالضبط');
    if (symVals.filter((x) => code.VALID_VISIBLE_DEFECTS.includes(x) && x !== modScalars.SYMPTOM_NONE_NOTICED).length > 0) fails.push('code: مفتاح عَرَض (غير none_noticed) داخل VALID_VISIBLE_DEFECTS');
  }
  const symText = extractBlock(doc, 'SYMPTOM-TEXT', fails);
  const symApprovedTurkish = []; // نصوص الخانات التركية الموسومة «✓» (للمطابقة بسجلّ §٥-د)
  const symByKey = {}; // {مفتاح: {tr}} لقرارات 2026-10-16
  if (symText !== null) {
    const symRows = tableRows(symText, 4, 'SYMPTOM-TEXT', fails);
    stats.symptomRows = symRows.length;
    const symVals = symMod ? Object.values(symMod) : [];
    if (symRows.length !== symVals.length) fails.push(`doc: SYMPTOM-TEXT ${symRows.length} صفّاً والوحدة ${symVals.length}`);
    symRows.forEach(([num, key, ar, tr], i) => {
      const K = unq(key);
      const isNone = K === modScalars.SYMPTOM_NONE_NOTICED;
      if (symVals[i] !== undefined && K !== symVals[i]) fails.push(`doc: SYMPTOM-TEXT الصفّ ${i + 1} مفتاحه «${K}» والوحدة «${symVals[i]}» (القيمة أو الترتيب)`);
      if (num !== (isNone ? '—' : String(i + 1))) fails.push(`doc: SYMPTOM-TEXT الصفّ ${i + 1} رقمه «${num}»`);
      if (ar === '' || tr === '') fails.push(`doc: SYMPTOM-TEXT «${K}» بلا عربية أو بلا تركية`);
      if (tr.includes('✓')) symApprovedTurkish.push(tr.replace(/\*\*/g, '').replace(/\s*\(✓[^)]*\)/, '').trim());
      symByKey[K] = {tr};
      if (K === SYMPTOM_USER_EDITED_TURKISH) {
        if (!tr.includes('✓') || tr.includes('(öneri)')) fails.push(`doc: SYMPTOM-TEXT «${K}» تركيّته بتعديل المستخدم: يجب «✓» وبلا «(öneri)»`);
      } else if (tr.includes('(öneri)')) {
        fails.push(`doc: SYMPTOM-TEXT «${K}» تركيّته معتمدة ${TURKISH_APPROVAL_DATE}: لا «(öneri)» (E28)`);
      } else if (tr.includes('✓')) {
        fails.push(`doc: SYMPTOM-TEXT «${K}» «✓» لـ#5 وحده (صفّه الأوّل في سجلّ §٥-د)؛ والباقية اعتمادها بصفّ الكتلة لا بالوسم`);
      } else {
        stats.symptomBlockApproved++;
      }
    });
  }

  // ─── ٤-ج المستويات (E38): جدول §٥-ب ───
  const LEVEL_WORD_AR = {excellent: 'ممتاز', good: 'جيد', fair: 'متوسط', weak: 'ضعيف'}; // TL:13-64 (معتمدة اعتماداً أخيراً: TL:3)
  const LEVEL_WORD_TR = {excellent: 'Mükemmel', good: 'İyi', fair: 'Orta', weak: 'Zayıf'}; // اقتراح الوكيل، اعتمده المستخدم 2026-10-16
  const STATUS_DEFERRED_P608 = 'يُحسم في P6-08'; // جواب المنسّق 2026-10-15: هل تُعرضان يُحسم مع نصّ تنبيه التناقض في أمر P6-08؛ بلا تركية الآن
  const DEFERRED_ANCHORS = ['battery.note', 'thermal.review_note'];
  const THRESHOLDS_LABEL = '[اجتهاد، يُراجَع في يوم التجربة]'; // TL:19
  const lvlCats = vals('TECHNICIAN_GRADE_CATEGORY');
  const lvlLevels = vals('GRADE_LEVEL');
  if (lvlCats.length !== 4 || lvlLevels.length !== 4) fails.push(`module: الفئات ${lvlCats.length} والمستويات ${lvlLevels.length} (المطلوب 4 و4)`);
  const lvlText = extractBlock(doc, 'LEVEL-TEXT', fails);
  const lvlByAnchor = {}; // {موضع: {word, ar, tr, status}} لقرارات 2026-10-16
  if (lvlText !== null) {
    const lvlRows = tableRows(lvlText, 5, 'LEVEL-TEXT', fails);
    stats.levelRows = lvlRows.length;
    for (const [anchorCell, word, ar, tr, status] of lvlRows) lvlByAnchor[unq(anchorCell)] = {word, ar, tr, status};
    const notTested = modGroups.GRADE_OPTION ? modGroups.GRADE_OPTION.NOT_TESTED : undefined;
    const contradictionKey = modGroups.FORM_CONTRADICTION_RULE ? modGroups.FORM_CONTRADICTION_RULE.OVERALL_HIGH_WITH_WEAK_CATEGORY : undefined;
    const known = [
      ...lvlCats.map((c) => `category.${c}`),
      ...lvlCats.flatMap((c) => lvlLevels.map((l) => `${c}.${l}`)),
      `option.${notTested}`, 'rule.1', 'rule.2', 'rule.3', 'battery.health_thresholds', 'performance.intro', 'thermal.intro_1', 'thermal.intro_2', 'overall.intro',
      contradictionKey, ...DEFERRED_ANCHORS,
    ];
    const anchors = lvlRows.map((r) => unq(r[0]));
    for (const a of known) if (!anchors.includes(a)) fails.push(`doc: LEVEL-TEXT لا صفّ للموضع «${a}»`);
    for (const a of anchors) {
      if (!known.includes(a)) fails.push(`doc: LEVEL-TEXT موضع غير معروف «${a}»`);
      if (anchors.indexOf(a) !== anchors.lastIndexOf(a)) fails.push(`doc: LEVEL-TEXT موضع مكرَّر «${a}»`);
    }
    for (const [anchorCell, word, ar, tr, status] of lvlRows) {
      const A = unq(anchorCell);
      if (ar === '') fails.push(`doc: LEVEL-TEXT «${A}» بلا عربية`);
      if (DEFERRED_ANCHORS.includes(A)) {
        if (status !== STATUS_DEFERRED_P608 || tr !== '—') fails.push(`doc: LEVEL-TEXT «${A}» وسمه «${STATUS_DEFERRED_P608}» وتركيتها «—»`);
      } else if (status !== STATUS_TURKISH_APPROVED || tr === '' || tr === '—') {
        fails.push(`doc: LEVEL-TEXT «${A}» تركيتها معتمدة: حالتها «${STATUS_TURKISH_APPROVED}» وتركية غير فارغة (E28؛ اعتمدها المستخدم ${TURKISH_APPROVAL_DATE}: لا «مقترح» ولا تاريخ آخر)`);
      } else {
        stats.levelApproved++;
      }
      const [head, tail, ...rest] = A.split('.');
      const level = rest.length === 0 && lvlCats.includes(head) && lvlLevels.includes(tail) ? tail : null;
      if (level) {
        stats.levelCells++;
        if (word !== `**${LEVEL_WORD_AR[level]}**`) fails.push(`doc: LEVEL-TEXT «${A}» كلمته «${word}» والمعتمد «**${LEVEL_WORD_AR[level]}**»`);
        if (!tr.startsWith(`**${LEVEL_WORD_TR[level]}** — `)) fails.push(`doc: LEVEL-TEXT «${A}» تركيتها لا تبدأ بـ«**${LEVEL_WORD_TR[level]}** — »`);
      } else if (word !== '—') {
        fails.push(`doc: LEVEL-TEXT «${A}» ليس مستوى فكلمته «—» لا «${word}»`);
      }
      if (A === 'battery.health_thresholds' && !ar.includes(THRESHOLDS_LABEL)) fails.push(`doc: LEVEL-TEXT عتبات البطارية بلا وسم ${THRESHOLDS_LABEL} (TL:19)`);
    }
  }

  // ─── ٤-د سجلّ اعتماد التركية (E28): §٥-د ───
  const taText = extractBlock(doc, 'TURKISH-APPROVALS', fails);
  if (taText !== null) {
    const taRows = tableRows(taText, 6, 'TURKISH-APPROVALS', fails);
    stats.turkishApprovals = taRows.length;
    const blocksNamed = new Set(); // الكتل التي يسمّيها صفّ كتلة (خانته الثانية تحمل اسم الكتلة بين علامتَي `)
    for (const [n, tr, where, date, text, src] of taRows) {
      if (tr === '' || where === '' || text === '' || src === '') fails.push(`doc: TURKISH-APPROVALS الصفّ ${n} بخانة فارغة`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) && date !== NO_DATE_IN_SOURCE) fails.push(`doc: TURKISH-APPROVALS الصفّ ${n} تاريخه «${date}» (YYYY-MM-DD أو «${NO_DATE_IN_SOURCE}» صريحاً: القاعدة 22)`);
      const named = TURKISH_BLOCKS.filter((b) => tr.includes(`\`${b}\``));
      if (named.length > 0) {
        // صفّ كتلة: نصّه بحرفه في الكتلة المسمّاة لا هنا (القاعدة 28)، فيُثبَّت تاريخه ونصّ المستخدم الأخير
        if (date !== TURKISH_APPROVAL_DATE) fails.push(`doc: TURKISH-APPROVALS الصفّ ${n} (صفّ كتلة) تاريخه «${date}» والمطلوب «${TURKISH_APPROVAL_DATE}» (نصّ المستخدم)`);
        if (!text.includes(USER_REVIEW_SENTENCE)) fails.push(`doc: TURKISH-APPROVALS الصفّ ${n} (صفّ كتلة) بلا نصّ المستخدم الأخير بحرفه في خانة الاعتماد`);
        for (const b of named) blocksNamed.add(b);
      } else if (tr !== '' && doc.split(tr).length - 1 < 2) {
        fails.push(`doc: TURKISH-APPROVALS الصفّ ${n} نصّه «${tr}» لا يظهر في موضعه من الوثيقة (حرفاً بحرف)`);
      }
    }
    for (const core of symApprovedTurkish) {
      if (!taRows.some((r) => r[1] === core)) fails.push(`doc: خانة تركية موسومة «✓» في §٥-ج («${core}») بلا صفّ في سجلّ §٥-د (E28: لا تركية معتمدة بلا سجلّ)`);
    }
    if (stats.levelApproved > 0 && !blocksNamed.has('LEVEL-TEXT')) fails.push('doc: خانات تركية معتمدة في LEVEL-TEXT بلا صفّ كتلة في سجلّ §٥-د (E28: لا تركية معتمدة بلا سجلّ)');
    if (stats.symptomBlockApproved > 0 && !blocksNamed.has('SYMPTOM-TEXT')) fails.push('doc: خانات تركية معتمدة في SYMPTOM-TEXT بلا صفّ كتلة في سجلّ §٥-د (E28: لا تركية معتمدة بلا سجلّ)');
    // صفّ تعديل thermal.good: تعديل المستخدم على عربية معتمدة (قديمها وجديدها) وتركية مثالها
    const editRow = taRows.find((r) => r[2].includes('`thermal.good`'));
    if (!editRow) {
      fails.push(`doc: TURKISH-APPROVALS لا صفّ لتعديل thermal.good العربي (${TURKISH_APPROVAL_DATE})`);
    } else {
      if (editRow[3] !== TURKISH_APPROVAL_DATE) fails.push(`doc: TURKISH-APPROVALS الصفّ ${editRow[0]} (تعديل thermal.good) تاريخه «${editRow[3]}» والمطلوب «${TURKISH_APPROVAL_DATE}»`);
      if (editRow[1] !== THERMAL_GOOD_TR_EXAMPLE) fails.push(`doc: TURKISH-APPROVALS الصفّ ${editRow[0]} (تعديل thermal.good) خانته الثانية ليست تركية المثال «${THERMAL_GOOD_TR_EXAMPLE}»`);
      if (!editRow[4].includes(THERMAL_GOOD_AR_OLD) || !editRow[4].includes(THERMAL_GOOD_AR_NEW)) fails.push(`doc: TURKISH-APPROVALS الصفّ ${editRow[0]} (تعديل thermal.good) خانة اعتماده بلا العربية القديمة أو الجديدة`);
    }
    // صفّ «ısınma» (2026-10-16): تعديل المستخدم في overall.intro ومثال overall.excellent، مع تأكيد قراءة «şarj yüzdesi»؛ نصّا المستخدم بحرفهما في خانة اعتماده
    const isiRow = taRows.find((r) => r[2].includes('`overall.intro`') && r[2].includes('`overall.excellent`'));
    if (!isiRow) {
      fails.push(`doc: TURKISH-APPROVALS لا صفّ لتعديل «ısınma» (${TURKISH_APPROVAL_DATE}: overall.intro ومثال overall.excellent)`);
    } else {
      if (isiRow[3] !== TURKISH_APPROVAL_DATE) fails.push(`doc: TURKISH-APPROVALS الصفّ ${isiRow[0]} (ısınma) تاريخه «${isiRow[3]}» والمطلوب «${TURKISH_APPROVAL_DATE}»`);
      if (isiRow[1] !== ISINMA_REGISTER_TR) fails.push(`doc: TURKISH-APPROVALS الصفّ ${isiRow[0]} (ısınma) خانته الثانية ليست «${ISINMA_REGISTER_TR}»`);
      if (!isiRow[4].includes(ISINMA_USER_TEXT)) fails.push(`doc: TURKISH-APPROVALS الصفّ ${isiRow[0]} (ısınma) خانة اعتماده بلا نصّ المستخدم في «ısı» بحرفه`);
      if (!isiRow[4].includes(CHARGE_PERCENT_USER_TEXT)) fails.push(`doc: TURKISH-APPROVALS الصفّ ${isiRow[0]} (ısınma) خانة اعتماده بلا نصّ المستخدم في «şarj yüzdesi» بحرفه`);
    }
  }

  // ─── ٤-هـ قرارات المستخدم 2026-10-16 على خانات التركية، بنصّها ───
  if (lvlText !== null && symText !== null) checkTurkishDecisions(lvlByAnchor, symByKey, fails);

  // ─── ٥ ما أُسقط، وعدم تكرار مفردات الجلسة ───
  const dText = extractBlock(doc, 'VOCAB-DROPPED', fails);
  const docDropped = dText === null ? [] : tableRows(dText, 3, 'VOCAB-DROPPED', fails).map((r) => unq(r[0]));
  for (const d of MUST_STAY_OUT) if (!docDropped.includes(d)) fails.push(`doc: ${d} غير مذكور في §٨-ج (لا يُصدَّر)`);
  const allValues = Object.values(modGroups).flatMap((g) => Object.values(g)).concat(Object.values(modScalars).filter((x) => typeof x === 'string'));
  const allKeys = Object.keys(modGroups).concat(Object.keys(modScalars)).concat(Object.values(modGroups).flatMap((g) => Object.keys(g)));
  for (const d of docDropped.concat(MUST_STAY_OUT)) {
    if (allValues.includes(d)) fails.push(`module: القيمة المُسقَطة «${d}» مُصدَّرة`);
    if (allKeys.some((k) => k.toLowerCase() === d.toLowerCase())) fails.push(`module: اسم مُسقَط «${d}» مُصدَّر مفتاحاً`);
  }
  const sessionValues = new Set([
    ...Object.values(sessionNames.SESSION_STATUS), ...Object.values(sessionNames.CANCEL_REASON),
    ...Object.values(sessionNames.JOIN_REFUSAL), ...Object.values(sessionNames.CANCEL_REFUSAL), ...Object.values(sessionNames.SESSION_ROLE),
  ]);
  for (const [g, entries] of Object.entries(modGroups)) {
    for (const [k, val] of Object.entries(entries)) if (sessionValues.has(val)) fails.push(`module: ${g}.${k} = «${val}» نسخة من مفردات الجلسة (sessionNames.js مصدرها)`);
  }

  // ─── ٦ مفردات الجلسة في الوثيقة ───
  const vText = extractBlock(doc, 'SESSION-VOCAB', fails);
  if (vText !== null) {
    const rows = tableRows(vText, 4, 'SESSION-VOCAB', fails).map((r) => ({t: unq(r[0]), k: unq(r[1]), v: unq(r[2]), c: r[3]}));
    const want = {SESSION_STATUS: sessionNames.SESSION_STATUS, CANCEL_REASON: sessionNames.CANCEL_REASON};
    for (const [t, table] of Object.entries(want)) {
      const mine = rows.filter((r) => r.t === t);
      for (const [k, val] of Object.entries(table)) {
        const r = mine.find((x) => x.k === k);
        if (!r) { fails.push(`session: ${t}.${k} في sessionNames.js وليس في الوثيقة`); continue; }
        if (r.v !== val) fails.push(`session: قيمة ${t}.${k} «${r.v}» والمصدر «${val}»`);
        if (t === 'SESSION_STATUS') {
          const cls = sessionNames.ACTIVE_SESSION_STATUSES.includes(val) ? 'active' : (sessionNames.TERMINAL_SESSION_STATUSES.includes(val) ? 'terminal' : 'unknown');
          if (r.c !== cls) fails.push(`session: صنف ${t}.${k} «${r.c}» والمصدر «${cls}»`);
        } else if (r.c !== 'cancel_reason') {
          fails.push(`session: صنف ${t}.${k} «${r.c}» (cancel_reason)`);
        }
      }
      for (const r of mine) if (!(r.k in table)) fails.push(`session: ${t}.${r.k} في الوثيقة وليس في sessionNames.js`);
    }
    for (const r of rows) if (!(r.t in want)) fails.push(`session: جدول غير معروف «${r.t}»`);
  }

  // ─── ٧ حارس بنيوي: لا نصّ حرفي لاسم مجموعة خارج الوحدة ───
  const collections = modGroups.PROTOCOL_COLLECTION ? Object.values(modGroups.PROTOCOL_COLLECTION) : [];
  for (const [rel, text] of Object.entries(srcFiles)) {
    if (rel === MODULE_REL) continue;
    for (const c of collections) {
      if (new RegExp(`["'\`]${c}["'\`]`).test(text)) fails.push(`src: ${rel} يحمل اسم المجموعة «${c}» نصّاً حرفياً (القاعدة 24: يُستورد من protocolVocabulary.js)`);
    }
  }
  if (collections.length === 0) fails.push('module: PROTOCOL_COLLECTION غائبة أو فارغة — الحارس البنيوي بلا ما يحرسه');
  if (!Object.prototype.hasOwnProperty.call(srcFiles, MODULE_REL)) fails.push('src: الوحدة نفسها غير ضمن الملفّات الممسوحة (الحارس يفحص ما لا يعرف)');
  if (Object.keys(srcFiles).length < 50) fails.push(`src: الممسوح ${Object.keys(srcFiles).length} ملفّاً فقط — المسح ناقص`);

  return {fails, stats};
}

// ═══ المدخلات الحقيقية ═══
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const q = path.join(dir, e.name);
    if (e.isDirectory()) walk(q, out);
    else if (e.name.endsWith('.js')) out.push(q);
  }
  return out;
};
const srcFiles = {};
for (const f of walk(SRC)) srcFiles[path.relative(SRC, f).split(path.sep).join('/')] = normalize(fs.readFileSync(f, 'utf8'));
srcFiles['../index.js'] = normalize(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'));

const real = {
  doc: normalize(fs.readFileSync(DOC_PATH, 'utf8')),
  vocab: V,
  moduleSource: normalize(fs.readFileSync(path.join(SRC, MODULE_REL), 'utf8')),
  srcFiles,
  sessionNames: N,
  code: {VALID_RATINGS, VALID_VISIBLE_DEFECTS, UNUSABLE_REASON},
};

// ═══ ١–٧ على الملفّات الحقيقية ═══
const base = verify(real);
eq(base.fails.length, 0, `[١–٧] الوثيقة والوحدة متطابقتان: ${base.fails.join(' ‖ ')}`);
ok(base.stats.docGroups >= 40 && base.stats.docEntries >= 150, `[١] الجدول ليس فارغاً: ${base.stats.docGroups} مجموعة، ${base.stats.docEntries} مفتاحاً`);
eq(base.stats.docScalars, 7, '[١] الثوابت المفردة سبعة (خمسة إصدارات + FORM_LEGACY + SYMPTOM_NONE_NOTICED)');
eq(Object.keys(V).length, base.stats.docGroups + base.stats.docScalars, '[١] عدد التصديرات = مجموعات الوثيقة + ثوابتها');
eq(base.stats.design + base.stats.proposal + base.stats.decided, base.stats.docEntries + base.stats.docScalars, '[٣] كل صفّ بوسم design أو proposal أو decided');
// (2026-10-22، القاعدة 23: كانت «ثماني» تثبّت وسوم المقترح قبل أمر ربط «قبل/بعد صيانة»؛ استُبدلت بالست والعشرين: الثماني القديمة + ثماني عشرة جديدة بوسم proposal — أربع A2 للأغراض maintenance_* في SCAN_PURPOSE وSETTABLE_SESSION_PURPOSE، وثلاث A2 لرفوض نوع العطل في PURPOSE_REFUSAL، وواحدة A3 BEFORE_WRONG_DEFECT_TYPE، وعشر A3 في PAIR_CALL_REFUSAL؛ ثم (S8، 2026-10-22، القاعدة 23 مرّة ثانية: 26 تُستبدل بـ27) الحادية عشرة PAIR_CALL_REFUSAL.OWNER_MISMATCH)
eq(base.stats.proposal, 32, '[٣] اثنتان وثلاثون قيمة بوسم proposal (ق14، 2026-10-23، القاعدة 23: كانت إحدى وثلاثين؛ أُضيف CONSENT_STATE.INHERITED، اسم حالة الوراثة، A8) — الإحدى والثلاثون السابقة: ثماني قديمة (خمس A4 بعد أمر S-P6-07: COMPLETED_UNCLASSIFIED وأسباب NOT_ELIGIBLE الأربعة؛ واثنتان A8 CONSENT_LOCALE.AR وTR؛ وواحدة A12 MARKETING_NAME_STATE.MAPPED) + ثلاث وعشرون بأمر ربط «قبل/بعد صيانة» (2026-10-22: أربع A2 + ثلاث A2 + واحدة A3 + عشر A3، وإحدى عشرة بعد إضافة PAIR_CALL_REFUSAL.OWNER_MISMATCH في S8، ثم PURPOSE_REFUSAL.PART_NOT_ENABLED بعد إقرار حسن ق31 في 2026-10-22: القاعدة 23 مرّة ثالثة، 27 تُستبدل بـ28؛ ثم LINK_MODEL_CHECK بثلاث قيم بقرار حسن ق36 أ في 2026-10-22: مرّة رابعة، 28 تُستبدل بـ31)');
ok(base.stats.design > 0 && base.stats.decided > 0, '[٣] وفيها التصميم والمعتمَد معاً');
// بعد أمر حسم §٧ (2026-10-15) صار كل وسم proposal مرجعه E<n> decided؛ وبعد أمر S-SWEEP (2026-10-15) رُفعت الأربع الباقية (مرجعها A11 وA15): exclusion.state ⟵ E45 وdirection ⟵ E46
eq(base.stats.proposalNames.join(' '), 'SCAN_PURPOSE.MAINTENANCE_BEFORE SCAN_PURPOSE.MAINTENANCE_AFTER SETTABLE_SESSION_PURPOSE.MAINTENANCE_BEFORE SETTABLE_SESSION_PURPOSE.MAINTENANCE_AFTER PAIR_LINK_REFUSAL.BEFORE_WRONG_DEFECT_TYPE PAIR_CALL_REFUSAL.NOT_AUTHENTICATED PAIR_CALL_REFUSAL.SESSION_ID_REQUIRED PAIR_CALL_REFUSAL.SESSION_NOT_AFTER PAIR_CALL_REFUSAL.SESSION_NOT_ACTIVE PAIR_CALL_REFUSAL.SESSION_DEFECT_TYPE_ABSENT PAIR_CALL_REFUSAL.PART_NOT_ENABLED PAIR_CALL_REFUSAL.VALIDITY_SETTING_ABSENT PAIR_CALL_REFUSAL.BEFORE_SCAN_ID_REQUIRED PAIR_CALL_REFUSAL.BEFORE_UNREADABLE PAIR_CALL_REFUSAL.SCAN_CAP_EXCEEDED PAIR_CALL_REFUSAL.OWNER_MISMATCH LINK_MODEL_CHECK.MATCH LINK_MODEL_CHECK.MISMATCH LINK_MODEL_CHECK.MODEL_ABSENT REPEAT_STATE.COMPLETED_UNCLASSIFIED REPEAT_NOT_ELIGIBLE_REASON.PURPOSE_NOT_NORMAL REPEAT_NOT_ELIGIBLE_REASON.PARENT_JOINER_UNKNOWN REPEAT_NOT_ELIGIBLE_REASON.RATE_ABSENT REPEAT_NOT_ELIGIBLE_REASON.RATE_INVALID PURPOSE_REFUSAL.DEFECT_TYPE_REQUIRED PURPOSE_REFUSAL.DEFECT_TYPE_INVALID PURPOSE_REFUSAL.DEFECT_TYPE_NOT_APPLICABLE PURPOSE_REFUSAL.PART_NOT_ENABLED CONSENT_STATE.INHERITED CONSENT_LOCALE.AR CONSENT_LOCALE.TR MARKETING_NAME_STATE.MAPPED', '[٣] أسماء المقترح الإحدى والثلاثون بترتيب الوثيقة (ثماني قديمة وثلاث وعشرون بأمر الصيانة وق31 وق36 2026-10-22: تنتظر اعتماد المستخدم، ق33)');
eq(base.stats.proposalNames.length, 32, '[٣] وقائمة المقترح اثنتان وثلاثون');
eq(base.stats.decided, 50, '[٣] المعتمد (decided) 50 = 45 قبل أمر الصيانة (39 رُفعت وسومها بأمر حسم §٧ + PROTOCOL_PART.BATTERY_BEFORE_AFTER (E42) + الأربع المرفوعة بأمر S-SWEEP (E45 وE46) + REPEAT_REFUSAL.PARENT_JOINER_UNKNOWN (E41)) + DEFECT_TYPE ×5 (E47، قرار المستخدم 2026-10-22) — استُبدل اختبار «45» (القاعدة 23)');
eq(base.stats.moduleTagged, base.stats.docEntries + base.stats.docScalars, '[٣-ب] لكل صفّ في جدولَي §٨ وسمٌ في تعليق الوحدة، وعددهما واحد');
eq(base.stats.section7Rows, 26, '[٣-ج] صفوف §٧ الستّة والعشرون كلّها في §٧-أ');
eq(SECTION7_USER_DECISIONS.length + SECTION7_COORDINATOR_DECISIONS.length, 26, '[٣-ج] 26 = 5 بقرار المستخدم + 21 بحسم المنسّق');
eq(SECTION7_USER_DECISIONS.length, 5, '[٣-ج] خمسة بقرار المستخدم');
eq(SECTION7_COORDINATOR_DECISIONS.length, 21, '[٣-ج] واحد وعشرون بحسم المنسّق');
eq(base.stats.turkishApprovals, 5, '[٤-د] سجلّ اعتماد التركية فيه خمسة صفوف: #5 من الأعراض و«غير متوفر» (SD:10) وصفّ كتلتَي §٥-ب و§٥-ج وصفّ تعديل thermal.good وصفّ «ısınma» (الثلاثة الأخيرة 2026-10-16) — فإن زاد اعتماد زاد صفّ بتاريخه ونصّه');
// القاعدة 40: العدد من عدّ الاختبار لا من اليد. الخانات التركية المعتمدة بصفّ الكتلة: 32 صفّاً في §٥-ب ناقصاً الصفّين المؤجَّلين، و13 عَرَضاً ناقصاً #5 (له صفّه)
eq(base.stats.levelApproved, 30, '[٤-د] خانات §٥-ب التركية المعتمدة 2026-10-16: ثلاثون (32 صفّاً ناقصاً battery.note وthermal.review_note)');
eq(base.stats.levelApproved, base.stats.levelRows - 2, '[٤-د] ثلاثون = كل صفوف §٥-ب عدا الصفّين المؤجَّلين');
eq(base.stats.symptomBlockApproved, 12, '[٤-د] خانات §٥-ج التركية المعتمدة بصفّ الكتلة: اثنتا عشرة (13 عَرَضاً ناقصاً #5)');
eq(base.stats.symptomBlockApproved, base.stats.symptomRows - 1, '[٤-د] اثنتا عشرة = كل أعراض §٥-ج عدا #5 المعتمد قبلاً بصفّه');
// العدد المكتوب باليد في الوثيقة («15 رمزاً») يُثبَّت بما تصدّره الوحدة (القاعدة 40: العدد من أداة لا من اليد)
eq(Object.keys(V.FORM_REFUSAL).length, 15, '[١] FORM_REFUSAL خمسة عشر رمزاً — الوثيقة تكتب «15 رمزاً» (A5 وE5)');
eq((real.doc.match(/15 رمزاً/g) || []).length, 2, '[١] الوثيقة تذكر «15 رمزاً» في موضعين (A5 وE5) — فإن تغيّر العدد تغيّر الموضعان معاً');
eq(V.PROTOCOL_VERSION, 1, '[١] PROTOCOL_VERSION عدد صحيح موجب (مقترح E39)');
eq(V.FORM_CONTRACT_VERSION, 2, '[١] formContractVersion: 2 (P:1236)');
eq(V.FORM_LEGACY_CONTRACT_VERSION, 1, '[١] contractVersion: 1 (P:1237)');
for (const nm of ['SCAN_PROTOCOL', 'PROTOCOL_PENDING', 'TECHNICIAN_FORMS', 'PROTOCOL_CORRECTIONS', 'PROTOCOL_SETTINGS', 'TECHNICIANS']) ok(typeof V.PROTOCOL_COLLECTION[nm] === 'string', `[١] ${nm} مُصدَّرة`);
ok(!Object.values(V.PROTOCOL_COLLECTION).includes('returnRecords'), '[٥] returnRecords لا تُصدَّر');
ok(!Object.values(V.SCAN_PURPOSE).includes('return') && !Object.values(V.SCAN_PURPOSE).includes('return_not_working'), '[٥] return وreturn_not_working ليستا في SCAN_PURPOSE');
// E42 (محسوم 2026-10-15): مفتاح الجزء يُصدَّر باسم batteryBeforeAfter؛ الاسم القديم batteryPairs اسم حقل حمولة fv68 القائم فلا يُصدَّر ولا يعود (القاعدة 24)
const fv68Names = require('../src/analysis/fv68Names');
ok(Object.values(fv68Names.FOOTER).includes('batteryPairs'), '[٥] سبب منع الاسم القديم قائم: fv68Names.FOOTER.BATTERY_PAIRS يحمل batteryPairs (E42)');
ok(!Object.values(V.PROTOCOL_PART).includes('batteryPairs'), '[٥] batteryPairs ليس في PROTOCOL_PART (E42)');
eq(V.PROTOCOL_PART.BATTERY_BEFORE_AFTER, 'batteryBeforeAfter', '[١] مفتاح الجزء المعاد تسميته batteryBeforeAfter (E42)');
ok(!Object.values(fv68Names.FOOTER).includes(V.PROTOCOL_PART.BATTERY_BEFORE_AFTER), '[٥] batteryBeforeAfter لا يصطدم بأيّ اسم في fv68Names.FOOTER (E42)');
// الأعراض (E37): ثلاثة عشر مفتاحاً، اثنا عشر منها غير none_noticed، والصفوف في الوثيقة ثلاثة عشر
eq(Object.keys(V.SYMPTOM).length, 13, '[١] SYMPTOM ثلاثة عشر مفتاحاً (E37)');
eq(Object.values(V.SYMPTOM).filter((x) => x !== V.SYMPTOM_NONE_NOTICED).length, 12, '[١] اثنا عشر مفتاحاً عَرَضاً غير none_noticed (E37)');
eq(V.SYMPTOM.NONE_NOTICED, V.SYMPTOM_NONE_NOTICED, '[١] SYMPTOM.NONE_NOTICED هو الثابت المفرد نفسه (مصدر واحد)');
eq(Object.keys(V.SYMPTOM).indexOf('NONE_NOTICED'), 12, '[١] none_noticed آخر مفتاح (خارج الاثنتي عشرة)');
eq(base.stats.symptomRows, 13, '[١] جدول §٥-ج ثلاثة عشر صفّاً');
// المستويات (E38): الجدول الواحد في §٥-ب، فيه الستّة عشر وصفاً
eq(base.stats.levelCells, 16, '[١] §٥-ب: ستّة عشر وصفاً (4 فئات × 4 مستويات، B3)');
eq(base.stats.levelRows, 32, '[١] §٥-ب: 32 صفّاً (16 وصفاً + 4 عناوين + «لم أفحصها» + 3 قواعد + عتبات البطارية + 4 مقدّمات + ملاحظتا تصميم + تنبيه التناقض)');
eq(base.stats.levelRows, 16 + 4 + 1 + 3 + 1 + 4 + 2 + 1, '[١] §٥-ب: مجموع الأصناف يساوي عدد الصفوف');
eq(V.SYMPTOM.CHARGING_SLOW, 'charging_slow', '[١] #5 المفتاح charging_slow');
ok(Object.values(V.SYMPTOM).filter((x) => x !== V.SYMPTOM_NONE_NOTICED).every((x) => !VALID_VISIBLE_DEFECTS.includes(x)), '[٤] أعراض الاثني عشر ليست في VALID_VISIBLE_DEFECTS');
eq(Object.keys(V.PROTOCOL_PART).length, 6, '[١] PROTOCOL_PART ستّة مفاتيح: purposes · batteryBeforeAfter · coldRepeat · returns · doubleEval · consent (P:787، E42)');

// ═══ ٩ مفردات ربط «قبل/بعد صيانة» (أمر المستخدم 2026-10-22): العقد = التصدير، والقيم حرفيّات هنا عمداً (مرجع مستقلّ عن الوحدة) ═══
// أنواع العطل: خمسة وقائمة مغلقة (قرار المستخدم 2026-10-22، E47 decided)؛ لا «أخرى» ولا نصّ حرّ؛ الشاشة ليست نوعاً.
deq(V.DEFECT_TYPE, {BATTERY: 'BATTERY', CHARGING_PORT: 'CHARGING_PORT', THERMAL: 'THERMAL', MOTHERBOARD: 'MOTHERBOARD', SOFTWARE: 'SOFTWARE'}, '[٩] DEFECT_TYPE خمسة بالضبط: BATTERY · CHARGING_PORT · THERMAL · MOTHERBOARD · SOFTWARE');
for (const forbidden of ['OTHER', 'SCREEN', 'DISPLAY', 'OTHERS', 'MIXED']) {
  ok(!Object.values(V.DEFECT_TYPE).includes(forbidden) && !Object.keys(V.DEFECT_TYPE).includes(forbidden), `[٩] «${forbidden}» ليست نوع عطل (لا «أخرى» ولا الشاشة ولا «مختلط»)`);
}
eq(real.doc.split('\n').filter((l) => l.startsWith('| `DEFECT_TYPE` |') && l.includes('| decided | E47 |')).length, 5, '[٩] صفوف DEFECT_TYPE الخمسة في §٨-أ كلّها decided E47');
ok(/^\| E47 \|/m.test(real.doc.match(/^### ٧-أ[^\n]*\n([\s\S]*?)^### ٧-ب/m)[1]), '[٩] E47 في §٧-أ');
ok(/E47 \|[^\n]*\*\*معتمد 2026-10-22\*\* \(قرار المستخدم\)/.test(real.doc), '[٩] E47: «معتمد 2026-10-22» بقرار المستخدم');
// الأغراض: maintenance_* تُختار، وbattery_* قيمتا قراءة تاريخيتان (لا تُختاران ولا تُحذفان)
deq(V.SETTABLE_SESSION_PURPOSE, {NORMAL: 'normal', MAINTENANCE_BEFORE: 'maintenance_before', MAINTENANCE_AFTER: 'maintenance_after'}, '[٩] ما يُختار: normal وmaintenance_before وmaintenance_after (حلّتا محلّ battery_before/after)');
eq(V.SCAN_PURPOSE.MAINTENANCE_BEFORE, 'maintenance_before', '[٩] SCAN_PURPOSE.MAINTENANCE_BEFORE');
eq(V.SCAN_PURPOSE.MAINTENANCE_AFTER, 'maintenance_after', '[٩] SCAN_PURPOSE.MAINTENANCE_AFTER');
eq(V.SCAN_PURPOSE.BATTERY_BEFORE, 'battery_before', '[٩] battery_before تبقى في SCAN_PURPOSE قيمة قراءة تاريخية (القاعدتان 22 و42: لا تُحذف)');
eq(V.SCAN_PURPOSE.BATTERY_AFTER, 'battery_after', '[٩] battery_after تبقى في SCAN_PURPOSE قيمة قراءة تاريخية');
ok(!Object.values(V.SETTABLE_SESSION_PURPOSE).includes('battery_before') && !Object.values(V.SETTABLE_SESSION_PURPOSE).includes('battery_after'), '[٩] battery_* ليستا قابلتين للاختيار');
ok(Object.values(V.SETTABLE_SESSION_PURPOSE).every((x) => Object.values(V.SCAN_PURPOSE).includes(x)), '[٩] المختار جزء من SCAN_PURPOSE');
// الرفوض الجديدة بأسمائها (WIRE-SPEC §٣-أ)
deq([V.PURPOSE_REFUSAL.DEFECT_TYPE_REQUIRED, V.PURPOSE_REFUSAL.DEFECT_TYPE_INVALID, V.PURPOSE_REFUSAL.DEFECT_TYPE_NOT_APPLICABLE], ['DEFECT_TYPE_REQUIRED', 'DEFECT_TYPE_INVALID', 'DEFECT_TYPE_NOT_APPLICABLE'], '[٩] رفوض نوع العطل الثلاثة بأسمائها');
// (ق31، أقرّه حسن 2026-10-22) رفض setSessionPurpose لمحلّ بلا الجزء: رمز واحد مسمّى، لا يتصادم مع PAIR_PART_NOT_ENABLED (رمز القائمة والتأكيد)
eq(V.PURPOSE_REFUSAL.PART_NOT_ENABLED, 'PURPOSE_PART_NOT_ENABLED', '[٩] PURPOSE_REFUSAL.PART_NOT_ENABLED = PURPOSE_PART_NOT_ENABLED (ق31)');
eq(Object.keys(V.PURPOSE_REFUSAL).length, 5, '[٩] PURPOSE_REFUSAL خمسة رموز: SESSION_NOT_PENDING (E5) + ثلاثة للنوع + PART_NOT_ENABLED (ق31)');
// (ق36 أ، أقرّه حسن 2026-10-22) ملاحظة الطراز على «بعد»: ثلاث حالات صريحة (والرابعة null = لا مقارنة ليست قيمة هنا)، والحرفيّة في مصدر واحد مُصدَّر (القاعدة 24)
deq(V.LINK_MODEL_CHECK, {MATCH: 'LINK_MODEL_MATCH', MISMATCH: 'LINK_MODEL_MISMATCH', MODEL_ABSENT: 'LINK_MODEL_ABSENT'}, '[٩] LINK_MODEL_CHECK: ثلاث قيم بحرفيّاتها (LINK_MODEL_MISMATCH من أمر المنسّق، ق36 أ)');
ok(Object.isFrozen(V.LINK_MODEL_CHECK) && new Set(Object.values(V.LINK_MODEL_CHECK)).size === 3, '[٩] LINK_MODEL_CHECK مجمَّدة وبلا قيمة مكرَّرة');
ok(Object.values(V.LINK_MODEL_CHECK).every((x) => x.startsWith('LINK_MODEL_')), '[٩] وكلّها بسابقة LINK_MODEL_ (لا تصادم مع LINK_STATE ولا PAIR_)');
ok(!Object.values(V.LINK_MODEL_CHECK).some((x) => Object.values(V.LINK_STATE).includes(x) || Object.values(V.PAIR_CALL_REFUSAL).includes(x) || Object.values(V.PAIR_LINK_REFUSAL).includes(x)), '[٩] ولا تتصادم قيمة منها مع LINK_STATE ولا رموز الرفض');
ok(V.PURPOSE_REFUSAL.PART_NOT_ENABLED !== V.PAIR_CALL_REFUSAL.PART_NOT_ENABLED, '[٩] ورمز رفض setSessionPurpose غير رمز القائمة والتأكيد (PURPOSE_ مقابل PAIR_)');
deq([V.PAIR_CALL_REFUSAL.SESSION_NOT_AFTER, V.PAIR_CALL_REFUSAL.PART_NOT_ENABLED, V.PAIR_CALL_REFUSAL.VALIDITY_SETTING_ABSENT], ['PAIR_SESSION_NOT_AFTER', 'PAIR_PART_NOT_ENABLED', 'PAIR_VALIDITY_SETTING_ABSENT'], '[٩] رفوض القائمة والتأكيد الثلاثة المسمّاة في WIRE-SPEC §٣-أ');
eq(V.PAIR_LINK_REFUSAL.BEFORE_WRONG_DEFECT_TYPE, 'BEFORE_WRONG_DEFECT_TYPE', '[٩] BEFORE_WRONG_DEFECT_TYPE جديد في رفوض الربط');
for (const kept of ['BEFORE_NOT_FOUND', 'BEFORE_NOT_OWNED', 'BEFORE_WRONG_PURPOSE', 'BEFORE_ALREADY_PAIRED', 'BEFORE_EXPIRED']) eq(V.PAIR_LINK_REFUSAL[kept], kept, `[٩] ${kept} باقٍ بنصّه`);
// ما أُبقي في المفردات بلا استعمال في هذه المرحلة (يُسمّى في A3 البند ٦): لا يُحذف
for (const [g, k, v] of [['PAIR_STATE', 'SUPERSEDED', 'SUPERSEDED'], ['PAIR_WARNING', 'DIFFERENT_DEVICE', 'DIFFERENT_DEVICE'], ['PAIR_LINK_REFUSAL', 'AMBIGUOUS_SHORT_ID', 'AMBIGUOUS_SHORT_ID'], ['PAIR_LINK_REFUSAL', 'SESSION_CODE_NOT_REPORT_CODE', 'SESSION_CODE_NOT_REPORT_CODE'], ['LINK_METHOD', 'AUTO_CONFIRMED', 'auto_confirmed']]) {
  eq(V[g][k], v, `[٩] ${g}.${k} باقية في المفردات غير مستعملة في هذه المرحلة (لا تُحذف)`);
}
ok(real.moduleSource.includes('AMBIGUOUS_SHORT_ID وSESSION_CODE_NOT_REPORT_CODE غير مستعملتين في هذه المرحلة'), '[٩] عدم استعمال القيمتين مكتوب في الوحدة');
// الاستثناء الصريح في رأس الوحدة وفي العقد، بنصّ الأمر
const EXCEPTION_TEXT = 'كل ما تبنيه يعمل خلف الحوارس الحالية أو حارس جديد مُطفأ';
ok(real.moduleSource.includes(EXCEPTION_TEXT), `[٩] رأس الوحدة يحمل استثناء أمر المستخدم 2026-10-22 بنصّه: «${EXCEPTION_TEXT}»`);
ok(real.doc.includes(`«${EXCEPTION_TEXT}»`), '[٩] العقد يحمل الاستثناء بنصّه');
ok(real.moduleSource.includes('ق33') && real.doc.includes('ق33'), '[٩] والإحالة إلى ق33 في ورقة قرارات حسن في الاثنين');
// الوسم والمصدر في الوحدة لقيم الصيانة (٣-ب يحرس التساوي عامّاً؛ هنا بالاسم)
{
  const tags = moduleTags(real.moduleSource).tags;
  for (const [where, prov, src] of [['SCAN_PURPOSE.MAINTENANCE_BEFORE', 'proposal', 'A2'], ['SETTABLE_SESSION_PURPOSE.MAINTENANCE_AFTER', 'proposal', 'A2'], ['PURPOSE_REFUSAL.DEFECT_TYPE_INVALID', 'proposal', 'A2'], ['PAIR_LINK_REFUSAL.BEFORE_WRONG_DEFECT_TYPE', 'proposal', 'A3'], ['PAIR_CALL_REFUSAL.SCAN_CAP_EXCEEDED', 'proposal', 'A3'], ['DEFECT_TYPE.SOFTWARE', 'decided', 'E47']]) {
    ok(tags[where] && tags[where].prov === prov && tags[where].src === src, `[٩] ${where}: وسم الوحدة «${prov} ${src}»`);
  }
}
eq(new Set(Object.values(V.PAIR_CALL_REFUSAL)).size, Object.values(V.PAIR_CALL_REFUSAL).length, '[٩] PAIR_CALL_REFUSAL بلا قيمة مكرَّرة');
eq(Object.keys(V.PAIR_CALL_REFUSAL).length, 11, '[٩] PAIR_CALL_REFUSAL أحد عشر رمزاً (العشرة + OWNER_MISMATCH في S8: القاعدة 23)');
ok(Object.values(V.PAIR_CALL_REFUSAL).every((x) => x.startsWith('PAIR_')), '[٩] وكلّها بسابقة PAIR_ (لا تصادم مع رموز الجلسة)');

// ═══ ٨ طفرات في الذاكرة (القاعدة 39) — كل واحدة يجب أن تُفشل verify() بسببها المسمّى ═══
const clone = (o) => JSON.parse(JSON.stringify(o));
const freezeAll = (o) => { for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') Object.freeze(o[k]); return Object.freeze(o); };
const vocabMutant = (fn) => { const c = clone(V); fn(c); return freezeAll(c); };
const withDoc = (fn) => ({...real, doc: fn(real.doc)});
const withVocab = (fn) => ({...real, vocab: vocabMutant(fn)});
const expectFail = (label, input, needle) => {
  const r = verify(input);
  ok(r.fails.some((f) => f.includes(needle)), `[٨] طفرة «${label}» تُفشل بسبب «${needle}» — ${r.fails.length === 0 ? 'لم تُفشل' : r.fails.slice(0, 3).join(' ‖ ')}`);
};
const rowLine = (doc, g, k) => doc.split('\n').find((l) => l.startsWith(`| \`${g}\` | \`${k}\` |`));

// المستويات (E38): الجدول في §٥-ب والوحدة وجهان
const lvlRow = (d, anchor) => d.split('\n').find((l) => l.startsWith(`| \`${anchor}\` |`));
expectFail('مستوى: صفّ يُحذف', withDoc((d) => d.replace(`${lvlRow(d, 'battery.good')}\n`, '')), 'لا صفّ للموضع «battery.good»');
expectFail('مستوى: صفّ يتكرّر', withDoc((d) => d.replace(lvlRow(d, 'thermal.weak'), `${lvlRow(d, 'thermal.weak')}\n${lvlRow(d, 'thermal.weak')}`)), 'موضع مكرَّر «thermal.weak»');
expectFail('مستوى: موضع غير معروف', withDoc((d) => d.replace('<!-- LEVEL-TEXT:END -->', '| `foo.bar` | — | نصّ | Metin | مقترح، للاعتماد |\n<!-- LEVEL-TEXT:END -->')), 'موضع غير معروف «foo.bar»');
// (2026-10-16، القاعدة 23: الطفرتان الأوليان كانتا تثبّتان «مقترح، للاعتماد» وتفشلان عند الاعتماد الصحيح؛ استُبدلتا بما يثبّت الحالة الجديدة «معتمد 2026-10-16»)
const mutateRow = (d, row, from, to) => {
  if (!row || !row.includes(from)) throw new Error(`طفرة بلا هدف: «${from}» ليست في الصفّ`);
  return d.replace(row, row.replace(from, to));
};
expectFail('مستوى: التركية تعود مقترحة', withDoc((d) => mutateRow(d, lvlRow(d, 'overall.fair'), `| ${STATUS_TURKISH_APPROVED} |`, '| مقترح، للاعتماد |')), '«overall.fair» تركيتها معتمدة');
expectFail('مستوى: تاريخ الاعتماد يتبدّل', withDoc((d) => mutateRow(d, lvlRow(d, 'overall.good'), `| ${STATUS_TURKISH_APPROVED} |`, '| معتمد 2026-10-15 |')), '«overall.good» تركيتها معتمدة');
expectFail('مستوى: «معتمد» بلا تاريخ', withDoc((d) => mutateRow(d, lvlRow(d, 'thermal.fair'), `| ${STATUS_TURKISH_APPROVED} |`, '| معتمد |')), '«thermal.fair» تركيتها معتمدة');
expectFail('مستوى: التركية تُحذف', withDoc((d) => d.replace(lvlRow(d, 'rule.2'), `| \`rule.2\` | — | **إن وقع الهاتف بين مستويين، فاختر الأدنى.** |  | ${STATUS_TURKISH_APPROVED} |`)), '«rule.2» تركيتها معتمدة');
// قرارات المستخدم 2026-10-16 (النقاط الستّ وتعديلاته): كل عودة إلى ما سقط تُفشل بسببها
expectFail('مستوى: «Pil» تعود «Batarya»', withDoc((d) => mutateRow(d, lvlRow(d, 'category.battery'), '**Pil**', '**Batarya**')), 'category.battery تركيتها «**Pil**»');
expectFail('مستوى: «Batarya» تظهر في خانة أخرى', withDoc((d) => mutateRow(d, lvlRow(d, 'battery.excellent'), '**Mükemmel** — ', '**Mükemmel** — Batarya ')), 'battery.excellent: «Batarya» عادت');
expectFail('مستوى: «Isınma» تعود «Isı»', withDoc((d) => mutateRow(d, lvlRow(d, 'category.thermal'), '**Isınma**', '**Isı**')), 'category.thermal تركيتها «**Isınma**»');
expectFail('مستوى: «Kontrol etmedim» تعود «Test etmedim»', withDoc((d) => mutateRow(d, lvlRow(d, 'option.not_tested'), '**Kontrol etmedim**', '**Test etmedim**')), 'option.not_tested تركيتها «**Kontrol etmedim**»');
expectFail('مستوى: القاعدة 3 تعود «Test etmedim»', withDoc((d) => mutateRow(d, lvlRow(d, 'rule.3'), '«Kontrol etmedim»', '«Test etmedim»')), 'rule.3 تركيتها');
expectFail('مستوى: «Test etmedim» تظهر في خانة أخرى', withDoc((d) => mutateRow(d, lvlRow(d, 'overall.weak'), '**Zayıf** — ', '**Zayıf** — Test etmedim ')), 'overall.weak: «Test etmedim» عادت');
for (const [anchor, from, to] of [['battery.excellent', 'şarj yüzdesi', 'yüzde'], ['battery.good', 'şarj yüzdesi', 'yüzde'], ['battery.fair', 'Şarj yüzdesi', 'Yüzde'], ['battery.weak', 'şarj yüzdesi', 'yüzde']]) {
  expectFail(`مستوى: «şarj yüzdesi» تعود «yüzde» في ${anchor}`, withDoc((d) => mutateRow(d, lvlRow(d, anchor), from, to)), `${anchor}: أوّل ذكر لـ«yüzde» يجب أن يكون «şarj yüzdesi»`);
}
expectFail('مستوى: siz تصير مفرداً (rule.2)', withDoc((d) => mutateRow(d, lvlRow(d, 'rule.2'), 'seçin', 'seç')), 'رمز صيغة المفرد «seç»');
expectFail('مستوى: siz تصير مفرداً (thermal.good)', withDoc((d) => mutateRow(d, lvlRow(d, 'thermal.good'), 'duymuyorsunuz', 'duymuyorsun')), 'رمز صيغة المفرد «duymuyorsun»');
expectFail('مستوى: siz تصير مفرداً (performance.fair)', withDoc((d) => mutateRow(d, lvlRow(d, 'performance.fair'), 'denediyseniz', 'denediysen')), 'رمز صيغة المفرد «denediysen»');
expectFail('مستوى: رمز siz يزول من صفّ يخاطب الفنّي (rule.1)', withDoc((d) => mutateRow(d, lvlRow(d, 'rule.1'), 'karar verin', 'karar verilir')), 'rule.1: رمز siz «verin» غائب');
expectFail('مستوى: «Zayıf/Weak» تُحذف إحدى كلمتيها', withDoc((d) => mutateRow(d, lvlRow(d, 'battery.health_thresholds'), '«Zayıf/Weak»', '«Zayıf»')), 'battery.health_thresholds: «Zayıf/Weak» تبقى بالكلمتين');
expectFail('مستوى: «Kötü/Bad» تُحذف إحدى كلمتيها', withDoc((d) => mutateRow(d, lvlRow(d, 'battery.health_thresholds'), '«Kötü/Bad»', '«Kötü»')), 'battery.health_thresholds: «Kötü/Bad» تبقى بالكلمتين');
expectFail('مستوى: مثال thermal.good التركي يعود القديم', withDoc((d) => mutateRow(d, lvlRow(d, 'thermal.good'), 'bırakma ihtiyacı duymuyorsunuz', 'bırakmak istemiyorsunuz')), 'thermal.good مثالها التركي');
expectFail('مستوى: مثال thermal.good العربي يعود القديم', withDoc((d) => mutateRow(d, lvlRow(d, 'thermal.good'), THERMAL_GOOD_AR_NEW, THERMAL_GOOD_AR_OLD)), 'thermal.good عربيتها تنتهي بمثالها الجديد');
expectFail('مستوى: مثال thermal.weak يقتبس نصّ النظام', withDoc((d) => mutateRow(d, lvlRow(d, 'thermal.weak'), THERMAL_WEAK_TR_EXAMPLE, 'Ekranda «Telefon ısındı» mesajı.')), 'thermal.weak مثالها لا يقتبس نصّ النظام «Telefon ısındı»');
expectFail('مستوى: عربية thermal.weak تتغيّر مع التركية', withDoc((d) => mutateRow(d, lvlRow(d, 'thermal.weak'), THERMAL_WEAK_AR_EXAMPLE_KEPT, 'رسالة حرارة على الشاشة')), 'thermal.weak عربيتها باقية');
expectFail('مستوى: overall.excellent تعود «İçeriden»', withDoc((d) => mutateRow(d, lvlRow(d, 'overall.excellent'), 'Donanım olarak sorunsuz çalışıyor', 'İçeriden olması gerektiği gibi çalışıyor')), 'overall.excellent تركيتها تبدأ بـ');
// «ısı» ⇐ «ısınma» (قرار المستخدم 2026-10-16، القاعدة 39: كل تحوير يُرجع «ısı» يُفشل بسببه، وكل استبدال شامل يمسّ thermal.* يُفشل أيضاً)
expectFail('مستوى: overall.intro تعود «ısı»', withDoc((d) => mutateRow(d, lvlRow(d, 'overall.intro'), 'ısınma ve işlevler', 'ısı ve işlevler')), 'overall.intro تركيتها تحمل');
expectFail('مستوى: overall.intro تعود «ısı» (رمز)', withDoc((d) => mutateRow(d, lvlRow(d, 'overall.intro'), 'ısınma ve işlevler', 'ısı ve işlevler')), 'overall.intro: «ısı» عادت');
expectFail('مستوى: مثال overall.excellent يعود «ısı»', withDoc((d) => mutateRow(d, lvlRow(d, 'overall.excellent'), 'ısınma ve işlevlerin', 'ısı ve işlevlerin')), 'overall.excellent مثالها التركي');
expectFail('مستوى: مثال overall.excellent يعود «ısı» (رمز)', withDoc((d) => mutateRow(d, lvlRow(d, 'overall.excellent'), 'ısınma ve işlevlerin', 'ısı ve işlevlerin')), 'overall.excellent: «ısı» عادت');
expectFail('مستوى: استبدال شامل يمسّ thermal.excellent', withDoc((d) => mutateRow(d, lvlRow(d, 'thermal.excellent'), 'normal ısı.', 'normal ısınma.')), 'thermal.excellent: «ısı» باقية');
expectFail('مستوى: استبدال شامل يمسّ thermal.weak', withDoc((d) => d.replace(lvlRow(d, 'thermal.weak'), lvlRow(d, 'thermal.weak').replace(/(?<![\p{L}])ısı(?![\p{L}])/gu, 'ısınma'))), 'thermal.weak: «ısı» باقية');
// تأكيد المستخدم 2026-10-16: الذكر الثاني لـ«yüzde» يبقى «yüzde» (مثال النسبة في battery.excellent وbattery.fair)
expectFail('مستوى: الذكر الثاني في battery.excellent يصير «şarj yüzdesi»', withDoc((d) => mutateRow(d, lvlRow(d, 'battery.excellent'), 'tüm testten sonra yüzde', 'tüm testten sonra şarj yüzdesi')), 'battery.excellent: الذكر الثاني لـ«yüzde» يبقى «yüzde»');
expectFail('مستوى: الذكر الثاني في battery.fair يصير «şarj yüzdesi»', withDoc((d) => mutateRow(d, lvlRow(d, 'battery.fair'), '**Örnek:** Yüzde bir anda', '**Örnek:** Şarj yüzdesi bir anda')), 'battery.fair: الذكر الثاني لـ«yüzde» يبقى «yüzde»');
expectFail('مستوى: كلمة عربية تتغيّر', withDoc((d) => d.replace(lvlRow(d, 'battery.fair'), lvlRow(d, 'battery.fair').replace('**متوسط**', '**وسط**'))), '«battery.fair» كلمته «**وسط**»');
expectFail('مستوى: كلمة تركية تتغيّر', withDoc((d) => d.replace(lvlRow(d, 'thermal.fair'), lvlRow(d, 'thermal.fair').replace('**Orta** — ', '**Medium** — '))), '«thermal.fair» تركيتها لا تبدأ بـ«**Orta** — »');
expectFail('مستوى: وسم عتبات البطارية يُحذف', withDoc((d) => d.replace(lvlRow(d, 'battery.health_thresholds'), lvlRow(d, 'battery.health_thresholds').replace('[اجتهاد، يُراجَع في يوم التجربة]', ''))), 'عتبات البطارية بلا وسم');
expectFail('مستوى: «يُحسم في P6-08» يُعطى تركية', withDoc((d) => d.replace(lvlRow(d, 'battery.note'), lvlRow(d, 'battery.note').replace('| — | يُحسم في P6-08 |', '| Not | مقترح، للاعتماد |'))), '«battery.note» وسمه «يُحسم في P6-08»');
expectFail('مستوى: «يُحسم في P6-08» يعود «ملاحظة تصميم»', withDoc((d) => d.replace(lvlRow(d, 'thermal.review_note'), lvlRow(d, 'thermal.review_note').replace('| يُحسم في P6-08 |', '| ملاحظة تصميم، بلا تركية |'))), '«thermal.review_note» وسمه «يُحسم في P6-08»');
expectFail('مستوى: صفّ مستوى يفقد كلمته', withDoc((d) => d.replace(lvlRow(d, 'performance.good'), lvlRow(d, 'performance.good').replace('| **جيد** |', '| — |'))), '«performance.good» كلمته «—»');
expectFail('مستوى: صفّ غير مستوى يحمل كلمة', withDoc((d) => d.replace(lvlRow(d, 'rule.1'), lvlRow(d, 'rule.1').replace('| — |', '| **جيد** |'))), '«rule.1» ليس مستوى فكلمته «—»');
expectFail('مستوى: مفتاح التناقض يتغيّر في الوثيقة', withDoc((d) => d.replace(lvlRow(d, 'overall_high_with_weak_category'), lvlRow(d, 'overall_high_with_weak_category').replace('overall_high_with_weak_category', 'overall_high_weak'))), 'موضع غير معروف «overall_high_weak»');
expectFail('مستوى: كتلة الجدول مفقودة', withDoc((d) => d.replace('<!-- LEVEL-TEXT:BEGIN -->', '')), 'الكتلة LEVEL-TEXT ظهرت 0 مرّة');
expectFail('مستوى: فئة خامسة في الوحدة', withVocab((c) => { c.TECHNICIAN_GRADE_CATEGORY.GHOST = 'ghost'; }), 'لا صفّ للموضع «category.ghost»');
expectFail('مستوى: مفتاح التناقض يتغيّر في الوحدة', withVocab((c) => { c.FORM_CONTRADICTION_RULE.OVERALL_HIGH_WITH_WEAK_CATEGORY = 'mixed_signal'; }), 'لا صفّ للموضع «mixed_signal»');
expectFail('مستوى: مستوى خامس في الوحدة', withVocab((c) => { c.GRADE_LEVEL.GHOST = 'ghost'; }), 'لا صفّ للموضع «battery.ghost»');

// الأعراض (E37): الجدول في §٥-ج والوحدة وجهان
const textRow = (d, key) => d.split('\n').find((l) => new RegExp(`^\\| (?:\\d+|—) \\| \`${key}\`\\s*\\|`).test(l));
expectFail('عَرَض: مفتاح الجدول يتغيّر', withDoc((d) => d.replace(textRow(d, 'battery_swollen'), textRow(d, 'battery_swollen').replace('battery_swollen', 'battery_swelling'))), 'SYMPTOM-TEXT الصفّ 3 مفتاحه «battery_swelling»');
expectFail('عَرَض: صفّ يُحذف من الجدول', withDoc((d) => d.replace(`${textRow(d, 'heats_fast_in_use')}\n`, '')), 'SYMPTOM-TEXT 12 صفّاً والوحدة 13');
expectFail('عَرَض: ترتيب صفّين يتبدّل', withDoc((d) => { const a = textRow(d, 'battery_swollen'); const b = textRow(d, 'hot_while_charging'); return d.replace(a, '@@A@@').replace(b, a.replace('| 3 |', '| 4 |')).replace('@@A@@', b.replace('| 4 |', '| 3 |')); }), 'SYMPTOM-TEXT الصفّ 3 مفتاحه «hot_while_charging»');
// (2026-10-16، القاعدة 23: طفرتا «(öneri) يُحذف» و«✓ يُمنح لتركية مقترحة» كانتا تثبّتان الوسم على اثني عشر صفّاً؛ استُبدلتا بعودة الوسم وبمنح «✓» لغير #5)
expectFail('عَرَض: وسم (öneri) يعود', withDoc((d) => mutateRow(d, textRow(d, 'hot_while_charging'), 'Şarj sırasında ısınıyor |', 'Şarj sırasında ısınıyor (öneri) |')), '«hot_while_charging» تركيّته معتمدة');
expectFail('عَرَض: وسم (öneri) يعود على none_noticed', withDoc((d) => mutateRow(d, textRow(d, 'none_noticed'), 'Bir şey fark etmedim |', 'Bir şey fark etmedim (öneri) |')), '«none_noticed» تركيّته معتمدة');
expectFail('عَرَض: وسم (öneri) يعود على #5', withDoc((d) => mutateRow(d, textRow(d, 'charging_slow'), '(✓ بتعديل المستخدم) |', '(✓ بتعديل المستخدم) (öneri) |')), '«charging_slow» تركيّته بتعديل المستخدم');
expectFail('عَرَض: نصّ #2 يعود القديم', withDoc((d) => mutateRow(d, textRow(d, 'battery_jumps_or_shuts_down'), 'Şarj yüzdesi aniden düşüyor', 'Yüzde ani düşüşler yapıyor')), 'عَرَض «battery_jumps_or_shuts_down» نصّه نصّ المستخدم بحرفه');
expectFail('عَرَض: نصّ #10 يعود القديم', withDoc((d) => mutateRow(d, textRow(d, 'game_stutter_after_minutes'), 'Oyunlar birkaç dakika sonra takılıyor', 'Birkaç dakika sonra oyunlarda takılma')), 'عَرَض «game_stutter_after_minutes» نصّه نصّ المستخدم بحرفه');
expectFail('عَرَض: نصّ #11 يعود القديم', withDoc((d) => mutateRow(d, textRow(d, 'game_screen_lines_or_flicker'), 'ekranda çizgiler veya titreme oluyor', 'ekranda çizgi veya titreme')), 'عَرَض «game_screen_lines_or_flicker» نصّه نصّ المستخدم بحرفه');
expectFail('عَرَض: «Yüzde» تعود في #2 (نصّ آخر بلا şarj)', withDoc((d) => mutateRow(d, textRow(d, 'battery_jumps_or_shuts_down'), 'Şarj yüzdesi aniden', 'Yüzde aniden')), 'عَرَض «battery_jumps_or_shuts_down» نصّه نصّ المستخدم بحرفه');
expectFail('عَرَض: وسم المستخدم ✓ يُحذف من #5', withDoc((d) => d.replace(textRow(d, 'charging_slow'), textRow(d, 'charging_slow').replace('✓', ''))), '«charging_slow» تركيّته بتعديل المستخدم');
expectFail('عَرَض: ✓ يُمنح لغير #5', withDoc((d) => mutateRow(d, textRow(d, 'battery_swollen'), 'Şişmiş veya arka kapak kalkmış |', 'Şişmiş veya arka kapak kalkmış (✓) |')), '«battery_swollen» «✓» لـ#5 وحده');
expectFail('عَرَض: none_noticed يُرقَّم', withDoc((d) => d.replace(textRow(d, 'none_noticed'), textRow(d, 'none_noticed').replace('| — |', '| 13 |'))), 'الصفّ 13 رقمه «13»');
expectFail('عَرَض: ترقيم الصفّ الأوّل يتغيّر', withDoc((d) => d.replace(textRow(d, 'battery_dies_before_day_end'), textRow(d, 'battery_dies_before_day_end').replace('| 1 |', '| 2 |'))), 'الصفّ 1 رقمه «2»');
expectFail('عَرَض: تركية فارغة', withDoc((d) => d.replace(textRow(d, 'battery_swollen'), '| 3 | `battery_swollen` | منتفخة أو الغطاء مرتفع |  |')), '«battery_swollen» بلا عربية أو بلا تركية');
expectFail('عَرَض: كتلة الجدول مفقودة', withDoc((d) => d.replace('<!-- SYMPTOM-TEXT:BEGIN -->', '')), 'الكتلة SYMPTOM-TEXT ظهرت 0 مرّة');
expectFail('عَرَض: قيمة في §٨-أ تتغيّر', withDoc((d) => d.replace(rowLine(d, 'SYMPTOM', 'CHARGING_SLOW'), rowLine(d, 'SYMPTOM', 'CHARGING_SLOW').replace('`charging_slow`', '`charging_slowly`'))), 'قيمة SYMPTOM.CHARGING_SLOW تختلف');
expectFail('عَرَض: صفّ يُحذف من §٨-أ', withDoc((d) => d.replace(`${rowLine(d, 'SYMPTOM', 'SYSTEM_HEAT_WARNING')}\n`, '')), 'module→doc: SYMPTOM.SYSTEM_HEAT_WARNING');

// الوثيقة تتغيّر والوحدة كما هي
expectFail('قيمة في الوثيقة تتغيّر', withDoc((d) => d.replace(rowLine(d, 'SCAN_PURPOSE', 'NORMAL'), rowLine(d, 'SCAN_PURPOSE', 'NORMAL').replace('`normal`', '`regular`'))), 'قيمة SCAN_PURPOSE.NORMAL تختلف');
expectFail('صفّ يُحذف من الوثيقة', withDoc((d) => d.replace(`${rowLine(d, 'LINK_STATE', 'MISSING')}\n`, '')), 'module→doc: LINK_STATE.MISSING');
expectFail('صفّ زائد في الوثيقة', withDoc((d) => d.replace(rowLine(d, 'LINK_STATE', 'MISSING'), `${rowLine(d, 'LINK_STATE', 'MISSING')}\n| \`LINK_STATE\` | \`GHOST\` | \`ghost\` | proposal | E3 |`)), 'doc→module: LINK_STATE.GHOST');
expectFail('مجموعة كاملة في الوثيقة وحدها', withDoc((d) => d.replace('<!-- VOCAB-GROUPS:END -->', '| `GHOST_GROUP` | `A` | `a` | proposal | E3 |\n<!-- VOCAB-GROUPS:END -->')), 'doc→module: المجموعة GHOST_GROUP');
expectFail('مفتاح مكرَّر في الوثيقة', withDoc((d) => d.replace(rowLine(d, 'LINK_STATE', 'MISSING'), `${rowLine(d, 'LINK_STATE', 'MISSING')}\n${rowLine(d, 'LINK_STATE', 'MISSING')}`)), 'مكرَّر');
expectFail('ثابت مفرد يتغيّر في الوثيقة', withDoc((d) => d.replace(/^\| `PROTOCOL_VERSION` \| `1` \|/m, '| `PROTOCOL_VERSION` | `2` |')), 'قيمة الثابت PROTOCOL_VERSION تختلف');
expectFail('ثابت مفرد يُحذف من الوثيقة', withDoc((d) => d.replace(/^\| `HOT_START_RULE_VERSION` .*\n/m, '')), 'module→doc: الثابت HOT_START_RULE_VERSION');
expectFail('كتلة المجموعات مفقودة', withDoc((d) => d.replace('<!-- VOCAB-GROUPS:BEGIN -->', '')), 'الكتلة VOCAB-GROUPS ظهرت 0 مرّة');
expectFail('وسم مجهول', withDoc((d) => d.replace(rowLine(d, 'LINK_STATE', 'NONE'), rowLine(d, 'LINK_STATE', 'NONE').replace('| design |', '| approved |'))), 'وسمه «approved»');
// (بعد أمر S-SWEEP لا صفّ proposal حقيقي في الوثيقة: فالطفرات هنا تُنتج صفّ proposal من صفّ decided ثم تتحقّق أن الاختبار يرفضه بسببه)
expectFail('مقترح بلا مرجع', withDoc((d) => d.replace(rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED'), rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED').replace('| decided | E45 |', '| proposal | X1 |'))), 'مرجعه «X1»');
expectFail('مقترح يحيل إلى قسم غير موجود', withDoc((d) => d.replace(rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED'), rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED').replace('| decided | E45 |', '| proposal | A99 |'))), 'يحيل إلى A99 ولا قسم له');
expectFail('مقترح يحيل إلى سؤال E غير موجود', withDoc((d) => d.replace(rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED'), rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED').replace('| decided | E45 |', '| proposal | E99 |'))), 'يحيل إلى E99 ولا صفّ له');
expectFail('مقترح يحيل إلى سؤال E محسوم في §٧-أ', withDoc((d) => d.replace(rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED'), rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED').replace('| decided | E45 |', '| proposal | E3 |'))), 'وله صفّ محسوم في §٧-أ: يجب أن يكون decided');

// ٣-ب وسوم التعليقات في الوحدة ⟷ وسوم الوثيقة (القاعدة 39: الحارس يتبع العقد؛ فلا يُرفع وسم في أحدهما)
expectFail('وسم يُخفض في الوثيقة وحدها (decided إلى proposal)', withDoc((d) => d.replace(rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED'), rowLine(d, 'EXCLUSION_STATE', 'EXCLUDED').replace('| decided | E45 |', '| proposal | A11 |'))),
    'tags: EXCLUSION_STATE.EXCLUDED وسمه في الوثيقة «proposal A11» وفي تعليق الوحدة «decided E45»');
expectFail('وسم يُغيَّر مصدره في الوحدة وحدها (decided E45 إلى E46)', {...real, moduleSource: real.moduleSource.replace('EXCLUDED: "excluded", // decided E45', 'EXCLUDED: "excluded", // decided E46')},
    'tags: EXCLUSION_STATE.EXCLUDED وسمه في الوثيقة «decided E45» وفي تعليق الوحدة «decided E46»');
expectFail('وسم يُخفض في الوحدة وحدها لقيم direction (decided إلى proposal)', {...real, moduleSource: real.moduleSource.replace('REPORT_TOO_HIGH: "report_too_high", // decided E46', 'REPORT_TOO_HIGH: "report_too_high", // proposal A15')},
    'tags: DISAGREEMENT_DIRECTION.REPORT_TOO_HIGH وسمه في الوثيقة «decided E46» وفي تعليق الوحدة «proposal A15»');
expectFail('وسم يُخفض في الوحدة وحدها (decided إلى proposal)', {...real, moduleSource: real.moduleSource.replace('NONE: "none", // decided E3', 'NONE: "none", // proposal E3')},
    'tags: MATCHED_BY.NONE وسمه في الوثيقة «decided E3» وفي تعليق الوحدة «proposal E3»');
expectFail('مصدر الوسم يتغيّر في الوحدة وحدها', {...real, moduleSource: real.moduleSource.replace('PROTOCOL_VERSION = 1; // decided E39', 'PROTOCOL_VERSION = 1; // decided E3')},
    'tags: PROTOCOL_VERSION وسمه في الوثيقة «decided E39» وفي تعليق الوحدة «decided E3»');
expectFail('مفتاح بلا وسم في تعليق الوحدة', {...real, moduleSource: real.moduleSource.replace('NONE: "none", // decided E3', 'NONE: "none",')}, 'tags: module MATCHED_BY.NONE بلا وسم في التعليق');
expectFail('ثابت مفرد بلا وسم في تعليق الوحدة', {...real, moduleSource: real.moduleSource.replace('CONSENT_TEXT_VERSION = 2; // decided E11', 'CONSENT_TEXT_VERSION = 2;')}, 'tags: CONSENT_TEXT_VERSION في الوثيقة ولا وسم له في تعليق الوحدة'); // (2026-10-23، القاعدة 23: كان = 1)
expectFail('وسم في الوحدة لمفتاح ليس في الوثيقة', {...real, moduleSource: real.moduleSource.replace('NONE: "none", // decided E3', 'NONE: "none", // decided E3\n  GHOST: "ghost", // decided E3')}, 'tags: MATCHED_BY.GHOST وسمه في تعليق الوحدة ولا صفّ له');

// ٣-ج صفوف §٧ الستّة والعشرون
const sec7Row = (d, id) => d.split('\n').find((l) => l.startsWith(`| ${id} |`));
expectFail('§٧: صفّ يُحذف من §٧-أ', withDoc((d) => d.replace(`${sec7Row(d, 'E36')}\n`, '')), 'section7: E36 لا صفّ له في §٧-أ');
expectFail('§٧: حالة «معتمد» تُحذف', withDoc((d) => d.replace(sec7Row(d, 'E36'), sec7Row(d, 'E36').replace(LABEL_APPROVED, '**مقترح 2026-10-15**'))), 'section7: E36 حالته ليست «**معتمد 2026-10-15**»');
expectFail('§٧: «بتعديل» تُمنح لصفّ لم يُعدَّل', withDoc((d) => d.replace(sec7Row(d, 'E36'), sec7Row(d, 'E36').replace(LABEL_APPROVED, LABEL_APPROVED_MODIFIED))), 'section7: E36');
expectFail('§٧: «بتعديل» تُحذف من صفّ مُعدَّل (E41)', withDoc((d) => d.replace(sec7Row(d, 'E41'), sec7Row(d, 'E41').replace(LABEL_APPROVED_MODIFIED, LABEL_APPROVED))), 'section7: E41 حالته ليست «**معتمد بتعديل 2026-10-15**»');
expectFail('§٧: الجهة الحاسمة تتبدّل (قرار المستخدم ⟵ المنسّق)', withDoc((d) => d.replace(sec7Row(d, 'E34'), sec7Row(d, 'E34').replace(`(${BY_USER})`, `(${BY_COORDINATOR})`))), 'section7: E34 الجهة الحاسمة ليست «قرار المستخدم»');
expectFail('§٧: الجهة الحاسمة تتبدّل (المنسّق ⟵ قرار المستخدم)', withDoc((d) => d.replace(sec7Row(d, 'E12'), sec7Row(d, 'E12').replace(`(${BY_COORDINATOR})`, `(${BY_USER})`))), 'section7: E12 الجهة الحاسمة ليست «حسمه المنسّق بإذن المستخدم»');
expectFail('§٧: صفّ ثانٍ خارج §٧-أ', withDoc((d) => d.replace(/(### ٧-ب[^\n]*\n)/, '$1\n| E3 | سؤال | حسم |\n')), 'section7: E3 له صفّ ثانٍ خارج §٧-أ');
// E44 (2026-10-16): «معتمد (أ)» في §٧-أ، وبلا صفّ في §٧-ب، واسم السبب مؤجَّل إلى P6-07
expectFail('E44: الصفّ يُحذف من §٧-أ', withDoc((d) => d.replace(`${sec7Row(d, 'E44')}\n`, '')), 'section7: E44 لا صفّ له في §٧-أ');
expectFail('E44: الحالة تعود مقترحاً', withDoc((d) => d.replace(sec7Row(d, 'E44'), sec7Row(d, 'E44').replace(LABEL_E44, '**مقترح، ينتظر المستخدم**'))), `section7: E44 حالته ليست «${LABEL_E44}»`);
expectFail('E44: الجهة الحاسمة تتبدّل', withDoc((d) => d.replace(sec7Row(d, 'E44'), sec7Row(d, 'E44').replace(`${LABEL_E44} (${BY_USER})`, `${LABEL_E44} (${BY_COORDINATOR})`))), `section7: E44 حالته ليست «${LABEL_E44}» بقرار المستخدم`);
expectFail('E44: تاريخ الاعتماد يتبدّل', withDoc((d) => d.replace(sec7Row(d, 'E44'), sec7Row(d, 'E44').replace(LABEL_E44, '**معتمد (أ) 2026-10-15**'))), `section7: E44 حالته ليست «${LABEL_E44}»`);
expectFail('E44: «نُفِّذ في أمر P6-07» تُحذف', withDoc((d) => d.replace(sec7Row(d, 'E44'), sec7Row(d, 'E44').replace(E44_EXECUTED, 'يُحسم لاحقاً'))), `section7: E44 لا يقول «${E44_EXECUTED}»`);
expectFail('E44: اسم السبب الجديد يُحذف من الصفّ', withDoc((d) => d.replace(sec7Row(d, 'E44'), sec7Row(d, 'E44').split(E44_REASON_NAME).join('X'))), `section7: E44 لا يسمّي السبب الجديد ${E44_REASON_NAME}`);
expectFail('E44: صفّ ثانٍ يعود إلى §٧-ب', withDoc((d) => d.replace(/(### ٧-ب[^\n]*\n)/, '$1\n| E44 | سؤال | حسم |\n')), 'section7: E44 له صفّ ثانٍ خارج §٧-أ');

// ٤-د سجلّ اعتماد التركية (E28)
const taRow = (d, text) => d.split('\n').find((l) => /^\| \d \| /.test(l) && l.includes(`| ${text} |`));
expectFail('سجلّ التركية: تاريخ مفقود', withDoc((d) => d.replace(taRow(d, 'Bu cihazda bu parça yok'), taRow(d, 'Bu cihazda bu parça yok').replace('| 2026-10-15 |', '|  |'))), 'TURKISH-APPROVALS الصفّ 2 تاريخه «»');
expectFail('سجلّ التركية: تاريخ بصيغة خاطئة', withDoc((d) => d.replace(taRow(d, 'Bu cihazda bu parça yok'), taRow(d, 'Bu cihazda bu parça yok').replace('| 2026-10-15 |', '| 15/10/2026 |'))), 'TURKISH-APPROVALS الصفّ 2 تاريخه «15/10/2026»');
expectFail('سجلّ التركية: غياب التاريخ يُخمَّن بدل أن يُعلَن', withDoc((d) => d.replace(taRow(d, 'Şarj yavaş oluyor'), taRow(d, 'Şarj yavaş oluyor').replace(`| ${NO_DATE_IN_SOURCE} |`, '| لاحقاً |'))), 'TURKISH-APPROVALS الصفّ 1 تاريخه «لاحقاً»');
expectFail('سجلّ التركية: صفّ #5 يُحذف وخانة ✓ باقية', withDoc((d) => d.replace(`${taRow(d, 'Şarj yavaş oluyor')}\n`, '')), 'خانة تركية موسومة «✓» في §٥-ج («Şarj yavaş oluyor») بلا صفّ في سجلّ §٥-د');
expectFail('سجلّ التركية: نصّ بخطأ حرفي', withDoc((d) => d.replace(taRow(d, 'Bu cihazda bu parça yok'), taRow(d, 'Bu cihazda bu parça yok').replace('| Bu cihazda bu parça yok |', '| Bu cihazda bu parca yok |'))), 'نصّه «Bu cihazda bu parca yok» لا يظهر في موضعه');
expectFail('سجلّ التركية: كتلة مفقودة', withDoc((d) => d.replace('<!-- TURKISH-APPROVALS:BEGIN -->', '')), 'الكتلة TURKISH-APPROVALS ظهرت 0 مرّة');
expectFail('سجلّ التركية: خانة فارغة', withDoc((d) => d.replace(taRow(d, 'Bu cihazda bu parça yok'), taRow(d, 'Bu cihazda bu parça yok').replace('| SD:10 |', '|  |'))), 'TURKISH-APPROVALS الصفّ 2 بخانة فارغة');
// صفّ الكتلة وصفّ تعديل thermal.good (2026-10-16)
const blockRowOf = (d) => d.split('\n').find((l) => /^\| \d \| /.test(l) && l.includes('`LEVEL-TEXT`') && l.includes('`SYMPTOM-TEXT`'));
const editRowOf = (d) => d.split('\n').find((l) => /^\| \d \| /.test(l) && l.includes('| `thermal.good` — '));
expectFail('سجلّ التركية: صفّ الكتلة يفقد تاريخه', withDoc((d) => mutateRow(d, blockRowOf(d), `| ${TURKISH_APPROVAL_DATE} |`, '| 2026-10-15 |')), '(صفّ كتلة) تاريخه «2026-10-15»');
expectFail('سجلّ التركية: صفّ الكتلة بلا تاريخ', withDoc((d) => mutateRow(d, blockRowOf(d), `| ${TURKISH_APPROVAL_DATE} |`, '|  |')), '(صفّ كتلة) تاريخه «»');
expectFail('سجلّ التركية: صفّ الكتلة يفقد نصّ المستخدم الأخير', withDoc((d) => mutateRow(d, blockRowOf(d), USER_REVIEW_SENTENCE, 'تمّت المراجعة.')), '(صفّ كتلة) بلا نصّ المستخدم الأخير بحرفه');
expectFail('سجلّ التركية: صفّ الكتلة لا يسمّي LEVEL-TEXT', withDoc((d) => mutateRow(d, blockRowOf(d), '`LEVEL-TEXT`', 'LEVEL-TEXT')), 'خانات تركية معتمدة في LEVEL-TEXT بلا صفّ كتلة');
expectFail('سجلّ التركية: صفّ الكتلة لا يسمّي SYMPTOM-TEXT', withDoc((d) => mutateRow(d, blockRowOf(d), '`SYMPTOM-TEXT`', 'SYMPTOM-TEXT')), 'خانات تركية معتمدة في SYMPTOM-TEXT بلا صفّ كتلة');
expectFail('سجلّ التركية: صفّ الكتلة يُحذف', withDoc((d) => d.replace(`${blockRowOf(d)}\n`, '')), 'خانات تركية معتمدة في LEVEL-TEXT بلا صفّ كتلة');
expectFail('سجلّ التركية: صفّ تعديل thermal.good يُحذف', withDoc((d) => d.replace(`${editRowOf(d)}\n`, '')), 'لا صفّ لتعديل thermal.good العربي');
expectFail('سجلّ التركية: صفّ التعديل بلا العربية القديمة', withDoc((d) => mutateRow(d, editRowOf(d), THERMAL_GOOD_AR_OLD, 'القديم')), 'خانة اعتماده بلا العربية القديمة أو الجديدة');
expectFail('سجلّ التركية: صفّ التعديل بلا العربية الجديدة', withDoc((d) => mutateRow(d, editRowOf(d), THERMAL_GOOD_AR_NEW, 'الجديد')), 'خانة اعتماده بلا العربية القديمة أو الجديدة');
expectFail('سجلّ التركية: صفّ التعديل يتبدّل تاريخه', withDoc((d) => mutateRow(d, editRowOf(d), `| ${TURKISH_APPROVAL_DATE} |`, '| 2026-10-15 |')), '(تعديل thermal.good) تاريخه «2026-10-15»');
expectFail('سجلّ التركية: تركية المثال في صفّ التعديل تتغيّر', withDoc((d) => mutateRow(d, editRowOf(d), 'duymuyorsunuz. |', 'duymuyorsunuz!! |')), 'خانته الثانية ليست تركية المثال');
// صفّ «ısınma» (2026-10-16)
const isiRowOf = (d) => d.split('\n').find((l) => /^\| \d \| /.test(l) && l.includes('`overall.intro`') && l.includes('`overall.excellent`'));
expectFail('سجلّ التركية: صفّ ısınma يُحذف', withDoc((d) => d.replace(`${isiRowOf(d)}\n`, '')), 'لا صفّ لتعديل «ısınma»');
expectFail('سجلّ التركية: صفّ ısınma يتبدّل تاريخه', withDoc((d) => mutateRow(d, isiRowOf(d), `| ${TURKISH_APPROVAL_DATE} |`, '| 2026-10-15 |')), '(ısınma) تاريخه «2026-10-15»');
expectFail('سجلّ التركية: صفّ ısınma بلا نصّ المستخدم في ısı', withDoc((d) => mutateRow(d, isiRowOf(d), ISINMA_USER_TEXT, 'تمّ.')), 'خانة اعتماده بلا نصّ المستخدم في «ısı» بحرفه');
expectFail('سجلّ التركية: صفّ ısınma بلا نصّ المستخدم في şarj yüzdesi', withDoc((d) => mutateRow(d, isiRowOf(d), CHARGE_PERCENT_USER_TEXT, 'تمّ.')), 'خانة اعتماده بلا نصّ المستخدم في «şarj yüzdesi» بحرفه');
expectFail('سجلّ التركية: خانة نصّ صفّ ısınma تتغيّر', withDoc((d) => mutateRow(d, isiRowOf(d), `| ${ISINMA_REGISTER_TR} |`, '| performans, ısı ve işlevler |')), '(ısınma) خانته الثانية ليست');
expectFail('من التصميم بمصدر غير مقبول', withDoc((d) => d.replace(rowLine(d, 'LINK_STATE', 'NONE'), rowLine(d, 'LINK_STATE', 'NONE').replace('P:487-492', 'E3'))), 'من التصميم ومصدره «E3»');

// الوحدة تتغيّر والوثيقة كما هي
expectFail('عَرَض: مفتاح يُحذف من الوحدة', withVocab((c) => { delete c.SYMPTOM.HEATS_FAST_IN_USE; }), 'doc→module: SYMPTOM.HEATS_FAST_IN_USE');
expectFail('عَرَض: مفتاح زائد في الوحدة', withVocab((c) => { c.SYMPTOM.GHOST = 'ghost_symptom'; }), 'module→doc: SYMPTOM.GHOST');
expectFail('عَرَض: NONE_NOTICED يخالف الثابت المفرد', withVocab((c) => { c.SYMPTOM.NONE_NOTICED = 'nothing_noticed'; }), 'SYMPTOM.NONE_NOTICED ≠ SYMPTOM_NONE_NOTICED');
expectFail('عَرَض: مفتاح عَرَض يدخل VALID_VISIBLE_DEFECTS', withVocab((c) => { c.SYMPTOM.BATTERY_SWOLLEN = 'water_damage'; }), 'مفتاح عَرَض (غير none_noticed) داخل VALID_VISIBLE_DEFECTS');
expectFail('عَرَض: المجموعة تُحذف من الوحدة', withVocab((c) => { delete c.SYMPTOM; }), 'module: SYMPTOM غائبة');
expectFail('قيمة في الوحدة تتغيّر', withVocab((c) => { c.SCAN_PURPOSE.NORMAL = 'regular'; }), 'قيمة SCAN_PURPOSE.NORMAL تختلف');
expectFail('مفتاح زائد في الوحدة', withVocab((c) => { c.LINK_STATE.GHOST = 'ghost'; }), 'module→doc: LINK_STATE.GHOST');
expectFail('مفتاح ناقص في الوحدة', withVocab((c) => { delete c.LINK_STATE.MISSING; }), 'doc→module: LINK_STATE.MISSING');
expectFail('مجموعة زائدة في الوحدة', withVocab((c) => { c.GHOST_GROUP = {A: 'a'}; }), 'module→doc: المجموعة GHOST_GROUP');
expectFail('مجموعة ناقصة في الوحدة', withVocab((c) => { delete c.PAIR_STATE; }), 'doc→module: المجموعة PAIR_STATE');
expectFail('ثابت مفرد يتغيّر في الوحدة', withVocab((c) => { c.PROTOCOL_VERSION = 3; }), 'قيمة الثابت PROTOCOL_VERSION تختلف');
expectFail('ثابت مفرد زائد في الوحدة', withVocab((c) => { c.GHOST_SCALAR = 5; }), 'module→doc: الثابت GHOST_SCALAR');
expectFail('ثابت مفرد ناقص في الوحدة', withVocab((c) => { delete c.CONSENT_TEXT_VERSION; }), 'doc→module: الثابت CONSENT_TEXT_VERSION');
expectFail('نوع الثابت يتغيّر', withVocab((c) => { c.PROTOCOL_VERSION = '1'; }), 'نوع الثابت PROTOCOL_VERSION');
expectFail('دالّة تُصدَّر', {...real, vocab: freezeAll({...clone(V), helper: () => 1})}, 'module: helper ليس ثابتاً');
expectFail('مصفوفة تُصدَّر', {...real, vocab: freezeAll({...clone(V), LIST: ['a']})}, 'module: LIST ليس ثابتاً');
expectFail('كائن غير مجمَّد', {...real, vocab: {...freezeAll(clone(V)), LOOSE: {A: 'a'}}}, 'module: LOOSE كائن غير مجمَّد');
expectFail('قيمة ليست نصّاً', withVocab((c) => { c.LINK_STATE.NONE = 5; }), 'module: LINK_STATE.NONE ليست نصّاً');
expectFail('قيمتان متطابقتان في مجموعة', withVocab((c) => { c.LINK_STATE.MISSING = 'none'; }), 'قيمتان متطابقتان في مجموعة واحدة');

// ما أُسقط يعود
expectFail('return تعود إلى SCAN_PURPOSE', withVocab((c) => { c.SCAN_PURPOSE.RETURN = 'return'; }), 'القيمة المُسقَطة «return» مُصدَّرة');
expectFail('returnRecords تعود مجموعةً', withVocab((c) => { c.PROTOCOL_COLLECTION.RETURN_RECORDS = 'returnRecords'; }), 'القيمة المُسقَطة «returnRecords» مُصدَّرة');
expectFail('return_not_working تعود', withVocab((c) => { c.SCAN_PURPOSE.RETURN_NOT_WORKING = 'return_not_working'; }), 'القيمة المُسقَطة «return_not_working» مُصدَّرة');
expectFail('batteryPairs يعود إلى PROTOCOL_PART', withVocab((c) => { c.PROTOCOL_PART.BATTERY_PAIRS = 'batteryPairs'; }), 'القيمة المُسقَطة «batteryPairs» مُصدَّرة');
expectFail('batteryBeforeAfter يعود باسمه القديم', withVocab((c) => { c.PROTOCOL_PART.BATTERY_BEFORE_AFTER = 'batteryPairs'; }), 'القيمة المُسقَطة «batteryPairs» مُصدَّرة');
expectFail('الاسم المعاد تسميته يُحذف من الوحدة', withVocab((c) => { delete c.PROTOCOL_PART.BATTERY_BEFORE_AFTER; }), 'doc→module: PROTOCOL_PART.BATTERY_BEFORE_AFTER');
expectFail('الاسم المعاد تسميته يُحذف من الوثيقة', withDoc((d) => d.replace(rowLine(d, 'PROTOCOL_PART', 'BATTERY_BEFORE_AFTER') + '\n', '')), 'module→doc: PROTOCOL_PART.BATTERY_BEFORE_AFTER');
expectFail('محسوم بمرجع صفّه ليس في §٧-أ', withDoc((d) => d.replace(rowLine(d, 'PROTOCOL_PART', 'BATTERY_BEFORE_AFTER'), rowLine(d, 'PROTOCOL_PART', 'BATTERY_BEFORE_AFTER').replace('| E42 |', '| E99 |'))), 'محسوم ومرجعه E99 ولا صفّ له في §٧-أ');
expectFail('محسوم بمرجع ليس E<n>', withDoc((d) => d.replace(rowLine(d, 'PROTOCOL_PART', 'BATTERY_BEFORE_AFTER'), rowLine(d, 'PROTOCOL_PART', 'BATTERY_BEFORE_AFTER').replace('| E42 |', '| P:787 |'))), 'محسوم ومرجعه «P:787» ليس E<n>');
expectFail('صفّ E42 يُحذف من §٧-أ', withDoc((d) => d.replace(/^\| E42 \|.*\n/m, '')), 'محسوم ومرجعه E42 ولا صفّ له في §٧-أ');
expectFail('الوثيقة تنسى ذكر batteryPairs', withDoc((d) => d.replace(/^\| `batteryPairs` .*\n/m, '')), 'batteryPairs غير مذكور في §٨-ج');
expectFail('الوثيقة تنسى ذكر المُسقَط', withDoc((d) => d.replace(/^\| `return_not_working` .*\n/m, '')), 'return_not_working غير مذكور في §٨-ج');

// مصدر الجلسة الواحد
expectFail('قيمة جلسة تُنسخ إلى الوحدة', withVocab((c) => { c.LINK_STATE.COPY = 'SESSION_COMPLETED'; }), 'نسخة من مفردات الجلسة');
expectFail('جدول الجلسة: قيمة تتغيّر', withDoc((d) => d.replace(/^\| `SESSION_STATUS` \| `EXPIRED` \| `expired` \|/m, '| `SESSION_STATUS` | `EXPIRED` | `lapsed` |')), 'قيمة SESSION_STATUS.EXPIRED');
expectFail('جدول الجلسة: صنف يتغيّر', withDoc((d) => d.replace(/^\| `SESSION_STATUS` \| `PENDING` \| `pending` \| active \|/m, '| `SESSION_STATUS` | `PENDING` | `pending` | terminal |')), 'صنف SESSION_STATUS.PENDING');
expectFail('جدول الجلسة: حالة تُحذف', withDoc((d) => d.replace(/^\| `SESSION_STATUS` \| `CANCELLED` .*\n/m, '')), 'SESSION_STATUS.CANCELLED في sessionNames.js وليس في الوثيقة');
expectFail('جدول الجلسة: سبب إلغاء يُحذف', withDoc((d) => d.replace(/^\| `CANCEL_REASON` \| `LEFT_BY_CUSTOMER` .*\n/m, '')), 'CANCEL_REASON.LEFT_BY_CUSTOMER في sessionNames.js وليس في الوثيقة');
expectFail('جدول الجلسة: حالة زائدة', withDoc((d) => d.replace('<!-- SESSION-VOCAB:END -->', '| `SESSION_STATUS` | `PAUSED` | `paused` | active |\n<!-- SESSION-VOCAB:END -->')), 'SESSION_STATUS.PAUSED في الوثيقة وليس في sessionNames.js');

// الوحدة تتحوّل إلى كود
expectFail('require في الوحدة', {...real, moduleSource: real.moduleSource.replace('"use strict";', '"use strict";\nconst x = require("./other");')}, 'تحمل require');
expectFail('دالّة سهمية في الوحدة', {...real, moduleSource: `${real.moduleSource}\nconst f = () => 1;`}, 'دالّة سهمية');
expectFail('function في الوحدة', {...real, moduleSource: `${real.moduleSource}\nfunction g() { return 1; }`}, 'تحمل function');
expectFail('console في الوحدة', {...real, moduleSource: `${real.moduleSource}\nconsole.log(1);`}, 'تحمل console');
expectFail('"use strict" يُحذف', {...real, moduleSource: real.moduleSource.replace('"use strict";', '')}, 'لا "use strict"');
// تعليق يحمل الكلمة لا يُفشل (الفحص على الشيفرة بلا تعليقات)
eq(verify({...real, moduleSource: `${real.moduleSource}\n// require() و function و => في تعليق\n`}).fails.length, 0, '[٨] تعليق يذكر require لا يُفشل (الفحص بلا تعليقات)');

// علاقات
expectFail('SETTABLE خارج SCAN_PURPOSE', withVocab((c) => { c.SETTABLE_SESSION_PURPOSE.NORMAL = 'plain'; }), 'SETTABLE_SESSION_PURPOSE ليست جزءاً من SCAN_PURPOSE');
expectFail('GRADE_OPTION بلا not_tested', withVocab((c) => { delete c.GRADE_OPTION.NOT_TESTED; }), 'GRADE_OPTION ≠ GRADE_LEVEL + not_tested');
expectFail('GRADE_OPTION تخالف VALID_RATINGS', withVocab((c) => { c.GRADE_LEVEL.FAIR = 'average'; c.GRADE_OPTION.FAIR = 'average'; }), 'GRADE_OPTION ≠ VALID_RATINGS');
expectFail('عيب ظاهر خارج القائمة القائمة', withVocab((c) => { c.VISIBLE_DEFECT.WATER_DAMAGE = 'water_trace'; }), 'VISIBLE_DEFECT خارج VALID_VISIBLE_DEFECTS');
expectFail('KEY_ABSENT يخالف الكود', withVocab((c) => { c.IDENTITY_STATE.KEY_ABSENT = 'KEY_MISSING'; }), 'IDENTITY_STATE.KEY_ABSENT ≠ UNUSABLE_REASON.KEY_ABSENT');
expectFail('SETTINGS_ABSENT بقيمتين', withVocab((c) => { c.REPEAT_NOT_ELIGIBLE_REASON.SETTINGS_ABSENT = 'SETTINGS_MISSING'; }), 'SETTINGS_ABSENT بقيمتين مختلفتين');
expectFail('none_noticed تتغيّر', withVocab((c) => { c.SYMPTOM_NONE_NOTICED = 'nothing'; }), 'SYMPTOM_NONE_NOTICED ≠ none_noticed');

// ربط «قبل/بعد صيانة» (2026-10-22): كل خلل مصطنع في أنواع العطل أو الأغراض أو رفوض الزوج يُفشل verify() بسببه (القاعدة 39)
expectFail('عطل: نوع سادس في الوحدة', withVocab((c) => { c.DEFECT_TYPE.OTHER = 'OTHER'; }), 'module→doc: DEFECT_TYPE.OTHER');
expectFail('عطل: نوع يُحذف من الوحدة', withVocab((c) => { delete c.DEFECT_TYPE.THERMAL; }), 'doc→module: DEFECT_TYPE.THERMAL');
expectFail('عطل: قيمة تتغيّر في الوحدة (أحرف صغيرة)', withVocab((c) => { c.DEFECT_TYPE.BATTERY = 'battery'; }), 'قيمة DEFECT_TYPE.BATTERY تختلف');
expectFail('عطل: صفّ يُحذف من الوثيقة', withDoc((d) => d.replace(`${rowLine(d, 'DEFECT_TYPE', 'MOTHERBOARD')}\n`, '')), 'module→doc: DEFECT_TYPE.MOTHERBOARD');
expectFail('عطل: نوع سادس في الوثيقة وحدها', withDoc((d) => d.replace(rowLine(d, 'DEFECT_TYPE', 'SOFTWARE'), `${rowLine(d, 'DEFECT_TYPE', 'SOFTWARE')}\n| \`DEFECT_TYPE\` | \`OTHER\` | \`OTHER\` | decided | E47 |`)), 'doc→module: DEFECT_TYPE.OTHER');
expectFail('عطل: وسم decided يُخفض في الوثيقة وحدها', withDoc((d) => d.replace(rowLine(d, 'DEFECT_TYPE', 'BATTERY'), rowLine(d, 'DEFECT_TYPE', 'BATTERY').replace('| decided | E47 |', '| proposal | A2 |'))), 'tags: DEFECT_TYPE.BATTERY وسمه في الوثيقة «proposal A2» وفي تعليق الوحدة «decided E47»');
expectFail('عطل: وسم decided مرجعه صفّ غير موجود', withDoc((d) => d.replace(rowLine(d, 'DEFECT_TYPE', 'BATTERY'), rowLine(d, 'DEFECT_TYPE', 'BATTERY').replace('| decided | E47 |', '| decided | E99 |'))), 'محسوم ومرجعه E99 ولا صفّ له في §٧-أ');
expectFail('عطل: صفّ E47 يُحذف من §٧-أ', withDoc((d) => d.replace(/^\| E47 \|.*\n/m, '')), 'محسوم ومرجعه E47 ولا صفّ له في §٧-أ');
expectFail('غرض: maintenance_after يتغيّر في الوحدة', withVocab((c) => { c.SCAN_PURPOSE.MAINTENANCE_AFTER = 'maintenance_post'; }), 'قيمة SCAN_PURPOSE.MAINTENANCE_AFTER تختلف');
expectFail('غرض: المختار يتغيّر في الوحدة', withVocab((c) => { c.SETTABLE_SESSION_PURPOSE.MAINTENANCE_BEFORE = 'maintenance_pre'; }), 'قيمة SETTABLE_SESSION_PURPOSE.MAINTENANCE_BEFORE تختلف');
expectFail('غرض: المختار يخرج عن SCAN_PURPOSE', withVocab((c) => { c.SETTABLE_SESSION_PURPOSE.MAINTENANCE_BEFORE = 'maintenance_pre'; c.SCAN_PURPOSE.MAINTENANCE_BEFORE = 'maintenance_pre_x'; }), 'SETTABLE_SESSION_PURPOSE ليست جزءاً من SCAN_PURPOSE');
expectFail('غرض: battery_before تعود إلى المختار', withVocab((c) => { c.SETTABLE_SESSION_PURPOSE.BATTERY_BEFORE = 'battery_before'; }), 'module→doc: SETTABLE_SESSION_PURPOSE.BATTERY_BEFORE');
expectFail('غرض: صفّ maintenance_before يُحذف من الوثيقة', withDoc((d) => d.replace(`${rowLine(d, 'SETTABLE_SESSION_PURPOSE', 'MAINTENANCE_BEFORE')}\n`, '')), 'module→doc: SETTABLE_SESSION_PURPOSE.MAINTENANCE_BEFORE');
expectFail('غرض: وسم proposal يُرفع في الوحدة وحدها', {...real, moduleSource: real.moduleSource.replace('MAINTENANCE_BEFORE: "maintenance_before", // proposal A2', 'MAINTENANCE_BEFORE: "maintenance_before", // decided E47')}, 'وسمه في الوثيقة «proposal A2» وفي تعليق الوحدة «decided E47»');
expectFail('رفض: رمز يتغيّر في الوحدة', withVocab((c) => { c.PURPOSE_REFUSAL.DEFECT_TYPE_INVALID = 'DEFECT_TYPE_BAD'; }), 'قيمة PURPOSE_REFUSAL.DEFECT_TYPE_INVALID تختلف');
expectFail('رفض: رمز زائد في PAIR_CALL_REFUSAL', withVocab((c) => { c.PAIR_CALL_REFUSAL.GHOST = 'PAIR_GHOST'; }), 'module→doc: PAIR_CALL_REFUSAL.GHOST');
expectFail('رفض: رمز يُحذف من الوثيقة', withDoc((d) => d.replace(`${rowLine(d, 'PAIR_CALL_REFUSAL', 'PART_NOT_ENABLED')}\n`, '')), 'module→doc: PAIR_CALL_REFUSAL.PART_NOT_ENABLED');
expectFail('رفض: BEFORE_WRONG_DEFECT_TYPE يُحذف من الوحدة', withVocab((c) => { delete c.PAIR_LINK_REFUSAL.BEFORE_WRONG_DEFECT_TYPE; }), 'doc→module: PAIR_LINK_REFUSAL.BEFORE_WRONG_DEFECT_TYPE');
expectFail('رفض: proposal يحيل إلى قسم A3 غير موجود', withDoc((d) => d.replace('### A3 — P6-05 ربط', '### A9X — P6-05 ربط')), 'يحيل إلى A3 ولا قسم له في §٢');
expectFail('رفض: رمز يصطدم بمفردات الجلسة', withVocab((c) => { c.PAIR_CALL_REFUSAL.NOT_AUTHENTICATED = 'SESSION_NOT_FOUND'; }), 'نسخة من مفردات الجلسة');
// الحارس البنيوي
{
  const collection = V.PROTOCOL_COLLECTION.SCAN_PROTOCOL;
  expectFail('اسم مجموعة حرفي بمزدوجتين في src', {...real, srcFiles: {...real.srcFiles, 'analysis/analyzeDevice.js': `${real.srcFiles['analysis/analyzeDevice.js']}\ndb.collection("${collection}");`}}, `اسم المجموعة «${collection}»`);
  expectFail('اسم مجموعة حرفي بمفردة في src', {...real, srcFiles: {...real.srcFiles, 'sessions/createScanSession.js': `${real.srcFiles['sessions/createScanSession.js']}\ndb.collection('${V.PROTOCOL_COLLECTION.TECHNICIAN_FORMS}');`}}, `اسم المجموعة «${V.PROTOCOL_COLLECTION.TECHNICIAN_FORMS}»`);
  expectFail('اسم مجموعة حرفي في index.js', {...real, srcFiles: {...real.srcFiles, '../index.js': `${real.srcFiles['../index.js']}\nx = \`${V.PROTOCOL_COLLECTION.PROTOCOL_PENDING}\`;`}}, `اسم المجموعة «${V.PROTOCOL_COLLECTION.PROTOCOL_PENDING}»`);
  const {[MODULE_REL]: _omit, ...withoutModule} = real.srcFiles;
  expectFail('الوحدة خارج المسح', {...real, srcFiles: withoutModule}, 'الوحدة نفسها غير ضمن الملفّات الممسوحة');
  expectFail('مسح ناقص', {...real, srcFiles: {[MODULE_REL]: real.moduleSource}}, 'المسح ناقص');
  eq(verify({...real, srcFiles: {...real.srcFiles, 'analysis/analyzeDevice.js': `${real.srcFiles['analysis/analyzeDevice.js']}\n// "${collection}" في تعليق`}}).fails.filter((f) => f.startsWith('src:')).length, 1,
      '[٨] الحارس يمسح النصّ الخام: اسم مجموعة بين علامات اقتباس في تعليق يُعدّ مخالفة (صراحةً — لا يُنظَّف التعليق، فيُعاد صوغ التعليق إن لزم)');
}

console.log(`\nprotocolVocabulary.test.js: ${n}/${n} assertions passed`);
console.log(`  الوثيقة: ${base.stats.docGroups} مجموعة، ${base.stats.docEntries} مفتاحاً (وسم design=${base.stats.design}، proposal=${base.stats.proposal}، decided=${base.stats.decided} للمفاتيح والثوابت معاً)، ${base.stats.docScalars} ثوابت مفردة`);

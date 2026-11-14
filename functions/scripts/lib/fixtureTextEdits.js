'use strict';

// ===================================================================
// fixtureTextEdits — مصدر واحد لاستبدالات النصوص التي تُزيل أرقاماً محجوبة من
// ردود النموذج المصنوعة/المشتقّة (أمر مستخدم 2026-10-06، D6: "فلا يستشهد أيٌّ
// منها برقم محجوب"). يستهلكه كل مولّد/مصلِّح لتلك الملفّات — لا نسخة ثانية
// من العبارات (القاعدة 24 في تعريف الوكيل).
//
// كل استبدال: {path, from, to}. يتوقّف (يرمي) إن لم يجد `from` **مرّة واحدة
// بالضبط** في الحقل — لا استبدال صامت لنصّ غير متوقَّع. التحقّق من النتيجة
// بـscripts/audit-fixtures-hidden-number-citations.js (مصدر «محجوب» = حمولة
// ما قبل الإخفاء مقابل الحمولة الحالية).
// ===================================================================

/**
 * @param {Object} obj ردّ النموذج المحلَّل (يُعدَّل في المكان — مرِّر نسخة عميقة)
 * @param {string} p مسار: narrative.summary|details|verdict · narrative.buyerAdvice.X ·
 *   narrative.issueDescriptions[ID] · crossChecks[i].description · adjustments[i].reason ·
 *   modelObservations[i].text
 * @return {{get: function(): *, set: function(string): void}}
 */
function accessor(obj, p) {
  let m;
  if ((m = p.match(/^crossChecks\[(\d+)\]\.description$/))) {
    return {get: () => obj.crossChecks[+m[1]].description, set: (v) => { obj.crossChecks[+m[1]].description = v; }};
  }
  if ((m = p.match(/^adjustments\[(\d+)\]\.reason$/))) {
    return {get: () => obj.adjustments[+m[1]].reason, set: (v) => { obj.adjustments[+m[1]].reason = v; }};
  }
  if ((m = p.match(/^modelObservations\[(\d+)\]\.text$/))) {
    return {get: () => obj.modelObservations[+m[1]].text, set: (v) => { obj.modelObservations[+m[1]].text = v; }};
  }
  if ((m = p.match(/^narrative\.issueDescriptions\[(.+)\]$/))) {
    return {get: () => obj.narrative.issueDescriptions[m[1]], set: (v) => { obj.narrative.issueDescriptions[m[1]] = v; }};
  }
  if ((m = p.match(/^narrative\.buyerAdvice\.(\w+)$/))) {
    return {get: () => obj.narrative.buyerAdvice[m[1]], set: (v) => { obj.narrative.buyerAdvice[m[1]] = v; }};
  }
  if ((m = p.match(/^narrative\.(summary|details|verdict)$/))) {
    return {get: () => obj.narrative[m[1]], set: (v) => { obj.narrative[m[1]] = v; }};
  }
  throw new Error(`fixtureTextEdits: مسار غير مدعوم: ${p}`);
}

function applyTextEdits(obj, edits, label, opts) {
  const allowAlreadyApplied = !!(opts && opts.allowAlreadyApplied);
  for (const {path: p, from, to} of edits) {
    const acc = accessor(obj, p);
    const text = acc.get();
    // إعادة تشغيل على ملفّ مصنوع حُدِّث في مكانه سابقاً: غياب from مع حضور to مرّة واحدة = طُبِّق (لا صمت على غيره)
    if (allowAlreadyApplied && typeof text === 'string' && !text.includes(from) &&
        to.length > 0 && text.split(to).length - 1 === 1) continue;
    if (typeof text !== 'string' || !text.includes(from)) {
      throw new Error(`${label || 'fixtureTextEdits'}: توقّف — النصّ المتوقَّع غير موجود في ${p}: ${JSON.stringify(from)}`);
    }
    if (text.split(from).length - 1 !== 1) {
      throw new Error(`${label || 'fixtureTextEdits'}: توقّف — النصّ ${JSON.stringify(from)} يتكرّر أكثر من مرّة في ${p}، الاستبدال غير آمن`);
    }
    acc.set(text.split(from).join(to));
  }
  return obj;
}

// ─── عائلة b45c8cf6 — النصّ الأصلي نفسه حرفياً في: derived-…-adjustments-usersettings-fix،
// وfrozen-fake-…-cpu-down-c06…، وfrozen-fake-…-security-down-sec04… ────────────
// الأرقام المحجوبة هنا (مصدرها، مُتحقَّق بالأداة audit-fixtures-hidden-number-citations.js):
//   0.69/0.85/0.714 ← findings.sustainedCeiling.phase5/phase3.meanWindowMaxRatio/recoveryPhase7Ratio
//   0.575 ← findings.graphics.ratioPhase5OverPhase4 ·
//   3778.29/0.8587 ← categoryStates…BAT-FCC.value/.ratioToDesign
// 4400 يبقى (B-02 في testResults — مواصفة موجودة في الحمولة فعلاً).
const B45_FAMILY_COMMON = Object.freeze([
  {path: 'narrative.details',
    from: 'عند 0.69 من الذروة في الطور الخامس مقابل 0.85 في الطور الثالث، ونسبة استعادة 0.714 في الطور السابع',
    to: 'ينخفض في الطور الخامس عنه في الطور الثالث، مع استعادة جزئية في الطور السابع'},
  {path: 'narrative.details',
    from: 'ونسبة أداء الطور الخامس إلى الرابع 0.575.',
    to: 'وأداء الطور الخامس أقلّ منه في الطور الرابع.'},
  {path: 'narrative.details',
    from: 'سعة مقيسة 3778.29 مقابل سعة تصميمية 4400 وبنسبة إلى التصميم 0.8587',
    to: 'سعة مقيسة مقابل سعة تصميمية 4400'},
  {path: 'narrative.buyerAdvice.gamer', from: 'لم يتجاوز 0.69 من الذروة', to: 'لم يبقَ قريباً من الذروة'},
  {path: 'narrative.buyerAdvice.gamer', from: 'هبط إلى 0.575 من الطور الرابع', to: 'هبط عن مستواه في الطور الرابع'},
  {path: 'crossChecks[3].description',
    from: 'مع سعة مقيسة 3778.29 مقابل سعة التصميم المعلَنة',
    to: 'مع سعة مقيسة مقابل سعة التصميم المعلَنة'},
]);
// طبقة أمر 2026-10-06 (المبدأ — findings.channels/findings.thermal + مجموعة UNSTABLE تصل بحالتها وحدها +
// أرقام صارت بلا مصدر أصلاً: 45→46 تغطية، 33.3 تغطية gps قديمة، 61.7 عمر رقعة (نصّ داخل source بوّابة لا ورقة رقمية)).
const B45_FAMILY_TREE_2026_10_06 = Object.freeze([
  {path: 'narrative.summary', from: 'لكن التقرير جزئي بتغطية 45%', to: 'لكن التقرير جزئي بتغطية 46%'},
  {path: 'narrative.verdict', from: 'تقييم جزئي بتغطية 45%', to: 'تقييم جزئي بتغطية 46%'},
  {path: 'narrative.buyerAdvice.casual', from: 'وتذكّر أن التغطية 45% فقط', to: 'وتذكّر أن التغطية 46% فقط'},
  {path: 'crossChecks[1].description', from: 'تغطية الفحص العامة 45% تفسّرها', to: 'تغطية الفحص العامة 46% تفسّرها'},
  {path: 'crossChecks[1].description', from: 'نفّذ اختباراً واحداً من 3 (تغطية 33.3%) لأن', to: 'لم يُقَس لأن'},
  {path: 'crossChecks[0].description', from: 'رقعة أمان عمرها 61.7 شهراً بتاريخ', to: 'رقعة أمان قديمة بتاريخ'},
  {path: 'crossChecks[2].description',
    from: 'وسيط حرارة البطارية في طور الانفجار 39.3 درجة، والارتفاع الكلي 6.9 درجة بمعدل 1.85 درجة/دقيقة على مدى الفحص',
    to: 'حرارة البطارية تتغيّر في طور الانفجار وعلى مدى الفحص'},
  {path: 'crossChecks[3].description', from: 'نزل الشحن من 48 إلى 43 خلال الفحص', to: 'نزل الشحن خلال الفحص'},
  {path: 'narrative.buyerAdvice.gamer', from: 'حرارة البطارية وصلت 39.3 درجة أثناء الحمل', to: 'حرارة البطارية ارتفعت أثناء الحمل'},
  {path: 'narrative.details', from: 'واستقرار 8.1%', to: 'واستقرار مقيس'},
  {path: 'narrative.details', from: 'وقراءة 1618 MB/s', to: 'وقراءة مقيسة'},
  {path: 'narrative.details',
    from: 'وارتفاع حرارة 6.9 درجة بمعدل 1.85 درجة/دقيقة، ووسيط حرارة البطارية 39.3 أثناء طور الانفجار، مع نزول الشحن من 48 إلى 43 خلال الفحص',
    to: 'وارتفاع حرارة البطارية ونزول الشحن مقيسان خلال الفحص'},
  {path: 'modelObservations[0].text',
    from: 'مذكورة بـ 1618 MB/s، بينما أعلى قيمة ظهرت في قناة معدّل نقل التخزين أثناء طور التخزين هي 182.93 MB/s، والاختبار نفسه',
    to: 'مذكورة بقيمة مقيسة، والاختبار نفسه'},
]);
const B45_ADJ_CPU_SUSTAINED = Object.freeze([
  {path: 'adjustments[0].reason',
    from: 'ينزل إلى 0.69 من الذروة في الطور الخامس مقابل 0.85 في الطور الثالث، ونسبة الاستعادة بعد الحمل 0.714',
    to: 'ينزل في الطور الخامس عنه في الطور الثالث، مع استعادة جزئية بعد الحمل'},
]);
const B45_ADJ_GPU_SUSTAINED = Object.freeze([
  {path: 'adjustments[1].reason',
    from: 'يهبط إلى 0.575 من مستوى الطور الرابع في الطور الخامس حسب النسبة المقيسة',
    to: 'يهبط في الطور الخامس عن مستوى الطور الرابع حسب القياس'},
]);

// ─── derived-…-envelope-b45c8cf6-accepted (نصّ مستقلّ، نفس الجهاز) ────────────
// 3265 ← findings.advisoryMeasurements.S-06.rawValue (+ evidence)؛ 132.79/1691.67/46.04 ← BAT-R-APPARENT.value ·
// findings.battery.info.dischargeRateUnderLoadMa/voltageStabilityMv؛ 2065.37/1187.86/0.575 ← findings.graphics.*؛
// 3778.29/0.8587 ← BAT-FCC؛ 1.854 ← findings.thermal.batteryTempRise.ratePerMinPhases345 (صار 1.85 بالتقريب،
// البند ٣ من 2026-10-01 — الرقم بثلاث منازل لم يعد في الحمولة).
const B45_ACCEPTED_EDITS = Object.freeze([
  {path: 'narrative.details',
    from: 'السعة المقيسة 3778.29 mAh مقابل سعة تصميم 4400 mAh بنسبة 0.8587، ومقاومة ظاهرة 132.79 mΩ، وتيار تفريغ تحت الحمل 1691.67 mA، وثبات جهد 46.04 mV',
    to: 'السعة المقيسة مقابل سعة تصميم 4400 mAh، والمقاومة الظاهرة وتيار التفريغ تحت الحمل وثبات الجهد مقيسة بلا عتبة معايَرة'},
  {path: 'narrative.details',
    from: 'هبوطاً من وسيط 2065.37 في المرحلة الرابعة إلى 1187.86 في المرحلة الخامسة بنسبة 0.575',
    to: 'هبوطاً في الوسيط من المرحلة الرابعة إلى المرحلة الخامسة'},
  {path: 'narrative.details', from: 'وكتابة عشوائية 3265 IOPS', to: 'وكتابة عشوائية مقيسة بلا حكم عليها'},
  {path: 'narrative.details', from: 'ارتفاعاً 6.9°C خلال الفحص بمعدّل 1.854°C/min', to: 'ارتفاعاً خلال الفحص'},
  {path: 'narrative.buyerAdvice.gamer',
    from: 'هبوطاً في أداء الرسوميات من 2065.37 إلى 1187.86 بنسبة 0.575',
    to: 'هبوطاً في أداء الرسوميات بين الطورين الرابع والخامس'},
  {path: 'narrative.issueDescriptions[POS-storage]', from: 'كتابة عشوائية 3265 IOPS', to: 'كتابة عشوائية مقيسة بلا حكم عليها'},
  {path: 'crossChecks[0].description',
    from: 'هبوطاً من وسيط 2065.37 إلى 1187.86 بنسبة 0.575 بين المرحلتين',
    to: 'هبوطاً في الوسيط بين المرحلتين'},
  {path: 'crossChecks[2].description', from: 'ارتفاعاً 6.9°C بمعدّل 1.854°C/min', to: 'ارتفاعاً'},
  {path: 'adjustments[0].reason',
    from: 'هبوط أداء الرسوميات من وسيط 2065.37 إلى 1187.86 بنسبة 0.575 بين المرحلتين',
    to: 'هبوط أداء الرسوميات في الوسيط بين المرحلتين'},
  {path: 'modelObservations[0].text',
    from: 'نسبة السعة المقيسة إلى سعة التصميم 0.8587، والمقاومة الظاهرة مقيسة بلا عتبة معايَرة',
    to: 'السعة المقيسة والمقاومة الظاهرة مقيستان بلا عتبة معايَرة'},
  // ─── طبقة أمر 2026-10-06 (المبدأ) ───
  {path: 'narrative.summary', from: 'بتغطية 45% من الفئات', to: 'بتغطية 46% من الفئات'},
  {path: 'narrative.verdict', from: 'تقييم جزئي بتغطية 45%', to: 'تقييم جزئي بتغطية 46%'},
  {path: 'narrative.details', from: 'ونظام تحديد المواقع جزئي بتغطية 33.3%', to: 'ونظام تحديد المواقع غير مقيس'},
  {path: 'narrative.details', from: 'وقراءة 1618 MB/s وقراءة عشوائية 110516 IOPS', to: 'وقراءة مقيسة وقراءة عشوائية مقيسة'},
  {path: 'narrative.buyerAdvice.gamer', from: 'مع ارتفاع حرارة البطارية 6.9°C وبلوغ', to: 'مع ارتفاع حرارة البطارية وبلوغ'},
  {path: 'narrative.buyerAdvice.photographer', from: 'بسرعة كتابة 188 MB/s وقراءة 1618 MB/s', to: 'بسرعة كتابة 188 MB/s وقراءة مقيسة'},
  {path: 'narrative.issueDescriptions[POS-storage]', from: 'قراءة 1618 MB/s، قراءة عشوائية 110516 IOPS', to: 'قراءة مقيسة، قراءة عشوائية مقيسة'},
  {path: 'modelObservations[1].text',
    from: '(C-04 عند 3271 MFLOPS، S-04 عند 1618 MB/s، S-05 عند 110516 IOPS، C-03 عند 2.14 GHz) — أرقام حقيقية لكن مصنّفة غير حاسمة',
    to: '(C-04 وS-04 وS-05 وC-03) — قياسات مقيسة لكنها مصنّفة غير حاسمة'},
]);

// ─── derived-…-envelope-34dff2b8-accepted ──────────────────────────────────
// 0.8483/0.7016/0.7806/0.7143 ← findings.sustainedCeiling.*؛ 1920.3/1083.5/0.5642/0.8536/530 ← findings.graphics.*؛
// 2597 ← findings.advisoryMeasurements.S-06.rawValue (+ evidence)؛ 3782.75/0.8597 ← BAT-FCC.value/.ratioToDesign؛
// 139.91/1647.85/46.46/1.57 ← findings.battery.qIntMah/info.dischargeRateUnderLoadMa/voltageStabilityMv/rho.
const D34_ACCEPTED_EDITS = Object.freeze([
  {path: 'narrative.details',
    from: 'ونِسَب أقصى نافذة 0.8483 في الطور الثالث، و0.7016 في الطور الخامس، و0.7806 مجمّعة، و0.7143 في طور الاستعادة',
    to: 'ونِسَب أقصى نافذة مقيسة في الطورين الثالث والخامس ومجمّعة وفي طور الاستعادة'},
  {path: 'narrative.details',
    from: 'وسيطاً 1920.3 في الطور الرابع و1083.5 في الطور الخامس بنسبة 0.5642 بينهما، ونسبة انزياح 0.8536 في الطور الرابع، وصفر قفل تزامن عند 60 و90 و120 في 530 عيّنة',
    to: 'هبوطاً في الوسيط بين الطورين الرابع والخامس، وصفر قفل تزامن عند 60 و90 و120'},
  {path: 'narrative.details', from: 'كتابة عشوائية 2597 IOPS', to: 'كتابة عشوائية مقيسة بلا حكم عليها'},
  {path: 'narrative.details', from: 'وسعة فعلية 3782.75 mAh بنسبة 0.8597 من التصميم', to: 'وسعة فعلية مقيسة'},
  {path: 'narrative.details', from: 'وتكامل شحنة 139.91 mAh', to: 'وتكامل شحنة مقيس'},
  {path: 'narrative.details', from: 'وتيار تفريغ تحت الحمل 1647.85 mA', to: 'وتيار تفريغ تحت الحمل مقيس'},
  {path: 'narrative.details', from: 'وانحراف جهد 46.46 mV', to: 'وانحراف جهد مقيس'},
  {path: 'narrative.details', from: 'ومعامل 1.57 يتغيّر', to: 'ومعامل مقيس يتغيّر'},
  {path: 'narrative.buyerAdvice.gamer', from: 'هبط الوسيط من 1920.3 إلى 1083.5 بنسبة 0.5642', to: 'هبط الوسيط بين الطورين الرابع والخامس'},
  {path: 'narrative.buyerAdvice.gamer',
    from: 'يسجّل نسبة مرتفعة ثم 0.7016 و0.7143 عند الاستعادة',
    to: 'يسجّل نسباً مقيسة عند الاستعادة'},
  {path: 'narrative.buyerAdvice.photographer', from: 'عند 2597 IOPS', to: 'عند مستوى مقيس'},
  {path: 'crossChecks[2].description',
    from: '(وسيط 1920.3 في الطور الرابع، و1083.5 في الطور الخامس، ونسبة 0.5642 بينهما، وصفر قفل تزامن في عيّنات القياس)',
    to: '(وسيط الرسوميات يهبط بين الطورين الرابع والخامس، وصفر قفل تزامن في عيّنات القياس)'},
  {path: 'crossChecks[4].description', from: 'مع تنبيه كتابة عشوائية 2597 IOPS', to: 'مع تنبيه كتابة عشوائية'},
  {path: 'modelObservations[0].text',
    from: 'نِسَب أقصى نافذة مرتفعة ثم 0.7016 و0.7806 مجمّعة مع استعادة 0.7143',
    to: 'نِسَب أقصى نافذة مقيسة مجمّعة ومع استعادة'},
  {path: 'modelObservations[1].text',
    from: 'سعة فعلية 3782.75 mAh بنسبة غير محكومة بعتبة معايَرة من السعة التصميمية',
    to: 'سعة فعلية مقيسة مقابل السعة التصميمية'},
  // ─── طبقة أمر 2026-10-06 (المبدأ — channels/thermal/UNSTABLE + أرقام بلا مصدر) ───
  {path: 'narrative.details', from: 'وS-04 قراءة 2359 MB/s، وS-05 قراءة عشوائية 98932 IOPS', to: 'وS-04 قراءة مقيسة، وS-05 قراءة عشوائية مقيسة'},
  {path: 'narrative.details', from: '43% إلى 38% خلال الفحص', to: 'مستوى الشحن خلال الفحص'},
  {path: 'narrative.details',
    from: 'ومتوسط مرحلة الاندفاع 40.09 °C (وسيط 40.2 وأقصى 40.2)، وارتفاع 7.4 °C بمعدل 1.73 °C/دقيقة',
    to: 'ومتوسط مرحلة الاندفاع مقيس، وارتفاع 7.4 °C'},
  {path: 'narrative.buyerAdvice.gamer',
    from: 'فقط: 40.09 °C وسطياً في مرحلة الاندفاع بمعدل ارتفاع 1.73 °C/دقيقة.',
    to: 'فقط، وهي مقيسة ولا يُحكم بها.'},
  {path: 'crossChecks[0].description', from: 'ورقعة أمنية عمرها 61.7 شهراً', to: 'ورقعة أمنية قديمة'},
  {path: 'crossChecks[1].description', from: 'نظام تحديد المواقع بتغطية 33.3%', to: 'نظام تحديد المواقع'},
  {path: 'crossChecks[3].description',
    from: 'ومتوسط 40.09 °C (وسيط 40.2) في مرحلة الاندفاع، وارتفاع 7.4 °C بمعدل 1.73 °C/دقيقة',
    to: 'ومتوسط مقيس في مرحلة الاندفاع، وارتفاع 7.4 °C'},
  {path: 'crossChecks[4].description', from: 'قراءة 2359 MB/s وقراءة عشوائية 98932 IOPS', to: 'قراءة مقيسة وقراءة عشوائية مقيسة'},
]);

// ─── طبقة أمر 2026-10-07 (قرار القوائم) ─────────────────────────────────────────────────────────────
// حُجبت قيم S-02 (31.3% و71.5 GB) وR-02 (2.7 أو 2.6 GB) وB-02 (4400 mAh) وB-03 (32.4/32.8 °C) عن حمولة النموذج، فلا يستشهد
// بها ملفّ. وعبارتان مضمَّنتان بلا سند في الحمولة منذ حجب findings.thermal/channels لكن قيمتاهما تصادفان رقماً حاضراً فلا يكشفهما
// التدقيق الرقمي وحده: «7.4 °C» ارتفاع حرارة البطارية (تصادف C-06=7.4) و«43%» مستوى الشحن (تصادف 43 Mbps) — تُزالان أيضاً.
// المشتقّات تُكتب نسخة جديدة موسومة (-v3-2026-10-07، D6)؛ الصناعيّان يُحدَّثان في مكانهما.
const B45_FAMILY_TREE_2026_10_07 = Object.freeze([
  {path: 'narrative.details', from: 'بإجمالي 7.1 مقابل متاح 2.7،', to: 'بإجمالي 7.1 ومتاح مقيس،'},
  {path: 'narrative.details', from: 'ومساحة متاحة 31.3% أي 71.5 وسرعة كتابة', to: 'ومساحة متاحة مقيسة وسرعة كتابة'},
  {path: 'narrative.details', from: 'سعة مقيسة مقابل سعة تصميمية 4400، وارتفاع', to: 'سعة مقيسة مقابل سعة تصميمية مقيسة، وارتفاع'},
  {path: 'narrative.buyerAdvice.photographer', from: 'والمساحة المتاحة 71.5 أي 31.3% فقط', to: 'والمساحة المتاحة مقيسة'},
  {path: 'narrative.buyerAdvice.photographer', from: '، وهو ضيق نسبي لمن يصوّر فيديو بجودة عالية.', to: '.'},
]);
const B45_ACCEPTED_TREE_2026_10_07 = Object.freeze([
  {path: 'narrative.details', from: 'ومنها 2.7 GB متاحة', to: 'والمتاح منها مقيس'},
  {path: 'narrative.details', from: 'والمتاح 31.3% أي 71.5 GB، مع سرعة', to: 'والمتاح مقيس، مع سرعة'},
  {path: 'narrative.details', from: 'سعة تصميم 4400 mAh، والمقاومة', to: 'سعة تصميم مقيسة، والمقاومة'},
  {path: 'narrative.buyerAdvice.photographer', from: 'والمستخدم 31.3% فقط أي 71.5 GB متاحة،', to: 'والمساحة المتاحة مقيسة،'},
  {path: 'narrative.issueDescriptions[POS-memory]', from: '(7.1 GB إجمالي، 2.7 GB متاح)', to: '(7.1 GB إجمالي، والمتاح مقيس)'},
  {path: 'modelObservations[0].text', from: 'وحرارة البطارية 32.4°C — بيانات', to: 'وحرارة البطارية مقيسة — بيانات'},
]);
// ─── طبقة قرار 2026-10-07 (وسم «غير مستقرّ» لا يصل النموذج: «تُحذف findings.unstableMeasurements كلّها» و«يُحذف حقل unstable من كل اختبار») ───
// الملاحظة modelObservations[1] في ردّ b45c8cf6 كتب فيها النموذج «وُسمت UNSTABLE… مصنّفة غير حاسمة وفق معيار الاتساق» — وصفٌ جاء من الوسم نفسه الذي لم يعد يصل
// النموذج. والحارس الآن يرى «UNSTABLE» تسرّباً لاتينياً (كان يُعفيها لأن findings.unstableMeasurements تحملها اسمَ حقل) فيرفض الملفّ. يُحذف الوصف المأخوذ من الوسم
// وحده (الكلمة وعبارة «مصنّفة غير حاسمة وفق معيار الاتساق»)؛ وبقيّة الجملة (أربعة قياسات لم تدخل الحرف ولا قائمة الأعطاب) كما هي. evidenceRefs لا تُمسّ (حقل منظَّم لا نصّ).
const B45_ACCEPTED_UNSTABLE_LABEL_2026_10_07 = Object.freeze([
  {path: 'modelObservations[1].text',
    from: 'أربعة قياسات وُسمت UNSTABLE ولم تدخل الحرف ولا قائمة الأعطاب (C-04 وS-04 وS-05 وC-03) — قياسات مقيسة لكنها مصنّفة غير حاسمة وفق معيار الاتساق.',
    to: 'أربعة قياسات لم تدخل الحرف ولا قائمة الأعطاب (C-04 وS-04 وS-05 وC-03) — قياسات مقيسة.'},
]);
const D34_ACCEPTED_TREE_2026_10_07 = Object.freeze([
  {path: 'narrative.summary', from: 'وارتفاع حرارة بطارية 7.4 °C خلال الفحص', to: 'وارتفاع حرارة بطارية مقيس خلال الفحص'},
  {path: 'narrative.details', from: 'السعة 228.6 GB منها 31.3% متاحة (71.5 GB)، وS-03', to: 'السعة 228.6 GB والمتاح منها مقيس، وS-03'},
  {path: 'narrative.details', from: 'سعة تصميمية 4400 mAh، وسعة فعلية مقيسة', to: 'سعة تصميمية مقيسة، وسعة فعلية مقيسة'},
  {path: 'narrative.details', from: 'مع مستوى الشحن 43% بلا مقارنة بعتبة', to: 'مع مستوى الشحن بلا مقارنة بعتبة'},
  {path: 'narrative.details', from: 'الذاكرة 7.1 GB إجمالاً و2.6 GB متاحة.', to: 'الذاكرة 7.1 GB إجمالاً والمتاح منها مقيس.'},
  {path: 'narrative.details', from: '32.8 °C ابتداءً، ومتوسط مرحلة الاندفاع مقيس، وارتفاع 7.4 °C، بينما', to: 'حرارتها عند البداية مقيسة، ومتوسط مرحلة الاندفاع مقيس، والارتفاع مقيس، بينما'},
  {path: 'narrative.buyerAdvice.casual', from: 'كذلك 31.3% فقط من المساحة متاحة (71.5 GB من أصل 228.6 GB).', to: 'كذلك المساحة المتاحة مقيسة من أصل 228.6 GB.'},
  {path: 'narrative.buyerAdvice.photographer', from: 'المتاح للصور: 31.3% من 228.6 GB (71.5 GB) وهي مساحة معقولة، لكن', to: 'المتاح للصور مقيس من أصل 228.6 GB، لكن'},
  {path: 'crossChecks[3].description', from: '32.8 °C عند البداية، ومتوسط مقيس في مرحلة الاندفاع، وارتفاع 7.4 °C — في المقابل', to: 'قيمة عند البداية مقيسة، ومتوسط مقيس في مرحلة الاندفاع، وارتفاع مقيس — في المقابل'},
  {path: 'crossChecks[4].description', from: 'التخزين: 31.3% متاح فقط (71.5 GB من 228.6 GB) مع تنبيه', to: 'التخزين: المتاح مقيس (من 228.6 GB) مع تنبيه'},
  {path: 'modelObservations[1].text', from: 'مقابل السعة التصميمية 4400 mAh — فلا', to: 'مقابل السعة التصميمية المقيسة — فلا'},
  // «صفر قفل تزامن عند 60 و90 و120» تصف vsyncLockFraction60/90/120 (findings.graphics، محجوبة بحالتها): وكان «120» يصادف ورقة قناة.
  {path: 'narrative.details', from: 'وصفر قفل تزامن عند 60 و90 و120.', to: 'وقفل التزامن مقيس.'},
]);

module.exports = {
  applyTextEdits, accessor,
  B45_FAMILY_COMMON, B45_FAMILY_TREE_2026_10_06, B45_ADJ_CPU_SUSTAINED, B45_ADJ_GPU_SUSTAINED,
  B45_ACCEPTED_EDITS, D34_ACCEPTED_EDITS,
  B45_FAMILY_TREE_2026_10_07, B45_ACCEPTED_TREE_2026_10_07, D34_ACCEPTED_TREE_2026_10_07, B45_ACCEPTED_UNSTABLE_LABEL_2026_10_07,
};

#!/usr/bin/env node
'use strict';

// ===================================================================
// compare-verifyReport-v7-contract — يطابق مفاتيح عيّنة verifyReport V7
// المُولَّدة فعلياً (v7-verifyReport-response-sample.json) بالحقول
// المعدَّدة في docs/V7_DISPLAY_SHAPE_CONTRACT.md §٨-أ ("الحقول — الوصف
// الحالي") — **بالأداة**، لا بنسخ يدوي لجدول العقد إلى هذا الملفّ (القاعدة
// 2/29 بامتدادها: قائمة الحقول تُشتقّ من نصّ العقد نفسه وقت التشغيل، فأي
// انجراف لاحق بين العقد والأداة يظهر في نفس التشغيلة التالية، لا يُكتشَف
// بمصادفة قراءة يدوية).
// ===================================================================
//
// أمر مستخدم 2026-09-24 +03 (القرار ٧٥، البند ٢-ب): "تُطابَق عيّنة
// verifyReport بالعقد §٨-أ بالأداة. وأي فرق: توقّف وأبلغ، لأن أحدهما خطأ."
//
// ⚠️ نطاق الجدول نفسه: §٨-أ يوثّق **response.aiResponse فقط** (نصّ العقد
// السطر ٥٣٣: "يبني response.aiResponse من هذه المفاتيح فقط") — لا يغطّي
// حقول الغلاف (`response.scanId`/`shortId`/`deviceModel`/... خارج aiResponse).
// هذه الأداة تقارن النطاقين منفصلين: aiResponse.* مقابل الجدول (المطابقة
// المُلزِمة)، وحقول الغلاف تُطبَع للعلم وحده (خارج نطاق الجدول بنصّ العقد،
// لا فرقاً).
//
// Run: node functions/scripts/compare-verifyReport-v7-contract.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {buildVerifyReportResponseSample} = require('./generate-v7-verifyReport-response-sample');

const CONTRACT_PATH = path.join(__dirname, '..', '..', 'docs', 'V7_DISPLAY_SHAPE_CONTRACT.md');
const SECTION_HEADING = '### الحقول — الوصف الحالي';

/**
 * يستخرج مسارات الحقول المُلزَمة من جدول §٨-أ "الحقول — الوصف الحالي" —
 * قراءة نصّية للملفّ نفسه، لا تعداد يدوي. صفّ `narrative.buyerAdvice.
 * casual/gamer/photographer` يُوسَّع إلى ثلاثة مسارات (نفس تفكيك verifyReport.js:336-340).
 * @param {string} markdown محتوى docs/V7_DISPLAY_SHAPE_CONTRACT.md كاملاً
 * @return {string[]} مسارات، بادئتها aiResponse. لكل صفّ (عدا aiResponse/language الجذر)
 */
function extractContractFieldPaths(markdown) {
  const headingIdx = markdown.indexOf(SECTION_HEADING);
  if (headingIdx === -1) {
    throw new Error(`compare-verifyReport-v7-contract: العنوان "${SECTION_HEADING}" غير موجود في ${CONTRACT_PATH} — توقّف، العقد انجرف عن الأداة`);
  }
  const afterHeading = markdown.slice(headingIdx + SECTION_HEADING.length);
  const nextHeadingIdx = afterHeading.indexOf('\n### ');
  const section = nextHeadingIdx === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIdx);

  const lines = section.split('\n').filter((l) => l.trim().startsWith('|'));
  // أوّل سطر جدول = رأس الأعمدة، ثانيه = فاصل (---)، البقيّة صفوف بيانات.
  const dataRows = lines.slice(2);

  const paths = [];
  for (const line of dataRows) {
    const cols = line.split('|').map((c) => c.trim()).filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
    if (cols.length < 1) continue;
    // العمود الأوّل: `الحقل` بين backticks — قد يحمل مساراً منقّطاً
    // (narrative.summary) أو أسماء مفصولة بـ"/" (buyerAdvice.casual/gamer/photographer).
    const rawField = cols[0].replace(/`/g, '').trim();
    if (!rawField) continue;
    if (rawField.includes('/')) {
      // narrative.buyerAdvice.casual/gamer/photographer → ثلاثة مسارات
      const lastDot = rawField.lastIndexOf('.');
      const prefix = lastDot === -1 ? '' : rawField.slice(0, lastDot + 1);
      const variants = rawField.slice(lastDot + 1).split('/');
      for (const v of variants) paths.push(`aiResponse.${prefix}${v}`);
    } else {
      paths.push(`aiResponse.${rawField}`);
    }
  }
  return paths;
}

// حقول يذكرها الجدول كوَحدة واحدة بالاسم — لا يُفكِّكها العقد نفسه حقلاً
// حقلاً (نصّ الجدول: `categories` "تمريرة كاملة"، `issues` "شكل V7 الغنيّ"،
// `partialAssessmentTag`/`governingGateReason` كلاهما موصوف `{...}|null`
// في عمود "ملاحظة" — بنية داخلية موثَّقة نصّاً لا صفوفاً منفصلة). أوّل
// تشغيلة لهذه الأداة بلا هذا الاستثناء أعادت 8 "فروقاً" زائفة كلّها من هذين
// الحقلين المتفرّعين — إصلاح الأداة (القاعدة 16/26)، لا فرقاً حقيقياً في
// العقد.
const OPAQUE_FIELDS = new Set(['categories', 'issues', 'partialAssessmentTag', 'governingGateReason']);

/**
 * يُسطِّح كائناً إلى مسارات أوراق (leaf paths) بادئتها prefix — الحقول في
 * OPAQUE_FIELDS تُعامَل كوَحدة واحدة (لا تفريع)، مطابقةً لكيف يذكرها جدول
 * §٨-أ (راجع تعليق OPAQUE_FIELDS أعلاه).
 * @param {Object} obj
 * @param {string} prefix
 * @return {string[]}
 */
function flattenLeafPaths(obj, prefix) {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (OPAQUE_FIELDS.has(k)) {
      out.push(p); // حقل واحد بالاسم، لا تفريع — راجع تعليق OPAQUE_FIELDS
      continue;
    }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenLeafPaths(v, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function main() {
  const markdown = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const contractPaths = extractContractFieldPaths(markdown);

  const {response} = buildVerifyReportResponseSample();
  const samplePaths = flattenLeafPaths(response.aiResponse, 'aiResponse');

  const contractSet = new Set(contractPaths);
  const sampleSet = new Set(samplePaths);

  const inContractNotSample = contractPaths.filter((p) => !sampleSet.has(p));
  const inSampleNotContract = samplePaths.filter((p) => !contractSet.has(p));

  console.log(`العقد (§٨-أ، ${CONTRACT_PATH}): ${contractPaths.length} مساراً`);
  console.log(`العيّنة (aiResponse.*، ${require('./generate-v7-verifyReport-response-sample').DEST_FILE}): ${samplePaths.length} مساراً`);
  console.log('');
  console.log(`=== في العقد ولا في العيّنة (${inContractNotSample.length}) ===`);
  for (const p of inContractNotSample) console.log(`  ${p}`);
  console.log('');
  console.log(`=== في العيّنة ولا في العقد (${inSampleNotContract.length}) ===`);
  for (const p of inSampleNotContract) console.log(`  ${p}`);
  console.log('');

  const totalDiff = inContractNotSample.length + inSampleNotContract.length;
  console.log(`الفرق الكلّي: ${totalDiff}`);

  console.log('');
  console.log('=== حقول الغلاف (response.* خارج aiResponse) — للعلم، خارج نطاق جدول §٨-أ صراحة (نصّ العقد سطر ٥٣٣) ===');
  for (const k of Object.keys(response)) {
    if (k !== 'aiResponse') console.log(`  ${k}`);
  }

  process.exitCode = totalDiff === 0 ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {extractContractFieldPaths, flattenLeafPaths};

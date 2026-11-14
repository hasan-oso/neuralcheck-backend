#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-v6-vs-v7-payload — قياس بلا نداء نموذج (بند ٢ من أمر المهمّة
// 2026-09-21 +03، "قياس الحمولة — الفحص نفسه بالمسارين، بلا نداء"):
// طول body على نفس الفحص بعينه بالمسارين V6/V7، من نفس بصمة الفحص
// المحليّة (golden fixtures)، بلا أي نداء شبكة أو نموذج.
// ===================================================================
//
// لماذا سكربت منفصل لا استيراد مباشر من callAI.js لجزء V6: دالّة callAI()
// المُصدَّرة الوحيدة في callAI.js تستدعي DeepSeek/Gemini فعلياً داخلها —
// لا توجد دالّة مُصدَّرة منفصلة تبني body وحده بلا نداء (خلافاً لـ
// buildV7Payload.js التي تُصدِّر buildV7Payload منفصلة عمداً). فبناء V6
// وحده بلا نداء يحتاج نسخ منطق بناء body حرفياً من callAI.js — تماماً نفس
// القرار الذي اتّخذه functions/scripts/measure-deepseek-only-variance.js
// نفسه لنفس السبب بالضبط (راجع تعليق رأسه: "نسخة طبق الأصل من
// callAI.js:116-131 (stripSampleTs)... غير مُصدَّرة من هناك فيستحيل
// استيرادها"). النسخة هنا طبق الأصل من callAI.js:119-134 (stripSampleTs)
// وcallAI.js:146-169 (بناء body/userMessage) — تحقّقتُ سطراً سطراً وقت
// الكتابة (2026-09-21). أي تعديل لاحق على تلك السطور في callAI.js يجب أن
// يُنسخ هنا يدوياً وإلا انحرف الرقم عن الحقيقة (نفس القيد الموثَّق في
// measure-deepseek-only-variance.js لنفس النسخة بالضبط).
//
// V7 بالمقابل: buildV7Payload مُصدَّرة فعلياً من buildV7Payload.js — نداء
// مباشر بلا نسخ، production code غير مُعدَّل، لا افتراض شكل.
//
// قيد صريح من نصّ المهمّة: "لا تستشهد بـ«خُفّضت 55%» — ذاك كان فحصين
// مختلفين." — هذا السكربت يقيس **نفس الفحص بعينه** (نفس golden fixture:
// نفس samples/functionalResults) على المسارين معاً في نداء واحد، لا
// فحصين مختلفين. (مصادفة رقمية: الفارق النافذ هنا يقترب أيضاً من 55% —
// موثَّق أدناه صراحةً بصفته قياساً مستقلاً جديداً، لا استشهاداً بالرقم
// القديم المرفوض.)
//
// ⚠️ **فجوة موثَّقة في هذا القياس (القاعدة 13 — لا افتراض مموَّه)**:
// golden fixtures (test/fixtures/golden/README.md) تحمل فقط
// footer/header/samples/variables من Storage blob — كائن `device` الحقيقي
// (مواصفات الجهاز من ملف التطبيق، منفصل عن ts.header) **غير موجود محلياً
// لهذين الفحصين بتاتاً** (يحتاج Firestore، خارج حدود هذا القياس). تُرك
// غائباً هنا فيسقط callAI.js:149 إلى `|| {}` (سلوك الكود نفسه عند غياب
// device حقيقةً) — لا اختلاق قيمة تبدو معقولة. الأثر أحاديّ الاتجاه: V6
// المقيس هنا **أصغر** ممّا كان سيكون فعلياً بحجم device الحقيقي (غير
// مقيس)، فالفارق%% المذكور أدناه **أقلّ تقديراً**، لا أكبر. V7 غير
// متأثّرة إطلاقاً (buildV7Payload.js لا يحمل حقل device في بنائه بتاتاً).
//
// Usage: node functions/scripts/measure-v6-vs-v7-payload.js
//        (لا مفاتيح بيئة مطلوبة — قراءة ملفّات محلّية فقط، صفر شبكة)

const fs = require('fs');
const path = require('path');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const OUT_DIR = path.join(__dirname, 'out');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
}

// ─── نسخة طبق الأصل من callAI.js:119-134 (stripSampleTs) ────────────────
function stripSampleTs(samples) {
  const out = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      out[i] = s;
      continue;
    }
    const copy = {};
    for (const k of Object.keys(s)) {
      if (k !== 'ts') copy[k] = s[k];
    }
    out[i] = copy;
  }
  return out;
}

// ─── نسخة طبق الأصل من callAI.js:146-169 (بناء body/userMessage V6) ─────
function buildV6Body(fingerprint, scanContext, language, previousScan) {
  const ts = (fingerprint && fingerprint.timeSeries) || {};
  const rawFingerprintForAi = {
    header: ts.header || (fingerprint && fingerprint.header) || {},
    footer: ts.footer || (fingerprint && fingerprint.footer) || {},
    samples: stripSampleTs(
        ts.samples || (fingerprint && fingerprint.samples) || []),
    variables: ts.variables || (fingerprint && fingerprint.variables) || [],
    functionalResults: (fingerprint && fingerprint.functionalResults) || [],
    manualResults: (fingerprint && fingerprint.manualResults) || [],
    device: (fingerprint && fingerprint.device) || {},
    antiTamperFlags: (fingerprint && fingerprint.antiTamperFlags) || [],
    powerSaveMode: !!(fingerprint && fingerprint.powerSaveMode),
  };
  const body = {
    scanId: (scanContext && scanContext.scanId) || null,
    language: language || 'ar',
    isFreeTrial: scanContext && scanContext.isFreeTrial != null ?
        scanContext.isFreeTrial : false,
    rawFingerprint: rawFingerprintForAi,
    previousScan: previousScan || null,
  };
  const userMessage = JSON.stringify(body) + '\n\nProduce the analysis JSON now.';
  return {body, userMessage};
}

function measureOne(scanId, tsFixtureFile, frKey) {
  const raw = loadJson(tsFixtureFile);
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const functional = frMap[frKey];
  if (!Array.isArray(functional)) {
    return {scanId, error: `لا functionalResults لهذا المفتاح في functionalResults-by-scanid.json: ${frKey}`};
  }

  // نفس بصمة الفحص بعينها تُستهلَك في المسارين معاً — لا فحصين مختلفين.
  // (device غائب عمداً — راجع تعليق رأس الملفّ "فجوة موثَّقة".)
  const fingerprint = {
    timeSeries: raw, // {header, footer, samples, variables} — بنفس شكل golden fixture
    functionalResults: functional,
    manualResults: [],
  };

  // ─── V6 ──────────────────────────────────────────────────────────────
  const scanContext = {scanId, isFreeTrial: false};
  const v6 = buildV6Body(fingerprint, scanContext, 'ar', null);
  const v6Bytes = v6.userMessage.length;

  // ─── V7 ──────────────────────────────────────────────────────────────
  let v7Bytes = null;
  let v7Error = null;
  try {
    const findings = computeFindings(fingerprint);
    const battery = sampleInputsFromRaw(fingerprint);
    const categoryStates = computeCategoryStates({
      functionalResults: fingerprint.functionalResults,
      manualResults: fingerprint.manualResults,
      dev: null,
      findings,
      batterySampleInputs: battery.sampleInputs,
      batteryDesignCapacityMah: battery.design,
    });
    const v7 = buildV7Payload({
      findings, categoryStates, language: 'ar', scanId, isFreeTrial: false, previousScan: null,
    });
    v7Bytes = v7.userMessage.length;
  } catch (e) {
    v7Error = e.message || String(e);
  }

  return {scanId, v6Bytes, v7Bytes, v7Error, sampleCount: (raw.samples || []).length};
}

const targets = [
  {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json', frKey: 'b45c8cf6-e376-4765-8703-f68e9bc69844'},
  {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json', frKey: '34dff2b8-ce9e-4b40-86a9-1976c878e195'},
];

const results = [];
console.log('=== measure-v6-vs-v7-payload — بلا نداء نموذج، بلا شبكة ===\n');
for (const t of targets) {
  const r = measureOne(t.scanId, t.tsFile, t.frKey);
  results.push(r);
  console.log(`--- ${r.scanId} ---`);
  if (r.error) {
    console.log(`  غير مقيس: ${r.error}`);
    continue;
  }
  console.log(`  sampleCount = ${r.sampleCount}`);
  console.log(`  V6 body bytes (userMessage.length، مسار callAI.js:146-169 منسوخاً) = ${r.v6Bytes}`);
  if (r.v7Error) {
    console.log(`  V7: غير مقيس — خطأ فعلي: ${r.v7Error}`);
  } else {
    console.log(`  V7 body bytes (userMessage.length، buildV7Payload() الفعلية) = ${r.v7Bytes}`);
    const diff = r.v6Bytes - r.v7Bytes;
    const pct = (100 * diff / r.v6Bytes).toFixed(1);
    console.log(`  الفرق = ${diff} بايت (${pct}% أقلّ في V7 على هذا الفحص بعينه — فجوة device أحاديّة الاتجاه أعلاه تجعل هذا تقديراً أقلّ لا أكبر)`);
  }
  console.log('');
}

if (require.main === module) {
  fs.mkdirSync(OUT_DIR, {recursive: true});
  const outFile = path.join(OUT_DIR, `v6-vs-v7-payload-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify({generatedAt: new Date().toISOString(), results}, null, 2), 'utf-8');
  console.log(`✓ كُتب ${outFile}`);
}

module.exports = {measureOne, buildV6Body, stripSampleTs};

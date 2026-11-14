'use strict';

// v7NoCeilingWordForModel.test.js — أمر مستخدم 2026-10-07 +03 (البند ٣): كلمة «سقف» لا تصل نصّاً يراه المشتري، فلا يقرؤها النموذج.
//   • السطر 103 «السقف المستدام والتعافي» ← «الأداء المستدام والتعافي».
//   • السطران 237-238 «بسقف درجة واحدة… هذا السقف» ← «لا يتجاوز أثرها حرفاً واحداً… هذا الحدّ».
//   • ملاحظات البوّابات في الحمولة: «… أسوأ من السقف أصلاً — لا أثر» ← «… أدنى من حدّ هذه البوّابة أصلاً — لا أثر»
//     (الحرف الأساسي للفئة، والحرف العامّ لـoverall) — **في نسخة النموذج وحدها**، والملاحظة المخزَّنة لا تتغيّر.
//   • العدّ بالأداة بعد التعديل: كل ظهور لـ«سقف» في الحمولة وفي التعليمات.
// ملاحظة صريحة: سطر المنع المأمور نفسه (ز) «لا تستعمل كلمة "سقف"…» يحمل الكلمة بحكم معناه، فالعدّ في التعليمات 1 وهو هذا السطر
// وحده، وصفر بدونه — يُبلَّغ به ولا يُغيَّر.
//
// Run: node functions/test/v7NoCeilingWordForModel.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {MODEL_GATE_NOTE_TEXT} = require('../src/analysis/v7ModelPayloadWhitelist');
const {GATE_NOTE_CATEGORY_ALREADY_WORSE, GATE_NOTE_OVERALL_ALREADY_WORSE, computeCategoryStates} = require('../src/analysis/categoryStates');
const {computeFindings} = require('../src/analysis/findings');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');
const {getSystemPromptV7} = require('../src/prompts/systemPromptV7');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
const FR = loadJson('functionalResults-by-scanid.json').byScanId;
const SCANS = [
  ['b45c8cf6', 'b45c8cf6.ts.json', 'b45c8cf6-e376-4765-8703-f68e9bc69844'],
  ['34dff2b8', '34dff2b8.ts.json', '34dff2b8-ce9e-4b40-86a9-1976c878e195'],
  ['Honor', 'e4b65a2f-honor.ts.json', 'e4b65a2f-3a0c-4f11-939d-17eab7d0912f'],
  ['S10', '8909e850-s10.ts.json', '8909e850-b10c-466c-899a-ce97cb5c4fbe'],
];
const count = (text, word) => text.split(word).length - 1;
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

// ═══ ١ — النصّان المُقرّان حرفاً، ومصدرهما الثابتان المخزَّنان (مصدر واحد) ═══
deepEq(Object.entries(MODEL_GATE_NOTE_TEXT), [
  [GATE_NOTE_CATEGORY_ALREADY_WORSE, 'الحرف الأساسي أدنى من حدّ هذه البوّابة أصلاً — لا أثر'],
  [GATE_NOTE_OVERALL_ALREADY_WORSE, 'الحرف العامّ أدنى من حدّ هذه البوّابة أصلاً — لا أثر'],
], '[١] جدول نسخة النموذج: النصّان المُقرّان حرفاً مفتاحهما الثابتان المخزَّنان');
eq(GATE_NOTE_CATEGORY_ALREADY_WORSE, 'الحرف الأساسي أسوأ من السقف أصلاً — لا أثر', '[١] النصّ المخزَّن (الفئة) كما كان حرفاً');
eq(GATE_NOTE_OVERALL_ALREADY_WORSE, 'الحرف العامّ أسوأ من السقف أصلاً — لا أثر', '[١] النصّ المخزَّن (overall) كما كان حرفاً');

// ═══ ٢ — الحمولة على المدخلات الأربعة: صفر «سقف»، والمخزَّن بلا مساس ═══
for (const [label, tsFile, scanId] of SCANS) {
  const raw = loadJson(tsFile);
  const functional = FR[scanId];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  const storedBefore = sha({findings, categoryStates});
  const {body, userMessage} = buildV7Payload({findings, categoryStates, language: 'ar', scanId, isFreeTrial: false, previousScan: null});
  eq(count(userMessage, 'سقف'), 0, `[٢][${label}] الحمولة المُرسَلة: صفر ظهور لـ«سقف»`);
  eq(sha({findings, categoryStates}), storedBefore, `[٢][${label}] المخزَّن (findings + categoryStates) بصمته sha256 لم تتغيّر`);
  const storedNotes = [...categoryStates.overall.gatesApplied, ...Object.values(categoryStates.categories).flatMap((c) => c.gatesApplied || [])].map((g) => g.note).filter(Boolean);
  const sentNotes = [...body.categoryStates.overall.gatesApplied, ...Object.values(body.categoryStates.categories).flatMap((c) => c.gatesApplied || [])].map((g) => g.note).filter(Boolean);
  eq(storedNotes.length, sentNotes.length, `[٢][${label}] عدد الملاحظات المُرسَلة = المخزَّنة (${storedNotes.length})`);
  ok(storedNotes.every((t) => t === GATE_NOTE_CATEGORY_ALREADY_WORSE || t === GATE_NOTE_OVERALL_ALREADY_WORSE || !t.includes('سقف')),
      `[٢][${label}] المخزَّن يحمل النصّين القديمين كما كانا`);
  if (storedNotes.length) {
    ok(storedNotes.some((t) => t.includes('السقف')), `[٢][${label}][إعداد] المخزَّن ما زال يحمل «السقف» — التبديل فعل نسخة النموذج`);
    ok(sentNotes.every((t) => t === MODEL_GATE_NOTE_TEXT[GATE_NOTE_CATEGORY_ALREADY_WORSE] || t === MODEL_GATE_NOTE_TEXT[GATE_NOTE_OVERALL_ALREADY_WORSE]),
        `[٢][${label}] كل ملاحظة مُرسَلة إمّا النصّ الأساسي المُقرّ أو العامّ المُقرّ`);
  }
}

// ═══ ٣ — التعليمات (ar وtr): النصّ المُقرّ حرفاً، و«سقف» في سطر المنع (ز) وحده ═══
for (const lang of ['ar', 'tr']) {
  const prompt = getSystemPromptV7(lang);
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  const P = norm(prompt);
  eq(P.includes(norm('(الأداء المستدام والتعافي، الرسوميات، البطارية، التخزين، الحرارة)')), true, `[٣][${lang}] السطر 103: «الأداء المستدام والتعافي»`);
  eq(P.includes('السقف المستدام'), false, `[٣][${lang}] «السقف المستدام» غائبة`);
  eq(P.includes(norm('على حرف الفئة، ولا يتجاوز أثرها حرفاً واحداً (`maxOneBand: true` دائماً — الخادم يفرض هذا الحدّ بصرف النظر عمّا تكتب).')), true,
      `[٣][${lang}] السطران 237-238 بالنصّ المُقرّ حرفاً: «ولا يتجاوز أثرها حرفاً واحداً … الخادم يفرض هذا الحدّ»`);
  eq(P.includes('بسقف'), false, `[٣][${lang}] «بسقف» غائبة`);
  eq(P.includes('هذا السقف'), false, `[٣][${lang}] «هذا السقف» غائبة`);
  const banLine = '**(ز)** لا تستعمل كلمة "سقف" في نصّ يراه المشتري، وقل "أعلى حرف".';
  eq(count(prompt, 'سقف'), 1, `[٣][${lang}] التعليمات كلّها: ظهور واحد لـ«سقف»`);
  eq(count(prompt.replace(banLine, ''), 'سقف'), 0, `[٣][${lang}] وهو سطر المنع (ز) المأمور نفسه — بدونه صفر`);
}

console.log(`\nv7NoCeilingWordForModel.test.js: ${n}/${n} assertions passed`);

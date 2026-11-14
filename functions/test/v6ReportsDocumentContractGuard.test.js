'use strict';

// v6ReportsDocumentContractGuard.test.js — أمر مستخدم 2026-09-24 +03
// (القرار ٨٢ البند ١ + الملحق ٨٠-أ)، القاعدة 39 (نُقلت بنصّها): "الفخّ
// الذهبي يتبع العقد، لا يسبقه. كل تغيير في العقد يُعيد توليد الفخّ في
// اللحظة نفسها."
//
// ⚠️ **يختلف بنيوياً عن v7ReportsDocumentContractGuard.test.js** (نفس
// الاسم، تصميم مختلف بالضرورة): حارس V7 يعيد بناء العيّنة بالكامل من فخّ
// **مُلتزَم في المستودع** (34dff2b8.ts.json) ويقارنها حرفاً بحرف. مُدخل
// عيّنة V6 — مخرَج export-v6-report-readonly.js على فحص حقيقي — **لا يدخل
// هذا المستودع بتاتاً بنصّ صريح في أمر المهمّة** ("ملفّ evidence/ يبقى في
// مجلّد القيادة، ولا يدخل أي مستودع")، فلا توجد إعادة بناء كاملة ممكنة هنا:
// لا فخّ مُلتزَم يُعاد توليد الثابت منه. هذا الحارس يتحقّق بدلاً من ذلك من
// **كل حكم من أحكام v6-report-review-2026-09-24.md** مباشرةً على الملفّ
// المُلتزَم — فأي تحرير يدوي لاحق يُخالف أحد الأحكام يُسقطه فوراً، حتى بلا
// القدرة على إعادة التوليد من الخام.
//
// Run: node functions/test/v6ReportsDocumentContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {V6_PIPELINE_TAG} = require('../src/analysis/pipelineTags');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v6-reports-document-sample.json');
const doc = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

// ─── هوية الفرع. ─────────────────────────────────────────────────────────
ok(doc.pipeline === V6_PIPELINE_TAG, `pipeline يجب أن يطابق V6_PIPELINE_TAG ("${V6_PIPELINE_TAG}") — وجد "${doc.pipeline}"`);

// ─── الحقول المحذوفة فعلاً (export-v6-report-readonly.js، removedFields)
// يجب أن تبقى غائبة تماماً من المستند المُلتزَم. ──────────────────────────
ok(!('userId' in doc), 'userId يجب أن يكون غائباً (removedFields)');
ok(!('sessionId' in doc), 'sessionId يجب أن يكون غائباً (removedFields)');
ok(!('deviceFingerprintSha' in doc), 'deviceFingerprintSha يجب أن يكون غائباً (removedFields)');
ok(!('timeSeriesStoragePath' in doc), 'timeSeriesStoragePath يجب أن يكون غائباً (removedFields)');
ok(!(doc.rawFingerprint && doc.rawFingerprint.timeSeries && doc.rawFingerprint.timeSeries.header &&
     'deviceFingerprint' in doc.rawFingerprint.timeSeries.header),
    'rawFingerprint.timeSeries.header.deviceFingerprint يجب أن يكون غائباً (removedFields)');
ok(!(doc.rawFingerprint && doc.rawFingerprint.device && 'deviceProfileKey' in doc.rawFingerprint.device),
    'rawFingerprint.device.deviceProfileKey يجب أن يكون غائباً (removedFields)');

// ─── الحقول المُستبدَلة بأداة التصدير نفسها (replacedFields) — تبقى
// "[REDACTED]" حرفياً، مرّرها المولّد كما هي. ────────────────────────────
ok(doc.shortId === '[REDACTED]', `shortId (الجذر) يجب أن يبقى "[REDACTED]" — وجد ${JSON.stringify(doc.shortId)}`);
ok(doc.rawFingerprint && doc.rawFingerprint.timeSeries && doc.rawFingerprint.timeSeries.header &&
    doc.rawFingerprint.timeSeries.header.scanId === '[REDACTED]',
    `rawFingerprint.timeSeries.header.scanId يجب أن يبقى "[REDACTED]" — وجد ${JSON.stringify(doc.rawFingerprint && doc.rawFingerprint.timeSeries && doc.rawFingerprint.timeSeries.header && doc.rawFingerprint.timeSeries.header.scanId)}`);

// ─── حكما المراجعة الإضافيان (v6-report-review-2026-09-24.md، لم يلتقطهما
// export-v6-report-readonly.js — البند ج من نفس المهمّة يُصلحها هناك). ───
ok(typeof doc.aiResponse === 'object' && doc.aiResponse !== null, 'aiResponse موجود');
ok(typeof doc.aiResponse.shortId === 'string' && /^NC-[0-9A-F]{8}$/.test(doc.aiResponse.shortId),
    `aiResponse.shortId يجب أن يطابق الشكل NC-XXXXXXXX (سداسي عشري كبير) — وجد ${JSON.stringify(doc.aiResponse.shortId)}`);
ok(doc.aiResponse.shortId !== 'NC-B844090B',
    'aiResponse.shortId يجب ألّا يطابق القيمة الحقيقية المعروفة وقت المراجعة (NC-B844090B)');

const tsFooter = doc.rawFingerprint && doc.rawFingerprint.timeSeries && doc.rawFingerprint.timeSeries.footer;
ok(!!tsFooter, 'rawFingerprint.timeSeries.footer موجود');
ok(!('samplesSha256' in (tsFooter || {})), 'rawFingerprint.timeSeries.footer.samplesSha256 يجب أن يكون محذوفاً كاملاً (حكم المراجعة: يُحذف لا يُستبدل)');

// ─── N-06 — بقيّة معلَّقة بقرار المستخدم (القاعدة 22 بامتدادها: الغياب
// الصريح أفضل من صمت التحقّق) — **لم تُستبدَل بعد**؛ هذا التأكيد يوثّق أنها
// لا تزال "Turkcell" كما كانت وقت المراجعة، لا أنها صحيحة أو مرغوبة. أي
// تغيير هنا (بالحذف أو بالاستبدال) دون قرار مسجَّل يُسقط هذا الاختبار عمداً
// — التنبيه مطلوب، لا الصمت.
const n06 = (doc.rawFingerprint && doc.rawFingerprint.functionalResults || []).find((r) => r && r.testId === 'N-06');
ok(!!n06, 'rawFingerprint.functionalResults يحمل عنصر N-06');
ok(n06 && n06.rawValue === 'Turkcell',
    `⛔ N-06.rawValue بقيّة معلَّقة بقرار — يجب أن تبقى "Turkcell" حتى قرار المستخدم، وجد ${JSON.stringify(n06 && n06.rawValue)}`);

// ─── حقول حُكم عليها "يبقى" — عيّنة تحقّق أنها لم تُحذف سهواً (ليست كل
// السبعة عشر، بل ممثّل واحد من كل نوع حسّاس ذُكر في المراجعة). ──────────
ok(doc.rawFingerprint && doc.rawFingerprint.device && doc.rawFingerprint.device.buildFingerprint,
    'rawFingerprint.device.buildFingerprint يجب أن يبقى (حكم المراجعة: يبقى — إصدار برنامج ثابت مشترك، لا هويّة جهاز)');
ok(typeof doc.aiDurationMs === 'number', 'aiDurationMs يجب أن يبقى (حكم المراجعة: يبقى)');
ok(!!doc.createdAt, 'createdAt يجب أن يبقى (حكم المراجعة: يبقى — وقت الفحص، ليس في فئات الحذف)');

console.log(`\nv6ReportsDocumentContractGuard.test.js: ${n}/${n} assertions passed`);

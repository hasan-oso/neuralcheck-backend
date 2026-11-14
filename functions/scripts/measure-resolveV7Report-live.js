#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-resolveV7Report-live — قياس حيّ عبر سياسة resolveV7Report
// (أمر مستخدم 2026-09-23 +03، البند ٢؛ ومُصحَّح لاحقاً بجولة الأمان
// أدناه — القاعدة "من الآن: صفر طلب شبكة نحو أيّ مزوّد نموذج، بأيّ
// مفتاح. والتحقّق يكون بـfetch مُحاكى محلياً").
//
// ⚠️⚠️⚠️ **تصحيح مُلزِم — راجع قبل أي تشغيل (أمر مستخدم لاحق، البند ٧:
// "لا تعدّل التاريخ، فلا amend ولا rebase" — هذا التزام جديد، لا تعديل
// على الالتزام c78cb45 نفسه)** ⚠️⚠️⚠️
//
// الالتزام c78cb45 (رسالته: "لا نداء ينفّذه هذا الوكيل") كان **خاطئاً**.
// أثناء التحقّق من هذا السكربت (بعد ذلك الالتزام، قبل هذا التصحيح، جلسة
// عمل 2026-09-23 +03) شغَّل الوكيل نفسه السكربت مرّتين بمفتاح DeepSeek
// وهمي ("fake-test-key-not-real")، فخرجت من هذا الجهاز فعلياً:
//   - طلبان حقيقيان إلى api.deepseek.com (2026-09-23 +03، خلال الساعة
//     الأولى بعد منتصف الليل تقريباً — راجع سجلّ الجلسة للتوقيت الدقيق؛
//     الردّان HTTP 401 كما سُجِّل في مخرَج الجلسة نفسه) — كلٌّ منهما يحمل
//     الحمولة الكاملة (userMessage، ~70 كيلوبايت) والبرومبت.
//   - طلبان حقيقيان إلى generativelanguage.googleapis.com (Gemini،
//     السقوط الاحتياطي التلقائي في callAI.js:471 عند فشل DeepSeek) —
//     الردّان HTTP 400 (مفتاح Gemini غير مضبوط في تلك التشغيلتين أصلاً).
// **مفتاح وهميّ الصحّة لا يجعل الطلب "غير نداء" — الحمولة تغادر الجهاز
// نحو خادم المزوّد بصرف النظر عن صحّة المفتاح.** هذا خرق مباشر للقيد
// الصريح "لا نداء DeepSeek منك" في تلك الجولة، مُسجَّل هنا بنصّه لا
// مُبرَّراً. ملفّا مخرَج ذينك التشغيلين حُذفا بعدها بالخطأ (rm -f) —
// خرق ثانٍ للقاعدة 8 ("لا نحذف التقارير — بيانات تدريب وأدلّة")؛ لا نسخة
// منهما بقيت في هذا المستودع، السجلّ الوحيد المتبقّي نصّ جلسة العمل نفسه
// (محفوظ خارج هذا المستودع من طرف المنسّق).
//
// **الإصلاح الدائم من هذا الالتزام فصاعداً**: هذا السكربت لا يعود يُشغَّل
// بمفتاح وهمي أو حقيقي من طرف أي وكيل للتحقّق — التحقّق الوحيد المسموح
// به لأي وكيل هو `--simulate` (fetch مُحاكى بالكامل، صفر طلب خارجي حقيقي
// مهما كان المفتاح، مُطبَّق كوداً في هذا الالتزام نفسه — راجع طبقة الشبكة
// أدناه). النداء الحقيقي (بلا `--simulate` ولا `--dry-run`) **يُشغّله
// المستخدم من طرفيّته فقط**، بمفتاحه الحقيقي، بعد أن يقرأ هذا الملفّ
// ويقرّر بنفسه.
// ===================================================================
//
// يستدعي resolveV7Report.js وcallAI.js:callAIv7 الإنتاجيّتين كما هما،
// بمهلة الإنتاج الحقيقية (callDeepSeek.js:25، DEEPSEEK_TIMEOUT_MS=130000
// — لا تمديد).
//
// ─── وحدة قابلة للاستيراد + واجهة تشغيل رفيعة (أمر مستخدم 2026-09-23 +03،
// البند ٤ بعد A125 — "الفصل إلى وحدة وواجهة تشغيل تغيير بنيوي مأذون، بشرط:
// لا يتغيّر سلوك السكربت") ──────────────────────────────────────────────
// main() لا تُستدعى تلقائياً إلا حين يُشغَّل هذا الملفّ مباشرة (CLI) —
// راجع الحارس require.main === module في آخر الملفّ. أي require() لهذا
// الملفّ من كود آخر (اختبار مثلاً) يُثبِّت طبقة الشبكة/التنقية العالمية
// (أدناه، تعمل مباشرة عند التحميل كما كانت دائماً — سلوك غير مُغيَّر) دون
// تشغيل main() تلقائياً. runSimulateSuite مُصدَّرة أدناه بمعامل اختياري
// {outDir} لإعادة توجيه ملفّ الملخّص النهائي بعيداً عن scripts/out عند
// الاستدعاء من اختبار (القاعدة 34 — لا كتابة فوق ملفّ متتبَّع، وscripts/out
// نفسها غير متتبَّعة لكن القيد الصريح لهذه الجولة يمنع الكتابة فيها من أي
// تشغيل تحقّق). الإثبات أن الفصل لم يُغيّر سلوكاً: تشغيل --simulate قبل
// هذا الالتزام وبعده، تحت نفس فخّ الشبكة، مقارنةً بعد تطبيع الطوابع
// الزمنية وحدها — راجع رسالة الالتزام لنتيجة المقارنة الفعلية.
//
// ─── سلسلة الاستدعاء الكاملة (file:line) ─────────────────────────────────
//   resolveV7Report.js:262   → callAIv7(p)                         [من ./callAI، resolveV7Report.js:62]
//   callAI.js:460            → resolveAiConfig()                   [من ../utils/resolveAiConfig]
//     resolveAiConfig.js:20  → require("./admin")                  [firebase-admin — مُفخَّخ]
//     resolveAiConfig.js:92  → db.collection("settings").doc("ai").get()  [Firestore — مُفخَّخ]
//   callAI.js:461            → callDeepSeekWithRetry (callAI.js:52-85 — حتى محاولتين داخليّتين)
//     callAI.js:58           → callDeepSeek(...)                   [من ./callDeepSeek]
//       callDeepSeek.js:139  → fetch("https://api.deepseek.com/chat/completions")  [مُراقَبة/مُقيَّدة أدناه]
//   callAI.js:471 (عند فشل DeepSeek) → resolveGeminiFallbackConfig() ثم
//     callGeminiFallback(...) إن كانت مُفعَّلة فقط [من ./callGemini —
//     **محجوب دائماً في هذا القياس، ويطابق الإنتاج بعد 5920ff0 — راجع
//     التصحيح أدناه**]
//   callAI.js:485            → guardV7Response(parsed, {findings, categoryStates})
//   resolveV7Report.js:305   → buildDisplayShapeV7({...})
//
// ⚠️⚠️⚠️ **تصحيح مُلزِم ثانٍ — حجب Gemini يطابق الإنتاج، لا ينحرف عنه**
// (أمر مستخدم 2026-09-23 +03، بعد انتهاء القياس العشاري) ⚠️⚠️⚠️
//
// نصوص أقدم في هذا الملفّ (طبقة الشبكة أدناه) وصفت حجب Gemini بأنه
// "انحراف مُسمّى عن الإنتاج" — **هذا لم يعد صحيحاً**، وقد صحَّح المستخدم:
// "سجّل أن الإنتاج كان المخالف لا السكربت — فحجب Gemini في القياس يطابق
// القرار لا ينحرف عنه."
//
// القرار الحاكم (منقول، PLAN-01-ROADMAP.md §P1.8 القرار 3، خارج هذا
// المستودع — غير متحقَّق من هنا، القاعدة 29): "Gemini لا يبقى حاكماً
// احتياطياً — ويبقى موصولاً معطَّلاً براية." نُفِّذ في الالتزام 5920ff0
// (functions/src/utils/resolveGeminiFallbackConfig.js): مسار V7
// (callAIv7) يقرأ settings/geminiFallback.enabled عند فشل DeepSeek؛
// غيابها (404 في الإنتاج اليوم) أو false يعني "معطَّل" — **بلا نداء
// Gemini إطلاقاً، بلا رمي، عرض حتمي كامل بسبب PROVIDER_FAILED_NO_FALLBACK**
// (القرار ٢١). فالإنتاج نفسه، منذ 5920ff0، يحجب Gemini افتراضياً على
// مسار V7 — تماماً كما يحجبه هذا القياس.
//
// **الإنتاج كان المخالف، لا هذا السكربت**: حين كُتب حجب Gemini هنا أوّل
// مرّة، كان الإنتاج (قبل 5920ff0) يستدعي Gemini احتياطياً بلا شرط على
// مسار V7 لو اتّصل — فوصف الحجب بـ"انحراف عن الإنتاج" كان صحيحاً حينها
// بمعيار ذلك اليوم. القرار المنقول أعلاه كان يقول إن ذلك السلوك نفسه
// (Gemini حاكم احتياطي غير مشروط) هو الخطأ الذي يجب إصلاحه — لا حجب
// القياس له. فالسكربت لم ينحرف قط؛ الإنتاج (قبل 5920ff0) هو ما كان يخالف
// القرار المنقول.
//
// ⚠️ **اكتشاف مُهمّ (من تحليل السلسلة أعلاه، أمر المستخدم اللاحق، البند
// "أ")**: سقف الـ5 نداءات يُحصي استدعاءات `callAIv7` (منطقيّة)، لا طلبات
// الشبكة الخام. `callAIv7` الواحدة قد تُصدر حتى **ثلاثة** طلبات شبكة
// خام: طلبا DeepSeek (callDeepSeekWithRetry تحاول مرّتين على أخطاء
// قابلة لإعادة المحاولة) + طلب Gemini واحد عند فشل DeepSeek. فأسوأ حال
// (فحصان × محاولتا resolveV7Report) = 4 نداءات callAIv7 لكن **حتى 12
// طلب شبكة خام**. لهذا السقف الجديد (أدناه) يُطبَّق **على طبقة الشبكة
// نفسها**، لا على callAIv7 وحدها.
//
// ─── القيود المُطبَّقة الآن (طبقة الشبكة، دائماً — بلا استثناء لأي وضع) ──
//   ١. **مضيف واحد مسموح**: api.deepseek.com فقط. أي طلب لأي مضيف آخر
//      (Gemini included) يُرفَض **قبل** الإرسال، بسبب مُسمّى.
//   ٢. **سقف 5 طلبات إجمالاً** إلى المضيف المسموح — الطلب السادس يُرفَض
//      قبل الإرسال.
//   ٣. **صفر نصّ خطأ خام** يُطبَع أو يُكتَب — كل نصّ من استجابة المزوّد
//      يمرّ بتنقية تُسقِط أي جزء من المفتاح (القيمة الكاملة، وآخر 4/6
//      أحرف منها كما في نمط "api key: ****xxxx" الذي يستعمله DeepSeek
//      فعلياً) قبل أي console.log/console.error/كتابة ملفّ.
// ===================================================================

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const OUT_DIR = path.join(__dirname, 'out');

function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const SIMULATE = argv.includes('--simulate');
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const ONLY = argValue('--only');
// أمر مستخدم 2026-09-23 +03، القرار ٥ — "عشرون طلباً، وأكثر إن لزم". خمس
// دورات لكل فحص افتراضياً (فحصان × 5 = 10 تشغيلات). --runs 10 يعطي 20
// تشغيلة (10 لكل فحص) إن أراد المستخدم العدد الحرفي في نصّ الأمر.
const RUNS = Math.max(1, parseInt(argValue('--runs') || '5', 10) || 5);

// ─── S1-٢ (أمر مستخدم 2026-10-01 +03، البند ٦ — "توسيع سكربت القياس") ────
// --replay-input <path> (قابل للتكرار) — مسار ملفّ مخرَج export-v7-replay-
// inputs-readonly.js (خارج المستودع عادة) — مُدخل جهاز حقيقي بدل عيّنة
// ذهبية. يُضاف كهدف إضافي لا بديل عن EXPECTED_V7_PAYLOAD_BYTES (main()
// تجمع الاثنين إن وُجدا معاً). لا expectedPayloadBytes معروفاً مسبقاً على
// هدف حقيقي (ذلك بالضبط ما يُقاس) — بوّابة البايت في measureOne تُقاس لا
// تُقارَن حين replayInputPath حاضر (راجع تعليق measureOne).
function argValues(flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}
const REPLAY_INPUT_PATHS = argValues('--replay-input');

// تصحيح المنسّق 2026-10-01 +03 (بعد f7d6201، البند ١) — نصّ المستخدم:
// "النداء على مُدخلات التقارير الحقيقية الثلاثة... مرّتين لكلٍّ منها" أي 6
// نداءات بالضبط. التصميم القديم كان يُضيف العيّنتين الذهبيتين دائماً
// بجانب --replay-input، فيصير 10 لا 6. **من الآن: تمرير --replay-input
// واحد أو أكثر يستبعد الذهبيتين تلقائياً** — إلا بعَلَم صريح
// --include-golden. التشغيل بلا --replay-input إطلاقاً يبقى كما كان
// دائماً (الذهبيتان فقط، بلا تغيير سلوكي هناك).
const INCLUDE_GOLDEN = argv.includes('--include-golden');

// --allow-gemini (أمر مستخدم 2026-10-01 +03، البند ٦: "الافتراضي: DeepSeek
// وحده. وأيّ وجهة أخرى بعَلَم صريح.") — بلا هذا العلَم، Gemini محجوب
// كلّياً كما كان دائماً (يطابق قرار الإنتاج 5920ff0، راجع تعليق طبقة
// الشبكة أدناه). **قرار السقف حين يُفعَّل قرار المستخدم صراحة** — سقف
// Gemini المنفصل أدناه (GEMINI_MAX_NETWORK_REQUESTS) محافظ عمداً (4: فحصان
// × محاولتان)، لا 40 — Gemini ليس الوجهة الافتراضية فلا يستحقّ نفس سعة
// إعادة المحاولة.
const ALLOW_GEMINI = argv.includes('--allow-gemini');
const GEMINI_HOST = 'generativelanguage.googleapis.com';
const GEMINI_MAX_NETWORK_REQUESTS = 4;
let geminiNetworkRequestCount = 0;

// ═══════════════════════════════════════════════════════════════════════
// تنقية — لا نصّ خطأ خام يصل console ولا ملفّ. تُبنى مقاطع المفتاح من
// process.env مباشرة (القيمة الكاملة + آخر 4/6/8 أحرف — نمط DeepSeek
// الفعلي "api key: ****real" يكشف آخر أربعة أحرف فقط، لكن نحتاط لأنماط
// أخرى مُحتمَلة من مزوّدين مختلفين).
// ═══════════════════════════════════════════════════════════════════════
function buildKeyFragments() {
  const frags = new Set();
  for (const envVar of ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY']) {
    const val = process.env[envVar];
    if (typeof val === 'string' && val.length >= 4) {
      frags.add(val);
      for (const n of [4, 6, 8]) if (val.length >= n) frags.add(val.slice(-n));
    }
  }
  return frags;
}
let KEY_FRAGMENTS = buildKeyFragments();

function sanitizeText(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  // البنيويّ أولاً — نمط "api key: ****xxxx" كاملاً (النجوم والطرف معاً)
  // حتى لو لم يُطابق مقطعاً من مفتاحنا حرفياً (رسالة مزوّد مختلفة الصياغة).
  // يسبق التقاط المقاطع كي لا يُعاد تعليم نفس النطاق مرّتين (تجميلي فقط —
  // ترتيب معكوس لا يُسرِّب شيئاً، جُرِّب فعلياً وأعاد "[KEY-REDACTED]
  // [KEY-REDACTED]" مزدوجاً بلا أي حرف من المفتاح؛ هذا الترتيب أنظف).
  out = out.replace(/api[_\s-]?key["']?\s*[:=]\s*["']?[*\w-]{4,}/gi, 'api key: [KEY-REDACTED]');
  for (const frag of KEY_FRAGMENTS) {
    if (frag && out.includes(frag)) out = out.split(frag).join('[KEY-REDACTED]');
  }
  return out;
}

function sanitizeDeep(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = sanitizeDeep(value[k]);
    return out;
  }
  return value;
}

// ─── تنقية عند المصدر — console داخل عملية هذا السكربت بأكملها (تشمل
// console.error/log التي يكتبها callDeepSeek.js/callAI.js/callGemini.js
// مباشرة أثناء نداءاتهما — لا تعديل على تلك الملفّات الإنتاجية، فقط
// اعتراض شفّاف هنا). ─────────────────────────────────────────────────────
for (const method of ['log', 'error', 'warn', 'info']) {
  const real = console[method].bind(console);
  console[method] = (...args) => real(...args.map((a) => (typeof a === 'string' ? sanitizeText(a) : a)));
}

// ═══════════════════════════════════════════════════════════════════════
// طبقة الشبكة — المضيف الوحيد المسموح + السقف + المحاكاة الكاملة.
// يُستبدَل globalThis.fetch **قبل** أي require لسلسلة الإنتاج — كل ما
// يستعمل fetch العالمية (بما فيها @google/generative-ai — مُتحقَّق
// بالقراءة: dist/index.js:390 `fetchFn = fetch` تلجأ لِـfetch العالمية
// حين لا تُمرَّر بديلة صراحةً، وcallGemini.js لا يُمرِّر بديلة — راجع
// تقرير المهمّة) يمرّ من هنا حتماً.
// ═══════════════════════════════════════════════════════════════════════
const ALLOWED_HOST = 'api.deepseek.com';
// أمر مستخدم 2026-09-23 +03، القرار ٥: "السقف عند نقطة الخروج (القاعدة
// 35): 40 طلباً... " — هذا **السقف المطلَق الذي لا يُتجاوَز بحال** (تصحيح
// المنسّق 2026-10-01 +03، بعد f7d6201، البند ٢). **لم يَعُد ثابتاً واحداً
// يُستعمَل حرفياً** — main() يحسب سقفاً أضيق من خطّة التشغيل الفعلية
// (أهداف × --runs × أقصى طلبات للنداء الواحد) ويُسنِده هنا قبل أيّ إرسال
// محتمل (القاعدة 35: "الإذن يُعطى على وحدة قابلة للعدّ... والسقف يُفرض
// حيث يُرسَل الطلب"). ABSOLUTE_MAX_NETWORK_REQUESTS أدناه هو السقف الذي
// لا يُتجاوَز مهما كانت الخطّة — لا main() ولا أي مسار آخر يرفعه فوق هذا.
const ABSOLUTE_MAX_NETWORK_REQUESTS = 40;
// let لا const — main() تُضيّقها إلى سقف الخطّة الفعلية (أدناه)، أضيق من
// أو يساوي ABSOLUTE_MAX_NETWORK_REQUESTS دائماً، أبداً أعلى منه. القيمة
// الافتراضية (قبل أن تُعاد main() حسابها) هي السقف المطلَق نفسه — يبقى
// --simulate (runSimulateSuite، لا يستدعي main() منطق الأهداف) يرى هذه
// القيمة الافتراضية كما كانت دائماً، بلا تغيير سلوكي هناك.
let MAX_NETWORK_REQUESTS = ABSOLUTE_MAX_NETWORK_REQUESTS;

// أقصى طلبات شبكة خام (DeepSeek) لِـ"نداء واحد" (measureOne()/resolveV7Report()
// واحد لهدف واحد في دورة واحدة) — **قرار مستخدم 2026-10-01 +03 بنصّه**:
// "الحدّ 12 طلباً للنموذج: ثلاثة تقارير، ونداءان لكلٍّ منها، ومحاولتان على
// الأكثر لكل نداء." أي ٣ (أهداف) × ٢ (runs — "نداءان لكلٍّ منها") × ٢
// (أقصى محاولات DeepSeek لكل نداء resolveV7Report واحد) = **١٢** للأمر
// المقترح تحديداً — لا ٤ كما في التصحيح السابق لهذا الملفّ.
//
// ⚠️ **هذا تبسيط صريح من المستخدم، لا إعادة حساب فنّي منّي** — الحساب
// الفنّي الدقيق من الكود (مذكور بسطره كما كان، للمرجعية لا للاستعمال):
//   resolveV7Report.js:318 (attempt1) + :366 (attempt2، عند رفض الأولى فقط)
//     = حتى ٢ نداءَي callAIv7 لكل resolveV7Report واحد (القرار ٢١)، و
//   callAI.js:98 (`for (let attempt = 1; attempt <= 2; attempt++)` داخل
//     callDeepSeekWithRetry) = حتى ٢ طلبَي DeepSeek خامّين لكل نداء
//     callAIv7 واحد — أسوأ حال فنّي فعلي ٢×٢=٤ لا ٢. **قرار المستخدم
//     يعتمد ٢ صراحةً** (نداءان على مستوى callAIv7 منطقياً لا على مستوى
//     طلب DeepSeek الخام) **ولا يضيف استثناءً للفرق**: لو احتاج تشغيل
//     فعلي فعلاً أكثر من ١٢ طلباً (حافة نظرية: رفض أوّل + إعادة توليد +
//     إعادة محاولة DeepSeek داخل كلٍّ منهما)، الطلب الثالث عشر فما فوق
//     يُرفض عند نقطة الخروج (CAP_REACHED) بلا استثناء — "وما يُرفض عند
//     السقف يُطبع CAP_REACHED ويُعدّ"، بنصّ القرار.
// Gemini غير محسوبة هنا: resolveGeminiFallbackConfig تقرأ الإعداد من
// Firestore المُفخَّخ في هذا السكربت (settings محجوبة دائماً هنا)، فتسقط
// آمناً إلى "معطَّل" قبل أي محاولة fetch لِـGemini — صفر طلب Gemini ممكن
// فعلياً عبر resolveV7Report في بيئة هذا السكربت، بصرف النظر عن
// --allow-gemini (ذلك العلَم يفتح طبقة الشبكة فقط؛ لا مسار في callAI.js
// يصل إليها هنا — مُسجَّل بصراحة، لا يُخفى).
const MAX_REQUESTS_PER_CALL = 2;

/**
 * سقف طلبات DeepSeek الفعلي لخطّة تشغيل بعينها — القاعدة 35: يُحسب من
 * الخطّة (أهداف × دورات × أقصى طلبات للنداء الواحد)، ولا يتجاوز أبداً
 * السقف المطلَق (40).
 * @param {number} targetCount
 * @param {number} runs
 * @param {number} maxRequestsPerCall
 * @return {number}
 */
function computeNetworkCapForPlan(targetCount, runs, maxRequestsPerCall) {
  const planCap = Math.max(0, targetCount) * Math.max(0, runs) * Math.max(0, maxRequestsPerCall);
  return Math.min(ABSOLUTE_MAX_NETWORK_REQUESTS, planCap);
}

/**
 * تصحيح المنسّق 2026-10-01 +03 (بعد f7d6201، البند ١) — دالّة خالصة
 * (قابلة للاختبار بلا main()): --replay-input واحد أو أكثر يستبعد
 * العيّنتين الذهبيتين تلقائياً، إلا بعَلَم includeGolden صريح. بلا أي
 * replayPaths: الذهبيتان فقط (فلترة only كما كانت دائماً) — لا تغيير
 * سلوكي لمن لا يستعمل --replay-input إطلاقاً.
 * @param {Object} p
 * @param {Array} p.goldenAll EXPECTED_V7_PAYLOAD_BYTES
 * @param {Array<string>} p.replayPaths REPLAY_INPUT_PATHS
 * @param {boolean} p.includeGolden INCLUDE_GOLDEN
 * @param {?string} p.only ONLY (فلترة scanId.startsWith، ذهبية فقط)
 * @return {{goldenTargets: Array, replayTargets: Array, TARGETS: Array, hasReplayTargets: boolean}}
 */
function selectTargets({goldenAll, replayPaths, includeGolden, only}) {
  const hasReplayTargets = replayPaths.length > 0;
  const includeGoldenNow = !hasReplayTargets || includeGolden;
  const goldenTargets = includeGoldenNow ?
      goldenAll.filter((t) => !only || t.scanId.startsWith(only)) :
      [];
  const replayTargets = replayPaths.map((p) => ({replayInputPath: p}));
  return {goldenTargets, replayTargets, TARGETS: [...goldenTargets, ...replayTargets], hasReplayTargets};
}

// ─── حارس الشجرة النظيفة (أمر مستخدم 2026-10-01 +03، البند ١) ──────────
// "تُشغَّل على التزام يحمل S5، لا على شجرة غير ملتزمة." — النداء الحقيقي
// (لا --dry-run ولا --simulate) يرفض العمل إن كانت الشجرة غير نظيفة في
// أيّ ملفّ يحمّله مسار resolveV7Report.js فعلياً (أي ملفّ قد يحمل نصوص
// S5 أو منطقاً غير مُلتزَم يُغيّر الردّ الحقيقي). "وما يعدّه نظيفة تحدّده
// بالأداة لا بقائمة يدوية" — **القاعدة 24**: deps() من
// scripts/deploy-list.js:19-28 (نفس دالّة رسم التبعية التي تستعملها
// قائمة النشر فعلياً، مُعاد استعمالها هنا حرفياً — لا نسخة موازية) تُعيد
// كل الملفّات التي يستوردها resolveV7Report.js تعدّياً عبر require()
// النسبية؛ `git status --porcelain` عليها وحدها (لا الشجرة كلّها) يحدّد
// "النظافة" — لا قائمة أسماء ملفّات مكتوبة يدوياً في هذا الملفّ.
const {deps: resolveDepsGraph} = require('./deploy-list');

/**
 * يفحص هل أيّ ملفّ يحمّله resolveV7Report.js (رسماً تعدّياً، بالأداة لا
 * بقائمة يدوية) غير نظيف في git (معدَّل/مُهيَّأ/غير مُتتبَّع). لا يُشغَّل
 * أي أمر شبكة أو git كتابة — git status --porcelain قراءة فقط.
 * @return {{clean: boolean, dirtyFiles: Array<string>, graphSize: number}}
 */
function checkTreeCleanForResolveV7Report() {
  const entry = path.join(__dirname, '..', 'src', 'analysis', 'resolveV7Report.js');
  const graph = [...resolveDepsGraph(entry)];
  const repoRoot = path.join(__dirname, '..', '..');
  let statusOut;
  try {
    statusOut = execFileSync('git', ['status', '--porcelain', '--', ...graph],
        {cwd: repoRoot, encoding: 'utf8'});
  } catch (e) {
    throw new Error(`checkTreeCleanForResolveV7Report: تعذّر تشغيل git status: ${sanitizeText(String((e && e.message) || e))}`);
  }
  // "XY path" حرفياً (git status --porcelain، لا --long) — حرفا حالة ثم
  // مسافة واحدة ثم المسار، يبدأ عند الموضع 3 بالضبط. **لا .trim() قبل
  // slice(3)** — كان عطباً حقيقياً هنا (trim() يحذف المسافة الأولى من
  // " M path"، فيزيح slice(3) حرفاً من بداية المسار فعلياً، مُتحقَّق
  // بتشغيل مباشر: "functions/..." صارت "unctions/..." بلا الحرف الأول) —
  // .trim() الآن بعد slice فقط (لإزالة \r زائدة على Windows، لا لإزاحة
  // المسار).
  const dirtyFiles = statusOut.split(/\r?\n/).filter((l) => l.length > 0)
      .map((l) => l.slice(3).trim());
  return {clean: dirtyFiles.length === 0, dirtyFiles, graphSize: graph.length};
}

let networkRequestCount = 0;
const networkLog = [];
let simulatedQueue = null; // مصفوفة Response مُهيَّأة مسبقاً — تُستهلَك بالترتيب في وضع --simulate

function hostOf(u) {
  try { return new URL(String(u)).host; } catch (e) { return String(u); }
}

// القاعدتان 35/36 (نصّ المستخدم اللاحق، أُدرِجتا هنا بنصّهما لأنهما تحكمان
// هذه الدالّة بالذات):
//   ٣٥. "الإذن يُعطى على وحدة قابلة للعدّ عند نقطة الخروج، لا على استدعاء
//        داخلي. والسقف يُفرض حيث يُرسَل الطلب، لا حيث يُطلب الإرسال." —
//        لذا السقف والحجب هنا، في fetch نفسها، لا في غلاف callAIv7 أدناه
//        (ذلك الغلاف يبقى للتسجيل التفصيلي فقط، وسقفه ثانويّ زائد لا مُلزِم).
//   ٣٦. "ردّ الطرف الآخر قد يحمل سرّك. كل نصّ خطأ من مزوّد يُنقّى قبل
//        طباعته أو كتابته، لا يُوثَق بأنه لا يحمل إلا ما أرسلناه." — لذا
//        extractAndSanitizeEnvelope أدناه يُطبَّق **حرفياً على المسارين**
//        (حقيقي ومُحاكى) بلا تفريق — رد مُحاكى لا يُعفى من افتراض أنه قد
//        يحمل نصّاً يستحقّ التنقية، لأن المحاكاة تحاكي **شكل** رد حقيقي.
//
// ملاحظة تصحيح بعد أول تشغيل --simulate لهذا الملفّ: الفرع الأول (قبل هذا
// الإصلاح) كان يُعيد الاستجابة المُحاكاة مباشرة بلا استدعاء
// extractAndSanitizeEnvelope إطلاقاً — فاختبار التنقية أظهر
// errorMessageSanitized=undefined لأن الاستخراج لم يقع أصلاً، لا لأن
// التنقية أخفقت. أُصلح بتوحيد المسارين على نفس دالّة الاستخراج.
async function extractAndSanitizeEnvelope(resp, entry) {
  entry.status = resp.status;
  entry.ok = resp.ok;
  try {
    const clone = resp.clone();
    const envelope = await clone.json();
    entry.model = envelope.model || null;
    entry.finishReason = (envelope.choices && envelope.choices[0]) ? envelope.choices[0].finish_reason : null;
    entry.usage = envelope.usage || null;
    if (!resp.ok) {
      // لا نصّ خام أبداً — status/type/code فقط + رسالة مُنقّاة (القاعدة 36).
      const errObj = (envelope && envelope.error) || {};
      entry.errorStatus = resp.status;
      entry.errorType = errObj.type || null;
      entry.errorCode = errObj.code || null;
      entry.errorMessageSanitized = sanitizeText(String(errObj.message || '').slice(0, 300));
    }
  } catch (e) {
    entry.captureError = sanitizeText(String((e && e.message) || e));
  }
}

const realFetch = global.fetch;
global.fetch = async function(url, options) {
  const host = hostOf(url);
  const entry = {seq: networkLog.length + 1, host, at: new Date().toISOString()};
  const isGemini = host === GEMINI_HOST || host.includes('generativelanguage.googleapis.com');

  if (host !== ALLOWED_HOST && !(isGemini && ALLOW_GEMINI)) {
    entry.blocked = true;
    entry.reason = isGemini ?
        (ALLOW_GEMINI ? 'Gemini مسموح بالعلَم لكن الاستضافة لا تطابق GEMINI_HOST المثبَّتة' : 'Gemini محجوب — --allow-gemini لم يُمرَّر (الافتراضي: DeepSeek وحده)') :
        `HOST_NOT_ALLOWED: ${host}`;
    networkLog.push(entry);
    console.error(`[network-guard] BLOCKED قبل الإرسال — ${entry.reason}`);
    if (isGemini && !ALLOW_GEMINI) {
      // أمر مستخدم 2026-09-23 +03 (بعد انتهاء القياس العشاري) — تصحيح:
      // هذا **يطابق** قرار الإنتاج، لا ينحرف عنه. منذ الالتزام 5920ff0
      // (functions/src/utils/resolveGeminiFallbackConfig.js)، الإنتاج
      // نفسه يحجب Gemini افتراضياً على مسار V7 (settings/geminiFallback.enabled
      // غائبة/false → PROVIDER_FAILED_NO_FALLBACK، بلا نداء Gemini، بلا
      // رمي — القرار المنقول PLAN-01-ROADMAP.md §P1.8 القرار 3، خارج هذا
      // المستودع). الإنتاج (قبل 5920ff0) كان المخالف لهذا القرار، لا هذا
      // القياس. **--allow-gemini (أمر مستخدم 2026-10-01 +03) يفتح استثناءً
      // صريحاً لهذا القياس تحديداً فقط — لا يغيّر الإنتاج.**
      console.error('[network-guard] ✓ يطابق قرار الإنتاج (5920ff0) — Gemini مُعطَّل افتراضياً هناك أيضاً، لا انحراف.');
    }
    const err = new Error(entry.reason);
    err.isNetworkGuardBlock = true;
    throw err;
  }

  // القاعدة 35 — السقف عند نقطة الخروج، منفصل لكل وجهة (DeepSeek 40،
  // Gemini 4 حين مسموحة صراحة) — لا سقف مشترك يُخفي أيّهما استهلك الحصّة.
  if (isGemini) {
    if (geminiNetworkRequestCount >= GEMINI_MAX_NETWORK_REQUESTS) {
      entry.blocked = true;
      entry.reason = `CAP_REACHED(gemini): السقف ${GEMINI_MAX_NETWORK_REQUESTS} طلبات بلغ — رُفض الطلب رقم ${geminiNetworkRequestCount + 1} قبل الإرسال`;
      networkLog.push(entry);
      console.error(`[network-guard] BLOCKED — ${entry.reason}`);
      const err = new Error(entry.reason);
      err.isNetworkGuardBlock = true;
      throw err;
    }
    geminiNetworkRequestCount++;
    entry.allowedSeq = `gemini:${geminiNetworkRequestCount}`;
  } else {
    if (networkRequestCount >= MAX_NETWORK_REQUESTS) {
      entry.blocked = true;
      entry.reason = `CAP_REACHED: السقف ${MAX_NETWORK_REQUESTS} طلبات بلغ — رُفض الطلب رقم ${networkRequestCount + 1} قبل الإرسال`;
      networkLog.push(entry);
      console.error(`[network-guard] BLOCKED — ${entry.reason}`);
      const err = new Error(entry.reason);
      err.isNetworkGuardBlock = true;
      throw err;
    }
    networkRequestCount++;
    entry.allowedSeq = networkRequestCount;
  }

  let resp;
  if (SIMULATE) {
    entry.simulated = true;
    if (!simulatedQueue || simulatedQueue.length === 0) {
      entry.reason = 'SIMULATE_QUEUE_EMPTY: لا استجابة مُحاكاة مُهيَّأة — يُسقط التشغيل (لا نداء حقيقي بديل)';
      networkLog.push(entry);
      const err = new Error(entry.reason);
      err.isNetworkGuardBlock = true;
      throw err;
    }
    resp = simulatedQueue.shift();
  } else {
    // ⚠️ الفرع الوحيد الذي يُصدر طلباً حقيقياً — لا يُنفَّذ أبداً من
    // --simulate ولا --dry-run (--dry-run يتوقّف قبل الوصول هنا أصلاً).
    // أيّ وكيل يقرأ هذا الملفّ: **لا تُشغّل هذا الفرع بنفسك** — راجع
    // التصحيح أعلى الملفّ.
    const t0 = Date.now();
    resp = await realFetch(url, options);
    entry.headerMs = Date.now() - t0;
  }

  await extractAndSanitizeEnvelope(resp, entry);
  networkLog.push(entry);
  return resp;
};

// ═══════════════════════════════════════════════════════════════════════
// فخّ — لا Firestore، لا firebase-admin (بلا تغيير عن الجولة السابقة).
// ═══════════════════════════════════════════════════════════════════════
let firestoreTrapHits = 0;
const ADMIN_PATH = require.resolve('../src/utils/admin');
const fakeAdminExports = {
  admin: {
    apps: [],
    initializeApp() { throw new Error('TRAP: admin.initializeApp() — ممنوع في هذا السكربت'); },
    firestore() { throw new Error('TRAP: admin.firestore() — ممنوع في هذا السكربت'); },
  },
  db: {
    collection(name) {
      firestoreTrapHits++;
      throw new Error(`TRAP: Firestore db.collection("${name}") استُدعيت — ممنوع في هذا السكربت.`);
    },
  },
  ADMIN_EMAILS: [],
  requireAdmin() { throw new Error('TRAP: requireAdmin() استُدعيت'); },
};
require.cache[ADMIN_PATH] = {
  id: ADMIN_PATH, filename: ADMIN_PATH, loaded: true, exports: fakeAdminExports, children: [], paths: [],
};

// ═══════════════════════════════════════════════════════════════════════
// حقن — سقف 5 نداءات callAIv7 (منطقيّة) + التقاط تفصيل كل محاولة —
// إضافي فوق سقف الشبكة أعلاه (ذاك يحمي الشبكة، هذا يحمي المنطق ويُسجّل
// التفصيل الذي لا يسجّله resolveV7Report.js نفسه — rounds[] هناك مُختصَر،
// guardOk بوليانياً لا guard كاملاً، ولا priorRejection المُرسَل).
// ═══════════════════════════════════════════════════════════════════════
const CALL_AI_PATH = require.resolve('../src/analysis/callAI');
const realCallAI = require(CALL_AI_PATH);
// ثانويّ لا مُلزِم (القاعدة 35 — الملزِم عند fetch، MAX_NETWORK_REQUESTS
// أعلاه). كان ثابتاً بافتراض "فحصان" دائماً (RUNS × 2 × 2) — تصحيح
// المنسّق 2026-10-01 +03 (بعد f7d6201) جعل عدد الأهداف مُتغيّراً
// (--replay-input)، فصار هذا الافتراض خاطئاً أحياناً. let لا const —
// main() تُعيد حسابها بعد بناء TARGETS الفعلية (عدد الأهداف الحقيقي ×
// RUNS × حتى محاولتَي resolveV7Report للقرار ٢١). القيمة الافتراضية هنا
// (قبل أن تُعاد main() حسابها) تفترض هدفاً واحداً فقط — أضيق احتياط ممكن،
// لا أوسع من اللازم لأي مسار لا يستدعي main() (--simulate مثلاً، لا يمسّ
// هذا الثابت إطلاقاً أصلاً).
let MAX_TOTAL_CALLAIV7_CALLS = RUNS * 1 * 2;
let totalCallAIv7Calls = 0;
const callAIv7CallLog = [];

const wrappedCallAI = Object.assign({}, realCallAI, {
  callAIv7: async (params) => {
    totalCallAIv7Calls++;
    if (totalCallAIv7Calls > MAX_TOTAL_CALLAIV7_CALLS) {
      throw new Error(`CALL_CAP_EXCEEDED: رُفض النداء رقم ${totalCallAIv7Calls} — السقف ${MAX_TOTAL_CALLAIV7_CALLS} نداءات إجمالاً`);
    }
    const seq = totalCallAIv7Calls;
    console.error(`[measure-resolve-live] callAIv7 — النداء رقم ${seq}/${MAX_TOTAL_CALLAIV7_CALLS} (scanId=${params.scanContext && params.scanContext.scanId})`);
    const startSeqNet = networkLog.length;
    try {
      const result = await realCallAI.callAIv7(params);
      // القرار ٢ — الخام يُحفَظ في ملفّ المخرَج كاملاً (JSON.stringify أدناه
      // في measureOne)، **لا يُطبَع في الطرفية كاملاً أبداً**. سطر console.error
      // أعلاه لا يذكره؛ ما يُطبَع لاحقاً (طوله فقط) يمرّ بالتنقية كأي نصّ آخر.
      const rawLen = typeof result.rawResponseText === 'string' ? result.rawResponseText.length : 0;
      console.error(`[measure-resolve-live] callAIv7 #${seq} — rawResponseText: ${rawLen} حرفاً (محفوظ في الملفّ، غير مطبوع)`);
      callAIv7CallLog.push({
        seq, scanId: params.scanContext && params.scanContext.scanId,
        priorRejectionSent: params.priorRejection || null, threw: null,
        result: {aiModel: result.aiModel, duration: result.duration, bodyBuildMs: result.bodyBuildMs, pipeline: result.pipeline, guard: sanitizeDeep(result.guard)},
        // خام كامل — يُكتَب إلى ملفّ JSON محلّي فقط (functions/scripts/out/)،
        // لا يمرّ عبر Firestore ولا عبر أي مسار يصل عميلاً (القيد الصريح:
        // "لا تكتب الخام في أيّ مستند Firestore" — هذا ملفّ محلّي، لا مستند).
        rawResponseText: result.rawResponseText || null,
        network: networkLog.slice(startSeqNet),
      });
      return result;
    } catch (e) {
      callAIv7CallLog.push({
        seq, scanId: params.scanContext && params.scanContext.scanId,
        priorRejectionSent: params.priorRejection || null,
        threw: sanitizeText(String((e && e.message) || e)), result: null,
        network: networkLog.slice(startSeqNet),
      });
      throw e;
    }
  },
});
require.cache[CALL_AI_PATH].exports = wrappedCallAI;

const {resolveV7Report} = require('../src/analysis/resolveV7Report');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {EXPECTED_V7_PAYLOAD_BYTES, GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');

// ═══════════════════════════════════════════════════════════════════════
// البند ٦ — النموذج: الفخّ يُسقِط resolveAiConfig إلى deepseek-flash
// دائماً (settings/ai لا تُقرأ فعلياً — Firestore مُفخَّخ أعلاه). إن كان
// الإنتاج الحقيقي يسمّي نموذجاً آخر عبر settings/ai، فهذا القياس **لا
// يمثّله** — يُسجَّل صراحة في كل مخرَج، لا يُفترَض ضمنياً.
// ═══════════════════════════════════════════════════════════════════════
// نصّ منقول من المنسّق (أمر 2026-09-23 +03، الفقرة "٣. النموذج")، مصدره
// NEURALCHECK-FINDINGS.md:214 في مساحة العمل (خارج هذا المستودع، لا يمكن
// التحقّق منه من هنا) — "منقول، غير متحقَّق" حرفياً حسب القاعدة 29:
// settings/ai غائب فعلياً من Firestore (404) في الإنتاج اليوم، فسقوط
// resolveAiConfig إلى deepseek-flash **يمثّل الإنتاج الفعلي حالياً** لا
// انحرافاً عنه فقط بسبب فخّ هذا السكربت.
const MODEL_NOTE = 'النموذج: الافتراضي — settings/ai غير موجود (404) في الإنتاج اليوم؛ إن أُنشئ تغيّر هذا. [منقول من المنسّق، NEURALCHECK-FINDINGS.md:214 — غير متحقَّق من هذا المستودع]';

// ═══════════════════════════════════════════════════════════════════════
// أدوات بناء استجابات DeepSeek مُحاكاة — تُستعمَل في --simulate فقط.
//
// تصحيح 2026-09-23 +03 (أمر مستخدم لاحق، القرار ٢): العطب الحقيقي المذكور
// سابقاً هنا (reportShape.js يرفض شكل V7 بـshape_invalid) **أُصلح فعلياً**
// في src/analysis/reportShapeV7.js (V7_SHAPE_KEYS/V7_CORE_KEY_GROUPS
// مُصدَّرتان) وsrc/analysis/callAI.js (V7_SHAPE_SPEC تمرّ عبر
// callDeepSeekWithRetry/callGeminiFallback في مسار callAIv7 وحده) — راجع
// commit منفصل. **لا حاجة بعد الآن لأي حقل توافقي مُضاف** في بيانات
// السيناريو — الحقل `summary` المُضاف سابقاً حُذف كلّياً.
//
// وتصحيح ثانٍ، القرار نفسه، نصّ المستخدم حرفياً: "المحاكاة عُدِّلت لتمرّ،
// فصارت تُثبت أن الكود يقبل ما صنعناه له لا ما يصل فعلاً. والقاعدة 23
// تسري: الاختبار الذي كان يُثبت السلوك الخاطئ يُستبدَل، لا يُضاف إليه."
// السيناريوهات أدناه **لا تبني** أجسام رد من الصفر — تُعيد استعمال
// rawEnvelope الحقيقي الكامل كما وصل فعلياً من DeepSeek في أربعة نداءات
// مأذونة حقيقية سابقة (v7-live-*.json)، بلا أي حقل مُضاف أو مُعدَّل. عدد
// الاحتمالات الأربع المسجَّلة يقيّد ماذا يُختبَر: b45c8cf6(23:39) هو
// الوحيد المرفوض (guard.ok=false بسبب "ot")، فسيناريو "رفض ثم نجاح"
// يستعمله كمحاولة أولى ثم ردّاً حقيقياً آخر مقبولاً (b45c8cf6 الأقدم،
// commit d5069bd) كمحاولة ثانية — كلاهما على سياق b45c8cf6 نفسه. سيناريو
// "رفض مرّتين" يُعيد استعمال b45c8cf6(23:39) **نفسه حرفياً** مرّتين — لا
// تعديل، وتكراره واقعي فعلاً عند temperature=0.1 شبه الحتمي (نفس المنطق
// المُتحقَّق منه في callDeepSeekV7ShapeE2E.test.js).
//
// سيناريو الفشل الصلب (٤) وحده يبقى بجسم خطأ 500 غير مأخوذ من تسجيل حقيقي
// (لا وجود لتسجيل حقيقي لفشل نقل — كل النداءات الأربعة المسجَّلة نجحت
// نقلاً بـHTTP 200)؛ هذا خارج نطاق "جسم ردّ تقرير" الذي يخصّه القرار ٢
// أصلاً (لا شكل V7 فيه يُختبَر، فشل نقل خام قبل أي تحليل).
// ═══════════════════════════════════════════════════════════════════════
const LIVE_FILES = {
  b45Rejected: 'v7-live-b45c8cf6-e376-4765-8703-f68e9bc69844-2026-09-22T23-39-25-313Z.json', // guard.ok=false — "ot"
  b45Accepted: 'v7-live-b45c8cf6-e376-4765-8703-f68e9bc69844.json', // commit d5069bd — guard.ok=true
  d34Accepted: 'v7-live-34dff2b8-ce9e-4b40-86a9-1976c878e195-2026-09-22T23-40-34-274Z.json', // guard.ok=true
};
function loadRealEnvelope(fileKey) {
  const j = JSON.parse(fs.readFileSync(path.join(OUT_DIR, LIVE_FILES[fileKey]), 'utf8'));
  return j.rawEnvelope;
}
function envelopeResponse(rawEnvelope) {
  return new Response(JSON.stringify(rawEnvelope), {status: 200, headers: {'content-type': 'application/json'}});
}
function deepseekErrorResponse(status, message, retryableKind) {
  const envelope = retryableKind === 'provider_error' ?
      {error: {message, type: 'server_error', code: 'internal_error'}} :
      {error: {message, type: 'authentication_error', code: 'invalid_request_error'}};
  return new Response(JSON.stringify(envelope), {status, headers: {'content-type': 'application/json'}});
}

// ⚠️ **تصحيح المنسّق 2026-10-01 +03 ("fix قبل النداءات الحيّة"، البند ٢)**:
// كانت computeCategoryStates تُستدعى هنا بلا analyzedAtMs إطلاقاً — بوّابة
// PATCH_AGE تصل حالة UNKNOWN (لا تقع في الإنتاج الحيّ أبداً، راجع تعليق
// ANALYZED_AT_MS في expectedV7PayloadBytes.test.js) فتختلف حمولة النموذج
// المقيسة هنا عن حمولة الاختبار المرجعي (68986 لا 68989 — مُتحقَّق فعلياً
// قبل هذا التصحيح). الإصلاح: GOLDEN_ANALYZED_AT_MS من expectedV7PayloadBytes.js
// (القاعدة 24 — المصدر الذي تستعمله expectedV7PayloadBytes.test.js نفسه
// الآن، لا نسخة محلّية ثانية) — فبوّابة --dry-run الذهبية تطابق الاختبار
// حرفياً من الآن.
function buildScanInputs(scanId, tsFile) {
  const raw = loadJson(tsFile);
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const functional = frMap[scanId];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
    analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  return {findings, categoryStates, scanId};
}

// ─── S1-٢ — نفس بناء buildScanInputs، من مُدخل export-v7-replay-inputs-
// readonly.js بدل عيّنة ذهبية (fingerprint كامل حقيقي: device/timeSeries
// بعيّناته الحقيقية المُستعادة من Storage/functionalResults/manualResults).
// **لا نداء Firestore/Storage هنا** — الملفّ قُرئ سلفاً بأداة قراءة منفصلة
// (export-v7-replay-inputs-readonly.js)؛ هذا الملفّ لا يفتح أي اتّصال شبكة
// بنفسه، فقط fs.readFileSync محلّي.
//
// ⚠️ **تصحيح المنسّق 2026-10-01 +03 ("fix قبل النداءات الحيّة"، البند ١)**:
// كانت computeCategoryStates تُستدعى هنا أيضاً بلا analyzedAtMs — نفس عطب
// buildScanInputs أعلاه، وبأثر أخطر هنا: **الحمولة المُرسَلة فعلياً للنموذج
// كانت ستحمل بوّابة PATCH_AGE بحالة UNKNOWN**، تختلف عن حالتها الحقيقية في
// الإنتاج (FIRED على NC-5DYV7N/NC-83XL4C عند 62.0 شهراً، NOT_FIRED على
// NC-TM7PDN عند 20.9 شهراً — من aiAudit.gatesApplied الحقيقي، نقلها
// المنسّق) — قياس لمسار غير المسار المنشور فعلياً (القاعدة 37).
//
// الإصلاح: `analyzedAtMs` مُعاملاً صريحاً الآن — main() يلتقط Date.now()
// **مرّة واحدة** عند بدء هذا التشغيل (بمثل functionStartTime حقيقياً في
// analyzeDevice.js:346 — رقم خادم واحد يُستعمَل لكل الأفعال ضمن النداء
// نفسه)، ويمرّره لكل أهداف --replay-input معاً — لا Date.now() جديد لكلّ
// هدف (ذلك كان يُنتج حالة PATCH_AGE مختلفة بين هدفين لو استغرق التشغيل
// وقتاً بين الاثنين، وإن لم يكن فرقاً مؤثّراً عملياً هنا إلا أنه انجراف
// غير مُبرَّر عن نمط "قيمة واحدة لكل التحليل").
//
// ⚠️ **أدقّ من Date.now() نظرياً — لم يُطبَّق، يحتاج قرار مستخدم صريح**:
// وقت تحليل التقرير **الأصلي** الحقيقي (`reports/{scanId}.analyzedAt` —
// الحقل نفسه الذي يكتبه analyzeDevice.js:311) كان سيُعيد إنتاج "شهور"
// PATCH_AGE **بالرقم العشري نفسه** الذي رآه النموذج فعلياً وقت الإنتاج، لا
// بتقريب الآن. **التكلفة**: الحقل غائب اليوم من مخرَج export-v7-replay-
// inputs-readonly.js (مُتحقَّق: لا analyzedAt في الملفّات الثلاثة الحالية
// — تأكيد المنسّق) — إضافته تحتاج (أ) تعديل ذلك السكربت (خارج نطاق هذا
// الإصلاح، لم يُؤمَر به)، و(ب) إعادة تصدير الثلاثة تقارير من Firestore من
// طرفيّة المستخدم (اعتماد Admin SDK، لا أملكه ولا أُشغّله). بـDate.now()
// الحالي: نفس **الحالة المُتقطِّعة** (FIRED/NOT_FIRED) تصل مطابقة للإنتاج
// (62/62/20.9 شهراً اليوم تتجاوز/لا تتجاوز 36 بفارق كافٍ ليبقى اتّجاه
// المقارنة ثابتاً مهما تأخّر التشغيل أسابيع) — الفارق الوحيد نصّ "شهراً"
// الدقيق في `source`، لا الحالة المرسَلة فعلياً للنموذج. لم أُطبِّق البديل
// الأدقّ بلا موافقة صريحة كما طُلب.
//
// @param {string} replayInputPath مسار ملفّ JSON (مخرَج الأداة الأولى)
// @param {number} analyzedAtMs وقت واحد مُلتقَط لهذا التشغيل (Date.now())
// @return {{findings: Object, categoryStates: Object, scanId: string,
//   language: string, isFreeTrial: boolean, samplesAvailable: boolean}}
function buildScanInputsFromReplayFile(replayInputPath, analyzedAtMs) {
  const replay = JSON.parse(fs.readFileSync(path.resolve(replayInputPath), 'utf8'));
  const fp = replay.fingerprint;
  if (!fp || typeof fp !== 'object') {
    throw new Error(`buildScanInputsFromReplayFile: توقّف — ${replayInputPath} بلا .fingerprint صالح`);
  }
  const samplesAvailable = Array.isArray(fp.timeSeries && fp.timeSeries.samples);
  if (!samplesAvailable) {
    // القاعدة 22 — لا افتراض أن غياب العيّنات "لا بأس به هنا"؛ يُبلَّغ
    // صراحة ويُستمَرّ (computeFindings تتحمّل timeSeries بلا samples —
    // بعض القنوات تخرج "غير مقيس" بدل قيمة، وهذا مُتوقَّع ومقصود حين
    // samplesSource.state='UNAVAILABLE' من الأداة الأولى).
    console.error(`[measure-resolve-live][replay] ⚠ ${replayInputPath}: لا عيّنات زمنية فعلية (samplesSource.state=${(replay.samplesSource && replay.samplesSource.state) || '؟'}) — القياس سيتابع بقنوات "غير مقيس" حيث تعتمد على العيّنات.`);
  }
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(fp.timeSeries || {});
  const categoryStates = computeCategoryStates({
    functionalResults: fp.functionalResults, manualResults: fp.manualResults || [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
    analyzedAtMs,
  });
  return {
    findings, categoryStates, scanId: replay.scanId,
    language: (typeof replay.language === 'string') ? replay.language : 'ar',
    isFreeTrial: !!replay.isFreeTrial,
    samplesAvailable,
  };
}

/**
 * يستخرج حالة بوّابة PATCH_AGE من categoryStates.overall.gatesApplied —
 * دالّة خالصة، بلا أي حساب جديد (القاعدة 24: applyOverallCeilings يدفع
 * **كل** بوّابة إلى gatesApplied بصرف النظر عن status، categoryStates.js:447-450
 * — لا إعادة اشتقاق هنا). تُستعمَل لطباعة حالة PATCH_AGE **قبل أي إرسال**
 * لكل هدف --replay-input (أمر مستخدم 2026-10-01 +03، البند ١).
 * @param {Object} categoryStates
 * @return {{status: string, source: (string|null)}|null} null إن غابت
 *   البوّابة من الرسم أصلاً (غير متوقَّع اليوم — computeGates تدفعها دائماً
 *   — لكن لا افتراض صامت هنا، القاعدة 22).
 */
function extractPatchAgeGate(categoryStates) {
  const applied = (categoryStates && categoryStates.overall && Array.isArray(categoryStates.overall.gatesApplied)) ?
      categoryStates.overall.gatesApplied : [];
  const hit = applied.find((g) => g && g.name === 'PATCH_AGE');
  return hit ? {status: hit.status, source: hit.source || null} : null;
}

// ═══════════════════════════════════════════════════════════════════════
// --simulate — أربعة سيناريوهات + بلوغ السقف + التنقية. صفر طلب حقيقي.
// ═══════════════════════════════════════════════════════════════════════
// {outDir} اختياري — يُعيد توجيه ملفّ الملخّص النهائي فقط (loadRealEnvelope
// يبقى يقرأ من OUT_DIR الحقيقية دائماً، لأن ملفّات LIVE_FILES المصدرية
// تعيش هناك فقط). الافتراض (بلا معامل) هو OUT_DIR نفسها — سلوك CLI الحالي
// بلا أي تغيير. {write:false} يُلغي الكتابة كلياً (يُعيد summary فقط، بلا
// أي ملفّ) — مفيد لاختبار يريد summary دون أي أثر على القرص إطلاقاً.
async function runSimulateSuite({outDir, write = true} = {}) {
  const targetDir = outDir || OUT_DIR;
  console.log('═══ --simulate — صفر طلب شبكة حقيقي، fetch مُحاكى بالكامل ═══');
  console.log('كل جسم رد تقرير أدناه رد حقيقي مسجَّل فعلياً (rawEnvelope كاملاً، بلا أي حقل مُضاف) — القرار ٢.\n');
  const b45 = buildScanInputs('b45c8cf6-e376-4765-8703-f68e9bc69844', 'b45c8cf6.ts.json');
  const d34 = buildScanInputs('34dff2b8-ce9e-4b40-86a9-1976c878e195', '34dff2b8.ts.json');
  function paramsFor(ctx, deadline) {
    return {
      findings: ctx.findings, categoryStates: ctx.categoryStates, language: 'ar',
      scanContext: {scanId: ctx.scanId, isFreeTrial: false},
      previousScan: null, deepseekApiKey: 'SIMULATED-NOT-REAL', geminiApiKey: undefined,
      deadline,
    };
  }
  const summary = {generatedAt: new Date().toISOString(), scenarios: {}};
  let allOk = true;

  async function runScenario(name, ctx, queue, expectFn, deadline) {
    networkRequestCount = 0; // كل سيناريو نافذة سقف مستقلّة — لا تراكم صناعي بين سيناريوهات منفصلة
    totalCallAIv7Calls = 0;
    simulatedQueue = queue;
    console.log(`\n── سيناريو: ${name} (سياق ${ctx.scanId}) ──`);
    let result = null; let threw = null;
    try {
      result = await resolveV7Report(paramsFor(ctx, deadline));
    } catch (e) {
      threw = sanitizeText(String((e && e.message) || e));
    }
    const outcome = {threw, result: result ? {
      aiModel: result.aiModel, narrativeIncomplete: result.display.narrativeIncomplete,
      narrativeIncompleteFields: result.display.narrativeIncompleteFields,
      guardFinalOk: result.guardFinal.ok,
      regenerationRejectedReasons: result.audit && result.audit.regeneration ?
          result.audit.regeneration.rounds.flatMap((r) => r.rejectedReasons || []) : [],
    } : null};
    const pass = expectFn(outcome);
    console.log(`  المخرَج: ${JSON.stringify(outcome)}`);
    console.log(`  ${pass ? '✓ مطابق للمتوقَّع' : '✗ غير مطابق للمتوقَّع'}`);
    if (!pass) allOk = false;
    summary.scenarios[name] = {outcome, pass, networkCalls: networkRequestCount};
    if (simulatedQueue.length !== 0) {
      console.log(`  ⚠ بقيت ${simulatedQueue.length} استجابة(ات) مُهيَّأة لم تُستهلَك`);
    }
  }

  await runScenario(
      '١. نجاح من المحاولة الأولى',
      d34,
      [envelopeResponse(loadRealEnvelope('d34Accepted'))],
      (o) => !o.threw && o.result && o.result.guardFinalOk === true && o.result.narrativeIncomplete === false,
  );

  await runScenario(
      '٢. رفض ثم نجاح',
      b45,
      [envelopeResponse(loadRealEnvelope('b45Rejected')), envelopeResponse(loadRealEnvelope('b45Accepted'))],
      (o) => !o.threw && o.result && o.result.guardFinalOk === true && o.result.narrativeIncomplete === false,
  );

  await runScenario(
      '٣. رفض مرّتين → عرض جزئي',
      b45,
      [envelopeResponse(loadRealEnvelope('b45Rejected')), envelopeResponse(loadRealEnvelope('b45Rejected'))],
      (o) => !o.threw && o.result && o.result.guardFinalOk === false && o.result.narrativeIncomplete === true &&
          o.result.narrativeIncompleteFields.length > 0,
  );

  // أمر مستخدم 2026-09-23 +03، البند ٧ (القاعدة 23 — التوقّع الخاطئ
  // يُستبدَل، لا يُضاف إليه): التوقّع القديم هنا (رمي يحمل "Gemini محجوب")
  // كان يفترض أن providerFailedNoFallback يُترجَم إلى استثناء يُرمى.
  // العطب الحقيقي: resolveV7Report **لا يرمي أبداً** في هذه الحالة —
  // buildProviderFailedOutcome (resolveV7Report.js) يبني عرضاً حتمياً
  // كاملاً بسبب مُسمّى PROVIDER_FAILED_NO_FALLBACK في rejectedReasons،
  // تماماً كما تُختبَر الحالة تفصيلياً في callAIv7.test.js/resolveV7Report.test.js.
  // تحقّقت مباشرة (fetch مُحاكى لـ500 مرّتين، بلا --simulate كامل): threw=null،
  // fetchCallCount=2، guardFinal.ok=false، narrativeIncomplete=true،
  // rejectedReasons=["PROVIDER_FAILED_NO_FALLBACK: ..."] — لا رمي إطلاقاً.
  await runScenario(
      '٤. فشل DeepSeek الصلب (500 مرّتين) + Gemini محجوب',
      b45,
      [deepseekErrorResponse(500, 'Internal server error (simulated)', 'provider_error'),
        deepseekErrorResponse(500, 'Internal server error (simulated)', 'provider_error')],
      (o) => !o.threw && o.result && o.result.guardFinalOk === false && o.result.narrativeIncomplete === true &&
          o.result.regenerationRejectedReasons.some((r) => /PROVIDER_FAILED_NO_FALLBACK/.test(r)),
  );

  // ═══════════════════════════════════════════════════════════════════
  // ٥. الميزانية الزمنية (القرار ١، أمر مستخدم لاحق 2026-09-23 +03، البند
  // ٥: "أضف إلى --simulate ... سيناريو الميزانية الزمنية"). موعد نهائي
  // قريب جداً (500ms، أقلّ بكثير من AI_ATTEMPT_NEEDED_MS) على جسم حقيقي
  // مرفوض — لا محاولة٢، fetch=1، عرض جزئي بسبب TIME_BUDGET_EXHAUSTED.
  // نفس الآلية المُختبَرة تفصيلياً في test/resolveV7ReportTimeBudget.test.js
  // (12/12) — هنا للظهور داخل --simulate الخاصّ بهذا السكربت تحديداً.
  // ═══════════════════════════════════════════════════════════════════
  await runScenario(
      '٥. الميزانية الزمنية — موعد نهائي قريب جداً',
      b45,
      [envelopeResponse(loadRealEnvelope('b45Rejected'))], // واحدة فقط — لو حاول محاولة٢ سيرمي "قائمة فارغة"
      (o) => !o.threw && o.result && o.result.guardFinalOk === false &&
          o.result.regenerationRejectedReasons.some((r) => /TIME_BUDGET_EXHAUSTED/.test(r)),
      Date.now() + 500, // deadline — أقلّ بكثير من AI_ATTEMPT_NEEDED_MS (185000ms)
  );
  console.log(`  (AI_ATTEMPT_NEEDED_MS = ${realCallAI.AI_ATTEMPT_NEEDED_MS}ms — المرجع المُشتقّ من callAI.js، لا رقم جديد)`);

  // ═══════════════════════════════════════════════════════════════════
  // ٦. دورات متعدّدة (القرار ٥، البند "وسِّع ... بخيار --runs N"). يُثبت أن
  // السيناريو الناجح يُعاد تشغيله N مرّة متتالية بلا تراكم أو تلوّث حالة
  // بين الدورات (نفس الآلية التي يعتمدها --runs N في الوضع الحقيقي —
  // measureOne تُستدعى مرّة لكل دورة هناك بالضبط كما هنا).
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n── سيناريو: ٦. دورات متعدّدة (محاكاة --runs) ──');
  const MULTI_RUN_COUNT = 3;
  const multiRunResults = [];
  for (let i = 1; i <= MULTI_RUN_COUNT; i++) {
    networkRequestCount = 0;
    simulatedQueue = [envelopeResponse(loadRealEnvelope('d34Accepted'))];
    const r = await resolveV7Report(paramsFor(d34));
    multiRunResults.push({run: i, guardFinalOk: r.guardFinal.ok, networkCalls: networkRequestCount});
  }
  const multiRunPass = multiRunResults.every((r) => r.guardFinalOk === true && r.networkCalls === 1);
  console.log(`  ${JSON.stringify(multiRunResults)}`);
  console.log(`  ${multiRunPass ? '✓ ' + MULTI_RUN_COUNT + ' دورات متتالية، كلّها متطابقة النتيجة، صفر تلوّث حالة بينها' : '✗ فشل — راجع التفصيل أعلاه'}`);
  if (!multiRunPass) allOk = false;
  summary.multiRunTest = {results: multiRunResults, pass: multiRunPass};

  // ─── بلوغ السقف عند الطلب الحادي والأربعين (أمر مستخدم لاحق 2026-09-23
  // +03، القرار ٥: السقف رُفع 5→40 — "عشرون طلباً، وأكثر إن لزم"، وأسوأ
  // حال 10 تشغيلات × محاولتان × طلبا DeepSeek = 40) — استدعاء fetch مباشرة
  // MAX_NETWORK_REQUESTS+1 مرّة ──────────────────────────────────────────
  console.log(`\n── اختبار: بلوغ السقف عند الطلب رقم ${MAX_NETWORK_REQUESTS + 1} ──`);
  networkRequestCount = 0;
  const okEnv = loadRealEnvelope('d34Accepted');
  simulatedQueue = Array.from({length: MAX_NETWORK_REQUESTS}, () => envelopeResponse(okEnv));
  const capResults = [];
  for (let i = 1; i <= MAX_NETWORK_REQUESTS + 1; i++) {
    try {
      await global.fetch('https://api.deepseek.com/chat/completions', {method: 'POST', body: '{}'});
      capResults.push({seq: i, blocked: false});
    } catch (e) {
      capResults.push({seq: i, blocked: true, reason: sanitizeText(e.message)});
    }
  }
  const capPass = capResults.slice(0, MAX_NETWORK_REQUESTS).every((r) => !r.blocked) &&
      capResults[MAX_NETWORK_REQUESTS].blocked && /CAP_REACHED/.test(capResults[MAX_NETWORK_REQUESTS].reason);
  console.log(`  [${capResults.slice(0, 3).map((r) => JSON.stringify(r)).join(', ')}, ... , ${JSON.stringify(capResults[MAX_NETWORK_REQUESTS - 1])}, ${JSON.stringify(capResults[MAX_NETWORK_REQUESTS])}]`);
  console.log(`  ${capPass ? `✓ الطلب رقم ${MAX_NETWORK_REQUESTS + 1} رُفض قبل الإرسال، الـ${MAX_NETWORK_REQUESTS} الأولى مرّت` : '✗ فشل — راجع التفصيل أعلاه'}`);
  if (!capPass) allOk = false;
  summary.capTest = {maxNetworkRequests: MAX_NETWORK_REQUESTS, results: capResults, pass: capPass};

  // ─── التنقية — استجابة 401 تحمل طرف مفتاح مُصطنَع، لا يظهر في الطرفية ──
  console.log('\n── اختبار: التنقية (401 بطرف مفتاح مُصطنَع) ──');
  const FAKE_KEY_TAIL = 'zQ9x';
  process.env.DEEPSEEK_API_KEY = `sk-simulated-0000000000000000${FAKE_KEY_TAIL}`;
  KEY_FRAGMENTS = buildKeyFragments(); // إعادة بناء المقاطع بعد ضبط env مؤقّتاً لهذا الاختبار وحده
  networkRequestCount = 0;
  simulatedQueue = [deepseekErrorResponse(401, `Authentication Fails, Your api key: ****${FAKE_KEY_TAIL} is invalid`)];
  let capturedLog = '';
  const realErr = console.error;
  console.error = (...args) => { capturedLog += args.join(' ') + '\n'; };
  try {
    await global.fetch('https://api.deepseek.com/chat/completions', {method: 'POST', body: '{}'});
  } catch (e) { /* متوقَّع أن تمرّ الاستجابة لا أن تُرمى هنا — fetch لا يرمي على 4xx/5xx */ }
  console.error = realErr;
  delete process.env.DEEPSEEK_API_KEY;
  KEY_FRAGMENTS = buildKeyFragments();

  const lastEntry = networkLog[networkLog.length - 1];
  const sanitizeOk = lastEntry && lastEntry.errorMessageSanitized && !lastEntry.errorMessageSanitized.includes(FAKE_KEY_TAIL) &&
      !capturedLog.includes(FAKE_KEY_TAIL);
  console.log(`  errorMessageSanitized: ${lastEntry ? lastEntry.errorMessageSanitized : '(لا شيء)'}`);
  console.log(`  errorStatus/Type/Code: ${lastEntry ? `${lastEntry.errorStatus}/${lastEntry.errorType}/${lastEntry.errorCode}` : '(لا شيء)'}`);
  console.log(`  الطرف "${FAKE_KEY_TAIL}" في السجلّ الملتقَط بـconsole؟ ${capturedLog.includes(FAKE_KEY_TAIL)}`);
  console.log(`  ${sanitizeOk ? '✓ الطرف لا يظهر في الطرفية ولا في السجلّ الملتقَط' : '✗ تسرّب طرف المفتاح'}`);
  if (!sanitizeOk) allOk = false;
  summary.sanitizeTest = {errorMessageSanitized: lastEntry ? lastEntry.errorMessageSanitized : null, pass: sanitizeOk};

  let outPath = null;
  if (write) {
    fs.mkdirSync(targetDir, {recursive: true});
    outPath = path.join(targetDir, `measure-resolveV7Report-simulate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  }
  console.log(`\n${MODEL_NOTE}`);
  console.log(write ? `\nمخرَج --simulate الكامل محفوظ في: ${outPath}` : '\n(write:false — لا ملفّ مكتوب، summary مُعاد فقط)');
  console.log(`\n${allOk ? '✓ كل السيناريوهات مطابقة للمتوقَّع' : '✗ سيناريو واحد أو أكثر غير مطابق — راجع التفصيل أعلاه'}`);
  if (!allOk) process.exitCode = 1;
  return {summary, allOk, outPath};
}

// ═══════════════════════════════════════════════════════════════════════
// المفتاح — process.env وحده. لا gcloud secrets، لا محاكي، لا defineSecret.
// (غير مطلوب في --dry-run ولا --simulate — كلاهما صفر نداء حقيقي.)
// ═══════════════════════════════════════════════════════════════════════
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || undefined;

async function measureOne(target) {
  // S1-٢ — هدف حقيقي (replayInputPath) أو ذهبي (tsFile)، نفس الدالّة.
  const isReplay = !!target.replayInputPath;
  // أمر مستخدم 2026-10-01 +03 (البند ١) — main() يبني كل أهداف replay
  // مسبقاً (target.prebuilt) بنفس analyzedAtMs المطبوع قبل أي إرسال؛
  // إعادة استعماله هنا (لا إعادة بناء، ولا Date.now() ثانٍ قد يختلف) —
  // target.analyzedAtMs احتياط فقط لاستدعاء مباشر خارج main() (اختبار
  // مثلاً) لم يمرّ بخطوة البناء المسبق.
  const built = isReplay ?
      (target.prebuilt || buildScanInputsFromReplayFile(target.replayInputPath, target.analyzedAtMs)) :
      buildScanInputs(target.scanId, target.tsFile);
  const {findings, categoryStates} = built;
  const scanId = built.scanId || target.scanId;
  const language = isReplay ? built.language : 'ar';
  const isFreeTrial = isReplay ? built.isFreeTrial : false;

  const {userMessage} = buildV7Payload({
    findings, categoryStates, language, scanId, isFreeTrial, previousScan: null,
  });

  // بوّابة payloadBytes — **تُقاس لا تُقارَن** على هدف حقيقي (لا رقم
  // مرجعي معروف مسبقاً؛ ذلك بالضبط ما يُقاس هنا لأوّل مرّة على جهاز
  // بعينه). على هدف ذهبي تبقى بوّابة قطعية كما كانت (rule 39 regression
  // guard) — لا تغيير سلوكي هناك.
  if (isReplay) {
    console.log(`[measure-resolve-v7][${scanId}][replay] payloadBytes=${userMessage.length} (لا رقم مرجعي — هدف حقيقي، samplesAvailable=${built.samplesAvailable})`);
  } else {
    console.log(`[measure-resolve-v7][${scanId}] payloadBytes=${userMessage.length} (متوقَّع ${target.expectedPayloadBytes})`);
    if (userMessage.length !== target.expectedPayloadBytes) {
      throw new Error(`[${scanId}] بوّابة payloadBytes فشلت: ${userMessage.length} ≠ ${target.expectedPayloadBytes} — توقّف بلا نداء.`);
    }
    console.log(`[measure-resolve-v7][${scanId}] ✓ البوّابة اجتازت`);
  }

  if (DRY_RUN) {
    console.log(`[measure-resolve-v7][${scanId}] --dry-run: لا نداء resolveV7Report.`);
    return {scanId, dryRun: true, payloadBytes: userMessage.length};
  }

  // ⚠️ نقطة اللاعودة نحو نداء حقيقي — راجع التصحيح أعلى الملفّ قبل
  // تشغيل هذا المسار. لا يُنفَّذ هنا إلا عند تمرير لا --dry-run ولا
  // --simulate معاً (main() تمنع الوصول لهذه الدالّة أصلاً في تلك الحالة
  // ما لم يُصرَّح صراحة — راجع main()).
  const startLogIdx = callAIv7CallLog.length;
  const startTime = Date.now();
  let finalResult = null;
  let threw = null;
  try {
    finalResult = await resolveV7Report({
      findings, categoryStates, language,
      scanContext: {scanId, isFreeTrial},
      previousScan: null, deepseekApiKey: DEEPSEEK_API_KEY, geminiApiKey: GEMINI_API_KEY,
    });
  } catch (e) {
    threw = sanitizeText(String((e && e.message) || e));
    console.error(`[measure-resolve-v7][${scanId}] ✗ resolveV7Report رمت: ${threw}`);
  }
  const wallMs = Date.now() - startTime;
  const attemptsForThisScan = callAIv7CallLog.slice(startLogIdx);

  // أمر مستخدم 2026-09-30 +03 (البند ٧) — "يُقاس: رفض المحاولة الأولى."
  // المحاولة الأولى = attemptsForThisScan[0] (القرار ٢١: حتى محاولتان لكل
  // resolveV7Report — الثانية فقط بعد رفض الأولى). "رفض" هنا يعني guard.ok
  // === false على تلك المحاولة، أو استثناء (threw) قبل بلوغ الحارس أصلاً.
  const firstAttempt = attemptsForThisScan[0] || null;
  const firstAttemptRejected = firstAttempt ?
      (!!firstAttempt.threw || (firstAttempt.result && firstAttempt.result.guard && firstAttempt.result.guard.ok === false)) :
      null; // null = لا محاولة أصلاً وقعت (استثناء أسبق من callAIv7 نفسها)

  // أمر مستخدم 2026-09-30 +03 (البند ٧) — "وكل قاعدة من S5: هل خُرقت،
  // وأين." يُشغَّل فحص S5 الآلي (check-s5-narrative-rules.js، مصدر واحد —
  // القاعدة 24، لا نسخة منطق هنا) على narrative النهائي إن وُجد. القسم
  // الدلالي (عدّ يدوي) يُرفَق كما هو — لا حكم آلي عليه، للمراجعة البشرية.
  let s5Check = null;
  if (finalResult && finalResult.display && finalResult.display.narrative) {
    try {
      // eslint-disable-next-line global-require
      const {checkS5Rules} = require('./check-s5-narrative-rules');
      s5Check = checkS5Rules({narrative: finalResult.display.narrative}, {findings, categoryStates});
    } catch (e) {
      s5Check = {error: sanitizeText(String((e && e.message) || e))};
    }
  }

  const record = {
    scanId, requestedAt: new Date(startTime).toISOString(), completedAt: new Date().toISOString(),
    replayInput: isReplay ? {path: target.replayInputPath, samplesAvailable: built.samplesAvailable} : null,
    wallMs, payloadBytes: userMessage.length, modelNote: MODEL_NOTE, threw,
    firstAttemptRejected, attempts: attemptsForThisScan,
    s5Check,
    finalResult: finalResult ? {
      aiModel: finalResult.aiModel, duration: finalResult.duration, pipeline: finalResult.pipeline,
      bodyBuildMs: finalResult.bodyBuildMs, guardFinal: sanitizeDeep(finalResult.guardFinal),
      display: finalResult.display, audit: sanitizeDeep(finalResult.audit),
      narrativeIncomplete: finalResult.display.narrativeIncomplete,
      narrativeIncompleteFields: finalResult.display.narrativeIncompleteFields,
    } : null,
  };

  console.log(`[measure-resolve-v7][${scanId}] firstAttemptRejected=${firstAttemptRejected} — attempts=${attemptsForThisScan.length} — ` +
      `S5 مخالفات آلية=${s5Check && !s5Check.error ? s5Check.violations.length : 'n/a'} — ` +
      `S5 مُرشَّحات دلالية=${s5Check && !s5Check.error ? s5Check.manualReviewCandidates.length : 'n/a'}`);

  const runDate = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(OUT_DIR, {recursive: true});
  const outFile = path.join(OUT_DIR, `resolve-v7-live-${scanId}-${runDate}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2), 'utf-8');
  console.log(`[measure-resolve-v7][${scanId}] ✓ كُتب ${outFile}`);
  return record;
}

async function main() {
  if (SIMULATE) {
    await runSimulateSuite();
    return;
  }

  console.log(`═══ measure-resolveV7Report-live ${DRY_RUN ? '(--dry-run)' : ''} ═══`);
  console.log(MODEL_NOTE);

  if (!DRY_RUN) {
    console.log('\n⚠️⚠️⚠️ وضع النداء الحقيقي — راجع التصحيح أعلى هذا الملفّ قبل المتابعة.');
    console.log('هذا المسار يُصدر طلبات شبكة حقيقية بمفتاحك — لا تُشغّله بمفتاح وهمي، ولا كوكيل يتحقّق من السكربت.\n');

    // حارس الشجرة النظيفة (أمر مستخدم 2026-10-01 +03، البند ١) — "تُشغَّل
    // على التزام يحمل S5، لا على شجرة غير ملتزمة." يسبق فحص المفتاح عمداً
    // (توقّف أبكر، لا حاجة لقراءة بيئة أخرى إن كانت الشجرة أصلاً غير
    // صالحة). --dry-run وحده مُستثنًى (هذا الشرط نفسه `if (!DRY_RUN)`) —
    // لا يُصدر أي نداء فعلاً فلا حاجة لحراسته.
    const treeCheck = checkTreeCleanForResolveV7Report();
    if (!treeCheck.clean) {
      console.error(`\n✗ الشجرة غير نظيفة في ${treeCheck.dirtyFiles.length} من ${treeCheck.graphSize} ملفّاً يحمّلها مسار resolveV7Report.js فعلياً — توقّف بلا نداء.`);
      console.error('السبب: "تُشغَّل على التزام يحمل S5، لا على شجرة غير ملتزمة" (أمر مستخدم 2026-10-01 +03).');
      console.error('الملفّات المعدَّلة (git status --porcelain، رسم التبعية من scripts/deploy-list.js:deps):');
      for (const f of treeCheck.dirtyFiles) console.error(`  ${f}`);
      process.exit(1);
    }

    if (!DEEPSEEK_API_KEY) {
      console.error('✗ DEEPSEEK_API_KEY غائب من بيئة الطرفية — توقّف بلا نداء.');
      process.exit(1);
    }
  }

  const {goldenTargets, replayTargets, TARGETS, hasReplayTargets} = selectTargets({
    goldenAll: EXPECTED_V7_PAYLOAD_BYTES, replayPaths: REPLAY_INPUT_PATHS,
    includeGolden: INCLUDE_GOLDEN, only: ONLY,
  });

  // تصحيح المنسّق 2026-10-01 +03 (البند ٢) — القاعدة 35: السقف يُحسب من
  // خطّة التشغيل الفعلية (عدد الأهداف الحقيقي × --runs × أقصى طلبات للنداء
  // الواحد)، لا ثابتاً واحداً يُستعمَل دائماً — ولا يتجاوز أبداً السقف
  // المطلَق (راجع تعليق ABSOLUTE_MAX_NETWORK_REQUESTS أعلاه لمصدر الرقم ٤
  // بسطره من الكود). يُعاد إسناد MAX_NETWORK_REQUESTS/MAX_TOTAL_CALLAIV7_CALLS
  // هنا، **قبل** أي هدف يبدأ — القاعدة 35: "السقف يُفرض حيث يُرسَل
  // الطلب"، والطباعة هنا تسبق أي إرسال ممكن فعلياً.
  const plannedCap = computeNetworkCapForPlan(TARGETS.length, RUNS, MAX_REQUESTS_PER_CALL);
  MAX_NETWORK_REQUESTS = plannedCap;
  MAX_TOTAL_CALLAIV7_CALLS = TARGETS.length * RUNS * 2;

  console.log('\n─── الأهداف ───');
  console.log(`  ${TARGETS.length} هدف (${goldenTargets.length} ذهبي + ${replayTargets.length} حقيقي) × ${RUNS} دورة = ${TARGETS.length * RUNS} نداء resolveV7Report إجمالاً` +
      (hasReplayTargets && !INCLUDE_GOLDEN ? ' — الذهبيتان مُستبعَدتان (--replay-input بلا --include-golden)' : ''));

  console.log('\n─── الوجهات المسموحة والسقوف (قرار المستخدم) — من خطّة التشغيل، لا ثابت واحد ───');
  console.log(`  ${ALLOWED_HOST} (DeepSeek، الافتراضي) — سقف ${MAX_NETWORK_REQUESTS} طلباً`);
  console.log(`    حسابه (قرار مستخدم 2026-10-01 +03): min(${ABSOLUTE_MAX_NETWORK_REQUESTS} [السقف المطلَق]، ${TARGETS.length} تقارير × ${RUNS} نداء لكلٍّ منها × ${MAX_REQUESTS_PER_CALL} [أقصى محاولات DeepSeek لكل نداء]) = min(${ABSOLUTE_MAX_NETWORK_REQUESTS}, ${TARGETS.length * RUNS * MAX_REQUESTS_PER_CALL}) = ${MAX_NETWORK_REQUESTS}`);
  console.log(`  ${GEMINI_HOST} (Gemini) — ${ALLOW_GEMINI ? `مسموح بالعلَم --allow-gemini، سقف ${GEMINI_MAX_NETWORK_REQUESTS} طلبات (ثابت، لا من الخطّة — راجع تعليقه)` : 'محجوب (--allow-gemini لم يُمرَّر)'}`);

  // ─── analyzedAtMs لأهداف --replay-input + حالة PATCH_AGE قبل أي إرسال ───
  // أمر مستخدم 2026-10-01 +03 ("fix قبل النداءات الحيّة"، البند ١): "فاخرج
  // بنتيجة الحارس" يخصّ حارساً آخر؛ هذا تحديداً "يُطبَع قبل الإرسال، مع
  // حالة PATCH_AGE الناتجة لكل هدف — فيرى المستخدم FIRED/FIRED/NOT_FIRED
  // قبل أي طلب." رقم واحد (Date.now()) يُلتقَط هنا، قبل أي هدف يُبنى، ويُمرَّر
  // لكلٍّ منها معاً — راجع تعليق buildScanInputsFromReplayFile للتفصيل
  // الكامل (بما فيه بديل أدقّ لم يُطبَّق بلا موافقة).
  if (replayTargets.length > 0) {
    const replayAnalyzedAtMs = Date.now();
    console.log('\n─── analyzedAtMs لأهداف --replay-input (قبل أي إرسال) ───');
    console.log(`  analyzedAtMs = ${replayAnalyzedAtMs} (${new Date(replayAnalyzedAtMs).toISOString()}) — ` +
        'قيمة واحدة، Date.now() عند بدء هذا التشغيل، بمثل functionStartTime في analyzeDevice.js:346 — لكل الأهداف الحقيقية معاً.');
    for (const target of replayTargets) {
      const built = buildScanInputsFromReplayFile(target.replayInputPath, replayAnalyzedAtMs);
      target.prebuilt = built; // measureOne يُعيد استعماله بدل إعادة البناء (ولو تكرّرت الدورات RUNS>1)
      const patchAge = extractPatchAgeGate(built.categoryStates);
      console.log(`  ${built.scanId || target.replayInputPath}: PATCH_AGE ` +
          (patchAge ? `status=${patchAge.status}${patchAge.source ? ` — ${patchAge.source}` : ''}` :
              '(غائبة من gatesApplied — غير متوقَّع، راجع computeGates)'));
    }
  }

  const allRecords = [];
  for (const target of TARGETS) {
    for (let runIdx = 1; runIdx <= RUNS; runIdx++) {
      if (RUNS > 1) console.log(`\n── ${target.scanId || target.replayInputPath} — دورة ${runIdx}/${RUNS} ──`);
      allRecords.push(await measureOne(target));
    }
  }

  console.log(`\nfirestoreTrapHits: ${firestoreTrapHits} — إجمالي طلبات DeepSeek: ${networkRequestCount}/${MAX_NETWORK_REQUESTS} — إجمالي طلبات Gemini: ${geminiNetworkRequestCount}/${ALLOW_GEMINI ? GEMINI_MAX_NETWORK_REQUESTS : 0} — إجمالي نداءات callAIv7: ${totalCallAIv7Calls}`);
  if (DRY_RUN && (totalCallAIv7Calls !== 0 || networkRequestCount !== 0)) {
    throw new Error('DRY_RUN_VIOLATION: نداء أو طلب شبكة وقع أثناء --dry-run');
  }

  const s5Summary = summarizeS5Breaches(allRecords);
  console.log('\n═══ خرق أو اشتباه في قواعد S5 — يُعرض على المستخدم قبل أيّ نشر ═══');
  if (!s5Summary.perScanBreaches.length) {
    console.log('صفر مخالفة آلية وصفر جملة مُرشَّحة دلالياً (عدّ يدوي) على كل الأهداف المقيسة.');
  } else {
    console.log(`مخالفات آلية (قطعية): ${s5Summary.totalAutoViolations} — جمل مُرشَّحة دلالياً (عدّ يدوي، ليست حكماً): ${s5Summary.totalManualCandidates}`);
    for (const b of s5Summary.perScanBreaches) {
      console.log(`\n  ${b.scanId}:`);
      for (const v of b.violations) {
        console.log(`    [آلي][${v.rule}] ${v.field}${v.match ? ` — "${v.match}"` : ''}${v.detail ? ` — ${v.detail}` : ''}`);
      }
      for (const c of b.manualReviewCandidates) {
        console.log(`    [عدّ يدوي][${c.rule}] ${c.field} — "${c.sentence}"`);
      }
    }
  }
}

/**
 * تصحيح المنسّق 2026-10-01 +03 (بعد f7d6201، البند ٣) — «الصنف (د)» في
 * النقل السابق كان خطأ نقل من المنسّق نفسه (لا من هذا المستودع): المقصود
 * الفعلي بنصّ المستخدم هو **كل قواعد S5** ("ادّعاء في سرد النموذج")، لا
 * بند gpu_fps وحده. دالّة خالصة (قابلة للاختبار بلا main()) تُجمِّع **كل**
 * مخالفة آلية (بقاعدتها وموضعها) و**كل** جملة "عدّ يدوي" دلالية (تُعدّ
 * وتُسرَد، لا تُلخَّص برقم فقط) — تحت عنوان واحد لاحقاً في main().
 * @param {Array<Object>} allRecords مخرَج measureOne لكل تشغيلة (record.s5Check)
 * @return {{totalAutoViolations: number, totalManualCandidates: number, perScanBreaches: Array}}
 */
function summarizeS5Breaches(allRecords) {
  let totalAutoViolations = 0;
  let totalManualCandidates = 0;
  const perScanBreaches = [];
  for (const record of allRecords) {
    if (record && record.s5Check && !record.s5Check.error) {
      const {violations, manualReviewCandidates} = record.s5Check;
      totalAutoViolations += violations.length;
      totalManualCandidates += manualReviewCandidates.length;
      if (violations.length || manualReviewCandidates.length) {
        perScanBreaches.push({scanId: record.scanId, violations, manualReviewCandidates});
      }
    }
  }
  return {totalAutoViolations, totalManualCandidates, perScanBreaches};
}

// ─── حالة طبقة الشبكة — قراءة/إعادة ضبط من اختبار (القاعدة 37: الاختبار
// يفحص الغلاف الحقيقي أعلاه عبر هذه الدوالّ، لا يستبدله بنسخة خاصّة به) ──
function getNetworkRequestCount() { return networkRequestCount; }
function getNetworkLog() { return networkLog; }
function resetNetworkGuardState() { networkRequestCount = 0; geminiNetworkRequestCount = 0; networkLog.length = 0; }
function setSimulatedQueue(q) { simulatedQueue = q; }
// KEY_FRAGMENTS تُبنى من process.env وقت التحميل — دالّة إعادة البناء
// نفسها التي يستعملها اختبار التنقية الداخلي في runSimulateSuite (أعلاه)،
// مُصدَّرة الآن كي يستعملها اختبار خارجي بمفتاح وهمي مؤقّت بنفس الآلية.
function refreshKeyFragments() { KEY_FRAGMENTS = buildKeyFragments(); }

// الحارس (أمر مستخدم 2026-09-23 +03، البند ٤ بعد A125): main() تُستدعى
// تلقائياً فقط حين يُشغَّل هذا الملفّ مباشرة (node scripts/measure-...js)
// — لا عند require() من اختبار أو ملفّ آخر. طبقات الشبكة/التنقية أعلاه
// (خارج هذا الحارس) تبقى تُثبَّت دائماً عند أي require، كما كانت قبل هذا
// الالتزام تماماً — لا تغيير سلوكي هناك.
if (require.main === module) {
  main().catch((e) => {
    console.error('✗ توقّف بخطأ:', sanitizeText(e.message || String(e)));
    process.exitCode = 1;
  });
}

module.exports = {
  runSimulateSuite,
  MAX_NETWORK_REQUESTS,
  ALLOWED_HOST,
  // S1-٢ (أمر مستخدم 2026-10-01 +03) — مُصدَّرة للاختبار المباشر بلا
  // Firestore/Storage/fetch حقيقية.
  GEMINI_HOST,
  GEMINI_MAX_NETWORK_REQUESTS,
  buildScanInputsFromReplayFile,
  // تصحيح المنسّق 2026-10-01 +03 ("fix قبل النداءات الحيّة"، البند ١/٣) —
  // مُصدَّرة للاختبار المباشر لحالة PATCH_AGE ولمسار golden (analyzedAtMs).
  extractPatchAgeGate,
  buildScanInputs,
  // تصحيح المنسّق 2026-10-01 +03 (بعد f7d6201) — مُصدَّرة للاختبار المباشر
  // لحساب السقف (القاعدة 35) بلا استدعاء main() كاملة.
  ABSOLUTE_MAX_NETWORK_REQUESTS,
  MAX_REQUESTS_PER_CALL,
  computeNetworkCapForPlan,
  selectTargets,
  summarizeS5Breaches,
  // تصحيح المنسّق 2026-10-01 +03 (البند ١) — حارس الشجرة النظيفة، للاختبار
  // المباشر بلا main() (يفحص git status حقيقياً، صفر شبكة).
  checkTreeCleanForResolveV7Report,
  sanitizeText,
  buildKeyFragments,
  refreshKeyFragments,
  hostOf,
  getNetworkRequestCount,
  getNetworkLog,
  resetNetworkGuardState,
  setSimulatedQueue,
  main,
};

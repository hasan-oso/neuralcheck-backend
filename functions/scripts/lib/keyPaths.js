'use strict';

// ===================================================================
// keyPaths — مسارات المفاتيح وحدها (بلا قيمة)، بالصيغة التي تحملها ملفّات `.keys.txt` الذهبية. يستعمله golden-stage2-keypaths-readonly.js (قراءة بحتة)، 2026-10-10 +03.
//
// قرار المستخدم 2026-10-10، بنصّه (منقول من أمر المنسّق): «مسارات المفاتيح وحدها بلا قيم، من مستند التقرير ومن نسخة Storage، وتُقارن بملفّات المفاتيح. والملفّ لا يُحفظ على القرص: يُقرأ في الذاكرة،
// وتُستخرج المسارات، ويُترك.»
//
// ─── الصيغة (مُتحقَّقة بالمطابقة، لا منقولة من كود التطبيق) ───────────────────────────────────────────────────────────────────────────────────────────────
// هي الصيغة التي وصفها test/fv68AppPayloadGoldenCopy.test.js (buildKeysText) وطابقت الملفّات الستّة حرفاً بحرف، ويثبّتها test/goldenStage2Keypaths.test.js هنا على الملفّات الثلاثة الحالية:
//   - كل مفتاح في كائن يُضاف بمساره المنقوط (الحاويّات أيضاً: `device` و`functionalResults`).
//   - النزول إلى عنصر كائن في مصفوفة يُلحق `[]` بمسار المصفوفة (`functionalResults[].testId`)؛ ولا مسار `functionalResults[]` بذاته.
//   - عناصر المصفوفة غير الكائنات (أرقام، نصوص: `timeSeries.samples[].v`) لا تُنتج مساراً.
//   - مجموعة بلا تكرار، ثم فرز افتراضي (ترتيب وحدات UTF-16).
// الفرق الوحيد عن الباني في الاختبار: النزول لا يكون إلا إلى **كائن عاديّ** (نموذجه Object.prototype أو null) أو مصفوفة؛ وكل ما سواهما ورقة. فبيانات Firestore (Timestamp وGeoPoint وDocumentReference
// وBuffer…) أوراق لا تُنتج مسارات داخلية مزيَّفة (`createdAt._seconds`)؛ وعلى JSON مفكوك (ما تقرؤه الملفّات الذهبية وملفّ Storage) الباني مطابق للباني في الاختبار.
// ⚠️ **حالتان لا يمرّ بهما أيّ من الملفّات الذهبية الستّة، فسلوك الباني فيهما غير مُتحقَّق من كود التطبيق:** قيمة null، ومصفوفة داخل مصفوفة — الباني هنا يُعاملهما كما الباني في الاختبار.
//
// ما لا يفعله: لا يقرأ قيمة (لا يعيد قيمة ولا طولاً ولا نوعاً) — المسارات وحدها. لا I/O.
// ===================================================================

/** كائن عاديّ فقط (JSON مفكوك، أو خريطة Firestore): نموذجه Object.prototype أو null. */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * مسارات المفاتيح لقيمة. مرتّبة، بلا تكرار.
 * @param {*} root القيمة (كائن عاديّ عادةً).
 * @param {{prefix?: string}} [opts] prefix: يُلحَق بكل مسار (ويُضاف هو نفسه مساراً إن كان غير فارغ) — لملفّ يصف عقدة داخلية (timeSeries) لا الجذر.
 * @return {string[]}
 */
function collectKeyPaths(root, opts = {}) {
  const base = typeof opts.prefix === 'string' ? opts.prefix : '';
  const paths = new Set();
  if (base !== '') paths.add(base);
  const walk = (value, prefix) => {
    if (Array.isArray(value)) {
      for (const el of value) {
        if (isPlainObject(el) || Array.isArray(el)) walk(el, `${prefix}[]`);
      }
      return;
    }
    if (isPlainObject(value)) {
      for (const key of Object.keys(value)) {
        const p = prefix === '' ? key : `${prefix}.${key}`;
        paths.add(p);
        walk(value[key], p);
      }
    }
  };
  walk(root, base);
  return [...paths].sort();
}

/** نصّ ملفّ `.keys.txt` كما يُكتب: سطر لكل مسار وبعد كل سطر `\n`. (للمطابقة في الاختبار وحده — السكربت لا يكتب ملفّاً.) */
function keysText(paths) {
  return paths.map((p) => `${p}\n`).join('');
}

/** أسطر نصّ `.keys.txt` (بلا الأسطر الفارغة). CRLF لا يُقبل صامتاً: الملفّ `-text` بالتصميم فلا يبدّل أسطره شيء. */
function parseKeysText(text) {
  if (typeof text !== 'string') throw new Error('parseKeysText: النصّ مطلوب');
  if (text.includes('\r')) throw new Error('parseKeysText: الملفّ يحمل CR — الملفّات الذهبية بأسطر LF حرفياً (-text)');
  return text.split('\n').filter((l) => l !== '');
}

/**
 * الفرق بين مسارات فعلية ومسارات متوقَّعة (بلا قيمة).
 * @param {string[]} actual
 * @param {string[]} expected
 * @return {{extra: string[], missing: string[]}} extra = في الفعلي وغائب عن المتوقَّع؛ missing = في المتوقَّع وغائب عن الفعلي. مرتّبتان.
 */
function diffKeyPaths(actual, expected) {
  const a = new Set(actual);
  const e = new Set(expected);
  return {
    extra: [...a].filter((p) => !e.has(p)).sort(),
    missing: [...e].filter((p) => !a.has(p)).sort(),
  };
}

/** مسارات النزول تحت جذر داخلي: السطر نفسه وما يبدأ بـ`<root>.` أو `<root>[]`. */
function pathsUnder(paths, root) {
  return paths.filter((p) => p === root || p.startsWith(`${root}.`) || p.startsWith(`${root}[]`));
}

// ─── التخفيف قبل الحفظ في reportRaw (lightenFingerprintForStorage.js) على مستوى المسارات ──────────────────────────────────────────────────────────────────
// الدالّة الحقيقية: delete timeSeries.samples ثم timeSeries.samplesCount = عدد العيّنات (عدد، لا مسار فرعيّ). فعلى مسارات حمولة التطبيق:
// تُحذف `timeSeries.samples` وكل ما تحتها (`timeSeries.samples[].phase/ts/v`) وتُضاف `timeSeries.samplesCount`. القاعدة تُثبَّت باختبار على الملفّات الذهبية بالدالّة الحقيقية
// (goldenStage2Keypaths.test.js) فلا تنجرف عنها.
const SAMPLES_ROOT = 'timeSeries.samples';
const SAMPLES_COUNT_PATH = 'timeSeries.samplesCount';

/**
 * ما يُتوقَّع أن تبقى عليه مسارات الحمولة بعد التخفيف.
 * @param {string[]} payloadPaths مسارات الحمولة كما أرسلها التطبيق.
 * @return {{paths: string[], removed: string[], added: string[]}}
 */
function lightenedExpectedPaths(payloadPaths) {
  const removed = pathsUnder(payloadPaths, SAMPLES_ROOT);
  const kept = payloadPaths.filter((p) => !removed.includes(p));
  const hasTimeSeries = payloadPaths.includes('timeSeries');
  const added = hasTimeSeries && !kept.includes(SAMPLES_COUNT_PATH) ? [SAMPLES_COUNT_PATH] : [];
  return {paths: [...kept, ...added].sort(), removed, added};
}

module.exports = {
  isPlainObject, collectKeyPaths, keysText, parseKeysText, diffKeyPaths, pathsUnder, lightenedExpectedPaths,
  SAMPLES_ROOT, SAMPLES_COUNT_PATH,
};

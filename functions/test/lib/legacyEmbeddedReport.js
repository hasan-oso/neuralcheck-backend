'use strict';

// legacyEmbeddedReport — مستند تقرير V7 بالشكل الذي كُتب به **قبل** V8 نقل الخامّ (2026-10-09): الخامّ مضمَّناً في
// المستند نفسه (rawFingerprint وsessionId وdeviceFingerprintSha وtimeSeriesStoragePath وaiAudit). تلك المستندات ما زالت
// في الإنتاج حتى يكتمل الترحيل (الحالة EMBEDDED_LEGACY في reportRawStore.readReportRaw). قرّاء functions/scripts صاروا (الجزء ٢،
// 2026-10-09) يقرؤون بـreadReportRaw على الشكلين؛ وهذا المساعد جانب الشكل القديم في اختباراتهم: يُختبر القارئ عليه وعلى الشكل
// الجديد (المقروء + مستند reportRaw من العيّنتين الذهبيتين) ويُشترط أن يكون المخرَج واحداً.
//
// يُبنى من العيّنتين الذهبيتين الحقيقيتين (المقروء + الخامّ) بدمجهما — لا نسخة ثالثة مكتوبة باليد (القاعدة 24)، فلا
// تنجرف عن المولّدين. حين يُحذف فرع EMBEDDED_LEGACY بعد أن يقول التحقّق 0، يُحذف هذا المساعد مع آخر مستهلك له.

const fs = require('fs');
const path = require('path');
const {REPORT_RAW_FIELDS} = require('../../src/analysis/reportRawStore');

const GOLDEN_DIR = path.join(__dirname, '..', 'fixtures', 'golden');

/**
 * @param {string} [suffix] لاحقة العيّنة ('' للأساسية، '-honor'، '-security-downgrade'، ...).
 * @return {Object} مستند تقرير بالشكل القديم (مقروء + خامّ مضمَّن).
 */
function loadLegacyEmbeddedV7Report(suffix = '') {
  const readable = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, `v7-reports-document-sample${suffix}.json`), 'utf8'));
  const raw = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, `v7-report-raw-sample${suffix}.json`), 'utf8'));
  const embedded = {};
  for (const f of REPORT_RAW_FIELDS) embedded[f] = raw[f];
  return {...readable, ...embedded};
}

module.exports = {loadLegacyEmbeddedV7Report};

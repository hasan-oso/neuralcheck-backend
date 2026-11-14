#!/usr/bin/env node
'use strict';

// ===================================================================
// set-maintenance-settings — يضبط إعداد الصيانة بمعاينة قراءة وحدها ثم كتابة بنصّ تأكيد ثم تراجع، 2026-10-22 +03. المنطق في lib/maintenanceSettings.js (وفيه القرار بنصّه وما يُكتب وفروقه المعلَنة عن النداءين).
//
// **يشغّله حسن بيده** (كتلة PowerShell يبنيها وكيل آخر). هذا الوكيل يكتبه ويختبره (وحدة بـdb في الذاكرة + e2e على المحاكي بمقارنة المستندات بنداءَي setProtocolSettings وsetShopProtocolParts الحقيقيَّين) ولا يشغّله على الإنتاج.
// ما يُكتب: protocolSettings/current.openBeforeValidityHours = 72 (بإصدار جديد وhistory كالنداء)، وprotocolParts.purposes وprotocolParts.batteryBeforeAfter = true لمحلّ واحد. لا حقل غيرهما ولا محلّ غيره.
// الاعتماد من بيئة الطرفية وحدها (ADC)، لا مفتاح في سطر أمر. المشروع مثبَّت (neuralchek-9b6d7)؛ والمحاكي بعلَم --emulator صريح وحده.
//
// الأوضاع (--help يطبعها بأعلامها الدقيقة وأكواد الخروج وأمثلة):
//   node functions/scripts/set-maintenance-settings.js --mode preview [--shop <رمز|uid>] [--ascii-names]
//   node functions/scripts/set-maintenance-settings.js --mode write --shop <رمز|uid> --confirm WRITE-MAINTENANCE-SETTINGS --rollback-file <ملفّ جديد>
//   node functions/scripts/set-maintenance-settings.js --mode rollback --confirm ROLLBACK-MAINTENANCE-SETTINGS --rollback-file <ملفّ الكتابة>
// أكواد الخروج: 0 نجاح · 2 استعمال · 3 فرق غير متوقَّع في القراءة البعدية · 4 رفض مسمّى · 5 بيئة/ADC/مشروع · 6 غير محسوم (فشل أثناء/بعد الكتابة).
// لا حذف بأيّ وسيلة (القاعدة 42): لا delete ولا FieldValue.delete ولا recursiveDelete ولا batch في أيّ مسار.
// ===================================================================

const path = require('path');
const C = require('./lib/deviceCheck03Common');
const L = require('./lib/maintenanceSettings');
const {hashIdForLog} = require('../src/utils/logRedaction');

/** عنوان سطر RESULT لكل رمز خروج. */
const RESULT_LABEL = Object.freeze({[L.EXIT.USAGE]: 'USAGE', [L.EXIT.DIFF_UNEXPECTED]: 'DIFF-UNEXPECTED', [L.EXIT.REFUSED]: 'REFUSED', [L.EXIT.ENVIRONMENT]: 'ENVIRONMENT', [L.EXIT.UNDETERMINED]: 'UNDETERMINED'});

/**
 * @param {string[]} argv
 * @param {{out?: function(string): void, err?: function(string): void, env?: Object, now?: function(): number, db?: Object, FieldValue?: Object, hashId?: function(string): string, scanCap?: number,
 *          writeRollbackFile?: function(string, Object): void, beforeTransaction?: function(Object): Promise<void>, afterTransaction?: function(Object): Promise<void>}} [io]
 *          db وFieldValue وhashId وscanCap وwriteRollbackFile وbeforeTransaction وafterTransaction تُحقَن للاختبار فقط (الأخيران خطّافان يغيّران الحال قبل المعاملة وبعدها لاختبار السباق والفرق غير المتوقَّع)
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  const env = io.env || process.env;
  const now = io.now || Date.now;
  const hashId = io.hashId || hashIdForLog;
  const cap = io.scanCap !== undefined ? io.scanCap : L.SHOP_SCAN_CAP;

  let args;
  try {
    args = L.parseArgs(argv);
  } catch (e) {
    if (e instanceof L.UsageError) {
      err(`✗ ${L.safeText(e)}`);
      out(`RESULT|USAGE reason=${e.reason} exit=${L.EXIT.USAGE}`);
      return L.EXIT.USAGE;
    }
    throw e;
  }
  if (args.help) {
    for (const line of L.usageText()) out(line);
    return L.EXIT.OK;
  }

  const mode = args.mode;
  let phase = 'read'; // تصير 'write' قبل المعاملة: أيّ فشل بعدها غير محسوم (6) لا بيئة (5)
  try {
    // ١ التأكيد: قبل أيّ قراءة أو اتصال أو كتابة (غير المطابق = رفض بلا أثر)
    if (mode !== 'preview') {
      const expected = mode === 'write' ? L.CONFIRM_WRITE : L.CONFIRM_ROLLBACK;
      if (args.confirm === null) throw new L.ToolError(L.REFUSAL.CONFIRM_MISSING);
      if (args.confirm !== expected) throw new L.ToolError(L.REFUSAL.CONFIRM_MISMATCH);
    }
    // ٢ الوجهة والمشروع: بلا شبكة
    const target = L.checkEnvironment({emulator: args.emulator, env});
    if (!target.ok) throw new L.ToolError(target.reasons.join(','), L.EXIT.ENVIRONMENT);
    // ٣ ما لا يحتاج الشبكة: مسار ملفّ التراجع (كتابة: ملفّ جديد في مجلّد موجود) وصحّة ملفّ التراجع ووجهته (تراجع)
    let file = null;
    if (mode === 'write') {
      try {
        C.assertOutWritable(args.rollbackFile);
      } catch (e) {
        throw new L.ToolError(e && e.reason === 'OUT_EXISTS' ? L.REFUSAL.ROLLBACK_FILE_EXISTS : L.REFUSAL.ROLLBACK_FILE_UNWRITABLE);
      }
    } else if (mode === 'rollback') {
      file = L.readRollbackFile(path.resolve(args.rollbackFile));
      if (file.projectId !== target.projectId || file.target !== target.target) throw new L.ToolError(L.REFUSAL.ROLLBACK_FILE_TARGET_MISMATCH);
    }
    err(`[${L.MODE}] project=${target.projectId} target=${target.target} mode=${mode}${mode === 'preview' ? ' (read-only)' : ' (WRITES protocolSettings/current openBeforeValidityHours + one shop\'s two parts; nothing else)'}`);

    const admin = io.db ? {db: io.db, FieldValue: io.FieldValue} : L.initAdmin(target.projectId);
    const ro = C.wrapReadOnly(admin.db); // كل القراءات من هنا؛ الكتابة الوحيدة في applyInTransaction بـadmin.db
    const markWriting = () => { phase = 'write'; };
    let r;
    if (mode === 'preview') r = await L.runPreview({db: ro, args, env: target, out, hashId, cap});
    else if (mode === 'write') r = await L.runWrite({ro, db: admin.db, FieldValue: admin.FieldValue, args, env: target, out, err, hashId, now, io, markWriting, cap});
    else r = await L.runRollback({ro, db: admin.db, FieldValue: admin.FieldValue, file, env: target, out, err, hashId, io, markWriting});
    out(`RESULT|${r.result} mode=${mode} exit=${r.exit} writes=${r.writes}`);
    return r.exit;
  } catch (e) {
    if (e instanceof L.ToolError) {
      err(`✗ ${L.safeText(e)}`);
      out(`RESULT|${RESULT_LABEL[e.exit]} mode=${mode} reason=${e.reason} exit=${e.exit}`);
      return e.exit;
    }
    const text = L.safeText(e); // الصنف والرمز وحدهما (القاعدة 36)
    if (phase === 'write') {
      err(`✗ ${text} — the write state is UNDETERMINED: run --mode preview to see it (a rollback file exists if the write mode got that far)`);
      out(`RESULT|UNDETERMINED mode=${mode} exit=${L.EXIT.UNDETERMINED} error=${text}`);
      return L.EXIT.UNDETERMINED;
    }
    err(`✗ ${text}`);
    out(`RESULT|ENVIRONMENT mode=${mode} reason=PROVIDER_ERROR error=${text} exit=${L.EXIT.ENVIRONMENT}`);
    return L.EXIT.ENVIRONMENT;
  }
}

module.exports = {main};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    console.error(`✗ توقّف بخطأ: ${L.safeText(e)}`);
    process.exitCode = L.EXIT.ENVIRONMENT;
  });
}

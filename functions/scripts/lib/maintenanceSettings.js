'use strict';

// ===================================================================
// maintenanceSettings — منطق أداة set-maintenance-settings.js (معاينة · كتابة · تراجع لإعداد الصيانة)، 2026-10-22 +03. يستعمله set-maintenance-settings.js.
//
// قرار حسن (2026-10-22، منقول عن أمر المنسّق بنصّه، غير متحقَّق من هذا المستودع): «طريقة الكتابة: كتلة PowerShell واحدة بمعاينة قراءة فقط ثم الكتابة ثم تراجع. لا صفحات /admin/protocol ولا Console يدوي.»
// «ما تكتبه فقط: openBeforeValidityHours = 72، وتفعيل جزأي purposes وbatteryBeforeAfter لمحلّ واحد. لا حقل غيرهما، ولا محلّ غيره. معرّف المحلّ مُدخَل من حسن عند التشغيل، لا يُكتب في الكتلة. يعرض له معاينة القراءة قائمة
// المحالّ المتاحة بالأسماء، بلا بيانات خاصة. … (هـ) قراءة بعدية تثبت أن الحقلين فقط تغيّرا وأن لا حقل آخر تغيّر (فرق قبل/بعد). (و) كتلة تراجع منفصلة تعيد القيم السابقة بالإلحاق لا الحذف.»
// **يشغّله حسن بيده** (كتلة PowerShell يبنيها وكيل آخر). هذا الوكيل يكتبه ويختبره (وحدة بـdb في الذاكرة + e2e على المحاكي بمقارنة المستندات بنداءَي setProtocolSettings وsetShopProtocolParts الحقيقيَّين) ولا يشغّله على الإنتاج.
//
// لماذا أداة لا نداء: setProtocolSettings وsetShopProtocolParts تشترطان requireAdmin (utils/admin.js:44-51: توكن Firebase Auth ببريد مؤكَّد)، ولا يملكه حسن في كتلة PowerShell بـADC. فالأداة تكتب بـfirebase-admin وADC
// (من بيئة الطرفية وحدها) **وتستورد الدوالّ النقيّة نفسها لا نسخةً منها** (القاعدة 24): validateSettingsPatch وapplySettingsPatch وcanonical (settingsWrite.js) · readSettingsDocument (protocolSettings.js) · validatePartsPatch
// وchangedParts (shopProtocol.js) · readProtocolParts (scanProtocolDocument.js) · hashIdForLog. ولا تستورد utils/admin (التطبيق الافتراضي) ولا شيئاً من firebase-functions.
//
// ─── فروق معلَنة عن النداءين (والمصدر هنا) ─────────────────────────────────────────────────────────────────────────
//   ١ **updatedBy / supersededBy** = hashIdForLog(ACTOR_TAG) (الوسم الثابت «script:set-maintenance-settings») لا hashIdForLog(uid مشرف): الأداة ليست نداءً فلا uid مشرف. وهو الفرق الوحيد في القيم (ومعه الأوقات: وقت الخادم في الحالتين).
//   ٢ **معاملة واحدة للمستندين** (الإعدادات والمحلّ): النداءان معاملتان منفصلتان بنداءَين. الجمع يعطي الكلّ أو لا شيء، والمستندان الناتجان هما نفسهما. وتسلسل المعاملة (قراءة، ثم tx.create لـhistory/{الإصدار السابق}، ثم tx.set بـversion+1
//      وupdatedAt وupdatedBy، ثم tx.update للمحلّ بـ{protocolParts: {...الحاضر, ...الرقعة}}) **تكرّر هنا لأنّ نصّ المعاملة داخل معالجَي protocolSettingsAdmin.js:68-90 وshopProtocolAdmin.js:81-92 وغير مُصدَّر** (لا لمس لـfunctions/src بأمر المنسّق)؛
//      ويحرس التكافؤ اختبار e2e يقارن مستندات الأداة بمستندات النداءين الحقيقيَّين، ومسحٌ ساكن لثوابت الحقول.
//   ٣ المحلّ الغائب مرفوض ولا يُنشأ (كالنداء)؛ وغير المتغيّر لا يُكتب (كالنداء).
//
// ─── الأوضاع الثلاثة (كلّها بالمشروع المثبَّت neuralchek-9b6d7 من audit-device-profiles-readonly.js، ويحرسه اختبار بـ.firebaserc) ──────────────────────────────────────────────────
//   preview   قراءة وحدها (db مغلَّف بـwrapReadOnly: أيّ كتابة تُرمى TRAP). يطبع حالة الإعدادات وقائمة المحالّ (اسم، type، رمز، حالة الجزأين) بقناع حقول، وبـ--shop الخطّة: الحالي ⟵ الجديد لكل حقل.
//   write     بنصّ تأكيد ثابت CONFIRM_WRITE (يُقارَن حرفياً قبل أيّ قراءة) وملفّ تراجع **يُكتب قبل الكتابة** (wx: لا استبدال)، ثم معاملة واحدة، ثم قراءة بعدية وفرق قبل/بعد: لا مسار يتغيّر غير المسموح (DIFF-UNEXPECTED ⟵ exit 3).
//   rollback  بنصّ تأكيد آخر CONFIRM_ROLLBACK: يعيد القيم السابقة من الملفّ **بالإلحاق لا بالحذف** (القاعدة 42: لا delete ولا FieldValue.delete ولا مسح حقل): الجزء السابق ABSENT ⟵ يُكتب false صريحاً (القارئ === true فيقرؤه مُطفأً كالغائب)؛
//             وhours السابقة ABSENT ⟵ **لا تُمحى** (settingsWrite يرفض null فلا طريق مسح مشروع): تبقى 72 ويُعلَن ذلك (بلا أثر ما دام الجزآن مُطفأَين). hours السابقة قيمة ⟵ تُكتب بإصدار جديد وhistory.
//
// ─── المخرَج: سطور منظَّمة PREFIX|KIND key=value … على stdout (PREVIEW| PLAN| WRITE| ROLLBACK| DIFF| RESULT|)؛ وstderr للتقدّم. لا بريد ولا هاتف ولا uid خامّ ولا حقل خاصّ: اسم المحلّ ورمزه (hashIdForLog(uid)) ونوعه وحالة الجزأين وحدها،
//   وفي الفرق **أسماء المسارات وحدها** (مفتاح غريب يُهشَّر). نصّ خطأ المزوّد لا يُطبع (القاعدة 36): الصنف والرمز.
// ─── أكواد الخروج: 0 نجاح · 2 استعمال · 3 فرق غير متوقَّع في القراءة البعدية · 4 رفض مسمّى · 5 بيئة/ADC/مشروع · 6 غير محسوم (فشل أثناء/بعد الكتابة: أعد --mode preview لترى الحال).
// ─── لا مشغّل ولا فهرس: الكتابة على protocolSettings/current (+history) وusers/{المحلّ} وحدها. المشغّل الوحيد على Firestore في المستودع onDocumentCreated لـreports/{scanId}، والمجدول الوحيد checkExpiringSubscriptions بجدول زمني؛ ولا تكتب الأداة reports
//   ولا تمسّ حقول الاشتراك. استعلامها الوحيد مسح users بقناع حقول وسقف بلا مرشّح ولا ترتيب (فلا فهرس مركّب: القاعدة 43).
// ===================================================================

const fs = require('fs');
const C = require('./deviceCheck03Common');
const G = require('../../test/lib/emulatorGuardCore');
const {hashIdForLog} = require('../../src/utils/logRedaction');
const {PROTOCOL_COLLECTION, PROTOCOL_SETTINGS_PATH, PROTOCOL_PART, PROTOCOL_ABSENCE_STATE} = require('../../src/protocol/protocolVocabulary');
const {SETTINGS_FIELD, SETTINGS_STATE, SETTINGS_ANOMALY, readSettingsDocument} = require('../../src/protocol/protocolSettings');
const {SETTINGS_WRITE_REFUSAL, validateSettingsPatch, applySettingsPatch, canonical} = require('../../src/protocol/settingsWrite');
const {readShopId, validatePartsPatch, changedParts} = require('../../src/protocol/shopProtocol');
const {readProtocolParts} = require('../../src/protocol/scanProtocolDocument');

const PROJECT_ID = C.PROJECT_ID;
const MODE = 'set-maintenance-settings';
const APP_NAME = 'set-maintenance-settings';
const SCHEMA = 1;
const EXIT = Object.freeze({OK: 0, USAGE: 2, DIFF_UNEXPECTED: 3, REFUSED: 4, ENVIRONMENT: 5, UNDETERMINED: 6});

/** نصّا التأكيد: ASCII واحد لكلٍّ، يُقارَنان حرفياً (مصدر واحد: القاعدة 24؛ تستورده الكتلة والاختبارات). */
const CONFIRM_WRITE = 'WRITE-MAINTENANCE-SETTINGS';
const CONFIRM_ROLLBACK = 'ROLLBACK-MAINTENANCE-SETTINGS';
/** وسم الفاعل (updatedBy/supersededBy) — الأداة ليست نداءً فلا uid مشرف (فرق معلَن ١). */
const ACTOR_TAG = 'script:set-maintenance-settings';
const UPDATED_BY = hashIdForLog(ACTOR_TAG);
/** ما يُكتب: القيمة والجزآن (مصدر واحد: المدى من settingsWrite يحرسه المُحقِّق نفسه عند الكتابة، والأسماء من PROTOCOL_PART). */
const MAINTENANCE_HOURS = 72;
const MAINTENANCE_PARTS = Object.freeze([PROTOCOL_PART.PURPOSES, PROTOCOL_PART.BATTERY_BEFORE_AFTER]);
const HOURS_FIELD = SETTINGS_FIELD.OPEN_BEFORE_VALIDITY_HOURS;

const SHOP_SCAN_CAP = 5000;
const ABSENT = 'ABSENT';
const INVALID = 'INVALID';
const NO_NAME = '(بلا اسم)';
const MAX_NAME_CHARS = 60;
const MAX_ROLLBACK_FILE_BYTES = 64 * 1024;
/** أسماء محلّية بلا مصدر مُصدَّر في src (تكرّرها الدوالّ نفسها): يحرس تطابقها اختبار الوحدة بمسح كاتبَي الدوالّ. */
const USERS_COLLECTION = 'users';
const SHOP_PARTS_FIELD = 'protocolParts';
const HISTORY_FIELD = Object.freeze({SUPERSEDED_AT: 'supersededAt', SUPERSEDED_BY_VERSION: 'supersededByVersion', SUPERSEDED_BY: 'supersededBy'});
const PREVIEW_FIELDS = Object.freeze(['name', 'displayName', 'type', SHOP_PARTS_FIELD]);
const SETTINGS_BOOKKEEPING = Object.freeze(['version', 'updatedAt', 'updatedBy']);

const SETTINGS_STATE_NAME = Object.freeze({PRESENT: SETTINGS_STATE.PRESENT, ABSENT: PROTOCOL_ABSENCE_STATE.SETTINGS_ABSENT, UNUSABLE: SETTINGS_ANOMALY.VERSION_UNUSABLE});
const TARGET = Object.freeze({PRODUCTION: 'PRODUCTION', EMULATOR: 'EMULATOR'});
const PREFIX = Object.freeze({preview: 'PREVIEW', write: 'WRITE', rollback: 'ROLLBACK'});
const CODE_PATTERN = /^#?[0-9a-f]{12}$/;

/** رموز الرفض المسمّاة (exit 4) — الاسم هو ما يُطبع. */
const REFUSAL = Object.freeze({
  CONFIRM_MISSING: 'CONFIRM_MISSING',
  CONFIRM_MISMATCH: 'CONFIRM_MISMATCH',
  SHOP_NOT_FOUND: 'SHOP_NOT_FOUND',
  SHOP_AMBIGUOUS: 'SHOP_AMBIGUOUS',
  SHOP_SCAN_CAP_EXCEEDED: 'SHOP_SCAN_CAP_EXCEEDED',
  ROLLBACK_FILE_EXISTS: 'ROLLBACK_FILE_EXISTS',
  ROLLBACK_FILE_UNWRITABLE: 'ROLLBACK_FILE_UNWRITABLE',
  ROLLBACK_FILE_MISSING: 'ROLLBACK_FILE_MISSING',
  ROLLBACK_FILE_INVALID: 'ROLLBACK_FILE_INVALID',
  ROLLBACK_FILE_TARGET_MISMATCH: 'ROLLBACK_FILE_TARGET_MISMATCH',
  SETTINGS_CURRENT_VERSION_INVALID: SETTINGS_WRITE_REFUSAL.CURRENT_VERSION_INVALID,
  SNAPSHOT_CHANGED: 'SNAPSHOT_CHANGED',
});

/** خطأ مستعمل: السبب وحده هو الرسالة (آمنة للطباعة). */
class UsageError extends Error {
  constructor(reason, detail) {
    super(detail ? `USAGE: ${reason} ${detail}` : `USAGE: ${reason}`);
    this.name = 'UsageError';
    this.reason = reason;
  }
}

/** خطأ بسبب مسمّى وكود خروج. السبب وحده هو الرسالة. */
class ToolError extends Error {
  constructor(reason, exit = EXIT.REFUSED) {
    super(reason);
    this.name = 'ToolError';
    this.reason = reason;
    this.exit = exit;
  }
}

/** نصّ آمن للشاشة (القاعدة 36): السبب المسمّى من أخطائنا، وإلا الصنف والرمز وحدهما. */
function safeText(e) {
  if (e && (e.name === 'ToolError' || e.name === 'UsageError')) return e.reason;
  return C.safeErrorText(e);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const normalizeId = (id) => String(id).trim().toLowerCase();

// ───────────────────────── الوسائط ─────────────────────────

const VALUE_FLAGS = Object.freeze({'--mode': 'mode', '--shop': 'shop', '--confirm': 'confirm', '--rollback-file': 'rollbackFile'});
const BOOL_FLAGS = Object.freeze({'--emulator': 'emulator', '--help': 'help', '--ascii-names': 'asciiNames'});
const MODES = Object.freeze(['preview', 'write', 'rollback']);

/**
 * محلّل وسائط صارم: مجهول أو مكرَّر أو بلا قيمة أو لا ينطبق على الوضع = UsageError بسبب مسمّى. اسم الوسيط المجهول وحده يُذكر (قيمته قد تكون خاصّة).
 * @param {string[]} argv
 * @return {{help: boolean, mode: ?string, shop: ?string, confirm: ?string, rollbackFile: ?string, emulator: boolean, asciiNames: boolean}}
 */
function parseArgs(argv) {
  const args = {help: false, mode: null, shop: null, confirm: null, rollbackFile: null, emulator: false, asciiNames: false};
  const seen = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (has(BOOL_FLAGS, a)) {
      if (seen.includes(a)) throw new UsageError('DUPLICATE_ARGUMENT', a);
      seen.push(a);
      args[BOOL_FLAGS[a]] = true;
    } else if (has(VALUE_FLAGS, a)) {
      if (seen.includes(a)) throw new UsageError('DUPLICATE_ARGUMENT', a);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError('VALUE_MISSING', a);
      seen.push(a);
      args[VALUE_FLAGS[a]] = v;
      i++;
    } else {
      throw new UsageError('UNKNOWN_ARGUMENT', a.startsWith('--') ? a.split('=')[0] : '(positional)');
    }
  }
  if (args.help) return args;
  if (args.mode === null) throw new UsageError('MODE_REQUIRED');
  if (!MODES.includes(args.mode)) throw new UsageError('MODE_INVALID');
  if (args.mode === 'preview') {
    if (args.confirm !== null) throw new UsageError('NOT_APPLICABLE', '--confirm');
    if (args.rollbackFile !== null) throw new UsageError('NOT_APPLICABLE', '--rollback-file');
  } else if (args.mode === 'write') {
    if (args.shop === null) throw new UsageError('SHOP_REQUIRED');
    if (args.rollbackFile === null) throw new UsageError('ROLLBACK_FILE_REQUIRED');
  } else {
    if (args.rollbackFile === null) throw new UsageError('ROLLBACK_FILE_REQUIRED');
    if (args.shop !== null) throw new UsageError('NOT_APPLICABLE', '--shop');
  }
  return args;
}

/** نصّ --help: الأوضاع بالعلَم الدقيق والمخرَج وأكواد الخروج وأمثلة (ASCII وحده: لا تفسده ترميزات الطرفية). */
function usageText() {
  return [
    'set-maintenance-settings.js - writes ONLY: protocolSettings/current.openBeforeValidityHours = 72, and parts purposes + batteryBeforeAfter = true for ONE shop.',
    'Run from inside the repository with Node 22; credentials: ADC of the terminal (never passed on the command line). Project is pinned: ' + PROJECT_ID + '.',
    '',
    'MODES (exactly one --mode):',
    '  --mode preview [--shop <code|uid>] [--ascii-names]',
    '      READ ONLY. Prints the settings state, the shop list (name, type, code, parts), and with --shop the plan: current -> new per field.',
    '  --mode write --shop <code|uid> --confirm ' + CONFIRM_WRITE + ' --rollback-file <new file> [--ascii-names]',
    '      Writes the rollback file FIRST (never overwrites), then ONE transaction for both documents, then a read-back diff (anything else changed -> exit 3).',
    '  --mode rollback --confirm ' + CONFIRM_ROLLBACK + ' --rollback-file <file written by write>',
    '      Restores the previous values by APPENDING (no delete): parts previously ABSENT are written false; hours previously ABSENT cannot be cleared and stays 72 (announced).',
    '',
    'FLAGS:',
    '  --shop <code|uid>   shop code is #<12 hex> (the same hash the server logs print; "#" optional) or the raw uid. Must match exactly one shop.',
    '  --confirm <text>    fixed ASCII text, compared literally BEFORE any read or write.',
    '  --rollback-file <p> write: a NEW file (refused if it exists). rollback: the file to read. Keep it: it holds the shop uid and the previous values (no email, no phone).',
    '  --emulator          REQUIRED to run against the Firestore emulator (FIRESTORE_EMULATOR_HOST local + a demo project); REFUSED when the host is set and the flag is absent.',
    '  --ascii-names       escape non-ASCII characters of shop names as \\uXXXX (use when the console cannot show UTF-8).',
    '  --help              this text.',
    '',
    'OUTPUT (stdout, one line each, parse by prefix): PREVIEW| PLAN| WRITE| ROLLBACK| DIFF| DIFF-UNEXPECTED DIFF-MISSING RESULT|',
    '  e.g. RESULT|OK mode=write exit=0 writes=2   RESULT|REFUSED reason=SHOP_NOT_FOUND exit=4',
    '  Private data is never printed: no email, phone or raw uid; shop names only where the preview needs them; diff lines carry path NAMES only.',
    '',
    'EXIT CODES: 0 ok | 2 usage | 3 unexpected difference in the read-back | 4 named refusal | 5 environment/ADC/project | 6 undetermined (a failure during/after the write: run --mode preview).',
    '',
    'EXAMPLES:',
    '  node functions/scripts/set-maintenance-settings.js --mode preview',
    '  node functions/scripts/set-maintenance-settings.js --mode preview --shop "#0123456789ab"',
    '  node functions/scripts/set-maintenance-settings.js --mode write --shop "#0123456789ab" --confirm ' + CONFIRM_WRITE + ' --rollback-file "C:\\evidence\\rollback-maintenance.json"',
    '  node functions/scripts/set-maintenance-settings.js --mode rollback --confirm ' + CONFIRM_ROLLBACK + ' --rollback-file "C:\\evidence\\rollback-maintenance.json"',
  ];
}

// ───────────────────────── البيئة والمشروع ─────────────────────────

/**
 * يقرّر الوجهة قبل أيّ اتصال. الإنتاج: المشروع المثبَّت وحده، ويُرفض مضيف محاكٍ مضبوط (EMULATOR_HOST_WITHOUT_FLAG) ومشروع آخر في البيئة (PROJECT_MISMATCH) وFIREBASE_CONFIG غير المقروء.
 * المحاكي (--emulator): مضيف محلّي ومشروع اختبار من البيئة (مصدر الفحص الواحد: test/lib/emulatorGuardCore.js).
 * @param {{emulator: boolean, env?: Object}} p
 * @return {{ok: true, target: string, projectId: string}|{ok: false, reasons: string[]}}
 */
function checkEnvironment({emulator, env = process.env}) {
  if (emulator) {
    const r = G.emulatorEnvProblems(env);
    if (r.problems.length > 0) return {ok: false, reasons: r.problems.map((p) => p.code)};
    const ids = [];
    for (const p of r.projects) if (!ids.includes(normalizeId(p.id))) ids.push(normalizeId(p.id));
    if (ids.length > 1) return {ok: false, reasons: ['PROJECT_AMBIGUOUS']};
    return {ok: true, target: TARGET.EMULATOR, projectId: r.projects[0].id.trim()};
  }
  const reasons = [];
  if (!isBlank(env.FIRESTORE_EMULATOR_HOST)) reasons.push('EMULATOR_HOST_WITHOUT_FLAG');
  const seen = [];
  for (const name of G.PROJECT_ENV_VARS) if (!isBlank(env[name])) seen.push(env[name]);
  if (!isBlank(env.FIREBASE_CONFIG)) {
    const cfg = G.projectIdFromFirebaseConfig(env.FIREBASE_CONFIG);
    if (!cfg.ok) reasons.push('FIREBASE_CONFIG_UNREADABLE');
    else if (cfg.projectId !== null) seen.push(cfg.projectId);
  }
  if (seen.some((id) => normalizeId(id) !== PROJECT_ID)) reasons.push('PROJECT_MISMATCH');
  if (reasons.length > 0) return {ok: false, reasons};
  return {ok: true, target: TARGET.PRODUCTION, projectId: PROJECT_ID};
}

/** تطبيق Admin مسمّى بمشروع صريح (الاعتماد من بيئة الطرفية وحدها: ADC). لا يلمس التطبيق الافتراضي. */
function initAdmin(projectId) {
  const admin = require('firebase-admin');
  const existing = admin.apps.find((a) => a && a.name === APP_NAME);
  const app = existing || admin.initializeApp({projectId}, APP_NAME);
  return {db: app.firestore(), FieldValue: admin.firestore.FieldValue};
}

// ───────────────────────── عرض آمن ─────────────────────────

/** اسم المحلّ للعرض: name ثم displayName احتياطاً (نصّ غير فارغ)؛ والغائب «(بلا اسم)» صراحةً لا تخميناً. */
function shopNameOf(data) {
  const d = isObj(data) ? data : {};
  const pick = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const name = pick(d.name);
  if (name !== null) return {name, source: 'name'};
  const display = pick(d.displayName);
  if (display !== null) return {name: display, source: 'displayName'};
  return {name: NO_NAME, source: 'NONE'};
}

/** سلسلة JSON لنصّ (سطر واحد دائماً)، وبـ--ascii-names تُهرَّب الأحرف غير ASCII. */
function quote(text, ascii) {
  const json = JSON.stringify(String(text).slice(0, MAX_NAME_CHARS));
  return ascii ? json.replace(/[^\x20-\x7E]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : json;
}

const displayType = (data, ascii) => (isObj(data) && typeof data.type === 'string' ? quote(data.type, ascii) : ABSENT);

/** قيمة حقل خام للعرض: عدد/منطقي كما هو، والغائب ABSENT، وغير المتوقَّع INVALID (لا قيمة خام). */
function rawHours(settingsData) {
  const v = isObj(settingsData) ? settingsData[HOURS_FIELD] : undefined;
  if (v === undefined || v === null) return ABSENT;
  return typeof v === 'number' && Number.isFinite(v) ? v : INVALID;
}
function rawPart(userData, part) {
  const m = isObj(userData) && isObj(userData[SHOP_PARTS_FIELD]) ? userData[SHOP_PARTS_FIELD] : null;
  if (m === null || !has(m, part) || m[part] === undefined || m[part] === null) return ABSENT;
  return typeof m[part] === 'boolean' ? m[part] : INVALID;
}

// ───────────────────────── قراءة الإعدادات والمحالّ ─────────────────────────

const settingsRefOf = (db) => db.collection(PROTOCOL_COLLECTION.PROTOCOL_SETTINGS).doc(PROTOCOL_SETTINGS_PATH.CURRENT_DOC);
const userRefOf = (db, uid) => db.collection(USERS_COLLECTION).doc(uid);

/** حالة مستند الإعدادات: PRESENT · SETTINGS_ABSENT (لا مستند) · VERSION_UNUSABLE (مستند بلا version صالح: يُقرأ غائباً ويُعلَن). */
function viewSettings(snapExists, data) {
  const reading = readSettingsDocument(snapExists ? data : null);
  if (reading.state === SETTINGS_STATE.PRESENT) return {state: SETTINGS_STATE_NAME.PRESENT, version: reading.version, hours: rawHours(data), data};
  return {state: snapExists ? SETTINGS_STATE_NAME.UNUSABLE : SETTINGS_STATE_NAME.ABSENT, version: null, hours: ABSENT, data: snapExists ? data : null};
}

async function readSettings(db) {
  const snap = await settingsRefOf(db).get();
  return viewSettings(snap.exists, snap.exists ? snap.data() : null);
}

/**
 * مسح users بقناع حقول وسقف (استعلام واحد بلا مرشّح ولا ترتيب: لا فهرس، القاعدة 43). فوق السقف ⟵ exceeded صريح.
 * @param {Object} db
 * @param {{fields: string[], cap: number}} p
 * @return {Promise<{exceeded: boolean, entries: Array<{id: string, data: Object}>}>}
 */
async function scanUsers(db, {fields, cap}) {
  const snap = await db.collection(USERS_COLLECTION).select(...fields).limit(cap + 1).get();
  if (snap.docs.length > cap) return {exceeded: true, entries: []};
  return {exceeded: false, entries: snap.docs.map((d) => ({id: d.id, data: d.data()}))};
}

/** يطابق وسيط --shop (رمز #<12 سداسياً> أو uid) على المدخلات: واحد بالضبط. */
function matchShop(entries, arg, hashId) {
  const wanted = arg.trim();
  const matches = CODE_PATTERN.test(wanted) ?
      entries.filter((e) => hashId(e.id) === `#${wanted.replace(/^#/, '').toLowerCase()}`) :
      entries.filter((e) => e.id === wanted);
  if (matches.length === 0) throw new ToolError(REFUSAL.SHOP_NOT_FOUND);
  if (matches.length > 1) throw new ToolError(REFUSAL.SHOP_AMBIGUOUS);
  return matches[0];
}

/** معرّف المحلّ لوضعَي الكتابة: uid ⟵ قراءة بالمسار؛ رمز ⟵ مسح بمعرّفات وحدها (select() بلا حقول). */
async function resolveShopUid(db, arg, {hashId, cap}) {
  const wanted = String(arg).trim();
  if (CODE_PATTERN.test(wanted)) {
    const scanned = await scanUsers(db, {fields: [], cap});
    if (scanned.exceeded) throw new ToolError(REFUSAL.SHOP_SCAN_CAP_EXCEEDED);
    return matchShop(scanned.entries, wanted, hashId).id;
  }
  const uid = readShopId(wanted);
  if (uid === null) throw new ToolError(REFUSAL.SHOP_NOT_FOUND);
  const snap = await userRefOf(db, uid).get();
  if (!snap.exists) throw new ToolError(REFUSAL.SHOP_NOT_FOUND);
  return uid;
}

// ───────────────────────── الخطّة (دوالّ نقيّة) ─────────────────────────

/**
 * خطّة حقل الإعدادات: بالدوالّ نفسها التي يستعملها النداء (validateSettingsPatch ثم applySettingsPatch)، لا بمقارنة يدوية.
 * @param {?Object} current مستند الإعدادات الحاضر (null: لا مستند)
 * @param {number} hours
 * @return {{refused: ?string, changed: boolean, nextVersion: ?number, version: ?number}}
 */
function planSettings(current, hours) {
  const reading = readSettingsDocument(current);
  if (current !== null && reading.state !== SETTINGS_STATE.PRESENT) return {refused: REFUSAL.SETTINGS_CURRENT_VERSION_INVALID, changed: false, nextVersion: null, version: null};
  const v = validateSettingsPatch({[HOURS_FIELD]: hours});
  if (!v.ok) return {refused: v.refusal, changed: false, nextVersion: null, version: null};
  const applied = applySettingsPatch({current, values: v.values});
  if (!applied.ok) return {refused: applied.refusal, changed: false, nextVersion: null, version: null};
  const changed = current === null || applied.changed.length > 0;
  const version = current === null ? null : reading.version;
  return {refused: null, changed, nextVersion: changed ? (version === null ? 1 : version + 1) : version, version};
}

/** خطّة الجزأين: ما يتغيّر فعلاً بقاعدة القارئ (=== true وحدها) عبر changedParts نفسها. */
function planParts(userData, patch) {
  const v = validatePartsPatch(patch);
  if (!v.ok) return {refused: v.refusal, changed: []};
  return {refused: null, patch: v.patch, changed: changedParts(readProtocolParts(isObj(userData) ? userData : {}), v.patch)};
}

const maintenancePatch = () => Object.fromEntries(MAINTENANCE_PARTS.map((p) => [p, true]));

/** القيم السابقة كما تُسجَّل في ملفّ التراجع (وتُقارَن داخل المعاملة). */
function previousOf(settingsView, userData) {
  return {
    [HOURS_FIELD]: settingsView.state === SETTINGS_STATE_NAME.PRESENT ? settingsView.hours : ABSENT,
    settingsVersion: settingsView.state === SETTINGS_STATE_NAME.PRESENT ? settingsView.version : ABSENT,
    ...Object.fromEntries(MAINTENANCE_PARTS.map((p) => [p, rawPart(userData, p)])),
  };
}

// ───────────────────────── الحارس قبل الكتابة ─────────────────────────

/**
 * يفحص ما سيُكتب قبل أن يُكتب: لا مفتاح يتغيّر غير المسموح. @return {string[]} مخالفات (فارغة = سليم).
 * writes.settings: المستند الكامل الذي سيُكتب (أو null) · writes.user: ما يُمرَّر إلى tx.update (أو null).
 * @param {{settingsBefore: ?Object, userBefore: ?Object, writes: {settings: ?Object, user: ?Object}}} p
 * @return {string[]}
 */
function verifyPlannedWrites({settingsBefore, userBefore, writes}) {
  const violations = [];
  if (writes.settings !== null && writes.settings !== undefined) {
    const before = isObj(settingsBefore) ? settingsBefore : {};
    const allowed = [HOURS_FIELD, ...SETTINGS_BOOKKEEPING];
    for (const k of new Set([...Object.keys(before), ...Object.keys(writes.settings)])) {
      if (allowed.includes(k)) continue;
      if (!has(writes.settings, k)) violations.push(`settings:${k}:REMOVED`);
      else if (!has(before, k) || canonical(before[k]) !== canonical(writes.settings[k])) violations.push(`settings:${k}:CHANGED`);
    }
    if (typeof writes.settings[HOURS_FIELD] !== 'number') violations.push(`settings:${HOURS_FIELD}:NOT_A_NUMBER`);
  }
  if (writes.user !== null && writes.user !== undefined) {
    for (const k of Object.keys(writes.user)) if (k !== SHOP_PARTS_FIELD) violations.push(`user:${k}:KEY_NOT_ALLOWED`);
    const next = isObj(writes.user[SHOP_PARTS_FIELD]) ? writes.user[SHOP_PARTS_FIELD] : null;
    if (next === null) violations.push(`user:${SHOP_PARTS_FIELD}:NOT_A_MAP`);
    else {
      const before = isObj(userBefore) && isObj(userBefore[SHOP_PARTS_FIELD]) ? userBefore[SHOP_PARTS_FIELD] : {};
      for (const k of new Set([...Object.keys(before), ...Object.keys(next)])) {
        if (MAINTENANCE_PARTS.includes(k)) {
          if (!has(next, k) || typeof next[k] !== 'boolean') violations.push(`user:${SHOP_PARTS_FIELD}.${k}:NOT_A_BOOLEAN`);
        } else if (!has(next, k)) violations.push(`user:${SHOP_PARTS_FIELD}.${k}:REMOVED`);
        else if (!has(before, k) || canonical(before[k]) !== canonical(next[k])) violations.push(`user:${SHOP_PARTS_FIELD}.${k}:CHANGED`);
      }
    }
  }
  return violations;
}

// ───────────────────────── المعاملة (الكتابة الوحيدة) ─────────────────────────

/**
 * المعاملة الوحيدة: قراءة المستندين، ثم (بقراءاتها وحدها) قرار الإعدادات (create لـhistory/{الإصدار السابق} ثم set بـversion+1 وupdatedAt وupdatedBy) وقرار الجزأين (update بـ{protocolParts: {...الحاضر, ...الرقعة}})،
 * ثم الكتابة. تُرجِع قراراً ولا ترمي (الاستثناء من المزوّد وحده). لا delete ولا batch ولا حقل خارج ما يتحقّق منه verifyPlannedWrites.
 * @param {Object} p
 * @param {Object} p.db Firestore الخام (لا المغلَّف بـwrapReadOnly)
 * @param {Object} p.FieldValue
 * @param {string} p.shopUid
 * @param {?number} p.hours القيمة التي تُكتب لـopenBeforeValidityHours (null: لا تُكتب)
 * @param {Object<string, boolean>} p.partsPatch
 * @param {?Object} [p.expectPrevious] القيم السابقة المسجَّلة في ملفّ التراجع: اختلافها داخل المعاملة ⟵ SNAPSHOT_CHANGED
 * @return {Promise<Object>}
 */
async function applyInTransaction({db, FieldValue, shopUid, hours, partsPatch, expectPrevious = null}) {
  const settingsRef = settingsRefOf(db);
  const userRef = userRefOf(db, shopUid);
  return db.runTransaction(async (tx) => {
    const settingsSnap = await tx.get(settingsRef);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return {refused: REFUSAL.SHOP_NOT_FOUND};
    const current = settingsSnap.exists ? settingsSnap.data() : null;
    const userData = userSnap.data();
    const view = viewSettings(settingsSnap.exists, current);
    if (current !== null && view.state !== SETTINGS_STATE_NAME.PRESENT) return {refused: REFUSAL.SETTINGS_CURRENT_VERSION_INVALID};
    if (expectPrevious !== null && canonical(previousOf(view, userData)) !== canonical(expectPrevious)) return {refused: REFUSAL.SNAPSHOT_CHANGED};

    let settingsWrite = null;
    let historyWrite = null;
    if (hours !== null) {
      const plan = planSettings(current, hours);
      if (plan.refused !== null) return {refused: plan.refused};
      if (plan.changed) {
        const v = validateSettingsPatch({[HOURS_FIELD]: hours});
        const applied = applySettingsPatch({current, values: v.values});
        const fromVersion = view.version === null ? 0 : view.version;
        if (current !== null) {
          historyWrite = {id: String(fromVersion), data: {...current, [HISTORY_FIELD.SUPERSEDED_AT]: FieldValue.serverTimestamp(), [HISTORY_FIELD.SUPERSEDED_BY_VERSION]: plan.nextVersion, [HISTORY_FIELD.SUPERSEDED_BY]: UPDATED_BY}};
        }
        settingsWrite = {...applied.next, version: plan.nextVersion, updatedAt: FieldValue.serverTimestamp(), updatedBy: UPDATED_BY};
      }
    }
    const partsPlan = planParts(userData, partsPatch);
    if (partsPlan.refused !== null) return {refused: partsPlan.refused};
    let userWrite = null;
    if (partsPlan.changed.length > 0) {
      const existing = isObj(userData[SHOP_PARTS_FIELD]) ? userData[SHOP_PARTS_FIELD] : {};
      userWrite = {[SHOP_PARTS_FIELD]: {...existing, ...partsPlan.patch}};
    }
    const violations = verifyPlannedWrites({settingsBefore: current, userBefore: userData, writes: {settings: settingsWrite, user: userWrite}});
    if (violations.length > 0) return {refused: null, guard: violations};

    if (historyWrite !== null) tx.create(settingsRef.collection(PROTOCOL_SETTINGS_PATH.HISTORY_SUBCOLLECTION).doc(historyWrite.id), historyWrite.data);
    if (settingsWrite !== null) tx.set(settingsRef, settingsWrite);
    if (userWrite !== null) tx.update(userRef, userWrite);
    return {
      refused: null, guard: null,
      beforeSettings: current, beforeUser: userData,
      settingsChanged: settingsWrite !== null, partsChanged: partsPlan.changed,
      versionBefore: view.version, versionAfter: settingsWrite !== null ? settingsWrite.version : view.version,
      historyId: historyWrite !== null ? historyWrite.id : null,
    };
  });
}

// ───────────────────────── القراءة البعدية والفرق ─────────────────────────

/** أوراق مستند كمسار ⟵ تمثيل قانوني (الأوقات والمراجع والبايتات بأنواعها لا بقيمها الخام). الحاويات الفارغة لا ورقة لها. */
function flatten(value, prefix = [], out = new Map()) {
  const leaf = (repr) => out.set(prefix.map(String).join('\u0000'), repr);
  if (value === null || value === undefined) { leaf(JSON.stringify(value === undefined ? null : value)); return out; }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') { leaf(`TS:${value.toMillis()}`); return out; }
    if (typeof value.path === 'string' && value.firestore !== undefined) { leaf(`REF:${value.path}`); return out; }
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && Object.keys(value).length <= 4) { leaf(`GEO:${value.latitude},${value.longitude}`); return out; }
    if (value instanceof Uint8Array) { leaf(`BYTES:${Buffer.from(value).toString('hex')}`); return out; }
    if (Array.isArray(value)) { value.forEach((x, i) => flatten(x, [...prefix, `[${i}]`], out)); return out; }
    for (const k of Object.keys(value).sort()) flatten(value[k], [...prefix, k], out);
    return out;
  }
  leaf(JSON.stringify(value));
  return out;
}

/** مسار للعرض: المقاطع المعروفة الشكل كما هي، وغيرها (قد يحمل بيانات) مهشَّر؛ فهارس المصفوفات كما هي. */
function displayPath(joined, hashId) {
  return joined.split('\u0000').map((seg) => (/^\[\d+\]$/.test(seg) || /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(seg) ? seg : `<key:${hashId(seg)}>`)).join('.').replace(/\.\[/g, '[');
}

/** فرق قبل/بعد بالمسارات: ADDED · REMOVED · CHANGED. @return {Array<{path: string, kind: string}>} مرتّبة */
function diffFlat(before, after) {
  const out = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    if (!before.has(k)) out.push({path: k, kind: 'ADDED'});
    else if (!after.has(k)) out.push({path: k, kind: 'REMOVED'});
    else if (before.get(k) !== after.get(k)) out.push({path: k, kind: 'CHANGED'});
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * يقارن لقطة «قبل» (من داخل المعاملة) بالقراءة البعدية ويصنّف: expected (مسموح) · required (واجب أن يتغيّر) · unexpected · missing.
 * @param {{before: ?Object, after: ?Object, required: string[], allowed: string[]}} p المسارات خام (مقاطع مفصولة بالفاصل الصفري)
 * @return {{expected: Array<{path: string, kind: string}>, unexpected: Array<{path: string, kind: string}>, missing: string[]}}
 */
function classifyDiff({before, after, required, allowed}) {
  const diff = diffFlat(flatten(before === null || before === undefined ? {} : before), flatten(after === null || after === undefined ? {} : after));
  const allow = [...required, ...allowed];
  const expected = diff.filter((d) => allow.includes(d.path));
  const unexpected = diff.filter((d) => !allow.includes(d.path));
  const missing = required.filter((r) => !diff.some((d) => d.path === r));
  return {expected, unexpected, missing};
}

// ───────────────────────── ملفّ التراجع ─────────────────────────

const ROLLBACK_KEYS = Object.freeze(['afterVersions', 'previous', 'projectId', 'shopUid', 'target', 'version', 'writtenAtMs']);
const PREVIOUS_KEYS = Object.freeze([HOURS_FIELD, 'settingsVersion', ...MAINTENANCE_PARTS].sort());

function buildRollbackFile({nowMs, shopUid, projectId, target, previous, afterVersion}) {
  return {version: SCHEMA, writtenAtMs: nowMs, shopUid, projectId, target, previous, afterVersions: {settingsVersion: afterVersion}};
}

/** يقرأ ملفّ التراجع ويتحقّق من شكله بصرامة. @throws {ToolError} ROLLBACK_FILE_MISSING | ROLLBACK_FILE_INVALID */
function readRollbackFile(filePath) {
  let text;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size > MAX_ROLLBACK_FILE_BYTES) throw new ToolError(REFUSAL.ROLLBACK_FILE_INVALID);
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(e && e.code === 'ENOENT' ? REFUSAL.ROLLBACK_FILE_MISSING : REFUSAL.ROLLBACK_FILE_INVALID);
  }
  let f;
  try { f = JSON.parse(text); } catch (e) { throw new ToolError(REFUSAL.ROLLBACK_FILE_INVALID); }
  const bad = () => new ToolError(REFUSAL.ROLLBACK_FILE_INVALID);
  if (!isObj(f) || Object.keys(f).sort().join() !== ROLLBACK_KEYS.join()) throw bad();
  if (f.version !== SCHEMA || !Number.isFinite(f.writtenAtMs) || typeof f.projectId !== 'string' || f.projectId === '' || !Object.values(TARGET).includes(f.target)) throw bad();
  if (typeof f.shopUid !== 'string' || readShopId(f.shopUid) === null) throw bad();
  if (!isObj(f.previous) || Object.keys(f.previous).sort().join() !== PREVIOUS_KEYS.join()) throw bad();
  const p = f.previous;
  const hoursOk = p[HOURS_FIELD] === ABSENT || p[HOURS_FIELD] === INVALID || (typeof p[HOURS_FIELD] === 'number' && Number.isFinite(p[HOURS_FIELD]));
  const versionOk = p.settingsVersion === ABSENT || (Number.isInteger(p.settingsVersion) && p.settingsVersion >= 1);
  const partsOk = MAINTENANCE_PARTS.every((k) => typeof p[k] === 'boolean' || p[k] === ABSENT || p[k] === INVALID);
  if (!hoursOk || !versionOk || !partsOk) throw bad();
  if (!isObj(f.afterVersions) || Object.keys(f.afterVersions).join() !== 'settingsVersion') throw bad();
  const av = f.afterVersions.settingsVersion;
  if (av !== null && !(Number.isInteger(av) && av >= 1)) throw bad();
  return f;
}

// ───────────────────────── الأوضاع ─────────────────────────

/** سطر مخرَج منظَّم. */
const lineOf = (prefix, kind, pairs) => `${prefix}|${kind}${pairs.length > 0 ? ' ' : ''}${pairs.map(([k, v]) => `${k}=${v}`).join(' ')}`;

function shopRow(entry, {hashId, ascii}) {
  const nm = shopNameOf(entry.data);
  const parts = readProtocolParts(entry.data);
  return {
    uid: entry.id, code: hashId(entry.id), nameText: nm.name, nameSource: nm.source, type: displayType(entry.data, ascii),
    nameQuoted: quote(nm.name, ascii), purposes: parts[PROTOCOL_PART.PURPOSES], batteryBeforeAfter: parts[PROTOCOL_PART.BATTERY_BEFORE_AFTER],
    partsState: isObj(entry.data) && isObj(entry.data[SHOP_PARTS_FIELD]) ? 'PRESENT' : ABSENT, data: entry.data,
  };
}

/** أسطر خطّة محلّ واحد (PLAN|…) من لقطة الإعدادات وبيانات المحلّ المقروءة. @return {{lines: string[], writes: number, unchanged: number}} */
function planLines({settingsView, row}) {
  const lines = [lineOf('PLAN', 'TARGET', [['code', row.code], ['name', row.nameQuoted], ['type', row.type]])];
  let writes = 0;
  let unchanged = 0;
  const sp = planSettings(settingsView.data, MAINTENANCE_HOURS);
  if (sp.refused !== null) {
    lines.push(lineOf('PLAN', 'FIELD', [['name', HOURS_FIELD], ['current', settingsView.hours], ['new', MAINTENANCE_HOURS], ['action', `REFUSED reason=${sp.refused}`]]));
  } else {
    lines.push(lineOf('PLAN', 'FIELD', [['name', HOURS_FIELD], ['current', settingsView.hours], ['new', MAINTENANCE_HOURS], ['action', sp.changed ? 'WRITE' : 'UNCHANGED']]));
    if (sp.changed) writes++; else unchanged++;
  }
  const pp = planParts(row.data, maintenancePatch());
  for (const part of MAINTENANCE_PARTS) {
    const changed = pp.changed.includes(part);
    lines.push(lineOf('PLAN', 'FIELD', [['name', part], ['current', rawPart(row.data, part)], ['reads', readProtocolParts(row.data)[part]], ['new', true], ['action', changed ? 'WRITE' : 'UNCHANGED']]));
    if (changed) writes++; else unchanged++;
  }
  lines.push(lineOf('PLAN', 'SUMMARY', [['writes', writes], ['unchanged', unchanged]]));
  return {lines, writes, unchanged};
}

/** المعاينة: قراءة وحدها. db هنا مغلَّف بـwrapReadOnly ولا مسار كتابة في هذه الدالّة (يحرس ذلك اختبار بمسح مصدرها). */
async function runPreview({db, args, env, out, hashId, cap}) {
  out(lineOf('PREVIEW', 'ENV', [['target', env.target], ['project', env.projectId]]));
  const settingsView = await readSettings(db);
  out(lineOf('PREVIEW', 'SETTINGS', [['state', settingsView.state], ['version', settingsView.version === null ? 'NONE' : settingsView.version], [HOURS_FIELD, settingsView.hours]]));
  const scanned = await scanUsers(db, {fields: PREVIEW_FIELDS, cap});
  if (scanned.exceeded) {
    out(lineOf('PREVIEW', 'SHOPS', [['state', 'CAP_EXCEEDED'], ['cap', cap]]));
    throw new ToolError(REFUSAL.SHOP_SCAN_CAP_EXCEEDED);
  }
  const rows = scanned.entries.map((e) => shopRow(e, {hashId, ascii: args.asciiNames}));
  rows.sort((a, b) => (a.nameText < b.nameText ? -1 : a.nameText > b.nameText ? 1 : (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));
  out(lineOf('PREVIEW', 'SHOPS', [['count', rows.length], ['cap', cap]]));
  rows.forEach((r, i) => out(lineOf('PREVIEW', 'SHOP', [['n', i + 1], ['code', r.code], ['name', r.nameQuoted], ['nameSource', r.nameSource], ['type', r.type], [PROTOCOL_PART.PURPOSES, r.purposes], [PROTOCOL_PART.BATTERY_BEFORE_AFTER, r.batteryBeforeAfter], [SHOP_PARTS_FIELD, r.partsState]])));
  if (args.shop !== null) {
    const row = shopRow(matchShop(scanned.entries, args.shop, hashId), {hashId, ascii: args.asciiNames});
    const plan = planLines({settingsView, row});
    for (const l of plan.lines) out(l);
  }
  return {exit: EXIT.OK, result: 'OK', writes: 0};
}

/** يطبع الفرق البعدي ويعيد حكمه. */
function reportDiff({prefix, out, hashId, txResult, afterSettings, afterUser, afterHistory}) {
  const expectedSettings = txResult.settingsChanged ? [HOURS_FIELD, 'version'] : [];
  const allowedSettings = txResult.settingsChanged ? ['updatedAt', 'updatedBy'] : [];
  const requiredUser = txResult.partsChanged.map((p) => `${SHOP_PARTS_FIELD}\u0000${p}`);
  const sets = [
    {label: 'SETTINGS', before: txResult.beforeSettings, after: afterSettings, required: expectedSettings, allowed: allowedSettings},
    {label: 'SHOP', before: txResult.beforeUser, after: afterUser, required: requiredUser, allowed: []},
  ];
  let unexpectedCount = 0;
  let any = false;
  for (const s of sets) {
    const c = classifyDiff(s);
    for (const d of c.expected) { any = true; out(lineOf('DIFF', s.label, [['path', displayPath(d.path, hashId)], ['kind', d.kind], ['expected', true]])); }
    for (const d of c.unexpected) { unexpectedCount++; out(`DIFF-UNEXPECTED ${s.label}:${displayPath(d.path, hashId)}`); }
    for (const m of c.missing) { unexpectedCount++; out(`DIFF-MISSING ${s.label}:${displayPath(m, hashId)}`); }
  }
  if (txResult.historyId !== null) {
    const expectHistory = {...txResult.beforeSettings, [HISTORY_FIELD.SUPERSEDED_BY_VERSION]: txResult.versionAfter, [HISTORY_FIELD.SUPERSEDED_BY]: UPDATED_BY};
    // بصمة الوقت تُستثنى من المقارنة بعد التحقّق من نوعها (Timestamp)؛ والنسخة محلّية من القراءة لا مستند Firestore (تفكيك لا حذف)
    const {[HISTORY_FIELD.SUPERSEDED_AT]: stampValue, ...got} = afterHistory === null ? {} : afterHistory;
    const stamp = stampValue !== undefined && stampValue !== null && typeof stampValue.toMillis === 'function';
    const hist = classifyDiff({before: expectHistory, after: afterHistory === null ? {} : got, required: [], allowed: []});
    const created = afterHistory !== null;
    const matches = created && stamp && hist.unexpected.length === 0 && hist.missing.length === 0;
    out(lineOf('DIFF', 'HISTORY', [['version', txResult.historyId], ['created', created], ['matches', matches]]));
    if (!matches) {
      unexpectedCount++;
      for (const d of hist.unexpected) out(`DIFF-UNEXPECTED HISTORY:${displayPath(d.path, hashId)}`);
      if (!created) out('DIFF-MISSING HISTORY:document');
      else if (!stamp) out(`DIFF-UNEXPECTED HISTORY:${HISTORY_FIELD.SUPERSEDED_AT}`);
    }
    any = true;
  }
  if (!any && unexpectedCount === 0) out(lineOf('DIFF', 'NONE', [['prefix', prefix]]));
  return unexpectedCount;
}

/** الكتابة أو التراجع (المسار المشترك بعد حلّ المدخلات). @return {Promise<{exit: number, result: string, writes: number}>} */
async function runApply({mode, ro, db, FieldValue, out, err, shopUid, hours, partsPatch, expectPrevious, hashId, beforeTransaction, afterTransaction, markWriting}) {
  const prefix = PREFIX[mode];
  markWriting();
  if (beforeTransaction) await beforeTransaction({db}); // خطّاف اختبار وحده: يغيّر الحال بين اللقطة والمعاملة (سباق)
  const tx = await applyInTransaction({db, FieldValue, shopUid, hours, partsPatch, expectPrevious});
  if (tx.refused) throw new ToolError(tx.refused);
  if (tx.guard) {
    out(lineOf(prefix, 'GUARD', [['violations', tx.guard.length]]));
    for (const v of tx.guard) out(`DIFF-UNEXPECTED PLANNED:${v.split(':')[0]}`); // نوع المستند وحده (الاسم الدقيق لا يُطبع: قد يكون من بيانات)
    return {exit: EXIT.DIFF_UNEXPECTED, result: 'DIFF-UNEXPECTED', writes: 0};
  }
  if (afterTransaction) await afterTransaction({db});
  out(lineOf(prefix, 'SETTINGS', [['changed', tx.settingsChanged], ['versionBefore', tx.versionBefore === null ? 'NONE' : tx.versionBefore], ['versionAfter', tx.versionAfter === null ? 'NONE' : tx.versionAfter], ['historyCreated', tx.historyId !== null]]));
  out(lineOf(prefix, 'SHOP', [['changed', tx.partsChanged.length > 0 ? tx.partsChanged.join(',') : 'none']]));
  const afterSettingsSnap = await settingsRefOf(ro).get();
  const afterUserSnap = await userRefOf(ro, shopUid).get();
  const afterHistory = tx.historyId !== null ? await settingsRefOf(ro).collection(PROTOCOL_SETTINGS_PATH.HISTORY_SUBCOLLECTION).doc(tx.historyId).get() : null;
  // الحال بعد الكتابة كما قُرئ (للعين وللكتلة): قيم الحقلين وإصدار الإعدادات وحدها، بلا بيانات خاصّة
  const afterView = viewSettings(afterSettingsSnap.exists, afterSettingsSnap.exists ? afterSettingsSnap.data() : null);
  const afterParts = readProtocolParts(afterUserSnap.exists ? afterUserSnap.data() : {});
  out(lineOf(prefix, 'AFTER', [[HOURS_FIELD, afterView.hours], ['settingsVersion', afterView.version === null ? 'NONE' : afterView.version], [PROTOCOL_PART.PURPOSES, afterParts[PROTOCOL_PART.PURPOSES]], [PROTOCOL_PART.BATTERY_BEFORE_AFTER, afterParts[PROTOCOL_PART.BATTERY_BEFORE_AFTER]]]));
  const unexpected = reportDiff({
    prefix, out, hashId, txResult: tx,
    afterSettings: afterSettingsSnap.exists ? afterSettingsSnap.data() : null, afterUser: afterUserSnap.exists ? afterUserSnap.data() : null,
    afterHistory: afterHistory !== null && afterHistory.exists ? afterHistory.data() : null,
  });
  err(`[${MODE}] read-back done: ${unexpected === 0 ? 'only the permitted paths changed' : `${unexpected} unexpected difference(s)`}`);
  const writes = (tx.settingsChanged ? 1 : 0) + (tx.partsChanged.length > 0 ? 1 : 0);
  if (unexpected > 0) return {exit: EXIT.DIFF_UNEXPECTED, result: 'DIFF-UNEXPECTED', writes};
  return {exit: EXIT.OK, result: writes === 0 ? 'UNCHANGED' : 'OK', writes};
}

/** وضع الكتابة بعد حلّ المحلّ: لقطة «قبل»، خطّة، ملفّ التراجع (قبل الكتابة)، ثم المعاملة والفرق. */
async function runWrite({ro, db, FieldValue, args, env, out, err, hashId, now, io, markWriting, cap}) {
  out(lineOf('WRITE', 'ENV', [['target', env.target], ['project', env.projectId]]));
  const shopUid = await resolveShopUid(ro, args.shop, {hashId, cap});
  const userSnap = await userRefOf(ro, shopUid).get();
  if (!userSnap.exists) throw new ToolError(REFUSAL.SHOP_NOT_FOUND);
  const userData = userSnap.data();
  const row = shopRow({id: shopUid, data: userData}, {hashId, ascii: args.asciiNames});
  out(lineOf('WRITE', 'TARGET', [['code', row.code], ['name', row.nameQuoted], ['type', row.type]]));
  const settingsView = await readSettings(ro);
  if (settingsView.state === SETTINGS_STATE_NAME.UNUSABLE) throw new ToolError(REFUSAL.SETTINGS_CURRENT_VERSION_INVALID);
  const sPlan = planSettings(settingsView.data, MAINTENANCE_HOURS);
  if (sPlan.refused !== null) throw new ToolError(sPlan.refused);
  const pPlan = planParts(userData, maintenancePatch());
  out(lineOf('WRITE', 'PLAN', [['settings', sPlan.changed ? 'WRITE' : 'UNCHANGED'], ['parts', pPlan.changed.length > 0 ? pPlan.changed.join(',') : 'none']]));

  const previous = previousOf(settingsView, userData);
  const file = buildRollbackFile({nowMs: now(), shopUid, projectId: env.projectId, target: env.target, previous, afterVersion: sPlan.nextVersion});
  const write = io.writeRollbackFile || C.writeOutputExclusive;
  try {
    write(args.rollbackFile, file);
  } catch (e) {
    throw new ToolError(e && (e.reason === 'OUT_EXISTS' || e.code === 'EEXIST') ? REFUSAL.ROLLBACK_FILE_EXISTS : REFUSAL.ROLLBACK_FILE_UNWRITABLE);
  }
  out(lineOf('WRITE', 'ROLLBACK-FILE', [['written', true], ['path', JSON.stringify(args.rollbackFile)]]));
  err(`[${MODE}] rollback file written BEFORE the write; keep it. Writing in ONE transaction: ${HOURS_FIELD} + parts for this shop only.`);
  return runApply({mode: 'write', ro, db, FieldValue, out, err, shopUid, hours: MAINTENANCE_HOURS, partsPatch: maintenancePatch(), expectPrevious: previous, hashId, beforeTransaction: io.beforeTransaction, afterTransaction: io.afterTransaction, markWriting});
}

/** وضع التراجع بعد التحقّق من الملفّ والوجهة. */
async function runRollback({ro, db, FieldValue, file, env, out, err, hashId, io, markWriting}) {
  out(lineOf('ROLLBACK', 'ENV', [['target', env.target], ['project', env.projectId]]));
  out(lineOf('ROLLBACK', 'FILE', [['schema', file.version], ['project', file.projectId], ['target', file.target], ['shop', hashId(file.shopUid)]]));
  const userSnap = await userRefOf(ro, file.shopUid).get();
  if (!userSnap.exists) throw new ToolError(REFUSAL.SHOP_NOT_FOUND);
  const userData = userSnap.data();
  const row = shopRow({id: file.shopUid, data: userData}, {hashId, ascii: false});
  out(lineOf('ROLLBACK', 'TARGET', [['code', row.code], ['name', row.nameQuoted], ['type', row.type]]));
  const settingsView = await readSettings(ro);
  if (settingsView.state === SETTINGS_STATE_NAME.UNUSABLE) throw new ToolError(REFUSAL.SETTINGS_CURRENT_VERSION_INVALID);
  const expectedVersion = file.afterVersions.settingsVersion;
  const currentVersion = settingsView.state === SETTINGS_STATE_NAME.PRESENT ? settingsView.version : null;
  if (expectedVersion !== null && currentVersion !== expectedVersion) out(`ROLLBACK|WARN settings-version-changed expected=${expectedVersion} current=${currentVersion === null ? 'NONE' : currentVersion}`);

  const prev = file.previous;
  const partsPatch = Object.fromEntries(MAINTENANCE_PARTS.map((p) => [p, prev[p] === true]));
  const absentParts = MAINTENANCE_PARTS.filter((p) => typeof prev[p] !== 'boolean');
  for (const p of MAINTENANCE_PARTS) out(lineOf('ROLLBACK', 'PART', [['name', p], ['previous', prev[p]], ['writes', partsPatch[p]]]));
  if (absentParts.length > 0) out(lineOf('ROLLBACK', 'NOTE', [['previous', 'ABSENT'], ['parts', absentParts.join(',')], ['written', false], ['why', 'the-reader-enables-a-part-only-on-true']]));

  let hours = null;
  const prevHours = prev[HOURS_FIELD];
  if (typeof prevHours === 'number') {
    const check = planSettings(settingsView.data, prevHours);
    if (check.refused !== null) out(lineOf('ROLLBACK', 'HOURS', [['previous', prevHours], ['action', 'KEPT'], ['reason', 'PREVIOUS_NOT_RESTORABLE'], ['current', settingsView.hours]]));
    else {
      hours = prevHours;
      out(lineOf('ROLLBACK', 'HOURS', [['previous', prevHours], ['action', check.changed ? 'WRITE' : 'UNCHANGED']]));
    }
  } else {
    out(lineOf('ROLLBACK', 'HOURS', [['previous', prevHours], ['action', 'KEPT'], ['reason', prevHours === ABSENT ? 'ABSENT_CANNOT_BE_CLEARED' : 'PREVIOUS_INVALID'], ['current', settingsView.hours]]));
    err(`[${MODE}] ${HOURS_FIELD} was ABSENT before the write: it cannot be cleared (no delete path); it stays at its current value (no effect while both parts are disabled).`);
  }
  return runApply({mode: 'rollback', ro, db, FieldValue, out, err, shopUid: file.shopUid, hours, partsPatch, expectPrevious: null, hashId, beforeTransaction: io.beforeTransaction, afterTransaction: io.afterTransaction, markWriting});
}

module.exports = {
  PROJECT_ID, MODE, APP_NAME, SCHEMA, EXIT, CONFIRM_WRITE, CONFIRM_ROLLBACK, ACTOR_TAG, UPDATED_BY, MAINTENANCE_HOURS, MAINTENANCE_PARTS, HOURS_FIELD, SHOP_SCAN_CAP, ABSENT, INVALID, NO_NAME,
  USERS_COLLECTION, SHOP_PARTS_FIELD, HISTORY_FIELD, PREVIEW_FIELDS, REFUSAL, TARGET, PREFIX, UsageError, ToolError,
  safeText, parseArgs, usageText, checkEnvironment, initAdmin, readSettings, scanUsers, matchShop, resolveShopUid, planSettings, planParts, previousOf, verifyPlannedWrites, applyInTransaction,
  flatten, displayPath, diffFlat, classifyDiff, buildRollbackFile, readRollbackFile, lineOf, shopRow, planLines, runPreview, runWrite, runRollback,
};

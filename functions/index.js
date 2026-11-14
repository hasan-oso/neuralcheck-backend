// ============================================================================
// ⛔  BEFORE ANY  firebase deploy --only functions:…  — RUN THIS FIRST:
//
//     cd functions
//     node scripts/deploy-list.js <changed files under functions/src/>
//
//  To get that file list (baseline = the commit the function was LAST
//  deployed from, not the tip of master):
//     git diff --name-only <last-deployed-commit> master | grep functions/src/
//
//  It prints which functions MUST be redeployed, derived from the real
//  require graph. Three times already, correct merged code sat undeployed
//  because the list was written from memory — every one of them found by
//  accident. See docs/DEPLOY_CHECKLIST.md.
// ============================================================================

// NeuralCheck Cloud Functions — entry point.
//
// This file is the deploy surface for `firebase deploy --only functions`.
// All implementation lives in src/<domain>/. Each callable / scheduled /
// HTTP function is imported from its own module and re-exported below.
//
// Layout:
//   src/analysis/     — analyzeDevice, runAnalysisInternal, AI calls, prompt build
//   src/signatures/   — scan signature + comparison (PIPELINE_VERSION here)
//   src/profiles/     — deviceProfiles read/write
//   src/reports/      — generateReportPdf, verifyReport
//   src/payments/     — request/confirm/reject
//   src/sessions/     — createScanSession, joinScanSession, cancelScanSession, setSessionPurpose, recordScanConsent, startRepeatScan, getRepeatScanOffer, listOpenMaintenanceBefores, confirmMaintenanceAfterLink
//   src/users/        — registerUser, checkSubscription, redeemPromoCode
//   src/notifications/— sendNotificationEmail, checkExpiringSubscriptions
//   src/admin/        — runConsistencyTest, getAiConfig, setAiModel, setProtocolSettings, getProtocolSettings, setShopProtocolParts, manageTechnician, getShopProtocolConfig, correctProtocolRecord, setMarketingNames, getMarketingNames
//   src/prompts/      — systemPromptV3.js (current), systemPromptV4.js (placeholder)
//   src/utils/        — admin SDK, secrets, email transport/templates, manual tests
//
// DEPLOYMENT NOTE (V4 hardening):
//   DEEPSEEK_API_KEY is read via defineSecret() from Firebase Secret Manager.
//   Before deploying:
//     firebase functions:secrets:set DEEPSEEK_API_KEY
//     firebase functions:secrets:set GEMINI_API_KEY
//     firebase functions:secrets:set SMTP_USER
//     firebase functions:secrets:set SMTP_PASS
//   functions/.env retains the same DEEPSEEK_API_KEY for the local emulator only.

// Initialize firebase-admin once before any module loads.
require("./src/utils/admin");

// Analysis pipeline
const {analyzeDevice} = require("./src/analysis/analyzeDevice");

// Reports
const {generateReportPdf} = require("./src/reports/generateReportPdf");
const {verifyReport} = require("./src/reports/verifyReport");

// Users
const {registerUser} = require("./src/users/registerUser");
const {checkSubscription} = require("./src/users/checkSubscription");
const {redeemPromoCode} = require("./src/users/redeemPromoCode");

// Payments
const {requestPayment} = require("./src/payments/requestPayment");
const {confirmPayment} = require("./src/payments/confirmPayment");
const {rejectPayment} = require("./src/payments/rejectPayment");

// Sessions
const {createScanSession} = require("./src/sessions/createScanSession");
const {joinScanSession} = require("./src/sessions/joinScanSession");
const {cancelScanSession} = require("./src/sessions/cancelScanSession");
const {setSessionPurpose} = require("./src/sessions/setSessionPurpose");
const {recordScanConsent} = require("./src/sessions/recordScanConsent");
const {startRepeatScan, getRepeatScanOffer} = require("./src/sessions/repeatScanCalls");
const {listOpenMaintenanceBefores, confirmMaintenanceAfterLink} = require("./src/sessions/maintenancePairCalls");

// Evaluations (technician accuracy labelling — training-data asset)
const {submitEvaluation} = require("./src/evaluations/submitEvaluation");
const {resolvePendingEvaluation} =
    require("./src/evaluations/resolvePendingEvaluation");
const {submitTechnicianForm, getTechnicianFormConfig, recordReportFirstOpened} =
    require("./src/evaluations/technicianForm");

// Notifications
const {sendNotificationEmail} = require("./src/notifications/sendNotificationEmail");
const {checkExpiringSubscriptions} = require("./src/notifications/checkExpiringSubscriptions");

// Admin
const {runConsistencyTest} = require("./src/admin/runConsistencyTest");
const {getAiConfig, setAiModel} = require("./src/admin/aiModelConfig");
const {setProtocolSettings, getProtocolSettings} = require("./src/admin/protocolSettingsAdmin");
const {setShopProtocolParts, manageTechnician, getShopProtocolConfig} = require("./src/admin/shopProtocolAdmin");
const {correctProtocolRecord} = require("./src/admin/protocolCorrectionAdmin");
const {setMarketingNames, getMarketingNames} = require("./src/admin/marketingNamesAdmin");

exports.analyzeDevice = analyzeDevice;
exports.generateReportPdf = generateReportPdf;
exports.verifyReport = verifyReport;
exports.registerUser = registerUser;
exports.checkSubscription = checkSubscription;
exports.redeemPromoCode = redeemPromoCode;
exports.requestPayment = requestPayment;
exports.confirmPayment = confirmPayment;
exports.rejectPayment = rejectPayment;
exports.createScanSession = createScanSession;
exports.joinScanSession = joinScanSession;
exports.cancelScanSession = cancelScanSession;
exports.setSessionPurpose = setSessionPurpose;
exports.recordScanConsent = recordScanConsent;
exports.startRepeatScan = startRepeatScan;
exports.getRepeatScanOffer = getRepeatScanOffer;
exports.listOpenMaintenanceBefores = listOpenMaintenanceBefores;
exports.confirmMaintenanceAfterLink = confirmMaintenanceAfterLink;
exports.submitEvaluation = submitEvaluation;
exports.resolvePendingEvaluation = resolvePendingEvaluation;
exports.submitTechnicianForm = submitTechnicianForm;
exports.getTechnicianFormConfig = getTechnicianFormConfig;
exports.recordReportFirstOpened = recordReportFirstOpened;
exports.sendNotificationEmail = sendNotificationEmail;
exports.checkExpiringSubscriptions = checkExpiringSubscriptions;
exports.runConsistencyTest = runConsistencyTest;
exports.getAiConfig = getAiConfig;
exports.setAiModel = setAiModel;
exports.setProtocolSettings = setProtocolSettings;
exports.getProtocolSettings = getProtocolSettings;
exports.setShopProtocolParts = setShopProtocolParts;
exports.manageTechnician = manageTechnician;
exports.getShopProtocolConfig = getShopProtocolConfig;
exports.correctProtocolRecord = correctProtocolRecord;
exports.setMarketingNames = setMarketingNames;
exports.getMarketingNames = getMarketingNames;

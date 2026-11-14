// Firebase Secret Manager bindings. Used by Cloud Functions that need keys.
//
// DEPLOYMENT NOTE (V4 hardening):
//   DEEPSEEK_API_KEY is now read via defineSecret() from Firebase
//   Secret Manager. Before deploying:
//     firebase functions:secrets:set DEEPSEEK_API_KEY
//   (paste the key when prompted)
//   functions/.env retains the same key for the local emulator only.

const {defineSecret} = require("firebase-functions/params");

const geminiKey = defineSecret("GEMINI_API_KEY");
const smtpUser = defineSecret("SMTP_USER");
const smtpPass = defineSecret("SMTP_PASS");
const deepseekKey = defineSecret("DEEPSEEK_API_KEY");

module.exports = {geminiKey, smtpUser, smtpPass, deepseekKey};

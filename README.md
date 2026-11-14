# neuralcheck-backend

**English** · [العربية](README.ar.md) · [Türkçe](README.tr.md)

> **Project status: archived.** Development of NeuralCheck was stopped in November 2026 (not enough time, and the planned field data collection turned out to be impractical). The code is released as-is under the [MIT license](LICENSE), without warranty or support. This repository holds **no secrets**: every key, password and admin address was removed or replaced by a placeholder before publication.

Firebase backend (Cloud Functions, Firestore and Storage rules) of **NeuralCheck**, a diagnostics system for used smartphones. The Android app ([neuralcheck-mobile](https://github.com/hasan-oso/neuralcheck-mobile)) runs hardware tests and uploads a raw fingerprint; this backend analyses it, grades the phone and produces a verifiable report that the website ([neuralcheck-website](https://github.com/hasan-oso/neuralcheck-website)) displays.

## What it does

- **Analysis pipeline** (`functions/src/analysis`, `lab`, `prompts`): turns the raw device fingerprint into computed features and a clinical summary, calls an LLM (DeepSeek, Gemini) for the narrative, and stores a graded report (A–D).
- **Scan sessions** (`functions/src/sessions`): a shop creates a short code (`NC-XXXXXX`), the customer's phone joins it and is scanned; credit reservation and subscription checks happen here.
- **Reports** (`functions/src/reports`): public verification by short code (`verifyReport`), PDF export (`generateReportPdf`, Puppeteer + headless Chromium).
- **Protocol** (`functions/src/protocol`, `evaluations`): "before/after maintenance" pairs, cold repeat scans, consent records, technician blind-evaluation forms. Server-side only, never shown to the scanned phone.
- **Accounts and money** (`users`, `payments`, `notifications`): plans, promo codes, manual payment confirmation, subscription expiry e-mails.
- **Admin callables** (`functions/src/admin`): AI model switch, protocol settings, shop parts, technician management, corrections.

All 36 exported functions are listed in `functions/index.js`. Contracts between the three repositories are in `docs/` (`PROTOCOL_CONTRACT.md`, `V7_DISPLAY_SHAPE_CONTRACT.md`, `FV68_CONTRACT.md`, `FV71_CONTRACT_SECTION.md`).

## Requirements

Node.js **22**, the Firebase CLI, and your own Firebase project (Blaze plan for Functions, Firestore, Storage).

## Setup

```bash
cd functions && npm ci
firebase use <your-project-id>          # .firebaserc still names the original project
```

Secrets are **never** stored in the repository. Set them in Secret Manager (the names are defined in `functions/src/utils/secrets.js`):

```bash
firebase functions:secrets:set DEEPSEEK_API_KEY
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
```

The device-identity HMAC key is read from the environment variable `DEVICE_ID_HMAC_KEY` (`functions/src/profiles/deviceIdentityHmac.js`). For the local emulator copy `functions/.env.example` to `functions/.env` (git-ignored).

**Admin allowlist.** Admin accounts are matched by e-mail. Replace the placeholders `admin1@example.com`, `admin2@example.com`, `admin3@example.com` with your own addresses in **all three** places: `firestore.rules` (lines 16-18), `functions/src/utils/admin.js` (lines 18-20) and the website's `lib/admin.js`.

## Tests

There is no test runner script; every test is a plain Node script:

```bash
# all tests that need no emulator
for f in functions/test/*.test.js; do case "$f" in *e2e*) continue;; esac; node "$f" || echo "FAILED: $f"; done
```

Files named `*.e2e.test.js` write to Firestore and must run against the emulator (`firebase emulators:exec --only firestore ...`). Rules tests are in `rules-test/`.

## Deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```

Read `docs/DEPLOY_CHECKLIST.md` first (it explains why you should deploy only the functions that changed).

## License

[MIT](LICENSE). The test fixtures under `functions/test/fixtures/golden/` are derived from real device scans of the authors' own test phones.

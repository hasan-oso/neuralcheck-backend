"use strict";

// emulatorOnlyGuard — يُستورَد أوّلاً في كل ملفّ اختبار يكتب في Firestore (V8 قبل النشر، 2026-10-09 +03). الفحص يجري عند الاستيراد نفسه،
// فإن لم يكن FIRESTORE_EMULATOR_HOST مضبوطاً على مضيف محلّي، أو كان المشروع غائباً أو neuralchek-9b6d7، طُبعت المشاكل وخرجت العملية برمز 2
// قبل أن يُحمَّل أيّ شيء بعده (لا firebase-admin ولا وحدة من src). التفاصيل والمصادر: emulatorGuardCore.js.
//
//     require("./lib/emulatorOnlyGuard");                  // functions/test/*.js
//     require("../functions/test/lib/emulatorOnlyGuard");  // rules-test/*.js
//
// ملفّات الاختبار التي يجب أن تستورده تُشتقّ بالأداة (emulatorGuardInventory.js)، ويُفشل emulatorGuardCoverage.test.js أيّ ملفّ منها لا يستورده أوّلاً.

module.exports = require("./emulatorGuardCore").assertEmulatorOnly();

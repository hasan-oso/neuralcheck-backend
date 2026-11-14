# neuralcheck-backend

[English](README.md) · **العربية** · [Türkçe](README.tr.md)

> **حالة المشروع: مؤرشف.** أُوقف تطوير NeuralCheck في نوفمبر 2026 (ضيق الوقت، وتبيّن أنّ جمع البيانات الميدانية المخطَّط له شبه مستحيل). الكود منشور كما هو بترخيص [MIT](LICENSE) بلا ضمان ولا دعم. هذا المستودع **لا يحتوي أسراراً**: أُزيلت كل المفاتيح وكلمات المرور وعناوين المشرفين أو استُبدلت بقيم وهمية قبل النشر.

الواجهة الخلفية على Firebase (دوالّ Cloud Functions وقواعد Firestore وStorage) لمشروع **NeuralCheck**، نظام فحص الهواتف المستعملة. يجري تطبيق أندرويد ([neuralcheck-mobile](https://github.com/hasan-oso/neuralcheck-mobile)) اختبارات العتاد ويرفع «بصمة خام»، فتحلّلها هذه الواجهة وتقيّم الهاتف وتنتج تقريراً قابلاً للتحقّق يعرضه الموقع ([neuralcheck-website](https://github.com/hasan-oso/neuralcheck-website)).

## ما تفعله

- **خطّ التحليل** (`functions/src/analysis` و`lab` و`prompts`): يحوّل البصمة الخام إلى سمات محسوبة وملخّص سريري، ويستدعي نموذجاً لغوياً (DeepSeek وGemini) للسرد، ويخزّن تقريراً مقيَّماً (A–D).
- **جلسات الفحص** (`functions/src/sessions`): ينشئ المحلّ رمزاً قصيراً (`NC-XXXXXX`) ينضمّ إليه هاتف الزبون فيُفحص؛ وهنا يُحجز الرصيد ويُفحص الاشتراك.
- **التقارير** (`functions/src/reports`): تحقّق عام برمز قصير (`verifyReport`) وتصدير PDF (`generateReportPdf` بـPuppeteer وChromium بلا واجهة).
- **البروتوكول** (`functions/src/protocol` و`evaluations`): أزواج «قبل/بعد الصيانة» والتكرار البارد وسجلّات الموافقة واستمارات التقييم الأعمى للفنّي. على الخادم فقط ولا يراها الهاتف المفحوص.
- **الحسابات والمال** (`users` و`payments` و`notifications`): الباقات ورموز الخصم وتأكيد الدفع اليدوي ورسائل انتهاء الاشتراك.
- **دوالّ المشرف** (`functions/src/admin`): تبديل نموذج الذكاء الاصطناعي وإعدادات البروتوكول وأجزاء المحلّ وإدارة الفنّيين والتصحيحات.

الدوالّ الستّ والثلاثون المصدَّرة مسرودة في `functions/index.js`. وعقود التبادل بين المستودعات الثلاثة في `docs/` (`PROTOCOL_CONTRACT.md` و`V7_DISPLAY_SHAPE_CONTRACT.md` و`FV68_CONTRACT.md` و`FV71_CONTRACT_SECTION.md`).

## المتطلبات

Node.js **22**، وأداة Firebase CLI، ومشروع Firebase خاص بك (خطّة Blaze للدوالّ، مع Firestore وStorage).

## الإعداد

```bash
cd functions && npm ci
firebase use <معرّف-مشروعك>          # ما زال .firebaserc يسمّي المشروع الأصلي
```

الأسرار **لا تُخزَّن** في المستودع أبداً. ضعها في Secret Manager (أسماؤها معرَّفة في `functions/src/utils/secrets.js`):

```bash
firebase functions:secrets:set DEEPSEEK_API_KEY
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
```

ومفتاح HMAC لهوية الجهاز يُقرأ من متغيّر البيئة `DEVICE_ID_HMAC_KEY` (`functions/src/profiles/deviceIdentityHmac.js`). وللمحاكي المحلّي انسخ `functions/.env.example` إلى `functions/.env` (مُتجاهَل في git).

**قائمة المشرفين.** يُعرَف المشرف بالبريد الإلكتروني. استبدل القيم الوهمية `admin1@example.com` و`admin2@example.com` و`admin3@example.com` ببريدك في **المواضع الثلاثة كلها**: `firestore.rules` (السطور 16-18) و`functions/src/utils/admin.js` (السطور 18-20) وملفّ `lib/admin.js` في الموقع.

## الاختبارات

لا يوجد سكربت لتشغيل الاختبارات؛ كلّ اختبار ملفّ Node عادي:

```bash
# كل الاختبارات التي لا تحتاج محاكياً
for f in functions/test/*.test.js; do case "$f" in *e2e*) continue;; esac; node "$f" || echo "FAILED: $f"; done
```

الملفّات `*.e2e.test.js` تكتب في Firestore فتُشغَّل على المحاكي وحده (`firebase emulators:exec --only firestore ...`). واختبارات القواعد في `rules-test/`.

## النشر

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```

اقرأ `docs/DEPLOY_CHECKLIST.md` أولاً (يشرح لماذا تنشر الدوالّ التي تغيّرت وحدها).

## الترخيص

[MIT](LICENSE). عيّنات الاختبار تحت `functions/test/fixtures/golden/` مشتقّة من فحوص حقيقية لهواتف الاختبار الخاصة بالمؤلّفين.

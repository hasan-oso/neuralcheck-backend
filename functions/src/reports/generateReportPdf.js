const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db, isVerifiedAdmin} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");

// ===================================================
// generateReportPdf (V2 #51 — Puppeteer + /print page)
// ===================================================
//
// Old approach (pdfmake + manually-laid-out Arabic): retired. The shaping
// was unreliable and the design diverged from the website. We now print
// the live /print/{shortId} page through headless Chrome, which gives us:
//   - perfect Arabic shaping (the browser renders fonts natively)
//   - one design source — the React components from /verify
//   - automatic updates whenever the website is redeployed
//
// puppeteer-core + @sparticuz/chromium keeps the deploy package small
// enough for Cloud Functions (full puppeteer ships ~300MB of Chromium).
const puppeteerCore = require("puppeteer-core");
const sparticuzChromium = require("@sparticuz/chromium");

const PRINT_BASE_URL = "https://neuralcheck.net";
const SUPPORTED_PRINT_LANGS = new Set(["ar", "tr", "en"]);

async function renderReportPdfViaPuppeteer(shortId, lang) {
  // Headless Chrome has no localStorage and reports `en-US` from
  // navigator.language, so the LanguageContext on /print would render in
  // English even for Arabic reports. Passing `?lang=` lets the client pick
  // up the report's authoring language explicitly.
  const safeLang = SUPPORTED_PRINT_LANGS.has(lang) ? lang : "ar";
  const printUrl =
    `${PRINT_BASE_URL}/print/${encodeURIComponent(shortId)}/` +
    `?lang=${safeLang}`;
  // البند ٤-ج (2026-10-18): shortId في المسار مفتاح وصول علني فلا يُطبع خامّاً؛ الأساس واللغة باقيان في السطر.
  const printUrlForLog = `${PRINT_BASE_URL}/print/${hashIdForLog(shortId)}/?lang=${safeLang}`;
  console.log(`[generateReportPdf] launching headless Chrome for ${printUrlForLog}`);

  const browser = await puppeteerCore.launch({
    args: sparticuzChromium.args,
    defaultViewport: sparticuzChromium.defaultViewport,
    executablePath: await sparticuzChromium.executablePath(),
    headless: sparticuzChromium.headless,
  });

  try {
    const page = await browser.newPage();
    // A4 at 96dpi → 794×1123 CSS pixels.
    await page.setViewport({width: 794, height: 1123, deviceScaleFactor: 2});

    await page.goto(printUrl, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // The page sets [data-print-ready] once the report payload has loaded
    // and rendered. This avoids printing the loading spinner.
    await page.waitForSelector("[data-print-ready=\"true\"]", {
      timeout: 20000,
    });

    // Footer is rendered by Chrome on every page (page numbers, brand line).
    const footerTemplate = `
      <div style="font-size: 9px; width: 100%; padding: 0 15mm; color: #64748B;
                  display: flex; justify-content: space-between; align-items: center;
                  font-family: -apple-system, system-ui, sans-serif;">
        <span>NeuralCheck • neuralcheck.net</span>
        <span>${shortId}</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>
    `;

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: false,
      margin: {
        top: "15mm",
        right: "12mm",
        bottom: "18mm",
        left: "12mm",
      },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate,
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

/**
 * من يحقّ له PDF هذا التقرير: المالك، أو المشرف **مؤكَّد البريد** (قرار المستخدم 2026-10-09 — مصدر الشرط الواحد
 * isVerifiedAdmin في utils/admin.js). دالّة نقيّة قابلة للاختبار بلا Puppeteer ولا Firestore.
 * @param {Object} report بيانات مستند التقرير (userId).
 * @param {{uid: string, token: Object}} auth request.auth.
 * @return {{isOwner: boolean, isAdminUser: boolean}}
 */
function evaluateReportAccess(report, auth) {
  return {
    isOwner: report.userId === auth.uid,
    isAdminUser: isVerifiedAdmin(auth),
  };
}
exports.evaluateReportAccess = evaluateReportAccess;

exports.generateReportPdf = onCall(
    {
      timeoutSeconds: 120,
      memory: "1GiB",
      cpu: 2,
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
      }

      const {scanId} = request.data || {};
      // القاعدة 36: نصّ الخطأ المنقّى يُحسب خارج نداء السجلّ (حارس PII يرفض scanId خامّاً داخله)، والمعرّف معروف فيُخفى حيث ورد.
      const failText = (err) => sanitizeFailureText(err, {knownIds: [scanId]});
      if (!scanId) {
        throw new HttpsError("invalid-argument", "scanId مطلوب");
      }

      // 1. اقرأ التقرير
      const reportDoc = await db.collection("reports").doc(scanId).get();
      if (!reportDoc.exists) {
        throw new HttpsError("not-found", "التقرير غير موجود");
      }
      const report = reportDoc.data();

      // 2. صلاحية: المستخدم صاحب التقرير أو Admin
      const {isOwner, isAdminUser} = evaluateReportAccess(report, request.auth);
      if (!isOwner && !isAdminUser) {
        throw new HttpsError("permission-denied", "ليس لديك صلاحية لهذا التقرير");
      }

      // 3. لا PDF للفحص المجاني (per spec)
      if (report.isFreeTrial && !isAdminUser) {
        throw new HttpsError(
            "permission-denied",
            "PDF غير متاح للفحوصات المجانية — يرجى ترقية الباقة",
        );
      }

      // 4. توليد PDF عبر Puppeteer (يفتح صفحة /print live)
      const shortId = report.shortId || scanId;
      const reportLang = String(report.language || "ar").toLowerCase();
      let pdfBuffer;
      try {
        pdfBuffer = await renderReportPdfViaPuppeteer(shortId, reportLang);
      } catch (e) {
        console.error("PDF generation failed:", failText(e));
        throw new HttpsError(
            "internal",
            "فشل توليد PDF: " + failText(e),
        );
      }

      // 5. رفع إلى Firebase Storage
      const bucket = admin.storage().bucket();
      const filePath = `reports/${scanId}/report.pdf`;
      const file = bucket.file(filePath);
      try {
        await file.save(pdfBuffer, {
          contentType: "application/pdf",
          metadata: {
            cacheControl: "public, max-age=31536000",
            contentDisposition:
              `attachment; filename="NeuralCheck-${shortId}.pdf"`,
          },
        });
      } catch (e) {
        console.error("Storage upload failed:", failText(e));
        throw new HttpsError("internal", "فشل حفظ PDF: " + failText(e));
      }

      // 6. رابط مؤقّت 24 ساعة
      let url;
      try {
        const [signedUrl] = await file.getSignedUrl({
          action: "read",
          expires: Date.now() + 24 * 60 * 60 * 1000,
        });
        url = signedUrl;
      } catch (e) {
        console.error("Failed to sign URL:", failText(e));
        throw new HttpsError(
            "internal",
            "فشل توليد الرابط: " + failText(e) +
            " — تأكّد من تفعيل دور roles/iam.serviceAccountTokenCreator",
        );
      }

      console.log(
          "generateReportPdf — scanId:", hashIdForLog(scanId),
          "shortId:", hashIdForLog(shortId),
          "size:", pdfBuffer.length, "bytes",
      );

      return {
        url: url,
        shortId: shortId,
        sizeBytes: pdfBuffer.length,
      };
    },
);

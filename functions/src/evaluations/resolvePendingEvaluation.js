const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db} = require("../utils/admin");
const {buildReportSnapshot, computeDerived, linkageStatus} =
    require("./evaluationContract");
const {hashIdForLog} = require("../utils/logRedaction");
const {readReportRaw} = require("../analysis/reportRawStore");

// ===================================================
// Firestore trigger: resolvePendingEvaluation
// ===================================================
// يستكمل تقييماً كُتب قبل وجود تقريره.
//
// المشكلة: على مسار الجلسة يُسأل الفنّي أثناء الفحص — أي قبل أن تُحسب
// نتيجتنا. فلحظة الكتابة لا توجد درجة تطبيق تُقارَن بها، فيُخزَّن التقييم
// بـ pending: true ولقطة تقرير فارغة.
//
// لماذا مشغّل لا حساب عند القراءة:
//   لوحة /tech تقرأ evaluations مباشرةً من Firestore عبر web SDK
//   (wepsite/app/tech/page.js:89-90) — لا كود خادمي على مسار القراءة
//   إطلاقاً. فـ"احسب عند أول قراءة" بلا خطّاف يُعلَّق عليه ما لم نضف دالة
//   قابلة للاستدعاء ونغيّر اللوحة المنشورة. المشغّل تلقائي، يعمل مرّة واحدة
//   عند إنشاء التقرير، ولا يمسّ analyzeDevice ولا اللوحة.
//
// لماذا onDocumentCreated لا onDocumentWritten: التقرير يُكتب مرّة واحدة
// بـ set() في analyzeDevice.js:264. التحديثات اللاحقة (price/listingStatus
// من المالك) لا تغيّر الدرجة، فلا داعي لإيقاظ الدالة لها.
exports.resolvePendingEvaluation = onDocumentCreated(
    {
      document: "reports/{scanId}",
      timeoutSeconds: 60,
      memory: "256MiB",
    },
    async (event) => {
      const scanId = event.params.scanId;
      // القاعدة 36: نصّ الخطأ المنقّى يُحسب خارج نداء السجلّ (حارس PII يرفض scanId خامّاً داخله)، والمعرّف معروف فيُخفى حيث ورد.
      const failText = (err) => sanitizeFailureText(err, {knownIds: [scanId]});
      const report = event.data?.data();
      if (!report) return;

      const evalRef = db.collection("evaluations").doc(scanId);

      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(evalRef);
          // لا تقييم لهذا الفحص — الحالة الغالبة، اخرج بصمت.
          if (!snap.exists) return;

          const evaluation = snap.data() || {};
          // مُستكمَل سابقاً — لا تلمسه. يحمي من إعادة تشغيل المشغّل
          // (at-least-once delivery) ومن دوس لقطة أحدث كتبها العميل.
          if (evaluation.pending !== true) return;

          // حارس الملكية: على مسار الجلسة قُبل التقييم قبل وجود التقرير،
          // فلم يكن ممكناً التحقّق من أن scanId يخصّ صاحب الجلسة فعلاً.
          // نتحقّق الآن. عند عدم التطابق نرفع راية ولا نحسب مسافة — الصفّ
          // يبقى للتدقيق بدل أن يُمحى أو يُنسَب خطأً.
          if (report.userId && evaluation.ownerId &&
              report.userId !== evaluation.ownerId) {
            console.warn(`[resolvePendingEvaluation] owner mismatch scanId=${hashIdForLog(scanId)} ` +
                `report.userId=${hashIdForLog(report.userId)} ` +
                `evaluation.ownerId=${hashIdForLog(evaluation.ownerId)}`);
            tx.update(evalRef, {
              pending: false,
              ownerMismatch: true,
              resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return;
          }

          // V8 نقل الخامّ: حمولة الحدث (event.data) هي مستند التقرير المقروء — **بلا الخامّ**. يُقرأ
          // reportRaw/{scanId} هنا داخل المعاملة (بعد تأكّد وجود تقييم معلّق، فلا قراءة إضافية للغالبية
          // الساحقة من التقارير التي لا تقييم لها). الدفعة الذرّية في analyzeDevice (reportRawStore.
          // writeReportAndRaw) تضمن أن الخامّ مودَع قبل أن يُطلَق هذا المشغّل. الحالة صريحة (القاعدة 22).
          const rawRead = await readReportRaw({db, tx, scanId, reportData: report});
          const snapshot = buildReportSnapshot(report, rawRead);
          const {gradeDistance, consistencyFlag} = computeDerived(
              snapshot.appGrade,
              evaluation.technicianGrade,
              evaluation.agreement,
          );

          // الحسم الحقيقي لاكتمال الربط يقع هنا: التقرير وصل أخيراً، فإن
          // نقصته حقول الربط فالسبب نسخة analyzeDevice لا التوقيت.
          const {linkageIncomplete, missingLinkageFields, linkageRawState} =
              linkageStatus(snapshot, false, rawRead);
          if (linkageIncomplete) {
            console.error(`[resolvePendingEvaluation] LINKAGE INCOMPLETE ` +
                `scanId=${hashIdForLog(scanId)} missing=[${missingLinkageFields.join(",")}] rawState=${linkageRawState} — ` +
                `التسمية غير قابلة للربط بالقراءات الخام (ABSENT: لا reportRaw ولا حقول مضمَّنة؛ ` +
                `وغير ذلك: التقرير كُتب بنسخة analyzeDevice أقدم من e45237e أو بترويسة بلا بصمة)`);
          }

          tx.update(evalRef, {
            ...snapshot,
            gradeDistance: gradeDistance,
            consistencyFlag: consistencyFlag,
            linkageIncomplete: linkageIncomplete,
            missingLinkageFields: missingLinkageFields,
            linkageRawState: linkageRawState,
            pending: false,
            resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          console.log(`[resolvePendingEvaluation] resolved scanId=${hashIdForLog(scanId)} ` +
              `appGrade=${snapshot.appGrade} techGrade=${evaluation.technicianGrade} ` +
              `distance=${gradeDistance} linkageIncomplete=${linkageIncomplete}`);
        });
      } catch (e) {
        // غير قاتل: التقرير محفوظ والفحص نجح. فشل الاستكمال يترك التقييم
        // pending — قابلاً للاستكمال يدوياً — ولا يُفشل شيئاً للمستخدم.
        console.error(`[resolvePendingEvaluation] failed for ${hashIdForLog(scanId)}: ` +
            `${failText(e)}`);
      }
    },
);

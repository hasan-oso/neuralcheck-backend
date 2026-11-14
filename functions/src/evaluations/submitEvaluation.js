const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {
  VALID_TECHNICIAN_GRADES,
  VALID_GRADES_RAW,
  RAW_TO_GRADE,
  VALID_AGREEMENTS,
  VALID_ERROR_MAGNITUDES,
  DEPTH_CATEGORIES,
  RATING_CATEGORIES,
  VALID_RATINGS,
  VALID_VISIBLE_DEFECTS,
  MAX_TECHNICIAN_NAME_LEN,
  buildReportSnapshot,
  computeDerived,
  linkageStatus,
} = require("./evaluationContract");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("../sessions/sessionTimeout");
const {SESSION_STATUS} = require("../sessions/sessionNames");
const {recordSessionExpiredIfDueSafely} = require("../sessions/sessionLifecycle");
const {hashIdForLog} = require("../utils/logRedaction");
const {readReportRaw} = require("../analysis/reportRawStore");
const {SUBMIT_EVALUATION_REFUSAL: R, REFUSAL_REASONS, sanitizeFailureText} = require("./submitEvaluationRefusal");

// ─── سطر سجلّ قبل كل رفض (V8 قبل أوّل نشر، البند ٦، 2026-10-09) ───────────────────────────────────────────
// قرار المستخدم (بنصّه): «سطر سجلّ قبل كل رفض في submitEvaluation: معتمد... سبب مسمّى من مصدر واحد، بلا معرّف مستخدم ولا scanId
// خامّ (المُهشِّر المشترك من الدفعة ١). واختبار يثبت أن كل مسار رفض يكتب سطره.»
// الأسباب: submitEvaluationRefusal.js (قيم مجمَّدة، مصدر واحد). **هذه الدالّة الموضع الوحيد لـ`throw new HttpsError` في هذا الملفّ**
// (يحرسه submitEvaluationRefusalGuard.test.js)؛ فرمي جديد بلا سبب يُفشل الاختبار. رمز الخطأ ونصّه يمرّان كما هما — لا تغيير يراه المستخدم.
// السطر: السبب فقط، ومعه scanId مُهشَّراً (hashIdForLog) حين يكون معروفاً — لا scanId خامّ ولا معرّف مستخدم ولا sessionId ولا نصّ
// الرسالة (قد تقتبس مُدخل العميل).
/**
 * @param {string} reason سبب من SUBMIT_EVALUATION_REFUSAL
 * @param {?string} scanId معرّف الفحص إن كان معروفاً وقت الرفض (يُهشَّر في السطر) وإلا null
 * @param {string} code رمز HttpsError
 * @param {string} message نصّ HttpsError (يراه المستخدم)
 */
function refuse(reason, scanId, code, message) {
  if (!REFUSAL_REASONS.has(reason)) {
    throw new Error(`submitEvaluation: سبب رفض غير مُدرَج في submitEvaluationRefusal.js: ${String(reason)}`);
  }
  console.warn(`[submitEvaluation] refused reason=${reason}` + (scanId ? ` scanId=${hashIdForLog(scanId)}` : ""));
  throw new HttpsError(code, message);
}


// ===================================================
// Cloud Function: submitEvaluation (callable)
// ===================================================
// تقييم الفنّي لدقّة تقريرنا. مساران يعملان معاً:
//
//   (أ) المسار المصادَق — لوحة /tech المنشورة على الموقع. الفنّي مسجّل دخوله
//       بحساب المتجر، يفتح فحصاً قديماً ويقيّمه. التقرير موجود دائماً.
//
//   (ب) مسار الجلسة — التطبيق على الجهاز المفحوص أثناء جلسة QR. يُسأل الفنّي
//       أثناء الفحص، أي قبل أن تُحسب نتيجتنا: لا تقرير بعد، والمستدعي مجهول
//       الهوية (anonymous). هذا الترتيب مقصود — سؤال الفنّي قبل رؤية حكمنا
//       يمنع انحياز الإرساء (anchoring) الذي يُفسد التسمية كأصل تدريبي.
//
// التصميم محكوم بأن التسمية بيانات تدريب: مجموعة منفصلة عن reports، لقطات لا
// مراجع، مفردات مغلقة، والمشتقّات تُحسب خادمياً ولا تُقبل من العميل أبداً.

/**
 * يتحقّق من قيمة اختيارية مُصنَّفة (تنتمي لقائمة مغلقة).
 * الغياب (undefined/null/"") مقبول ويُعيد null؛ وأي قيمة خارج القائمة تُرفض.
 * @param {*} value القيمة الواردة
 * @param {string[]} allowed القيم المقبولة
 * @param {string} fieldName اسم الحقل للرسالة
 * @param {string} reason سبب الرفض المسمّى (SUBMIT_EVALUATION_REFUSAL) — حقل واحد لكل سبب
 * @param {?string} scanId معرّف الفحص (يُهشَّر في سطر الرفض)
 * @return {string|null}
 */
function optionalEnum(value, allowed, fieldName, reason, scanId) {
  if (value === undefined || value === null || value === "") return null;
  const v = typeof value === "string" ? value.trim() : "";
  if (!allowed.includes(v)) {
    refuse(reason, scanId, 
        "invalid-argument",
        `${fieldName} يجب أن يكون أحد: ${allowed.join("/")}`,
    );
  }
  return v;
}

const submitEvaluationHandler = async (request) => {
      const d = request.data || {};

      // ─── 1. المصادقة — الجلسة أولاً ثم auth ─────────────────────────
      // نفس ترتيب analyzeDevice.js:43-61 وللسبب نفسه: جهاز الزبون يسجّل
      // دخولاً مجهولاً قبل الاستدعاء (الـ callable SDK يرفض بلا مستخدم
      // مصادَق)، فلو فُحص request.auth أولاً لفاز الـ uid المجهول وأُهمل
      // sessionId، فنُسب التقييم لحساب مجهول لا وجود له.
      //
      // ownerId يُشتقّ من الخادم في الحالتين ولا يُقبل من العميل إطلاقاً.
      let ownerId;
      let isSessionScan = false;
      const sessionId = typeof d.sessionId === "string" ? d.sessionId.trim() : "";

      if (sessionId) {
        const sessionDoc = await db.collection("scanSessions").doc(sessionId).get();
        if (!sessionDoc.exists) {
          refuse(R.SESSION_NOT_FOUND, null, "permission-denied", "جلسة الفحص غير صالحة");
        }
        if (sessionDoc.data().status !== SESSION_STATUS.SCANNING) {
          refuse(R.SESSION_NOT_SCANNING, null, "permission-denied", "جلسة الفحص غير صالحة");
        }
        // الجلسة صالحة ساعة واحدة من إنشائها — نفس فحص analyzeDevice.js
        // حرفياً، مصدر واحد (sessionTimeout.js — القاعدة 24). قرار مستخدم
        // 2026-09-30 +03 «قرار — مهلة الجلسة ساعة» يُبطل نافذة "60 من
        // الانضمام" في fbcc74c.
        //
        // الدفعة ٩ (2026-10-10 +03، قرار المستخدم بنصّه): «الانتهاء: بلا منظّف مجدوَل. تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها.»
        // فالرفض بسبب انقضاء الوقت يُسجَّل معه «منتهية» (معاملة تعيد فحص الحالة والوقت ولا تكتب إلا لجلسة جارية منقضية)، ثم يُرفض النداء
        // بالسبب والرمز والنصّ نفسها كما كانت. غياب/تلف expiresAt رفض بلا كتابة (القاعدة 22). فشل التسجيل لا يغيّر الرفض (لا ترمي).
        const expiry = sessionExpiryRefusal(sessionDoc.data());
        if (expiry) {
          if (expiry.reason === SESSION_EXPIRY_REASON.EXPIRED) {
            await recordSessionExpiredIfDueSafely({db, FieldValue: admin.firestore.FieldValue, sessionRef: sessionDoc.ref, source: "submitEvaluation"});
          }
          refuse(expiry.reason, null, expiry.code, expiry.message);
        }
        ownerId = sessionDoc.data().ownerId;
        isSessionScan = true;
      } else if (request.auth) {
        ownerId = request.auth.uid;
      } else {
        refuse(R.NOT_AUTHENTICATED_NO_SESSION, null, "unauthenticated", "يجب تسجيل الدخول أو إدخال كود فحص");
      }

      // ─── 2. تحقّق صارم من المدخلات ──────────────────────────────────
      const scanId = typeof d.scanId === "string" ? d.scanId.trim() : "";
      if (!scanId) {
        refuse(R.SCAN_ID_REQUIRED, null, "invalid-argument", "scanId مطلوب");
      }

      // الدرجة: المقياس اللفظي (التطبيق) أو الحرف (اللوحة). كلاهما اختياري
      // الآن — إرسال الفئات وحدها أو العيوب وحدها إرسال صالح.
      const technicianGradeRaw = optionalEnum(
          d.technicianGradeRaw, VALID_GRADES_RAW, "technicianGradeRaw", R.INVALID_TECHNICIAN_GRADE_RAW, scanId);

      let technicianGrade = null;
      if (technicianGradeRaw) {
        // الاشتقاق خادمي: excellent→A, good→B, fair→C, weak→D. لو أرسل
        // العميل الحرف أيضاً يفوز المشتقّ — مصدر حقيقة واحد.
        technicianGrade = RAW_TO_GRADE[technicianGradeRaw];
      } else if (d.technicianGrade !== undefined && d.technicianGrade !== null &&
                 d.technicianGrade !== "") {
        const tg = typeof d.technicianGrade === "string" ?
            d.technicianGrade.trim().toUpperCase() : "";
        if (!VALID_TECHNICIAN_GRADES.includes(tg)) {
          refuse(R.INVALID_TECHNICIAN_GRADE, scanId, 
              "invalid-argument",
              `technicianGrade يجب أن يكون أحد: ${VALID_TECHNICIAN_GRADES.join("/")}`,
          );
        }
        technicianGrade = tg;
      }

      // agreement و errorMagnitude: المسار القديم فقط. التطبيق لا يرسلهما.
      const agreement = optionalEnum(d.agreement, VALID_AGREEMENTS, "agreement", R.INVALID_AGREEMENT, scanId);
      const errorMagnitude = optionalEnum(
          d.errorMagnitude, VALID_ERROR_MAGNITUDES, "errorMagnitude", R.INVALID_ERROR_MAGNITUDE, scanId);

      // categoryRatings: خريطة جزئية. تُبنى من المفاتيح الحاضرة فقط —
      // المفتاح الغائب يبقى غائباً في Firestore (لم يُجب)، وهو ما يميّزه عن
      // القيمة الصريحة not_tested (أجاب: لم أفحصها).
      const categoryRatings = {};
      if (d.categoryRatings !== undefined && d.categoryRatings !== null) {
        if (typeof d.categoryRatings !== "object" || Array.isArray(d.categoryRatings)) {
          refuse(R.CATEGORY_RATINGS_NOT_MAP, scanId, "invalid-argument", "categoryRatings يجب أن تكون خريطة");
        }
        for (const key of Object.keys(d.categoryRatings)) {
          if (!RATING_CATEGORIES.includes(key)) {
            refuse(R.CATEGORY_RATINGS_UNKNOWN_CATEGORY, scanId, 
                "invalid-argument",
                `فئة غير مقبولة في categoryRatings: "${key}". ` +
                `المقبول حصراً: ${RATING_CATEGORIES.join(", ")}`,
            );
          }
          const raw = d.categoryRatings[key];
          // القيمة null/"" تعني "لا إجابة" → نُسقِط المفتاح بدل تخزين فراغ.
          if (raw === undefined || raw === null || raw === "") continue;
          const val = typeof raw === "string" ? raw.trim() : "";
          if (!VALID_RATINGS.includes(val)) {
            refuse(R.CATEGORY_RATINGS_INVALID_RATING, scanId, 
                "invalid-argument",
                `تقييم غير مقبول للفئة "${key}": "${raw}". ` +
                `المقبول حصراً: ${VALID_RATINGS.join("/")}`,
            );
          }
          categoryRatings[key] = val;
        }
      }

      // visibleDefects: مفردات مغلقة، بلا تكرار.
      let visibleDefects = [];
      if (d.visibleDefects !== undefined && d.visibleDefects !== null) {
        if (!Array.isArray(d.visibleDefects)) {
          refuse(R.VISIBLE_DEFECTS_NOT_ARRAY, scanId, "invalid-argument", "visibleDefects يجب أن تكون مصفوفة");
        }
        if (d.visibleDefects.length > VALID_VISIBLE_DEFECTS.length) {
          refuse(R.VISIBLE_DEFECTS_TOO_MANY, scanId, 
              "invalid-argument",
              `visibleDefects تتجاوز الحد (${VALID_VISIBLE_DEFECTS.length})`,
          );
        }
        const seen = new Set();
        for (const raw of d.visibleDefects) {
          const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
          if (!VALID_VISIBLE_DEFECTS.includes(v)) {
            refuse(R.VISIBLE_DEFECTS_INVALID_VALUE, scanId, 
                "invalid-argument",
                `عيب غير مقبول في visibleDefects: "${raw}". ` +
                `المقبول حصراً: ${VALID_VISIBLE_DEFECTS.join(", ")}`,
            );
          }
          seen.add(v);
        }
        visibleDefects = [...seen];
      }

      // disputedCategories: المسار القديم.
      let disputedCategories = [];
      if (d.disputedCategories !== undefined && d.disputedCategories !== null) {
        if (!Array.isArray(d.disputedCategories)) {
          refuse(R.DISPUTED_CATEGORIES_NOT_ARRAY, scanId, "invalid-argument", "disputedCategories يجب أن تكون مصفوفة");
        }
        if (d.disputedCategories.length > DEPTH_CATEGORIES.length) {
          refuse(R.DISPUTED_CATEGORIES_TOO_MANY, scanId, 
              "invalid-argument",
              `disputedCategories تتجاوز الحد (${DEPTH_CATEGORIES.length})`,
          );
        }
        const seen = new Set();
        for (const raw of d.disputedCategories) {
          const cat = typeof raw === "string" ? raw.trim().toLowerCase() : "";
          if (!DEPTH_CATEGORIES.includes(cat)) {
            refuse(R.DISPUTED_CATEGORIES_INVALID_VALUE, scanId, 
                "invalid-argument",
                `فئة غير مقبولة في disputedCategories: "${raw}". ` +
                `المقبول حصراً: ${DEPTH_CATEGORIES.join(", ")}`,
            );
          }
          seen.add(cat);
        }
        disputedCategories = [...seen];
      }

      let technicianName = null;
      if (d.technicianName !== undefined && d.technicianName !== null &&
          d.technicianName !== "") {
        if (typeof d.technicianName !== "string") {
          refuse(R.TECHNICIAN_NAME_NOT_STRING, scanId, "invalid-argument", "technicianName يجب أن يكون نصاً");
        }
        const tn = d.technicianName.trim();
        if (tn.length > MAX_TECHNICIAN_NAME_LEN) {
          refuse(R.TECHNICIAN_NAME_TOO_LONG, scanId, 
              "invalid-argument",
              `technicianName يتجاوز ${MAX_TECHNICIAN_NAME_LEN} محرفاً`,
          );
        }
        technicianName = tn || null;
      }

      let durationMs = null;
      if (d.durationMs !== undefined && d.durationMs !== null) {
        if (typeof d.durationMs !== "number" || !isFinite(d.durationMs) ||
            d.durationMs < 0) {
          refuse(R.DURATION_MS_INVALID, scanId, "invalid-argument", "durationMs يجب أن يكون عدداً موجباً");
        }
        durationMs = d.durationMs;
      }

      // الإرسال الجزئي مقبول بكل صوره (درجة فقط / فئات فقط / عيوب فقط)، لكن
      // إرسالاً خالياً من أي حكم ليس "ناقصاً" بل فارغاً — لا يحمل تسمية.
      const hasVerdict = !!technicianGrade ||
          Object.keys(categoryRatings).length > 0 ||
          visibleDefects.length > 0 ||
          disputedCategories.length > 0;
      if (!hasVerdict) {
        refuse(R.EVALUATION_EMPTY, scanId, 
            "invalid-argument",
            "التقييم فارغ: أرسل درجة أو تقييم فئات أو عيوباً ظاهرة على الأقل",
        );
      }

      // ─── 3. التقرير: قد لا يوجد بعد على مسار الجلسة ─────────────────
      // المسار المصادَق: التقرير هو بوابة الملكية الوحيدة — بدونه لا نستطيع
      // إثبات أن المستدعي يملك هذا scanId، فيبقى مطلوباً (سلوك قائم محفوظ).
      //
      // مسار الجلسة: الملكية مُثبَتة من الجلسة نفسها (ownerId موقَّع خادمياً)
      // بمعزل عن التقرير، فيُقبل غيابه ويُخزَّن التقييم معلّقاً (pending)
      // ويُستكمل تلقائياً حين يُكتب التقرير — انظر resolvePendingEvaluation.
      const reportSnap = await db.collection("reports").doc(scanId).get();
      const report = reportSnap.exists ? (reportSnap.data() || {}) : null;

      if (!report && !isSessionScan) {
        refuse(R.REPORT_NOT_FOUND, scanId, "not-found", "التقرير غير موجود");
      }
      if (report && report.userId !== ownerId) {
        refuse(R.REPORT_NOT_OWNED, scanId, "permission-denied", "هذا التقرير ليس ضمن حسابك");
      }

      // V8 نقل الخامّ: الخامّ في reportRaw/{scanId} (أو مضمَّناً في تقرير ما قبل الترحيل) — يُقرأ هنا
      // لحساب لقطة الجهاز واكتمال الربط. **لا يُنسخ منه معرّف إلى evaluations** (القرار ٦).
      const rawRead = report ?
          await readReportRaw({db, scanId, reportData: report}) :
          null;
      const snapshot = buildReportSnapshot(report, rawRead);
      const {gradeDistance, consistencyFlag} =
          computeDerived(snapshot.appGrade, technicianGrade, agreement);
      const pending = !report;

      // حارس الربط: تقرير موجود لكنه بلا حقول ربط يعني نسخة analyzeDevice
      // أقدم من e45237e. التسمية ستُحفظ سليمة لكنها غير قابلة للوصل
      // بالقراءات الخام — نرفع الراية ونصرخ في السجل بدل أن تمرّ صامتة.
      const {linkageIncomplete, missingLinkageFields, linkageRawState} =
          linkageStatus(snapshot, pending, rawRead);
      if (linkageIncomplete) {
        console.error(`[submitEvaluation] LINKAGE INCOMPLETE scanId=${hashIdForLog(scanId)} ` +
            `missing=[${missingLinkageFields.join(",")}] rawState=${linkageRawState} — ` +
            `التسمية غير قابلة للربط بالقراءات الخام (ABSENT: لا reportRaw ولا حقول مضمَّنة؛ ` +
            `وغير ذلك: التقرير كُتب بنسخة analyzeDevice أقدم من e45237e أو بترويسة بلا بصمة)`);
      }

      // ─── 4. الكتابة — upsert ذرّي يحفظ createdAt ويعدّ المراجعات ────
      const evalRef = db.collection("evaluations").doc(scanId);
      const written = await db.runTransaction(async (tx) => {
        const prev = await tx.get(evalRef);
        const isRevision = prev.exists;
        const prevData = isRevision ? (prev.data() || {}) : {};

        const doc = {
          // الربط
          scanId: scanId,
          ownerId: ownerId,
          technicianName: technicianName,
          source: isSessionScan ? "session" : "authenticated",
          // V8 نقل الخامّ (القرار ٦): لا sessionId هنا ولا في اللقطة — الربط بالجلسة والخامّ في جانب
          // الخادم بمعرّف الفحص نفسه (scanSessions.scanId ↔ reportRaw/{scanId}.sessionId).

          // لقطة التقرير (كلها null ما دام التقييم معلّقاً)
          ...snapshot,

          // ما قاله الفنّي
          technicianGradeRaw: technicianGradeRaw,
          technicianGrade: technicianGrade,
          agreement: agreement,
          errorMagnitude: errorMagnitude,
          categoryRatings: categoryRatings,
          visibleDefects: visibleDefects,
          disputedCategories: disputedCategories,

          // مشتقّات خادمية
          gradeDistance: gradeDistance,
          consistencyFlag: consistencyFlag,

          // اكتمال الربط بالقراءات الخام (null ما دام معلّقاً)
          linkageIncomplete: linkageIncomplete,
          missingLinkageFields: missingLinkageFields,
          // حالة الخامّ وقت التقييم: PRIVATE | EMBEDDED_LEGACY | ABSENT (null ما دام معلّقاً) — القاعدة 22.
          linkageRawState: linkageRawState,

          // حالة الاستكمال المتأخّر
          pending: pending,
          resolvedAt: pending ? null : admin.firestore.FieldValue.serverTimestamp(),
          ownerMismatch: false,

          // القياس
          durationMs: durationMs,
          revisionCount: isRevision ?
              ((typeof prevData.revisionCount === "number" ?
                  prevData.revisionCount : 0) + 1) :
              0,
        };

        if (isRevision) {
          // createdAt الأصلي يبقى — عمر التسمية لا يُعاد ضبطه.
          doc.createdAt = prevData.createdAt ??
              admin.firestore.FieldValue.serverTimestamp();
          doc.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        } else {
          doc.createdAt = admin.firestore.FieldValue.serverTimestamp();
          doc.updatedAt = null;
        }

        tx.set(evalRef, doc);
        return {isRevision, revisionCount: doc.revisionCount};
      });

      console.log(`[submitEvaluation] scanId=${hashIdForLog(scanId)} owner=${hashIdForLog(ownerId)} ` +
          `source=${isSessionScan ? "session" : "auth"} pending=${pending} ` +
          `gradeRaw=${technicianGradeRaw} grade=${technicianGrade} ` +
          `appGrade=${snapshot.appGrade} distance=${gradeDistance} ` +
          `ratings=${Object.keys(categoryRatings).length} ` +
          `defects=${visibleDefects.length} revision=${written.revisionCount}`);

      return {
        success: true,
        scanId: scanId,
        pending: pending,
        linkageIncomplete: linkageIncomplete,
        technicianGrade: technicianGrade,
        gradeDistance: gradeDistance,
        consistencyFlag: consistencyFlag,
        isRevision: written.isRevision,
        revisionCount: written.revisionCount,
      };
};

// الفشل غير المتوقَّع (ما ليس HttpsError: خطأ معاملة Firestore، أو buildReportSnapshot يرمي...): سطر واحد بسبب مسمّى ونصّ خطأ منقّى
// (القاعدة 36)، ثم يُرمى كما كان. الرفض المسمّى (HttpsError) كُتب سطره في refuse أعلاه ويمرّ هنا بلا سطر ثانٍ.
exports.submitEvaluation = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      try {
        return await submitEvaluationHandler(request);
      } catch (e) {
        if (!(e instanceof HttpsError)) {
          console.error(`[submitEvaluation] failed reason=${R.UNEXPECTED_FAILURE} ${sanitizeFailureText(e)}`);
        }
        throw e;
      }
    },
);

// مُصدَّرة للاختبار المباشر (submitEvaluationRefusalGuard.test.js): سبب غير مُدرَج يُرمى كخطأ برمجي لا يُكتب بصمت.
exports.refuse = refuse;

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db} = require("../utils/admin");
const {smtpUser, smtpPass} = require("../utils/secrets");
const {getMailTransporter, EMAIL_TEMPLATES} = require("../utils/emails");
const {normalizePlan} = require("../utils/plans");
const {hashIdForLog} = require("../utils/logRedaction");
const {signInProviderStatus} = require("../utils/signInProvider");

// ===================================================
// Cloud Function: redeemPromoCode (callable)
// المستخدم يدخل كود ترويجي → يحصل على باقة + يُسجَّل استخدامه
// ===================================================
exports.redeemPromoCode = onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [smtpUser, smtpPass],
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
      }

      // V8 (2026-10-09، قرار المستخدم بنصّه): «redeemPromoCode: رفض صريح للمجهول والمزوّد الغائب في أوّل الدالّة، بفحص مصدره
      // واحد مع registerUser، وبالنصّ القائم.» الحساب المجهول مصادَق (request.auth موجود) لكنه ليس مسجَّلاً؛ والمزوّد الغائب
      // ليس «غير مجهول» (القاعدة 22). الرفض **قبل** قراءة promoCodes أو users، وبالنصّ نفسه أعلاه — لا نصّ جديد.
      // المعيار: src/utils/signInProvider.js (يستعمله registerUser أيضاً).
      const providerStatus = signInProviderStatus(request.auth.token);
      if (!providerStatus.identified) {
        console.warn(`[redeemPromoCode] rejected before reading the code: reason=${providerStatus.reason}`);
        throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
      }

      const {code} = request.data || {};
      if (!code) {
        throw new HttpsError("invalid-argument", "الكود مطلوب");
      }
      const userId = request.auth.uid;

      // البحث عن الكود (الاستعلامات لا تعمل داخل transaction)
      const codesSnap = await db.collection("promoCodes")
          .where("code", "==", code.toUpperCase().trim())
          .limit(1)
          .get();

      if (codesSnap.empty) {
        throw new HttpsError("not-found", "كود غير صالح");
      }

      const codeRef = codesSnap.docs[0].ref;
      const userRef = db.collection("users").doc(userId);

      // Transaction: قراءة + تحقق + تحديثان ذرّياً (يمنع تجاوز maxUses)
      const codeData = await db.runTransaction(async (tx) => {
        const codeSnap = await tx.get(codeRef);
        if (!codeSnap.exists) {
          throw new HttpsError("not-found", "كود غير صالح");
        }
        const data = codeSnap.data();

        if (!data.isActive) {
          throw new HttpsError("failed-precondition", "هذا العرض منتهي");
        }

        // Phase: validUntil enforcement (added 2026-05-17)
        // Codes can carry a Firestore Timestamp `validUntil` set by the admin UI.
        // If present and in the past, treat the code as expired. Legacy codes
        // (no validUntil field) skip the check — admin must still flip
        // `isActive: false` to retire those manually. Same Arabic message as
        // the isActive failure so the mobile maps both to one error code.
        if (data.validUntil) {
          const validUntilDate = data.validUntil.toDate ?
              data.validUntil.toDate() :
              new Date(data.validUntil);
          if (validUntilDate < new Date()) {
            throw new HttpsError("failed-precondition", "هذا العرض منتهي");
          }
        }

        if ((data.usedCount || 0) >= data.maxUses) {
          throw new HttpsError("resource-exhausted", "تم استنفاد الكود");
        }
        if ((data.usedBy || []).includes(userId)) {
          throw new HttpsError("already-exists", "استخدمت هذا الكود مسبقاً");
        }

        // Max-of expiresAt: if the user already has a longer subscription
        // remaining, preserve it. Granting a 30-day code to a user with 60
        // days left should NOT shorten their plan to 30 days.
        // NB: this read must happen before any tx.update — Firestore
        // transactions require all reads before all writes.
        const userSnap = await tx.get(userRef);
        const existingExpiresAt = userSnap.exists ?
            userSnap.data().expiresAt : null;
        const existingDate = existingExpiresAt?.toDate ?
            existingExpiresAt.toDate() :
            (existingExpiresAt ? new Date(existingExpiresAt) : null);
        const newExpiryDate = new Date(
            Date.now() + data.durationDays * 24 * 60 * 60 * 1000,
        );
        const finalExpiry = (existingDate && existingDate > newExpiryDate) ?
            existingExpiresAt :
            newExpiryDate;

        // تفعيل الاشتراك (تطبيع باقة الكود القديم: basic→shop_basic, pro→shop_pro
        // — فالأكواد القائمة تُحمى تلقائياً دون تصحيح يدوي)
        tx.update(userRef, {
          plan: normalizePlan(data.plan),
          scansRemaining: admin.firestore.FieldValue.increment(data.scans),
          scansTotal: admin.firestore.FieldValue.increment(data.scans),
          expiresAt: finalExpiry,
          isActive: true,
        });

        // تسجيل الاستخدام
        tx.update(codeRef, {
          usedCount: admin.firestore.FieldValue.increment(1),
          usedBy: admin.firestore.FieldValue.arrayUnion(userId),
        });

        return data;
      });

      // طبّع الباقة على الكائن المُعاد أيضاً كي تطابق الإشعاراتُ والقيمةُ
      // المُعادة ما كُتب فعلاً على المستخدم.
      codeData.plan = normalizePlan(codeData.plan);

      // قراءة المستخدم للإشعارات
      const userDoc = await db.collection("users").doc(userId).get();
      const user = userDoc.exists ? userDoc.data() : null;
      const lang = user?.language || "ar";

      // V8 الدفعة ١ (الخصوصية، 2026-10-08 +03): المعرّف مُهشَّر، وقيمة رمز العرض
      // (codeData.code) حُذفت من السجلّ لا هُشِّرت — قيمة قصيرة تُستردّ بها خدمة،
      // وتهشيرها يُكسَر بالتخمين؛ والاستردار مسجَّل أصلاً في مستند promoCodes
      // (usedCount / usedBy).
      console.log(
          "redeemPromoCode — userId:", hashIdForLog(userId),
          "plan:", codeData.plan,
          "scans:", codeData.scans,
      );

      // 1. بريد — نفس نمط grantSubscription
      if (user?.email) {
        try {
          const template = EMAIL_TEMPLATES.grantSubscription[lang];
          const transporter = getMailTransporter(smtpUser.value(), smtpPass.value());
          await transporter.sendMail({
            from: "\"NeuralCheck\" <" + smtpUser.value() + ">",
            to: user.email,
            subject: template.subject,
            html: template.html(user.name, codeData.scans, codeData.plan),
          });
        } catch (e) {
          console.error("Failed to send promo email:", sanitizeFailureText(e));
        }
      }

      // 2. FCM push
      if (user?.fcmToken) {
        try {
          await admin.messaging().send({
            token: user.fcmToken,
            notification: {
              title: lang === "tr" ?
                "Promosyon kodu uygulandı 🎁" :
                "تم تفعيل العرض 🎁",
              body: lang === "tr" ?
                `${codeData.scans} tarama eklendi` :
                `تمت إضافة ${codeData.scans} فحص لرصيدك`,
            },
            data: {
              type: "promo_code_redeemed",
              code: String(codeData.code || ""),
              plan: String(codeData.plan || ""),
              scans: String(codeData.scans || 0),
            },
          });
          console.log("redeemPromoCode — FCM sent OK to", hashIdForLog(userId));
        } catch (e) {
          console.error("Failed to send FCM for promo:", sanitizeFailureText(e));
        }
      } else {
        console.warn("redeemPromoCode — no fcmToken for user", hashIdForLog(userId));
      }

      return {
        success: true,
        plan: codeData.plan,
        scans: codeData.scans,
        message: lang === "tr" ?
          "Promosyon başarıyla uygulandı!" :
          "تم تفعيل العرض بنجاح!",
      };
    },
);

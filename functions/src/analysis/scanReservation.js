// ===================================================
// scanReservation — حجز رصيد الفحص في معاملة قبل نداء النموذج (إضافة أمر نقل الخامّ، 2026-10-09)
// ===================================================
//
// قرار المستخدم (بنصّه، منقول من أمر المنسّق): «حجز الرصيد في معاملة قبل نداء النموذج، وإعادته إن فشل
// التحليل، في دفعة الخادم نفسها، مع اختبار يثبت أن فحصين متزامنين برصيد واحد يمرّ أحدهما فقط.»
//
// ─── لماذا ──────────────────────────────────────────────────────────────────
// قبل هذا كان الرصيد **يُفحَص** عند بدء analyzeDevice و**يُخصَم** بعد نداء النموذج وبعد حفظ التقرير
// (increment(-1) بلا حدّ أدنى). فنداءات متوازية بمعرّفات فحص مختلفة (قفل scanClaims لكل scanId وحده) تمرّ
// كلّها من الفحص فتصل كلّها إلى النموذج (حتى أربعة طلبات DeepSeek للفحص الواحد)، ثم يصير الرصيد سالباً.
// قياس الجلسة السابقة (من الكود): analyzeDevice.js فحص الرصيد وخصمه.
//
// ─── ما تفعله ───────────────────────────────────────────────────────────────
// reserveScanCredit: **معاملة واحدة** تقرأ مستند المستخدم ومستند القفل، وتتحقّق من (رصيد ≥ 1، الاشتراك لم
// ينتهِ، وللفحص المجاني: الجهاز لم يُستعمل)، ثم تخصم فحصة (وتسجّل الجهاز للفحص المجاني) **وتكتب الحجز على
// مستند القفل في المعاملة نفسها**. فالخصم والسجلّ الدالّ عليه لا ينفصلان أبداً.
// releaseScanCredit: معاملة تُعيد الفحصة (وتُزيل الجهاز من القائمة) إن كان على القفل حجز، ثم تمحو الحجز —
// فلا إعادة مزدوجة.
//
// ─── مسارات الفشل بين الحجز والحفظ (وما يحدث للرصيد — القاعدة 22: لا يضيع ولا يُضاعف بصمت) ───────────
//  ١. runAnalysisInternal ترمي، أو فشل مزوّد النموذج الصلب (aiFailed)  ⇒ يُعاد الرصيد (catch في analyzeDevice).
//  ٢. حارس حجم الخامّ يرمي resource-exhausted                           ⇒ يُعاد.
//  ٣. فشل كتابة الدفعة (التقرير + reportRaw)                            ⇒ يُعاد (الدفعة ذرّية: لا تقرير).
//  ٤. أيّ استثناء آخر قبل حفظ التقرير                                    ⇒ يُعاد.
//  ٥. بعد حفظ التقرير (تحديث الجلسة/الملفّ الشخصي/بناء الردّ): لا يُعاد — التقرير موجود والفحصة مستهلَكة
//     بحقّ؛ وإعادة الطلب بالمعرّف نفسه تُرجع المحفوظ بلا حجز ولا خصم (التكافؤ).
//  ٦. فشل الإعادة نفسها (انقطاع Firestore): يبقى القفل بحجزه (لا يُمحى) فيكون الأثر **ظاهراً** لا ضائعاً.
//  ٧. انتهاء المهلة/انهيار المثيل (لا يصل catch ولا finally): يبقى القفل بحجزه. بعد انقضاء TTL:
//     (أ) إعادة الطلب بالمعرّف نفسه وبالمستخدم نفسه **تتبنّى الحجز** بلا خصم ثانٍ (adopted) — فلا مضاعفة؛
//     (ب) بمستخدم آخر: يُعاد الحجز القديم لصاحبه ثم يُحجز للجديد في المعاملة نفسها؛
//     (ج) بلا إعادة طلب: يبقى الرصيد محجوزاً حتى يُجرد: scanClaims بحقل reservation غير null وأقدم من TTL
//         وبلا reports/{scanId}. **لا إعادة آلية لهذه الحالة وحدها اليوم** — قيد معروف يُذكر في تقرير المهمّة.
//         (الدفعة ٩، 2026-10-10: استثناء لفحوص الجلسات وحدها — قفلها يحمل sessionId، وcancelScanSession تعيد حجزها العالق (عمر القفل ≥ SCAN_CLAIM_TTL_MS
//         وبلا تقرير) بـreleaseScanCredit هذه نفسها حين تُلغى الجلسة. وما سواها يبقى لسكربت الحجوزات العالقة اليدوي.)
//
// فحص الجلسة: userId هنا = ownerId (analyzeDevice.js: userId = sessionDoc.data().ownerId)، فالحجز من رصيد
// صاحب المحل لا من جهاز الزبون (الذي لا مستند رصيد له أصلاً).

'use strict';

const {scanGateVerdict, refuseScan, SCAN_REFUSAL_STAGE} = require('./scanRefusal');

// عمر قفل scanClaims الذي يُعدّ بعده القفل قديماً (لا نداء analyzeDevice حيّ يمتلكه) — مصدر واحد (القاعدة 24، الدفعة ٩، 2026-10-10).
// كان ثابتاً محلّياً `CLAIM_TTL_MS = 300_000` داخل analyzeDevice.js وحده؛ وcancelScanSession تقرؤه الآن لتفرّق «تحليل يجري» (عمر القفل < TTL: يُرفض
// الإلغاء) عن «حجز عالق» (≥ TTL: يُعاد). القيمة هي مهلة analyzeDevice نفسها (ANALYZE_DEVICE_TIMEOUT_MS = 300_000): القفل لا يعيش أطول من النداء الذي
// يمتلكه (التفصيل في تعليق analyzeDevice.js عند القفل). لم تتغيّر القيمة.
const SCAN_CLAIM_TTL_MS = 300_000;

// النصوص الثلاثة وأسباب الرفض وسطره كانت هنا (SCAN_RESERVATION_MESSAGES) وفي analyzeDevice.js نسختين حرفيتين؛ صارت مصدراً واحداً في scanRefusal.js (S-SUB، 2026-10-16)،
// وحكم الرفض نفسه (الرصيد فالانتهاء فالجهاز المجاني) scanGateVerdict منه — يقرؤه الفحص المبكّر في analyzeDevice.js وردّ checkSubscription أيضاً.

/**
 * يحجز فحصة للمستخدم في معاملة واحدة (أو يتبنّى حجزاً قائماً على القفل لا يزال لنفس المستخدم).
 * @param {Object} p
 * @param {Object} p.db Firestore.
 * @param {Object} p.FieldValue admin.firestore.FieldValue.
 * @param {string} p.userId من يُخصَم منه (صاحب المحل في فحص الجلسة).
 * @param {string} p.deviceFP مفتاح الجهاز للفحص المجاني.
 * @param {Object} p.claimRef مرجع scanClaims/{scanId} (موجود — أنشأه قفل analyzeDevice).
 * @param {number} p.nowMs وقت الحجز.
 * @param {boolean} p.isSessionScan هل الفحص فحص جلسة محلّ (يختار نسخة SHOP_ من رمز الرفض). **مُعامل صريح** — لا يُستنتَج من وجود sessionId على القفل؛ وغيره من البولي خطأ برمجي (القاعدة 22).
 * @return {Promise<{adopted: boolean, isFreeTrial: boolean, reservation: Object}>}
 * @throws {HttpsError} permission-denied بـdetails.reasonCode (scanRefusal.js): لا رصيد، أو الاشتراك انتهى، أو الجهاز استُعمل في فحص مجاني.
 */
async function reserveScanCredit({db, FieldValue, userId, deviceFP, claimRef, nowMs, isSessionScan}) {
  if (typeof isSessionScan !== 'boolean') {
    throw new Error('scanReservation: isSessionScan مُعامل صريح (true أو false) — لا يُستنتَج من sessionId على القفل');
  }
  const userRef = db.collection('users').doc(userId);
  return db.runTransaction(async (tx) => {
    const [userSnap, claimSnap] = await Promise.all([tx.get(userRef), tx.get(claimRef)]);
    const carried = (claimSnap.exists && claimSnap.data().reservation) || null;

    if (carried && carried.userId === userId) {
      // حجز سابق لم يُحرَّر (انهيار/مهلة) لنفس المستخدم والمعرّف: نتبنّاه — لا خصم ثانٍ.
      return {adopted: true, isFreeTrial: carried.isFreeTrial === true, reservation: carried};
    }
    if (carried) {
      // حجز قديم لمستخدم آخر على المعرّف نفسه: يُعاد لصاحبه (لا يضيع) ثم نحجز للجديد.
      const prev = {scansRemaining: FieldValue.increment(1)};
      if (carried.isFreeTrial && carried.deviceFP) prev.freeTrialUsedDevices = FieldValue.arrayRemove(carried.deviceFP);
      tx.update(db.collection('users').doc(carried.userId), prev);
    }

    // الرفض هنا هو ما يحسم التزامن — الحكم من scanGateVerdict (مصدره الواحد مع الفحص المبكّر وردّ checkSubscription: الرصيد فالانتهاء فالجهاز المجاني)، والرمي والسطر من refuseScan
    // (scanRefusal.js، موضع الرمي الوحيد): سطر مسمّى بالسبب والمرحلة (reservation) وscanId مُهشَّراً — بلا معرّف مستخدم (سياسة السجلّات) — كي يُرى أنّ طبقة المعاملة هي التي منعت،
    // لا الفحص المبكّر وحده. المستند غائباً أو بلا رصيد ⟵ NO_CREDIT (فـuserData غير null بعد هذا الشرط).
    const userData = userSnap.exists ? userSnap.data() : null;
    const verdict = scanGateVerdict(userData, {deviceFP});
    if (verdict !== null) refuseScan(verdict, {stage: SCAN_REFUSAL_STAGE.RESERVATION, isSessionScan, scanId: claimRef.id});
    const isFreeTrial = (userData.plan || 'free') === 'free';

    const update = {scansRemaining: FieldValue.increment(-1)};
    if (isFreeTrial) update.freeTrialUsedDevices = FieldValue.arrayUnion(deviceFP);
    tx.update(userRef, update);
    const reservation = {userId, isFreeTrial, deviceFP: isFreeTrial ? deviceFP : null, reservedAtMs: nowMs};
    tx.set(claimRef, {reservation}, {merge: true});
    return {adopted: false, isFreeTrial, reservation};
  });
}

/**
 * يُعيد الفحصة المحجوزة (إن بقي على القفل حجز) ويمحو الحجز — إعادة واحدة مهما تكرّر الاستدعاء.
 * @param {Object} p
 * @param {Object} p.db Firestore.
 * @param {Object} p.FieldValue admin.firestore.FieldValue.
 * @param {Object} p.claimRef مرجع scanClaims/{scanId}.
 * @return {Promise<{released: boolean}>}
 */
async function releaseScanCredit({db, FieldValue, claimRef}) {
  return db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    const reservation = (claimSnap.exists && claimSnap.data().reservation) || null;
    if (!reservation) return {released: false};
    const update = {scansRemaining: FieldValue.increment(1)};
    if (reservation.isFreeTrial && reservation.deviceFP) {
      update.freeTrialUsedDevices = FieldValue.arrayRemove(reservation.deviceFP);
    }
    tx.update(db.collection('users').doc(reservation.userId), update);
    tx.update(claimRef, {reservation: null});
    return {released: true};
  });
}

module.exports = {SCAN_CLAIM_TTL_MS, reserveScanCredit, releaseScanCredit};

// ===================================================
// Email: Transporter + Templates (SMTP عبر Gmail App Password)
// ===================================================

// lazy-require لتجنّب timeout في backend discovery
function getMailTransporter(user, pass) {
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    service: "gmail",
    auth: {user, pass},
  });
}

const EMAIL_TEMPLATES = {
  welcome: {
    ar: {
      subject: "مرحباً بك في NeuralCheck! 🎉",
      html: (name, scans) => `
        <div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#4ADE80;text-align:center;">NeuralCheck</h1>
          <p>مرحباً ${name || "بك"}! 👋</p>
          <p>تم إنشاء حسابك بنجاح. لديك <strong style="color:#4ADE80;">${scans} فحص مجاني</strong> للتجربة.</p>
          <p>نزّل التطبيق وابدأ فحص أول جهاز الآن!</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/download/NeuralCheck.apk" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">تنزيل التطبيق</a>
          </div>
          <p style="color:#64748B;font-size:12px;text-align:center;">NeuralCheck — فحص ذكي، ثقة كاملة</p>
        </div>
      `,
    },
    tr: {
      subject: "NeuralCheck'e hoş geldiniz! 🎉",
      html: (name, scans) => `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#4ADE80;text-align:center;">NeuralCheck</h1>
          <p>Hoş geldin ${name || ""}! 👋</p>
          <p>Hesabınız başarıyla oluşturuldu. Denemek için <strong style="color:#4ADE80;">${scans} ücretsiz tarama</strong> hakkınız var.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/download/NeuralCheck.apk" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Uygulamayı İndir</a>
          </div>
          <p style="color:#64748B;font-size:12px;text-align:center;">NeuralCheck — Akıllı Tarama, Tam Güven</p>
        </div>
      `,
    },
  },

  // ملاحظة: الوسائط (name, scans, plan) — تطابق ترتيب استدعاء sendNotificationEmail
  grantSubscription: {
    ar: {
      subject: "تهانينا! حصلت على اشتراك مجاني 🎁",
      html: (name, scans, plan) => `
        <div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#4ADE80;text-align:center;">NeuralCheck</h1>
          <p>مرحباً ${name || ""}! 🎉</p>
          <p>تم منحك <strong style="color:#4ADE80;">اشتراك ${plan === "shop_pro" ? "احترافي" : "أساسي"} مجاني</strong>!</p>
          <p>لديك الآن <strong style="color:#38BDF8;">${scans} فحص</strong> صالحة لمدة 30 يوماً.</p>
          <p>ابدأ الآن بفحص الأجهزة وبناء سمعتك مع تقارير موثوقة بالذكاء الاصطناعي.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">افتح التطبيق</a>
          </div>
          <p style="color:#64748B;font-size:12px;text-align:center;">NeuralCheck — فحص ذكي، ثقة كاملة</p>
        </div>
      `,
    },
    tr: {
      subject: "Tebrikler! Ücretsiz abonelik kazandınız 🎁",
      html: (name, scans, plan) => `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#4ADE80;text-align:center;">NeuralCheck</h1>
          <p>Merhaba ${name || ""}! 🎉</p>
          <p><strong style="color:#4ADE80;">Ücretsiz ${plan === "shop_pro" ? "Pro" : "Temel"} abonelik</strong> kazandınız!</p>
          <p>Şu anda <strong style="color:#38BDF8;">${scans} tarama</strong> hakkınız var (30 gün geçerli).</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Uygulamayı Aç</a>
          </div>
        </div>
      `,
    },
  },

  subscriptionExpiring: {
    ar: {
      subject: "⚠️ اشتراكك ينتهي خلال 3 أيام",
      html: (name, scansLeft) => `
        <div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#F59E0B;text-align:center;">⚠️ تنبيه</h1>
          <p>مرحباً ${name || ""}،</p>
          <p>اشتراكك في NeuralCheck <strong style="color:#F59E0B;">ينتهي خلال 3 أيام</strong>.</p>
          <p>المتبقي لديك: <strong>${scansLeft}</strong> فحص.</p>
          <p>جدّد اشتراكك الآن لتستمر بتقديم تقارير موثوقة لعملائك.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/pricing" style="background:#F59E0B;color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">تجديد الاشتراك</a>
          </div>
        </div>
      `,
    },
    tr: {
      subject: "⚠️ Aboneliğiniz 3 gün içinde sona eriyor",
      html: (name, scansLeft) => `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#F59E0B;text-align:center;">⚠️ Uyarı</h1>
          <p>Merhaba ${name || ""},</p>
          <p>NeuralCheck aboneliğiniz <strong style="color:#F59E0B;">3 gün içinde sona erecek</strong>.</p>
          <p>Kalan tarama hakkınız: <strong>${scansLeft}</strong></p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/pricing" style="background:#F59E0B;color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Aboneliği Yenile</a>
          </div>
        </div>
      `,
    },
  },

  subscriptionExpired: {
    ar: {
      subject: "🔴 انتهى اشتراكك في NeuralCheck",
      html: (name) => `
        <div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#EF4444;text-align:center;">🔴 انتهى الاشتراك</h1>
          <p>مرحباً ${name || ""}،</p>
          <p>انتهت صلاحية اشتراكك في NeuralCheck، وتوقّف رصيد الفحوصات.</p>
          <p>جدّد اشتراكك الآن لاستئناف الفحوصات وتقديم تقارير موثوقة لعملائك.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/pricing" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">تجديد الاشتراك</a>
          </div>
        </div>
      `,
    },
    tr: {
      subject: "🔴 NeuralCheck aboneliğiniz sona erdi",
      html: (name) => `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#EF4444;text-align:center;">🔴 Abonelik Sona Erdi</h1>
          <p>Merhaba ${name || ""},</p>
          <p>NeuralCheck aboneliğiniz sona erdi ve tarama hakkınız durduruldu.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/pricing" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Aboneliği Yenile</a>
          </div>
        </div>
      `,
    },
  },

  scansRunningLow: {
    ar: {
      subject: "📊 تبقى لديك 3 فحوصات فقط",
      html: (name) => `
        <div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#38BDF8;text-align:center;">NeuralCheck</h1>
          <p>مرحباً ${name || ""}،</p>
          <p>تبقى لديك <strong style="color:#F59E0B;">3 فحوصات فقط</strong> في رصيدك.</p>
          <p>أضف رصيداً الآن لتستمر بدون انقطاع.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/pricing" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">شراء فحوصات</a>
          </div>
        </div>
      `,
    },
    tr: {
      subject: "📊 Sadece 3 tarama hakkınız kaldı",
      html: (name) => `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#38BDF8;text-align:center;">NeuralCheck</h1>
          <p>Merhaba ${name || ""},</p>
          <p>Sadece <strong style="color:#F59E0B;">3 tarama</strong> hakkınız kaldı.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/pricing" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Tarama Satın Al</a>
          </div>
        </div>
      `,
    },
  },

  // ملاحظة: الوسائط (name, scans, plan) — تطابق ترتيب استدعاء sendNotificationEmail
  paymentConfirmed: {
    ar: {
      subject: "✅ تم تأكيد الدفع وتفعيل اشتراكك",
      html: (name, scans, plan) => `
        <div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#4ADE80;text-align:center;">✅ تم التأكيد</h1>
          <p>مرحباً ${name || ""}،</p>
          <p>تم تأكيد دفعتك وتفعيل اشتراكك بنجاح.</p>
          <p>الباقة: <strong style="color:#4ADE80;">${plan === "shop_pro" ? "محل احترافي" : plan === "shop_basic" ? "محل أساسي" : "فحص فردي"}</strong></p>
          <p>الرصيد: <strong style="color:#38BDF8;">${scans} فحص</strong></p>
        </div>
      `,
    },
    tr: {
      subject: "✅ Ödeme onaylandı, aboneliğiniz aktif",
      html: (name, scans, plan) => `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#4ADE80;text-align:center;">✅ Onaylandı</h1>
          <p>Merhaba ${name || ""},</p>
          <p>Ödemeniz onaylandı ve aboneliğiniz aktif.</p>
          <p>Paket: <strong style="color:#4ADE80;">${plan === "shop_pro" ? "Pro" : plan === "shop_basic" ? "Temel" : "Tek Tarama"}</strong></p>
          <p>Bakiye: <strong style="color:#38BDF8;">${scans} tarama</strong></p>
        </div>
      `,
    },
  },

  paymentRejected: {
    ar: {
      subject: "❌ تم رفض طلب الدفع",
      html: (name, reason) => `
        <div dir="rtl" style="font-family:Tajawal,Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#EF4444;text-align:center;">❌ تم الرفض</h1>
          <p>مرحباً ${name || ""}،</p>
          <p>عذراً، تم رفض طلب الدفع. يرجى التأكد من صحة رقم العملية والمحاولة مرة أخرى.</p>
          <div style="background:#1E293B;border-right:4px solid #EF4444;padding:12px 16px;border-radius:8px;margin:16px 0;">
            <p style="margin:0;color:#94A3B8;">السبب: <strong style="color:#F1F5F9;">${reason || "غير محدد"}</strong></p>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/pricing" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">محاولة جديدة</a>
          </div>
        </div>
      `,
    },
    tr: {
      subject: "❌ Ödeme talebi reddedildi",
      html: (name, reason) => `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0A0E1A;color:#F1F5F9;padding:32px;border-radius:16px;">
          <h1 style="color:#EF4444;text-align:center;">❌ Reddedildi</h1>
          <p>Merhaba ${name || ""},</p>
          <p>Ödeme talebiniz reddedildi. Lütfen işlem numarasını kontrol edip tekrar deneyin.</p>
          <div style="background:#1E293B;border-left:4px solid #EF4444;padding:12px 16px;border-radius:8px;margin:16px 0;">
            <p style="margin:0;color:#94A3B8;">Sebep: <strong style="color:#F1F5F9;">${reason || "Belirtilmedi"}</strong></p>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://neuralcheck.net/pricing" style="background:linear-gradient(135deg,#4ADE80,#22D3EE);color:#0A0E1A;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Yeniden Dene</a>
          </div>
        </div>
      `,
    },
  },
};

module.exports = {getMailTransporter, EMAIL_TEMPLATES};

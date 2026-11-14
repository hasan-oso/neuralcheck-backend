'use strict';

// fixLeaksLocally.js — deterministic English→Arabic/Turkish substitution.
//
// Drop-in replacement for fixLeaksTargeted's role in callAI.js. Same
// (aiClient, leaks, language, key) signature for compatibility, but
// aiClient and key are ignored — no AI call is made.
//
// Coverage philosophy: cover the mandatory translation table from
// systemPromptV5.js + common technical drift terms (~80-100 entries).
// Remaining leaks (typically <2 per report) are left in place as
// graceful degradation. Validator detection is preserved upstream for
// monitoring.

const DICTIONARY_AR = {
  // ─── Mandatory table from systemPromptV5.js ────────────────────
  'cpu': 'المعالج',
  'gpu': 'معالج الرسوميات',
  'ram': 'الذاكرة العشوائية',
  'ufs': 'التخزين الداخلي',
  'emmc': 'التخزين الداخلي',
  'ssd': 'التخزين الداخلي',
  'lpddr': 'الذاكرة العشوائية',
  'ddr': 'الذاكرة العشوائية',
  'amoled': 'الشاشة',
  'oled': 'الشاشة',
  'lcd': 'الشاشة',
  'fps': 'إطار في الثانية',
  'wifi': 'الواي فاي',
  'bluetooth': 'البلوتوث',
  'gps': 'نظام تحديد المواقع',
  'nfc': 'الاتصال القريب',
  'tee': 'نظام الأمان الداخلي',
  'khz': 'كيلوهرتز',
  'hz': 'هرتز',
  'mhz': 'ميجاهرتز',
  'ghz': 'جيجاهرتز',
  'silicon': 'شريحة المعالج',
  'throttling': 'اختناق الأداء',
  'throttle': 'اختناق',
  'throttled': 'مختنق',
  'headroom': 'السعة المتاحة',
  'thermal': 'الحراري',
  'burst': 'الانطلاقة القصيرة',

  // ─── Common technical drift terms ──────────────────────────────
  'battery': 'البطارية',
  'performance': 'الأداء',
  'temperature': 'درجة الحرارة',
  'voltage': 'الجهد',
  'current': 'التيار',
  'power': 'الطاقة',
  'frequency': 'التردد',
  'storage': 'التخزين',
  'memory': 'الذاكرة',
  'sensor': 'مستشعر',
  'sensors': 'المستشعرات',
  'capacity': 'السعة',
  'screen': 'الشاشة',
  'display': 'العرض',
  'resolution': 'الدقة',
  'density': 'الكثافة',
  'refresh': 'التحديث',
  'rate': 'المعدل',
  'speed': 'السرعة',
  'test': 'اختبار',
  'tests': 'اختبارات',
  'tested': 'اختُبر',
  'untested': 'غير مختبر',
  'passed': 'نجح',
  'failed': 'فشل',
  'failure': 'الفشل',
  'result': 'النتيجة',
  'results': 'النتائج',
  'data': 'البيانات',

  // ─── OS & software ─────────────────────────────────────────────
  'android': 'أندرويد',
  'level': 'المستوى',
  'version': 'الإصدار',
  'patch': 'التصحيح',

  // ─── Security ──────────────────────────────────────────────────
  'security': 'الأمان',
  'root': 'صلاحيات الجذر',
  'rooted': 'يحوي صلاحيات جذر',
  'encryption': 'التشفير',
  'encrypted': 'مشفر',
  'developer': 'المطور',
  'debugging': 'تصحيح الأخطاء',
  'debug': 'تصحيح',
  'usb': 'يو إس بي',
  'lock': 'القفل',
  'bootloader': 'محمل الإقلاع',

  // ─── Battery details ───────────────────────────────────────────
  'charge': 'الشحن',
  'charging': 'الشحن',
  'discharge': 'التفريغ',
  'discharging': 'التفريغ',
  'cycle': 'الدورة',
  'cycles': 'الدورات',
  'health': 'الصحة',
  'wear': 'الاهتراء',

  // ─── GPU / graphics ────────────────────────────────────────────
  'opengl': 'واجهة الرسوميات',
  'vulkan': 'فولكان',
  'pixel': 'بكسل',
  'frame': 'إطار',
  'render': 'العرض',
  'rendering': 'العرض',

  // ─── Wireless / network ────────────────────────────────────────
  'signal': 'الإشارة',
  'strength': 'القوة',
  'modem': 'المودم',
  'operator': 'شركة الاتصالات',
  'cellular': 'الشبكة الخلوية',
  'wireless': 'اللاسلكي',
  'esim': 'الشريحة الإلكترونية',
  'sim': 'الشريحة',

  // ─── Storage I/O ───────────────────────────────────────────────
  'read': 'القراءة',
  'write': 'الكتابة',
  'sequential': 'المتتالي',
  'random': 'العشوائي',
  'throughput': 'الإنتاجية',
  'iops': 'عملية في الثانية',

  // ─── Sensors ───────────────────────────────────────────────────
  'compass': 'البوصلة',
  'gyroscope': 'الجيروسكوب',
  'accelerometer': 'مقياس التسارع',
  'proximity': 'القرب',
  'light': 'الضوء',
  'barometer': 'البارومتر',
  'pressure': 'الضغط',
  'gravity': 'الجاذبية',
  'rotation': 'الدوران',
  'vector': 'المتجه',

  // ─── Stress test / phases ──────────────────────────────────────
  'stress': 'الإجهاد',
  'sustained': 'المتواصل',
  'peak': 'الذروة',
  'idle': 'الخمول',
  'load': 'الحمل',
  'phase': 'المرحلة',
  'phases': 'المراحل',
  'cooling': 'التبريد',
  'heating': 'التسخين',
  'rise': 'الارتفاع',

  // ─── Issue severity ────────────────────────────────────────────
  'critical': 'حرج',
  'danger': 'خطير',
  'warning': 'تحذير',
  'info': 'معلومة',

  // ─── Generic ───────────────────────────────────────────────────
  'device': 'الجهاز',
  'phone': 'الهاتف',
  'mode': 'الوضع',
  'state': 'الحالة',
  'status': 'الحالة',
  'detected': 'تم اكتشاف',
  'enabled': 'مفعل',
  'disabled': 'معطل',
  'available': 'متاح',
  'unavailable': 'غير متاح',
  'supported': 'مدعوم',
  'unsupported': 'غير مدعوم',
  'unknown': 'غير معروف',
  'verified': 'متحقق منه',
  'unverified': 'غير متحقق منه',

  // ─── Time series shapes (less common but possible) ─────────────
  'cliff': 'انحدار حاد',
  'gradual': 'تدريجي',
  'recovery': 'التعافي',
  'volatile': 'متقلب',
  'stable': 'مستقر',
};

const DICTIONARY_TR = {
  // Mandatory table
  'cpu': 'İşlemci',
  'gpu': 'Grafik İşlemci',
  'ram': 'Bellek',
  'ufs': 'Dahili Depolama',
  'emmc': 'Dahili Depolama',
  'ssd': 'Dahili Depolama',
  'lpddr': 'Bellek',
  'ddr': 'Bellek',
  'amoled': 'Ekran',
  'oled': 'Ekran',
  'lcd': 'Ekran',
  'fps': 'Saniyedeki Kare',
  'wifi': 'Kablosuz Ağ',
  'gps': 'Konum Sistemi',
  'nfc': 'Yakın Alan İletişimi',
  'tee': 'Güvenlik Sistemi',
  'silicon': 'İşlemci Yongası',
  'throttling': 'Performans Düşürme',
  'throttle': 'Düşürme',
  'headroom': 'Termal Pay',
  'thermal': 'Termal',
  'burst': 'Kısa Patlama',

  // Common technical
  'battery': 'Pil',
  'performance': 'Performans',
  'temperature': 'Sıcaklık',
  'voltage': 'Voltaj',
  'current': 'Akım',
  'power': 'Güç',
  'frequency': 'Frekans',
  'storage': 'Depolama',
  'memory': 'Bellek',
  'sensor': 'Sensör',
  'sensors': 'Sensörler',
  'capacity': 'Kapasite',
  'screen': 'Ekran',
  'resolution': 'Çözünürlük',
  'density': 'Yoğunluk',
  'refresh': 'Yenileme',
  'rate': 'Oran',
  'speed': 'Hız',
  'test': 'Test',
  'passed': 'Başarılı',
  'failed': 'Başarısız',
  'result': 'Sonuç',

  // OS & security
  'android': 'Android',
  'level': 'Seviye',
  'version': 'Sürüm',
  'security': 'Güvenlik',
  'root': 'Root Yetkileri',
  'rooted': 'Root Erişimli',
  'encryption': 'Şifreleme',
  'encrypted': 'Şifreli',
  'developer': 'Geliştirici',
  'debugging': 'Hata Ayıklama',
  'usb': 'USB',
  'bootloader': 'Önyükleyici',

  // Battery
  'charge': 'Şarj',
  'charging': 'Şarj Oluyor',
  'discharge': 'Deşarj',
  'cycle': 'Döngü',
  'health': 'Sağlık',

  // GPU/graphics
  'opengl': 'OpenGL',
  'vulkan': 'Vulkan',
  'pixel': 'Piksel',
  'frame': 'Kare',

  // Wireless
  'signal': 'Sinyal',
  'strength': 'Güç',
  'modem': 'Modem',
  'operator': 'Operatör',
  'cellular': 'Hücresel',
  'wireless': 'Kablosuz',

  // Storage I/O
  'read': 'Okuma',
  'write': 'Yazma',
  'sequential': 'Ardışık',
  'random': 'Rastgele',
  'throughput': 'Veri Aktarımı',

  // Sensors
  'compass': 'Pusula',
  'gyroscope': 'Jiroskop',
  'accelerometer': 'İvmeölçer',
  'proximity': 'Yakınlık',
  'light': 'Işık',
  'barometer': 'Barometre',

  // Stress test
  'stress': 'Stres',
  'sustained': 'Sürekli',
  'peak': 'Zirve',
  'idle': 'Boşta',
  'load': 'Yük',
  'phase': 'Aşama',
  'phases': 'Aşamalar',

  // Severity
  'critical': 'Kritik',
  'danger': 'Tehlikeli',
  'warning': 'Uyarı',
  'info': 'Bilgi',

  // Generic
  'device': 'Cihaz',
  'phone': 'Telefon',
  'mode': 'Mod',
  'state': 'Durum',
  'status': 'Durum',
  'detected': 'Algılandı',
  'enabled': 'Etkin',
  'disabled': 'Devre Dışı',
  'available': 'Mevcut',
  'unavailable': 'Mevcut Değil',
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Drop-in replacement for fixLeaksTargeted. Returns same shape.
// aiClient and key are ignored (kept for signature compatibility).
async function fixLeaksLocally(aiClient, leaks, language, key) {
  if (!Array.isArray(leaks) || leaks.length === 0) {
    return {fixes: {}, applied: 0, skipped: 0, calledModel: false};
  }

  const dict = language === 'ar' ? DICTIONARY_AR :
               language === 'tr' ? DICTIONARY_TR :
               null;

  if (!dict) {
    return {
      fixes: {}, applied: 0, skipped: 0, calledModel: false,
      error: 'unsupported_language:' + language,
    };
  }

  const fixes = {};
  let tokensReplaced = 0;
  let tokensSkipped = 0;

  for (const leak of leaks) {
    let corrected = leak.original;

    // Sort tokens longest-first so "battery" doesn't partially match
    // before a longer compound term gets a chance.
    const sortedTokens = [...leak.tokens].sort((a, b) => b.length - a.length);

    for (const token of sortedTokens) {
      const lookup = token.toLowerCase();
      const translation = dict[lookup];
      if (translation) {
        // \b word boundary, case-insensitive
        const regex = new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
        const before = corrected;
        corrected = corrected.replace(regex, translation);
        if (corrected !== before) {
          tokensReplaced++;
        }
      } else {
        tokensSkipped++;
      }
    }

    if (corrected !== leak.original) {
      fixes[leak.path] = corrected;
    }
  }

  console.log(`[v5][local-fix] tokensReplaced=${tokensReplaced} ` +
      `tokensSkipped=${tokensSkipped} fieldsFixed=${Object.keys(fixes).length}`);

  return {fixes, calledModel: false};
}

module.exports = {fixLeaksLocally, DICTIONARY_AR, DICTIONARY_TR};

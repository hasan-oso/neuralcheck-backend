# neuralcheck-backend

[English](README.md) · [العربية](README.ar.md) · **Türkçe**

> **Proje durumu: arşivlendi.** NeuralCheck'in geliştirilmesi Kasım 2026'da durduruldu (zaman yetersizliği ve planlanan saha veri toplamanın pratikte neredeyse imkânsız olması nedeniyle). Kod olduğu gibi, garanti ve destek olmaksızın [MIT lisansı](LICENSE) ile yayımlanmıştır. Bu depoda **gizli bilgi yoktur**: tüm anahtarlar, parolalar ve yönetici adresleri yayımdan önce silindi veya yer tutucularla değiştirildi.

**NeuralCheck**'in (ikinci el akıllı telefonlar için bir tanılama sistemi) Firebase arka ucu: Cloud Functions, Firestore ve Storage kuralları. Android uygulaması ([neuralcheck-mobile](https://github.com/hasan-oso/neuralcheck-mobile)) donanım testlerini çalıştırıp ham bir parmak izi yükler; bu arka uç onu analiz eder, telefonu derecelendirir ve web sitesinin ([neuralcheck-website](https://github.com/hasan-oso/neuralcheck-website)) gösterdiği doğrulanabilir bir rapor üretir.

## Ne yapar

- **Analiz hattı** (`functions/src/analysis`, `lab`, `prompts`): ham cihaz parmak izini hesaplanmış özelliklere ve klinik özete dönüştürür, anlatı için bir dil modeli (DeepSeek, Gemini) çağırır ve dereceli (A–D) bir rapor saklar.
- **Tarama oturumları** (`functions/src/sessions`): dükkân kısa bir kod (`NC-XXXXXX`) oluşturur, müşterinin telefonu bu koda katılıp taranır; kredi rezervasyonu ve abonelik kontrolü burada yapılır.
- **Raporlar** (`functions/src/reports`): kısa kodla herkese açık doğrulama (`verifyReport`) ve PDF dışa aktarma (`generateReportPdf`, Puppeteer + başsız Chromium).
- **Protokol** (`functions/src/protocol`, `evaluations`): «bakım öncesi/sonrası» çiftleri, soğuk tekrar taramaları, onay kayıtları, teknisyenin kör değerlendirme formları. Yalnızca sunucu tarafındadır; taranan telefona gösterilmez.
- **Hesaplar ve ödeme** (`users`, `payments`, `notifications`): paketler, promosyon kodları, elle ödeme onayı, abonelik bitiş e-postaları.
- **Yönetici işlevleri** (`functions/src/admin`): yapay zekâ modeli değiştirme, protokol ayarları, dükkân bölümleri, teknisyen yönetimi, düzeltmeler.

Dışa aktarılan 36 işlevin tamamı `functions/index.js` içinde listelenir. Üç depo arasındaki sözleşmeler `docs/` altındadır (`PROTOCOL_CONTRACT.md`, `V7_DISPLAY_SHAPE_CONTRACT.md`, `FV68_CONTRACT.md`, `FV71_CONTRACT_SECTION.md`).

## Gereksinimler

Node.js **22**, Firebase CLI ve kendi Firebase projeniz (İşlevler için Blaze planı, Firestore, Storage).

## Kurulum

```bash
cd functions && npm ci
firebase use <proje-kimliginiz>          # .firebaserc hâlâ özgün projenin adını taşır
```

Gizli bilgiler depoda **asla** saklanmaz. Bunları Secret Manager'a girin (adlar `functions/src/utils/secrets.js` içinde tanımlıdır):

```bash
firebase functions:secrets:set DEEPSEEK_API_KEY
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
```

Cihaz kimliği HMAC anahtarı `DEVICE_ID_HMAC_KEY` ortam değişkeninden okunur (`functions/src/profiles/deviceIdentityHmac.js`). Yerel emülatör için `functions/.env.example` dosyasını `functions/.env` olarak kopyalayın (git tarafından yok sayılır).

**Yönetici listesi.** Yöneticiler e-posta ile eşleştirilir. `admin1@example.com`, `admin2@example.com`, `admin3@example.com` yer tutucularını kendi adreslerinizle **üç yerde birden** değiştirin: `firestore.rules` (16-18. satırlar), `functions/src/utils/admin.js` (18-20. satırlar) ve web sitesindeki `lib/admin.js`.

## Testler

Test çalıştırıcı betiği yoktur; her test sade bir Node betiğidir:

```bash
# emülatör gerektirmeyen tüm testler
for f in functions/test/*.test.js; do case "$f" in *e2e*) continue;; esac; node "$f" || echo "FAILED: $f"; done
```

`*.e2e.test.js` dosyaları Firestore'a yazar; yalnızca emülatörde çalıştırılmalıdır (`firebase emulators:exec --only firestore ...`). Kural testleri `rules-test/` altındadır.

## Dağıtım

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
```

Önce `docs/DEPLOY_CHECKLIST.md` dosyasını okuyun (yalnızca değişen işlevlerin neden dağıtılması gerektiğini açıklar).

## Lisans

[MIT](LICENSE). `functions/test/fixtures/golden/` altındaki test örnekleri, yazarların kendi test telefonlarının gerçek taramalarından türetilmiştir.

*Not: Türkçe metin bir anadili konuşuru tarafından gözden geçirilmemiştir; düzeltmeler memnuniyetle karşılanır.*

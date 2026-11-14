# فهارس Firestore — لا تحذف شيئاً من `firestore.indexes.json`

> **⛔ قبل أي تعديل على [`firestore.indexes.json`](../firestore.indexes.json) اقرأ هذا الملف.**
> الفهرسان المُعلَنان هناك **ليسا زائدين** — ثلاث شاشات في الإنتاج تتوقّف عليهما.
> حذف أيٍّ منهما ثم نشر `firestore:indexes` يكسرها فوراً وبلا رسالة خطأ ظاهرة
> للمستخدم (كل الاستدعاءات تبتلع الخطأ وتعرض قائمة فارغة).

## لماذا وُجد هذا الملف

كان `firestore.indexes.json` يعلن `"indexes": []` بينما المشروع الحيّ
`neuralchek-9b6d7` يملك **فهرسين مركّبين READY** أُنشئا يدوياً من وحدة التحكّم
ولم يُوثَّقا في أي مستودع. الانحراف جعل أمراً روتينياً واحداً مدمّراً:

```
firebase deploy --only firestore:indexes    ← كان سيحذف الفهرسين الحيّين
```

لأن الأداة تعامل الملف كمصدر الحقيقة، فما لا يَرِد فيه يُعرَض للحذف.
الفرع `fix/mirror-live-indexes` صحّح الملف ليطابق المنشور تماماً، فصار الأمر
بلا مفعول (no-op) بدل أن يكون مدمّراً.

## الفهرسان ومن يستعملهما

### 1. `reports`: `userId ASC` + `createdAt DESC`

يخدم استعلام «أحدث فحوصات هذا الحساب» — مساواة على حقل مع ترتيب على حقل آخر،
وهذا النمط **يتطلّب فهرساً مركّباً** ولا يكفيه الفهرس المفرد التلقائي.

| المستهلك | الموقع |
|---|---|
| لوحة حساب المتجر | `wepsite/app/dashboard/page.js:96-102` |
| لوحة الفنّي (تقييم الدقّة) | `wepsite/app/tech/page.js:83-86` |

```js
query(collection(db, 'reports'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(50))
```

### 2. `reports`: `userId ASC` + `listingStatus ASC` + `createdAt DESC`

يخدم صفحة المتجر العلنية — مساواتان مع ترتيب على حقل ثالث.

| المستهلك | الموقع |
|---|---|
| صفحة المتجر `/shop/{slug}` | `wepsite/app/shop/[slug]/ShopClient.js:119-127` |

```js
query(collection(db, 'reports'),
      where('userId', '==', doc0.id),
      where('listingStatus', 'in', ['for_sale', 'sold']),
      orderBy('createdAt', 'desc'),
      limit(50))
```

## ما لا يحتاج فهرساً مركّباً (لا تُضِف بلا داعٍ)

الاستعلامات التالية تكتفي بالفهرس المفرد الذي ينشئه Firestore تلقائياً لكل حقل،
ولا يجوز إضافة فهارس لها:

| الاستعلام | الموقع |
|---|---|
| `evaluations` بـ `where('ownerId','==',uid)` — مساواة واحدة بلا ترتيب | `wepsite/app/tech/page.js:89-90` |
| `reports` بـ `where('shortId','==',id)` | `functions/src/reports/verifyReport.js:36-39` |
| `promoCodes` بـ `where('code','==',code)` | `functions/src/users/redeemPromoCode.js:29` |
| `scanSessions` بـ `where('code','==',code)` — مساواة واحدة؛ الحالة تُصفّى في الذاكرة ليُعرَف حال الجلسة غير الـpending (الدفعة ٩، 2026-10-10؛ كان مع `where('status','==','pending')` في `joinScanSession.js:17-21` عند 83d7750) | `functions/src/sessions/joinScanSession.js:93` |
| `scanClaims` بـ `where('sessionId','==',id)` — مساواة واحدة؛ الحقل تكتبه analyzeDevice لقفل فحص الجلسة (الدفعة ٩)، وتقرؤه cancelScanSession داخل معاملتها وreleaseSessionReservations خارجها | `functions/src/sessions/cancelScanSession.js:186` و`functions/src/sessions/sessionLifecycle.js:225` |
| `scanSessions` بـ `where(key,'==',uid).where('status','==','pending')` ثم `…'scanning'` — **مساواتان بلا ترتيب ولا مدى** (كنس جلسات الفاعل المنقضية، S-SWEEP 2026-10-15، E33): المفتاح `ownerId` عند إنشاء جلسة و`joinedBy` عند الانضمام. `firestore.indexes.json` لا فهرس مركّب لـ`scanSessions`، **ولا يُنشأ** (القاعدة 43: «لا يُنشأ فهرس scanSessions(status, expiresAt) قبل إصلاح checkExpiringSubscriptions»). الاستعلام بمساواتين يعتمد على الفهارس المفردة (سابقتها `createScanSession.js:91-94`: `code ==` + `status ==`). **المحاكي لا يفرض الفهارس فلا يُثبت اختباره هذا**؛ ويُرصد بعد النشر في سطر الكنس: `state=READ_FAILED` برمز الخطأ (9 = FAILED_PRECONDITION) إن احتاج استعلامٌ فهرساً، وما يُفعل حينها قرار المستخدم | `functions/src/sessions/sweepExpiredSessions.js` |
| `scanClaims` بـ `where('sessionId','==',id)` داخل معاملة كتابة «منتهية» (قفل الجلسة، E32) — مساواة واحدة كما صفّ cancelScanSession أعلاه | `functions/src/sessions/sweepExpiredSessions.js` (حارس القفل) ⟵ `recordSessionExpiredIfDue` في `sessionLifecycle.js` |

> `fieldOverrides` الخاص بـ `reports.shortId` في الملف **زائد وظيفياً** (يُعلن نفس
> السلوك الافتراضي التلقائي)، لكنه مُبقىً كما هو لأن إزالته تغيير سلوكي غير
> ضروري في ملف نشره حسّاس.

## استعلامات `checkExpiringSubscriptions` — تحتاج فهارس مركّبة، **ولا يُنشأ أيّ منها قبل قرار المستخدم (القاعدة 43)**

> **لا يُنشأ فهرس `users(isActive, expiresAt)` قبل إصلاح `checkExpiringSubscriptions`، ولا فهرس `scanSessions(status, expiresAt)` كذلك** (قرار المستخدم 2026-10-14 +03، القاعدة 43، منقول من نصّ الأمر، غير متحقَّق من هذا المستودع). الإصلاح (A-SUB البند ٤-أ، 2026-10-17) **حدث في الكود**: حُذف القسم (د) كلّه، والقسم (أ) لا يصفّر الرصيد، وكل قسم في try/catch مستقلّ. **وما زال إنشاء الفهرس بقرار المستخدم بعد ذلك، لا من هذا الملفّ ولا من وحدة التحكّم.** استثناء مقصود من «قاعدة العمل» (١) أدناه («أضِفه إلى `firestore.indexes.json` أولاً»): هنا لا تُضاف الفهارس حتى يقرّر المستخدم.

| القسم | الاستعلام (`functions/src/notifications/checkExpiringSubscriptions.js`) | الفهرس اللازم (مستنتَج من شكل الاستعلام، لم يُقَس هنا) | الحالة |
|---|---|---|---|
| (أ) تعطيل المنتهين | `users` بـ `isActive == true` و`expiresAt <= now` | `users(isActive ASC, expiresAt ASC)` | **غير موجود، لا يُنشأ قبل قرار المستخدم (القاعدة 43)** |
| (ب) تذكير 3 أيام | `users` بـ `isActive == true` و`expiresAt <= threeDaysLater` و`expiresAt > now` (حقل مدى واحد بحدّين) | الفهرس نفسه `users(isActive ASC, expiresAt ASC)` | **غير موجود، لا يُنشأ قبل قرار المستخدم (القاعدة 43)** |
| (ج) رصيد منخفض | `users` بـ `isActive == true` و`scansRemaining <= 3` و`scansRemaining > 0` | `users(isActive ASC, scansRemaining ASC)` | **غير موجود، لا يُنشأ قبل قرار المستخدم (القاعدة 43)** |
| (د) جلسات منقضية — **حُذف** | كان `scanSessions` بـ `status == "pending"` و`expiresAt < now` | كان `scanSessions(status ASC, expiresAt ASC)` | **لا حاجة له بعد حذف القسم؛ ولا يُنشأ (القاعدة 43)** |

- **أثر غياب الفهارس اليوم:** المهمّة فشلت يومياً بـ«9 FAILED_PRECONDITION: The query requires an index» على `users` (`isActive` + `expiresAt`) (نصّ المستخدم، منقول عن تشخيص `abe7e7e` 2026-10-14، غير متحقَّق من هذا المستودع)؛ واستعلام (ج) بلا فهرس مُعلَن كذلك (مستنتَج، لم يُرصَد فشله بنصّه هنا). فالمهمّة لا تعطّل ولا تراسل أحداً. بعد الإصلاح: فشل قسم لا يُجهض الأقسام الأخرى، ويظهر في السجلّ سطراً مسمّى `[checkExpiringSubscriptions] section=<deactivate_expired|remind_expiring|low_balance> FAILED: …`، وسطر الخلاصة `[checkExpiringSubscriptions] done …` يكتب `FAILED` لا صفراً.
- **قيد معروف:** محاكي Firestore **لا يفرض الفهارس**، فاختبارات e2e للمهمّة (`subscription_expiry.e2e.test.js`) تنجح بلا الفهارس ولا تلتقط غيابها. التحقّق من وجودها في الإنتاج بقراءة `firebase firestore:indexes` (أمر القراءة أدناه)، لا بالاختبارات.
- **قبل إنشاء أيّ منها (بقرار المستخدم):** يراجع المستخدم أثر أوّل تشغيل (عدد من ستُعطَّل حساباتهم ويُراسَلون) بأداة العدّ بالقراءة `functions/scripts/cron-expiry-impact-readonly.js`.

## كيف تتحقّق أن المُعلَن يطابق المنشور

أمر قراءة بحت، لا يعدّل شيئاً:

```bash
firebase firestore:indexes --pretty --project neuralchek-9b6d7
```

قارن ناتجه بمصفوفة `indexes` في الملف. فرقان متوقّعان وغير مهمّين:

- **`__name__`** — يُلحقه Firestore تلقائياً بكل فهرس مركّب، واتجاهه يتبع آخر حقل
  مُصرَّح (هنا `createdAt DESCENDING` → `__name__ DESCENDING`). لا يُكتب في الملف.
- **`density: SPARSE_ALL`** — القيمة الافتراضية. لا تُكتب في الملف.

للتحقّق المتقاطع عبر gcloud:

```bash
gcloud firestore indexes composite list --project neuralchek-9b6d7
```

## قاعدة العمل

1. أي استعلام جديد يجمع **مساواة + ترتيب على حقل مختلف**، أو **مساواتين فأكثر مع
   ترتيب**، يحتاج فهرساً مركّباً → أضِفه إلى `firestore.indexes.json` **أولاً**،
   ثم انشر.
2. لا تُنشئ فهرساً من وحدة التحكّم مباشرةً (عبر رابط الخطأ) دون أن تعكسه في الملف
   في الالتزام نفسه — هذا بالضبط ما أنتج الانحراف الذي وثّقه هذا الملف.
3. قبل أي `firebase deploy --only firestore:indexes`، شغّل أمر السرد أعلاه وقارن.
   الأداة تعرض حذف ما ليس في الملف، ومع `--force` تحذفه بلا سؤال.

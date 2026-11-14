# NeuralCheck V2 — Implementation Notes

توثيق فنّي لكل sub-phase من المخطّط الجديد.
**ملاحظة**: لا git، لا commits، لا backups. العمل مباشر على `functions/index.js`.

---

## مرجع: مخطّط V2 → sub-phases

استناداً للمخطّط القسم 7.4 (Cloud Function track، 8 مهام):

| sub-phase | المهمّة | الحالة |
|---|---|---|
| 1a | حذف `computeGrades` نهائياً | ✅ |
| 1b | حذف `gradeFromScore` | ✅ |
| 1c | إعادة كتابة `buildUserMessage` (V2 payload) | ✅ |
| 1d | كتابة `computePhaseAnalysis(samples, footer)` | ✅ |
| 1e | كتابة `computeThermalTimeConstant(cooldownSamples)` | ✅ |
| 1f | كتابة `computeStorageCurveSlope(storageSamples)` | ✅ |
| 1g | كتابة `computeBurstResults(burstSamples)` | ✅ |
| 1h | التأكّد من 1MB protection | ✅ |

ملاحظة: `SYSTEM_PROMPT` V2 (Track 5) أُكمل قبل Track 4 كخطوة منفصلة.

---

## SYSTEM_PROMPT V2 (Track 5، قبل Track 4)

- استبدال كامل لـ SYSTEM_PROMPT الحالي (10,247 حرف) بنسخة V2.
- 5 أقسام: التعريف، 8 phases، تفسير المؤشّرات الحرجة، 7-step methodology، JSON schema.
- لا جداول معالجات (المخطّط 6.1: "النموذج يستدعي معرفته بنفسه").
- يحوي تحذير حرج للنموذج: "ضغطنا الجديد أثقل من stress test السابق".
- يحوي expected_performance schema (knowledge_confidence + 6 expected fields).

**الحجم النهائي**: 11,685 حرف (تجاوز target 6,500-7,500 بـ +56%).
**القرار**: قُبل من المستخدم رغم التجاوز للاحتفاظ بالشمولية.

---

## sub-phase 1a — حذف `computeGrades` نهائياً

### قبل
- block comment يحتوي 351 سطر مُعلَّق من Phase 4 السابقة (السطور 607-967)
- لا callers في الكود الفعّال

### التغيير
- حذف السطور 607-967 عبر `sed -i '607,967d'`

### بعد
- 4023 → 3662 سطر (-361)
- `grep computeGrades` يُرجع فقط 2 references في تعليقات نصّية historical (سطر 196، 1297)

---

## sub-phase 1b — حذف `gradeFromScore`

### قبل
- function `gradeFromScore` معرَّفة (السطور 578-583)
- لا callers في الكود الفعّال (gradeFromScore كان مستخدَماً مع computeGrades المحذوف)
- مرجع نصّي وحيد في تعليق (سطر 3539، historical)

### التغيير
- حذف الدالة (6 أسطر + سطر فاصل)

### بعد
- 3662 → 3655 سطر (-7)
- `gradeFromScore` غير موجود كدالة، فقط ذِكر في تعليق

### قرار جانبي
- `isBetterThan`, `isWorseThan`, `clampScore`, `getTestValue`, `GRADE_RANK` كلها dead code أيضاً (لا callers)
- تُرِكت كما هي — المخطّط 5.1 لم يطلب حذفها صراحةً
- يمكن تنظيفها لاحقاً كـ sub-phase منفصل

---

## sub-phase 1d-1g — إضافة الـ 4 helpers V2

### الموقع
أُضيفت كتلة موحَّدة بعد `computeAdditionalStats` (السطر 429)، قبل `createDeviceProfile`.

### 1d — `computePhaseAnalysis(samples, footer)` (السطر 438)
- يقرأ `s.phase` صريح (V2) — backward compat: V1 samples بدون phase تنتج `[]` فارغاً
- لكل phase 0-7، يحسب: avgCpuTemp/peakCpuTemp (من **idx 5**، الصحيح، ليس idx 1)، avgSkinTemp/peakSkinTemp (idx 18 V2)، avgCpuFreq (idx 6)، avgCpuUsage، avgPowerMw (idx 19 V2)، sampleCount، intensityFactor، throttlingActive
- 8 PHASE_NAMES: INIT_PROFILING, STORAGE_STRESS, MEMORY_STRESS, CPU_SUSTAINED, GPU_SUSTAINED, COMBINED_PEAK, BURST_PATTERN, COOLDOWN
- throttlingActive من footer.throttlingEvents المطابقة للـ phase

### 1e — `computeThermalTimeConstant(cooldownSamples)` (السطر 516)
- يحتاج >= 5 samples صالحة من Phase 7
- fit T(t) = T_end + (T_start - T_end) * exp(-t/τ)
- لكل sample وسط، يحسب τ تحليلياً ثم يأخذ median (robust ضد outliers)
- يُرجع null لو لا تبريد ملحوظ (T_start - T_end < 0.5°C)

### 1f — `computeStorageCurveSlope(storageSamples)` (السطر 554)
- يحتاج >= 5 samples من Phase 1
- يستخدم idx 20 (storage_throughput_mbps، V2 جديد)
- يقسّم لـ 5 segments، linear regression slope
- المخرج: MB/s per segment (سالب = تدهور، 0 = مستقر، موجب = تحسّن)

### 1g — `computeBurstResults(burstSamples)` (السطر 594)
- detect peaks/troughs في voltage (idx 2) عبر sliding window من 5
- threshold drop > 20mV لتجنّب noise
- يحسب recovery time حتى rebound ≤ 10mV من peak
- interpretation:
  - voltageDropAvg < 100mV → "stable_vrm"
  - 100-200mV → "marginal_vrm"
  - > 200mV → "failing_vrm"
- يُرجع كائن مع `cyclesCompleted`, `voltageDropAvg/Max`, `voltageRecoveryAvg`, `interpretation`

### Backward compatibility
كل helper يتعامل بسلاسة مع V1 fingerprints:
- لا phase field في samples → `samples.filter(s => s.phase === N)` يُرجع `[]`
- لا idx 18/19/20 → `s.v?.[N]` يُرجع `undefined` → filtered out
- النتيجة: helpers تُرجع `null` أو `[]` لـ V1 → buildUserMessage يضع `null` في الـ payload → AI يتجاهلها

---

## sub-phase 1c — إعادة كتابة `buildUserMessage` (V2 payload)

### الموقع: السطر 1142 (function definition)

### التغييرات الرئيسية vs V1

**الإضافات (top-level)**:
- `scanContext.appVersion` (من scanContext arg)
- `scanContext.scanDurationSeconds` (من timeSeries.durationSeconds أو footer)
- `scanContext.scanCompleteness` ("complete" | "early_terminated" | "thermal_protected")
- `device.buildFingerprint`, `buildBoard`, `buildHardware`, `buildBootloader`, `deviceProfileKey`
- `scanProfile` block كامل (intensityFactor, deviceTierMeasured, tempRiseRateInProbe, throttlingEventsCount, earlyTerminatedPhases)
- `phaseAnalysis` array (يستدعي `computePhaseAnalysis`، 8 عناصر لـ V2)
- `burstPatternResults` (من `computeBurstResults` على Phase 6)
- `verificationResults` (من footer.verificationResults أو fingerprint.verificationResults، مع منطق `criticalDefectDetected` المحسوب)

**الإضافات في rawReadings**:
- `thermal.tempThermalTimeConstant` (من `computeThermalTimeConstant` على Phase 7)
- `thermal.skinTempPeak/skinTempAvg` (V2)
- `cpu.cpuFreqIdleBig/Little/Mid`, `cpuFreqMax`, `cpuFreqMinStress`, `cpuFreqStableSustained` (محسوب inline من Phase 3 آخر 30s)
- `gpu.gpuFpsValidPct`, `gpuFpsStability`
- `battery.currentPeakStress`, `voltageMin`, `voltageDrop`, `peakPowerMw`
- `memory` block جديد (bandwidthAvgMbps, bandwidthPeakMbps)
- `storage` block (throughputAvgMbps, throughputPeakMbps, throughputCurveSlope)
- `sensors` block (gravityMagnitudeAvg, gravityAccuracy, gyroIdleNoise)

**Backward compatibility**:
- كل الحقول الجديدة تستخدم `?? null` كـ default
- V1 fingerprints بدون verificationResults → الحقل = null → AI يتجاهله
- V1 samples بدون phase field → phaseAnalysis = `[]` → null في الـ payload
- لا breaking changes للتطبيقات القديمة

### عدد الأسطر بعد كل sub-phase
| sub-phase | قبل | بعد | فرق |
|---|---|---|---|
| 1a (حذف computeGrades) | 4023 | 3662 | -361 |
| 1b (حذف gradeFromScore) | 3662 | 3655 | -7 |
| 1d-1g (4 helpers) | 3655 | 3898 | +243 |
| 1c (rewrite buildUserMessage) | 3898 | 4037 | +139 |
| **النهائي** | **4023** | **4037** | **+14** |

---

## sub-phase 1h — تحقّق 1MB protection

### الحالة
- `lightenFingerprintForStorage` (السطر 41-49) يحذف `timeSeries.samples` قبل الحفظ في Firestore
- استدعاؤه في analyzeDevice (السطر 1854): `rawFingerprint: lightenFingerprintForStorage(fingerprint)`

### تقدير حجم Firestore document بعد lightening
| الحقل | تقدير |
|---|---|
| rawFingerprint بدون samples (stats + footer + variables + meta) | ~5 KB |
| aiResponse (grade، score، issues، expected_performance، إلخ) | ~5-10 KB |
| verificationResults، scanProfile، burstPatternResults | ~3 KB |
| device + functionalResults + manualResults | ~10 KB |
| **المجموع** | **~25-30 KB** |

تحت حد 1MB بفارق ~33×. ✅ آمن.

### ملاحظة على V2 الجديد
- `footer.throttlingEvents` (مصفوفة الأحداث) قد تكبر إلى 1-2 KB في الفحوصات الطويلة → ضمن الهامش
- `verificationResults.memoryBytesTested` رقم واحد، لا تأثير
- لا يوجد حقل V2 جديد بحجم سامبلز

### قرار
لا تعديل مطلوب على lightenFingerprintForStorage. التغطية كافية.

---

## التحقّق النهائي

```
node -c index.js                  → SYNTAX_OK
عدد الأسطر النهائي                → 4037
4 V2 helpers معرَّفة                → ✅ (438, 516, 554, 594)
4 V2 helpers مُستدعاة في buildUserMessage → ✅ (1172, 1178, 1180, 1182)
lightenFingerprintForStorage فعّال → ✅ (1854)
computeGrades                     → ❌ غير موجود (محذوف 1a)
gradeFromScore                    → ❌ غير موجود (محذوف 1b)
```

---

## انحرافات/قرارات تستحق الذكر

1. **SYSTEM_PROMPT حجمه 11,685 حرف بدل 6,500-7,500**: قُبل من المستخدم.

2. **`isBetterThan/isWorseThan/clampScore/getTestValue/GRADE_RANK` لم تُحذَف**: dead code، لكن المخطّط 5.1 لم يطلب حذفها صراحةً. يمكن تنظيفها مستقبلاً.

3. **`rebuildCategoryScores` تبقى**: المخطّط 5.1 يقترح حذفها لكن DTO Kotlin يتطلب pass_count/total_count/score الذي لا يُنتجه AI مباشرةً (AI ينتج grade + expected_range + verdict فقط، حسب schema الجديد). rebuildCategoryScores تبقى كـ bridge.

4. **`computeAdditionalStats` تبقى أيضاً**: للـ V1 backward compat. الـ helpers الجديدة (1d-1g) تتفوّق عليها لـ V2 لكن الـ V1 لا يحوي phase field.

5. **`cpuFreqStableSustained` محسوب inline** في buildUserMessage (ليس helper منفصل)، يقرأ آخر 30s من Phase 3.

6. **No git, no commits, no backups**: حسب تعليمة المستخدم. كل العمل مباشر على main code.

---

## الفحص العملي المتوقع

عند فحص V2 الأول من تطبيق Android:
- samples تحوي phase field 0-7 + 22 متغيراً
- footer يحوي intensityFactor + verificationResults + throttlingEvents
- buildUserMessage يستخدم الـ 4 helpers لإنتاج phaseAnalysis (8 elements)، burstPatternResults، thermalTimeConstant، storageCurveSlope
- AI يستلم payload V2 الكامل + SYSTEM_PROMPT V2 (11,685 char)
- AI يُنتج `expected_performance` + `category_scores` بـ grade/expected_range/verdict
- `rebuildCategoryScores` يُضيف pass_count/total_count من functionalResults + يشتقّ score
- التقرير يُحفَظ في Firestore بعد lightening (~25-30 KB)

عند فحص V1 (تطبيق قديم):
- samples بدون phase field
- لا footer V2
- buildUserMessage ينتج payload بـ معظم الحقول الجديدة = null
- AI يتعامل بسلاسة (تجاهل null fields حسب SYSTEM_PROMPT rule 4)
- التقرير يُحفَظ كالمعتاد

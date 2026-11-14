'use strict';

// ===================================================================
// matrixProfile.js — Matrix Profile لسلسلة واحدة وأعلى discord فيها (V8 / PLAN-05 §٣ L-4، الصفّ S-B5)
// ===================================================================
// «L-4 شذوذ داخل المرحلة: Matrix Profile لكل قناة كثيفة **داخل المرحلة وحدها** (حدود المراحل ليست شذوذاً [خبير §٤])، وأعلى discord.
//  والنافذة 10 ث (40 عيّنة) [اجتهاد]» (plan/PLAN-05-EVIDENCE-REPORT.md :336). دالّة خالصة: بلا شبكة ولا حالة مشتركة ولا استثناء لمُدخل رديء.
//
// التعريف المعتمَد هنا (المسافة الإقليدية على نوافذ مطبَّعة بالـz، كل نافذة بمتوسّطها وانحرافها المعياري السكاني):
//   • profile[i] = أقرب مسافة من النافذة i إلى نافذة j حيث |i − j| ≥ exclusionZone (استثناء المباريات التافهة).
//   • الـdiscord = النافذة ذات أكبر profile (أبعد نافذة عن أقرب جار لها).
//   • النافذة الثابتة (كل قيمها متساوية بالضبط) تُطبَّع إلى المتّجه الصفري — فتكون مسافتها إلى ثابتة أخرى 0، وإلى نافذة متغيّرة √m
//     (لأن ‖z‖² = m لكل نافذة متغيّرة)؛ وهو تعريف stumpy نفسه للنوافذ الثابتة. لا قسمة على صفر ولا NaN.
//   • النافذة بلا جار خارج منطقة الاستثناء: profile[i] = null ولا تدخل ترتيب الـdiscord (الغياب لا يُقرأ مسافةً صفراً — القاعدة 22).
//   • أيّ عيّنة غير رقمية/غير منتهية في السلسلة ⟵ لا يُحسب شيء ويُعلَن السبب (لا إسقاط صامت يكسر تجاور النوافذ).
//   • التعادل على أعلى مسافة يحسمه أصغر فهرس (حتمي).
//
// المرجع المستقلّ للاختبار الذهبي: test/fixtures/feature-library/reference_feature_library.py (بايثون، تنفيذ مستقلّ بالخوارزمية نفسها).

function zNormalizeWindow(x, start, m) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let k = 0; k < m; k++) {
    const v = x[start + k];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const z = new Float64Array(m);
  if (min === max) return {z, flat: true};
  const mean = sum / m;
  let sq = 0;
  for (let k = 0; k < m; k++) {
    const d = x[start + k] - mean;
    sq += d * d;
  }
  const sd = Math.sqrt(sq / m);
  for (let k = 0; k < m; k++) z[k] = (x[start + k] - mean) / sd;
  return {z, flat: false};
}

/**
 * @param {number[]} series سلسلة قناة داخل مرحلة واحدة (أرقام منتهية فقط).
 * @param {number} m طول النافذة بالعيّنات (عدد صحيح ≥ 2).
 * @param {number} exclusionZone عدد صحيح ≥ 1: يُستثنى كل جار |i − j| < exclusionZone.
 * @return {Object} {ok, reason?, nSubsequences, nWithNeighbor, flatSubsequences, discord: {index, distance, neighborIndex}|null, profile}
 */
function matrixProfileDiscord(series, m, exclusionZone) {
  if (!Array.isArray(series)) return {ok: false, reason: 'SERIES_NOT_AN_ARRAY'};
  if (!Number.isInteger(m) || m < 2) return {ok: false, reason: 'WINDOW_INVALID'};
  if (!Number.isInteger(exclusionZone) || exclusionZone < 1) return {ok: false, reason: 'EXCLUSION_ZONE_INVALID'};
  for (let i = 0; i < series.length; i++) {
    if (typeof series[i] !== 'number' || !Number.isFinite(series[i])) return {ok: false, reason: 'NON_NUMERIC_SAMPLE', index: i};
  }
  const n = series.length;
  const subs = n - m + 1;
  if (subs < 1) return {ok: false, reason: 'SERIES_SHORTER_THAN_WINDOW', nSubsequences: 0};

  const Z = new Array(subs);
  let flatCount = 0;
  for (let i = 0; i < subs; i++) {
    const w = zNormalizeWindow(series, i, m);
    Z[i] = w.z;
    if (w.flat) flatCount++;
  }

  const best = new Array(subs).fill(Infinity);
  const bestNeighbor = new Array(subs).fill(-1);
  for (let i = 0; i < subs; i++) {
    const zi = Z[i];
    for (let j = i + exclusionZone; j < subs; j++) {
      const zj = Z[j];
      let d2 = 0;
      for (let k = 0; k < m; k++) {
        const d = zi[k] - zj[k];
        d2 += d * d;
      }
      // المقارنة على المسافة بعد الجذر (لا على مربّعها) كي تُحسم التعادلات (نوافذ متطابقة بالحساب الدقيق) بالطريقة نفسها في أيّ تنفيذ يقارن المسافة نهائياً — المرجع المستقلّ بايثون
      // يفعل ذلك — ويكون الجار الأقرب عند التعادل أصغر فهرس (الحلقة تصاعدية ولا تُبدَّل القيمة إلا بأصغر تماماً).
      const d = Math.sqrt(d2);
      if (d < best[i]) {
        best[i] = d;
        bestNeighbor[i] = j;
      }
      if (d < best[j]) {
        best[j] = d;
        bestNeighbor[j] = i;
      }
    }
  }

  const profile = new Array(subs);
  let nWithNeighbor = 0;
  let discord = null;
  for (let i = 0; i < subs; i++) {
    if (bestNeighbor[i] === -1) {
      profile[i] = null;
      continue;
    }
    nWithNeighbor++;
    profile[i] = best[i];
    if (discord === null || profile[i] > discord.distance) discord = {index: i, distance: profile[i], neighborIndex: bestNeighbor[i]};
  }
  return {ok: true, nSubsequences: subs, nWithNeighbor, flatSubsequences: flatCount, discord, profile};
}

module.exports = {matrixProfileDiscord, zNormalizeWindow};

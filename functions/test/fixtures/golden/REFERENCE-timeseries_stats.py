#!/usr/bin/env python3
"""
timeseries_stats.py — يحسب من s10-timeseries.json و honor-timeseries.json كل رقم يُستشهد به
في ملفّات PLAN-*.md. لا يقرأ أي رقم من التذييل إلا للمقارنة (المفاتيح المنتهية بـ _footer).

الاستعمال: python scripts/timeseries_stats.py
المخرَج:   scripts/out/timeseries_stats.json + ملخّص مطبوع.
"""
import sys as _sys
try:
    _sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
import json, math, statistics as st
from collections import Counter, defaultdict

FILES = {'s10': 's10-timeseries.json', 'honor': 'honor-timeseries.json'}
PHASE_NAMES = {0: 'INIT', 1: 'STORAGE', 2: 'MEMORY', 3: 'CPU_SUSTAINED', 4: 'GPU_SUSTAINED',
               5: 'COMBINED', 6: 'BURST', 7: 'COOLDOWN'}


def pstd(xs):
    return st.pstdev(xs) if len(xs) > 1 else 0.0


def pct(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * q
    f, c = math.floor(k), math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)


def changes(seq):
    """عدد المرّات التي تغيّرت فيها القيمة عن العيّنة السابقة = كادنس تحديث المصدر الفعلي."""
    return sum(1 for a, b in zip(seq, seq[1:]) if a != b)


def analyze(path):
    d = json.load(open(path, encoding='utf-8'))
    S, F, H = d['samples'], d['footer'], d['header']
    R = {'file': path, 'device': H['deviceModel'], 'api': H['androidApiLevel']}
    n = len(S)
    t = [s['v'][0] for s in S]
    ph = [s['phase'] for s in S]

    def col(i):
        return [s['v'][i] for s in S]

    temp, volt, cur, lvl, freq, usage, pwr, sto, mem, fps = (col(i) for i in range(1, 11))

    def in_phases(seq, ps):
        return [seq[i] for i in range(n) if ph[i] in ps]

    # ---- 1. الأساسيات والتوقيت
    R['totalSamples'] = n
    R['expectedSamples_footer'] = F['expectedSamples']
    R['wall_ms'] = F['endTimestamp'] - H['startTimestamp']
    R['v0_first_ms'], R['v0_last_ms'] = t[0], t[-1]
    R['sample0_phase'] = ph[0]
    dts = [b - a for a, b in zip(t, t[1:])]
    R['dt_max_ms'], R['dt_min_ms'] = max(dts), min(dts)
    R['phase_counts'] = {PHASE_NAMES[p]: c for p, c in sorted(Counter(ph).items())}
    R['phase_span_s'] = {}
    for p in range(8):
        idx = [i for i in range(n) if ph[i] == p]
        if idx:
            R['phase_span_s'][PHASE_NAMES[p]] = round((t[idx[-1]] - t[idx[0]]) / 1000, 1)

    # ---- 2. كادنس القنوات البطيئة
    R['cadence'] = {}
    for name, seq in (('battery_temp', temp), ('battery_voltage', volt), ('battery_level', lvl),
                      ('battery_current', cur), ('cpu_freq', freq)):
        R['cadence'][name] = {
            'changes_whole_scan': changes(seq),
            'changes_phases_3_5': changes(in_phases(seq, {3, 4, 5})),
            'distinct_values_whole_scan': len(set(seq)),
            'distinct_values_phases_3_5': len(set(in_phases(seq, {3, 4, 5}))),
        }

    def change_times(seq):
        return [round(t[i] / 1000) for i in range(1, n) if seq[i] != seq[i - 1]]

    R['temp_change_times_s'] = change_times(temp)
    R['voltage_change_times_s'] = change_times(volt)
    R['level_change_times_s'] = change_times(lvl)
    R['level_values_at_changes'] = [lvl[i] for i in range(1, n) if lvl[i] != lvl[i - 1]]
    R['temp_values_at_changes'] = [temp[i] for i in range(1, n) if temp[i] != temp[i - 1]]

    # ---- 3. الجهد
    v35 = in_phases(volt, {3, 4, 5})
    R['voltageStabilityMv_recomputed'] = round(pstd(v35), 2)
    R['voltageStabilityMv_footer'] = F['batteryHealth']['voltageStabilityMv']
    R['voltage_distinct_phases_3_5'] = sorted(set(v35))

    # ---- 4. الحرارة
    R['temp_start'], R['temp_max'] = temp[0], max(temp)
    imax = temp.index(max(temp))
    R['temp_max_time_s'] = round(t[imax] / 1000)
    R['temp_max_phase'] = PHASE_NAMES[ph[imax]]
    R['temp_rise'] = round(max(temp) - temp[0], 2)
    R['temp_resolution'] = min(abs(b - a) for a, b in zip(temp, temp[1:]) if b != a) if changes(temp) else None
    R['batteryTempMaxC_footer'] = F['batteryHealth']['batteryTempMaxC']
    R['temp_rise_rate_c_per_min_whole_scan'] = round((max(temp) - temp[0]) / (R['wall_ms'] / 60000), 3)
    i35 = [i for i in range(n) if ph[i] in {3, 4, 5}]
    R['temp_rise_rate_c_per_min_phases_3_5'] = round(
        (temp[i35[-1]] - temp[i35[0]]) / ((t[i35[-1]] - t[i35[0]]) / 60000), 3)
    i7 = [i for i in range(n) if ph[i] == 7]
    R['temp_phase7_start_end'] = [temp[i7[0]], temp[i7[-1]]]

    # ---- 5. التيار والقدرة
    c35 = [abs(x) for x in in_phases(cur, {3, 4, 5})]
    R['dischargeRateUnderLoadMa_recomputed'] = round(st.mean(c35) / 1000, 2)
    R['dischargeRateUnderLoadMa_footer'] = F['batteryHealth']['dischargeRateUnderLoadMa']
    R['current_sign_positive_count'] = sum(1 for x in cur if x > 0)
    R['current_zero_count'] = sum(1 for x in cur if x == 0)
    c6 = in_phases(cur, {6})
    R['phase6_current_repeat_fraction'] = round(
        sum(1 for a, b in zip(c6, c6[1:]) if a == b) / max(1, len(c6) - 1), 3)
    R['mean_abs_current_ma_whole'] = round(st.mean(abs(x) for x in cur) / 1000, 1)
    i0 = [i for i in range(n) if ph[i] == 0]
    R['mean_abs_current_ma_phase0_first10s'] = round(
        st.mean(abs(cur[i]) for i in i0 if t[i] <= t[i0[0]] + 10000) / 1000, 1)
    R['mean_abs_current_ma_phase0_last10s'] = round(
        st.mean(abs(cur[i]) for i in i0 if t[i] >= t[i0[-1]] - 10000) / 1000, 1)
    R['peak_power_mw_phase3'] = max(in_phases(pwr, {3}))
    R['peak_power_mw_phase5'] = max(in_phases(pwr, {5}))
    R['peak_power_mw_footer'] = [F['stressEffectiveness']['peakPackagePowerMwPhase3'],
                                 F['stressEffectiveness']['peakPackagePowerMwPhase5']]
    R['mean_power_mw_phase4'] = round(st.mean(in_phases(pwr, {4})))
    R['mean_power_mw_phase0'] = round(st.mean(in_phases(pwr, {0})))

    # ---- 6. تكامل الشحنة والسعة الضمنية عند انتقالات النسبة
    def coulomb_mah(i0_, i1_):
        acc = 0.0
        for i in range(i0_, i1_):
            acc += (abs(cur[i]) + abs(cur[i + 1])) / 2 * (t[i + 1] - t[i]) / 1000
        return acc / 3600 / 1000

    R['coulomb_whole_scan_mah'] = round(coulomb_mah(0, n - 1), 1)
    design = F['batteryHealth']['designCapacityMah']
    drop = H['batteryLevelStart'] - F['batteryLevelEnd']
    R['designCapacityMah_footer'] = design
    R['levelDrop_pct'] = drop
    R['levelDrop_x_design_mah'] = drop / 100 * design
    R['levelDrop_x_design_range_mah'] = [max(0, drop - 1) / 100 * design, (drop + 1) / 100 * design]
    R['level_x_design_over_coulomb'] = round(R['levelDrop_x_design_mah'] / R['coulomb_whole_scan_mah'], 2)
    trans = [i for i in range(1, n) if lvl[i] != lvl[i - 1]]
    ests = []
    for a, b in zip(trans, trans[1:]):
        q = coulomb_mah(a, b)
        ests.append({'from_s': round(t[a] / 1000), 'to_s': round(t[b] / 1000), 'mah_per_pct': round(q, 2),
                     'implied_capacity_mah': round(q * 100), 'implied_ratio_to_design': round(q * 100 / design, 3)})
    R['implied_capacity_from_level_steps'] = ests
    R['implied_capacity_n_intervals'] = len(ests)
    if ests:
        R['implied_capacity_mean_mah'] = round(st.mean(e['implied_capacity_mah'] for e in ests))
        R['implied_capacity_mean_ratio_to_design'] = round(R['implied_capacity_mean_mah'] / design, 3)
    cc = F['batteryHealth']['chargeCounterUah']
    R['chargeCounterUah_footer'] = cc
    R['chargeCounter_as_uAh_over_design_x_levelEnd'] = round((cc / 1000) / (design * F['batteryLevelEnd'] / 100), 3)
    R['chargeCounter_as_mAh_over_design_x_levelEnd'] = round(cc / (design * F['batteryLevelEnd'] / 100), 3)

    # ---- 7. التردد
    peak = max(freq)
    R['peak_freq_khz'] = peak
    R['peak_freq_footer'] = F['stressEffectiveness']['peakBigFreqKhzAnywhere']
    R['freq_by_phase'] = {}
    for p in range(8):
        fp = in_phases(freq, {p})
        if fp:
            R['freq_by_phase'][PHASE_NAMES[p]] = {
                'n': len(fp), 'mean_mhz': round(st.mean(fp) / 1000), 'max_mhz': round(max(fp) / 1000),
                'min_mhz': round(min(fp) / 1000), 'median_mhz': round(st.median(fp) / 1000),
                'mean_ratio_to_peak': round(st.mean(fp) / peak, 3), 'max_ratio_to_peak': round(max(fp) / peak, 3)}
    f3 = in_phases(freq, {3})
    f5 = in_phases(freq, {5})
    f6 = in_phases(freq, {6})
    f7 = in_phases(freq, {7})
    R['phase3CpuFreqRatio_recomputed'] = round(st.mean(f3) / peak, 4)
    R['phase3CpuFreqRatio_footer'] = F['stressEffectiveness']['phase3CpuFreqRatio']
    early, late = st.mean(f3[:10]), st.mean(f3[-10:])
    R['C06_early_vs_late_pct'] = round(max(0.0, (1 - late / early) * 100), 2)
    R['C07_rsd_pct'] = round(pstd(f3) / st.mean(f3) * 100, 2)
    R['drop_phase3_mean_vs_peak_pct'] = round((1 - st.mean(f3) / peak) * 100, 1)
    R['drop_phase6_max_vs_peak_pct'] = round((1 - max(f6) / peak) * 100, 1)
    R['recovery_phase7_max_ratio'] = round(max(f7) / peak, 3)

    def window_stats(ps, win_ms=5000):
        idx = [i for i in range(n) if ph[i] in ps]
        if not idx:
            return None
        t0 = t[idx[0]]
        b = defaultdict(list)
        for i in idx:
            b[int((t[i] - t0) // win_ms)].append(freq[i])
        maxes = [max(v) for v in b.values()]
        return {'windows': len(maxes), 'mean_window_max_ratio': round(st.mean(maxes) / peak, 3),
                'min_window_max_ratio': round(min(maxes) / peak, 3),
                'median_window_max_ratio': round(st.median(maxes) / peak, 3)}

    R['sustained_ceiling_phase3'] = window_stats({3})
    R['sustained_ceiling_phase5'] = window_stats({5})
    R['sustained_ceiling_phases_3_5'] = window_stats({3, 5})
    R['sustained_ceiling_phase6'] = window_stats({6})
    for thr in (2600, 2340, 2000):
        idxs = [i for i in range(n) if freq[i] >= thr * 1000]
        R[f'last_time_freq_ge_{thr}MHz_s'] = round(t[idxs[-1]] / 1000) if idxs else None
    R['phase3_freq_mode_mhz'] = Counter(round(x / 1000) for x in f3).most_common(4)
    R['freq_drop_burst_to_sustained_prompt_formula_pct'] = round((st.mean(f6) - st.mean(f3)) / st.mean(f6) * 100, 1)
    R['freqDropFromBurstToSustainedPct_footer'] = F['stressEffectiveness']['freqDropFromBurstToSustainedPct']
    R['throttlingEvents_footer'] = F['throttlingEvents']
    R['thermalStatusMax_footer'] = F['thermalStatusMax']
    R['thermalHeadroomPeak_footer'] = F['thermalHeadroomPeak']
    R['governorCappingDetected_footer'] = F['stressEffectiveness']['governorCappingDetected']
    R['satGrade_footer'] = F['stressEffectiveness']['satGrade']
    # C-03 التقريبي: وسيط v[5] في أول 10 ث من المرحلة 0 (للمقارنة مع A60)
    R['phase0_first10s_freq_median_mhz'] = round(st.median(freq[i] for i in i0 if t[i] <= t[i0[0]] + 10000) / 1000, 2)
    R['phase0_freq_median_mhz'] = round(st.median(in_phases(freq, {0})) / 1000, 2)

    # ---- 8. الاستخدام
    R['usage_mean_phase3'] = round(st.mean(in_phases(usage, {3})), 1)
    R['cpuUsageSource_footer'] = F['dataQuality']['cpuUsageSource']
    R['usage_mean_phase0_last10s'] = round(st.mean(usage[i] for i in i0 if t[i] >= t[i0[-1]] - 10000), 1)

    # ---- 9. الرسوميات
    R['gpu_fps_nonzero_by_phase'] = {}
    for p in range(8):
        fp = [fps[i] for i in range(n) if ph[i] == p and fps[i] > 0]
        if fp:
            R['gpu_fps_nonzero_by_phase'][PHASE_NAMES[p]] = {
                'n_nonzero': len(fp), 'median': round(st.median(fp), 1), 'p10': round(pct(fp, .1), 1),
                'p90': round(pct(fp, .9), 1), 'min': round(min(fp), 1), 'max': round(max(fp), 1)}
    leak3 = [(i, round(fps[i], 2), round(t[i] / 1000, 1)) for i in range(n) if ph[i] == 3 and fps[i] > 0]
    R['gpu_fps_phase3_leak_samples'] = leak3
    last3 = max(i for i in range(n) if ph[i] == 3)
    R['phase3_last_index'] = last3
    if leak3:
        vals = [v for _, v, _ in leak3]
        R['G03_from_phase3_window_pct'] = round((max(vals) - min(vals)) / max(vals) * 100, 2)
        R['G04_from_phase3_window_pct'] = round((vals[0] - min(vals)) / vals[0] * 100, 2)
        R['G05_from_phase3_window'] = round(min(vals))
    p45 = [fps[i] for i in range(n) if ph[i] in {4, 5} and fps[i] > 0]
    if p45:
        R['G03_if_window_were_phases_4_5_pct'] = round((max(p45) - min(p45)) / max(p45) * 100, 1)
        R['fps_in_60_band_fraction'] = round(sum(1 for x in p45 if 58 <= x <= 62) / len(p45), 3)
        R['fps_in_90_band_fraction'] = round(sum(1 for x in p45 if 85 <= x <= 95) / len(p45), 3)
        R['fps_in_120_band_fraction'] = round(sum(1 for x in p45 if 115 <= x <= 125) / len(p45), 3)
    p4 = [fps[i] for i in range(n) if ph[i] == 4 and fps[i] > 0]
    p5 = [fps[i] for i in range(n) if ph[i] == 5 and fps[i] > 0]
    if p4 and p5:
        R['fps_median_phase5_over_phase4'] = round(st.median(p5) / st.median(p4), 3)
    R['gpuRenderCompletionMs_footer'] = [F['verificationResults']['gpuRenderCompletionMsCold'],
                                         F['verificationResults']['gpuRenderCompletionMsWarm']]
    R['gpuFenceTimeoutCount_footer'] = F['verificationResults']['gpuFenceTimeoutCount']
    R['gpu_fps_nonzero_outside_4_5'] = [(i, PHASE_NAMES[ph[i]], round(fps[i], 1)) for i in range(n)
                                        if fps[i] > 0 and ph[i] not in {4, 5}]

    # ---- 10. التخزين
    s1 = [sto[i] for i in range(n) if ph[i] == 1 and sto[i] > 0]
    R['storage_v8_nonzero_count_phase1'] = len(s1)
    R['storage_v8_distinct_values_phase1'] = len(set(s1))
    segs = [x['mbps'] for x in F['verificationResults']['storageThroughputSegments']]
    R['storage_segments_mbps'] = [round(x, 1) for x in segs]
    R['storage_segments_harmonic_mean'] = round(len(segs) / sum(1 / x for x in segs), 1)
    R['storage_segments_first4_mean'] = round(st.mean(segs[:4]), 1)
    R['storage_bytes_over_duration_mbps'] = round(
        F['verificationResults']['storageBytesWritten'] / F['verificationResults']['storageWriteDurationMs'] / 1000, 1)
    collapse = None
    for k in range(2, len(segs)):
        if segs[k] <= 0.5 * st.median(segs[:k]):
            collapse = {'segment_index': k,
                        'cumulative_gb': round(F['verificationResults']['storageThroughputSegments'][k]['cumulativeBytes'] / 2 ** 30, 2),
                        'mbps': round(segs[k], 1)}
            break
    R['storage_collapse_detector'] = collapse
    R['storageSlcCacheSizeMb_footer'] = F['verificationResults']['storageSlcCacheSizeMb']
    R['storage_write_duration_s'] = F['verificationResults']['storageWriteDurationMs'] / 1000
    R['storage_phase1_idle_fraction'] = round(1 - R['storage_write_duration_s'] / 75, 2)

    # ---- 11. الذاكرة
    m2 = [mem[i] for i in range(n) if ph[i] == 2 and mem[i] > 0]
    R['memory_v9_nonzero_mean_phase2'] = round(st.mean(m2), 1) if m2 else None
    R['memory_bytes_over_phase2_span_mbps'] = round(
        F['verificationResults']['memoryTestedBytes'] / R['phase_span_s']['MEMORY'] / 1e6, 1)

    # ---- 12. بوّابات الأدلّة
    gates = {}

    def gate(name, nS, upd):
        gates[name] = {'nSamples': nS, 'sourceCadenceUpdates': upd, 'passes': bool(nS >= 40 and upd >= 5)}

    gate('voltageStabilityMv (v[2] phases 3-5)', len(v35), changes(v35))
    gate('batteryTempRise (v[1] whole scan)', n, changes(temp))
    gate('B-06 levelDrop (v[4] whole scan)', n, changes(lvl))
    gate('C-06/C-07 (v[5] phase 3)', len(f3), changes(f3))
    gate('G-03..05 current window (v[10] phase 3 nonzero)', len(leak3), changes([v for _, v, _ in leak3]))
    gate('G-03..05 proposed window (v[10] phases 4+5 nonzero)', len(p45), changes(p45))
    gate('dischargeRateUnderLoad (v[3] phases 3-5)', len(c35), changes(c35))
    gate('sustained ceiling (v[5] phases 3+5)', len(f3) + len(f5), changes(f3 + f5))
    gate('coulomb per 1% step (v[4] transitions >= 2 intervals)', len(trans), len(ests))
    R['evidence_gates'] = gates
    return R


if __name__ == '__main__':
    out = {k: analyze(v) for k, v in FILES.items()}
    json.dump(out, open('scripts/out/timeseries_stats.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k, R in out.items():
        print('=' * 30, k, R['device'])
        for kk, vv in R.items():
            if isinstance(vv, dict) and vv and isinstance(next(iter(vv.values())), dict):
                print(f'{kk}:')
                for a, b in vv.items():
                    print(f'    {a}: {b}')
            elif kk == 'implied_capacity_from_level_steps':
                print(f'{kk}:')
                for e in vv:
                    print(f'    {e}')
            else:
                print(f'{kk}: {vv}')

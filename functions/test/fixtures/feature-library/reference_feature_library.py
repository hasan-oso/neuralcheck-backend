#!/usr/bin/env python3
# reference_feature_library.py -- independent reference for functions/src/analysis/featureLibrary.js and moments.js (S-B5, 2026-10-21)
#
# WHY: rule 41/30/39 want a golden test that does not use the code under test to produce the expected numbers. This is a plain-Python
# re-implementation (no numpy, no JS) of the formulas written in plan/PLAN-05-EVIDENCE-REPORT.md :266-286 (features) and :331-337 (moments),
# run on the four REAL device fingerprints in ../golden/*.ts.json (and, for L-5 only, on the real-producer fv71 payloads).
#
# It is NOT part of the test suite (no python in CI). The expected numbers are frozen in expected_feature_library.json next to it;
# test/featureLibrary.test.js compares the JS output with that JSON. Re-run only when a formula or a threshold changes (and bump
# FEATURE_SET_VERSION in functions/src/analysis/featureNames.js in the same commit):
#   python reference_feature_library.py > expected_feature_library.json   (run from this directory)
#
# CHOICES that are mine, not in the plan (reported in the order report): L-1 partial-last-window rule, exclusion zone = ceil(m/2),
# L-3 neighbour values, L-4 channel list. (F5 is the literal whole-scan reading, cross-checked with last_time_freq_ge_2600MHz_s in ../golden/EXPECTED-timeseries_stats*.json.)
import json, math, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GOLD = os.path.join(HERE, '..', 'golden')
EVIDENCE_MIN_SAMPLES = 40
EVIDENCE_MIN_CADENCE_UPDATES = 5
PEAK_HOLD_FRACTION = 0.95
SUSTAINED_DROP_FRACTION = 0.9
WINDOW_MS = 5000
ANOMALY_WINDOW = 40
EXCLUSION_ZONE = math.ceil(ANOMALY_WINDOW * 0.5)
RES_MIN_POWER_W = 2.0
RES_BASELINE_MS = 5000
FILES = ['8909e850-s10.ts.json', 'e4b65a2f-honor.ts.json', 'b45c8cf6.ts.json', '34dff2b8.ts.json']
FV71 = ['fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json',
        'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json']


def changes(seq):
    return sum(1 for i in range(1, len(seq)) if seq[i] != seq[i - 1])


def gate(n, c):
    return n >= EVIDENCE_MIN_SAMPLES and c >= EVIDENCE_MIN_CADENCE_UPDATES


def load(name):
    with open(os.path.join(GOLD, name), encoding='utf-8') as f:
        j = json.load(f)
    return j.get('timeSeries', j)


def columns(ts):
    names = [v['name'] for v in ts['variables']]
    units = {v['name']: v.get('unit') for v in ts['variables']}
    idx = {n: i for i, n in enumerate(names)}
    samples = ts['samples']
    return samples, (lambda n: [s['v'][idx[n]] for s in samples]), units


def phase_idx(samples, p):
    return [i for i, s in enumerate(samples) if s['phase'] == p]


def sustained_peak(ts, freq):
    pk = (ts['footer'].get('stressEffectiveness') or {}).get('peakBigFreqKhzAnywhere')
    return pk if isinstance(pk, (int, float)) else max(freq)


def combined_gate(samples, freq):
    idx = [i for i, s in enumerate(samples) if s['phase'] in (3, 5)]
    return gate(len(idx), changes([freq[i] for i in idx]))


def peak_hold(samples, t, freq, peak):
    # F5: last instant (seconds since scan start, whole scan) at which the big-core frequency is >= 0.95 x peak (plan :272)
    if not gate(len(samples), changes(freq)):
        return {'gate': False}
    thr = PEAK_HOLD_FRACTION * peak
    last = -1
    for i in range(len(samples)):
        if freq[i] >= thr:
            last = i
    if last == -1:
        return {'gate': True, 'value': None}
    return {'gate': True, 'value': t[last] / 1000.0}


def energy_wh(t, volt, cur):
    j = 0.0
    for i in range(len(t) - 1):
        p0 = abs(volt[i] * 1e-3 * cur[i] * 1e-6)
        p1 = abs(volt[i + 1] * 1e-3 * cur[i + 1] * 1e-6)
        j += (p0 + p1) / 2 * (t[i + 1] - t[i]) * 1e-3
    return j / 3600.0


def thermal_resistance(samples, t, temp, power):
    idx0 = phase_idx(samples, 0)
    idx5 = phase_idx(samples, 5)
    if not idx0 or len(idx5) < EVIDENCE_MIN_SAMPLES:
        return None
    t0 = t[idx0[0]]
    base = [temp[i] for i in idx0 if t[i] - t0 <= RES_BASELINE_MS and temp[i] > 0]
    temps5 = [temp[i] for i in idx5 if temp[i] > 0]
    pw5 = [power[i] for i in idx5 if power[i] > 0]
    if not base or not temps5 or not pw5:
        return None
    mean_w = (sum(pw5) / len(pw5)) * 1e-3
    if mean_w < RES_MIN_POWER_W:
        return None
    return (max(temps5) - sum(base) / len(base)) / mean_w


def sustained_drop(samples, t, freq, peak, phase):
    idx = phase_idx(samples, phase)
    if not idx or not gate(len(idx), changes([freq[i] for i in idx])):
        return {'measured': False}
    t0 = t[idx[0]]
    buckets = {}
    order = []
    for i in idx:
        k = math.floor((t[i] - t0) / WINDOW_MS)
        if k not in buckets:
            buckets[k] = []
            order.append(k)
        buckets[k].append(freq[i])
    last_key = order[-1]
    dts = [t[idx[k]] - t[idx[k - 1]] for k in range(1, len(idx))]
    med_dt = statistics.median(dts) if dts else 0
    t_last = t[idx[-1]] - t0
    last_partial = t_last < (last_key + 1) * WINDOW_MS - med_dt
    wins = [(k, max(buckets[k]) / peak) for k in order if not (last_partial and k == last_key)]
    start = -1
    for k in range(len(wins) - 1, -1, -1):
        if wins[k][1] < SUSTAINED_DROP_FRACTION:
            start = k
        else:
            break
    if start == -1:
        return {'measured': True, 'occurred': False, 'windows': len(wins), 'lastWindowExcluded': last_partial}
    return {'measured': True, 'occurred': True, 't_s': (t0 + wins[start][0] * WINDOW_MS) / 1000.0, 'value': wins[start][1],
            'windows': len(wins), 'windowsBelowToEnd': len(wins) - start, 'lastWindowExcluded': last_partial}


def znorm(x, s, m):
    w = x[s:s + m]
    if min(w) == max(w):
        return [0.0] * m
    mean = sum(w) / m
    sd = math.sqrt(sum((a - mean) ** 2 for a in w) / m)
    return [(a - mean) / sd for a in w]


def discord(series, m, ez):
    subs = len(series) - m + 1
    if subs < 1:
        return None
    Z = [znorm(series, i, m) for i in range(subs)]
    best = None
    flat = sum(1 for i in range(subs) if min(series[i:i + m]) == max(series[i:i + m]))
    with_nb = 0
    for i in range(subs):
        d_min = None
        for j in range(subs):
            if abs(i - j) < ez:
                continue
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(Z[i], Z[j])))
            if d_min is None or d < d_min[0]:
                d_min = (d, j)
        if d_min is None:
            continue
        with_nb += 1
        if best is None or d_min[0] > best[0]:
            best = (d_min[0], i, d_min[1])
    if best is None:
        return {'noNeighbor': True, 'subs': subs}
    return {'distance': best[0], 'index': best[1], 'neighbor': best[2], 'subs': subs, 'withNeighbor': with_nb, 'flat': flat}


def knee(segs):
    mbps = [s['mbps'] for s in segs]
    cum = [s['cumulativeBytes'] for s in segs]
    for k in range(2, len(mbps)):
        if mbps[k] <= 0.5 * statistics.median(mbps[:k]):
            return {'segmentIndex': k, 'cumulativeGb': cum[k] / 2 ** 30, 'mbps': mbps[k], 'previous': mbps[k - 1],
                    'next': mbps[k + 1] if k + 1 < len(mbps) else None,
                    'inCacheMedian': statistics.median(mbps[:k]), 'postCacheMedian': statistics.median(mbps[k:])}
    return None


def scan(name):
    ts = load(name)
    samples, col, units = columns(ts)
    t = col('timestamp_ms')
    freq = col('cpu_freq_max_khz')
    temp = col('battery_temp_c')
    volt = col('battery_voltage_mv')
    cur = col('battery_current_ua')
    power = col('package_power_mw')
    peak = sustained_peak(ts, freq)
    out = {'n': len(samples)}
    comb = combined_gate(samples, freq)
    out['combinedGate'] = comb
    out['peakFreqKhz'] = peak
    out['F5_peak_hold'] = peak_hold(samples, t, freq, peak)
    if comb:
        out['L1'] = {str(p): sustained_drop(samples, t, freq, peak, p) for p in (3, 5)}
    rise_ok = gate(len(temp), changes(temp))
    out['riseGate'] = rise_ok
    if rise_ok:
        rise = max(temp) - temp[0]
        wh = energy_wh(t, volt, cur)
        out['F12_rise_c'] = rise
        out['energy_wh'] = wh
        out['F14_temp_per_wh'] = rise / wh if wh > 0 else None
        out['LAB_thermal_resistance'] = thermal_resistance(samples, t, temp, power)
        at = max(range(len(temp)), key=lambda i: (temp[i], -i))
        out['L2'] = {'t_s': t[at] / 1000.0, 'phase': samples[at]['phase'], 'value': temp[at]}
    out['maxAbsDiffVIvsPowerMw'] = max(abs(abs(volt[i] * cur[i]) / 1e6 - power[i]) for i in range(len(samples)))
    segs = (ts['footer'].get('verificationResults') or {}).get('storageThroughputSegments')
    out['L3'] = knee(segs) if segs else None
    l4 = {}
    for ch in ('battery_current_ua', 'cpu_freq_max_khz', 'cpu_usage_pct', 'package_power_mw'):
        series_all = col(ch)
        for p in range(8):
            idx = phase_idx(samples, p)
            if not idx:
                continue
            series = [series_all[i] for i in idx]
            if not gate(len(series), changes(series)):
                l4['%s|%d' % (ch, p)] = {'gate': False}
                continue
            d = discord(series, ANOMALY_WINDOW, EXCLUSION_ZONE)
            if d is not None and 'distance' in d:
                d['t_s'] = t[idx[d['index']]] / 1000.0
            l4['%s|%d' % (ch, p)] = d
    out['L4'] = l4
    return out


def l5(name):
    ts = load(name)
    samples = ts['samples']
    t = [s['v'][0] for s in samples]
    ev = ts['footer'].get('thermalStatusEvents') or []
    res = {}
    for thr_name, thr in (('MODERATE', 2), ('SEVERE', 3)):
        hit = next(((i, e) for i, e in enumerate(ev) if e['status'] >= thr), None)
        if hit is None:
            res[thr_name] = {'occurred': False}
            continue
        i, e = hit
        phase = None
        for k in range(len(samples)):
            if t[k] <= e['t']:
                phase = samples[k]['phase']
            else:
                break
        res[thr_name] = {'occurred': True, 't_s': e['t'] / 1000.0, 'phase': phase, 'status': e['status'], 'atRegistration': i == 0, 'eventIndex': i}
    return {'state': ts['footer'].get('thermalStatusState'), 'eventCount': len(ev), 'thresholds': res}


def main():
    doc = {'_source': 'reference_feature_library.py (independent plain-Python implementation), run on the real golden fingerprints in ../golden',
           '_featureSetVersionAtGeneration': 1,
           'scans': {n: scan(n) for n in FILES},
           'l5_producer_goldens': {n: l5(n) for n in FV71}}
    json.dump(doc, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()

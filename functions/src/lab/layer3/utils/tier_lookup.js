'use strict';

// T4 — Tier-based comparative context. Hardcoded TDP envelope estimates per
// known SoC family. NO USER DATA. Lookup is from device.cpuModel string match.
// If no match, return null and let the summary fall back to "tier unknown".
//
// Sources: published silicon brief (Snapdragon, Dimensity, Exynos, Apple A);
// per-SoC sustained-power numbers vary by chassis but the envelope below is
// for "flagship phone chassis with vapor chamber" which is the lab's target.

const SOC_TABLE = [
  // Qualcomm Snapdragon
  { match: /sm8650|sdm8650|snapdragon 8 gen 3/i, name: 'Snapdragon 8 Gen 3',     tier: 'flagship_2024', tdp_w: 13 },
  { match: /sm8550|snapdragon 8 gen 2/i,         name: 'Snapdragon 8 Gen 2',     tier: 'flagship_2023', tdp_w: 12 },
  { match: /sm8475|snapdragon 8\+ gen 1/i,       name: 'Snapdragon 8+ Gen 1',    tier: 'flagship_2022', tdp_w: 11 },
  { match: /sm8450|snapdragon 8 gen 1/i,         name: 'Snapdragon 8 Gen 1',     tier: 'flagship_2022', tdp_w: 10 },
  { match: /sm8350|snapdragon 888/i,             name: 'Snapdragon 888',         tier: 'flagship_2021', tdp_w: 10 },
  { match: /sm8250|snapdragon 865/i,             name: 'Snapdragon 865',         tier: 'flagship_legacy', tdp_w: 8 },
  { match: /sm8150|sdm855|snapdragon 855/i,      name: 'Snapdragon 855',         tier: 'flagship_legacy', tdp_w: 7 },
  { match: /sdm845|snapdragon 845/i,             name: 'Snapdragon 845',         tier: 'flagship_legacy', tdp_w: 6 },

  // Mediatek Dimensity
  { match: /mt6991|dimensity 9400/i,             name: 'Dimensity 9400',         tier: 'flagship_2024', tdp_w: 14 },
  { match: /mt6989|dimensity 9300/i,             name: 'Dimensity 9300',         tier: 'flagship_2023', tdp_w: 13 },
  { match: /mt6985|dimensity 9200/i,             name: 'Dimensity 9200',         tier: 'flagship_2022', tdp_w: 11 },
  { match: /mt6983|dimensity 9000/i,             name: 'Dimensity 9000',         tier: 'flagship_2022', tdp_w: 10 },

  // Samsung Exynos
  { match: /exynos 2400/i,                       name: 'Exynos 2400',            tier: 'flagship_2024', tdp_w: 12 },
  { match: /exynos 2200/i,                       name: 'Exynos 2200',            tier: 'flagship_2022', tdp_w: 10 },
  { match: /exynos 2100/i,                       name: 'Exynos 2100',            tier: 'flagship_2021', tdp_w: 9 },

  // Mid-range / others
  { match: /sm6450|snapdragon 7\+/i,             name: 'Snapdragon 7+ Gen 2',    tier: 'upper_mid',     tdp_w: 7 },
  { match: /sm6375|snapdragon 695/i,             name: 'Snapdragon 695',         tier: 'mid',           tdp_w: 5 },
];

function lookupSocByCpuModel(cpuModel) {
  if (!cpuModel || typeof cpuModel !== 'string') return null;
  for (const entry of SOC_TABLE) {
    if (entry.match.test(cpuModel)) {
      return { name: entry.name, tier: entry.tier, tdp_w: entry.tdp_w };
    }
  }
  return null;
}

function lookupSocByDeviceModel(deviceModel) {
  if (!deviceModel || typeof deviceModel !== 'string') return null;
  // Common product → SoC family heuristics. Conservative; returns null if uncertain.
  const dm = deviceModel.toLowerCase();
  if (/galaxy s10/.test(dm)) return { name: 'Snapdragon 855 / Exynos 9820', tier: 'flagship_legacy', tdp_w: 7 };
  if (/galaxy s24 ultra/.test(dm)) return { name: 'Snapdragon 8 Gen 3', tier: 'flagship_2024', tdp_w: 13 };
  if (/galaxy s23/.test(dm)) return { name: 'Snapdragon 8 Gen 2', tier: 'flagship_2023', tdp_w: 12 };
  if (/redmi k80|xiaomi 14/.test(dm) || /xiaomi 15/.test(dm)) return { name: 'Snapdragon 8 Gen 3 / Dimensity 9400', tier: 'flagship_2024', tdp_w: 13 };
  return null;
}

function getDeviceTier(scanData) {
  // Try cpuModel first, then deviceModel, finally header.deviceModel as fallback.
  const cpu = scanData.rawFingerprint?.device?.cpuModel || scanData.device?.cpuModel;
  let hit = lookupSocByCpuModel(cpu);
  if (hit) return hit;
  const dm = scanData.rawFingerprint?.device?.model
    || scanData.device?.model
    || scanData.timeSeries?.header?.deviceModel
    || scanData.header?.deviceModel;
  hit = lookupSocByDeviceModel(dm);
  if (hit) return hit;
  return null;
}

module.exports = { lookupSocByCpuModel, lookupSocByDeviceModel, getDeviceTier };

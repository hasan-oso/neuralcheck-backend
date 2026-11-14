const {computeAllFeatures, normalizeScanData} = require("../lab/layer1");
const {computeLayer2Features} = require("../lab/layer2");
const {generateClinicalSummary} = require("../lab/layer3");

/**
 * Run the full lab pipeline (Layer 1 + 2 + 3) on a fingerprint.
 *
 * @param {Object} fingerprint - the raw fingerprint from the Android client.
 *   Expected shape: { timeSeries: { samples, footer, header, variables },
 *                     verificationResults, ... }
 * @returns {Object} { computedFeatures, layer2Features, clinicalSummary,
 *                     pipelineMeta }
 *   - computedFeatures: Layer 1 output (battery, thermal, performance)
 *   - layer2Features: Layer 2 output (anomalies, correlations, spectral,
 *                     statistics, trends)
 *   - clinicalSummary: Layer 3 output (markdown string + meta)
 *   - pipelineMeta: { layer1Ms, layer2Ms, layer3Ms, totalMs, errors[] }
 *
 * If any layer fails, the others still run. Failures are reported in
 * pipelineMeta.errors[]. The function never throws — partial output is
 * always returned so the AI call can proceed with whatever succeeded.
 */
function runLabPipeline(fingerprint) {
  const t0 = Date.now();
  const errors = [];
  let scanData = null;
  let computedFeatures = null;
  let layer2Features = null;
  let clinicalSummary = null;
  let layer1Ms = 0;
  let layer2Ms = 0;
  let layer3Ms = 0;

  // Normalize input shape (handles both Storage flat shape and Firestore
  // rawFingerprint shape — same as lab project)
  try {
    scanData = normalizeScanData(fingerprint);
  } catch (e) {
    errors.push({stage: "normalize", error: e.message});
    // If normalize fails, we can't proceed
    return {
      computedFeatures: null,
      layer2Features: null,
      clinicalSummary: null,
      pipelineMeta: {
        layer1Ms: 0, layer2Ms: 0, layer3Ms: 0,
        totalMs: Date.now() - t0,
        errors,
      },
    };
  }

  // Layer 1
  const t1 = Date.now();
  try {
    computedFeatures = computeAllFeatures(scanData);
  } catch (e) {
    errors.push({stage: "layer1", error: e.message});
  }
  layer1Ms = Date.now() - t1;

  // Layer 2 (depends on scanData; OK if Layer 1 partially succeeded)
  const t2 = Date.now();
  try {
    layer2Features = computeLayer2Features(scanData, computedFeatures);
  } catch (e) {
    errors.push({stage: "layer2", error: e.message});
  }
  layer2Ms = Date.now() - t2;

  // Layer 3 (depends on Layer 1 + Layer 2)
  const t3 = Date.now();
  try {
    clinicalSummary = generateClinicalSummary(
        scanData, computedFeatures, layer2Features);
  } catch (e) {
    errors.push({stage: "layer3", error: e.message});
  }
  layer3Ms = Date.now() - t3;

  return {
    computedFeatures,
    layer2Features,
    clinicalSummary,
    pipelineMeta: {
      layer1Ms,
      layer2Ms,
      layer3Ms,
      totalMs: Date.now() - t0,
      errors,
    },
  };
}

module.exports = {runLabPipeline};

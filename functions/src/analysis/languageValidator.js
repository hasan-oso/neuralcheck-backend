'use strict';

// languageValidator.js — English-leak detector + targeted-fix follow-up.
//
// Ported from neuralcheck-lab/audits/lab_state_for_architecture_design/
// test_v5_precomputed/language_validator.js, with one adaptation:
// `fixLeaksTargeted(aiClient, leaks, language, key)` wraps the lab's
// buildTargetedFixMessage to call the backend's existing callDeepSeek /
// callGeminiFallback interface (signature: (userMessage, systemPrompt, key)
// returning parsed JSON).
//
// Two main entry points:
//   - detectEnglishLeaks(parsedResponse) → leaks[]
//   - fixLeaksTargeted(aiClient, leaks, language, key) → { fixes, applied,
//     skipped, error? }
//
// Auxiliary exports preserved for unit testing.

const ALLOWED_DEVICE_BRAND_TOKENS = new Set([
  'samsung', 'galaxy', 'iphone', 'apple', 'huawei', 'xiaomi', 'oneplus',
  'oppo', 'vivo', 'nokia', 'sony', 'lg', 'motorola', 'pixel', 'google',
  'pro', 'plus', 'ultra', 'max', 'edge', 'mini', 'note', 'fold', 'flip',
  's10', 's20', 's21', 's22', 's23', 's24', 's25',
  's8', 's9', 's11', 's12', 's13', 's14', 's15', 's16', 's17', 's18', 's19',
  'a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'bionic',
]);

const ALLOWED_CHIPSET_TOKENS = new Set([
  'exynos', 'snapdragon', 'kirin', 'mediatek', 'helio', 'dimensity',
  'mali', 'adreno', 'powervr',
  'g51', 'g52', 'g57', 'g68', 'g71', 'g72', 'g76', 'g77', 'g78',
  'g610', 'g615', 'g710', 'g715',
  '730', '750', '765', '845', '855', '865', '870', '888',
  '8gen1', '8gen2', '8gen3',
  '9810', '9820', '9825', '990', '1080', '2100', '2200', '2400',
]);

function isAllowedToken(tok) {
  const t = tok.toLowerCase();
  if (ALLOWED_DEVICE_BRAND_TOKENS.has(t)) return true;
  if (ALLOWED_CHIPSET_TOKENS.has(t)) return true;
  if (/^\d+[a-z]?$/.test(t)) return true;
  if (/^[a-z]\d+$/.test(t) && t.length <= 4) return true;
  return false;
}

function findEnglishLeaks(s) {
  if (!s || typeof s !== 'string') return [];
  const tokens = s.match(/[A-Za-z][A-Za-z0-9]+/g) || [];
  const leaks = [];
  for (const t of tokens) {
    if (!isAllowedToken(t)) leaks.push(t);
  }
  return leaks;
}

// fix/category-grading: the 13-key copy that used to live here silently
// skipped leak-checking of audio/input notes. Single source: utils/categories.
const {CATEGORIES: CATEGORY_KEYS} = require('../utils/categories');
const {failureTextOnce} = require('../utils/failureText');
const BUYER_KEYS = ['casual', 'gamer', 'photographer'];
const EXPECTED_KEYS = ['cpu_assessment', 'thermal_assessment', 'gpu_assessment',
  'memory_assessment', 'storage_assessment', 'battery_assessment'];

function collectTextFields(p) {
  if (!p) return [];
  const out = [];
  function pushIf(label, v) {
    if (typeof v === 'string') out.push({path: label, text: v});
  }
  pushIf('summary', p.summary);
  pushIf('details', p.details);
  pushIf('verdict', p.verdict);
  pushIf('rootCause', p.rootCause);
  if (Array.isArray(p.issues)) {
    p.issues.forEach((i, idx) => {
      pushIf('issues[' + idx + '].title', i?.title);
      pushIf('issues[' + idx + '].description', i?.description);
      pushIf('issues[' + idx + '].evidence', i?.evidence);
    });
  }
  if (Array.isArray(p.predictedProblems)) {
    p.predictedProblems.forEach((pp, idx) => {
      pushIf('predictedProblems[' + idx + '].timeframe', pp?.timeframe);
      pushIf('predictedProblems[' + idx + '].prediction', pp?.prediction);
    });
  }
  if (p.categoryScores) {
    for (const c of CATEGORY_KEYS) {
      pushIf('categoryScores.' + c + '.note', p.categoryScores[c]?.note);
    }
  }
  if (p.buyerAdvice) {
    for (const k of BUYER_KEYS) pushIf('buyerAdvice.' + k, p.buyerAdvice[k]);
  }
  if (p.performanceContext) {
    for (const k of EXPECTED_KEYS) pushIf('performanceContext.' + k, p.performanceContext[k]);
  }
  return out;
}

function detectEnglishLeaks(parsed) {
  const fields = collectTextFields(parsed);
  const leaks = [];
  for (const {path, text} of fields) {
    const tokens = findEnglishLeaks(text);
    if (tokens.length > 0) {
      leaks.push({path, original: text, tokens: Array.from(new Set(tokens))});
    }
  }
  return leaks;
}

// Build a follow-up message asking the AI to rewrite ONLY the bad fields.
function buildTargetedFixMessage(leaks, language) {
  const langLabel = language === 'ar' ? 'Arabic' : (language === 'tr' ? 'Turkish' : language);
  const lines = [];
  lines.push('Your previous response contained English words that violate the LANGUAGE rule.');
  lines.push('Rewrite ONLY the listed fields so they contain zero English (except device names like "Samsung Galaxy S10 5G", processor codenames like "Exynos 9820", and international unit symbols like "MB/s", "GHz", "°C", "%").');
  lines.push('Use the mandatory translation table from the system prompt. The output language is ' + langLabel + '.');
  lines.push('');
  lines.push('Return a JSON object whose keys are exactly the dotted paths below, and whose values are the corrected ' + langLabel + ' strings. Do NOT return the entire report — only the corrections.');
  lines.push('');
  lines.push('Example response shape:');
  lines.push('{');
  lines.push('  "issues[2].evidence": "<corrected text in ' + langLabel + '>",');
  lines.push('  "performanceContext.memory_assessment": "<corrected text in ' + langLabel + '>"');
  lines.push('}');
  lines.push('');
  lines.push('Fields to rewrite:');
  lines.push('');
  for (const l of leaks) {
    lines.push('- path: ' + l.path);
    lines.push('  current text: ' + JSON.stringify(l.original));
    lines.push('  English tokens that must be removed: ' + l.tokens.join(', '));
    lines.push('');
  }
  return lines.join('\n');
}

// Apply the AI's correction map to the parsed object, mutating in place.
function applyOverrides(parsed, fixedFragments) {
  if (!parsed || !fixedFragments || typeof fixedFragments !== 'object') return {applied: 0, skipped: 0};
  let applied = 0; let skipped = 0;
  for (const [path, value] of Object.entries(fixedFragments)) {
    if (typeof value !== 'string') { skipped++; continue; }
    let m;
    if ((m = path.match(/^(summary|details|verdict|rootCause)$/))) {
      parsed[m[1]] = value; applied++;
    } else if ((m = path.match(/^issues\[(\d+)\]\.(title|description|evidence)$/))) {
      const idx = parseInt(m[1], 10);
      if (Array.isArray(parsed.issues) && parsed.issues[idx]) {
        parsed.issues[idx][m[2]] = value; applied++;
      } else skipped++;
    } else if ((m = path.match(/^predictedProblems\[(\d+)\]\.(timeframe|prediction)$/))) {
      const idx = parseInt(m[1], 10);
      if (Array.isArray(parsed.predictedProblems) && parsed.predictedProblems[idx]) {
        parsed.predictedProblems[idx][m[2]] = value; applied++;
      } else skipped++;
    } else if ((m = path.match(/^categoryScores\.([a-z]+)\.note$/))) {
      if (parsed.categoryScores && parsed.categoryScores[m[1]]) {
        parsed.categoryScores[m[1]].note = value; applied++;
      } else skipped++;
    } else if ((m = path.match(/^buyerAdvice\.([a-z]+)$/))) {
      if (parsed.buyerAdvice && (m[1] in parsed.buyerAdvice)) {
        parsed.buyerAdvice[m[1]] = value; applied++;
      } else skipped++;
    } else if ((m = path.match(/^performanceContext\.([a-z_]+)$/))) {
      if (parsed.performanceContext && (m[1] in parsed.performanceContext)) {
        parsed.performanceContext[m[1]] = value; applied++;
      } else skipped++;
    } else {
      skipped++;
    }
  }
  return {applied, skipped};
}

// V5 backend adaptation: targeted-fix wrapper that uses the existing
// callDeepSeek / callGeminiFallback signature: aiClient(userMessage,
// systemPrompt, key) → parsed JSON.
//
// On serverless failure (timeout, malformed JSON, etc.) returns {error}
// without retrying — the caller decides whether to proceed with the
// uncorrected response.
async function fixLeaksTargeted(aiClient, leaks, language, key) {
  if (!Array.isArray(leaks) || leaks.length === 0) {
    return {fixes: {}, applied: 0, skipped: 0, calledModel: false};
  }
  if (typeof aiClient !== 'function') {
    return {fixes: {}, applied: 0, skipped: 0, error: 'aiClient_not_function'};
  }
  const fixMessage = buildTargetedFixMessage(leaks, language);
  // Minimal system prompt for the fix call — we don't reload the full V5
  // prompt because the leaks already encode the rule.
  const fixSystemPrompt =
      'You are a translation assistant. Rewrite the listed fields so they ' +
      'contain ZERO English (except device names, processor codenames, and ' +
      'international unit symbols). Return ONLY a flat JSON object mapping ' +
      'dotted paths → corrected text. No prose, no markdown fences.';
  try {
    const fixes = await aiClient(fixMessage, fixSystemPrompt, key);
    if (!fixes || typeof fixes !== 'object') {
      return {fixes: {}, applied: 0, skipped: 0, error: 'fix_response_not_object', calledModel: true};
    }
    return {fixes, calledModel: true};
  } catch (e) {
    return {fixes: {}, applied: 0, skipped: 0, error: failureTextOnce(e), calledModel: true};
  }
}

module.exports = {
  detectEnglishLeaks,
  fixLeaksTargeted,
  buildTargetedFixMessage,
  applyOverrides,
  findEnglishLeaks,
  isAllowedToken,
  collectTextFields,
  CATEGORY_KEYS, BUYER_KEYS, EXPECTED_KEYS,
};

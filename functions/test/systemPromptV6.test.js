'use strict';

// systemPromptV6.test.js — smoke assertions on the V6 system prompt content.
//
// Run: node functions/test/systemPromptV6.test.js
//
// Purpose: pin the prompt to the contract the mobile side relies on
// (Bug 5 fix). If a future edit removes the categoryName documentation
// or drops audio/input from the graded category list, these assertions
// catch it before deployment.

const assert = require('assert');
const {SYSTEM_PROMPT_V6} = require('../src/prompts/systemPromptV6');

// ─── 1. New manual categories appear at least once each ─────────────────
{
  assert.ok(SYSTEM_PROMPT_V6.includes('audio'),
      'V6 prompt must mention "audio" category');
  assert.ok(SYSTEM_PROMPT_V6.includes('input'),
      'V6 prompt must mention "input" category');
}

// ─── 2. manualResults schema documents the categoryName field ───────────
// The field name itself must appear, AND the schema bullet must show
// the new {testId, status, categoryName} shape so the AI cannot read
// the old {testId, status}-only shape from documentation drift.
{
  assert.ok(SYSTEM_PROMPT_V6.includes('categoryName'),
      'V6 prompt must mention "categoryName" field');
  assert.ok(
      SYSTEM_PROMPT_V6.includes('{ testId, status, categoryName }'),
      'manualResults schema must show the new {testId, status, categoryName} shape');
}

// ─── 3. issues[].category enum lists audio + input ──────────────────────
// The "category" enum in the OUTPUT schema is the contract the AI
// follows when tagging issues. Missing values cause the AI to fall back
// to "verification" or invent a value, both of which break analytics.
{
  const enumLine = SYSTEM_PROMPT_V6.match(
      /"category":\s*"[^"]+"/);
  assert.ok(enumLine, 'issues[].category enum line not found');
  assert.ok(enumLine[0].includes('audio'),
      `issues[].category enum must include "audio", got: ${enumLine[0]}`);
  assert.ok(enumLine[0].includes('input'),
      `issues[].category enum must include "input", got: ${enumLine[0]}`);
}

// ─── 4. categoryScores object lists audio + input as keys ───────────────
// The categoryScores block is the per-category grading output. The AI
// emits a key per category, so the prompt must list audio/input here.
{
  // Match the categoryScores object (multiline). The block starts at
  // `"categoryScores": {` and ends at the closing `},` after the
  // documentation comments. We test that both `"audio":` and `"input":`
  // appear inside that range.
  const start = SYSTEM_PROMPT_V6.indexOf('"categoryScores":');
  assert.ok(start >= 0, 'categoryScores block not found in prompt');
  // Slice generously — the trailing closing brace is many lines below.
  const block = SYSTEM_PROMPT_V6.slice(start, start + 2500);
  assert.ok(block.includes('"audio":'),
      'categoryScores must declare "audio" key');
  assert.ok(block.includes('"input":'),
      'categoryScores must declare "input" key');
}

// ─── 5. Step 6 documents the categoryName-driven bucketing ──────────────
// The methodology section MUST tell the AI to use categoryName for
// bucketing. Without this, the AI would still guess based on testId
// even when categoryName is present.
{
  const step6Start = SYSTEM_PROMPT_V6.indexOf(
      'Step 6 — Cross-reference functionalResults & manualResults.');
  assert.ok(step6Start >= 0, 'Step 6 header not found');
  const step6 = SYSTEM_PROMPT_V6.slice(step6Start, step6Start + 2000);
  assert.ok(step6.includes('categoryName'),
      'Step 6 must instruct the AI to use categoryName');
  assert.ok(step6.includes('audio'),
      'Step 6 must explicitly bucket audio');
  assert.ok(step6.includes('input'),
      'Step 6 must explicitly bucket input');
  assert.ok(step6.includes('M-04..M-08'),
      'Step 6 must list the audio testId range for legacy-scan fallback');
  assert.ok(step6.includes('M-09..M-11'),
      'Step 6 must list the input testId range for legacy-scan fallback');
}

// ─── 6. Final-validation checklist asks about all 15 categories ─────────
// The "FINAL VALIDATION" section should reflect the new count so the
// AI doesn't shortcut to checking only the legacy 13.
{
  assert.ok(
      SYSTEM_PROMPT_V6.includes('15 categories') ||
      SYSTEM_PROMPT_V6.includes('15 categories (including audio'),
      'Final-validation checklist must reference 15 categories');
}

// ─── 7. Zero-channel warnings (fix/prompt-zero-channel-warnings) ────────
// Real-device measurement showed three raw channels carry zeros that are
// capture failures, not values. The prompt must (a) declare memory_bw
// broken and redirect to memoryTestedBytes + R-01..R-03, (b) explain
// storage trailing zeros as "writing finished" and redirect to
// storageThroughputSegments + S-01..S-06, (c) explain the alternating-zero
// gpu_fps pattern and forbid cross-device fps comparison, (d) state the
// general zero-in-own-phase rule.
{
  const chStart = SYSTEM_PROMPT_V6.indexOf('─── How each channel is captured');
  assert.ok(chStart >= 0, 'channel-capture section not found');
  // Whitespace-normalized so phrases that wrap across prompt lines still match.
  const ch = SYSTEM_PROMPT_V6.slice(chStart, chStart + 12000).replace(/\s+/g, ' ');

  // (a) memory_bw_mbps
  const mem = ch.slice(ch.indexOf('• memory_bw_mbps (v[9])'));
  assert.ok(mem.startsWith('• memory_bw_mbps'), 'memory_bw_mbps bullet missing');
  // The "broken channel" wording is gone on purpose: at 66+ the channel is
  // live, so the warning is now version-scoped rather than absolute.
  assert.ok(!mem.includes('CURRENTLY BROKEN'),
      'memory_bw must no longer be declared broken unconditionally');
  assert.ok(mem.includes('STRUCTURAL'),
      'memory_bw <=65 branch must call its zeros structural');
  assert.ok(mem.includes('verificationResults.memoryTestedBytes'),
      'memory_bw warning must redirect to memoryTestedBytes');
  assert.ok(mem.includes('R-01..R-03'),
      'memory_bw warning must redirect to R-01..R-03');

  // (b) storage_throughput_mbps
  const sto = ch.slice(ch.indexOf('• storage_throughput_mbps (v[8])'));
  assert.ok(sto.startsWith('• storage_throughput_mbps'), 'storage bullet missing');
  assert.ok(sto.includes('"writing finished at the byte cap"'),
      'storage warning must explain trailing zeros as writing finished');
  assert.ok(sto.includes('verificationResults.storageThroughputSegments'),
      'storage warning must redirect to storageThroughputSegments');
  assert.ok(sto.includes('S-01..S-06'),
      'storage warning must redirect to S-01..S-06');

  // (c) gpu_fps
  const gpu = ch.slice(ch.indexOf('• gpu_fps (v[10])'));
  assert.ok(gpu.startsWith('• gpu_fps'), 'gpu_fps bullet missing');
  assert.ok(gpu.includes('ALTERNATE'),
      'gpu_fps <=65 branch must describe the alternating-zero pattern');
  assert.ok(gpu.includes('measurement artifact'),
      'gpu_fps <=65 branch must call alternation a measurement artifact');
  assert.ok(gpu.includes('Never compare absolute fps between devices'),
      'gpu_fps warning must forbid cross-device fps comparison');

  // (d) general rule
  assert.ok(ch.includes('ZERO-VALUE RULE'),
      'general zero-value rule missing');
  assert.ok(ch.includes('MISSING DATA, not a measurement'),
      'zero-value rule must define zeros as missing data');

  // Phase list must no longer promise memory_bandwidth samples.
  assert.ok(!SYSTEM_PROMPT_V6.includes('producing memory_bandwidth_mbps samples'),
      'phase 2 description must not promise memory_bandwidth samples');
}

// ─── (كان هنا القسم 8: مرآة التحذيرات الأربعة في برومبت V3) ─────────
//
// حُذف مع مسار V3 في chore/remove-v3-precompute. كان يؤكّد أن البرومبتين
// يصفان القنوات الصامتة بالطريقة نفسها — وهو رباط فقد معناه حين صار
// البرومبت واحداً. ما يخصّ V6 من تلك التأكيدات باقٍ في القسم 7.

// ─── 9. fieldsVersion 66 semantics (fix/prompt-fields-version-66) ───────
// Three channels changed MEANING, not precision, at fieldsVersion 66, and
// scans from both eras arrive at the same endpoint. Reading a 66 scan with
// <=65 rules discards real measurements; reading a <=65 scan with 66 rules
// invents defects out of structural zeros. The prompt must therefore fork
// on footer.fieldsVersion rather than describe one era as the truth.
{
  const v6 = SYSTEM_PROMPT_V6.replace(/\s+/g, ' ');

  // (a) The version gate itself, and the default when the field is absent.
  assert.ok(v6.includes('READ footer.fieldsVersion FIRST'),
      'V6 must tell the model to read fieldsVersion before the channels');
  assert.ok(v6.includes('assume ≤ 65'),
      'V6 must define the fallback when fieldsVersion is absent');

  // (b) memory_bw: live at 66+, structural zeros below.
  assert.ok(v6.includes('fieldsVersion 66+: live MB/s'),
      'V6 must describe memory_bw as live measurements at 66+');

  // (c) gpu_fps: sliding window at 66+, artifact alternation below.
  assert.ok(v6.includes('1-second SLIDING WINDOW'),
      'V6 must describe gpu_fps as a sliding window at 66+');
  assert.ok(v6.includes('60–120 fps band'),
      'V6 must scope the <=65 alternation artifact to the 60-120 fps band');

  // (d) maxBatteryTemp: true peak at 66+, end-of-scan value below, and the
  //     divergence from batteryTempMaxC is expected below 66 — not a bug.
  assert.ok(v6.includes('maxBatteryTemp (footer): MEANING CHANGED'),
      'V6 must flag the maxBatteryTemp semantic change');
  assert.ok(v6.includes('END-OF-SCAN temperature'),
      'V6 must say <=65 carried the end-of-scan value');
  assert.ok(v6.includes('prefer footer.batteryHealth.batteryTempMaxC'),
      'V6 must redirect to batteryTempMaxC below 66');

  // (e) gpuFenceTimeoutCount is a CONFIDENCE gate on v[10], not a defect
  //     counter — the counter counts fence issue, not completion.
  assert.ok(v6.includes('gpuFenceTimeoutCount'),
      'V6 must document gpuFenceTimeoutCount');
  assert.ok(v6.includes('OVERSTATED'),
      'V6 must say gpu_fps may be overstated when the count is > 0');

  // (f) storage: measured rate preferred, -1 means not measured.
  assert.ok(v6.includes('storageBytesWritten') &&
      v6.includes('storageWriteDurationMs'),
  'V6 must document the storage byte/duration pair');
  assert.ok(v6.includes('-1 means NOT MEASURED'),
      'V6 must define the -1 sentinel for the storage pair');

  // (g) cpuUsageSource: process_fallback invalidates the "low usage means
  //     healthy" inference, and procStatAvailable is untrustworthy below 66.
  assert.ok(v6.includes('cpuUsageSource'),
      'V6 must document cpuUsageSource');
  assert.ok(v6.includes('CPU share, NOT system load'),
      'V6 must explain that process_fallback measures only the app share');
  assert.ok(v6.includes('that inference is invalid here'),
      'V6 must forbid the low-usage-means-healthy inference on fallback');
  assert.ok(v6.includes('procStatAvailable') && v6.includes('hard-coded true'),
      'V6 must warn that procStatAvailable was hard-coded true on <=65');

  // (h) skinTemp: "missing" at 66+ is the honest answer; "available" below
  //     66 may be a battery proxy wearing another name.
  assert.ok(v6.includes('skinTempSourceBreakdown'),
      'V6 must document skinTempSourceBreakdown');
  assert.ok(v6.includes('"missing" is the honest'),
      'V6 must frame "missing" as the honest answer at 66+');

  // (i) fieldsVersion must appear in the footer inventory of both prompts,
  //     not only in prose — the model reads that list to know what exists.
  assert.ok(v6.includes('fieldsVersion — the app'),
      'V6 footer inventory must list fieldsVersion');
}

// ─── 10. fieldsVersion 67 semantics (fix/prompt-fields-version-66, v67) ──
// A second round of meaning changes. Two of them are the dangerous kind: the
// field keeps its NAME and its TYPE and only changes what the number means, so
// nothing downstream errors — a <=66 write speed of 635 simply reads as "635%
// free". Each therefore gets a self-check the model can apply even when the
// version is missing, not just a version branch.
{
  const v6 = SYSTEM_PROMPT_V6.replace(/\s+/g, ' ');

  // (a) The version gate must now name BOTH migrations, or a reader who
  //     checks it will think 66 was the last one.
  assert.ok(v6.includes('at 67: device.storagePercent'),
      'V6 version gate must list the 67 migration');
  assert.ok(v6.includes('at 66: v[9] memory_bw'),
      'V6 version gate must still list the 66 migration');

  // (b) storagePercent — a percentage at 67, a WRITE SPEED below it.
  assert.ok(v6.includes('storagePercent — percent of storage free (0-100)'),
      'V6 must describe storagePercent as percent free');
  assert.ok(v6.includes('carried the WRITE SPEED in MB/s'),
      'V6 must say <=66 carried write speed instead');
  assert.ok(v6.includes('is > 100'),
      'V6 must give the >100 self-check');
  assert.ok(v6.includes('Do NOT rescale'),
      'V6 must forbid rescaling — there is no conversion between the two');

  // (c) availableStorageGb — GB at 67, a percentage wearing a GB label below.
  //     The consistency check is what catches it when the version is absent.
  assert.ok(v6.includes('availableStorageGb — free space in GB'),
      'V6 must describe availableStorageGb as GB');
  assert.ok(v6.includes('percentage wearing a GB label'),
      'V6 must say <=66 carried a percentage');
  assert.ok(v6.includes('must be ≤ totalStorageGb'),
      'V6 must state the consistency check against totalStorageGb');
  assert.ok(v6.includes('even when fieldsVersion'),
      'V6 must note the check works without the version');

  // (d) scanStillness.isStill — the exact claims, because the failure here is
  //     inferring PLACEMENT from a motion flag.
  assert.ok(v6.includes('no gross motion'),
      'V6 isStill must be scoped to gross motion');
  assert.ok(v6.includes('It does not mean the device was on a flat surface'),
      'V6 must deny the flat-surface inference explicitly');
  assert.ok(v6.includes('0.35 m/s²') && v6.includes('0.2515–0.3723'),
      'V6 must keep the measured hand-held figure and the motionless range');
  assert.ok(v6.includes('Never infer placement from this flag'),
      'V6 must forbid placement inference outright');
  assert.ok(v6.includes('accelStdDev = -1 means could not measure'),
      'V6 must define accelStdDev -1 as unmeasurable, not still');
  assert.ok(v6.includes('carries no information'),
      'V6 must say the flag is uninformative below 67');

  // (e) satCaveat — read the FLAG, not the prose. Attributing a vendor policy
  //     from a hard-coded string is a fabricated finding.
  assert.ok(v6.includes('satCaveat — free text'),
      'V6 must document satCaveat');
  assert.ok(v6.includes('Xiaomi/HyperOS class'),
      'V6 must quote the <=66 hard-coded string so it can be recognised');
  assert.ok(v6.includes('governorCappingDetected=false'),
      'V6 must record that it arrived with the flag false');
  assert.ok(v6.includes('Read the FLAG'),
      'V6 must direct the model to the flag over the prose');
  assert.ok(v6.includes('fabricated finding'),
      'V6 must name vendor attribution from the string a fabricated finding');
  assert.ok(v6.includes('٠٫٨٥'),
      'V6 must give the Indic-digit tell for <=66 sources');

  // (f) Clarifications that exist to PREVENT false reports: a 0 that is a
  //     real measurement must not be read as a missing value.
  assert.ok(v6.includes('ZERO IS A REAL VALUE'),
      'V6 must state that cpuUsageFallbackFromSample 0 is real');
  assert.ok(v6.includes('absence is signalled by -1, not by 0'),
      'V6 must define -1 as the absence sentinel');
  assert.ok(v6.includes('expected SELinux behaviour'),
      'V6 must frame the blocked /proc/stat as expected, not a fault');
  assert.ok(v6.includes('thermalStatusMax — ALWAYS present'),
      'V6 must state thermalStatusMax is always present');
  assert.ok(v6.includes('0 here is a measurement, not a gap'),
      'V6 must stop thermalStatusMax=0 being read as missing');
}

// ─── 11. Machine values (enum/keys) are exempt from translation ─────────
// From fix/category-grading: the LANGUAGE rule tells the model to translate
// every non-name English word, which invites translating issues[].category
// and silently drops the issue from that category's grade. The prompt must
// carve machine identifiers out explicitly.
{
  assert.ok(SYSTEM_PROMPT_V6.includes('NEVER TRANSLATE MACHINE VALUES'),
      'LANGUAGE section must exempt machine values from translation');
  const start = SYSTEM_PROMPT_V6.indexOf('NEVER TRANSLATE MACHINE VALUES');
  const block = SYSTEM_PROMPT_V6.slice(start, start + 900);
  assert.ok(block.includes('issues[].category'),
      'machine-value exemption must name issues[].category');
  assert.ok(block.includes('categoryScores keys'),
      'machine-value exemption must name categoryScores keys');

  // Carried over from that branch's memory_bw section, which asserted the
  // channel is dead UNCONDITIONALLY. That is true only at <= 65; from 66 the
  // channel is live and must be used, so the original assertion would now pin
  // a falsehood. Its intent — never let a silent channel cost the memory
  // grade — is kept here, scoped to the branch where it still holds.
  const memStart = SYSTEM_PROMPT_V6.indexOf('• memory_bw_mbps (v[9])');
  assert.ok(memStart >= 0, 'channel notes must include a memory_bw_mbps bullet');
  const bullet = SYSTEM_PROMPT_V6.slice(memStart, memStart + 1400);
  assert.ok(bullet.includes('fieldsVersion ≤ 65'),
      'memory_bw bullet must still carry a <=65 branch');
  assert.ok(bullet.includes('no memory grade impact'),
      '<=65 branch must forbid penalising memory for the silent channel');
  assert.ok(bullet.includes('memoryTestedBytes') && bullet.includes('R-01..R-03'),
      'memory_bw bullet must keep redirecting to the authoritative sources');
}

// ─── 12. Issue coverage floor (fix/prompt-schema-example) ───────────────
// Measured on one fixed payload, five real calls: the issue COUNT was stable
// at 8 but the SET was not — 12 distinct category:severity pairs appeared and
// only 4 were present in all five runs. The prompt specified how many issues
// to emit ("5-9 issues") and never which ones, so nothing anchored the list
// to the executed tests.
//
// The floor is deliberately narrow: fail/warning entries only. Widening it
// would trade one failure for its opposite — a model padding the list to look
// thorough — which the same block forbids in the next breath.
{
  // Both places the model looks: the procedure step and the output schema.
  assert.ok(SYSTEM_PROMPT_V6.includes('COVERAGE FLOOR'),
      'Step 7 must state the coverage floor');
  assert.ok(SYSTEM_PROMPT_V6.includes('MANDATORY FLOOR'),
      'the issues schema block must repeat the floor where it is emitted');

  const stepStart = SYSTEM_PROMPT_V6.indexOf('COVERAGE FLOOR');
  const step = SYSTEM_PROMPT_V6.slice(stepStart, stepStart + 900);
  assert.ok(step.includes('"fail"') && step.includes('"warning"'),
      'the floor must name both statuses it binds');
  assert.ok(step.includes('categoryName'),
      'the floor must bind an issue to the entry category, not just to a count');
  assert.ok(/identical on repeated analyses/.test(step),
      'the floor must say it is the run-to-run stable part');

  // The counterweight: a coverage rule that reads as "list everything" would
  // reintroduce variance from the other side.
  assert.ok(step.includes('Do not') && step.includes('pad the list'),
      'the floor must be paired with an explicit anti-padding clause');
  assert.ok(step.includes('cite the computed numbers'),
      'above the floor, inclusion must stay evidence-gated');

  const schemaStart = SYSTEM_PROMPT_V6.indexOf('MANDATORY FLOOR');
  const schema = SYSTEM_PROMPT_V6.slice(schemaStart, schemaStart + 900);
  assert.ok(schema.includes('5-9 issues'),
      'the existing count guidance must survive beside the floor');
  assert.ok(schema.includes('Do not pad to reach a count'),
      'the schema copy must carry the anti-padding clause too');
}

// ─── 13. buyerAdvice is declared, and declared once ─────────────────────
// There is no few-shot JSON example anywhere in this prompt — the six EXAMPLE
// blocks are prose reasoning, headed "STYLE, NOT TEMPLATE". So the schema is
// the only place the key is specified, and it has to carry all three fields.
{
  assert.ok(SYSTEM_PROMPT_V6.includes('"buyerAdvice"'),
      'the schema must declare buyerAdvice');
  const start = SYSTEM_PROMPT_V6.indexOf('"buyerAdvice"');
  const block = SYSTEM_PROMPT_V6.slice(start, start + 400);
  for (const field of ['"casual"', '"gamer"', '"photographer"']) {
    assert.ok(block.includes(field),
        `buyerAdvice must declare ${field}`);
  }

  // Naming: the schema asks camelCase for this key. runAnalysisInternal reads
  // buyer_advice ?? buyerAdvice, so both land — but the prompt must stay
  // unambiguous about which one it requests, or the assertion above is the
  // only thing keeping the two sides in step.
  assert.ok(!SYSTEM_PROMPT_V6.includes('"buyer_advice"'),
      'the schema must not request both spellings of the same key');

  // Guard against a JSON example being added later that ends before this key:
  // that is exactly the shape of drift this test exists to catch.
  assert.ok(!SYSTEM_PROMPT_V6.includes('Return ONLY this JSON'),
      'no JSON output example is expected here; if one is added it must ' +
      'include buyerAdvice and this test must be updated deliberately');
}

// ─── 13. Absence is defined, and is not a defect ────────────────────────
//
// Two statuses mean "no information": unavailable (the hardware is not there,
// or the reading was refused) and not_tested (nobody ran it). rebuildCategory-
// Scores already excludes both from the pass ratio — 7 pass + 3 not_tested
// scores 7/7, not 7/10 — but the prompt listed them in one breath and never
// said what either meant.
//
// This matters ahead of passing manualResults through: a scan where the
// technician skipped most manual checks arrives as a burst of not_tested, and
// a model that reads that as a burst of faults produces a report that punishes
// a device for what nobody looked at.
{
  const p = SYSTEM_PROMPT_V6;

  // (a) Both statuses are defined, separately.
  assert.ok(/unavailable\s+The measurement could not be taken/.test(p),
      'unavailable must be defined as a measurement that could not be taken');
  assert.ok(/not_tested\s+The test was not run/.test(p),
      'not_tested must be defined as a test that was not run');

  // (b) They are joined as absence and separated as meaning — both halves
  //     matter. Joining them without separating invites one to stand in for
  //     the other; separating without joining loses the shared consequence.
  assert.ok(/BOTH absence of information, and neither is\s+evidence of a defect/
      .test(p), 'both must be named as absence, and neither as a defect');
  assert.ok(/Do not merge them/.test(p),
      'the prompt must forbid collapsing the two statuses');

  // (c) The rule that stops a defect being built on absence.
  assert.ok(p.includes('ABSENCE IS NOT A DEFECT'),
      'Step 7 must carry the absence rule');
  const start = p.indexOf('ABSENCE IS NOT A DEFECT');
  const block = p.slice(start, start + 1100);
  assert.ok(/only support is a not_tested or unavailable/.test(block),
      'the rule must name what it forbids: absence as sole support');
  assert.ok(/needs a "fail", a "warning", or a raw measurement/.test(block),
      'the rule must name what an issue does need');

  // (d) The counterweight. A rule that only forbids would suppress honest
  //     disclosure of thin coverage, which is information the buyer wants.
  assert.ok(/info-level issue is the right place for it/.test(block),
      'disclosing thin coverage at info level must stay explicitly allowed');
  assert.ok(/Disclose the gap; do not charge for it/.test(block),
      'the rule must separate disclosing from penalising');

  // (e) Repeated where issues are actually emitted, not only where the
  //     verdict is formed.
  const iStart = p.indexOf('Absence is never the support for an issue');
  assert.ok(iStart >= 0, 'the issues block must repeat the rule');
  assert.ok(p.slice(iStart, iStart + 400).includes('info level is fine'),
      'the issues-block copy must keep the disclosure carve-out');

  // (f) Step 6 must agree with rebuildCategoryScores on the denominator.
  //     The prompt does not compute the grade, but a model told that absences
  //     lower the ratio will write notes that contradict the stored score.
  assert.ok(/7 pass \+ 3 not_tested is 7 of 7/.test(p),
      'Step 6 must state the denominator rule in concrete terms');
  assert.ok(/Only pass \/ fail \/ warning are executed tests/.test(p),
      'Step 6 must name which statuses count as executed');
}

console.log('systemPromptV6: 13/13 tests passed');

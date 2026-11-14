// Unit test: provider request shape + error classification + retry policy
// (fix/ai-thinking-budget).
//
// Context: for 30 days DeepSeek produced ZERO complete reports and 86% of
// scans fell through to Gemini, with no log line explaining a single failure.
// Two root causes, both locked down here:
//
//   1. `thinking` was nested under `extra_body` — an OpenAI-Python SDK
//      convention the SDK unwraps before sending. Over raw fetch it reached
//      the provider as an unknown key and was dropped, so thinking ran at the
//      default high effort rather than ours.
//   2. max_tokens is SHARED between reasoning and answer. At 16384, high-effort
//      reasoning consumed the lot. Production proof:
//        [deepseek] OK in 73546ms ... output=16384 finish=length
//      — exactly the ceiling, then truncated, and thrown as the generic
//      "returned empty content" because the log line sat AFTER the throw.
//
// Runs with no emulator and no network: fetch and the Gemini SDK are stubbed.
//
// Run: node functions/test/aiCallShape.test.js

const Module = require("module");

const results = []; let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}

// ── Stub the Gemini SDK before anything requires it ──────────────────
let geminiModelParams = null;
let geminiRequestOptions = null;
let geminiBehaviour = () => ({
  response: {
    text: () => JSON.stringify({grade: "B", score: 80}),
    candidates: [{finishReason: "STOP"}],
    usageMetadata: {
      promptTokenCount: 1000, candidatesTokenCount: 4200,
      thoughtsTokenCount: 3100, totalTokenCount: 8300,
    },
  },
});
const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel(params, requestOptions) {
      geminiModelParams = params;
      geminiRequestOptions = requestOptions;
      return {generateContent: async () => geminiBehaviour()};
    }
  }},
};

const {
  callDeepSeek, DeepSeekError, DEEPSEEK_MODEL, DEEPSEEK_MAX_TOKENS,
} = require("../src/analysis/callDeepSeek");
const {
  callGeminiFallback, GEMINI_THINKING_BUDGET, GEMINI_TIMEOUT_MS,
  GEMINI_MAX_OUTPUT_TOKENS,
} = require("../src/analysis/callGemini");

// ── fetch stub ───────────────────────────────────────────────────────
let lastBody = null;
function stubFetch(envelope, {ok = true, status = 200, throws = null} = {}) {
  global.fetch = async (url, opts) => {
    lastBody = JSON.parse(opts.body);
    if (throws) throw throws;
    return {
      ok, status,
      json: async () => envelope,
      text: async () => (typeof envelope === "string" ? envelope : JSON.stringify(envelope)),
    };
  };
}
const ok = (content, finish = "stop", usage = {}) => ({
  model: "deepseek-flash",
  choices: [{message: {content}, finish_reason: finish}],
  usage: {
    completion_tokens: 4200, prompt_cache_hit_tokens: 11136,
    prompt_cache_miss_tokens: 82671,
    completion_tokens_details: {reasoning_tokens: 9000}, ...usage,
  },
});
async function grab(fn) {
  try {
    await fn(); return null;
  } catch (e) {
    return e;
  }
}

(async () => {
  // ===== 1. Request shape — the actual bug =====
  stubFetch(ok(JSON.stringify({grade: "A"})));
  await callDeepSeek("u", "s", "k");

  assert(lastBody.extra_body === undefined,
      "1. extra_body is GONE (it never reached the provider over raw fetch)");
  assert(lastBody.thinking && typeof lastBody.thinking === "object",
      "1. thinking is a TOP-LEVEL request field");
  assert(lastBody.thinking.type === "enabled",
      "1. thinking.type = enabled");
  assert(lastBody.thinking.reasoning_effort === "high",
      "1. reasoning_effort stays high (thinking is wanted, not trimmed)");
  assert(lastBody.max_tokens === 65536 && DEEPSEEK_MAX_TOKENS === 65536,
      "1. max_tokens raised 16384 → 65536 (official thinking-mode default)");
  assert(lastBody.model === "deepseek-flash" && DEEPSEEK_MODEL === "deepseek-flash",
      "1. canonical model id (deepseek-v4-flash was an undocumented alias)");
  assert(lastBody.response_format.type === "json_object" &&
         lastBody.temperature === 0.1,
  "1. unchanged: json_object + temperature 0.1");

  // ===== 2. Error classification — three distinct causes =====
  // (a) truncated before any content — the production failure
  stubFetch(ok(null, "length", {completion_tokens: 65536}));
  const eTrunc = await grab(() => callDeepSeek("u", "s", "k"));
  assert(eTrunc instanceof DeepSeekError && eTrunc.kind === "truncated",
      "2a. no content + finish=length → kind 'truncated', NOT 'empty content'");
  assert(/finish_reason=length/.test(eTrunc.message) &&
         /reasoning=/.test(eTrunc.message),
  "2a. message carries finish_reason and reasoning tokens");
  assert(eTrunc.retryable === true, "2a. truncation is retryable");
  assert(eTrunc.meta.completionTokens === 65536 && eTrunc.meta.reasoningTokens === 9000,
      "2a. meta carries the token numbers for the caller");

  // (b) genuinely empty
  stubFetch(ok(null, "stop", {completion_tokens: 0}));
  const eEmpty = await grab(() => callDeepSeek("u", "s", "k"));
  assert(eEmpty.kind === "empty_content",
      "2b. no content + finish=stop → kind 'empty_content' (distinct cause)");
  assert(eEmpty.retryable === true, "2b. empty content is retryable");

  // (c) provider error inside HTTP 200
  stubFetch({error: {message: "insufficient balance"}, choices: []});
  const eProv = await grab(() => callDeepSeek("u", "s", "k"));
  assert(eProv.kind === "provider_error",
      "2c. error object inside a 200 → kind 'provider_error'");
  assert(/insufficient balance/.test(eProv.message),
      "2c. the provider's real message is surfaced, not a generic string");
  assert(eProv.retryable === false, "2c. provider error is NOT retryable");

  // (d) HTTP errors split by class
  stubFetch("unauthorized", {ok: false, status: 401});
  const e401 = await grab(() => callDeepSeek("u", "s", "k"));
  assert(e401.kind === "http_error" && e401.retryable === false,
      "2d. HTTP 401 → not retryable (a retry fails identically)");
  stubFetch("upstream boom", {ok: false, status: 503});
  const e503 = await grab(() => callDeepSeek("u", "s", "k"));
  assert(e503.retryable === true, "2d. HTTP 503 → retryable (transient)");

  // (e) timeout
  const to = new Error("timed out"); to.name = "TimeoutError";
  stubFetch(null, {throws: to});
  const eTo = await grab(() => callDeepSeek("u", "s", "k"));
  assert(eTo.kind === "timeout" && eTo.retryable === false,
      "2e. timeout → NOT retryable (a second wait would starve Gemini)");

  // (f) unparseable beyond repair.
  // An HTML error page is the realistic shape here (a gateway or WAF answering
  // instead of the model) and is one of the few things jsonrepair cannot
  // salvage — it rescues loose prose, stray braces and unterminated strings,
  // which is why plain garbage text does NOT reach this branch.
  stubFetch(ok("<html><body>502 Bad Gateway</body></html>"));
  const eParse = await grab(() => callDeepSeek("u", "s", "k"));
  assert(eParse && eParse.kind === "parse_failed" && eParse.retryable === true,
      "2f. unrepairable output (HTML error page) → 'parse_failed', retryable");

  // Guard on the repair path itself: loose prose IS salvaged, so a model that
  // rambles instead of answering must not be thrown away.
  stubFetch(ok("{grade: 'B', score: 80,}"));
  const repaired = await callDeepSeek("u", "s", "k");
  assert(repaired.grade === "B" && repaired.score === 80,
      "2f. malformed-but-recoverable JSON is repaired, not failed");

  // (g) truncated but still parseable → succeeds, no throw
  stubFetch(ok(JSON.stringify({grade: "C"}), "length"));
  const salvaged = await callDeepSeek("u", "s", "k");
  assert(salvaged.grade === "C",
      "2g. truncated but parseable content is still used (no needless failure)");

  // ===== 3. Gemini =====
  geminiBehaviour = () => ({
    response: {
      text: () => JSON.stringify({grade: "B", score: 80}),
      candidates: [{finishReason: "STOP"}],
      usageMetadata: {
        promptTokenCount: 1000, candidatesTokenCount: 4200,
        thoughtsTokenCount: 3100, totalTokenCount: 8300,
      },
    },
  });
  await callGeminiFallback("u", "s", "k");
  const gc = geminiModelParams.generationConfig;

  assert(gc.thinkingConfig && gc.thinkingConfig.thinkingBudget === GEMINI_THINKING_BUDGET,
      "3. thinkingConfig.thinkingBudget passed through generationConfig");
  assert(GEMINI_THINKING_BUDGET === 8192,
      "3. budget 8192 — leaves ~8000 for a 4000-4300 token answer");
  assert(GEMINI_THINKING_BUDGET < GEMINI_MAX_OUTPUT_TOKENS,
      "3. budget strictly below maxOutputTokens (which INCLUDES thinking)");
  assert(geminiRequestOptions && geminiRequestOptions.timeout === GEMINI_TIMEOUT_MS,
      "3. RequestOptions.timeout set (there was NO timeout at all before)");
  assert(GEMINI_TIMEOUT_MS === 55000, "3. Gemini timeout 55s");

  geminiBehaviour = () => ({
    response: {
      text: () => "",
      candidates: [{finishReason: "MAX_TOKENS"}],
      usageMetadata: {candidatesTokenCount: 16384, thoughtsTokenCount: 16000},
    },
  });
  const eG = await grab(() => callGeminiFallback("u", "s", "k"));
  assert(eG.kind === "truncated" && /thoughts=16000/.test(eG.message),
      "3. empty + MAX_TOKENS → 'truncated', thoughts count in the message");

  // ===== 4. Retry policy =====
  const callAiPath = require.resolve("../src/analysis/callAI");
  delete require.cache[callAiPath];
  const src = require("fs").readFileSync(callAiPath, "utf8");

  assert(/callDeepSeekWithRetry/.test(src), "4. retry helper exists");
  assert(/AI_TOTAL_BUDGET_MS\s*=\s*265000/.test(src),
      "4. time budget 265s (300s function timeout minus 35s of post-work)");
  assert(/err\.retryable === true/.test(src),
      "4. retry gated on the error being repairable");
  assert(/elapsed \+ needed\) <= AI_TOTAL_BUDGET_MS/.test(src),
      "4. retry ALSO gated on enough time remaining for retry + Gemini");
  assert(/attempt <= 2/.test(src), "4. exactly one retry, not a loop");
  assert(!/deepseek-v4-flash/.test(src),
      "4. no stale model id left in the orchestrator");

  // The arithmetic the budget guard protects
  const DS = 130000, GEM = 55000, BUDGET = 265000;
  assert(DS + DS + GEM > BUDGET,
      "4. worst case (2×DeepSeek + Gemini) EXCEEDS the budget — " +
      "which is exactly why the time gate is needed");
  assert(73546 + DS + GEM <= BUDGET,
      "4. the real production failure (73.5s) leaves room to retry AND fall back");
  assert(!(120000 + DS + GEM <= BUDGET),
      "4. a slow 120s failure correctly skips the retry to protect Gemini");

  // ─── 5. ts dropped from the outgoing payload only ──────────────────
  //
  // Each sample carried both `ts` (absolute epoch ms) and `v[0]`
  // (SystemClock.elapsedRealtime, ms since boot). They are NOT equal — on
  // scan 629485e9 they differed in all 1607 samples — but their difference
  // took only four distinct values spanning 11 ms across an eight-minute
  // scan, so `ts` is an affine function of `v[0]` whose anchor already sits
  // in header.startTimestamp. Dropping it from the request costs no
  // information and saves 30,533 of 176,278 bytes (17.3%).
  //
  // The drop must be confined to the outgoing copy: Firestore, the Storage
  // upload, the V5 precompute path and the dormant lab features all read
  // s.ts and must keep seeing it.
  {
    assert(/function stripSampleTs\(/.test(src),
        "5. callAI defines the sample stripper");
    assert(/samples: stripSampleTs\(/.test(src),
        "5. the V6 body build routes samples through it");

    // Only the outgoing copy. If the stripper were applied to `fingerprint`
    // itself, the saved document would lose ts too.
    assert(!/fingerprint\.samples\s*=\s*stripSampleTs/.test(src),
        "5. the source fingerprint is not mutated");
    assert(!/fingerprint\.timeSeries\.samples\s*=/.test(src),
        "5. the stored time-series is not mutated");

    // Behaviour, not just presence.
    const strip = new Function(
        src.slice(src.indexOf('function stripSampleTs('),
            src.indexOf('async function callAI(')) +
        '; return stripSampleTs;')();

    const input = [
      {phase: 1, ts: 1789468089616, v: [191.0, 30.4]},
      {phase: 2, ts: 1789468089617, v: [192.0, 30.5]},
    ];
    const out = strip(input);
    assert(out.length === 2, "5. every sample survives the strip");
    assert(!('ts' in out[0]) && !('ts' in out[1]),
        "5. ts is gone from the copy");
    assert(out[0].phase === 1 && out[0].v[0] === 191.0,
        "5. phase and v are preserved untouched");
    assert('ts' in input[0] && input[0].ts === 1789468089616,
        "5. the INPUT array is left intact — this is what protects the " +
        "stored document and the Storage upload");

    // Shapes that must not throw.
    assert(strip([]).length === 0, "5. empty sample array is safe");
    const odd = strip([null, 7, {v: [1]}]);
    assert(odd[0] === null && odd[1] === 7 && !('ts' in odd[2]),
        "5. non-object entries pass through unchanged");
  }

  // ─── 6. the prompt no longer advertises a per-sample ts ─────────────
  // A schema that still promises `ts: <ms>` while the payload omits it
  // teaches the model to look for a field that is not there.
  {
    const {SYSTEM_PROMPT_V6} = require("../src/prompts/systemPromptV6");
    assert(!/ts: <ms>/.test(SYSTEM_PROMPT_V6),
        "6. the sample shape no longer lists ts");
    assert(/elapsedRealtime\(\)/.test(SYSTEM_PROMPT_V6),
        "6. v[0] is named as the time base");
    assert(/header\.startTimestamp/.test(SYSTEM_PROMPT_V6),
        "6. the prompt points at the one absolute anchor that remains");
    assert(/do not treat its absence as missing data/i
        .test(SYSTEM_PROMPT_V6),
        "6. the model is told the absence is deliberate, not a gap");
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});

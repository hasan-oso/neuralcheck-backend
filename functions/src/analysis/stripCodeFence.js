// ===================================================
// stripCodeFence — يُزيل ```json ... ``` التي قد يضيفها النموذج
// رغم response_format/responseMimeType = json
// ===================================================
function stripCodeFence(text) {
  if (!text || typeof text !== "string") return text;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/i, "");
  return cleaned.trim();
}

module.exports = {stripCodeFence};

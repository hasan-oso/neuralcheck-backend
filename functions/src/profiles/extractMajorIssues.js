// ===================================================
// extractMajorIssues — يستخرج أهم 3 issues من aiResult لـ scanHistory.summary
// (الـ aiResult قد يحوي issues_titles[] أو issues[].title — كلاهما مدعوم)
// ===================================================
function extractMajorIssues(aiResult) {
  if (!aiResult) return [];
  if (Array.isArray(aiResult.issues_titles)) {
    return aiResult.issues_titles.slice(0, 3);
  }
  if (Array.isArray(aiResult.issues)) {
    return aiResult.issues
        .slice(0, 3)
        .map((i) => i.title || i.name || "")
        .filter(Boolean);
  }
  return [];
}

module.exports = {extractMajorIssues};

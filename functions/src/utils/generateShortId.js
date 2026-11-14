// ===================================================
// توليد معرّف قصير قابل للقراءة للتقرير (NC-XXXXXX)
// حروف بلا I/O/0/1 لتجنّب الالتباس
// ===================================================
function generateShortId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "NC-";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

module.exports = {generateShortId};

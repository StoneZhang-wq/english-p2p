const { requireAuth } = require("./requireAuth");

function parseAdminEmails() {
  const raw = (process.env.ADMIN_EMAILS || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * 最小管理员鉴权：
 * - 先 requireAuth 拿到 req.user.email
 * - 再校验 email 是否在 ADMIN_EMAILS 白名单中
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, function (err) {
    if (err) return next(err);
    const allow = parseAdminEmails();
    const email = String(req.user?.email || "").trim().toLowerCase();
    if (!email || !allow.has(email)) {
      return res.status(403).json({ code: 403, message: "无管理员权限", data: null });
    }
    next();
  });
}

module.exports = { requireAdmin };


const jwt = require("jsonwebtoken");
const { getDb } = require("../db");
const { COOKIE_NAME, jwtSecret } = require("../config/authConfig");

/**
 * 校验 Cookie JWT，写入 req.user（公开字段）。未登录则 401。
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ code: 401, message: "请先登录", data: null });
  }
  try {
    const payload = jwt.verify(token, jwtSecret());
    const row = getDb()
      .prepare("SELECT id, email, nickname, credit_score, created_at FROM users WHERE id = ?")
      .get(payload.sub);
    if (!row) {
      return res.status(401).json({ code: 401, message: "登录已失效", data: null });
    }
    req.user = {
      id: row.id,
      email: row.email,
      nickname: row.nickname,
      creditScore: row.credit_score,
      createdAt: row.created_at,
    };
    next();
  } catch {
    return res.status(401).json({ code: 401, message: "登录已失效", data: null });
  }
}

module.exports = { requireAuth };

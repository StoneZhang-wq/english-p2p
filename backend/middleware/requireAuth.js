const jwt = require("jsonwebtoken");
const { getPool } = require("../db");
const { COOKIE_NAME, jwtSecret } = require("../config/authConfig");

/**
 * 校验 Cookie JWT，写入 req.user（公开字段）。未登录则 401。
 */
async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ code: 401, message: "请先登录", data: null });
  }
  try {
    const payload = jwt.verify(token, jwtSecret());
    const uid = Number(payload.sub);
    const { rows } = await getPool().query(
      "SELECT id, email, nickname, credit_score, created_at FROM users WHERE id = $1",
      [uid]
    );
    const row = rows[0];
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
  } catch (e) {
    if (e && (e.name === "JsonWebTokenError" || e.name === "TokenExpiredError")) {
      return res.status(401).json({ code: 401, message: "登录已失效", data: null });
    }
    next(e);
  }
}

module.exports = { requireAuth };

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDb } = require("../db");
const {
  COOKIE_NAME,
  jwtSecret,
  cookieOptions,
  clearCookieOptions,
} = require("../config/authConfig");

const router = express.Router();
const BCRYPT_ROUNDS = 10;

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    creditScore: row.credit_score,
    createdAt: row.created_at,
  };
}

router.post("/register", (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const nickname = String(req.body?.nickname || "").trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ code: 400, message: "邮箱格式无效", data: null });
    }
    if (password.length < 8) {
      return res.status(400).json({ code: 400, message: "密码至少 8 位", data: null });
    }
    if (!nickname || nickname.length > 50) {
      return res.status(400).json({ code: 400, message: "昵称 1～50 字", data: null });
    }

    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const db = getDb();
    let result;
    try {
      result = db
        .prepare("INSERT INTO users (email, nickname, password_hash) VALUES (?, ?, ?)")
        .run(email, nickname, hash);
    } catch (e) {
      var unique =
        e &&
        (e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
          e.code === 19 ||
          (e.message && /UNIQUE constraint failed/i.test(e.message)));
      if (unique) {
        return res.status(409).json({ code: 409, message: "该邮箱已注册", data: null });
      }
      throw e;
    }

    const token = jwt.sign({ sub: result.lastInsertRowid }, jwtSecret(), { expiresIn: "7d" });
    res.cookie(COOKIE_NAME, token, cookieOptions());
    const row = db.prepare("SELECT id, email, nickname, credit_score, created_at FROM users WHERE id = ?").get(
      result.lastInsertRowid
    );
    res.json({ code: 0, message: "ok", data: { user: publicUser(row) } });
  } catch (e) {
    if (e.message && String(e.message).includes("JWT_SECRET")) {
      return res.status(503).json({ code: 503, message: "服务器未配置 JWT_SECRET", data: null });
    }
    console.error("[auth] register", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

router.post("/login", (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) {
      return res.status(400).json({ code: 400, message: "请填写邮箱和密码", data: null });
    }
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!row || !row.password_hash || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ code: 401, message: "邮箱或密码错误", data: null });
    }
    const token = jwt.sign({ sub: row.id }, jwtSecret(), { expiresIn: "7d" });
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({
      code: 0,
      message: "ok",
      data: { user: publicUser(row) },
    });
  } catch (e) {
    if (e.message && String(e.message).includes("JWT_SECRET")) {
      return res.status(503).json({ code: 503, message: "服务器未配置 JWT_SECRET", data: null });
    }
    console.error("[auth] login", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, clearCookieOptions());
  res.json({ code: 0, message: "ok", data: null });
});

router.get("/me", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.json({ code: 0, message: "ok", data: { user: null } });
  }
  try {
    const payload = jwt.verify(token, jwtSecret());
    const db = getDb();
    const row = db.prepare("SELECT id, email, nickname, credit_score, created_at FROM users WHERE id = ?").get(
      payload.sub
    );
    if (!row) {
      res.clearCookie(COOKIE_NAME, clearCookieOptions());
      return res.json({ code: 0, message: "ok", data: { user: null } });
    }
    res.json({ code: 0, message: "ok", data: { user: publicUser(row) } });
  } catch {
    res.clearCookie(COOKIE_NAME, clearCookieOptions());
    return res.json({ code: 0, message: "ok", data: { user: null } });
  }
});

module.exports = router;

/** httpOnly Cookie 名与 JWT 配置（供 auth 路由与中间件共用） */
exports.COOKIE_NAME = "p2p_token";

exports.jwtSecret = function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set (min 16 chars) in production");
  }
  return "dev-only-insecure-secret-change-me";
};

exports.cookieOptions = function cookieOptions() {
  const prod = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: prod,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
};

exports.clearCookieOptions = function clearCookieOptions() {
  return {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
};

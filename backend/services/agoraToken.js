/**
 * 声网 RTC Token（服务端生成，必须开启控制台 App Certificate）
 * 使用官方 npm 包 agora-token（RtcTokenBuilder2）
 */
const { RtcTokenBuilder, RtcRole } = require("agora-token");

const CHANNEL_MAX = 64;
const CHANNEL_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function assertConfig() {
  const appId = process.env.AGORA_APP_ID;
  const certificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !certificate) {
    const err = new Error("AGORA_APP_ID / AGORA_APP_CERTIFICATE 未配置，无法生成 Token");
    err.code = "AGORA_CONFIG";
    throw err;
  }
  return { appId, certificate };
}

/**
 * @param {string} channelName
 * @param {number} uid 整数 UID，须与前端 join 时一致
 * @param {number} [expireSeconds] Token 有效期（秒），默认 3600
 */
function buildRtcToken(channelName, uid, expireSeconds = 3600) {
  const { appId, certificate } = assertConfig();

  if (!channelName || typeof channelName !== "string") {
    const err = new Error("channelName 无效");
    err.code = "BAD_CHANNEL";
    throw err;
  }
  const ch = channelName.trim();
  if (ch.length > CHANNEL_MAX || !CHANNEL_PATTERN.test(ch)) {
    const err = new Error("频道名仅允许字母数字下划线横线，长度 1–64");
    err.code = "BAD_CHANNEL";
    throw err;
  }

  const u = Number(uid);
  if (!Number.isInteger(u) || u < 0 || u > 0xffffffff) {
    const err = new Error("uid 须为 0 到 2^32-1 的整数");
    err.code = "BAD_UID";
    throw err;
  }

  const tokenExpire = Math.min(Math.max(60, expireSeconds), 24 * 3600);
  const privilegeExpire = tokenExpire;

  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    certificate,
    ch,
    u,
    RtcRole.PUBLISHER,
    tokenExpire,
    privilegeExpire
  );

  return { token, appId, channelName: ch, uid: u, expiresIn: tokenExpire };
}

module.exports = { buildRtcToken, CHANNEL_PATTERN };

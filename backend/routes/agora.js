const express = require("express");
const { buildRtcToken } = require("../services/agoraToken");

const router = express.Router();

/**
 * POST /api/agora/rtc-token
 * Body: { channelName: string, uid: number }
 * 生产必须：登录态 + 校验 channel 与当前用户在 pairs 中匹配（防枚举频道窃听）。当前仍为演示骨架。
 */
router.post("/rtc-token", (req, res) => {
  try {
    const { channelName, uid } = req.body || {};
    const result = buildRtcToken(channelName, uid);
    res.json({
      code: 0,
      message: "success",
      data: {
        appId: result.appId,
        channelName: result.channelName,
        token: result.token,
        uid: result.uid,
        expiresIn: result.expiresIn,
      },
    });
  } catch (e) {
    if (e.code === "AGORA_CONFIG") {
      return res.status(503).json({
        code: 503,
        message: e.message,
        data: null,
      });
    }
    if (e.code === "BAD_CHANNEL" || e.code === "BAD_UID") {
      return res.status(400).json({
        code: 400,
        message: e.message,
        data: null,
      });
    }
    console.error("[agora] rtc-token", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

module.exports = router;

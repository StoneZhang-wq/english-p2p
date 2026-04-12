const express = require("express");
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { buildRtcToken } = require("../services/agoraToken");
const { waitingChannelForTimeslot } = require("../utils/agoraChannelNames");

const router = express.Router();

/**
 * POST /api/agora/rtc-token-booking
 * Body: { timeslot_id: number }
 * 已预约该场次：未配对时下发「等待大厅」频道；已写入 pairs 则下发 1v1 频道。
 */
router.post("/rtc-token-booking", requireAuth, async (req, res) => {
  const tid = Number(req.body?.timeslot_id);
  if (!tid || Number.isNaN(tid)) {
    return res.status(400).json({ code: 400, message: "请提供 timeslot_id", data: null });
  }

  const uid = Number(req.user.id);
  if (!Number.isInteger(uid) || uid < 0 || uid > 0xffffffff) {
    return res.status(400).json({ code: 400, message: "用户 UID 无法用于声网", data: null });
  }

  try {
    const pool = getPool();
    const ok = await pool.query(
      `SELECT 1 FROM bookings WHERE timeslot_id = $1 AND user_id = $2 AND status = 'confirmed' LIMIT 1`,
      [tid, req.user.id]
    );
    if (!ok.rowCount) {
      return res.status(403).json({ code: 403, message: "无该场次的有效预约", data: null });
    }

    const p = await pool.query(
      `SELECT channel_name FROM pairs WHERE timeslot_id = $1 AND (user_a = $2 OR user_b = $2) LIMIT 1`,
      [tid, req.user.id]
    );
    const paired = p.rows[0];
    const channelName = paired ? paired.channel_name : waitingChannelForTimeslot(tid);
    const rtcMode = paired ? "paired" : "waiting";

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
        rtcMode,
        timeslotId: tid,
      },
    });
  } catch (e) {
    if (e.code === "AGORA_CONFIG") {
      return res.status(503).json({ code: 503, message: e.message, data: null });
    }
    if (e.code === "BAD_CHANNEL" || e.code === "BAD_UID") {
      return res.status(400).json({ code: 400, message: e.message, data: null });
    }
    console.error("[agora] rtc-token-booking", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

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

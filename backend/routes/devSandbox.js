const express = require("express");
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { getSandboxLabSnapshot, refreshSandboxTimeslot } = require("../services/sandboxLab");

const router = express.Router();

/** 当前沙箱 theme_id / timeslot_id 与深链（无需登录，便于复制） */
router.get("/sandbox-lab", async (_req, res) => {
  try {
    const snap = await getSandboxLabSnapshot(getPool());
    if (!snap) {
      return res.status(503).json({ code: 503, message: "沙箱未就绪，请确认数据库已迁移并重启服务", data: null });
    }
    res.json({
      code: 0,
      message: "ok",
      data: {
        themeId: snap.themeId,
        timeslotId: snap.timeslotId,
        startTime: snap.startTime,
        endTime: snap.endTime,
        bookingPath: `/booking.html?theme_id=${snap.themeId}`,
        roomPathTemplate: snap.timeslotId ? `/room.html?timeslot_id=${snap.timeslotId}` : null,
        pairDevNote: "两名用户均预约该 timeslot 后，调用 POST /api/dev/pair-timeslot（须登录，开发环境可用）",
      },
    });
  } catch (e) {
    console.error("[dev sandbox-lab]", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

/**
 * 将沙箱场次重置为「上海 now+3min ~ now+63min」，并清空该场次 bookings / pairs。
 * 须登录，避免被匿名频繁刷写。
 */
router.post("/sandbox-slot/refresh", requireAuth, async (_req, res) => {
  try {
    const data = await refreshSandboxTimeslot(getPool());
    res.json({ code: 0, message: "ok", data });
  } catch (e) {
    if (e.code === "NO_SANDBOX") {
      return res.status(503).json({ code: 503, message: e.message, data: null });
    }
    console.error("[dev sandbox-slot/refresh]", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

module.exports = router;

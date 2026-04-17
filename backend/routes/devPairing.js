const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { getPool } = require("../db");
const { devPairTimeslotForCaller } = require("../services/devPairTimeslot");

const router = express.Router();

/**
 * Body: { timeslot_id: number }
 * 调用者须在该场次有已确认预约；与另一名已预约用户（任意等级）写入 pairs（并清空该场次旧 pairs）。
 */
router.post("/pair-timeslot", requireAuth, async (req, res) => {
  const timeslotId = Number(req.body?.timeslot_id);
  if (!timeslotId || Number.isNaN(timeslotId)) {
    return res.status(400).json({ code: 400, message: "请提供 timeslot_id", data: null });
  }

  try {
    const data = await devPairTimeslotForCaller(getPool(), req.user.id, timeslotId);
    res.json({
      code: 0,
      message: "ok",
      data: {
        pairId: data.pairId,
        timeslotId: data.timeslotId,
        channelName: data.channelName,
        userA: data.userA,
        userB: data.userB,
      },
    });
  } catch (e) {
    const map = {
      INVALID: [400, "参数无效"],
      NOT_FOUND: [404, "场次不存在"],
      NEED_TWO: [409, "该场次需要至少两名已确认预约的用户"],
      NO_MATCH: [409, "你在该场次无预约，或该场次没有其他已确认预约用户可配对"],
    };
    const pair = map[e.code];
    if (pair) {
      return res.status(pair[0]).json({ code: pair[0], message: pair[1], data: null });
    }
    console.error("[dev pair-timeslot]", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

module.exports = router;

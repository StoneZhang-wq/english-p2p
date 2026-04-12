const express = require("express");
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { cancelBooking } = require("../services/cancelBooking");

const router = express.Router();

router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: 400, message: "参数无效", data: null });
  }

  try {
    await cancelBooking(getPool(), req.user.id, id);
    res.json({ code: 0, message: "ok", data: null });
  } catch (e) {
    const map = {
      NOT_FOUND: [404, "预约不存在"],
      BAD_STATE: [409, "该预约已无法取消"],
      STARTED: [409, "场次已开始，无法取消"],
      INVALID: [400, "参数无效"],
    };
    const pair = map[e.code];
    if (pair) {
      return res.status(pair[0]).json({ code: pair[0], message: pair[1], data: null });
    }
    console.error("[cancel-booking]", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

module.exports = router;

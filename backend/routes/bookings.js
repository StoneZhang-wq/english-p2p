const express = require("express");
const { getDb } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { bookTimeslot } = require("../services/bookTransaction");

const router = express.Router();

const LEVEL_MAP = {
  beginner: "beginner",
  mid: "intermediate",
  adv: "advanced",
};

const ALLOWED_LEVELS = new Set(["beginner", "intermediate", "advanced"]);

/**
 * POST /api/bookings
 * Body: { timeslot_id, level } — level 可为前端 beginner/mid/adv 或已是库内枚举。
 */
router.post("/", requireAuth, (req, res) => {
  const timeslotId = Number(req.body?.timeslot_id);
  const rawLevel = String(req.body?.level || "").trim();
  const level = LEVEL_MAP[rawLevel] || rawLevel;

  if (!timeslotId || Number.isNaN(timeslotId) || !ALLOWED_LEVELS.has(level)) {
    return res.status(400).json({ code: 400, message: "参数无效（timeslot_id / level）", data: null });
  }

  try {
    bookTimeslot(getDb(), req.user.id, timeslotId, level);
    res.json({ code: 0, message: "ok", data: null });
  } catch (e) {
    const map = {
      NOT_FOUND: [404, "场次不存在"],
      CLOSED: [409, "场次不可预约"],
      FULL: [409, "名额已满"],
      DUP: [409, "您已预约该场次"],
    };
    const pair = map[e.code];
    if (pair) {
      return res.status(pair[0]).json({ code: pair[0], message: pair[1], data: null });
    }
    console.error("[bookings] POST", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

/**
 * GET /api/bookings/mine
 * 含搭档信息（若 pairs 已生成）；供「我的预约」短轮询。
 */
router.get("/mine", requireAuth, (req, res) => {
  const db = getDb();
  const uid = req.user.id;

  const rows = db
    .prepare(
      `SELECT b.id, b.timeslot_id, b.level, b.status AS booking_status, b.created_at,
        t.start_time, t.end_time, t.status AS slot_status, t.booked_count, t.max_pairs,
        th.name AS theme_name
       FROM bookings b
       JOIN timeslots t ON t.id = b.timeslot_id
       JOIN themes th ON th.id = t.theme_id
       WHERE b.user_id = ? AND b.status = 'confirmed'
       ORDER BY t.start_time ASC`
    )
    .all(uid);

  const pairStmt = db.prepare(
    `SELECT user_a, user_b, channel_name, status FROM pairs
     WHERE timeslot_id = ? AND (user_a = ? OR user_b = ?)`
  );
  const userStmt = db.prepare("SELECT id, nickname, credit_score FROM users WHERE id = ?");

  const bookings = rows.map((row) => {
    const pair = pairStmt.get(row.timeslot_id, uid, uid);
    let partnerNickname = null;
    let partnerCreditScore = null;
    let channelName = null;
    let pairStatus = null;
    if (pair) {
      pairStatus = pair.status;
      channelName = pair.channel_name;
      const pid = pair.user_a === uid ? pair.user_b : pair.user_a;
      const pu = userStmt.get(pid);
      if (pu) {
        partnerNickname = pu.nickname;
        partnerCreditScore = pu.credit_score;
      }
    }
    return {
      id: row.id,
      timeslotId: row.timeslot_id,
      level: row.level,
      bookingStatus: row.booking_status,
      createdAt: row.created_at,
      startTime: row.start_time,
      endTime: row.end_time,
      slotStatus: row.slot_status,
      bookedCount: row.booked_count,
      maxPairs: row.max_pairs,
      themeName: row.theme_name,
      partnerNickname,
      partnerCreditScore,
      channelName,
      pairStatus,
    };
  });

  res.json({ code: 0, message: "ok", data: { bookings } });
});

module.exports = router;

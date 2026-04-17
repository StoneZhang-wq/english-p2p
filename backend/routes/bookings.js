const express = require("express");
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { bookTimeslot } = require("../services/bookTransaction");

const router = express.Router();

const LEVEL_MAP = {
  beginner: "beginner",
  mid: "intermediate",
  adv: "advanced",
};

const ALLOWED_LEVELS = new Set(["beginner", "intermediate", "advanced"]);

function parseShanghaiStartForBooking(sqlStr) {
  if (!sqlStr) return null;
  const str = String(sqlStr).trim();
  let iso = str.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ":00";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(iso)) return null;
  const d = new Date(`${iso}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

router.post("/", requireAuth, async (req, res) => {
  const timeslotId = Number(req.body?.timeslot_id);
  const rawLevel = String(req.body?.level || "").trim();
  const level = LEVEL_MAP[rawLevel] || rawLevel;

  if (!timeslotId || Number.isNaN(timeslotId) || !ALLOWED_LEVELS.has(level)) {
    return res.status(400).json({ code: 400, message: "参数无效（timeslot_id / level）", data: null });
  }

  try {
    const pool = getPool();
    const { rows: pre } = await pool.query(
      `SELECT to_char(ts.start_time, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
              COALESCE(th.is_sandbox, FALSE) AS is_sandbox
       FROM timeslots ts
       JOIN themes th ON th.id = ts.theme_id
       WHERE ts.id = $1 AND ts.status = 'open'`,
      [timeslotId]
    );
    if (!pre[0]) {
      return res.status(404).json({ code: 404, message: "场次不存在", data: null });
    }
    if (!pre[0].is_sandbox) {
      const startAt = parseShanghaiStartForBooking(pre[0].start_time);
      if (startAt && startAt.getTime() - Date.now() < 60 * 60 * 1000) {
        return res.status(409).json({
          code: 409,
          message: "距离开场不足 60 分钟，已停止该场次新预约",
          data: null,
        });
      }
    }

    await bookTimeslot(pool, req.user.id, timeslotId, level);
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

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const uid = req.user.id;

    const { rows } = await pool.query(
      `SELECT b.id, b.timeslot_id, b.level, b.status AS booking_status, b.created_at,
        to_char(t.start_time, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
        to_char(t.end_time, 'YYYY-MM-DD HH24:MI:SS') AS end_time,
        t.status AS slot_status, t.booked_count, t.max_pairs,
        th.id AS theme_id,
        th.name AS theme_name,
        CASE WHEN p.id IS NULL THEN NULL WHEN p.user_a = $1 THEN p.user_b ELSE p.user_a END AS partner_user_id,
        CASE WHEN p.user_a = $1 THEN ub.nickname WHEN p.user_b = $1 THEN ua.nickname END AS partner_nickname,
        CASE WHEN p.user_a = $1 THEN ub.credit_score WHEN p.user_b = $1 THEN ua.credit_score END AS partner_credit_score,
        p.channel_name,
        p.status AS pair_status
       FROM bookings b
       JOIN timeslots t ON t.id = b.timeslot_id
       JOIN themes th ON th.id = t.theme_id
       LEFT JOIN pairs p ON p.timeslot_id = b.timeslot_id AND (p.user_a = $1 OR p.user_b = $1)
       LEFT JOIN users ua ON ua.id = p.user_a
       LEFT JOIN users ub ON ub.id = p.user_b
       WHERE b.user_id = $1 AND b.status = 'confirmed'
       ORDER BY t.start_time ASC`,
      [uid]
    );

    const bookings = rows.map((row) => ({
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
      themeId: row.theme_id,
      themeName: row.theme_name,
      partnerUserId: row.partner_user_id != null ? Number(row.partner_user_id) : null,
      partnerNickname: row.partner_nickname,
      partnerCreditScore: row.partner_credit_score,
      channelName: row.channel_name,
      pairStatus: row.pair_status,
    }));

    res.json({ code: 0, message: "ok", data: { bookings } });
  } catch (e) {
    console.error("[bookings] mine", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

module.exports = router;

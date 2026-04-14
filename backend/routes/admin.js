const express = require("express");
const { getPool } = require("../db");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

function makeChannelName(timeslotId, userA, userB) {
  return `admin_eng_${timeslotId}_${userA}_${userB}_${Date.now()}`;
}

// GET /api/admin/timeslots?theme_id=123
router.get("/timeslots", requireAdmin, async (req, res) => {
  const themeId = req.query?.theme_id != null ? Number(req.query.theme_id) : null;
  if (themeId != null && (!themeId || Number.isNaN(themeId))) {
    return res.status(400).json({ code: 400, message: "theme_id 无效", data: null });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT t.id,
              t.theme_id,
              to_char(t.start_time, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
              to_char(t.end_time, 'YYYY-MM-DD HH24:MI:SS') AS end_time,
              t.status AS slot_status,
              t.booked_count,
              t.max_pairs,
              th.name AS theme_name,
              (SELECT COUNT(*)::int FROM bookings b WHERE b.timeslot_id = t.id AND b.status = 'confirmed') AS booking_confirmed_count,
              (SELECT COUNT(*)::int FROM pairs p WHERE p.timeslot_id = t.id) AS pair_count
       FROM timeslots t
       JOIN themes th ON th.id = t.theme_id
       WHERE ($1::int IS NULL OR t.theme_id = $1::int)
       ORDER BY t.start_time ASC
       LIMIT 200`,
      [themeId]
    );
    res.json({ code: 0, message: "ok", data: { timeslots: rows.map((r) => ({
      id: r.id,
      themeId: r.theme_id,
      themeName: r.theme_name,
      startTime: r.start_time,
      endTime: r.end_time,
      slotStatus: r.slot_status,
      bookedCount: r.booked_count,
      maxPairs: r.max_pairs,
      bookingConfirmedCount: r.booking_confirmed_count,
      pairCount: r.pair_count,
    })) } });
  } catch (e) {
    console.error("[admin] GET timeslots", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// GET /api/admin/timeslots/:id/bookings
router.get("/timeslots/:id/bookings", requireAdmin, async (req, res) => {
  const timeslotId = Number(req.params.id);
  if (!timeslotId || Number.isNaN(timeslotId)) {
    return res.status(400).json({ code: 400, message: "timeslot_id 无效", data: null });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT b.id AS booking_id, b.user_id, b.level, b.status, b.created_at,
              u.email, u.nickname, u.credit_score
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       WHERE b.timeslot_id = $1 AND b.status = 'confirmed'
       ORDER BY b.created_at ASC`,
      [timeslotId]
    );
    res.json({ code: 0, message: "ok", data: { bookings: rows.map((r) => ({
      bookingId: r.booking_id,
      userId: r.user_id,
      level: r.level,
      status: r.status,
      createdAt: r.created_at,
      email: r.email,
      nickname: r.nickname,
      creditScore: r.credit_score,
    })) } });
  } catch (e) {
    console.error("[admin] GET timeslot bookings", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// GET /api/admin/timeslots/:id/pairs
router.get("/timeslots/:id/pairs", requireAdmin, async (req, res) => {
  const timeslotId = Number(req.params.id);
  if (!timeslotId || Number.isNaN(timeslotId)) {
    return res.status(400).json({ code: 400, message: "timeslot_id 无效", data: null });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.id, p.timeslot_id, p.user_a, p.user_b, p.channel_name, p.status, p.created_at,
              ua.nickname AS user_a_nickname, ub.nickname AS user_b_nickname,
              ua.email AS user_a_email, ub.email AS user_b_email
       FROM pairs p
       LEFT JOIN users ua ON ua.id = p.user_a
       LEFT JOIN users ub ON ub.id = p.user_b
       WHERE p.timeslot_id = $1
       ORDER BY p.created_at ASC`,
      [timeslotId]
    );
    res.json({ code: 0, message: "ok", data: { pairs: rows.map((r) => ({
      id: r.id,
      timeslotId: r.timeslot_id,
      userA: { id: r.user_a, nickname: r.user_a_nickname, email: r.user_a_email },
      userB: { id: r.user_b, nickname: r.user_b_nickname, email: r.user_b_email },
      channelName: r.channel_name,
      status: r.status,
      createdAt: r.created_at,
    })) } });
  } catch (e) {
    console.error("[admin] GET timeslot pairs", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// POST /api/admin/timeslots/:id/pair  Body: { user_a: number, user_b: number, force?: boolean }
router.post("/timeslots/:id/pair", requireAdmin, async (req, res) => {
  const timeslotId = Number(req.params.id);
  const userA = Number(req.body?.user_a);
  const userB = Number(req.body?.user_b);
  const force = req.body?.force === true;

  if (!timeslotId || Number.isNaN(timeslotId) || !userA || Number.isNaN(userA) || !userB || Number.isNaN(userB) || userA === userB) {
    return res.status(400).json({ code: 400, message: "参数无效（timeslot_id / user_a / user_b）", data: null });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 两人都必须在该场次 confirmed 预约
    const { rows: ok } = await client.query(
      `SELECT b.user_id
       FROM bookings b
       WHERE b.timeslot_id = $1 AND b.status = 'confirmed' AND b.user_id = ANY($2::int[])
       GROUP BY b.user_id`,
      [timeslotId, [userA, userB]]
    );
    if (ok.length !== 2) {
      await client.query("ROLLBACK");
      return res.status(409).json({ code: 409, message: "两名用户都必须在该场次有已确认预约", data: null });
    }

    if (force) {
      // 强制：清掉该场次里与任一用户有关的旧 pairs（避免一人多配）
      await client.query(
        `DELETE FROM pairs
         WHERE timeslot_id = $1
           AND (user_a = ANY($2::int[]) OR user_b = ANY($2::int[]))`,
        [timeslotId, [userA, userB]]
      );
    }

    const channelName = makeChannelName(timeslotId, userA, userB);
    const ins = await client.query(
      `INSERT INTO pairs (timeslot_id, user_a, user_b, channel_name, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [timeslotId, userA, userB, channelName]
    );

    await client.query("COMMIT");
    res.json({ code: 0, message: "ok", data: { pairId: ins.rows[0].id, timeslotId, channelName, userA, userB } });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("[admin] POST pair", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  } finally {
    client.release();
  }
});

// POST /api/admin/timeslots/:id/unpair Body: { pair_id: number }
router.post("/timeslots/:id/unpair", requireAdmin, async (req, res) => {
  const timeslotId = Number(req.params.id);
  const pairId = Number(req.body?.pair_id);
  if (!timeslotId || Number.isNaN(timeslotId) || !pairId || Number.isNaN(pairId)) {
    return res.status(400).json({ code: 400, message: "参数无效（timeslot_id / pair_id）", data: null });
  }
  try {
    const pool = getPool();
    const del = await pool.query(`DELETE FROM pairs WHERE id = $1 AND timeslot_id = $2`, [pairId, timeslotId]);
    if (del.rowCount !== 1) {
      return res.status(404).json({ code: 404, message: "配对不存在", data: null });
    }
    res.json({ code: 0, message: "ok", data: null });
  } catch (e) {
    console.error("[admin] POST unpair", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

module.exports = router;


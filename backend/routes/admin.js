const express = require("express");
const { getPool } = require("../db");
const { requireAdmin } = require("../middleware/requireAdmin");
const {
  refreshActiveThemesWithLlm,
  generateThemePack,
  fetchRecentThemeDedupContext,
  validatePack,
  applySeedCoverUrl,
  PROMPT_VERSION,
} = require("../services/themeLlmEnrichment");

const router = express.Router();

function makeChannelName(timeslotId, userA, userB) {
  return `admin_eng_${timeslotId}_${userA}_${userB}_${Date.now()}`;
}

function safeJsonParse(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return obj == null ? fallback : obj;
  } catch {
    return fallback;
  }
}

// GET /api/admin/stats
router.get("/stats", requireAdmin, async (_req, res) => {
  try {
    const pool = getPool();
    const [{ rows: uCnt }, { rows: uToday }, { rows: u7 }, { rows: thCnt }, { rows: thActive }] =
      await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS c FROM users`),
        pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE created_at >= date_trunc('day', NOW())`),
        pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`),
        pool.query(`SELECT COUNT(*)::int AS c FROM themes`),
        pool.query(`SELECT COUNT(*)::int AS c FROM themes WHERE is_active = 1 AND COALESCE(is_sandbox, FALSE) = FALSE`),
      ]);
    res.json({
      code: 0,
      message: "ok",
      data: {
        usersTotal: uCnt[0]?.c || 0,
        usersNewToday: uToday[0]?.c || 0,
        usersNewLast7Days: u7[0]?.c || 0,
        themesTotal: thCnt[0]?.c || 0,
        themesActiveTotal: thActive[0]?.c || 0,
      },
    });
  } catch (e) {
    console.error("[admin] GET stats", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// GET /api/admin/timeslots?theme_id=123
router.get("/timeslots", requireAdmin, async (req, res) => {
  const themeId = req.query?.theme_id != null ? Number(req.query.theme_id) : null;
  const recent = String(req.query?.recent || "").trim() === "1";
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
         AND ($2::boolean = FALSE OR (t.start_time >= (NOW() - INTERVAL '6 hours') AND t.start_time <= (NOW() + INTERVAL '7 days')))
       ORDER BY t.start_time ASC
       LIMIT 200`,
      [themeId, recent]
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

function parseRetentionDays(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  const i = Math.floor(n);
  if (i < 1) return 1;
  if (i > 365) return 365;
  return i;
}

async function getHistoryCleanupTargets(pool, retentionDays) {
  const { rows } = await pool.query(
    `SELECT t.id AS timeslot_id,
            (SELECT COUNT(*)::int FROM bookings b WHERE b.timeslot_id = t.id) AS bookings_count,
            (SELECT COUNT(*)::int FROM pairs p WHERE p.timeslot_id = t.id) AS pairs_count
     FROM timeslots t
     JOIN themes th ON th.id = t.theme_id
     WHERE COALESCE(th.is_sandbox, FALSE) = FALSE
       AND t.end_time < (NOW() - ($1::int * INTERVAL '1 day'))
     ORDER BY t.end_time ASC
     LIMIT 2000`,
    [retentionDays]
  );
  const timeslotIds = rows.map((r) => Number(r.timeslot_id)).filter((x) => Number.isInteger(x));
  const bookingsCount = rows.reduce((s, r) => s + (Number(r.bookings_count) || 0), 0);
  const pairsCount = rows.reduce((s, r) => s + (Number(r.pairs_count) || 0), 0);
  return { timeslotIds, bookingsCount, pairsCount };
}

// GET /api/admin/timeslots/history-preview?retention_days=30
router.get("/timeslots/history-preview", requireAdmin, async (req, res) => {
  const retentionDays = parseRetentionDays(req.query?.retention_days, 30);
  try {
    const pool = getPool();
    const t = await getHistoryCleanupTargets(pool, retentionDays);
    res.json({
      code: 0,
      message: "ok",
      data: {
        retentionDays,
        timeslotsToDelete: t.timeslotIds.length,
        bookingsToDelete: t.bookingsCount,
        pairsToDelete: t.pairsCount,
        sampleTimeslotIds: t.timeslotIds.slice(0, 20),
      },
    });
  } catch (e) {
    console.error("[admin] GET timeslots/history-preview", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// POST /api/admin/timeslots/history-delete  Body: { retention_days: number, confirm: true }
router.post("/timeslots/history-delete", requireAdmin, async (req, res) => {
  const retentionDays = parseRetentionDays(req.body?.retention_days, 30);
  const confirm = req.body?.confirm === true;
  if (!confirm) {
    return res.status(400).json({ code: 400, message: "需 confirm=true 才会执行删除", data: null });
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await getHistoryCleanupTargets(client, retentionDays);
    if (!t.timeslotIds.length) {
      await client.query("ROLLBACK");
      return res.json({ code: 0, message: "ok", data: { retentionDays, deletedTimeslots: 0, deletedBookings: 0, deletedPairs: 0 } });
    }

    const delPairs = await client.query(`DELETE FROM pairs WHERE timeslot_id = ANY($1::int[])`, [t.timeslotIds]);
    const delBookings = await client.query(`DELETE FROM bookings WHERE timeslot_id = ANY($1::int[])`, [t.timeslotIds]);
    const delSlots = await client.query(`DELETE FROM timeslots WHERE id = ANY($1::int[])`, [t.timeslotIds]);

    await client.query("COMMIT");
    res.json({
      code: 0,
      message: "ok",
      data: {
        retentionDays,
        deletedTimeslots: delSlots.rowCount || 0,
        deletedBookings: delBookings.rowCount || 0,
        deletedPairs: delPairs.rowCount || 0,
      },
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("[admin] POST timeslots/history-delete", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  } finally {
    client.release();
  }
});

async function getGenerationCleanupTargets(pool, retentionDays) {
  const { rows } = await pool.query(
    `SELECT id
     FROM theme_generations
     WHERE created_at < (NOW() - ($1::int * INTERVAL '1 day'))
     ORDER BY created_at ASC
     LIMIT 5000`,
    [retentionDays]
  );
  const ids = rows.map((r) => Number(r.id)).filter((x) => Number.isInteger(x));
  return { ids };
}

// GET /api/admin/generations/history-preview?retention_days=30
router.get("/generations/history-preview", requireAdmin, async (req, res) => {
  const retentionDays = parseRetentionDays(req.query?.retention_days, 30);
  try {
    const pool = getPool();
    const t = await getGenerationCleanupTargets(pool, retentionDays);
    res.json({
      code: 0,
      message: "ok",
      data: {
        retentionDays,
        generationsToDelete: t.ids.length,
        sampleGenerationIds: t.ids.slice(0, 30),
      },
    });
  } catch (e) {
    console.error("[admin] GET generations/history-preview", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// POST /api/admin/generations/history-delete  Body: { retention_days: number, confirm: true }
router.post("/generations/history-delete", requireAdmin, async (req, res) => {
  const retentionDays = parseRetentionDays(req.body?.retention_days, 30);
  const confirm = req.body?.confirm === true;
  if (!confirm) {
    return res.status(400).json({ code: 400, message: "需 confirm=true 才会执行删除", data: null });
  }
  try {
    const pool = getPool();
    const t = await getGenerationCleanupTargets(pool, retentionDays);
    if (!t.ids.length) {
      return res.json({ code: 0, message: "ok", data: { retentionDays, deletedGenerations: 0 } });
    }
    const del = await pool.query(`DELETE FROM theme_generations WHERE id = ANY($1::int[])`, [t.ids]);
    res.json({ code: 0, message: "ok", data: { retentionDays, deletedGenerations: del.rowCount || 0 } });
  } catch (e) {
    console.error("[admin] POST generations/history-delete", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// GET /api/admin/generations?limit=30
router.get("/generations", requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query?.limit || 30) || 30)));
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id,
              created_at::text AS created_at,
              created_by_email,
              direction,
              status,
              applied_theme_id,
              applied_at::text AS applied_at,
              pack_version,
              (pack_json->>'name') AS pack_name,
              LEFT(COALESCE(pack_json->>'scene_text', ''), 120) AS scene_preview
       FROM theme_generations
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({
      code: 0,
      message: "ok",
      data: {
        generations: rows.map((r) => ({
          id: Number(r.id),
          createdAt: r.created_at,
          createdByEmail: r.created_by_email || null,
          direction: r.direction,
          status: r.status,
          appliedThemeId: r.applied_theme_id != null ? Number(r.applied_theme_id) : null,
          appliedAt: r.applied_at || null,
          packVersion: r.pack_version || null,
          packName: r.pack_name || "",
          scenePreview: r.scene_preview || "",
        })),
      },
    });
  } catch (e) {
    console.error("[admin] GET generations", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// GET /api/admin/generations/:id
router.get("/generations/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: 400, message: "generation id 无效", data: null });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id,
              created_at::text AS created_at,
              created_by_email,
              direction,
              status,
              applied_theme_id,
              applied_at::text AS applied_at,
              pack_version,
              pack_json
       FROM theme_generations
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    const r = rows[0];
    if (!r) {
      return res.status(404).json({ code: 404, message: "生成记录不存在", data: null });
    }
    res.json({
      code: 0,
      message: "ok",
      data: {
        generation: {
          id: Number(r.id),
          createdAt: r.created_at,
          createdByEmail: r.created_by_email || null,
          direction: r.direction,
          status: r.status,
          appliedThemeId: r.applied_theme_id != null ? Number(r.applied_theme_id) : null,
          appliedAt: r.applied_at || null,
          packVersion: r.pack_version || null,
          pack: r.pack_json,
        },
      },
    });
  } catch (e) {
    console.error("[admin] GET generations/:id", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// GET /api/admin/current-overview  （当前上架3主题的“当前场次”概览：场次 + 预约 + 配对）
router.get("/current-overview", requireAdmin, async (_req, res) => {
  try {
    const pool = getPool();
    const { rows: act } = await pool.query(
      `SELECT id, theme_slot, shanghai_week_monday::text AS week_monday, name
       FROM themes
       WHERE is_active = 1 AND COALESCE(is_sandbox, FALSE) = FALSE AND shanghai_week_monday IS NOT NULL
       ORDER BY shanghai_week_monday DESC, theme_slot ASC
       LIMIT 3`
    );
    const themeIds = act.map((x) => Number(x.id)).filter((n) => Number.isInteger(n));
    if (!themeIds.length) {
      return res.json({ code: 0, message: "ok", data: { themes: [], timeslots: [] } });
    }

    // 当前场次：取“最近6小时到未来7天”的场次
    const { rows: slots } = await pool.query(
      `SELECT t.id, t.theme_id,
              to_char(t.start_time, 'YYYY-MM-DD HH24:MI:SS') AS start_time,
              to_char(t.end_time, 'YYYY-MM-DD HH24:MI:SS') AS end_time,
              t.status AS slot_status,
              th.name AS theme_name
       FROM timeslots t
       JOIN themes th ON th.id = t.theme_id
       WHERE t.theme_id = ANY($1::int[])
         AND t.start_time >= (NOW() - INTERVAL '6 hours')
         AND t.start_time <= (NOW() + INTERVAL '7 days')
       ORDER BY t.start_time ASC
       LIMIT 60`,
      [themeIds]
    );
    const slotIds = slots.map((s) => Number(s.id)).filter((n) => Number.isInteger(n));

    const { rows: bookings } = slotIds.length
      ? await pool.query(
          `SELECT b.timeslot_id, b.user_id, b.level, to_char(b.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
                  u.email, u.nickname
           FROM bookings b
           JOIN users u ON u.id = b.user_id
           WHERE b.timeslot_id = ANY($1::int[]) AND b.status = 'confirmed'
           ORDER BY b.timeslot_id ASC, b.created_at ASC`,
          [slotIds]
        )
      : { rows: [] };

    const { rows: pairs } = slotIds.length
      ? await pool.query(
          `SELECT p.id, p.timeslot_id, p.user_a, p.user_b, p.channel_name, p.status, to_char(p.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
                  ua.email AS user_a_email, ua.nickname AS user_a_nickname,
                  ub.email AS user_b_email, ub.nickname AS user_b_nickname,
                  ba.level AS user_a_level, bb.level AS user_b_level
           FROM pairs p
           LEFT JOIN users ua ON ua.id = p.user_a
           LEFT JOIN users ub ON ub.id = p.user_b
           LEFT JOIN bookings ba ON ba.timeslot_id = p.timeslot_id AND ba.user_id = p.user_a AND ba.status='confirmed'
           LEFT JOIN bookings bb ON bb.timeslot_id = p.timeslot_id AND bb.user_id = p.user_b AND bb.status='confirmed'
           WHERE p.timeslot_id = ANY($1::int[])
           ORDER BY p.timeslot_id ASC, p.created_at ASC`,
          [slotIds]
        )
      : { rows: [] };

    res.json({
      code: 0,
      message: "ok",
      data: {
        themes: act.map((t) => ({ id: t.id, themeSlot: t.theme_slot, weekMonday: t.week_monday, name: t.name })),
        timeslots: slots.map((s) => ({ id: s.id, themeId: s.theme_id, themeName: s.theme_name, startTime: s.start_time, endTime: s.end_time, slotStatus: s.slot_status })),
        bookings: bookings.map((b) => ({
          timeslotId: b.timeslot_id,
          userId: b.user_id,
          level: b.level,
          createdAt: b.created_at,
          email: b.email,
          nickname: b.nickname,
        })),
        pairs: pairs.map((p) => ({
          id: p.id,
          timeslotId: p.timeslot_id,
          channelName: p.channel_name,
          status: p.status,
          createdAt: p.created_at,
          userA: { id: p.user_a, email: p.user_a_email, nickname: p.user_a_nickname, level: p.user_a_level ?? null },
          userB: { id: p.user_b, email: p.user_b_email, nickname: p.user_b_nickname, level: p.user_b_level ?? null },
        })),
      },
    });
  } catch (e) {
    console.error("[admin] GET current-overview", e);
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

    // 返回双方 level 便于管理员确认
    const { rows: lv } = await client.query(
      `SELECT user_id, level FROM bookings WHERE timeslot_id = $1 AND status='confirmed' AND user_id = ANY($2::int[])`,
      [timeslotId, [userA, userB]]
    );
    const levels = Object.fromEntries(lv.map((r) => [String(r.user_id), r.level]));

    await client.query("COMMIT");
    res.json({
      code: 0,
      message: "ok",
      data: {
        pairId: ins.rows[0].id,
        timeslotId,
        channelName,
        userA: { id: userA, level: levels[String(userA)] ?? null },
        userB: { id: userB, level: levels[String(userB)] ?? null },
        force,
      },
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("[admin] POST pair", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  } finally {
    client.release();
  }
});

// —— 周主题：LLM 刷新 / 按方向生成（仅 ADMIN_EMAILS） ——

// GET /api/admin/themes/active
router.get("/themes/active", requireAdmin, async (_req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, description, theme_slot, difficulty_level,
              shanghai_week_monday::text AS week_monday,
              llm_generated_at::text AS llm_generated_at,
              llm_prompt_version,
              LEFT(COALESCE(scene_text, ''), 160) AS scene_preview
       FROM themes
       WHERE is_active = 1
         AND COALESCE(is_sandbox, FALSE) = FALSE
         AND shanghai_week_monday IS NOT NULL
       ORDER BY shanghai_week_monday DESC, theme_slot ASC
       LIMIT 3`
    );
    res.json({
      code: 0,
      message: "ok",
      data: {
        themes: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          themeSlot: r.theme_slot,
          difficultyLevel: r.difficulty_level,
          weekMonday: r.week_monday,
          llmGeneratedAt: r.llm_generated_at,
          llmPromptVersion: r.llm_prompt_version,
          scenePreview: r.scene_preview,
        })),
      },
    });
  } catch (e) {
    console.error("[admin] GET themes/active", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// GET /api/admin/themes/active-full  （当前上架3主题完整内容）
router.get("/themes/active-full", requireAdmin, async (_req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, description, slug, theme_slot, scene_text, roles_json, cover_url, difficulty_level,
              shanghai_week_monday::text AS week_monday, preview_markdown,
              room_tasks_json, llm_generated_at::text AS llm_generated_at, llm_prompt_version
       FROM themes
       WHERE is_active = 1 AND COALESCE(is_sandbox, FALSE) = FALSE AND shanghai_week_monday IS NOT NULL
       ORDER BY shanghai_week_monday DESC, theme_slot ASC
       LIMIT 3`
    );
    const themes = rows.map((r) => {
      const roomTasks = safeJsonParse(r.room_tasks_json, null);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        slug: r.slug,
        themeSlot: Number(r.theme_slot),
        weekMonday: r.week_monday,
        sceneText: r.scene_text || "",
        roles: safeJsonParse(r.roles_json, []),
        coverUrl: r.cover_url,
        difficultyLevel: r.difficulty_level,
        previewMarkdown: r.preview_markdown || "",
        roomTasks,
        llmGeneratedAt: r.llm_generated_at || null,
        llmPromptVersion: r.llm_prompt_version || null,
      };
    });
    res.json({ code: 0, message: "ok", data: { themes } });
  } catch (e) {
    console.error("[admin] GET themes/active-full", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

// POST /api/admin/themes/llm-refresh-active  （当前活跃至多 3 条主题整批 LLM，与 dev 接口同逻辑，无需 ENABLE_DEV_PAIRING）
router.post("/themes/llm-refresh-active", requireAdmin, async (_req, res) => {
  try {
    const data = await refreshActiveThemesWithLlm(getPool());
    res.json({ code: 0, message: "ok", data });
  } catch (e) {
    const code = e && e.code;
    if (code === "LLM_NOT_CONFIGURED") {
      return res.status(503).json({ code: 503, message: e.message, data: null });
    }
    if (code === "REFRESH_IN_PROGRESS") {
      return res.status(409).json({ code: 409, message: e.message, data: null });
    }
    console.error("[admin] POST themes/llm-refresh-active", e);
    const msg = e && e.message ? e.message : "服务器错误";
    return res.status(500).json({ code: 500, message: msg, data: null });
  }
});

// POST /api/admin/themes/:id/generate-preview-by-direction  Body: { direction: string }
router.post("/themes/:id/generate-preview-by-direction", requireAdmin, async (req, res) => {
  const themeId = Number(req.params.id);
  const direction = String(req.body?.direction || "").trim();
  if (!themeId || Number.isNaN(themeId)) {
    return res.status(400).json({ code: 400, message: "theme id 无效", data: null });
  }
  if (!direction || direction.length > 200) {
    return res.status(400).json({ code: 400, message: "direction 不能为空且长度≤200", data: null });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, description, scene_text, roles_json, cover_url, preview_markdown, difficulty_level, theme_slot,
              shanghai_week_monday::text AS week_monday
       FROM themes
       WHERE id = $1 AND is_active = 1 AND COALESCE(is_sandbox, FALSE) = FALSE AND shanghai_week_monday IS NOT NULL
       LIMIT 1`,
      [themeId]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ code: 404, message: "主题不存在或非当前上架正式主题", data: null });
    }
    const recentDedup = await fetchRecentThemeDedupContext(pool, [themeId]);
    const pack = await generateThemePack(
      {
        name: row.name,
        description: row.description || "",
        scene_text: row.scene_text || "",
        roles_json: row.roles_json,
        preview_markdown: row.preview_markdown || "",
        cover_url: row.cover_url || "",
        difficulty_level: row.difficulty_level || "intermediate",
        theme_slot: Number(row.theme_slot),
        week_monday: row.week_monday || "",
      },
      { recentDedup, direction }
    );

    const genPackForDb = {
      name: pack.name,
      description: pack.description,
      difficulty_level: pack.difficulty_level || row.difficulty_level || "intermediate",
      scene_text: pack.scene_text,
      roles_json: pack.roles_json,
      preview_markdown: pack.preview_markdown,
      cover_url: pack.cover_url,
      room_tasks_payload: pack.room_tasks_payload,
    };
    const ins = await pool.query(
      `INSERT INTO theme_generations (created_by_email, direction, pack_json, pack_version, status)
       VALUES ($1, $2, $3::jsonb, $4, 'preview')
       RETURNING id`,
      [req.user?.email || null, direction, JSON.stringify(genPackForDb), PROMPT_VERSION || "theme_pack_v3"]
    );

    res.json({
      code: 0,
      message: "ok",
      data: {
        themeId,
        direction,
        generationId: Number(ins.rows?.[0]?.id) || null,
        preview: {
          name: pack.name,
          description: pack.description,
          sceneText: pack.scene_text,
          roles: JSON.parse(pack.roles_json),
          previewMarkdown: pack.preview_markdown,
          roomTasks: pack.room_tasks_payload,
          llmPromptVersion: PROMPT_VERSION,
        },
      },
    });
  } catch (e) {
    const code = e && e.code;
    if (code === "LLM_NOT_CONFIGURED") {
      return res.status(503).json({ code: 503, message: e.message, data: null });
    }
    console.error("[admin] POST themes/generate-preview-by-direction", e);
    const msg = e && e.message ? e.message : "服务器错误";
    return res.status(500).json({ code: 500, message: msg, data: null });
  }
});

// POST /api/admin/themes/:id/commit-generated-pack  Body: { direction: string, pack: object, generation_id?: number }
router.post("/themes/:id/commit-generated-pack", requireAdmin, async (req, res) => {
  const themeId = Number(req.params.id);
  const direction = String(req.body?.direction || "").trim();
  const packRaw = req.body?.pack;
  const generationId =
    req.body?.generation_id != null ? Number(req.body.generation_id) :
    (req.body?.generationId != null ? Number(req.body.generationId) : null);
  if (!themeId || Number.isNaN(themeId)) {
    return res.status(400).json({ code: 400, message: "theme id 无效", data: null });
  }
  if (!direction || direction.length > 200) {
    return res.status(400).json({ code: 400, message: "direction 不能为空且长度≤200", data: null });
  }
  if (!packRaw || typeof packRaw !== "object") {
    return res.status(400).json({ code: 400, message: "pack 无效", data: null });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, cover_url, name, description, scene_text, roles_json, preview_markdown, difficulty_level, theme_slot,
              shanghai_week_monday::text AS week_monday
       FROM themes
       WHERE id = $1 AND is_active = 1 AND COALESCE(is_sandbox, FALSE) = FALSE AND shanghai_week_monday IS NOT NULL
       LIMIT 1`,
      [themeId]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ code: 404, message: "主题不存在或非当前上架正式主题", data: null });
    }

    // 将管理员预览的内容（packRaw）做一次服务端校验，再写库；封面以当前行 cover_url 为准。
    const validated = validatePack(packRaw);
    if (!validated) {
      return res.status(400).json({ code: 400, message: "pack 未通过校验（字段缺失或长度不合规）", data: null });
    }
    applySeedCoverUrl(validated, { cover_url: row.cover_url });

    const upd = await pool.query(
      `UPDATE themes SET
         name = $1,
         description = $2,
         scene_text = $3,
         roles_json = $4,
         preview_markdown = $5,
         cover_url = $6,
         difficulty_level = $7,
         room_tasks_json = $8::jsonb,
         llm_generated_at = NOW(),
         llm_prompt_version = $9
       WHERE id = $10`,
      [
        validated.name,
        validated.description,
        validated.scene_text,
        validated.roles_json,
        validated.preview_markdown,
        validated.cover_url,
        validated.difficulty_level,
        JSON.stringify(validated.room_tasks_payload),
        PROMPT_VERSION || "theme_pack_v3",
        themeId,
      ]
    );
    if (upd.rowCount !== 1) {
      return res.status(500).json({ code: 500, message: "更新主题失败", data: null });
    }

    if (generationId && Number.isInteger(generationId)) {
      await pool.query(
        `UPDATE theme_generations
         SET status = 'applied',
             applied_theme_id = $1,
             applied_at = NOW()
         WHERE id = $2`,
        [themeId, generationId]
      );
    }

    res.json({
      code: 0,
      message: "ok",
      data: { themeId, direction, llmPromptVersion: PROMPT_VERSION, generationId: generationId || null },
    });
  } catch (e) {
    const code = e && e.code;
    if (code === "LLM_NOT_CONFIGURED") {
      return res.status(503).json({ code: 503, message: e.message, data: null });
    }
    console.error("[admin] POST themes/commit-generated-pack", e);
    const msg = e && e.message ? e.message : "服务器错误";
    return res.status(500).json({ code: 500, message: msg, data: null });
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


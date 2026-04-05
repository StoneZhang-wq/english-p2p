const express = require("express");
const { getDb } = require("../db");

const router = express.Router();

/** 与首页 / booking 链接参数 theme= 一致（按主题名称解析，避免写死 id） */
const THEME_PARAM_TO_NAME = {
  interview: "职场面试",
  ielts: "雅思口语 Part 2",
  chat: "日常闲聊",
};

/**
 * GET /api/timeslots?theme_id= 或 ?theme=interview|ielts|chat
 * 供 booking 页轮询「剩余名额」；仅返回 open 场次。
 */
router.get("/", (req, res) => {
  const db = getDb();
  let themeId = Number(req.query.theme_id);
  const themeParam = String(req.query.theme || "").trim();

  if ((!themeId || Number.isNaN(themeId)) && themeParam) {
    const name = THEME_PARAM_TO_NAME[themeParam];
    if (name) {
      const row = db.prepare("SELECT id FROM themes WHERE name = ? AND is_active = 1").get(name);
      if (row) themeId = row.id;
    }
  }

  if (!themeId || Number.isNaN(themeId)) {
    return res.status(400).json({ code: 400, message: "缺少或无效 theme / theme_id", data: null });
  }

  const theme = db.prepare("SELECT id, name FROM themes WHERE id = ? AND is_active = 1").get(themeId);
  if (!theme) {
    return res.status(404).json({ code: 404, message: "主题不存在", data: null });
  }

  const rows = db
    .prepare(
      `SELECT id, theme_id, start_time, end_time, max_pairs, booked_count, status,
        (max_pairs * 2 - booked_count) AS spots_left
       FROM timeslots
       WHERE theme_id = ? AND status = 'open'
       ORDER BY start_time ASC`
    )
    .all(themeId);

  res.json({
    code: 0,
    message: "ok",
    data: {
      theme: { id: theme.id, name: theme.name },
      timeslots: rows.map((r) => ({
        id: r.id,
        themeId: r.theme_id,
        startTime: r.start_time,
        endTime: r.end_time,
        maxPairs: r.max_pairs,
        bookedCount: r.booked_count,
        status: r.status,
        spotsLeft: Math.max(0, r.spots_left),
      })),
    },
  });
});

module.exports = router;

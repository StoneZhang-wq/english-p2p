const express = require("express");
const { getPool } = require("../db");
const { isShanghaiSaturdayOrSundayEightPm } = require("../utils/weekendSlotRules");

const router = express.Router();

const THEME_PARAM_TO_NAME = {
  interview: "职场面试",
  ielts: "雅思口语 Part 2",
  chat: "日常闲聊",
};

router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    let themeId = Number(req.query.theme_id);
    const themeParam = String(req.query.theme || "").trim();

    if ((!themeId || Number.isNaN(themeId)) && themeParam) {
      const name = THEME_PARAM_TO_NAME[themeParam];
      if (name) {
        const { rows } = await pool.query("SELECT id FROM themes WHERE name = $1 AND is_active = 1", [name]);
        if (rows[0]) themeId = rows[0].id;
      }
    }

    if (!themeId || Number.isNaN(themeId)) {
      return res.status(400).json({ code: 400, message: "缺少或无效 theme / theme_id", data: null });
    }

    const { rows: themeRows } = await pool.query("SELECT id, name FROM themes WHERE id = $1 AND is_active = 1", [
      themeId,
    ]);
    const theme = themeRows[0];
    if (!theme) {
      return res.status(404).json({ code: 404, message: "主题不存在", data: null });
    }

    const { rows } = await pool.query(
      `SELECT id, theme_id, start_time, end_time, max_pairs, booked_count, status,
        (max_pairs * 2 - booked_count) AS spots_left
       FROM timeslots
       WHERE theme_id = $1 AND status = 'open'
       ORDER BY start_time ASC`,
      [themeId]
    );

    const filtered = rows.filter((r) => isShanghaiSaturdayOrSundayEightPm(r.start_time));

    res.json({
      code: 0,
      message: "ok",
      data: {
        theme: { id: theme.id, name: theme.name },
        timeslots: filtered.map((r) => ({
          id: r.id,
          themeId: r.theme_id,
          startTime: r.start_time,
          endTime: r.end_time,
          maxPairs: r.max_pairs,
          bookedCount: r.booked_count,
          status: r.status,
          spotsLeft: Math.max(0, Number(r.spots_left)),
        })),
      },
    });
  } catch (e) {
    console.error("[timeslots]", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

module.exports = router;

const express = require("express");
const { getPool } = require("../db");
const {
  getActiveThemeWeekMondayNow,
  bookingOpensAtForWeekMonday,
  weekCycleEndsAtForWeekMonday,
} = require("../utils/weekThemeCycle");

const router = express.Router();

/** 按 id 取主题展示字段（含已归档周，用于预约页深链） */
router.get("/by-id", async (req, res) => {
  try {
    const id = Number(req.query.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ code: 400, message: "缺少或无效 id", data: null });
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, description, slug, theme_slot, scene_text, practice_kit_json, roles_json, cover_url, difficulty_level,
        is_active, shanghai_week_monday::text AS week_monday, preview_markdown,
        COALESCE(is_sandbox, FALSE) AS is_sandbox,
        room_tasks_json,
        llm_generated_at,
        llm_prompt_version
       FROM themes WHERE id = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) {
      return res.status(404).json({ code: 404, message: "主题不存在", data: null });
    }
    let roomTasks = null;
    if (r.room_tasks_json != null) {
      try {
        const raw = r.room_tasks_json;
        roomTasks = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        roomTasks = null;
      }
    }
    let practiceKit = null;
    if (r.practice_kit_json != null) {
      try {
        const raw = r.practice_kit_json;
        practiceKit = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        practiceKit = null;
      }
    }
    res.json({
      code: 0,
      message: "ok",
      data: {
        theme: {
          id: r.id,
          name: r.name,
          description: r.description,
          slug: r.slug,
          themeSlot: Number(r.theme_slot),
          sceneText: r.scene_text,
          practiceKit,
          roles: safeJsonParse(r.roles_json, []),
          coverUrl: r.cover_url,
          difficultyLevel: r.difficulty_level,
          weekMonday: r.week_monday,
          isActive: Number(r.is_active) === 1,
          previewMarkdown: r.preview_markdown || "",
          isSandbox: Boolean(r.is_sandbox),
          roomTasks,
          llmGeneratedAt: r.llm_generated_at || null,
          llmPromptVersion: r.llm_prompt_version || null,
        },
      },
    });
  } catch (e) {
    console.error("[themes by-id]", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

/** 当前开放周期内的三个周主题（北京时间）；未到周日 19:00 开放点则返回空列表 */
router.get("/", async (_req, res) => {
  try {
    const pool = getPool();
    const weekMon = getActiveThemeWeekMondayNow();
    if (!weekMon) {
      return res.json({
        code: 0,
        message: "ok",
        data: {
          weekMonday: null,
          bookingOpenedAt: null,
          weekEndsAt: null,
          themes: [],
          notice:
            "当前未到主题开放周期：每周日 19:00（北京时间）起开放「下一自然周」的三个练习主题，直至该周周日最后一场结束。",
        },
      });
    }

    const openAt = bookingOpensAtForWeekMonday(weekMon);
    const endsAt = weekCycleEndsAtForWeekMonday(weekMon);

    const { rows } = await pool.query(
      `SELECT id, name, description, slug, theme_slot, scene_text, roles_json, cover_url, difficulty_level, shanghai_week_monday::text AS week_monday
       FROM themes
       WHERE is_active = 1 AND shanghai_week_monday = $1::date
       ORDER BY theme_slot ASC`,
      [weekMon]
    );

    const themes = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      slug: r.slug,
      themeSlot: Number(r.theme_slot),
      sceneText: r.scene_text,
      roles: safeJsonParse(r.roles_json, []),
      coverUrl: r.cover_url,
      difficultyLevel: r.difficulty_level,
      weekMonday: r.week_monday,
    }));

    res.json({
      code: 0,
      message: "ok",
      data: {
        weekMonday: weekMon,
        bookingOpenedAt: openAt ? openAt.toISOString() : null,
        weekEndsAt: endsAt ? endsAt.toISOString() : null,
        themes,
        notice: null,
      },
    });
  } catch (e) {
    console.error("[themes]", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

function safeJsonParse(s, fallback) {
  if (s == null || s === "") return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

module.exports = router;

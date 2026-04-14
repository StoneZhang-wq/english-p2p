const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { getPool } = require("../db");
const { rerunThemeLlmForDev, refreshActiveThemesWithLlm } = require("../services/themeLlmEnrichment");

const router = express.Router();

/**
 * Body: { theme_id: number }
 * 清空该主题 LLM 字段并立即再生成一轮（消耗额度）。须登录；仅 NODE_ENV≠production 或 ENABLE_DEV_PAIRING=1 时挂载。
 */
router.post("/theme-llm-rerun", requireAuth, async (req, res) => {
  const themeId = Number(req.body?.theme_id);
  if (!themeId || Number.isNaN(themeId)) {
    return res.status(400).json({ code: 400, message: "请提供 theme_id", data: null });
  }

  try {
    const data = await rerunThemeLlmForDev(getPool(), themeId);
    res.json({ code: 0, message: "ok", data });
  } catch (e) {
    const code = e && e.code;
    if (code === "INVALID") {
      return res.status(400).json({ code: 400, message: e.message, data: null });
    }
    if (code === "NOT_ELIGIBLE") {
      return res.status(404).json({ code: 404, message: e.message, data: null });
    }
    if (code === "LLM_NOT_CONFIGURED") {
      return res.status(503).json({ code: 503, message: e.message, data: null });
    }
    console.error("[dev theme-llm-rerun]", e);
    const msg = e && e.message ? e.message : "服务器错误";
    return res.status(500).json({ code: 500, message: msg, data: null });
  }
});

/**
 * 将当前 is_active 的非沙箱周主题（最多 3 条）用最新 LLM 包覆盖；保留各行 cover_url。
 * 须登录；仅 NODE_ENV≠production 或 ENABLE_DEV_PAIRING=1 时挂载。
 */
router.post("/theme-llm-refresh-active", requireAuth, async (_req, res) => {
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
    console.error("[dev theme-llm-refresh-active]", e);
    const msg = e && e.message ? e.message : "服务器错误";
    return res.status(500).json({ code: 500, message: msg, data: null });
  }
});

module.exports = router;

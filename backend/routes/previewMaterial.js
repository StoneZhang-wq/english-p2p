const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { getPool } = require("../db");
const { buildPreviewMaterialDocxBuffer } = require("../services/buildPreviewMaterialDocx");

const router = express.Router();

/** 登录用户按 theme_id 下载预习资料（Word .docx，正文来自库表 themes.preview_markdown） */
router.get("/docx", requireAuth, async (req, res) => {
  try {
    const themeId = Number(req.query.theme_id);
    if (!themeId || Number.isNaN(themeId)) {
      return res.status(400).json({ code: 400, message: "缺少或无效 theme_id", data: null });
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT name, preview_markdown FROM themes WHERE id = $1 AND preview_markdown IS NOT NULL`,
      [themeId]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ code: 404, message: "主题或预习内容不存在", data: null });
    }
    const buf = await buildPreviewMaterialDocxBuffer(row.name, row.preview_markdown);
    const base = `${String(row.name).replace(/\s+/g, "_")}_预习资料.docx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(base)}`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error("[preview-material]", e);
    res.status(500).json({ code: 500, message: "服务器错误", data: null });
  }
});

module.exports = router;

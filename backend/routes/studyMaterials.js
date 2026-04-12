const express = require("express");
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { getStudyMarkdown, getThemeDisplayName, normalizeThemeParam } = require("../data/studyMaterials");
const { buildStudyMaterialPdfBuffer } = require("../services/studyMaterialPdf");

const router = express.Router();

async function userHasConfirmedBookingForTheme(pool, userId, themeName) {
  const { rows } = await pool.query(
    `SELECT 1 FROM bookings b
     JOIN timeslots ts ON ts.id = b.timeslot_id
     JOIN themes th ON th.id = ts.theme_id
     WHERE b.user_id = $1 AND b.status = 'confirmed' AND th.name = $2
     LIMIT 1`,
    [userId, themeName]
  );
  return rows.length > 0;
}

/** GET /api/study-materials/pdf?theme=interview */
router.get("/pdf", requireAuth, async (req, res) => {
  const themeKey = normalizeThemeParam(req.query.theme);
  const themeName = getThemeDisplayName(themeKey);

  try {
    const pool = getPool();
    const ok = await userHasConfirmedBookingForTheme(pool, req.user.id, themeName);
    if (!ok) {
      return res.status(403).json({ code: 403, message: "请先预约本主题场次后再下载预习资料", data: null });
    }

    const markdown = getStudyMarkdown(themeKey);
    const buf = await buildStudyMaterialPdfBuffer(`${themeName} · 预习资料`, markdown);

    const utf8Name = `${themeName.replace(/\s+/g, "_")}_预习资料.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="preview_${themeKey}.pdf"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`
    );
    res.setHeader("Content-Length", String(buf.length));
    res.send(buf);
  } catch (e) {
    console.error("[study-materials pdf]", e);
    res.status(503).json({
      code: 503,
      message: "预习资料生成失败（字体或网络异常），请稍后重试",
      data: null,
    });
  }
});

module.exports = router;

const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { PREVIEW_MATERIALS_BY_THEME } = require("../data/previewMaterials");
const { buildPreviewMaterialDocxBuffer } = require("../services/buildPreviewMaterialDocx");

const router = express.Router();

/** 登录用户下载当前主题的预习资料（Word .docx） */
router.get("/docx", requireAuth, async (req, res) => {
  try {
    const theme = String(req.query.theme || "").trim();
    const mat = PREVIEW_MATERIALS_BY_THEME[theme];
    if (!mat) {
      return res.status(400).json({ code: 400, message: "无效 theme（interview / ielts / chat）", data: null });
    }
    const buf = await buildPreviewMaterialDocxBuffer(mat.titleZh, mat.markdown);
    const base = `${mat.titleZh.replace(/\s+/g, "_")}_预习资料.docx`;
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

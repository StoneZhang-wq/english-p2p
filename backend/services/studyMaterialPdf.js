const PDFDocument = require("pdfkit");

const DEFAULT_FONT_URL =
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";

let fontBufferPromise = null;

function getFontUrl() {
  return process.env.STUDY_MATERIAL_FONT_URL || DEFAULT_FONT_URL;
}

/**
 * 拉取并缓存 CJK 字体（约 16MB，首次较慢）。可设 STUDY_MATERIAL_FONT_URL 指向本地/镜像 OTF。
 */
async function loadCjkFontBuffer() {
  if (fontBufferPromise) return fontBufferPromise;
  fontBufferPromise = (async () => {
    const url = getFontUrl();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 120000);
    try {
      const res = await fetch(url, { redirect: "follow", signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`字体下载失败 HTTP ${res.status}`);
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } finally {
      clearTimeout(t);
    }
  })();
  return fontBufferPromise;
}

function stripMdBold(s) {
  return String(s).replace(/\*\*([^*]+)\*\*/g, "$1");
}

/**
 * @param {string} title 主题中文名
 * @param {string} markdown
 * @returns {Promise<Buffer>}
 */
async function buildStudyMaterialPdfBuffer(title, markdown) {
  const fontBuf = await loadCjkFontBuffer();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4", autoFirstPage: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("NotoSC", fontBuf);
    doc.font("NotoSC");

    doc.fontSize(16).fillColor("#0f172a").text(title, { width: 495 });
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor("#64748b").text("英语口语练习 · 预习资料", { width: 495 });
    doc.moveDown(1);
    doc.fillColor("#0f172a").fontSize(11);

    const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^##\s+/.test(t)) {
        doc.moveDown(0.5);
        doc.fontSize(13).text(stripMdBold(t.replace(/^##\s+/, "")), { width: 495, paragraphGap: 2 });
        doc.fontSize(11);
        continue;
      }
      if (/^-\s+/.test(t)) {
        const body = stripMdBold(t.replace(/^-\s+/, ""));
        doc.text(`\u2022 ${body}`, { width: 480, indent: 12, paragraphGap: 3, align: "left" });
        continue;
      }
      if (t === "") {
        doc.moveDown(0.2);
        continue;
      }
      doc.text(stripMdBold(t), { width: 495, paragraphGap: 4 });
    }

    doc.end();
  });
}

module.exports = { buildStudyMaterialPdfBuffer, loadCjkFontBuffer };

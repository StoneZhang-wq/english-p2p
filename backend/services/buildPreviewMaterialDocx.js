const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");

function lineToTextRuns(s) {
  const parts = String(s).split(/\*\*/);
  const runs = [];
  for (let i = 0; i < parts.length; i++) {
    runs.push(new TextRun({ text: parts[i], bold: i % 2 === 1 }));
  }
  return runs;
}

function markdownToDocChildren(titleZh, markdown) {
  const children = [];
  children.push(new Paragraph({ text: titleZh, heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ text: "英语口语练习 · 预习资料" }));

  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^##\s+/.test(t)) {
      children.push(
        new Paragraph({
          text: t.replace(/^##\s+/, ""),
          heading: HeadingLevel.HEADING_2,
        })
      );
      continue;
    }
    if (/^-\s+/.test(t)) {
      const rest = t.replace(/^-\s+/, "");
      children.push(
        new Paragraph({
          children: lineToTextRuns(rest),
          bullet: { level: 0 },
        })
      );
      continue;
    }
    if (t === "") continue;
    children.push(new Paragraph({ children: lineToTextRuns(t) }));
  }
  return children;
}

async function buildPreviewMaterialDocxBuffer(titleZh, markdown) {
  const doc = new Document({
    sections: [
      {
        children: markdownToDocChildren(titleZh, markdown),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildPreviewMaterialDocxBuffer };

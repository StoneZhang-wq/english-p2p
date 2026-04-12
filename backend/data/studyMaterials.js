/**
 * 预习资料正文（Markdown 子集：## 标题、- 列表、**粗体**）。
 * 须与 `public/js/booking-flow.js` 中 PREVIEW_MARKDOWN 保持同步。
 */
const PREVIEW_MARKDOWN = {
  interview:
    "## Key vocabulary\n- **initiate** — 发起；开始\n- **candidate** — 候选人\n- **qualification** — 资质\n\n## Useful lines\n- I would like to elaborate on my experience in…\n- Could you tell me more about the team structure?\n",
  ielts:
    "## Part 2 tips\n- Use the **one-minute** prep to jot down **keywords**.\n- Structure: introduction → main points → conclusion.\n\n## Sample stems\n- Describe a place you visited…\n- Talk about an important decision…\n",
  chat:
    "## Small talk\n- **How's your day going?**\n- **Any plans for the weekend?**\n\n## Light fillers\n- That's interesting!\n- I see what you mean.\n",
};

const THEME_PARAM_TO_NAME = {
  interview: "职场面试",
  ielts: "雅思口语 Part 2",
  chat: "日常闲聊",
};

function normalizeThemeParam(raw) {
  const k = String(raw || "")
    .trim()
    .toLowerCase();
  if (THEME_PARAM_TO_NAME[k]) return k;
  return "interview";
}

function getThemeDisplayName(themeParam) {
  return THEME_PARAM_TO_NAME[normalizeThemeParam(themeParam)] || THEME_PARAM_TO_NAME.interview;
}

function getStudyMarkdown(themeParam) {
  const k = normalizeThemeParam(themeParam);
  return PREVIEW_MARKDOWN[k] || PREVIEW_MARKDOWN.interview;
}

module.exports = {
  PREVIEW_MARKDOWN,
  THEME_PARAM_TO_NAME,
  normalizeThemeParam,
  getThemeDisplayName,
  getStudyMarkdown,
};

/**
 * 各主题预习 Markdown（与 `public/js/booking-flow.js` 中 PREVIEW_MARKDOWN 保持一致）。
 * 服务端据此生成 .docx。
 */
const PREVIEW_MATERIALS_BY_THEME = {
  interview: {
    titleZh: "职场面试",
    markdown:
      "## Key vocabulary\n- **initiate** — 发起；开始\n- **candidate** — 候选人\n- **qualification** — 资质\n\n## Useful lines\n- I would like to elaborate on my experience in…\n- Could you tell me more about the team structure?\n",
  },
  ielts: {
    titleZh: "雅思口语 Part 2",
    markdown:
      "## Part 2 tips\n- Use the **one-minute** prep to jot down **keywords**.\n- Structure: introduction → main points → conclusion.\n\n## Sample stems\n- Describe a place you visited…\n- Talk about an important decision…\n",
  },
  chat: {
    titleZh: "日常闲聊",
    markdown:
      "## Small talk\n- **How's your day going?**\n- **Any plans for the weekend?**\n\n## Light fillers\n- That's interesting!\n- I see what you mean.\n",
  },
};

module.exports = { PREVIEW_MATERIALS_BY_THEME };

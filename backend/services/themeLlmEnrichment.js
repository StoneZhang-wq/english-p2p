/**
 * 按周主题种子调用 LLM，生成完整展示字段 + room_tasks_json，写回 themes。
 * 仅处理 llm_generated_at IS NULL 且非沙箱的活跃主题；每轮最多处理 3 条以免拖垮维护任务。
 */

const { chatCompletionText, isLlmConfigured } = require("./llmChat");

const PROMPT_VERSION = "theme_pack_v1";

function safeParseRoles(rolesJson) {
  if (!rolesJson) return [];
  try {
    const a = JSON.parse(rolesJson);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function validatePack(obj) {
  if (!obj || typeof obj !== "object") return null;
  const name = String(obj.name || "").trim();
  if (!name || name.length > 120) return null;
  const description = String(obj.description || "").trim();
  const scene_text = String(obj.scene_text || "").trim();
  if (!scene_text || scene_text.length > 4000) return null;
  let roles = obj.roles;
  if (!Array.isArray(roles) || roles.length < 2) return null;
  roles = roles.slice(0, 4).map((r) => ({
    label: String(r.label || "ROLE").slice(0, 32),
    name: String(r.name || "").slice(0, 80),
    desc: String(r.desc || "").slice(0, 400),
  }));
  const preview_markdown = String(obj.preview_markdown || "").trim();
  if (!preview_markdown || preview_markdown.length > 32000) return null;
  const cover_url = String(obj.cover_url || "").trim();
  if (!cover_url || !/^https?:\/\//i.test(cover_url)) return null;

  let room_tasks = obj.room_tasks;
  if (!Array.isArray(room_tasks) || room_tasks.length !== 3) return null;
  room_tasks = room_tasks.slice(0, 3).map((t, i) => {
    const id = String(t.id || `t${i + 1}`).replace(/[^\w-]/g, "").slice(0, 32) || `t${i + 1}`;
    const title = String(t.title || "").trim().slice(0, 200);
    const hints = Array.isArray(t.hints) ? t.hints.map((h) => String(h).trim()).filter(Boolean).slice(0, 8) : [];
    if (!title || hints.length < 2) return null;
    return { id, title, hints };
  });
  if (room_tasks.some((x) => !x)) return null;

  const difficulty_level = ["beginner", "intermediate", "advanced"].includes(String(obj.difficulty_level))
    ? String(obj.difficulty_level)
    : "intermediate";

  return {
    name,
    description,
    scene_text,
    roles_json: JSON.stringify(roles),
    preview_markdown,
    cover_url,
    difficulty_level,
    room_tasks,
  };
}

/**
 * @param {{ name: string, description: string, scene_text: string, roles_json: string, preview_markdown: string, cover_url: string, difficulty_level: string, theme_slot: number, week_monday: string }} seed
 */
async function generateThemePack(seed) {
  const roles = safeParseRoles(seed.roles_json);
  const seedJson = JSON.stringify(
    {
      name: seed.name,
      description: seed.description,
      scene_text: seed.scene_text,
      roles,
      preview_markdown: seed.preview_markdown,
      cover_url: seed.cover_url,
      difficulty_level: seed.difficulty_level,
      theme_slot: seed.theme_slot,
      week_monday: seed.week_monday,
    },
    null,
    2
  );

  const system = `你是英语口语练习产品的内容编辑。只输出一个 JSON 对象，不要 markdown 围栏，不要多余说明。
JSON 必须符合下列 TypeScript 形态：
{
  "name": string,
  "description": string,
  "scene_text": string,
  "roles": { "label": string, "name": string, "desc": string }[],
  "preview_markdown": string,
  "cover_url": string,
  "difficulty_level": "beginner" | "intermediate" | "advanced",
  "room_tasks": { "id": string, "title": string, "hints": string[] }[]
}
要求：
- name/description/scene_text 用**中文**为主，适合中国大陆用户；scene_text 为一段沉浸式场景描写。
- roles 恰好 2 条，与口语对练角色一致。
- preview_markdown 为 Markdown，含词汇与实用句，**英文例句**用英文。
- cover_url 必须是可公网访问的 **https** 图片 URL；若无法保证可访问，请使用 Unsplash 搜索 URL（与种子同类场景）。
- room_tasks 固定 **3** 条：每条 title 为**中文**短句（练习任务）；hints 为 **3～5** 条**英文**常用句，口语难度与 difficulty_level 一致。
- 在种子基础上**改写增强**，不要逐字复制种子。`;

  const user = `以下为当前周主题种子（JSON）。请生成最终上架内容：\n${seedJson}`;

  const msgs = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let text;
  try {
    text = await chatCompletionText(msgs, { jsonMode: true });
  } catch (e1) {
    console.warn("[llm-theme] json_mode request failed, retry plain:", e1 && e1.message ? e1.message : e1);
    text = await chatCompletionText(msgs, { jsonMode: false });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM 输出无法解析为 JSON");
    parsed = JSON.parse(m[0]);
  }

  const pack = validatePack(parsed);
  if (!pack) throw new Error("LLM JSON 未通过校验");
  return pack;
}

/**
 * @param {import("pg").Pool} pool
 */
async function tryEnrichThemesWithLlm(pool) {
  if (!isLlmConfigured()) return { skipped: true, reason: "not_configured" };

  const { rows } = await pool.query(
    `SELECT id, name, description, scene_text, roles_json, cover_url, preview_markdown, difficulty_level, theme_slot,
            shanghai_week_monday::text AS week_monday
     FROM themes
     WHERE is_active = 1
       AND COALESCE(is_sandbox, FALSE) = FALSE
       AND shanghai_week_monday IS NOT NULL
       AND llm_generated_at IS NULL
     ORDER BY shanghai_week_monday ASC, theme_slot ASC
     LIMIT 3`
  );

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    try {
      const pack = await generateThemePack({
        name: row.name,
        description: row.description || "",
        scene_text: row.scene_text || "",
        roles_json: row.roles_json,
        preview_markdown: row.preview_markdown || "",
        cover_url: row.cover_url || "",
        difficulty_level: row.difficulty_level || "intermediate",
        theme_slot: Number(row.theme_slot),
        week_monday: row.week_monday || "",
      });

      const upd = await pool.query(
        `UPDATE themes SET
           name = $1,
           description = $2,
           scene_text = $3,
           roles_json = $4,
           preview_markdown = $5,
           cover_url = $6,
           difficulty_level = $7,
           room_tasks_json = $8::jsonb,
           llm_generated_at = NOW(),
           llm_prompt_version = $9
         WHERE id = $10 AND llm_generated_at IS NULL`,
        [
          pack.name,
          pack.description,
          pack.scene_text,
          pack.roles_json,
          pack.preview_markdown,
          pack.cover_url,
          pack.difficulty_level,
          JSON.stringify(pack.room_tasks),
          PROMPT_VERSION,
          row.id,
        ]
      );
      if (upd.rowCount !== 1) {
        console.warn("[llm-theme] skip concurrent update id=%s", row.id);
        continue;
      }
      ok += 1;
      console.log("[llm-theme] enriched theme id=%s name=%s", row.id, pack.name);
    } catch (e) {
      fail += 1;
      console.error("[llm-theme] failed theme id=%s: %s", row.id, e && e.message ? e.message : e);
    }
  }

  return { skipped: false, processed: rows.length, ok, fail };
}

/**
 * 开发用：清空某主题的 LLM 落库字段并立即对该主题再跑一轮生成（不依赖定时任务）。
 * 条件：非沙箱且须有 `shanghai_week_monday`（与批处理一致）。
 * @param {import("pg").Pool} pool
 * @param {number} themeId
 */
async function rerunThemeLlmForDev(pool, themeId) {
  if (!isLlmConfigured()) {
    const e = new Error("LLM 未配置：请设置 OPENAI_API_KEY 等");
    e.code = "LLM_NOT_CONFIGURED";
    throw e;
  }
  const tid = Number(themeId);
  if (!tid || Number.isNaN(tid)) {
    const e = new Error("theme_id 无效");
    e.code = "INVALID";
    throw e;
  }

  const gate = await pool.query(
    `SELECT id FROM themes
     WHERE id = $1
       AND COALESCE(is_sandbox, FALSE) = FALSE
       AND shanghai_week_monday IS NOT NULL`,
    [tid]
  );
  if (!gate.rows.length) {
    const e = new Error("主题不存在、为沙箱主题或缺少周归属（shanghai_week_monday），无法执行 LLM");
    e.code = "NOT_ELIGIBLE";
    throw e;
  }

  await pool.query(
    `UPDATE themes SET llm_generated_at = NULL, llm_prompt_version = NULL, room_tasks_json = NULL WHERE id = $1`,
    [tid]
  );

  const { rows } = await pool.query(
    `SELECT id, name, description, scene_text, roles_json, cover_url, preview_markdown, difficulty_level, theme_slot,
            shanghai_week_monday::text AS week_monday
     FROM themes WHERE id = $1`,
    [tid]
  );
  const row = rows[0];
  const pack = await generateThemePack({
    name: row.name,
    description: row.description || "",
    scene_text: row.scene_text || "",
    roles_json: row.roles_json,
    preview_markdown: row.preview_markdown || "",
    cover_url: row.cover_url || "",
    difficulty_level: row.difficulty_level || "intermediate",
    theme_slot: Number(row.theme_slot),
    week_monday: row.week_monday || "",
  });

  const upd = await pool.query(
    `UPDATE themes SET
       name = $1,
       description = $2,
       scene_text = $3,
       roles_json = $4,
       preview_markdown = $5,
       cover_url = $6,
       difficulty_level = $7,
       room_tasks_json = $8::jsonb,
       llm_generated_at = NOW(),
       llm_prompt_version = $9
     WHERE id = $10`,
    [
      pack.name,
      pack.description,
      pack.scene_text,
      pack.roles_json,
      pack.preview_markdown,
      pack.cover_url,
      pack.difficulty_level,
      JSON.stringify(pack.room_tasks),
      PROMPT_VERSION,
      tid,
    ]
  );
  if (upd.rowCount !== 1) {
    const e = new Error("更新主题失败");
    e.code = "UPDATE_FAILED";
    throw e;
  }

  console.log("[llm-theme] dev rerun ok theme id=%s name=%s", tid, pack.name);
  return { themeId: tid, name: pack.name, llmPromptVersion: PROMPT_VERSION };
}

module.exports = {
  tryEnrichThemesWithLlm,
  rerunThemeLlmForDev,
  generateThemePack,
  PROMPT_VERSION,
};

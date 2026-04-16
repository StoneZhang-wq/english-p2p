/**
 * 调用 LLM 生成“主题整包”（极简场景 + 多轮对话任务 + 短预习），供管理员预览并写回 themes。
 * - 批处理：当前仓库已不在 init/周维护中自动执行（以管理员操作为准），但仍保留服务函数供显式调用。
 * - v4：scene_text 一句话；preview_markdown 短预习（含延长技巧）；room_tasks_by_role 每角色恰好 6 条；每条 hints 3-4 句分支；用最近 12 个主题摘要做场景去重。
 */

const { chatCompletionText, isLlmConfigured } = require("./llmChat");

const PROMPT_VERSION = "theme_pack_v4";

/** 主题整包 JSON 较长，须显式提高 completion 上限，避免默认 max_tokens 截断导致 JSON.parse 失败 */
function themeLlmMaxTokens() {
  var raw = String(process.env.OPENAI_THEME_MAX_TOKENS || "8192").trim();
  var n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 2048) return 8192;
  return Math.min(n, 32768);
}

/** 去重参考：最近 N 条（非当前批次）主题 */
const DEDUP_THEME_LIMIT = 12;

/** 防止多个 HTTP 请求同时整批刷新同一批活跃主题 */
var refreshActiveInProgress = false;

const ROOM_TASKS_MIN = 6;
const ROOM_TASKS_MAX = 6;
const ROOM_TASKS_TARGET = 6;
const HINTS_MIN = 3;
const HINTS_MAX = 4;
/** 短预习：开口句 + 任务概览 + 延长技巧（中文为主） */
const PREVIEW_MARKDOWN_MIN_LEN = 80;
const PREVIEW_MARKDOWN_MAX_LEN = 2000;
const SCENE_TEXT_MAX_LEN = 220;
const ROLE_DESC_MAX_LEN = 25;

function safeParseRoles(rolesJson) {
  if (!rolesJson) return [];
  try {
    const a = JSON.parse(rolesJson);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function dedupeTaskIds(tasks) {
  const seen = new Set();
  return tasks.map(function (t, i) {
    var id = t.id;
    if (seen.has(id)) id = String(t.id || "t") + "_" + String(i + 1);
    seen.add(id);
    return { id: id, title: t.title, hints: t.hints };
  });
}

/**
 * 每角色恰好 6 条任务；每条 hints 3-4 句（房间 UI 与接口一致）。
 * @param {unknown} room_tasks
 * @returns {{ id: string, title: string, hints: string[] }[] | null}
 */
function normalizeRoomTasksToSix(room_tasks) {
  if (!Array.isArray(room_tasks)) return null;
  if (room_tasks.length !== ROOM_TASKS_TARGET) return null;
  var tasks = room_tasks.map(function (t, i) {
    var id = String(t.id || "t" + (i + 1))
      .replace(/[^\w-]/g, "")
      .slice(0, 32) || "t" + (i + 1);
    var title = String(t.title || "")
      .trim()
      .slice(0, 200);
    var hints = Array.isArray(t.hints)
      ? t.hints
          .map(function (h) {
            return String(h).trim();
          })
          .filter(Boolean)
          .slice(0, HINTS_MAX)
      : [];
    if (!title || hints.length < HINTS_MIN || hints.length > HINTS_MAX) return null;
    return { id: id, title: title, hints: hints };
  });
  if (tasks.some(function (x) {
    return !x;
  }))
    return null;

  return dedupeTaskIds(tasks);
}

function normalizeRoomTasksByRoleToSix(byRole, roleNames) {
  if (!byRole || typeof byRole !== "object") return null;
  if (!Array.isArray(roleNames) || roleNames.length !== 2) return null;
  var out = {};
  for (var i = 0; i < roleNames.length; i++) {
    var rn = roleNames[i];
    var raw = byRole[rn];
    var normalized = normalizeRoomTasksToSix(raw);
    if (!normalized || normalized.length !== ROOM_TASKS_TARGET) return null;
    out[rn] = normalized;
  }
  return out;
}

function validatePack(obj) {
  if (!obj || typeof obj !== "object") return null;
  var name = String(obj.name || "").trim();
  if (!name || name.length > 120) return null;
  var description = String(obj.description || "").trim();
  if (!description || description.length > 2000) return null;
  var scene_text = String(obj.scene_text || "").trim();
  if (!scene_text || scene_text.length > SCENE_TEXT_MAX_LEN) return null;
  var roles = obj.roles;
  if (!roles && obj.roles_json != null) {
    try {
      roles = typeof obj.roles_json === "string" ? JSON.parse(obj.roles_json) : obj.roles_json;
    } catch {
      roles = null;
    }
  }
  if (!Array.isArray(roles) || roles.length < 2) return null;
  roles = roles.slice(0, 2).map(function (r) {
    return {
      label: String(r.label || "ROLE").slice(0, 32),
      name: String(r.name || "").slice(0, 80),
      desc: String(r.desc || "").trim().slice(0, ROLE_DESC_MAX_LEN),
    };
  });
  if (roles.length !== 2 || !roles[0].name || !roles[1].name) return null;
  if (!roles[0].desc || !roles[1].desc) return null;
  var preview_markdown = String(obj.preview_markdown || "").trim();
  if (
    !preview_markdown ||
    preview_markdown.length < PREVIEW_MARKDOWN_MIN_LEN ||
    preview_markdown.length > PREVIEW_MARKDOWN_MAX_LEN
  )
    return null;
  if (!/#\s*开口句/.test(preview_markdown)) return null;
  if (!/#\s*你的6个任务（概览）/.test(preview_markdown)) return null;
  if (!/#\s*延长对话小贴士/.test(preview_markdown)) return null;
  var cover_url = String(obj.cover_url || "").trim();
  if (!cover_url || !/^https?:\/\//i.test(cover_url)) return null;

  var roleNames = [roles[0].name, roles[1].name].map(function (x) {
    return String(x || "").trim();
  });

  var roomTasksPayload = null;
  // v3：按角色拆分任务集（本版本强制使用，支撑“每人 6 步、每步多轮”）
  if (obj.room_tasks_by_role == null) return null;
  var by = normalizeRoomTasksByRoleToSix(obj.room_tasks_by_role, roleNames);
  if (!by) return null;
  roomTasksPayload = { version: 3, byRole: by };

  var difficulty_level = ["beginner", "intermediate", "advanced"].includes(String(obj.difficulty_level))
    ? String(obj.difficulty_level)
    : "intermediate";

  return {
    name: name,
    description: description,
    scene_text: scene_text,
    roles_json: JSON.stringify(roles),
    preview_markdown: preview_markdown,
    cover_url: cover_url,
    difficulty_level: difficulty_level,
    room_tasks_payload: roomTasksPayload,
  };
}

/**
 * 保留库表现有封面：以 seed cover 为准（有合法 URL 时覆盖模型输出）。
 * @param {{ cover_url: string } & Record<string, unknown>} pack
 * @param {{ cover_url?: string }} seed
 */
function applySeedCoverUrl(pack, seed) {
  var c = String(seed.cover_url || "").trim();
  if (c && /^https?:\/\//i.test(c)) pack.cover_url = c;
}

/**
 * @param {import("pg").Pool} pool
 * @param {number[]} excludeIds 从去重列表中排除的主题 id（如当前批次 3 条或正在生成的1 条）
 */
async function fetchRecentThemeDedupContext(pool, excludeIds) {
  var ids = Array.isArray(excludeIds)
    ? excludeIds
        .map(function (x) {
          return Number(x);
        })
        .filter(function (n) {
          return Number.isInteger(n) && n > 0;
        })
    : [];
  var { rows } = await pool.query(
    `SELECT id, name, shanghai_week_monday::text AS week_monday, theme_slot,
            LEFT(COALESCE(scene_text, ''), 240) AS scene_excerpt
     FROM themes
     WHERE COALESCE(is_sandbox, FALSE) = FALSE
       AND shanghai_week_monday IS NOT NULL
       AND NOT (id = ANY($1::int[]))
     ORDER BY shanghai_week_monday DESC, theme_slot ASC
     LIMIT 12`,
    [ids]
  );
  return rows.map(function (r) {
    return {
      id: r.id,
      week_label: String(r.week_monday || "") + "·槽" + String(r.theme_slot),
      name: r.name,
      scene_excerpt: r.scene_excerpt,
    };
  });
}

/**
 * @param {{ name: string, description: string, scene_text: string, roles_json: string, preview_markdown: string, cover_url: string, difficulty_level: string, theme_slot: number, week_monday: string }} seed
 * @param {{ recentDedup?: object[] }} [options]
 */
async function generateThemePack(seed, options) {
  options = options || {};
  var recentDedup = Array.isArray(options.recentDedup) ? options.recentDedup : [];
  var direction = options.direction ? String(options.direction).trim() : "";

  var roles = safeParseRoles(seed.roles_json);
  var seedJson = JSON.stringify(
    {
      name: seed.name,
      description: seed.description,
      scene_text: seed.scene_text,
      roles: roles,
      preview_markdown: seed.preview_markdown,
      cover_url: seed.cover_url,
      difficulty_level: seed.difficulty_level,
      theme_slot: seed.theme_slot,
      week_monday: seed.week_monday,
    },
    null,
    2
  );

  var dedupBlock = "";
  if (recentDedup.length) {
    dedupBlock =
      "\n\n【场景去重 — 必读】以下 JSON 为**最近已上线主题池中至多 " +
      DEDUP_THEME_LIMIT +
      " 个**主题的场景摘要（不含当前正生成的主题）。你必须避免**撞场景**：不得使用与下列在「地点/场合/职业组合/核心矛盾」上高度雷同的设定；禁止换皮复述（例如已出现「咖啡馆排队」则不可再做「咖啡店等餐」类同构场景）。请选一个**新鲜**的口语情境。\n" +
      JSON.stringify(recentDedup, null, 2);
  }

  var system =
    "你是英语口语练习产品的内容编辑。只输出一个 JSON 对象，不要 markdown 围栏，不要多余说明。\n" +
    "JSON 必须符合下列 TypeScript 形态：\n" +
    "{\n" +
    '  "name": string,\n' +
    '  "description": string,\n' +
    '  "scene_text": string,\n' +
    '  "roles": { "label": string, "name": string, "desc": string }[],\n' +
    '  "preview_markdown": string,\n' +
    '  "cover_url": string,\n' +
    '  "difficulty_level": "beginner" | "intermediate" | "advanced",\n' +
    '  "room_tasks_by_role": Record<string, { "id": string, "title": string, "hints": string[] }[]>\n' +
    "}\n" +
    "要求：\n" +
    "- **极简场景**：scene_text **最多一句话**（中文），只写“谁在做什么/在哪里做什么”，禁止小说式描写（不要时间线、人物背景、氛围渲染、戏剧冲突叙事）。避免与【场景去重】列表雷同。\n" +
    "- roles **恰好 2 条**；每条 desc **不超过 25 个汉字**（只写职责，不要故事）。\n" +
    "- preview_markdown：中文为主、**短而可用**（建议总长度 ≤ 400 字），必须包含且仅使用这三个一级标题（必须带 `#`）：\n" +
    "  `# 开口句` `# 你的6个任务（概览）` `# 延长对话小贴士`\n" +
    "  - 「开口句」：给两个角色各 1 句可直接开口的英文句子。\n" +
    "  - 「你的6个任务（概览）」：分别列出两个角色各 6 条任务标题（中文编号 1-6），顺序要能串成自然对话推进。\n" +
    "  - 「延长对话小贴士」：2-3 条通用技巧（中文），教用户如何多问一句、如何表达偏好/理由、如何复述确认。\n" +
    "- cover_url：必须是可公网访问的 **https** 图片 URL；若不确定可用 Unsplash 与场景相关的图片 URL（模型仍需输出合法 URL；落库时可能保留种子封面）。\n" +
    "- **room_tasks_by_role（强制）**：键名必须与 roles[].name **完全一致**；每个角色数组 **恰好 6 条**任务（不要多也不要少）。\n" +
    "  - 每条任务 title：中文，描述一个可聊 30-60 秒的小目标；任务之间要有信息呼应（例如：报价→推荐→追问→决定→付款→道别）。\n" +
    "  - 每条任务 hints：**恰好 " +
    String(HINTS_MIN) +
    "～" +
    String(HINTS_MAX) +
    " 条英文短句**，覆盖不同分支（同意/拒绝/追问/澄清），让用户能自然多轮对话；不要只给一句。\n" +
    "- 在种子基础上**改写增强**，不要逐字复制种子正文。";

  var directionBlock = direction
    ? "\n\n【管理员指定方向】你必须将本主题生成结果严格围绕以下方向/关键词展开：\n" + direction
    : "";
  var user = "以下为当前周主题种子（JSON）。请生成最终上架内容：" + dedupBlock + directionBlock + "\n\n" + seedJson;

  var msgs = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  var maxTok = themeLlmMaxTokens();
  var text;
  try {
    text = await chatCompletionText(msgs, { jsonMode: true, maxTokens: maxTok });
  } catch (e1) {
    console.warn("[llm-theme] json_mode request failed, retry plain:", e1 && e1.message ? e1.message : e1);
    text = await chatCompletionText(msgs, { jsonMode: false, maxTokens: maxTok });
  }

  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (eParse) {
    var m = text.match(/\{[\s\S]*\}/);
    if (!m) {
      throw new Error(
        "LLM 输出无法解析为 JSON（可能被截断或非 JSON）。请重试；若仍失败请在 .env 设置 OPENAI_THEME_MAX_TOKENS=12288 或更高。原始错误：" +
          (eParse && eParse.message ? eParse.message : String(eParse))
      );
    }
    try {
      parsed = JSON.parse(m[0]);
    } catch (e2) {
      throw new Error(
        "LLM JSON 不完整或非法，请重试或增大 OPENAI_THEME_MAX_TOKENS。详情：" + (e2 && e2.message ? e2.message : String(e2))
      );
    }
  }

  var pack = validatePack(parsed);
  if (!pack) throw new Error("LLM JSON 未通过校验");
  applySeedCoverUrl(pack, seed);
  return pack;
}

/**
 * @param {import("pg").Pool} pool
 */
async function tryEnrichThemesWithLlm(pool) {
  if (!isLlmConfigured()) return { skipped: true, reason: "not_configured" };

  var { rows } = await pool.query(
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

  var ok = 0;
  var fail = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    try {
      var recentDedup = await fetchRecentThemeDedupContext(pool, [row.id]);
      var pack = await generateThemePack(
        {
          name: row.name,
          description: row.description || "",
          scene_text: row.scene_text || "",
          roles_json: row.roles_json,
          preview_markdown: row.preview_markdown || "",
          cover_url: row.cover_url || "",
          difficulty_level: row.difficulty_level || "intermediate",
          theme_slot: Number(row.theme_slot),
          week_monday: row.week_monday || "",
        },
        { recentDedup: recentDedup }
      );

      var upd = await pool.query(
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
          JSON.stringify(pack.room_tasks_payload),
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

  return { skipped: false, processed: rows.length, ok: ok, fail: fail };
}

/**
 * 将当前**活跃**的非沙箱周主题（通常 3 条）用最新提示词整包覆盖；**保留**各行现有 cover_url。
 * @param {import("pg").Pool} pool
 */
async function refreshActiveThemesWithLlm(pool) {
  if (refreshActiveInProgress) {
    var busy = new Error("当前已有主题 LLM 整批刷新在执行中，请等待完成后重试");
    busy.code = "REFRESH_IN_PROGRESS";
    throw busy;
  }
  refreshActiveInProgress = true;
  try {
    return await refreshActiveThemesWithLlmBody(pool);
  } finally {
    refreshActiveInProgress = false;
  }
}

async function refreshActiveThemesWithLlmBody(pool) {
  if (!isLlmConfigured()) {
    var e0 = new Error("LLM 未配置：请设置 OPENAI_API_KEY 等");
    e0.code = "LLM_NOT_CONFIGURED";
    throw e0;
  }

  var { rows } = await pool.query(
    `SELECT id, name, description, scene_text, roles_json, cover_url, preview_markdown, difficulty_level, theme_slot,
            shanghai_week_monday::text AS week_monday
     FROM themes
     WHERE is_active = 1
       AND COALESCE(is_sandbox, FALSE) = FALSE
       AND shanghai_week_monday IS NOT NULL
     ORDER BY shanghai_week_monday DESC, theme_slot ASC
     LIMIT 3`
  );

  if (!rows.length) {
    return { skipped: true, reason: "no_active_themes", processed: 0, ok: 0, fail: 0 };
  }

  var batchIds = rows.map(function (r) {
    return r.id;
  });
  var ok = 0;
  var fail = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    try {
      var recentDedup = await fetchRecentThemeDedupContext(pool, batchIds);
      var pack = await generateThemePack(
        {
          name: row.name,
          description: row.description || "",
          scene_text: row.scene_text || "",
          roles_json: row.roles_json,
          preview_markdown: row.preview_markdown || "",
          cover_url: row.cover_url || "",
          difficulty_level: row.difficulty_level || "intermediate",
          theme_slot: Number(row.theme_slot),
          week_monday: row.week_monday || "",
        },
        { recentDedup: recentDedup }
      );

      var upd = await pool.query(
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
          JSON.stringify(pack.room_tasks_payload),
          PROMPT_VERSION,
          row.id,
        ]
      );
      if (upd.rowCount !== 1) throw new Error("UPDATE未影响行");
      ok += 1;
      console.log("[llm-theme] refresh-active ok theme id=%s name=%s", row.id, pack.name);
    } catch (e) {
      fail += 1;
      console.error("[llm-theme] refresh-active failed theme id=%s: %s", row.id, e && e.message ? e.message : e);
    }
  }

  return { skipped: false, processed: rows.length, ok: ok, fail: fail, themeIds: batchIds };
}

/**
 * 开发用：清空某主题的 LLM 落库字段并立即对该主题再跑一轮生成（消耗额度）。
 * 条件：非沙箱且须有 `shanghai_week_monday`（与批处理一致）。**保留**该行 cover_url。
 * @param {import("pg").Pool} pool
 * @param {number} themeId
 */
async function rerunThemeLlmForDev(pool, themeId) {
  if (!isLlmConfigured()) {
    var e = new Error("LLM 未配置：请设置 OPENAI_API_KEY 等");
    e.code = "LLM_NOT_CONFIGURED";
    throw e;
  }
  var tid = Number(themeId);
  if (!tid || Number.isNaN(tid)) {
    var e2 = new Error("theme_id 无效");
    e2.code = "INVALID";
    throw e2;
  }

  var gate = await pool.query(
    `SELECT id FROM themes
     WHERE id = $1
       AND COALESCE(is_sandbox, FALSE) = FALSE
       AND shanghai_week_monday IS NOT NULL`,
    [tid]
  );
  if (!gate.rows.length) {
    var e3 = new Error("主题不存在、为沙箱主题或缺少周归属（shanghai_week_monday），无法执行 LLM");
    e3.code = "NOT_ELIGIBLE";
    throw e3;
  }

  await pool.query(
    `UPDATE themes SET llm_generated_at = NULL, llm_prompt_version = NULL, room_tasks_json = NULL WHERE id = $1`,
    [tid]
  );

  var { rows } = await pool.query(
    `SELECT id, name, description, scene_text, roles_json, cover_url, preview_markdown, difficulty_level, theme_slot,
            shanghai_week_monday::text AS week_monday
     FROM themes WHERE id = $1`,
    [tid]
  );
  var row = rows[0];
  var recentDedup = await fetchRecentThemeDedupContext(pool, [tid]);
  var pack = await generateThemePack(
    {
      name: row.name,
      description: row.description || "",
      scene_text: row.scene_text || "",
      roles_json: row.roles_json,
      preview_markdown: row.preview_markdown || "",
      cover_url: row.cover_url || "",
      difficulty_level: row.difficulty_level || "intermediate",
      theme_slot: Number(row.theme_slot),
      week_monday: row.week_monday || "",
    },
    { recentDedup: recentDedup }
  );

  var upd = await pool.query(
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
      JSON.stringify(pack.room_tasks_payload),
      PROMPT_VERSION,
      tid,
    ]
  );
  if (upd.rowCount !== 1) {
    var e4 = new Error("更新主题失败");
    e4.code = "UPDATE_FAILED";
    throw e4;
  }

  console.log("[llm-theme] dev rerun ok theme id=%s name=%s", tid, pack.name);
  return { themeId: tid, name: pack.name, llmPromptVersion: PROMPT_VERSION };
}

module.exports = {
  tryEnrichThemesWithLlm,
  rerunThemeLlmForDev,
  refreshActiveThemesWithLlm,
  generateThemePack,
  validatePack,
  applySeedCoverUrl,
  fetchRecentThemeDedupContext,
  PROMPT_VERSION,
};

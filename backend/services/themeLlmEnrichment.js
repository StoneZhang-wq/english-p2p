/**
 * 调用 LLM 生成“主题整包”（场景、角色、预习、room_tasks_json），供管理员预览并写回 themes。
 * - 批处理：当前仓库已不在 init/周维护中自动执行（以管理员操作为准），但仍保留服务函数供显式调用。
 * - v2：任务 5～7 条规范为 6 条；预习更丰满；用最近 12 个主题摘要做场景去重。
 * - v3：按角色拆分任务集（每角色 6 条），并支持管理员传入 direction（方向）。
 */

const { chatCompletionText, isLlmConfigured } = require("./llmChat");

const PROMPT_VERSION = "theme_pack_v3";

/** 去重参考：最近 N 条（非当前批次）主题 */
const DEDUP_THEME_LIMIT = 12;

/** 防止多个 HTTP 请求同时整批刷新同一批活跃主题 */
var refreshActiveInProgress = false;

const ROOM_TASKS_MIN = 5;
const ROOM_TASKS_MAX = 7;
const ROOM_TASKS_TARGET = 6;
const PREVIEW_MARKDOWN_MIN_LEN = 600;

function normalizeString(s, maxLen) {
  var v = String(s == null ? "" : s).trim();
  if (!v) return "";
  if (maxLen && v.length > maxLen) v = v.slice(0, maxLen);
  return v;
}

function normalizeStringArray(arr, maxItems, itemMaxLen) {
  if (!Array.isArray(arr)) return [];
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var x = normalizeString(arr[i], itemMaxLen || 220);
    if (!x) continue;
    out.push(x);
    if (maxItems && out.length >= maxItems) break;
  }
  return out;
}

function normalizePracticeKit(pk, roleNames) {
  if (!pk || typeof pk !== "object") return null;
  if (!Array.isArray(roleNames) || roleNames.length !== 2) return null;

  var core = normalizeString(pk.core_conflict, 160);
  if (!core) return null;

  var info = pk.info_gap && typeof pk.info_gap === "object" ? pk.info_gap : null;
  var roleA = normalizeString(info && info.role_A_knows, 260);
  var roleB = normalizeString(info && info.role_B_knows, 260);
  var shared = normalizeStringArray(info && info.shared_known, 6, 120);
  if (!roleA || !roleB) return null;

  var secret = pk.secret_goal_by_role && typeof pk.secret_goal_by_role === "object" ? pk.secret_goal_by_role : null;
  var secrets = {};
  secrets[roleNames[0]] = normalizeString(secret && (secret[roleNames[0]] || secret.roleA), 180);
  secrets[roleNames[1]] = normalizeString(secret && (secret[roleNames[1]] || secret.roleB), 180);
  if (!secrets[roleNames[0]] || !secrets[roleNames[1]]) return null;

  var sp = pk.survival_phrases && typeof pk.survival_phrases === "object" ? pk.survival_phrases : null;
  var survival = {
    when_stuck: normalizeStringArray(sp && sp.when_stuck, 3, 120),
    when_disagree: normalizeStringArray(sp && sp.when_disagree, 3, 120),
    when_time_pressed: normalizeStringArray(sp && sp.when_time_pressed, 3, 120),
  };
  if (!survival.when_stuck.length || !survival.when_disagree.length || !survival.when_time_pressed.length) return null;

  var warm = pk.two_minute_warmup;
  var warmup = null;
  if (warm && typeof warm === "object") {
    warmup = {};
    warmup[roleNames[0]] = normalizeString(warm[roleNames[0]] || warm.roleA, 200);
    warmup[roleNames[1]] = normalizeString(warm[roleNames[1]] || warm.roleB, 200);
  } else {
    warmup = null;
  }
  if (!warmup || !warmup[roleNames[0]] || !warmup[roleNames[1]]) return null;

  var twist = normalizeString(pk.twist, 220);

  return {
    core_conflict: core,
    info_gap: { role_A_knows: roleA, role_B_knows: roleB, shared_known: shared },
    secret_goal_by_role: secrets,
    survival_phrases: survival,
    two_minute_warmup: warmup,
    twist: twist || null,
  };
}

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
 * LLM 允许 5～7 条；落库固定6 条（房间 UI 与接口一致）。
 * @param {unknown} room_tasks
 * @returns {{ id: string, title: string, hints: string[] }[] | null}
 */
function normalizeRoomTasksToSix(room_tasks) {
  if (!Array.isArray(room_tasks)) return null;
  if (room_tasks.length < ROOM_TASKS_MIN || room_tasks.length > ROOM_TASKS_MAX) return null;
  var tasks = room_tasks.slice(0, ROOM_TASKS_MAX).map(function (t, i) {
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
          .slice(0, 8)
      : [];
    if (!title || hints.length < 2) return null;
    return { id: id, title: title, hints: hints };
  });
  if (tasks.some(function (x) {
    return !x;
  }))
    return null;

  if (tasks.length === 7) tasks = tasks.slice(0, ROOM_TASKS_TARGET);
  if (tasks.length === ROOM_TASKS_TARGET) return dedupeTaskIds(tasks);

  tasks.push({
    id: "t_supplement",
    title: "【拓展】用你自己的话承接上一条：补充或追问一点细节",
    hints: [
      "Could you say a bit more about that?",
      "I see — what would you do next in that situation?",
      "That makes sense. I had a slightly different idea…",
    ],
  });
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
  if (!scene_text || scene_text.length > 4000) return null;
  var roles = obj.roles;
  if (!Array.isArray(roles) || roles.length < 2) return null;
  roles = roles.slice(0, 2).map(function (r) {
    return {
      label: String(r.label || "ROLE").slice(0, 32),
      name: String(r.name || "").slice(0, 80),
      desc: String(r.desc || "").slice(0, 400),
    };
  });
  if (roles.length !== 2 || !roles[0].name || !roles[1].name) return null;
  var preview_markdown = String(obj.preview_markdown || "").trim();
  if (!preview_markdown || preview_markdown.length < PREVIEW_MARKDOWN_MIN_LEN || preview_markdown.length > 32000)
    return null;
  var cover_url = String(obj.cover_url || "").trim();
  if (!cover_url || !/^https?:\/\//i.test(cover_url)) return null;

  var roleNames = [roles[0].name, roles[1].name].map(function (x) {
    return String(x || "").trim();
  });

  var practiceKit = null;
  if (obj.practice_kit != null) {
    practiceKit = normalizePracticeKit(obj.practice_kit, roleNames);
    if (!practiceKit) return null;
  }

  var roomTasksPayload = null;
  // v3：按角色拆分任务集
  if (obj.room_tasks_by_role != null) {
    var by = normalizeRoomTasksByRoleToSix(obj.room_tasks_by_role, roleNames);
    if (!by) return null;
    roomTasksPayload = { version: 3, byRole: by };
  } else {
    // v2/v1：单一任务集（仍兼容）
    var room_tasks = normalizeRoomTasksToSix(obj.room_tasks);
    if (!room_tasks || room_tasks.length !== ROOM_TASKS_TARGET) return null;
    roomTasksPayload = room_tasks;
  }

  var difficulty_level = ["beginner", "intermediate", "advanced"].includes(String(obj.difficulty_level))
    ? String(obj.difficulty_level)
    : "intermediate";

  return {
    name: name,
    description: description,
    scene_text: scene_text,
    practice_kit: practiceKit,
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
    '  "practice_kit": {\n' +
    '    "core_conflict": string,\n' +
    '    "info_gap": { "role_A_knows": string, "role_B_knows": string, "shared_known": string[] },\n' +
    '    "secret_goal_by_role": Record<string, string>,\n' +
    '    "survival_phrases": { "when_stuck": string[], "when_disagree": string[], "when_time_pressed": string[] },\n' +
    '    "two_minute_warmup": Record<string, string>,\n' +
    '    "twist"?: string\n' +
    "  },\n" +
    '  "roles": { "label": string, "name": string, "desc": string }[],\n' +
    '  "preview_markdown": string,\n' +
    '  "cover_url": string,\n' +
    '  "difficulty_level": "beginner" | "intermediate" | "advanced",\n' +
    '  "room_tasks": { "id": string, "title": string, "hints": string[] }[]\n' +
    "}\n" +
    "要求：\n" +
    "- **接地气**：scene_text 必须写成真实可发生的对话场景，少形容词、少宏大叙事，多具体限制与尴尬点（例如：时间不够、信息缺失、对方误解、规则冲突、要做决定）。长度建议 120～260 字；避免空洞文学化形容。\n" +
    "- practice_kit 必须围绕「可聊下去」设计：必须包含 core_conflict（1句矛盾）、info_gap（双方信息差）、每角色 secret_goal、三类 survival_phrases（每类≤3句英文短句）、two_minute_warmup（按角色给出第一句话）。intermediate/advanced 必须提供 twist（突发转折）。\n" +
    "- roles **恰好 2 条**，与口语对练角色一致；每条 desc 为**总结性说明**（职责/目标/信息差），各不超过约 120 字。\n" +
    "- preview_markdown 为 **Markdown**，更偏“练”而不是“课纲”，至少包含这些一级标题：\n" +
    "  `# 2分钟开口` `# 关键信息差` `# 救命句` `# 容易踩坑` `# 6步推进`\n" +
    "其中「救命句」每类不超过 3 句，必须可直接在对话中说出来；避免长篇大论。\n" +
    "- cover_url：必须是可公网访问的 **https** 图片 URL；若不确定可用 Unsplash 与场景相关的图片 URL（模型仍需输出合法 URL；落库时可能保留种子封面）。\n" +
    "- room_tasks：若不提供 room_tasks_by_role，则输出 **5～7** 条（推荐 6条）。每条 title 为**中文**练习任务；hints 为 **3～5** 条**英文**常用句，口语难度与 difficulty_level 一致；任务之间递进、避免重复问法。\n" +
    "- room_tasks_by_role（推荐使用）：按角色名拆分任务：{ \"角色名A\": Task[], \"角色名B\": Task[] }；每个数组输出 **5～7** 条，服务端会规范成 6 条落库。\n" +
    "- 禁止教科书式“礼貌闲聊模板”。必须制造信息澄清、误解、冲突点或时间压力，让两个人不合作就完不成。\n" +
    "- 在种子基础上**改写增强**，不要逐字复制种子正文。";

  var directionBlock = direction
    ? "\n\n【管理员指定方向】你必须将本主题生成结果严格围绕以下方向/关键词展开：\n" + direction
    : "";
  var user = "以下为当前周主题种子（JSON）。请生成最终上架内容：" + dedupBlock + directionBlock + "\n\n" + seedJson;

  var msgs = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  var text;
  try {
    text = await chatCompletionText(msgs, { jsonMode: true });
  } catch (e1) {
    console.warn("[llm-theme] json_mode request failed, retry plain:", e1 && e1.message ? e1.message : e1);
    text = await chatCompletionText(msgs, { jsonMode: false });
  }

  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    var m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM 输出无法解析为 JSON");
    parsed = JSON.parse(m[0]);
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
           practice_kit_json = $9::jsonb,
           llm_generated_at = NOW(),
           llm_prompt_version = $10
         WHERE id = $11 AND llm_generated_at IS NULL`,
        [
          pack.name,
          pack.description,
          pack.scene_text,
          pack.roles_json,
          pack.preview_markdown,
          pack.cover_url,
          pack.difficulty_level,
          JSON.stringify(pack.room_tasks_payload),
          pack.practice_kit ? JSON.stringify(pack.practice_kit) : null,
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
 * 将当前**活跃**的非沙箱周主题（通常 3 条）用最新 v2 提示词整包覆盖；**保留**各行现有 cover_url。
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
           practice_kit_json = $9::jsonb,
           llm_generated_at = NOW(),
           llm_prompt_version = $10
         WHERE id = $11`,
        [
          pack.name,
          pack.description,
          pack.scene_text,
          pack.roles_json,
          pack.preview_markdown,
          pack.cover_url,
          pack.difficulty_level,
          JSON.stringify(pack.room_tasks_payload),
          pack.practice_kit ? JSON.stringify(pack.practice_kit) : null,
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
       practice_kit_json = $9::jsonb,
       llm_generated_at = NOW(),
       llm_prompt_version = $10
     WHERE id = $11`,
    [
      pack.name,
      pack.description,
      pack.scene_text,
      pack.roles_json,
      pack.preview_markdown,
      pack.cover_url,
      pack.difficulty_level,
      JSON.stringify(pack.room_tasks_payload),
      pack.practice_kit ? JSON.stringify(pack.practice_kit) : null,
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

/**
 * 调用 LLM 生成“主题整包”（极简场景 + 多轮对话任务 + 短预习），供管理员预览并写回 themes。
 * - 批处理：当前仓库已不在 init/周维护中自动执行（以管理员操作为准），但仍保留服务函数供显式调用。
 * - v5：scene_text 一句话；preview_markdown 含「核心词汇」「角色句型」二级块 + 三个一级标题；room_tasks_by_role 每角色恰好 6 条；每条 hints 3-4 句；用最近 12 个主题摘要做场景去重。
 */

const { chatCompletionText, isLlmConfigured } = require("./llmChat");

const PROMPT_VERSION = "theme_pack_v5";

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
/** 预习：核心词汇 + 角色句型 + 三个一级标题（见 tryValidatePack） */
const PREVIEW_MARKDOWN_MIN_LEN = 300;
const PREVIEW_MARKDOWN_MAX_LEN = 3000;
const SCENE_TEXT_MAX_LEN = 220;
const ROLE_DESC_MAX_LEN = 25;

/** 预览失败时随响应返回的 LLM 原文上限（字符），避免响应体过大 */
const LLM_DEBUG_RAW_MAX = 250000;

/**
 * @param {string} text
 * @param {unknown} parsedJson
 * @param {string[]} validationErrors
 * @param {string} parseStage
 */
function buildLlmDebug(text, parsedJson, validationErrors, parseStage) {
  var t = text == null ? "" : String(text);
  var truncated = t.length > LLM_DEBUG_RAW_MAX;
  var rawText = truncated ? t.slice(0, LLM_DEBUG_RAW_MAX) + "\n\n…（已截断，原始约 " + t.length + " 字符）" : t;
  return {
    rawText: rawText,
    parsedJson: parsedJson != null ? parsedJson : null,
    validationErrors: Array.isArray(validationErrors) ? validationErrors : [],
    parseStage: parseStage || "",
    truncated: truncated,
  };
}

/**
 * @param {string} message
 * @param {ReturnType<typeof buildLlmDebug>} debug
 */
function throwThemeGenerateError(message, debug) {
  var e = new Error(message);
  e.code = "THEME_PACK_GENERATE_FAILED";
  e.llmDebug = debug;
  throw e;
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

/**
 * 校验主题整包；失败时收集**全部**可读原因（供管理员手动录入页展示）。
 * @returns {{ errors: string[], pack: object | null }}
 */
function tryValidatePack(obj) {
  /** @type {string[]} */
  var errors = [];
  if (!obj || typeof obj !== "object") {
    errors.push("根数据必须是 JSON 对象");
    return { errors: errors, pack: null };
  }

  var name = String(obj.name || "").trim();
  if (!name) errors.push("「主题名称」不能为空");
  else if (name.length > 120) errors.push("「主题名称」不能超过 120 字");

  var description = String(obj.description || "").trim();
  if (!description) errors.push("「一句话简介 description」不能为空");
  else if (description.length > 2000) errors.push("「简介」不能超过 2000 字");

  var scene_text = String(obj.scene_text || "").trim();
  if (!scene_text) errors.push("「场景 scene_text」不能为空（一句话：谁在做什么）");
  else if (scene_text.length > SCENE_TEXT_MAX_LEN) {
    errors.push("「场景」不能超过 " + String(SCENE_TEXT_MAX_LEN) + " 字，请缩短为一句");
  }

  var rolesArr = obj.roles;
  if (!rolesArr && obj.roles_json != null) {
    try {
      rolesArr = typeof obj.roles_json === "string" ? JSON.parse(obj.roles_json) : obj.roles_json;
    } catch (e) {
      errors.push("「roles_json」不是合法 JSON：" + (e && e.message ? String(e.message) : String(e)));
      rolesArr = null;
    }
  }
  if (!Array.isArray(rolesArr) || rolesArr.length < 2) {
    errors.push("「角色 roles」须为数组且至少 2 条（产品固定为两人对话）");
  }
  var roles = Array.isArray(rolesArr)
    ? rolesArr.slice(0, 2).map(function (r) {
        return {
          label: String((r && r.label) || "ROLE").slice(0, 32),
          name: String((r && r.name) || "").slice(0, 80),
          desc: String((r && r.desc) || "").trim().slice(0, ROLE_DESC_MAX_LEN),
        };
      })
    : [];
  if (roles.length !== 2) {
    errors.push("解析后需要**两个**完整角色条目（每项含中文名与职责），当前不足两条");
  } else {
    if (!roles[0].name || !roles[1].name) errors.push("两个角色都必须填写「中文名 name」（用于房间内任务分组键）");
    if (!roles[0].desc) errors.push("角色一「职责 desc」不能为空（建议不超过 " + String(ROLE_DESC_MAX_LEN) + " 字）");
    if (!roles[1].desc) errors.push("角色二「职责 desc」不能为空（建议不超过 " + String(ROLE_DESC_MAX_LEN) + " 字）");
  }

  var preview_markdown = String(obj.preview_markdown || "").trim();
  if (!preview_markdown) errors.push("「预习 preview_markdown」不能为空");
  else {
    if (preview_markdown.length < PREVIEW_MARKDOWN_MIN_LEN) {
      errors.push(
        "「预习」过短（至少 " +
          String(PREVIEW_MARKDOWN_MIN_LEN) +
          " 字），须含「## 核心词汇」「## 角色句型」及三个一级标题（见管理员模板）"
      );
    }
    if (preview_markdown.length > PREVIEW_MARKDOWN_MAX_LEN) {
      errors.push("「预习」不能超过 " + String(PREVIEW_MARKDOWN_MAX_LEN) + " 字");
    }
    if (!/##\s*核心词汇/.test(preview_markdown)) {
      errors.push("预习中必须包含二级标题：`## 核心词汇`（## 与文字之间可有空格）");
    }
    if (!/##\s*角色句型/.test(preview_markdown)) {
      errors.push("预习中必须包含二级标题：`## 角色句型`");
    }
    var idxOpen = preview_markdown.search(/#\s*开口句/);
    var idxVocab = preview_markdown.search(/##\s*核心词汇/);
    var idxPhrase = preview_markdown.search(/##\s*角色句型/);
    if (idxOpen >= 0 && idxVocab >= 0 && idxVocab > idxOpen) {
      errors.push("「## 核心词汇」须出现在「# 开口句」**之前**");
    }
    if (idxOpen >= 0 && idxPhrase >= 0 && idxPhrase > idxOpen) {
      errors.push("「## 角色句型」须出现在「# 开口句」**之前**");
    }
    if (!/#\s*开口句/.test(preview_markdown)) errors.push("预习中必须包含一级标题：`# 开口句`（# 与文字之间可有空格）");
    if (!/#\s*你的6个任务（概览）/.test(preview_markdown)) {
      errors.push("预习中必须包含一级标题：`# 你的6个任务（概览）`");
    }
    if (!/#\s*延长对话小贴士/.test(preview_markdown)) errors.push("预习中必须包含一级标题：`# 延长对话小贴士`");
  }

  var cover_url = String(obj.cover_url || "").trim();
  if (!cover_url) errors.push("「封面 cover_url」不能为空（须为 http(s) 图片链接；写入时通常会以库中预置封面为准）");
  else if (!/^https?:\/\//i.test(cover_url)) errors.push("「封面 cover_url」须以 http:// 或 https:// 开头");

  var roleNames =
    roles.length === 2
      ? [String(roles[0].name || "").trim(), String(roles[1].name || "").trim()]
      : ["", ""];

  if (roleNames[0] && roleNames[1] && roleNames[0] === roleNames[1]) {
    errors.push("两个角色的中文名不能完全相同，否则无法区分任务分组");
  }

  var byRoleRaw = obj.room_tasks_by_role;
  if (byRoleRaw == null) {
    errors.push("缺少「room_tasks_by_role」：以角色中文名为键、每人 6 条任务为值的对象");
  } else if (typeof byRoleRaw !== "object" || Array.isArray(byRoleRaw)) {
    errors.push("「room_tasks_by_role」必须是对象（不能是数组）");
  } else if (roleNames[0] && roleNames[1]) {
    for (var ri = 0; ri < 2; ri++) {
      var rn = roleNames[ri];
      if (!Object.prototype.hasOwnProperty.call(byRoleRaw, rn)) {
        errors.push(
          "「room_tasks_by_role」缺少键「" +
            rn +
            "」：键名必须与上方「角色" +
            String(ri + 1) +
            "中文名」**逐字一致**（含空格）"
        );
      }
    }
    for (var ti = 0; ti < 2; ti++) {
      var rname = roleNames[ti];
      if (!rname || !Object.prototype.hasOwnProperty.call(byRoleRaw, rname)) continue;
      var arr = byRoleRaw[rname];
      if (!Array.isArray(arr)) {
        errors.push("角色「" + rname + "」的任务值必须是长度为 6 的数组");
        continue;
      }
      if (arr.length !== ROOM_TASKS_TARGET) {
        errors.push("角色「" + rname + "」须恰好 " + String(ROOM_TASKS_TARGET) + " 条任务，当前为 " + String(arr.length) + " 条");
      }
      var limit = Math.min(arr.length, ROOM_TASKS_TARGET);
      for (var k = 0; k < limit; k++) {
        var task = arr[k];
        var title = task && String(task.title || "").trim();
        var hints = Array.isArray(task && task.hints)
          ? task.hints
              .map(function (h) {
                return String(h).trim();
              })
              .filter(Boolean)
              .slice(0, HINTS_MAX)
          : [];
        if (!title) errors.push("角色「" + rname + "」第 " + String(k + 1) + " 条任务缺少「中文标题 title」");
        if (hints.length < HINTS_MIN) {
          errors.push(
            "角色「" +
              rname +
              "」第 " +
              String(k + 1) +
              " 条：英文提示「hints」至少 " +
              String(HINTS_MIN) +
              " 句，当前有效句数为 " +
              String(hints.length)
          );
        }
      }
    }
  }

  if (errors.length) return { errors: errors, pack: null };

  var by = normalizeRoomTasksByRoleToSix(obj.room_tasks_by_role, roleNames);
  if (!by) {
    errors.push(
      "「room_tasks_by_role」结构未通过归一化校验：请确认每位角色 6 条、每条含标题且 hints 为 " +
        String(HINTS_MIN) +
        "～" +
        String(HINTS_MAX) +
        " 条英文短句"
    );
    return { errors: errors, pack: null };
  }

  var roomTasksPayload = { version: 3, byRole: by };
  var difficulty_level = ["beginner", "intermediate", "advanced"].includes(String(obj.difficulty_level))
    ? String(obj.difficulty_level)
    : "intermediate";

  return {
    errors: [],
    pack: {
      name: name,
      description: description,
      scene_text: scene_text,
      roles_json: JSON.stringify(roles),
      preview_markdown: preview_markdown,
      cover_url: cover_url,
      difficulty_level: difficulty_level,
      room_tasks_payload: roomTasksPayload,
    },
  };
}

function validatePack(obj) {
  var r = tryValidatePack(obj);
  return r.pack;
}

/**
 * @param {unknown} obj
 * @returns {{ ok: boolean, errors: string[], normalizedPack: object | null }}
 */
function validatePackDetailed(obj) {
  var r = tryValidatePack(obj);
  return { ok: r.errors.length === 0, errors: r.errors, normalizedPack: r.pack };
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
      " 个**主题的场景摘要（不含当前正生成的主题）。你必须避免**撞场景**：不得使用与下列在「地点/场合/职业组合/核心互动」上高度雷同的设定；禁止换皮复述（例如已出现「咖啡馆排队」则不可再做「咖啡店等餐」类同构场景）。请选一个**新鲜**的口语情境。\n" +
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
    '  "room_tasks_by_role": Record<string, { "id"?: string, "title": string, "hints": string[] }[]>\n' +
    "}\n" +
    "字段与风格要求：\n" +
    "- name：中文主题标题，建议 **≤20 字**。\n" +
    "- description：一句话简介，建议 **≤50 字**。\n" +
    "- scene_text：**恰好一句**中文场景（建议 ≤50 字），只写「谁在做什么」，禁止时间线、人物小传、矛盾冲突、秘密目标等剧情化描写。避免与【场景去重】列表雷同。\n" +
    "- roles：**恰好 2 条**；label 可用 ROLE 1/ROLE 2；name 为角色中文名；desc 职责说明 **≤25 汉字**。\n" +
    "- preview_markdown：总长度 **" +
    String(PREVIEW_MARKDOWN_MIN_LEN) +
    "～" +
    String(PREVIEW_MARKDOWN_MAX_LEN) +
    " 字**（中文为主）。**在第一个一级标题 `#` 之前**，必须先写两个二级模块（`##`，# 与字间可有空格）：\n" +
    "  1) `## 核心词汇`：分 2～3 组主题词，每组 3～4 个英文词，附音标与中文释义（Markdown 列表）。\n" +
    "  2) `## 角色句型`：每个角色 3～5 条常用句，用反引号包裹英文，可用 `[替换词]` 表示可替换部分。\n" +
    "  然后按顺序包含三个**一级**标题（必须带 `#`）：`# 开口句`、`# 你的6个任务（概览）`、`# 延长对话小贴士`。\n" +
    "  - 「# 开口句」：两角色各一句可立刻开口的英文。\n" +
    "  - 「# 你的6个任务（概览）」：两角色各列 6 条中文任务标题（编号 1-6），顺序能串成自然对话。\n" +
    "  - 「# 延长对话小贴士」：至少 3 条技巧，每条含中文说明 + **完整自然**的英文例句。\n" +
    "- cover_url：可公网访问的 **https** 图片 URL（可用 Unsplash 与场景相关图；落库时可能保留种子封面）。\n" +
    "- difficulty_level：三选一；日常场景建议 intermediate。\n" +
    "- **room_tasks_by_role（强制）**：键名与 roles[].name **逐字一致**；每角色 **恰好 6** 条任务。\n" +
    "  - title：中文 **5～10 字**，每条一个小对话目标；任务间有呼应（如问价→推荐→追问→决定→付款→道别）。\n" +
    "  - hints：每条 **" +
    String(HINTS_MIN) +
    " 或 " +
    String(HINTS_MAX) +
    " 句**英文口语短句，每句 ≤15 个英文词，覆盖同意/拒绝/追问等分支；可省略 id（服务端会规范化）。\n" +
    "- 在种子与【管理员指定方向】基础上**改写增强**，勿逐字抄种子。";

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
      throwThemeGenerateError(
        "LLM 输出无法解析为 JSON（可能被截断或非 JSON）。请重试；若仍失败请在 .env 设置 OPENAI_THEME_MAX_TOKENS=12288 或更高。原始错误：" +
          (eParse && eParse.message ? eParse.message : String(eParse)),
        buildLlmDebug(text, null, [], "json_parse_no_brace")
      );
    }
    try {
      parsed = JSON.parse(m[0]);
    } catch (e2) {
      throwThemeGenerateError(
        "LLM JSON 不完整或非法，请重试或增大 OPENAI_THEME_MAX_TOKENS。详情：" + (e2 && e2.message ? e2.message : String(e2)),
        buildLlmDebug(text, null, [], "json_parse_extract")
      );
    }
  }

  var detailed = validatePackDetailed(parsed);
  if (!detailed.ok || !detailed.normalizedPack) {
    var hint =
      detailed.errors && detailed.errors.length
        ? detailed.errors.join("；")
        : "结构校验未通过";
    throwThemeGenerateError(
      "LLM JSON 未通过校验：" + hint,
      buildLlmDebug(text, parsed, detailed.errors || [], "validate")
    );
  }
  var pack = detailed.normalizedPack;
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
  validatePackDetailed,
  applySeedCoverUrl,
  fetchRecentThemeDedupContext,
  PROMPT_VERSION,
};

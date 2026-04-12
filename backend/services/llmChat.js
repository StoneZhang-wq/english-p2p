/**
 * OpenAI 兼容 Chat Completions（适用于豆包方舟等：配置 OPENAI_BASE_URL + OPENAI_API_KEY + OPENAI_MODEL）。
 */

function resolveChatCompletionsUrl() {
  const base = (process.env.OPENAI_BASE_URL || "").trim();
  if (!base) return "https://api.openai.com/v1/chat/completions";
  if (/\/chat\/completions\/?$/i.test(base)) return base.replace(/\/$/, "");
  return `${base.replace(/\/$/, "")}/chat/completions`;
}

function isLlmConfigured() {
  const k = (process.env.OPENAI_API_KEY || "").trim();
  if (!k || k.length < 16) return false;
  if (/your_openai|placeholder|changeme|example/i.test(k)) return false;
  return true;
}

/**
 * @param {{ role: string; content: string }[]} messages
 * @param {{ jsonMode?: boolean }} [options]
 * @returns {Promise<string>} assistant 文本（若 jsonMode 则为 JSON 字符串）
 */
async function chatCompletionText(messages, options) {
  if (!isLlmConfigured()) {
    const err = new Error("LLM 未配置：请设置 OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL");
    err.code = "LLM_NOT_CONFIGURED";
    throw err;
  }

  const apiKey = process.env.OPENAI_API_KEY.trim();
  const model = (process.env.OPENAI_MODEL || "gpt-4o").trim();
  const url = resolveChatCompletionsUrl();

  const body = {
    model,
    messages,
    temperature: 0.65,
  };
  if (options && options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const err = new Error(`LLM 响应非 JSON（HTTP ${res.status}）`);
    err.code = "LLM_BAD_RESPONSE";
    err.detail = raw.slice(0, 500);
    throw err;
  }

  if (!res.ok) {
    const msg = json && (json.error?.message || json.message) ? String(json.error?.message || json.message) : raw.slice(0, 200);
    const err = new Error(`LLM 请求失败 HTTP ${res.status}: ${msg}`);
    err.code = "LLM_HTTP";
    throw err;
  }

  const choice = json.choices && json.choices[0];
  const text = choice && choice.message && choice.message.content != null ? String(choice.message.content).trim() : "";
  if (!text) {
    const err = new Error("LLM 返回空 content");
    err.code = "LLM_EMPTY";
    throw err;
  }
  return text;
}

module.exports = { chatCompletionText, resolveChatCompletionsUrl, isLlmConfigured };

/* ============================================================
   ai.js —— 页面级 LLM 助手（轻量、无 LangGraph）
   供 viz/ 下的静态页面直接调用（论文层 / 星座 / 猜测 等）。
   依赖 js/config.js 中用户在浏览器配置好的 baseUrl/apiKey/model。
   ============================================================ */

import { loadConfig, hasLLM, normalizeBaseUrl, mixedContentWarning } from './config.js';

/** 归一化 baseUrl + /chat/completions */
function endpoint() {
  const cfg = loadConfig();
  return normalizeBaseUrl(cfg.baseUrl) + '/chat/completions';
}

function headers() {
  const cfg = loadConfig();
  const h = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) h.Authorization = 'Bearer ' + cfg.apiKey;
  if (/openrouter/i.test(cfg.baseUrl || '')) {
    h['HTTP-Referer'] = location.origin || 'https://github.com';
    h['X-Title'] = 'Nobel KG Viz AI';
  }
  return h;
}

function fetchTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

/**
 * 单次非流式对话；返回字符串内容。
 * @param {string} systemPrompt 系统提示词
 * @param {string} userPrompt 用户输入
 * @param {{temperature?:number, timeoutMs?:number, maxTokens?:number}} opts
 */
export async function ask(systemPrompt, userPrompt, opts) {
  opts = opts || {};
  if (!hasLLM()) {
    const err = new Error('尚未配置 LLM 接口，请前往首页「设置」填写 baseUrl / apiKey / model。');
    err.code = 'NO_LLM';
    throw err;
  }
  const cfg = loadConfig();
  const mc = mixedContentWarning(cfg.baseUrl);
  if (mc) { const err = new Error(mc); err.code = 'MIXED'; throw err; }

  const body = {
    model: cfg.model,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  let res;
  try {
    res = await fetchTimeout(endpoint(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    }, opts.timeoutMs || 45000);
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error('请求超时，模型未在 ' + (opts.timeoutMs || 45000) + 'ms 内返回。'); err.code = 'TIMEOUT'; throw err; }
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error('模型接口返回 ' + res.status + ': ' + (text.slice(0, 300) || res.statusText));
    err.code = 'HTTP_' + res.status;
    throw err;
  }
  const data = await res.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  const content = msg && (msg.content || '');
  if (!content) {
    const err = new Error('模型返回内容为空');
    err.code = 'EMPTY';
    throw err;
  }
  return content;
}

/** 流式对话，回调 (chunkText) => void，返回最终拼接文本 */
export async function askStream(systemPrompt, userPrompt, onChunk, opts) {
  opts = opts || {};
  if (!hasLLM()) {
    const err = new Error('尚未配置 LLM 接口。');
    err.code = 'NO_LLM';
    throw err;
  }
  const cfg = loadConfig();
  const body = {
    model: cfg.model,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('模型接口返回 ' + res.status + ': ' + (text.slice(0, 300) || res.statusText));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let out = '';
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    buf += decoder.decode(r.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s || s === 'data: [DONE]') continue;
      if (!s.startsWith('data: ')) continue;
      const payload = s.slice(6);
      try {
        const obj = JSON.parse(payload);
        const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
        if (delta && delta.content) {
          out += delta.content;
          onChunk && onChunk(delta.content, out);
        }
      } catch (_) { /* ignore */ }
    }
  }
  return out;
}

/** 判断是否配置了 LLM（供页面在渲染时决定 AI 面板是否显示） */
export { hasLLM };

/** 简易错误提示文本 */
export function friendlyError(err) {
  if (!err) return '发生未知错误';
  switch (err.code) {
    case 'NO_LLM': return '尚未配置 LLM，请前往首页「设置」填写接口地址 / Key / 模型。';
    case 'MIXED': return err.message;
    case 'TIMEOUT': return err.message;
    default: return err.message || String(err);
  }
}

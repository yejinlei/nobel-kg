/* ============================================================
   config.js —— 访问者本地配置（保存在浏览器 localStorage）
   任何 Key 都不会离开访问者的浏览器。
   ============================================================ */

const STORAGE_KEY = 'nobel_kg_config_v1';

/** 出厂默认值：指向支持浏览器跨域的 OpenRouter */
export const DEFAULTS = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: 'openai/gpt-4o-mini',
  temperature: 0.2,
  tavilyKey: '',
};

/** 常用服务商预设，方便访问者一键填充 */
export const PROVIDER_PRESETS = [
  {
    id: 'openrouter',
    label: 'OpenRouter（推荐｜官方支持浏览器跨域）',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5'],
    applyUrl: 'https://openrouter.ai/keys',
    note: '聚合数百种模型，有免费模型可用，跨域请求官方支持。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow（国内）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    applyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '国内访问稳定；能否浏览器直连需实测，遇到跨域错误请换用中转或 OpenRouter。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    applyUrl: 'https://platform.deepseek.com/api_keys',
    note: '性价比高。部分网络环境下浏览器直连可能被跨域策略拦截。',
  },
  {
    id: 'custom',
    label: '自定义（兼容 OpenAI 接口 / 自建中转）',
    baseUrl: '',
    model: '',
    models: [],
    applyUrl: '',
    note: '填写你自己的 OpenAI 兼容网关地址，例如 one-api / new-api 部署的地址。',
  },
];

let cached = null;

/** 读取配置；缺失字段用默认值补齐 */
export function loadConfig() {
  if (cached) return cached;
  let stored = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) || {};
  } catch (e) {
    console.warn('[config] 读取本地配置失败，使用默认值', e);
  }
  cached = { ...DEFAULTS, ...stored };
  return cached;
}

/** 写入配置（仅本地） */
export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('[config] 保存本地配置失败', e);
  }
  return next;
}

/** 清空全部本地配置 */
export function clearConfig() {
  cached = { ...DEFAULTS };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[config] 清除本地配置失败', e);
  }
  return cached;
}

/** 是否已配置可用的对话模型 —— 决定能否启用 Agent 能力 */
export function hasLLM(cfg) {
  const c = cfg || loadConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

/** 是否已配置联网检索 —— 决定能否启用深度研究
 *  说明：深度研究统一走 webLookup。
 *  - 配了 Tavily Key → 使用 Tavily；
 *  - 未配 Tavily Key → 自动退到维基百科 / Wikidata（零 Key 跨域可用）。
 *  所以只要有 LLM，deepresearch 就有内容可补充；配 Tavily 会让检索更全面。
 */
export function hasWebSearch(cfg) {
  const c = cfg || loadConfig();
  return hasLLM(c); // 有 LLM 就可用（维基兜底），配 Tavily 更全面
}

/** 是否配置了 Tavily（用来决定提示文案） */
export function hasTavily(cfg) {
  const c = cfg || loadConfig();
  return Boolean(c.tavilyKey);
}

/** 归一化 baseUrl，兼容用户填 https://xxx/v1 或 https://xxx/v1/ 或漏写 /v1 */
export function normalizeBaseUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

/**
 * Mixed Content 检测：HTTPS 页面调用 http:// 接口会被浏览器直接拦截。
 * @AI_GUARD 不要自动把 http 改写成 https —— 自建服务未必开了 HTTPS，静默改写只会得到另一种失败
 * @returns 警告文案；无问题时返回 null
 */
export function mixedContentWarning(baseUrl) {
  const u = normalizeBaseUrl(baseUrl);
  if (u && location.protocol === 'https:' && /^http:\/\//i.test(u)) {
    return '⚠️ 当前页面是 HTTPS，浏览器会拦截对 http:// 接口的调用（Mixed Content）。'
      + '请把接口地址改成 https://；若自建服务（如 vLLM）只开了 HTTP，'
      + '需在其前面加一层 HTTPS 反向代理（Nginx/Caddy + 证书）后再填写代理地址。';
  }
  return null;
}

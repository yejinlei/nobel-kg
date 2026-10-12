/* ============================================================
   main.js —— 界面控制器
   串起：DuckDB-WASM 数据层 → 本体工具 → LangGraph 智能体 → 输出渲染
   ============================================================ */

import { initDB, initReady, getTableInfo, overview, isReady } from './db.js';
import { loadConfig, saveConfig, clearConfig, hasLLM, hasWebSearch, PROVIDER_PRESETS, DEFAULTS, normalizeBaseUrl, mixedContentWarning } from './config.js';
import { runAgent, researchAvailable, HELP_TEXT } from './agent.js';
import { renderMarkdown, renderBlocks, renderTrace, escapeHtml } from './render.js';

/* ------------------- Service Worker 注册（缓存 wasm + parquet） ------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/* ------------------------- 元素引用 ------------------------- */

const $ = (id) => document.getElementById(id);
const el = {
  dbStatus: $('dbStatus'),
  chatHero: $('chatHero'),
  chatScroll: $('chatScroll'),
  chatMessages: $('chatMessages'),
  userInput: $('userInput'),
  sendBtn: $('sendBtn'),
  quickActions: $('quickActions'),
  modeBadge: $('modeBadge'),
  researchToggle: $('researchToggle'),
  researchHint: $('researchHint'),
  newChatBtn: $('newChatBtn'),
  settingsDetails: $('settingsDetails'),
  loadingOverlay: $('loadingOverlay'),
  loadingText: $('loadingText'),
  // 设置项
  providerPreset: $('providerPreset'),
  baseUrl: $('baseUrl'),
  apiKey: $('apiKey'),
  modelName: $('modelName'),
  tavilyKey: $('tavilyKey'),
  saveSettings: $('saveSettings'),
  clearSettings: $('clearSettings'),
  testConnection: $('testConnection'),
  testResult: $('testResult'),
  // 搜索引擎配置
  enginesWrap: $('enginesWrap'),
};

/** 搜索引擎字段配置：id → { label, hasBaseUrl, hasTimeout, defaultUrl } */
const ENGINE_FIELDS = {
  tavily:  { label: 'Tavily（需 Key）',        hasBaseUrl: false, defaultUrl: '' },
  wiki:    { label: 'Wikipedia/Wikidata',      hasBaseUrl: false, defaultUrl: '' },
};
const ENGINE_ORDER_UI = ['tavily', 'wiki'];

const QUICK_QUESTIONS = [
  '杨振宁的师承链',
  '索末菲门下的学生',
  '玻尔和杨振宁之间隔几代',
  '哪位导师培养的诺奖得主最多',
  '卡文迪许学派',
  '克里克的论文',
  '诺奖潜力预测 top5',
  '网络总览',
];

/* ------------------------- 状态 ------------------------- */

let busy = false;
let resolveWait = null;    // 首次提问时挂起的等待 resolve 回调
let waitHint = null;       // 等待中的提示节点，用于同步初始化进度文案

/* ------------------------- 状态栏 ------------------------- */

function setStatus(kind, text) {
  const dot = el.dbStatus.querySelector('.status-dot');
  const t = el.dbStatus.querySelector('.status-text');
  dot.className = 'status-dot ' + kind;
  t.textContent = text;
}

/* ------------------------- 启动 ------------------------- */

/**
 * 页面启动流程：
 *   1. UI 立即就绪，不阻塞任何交互（遮罩默认隐藏）；
 *   2. WASM/Parquet 初始化在后台以 Promise 形式进行，
 *      侧栏状态灯和右下角 badge 实时反映进度；
 *   3. 首次提问时才 await 初始化——就绪则秒回，否则等它完成。
 * 这样用户打开页面即可浏览图谱入口、切换服务商、看欢迎语，
 * 而不是被 40MB WASM 的下载遮罩卡住。
 */
function boot() {
  renderWelcomeExtras();
  fillSettingsForm();
  bindEvents();
  updateModeUI();

  // 遮罩默认隐藏：不阻断用户浏览页面
  if (el.loadingOverlay) el.loadingOverlay.classList.add('hidden');

  // 后台启动初始化（不 await）；失败由下方 catch 处理
  initDB((msg) => {
    setStatus('loading', msg);
    if (el.loadingText) el.loadingText.textContent = msg;
    // 首次提问时若正在等待，用最新进度更新等待提示
    if (waitHint) waitHint.textContent = msg;
  }).then(() => {
    return overview().catch(() => null);
  }).then((ov) => {
    const info = getTableInfo();
    setStatus('ok', ov ? `本体就绪 · ${ov.persons} 人 / ${ov.mentorships} 条师承` : `本体就绪 · ${info.length} 张表`);
    fillWelcomeStats(ov, info);
    // 若用户正在等待，解除等待
    resolveWait && resolveWait(ov, info);
  }).catch((e) => {
    console.error(e);
    setStatus('error', '数据库加载失败');
    const err = new Error('数据库未能加载：' + e.message + '\n\n请确认通过 HTTP 方式访问（本地可用 `python -m http.server` 启动），并检查网络能否访问 CDN。');
    if (resolveWait) { resolveWait(null, null, err); resolveWait = null; }
  });
}

/** 等待 DB 就绪；返回 { overview, tableInfo }，出错时 reject */
function ensureReady(timeoutMs = 90000) {
  if (isReady()) return Promise.resolve({ overview: null, tableInfo: getTableInfo() });
  return new Promise((resolve, reject) => {
    resolveWait = (ov, info, err) => {
      if (err) reject(err);
      else resolve({ overview: ov, tableInfo: info });
    };
    // 超时保护：不让用户永远挂在等待里
    setTimeout(() => {
      if (resolveWait) {
        resolveWait = null;
        reject(new Error('数据库初始化超时，请刷新页面重试，或稍后再试。'));
      }
    }, timeoutMs);
  });
}

function bannerError(msg) {
  const div = document.createElement('div');
  div.className = 'msg error';
  div.innerHTML = `<div class="msg-avatar">⚠️</div><div class="msg-body"><div class="msg-content">${escapeHtml(msg).replace(/\n/g, '<br>')}</div></div>`;
  el.chatMessages.appendChild(div);
  showChat();
}

function fillWelcomeStats(ov, info) {
  const box = $('welcomeStats');
  if (!box || !ov) return;
  box.innerHTML = [
    ['收录人物', ov.persons + ' 位'],
    ['诺奖得主', ov.laureates + ' 位（学术四奖，1901–2026）'],
    ['师承子图', ov.core_laureates + ' 位高价值'],
    ['师承关系', ov.mentorships + ' 条'],
    ['学术学派', ov.schools + ' 个'],
    ['论文/著作', ov.papers + ' 篇'],
    ['研究范式', ov.paradigms + ' 个'],
    ['奖项记录', ov.prizes + ' 条'],
  ].map(([k, v]) => `<div class="stat-item"><div class="stat-num">${escapeHtml(v)}</div><div class="stat-label">${escapeHtml(k)}</div></div>`).join('');
  box.classList.remove('hidden');
}

/* ------------------------- 欢迎页附加内容 ------------------------- */

function renderWelcomeExtras() {
  // 服务商预设（图谱入口已固定在左侧边栏）
  const sel = el.providerPreset;
  if (sel) {
    sel.innerHTML = PROVIDER_PRESETS.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  }
  renderEngineRows();
}

/** 渲染搜索引擎配置行：勾选框 + 超时(ms) + 可选的 baseUrl */
function renderEngineRows() {
  const wrap = el.enginesWrap;
  if (!wrap) return;
  wrap.innerHTML = ENGINE_ORDER_UI.map((id) => {
    const f = ENGINE_FIELDS[id];
    const base = f.hasBaseUrl
      ? `<input type="text" class="engine-baseurl" data-engine="${id}" data-field="baseUrl" placeholder="https://your-endpoint.example.com">`
      : '';
    return `<div class="engine-row" data-engine="${id}">
      <label class="engine-toggle">
        <input type="checkbox" class="engine-enabled" data-engine="${id}" data-field="enabled">
        <span>${escapeHtml(f.label)}</span>
      </label>
      ${base}
      <label class="engine-timeout"><span>超时</span><input type="number" class="engine-timeout-input" data-engine="${id}" data-field="timeout" min="1000" max="30000" step="500">ms</label>
    </div>`;
  }).join('');
}

/** 收集 UI 上的搜索引擎配置 */
function collectEngineConfig() {
  const wrap = el.enginesWrap;
  if (!wrap) return {};
  const out = {};
  for (const id of ENGINE_ORDER_UI) {
    const row = wrap.querySelector(`.engine-row[data-engine="${id}"]`);
    if (!row) continue;
    const enabled = row.querySelector('.engine-enabled');
    const timeoutInput = row.querySelector('.engine-timeout-input');
    const baseInput = row.querySelector('.engine-baseurl');
    const item = {
      enabled: Boolean(enabled && enabled.checked),
      timeout: Math.max(1000, Math.min(30000, parseInt(timeoutInput && timeoutInput.value, 10) || 6000)),
    };
    if (baseInput) item.baseUrl = baseInput.value.trim();
    out[id] = item;
  }
  return out;
}

/** 把配置回填到 UI */
function applyEngineConfig(cfg) {
  const wrap = el.enginesWrap;
  if (!wrap || !cfg || !cfg.searchEngines) return;
  const se = cfg.searchEngines;
  for (const id of ENGINE_ORDER_UI) {
    const row = wrap.querySelector(`.engine-row[data-engine="${id}"]`);
    if (!row) continue;
    const c = se[id] || {};
    const enabled = row.querySelector('.engine-enabled');
    const timeoutInput = row.querySelector('.engine-timeout-input');
    const baseInput = row.querySelector('.engine-baseurl');
    if (enabled) enabled.checked = Boolean(c.enabled);
    if (timeoutInput) timeoutInput.value = String(c.timeout || 6000);
    if (baseInput) baseInput.value = c.baseUrl || '';
  }
}

/* ------------------------- 模式 UI ------------------------- */

function updateModeUI() {
  const cfg = loadConfig();
  const llm = hasLLM(cfg);
  const web = hasWebSearch(cfg);
  const enabledEngines = ENGINE_ORDER_UI.filter((id) => {
    const c = (cfg.searchEngines || {})[id];
    return c && c.enabled;
  });

  if (el.modeBadge) {
    if (llm) {
      el.modeBadge.textContent = `🧠 大模型模式：${cfg.model}`;
      el.modeBadge.className = 'mode-badge';
    } else {
      el.modeBadge.textContent = '⚙️ 本地规则引擎（未配置大模型）';
      el.modeBadge.className = 'mode-badge rule';
    }
  }
  if (el.researchToggle) {
    el.researchToggle.disabled = !llm;
    el.researchToggle.checked = llm;
  }
  if (el.researchHint) {
    if (!llm) el.researchHint.textContent = '深度研究需先配置大模型；引擎分层兜底见左侧设置';
    else if (!web) el.researchHint.textContent = '深度研究不可用：请在设置里至少启用一个搜索引擎（如维基）';
    else el.researchHint.textContent = `已就绪：分层检索 ${enabledEngines.join(' → ')}，并结合本体分析`;
  }
}

/* ------------------------- 事件绑定 ------------------------- */

function bindEvents() {
  el.saveSettings.addEventListener('click', onSaveSettings);
  el.clearSettings.addEventListener('click', onClearSettings);
  el.testConnection.addEventListener('click', onTestConnection);
  el.providerPreset.addEventListener('change', onPresetChange);

  el.sendBtn.addEventListener('click', () => send());
  el.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  el.userInput.addEventListener('input', autoResize);
  el.newChatBtn.addEventListener('click', () => {
    el.chatMessages.innerHTML = '';
    showWelcome();
    el.userInput.focus();
  });

  // 快捷问题
  el.quickActions.innerHTML = QUICK_QUESTIONS.map((q) => `<button class="quick-btn" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
  el.quickActions.addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-btn');
    if (btn) send(btn.dataset.q);
  });
}

function autoResize() {
  el.userInput.style.height = 'auto';
  el.userInput.style.height = Math.min(el.userInput.scrollHeight, 150) + 'px';
}

/* ------------------------- 面板切换 ------------------------- */

function showChat() {
  el.chatHero.classList.add('hidden');
}
function showWelcome() {
  el.chatHero.classList.remove('hidden');
}

/* ------------------------- 消息渲染 ------------------------- */

function addMessage(role, html) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const avatar = role === 'user' ? '🧑' : '🏆';
  wrap.innerHTML = `<div class="msg-avatar">${avatar}</div><div class="msg-body"><div class="msg-role">${role === 'user' ? '你' : '本体助手'}</div><div class="msg-content"></div></div>`;
  const content = wrap.querySelector('.msg-content');
  if (html != null) content.innerHTML = html;
  el.chatMessages.appendChild(wrap);
  scrollBottom();
  return { wrap, content };
}

function scrollBottom() {
  el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
}

/* ------------------------- 发送 ------------------------- */

async function send(preset) {
  if (busy) return;
  const text = (preset != null ? preset : el.userInput.value).trim();
  if (!text) return;

  showChat();
  if (preset == null) { el.userInput.value = ''; autoResize(); }
  addMessage('user', escapeHtml(text).replace(/\n/g, '<br>'));

  // 首次提问：如果 DB 还没就绪，先等它完成
  let waitWrap, waitContent;
  if (!isReady()) {
    ({ wrap: waitWrap, content: waitContent } = addMessage('assistant', ''));
    waitContent.innerHTML =
      '<div class="thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span> 数据库正在首次加载中…</div>' +
      '<div class="verify-note" id="waitHint">正在下载并解析 WASM（约 40MB，仅在首次访问时发生；下次打开将秒开）。</div>';
    waitHint = document.getElementById('waitHint');
    try {
      await ensureReady();
    } catch (e) {
      waitContent.innerHTML = renderMarkdown('> ⚠️ ' + e.message);
      return;
    } finally {
      waitHint = null;
    }
  }

  const cfg = loadConfig();
  const useLLM = hasLLM(cfg);
  const wantResearch = el.researchToggle && !el.researchToggle.disabled && el.researchToggle.checked;

  // 若之前有"等待加载"占位消息，就地切换到"正在查询"状态
  if (waitContent) {
    waitContent.innerHTML = '<span class="thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span> 正在查询知识本体…</span>';
    const { content } = { content: waitContent };
    doQuery(text, cfg, wantResearch, { waitWrap, content });
    return;
  }

  const { wrap, content } = addMessage('assistant', '');
  content.innerHTML = '<span class="thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span> 正在查询知识本体…</span>';
  await doQuery(text, cfg, wantResearch, { wrap, content });
}

/** 实际执行一次查询并渲染结果（等待加载 / 已就绪两条路径共用） */
async function doQuery(text, cfg, wantResearch, { wrap, content }) {
  busy = true;
  el.sendBtn.disabled = true;

  let acc = '';
  const onToken = (tok) => {
    if (!acc) content.innerHTML = '';
    acc += tok;
    content.textContent = acc;
    content.classList.add('typing');
    scrollBottom();
  };

  try {
    const res = await runAgent(text, { onToken, forceResearch: wantResearch });
    content.classList.remove('typing');

    if (acc) {
      content.innerHTML = renderMarkdown(acc);
    } else if (res.text) {
      content.innerHTML = renderMarkdown(res.text);
    } else {
      content.innerHTML = '<em>（无返回内容）</em>';
    }

    // 结构化图块
    if (res.blocks && res.blocks.length) {
      const blocksDiv = document.createElement('div');
      blocksDiv.innerHTML = renderBlocks(res.blocks);
      content.appendChild(blocksDiv);
    }

    // 工具调用痕迹
    if (res.trace && res.trace.length) {
      const traceDiv = document.createElement('div');
      traceDiv.innerHTML = renderTrace(res.trace);
      content.appendChild(traceDiv);
    }

    // 未命中意图的规则模式 → 提示如何启用大模型
    if (res.mode === 'rule' && res.matched === false) {
      const hint = document.createElement('div');
      hint.className = 'verify-note';
      hint.innerHTML = '<strong>提示：</strong>上面是本地规则引擎的能力说明。当前<strong>未配置大模型</strong>，只能用固定问法查询结构化数据；如需自然语言任意提问、多步推理与深度研究，请在左侧边栏底部 <strong>⚙️ 模型与 Key 设置</strong> 中填入兼容 OpenAI 的接口（Key 仅保存在你的浏览器本地）。';
      content.appendChild(hint);
    }
    if (res.mode === 'llm' && !hasLLM(loadConfig())) updateModeUI();
  } catch (e) {
    console.error(e);
    content.innerHTML = renderMarkdown('> ⚠️ 执行失败：' + e.message);
  } finally {
    busy = false;
    el.sendBtn.disabled = false;
    scrollBottom();
  }
}

/* ------------------------- 侧栏设置 ------------------------- */

function fillSettingsForm() {
  const cfg = loadConfig();
  el.baseUrl.value = cfg.baseUrl || '';
  el.apiKey.value = cfg.apiKey || '';
  el.modelName.value = cfg.model || '';
  el.tavilyKey.value = cfg.tavilyKey || '';
  applyEngineConfig(cfg);
  if (el.testResult) el.testResult.textContent = '';
  if (el.engineTestResult) el.engineTestResult.textContent = '';
}

function onPresetChange() {
  const id = el.providerPreset.value;
  const p = PROVIDER_PRESETS.find((x) => x.id === id);
  if (!p) return;
  if (p.baseUrl) el.baseUrl.value = p.baseUrl;
  if (p.model) el.modelName.value = p.model;
}

function onSaveSettings() {
  const baseUrl = normalizeBaseUrl(el.baseUrl.value);
  const engines = collectEngineConfig();
  const patch = {
    baseUrl,
    apiKey: el.apiKey.value.trim(),
    model: el.modelName.value.trim(),
    tavilyKey: el.tavilyKey.value.trim(),
    searchEngines: engines,
  };
  saveConfig(patch);
  updateModeUI();
  const mc = mixedContentWarning(patch.baseUrl);
  if (mc) {
    el.testResult.textContent = mc;
  } else if (!hasLLM(loadConfig())) {
    el.testResult.textContent = '⚠️ 已保存，但接口信息不完整（需地址、Key、模型名三者齐全），仍为本地规则引擎模式。';
  } else {
    const enabledNames = ENGINE_ORDER_UI.filter((id) => engines[id] && engines[id].enabled);
    const web = enabledNames.length
      ? `，深度研究启用引擎：${enabledNames.join(' → ')}`
      : '，未启用任何搜索引擎（深度研究不可用）';
    el.testResult.textContent = `✅ 已保存到浏览器本地，当前为大模型模式（${patch.model}）${web}。`;
  }
}

function onClearSettings() {
  clearConfig();
  el.baseUrl.value = DEFAULTS.baseUrl;
  el.apiKey.value = '';
  el.modelName.value = DEFAULTS.model;
  el.tavilyKey.value = '';
  applyEngineConfig(loadConfig());
  updateModeUI();
  if (el.testResult) el.testResult.textContent = '已清空本地配置。';
  if (el.engineTestResult) el.engineTestResult.textContent = '';
}

async function onTestConnection() {
  const baseUrl = normalizeBaseUrl(el.baseUrl.value);
  const apiKey = el.apiKey.value.trim();
  const model = el.modelName.value.trim();
  if (!baseUrl || !apiKey || !model) {
    el.testResult.textContent = '❌ 请先填写完整的接口地址、Key 与模型名。';
    return;
  }
  el.testResult.textContent = '⏳ 正在测试…';
  const mc = mixedContentWarning(baseUrl);
  if (mc) {
    el.testResult.textContent = '❌ ' + mc.replace(/^⚠️\s*/, '');
    return;
  }
  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      el.testResult.textContent = `❌ 接口返回 ${res.status}：${t.slice(0, 160)}`;
      return;
    }
    await res.json();
    el.testResult.textContent = '✅ 连接成功，模型可用。';
  } catch (e) {
    el.testResult.textContent = `❌ 连接失败：${e.message}（常见原因：① 服务商不允许浏览器跨域直连，建议改用 OpenRouter；② 地址写成了 http:// 而本页面是 HTTPS，会被拦截）`;
  }
}

/* ------------------------- 启动 ------------------------- */

boot();

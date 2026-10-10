/* ============================================================
   main.js —— 界面控制器
   串起：DuckDB-WASM 数据层 → 本体工具 → LangGraph 智能体 → 输出渲染
   ============================================================ */

import { initDB, getTableInfo, overview, isReady } from './db.js';
import { loadConfig, saveConfig, clearConfig, hasLLM, hasWebSearch, PROVIDER_PRESETS, DEFAULTS, normalizeBaseUrl } from './config.js';
import { runAgent, researchAvailable, HELP_TEXT } from './agent.js';
import { renderMarkdown, renderBlocks, renderTrace, escapeHtml } from './render.js';

/* ------------------------- 元素引用 ------------------------- */

const $ = (id) => document.getElementById(id);
const el = {
  dbStatus: $('dbStatus'),
  settingsBtn: $('settingsBtn'),
  welcomePanel: $('welcomePanel'),
  chatPanel: $('chatPanel'),
  chatMessages: $('chatMessages'),
  userInput: $('userInput'),
  sendBtn: $('sendBtn'),
  quickActions: $('quickActions'),
  modeBadge: $('modeBadge'),
  researchToggle: $('researchToggle'),
  researchHint: $('researchHint'),
  backHome: $('backHome'),
  settingsModal: $('settingsModal'),
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
  closeSettings: $('closeSettings'),
  testConnection: $('testConnection'),
  testResult: $('testResult'),
};

/* ------------------------- 内置图谱页 ------------------------- */

const VIZ_PAGES = [
  { title: '师承关系图谱', desc: '以师承关系为核心，按学派着色、可叠加合作边与关系类型标签', src: 'viz/%E5%B8%88%E6%89%BF%E5%85%B3%E7%B3%BB%E5%9B%BE%E8%B0%B1.html', height: 620 },
  { title: '师承关系拓扑图（含代表作）', desc: '在师承骨架上叠加论文层的传承关系，节点大小反映门下诺奖学生数', src: 'viz/%E5%B8%88%E6%89%BF%E5%85%B3%E7%B3%BB%E6%8B%93%E6%89%91%E5%9B%BE_%E5%90%AB%E4%BB%A3%E8%A1%A8%E4%BD%9C.html', height: 620 },
  { title: '论文层与合著网络', desc: '论文时间线、合著网络、期刊分布与「发表→获奖」时滞分析', src: 'viz/%E8%AE%BA%E6%96%87%E5%B1%82%E4%B8%8E%E5%90%88%E8%91%97%E7%BD%91%E7%BB%9C.html', height: 620 },
];

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

/* ------------------------- 状态栏 ------------------------- */

function setStatus(kind, text) {
  const dot = el.dbStatus.querySelector('.status-dot');
  const t = el.dbStatus.querySelector('.status-text');
  dot.className = 'status-dot ' + kind;
  t.textContent = text;
}

/* ------------------------- 启动 ------------------------- */

async function boot() {
  renderWelcomeExtras();
  bindEvents();
  updateModeUI();

  // 数据就绪前先禁用发送，避免访问者在初始化过程中提问
  el.sendBtn.disabled = true;
  el.sendBtn.title = '数据库初始化中…';

  try {
    await initDB((msg) => {
      setStatus('loading', msg);
      if (el.loadingText) el.loadingText.textContent = msg;
    });
    const info = getTableInfo();
    const ov = await overview().catch(() => null);
    setStatus('ok', ov ? `本体就绪 · ${ov.persons} 人 / ${ov.mentorships} 条师承` : `本体就绪 · ${info.length} 张表`);
    $('loadingOverlay').classList.add('hidden');
    fillWelcomeStats(ov, info);
    el.sendBtn.disabled = false;
    el.sendBtn.title = '发送';
  } catch (e) {
    console.error(e);
    setStatus('error', '数据库加载失败');
    $('loadingOverlay').classList.add('hidden');
    bannerError('数据库未能加载：' + e.message + '\n\n请确认通过 HTTP 方式访问（本地可用 `python3 -m http.server` 启动），并检查网络能否访问 CDN。');
  }
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
  // 图谱入口（页面已内置静态卡片，仅当为空时兜底生成）
  const vg = $('vizGrid');
  if (vg && !vg.children.length) {
    vg.innerHTML = VIZ_PAGES.map((v, i) => `
      <a class="viz-card" href="${escapeHtml(v.src)}" target="_blank" rel="noopener">
        <div class="viz-icon">${['🕸️', '🧬', '📈'][i] || '📊'}</div>
        <h4>${escapeHtml(v.title)}</h4>
        <p>${escapeHtml(v.desc)}</p>
        <span class="viz-open">打开图谱 ↗</span>
      </a>`).join('');
  }
  // 服务商预设
  const sel = el.providerPreset;
  if (sel) {
    sel.innerHTML = PROVIDER_PRESETS.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  }
}

/* ------------------------- 模式 UI ------------------------- */

function updateModeUI() {
  const cfg = loadConfig();
  const llm = hasLLM(cfg);
  const web = hasWebSearch(cfg);

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
    if (!llm) el.researchHint.textContent = '深度研究需先配置大模型；未配检索 Key 时自动使用维基百科 / Wikidata 兜底（零 Key）';
    else if (!web) el.researchHint.textContent = '未配置 Tavily，将使用维基百科 / Wikidata 零 Key 兜底（想更全面可配 Tavily）';
    else el.researchHint.textContent = '已就绪：Tavily 联网检索 + 维基补充，并结合本体分析';
  }
}

/* ------------------------- 事件绑定 ------------------------- */

function bindEvents() {
  el.settingsBtn.addEventListener('click', openSettings);
  el.closeSettings.addEventListener('click', closeSettings);
  el.settingsModal.querySelector('.modal-overlay').addEventListener('click', closeSettings);
  el.saveSettings.addEventListener('click', onSaveSettings);
  el.clearSettings.addEventListener('click', onClearSettings);
  el.testConnection.addEventListener('click', onTestConnection);
  el.providerPreset.addEventListener('change', onPresetChange);

  el.sendBtn.addEventListener('click', () => send());
  el.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  el.userInput.addEventListener('input', autoResize);
  el.backHome.addEventListener('click', showWelcome);

  // 欢迎页按钮
  document.querySelectorAll('[data-action="open-chat"]').forEach((b) => b.addEventListener('click', () => { showChat(); el.userInput.focus(); }));
  document.querySelectorAll('[data-action="open-settings"]').forEach((b) => b.addEventListener('click', openSettings));

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
  el.welcomePanel.classList.add('hidden');
  el.chatPanel.classList.remove('hidden');
}
function showWelcome() {
  el.chatPanel.classList.add('hidden');
  el.welcomePanel.classList.remove('hidden');
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
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

/* ------------------------- 发送 ------------------------- */

async function send(preset) {
  if (busy) return;
  if (!isReady()) {
    showChat();
    addMessage('assistant', renderMarkdown('数据库仍在初始化中，请稍候几秒再提问。'));
    return;
  }
  const text = (preset != null ? preset : el.userInput.value).trim();
  if (!text) return;

  showChat();
  if (preset == null) { el.userInput.value = ''; autoResize(); }
  addMessage('user', escapeHtml(text).replace(/\n/g, '<br>'));

  const cfg = loadConfig();
  const useLLM = hasLLM(cfg);
  const wantResearch = el.researchToggle && !el.researchToggle.disabled && el.researchToggle.checked;

  const { wrap, content } = addMessage('assistant', '');
  content.innerHTML = '<span class="thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span> 正在查询知识本体…</span>';

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
      hint.innerHTML = '<strong>提示：</strong>上面是本地规则引擎的能力说明。当前<strong>未配置大模型</strong>，只能用固定问法查询结构化数据；如需自然语言任意提问、多步推理与深度研究，请在右上角 <strong>⚙️ 设置</strong> 中填入兼容 OpenAI 的接口（Key 仅保存在你的浏览器本地）。';
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

/* ------------------------- 设置弹窗 ------------------------- */

function openSettings() {
  const cfg = loadConfig();
  el.baseUrl.value = cfg.baseUrl || '';
  el.apiKey.value = cfg.apiKey || '';
  el.modelName.value = cfg.model || '';
  el.tavilyKey.value = cfg.tavilyKey || '';
  if (el.testResult) el.testResult.textContent = '';
  el.settingsModal.classList.remove('hidden');
}

function closeSettings() {
  el.settingsModal.classList.add('hidden');
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
  const patch = {
    baseUrl,
    apiKey: el.apiKey.value.trim(),
    model: el.modelName.value.trim(),
    tavilyKey: el.tavilyKey.value.trim(),
  };
  saveConfig(patch);
  updateModeUI();
  closeSettings();
  if (!hasLLM(loadConfig())) {
    showChat();
    addMessage('assistant', renderMarkdown('已保存设置，但**模型接口信息不完整**（需要地址、Key、模型名三者齐全），当前仍为「本地规则引擎」模式。'));
  } else {
    showChat();
    const web = hasWebSearch(loadConfig()) ? '，深度研究（联网）已启用' : '';
    addMessage('assistant', renderMarkdown(`✅ 设置已保存在你的浏览器本地。当前为**大模型模式**（${patch.model}）${web}。\n\n现在可以用自然语言任意提问了。`));
  }
}

function onClearSettings() {
  clearConfig();
  el.baseUrl.value = DEFAULTS.baseUrl;
  el.apiKey.value = '';
  el.modelName.value = DEFAULTS.model;
  el.tavilyKey.value = '';
  updateModeUI();
  if (el.testResult) el.testResult.textContent = '已清空本地配置。';
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
    el.testResult.textContent = `❌ 连接失败：${e.message}（常见原因是该服务商不允许浏览器跨域直连，建议改用 OpenRouter）`;
  }
}

/* ------------------------- 启动 ------------------------- */

boot();

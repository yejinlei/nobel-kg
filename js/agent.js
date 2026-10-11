/* ============================================================
   agent.js —— 基于 LangGraph.js 的智能体编排
   一张状态图同时服务两种模式：
     · LLM 模式   ：大模型自主决定调用哪些本体查询工具，最后综合成文
     · 规则模式   ：未配置大模型时，由本地规则引擎选定工具并直接输出
   深度研究（联网检索）仅在访问者配置了检索 Key 时才会进入。
   ============================================================ */

import { StateGraph, Annotation, START, END } from '../lib/langgraph.bundle.js';
import { toolsForLLM, getTool, loadCore } from './tools.js';
import { runRoute, route, HELP_TEXT } from './router.js';
import { loadConfig, hasLLM, hasWebSearch, normalizeBaseUrl, mixedContentWarning } from './config.js';
import { webLookup } from './wiki.js';

const MAX_TOOL_ROUNDS = 4;


/* ------------------------- 系统提示词 ------------------------- */

const SYSTEM_PROMPT = `你是「诺奖师承知识本体」的查询助手。你的知识来自一个本地知识图谱（DuckDB 中存储的本体论数据），必须通过提供的工具获取事实，不得凭记忆编造。

【本体覆盖范围 · 必须先说清楚，避免误导用户】
1. 人物（persons）：约 1692 位，其中 765 位诺奖得主 + 927 位外部导师/学生（非诺奖）。
2. 覆盖的诺奖门类：物理学、化学、生理学或医学、经济学四类学术奖项（数据在 nobel_category 字段）。
3. ⚠️ 不覆盖：诺贝尔和平奖（Peace）、诺贝尔文学奖（Literature）、以及任何政治人物（如各国总统、总理、外交官）。请用户提问涉及这些对象时，**先明确告知"本本体不收录该类别"**，再说明能做什么（如切换到外部检索、或引导到本体已有的学术四奖范围），**不要在没有证据的情况下给出概率预测或编造背景**。
4. 年份范围：1901–2026；2027 年及以后属于未来预测，本体无数据。

本体结构（简要）：
- persons 人物：约 1692 位（765 位诺奖得主 + 927 位外部导师/学生），字段有姓名、生卒、国籍、诺奖年份与门类
- mentorship 师承：约 1082 条边，关系类型含 博士导师 / 博士后导师 / 研究导师 / 研究/博士导师（主要来源 DBpedia dbo:doctoralAdvisor）
- schools 学派：9 个（卡文迪许、慕尼黑、哥本哈根、哥廷根、罗马费米、LMB分子生物、居里、光遗传、哥大拉比）
- papers 论文：约 47 篇，含里程碑论文与 DOI；paper_lineage 记录论文间的思想传承
- features 人物特征：中介中心性、PageRank、学术深度、诺奖祖先/学生数、转化率、潜力分
- fields 研究方向：21 个三级学科树；works 代表性工作 47 项；paradigms 研究范式 8 个
- collaboration 合作关系；corrections 数据订正记录

工作方式：
1. 先用工具查询事实，再基于查询结果回答；
2. 涉及多步推理时（例如「谁的学生最有潜力」），可连续调用多个工具；
3. 回答用简体中文，结构清晰，善用小标题与列表；
4. 只陈述工具返回的事实，查不到就明确说明「本体中未收录」，不要脑补；
5. 若工具返回了表格或图表数据，用文字概括要点，不要在正文里手写 Markdown 大表格；
6. 【关于预测类问题】
   - 本体无未来数据，不要给出具体概率数字（如"80% 可能性"），除非通过外部检索拿到公开赔率等真实证据；
   - 若外部检索也全部失败，请坦诚说明"当前无可用外部证据支撑该预测"，而不是编造结论；
   - 可以主动分析"什么样的历史模式与本问题相关"（例如历史上和平奖授予过多少位在世政治人物、总统级获奖的历史分布等），但这些必须基于工具返回的事实，不要凭记忆。`;

/* ------------------------- 大模型客户端 ------------------------- */

function chatUrl() {
  const cfg = loadConfig();
  return normalizeBaseUrl(cfg.baseUrl) + '/chat/completions';
}

function authHeaders() {
  const cfg = loadConfig();
  const h = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) h.Authorization = 'Bearer ' + cfg.apiKey;
  if (/openrouter/i.test(cfg.baseUrl || '')) {
    h['HTTP-Referer'] = location.origin || 'https://github.com';
    h['X-Title'] = 'Nobel KG Ontology Agent';
  }
  return h;
}

/** 带超时的 fetch，避免网络异常时无限等待 */
async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 只保留合法角色的消息，过滤掉内部结构对象 */
function sanitizeMsgs(messages) {
  return (messages || [])
    .filter((m) => m && typeof m.role === 'string' && m.role)
    .map((m) => {
      const o = { role: m.role, content: m.content == null ? '' : String(m.content) };
      if (m.role === 'tool') {
        if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
        if (m.name) o.name = m.name;
      } else if (m.tool_calls) {
        o.tool_calls = m.tool_calls;
      }
      return o;
    });
}

/** 非流式对话（用于工具调用轮） */
async function chatComplete(messages, withTools) {
  const cfg = loadConfig();
  const body = {
    model: cfg.model,
    messages: sanitizeMsgs(messages),
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.2,
    stream: false,
  };
  if (withTools) {
    body.tools = toolsForLLM();
    body.tool_choice = 'auto';
  }
  let res;
  try {
    res = await fetchWithTimeout(chatUrl(), { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }, 60000);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('无法连接模型接口（请求超时 60 秒）。');
    const mc = mixedContentWarning(loadConfig().baseUrl);
    if (mc) throw new Error(mc);
    throw new Error(`无法连接模型接口：${e.message}。常见原因：① 服务商不允许浏览器跨域直连（建议改用 OpenRouter）；② 地址/端口不通。`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`模型接口返回 ${res.status}：${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) throw new Error('模型接口返回格式异常，未包含 choices[0].message');
  return msg;
}

/** 流式对话（用于最终成文） */
async function chatStream(messages, onToken) {
  const cfg = loadConfig();
  const body = {
    model: cfg.model,
    messages: sanitizeMsgs(messages),
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.2,
    stream: true,
  };
  let res;
  try {
    res = await fetchWithTimeout(chatUrl(), { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }, 180000);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('无法连接模型接口（请求超时 180 秒）。');
    const mc = mixedContentWarning(loadConfig().baseUrl);
    if (mc) throw new Error(mc);
    throw new Error(`无法连接模型接口：${e.message}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`模型接口返回 ${res.status}：${txt.slice(0, 300)}`);
  }
  if (!res.body) { // 不支持流式，退回一次性
    const data = await res.json();
    const txt2 = data.choices?.[0]?.message?.content || '';
    if (onToken) onToken(txt2);
    return txt2;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) { full += delta; if (onToken) onToken(delta); }
      } catch (_) { /* 忽略不完整分片 */ }
    }
  }
  return full;
}

/* ------------------------- 联网检索（深度研究，可选） ------------------------- */
// 具体实现见 wiki.js：webLookup(query, { tavilyKey })
// - 有 Tavily Key 时走 Tavily；无 Key 时自动退到维基百科零 Key 兜底。
// 这样「未配置任何检索 Key」也能有外部事实，而不是完全没有联网能力。
// 触发条件：问题含 "深度研究/前沿/综述" 等关键词，且用户打开了 deepresearch 开关。

function needsResearch(text) {
  return /(深度研究|深度调研|deep\s?research|前沿|综述|调研报告|研究报告|最新进展|文献综述|领域趋势)/i.test(String(text || ''));
}

/* ------------------------- 状态定义 ------------------------- */

const AgentState = Annotation.Root({
  question: Annotation({ default: () => '' }),
  mode: Annotation({ default: () => 'rule' }),
  msgs: Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  trace: Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  blocks: Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  routeKey: Annotation({ default: () => 'compose' }),
  nextAction: Annotation({ default: () => 'compose' }),
  researchNotes: Annotation({ default: () => '' }),
  forceResearch: Annotation({ default: () => false }),
  finalText: Annotation({ default: () => '' }),
  iterations: Annotation({ reducer: (a, b) => a + b, default: () => 0 }),
  error: Annotation({ default: () => '' }),
});

/* ------------------------- 节点实现 ------------------------- */

async function nodePlan(state, config) {
  const onToken = config?.configurable?.onToken;

  // 规则模式：本地路由
  if (state.mode === 'rule') {
    const r = await route(state.question);
    if (!r) {
      return {
        nextAction: 'compose',
        routeKey: 'compose',
        trace: [{ tool: '规则引擎', label: '未匹配到查询意图' }],
        finalText: '',
      };
    }
    return {
      nextAction: 'act',
      routeKey: 'act',
      trace: [{ tool: '规则引擎', label: r.reason || r.tool }],
      msgs: [{ type: 'planned_call', name: r.tool, args: r.args }],
    };
  }

  // LLM 模式
  if (state.iterations >= MAX_TOOL_ROUNDS) {
    return { nextAction: 'compose', routeKey: 'compose' };
  }
  const msg = await chatComplete(state.msgs, true);
  const calls = msg.tool_calls || [];
  const assistantMsg = { role: 'assistant', content: msg.content || '' };
  if (calls.length) assistantMsg.tool_calls = calls;

  if (calls.length) {
    return {
      nextAction: 'act',
      routeKey: 'act',
      msgs: [assistantMsg],
      trace: calls.map((c) => ({ tool: c.function?.name || '工具', label: c.function?.arguments || '' })),
    };
  }
  // 模型直接给出答案，且当前尚未出现研究需求判断
  const wantResearch = Boolean(state.forceResearch) || needsResearch(state.question);
  if (wantResearch && hasWebSearch() && !state.researchNotes) {
    return { nextAction: 'research', routeKey: 'research', msgs: [assistantMsg] };
  }
  return { nextAction: 'compose', routeKey: 'compose', msgs: [assistantMsg], finalText: msg.content || '' };
}

async function nodeAct(state) {
  const last = state.msgs[state.msgs.length - 1];
  const blocks = [];
  const newMsgs = [];

  // 规则模式：planned_call
  if (last && last.type === 'planned_call') {
    const tool = getTool(last.name);
    if (!tool) return { routeKey: 'compose', nextAction: 'compose' };
    const out = await tool.run(last.args || {});
    if (out.blocks && out.blocks.length) blocks.push(...out.blocks);
    return {
      routeKey: 'compose',
      nextAction: 'compose',
      iterations: 1,
      blocks,
      msgs: [{ type: 'tool_result', name: last.name, display: out.text, payload: out.payload, viz: out.viz }],
      finalText: out.text || '',
    };
  }

  // LLM 模式：顺序执行全部 tool_calls
  const calls = (last && last.tool_calls) || [];
  for (const c of calls) {
    const name = c.function && c.function.name;
    let args = {};
    try { args = JSON.parse((c.function && c.function.arguments) || '{}'); } catch (_) {}
    const tool = getTool(name);
    let out;
    if (!tool) {
      out = { text: `未知工具 ${name}`, payload: { error: 'unknown_tool' } };
    } else {
      try {
        out = await tool.run(args);
      } catch (e) {
        out = { text: `工具 ${name} 执行失败：${e.message}`, payload: { error: e.message } };
      }
    }
    if (out.blocks && out.blocks.length) blocks.push(...out.blocks);
    newMsgs.push({
      role: 'tool',
      tool_call_id: c.id,
      name,
      content: JSON.stringify(out.payload != null ? out.payload : { text: out.text }).slice(0, 8000),
    });
    newMsgs.push({ type: 'tool_result', name, display: out.text, payload: out.payload });
  }

  return { routeKey: 'plan', nextAction: 'plan', iterations: 1, blocks, msgs: newMsgs };
}

async function nodeResearch(state) {
  const cfg = loadConfig();
  // 深度研究属于「需配置」的能力：未配置检索 Key 时，代码层不启用该路径
  if (!hasWebSearch(cfg)) {
    return { routeKey: 'compose', nextAction: 'compose' };
  }
  // 分层联网：按启用顺序尝试（Tavily → Mojeek → SearxNG → Bing → 维基 → DuckDuckGo），
  // 每个引擎独立超时，失败静默跳过，取首个有内容结果
  let notes = '';
  let src = '';
  try {
    const r = await webLookup(state.question, {
      tavilyKey: cfg.tavilyKey,
      searchEngines: cfg.searchEngines || {},
    });
    src = r.source;
    notes = `【联网检索结果（来源：${src}）】\n${r.text}`;
  } catch (e) {
    notes = `【联网检索失败】${e.message}`;
  }
  return {
    routeKey: 'compose',
    nextAction: 'compose',
    researchNotes: notes,
    msgs: [{ role: 'user', content: notes }],
  };
}

async function nodeCompose(state, config) {
  const onToken = config?.configurable?.onToken;
  const toolResults = state.msgs.filter((m) => m && m.type === 'tool_result');

  // 规则模式：直接使用工具自身的渲染结果
  if (state.mode === 'rule') {
    if (!toolResults.length) return { finalText: HELP_TEXT };
    const text = toolResults.map((m) => m.display).filter(Boolean).join('\n\n');
    return { finalText: text || HELP_TEXT };
  }

  // LLM 模式：若模型已直接给出答案且没有工具结果、没有联网材料，直接用，避免重复调用
  if (state.finalText && !toolResults.length && !state.researchNotes) {
    return { finalText: state.finalText };
  }

  // 组装发给模型的消息（只保留带 role 的真实对话消息）
  const msgs = state.msgs.filter((m) => m && m.role);
  if (!msgs.length || msgs[0].role !== 'system') msgs.unshift({ role: 'system', content: SYSTEM_PROMPT });
  if (state.researchNotes) {
    msgs.push({ role: 'system', content: '下面是联网检索获得的补充材料，请结合本体查询结果一起分析，并明确标注哪些内容来自外部检索：\n' + state.researchNotes });
  }

  let text = '';
  try {
    text = await chatStream(msgs, onToken);
  } catch (e) {
    return { finalText: state.finalText || `生成回答时出错：${e.message}`, error: e.message };
  }
  if (!text.trim()) text = '（模型未返回内容）';
  return { finalText: text };
}

/* ------------------------- 构建状态图 ------------------------- */

let GRAPH = null;

function buildGraph() {
  return new StateGraph(AgentState)
    .addNode('plan', nodePlan)
    .addNode('act', nodeAct)
    .addNode('research', nodeResearch)
    .addNode('compose', nodeCompose)
    .addEdge(START, 'plan')
    .addConditionalEdges('plan', (s) => s.routeKey, { act: 'act', research: 'research', compose: 'compose' })
    .addConditionalEdges('act', (s) => s.routeKey, { plan: 'plan', compose: 'compose' })
    .addEdge('research', 'compose')
    .addEdge('compose', END)
    .compile();
}

function getGraph() {
  if (!GRAPH) GRAPH = buildGraph();
  return GRAPH;
}

/* ------------------------- 对外接口 ------------------------- */

/**
 * 运行一次问答
 * @param {string} question 自然语言问题
 * @param {{onToken?:Function, onStep?:Function, forceResearch?:boolean}} hooks
 */
export async function runAgent(question, hooks = {}) {
  const cfg = loadConfig();
  const useLLM = hasLLM(cfg);
  await loadCore();

  const mode = useLLM ? 'llm' : 'rule';
  const msgs = useLLM ? [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: question }] : [];

  const init = {
    question,
    mode,
    msgs,
    trace: [],
    blocks: [],
    routeKey: 'plan',
    nextAction: 'plan',
    iterations: 0,
    researchNotes: '',
    forceResearch: Boolean(hooks.forceResearch),
    finalText: '',
    error: '',
  };

  let result;
  try {
    result = await getGraph().invoke(init, { configurable: { onToken: hooks.onToken }, recursionLimit: 40 });
  } catch (e) {
    // 大模型调用失败时，自动降级到规则引擎
    if (useLLM) {
      const fb = await runRoute(question);
      if (fb) {
        return {
          mode: 'rule-fallback',
          text: `> ⚠️ 大模型调用失败（${e.message}），已自动降级为本地规则引擎。\n\n` + (fb.result.text || ''),
          blocks: fb.result.blocks || [],
          trace: [{ tool: '规则引擎（降级）', label: fb.route.reason || fb.route.tool }],
          matched: true,
        };
      }
      return { mode: 'error', text: `调用大模型失败：${e.message}`, blocks: [], trace: [] };
    }
    return { mode: 'error', text: `执行出错：${e.message}`, blocks: [], trace: [] };
  }

  const steps = result.trace || [];
  steps.forEach((s) => { if (hooks.onStep) hooks.onStep(s); });
  const matched = (result.msgs || []).some((m) => m && m.type === 'tool_result');

  return {
    mode: result.mode,
    text: result.finalText || '',
    blocks: result.blocks || [],
    trace: steps,
    matched,
    usedResearch: Boolean(result.researchNotes),
  };
}

/** 是否具备深度研究能力 */
export function researchAvailable() {
  return hasWebSearch();
}

export { HELP_TEXT };

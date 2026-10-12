/* ============================================================
   wiki.js —— 分层联网检索
   引擎启用顺序（默认配置下）：
     1. Tavily    （配 Key 时；官方支持 CORS，国内可用）
     2. Mojeek    （CORS 头为 *，可能返回 403）
     3. SearxNG   （用户自建实例；公共实例国内不可达）
     4. Bing      （cn.bing.com，无 CORS 头，浏览器 fetch 大概率失败）
     5. Wiki      （中英文维基 + Wikidata，跨域最稳定，结构化）
     6. DuckDuckGo（html.duckduckgo.com，国内可能被墙）
   每个引擎独立超时（可通过 UI 调整），失败静默跳过，取首个有内容结果。
   所有结果统一为 {source, text}，喂给 Agent 加工后再展示。
   ============================================================ */

const WIKI_API = 'https://zh.wikipedia.org/w/api.php';
const WIKI_API_EN = 'https://en.wikipedia.org/w/api.php';
const WD_ENDPOINT = 'https://www.wikidata.org/sparql';

/** 引擎顺序：从最可能成功到最可能失败，每个独立超时 */
const ENGINE_ORDER = ['tavily', 'mojeek', 'searxng', 'bing', 'wiki', 'ddg'];

/**
 * 通用 fetch：加超时
 */
async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/* ============================================================
   引擎 1：Tavily（需 Key）
   ============================================================ */
async function engineTavily(query, opts) {
  const { tavilyKey, timeout, baseUrl } = opts;
  if (!tavilyKey) return null;
  const url = baseUrl || 'https://api.tavily.com/search';
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: tavilyKey,
      query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: true,
    }),
  }, timeout);
  if (!r.ok) return null;
  const j = await r.json();
  const items = (j.results || []).slice(0, 5).map((x, i) =>
    `[${i + 1}] ${x.title} — ${x.url}\n    ${(x.content || '').slice(0, 400)}`);
  if (!items.length && !j.answer) return null;
  return {
    source: 'Tavily',
    text: (j.answer ? `摘要：${j.answer}\n\n` : '') + items.join('\n\n'),
  };
}

/* ============================================================
   引擎 2：Mojeek（CORS *，可能被 403 拒绝）
   ============================================================ */
async function engineMojeek(query, opts) {
  const { timeout, baseUrl } = opts;
  const base = baseUrl || 'https://www.mojeek.com/search';
  const url = `${base}?q=${encodeURIComponent(query)}`;
  const r = await fetchWithTimeout(url, {
    headers: { 'Accept': 'text/html' },
  }, timeout);
  if (!r.ok) return null;
  const html = await r.text();
  const items = parseMojeek(html, 5);
  if (!items.length) return null;
  return {
    source: 'Mojeek',
    text: items.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n    ${x.snippet}`).join('\n\n'),
  };
}

function parseMojeek(html, max) {
  const items = [];
  // 结果卡片：<li class="result"> > <h2 class="title"><a href="...">title</a></h2> <p class="s">snippet</p>
  const re = /<li[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*class="[^"]*s[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html)) && items.length < max) {
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title) items.push({ title, url: m[1], snippet: snippet.slice(0, 400) });
  }
  return items;
}

/* ============================================================
   引擎 3：SearxNG（用户自建实例；公共实例国内不可达）
   ============================================================ */
async function engineSearxNG(query, opts) {
  const { timeout, baseUrl } = opts;
  if (!baseUrl) return null;
  const url = `${baseUrl.replace(/\/+$/, '')}/search?q=${encodeURIComponent(query)}&format=json`;
  const r = await fetchWithTimeout(url, {
    headers: { 'Accept': 'application/json' },
  }, timeout);
  if (!r.ok) return null;
  const j = await r.json();
  const items = (j.results || []).slice(0, 5).map((x, i) =>
    `[${i + 1}] ${x.title} — ${x.url}\n    ${(x.content || '').slice(0, 400)}`);
  if (!items.length) return null;
  return {
    source: 'SearxNG',
    text: items.join('\n\n'),
  };
}

/* ============================================================
   引擎 4：Bing HTML（cn.bing.com；无 CORS，浏览器 fetch 大概率失败）
   ============================================================ */
async function engineBing(query, opts) {
  const { timeout, baseUrl } = opts;
  const base = baseUrl || 'https://cn.bing.com/search';
  const url = `${base.replace(/\/+$/, '')}?q=${encodeURIComponent(query)}&ensearch=0`;
  const r = await fetchWithTimeout(url, {
    headers: { 'Accept': 'text/html' },
  }, timeout);
  if (!r.ok) return null;
  const html = await r.text();
  const items = parseBing(html, 5);
  if (!items.length) return null;
  return {
    source: 'Bing',
    text: items.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n    ${x.snippet}`).join('\n\n'),
  };
}

function parseBing(html, max) {
  const items = [];
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html)) && items.length < max) {
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title) items.push({ title, url: m[1], snippet: snippet.slice(0, 400) });
  }
  return items;
}

/* ============================================================
   引擎 5：Wikipedia + Wikidata（跨域友好，结构化）
   ============================================================ */
export async function wikiSearch(query, opts = {}) {
  const { lang = 'both', exsentences = 5, timeout = 6000 } = opts;
  const langs = lang === 'both' ? ['zh', 'en'] : [lang];
  const results = [];
  for (const l of langs) {
    const api = l === 'zh' ? WIKI_API : WIKI_API_EN;
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'search',
      srsearch: query,
      srlimit: '3',
      origin: '*',
    });
    let list;
    try {
      const r = await fetchWithTimeout(`${api}?${params.toString()}`, { headers: { 'Accept': 'application/json' } }, timeout);
      if (!r.ok) continue;
      const j = await r.json();
      list = (j.query && j.query.search) || [];
    } catch (_) { continue; }
    if (!list.length) continue;
    const title = list[0].title;
    const params2 = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'extracts|info',
      exintro: '1',
      explaintext: '1',
      exsentences: String(exsentences),
      inprop: 'url',
      titles: title,
      origin: '*',
    });
    try {
      const r2 = await fetchWithTimeout(`${api}?${params2.toString()}`, { headers: { 'Accept': 'application/json' } }, timeout);
      if (!r2.ok) continue;
      const j2 = await r2.json();
      const pages = (j2.query && j2.query.pages) || {};
      const page = Object.values(pages)[0];
      if (page && page.extract) {
        results.push({
          title: page.title,
          extract: page.extract.slice(0, 1200),
          url: page.fullurl || page.canonicalurl || `https://${l}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
          lang: l,
        });
      }
    } catch (_) { /* ignore */ }
  }
  return results;
}

export async function wdNobelFacts(personLabel) {
  const qid = await findQID(personLabel);
  if (!qid) return null;
  const focusedQuery = `
    SELECT DISTINCT ?prop ?propLabel ?valLabel WHERE {
      { wd:${qid} wdt:P69 ?edu. BIND("educated_at" AS ?prop) ?edu rdfs:label ?valLabel. FILTER(LANG(?valLabel) IN ("zh","en")) } UNION
      { wd:${qid} wdt:P1066 ?stu. BIND("student_of" AS ?prop) ?stu rdfs:label ?valLabel. FILTER(LANG(?valLabel) IN ("zh","en")) } UNION
      { wd:${qid} wdt:P184 ?doc. BIND("doctoral_advisor" AS ?prop) ?doc rdfs:label ?valLabel. FILTER(LANG(?valLabel) IN ("zh","en")) } UNION
      { wd:${qid} wdt:P802 ?stu. BIND("notable_student" AS ?prop) ?stu rdfs:label ?valLabel. FILTER(LANG(?valLabel) IN ("zh","en")) } UNION
      { wd:${qid} wdt:P166 ?award. BIND("award" AS ?prop) ?award rdfs:label ?valLabel. FILTER(LANG(?valLabel) IN ("zh","en")) } UNION
      { wd:${qid} wdt:P101 ?field. BIND("research_field" AS ?prop) ?field rdfs:label ?valLabel. FILTER(LANG(?valLabel) IN ("zh","en")) }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,en". }
    } LIMIT 30
  `;
  try {
    const r = await fetchWithTimeout(WD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
      },
      body: focusedQuery,
    }, 6000);
    if (!r.ok) return null;
    const j = await r.json();
    const binds = (j.results && j.results.bindings) || [];
    const out = { qid, facts: [] };
    for (const b of binds) {
      out.facts.push({
        property: b.prop && b.prop.value,
        propertyLabel: b.propLabel && b.propLabel.value,
        valueLabel: b.valLabel && b.valLabel.value,
      });
    }
    return out;
  } catch (_) { return null; }
}

async function findQID(label) {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: label,
    language: 'zh',
    limit: '3',
    format: 'json',
    origin: '*',
  });
  try {
    const r = await fetchWithTimeout(`https://www.wikidata.org/w/api.php?${params.toString()}`,
      { headers: { 'Accept': 'application/json' } }, 6000);
    if (!r.ok) return null;
    const j = await r.json();
    const list = (j.search || []).filter((s) => /nobel|诺奖|physicist|chemist|biologist|scientist/i.test(s.description || ''));
    const best = list[0] || (j.search || [])[0];
    return best ? best.id : null;
  } catch (_) { return null; }
}

async function engineWiki(query, opts) {
  const { timeout } = opts;
  const zh = await wikiSearch(query, { lang: 'zh', exsentences: 4, timeout });
  const en = await wikiSearch(query, { lang: 'en', exsentences: 4, timeout });
  const all = [...zh, ...en];
  if (!all.length) return null;
  const text = all.map((r, i) => `[${i + 1}] ${r.title}（${r.lang === 'zh' ? '中文维基' : '英文维基'}）— ${r.url}\n    ${r.extract}`).join('\n\n');
  return { source: 'Wikipedia/Wikidata', text };
}

/* ============================================================
   引擎 6：DuckDuckGo HTML（国内可能被墙）
   ============================================================ */
async function engineDuckDuckGo(query, opts) {
  const { timeout, baseUrl } = opts;
  const base = baseUrl || 'https://html.duckduckgo.com/html/';
  const url = `${base.replace(/\/+$/, '')}?q=${encodeURIComponent(query)}`;
  const r = await fetchWithTimeout(url, {
    headers: { 'Accept': 'text/html' },
  }, timeout);
  if (!r.ok) return null;
  const html = await r.text();
  const items = parseDDG(html, 5);
  if (!items.length) return null;
  return {
    source: 'DuckDuckGo',
    text: items.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n    ${x.snippet}`).join('\n\n'),
  };
}

function parseDDG(html, max) {
  const items = [];
  const re = /<div[^>]*class="[^"]*result__body[^"]*"[\s\S]*?<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && items.length < max) {
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title) items.push({ title, url: decodeDDGUrl(m[1]), snippet: snippet.slice(0, 400) });
  }
  return items;
}

function decodeDDGUrl(u) {
  if (u.includes('uddg=')) {
    try {
      const q = new URL(u.startsWith('//') ? 'https:' + u : u);
      const target = q.searchParams.get('uddg');
      if (target) return decodeURIComponent(target);
    } catch (_) { /* ignore */ }
  }
  return u;
}

function stripTags(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ============================================================
   主入口：webLookup
   按启用顺序遍历引擎，取首个成功结果。
   opts: { tavilyKey, searchEngines }
   ============================================================ */
const ENGINE_IMPL = {
  tavily: engineTavily,
  mojeek: engineMojeek,
  searxng: engineSearxNG,
  bing:   engineBing,
  wiki:   engineWiki,
  ddg:    engineDuckDuckGo,
};

const ENGINE_LABEL = {
  tavily: 'Tavily',
  mojeek: 'Mojeek',
  searxng: 'SearxNG',
  bing: 'Bing',
  wiki: 'Wikipedia/Wikidata',
  ddg: 'DuckDuckGo',
};

/**
 * 分层联网：按启用顺序尝试，返回首个成功结果。
 * 各引擎独立超时，失败静默跳过；全部失败时返回 none。
 */
export async function webLookup(query, opts = {}) {
  const cfg = opts.searchEngines || {};
  const tavilyKey = opts.tavilyKey || '';
  const attempted = [];
  const failed = [];

  for (const name of ENGINE_ORDER) {
    const c = cfg[name];
    if (!c || !c.enabled) continue;
    const timeout = c.timeout || 6000;
    const impl = ENGINE_IMPL[name];
    if (!impl) continue;
    try {
      const res = await impl(query, { tavilyKey, timeout, baseUrl: c.baseUrl });
      if (res && res.text) return res;
    } catch (e) {
      const reason = (e && e.name === 'AbortError') ? '超时' : (e && e.message) || '失败';
      failed.push(`${ENGINE_LABEL[name]}：${reason}`);
    }
    attempted.push(ENGINE_LABEL[name]);
  }

  if (attempted.length === 0) {
    return {
      source: 'none',
      text: '（未启用任何联网检索引擎。请到「设置 → 搜索引擎」启用至少一个；'
        + '国内环境下推荐配置 Tavily Key 或自建 SearxNG；'
        + 'Bing/DuckDuckGo/Mojeek 等无 CORS 引擎在浏览器端大概率失败）',
    };
  }

  const hint = failed.length
    ? '；各引擎失败原因：' + failed.join('；')
    : '（引擎正常返回但无匹配结果，可能是查询过于宽泛或过于未来向）';
  const advice = '\n建议：'
    + '① 若需要真实外部数据，请配置 Tavily Key（国内环境最稳的引擎）；'
    + '② 或改问本体已有范围的问题（物理学/化学/生理医学/经济学 四类学术奖 1901–2026 年）。';

  return {
    source: 'none',
    text: `（已尝试 ${attempted.join(' → ')}，均未返回结果${hint}${advice}）`,
  };
}

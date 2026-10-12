/* ============================================================
   wiki.js —— 分层联网检索
   引擎启用顺序：
     1. Tavily    （默认开；官方支持 CORS，国内可用）
     2. Wikipedia （默认关；国内网络下 zh/en.wikipedia.org DNS 重定向到
                   不可达 IPv6，实测 10s 超时。仅在用户手动启用且网络可达时生效）
   其他常见引擎（Bing / Baidu / DDG / Mojeek / SearxNG）已删除——
   浏览器端 CORS 结构性不通。
   ============================================================ */

const WIKI_API = 'https://zh.wikipedia.org/w/api.php';
const WIKI_API_EN = 'https://en.wikipedia.org/w/api.php';
const WD_ENDPOINT = 'https://www.wikidata.org/sparql';

/** 引擎顺序：Tavily 优先（配 Key 时最稳），其次 Wikipedia */
const ENGINE_ORDER = ['tavily', 'wiki'];

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

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/* ============================================================
   引擎 1：Tavily（需 Key）
   端点硬编码，忽略 localStorage 里可能残留的错误 baseUrl（历史 UI 版本曾允许用户填，
   常见错误是填成官网 https://tavily.com 而不是 https://api.tavily.com/search，会导致 401）。
   ============================================================ */
async function engineTavily(query, opts) {
  const { tavilyKey, timeout } = opts;
  if (!tavilyKey) return null;
  const r = await fetchWithTimeout(TAVILY_ENDPOINT, {
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
   引擎 2：Wikipedia + Wikidata（跨域友好，结构化）
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
   主入口：webLookup
   按启用顺序遍历引擎，取首个成功结果。
   opts: { tavilyKey, searchEngines }
   ============================================================ */
const ENGINE_IMPL = {
  tavily: engineTavily,
  wiki:   engineWiki,
};

const ENGINE_LABEL = {
  tavily: 'Tavily',
  wiki: 'Wikipedia/Wikidata',
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
      const res = await impl(query, { tavilyKey, timeout });
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
      text: '（未启用任何联网检索引擎。请到「设置 → 搜索引擎」配置 Tavily Key；'
        + 'Tavily 是目前唯一在国内网络环境下浏览器可直连的搜索引擎）',
    };
  }

  const hint = failed.length
    ? '；各引擎失败原因：' + failed.join('；')
    : '（引擎正常返回但无匹配结果，可能是查询过于宽泛或过于未来向）';
  const advice = '\n建议：'
    + '① 检查 Tavily Key 是否有效（可到 https://app.tavily.com 确认免费额度）；'
    + '② 或改问本体已有范围的问题（物理学/化学/生理医学/经济学 四类学术奖 1901–2026 年）。';

  return {
    source: 'none',
    text: `（已尝试 ${attempted.join(' → ')}，均未返回结果${hint}${advice}）`,
  };
}

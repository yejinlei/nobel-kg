/* ============================================================
   wiki.js —— Wikipedia / Wikidata 零配置联网检索兜底
   无需任何 Key，利用 MediaWiki API 与 SPARQL 端点的
   跨域特性（origin=*），在纯静态页上可直接调用。
   当访问者配置了 Tavily Key 时它作为补充源；
   当未配置任何检索 Key 时，它是唯一可工作的联网能力。
   ============================================================ */

const WIKI_API = 'https://zh.wikipedia.org/w/api.php';
const WIKI_API_EN = 'https://en.wikipedia.org/w/api.php';
const WD_ENDPOINT = 'https://www.wikidata.org/sparql';

/**
 * 中文+英文双语检索维基百科摘要
 * @param {string} query 检索关键词
 * @param {object} opts { lang: 'zh'|'en'|'both', exsentences: 3 }
 * @returns {{title, extract, url, lang}[]}
 */
export async function wikiSearch(query, opts = {}) {
  const { lang = 'both', exsentences = 5 } = opts;
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
      const r = await fetch(`${api}?${params.toString()}`);
      if (!r.ok) continue;
      const j = await r.json();
      list = (j.query && j.query.search) || [];
    } catch (_) { continue; }
    if (!list.length) continue;
    // 取最相关一条取摘要
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
      const r2 = await fetch(`${api}?${params2.toString()}`);
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

/**
 * Wikidata SPARQL 查询诺奖得主附加事实（零 Key）
 * 返回结构化结果，方便 Agent 引用。
 */
export async function wdNobelFacts(personLabel) {
  // 用 Q 值缓存，避免反复查
  const qid = await findQID(personLabel);
  if (!qid) return null;
  const sparql = `
    SELECT ?propertyLabel ?valueLabel WHERE {
      wd:${qid} ?p ?statement .
      ?statement ?ps ?value .
      ?property wikibase:claim ?p ;
                wikibase:statementProperty ?ps .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "zh,en". }
    } LIMIT 20
  `;
  // 这里只取几个对诺奖师承有用的字段
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
    const r = await fetch(WD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
      body: focusedQuery,
    });
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
    const r = await fetch(`https://www.wikidata.org/w/api.php?${params.toString()}`);
    if (!r.ok) return null;
    const j = await r.json();
    const list = (j.search || []).filter((s) => /nobel|诺奖|physicist|chemist|biologist|scientist/i.test(s.description || ''));
    const best = list[0] || (j.search || [])[0];
    return best ? best.id : null;
  } catch (_) { return null; }
}

/**
 * 综合联网：优先 Tavily（如果配了），否则退到维基。
 * 调用方无需关心底层服务。
 * @param {string} query
 * @param {{tavilyKey?:string}} opts
 */
export async function webLookup(query, opts = {}) {
  if (opts.tavilyKey) {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: opts.tavilyKey,
          query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: true,
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const items = (j.results || []).slice(0, 5).map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n    ${(x.content || '').slice(0, 400)}`);
        return { source: 'Tavily', text: (j.answer ? `摘要：${j.answer}\n\n` : '') + items.join('\n\n') };
      }
    } catch (_) { /* fallthrough */ }
  }
  // 维基兜底（无需 Key）
  const zh = await wikiSearch(query, { lang: 'zh', exsentences: 4 });
  const en = await wikiSearch(query, { lang: 'en', exsentences: 4 });
  const all = [...zh, ...en];
  if (!all.length) return { source: 'none', text: '（未检索到相关资料）' };
  const text = all.map((r, i) => `[${i + 1}] ${r.title}（${r.lang === 'zh' ? '中文维基' : '英文维基'}）— ${r.url}\n    ${r.extract}`).join('\n\n');
  return { source: 'Wikipedia/Wikidata（零 Key 兜底）', text };
}

/* ============================================================
   router.js —— 本地规则引擎
   在没有配置大模型时，用关键词 + 实体识别把自然语言问题
   路由到白名单查询工具，保证「不配置 Key 也能用」。
   ============================================================ */

import { query } from './db.js';
import { loadCore, normKey, getTool, nameOf } from './tools.js';

let SCHOOLS = null;
let FIELDS = null;

async function loadVocabulary() {
  if (SCHOOLS) return;
  const s = await query('SELECT school_id, name_cn, name_en FROM schools');
  SCHOOLS = s.rows;
  const f = await query('SELECT field_id, name_zh, name_en FROM fields');
  FIELDS = f.rows;
}

/** 从问题中识别人名（长名优先，避免「玻尔」抢占「奥格·玻尔」） */
export async function extractPersons(text) {
  await loadCore();
  const n = normKey(text);
  if (!n) return [];
  const hits = [];
  // 收集所有可匹配名称
  const cands = [];
  const pr = await query('SELECT person_id, name_zh, name_en FROM persons');
  for (const r of pr.rows) {
    cands.push([normKey(r.name_zh), r.person_id]);
    cands.push([normKey(r.name_en), r.person_id]);
  }
  // 常用简称
  const shortNames = {
    玻尔: 'P001', 汤姆孙: 'P037', 布拉格: 'P011', 居里: 'P040', 爱因斯坦: 'P056',
    费米: 'P036', 索末菲: 'P032', 玻恩: 'P033', 海森堡: 'P002', 泡利: 'P003',
    杨振宁: 'P009', 李政道: 'P010', 卢瑟福: 'P013', 泰勒: 'P035', 戴塞罗思: 'P021',
    黑格曼: 'P022', 纳格尔: 'P023', 卡甘: 'P024', 硖合宪三: 'P025', 钱永佑: 'P028',
    克里克: 'P015', 沃森: 'P014', 佩鲁茨: 'P016', 查德威克: 'P046', 狄拉克: 'P006',
    拉比: 'P049', 鲍林: 'P050', 奥格玻尔: 'P018',
  };
  for (const [k, v] of Object.entries(shortNames)) cands.push([normKey(k), v]);

  cands.sort((a, b) => b[0].length - a[0].length);
  let remaining = n;
  const used = new Set();
  for (const [key, id] of cands) {
    if (!key || key.length < 2) continue;
    if (remaining.includes(key)) {
      if (!used.has(id)) { hits.push(id); used.add(id); }
      remaining = remaining.split(key).join('#');
    }
  }
  return hits;
}

function matchVocabulary(text, list, zhField) {
  const n = normKey(text);
  for (const item of list) {
    const zh = normKey(item[zhField]);
    if (zh && zh.length >= 2 && n.includes(zh)) return item;
  }
  return null;
}

/**
 * 路由：返回 { tool, args, reason } 或 null
 */
export async function route(text) {
  await loadVocabulary();
  const t = String(text || '');
  const n = normKey(t);
  const persons = await extractPersons(t);
  const has = (...kw) => kw.some((k) => n.includes(normKey(k)));

  const school = matchVocabulary(t, SCHOOLS, 'name_cn');
  const field = matchVocabulary(t, FIELDS, 'name_zh');

  // -1. 和平奖 / 文学奖 / 获奖组织（必须优先于「诺奖得主名录」，
  //     因为「和平奖得主」等词中含「得主」会被规则 0 抢走）
  if (has('和平奖','诺贝尔和平奖','peace')) {
    const yearMatch2 = t.match(/(19\d{2}|20\d{2})\s*年/);
    const args = {};
    if (yearMatch2) args.year = Number(yearMatch2[1]);
    if (persons.length) args.keyword = nameOf(persons[0]);
    else {
      // 尝试抓英文人名（Obama/Trump/Carter 等）
      const en = t.match(/\b[A-Z][a-z]{2,15}\b/g);
      if (en && en.length) {
        // 排除常见疑问词
        const stopWords = new Set(['The','This','That','What','Which','When','Where','Who','How','Why','Does','Will','Would','Could','Should','Have','Has','Had','Are','Is','Be','Been','Not','About','Most','Recent','All']);
        const keep = en.filter(w => !stopWords.has(w));
        if (keep.length) args.keyword = keep[0];
      }
    }
    if (has('组织','机构','UN','联合国','红十字')) args.orgOnly = true;
    return { tool: '和平奖得主', args, reason: '关键词：和平奖' };
  }

  if (has('文学奖','诺贝尔文学奖','文学','writer','writers','文学家','小说家','poet')) {
    const yearMatch2 = t.match(/(19\d{2}|20\d{2})\s*年/);
    const args = {};
    if (yearMatch2) args.year = Number(yearMatch2[1]);
    if (persons.length) args.keyword = nameOf(persons[0]);
    else {
      const en = t.match(/\b[A-Z][a-z]{2,20}\b/g);
      if (en && en.length) {
        const stopWords = new Set(['The','This','That','What','Which','When','Where','Who','How','Why','Does','Will','Would','Could','Should','Have','Has','Had','Are','Is','Be','Been','Not','About','Most','Recent','All']);
        const keep = en.filter(w => !stopWords.has(w));
        if (keep.length) args.keyword = keep[0];
      }
    }
    return { tool: '文学奖得主', args, reason: '关键词：文学奖' };
  }

  if (has('获奖组织','获奖机构','诺贝尔奖机构','peace org','peace orgs')
      || (has('联合国','红十字','un','unhcr','红新月') && has('机构','组织','获奖','得主','和平'))) {
    const args = {};
    const kw = t.match(/(联合国|红十字|红新月|UNHCR|UNRWA|UNESCO|WHO|ICRC|Nobel)/i);
    if (kw) args.keyword = kw[0];
    return { tool: '和平奖组织', args, reason: '关键词：获奖组织/机构' };
  }

  // 0. 诺奖得主/年份/名录（最高优先级：识别年份+诺奖类问题）
  const yearMatch = t.match(/(19\d{2}|20\d{2})\s*年/);
  if (has('诺奖','诺贝尔奖','获奖','得主','历年') || yearMatch) {
    const catMap = {'物理':'物理学','化学':'化学','医学':'生理学或医学','生理医学':'生理学或医学','生理或医学':'生理学或医学','经济学':'经济学','经济':'经济学'};
    let cat = '';
    for (const [k,v] of Object.entries(catMap)) if (has(k)) { cat = v; break; }
    return { tool: '诺奖得主名录', args: { year: yearMatch ? Number(yearMatch[1]) : null, category: cat, keyword: persons.length ? nameOf(persons[0]) : '' }, reason: yearMatch?`${yearMatch[1]}年诺奖查询`:'诺奖名录查询' };
  }

  // 1. 订正记录
  if (has('订正', '修正记录', '核查记录', '数据订正')) return { tool: '数据订正记录', args: {}, reason: '关键词：订正记录' };

  // 2. 两点路径
  if (persons.length >= 2 && has('之间', '到', '距离', '几代', '路径', '怎么连', '关系路径', '相隔')) {
    return { tool: '两点师承路径', args: { from: nameOf(persons[0]), to: nameOf(persons[1]) }, reason: '识别到两位学者与路径意图' };
  }

  // 3. 学派
  if (has('学派', '门派', '学术共同体')) {
    return { tool: '学派查询', args: school ? { school: school.name_cn } : {}, reason: school ? `识别到学派：${school.name_cn}` : '学派总览' };
  }

  // 4. 研究范式
  if (has('范式', '研究框架', '理论框架')) return { tool: '研究范式', args: {}, reason: '关键词：范式' };

  // 5. 潜力预测
  if (has('预测', '潜力', '谁最可能', '下一个诺奖', '候选')) {
    const m = n.match(/(\d+)\s*(名|个|位)/);
    return { tool: '诺奖潜力预测', args: m ? { topN: Number(m[1]) } : {}, reason: '关键词：预测/潜力' };
  }

  // 6. 导师排名
  const rankingLike = has('排名', '产出', '最强导师', '名师', '诺奖制造', '导师排行', '谁的学生')
    || (n.includes('最多') && has('培养', '带出', '门下', '学生', '弟子', '导师'))
    || (n.includes('哪些导师') || n.includes('哪位导师'));
  if (rankingLike) {
    const m = n.match(/(\d+)\s*(名|个|位)/);
    return { tool: '导师产出力排名', args: m ? { topN: Number(m[1]) } : {}, reason: '关键词：导师产出/排名' };
  }

  // 7. 合作网络
  if (has('合作', '共同发表', '合著')) return { tool: '合作网络', args: {}, reason: '关键词：合作' };

  // 8. 人才流动
  if (has('流动', '人才流', '国籍', '移民', '流向')) return { tool: '人才流动分析', args: {}, reason: '关键词：人才流动' };

  // 9. 论文
  if (has('论文', '代表作', '著作', '发表', '时滞', '里程碑', '期刊')) {
    const args = {};
    if (persons.length) args.person = nameOf(persons[0]);
    else {
      const m = t.match(/(?:关于|有关|涉及)\s*([^\s，。？?]{2,12})/);
      if (m) args.topic = m[1];
    }
    return { tool: '论文查询', args, reason: persons.length ? `识别到学者：${nameOf(persons[0])}` : '论文层总览' };
  }

  // 10. 师承链
  if (has('师承', '传承', '门下', '弟子', '学生', '导师', '老师', '师从', '学派传承', '学术家谱', '师门')) {
    if (!persons.length) return null;
    const down = has('学生', '门下', '弟子', '后代', '培养', '带出');
    const up = has('导师', '师从', '老师', '祖先', '向谁', '跟谁');
    let direction = '向上';
    if (down && !up) direction = '向下';
    if (has('向下', '下游')) direction = '向下';
    if (has('向上', '上游')) direction = '向上';
    return { tool: '查师承链', args: { person: nameOf(persons[0]), direction }, reason: `识别到学者：${nameOf(persons[0])}` };
  }

  // 11. 网络统计
  if (has('统计', '总览', '概况', '规模', '有多少人', '网络结构', '整体')) return { tool: '网络统计', args: {}, reason: '关键词：统计/总览' };

  // 12. 研究方向
  if (has('研究方向', '研究领域', '方向', '领域', '学科')) {
    return { tool: '研究方向查询', args: field ? { field: field.name_zh } : {}, reason: field ? `识别到方向：${field.name_zh}` : '方向总览' };
  }

  // 13. 单人 → 人物画像
  if (persons.length === 1) return { tool: '人物画像', args: { person: nameOf(persons[0]) }, reason: `识别到学者：${nameOf(persons[0])}` };

  return null;
}

/** 内置帮助文本 */
export const HELP_TEXT = `我是诺奖师承知识本体助手。当前**未配置大模型**，处于「本地规则引擎」模式，可用下面这些问法：

- **师承链**：\`杨振宁的师承链\`、\`索末菲门下的学生\`
- **师承路径**：\`玻尔和杨振宁之间隔几代\`
- **人物画像**：\`卡甘\`、\`钱永佑\`
- **导师排名**：\`哪位导师培养的诺奖得主最多\`
- **学派**：\`卡文迪许学派\`、\`哥本哈根学派\`
- **论文**：\`克里克的论文\`、\`光遗传 论文\`
- **研究方向**：\`光遗传学\`、\`量子力学\`
- **网络统计**：\`网络总览\`
- **潜力预测**：\`诺奖潜力预测 top5\`
- **人才流动**：\`人才流动\`
- **合作网络**：\`合作网络\`
- **研究范式**：\`研究范式\`
- **和平奖**：\`和平奖得主\`、\`谁得过和平奖\`、\`2009 年和平奖\`、\`奥巴马的和平奖\`、\`联合国和平奖\`
- **文学奖**：\`文学奖得主\`、\`诺贝尔文学奖 女性\`、\`2015 文学奖\`
- **获奖组织**：\`和平奖机构\`、\`红十字和平奖\`、\`联合国获奖\`
- **订正记录**：\`数据订正记录\`

> 想用自然语言任意提问、并让 Agent 自动编排多步查询，请在右上角 **⚙️ 设置** 中填入兼容 OpenAI 的大模型接口（Key 只保存在你的浏览器本地）。`;

/** 执行一次路由并返回结果 */
export async function runRoute(text) {
  const r = await route(text);
  if (!r) return null;
  const tool = getTool(r.tool);
  if (!tool) return null;
  const out = await tool.run(r.args || {});
  return { route: r, tool, result: out };
}

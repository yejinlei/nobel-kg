/* ============================================================
   tools.js —— 本体论查询工具集
   把业务查询固化为白名单函数（不把裸 SQL 交给大模型），
   每个工具既可供「本地规则引擎」直接调用，也可作为 LLM 的 function 工具。
   ============================================================ */

import { query, scalar } from './db.js';

/* ------------------------- 内存缓存 ------------------------- */

let PERSONS = null;   // Map<id, person>
let PMAP = {};        // 同上，对象形式
let EDGES = null;     // 师承边
let UP = null;        // student -> [{advisor, type}]
let DOWN = null;      // advisor -> [{student, type}]
let NAME_IDX = null;  // 归一化名称 -> [ids]

/** 常见简称 / 别名 -> person_id（键为归一化后的字符串） */
const ALIAS = {
  '玻尔': 'P001', 'nielsbohr': 'P001', '尼尔斯玻尔': 'P001',
  '奥格玻尔': 'P018', 'aagebohr': 'P018',
  '汤姆孙': 'P037', '汤姆逊': 'P037', 'jj汤姆孙': 'P037', 'j.j.汤姆孙': 'P037',
  '约瑟夫约翰汤姆孙': 'P037', 'jjthomson': 'P037',
  '布拉格': 'P011', 'wl布拉格': 'P011', '小布拉格': 'P011',
  '居里': 'P040', '居里夫人': 'P040', '玛丽居里': 'P040', 'mariecurie': 'P040',
  '皮埃尔居里': 'P057', '居里先生': 'P057',
  '爱因斯坦': 'P056', 'alberteinstein': 'P056',
  '费米': 'P036', '恩里科费米': 'P036', 'enricofermi': 'P036',
  '索末菲': 'P032', 'arnoldsommerfeld': 'P032',
  '玻恩': 'P033', 'maxborn': 'P033',
  '海森堡': 'P002', 'wernerheisenberg': 'P002',
  '泡利': 'P003', 'pauli': 'P003',
  '杨振宁': 'P009', 'chenningyang': 'P009',
  '李政道': 'P010', 'tsungdaolee': 'P010',
  '卢瑟福': 'P013', 'ernestruutherford': 'P013', 'rutherford': 'P013',
  '泰勒': 'P035', 'edwardteller': 'P035',
  '戴塞罗思': 'P021', '戴塞罗斯': 'P021', 'deisseroth': 'P021',
  '黑格曼': 'P022', 'hegemann': 'P022',
  '纳格尔': 'P023', 'nagel': 'P023',
  '卡甘': 'P024', 'kagan': 'P024',
  '硖合宪三': 'P025', 'soai': 'P025',
  '钱永佑': 'P028', 'richardwtsien': 'P028',
  '钱永健': 'P043', 'rogertsien': 'P043',
  '向山光昭': 'P045', 'mukaiyama': 'P045',
  '克里克': 'P015', 'crick': 'P015',
  '沃森': 'P014', 'watson': 'P014',
  '佩鲁茨': 'P016', 'perutz': 'P016',
  '查德威克': 'P046', 'chadwick': 'P046',
  '狄拉克': 'P006', 'dirac': 'P006',
  '拉比': 'P049', 'rabi': 'P049',
  '鲍林': 'P050', 'pauling': 'P050',
};

export function normKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\s·.．・\-—_()（）]/g, '');
}

/* ------------------------- 载入核心数据 ------------------------- */

export async function loadCore() {
  if (EDGES) return;
  const pr = await query('SELECT * FROM persons');
  PERSONS = new Map();
  NAME_IDX = new Map();
  pr.rows.forEach((r) => {
    PERSONS.set(r.person_id, r);
    PMAP[r.person_id] = r;
    for (const key of [normKey(r.name_zh), normKey(r.name_en)]) {
      if (!key) continue;
      if (!NAME_IDX.has(key)) NAME_IDX.set(key, []);
      NAME_IDX.get(key).push(r.person_id);
    }
  });

  const er = await query('SELECT student_id, advisor_id, relation_type, is_phd, start_year, verification_status, note FROM mentorship');
  EDGES = er.rows;
  UP = new Map();
  DOWN = new Map();
  const seen = new Set();
  for (const e of EDGES) {
    const k = e.student_id + '<' + e.advisor_id;
    if (!seen.has(k)) {
      seen.add(k);
      if (!UP.has(e.student_id)) UP.set(e.student_id, []);
      UP.get(e.student_id).push({ other: e.advisor_id, type: e.relation_type, isPhd: e.is_phd, year: e.start_year, vs: e.verification_status });
      if (!DOWN.has(e.advisor_id)) DOWN.set(e.advisor_id, []);
      DOWN.get(e.advisor_id).push({ other: e.student_id, type: e.relation_type, isPhd: e.is_phd, year: e.start_year, vs: e.verification_status });
    }
  }
}

export function nameOf(id) {
  const p = PMAP[id];
  return p ? p.name_zh : id;
}

export function personOf(id) {
  return PMAP[id] || null;
}

/** 解析人名 -> 候选 person_id 列表（按权重排序） */
export async function resolvePersons(text) {
  await loadCore();
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return [];
  const k = normKey(raw);

  if (ALIAS[k] && PERSONS.has(ALIAS[k])) return [ALIAS[k]];

  if (NAME_IDX.has(k) && NAME_IDX.get(k).length) {
    const ids = NAME_IDX.get(k);
    if (ids.length === 1) return ids;
    return await rank(ids);
  }

  // 子串匹配
  const esc = raw.replace(/'/g, "''");
  const r = await query(`
    SELECT person_id FROM persons
    WHERE name_zh LIKE '%${esc}%' OR lower(name_en) LIKE lower('%${esc}%')
  `);
  if (!r.rows.length) return [];
  return await rank(r.rows.map((x) => x.person_id));
}

async function rank(ids) {
  const list = ids.filter((id) => PERSONS.has(id));
  const f = await query('SELECT person_id, pagerank FROM features');
  const pr = new Map(f.rows.map((x) => [x.person_id, Number(x.pagerank) || 0]));
  return list.sort((a, b) => (pr.get(b) || 0) - (pr.get(a) || 0) || a.localeCompare(b));
}

async function resolveOne(name) {
  const ids = await resolvePersons(name);
  return ids.length ? ids[0] : null;
}

function lifeYears(p) {
  const b = p.birth_year ? String(Math.trunc(p.birth_year)) : '?';
  const d = p.death_year ? String(Math.trunc(p.death_year)) : '';
  return d ? `${b}–${d}` : `${b}–`;
}

function nobelLine(p) {
  if (p.is_nobel_laureate !== '是') return '非诺奖得主';
  return `${p.nobel_year ? Math.trunc(p.nobel_year) : ''} 年诺贝尔${p.nobel_category || ''}奖`;
}

/* ------------------------- 遍历辅助 ------------------------- */

function walkLevels(startId, dir) {
  const map = dir === 'up' ? UP : DOWN;
  const levels = [];
  let frontier = [startId];
  const seen = new Set([startId]);
  while (frontier.length) {
    const items = [];
    const nextSet = new Set();
    for (const id of frontier) {
      for (const e of (map.get(id) || [])) {
        if (seen.has(e.other)) continue;
        seen.add(e.other);
        nextSet.add(e.other);
        items.push({ from: id, to: e.other, type: e.type, isPhd: e.isPhd, year: e.year });
      }
    }
    if (!items.length) break;
    levels.push(items);
    frontier = [...nextSet];
  }
  return levels;
}

function shortestPath(a, b, maxDepth = 8) {
  if (a === b) return [a];
  const adj = new Map();
  const push = (x, y) => { if (!adj.has(x)) adj.set(x, new Set()); adj.get(x).add(y); };
  for (const e of EDGES) { push(e.student_id, e.advisor_id); push(e.advisor_id, e.student_id); }
  let frontier = [a];
  const prev = new Map([[a, null]]);
  let depth = 0;
  while (frontier.length && depth < maxDepth) {
    const next = [];
    for (const id of frontier) {
      for (const nb of (adj.get(id) || [])) {
        if (prev.has(nb)) continue;
        prev.set(nb, id);
        if (nb === b) {
          const path = [b];
          let cur = id;
          while (cur !== null && cur !== undefined) { path.unshift(cur); cur = prev.get(cur); }
          return path;
        }
        next.push(nb);
      }
    }
    frontier = next;
    depth++;
  }
  return null;
}

/* ------------------------- 工具定义 ------------------------- */

export const TOOLS = [
  /* 1. 师承链 */
  {
    name: '查师承链',
    label: '师承链追溯',
    description: '查询某位学者的师承链。direction=向上可追溯其历代导师（学术祖先），direction=向下可展开其门下学生（学术后代）。',
    parameters: {
      type: 'object',
      properties: {
        person: { type: 'string', description: '学者姓名，如 杨振宁、玻尔、索末菲' },
        direction: { type: 'string', enum: ['向上', '向下'], description: '向上=追溯导师，向下=展开学生，默认向上' },
      },
      required: ['person'],
    },
    async run(args) {
      await loadCore();
      const id = await resolveOne(args.person);
      if (!id) return { text: `未在本体中找到与「${args.person}」匹配的学者。`, payload: { error: 'not_found' } };
      const dir = args.direction === '向下' ? 'down' : 'up';
      const levels = walkLevels(id, dir);
      const p = PMAP[id];
      const dirLabel = dir === 'up' ? '向上追溯导师' : '向下展开学生';
      const lines = [`**${p.name_zh}**（${p.name_en}，${lifeYears(p)}，${nobelLine(p)}）的师承链 · ${dirLabel}`];
      const rows = [];
      const maxShow = 6;
      levels.slice(0, maxShow).forEach((items, i) => {
        const parts = items.map((it) => {
          const q = PMAP[it.to];
          const extra = it.type ? `（${it.type}${it.year ? '，' + Math.trunc(it.year) + '年起' : ''}）` : '';
          rows.push([`第 ${i + 1} 代`, q ? q.name_zh : it.to, it.type || '师承', it.year ? Math.trunc(it.year) : '', q && q.is_nobel_laureate === '是' ? '是' : '']);
          return `${q ? q.name_zh : it.to}${extra}`;
        });
        lines.push(`- **第 ${i + 1} 代**：${parts.join('；')}`);
      });
      if (!levels.length) lines.push(`- 本体中此人暂无${dir === 'up' ? '上游导师' : '下游学生'}记录。`);
      if (levels.length > maxShow) lines.push(`- ……（共 ${levels.length} 代，已展示前 ${maxShow} 代）`);

      const total = levels.reduce((a, l) => a + l.length, 0);
      const blocks = [];
      if (rows.length) blocks.push({ type: 'table', title: '师承明细', columns: ['代际', '对象', '关系类型', '起始年', '诺奖得主'], rows });

      return {
        text: lines.join('\n'),
        blocks,
        payload: { person: p.name_zh, direction: dirLabel, generations: levels.length, total, levels: levels.map((l, i) => ({ gen: i + 1, members: l.map((x) => ({ name: nameOf(x.to), relation: x.type, year: x.year })) })) },
      };
    },
  },

  /* 2. 两点路径 */
  {
    name: '两点师承路径',
    label: '师承路径',
    description: '查询两位学者之间在师承网络中的最短连接路径，判断他们相隔几代师承。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起点学者姓名' },
        to: { type: 'string', description: '终点学者姓名' },
      },
      required: ['from', 'to'],
    },
    async run(args) {
      await loadCore();
      const a = await resolveOne(args.from);
      const b = await resolveOne(args.to);
      if (!a || !b) return { text: `未找到「${!a ? args.from : args.to}」，请确认姓名。`, payload: { error: 'not_found' } };
      const path = shortestPath(a, b);
      if (!path) return { text: `**${nameOf(a)}** 与 **${nameOf(b)}** 在本体记录的师承网络中不连通（分属不同师门）。`, payload: { connected: false } };
      const chain = path.map((id) => nameOf(id));
      const rels = [];
      for (let i = 0; i < path.length - 1; i++) {
        const e = (UP.get(path[i]) || []).find((x) => x.other === path[i + 1]) || (DOWN.get(path[i]) || []).find((x) => x.other === path[i + 1]);
        const dirArrow = (UP.get(path[i]) || []).some((x) => x.other === path[i + 1]) ? '师从' : '指导';
        rels.push(`${chain[i]} —${dirArrow}→ ${chain[i + 1]}${e && e.type ? '（' + e.type + '）' : ''}`);
      }
      return {
        text: `**师承距离**：${path.length - 1} 代\n\n**连接路径**：${chain.join(' → ')}\n\n` + rels.map((r) => `- ${r}`).join('\n'),
        payload: { connected: true, distance: path.length - 1, path: chain },
      };
    },
  },

  /* 3. 人物画像 */
  {
    name: '人物画像',
    label: '人物画像',
    description: '查询某位学者的完整档案：生平、国籍、诺奖、研究方向、所属学派、导师、学生、代表作论文。',
    parameters: {
      type: 'object',
      properties: { person: { type: 'string', description: '学者姓名' } },
      required: ['person'],
    },
    async run(args) {
      await loadCore();
      const id = await resolveOne(args.person);
      if (!id) return { text: `未在本体中找到「${args.person}」。`, payload: { error: 'not_found' } };
      const p = PMAP[id];
      const lines = [`### ${p.name_zh}（${p.name_en}）`];
      const meta = [`${lifeYears(p)}`, p.nationality || '', nobelLine(p), p.role_type ? `本体角色：${p.role_type}` : ''].filter(Boolean);
      lines.push(meta.join(' · '));

      const mentors = (UP.get(id) || []).map((e) => `${nameOf(e.other)}（${e.type}）`);
      const students = (DOWN.get(id) || []).map((e) => `${nameOf(e.other)}（${e.type}）`);
      if (mentors.length) lines.push(`**导师**：${mentors.join('、')}`);
      if (students.length) lines.push(`**学生**：${students.join('、')}`);

      const fl = await query(`SELECT f.name_zh FROM person_field pf JOIN fields f ON f.field_id = pf.field_id WHERE pf.person_id = '${id}'`);
      if (fl.rows.length) lines.push(`**研究方向**：${fl.rows.map((r) => r.name_zh).join('、')}`);

      const sc = await query(`SELECT s.name_cn, ps.role FROM person_school ps JOIN schools s ON s.school_id = ps.school_id WHERE ps.person_id = '${id}'`);
      if (sc.rows.length) lines.push(`**所属学派**：${sc.rows.map((r) => `${r.name_cn}（${r.role}）`).join('、')}`);

      const wk = await query(`SELECT w.name_zh, w.year FROM person_work pw JOIN works w ON w.work_id = pw.work_id WHERE pw.person_id = '${id}' ORDER BY w.year`);
      let blocks = [];
      if (wk.rows.length) {
        lines.push(`**代表性工作**：`);
        wk.rows.forEach((r) => lines.push(`- ${r.year ? Math.trunc(r.year) + '：' : ''}${r.name_zh}`));
      }

      const pp = await query(`SELECT pa.author_role, p.title_zh, p.journal, p.year FROM paper_author pa JOIN papers p ON p.paper_id = pa.paper_id WHERE pa.person_id = '${id}' ORDER BY p.year`);
      if (pp.rows.length) {
        lines.push(`**代表论文**（${pp.rows.length} 篇）：`);
        blocks.push({
          type: 'table', title: '论文清单',
          columns: ['年份', '论文', '期刊', '署名'],
          rows: pp.rows.map((r) => [r.year ? Math.trunc(r.year) : '', r.title_zh || '', r.journal || '', r.author_role || '']),
        });
      }

      if (p.nobel_motivation) lines.push(`**获奖理由**：${p.nobel_motivation}`);
      if (p.note) lines.push(`> ${p.note}`);

      return {
        text: lines.join('\n'),
        blocks,
        payload: { person: p.name_zh, mentors, students, fields: fl.rows.map((r) => r.name_zh), schools: sc.rows.map((r) => r.name_cn), works: wk.rows.map((r) => r.name_zh), papers: pp.rows.length },
      };
    },
  },

  /* 4. 导师产出排名 */
  {
    name: '导师产出力排名',
    label: '导师排名',
    description: '统计哪些导师培养出最多诺奖得主（学术后代产出力排名）。',
    parameters: {
      type: 'object',
      properties: { topN: { type: 'number', description: '返回前几名，默认 10' } },
    },
    async run(args) {
      const n = Math.min(Math.max(Number(args.topN) || 10, 1), 30);
      const r = await query(`
        SELECT a.person_id, a.name_zh, a.is_nobel_laureate,
               COUNT(DISTINCT s.person_id) AS total,
               COUNT(DISTINCT CASE WHEN s.is_nobel_laureate = '是' THEN s.person_id END) AS nobel
        FROM mentorship m
        JOIN persons a ON a.person_id = m.advisor_id
        JOIN persons s ON s.person_id = m.student_id
        GROUP BY 1, 2, 3
        ORDER BY nobel DESC, total DESC
        LIMIT ${n}
      `);
      const rows = r.rows.map((x) => [x.name_zh, x.nobel, x.total, x.is_nobel_laureate === '是' ? '是' : '否']);
      const text = [`### 导师产出力排名（Top ${r.rows.length}）`,
        r.rows.map((x, i) => `${i + 1}. **${x.name_zh}** — 诺奖学生 ${x.nobel} 位 / 门下共 ${x.total} 位`).join('\n'),
        `> 说明：统计口径为本体记录的直接师承关系（博士/博士后/研究导师）。`
      ].join('\n');
      return {
        text,
        blocks: [
          { type: 'bar', title: '诺奖学生数', data: r.rows.map((x) => ({ label: x.name_zh, value: Number(x.nobel) })) },
          { type: 'table', title: '明细', columns: ['导师', '诺奖学生', '门下总数', '本人诺奖'], rows },
        ],
        payload: { ranking: r.rows.map((x) => ({ advisor: x.name_zh, nobelStudents: Number(x.nobel), totalStudents: Number(x.total) })) },
      };
    },
  },

  /* 5. 学派 */
  {
    name: '学派查询',
    label: '学派',
    description: '查询学术学派。给 school 参数则返回该学派详情与成员；不给则列出全部学派概览。',
    parameters: {
      type: 'object',
      properties: { school: { type: 'string', description: '学派名称，如 卡文迪许学派、哥本哈根学派；留空则列出全部' } },
    },
    async run(args) {
      const name = String(args.school || '').trim();
      if (!name) {
        const r = await query(`
          SELECT s.school_id, s.name_cn, s.name_en, s.era_start, f.name_zh AS founder,
                 COUNT(DISTINCT ps.person_id) AS members
          FROM schools s
          LEFT JOIN persons f ON f.person_id = s.founder_id
          LEFT JOIN person_school ps ON ps.school_id = s.school_id
          GROUP BY 1,2,3,4,5 ORDER BY members DESC
        `);
        return {
          text: `### 本体收录的 ${r.rows.length} 个学术学派\n` + r.rows.map((x) => `- **${x.name_cn}**（${x.name_en}）｜创立于 ${x.era_start || '—'} 年｜奠基人 ${x.founder || '—'}｜成员 ${x.members} 人`).join('\n'),
          blocks: [{ type: 'bar', title: '学派成员数', data: r.rows.map((x) => ({ label: x.name_cn, value: Number(x.members) })) }],
          payload: { schools: r.rows },
        };
      }
      const esc = name.replace(/'/g, "''");
      const sr = await query(`SELECT * FROM schools WHERE name_cn LIKE '%${esc}%' OR name_en LIKE '%${esc}%'`);
      if (!sr.rows.length) return { text: `未找到学派「${name}」。可用「学派都有哪些」查看全部。`, payload: { error: 'not_found' } };
      const s = sr.rows[0];
      const mr = await query(`
        SELECT p.person_id, p.name_zh, p.is_nobel_laureate, p.nobel_year, p.nobel_category, ps.role
        FROM person_school ps JOIN persons p ON p.person_id = ps.person_id
        WHERE ps.school_id = '${s.school_id}'
      `);
      const roleZh = { founder: '奠基人', cofounder: '共同奠基人', leader: '学术带头人', member: '成员', student: '学生', postdoc: '博士后', second_gen: '第二代', translator: '转化者', visitor: '访问学者' };
      const nobelCount = mr.rows.filter((x) => x.is_nobel_laureate === '是').length;
      const lines = [
        `### ${s.name_cn}（${s.name_en}）`,
        `- **年代**：${s.era_start || '—'} 年起`,
        `- **成员**：${mr.rows.length} 人（其中诺奖得主 ${nobelCount} 位）`,
        s.desc ? `- **说明**：${s.desc}` : '',
      ].filter(Boolean);
      lines.push('');
      lines.push(mr.rows.map((x) => `- **${x.name_zh}**（${roleZh[x.role] || x.role}）${x.is_nobel_laureate === '是' ? `${Math.trunc(x.nobel_year)} 年${x.nobel_category}奖` : ''}`).join('\n'));
      return {
        text: lines.join('\n'),
        blocks: [{
          type: 'table', title: '学派成员', columns: ['人物', '角色', '诺奖'],
          rows: mr.rows.map((x) => [x.name_zh, roleZh[x.role] || x.role, x.is_nobel_laureate === '是' ? `${Math.trunc(x.nobel_year)} ${x.nobel_category}` : '']),
        }],
        payload: { school: s.name_cn, era: s.era_start, members: mr.rows.map((x) => ({ name: x.name_zh, role: roleZh[x.role] || x.role })) },
      };
    },
  },

  /* 6. 论文查询 */
  {
    name: '论文查询',
    label: '论文与代表作',
    description: '查询论文/著作。给 person 返回该学者的论文；给 topic 按关键词检索；都不给则返回里程碑论文与技术-诺奖时滞分析。',
    parameters: {
      type: 'object',
      properties: {
        person: { type: 'string', description: '学者姓名（可选）' },
        topic: { type: 'string', description: '检索关键词，如 DNA、光遗传、矩阵力学（可选）' },
      },
    },
    async run(args) {
      await loadCore();
      const person = String(args.person || '').trim();
      const topic = String(args.topic || '').trim();

      if (person) {
        const id = await resolveOne(person);
        if (!id) return { text: `未找到学者「${person}」。`, payload: { error: 'not_found' } };
        const r = await query(`
          SELECT p.title, p.title_zh, p.journal, p.year, p.doi, p.is_landmark, pa.author_role
          FROM paper_author pa JOIN papers p ON p.paper_id = pa.paper_id
          WHERE pa.person_id = '${id}' ORDER BY p.year
        `);
        if (!r.rows.length) return { text: `本体中暂无 **${nameOf(id)}** 的论文记录。`, payload: { papers: [] } };
        const lines = [`### ${nameOf(id)} 的论文/著作（${r.rows.length} 篇）`];
        r.rows.forEach((x) => lines.push(`- **${x.year ? Math.trunc(x.year) : '—'}**｜${x.title_zh || x.title}｜*${x.journal || '—'}*${x.is_landmark === '是' ? ' ｜🏅里程碑' : ''}`));
        return {
          text: lines.join('\n'),
          blocks: [{
            type: 'table', title: '论文清单', columns: ['年份', '标题', '期刊', 'DOI', '里程碑'],
            rows: r.rows.map((x) => [x.year ? Math.trunc(x.year) : '', x.title_zh || x.title, x.journal || '', x.doi || '', x.is_landmark === '是' ? '是' : '']),
          }],
          payload: { person: nameOf(id), papers: r.rows.map((x) => ({ year: x.year, title: x.title_zh || x.title, journal: x.journal })) },
        };
      }

      if (topic) {
        const esc = topic.replace(/'/g, "''");
        const r = await query(`SELECT title, title_zh, journal, year, is_landmark, doi FROM papers WHERE title LIKE '%${esc}%' OR title_zh LIKE '%${esc}%' OR note LIKE '%${esc}%' ORDER BY year`);
        const lr = await query(`
          SELECT a.title_zh AS a_title, b.title_zh AS b_title, pl.influence_type, pl.description
          FROM paper_lineage pl JOIN papers a ON a.paper_id = pl.student_paper_id JOIN papers b ON b.paper_id = pl.advisor_paper_id
          WHERE a.title_zh LIKE '%${esc}%' OR b.title_zh LIKE '%${esc}%' OR pl.description LIKE '%${esc}%'
        `);
        const lines = [`### 关键词「${topic}」检索结果`, `**匹配论文 ${r.rows.length} 篇**`];
        r.rows.forEach((x) => lines.push(`- ${x.year ? Math.trunc(x.year) : ''}｜${x.title_zh || x.title}｜*${x.journal || ''}*`));
        if (lr.rows.length) {
          lines.push('', `**论文间的思想传承（${lr.rows.length} 条）**`);
          lr.rows.forEach((x) => lines.push(`- 《${x.b_title}》 → 《${x.a_title}》〔${x.influence_type}〕`));
        }
        return { text: lines.join('\n'), payload: { topic, papers: r.rows, lineages: lr.rows } };
      }

      // 默认：里程碑论文 + 时滞
      const lm = await query(`SELECT year, COALESCE(title_zh,title) AS t, journal, field_id FROM papers WHERE is_landmark = '是' ORDER BY year`);
      const lag = await query(`
        SELECT p.name_zh, pa.author_role, pp.year AS paper_year, p.nobel_year, (p.nobel_year - pp.year) AS lag
        FROM paper_author pa
        JOIN papers pp ON pp.paper_id = pa.paper_id
        JOIN persons p ON p.person_id = pa.person_id
        WHERE p.is_nobel_laureate = '是' AND p.nobel_year IS NOT NULL
        ORDER BY lag DESC
      `);
      const lines = [
        '### 论文/著作层总览',
        `- **里程碑论文**：${lm.rows.length} 篇`,
        `- **统计范围**：收录论文 ${(await scalar('SELECT count(*) FROM papers'))} 篇，其中诺奖得主署名的关键论文可计算「发表 → 获奖」时滞`,
        '',
        '**发表到获奖时滞最长的几例**：',
      ];
      lag.rows.slice(0, 6).forEach((x) => lines.push(`- **${x.name_zh}**：${Math.trunc(x.paper_year)} 年论文 → ${Math.trunc(x.nobel_year)} 年获奖，时滞 **${Math.trunc(x.lag)} 年**`));
      return {
        text: lines.join('\n'),
        blocks: [
          { type: 'bar', title: '里程碑论文年份分布（按年代）', data: decadeBuckets(lm.rows.map((x) => x.year)) },
          { type: 'table', title: '时间跨度最长的论文→诺奖', columns: ['学者', '论文年', '获奖年', '时滞(年)'], rows: lag.rows.slice(0, 12).map((x) => [x.name_zh, Math.trunc(x.paper_year), Math.trunc(x.nobel_year), Math.trunc(x.lag)]) },
        ],
        payload: { landmarkCount: lm.rows.length, longestLag: lag.rows.slice(0, 6) },
      };
    },
  },

  /* 7. 网络统计 */
  {
    name: '网络统计',
    label: '网络总览',
    description: '返回师承网络的总览统计：人物数、诺奖数、师承边数、学派数、论文数，以及门类分布与关键桥节点。',
    parameters: { type: 'object', properties: {} },
    async run() {
      const g = async (sql) => Number(await scalar(sql)) || 0;
      const persons = await g('SELECT count(*) FROM persons');
      const nobel = await g("SELECT count(*) FROM persons WHERE is_nobel_laureate = '是'");
      const edges = await g('SELECT count(*) FROM mentorship');
      const schools = await g('SELECT count(*) FROM schools');
      const papers = await g('SELECT count(*) FROM papers');
      const paradigms = await g('SELECT count(*) FROM paradigms');
      const collab = await g('SELECT count(*) FROM collaboration');

      const cat = await query("SELECT nobel_category AS c, count(*) AS n FROM persons WHERE is_nobel_laureate = '是' GROUP BY 1 ORDER BY 2 DESC");
      const disc = await query('SELECT discipline AS d, count(*) AS n FROM fields GROUP BY 1 ORDER BY 2 DESC');
      const top = await query('SELECT name_cn, betweenness, pagerank, students FROM features ORDER BY betweenness DESC LIMIT 6');

      const lines = [
        '### 师承知识本体 · 网络总览',
        `- **人物**：${persons} 位（其中诺奖得主 ${nobel} 位）`,
        `- **师承关系**：${edges} 条`,
        `- **学术学派**：${schools} 个｜**研究范式**：${paradigms} 个`,
        `- **论文/著作**：${papers} 篇｜**合作关系**：${collab} 条`,
        '',
        '**门类分布**：' + cat.rows.map((x) => `${x.c} ${x.n}`).join('｜'),
        '',
        '**中介中心性最高的桥接人物**（删除后师承网络会断裂）：',
      ];
      top.rows.forEach((x, i) => lines.push(`${i + 1}. **${x.name_cn}**：中介中心性 ${Number(x.betweenness).toFixed(4)}｜门下 ${x.students} 人`));

      return {
        text: lines.join('\n'),
        blocks: [
          { type: 'pie', title: '诺奖门类分布', data: cat.rows.map((x) => ({ label: x.c, value: Number(x.n) })) },
          { type: 'bar', title: '研究方向门类分布', data: disc.rows.map((x) => ({ label: x.d, value: Number(x.n) })) },
        ],
        payload: { persons, nobel, edges, schools, papers, paradigms, collaborations: collab, categories: cat.rows, bridges: top.rows },
      };
    },
  },

  /* 8. 诺奖潜力预测 */
  {
    name: '诺奖潜力预测',
    label: '潜力预测',
    description: '基于本体网络结构特征（中心性、师承深度、诺奖祖先、门下诺奖数、转化率、学派归属等）对人物做诺奖潜力打分排行。',
    parameters: {
      type: 'object',
      properties: { topN: { type: 'number', description: '返回前几名，默认 8' } },
    },
    async run(args) {
      const n = Math.min(Math.max(Number(args.topN) || 8, 1), 30);
      const r = await query(`
        SELECT f.name_cn, f.name_en, f.is_nobel, f.age_2026, f.academic_depth, f.ancestor_nobel, f.student_nobel,
               f.nobel_conv_rate, f.in_strong_school, f.collaborations, f.potential_score, p.death_year
        FROM features f JOIN persons p ON p.person_id = f.person_id
        WHERE p.death_year IS NULL
        ORDER BY f.potential_score DESC LIMIT ${n}
      `);
      const lines = [
        '### 诺奖潜力预测（结构特征启发式）',
        '> 口径：仅统计**在世学者**，依据本体中的师承网络与人物特征打分；未叠加沃尔夫奖/拉斯克奖/引文桂冠等外部信号，属于结构性参考而非结论。',
        '',
      ];
      r.rows.forEach((x, i) => {
        const flags = [];
        if (Number(x.student_nobel) > 0) flags.push(`门下已有诺奖 ${x.student_nobel} 位`);
        if (Number(x.ancestor_nobel) > 0) flags.push(`师承先祖含诺奖 ${x.ancestor_nobel} 位`);
        if (String(x.in_strong_school) === 'True' || x.in_strong_school === true) flags.push('身处强学派');
        lines.push(`${i + 1}. **${x.name_cn}**（${x.age_2026 ? Math.trunc(x.age_2026) + ' 岁' : '—'}）潜力分 **${Number(x.potential_score).toFixed(1)}**${flags.length ? '｜' + flags.join('；') : ''}`);
      });
      return {
        text: lines.join('\n'),
        blocks: [
          { type: 'bar', title: '潜力评分', data: r.rows.map((x) => ({ label: x.name_cn, value: Number(x.potential_score) })) },
          { type: 'table', title: '特征明细', columns: ['人物', '诺奖', '学术深度', '诺奖祖先', '诺奖学生', '转化率', '潜力分'], rows: r.rows.map((x) => [x.name_cn, x.is_nobel === 'True' || x.is_nobel === true ? '是' : '否', x.academic_depth, x.ancestor_nobel, x.student_nobel, x.nobel_conv_rate, Number(x.potential_score).toFixed(1)]) },
        ],
        payload: { predictions: r.rows.map((x) => ({ name: x.name_cn, score: Number(x.potential_score), studentNobel: Number(x.student_nobel) })) },
      };
    },
  },

  /* 9. 人才流动 */
  {
    name: '人才流动分析',
    label: '人才流动',
    description: '分析师承关系中的跨国流动：导师与学生的国籍变化，识别人才流向（如欧洲培养 → 美国收获）。',
    parameters: { type: 'object', properties: {} },
    async run() {
      await loadCore();
      const r = await query(`
        SELECT s.name_zh AS stu, s.nationality AS stu_nat, a.name_zh AS adv, a.nationality AS adv_nat, s.nobel_category AS cat
        FROM mentorship m JOIN persons s ON s.person_id = m.student_id JOIN persons a ON a.person_id = m.advisor_id
      `);
      const primary = (nat) => String(nat || '').split('/').pop();
      const flows = new Map();
      const cross = [];
      for (const x of r.rows) {
        const a = primary(x.adv_nat), b = primary(x.stu_nat);
        if (!a || !b || a === b) continue;
        const k = `${a} → ${b}`;
        flows.set(k, (flows.get(k) || 0) + 1);
        cross.push(x);
      }
      const sorted = [...flows.entries()].sort((p, q) => q[1] - p[1]);
      const toUS = cross.filter((x) => primary(x.stu_nat) === '美国').length;
      const lines = [
        '### 师承网络中的人才跨国流动',
        `- 跨国师承（导师与学生学习地/国籍不同）：**${cross.length} 条**`,
        `- 其中最终流向 **美国** 的：**${toUS} 条**`,
        '',
        '**主要流向**：',
        ...sorted.slice(0, 8).map(([k, v]) => `- ${k}：${v} 条`),
        '',
        '**涉及人物**：',
        ...cross.slice(0, 10).map((x) => `- ${x.adv}（${x.adv_nat}）→ ${x.stu}（${x.stu_nat}）`),
      ];
      return {
        text: lines.join('\n'),
        blocks: [{ type: 'bar', title: '跨国流动路径', data: sorted.slice(0, 8).map(([k, v]) => ({ label: k, value: v })) }],
        payload: { crossCount: cross.length, toUS, flows: sorted.slice(0, 8) },
      };
    },
  },

  /* 10. 合作网络 */
  {
    name: '合作网络',
    label: '合作网络',
    description: '返回本体记录的合作关系（共同发表/共同攻关），与师承关系互为补充。',
    parameters: { type: 'object', properties: {} },
    async run() {
      await loadCore();
      const r = await query('SELECT * FROM collaboration');
      const rows = r.rows.map((x) => [nameOf(x.person_a_id), nameOf(x.person_b_id), x.year ? Math.trunc(x.year) : '', x.topic || '', x.publication || '']);
      return {
        text: `### 合作关系（${rows.length} 条）\n` + rows.map((x) => `- **${x[0]}** × **${x[1]}**${x[2] ? `（${x[2]}）` : ''}：${x[3]}`).join('\n'),
        blocks: [{ type: 'table', title: '合作明细', columns: ['人物A', '人物B', '年份', '主题', '成果'], rows }],
        payload: { collaborations: r.rows.map((x) => ({ a: nameOf(x.person_a_id), b: nameOf(x.person_b_id), topic: x.topic, year: x.year })) },
      };
    },
  },

  /* 11. 研究范式 */
  {
    name: '研究范式',
    label: '研究范式',
    description: '返回本体收录的宏观研究范式及其奠基人与年代。',
    parameters: { type: 'object', properties: {} },
    async run() {
      const r = await query('SELECT * FROM paradigms');
      const lines = ['### 本体收录的研究范式', ...r.rows.map((x) => `- **${x.name}**（${x.year ? Math.trunc(x.year) : '—'}）｜奠基人：${x.founder_name || '—'}\n  ${x.description || ''}`)];
      return {
        text: lines.join('\n'),
        blocks: [{ type: 'table', title: '范式一览', columns: ['范式', '年代', '奠基人', '说明'], rows: r.rows.map((x) => [x.name, x.year ? Math.trunc(x.year) : '', x.founder_name || '', x.description || '']) }],
        payload: { paradigms: r.rows },
      };
    },
  },

  /* 12. 研究方向 */
  {
    name: '研究方向查询',
    label: '研究方向',
    description: '查询研究方向（学科树）。给 field 返回该方向的人物与代表性工作；不给则返回方向总览。',
    parameters: { type: 'object', properties: { field: { type: 'string', description: '方向名称，如 光遗传学、量子力学、不对称催化与手性化学' } } },
    async run(args) {
      await loadCore();
      const name = String(args.field || '').trim();
      if (!name) {
        const r = await query('SELECT field_id, name_zh, parent_id, level, discipline FROM fields ORDER BY field_id');
        const byDisc = {};
        r.rows.forEach((x) => { (byDisc[x.discipline] = byDisc[x.discipline] || []).push(x); });
        const lines = ['### 研究方向总览'];
        Object.entries(byDisc).forEach(([d, arr]) => {
          lines.push(`**${d}**（${arr.length} 个）`);
          arr.forEach((x) => lines.push(`- ${'　'.repeat((x.level || 1) - 1)}${x.name_zh}`));
        });
        return { text: lines.join('\n'), payload: { fields: r.rows } };
      }
      const esc = name.replace(/'/g, "''");
      const fr = await query(`SELECT * FROM fields WHERE name_zh LIKE '%${esc}%' OR name_en LIKE '%${esc}%'`);
      if (!fr.rows.length) return { text: `未找到研究方向「${name}」。`, payload: { error: 'not_found' } };
      const f = fr.rows[0];
      const pr = await query(`SELECT p.name_zh, p.is_nobel_laureate, p.nobel_year, p.nobel_category FROM person_field pf JOIN persons p ON p.person_id = pf.person_id WHERE pf.field_id = '${f.field_id}'`);
      const wr = await query(`SELECT w.name_zh, w.year FROM works w WHERE w.field_id = '${f.field_id}' ORDER BY w.year`);
      const lines = [`### ${f.name_zh}（${f.name_en}）`, `所属门类：${f.discipline}｜层级：第 ${f.level} 层`, f.description ? `说明：${f.description}` : ''];
      if (pr.rows.length) { lines.push('', `**相关学者（${pr.rows.length} 位）**：`); pr.rows.forEach((x) => lines.push(`- ${x.name_zh}${x.is_nobel_laureate === '是' ? `（${Math.trunc(x.nobel_year)} ${x.nobel_category}奖）` : ''}`)); }
      if (wr.rows.length) { lines.push('', `**代表性工作（${wr.rows.length} 项）**：`); wr.rows.forEach((x) => lines.push(`- ${x.year ? Math.trunc(x.year) + '：' : ''}${x.name_zh}`)); }
      return {
        text: lines.join('\n'),
        blocks: [
          pr.rows.length ? { type: 'table', title: '学者', columns: ['人物', '诺奖'], rows: pr.rows.map((x) => [x.name_zh, x.is_nobel_laureate === '是' ? `${Math.trunc(x.nobel_year)} ${x.nobel_category}` : '']) } : null,
          wr.rows.length ? { type: 'table', title: '代表性工作', columns: ['年份', '工作'], rows: wr.rows.map((x) => [x.year ? Math.trunc(x.year) : '', x.name_zh]) } : null,
        ].filter(Boolean),
        payload: { field: f.name_zh, people: pr.rows.map((x) => x.name_zh), works: wr.rows.map((x) => x.name_zh) },
      };
    },
  },

  /* 13. 全量诺奖得主名录（v3.0 新增，覆盖1901-2026学术四奖763+人） */
  {
    name: '诺奖得主名录',
    label: '诺奖得主',
    description: '查询诺奖得主名录。可按年份/学科/关键词过滤。本体收录六大奖项（物理/化学/生理医学/经济/文学/和平）共 2000+ 位得主。',
    parameters: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: '年份，如1921、2024' },
        category: { type: 'string', description: '学科：物理学 / 化学 / 生理学或医学 / 经济学 / 文学奖 / 和平奖（可选）' },
        keyword: { type: 'string', description: '姓名关键词（中英文均可，可选）' },
        limit: { type: 'integer', description: '返回条数，默认20' },
      },
    },
    async run(args) {
      const year = args.year ? Math.trunc(args.year) : null;
      const cat = String(args.category || '').trim();
      const kw = String(args.keyword || '').trim();
      const lim = Math.max(1, Math.min(200, args.limit ? Math.trunc(args.limit) : 20));
      await loadCore();
      // 奖项统计（用离线预展开的 laureates_split 表替代 DuckDB UNNEST）
      if (!year && !cat && !kw) {
        const stat = await query(`
          SELECT category, COUNT(*) AS cnt, MIN(yr) AS first_year, MAX(yr) AS last_year
          FROM laureates_split
          GROUP BY category ORDER BY category`);
        const tot = await query("SELECT count(*) AS c FROM laureates");
        const core = await query("SELECT count(*) AS c FROM laureates WHERE in_core_network='是'");
        const lines = [`### 诺奖得主全量名录\n本体收录**六大奖项**（物理/化学/生理医学/经济/文学/和平）：` +
            `**${tot.rows[0].c} 位**得主（其中 ${core.rows[0].c} 位在高价值师承子图内）。\n`];
        lines.push('**按学科分布**：');
        stat.rows.forEach((r) => lines.push(`- **${r.category}**：${r.cnt} 人（${r.first_year}–${r.last_year}）`));
        lines.push('\n> 提示：可按年份/学科/姓名检索，如「2024年物理奖」「爱因斯坦」「华人诺奖」。');
        return {
          text: lines.join('\n'),
          blocks: [{ type: 'bar', title: '各学科诺奖得主数', data: stat.rows.map((r) => ({ label: r.category, value: Number(r.cnt) })) }],
          payload: { total: Number(tot.rows[0].c), core: Number(core.rows[0].c), stats: stat.rows },
        };
      }
      // 年份查询（用离线预展开的 prize_laureates 表替代 DuckDB UNNEST + LIST）
      if (year) {
        const catsql = cat ? ` AND pl.category='${cat.replace(/'/g,"''")}'` : " AND pl.category IN ('物理学','化学','生理学或医学','经济学','文学奖','和平奖')";
        const yrsql = `
          SELECT pl.year AS yr, pl.category, pl.share_note, pl.motivation,
                 COALESCE(p.name_zh, p.name_en) AS name, p.name_en AS name_en
          FROM prize_laureates pl
          LEFT JOIN persons p ON p.person_id = pl.pid
          WHERE pl.year = ${year} ${catsql}
          ORDER BY pl.category, p.name_en`;
        const yr = await query(yrsql);
        if (!yr.rows.length) return { text: `${year} 年${cat || '学术奖项'}没有颁奖记录。`, payload: { year, category: cat } };
        // 按 (category, share_note, motivation) 聚合成人类可读的分组
        const groups = new Map();
        yr.rows.forEach((r) => {
          const k = `${r.category}|${r.share_note||''}|${r.motivation||''}`;
          if (!groups.has(k)) groups.set(k, { category: r.category, share_note: r.share_note, motivation: r.motivation, year: r.yr, names: [] });
          if (r.name) groups.get(k).names.push(r.name);
        });
        const aggRows = [...groups.values()];
        const lines = [`### ${year} 年诺贝尔奖（学术奖项）`];
        const blocks=[];
        aggRows.forEach((g) => {
          const namesStr = g.names.join('、');
          lines.push(`\n**${g.category}**（${g.share_note||''}）——${namesStr}`);
          if (g.motivation) lines.push(`> ${g.motivation}`);
          blocks.push({ type: 'card', title: `${year}·${g.category}`, content: namesStr, meta: g.share_note });
        });
        return { text: lines.join('\n'), blocks, payload: { year, items: aggRows } };
      }
      // 关键词
      if (kw) {
        const catsql = cat ? ` AND nobel_categories LIKE '%${cat.replace(/'/g,"''")}%'` : '';
        const kr = await query(`SELECT laureate_pid, name_en, COALESCE(name_zh,'') AS name_zh, gender, birth_year, death_year, nationality, nobel_years, nobel_categories, in_core_network FROM laureates WHERE (lower(name_en) LIKE lower('%${kw.replace(/'/g,"''")}%') OR name_zh LIKE '%${kw.replace(/'/g,"''")}%' OR nationality LIKE '%${kw.replace(/'/g,"''")}%')${catsql} ORDER BY birth_year NULLS LAST LIMIT ${lim}`);
        if (!kr.rows.length) return { text: `未找到匹配「${kw}」${cat ? '（'+cat+'）' : ''}的诺奖得主。`, payload: { keyword: kw, category: cat } };
        const lines = [`### 诺奖得主搜索：「${kw}」${cat ? '（'+cat+'）' : ''}\n共找到 ${kr.rows.length} 位：`];
        kr.rows.forEach((r) => {
          const life = r.death_year ? `${r.birth_year}–${r.death_year}` : (r.birth_year ? `${r.birth_year}–` : '');
          const net = r.in_core_network === '是' ? ' · ⭐师承子图' : '';
          lines.push(`- **${r.name_zh || r.name_en}**（${r.name_en}${life ? '，'+life : ''}${r.nationality ? '，'+r.nationality : ''}）——${r.nobel_years}年 ${r.nobel_categories.split(';').join('/')}${net}`);
        });
        return {
          text: lines.join('\n'),
          blocks: [{ type: 'table', title: '搜索结果', columns: ['姓名(中)', '姓名(英)', '生卒', '国籍', '获奖年', '学科'], rows: kr.rows.map((r) => [r.name_zh || '—', r.name_en, `${r.birth_year||''}–${r.death_year||''}`, r.nationality||'', r.nobel_years, r.nobel_categories.split(';').join('/')]) }],
          payload: { keyword: kw, category: cat, items: kr.rows },
        };
      }
      // 只有学科
      const cr = await query(`SELECT * FROM laureates WHERE nobel_categories LIKE '%${cat.replace(/'/g,"''")}%' ORDER BY CAST(nobel_years AS INTEGER) DESC LIMIT ${lim}`);
      const lines = [`### ${cat}诺奖得主（最近 ${lim} 位）`];
      cr.rows.forEach((r) => {
        const life = r.death_year ? `${r.birth_year}–${r.death_year}` : (r.birth_year ? `${r.birth_year}–` : '');
        lines.push(`- ${r.nobel_years}年 **${r.name_zh || r.name_en}**（${life||''}）`);
      });
      return { text: lines.join('\n'), blocks: [{ type: 'table', columns: ['年份', '姓名', '生卒'], rows: cr.rows.map((r) => [r.nobel_years, r.name_zh||r.name_en, `${r.birth_year||''}–${r.death_year||''}`]) }], payload: { category: cat, items: cr.rows } };
    },
  },

  /* 14. 数据订正记录 */
  {
    name: '数据订正记录',
    label: '订正记录',
    description: '返回本体重建过程中对原始名单的核查与订正留痕。',
    parameters: { type: 'object', properties: {} },
    async run() {
      const r = await query('SELECT * FROM corrections');
      return {
        text: `### 数据核查与订正记录（${r.rows.length} 条）\n` + r.rows.map((x) => `- **${x.target}**：\`${x.original_value}\` → \`${x.corrected_value}\`\n  _依据：${x.basis || '—'}_`).join('\n'),
        blocks: [{ type: 'table', title: '订正明细', columns: ['对象', '原值', '订正为', '依据'], rows: r.rows.map((x) => [x.target, x.original_value, x.corrected_value, x.basis || '']) }],
        payload: { corrections: r.rows },
      };
    },
  },

  /* 15. 和平奖得主（v3.1 新增） */
  {
    name: '和平奖得主',
    label: '和平奖得主',
    description: '查询诺贝尔和平奖得主与获奖机构。本体收录 141 位和平奖得主/机构（含大量政治人物，如各国总统/总理/外交官/活动家）+ 28 个获奖组织，年份 1901–2026。注意：和平奖得主没有师承关系记录。',
    parameters: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: '年份，如 1901、2009、2023（可选）' },
        country: { type: 'string', description: '国籍/组织所在国，如 美国、挪威、法国（可选）' },
        keyword: { type: 'string', description: '姓名/组织名/获奖理由关键词（中英文均可，如 Trump、Obama、联合国、红十字、人权）' },
        orgOnly: { type: 'boolean', description: '只看机构（true）或个人（false），默认 false' },
        limit: { type: 'integer', description: '返回条数，默认 30' },
      },
    },
    async run(args) {
      const year = args.year ? Math.trunc(args.year) : null;
      const country = String(args.country || '').trim();
      let kw = String(args.keyword || '').trim();
      const orgOnly = args.orgOnly === true;
      const lim = Math.max(1, Math.min(200, args.limit ? Math.trunc(args.limit) : 30));

      // 中文关键词 → 英文等价（peace_subjects / peace_orgs 主表以 name_en/acronym 为主，
      // 直接搜中文会漏掉大量真结果）
      const ZH_EN = {
        '联合国': 'united nations', '红十字': 'red cross', '红十字会': 'red cross',
        '红新月': 'red crescent', '难民': 'refugee', '联合国难民': 'unhcr', '难民署': 'unhcr',
        '人权': 'human rights', '世卫': 'who', '教科文': 'unesco', '世界卫生组织': 'who',
        '诺贝尔': 'nobel', '诺贝尔基金会': 'nobel foundation', '诺贝尔基金会': 'nobel foundation',
        '美国': 'usa', '中国': 'china', '日本': 'japan', '英国': 'uk', '德国': 'germany', '法国': 'france',
      };
      const kwAliases = [];
      if (kw) {
        for (const [zh, en] of Object.entries(ZH_EN)) {
          if (kw.includes(zh) && !kwAliases.includes(en)) kwAliases.push(en);
        }
      }
      // 用户关键词 + 英文别名，全部作为 OR 检索
      const kwAll = [];
      if (kw) kwAll.push(kw);
      for (const a of kwAliases) if (!kwAll.includes(a)) kwAll.push(a);

      // 无参数：总览统计
      if (!year && !country && !kw && !orgOnly) {
        const tot = await scalar('SELECT count(*) FROM peace_subjects');
        const indiv = await scalar("SELECT count(*) FROM peace_subjects WHERE subject_type='个人'");
        const orgN = await scalar("SELECT count(*) FROM peace_subjects WHERE subject_type='组织'");
        const yrange = await scalar("SELECT MIN(nobel_year)||'–'||MAX(nobel_year) FROM peace_subjects");
        const byCountry = await query(`SELECT country, count(*) AS n FROM peace_subjects WHERE country IS NOT NULL AND country <> '' GROUP BY country ORDER BY n DESC LIMIT 12`);
        const lastYear = await scalar('SELECT MAX(nobel_year) FROM peace_subjects');
        const recent = await query(`SELECT name_en, acronym, subject_type, nobel_year, country, motivation_en FROM peace_subjects WHERE nobel_year >= ${Math.max(1900, (lastYear||2026) - 20)} ORDER BY nobel_year DESC, name_en`);

        const lines = [
          '### 诺贝尔和平奖得主 · 全量概览',
          `- **总量**：${tot} 位（个人 ${indiv} 位 + 机构 ${orgN} 个），${yrange}`,
          `- 和平奖得主/机构**无师承关系记录**（本体中 peace_subjects 表不接 mentorship）`,
          '- 可通过年份/国籍/关键词进一步过滤',
        ];
        if (byCountry.rows.length) {
          lines.push('', '**国籍/机构所在地分布**：' + byCountry.rows.map((x) => `${x.country} ${x.n}`).join('｜'));
        }
        if (recent.rows.length) {
          lines.push('', '**近 20 年获奖情况（含政治人物）**：');
          recent.rows.slice(0, 15).forEach((x) => {
            const label = x.acronym || x.name_en;
            lines.push(`- **${Math.trunc(x.nobel_year)}**｜${x.subject_type === '组织' ? '🏛 ' : '👤 '}${label}${x.country ? '（'+x.country+'）' : ''}`);
          });
        }
        return {
          text: lines.join('\n'),
          blocks: [
            { type: 'bar', title: '国籍/机构所在地分布 Top12', data: byCountry.rows.map((x) => ({ label: x.country, value: Number(x.n) })) },
          ],
          payload: { total: tot, individuals: indiv, orgs: orgN, yrange, byCountry: byCountry.rows, recent: recent.rows.slice(0, 15) },
        };
      }

      // 构建过滤条件
      const esc = (s) => String(s).replace(/'/g, "''");
      const conds = [];
      if (year) conds.push(`nobel_year = ${year}`);
      if (country) conds.push(`(lower(country) LIKE lower('%${esc(country)}%'))`);
      if (orgOnly) conds.push(`subject_type = '组织'`);
      else if (args.orgOnly === false) conds.push(`subject_type = '个人'`);
      if (kwAll.length) {
        const orParts = kwAll.map((k) => {
          const ek = esc(k);
          return `(lower(name_en) LIKE lower('%${ek}%') OR lower(acronym) LIKE lower('%${ek}%') OR lower(motivation_en) LIKE lower('%${ek}%'))`;
        });
        conds.push('(' + orParts.join(' OR ') + ')');
      }
      // 中文关键词命中时，同时并查 peace_orgs 表（28 个获奖组织）合并到结果
      let orgRows = [];
      if (kwAll.length) {
        const orgConds = kwAll.map((k) => {
          const ek = esc(k);
          return `(lower(name_en) LIKE lower('%${ek}%') OR lower(acronym) LIKE lower('%${ek}%') OR lower(name_native) LIKE lower('%${ek}%'))`;
        });
        let orgWhere = '';
        if (country) orgWhere = ` WHERE lower(founded_country) LIKE lower('%${esc(country)}%') AND ` + orgConds.join(' OR ');
        else orgWhere = ` WHERE ` + orgConds.join(' OR ');
        try {
          const orgR = await query(`SELECT org_id, name_en, name_native, acronym, founded_year, founded_country FROM peace_orgs${orgWhere} ORDER BY founded_year DESC, name_en LIMIT ${lim}`);
          orgRows = orgR.rows || [];
        } catch (e) { /* ignore */ }
      }
      const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
      const sql = `SELECT peace_id, subject_type, name_en, acronym, country, nobel_year, motivation_en
        FROM peace_subjects${where} ORDER BY nobel_year DESC, name_en LIMIT ${lim}`;
      const r = await query(sql);

      const subjects = r.rows || [];
      const orgItems = orgRows.map((o) => ({
        peace_id: o.org_id, subject_type: '机构', name_en: o.name_native || o.name_en,
        acronym: o.acronym || '', country: o.founded_country || '', nobel_year: '',
        motivation_en: '和平奖获奖组织（成立于 ' + (o.founded_year || '?') + '）',
        _org: true,
      }));
      const allRows = subjects.concat(orgItems);

      if (!allRows.length) {
        return {
          text: `未找到匹配的和平奖得主/机构。已尝试过滤：${[year?'年份 '+year:null, country?'国籍 '+country:null, kw?'关键词 '+kw:null, orgOnly?'仅机构':args.orgOnly===false?'仅个人':null].filter(Boolean).join('、') || '无'}`,
          payload: { error: 'not_found' },
        };
      }

      const titleParts = [];
      if (year) titleParts.push(year + ' 年');
      if (country) titleParts.push('国籍 ' + country);
      if (kw) titleParts.push('「' + kw + '」');
      titleParts.push(orgOnly ? '仅机构' : args.orgOnly === false ? '仅个人' : '');
      const title = `### 和平奖得主 · ${titleParts.filter(Boolean).join(' / ')}（${allRows.length} 位）`;

      const lines = [title];
      allRows.forEach((x) => {
        const label = x.acronym ? `${x.name_en}（${x.acronym}）` : x.name_en;
        const yr = x._org ? '' : (Math.trunc(x.nobel_year) + ' 年');
        lines.push(`- ${yr ? '**' + yr + '**｜' : ''}${x.subject_type === '机构' ? '🏛 ' : '👤 '}${label}${x.country ? '（'+x.country+'）' : ''}`);
        if (x.motivation_en) lines.push(`  > ${x.motivation_en}`);
      });

      return {
        text: lines.join('\n'),
        blocks: [{
          type: 'table', title: '和平奖得主明细',
          columns: ['年份', '类型', '姓名', '缩写', '国籍', '获奖理由'],
          rows: allRows.map((x) => [x._org ? '（组织）' : Math.trunc(x.nobel_year), x.subject_type, x.name_en, x.acronym || '', x.country || '', x.motivation_en || '']),
        }],
        payload: { items: allRows },
      };
    },
  },

  /* 16. 文学奖得主（v3.1 新增） */
  {
    name: '文学奖得主',
    label: '文学奖得主',
    description: '查询诺贝尔文学奖得主。本体收录 123 位文学奖得主，年份 1901–2026，字段含姓名（中/英）、性别、生卒、国籍、获奖年份、获奖理由。注意：文学奖得主没有师承关系记录。',
    parameters: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: '年份（可选）' },
        country: { type: 'string', description: '国籍（可选）' },
        gender: { type: 'string', description: '性别：male / female（可选）' },
        keyword: { type: 'string', description: '姓名/获奖理由关键词（中英文均可）' },
        limit: { type: 'integer', description: '返回条数，默认 30' },
      },
    },
    async run(args) {
      const year = args.year ? Math.trunc(args.year) : null;
      const country = String(args.country || '').trim();
      const gender = String(args.gender || '').trim();
      const kw = String(args.keyword || '').trim();
      const lim = Math.max(1, Math.min(200, args.limit ? Math.trunc(args.limit) : 30));

      // 无参数：总览
      if (!year && !country && !gender && !kw) {
        const tot = await scalar('SELECT count(*) FROM writers');
        const yrange = await scalar("SELECT MIN(nobel_year)||'–'||MAX(nobel_year) FROM writers");
        const byCountry = await query(`SELECT country, count(*) AS n FROM writers WHERE country IS NOT NULL AND country <> '' GROUP BY country ORDER BY n DESC LIMIT 12`);
        const byGender = await query(`SELECT gender, count(*) AS n FROM writers GROUP BY gender ORDER BY n DESC`);
        const recent = await query(`SELECT name_en, name_native, gender, nobel_year, country, motivation_en FROM writers ORDER BY nobel_year DESC LIMIT 10`);

        const lines = [
          '### 诺贝尔文学奖得主 · 全量概览',
          `- **总量**：${tot} 位（${yrange}）`,
          `- 文学奖得主**无师承关系记录**（writers 表不接 mentorship）`,
        ];
        if (byGender.rows.length) lines.push('', '**性别分布**：' + byGender.rows.map((x) => `${x.gender} ${x.n}`).join('｜'));
        if (byCountry.rows.length) lines.push('', '**国籍分布**：' + byCountry.rows.map((x) => `${x.country} ${x.n}`).join('｜'));
        if (recent.rows.length) {
          lines.push('', '**近 10 位**：');
          recent.rows.forEach((x) => {
            const yr = Math.trunc(x.nobel_year);
            lines.push(`- **${yr}**｜${x.name_native || x.name_en}${x.country ? '（'+x.country+'）' : ''}`);
          });
        }
        return {
          text: lines.join('\n'),
          blocks: [
            { type: 'bar', title: '国籍分布 Top12', data: byCountry.rows.map((x) => ({ label: x.country, value: Number(x.n) })) },
          ],
          payload: { total: tot, yrange, byCountry: byCountry.rows, byGender: byGender.rows, recent: recent.rows },
        };
      }

      const esc = (s) => String(s).replace(/'/g, "''");
      // 中文性别 → 英文（writers 表 gender 值是 male/female）
      const gMap = {'男':'male','女':'female','男性':'male','女性':'female','woman':'female','men':'male','women':'female'};
      const genderEn = gMap[gender] || gender;
      const conds = [];
      if (year) conds.push(`nobel_year = ${year}`);
      if (country) conds.push(`(lower(country) LIKE lower('%${esc(country)}%'))`);
      if (genderEn) conds.push(`lower(gender) = '${esc(genderEn).toLowerCase()}'`);
      if (kw) {
        const k = esc(kw);
        conds.push(`(lower(name_en) LIKE lower('%${k}%') OR (name_native LIKE '%${k}%') OR motivation_en LIKE '%${k}%')`);
      }
      const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
      const r = await query(`SELECT writer_id, name_en, name_native, gender, birth_year, death_year, country, nobel_year, motivation_en
        FROM writers${where} ORDER BY nobel_year DESC, name_en LIMIT ${lim}`);

      if (!r.rows.length) return { text: `未找到匹配的文学奖得主。`, payload: { error: 'not_found' } };

      const titleParts = [year?''+year+' 年':null, country?'国籍 '+country:null, gender?'性别 '+gender:null, kw?'「'+kw+'」':null].filter(Boolean);
      const lines = [`### 诺贝尔文学奖得主 · ${titleParts.join(' / ')}（${r.rows.length} 位）`];
      r.rows.forEach((x) => {
        const yr = Math.trunc(x.nobel_year);
        const life = `${Math.trunc(x.birth_year||'')}–${Math.trunc(x.death_year||'')}`;
        lines.push(`- **${yr}**｜${x.name_native || x.name_en}${x.country ? '（'+x.country+'）' : ''}${life ? ' · '+life : ''}`);
        if (x.motivation_en) lines.push(`  > ${x.motivation_en}`);
      });
      return {
        text: lines.join('\n'),
        blocks: [{
          type: 'table', title: '文学奖得主明细',
          columns: ['年份', '姓名(英)', '姓名(原语)', '国籍', '生卒', '获奖理由'],
          rows: r.rows.map((x) => [Math.trunc(x.nobel_year), x.name_en, x.name_native || '', x.country || '', `${Math.trunc(x.birth_year||'')}–${Math.trunc(x.death_year||'')}`, x.motivation_en || '']),
        }],
        payload: { items: r.rows },
      };
    },
  },

  /* 17. 和平奖组织（v3.1 新增） */
  {
    name: '和平奖组织',
    label: '和平奖组织',
    description: '查询诺贝尔和平奖授予的机构/组织。本体收录 28 个获奖组织（如红十字会、联合国相关机构、国际组织等），含成立时间与来源国。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '组织名/缩写关键词（中英文均可，如 UN、红十字会、UNHCR）' },
        country: { type: 'string', description: '来源国' },
        foundedBefore: { type: 'integer', description: '成立年份上限，如 1950' },
        foundedAfter: { type: 'integer', description: '成立年份下限，如 1990' },
      },
    },
    async run(args) {
      let kw = String(args.keyword || '').trim();
      const country = String(args.country || '').trim();
      const fb = args.foundedBefore ? Math.trunc(args.foundedBefore) : null;
      const fa = args.foundedAfter ? Math.trunc(args.foundedAfter) : null;
      const esc = (s) => String(s).replace(/'/g, "''");
      // 中文关键词 → 英文（peace_orgs 主表 name_en/acronym 都是英文）
      const ZH_EN = {
        '联合国': 'united nations', '红十字': 'red cross', '红十字会': 'red cross',
        '红新月': 'red crescent', '难民': 'refugee', '联合国难民': 'unhcr', '难民署': 'unhcr',
        '教科文': 'unesco', '世卫': 'who', '世界卫生组织': 'who',
        '诺贝尔': 'nobel', '诺贝尔基金会': 'nobel foundation',
      };
      const kwAll = [];
      if (kw) {
        kwAll.push(kw);
        for (const [zh, en] of Object.entries(ZH_EN)) {
          if (kw.includes(zh) && !kwAll.includes(en)) kwAll.push(en);
        }
      }
      const conds = [];
      if (kwAll.length) {
        const orParts = kwAll.map((k) => `(lower(name_en) LIKE lower('%${esc(k)}%') OR lower(acronym) LIKE lower('%${esc(k)}%') OR lower(name_native) LIKE lower('%${esc(k)}%'))`);
        conds.push('(' + orParts.join(' OR ') + ')');
      }
      if (country) conds.push(`lower(founded_country) LIKE lower('%${esc(country)}%')`);
      if (fb) conds.push(`founded_year <= ${fb}`);
      if (fa) conds.push(`founded_year >= ${fa}`);
      const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
      const r = await query(`SELECT org_id, name_en, name_native, acronym, founded_year, founded_country FROM peace_orgs${where} ORDER BY founded_year DESC, name_en`);

      if (!r.rows.length) return { text: `未找到匹配的和平奖获奖组织。`, payload: { error: 'not_found' } };

      const lines = [`### 诺贝尔和平奖获奖组织（${r.rows.length} 个）`];
      r.rows.forEach((x) => {
        const fy = x.founded_year ? Math.trunc(x.founded_year) : '—';
        const name = x.acronym ? `${x.name_en}（${x.acronym}）` : x.name_en;
        lines.push(`- **${name}**${x.founded_country ? '｜'+x.founded_country : ''}｜创立于 ${fy}`);
      });
      return {
        text: lines.join('\n'),
        blocks: [{ type: 'table', title: '获奖组织', columns: ['组织', '缩写', '来源国', '成立年'], rows: r.rows.map((x) => [x.name_en, x.acronym || '', x.founded_country || '', x.founded_year ? Math.trunc(x.founded_year) : '']) }],
        payload: { items: r.rows },
      };
    },
  },
];

function decadeBuckets(years) {
  const m = new Map();
  years.forEach((y) => {
    if (!y) return;
    const d = Math.floor(Number(y) / 10) * 10;
    m.set(d, (m.get(d) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ label: `${k}s`, value: v }));
}

/* ------------------------- 查找与导出 ------------------------- */

export function getTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

/** 给大模型用的 function 定义 */
export function toolsForLLM() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } },
  }));
}

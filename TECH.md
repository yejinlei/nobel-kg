# 📗 技术文档 —— Nobel KG

本文档说明本体模型、系统架构、关键技术决策与扩展边界。

---

## 一、本体论模型（Ontology）

### 1. 顶层结构

本体采用 **实体—关系** 两层模型，共 5 类实体 + 8 类关系。所有实体带业务 ID、所有关系带类型与核验状态。

```
实体层 (Entity)
├── 人物 (persons)              ← P###，全部人物（含名录层与师承层）
├── 诺奖得主名录 (laureates)    ← L### 视图以 person_id 关联，学术四奖 765 位
├── 机构 (institutions)        ← I###
├── 研究方向 (fields)           ← F###，三级树形（parent_id 自指向）
├── 代表性工作 (works)          ← W###
├── 诺贝尔奖 (prizes)           ← NP年份[_门类]
├── 论文著作 (papers)           ← PA###
├── 学派 (schools)              ← S##
└── 研究范式 (paradigms)        ← P_英文

关系层 (Relation)
├── 师承关系 (mentorship)       ← 博士/博士后/研究导师/家族传承 四分类
├── 家族关系 (family)           ← 父子/母女/夫妻/兄弟
├── 论文师承 (paper_lineage)    ← 论文→论文的思想传承（范式拓展/继承发展/方法应用/理论反驳）
├── 合作关系 (collaboration)    ← 人物↔人物关键合作
├── 人物机构 (person_institution)  ← 任职/求学/博士后
├── 人物方向 (person_field)     ← 主/副研究方向
├── 人物工作 (person_work)      ← 角色（独立完成/共同一作/通讯/创立者）
├── 论文作者 (paper_author)     ← 署名角色 + 作者顺序
└── 人物学派 (person_school)    ← 奠基人/成员/第二代/学术带头人/转化者等角色
```

### 2. 为什么"师承关系"是一等实体

在图数据库里最直接的做法是用一条边。但本项目要承载：
- 师承类型（博士导师 vs 博士后 vs 研究导师 vs 家族传承），语义差异显著；
- 是否博士阶段（`is_phd`）；
- 开始年份、所在机构；
- 核验状态（已核实 / 待核实 / 存疑）与来源/备注。

这些属性在 RDF 里用 **reification（具体化）** 表达、在 DuckDB 里用**关系表 + 元组级属性**表达。

### 3. 领域层（受控词表）

- `gender ∈ {M,F}`
- `is_nobel_laureate ∈ {是,否}`
- `relation_type ∈ {博士导师,博士后导师,研究导师,家族传承}`
- `influence_type ∈ {继承发展,范式拓展,方法应用,理论反驳}`
- `verification_status ∈ {已验证,已核实,存疑,待核实}`

### 4. 与 RDF/OWL 的对应

`03_本体论规范/诺奖师承本体_TBox.ttl` 定义类与属性：

```turtle
:Person a owl:Class .
:NobelLaureate rdfs:subClassOf :Person .
:Institution/:Field/:Work/:Paper/:School/:Paradigm a owl:Class .

:mentoredBy a owl:ObjectProperty ; rdfs:domain :Person ; rdfs:range :Person .
:authored :Person → :Paper ; :belongsToSchool :Person → :School ;
:fieldOfWork :Person → :Field ; :publishedAt :Person → :Institution .
```

`诺奖师承知识图谱_ABox.ttl` 放实例三元组（约 4000+ 条）。两者可用 Protégé 打开、或用 rdflib/Jena 推理。

---

## 二、系统架构

```
┌────────────────────────────────────────────────────────┐
│                    浏览器 (用户侧)                        │
│                                                        │
│  ┌────────────────────────────────────────────────┐    │
│  │              index.html / viz/*.html           │    │
│  │  (无数据、只含 DOM + ESM import + CSS)         │    │
│  └─────────────┬──────────────────────────────────┘    │
│                │                                       │
│  ┌─────────────▼──────────────────────────────────┐    │
│  │               main.js 界面控制器                │    │
│  │  (事件 → Agent → 渲染 Markdown/SVG/表格/iframe) │    │
│  └──┬───────┬─────────┬─────────┬─────────┬───────┘    │
│     │       │         │         │         │            │
│ ┌───▼──┐ ┌──▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼────┐      │
│ │config│ │render│ │router │ │ wiki  │ │ agent  │      │
│ │Key存 │ │Mark- │ │关键词│ │维基 + │ │LangGr- │      │
│ │储    │ │down/ │ │路由  │ │Wiki- │ │aph.js  │      │
│ │      │ │SVG   │ │本地  │ │data  │ │状态图  │      │
│ └───┬──┘ └──────┘ └──┬───┘ └───┬───┘ └───┬────┘      │
│     │                │         │         │            │
│     └────────────────┴────┬────┴─────────┘            │
│                           ▼                           │
│                  ┌────────────────┐                   │
│                  │    tools.js    │  12+ SQL 白名单    │
│                  │  (不给模型裸SQL)│                   │
│                  └───────┬────────┘                   │
│                          ▼                            │
│                  ┌────────────────┐                   │
│                  │     db.js      │ DuckDB-WASM       │
│                  │  本地 SQL 引擎 │  + Parquet        │
│                  └───────┬────────┘                   │
│                          ▼                            │
│                  data/*.parquet + manifest.json       │
│                  (同源静态文件，首次加载后浏览器缓存)     │
└────────────────────────────────────────────────────────┘
           │                           │
           ▼                           ▼
  OpenAI 兼容 API             维基百科 / Wikidata
  (用户自带 Key,直连)          (零 Key，origin=*)
```

### 关键决策

**1. 零后端**：没有任何 Node/Python 服务端。GitHub Pages 只能托管静态文件，我们也确实不需要服务器——DuckDB-WASM 在浏览器里执行 SQL，LangGraph.js 在浏览器里跑状态机。

**2. 单一数据源 Parquet**：
- 19 张 parquet 由 `rebuild_all.py` 一键从 CSV 导出；
- DuckDB-WASM 启动后 `CREATE TABLE t AS SELECT * FROM 't.parquet'` 建表；
- 站点 db.js 和三张 viz 页都读同一份 Parquet，**不再有"页面数据过期"问题**。

**3. Key 只在访问者本地**：
- 用户在 ⚙️ 里输入 baseUrl/model/apiKey，存入 `localStorage`；
- 请求直接从浏览器发往用户配置的端点（推荐 OpenRouter，它官方支持 CORS）；
- 站点代码不内置任何 Key。

**4. 模型不写裸 SQL**：
- 所有数据库访问都封装成工具函数（查师承链、人物画像、导师排名、论文时滞等）；
- 模型只负责"选哪个工具 + 传什么参数"，返回的是结构化结果；
- 工具结果再由 compose 阶段组织成文，避免 SQL 注入与幻觉。

**5. 未配置 Key 时仍可用**：
- `router.js` 提供本地关键词规则引擎，覆盖 13 类最常见问法；
- 深度研究开关默认关闭，但若未配 Tavily Key，可自动退到维基百科/Wikidata（`origin=*` 原生支持浏览器跨域）。

---

## 三、LangGraph.js 状态图设计

```
            ┌──────┐
            │start │
            └──┬───┘
               ▼
         ┌───────────┐  本地可答  ┌────────┐
         │  classify ├──────────▶│ compose│──▶ end
         └─────┬─────┘           └────────┘
               │ 需要工具
               ▼
           ┌───────┐
           │ plan  │  (LLM 选工具+参数)
           └───┬───┘
               ▼
           ┌───────┐
           │  act  │  ToolNode 执行工具
           └───┬───┘
               ▼
        ┌───条件边───┐  仍需调工具 → plan
        │ 结果足够?  │  结果已完整 → compose
        └────────────┘
```

- 每一轮循环记录到 `state.traces`，前端渲染成可折叠面板让用户看到"Agent 做了什么"；
- compose 阶段如果开启了深度研究，会并行调用 wiki.js 检索人物/方向最新事实，再把本体结果+维基事实合并成文。

---

## 四、DuckDB-WASM 初始化细节

- 使用 **mvp 单线程 WASM** 包，规避 GitHub Pages 无法下发 `COOP/COEP` 响应头导致 SharedArrayBuffer 不可用的问题；
- WASM 文件全部本地托管（`lib/duckdb/`），不走 CDN，首次加载约 10-15MB（后续走浏览器缓存）；
- Parquet 使用相对路径 + `new URL(name, document.baseURI)` 解析，所以部署到 `https://<user>.github.io/<repo>/` 子路径也能工作；
- 表名全部使用 DuckDB 中文引用 `"人物"`/`"师承关系"`，前端通过别名映射到英文 parquet 文件名（`persons`/`mentorship`）。

---

## 五、可视化页三张图谱的统一数据源

三张 viz 页（师承关系图谱、师承关系拓扑图含代表作、论文层与合著网络）以前是一次性生成的内嵌数据页面，数据改了 HTML 就过期。

改造后：**HTML 仅含渲染逻辑**，加载时通过 DuckDB-WASM 查询 parquet：
```sql
-- 师承关系图数据
SELECT p.person_id, p.name_zh, p.name_en, p.is_nobel_laureate,
       p.primary_field_id, f.discipline, f.level,
       m.advisor_id, m.relation_type
FROM mentorship m
JOIN persons p ON p.person_id = m.student_id
LEFT JOIN fields f ON f.field_id = p.primary_field_id;
```
这意味着：**新增人物/师承后，三张图自动更新，不必重写 HTML**。

---

## 六、潜在扩展点

| 方向 | 实现成本 | 价值 |
|---|---|---|
| 补全经济学奖（约 96 位 / 55 条师承） | 中 | 拓展到第 4 个学术门类，覆盖"757 位学术四奖得主" |
| 接入 Mathematics Genealogy Project / NeuroTree 谱系 | 高 | 师承深度从 6 代扩展到数十代 |
| 加沃尔夫/拉斯克/突破奖前置信号 | 中 | 显著提升潜力预测准确性 |
| 补 Citation 边（论文引用论文） | 中 | 构建完整的学术影响图 |
| Cypher/SPARQL 查询终端 | 低 | 给高级用户的查询界面 |
| 多语言切换（中/英） | 低 | 国际化 |

---

## 七、不做什么

- **不服务端代理**：破坏零后端原则。Key 必须由用户提供并只在本地保存；
- **不让模型写 SQL**：注入和幻觉风险不可控，白名单工具已足够；
- **不把所有 990 位诺奖得主一次性塞进来**：大部分得主没有可验证师承，进来都是孤立节点，反而降低图密度。走"有师承才收录"的边界，宁缺毋滥。

---

## 八、依赖清单（静态站点内的）

| 资源 | 版本来源 | 本地化位置 | 用途 |
|---|---|---|---|
| DuckDB-WASM | @duckdb/duckdb-wasm（mvp+eh bundles） | `lib/duckdb.bundle.js` + `lib/duckdb/` | 浏览器 SQL 引擎 |
| LangGraph.js | @langchain/langgraph 打包 | `lib/langgraph.bundle.js` | Agent 状态图 |
| ECharts | vendors 本地拷贝 | `lib/vendors/echarts.min.js` | 图谱页可视化 |
| D3.js | vendors 本地拷贝 | `lib/vendors/d3.min.js` | 力导向布局 |
| Tailwind (Play CDN) | CDN（仅 CSS） | HTML 内联 | 样式 |
| Marked.js | CDN | HTML 内联 | Markdown 渲染（可替换为本地） |

注意：Tailwind Play CDN 是为了开发时快速调试，生产可替换为 Tailwind CLI 构建的本地 CSS。

---

## 九、CORS 与浏览器限制

这是纯静态站最容易踩的坑：

- **OpenAI 官方 api.openai.com 不支持浏览器直连**（OPTIONS 预检被 Cloudflare 403）。不要把它作为默认；
- **OpenRouter 官方支持浏览器直连**，是默认推荐的服务商；
- 国内兼容网关（硅基流动/DeepSeek等）多数支持 CORS，但需要逐个实测；
- DuckDuckGo HTML 搜索**返回不了 CORS 头**，无法浏览器直连，所以检索能力走 Tavily（需 Key）+ 维基（零 Key）两条路；
- `python3 -m http.server` 是同源，所有静态资源无 CORS 问题。

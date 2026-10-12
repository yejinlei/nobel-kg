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

### 4.1 非阻塞启动（关键设计）

DuckDB WASM（`duckdb-mvp.wasm` 约 40MB）与 33 张 Parquet（合计约 430KB）如果放在页面主启动路径上，会阻断 UI 数百毫秒到数十秒。**改造后的启动策略**：

```
boot()
  ├─ renderWelcomeExtras / fillSettingsForm / bindEvents / updateModeUI
  │    └─ 立即完成，不依赖 DB
  ├─ 遮罩默认隐藏（.loadingOverlay 立即加 .hidden）
  └─ initDB(...) 后台启动（fire-and-forget）
       ├─ 幂等锁：并发调用共享同一 Promise；失败自动释放锁
       └─ 进度实时同步给侧栏状态灯 + 欢迎语下方提示

send() 首次提问
  ├─ isReady() = true  → 直接查询
  └─ isReady() = false → await ensureReady(90s 超时)
       等待期间在聊天流里显示"WASM 首次加载中"占位消息
       进度实时更新到占位消息的 waitHint 节点
```

**用户可见行为**：打开页面 → 侧栏/图谱入口/设置/欢迎语**立刻可用**；点任意图谱 → 无感切换；点发送 → 若 WASM 已下载完毕则秒回，否则显示一次简短等待（后续访问无感）。

### 4.2 双层缓存

| 层级 | 范围 | 生命周期 | 说明 |
|---|---|---|---|
| `Cache Storage` (`nobel-kg-v1`) | manifest + Parquet + Worker 字节 | 长期（除非用户主动清理） | 由 `cachedFetch()` 拦截，命中即返回，未命中回退 `fetch` 并写入缓存 |
| 浏览器磁盘缓存 | DuckDB WASM 大文件 | 由 CDN/HTTP 缓存头决定 | GitHub Pages 默认给长 TTL |

失败静默降级：任何缓存读写异常都回退到原生 `fetch`，不影响主流程。

### 4.3 失败与重试

- `initDB()` 内部任何一步抛错 → 释放 `initPromise` 锁；
- 若此时有用户挂在 `ensureReady()`，会收到 reject（带用户友好错误文案），不会永久卡死；
- 90 秒超时兜底：无论 WASM 何时下载完毕，等待中的请求都会在 90s 内 reject，避免用户无限等待。
- WASM 文件全部本地托管（`lib/duckdb/`），不走 CDN，首次加载约 10-15MB（后续走浏览器缓存）；
- Parquet 使用相对路径 + `new URL(name, document.baseURI)` 解析，所以部署到 `https://<user>.github.io/<repo>/` 子路径也能工作；
- 表名全部使用 DuckDB 中文引用 `"人物"`/`"师承关系"`，前端通过别名映射到英文 parquet 文件名（`persons`/`mentorship`）。

---

## 五、可视化页数据策略

`viz/` 下的 8 张独立可视化页（和平奖领域与组织图谱、论文层与合著网络、诺奖年谱、诺奖时光机、师承关系拓扑图_含代表作、师承六度挑战、文学奖作品与传承图谱、学术星座图）**采用数据内嵌方案**：所有图表数据直接写在 HTML 里，页面是纯静态、双击可开、零依赖。

- **优点**：加载快、无跨域问题、可独立分发给外部查看者；
- **代价**：数据变化时需要同步更新 HTML；
- **数据同步**：这些页的数据来自 CSV 本体层的一次性导出快照，`rebuild_all.py` 目前**不会**自动生成 viz HTML；如需更新，请对照 CSV 手动 patch。

主页 `index.html` 的 Agent 问答则相反：走 DuckDB-WASM + Parquet，数据始终与 CSV 同步。

**取舍原因**：viz 页是"静态展示"场景，追求零依赖与分享便利；主页 Agent 是"数据查询"场景，追求单一数据源与 SQL 表达力。两者数据虽同源，但更新节奏不同。

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

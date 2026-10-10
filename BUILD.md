# 📘 构建文档 —— Nobel KG

本文档说明**如何新增数据、如何重建本体、如何迭代页面**。设计原则：**CSV 是唯一人工维护源，Parquet/DuckDB/TTL 都是派生物；HTML 只含逻辑，永不内嵌数据**。

---

## 一、数据单一来源（SSOT）

```
L0 (人工维护)   01_本体论数据_CSV/*.csv     ← 只改这里
       │
       │  python3 06_构建脚本/rebuild_all.py
       ▼
L1 (派生物)     02_DuckDB数据库/nobel_ontology.duckdb  (本地分析用)
                nobel-kg/data/*.parquet                (浏览器端用)
                03_本体论规范/*.ttl                     (RDF/本体交换用)
       │
       ▼
L2 (表现层)     nobel-kg/index.html  + js/ + viz/*.html  ← 只读派生物，永不手写数据
```

### 编号规范

| 前缀 | 实体 | 位宽 | 示例 |
|---|---|---|---|
| `P` | 人物 person | 3 位数字 | `P001` 尼尔斯·玻尔 |
| `I` | 机构 institution | 3 位 | `I016` 卡文迪许实验室 |
| `F` | 研究方向 field | 3 位 | `F011` 量子力学 |
| `W` | 代表性工作 work | 3 位 | `W001` |
| `PA` | 论文 paper | 3 位 | `PA001` |
| `NP` | 诺贝尔奖 prize | 年份+可选门类后缀 | `NP1922`、`NP2026_PH` |
| `S` | 学派 school | 2 位 | `S01` 卡文迪许 |
| `P_` | 研究范式 paradigm | 英文后缀 | `P_QM`、`P_Relativity` |
| `E` | 师承边 | 3 位 | `E001` |
| `R` | 通用关系（家族/机构/方向/工作/学派/作者） | 3 位 | `R001` |
| `PI` | 论文师承 | 3 位 | `PI001` |
| `C` | 合作关系 | 3 位 | `C001` |
| `CR` | 订正记录 | 2 位 | `CR15` |

**重要**：所有 ID **一旦发布不要改动**，新条目追加使用下一个可用编号。

---

## 二、典型场景操作手册

### 场景 1：新增一位诺奖得主和他的导师

以"新增 2027 年物理奖得主 X，导师是 Y"为例：

**Step 1.** 编辑 CSV：
- `01_人物.csv`：给 X 和 Y 分配 `P###` 编号（取现有最大+1）
- `05_关系_师承.csv`：新增一条 `E###` 师承边
- 如果 Y 之前不在本体：同样加入人物表，`is_nobel_laureate=否`
- 如涉及新机构/方向/工作/论文：分别在对应 CSV 加行
- `10_诺贝尔奖.csv`：新增 `NP2027_PH` 奖项条目
- `11_数据订正记录.csv`：CR 一条说明新增依据（可选但推荐）

**Step 2.** 一键重建：
```bash
cd 诺奖师承本体与Agent项目
python3 06_构建脚本/rebuild_all.py
```
脚本会：
1. 校验数据完整性（主键/外键/得主-奖项一致性/枚举规范）；
2. 删除旧 DuckDB，重跑 `init_ontology.sql` 建库；
3. 用 networkx 重算全部 60+N 人物的中心性/PageRank/潜力评分（覆盖 18_人物特征）；
4. 导出 19 张 Parquet 到 `nobel-kg/data/`，并生成与 db.js 格式一致的 `manifest.json`；
5. 重建 TTL 本体（若 build_ttl_full.py 存在）。

**Step 3.** 浏览器硬刷新即可看到新数据（不要改 HTML）。

### 场景 2：修复一条错误的师承关系
- 直接改 `05_关系_师承.csv` 对应行；
- 在 `11_数据订正记录.csv` 追加一条 CR，写明原值/新值/依据；
- 跑 `rebuild_all.py`，**不必改任何其他文件**。

### 场景 3：新增一个查询维度（如"诺奖提名记录"）
1. 在 `01_本体论数据_CSV/` 新建一张 CSV（按已有编号规则分配文件名，如 `20_诺奖提名.csv`）；
2. 在 `02_DuckDB数据库/init_ontology.sql` 加 `CREATE TABLE 诺奖提名 (...)` + `COPY ... FROM '20_诺奖提名.csv'`；
3. 在 `06_构建脚本/rebuild_all.py` 的 `tables` 列表与 `name_map` 中加一行，输出对应 parquet；
4. 在 `js/tools.js` 里加一个新的查询工具函数；
5. 在 `js/router.js` / `js/agent.js` 加对应问法路由；
6. 跑 rebuild_all.py 即可，HTML 无需修改。

### 场景 4：新增一张可视化页
在 `nobel-kg/viz/` 下放独立 HTML。**不要把数据内嵌进 HTML**，而是通过 DuckDB-WASM 从 `../data/` 读取 Parquet（参考现有三张 viz 页的加载方式）：
```html
<script type="module">
  import * as duckdb from '../lib/duckdb.bundle.js';
  // ... 初始化后执行：SELECT * FROM 'mentorship.parquet' 等
</script>
```
新增完成后，在 `index.html` 的"图谱入口"卡片区加一张链接卡。

---

## 三、rebuild_all.py 命令行选项

```bash
python3 06_构建脚本/rebuild_all.py                 # 完整重建（校验→DuckDB→特征→Parquet→TTL）
python3 06_构建脚本/rebuild_all.py --check         # 只做数据完整性校验（最快）
python3 06_构建脚本/rebuild_all.py --no-parquet    # 不导出 Parquet
python3 06_构建脚本/rebuild_all.py --no-ttl        # 不重建 TTL
```

所有路径都基于脚本位置自动解析，**可以在任何位置执行**。

---

## 四、数据校验清单（rebuild_all.py 自动执行）

| 校验项 | 失败时表现 |
|---|---|
| 得主-奖项一致性（人物表标记为诺奖得主的，必须出现在某条奖项 laureate_ids 中） | ❌ 列出缺失人物 |
| 全部 15 类外键完整性（师承/机构/论文/学派/合作/方向/工作） | ❌ 列出悬空 ID |
| 枚举规范（gender∈{M,F}、is_nobel_laureate∈{是,否}） | ❌ 列出非法值 |

校验失败会 `sys.exit(2)`，不会产生新的数据库或 Parquet——避免坏数据上线。

外部人名占位（如贝克勒尔 BECQUER、费曼 FEYNMAN、朝永 TOMONAGA、Robert Brout）允许出现在奖项 `laureate_ids` 分号分隔串里，这些人不在本体内但共享奖项是真实情况。

---

## 五、本地开发预览

```bash
cd nobel-kg
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/
```

**零 Key 模式**：不填 API Key 直接用本地规则引擎查询；深度研究走维基百科零 Key 兜底。

**验证 Agent 链路（零 Key Mock）**：
```bash
python3 mock_server.py 8000
# 设置里填 baseUrl=http://localhost:8000/v1 model=mock apiKey=任意
```

---

## 六、部署到 GitHub Pages

1. 创建仓库 `nobel-kg`（或任意名）；
2. 将 `nobel-kg/` 目录所有内容推到 `main` 分支根目录；
3. 仓库 Settings → Pages → Source: Deploy from branch / Branch: main / Folder: / (root)；
4. 确保仓库根目录有 `.nojekyll`（已自带），否则 GitHub Pages 会跳过 `_` 开头的文件；
5. 1-2 分钟后访问 `https://<用户名>.github.io/nobel-kg/`。

---

## 七、常见问题

**Q: 我改了 CSV 但网页还是老数据？**
A: 先跑 `rebuild_all.py` 重新生成 parquet，再浏览器**硬刷新**（Ctrl+Shift+R）清除 WASM 缓存。

**Q: 我能不能不用 DuckDB，直接把数据内嵌到 JS？**
A: 不建议。本体数据有 19 张表、含递归 CTE 查询，直接内嵌会让 HTML 变成几百 KB 且失去 SQL 表达力。单一 Parquet 数据源是后续扩展性的核心。

**Q: 人物特征的潜力评分是怎么算的？**
A: `rebuild_all.py` 第 3 步用 networkx 计算中介中心性/特征向量中心性/PageRank，按 0.30/0.25/0.20/0.10/0.10/0.05 加权，仅对在世未获奖者打分（已故/已获奖=0）。这个启发式仅作演示，真实预测应加入引文数/沃尔夫奖/拉斯克奖/突破奖等外部信号。


## 六、名录层（v3.0 新增）：全量 765 位得主

`20_诺奖得主名录.csv` 是**独立于师承子图的名录层**：

- 与 `01_人物.csv` 通过 `laureate_pid = person_id` 关联；
- 学术四奖（物理/化学/生理医学/经济学），1901–2026；
- 字段：`name_en/name_zh/gender/birth_year/death_year/nationality/nobel_years/nobel_categories/in_core_network/wikidata_id/wikipedia_en/note`；
- `in_core_network='是'` 表示该人在高价值师承子图内（当前 44 位）。

### 新增字段约定

从 API 补入时：
1. 先用 API 数据 `nobelPrizes.affiliations` 回填现有人物的获奖机构；
2. 未匹配到的新得主分配新 PID（从 P062 起），统一进入 `01_人物.csv` 与 `20_诺奖得主名录.csv`；
3. `10_诺贝尔奖.csv` 按 `(year, category)` 聚合，主键 `NP<year>_<Phy|Che|Med|Eco>`；
4. 新得主默认不添加师承边（无核验数据），因此不会污染网络指标计算。

### 中文译名回填

名录层新增的 721 位得主 `name_zh` 暂空。可通过以下方式逐步补：
1. 中文维基百科查询（zh.wikipedia.org/w/api.php?action=opensearch&search=...）；
2. 已确定的译名规则：双写姓氏（如 van der Waals→范德瓦耳斯）保持历史译名一致，优先维基标准译名；
3. 批量更新时注意不要覆盖已有 `name_zh`（以免破坏已有人物的中文显示）。

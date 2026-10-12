"""
parquet → knowledge.sqlite 一次性构建脚本。

背景：浏览器端原来用 DuckDB-WASM（34 MB）加载 33 张 Parquet 表；
现在改用 SQLite-WASM（sql.js，wasm 653 KB + 库 49 KB），
但 sql.js 不能直接读 Parquet，所以本脚本把全部 parquet 合并成
单一 SQLite 文件，浏览器直接 fetch 这个 sqlite 文件即可。

用法：
    python scripts/build_sqlite.py

输出：
    data/knowledge.sqlite

关键处理：
    1. 年份列（*year*）显式转 INT64，避免查询时用 ::int 强转；
    2. 保留 NULL、中文、Unicode；
    3. 每张表加最小必要索引，方便 JOIN / 范围扫描；
    4. VACUUM 压缩文件。
"""

import json
import sqlite3
import sys
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MANIFEST = DATA / "manifest.json"
OUT = DATA / "knowledge.sqlite"

# 索引清单：{ 表名: [列名或 (列1, 列2), ...] }
# 只给真正的关联键与高频过滤列建索引，不追求全覆盖。
INDEXES = {
    "persons":            ["person_id", "nobel_year", "primary_field_id", "name_en"],
    "institutions":       ["institution_id", "name_en"],
    "fields":             ["field_id", "parent_id", "discipline"],
    "works":              ["work_id", "field_id", "year"],
    "prizes":             ["prize_id", "year", "category"],
    "papers":             ["paper_id", "year", "field_id", "work_id"],
    "mentorship":         ["student_id", "advisor_id", "edge_id", "institution_id", "start_year"],
    "family":             ["person_a_id", "person_b_id"],
    "person_institution": ["person_id", "institution_id", "start_year"],
    "person_field":       ["person_id", "field_id"],
    "person_work":        ["person_id", "work_id"],
    "paper_author":       ["paper_id", "person_id"],
    "paper_lineage":      ["student_paper_id", "advisor_paper_id"],
    "schools":            ["school_id", "founder_id"],
    "person_school":      ["person_id", "school_id"],
    "collaboration":      ["person_a_id", "person_b_id", "year"],
    "paradigms":          ["paradigm_id", "founder_id", "year"],
    "features":           ["person_id"],
    "laureates":          ["laureate_pid", "name_en"],
    "archive":            ["nobel_id", "birth_year", "founded_year"],
    "writers":            ["writer_id", "nobel_year", "name_en"],
    "literary_movements": ["movement_id"],
    "literary_genres":    ["genre_id"],
    "writer_movement":    ["writer_id", "movement_id"],
    "writer_genre":       ["writer_id", "genre_id"],
    "literary_influence": ["influenced_id", "influencer_id"],
    "peace_subjects":     ["peace_id", "nobel_year", "name_en", "org_id"],
    "peace_orgs":         ["org_id", "name_en"],
    "peace_fields":       ["cause_id"],
    "peace_field_rel":    ["peace_id", "cause_id"],
    "peace_org_rel":      ["peace_id", "org_id"],
    "wiki_summaries":     ["nobel_id", "wikidata_id"],
    "corrections":        ["target_type", "target"],
}

# 需要强制转 INT 的列：仅包含"纯年份单值列"。
# 特别说明：
#   - laureates.nobel_years 是**分号分隔字符串**（"1922" 或 "1922;1925"），
#     tools.js 会调用 .split(';')，必须是 TEXT；
#   - 其它 ID 列（person_id 等）在 parquet 里本来就是 TEXT，保留即可；
#   - 其它列一律按 parquet 原始 dtype 保留。
INT_COLUMNS = {
    "birth_year", "death_year", "nobel_year", "year", "founded_year",
    "start_year", "end_year", "era_start",
}


def convert_df(name: str, df: pd.DataFrame) -> pd.DataFrame:
    """把 pandas DataFrame 规范化。

    核心原则：尊重 parquet 原始 dtype。只有明确列入 INT_COLUMNS 的列
    才强制转 Int64；其它列保持原样，避免像 laureates.nobel_years（分号
    分隔字符串）这样语义特殊的列被误伤。
    """
    df = df.copy()
    for col in df.columns:
        if col in INT_COLUMNS:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
        else:
            # 保留原始类型：int → Int64，float → float64，其余 → object(TEXT)
            if df[col].dtype.kind in "iu":
                df[col] = df[col].astype("Int64")
            elif df[col].dtype.kind == "f":
                df[col] = df[col].astype("float64")
            else:
                df[col] = df[col].astype("object")
                df[col] = df[col].where(df[col].notna(), None)
    return df


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    names = list(manifest.keys())
    print(f"[build_sqlite] 待处理表：{len(names)} 张")

    # 内存数据库更简单；构建完再 dump 到文件，能拿到紧凑的文件格式
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode = MEMORY")
    cur.execute("PRAGMA synchronous = OFF")
    cur.execute("PRAGMA temp_store = MEMORY")

    total_rows = 0
    for i, name in enumerate(names, 1):
        pq_path = DATA / f"{name}.parquet"
        if not pq_path.exists():
            print(f"[build_sqlite] WARN  {pq_path.name} 不存在，跳过")
            continue
        tbl = pq.read_table(pq_path)
        df = tbl.to_pandas()
        df = convert_df(name, df)
        # 保证列顺序与 manifest 一致（有些 parquet 列顺序可能不同）
        cols = manifest[name].get("columns", list(df.columns))
        keep = [c for c in cols if c in df.columns]
        extra = [c for c in df.columns if c not in cols]
        keep = keep + extra
        df = df[keep]

        # to_sql 会用 pandas 默认 sqlite 后端；dtype 映射：
        #   Int64 → INTEGER（含 NULL）
        #   object → TEXT（含 NULL）
        #   float64 → REAL（含 NULL）
        df.to_sql(name, conn, if_exists="replace", index=False,
                  method="multi", chunksize=500, dtype={
                      col: ("INTEGER" if str(df[col].dtype) == "Int64"
                            else "REAL" if str(df[col].dtype) in ("float64", "float32")
                            else "TEXT")
                      for col in df.columns
                  })

        # 索引：只给关联键和高频过滤列建
        for idx in INDEXES.get(name, []):
            cols_list = idx if isinstance(idx, (list, tuple)) else [idx]
            cols_list = [c for c in cols_list if c in df.columns]
            if not cols_list:
                continue
            cols_sql = ", ".join(f'"{c}"' for c in cols_list)
            idx_name = f"ix_{name}_" + "_".join(cols_list)
            cur.execute(f'CREATE INDEX IF NOT EXISTS "{idx_name}" ON "{name}" ({cols_sql})')

        n = df.shape[0]
        total_rows += n
        print(f"[build_sqlite] {i:2d}/{len(names)}  {name:22s}  rows={n:5d}  cols={df.shape[1]}")

    conn.commit()

    # ── 预处理：为 SQLite 提供 DuckDB UNNEST 的等价表 ──────────────────
    # 原 DuckDB 查询里出现的 UNNEST(SPLIT(...)) 语法在 SQLite 里没有直接等价物。
    # 与其在浏览器端写复杂 workaround，不如在离线构建时把分隔符列展开成关系表。
    # 只有 2 处需要：
    #   1) laureates_split: 把 laureates.nobel_categories / nobel_years 按 ';' 展开
    #   2) prize_laureates: 把 prizes.laureate_ids 按 ';' 展开
    print("[build_sqlite] 构建展开表 laureates_split / prize_laureates ...")

    cur.execute("DROP TABLE IF EXISTS laureates_split")
    cur.execute("""
        CREATE TABLE laureates_split (
          pid TEXT, name_en TEXT, name_zh TEXT,
          category TEXT, yr INTEGER
        )
    """)

    rows = cur.execute(
        "SELECT laureate_pid, name_en, name_zh, nobel_categories, nobel_years FROM laureates"
    ).fetchall()
    inserted = 0
    for pid, ne, nz, cats, yrs in rows:
        if not cats or not yrs:
            continue
        cat_list = [c.strip() for c in str(cats).split(';') if c.strip()]
        yr_list = [y.strip() for y in str(yrs).split(';') if y.strip()]
        # 类别和年份必须按序号一一对应
        for i in range(min(len(cat_list), len(yr_list))):
            try:
                yr_val = int(yr_list[i])
            except ValueError:
                yr_val = None
            cur.execute(
                "INSERT INTO laureates_split(pid,name_en,name_zh,category,yr) VALUES(?,?,?,?,?)",
                (pid, ne, nz, cat_list[i], yr_val)
            )
            inserted += 1
    cur.execute("CREATE INDEX ix_laureates_split_category ON laureates_split(category)")
    cur.execute("CREATE INDEX ix_laureates_split_yr ON laureates_split(yr)")
    cur.execute("CREATE INDEX ix_laureates_split_pid ON laureates_split(pid)")
    print(f"  laureates_split: {inserted} 行")

    cur.execute("DROP TABLE IF EXISTS prize_laureates")
    cur.execute("""
        CREATE TABLE prize_laureates (
          prize_id TEXT, year INTEGER, category TEXT,
          pid TEXT, share_note TEXT, motivation TEXT
        )
    """)
    rows = cur.execute(
        "SELECT prize_id, year, category, laureate_ids, share_note, motivation FROM prizes"
    ).fetchall()
    inserted = 0
    for pid_, yr, cat, ids, share, mot in rows:
        if not ids:
            continue
        for p in [x.strip() for x in str(ids).split(';') if x.strip()]:
            cur.execute(
                "INSERT INTO prize_laureates(prize_id,year,category,pid,share_note,motivation)"
                " VALUES(?,?,?,?,?,?)",
                (pid_, yr, cat, p, share, mot)
            )
            inserted += 1
    cur.execute("CREATE INDEX ix_prize_laureates_year ON prize_laureates(year)")
    cur.execute("CREATE INDEX ix_prize_laureates_cat ON prize_laureates(category)")
    cur.execute("CREATE INDEX ix_prize_laureates_pid ON prize_laureates(pid)")
    print(f"  prize_laureates: {inserted} 行")

    conn.commit()

    # 输出到文件（dump 一次能拿到紧凑布局）
    if OUT.exists():
        OUT.unlink()
    conn.execute("VACUUM INTO ?", (str(OUT),))
    conn.close()

    size = OUT.stat().st_size
    print(f"[build_sqlite] 完成：{OUT.relative_to(ROOT)}  size={size/1024:.1f} KB  total_rows={total_rows}")


if __name__ == "__main__":
    sys.exit(main())

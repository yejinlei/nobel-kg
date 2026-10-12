"""
导出「得主跟踪」页面需要的精简 JSON：
  data/tracked_laureates.json

字段：pid / name_en / name_zh / gender / birth_year / death_year /
      nationality / nobel_years / nobel_categories / wikipedia_en

数据源：laureates 表（全量 1028 得主）
"""
import json, sqlite3

DB = r'd:\src\nobel-kg\data\knowledge.sqlite'
OUT = r'd:\src\nobel-kg\data\tracked_laureates.json'

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
rows = cur.execute("""
    SELECT laureate_pid, name_en, name_zh, gender, birth_year, death_year,
           nationality, nobel_years, nobel_categories, wikipedia_en
    FROM laureates
    ORDER BY nobel_years, name_en
""").fetchall()

data = [dict(r) for r in rows]
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

size = len(open(OUT, 'rb').read())
print(f"导出 {len(data)} 条 -> {OUT}")
print(f"文件大小: {size/1024:.1f} KB")
conn.close()

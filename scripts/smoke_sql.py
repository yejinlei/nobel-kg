# -*- coding: utf-8 -*-
"""同步 manifest.json 行数 + DuckDB SQL 冒烟验证（模拟 viz 页面的查询）"""
import json, re
from pathlib import Path
import pandas as pd

DATA = Path('data')
changed = ['papers', 'works', 'paper_author', 'person_work', 'paper_lineage', 'collaboration', 'paradigms']

manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
for name in changed:
    df = pd.read_parquet(DATA / f'{name}.parquet')
    manifest[name]['rows'] = int(len(df))
(DATA / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
print('manifest.json 已同步')

# ---- DuckDB 冒烟验证 ----
try:
    import duckdb
except ImportError:
    print('(python duckdb 未安装，跳过 SQL 冒烟)')
    raise SystemExit

con = duckdb.connect()
con.execute(f"CREATE VIEW papers AS SELECT * FROM read_parquet('{DATA / 'papers.parquet'}')")
for n in ['fields', 'persons', 'paper_author', 'paper_lineage', 'collaboration', 'paradigms', 'works', 'person_work']:
    con.execute(f"CREATE VIEW {n} AS SELECT * FROM read_parquet('{DATA / (n + '.parquet')}')")

def q(sql, label):
    r = con.execute(sql).fetchall()
    print(f'[OK] {label}: {r[0] if len(r) == 1 else len(r)}')

q("SELECT count(*) FROM papers", 'papers 总数')
q("SELECT count(*) FROM papers WHERE field_id LIKE 'F02%' OR field_id IN ('F021','F022','F023','F024')", '化学论文')
q("SELECT count(*) FROM papers WHERE field_id IN ('F031','F032','F033','F034','F035','F036')", '生医论文')
q("""SELECT p.year, p.title_zh, f.name_zh FROM papers p JOIN fields f USING(field_id)
     WHERE p.year >= 2000 ORDER BY p.year DESC LIMIT 5""", '近年论文样例')
q("SELECT count(*) FROM paper_lineage", '影响链')
q("""SELECT l.relation_id, s.title_zh AS 学生论文, a.title_zh AS 师源论文, l.influence_type
     FROM paper_lineage l JOIN papers s ON s.paper_id = l.student_paper_id
     JOIN papers a ON a.paper_id = l.advisor_paper_id LIMIT 3""", '影响链联查')
q("SELECT count(*) FROM collaboration", '合作边')
q("""SELECT a.name_en AS person_a, b.name_en AS person_b, c.year, c.topic
     FROM collaboration c JOIN persons a ON a.person_id = c.person_a_id
     JOIN persons b ON b.person_id = c.person_b_id ORDER BY c.year LIMIT 5""", '合作联查')
q("SELECT count(*) FROM paradigms WHERE paradigm_id LIKE 'P_%'", '范式')
q("""SELECT pa.person_id, count(*) AS n FROM paper_author pa
     GROUP BY 1 ORDER BY n DESC LIMIT 5""", '高产作者 top')
q("SELECT count(*) FROM person_work", 'person_work 总数')
q("""SELECT w.name_zh, count(pw.person_id) AS people FROM works w
     JOIN person_work pw USING(work_id) GROUP BY 1 HAVING count(pw.person_id) >= 2 LIMIT 5""", '多人共同工作')

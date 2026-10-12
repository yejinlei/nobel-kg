"""
基于 archive 表全量回填诺贝尔文学奖 + 和平奖到：
  - persons (P787+)
  - laureates
  - laureates_split
  - prizes
  - prize_laureates

幂等：重复运行不会产生重复行。
"""
import sqlite3, os, re

DB = os.path.join(os.path.dirname(__file__), '..', 'data', 'knowledge.sqlite')
con = sqlite3.connect(DB)
cur = con.cursor()

# ---------- 类别映射 ----------
CAT_MAP_ZH = {'文学': '文学奖', '和平': '和平奖'}
CAT_MAP_EN_TO_ZH = {'Literature': '文学奖', 'Peace': '和平奖'}
CAT_ABBR = {'文学奖': 'Lit', '和平奖': 'Pea'}

# 诺贝尔奖在 archive 里用的中文是短形式（'文学'/'和平'），
# 但 persons / prizes / laureates 表统一使用长形式（'文学奖'/'和平奖'）。

# ---------- 1) 提取 archive 里所有文学 + 和平得主 ----------
rows = cur.execute("""
    SELECT archive_id, name_en, name_native, gender, birth_year, death_year,
           birth_country, wikidata_id, wikipedia_en,
           nobel_years, nobel_categories_zh, motivation_en, portions, entity_type
    FROM archive
    WHERE nobel_categories_zh IN ('文学', '和平')
""").fetchall()

print(f"archive 里文学+和平得主: {len(rows)}")

# 解析 (archive_id, category) -> 得主列表
by_key = {}
for r in rows:
    archive_id, name_en, name_native, gender, byr, dyr, bctry, wikidata, wiki, years, cats_zh, motivation, portions, entity_type = r
    if not years:
        continue
    for yr_raw in years.split(';'):
        yr_raw = yr_raw.strip()
        if not yr_raw.isdigit():
            continue
        yr = int(yr_raw)
        # cats_zh 用分号分隔（多奖获得者）
        for cat_zh in cats_zh.split(';'):
            cat_zh = cat_zh.strip()
            if cat_zh in CAT_MAP_ZH:
                key = (yr, CAT_MAP_ZH[cat_zh])
                by_key.setdefault(key, []).append({
                    'archive_id': archive_id,
                    'name_en': name_en,
                    'name_native': name_native,
                    'gender': gender,
                    'byr': byr,
                    'dyr': dyr,
                    'bctry': bctry,
                    'wikidata': wikidata,
                    'wiki': wiki,
                    'motivation': motivation,
                    'portions': portions,
                    'entity_type': entity_type,
                })

# 按年份排序
keys_sorted = sorted(by_key.keys())
print(f"需处理的 (year, category) 组合: {len(keys_sorted)}")

# ---------- 2) 清理旧的 2026 条目（P785/P786 是我之前加的，需要与全量数据统一） ----------
# 策略：保留 P785/P786（已提交），只是不再重复插入
existing_pid_by_archive = {}
for r in cur.execute("""
    SELECT p.person_id, a.archive_id
    FROM persons p JOIN archive a
    ON (a.name_en = p.name_en AND a.name_en IS NOT NULL)
    WHERE a.nobel_categories_zh IN ('文学','和平')
""").fetchall():
    existing_pid_by_archive[r[1]] = r[0]

# 手动指定：2026 已有的两条
# A1067 -> P785 (Anne Carson), A1068 -> P786 (Navi Pillay)
existing_pid_by_archive.setdefault('A1067', 'P785')
existing_pid_by_archive.setdefault('A1068', 'P786')

# ---------- 3) 生成新的 P### ----------
def get_max_pid():
    r = cur.execute("SELECT MAX(CAST(SUBSTR(person_id, 2) AS INTEGER)) FROM persons WHERE person_id LIKE 'P%'").fetchone()
    return (r[0] or 0)

next_pid = get_max_pid() + 1
print(f"next_pid 起点: P{next_pid}")

new_persons = []
new_laureates = []
new_split = []
new_prizes = []
new_prize_laureates = []

for key in keys_sorted:
    yr, cat_zh = key
    people = by_key[key]
    # 已存在 prize_id 则跳过
    prize_id = f"NP{yr}_{CAT_ABBR[cat_zh]}"
    if cur.execute("SELECT 1 FROM prizes WHERE prize_id=?", (prize_id,)).fetchone():
        # 已存在，但如果 archive 里有人不在现有 prize_laureates 中，追加
        pass

    # 处理 portions
    portions = people[0]['portions'] if len(people) == 1 else None
    if portions:
        try:
            share = portions  # '1' -> '独享' / '1/2' / '1/3'
            if share == '1':
                share = '独享'
        except:
            share = '独享'
    else:
        n = len(people)
        share = '独享' if n == 1 else f'1/{n}'

    motivation = people[0]['motivation'] or ''

    # 为每个人生成 P###
    pids = []
    for p in people:
        aid = p['archive_id']
        if aid in existing_pid_by_archive:
            pid = existing_pid_by_archive[aid]
        else:
            pid = f"P{next_pid}"
            next_pid += 1
            existing_pid_by_archive[aid] = pid
            new_persons.append({
                'person_id': pid,
                'name_en': p['name_en'],
                'name_zh': p['name_native'] or None,
                'gender': 'M' if p['gender'] == 'male' else ('F' if p['gender'] == 'female' else None),
                'birth_year': p['byr'],
                'death_year': p['dyr'],
                'nationality': p['bctry'],
                'is_nobel_laureate': '是',
                'nobel_year': yr,
                'nobel_category': cat_zh,
                'nobel_motivation': motivation,
                'wikidata_id': p['wikidata'],
                'wikipedia_en': p['wiki'],
                'role_type': '组织' if p['entity_type'] == '组织' else None,
                'note': f'{yr} {cat_zh} 全量回填',
            })
            new_laureates.append({
                'laureate_pid': pid,
                'name_en': p['name_en'],
                'name_zh': p['name_native'] or None,
                'gender': 'M' if p['gender'] == 'male' else ('F' if p['gender'] == 'female' else None),
                'birth_year': p['byr'],
                'death_year': p['dyr'],
                'nationality': p['bctry'],
                'nobel_years': str(yr),
                'nobel_categories': cat_zh,
                'in_core_network': '否',
                'wikidata_id': p['wikidata'],
                'wikipedia_en': p['wiki'],
                'note': '全量回填',
            })
            new_split.append({
                'pid': pid,
                'name_en': p['name_en'],
                'name_zh': p['name_native'] or None,
                'category': cat_zh,
                'yr': yr,
            })
        pids.append(pid)

    # 检查现有 prize
    existing = cur.execute("SELECT prize_id FROM prizes WHERE prize_id=?", (prize_id,)).fetchone()
    if not existing:
        new_prizes.append({
            'prize_id': prize_id,
            'year': yr,
            'category': cat_zh,
            'motivation': motivation,
            'laureate_ids': ';'.join(pids),
            'share_note': share,
        })
    # prize_laureates 逐条追加（幂等：先检查）
    for pid in pids:
        exists = cur.execute("SELECT 1 FROM prize_laureates WHERE prize_id=? AND pid=?", (prize_id, pid)).fetchone()
        if not exists:
            new_prize_laureates.append({
                'prize_id': prize_id,
                'year': yr,
                'category': cat_zh,
                'pid': pid,
                'share_note': share,
                'motivation': motivation,
            })

# ---------- 4) 批量插入（业务键去重） ----------
def insert_if_absent(table, row, key_cols):
    cols = list(row.keys())
    vals = list(row.values())
    key_vals = [row[c] for c in key_cols]
    ph = ','.join(['?']*len(key_cols))
    exists = cur.execute(
        f"SELECT 1 FROM {table} WHERE " + " AND ".join(f'"{c}"=?' for c in key_cols),
        key_vals
    ).fetchone()
    if exists:
        return 0
    placeholders = ','.join(['?']*len(cols))
    col_str = ','.join(f'"{c}"' for c in cols)
    cur.execute(f"INSERT INTO {table} ({col_str}) VALUES ({placeholders})", vals)
    return 1

cnt_p  = sum(insert_if_absent('persons',         r, ['person_id'])          for r in new_persons)
cnt_l  = sum(insert_if_absent('laureates',       r, ['laureate_pid'])       for r in new_laureates)
cnt_s  = sum(insert_if_absent('laureates_split', r, ['pid','category','yr']) for r in new_split)
cnt_pr = sum(insert_if_absent('prizes',          r, ['prize_id'])           for r in new_prizes)
cnt_pl = sum(insert_if_absent('prize_laureates', r, ['prize_id','pid'])     for r in new_prize_laureates)

print(f"\n插入统计:")
print(f"  persons:          +{cnt_p}  (from {len(new_persons)} new)")
print(f"  laureates:        +{cnt_l}  (from {len(new_laureates)} new)")
print(f"  laureates_split:  +{cnt_s}  (from {len(new_split)} new)")
print(f"  prizes:           +{cnt_pr} (from {len(new_prizes)} new)")
print(f"  prize_laureates:  +{cnt_pl} (from {len(new_prize_laureates)} new)")

con.commit()

# ---------- 5) 验证 ----------
print("\n=== 验证 ===")
r = cur.execute("SELECT category, COUNT(*) FROM prizes GROUP BY category ORDER BY 2 DESC").fetchall()
for cat, c in r:
    print(f"  prizes[{cat}]: {c}")

r = cur.execute("SELECT nobel_category, COUNT(*) FROM persons WHERE nobel_category IS NOT NULL GROUP BY nobel_category ORDER BY 2 DESC").fetchall()
for cat, c in r:
    print(f"  persons[{cat}]: {c}")

con.close()
print("\nDone.")

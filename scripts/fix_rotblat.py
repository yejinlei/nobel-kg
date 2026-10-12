"""
修复 NP1995_Pea 的本体错误：EXT0309 (Joseph Rotblat)
  - EXT0309 来自 DBpedia mentorship（1995 和平奖共同得主），
    此前在 persons 表只登记为学术人物，未标为诺奖得主。
  - archive.nobel_id 是诺贝尔官方名单数字 ID（1..N），
    Rotblat 已在 archive A0560 / nobel_id=560 里正确登记。
  - 因此本修复仅把 EXT0309 标记为诺奖得主并补 laureates 表，
    不新增 archive 行（会与 A0560 重复）。
"""
import sqlite3

DB = r'd:\src\nobel-kg\data\knowledge.sqlite'
EXT = 'EXT0309'
MOT = 'for their efforts to diminish the part played by nuclear arms in international politics and, in the longer run, to eliminate such arms'

conn = sqlite3.connect(DB)
cur = conn.cursor()

# 1) 把 EXT0309 升级为诺奖得主
cur.execute("""
    UPDATE persons
    SET is_nobel_laureate='是', nobel_year=1995, nobel_category='和平奖',
        nobel_motivation=?, note=?
    WHERE person_id=?
""", (MOT, '1995 诺贝尔和平奖共同得主；DBpedia mentorship 补充 ID', EXT))

# 2) prize_laureates / prizes.laureate_ids 里已经是 EXT0309，无需改

# 3) 补 laureates 表
cnt = cur.execute("SELECT COUNT(*) FROM laureates WHERE laureate_pid=?", (EXT,)).fetchone()[0]
if not cnt:
    cur.execute("""INSERT INTO laureates (laureate_pid, name_en, name_zh, gender, birth_year, death_year, nationality,
        nobel_years, nobel_categories, in_core_network) VALUES (?,?,?,?,?,?,?,?,?,?)""", (
            EXT, 'Joseph Rotblat', '约瑟夫·罗特布拉特', 'male', 1908, 2005, '英国 / 波兰裔',
            '1995', '和平奖', '是'
        ))

# 4) archive A0560 已正确登记 Rotblat（1995 和平奖），不动

conn.commit()

# 验证
print("=== 验证 ===")
p = cur.execute("SELECT person_id, is_nobel_laureate, nobel_year, nobel_category FROM persons WHERE person_id=?", (EXT,)).fetchone()
print(f"persons.EXT0309: {p}")
l = cur.execute("SELECT laureate_pid, name_en, name_zh, nobel_years, nobel_categories, in_core_network FROM laureates WHERE laureate_pid=?", (EXT,)).fetchone()
print(f"laureates.EXT0309: {l}")
pz = cur.execute("SELECT prize_id, laureate_ids, share_note FROM prizes WHERE prize_id='NP1995_Pea'").fetchone()
print(f"prizes.NP1995_Pea: {pz}")
pl_rows = cur.execute("SELECT prize_id, pid, share_note FROM prize_laureates WHERE prize_id='NP1995_Pea'").fetchall()
print(f"prize_laureates.NP1995_Pea: {pl_rows}")
a = cur.execute("SELECT archive_id, nobel_id, entity_type, name_en, gender, nobel_years, nobel_categories_zh, portions FROM archive WHERE archive_id='A0560'").fetchone()
print(f"archive.A0560: {a}")

conn.close()

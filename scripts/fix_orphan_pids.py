"""
修复 prizes / prize_laureates 里 3 处姓名占位符 pid 悬空引用。

真实情况：
  - NP1903_Phy 里 BECQUER 与 P142 是**重复行**（Henri Becquerel 被录两次）
  - NP1965_Phy 里 FEYNMAN 与 P225、TOMONAGA 与 P242 各自重复

正确做法：
  1. 删除 prize_laureates 里 3 行别名占位记录
  2. 从 prizes.laureate_ids 中移除 3 个占位符（P### 已存在，无需替换）
  3. share_note 修正：NP1903_Phy 4 位 → 3 位 '1/3'
                      NP1965_Phy 5 位 → 3 位 '1/3'
"""
import sqlite3, os

DB = os.path.join(os.path.dirname(__file__), '..', 'data', 'knowledge.sqlite')
con = sqlite3.connect(DB)
cur = con.cursor()

# ---- 1) 删除 prize_laureates 里的 3 行别名占位记录 ----
deletes = [
    ('NP1903_Phy', 'BECQUER'),
    ('NP1965_Phy', 'FEYNMAN'),
    ('NP1965_Phy', 'TOMONAGA'),
]
for pz, pid in deletes:
    r = cur.execute("DELETE FROM prize_laureates WHERE prize_id=? AND pid=?", (pz, pid))
    print(f"DELETE prize_laureates: {pz} / {pid} rows={r.rowcount}")

# ---- 2) 修 prizes.laureate_ids（去重、去掉占位符） ----
updates = {
    'NP1903_Phy': (';'.join(['P040', 'P057', 'P142']), '1/3'),
    'NP1965_Phy': (';'.join(['P052', 'P225', 'P242']), '1/3'),
}
for pz, (ids, share) in updates.items():
    cur.execute(
        "UPDATE prizes SET laureate_ids=?, share_note=?, motivation=? WHERE prize_id=?",
        (ids, share, cur.execute("SELECT motivation FROM prizes WHERE prize_id=?", (pz,)).fetchone()[0], pz)
    )
    print(f"UPDATE prizes {pz}: laureate_ids={ids}, share_note={share}")

# ---- 3) 修 prize_laureates.share_note（3 人分） ----
for pz in updates:
    r = cur.execute("UPDATE prize_laureates SET share_note='1/3' WHERE prize_id=?", (pz,))
    print(f"UPDATE prize_laureates {pz}: share_note='1/3' rows={r.rowcount}")

con.commit()

# ---- 4) 验证 ----
print("\n=== 验证 ===")
dangling = 0
for pid_row in cur.execute("SELECT laureate_ids FROM prizes WHERE laureate_ids IS NOT NULL").fetchall():
    for p in (pid_row[0] or '').split(';'):
        p = p.strip()
        if not p: continue
        if not cur.execute("SELECT 1 FROM persons WHERE person_id=?", (p,)).fetchone():
            dangling += 1
            print(f"  悬空: {p}")
print(f"prizes.laureate_ids 悬空: {dangling}")

dangling2 = cur.execute("""
    SELECT COUNT(DISTINCT pl.pid) FROM prize_laureates pl
    LEFT JOIN persons p ON p.person_id = pl.pid WHERE p.person_id IS NULL
""").fetchone()[0]
print(f"prize_laureates.pid 悬空: {dangling2}")

# 重复行检查
dup = cur.execute("""
    SELECT prize_id, pid, COUNT(*) FROM prize_laureates
    GROUP BY prize_id, pid HAVING COUNT(*)>1
""").fetchall()
print(f"prize_laureates 重复行: {len(dup)}")

# 最终形态
for pz in ['NP1903_Phy', 'NP1965_Phy']:
    print(f"\n{pz}:")
    r = cur.execute("SELECT laureate_ids, share_note FROM prizes WHERE prize_id=?", (pz,)).fetchone()
    print(f"  prizes: laureate_ids={r[0]}, share_note={r[1]}")
    r = cur.execute("SELECT pid FROM prize_laureates WHERE prize_id=? ORDER BY pid", (pz,)).fetchall()
    print(f"  prize_laureates: {[x[0] for x in r]}")

con.close()
print("\nDone.")

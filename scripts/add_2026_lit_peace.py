"""一次性脚本：给 knowledge.sqlite 追加 2026 年诺贝尔文学奖 + 和平奖数据。
幂等：重复运行不会重复插入。

新增：
  文学奖: 安妮·卡森 (Anne Carson) — 加拿大女诗人/散文家/翻译家
    motivation: "for her bold and innovative body of work that, in playful dialogue with classical tradition, has created new forms for contemporary literature"
  和平奖: 纳维·皮莱 (Navanethem "Navi" Pillay) — 南非国际法学家
    motivation: "for advancing peace and international law"

参考 2025 经济学获奖者 P783/P784 的现有模式，追加 P785 (Carson) + P786 (Pillay)。
"""
import sqlite3
import sys

SQLITE_PATH = r'd:\src\nobel-kg\data\knowledge.sqlite'

CARSON = {
    'person_id': 'P785',
    'name_en': 'Anne Carson',
    'name_zh': '安妮·卡森',
    'gender': 'F',
    'birth_year': 1950,
    'nationality': 'Canada',
    'is_nobel_laureate': '是',
    'nobel_year': 2026,
    'nobel_category': '文学奖',
    'nobel_motivation': 'for her bold and innovative body of work that, in playful dialogue with classical tradition, has created new forms for contemporary literature',
    'wikipedia_en': 'https://en.wikipedia.org/wiki/Anne_Carson',
    'note': '加拿大诗人、散文家、翻译家、古典学家；代表作《红紫》《波谱》《维纳斯的死亡》',
}

PILLAY = {
    'person_id': 'P786',
    'name_en': 'Navanethem Pillay',
    'name_zh': '纳维·皮莱',
    'gender': 'F',
    'birth_year': 1940,
    'nationality': 'South Africa',
    'is_nobel_laureate': '是',
    'nobel_year': 2026,
    'nobel_category': '和平奖',
    'nobel_motivation': 'for advancing peace and international law',
    'wikipedia_en': 'https://en.wikipedia.org/wiki/Navanethem_Pillay',
    'note': '南非国际法学家；曾任联合国人权高专(2008-2014)、卢旺达问题国际刑事法庭庭长、国际刑事法院法官，现任国际法院法官',
}

PRIZES_NEW = [
    # (prize_id, year, category, motivation, laureate_ids, share_note)
    ('NP2026_Lit', 2026, '文学奖',
     'for her bold and innovative body of work that, in playful dialogue with classical tradition, has created new forms for contemporary literature（表彰她大胆且富有创造性的作品群，在与古典传统嬉戏对话中，为当代文学创造了新形式）',
     'P785', '独享'),
    ('NP2026_Pea', 2026, '和平奖',
     'for advancing peace and international law（表彰其为推动和平与国际法所做的贡献）',
     'P786', '独享'),
]

def upsert_person(cur, p):
    cur.execute("SELECT person_id FROM persons WHERE person_id=?", (p['person_id'],))
    if cur.fetchone():
        return False
    cur.execute("""
        INSERT INTO persons (person_id, name_en, name_zh, gender, birth_year, nationality,
                             is_nobel_laureate, nobel_year, nobel_category, nobel_motivation,
                             wikipedia_en, note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, (p['person_id'], p['name_en'], p['name_zh'], p['gender'], p['birth_year'],
          p['nationality'], p['is_nobel_laureate'], p['nobel_year'], p['nobel_category'],
          p['nobel_motivation'], p['wikipedia_en'], p['note']))
    return True

def upsert_laureate(cur, p):
    cur.execute("SELECT laureate_pid FROM laureates WHERE laureate_pid=?", (p['person_id'],))
    if cur.fetchone():
        return False
    cur.execute("""
        INSERT INTO laureates (laureate_pid, name_en, name_zh, gender, birth_year, nationality,
                               nobel_years, nobel_categories, in_core_network, wikipedia_en, note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """, (p['person_id'], p['name_en'], p['name_zh'], p['gender'], p['birth_year'],
          p['nationality'], str(p['nobel_year']), p['nobel_category'], '否',
          p['wikipedia_en'], '2026 ' + p['nobel_category'] + ' 全量名录补入'))
    return True

def upsert_laureate_split(cur, p):
    cur.execute("SELECT pid FROM laureates_split WHERE pid=? AND yr=?", (p['person_id'], p['nobel_year']))
    if cur.fetchone():
        return False
    cur.execute("""
        INSERT INTO laureates_split (pid, name_en, name_zh, category, yr)
        VALUES (?,?,?,?,?)
    """, (p['person_id'], p['name_en'], p['name_zh'], p['nobel_category'], p['nobel_year']))
    return True

def upsert_prize(cur, pid, year, cat, motiv, lds, share):
    cur.execute("SELECT prize_id FROM prizes WHERE prize_id=?", (pid,))
    if cur.fetchone():
        return False
    cur.execute("""
        INSERT INTO prizes (prize_id, year, category, motivation, laureate_ids, share_note)
        VALUES (?,?,?,?,?,?)
    """, (pid, year, cat, motiv, lds, share))
    return True

def upsert_prize_laureate(cur, pid, year, cat, lpid, share, motiv):
    cur.execute("SELECT prize_id FROM prize_laureates WHERE prize_id=? AND pid=?", (pid, lpid))
    if cur.fetchone():
        return False
    cur.execute("""
        INSERT INTO prize_laureates (prize_id, year, category, pid, share_note, motivation)
        VALUES (?,?,?,?,?,?)
    """, (pid, year, cat, lpid, share, motiv))
    return True

def main():
    con = sqlite3.connect(SQLITE_PATH)
    cur = con.cursor()

    n_persons = 0
    n_laureates = 0
    n_splits = 0
    n_prizes = 0
    n_pla = 0

    for p in (CARSON, PILLAY):
        n_persons += upsert_person(cur, p)
        n_laureates += upsert_laureate(cur, p)
        n_splits += upsert_laureate_split(cur, p)

    for pid, year, cat, motiv, lds, share in PRIZES_NEW:
        n_prizes += upsert_prize(cur, pid, year, cat, motiv, lds, share)
        for lpid in lds.split(';'):
            n_pla += upsert_prize_laureate(cur, pid, year, cat, lpid, share, motiv)

    con.commit()

    print(f'persons           : {n_persons} inserted')
    print(f'laureates         : {n_laureates} inserted')
    print(f'laureates_split   : {n_splits} inserted')
    print(f'prizes            : {n_prizes} inserted')
    print(f'prize_laureates   : {n_pla} inserted')

    # 校验
    print('\n== 2026 prizes 最终 ==')
    for r in cur.execute("SELECT prize_id, category, laureate_ids, share_note FROM prizes WHERE year=2026 ORDER BY category"):
        print(' ', r)
    print('\n== 2026 persons 新增 ==')
    for r in cur.execute("SELECT person_id, name_en, name_zh, nobel_year, nobel_category FROM persons WHERE nobel_year=2026 ORDER BY person_id"):
        print(' ', r)

    con.close()

if __name__ == '__main__':
    main()

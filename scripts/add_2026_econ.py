# -*- coding: utf-8 -*-
"""
追加 2026 年诺贝尔经济学奖得主到 knowledge.sqlite。
数据来源：诺贝尔官网 2026-10-12 公告。
  https://www.nobelprize.org/prizes/economic-sciences/2026/press-release/

新增人物：
  - Robert E. Hall     (Stanford)      1943-, PhD MIT 1967
  - Michael Woodford   (Columbia)      1955-

修改范围（保持与其他年份 schema 一致）：
  persons         +2
  laureates       +2
  laureates_split +2   (category=经济学, yr=2026)
  prizes          +1   (NP2026_Eco, 两人共享 1/2)
  prize_laureates +2
不动 mentorship / schools / features 等派生表——Hall 和 Woodford 尚无被
后续数据源标注的师承/学派数据，避免脑补。
"""
import sqlite3
import sys

DB = "data/knowledge.sqlite"

MOTIVATION_EN = "for microeconomic foundations of macroeconomic stabilisation"
MOTIVATION_ZH = "表彰他们为宏观经济稳定化奠定微观经济基础"
MOTIVATION = MOTIVATION_EN + "（" + MOTIVATION_ZH + "）"

NEW_PERSONS = [
    (
        "P783", "Robert E. Hall", "罗伯特·E·霍尔", "男", 1943, None, "美国",
        "是", 2026, "经济学", MOTIVATION,
        "F004", "诺奖得主",
        "获奖机构：Stanford University, CA, USA（2026 全量名录）；"
        "出生地：Palo Alto, CA, USA；博士：MIT 1967；"
        "主要贡献：有效消费假说（Random Walk Consumption Hypothesis），"
        "新凯恩斯主义宏观模型的微观基础",
        None, None,
    ),
    (
        "P784", "Michael Woodford", "迈克尔·伍德福德", "男", 1955, None, "美国",
        "是", 2026, "经济学", MOTIVATION,
        "F004", "诺奖得主",
        "获奖机构：Columbia University, New York, USA（2026 全量名录）；"
        "出生地：Chicopee, MA, USA；博士：MIT 1983；"
        "主要贡献：《宏观经济学》（2003，MIT Press），"
        "以三方程模型奠定新凯恩斯主义的教科书框架",
        None, None,
    ),
]


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    exists = cur.execute(
        "SELECT COUNT(*) FROM persons WHERE person_id IN ('P783','P784')"
    ).fetchone()[0]
    if exists:
        print("已存在 %d 条 2026 经济学奖得主，无需追加。" % exists)
        return 0

    for row in NEW_PERSONS:
        cur.execute(
            "INSERT INTO persons ("
            " person_id, name_en, name_zh, gender, birth_year, death_year,"
            " nationality, is_nobel_laureate, nobel_year, nobel_category,"
            " nobel_motivation, primary_field_id, role_type, note,"
            " wikidata_id, wikipedia_en"
            ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            row,
        )

    for pid, name_en, name_zh, gender, by, dy, nat, _, yr, cat, _, _, _, _, _, _ in NEW_PERSONS:
        cur.execute(
            "INSERT INTO laureates ("
            " laureate_pid, name_en, name_zh, gender, birth_year, death_year,"
            " nationality, nobel_years, nobel_categories,"
            " in_core_network, wikidata_id, wikipedia_en, note"
            ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (pid, name_en, name_zh, gender, by, dy, nat,
             str(yr), cat, "否", None, None, None),
        )

    for pid, name_en, name_zh in (("P783", NEW_PERSONS[0][1], NEW_PERSONS[0][2]),
                                  ("P784", NEW_PERSONS[1][1], NEW_PERSONS[1][2])):
        cur.execute(
            "INSERT INTO laureates_split VALUES (?,?,?,?,?)",
            (pid, name_en, name_zh, "经济学", 2026),
        )

    cur.execute(
        "INSERT INTO prizes (prize_id, year, category, motivation, laureate_ids, share_note)"
        " VALUES (?,?,?,?,?,?)",
        ("NP2026_Eco", 2026, "经济学", MOTIVATION, "P783;P784", "1/2"),
    )

    for pid in ("P783", "P784"):
        cur.execute(
            "INSERT INTO prize_laureates VALUES (?,?,?,?,?,?)",
            ("NP2026_Eco", 2026, "经济学", pid, "1/2", MOTIVATION),
        )

    conn.commit()

    print("=== persons 新增 ===")
    for r in cur.execute(
        "SELECT person_id, name_en, nobel_year, nobel_category FROM persons"
        " WHERE person_id IN ('P783','P784')"
    ).fetchall():
        print(r)

    print("\n=== laureates 新增 ===")
    for r in cur.execute(
        "SELECT laureate_pid, name_en, nobel_years, nobel_categories"
        " FROM laureates WHERE laureate_pid IN ('P783','P784')"
    ).fetchall():
        print(r)

    print("\n=== prizes 新增 ===")
    for r in cur.execute("SELECT * FROM prizes WHERE prize_id='NP2026_Eco'").fetchall():
        print(r)

    print("\n=== laureates_split 新增 ===")
    for r in cur.execute(
        "SELECT * FROM laureates_split WHERE yr=2026 AND category='经济学'"
    ).fetchall():
        print(r)

    print("\n=== prize_laureates 新增 ===")
    for r in cur.execute("SELECT * FROM prize_laureates WHERE prize_id='NP2026_Eco'").fetchall():
        print(r)

    total = cur.execute("SELECT COUNT(*) FROM persons").fetchone()[0]
    split_cnt = cur.execute(
        "SELECT COUNT(*) FROM laureates_split WHERE yr=2026 AND category='经济学'"
    ).fetchone()[0]
    pl_cnt = cur.execute(
        "SELECT COUNT(*) FROM prize_laureates WHERE prize_id='NP2026_Eco'"
    ).fetchone()[0]

    print("\npersons 总行数: %d（+2）" % total)
    print("laureates_split 中 2026-经济学 条数: %d（应为 2）" % split_cnt)
    print("prize_laureates 中 NP2026_Eco 条数: %d（应为 2）" % pl_cnt)

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

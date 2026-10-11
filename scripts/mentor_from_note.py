"""从 persons.note 字段里批量解析师承关系。

策略：
1) 抽取"X学生"、"X门下"、"X的X学生"、"福勒学生"等模式
2) 匹配 persons 表内的 name_zh/name_en
3) 只写入 mentorship 表里没有的边

输出：追加到 data/mentorship.parquet
"""
import re
import pandas as pd
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'

persons = pd.read_parquet(DATA / 'persons.parquet')
mentor = pd.read_parquet(DATA / 'mentorship.parquet')

# 中文名 → person_id（可能有重复，先按 name_zh 精确匹配）
zh_map = {}
for _, row in persons.iterrows():
    if pd.notna(row['name_zh']) and row['name_zh']:
        zh_map.setdefault(row['name_zh'], []).append(row['person_id'])

# 英文名 → person_id（取姓的最后部分匹配）
en_map = {}
for _, row in persons.iterrows():
    if pd.notna(row['name_en']) and row['name_en']:
        parts = row['name_en'].split()
        # 姓氏（最后一个词）
        en_map.setdefault(parts[-1], []).append(row['person_id'])
        en_map.setdefault(row['name_en'], []).append(row['person_id'])

# 匹配函数：先中文名，再英文名
def find_pid(name):
    if name in zh_map: return zh_map[name][0]
    if name in en_map: return en_map[name][0]
    # 部分匹配
    for zh in zh_map:
        if zh in name or name in zh: return zh_map[zh][0]
    for en in en_map:
        if en in name or name in en: return en_map[en][0]
    return None

# 已有边集合
existing = set(zip(mentor['student_id'], mentor['advisor_id']))

# 常见导师前缀
MentorPattern = re.compile(r'([\u4e00-\u9fff·]+?)(?:的)?(?:博士)?学生')

new_edges = []
for _, row in persons.iterrows():
    if pd.isna(row['note']) or not row['note']: continue
    note = str(row['note'])
    # "X学生" 模式
    for m in MentorPattern.finditer(note):
        mentor_name = m.group(1).strip()
        if len(mentor_name) < 2 or len(mentor_name) > 6: continue
        # 过滤明显不是人名的
        if any(kw in mentor_name for kw in ['国际','联合国','委员会','协会','学会','机构','组织']):
            continue
        aid = find_pid(mentor_name)
        if not aid or aid == row['person_id']: continue
        key = (row['person_id'], aid)
        if key in existing: continue
        new_edges.append({
            'edge_id': f'NOTE{len(new_edges)+1:05d}',
            'student_id': row['person_id'],
            'advisor_id': aid,
            'relation_type': '博士导师',
            'is_phd': '是',
            'start_year': None,
            'institution_id': None,
            'verification_status': '待核实',
            'source': 'persons.note 解析',
            'note': f'student: {row["name_zh"] or row["name_en"]} / advisor matched: {mentor_name} (from note: {note[:80]})'
        })
        existing.add(key)
        print(f'  + {row["name_zh"]} ← {mentor_name} [{aid}]')

print(f'\n共发现 {len(new_edges)} 条新师承边')

if new_edges:
    df_new = pd.DataFrame(new_edges)
    combined = pd.concat([mentor, df_new], ignore_index=True)
    combined.to_parquet(DATA / 'mentorship.parquet', index=False)
    print(f'mentorship.parquet 更新：{len(mentor)} → {len(combined)} 条')
    # 覆盖度
    students = set(combined['student_id']); advisors = set(combined['advisor_id'])
    print(f'覆盖人物：{len(students | advisors)} 位')

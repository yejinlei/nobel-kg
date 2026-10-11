"""从 Wikidata SPARQL 批量拉取诺奖得主之间的师承关系。

输出：data/mentorship_wikidata.parquet

关系类型映射：
- P463 doctoral advisor  → 博士导师
- P1851 educated at      → 校友（弱关系，仅当 advisor 也是诺奖得主时才保留）
- P462  doctoral student → 反过来，学生是 x（等价于 advisor 关系）

策略：
1) 从 persons.parquet 拿所有带 wikidata_id 的诺奖得主
2) 分两批 SPARQL：
   a) 找每个 laureate 的博士学生（wdt:P463 = X）
   b) 找每个 laureate 的博士导师（wdt:P463 = ?advisor，其中 laureate 是 student）
3) 只保留 student 和 advisor 都在 persons 表内的边
4) verification_status = '已验证'（Wikidata 是权威来源）
5) source = 'Wikidata SPARQL'
"""

import os
import sys
import time
import json
import requests
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
OUT = DATA / 'mentorship_wikidata.parquet'

def sparql(query, timeout=60):
    r = requests.get(
        'https://query.wikidata.org/sparql',
        params={'query': query, 'format': 'json'},
        headers={'User-Agent': 'NobelKG/1.0 (research script; contact: local)'},
        timeout=timeout,
    )
    r.raise_for_status()
    return r.json()['results']['bindings']

def main():
    persons = pd.read_parquet(DATA / 'persons.parquet')
    laureates = persons[persons['is_nobel_laureate'] == '是'].copy()
    laur_with_qid = laureates[laureates['wikidata_id'].notna() & (laureates['wikidata_id'] != '')]
    print(f'诺奖得主总数: {len(laureates)}, 有 wikidata_id: {len(laur_with_qid)}')

    # wikidata Q 列表，一次不超过 60 个（SPARQL 查询性能）
    qids = ['wd:Q' + q.lstrip('Q') for q in laur_with_qid['wikidata_id'].tolist()]

    # ---------- Step 1: 拉每位 laureate 的博士学生（P463 = 该人）----------
    print('\n[1/2] 拉取每位 laureate 的博士学生 (P463) ...')
    rows_students = []
    BATCH = 30
    for i in range(0, len(qids), BATCH):
        batch = qids[i:i+BATCH]
        qvals = '|'.join(batch)
        query = f'''
        SELECT ?student ?studentLabel ?year ?advisor WHERE {{
          VALUES ?advisor {{ {qvals} }}
          ?student wdt:P463 ?advisor .
          OPTIONAL {{ ?student wdt:P569 ?year . }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,zh". }}
        }}
        '''
        try:
            result = sparql(query, timeout=90)
            for b in result:
                rows_students.append({
                    'student_qid': b['student'].get('value','').split('/')[-1],
                    'student_label': b.get('studentLabel', {}).get('value', ''),
                    'year': str(b.get('year', {}).get('value', '')).replace('.0',''),
                    'advisor_qid': b['advisor'].get('value','').split('/')[-1],
                })
            print(f'  batch {i//BATCH+1}: 返回 {len(result)} 条 (累计 {len(rows_students)})')
        except Exception as e:
            print(f'  batch {i//BATCH+1} 失败: {e}')
            time.sleep(3)
        time.sleep(0.6)  # rate limit

    # ---------- Step 2: 拉每位 laureate 的博士导师（laureate 作为学生）----------
    print('\n[2/2] 拉取每位 laureate 的博士导师 (P463 反查) ...')
    rows_advisors = []
    for i in range(0, len(qids), BATCH):
        batch = qids[i:i+BATCH]
        qvals = '|'.join(batch)
        query = f'''
        SELECT ?advisor ?advisorLabel ?year ?student WHERE {{
          VALUES ?student {{ {qvals} }}
          ?student wdt:P463 ?advisor .
          OPTIONAL {{ ?student wdt:P569 ?year . }}
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,zh". }}
        }}
        '''
        try:
            result = sparql(query, timeout=90)
            for b in result:
                rows_advisors.append({
                    'student_qid': b['student'].get('value','').split('/')[-1],
                    'student_label': b.get('studentLabel', {}).get('value', ''),
                    'year': str(b.get('year', {}).get('value', '')).replace('.0',''),
                    'advisor_qid': b['advisor'].get('value','').split('/')[-1],
                    'advisor_label': b.get('advisorLabel', {}).get('value', ''),
                })
            print(f'  batch {i//BATCH+1}: 返回 {len(result)} 条 (累计 {len(rows_advisors)})')
        except Exception as e:
            print(f'  batch {i//BATCH+1} 失败: {e}')
            time.sleep(3)
        time.sleep(0.6)

    df_advisor_raw = pd.DataFrame(rows_advisors)
    if df_advisor_raw.empty:
        print('\n没有拉到任何数据。')
        return

    # ---------- Step 3: 归一化 qid（加 Q 前缀） ----------
    df_advisor_raw['student_wikidata_id'] = 'Q' + df_advisor_raw['student_qid']
    df_advisor_raw['advisor_wikidata_id'] = 'Q' + df_advisor_raw['advisor_qid']

    # ---------- Step 4: 映射到 person_id ----------
    qid_to_pid = dict(zip(laureates['wikidata_id'], laureates['person_id']))
    df_advisor_raw['student_id'] = df_advisor_raw['student_wikidata_id'].map(qid_to_pid)
    df_advisor_raw['advisor_id'] = df_advisor_raw['advisor_wikidata_id'].map(qid_to_pid)

    # 只保留两端都在 persons 表的边
    all_pids = set(persons['person_id'])
    df_advisor_raw = df_advisor_raw[
        df_advisor_raw['student_id'].notna() & df_advisor_raw['advisor_id'].notna()
    ].copy()
    df_advisor_raw['student_id'] = df_advisor_raw['student_id'].astype(str)
    df_advisor_raw['advisor_id'] = df_advisor_raw['advisor_id'].astype(str)
    df_advisor_raw = df_advisor_raw[df_advisor_raw['student_id'].isin(all_pids) & df_advisor_raw['advisor_id'].isin(all_pids)]

    # ---------- Step 5: 补充中文名/英文名（从 persons 表） ----------
    df_advisor_raw = df_advisor_raw.merge(
        persons[['person_id','name_en','name_zh']], on='person_id', how='left', suffixes=('_student','_advisor')
    )

    # ---------- Step 6: 组装 mentorship 表 ----------
    def to_year(y):
        try:
            y = int(y)
            return y if 1800 <= y <= 2030 else None
        except:
            return None

    new_rows = []
    for idx, r in df_advisor_raw.iterrows():
        new_rows.append({
            'edge_id': f'WK{idx+1:05d}',
            'student_id': r['student_id'],
            'advisor_id': r['advisor_id'],
            'relation_type': '博士导师',
            'is_phd': '是',
            'start_year': to_year(r.get('year','')),
            'institution_id': None,
            'verification_status': '已验证',
            'source': 'Wikidata SPARQL (P463 doctoral advisor)',
            'note': f'student: {r.get("name_en_student","")} / advisor: {r.get("name_en_advisor","")}'
        })

    df_new = pd.DataFrame(new_rows)
    # 去重（同 student-advisor 组合保留一条）
    df_new = df_new.drop_duplicates(subset=['student_id','advisor_id']).reset_index(drop=True)
    df_new['edge_id'] = [f'WK{i+1:05d}' for i in range(len(df_new))]

    # ---------- Step 7: 与现有 mentorship 合并（现有优先） ----------
    existing = pd.read_parquet(DATA / 'mentorship.parquet')
    existing_keys = set(zip(existing['student_id'], existing['advisor_id']))
    df_new['key'] = list(zip(df_new['student_id'], df_new['advisor_id']))
    df_new_unique = df_new[~df_new['key'].isin(existing_keys)].drop(columns=['key'])

    print(f'\nWikidata 拉取原始: {len(df_new)} 条')
    print(f'去掉已在 mentorship 表中的: {len(df_new_unique)} 条新增')

    combined = pd.concat([existing, df_new_unique], ignore_index=True)
    combined.to_parquet(OUT, index=False)
    print(f'\n已写入 {OUT}')
    print(f'新 mentorship.parquet 总条数: {len(combined)}')
    print(f'覆盖人物数: student+advisor 并集 = {combined["student_id"].nunique() + combined["advisor_id"].nunique() - len(set(combined["student_id"])&set(combined["advisor_id"]))}')

    # 备份原文件（保留原始 40 条）
    import shutil
    backup = DATA / 'mentorship.parquet.bak'
    if not backup.exists():
        shutil.copy(DATA / 'mentorship.parquet', backup)
        print(f'原文件已备份到 {backup}')

    # 覆盖
    combined.to_parquet(DATA / 'mentorship.parquet', index=False)
    print(f'已覆盖写入 {DATA / "mentorship.parquet"}')


if __name__ == '__main__':
    main()

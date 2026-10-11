"""从 Wikidata SPARQL 批量拉取诺奖得主之间的师承关系。

正确属性映射（Wikidata）：
- P184 = doctoral advisor（学生 → 导师，正向）
- P185 = doctoral student（导师 → 学生，反向）

策略：
1) 从 persons.parquet 拿所有带 wikidata_id 的诺奖得主
2) SPARQL 批量查询：找出 student=laureate 且 advisor=另一 laureate 的边
3) 只保留两端都在 persons 表的边
4) 追加到 mentorship.parquet
"""

import os
import time
import requests
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
OUT = DATA / 'mentorship_wikidata.parquet'

HEADERS = {
    'User-Agent': 'NobelKG/1.0 (research; contact: dev@example.com)',
    'Accept': 'application/json',
}

def sparql(query, timeout=90):
    r = requests.get(
        'https://query.wikidata.org/sparql',
        params={'query': query, 'format': 'json'},
        headers=HEADERS,
        timeout=timeout,
    )
    r.raise_for_status()
    return r.json()['results']['bindings']

def main():
    persons = pd.read_parquet(DATA / 'persons.parquet')
    laureates = persons[persons['is_nobel_laureate'] == '是'].copy()
    laur_with_qid = laureates[laureates['wikidata_id'].notna() & (laureates['wikidata_id'] != '')]
    print(f'诺奖得主总数: {len(laureates)}, 有 wikidata_id: {len(laur_with_qid)}')

    # 构建 qid -> person_id 映射
    qid_to_pid = dict(zip(laur_with_qid['wikidata_id'], laur_with_qid['person_id']))
    qids = ['wd:' + q for q in laur_with_qid['wikidata_id'].tolist()]

    # ---------- 拉每位 laureate 的博士导师（P184）----------
    print('\n[1/2] 拉取每位 laureate 的博士导师 (P184 doctoral advisor) ...')
    rows = []
    BATCH = 40
    for i in range(0, len(qids), BATCH):
        batch = qids[i:i+BATCH]
        qvals = ' '.join(batch)  # 空格分隔，不是 |
        query = f'''
        SELECT DISTINCT ?student ?advisor WHERE {{
          VALUES ?student {{ {qvals} }}
          ?student wdt:P184 ?advisor .
        }}
        '''
        try:
            result = sparql(query)
            for b in result:
                rows.append({
                    'student_qid': b['student']['value'].replace('http://www.wikidata.org/entity/', ''),
                    'advisor_qid': b['advisor']['value'].replace('http://www.wikidata.org/entity/', ''),
                })
            print(f'  batch {i//BATCH+1}/{(len(qids)-1)//BATCH+1}: 返回 {len(result)} 条 (累计 {len(rows)})')
        except Exception as e:
            print(f'  batch {i//BATCH+1} 失败: {e}')
            time.sleep(3)
        time.sleep(0.7)

    # ---------- 反向拉：P185 doctoral student（laureate 作为导师）----------
    print('\n[2/2] 反向拉取每位 laureate 的博士学生 (P185 doctoral student) ...')
    rows_rev = []
    for i in range(0, len(qids), BATCH):
        batch = qids[i:i+BATCH]
        qvals = ' '.join(batch)
        query = f'''
        SELECT DISTINCT ?student ?advisor WHERE {{
          VALUES ?advisor {{ {qvals} }}
          ?student wdt:P184 ?advisor .
        }}
        '''
        try:
            result = sparql(query)
            for b in result:
                rows_rev.append({
                    'student_qid': b['student']['value'].replace('http://www.wikidata.org/entity/', ''),
                    'advisor_qid': b['advisor']['value'].replace('http://www.wikidata.org/entity/', ''),
                })
            print(f'  batch {i//BATCH+1}/{(len(qids)-1)//BATCH+1}: 返回 {len(result)} 条 (累计 {len(rows_rev)})')
        except Exception as e:
            print(f'  batch {i//BATCH+1} 失败: {e}')
            time.sleep(3)
        time.sleep(0.7)

    # ---------- 合并所有边 ----------
    all_edges = rows + rows_rev
    df = pd.DataFrame(all_edges)
    if df.empty:
        print('\n没有拉到任何数据。')
        return
    df = df.drop_duplicates()
    print(f'\n原始唯一边: {len(df)}')

    # ---------- 只保留两端都在 laureates 中的边 ----------
    df['student_pid'] = df['student_qid'].map(qid_to_pid)
    df['advisor_pid'] = df['advisor_qid'].map(qid_to_pid)
    df = df.dropna(subset=['student_pid', 'advisor_pid'])
    print(f'两端都在 laureates 中的边: {len(df)}')

    # ---------- 映射到 person_id ----------
    df['student_id'] = df['student_pid'].astype(str)
    df['advisor_id'] = df['advisor_pid'].astype(str)

    # ---------- 组装 mentorship 记录 ----------
    df_new = pd.DataFrame({
        'edge_id': [f'WK{i+1:05d}' for i in range(len(df))],
        'student_id': df['student_id'].values,
        'advisor_id': df['advisor_id'].values,
        'relation_type': '博士导师',
        'is_phd': '是',
        'start_year': None,
        'institution_id': None,
        'verification_status': '已验证',
        'source': 'Wikidata SPARQL (P184 doctoral advisor)',
        'note': None,
    })

    # ---------- 与现有 mentorship 合并（现有优先）----------
    existing = pd.read_parquet(DATA / 'mentorship.parquet')
    existing_keys = set(zip(existing['student_id'].astype(str), existing['advisor_id'].astype(str)))
    df_new['key'] = list(zip(df_new['student_id'], df_new['advisor_id']))
    df_new_unique = df_new[~df_new['key'].isin(existing_keys)].drop(columns=['key'])

    print(f'\nWikidata 拉到: {len(df_new)} 条')
    print(f'去掉已在 mentorship 表中的: {len(df_new_unique)} 条新增')

    if len(df_new_unique) > 0:
        combined = pd.concat([existing, df_new_unique], ignore_index=True)
        # 备份
        backup = DATA / 'mentorship.parquet.bak'
        if not backup.exists():
            import shutil
            shutil.copy(DATA / 'mentorship.parquet', backup)
            print(f'已备份原文件到 {backup}')
        combined.to_parquet(DATA / 'mentorship.parquet', index=False)
        print(f'已写入 {DATA / "mentorship.parquet"}, 新总数: {len(combined)}')
    else:
        print('\n没有新增，不修改 mentorship.parquet')

    # 保存原始拉取结果
    df.to_csv(DATA / '_wikidata_p184_raw.csv', index=False)
    print(f'原始数据已保存至 {DATA / "_wikidata_p184_raw.csv"}')


if __name__ == '__main__':
    main()

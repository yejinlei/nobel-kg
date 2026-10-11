"""从 DBpedia 批量拉取诺奖得主的博士导师关系。

关键改进（相较 v1）：
1. 使用 POST form-data 避免空格被编码为 '+'
2. SPARQL VALUES 单变量用空格分隔（不是 | 或 |(...)）
3. 用完整 URL 做键避免 title 归一化不一致
4. 引入外部人物：DBpedia 发现的非诺奖导师/学生新增到 persons 表
   这样保留全部有效关系，覆盖度大幅提升
"""
import re
import time
from pathlib import Path
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'

def wiki_to_resource(url):
    m = re.search(r'wikipedia\.org/wiki/([^?#]+)', url)
    if not m: return None
    return f'http://dbpedia.org/resource/{m.group(1).strip()}'

def resource_to_title(url):
    return url.rsplit('/', 1)[-1].replace('_', ' ')

def sparql(q, timeout=90):
    # POST form-data 而非 GET：避免空格被编码为 '+' 破坏 SPARQL
    r = requests.post(
        'https://dbpedia.org/sparql',
        data={'query': q, 'format': 'json'},
        headers={'User-Agent': 'NobelKG/1.0 (research script)'},
        timeout=timeout,
    )
    r.raise_for_status()
    return r.json()['results']['bindings']

def main():
    persons = pd.read_parquet(DATA / 'persons.parquet')
    mentor_existing = pd.read_parquet(DATA / 'mentorship.parquet')

    # 用所有已注册人物（含非诺奖得主如 Sommerfeld/Christiansen）做 URL 索引
    persons_with_wiki = persons[persons['wikipedia_en'].notna()].copy()
    persons_with_wiki['dbpedia'] = persons_with_wiki['wikipedia_en'].apply(wiki_to_resource)
    persons_with_wiki = persons_with_wiki[persons_with_wiki['dbpedia'].notna()].copy()
    print(f'已注册有 wikipedia_en 的人物: {len(persons_with_wiki)}/{len(persons)}')

    # 只查询诺奖得主作为 anchor（保证数据密度高）
    laureates = persons_with_wiki[persons_with_wiki['is_nobel_laureate']=='是'].copy()
    print(f'可查 DBpedia 的诺奖得主: {len(laureates)}')

    # URL → pid 索引（覆盖全部已注册人物）
    url_to_pid = {r: p for r, p in zip(persons_with_wiki['dbpedia'], persons_with_wiki['person_id'])}
    url_to_name = {r: n for r, n in zip(persons_with_wiki['dbpedia'], persons_with_wiki['name_en'])}
    existing = set(zip(mentor_existing['student_id'], mentor_existing['advisor_id']))

    new_edges = []
    # 待新增外部人物：url -> {name_en, wikipedia_en}
    new_persons_by_url = {}

    def ensure_person(url, name_hint=None):
        """若 url 不在现有 persons 中，注册为待新增外部人物；返回其 pid"""
        if url in url_to_pid:
            return url_to_pid[url]
        if url not in new_persons_by_url:
            new_pid = f'EXT{len(new_persons_by_url)+1:04d}'
            name = name_hint or resource_to_title(url)
            wiki_url = f'https://en.wikipedia.org/wiki/{url.rsplit("/", 1)[-1]}'
            new_persons_by_url[url] = {
                'person_id': new_pid,
                'name_en': name,
                'name_zh': None,
                'gender': None,
                'birth_year': None,
                'death_year': None,
                'nationality': None,
                'is_nobel_laureate': '否',
                'nobel_year': None,
                'nobel_category': None,
                'nobel_motivation': None,
                'primary_field_id': None,
                'role_type': '学术人物',
                'note': f'来自DBpedia mentorship 补充: {name}',
                'wikidata_id': None,
                'wikipedia_en': wiki_url,
            }
        return new_persons_by_url[url]['person_id']

    # ---------- Step 1: 每位 laureate 的博士导师（含外部导师） ----------
    print('\n[1/2] 拉取每位 laureate 的博士导师（含外部导师）...')
    BATCH = 20
    for i in range(0, len(laureates), BATCH):
        batch = laureates.iloc[i:i+BATCH]
        resources = ' '.join([f'<{r}>' for r in batch['dbpedia']])
        q = f'''
        PREFIX dbo: <http://dbpedia.org/ontology/>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT ?student ?advisor ?advisorLabel WHERE {{
          VALUES ?student {{ {resources} }}
          ?student dbo:doctoralAdvisor ?advisor .
          OPTIONAL {{ ?advisor rdfs:label ?advisorLabel FILTER (LANG(?advisorLabel)="en") }}
        }}
        '''
        try:
            result = sparql(q, timeout=90)
            for b in result:
                student_pid = url_to_pid.get(b['student']['value'])
                if not student_pid: continue
                advisor_url = b['advisor']['value']
                advisor_label = b.get('advisorLabel', {}).get('value', '')
                advisor_pid = ensure_person(advisor_url, advisor_label)
                key = (student_pid, advisor_pid)
                if key in existing: continue
                student_name = url_to_name.get(b['student']['value'], student_pid)
                new_edges.append({
                    'edge_id': f'DB{len(new_edges)+1:05d}',
                    'student_id': student_pid,
                    'advisor_id': advisor_pid,
                    'relation_type': '博士导师',
                    'is_phd': '是',
                    'start_year': None,
                    'institution_id': None,
                    'verification_status': '已验证',
                    'source': 'DBpedia dbo:doctoralAdvisor',
                    'note': f'student: {student_name} / advisor: {advisor_label}'
                })
                existing.add(key)
            print(f'  batch {i//BATCH+1}: {len(result)} 条 (累计新增边 {len(new_edges)})')
        except Exception as e:
            print(f'  batch {i//BATCH+1} 失败: {e}')
            time.sleep(3)
        time.sleep(1.0)

    # ---------- Step 2: 每位 laureate 作为导师的学生（含外部学生） ----------
    print(f'\n[2/2] 拉取每位 laureate 作为导师的学生（含外部学生）...')
    for i in range(0, len(laureates), BATCH):
        batch = laureates.iloc[i:i+BATCH]
        resources = ' '.join([f'<{r}>' for r in batch['dbpedia']])
        q = f'''
        PREFIX dbo: <http://dbpedia.org/ontology/>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT ?student ?advisor ?studentLabel WHERE {{
          VALUES ?advisor {{ {resources} }}
          ?student dbo:doctoralAdvisor ?advisor .
          OPTIONAL {{ ?student rdfs:label ?studentLabel FILTER (LANG(?studentLabel)="en") }}
        }}
        '''
        try:
            result = sparql(q, timeout=90)
            for b in result:
                advisor_pid = url_to_pid.get(b['advisor']['value'])
                if not advisor_pid: continue
                student_url = b['student']['value']
                student_label = b.get('studentLabel', {}).get('value', '')
                student_pid = ensure_person(student_url, student_label)
                key = (student_pid, advisor_pid)
                if key in existing: continue
                advisor_name = url_to_name.get(b['advisor']['value'], advisor_pid)
                new_edges.append({
                    'edge_id': f'DB{len(new_edges)+1:05d}',
                    'student_id': student_pid,
                    'advisor_id': advisor_pid,
                    'relation_type': '博士导师',
                    'is_phd': '是',
                    'start_year': None,
                    'institution_id': None,
                    'verification_status': '已验证',
                    'source': 'DBpedia dbo:doctoralAdvisor',
                    'note': f'student: {student_label} / advisor: {advisor_name}'
                })
                existing.add(key)
            print(f'  batch {i//BATCH+1}: {len(result)} 条 (累计新增边 {len(new_edges)})')
        except Exception as e:
            print(f'  batch {i//BATCH+1} 失败: {e}')
            time.sleep(3)
        time.sleep(1.0)

    # ---------- 汇总 + 落盘 ----------
    print(f'\n=== 汇总 ===')
    print(f'新增边: {len(new_edges)}')
    print(f'新增外部人物: {len(new_persons_by_url)}')

    # 1) 追加外部人物到 persons 表
    if new_persons_by_url:
        df_new_persons = pd.DataFrame(list(new_persons_by_url.values()))
        # 补齐 persons 表所有列
        missing_cols = [c for c in persons.columns if c not in df_new_persons.columns]
        for c in missing_cols:
            df_new_persons[c] = None
        df_new_persons = df_new_persons[persons.columns]
        backup_p = DATA / 'persons.parquet.bak_before_dbpedia'
        if not backup_p.exists():
            persons.to_parquet(backup_p, index=False)
            print(f'原 persons 备份到 {backup_p}')
        persons_new = pd.concat([persons, df_new_persons], ignore_index=True)
        persons_new.to_parquet(DATA / 'persons.parquet', index=False)
        print(f'persons 更新: {len(persons)} → {len(persons_new)} 位')

    # 2) 追加边到 mentorship 表
    if new_edges:
        df_new = pd.DataFrame(new_edges)
        backup = DATA / 'mentorship.parquet.bak_before_dbpedia'
        if not backup.exists():
            mentor_existing.to_parquet(backup, index=False)
            print(f'原 mentorship 备份到 {backup}')
        combined = pd.concat([mentor_existing, df_new], ignore_index=True)
        combined.to_parquet(DATA / 'mentorship.parquet', index=False)
        students = set(combined['student_id']); advisors = set(combined['advisor_id'])
        print(f'mentorship 更新: {len(mentor_existing)} → {len(combined)} 条')
        print(f'覆盖人物: {len(students | advisors)} 位 (student+advisor 并集)')

if __name__ == '__main__':
    main()

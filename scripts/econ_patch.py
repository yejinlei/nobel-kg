"""补经济学派 + person_school 边 + 经济学范式和师承边"""
import pandas as pd
from pathlib import Path

DATA = Path('data')

# ===== 1. 新增经济学派 =====
new_schools = pd.DataFrame([
    {'school_id': 'S10', 'name_cn': '芝加哥学派', 'name_en': 'Chicago School',
     'founder_id': 'P708', 'era_start': 1933, 'core_inst': None,
     'description': '货币主义、市场效率、理性预期（弗里德曼—费雪—萨缪尔森）'},
    {'school_id': 'S11', 'name_cn': '奥地利学派', 'name_en': 'Austrian School',
     'founder_id': 'P711', 'era_start': 1932, 'core_inst': None,
     'description': '自由市场、价格信号、知识分散论（哈耶克—米塞斯）'},
    {'school_id': 'S12', 'name_cn': '剑桥学派', 'name_en': 'Cambridge School',
     'founder_id': 'P747', 'era_start': 1935, 'core_inst': None,
     'description': '福利经济学与一般均衡的数学化（庇古—萨缪尔森）'},
    {'school_id': 'S13', 'name_cn': '密歇根学派', 'name_en': 'Michigan School',
     'founder_id': 'P734', 'era_start': 1950, 'core_inst': None,
     'description': '一般均衡理论的公理化与拓扑学基础（阿罗—德布鲁）'},
    {'school_id': 'S14', 'name_cn': '哈佛经济学派', 'name_en': 'Harvard School',
     'founder_id': 'P732', 'era_start': 1960, 'core_inst': None,
     'description': '贸易理论与信息经济学（斯托尔珀—萨缪尔森—斯蒂格利茨）'},
    {'school_id': 'S15', 'name_cn': '博弈论学派', 'name_en': 'Game Theory School',
     'founder_id': 'P730', 'era_start': 1950, 'core_inst': None,
     'description': '非合作博弈与均衡存在性（纳什—海萨尼—谢林）'},
    {'school_id': 'S16', 'name_cn': '行为经济学派', 'name_en': 'Behavioral Economics School',
     'founder_id': 'P697', 'era_start': 1979, 'core_inst': None,
     'description': '启发式、前景理论、框架效应（卡尼曼—西蒙—塞勒）'},
    {'school_id': 'S17', 'name_cn': '金融经济学派', 'name_en': 'Financial Economics School',
     'founder_id': 'P760', 'era_start': 1964, 'core_inst': None,
     'description': '资产定价 CAPM/期权定价/市场效率（夏普—默顿—米勒）'},
    {'school_id': 'S18', 'name_cn': '新古典宏观学派', 'name_en': 'New Classical Macroeconomics',
     'founder_id': 'P712', 'era_start': 1973, 'core_inst': None,
     'description': '理性预期、微观基础、卢卡斯批判'},
    {'school_id': 'S19', 'name_cn': '发展经济学派', 'name_en': 'Development Economics School',
     'founder_id': 'P698', 'era_start': 1988, 'core_inst': None,
     'description': '贫困度量、能力方法与不平等（森—纳克斯—赫希曼）'},
])

existing_schools = pd.read_parquet(DATA / 'schools.parquet')
schools_new = pd.concat([existing_schools, new_schools], ignore_index=True)
schools_new.to_parquet(DATA / 'schools.parquet', index=False)
print(f'schools: {len(existing_schools)} → {len(schools_new)}')

# ===== 2. 经济学派-人物关系 =====
# 99 位经济学得主的映射（person_id → school_id 列表）
# 按学派归属分组（有代表性的核心成员）
econ_assign = {
    'S10': ['P708','P747','P710','P741','P712'],   # 芝加哥：Fama, Samuelson, Modigliani, Miller, Lucas
    'S11': ['P711','P713','P705'],                   # 奥地利：Hayek, ...
    'S12': ['P747','P710'],                          # 剑桥：Samuelson, Modigliani
    'S13': ['P734','P735'],                          # 密歇根：Arrow, Debreu
    'S14': ['P732','P736'],                          # 哈佛：Stiglitz
    'S15': ['P730','P737','P738','P739'],            # 博弈论：Nash, Harsanyi, Selten, Schelling
    'S16': ['P697','P698'],                          # 行为：Kahneman, Sen(部分)
    'S17': ['P760','P761','P741','P708'],            # 金融：Merton, Sharpe, Miller, Fama
    'S18': ['P712','P736'],                          # 新古典：Lucas, ...
    'S19': ['P698','P699'],                          # 发展：Sen
}

# 读取现有 person_school
existing_ps = pd.read_parquet(DATA / 'person_school.parquet')
print(f'person_school: {len(existing_ps)}')

new_ps_rows = []
rel_idx = len(existing_ps) + 1
for sid, pids in econ_assign.items():
    for pid in pids:
        new_ps_rows.append({
            'rel_id': f'PS{rel_idx:03d}',
            'person_id': pid,
            'school_id': sid,
            'role': 'member',
        })
        rel_idx += 1

df_new_ps = pd.DataFrame(new_ps_rows)
# 检查是否已存在
existing_keys = set(zip(existing_ps['person_id'], existing_ps['school_id']))
df_new_ps['key'] = list(zip(df_new_ps['person_id'], df_new_ps['school_id']))
df_new_ps = df_new_ps[~df_new_ps['key'].isin(existing_keys)].drop(columns=['key'])

ps_combined = pd.concat([existing_ps, df_new_ps], ignore_index=True)
ps_combined.to_parquet(DATA / 'person_school.parquet', index=False)
print(f'person_school: {len(existing_ps)} → {len(ps_combined)} (新增 {len(df_new_ps)})')

# ===== 3. 经济学范式 =====
new_paradigms = pd.DataFrame([
    {'paradigm_id': 'P_Generic_Equilibrium', 'name': '一般均衡理论',
     'founder_id': 'P747', 'founder_name': 'Leon Walras', 'year': 1874,
     'description': '从瓦尔拉斯均衡到阿罗-德布鲁公理化，奠定现代经济学基础'},
    {'paradigm_id': 'P_Keynesian', 'name': '凯恩斯主义宏观',
     'founder_id': None, 'founder_name': 'John Maynard Keynes', 'year': 1936,
     'description': '有效需求不足→失业→政府干预；IS-LM 框架与总需求管理'},
    {'paradigm_id': 'P_GameTheory', 'name': '博弈论',
     'founder_id': 'P730', 'founder_name': 'John Nash', 'year': 1950,
     'description': '纳什均衡、合作博弈、机制设计（2007 诺奖）'},
    {'paradigm_id': 'P_Monetary', 'name': '货币主义',
     'founder_id': 'P708', 'founder_name': 'Milton Friedman', 'year': 1963,
     'description': '货币供给决定通胀；菲利普斯曲线的否定；货币数量论'},
    {'paradigm_id': 'P_Behavioral', 'name': '行为经济学',
     'founder_id': 'P697', 'founder_name': 'Daniel Kahneman', 'year': 1979,
     'description': '前景理论、启发式与偏差、框架效应、有限理性'},
    {'paradigm_id': 'P_APV', 'name': '资产定价与CAPM',
     'founder_id': 'P761', 'founder_name': 'William Sharpe', 'year': 1964,
     'description': '资本资产定价模型、期权定价（Black-Scholes-Merton）'},
    {'paradigm_id': 'P_RationalExpectations', 'name': '理性预期',
     'founder_id': 'P712', 'founder_name': 'Robert Lucas', 'year': 1972,
     'description': '微观基础→卢卡斯批判→时间不一致性；DMP 货币理论'},
    {'paradigm_id': 'P_EfficientMarket', 'name': '有效市场假说',
     'founder_id': 'P708', 'founder_name': 'Eugene Fama', 'year': 1970,
     'description': '弱式-半强式-强式有效市场，异常收益的检验'},
    {'paradigm_id': 'P_Ability', 'name': '能力方法',
     'founder_id': 'P698', 'founder_name': 'Amartya Sen', 'year': 1999,
     'description': '从收入贫困到能力剥夺、Gini-森指数、不平等测度'},
    {'paradigm_id': 'P_MechanismDesign', 'name': '机制设计理论',
     'founder_id': 'P738', 'founder_name': 'Roger Myerson', 'year': 1981,
     'description': '逆向工程博弈；拍卖设计、机制实施（2007 诺奖）'},
    {'paradigm_id': 'P_InformationEcon', 'name': '信息经济学',
     'founder_id': 'P732', 'founder_name': 'Joseph Stiglitz', 'year': 1976,
     'description': '逆向选择、道德风险、信息不对称（阿克洛夫-斯彭斯-斯蒂格利茨）'},
    {'paradigm_id': 'P_TradeTheory', 'name': '现代国际贸易理论',
     'founder_id': 'P732', 'founder_name': 'Paul Krugman', 'year': 1980,
     'description': '规模报酬递增、内生贸易、新经济地理学'},
])

existing_paradigms = pd.read_parquet(DATA / 'paradigms.parquet')
print(f'\nparadigms: {len(existing_paradigms)}')
paradigms_new = pd.concat([existing_paradigms, new_paradigms], ignore_index=True)
paradigms_new.to_parquet(DATA / 'paradigms.parquet', index=False)
print(f'paradigms: {len(existing_paradigms)} → {len(paradigms_new)}')

# ===== 4. 补经济学得主的师承边（Wikidata P184 已有结果）=====
# 检查 _wikidata_p184_raw.csv 中经济学相关的边
raw = pd.read_csv(DATA / '_wikidata_p184_raw.csv')
print(f'\nWikidata P184 原始边: {len(raw)}')

# 建立 qid→pid 映射（全诺奖得主）
persons['wikidata_id'] = persons['wikidata_id'].astype(str)
qid_to_pid = dict(zip(persons['wikidata_id'].str.lstrip('Q'), persons['person_id']))
print(f'  qid→pid 映射: {len(qid_to_pid)}')

# 检查现有 mentorship
mentorship = pd.read_parquet(DATA / 'mentorship.parquet')
print(f'\nmentorship 现状: {len(mentorship)}')
print(f'  其中 source 分布:')
print(mentorship['source'].value_counts().to_string())

# -*- coding: utf-8 -*-
"""本体扩容 v1：papers / paper_author / paper_lineage / collaboration / works / person_work / paradigms
新增约 76 篇里程碑论文（化学/生医/物理）、对应 works、作者关联、影响链、合作对与范式。
所有 person_id 均已验证存在于 persons 表。幂等：按标题/主键去重。
"""
import pandas as pd
from pathlib import Path

DATA = Path('data')

# ---------- helpers ----------
def paper(pid, title, title_zh, authors, journal, year, vp, wkid, fid, note='', ptype='期刊论文', doi=None, landmark='是'):
    return {
        'paper_id': pid, 'title': title, 'title_zh': title_zh, 'authors_display': authors,
        'journal': journal, 'year': year, 'volume_pages': vp, 'doi': doi,
        'paper_type': ptype, 'is_landmark': landmark, 'work_id': wkid, 'field_id': fid, 'note': note,
    }

def work(wid, zh, en, fid, year, wtype, desc):
    return {'work_id': wid, 'name_zh': zh, 'name_en': en, 'field_id': fid, 'year': year, 'type': wtype, 'description': desc}

def pa(rid, pid_, paper_id, role='第一作者', order=1, note=None):
    return {'rel_id': rid, 'paper_id': paper_id, 'person_id': pid_, 'author_role': role, 'author_order': order, 'note': note}

def pw(rid, pid_, wkid, role='提出者', note=None):
    return {'rel_id': rid, 'person_id': pid_, 'work_id': wkid, 'role': role, 'note': note}

def lin(rid, student, advisor, itype, desc):
    return {'relation_id': rid, 'student_paper_id': student, 'advisor_paper_id': advisor, 'influence_type': itype, 'description': desc}

def col(eid, a, b, year, topic, pub):
    return {'edge_id': eid, 'person_a_id': a, 'person_b_id': b, 'year': year, 'topic': topic, 'publication': pub}

# ============================================================
# 1. papers 新增（PA069..PA144）
# ============================================================
# --- 化学（F021/F023/F017/F019/F035）---
new_papers = [
    # 大环与超分子
    paper('PA069', 'Cyclic Polyethers and Their Complexes with Metal Salts', '环状聚醚及其与金属盐的配合物', 'Charles J. Pedersen', 'Journal of the American Chemical Society', 1967, '89: 7017-7036', 'W058', 'F021', '冠醚的发现，超分子化学起点'),
    paper('PA070', 'The Design of Molecular Hosts, Guests, and Their Complexes', '分子主体、客体及其配合物的设计', 'Donald J. Cram', 'Science', 1988, '240: 760-767', 'W059', 'F021', '主客体化学与预组织原理总结'),
    paper('PA071', 'Cryptates: The Chemistry of Macropolycyclic Inclusion Complexes', '穴合物：大环多环包合化学', 'Jean-Marie Lehn', 'Accounts of Chemical Research', 1978, '11: 49-57', 'W060', 'F021', '穴醚与分子识别概念'),
    # 金属有机与聚合
    paper('PA072', 'The Structure of Iron Bis-Cyclopentadienyl', '二茂铁的夹心结构', 'Geoffrey Wilkinson, William H. Woodward, et al.', 'Journal of the American Chemical Society', 1952, '74: 2125-2126', 'W061', 'F023', '二茂铁夹心结构，金属有机化学里程碑'),
    paper('PA073', 'Das Mülheimer Normaldruck-Polyäthylen-Verfahren', '米尔海姆常压聚乙烯法（齐格勒催化）', 'Karl Ziegler', 'Angewandte Chemie', 1955, '67: 541-547', 'W062', 'F023', '低压聚乙烯与配位聚合的开端'),
    paper('PA074', 'Solid Phase Peptide Synthesis. I. The Synthesis of a Tetrapeptide', '固相多肽合成 I：四肽的合成', 'Bruce Merrifield', 'Journal of the American Chemical Society', 1963, '85: 2149-2154', 'W063', 'F035', '固相合成法，多肽/蛋白化学合成革命'),
    # 有机反应理论
    paper('PA075', 'Stereochemistry of Electrocyclic Reactions', '电环化反应的立体化学', 'R. B. Woodward, Roald Hoffmann', 'Journal of the American Chemical Society', 1965, '87: 395-397', 'W064', 'F023', '伍德沃德-霍夫曼规则'),
    paper('PA076', 'A Molecular Orbital Theory of Reactivity in Aromatic Hydrocarbons', '芳香烃反应性的分子轨道理论', 'Kenichi Fukui, T. Yonezawa, H. Shingu', 'Journal of Chemical Physics', 1952, '20: 722-725', 'W065', 'F023', '前线轨道理论的提出'),
    paper('PA077', 'Hydroboration of Olefins', '烯烃的硼氢化反应', 'Herbert C. Brown, B. C. Subba Rao', 'Journal of the American Chemical Society', 1956, '78: 5694-5700', 'W066', 'F023', '硼氢化反应，有机合成重要工具'),
    paper('PA078', 'Zur Rolle des Methyllithiums bei Umsetzungen von Alkyl-halogeniden mit Triphenylphosphin', '碘化鏻盐与苯基锂生成亚甲基三苯基膦', 'Georg Wittig, U. Schoellkopf', 'Chemische Berichte', 1954, '87: 1318-1330', 'W067', 'F023', '维蒂希反应（叶立德化学）'),
    # 烯烃复分解
    paper('PA079', 'Catalyse de transformation des oléfines par les complexes du tungstène', '钨配合物催化烯烃转化', 'J.-L. Hérisson, Yves Chauvin', 'Makromolekulare Chemie', 1971, '141: 161-176', 'W068', 'F021', '烯烃复分解的金属卡宾机制（Chauvin 机制）'),
    paper('PA080', 'Synthesis of Molybdenum Imido Alkylidene Complexes', '钼亚胺烷基叉配合物的合成', 'Richard R. Schrock, et al.', 'Journal of the American Chemical Society', 1990, '112: 3875-3876', 'W069', 'F021', 'Schrock 催化剂：高活性钼/钨卡宾'),
    paper('PA081', 'Synthesis and Applications of RuCl2(=CHR)(PR3)2', '钌卡宾配合物的合成与应用', 'Peter Schwab, Robert H. Grubbs, J. W. Ziller', 'Journal of the American Chemical Society', 1996, '118: 100-110', 'W070', 'F021', 'Grubbs 催化剂：官能团耐受的钌卡宾'),
    # 手性催化与有机催化
    paper('PA082', 'The First Practical Method for Asymmetric Epoxidation', '首个实用不对称环氧化方法', 'Tsutomu Katsuki, K. Barry Sharpless', 'Journal of the American Chemical Society', 1980, '102: 5974-5976', 'W071', 'F021', 'Sharpless 不对称环氧化'),
    paper('PA083', 'Synthesis of 2,2-Bis(diphenylphosphino)-1,1-Binaphthyl (BINAP)', 'BINAP 手性双膦配体的合成', 'Atsushi Miyashita, Ryoji Noyori, et al.', 'Journal of the American Chemical Society', 1980, '102: 7932-7934', 'W072', 'F021', 'BINAP 配体与不对称氢化'),
    paper('PA084', 'Proline-Catalyzed Direct Asymmetric Aldol Reactions', '脯氨酸催化的直接不对称羟醛反应', 'Benjamin List, R. A. Lerner, C. F. Barbas III', 'Journal of the American Chemical Society', 2000, '122: 2395-2396', 'W074', 'F021', '有机小分子催化的开创'),
    paper('PA085', 'New Strategies for Organic Catalysis: The First Highly Enantioselective Organocatalytic Diels-Alder Reaction', '有机催化新策略：首个高对映选择性有机催化 Diels-Alder 反应', 'K. A. Ahrendt, C. J. Borths, David W. C. MacMillan', 'Journal of the American Chemical Society', 2000, '122: 4243-4244', 'W075', 'F021', '亚胺离子有机催化'),
    # 点击化学
    paper('PA086', 'Click Chemistry: Diverse Chemical Function from a Few Good Reactions', '点击化学：以少数可靠反应获得多样化学功能', 'Hartmuth C. Kolb, M. G. Finn, K. Barry Sharpless', 'Angewandte Chemie International Edition', 2001, '40: 2004-2021', 'W076', 'F021', '点击化学概念'),
    paper('PA087', 'A Stepwise Huisgen Cycloaddition Process: Copper(I)-Catalyzed Regioselective Ligation of Azides and Terminal Alkynes', '铜催化叠氮-炔烃区域选择性环加成（CuAAC）', 'Valery V. Rostovtsev, Luke G. Green, Valery V. Fokin, K. Barry Sharpless', 'Angewandte Chemie International Edition', 2002, '41: 2596-2599', 'W077', 'F021', 'CuAAC：点击化学旗舰反应'),
    # 交叉偶联
    paper('PA088', 'Palladium-Catalyzed Vinylic Hydrogen Substitution Reactions with Aryl, Benzyl, and Styryl Halides', '钯催化芳基卤与烯烃的取代反应', 'Richard F. Heck, J. P. Nolley, Jr.', 'Journal of Organic Chemistry', 1972, '37: 2320-2322', 'W078', 'F023', 'Heck 反应'),
    paper('PA089', 'The Palladium-Catalyzed Cross-Coupling Reaction of Phenylboronic Acid with Haloarenes in the Presence of Bases', '碱存在下苯硼酸与卤代芳烃的钯催化交叉偶联', 'Norio Miyaura, Akira Suzuki', 'Synthetic Communications', 1981, '11: 513-519', 'W079', 'F023', 'Suzuki 偶联'),
    paper('PA090', 'Selective, Mono- or Diallylation of Organic Halides with Organozinc Reagents', '有机锌试剂与有机卤化物的选择性偶联', 'Ei-ichi Negishi, A. O. King, N. Okukado', 'Journal of the American Chemical Society', 1977, '99: 3839-3841', 'W080', 'F023', 'Negishi 偶联'),
    # 经典有机反应
    paper('PA091', 'Synthesen in der hydroaromatischen Reihe', '氢芳香族化合物的合成（Diels-Alder 反应）', 'Otto Diels, Kurt Alder', 'Justus Liebigs Annalen der Chemie', 1928, '460: 98-122', 'W081', 'F023', 'Diels-Alder 反应'),
    # 飞秒化学与电子转移
    paper('PA092', 'Real-Time Femtosecond Probing of Transition States in Chemical Reactions', '化学反应过渡态的飞秒实时探测', 'M. Dantus, M. J. Rosker, Ahmed H. Zewail', 'Journal of Chemical Physics', 1987, '87: 2395-2397', 'W082', 'F023', '飞秒化学的开端'),
    paper('PA093', 'On the Theory of Oxidation-Reduction Reactions Involving Electron Transfer. I.', '电子转移氧化还原理论 I', 'Rudolph A. Marcus', 'Journal of Chemical Physics', 1956, '24: 966-978', 'W083', 'F023', 'Marcus 电子转移理论'),
    paper('PA094', 'Observations on the Mechanism of Electron Transfer in Solution', '溶液中电子转移机制的观察', 'Henry Taube, H. Myers, R. L. Rich', 'Journal of the American Chemical Society', 1953, '75: 4118-4119', 'W084', 'F023', '内球/外球电子转移机制'),
    # 非平衡与统计
    paper('PA095', 'Self-Organization in Nonequilibrium Systems: From Dissipative Structures to Order through Fluctuations', '非平衡系统中的自组织：耗散结构', 'Gregoire Nicolis, Ilya Prigogine', 'Wiley', 1977, '专著', 'W085', 'F016', '耗散结构理论的系统阐述', ptype='专著'),
    paper('PA096', 'Reciprocal Relations in Irreversible Processes. I.', '不可逆过程中的倒易关系 I', 'Lars Onsager', 'Physical Review', 1931, '37: 405-426', 'W086', 'F016', '昂萨格倒易关系'),
    # 理论化学
    paper('PA097', 'Inhomogeneous Electron Gas', '非均匀电子气（密度泛函理论）', 'P. Hohenberg, Walter Kohn', 'Physical Review', 1964, '136: B864-B871', 'W087', 'F023', '密度泛函理论（DFT）的建立'),
    paper('PA098', 'Electronic Population Analysis on LCAO-MO Molecular Wave Functions. I.', 'LCAO-MO 分子波函数的电子布居分析', 'Robert S. Mulliken', 'Journal of Chemical Physics', 1955, '23: 1833-1840', 'W088', 'F023', 'Mulliken 布居分析'),
    paper('PA099', 'Self-Consistent Molecular-Orbital Methods. I. Use of Gaussian Expansions of Slater-Type Atomic Orbitals', '自洽分子轨道方法 I：高斯展开', 'W. J. Hehre, W. A. Stewart, John A. Pople', 'Journal of Chemical Physics', 1969, '51: 2657-2664', 'W089', 'F023', '计算化学高斯基组方法'),
    paper('PA100', 'Contact Electron-Spin Coupling of Nuclear Magnetic Moments', '核磁矩的接触电子自旋耦合', 'Martin Karplus', 'Journal of Chemical Physics', 1959, '30: 11-15', 'W090', 'F023', 'Karplus 方程（NMR 结构解析基础）'),
    paper('PA101', 'Theoretical Studies of Enzymic Reactions: Dielectric, Electrostatic, Steric Stabilization of the Carbonium Ion in the Reaction of Lysozyme', '酶反应的理论研究：QM/MM 方法', 'Arieh Warshel, Michael Levitt', 'Journal of Molecular Biology', 1976, '103: 227-249', 'W091', 'F023', 'QM/MM 组合方法的开创'),
    # 能源材料
    paper('PA102', 'Phospho-olivines as Positive-Electrode Materials for Rechargeable Lithium Batteries', '磷酸铁锂作为锂离子电池正极材料', 'A. K. Padhi, K. S. Nanjundaswamy, John B. Goodenough', 'Journal of the Electrochemical Society', 1997, '144: 1188-1194', 'W092', 'F017', 'LiFePO4 正极，动力电池基石'),
    paper('PA103', 'Electrical Energy Storage and Intercalation Chemistry', '电能储存与嵌入化学', 'M. Stanley Whittingham', 'Science', 1976, '192: 1126-1127', 'W093', 'F017', '层状 TiS2 嵌入化合物储电'),
    paper('PA104', 'Rechargeable Lithium Battery with Polyacetylene Anode', '可充电锂电池（聚乙炔负极）', 'Akira Yoshino', 'European Patent EP197259', 1985, '专利', 'W094', 'F017', '安全锂离子电池原型（石油焦炭负极）', ptype='报告'),
    # 纳米
    paper('PA105', 'Design and Synthesis of an Exceptionally Stable and Highly Porous Metal-Organic Framework', '超高稳定性多孔金属有机框架（MOF-5）', 'Omar M. Yaghi, Hailian Li, et al.', 'Nature', 1999, '402: 276-279', 'W095', 'F017', 'MOF-5，框架化学里程碑'),
    paper('PA106', 'Electron-Electron and Electron-Hole Interactions in Small Semiconductor Crystallites', '半导体小晶粒中的量子尺寸效应', 'Louis E. Brus', 'Journal of Chemical Physics', 1984, '80: 4403-4409', 'W096', 'F19'.replace('19','019'), '量子点尺寸效应理论（有效质量近似修正）'),
    paper('PA107', 'Synthesis and Characterization of Nearly Monodisperse CdE Semiconductor Nanocrystallites', '近单分散 CdE 半导体纳米晶的合成', 'Christopher B. Murray, D. J. Norris, Moungi G. Bawendi', 'Journal of the American Chemical Society', 1993, '115: 8706-8715', 'W097', 'F019', '胶体量子点合成方法学的确立'),
    # 表面化学与环境
    paper('PA108', 'Atomic and Macroscopic Reaction Rates of a Surface-Catalyzed Reaction', '表面催化反应的原子与宏观速率', 'J. Wintterlin, G. Ertl, et al.', 'Science', 1997, '278: 1931-1933', 'W098', 'F023', '单分子尺度表面催化动力学'),
    paper('PA109', 'Stratospheric Sink for Chlorofluoromethanes: Chlorine Atom-Catalysed Destruction of Ozone', '氟氯甲烷的平流层汇：氯催化臭氧破坏', 'Mario J. Molina, F. S. Rowland', 'Nature', 1974, '249: 810-812', 'W099', 'F023', 'CFC 破坏臭氧层的预言'),
    paper('PA110', 'The Influence of Nitrogen Oxides on the Atmospheric Ozone Content', '氮氧化物对大气臭氧含量的影响', 'Paul J. Crutzen', 'Quarterly Journal of the Royal Meteorological Society', 1970, '96: 320-325', 'W100', 'F023', 'NOx 与臭氧层化学'),
    paper('PA111', 'Directed Evolution of Subtilisin E in Bacillus subtilis', '枯草杆菌蛋白酶 E 的定向进化', 'Kevin Chen, Frances H. Arnold', 'Proceedings of the National Academy of Sciences', 1993, '90: 5618-5622', 'W101', 'F035', '酶定向进化方法的建立'),
]

# --- 生医（F031/F033/F034/F035/F024）---
new_papers += [
    paper('PA112', 'On the Antibacterial Action of Cultures of a Penicillium', '青霉菌培养物的抗菌作用', 'Alexander Fleming', 'British Journal of Experimental Pathology', 1929, '10: 226-236', 'W102', 'F035', '青霉素的发现'),
    paper('PA113', 'Further Observations on Penicillin', '青霉素的进一步观察（化学治疗验证）', 'E. Chain, H. W. Florey, et al.', 'The Lancet', 1941, '238: 177-188', 'W103', 'F035', '青霉素纯化与临床验证'),
    paper('PA114', 'DNA Sequencing with Chain-Terminating Inhibitors', '双脱氧链终止法 DNA 测序', 'F. Sanger, S. Nicklen, A. R. Coulson', 'Journal of Molecular Biology', 1977, '94: 441-448', 'W105', 'F034', 'Sanger 测序法'),
    paper('PA115', 'A New Method for Sequencing DNA', 'DNA 测序新方法（化学降解法）', 'Allan M. Maxam, Walter Gilbert', 'Proceedings of the National Academy of Sciences', 1977, '74: 560-564', 'W106', 'F034', 'Maxam-Gilbert 化学测序'),
    paper('PA116', 'Enzymatic Amplification of Beta-Globin Genomic Sequences and Restriction Site Analysis for Diagnosis of Sickle Cell Anemia', '珠蛋白基因的酶促扩增（PCR）', 'K. B. Mullis, et al., H. A. Erlich', 'Science', 1985, '230: 1350-1354', 'W107', 'F034', 'PCR 技术的奠基论文'),
    paper('PA117', 'Principles that Govern the Folding of Protein Chains', '支配蛋白质链折叠的原理', 'Christian B. Anfinsen', 'Science', 1973, '181: 223-230', 'W108', 'F035', '一级序列决定三维结构'),
    paper('PA118', 'Enzymatic Synthesis of Deoxyribonucleic Acid. I.', 'DNA 的酶促合成 I（DNA 聚合酶）', 'I. R. Lehman, M. J. Bessman, E. S. Simms, Arthur Kornberg', 'Journal of Biological Chemistry', 1958, '233: 163-172', 'W109', 'F035', 'DNA 聚合酶 I 的发现'),
    paper('PA119', 'Structure of Rhombohedral 2 Zinc Insulin Crystals', '斜方六面体二甲锌胰岛素晶体结构', 'M. J. Adams, T. L. Blundell, Dorothy C. Hodgkin, et al.', 'Nature', 1969, '224: 491-495', 'W110', 'F024', '胰岛素三维结构的测定'),
    paper('PA120', 'Self-Splicing RNA: Autoexcision and Autocyclization of the Ribosomal RNA Intervening Sequence of Tetrahymena', '自剪接 RNA：四膜虫 rRNA 内含子的自切除与自环化', 'K. Kruger, P. J. Grabowski, Thomas R. Cech', 'Cell', 1982, '31: 147-157', 'W114', 'F034', '核酶的发现：RNA 具有催化功能'),
    paper('PA121', 'The RNA Moiety of Ribonuclease P Is the Catalytic Subunit of the Enzyme', '核糖核酸酶 P 的 RNA 组分是催化亚基', 'C. Guerrier-Takada, K. Gardiner, Sidney Altman, et al.', 'Cell', 1983, '35: 849-857', 'W115', 'F034', 'RNA 催化的又一确证'),
    paper('PA122', 'Potent and Specific Genetic Interference by Double-Stranded RNA in Caenorhabditis elegans', '双链 RNA 对秀丽隐杆线虫的强效特异性基因沉默', 'Andrew Fire, Craig C. Mello, et al.', 'Nature', 1998, '391: 806-811', 'W116', 'F034', 'RNA 干扰现象'),
    paper('PA123', 'A Programmable Dual-RNA-Guided DNA Endonuclease in Adaptive Bacterial Immunity', '细菌适应性免疫中的可编程双 RNA 引导 DNA 内切酶', 'Martin Jinek, Emmanuelle Charpentier, Jennifer A. Doudna', 'Science', 2012, '337: 816-821', 'W117', 'F034', 'CRISPR-Cas9 体外重建，基因编辑时代开启'),
    paper('PA124', 'Suppression of RNA Recognition by Toll-Like Receptors: The Impact of Nucleoside Modification', '核苷修饰对 TLR 识别 RNA 的抑制', 'Katalin Kariko, Drew Weissman', 'Immunity', 2005, '23: 165-175', 'W118', 'F034', '修饰核苷使 mRNA 疗法成为可能'),
    paper('PA125', 'Improved Patch-Clamp Techniques for High-Resolution Current Recording from Cells', '改进膜片钳技术', 'O. P. Hamill, B. Sakmann, E. Neher, et al.', 'Pflugers Archiv', 1981, '391: 85-100', 'W119', 'F033', '膜片钳：单通道电流记录'),
    paper('PA126', 'Receptive Fields, Binocular Interaction and Functional Architecture in the Cat Visual Cortex', '猫视皮层的感受野与功能结构', 'D. H. Hubel, T. N. Wiesel', 'Journal of Physiology', 1962, '160: 106-154', 'W120', 'F031', '视皮层功能柱理论'),
    paper('PA127', 'Habituation and Dishabituation of the Gill-Withdrawal Reflex in Aplysia', '海兔缩鳃反射的习惯化', 'H. Pinsker, I. Kupfermann, Eric R. Kandel', 'Science', 1970, '167: 1740-1742', 'W121', 'F031', '记忆的分子机制研究起点'),
    paper('PA128', 'Microstructure of a Spatial Map in the Entorhinal System', '内嗅系统的空间地图微结构（网格细胞）', 'T. Hafting, M. Fyhn, Edvard I. Moser, M.-B. Moser', 'Nature', 2005, '436: 801-806', 'W122', 'F031', '网格细胞的发现'),
    paper('PA129', 'Defective LPS Signaling in C3H/HeJ and C57BL/10ScCr Mice', '内毒素耐受小鼠的 TLR4 基因突变', 'A. Poltorak, I. Smirnova, B. Beutler, et al.', 'Science', 1998, '282: 2085-2088', 'W123', 'F035', 'TLR4 为先天免疫脂多糖受体'),
    paper('PA130', 'Identification of a Specific Telomere Terminal Transferase Activity in Tetrahymena Extracts', '四膜虫提取物中端粒末端转移酶的鉴定', 'Carol W. Greider, Elizabeth H. Blackburn', 'Cell', 1985, '43: 405-413', 'W124', 'F035', '端粒酶的发现'),
    paper('PA131', 'Observations on the Function of Peroxidase Systems and the Chemistry of the Adrenal Cortex', '过氧化物酶体系与肾上腺皮质化学（己糖醛酸）', 'Albert Szent-Gyorgyi', 'Biochemical Journal', 1928, '22: 1387-1409', 'W125', 'F035', '维生素C（抗坏血酸）的分离'),
    paper('PA132', 'Metabolism of Ketonic Acids in Animal Tissues', '动物组织中酮酸的代谢（三羧酸循环）', 'H. A. Krebs, W. A. Johnson', 'Enzymologia', 1937, '4: 148-156', 'W126', 'F035', '柠檬酸循环的发现'),
]

# --- 物理（F005/F011/F013/F014/F015/F016/F017）---
new_papers += [
    paper('PA133', 'On the Theory of Stars', '论恒星（中子星理论）', 'Lev D. Landau', 'Physikalische Zeitschrift der Sowjetunion', 1932, '1: 285-288', 'W127', 'F015', '致密星理论的提出'),
    paper('PA134', 'Renormalization Group and Critical Phenomena. I.', '重整化群与临界现象 I', 'Kenneth G. Wilson', 'Physical Review B', 1971, '4: 3174-3183', 'W128', 'F016', '重整化群方法'),
    paper('PA135', 'Ordering, Metastability and Phase Transitions in Two-Dimensional Systems', '二维系统的有序、亚稳与相变（KT 相变）', 'J. M. Kosterlitz, D. J. Thouless', 'Journal of Physics C', 1973, '6: 1181-1203', 'W129', 'F016', '拓扑相变'),
    paper('PA136', 'Anomalous Quantum Hall Effect: An Incompressible Quantum Fluid with Fractionally Charged Excitations', '反常量子霍尔效应：分数量子霍尔态', 'Robert B. Laughlin', 'Physical Review Letters', 1983, '50: 1395-1398', 'W130', 'F017', '分数量子霍尔液体波函数'),
    paper('PA137', 'Fractional Quantization of the Hall Effect', '霍尔效应的分数化', 'F. Duncan M. Haldane', 'Physical Review Letters', 1983, '51: 605-608', 'W131', 'F017', '分数量子霍尔效应的推广解释'),
    paper('PA138', 'A Schematic Model of Baryons and Mesons', '重子与介子的示意模型（夸克）', 'Murray Gell-Mann', 'Physics Letters', 1964, '8: 214-215', 'W134', 'F014', '夸克模型'),
    paper('PA139', 'A Model of Leptons', '轻子模型（电弱统一）', 'Steven Weinberg', 'Physical Review Letters', 1967, '19: 1264-1266', 'W133', 'F005', '电弱统一理论的 SU(2)×U(1) 表述'),
    paper('PA140', 'Regularization and Renormalization of Gauge Fields', '规范场的正规化与重整化', 'Gerard t Hooft, M. Veltman', 'Nuclear Physics B', 1972, '44: 189-213', 'W135', 'F005', '非阿贝尔规范理论可重整化'),
    paper('PA141', 'Space-Time Approach to Non-Relativistic Quantum Mechanics', '非相对论量子力学的时空方法（路径积分）', 'Richard P. Feynman', 'Reviews of Modern Physics', 1948, '20: 367-387', 'W136', 'F011', '路径积分量子化'),
    paper('PA142', 'A Star in a 15.2-Year Orbit Around the Supermassive Black Hole at the Centre of the Milky Way', '绕银心超大质量黑洞运行的恒星轨道', 'R. Schodel, R. Genzel, et al.', 'Nature', 2002, '419: 694-696', 'W137', 'F015', 'S2 星轨道证实人马座A*'),
    paper('PA143', 'On the Magnetic Properties of Superconductors of the Second Group', '第二类超导体的磁性质', 'A. A. Abrikosov', 'Soviet Physics JETP', 1957, '5: 1174-1182', 'W138', 'F017', 'II 类超导体磁通格子理论'),
    paper('PA144', 'Possible High Tc Superconductivity in the Ba-La-Cu-O System', '镧钡铜氧体系的高温超导可能性', 'J. G. Bednorz, K. Alex Muller', 'Zeitschrift fur Physik B', 1986, '64: 189-193', 'W139', 'F017', '铜氧化物高温超导的发现'),
]

# ============================================================
# 2. works 新增（W058..W139）
# ============================================================
new_works = [
    work('W058', '冠醚化学', 'Crown ethers', 'F021', 1967, '实验', '大环聚醚与碱金属离子的选择性配位，超分子化学的起点'),
    work('W059', '主客体化学', 'Host-guest chemistry', 'F021', 1988, '理论', '预组织原理指导的分子受体设计'),
    work('W060', '穴醚与分子识别', 'Cryptands and molecular recognition', 'F021', 1978, '理论', '三维大环穴醚对离子的三维包裹与选择性'),
    work('W061', '二茂铁夹心结构', 'Ferrocene sandwich structure', 'F023', 1952, '实验', '金属夹在两个环戊二烯环之间的新型成键方式'),
    work('W062', '配位聚合', 'Coordination polymerization', 'F023', 1955, '技术', '齐格勒-纳塔低压催化聚合与等规聚丙烯'),
    work('W063', '固相多肽合成', 'Solid-phase peptide synthesis', 'F035', 1963, '技术', '在树脂载体上逐步合成长肽'),
    work('W064', '伍德沃德-霍夫曼规则', 'Woodward-Hoffmann rules', 'F023', 1965, '理论', '轨道对称性守恒决定周环反应立体化学'),
    work('W065', '前线轨道理论', 'Frontier orbital theory', 'F023', 1952, '理论', 'HOMO/LUMO 决定反应位点与活性'),
    work('W066', '硼氢化反应', 'Hydroboration', 'F023', 1956, '实验', '硼烷对烯烃的反马氏加成，醇合成新路线'),
    work('W067', '维蒂希反应', 'Wittig reaction', 'F023', 1954, '实验', '膦叶立徳与羰基化合物构建 C=C 键'),
    work('W068', '烯烃复分解', 'Olefin metathesis', 'F021', 1971, '理论', '金属卡宾介导的双键重组机制'),
    work('W069', 'Schrock 催化剂', 'Schrock catalyst', 'F021', 1990, '技术', '钼/钨亚胺烷基叉高活性复分解催化剂'),
    work('W070', 'Grubbs 催化剂', 'Grubbs catalyst', 'F021', 1996, '技术', '空气稳定官能团耐受的钌卡宾催化剂'),
    work('W071', 'Sharpless 不对称环氧化', 'Sharpless epoxidation', 'F021', 1980, '技术', '钛-酒石酸配合物催化烯丙醇不对称环氧化'),
    work('W072', 'BINAP 不对称氢化', 'BINAP asymmetric hydrogenation', 'F021', 1980, '技术', '轴手性双膦配体 BINAP 与不对称催化氢化'),
    work('W074', '脯氨酸有机催化', 'Proline organocatalysis', 'F021', 2000, '实验', '脯氨酸仿酶催化的直接不对称羟醛反应'),
    work('W075', '亚胺离子有机催化', 'Imidazolidinone organocatalysis', 'F021', 2000, '实验', '手性咪唑烷酮催化 Diels-Alder 反应'),
    work('W076', '点击化学', 'Click chemistry', 'F021', 2001, '理论', '以少数高可靠性反应连接模块的合成哲学'),
    work('W077', 'CuAAC 反应', 'CuAAC', 'F021', 2002, '实验', '一价铜催化的叠氮-炔烃点击反应'),
    work('W078', 'Heck 反应', 'Heck reaction', 'F023', 1972, '实验', '钯催化芳基卤与烯烃的偶联'),
    work('W079', 'Suzuki 偶联', 'Suzuki coupling', 'F023', 1981, '实验', '有机硼试剂与芳卤的钯催化偶联'),
    work('W080', 'Negishi 偶联', 'Negishi coupling', 'F023', 1977, '实验', '有机锌试剂的钯/镍催化偶联'),
    work('W081', 'Diels-Alder 反应', 'Diels-Alder reaction', 'F023', 1928, '实验', '共轭二烯与亲双烯体的环加成'),
    work('W082', '飞秒化学', 'Femtochemistry', 'F023', 1987, '实验', '用飞秒激光实时观测化学键断裂与过渡态'),
    work('W083', 'Marcus 电子转移理论', 'Marcus theory', 'F023', 1956, '理论', '电子转移速率与重组能的关系'),
    work('W084', '电子转移机制', 'Electron transfer mechanisms', 'F023', 1953, '实验', '内球/外球电子转移的界定'),
    work('W085', '耗散结构', 'Dissipative structures', 'F016', 1977, '理论', '远离平衡态系统通过涨落自发形成有序结构'),
    work('W086', '昂萨格倒易关系', 'Onsager reciprocal relations', 'F016', 1931, '理论', '近平衡态输运系数的对称性'),
    work('W087', '密度泛函理论', 'Density functional theory', 'F023', 1964, '理论', '以电子密度为基本变量求解多电子问题'),
    work('W088', '布居分析', 'Mulliken population analysis', 'F023', 1955, '理论', '从分子轨道波函数提取电荷分布'),
    work('W089', '高斯基组方法', 'Gaussian basis methods', 'F023', 1969, '技术', '高斯函数展开使自洽场计算实用化'),
    work('W090', 'Karplus 方程', 'Karplus equation', 'F023', 1959, '理论', '二面角与 NMR 耦合常数的定量关系'),
    work('W091', 'QM/MM 方法', 'QM/MM method', 'F023', 1976, '技术', '量子力学与分子力学组合的多尺度模拟'),
    work('W092', '磷酸铁锂正极', 'LiFePO4 cathode', 'F017', 1997, '技术', '橄榄石结构正极使动力电池安全低成本'),
    work('W093', '嵌入化学', 'Intercalation chemistry', 'F017', 1976, '理论', '离子在层状晶格中的可逆嵌入与脱出'),
    work('W094', '锂离子电池', 'Lithium-ion battery', 'F017', 1985, '技术', '碳负极-锂钴氧化物正极的安全可充电池'),
    work('W095', '金属有机框架', 'Metal-organic framework (MOF)', 'F017', 1999, '技术', '金属节点与有机配体构成的多孔晶格'),
    work('W096', '量子尺寸效应', 'Quantum size effect', 'F019', 1984, '理论', '半导体纳米晶带隙随尺寸变化的理论'),
    work('W097', '单分散纳米晶合成', 'Monodisperse nanocrystal synthesis', 'F019', 1993, '技术', '热注入法可控合成量子点'),
    work('W098', '表面催化动力学', 'Surface catalysis kinetics', 'F023', 1997, '实验', '单晶表面分子尺度反应速率研究'),
    work('W099', '臭氧层损耗化学', 'Ozone depletion chemistry', 'F023', 1974, '理论', 'CFC 光解产生氯自由基催化破坏臭氧'),
    work('W100', '大气臭氧化学', 'Atmospheric ozone chemistry', 'F023', 1970, '理论', 'NOx 循环对臭氧层的催化调控'),
    work('W101', '酶定向进化', 'Directed evolution of enzymes', 'F035', 1993, '技术', '随机突变+筛选迭代优化酶性能'),
    work('W102', '青霉素', 'Penicillin', 'F035', 1929, '实验', '青霉菌培养液抗菌物质的发现'),
    work('W103', '青霉素化学治疗', 'Penicillin chemotherapy', 'F035', 1941, '实验', '青霉素纯化、毒理与临床验证'),
    work('W105', 'Sanger 测序', 'Sanger sequencing', 'F034', 1977, '技术', '双脱氧链终止法读取 DNA 序列'),
    work('W106', '化学降解测序', 'Maxam-Gilbert sequencing', 'F034', 1977, '技术', '碱基特异性化学切割测序法'),
    work('W107', '聚合酶链式反应', 'PCR', 'F034', 1985, '技术', 'DNA 聚合酶体外指数扩增目标序列'),
    work('W108', '蛋白质折叠原理', 'Protein folding principle', 'F035', 1973, '理论', '核糖核酸酶变复性实验：序列即结构'),
    work('W109', 'DNA 聚合酶', 'DNA polymerase', 'F035', 1958, '实验', '大肠杆菌 DNA 聚合酶 I 的纯化与表征'),
    work('W110', '胰岛素结构', 'Insulin structure', 'F024', 1969, '实验', '胰岛素晶体三维结构测定'),
    work('W114', '核酶', 'Ribozyme', 'F034', 1982, '实验', 'RNA 自剪接证明 RNA 的催化功能'),
    work('W115', 'RNase P 的 RNA 催化', 'RNA catalysis in RNase P', 'F034', 1983, '实验', 'RNase P 的 RNA 组分单独具备催化活性'),
    work('W116', 'RNA 干扰', 'RNA interference', 'F034', 1998, '实验', '双链 RNA 触发的序列特异基因沉默'),
    work('W117', 'CRISPR-Cas9', 'CRISPR-Cas9', 'F034', 2012, '技术', '向导 RNA 引导 Cas9 切割任意目标 DNA'),
    work('W118', '核苷修饰 mRNA', 'Nucleoside-modified mRNA', 'F034', 2005, '理论', '假尿苷修饰抑制先天免疫激活'),
    work('W119', '膜片钳技术', 'Patch clamp', 'F033', 1981, '技术', '吉欧封接记录单个离子通道电流'),
    work('W120', '视皮层功能结构', 'Visual cortex architecture', 'F031', 1962, '实验', '感受野与眼优势柱的发现'),
    work('W121', '海兔学习记忆模型', 'Aplysia memory model', 'F031', 1970, '实验', '简单神经系统的习惯化与敏感化'),
    work('W122', '网格细胞', 'Grid cells', 'F031', 2005, '实验', '内嗅皮层六边形空间放电模式'),
    work('W123', 'TLR4 先天免疫识别', 'TLR4 innate recognition', 'F035', 1998, '实验', 'LPS 受体 TLR4 的定位克隆'),
    work('W124', '端粒酶', 'Telomerase', 'F035', 1985, '实验', '端粒重复序列末端转移酶'),
    work('W125', '维生素C', 'Vitamin C', 'F035', 1928, '实验', '肾上腺提取物中己糖醛酸（抗坏血酸）的分离'),
    work('W126', '三羧酸循环', 'Citric acid cycle', 'F035', 1937, '理论', '细胞呼吸的核心代谢环路'),
    work('W127', '中子星理论', 'Neutron star theory', 'F015', 1932, '理论', '中子发现后立即预言致密中子星'),
    work('W128', '重整化群', 'Renormalization group', 'F016', 1971, '理论', '临界现象的标度不变性与普适类'),
    work('W129', 'KT 相变', 'Kosterlitz-Thouless transition', 'F016', 1973, '理论', '二维系统涡旋对的拓扑相变'),
    work('W130', '分数量子霍尔态', 'Fractional quantum Hall state', 'F017', 1983, '理论', '不可压缩量子液体的多体波函数'),
    work('W131', '霍尔分数化', 'Fractional quantization', 'F017', 1983, '理论', '分数量子霍尔效应的理论解释'),
    work('W133', '电弱统一理论', 'Electroweak theory', 'F005', 1967, '理论', '电磁与弱相互作用的统一规范理论'),
    work('W134', '夸克模型', 'Quark model', 'F014', 1964, '理论', '强子的分数电荷夸克构成'),
    work('W135', '规范场重整化', 'Gauge field renormalization', 'F005', 1972, '理论', '非阿贝尔规范理论的维数正规化'),
    work('W136', '路径积分量子化', 'Path integral quantization', 'F011', 1948, '理论', '对所有时空路径求和的量子化表述'),
    work('W137', '银心黑洞轨道', 'Sgr A* stellar orbit', 'F015', 2002, '实验', 'S2 星 15.2 年轨道测定银心质量'),
    work('W138', 'II 类超导体', 'Type-II superconductors', 'F017', 1957, '理论', '磁通穿透的混合态与阿布里科索夫涡旋格'),
    work('W139', '铜氧化物高温超导', 'High-Tc superconductivity', 'F017', 1986, '实验', 'La-Ba-Cu-O 体系 35K 超导转变'),
]

# ============================================================
# 3. paper_author 新增（PAB 前缀）
# ============================================================
new_paper_author = [
    pa('PAB001', 'P294', 'PA069'),
    pa('PAB002', 'P301', 'PA070'),
    pa('PAB003', 'P349', 'PA071'),
    pa('PAB004', 'P321', 'PA072', '共同一作', 1),
    pa('PAB005', 'P414', 'PA072', '共同一作', 1),
    pa('PAB006', 'P365', 'PA073'),
    pa('PAB007', 'P291', 'PA074'),
    pa('PAB008', 'P414', 'PA075', '第一作者', 1),
    pa('PAB009', 'P413', 'PA075', '第二作者', 2),
    pa('PAB010', 'P367', 'PA076'),
    pa('PAB011', 'P339', 'PA077'),
    pa('PAB012', 'P322', 'PA078'),
    pa('PAB013', 'P409', 'PA080'),
    pa('PAB014', 'P416', 'PA081'),
    pa('PAB015', 'P364', 'PA082', '通讯作者', 2),
    pa('PAB016', 'P424', 'PA083', '通讯作者', 2),
    pa('PAB017', 'P288', 'PA084', '第一作者', 1),
    pa('PAB018', 'P298', 'PA085'),
    pa('PAB019', 'P364', 'PA086', '通讯作者', 3),
    pa('PAB020', 'P364', 'PA087', '通讯作者', 4),
    pa('PAB021', 'P404', 'PA088'),
    pa('PAB022', 'P275', 'PA089', '通讯作者', 2),
    pa('PAB023', 'P306', 'PA090'),
    pa('PAB024', 'P391', 'PA091', '第一作者', 1),
    pa('PAB025', 'P369', 'PA091', '第二作者', 2),
    pa('PAB026', 'P274', 'PA092', '通讯作者', 3),
    pa('PAB027', 'P423', 'PA093'),
    pa('PAB028', 'P337', 'PA094'),
    pa('PAB029', 'P342', 'PA095'),
    pa('PAB030', 'P371', 'PA096'),
    pa('PAB031', 'P446', 'PA097', '共同一作', 2),
    pa('PAB032', 'P419', 'PA098'),
    pa('PAB033', 'P363', 'PA099', '通讯作者', 3),
    pa('PAB034', 'P380', 'PA100'),
    pa('PAB035', 'P282', 'PA101', '共同一作', 1),
    pa('PAB036', 'P382', 'PA101', '共同一作', 2),
    pa('PAB037', 'P357', 'PA102', '通讯作者', 3),
    pa('PAB038', 'P376', 'PA103'),
    pa('PAB039', 'P276', 'PA104'),
    pa('PAB040', 'P389', 'PA105', '通讯作者', 1),
    pa('PAB041', 'P374', 'PA106'),
    pa('PAB042', 'P385', 'PA107', '通讯作者', 3),
    pa('PAB043', 'P327', 'PA108', '通讯作者', 2),
    pa('PAB044', 'P312', 'PA109', '通讯作者', 2),
    pa('PAB045', 'P396', 'PA110'),
    pa('PAB046', 'P313', 'PA111', '通讯作者', 2),
    pa('PAB047', 'P645', 'PA112'),
    pa('PAB048', 'P521', 'PA113', '第一作者', 1),
    pa('PAB049', 'P651', 'PA113', '通讯作者', 2),
    pa('PAB050', 'P316', 'PA114'),
    pa('PAB051', 'P445', 'PA115', '通讯作者', 2),
    pa('PAB052', 'P366', 'PA116'),
    pa('PAB053', 'P295', 'PA117'),
    pa('PAB054', 'P474', 'PA118', '通讯作者', 4),
    pa('PAB055', 'P302', 'PA119', '通讯作者', 3),
    pa('PAB056', 'P439', 'PA120', '通讯作者', 3),
    pa('PAB057', 'P425', 'PA121', '通讯作者', 3),
    pa('PAB058', 'P471', 'PA122', '共同一作', 1),
    pa('PAB059', 'P497', 'PA122', '共同一作', 2),
    pa('PAB060', 'P351', 'PA123', '通讯作者', 5),
    pa('PAB061', 'P309', 'PA123', '通讯作者', 6),
    pa('PAB062', 'P505', 'PA124', '通讯作者', 2),
    pa('PAB063', 'P483', 'PA125', '共同一作', 2),
    pa('PAB064', 'P522', 'PA125', '共同一作', 3),
    pa('PAB065', 'P502', 'PA126'),
    pa('PAB066', 'P520', 'PA127', '通讯作者', 3),
    pa('PAB067', 'P510', 'PA128', '通讯作者', 4),
    pa('PAB068', 'P484', 'PA129', '通讯作者', 3),
    pa('PAB069', 'P487', 'PA130', '第一作者', 1),
    pa('PAB070', 'P517', 'PA130', '通讯作者', 2),
    pa('PAB071', 'P460', 'PA131'),
    pa('PAB072', 'P515', 'PA132'),
    pa('PAB073', 'P186', 'PA133'),
    pa('PAB074', 'P177', 'PA134'),
    pa('PAB075', 'P154', 'PA135'),
    pa('PAB076', 'P227', 'PA136'),
    pa('PAB077', 'P117', 'PA137'),
    pa('PAB078', 'P202', 'PA138'),
    pa('PAB079', 'P246', 'PA139'),
    pa('PAB080', 'P130', 'PA140', '共同一作', 1),
    pa('PAB081', 'P225', 'PA141'),
    pa('PAB082', 'P222', 'PA142', '通讯作者', 2),
    pa('PAB083', 'P068', 'PA143'),
    pa('PAB084', 'P152', 'PA144', '共同一作', 1),
    pa('PAB085', 'P175', 'PA144', '共同一作', 2),
]

# ============================================================
# 4. person_work 新增（PWB 前缀）
# ============================================================
new_person_work = [
    pw('PWB001', 'P294', 'W058', '发现者'),
    pw('PWB002', 'P301', 'W059', '提出者'),
    pw('PWB003', 'P349', 'W060', '提出者'),
    pw('PWB004', 'P321', 'W061', '共同提出者'),
    pw('PWB005', 'P414', 'W061', '共同提出者'),
    pw('PWB006', 'P365', 'W062', '提出者'),
    pw('PWB007', 'P291', 'W063', '提出者'),
    pw('PWB008', 'P414', 'W064', '共同提出者'),
    pw('PWB009', 'P413', 'W064', '共同提出者'),
    pw('PWB010', 'P367', 'W065', '提出者'),
    pw('PWB011', 'P339', 'W066', '提出者'),
    pw('PWB012', 'P322', 'W067', '提出者'),
    pw('PWB013', 'P409', 'W069', '提出者'),
    pw('PWB014', 'P416', 'W070', '提出者'),
    pw('PWB015', 'P364', 'W071', '提出者'),
    pw('PWB016', 'P424', 'W072', '提出者'),
    pw('PWB017', 'P288', 'W074', '提出者'),
    pw('PWB018', 'P298', 'W075', '提出者'),
    pw('PWB019', 'P364', 'W076', '提出者'),
    pw('PWB020', 'P364', 'W077', '提出者'),
    pw('PWB021', 'P404', 'W078', '提出者'),
    pw('PWB022', 'P275', 'W079', '提出者'),
    pw('PWB023', 'P306', 'W080', '提出者'),
    pw('PWB024', 'P391', 'W081', '共同提出者'),
    pw('PWB025', 'P369', 'W081', '共同提出者'),
    pw('PWB026', 'P274', 'W082', '提出者'),
    pw('PWB027', 'P423', 'W083', '提出者'),
    pw('PWB028', 'P337', 'W084', '提出者'),
    pw('PWB029', 'P342', 'W085', '提出者'),
    pw('PWB030', 'P371', 'W086', '提出者'),
    pw('PWB031', 'P446', 'W087', '共同提出者'),
    pw('PWB032', 'P419', 'W088', '提出者'),
    pw('PWB033', 'P363', 'W089', '提出者'),
    pw('PWB034', 'P380', 'W090', '提出者'),
    pw('PWB035', 'P282', 'W091', '共同提出者'),
    pw('PWB036', 'P382', 'W091', '共同提出者'),
    pw('PWB037', 'P357', 'W092', '提出者'),
    pw('PWB038', 'P376', 'W093', '提出者'),
    pw('PWB039', 'P276', 'W094', '提出者'),
    pw('PWB040', 'P389', 'W095', '提出者'),
    pw('PWB041', 'P374', 'W096', '提出者'),
    pw('PWB042', 'P385', 'W097', '提出者'),
    pw('PWB043', 'P327', 'W098', '提出者'),
    pw('PWB044', 'P312', 'W099', '提出者'),
    pw('PWB045', 'P396', 'W100', '提出者'),
    pw('PWB046', 'P313', 'W101', '提出者'),
    pw('PWB047', 'P645', 'W102', '发现者'),
    pw('PWB048', 'P521', 'W103', '共同提出者'),
    pw('PWB049', 'P651', 'W103', '共同提出者'),
    pw('PWB050', 'P316', 'W105', '提出者'),
    pw('PWB051', 'P445', 'W106', '共同提出者'),
    pw('PWB052', 'P366', 'W107', '提出者'),
    pw('PWB053', 'P295', 'W108', '提出者'),
    pw('PWB054', 'P474', 'W109', '发现者'),
    pw('PWB055', 'P302', 'W110', '提出者'),
    pw('PWB056', 'P439', 'W114', '发现者'),
    pw('PWB057', 'P425', 'W115', '共同提出者'),
    pw('PWB058', 'P471', 'W116', '共同发现者'),
    pw('PWB059', 'P497', 'W116', '共同发现者'),
    pw('PWB060', 'P351', 'W117', '共同提出者'),
    pw('PWB061', 'P309', 'W117', '共同提出者'),
    pw('PWB062', 'P505', 'W118', '提出者'),
    pw('PWB063', 'P483', 'W119', '共同提出者'),
    pw('PWB064', 'P522', 'W119', '共同提出者'),
    pw('PWB065', 'P502', 'W120', '共同提出者'),
    pw('PWB066', 'P520', 'W121', '提出者'),
    pw('PWB067', 'P510', 'W122', '共同发现者'),
    pw('PWB068', 'P484', 'W123', '提出者'),
    pw('PWB069', 'P487', 'W124', '发现者'),
    pw('PWB070', 'P517', 'W124', '共同提出者'),
    pw('PWB071', 'P460', 'W125', '发现者'),
    pw('PWB072', 'P515', 'W126', '发现者'),
    pw('PWB073', 'P186', 'W127', '提出者'),
    pw('PWB074', 'P177', 'W128', '提出者'),
    pw('PWB075', 'P154', 'W129', '提出者'),
    pw('PWB076', 'P227', 'W130', '提出者'),
    pw('PWB077', 'P117', 'W131', '提出者'),
    pw('PWB078', 'P246', 'W133', '提出者'),
    pw('PWB079', 'P202', 'W134', '提出者'),
    pw('PWB080', 'P130', 'W135', '共同提出者'),
    pw('PWB081', 'P225', 'W136', '提出者'),
    pw('PWB082', 'P222', 'W137', '提出者'),
    pw('PWB083', 'P068', 'W138', '提出者'),
    pw('PWB084', 'P152', 'W139', '共同发现者'),
    pw('PWB085', 'P175', 'W139', '共同发现者'),
]

# ============================================================
# 5. paper_lineage 新增（PI039..）
# ============================================================
new_lineage = [
    lin('PI039', 'PA076', 'PA098', '继承发展', '福井在 Mulliken 分子轨道布居分析的基础上提炼前线轨道概念，将反应活性归于 HOMO/LUMO 的贡献。'),
    lin('PI040', 'PA099', 'PA098', '方法应用', '波普尔在 Mulliken 分子轨道框架上引入高斯函数展开，使自洽场计算实用化，开创计算化学。'),
    lin('PI041', 'PA101', 'PA099', '方法应用', 'Warshel-Levitt 的 QM/MM 建立在从头算与分子力学结合的思想上，与高斯基组方法共同构成现代模拟工具箱。'),
    lin('PI042', 'PA085', 'PA084', '继承发展', 'MacMillan 的亚胺催化与 List 的脯氨酸催化同期独立发表，共同确立有机小分子催化范式。'),
    lin('PI043', 'PA084', 'PA082', '范式拓展', 'List 的脯氨酸羟醛反应将 Sharpless 手性催化的金属中心模式拓展为有机分子催化，延续不对称催化传统。'),
    lin('PI044', 'PA087', 'PA086', '继承发展', 'CuAAC 是点击化学概念提出后首个满足全部标准的旗舰反应，使点击化学从理念变为通用工具。'),
    lin('PI045', 'PA081', 'PA079', '继承发展', 'Grubbs 的钌卡宾催化剂直接验证了 Chauvin 提出的金属卡宾复分解机制。'),
    lin('PI046', 'PA081', 'PA080', '继承发展', 'Grubbs 借鉴 Schrock 高活性钼钨催化剂结构，改用钌以获得对空气与官能团的耐受性。'),
    lin('PI047', 'PA089', 'PA088', '方法应用', 'Suzuki 偶联沿用 Heck 开创的钯催化偶联框架，将有机硼试剂引入构建 C-C 键。'),
    lin('PI048', 'PA090', 'PA088', '方法应用', 'Negishi 在 Heck 钯催化框架中引入有机锌试剂，扩展交叉偶联的底物范围。'),
    lin('PI049', 'PA102', 'PA103', '继承发展', 'Goodenough 的 LiFePO4 正极建立在 Whittingham 嵌入化合物储电思想之上，实现更安全的橄榄石结构。'),
    lin('PI050', 'PA104', 'PA103', '继承发展', '吉野彰受 Whittingham 嵌入化学启发，以碳材料替代金属锂负极，发明安全可充锂离子电池。'),
    lin('PI051', 'PA105', 'PA069', '范式拓展', 'Yaghi 的 MOF 将 Pedersen 冠醚的主客体化学从分子尺度拓展到晶态框架，实现永久孔道。'),
    lin('PI052', 'PA107', 'PA106', '继承发展', 'Bawendi 的热注入合成将 Brus 的量子尺寸效应理论转化为近单分散胶体量子点的制备方法。'),
    lin('PI053', 'PA116', 'PA118', '方法应用', 'PCR 依赖 Kornberg 发现的 DNA 聚合酶，用耐热聚合酶实现指数扩增。'),
    lin('PI054', 'PA122', 'PA120', '范式拓展', 'RNA 干扰的发现延续了 Cech 核酶开创的“RNA 不只是信使”范式，揭示 RNA 的调控功能。'),
    lin('PI055', 'PA123', 'PA122', '继承发展', 'CRISPR-Cas9 的向导 RNA 设计与 RNAi 一脉相承，将 RNA 引导的序列识别升级为基因编辑。'),
    lin('PI056', 'PA121', 'PA120', '相互印证', 'Altman 证明 RNase P 的 RNA 组分单独具有催化活性，与 Cech 的自剪接 RNA 相互印证 RNA 世界假说。'),
    lin('PI057', 'PA119', 'PA032', '方法应用', 'Hodgkin 沿用 Bernal 开创的蛋白质晶体学方法，将结构测定从胃蛋白酶推进到胰岛素。'),
    lin('PI058', 'PA135', 'PA134', '方法应用', 'Kosterlitz-Thouless 用 Wilson 重整化群处理二维系统，发现拓扑性涡旋相变。'),
    lin('PI059', 'PA137', 'PA136', '继承发展', 'Haldane 将 Laughlin 的分数量子霍尔液体理论推广，解释霍尔电导的分数化。'),
    lin('PI060', 'PA134', 'PA096', '继承发展', 'Wilson 的重整化群把 Onsager 建立的统计力学倒易关系传统推进到临界现象的普适性描述。'),
    lin('PI061', 'PA139', 'PA015', '范式拓展', 'Weinberg 将杨-米尔斯规范场用于统一电磁与弱相互作用，提出 SU(2)×U(1) 电弱模型。'),
    lin('PI062', 'PA140', 'PA015', '方法应用', 't Hooft-Veltman 证明 Yang-Mills 规范场可重整化，使非阿贝尔理论成为可计算框架。'),
    lin('PI063', 'PA140', 'PA139', '继承发展', 't Hooft 的重整化证明使 Weinberg 的电弱模型成为可与实验精密对照的完整理论。'),
    lin('PI064', 'PA141', 'PA010', '继承发展', 'Feynman 受 Dirac 量子力学表述启发，发展出对全部时空路径求和的路径积分量子化。'),
    lin('PI065', 'PA113', 'PA112', '继承发展', 'Florey-Chain 团队承接 Fleming 的青霉菌发现，完成纯化、毒理与临床验证。'),
    lin('PI066', 'PA133', 'PA006', '方法应用', 'Landau 在 Chadwick 发现中子后立即提出致密中子星理论，预言中子核即巨原子核。'),
]

# ============================================================
# 6. collaboration 新增（C055..）
# ============================================================
new_collaboration = [
    col('C055', 'P414', 'P321', 1952, '二茂铁夹心结构测定', 'JACS 1952'),
    col('C056', 'P414', 'P413', 1965, '电环化反应立体化学规则', 'JACS 1965'),
    col('C057', 'P418', 'P290', 2011, 'β2 肾上腺素受体晶体结构', 'Nature 2011'),
    col('C058', 'P351', 'P309', 2012, 'CRISPR-Cas9 体外重建', 'Science 2012'),
    col('C059', 'P471', 'P497', 1998, '双链 RNA 基因沉默', 'Nature 1998'),
    col('C060', 'P517', 'P487', 1985, '端粒酶的发现', 'Cell 1985'),
    col('C061', 'P483', 'P522', 1981, '膜片钳技术改进', 'Pflugers Arch 1981'),
    col('C062', 'P014', 'P015', 1953, 'DNA 双螺旋结构模型', 'Nature 1953'),
    col('C063', 'P016', 'P017', 1958, '血红蛋白/肌红蛋白结构（MRC 期间）', 'Nature 1958-1960'),
    col('C064', 'P039', 'P302', 1934, '胃蛋白酶晶体 X 射线衍射', 'Nature 1934'),
    col('C065', 'P374', 'P385', 1990, '半导体团簇量子力学（Bawendi 在 Brus 组博后）', 'Annu Rev Phys Chem 1990'),
    col('C066', 'P152', 'P175', 1986, '铜氧化物高温超导', 'Z Phys B 1986'),
    col('C067', 'P509', 'P515', 1956, '糖原磷酸化酶磷酸化调节', 'JBC 1956'),
    col('C068', 'P458', 'P469', 1952, ' squid 轴突离子电流理论', 'J Physiol 1952'),
]

# ============================================================
# 7. paradigms 新增
# ============================================================
new_paradigms = pd.DataFrame([
    {'paradigm_id': 'P_Crown', 'name': '大环主客体化学', 'founder_id': 'P294', 'founder_name': 'Charles Pedersen', 'year': 1967, 'description': '冠醚对离子的选择性配位，开创超分子化学'},
    {'paradigm_id': 'P_Supermol', 'name': '超分子化学', 'founder_id': 'P349', 'founder_name': 'Jean-Marie Lehn', 'year': 1978, 'description': '分子 beyond 分子：识别、组装与穴醚化学'},
    {'paradigm_id': 'P_Metathesis', 'name': '烯烃复分解', 'founder_id': None, 'founder_name': 'Yves Chauvin', 'year': 1971, 'description': '金属卡宾机制 → Schrock/Grubbs 催化剂'},
    {'paradigm_id': 'P_Click', 'name': '点击化学', 'founder_id': 'P364', 'founder_name': 'K. Barry Sharpless', 'year': 2001, 'description': '以少数可靠反应连接模块的合成哲学（CuAAC）'},
    {'paradigm_id': 'P_CrossCoupling', 'name': '钯催化交叉偶联', 'founder_id': 'P404', 'founder_name': 'Richard Heck', 'year': 1972, 'description': 'Heck/Suzuki/Negishi 构建 C-C 键的工具箱'},
    {'paradigm_id': 'P_Organocatalysis', 'name': '有机小分子催化', 'founder_id': 'P288', 'founder_name': 'Benjamin List', 'year': 2000, 'description': '脯氨酸/亚胺催化的不含金属不对称合成'},
    {'paradigm_id': 'P_SPPS', 'name': '固相合成', 'founder_id': 'P291', 'founder_name': 'Bruce Merrifield', 'year': 1963, 'description': '树脂载体逐步合成多肽，多肽化学革命'},
    {'paradigm_id': 'P_DFT', 'name': '密度泛函理论', 'founder_id': 'P446', 'founder_name': 'Walter Kohn', 'year': 1964, 'description': '电子密度取代波函数的多体方法'},
    {'paradigm_id': 'P_QMMM', 'name': 'QM/MM 多尺度模拟', 'founder_id': 'P282', 'founder_name': 'Arieh Warshel', 'year': 1976, 'description': '量子力学与分子力学组合模拟酶反应'},
    {'paradigm_id': 'P_Battery', 'name': '嵌入化学与锂电池', 'founder_id': 'P376', 'founder_name': 'M. Stanley Whittingham', 'year': 1976, 'description': '层状嵌入 → 锂离子电池（Goodenough/Yoshino）'},
    {'paradigm_id': 'P_QuantumDot', 'name': '胶体量子点', 'founder_id': 'P374', 'founder_name': 'Louis Brus', 'year': 1984, 'description': '量子尺寸效应 → 单分散纳米晶（Bawendi）'},
    {'paradigm_id': 'P_MOF', 'name': '金属有机框架', 'founder_id': 'P389', 'founder_name': 'Omar Yaghi', 'year': 1999, 'description': '网状化学：永久多孔晶态框架与气体存储'},
    {'paradigm_id': 'P_RNAWorld', 'name': 'RNA 催化世界', 'founder_id': 'P439', 'founder_name': 'Thomas Cech', 'year': 1982, 'description': '核酶发现：RNA 兼具信息与催化（Altman 印证）'},
    {'paradigm_id': 'P_RNAi', 'name': 'RNA 干扰', 'founder_id': 'P471', 'founder_name': 'Andrew Fire', 'year': 1998, 'description': '双链 RNA 序列特异沉默，通往 CRISPR 的 RNA 引导传统'},
    {'paradigm_id': 'P_CRISPR', 'name': 'CRISPR 基因编辑', 'founder_id': 'P351', 'founder_name': 'Jennifer Doudna', 'year': 2012, 'description': '可编程 RNA 引导的基因组编辑'},
    {'paradigm_id': 'P_mRNA', 'name': '修饰核苷 mRNA 疗法', 'founder_id': 'P505', 'founder_name': 'Drew Weissman', 'year': 2005, 'description': '假尿苷修饰绕开先天免疫，mRNA 疫苗基础'},
    {'paradigm_id': 'P_ProteinFold', 'name': '蛋白质折叠', 'founder_id': 'P295', 'founder_name': 'Christian Anfinsen', 'year': 1973, 'description': '一级序列决定三维结构的折叠原理'},
    {'paradigm_id': 'P_RG', 'name': '重整化群', 'founder_id': 'P177', 'founder_name': 'Kenneth Wilson', 'year': 1971, 'description': '临界现象的标度不变性与普适类'},
    {'paradigm_id': 'P_Topological', 'name': '拓扑相变', 'founder_id': 'P154', 'founder_name': 'J. Michael Kosterlitz', 'year': 1973, 'description': 'KT 相变与二维系统拓扑激发'},
    {'paradigm_id': 'P_FQH', 'name': '分数量子霍尔', 'founder_id': 'P227', 'founder_name': 'Robert Laughlin', 'year': 1983, 'description': '不可压缩量子液体与分数电荷激发'},
    {'paradigm_id': 'P_Quark', 'name': '夸克模型', 'founder_id': 'P202', 'founder_name': 'Murray Gell-Mann', 'year': 1964, 'description': '强子的分数电荷夸克构成'},
    {'paradigm_id': 'P_ElectroWeak', 'name': '电弱统一', 'founder_id': 'P246', 'founder_name': 'Steven Weinberg', 'year': 1967, 'description': 'SU(2)×U(1) 规范理论与希格斯机制的结合'},
    {'paradigm_id': 'P_PathIntegral', 'name': '路径积分量子化', 'founder_id': 'P225', 'founder_name': 'Richard Feynman', 'year': 1948, 'description': '时空路径求和的量子力学表述'},
    {'paradigm_id': 'P_DirectedEvo', 'name': '定向进化', 'founder_id': 'P313', 'founder_name': 'Frances Arnold', 'year': 1993, 'description': '突变-筛选迭代进化酶与结合蛋白'},
])

# ============================================================
# 执行合并与写入
# ============================================================
def append(name, new_rows, key, extra_dedup=None):
    old = pd.read_parquet(DATA / f'{name}.parquet')
    new = pd.DataFrame(new_rows)
    # 主键去重
    new = new[~new[key].astype(str).str.strip().isin(set(old[key].astype(str).str.strip()))]
    # 内容去重（可选键）
    if extra_dedup is not None and extra_dedup in old.columns:
        old_keys = set(old[extra_dedup].astype(str).str.lower().str.strip())
        new = new[~new[extra_dedup].astype(str).str.lower().str.strip().isin(old_keys)]
    merged = pd.concat([old, new], ignore_index=True)
    merged.to_parquet(DATA / f'{name}.parquet', index=False)
    print(f'{name}: {len(old)} -> {len(merged)} (+{len(merged)-len(old)})')
    return merged

papers_m = append('papers', new_papers, 'paper_id', extra_dedup='title')
works_m = append('works', new_works, 'work_id')
pa_m = append('paper_author', new_paper_author, 'rel_id')
pw_m = append('person_work', new_person_work, 'rel_id')
pl_m = append('paper_lineage', new_lineage, 'relation_id')
col_m = append('collaboration', new_collaboration, 'edge_id')
pg_m = append('paradigms', new_paradigms.to_dict('records'), 'paradigm_id')

# 类型修正
for name, col_, cast in [('papers', 'year', 'int32'), ('works', 'year', 'int32'),
                         ('collaboration', 'year', 'int32'), ('paradigms', 'year', 'int64')]:
    df = pd.read_parquet(DATA / f'{name}.parquet')
    df[col_] = pd.to_numeric(df[col_], errors='coerce').fillna(0).astype(cast)
    df.to_parquet(DATA / f'{name}.parquet', index=False)

# ---------- 完整性校验 ----------
persons = set(pd.read_parquet(DATA / 'persons.parquet')['person_id'])
errs = []
for df, cols, label in [(pa_m, ['person_id'], 'paper_author'),
                        (pw_m, ['person_id'], 'person_work'),
                        (col_m, ['person_a_id', 'person_b_id'], 'collaboration'),
                        (pg_m, ['founder_id'], 'paradigms')]:
    for c in cols:
        ids = df[c].dropna().astype(str).str.strip()
        bad = ids[~ids.isin(persons)]
        if len(bad):
            errs.append(f'{label}.{c}: {bad.unique()[:5]}')

paper_ids = set(papers_m['paper_id'])
for df, col_, label in [(pa_m, 'paper_id', 'paper_author'), (pl_m, 'student_paper_id', 'paper_lineage'), (pl_m, 'advisor_paper_id', 'paper_lineage')]:
    bad = df[col_].astype(str).str.strip()[~df[col_].astype(str).str.strip().isin(paper_ids)]
    if len(bad):
        errs.append(f'{label}.{col_}: {bad.unique()[:5]}')

work_ids = set(works_m['work_id'])
for df, col_, label in [(papers_m, 'work_id', 'papers'), (pw_m, 'work_id', 'person_work')]:
    bad = df[col_].dropna().astype(str).str.strip()[~df[col_].dropna().astype(str).str.strip().isin(work_ids)]
    if len(bad):
        errs.append(f'{label}.{col_}: {bad.unique()[:5]}')

print('\n=== 引用完整性 ===')
print('\n'.join(errs) if errs else 'OK：所有引用均有效')
print(f"\n最终规模: papers={len(papers_m)} works={len(works_m)} paper_author={len(pa_m)} "
      f"person_work={len(pw_m)} paper_lineage={len(pl_m)} collaboration={len(col_m)} paradigms={len(pg_m)}")

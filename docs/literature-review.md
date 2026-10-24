# 120mm 杀爆弹六自由度外弹道与动爆破片模型 —— 文献调研、参数标定与验证数据

- 文件：docs/literature-review.md
- 编写：literature（Team 文献研究员），2026-10-24
- 服务对象：120mm 杀爆弹 6DOF 外弹道 + 动爆破片仿真网页（physics.js）
- 引用原则：**每条文献给出可公开验证的 DOI 或 URL**；本地已下载的权威 PDF 同时给出公开来源链接并标注"可公开访问"；凡本报告自行计算（而非文献直接给出）的数字标注"【自算】"；无法核实的内容标注"**待核实**"。
- 本版最重要的更新：工作区已下载 McCoy《Modern Exterior Ballistics》全文（refs/mccoy.pdf / refs/mccoy.txt）与 Stellenbosch 大学 Cilliers 学位论文（refs/munro.pdf / refs/munro.txt）。本报告的 105mm M1 与 120mm 迫弹的全部气动系数、质量特性与 6DOF 验证数据**均直接取自 McCoy 原书表格**（附录 B、附录 C、表 9.3–9.7、例 9.2），并已逐项与本报告自算结果交叉核对。

---

## 0. 摘要：对现有模型的主要修正建议（按影响排序）

| 序号 | 参数/模型 | 现有值（physics.js） | 推荐值（文献值） | 依据 | 影响 |
|---|---|---|---|---|---|
| 1 | 赤道转动惯量 Iy | 0.58 kg·m² | **0.2319 kg·m²**（120mm 迫弹，McCoy 表 9.5）；0.2312 kg·m²（105mm M1，表 9.3） | McCoy 表 9.5/9.3 | ★★★★★ 章动/进动频率 ∝ Iy/Ix，Iy 大 2.5 倍 → 姿态运动周期与阻尼特性全错 |
| 2 | 自转 ω0 | 18 rad/s（无物理依据） | **0**（120mm 迫弹为不旋转尾翼弹，McCoy 原文："uncanted fins, and do not roll or spin at any point"）；线膛炮则 ω0=2πv0/(n d) | McCoy p.207；L-McCoy；L-Sun；L-Maree | ★★★★★ 决定是否出现 Magnus/滚转阻尼，也决定姿态运动形态 |
| 3 | 质量/口径/弹长 | 15.5 kg / 0.120 m / 0.70 m | **13.585 kg / 0.11956 m / 0.7049 m**（McCoy 表 9.5，120mm 迫弹三弹种平均值） | McCoy 表 9.5 | ★★★★★ 直接影响射程（v0=318 m/s 时 7.3 km） |
| 4 | 质心位置 xcg | 2.90D（自弹头） | **2.36D（自弹头）**：McCoy 表 9.5 质心距弹底 42.29 cm，弹长 70.49 cm → 距弹头 28.20 cm = 2.36 cal | McCoy 表 9.5【自算换算】 | ★★★★☆ 与压心一起决定静稳定裕度 |
| 5 | 亚音速 Cx0 | 0.150（Ma 0 起） | **0.119（Ma 0–0.7）/ 0.120（0.85）/ 0.122（0.87）/ 0.126（0.90）/ 0.148（0.93）/ 0.182（0.95）** | McCoy 附录 C（120mm 迫弹） | ★★★★☆ 现有值偏高约 26%，射程偏大 |
| 6 | CNα | 1.80–2.20 /rad | **1.75（Ma 0）→2.08（Ma 0.95）**（120mm 迫弹）；105mm M1 为 1.22–2.50 | McCoy 附录 C/B | ★★★☆☆ 量级基本正确，需按 Ma 细化 |
| 7 | 静稳定力矩 | mzA=−CNα(xcp−xcg)，(xcp−xcg)/d = 0.10–0.55 cal | **C_Mα/C_Lα ≈ −1.3 cal**（120mm 迫弹，Ma 0.9）；105mm M1 ≈ +2.2～3.4 cal（旋转稳定） | McCoy 附录 C/B【自算比值】 | ★★★★☆ 现有静力矩偏小 3–5 倍（Ma 0.9 时 C_Mα=−0.75 vs 文献 −2.72） |
| 8 | 俯仰阻尼 Cmq+Cmα̇ | −50（常数） | **120mm 迫弹 −22.0～−31.5（Ma 0–0.95）+ 非线性项 (C_Mq+C_Mα̇)₂ = +48～−745；105mm M1 −3.15～−9.5** | McCoy 附录 C/B | ★★★★☆ 现有常数偏大且无 Ma/攻角依赖 |
| 9 | 滚转阻尼 Clp | −0.06 | **0**（120mm 迫弹不旋转）；105mm M1 **−0.0178（Ma 0）～−0.0087（Ma 2.5）** | McCoy 附录 B | ★★★★☆ 现有值比 105mm 实测大 3–6 倍 |
| 10 | Magnus 力矩/力 | 系数 1.30（常数，形式可疑） | **120mm 迫弹：0**（不旋转）；105mm M1：C_Mpα=0.05～2.35（随 Ma、α² 查表），C_Npα=−0.34～−2.92 | McCoy 附录 B | ★★★★☆ 若采用迫弹方案应整体删除；若采用旋转弹方案须查表 |
| 11 | 陀螺稳定因子 Sg | 未计算 | 按 Sg=Ix²ω²/(4Iy q S d C_Mα) 计算并显示；McCoy 案例：105mm M1 1/18 缠度 Sg=3.1、1/25 缠度 Sg=1.6（本报告用该式复算得 3.13 与 1.62，误差 <1%）【自算】 | M01 例 9.2；E29 | ★★★☆☆ 稳定性判据缺失 |
| 12 | 大气模型 | 0–20 km 指数式 | 分段 ISA（对流层/同温层），来源 ISO 2533 / GB/T 45846-2025；本场景 20 km 足够 | S01；S02；C03 | ★★☆☆☆ 量级影响小，规范性问题 |
| 13 | 风场/科氏力 | 无 | 平均风剖面 + 阵风；科氏力 2Ω×V（40° 纬度、7 km 射程偏流约 17 m【自算】） | C03；E12；C04 | ★★★☆☆ 落点偏差 10 m 量级 |
| 14 | 破片 Gurney/Mott | β=0.305→v_G=1255 m/s；μ=m̄/2 | Gurney 公式正确；β 应≈0.15–0.25（**待核实**）；Mott 分布正确 | E13–E19 | ★★★☆☆ 破片初速偏高 10–20% |
| 15 | 破片 Cd | 分段 1.02–1.42 | 体积^(2/3) 标度 + Cd(Ma)，亚音速 1.0–1.2、跨音速峰 1.4–1.6 | E21；C05 | ★★☆☆☆ |
| 16 | 杀伤判据 | 78 J | 78 J（=58 ft·lbf；中文文献用法见 C10，原始权威出处待核实）/ 80 J（E26 可核实） | C10；E26；E27 | ★★☆☆☆ |
| 17 | 破片数 N | 420 | 800–2000 可调（真实 120mm 迫弹破片数千量级：C12 仿真 7098–7422 个；E33 实测报告正文未获取） | C12；E33；E34 | ★★☆☆☆ |

**一句话结论**：现有模型的方程框架（6DOF + Gurney + Mott）是对的，但**参数标定错位**——它把"105mm M1 量级的质量/惯量（m≈15 kg、Ix≈0.026、xcg≈2.9 cal）"配上了"120mm 口径 + 0.58 kg·m² 的赤道惯量 + 18 rad/s 的自转 + 无来源的阻尼系数"。修正路径有两条，建议网页做成可选：
- **方案 A（真实 120mm HE，推荐）**：采用 McCoy 表 9.5 + 附录 C 的 120mm **尾翼稳定、不旋转**迫弹数据（v0 102/318 m/s，射程 1010/7315 m）。
- **方案 B（旋转稳定弹的通用演示/校验）**：采用 McCoy 表 9.3 + 附录 B 的 105mm M1（v0 205/493 m/s，1/18 与 1/25 缠度，Sg=3.1/1.6，射程 3760/11500 m），作为 6DOF 内核的验证算例；此时页面应注明"演示弹为 105mm M1 量级，非 120mm"。

---

## 1. 调研方法与可访问性声明

**检索/核实手段**：Crossref API（元数据/DOI）、OpenAlex API（摘要）、web_search/web_fetch、知网阅读（read.cnki.net）、CNKI 台湾镜像、中国国家标准全文公开系统（openstd.samr.gov.cn）、ISO 官网、FAS 装备资料页；工作区本地 PDF（refs/mccoy.pdf、refs/munro.pdf，均带全文文本）。

**可访问性分级**（见文献清单"可访问性"列）：
- **A**：公开网页，可直接阅读正文/摘要/数据表（含本地 PDF + 公开来源链接）。
- **B**：元数据（作者/题名/期刊/年/卷期/DOI）可经 Crossref/OpenAlex 核实，正文需订阅或本机网络不可达。
- **C**：待核实。

**本机不可访问**：DTIC 原文 PDF（apps.dtic.mil 域名解析失败）、ScienceDirect/Springer 正文（403/重定向）、archive.org、维基百科（域名解析为非公网 IP）。因此凡"B 类"文献仅用于题录与方法学引用，不作为数值依据；**数值一律取 A 类（McCoy 原书表格、FAS 数据页、知网可读摘要、标准题录）**。

---

## 2. 文献清单

> 编号：M = 专著/学位论文（本地 PDF 可全文核验）；E = 英文期刊/会议/报告；C = 中文文献；S = 标准/公开装备数据；X = 待核实。

### 2.1 M 类：本地已下载、可全文核验的专著与学位论文

| 编号 | 作者 | 题名 | 出处/类型 | 年 | 卷期页 | DOI / URL | 可访问性 |
|---|---|---|---|---|---|---|---|
| M01 | McCoy R L | Modern Exterior Ballistics: The Launch and Flight Dynamics of Symmetric Projectiles. 2nd ed. | Atglen, PA: Schiffer Publishing（专著，本地 refs/mccoy.pdf，全文 90 万字符） | 2012（1st ed. 1999） | 第 9 章 pp.189–220；附录 B pp.218–219；附录 C p.220；例 9.2 pp.197–208；表 9.3–9.7 | 本地：refs/mccoy.pdf；公开来源（Internet Archive 扫描件）：https://archive.org/details/ModernExteriorBallisticsTheLaunchAndFlightDynamicsOfSymmetricProjectiles2ndEd.R.McCoy | A（本地可全文核验；公开链接需外网） |
| M02 | Cilliers A J（导师 Els D N J） | Modelling the external ballistics of tranquilliser darts | Stellenbosch: Stellenbosch University, MEng (Mech) 学位论文（本地 refs/munro.pdf；含 6DOF 方程表 2.1/2.2、MPM 偏流公式式 2.45/2.46） | 2021-03 | 第 2 章 pp.28–36；表 2.1、2.2、2.3；式 2.45、2.46 | 本地：refs/munro.pdf；公开来源：https://scholar.sun.ac.za/handle/10019.1/109951 | A（本地可全文核验；机构库公开） |

**M01 可直接引用的关键表格**（本报告已逐字转录，见附录 A/B）：
- 表 9.3：105mm HE M1 质量特性；表 9.4：105mm M1 8 条 6DOF 初始条件；例 9.2：105mm M1 四组射程/飞行时间/最大高度。
- 表 9.5：120mm 迫弹（M934/M930/M929 平均）质量特性；表 9.6：6 条 6DOF 初始条件；表 9.7：6 组射程/飞行时间/最大高度。
- 附录 B：105mm M1 气动系数表（BRL 记法）；附录 C：120mm 迫弹气动系数表（BRL 记法）。

**M02 可直接引用的关键内容**：体轴系气动力/力矩方程（表 2.1/2.2，含 Magnus 力、Magnus 力矩、俯仰/滚转阻尼的显式表达式）；修正质点弹道（MPM）的偏流（yaw of repose）公式：Lieske & Reiter (1966) 原式（式 2.45）与 Bradley (1990) 简化式（式 2.46）。

### 2.2 E 类：英文文献（题录可核实；正文多为 B 类）

| 编号 | 作者 | 题名 | 出处 | 年 | 卷(期):页 | DOI / URL | 可访问性 |
|---|---|---|---|---|---|---|---|
| E01 | Soencksen K, Newill J F, Plostins P | Aerodynamics of the 120-mm M831A1 projectile — Analysis of free-flight experimental data | AIAA Atmospheric Flight Mechanics Conf., AIAA 2000-4198 | 2000 | — | https://doi.org/10.2514/6.2000-4198 | B（摘要可读） |
| E02 | Guidos B J | Deflection Measurement Accuracy in a Course-Corrected 120-mm Mortar Spark Range Flight Experiment | AIAA AFM Conf., AIAA 2004-5054 | 2004 | — | https://doi.org/10.2514/6.2004-5054 | B |
| E03 | Newill J F, Garner J, Farina A, Dohrn R, Kamdar D | Launch Dynamics of the XM1002 Cartridge, 120-mm TPMP-T | US Army Research Laboratory 报告 | 2003 | — | https://doi.org/10.21236/ADA418840 | B（摘要可读） |
| E04 | Brown T G Jr, McCoy R L | Free-Flight Aerodynamic Characteristics of Three 120mm Mortar Projectiles: XM934-HE, XM930-Illuminating, XM929-Smoke | BRL Memorandum Report No. BRL-MR-3884 | 1991 | — | 见 M01 附录 C 参考文献 15（原报告题录）；DTIC 编号待核实 | C（题录见 McCoy 参考文献表） |
| E05 | DeSpirito J, Heavey K | CFD Computation of Magnus Moment and Roll-Damping Moment of a Spinning Projectile | AIAA AFM Conf., AIAA 2004-4713 | 2004 | — | https://doi.org/10.2514/6.2004-4713 | B（摘要可读） |
| E06 | Piddington M | The Effects of Magnus Moment at Subsonic Velocities on the 105mm Mortar Projectile T-53 | 技术报告（DTIC） | 1961 | — | https://doi.org/10.21236/AD0262877 | B |
| E07 | Sharma S M | On the instability of a spinning projectile due to a nonlinear Magnus moment | Proc. Indian Acad. Sci. (Eng. Sci.) | 1981 | 4(4): 449–459 | https://doi.org/10.1007/BF02896346 | B |
| E08 | Naik S D | Stability Criterion for a Finned Spinning Projectile | Defence Science Journal | 2000 | 50(1): 31–35 | https://doi.org/10.14429/dsj.50.3320 | B |
| E09 | Sun J, Chen G, Qian L, Liu T | Analysis of gun barrel rifling twist | AIP Conference Proceedings | 2017 | 1839: 020096 | https://doi.org/10.1063/1.4982461 | B |
| E10 | Maree I E Q | The Influence of Barrel Rifling Twist on the Stability of a Projectile | Computational Intelligence in Business and Economics | 2010 | pp. 613–619 | https://doi.org/10.1142/9789814324441_0072 | B |
| E11 | Ding F, Tao G, Wen P | High plateau drift characteristics of spin-stabilized projectile from individual recoilless rifle with rifling | Physics of Fluids | 2024 | 36(4) | https://doi.org/10.1063/5.0203055 | B |
| E12 | Thompson O E | Coriolis Deflection of a Ballistic Projectile | American Journal of Physics | 1972 | 40(10): 1477–1483 | https://doi.org/10.1119/1.1986873 | B |
| E13 | Gurney R W | The Initial Velocities of Fragments from Bombs, Shell and Grenades | BRL Report No. 405（DTIC 报告） | 1943 | — | https://doi.org/10.21236/ADA800105 | B |
| E14 | Mott N F, Linfoot E H | A Theory of Fragmentation | In: Grady D (ed), Fragmentation of Rings and Shells, Springer | 2006 | pp. 207–225 | https://doi.org/10.1007/978-3-540-27145-1_9 | B |
| E15 | Mott N F | A Theory of the Fragmentation of Shells and Bombs | 同上 | 2006 | pp. 243–294 | https://doi.org/10.1007/978-3-540-27145-1_11 | B |
| E16 | Grady D E | The Statistical Fragmentation Theory of N. F. Mott | AIP Conference Proceedings | 2004 | 706: 455–460 | https://doi.org/10.1063/1.1780276 | B |
| E17 | Zukas J A, Walters W P (eds) | Explosive Effects and Applications | Springer（专著） | 1998 | — | https://doi.org/10.1007/978-1-4612-0589-0 | B |
| E18 | Kennedy J E | The Gurney Model of Explosive Output for Driving Metal | In: E17 | 1998 | pp. 221–257 | https://doi.org/10.1007/978-1-4612-0589-0_7 | B |
| E19 | Catovic A | An overview of Gurney method for estimating the initial velocities of fragments for high explosive munition | Defense and Security Studies | 2021 | 1: 16–25 | https://doi.org/10.37868/dss.v1.id72 | A（开放获取；本地 refs/catovic.pdf，Table 1 已转录于 §3.6） |
| E20 | Locking P M | Accuracy of Empirical Gurney Velocity Prediction Models | 30th International Symposium on Ballistics | 2017 | — | https://doi.org/10.12783/ballistics2017/16927 | B（摘要可读） |
| E21 | Moxnes J F, Frøyland Ø | Projected Area and Drag Coefficient of High Velocity Irregular Fragments that Rotate or Tumble | 30th ISB | 2017 | — | https://doi.org/10.12783/ballistics2017/16812 | B（摘要可读） |
| E22 | Li Y, Li Y-h, Wen Y-q | Radial distribution of fragment velocity of asymmetrically initiated warhead | International Journal of Impact Engineering | 2017 | 99: 39–47 | https://doi.org/10.1016/j.ijimpeng.2016.09.007 | B |
| E23 | Wang L, Han F, Chen F | Fragment Velocity Distribution of Velocity Enhanced Warhead under Double Symmetric Initiations | Propellants, Explosives, Pyrotechnics | 2016 | 41(4): 672–681 | https://doi.org/10.1002/prep.201500234 | B |
| E24 | Konokman H E, Kesemen L | Controlling the Fragment Dispersion for a Fragmentation Warhead and its Effect on Lethality | 30th ISB | 2017 | — | https://doi.org/10.12783/ballistics2017/16910 | B（摘要可读） |
| E25 | Yan W, Jin Y, Wei W, Zheng Q | Study on Lethality Effect of Different Quality of Little Fragment to the Personnel Target | 30th ISB | 2017 | — | https://doi.org/10.12783/ballistics2017/17006 | B |
| E26 | Rettinger G | The "80 Joule criterion" reconsidered today | Forensic Science International | 2017 | 276: 64–70 | https://doi.org/10.1016/j.forsciint.2017.04.020 | B |
| E27 | Kneubuehl B P | General wound ballistics | In: Wound Ballistics, Springer | 2011 | pp. 87–161 | https://doi.org/10.1007/978-3-642-20356-5_3 | B |
| E28 | Kneubuehl B P | Exterior Ballistics | In: Ballistics: Theory and Practice, Springer | 2024 | pp. 145–291 | https://doi.org/10.1007/978-3-662-69237-0_5 | B |
| E29 | Rowland I（UAF 教学页） | The gyroscopic stability condition | 教学资料（Sg 判据） | 2001 | — | http://ffden-2.phys.uaf.edu/212fall2001_Web_projects/Isaac%20Rowland/Ballistics/Bulletflight/gyrocond.htm | A |

**E01 摘要要点**：M831A1 为美军 120mm 训练弹；首次给出其火花靶道自由飞数据与气动分析（滚转销测滚转系数）；滚转力矩很小，攻角存在发射引起的散布；总攻角—射程出现 trim "台阶"（气动不对称）。
**E05 摘要要点**：25mm 旋转稳定弹，Ma 0.4–4.5；定常 CFD 对阻力/法向力/俯仰力矩/压心误差 <10%，滚转阻尼误差 <15%；Magnus 力矩需 DES 非定常。
**E21 摘要要点**：破片 3DOF 弹道需 Cd 与迎风面积；翻滚破片用随机迎风面积期望；McCleskey(1988) 数据表明"体积的 2/3 次方"比最大迎风面积更能刻画 Cd；数值模拟验证。
**E26 要点**：80 J 判据的现代讨论（创伤弹道学）。

### 2.3 C 类：中文文献（含知网可读摘要链接）

| 编号 | 作者 | 题名 | 期刊/类型 | 年 | 卷(期):页 | DOI / URL | 可访问性 |
|---|---|---|---|---|---|---|---|
| C01 | 雷娟棉, 李田田, 黄灿 | 高速旋转弹丸马格努斯效应数值研究 | 兵工学报 | 2013 | 34(6)（页码待核实） | https://read.cnki.net/web/Journal/Article/BIGO201306010.html | A（摘要） |
| C02 | 管军, 易文俊, 刘海, 常思江, 史继刚, 刘世平 | 基于遗传-最大似然方法高速旋转弹丸阻力系数辨识 | 弹道学报 | 2016 | 28(4)（页码待核实） | https://read.cnki.net/web/Journal/Article/DDXB201604001.html | A（摘要） |
| C03 | 李臣明（导师 韩子鹏） | 高空气象与气动力对远程弹箭弹道影响的研究 | 南京理工大学博士学位论文 | 2007 | — | https://cnki.sris.com.tw/KCMS/detail/detail.aspx?filename=2007197152.nh&dbcode=CDFD&dbname=CDFD2007 | A（摘要） |
| C04 | 周红, 沈伟, 王桃芬, 陆振烟 | 科里奥利力对远射程炮弹发射的影响研究 | 物理通报 | 2025 | (6)（页码待核实） | https://read.cnki.net/web/Journal/Article/WLTB202506034.html | A（摘要） |
| C05 | 姜金佐, 徐翔云, 任王军, 宋帅, 郭斌 | 非球形破片飞行特性数值模拟研究 | 防护工程 | 2025 | (4)（页码待核实） | https://cnki.sris.com.tw/KCMS/detail/detail.aspx?filename=FHGC202504011&dbcode=CJFD&dbname=CJFD2025 | A（摘要） |
| C06 | 洪豆, 郑宇, 李文彬, 姜宁 | 破片战斗部杀伤面积影响规律研究 | 兵器装备工程学报 | 2021 | 42(5)（页码待核实） | https://www.cnki.com.cn/Article/CJFDTotal-CUXI202105007.htm | A（摘要） |
| C07 | 刘建斌, 夏金刚, 缪前树, 刘阳雄, 刘刚, 李通 | 航空火箭杀爆弹动态爆炸威力仿真分析 | 兵器装备工程学报 | 2020 | 41(8)（页码待核实） | https://www.cnki.com.cn/Article/CJFDTotal-CUXI202008019.htm | A（摘要） |
| C08 | 小口径旋转稳定弹在控制作用下的弹道特性 | （弹箭类期刊，刊名/作者待核实） | 2020 | 2020(11) | https://www.cnki.com.cn/Article/CJFDTotal-CUXI202011007.htm | C |
| C09 | 吴巍, 王长安 | 多元预制破片战斗部毁伤幅员评估方法研究 | 兵器装备工程学报（physics.js 注释所引） | 2022 | 43(S1): 113–118（卷期页待核实） | https://bzxb.cqut.edu.cn/paperinfo.aspx?paperid=10308 ；维普记录：http://lib.cqvip.com/Qikan/Article/Detail?id=7107465462 | C（站点返回 202 空页） |

**C01 摘要要点**：三维 N-S + 滑移网格，给出 Magnus 力/力矩系数随攻角变化规律，与实验符合较好。
**C02 摘要要点**：遗传-最大似然法由自由飞行速度数据辨识零升阻力系数 Cx0，供射表编制与飞行控制。
**C03 摘要要点**：建立 80 km 内高空标准风场、30–80 km 温度/密度/气压模型、地转风公式；讨论赤道阻尼力矩的章动/进动阻尼差异与极限圆锥运动；WKB 法解变系数攻角方程。
**C05 摘要要点**：非球形破片翻滚的迎风面积/形状效应；建立圆柱、立方破片 Cd(Ma) 模型，与试验最大相对误差 <3.5%。
**C07 摘要要点**：炸高 15 m 以内、落速 200–500 m/s、落角 10°/60° 的动态爆炸威力参数化研究。

### 2.4 S 类：标准与公开装备数据（数值验证用）

| 编号 | 机构/来源 | 题名 | 类型 | 年 | 关键数据 | URL | 可访问性 |
|---|---|---|---|---|---|---|---|
| S01 | ISO | ISO 2533:1975 Standard Atmosphere | 国际标准（108 页） | 1975 | 标准大气（ISO 型）定义，含 0–80 km | https://www.iso.org/standard/7472.html | A（题录+摘要） |
| S02 | 国家市场监督管理总局/国家标准委 | GB/T 45846-2025《标准大气》 | 推荐性国家标准（采标 ISO，ICS 49.020，2025-06-30 发布、2025-10-01 实施、现行） | 2025 | 中国现行标准大气 | https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=537B269BEAE022B51D25992B6CF67538 | A（题录） |
| S03 | FAS | M933/M934, 120mm HE Cartridge | 公开装备资料页 | 1998 | 分档 v0=101/165/220/270/318 m/s；最大射程 1000/2500/4100/5800/7200 m；全弹 13.65 kg | https://man.fas.org/dod-101/sys/land/m933.htm | A |
| S04 | FAS | M120 120mm Mortar | 公开装备资料页 | 2000 | 滑膛、发射尾翼稳定弹；最大射程 7200 m | https://man.fas.org/dod-101/sys/land/m120.htm | A |
| S05 | FAS | 2S9 — 120mm SO-120 SPH/Mortar | 公开装备资料页 | — | 常规弹 8.8 km、增程 12.8 km | https://man.fas.org/dod-101/sys/land/row/2s9.htm | A |
| S06 | FAS | M109 155mm SP Howitzer | 公开装备资料页 | — | 155mm 弹 98 lb≈44.5 kg；M185 23.5 km、M284 30 km | https://man.fas.org/dod-101/sys/land/m109.htm | A |
| S07 | Military Periscope | 120-mm M256 (USA) | 公开装备资料页 | — | M256/Rh-120 为滑膛炮 | https://www.militaryperiscope.com/weapons/artillery/combat-vehicle-guns/120-mm-m256-usa/overview/ | A |
| S08 | FAS | M107 155mm Projectile | 公开装备资料页 | 1999 | 仅定性描述 | https://man.fas.org/dod-101/sys/land/m107.htm | A |

### 2.5 补充文献（第二轮核实，2026-10-24）

> 为补齐"120mm 杀爆弹破片参数、Mott/Gurney 工程模型、78 J 判据"三处缺口，第二轮检索新增以下文献（题录均已核实）。

| 编号 | 作者 | 题名 | 出处 | 年 | 卷(期):页 | DOI / URL | 可访问性 |
|---|---|---|---|---|---|---|---|
| E30 | Gold V M | Engineering Model for Design of Explosive Fragmentation Munitions | DTIC 技术报告 | 2007 | — | https://doi.org/10.21236/ADA462991 | B（题录可核实；正文未获取） |
| E31 | Gold V | Modeling Fragmentation Performance of Large L/D (Length over Diameter) Explosively Driven Metal Shells | 30th International Symposium on Ballistics | 2017 | — | https://doi.org/10.12783/ballistics2017/16958 | B（题录；有 PDF 链接） |
| E32 | Orłowski M, Rogala A, Sweklej P, Magier M | Analysis of the Influence of Heat and Mechanical Treatment on the Fragmentation of 120 mm High-Explosive Mortar Shells. Part I — Characteristics of Selected 120 mm Mortar Shells | Problemy Techniki Uzbrojenia | 2024 | 169(2): 7–27 | https://doi.org/10.5604/01.3001.0054.6650 | B |
| E33 | Orłowski M, Drozd W, Sweklej P, Magier M | Analysis of the Influence of Heat and Mechanical Treatment on the Fragmentation of 120 mm High-Explosive Mortar Shells. Part II — Ballistic Tests on Fragmentation of Mortar Projectiles Shells | Problemy Techniki Uzbrojenia | 2024 | 170(3): 39–64 | https://doi.org/10.5604/01.3001.0054.7454 | B |
| E34 | Philipchuk V | Comparison on Lethal Fragments from Brandt 120 MM Mortar and 4.2 in. Mortar Shell M329 | DTIC 技术报告 | 1952 | — | https://doi.org/10.21236/AD0121957 | B |
| E35 | Cullis I G, Dunsmore P, Harrison A, Lewtas I, Townsley R | Numerical simulation of the natural fragmentation of explosively loaded thick walled cylinders | Defence Technology | 2014 | 10(2): 198–210 | https://doi.org/10.1016/j.dt.2014.06.003 | B |
| E36 | Goto D M, Becker R, Orzechowski T J, Springer H K, Sunwoo S, Syn C K | Investigation of the fracture and fragmentation of explosively driven rings and cylinders | International Journal of Impact Engineering | 2008 | 35: 1547–1556 | https://doi.org/10.1016/j.ijimpeng.2008.07.081 | B |
| C10 | 李昆, 冯昌林, 南海, 高立龙, 李媛媛, 陈春燕 | 浇注PBX装药爆炸壳体破片分布特性 | 科学技术与工程 | 2023 | 23(17): 7335–7340 | DOI 10.12404/j.issn.1671-1815.2023.23.17.07335；摘要页 http://www.stae.com.cn/ch/reader/view_abstract.aspx?file_no=2209094&flag=1 | A（摘要+题录可核实；DOI 为期刊自有前缀，Crossref 未收录） |
| C11 | 李国杰, 王成龙, 郭志威, 李响, 黄广炎 | 轴向增强战斗部端部惰性填充物对端部破片飞散特性的影响 | 爆炸与冲击 | 2022 | 42(8): 082202 | https://doi.org/10.11883/bzycj-2021-0281 | A（期刊 HTML 页可读题录/摘要） |
| C12 | Pamungkas R, Noerpamoengkas A, Ismail A Y | Studi Numerik Fragmentasi Shell Body Mortar Bomb 120 mm dengan Variasi Bahan Shell Body dan Bahan Peledak Menggunakan Metode SPH | Prosiding SENASTITAN（印尼会议论文集） | 2026 | Vol. 6 | https://ejurnal.itats.ac.id/senastitan/article/view/9497 | A（摘要可读；**低权威：学生会议论文、纯数值仿真**） |

**新增文献中的关键信息（均按可核实程度标注）**

- **C10（78 J 判据的中文文献用法）**：用 Payman 模型 + 试验统计不同壁厚下破片数量/质量分布，并比较有效杀伤距离；文中明确使用判据"**对于人员目标，破片动能大于 78 J 的为杀伤破片**"（该句来自该文 PDF 的检索索引文本；题录与摘要已由期刊官网核实）。→ 网页 78 J 判据可引 C10 作为中文来源；美军原始权威出处仍待核实。
- **E32/E33（120mm HE 迫弹真实破碎试验）**：波兰军事技术学院（WAT）团队对 120mm 高爆迫弹的热处理/机械处理影响做 I/II 两部分研究，Part II 为破碎弹道试验。题录已 Crossref 核实；本机未获取正文。→ 若需 120mm 迫弹破片实测数值（数量/质量分布/初速），**E33 是首选目标文献**。
- **E34（1952 年 120mm 迫弹破片对比报告）**：Brandt 120mm 迫弹与 4.2 英寸 M329 杀伤破片对比，说明 120mm 迫弹破片数据早在 1950 年代即有专门试验报告；题录已核实，正文未获取。
- **E30（Gold 2007 工程模型）**：其公开索引片段含 Mott 分布 N_j(m) = N_0j·exp[−(m/√μ_j)^{1/2}] 与 μ_j 含壳体/炸药参数的表达式；本机无法获取正文 → Mott μ 的**结构化出处**确定，但具体公式仍标"待核实"。
- **C12（120mm 迫弹 SPH 破碎仿真）**：4 种材料组合（S45C/A36 × RDX/TNT）下碎片数 **7098–7422 个**、最大碎片质量 **289–443 g**、特征速度 **1792–2102 m/s**。这是**数值仿真值**（碎片数受 SPH 粒子尺度影响，通常大于实际"有效破片"数），但支持"真实 120mm 迫弹破片为数千量级"的量级判断 → physics.js 默认 N=420 明显偏小。
- **E35/E36**：爆炸加载厚壁圆筒自然破碎的现代数值/试验方法（Gurney、Mott 模型标定的常用校验对象）。

### 2.6 X 类：待核实条目（不计入正式引用编号）

| 条目 | 说明 |
|---|---|
| 120 毫米迫击炮杀伤爆破弹设计（学位论文，万方 D315191） | 仅检索到题录（https://d.wanfangdata.com.cn/thesis/D315191 ），作者/年份/内容**待核实**。 |
| Brown T G Jr, McCoy R L. BRL-MR-3884（120mm 迫弹自由飞气动数据） | McCoy 附录 C 参考文献 15 给出题录，DTIC 编号与全文**待核实**；其数据已由 McCoy 附录 C 表格间接核实。 |
| 《弹箭与制导学报》小口径旋转稳定弹论文（C08） | CNKI 页面可开但刊名/作者/卷期需再核。 |
| 吴巍, 王长安（C09） | 题录存在，卷期页待核实。 |
| 78 J 判据的美军权威原文（MIL-STD/TM 级） | 已找到中文文献明确使用 78 J 判据（C10，题录/摘要可核实）；美军原始出处未取得；可核实的相近判据是 80 J（E26），二者实质一致（78 J = 58 ft·lbf）。 |
| 120mm 迫弹破片数量/平均破片质量/装药质量 | 未取得可核实的**实测**数值；McCoy 表 9.5 只给质量/惯量。可参考：C12 的 SPH 仿真（碎片 7098–7422 个、最大碎片 289–443 g、特征速度 1792–2102 m/s，属仿真值）；E33/E34 为实测报告（正文未获取）。 |

---

## 3. 关键公式摘录

### 3.1 六自由度刚体外弹道（McCoy 第 9 章形式）

McCoy 书中的矢量形式（式 9.8、9.9，M01 第 9 章）：

~~~
dV/dt = (1/m)·[ F_aero + m·g + m·A_coriolis + T_thrust + ... ]      (9.8)
dh/dt = (1/I_y)·ΣM + ...                                            (9.9)
h = H/I_y，H 为角动量；h 的分量与 [1,2,3] 弹体系角速度相关
~~~

Cilliers 学位论文（M02 表 2.1/2.2）给出的体轴系展开形式（可直接照抄实现）：

~~~
力（体轴系，V 为相对气流速度矢量，Ω 为体轴角速度，ω_x 为自转）：
  阻力      F_D   = −C_D·(ρA/2)·V·V_r
  升力      F_L   =  C_L·(ρA/2)·[ (V²·e_z − V_x·V) ]_r
  Magnus 力 F_NP  =  C_NP·(ρA/2)·d·[ ω_x·(0, V_z, −V_y) ]_r
  俯仰阻尼力 F_Nq+α̇ = C_Nq+α̇·(ρA/2)·d·V·[ (0, Ω_z, −Ω_y) ]_r

力矩（体轴系）：
  翻转力矩  M_α     = C_Mα·(ρA/2)·d·V·[ (0, V_z, −V_y) ]_r
  俯仰力矩  M_Mq+α̇ = C_Mq+α̇·(ρA/2)·d²·V·[ (0, Ω_y, Ω_z) ]_r
  滚转阻尼  M_LP    = C_LP·(ρA/2)·d²·V·[ (ω_x, 0, 0) ]_r
  滚转驱动力矩 M_LS = C_LS·(ρA/2)·d²·V·[1, 0, 0]^T
  Magnus 力矩 M_MP  = C_MP·(ρA/2)·d²·[ ω_x·(0, V_y, V_z) ]_r
~~~

四元数运动学与归一化（M02 式 2.32–2.35）：q̇ = ½ q ⊗ (0, Ω)，每步归一化。

> 注意：McCoy 附录 B/C 采用 **BRL 气动弹道学记法**（各系数的归一因子与"是否含 1/2、ωd/V 还是 ωd/(2V)"有关，见 M01 第 9 章式 9.10–9.15 及其定义）。移植时必须统一归一因子并在代码中写清，否则同一数值会差 2 倍。

### 3.2 陀螺稳定因子 Sg（McCoy 例 9.2 参数可复现）

~~~
Sg = Ix²·ω² / (4·Iy·q∞·S·d·C_Mα)          C_Mα 为翻转力矩系数（per rad，基于 S、d）
等价：Sg = (Ix·ω)² / (4·Iy·M_α)，M_α = q∞·S·d·C_Mα
~~~

【自算校核】用 McCoy 表 9.3 的 105mm M1 数据（Ix=0.02326 kg·m²、Iy=0.23118、d=0.1048 m、S=8.627×10⁻³ m²、C_Mα=3.75@Ma0.602、ρ=1.225、V=205 m/s）：
- 1/18 缠度：ω=2π·205/(18×0.1048)=683.0 rad/s → Sg=3.13（McCoy 原文 3.1 ✓）
- 1/25 缠度：ω=491.8 rad/s → Sg=1.62（McCoy 原文 1.6 ✓）
即公式与数据一致，误差 <1%；该式可直接用于网页的 Sg 显示。判据：Sg>1 为必要条件，工程上取 1.2–1.5 以上（E29）；McCoy 指出 1.5–1.6 对 105mm M1 是"essentially an optimum value"（M01 p.198）。

### 3.3 膛线缠距与炮口自转

~~~
缠角：tanγ = πd/(n·d) = π/n  →  γ = arctan(π/n)
自转：ω0 = 2π·v0/(n·d)   [rad/s]；n_rpm = 60·v0/(n·d)
~~~

【自算】105mm M1（d=0.1048 m）：v0=205 m/s 时 1/18→683 rad/s、1/25→492 rad/s；v0=493 m/s 时 1/18→1642 rad/s、1/25→1182 rad/s。
【自算】120mm（d=0.12 m）：v0=450 m/s 时 n=18/20/25→1309/1178/942 rad/s。
120mm 迫弹：**不旋转**（无缠角尾翼，M01 p.207 原文）；120mm 坦克炮 M256 为滑膛（S07）；英制 120mm L11 为线膛（具体缠度**待核实**）。

### 3.4 标准大气（ISA / GB/T 45846-2025 / ISO 2533）

~~~
0–11 km：T=288.15−0.0065h [K]；p=101325·(T/288.15)^5.25588 [Pa]
         ρ=p/(287.05287·T)；a=sqrt(1.4·287.05287·T)
11–20 km：T=216.65 K；p=p11·exp(−g(h−11000)/(R·T))
0–80 km 完整分层：见 ISO 2533:1975（S01）与 GB/T 45846-2025（S02）
高空气象/风场：见 C03（30–80 km 温度/密度/气压模型，80 km 标准风场，地转风）
~~~

### 3.5 风场与科氏力

- 平均风剖面（工程常用幂律）：U(z)=U10·(z/10)^α，α≈0.14（开阔地）～0.4（粗糙地表）。**该幂律为通用工程做法，本报告未找到弹道学专门出处，标注为"工程模型"**；规范做法见 C03 的标准风场+地转风。
- 科氏加速度：**a_C = −2·Ω×V**，Ω=7.292115×10⁻⁵ rad/s；水平面内量级 a≈2Ω·sinφ·V。
- 【自算】120mm 迫弹（v0=318 m/s、45°、纬度 40°、飞行 41 s）：a≈2.1×10⁻² m/s²，侧偏≈½at²≈**17 m**（约为 7.3 km 射程的 0.23%）。风（10 m/s 平均风）造成的落点偏差同量级。

### 3.6 Gurney 公式（破片初速）

~~~
圆柱形壳体：v_G = √(2E)·sqrt( β/(1+β/2) )，  β = C/M

Gurney 常数 √(2E)（实验值，取自 E19 = Catovic 2021, Table 1，转引 Cooper；本地 refs/catovic.pdf）：
  TNT 2370 | Tritonal (80/20) 2320 | Comp B 2700 | Comp A-3 2630 | Comp C-3 2680
  RDX 2830 | Octol (75/25) 2800 | Octogen 2800 | PETN 2930 | LX-14 2970 | Tetril 2500
  （单位 m/s；同表还给出密度与爆速，例如 TNT 1630 kg/m³ / 6860 m/s、Comp B 1710 / 7890）
工程常用值：TNT √(2E)=2440 m/s（2E=5.95 MJ/kg）。
注意：TNT 的实验表值 2370 m/s 与常用工程值 2440 m/s 相差 +3%，即破片初速有约 ±3% 的常数不确定度。
其他装药与结构形式见 E13/E17/E18/E19；Gurney 常数经验预测方法精度见 E20。
~~~

【自算】按现有 physics.js 参数：β=3.2/10.5=0.3048，v_G=sqrt(5.95e6×0.3048/1.1524)=1254.4 m/s（与代码注释一致）。若按真实 120mm 迫弹 β≈0.15–0.25（**装药质量待核实**），v_G≈1030–1150 m/s。

### 3.7 Mott 破片质量分布

~~~
N(>m) = N0·exp(−sqrt(m/μ))；平均质量 m̄ = 2μ
逆 CDF 采样：m = μ·[ln(1/(1−F))]²
（E14/E15/E16；Mott 参数 μ 与壁厚/材料/装药比的关系原式待核实，本报告建议用 μ=M_casing/(2N) 自洽标定）
~~~

### 3.8 破片外弹道、MPM 偏流与杀伤判据

~~~
破片：m·dV/dt = −½ρ·C_D(Ma)·A_p·|v|·v − m·g
      A_p ≈ k·(m/ρ_steel)^(2/3)（体积^(2/3) 标度，E21/C05）
修正质点弹道（MPM）偏流（yaw of repose）：
      Bradley(1990)（M02 式 2.46）：β_R = 2·Ix·ω_x·(g×V) / (ρ·A·d·V⁴·C_Mα)
      Lieske & Reiter(1966)（M02 式 2.45）：含 C_L、C_NP、C_MP 的完整式（见 M02 第 34 页）
杀伤判据：E = ½mv²；78 J（=58 ft·lbf，权威原文待核实）/ 80 J（E26，可核实）
~~~

---

## 4. 参数推荐表

> 两套方案：**A = 120mm 迫弹（尾翼稳定、不旋转，McCoy 表 9.5 + 附录 C）**，**B = 105mm M1（旋转稳定，McCoy 表 9.3 + 附录 B）**。网页若定位"120mm 杀爆弹"，默认用 A；B 作为 6DOF 内核的验证算例/可选演示弹。
> "现有值"取自 physics.js 的 SHELL/AERO 常量。

| 参数 | 现有值 | 推荐 A：120mm 迫弹 | 推荐 B：105mm M1 | 依据 | 备注/置信度 |
|---|---|---|---|---|---|
| 质量 m | 15.5 kg | **13.585 kg** | 14.97 kg | M01 表 9.5/9.3 | 高（原书值） |
| 口径 d | 0.120 m | **0.11956 m** | 0.1048 m | 同上 | 高 |
| 弹长 L | 0.70 m | **0.7049 m** | 0.4947 m | 同上 | 高 |
| 极转动惯量 Ix | 0.026 kg·m² | **0.02335** | 0.02326 | 同上 | 高 |
| 赤道转动惯量 Iy | 0.58 kg·m² | **0.23187** | 0.23118 | 同上 | 高（现有值偏大 2.5 倍） |
| 质心（自弹底） | — | **0.4229 m** | 0.1834 m | 同上 | 高 |
| 质心（自弹头，口径） | 2.90D | **2.36D**（=0.2820 m / 0.11956） | 2.97D（=0.3113 m / 0.1048） | 同上【自算换算】 | 高 |
| 自转 ω0 | 18 rad/s | **0** | 2π·v0/(n·d)：1/18 缠度 → 205 m/s 时 683 rad/s、493 m/s 时 1642 rad/s；1/25 → 492 / 1182 rad/s | M01 p.207/表 9.4；【自算】 | 高 |
| 初速 v0 | 450 m/s | **102 / 318 m/s**（装药 0 / 4）；实弹最大 318 m/s | **205 / 493 m/s**（装药 1 / 7） | M01 表 9.6/9.4 | 高 |
| Cx0 ≡ C_D0 | 0.150（Ma 0） | 0.119（Ma 0–0.7）→0.126（0.90）→0.148（0.93）→0.182（0.95） | 0.124（Ma 0–0.875）→0.200（0.965）→0.350（0.990）→0.415（1.19 峰）→0.276（2.5） | M01 附录 C/B | 高（原表） |
| Cx 非线性项 | 1.35·α²（经验） | C_Dδ2：2.32（Ma 0）→2.87（0.7）→5.20（0.95） | C_Dδ2：3.2（Ma 0–0.88）/6.3（0.97）/4.0（0.99）/5.0（1.15）/5.4（1.25）/5.5（1.3–2.5） | M01 附录 C/B | 高 |
| CNα（C_Lα） | 1.80–2.20 | 1.75（Ma 0）→1.95（0.6）→2.08（0.95） | 1.63（Ma 0–0.4）→1.41（0.7）→1.22（0.89）→1.73（0.99）→1.57（1.09）→1.97（1.5）→2.25（2.0）→2.50（2.5） | M01 附录 C/B | 高 |
| 翻转力矩 C_Mα | mzA=−CNα(xcp−xcg)（线性） | **−0.02（Ma 0）→−1.02（0.4）→−1.62（0.6）→−2.72（0.9）→−2.71（0.95）** | +3.55（Ma 0）→+3.96（0.87）→+4.85（0.925）→+3.75（2.5） | M01 附录 C/B | 高 |
| 静稳定裕度 (xcp−xcg)/d | 0.10–0.55 cal | **≈−1.3 cal（压心在质心后，尾翼稳定）**（C_Mα/C_Lα，Ma 0.9） | **≈+2.2 cal**（3.55/1.63，Ma 0）；≈+3.4 cal（4.85/1.43 插值，Ma 0.925）；≈+2.3 cal（4.0/1.73，Ma 0.99） | 【自算比值】 | 高（比值口径一致时） |
| 俯仰阻尼 (C_Mq+C_Mα̇) | −50（常数） | **−22.0（Ma 0）→−24.2（0.9）→−31.5（0.95）**；非线性项 +48→−745 | **−3.15（Ma 0/0.79）→−9.1（1.15）→−9.5（1.55）** | M01 附录 C/B | 高（原表，注意归一） |
| 滚转阻尼 C_lp | −0.06 | **0**（不旋转） | **−0.0178（Ma 0）→−0.0135（0.7）→−0.0087（2.5）** | M01 附录 B | 高 |
| Magnus 力矩 C_Mpα | 1.30（常数） | **0**（不旋转） | 0.05–2.35（按 Ma 与 α_t² 查表；见附录 A） | M01 附录 B | 高 |
| Magnus 力 C_Npα | — | **0** | −0.34～−2.92（按 Ma 与 α_t² 查表） | M01 附录 B | 高 |
| 陀螺稳定因子 Sg | 未计算 | 不适用（不旋转） | 用 §3.2 公式；McCoy：1/18=3.1、1/25=1.6；本报告复算 3.13/1.62 | M01 例 9.2；【自算】 | 高 |
| 装药/壳体质量 | 3.2 / 10.5 kg | **待核实**（真实 120mm 迫弹装药约 1.4–2.0 kg 量级，β≈0.15–0.25） | 105mm M1 装药质量**待核实** | 无可靠公开值 | 低 |
| Gurney √(2E) | √5.95e6=2440 | 2440（TNT）；Comp B≈2700 | 同左 | E13/E17/E18/E19 | 高（TNT）/中（Comp B） |
| 大气 | 0–20 km 指数式 | 分段 ISA；20 km 足够（弹道高 ≤2.1 km @318 m/s） | 分段 ISA；Chg7/70°弹道高 6 km，20 km 足够 | S01/S02；C03 | 高 |
| 风场 | 无 | 平均风剖面+阵风；10 m/s 风对 7 km 射程影响 ~10–20 m 量级 | 同左 | C03 | 中 |
| 科氏力 | 无 | a=−2Ω×V；40°/7 km 偏流≈17 m【自算】 | 同左（Chg7/70° 71 s 飞行，偏流更大） | E12/C04 | 高（公式） |
| 破片 Cd | 1.02–1.42 分段 | 亚音速 1.0–1.2、跨音速峰 1.4–1.6、超音速 1.2–1.3；体积^(2/3) 面积 | 同左 | E21/C05 | 中 |
| Mott μ | m̄/2（m̄=10.5 kg/420） | 保持 μ=M_casing/(2N)；N 可调 | 同左 | E14/E15/E16 | 中（自洽约束） |
| 破片数 N | 420 | **800–2000 可调**，并注明"全部破片/有效破片"口径 | 同左 | C12（仿真 7098–7422 个）；E33/E34（实测报告，正文未获取） | 低（数值不确定） |
| 杀伤判据 | 78 J | 78 J / 80 J 可选 | 同左 | C10（78 J 中文用法）；E26（80 J） | 中 |
| 炸高 hBoom | 12 m | 5–15 m（VT 引信典型；C07 研究范围 ≤15 m） | 同左 | C07 | 中 |

---

## 5. 验证数据表（McCoy 原书算例 + 公开弹道数据）

### 5.1 105mm HE M1 旋转稳定弹（McCoy 例 9.2；6DOF，海平面 ICAO 标准大气、无风）

**表 9.3 质量特性**：d=104.8 mm；L=49.47 cm；m=14.97 kg；Ix=0.02326 kg·m²；Iy=0.23118 kg·m²；质心距弹底 18.34 cm。

**表 9.4 初始条件**（8 条，均 1st max yaw=3.0°）：

| 序号 | 缠度 | 装药 | v0 (m/s) | QE (°) | 炮口角速度 ω_ζ0 (rad/s) | Sg |
|---|---|---|---|---|---|---|
| 1 | 1/18 | 1 | 205 | 45 | 1.44 | 3.1 |
| 2 | 1/18 | 1 | 205 | 70 | 1.47 | 3.1 |
| 3 | 1/18 | 7 | 493 | 45 | 3.61 | 3.1 |
| 4 | 1/18 | 7 | 493 | 70 | 3.64 | 3.1 |
| 5 | 1/25 | 1 | 205 | 45 | 0.76 | 1.6 |
| 6 | 1/25 | 1 | 205 | 70 | 0.79 | 1.6 |
| 7 | 1/25 | 7 | 493 | 45 | 1.97 | 1.6 |
| 8 | 1/25 | 7 | 493 | 70 | 1.98 | 1.6 |

**验证结果（1/18 缠度，20 条 6DOF 轨迹的代表值）**：

| 装药 | v0 (m/s) | QE (°) | 射程 R (m) | 飞行时间 t_f (s) | 最大弹道高 (m) |
|---|---|---|---|---|---|
| 1 | 205 | 45 | **3760** | **≈28.5**（略大于） | **≈1000** |
| 1 | 205 | 70 | **≈2320** | **≈38.5** | **≈1750** |
| 7 | 493 | 45 | **≈11500** | **≈52.5**（略大于） | **3460** |
| 7 | 493 | 70 | **7300** | **≈70.5** | **略大于 6000** |

> 原文为"approximately/slightly over"，表中加 ≈ 的为原书文字值。1/25 缠度的轨迹"与 1/18 差别不显著"（原书说明）。

### 5.2 120mm 迫弹（M934/M930/M929 平均；McCoy 表 9.5–9.7；6DOF，海平面 ICAO、无风）

**表 9.5 质量特性**：参考直径 119.56 mm；弹长 70.49 cm；质量 13.585 kg；Ix=0.02335 kg·m²；Iy=0.23187 kg·m²；质心距弹底 42.29 cm。

**表 9.6 初始条件**：装药 0（v0=102 m/s）ω_ζ0=0.913 rad/s、1st max yaw=8.0°；装药 4（v0=318 m/s）ω_ζ0=1.795 rad/s、1st max yaw=3.0°。

**表 9.7 验证结果**：

| 序号 | 装药 | v0 (m/s) | QE (°) | 飞行时间 (s) | 射程 (m) | 最大弹道高 (m) |
|---|---|---|---|---|---|---|
| 1 | 0 | 102 | 45 | 14.6 | **1010** | **260** |
| 2 | 0 | 102 | 65 | 18.6 | **770** | **420** |
| 3 | 0 | 102 | 85 | 20.5 | **165** | **510** |
| 4 | 4 | 318 | 45 | 41.4 | **7315** | **2100** |
| 5 | 4 | 318 | 65 | 52.6 | **5570** | **3380** |
| 6 | 4 | 318 | 85 | 57.7 | **1275** | **4070** |

> 该表是**最适合 120mm 杀爆弹网页的验证基准**：v0=318 m/s、45° → 7.3 km、41.4 s、2.1 km 高。
> 原书同时给出：120mm 迫弹为"uncanted fins, and do not roll or spin at any point"；85° 高射角时弹道顶点处平面俯仰角可达 47°（装药 0）或 13°（装药 4），说明**高射角下大攻角是真实物理现象**，网页不应把攻角简单当作数值噪声。

### 5.3 公开弹道数据对照（FAS，S03）

| 装药号 | v0 (m/s) | 最小/最大射程 (m) | 本报告质点弹道反演 Cx0_eff【自算】 | 反演最大高 (m)【自算】 | 反演飞行时间 (s)【自算】 |
|---|---|---|---|---|---|
| 0 | 101 | 200 / 1000 | 0.094 | 246 | 14.2 |
| 1 | 165 | 500 / 2500 | 0.101 | 632 | 22.7 |
| 2 | 220 | 850 / 4100 | 0.109 | 1073 | 29.6 |
| 3 | 270 | 1200 / 5800 | 0.105 | 1555 | 35.6 |
| 4 | 318 | 1600 / 7200 | 0.122 | 2013 | 40.5 |

> 反演条件：m=13.0 kg、d=0.120 m、射角 44°、常值 Cx0（2 自由度质点弹道）。
> 与 McCoy 附录 C 的 C_D0=0.119–0.126（Ma 0–0.9）对比：反演值 0.094–0.122 与之吻合（低装药端偏低是因为沿程 Ma 低、实际 C_D0 略低，且质点弹道忽略了升力/攻角阻力）。这**交叉验证了附录 C 表与 FAS 射程数据的一致性**，同时说明现有 physics.js 亚音速 Cx0=0.150 偏高约 25%。
> 若网页坚持用 m=15.5 kg，则等效 Cx0 需提高约 19%（15.5/13），即亚音速 0.11–0.15——**质量与阻力在质点弹道层面退化**，必须同时约束。

### 5.4 其他口径量级对照

| 平台/弹种 | 口径 | 弹丸质量 | v0 | 射程 | 来源 |
|---|---|---|---|---|---|
| M120 迫击炮（M933/M934） | 120 mm | 全弹 13.65 kg | 101–318 m/s | 最大 7200 m | S03/S04 |
| 2S9 自行迫榴炮 | 120 mm | — | — | 常规 8.8 km、增程 12.8 km | S05 |
| M109A2/A3/A4（M185，23 倍） | 155 mm | 98 lb≈44.5 kg | — | 23 500 m | S06 |
| M109A5/A6（M284，39 倍） | 155 mm | 98 lb≈44.5 kg | — | 30 000 m | S06 |
| M256/Rh-120 坦克炮 | 120 mm | 按弹种 | — | 直射 | S07 |

### 5.5 现有网页默认参数与验证基准的差距【自算】

| 配置 | v0 | m | Cx0 | 射角 | 射程 | 最大弹道高 | 飞行时间 |
|---|---|---|---|---|---|---|---|
| 现有网页默认 | 450 m/s | 15.5 kg | 0.150 | 45° | **11.6 km** | 3.59 km | 53.9 s |
| 现有质量+文献阻力 | 450 m/s | 15.5 kg | 0.120 | 45° | 12.6 km | 3.81 km | 55.6 s |
| 推荐 A（120mm 迫弹） | 318 m/s | 13.585 kg | 0.122 | 45° | **7.30 km** | 2.10 km | 41.3 s |
| McCoy 6DOF 基准（表 9.7） | 318 m/s | 13.585 kg | 附录 C | 45° | **7.315 km** | 2.10 km | 41.4 s |

结论：现有默认射程约为真实 120mm 迫弹的 1.6 倍。**建议默认改为推荐 A**，450 m/s 档作为"自定义/扩展"选项。

---

## 6. 模型假设与适用范围（可直接用于网页"模型与文献"面板）

**建议面板文字：**

> **本模型基于以下假设与文献依据。**
>
> 1. **刚体假设**：弹丸视为质量、质心、转动惯量均恒定的轴对称刚体；6DOF 方程为 McCoy《Modern Exterior Ballistics》(2nd ed., 2012) 第 9 章形式，气动系数的定义与归一化采用该书的 BRL 记法（附录 B/C）。
> 2. **气动模型**：采用"小攻角线性项 + sin²α_t 非线性项"的工程气动模型：C_D=C_D0+C_Dδ2·sin²α_t、C_Lα=C_Lα0+C_Lα2·sin²α_t、C_Mα=C_Mα0+C_Mα2·sin²α_t，俯仰阻尼同式；120mm 迫弹方案数据取自 McCoy 附录 C（BRL 跨音速靶道自由飞试验，Brown & McCoy, BRL-MR-3884），105mm M1 方案取自附录 B。该模型适用于 Ma≤0.95（迫弹方案）或 Ma≤2.5（105mm 方案）的**小攻角（一般 α_t<10°）**范围；超过约 15° 的大攻角（高射角弹道顶点）只能定性参考。
> 3. **旋转/不旋转**：120mm 迫弹为无缠角尾翼弹，全程不旋转、无 Magnus 效应；105mm M1 为线膛旋转稳定弹，含 Magnus 力矩/力、滚转阻尼与陀螺稳定因子 Sg。若页面选择"旋转弹"方案，须给出缠度并计算 Sg（Sg>1 为稳定必要条件）。
> 4. **大气与风**：标准大气采用 ISA（ISO 2533:1975 / GB/T 45846-2025）；20 km 以上不建模。风场为"平均风 + 阵风"简化模型，非标准气象条件。
> 5. **地球模型**：平面地球 + 常值重力（9.80665 m/s²）+ 可选科氏力（−2Ω×V），不含重力偏心、地球曲率与离心力；对 7 km 级射程误差 <1 m，可忽略；对 >20 km 射程需改用椭球地球模型。
> 6. **破片模型**：Gurney 初速公式（BRL Report 405；Zukas & Walters 1998）+ Mott 质量分布（Mott & Linfoot, 1943/2006 重印）+ 三区飞散角经验模型 + 破片阻力弹道（Cd(Ma)，体积^(2/3) 迎风面积）。破片参数（装药/壳体质量、飞散角分区）为工程设定，**非特定型号实测值**。Gurney 常数取 2440 m/s（工程常用值），实验表值 TNT 为 2370 m/s（E19 Table 1），故破片初速存在约 ±3% 的常数不确定度。
> 7. **验证范围**：6DOF 外弹道内核已用 McCoy 例 9.2（105mm M1，4 组）与表 9.7（120mm 迫弹，6 组）校验；破片模块无同型号实测数据，仅做量级与守恒校核。**本模型用于教学演示与趋势分析，不用于射表编制或实弹射击诸元计算。**

---

## 7. 对网页实现的具体建议

### 7.1 参数分层

**写死（物理常数/标准）**：g0=9.80665 m/s²；Ω=7.292115×10⁻⁵ rad/s；ISA 分段公式（S01/S02）；TNT 的 Gurney 常数 2440 m/s（工程常用值；实验表值 2370 m/s，E19，见 §3.6）。

**做成"平台预设 + 可调"**：
- 预设 A：120mm 迫弹（表 9.5 质量/惯量、附录 C 气动、v0=102 或 318 m/s、spin=0、不旋转）。
- 预设 B：105mm M1（表 9.3、附录 B、v0=205/493 m/s、缠度 1/18 或 1/25、按公式算 spin）。
- 预设 C：自定义（用户改 m、d、Ix、Iy、xcg、气动表）。
- 风（平均风 + 阵风，默认 0 或 5 m/s）、科氏力（开关 + 纬度，默认 40°N）、炸高（默认 8–12 m）、破片数、装药/壳体质量、杀伤判据（78/80/100 J）。

**诊断输出**：Sg、α_t(t)、章动/进动、最大动压、最大 Ma、偏流/风偏、破片速度衰减曲线、R50/R90 及其定义。

### 7.2 气动实现（关键改动）

1. 用 **C_D0(Ma)、C_Dδ2(Ma)** 两张表替代单一 Cx0，计算 C_D = C_D0 + C_Dδ2·sin²α_t。
2. 用 **C_Lα0/C_Lα2、C_Mα0/C_Mα2** 替代 "CNα·α + mzA·α" 线性模型；120mm 迫弹的 C_Mα 是负值（稳定），105mm M1 是正值（翻转）。
3. 俯仰阻尼用 **(C_Mq+C_Mα̇)0 + (…)2·sin²α_t** 表；滚转阻尼 C_lp 表；120mm 迫弹方案这两项中 C_lp 置 0。
4. Magnus：120mm 迫弹方案置 0；105mm 方案用附录 A 的 C_Npα、C_Mpα 表（按 Ma 与 α_t² 双线性插值）。
5. 所有系数的归一因子在代码注释中写明（BRL 记法，见 M01 第 9 章）。
6. **数值步长**：105mm M1 在 1/18 缠度、493 m/s 时自转 1642 rad/s，章动频率约 10² rad/s 量级；当前 1 ms RK4 对平动足够，但姿态/角速度建议子步 Δt≤0.1–0.2 ms，否则章动会被数值耗散。McCoy 例 9.2 的 105mm 轨迹用 0.5 ms 级步长（HTRAJ 程序）即可收敛。

### 7.3 破片模块

- Gurney：β 由质量输入导出（不要让 β 独立可调）；120mm 迫弹 β 待核实，建议默认 0.2 并标注。
- Mott：μ=M_casing/(2N)，质量守恒归一（现有代码已做）。
- 破片数 N：真实 120mm 迫弹破片为数千量级（C12 仿真 7098–7422 个；E33/E34 为实测报告、正文未获取），默认 N=420 偏小，建议 800–2000 可调并注明口径。
- 飞散角：三区模型保留，但把"区权重/轴向速度折减"做成可调，并注明来源为工程经验（E22/E23/E24 可作对照）。
- 破片 Cd：改为 Cd(Ma) 表 + 体积^(2/3) 迎风面积（E21/C05）。
- 输出：给出 R90 的明确定义（等权/有效破片/杀伤概率），避免歧义。

---

## 8. 待核实清单（禁止当作文献值使用）

1. 120mm 迫弹的装药质量、壳体质量、装药/壳体比、破片数/平均破片质量（McCoy 表 9.5 不含；无公开可核实值）。
2. 120mm 各型号的膛线缠度（120mm 迫弹不旋转；120mm 坦克炮 M256 为滑膛；英制 L11 线膛缠度未取得可核实来源）。
3. 120mm 迫弹在 Ma>0.95 的气动系数（附录 C 止于 Ma 0.95，因为实弹 v0≤318 m/s；若网页把 v0 调到 450 m/s，需外推并标注）。
4. 78 J 判据的权威原始出处（已找到中文文献明确使用：C10；可核实的相近判据为 80 J，E26；二者实质一致）。
5. R90 的统一定义。
6. Mott 参数 μ 的经验公式（壁厚/材料/装药比）原式。
7. Gurney 常数原始表：已用 **E19（Catovic 2021, Table 1，开放获取，本地 refs/catovic.pdf）**补齐可核实的二级来源（TNT 2370、Comp B 2700、RDX 2830、PETN 2930、LX-14 2970 m/s 等，见 §3.6）；Gurney 原始报告/DTIC ADA134347 Table 4 或 CPIA-194 的"原始值"仍待补（PDF 不可读）。
8. Brown & McCoy BRL-MR-3884 的 DTIC 编号与全文。
9. 吴巍/王长安（C09）与万方学位论文 D315191 的完整题录。
10. 网页若采用"120mm 旋转稳定杀爆弹"配置（既非迫弹也非 105mm M1），其质量/惯量/气动数据无直接文献来源，只能由 105mm M1 或 120mm 迫弹按相似律缩放，需明确标注为"估算"。
11. Mott 参数 μ 的经验式：结构化出处为 E30（Gold 2007，正文未获取），具体表达式仍待核实；本报告建议用 μ=M_casing/(2N) 自洽标定。

---

## 附录 A：McCoy 附录 B —— 105mm HE M1 气动系数表（BRL 记法，原书 p.218–219）

外形：全弹长 4.72 cal，1 cal=104.8 mm。组合公式（原书注）：
C_D = C_D0 + C_Dδ2·sin²α_t；C_Lα = C_Lα0 + C_Lα2·sin²α_t；C_Mα = C_Mα0 + C_Mα2·sin²α_t；α_t=sqrt(α²+β²)。
注：105mm M1 的 C_lp 与 (C_Mq+C_Mα̇) **不随总攻角变化**。

**A1. 阻力、滚转阻尼、升力**

| Ma | C_D0 | Ma | C_Dδ2 | Ma | C_lp | Ma | C_Lα0 | Ma | C_Lα2 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | .124 | 0 | 3.2 | 0 | −.0178 | 0 | 1.63 | 0 | 0.1 |
| .875 | .124 | .88 | 3.2 | .43 | −.0149 | .4 | 1.63 | .2 | 0.1 |
| .925 | .150 | .97 | 6.3 | .70 | −.0135 | .7 | 1.41 | .6 | 3.5 |
| .965 | .200 | .99 | 4.0 | .91 | −.0126 | .89 | 1.22 | .8 | 6.6 |
| .990 | .350 | 1.15 | 5.0 | 1.4 | −.0110 | .99 | 1.73 | .985 | 9.2 |
| 1.025 | .375 | 1.25 | 5.4 | 1.75 | −.0101 | 1.09 | 1.57 | 1.09 | 8.8 |
| 1.085 | .415 | 1.3 | 5.5 | 2.1 | −.0094 | 1.5 | 1.97 | 1.3 | 12.0 |
| 1.19 | .415 | 2.1 | 5.5 | 2.5 | −.0087 | 2.0 | 2.25 | 1.5 | 13.7 |
| 1.35 | .385 | 2.5 | 5.5 | — | — | 2.5 | 2.50 | 2.0 | 16.0 |
| 1.80 | .335 | — | — | — | — | — | — | 2.5 | 17.0 |
| 2.0 | .318 | — | — | — | — | — | — | — | — |
| 2.5 | .276 | — | — | — | — | — | — | — | — |

> 校核说明（2026-10-24 复核）：上表已按原书 p.218 的高分辨率扫描逐格核对；其中 **C_Dδ2 的跨音速峰值为 Ma 0.99 处 4.0（不是 9.9）**、末端 Ma 2.1–2.5 为 5.5（不是 2.1）；C_Lα0/C_Lα2 的 Ma 序列分别为 0/.4/.7/.89/.99/1.09/1.5/2.0/2.5 与 0/.2/.6/.8/.985/1.09/1.3/1.5/2.0/2.5。physics.js 的 AERO_SPIN120 与本次核对结果一致。

**A2. 翻转力矩与俯仰阻尼**

| Ma | C_Mα0 | Ma | C_Mα2 | Ma | (C_Mq+C_Mα̇) |
|---|---|---|---|---|---|
| 0 | 3.55 | 0 | −2.9 | 0 | −3.15 |
| .46 | 3.55 | .4 | −2.9 | .79 | −3.15 |
| .61 | 3.76 | .45 | −3.1 | 1.15 | −9.1 |
| .78 | 3.92 | .65 | −4.4 | 1.55 | −9.5 |
| .87 | 3.96 | .78 | −3.45 | — | — |
| .925 | 4.85 | .885 | −1.78 | — | — |
| .97 | 4.0 | .98 | −3.0 | — | — |
| 1.09 | 3.83 | 1.075 | −2.1 | — | — |
| 1.5 | 3.75 | 1.25 | −3.325 | — | — |
| 2.5 | 3.75 | 1.5 | −4.45 | — | — |
| — | — | 2.0 | −4.6 | — | — |
| — | — | 2.5 | −4.6 | — | — |

**A3. Magnus 力系数 C_Npα（随 Ma 与 α_t² 变化）**

| Ma | α_t² (deg²) | C_Npα |
|---|---|---|
| 0 | 0 | −.34 |
| 0 | 632 | −.91 |
| 0 | 908 | −1.42 |
| 0 | 1316 | −2.63 |
| .22 | 0 | −.34 |
| .22 | 632 | −.91 |
| .22 | 908 | −1.42 |
| .22 | 1316 | −2.63 |
| .31 | 0 | −.125 |
| .31 | 21.4 | −.465 |
| .31 | 364.5 | −.503 |
| .31 | 638 | −1.015 |
| .31 | 1316 | −2.92 |
| .48 | 0 | −.34 |
| .48 | 348.5 | −.591 |
| .48 | 1316 | −2.45 |
| .999 | 0 | −.34 |
| .999 | 348.5 | −.591 |
| .999 | 1316 | −2.45 |
| 1.001 | 0 | −.36 |
| 1.001 | 706 | −1.68 |
| 1.55 | 0 | −.36 |
| 1.55 | 706 | −1.68 |

**A4. Magnus 力矩系数 C_Mpα（随 Ma 与 α_t² 变化）**

| Ma | α_t²=0 | 27.5 | 315.3/322.2 | 375.2/403.6 | 410.8 | 630.2/637.7 | 705.7/743.9 | 915.9 | 1316 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | .10 | — | — | .173 | — | .345 | — | — | 2.35 |
| .22 | .10 | — | — | .173 | — | .345 | — | — | 2.35 |
| .31 | .10 | — | — | .133 | — | .471 | — | 1.276 | 2.35 |
| .48 | −.46 | .08 | — | .022 | — | — | — | — | .94 |
| .81 | −.46 | .08 | — | .022 | — | — | — | — | .94 |
| .87 | .4175 | — | .053 | — | — | — | .285 | — | — |
| .92 | .4175 | — | .053 | — | — | — | .285 | — | — |
| .96 | .3747 | — | .05 | — | — | — | — | — | .665 |
| .995 | .3747 | — | .05 | — | — | — | — | — | .665 |
| 1.02 | .20 | — | — | .301 | — | — | — | — | — |
| 1.1 | .20 | — | — | .301 | — | — | — | — | — |
| 1.21 | .193 | — | — | .50 | — | — | .445 | — | — |
| 1.28 | .193 | — | — | .50 | — | — | .445 | — | — |
| 1.46 | .215 | — | — | — | .495 | — | — | — | — |
| 1.55 | .215 | — | — | — | .495 | — | — | — | — |

> 说明：A3/A4 的原表按"Ma + α_t²(Deg.²)"列出少量离散点（原书即如此，不是完整二维网格）；网页实现时用双线性插值，并在 α_t² 超过 1316 deg²（≈36°）时取端值外推并提示"超出验证范围"。表中"—"为原表未给出的组合。

---

## 附录 B：McCoy 附录 C —— 120mm 迫弹气动系数表（BRL 记法，原书 p.220）

外形：全弹长 5.90 cal，1 cal=119.56 mm。**不旋转尾翼弹**：所有系数随总攻角变化（原书注）。
组合公式同附录 A。

**B1. 阻力**

| Ma | C_D0 | Ma | C_Dδ2 |
|---|---|---|---|
| 0 | .119 | 0 | 2.32 |
| .7 | .119 | .4 | 2.44 |
| .85 | .120 | .6 | 2.66 |
| .87 | .122 | .7 | 2.87 |
| .90 | .126 | .75 | 3.01 |
| .93 | .148 | .85 | 3.55 |
| .95 | .182 | .90 | 4.03 |
| — | — | .95 | 5.20 |

**B2. 升力与翻转力矩**

| Ma | C_Lα0 | C_Lα2 | C_Mα0 | C_Mα2 |
|---|---|---|---|---|
| 0 | 1.75 | 14.8 | −.02 | −15.1 |
| .4 | — | — | −1.02 | — |
| .45 | — | — | — | −15.1 |
| .5 | — | 14.8 | — | — |
| .6 | 1.95 | 4.5 | −1.62 | −12.7 |
| .63 | — | 1.4 | — | — |
| .7 | — | 0.4 | — | −8.5 |
| .75 | — | — | — | −4.5 |
| .8 | 2.02 | 8.8 | −2.41 | 1.5 |
| .85 | — | — | — | 13.9 |
| .9 | 2.06 | 28.3 | −2.72 | 30.2 |
| .92 | — | — | −2.75 | — |
| .95 | 2.08 | 40.0 | −2.71 | 59.9 |

**B3. 俯仰阻尼**

| Ma | (C_Mq+C_Mα̇)0 | Ma | (C_Mq+C_Mα̇)2 |
|---|---|---|---|
| 0 | −22.0 | 0 | +48 |
| .8 | −21.1 | .5 | −46 |
| .85 | −21.9 | .6 | −86 |
| .9 | −24.2 | .7 | −144 |
| .92 | −26.8 | .8 | −259 |
| .95 | −31.5 | .85 | −357 |
| — | — | .9 | −468 |
| — | — | .95 | −745 |

> 注意：120mm 迫弹的俯仰阻尼非线性项在 Ma 0.9 附近达 −468～−745，比线性项大 1–2 个量级——这是大攻角下（高射角弹道顶点）强阻尼的体现，**不应忽略**。

---

## 附录 C：本报告自算值与交叉校核汇总

| 项目 | 公式/条件 | 结果 | 与文献对比 |
|---|---|---|---|
| Sg（105mm M1，1/18，Chg1） | Sg=Ix²ω²/(4Iy q S d C_Mα)，ω=683.0 rad/s | **3.13** | McCoy 3.1 ✓（差 1%） |
| Sg（105mm M1，1/25，Chg1） | ω=491.8 rad/s | **1.62** | McCoy 1.6 ✓ |
| Gurney 现有参数 | β=0.3048，√2E=2440 | **1254.4 m/s** | 与代码注释 1254 一致 ✓ |
| 现有默认射程 | v0=450、m=15.5、Cx0=0.15、45° | **11.6 km** | 远超真实 120mm（7.2–7.3 km） |
| 120mm 迫弹推荐射程 | v0=318、m=13.585、d=0.11956、Cx0=0.122、QE=45° | **7.30 km / 2.10 km / 41.3 s** | McCoy 6DOF：7.315 km / 2.10 km / 41.4 s（差 **<0.2%**）✓ |
| 科氏偏流 | 2Ωsinφ·v，40°、41 s、v_h≈225 m/s | **≈17 m** | 无直接文献值可对比，量级合理 |
| 静态裕度（120mm 迫弹） | C_Mα/C_Lα @Ma0.9 | **−1.32 cal** | 原表直接比值 |
| 静态裕度（105mm M1） | C_Mα/C_Lα @Ma0 | **+2.18 cal** | 原表直接比值 |


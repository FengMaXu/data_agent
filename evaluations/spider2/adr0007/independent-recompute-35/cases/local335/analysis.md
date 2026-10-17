# local335：积分单位与赛季constructor归属未唯一识别
## 结论
独立冻结Williams6、Toro Rosso5、Sauber3、Minardi3、Jordan2（第五按id）；原同分数但姓名排序第五Arrows2。Gold名称Williams/Jordan/Toro Rosso/Arrows/Minardi。真实实验找到两种互不相同、都足以重现Gold集合的口径，不能唯一说原漏了哪个条件。
## 原题与独立算法
“In Formula 1 seasons since 2001, considering only drivers who scored points in a season”；“their drivers scored the fewest total points among all point-scoring drivers in that season”。无业务文档。主解释总积分为driver-season全年累计，正积分车手取最低全部并列；其同年实际参赛constructor算该季，constructor-year去重。2001包含；2024只至round12，计划race24未全部有结果。前三项验证见plan、授权SQL/CSV/freeze。
## 真实数据库验证
各年最后积分榜与results+sprint积分逐车手完全相符；SUM累计积分榜是错误替代：Williams8、Toro Rosso2、Sauber2、Minardi2等，不解释Gold。只race积分仍主结果；生涯constructor归属错误候选Williams9/Renault6等；末队归属Williams6/ToroRosso5/Sauber3/Jordan2/Minardi2；按司机计季使Williams7，因2022Latifi与de Vries同2分，但constructor仅一季。上述SQL与返回全部保存。
关键转队反例：2002 Frentzen全年2分，Arrows2/Sauber0；2003 Wilson全年1分，Jaguar1/Minardi0。按全部同年参赛归属会计Sauber2002与Minardi2003。
## Gold重建的非唯一性
候选A保留全年司机积分，但constructor必须该司机当季在其队获得>0分：Williams6/Toro Rosso5，Arrows、Jordan、Minardi、Sauber各2，按姓名截5得到Gold名称，Sauber被排除。
候选B先按year+driver+constructor求正积分，再按每年该粒度取最小：Williams6/Toro Rosso5/Jordan3/Arrows2/Minardi2/Sauber2；同样按姓名截5得到Gold。其新增Jordan2001来自Alesi在Jordan1分，全年积分并非1；该SQL实查细节见query-team-min-details。A与B不同，Gold只有姓名不能区分。因此不是仅倍率或卷宗猜测。
## 最后原Spec/SQL审查
读Gold并完成实验后读原trace成功字段。原明确driver-season积分最低全并列，COUNT DISTINCT season；SQL最后driver积分榜、同年results连接与独立核心一致。原selection strict+姓名升序与独立id不同只是边界展示；该差异不能解释Gold排Sauber3却纳Jordan2。原条件隐含“总积分”的中间聚合粒度和constructor归属阶段，可能分叉在population.conditions（少积分资格）、中间度量或关联，不足唯一确认语义错误。不是原SQL实现错。
## 残余风险
Gold SQL缺失；两个解释都重现名称且各需未明确业务假定；Gold只一列而原两列也可能贡献评分0。不把局部重建冒充全部失分的唯一原因，状态ambiguous_after_recompute。

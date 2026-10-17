# local354：Gold遗漏与原参赛资格误计须分开
## 结论
独立发布103名司机，原104名，Gold只有501 Harry Schell、554 Jean Behra、579 Juan Fangio。可确证Gold局部遗漏：642 Nino Farina1950实际参赛6round，首round1与末round7均Alfa Romeo，两端Finished70/80laps，显然满足题面且Gold不含642。真实反例足以确认局部gold_conflict，不需要臆造Gold SQL。
另可确证原局部资格错误：Bill Aston1952只有round6 Oil pressure、2laps为实际参赛；round5 Withdrew0laps和round8 Did not qualify0laps不是参赛，原却计3round纳入。因此104->103能定位，但绝不能说它解释Gold只3人的全部失分。
## 原文逐字依据与自由算法
“Among Formula 1 drivers who raced during the 1950s”；“the same constructor in both the first and the last race they participated in”；“while also taking part in at least two distinct race rounds during that season”。无业务文档。1950-1959，按driver/year统计实际round>=2；司机自己首末round两端constructor集合有交集即可，不要求全年只一个constructor，亦非赛历全年端点。最终司机去重。status明确DNQ排除；Withdrew0lap排除、正lap保留；机械事故0lap不推断未起跑。
## 揭示前实际验证
50个Did not qualify全0lap，Withdrew26个含2个正lap。历史结果同司机同round可多车、甚至多constructor，24个driver-season多行但只有1round（包括1951Fagioli2条同一round，1954Linden3条同一round）说明COUNT(*)>=2错误。每季合格司机数27/22/29/28/27/22/25/19/24/20，跨季去重103。11个首末同队但中间换队的合格driver-season，例如1956SchellVanwall→Maserati→Vanwall，证明不能把端点相等误成全年同队。授权CSV/SQL与freeze见publications及independent-freeze.json。
## Gold后真实候选实验
不筛status104；自己参赛定义103；改日历首末43；端点正lap99；全年只有一个constructor仍103（另一季满足使司机集合相同）；日历首末且都Finished6（642/786/579/578/356/479，仍不是Gold3）；参加所有赛历round零人（印第安纳round存在）；drives首末flags+不同端点104；强加首末不同drive segments11（返回同隊）而非Gold3。Gold3在主口径各有多个合格季，但“最多合格季”排名也含Trintignant9、Collins7等，不能解释它。实际SQL均在executor-events.jsonl，未仅凭卷宗或数字推测。
## 最后原Spec/SQL审查
上述实验后读原trace成功Spec。原正确声明within-season首末与distinctround>=2，SQL实现COUNT(DISTINCT round)无此计数错误；但source注释“results JOIN races ON race_id yields one row per driver-race participation”既忽略共享车多行，也把未参赛结果行当参赛。最早可确认局部分叉population.eligibility；资格声明有语义但缺实际参赛状态判别。ROW_NUMBER两端同round多constructor任取存在实现风险，当前独立集合交集与原集合差异仅BillAston，未发现另一个现有司机输出影响。
## 编码故障与限制
姓名SQL遇Python GBK无法编码É立即反馈父；父修CLI UTF8后原SQL不变重跑，成功发布freeze再reveal。原始故障日志保留；此前GBK字符替换显示不作姓名证据。Gold仅ID而原分forename/surname、独立fullname，也存在输出形状差异；把ID翻为真实名字仍有Farina等确定遗漏。Gold SQL缺失，经候选实验后仍不能唯一说明Gold3来源；主status为局部gold_conflict，原BillAston语义错误独立列出而不冒充全部原因。

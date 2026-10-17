# local297
## 结论
独立答案54.2%=271/500，与原CSV及真实复跑一致；Gold36.4%=182/500。已找到精确Gold数值签名：把purchase也当负额、增长用绝对前月余额作分母、首次NULL前月不视作零。该组合与明确“all deposits and withdrawals”的交易范围不符。分类gold_conflict（局部数值与题意冲突）；不把原54.2直接标成已确证语义错误，亦不声称已知Gold生成SQL。
## 原文与独立方法
blind.json /question："For each customer, group all deposits and withdrawals by the first day of each month to obtain a monthly net amount"；"closing balance by cumulatively summing these monthly nets"；"if the previous month’s balance is zero, the growth rate should be the current month’s balance multiplied by 100"。
deposit-withdrawal月净额→客户累计closing（初值0）→每客户最新指定交易月相邻日历前月比较，有符号分母，零分母题面回退。中间缺月补0，首次前余额0，严格>5；所有500客户作百分比分母。每客户最新月是披露假定，非从Gold反推。
## 实际数据库与手工复核
最新指定交易月分布1月17、2月26、3月194、4月263，达标人数15、19、103、134，合计271；有91个中间缺月，全部客户均有指定交易。客户3：1月净144、2月0、3月-401、4月493，累计144、144、-257、236，4月增长493/-257*100=-191.82879377%；客户10：1—4月净-410、494、-282、-513，累计-410、84、-198、-711，末增长-513/-198*100=259.09090909%，演示负分母会将更负余额判作正增长；这不是观测证明业务定义，只是有符号公式的效果。客户4仅1月848，题面零前额回退84800%。
## 揭示后真实反事实实验
probe-variants包含3种交易方式×个人最新/全库4月×累计/月净额，并检查绝对分母与整数除法。个人最新：dw累计54.2%，dw月净32%；purchase负额累计47%，绝对分母36.8%；purchase不计金额但保留月份45%。全库4月、所有500分母：dw累计26.8%，purchase负累计29%。这些不是Gold36.4%。probe-date-pairs另检查所有Jan–Apr有序月份对（两种交易范围），排除凭卷宗猜日期。
probe-null-abs精确定位：purchase负额、客户末观测月、ABS(前额)、首次NULL不做回退，182/500=36.4；只将首次NULL改0，184/500=36.8（3个首次NULL客户中2个正额）；改回dw_only、NULL不回退、ABS为291/500=58.2。支持Gold指纹需要多个改变，不能把17.8百分点差全部归于“末月”选择。
## 最后原Spec/SQL审查
original-spec-extract最后成功Spec明确population.conditions仅deposit/withdrawal、population.time每客户自身最近月；population.missing单月客户视前额0并纳入；measure.formula有符号前额增长及全客户分母。最终SQL实际体现这些选择。原先缺月不补、独立补零，两者末月结果完全一致：累计余额跨空月守恒，所以缺月不是此失分原因。原population.missing最后改写仅说明单月客户，未重申跨缺月策略，这种覆盖不完整是记录问题，但没有造成当前数值差。
若把重建Gold作为比较算法，最早分叉population.conditions（purchase负），其次measure.denominator（ABS）和population.missing（NULL）。这些节点只是比较算法差异，不是合格业务证据确证的原错误。原条件与题面吻合，不应为迎合Gold标错。
## 限制
Gold SQL缺失，精确重建不能证明唯一生成机制；初始余额0、个人最新指定交易月和负分母解释未有业务文档确认。真实查询日志、发布/冻结与原Spec成功写入证据均在case目录；未做框架因果评价。

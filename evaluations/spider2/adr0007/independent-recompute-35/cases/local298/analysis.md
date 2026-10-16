# local298
## 结论
独立发布、冻结为2/3/4月：235595、261508、260971；与原真实SQL复跑数值逐月一致。Gold212579、240602、153147可完整精确重建为“只含当前月活跃客户的前额”，漏39、26、94个仍有正余额但当前月无交易的用户。题面明确"from all users"，因此为局部gold_conflict，不是原负余额截断阶段错误。
## 原文与独立方法
blind.json /question："the total balance from all users for the previous month (measured as of the 1st of each month), replacing any negative balances with zero"；"data from the first month is used only as a baseline"；"exclude it from the final output"。
按deposit正、withdrawal/purchase负（业务假定），每客户累计至前月末，在客户余额层截负为0，再总和；缺月净额0余额延续；首月1月基线不输出，后续数据月按月升序。初始余额0、末月边界均已冻结披露。
## 真实验证：截断层
probe-stage列出1—4月：每客户累计后截零总和235595/261508/260971/264857；先全客户汇总再截零126091/0/0/0；先截每月净额再累计235595/368987/500959/583634。故这些阶段不等价，而独立与原实现同为客户累计余额层。
客户3净额144/-965/-401/493，累计144/-821/-1222/-729；负累计余额不因为4月正净493而改为493。客户1在2月无交易，1月余额312仍在2月末保留312，而不是零。原SQL按txn_date<month||'-01'与独立前月累计严格等价，不含当月1日交易。
## Gold定位与守恒反例
probe-gold-coverage对真实无日历脊月净累计后LAG，得到所有交易类型的当前活跃客户455/456/309，前观测累计余额截0总和212579/240602/153147，三行完全吻合Gold；仅deposit/withdrawal得到273471/406133/311636，不吻合。只取上一个日历月且不补脊的值212579/220350/144958也不吻合，说明Gold指纹为缺月余额延续而当前不活跃者被排除。
probe-missing-users在完整脊上只改当前活跃资格，严格恒等式：235595-23016=212579；261508-20906=240602；260971-107824=153147。丢失正余额客户39/26/94。probe-counterexamples：4月无交易客户2前余额610、4前余额655、6前余额340、13前余额1405等；这些应属“all users”，无当月交易不改变截至月初余额。可确证Gold数值所缺的贡献及守恒冲突，非靠无Gold SQL推测。
## 最后原Spec与SQL
最后成功原Spec：eligibility全体交易客户；time累计严格早于各月1日；measure.formula先截每客户余额再求和。SQL确实按全部历史交易计算，不要求当前月活跃。原population.missing="n/a (no missing calendar months to fill)"忽略客户层缺月，但实际历史快照SQL正确延续，因此这里只是文字覆盖不足，不能归为导致失分的实现错误。
比较Gold签名最早分叉population.eligibility（当前月活跃资格），但不是题面支持的原语义错误；负截断measure.formula与Gold签名在相同用户上等价，不要误定位于度量。原月份字符串YYYY-MM与GoldYYYY-MM-DD差异被condition_cols=[1]排除，不是评分0原因。
## 限制
Gold生成SQL仍未知，但三月完整键值与遗漏贡献精确重建，all-users冲突可局部证实。交易类别及初始余额无业务定义，独立和原均有同样披露假定。没有据此宣称框架收益。

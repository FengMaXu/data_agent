# local067：分箱方向而非利润定义；非仅层号反转

## 结论
独立与原运行按层号相同，分均0。**在同一68名活跃意大利客户及同一利润公式上，将NTILE排序改为DESC，即逐bucket键精确重现Gold全部10层。** 题面没有规定分箱方向；现有业务证据不足认定ASC语义错误，status=ambiguous_after_recompute。68不是10的倍数，ASC/DESC会把8个额外名额分给不同利润端，所以差异并非纯层号重命名。

## 原题及自由题解
blind.json `/question`："Italian customers segmented into ten evenly divided tiers based on their December 2021 sales profits"；"highest and lowest profits"。documents为空。自己先累计每客户销售amount_sold−quantity_sold*unit_cost，再对客户NTILE10按利润ASC/cust_id稳定排序，每层MAX/MIN利润。客户活跃资格、实际收入利润、同额可跨箱与方向均披露为独立假定；没有借字段树或旧数值指导。

## 实际核算与反例
2021-12成本1907行且完整(prod_id,time_id,channel_id,promo_id)键1907个；意大利客户7780，当月活跃68、销售689行全部成本匹配，连接无扇出。实际收入利润总11407.10，成本unit_price代替实际收入则11423.84，销售行收入差范围−4.38至+0.39；两公式不等价。
独立NTILE ASC每层人数7/7/7/7/7/7/7/7/6/6。独立授权CSV publications/publication_570cf3c0-5648-47a3-bddc-61086f651c73/result.csv（10行）；利润最低层−27.94至−10.03，最高层698.35至785.15。先发布freeze，后看Gold。

## 后验实验
post-descending-tiers：只改ORDER BY profit DESC，仍人数7×8、6×2；Gold最高层588.36至785.15（7人），最低层−27.94至−10.03（6人）；中间全部Gold max/min逐bucket键吻合（post-keyed-gold-check的20个delta均0）。若简单把独立ASC层号1↔10，其最高层仍6人/下界698.35，不能得到Gold，余数分配必须随排序方向变化。
post-tie-placement：实际profit=−10.030000000000086有客户4875/6319/7017，ASC前两人落1层、后一人2层，DESC前两人9层、后一人10层。同额跨箱确实发生。post-tie-order-invariance改变cust_id次序，9/10层各有一个客户成员改变，但所有箱MAX/MIN不变。**tie二级排序影响客户身份，不解释当前交付的数值失分。**
post-list-profit-desc用unit_price公式，低层变−23.56、−8.45等，不吻合Gold；可排除该公式为此次失分原因。post-other-tier-alternatives真实实验：等宽分箱人数28/18/4/4/4/1/1/2/2/4，明显不是均人数，且不吻合Gold；将7780名客户无销售补0后每层778人，中间8层全0，也不吻合。没有用Gold吻合替代业务定义。

## 事后原Spec与SQL审查
原grouping明确逐字 "对意大利客户按 2021-12 利润升序用 NTILE(10) 分成 10 档，第 1 档=利润最低、第 10 档=利润最高，每档客户数尽量相等"（为字段value内原文片段）。原SQLNTILE OVER(ORDER BY profit)与之相符，利润及时间/活跃总体也正确实现Spec。相对Gold重现方案最早分叉grouping（分箱方向及余数端），不是selection，更不是output仅换层号。方向显式可见但没有唯一请求依据；无确认实现错误。原没有cust_id稳定次序属于复现风险，当前MAX/MIN经实验对同额次序不变，不可夸大为失分根因。

## 限制
Gold SQL缺失，已精确重现全部边界并穷尽主要合理利润/总体/等宽/tie备选。题面未规定方向，不能判断低→高与高→低哪种唯一正确。成本匹配唯一是本数据观测，不是全业务schema键约束；利润/活跃资格没有审核定义。官方分不保业务唯一性，发布不保正确性。

# local220：Gold身份合并冲突
## 结论
独立发布：Cristiano Ronaldo胜199场；Gorka Iraizoz Moreno负107场。原SQL按player_api_id也得此答案；两者官方评分均0。Gold给Marcelo、Ricardo。真实反例：3个不同Marcelo身份胜场165+103+33=301；5个Ricardo身份负场55+41+38+15+14=163。单变量将身份分组改为姓名合并，极值恰成为Gold姓名。
## 原题依据
“Which player has participated in the highest number of winning matches and which player has participated in the highest number of losing matches”；“considering only matches where they actually played (excluding null entries) and where their team won or lost (excluding draws)”。没有业务文档，DDL提供player_api_id与姓名。题面问球员不是同名球员集合。
## 自由算法与验证
见independent-plan.md、final.json及授权publications目录。展开22个身份槽、排平局、按球员×比赛去重。全部非空身份均匹配Player。胜阵容203082槽与203081身份比赛只差1重复；负201618槽无重复。冠军主场116+客场83=199；负场冠军主39+客68=107。Gold各身份实测见query-gold-identities.json及executor-events.jsonl；改为姓名合并见query-name-merging.json。不是凭倍率推测。
## 三方比较与事后字段审查
freeze完成后才reveal；Gold对照后读取原trace成功写入Spec（original-spec-review.json）。原entity明示player_api_id稳定键、player_name仅展示；度量与SQL均独立身份去重。不存在可确证的原总体/度量字段分叉。Gold重建候选最早分叉为实体身份合并；归为局部gold_conflict，而不是原框架可见性错误。原输出多了类型与计数，独立也有这两列，因此不能保证修正Gold姓名后就获得评分。
## 未证实
Gold SQL缺失，实验说明姓名合并足以重现Gold，不证明它真实执行过该SQL。真实上场分钟缺失，以阵容记录代理。观测身份计数不是业务定义。评分列独立比较也非语义认证。

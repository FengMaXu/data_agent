# 独立题解
题目：“In the combined dataset that unifies the trees data with the income data by ZIP code, filling missing ZIP values where necessary, which three boroughs, restricted to records with median and mean income both greater than zero and a valid borough name, contain the highest number of trees, and what is the average mean income for each of these three boroughs?”
无业务文档。先树表与收入按ZIP完整外连接，合并ZIP=coalesce(t.zipcode,i.zipcode)；填补只来自另一表，不虚构地理推断。无树的收入行没有borough，最终有效borough筛选自然剔除。筛选median和mean均>0，borough非NULL非空，并验证数据库实际名字是否异常。
按borough统计树木数量，验证tree_id唯一和收入ZIP唯一决定是否count行等于树实体。最终平均收入是在符合条件联合记录上avg(Estimate_Mean_income)，即每棵树权重；不是每个ZIP等权，也不是按收入Estimate_Total家庭数权重。按树数降序取严格前三，并列用borough排序确定；不限制存活状态。

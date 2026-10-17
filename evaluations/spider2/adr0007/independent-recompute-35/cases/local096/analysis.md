# local096：独立重算与事后字段审查

**结论：按题面排除未知性别实算仅4部全女影片；Gold额外计入2009/2012无可识别演员、2018演员性别NULL的3部影片。忽略NULL反事实逐年精确重现Gold，原SQL处理NULL正确。**

### 原题（逐字）

> For each year, calculate the percentage of films that had exclusively female actors (meaning no male actors and no actors with unknown/unspecified gender). Consider actors with gender marked as 'Male' or 'None' as non-female. For the results, display the year, the total number of movies in that year, and the percentage of movies with exclusively female actors. Extract the year from the Movie.year field by taking the last 4 characters and converting to a number.

## 独立解题与实算
原题明确“no actors with unknown/unspecified gender”，故每电影至少有已识别出演者，且所有演员明确Female；以全部Movie作年分母。先独立检查物理键，M_Cast.PID带外围空白，Person存在同PID重复但性别无冲突；按PID预聚合性别、TRIM身份连接，再按电影聚合，避免演员连接放大电影总数。3475电影全部有cast记录，不存在空cast选择在本数据影响结果。
真实符合者仅4部：1939 Kala Jigar，1999 Bindhaast，2000 Snegithiye，2018 Pihu。其年百分比分别50、1.5151515、1.5625、0.96153846，其余年为0。最终78行已发布并冻结，官方分0，不能因此抹掉题面要求。
## Gold差异与反证
Gold在2009计1/110、2012计1/111，2018计2/104。实查其额外候选：tt1587388和tt2355921的唯一cast PID为NULL，无法连接演员；tt8338754的演员Vaibhav Sethia的Gender为SQL NULL。它们都不能满足题面“no actors with unknown/unspecified gender”。
只将资格改为“没有已知Male/字符串None”，忽略SQL NULL与孤立身份，即得到7部资格影片，逐年全部Gold比例精确重现。此反事实充分解释当前数值，但没有Gold SQL，不能声称已经查到Gold原始代码；也不能排除标准生成数据库版本不同。
## 最后审查原字段
原measure.denominator明确“性别为 Male 或 NULL（未知/未指定）的演员视为非女性”；最终SQL CASE WHEN Gender='Female' THEN1 ELSE0 END把NULL正确判为非女。原公式另决定“无演员记录的电影算作满足”，从措辞看存在资格风险，但实际空cast为0，不能拿它解释本次失分。原按年保留全部电影和解析末4位也与独立实算一致。
本题最早可证差异在Gold的population.eligibility/conditions，而不是原Spec隐藏节点。错误层为本次输入下标准答案局部冲突；原语义错误可见性不适用。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
For each year, calculate the percentage of films that had exclusively female actors (meaning no male actors and no actors with unknown/unspecified gender). Consider actors with gender marked as 'Male' or 'None' as non-female. For the results, display the year, the total number of movies in that year, and the percentage of movies with exclusively female actors. Extract the year from the Movie.year field by taking the last 4 characters and converting to a number.
```

- `parent-cast-integrity-response.json`，JSON pointer `/details/preview/rows`：

```text
3475
```

- `parent-post-null-only-film-cast-response.json`，JSON pointer `/details/preview/rows`：

```text
Vaibhav Sethia
```

- `parent-post-ignore-null-variant-response.json`，JSON pointer `/details/preview/rows`：

```text
0.9615384615384616
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
"YEAR","TOTAL_NUM_OF_MOV","PERCENT_OF_MOV_WITH_ONLY_F"
1939,2,50.0
2018,104,1.9230769230769231
2000,64,1.5625
1999,66,1.5151515151515151
2009,110,0.9090909090909091
2012,111,0.9009009009009009

```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local096/attempts/attempt-001/trace.json`，JSON pointer `/toolCalls/26/result/details/fields/10/value`：

```text
性别为 Male 或 NULL（未知/未指定）的演员视为非女性
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local096/publications/publication_e6432aaa-bac2-4c1b-85ac-a79cb8f8c5d5/`。
- 初次冻结：`cases/local096/independent-freeze.json`。官方独立分：0。

- Gold SQL缺失；重建NULL机制不是原标准SQL源码证据。
- 空cast规则原Spec有争议，但在当前数据空cast为0，不构成本题实际失分根因。

# 评分及执行链专项审计

此部分由父协调者补齐中断的审计工作。纯CSV重放与逐题来源校验不是数据库重跑，也不是独立业务正确性认证。

## 评分文件版本

| 文件 | map题数/判对 | 对外比例 | 判断 |
|---|---|---|---|
| summary-attempt-001.json | 39/18 | 18/39 | 首批 |
| summary-retry.json | 62/22 | 22/62 | 第二批 |
| summary.json | 101/40 | score仍22/62；fixed仍22/118 | map已合并，比例未同步 |
| report.md、evaluation.json、score-record.json | 仍为首批 | 18/39 | 不能作为最新分母 |

两个map无重叠，latest map恰等于二者并集。101份CSV重放全部一致；118固定集合中有17题无分数。run根summary只记录115个旧终态，根结果仍含local099/130/131早先402；这三题最新attempt已发布且分别判对/判对/判错，不纳入最新无评分。

汇总原文：
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/summary.json /execResult/correct`：`40`
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/summary.json /execResult/total`：`101`
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/summary.json /execResult/score`：`0.3548387096774194`
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/official_score/summary.json /execResult/fixedDenominator`：`{"score": 0.1864406779661017, "correct": 22, "total": 118, "submittedTotal": 62, "missingSubmissions": 56}`

## 17道无评分的逐题停止位置

13个保存为timeout、1个保存为max_tool_calls、3个缺失result/trace终态。timeout是运行器终态，不等于数据库查询超时；记录时长不能直接当单个API时长。三段缺终态日志只记录观测窗口，不按0秒或timeout计入平均。

| 题号 | 保存状态 | 时长/观测窗（秒） | 最后可见位置 |
|---|---|---:|---|
| local018 | timeout | 592.813 | grouping仍open；两次451后比较返回建议，未见最终决定或结果查询。 |
| local023 | timeout | 1041.430 | 只见6个知识/子代理工具，未建立Spec；最后patterns子代理完成。 |
| local024 | timeout | 481.329 | Spec eligibility及ties open，3个探索已返回，未见最终决定。 |
| local025 | timeout | 521.054 | 只见5个知识/子代理工具，未建立Spec；某子代理返回空content。 |
| local026 | timeout | 554.770 | 知识section S08/S03两次not found；未建Spec，最后子代理空content。 |
| local028 | timeout | 577.724 | timeField两候选有不同输出，比较已有建议，但字段尚open。 |
| local029 | timeout | 534.572 | 只见4个工具，停知识阅读；未建立Spec。 |
| local031 | timeout | 619.272 | 已建Spec，formula/selection/output未声明且4字段open；继续找语义/业务知识。 |
| local032 | timeout | 524.298 | 只见4个工具，schema子代理完成；未建立Spec。 |
| local034 | timeout | 543.656 | 只见5个工具，停知识检索；未建立Spec。 |
| local035 | timeout | 495.131 | 最后set已无undeclared/open，可执行结果；未见结果查询或export，不是已证Spec阻断。 |
| local062 | timeout | 505.944 | eligibility尚open；比较已有倾向，未见最终决定或结果。 |
| local063 | timeout | 714.395 | selection尚open；22个query调用含预算障碍，末两次返回exploration budget exhausted。 |
| local212 | max_tool_calls | 253.524 | 第50工具已生成候选；第51 export被取消，MAX_TOOL_CALLS停止，无发布CSV。 |
| local355 | record_missing | 253.097（观测窗） | 14工具start/13end；末事件tool_start；undeclared=[]，open=[]；无run_end。 |
| local356 | record_missing | 224.650（观测窗） | 24工具start/24end；末事件message_update/toolcall_end；undeclared=['measure.formula']，open=[]；无run_end。 |
| local360 | record_missing | 100.049（观测窗） | 9工具start/9end；末事件message_update/thinking_delta；undeclared=['output']，open=['population.eligibility']；无run_end。 |

这些停止位置是可见事实，不证明是谁耗尽时间。6个timeout没有Spec、6个有待定字段、1个已Ready；因此不能将全部13个归为字段树死循环。local063可证有探索预算耗尽；local212可证发生在交付阶段。

## 无评分证据摘录

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local018/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local018/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local018/attempts/attempt-001/trace.json /toolCalls/21/result/content/0/text`
```text
[HYPOTHESIS_COMPARISON_ADVISORY] path=grouping
[ADVICE_LEAN] alternativeId=alternative_ef9b4846-8b6e-4750-b3e7-8c61fdfaddbf probability=0.46
{"model":"jev-1.13.0","recommendation":{"kind":"hypothesis","hypothesisId":"alternative_ef9b4846-8b6e-4750-b3e7-8c61fdfaddbf"},"probabilities":[{"hypothesisId":"alternative_ef9b4846-8b6e-4750-b3e7-8c61fdfaddbf","probability":0.46},{"hypothesisId":"alternative_165e20c8-ab8f-41b8-85c6-bc851cb671ee","probability":0.25}],"abstentionProbabilities":{"insufficientEvidence":0.21,"multiplePlausible":0.07,"noneSupported":0.01},"confidence":0.33}
This recommendation is not evidence. Deciding against a clear lean requires adviceOverride with a reason and evidence ids.
```
grouping仍open；两次451后比较返回建议，未见最终决定或结果查询。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local023/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local023/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local023/attempts/attempt-001/trace.json /toolCalls/5/result/content/0/text`
```text
## patterns（explorer）— completed

## 结论

在 **已验证查询模版（knowledgeId: query-patterns）** 中，**不存在**与板球击球相关的任何已验证查询模版。该知识源没有可用于 "average runs per match"、"batting average"、"top N players"、"season"、"runs scored per match"、"dismissals/outs" 的模版 SQL，因此**没有任何模版 SQL 或适用前提可以逐字报告**。

## 关键事实

- 对 query-patterns 的多次检索（关键词：cricket、cricket batting average runs per match top N players season dismissals outs、average runs per match batting、top N ranking season aggregation template、average per match 等）返回结果均为空（`{"hits":[],"omittedHitCount":0}`），来源：`search_knowledge`（knowledgeIds=["query-patterns"]）。
- 直接读取该知识源全文（`read_knowledge` knowledgeId=query-patterns，mode=full_document，lineCount=9，truncated=false），正文仅有一行声明，表示未提供任何基准专用查询模版。
- 检索返回的相关命中全部来自 **database-schema**（非 query-patterns），例如 `batsman_scored(runs_scored)`、`wicket_taken(player_out, kind_out)`、`player_match(match_id, player_id, role, team_id)`、`match(sea
```
只见6个知识/子代理工具，未建立Spec；最后patterns子代理完成。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local024/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local024/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local024/attempts/attempt-001/trace.json /toolCalls/9/result/content/0/text`
```text
[EXPLORATION_EVIDENCE] evidenceId=evidence_b22d449f-dde4-413d-acec-e9494d485397
Cite this evidenceId in a field's evidenceIds; do not resubmit the observation body.
joined_rows | bs_rows | batters_with_runs | pm_players_never_batted | strikers_not_in_pm
131259 | 131259 | 434 | 34 | 0
```
Spec eligibility及ties open，3个探索已返回，未见最终决定。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local025/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local025/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local025/attempts/attempt-001/trace.json /toolCalls/4/result/content/0/text`
```text
{"mode":"full_document","knowledgeId":"semantic-guide","name":"数据分析语义理解指引","content":"# 数据分析语义理解指引\n\n> 职责：确定“应该回答什么”，形成有依据的 Answer Spec；适用于 SQL、KTX 和后续统计分析。\n> 分工：系统提示词与已加载的任务流程 Skill 维护证据优先级、假设登记、版本与交付流程；[SQL 生成规范](./rules.md)维护“如何实现口径”；[业务知识](./business.md)与 [Schema](./db_schema.md)提供具体业务定义和字段证据。本指引不授予业务事实或发布资格。\n\n## 1. 执行步骤（每个新查询任务必读）\n\n1. **拆题**：提取实体名词、指标、限定词、比较关系、时间表达和输出要求，保留对应题面短语。完成条件：字段树的必需字段已建立，未知项明确记录。\n2. **定口径**：按第 2 节填写；对会改变结果的合理解释记录依据和影响。完成条件：已知要求与候选假设分开，未决项可定位到字段。\n3. **定向取证**：先查适用业务定义及 Schema，再用少量只读探索区分候选解释。完成条件：每次探索说明解决哪个问题、观察到什么、仍不能证明什么。\n4. **编排计算**：写出 `输入粒度 → 处理/公式 → 输出粒度 → 后续用途`。完成条件：每次筛选、聚合、连接和比较对身份、总体、权重的影响明确。\n5. **对照题意**：从已写查询反译业务含义，按第 5 节用最小样例检查高风险选择。完成条件：题面要求有实现位置，新增行为有依据或明确披露；再按任务流程进入结果执行与交付。\n\n这不是固定次数的探索清单。证据不足时按任务流程处置或澄清；无澄清工具时采用最字面解释并披露，不能将其升级为 Hard Constraint。\n\n## 2. 字段树（每个新查询任务必读）\n\nAnswer Spec 按计算顺序分为五段，每个歧义写在它实际发生的那一步。字段写法见 `answer-fields` Skill。
```
只见5个知识/子代理工具，未建立Spec；某子代理返回空content。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local026/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local026/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local028/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local028/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local028/attempts/attempt-001/trace.json /toolCalls/8/result/content/0/text`
```text
[HYPOTHESIS_COMPARISON_ADVISORY] path=population.timeField
[ADVICE_LEAN] alternativeId=alternative_67c32a6a-219c-421d-9007-943eba09734b probability=0.85
{"model":"jev-1.13.0","recommendation":{"kind":"hypothesis","hypothesisId":"alternative_67c32a6a-219c-421d-9007-943eba09734b"},"probabilities":[{"hypothesisId":"alternative_02f062ed-ad97-42c3-8c3c-7c5c55ad800b","probability":0},{"hypothesisId":"alternative_67c32a6a-219c-421d-9007-943eba09734b","probability":0.85}],"abstentionProbabilities":{"insufficientEvidence":0.09,"multiplePlausible":0.06,"noneSupported":0},"confidence":0.81}
This recommendation is not evidence. Deciding against a clear lean requires adviceOverride with a reason and evidence ids.
```
timeField两候选有不同输出，比较已有建议，但字段尚open。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local029/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local029/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local029/attempts/attempt-001/trace.json /toolCalls/3/result/content/0/text`
```text
{"mode":"full_document","knowledgeId":"semantic-guide","name":"数据分析语义理解指引","content":"# 数据分析语义理解指引\n\n> 职责：确定“应该回答什么”，形成有依据的 Answer Spec；适用于 SQL、KTX 和后续统计分析。\n> 分工：系统提示词与已加载的任务流程 Skill 维护证据优先级、假设登记、版本与交付流程；[SQL 生成规范](./rules.md)维护“如何实现口径”；[业务知识](./business.md)与 [Schema](./db_schema.md)提供具体业务定义和字段证据。本指引不授予业务事实或发布资格。\n\n## 1. 执行步骤（每个新查询任务必读）\n\n1. **拆题**：提取实体名词、指标、限定词、比较关系、时间表达和输出要求，保留对应题面短语。完成条件：字段树的必需字段已建立，未知项明确记录。\n2. **定口径**：按第 2 节填写；对会改变结果的合理解释记录依据和影响。完成条件：已知要求与候选假设分开，未决项可定位到字段。\n3. **定向取证**：先查适用业务定义及 Schema，再用少量只读探索区分候选解释。完成条件：每次探索说明解决哪个问题、观察到什么、仍不能证明什么。\n4. **编排计算**：写出 `输入粒度 → 处理/公式 → 输出粒度 → 后续用途`。完成条件：每次筛选、聚合、连接和比较对身份、总体、权重的影响明确。\n5. **对照题意**：从已写查询反译业务含义，按第 5 节用最小样例检查高风险选择。完成条件：题面要求有实现位置，新增行为有依据或明确披露；再按任务流程进入结果执行与交付。\n\n这不是固定次数的探索清单。证据不足时按任务流程处置或澄清；无澄清工具时采用最字面解释并披露，不能将其升级为 Hard Constraint。\n\n## 2. 字段树（每个新查询任务必读）\n\nAnswer Spec 按计算顺序分为五段，每个歧义写在它实际发生的那一步。字段写法见 `answer-fields` Skill。
```
只见4个工具，停知识阅读；未建立Spec。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local031/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local031/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local031/attempts/attempt-001/trace.json /toolCalls/7/result/content/0/text`
```text
{"hits":[{"knowledgeId":"semantic-guide","name":"数据分析语义理解指引","sectionId":"semantic-guide#_E6_95_B0_E6_8D_AE_E5_88_86_E6_9E_90_E8_AF_AD_E4_B9_89_E7_90_86_E8_A7_A3_E6_8C_87_E5_BC_95_2F3._20_E4_B8_93_E9_A2_98_E7_B4_A2_E5_BC_95_EF_BC_88_E6_8C_89_E8_A7_A-9","sectionTitle":"S08｜排名、并列与分桶","path":"doc/semantic_guide.md","startLine":133,"endLine":141,"score":7.721012683706467,"content":"### S08｜排名、并列与分桶\n\n- 先定义候选总体、比较实体、指标、分区、方向、数量及并列政策。作品数、销量和租赁热度不可互换。\n- 区分恰好 N 个对象与前 N 名含并列；并列裁决需要依据，合格对象不足时不补造。\n- 业务并列与稳定展示是两件事；额外排序键不能擅自消除并列。\n- 等人数分桶、累计排名比例、等宽区间与分位点分类不是同一种定义；有公式按公式执行。\n\n**完成条件：** 并列极值、分桶边界和不足 N 个对象时的预期行为明确。\n","truncated":false,"contentRef":"knowledge:semantic-guide@3754465545#semantic-guide#_E6_95_B0_E6_8D_AE_E5_88_86_E6_9E_90_E8_AF_AD_E4_B9_89_E7_90_86_E8_A7_A3_E6_8C_87_E5_BC_95_2F3._20_E4_B8_93_E9_A2_98_E7_B4_A2_E5_BC_95_EF_BC_88_E6_8C_89_E8_A7_A-9:45e2e09651eb9c37e3c2313a"},{"knowledgeId
```
已建Spec，formula/selection/output未声明且4字段open；继续找语义/业务知识。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local032/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local032/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local032/attempts/attempt-001/trace.json /toolCalls/3/result/content/0/text`
````text
## schema（explorer）— completed

## 结论

本库命名约定为 `olist_*`（另有两个非前缀表 `olist_products_dataset`、`product_category_name_translation`）。与 sellers、orders、order items（price/freight）、customers、product reviews/ratings 相关的表为：`olist_sellers`、`olist_orders`、`olist_order_items`、`olist_customers`、`olist_order_reviews`（另需 `olist_products` 关联商品分类）。全部 10 张物理表如下（DDL 中未声明任何 PRIMARY KEY / FOREIGN KEY / UNIQUE 约束）。

```
olist_customers
  customer_id                TEXT
  customer_unique_id         TEXT
  customer_zip_code_prefix   BIGINT
  customer_city              TEXT
  customer_state             TEXT

olist_sellers
  seller_id                  TEXT
  seller_zip_code_prefix     BIGINT
  seller_city                TEXT
  seller_state               TEXT

olist_orders
  order_id                       TEXT
  customer_id                    TEXT
  order_status                   TEXT
  order_purchase_timestamp     
````
只见4个工具，schema子代理完成；未建立Spec。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local034/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local034/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local034/attempts/attempt-001/trace.json /toolCalls/4/result/content/0/text`
```text
{"hits":[{"knowledgeId":"semantic-guide","name":"数据分析语义理解指引","sectionId":"semantic-guide#_E6_95_B0_E6_8D_AE_E5_88_86_E6_9E_90_E8_AF_AD_E4_B9_89_E7_90_86_E8_A7_A3_E6_8C_87_E5_BC_95_2F3._20_E4_B8_93_E9_A2_98_E7_B4_A2_E5_BC_95_EF_BC_88_E6_8C_89_E8_A7_A-4","sectionTitle":"S03｜连接关系与权重","path":"doc/semantic_guide.md","startLine":85,"endLine":93,"score":6.905478959178514,"content":"### S03｜连接关系与权重\n\n- 先确认左右粒度、完整业务键、预期基数与未匹配政策。复合键遗漏一列即可把不同事件误配。\n- 多事实表直接连接可能把两侧度量相互复制；先确定共同统计粒度，再决定是否分别聚合后连接。\n- 重复维度先区分脏重复、有效历史版本和合法多值。任意挑一条与整体去重都不是默认正确方案。\n- 连接后的均值可能按事实数量加权，而不是按客户、区域或商品等权。即使结果行数符合预期，也要检查权重。\n\n**完成条件：** 行复制、未匹配剔除与权重变化均能从业务关系解释；实现方式见 SQL 规范。\n","truncated":false,"contentRef":"knowledge:semantic-guide@3754465545#semantic-guide#_E6_95_B0_E6_8D_AE_E5_88_86_E6_9E_90_E8_AF_AD_E4_B9_89_E7_90_86_E8_A7_A3_E6_8C_87_E5_BC_95_2F3._20_E4_B8_93_E9_A2_98_E7_B4_A2_E5_BC_95_EF_BC_88_E6_8C_89_E8_A7_A-4:2d0bde21bb3
```
只见5个工具，停知识检索；未建立Spec。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local035/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local035/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local035/attempts/attempt-001/trace.json /toolCalls/4/result/content/0/text`
```text
[ANSWER_SPEC_SET] taskId=task_3c64e4e7-f417-42e2-a6c4-8a767c8546a9 revisionId=revision_f4764ec8-e4e6-46cf-96ac-02215496aad2
- ✓ population.entity
- ✓ population.eligibility
- ✓ population.conditions
- ✓ population.source
- ✓ population.time
- ✓ measure.formula
- ✓ grouping
- ✓ selection
- ✓ selection.ties
- ✓ output
状态：
- 未证实（发布时披露）: population.entity, population.eligibility, population.source, selection, selection.ties, output
- 没有待处理的字段，可以执行结果查询
[SPEC_FEEDBACK] revisionId=revision_f4764ec8-e4e6-46cf-96ac-02215496aad2 status=completed advisory_only=true
assessment: population.relation=not_established
assessment: selection.relation=not_established
assessment: output.relation=not_established
limitations: evidence_quote_missing:evidence_7d1e0a7d-5a83-4c22-a014-6ccd0873b007
以上是模型建议，不是证据或修订授权；请结合原题和已有依据处理。
{"population.entity":{"status":"assumed","value":{"name":"olist_geolocation 表的地理定位记录（一
```
最后set已无undeclared/open，可执行结果；未见结果查询或export，不是已证Spec阻断。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local062/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local062/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local062/attempts/attempt-001/trace.json /toolCalls/15/result/content/0/text`
```text
[HYPOTHESIS_COMPARISON_ADVISORY] path=population.eligibility
[ADVICE_LEAN] alternativeId=alternative_52d72a7e-998b-4313-add4-fc19e5446f72 probability=0.53
{"model":"jev-1.13.0","recommendation":{"kind":"hypothesis","hypothesisId":"alternative_52d72a7e-998b-4313-add4-fc19e5446f72"},"probabilities":[{"hypothesisId":"alternative_52d72a7e-998b-4313-add4-fc19e5446f72","probability":0.53},{"hypothesisId":"alternative_c34a83fc-dda9-44e5-998c-ec0f22168a53","probability":0.13}],"abstentionProbabilities":{"insufficientEvidence":0.15,"multiplePlausible":0.19,"noneSupported":0},"confidence":0.41}
This recommendation is not evidence. Deciding against a clear lean requires adviceOverride with a reason and evidence ids.
```
eligibility尚open；比较已有倾向，未见最终决定或结果。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local063/attempts/attempt-001/result.json /status`
```text
timeout
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local063/attempts/attempt-001/result.json /error/message`
```text
TASK_TIMEOUT
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local063/attempts/attempt-001/trace.json /toolCalls/36/result/content/0/text`
```text
[IMPLEMENTATION_OBSTACLE] exploration budget exhausted
{"kind":"budget_exhausted","taskId":"task_86de8a5e-52b4-4099-bb84-a42d5e200880","revisionId":"revision_65cd91c8-b521-40ad-9589-3d3f95e66a33","message":"exploration budget exhausted","evidenceIds":[],"attempts":[{"attemptId":"attempt_df2b4902-4b49-4861-b819-b7a44510c63f","taskId":"task_86de8a5e-52b4-4099-bb84-a42d5e200880","kind":"revision","revisionId":"revision_29c423dd-8795-4880-9dfb-6729c59f29b9","invocationId":"01a1264b-cf11-7587-a7fa-b9c19039d2f0","state":"succeeded","sqlExecuted":false,"outcome":"succeeded","createdAt":"2026-10-10T14:51:10.811Z","updatedAt":"2026-10-10T14:51:10.810Z"},{"attemptId":"attempt_bccd174b-bf25-4410-942a-94400a93366c","taskId":"task_86de8a5e-52b4-4099-bb84-a42d5e200880","kind":"exploration","revisionId":"revision_72aad821-3a9a-4797-8ec0-ffbc8cec0d82","invocationId":"01a1264b-ea8e-7587-a7fa-ba23e4c2d0bc
```
selection尚open；22个query调用含预算障碍，末两次返回exploration budget exhausted。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local212/attempts/attempt-20261010-154318Z/result.json /status`
```text
max_tool_calls
```
保存的运行终态，不是SQL语义得分。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local212/attempts/attempt-20261010-154318Z/result.json /error/message`
```text
MAX_TOOL_CALLS
```
实际停止标记。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local212/attempts/attempt-20261010-154318Z/trace.json /toolCalls/50/result/content/0/text`
```text
Tool execution was cancelled before completion.
```
第50工具已生成候选；第51 export被取消，MAX_TOOL_CALLS停止，无发布CSV。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local212/attempts/attempt-20261010-154318Z/trace.json /toolCalls/49/result/content/0/text`
```text
[RESULT_CANDIDATE]
```
停止前已生成候选，不是SQL未成功。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local355/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=8611 /payload/entry/message/details/undeclared`
```text
[]
```
最后可见Spec未声明字段。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local355/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=8611 /payload/entry/message/details/open`
```text
[]
```
最后可见Spec待定字段。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local355/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=17914 /payload`
```text
{"runId": "01a126b8-9a6c-75a3-aa25-1d6af7ff7501", "toolCallId": "call_00_MGwNoPh4V0qEyEK5CetH4251|e431be88-3d4a-4c2e-b095-f3625743e510", "toolName": "query_database", "type": "tool_start"}
```
日志末尾未形成运行终态；不归为timeout。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local356/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=9839 /payload/entry/message/details/undeclared`
```text
["measure.formula"]
```
最后可见Spec未声明字段。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local356/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=9839 /payload/entry/message/details/open`
```text
[]
```
最后可见Spec待定字段。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local356/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=35066 /payload`
```text
{"role": "assistant", "runId": "01a126b9-28af-75a3-aa25-1e79d3b9e0dc", "type": "message_update", "updateType": "toolcall_end"}
```
日志末尾未形成运行终态；不归为timeout。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local360/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=4753 /payload/entry/message/details/undeclared`
```text
["output"]
```
最后可见Spec未声明字段。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local360/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=4753 /payload/entry/message/details/open`
```text
["population.eligibility"]
```
最后可见Spec待定字段。
- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local360/attempts/attempt-20261010-154318Z/record/events.jsonl sequence=13804 /payload`
```text
{"role": "assistant", "runId": "01a126bb-1dcb-75a3-aa25-2162fc3b4a0f", "type": "message_update", "updateType": "thinking_delta"}
```
日志末尾未形成运行终态；不归为timeout。

## 执行链改进建议

- 以attempt索引驱动结果汇总；一次性原子更新caseScores、correct/total/score、fixedDenominator与用户报告，防止局部重试后混用不同批次分母。
- 保留未终结的events和启动/结束记录，明确partial≠timeout；取消时落盘停止阶段、正在执行的工具及候选/发布状态。
- 修订/探针/证据预算与外层工具预算分开报告；预留交付工具预算，避免候选已产生却在export被取消。
- 对知识section not found、比较器451、预算障碍作专门回归；不能只看isError，set的路径拒绝或run_python内部status:error也可能发生在isError=false返回中。
- 本审计发现的是现象及保障缺口，没有实施运行器修复，也没有定位全部timeout的上游原因。

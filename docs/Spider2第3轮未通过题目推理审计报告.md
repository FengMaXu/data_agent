# Spider2 第 3 轮未通过题目推理审计报告

## 1. 审计结论

第 3 轮 SQLite 全量评测共 135 题，正确 49 题，固定分母 E2E 正确率为 **36.30%（49/135）**。因此“只有约三分之一”不是单一 SQL 方言或工具故障造成的，而是 86 个未通过案例中存在三类不同问题：

| 失败类别 | 数量 | 占全部未通过 | 核心问题 |
|---|---:|---:|---|
| 结果形状不匹配 | 45 | 52.3% | 已算出候选/中间结果，但没有收敛到用户要求的行数和列数 |
| 形状相同但语义/数值错误 | 22 | 25.6% | 分母、JOIN 基数、时间边界、公式、实体集合或单位错误 |
| 没有 CSV 交付 | 19 | 22.1% | 12 个 max_turns、6 个 timeout、1 个 completed 但未导出 |
| **合计** | **86** | **100%** | |

### 为什么准确率停在三分之一附近

1. **超过一半的失败不是“不会算”，而是“算完没有交付正确粒度”**：45 题中，模型曾经得到标量、Top-N 或分组候选，却把分布、明细、诊断列或全量排名导出。
2. **约四分之一是同形异值**：模型的 SQL 能执行、行列数也可能正确，但业务定义已经被模型自己的“合理解释”替换。
3. **约五分之一没有完成导出闭环**：复杂题目中模型在 schema 探查、日期边界、F1 事件分类、递归 CTE 等问题上反复探索，最终耗尽轮次或超时。
4. **修复基础设施后，模型暴露出更纯粹的语义能力上限**：工具错误由 273 降至 61，SQL 方言和 Python/Widget 故障基本消失，但无工具错误题的正确率仍只有 42.9%，说明剩余主因已转为语义规划和输出契约。

## 2. 证据与范围

- 第 3 轮运行：`C:/data-agent-eval/runs/spider2-local-improved-full-003`
- 第 3 轮评分：`C:/data-agent-eval/runs/spider2-local-improved-full-003/official_score/summary.json`
- 冻结基线：`C:/data-agent-eval/runs/spider2-local-baseline-full-002`
- 预提取审计证据：`D:/data_agent/.tmp/spider2-failure-audit/`
- 评测题目：`C:/data-agent-eval/Spider2/spider2-lite/spider2-lite.jsonl`

审计使用了每题 question、tool calls/results、最终 SQL、CSV 与 Gold shape/value 对比；对部分 compact evidence 不完整的案例，明确标注“无法从现有证据确认”，不把推测写成事实。

## 3. 关键统计

### 3.1 运行和工具行为

| 指标 | 基线 full-002 | 第 3 轮 full-003 | 变化 |
|---|---:|---:|---:|
| E2E 固定分母 | 38/135（28.15%） | 49/135（36.30%） | +11 题 |
| completed | 94 | 115 | +21 |
| max_turns | 25 | 12 | -13 |
| timeout | 16 | 8 | -8 |
| CSV 提交 | 112 | 116 | +4 |
| 平均工具调用 | 18.27 | 16.04 | -12.2% |
| 工具错误总数 | 273 | 61 | -77.7% |
| SQL Guard 错误 | 122 | 5 | -95.9% |
| Python 错误 | 27 | 0 | -100% |
| Widget 调用错误 | 7 | 0 | -100% |

### 3.2 未通过案例的复杂度信号

| 失败类别 | 平均 query_database 次数 | 平均工具错误 | 解释 |
|---|---:|---:|---|
| 正确题 | 8.22 | — | 通常能较快锁定粒度并导出 |
| 形状错误 | 10.31 | 0.40 | 常常能算出候选，但最终投影/排序错误 |
| 同形异值 | 10.55 | 0.23 | SQL 已执行，主要是业务语义错位 |
| 无 CSV | 20.11 | 1.16 | 探索和 SQL 重写显著过多，未形成交付闭环 |

## 4. 最重要的推理失效模式

### 4.1 把中间步骤误当最终答案

典型链路：

```text
按组/按人/按月计算
→ 得到候选或分布
→ 模型口头识别出第一名/总和/平均值
→ 认为“完整结果”更有用
→ 导出全部候选或诊断明细
```

代表题：`local002`、`local010`、`local020`、`local025`、`local031`、`local056`、`local063`、`local167`、`local197`、`local202`、`local264`、`local311`、`local330`、`local335`。

### 4.2 把筛选键或诊断列带进最终输出

代表题：`local003`、`local029`、`local040`、`local061`、`local085`、`local212`、`local219`、`local283`、`local309`。

模型把排序指标、分母、样本数、年份、ID、points 等用于计算的字段自动当成用户要求的输出字段。

### 4.3 用“领域上更合理”的定义覆盖题目明确公式

代表题：

- `local007`：组件差值改成日历借位差；
- `local081`：明确排除折扣，却使用 `(1-discount)`；
- `local229`：partnership 总分擅自加入 extras；
- `local309`：results 汇总改成 standings 末轮。

### 4.4 只验证 SQL 自洽，没有验证业务口径

常见错误是只检查：

- 行数是否守恒；
- 桶数量是否等于总客户数；
- 手算是否与自己 SQL 相同；
- Top-N 看起来合理；
- SQL 是否能执行。

但没有检查：分子分母是否同一事件集合、JOIN 是否膨胀、窗口是否保留历史基线、公式是否逐字对应题面。

### 4.5 复杂题在数据覆盖或边界问题上无限探索

代表题：

- `local015`：安全帽与碰撞表关联键覆盖异常；
- `local301`、`local302`：周窗口和 anchor week 反复争论；
- `local336`：race 336 没有逐圈数据却持续猜测映射；
- `local344`、`local356`：F1 超车事件分类没有先锁定伪代码；
- `local329`、`local360`：日志去重和序列规则未固定。

## 5. 退化现象结论

基线到第 3 轮有 8 个需要复核的案例：

| 案例 | 判定 |
|---|---|
| `local007` | 真回归：明确组件公式被改成日历借位，4.92 → 4.82 |
| `local081` | 真回归：排除折扣被改成应用折扣，分组数量变化 |
| `local085` | 真回归：百分比 6.41 被输出为 0.0641，并多出 total_orders |
| `local131` | 真回归：三列 preference position 被合并成一个 TimesChosen，且加入 5 个零记录 style |
| `local197` | 输出回归：核心第一名仍对，但 `LIMIT 1` 改成 `LIMIT 10` |
| `local229` | 真回归：partnership 总分加入 extras，226/209/200 变为 229/215/204 |
| `local275` | 不是真回归：两轮都得到空集；Gold 与 “every month > 2” 题面冲突 |
| `local309` | 真回归：results 汇总替换为 standings 末轮，早期 constructor 为空、积分不一致 |

因此，不能用“模型随机性”解释全部退化。至少 6 个是明确的 SQL/输出合同回归，`local197` 是核心值正确但输出粒度回归；`local275` 应归类为评测参考答案 artifact。

## 6. 修复优先级

### P0：强制交付闭环

状态必须从 `DISCOVERING → PLAN_LOCKED → SQL_VALIDATED → SHAPE_VALIDATED → EXPORTING → DELIVERED` 逐步推进。`completed` 不应仅表示模型停止，而必须表示：

- 最终 SQL 已成功执行；
- 行数和列数符合题意；
- 已调用 `export_query`；
- CSV 文件存在；
- 导出 SQL 是最后一个成功验证的 SQL。

### P1：最终输出 shape/列白名单

在导出前强制检查：

- scalar 是否 1×1；
- Top-N 是否确实只返回 N 行；
- “for each tier/position/year” 是否保留对应维度；
- 用户只点名的列是否是最终 SELECT 的完整白名单；
- percentage 是否为 0–100，而不是 0–1；
- 是否存在未经要求的 ID、分母、样本数、points 或诊断列。

### P1：防止业务口径漂移

SQL 生成前形成约束表：

- 必须包含/排除的条件；
- 精确公式；
- 分子和分母事件集合；
- 时间边界和基线范围；
- 主体实体粒度；
- 最终输出字段、顺序、精度和单位。

### P1：防止复杂任务失控

- schema 探查和同类 SQL 重写设置预算；
- 连续重复错误后强制切换策略；
- 对时间窗口、日志序列、F1 事件、FIFO、递归包装提供固定模板；
- 逐圈/跨表任务先进行 coverage preflight；
- 空集结果要输出“满足月份/候选数”的诊断，而不是猜测性改写。

### P2：修复当前仍有的工具文档漂移

第 3 轮仍出现：

- `read_knowledge_file` 不存在；
- `check_connection` 不存在；
- 错误的 knowledge 路径；
- `read_knowledge` 与当前路径合同不一致。

应让 `.pi/SYSTEM.md`、Skill、`tools-catalog.ts` 和运行时注册工具由同一份清单生成或测试校验。

## 7. 结论

第 3 轮已经证明基础设施修复有效：SQL Guard、SQLite 方言、Python、Widget、CSV 导出和任务收敛均明显改善，正确率从 28.15% 提升到 36.30%。

但准确率仍只有三分之一的根因是：Agent 缺少可靠的“业务合同 → 查询粒度 → 最终投影 → 导出交付”闭环。当前最常见的不是 SQL 完全不会写，而是：

- 结果算到了但导出错层级；
- SQL 能运行但公式/分母/时间范围错；
- 复杂题在探查中耗尽预算；
- 已有正确结果却继续推理并覆盖；
- 参考答案 artifact 与模型能力问题未分离。

下一轮不应继续主要增加通用提示词长度，而应优先实现运行时的强制状态机、输出 shape 校验、列白名单、约束表和复杂任务模板。

---

## 8. 分案例详细审计



### A. 45 个结果形状错误案例

# Spider2 Round-3 CSV 形状失败审计

## 一、范围与方法

- 审计范围：用户指定的 **45 个 `shape_mismatch` case**。
- 证据来源：
  - 聚合元数据：`D:/data_agent/.tmp/spider2-failure-audit/summary.json`
  - 单例轨迹：`D:/data_agent/.tmp/spider2-failure-audit/cases/<id>.md`
- 审计方法：逐例核对问题文本、Gold 形状、最终 SQL、查询预览、导出决策和模型自述；不依赖猜测数据库业务含义。
- 重点：模型为何在已经得到候选标量、Top-N 或目标列后，仍选择了错误的行粒度、透视方式或附加列。

## 二、根因分类与计数

以下为每例的**主根因**，合计 45：

| 根因代码 | 主根因 | 数量 | 占比 |
|---|---|---:|---:|
| G1 | 未执行最终收敛：把分布、候选集或明细导出，未收敛到标量/第一名/Top-N | 14 | 31.1% |
| G2 | 最终投影过宽：行集合基本接近，但附加 ID、计数、年份、解释指标等非合同列 | 11 | 24.4% |
| G3 | 输出粒度或透视理解错误：应分列却合计、应按另一实体输出、应保留桶却全局折叠 | 6 | 13.3% |
| G4 | 业务聚合、过滤或实体集合错误，并连带造成行列形状不符 | 12 | 26.7% |
| G5 | 回合/时间耗尽后将中间原始数据作为最终 CSV | 1 | 2.2% |
| G6 | 使用预计算结果表替代题目要求的推导，导致地点、列和语义均错 | 1 | 2.2% |

最明显的系统性问题是：轨迹多次读到本地规则中的“标量、Top-N、最终粒度检查”，但导出前没有把自然语言中的最终问句转成硬性 `row_count × column_count` 合同。

---

## 三、逐例审计

### local002 — G1：预测明细代替最终总和

证据：`D:/data_agent/.tmp/spider2-failure-audit/cases/local002.md`

- **请求/Gold 合同**：最终只要四个五日移动平均之和；Gold 为 `1×1`，列 `output`。
- **关键轨迹**：生成连续日期；按玩具品类统计日销量；计算线性回归系数；构造 2018-12-05 至 08 四天预测；模型还用 Python 验证出四个均值之和为 `36.890234...`。
- **精确分叉点**：模型明确决定“final result should contain the four day predictions ... and the sum”，最终 SQL 使用：
  ```sql
  SELECT * FROM results
  UNION ALL
  SELECT 'TOTAL', ...
  ```
  它把计算过程和最终答案一起导出。
- **最终形状差异**：Pred `5×4`；Gold `1×1`。此外 Pred 总和值约 `36.89`，Gold 为 `14334.62114`，说明计算口径也不一致。
- **主根因**：G1，未把“Finally provide the sum”落实为单行单列。
- **次根因**：销量、回归或季节平滑口径与 Gold 冲突。
- **通用预防规则**：当问句以“finally provide the sum/average/count”结束时，最后一层只能投影该最终聚合；过程明细不得进入交付 CSV。

### local003 — G2：分段指标旁带出四个诊断列

证据：`.../cases/local003.md`

- **请求/Gold 合同**：每个 RFM 分段一行，仅分段和平均销售指标；Gold `11×2`：`RFM_Bucket, avg_sales_per_customer`。
- **关键轨迹**：读取 RFM 文档；按 `customer_unique_id` 聚合 delivered 订单；构造 R/F/M 五分位；CASE 映射 11 个分段。
- **精确分叉点**：最终 SELECT 同时保留：
  ```sql
  segment, COUNT(*) AS n_customers,
  SUM(total_spend), SUM(n_orders),
  SUM(total_spend)/SUM(n_orders)
  ```
  模型把用于解释和验证的分母、分子也作为交付列。
- **最终形状差异**：Pred `11×5`；Gold `11×2`。
- **主根因**：G2，输出投影过宽。
- **次根因**：列名是 `avg_sales_per_order`，Gold 为 `avg_sales_per_customer`；`Cant Lose Them` 还缺少撇号，数值口径也不同。
- **预防规则**：分组指标可以在 CTE 内保留分子、分母和样本数，但最终投影必须只包含题目点名的维度和指标。

### local010 — G1：输出完整距离分布而不是最少桶的数量

证据：`.../cases/local010.md`

- **请求/Gold 合同**：先分桶，再回答“最少的距离范围中有多少城市对”；Gold `1×1`。
- **关键轨迹**：解析机场坐标；Haversine 距离；无向城市对标准化；按城市对求平均距离；分为 7 个距离桶。
- **精确分叉点**：预览已经得到桶计数 `92,93,37,20,6,3,7`，并在文字中回答“5000–6000 有 3 对”，但导出 SQL仍为：
  ```sql
  SELECT distance_range, COUNT(*)
  FROM bucketed
  GROUP BY distance_range
  ```
  没有再取最小计数。
- **最终形状差异**：Pred `7×2`；Gold `1×1`。
- **主根因**：G1。
- **次根因**：Pred 计算值 `3` 与 Gold `6` 不同，分桶或“unique route/city pair”口径亦有差异。
- **预防规则**：多阶段问题中，“先分组/分桶”通常是中间步骤；若最后问“how many/which one”，必须再加一层排序或聚合。

### local018 — G2：标量答案被扩展为十列审计记录

证据：`.../cases/local018.md`

- **请求/Gold 合同**：只返回百分点评估值；Gold `1×1`。
- **关键轨迹**：确定 2021 最常见类别是 `speeding`；查得 2011 与 2021 分子分母；计算两年占比。
- **精确分叉点**：最终 SQL硬编码并输出类别、年份、四个计数、两个占比和差值，共十列。
- **最终形状差异**：Pred `1×10`；Gold `1×1`。
- **主根因**：G2。
- **次根因**：Pred 中间 `ROUND(...,2)` 且按 `2011-2021` 得 `-0.55`；Gold 是正的高精度 `0.553654`。
- **预防规则**：标量题只导出精确未过早舍入的标量；审计分子分母可在说明中出现，不应进入 CSV。

### local020 — G1：排序出全部 282 位投手而未取第一名

证据：`.../cases/local020.md`

- **请求/Gold 合同**：最低 bowling average 的投手姓名；Gold `1×1`。
- **关键轨迹**：计算打者得分、wide/no-ball、可归因投手的 wickets；预览以 average 升序并确认 `AC Gilchrist` 第一。
- **精确分叉点**：模型已说“strict answer is AC Gilchrist”，但认为“complete final result”应为完整排名；导出 SQL仅 `ORDER BY`，无 `LIMIT 1`。
- **最终形状差异**：Pred `282×7`；Gold `1×1`。
- **主根因**：G1。
- **次根因**：附加球员 ID、技能、国家、wickets、runs、average。
- **预防规则**：“Which X has min/max”默认合同是获胜实体，不是排行榜；除非用户明确要求排名明细。

### local025 — G1：已算平均值，却选择导出每场最高 over 明细

证据：`.../cases/local025.md`

- **请求/Gold 合同**：所有比赛“最高 over 总分”的平均值；Gold `1×1`。
- **关键轨迹**：按 match/innings/over 汇总打者分与 extras；为 over 选择 bowler；对每场最高 over 排名；查得 568 场。
- **精确分叉点**：模型查询并验证：
  ```sql
  SELECT ROUND(AVG(total),4) ...  -- 19.4261
  ```
  随后自述“most useful complete final result is per-match rows”，导出 568 条明细。
- **最终形状差异**：Pred `568×6`；Gold `1×1`。
- **主根因**：G1。
- **次根因**：Pred 验证的平均 `19.4261` 也不同于 Gold `19.02098951`，表明 tie/runs 口径仍错。
- **预防规则**：一旦题目最终聚合已成功执行，不得再用“可验证性/完整性”理由退回中间明细粒度。

### local029 — G2：Top-3 行正确格式未收窄到三列

证据：`.../cases/local029.md`

- **请求/Gold 合同**：Top-3 客户对应的平均支付、城市、州；Gold `3×3`。
- **关键轨迹**：先按订单汇总支付；过滤 delivered；按 `customer_unique_id` 计订单数并排序。
- **精确分叉点**：最终 SELECT 保留 `customer_unique_id` 和 `delivered_orders`，尽管问题只要求“provide the average payment value, city, and state”作为结果字段。
- **最终形状差异**：Pred `3×5`；Gold `3×3`。
- **主根因**：G2。
- **次根因**：Gold 的客户城市和平均支付值均不同，说明 Top-3 或 payment 平均口径也未对齐。
- **预防规则**：用于 Top-N 选择的键和排序指标不自动属于最终投影；输出列应单独列白名单。

### local031 — G1：输出最低年度的月度明细而非月度峰值

证据：`.../cases/local031.md`

- **请求/Gold 合同**：最低年度中最高的月度 delivered volume；Gold `1×1`。
- **关键轨迹**：统计 2016/17/18 年度 delivered 数量；确定 2016 最低；统计 2016 各月。
- **精确分叉点**：模型文字回答 `265`，但把 2016 的三个月明细作为“complete monthly result”导出。
- **最终形状差异**：Pred `3×2`；Gold `1×1`。
- **主根因**：G1。
- **次根因**：Pred `265` 与 Gold `205` 不同，可能使用了错误日期字段或 delivered 月份口径；仅能确认合同与值均矛盾。
- **预防规则**：当明细只是寻找 `MAX` 的输入，最终 SQL必须是 `MAX(...)` 或确定性的 `ORDER BY ... LIMIT 1` 投影。

### local035 — G3：把“城市”解释成原始地理记录

证据：`.../cases/local035.md`

- **请求/Gold 合同**：仅输出相邻的两个城市；Gold 接受 `1×2` 或 `2×1`。
- **关键轨迹**：对 100 万行 `olist_geolocation` 逐行 `ROW_NUMBER()`；连接相邻行；球面余弦距离；排序取最大。
- **精确分叉点**：模型明确采用“consecutive rows”，而不是先按城市形成城市实体。于是接受异常坐标 `14.585,121.105`，得到 `santa cruz do sul / santa lucia do piai`。
- **最终形状差异**：Pred `1×13`，包含行号、州、ZIP、经纬度、距离；Gold 只要两座城市，且 Gold 城市对不同。
- **主根因**：G3，业务实体粒度错误。
- **次根因**：最终投影包含 11 个诊断字段；模型发现数据异常后仍将异常结果视为答案。
- **预防规则**：自然语言实体如“city”必须先定义实体键和代表坐标；不得直接把事实表一行等同于一个城市。

### local037 — G2：额外输出支付类型，并改写类别语言

证据：`.../cases/local037.md`

- **请求/Gold 合同**：Top-3 类别及 payment count；Gold `3×2`。
- **关键轨迹**：按类别和 payment type 计数；每类 `ROW_NUMBER()` 取最常用支付方式；跨类别取前三。
- **精确分叉点**：最终输出 `product_category, payment_type, payment_count`，还通过翻译表改成英文类别。
- **最终形状差异**：Pred `3×3`；Gold `3×2`，并要求葡语原始类别。
- **主根因**：G2。
- **次根因**：Pred 计数 `8959/7566/6635` 高于 Gold，说明 payment×order_item 连接可能把同一支付按商品行放大。
- **预防规则**：题目若只要求说明数量，不应把用于识别“most common”的类别值也输出；语言转换必须有显式要求。

### local040 — G2：附带树数且排序/精度不符

证据：`.../cases/local040.md`

- **请求/Gold 合同**：三个 borough 及平均 mean income；Gold `3×2`。
- **关键轨迹**：发现 income ZIP 重复；按 ZIP 去重；连接树；过滤有效收入和 borough；按树数选前三。
- **精确分叉点**：最终保留选择指标 `COUNT(*) AS tree_count`，并将收入 `ROUND(...,2)`。
- **最终形状差异**：Pred `3×3`；Gold `3×2`。三个 borough 集合相同，但顺序及小数不同。
- **主根因**：G2。
- **次根因**：过早四舍五入；Gold 输出顺序不是 Pred 的树数降序。
- **预防规则**：Top-N 的排名依据可用于 `ORDER BY`，但除非明确要求，不应自动出现在最终列中。

### local056 — G1：全客户排名代替单一姓名

证据：`.../cases/local056.md`

- **请求/Gold 合同**：最高平均月度变化的客户全名；Gold `1×1`。
- **关键轨迹**：按客户月度汇总支付；`LAG` 求月差；对差值取平均；排序。
- **精确分叉点**：已确认 top 是 customer 487，但导出全部 599 位客户，并称其为“complete ranked list”。
- **最终形状差异**：Pred `599×3`；Gold `1×1`；Pred 第一名 `HECTOR POINDEXTER`，Gold 为 `STEPHEN QUALLS`。
- **主根因**：G1。
- **次根因**：平均月差定义与 Gold 不一致，可能涉及完整月份或差值方向；这里只能确认最终姓名冲突。
- **预防规则**：`Which customer has highest... Provide full name` 必须以 `LIMIT 1` 且仅投影姓名结束。

### local060 — G4：产品集合、百分位和结果单位均错

证据：`.../cases/local060.md`

- **请求/Gold 合同**：产品名称及 share change；Gold `4×2`。
- **关键轨迹**：筛选美国无促销 Q4；选增长至少 20% 的城市；按两季度合计销售排名产品；用 `CEIL(20%×72)=15` 选产品；算份额变化。
- **精确分叉点**：模型将“top 20%”解释为 72 个产品中的 15 个，并对这些产品全部输出；未根据 Gold 所需集合收敛。
- **最终形状差异**：Pred `15×5`，为 `prod_id,total_sales,share_2019,share_2020,share_change`；Gold `4×2`，为名称和百分点变化。
- **主根因**：G4，产品范围和百分位语义错误。
- **次根因**：输出 ID 而非名称；份额为比例而 Gold 为百分点。
- **预防规则**：百分位筛选必须明确是行数百分位、销售累计占比还是分组内百分位；用小样本计数验证预期入选数后再投影。

### local061 — G2：月份结果附带固定年份

证据：`.../cases/local061.md`

- **请求/Gold 合同**：每月及平均 projected USD；Gold `12×2`。
- **关键轨迹**：法国 2019/20 产品月销售；按文档公式预测 2021；连接 2021 汇率；每月 AVG。
- **精确分叉点**：最终 SELECT 同时输出固定值 `cur.year`。
- **最终形状差异**：Pred `12×3`；Gold `12×2`。
- **主根因**：G2。
- **次根因**：各月数值均偏低于 Gold，说明产品月纳入集合或平均分母有差异。
- **预防规则**：若所有行年份固定且问题只要求“by month”，年份是过滤条件，不是输出维度。

### local063 — G1：候选 Top-20% 全部导出而非最小变化产品

证据：`.../cases/local063.md`

- **请求/Gold 合同**：单个产品名称；Gold `1×1`。
- **关键轨迹**：筛城市；按总销售对 72 个产品排序；取前 14；算两季度份额差。
- **精确分叉点**：模型已经按 `ABS(pp_change)` 排出第一候选，却最终导出 `WHERE rn<=14` 的全部候选及七列指标。
- **最终形状差异**：Pred `14×7`；Gold `1×1`。
- **主根因**：G1。
- **次根因**：将“smallest percentage-point change”解释为绝对值最小；产品维表缺失名称后仍交付空名称，Gold 答案不同。
- **预防规则**：题目问候选集中的“which product”时，候选集之后必须再进行一次确定性极值选择，并只输出实体名称。

### local064 — G2：标量差值扩成七列分析记录

证据：`.../cases/local064.md`

- **请求/Gold 合同**：两个平均余额之差；Gold `1×1`。
- **关键轨迹**：按客户/月算 deposit−withdrawal；统计正余额客户数与平均余额；找最大、最小月份。
- **精确分叉点**：最终输出最大月、最大计数、最大平均、最小月、最小计数、最小平均、差值。
- **最终形状差异**：Pred `1×7`；Gold `1×1`。
- **主根因**：G2。
- **次根因**：Pred 差值 `334.872...`，Gold `363.742`，说明客户月份补零或平均分母口径不一致。
- **预防规则**：如果最后一句是“provide the difference”，中间两个月及其统计只用于计算，不属于最终投影。

### local067 — G3：十个 tier 被折叠成全局极值

证据：`.../cases/local067.md`

- **请求/Gold 合同**：每个 decile bucket 的最大、最小利润；Gold `10×3`。
- **关键轨迹**：按意大利客户汇总 2021-12 利润；`NTILE(10)` 分层。
- **精确分叉点**：模型自行解释“global maximum and minimum across the tiered customers”，最终：
  ```sql
  SELECT MIN(total_profit), MAX(total_profit) FROM tiered
  ```
  完全丢弃 `tier`。
- **最终形状差异**：Pred `1×2`；Gold `10×3`。
- **主根因**：G3。
- **次根因**：`NTILE(10) OVER (ORDER BY total_profit)` 使 bucket 1 为低利润组，而 Gold bucket 1 是最高利润组，排序方向也反了。
- **预防规则**：一旦问题明确“segmented into N tiers”，最终 `GROUP BY tier` 是强制合同，不能再全局聚合。

### local085 — G2：多出总订单列且比例未转百分数

证据：`.../cases/local085.md`

- **请求/Gold 合同**：员工 ID、late count、late percentage；Gold `3×3`。
- **关键轨迹**：按 employee 聚合；`shippeddate >= requireddate`；过滤订单数 >50；取迟到率前三。
- **精确分叉点**：最终保留 `COUNT(*) AS total_orders`，并输出 `late/total` 的 0–1 比例。
- **最终形状差异**：Pred `3×4`；Gold `3×3`，Gold 百分数为 `6.41...` 等。
- **主根因**：G2。
- **次根因**：百分比尺度少乘 100。
- **预防规则**：题目称 percentage 时应显式确认输出是 0–100；分母可用于计算但默认不输出。

### local131 — G3：把三个偏好位置合计成一个数

证据：`.../cases/local131.md`

- **请求/Gold 合同**：每种 style 一行，分别列 First/Second/Third preference；Gold `20×4`。
- **关键轨迹**：检查 `PreferenceSeq` 为 1、2、3；统计共有 15/15/6 条。
- **精确分叉点**：模型误读“as a 1st, 2nd, or 3rd preference”为三个位置合计，使用单个 `COUNT(mp.CustomerID) AS TimesChosen`。
- **最终形状差异**：Pred `25×2`；Gold `20×4`。
- **主根因**：G3，缺少条件聚合透视。
- **次根因**：LEFT JOIN 包含 5 个从未被偏好的 style，而 Gold 只含有偏好记录的 20 个。
- **预防规则**：“1st, 2nd, or 3rd ... in a single row”通常表示条件聚合成三列，而不是合并总数。

### local133 — G3：只保留有排名风格并附加中间总分

证据：`.../cases/local133.md`

- **请求/Gold 合同**：每个 style 及其与平均加权分的绝对差；Gold `25×2`。
- **关键轨迹**：按 3/2/1 加权；按 style 汇总；计算平均总分及绝对差。
- **精确分叉点**：`style_scores` 从 `Musical_Preferences` 出发并 `HAVING COUNT>0`，所以只剩 20 个被选择的 style；最终又输出 `StyleID,total_score` 两个中间字段。
- **最终形状差异**：Pred `20×4`；Gold `25×2`。
- **主根因**：G3，实体全集和输出投影错误。
- **次根因**：平均值仅在 20 个 style 上算，Gold 包含 25 个，因此分数不同。
- **预防规则**：当输出对象来自维表全集时，应由维表 LEFT JOIN 事实表，并明确零记录是否参与平均。

### local141 — G4：销售额口径与年度配对集合不符

证据：`.../cases/local141.md`

- **请求/Gold 合同**：销售员、销售年、总销售、quota 年、quota、差额；Gold `58×6`。
- **关键轨迹**：按 `salesorderheader.subtotal` 汇总销售员年度销售；按 quota history 年度求和；LEFT JOIN。
- **精确分叉点**：模型把所有有销售年份保留，并对缺 quota 使用 `COALESCE(...,0)`；没有限制为有效销售-配额年度组合。
- **最终形状差异**：Pred `62×5`；Gold `58×6`，并要求单独 `SalesQuotaYear`。
- **主根因**：G4。
- **次根因**：Pred 2011 salesperson 274 销售 `28926.25`，Gold `32567.9155`，总销售计算基础也不一致。
- **预防规则**：年度对比必须先定义有效的 `(entity, sales_year, quota_year)` 集合；缺失配额不能自动用零扩充输出。

### local167 — G1：返回全部州而不是最高州

证据：`.../cases/local167.md`

- **请求/Gold 合同**：最高州缩写及计数；Gold `1×2`。
- **关键轨迹**：找女性议员；按最早 term 得 first state；判断任一 term 是否跨过当年 12-31；按州计数。
- **精确分叉点**：模型确定 CA 第一后，仍称“export full grouped results”，最终仅排序，无 `LIMIT 1`。
- **最终形状差异**：Pred `54×2`；Gold `1×2`。
- **主根因**：G1。
- **次根因**：Pred CA 为 42，Gold 为 43，12 月 31 日包含逻辑少计一人。
- **预防规则**：“which state has the highest”必须在分组之后再取第一行，不能把完整分组表当答案。

### local194 — G3：按 actor 透视，而 Gold 要全局 Top-3 film

证据：`.../cases/local194.md`

- **请求/Gold 合同**：Gold 为全局三个影片及 `rev_per_actor`，`3×2`。
- **关键轨迹**：算每片总收入；除以演员数；为每位演员对影片排序。
- **精确分叉点**：模型专门作出设计决策：“one row per actor, containing the 3 films and the average”，用条件聚合把每位 actor 的三片横向展开。
- **最终形状差异**：Pred `200×9`；Gold `3×2`。
- **主根因**：G3，目标实体被理解成 actor，而评测合同是 film。
- **次根因**：计算每位 actor 的 top-3 平均，Gold 只要影片的均摊收入。
- **预防规则**：复杂“for each actor/top films”表述应先写出一行代表什么；若最终 Gold/需求只命名影片与指标，不应转成 actor 宽表。

### local197 — G1：导出变化幅度前十而不是全局最大一条

证据：`.../cases/local197.md`

- **请求/Gold 合同**：最大变化发生月份和差值；Gold `1×2`。
- **关键轨迹**：找 Top-10 付费客户；按月汇总；`LAG` 求变化；确认 customer 148 在 2005-07 的 `77.83` 为唯一最大。
- **精确分叉点**：最终使用 `ORDER BY ABS(mom_diff) DESC LIMIT 10`，并输出客户 ID、姓名。
- **最终形状差异**：Pred `10×4`；Gold `1×2`。
- **主根因**：G1。
- **次根因**：Gold 只要月份 `07`，Pred 为完整 `2005-07`。
- **预防规则**：唯一极值已经验证无并列时，必须 `LIMIT 1`；排名解释行不得扩展最终结果。

### local202 — G1：已验证答案 5，却导出 Top-10 州明细

证据：`.../cases/local202.md`

- **请求/Gold 合同**：满足条件的州数量；Gold `1×1`。
- **关键轨迹**：统计州人口、friendly/hostile 百分比和平均年龄；列出 Top-10；人工识别五州；另执行标量查询得到 `5`。
- **精确分叉点**：导出时没有使用已经验证的 `SELECT COUNT(*) ... WHERE ...`，而是导出十州七列明细。
- **最终形状差异**：Pred `10×7`；Gold `1×1`。
- **主根因**：G1。
- **次根因**：无必要的展示性诊断列进入 CSV。
- **预防规则**：最后一次成功验证的“答案查询”必须与导出查询一致；禁止在导出时切回之前的分析查询。

### local212 — G2：Top-5 ID 列表被扩展成六列报告

证据：`.../cases/local212.md`

- **请求/Gold 合同**：五个 driver_id；Gold `5×1`。
- **关键轨迹**：连接 delivery 和 order；以创建日期构成工作日；计算 delivered 数/活跃日；排除 NULL driver；取前五。
- **精确分叉点**：最终输出 driver 类型、总配送、活跃日和平均数。
- **最终形状差异**：Pred `5×6`；Gold `5×1`。
- **主根因**：G2。
- **次根因**：Top-5 实体也不一致，Gold 第三位为 `17457`，Pred 为 `49258`，说明“daily average”的日期或分母定义未对齐。
- **预防规则**：实体列表题只投影实体键；指标和属性仅在明确要求时输出。

### local219 — G2：每联盟结果附带 wins

证据：`.../cases/local219.md`

- **请求/Gold 合同**：每联盟一个 team；Gold `11×2`：league, team。
- **关键轨迹**：展开 home/away；计 wins；按联盟 `ROW_NUMBER()` 取 wins 最少且 team_api_id 最小者。
- **精确分叉点**：最终额外投影 `r.total_wins AS wins`。
- **最终形状差异**：Pred `11×3`；Gold `11×2`。
- **主根因**：G2。
- **次根因**：说明声称包含 zero-win team，但实际集合只来自 Match；在当前结果中最小均大于零。
- **预防规则**：排名指标可作为排序依据，不应默认成为输出列。

### local220 — G4：内部逻辑一致，但实体答案与 Gold 完全冲突

证据：`.../cases/local220.md`

- **请求/Gold 合同**：两个球员名称；Gold 接受 `2×1` 或 `1×2`，答案为 `Marcelo, Ricardo`。
- **关键轨迹**：展开 22 个首发列；排除平局和 NULL；根据 home/away 胜方累计胜负场；连接 Player。
- **精确分叉点**：模型以累计所有比赛的胜/负次数为准，选出 Cristiano Ronaldo 和 Gorka Iraizoz Moreno，并附带类别、ID、胜负数。
- **最终形状差异**：Pred `2×5`；Gold 仅两个名称，且实体不同。
- **主根因**：G4，参与或“winning/losing matches”业务口径错误。
- **次根因**：G2，最终投影过宽。
- **预防规则**：当内部 sanity check 只能证明 SQL 自洽、不能证明合同正确时，应进一步核对题目对“participated”或统计单位的定义。

### local229 — G4：partnership 计算多出一行且列顺序不符

证据：`.../cases/local229.md`

- **请求/Gold 合同**：每场最高 partnership，可并列；`577×6`，列顺序为两位 ID、两位 runs、总分。
- **关键轨迹**：按无序 striker/non-striker 配对；`LAG` 判断配对变化；窗口累积 partnership id；汇总个人 runs 和 extras；按 match 取最大。
- **精确分叉点**：模型将“同一无序 pair 连续出现”作为 partnership 边界，并由此得到 578 行。
- **最终形状差异**：Pred `578×6`；Gold `577×6`；Pred 列顺序交错为 `player1_id, player1_score, player2_id...`。
- **主根因**：G4，partnership 边界或 runs 口径造成实体集合多一行。
- **次根因**：列顺序/名称未按合同。
- **预防规则**：复杂会话/分段算法必须验证每个 match 的 partnership 数及并列数，不能只检查前几场样例。

### local230 — G4：Top genre 内导演影片计数集合错误

证据：`.../cases/local230.md`

- **请求/Gold 合同**：导演及影片数；Gold `3×2`。
- **关键轨迹**：先查得 top genres 为 Drama/Action/Comedy；再连接 director、genre、ratings；按 director 计 distinct movie。
- **精确分叉点**：模型把属于任一 top genre 的影片去重后计数，并因四位导演都为 2 而输出四行。
- **最终形状差异**：Pred `4×2`；Gold `3×2`；Gold 计数为 `4,3,3`。
- **主根因**：G4，影片/genre 计数单位错误。
- **次根因**：最终列名为 `director`，Gold 为 `director_name`。
- **预防规则**：多标签实体的计数必须明确“distinct movie”还是“movie-genre occurrence”；先对一位候选导演展开明细验证。

### local258 — G4：bowler 集合与 wicket/best figure 口径错误

证据：`.../cases/local258.md`

- **请求/Gold 合同**：每位有效 bowler 六列，包括 bowler ID；Gold `286×6`。
- **关键轨迹**：按 wicket kind 排除非投手 dismissal；按 ball_by_ball 数球；只加 bat runs；按 match 选 wickets 最多且 runs 最少的表现。
- **精确分叉点**：模型从所有 `ball_by_ball.bowler` 出发并 LEFT JOIN wickets，保留大量零或低样本 bowler；最终又只输出姓名而丢 bowler ID。
- **最终形状差异**：Pred `329×5`；Gold `286×6`。
- **主根因**：G4，bowler 实体集合及 wicket 口径不符。
- **次根因**：Pred Malinga `143` wickets、`5-12`，Gold `159`、`5-0`，best figure 的 runs 定义也不一致。
- **预防规则**：综合统计表先固定主体集合，再独立校验 wickets、balls、best-match 三个子指标；不能用“所有投过球的人”替代目标 bowler 集合。

### local259 — G4：从完整 player 维表出发，导致 468 行而非 striker 集合

证据：`.../cases/local259.md`

- **请求/Gold 合同**：目标 striker/player 统计，Gold `247×18`。
- **关键轨迹**：分别计算 batting、balls、dismissals、bowling、role；最后从 `player p` LEFT JOIN 全部统计。
- **精确分叉点**：
  ```sql
  FROM player p
  LEFT JOIN ...
  ```
  使所有 468 名球员都出现，即便没有符合目标的 batting 行。
- **最终形状差异**：Pred `468×18`；Gold `247×18`。
- **主根因**：G4，主体实体集合错误。
- **次根因**：总比赛使用 `player_match`，Gold SC Ganguly 为 55 而 Pred 57；wickets 和 best figure 也不同。
- **预防规则**：综合玩家报表必须先定义驱动集合，例如 `DISTINCT striker`；维表只能补属性，不能扩大事实主体。

### local264 — G1：输出两个类别而非最高类别

证据：`.../cases/local264.md`

- **请求/Gold 合同**：频率最高的一个 `L1_model` 及 count；Gold `1×2`。
- **关键轨迹**：分别检查 model、stack_ok、solution_ext 分布；决定 UNION model 与 stack_ok；得到 regression 327、tree 115。
- **精确分叉点**：模型执行过带 `LIMIT 1` 的验证查询，确认 regression，但导出时移除 `LIMIT 1`。
- **最终形状差异**：Pred `2×2`；Gold `1×2`。
- **主根因**：G1。
- **次根因**：Gold count 为 639，Pred 327，说明比较范围或源表选择不完整。
- **预防规则**：导出 SQL必须与最后成功验证的极值 SQL逐字保持关键过滤、排序和 LIMIT 一致。

### local270 — G4：层级累计范围多纳入一个顶层容器

证据：`.../cases/local270.md`

- **请求/Gold 合同**：合格顶层容器和对应 item 名称；Gold `3×2`。
- **关键轨迹**：找顶层容器；找叶子 item；递归乘数量；按容器/item 求和并筛 `>500`。
- **精确分叉点**：递归结果把 `Pallet Mix SG / Bottle 500cl / 856` 也判为合格，最终输出四行。
- **最终形状差异**：Pred `4×3`；Gold `3×2`。
- **主根因**：G4，层级累计或目标容器范围与 Gold 不一致。
- **次根因**：额外输出 `total_quantity`。
- **预防规则**：递归层级题需用手工可核验的小树确认是否应合并多条路径、是否允许混合包装，再只投影所需名称。

### local272 — G6：直接读取 picking_line，绕过要求的库存分配算法

证据：`.../cases/local272.md`

- **请求/Gold 合同**：产品、aisle、position、待拣数量；Gold `4×4`。
- **关键轨迹**：读取订单行与库存；发现 `picking_line` 已含 order 423；模型反复讨论后决定“the answer already exists in the picking_line table”并直接复现。
- **精确分叉点**：最终 SQL仅：
  ```sql
  SELECT ...
  FROM picking_line pl
  JOIN locations l ...
  WHERE pl.order_id=423
  ```
  未实现题目要求的 FIFO、同日小数量优先、warehouse 1、累计 orderline 分配。
- **最终形状差异**：Pred `4×6`；Gold `4×4`；地点和数量也不同。
- **主根因**：G6。
- **次根因**：输出 order_id、warehouse 两个额外列。
- **预防规则**：如果题目明确要求“calculate by prioritizing...”，现成结果表只能用于对照验证，不能替代推导。

### local275 — G4：CMA/ratio 解释导致空结果

证据：`.../cases/local275.md`

- **请求/Gold 合同**：四个 product_name；Gold `4×1`。
- **关键轨迹**：构造月索引；计算两个 12 月窗口平均的 CMA；按 2017 逐月实际/CMA；对每产品取 `MIN(ratio)` 并要求 >2。
- **精确分叉点**：模型把“stayed consistently above 2 for every month”落实为 12 个月最小 ratio >2，并通过明细证明无产品满足，最终导出 0 行。
- **最终形状差异**：Pred `0×3`；Gold `4×1`。
- **主根因**：G4，季节调整比率筛选语义与 Gold 不符。
- **次根因**：即使有结果，Pred 还会输出 product_id 和 min_ratio 两个额外列。
- **预防规则**：时间序列题应先用已知样例产品验证算法能否产生合理候选；若全部为空而题目明显期待实体列表，应重新核对 seasonality-adjusted 指标定义。

### local277 — G5：超时后把 72 行原始销量交付

证据：`.../cases/local277.md`

- **请求/Gold 合同**：两个产品 2018 年平均 forecasted annual sales；Gold `1×1`。
- **关键轨迹**：读取 CMA 文档；分块读取两个产品 36 个月数据；尝试 Python/scipy，遇到缺少 scipy；手工继续 CMA、seasonal index、weighted regression 推导。
- **精确分叉点**：轨迹在复杂回归方法上持续展开但未完成最终计算；最终 SQL退回：
  ```sql
  SELECT product_id, mth, qty
  FROM monthly_sales
  WHERE product_id IN (4160,7790)
  ```
- **最终形状差异**：Pred `72×3`；Gold `1×1`。
- **主根因**：G5，回合/时间耗尽并提交输入数据。
- **次根因**：未确定 weighted regression 权重定义。
- **预防规则**：工具或时间预算受限时，不得把输入表冒充答案；应优先构造最小可执行最终聚合，或明确失败而不导出误导 CSV。

### local283 — G2：正确八行缺少 season_rank

证据：`.../cases/local283.md`

- **请求/Gold 合同**：每季冠军、联盟、国家、积分和排名；Gold `8×6`。
- **关键轨迹**：每场为 home/away team 分配 3/1/0；按 season/team 汇总；按 season 最大 points 选冠军。
- **精确分叉点**：最终 SELECT 只输出五个业务字段，没有显式生成 `season_rank=1`。
- **最终形状差异**：Pred `8×5`；Gold `8×6`。实体和值与 Gold 样例一致。
- **主根因**：G2。
- **次根因**：列别名与 Gold 不同。
- **预防规则**：即便过滤后所有行排名都为 1，若合同要求排名列，也必须显式输出。

### local286 — G4：高销量类别仅在说明中算出，未并入 seller 行

证据：`.../cases/local286.md`

- **请求/Gold 合同**：每 seller 七列，含 `highlight_product`；Gold `237×7`。
- **关键轨迹**：按 seller 计算数量、总销售、均价；连接 review 和 packing time；另行查询全体高销量 seller 的最高类别为 `watches_gifts`。
- **精确分叉点**：最终 seller SQL没有任何 products/category CTE，也没有把每 seller 的最高销量英文类别连接回来。
- **最终形状差异**：Pred `236×6`；Gold `237×7`。
- **主根因**：G4，类别指标算在错误粒度并漏入最终结果。
- **次根因**：seller 资格计数与 Gold 相差一行；多个指标被四舍五入。
- **预防规则**：报告中的“highlight category”必须按每个 seller 计算并 join 回 seller 粒度；全局 top category 不能替代逐卖家字段。

### local297 — G4：把 purchase 也当负数，违背题面限定

证据：`.../cases/local297.md`

- **请求/Gold 合同**：最终百分比；Gold `1×1`，值 `36.4`。
- **关键轨迹**：按月净额；累计 closing balance；取每客户最新月；`LAG` 求增长；统计 >5%。
- **精确分叉点**：
  ```sql
  SUM(CASE WHEN txn_type='deposit'
           THEN txn_amount ELSE -txn_amount END)
  ```
  该 `ELSE` 同时把 `purchase` 当负数。模型虽然注意题目只说 deposits/withdrawals，却依据“canonical dataset”自行纳入 purchase。
- **最终形状差异**：Pred `1×3`；Gold `1×1`；Pred `46.6`，Gold `36.4`。
- **主根因**：G4，过滤和符号规则错误。
- **次根因**：额外输出 total_customers 与 customers_above_5。
- **预防规则**：当题目显式列出参与类型时，用显式 `WHEN deposit / WHEN withdrawal` 并过滤其他类型；不得用外部惯例覆盖题面。

### local309 — G4：用 constructor standings 导致早期年份空值

证据：`.../cases/local309.md`

- **请求/Gold 合同**：每年 driver 与 constructor 名称；Gold `75×3`。
- **关键轨迹**：找每年最后一个有 standings 的 race；按 driver/constructor standings 积分选第一；连接 full name。
- **精确分叉点**：1950–1957 没有 constructor standings，模型仍 LEFT JOIN，输出空 constructor；Gold 1950 要 `Alfa Romeo`、1951/52 要 `Ferrari`。
- **最终形状差异**：Pred `75×5`；Gold `75×3`。
- **主根因**：G4，constructor 定义错误；Gold 显然要求每年最高分 constructor/关联 constructor，不接受历史 standings 缺失。
- **次根因**：额外输出 driver_points 和 constructor_points。
- **预防规则**：维度结果缺失时不能因“历史上无锦标赛”就留空；应回到题目要求的“scored most points”并从 results 聚合。

### local311 — G1：Top-3 constructor-year 被改成三个 constructor 的完整历史

证据：`.../cases/local311.md`

- **请求/Gold 合同**：combined points 最高的三个 constructor-year；Gold `3×3`。
- **关键轨迹**：按 driver/year 汇总；用 team_driver_rank=1 找每队最佳车手；先累计各 constructor 跨年总和，选 Ferrari/Red Bull/Mercedes。
- **精确分叉点**：模型将“top 3 combined points”解释为生涯累计 Top-3 constructors，然后输出这三队所有年份及最佳车手，共 112 行。
- **最终形状差异**：Pred `112×5`；Gold `3×3`，Gold 是 2023 Red Bull、2022 Red Bull、2019 Mercedes 等单个年度组合。
- **主根因**：G1，未在 constructor-year combined points 上取 Top-3。
- **次根因**：增加 constructor_ref、best_driver、driver points 等列。
- **预防规则**：先明确排名实体是 constructor 还是 `(year, constructor)`；“and in which years”通常表示年度是排名键的一部分。

### local330 — G1：输出每页分布而非最高页面

证据：`.../cases/local330.md`

- **请求/Gold 合同**：Gold 只要最高 landing/exit 会话数对应页面；`1×1`，`/detail`。
- **关键轨迹**：规范化尾斜杠；每 session 用 `ROW_NUMBER()` 找 landing/exit；用 UNION 对同页同 session 去重；得到 `/detail=9` 为最大。
- **精确分叉点**：最终仅 `GROUP BY page ORDER BY page`，没有按 session_count 降序取第一。
- **最终形状差异**：Pred `5×2`；Gold `1×1`。
- **主根因**：G1。
- **次根因**：文字还列出未出现在 CSV 中的零计数页面，说明说明与交付也不一致。
- **预防规则**：若评测合同要求“which page”，完成 per-page 计数后必须再取最大页；分布表只是中间结果。

### local335 — G1：模型知道 Top-5，却导出全部 14 个 constructor

证据：`.../cases/local335.md`

- **请求/Gold 合同**：五个 constructor 名称；Gold `5×1`。
- **关键轨迹**：自 2001 按 constructor/year 汇总正积分；找各年最低；统计各 constructor 成为最低的季数；明确列出前五。
- **精确分叉点**：导出 SQL没有 `LIMIT 5`，还保留 `seasons_count`。
- **最终形状差异**：Pred `14×2`；Gold `5×1`。
- **主根因**：G1。
- **次根因**：Pred 前五包含 Minardi/Arrows/Haas，Gold 样例含 Jordan，说明“drivers scored fewest”可能应先按 driver-season 而非 constructor 年总分。
- **预防规则**：自然语言明确“五个”时，最终 SQL必须有确定性的 Top-5 约束，且只输出题目点名的名称列。

### local354 — G3：输出 driver-season 明细，而 Gold 只要三个 driver_id

证据：`.../cases/local354.md`

- **请求/Gold 合同**：符合条件的 driver_id 集合；Gold `3×1`。
- **关键轨迹**：按 driver/year 统计至少两轮；窗口找该司机该年 first/last round；按 constructor 分组确认首尾 constructor 一致。
- **精确分叉点**：模型把每个满足条件的 driver-season 都视为结果，得到 249 条，并附姓名、constructor、year、round。
- **最终形状差异**：Pred `249×5`；Gold `3×1`。
- **主根因**：G3，目标粒度/资格定义错误。
- **次根因**：轨迹发现高度相关的 `drives` 表却未使用；Gold 三个 ID 暗示题目所指“completed a season/first and final drive”有更严格定义。
- **预防规则**：若 schema 提供与题目术语直接对应的派生表（如 `drives.is_first_drive_of_season`），应优先验证该表，而不是用宽泛 results 重建近似定义。

---

## 四、代表性轨迹证据摘录

以下摘录均来自对应 case 文件中的模型原始 reasoning 或 SQL 决策：

1. **local002**：模型在算出标量后写道：
   > “The final result should contain the four day predictions ... and the sum.”
   随即导出 `SELECT * FROM results UNION ALL SELECT 'TOTAL'...`。
   证据说明模型主动选择了“过程 + 总计”，不是工具限制。

2. **local010**：模型已明确：
   > “The fewest pairs bucket is 5000 with 3 pairs.”
   但下一步决定：
   > “The complete final result ... is the distribution.”
   于是导出七个桶。

3. **local020**：确认 `AC Gilchrist` 后，模型仍说：
   > “I'll export the full results ordered by bowling average.”
   最终 282 行，缺少 `LIMIT 1`。

4. **local025**：轨迹曾得到：
   ```sql
   SELECT ROUND(AVG(total),4) AS avg_max_over_runs
   ```
   返回 `19.4261`；随后却决定：
   > “the most useful ‘complete final result’ is per-match rows.”
   这是典型的最终问句未收敛。

5. **local067**：面对明确的十个 tier，模型自行改写为：
   > “The highest and lowest profits OF THE SEGMENTED customers ... global max and min.”
   最终把 `tier` 完全丢弃。

6. **local194**：模型专门作出输出设计：
   > “one row per actor ... containing the 3 films and the average.”
   这直接产生 `200×9` 宽表，而 Gold 是全局 `3×2` film 粒度。

7. **local202**：模型成功执行标量查询并得到：
   ```text
   matching_states
   5
   ```
   但导出时切回含州、人口、百分比和年龄的 Top-10 明细 SQL。

8. **local272**：模型明确承认捷径：
   > “the answer already exists in the picking_line table”
   > “I believe the correct final output is the picking plan ... already exists”
   因而未执行题目要求的库存排序和累计分配。

9. **local277**：轨迹在 scipy 不可用、回归权重不明后持续消耗回合，最终 SQL退化为：
   ```sql
   SELECT product_id, mth, qty
   FROM monthly_sales
   WHERE product_id IN (4160,7790)
   ```
   即直接导出 72 行输入数据。

10. **local335**：模型在文字中已经列出准确的“top five”，但 `export_query` 使用的 SQL只有：
    ```sql
    ORDER BY seasons_count DESC, c.name;
    ```
    没有 `LIMIT 5`，最终导出 14 行。

---

## 五、跨案例改进规则

1. **先写输出合同再查数据**：明确 `row grain`、预期行数、允许列白名单。
2. **导出查询必须等于最终答案查询**：禁止把已经验证的标量查询替换成更“完整”的明细查询。
3. **选择字段与输出字段分离**：排序、过滤、分母、样本数可以留在 CTE，但不自动进入最终投影。
4. **多阶段问句以最后一句为准**：分桶、排名、逐月统计往往只是中间步骤。
5. **强制最终形状断言**：
   - “which/what is the highest”通常 `1` 行；
   - “top N”必须 `N` 行或有明确并列策略；
   - “for each tier/position”必须保留 tier/position；
   - “provide X, Y”不得附加未经要求字段。
6. **不要用解释性“complete result”覆盖任务合同**：完整性是语义完整，不是输出所有中间数据。
7. **现成结果表仅用于核验**：题目要求计算过程时，不得直接查询结果表。
8. **工具失败时禁止交付输入数据**：无法完成应明确失败，而非用原始数据伪装最终结果。
9. **复杂实体先定义主体集合**：例如 striker、bowler、city、constructor-year；维表 LEFT JOIN 不得扩大事实主体。
10. **每次导出前检查**：`COUNT(*)`、列数、第一/最后样例、是否仍缺 `LIMIT`、最终字段是否与题目逐项对应。

## Review

- **Correct**：所有 45 个 scope case 的 `Output comparison`、最终 SQL 和 reasoning/tool trajectory 均已逐一读取；未修改项目文件。
- **Finding P1**：`.../cases/local002.md` 等 14 例已得到标量或第一名后仍导出明细/全集，说明缺少最终合同收敛门。
- **Finding P1**：`.../cases/local272.md` 直接使用 `picking_line` 结果表替代题目要求的库存分配算法，属于可复用性和语义正确性风险。
- **Finding P1**：`.../cases/local060.md`、`local141.md`、`local220.md`、`local229.md`、`local230.md`、`local258.md`、`local259.md`、`local270.md`、`local275.md`、`local286.md`、`local297.md`、`local309.md` 共 12 例的错误不只是多列，而是主体集合、过滤或业务聚合已经变化。
- **Finding P2**：`.../cases/local003.md` 等 11 例主要结果集合接近，但附加了用于解释或排序的列；增加最终列白名单即可减少此类失败。
- **Residual risk**：本审计只使用预提取轨迹和 Gold 对比，没有重新执行数据库 SQL；对于题面与 Gold 表面存在歧义的 case，只报告已证实的合同矛盾，不推测隐藏评测 SQL。
- **Merge verdict**：OK with notes；这是只读审计产物，无源码变更。

### B. 22 个同形异值案例

# Spider2 Round-3 同形异值失败语义审计

## Review

- **审计范围**：已逐一阅读 22 个证据文件：`local007 local024 local034 local050 local059 local062 local066 local077 local081 local096 local114 local156 local168 local171 local196 local263 local269 local273 local279 local298 local299 local358`。
- **Finding：P1**：21 个案例存在实质性业务语义、聚合粒度、时间窗口、实体集合或单位错误。
- **Finding：P2**：`local156` 的核心计算值基本吻合，主要失败在排序和精度输出契约。
- **Merge verdict：BLOCK**。这些查询虽均返回了正确形状，但不能作为语义正确结果发布。

---

## 一、根因分类

以下按每个案例的**首要根因**互斥计数，总计 22：

| 首要根因 | 数量 | 案例 | 典型证据 |
|---|---:|---|---|
| 聚合粒度、分母或 JOIN 基数错误 | 10 | 024、034、050、059、062、114、196、263、269、273 | `local059` 把 Top-3 产品总销量再次展开到明细后做 `AVG(sold_quantity)`；Gold 则是三个产品总销量的平均值（`.tmp/spider2-failure-audit/cases/local059.md:18-36`） |
| 时间口径、基线、窗口或递归状态错误 | 6 | 007、077、171、279、298、299 | `local077` 在生成 LAG/滚动窗口前过滤掉 2018-07、08，导致 2018-09 无历史基线（`local077.md:18-49`） |
| 实体集合、维表或修饰项语义错误 | 3 | 066、168、358 | `local168` 将“Top 3 技能”硬编码成 `python`,`qlik`，没有真正选 Top 3（`local168.md:18-28`） |
| 明确公式/过滤规则反向 | 1 | 081 | 题目明确“不计折扣”，SQL 却乘 `(1-discount)`（`local081.md:18-37`） |
| 输出排序与精度契约 | 2 | 096、156 | `local096` 将百分比提前舍入到两位；`local156` 以年份/排名排序而 Gold 以地区/年份组织 |
| **合计** | **22** |  |  |

### 横向共性

1. **“结果看起来合理”被误当成语义验证**：多次只检查行数、总数守恒、结果范围或手算自身公式，没有构造能区分竞争口径的对照查询。
2. **先拍板再验证**：大量推理出现“这是最自然/最合理解释”，但没有回到题目中的业务名词检查分母、实体粒度、时间基线。
3. **过早降维**：把库存位置、支付事件、模型步骤、客户日历等细粒度对象先汇总成一个总量，随后无法恢复 FIFO、分支组合或状态传播语义。
4. **输出契约被忽视**：排序、百分比单位、日期粒度、最终精度同样会导致同形失败。

---

## 二、逐案例审计

### local007 — 棒球生涯跨度

- **请求语义**：逐球员取 debut/final 的年、月、日差，各部分取绝对值并按题定公式换算，再平均；题目特别指定各部分的舍入顺序（`local007.md:8-10`）。
- **推理路径**：模型把问题改写成“标准日历差”，为负日数借月、负月份借年，再计算跨度。
- **P1 偏差**：SQL 实现了借位规范化，而 Gold 对应的不是该规范化口径；同时最终 `ROUND(AVG(span),2)` 把 Gold 的高精度结果截成两位。预测 4.82，Gold 4.923752748（`local007.md:12-16,18-63`）。
- **误导性 sanity check**：抽查的 11年4月17日等结果只能证明借位算法自洽，不能证明题目要求借位；最终只验证了 SQL 返回 4.82。
- **预防规则**：日期题先明确“分量直接相减”还是“标准日历借位差”；把舍入步骤写成可审查公式，并同时输出未舍入均值核对。
- **置信度**：中。

### local024 — 国家级球员场均得分均值

- **请求语义**：先对每位球员计算其参加比赛中的场均得分，再按国家平均这些球员均值，取前五（`local024.md:8-10`）。
- **推理路径**：总跑分来自击球明细，但分母取 `player_match` 中所有出场比赛数。
- **P1 偏差**：分子是“作为 striker 得分”，分母却是“名单中出场”，包含未击球比赛；这系统性压低球员均值，并使 Netherlands 掉出前五。证据为 `COUNT(DISTINCT match_id)` 来自 `player_match`（`local024.md:18-43`）。
- **误导性 sanity check**：只检查比赛数和结果排名“看起来合理”，没有比较 `matches_batted` 与 `matches_played`。
- **预防规则**：比率的分子、分母必须来自同一业务事件集合；场均击球得分应先按 `striker, match_id` 聚合，再以实际有击球记录的比赛为分母，除非题目明确要求所有出场。
- **置信度**：高。

### local034 — 品类最常用支付方式的平均支付数

- **请求语义**：每品类统计各支付方式的支付事件数，选最高者，再平均各品类最高计数（`local034.md:8-10`）。
- **推理路径**：支付表直接连接订单商品明细和产品，再 `COUNT(*)`。
- **P1 偏差**：一个订单有多个商品行时，同一支付记录被每个商品行复制；`COUNT(*)` 统计的是“支付×商品行”，不是支付事件。预测 1171.73，Gold 1035.43（`local034.md:18-42`）。
- **误导性 sanity check**：看到几乎所有品类信用卡第一便认为正确，但没有检查 `order_id/payment_sequential` 在 JOIN 后的倍增。
- **预防规则**：先定义支付事件键（如 `order_id,payment_sequential`），按订单—品类去重后再计数；所有多表计数先做 JOIN 基数审计。
- **置信度**：高。

### local050 — 法国 2021 月度预测销售中位数

- **请求语义**：使用 2019/2020 月度数据、指定促销和渠道口径，应用增长率预测 2021，按货币表转 USD，计算月均后求中位数（`local050.md:8-10`）。
- **推理路径**：按产品/月/年求销售总额，内连接同产品同月份的两年记录，套增长公式，再对产品求月均和中位数。
- **P1 偏差**：
  1. `proj_usd` 实际没有 JOIN `currency`，只是因为模型观察到法国样本汇率为 1 才省略合同步骤。
  2. 推理读到了“先计算每产品/月的平均销售基线”，最终 SQL 却直接使用年度总额，并只保留两年都存在的产品月份。
  3. 因此月均的实体集合和基线聚合与 Gold 不同；2552.695 对 Gold 2604.236291（`local050.md:18-51`）。
- **误导性 sanity check**：手工排序 12 个由错误口径生成的月均，只验证了中位数算法。
- **预防规则**：预测题应把历史基线、增长、汇率、月级聚合分别落成 CTE，并对每步行数与缺失匹配做审计；不能因当前汇率恰为 1 删除语义步骤。
- **置信度**：中。

### local059 — 各事业部 Top-3 产品平均销量

- **请求语义**：2021 日历年内，先按产品汇总销量，取每事业部销量前三，再求这三个产品总销量的平均值（`local059.md:8-10`）。
- **推理路径**：正确找出 Top-3 后，又 JOIN 回销售明细，对明细 `sold_quantity` 求平均。
- **P1 偏差**：平均对象从“3 个产品总量”变成“这些产品的销售明细行”。例如 N&S Gold 正是 `(400257+396461+396380)/3=397699.33`，而 SQL 输出每条记录平均 317.14（`local059.md:18-36`）。
- **误导性 sanity check**：Top-3 产品列表验证正确，使模型忽视最后一层聚合换粒度。
- **预防规则**：Top-N 后的统计必须直接使用排名 CTE 的聚合指标；禁止无必要 JOIN 回事实明细。
- **置信度**：高。

### local062 — 意大利客户利润等宽桶

- **请求语义**：按客户汇总 2021-12 总利润，用总体利润范围划十个等宽区间，再报告桶内客户数和利润极值（`local062.md:8-10`）。
- **推理路径**：正确计算客户总利润、全局范围、桶宽与客户桶号，最后对 `total_profit` 求极值。
- **P1 偏差**：客户数与 Gold 完全一致，但 Gold 的桶内 min/max 明显取自不同的、更细利润粒度；例如桶1模型为 -23.56～54.50，Gold 为 -98.44～91.64（`local062.md:12-16,18-51`）。这说明模型把“用于分桶的客户月总利润”和“桶内要报告的利润值”视作同一列，而参考口径要求回到桶内客户的产品/销售利润记录再取极值。
- **误导性 sanity check**：检查桶边界和 68 名客户计数守恒，只能验证桶分配，不能验证输出极值的业务层级。
- **预防规则**：分桶键与展示指标必须分别定义；分桶后如需报告底层记录极值，应保留客户键并回连预聚合事实。
- **置信度**：中；题面“total profits”与 Gold 存在一定口径张力。

### local066 — 已送达披萨配料总量

- **请求语义**：仅已送达披萨，按配方基础配料减 exclusions、加 extras，统计真实配料用量（`local066.md:8-10`）。
- **推理路径**：模型发现辅助表的 `extras_count/total_exclusions` 与自己对订单行的理解不一致，遂自行判定辅助表“不可靠”，直接拆分字符串，每个 token 计一次。
- **P1 偏差**：最终 SQL 丢弃辅助表中修饰项的业务倍数，只按订单行 token 数计量，导致 Bacon 12 对 Gold 14，Chicken 9 对 Gold 11 等（`local066.md:12-16,18-55`）。
- **误导性 sanity check**：详细手算只是重复了“每 token 一单位”的自选假设；没有用 Gold 所反映的修饰项计数规则做对照。
- **预防规则**：当数据库已经提供标准化 exclusions/extras 计数表时，不应因局部直觉冲突而弃用；必须先查清 count 字段定义，并按订单行唯一键验证 multiplicity。
- **置信度**：中偏低；辅助表具体倍数语义需参考原 benchmark SQL 最终确认。

### local077 — 月度最大 index composition 与三月滚动值

- **请求语义**：报告 2018-09 至 2019-08，但三月滚动值和一、二月前值需要使用报告期前历史作为基线（`local077.md:8-10`）。
- **推理路径**：先在 `interest_metrics` 中过滤到 201809–201908，再对月最大值做 `LAG`。
- **P1 偏差**：2018-07、08 在窗口计算前被删除，因此 2018-09 的 rolling 被错误算成自身 8.263636，前两月为空；Gold 使用 7月7.36、8月7.21，得到 7.61（`local077.md:12-16,18-50`）。
- **误导性 sanity check**：模型把“不足三个月时按现有行平均”当成合理规则，却未注意数据库实际已有报告期前两个月。
- **预防规则**：窗口查询应“先扩展历史窗口计算，再裁剪最终展示期”；三月窗口需至少多取两个前置月份。
- **置信度**：高。

### local081 — 1998 客户消费分组

- **请求语义**：消费额为 `unitprice × quantity`，明确排除折扣影响，再映射阈值并计算人数及比例（`local081.md:8-10`）。
- **推理路径**：查询套用了 Northwind 常见净销售公式。
- **P1 偏差**：SQL 使用 `unitprice * quantity * (1-discount)`，与“excluding any discounts”直接矛盾，导致 Medium 37 对 Gold 36，High/Very High 也错位（`local081.md:18-37`）。
- **误导性 sanity check**：四组人数合计 81 只证明无客户丢失，不能证明分组值正确；最终说明甚至错误宣称该乘法是在“排除折扣”。
- **预防规则**：遇到“excluding discounts”必须明确是“不应用折扣”而非“扣除折扣”；把公式先翻译成自然语言再编码。
- **置信度**：高。

### local096 — 全女性演员电影百分比

- **请求语义**：按年份统计所有电影数及仅有女性演员电影比例，未知性别视作非女性；年份取字符串末四位（`local096.md:8-10`）。
- **推理路径**：模型正确发现 `M_Cast.PID` 有前导空格并使用 `TRIM`，也正确将 NULL 视作非女性。
- **P2 偏差**：最终百分比被 `ROUND(...,2)`，Gold 保留完整精度，如 2018 年应为 1.923076923…；同时 SQL 按年份升序，而 Gold 以比例高低呈现（`local096.md:12-16,18-47`）。
- **误导性 sanity check**：只验证了共有四部全女性电影和 1939 年 50%，没有核对非整数比例的精度和排序。
- **预防规则**：题目未要求舍入时保留原始浮点精度；导出前比较完整行顺序而非只查命中电影。
- **置信度**：高。

### local114 — 区域 Web 销售报告

- **请求语义**：按区域输出计数、总销售额及并列最高销售代表（`local114.md:8-10`）。
- **推理路径**：分别按代表和区域汇总销售，再以最大代表销售额匹配并列。
- **P1 偏差**：销售额和最高代表正确，但 `COUNT(o.id)` 统计原始订单事实行，Gold 的 `total_orders` 为 9、21、10…，体现的是区域代表/汇总实体层级而非 897、2357、2024 条订单行（`local114.md:12-16,18-48`）。
- **误导性 sanity check**：只验证四区域各有唯一最高代表；没有对 Gold 所需计数实体做独立基数检查。
- **预防规则**：名为 orders 的指标仍需确认参考实体键；同时输出 `COUNT(*)`、`COUNT(DISTINCT order_id)`、代表数和账户数以锁定口径。
- **置信度**：中；题面“number of orders”与 Gold 数值存在明显命名张力。

### local156 — 区域年度 BTC DCA

- **请求语义**：区域年度加权平均购入价、按年排名、相对上一年变化，首年不展示但可作为同比基线（`local156.md:8-10`）。
- **推理路径**：按 BUY BTC 的 `quantity×price / quantity` 计算，先在全年度数据上 LAG，再过滤首年。
- **正确点**：2018 同比 2017 的处理、排名方向和主要数值与 Gold 一致。
- **P2 偏差**：输出将价格保留四位而 Gold 为两位，且 `ORDER BY txn_year, price_rank` 与 Gold 的地区—年份组织不同；因此样本首行不同（`local156.md:12-16,18-60`）。
- **误导性 sanity check**：只核对“各年第一名”，未核对完整排序和字段精度。
- **预防规则**：将数值语义验证与导出契约验证分开；导出前比较字段顺序、精度及完整排序键。
- **置信度**：高。

### local168 — Remote Data Analyst Top-3 技能平均薪资

- **请求语义**：从符合职位条件的所有技能需求中动态选频次 Top 3，再限定这些技能相关岗位计算平均薪资（`local168.md:8-10`）。
- **推理路径**：发现大量 `skills_job_dim.skill_id` 在 `skills_dim` 中无匹配名称后，只保留可命名的 python、qlik，并手工硬编码。
- **P1 偏差**：SQL 根本没有 `ORDER BY COUNT(*) DESC LIMIT 3` 的 Top-3 子查询；维表缺失值被静默排除，最终只是 python/qlik 岗位均值 106900，Gold 101300（`local168.md:18-29`）。
- **误导性 sanity check**：验证三个去重岗位和手算均值，只验证了硬编码集合，不验证该集合确为 Top 3。
- **预防规则**：Top-N 必须由数据动态产生；维表匹配不全时先按事实表 skill_id 排名，再 LEFT JOIN 名称，不得将“可命名”当作“全部技能”。
- **置信度**：高。

### local171 — 路易斯安那男性议员长期留任

- **请求语义**：Louisiana 男性议员，以其 Louisiana 首任为 cohort 起点，检查对应年末是否仍在 Louisiana 任职，再按年数计数（`local171.md:8-10`）。
- **推理路径**：先取每位议员全部州任期中的最早 `term_start`；只要求其历史上曾出现 LA，活跃性 EXISTS 也不限制州。
- **P1 偏差**：早年在其他州任职者被提前计算 tenure；候选年末即使是在其他州任职也会被计入。31 年预测6而 Gold4（`local171.md:12-16,18-55`）。
- **误导性 sanity check**：明细抽样仅确认某个任期覆盖 12月31日，没有验证该首任和活跃任期均属于 LA。
- **预防规则**：cohort 过滤应在 `MIN(term_start)` 之前完成；活跃 EXISTS 必须重复相同州/业务域条件。
- **置信度**：高。

### local196 — 首次租片评级与客户消费

- **请求语义**：每客户只确定一次首笔支付对应电影评级；另分别汇总客户总支付和租赁数，再按首片评级平均（`local196.md:8-10`）。
- **推理路径**：首片识别正确；客户汇总却同时 LEFT JOIN `payment` 和 `rental`。
- **P1 偏差**：两个一对多表仅通过 customer 相互连接，形成支付×租赁笛卡尔放大。`SUM(p.amount)` 被每条租赁重复，故平均消费约 3000，而 Gold 约 112（`local196.md:18-46`）。
- **误导性 sanity check**：`COUNT(DISTINCT rental_id)` 掩盖了租赁计数膨胀，但 SUM 没有去重；结果有五个评级并不代表金额正确。
- **预防规则**：多个一对多指标必须各自按客户预聚合后再 JOIN；不能依靠某一个 `COUNT(DISTINCT)` 修复同层其他聚合。
- **置信度**：高。

### local263 — strong/soft 状态下最常见 L1_model

- **请求语义**：状态在 name+version 模型层由“任一步”决定；随后将该状态传播到模型关联的各步骤/L1_model，并统计发生次数（`local263.md:8-10`）。
- **推理路径**：直接把 `stack_ok` 中每个满足比较条件的步骤行当成一次状态发生。
- **P1 偏差**：没有先聚合到模型层实现“for any of its steps”，也没有把模型状态传播回全部三个步骤。Gold 恰为预测的三倍：soft 108 vs36、strong 234 vs78（`local263.md:12-16,18-29`）。
- **误导性 sanity check**：抽查某一步 Stack 大于非 Stack 只验证了步骤状态，不验证模型级 ANY 及后续计数粒度。
- **预防规则**：含 “any step” 的状态先按实体 `name,version` 用 `MAX(condition)` 计算，再 JOIN 回该实体全部关联行计数。
- **置信度**：高。

### local269 — 嵌套包装叶节点平均数量

- **请求语义**：完整展开嵌套包装，但平均对象是最终包装组合分支，而不是先把每个顶层包装的所有分支合并成一个总量（`local269.md:8-10`）。
- **推理路径**：识别四个不被其他包装包含的顶层 pallet，将所有叶路径按 `packaging_id` 合并，得到四个总量后平均。
- **P1 偏差**：`leaf_totals GROUP BY packaging_id` 将同一顶层包装的多个最终组合分支提前合并，分母变成四个顶层包装，得到946；Gold 530.67 对应更细的最终组合粒度（`local269.md:12-16,18-38`）。
- **误导性 sanity check**：手算 864、720、960、1240 与 SQL 完全一致，但这只证明“顶层包装总量平均”自洽，未证明它是题目中的“all final packaging combinations”。
- **预防规则**：递归展开时保留 root relation/path 标识；先明确平均分母是顶层包装、顶层分支还是叶路径，不能只保留 root id。
- **置信度**：中偏低；Gold 的具体嵌套倍数约定仍需参考标准 SQL。

### local273 — FIFO 平均拣货百分比

- **请求语义**：订单需求与按购买日期、库存量排序的库存位置区间逐段匹配，按重叠量计算拣货百分比，结果单位为百分数（`local273.md:8-10`）。
- **推理路径**：先把所有库存位置压成产品总库存，再按订单累计需求与这个总量做截断。
- **P1 偏差**：
  1. 丢失 `purchase_id/location_id`，实际上未实现题目要求的 FIFO 位置选择和“小库存优先”。
  2. 把百分比输出为 0–1 比率，未乘100。
  3. Gold 中本应为约75%–76.92%的产品被模型判为1，说明“产品总库存足够”不能代表各位置重叠拣货率为100%（`local273.md:12-16,18-47`）。
- **误导性 sanity check**：只核对总库存和订单累计量；这正是被错误降维后的公式，无法验证位置级 FIFO。
- **预防规则**：FIFO 必须保留库存批次/位置累计区间和订单累计区间，按区间交集求 picked qty；最终明确 `100.0*picked/required`。
- **置信度**：高。

### local279 — 2019 递归库存最接近最低量月份

- **请求语义**：以 2018-12 的模型状态作为递归种子，按 2019 月预算扣减和补货，选择与最低库存差最小的月份（`local279.md:8-10`）。
- **推理路径**：经过较长探索后，将初始库存直接硬编码为 6520=400、6600=100，并在差值并列时选最早月份。
- **P1 偏差**：硬编码的是 `inventory` 当前总量/采购批量，而非从 2018-12 状态链推导出的期末库存；递归轨迹因此整体错位。预测 6520六月、6600三月，Gold 为十二月、六月（`local279.md:12-16,18-65`）。
- **误导性 sanity check**：手工逐月计算与硬编码种子完全一致，只证明递推运算无误；没有验证 seed 的业务来源。
- **预防规则**：递归模型的 seed 必须由上一期数据查询产生，禁止把观察到的总库存写成常量；并列选择规则也必须显式与参考口径一致。
- **置信度**：中。

### local298 — 上月总余额分配

- **请求语义**：每个输出月份使用前一个自然月的客户余额/存储分配，首月只作基线；负值归零（`local298.md:8-10`）。
- **推理路径**：对每个 measurement month 汇总 `txn_date < month_start` 的全部历史净交易，形成累计余额。
- **P1 偏差**：Gold 对应前一个月的月度余额分配，而 SQL 将从历史起点到月初的所有月份累积在一起；因此后续月份持续维持约26万，而 Gold 四月降至153147（`local298.md:12-16,18-39`）。
- **误导性 sanity check**：再次用同一 `< month_start` 公式重算 235595，仅是循环验证；没有与“只取前一个自然月”查询对照。
- **预防规则**：明确“previous month”是上月净变动还是截至上月末累计余额；若是前月值，应先按客户/月聚合，再用 `LAG`，而非用开放式历史区间。
- **置信度**：中。

### local299 — 30日滚动平均余额分配

- **请求语义**：客户每日余额、完整30日窗口、月内最大值；客户第一月仅作基线，且客户日历不应延伸到其可观察历史之外（`local299.md:8-10`）。
- **推理路径**：为每位客户从首次交易日起 CROSS JOIN 到全局最后日期 2020-04-28，无交易日继续携带余额。
- **P1 偏差**：`WHERE d.date >= first_date` 没有 `<= last_date`，已停止交易的客户仍被补齐至全局末日，其陈旧余额继续形成30日均值并参与后续月份最大值，尤其把四月从 Gold 170334 放大到316177.57（`local299.md:12-16,18-72`）。
- **误导性 sanity check**：只抽查仍有后续数据的单一客户429及窗口行数，没有检查客户结束日期后的伪造日历行。
- **预防规则**：生成实体日历时必须同时绑定 `first_date` 和 `last_date`；滚动窗口还应验证实际覆盖30个自然日，而不只是30行。
- **置信度**：高。

### local358 — 年龄段用户数

- **请求语义**：按统一参考日期计算年龄并统计20/30/40/50岁段及其他（`local358.md:8-10`）。
- **推理路径**：模型自行猜测参考日为 `2017-01-01`；发现 320 行只有30个不同 user_id 后，又自行决定按 distinct user_id 去重。
- **P1 偏差**：
  1. 题目没有给 2017 参考日，SQL 使用年差且忽略生日是否已过。
  2. benchmark 将 `mst_users` 行作为用户记录统计，而模型应用未经要求的 `COUNT(DISTINCT user_id)`，将规模从数百压到30。
  3. 因而预测 20s=7、30s=3，而 Gold 为16、88（`local358.md:12-16,18-34`）。
- **误导性 sanity check**：30人合计守恒只验证了自行选择的去重口径；模型甚至在结尾承认参考日是猜测值。
- **预防规则**：年龄必须使用题库指定的 as-of date 或数据集基准日，并按完整生日计算；除非实体键唯一性得到确认，不可因重复外观擅自 DISTINCT。
- **置信度**：中。

---

## 三、通用防错清单

1. **先写业务粒度表**：每个 CTE 标明“一行代表什么”，尤其是支付事件、产品总量、客户月、模型版本、库存位置。
2. **比率三联检查**：分子事件集、分母事件集、最终平均分母必须逐一列出。
3. **窗口先扩后裁**：报告期前的 LAG/rolling 基线必须保留，算完窗口后再过滤展示期。
4. **多事实表先聚合**：payment、rental 等两个一对多表不可在客户层直接同时 JOIN。
5. **递归 seed 可追溯**：种子必须来自查询结果，不得硬编码“看起来等于库存”的常量。
6. **Top-N 禁止硬编码**：必须动态排名，并明确 ties。
7. **FIFO 禁止总量降维**：保留批次、位置和累计区间，使用区间交集。
8. **输出层单独验收**：检查百分数/比率单位、日期格式、精度、列顺序和稳定排序。
9. **sanity check 必须有竞争口径**：至少同时运行一个可能的替代公式，而不是只手算最终 SQL 自身。

---

## Residual risks

- 本审计只能依据案例文件中的题面、最终 SQL、推理轨迹及 Pred/Gold 对比，无法执行评测数据库或查看隐藏 Gold SQL。
- `local062`、`local066`、`local114` 的题面自然语言与 Gold 暗示的实体粒度存在张力。
- `local269` 的“final packaging combinations”具体分母及嵌套倍数约定需用标准 SQL 最终确认。
- `local279` 的正确 2018-12 seed 推导链、`local298` 的“previous balance”精确定义、`local358` 的基准日期需参考 benchmark 定义确认。
- 未修改任何项目或源文件，未运行测试或 Git 命令。

### C. 19 个无 CSV 案例

# Spider2 round 3 无 CSV 案例失败审计

## 1. 审计范围与证据边界

本次仅审阅用户指定的 19 个预提取案例文件及 `summary.json`：

- 案例：`local015`、`local073`、`local098`、`local099`、`local100`、`local157`、`local169`、`local170`、`local253`、`local285`、`local301`、`local302`、`local329`、`local331`、`local336`、`local344`、`local355`、`local356`、`local360`
- 汇总：`D:/data_agent/.tmp/spider2-failure-audit/summary.json`

没有读取其他仓库文件，没有执行 SQL、测试或 Git 命令，也没有修改文件。

需要特别说明：部分案例文件只保留了元数据和最后 SQL，没有完整工具轨迹。因此对于这些案例，只报告文件中能够直接证明的内容；不会臆测未记录的中间调用。

---

## 2. 总体结论

### 2.1 数量统计

| 指标 | 数量 | 说明 |
|---|---:|---|
| 审计案例 | 19 | 用户指定的全部 no-CSV 案例 |
| `csvGenerated=false` | 19 | `summary.json` 与各案例文件一致 |
| 当前状态为 `max_turns` | 12 | 运行达到最大轮数 |
| 当前状态为 `timeout` | 6 | 运行超时 |
| 当前状态为 `completed` 但仍无 CSV | 1 | `local073`，属于提前结束而非运行时硬终止 |
| 实际没有交付 CSV | 19 | 全部案例均未完成文件交付 |
| 明确存在成功任务 SQL、但未导出 | 2 | `local099`、`local253` |
| 明确存在错误工具或错误路径调用 | 2 | `local302`、`local329` |
| 明确 SQL/语义反复改写 | 至少 4 | `local015`、`local099`、`local100`、`local301` |
| 明确无关或中间 SQL 作为最终 SQL | 至少 14 | 见逐案审计 |
| 发现数据覆盖/题目映射风险 | 1 | `local336` |

“分类”允许重叠。例如一个案例既可能是硬超时，又同时存在 SQL churn 或 needless exploration。统计采用以下口径：

- **硬超时/预算耗尽**：实际状态为 `timeout` 或 `max_turns`，共 18 个。
- **提前完成但未导出**：状态为 `completed`、无 CSV，共 1 个。
- **Needless exploration**：有直接轨迹证据表明已经获得关键事实，却继续反复探索或争论，至少 13 个。
- **SQL churn**：有直接证据表明 SQL 语法、CTE、关联方式或查询目标反复改写，至少 4 个。
- **Stale-tool/path call**：使用不存在工具或访问错误路径，2 个。
- **Failure to export after success**：已经得到任务所需结果或等价结果，却没有调用导出工具，明确 2 个。
- **Genuinely complex**：任务本身确实需要窗口函数、多阶段聚合、序列重建、F1 位置交换或复杂清洗；这不是失败免责，而是用于区分“问题复杂度”和“执行失控”。

### 2.2 最严重的系统性问题

1. **缺少交付闭环**
   多数轨迹停在 `query_database` 预览或中间 SQL，完全没有 `export_query`。`local253` 已经得到与 gold 一致的 20 行结果，仍然没有导出，是最直接的运行时/提示词流程缺陷。

2. **没有“最终 SQL”闸门**
   最终 SQL 经常仍是：
   - 表结构探查；
   - 日期样本查询；
   - `COUNT(*)` 中间统计；
   - 无关表的 `SELECT DISTINCT`；
   - 只针对一个实体的调试查询。
   例如 `local285` 最终只统计 `COUNT(DISTINCT item_code)`，而题目要求 24 行、12 列的年度分类财务分析。

3. **达到关键事实后仍继续探索**
   `local099` 已经查询得到正确数量 `107`，`local253` 已经得到正确 20×4 结果，`local329` 已经直接识别唯一正确会话，`local336` 已经确认 race 336 没有可用逐圈数据，但模型仍继续反复推理，消耗预算。

4. **工具/路径合同没有被严格执行**
   `local302` 两次调用不存在的 `read_knowledge_file`；`local329` 访问不存在的 `db_schema.md` 路径。工具调用前没有做工具注册和路径预检。

5. **复杂题目没有先固定粒度与输出形状**
   多个案例先大量探索，然后才尝试猜测语义，导致：
   - scalar 题输出多列；
   - top-N 题输出全量明细；
   - 结果题输出中间验证；
   - 时间窗口题使用不完整或错误范围。

---

# 3. 逐案审计

## local015 — 摩托车碰撞安全帽致死率

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local015.md`
**严重性：** P1（未交付）+ P2（探索失控/连接键疑问）

### 工具序列重建

1. 两次 `search_knowledge` 查询摩托车致死率和安全帽字段。
2. 读取 `collisions`、`parties`、`victims` 的 schema。
3. 多次查询 `party_safety_equipment_1/2` 的安全帽编码。
4. 查询 `party_type`、`statewide_vehicle_type`、`chp_vehicle_type_towing`。
5. 尝试使用 `FILTER` 统计摩托车方及安全帽状态。
6. 之后改写为 `CASE` 计数。
7. 查询 `motorcycle_collision` 分布，得到：
   - 2,796 个 `motorcycle_collision=1` 碰撞；
   - 90 个 `motorcyclist_killed_count`。
8. 尝试将 parties 与 collisions 按 `case_id` 关联。
9. 发现只有 28 个摩托车方 case 能关联到 collision row，且 case ID 示例存在明显范围差异。
10. 错误调用 `SELECT TOP 5 ...`，收到 SQLite 语法错误，随后改用 `LIMIT 10`。
11. 最后继续查询小 case ID 是否存在于 `collisions`，没有完成最终分组计算。

### SQL 尝试与错误

代表性 SQL：

```sql
SELECT ... COUNT(*) FILTER (WHERE ...)
```

随后改成 `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`。

明确错误：

```text
MCP_TOOL_ERROR: near "5": syntax error
```

原因是 SQLite 不支持 `TOP 5`。

### 重复策略

模型反复在以下定义之间来回切换：

- 以 `collisions.motorcycle_collision=1` 定义摩托车碰撞；
- 以 `parties.statewide_vehicle_type='motorcycle or scooter'` 定义摩托车方；
- 以安全帽字段识别摩托车方；
- 直接将 parties 与 collisions 按 `case_id` 关联；
- 怀疑两个表的 case ID 使用了不同编码。

这些疑问中有一部分是合理的数据验证，但在发现关键关联异常后，模型没有及时形成“连接键/数据覆盖问题”结论，也没有产出可验证的最小查询。

### 最后成功 SQL

案例头部的最终 SQL 为：

```sql
SELECT COUNT(*) AS cnt
FROM collisions
WHERE motorcycle_collision=1
```

这只是中间统计，不能回答两个安全帽分组的百分比，也不是 gold 所需的：

```text
percent_killed_helmet_used = 16.67
percent_killed_helmet_not_used = 0.0
```

### 终止条件

- `Status: max_turns`
- `calls=29`
- `errors=1`
- `csv=False`
- 没有 `export_query`

### 分类

- **硬超时/预算耗尽：是**
- **Needless exploration：是**
- **SQL churn：部分是**，至少存在 `FILTER`/`CASE` 改写和 `TOP`/`LIMIT` 修正
- **Genuinely complex：是**，需要确认安全帽字段、碰撞粒度、跨表键和致死率分母
- **Failure to export after success：否**，没有得到任务级成功 SQL

### 修复建议

**运行时可强制：**

- 检测到同一问题连续多次改变连接策略时，要求先输出连接键验证结果：
  - overlap count；
  - unmatched count；
  - sample IDs；
  - 是否允许使用 `collisions.motorcycle_collision` 作为主事实。
- 禁止 SQLite 会话调用 `TOP`，在 SQL 预检阶段自动提示使用 `LIMIT`。
- 当查询已经发现关联覆盖异常时，自动标记“数据覆盖风险”，阻止模型无限扩展探索。

**提示词修复：**

- 先固定粒度：每个 collision 一行，安全帽组由 parties 预聚合。
- 先固定分母：组内碰撞数；分子为组内 `SUM(motorcyclist_killed_count)`。
- 只允许一次连接键验证；验证后必须选择方案或明确报告数据缺口。

---

## local073 — Pizza Runner 最终配料字符串

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local073.md`
**严重性：** P1（未交付）+ P2（复杂任务未收敛）

### 工具序列重建

1. 查询 SQLite 表列表。
2. 读取 `pizza_names`、`pizza_toppings`、`pizza_recipes`、`pizza_clean_customer_orders`。
3. 读取 extras/exclusions 辅助表及原始订单表。
4. 读取 schema、learning、query patterns。
5. 查询清洗订单的 `rowid`，确认共有 14 条订单行。
6. 长时间争论 `row_id` 是：
   - SQLite 全局 `rowid`；
   - 每个订单内的序号；
   - extras/exclusions 辅助表中的列表索引。
7. 设计递归 CTE 拆分 recipe、extras、exclusions。
8. 设计重复配料计数、排序和递归字符串拼接。
9. 文件在真正完成最终执行/导出前结束。

### SQL 尝试

实际成功的主要 SQL 是：

```sql
SELECT rowid, order_id, customer_id, pizza_id,
       exclusions, extras, order_time
FROM pizza_clean_customer_orders
```

该查询只获取清洗订单明细，不生成最终 toppings 字符串。

模型随后多次草拟如下复杂 CTE：

- 递归拆分 comma-separated extras；
- 递归拆分 exclusions；
- 递归拆分 recipe；
- 合并标准和额外配料；
- 计算 `2x`；
- 递归 `group_concat` 或字符串拼接。

但案例记录没有显示这些最终 CTE 被成功执行。

### 重复策略

核心重复点是 `row_id` 语义。模型在：

- 全局 `rowid`；
- 每订单行号；
- 辅助表中的 list index；

之间多次来回切换，且没有先用一个小查询明确各个字段的映射关系。

### 最后成功 SQL

案例头部最终 SQL：

```sql
SELECT rowid, order_id, customer_id, pizza_id,
       exclusions, extras, order_time
FROM pizza_clean_customer_orders
```

### 终止条件

- `Status: completed`
- `calls=13`
- `errors=0`
- `csv=False`
- 没有 `export_query`

这是唯一一个当前状态为 `completed` 但没有 CSV 的案例，说明“completed”并不等价于“完成交付”。

### 分类

- **硬超时：否**，当前状态是 `completed`
- **提前结束但未交付：是**
- **Needless exploration：是**
- **SQL churn：设计层面是**，大量草拟但没有最终执行闭环
- **Genuinely complex：是**
- **Failure to export after success：严格口径否**，成功的是中间订单查询，不是任务级最终结果

### 修复建议

**运行时可强制：**

- `completed` 状态必须满足：
  1. 最终 SQL 已成功执行；
  2. 输出列数与任务目标一致；
  3. 已调用 `export_query`；
  4. 导出文件存在。
- 对递归 CTE 任务提供 SQL 模板或允许使用数据库已有拆分辅助表，避免从零设计字符串递归。

**提示词修复：**

- 先确认订单粒度，再处理配料；
- 明确输出列应为 gold 的 6 列，而不是只输出原订单列；
- 一旦 helper table 与主表语义冲突，优先以题目所需的主订单行粒度为准，停止反复解释辅助表。

---

## local098 — 演员职业年份是否存在四年空档

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local098.md`
**严重性：** P1（超时且最终 SQL 语义/形状错误）

### 工具序列证据边界

案例文件只记录元数据、问题、gold 和最终 SQL，没有完整中间工具轨迹。因此不能重建具体搜索或 SQL 重试序列。

已知：

- `Status: timeout`
- `calls=13`
- `errors=1`
- `csv=False`

### 最终 SQL

```sql
WITH actor_years AS (
    SELECT DISTINCT c.PID, m.year
    FROM M_Cast c JOIN Movie m ON c.MID = m.MID
    WHERE m.year IS NOT NULL
),
ordered AS (
    SELECT PID, year,
           LAG(year) OVER (PARTITION BY PID ORDER BY year) AS prev_year
    FROM actor_years
),
bad AS (
    SELECT DISTINCT PID
    FROM ordered
    WHERE prev_year IS NOT NULL AND year - prev_year > 4
)
SELECT
    (SELECT COUNT(DISTINCT PID) FROM actor_years) AS total_actors,
    (SELECT COUNT(*) FROM bad) AS actors_with_long_gap,
    (SELECT COUNT(DISTINCT PID) FROM actor_years) - (SELECT COUNT(*) FROM bad) AS actors_no_long_gap
```

### 语义问题

题目要求返回一个 scalar，gold 是：

```text
32585
```

最终 SQL 返回三个列：

- `total_actors`
- `actors_with_long_gap`
- `actors_no_long_gap`

此外，题目要求“never had a gap longer than three consecutive years”，即四年跨度没有电影时应判为 bad。若年份差为 4，说明中间存在四年窗口没有新电影；但 SQL 使用：

```sql
year - prev_year > 4
```

会漏掉恰好等于 4 的情况。至少应重新核对是否需要 `>= 4`，并确认数据库年份字段是否应转为整数。

### 分类

- **硬超时：是**
- **Needless exploration：轨迹缺失，不能确认**
- **SQL churn：轨迹缺失，不能确认**
- **Genuinely complex：中等**，需要按演员排序年份并判断 gap
- **Failure to export：是，最终无导出**
- **最终 SQL 形状错误：是**

### 修复建议

**运行时可强制：**

- 从问题中检测“how many / count”标量意图；最终 SQL 若返回多列，应阻止结束。
- 在执行前针对 gap 条件做边界测试：`gap=3`、`gap=4`、`gap=5`。
- 对最终结果进行 scalar shape validation。

**提示词修复：**

- 先定义四年窗口的数学边界；
- 最终只投影一个 `output` 列；
- 不要将调试统计列保留在最终查询中。

---

## local099 — 与 Yash Chopra 合作最多的演员数

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local099.md`
**严重性：** P1（已经得到 107，却未交付）

### 工具序列重建

1. 查询表列表和 IMDB schema。
2. 查询 Person，识别 Yash Chopra 为 `nm0007181`。
3. 查询其导演电影数。
4. 构造 `yash`、`other`、`other_max` CTE。
5. 成功得到符合条件的演员列表。
6. 发现结果数量为 107。
7. 继续调查 Person 表重复行、名字前导空格、`LEFT JOIN` 行为。
8. 尝试加入 actor name，反复修改 CTE。
9. 多次出现查询结果为空或名称为 NULL 的调试分支。
10. 未回到已经得到正确数量的 scalar 查询，也未导出。

### SQL 尝试与结果

早期成功的核心查询：

```sql
WITH yash AS (...),
other AS (...),
other_max AS (...)
SELECT COUNT(*) AS total_actors
FROM yash y
LEFT JOIN other_max o ON y.PID = o.PID
WHERE y.cnt > COALESCE(o.max_cnt, -1)
```

轨迹明确记录：

```text
The total count is 107.
```

这已经与 gold 一致。

随后最终 SQL 变成按演员分组的查询，例如：

```sql
SELECT COUNT(*) AS total
FROM M_Cast c
JOIN M_Director d ON c.MID = d.MID
WHERE d.PID='nm0007181'
GROUP BY c.PID
HAVING ...
```

该查询会返回多行，不能返回 gold 要求的单个 `107`。

### 重复策略

模型在已经得到正确答案后，继续处理：

- Person 表重复 PID；
- 名称前导空格；
- `MIN(TRIM(Name))`；
- CTE 相关子查询相关性；
- `LEFT JOIN` 空结果。

这些都是附加展示名问题，而题目只要求数量。名称 join 不应阻塞 scalar 交付。

### 终止条件

- `Status: max_turns`
- `calls=21`
- `errors=1`
- `csv=False`
- 无 `export_query`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：是**
- **Failure to export after success：是，证据最强**
- **Genuinely complex：否/中等**，图关系中等复杂，但不应阻塞数量结果

### 修复建议

**运行时可强制：**

- 当模型明确声明“count is 107”，且前一个 SQL 已返回单个数量时，自动标记为“可交付结果”。
- 如果后续查询的输出列数从 1 变为多列/多行，要求确认是否仍为最终查询。
- 对 scalar 题强制在 `export_query` 前执行 `COUNT(*)`/shape check。

**提示词修复：**

- 题目只要求数量时，不要为 actor name 做额外 join；
- 成功结果优先导出，附加诊断放在导出之后或完全省略；
- 明确“最后成功 SQL”不得被未经验证的调试 SQL 覆盖。

---

## local100 — Shahrukh number 为 2 的演员数量

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local100.md`
**严重性：** P1（错误假设与硬终止）

### 工具序列重建

1. 查询 IMDB 表结构。
2. 查询 Shah Rukh Khan，得到 `nm0451321`。
3. 以该 PID 查询 `M_Cast`，结果为 0。
4. 构造直接合作演员集合，结果为 0。
5. 继续搜索名字变体和 cast 关联。
6. 尝试一次多语句查询统计表行数。
7. 多语句被工具拒绝。
8. 查询 Chennai Express 等已知电影。
9. 最终直接查询：

```sql
SELECT * FROM M_Cast WHERE MID = 'tt2112124' LIMIT 20;
```

该查询显示 `nm0451321` 确实出现在电影 cast 中，说明前面的“SRK 不在 cast”结论可能来自数据中空格/键匹配或工具结果异常。
10. 仍未构造二跳演员图查询。

### 错误

明确的多语句错误：

```text
FORBIDDEN_SQL: SQL blocked: injection pattern detected ...
Only read-only SELECT/WITH queries are supported; rewrite the request without write operations or multiple statements.
```

### 重复策略

模型反复在以下假设之间切换：

- Shah Rukh Khan 不在 cast；
- Person 表 PID 与 M_Cast PID 不一致；
- 电影数据可能缺失；
- 电影 title 可能是线索；
- 重新查询多个已知电影。

在直接 `M_Cast WHERE MID='tt2112124'` 已经证明目标 PID 存在后，仍未立即建立：

1. SRK 电影集合；
2. 一跳演员集合；
3. 与一跳演员同片的二跳候选；
4. 排除直接与 SRK 合作者；
5. 计数。

### 最后成功 SQL

```sql
SELECT * FROM M_Cast
WHERE MID = 'tt2112124'
LIMIT 20
```

这是调试样本，不是答案。

### 终止条件

- `Status: max_turns`
- `calls=25`
- `errors=1`
- `csv=False`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：是**
- **Stale-tool/path：否**
- **Genuinely complex：中等**，需要二跳图关系，但 SQL 结构清晰
- **Failure to export：否**，没有得到答案 SQL

### 修复建议

**运行时可强制：**

- 对“二跳关系”问题自动提供 graph traversal 计划模板。
- 多语句调用在发送前拆分或直接提示只允许单条 SELECT/WITH。
- 发现目标 PID 在直接事实表中存在后，降低“实体不存在”假设优先级。

**提示词修复：**

- PID 查询结果为 0 时先检查空格、JOIN 方向和具体 MID，而不是立即判断数据缺失；
- 使用 `TRIM` 仅用于名称展示，不要让名称 join 阻塞关系计数；
- 二跳查询先返回候选集合数量，再返回最终 scalar。

---

## local157 — Bitcoin 交易量日变化

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local157.md`
**严重性：** P1（终止且未导出；可能已有接近完成的 SQL）

### 工具序列证据边界

案例文件未保留完整 compact trajectory，只记录：

- `Status: timeout`
- `calls=19`
- `errors=1`
- `csv=False`
- 最终 SQL

因此不能确认中间有哪些 SQL 重试、错误内容或重复策略。

### 最终 SQL

```sql
WITH parsed AS (
  SELECT
    ticker,
    market_date,
    substr(market_date,7,4) || '-' ||
    substr(market_date,4,2) || '-' ||
    substr(market_date,1,2) AS sort_date,
    CASE
      WHEN volume = '-' THEN 0
      WHEN substr(volume, length(volume)) = 'K'
        THEN CAST(substr(volume,1,length(volume)-1) AS REAL) * 1000
      WHEN substr(volume, length(volume)) = 'M'
        THEN CAST(substr(volume,1,length(volume)-1) AS REAL) * 1000000
      ELSE CAST(volume AS REAL)
    END AS vol_numeric
  FROM bitcoin_prices
),
with_prev AS (...),
SELECT ...
```

该 SQL 具备题目所需的主要结构：

- K/M 单位转换；
- `-` 转 0；
- 查找前一个非零 volume；
- 计算百分比变化；
- 按 ticker/date 排序。

但案例没有证据证明该 SQL 成功执行，也没有导出。最终别名是 `daily_change_pct`，而 gold 头部是 `daily_change`，需要确认评测是否严格比较 header。

### 分类

- **硬超时：是**
- **Needless exploration：证据不足**
- **SQL churn：证据不足**
- **Genuinely complex：是/中等**，涉及字符串数值解析和非零前值窗口
- **Failure to export after success：暂不计入明确统计**，因为文件没有记录成功执行证据

### 修复建议

**运行时可强制：**

- 一旦最终 SQL 成功返回 20 行、5 列，并满足日期范围，自动触发 `export_query`。
- header 与预期列名不一致时，提示仅修正 alias，不得重新探索业务逻辑。
- 对 `volume='-'`、`K`、`M`、普通数字分别执行最小边界样例验证。

**提示词修复：**

- 先写解析 CTE，再写前一个非零日期关联；
- 确定最终列名必须与题目/评测契约一致；
- 不要在 SQL 已接近完成时继续无界扩展探索。

---

## local169 — 首任期后 20 年留任率

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local169.md`
**严重性：** P1（只完成 cohort 中间查询）

### 工具序列证据边界

无完整工具轨迹。已知：

- `Status: timeout`
- `calls=19`
- `errors=1`
- `csv=False`

### 最终 SQL

```sql
WITH cohort AS (
    SELECT id_bioguide, MIN(term_start) AS first_start
    FROM legislators_terms
    GROUP BY id_bioguide
    HAVING MIN(term_start) >= '1917-01-01'
       AND MIN(term_start) <= '1999-12-31'
)
SELECT COUNT(*) AS cohort_size
FROM cohort
```

### 失败证据

题目要求：

- period 1 到 20；
- 每期一行；
- 没有留任者的 period 也要保留；
- 计算截至每年 12 月 31 日的 retention rate。

最终 SQL 只返回 cohort size，完全没有 period 生成、terms overlap 或 20 行输出。

### 分类

- **硬超时：是**
- **Needless exploration：轨迹缺失，不能确认**
- **SQL churn：轨迹缺失，不能确认**
- **Genuinely complex：是**，需要日期边界和生成 1–20 period
- **Failure to export：否**，未完成任务级 SQL

### 修复建议

**运行时可强制：**

- 当题目包含“all 20 periods”时，最终输出 shape validator 必须要求 20 行。
- 检查最终 SQL 是否存在 period 维度/递归 CTE或静态 period 集合。
- 返回只有一列 `cohort_size` 时，阻止标记完成。

**提示词修复：**

- 先生成 periods 1–20；
- 再生成首任期 cohort；
- 最后以 period scaffold `LEFT JOIN` 留任统计，保证空期存在。

---

## local170 — 男女议员十年内非零留任州

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local170.md`
**严重性：** P1（最终 SQL 退化为单实体调试）

### 工具序列证据边界

无完整 compact trajectory。已知：

- `Status: max_turns`
- `calls=23`
- `errors=1`
- `csv=False`

### 最终 SQL

```sql
WITH first_term AS (
    SELECT id_bioguide, MIN(term_start) AS first_start
    FROM legislators_terms
    GROUP BY id_bioguide
),
base AS (
    SELECT ft.id_bioguide, ft.first_start,
           (... LIMIT 1) AS state,
           lg.gender,
           CAST(strftime('%Y', ft.first_start) AS INTEGER) AS start_year
    FROM first_term ft
    LEFT JOIN legislators lg
      ON lg.id_bioguide = ft.id_bioguide
)
SELECT base.*,
   EXISTS(...) AS r0
FROM base
WHERE base.id_bioguide='C001070'
```

### 失败证据

题目要求：

- 六个 period：0、2、4、6、8、10；
- 男性和女性两个 cohort；
- 每个州的六个时点都必须 > 0；
- 最终只返回州缩写。

最终 SQL：

- 只过滤一个 `id_bioguide='C001070'`；
- 只计算 `r0`；
- 没有 r2/r4/r6/r8/r10；
- 没有 gender 分组；
- 没有 state 聚合；
- 没有最终 state-only 输出。

### 分类

- **硬超时：是**
- **Needless exploration：证据不足，但最终明显退化为单实体调试**
- **SQL churn：证据不足**
- **Genuinely complex：是**
- **Failure to export：否**

### 修复建议

**运行时可强制：**

- 检测到最终 SQL 包含固定单一实体过滤，而题目要求全体州/全体 cohort 时，触发粒度警告。
- 要求输出列集合与题目一致：只允许 `state`。
- 对六个 period 生成完整性做静态检查。

**提示词修复：**

- 先构造 period scaffold；
- 计算每个议员在每个 period 的 retained flag；
- 按 `state, gender` 聚合；
- 用 `HAVING MIN(retained_count)>0` 选州。

---

## local253 — 薪资清洗、城市 Top 5 与全国均值

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local253.md`
**严重性：** P1（成功计算后未导出）

### 工具序列重建

1. 查询工作区和 SalaryDataset schema。
2. 查询样本数据和城市分布。
3. 调查 `/yr`、`/mo`、`/hr` 格式。
4. 调查 ₹、$、£、AFN 等货币前缀。
5. 尝试通过嵌套 `REPLACE` 清除非数字字符。
6. 验证月薪/时薪年化：
   - `/yr` × 1；
   - `/mo` × 12；
   - `/hr` × 2080。
7. 查询所有非数字字符，补全 `A/F/N` 等清洗规则。
8. 成功执行完整 CTE。
9. 得到 20 行、4 列结果，且样本与 gold 一致。

### 最终成功 SQL

```sql
WITH cleaned AS (...),
annual AS (...),
national AS (...),
city_ranked AS (
  SELECT
    Location,
    CompanyName,
    AVG(annual_salary) AS state_avg,
    ROW_NUMBER() OVER (
      PARTITION BY Location
      ORDER BY AVG(annual_salary) DESC, CompanyName ASC
    ) AS rn
  FROM annual
  WHERE Location IN ('Mumbai','Pune','New Delhi','Hyderabad')
  GROUP BY Location, CompanyName
)
SELECT
  cr.Location,
  cr.CompanyName,
  ROUND(cr.state_avg, 2) AS avg_salary_in_state,
  ROUND(n.country_avg, 2) AS avg_salary_in_country
FROM city_ranked cr
CROSS JOIN national n
WHERE cr.rn <= 5
ORDER BY cr.Location, cr.rn;
```

工具结果明确为 20 行、4 列，包括：

```text
Hyderabad | Meta | 6275360 | 915555.25
Hyderabad | Qwerty Concepts | 5081882 | 915555.25
...
Pune | The City Bank | 5000000 | 915555.25
```

gold 样本也包含：

```text
Hyderabad | Qwerty Concepts | 5081882.0 | 5081882.0
Hyderabad | SetuServ | 4949704.0 | 4949704.0
```

至少从案例记录看，任务 SQL 已经成功并且输出 shape 正确；随后没有 `export_query`。

### 重复策略

前期探索较多，但大部分是有效的格式清洗验证。真正的失败不是 SQL 逻辑，而是：

- 已经得到最终结果；
- 仍未进入导出；
- 运行状态最终为 `max_turns`。

### 终止条件

- `Status: max_turns`
- `calls=25`
- `errors=0`
- `csv=False`
- 没有 `export_query`

### 分类

- **硬超时：是**
- **Needless exploration：后期是**，结果已经完成后仍未交付
- **SQL churn：不属于主要问题**
- **Genuinely complex：是**
- **Failure to export after success：是，最明确案例**

### 修复建议

**运行时可强制：**

- `query_database` 返回：
  - 结果行数；
  - 列数；
  - 列名；
  - 是否与用户请求 shape 相符。
- 当最终查询返回 20×4 并且题目是“top 5 × 4 cities”时，自动建议/自动调用 `export_query`。
- 达到“最终 SQL 已成功验证”状态后，禁止继续调用与业务无关的探索工具，除非用户明确要求解释。

**提示词修复：**

- 明确流程：`query_database` 验证 → 检查 20×4 → 立即 `export_query`；
- 不要在成功结果之后继续做 Python、Widget 或额外报告处理；
- 先固定货币/周期规则，再一次性执行最终 SQL。

---

## local285 — 2020–2023 蔬菜批发财务分析

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local285.md`
**严重性：** P1（严重失配；大量错误）

### 工具序列证据边界

案例只提供元数据和最终 SQL，没有完整工具轨迹。已知：

- `Status: timeout`
- `calls=41`
- `errors=7`
- `csv=False`

### 最终 SQL

```sql
SELECT COUNT(DISTINCT item_code) AS txn_items
FROM veg_txn_df
```

### 失败证据

题目要求：

- 2020–2023 年；
- 每年每个 category；
- 平均、最大、最小批发价；
- 差值；
- 总批发价；
- 总售价；
- 平均损耗率；
- 总损失；
- 利润；
- 24 行、12 列。

最终 SQL 只返回一个交易商品数量，既没有日期解析、商品类别关联、批发价表、销售价汇总，也没有任何财务指标。

### 分类

- **硬超时：是**
- **Needless exploration：完整轨迹缺失，不能精确确认**
- **SQL churn：至少可能存在**，`errors=7` 是强烈信号，但错误内容未记录，不能逐条归因
- **Genuinely complex：是**
- **Failure to export：否**

### 修复建议

**运行时可强制：**

- 根据题目要求的 12 列建立最终投影校验；只有 `item_code` 单列时明确拒绝作为最终 SQL。
- 识别题目中的年份范围和 category 粒度，检查最终 SQL 是否包含年份分组。
- 多次错误后切换到“最小可行查询”模式，而不是继续无边界尝试。

**提示词修复：**

- 先确认 `veg_txn_df` 是否包含题目所需的批发价/类别字段；
- 如果需要其他表，先完成 schema 级关联；
- 先产出单年单类别样例，再扩展到 24 行。

---

## local301 — 2018–2020 年 6 月 15 日前后四周销售变化

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local301.md`
**严重性：** P1（日期语义探索失控）

### 工具序列重建

1. 搜索/读取 weekly sales schema。
2. 查询 `weekly_sales` 样本，发现日期是 `D/M/YY`。
3. 查询 `cleaned_weekly_sales`。
4. 多次查询 2018/2019/2020 年 6、7 月日期。
5. 反复讨论 June 15 属于 before、after 还是 anchor week。
6. 确认周一日期和 2018/2019/2020 的 anchor week。
7. 尝试用 SQLite `strftime` 解析非零填充日期。
8. 出现 malformed SQL：

```sql
SELECT week_date, strftime('%w', substr('0'||week_date... ))
```

错误：

```text
MCP_TOOL_ERROR: near ".": syntax error
```

9. 继续查询窗口周次，但没有实现四周汇总。
10. 最终只查询 2020 年 6/7 月格式化日期。

### 最后成功 SQL

```sql
SELECT DISTINCT week_date_formatted
FROM cleaned_weekly_sales
WHERE week_date_formatted LIKE '2020-%'
  AND (
    week_date_formatted LIKE '2020-6-%'
    OR week_date_formatted LIKE '2020-7-%'
  )
ORDER BY week_date_formatted;
```

这是日期探查，不是题目要求的 3×5 结果。

### 重复策略

核心重复是：

- 反复争论 anchor week 是否包含在 before/after；
- 反复按字符串排序日期；
- 反复查询周列表；
- 没有先用 `week_number` 直接定义 4 周窗口。

题目 gold 需要：

```text
before_effect
after_effect
change_amount
percent_change
year
```

最终 SQL 一个日期列都无法生成这些字段。

### 终止条件

- `Status: max_turns`
- `calls=33`
- `errors=2`
- `csv=False`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：是**
- **Genuinely complex：中等**，日期窗口边界需要明确，但不应持续 33 轮
- **Failure to export：否**

### 修复建议

**运行时可强制：**

- 日期字段若已有 `calendar_year`、`week_number`，优先禁止使用字符串日期排序作为主策略。
- 对 3 年固定 anchor 任务自动生成窗口 scaffold。
- 连续查询相同年份周列表超过阈值时，触发“停止探查，转入聚合”提示。

**提示词修复：**

- 使用 `calendar_year` 和 `week_number`，定义：
  - before：anchor week 前四周；
  - after：anchor week 后四周。
- 明确输出必须是每年一行、五列；
- 不要让日期格式化细节替代业务聚合。

---

## local302 — 2020 年 6 月 15 日前后 12 周属性影响

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local302.md`
**严重性：** P1（工具合同错误 + 窗口未落地）

### 工具序列重建

1. 调用 `list_workspace`。
2. 错误调用不存在的工具 `read_knowledge_file` 两次。
3. 读取 DDL。
4. 搜索 schema。
5. 查询 `cleaned_weekly_sales` 样本和属性值。
6. 讨论 12 周 before/after 窗口。
7. 反复争论是否包含 2020-06-15。
8. 最终查询日期计数：

```sql
SELECT COUNT(DISTINCT week_date) as total_weeks,
       COUNT(DISTINCT week_date) FILTER (WHERE week_date < '2020-06-15') as weeks_before,
       COUNT(DISTINCT week_date) FILTER (WHERE week_date >= '2020-06-15') as weeks_after_or_equal
FROM cleaned_weekly_sales
```

结果：

```text
total_weeks | weeks_before | weeks_after_or_equal
72          | 60           | 12
```

### 错误工具

明确错误：

```text
Tool read_knowledge_file not found
```

出现两次。

### 语义问题

题目要求比较 2020 年 6 月 15 日前后各 12 周，并针对：

- region；
- platform；
- age_band；
- demographic；
- customer_type；

计算每个属性值的百分比变化，再求各属性类型平均，最终只返回负面影响最大的：

```text
demographic | -2.008662
```

最终 SQL 的 `weeks_before=60` 是整个数据集 2018–2020 的所有历史周，而不是 2020 年 anchor 前的 12 周。它只确认了全表日期分布，没有按 2020 窗口、属性值、销售额完成计算。

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：不是主要问题**
- **Stale-tool/path call：是**
- **Genuinely complex：是/中等**
- **Failure to export：否**，最终只是窗口探查

### 修复建议

**运行时可强制：**

- 工具调用前进行 registry 检查；不存在的工具直接在客户端拦截，不消耗模型轮次。
- 对 `week_date` 查询自动检查是否包含年份过滤；
- 最终 scalar 题必须验证只有 `metric, avg_percent_change` 两列和一行。

**提示词修复：**

- 禁止调用未注册工具；
- 固定窗口：
  - before = 2020-03-23 至 2020-06-08；
  - after = 2020-06-15 至 2020-08-31；
- 先将五种属性 unpivot 为 `(metric, attribute_value)`，再统一计算。

---

## local329 — `/regist/input` 后 `/regist/confirm` 会话数

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local329.md`
**严重性：** P1（正确事实已找到，但最终 SQL 完全无关）

### 工具序列重建

1. 搜索会话顺序问题。
2. 错误读取：

```text
ENOENT: no such file or directory, realpath 'C:\data-agent-eval\...\knowledge\db_schema.md'
```

3. 直接查询 SQLite 表列表。
4. 查询 `action_log`、`activity_log`、`form_log` schema。
5. 在错误表中查询 `/regist`，得到空结果。
6. 查询所有 action/path，发现：
   - `activity_log` 中是 `/input`、`/confirm`；
   - `form_log` 中是 `/regist/input`、`/regist/confirm`。
7. 查询 `form_log` 样本，发现 3 倍重复。
8. 按 session 聚合，明确得到：
   - `/regist/input` sessions：`647219c7`、`46b4c72c`；
   - `/regist/confirm` sessions：`9b5f320f`、`46b4c72c`。
9. 进一步确认 `46b4c72c`：
   - input：`00:56:08`
   - confirm：`00:57:31`
10. 已经得到唯一答案为 1。
11. 最终却回到无关表：

```sql
SELECT DISTINCT url
FROM action_log_with_noise
LIMIT 20
```

### SQL 错误/无关尝试

主要不是 SQL 语法错误，而是表选择和目标漂移：

- 在 `activity_log`、`action_log`、`access_log` 中找不存在的 `/regist`；
- 忽略已经确认 `form_log` 是正确事实表；
- 最终查询 `action_log_with_noise.url`，该表没有 `/regist` 数据。

### 最后成功 SQL

任务级上最有价值的成功证据是：

```sql
SELECT session, path, stamp, COUNT(*) AS cnt
FROM form_log
WHERE path LIKE '/regist%'
GROUP BY session, path, stamp
ORDER BY session, path, stamp
```

它直接证明 `46b4c72c` 的顺序。

最终 SQL 则是无关的 `action_log_with_noise` 查询。

### 终止条件

- `Status: max_turns`
- `calls=48`
- `errors=1`
- `csv=False`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：表选择层面是**
- **Stale-tool/path call：是**
- **Failure to export after success：接近是**，已获得足以生成 1 的证据，但没有形成最终 SQL/导出
- **Genuinely complex：否**，这是一个简单的有序 session semi-join

### 修复建议

**运行时可强制：**

- 当某表已经产生目标路径的非空结果时，将其锁定为候选事实表；除非查询验证失败，不得无理由切换到其他表。
- 对路径/表名做数据存在性评分：`form_log` 中存在精确路径时，优先级高于其他表。
- 运行时路径校验拦截错误绝对路径。

**提示词修复：**

- 先查精确路径出现在哪张表；
- 用 `EXISTS` 或自连接验证 `MIN(input_stamp) < MAX(confirm_stamp)`；
- 去重用 `COUNT(DISTINCT session)`，不需要先解决所有重复行。

---

## local331 — 两次连续 `/detail` 后的第三页

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local331.md`
**严重性：** P1（序列分析未完成）

### 工具序列重建

1. 查询表列表和 activity schema。
2. 查询样本，发现同一事件有 5 倍重复。
3. 统计 path，发现 `/detail` 与 `/detail/` 两种形式。
4. 查询按 session、stamp、path 的数据。
5. 反复讨论：
   - `SELECT DISTINCT` 去重；
   - trailing slash 是否归一化；
   - 同一时间戳的两个 path 是否算一次；
   - “两次连续 detail”是同一 stamp 的两种 URL，还是两个不同 stamp。
6. 查询 session `1cf7678e`、`87b5725f`、`9afaf87c` 的样本。
7. 仍未完成窗口函数/行号序列和第三页计数。

### 最后成功 SQL

```sql
SELECT DISTINCT session, stamp, path
FROM activity_log
ORDER BY session, stamp, path
```

这是原始去重明细，不是题目要求的三行 top-N：

```text
/detail | 33
END      | 7
/        | 2
```

### 重复策略

反复讨论 path 归一化，但没有固定一个可执行规则。对于这种序列题，应该先确定：

1. 去重粒度；
2. path 规范化；
3. session 内 row_number；
4. 用 `LAG`/自连接取连续三项；
5. 聚合计数。

### 终止条件

- `Status: max_turns`
- `calls=27`
- `errors=0`
- `csv=False`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：不是语法 churn，属于语义策略 churn**
- **Genuinely complex：是/中等**，需要处理重复和序列
- **Failure to export：否**

### 修复建议

**运行时可强制：**

- 为序列问题提供标准窗口函数模板；
- 对同一 session/path 重复讨论超过阈值后，强制选择去重规则；
- 最终结果要求 3×2，防止原始明细查询结束。

**提示词修复：**

- 明确使用 `(session, stamp, normalized_path)` 去重；
- 以 stamp 作为事件顺序，增加稳定 tie-breaker；
- 若题目把 `/detail` 视作逻辑页面，应统一 trailing slash；
- 用 `LEAD(path, 1)`、`LEAD(path, 2)` 直接提取第三页。

---

## local336 — 前五圈四类超车

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local336.md`
**严重性：** P1（数据覆盖风险 + 硬终止）

### 工具序列重建

1. 读取 F1 schema 和 overtake 分类文档。
2. 查询 `races`，确认 `race_id=336` 是 1990 Australian Grand Prix。
3. 查询 `lap_positions`：
   - 只有 lap 0 起始位置；
   - retirement rows；
   - 没有 `lap_type='Race'`。
4. 查询 `lap_times`，race 336 为 0 行。
5. 查询 `lap_times_ext`，为 0 行。
6. 查询 `pit_stops`，为 0 行。
7. 查询 `results` 和 `retirements`，确认只有最终结果、退赛圈和起始位置。
8. 反复讨论 race 336 是否可能映射到其他 race。
9. 最终诊断查询：

```sql
SELECT 'lap_times' src, COUNT(*) n FROM lap_times WHERE race_id=336
UNION ALL SELECT 'lap_times_ext', COUNT(*) FROM lap_times_ext WHERE race_id=336
UNION ALL SELECT 'lap_positions_race', COUNT(*) FROM lap_positions
  WHERE race_id=336 AND lap_type='Race'
UNION ALL SELECT 'pit_stops', COUNT(*) FROM pit_stops WHERE race_id=336
```

结果全部为 0。

### 关键事实

模型最终已经确认：

```text
race 336:
lap_times = 0
lap_times_ext = 0
lap_positions_race = 0
pit_stops = 0
```

因此无法从现有 case 文件证明前五圈的完整超车数。`results` 只能给 grid/final position，不能恢复 lap 1–5 的逐圈位置交换。

### 重复策略

在明确得到所有逐圈数据均为 0 后，模型仍然多次重新怀疑：

- local336 是否对应另一个 race；
- race ID 是否重新映射；
- 是否可从结果和退赛推断；
- 是否存在遗漏的 lap 数据表。

这属于“已经有结论仍继续假设”的典型 needless exploration。

### 终止条件

- `Status: max_turns`
- `calls=36`
- `errors=0`
- `csv=False`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：不是主要问题**
- **Stale-tool/path：否**
- **Genuinely complex：是**
- **数据/题目覆盖风险：是**
- **Failure to export：否**，没有任务级可计算 SQL

### 修复建议

**运行时可强制：**

- 对需要逐圈分析的题目，在开始时执行 coverage preflight：
  - race 是否存在；
  - Race lap rows 数；
  - pit stop rows 数；
  - lap 0–5 是否完整。
- 若 preflight 发现数据缺失，自动进入“不可计算”分支，输出结构化数据缺口，而不是消耗剩余轮次。
- 不要在数据覆盖已被四个独立查询确认后继续尝试同类查询。

**提示词修复：**

- 先检查 race/lap 数据可用性；
- 发现无法计算时立即报告：
  - 已有数据；
  - 缺失数据；
  - 哪些分类可计算、哪些不可计算；
- 不要用最终排名伪造逐圈超车。

---

## local344 — 所有有 pit 数据比赛的超车分类总数

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local344.md`
**严重性：** P1（复杂 F1 逻辑未收敛）

### 工具序列重建

1. 读取 schema、business、overtake 分类文档。
2. 确认 `lap_positions`、`pit_stops`、`retirements`、`lap_times_ext` 字段。
3. 查询 pit stop 时长统计。
4. 发现：
   - 中位数约 23.6 秒；
   - 平均值被 3M ms 异常值拉高；
   - 正常 10–60 秒平均约 24.4 秒。
5. 检查 race 841 的位置变化与 pit lap：
   - driver 4 pit lap 12，位置出现大幅变化；
   - driver 1 pit lap 16，位置在相邻 lap 变化。
6. 讨论如何定义：
   - retirement；
   - pit entry；
   - pit exit；
   - start；
   - track。
7. 讨论位置交换方向和 pairwise self-join。
8. 未完成所有 race 的聚合。

### 最后成功 SQL

案例头部最终 SQL 为：

```sql
SELECT DISTINCT lap_type, COUNT(*)
FROM lap_positions
GROUP BY lap_type
```

这是 lap_type 行数统计，不是题目要求的四类超车计数。gold 要求：

```text
P | 36767
R | 5699
S | 2452
T | ...
```

### 重复策略

主要重复在 pit exit 语义：

- 典型 pit stop 时长用中位数还是平均数；
- 以哪个 lap transition 代表 pit entry；
- 以哪个 transition 代表 pit exit；
- running milliseconds 在何时计算 gap；
- retired driver 是否应保留在位置交换中；
- start 是 lap 0→1 还是 lap 1→2。

这些都是需要先形成规范的复杂点，但模型没有把定义写成固定事件分类优先级并执行。

### 终止条件

- `Status: timeout`
- `calls=29`
- `errors=0`
- `csv=False`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：不是语法型，属于方法 churn**
- **Genuinely complex：是**
- **Failure to export：否**

### 修复建议

**运行时可强制：**

- F1 题目启动时加载固定 overtake event 模板：
  - pairwise order swap；
  - retirement priority；
  - pit entry/exit priority；
  - start exclusion；
  - track fallback。
- 为 pit duration 提供预先约定的阈值，不允许运行中反复改变。
- 对全量 pairwise join 设置查询复杂度/超时保护，并建议先按 race/lap 分块。

**提示词修复：**

- 先以伪代码固定分类优先级；
- 明确“被超车者”和“超车者”的方向；
- 先在单个 race 841 上验证事件样例，再推广到全量；
- 最终仅输出 `overtake_type, overtake_count`。

---

## local355 — 跨队缺席期间的首尾 round 平均值

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local355.md`
**严重性：** P1（仅停在 schema 探查）

### 工具序列证据边界

案例未记录完整工具轨迹。已知：

- `Status: timeout`
- `calls=11`
- `errors=1`
- `csv=False`

### 最终 SQL

```sql
SELECT name
FROM sqlite_master
WHERE type='table'
```

### 失败证据

题目要求：

- 按 driver/year 识别少于三场的 hiatus；
- 找缺席前一场和缺席后一场；
- 比较 constructor ID；
- 仅保留换队者；
- 计算所有符合条件记录的平均 first round 和 last round；
- 最终一行两列。

最终 SQL 只列出表名，没有任何 terms、results、drives 或 constructor 逻辑。

### 分类

- **硬超时：是**
- **Needless exploration：完整轨迹缺失**
- **SQL churn：不能确认**
- **Genuinely complex：是**
- **Failure to export：否**

### 修复建议

**运行时可强制：**

- 问题包含“overall averages”“do not group by year”时，最终结果 shape 必须为 1×2。
- 若最终 SQL 只有 `sqlite_master`，识别为 schema probe，禁止作为最终查询。
- 提供 hiatus 检测模板（按 driver/year 排序、`LAG/LEAD`）。

**提示词修复：**

- 先生成每个 driver/year 的比赛轮次序列；
- 找缺口长度 1–2；
- 用缺口两端 constructor 比较；
- 最后再跨所有符合记录求平均，不按 year 输出。

---

## local356 — 赛道超车多于超车他人的车手

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local356.md`
**严重性：** P1（复杂逻辑未完成）

### 工具序列重建

1. 加载 analysis skill 和 workspace。
2. 读取 F1 DDL、schema、business docs。
3. 识别 `lap_positions`、`pit_stops`、`retirements`、`races_ext`。
4. 讨论 pairwise position swap 的定义。
5. 查询 race 1 的逐圈位置，确认 `lap_type='Race'`。
6. 讨论 pit entry/exit 和 first-lap 排除。
7. 检查 pit data availability：
   - `races_ext` 中 `is_pit_data_available=0/1`；
   - 发现 273 场可用、852 场不可用。
8. 反复讨论 race scope、lap transition、pit stop timing。
9. 最终转向年度 pit data coverage 查询。

### 最后成功 SQL

```sql
SELECT e.is_pit_data_available,
       r.year,
       COUNT(DISTINCT r.race_id) AS cnt
FROM races_ext e
JOIN races r ON e.race_id = r.race_id
GROUP BY e.is_pit_data_available, r.year
ORDER BY r.year
```

这只是 pit data coverage，不是车手级的：

- on-track overtaken count；
- on-track overtaking count；
- 两者比较；
- 21 个车手姓名输出。

### 重复策略

模型长时间重复推导：

- 位置交换方向；
- retirement 的位置压缩；
- pit entry/exit transition；
- first lap 是否排除 lap 0→1；
- races_ext coverage 是否限定分析范围。

这些问题本身确实复杂，但缺少明确的事件模型和最小验证步骤。

### 终止条件

- `Status: max_turns`
- `calls=29`
- `errors=1`
- `csv=False`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：方法 churn，是；语法 churn，否**
- **Genuinely complex：是**
- **Failure to export：否**

### 修复建议

**运行时可强制：**

- 将 F1 超车检测拆成可缓存阶段：
  1. `lap_pairs`；
  2. `position_swaps`；
  3. `event_classification`；
  4. driver aggregation。
- 每阶段要求小样本验证后再继续。
- 若查询从车手 aggregation 退回到 race/year coverage，标记为目标漂移。

**提示词修复：**

- 先固定分析范围：所有 `is_pit_data_available=1` 的 race；
- 先排除 pit/retirement/start，再按 overtaken/overtaker 聚合；
- 最终只输出 `full_name`，不要保留调试列。

---

## local360 — 首次 detail/complete 前搜索事件最少的 session

**证据文件：** `D:/data_agent/.tmp/spider2-failure-audit/cases/local360.md`
**严重性：** P1（序列/停止条件未完成）

### 工具序列重建

1. 读取 activity log schema。
2. 查询 action/path/search_type 的 distinct 值。
3. 确认：
   - `/detail` 与 `/detail/`；
   - `/complete`；
   - 搜索事件由非空 `search_type` 标识。
4. 查询 session 总数为 16。
5. 查询 session 样本和重复行。
6. 讨论是否需要对重复路径、重复 band、trailing slash 去重。
7. 查询 `9afaf87c`、`87b5725f` 等 session 的完整片段。
8. 最终仍停在明细序列查询。

### 最后成功 SQL

案例头部最终 SQL：

```sql
SELECT session, stamp, search_type, path
FROM (
  SELECT session, stamp, search_type, path
  FROM activity_log
  GROUP BY session, stamp, search_type, path
)
ORDER BY session, stamp, path
```

这只是去重明细，不是最终两行结果：

```text
36dd0df7 | /search_list/ | Pref-with-Job
87b5725f | /search_list/ | Station-with-Job
```

### 重复策略

模型反复处理：

- 5 倍重复；
- `/path` 与 `/path/`；
- 同一 stamp 多种 path；
- 多个 band；
- `rowid` 是否作为顺序。

但题目只需要每个 session 在第一个 `/detail` 或 `/complete` 前的非空 `search_type` 数量最小者。可以先以 `(session, stamp, path, search_type)` 去重，再用窗口/相关子查询完成。

### 终止条件

- `Status: max_turns`
- `calls=23`
- `errors=1`
- `csv=False`

### 分类

- **硬超时：是**
- **Needless exploration：是**
- **SQL churn：部分是，主要为去重语义 churn**
- **Genuinely complex：中等**
- **Failure to export：否**

### 修复建议

**运行时可强制：**

- 序列题自动提供“事件标准化层”：
  - normalize path；
  - deduplicate；
  - assign `ROW_NUMBER`;
  - locate first target;
  - count preceding events。
- 最终输出 shape 必须为 2×3。

**提示词修复：**

- 先明确路径归一化和去重粒度；
- 只统计 `search_type <> ''`；
- first target 用 `MIN(stamp)`；
- 最终保留 session、path、search_type 三列，不输出 stamp/count。

---

# 4. 分类汇总

## 4.1 按终止方式

| 分类 | 案例 | 数量 |
|---|---|---:|
| `max_turns` | `local015`, `local099`, `local100`, `local170`, `local253`, `local301`, `local302`, `local329`, `local331`, `local336`, `local356`, `local360` | 12 |
| `timeout` | `local098`, `local157`, `local169`, `local285`, `local344`, `local355` | 6 |
| `completed` 但无 CSV | `local073` | 1 |

**结论：** 18/19 是运行时预算耗尽，1/19 是提前结束但没有交付闭环。

## 4.2 按失败机制

### A. 硬超时/预算耗尽 — 18/19

案例：

`local015`、`local098`、`local099`、`local100`、`local157`、`local169`、`local170`、`local253`、`local285`、`local301`、`local302`、`local329`、`local331`、`local336`、`local344`、`local355`、`local356`、`local360`

这是最广泛的表层失败，但并非全部是同一根因：

- 有些是 SQL 没写完；
- 有些是已经成功却未导出；
- 有些是复杂语义争论；
- 有些是数据覆盖风险。

### B. Needless exploration — 至少 13/19

明确有证据的案例：

`local015`、`local073`、`local099`、`local100`、`local170`、`local301`、`local302`、`local329`、`local331`、`local336`、`local344`、`local356`、`local360`

典型模式：

- 关键事实已经确认后继续查同类样本；
- 任务只要求数量，却继续处理展示名；
- 已经确认数据缺失，却继续猜测其他映射；
- 最终 SQL 与已确认的正确表/查询脱离。

### C. SQL churn — 至少 4/19

明确证据：

- `local015`：`FILTER` → `CASE`，`TOP` → `LIMIT`，多次重写摩托车关联策略；
- `local099`：多个 CTE/相关子查询/Person join 版本；
- `local100`：多次 PID/电影/Person 关联假设，外加多语句失败；
- `local301`：多种日期字符串解析和窗口定义，含 malformed SQL。

另有若干案例属于“语义策略 churn”而非语法 churn：

- `local331`；
- `local336`；
- `local344`；
- `local356`；
- `local360`。

### D. Stale-tool/path call — 2/19

1. `local302`：
   - 两次 `read_knowledge_file` 不存在。
2. `local329`：
   - 读取错误的 `C:\data-agent-eval\...\knowledge\db_schema.md`，产生 ENOENT。

### E. Failure to export after success — 明确 2/19

1. `local099`：
   - 已明确得到 `107`；
   - 后续继续调试名称；
   - 没有导出。
2. `local253`：
   - 完整 SQL 已成功返回 20×4；
   - 结果与 gold 样本一致；
   - 没有导出。

`local157` 的最终 SQL 看起来接近完整，但案例没有记录成功执行，因此不纳入“明确成功后未导出”的计数。

### F. Genuinely complex — 主要出现在 15 个案例

明显复杂的领域包括：

- `local015`：跨表安全帽分组和碰撞事实粒度；
- `local073`：递归拆分和配料计数；
- `local157`：字符串数值解析与非零前值；
- `local169`、`local170`：任期/留任窗口；
- `local253`：薪资清洗、年化、城市排名；
- `local285`：多指标年度财务聚合；
- `local301`、`local302`：周窗口及属性影响；
- `local331`、`local360`：日志序列；
- `local336`、`local344`、`local356`：F1 逐圈位置和特殊事件；
- `local355`：跨赛季 hiatus 与车队切换。

但“任务复杂”并不等于“可以无限探索”。复杂任务尤其需要阶段化计划、预检和早停。

---

# 5. 运行时可强制的修复

## 5.1 建立强制交付状态机

建议把任务状态从自由文本改为以下状态：

1. `DISCOVERING`
2. `PLAN_LOCKED`
3. `SQL_DRAFTED`
4. `SQL_VALIDATED`
5. `SHAPE_VALIDATED`
6. `EXPORTING`
7. `DELIVERED`

只有满足以下条件才能进入 `DELIVERED`：

- 已有成功执行的最终 SQL；
- 返回行数/列数符合题目意图；
- 已调用 `export_query`；
- 文件存在；
- 没有将中间查询覆盖为最终 SQL。

这可以直接阻止 `local253`、`local099` 类问题，也能阻止 `local073` 把 `completed` 错当作交付完成。

## 5.2 自动 shape validation

从题目文本和 gold 统计中可以获得基本输出契约：

- scalar：1×1；
- top-N：固定行数和列数；
- “all 20 periods”：至少 20 行；
- “four cities × top 5”：20 行；
- “return only state”：最终应只有一列。

运行时应在 `query_database` 成功后自动显示：

```text
rows=20, columns=4, headers=[...]
```

如果题目预计 scalar，而 SQL 返回三列，必须阻止结束。例如 `local098`、`local099`。

## 5.3 工具注册与路径预检

在实际发送工具调用前：

- 检查工具是否存在；
- 检查参数 schema；
- 对文件路径执行存在性检查；
- 不允许模型反复重试不存在工具。

可直接解决：

- `local302` 的 `read_knowledge_file not found`；
- `local329` 的错误路径 ENOENT。

## 5.4 探索预算和重复检测

运行时应对以下模式计数：

- 相同表的重复 `DISTINCT` 探查；
- 相同字段的重复样本查询；
- 连续改写相同 CTE；
- 连续调用 schema/search 而没有进入最终 SQL。

建议：

- schema/数据探查预算：3–5 次；
- 同类 SQL 重写：最多 2 次；
- 发现关键事实后必须锁定表/粒度；
- 超过阈值时强制要求模型输出计划和最终 SQL。

## 5.5 数据覆盖 preflight

对于逐圈、时间窗、关联键问题，先自动检查：

- race 是否有 `lap_type='Race'`；
- 日期窗口是否完整；
- 关联键 overlap 和 unmatched 比例；
- 目标字段非空比例；
- 需要 12 周/20 period 时是否真的有足够数据。

这能提前发现：

- `local015` 的 parties/collisions case ID 关联异常；
- `local336` 的 race 336 没有逐圈数据；
- `local169`/`local170` 的 period scaffold 缺失；
- `local301`/`local302` 的日期窗口不完整或范围过宽。

## 5.6 复杂 SQL 分阶段缓存

对 F1、日志、Pizza、任期等复杂任务，运行时应允许保存并复用中间关系：

- 标准化表/CTE；
- 窗口函数结果；
- pairwise swap；
- session event sequence；
- cleaned salary；
- period scaffold。

每阶段成功后缓存结果，避免模型反复从头探查。

---

# 6. 提示词层面的修复

## 6.1 强制“先计划，后查询，成功即交付”

推荐固定提示词：

> 先写出业务粒度、时间边界、输出列和验证条件。
> 最多执行少量 schema/样本查询。
> 一旦最终 SQL 返回符合预期 shape 的结果，立即调用 export_query。
> 不要在成功查询后继续添加展示字段或重新解释业务。

## 6.2 明确禁止无关展示字段

多个案例为了名称、额外维度、调试信息偏离最终目标。应明确：

- 用户只问数量时，不加名称；
- 用户只问 state 时，不加 count/rate 中间列；
- 用户要求 scalar 时，不输出过程列；
- 最终 SQL 只保留契约列。

## 6.3 对序列任务提供固定模板

日志类任务统一使用：

```sql
WITH normalized AS (...),
dedup AS (...),
ordered AS (
  SELECT ...,
         ROW_NUMBER() OVER (
           PARTITION BY session
           ORDER BY stamp, stable_tiebreaker
         ) AS seq
  FROM dedup
)
...
```

适用于：

- `local329`；
- `local331`；
- `local360`。

## 6.4 对时间窗任务固定边界

先回答：

- anchor 是否包含？
- before/after 各有多少周？
- 周字段是日期还是 `week_number`？
- 是否需要按 calendar year 过滤？

适用于：

- `local169`；
- `local170`；
- `local301`；
- `local302`。

## 6.5 对 F1 任务先写事件分类优先级

推荐固定顺序：

1. retirement；
2. pit entry；
3. pit exit；
4. start movement；
5. track。

并明确：

- 哪一方是 overtaken driver；
- 哪一方是 overtaker；
- 使用哪个 lap transition；
- pit duration 阈值如何确定；
- races_ext 是否限制数据范围。

适用于：

- `local336`；
- `local344`；
- `local356`。

---

# 7. 残余风险

1. **部分案例轨迹不完整**
   `local098`、`local157`、`local169`、`local170`、`local285`、`local355` 无完整中间工具轨迹，无法进一步确认具体重复调用和错误类型。

2. **local015 的真实关联键仍需数据层确认**
   案例记录显示 parties 与 collisions 的 `case_id` 大量不重合；不能仅根据最终失败轨迹判断是数据质量问题、抽样差异还是正确关联键未被发现。

3. **local336 可能存在题目/数据映射不一致**
   race 336 明确没有逐圈 Race rows、lap times 或 pit stops，但 gold 仍要求逐圈超车分类。应由数据装载或 benchmark 生成流程确认 race 映射。

4. **部分最终 SQL 可能“看起来接近正确”但未经导出验证**
   尤其是 `local157`。没有成功执行和导出证据，就不能将其视为完成。

5. **复杂 SQL 仍可能触发 SQLite 性能问题**
   `local073`、`local285`、`local344`、`local356` 的全量递归/自连接/窗口查询需要分阶段验证和查询超时保护。

---

# 8. 审计结论

本轮 19 个 no-CSV 案例没有发现“单纯 export 工具偶发失败”这一种解释。主要失败组合是：

- 18 个运行时硬终止；
- 至少 13 个探索失控；
- 至少 4 个明确 SQL churn；
- 2 个明确 stale-tool/path；
- 2 个已成功得到任务结果却没有导出；
- 1 个明显数据覆盖/题目映射风险。

最小、最高收益的修复顺序：

1. **强制最终 SQL → shape validation → export_query 闭环；**
2. **阻止 `completed` 但无 CSV；**
3. **工具注册和路径预检；**
4. **重复探索检测和预算；**
5. **为时间窗、日志序列、F1 超车提供固定模板；**
6. **加入数据覆盖 preflight。**

没有代码修改，没有测试运行，没有 Git 变更。

### D. 基线到第 3 轮的退化案例复核

# Spider2 baseline → round3 失败审计

审计对象：

- `local007`
- `local081`
- `local085`
- `local131`
- `local197`
- `local229`
- `local275`
- `local309`

## 审计范围与证据说明

已读取每个案例的预提取文件：

- `D:/data_agent/.tmp/spider2-failure-audit/cases/<id>.md`

并逐案对比：

- baseline：`C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/<id>/result.json`
- baseline trace：`.../trace.json`
- baseline SQL 导出文件：`.../workspace/<id>.csv`
- round3：`C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/<id>/result.json`
- round3 trace：`.../trace.json`
- round3 SQL 导出文件：`.../workspace/<id>.csv`

所有八个案例的 `result.json` 状态均为 `completed`，且均生成了 CSV。预提取案例文件均记录 `Baseline: score=1`；但是本次允许读取的 `result.json`/`trace.json` 中没有单独的 round3 score 字段，因此以下不臆测 round3 的数值分数，而是依据导出结果、最终 SQL、用户合同与 gold 输出进行判定。

---

## 总览

| Case | baseline → round3 核心变化 | Round3 判定 | 主要原因 |
|---|---|---|---|
| `local007` | `4.92` → `4.82` | **P1 真回归** | 从用户要求的组件差值改成了过度复杂的日历借位算法 |
| `local081` | 20/36/12/13 → 20/37/13/11 | **P1 真回归** | 用户明确说排除折扣，round3 却乘了 `(1 - discount)` |
| `local085` | 正确百分比、3 列 → 小数比例、4 列 | **P1 真回归** | 百分比单位错误，并额外输出 `total_orders` |
| `local131` | 20×4 分位置统计 → 25×2 总计数 | **P1 真回归** | 把三个独立统计列合并为一个总数，并加入零出现样式 |
| `local197` | 单行最大变化 → Top 10 变化 | **混合：P1 输出回归 + gold 合同异常** | round3 核心第一行正确，但错误地输出 10 行 |
| `local229` | 总分不含 extras → 总分加入 extras | **P1 真回归** | gold 的 partnership 总分等于两名球员得分之和，round3 额外加 extras |
| `local275` | 空集 → 空集 | **无真回归，评分/参考答案疑似 artifact** | 两个版本均正确执行“12 个月全部 >2”，gold 的四个产品与“every month”矛盾 |
| `local309` | 基于 `results` 的赛季得分 → 末轮 standings | **P1 真回归** | round3 改用不适配该任务/数据的 standings，早期 constructor 也变成空值 |

综合判断：**6 个明确真回归，1 个混合型输出回归，1 个主要是 baseline/gold 评分 artifact。**

---

# 逐案审计

## 1. local007 — Baseball career span

### 用户合同

用户要求：

1. 对每名球员计算 debut 与 final_game 的年份、月份、日期组件差值；
2. 计算：

   ```text
   abs(years)
   + abs(months) / 12
   + abs(days) / 365
   ```

3. 每个部分先四舍五入到两位；
4. 再求平均并四舍五入为浮点数；
5. 输出标量结果。

### Baseline 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/local007/result.json`
- `.../workspace/local007.csv`

baseline 的最终 SQL 直接对年月日组件做绝对差：

```sql
ROUND(ABS(year(final_game) - year(debut)), 2)
+ ROUND(ABS(month(final_game) - month(debut)) / 12.0, 2)
+ ROUND(ABS(day(final_game) - day(debut)) / 365.0, 2)
```

导出：

```text
avg_career
4.92
```

这与 gold 的数值 `4.923752748` 一致到最终两位四舍五入，且输出是单行单列。

### Round3 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/local007/result.json`
- `.../workspace/local007.csv`

round3 改为多层 CTE：

- `base`
- `diff`
- `borrow_days`
- `adj`
- `final_diff`
- `spans`

并引入：

```sql
CASE WHEN gross_days < 0 THEN gross_months - 1 ELSE gross_months END
```

以及按 final_game 前一个月天数进行借位。导出结果：

```text
avg_career_span_years
4.82
```

shape 仍是 `[1, 1]`，但数值从 baseline 的 `4.92` 变为 `4.82`，偏离 gold。

### 根因

这是典型的**过度解释/过度建模**：

- 用户已经明确描述了“年份、月份、日期组件的差值及绝对值公式”；
- round3 将其重新解释成了完整日历区间分解；
- 日历借位并不是用户合同的一部分；
- round3 的复杂算法改变了实际计算口径。

### 判定

**P1 真回归。**

不是 stochastic variation，也不是工具终止问题：

- baseline：`completed`，`toolErrors=0`
- round3：`completed`，`toolErrors=0`
- 两边均成功导出；
- 差异完全来自最终 SQL 的业务口径变化。

### 最小预防措施

对“用户给出明确公式”的任务：

- 先按文字公式逐项实现；
- 不要将“component difference”自动升级成“calendar interval”；
- 在导出前对照用户公式逐项检查；
- 对标量任务必须同时检查数值与最终列名。

---

## 2. local081 — Northwind 1998 customer spending groups

### 用户合同

用户明确要求：

> summing the unit price multiplied by the quantity ... **excluding any discounts**

也就是每行应计算：

```text
unitprice * quantity
```

而不是：

```text
unitprice * quantity * (1 - discount)
```

之后：

- 按客户聚合；
- 按 `customergroupthreshold` 分组；
- 计算各组客户数；
- 计算占 1998 下单客户总数的百分比。

### Baseline 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/local081/result.json`
- `.../workspace/local081.csv`

baseline SQL：

```sql
SUM(od.unitprice * od.quantity) AS total_spent
```

导出结果：

```csv
groupname,customer_count,percentage
"Low",20,24.69
"Medium",36,44.44
"High",12,14.81
"Very High",13,16.05
```

这符合“排除折扣”的用户要求。

### Round3 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/local081/result.json`
- `.../workspace/local081.csv`

round3 SQL 改成：

```sql
SUM(od.unitprice * od.quantity * (1 - od.discount)) AS total_spend
```

导出：

```csv
groupname,customer_count,pct_of_customers
"Low",20,24.69
"Medium",37,45.68
"High",13,16.05
"Very High",11,13.58
```

由于折扣被应用，客户在分组边界附近发生重新分组，Medium/High/Very High 数量均变化。

### 根因

这是直接违反用户合同的**prompt-induced semantic regression**：

- round3 将“excluding any discounts”误读成了使用折扣后的净额；
- baseline 的 `unitprice * quantity` 才是用户要求；
- 百分比计算使用 81 作为分母本身不是主要问题，round3 的分组已经被错误金额改变。

### 运行状态

- baseline：`completed`，`toolErrors=2`
- round3：`completed`，`toolErrors=0`

baseline 的工具错误没有阻止其得到正确最终输出；round3 工具行为更干净，但 SQL 业务语义错误。

### 判定

**P1 真回归。**

### 最小预防措施

对否定性财务措辞建立硬校验：

- “excluding discounts” → 最终 SQL 中不得出现 `(1 - discount)`；
- “including discounts” → 才允许使用折扣因子；
- 聚合前逐项将自然语言约束映射成 SQL 表达式；
- 对金额分组任务额外检查分组计数总和与客户总数。

---

## 3. local085 — Northwind late-order percentage

### 用户合同

用户要求：

- 只保留总订单数大于 50 的员工；
- late order 定义为 `shippeddate >= requireddate`；
- 取迟到百分比最高的前三名；
- 每人输出：
  - employee ID
  - late order 数
  - late-order percentage

gold shape：

```text
[3, 3]
```

gold 列：

```text
employeeid
late_order_count
late_order_percentage
```

gold 数值为百分比，而不是 0–1 比例：

```text
6.410256...
5.555555...
4.807692...
```

### Baseline 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/local085/result.json`
- `.../workspace/local085.csv`

baseline 导出：

```csv
EmployeeID,late_orders,late_pct
4,10,6.41
7,4,5.56
8,5,4.81
```

baseline：

- 行数正确：3；
- late order 数正确：10、4、5；
- 百分比单位正确：6.41、5.56、4.81；
- 未额外输出总订单列。

### Round3 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/local085/result.json`
- `.../workspace/local085.csv`

round3 导出：

```csv
employeeid,late_orders,total_orders,late_pct
4,10,156,0.0641025641025641
7,4,72,0.05555555555555555
8,5,104,0.04807692307692308
```

round3 的 SQL：

```sql
1.0 * SUM(CASE WHEN shippeddate >= requireddate THEN 1 ELSE 0 END)
    / COUNT(*) AS late_pct
```

round3 输出的是 fraction，而不是 percentage；同时新增了 `total_orders` 列，导致 shape 从 3 列变成 4 列。

### 根因

两个变化都来自输出合同检查失败：

1. **单位错误**：`0.0641` 应输出 `6.4102` 或按照 gold 规则输出百分数；
2. **过度输出**：`total_orders` 可用于筛选，但不代表用户要求在结果中展示。

排名本身没有变化，真正回归发生在输出单位与 shape。

### 运行状态

- baseline：`completed`，`toolErrors=0`
- round3：`completed`，`toolErrors=0`

### 判定

**P1 真回归。**

### 最小预防措施

- 区分 `ratio` 与 `percentage`：
  - ratio：`0.0641`
  - percentage：`6.41`
- `HAVING` 使用的辅助列不应自动进入最终 SELECT；
- 导出前执行最终 shape 检查：
  - 用户要求几列；
  - 用户要求显示哪些中间指标；
  - 数值是否按百分比单位输出。

---

## 4. local131 — EntertainmentAgency musical preferences

### 用户合同

用户要求每个 musical style 一行，并分别统计：

- 作为第 1 preference 出现次数；
- 作为第 2 preference 出现次数；
- 作为第 3 preference 出现次数。

gold shape：

```text
[20, 4]
```

gold 列：

```text
StyleName
FirstPreference
SecondPreference
ThirdPreference
```

例如：

```text
Standards,2,2,0
Jazz,2,1,0
Rhythm and Blues,2,0,1
```

### Baseline 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/local131/result.json`
- `.../workspace/local131.csv`

baseline 导出为 20 个有实际 preference 记录的 style，每行三个独立计数列：

```csv
StyleName,pref1,pref2,pref3
"40's Ballroom Music",0,1,1
"60's Music",1,0,0
...
"Standards",2,2,0
"Top 40 Hits",2,0,0
"Variety",1,0,0
```

这是与 gold 业务粒度一致的结果。虽然别名不同，但列的语义、行数和每个位置的统计均匹配。

### Round3 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/local131/result.json`
- `.../workspace/local131.csv`

round3 SQL：

```sql
COUNT(mp.CustomerID) AS TimesChosen
```

导出：

```csv
StyleName,TimesChosen
"Standards",4
"Contemporary",3
"Jazz",3
...
"50's Music",0
"90's Music",0
"Elvis",0
"Karaoke",0
"Rap",0
```

round3：

- 将 pref1/pref2/pref3 合并成一个总数；
- 从 20 行扩展到全部 25 个 style；
- 加入没有任何 preference 记录的 style；
- 不再提供三个独立 preference-position 统计。

### 根因

这是**聚合维度丢失**：

- “as a 1st, 2nd, or 3rd preference”要求保留 preference position；
- round3 将其理解成“1/2/3 的总出现次数”；
- `LEFT JOIN` 又进一步改变了行集合，加入了用户未要求展示的零计数 style。

### 运行状态

- baseline：`completed`，`toolErrors=0`
- round3：`completed`，`toolErrors=0`

### 判定

**P1 真回归。**

### 最小预防措施

对于“分别统计 A/B/C”的措辞：

- 每个条件应映射到一个独立输出列；
- 不要将多个条件合并为一个 `COUNT`；
- 必须区分：
  - “每个 style 的总次数”
  - “每个 style 在各 preference position 的次数”
- 是否保留零记录维度成员，需依据用户合同，而不是默认 `LEFT JOIN`。

---

## 5. local197 — Sakila top-paying customer month-over-month change

### 用户合同

用户要求：

1. 先确定 top 10 paying customers；
2. 对这些客户计算相邻月份付款金额变化；
3. 找出最大月度变化；
4. 指出客户、月份和变化值；
5. 这是一个 singular maximum，最终应只有一条最大记录。

预提取 gold：

```text
shape: [1, 2]
header: ["month", "max_diff"]
sample: ["07", "77.83"]
```

该 gold 本身有明显合同缺陷：它没有输出用户明确要求的 customer，而且只保留月份 `"07"`，没有年份。但仍可用于判断“最终应为一条最大结果”。

### Baseline 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/local197/result.json`
- `.../workspace/local197.csv`

baseline 导出单行：

```csv
customer_id,customer_name,prior_month,following_month,prior_month_amount,following_month_amount,month_over_month_difference
148,"ELEANOR HUNT","2005-06","2005-07",22.95,100.78,77.83
```

baseline：

- 只返回一行；
- 客户为 148 / ELEANOR HUNT；
- 变化发生于 2005-07；
- `100.78 - 22.95 = 77.83`；
- 核心业务结果正确。

虽然 baseline 额外输出 prior month、两个月金额等字段，shape 并不匹配 gold，但它没有错误地输出其他候选记录。

### Round3 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/local197/result.json`
- `.../workspace/local197.csv`

round3 导出前十行包括：

```csv
customer_id,customer_name,following_month,max_mom_difference
148,"ELEANOR HUNT","2005-07",77.83
137,"RHONDA KENNEDY","2005-07",76.85
144,"CLARA SHAW","2005-07",70.88
469,"WESLEY BULL","2005-07",69.84
181,"ANA BRADLEY","2006-02",-68.85
...
```

round3 SQL 最后使用：

```sql
ORDER BY ABS(mom_diff) DESC
LIMIT 10
```

而不是 `LIMIT 1`。

### 根因与分类

这是一个**混合型问题**：

- gold 的列合同本身不完整，因为用户要求 customer，但 gold 只保留 month/max_diff；
- round3 的第一行核心事实是正确的；
- 但是 round3 将 singular maximum 输出成 top 10，明确违反用户的最终粒度；
- baseline 的 `LIMIT 1` 更符合“largest change”的最终粒度。

因此，不能把全部差异都归因于 gold artifact。round3 的十行输出是可证实的当前回归。

### 运行状态

- baseline：`completed`，`toolErrors=0`
- round3：`completed`，`toolErrors=0`

### 判定

**P1 输出合同回归；核心数值未回归。**

这是“过度回答/误把 top-10 输入集合当成 top-10 输出”的典型案例。

### 最小预防措施

明确区分：

- “top 10 paying customers”是候选集合；
- “largest month-over-month difference”是最终单一最大值。

查询结构应保证：

```text
top10 customers
→ monthly differences
→ ORDER BY magnitude DESC
→ LIMIT 1
```

同时应在导出前检查：

- 用户要求 single / largest / maximum 时，结果是否只有一行；
- 输入集合的 Top-N 不应自动传播到最终输出行数。

---

## 6. local229 — IPL partnership runs

### 用户合同

用户要求：

- 对每场比赛找到 partnership runs 最高的 pair；
- 允许同一场比赛多行（并列最高）；
- 输出两个 player ID；
- 输出两名球员的个人得分；
- 输出 partnership 总分；
- 按个人得分排序 player 1 / player 2；
- 个人得分相同时，ID 高者为 player 1。

gold 示例：

```csv
match_id,player1_id,player2_id,runs1,runs2,pship_runs
980992,110,8,129,97,226
829800,110,8,133,76,209
548377,162,8,127,73,200
```

注意：gold 中 partnership 总分恰好等于两名球员得分之和，没有加入额外跑分。

### Baseline 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/local229/result.json`
- `.../workspace/local229.csv`

baseline 示例：

```text
C:/data-agent-eval/runs/.../local229/workspace/local229.csv:314
548377,162,8,127,73,200

C:/data-agent-eval/runs/.../local229/workspace/local229.csv:504
829800,110,8,133,76,209

C:/data-agent-eval/runs/.../local229/workspace/local229.csv:562
980992,110,8,129,97,226
```

baseline 的这些关键值与 gold 完全一致。

baseline SQL 的 `balls` CTE只连接 `batsman_scored`，个人得分和 partnership 总分均基于 batsman runs：

```sql
COALESCE(bs.runs_scored,0) AS runs
```

### Round3 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/local229/result.json`
- `.../workspace/local229.csv`

round3 示例：

```text
C:/data-agent-eval/runs/.../local229/workspace/local229.csv:319
548377,162,127,8,73,204

C:/data-agent-eval/runs/.../local229/workspace/local229.csv:505
829800,110,133,8,76,215

C:/data-agent-eval/runs/.../local229/workspace/local229.csv:563
980992,110,129,8,97,229
```

round3 新增：

```sql
COALESCE(e.extra_runs,0) AS extra_runs
```

并计算：

```sql
SUM(runs_scored) + SUM(extra_runs) AS total_runs
```

因此：

- gold `980992`: `129 + 97 = 226`
- round3: `229`，多出的 3 是 extras；
- gold `829800`: `133 + 76 = 209`
- round3: `215`；
- gold `548377`: `127 + 73 = 200`
- round3: `204`。

round3 还将列顺序写成：

```text
match_id, player1_id, player1_score, player2_id, player2_score, total_partnership_score
```

而 gold 是：

```text
match_id, player1_id, player2_id, runs1, runs2, pship_runs
```

此外 baseline 和 round3 都导出了 578 行，而 gold 是 577 行。

### 根因

round3 的 reasoning 明确进行了过度的领域解释：

> partnership total score should include batsman runs + extras

但该任务的参考合同/expected output 将 partnership 总分定义为两名球员个人得分之和。round3 添加 extras 后改变了所有受 extras 影响的结果。

这是一个明确的**数值语义回归**，不是 stochastic variation。

### 额外 baseline 风险

baseline SQL 仍有一个潜在结构问题：

- window partition 使用了 `(match_id, innings_no)`；
- 但 `partnerships` 的 `GROUP BY` 没有包含 `innings_no`；
- 这可能在不同 innings 中合并相同 group number 的 pair。

这可以解释其总行数为 578 而 gold 为 577，是 baseline 的残留风险。但就 gold 给出的关键样例而言，baseline 的个人得分和总分明显正确；round3 改动反而将样例全部改错。

### 运行状态

- baseline：`completed`，`toolErrors=1`
- round3：`completed`，`toolErrors=1`

trace 中 baseline 的错误是一次 SQL 验证中的 circular reference；round3 也有一次验证错误，但二者都最终导出了结果。错误本身不是数值回归根因。

### 判定

**P1 真回归。**

### 最小预防措施

- 对 domain metric 先以 gold/任务合同定义为准，不要擅自加入“理论上应该包括”的 extras；
- 如果总分是否包括 extras 不明确，应先验证 expected output 或保持与用户明确可见字段一致；
- 个人得分与 partnership 总分应执行一致性检查：

  ```text
  pship_runs == runs1 + runs2
  ```

  若用户没有明确要求 extras，出现不相等应视为警报；
- 导出前固定列顺序与别名。

---

## 7. local275 — Oracle SQL monthly sales seasonality

### 用户合同

用户要求：

> which products had a seasonality-adjusted sales ratio that stayed consistently above 2 for **every month** in 2017?

允许的外部业务文档明确说明：

- CMA 使用两个 12-month overlapping windows；
- ratio 为实际销售量 / CMA；
- 需要 2017 年的每个月都满足 ratio > 2。

### Baseline 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/local275/result.json`
- `.../trace.json`
- `.../workspace/local275.csv`

baseline trace 明确记录：

```text
exported 0 rows: ... local275.csv
```

baseline CSV 没有数据行。baseline `result.json` 显示：

- `status: completed`
- `toolErrors: 3`
- `csvGenerated: true`

baseline 使用窗口函数计算 CMA，并在 2017 年要求 12 个月全部满足：

```sql
HAVING COUNT(*) = 12
   AND SUM(CASE WHEN r.ratio > 2 THEN 1 ELSE 0 END) = 12
```

### Round3 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/local275/result.json`
- `.../trace.json`
- `.../workspace/local275.csv`

round3 导出：

```csv
product_id,product_name,min_ratio_2017
```

即 0 行。

round3 SQL 使用：

```sql
MIN(r.ratio) AS min_ratio_2017
...
WHERE pr.min_ratio_2017 > 2
```

这等价于要求 2017 的所有 ratio 都大于 2。

round3 trace 进一步核查了全部 10 个产品：

- 每个产品均有 12 个 2017 月份；
- 各产品的 `min_ratio` 均小于 2；
- 某些产品只在 1–3 个月超过 2，而非全部 12 个月。

### Gold 矛盾

预提取案例的 gold 是 4×1，列出：

- Hazy Pink Cloud
- Hoppy Crude Oil
- Reindeer Fuel
- 另一个产品

但 trace 中的独立验证显示：

- Reindeer Fuel 只有 3 个月超过 2；
- Hazy Pink Cloud 只有 2 个月超过 2；
- 其他候选也只有部分月份超过 2。

因此这些产品不满足“every month in 2017”。gold 更像是按“至少一个月份超过 2”或其他错误条件生成的结果。

更重要的是：

- baseline 与 round3 都输出空集；
- round3 的 SQL 比 baseline 更明确地实现了 “all 12 months”；
- round3 没有引入导致空集的实质逻辑变化。

### 判定

**无真回归；属于评分/参考答案 artifact。**

这是本批次最明确的 scoring artifact，符合任务中特别提示的 `local275`。

不应因为 pre-extracted md 标记 `Regression: True` 就将其报告为真实模型退化。实际证据表明：

- baseline 空集；
- round3 空集；
- 两者都实现 every-month 约束；
- gold 与自然语言合同冲突。

### 运行状态

- baseline：`completed`，`toolErrors=3`，成功导出 0 行；
- round3：`completed`，`toolErrors=0`，成功导出 0 行。

baseline 的工具错误是额外残余风险，但没有改变最终结果。

### 最小预防措施

- 对 `every / all / consistently / each month` 使用 `COUNT` 与 `SUM`/`MIN` 双重验证；
- 发现 gold 与自然语言矛盾时，不要为了追分改写为 “any month”；
- 对空集结果输出独立审计统计：
  - 总产品数；
  - 每个产品满足条件的月份数；
  - 最大连续/满足月份数；
- 将 benchmark reference 与业务合同冲突标记为 evaluator issue，而非模型 regression。

---

## 8. local309 — F1 driver and constructor with most points per year

### 用户合同

用户要求：

- 每年找得分最高的 driver；
- 每年找得分最高的 constructor；
- driver 要输出 full name。

gold shape：

```text
[75, 3]
year,driver,constructor
```

gold 样例：

```text
1950,Nino Farina,Alfa Romeo
1951,Juan Fangio,Ferrari
1952,Alberto Ascari,Ferrari
```

### Baseline 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-baseline-full-002/cases/local309/result.json`
- `.../workspace/local309.csv`

baseline 使用比赛结果表：

```sql
SELECT r.year AS yr, res.driver_id, SUM(res.points) AS total
FROM results res
JOIN races r ON r.race_id = res.race_id
GROUP BY r.year, res.driver_id
```

constructor 同理按 `results` 聚合。

导出开头：

```csv
year,top_driver,driver_points,top_constructor,constructor_points
1950,"Nino Farina",30,"Alfa Romeo",89
1951,"Juan Fangio",37,"Ferrari",86
1952,"Alberto Ascari",53.5,"Ferrari",120.5
1953,"Alberto Ascari",46.5,"Ferrari",122.5
1954,"Juan Fangio",57.14,"Ferrari",80.28
```

baseline 输出虽然比 gold 多了两个 points 列，但：

- 有 75 行；
- driver full name 正确；
- constructor name 在 1950–1957 也存在；
- 早期年份与 gold 样例一致。

### Round3 证据

文件：

- `C:/data-agent-eval/runs/spider2-local-improved-full-003/cases/local309/result.json`
- `.../workspace/local309.csv`

round3 改用最后一场比赛的 standings：

```sql
driver_standings
constructor_standings
```

并分别寻找 standings 最后一轮。

导出开头：

```csv
year,driver_full_name,driver_points,constructor_name,constructor_points
1950,"Nino Farina",30,,
1951,"Juan Fangio",31,,
1952,"Alberto Ascari",36,,
1953,"Alberto Ascari",34.5,,
1954,"Juan Fangio",42,,
1955,"Juan Fangio",40,,
1956,"Juan Fangio",30,,
1957,"Juan Fangio",40,,
1958,"Mike Hawthorn",42,"Vanwall",48
```

round3 造成两个可见问题：

1. 1950–1957 的 constructor 全部为空；
2. 多个年份的 driver/constructor 身份或得分与 baseline/gold 不一致，例如：
   - 1964：baseline 为 Graham Hill，round3 为 John Surtees；
   - 1951：baseline 37 分，round3 31 分；
   - 1952：baseline 53.5 分，round3 36 分。

round3 trace 自身已经验证：

```text
1950–1957 constructor_standings count = 0
```

也就是说，round3 选择的数据源天然无法满足 gold 在早期年份要求 constructor 名称的合同。

### 根因

round3 将“每年 scored the most points”重新解释为“赛季最后一轮 standings 的最终累计值”。但该评测数据中的：

- `results.points` 聚合；
- `driver_standings` 末轮值；
- `constructor_standings` 末轮值；

并不一致，尤其是早期年份 constructor standings 不存在。

baseline 使用 `results` 按赛季汇总，能够覆盖 1950–2024 的 constructor 名称，并与 gold 样例一致。round3 的“使用 standings 末轮”是一次错误的 data-source substitution。

### 运行状态

- baseline：`completed`，`toolErrors=0`
- round3：`completed`，`toolErrors=2`

round3 的两个工具错误包括缺失/不可读取的知识文件，但最终 SQL 仍能执行。工具错误不是唯一根因；主要问题是最终 SQL 选用了不适合该合同的数据源。

### 判定

**P1 真回归。**

### 最小预防措施

- “scored points”默认按明细结果表聚合，除非任务明确要求 standings；
- 当 standings 与 results 都存在时，必须验证二者在代表性年份是否一致；
- 对跨时代/早期年份任务必须检查：
  - 是否有 standings 记录；
  - 是否有 constructor championship 数据；
  - 是否会产生 NULL；
- 不要因为 standings “看起来更像最终冠军表”就替换一个已验证且与 gold 一致的 `results` 聚合方案；
- 最终输出若只要求 3 列，不要带上 driver_points/constructor_points。

---

# 跨案例根因归纳

## 1. 过度推理覆盖了明确的用户公式

典型案例：

- `local007`：组件差值被改成日历借位；
- `local229`：partnership 总分被扩展为包含 extras；
- `local309`：结果汇总被替换为 standings 末轮。

共同模式是：模型先引入“领域上更合理”的解释，再忽略任务实际给出的可执行口径或已验证结果。

## 2. 输入集合与最终输出粒度混淆

典型案例：

- `local197`：top 10 paying customers 是输入筛选条件，不是最终要输出 top 10 行；
- `local131`：每个 style 的三种 preference 统计被压缩成一个总次数；
- `local085`：用于 `HAVING` 的 total_orders 被无理由加入最终输出。

## 3. 百分比、比例与金额口径没有最终校验

- `local081`：排除折扣却应用折扣；
- `local085`：百分比输出为 0–1 ratio；
- `local229`：partnership total 与两名球员分数之和不再一致。

## 4. 参考答案与用户合同冲突时缺少 artifact 识别

`local275` 的证据非常明确：

- “every month”要求 12/12；
- 两个版本都得到空集；
- gold 却列出仅部分月份超过 2 的产品。

应将其归类为 evaluator/reference artifact，而不是为了 gold 改错 SQL。

## 5. 工具错误与业务错误没有分层

本批次中：

- `local081` baseline 有 2 个 tool errors，但结果正确；
- `local275` baseline 有 3 个 tool errors，但最终逻辑与 round3 相同；
- `local309` round3 有 2 个 tool errors，同时还存在实质数据源回归。

工具错误应单独记录，不能将“无 tool error”误判成“业务正确”。

---

# 防止同类回归的检查清单

## A. 用户合同解析

- [ ] 是否区分了“输入筛选 Top-N”和“最终输出 Top-N”？
- [ ] 用户要求 single / maximum / largest 时，是否最终只有一行？
- [ ] 用户要求 every / all / consistently 时，是否验证了完整月份/实体覆盖？
- [ ] 用户明确提供的公式是否被逐字实现，而不是替换成更复杂算法？
- [ ] 是否识别了 excluding / excluding discounts / without extras 等否定条件？

## B. 聚合与指标语义

- [ ] 金额是否为 `unitprice * quantity`，还是明确要求应用折扣？
- [ ] 百分比是否应乘 100？
- [ ] 总分是否应等于组成部分之和？
- [ ] 中间筛选列是否被误加入最终 SELECT？
- [ ] 多个独立条件是否被错误合并成一个总计列？
- [ ] 是否保留了用户要求的业务粒度，例如 style × preference position？

## C. 数据源选择

- [ ] `results`、`standings`、汇总表之间是否做过代表性年份交叉验证？
- [ ] 早期年份是否缺少 standings 或 constructor 数据？
- [ ] 是否存在同名但不同语义的扩展表？
- [ ] 是否因为“领域常识”替换了已验证的数据源？
- [ ] NULL 是否来自数据源缺失，而不是正确的业务结果？

## D. 输出 shape 与 schema

- [ ] 行数是否符合 single / per-year / per-style / per-match？
- [ ] 列数是否符合用户要求？
- [ ] 列顺序是否与合同/参考答案一致？
- [ ] 列名是否准确表达 ratio、percentage、count、total？
- [ ] 是否输出了额外诊断列、辅助金额、总订单数或 points？
- [ ] 空集时是否保留正确的 header？

## E. 数值验证

- [ ] 对标量结果，是否验证最终数值而不是只检查 SQL 能执行？
- [ ] 对百分比，是否检查 0–1 与 0–100 两种单位？
- [ ] 对每月条件，是否检查每个实体是否恰好覆盖 12 个月？
- [ ] 对 partnership，是否检查 `pship_runs = runs1 + runs2`，除非合同明确要求 extras？
- [ ] 对 top-1，是否检查排序方向、绝对值与 signed value 口径？

## F. 工具与终止行为

- [ ] 是否使用了当前后端支持的 schema 查询方式，而不是 `information_schema`？
- [ ] 工具失败后是否继续使用同一错误 SQL？
- [ ] 是否在 `export_query` 前重新确认“最后一次成功验证的 SQL”就是最终 SQL？
- [ ] 是否因工具成功就立即终止，避免后续追加不必要的分析改变结果？
- [ ] 是否记录 tool errors 与业务结果，避免将两者混为一谈？

## G. 评分 artifact 处理

- [ ] 当 gold 与自然语言合同冲突时，是否保留合同正确性证据？
- [ ] 是否检查 baseline 与 round3 是否实际产生相同结果？
- [ ] 是否避免将 pre-extracted 的 `Regression: True` 当作未经验证的事实？
- [ ] score 缺失时是否明确标记“不可从允许文件确定”，而不是臆测 round3 score？
- [ ] 是否将 evaluator/reference defect 与模型回归分开报告？

---

# 最终结论

- `local007`、`local081`、`local085`、`local131`、`local229`、`local309` 均存在由 round3 最终 SQL 或输出合同变化导致的实质回归。
- `local197` 的核心最大变化仍然正确，但 round3 将单一最大值错误扩展为 Top 10，因此存在明确的输出粒度回归；同时 gold 本身没有输出用户要求的 customer，属于部分参考答案异常。
- `local275` 不应判定为真实回归。baseline 和 round3 都正确执行了“2017 年每个月 ratio 均大于 2”，gold 列出的四个产品与该合同冲突，属于 baseline/reference scoring artifact。
- 所有案例最终状态均为 `completed`；因此本批次主要问题不是任务终止，而是：
  - 业务口径漂移；
  - 过度推理；
  - 输出 shape/单位失控；
  - 数据源替换；
  - evaluator artifact 未被识别。

## Review

- Correct:
  - `local007` baseline 的组件差值公式与 gold 数值吻合。
  - `local081` baseline 正确排除折扣。
  - `local085` baseline 的前三名及百分比单位正确。
  - `local131` baseline 保留了三个 preference position 的独立计数。
  - `local197` baseline 找到了唯一最大变化 `148 / 2005-07 / 77.83`。
  - `local229` baseline 的关键 gold 样例总分正确且未额外计入 extras。
  - `local275` baseline 与 round3 均正确实现“全部 12 个月 >2”，gold 疑似错误。
  - `local309` baseline 以 `results` 聚合覆盖了早期 constructor 年份，且与 gold 样例一致。
- Finding:
  - **P1** — `local007` round3：`.../cases/local007/result.json:finalSql.sql` 将组件差值改成日历借位，导出 `4.82`，而 baseline 为 `4.92`，gold 为 `4.923752748`。
  - **P1** — `local081` round3：`.../cases/local081/result.json:finalSql.sql` 使用 `(1 - od.discount)`，违反 “excluding any discounts”，导致 Medium/High/Very High 分组计数错误。
  - **P1** — `local085` round3：`.../workspace/local085.csv` 输出 `0.064102...` 而非 `6.410256...`，并额外输出 `total_orders`，shape 错误。
  - **P1** — `local131` round3：`.../workspace/local131.csv` 从 20×4 position-level 结果变成 25×2 总次数结果，丢失三类 preference 维度。
  - **P1** — `local197` round3：`.../cases/local197/result.json:finalSql.sql` 使用 `LIMIT 10`，将用户要求的单一最大变化扩展成十行；核心第一行仍正确。
  - **P1** — `local229` round3：`.../workspace/local229.csv:319,505,563` 将 gold 的 `200/209/226` 改成 `204/215/229`，原因是加入 `extra_runs`。
  - **P1** — `local309` round3：`.../cases/local309/result.json:finalSql.sql` 从 `results` 汇总切换到 standings 末轮，导致早期 constructor 为空及多个年份 driver/constructor 不一致。
- Artifact:
  - `local275`：`.../trace.json` 显示 baseline 与 round3 均导出 0 行；gold 的四个产品不满足 “every month in 2017”，不应将其当成模型回归。
- Merge verdict: **BLOCK**（若 round3 版本拟用于发布，至少应修复上述 P1 回归；`local275` 应单独提交 evaluator/reference artifact，而不是修改为错误的业务逻辑。）
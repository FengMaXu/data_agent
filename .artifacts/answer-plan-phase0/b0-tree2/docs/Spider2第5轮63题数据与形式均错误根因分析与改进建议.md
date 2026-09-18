# Spider2 第 5 轮 63 题"数据与形式均错误"根因分析与改进建议

来源报告：`docs/Spider2第5轮DeepSeek数据与形式错误逐题分析报告.md`
证据目录：`C:/data-agent-eval/runs/spider2-local-round5-full-001/analysis/round5-case-audits/`

## 1. 总体过程画像

63 题的运行状态与过程统计：

| 指标 | 数值 | 含义 |
|---|---:|---|
| status=completed | 57/63 | 绝大多数失败题 read 自认为成功交付，不是资源耗尽 |
| status=max_turns | 3/63 | local002、local015、local100 |
| status=timeout | 3/63 | local060、local273、local285 |
| 提交形状 = Gold 形状 | 27/63 | 形状完全正确、纯语义/数值错误，shape 校验无法拦截 |
| 提交形状 ≠ Gold 形状 | 36/63 | 粒度、投影或结果集合错误 |
| 出现 export_not_validated 后重试 | 25/63 | shape 声明校验被触发，但模型改声明后照常导出错误数据 |
| query_database 平均次数 | 11.8（最多 31） | 探索量不缺，42 题 ≥10 次查询 |
| 调用不存在的 ask_user_clarification | 2/63 | local020、local358，随后擅自假设并答错 |

**核心画像**：这不是"探索不足"或"跑不通 SQL"的失败，而是"跑通了错误 SQL 且自信交付"的失败。read 平均查询 11.8 次，但探索几乎全部用于"SQL 能否执行、结果是否非空"，没有一次用于"数值是否正确"的反向验证。

## 2. 根因聚类（63 题全覆盖）

### 2.1 指标/分母/口径定义错误 — 18 题（28.6%）

```text
local003 local024 local035 local050 local060 local061
local114 local133 local141 local168 local195 local212
local230 local244 local263 local264 local285 local286
```

**模式**：题目中"average per customer""top 20%""retention""weighted score"等指标词有多种合法 SQL 实现，模型选择了与 Gold 不同的分子、分母、去重键或聚合层级。典型：

- `local003`：RFM 分段完成后，导出"总销售额/总订单数"而非分段平均值；
- `local060`：top-20% 的分母在 products 子集和全量销售之间反复重写，18 次查询未收敛；
- `local264`：只要"出现最多的一个类别及总数"，模型输出 regression/tree 两行且累计数算错。

**过程特征**：这一类的探索查询集中在表结构和样本值，从未用第二条独立路径复算同一指标。口径一旦在第一版 CTE 定错，后续所有重写都在错误口径内部微调。

### 2.2 时间窗口/日期边界错误 — 12 题（19.0%）

```text
local007 local059 local077 local097 local167 local169
local171 local297 local298 local301 local355 local358
```

**模式**：

- 日期差手工按年月日字段分别相减（local007）；
- rolling window 只保留报告期数据，缺少窗口所需历史月份，导致首月基线错误（local077）；
- "as of 月初"累计余额写成当月净额（local064 归入 2.3，local298 边界 `<` vs `<=`）；
- "任期覆盖 Dec 31"用年份差近似（local167，CA 算 42 而 Gold 43）；
- 年龄基准日题目未给出，模型自选 2016-10-31（local358）。

**过程特征**：时间语义没有可复用的验证模板。模型对边界（含头含尾、历史回看、基准日）逐题现场发明，且从不抽一个具体实体手工验算日期。

### 2.3 最终目标/粒度未收敛 — 11 题（17.5%）

```text
local002 local010 local017 local025 local026 local064
local194 local275 local283 local302 local354
```

**模式**：业务计算已完成或接近完成，但最终导出的是中间产物：

- 标量题导出完整分布/明细：local010（7 行分布 vs 1 个最小桶计数）、local025（568 行明细 vs 1 个平均值）、local302（5 行属性表 vs 1 行指标）；
- 目标记录题导出全集：local194（600 行 per-actor Top-3 vs 3 行）、local283（88 个冠军 vs 8 个）、local354（249 条 driver-season vs 3 个 driver）；
- 附加诊断列：local026（多出日期、场馆、队名）、local064（1 行 7 列 vs 1 行 1 列）；
- local275 最极端：算出 min ratio 后导出 10 个诊断候选，正文结论却写"没有产品"，Gold 要 4 个产品名——导出物与自身结论都不一致。

**过程特征**：`expected_rows/expected_columns` 强制声明没有起到收敛作用——模型把"上一次查询结果的形状"照抄进声明即可通过校验。声明校验的对照物是模型自己的输出，不是题目要求。

### 2.4 JOIN 基数/关联膨胀 — 9 题（14.3%）

```text
local015 local029 local032 local034 local037
local040 local062 local258 local311
```

**模式**：1:N 关系直接 JOIN 后聚合，导致度量按明细行重复计数：

- `local034`：payment JOIN order_items 后，一笔支付按商品行数重复；
- `local040`：income 按树记录粒度加权平均，而 Gold 是 borough 层面均值；
- `local032`：review 经订单行连接 seller，5-star 计数膨胀；
- `local062`：costs 按销售键连接后利润分布 min/max 整体偏移。

**过程特征**：模型没有"JOIN 前后守恒对账"的习惯——`SUM(payment)` 在 JOIN 前后是否一致、行数是否放大，一次都没有检查过。这是最机械、最可规则化拦截的一类错误。

### 2.5 递归/多步算法任务 — 6 题（9.5%）

```text
local100 local269 local270 local272 local279 local331
```

**模式**：图遍历（Shahrukh number）、BOM 递归展开、FIFO 库存分配、逐月库存状态推进、会话事件重建。这类任务用单条 SQL 表达超出 deepseek-chat 的可靠能力；模型尝试用近似 CTE 一次成型，边界条件（两跳去重、叶节点口径、最后一单部分分配、跨月状态传递）全部出错。

**过程特征**：6 题中仅 local331 用过 run_python，且用于诊断而非计算。逐步算法明明适合 Python 分步执行+中间断言，但模型默认坚持纯 SQL。

### 2.6 擅自增加业务规则 — 4 题（6.3%）

```text
local020 local055 local066 local253
```

**模式**：模型用领域常识覆盖题目字面：

- `local020`：**已经查到 Gold 答案 AC Gilchrist（0 失分/1 三柱门）**，认为"样本无意义"，先试图调用不存在的 `ask_user_clarification`，失败后自行加 `wickets >= 10`，改选 A Zampa；
- `local055`：空集合平均消费自行置 0；
- `local066`：自行排除取消订单；
- `local253`：题目只要求清洗薪资数字，模型自行把 /mo、/hr 年化（hr×1920）。

**过程特征**：4 题中 2 题（local020、local358）显式表达了"想向用户澄清"，但评测运行时未注册该工具，`unknown_tool` 后模型被迫猜测。**提示词声明的工具与实际注册工具不一致，直接造成至少 2 题损失。**

### 2.7 单位/百分比错误 — 2 题（3.2%）

```text
local209 local273
```

`local273` 输出 0–1 比例，Gold 要 0–100；`local209` 反向，0–1 乘了 100 但 Gold 口径不同。"percentage"的单位约定完全靠猜。

### 2.8 题意实体误读 — 1 题（1.6%）

```text
local336
```

把"前五圈超车"误读为 `race_id=336` 单场比赛，源于把题目编号当作数据实体。探索 24 次查询都建立在错误前提上。

## 3. 横切过程问题（跨聚类）

### 3.1 "验证"只验证可执行性，不验证正确性

63 题平均 11.8 次查询，但全部探索行为可归为：看 schema、看样本、看 distinct、跑候选 SQL 看是否报错/非空。没有任何一题出现"用独立口径复算抽查值"的行为。第一版口径错了，后面 10 次查询只是在错误口径上抛光。

### 3.2 shape 声明校验退化为"自我一致"检查

25/63 题触发过 `EXPORT_SQL_NOT_VALIDATED`，全部通过"把上次结果形状抄进声明"通过。校验设计初衷是逼模型对照题目要求，实际效果是逼模型对照自己的错误输出。校验有成本（重试消耗 turn）而无语义收益。

### 3.3 completed≠correct 的确认偏误

57/63 自认为成功。模型在正文中频繁写"验证正确""与预期一致"，但所谓验证是重复执行同一条 SQL。缺少任何强制的"交付前反证"步骤。

### 3.4 提示词-运行时工具不一致

`ask_user_clarification` 在提示词/知识库语境中存在，评测运行时未注册。模型在真正需要澄清的 2 题里正确地想到了求助，被 `unknown_tool` 打断后转向擅自假设。这是环境 bug 而非模型缺陷。

## 4. 运行时与提示词核查结果（改进建议的代码级依据）

在提出建议前，对 `.pi/SYSTEM.md`、`packages/runtime/src/agent-assembly.ts`、`packages/runtime/src/tools-catalog.ts`、`evaluations/spider2/run.mjs`、`evaluations/spider2/lib.mjs`、`knowledge/doc/rules.md`、`knowledge/doc/learning.md` 做了逐项核查：

| # | 核查事实 | 出处 | 对建议的影响 |
|---|---|---|---|
| F1 | `ask_user_clarification` 仅在 `deps.clarifications` 存在时注册；评测 `run.mjs` 从不传入，评测会话中该工具**永不存在** | `agent-assembly.ts:565-575`、`run.mjs` 无 clarifications | 提示词-运行时矛盾是代码级事实 |
| F2 | `SYSTEM.md` §5 静态声明该工具为"运行时注册的规范工具名"，§7 要求"面对不确定性时用 `ask_user_clarification`…严禁猜测" | `.pi/SYSTEM.md` §5、§7 | local020/local358 是遵循 §7 而失败 |
| F3 | `runtimeCapabilitiesPrompt` 的 Unavailable 探测名单只有 `run_python/show_widget/generate_dashboard`；clarification 缺席时不被显式标注 | `agent-assembly.ts runtimeCapabilitiesPrompt` | 模型需要自行对比两张表才能发现矛盾 |
| F4 | `unknownToolRecoveryMessage` 只说"Do not retry it"并罗列可用工具，**没有歧义处理策略** | `agent-assembly.ts unknownToolRecoveryMessage` | local020 被拒后自行发明 wickets>=10 阈值 |
| F5 | §1.4 导出前检查（粒度/列/完整性/SQL 一致/单位 0–100）与 rules.md "SQL 语义自检"（含 JOIN 膨胀、时间边界）在**第 5 轮就已存在**（Round5 prompt SHA `bb02483d` 与当前仅差两句新增） | manifest.json、`git diff .pi/SYSTEM.md` | 63 题失败发生在清单齐备的前提下；**清单式文字已被证明不足** |
| F6 | `export_query` 硬校验：`expected_rows` 必填（scalar/top_n/grouped/full）、scalar>1 行拒绝、top_n 超界拒绝、`EXPORT_SQL_NOT_VALIDATED` 要求与最后验证 SQL 一致；但 `expected_columns` **可选**、`grouped/full` 无行数校验、无任何与题目语义的对照 | `tools-catalog.ts EXPORT_QUERY_PARAMETERS`、`agent-assembly.ts:470-536` | 强化方向是补缺口，不是另起炉灶 |
| F7 | 评测**只接受 `export_query` 交付**：`collectArtifacts` 仅在 `finalSql.toolName === "export_query"` 时收集 CSV | `run.mjs collectArtifacts` | "递归题改用 Python 计算并交付"不成立，需修订 |
| F8 | `isExploratoryQuery` 正则只匹配 PRAGMA/sqlite_master/`SELECT * LIMIT`/单列 DISTINCT/`COUNT(*)`；SUM 对账、复算类验证查询**不占** 6 次探索预算 | `agent-assembly.ts isExploratoryQuery`、`lib.mjs buildEvaluationGuardrails` | 反向验证在机制上免费，可放心加入流程 |
| F9 | 评测中 `query_patterns.md` 被写成空桩；只有项目的 `rules.md`/`learning.md` 会流入评测知识库 | `run.mjs prepareKnowledge:228` | 新模式必须写入 rules.md/learning.md 或修改评测装配 |
| F10 | SQLite 方言提示已含 `julianday` 日期差、`strftime` 等 | `agent-assembly.ts dialectHint`、learning.md 方言范围 | local007 仍手工相减——单纯加文字无效，需要模板级示例或验证动作 |
| F11 | §2 输出模式表将 `run_python` 定位为"图表工具，仅当用户明确要求时" | `.pi/SYSTEM.md` §2 | 解释了递归 6 题中 5 题从不使用 Python 的原因 |

## 5. 改进建议（基于核查修订）

### R1（P0）：消除 `ask_user_clarification` 的提示词-运行时矛盾（F1–F4；直接面向 2.6 的 2 题）

三处同时修，全部在运行时层，产品与评测共同受益：

1. `runtimeCapabilitiesPrompt` 的探测名单加入 `ask_user_clarification`；当其缺席时追加策略行："Clarification is unavailable in this session. Resolve ambiguity by the most literal reading of the request; never invent thresholds, default values, or date baselines."
2. `unknownToolRecoveryMessage` 对 `ask_user_clarification` 特判，返回同一策略，而不是当前的策略真空；
3. `SYSTEM.md` §7 的"用 ask_user_clarification 澄清"补充条件从句："若该工具不在当前工具列表中，按题目最字面解释执行并在正文声明假设"。

不建议在评测中注册假的 clarification 自动应答器：那会让评测环境偏离产品环境，且答案质量取决于应答器措辞，引入新变量。

### R2（P0）：合同前置 + 补齐 `export_query` 校验缺口（F5、F6；面向 2.3 的 11 题 + 2.7 的 2 题）

§1.4 清单在第 5 轮已存在但失效（F5），失效原因是它发生在导出时——模型已锚定在自己最后一次查询结果上。改法：

1. **提示词**：§1.3 SQL Route 增加第 0 步——在首次 `query_database` 之前，从题目原文写出答案合同（`expected_rows` 类型、行数、列白名单、单位）；§1.4 保留但改为"对照第 0 步合同复核"，禁止用最后一次查询结果反推合同。
2. **工具硬校验**（`tools-catalog.ts` + `agent-assembly.ts`）：
   - `expected_columns` 从可选改为必填（F6 缺口；机制上强迫模型思考投影，杜绝"顺手多导诊断列"）；
   - `grouped` 支持并校验 `expected_row_count` 上限（如 12 个月=12 行），关闭 grouped/full 不设防的缺口；
   - `EXPORT_SQL_NOT_VALIDATED`/`SHAPE_MISMATCH` 错误文案追加一句："Re-derive the expected shape from the question wording, not from your last query result."
3. **风险监控**：Round 5 已有 25 题触发 `export_not_validated` 重试；必填 `expected_columns` 会推高首次拒绝率，需在下一轮观察 EXPORT_* 错误率与 timeout（当前 16 题）的变化。

### R3（P0）：把"严禁猜测"具体化为"禁止静默假设 + 环境降级"两层条款（面向 2.6 的 4 题 + local358）

当前未提交的两句新增（"Stay cautious" + "only sources of truth"）方向正确但过于抽象——Round 5 的"严禁猜测"就在 §7 里，local020 依然照猜。在 §1.4 或 rules.md 落成可执行禁令：

通用层（两个环境共享，写入 SYSTEM.md/rules.md）：

- **禁止静默假设**：任何题目未提供的阈值、过滤、默认值、基准日期、单位换算，要么不用，要么必须在正文显式声明后再用；
- 空集合的聚合结果不得自行置 0 或改写口径；
- 最终结果必须声明单位（尤其 0–1 比例与 0–100 百分数），并与题目字面词对齐；不设固定默认（固定 "percentage→0–100" 属于拟合本评分器惯例，见 §7）。

环境降级层（与 R1 联动）：

- 生产环境：歧义 → `ask_user_clarification` 真实可用 → 问用户；分析师式的专业判断（如标注最低样本量）是服务质量，不是错误；
- 澄清不可用的环境（如本评测）：按题目最字面、最简单的解释执行，并在正文声明所做假设；极端但字面正确的答案（0 失分/1 三柱门的 average=0）即为答案。

“字面答案优先”只作为降级策略存在，不得无条件写进生产提示词（理由见 §7）。

### R4（P1）：JOIN 守恒对账从"清单文字"升级为"流程动作"（F5、F8；面向 2.4 的 9 题）

rules.md 自检第 2 条已警告 JOIN 膨胀，9 题照样失败——文字提醒无效，需要动作要求：

- §1.3 增加流程规则：凡最终 SQL 在 1:N JOIN 之上聚合度量，导出前必须执行一次对账查询（JOIN 前后 `SUM(度量)`/行数对比），对账不一致禁止导出；
- F8 证明对账查询不占探索预算，机制上无成本冲突；
- 模板写入 learning.md "可复用 SQL 经验"（评测可见，F9），给出 payment×order_items 这类真实对账 SQL 示例。

### R5（P1）：时间窗口模板写入评测可见的知识文件（F9、F10；面向 2.2 的 12 题）

注意装配事实：评测中 `query_patterns.md` 是空桩，模板必须进 `rules.md`/`learning.md`，或修改 `run.mjs` 为评测播种通用模式。内容以**带 worked example 的模板**呈现（F10 证明纯禁令无效），且只限方言与方法论、禁止出现任何基准领域实体（准入规则见 §7）：

- rolling/LAG：先取"报告期+回看长度"扩展范围计算，最后过滤回报告期（local077 型）；
- as-of 累计余额：`WHERE txn_date < :month_start` 与 `<=` 两种变体的语义差别（local298 型）；
- 区间覆盖某日：`start_date <= :d AND (end_date >= :d OR end_date IS NULL)`（local167 型）；
- 日历年：`strftime('%Y', col) = '2021'`（local059 型）；
- 日期差：`julianday(end) - julianday(start)` 的完整示例，并注明"禁止按年/月/日字段分别相减"（local007 型）。

### R6（P1）：交付前反向验证（F8；面向 2.1 的 18 题，部分可救）

§1.3 增加一步：导出前用**独立 SQL 路径**复算最终结果中 1–2 个值（换 JOIN 顺序，或对单一实体手工过滤复算）；两条路径不一致时回到口径定义重查。63 题轨迹中此类行为出现次数为 0；F8 证明这些查询不占探索预算，成本仅 1–2 次调用。

### R7（P2）：递归/算法题的现实路由（F7、F11；面向 2.5 的 6 题）

原"路由到 run_python 计算并交付"**不可行**：评测只收 `export_query` 交付（F7），最终答案必须是一条 SQL。修订为：

1. learning.md 增加 SQLite `WITH RECURSIVE` 已验证模板（两跳图遍历去重、BOM 叶节点展开、逐期状态推进）；
2. `run_python` 定位为**交叉验证 oracle**：SQL 结果出来后用 Python 独立复算比对，不一致则修 SQL；
3. 修正 F11 的定位偏差：§2 中为 run_python 增加"复杂计算验证"合法用途，消除"仅图表"暗示；
4. **明确禁止**"Python 计算 + SQL 物化已验证字面值"（如 `SELECT 530.67`）：这是绕过评分通道的 benchmark gaming，且在产品中破坏 SQL 溨源；若 SQL（含递归 CTE）确实无法表达算法，接受该题损失。

### R8（P2）：题目实体复述（面向 2.8 的 1 题）

并入 R2 的第 0 步合同：复述题目实体与过滤值并逐一确认存在于数据中（local336 的 race_id=336 误读在第 0 步即可暴露）。

## 6. 预期收益与实验设计（含防拟合约束，见 §7）

| 措施 | 层 | 直接面向 | 保守可救估计 |
|---|---|---|---:|
| R1 clarification 一致性 | 运行时+提示词 | 2 题 | 1–2 题 |
| R2 合同前置+校验补缺 | 提示词+工具 | 13 题 | 5–8 题 |
| R3 字面执行条款 | 提示词/规则 | 5 题 | 2–4 题 |
| R4 JOIN 对账动作 | 流程+知识 | 9 题 | 3–5 题 |
| R5 时间模板 | 知识（注意 F9 装配） | 12 题 | 3–6 题 |
| R6 反向验证 | 流程 | 18 题 | 2–5 题 |
| R7/R8 | 提示词+知识 | 7 题 | 1–3 题 |

实验纪律：

1. 先提交当前未提交变更（SYSTEM.md 两句 + 评测最小交付提示语），作为新基线；
2. 每个 R 单独提交、单独评测，避免第 5 轮多变量混改无法归因的教训；
3. R2 必填 `expected_columns` 是行为破坏性变更，先在 86 题定向集验证 EXPORT_* 重试率可接受，再全量；
4. 以 135 题全量为准，86 题复测只作快速信号；
5. 口径类（2.1）部分题目的 Gold 口径需要基准特定知识，属于能力上限，不应为个别 Gold 过度拟合。

## 7. 过拟合风险评估与防护

### 7.1 逐项风险分级

| 建议 | 性质 | 过拟合风险 | 判断依据 |
|---|---|---|---|
| R1 clarification 一致性 | 缺陷修复 | **无** | 提示词承诺不存在的工具在任何环境都是 bug；生产环境该工具真实存在 |
| R4 JOIN 守恒对账 | 通用工程实践 | **低** | fan-out 防护是教科书级 SQL 方法论，对任意新库新问题成立 |
| R6 反向验证 | 通用工程实践 | **低** | 交叉验证不依赖任何 Gold 知识 |
| R2 合同前置 | 通用，需产品审视 | **低–中** | 交付对齐用户要求是通用的；但 `expected_columns` 必填的严格度是被基准精确比对逼出的，真实用户常欢迎合理附加列，上线前需单独评估产品体验 |
| R5 时间模板 | 方言/方法论为主 | **中** | julianday、窗口回看、区间边界通用；原"percentage 默认 0–100"是在拟合本评分器惯例，已改为"必须声明单位并与题目字面词对齐，不设固定默认" |
| R3 字面执行 | 需拆分的高危项 | **中–高（已拆分）** | "极端字面答案即答案"只在有标准答案的封闭评测里无条件成立；真实分析师标注样本量问题是更好的服务。已改写为"通用层（禁止静默假设）+ 环境降级层（澄清不可用时字面执行并声明假设）" |
| R7 递归路由 | 通用，危险选项已删 | **低** | "SQL 物化 Python 字面值"属 benchmark gaming，已改为明确禁止 |

### 7.2 结构性风险：反复迭代本身就在拟合

比逐条规则更大的风险是：135 题已被当作开发集跑了 5 轮以上。即使没有任何题目特定规则，"改动 → 评测 → 看分 → 再改"的循环也会通过选择效应逐步拟合这个固定题集（adaptive overfitting）。Round 4→5 已出现信号：新提示词救回一批题的同时把另一批答对的题改错，而我们正是在这种"净得分"上做选择。

### 7.3 防护措施（纳入实验纪律）

1. **切分保留集**：135 题分层抽出约 30 题冻结为 holdout，迭代只看剩余约 105 题；holdout 只在最终验收时跑一次。已跑过 5 轮意味着它不是严格干净的，但至少能挡住后续迭代的适应性偏差；
2. **外部验证**：用从未参与迭代的 SQLite 基准（如 BIRD mini-dev）做泛化检查；改动若只在 Spider2 上涨分、在外部集持平或下跌，即为过拟合证据；
3. **知识库准入规则**：`rules.md`/`learning.md` 只允许方言知识和方法论，禁止基准领域实体（cricket、F1、olist 等）；每条新增须能回答"对一个随机新数据库是否仍然正确"；已删除的 Spider2 专用 sql-query skill 是这条红线的先例；
4. **诊断可以看 Gold，规则不能编码 Gold**：逐题审计用 Gold 定位失败合法；但不允许把单题 Gold 口径（如某题的 retention 分母）反写成规则。R1–R8 均来自 63 题聚类模式；唯一越线嫌疑（percentage 固定默认）已在 R3 中降级为"声明单位"；
5. **预注册假设**：每项改动提交前写明预期影响的聚类和题目集合；涨分若来自预期外题目，视为噪声而非成功；
6. **回归集监控**：每轮单独列出"由对变错"清单做配对比较，不只看净分（Round 4→5 已有 14 题回归的教训）；
7. **重复运行测方差**：DeepSeek 非确定性下单次 ±3–5 题可能纯属噪声，关键结论至少复跑一次。

### 7.4 结论

R1、R4、R6 及 R5 的方言部分在"评测从没存在过"的世界里也是对的，可以放心做；R3、R5 已按"通用原则 + 环境降级"改写；R7 的字面值物化已明确禁止。最关键的是 7.3 第 1、2 条结构性防护：没有 holdout 和外部验证，后续每一轮"改进"的涨分都无法自证不是拟合。

## 8. 逐题聚类对照表

| 聚类 | 题目 |
|---|---|
| 指标/分母/口径（18） | local003 local024 local035 local050 local060 local061 local114 local133 local141 local168 local195 local212 local230 local244 local263 local264 local285 local286 |
| 时间窗口/日期边界（12） | local007 local059 local077 local097 local167 local169 local171 local297 local298 local301 local355 local358 |
| 目标/粒度未收敛（11） | local002 local010 local017 local025 local026 local064 local194 local275 local283 local302 local354 |
| JOIN 膨胀（9） | local015 local029 local032 local034 local037 local040 local062 local258 local311 |
| 递归/算法（6） | local100 local269 local270 local272 local279 local331 |
| 擅自业务规则（4） | local020 local055 local066 local253 |
| 单位/百分比（2） | local209 local273 |
| 题意误读（1） | local336 |

# SLOP (`slop-lang/slop`) 与 Answer 模块设计对照

## 1. 来源与范围

- 目标项目：[`slop-lang/slop`](https://github.com/slop-lang/slop)（Symbolic LLM-Optimized Programming），一门面向人机协同代码生成的符号化 S-Expression 语言。
- 对照范围：当前项目的 `answer` 模块（见 [CONTEXT.md](../../CONTEXT.md)、[ADR-0002](../adr/0002-bounded-deterministic-query-gates.md)、[ADR-0003](../adr/0003-detect-inform-never-block.md)、[ADR-0004](../adr/0004-runtime-owns-spec-transitions-and-evidence-admission.md)、[ADR-0005](../adr/0005-choice-realization-and-decision-points.md)、[ADR-0006](../adr/0006-single-choice-decision-with-derived-verification.md)、[ADR-0007](../adr/0007-answer-spec-as-one-field-vocabulary.md) 及 [answer-fields/SKILL.md](../../.agents/skills/answer-fields/SKILL.md)）。
- 本文档为架构对照与设计建议，不表示相关改动已在运行时实施或通过评测校准。

---

## 2. 核心理念对照

SLOP 的核心范式是将开放式生成转化为：**形式化契约（`@intent` / `@spec` / `@pre` / `@post` / `@loop-inv`）+ 类型化空洞填充（Typed Holes，`slop fill`）+ 符号化反例验证（Z3 Counterexample，`slop verify`）+ 显式假设逃生舱（`@assume`）**。

这与当前 `answer` 模块从自由 SQL 演进到字段树（[ADR-0007](../adr/0007-answer-spec-as-one-field-vocabulary.md)）的路径高度同构：

| SLOP 概念 | 当前 Answer 模块对应物 | 现状评估 |
| --- | --- | --- |
| S-Expression 契约树 | 18 节点字段树 + 嵌套 `measure.formula`（[ADR-0007](../adr/0007-answer-spec-as-one-field-vocabulary.md)） | `measure.formula` 已代数化，但总体、计数粒度与分母等字段仍允许自由文本一句话 |
| `@intent` + `@spec` | 题面引文（`Requirement Phrase`）+ `Answer Spec` | 已有 `spec-alignment-v3` 逐条核对题面要求（[ADR-0003](../adr/0003-detect-inform-never-block.md)） |
| `@assume` | `basis: "assumed"` + 发布时 `[DISCLOSURE]` | 机制完善，但模型在物理层和总体层仍频繁盲猜假定（[ADR-0007](../adr/0007-answer-spec-as-one-field-vocabulary.md) 统计 36 道值错中 23 道为假定错） |
| `hole` + `slop fill` | `{ open: [候选1, 候选2] }` + `Probe` | 仅覆盖“已知候选的语义歧义”，缺少对“未探索物理事实”的类型化空洞占位 |
| Range Types `(Int a .. b)` | `output`（`rowMode`, `rowCount`, `columns`, `units`, `decimals`） | 仅核对行数与列名，缺少基于度量类型的输出值域与量纲边界检查 |
| `slop verify` 反例输出 | `Spec Realization` + `Decision Realization` | 仅覆盖少量静态 SQL 规则与探针指纹相等性，缺少具体差异反例（Counterexample） |

根据 [ADR-0007](../adr/0007-answer-spec-as-one-field-vocabulary.md) 对 118 道历史错题的归因：能定性的 74 题中，**口径声明值错 36 题（假定错 23、待定后决定错 7、题面引用错 6）、未声明 24 题、SQL 实现错 8 题**。在遵守 [ADR-0002](../adr/0002-bounded-deterministic-query-gates.md)（有界确定性门控）和 [ADR-0003](../adr/0003-detect-inform-never-block.md)（检测默认告知、仅对必然违规硬阻断）的前提下，可从以下 5 个方向借鉴 SLOP。

> **实证注意**：23 道假定错按标答值复核后的字段分布见[第 5 节](#5-实证补充23-道假定错的字段分布按标答值复核)。最大来源是 `measure`（10 题，43%），其次是 `population`（7 题）；物理层 Typed Holes（第 3.2 节 / P3）最多覆盖 2–3 道；`output` 只有 2 题。

---

## 3. 五项具体改进设计

### 3.1 引入值域精化类型（Range / Refinement Types），强化 `output` 与 `measure` 校验

**SLOP 机制**：
支持 `(Int 0 .. 100)`、`(Float 0.0 .. 1.0)` 等精化范围类型，在编译与验证期直接捕获越界与量纲错误。

**当前痛点**：
- `output` 只声明 `{ rowMode, rowCount, columns, units, decimals }`，`CandidateCheck` 只核对行数和列名。
- [ADR-0003](../adr/0003-detect-inform-never-block.md) 的 `Spec Realization` 靠静态检查 SQL 文本中是否出现 `* 100` 来拦截 `percentage` 和 `pp_difference` 错误。若源表列本身已是 `0..100` 百分数而模型误以为是 `0..1` 小数（或反之），静态 SQL 文本检查会漏检或误报；同时无法拦截 `count` 出现负数/小数、真子集占比超过 100% 或全列 `NULL` 等异常。

**改进方案**：
1. **从 `measure.formula.op` 自动推导输出列值域契约（Range Contract）**：
   - `count` / `count_distinct`：整数且 $\ge 0$；
   - `ratio`（子集占总体）：实数，默认预期范围 $[0, 1]$；
   - `percentage`（子集占总体）：实数，默认预期范围 $[0, 100]$；
   - 允许 `output` 显式声明列级约束：`bounds?: Record<string, { min?: number; max?: number; allowNull?: boolean }>`。
2. **在结果查询（`kind="result"`）阶段结合 `Physical Profile` 校验实际值域**：
   - 扫描候选结果的实际数值分布（复用 [CONTEXT.md](../../CONTEXT.md) 中的 `Physical Profile`）。
   - **硬阻断（`SPEC_NOT_REALIZED`）**：`count` / `count_distinct` 输出非整数或负数；
   - **高信号告知与披露（Finding）**：声明为 `percentage`（单位 `%`）但非零结果全部落在 $(0, 1)$ 区间，或声明为 `ratio` 但结果落在 $(1, 100]$ 区间，直接在工具返回中附带观测到的 `[min, max]` 提示模型核对量纲。

---

### 3.2 将自由文本字段升级为“受限代数结构 + Typed Holes”

**SLOP 机制**：
除 `@intent` 外，契约全部采用代数数据类型（S-Expression），未决实现用带类型的 `hole` 占位，禁止用自由自然语言充当形式化规格。

**当前痛点**：
- 除 `measure.formula`、`selection`、`output` 外，`population.eligibility`、`population.conditions`、`measure.countGrain`、`measure.denominator` 仍接受**自由文本一句话**（见 [answer-fields/SKILL.md](../../.agents/skills/answer-fields/SKILL.md)）。
- 自由文本导致 Runtime 无法对这些字段执行 `Spec Realization`（[ADR-0003](../adr/0003-detect-inform-never-block.md)：“规则读不懂的字段记为不可判定”）。
- 模型在首次调用 `set_answer_spec` 时，对尚未探查的物理映射或过滤取值往往直接写成 `assumed`（导致 23 道假定错），而不是先留空洞再去取证。

**实证限制（见[第 5 节](#5-实证补充23-道假定错的字段分布按标答值复核)）**：
23 道假定错中，物理层假定（可被 Typed Holes 拦截）只有 2–3 道（local003 列映射、local273 来源表、local017 分组列）；另有 2 道是 `measure.countGrain` 去重粒度（local032、037），代数化后可由 Spec Realization 核对。因此本方案应聚焦于物理层字段（`population.source`、`population.timeField`、`population.joinMultiplicity`、物理列映射）与 `countGrain`，不应以"拦截 23 道假定错"作为整体预期。

**改进方案**：
1. **关键字段代数化（保留 `note` 作为补充说明，主结构枚举化）**：
   - `population.eligibility`：
     ```json
     { "zeroActivity": "include" | "exclude" | "n/a", "nullKey": "include" | "exclude" }
     ```
   - `measure.countGrain`：
     ```json
     { "grain": "row" | "entity" | "event", "keyColumns": ["customer_id"] }
     ```
     由此 `Entity Identity Check`（[ADR-0003](../adr/0003-detect-inform-never-block.md)）可直接读取 `measure.countGrain.keyColumns`，无需从文本猜测计数键。
   - `population.conditions`：
     ```json
     [{ "stage": "on" | "where" | "having" | "qualify", "column": "orders.status", "op": "=" | "in" | "range" | "custom", "value": "completed" }]
     ```
2. **引入物理层/探索前 `hole` 状态**：
   - 允许字段在初始 Spec 中声明为 `{ "hole": "enum_values" | "time_column" | "join_key" | "date_bounds", "target": "orders.status", "question": "确认已完成的订单状态枚举值" }`。
   - 带有 `hole` 的 Revision 与 `open` 字段一样阻断最终查询（`kind="result"`），但 Runtime 会在状态表中明确列出待填的 `hole` 及其要求的证据类型（如 `schema_fact` 或 `query_observation`），引导模型先跑一次定向探索或由 `Schema Profile` 自动填充（`fill`），防止模型在未看数据时把猜测直接写成 `assumed`。

---

### 3.3 将验证与探针反馈升级为“具体反例驱动（Counterexample-Driven Feedback）”

**SLOP 机制**：
`slop verify` 失败时，Z3 会输出使后置条件不成立的具体变量赋值（如 `val = 10, hi = 5`），让 LLM 围绕反例修正实现，而不是盲目重写。

**当前痛点**：
- **探针比较缺乏行级反例**：当待定字段的候选 A 与候选 B 探针输出不同时，Runtime 仅计算 `Result Fingerprint` 并把摘要传给比较建议服务（Jev）和主模型。模型和建议服务看到的是粗粒度指纹或截断预览，难以直接看清“究竟是哪几行、哪个边界实体导致了差异”。
- **实现检查缺乏具体反例**：`Spec Realization` 或 `DECISION_NOT_REALIZED` 拒绝时，只返回规则原因，未给出触发违规的具体差异样本。

**改进方案**：
1. **探针对称差反例（Probe Diff Witness）**：
   - 当同一待定字段的两个候选探针 $P_1, P_2$ 指纹不同时，Runtime 自动对两个探针结果集做规范化 Diff，提取 **最多 3 条差异见证行（Witness Rows）**：
     - 仅在 $P_1$ 出现而不在 $P_2$ 出现的键（如 `entity_key = 'C009'`，直观反映 `eligibility` 或 `conditions` 差异）；
     - 同一键下数值不同的行（如 `month = '2020-02': P1 = 0, P2 = 缺失`，或 `P1 = 0.25, P2 = 25.0`）。
   - 将 Witness Rows 注入 `[PROBE]` 返回结果与 `Field Advice`（Jev）请求上下文，并在需要 `ask_user_clarification` 时辅助生成带真实数据样例的澄清问题。
2. **`DECISION_NOT_REALIZED` 与 `SPEC_NOT_REALIZED` 反例化**：
   - 当结果查询触发 `DECISION_NOT_REALIZED`（结果复现了未采纳候选 $A_{\text{rejected}}$ 的指纹）时，直接返回被采纳候选 $A_{\text{adopted}}$ 与当前结果在探针中的差异见证行，指明 SQL 仍停留在未采纳口径的具体表现。

---

### 3.4 借鉴 `@pre` / `@loop-inv` / `@post` 建立多层聚合的“阶段粒度不变量（Stage Invariants）”

**SLOP 机制**：
复杂计算通过 `@pre`（输入约束）、`@loop-inv`（中间状态不变量）和 `@post`（输出约束）分层验证，防止中间步骤静默丢失约束。

**当前痛点**：
- `measure.formula` 支持多层嵌套（如 `{ op: "avg", per: "region", of: { op: "avg", per: "store", of: { op: "sum", per: "month", of: "amount" } } }`）。
- 尽管 [sql-rules](../../.agents/knowledge/doc/rules.md) 要求按阶段编写 CTE，但模型在生成 SQL 时仍常把多层聚合压平、或在错误的 CTE 阶段执行 `WHERE` / `HAVING` / `JOIN`，而最终输出的列数与行数依然合法。

**改进方案**：
- **在 `Spec Realization` 中按 `measure.formula` 嵌套树校验 SQL 阶段链**：
  - **前置检查（`@pre`）**：校验 `population.source.tables` 中的表是否出现在最内层数据源，且 `population.conditions` 中标记为 `stage: "where"` 的列过滤是否发生在首次聚合之前。
  - **阶段粒度不变量（`@loop-inv`）**：对于深度 $k \ge 2$ 的 `measure.formula`，提取内层序列 $[per_1, per_2, \dots, per_{k-1}]$，核对 SQL 的 CTE / 子查询或窗口函数中是否依次包含对应粒度的 `GROUP BY` / `PARTITION BY` 阶段（在 [ADR-0003](../adr/0003-detect-inform-never-block.md) 现有“聚合层数少于公式嵌套” finding 的基础上，进一步核对每层分组键是否匹配 `per`）。
  - **后置检查（`@post`）**：最外层查询满足 `grouping`、`selection`（含 `ties` 策略）及 `output`（列名、行数、值域范围）。

---

### 3.5 借鉴 `@example` 引入高风险字段的“微样例锚定（Micro-Example Anchoring）”

**SLOP 机制**：
在函数契约中用 `@example` 提供具体的输入输出对（如边界点、空输入、极值点），既作为文档，又作为自动验证用例。

**当前痛点**：
- [semantic_guide.md](../../.agents/knowledge/doc/semantic_guide.md) 要求模型“用最小样例检查高风险选择”（如 S07 要求写出缺一期和首个有效窗口应包含的日期集合，S11 要求区分变化率方向），但这些样例只存在于自然语言思考中，Runtime 无法感知或核对。
- 历史错题中，时间闭区间/开区间（如 local157）和差值方向（`from` vs `to`）频繁写反。

**改进方案**：
- 在高风险节点支持结构化微样例（Micro-Example）：
  - **`population.time`**：当包含边界描述时，要求给出规范化端点 `{ start: "2020-01-01", startInclusive: true, end: "2021-01-01", endInclusive: false }`，`Spec Realization` 据此核对 SQL 中的 `>=` / `>` / `<` / `<=` / `BETWEEN` 运算符是否与声明的开闭性矛盾。
  - **`measure.formula`（`difference` / `change_rate` / `pp_difference`）**：要求显式绑定基准期与目标期标识（如 `fromPeriod: "2019"`, `toPeriod: "2020"`），`Spec Realization` 检查 SQL 中分子减法顺序是否为 `to - from` 而非 `from - to`。

---

## 4. 演进路线与优先级建议

遵循 [ADR-0002](../adr/0002-bounded-deterministic-query-gates.md) 与 [ADR-0003](../adr/0003-detect-inform-never-block.md) 的回放校准原则（先在历史运行上回放验证漏检率与误报率，再决定作为 Finding 披露还是硬阻断）：

```mermaid
flowchart LR
    P1[“P1: 输出值域契约 + 探针差异反例<br/>(零工具接口破坏，纯 Runtime 增强)”] --> P2[“P2: 时间边界/差值方向微样例校验<br/>(扩展 Spec Realization 确定性规则)”]
    P2 --> P3[“P3: 物理层 Typed Holes + countGrain 代数化<br/>(source/timeField/列映射/去重键，覆盖 4–5/23)”]
    P3 --> P4[“P4: 多层公式 CTE 阶段粒度不变量<br/>(SQL AST 阶段级对齐校验)”]
```

| 阶段 | 改进项 | 改动模块 | 是否破坏现有工具签名 | 验证方式 |
| --- | --- | --- | --- | --- |
| **P1** | **输出值域契约（Range Types）** | `packages/runtime/src/answering/` (`result-execution` / `spec-realization`) | 否（从 `measure.formula.op` 自动推导） | 回放 2026-10-10 字段树运行 102 题，统计在错题与正确题上的触发率 |
| **P1** | **探针差异反例（Witness Rows）** | `packages/runtime/src/answering/` (`exploration` / `advice`) | 否（增强返回文本与 Jev 输入） | 对比待定字段在 `lean=none` 或错选题目上的裁决准确率 |
| **P2** | **时间端点开闭与差值方向校验** | `packages/runtime/src/answering/` (`spec-realization`) | 否（利用现有 `population.time.boundary` 与 `from`/`to`） | 回放历史时间边界错题（如 local157）与变化率错题 |
| **P3** | **物理层 Typed Holes**（`population.source` / `population.timeField` / 物理列映射） | `packages/runtime/src/tools/answer-fields.ts` + `Schema Profile` | 是（扩展字段 Schema） | 回放 local003、local273、local017 三道已知物理层假定错，验证 `hole → fill` 能否拦截；字段代数化部分（`countGrain` 以 local032、037 验证去重键核对，`eligibility` 以 local133 验证零活动对象计入）单独验证，先于 `conditions` 结构化 |
| **P4** | **多层公式阶段不变量** | `packages/runtime/src/answering/` (`spec-realization`) | 否 | 回放 44 道两层以上聚合标准口径题；优先验证 local194（缺外层 AVG）与 local335（嵌套次序错） |

---

## 5. 实证补充：23 道假定错的字段分布（按标答值复核）

> **数据来源**：`evaluations/spider2/adr0007/relabel-v2/wrong118-relabel-v2.jsonl` 中 `visibility == "假定错"` 的 23 条记录；预测与标答结果取自 `evaluations/spider2/wrong118-dossiers.jsonl` 与 `evaluations/spider2/adr0007/independent-recompute-35/cases/*/csv-comparison.json`。
>
> **复核方法**：Spider2 评分器（本组设置 `condition_cols: []`）逐列核对标答的每一列能否在预测中找到数值一致的列，预测多出的列不扣分。因此每题按"要改什么才能得分"重新判定分岔字段：只有标答各列的值都对、错在列或行的形状时，才归为 `output`。

### 5.1 复核后的字段分布

relabel-v2 把 9 题标为 `output`，依据的是列数不同。按标答值复核，其中 6 题的值本身就错，多出的列不是失分原因；local062、local064 的原标注也与结果对不上。

| 分岔字段 | 题数 | 占比 | 题号 |
| --- | --- | --- | --- |
| `measure.formula` | 8 | 35% | local003、035、060、062、152、194、300、335 |
| `measure.countGrain` | 2 | 9% | local032、037 |
| `population.*` | 7 | 30% | local040（conditions）、130（entity）、133（eligibility）、263（conditions）、273（source）、301（time）、355（entity） |
| `grouping` | 1 | 4% | local017 |
| `output` | 2 | 9% | local025、073 |
| 数值错，根因未定 | 3 | 13% | local049、064、258 |

`measure` 合计 10 题（43%），是最大来源；`output` 只有 2 题。

### 5.2 改判的题

| 题号 | 原标注 | 改判 | 依据（预测 vs 标答） |
| --- | --- | --- | --- |
| local032 | `output` | `measure.countGrain` | 前三行一致；"最多 5 星评价"一行卖家与数值不同（993 vs 1096），SQL 用 `COUNT(DISTINCT review_id)`。列序不影响评分 |
| local035 | `output` | `measure.formula` | 选出的城市对完全不同，预测距离 18208 km；距离算法与标答不一致 |
| local037 | `output` | `measure.countGrain` | 三个类别一致，笔数偏多（7565 vs 7540），对支付事件 `(order_id, payment_sequential)` 去重的粒度不同 |
| local040 | `output` | `population.conditions` | 树数与平均收入都有偏差（Queens 79366.74 vs 79366.24）；题面要求"filling missing ZIP values"，SQL 未补齐 |
| local049 | `output` | 根因未定 | 原始提交只有一列，值仍错（57.67 vs 59.67）；行业归属或年份口径待查 |
| local062 | `population.eligibility` | `measure.formula` | 各桶顾客数与标答完全一致，总体相同；差在每桶 min/max 的取值对象 |
| local064 | `population.time` | 根因未定 | 值错（419.99 vs 363.74）；2020 数据本就只有 1–4 月，"缩到观测月份"不改变结果，疑为均值的计入对象 |
| local133 | `output` | `population.eligibility` | 行数 20 vs 25，均值随之不同：标答包含未被排名的风格。ID 代替名称是次要问题 |
| local258 | `output` | 根因未定 | wickets 计数不同（143 vs 159），行数 330 vs 286；缺数字 ID 列是次要问题 |

维持原标注的两道 `output` 题：local025 返回逐场 569 行明细，标答是 1 个标量；local073 缺 `pizza_id`、`order_time` 列，配料串分隔符也不同（`,` vs `, `）。两题都不是"多出无依据的列"。

### 5.3 `measure.formula` 8 题

| 题号 | 假定内容 | 层 | 可能的检出手段 |
| --- | --- | --- | --- |
| local003 | 金额列 `payment_value` 代替 `price`，另有分位与均值算法差异 | 物理 + 语义 | P3 只覆盖列映射部分 |
| local035 | 相邻城市距离算法 | 语义 | — |
| local060 | 份额变化未 ×100，且数值本身也不同（2.55 vs 3.60） | 语义 | P1b 只能提示量纲，不能修正数值 |
| local062 | 每桶 min/max 取自何种利润 | 语义 | — |
| local152 | "inter-movie duration"换成片长均值 | 语义 | — |
| local194 | 缺外层 AVG | 语义 | P4 |
| local300 | `max(0, 上日余额 + 净额)` 截零后继续累计 | 语义 | — |
| local335 | 队级总分代替车手级比较 | 语义 | P4 |

### 5.4 物理层假定

不变：local003（金额列映射，部分）、local273（来源表替换）、local017（分组列 `primary_collision_factor` vs `pcf_violation_category`），共 2–3 题。

### 5.5 对前文与路线的影响

| 原结论 | 修正后 |
| --- | --- |
| `output` 列扩展是最大来源（9 题，39%），设 P1c 规则 | `output` 只有 2 题，且都不是多列。另外多出的列都是题面提到的词（bowler、distance、payment type、number of trees），"每列须有题面依据"拦不住；少列它看不到。**P1c 取消** |
| P3 最多覆盖 2–3 题 | 不变 |
| `measure.countGrain` 代数化价值不在拦截假定错 | 修正：`countGrain` 有 2 题（local032、037），都是去重粒度。代数化后 Spec Realization 可核对 `COUNT(DISTINCT …)` 的键，值得保留在 P3 中 |
| 探针差异反例（P1a）对准待定字段 | 不变，但注意：假定错按定义没有走待定与探针，P1a 对这 23 题无效 |
| local060 是 ×100 量纲假定 | 部分修正：×100 之外数值也不同，值域契约只能提示一部分 |

**结论**：23 道假定错中，确定性规则能直接对准的是 `measure` 的结构性部分（P4 的 local194、335；P1b 的量纲提示；P3 的 countGrain 与列映射），合计约 5–6 题。其余多为公式或总体的业务读法，只能靠证据（题面、文档、用户确认）而不是结构规则。

> **方法教训**：relabel-v2 的 `bifurcation_node` 依据列数差异标注，没有核对标答值。以后按字段分布排优先级前，先用评分器口径复核"改哪里才能得分"。

# Spider2 语义错误的架构级解法：从自我验证到职责分离

> **状态**：历史提案。经审阅和决策访谈后的当前规范设计见 `docs/Query Assurance架构设计V2.md`，架构决策见 `docs/adr/0001-query-assurance-responsibility-separation.md`。

上游报告：
- `docs/Spider2第5轮63题数据与形式均错误根因分析与改进建议.md`（R1–R8 已实施）
- `docs/Spider2第7轮47题成功导出语义错误逐题分析报告.md`（实施后仍有 47 题语义错误）

## 1. 一句话诊断

第 5 轮的 R1–R8 全部是"让同一个大脑更仔细地检查自己"，而第 7 轮证明：**单上下文自我验证在架构上不可能捕获解读错误**。误读发生在第一个 turn，此后所有探索、合同、验证、导出都 conditioned 在这个误读上。需要的不是第九条规则，而是把"解读、实现、验收"拆到相互信息隔离的上下文里。

## 2. 三代防线同构失败的证据链

| 代际 | 机制 | 轮次 | 被击穿的方式 |
|---|---|---|---|
| 一 | §1.4 导出前清单（文字） | Round 5 | 模型在自己的误读框架内逐项打勾，63 题失败时清单早已齐备（Round5 报告 F5） |
| 二 | 合同前置（§1.3 第 0 步） | Round 7 | 合同由同一个上下文写出；误读在写合同时就已完成。"不要从探索结果反推合同"是不可执行的指令 |
| 三 | 硬门禁（`EXPORT_SQL_NOT_VALIDATED` 27 次、`JOIN_RECONCILIATION_REQUIRED` 27 次） | Round 7 | 56 次拦截全部通过"补一次机械动作"满足；0 次纠正语义。101 次 reconciliation/verification 验证的全是候选 SQL 自洽 |

三代的共同点：**检查的语义内容由被检查者自己供给**。这是 Goodhart 定律的教科书案例——shape 声明变成考核指标后，模型学会抄上次结果的形状；reconciliation 变成门禁后，模型学会跑一条能通过的对账查询。任何由求解者自己供给语义的检查都会被同样方式满足。

操作系统设计的经典区分适用于此：**提示词是 policy，上下文隔离是 mechanism**。policy 靠自觉，mechanism 靠物理不可能。第 7 轮已出现门禁重试消耗 turn 导致超时（local258），说明在单上下文内继续加 policy 的边际收益已经为负。

## 3. 跨领域灵感与映射

| 领域 | 实践 | 解决的问题 | 映射 |
|---|---|---|---|
| 翻译行业 | Back-translation：由没见过原文的译者回译，与原文比对 | 译者无法发现自己的误译 | **方案 A：盲回译门禁** |
| 银行/会计 | Maker-checker、职责分离：发起者不能审批自己的交易 | 单人既做又审必然出错/舞弊 | **方案 A：导出审批权移出求解者** |
| V 模型/独立 QA | 需求规格由独立角色冻结，验收对照规格而非对照实现 | 开发者按自己的理解验收自己的代码 | **方案 B：Spec 冻结前置** |
| 航电 | N-version programming：独立实现同一规格，分歧即告警 | 单实现的系统性错误不可自检 | **方案 C：高风险题双实现仲裁** |
| 编译器/ML 测试 | Metamorphic testing：无 oracle 时测性质不测值 | 没有标准答案时如何测试 | **支持机制：性质探针** |
| 航空 CRM | Read-back/hear-back：指令复述闭环 | 单向传达的理解偏差 | 方案 A 的另一视角 |
| 科学界 | 盲审：审稿人不看作者自辩 | 锚定传染 | 审查者不得看求解者的对话历史 |

共同原理：**独立性来自信息隔离，不来自态度或指令**。代码评审有效不是因为评审者更聪明，而是因为评审者没有内化作者的假设。

## 4. 方案 A（P0）：盲回译语义门禁（SEMANTIC_REVIEW gate）

最便宜、最对症、直接复用现有门禁基础设施。

### 4.1 机制

在 `export_query` 现有校验链（`agent-assembly.ts` 的 shape/validated/reconciliation 检查之后）插入语义审查：

1. **回译调用**（全新 messages，零共享上下文）：输入仅有 schema 摘要 + 最终 SQL + 结果前 5 行。要求输出结构化描述：

```json
{
  "measure": "SUM(payment_value) — 金额而非次数",
  "grain": "每类别一行",
  "population": "仅 delivered 订单（SQL 中含 status 过滤）",
  "top_n_partition": "每演员内 Top-3（PARTITION BY actor）",
  "time_window": "无历史回看，仅报告期",
  "projection": ["category", "payment_sum", "order_count"],
  "unit": "0–1 比例"
}
```

关键：回译者**看不到题目、看不到求解者的对话**，只能忠实描述 SQL 实际做了什么。SQL→NL 远比 NL→SQL 可靠，且回译者没有任何动机为求解者辩护。

2. **裁决调用**（第二个独立调用，或同一调用的第二段）：输入为题目原文 + 回译描述（不含求解者任何推理），输出 `pass` 或结构化分歧列表：

```json
{ "verdict": "mismatch",
  "diffs": [
    { "aspect": "measure", "question": "total number of payments", "sql_does": "SUM(payment_value)" },
    { "aspect": "top_n_partition", "question": "top 3 films overall", "sql_does": "top 3 per actor, 600 rows" }
  ] }
```

3. **门禁行为**：mismatch 时拒绝导出，错误信息就是 diff 列表——这是第一次门禁的拒绝理由携带真正的语义内容，而非机械要求。

### 4.2 为什么它能击中第 7 轮的失败

第 7 轮报告的关键观察："模型文字输出经常比 SQL 更自信……声称已转换货币，但最终 SQL 没有 currency Join"（local061）。自我报告不可信，但**盲回译给出 SQL 实际语义的 ground truth**。对照第 7 轮逐题：

| 错误模式 | 例题 | 回译如何暴露 |
|---|---|---|
| count vs sum | local034、local002 | "对 payment_value 求和" ↔ 题目"number of payments" |
| Top-N 分区错误 | local194、local283 | "每演员 Top-3，600 行" ↔ 题目"top 3 overall" |
| 分布代替标量 | local010、local017、local330 | "输出 7 行分箱表" ↔ 题目"how many（单值）" |
| 未授权过滤 | local066、local064 | "SQL 含 cancellation IS NULL 过滤" ↔ 题目未提 |
| 文字与 SQL 不符 | local061 | 回译只看 SQL："无货币转换" |
| 常数粒度错误 | local253 | "全国平均为单一常数重复每行" ↔ 题目按公司对比 |
| 多余诊断列 | local029、local114、local270 | projection 白名单直接 diff |
| 删掉要求列 | local073、local157、local301 | 同上 |
| ID 代替名称 | local063、local354 | "输出内部 prod_id" ↔ 题目要产品名 |

### 4.3 代码落点

- **运行时**：`agent-assembly.ts` 新增可注入依赖 `deps.semanticReviewer?: (input: { sql, schemaSummary, resultPreview, question }) => Promise<Verdict>`。产品环境可不注入（行为不变）；评测环境在 `run.mjs` 注入一个用独立 messages 调 LLM 的实现。
- **审查模型**：可以就是 deepseek-chat——独立性来自上下文而非模型。若用异构模型（已有 glm 管线，见 round6 对比 csv），错误进一步去相关，等价于 N-version 的"不同团队"。
- **重试上限**：语义拒绝最多 2 次；仍分歧则放行导出，但把分歧记入 result.json（`semanticDisagreement` 字段）。防止 local258 式重试螺旋，同时保留事后审计线索。

### 4.4 成本

每题 +2 次轻量调用（回译 ~2k token、裁决 ~1k token），对比当前平均 21.17 次工具调用/题，约 +10%。可通过 §7 门禁瘦身对冲至接近中性。

## 5. 方案 B（P0）：Spec 冻结前置（合同移出求解者上下文）

### 5.1 机制

合同前置的方向没错，错在合同由求解者自己写。改为：

1. 求解循环启动**之前**，`run.mjs` 用独立调用（输入仅题目 + `db_schema.md`，**无数据探索能力**）生成结构化 Answer Spec：

```json
{
  "entities": { "authoritative_table": "match", "note": "以维表为实体权威，事实表孤儿键默认排除" },
  "measure": { "expr_intent": "次数（COUNT），非金额", "denominator": "全部客户，含当月无交易者" },
  "grain": "每客户一行",
  "top_n": { "n": 3, "partition": "global" },
  "time": { "display_window": "2020-01..2020-04", "lookback": "无" },
  "projection": ["customer_id", "avg_balance"],
  "unit": "0–100 百分数",
  "ambiguities": [
    { "issue": "题目未给年龄基准日", "resolution": "无法从题面确定，按字面不引入基准日；若必须引入，在正文声明假设" }
  ]
}
```

2. Spec 以**不可变输入**注入求解者的 system context。求解者没写过它，也改不了它。
3. `export_query` 门禁改为对照 spec 校验 `expected_columns`/`expected_rows`（而不是对照模型自己的临时声明）；方案 A 的裁决调用也以 spec 为基准。

### 5.2 为什么冻结有效

Spec 作者从未见过任何查询结果，**物理上不可能被探索结果锚定**——这正是"不要从探索结果反推合同"这条指令想要而得不到的性质。局限也要诚实：spec 作者可能犯与求解者相同的解读错误（同模型相关性），所以它主要解决**锚定漂移**（探索中途改口径、顺手加列、擅自加过滤），对**首因误读**要靠方案 A 的盲态和 §6 的多样性兜底。

### 5.3 歧义的系统化处理（替代 ask_user_clarification 缺席）

spec 的 `ambiguities` 字段把 Round 5 R3 的"禁止静默假设"从禁令变成结构：所有题面未提供的阈值、基准日、单位换算必须先进 ambiguities 才能使用（local358 的基准日、local020 的样本量阈值在此步显式暴露）。可选增强：对题目做一次改写（paraphrase），spec 作者各跑一遍，两版 spec 的分歧点即客观的歧义清单——用集成分歧检测歧义，比模型自报"我不确定"可靠。

## 6. 方案 C（P1）：N-version 仲裁（限高风险路由）

对可识别的高风险类（递归/BOM/FIFO/逐期状态推进/图遍历——第 7 轮 21 题的语义粒度类中最顽固的部分）：

1. 路由器按题面特征（递归关键词、多步分配、逐期状态）标记高风险；
2. 两个**互不共享上下文**的求解者独立完成（可同模型不同温度，或 deepseek + glm 异构）；
3. 结果一致 → 直接导出（一致性即高置信）；不一致 → 仲裁 round：第三个上下文只看两份最终 SQL + 两份结果 + 分歧值，裁决哪份符合 spec，或要求重解。

成本 2 倍但仅作用于 ~15% 的题。航电领域用它对付的正是"单实现的系统性错误无法自检"——与 local269/270/272（递归口径全错但自我验证全过）完全同构。

## 7. 支持机制

### 7.1 性质探针（metamorphic probes）：把验证从"复算"变成"可证伪"

第 7 轮 101 次验证零纠错，因为验证的是"同一解读下的两条 SQL 一致"。改为从 spec 派生**独立于解读的性质**，机器可判：

- 份额/百分比列求和 ≈ 100（或 1，与 spec 单位对照）；
- 分组总和 = 全表总和（JOIN 守恒的升级：验的是业务总量守恒而非行数）;
- anchor 度合理性：图题的锚点实体连接数为 0 即告警（local100 的 SRK 零边是数据清洗问题的确定性信号）;
- Top-N 输出行数 = N × 分区数（spec 的 partition 决定分区数，local194 的 600 行在此一步暴露）;
- 值域 sanity：结果落在底层列 min/max 之内。

探针写入 `rules.md`/`learning.md` 时只允许方法论形态，延续 Round 5 §7.3 的准入红线。

### 7.2 门禁瘦身与去重（为语义门禁腾预算）

- 相同 SQL hash 不重复要求 reconciliation（第 7 轮报告 P1 已建议）；
- `EXPORT_SQL_NOT_VALIDATED` 的 27 次拒绝多数是"重查一遍"的仪式性动作：语义门禁上线后，可将其降级为警告（保留审计字段），把 turn 预算让给回译审查；
- 目标：方案 A+B 上线后总 token 与第 7 轮基本持平。

## 8. 预期覆盖（对照第 7 轮 47 题）

| 机制 | 直接对应 | 保守估计可救 |
|---|---|---:|
| A 盲回译门禁 | 投影/粒度/分区/度量/未授权过滤 ~25 题 | 12–16 |
| B Spec 冻结 | 锚定漂移、歧义静默假设 ~8 题（与 A 部分重叠） | 3–5 |
| C N-version | 递归/多步 6 题 | 2–3 |
| 探针 | local100、份额类 ~4 题 | 1–2 |
| 难救（需要 Gold 特有口径：local156 费用项、local299 窗口细节、local141 度量选择等） | ~12 题 | 0（能力上限，不应过拟合） |

合计保守 18–26 题。与历轮不同的是：这些机制对"随机新数据库上的随机新问题"同样成立——它们不编码任何 Spider2 知识，只编码职责分离。

## 9. 新风险与防护

1. **审查者假阳性 → 重试螺旋**：硬上限 2 次语义拒绝后放行并记录分歧（§4.3）。监控指标：语义拒绝率、拒绝后修改率、timeout 数（第 7 轮基线 local258）。
2. **审查者与求解者错误相关**（同模型同误读）：盲态（不看题目解读、只看 SQL）已切断大部分相关性；对顽固类用异构模型裁决进一步去相关。
3. **成本**：+10% 上下（§4.4），由 §7.2 对冲；方案 C 限流路由。
4. **过拟合纪律延续**（Round 5 §7.3 全部继续有效）：holdout 冻结、逐轮"由对变错"配对清单、预注册每项机制预期影响的聚类、外部集（BIRD mini-dev）泛化检查。特别注意：方案 A 的裁决 prompt 不得出现任何基准领域实体。
5. **评分前置条件**：第 7 轮 P0 的 evaluator GBK 解码 bug 必须先修，否则下一轮 EX 字段仍不可信，一切归因失效。

## 10. 实施顺序

1. **P0-0**：修 evaluator UTF-8/GBK bug（否则无法测量任何改进）；
2. **P0-1**：方案 A 盲回译门禁（`deps.semanticReviewer` 注入点 + `run.mjs` 实现），单独提交、单独评测；
3. **P0-2**：方案 B Spec 冻结（`run.mjs` 前置调用 + 门禁对照 spec），单独提交、单独评测；
4. **P1**：§7 探针与门禁瘦身（与 A 同评测批次观察 token 收支）；
5. **P1**：方案 C 限流路由（仅递归/多步类）；
6. 每步遵守单变量原则与 Round 5 §6 实验纪律；关键结论至少复跑一次以隔离 deepseek 非确定性噪声。

## 11. 常见问题：验证工具与规划者-审查者框架的取舍

### 11.1 验证工具：裁决权决定成败

| 类型 | 例子 | 正确形态 | 依据 |
|---|---|---|---|
| 判定性检查（机器可判） | 份额和≈100、分组总和=全表总和守恒、Top-N 行数=N×分区数、锚点度>0、值域 sanity | 下沉为 export gate 内代码，机器执行机器裁决 | 裁决不经过求解者解读，无法被误读污染 |
| 解释性检查（需语义判断） | "SQL 算的是否是题目要的" | 隔离上下文盲代理（方案 A），禁止做成求解者自助工具 | 第 7 轮 `purpose=verification/reconciliation` 就是自助验证工具，101 次调用零语义纠错 |

结论：增加验证工具的关键不在数量，而在**把裁决权从求解者手里拿走**。给求解者加再多自查工具，它仍会在误读框架内让每个工具"全部通过"。

### 11.2 规划者-审查者多智能体：赞成，但有两条红线

本方案 A+B+C 实质就是最小三角色架构：

```
规划者(Spec)      执行者(Solver)       审查者(Blind Reviewer)
只看题+schema  →   看题+spec+DB   →    只看 SQL+schema+结果
不能碰 DB          正常探索求解         不看题目解读与对话
输出冻结           不能改 spec          裁决 diff 回给执行者
        └────── 编排者 = 确定性代码（gate），不是 LLM ──────┘
```

- **红线 1：规划者必须探索盲。** 参与循环、随探索修订计划的 planner 就是第 5 轮合同前置失败的原因本身。规划者的价值恰在于它没有能力被数据锚定。
- **红线 2：审查者必须对话盲。** 共享上下文的 reviewer 会被求解者推理链锚定后盖章放行（谄媚 + 确认偏误）；多智能体辩论研究同样表明同模型同提示下"达成一致"≠正确，因为错误相关。审查者只能看 SQL 实际做了什么，不能看求解者声称做了什么（local061：声称转汇率，SQL 无 currency JOIN）。
- **编排者保持确定性代码**：重试上限、放行规则、分歧归档写死在 gate；避免"LLM 管理 LLM"的无界修订循环与责任模糊。
- **不引入 AutoGen/LangGraph/CrewAI 等框架**：runtime 已有 `deps` 注入、gate 拦截链、独立 messages 调用所需全部机制；这里的多智能体=三次调用+三个互不共享的 messages 数组，框架只增加抽象税。

### 11.3 两个验证工具的具体形态：sql_validate + semantic_validate（含 EXPLAIN 的定位）

**EXPLAIN 的真实能力边界**：它回答"怎么执行"，不回答"算的是什么"。可用：编译期合法性校验（不执行）、无 ON 条件裸 SCAN 的笛卡尔积旁证。不可用：SQLite 的 EXPLAIN QUERY PLAN 无基数估计，JOIN 膨胀检测做不了主力；第 7 轮 47 个语义错误无一能被 EXPLAIN 直接暴露。真正的机器侧结构信号来自 **SQL AST 静态解析**（sqlglot，SQLite 方言最成熟，Python 子进程调用）。

**IR 对齐框架**（编译器思路）：题目→（规划者）→Spec IR；SQL→（AST 解析）→Digest IR；验证=两个 IR 对齐。Digest 示例字段：tables、joins（含 1:N 风险标记）、aggregates、group_by、window_partitions、filters、projection、limit，及列级血缘（输出列→源列）。

| | sql_validate（判定性） | semantic_validate（解释性） |
|---|---|---|
| 本质 | 纯机器：EXPLAIN 编译校验 + AST digest + 探针 | 盲代理：digest + SQL + 结果预览 ↔ 题目/spec |
| 挂载 | gate 流水线阶段；可同时暴露给求解者自助调用 | gate 流水线阶段；绝不暴露给求解者 |
| 理由 | 机器裁决不受谄媚/锚定影响，提前自查减少 gate 重试 | 暴露即重演 purpose=verification 的 101 次零纠错 |
| 检查内容 | 投影列 vs spec 白名单、LIMIT vs 行数声明、窗口 PARTITION vs spec.top_n.partition、1:N JOIN 上聚合→自动构造守恒查询（机器执行机器判定）、裸 SCAN 告警 | 度量含义（count vs amount）、总体边界、时间语义、单位——机器判不了的残余 |

**对现有门禁的升级**：`JOIN_RECONCILIATION_REQUIRED` 现在只要求模型"跑过一条对账查询"（第 7 轮 27 次拦截零纠错）；改为机器从 digest 识别度量列、自动生成并执行 JOIN 前后 SUM 守恒对比——裁决权彻底离开求解者。自动构造适用于单事实表+维表 JOIN 的常见形态，构造失败时回退现行机制。

**流水线顺序**：shape 检查（现有）→ sql_validate（零 LLM 成本，失败即拦）→ semantic_validate（仅机器检查通过后才跑）→ 写 CSV。相比纯方案 A 的三点改进：① 成本更低，LLM 裁决只处理机器拦不住的残余，且输入是紧凑 digest；② 一批错误从 LLM 裁决降级为机器 diff：local194/283（PARTITION 直接读 AST）、local073/157/301/029/114/270（投影白名单）、local017（LIMIT/行数）；③ 列级血缘可把部分度量错误机器化（spec 说"次数"而血缘显示来自 payment_value）。

**落地注意**：探针规则挂在 AST digest 上而非 EXPLAIN 文本匹配（跨版本不稳定）；个别解析失败的 SQL 降级为仅语义验证，不阻塞导出。

### 11.4 落地后的四个残余缺口：自报环节清零

首版实现（answer-spec.ts / conversation-blind-reviewer.ts / query-assurance.ts / review-policy.ts / invariant-probe.ts）落地后，四个缺口坐实，同根：**自报环节未清零**。统一修复原则：Schema 化每个输出、证据化每个结论、按测得精度授予权力。

| # | 缺口 | 代码现状 | 修复 |
|---|---|---|---|
| 1 | Spec 无结构化投影/粒度/分母 | outputColumns/rowMode 全 optional，语义靠 hardConstraints 自由文本 | 增加 `slots` 结构，键名与 QueryDigest 镜像（projection↔digest.projection、topN.partition↔windowPartitions、measure↔lineage）；题面特征触发式必填；规划者输出 JSON Schema 校验+有界重试；scope 改 facet 枚举，每条 hard constraint 必须绑槽。槽位化后机器 diff 零 LLM |
| 2 | Reviewer 只见元数据 | ResultMetadata 无样本/sum/高频值，minMax/distinctCounts optional | 画像层：必填 minMax/distinctCounts + 数值列 sum + top-3 高频值 + 分层样本（head5/种子随机5/tail5，≤2KB）；digestPath 语法支持 profile 路径。探针层（不劳 reviewer）：常数列（local253）、粒度唯一性 rowCount==COUNT(DISTINCT grain.keyColumns)、单位值域、精确行数 |
| 3 | coverage 自报不验证 | 13 facet 由 reviewer 自由申报；rejected 要证据而 approved 免检（不对称激励盖章） | 控制反转：requiredFacets 由 runtime 从 Spec×Digest 确定性推导（aggregates→measure+grain；joins→population+join_cardinality；windowPartitions→ranking_partition+tie_policy；日期 filter→time_*；unit 槽→unit+rounding）；必查面答 not_applicable 即拒——适用性是 runtime 从 digest 推的事实而非 reviewer 意见；每个 checked 必须附 {digestPath, slot} 过反幻觉校验，与 rejected 对称。即航空 checklist 的 challenge-response 模式 |
| 4 | Shadow 只记录不阻断 | 熔断器只有降级路径（enforce→shadow），无正向晋级 | 利用评测 Gold：一轮 shadow 直接算分面 precision/recall；晋级阶梯 shadow(采数)→advisory(非阻断警告回传，测自愈率)→per-facet enforce(机器 diff 先行，语义面 precision≥0.9 逐面晋级)→full enforce；熔断器保留为自动回退。advisory 污染 shadow 测量，须先跑完一轮干净 shadow；enforce 保持有界（2 次重试后放行并记 semanticDisagreement） |

四个缺口的共同教训：职责分离架构搽好后，失效点会退到角色之间的**接口处**——凡接口上还允许自由文本或自报状态，Goodhart 定律就在那里重新开店。Spec 槽位、画像路径、必查面、晋级阈值，本质都是把接口从自然语言收紧为可机检的类型。

## 12. 结语：换掉的是架构隐喻

前三代防线的隐喻是"更负责任的个人"——给一个人更多清单、更严的自查、更硬的流程卡点。本方案的隐喻是"有职责分离的组织"——需求方（spec）、实现方（求解者）、验收方（盲审者）互不隶属、信息隔离。软件工程史上，个人英雄主义到流程组织化的转变从来不是因为个人不够努力，而是因为**有一类错误在单一视角内原理上不可见**。第 7 轮的 47 题就是这类错误的完整标本。

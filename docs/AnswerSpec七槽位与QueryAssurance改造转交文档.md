# Answer Spec 七槽位、SQL 分流与 Query Assurance 改造转交文档

> 更新时间：2026-09-07  
> 目标读者：第一次接触本仓库、需要继续开发或评测的人  
> 代码仓库：`D:/data_agent`  
> 外部 Spider2 资源：`C:/data-agent-eval`  
> 原始方案：`docs/AnswerSpec七槽位与探索-结果SQL分流改动方案.md`

---

## 0. 一页结论

这轮改造解决的是 **查询过程的可审计性、用途隔离和发布完整性**，不是已经证明 SQL 准确率提高。

当前状态：

- Phase 0–4 的主要工程链路已经落地：
  - 七槽位 Answer Spec；
  - 假设与槽位绑定；
  - Spec 版本/hash；
  - exploration/result SQL 显式分流；
  - Artifact 发布限制；
  - 结果 Hook 路由；
  - 同一个主 Agent 通过 `update_answer_spec` 编写 Spec，再编写 SQL；
  - CTE 内非 DISTINCT 订单键计数的 D1/D2 fanout 探针。
- Phase 5 的离线测量和历史 A/B 已完成，但**效果验收没有通过**：
  - 历史 40 题 treatment 固定分母 EX 为 27.50%，低于 control 的 30.00%；
  - 旧 Trace 没有显式 SQL mode，不能代表当前 HEAD。
- 最新 DeepSeek 固定 10 题运行：
  - SQL/CSV 覆盖 9/10；
  - 官方 SQL EX 0/10；
  - 官方 E2E EX 0/10；
  - 说明流程更完整，但语义正确率仍然很差。
- `local003` 的 JOIN 订单计数膨胀已经能被历史 SQL replay 检出；模型新 SQL 也主动避免了该错误。但 `local003` 官方结果仍为 0，因为客户级平均与分群 pooled AOV、NTILE 并列策略仍选错。

**当前决策：不要默认推广，不要把“成功发布”“Spec 绑定成功”或“没有异常”解释为正确。**

---

## 1. 为什么要做这次改造

旧流程有五类根本问题。

### 1.1 Spec 只是稀疏正则结果

题面确定性提取器只能识别少量形状和关键词：

- `rowMode/rowCount` 非空 30/135；
- Gold 行数一致 18/135；
- 输出列合同 0/135；
- entity、groupBy、time 等覆盖接近 0；
- filters Precision 50%，Recall 6.52%。

最典型的错误是把英文介词 `in` 当作 SQL `IN`。该误匹配已修复，但继续叠加自然语言正则不会得到可靠业务 Spec。

### 1.2 探索 SQL 与最终 SQL 混在一起

以前 Runtime 会从 SQL 文本猜测它是不是探索。结果是：

- 查枚举、基数、空值、JOIN 行数的 SQL 可能被当成最终答案；
- 探索结果可能进入语义审查；
- 同一 SQL 没有明确“证据用途”和“交付用途”。

### 1.3 探索 Artifact 有发布绕过风险

如果只靠最后一个 SQL 或精确 `queryArtifactId`，探索结果可能被导出。必须把用途写进 Artifact 身份，并在所有发布边界拒绝 exploration。

### 1.4 主 Agent 没有真正编写 Spec

早期实现由请求正则或独立 Answer Spec Planner 预先生成 Spec，主 Agent只能读取。Trace 中可能出现错误的 `metric=count`，但主 Agent完全没有 Spec/假设生成行为。

### 1.5 Hook 对复杂 SQL 的覆盖不完整

D1 `join_fanout` 虽然存在，但旧探针直接跳过 `WITH` 查询，Query Digest 又只看到最外层 `FROM seg`。`local003` 中真正的 `orders → order_items` JOIN 藏在 CTE 内，因此异常数为 0。

---

## 2. 新人先理解的八个概念

### 2.1 Query Task

一次数据库问答请求。它拥有自己的：

- 问题；
- Answer Spec 版本链；
- Query Artifact；
- Anomaly Record；
- Publication Receipt。

聊天会话不是 Query Task；一个会话可以产生多个 Task。

### 2.2 七槽位 Answer Spec

```json
{
  "entity": "统计什么实体",
  "metric": "计算什么指标",
  "filters": ["过滤条件"],
  "groupBy": ["分组维度"],
  "time": "时间窗口或时间定义",
  "ranking": "排序、Top-N、并列规则",
  "output": "最终行列和交付形式"
}
```

约定：

- `null`：证据不足或尚未明确；
- `[]`：当前没有已确认条目，不代表业务上证明“没有”；
- 七槽位是当前主 Agent 的简化语义信封，不等于旧 `answerContract` 已被删除。

### 2.3 facetStatus

每个槽位都有状态：

```text
explicit | evidence_supported | hypothesis | unresolved | not_applicable
```

注意：当前 Runtime 能验证枚举和结构，但不能完全证明主 Agent 自报的 `explicit/evidence_supported` 真有权威证据。这是已知缺口。

### 2.4 Hypothesis 与 Binding

假设必须包含：

```json
{
  "id": "H1",
  "statement": "假设内容",
  "basis": "依据",
  "impact": "会改变什么结果",
  "scope": "metric",
  "confidence": 0.6,
  "status": "candidate"
}
```

并绑定到七槽位 JSON Pointer：

```json
{
  "hypothesisId": "H1",
  "paths": ["/metric"]
}
```

假设状态：

```text
candidate | evidence_supported | user_confirmed | rejected
```

### 2.5 Spec version/hash

任何 Spec 内容变化都会生成新版本和新 hash。hash 覆盖完整 Answer Spec 对象，包含七槽位、状态、假设、绑定、版本和 provenance；不是只对七槽位字符串做 hash。

### 2.6 Query Artifact

查询成功预览后生成不可变 Artifact：

```text
exploration      不可发布，不绑定 Spec
result_candidate 可发布，绑定 Spec/version/hash/SQL hash/hypothesisRefs
```

相同 SQL 先 exploration、后 result，也必须生成两个不同 Artifact，不能原地升级。

### 2.7 Anomaly Record

确定性检测器生成的结构观测。它会绑定 Spec 版本、Artifact 和槽位，但默认只告知，不自动裁决业务含义。

### 2.8 Publication Receipt

最终交付的身份证明。它绑定：

- 精确 Artifact；
- SQL hash；
- Spec version/hash；
- Review Outcome；
- 发布目标。

Spider2 最终 SQL 选择器只接受拥有匹配 Receipt 的发布结果，不再回退到某个预览 SQL。

---

## 3. 当前 SQL 路由的完整流程

```text
用户问题
  ↓
Runtime 创建 Query Task
  ↓
生成全 unresolved bootstrap Spec v1
  ↓
主 Agent 调用 update_answer_spec
  ↓
Runtime 校验完整 envelope，生成 Spec v2/hash
  ↓
主 Agent读取知识文档、执行 exploration SQL
  ↓
探索证据改变理解时，再次 update_answer_spec → v3/hash
  ↓
主 Agent执行 result SQL，绑定 v3/hash + hypothesisRefs
  ↓
Runtime 生成 result_candidate Artifact
  ↓
D1–D11 检测与可选解释枚举
  ↓
export_query / publish_query_result
  ↓
Review Token + Publication Receipt
  ↓
CSV/内联结果/Spider2 最终 SQL
```

### 3.1 主 Agent 更新 Spec

工具：`update_answer_spec`

入口：

- `packages/runtime/src/tools-catalog.ts`
- `packages/runtime/src/agent-assembly.ts:buildAgentTools`
- `packages/runtime/src/answer-spec.ts:createSpecAuthority/reviseSevenFacets`

首次提交前，模型可见的 `query_database` 会返回：

```text
ANSWER_SPEC_DECLARATION_REQUIRED
```

Runtime 而不是模型负责：

- 校验结构；
- 校验 hypothesis ID 和 JSON Pointer；
- 生成新版本；
- 计算 hash；
- 更新当前 Task 上下文。

### 3.2 exploration SQL

正确调用：

```json
{
  "mode": "exploration",
  "sql": "SELECT status, COUNT(*) ..."
}
```

必须完全省略：

```text
specRef
hypothesisRefs
```

即使传 `hypothesisRefs: []` 也会被拒绝。

探索查询：

- 默认安全；省略 mode 时按 exploration；
- 只产生 Internal Evidence；
- Artifact `publishable=false`；
- 不进入 Spec semantic observation；
- 不触发解释 Hook；
- 不能被 CSV 或内联发布。

### 3.3 result SQL

正确调用：

```json
{
  "mode": "result",
  "specRef": {
    "specVersion": "3",
    "specHash": "..."
  },
  "hypothesisRefs": ["H2"],
  "sql": "WITH ... SELECT ..."
}
```

Runtime 会在执行前拒绝：

- 缺失 SpecRef；
- 旧 Spec version/hash；
- 未知或已拒绝的假设；
- 当前采用、绑定到 `hypothesis` 状态槽位、但未引用的 candidate 假设。

### 3.4 发布

- ≤10 行：`publish_query_result`；
- >10 行：`export_query`；
- 两条路径都只接受 `result_candidate/publishable=true`；
- Spec 更新后，旧结果 Artifact 失效；
- 最终选择必须有匹配 Publication Receipt。

---

## 4. Phase 0–5 改造清单

## 4.1 Phase 0：七槽位、假设和版本

已实现：

- `SevenFacetSpec`；
- `facetStatus`；
- 完整假设结构；
- `hypothesisBindings`；
- 稳定 SHA-256 hash；
- 不可变版本链；
- 旧 Spec 异常不会污染新版本。

关键文件：

```text
packages/runtime/src/answer-spec.ts
packages/runtime/src/answer-spec.test.ts
packages/runtime/src/query-assurance.ts
packages/runtime/src/query-assurance.test.ts
```

## 4.2 Phase 1：探索/结果 SQL 分流

已实现：

- `query_database.mode = exploration | result`；
- 模型边界缺省为 exploration；
- exploration 禁止 SpecRef/HypothesisRef；
- result 强制最新 SpecRef；
- 不再从 SQL 文本猜用途。

关键文件：

```text
packages/runtime/src/tools-catalog.ts
packages/runtime/src/agent-assembly.ts
packages/runtime/src/query-assurance.ts
```

兼容性注意：直接调用低层 `recordPreview` 的旧接口仍可能把缺省 mode 当 result；安全默认主要保证在模型可见的 `query_database` 边界。

## 4.3 Phase 2：Artifact 与发布完整性

已实现：

- Artifact 用途写入身份；
- exploration 在导出和内联路径均被拒绝；
- result 绑定 SQL/Spec/假设；
- Spec 更新使旧 Artifact 失效；
- Publication Registry 缺失/错误 Spec hash 时 fail-safe；
- Spider2 最终 SQL 必须匹配 Receipt；
- 不再使用“第一个 CSV”或“最后一个预览 SQL”兜底。

关键文件：

```text
packages/runtime/src/publication.ts
packages/runtime/src/export-candidate.ts
packages/runtime/src/query-assurance.ts
evaluations/spider2/lib.mjs
```

## 4.4 Phase 3：Hook 路由与 fanout

已实现：

- exploration 跳过语义异常检测；
- result 继续进入确定性检测；
- Anomaly Registry 按 Spec version 隔离；
- 发布前再次防御探索 Artifact；
- D1/D2 增加 CTE 查询块级 counted-key 探针。

### CTE fanout 修复原理

历史错误：

```sql
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
COUNT(o.order_id)
```

一个订单有多个 item，导致订单计数被复制。

新探针：

1. 在 CTE/SELECT 块中定位非 DISTINCT `COUNT(relation.key)`；
2. 保留该块 JOIN 和过滤；
3. 有界执行：

```sql
COUNT(key)
COUNT(DISTINCT key)
```

4. 再验证 key 在源关系本身唯一；
5. 只有“源表唯一、JOIN 后重复”才登记 D1/D2。

`local003` 历史 SQL replay：

```text
COUNT(o.order_id)           = 110,197
COUNT(DISTINCT o.order_id)  = 96,478
fanout factor               = 1.1422
```

登记：

```text
D1 join_fanout
D2 count_distinct_divergence
```

还补充了：

- 有/无别名；
- 引号标识符；
- 两/三段限定表名；
- BigQuery 整体反引号路径；
- 2,000,001 行哨兵检查；
- NULL key 不能绕过 200 万行上限；
- `COUNT(DISTINCT)` 和源键天然重复不误报。

关键文件：

```text
packages/runtime/src/fanout-probe.ts
packages/runtime/src/fanout-probe.test.ts
packages/runtime/src/detectors.ts
apps/server/src/mcp-query-executor.ts
apps/server/src/mcp-query-executor.test.ts
packages/electron-host/src/mcp-query-executor.ts
```

## 4.5 Phase 4：同一个主 Agent 写 Spec 和 SQL

已实现：

- 初始 Spec 改为全 unresolved bootstrap；
- 主 Agent 使用 `update_answer_spec`；
- 探索后可再次更新版本；
- 移除 Spider2 Runner、Web Host、Electron Host 中独立 Answer Spec Planner 的 active wiring；
- 假设数量允许为 0；
- 删除“至少三个假设”和不存在的 Planner/Solver 交接指令。

仍保留但未在主路径启用：

```text
createProfileAnswerSpecGenerator
旧 answerContract/rowMode/rowCount/outputColumns
确定性 request extractor
```

这些是兼容接口，不应误认为当前产品仍有独立 Spec Planner。

独立 Interpretation Enumerator 仍存在，但它只在异常后列出备选解释，不编写初始 Spec、不裁决结果。

## 4.6 Phase 5：评估与标签

已完成：

- 135/135 reviewed/adjudicated 标签；
- provenance、题面 hash、双标注和裁决记录；
- 七槽位离线质量报告；
- 历史 40 题 control/treatment 复核；
- DeepSeek/GPT-5.5 `local003` 提示词遵循测试；
- D1/D2 历史错误 SQL replay；
- 最新 DeepSeek 固定 10 题运行。

但当前 HEAD 的同日同配置 A/B 仍未完成，因此 Phase 5 的“默认推广”门槛没有通过。

---

## 5. D1–D11 到底在哪里

D1–D11 不是 11 个独立 Hook。它们统一定义在：

```text
packages/runtime/src/detectors.ts
```

并由结果查询的 `afterToolCall → detectAnomalies` 调用。

| ID | Detector | 默认级别 | 当前作用与边界 |
|---|---|---|---|
| D1 | `join_fanout` | A | 观测 JOIN 造成的度量粒度扩大；CTE counted-key 已补齐，但非 COUNT 聚合仍有限 |
| D2 | `count_distinct_divergence` | B | 在 fanout 证据下报告 COUNT 与 DISTINCT 的实值差异 |
| D3 | `entity_population_mismatch` | B | 比较事实侧 distinct 实体与实体表总体；Server 有部分 provider |
| D4 | `unauthorized_filter` | A | 基于 G2/Spec 检查未授权总体缩减；依赖 Hard Contract 和 Digest 覆盖 |
| D5 | `null_like_member_in_filter` | B | 观察 UNKNOWN/N/A/NONE 等空值型成员 |
| D6 | `physical_bound_violation` | B | 经纬度、负数量/金额等物理边界 |
| D7 | `shape_mismatch` | B | 输出行列与 Hard output contract 不符 |
| D8 | `intermediate_candidate` | A | 最终输出缺少题面要求的聚合 |
| D9 | `cross_period_set_mismatch` | B | 比较期实体集合不同；当前 Host 尚无完整 provider |
| D10 | `empty_after_filter` | A | D4 命中过滤且结果为空 |
| D11 | `fingerprint_unchanged` | B | 已登记异常后，新候选语义指纹没有变化 |

A/B 的含义：

- A：结构性较强，可触发解释枚举；
- B：只告知，不应迫使模型重写。

依据 ADR-0003，检测默认是“告知”，不是“自动裁决”。

---

## 6. 设计原则与 ADR

先读：

```text
CONTEXT.md
docs/adr/0001-query-assurance-responsibility-separation.md
docs/adr/0002-bounded-deterministic-query-gates.md
docs/adr/0003-detect-inform-never-block.md
```

最重要的原则：

1. **Evidence Authority**：用户澄清和权威业务文档高于模型推断。
2. **Approval 不是正确证明**：Reviewer 只在当前证据覆盖内判断。
3. **检测与动作分离**：Anomaly 是观测，不是业务裁决。
4. **未知必须显式**：`unsupported/inconclusive/not_applicable` 不能伪装成通过。
5. **发布完整性可硬阻断**：错误 Artifact、旧 Spec、必然错误形状可以阻断。
6. **KTX 与自由 SQL 路由分开**：本次改造针对 SQL，不改变 KTX 语义查询。

---

## 7. 测试和评测证据

## 7.1 135 题离线 Spec 基线

报告：

```text
docs/Spider2题面Spec提取质量-135题-槽位基线.md
docs/Spider2题面Spec提取质量-135题-槽位基线.json
```

| 槽位 | Coverage | Precision | Recall |
|---|---:|---:|---:|
| entity | 0.00% | — | 0.00% |
| metric | 79.26% | 59.81% | 47.41% |
| filters | 8.89% | 50.00% | 6.52% |
| groupBy | 2.22% | 0.00% | 0.00% |
| time | 10.34% | 0.00% | 0.00% |
| ranking | 10.00% | 100.00% | 10.00% |
| output | 22.22% | 60.00% | 13.33% |
| output.columns | 0.00% | — | 0.00% |

正确解读：这是确定性提取器基线，不是主 Agent LLM 的 Spec 准确率，也不是端到端 SQL 准确率。

## 7.2 历史 40 题 A/B

报告：

```text
docs/Spider2七槽位Phase5同配置AB评估.md
docs/Spider2七槽位Phase5同配置AB评估.json
```

| 指标 | control | treatment |
|---|---:|---:|
| 固定分母官方 EX | 30.00% | 27.50% |
| SQL/CSV 覆盖 | 82.50% | 100.00% |
| 平均工具调用 | 21.375 | 22.65 |
| 平均耗时 | 67.8 秒 | 86.8 秒 |
| 异常数 | 0 | 4 |
| 解释 Hook | 0 | 3 |

逐题：提升 3、回退 4、不变 33。

限制：旧 Trace 的查询都没有显式 mode，因此该实验不能验证当前 exploration/result 分流，也不能作为当前 HEAD 的推广结论。

## 7.3 local003

题目要求按 RFM 客群比较平均订单销售额。

历史 DeepSeek 同时犯了三类错误：

1. `orders → order_items` 后直接 `COUNT(o.order_id)`，订单数被 item 行放大；
2. 将销售额定义为 `price + freight_value`；
3. 使用分群 pooled AOV：

```sql
SUM(total_spend) / SUM(total_orders)
```

Gold 使用客户等权平均：

```sql
AVG(customer_total_spend / customer_total_orders)
```

D1/D2 修复只解决第 1 类机械 fanout 检测。

修复后单题 Run：

```text
C:/data-agent-eval/runs/local003-after-cte-fanout-fix-001
```

结果：

- SQL/CSV 生成成功；
- 新 SQL 先按 `order_id` 聚合，fanout 已主动规避；
- 官方 SQL EX 0；
- 官方 E2E EX 0；
- 剩余主因是 pooled AOV 与客户级平均，以及 NTILE tie-break。

注意：只能说“fanout 错误类被修复/可检测”，不能说“local003 已做对”。

## 7.4 最新 DeepSeek 固定 10 题

Run：

```text
C:/data-agent-eval/runs/deepseek-10-after-spec-fanout-001
```

命令：

```bash
npm run eval:spider2 -- run \
  --ids-file evaluations/spider2/round8-shadow10-ids.txt \
  --model-profile deepseek \
  --run-id deepseek-10-after-spec-fanout-001 \
  --concurrency 3 \
  --score
```

题目：

```text
local003 local010 local025 local029 local032
local034 local035 local037 local050 local061
```

配置：

- `deepseek-chat`；
- `sqlglot-30.17.0`；
- assurance shadow；
- detectors/interpretation/few-shot 开启；
- Reviewer 实际未配置；
- concurrency=3；
- 总 timeout、turn、tool、exploration 上限均为 null。

汇总：

| 指标 | 结果 |
|---|---:|
| completed | 10/10 |
| SQL 覆盖 | 9/10 |
| CSV 覆盖 | 9/10 |
| published_with_disagreement | 9 |
| 平均耗时 | 152.2 秒/题 |
| 平均工具调用 | 32.2/题 |
| Query 调用 | 196 |
| exploration 调用 | 181（155 成功） |
| result 调用 | 15（12 成功） |
| 成功 Spec 更新 | 23 |
| 登记异常 | 0 |
| 解释 Hook | 0 |
| 官方 SQL EX | **0/10** |
| 官方 E2E EX | **0/10** |

逐题：

| Case | Turns | Tools | SQL/CSV | 发布状态 | 官方 EX |
|---|---:|---:|---|---|---:|
| local003 | 19 | 35 | 是/是 | published_with_disagreement | 0 |
| local010 | 22 | 34 | 是/是 | published_with_disagreement | 0 |
| local025 | 27 | 32 | 是/是 | published_with_disagreement | 0 |
| local029 | 19 | 23 | 是/是 | published_with_disagreement | 0 |
| local032 | 20 | 32 | 否/否 | export failed: REVIEW_UNAVAILABLE | 0（固定分母） |
| local034 | 21 | 34 | 是/是 | published_with_disagreement | 0 |
| local035 | 16 | 24 | 是/是 | published_with_disagreement | 0 |
| local037 | 22 | 41 | 是/是 | published_with_disagreement | 0 |
| local050 | 21 | 32 | 是/是 | published_with_disagreement | 0 |
| local061 | 20 | 35 | 是/是 | published_with_disagreement | 0 |

额外观察：

- 所有 196 个 query 调用都显式带 exploration/result mode，说明新路由已经进入真实 Trace；
- 每题均出现过首次 Spec 前查询，合计 10 个 `ANSWER_SPEC_DECLARATION_REQUIRED`，说明 Runtime 拦截生效，但模型仍浪费调用；
- 没有设置探索预算，平均每题 18.1 次 exploration，成本明显过高；
- 9 个结果成功发布但全部官方错误；
- 0 个异常不代表正确，反而说明当前 D1–D11 对这些语义错误覆盖不足；
- `local032` 两次 result Artifact 都因 `REVIEW_CANDIDATE_BINDING_INVALID` 无法发布，应视为工程 bug，而不是模型没有导出。

历史同一 10 题曾出现 1/10，但不是同日、同配置、同 HEAD 的 control；只能作为风险信号，不能把最新 0/10 因果归于某一改动。

---

## 8. 配置、模型与轮次限制

配置文件：

```text
evaluations/spider2/config.example.json
evaluations/spider2/config.local.json   # 已忽略，不提交密钥
```

模型通过 Profile 切换：

```bash
--model-profile deepseek
--model-profile gpt-5.5
```

密钥只能通过环境变量或已忽略的 `.env.local`，不能写入 JSON、Trace 或文档。

### 8.1 当前是否限制 20 轮

没有。当前 `config.local.json` 和 `config.example.json` 是：

```json
{
  "limits": {
    "timeoutMs": null,
    "maxTurns": null,
    "maxToolCalls": null,
    "maxExploratoryQueries": null
  }
}
```

历史第 11 轮配置曾使用：

```json
{
  "timeoutMs": 300000,
  "maxTurns": 20,
  "maxToolCalls": 50,
  "maxExploratoryQueries": 6
}
```

限制实现位于 `evaluations/spider2/lib.mjs:createRecorder`：每个 Assistant `message_start` 计一轮，第 21 轮开始时触发 `max_turns`。

产品 Agent 没有硬编码 20 轮。`agent-assembly.ts` 的 60% `[EXPORT_DEADLINE]` 只是提醒；`terminateAfterExport=true` 才会在成功发布后结束。

### 8.2 下一轮建议固定预算

为了控制最新 Run 中 181 次 exploration，建议当前 HEAD A/B 至少固定：

```json
{
  "timeoutMs": 300000,
  "providerTimeoutMs": 30000,
  "maxTurns": 20,
  "maxToolCalls": 50,
  "maxExploratoryQueries": 6
}
```

这是实验建议，不是产品默认值。control/treatment 必须用完全相同预算。

---

## 9. 关键文件地图

| 文件 | 职责 |
|---|---|
| `.pi/SYSTEM.md` | 主 Agent 七槽位、探索/结果、发布流程提示 |
| `CONTEXT.md` | Query Assurance 统一术语 |
| `packages/runtime/src/answer-spec.ts` | 七槽位、状态、假设、绑定、版本、hash、Spec Authority |
| `packages/runtime/src/tools-catalog.ts` | `update_answer_spec`、`query_database` Schema |
| `packages/runtime/src/agent-assembly.ts` | 主 Agent 工具、SQL mode 校验、Artifact、Hook 和发布接线 |
| `packages/runtime/src/query-assurance.ts` | Query Task、Artifact、Review、Publication 核心 |
| `packages/runtime/src/publication.ts` | Review Token 和 Publication Receipt 完整性 |
| `packages/runtime/src/export-candidate.ts` | 私有导出候选和原子发布 |
| `packages/runtime/src/detectors.ts` | D1–D10 确定性观测；D11 与 Registry 绑定协作 |
| `packages/runtime/src/anomaly-registry.ts` | 异常去重、版本隔离、候选指纹 |
| `packages/runtime/src/hooks/assurance-hooks.ts` | afterToolCall 告知、解释枚举和预算 |
| `packages/runtime/src/fanout-probe.ts` | CTE counted-key fanout Probe Planner |
| `apps/server/src/mcp-query-executor.ts` | Spider2/Server MCP 查询、Schema、Probe、导出 |
| `packages/electron-host/src/mcp-query-executor.ts` | Electron 产品 MCP 查询和 cardinality Probe |
| `packages/electron-host/src/main.ts` | 产品 composition root |
| `evaluations/spider2/run.mjs` | Spider2 运行、模型 Profile、Manifest、评分 |
| `evaluations/spider2/lib.mjs` | Recorder、预算、最终 SQL/CSV 选择 |
| `evaluations/spider2/spec-quality.mjs` | 135 题离线 Spec 指标 |
| `evaluations/spider2/phase5-ab.mjs` | control/treatment 复核 |

---

## 10. 验证和复现

### 10.1 构建

```bash
cd D:/data_agent
npm run build --workspace=@data-agent/runtime
npm run build --workspace=@data-agent/server
npm run build --workspace=@data-agent/electron-host
```

### 10.2 当前改动相关测试

```bash
npm test --workspace=@data-agent/runtime -- \
  src/fanout-probe.test.ts \
  src/detectors.test.ts \
  src/hooks/assurance-hooks.test.ts \
  src/query-assurance.test.ts \
  src/agent-assembly.test.ts

npm test --workspace=@data-agent/server -- src/mcp-query-executor.test.ts
npm run test:eval:spider2
```

最近一次增量结果：

- Runtime 相关 5 文件：103/103；
- Server MCP：3/3；
- Runtime、Server、Electron Host 编译通过；
- 更早一次全仓：51 个 Runtime 测试文件、292 通过、1 个既有跳过。

### 10.3 单题

```bash
npm run eval:spider2 -- run \
  --instance-id local003 \
  --model-profile deepseek \
  --run-id <new-run-id> \
  --score
```

### 10.4 固定 10 题

```bash
npm run eval:spider2 -- run \
  --ids-file evaluations/spider2/round8-shadow10-ids.txt \
  --model-profile deepseek \
  --run-id <new-run-id> \
  --concurrency 3 \
  --score
```

### 10.5 结果目录

```text
C:/data-agent-eval/runs/<run-id>/
├── manifest.json
├── summary.json
├── report.md
├── official_score/summary.json
├── cases/<instance-id>/result.json
├── cases/<instance-id>/trace.json
├── submissions/sql/
└── submissions/csv/
```

看指标的优先级：

1. `official_score/summary.json` 固定分母 E2E；
2. SQL/CSV 覆盖；
3. publication status；
4. Trace 中 Spec/mode/anomaly；
5. 成本与耗时。

不要用 `completed` 或 `published_with_disagreement` 代替官方正确率。

---

## 11. 当前已知问题，按优先级排序

### P0：最新官方效果不可接受

最新 10 题固定分母为 0/10。当前版本不能以“提高准确率”为理由推广。

### P0：local032 Publication Binding 失败

现象：

```text
REVIEW_CANDIDATE_BINDING_INVALID
Candidate identity does not match the Validated Query Artifact
```

两次 result Artifact 都成功预览，但导出失败，最终没有 SQL/CSV。下一步应建立最小回归，逐项打印 `candidateBindingValid` 的每个条件，不能让 Reviewer unavailable 掩盖身份字段差异。

### P1：七槽位不足以表达聚合顺序

`local003` 的两种指标都可自洽：

```text
segment_aov       = SUM(segment spend) / SUM(segment orders)
avg_customer_aov  = AVG(customer spend / customer orders)
```

当前 `metric` 是一个字符串，主 Agent把 pooled AOV 标为 explicit，没有把客户级/订单级选择保留为候选假设。

建议：

- 在不增加第八槽位的前提下，把“基础粒度→第一次聚合→第二次聚合→分母”写入 metric 内容；
- 存在 `for each customer` 等措辞时生成两个候选并绑定 `/metric`；
- 交互场景调用用户澄清；无交互评测采用最字面解释并披露。

### P1：ranking 没有稳定表达 tie policy

`NTILE(5)` 会切分并列客户。DeepSeek 添加 `customer_unique_id` 使结果可复现，但改变 Gold 分桶。

建议在 `/ranking` 或绑定假设中明确：

```text
strict equal-size NTILE with deterministic tie-break
preserve equal metric values in the same bucket
unspecified
```

### P1：主 Agent 可以自报 facet authority

直接 `update_answer_spec` 会结构化校验 `facetStatus`，但当前不能独立证明 `explicit/evidence_supported`。这可能使 candidate 假设引用要求被绕开。

建议：

- `explicit` 必须带题面精确 quote；
- `evidence_supported` 必须带可解析 evidence ID；
- 没有 Runtime 可验证引用时统一降为 `hypothesis`。

### P1：探索过量且提示遵循差

最新十题：

- 181 次 exploration；
- 每题都先触发一次 `ANSWER_SPEC_DECLARATION_REQUIRED`；
- 平均 32.2 工具调用、152.2 秒。

建议恢复固定探索预算，并在预算错误时要求模型使用已有证据，不要继续重试。

### P1：检测器对主要语义错误召回不足

最新九个成功发布结果全部错误，但 Anomaly Record 为 0。D1/D2 只能覆盖特定物理 fanout，不能发现客户等权/订单等权、业务分母、时间语义等问题。

### P2：fanout 新路径仍是有界子集

当前主要覆盖：

```text
显式非 DISTINCT COUNT(relation.key)
+ 可解析物理源
+ JOIN
+ 源 key 可证明唯一
+ ≤ 200 万行
```

未完整覆盖：

- CTE 内父侧 `SUM/AVG`；
- `COUNT(*)`；
- 任意表达式；
- 所有嵌套子查询；
- 超过探针上限的查询。

### P2：Host Probe 能力不一致

- Server Executor 有 `getProbeEvidence`，可附加部分 entity population；
- Electron Executor 主要提供 cardinality；
- cross-period set provider 尚未完整接入；
- 两端 timeout/reset 行为也不完全一致。

### P2：CSV 重执行不是快照发布

CSV 导出会重执行 Artifact SQL。没有真实 `dataSnapshot` 时，数据库在预览和导出之间变化可能造成结果漂移；内联发布使用存储的预览结果，不存在同样问题。

### P2：中文提示/Trace 乱码

评测附加中文在部分 Trace 中出现替换字符，影响假设和过程输出可读性。应独立修复编码链路。

### P2：工作区与 Manifest 可复现性

当前工作区有未提交改动。Manifest 中的 Git commit 不能完整代表运行时源码和 dist。正式 A/B 前必须：

1. 明确纳入哪些修改；
2. 提交或生成完整工作区补丁 hash；
3. 重建 Runtime/Server；
4. 冻结 Prompt、工具、模型、预算、题目、评分器和并发。

---

## 12. 推荐的接手顺序

### 第一步：修 local032 工程故障

验收：相同 result Artifact 能得到合法 Review Token 和 Publication Receipt；没有 `REVIEW_CANDIDATE_BINDING_INVALID`。

### 第二步：把聚合层级和 tie policy 变成显式候选

先针对：

```text
local003
local025
local034
local037
local061
```

验收：Trace 中出现绑定 `/metric` 或 `/ranking` 的候选，而不是把推断直接标为 explicit。

### 第三步：控制探索成本

用相同 10 题比较：

```text
unlimited
vs
20 turns / 50 tools / 6 exploration / 300 s
```

验收：CSV 覆盖不显著下降，平均工具调用和耗时明显下降。

### 第四步：当前 HEAD 同日 A/B

必须相同：

- 模型；
- 题目；
- Prompt；
- Runtime/Server build；
- 预算；
- 并发；
- 评分器。

唯一切换：

```text
control: detectors.enabled=false, interpretationsOnAnomaly=false
treatment: detectors.enabled=true, interpretationsOnAnomaly=true
```

至少报告：

- 固定分母官方 E2E；
- SQL/CSV 覆盖；
- 显式 exploration/result 数；
- Spec 更新次数；
- D1–D11 命中；
- 解释周期；
- 发布失败；
- 平均耗时/工具调用；
- 提升/回退题目。

### 第五步：再决定是否推广

最低判断原则：

```text
当前 HEAD treatment 固定分母准确率 >= 同日 control
且发布完整性不下降
且成本增量可接受
且不存在新的系统性工程失败
```

否则保持实验状态。

---

## 13. 不要做的事情

- 不要把 Gold SQL 或 Gold CSV 注入运行时证据；
- 不要把探索 SQL Artifact 直接升级为结果；
- 不要省略 result SpecRef；
- 不要把候选假设自动变成 Hard Constraint；
- 不要用 Reviewer Approved 代替官方或业务正确性；
- 不要看到 anomaly=0 就声称“已检查无误”；
- 不要继续堆叠自然语言正则作为主要 Spec 方案；
- 不要用不同日期、预算或 Prompt 的历史 Run 做因果 A/B；
- 不要在当前脏工作区执行 reset/clean 覆盖未提交修改。

---

## 14. 相关文档索引

设计与验收：

```text
docs/AnswerSpec七槽位与探索-结果SQL分流改动方案.md
docs/AnswerSpec七槽位与SQL分流实施验收报告.md
```

评测：

```text
docs/Spider2题面Spec提取质量-135题-槽位基线.md
docs/Spider2题面Spec标签裁决记录-135题.md
docs/Spider2题面Spec提取器修复决策报告-135题.md
docs/Spider2七槽位Phase5同配置AB评估.md
docs/单例题提示词遵循度-DeepSeek-vs-GPT5.5-local003.md
docs/Spider2与Query Assurance测评转交文档.md
```

历史架构与演进：

```text
docs/Spider2第11轮修复计划-拆除裁决层与Hook重接.md
docs/Query Assurance架构设计V2.md
docs/Spider2语义收敛方案-证据资格与确定性门控.md
```

---

## 15. 最终交接判断

这次改造已经建立了比旧流程更清晰的控制面：

```text
谁定义答案 → Spec
为什么这么定义 → Hypothesis + Binding
SQL 用来做什么 → exploration/result
哪些结果能交付 → Artifact kind + publishable
交付的是哪一个结果 → Receipt
哪里可能有结构异常 → D1–D11
```

但最新证据同样清楚：

```text
控制面完整 ≠ 业务语义正确
```

当前最需要解决的不是继续增加完整性包装，而是：

1. 聚合层级、分母和 tie policy 的显式语义建模；
2. `local032` Publication Binding 工程故障；
3. 探索预算与模型提示遵循；
4. 当前 HEAD 的同日 control/treatment 准确率验证。

在这些问题解决前，系统应保持“实验、可审计、不可宣称提升”的状态。

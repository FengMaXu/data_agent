# Answer Spec 七槽位与探索/结果 SQL 分流改动方案

> 状态：Phase 0–4 已实现并通过测试；Phase 5 已完成 135 题离线评估和同配置 A/B 复核
> 范围：SQL 路由；KTX 路由不在本轮范围
> 目标：主 Agent 暂不拆分 Planner/Solver，以最小七槽位 Spec 验证效果；假设绑定 Spec，结果 SQL 绑定 Spec；探索 SQL 不绑定 Spec，也不能发布
> 依据：`CONTEXT.md`、`docs/adr/0003-detect-inform-never-block.md`、`docs/Spider2题面Spec提取质量-135题-槽位基线.md`
> 实施证据：`docs/Spider2七槽位Phase5同配置AB评估.md`；端到端 A/B 复核使用仓库外已完成的 40 题配对运行，当前 HEAD 的 135 题模型重跑需凭据后执行。

---

## 0. 一页结论

1. 主 Agent 暂时同时承担请求理解、Spec 生成、必要假设记录和 SQL 生成，不引入独立 Planner/Solver 调度。
2. Answer Spec 先收缩为七类：`entity`、`metric`、`filters`、`groupBy`、`time`、`ranking`、`output`。
3. 假设数量由真实不确定性决定，可以为 0；假设通过 JSON Pointer 绑定到受影响的 Spec 槽位。
4. SQL 明确分成 `exploration` 和 `result`：
   - `exploration` 不绑定 Spec，产生不可发布 Artifact；
   - `result` 必须绑定不可变的 `specVersion + specHash`，产生结果候选 Artifact。
5. 探索 SQL 不能原地升级。即使 SQL 文本相同，也必须以 `result` 模式重新预览，生成新的结果候选 Artifact。
6. Hook 的检测算法不重写，但要做两项路由适配：探索查询不进入 Spec 语义检测；发布前对探索 Artifact 做防御性拒绝。
7. “探索 Artifact 不可发布”的真正硬约束放在 Runtime/Publication 层，不能只依赖 Hook。

---

## 1. 背景与问题

135 题离线标签基线表明，继续扩展自然语言正则不能形成完整 Answer Spec：

- `rowMode/rowCount` 仅覆盖 30/135，行数匹配 18/135；
- 输出列合同覆盖 0/135；
- `grain`、`measure`、`denominator`、`ranking`、`time`、`unit`、`rounding`、`joins` 当前预测覆盖为 0；
- 显式过滤谓词虽已消除普通英文介词误匹配，但语义 Precision 为 50%，Recall 为 6.52%。

本轮不继续增加正则，也不立即拆分 Planner/Solver，而是先验证一个更小的闭环：

```text
用户请求
  → 主 Agent 生成七槽位 Spec 与必要假设
  → 探索 SQL 获取结构/数据证据
  → 主 Agent更新并冻结 Spec 版本
  → 结果 SQL 绑定 Spec
  → Hook 检测并告知差异
  → 主 Agent最多纠偏一次
  → 发布精确结果 Artifact
```

### 1.1 当前实现差距

当前仓库已经具备部分基础设施，但尚不能满足该闭环：

1. `packages/runtime/src/agent-assembly.ts` 的 `isExploratoryQuery(sql)` 依赖 SQL 文本形状推断，只覆盖少数 `PRAGMA`、`sqlite_master` 和 `SELECT * ... LIMIT`，无法可靠识别基数、空值、枚举、Join fanout 等探索查询。
2. `query_database` 当前没有显式的 SQL 用途参数。
3. `recordPreview` 当前可能给探索 Artifact 带上任务的 `specVersion`。
4. 查询结果只要带 `assuranceObservation`，查询后 Hook 就可能对其运行 Spec 相关异常检测；探索 SQL 因而可能被当作结果候选纠偏。
5. `latestArtifactId` 虽会排除 `exploratory` Artifact，但按精确 `queryArtifactId` 发布时仍缺少最直接的 `exploratory/publishable` 硬拒绝。
6. 当前 Answer Spec 接口大于本轮需要验证的七类，容易把接口能力扩张与实际效果混在同一次实验中。

---

## 2. 目标与非目标

### 2.1 目标

1. 建立七槽位 Spec 的最小、稳定、可评估表示。
2. 建立 Hypothesis → Spec version → Result Artifact 的不可变绑定链。
3. 显式区分探索 SQL 和结果 SQL。
4. 确保探索 SQL 无需 Spec，同时在任何路径下都不能发布。
5. 仅对结果 SQL 运行 Spec 语义检测、候选画像和纠偏流程。
6. 保留现有 Query Digest、Anomaly Record、Publication Receipt 和精确 Artifact 发布能力。
7. 用现有 135 题标签和同配置 A/B 验证效果，不凭主观判断宣布改进。

### 2.2 非目标

- 本轮不拆出独立 Planner 和 Solver。
- 本轮不继续扩展自然语言正则。
- 本轮不让 Hook 创建、修改或裁决业务假设。
- 本轮不恢复 Reviewer 的发布裁决权。
- 本轮不要求探索 SQL 符合最终输出形状或七槽位 Spec。
- 本轮不把探索到的异常值自动转成过滤条件。
- 本轮不修改 KTX 路由。
- 本轮不删除现有复杂 Answer Spec 数据结构；先通过版本化适配降低迁移风险，实验通过后再决定是否收缩旧接口。

---

## 3. 七槽位 Answer Spec

### 3.1 核心结构

本轮主 Agent 只生成以下七类业务语义：

```json
{
  "entity": null,
  "metric": null,
  "filters": [],
  "groupBy": [],
  "time": null,
  "ranking": null,
  "output": null
}
```

MVP 类型约束：

```ts
interface SevenFacetSpec {
  entity: string | null;
  metric: string | null;
  filters: string[];
  groupBy: string[];
  time: string | null;
  ranking: string | null;
  output: string | null;
}
```

本轮优先验证语义内容是否正确，不提前引入复杂嵌套结构。后续只有在标签结果证明某一槽位需要机器可判定的子结构时，才扩展该槽位。

### 3.2 `null` 与空数组语义

- `null`：当前请求和权威证据尚未给出该槽位的确定内容，或该槽位不适用；具体原因由外层状态记录。
- `[]`：当前没有已确认的条目，不等同于业务上已经证明“不存在任何过滤/分组”。
- 需要但尚不确定的内容必须进入 Hypothesis，不能只用 `null` 隐藏。

为避免修改七槽位本体，在 envelope 中记录槽位状态：

```ts
type FacetStatus = "explicit" | "evidence_supported" | "hypothesis" | "unresolved" | "not_applicable";
```

### 3.3 Spec envelope

七槽位本体之外保留身份、版本和绑定元数据：

```json
{
  "specId": "spec-001",
  "specVersion": "3",
  "questionHash": "...",
  "spec": {
    "entity": "订单",
    "metric": "订单金额总和",
    "filters": ["只包含已完成订单"],
    "groupBy": [],
    "time": null,
    "ranking": null,
    "output": "单行：总金额"
  },
  "facetStatus": {
    "entity": "explicit",
    "metric": "explicit",
    "filters": "hypothesis",
    "groupBy": "not_applicable",
    "time": "unresolved",
    "ranking": "not_applicable",
    "output": "explicit"
  },
  "hypotheses": [
    {
      "id": "H1",
      "statement": "已完成订单对应 status = 'completed'",
      "basis": "根据字段名和已观测枚举值推断",
      "impact": "影响 filters 和订单总体",
      "scope": "filters",
      "confidence": 0.7,
      "status": "candidate"
    }
  ],
  "hypothesisBindings": [
    {
      "hypothesisId": "H1",
      "paths": ["/filters/0"]
    }
  ],
  "specHash": "..."
}
```

`specHash` 对以下内容做稳定序列化后计算：

```text
questionHash + spec + facetStatus + hypothesisBindings + 被引用假设的内容与状态
```

任何槽位内容、槽位状态、假设内容或假设状态变化，都必须生成新的 `specVersion` 和 `specHash`。

---

## 4. 假设模型

### 4.1 生成责任

主 Agent 负责识别并记录假设。系统提示词不再出现“由 Planner……”或“返回 Planner……”等当前不存在的跨角色指令。

规则：

- 假设数量可以为 0，不设置最低数量；
- 用户已明确或权威文档已定义的内容不得重复标成假设；
- 模型推断不能伪装成业务规则；
- 影响统计口径且无法由证据解决的假设，产品路径应向用户澄清；
- Spider2 等无交互评测允许保留候选解释，但必须记录为 hypothesis/disclosure，不得升级为 Hard Constraint。

### 4.2 假设结构

```json
{
  "id": "H1",
  "statement": "已完成订单对应 status = 'completed'",
  "basis": "根据字段名和已观测枚举值推断",
  "authority": "model_inference",
  "confidence": 0.7,
  "impact": "影响 filters 和订单总体",
  "scope": "filters",
  "status": "candidate"
}
```

状态：

```text
candidate
  → evidence_supported
  → user_confirmed
  → rejected
```

绑定不等于确认。`candidate` 假设可以解释当前候选实现了哪种读法，但不能作为拥有阻断权的 Hard Constraint。

绑定完整性由 Runtime 强制：每个假设 ID 必须唯一且至少有一个 `hypothesisBindings` 条目；绑定只能引用同一 Spec 中存在的假设，并只能指向七槽位内存在的 JSON Pointer。`facetStatus = hypothesis` 的非空槽位必须有假设绑定。`specHash` 覆盖假设的完整内容、状态和绑定，因此任何假设或绑定变化都会产生新的 Spec 身份。结果 Artifact 的 `hypothesisRefs` 只能引用该 Spec 版本中存在且未被拒绝的假设。

---

## 5. SQL 用途分流

### 5.1 工具协议

给 `query_database` 增加显式 `mode`：

```ts
type QueryMode = "exploration" | "result";

interface QueryDatabaseInput {
  sql: string;
  limit?: number;
  mode?: QueryMode;
  specRef?: {
    specVersion: number;
    specHash: string;
  };
  hypothesisRefs?: string[];
}
```

安全默认值：

```text
mode 缺失 → exploration
mode = exploration → 忽略并拒绝 specRef
mode = result 且 specRef 缺失/失效 → 查询前失败
```

不再依赖 SQL 文本内容推断用途。迁移期可保留 `isExploratoryQuery` 仅用于遥测对照，不再决定 Artifact 权限。

### 5.2 探索 SQL

典型用途：

- 查看字段、枚举和时间范围；
- 检查空值、重复值和异常值；
- 检查 Join 基数与 fanout；
- 验证字段映射和假设；
- 调试查询片段。

规则：

- 不绑定 Spec；
- 仍受只读、超时、行数、扫描预算等安全限制；
- 结果属于 Internal Evidence；
- 不进入最终 Spec Semantic Diff；
- 不能用于 `export_query` 或 `publish_query_result`；
- 探索结果只能成为 `observed_data` 证据，不能自动创造业务定义。

### 5.3 结果 SQL

规则：

- 必须显式使用 `mode = result`；
- 必须绑定当前有效的 `specVersion + specHash`；
- 必须记录 `hypothesisRefs`；
- 进入 Query Digest、候选画像、检测器和纠偏流程；
- 只有成功预览后的精确结果 Artifact 可以发布。

### 5.4 禁止原地升级

探索 Artifact 不能通过修改标志原地升级成结果 Artifact。

即使 SQL 文本完全一致，也必须重新执行：

```text
query_database(mode=exploration)
  → 冻结 Spec
  → query_database(mode=result, specRef=...)
  → 新 result_candidate Artifact
```

这样可以保证预览数据、SQL hash、Spec hash、检测结果和发布身份属于同一次完整候选生命周期。

---

## 6. Artifact 与发布约束

### 6.1 Artifact 类型

```ts
type QueryArtifactKind = "exploration" | "result_candidate";

interface QueryArtifactPurpose {
  kind: QueryArtifactKind;
  publishable: boolean;
  specVersion?: string;
  specHash?: string;
  hypothesisRefs?: readonly string[];
}
```

探索 Artifact：

```json
{
  "kind": "exploration",
  "publishable": false,
  "specVersion": null,
  "specHash": null
}
```

结果 Artifact：

```json
{
  "kind": "result_candidate",
  "publishable": true,
  "specVersion": "3",
  "specHash": "...",
  "hypothesisRefs": ["H1"]
}
```

### 6.2 发布硬约束

`export_query` 和 `publish_query_result` 在读取精确 Artifact 后必须检查：

```text
kind == result_candidate
AND publishable == true
AND specVersion/specHash 指向当前有效 Spec
AND normalizedSqlHash 与预览 Artifact 一致
AND Artifact 未过期
```

失败使用稳定错误码：

```text
EXPLORATORY_ARTIFACT_NOT_PUBLISHABLE
RESULT_SPEC_BINDING_REQUIRED
RESULT_SPEC_BINDING_STALE
QUERY_ARTIFACT_NOT_FOUND_OR_EXPIRED
```

该检查必须位于 Runtime/Publication 层。Hook 可以做防御性提前提示，但不能成为唯一防线。

---

## 7. Hook 改动边界

### 7.1 不调整的内容

以下算法与领域对象继续保留：

- Query Digest 编译；
- 结果候选的 Spec/Digest 对照；
- 确定性异常检测器；
- Anomaly Record 与解释披露；
- 精确 Artifact、SQL hash、Spec version 身份检查；
- Publication Receipt；
- ADR-0003 的“检测默认告知而非裁决”。

### 7.2 必须做的路由适配

#### A. `afterToolCall(query_database)`

```text
kind = exploration
  → 不构造 assuranceObservation
  → 不运行 Spec Semantic Diff
  → 不向 Anomaly Registry 登记结果候选异常
  → 只返回探索数据与安全观测

kind = result_candidate
  → 运行现有候选检测与告知流程
```

#### B. `beforeToolCall(export|publish)`

增加防御性检查：若 Artifact 是 `exploration`，立即返回不可发布提示。

这不是主要安全边界；Runtime/Publication 层仍须独立执行相同检查。

### 7.3 Hook 不得做的事

- 不替主 Agent生成或修改 Spec；
- 不把 observed data 自动升级成 Hard Constraint；
- 不自行添加过滤条件或改写 SQL；
- 不根据 SQL 外观推断 exploration/result；
- 不把普通语义分歧扩张为新的硬阻断类别。

因此，本轮对 Hook 的结论是：**不重写纠偏算法，只调整触发条件和增加防御性完整性检查。**

---

## 8. 主 Agent 行为调整

系统提示词改为单 Agent 可执行流程，不再使用不存在的跨角色表述：

```text
1. 根据用户请求和权威证据生成七槽位 Answer Spec，并在任何数据库查询前通过 `update_answer_spec` 提交完整 envelope。
2. 仅在真实不确定时记录假设，假设数量可以为 0；Runtime 返回新的 `specVersion/specHash`。
3. 使用 exploration SQL 验证字段、值编码、时间范围或连接基数；探索调用必须完全省略 SpecRef/HypothesisRef，探索结果不得直接改变业务口径。
4. 证据或用户澄清改变 Spec 时，主 Agent 再次调用 `update_answer_spec` 生成新版本。
5. 冻结 Spec 后，以 result 模式执行最终 SQL，并绑定最近一次工具返回的精确 specVersion/specHash。
6. 根据 Hook 返回的 Semantic Diff 最多修订 SQL 一次；修订后产生新的结果 Artifact。
7. 只发布精确的 result_candidate Artifact。
```

系统提示词中不得再要求“至少提出三个假设”。

---

## 9. 文件级改动清单

| 文件 | 计划改动 |
|---|---|
| `packages/runtime/src/tools-catalog.ts` | 增加主 Agent 可调用的 `update_answer_spec` 完整 envelope；`QUERY_DATABASE_PARAMETERS` 增加 `mode`、`specRef`、`hypothesisRefs` |
| `packages/runtime/src/answer-spec.ts` | 增加七槽位 Spec/envelope 或兼容适配器；定义稳定 hash 与 hypothesis binding |
| `packages/runtime/src/agent-assembly.ts` | 以显式 mode 分流；探索查询不带 Spec；结果查询校验 Spec 引用；只给结果候选构造 `assuranceObservation` |
| `packages/runtime/src/query-assurance.ts` | Artifact 增加 `kind/publishable/specHash/hypothesisRefs`；记录预览时按用途建立绑定 |
| `packages/runtime/src/publication.ts` | 发布前硬拒绝 exploration Artifact；Review Token/Receipt 纳入 `specHash` |
| `packages/runtime/src/hooks/assurance-hooks.ts` | Hook 根据 Artifact kind 路由；探索查询不触发 Spec 语义纠偏 |
| `packages/runtime/src/query-assurance-store.ts` | 持久化新的 Artifact purpose 与 Spec hash 字段；旧状态迁移时默认不可发布 |
| `packages/runtime/src/agent-assembly.test.ts` | 增加模式分流、同 SQL 重新预览、探索预算和发布拒绝测试 |
| `packages/runtime/src/query-assurance.test.ts` | 增加 Spec hash、版本失效、Artifact 不可变绑定测试 |
| `packages/runtime/src/hooks/assurance-hooks.test.ts` | 增加探索查询跳过语义检测、结果查询继续触发的测试 |
| `packages/runtime/src/publication.test.ts` | 增加 exploration Artifact 无法发布、结果 Artifact 精确绑定测试 |
| `.pi/SYSTEM.md` | 主 Agent 七槽位 Spec 流程；删除强制三项假设和跨角色措辞；说明两种 SQL mode |
| `evaluations/spider2/*` | 保存 mode、Spec、假设和 Artifact 绑定信息；增加同配置 A/B 指标 |

---

## 10. 分阶段实施

### Phase 0：合同与兼容层

1. 定义七槽位 Spec、facetStatus、Hypothesis 和 SpecRef。
2. 定义稳定 canonical hash。
3. 为现有 Answer Spec 增加七槽位适配，不立即删除旧结构。
4. 补充序列化、hash、版本变更单元测试。

验收：相同输入得到相同 hash；任一槽位或假设状态变化都会改变版本/hash；旧持久化状态不能被误认为可发布的新结果候选。

### Phase 1：SQL 用途显式化

1. 扩展 `query_database` 参数。
2. 默认 `mode = exploration`。
3. 删除 `isExploratoryQuery` 的权限决定职责，仅保留迁移期遥测。
4. `mode = result` 在执行前校验 SpecRef。

验收：任意探索 SQL 都不需要 Spec；任意结果 SQL 缺少或使用过期 SpecRef 都明确失败。

### Phase 2：Artifact 与发布绑定

1. 增加 `kind/publishable/specHash/hypothesisRefs`。
2. 探索 Artifact 不持有 SpecRef。
3. 结果 Artifact 绑定完整 SpecRef。
4. Publication 层硬拒绝探索 Artifact。
5. 同 SQL 从 exploration 进入 result 时重新执行并生成新 Artifact。

验收：不存在通过精确探索 `queryArtifactId` 绕过发布限制的路径。

### Phase 3：Hook 路由适配

1. 探索查询跳过 `assuranceObservation`、Spec Diff 和 Anomaly Registry。
2. 结果查询继续使用现有检测和告知流程。
3. D1/D2 对 CTE 内显式 `COUNT(relation.key)` 生成按度量来源键的有界 COUNT/DISTINCT 探针；不依赖最外层 Digest 展开 CTE，也不以“连接行数超过最大侧表”作为唯一判据。
4. 发布前 Hook 增加探索 Artifact 防御性拒绝。

验收：Hook 算法输出在 result 候选上不变；探索查询不会产生结果候选异常或解释枚举周期；local003 形态的 CTE 内父侧订单键被明细 Join 重复时登记 D1/D2，已使用 DISTINCT 或源键本身非唯一时不登记。

### Phase 4：主 Agent 提示词与可执行写入链路

1. 改为单 Agent 七槽位流程。
2. 增加 `update_answer_spec`，由同一个主 Agent 提交初始 Spec，并在探索后更新版本。
3. 首次 Spec 提交前 Runtime 拒绝任何数据库查询，防止只读 bootstrap Spec 被直接用于结果 SQL。
4. 取消“至少三个假设”。
5. 删除独立 Answer Spec Planner 的产品/评测 wiring，以及“由 Planner”“返回 Planner”等跨角色措辞。
6. 明确 exploration 必须省略 SpecRef/HypothesisRef；result 必须绑定最新 Spec，并显式引用采用的候选假设。

验收：Trace 中可见主 Agent 的 Spec/假设提交；清晰问题允许 0 假设；探索 SQL 使用 exploration 且无 SpecRef；最终 SQL 使用 result 并绑定主 Agent 最近提交的 Spec。

### Phase 5：评估

执行两层评估：

1. **离线槽位评估**：复用 135 题 adjudicated 标签，测量七槽位 Coverage、Precision、Recall、错配率、过度约束和假设滥用率。
2. **端到端 A/B**：同模型、同配置、同日运行 control 与 treatment，比较正确率、CSV 覆盖、探索查询数、结果候选数、修订次数、耗时和发布失败原因。

实验通过前不删除旧 Answer Spec 路径。

### 10.1 当前实施结果

| 阶段 | 状态 | 验收证据 |
|---|---|---|
| Phase 0 | 通过 | `answer-spec.test.ts`：七槽位、假设绑定、稳定 hash、版本变更 |
| Phase 1 | 通过 | `agent-assembly.test.ts`、`query-assurance.test.ts`：显式 mode、默认 exploration、结果 SpecRef |
| Phase 2 | 通过 | `publication.test.ts`、`agent-assembly.test.ts`：Artifact 用途和两条发布路径拒绝 exploration |
| Phase 3 | 通过 | `hooks/assurance-hooks.test.ts`、`fanout-probe.test.ts`、Server MCP 集成测试及 local003 旧错误 SQL replay：探索 Artifact 跳过 Spec observation；结果候选继续观测；CTE 内订单键 110,197 vs DISTINCT 96,478 登记 D1/D2 |
| Phase 4 | 通过 | `.pi/SYSTEM.md`、`update_answer_spec` 及行为测试：同一主 Agent 提交并更新七槽位 Spec，查询前强制提交，取消独立 Answer Spec Planner 与最低三个假设 |
| Phase 5 | 有条件通过 | 135 题离线槽位报告通过；40 题同配置 A/B 的输入一致性和发布覆盖通过，但旧运行未记录显式 mode、路由证据不完整，且 treatment 固定分母准确率 27.50% 低于 control 30.00%，不建议默认推广 |

---

## 11. 必测场景

1. 清晰的标量请求：主 Agent 先通过 `update_answer_spec` 提交 0 假设 Spec，结果 SQL 正确绑定该版本。
2. 含自然语言 `in` 的请求：不生成伪 SQL filter。
3. 枚举探索：探索 SQL 不绑定 Spec、不触发语义异常、不可发布。
4. Join fanout 探索：允许查询且不登记结果异常；同形 SQL 以 result 重跑后，CTE 内非 DISTINCT 父侧计数膨胀必须登记 D1/D2。
5. 同一 SQL 先 exploration 后 result：生成两个不同 Artifact，只有后者可发布。
6. `mode=result` 缺少 SpecRef：查询前失败。
7. Spec 更新后使用旧 hash：查询前失败或发布时返回 `RESULT_SPEC_BINDING_STALE`。
8. 精确传入 exploration Artifact ID：发布层返回 `EXPLORATORY_ARTIFACT_NOT_PUBLISHABLE`。
9. 结果 SQL 与 Spec 不一致：Hook 告知差异，主 Agent最多修订一次，新 SQL 产生新 Artifact。
10. Hook 不可用：按 ADR-0003 记录并披露，不把 unavailable 伪装成通过，也不增加新的语义硬阻断。
11. 持久化恢复：旧 Artifact 缺少 `kind/publishable/specHash` 时默认不可发布。
12. 内联发布和 CSV 导出执行同一套 Artifact purpose 检查。

---

## 12. 验收标准

### 12.1 工程正确性

- 探索 Artifact 发布绕过测试为 0；
- 结果 SQL 的 Artifact、Spec version、Spec hash、SQL hash 四者严格绑定；
- 探索 SQL 不运行 Spec 语义纠偏；
- 结果 SQL 继续运行现有 Hook 检测；
- 相同探索 SQL 必须经 result 模式重新预览后才能发布；
- 旧状态迁移采用 fail-safe：缺少用途信息的 Artifact 不可发布；
- 全仓构建与测试通过。

### 12.2 效果判断

本轮不预设虚假的高准确率目标。是否继续采用七槽位 Spec，以同配置 A/B 为准：

- 七槽位总体覆盖和匹配率相对当前基线提升；
- Hard-binding error 不增加；
- 未确认假设被静默写入过滤条件的比例不增加；
- Spider2 正确率不低于同日 control；
- CSV/内联发布覆盖不下降；
- 探索查询不会额外触发解释枚举或结果候选修订。

若七槽位覆盖提高但端到端正确率不提升，应先分析 Spec 内容质量与 SQL 执行偏差，不立即增加更多槽位或拆分 Planner/Solver。

---

## 13. 决策边界

本方案验证的是：

```text
“一个主 Agent + 七槽位 Spec + 显式假设 + SQL 用途分流 + Hook 告知纠偏”
```

而不是：

```text
“增加更多提示词和正则就能自动获得正确业务口径”
```

最终责任边界：

- 主 Agent：生成和版本化 Spec、记录假设、选择 exploration/result、根据差异修订 SQL；
- Runtime：维护 Spec/SQL/Artifact 不可变身份，禁止探索 Artifact 发布；
- Hook：在正确生命周期点运行检测并告知，不创建业务规则；
- 用户与权威证据：解决真正影响业务口径的歧义。

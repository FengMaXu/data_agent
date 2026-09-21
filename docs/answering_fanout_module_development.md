# Answering Fanout 模块开发方案

> 版本：v1.0  
> 状态：已实施（首版）；检测默认告知，不做业务裁决或硬拦截。  
> 目标：将旧 Query Assurance 的有界来源键重复探针迁入当前 Answering 主路径，在不恢复旧 Assurance 框架的前提下，提供 JOIN 度量复制风险检测、模型告知和发布披露。

## 1. 决策摘要

实现已落在当前工作树；本阶段验收证据包括：`npm test` 全工作区通过（200 个 runtime 测试、其余 workspace 测试均通过）、`npm run typecheck` 通过，以及 Spider2 测试集 `node --test evaluations/spider2/lib.test.mjs evaluations/spider2/phase5-ab.test.mjs evaluations/spider2/baseline-report.test.mjs` 通过。以下边界仍是首版边界，不代表通用 SQL 语义证明。

1. 只新增一个内部 Fanout 模块，由 `Answering.execute(result)` 自动调用。
2. 对外仍为 `begin / revise / execute / publish / inspect`，不增加模型工具。
3. 复用 Candidate 的 findings、coverage、Query Task 预算、Pi invocation memo 和 Publication Receipt，不新增异常注册中心或独立状态机。
4. 首版覆盖 SQLite 下有限查询块中的 `COUNT(source.key)` 和 `SUM(source.column)`，包含 CTE 内的物理表连接。
5. 首版只报告来源记录重复及度量复制风险，`blocking=false`。不将观测重复冒充业务错误，不自动修改 Spec 或 SQL。
6. 未支持、未检查、预算不足和快照不可绑定必须保留覆盖限制；不得记为 clear。
7. 检测在 Candidate 封存前完成；发布只读取封存记录，不重跑 SQL 或探针。

**本期交付的是在线检测与反馈，不是通用 JOIN 正确性证明，也不是硬拦截功能。**

## 2. 基线与设计依据

### 2.1 当前实现

- `packages/runtime/src/answering/candidate-checks.ts` 默认只检查完整性、形状和身份。
- `packages/runtime/src/answering/service.ts` 的结果路径在执行、保存私有结果后调用基础 CandidateCheck，再创建 Candidate。
- `CandidateCheckInput` 只有 Spec、私有结果和 queryHash，不包含 SQL 结构或基数证据。
- `MetricSpec` 的 kind/expression 是自由文本，不能直接作为机器可判的度量贡献次数合同。
- `QueryExecutionView` 已携带 findings/coverage；Candidate 和 Receipt 已有 coverage。
- `PublicationDisclosure` 当前主要服务于 provisional Choice，需要补充检查风险披露。
- Spider2 Runner 当前将 detectorsOnline、anomalies 等字段写为关闭/空值，接入时必须同步修正。

以上为编写本文时的代码基线；实施前应再次核对，不依赖固定行号。

### 2.2 参考材料

- `CONTEXT.md`：Evidence Authority、Structural Fact、Invariant Probe、Review Coverage 等领域定义。
- `docs/adr/0003-detect-inform-never-block.md`：检测与动作分离，未知默认披露而非阻断。
- `docs/answering_dual_loop_architecture_design.md`：内层检查、实现障碍、整体预算与单次结果身份。
- `docs/AnswerSpec七槽位与QueryAssurance改造转交文档.md`：CTE counted-key 探针及历史覆盖限制。
- `docs/implementation/answer-plan/phase4-bounded-counterevidence.md`：有界反证、快照与覆盖要求。

旧构建目录中的 fanout-probe/counterevidence 文件只能用于理解历史实现，不能作为新源码依赖。迁移时将必要代码及测试收敛到当前源码；不从 dist 或归档目录 import。

### 2.3 历史案例使用约束

- 旧 local196 的 payment×rental 同层聚合可以作为负例，但必须注明原始运行来源，或改用合成 fixture。
- `spider2-gold60-remaining-001/local196` 实际已分别预聚合付款与租赁，不能把它标成当前 fanout 负例。
- local064 的客户×月份网格属于分母/总体选择问题，不因包含 CROSS JOIN 就判错。
- Gold 只用于离线评估，不进入运行时检测或业务证据。

## 3. 首版范围与非目标

### 3.1 支持范围

首版方言固定为 SQLite；其他方言返回 unknown/unsupported_dialect，不隐式套用 SQLite 探针。

| 形态 | 行为 |
|---|---|
| 物理表连接后非 DISTINCT 的 COUNT(source.key) | 检查 counted key 对应来源记录是否重复 |
| 物理表连接后 SUM(source.column) | 找到 source 的单列非空唯一键，检查度量来源记录是否重复 |
| CTE 内包含上述物理表连接 | 独立提取并检查对应查询块 |
| 多个度量共用同一来源键和连接块 | 合并为一个探针，保留受影响表达式列表 |
| 来源键不唯一或存在空值 | 不将其重复归因于 JOIN；记录 unknown/source_key_unproven |
| 简单无 JOIN 聚合 | not_applicable |

识别必须保留完整查询块的 FROM、JOIN、ON、WHERE，正确处理别名、限定名称、引号、字符串和注释。

### 3.2 暂不支持

- 任意 AVG、加权均值、窗口聚合、递归和集合运算的正确性证明。
- 复合来源键、复杂 SUM 表达式、相关子查询、未能解析的 USING/NATURAL JOIN。
- 跨 CTE 的通用 lineage 和唯一性传播；引用派生关系的连接块无法证明时返回 unknown。
- 自动推断度量业务粒度、自动 DISTINCT、自动预聚合或 SQL 修复。
- 通用规则注册中心、插件框架、独立 Reviewer、Interpretation Enumerator。
- 修改 AnswerSpec 七槽位、另建 Query Assurance 状态或恢复旧发布协议。
- 首版硬阻断、以增加告警数量为目标的全量扫描。

**克制不是只识别 COUNT：首版必须包含简单 SUM 来源键复制，否则不能覆盖支付×租赁这一核心风险。**

## 4. 语义边界

模块回答：

> 在指定观测中，这个连接块是否把某个非空唯一来源键复制成多行，且该来源列参与了支持的非 DISTINCT 聚合？

模块不回答：

> 这种复制是否违反用户业务意图，最终指标是否一定错误，应采用哪个业务分母？

### 4.1 度量来源优先于驱动实体

```sql
SELECT SUM(p.amount)
FROM customer c
JOIN payment p ON p.customer_id = c.customer_id
JOIN rental r ON r.customer_id = c.customer_id;
```

此处应检查 `p.payment_id`，而不是 `c.customer_id` 或 `p.amount`。

- 同一客户有多笔付款是合法数据性质。
- 两笔不同付款金额相同是合法数据性质。
- 同一付款记录被租赁分支复制，才是这个 SUM 的复制风险。
- `SUM(DISTINCT amount)` 会合并不同付款，不能作为通用修复。

### 4.2 重复不等于错误

合法分组、分类映射或业务权重可能有意让一个实体贡献多次。首版可以报告来源重复，但必须声明它是查询块级观测，不是每个最终分组或最终输出必然膨胀的证明。

不根据输出金额量级、行数增长比例或所谓常识阈值判错；复制因子仅作为诊断值。

### 4.3 不得用文本特征判定安全

禁止：看到 `WITH`、`GROUP BY`、`DISTINCT` 就跳过整条 SQL 并宣称安全。

应逐查询块判断：聚合是在危险连接之前还是之后，DISTINCT 是否作用于被检查的度量。无法建立该局部关系时返回 unknown，不能全局豁免。

## 5. 主路径接入

```text
execute(result)
  → 当前 Ready Revision / 权限 / 幂等性 / 预算校验
  → 最终 SQL 执行一次
  → 私有结果保存，记录 result-execution settled
  → 基础 CandidateCheck
      ├─ 阻断问题：沿现有 ImplementationObstacle 返回，不执行额外探针
      └─ 通过：运行 Fanout 检查
  → 合并 findings、coverage 和内部观测
  → 再校验当前 Revision、任务状态
  → 封存 Candidate
  → 工具文本返回结果及检查告知

publish(candidate)
  → 身份及当前 Revision 校验
  → 从 Candidate 生成披露
  → 编码原结果并提交 Receipt
  → 不执行探针，不重跑最终 SQL
```

### 5.1 分工

| 位置 | 职责 |
|---|---|
| `fanout-check.ts` | 有限查询块识别、探针构造、观测解释和覆盖归纳 |
| `service.ts` | 调用时机、预算、权限、attempt、memo、记录持久化与 Candidate 封存 |
| SQL executor adapter | 数据库访问、取消、超时、方言及真实能力信息 |
| `candidate-checks.ts` | 保持现有同步基础检查，不强制改成异步框架 |
| `tools/answering.ts` | 将关键 finding/unknown 放入模型可见文本 |
| Publication / Presentation | 按 Receipt 展示已封存风险，不重新判断 |
| Spider2 Runner | 从实际 Candidate/Receipt 投影检查统计 |

探针不通过公开 `execute(exploration)` 递归调用，不创建可发布结果，也不由子 Agent 接管。

## 6. 内部 Interface 与记录

首版采用普通模块函数，不建立可注册的 FanoutProvider 或规则工厂。下列为目标接口草图，实施时对齐现有类型命名。

```ts
checkFanout({
  sql,
  dialect,
  schema,       // 仅相关关系的结构证据
  runProbe,     // Answering 包装后的受限执行入口
}): Promise<FanoutReport>
```

`runProbe` 的 Interface 必须包含：有限 SQL、执行标识、输入行上限、期限/取消、返回完整性及快照能力。实际任务身份、权限和预算由 Answering 闭包绑定，不允许模块或模型自行构造可信身份。

### 6.1 最小记录

`FanoutReport` 保存：

- ruleVersion；
- 总体 coverage；
- findings；
- 每个目标的观测或未检查原因。

单个目标记录：

- 查询块定位及受影响度量表达式；
- 来源关系、别名、键和键资格依据；
- sourceRows/sourceNonNullKeys/sourceDistinctKeys；
- joinedRows/joinedNonNullKeys/joinedDistinctKeys；
- 输入是否完整、采样上限、执行时间、snapshotScope；
- 已有 attempt 标识和具体原因码。

报告由父级 Candidate/attempt 绑定 task、revision、queryHash，无须为每个观测新建一套品牌 ID、内容 Hash 和 Evidence 生命周期。

内部探针结果不是模型可以伪造或回填的 `query_observation`。如未来需要将它用于 Hypothesis 处置，必须另行经过现有证据资格机制；本期不授予这项能力。

### 6.2 最小类型变更

- `Finding.kind` 增加 `join_fanout`，首版始终 blocking=false。
- `ResultCandidateRecord` 增加可选、只读的 fanout 检查报告；旧记录无需回填或重查。
- `QueryExecutionView` 返回对应检查摘要，details 可包含完整内部报告。
- `PublicationDisclosure` 增加检查发现/覆盖限制的引用，保留现有 provisionalChoiceIds。
- attempts 复用现有 exploration kind，新增可选 `purpose: "fanout_probe"` 区分内部探针；不伪装成用户探索 Artifact。

不为本期创建新的数据库表、异常 Registry 或第二份 Task。

## 7. 探针算法

### 7.1 找到支持的查询块

1. 对 SQL 做有界词法与查询块识别，定位 COUNT/SUM 的来源别名。
2. 首版只接受完整落在声明支持子集内的查询块。
3. 无法正确处理的语法必须显式拒绝覆盖；不得截掉不认识的 JOIN、过滤或子查询继续执行。
4. 旧的保守查询块提取代码可迁移，但需补齐引号/括号/嵌套和 SUM 用例测试。正则匹配只能辅助定位，不能承担任意 SQL 改写正确性的证明。
5. 不引入完整通用 Query Digest；若实现过程中发现必须依赖成熟 parser，应单独评审依赖与部署成本，而不是继续扩大自制解析器。

### 7.2 选择并验证来源键

- COUNT(source.key)：验证该 key 能标识来源记录。
- SUM(source.column)：优先使用正式 Schema 中已证明非空的单列唯一键。
- SQLite 不能仅看到 PRIMARY KEY 字样就假设所有表形态都具备非空保证；以真实约束和观测为准。
- 没有合格唯一约束时，可以对有界源表做一次完整性与唯一性验证；未扫描完整则不能证明源表唯一。
- 无可用键时为 unknown，不猜字段名 `id`，不以金额或 customer_id 代替 payment_id。

### 7.3 在一条只读语句内取得局部基数证据

以下仅为算法示意，不是允许直接拼接任意用户文本的通用模板：

```sql
WITH source_keys AS (
  SELECT p.payment_id AS k
  FROM payment p
  LIMIT :sentinel_limit
), joined_keys AS (
  SELECT p.payment_id AS k
  FROM customer c
  JOIN payment p ON p.customer_id = c.customer_id
  JOIN rental r ON r.customer_id = c.customer_id
  -- 保留目标查询块的 WHERE
  LIMIT :sentinel_limit
)
SELECT
  (SELECT COUNT(*) FROM source_keys) AS source_rows,
  (SELECT COUNT(k) FROM source_keys) AS source_keys,
  (SELECT COUNT(DISTINCT k) FROM source_keys) AS source_distinct,
  (SELECT COUNT(*) FROM joined_keys) AS joined_rows,
  (SELECT COUNT(k) FROM joined_keys) AS joined_keys,
  (SELECT COUNT(DISTINCT k) FROM joined_keys) AS joined_distinct;
```

- 上限作用于聚合输入，不是只限制最外层返回一行。
- 达到上限加一行时标记不完整，首版统一 unknown，不计算全量复制因子。
- 源键非空唯一成立，且完整连接观测中 `joined_keys > joined_distinct`，返回来源记录重复 finding。
- 连接键为 NULL 的外连接补位行不能当作真实来源记录重复。
- 未观察到重复只能清除该目标、该次观测的风险，不能宣称整个查询正确。
- 全局 `count/distinct` 不能证明每个 GROUP BY 分组都有重复；报告必须标明此限制。

### 7.4 快照约束

源键资格与 JOIN 计数优先在同一语句内完成，避免两个独立调用之间的数据变化产生假证据。首版必须在实际 SQLite adapter 中验证语句级一致性保证。

最终结果查询与探针仍可能是不同快照。报告区分：

- `probe_statement`：只证明探针语句内观测一致；
- `result_snapshot`：仅在 adapter 提供真实同快照能力时使用；
- `unbound`：无法保证一致性。

不能根据相同 connectionId、执行时间接近或模型自报制造 snapshotId。本期不为获得 result_snapshot 引入跨 MCP 事务协议。

## 8. Coverage、告知与双层反馈

复用 `clear / finding / not_applicable / unknown`：

| 结果 | 条件 | 处理 |
|---|---|---|
| not_applicable | 已确认没有适用的 JOIN 聚合目标 | 不触发修复 |
| clear | 所有适用且声明支持的目标检查完整，未见来源键重复 | 明示仅局部覆盖 |
| finding | 至少一个支持目标观察到来源记录重复 | 非阻断告知 |
| unknown | 不支持、证据不足、未完成或未启用 | 记录原因与披露 |

一条 SQL 同时有 finding 和未检查目标时，总体为 finding，但必须同时保留未覆盖目标，不能丢弃 unknown。存在部分 clear、部分 unknown 时，总体为 unknown。

建议固定原因码：`unsupported_dialect`、`unsupported_shape`、`schema_unavailable`、`source_key_unproven`、`input_limit_exceeded`、`probe_budget_exhausted`、`probe_timeout`、`snapshot_unbound`、`check_disabled`。

模型可见文本示例：

```text
[FANOUT_OBSERVATION]
查询块 cust_tot：SUM(p.amount) 的来源键 p.payment_id 在连接后重复。
观测计数：120；distinct 来源键：6；复制因子：20。
这是度量复制风险，不是业务口径裁决；探针与最终结果未绑定同一快照。
请确认当前 Spec 要求的是付款记录等权，还是连接行权重。
```

以上数值仅为示例，不对应任何评测结果。

- 实现违背已确定规格：主 Agent 保持 Revision，修复 SQL。
- 业务粒度不明确：主 Agent 回外层取证或澄清。
- 模块不得自动 revise，也不因警告强制调用子 Agent。
- 首版 finding 不生成强制技术失败，不能用无限重试迫使模型“变绿”。

## 9. 预算、权限和恢复

### 9.1 有界执行

建议首版常量，实施时通过本地 fixture 测量后冻结，不增加用户配置矩阵：

- 每个结果尝试最多 2 条探针语句；
- 每侧输入最多 50,000 行，额外 1 行作为不完整哨兵；
- 每条探针期限不超过 2 秒，且不得超过任务/调用剩余期限；
- 同块同来源键合并，未被预算覆盖的其他目标记录 unknown。

探针消耗现有 Query Task 的 explorationAttempts，并记录为内部 fanout_probe；最终实现仍消耗 resultAttempts。修订、委派、恢复不得重置这些计数。

observedRows 按实际返回行计费，报告另记有界输入行数；不得把“一行统计输出”宣传成只扫描一行。LIMIT 不保证索引查找、JOIN、排序等物理工作量有界，因此必须验证 adapter 的数据库取消/超时能力；只有客户端超时而服务器继续运行，不算成本控制验收通过。

元数据读取也必须继承取消和期限。只消费相关结构切片，不给模型加载全量 Schema。缺少元数据时记录 unknown，不阻断正常结果。

### 9.2 单次结果与恢复

- 保持已有 result-execution started/settled 语义。
- Fanout 报告及子探针进度通过现有 invocation memo 和 attempts 持久化，不另建恢复运行时。
- 同一 invocation 恢复，已完成探针复用，不重复扣预算。
- 探针 started 但结果未知：记录 unknown，不自动重跑该探针，不把已 settled 的最终结果改成“执行未知”。
- 无探针记录且尚有预算时才允许开始新的探针。
- 已创建的 Candidate 一律复用封存报告，不在重试时重新探测。
- 同 SQL 的新 Revision 不自动复用旧观测，也不恢复旧预算。
- 整体取消必须传播，不吞掉取消错误继续发布。
- Candidate 提交前若 Revision 已变化，不允许把旧检查改绑新 Revision。

探针普通失败只使检查 unknown；结果执行失败仍走既有 ImplementationObstacle。二者必须分开记录。

## 10. 发布披露与评测接线

### 10.1 披露

有 finding 或适用检查为 unknown 时，Receipt 记录检查风险/限制，并与 provisional Choice 披露合并。

- 工具文本必须显示摘要，不能只放在 details。
- 用户通过 Receipt 授权读取 inline/CSV；CSV 表格不插入警告行，不改变业务列。
- 下载链接或内联结果旁显示风险摘要；CSV 文件本体保持同一封存结果。
- 未实施/关闭不等于 not_applicable；关闭时明确 `check_disabled`。
- 不允许模型通过一句“已确认安全”清除 Candidate 上的观测。

### 10.2 Runner

修改 `evaluations/spider2/run.mjs`：

1. 在线能力描述来自实际 Answering 装配，不再固定 detectorsOnline=false。
2. findings、coverage 和检查观测从实际 Candidate/Receipt 投影。
3. 旧 anomalies 指标如需兼容，明确是投影，不新建可写状态。
4. 区分未启用、未适用、未知、已检查无发现、已发现；不得把所有情况汇总成“0 anomalies”。
5. 不打开旧 assurance switches 来恢复整套旧执行链；Reviewer 继续离线。

## 11. 变更清单

| 文件/区域 | 预期变更 |
|---|---|
| `answering/fanout-check.ts` | 新增唯一内部检测模块 |
| `answering/fanout-check.test.ts` | 有限 SQL 支持集和邻近反例测试 |
| `answering/model.ts` | join_fanout finding、报告、探针目的和披露字段 |
| `answering/service.ts` | 唯一调用点、受限执行入口、预算/memo 和封存整合 |
| `answering/service.test.ts` | 跨预算、失败、恢复与修订一致性 |
| `answering/session-e2e.test.ts` | 工具告知及发布披露完整路径 |
| `tools/answering.ts` | 模型可见摘要，保持现有工具签名 |
| Host / executor adapter | 注入现有 schema/dialect 能力，必要的取消和期限支持 |
| `evaluations/spider2/run.mjs` | 真实能力、检查记录与统计投影 |
| Publication 展示链 | 呈现检查披露，不修改结果数据 |

不要求引入新的独立 package。Server、Electron 和评测适配器共享算法；方言或能力不支持时显式降级，不复制三套判断逻辑。

## 12. 实施顺序

### P1：最小可执行探针

- 从合成 SQLite fixture 开始，先写失败测试。
- 实现来源键验证、COUNT/SUM 支持及查询块定位。
- 验证预聚合、明细 SUM、引号、CTE 等邻近反例。
- 验收：核心正反例可由真实 SQLite 执行复现，不只断言生成了某段 SQL。

### P2：Answering 主路径

- 基础检查通过后调用探针。
- 完成预算预留、attempt、权限、memo 和 Candidate 封存。
- 验收：最终 SQL 一次，探针有界；关闭/失败均有真实 coverage。

### P3：告知与披露

- 工具文本、Candidate、Receipt、下载旁摘要贯通。
- Runner 读取真实检查记录。
- 验收：模型和用户均可看到风险，不只后端 JSON 有字段。

### P4：有限回放与发布

- 用已注明来源的旧错误 SQL及合成数据回放；不得把旧结果冒充当前运行。
- 记录检查覆盖、误告警、额外耗时、超时/取消及模型纠错结果。
- 是否默认启用依据测量决定；首版不以通过单题回放宣称整体正确率提升。
- 全量/付费模型评测需另行确认预算；本期可先完成确定性本地验收。

## 13. 必须通过的测试

| 场景 | 预期 |
|---|---|
| payment×rental 后 SUM(payment.amount) | 发现 payment 主键重复；blocking=false |
| 订单×明细后 COUNT(order.id) | 发现订单来源键重复 |
| 明细×订单后 SUM(detail.amount) | 不因订单键重复误报；检查明细来源键 |
| 两侧分别预聚合后连接 | 不报直接物理明细复制；无法证明派生唯一性时允许 unknown，不能假称 clear |
| CTE 内错误聚合，外层只有 AVG | 能检查内部受支持的 SUM 块 |
| customers×months 日历脊 | 不因 CROSS JOIN 字样直接判错 |
| 一个 DISTINCT 度量与一个非 DISTINCT SUM 并存 | 不豁免 SUM |
| 来源键天然重复/NULL | source_key_unproven，不伪造 JOIN 引入重复 |
| 外连接空值补位 | 不把 NULL 当真实来源记录 |
| 多分组合法复用来源记录 | 告知保持查询块级范围，不声称每组指标必错 |
| 截断/不支持语法/缺 Schema | unknown，原因可见 |
| 同块同来源键的多个度量 | 探针合并 |
| 多目标超过预算 | 部分覆盖和未检查目标均保留 |
| 探针超时或普通错误 | 不重跑最终 SQL；检查 unknown |
| 整体取消 | 取消向底层传播，不继续封存/发布 |
| memo settled 后恢复 | 复用探针结果及封存结果，不重复计费 |
| 探针结果未知后恢复 | 不自动重跑；保留 unknown |
| 检查期间 Revision 变化 | 不改绑 Candidate |
| exploration 查询 | 不自动递归触发 fanout 检查 |
| publish / export / 重复发布 | 零 SQL 和零探针追加执行 |
| 历史 Candidate 缺报告 | 不回溯重查，不宣称已检查 |
| inline 和 CSV 发布 | Receipt 与用户可见披露一致，CSV 业务数据未污染 |

## 14. Definition of Done

- [x] 首版支持集和非目标由测试明确固定。
- [x] COUNT 和简单 SUM 的真实 SQLite 正反例通过。
- [x] 旧探针能力进入当前 execute 路径，而非只复制文件。
- [x] 不增加公开工具、第二份业务状态或通用插件框架。
- [x] 查询块不完整、快照未绑定和未知状态不伪装成安全。
- [x] 探针预算、取消、超时、恢复均有主路径测试。
- [x] 最终 SQL、Preview、Candidate 和发布继续保持单次结果身份。
- [x] 模型可见文本、用户披露与 Runner 统计贯通。
- [x] 无旧 dist/归档运行时依赖；没有三套 Host 算法。
- [x] 开发报告明确：首版为检测告知，不含业务裁决和硬拦截。

## 15. 后续硬拦截的准入条件

不纳入首版。只有同时满足下列条件，才单独设计升级：

1. 存在有合格权威证据支持的、机器可判的度量来源粒度/贡献次数约束；不是解析自由文本猜测。
2. 查询块 lineage、补偿聚合、去重和分组传播得到支持。
3. 重复证据与候选结果有真实快照关联，或具备其他充分的结构性证明。
4. 正反例和独立回放证明误拦截风险可接受。
5. 阻断明确走当前 CandidateCheck/ImplementationObstacle，不引入第二个发布权威。
6. 新阻断政策与 ADR-0003 的关系经显式评审，不在实现中静默改变默认告知策略。

**最终原则：迁移有证据的局部检测能力，不迁回旧系统的全部复杂性；先让风险真实可见，再讨论何时有资格阻断。**

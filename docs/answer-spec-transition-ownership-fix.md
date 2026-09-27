# Answer Spec 状态转移与证据准入修复方案

- 日期：2026-09-24
- 决策依据：`docs/adr/0004-runtime-owns-spec-transitions-and-evidence-admission.md`
- 问题来源：`docs/answer-spec-runtime-refactor-audit-20260918.md`
- 范围：`packages/runtime/src/answering/`、`packages/runtime/src/tools/answering.ts`、Session 组合根、`.pi/SYSTEM.md`、Spider2 评测组合根

## 1. 要修的问题

| 编号 | 缺口 | 代码位置（修复前） | 后果 |
| --- | --- | --- | --- |
| G1 | `revise` 用 `input.hypotheses ?? []`、`input.choices ?? []` 重建列表 | `service.ts` `revise()` | 未决项被省略就会消失，门禁看不到 |
| G2 | 每次修订都重新生成 Hypothesis/Choice ID | `createHypotheses`/`createChoices` 中的 `makeInternalId` | 跨版本没有稳定身份，连续性无法检查 |
| G3 | 模型可以提交 `user_confirmation`/`reviewed_definition`/`task_document` 证据 | `tools/answering.ts` 的 `modelEvidenceKindSchema`、`service.ts` 的 `makeEvidence` | 模型能自造最高权威证据 |
| G4 | `qualifyEvidence()` 只看证据种类，不看引文和来源 | `qualification.ts` | 引用无引文的题面证据 ID 即可"证明"业务假设 |
| G5 | 未绑定假设的槽位默认依据为题面证据 | `proposalFacet()` | 模型推断看起来像题面明文 |
| G6 | 证据引用可以按 `sourceRef` 匹配 | `createHypotheses`/`createChoices` 中的 `find(... sourceRef === id)` | 引用对象含糊，可指向任意同名来源 |

不在本次范围：Runtime 从题面确定性抽取初始槽位；引文与命题相关性的确定性判定；`schema_fact` 来源核验；恢复旧版 Query Digest 和盲审路径。

## 2. 目标不变量

- **I1 连续性**：设 `U(r)` 为版本 `r` 的未决 Hypothesis/Choice 集合，`D` 为本次修订的处置集合，`S` 为本次被取代的集合。那么 `U(prev) ⊆ U(next) ∪ D ∪ S`，并且 `items(prev) \ S ⊆ items(next)`。
- **I2 身份稳定**：同一个 Hypothesis/Choice/Alternative 在版本链上的 ID 不变，已有 Resolution 原样保留。
- **I3 依据合格**：`supported`、`refuted`、`selected` 的每条证明，都来自 Runtime 已核验的文本证据、`schema_fact`，或 Runtime 登记的 `query_observation`，并且符合权威矩阵。
- **I4 证据来源可信**：文本类证据的引文必须逐字出现在 Runtime 从受信来源读到的原文中。原文的归属（哪条消息、哪份文档）和权威等级由 Host 或组合根决定，模型无法指定。
- **I5 依据诚实**：`specified` 槽位的依据必须是以下三种之一：`hypothesis`（该项仍在当前版本且未被反驳）、`evidence`（合格证据）、`inference`（模型推断）。
- **I6 门禁不变**：`sealForResult()` 继续要求当前版本中没有未知槽位、未决 Hypothesis 和未决 Choice；推断依据不阻断，只进入披露。

## 3. 领域模型变更（`answering/model.ts`）

```ts
// 槽位依据：新增 inference
basis:
  | { kind: "evidence"; evidenceIds: NonEmpty<EvidenceId> }
  | { kind: "hypothesis"; hypothesisId: HypothesisId }
  | { kind: "inference" };

// 证据：记录 Runtime 的核验结果
interface EvidenceVerification {
  readonly method: "user_message_quote" | "document_quote";
  /** 核验时原文全文的哈希 */
  readonly sourceContentHash: string;
}
EvidenceBase.verification?: EvidenceVerification;

// 模型或应用输入的证据
interface UntrustedEvidenceInput {
  readonly localId?: string;   // 同一次调用内引用
  readonly kind: EvidenceKind;
  readonly sourceRef?: string; // 文档类填 knowledgeId；request_wording 由 Runtime 设定；user_confirmation 由 Host 设定
  readonly quote?: string;
  readonly contentHash?: string;
  readonly preview?: BoundedResult; // 仅内部使用；begin/revise 拒绝 query_observation
}

// 处置
type DispositionProposal =
  | { action: "support" | "refute"; hypothesisId: string; evidenceIds: readonly string[] }
  | { action: "select"; choiceId: string; alternativeId: string; evidenceIds: readonly string[] }
  | { action: "provisional"; choiceId: string; alternativeId: string }
  | { action: "supersede"; targetId: string; replacementIds: readonly string[]; reason: string };

// 修订：增量，而不是完整 Proposal
interface ReviseAnswer {
  taskId; baseRevisionId; requestId;
  spec?: AnswerSpecProposal;              // 只替换出现的键；filters/groupBy 整体替换
  addHypotheses?: HypothesisProposal[];
  addChoices?: ChoiceProposal[];
  dispositions?: DispositionProposal[];
  evidence?: UntrustedEvidenceInput[];
}

// 修订记录：追加取代历史
interface Supersession { targetId: HypothesisId | ChoiceId; replacementIds: NonEmpty<HypothesisId | ChoiceId>; reason: string }
AnswerRevisionRecord.supersessions?: readonly Supersession[];

// Revision 视图：模型需要看到稳定 ID 才能处置
interface HypothesisView { id; kind; statement; affects; status: "unresolved" | "supported" | "refuted" }
interface ChoiceView { id; affects; alternatives; status: "unresolved" | "selected" | "provisional"; alternativeId? }
AnswerRevisionView += { parentRevisionId?, hypotheses: HypothesisView[], choices: ChoiceView[], inferredFacets: FacetName[] }

// 发布披露
PublicationDisclosure.inferredFacets?: readonly FacetName[];
```

`HypothesisProposal.proposedEvidenceIds` 和 `ChoiceProposal.selectionEvidenceIds` 保留，但只能解析为 Evidence ID 或同一次调用的证据 `localId`。

`AnswerSpecProposal` 中带值的槽位可以写成 `{ value, hypothesisId }` 或 `{ value, evidenceIds }`，两者不能同时出现。

## 4. 证据准入（`answering/evidence-admission.ts`，新增）

新增受信端口，由组合根注入到 `InMemoryAnsweringOptions.evidenceSource`：

```ts
export interface EvidenceSource {
  /** 只返回该 Session 中用户角色消息的文本；否则返回 undefined */
  readUserMessage(sessionId: string, messageId: string, signal?: AbortSignal): Promise<string | undefined>;
  /** 只解析组合根授权的文档；authority 由组合根配置 */
  readDocument?(sourceRef: string, signal?: AbortSignal): Promise<{ kind: "task_document" | "reviewed_definition"; content: string } | undefined>;
}
```

`admitEvidence(inputs, { sessionId, taskRequestMessageId, source, signal })` 在事务**之前**执行，按种类处理：

| 种类 | 来源绑定 | 核验 | 失败 |
| --- | --- | --- | --- |
| `request_wording` | Runtime 强制使用任务的原始请求消息，忽略输入的 `sourceRef` | 引文必须出现在原始请求中 | `EVIDENCE_REJECTED` |
| `user_confirmation` | 使用输入的 `sourceRef`（工具层用 Host 的当前操作消息 ID 覆盖），且不能等于原始请求消息 | 引文必须出现在该用户消息中 | `EVIDENCE_REJECTED` |
| `task_document` / `reviewed_definition` | `sourceRef` = knowledgeId，必须由 `readDocument` 解析，且解析得到的种类等于声明的种类 | 引文必须出现在文档内容中 | `EVIDENCE_REJECTED` |
| `schema_fact` | 模型提供 `sourceRef` | 不核验（剩余风险），只能支持 `physical_mapping`/`data_property` | 缺少 `sourceRef` 时拒绝 |
| `query_observation` | 只能由探索查询登记 | 不适用 | begin/revise 输入中出现即拒绝 |

引文比较：两边都做 NFKC 规范化，把连续空白折叠为单个空格并去掉首尾空白；规范化后引文至少 2 个字符，且必须是原文的子串。核验通过后，Runtime 用原文全文的哈希覆盖 `contentHash`，并写入 `verification`。

`qualifyEvidence()` 新增一条前置规则：文本类证据如果缺少 `verification` 或 `quote`，抛出 `EVIDENCE_NOT_VERIFIED`。因此，`begin` 自动登记的无引文题面证据只作为 SpecFeedback 的输入，不再具备资格。

证据引用解析 `resolveEvidenceRef(ref, registered, localIds)`：先查同一次调用的 `localId`，再查本任务已登记的 Evidence ID，都找不到就抛出 `EVIDENCE_REJECTED`。**不再按 `sourceRef` 匹配。**

## 5. 修订状态转移（`answering/transition.ts`，新增）

`applyRevision(previous, input, evidence)` 是纯函数，返回新的 `AnswerRevisionRecord` 主体，或抛出 `SPEC_TRANSITION_INVALID`/`EVIDENCE_REJECTED`：

1. 复制上一版的 `spec`、`hypotheses`、`choices`、`resolutions` 和 `choiceResolutions`。
2. 预处理 `supersede`：目标必须是上一版中存在的项，并且不能被重复处置。
3. 创建新增项（`addHypotheses`/`addChoices`），规则与 `begin` 一致，包括内联的 `proposedEvidenceIds`/`selection`。
   - 如果新增项与未被取代的现有项重复（Hypothesis：`kind` 和规范化后的 `statement` 相同；Choice：规范化后的备选陈述集合相同），拒绝，并在错误信息中给出现有 ID。
4. 应用处置：
   - `support`/`refute`：目标必须是现有的未决 Hypothesis，至少一条证据通过 `qualifyEvidence`，否则拒绝。
   - `select`：目标必须是现有的未决 Choice，备选项必须属于该 Choice，至少一条证据按业务语义矩阵合格。
   - `provisional`：目标必须是现有的未决 Choice；受影响槽位包含 `entity` 或 `filters` 时拒绝。
   - `supersede`：`replacementIds` 可以是本次新增项的 `localId`，也可以是现有且未被取代的项（不能是目标本身）；所有替代项 `affects` 的并集必须覆盖目标的 `affects`。满足后从新版中移除目标及其 Resolution，并记录 `Supersession`。已决项同样可以被取代，相当于用新表述重新开启。
   - 已决项不接受 `support`/`refute`/`select`/`provisional`；需要改判时使用 `supersede`。
5. 应用槽位补丁：只替换 `input.spec` 中出现的键。槽位的 `hypothesisId` 可以引用本次新增项的 `localId`，也可以引用现有 Hypothesis 的 ID。
6. 校验：
   - 依据为 `hypothesis` 的槽位，所指 Hypothesis 必须仍在新版中，且未被反驳；否则拒绝，并提示在同一次修订中更新该槽位。
   - `assertContinuity(previous, next, dispositions, supersessions)` 检查 I1 和 I2。它是防御性断言，正常路径下不会触发。
7. 修订失败时整个事务回滚，不消耗修订预算，不写入证据。

`begin` 复用第 3、5、6 步（上一版为空），行为与现在一致，只是证据走准入流程、槽位依据如实标注。

## 6. 槽位依据（`buildSpec`/`proposalFacet`）

| 输入 | 依据 |
| --- | --- |
| `{ value, hypothesisId }` | `hypothesis` |
| `{ value, evidenceIds }` | `evidence`：每个 ID 都必须能解析，并且是已核验的文本证据、`schema_fact` 或 `query_observation` |
| 纯值 | `inference` |
| `null` / `unknown` / `not_applicable` | 与现状相同 |

`inferredFacets(spec)` 返回依据为 `inference` 的槽位名。它不阻断结果查询，但会出现在 Revision 视图和发布披露中，披露文案为："以下槽位为模型推断、未绑定合格证据：…"。

## 7. 工具层（`tools/answering.ts`）

- `begin` 的 schema 保持 `spec/hypotheses/choices/evidence`；证据项新增 `localId`，`sourceRef` 改为可选。
- `revise` 的 schema 改为 `taskId, baseRevisionId, spec?, addHypotheses?, addChoices?, dispositions?, evidence?`，并设置 `additionalProperties: false`，旧式 `hypotheses`/`choices` 会直接被 schema 拒绝。
- 槽位对象接受 `{ value, hypothesisId? , evidenceIds? }`。
- 模型提交的 `user_confirmation`，其 `sourceRef` 一律由工具层用 `toolContext.requestMessageId` 覆盖；缺少该值时拒绝。
- 模型提交的 `request_wording`，其 `sourceRef` 被忽略。
- 返回文本继续输出完整视图 JSON，其中包含 `hypotheses`/`choices` 的 ID、状态和 `inferredFacets`。

## 8. 组合根

- `DataAgentSessionRuntimeOptions` 和 `DataAgentSessionApplicationOptions` 新增 `answeringEvidenceDocuments?: Readonly<Record<string, "task_document" | "reviewed_definition">>`（键为 knowledgeId）。
- `createDataAgentSessionHost` 构造 `EvidenceSource`：
  - `readUserMessage` 复用 `readOriginalQuestion` 的读取逻辑，只接受用户角色消息，并校验 sessionId 与当前 Session 一致。
  - `readDocument` 只解析配置中列出的 knowledgeId，内容取自 `KnowledgeIndex.getDocument()`。
- 产品组合根（`data-agent-application.ts`）配置 `{ "business-definitions": "reviewed_definition" }`：`doc/business.md` 是 `CANONICAL_DOCS`，模型不可写入；knowledgeId 重复时加载会失败，无法被草稿冒用。
- Spider2（`evaluations/spider2/run.mjs`）配置 `{ "business-definitions": "task_document" }`：外部知识由任务提供，不是经过审核的定义。
- `semantic-guide`、`sql-rules`、`learning-notes`、`query-patterns`、`database-schema` 不配置为业务证据。

## 9. 提示（`answer-spec` Skill 与 `.pi/SYSTEM.md`）

系统提示词按身份、任务分类、准则、风格组织：只保留不依赖 Skill 的硬规则，并把数据查询路由到 `answer-spec`。知识库目录、Skill 目录和工具目录由运行时在每次请求时注入。Skill 设置 `requires-tools`，所需工具未启用时（如消融组）既不列出也不能加载。协议细节写在 `.agents/skills/answer-spec/SKILL.md` 中，与修订和证据相关的规则如下：

- `revise` 只提交变化：槽位补丁、`addHypotheses`/`addChoices`、`dispositions`。不要重复提交已有项；未提及的项会原样保留。
- 未决项只能通过 `support`/`refute`/`select`（需要合格证据）、`provisional`（会披露，不适用于总体选择）或 `supersede`（新项承接）离开未决状态。
- 证据：题面和用户澄清提供逐字引文；文档证据填写 knowledgeId 和逐字引文。系统会核验引文，核验失败的证据会被拒绝。不要提交 `query_observation`。
- 槽位值有合格依据时，使用 `evidenceIds` 或 `hypothesisId`；否则会标记为推断并在发布时披露。

## 10. 兼容性

- 旧快照：缺少 `verification` 的文本证据保留原样，但不再具备资格；已封存的 Revision、Candidate 和 Receipt 不受影响。
- 旧快照中依据为题面证据的槽位按原样读取，不重写；`inferredFacets` 只统计 `inference` 依据。
- `semanticQualificationMode="bypassed"`（消融）不变。
- `frontend/electron-host/main.cjs` 是构建产物，重新构建后同步，不手工修改。

## 11. 测试清单

纯函数（`transition.test.ts`、`evidence-admission.test.ts`）：

1. 修订省略未决 Choice/Hypothesis 时，新版仍包含它们，ID 和 Resolution 不变，门禁继续阻断（复现 `local141`）。
2. `supersede` 在替代项覆盖 `affects` 时成功，覆盖不足时拒绝；被取代项及其依赖槽位的处理符合第 5 节。
3. `support` 只引用自动登记的题面证据（无引文）时拒绝。
4. 引文不在原文中时拒绝 `request_wording`；引文在原文中时通过，并写入 `verification`。
5. `user_confirmation` 引用原始请求消息时拒绝；引用后续用户消息并且引文匹配时通过。
6. `task_document` 引用未授权的 knowledgeId，或声明种类与配置不符时拒绝。
7. 按 `sourceRef` 引用证据时拒绝；按 `localId` 或 Evidence ID 引用时通过。
8. `provisional` 用于影响 `filters` 的 Choice 时拒绝。
9. 新增项与现有项重复时拒绝，并在错误信息中给出现有 ID。
10. 依据为 `hypothesis` 的槽位，在所指假设被反驳或取代后未同步更新时拒绝。
11. 修订失败后不写入证据，不消耗修订预算。

服务与工具：

12. `revise` 只提交槽位补丁时，其他槽位和全部未决项保留。
13. 纯值槽位的依据为 `inference`，发布披露包含 `inferredFacets`。
14. 工具层旧式 `revise` 参数（`hypotheses`）被 schema 拒绝。
15. 工具层 `user_confirmation` 的 `sourceRef` 被 Host 消息 ID 覆盖。
16. 已有的 Answering、委派、SpecFeedback、Session 集成测试迁移到新接口后全部通过。

## 12. 验收

- `packages/runtime` 类型检查通过，`vitest` 全部通过。
- 用 `local141` Trace 的调用序列在单元测试中重放：省略未决项后，结果查询被 `UNRESOLVED_ASSUMPTIONS` 阻断。
- 更新 `CONTEXT.md` 中的 Spec Authority、Spec Change Proposal、Hypothesis Handling Status 等术语，并新增 Disposition、Supersession、Evidence Admission、Inferred Facet。
- Spider2 端到端复评不在本次提交内；上线前需跑一轮 required 模式小样本，观察修订被拒绝的比例和披露率。

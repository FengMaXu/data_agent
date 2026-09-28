# Answer Plan 后续加固：探索证据桥与总体决策完整性

日期：2026-09-11

## 背景

local061 Control/Treatment Trace 表明，原机制能把总体选择登记为 provisional Decision，但存在三处断点：

1. exploration Artifact 已被 Runtime 注册为 `observed_data`，却没有把可引用证据句柄返回给 Agent；
2. `assumptionVector` 直接采用调用方计数，没有 Runtime 可复核来源；
3. material population alternatives 在全部实质阶段平局后，可由 canonical stable-order 产生选择并关闭 hypothesis。

本次只修复上述接口与生命周期缺口，不建设自然语言语义证明器，也不把观测数据升级为业务定义。

## 1. 探索观测证据桥

`recordPreview` 仍是 query observation 的唯一注册者。每个 Query Artifact 生成并保存：

```text
observationEvidenceId = EV-Q-<queryArtifactId>
authority = observed_data
payloadRef = query-artifact:<queryArtifactId>
```

`query_database(mode=exploration)` 在文本和结构化 details 中返回该不透明 `observationEvidenceId`；组合式 initial exploration 也在 `update_answer_spec` 回执中返回。

后续 hypothesis/Decision 只能原样引用这个 ID。`reviseSevenFacets` 继续按 task scope 检查 Evidence 是否真实存在，猜测 ID 或自然语言证据说明会得到 `DECISION_EVIDENCE_REF_UNAVAILABLE`。

权威边界保持不变：

- observed data 可绑定现象和影响；
- 没有 Host-owned Verification 时不产生 `supported/refuted` qualification；
- 即使形成 observed-data qualification，也不能得到 `selectionBasis=evidence`；
- 不自动生成业务语义 Verification，不持久化原始探索行。

## 2. assumptionProfile 与向量一致性

当前模型写协议增加 `assumptionProfile`。五个维度分别保存稳定、去重的假设 ID 列表；未知维度使用 `null`：

```json
{
  "unsupportedPopulationExclusions": ["cross-period-intersection"],
  "unsupportedAmountComponentAdditions": [],
  "unsupportedWeightingRules": [],
  "unsupportedDenominatorRules": [],
  "otherUnsupportedAssumptions": []
}
```

Runtime：

1. 规范化并排序 assumption IDs；
2. 拒绝空白、控制字符、超长和规范化后重复 ID；
3. 从每个列表长度派生 `assumptionVector`，`null` 保持为 `null`；
4. 拒绝负数、小数、非有限数、缺失值和 profile/vector 不一致；
5. Alternative identity 与 selection input hash 使用规范化 profile 和派生 vector。

主要错误码：

```text
DECISION_ASSUMPTION_PROFILE_INVALID
DECISION_ASSUMPTION_VECTOR_INVALID
DECISION_ASSUMPTION_VECTOR_MISMATCH
```

该检查证明表示一致性，不证明模型把某条业务假设放进了正确维度。

## 3. material population stable-order guard

当前模型写协议要求 Decision 声明 `affectedAspects`。绑定 `/entity`、`/filters[/n]` 的 Decision 必须包含 `population`；通过 `/metric` 影响总体的 Decision也应显式声明。

material population provisional selection 还要求每个剩余 alternative 提交：

```text
normalizedSemantics.populationPolicy
normalizedSemantics.populationEffect = preserve | restrict | expand | unknown
assumptionProfile
```

Runtime 对声明与派生向量执行有限、确定性的结构一致性检查，不从自由文本推断业务含义。

选择顺序仍为：

```text
qualified exclusion
→ authoritative support
→ semantic integrity
→ minimum assumptions
→ frozen defaults
```

如果以上阶段后仍有多个 material population alternatives：

```text
stable-order 只保留规范展示顺序
→ selectionState=pending_clarification
→ resolutionState=provisional_unresolved
→ selectedAlternativeId 不存在
→ stableOrderBlocked=true
→ 相关 hypothesis 保持 unresolved/unhandled
```

result/converge/publication 在物理执行或发布前返回专用错误或 warning：

```text
RESULT_DECISION_MATERIAL_POPULATION_TIE_UNRESOLVED
DECISION_MATERIAL_POPULATION_TIE_UNRESOLVED
PUBLICATION_DECISION_MATERIAL_POPULATION_TIE_UNRESOLVED
```

非总体 Decision 保留原 stable-order 行为；有唯一权威支持、最小假设或冻结默认的总体 Decision 仍可选择。

## 4. Runtime ownership 与版本

模型工具 schema 不接受 `selectedAlternativeId`、`selectionTrace` 等选择结果。Agent adapter 只把 raw proposals 交给 QueryAssurance；literal policy 的选择由 Runtime 执行。

可信 Host 回放可传入带当前版本 trace 的 Runtime selector 结果；模型提交的无 trace selected 字段会被重新计算。trace 版本和 material-population stable selection 另有防御性校验。

版本更新：

```text
answer-plan-tools-v4
answer-plan-p6-evidence-decision-integrity
decision-normalization-v2
literal-minimum-assumption-v2
literal-defaults-v2
```

Query Assurance 持久化 identity 增加 Decision normalization/selection/default 版本。旧 identity 不会静默复用到新决策策略。

## 5. 语义指引

`knowledge/doc/semantic_guide.md` 新增 S14“跨期实体集合与未匹配期间”，要求：

- 分别定义各期实体集合；
- 区分交集、基期锚定、目标期锚定、并集和业务全集；
- 区分缺席、NULL、零活动和零分母；
- 区分增长率有效集合与最终聚合总体；
- 观测集合差异只证明选择 material，不裁决业务意图；
- JOIN、透视和 NULL 过滤必须实现先前记录的集合政策。

专题索引和最终检查清单已同步。

## 6. 定向验收

覆盖文件：

- `decision-selection.test.ts`
  - profile 派生、null、重复、非法数值和 mismatch；
  - population effect 结构完整性；
  - material population stable tie 保持 pending；
  - 唯一权威支持仍可选择；
  - 非总体 stable fallback 兼容。
- `query-assurance.test.ts`
  - exploration Artifact 返回 observation evidence handle；
  - raw caller selection 由 Runtime 重算；
  - material population tie 在 generic hypothesis block 前返回专用 result error。
- `unresolved-hypothesis-local061.test.ts`
  - exploration handle 可被 Decision 引用；
  - stable tie 不能将 H6 标为 handled；
  - 有可区分的结构化附加假设后才形成 provisional selection 和交付。
- `tools-catalog.test.ts`
  - 当前模型 schema 要求 `affectedAspects`、`assumptionProfile`、`assumptionVector`。

执行结果：

```text
npm run build:runtime                                      PASS
npm test --workspace=@data-agent/runtime -- --run          60 files PASS
                                                           438 passed, 1 skipped
npm test                                                   all workspace builds PASS
                                                           506 passed, 2 skipped
npm run test:eval:spider2                                  45 passed
```

## 7. 残余风险

1. 模型仍可能给 assumption atom 错误分类；当前机制只验证计数来源和结构一致性。
2. `affectedAspects` 对仅绑定 `/metric` 的总体影响仍依赖 Agent 声明；`/entity`、`/filters` 有确定性补充检查。
3. exploration evidence 不保存原始行；跨进程需要精确复核值时，应按 snapshot/Artifact 重跑或建设受控 bounded payload。
4. 禁止 stable-order 关闭 material population 会增加需要澄清或非交付的案例；这是预期安全变化，尚未执行新的 Spider2 A/B。
5. 本次没有证明 local061 的 Gold 口径，也没有声称正确率提升；只证明原 Trace 中的三条失效路径已被封住。

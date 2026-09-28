# local061 未决假设改动无效 Trace 复盘

> 分析对象仅为已有运行，没有追加评测：
>
> - Control：`C:\data-agent-eval\runs\unresolved-hypothesis-block-control-10-001\cases\local061`
> - Treatment：`C:\data-agent-eval\runs\unresolved-hypothesis-block-local061-001\cases\local061`

## 1. 结论

改动并非没有执行，而是：

```text
控制面生效
→ H3 被显式登记、提醒、形成 Decision、标记 handled、绑定 Artifact/Receipt

数据面未纠偏
→ D2 仍选择“2019/2020 都存在才纳入”
→ 最终 SQL 仍采用年度交集总体
→ Control/Treatment CSV 完全相同
→ 官方正确率仍为 0
```

根本原因是当前机制只保证“不得静默选择”，不保证“选择正确”。`provisional_selected/handled` 是生命周期完成标记，不是业务验证。

## 2. Treatment 事件链

| sequence | 事件 | 影响 |
|---:|---|---|
| 15 | 初始 Spec 将 H3 写成“缺少 2019 或 2020 时不参与预测” | H3 从一开始就是偏向旧答案的断言，不是中立歧义 |
| Hook rev2 | 提醒 H1/H2/H3/H4/HY-5 unresolved | Hook 确实触发，但只重复已有假设，没有新增判别证据 |
| 34 | 观测 2019 产品月 618、2020 产品月 793 | 证明年度集合不一致 |
| 35 | 逐月观测大量 miss2019/miss2020，zero2019 全为 0 | 证明缺失政策会改变总体，且不是零分母数据问题 |
| 36 | 测试“两年都有记录才纳入” | 1 月 47 个产品，结果 4054.99 |
| 39 | 测试“缺 2020 补零、仍要求 2019 非零” | 1 月 51 个产品，结果 3736.96；证明候选口径有实质差异 |
| 40 | 尝试提交 Decision evidence refs | 被 `DECISION_EVIDENCE_REF_UNAVAILABLE` 拒绝 |
| 41 | 删除 evidence refs 后 revision 3 成功 | H1/H2/H4 handled；H3 因 D2 未引用它而仍 unhandled |
| Hook rev3 | 仅提醒 H3 | Agent 的响应是补引用，而非重新判断哪一口径正确 |
| 42 | D2 两个 alternatives 都引用 H3 | H3 立即变成 `provisional_selected/handled` |
| D2 selection | 两个 alternatives 的 assumptionVector 完全相同 | 无权威证据、无默认规则，最终 `stable_order` 选中“缺失即排除” |
| 43 | result 因 `RESULT_HYPOTHESIS_REF_UNKNOWN` 失败 | 只是 HY-5 引用问题，不是语义纠偏 |
| 44 | 清除有问题引用，生成 revision 5 | D2 选择不变 |
| 45–46 | result SQL 与 CSV 成功 | SQL 仍含 `sales_2019 IS NOT NULL`、`sales_2020 IS NOT NULL`，实施年度交集 |

## 3. 为什么提醒没有改变答案

### 3.1 提醒没有提供新信息

Hook 的内容是要求重新检查假设和参考文档。Agent 在提醒前已经采用“公式需要 2019 与 2020，因此缺失即排除”的直觉。提醒只增加了反思指令，没有提供能够区分总体政策的权威业务证据。

因此它能促使 Agent 多写 Spec/Decision，却不能推翻原先判断。

### 3.2 H3 被写成答案，而不是问题

初始 H3 不是：

```text
缺失年度应排除、补零，还是采用其他总体？
```

而是：

```text
缺少 2019 或 2020 时不参与预测。
```

这会产生锚定效应。后续 Hook 复述 H3，实际上强化了旧口径。

### 3.3 探索证据没有进入 Runtime-owned Verification

sequence 34–39 已经得到有价值事实：

- 2019 与 2020 产品月集合不同；
- 每个月存在大量缺年；
- 两种处理会改变分母和结果。

但 sequence 40 的 evidence refs 被拒绝。Agent 为完成更新，只能删除 evidence refs。最终 D2：

```text
claimRefs=[]
evidenceRefs=[]
refutingEvidenceRefs=[]
H3.verificationRefs=[]
```

所以 Decision selector 看不到这些探索事实。

即使这些事实成功登记，它们也只能证明“该选择是 material”，不能独立证明哪种总体符合业务意图；但当前实现连 materiality 证据桥也没有形成。

### 3.4 Decision selector 无法区分两个候选

D2 alternatives：

- A：2019 与 2020 均存在才参与，缺失即排除；
- B：缺失年份视为 0，仍要求 2019 非零。

两者的五维 `assumptionVector` 都是全 0：

```json
{
  "unsupportedPopulationExclusions": 0,
  "unsupportedAmountComponentAdditions": 0,
  "unsupportedWeightingRules": 0,
  "unsupportedDenominatorRules": 0,
  "otherUnsupportedAssumptions": 0
}
```

因此：

```text
qualified_exclusion 无法区分
→ authoritative_support 无法区分
→ minimum_assumption 无法区分
→ frozen_default 不适用
→ stable_order 选 A
```

最终 Receipt 明确记录 `usedStableOrderFallback=true`。

问题不是排序不稳定，而是稳定排序在没有业务证据时承担了事实上的业务裁决。

### 3.5 “handled”门槛太弱，允许无证据 provisional selection 放行

只要选中的 alternative 引用 H3，Disposition 就变为：

```text
status=provisional_selected
handlingStatus=handled
verificationRefs=[]
```

Result Boundary 只阻止 `unhandled`，不会判断 provisional Decision 是否正确。因此 D2 一旦有选择，result SQL 就可执行。

这符合当前方案“避免静默选择”的边界，但解释了为什么正确率不升。

### 3.6 候选集合本身没有覆盖 Gold 口径

Agent 实际比较了：

- 两年交集：1 月 4054.99；
- 缺 2020 补零：1 月 3736.96。

Gold 1 月为 4120.33。也就是说，即使 D2 选了 B，仍不会得到 Gold。当前机制只能从 Agent 提交的 alternatives 中选择，不能修复遗漏的候选解释。

### 3.7 最终复核对复杂总体不可见

最终 SQL 通过透视后的：

```sql
WHERE sales_2019 IS NOT NULL
  AND sales_2019 <> 0
  AND sales_2020 IS NOT NULL
```

改变产品月总体。但该查询超出当前 bounded G2 population coverage；Reviewer 又未配置。系统没有第二条通道识别“派生 CTE 中的 NULL 排除正在决定 AVG 分母”。

## 4. 为什么 Control 与 Treatment 最终相同

Control 虽无 Hook，也在探索阶段观测到：

```text
pairs=821
both_years=590
missing_2019=203
missing_2020=28
```

但 Control 没有把该总体问题建模为 hypothesis；它直接认为增长公式要求两年都存在，并写入交集 SQL。

Treatment 的区别只是把该选择登记为 H3 和 D2，最后仍选了同一口径。

两份 SQL文本不完全相同，但业务语义一致，均只保留两年都有记录的产品月。两份 CSV 的 SHA-256 均为：

```text
4b72af4036adb821f09cb1a0dcc5af558938e42c881448f26138e1e3e8bb241b
```

成本则从 Control 的 18 turns / 40 tool calls / 510,679 tokens / 139.3 秒，上升到 Treatment 的 20 turns / 46 tool calls / 596,787 tokens / 203.7 秒。

## 5. 架构根因排序

### P1：目标只覆盖流程完整性，不覆盖语义正确性

当前 Result Boundary 的合同是“所有 material hypothesis 必须 handled”，不是“必须 verified”。因此此次结果对原方案的流程目标有效，对正确率目标无效。

### P1：模型自报 assumptionVector，Runtime 未验证 statement 与向量一致性

“缺失即排除”本身增加了总体排除，但 Agent 将 `unsupportedPopulationExclusions` 标为 0。Runtime 没有从 alternative statement 或 SQL 中校验该向量。

### P1：探索 Artifact 与 Decision/Verification 缺少结构化证据桥

关键探索数据无法作为可引用 evidence；Decision 只能退化为 evidence-free provisional choice。

### P1：material population Decision 可由 stable-order 单独关闭

对于会改变 AVG 分母的总体选择，stable-order 不应单独使 hypothesis 变成 handled。至少需要 Runtime-owned 默认、权威支持、用户确认，或明确标识“仅为无证据执行默认”。

### P2：假设建模方式造成锚定

H3 应描述歧义与候选政策，而不是先写入其中一个答案。

### P2：复杂派生总体不在检测覆盖内

当前检测器无法稳定识别 pivot/CTE 后的 NULL 排除、INNER JOIN 或条件聚合如何改变最终 AVG 分母。

### P2：协议机械错误增加成本但不改变语义

`DECISION_EVIDENCE_REF_UNAVAILABLE`、遗漏 H3 引用和 `RESULT_HYPOTHESIS_REF_UNKNOWN` 造成额外 revision/tool calls；修复的只是绑定完整性。

## 6. 对“改动没效果”的准确表述

不应表述为“Hook 没触发”或“Result Boundary 没工作”。准确结论是：

> 改动成功把 local061 从“静默采用年度交集”变为“显式、可审计地 provisional 选择年度交集”，但没有获得或生成能区分总体政策的权威证据，也没有覆盖真正的 Gold 候选，因此最终 SQL、CSV 和正确率不变，成本上升。

## 7. 后续决策边界

若目标仍是本方案原定义的“防止静默选择”，本次机制已达到最低目标。

若目标改为“提高语义正确率”，仅继续增强提醒文案不会奏效。需要另行设计并验证：

1. 中立歧义建模，而非结论式 hypothesis；
2. exploration observation → materiality evidence 的可信登记桥；
3. alternative statement/SQL 与 assumptionVector 的确定性一致性校验；
4. material population/denominator Decision 禁止仅靠 stable-order 关闭；
5. 针对派生 CTE/NULL/INNER JOIN 的通用 population-effect 表示与检测；
6. 独立留出集评估，证明正确率收益大于 Token/时延成本。

这些属于下一阶段架构，不应被包装成当前方案已经实现的能力。

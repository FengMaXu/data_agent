# local061 假设验证与反例体系缺陷分析

## 1. 结论摘要

local061 暴露的核心问题不是“Agent 没有多查一条 SQL”，而是当前体系没有把以下链路做成可执行、可审计、可阻断的协议：

```text
发现不确定性
→ 定义互斥解释
→ 设计能区分解释的最小反例
→ 取得并登记证据
→ 判断证据只能证明现象，还是足以选择业务口径
→ 修订 Answer Spec / 请求澄清 / 选择临时解释
→ 将最终 SQL 绑定到所选解释
→ 按交付策略发布或阻断
```

在 local061 中，H6 只被登记成候选假设；Agent 随后观察到了跨年度产品月份集合不一致，却没有提供具体反例、没有修订 Spec、没有建立 material Decision，也没有把最终 SQL 绑定到 H6 的某个解释。最终 SQL 通过 `INNER JOIN` 静默选择“两年交集”总体，Runtime 仅将 H6 写入披露文件，并以 `published_with_disagreement` 导出。

因此，当前体系实际做到的是：

> **候选假设登记与结果披露。**

尚未做到的是：

> **假设驱动的反例设计、证据闭环、解释选择和 SQL 语义绑定。**

---

## 2. 分析范围与证据

本文只分析 local061 暴露的机制缺陷，不使用 Gold 作为运行时业务证据，也不据此断言某一种缺失月份政策在业务上必然正确。

主要证据：

- 运行目录：`C:\data-agent-eval\runs\semantic-rules-split-shadow10-001\cases\local061`
- `trace.json`
- `query-assurance-state.json`
- `.pi/SYSTEM.md`
- `knowledge/doc/semantic_guide.md`
- `packages/runtime/src/agent-assembly.ts`
- `packages/runtime/src/query-assurance.ts`
- `packages/runtime/src/counterevidence.ts`
- `packages/runtime/src/disclosure.ts`
- `packages/runtime/src/review-policy.ts`

---

## 3. local061 的关键歧义

题目要求按同一产品、同一月份比较 2019 和 2020 销售额，计算增长率并预测 2021，最后按月份对产品预测值取平均。

H6 识别出的不确定性可还原为：

> 当某产品月份的 2019 销售额为 0 或缺失时，增长率无定义；暂按不参与预测处理，而不是自动补零或采用其他替代值。

H6 会直接改变：

- 产品月份资格总体；
- 每月参与预测的产品集合；
- `AVG` 的分母；
- 最终月度平均预测值。

合理但未经题面或权威文档裁决的候选解释至少包括：

1. 只保留 2019 和 2020 都有记录的产品月份；
2. 以 2019 产品月份总体为准，并定义 2020 缺失政策；
3. 使用两年产品月份并集，并分别定义缺失年度政策；
4. 将缺失视为未知，停止计算并请求业务澄清；
5. 仅在已确认“缺失代表零活动”时补零。

这些解释不是 SQL 写法差异，而是业务总体和分母定义差异。

---

## 4. 实际执行链

| Trace 序列 | 行为 | 观察或结果 | 缺失的闭环动作 |
|---:|---|---|---|
| 14 | 提交 Answer Spec | H6 绑定 `/metric`，但 `facetStatus.metric = explicit`；无 `decisionProposals` | 未把受 H6 影响的指标槽位标为 `hypothesis`；未列出候选解释 |
| 28 | 探索年度产品月份数量 | 2019：618；2020：793；两年聚合销售额为 0 的记录均为 0 | 未抽取具体未匹配产品月份；未说明该证据只能证明集合不一致 |
| 29 | 探索两年交集 | `INNER JOIN` 后仅 590 个产品月份 | 未将“交集缩小总体”登记为 H6 的反证/区分证据；未修订 Spec |
| 31 | 执行结果 SQL | 通过 `INNER JOIN` 只保留两年交集，再按月 `AVG` | 未显式声明选择“交集总体”；SQL 未绑定 H6 或某个 Decision alternative |
| 32 | 导出 | `published_with_disagreement` | H6 只进入 disclosure，未被验证或解决 |

最终结果 Artifact 的假设绑定仅有：

```json
["H1", "H2", "H3"]
```

H4、H5、H6 均未绑定到该 Artifact。

---

## 5. 什么才算 local061 的最小反例

### 5.1 当前探索不是最小反例

下面的统计：

```text
2019 产品月份数 = 618
2020 产品月份数 = 793
两年交集数 = 590
```

只能证明跨年度集合不一致以及 `INNER JOIN` 会缩小总体。它不能回答：

- 哪些产品月份只出现在某一年；
- 不同缺失政策如何处理这些记录；
- 每种政策如何改变月度 `AVG` 分子与分母；
- 哪种政策得到题面或业务证据支持。

因此它是“总体差异的汇总观察”，不是“能区分候选解释的最小反例”。

### 5.2 合格的观测反例

至少应抽取一个真实未匹配产品月份：

```sql
WITH product_month AS (
  SELECT
    s.prod_id,
    CAST(strftime('%m', s.time_id) AS INTEGER) AS month,
    CAST(strftime('%Y', s.time_id) AS INTEGER) AS year,
    SUM(s.amount_sold) AS sales
  FROM sales s
  -- France、promotion、channel 等已确认连接与条件
  WHERE strftime('%Y', s.time_id) IN ('2019', '2020')
  GROUP BY s.prod_id, month, year
), compared AS (
  SELECT
    prod_id,
    month,
    MAX(CASE WHEN year = 2019 THEN sales END) AS sales_2019,
    MAX(CASE WHEN year = 2020 THEN sales END) AS sales_2020
  FROM product_month
  GROUP BY prod_id, month
)
SELECT prod_id, month, sales_2019, sales_2020
FROM compared
WHERE sales_2019 IS NULL
   OR sales_2020 IS NULL
   OR sales_2019 = 0
ORDER BY prod_id, month
LIMIT 5;
```

得到类似下面的一行后，才能展示解释差异：

```text
prod_id=P，month=M，sales_2019=100，sales_2020=NULL
```

| 解释 | 该行是否进入预测 | 对月度 AVG 的影响 |
|---|---|---|
| 两年交集 | 否 | 不进入分子，也不进入分母 |
| 缺失即零 | 是，但只有在业务确认缺失代表零活动后才合法 | 进入分母，预测值按确认公式计算 |
| 缺失即未知 | 暂不计算 | 需要澄清或披露数据不足 |

反例的作用是证明“候选解释会产生不同答案，必须裁决”，而不是从当前数据自动推导业务政策。

### 5.3 合格的合成反例

即使不展示真实业务键，也可以使用内部合成样例检查算法：

```text
产品 A：2019=100，2020=120
产品 B：2019=100，2020=缺失
```

- 交集政策只计算产品 A；
- 补零政策还会处理产品 B；
- 未知政策会要求澄清或保留不可计算状态。

如果不同政策得到不同分母或结果，说明该歧义具有 materiality。合成反例仍不能替代业务证据，但可以阻止 SQL 实现惯例静默决定口径。

---

## 6. 当前假设验证与反例体系的缺陷

### 6.1 “最小反例”只是提示词要求，不是工具协议

`knowledge/doc/semantic_guide.md` 要求选择能区分解释的最小反例，但 `update_answer_spec` 没有强制提交：

- 待区分的候选解释；
- 反例或探针计划；
- 预期区分性质；
- 观测证据引用；
- 证据限制；
- 是否需要修订 Spec。

因此 Runtime 只能确认“存在 H6”，不能确认“是否验证过 H6”。

**后果：** Agent 可以写出一个看似谨慎的假设，然后完全跳过验证步骤。

### 6.2 Candidate Hypothesis 与 facetStatus 缺少一致性约束

H6 绑定 `/metric`，同时 `metric` 被标记为 `explicit`。当前 Runtime 接受这种矛盾状态。

结果查询只把“绑定到 `facetStatus = hypothesis` 的 candidate hypothesis”列为必需引用。因此 H6 被排除在结果 Artifact 的必需绑定之外。

**后果：** 影响指标、分母和总体的候选假设可以通过错误的 facetStatus 标注绕过结果绑定。

### 6.3 Hypothesis 只描述一个暂定结论，没有表示解释空间

H6 的 statement 已经混合了两个部分：

```text
问题：零值或缺失时增长率无定义
暂定处理：排除产品月份，不补零
```

但系统没有要求列出：

- 排除；
- 补零；
- 以某一年为总体；
- 视为未知并澄清。

没有显式 alternatives，就无法定义“什么观测能区分解释”，也无法审计最终 SQL 选择了哪一个解释。

**后果：** 假设容易退化成对 SQL 实现的事后描述。

### 6.4 探索证据没有强制绑定到假设或 Decision

序列 28、29 明确观察到年度集合不一致，但探索 Artifact 没有被结构化绑定为：

```text
H6 / 某个 Decision
→ 证据内容
→ 支持或反驳什么
→ 仍不能证明什么
```

当前 Answer Session 虽有 Claim、Verification 和 Evidence 结构，但 Agent 的普通探索 SQL 不会自动形成这种语义验证记录。

**后果：** Agent 看到了关键证据，Runtime 却无法知道该证据是否改变了 Spec。

### 6.5 缺少“新证据触发 Spec 修订”的可执行检查点

系统提示词要求探索证据改变槽位、状态、假设或绑定时修订 Spec。local061 在观察到 618、793、590 后没有再次调用 `update_answer_spec`。

Runtime 没有可判定的状态来表达：

```text
该探索与 H6 相关
→ 已确认差异具有实质影响
→ 当前 revision 已过时
```

因此旧 revision 仍被视为最新且可执行。

**后果：** “最新 revision”只能保证版本身份最新，不能保证它吸收了最新探索证据。

### 6.6 Runtime 反证规则覆盖面过窄，且不是假设导向

当前默认 Counterevidence 规则只有：

- `observed_join_fanout`；
- `unauthorized_population_exclusion`；
- `final_scalar_shape`。

local061 的关键风险是：

```text
跨期集合不一致
+ INNER JOIN 剔除未匹配产品月份
+ 月度 AVG 分母被交集隐式决定
```

这不等同于 Join fanout，也不只是顶层物理过滤。当前规则没有针对“跨期集合与分母变化”的假设定向探针。

最终 Artifact 中相关检查返回 `unsupported`，没有生成实际反例或 population effect。

**后果：** 最需要检查的总体差异恰好落在检测覆盖之外。

### 6.7 Counterevidence 明确为 observational-only

`CounterevidenceOutcome.blocking` 固定为 `false`。即使检测到反证，当前设计也只用于记录或披露。

**后果：** “检测到反例”与“阻止错误口径交付”之间没有执行关系。

这可以是 Shadow 阶段的有意设计，但不能把它表述为已经建立了假设验证门禁。

### 6.8 结果执行阻断只检查 Decision，不检查普通 H6

`assertResultDecisionExecutable` 只检查 `spec.decisions` 中的 material Decision。local061 没有提交 `decisionProposals`，所以待处理 Decision 集合为空。

**后果：** 只要 Agent 把业务歧义写成 Hypothesis 而不是 Decision，就能绕过 Decision 澄清/选择机制。

### 6.9 无澄清环境退化为 literal-with-disclosure，但 H6 没有进入离线选择

没有 clarification capability 时，系统采用 `literal-with-disclosure-v1`。如果存在 Decision，Runtime 可以对 alternatives 执行离线最小假设选择，并记录 provisional selection。

local061 没有 Decision，因此：

- 没有 alternatives；
- 没有 selection trace；
- 没有 selectedDecisionRef；
- 没有说明为何“两年交集”是最字面的解释。

**后果：** “最字面解释”没有被协议化，实际由 Agent 写出的 SQL 偶然决定。

### 6.10 SQL 选择了 H6 的一种政策，但 Artifact 没有绑定该选择

最终 SQL 使用：

```sql
FROM a
JOIN b
  ON b.prod_id = a.prod_id
 AND b.mon = a.mon
```

这实现了“两年交集”政策。然而最终 Artifact 只绑定 H1、H2、H3，没有绑定 H6，也没有绑定对应 Decision alternative。

**后果：** Runtime 能证明“SQL 属于某个 Spec revision”，却不能证明“SQL 实现了被选中的缺失月份政策”。

### 6.11 独立 Reviewer 不可用，确定性 Gate 也未覆盖

本次回执记录：

```text
REVIEWER_NOT_CONFIGURED
G2 population: not_applicable
Query is outside the bounded G2 v1 query class
```

因此没有独立组件对 `INNER JOIN` 缩小 AVG 总体提出有效 Semantic Diff。

**后果：** 主 Agent 的错误没有第二条有效检测路径。

### 6.12 发布策略将未解决问题降级为披露

当前 `DeliveryPolicy` 对所有 Review Outcome 返回 `allowed: true`；非 Approved 结果以 `published_with_disagreement` 发布。

H6 最终出现在 `.disclosure.json` 中，但没有在导出前得到解决。

**后果：** 系统可以证明“已经披露风险”，不能证明“已经验证假设”。披露完整度容易被误当成语义保障。

### 6.13 评测指标没有充分惩罚“有假设、无反例、无选择”

现有评测能统计候选假设和 disclosure miss，但不足以区分：

- 仅登记假设；
- 提供汇总观察；
- 提供可区分解释的最小反例；
- 将证据绑定到 Claim/Decision；
- 修订 Spec；
- 将 SQL 绑定到所选 alternative。

**后果：** 系统可能提高“假设披露率”，却没有提高假设验证率或最终 SQL 正确率。

---

## 7. 根因分层

| 层级 | 根因 | local061 表现 | 严重性 |
|---|---|---|---|
| Prompt | 反例要求没有结构化输出契约 | Agent 阅读了 semantic guide，但没有提供最小反例 | 高 |
| Spec | Candidate 与 explicit facet 可并存 | H6 绑定 `/metric`，`metric` 仍为 `explicit` | 严重 |
| 假设模型 | 没有强制 alternatives/materiality | H6 是单句暂定结论，不是可裁决解释集合 | 严重 |
| Evidence | 探索结果不绑定 Claim/Decision | 618/793/590 没有进入验证记录 | 高 |
| Revision | 新证据未使旧 Spec 失效 | 观察总体差异后仍使用 revision 2 | 严重 |
| Counterevidence | 缺少跨期集合/分母规则 | 未检测 INNER JOIN 对月度 AVG 总体的影响 | 严重 |
| SQL binding | Artifact 不绑定 H6 的实现分支 | Artifact 只有 H1–H3 | 严重 |
| Review | Reviewer 不可用且 Gate 不适用 | 没有独立 Semantic Diff | 高 |
| Delivery | 所有结果均 fail-open | 未解决 H6 仍然导出 | 取决于环境策略；对严格场景为严重 |
| Evaluation | 假设登记率替代验证闭环指标 | 披露 H6 可能被计为流程覆盖 | 高 |

---

## 8. 建议的目标协议

### 8.1 区分三种概念

系统应明确区分：

1. **最小区分样例**：用于证明两种解释会产生不同结果，可以是合成样例；
2. **观测反证**：来自只读探索，证明当前数据中确实存在触发该差异的记录；
3. **业务裁决证据**：来自用户、审核业务定义或其他权威来源，用于选择解释。

观测反证可以确认 H6 具有实际影响，但不能自动授权补零、排除或 INNER JOIN。

### 8.2 将 material Hypothesis 提升为 Decision

对 H6 这类会改变总体、分母、Join 或缺失处理的假设，要求提交 material Decision，例如：

```json
{
  "decisionId": "D-missing-product-month-policy",
  "facetPaths": ["/entity", "/metric"],
  "materiality": "material",
  "alternatives": [
    {
      "statement": "仅保留2019和2020均有销售记录的产品月份",
      "normalizedSemantics": {
        "populationPolicy": "intersection of 2019 and 2020 product-month sets",
        "denominatorPolicy": "matched product-months only"
      }
    },
    {
      "statement": "以已确认业务总体为准，并对缺失年度按业务定义处理",
      "normalizedSemantics": {
        "populationPolicy": "business-defined product-month universe",
        "denominatorPolicy": "business-defined missing-period policy"
      }
    }
  ]
}
```

### 8.3 为 Decision 绑定验证计划

建议增加 Runtime-owned 或工具协议字段：

```json
{
  "validationPlan": {
    "targetDecisionId": "D-missing-product-month-policy",
    "discriminator": "find a product-month present in only one comparison year",
    "expectedDifference": "alternatives differ in inclusion and AVG denominator",
    "evidenceLimit": "observed rows establish materiality but do not select business policy"
  }
}
```

### 8.4 强制证据吸收检查点

当定向探针发现候选解释确实产生不同总体时，任务状态应进入：

```text
spec_revision_required
```

在 Agent 提交包含以下内容的新 revision 前，不允许结果查询：

- 更新后的 facetStatus；
- Decision alternatives；
- 证据引用；
- 澄清结果或 provisional selection；
- 明确的证据限制。

### 8.5 将 SQL 绑定到 Decision alternative

最终 Artifact 应记录：

```json
{
  "selectedDecisionRefs": [
    {
      "decisionId": "D-missing-product-month-policy",
      "alternativeId": "ALT-intersection"
    }
  ]
}
```

Query Digest/Reviewer 至少应核对：

```text
ALT-intersection ↔ INNER JOIN on prod_id + month
ALT-left-baseline ↔ LEFT JOIN from baseline population
ALT-union ↔ FULL OUTER JOIN / equivalent union construction
```

不能只校验 revision/hash 身份。

### 8.6 按环境区分交付策略

- **无交互评测模式**：允许 provisional literal selection，但必须有 Decision、selection trace、SQL alternative binding 和 disclosure；
- **交互业务模式**：material Decision 未获用户或权威证据确认时请求澄清；
- **严格模式**：未解决 material Decision、Reviewer 不可用或关键 Gate unsupported 时禁止发布；
- **Shadow 模式**：可以发布，但必须明确标记“仅披露，未验证”，不得计入已验证成功。

---

## 9. 建议的修复优先级

### P0：阻止 silent choice

1. 拒绝或警告“candidate hypothesis 绑定到 `explicit` facet”的矛盾 Spec；
2. 对影响总体、分母、Join、缺失处理的 candidate 强制 material Decision；
3. 结果 SQL 必须绑定所选 Decision alternative；
4. 没有 alternative binding 时禁止将结果标记为语义已收敛。

### P1：建立反例闭环

1. 为 Decision 增加区分性验证计划；
2. 将探索 Artifact 绑定到 Claim/Decision；
3. 增加“跨期集合不一致/未匹配剔除/AVG 分母变化”探针；
4. 观测到 material population effect 后要求修订 Spec。

### P2：完善交付与评测

1. 让严格交付策略真正消费 `allowed`/阻断结论；
2. 分开统计 disclosure、verification、decision resolution 和 SQL binding；
3. 增加当前 local061 Trace 的回放回归测试；
4. 在独立留出集验证修复是否提升语义正确率，避免只提升非交付率。

---

## 10. 回归验收标准

以 local061 构造最小回放测试，至少验证：

- [ ] H6 绑定 `/metric` 时，不允许 `facetStatus.metric = explicit` 且 H6 仍为 material candidate；
- [ ] Agent 必须提交至少两个互斥 alternatives，或明确登记无法形成可执行解释；
- [ ] 系统能产生一个具体未匹配产品月份或等价合成反例；
- [ ] 反例明确展示 alternatives 对资格总体和 AVG 分母的不同影响；
- [ ] 观测数据只确认 materiality，不自动升级为业务裁决证据；
- [ ] 发现 2019/2020 集合不一致后，旧 revision 不能直接用于结果查询；
- [ ] 使用 `INNER JOIN` 的结果 SQL 必须绑定“交集总体”alternative；
- [ ] SQL 与 selected alternative 不一致时产生 Semantic Diff；
- [ ] 无 Reviewer 或关键 Gate unsupported 时，严格模式禁止发布；
- [ ] Shadow 模式发布时明确记录“未验证”，不能计为验证成功；
- [ ] 最终评测同时报告 SQL 正确率、交付率、反例生成率、Decision 解决率和 silent-choice 率。

建议新增核心指标：

| 指标 | 定义 |
|---|---|
| 反例生成率 | material Decision 中具有最小区分样例的比例 |
| 反例有效率 | 反例确实使至少两个 alternatives 产生不同预期结果的比例 |
| 证据绑定率 | 探索证据绑定到 Claim/Decision 的比例 |
| 证据吸收率 | material 新证据出现后完成 Spec 修订的比例 |
| Decision 解决率 | material Decisions 获得 resolved 或有审计 provisional selection 的比例 |
| SQL 选择绑定率 | 最终 Artifact 绑定 selected alternative 的比例 |
| Silent-choice 率 | SQL 通过 Join/NULL/WHERE 隐式选择未登记业务政策的比例 |
| 披露代替验证率 | 仅有 disclosure、没有 verification/decision binding 的发布比例 |

---

## 11. 最终判断

local061 证明当前系统能够：

- 发现并登记一个重要假设；
- 做部分总体数量探索；
- 在导出时披露候选假设。

但它也证明当前系统尚不能保证：

- 候选假设一定有可区分解释的反例；
- 关键探索证据一定回写 Answer Spec；
- 影响总体和分母的歧义一定进入 Decision；
- 最终 SQL 一定绑定被选择的解释；
- 未解决的 material 假设一定阻止严格发布。

因此，对当前能力更准确的描述应是：

> **已具备候选假设登记和披露框架，但假设验证—反例—解释选择—SQL 绑定的闭环仍不完整。**

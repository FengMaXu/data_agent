

### 一、 核心设计哲学

1. **意图显式化（Intent-explicit）**：不仅记录“怎么算”，必须显式记录“预期的先验假设（Invariants & Assertions）”。
2. **极高信息密度（Dense & Token-efficient）**：采用符号化缩写，在多轮探索中保留极简的全局状态机（Strategy Notes），避免上下文爆炸。
3. **可双向编译（Bidirectional & Executable）**：自然语言可被解析为该代数式；该代数式可无损编译为 SQL / Polars / DuckDB 执行；执行结果可直接反向回填验证。
4. **失效可定位（Locality of Failure）**：一旦执行出错，能精确锁定是哪一个代数节点违背了前提，而非在数百行代码中乱撞。

---

### 二、 语法规范设计（Data-Algebraic Notation, 简称 DAN）

我们可以将一套完整的分析任务定义为四元组：
$$\mathcal{T} = \langle \mathcal{D}, \mathcal{O}, \mathcal{A}, \mathcal{H} \rangle$$
（数据集对象、操作管线、状态断言、业务假设）

#### 1. 实体与数据集签名（Schema State）
用紧凑格式记录数据源、维度与基数：
* `D:orders[N=1.2M, K=8]`：orders 数据集，预估行数 120 万，8 列。
* `c:type`：列与类型声明，如 `uid:ID`, `amt:Num`, `ts:Time`。
* 状态快照：`D₀ -> D₁ -> D₂` 记录演进版本。

#### 2. 核心代数算子（Primitive Operators）
汲取关系代数与现代数据流算子：
* **过滤（Filter）**：`σ(ts ∈ 2026-Q1 ∧ amt > 0)`
* **投影/衍生（Project/Derive）**：`π[uid, ts, amt, log(amt)->l_amt]`
* **分组聚合（Group & Aggregate）**：`γ[uid | sum(amt)->gmv, cnt()->freq, max(ts)->last_act]`
* **关系连接（Join）**：`D₁ ⨝[uid] D₂`（默认 Inner），`⟕`（Left Join），`⟗`（Full Join）
* **窗口时序（Window）**：`ω[partition=uid, sort=ts | lag(amt, 1)->prev_amt]`
* **维度切片/分箱（Bucket）**：`β[amt | [0, 100, 500, ∞)->tier]`

#### 3. 验证与断言算子（Assertions & Invariants —— 核心亮点）
**这是实现自我验证的关键语法**。每一步操作必须附带前置/后置断言：
* `@shape`：检验维度与基数。例如 `@shape(N' ≤ N)`（过滤后行数必减少），`@shape(N' == N)`（特征衍生不改变行数）。
* `@uniq(col)`：主键/粒度唯一性断言，例如 Join 后验证是否存在笛卡尔积膨胀。
* `@null(col)`：缺失值容忍度，例如 `@null(gmv) == 0`。
* `@range(col)`：值域合理性，例如 `@range(retention_rate ∈ [0, 1])`。
* `@dist(col)`：分布校验，例如 `@dist(amt) ~ PowerLaw`。

---

### 三、 端到端工作流：从语义解析到闭环迭代

以一个具体业务场景为例：
> **用户诉求**：“帮我分析今年一季度高价值用户的月留存情况，找出有流失风险的客户。”

#### 步骤 1：用户语义解析（NL -> 代数简记）
模型不直接生成 SQL，而是先构建出**假设与代数推演链**：

```text
-- 1. 语义假设对齐 (Hypothesis & Invariants)
H₀: "今年一季度" := ts ∈ [2026-01-01, 2026-03-31]
H₁: "高价值用户" := 历史总GMV top 10% (设定分位数阈值 q90)
H₂: "流失风险" := 3月份无任何活跃记录 (gap > 30d)

-- 2. 代数执行计划 (Execution Flow with Assertions)
S₀: D_raw:orders[N~2M, C] 
    -> σ(ts ≤ 2026-03-31) 
    -> @shape(N' > 0)
    
S₁: S₀ 
    -> γ[uid | sum(amt)->total_gmv] 
    -> @uniq(uid)
    -> quantile(total_gmv, 0.9)->th_gmv 
    -> σ(total_gmv ≥ th_gmv)->VIP[N_vip] 
    -> @shape(N_vip ≈ 0.1 * count(uid))

S₂: S₀ 
    -> σ(ts ∈ [2026-03-01, 2026-03-31]) 
    -> γ[uid | cnt()->act_m3] 
    -> @uniq(uid)->M3_ACT

S₃: VIP 
    -> ⟕[uid] M3_ACT 
    -> π[uid, total_gmv, act_m3, (act_m3 == 0)->is_churn_risk]
    -> @shape(N' == N_vip)      <-- [核心断言：左连接不得造成VIP人数膨胀]
    -> @null(is_churn_risk) == 0
```

#### 步骤 2：代码编译与底层执行
系统将上述 `S₀ ~ S₃` 自动编译为确定性的底层代码（如 DuckDB SQL 或 Polars），提交给数据内核运行，同时注入断言探针。

#### 步骤 3：迭代验证与差异比对（Diff & Self-Verification）
执行过程中，系统将实际物理执行结果（Actual）与代数式中的断言（Expected）进行对比：

* **情况 A（断言成功通过）**：
  所有 `@shape`、`@uniq` 均与代数声明吻合，模型确认结果逻辑闭环，直接输出可视化与最终结论。
* **情况 B（断言触发异常，触发自我修正）**：
  假设数据在执行到 `S₃` 时报错：
  * **实际结果**：`VIP ⟕ M3_ACT` 之后，行数从 `10,000` 暴增到 `13,500`。
  * **违背断言**：`@shape(N' == N_vip)` 校验失败！
  * **代数诊断（Algebraic Diagnosis）**：
    由于是在 `⟕[uid]` 节点出现膨胀，说明右表 `M3_ACT` 没有保证 `@uniq(uid)`，即 3 月活跃表存在多条同 uid 记录。
  * **自主修复（Self-Correction）**：
    模型无需推倒重来，直接在代数链条中打补丁：在 `S₂` 聚合算子后强行追加去重约束 `dedup[uid]`，随后重试 `S₃`，完成闭环。

#### 步骤 4：模糊语义的最小化向外求索（Clarification）
如果某个假设存在分支（例如：用户只买了 1 分钱也是活跃吗？退款订单怎么算？）：
* 模型会利用代数简记中的参数节点向用户发起精准提问：
  > “当前默认定义：`σ(amt > 0 ∧ status != 'refund')`，是否需要将退款订单剔除在活跃统计之外？”
* 避免了自然语言沟通中常见的词不达意。

---

### 四、 相比传统方案的代际优势

| 维度 | 传统纯代码（SQL / Python） | 纯自然语言（Prompt 链） | 本方案：数据代数简记（DAN） |
| :--- | :--- | :--- | :--- |
| **Token 消耗** | 极大（每轮都要附带全量 DDL/SQL） | 中等（冗长啰嗦，语义漂移） | **极小（单步仅需 10~30 字符）** |
| **意图与假设** | 隐式（埋没在复杂的 Join 和 Where 里） | 显式（但不具备约束力） | **显式且形式化（符号与断言强绑定）** |
| **错误定位** | 困难（报错往往只显示 SQL Syntax 或崩溃） | 几乎无法自动化纠错 | **节点级精确定位（哪个断言失效就修哪个）** |
| **跨轮记忆（Notes）**| 极易因上下文截断丢失背景约束 | 容易发生遗忘和目标漂移 | **以状态图矩阵形式驻留，永不迷航** |

### 五、 落地实现建议
1. **Parser 层**：可基于 ANTLR 或 Python `lark` 编写一个轻量级文法解析器，保证代数表达式与抽象语法树（AST）互转。
2. **Compiler 层**：实现一个简单的 Visitor 模式，将 AST 编译至目标方言（推荐从 DuckDB / Ibis 起步）。
3. **Execution Runtime**：在执行每一步算子时，利用轻量级 Profiler（收集每一步的 `row_count`, `null_count`, `unique_keys`），作为运行时元数据与代数式中的断言逐项匹配。
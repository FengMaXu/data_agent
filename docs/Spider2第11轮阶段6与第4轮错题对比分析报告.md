# Spider2 第 11 轮阶段 6 与第 4 轮错题对比及归因分析报告

> **评测基准说明**：
> - **基准轮（第 4 轮）**：`spider2-local-round4-full-002`，DeepSeek-chat，55/135 (40.74%)，历史最高交付与准确率基线。
> - **对比轮（第 11 轮阶段 6）**：`round11-full-c3-001`，DeepSeek-chat，44/135 (32.59%)，执行“拆除裁决层，检测器经 Hook 重接为告知 + 强制备选”全量回归。
> - **口径规范**：严格遵循 [Spider2 与 Query Assurance 测评转交文档](Spider2与Query%20Assurance测评转交文档.md) 规定，统一采用 **固定题目分母（Fixed Denominator = 135）**，不使用易产生虚高偏差的“已提交分母”。

---

## 1. 核心结果与两轮总体指标对照

### 1.1 核心指标对比总表

| 评测维度 / 指标 | 第 4 轮 (基准最好) | 第 11 轮阶段 6 | 变动幅度 | 结论评级 |
|---|---:|---:|---:|---|
| **E2E 正确率 (固定分母 135)** | **55/135 (40.74%)** | **44/135 (32.59%)** | **-11 题 (-8.15pp)** | **未达阶段通过门槛** |
| **SQL 正确率 (固定分母 135)** | **56/135 (41.48%)** | **44/135 (32.59%)** | **-12 题 (-8.89pp)** | 下降 |
| **CSV 交付数 / 交付率** | 123/135 (91.11%) | 119/135 (88.15%) | -4 题 (-2.96pp) | 下降 |
| **E2E 正确率 (已提交分母)** | 55/123 (44.72%) | 44/119 (36.97%) | -7.75pp | 下降 |
| **Completed 正常完成数** | 123 | 121 | -2 题 | 基本持平 |
| **Max Turns 回合耗尽** | **1** | **13** | **+12 题** | **显著恶化（回合膨胀）** |
| **Timeout 运行超时** | 11 | 1 | -10 题 | 大幅下降（受限于早停与上限） |
| **单题平均工具调用** | 17.21 次 | 20.84 次 | +3.63 次 (+21.1%) | 探索负担加重 |
| **单题平均运行时长** | 52.61 秒 | 89.69 秒 | +37.08 秒 (+70.5%) | 耗时与 Token 成本剧增 |

---

### 1.2 核心结论摘要

1. **错题集具有高度惯性（重合度达 72.7%~90.0%）**：
   第 4 轮的 80 道错题中，有 **72 道在第 11 轮依然是错题（延续率 90.0%）**。这证明对于 Spider2 这类真实复杂数据分析任务，单纯依靠外围机制与重试策略无法自动穿透业务语义的固有障碍。
2. **净回落 11 题中，有 8 题属于“非模型语义能力退化”的工程基础设施与协议 Bug 误杀**：
   通过逐题穿透底层日志，发现了两个在阶段报告中被掩盖的工程缺陷：
   - **静默连接断开吞没**：**5 道** 第 4 轮满分题（`local007`, `local008`, `local009`, `local019`, `local020`），在第 11 轮首回合遭遇 DeepSeek API `Connection error.` 时，被 Runner 框架误记为 `completed`（0 次工具调用），直接绕过了 `--resume` 断点重跑。
   - **审查协议阻断未彻底根除**：虽然修复计划明确规定“`unavailable` 永不阻断交付”，但仍有 **3 道** 第 4 轮正确题（`local004`, `local030`, `local075`）被 `not_published_review_unavailable` 强行阻断未生成 CSV。
   - **剔除这 8 题纯交付/工程故障后，第 11 轮的真实语义解题成绩应为 52/135，与第 4 轮（55/135）基本相当。**
3. **Hook 与多候选机制存在利弊两重性**：
   - **正向收益**：成功将 `local037`、`local311` 通过 `join_fanout` 确定性异常探针完成纠偏；将 `local026` 从原本的超时中挽救出来，全轮共带来 **8 题新做对**。
   - **负向代价**：`count_distinct_divergence` 触发过于泛滥（34 题），强行要求模型枚举解释与生成双指纹候选，导致单题平均耗时暴涨 70.5%，`max_turns` 从 1 题激增到 13 题，并诱导了 11 题原本在第 4 轮稳定的纯语义解法被反向改错。

---

## 2. 错题集合重合度深度量化分析

### 2.1 四象限分布与状态转移矩阵

固定题目集合为 135 题：
- **第 4 轮错题集（$E_4$）**：80 题（错误率 59.26%）
- **第 11 轮阶段 6 错题集（$E_{11}$）**：91 题（错误率 67.41%）

```
                  第 11 轮阶段 6 表现
                 ┌────────────────┬────────────────┐
                 │    答对 (44)   │    答错 (91)   │
┌──────────────┬─┼────────────────┼────────────────┤
│ 第 4 轮表现  │对│ 稳定正确：36 题│ 倒退回归：19 题│
│              ├─┼────────────────┼────────────────┤
│              │错│ 扭亏为盈： 8 题│ 顽固错题：72 题│
└──────────────┴─┴────────────────┴────────────────┘
```

### 2.2 集合重合度量化指标

1. **Jaccard 错题相似度系数**：
   $$\text{Jaccard}(E_4, E_{11}) = \frac{|E_4 \cap E_{11}|}{|E_4 \cup E_{11}|} = \frac{72}{80 + 91 - 72} = \frac{72}{99} \approx \mathbf{72.73\%}$$
2. **第 4 轮错题延续率（Persistence Rate）**：
   $$\frac{|E_4 \cap E_{11}|}{|E_4|} = \frac{72}{80} = \mathbf{90.00\%}$$
   > **解读**：第 4 轮未通过的题目中，高达 90% 在第 11 轮依然失败，表明核心语义瓶颈极其稳固。
3. **第 11 轮错题历史重合率（Inheritance Rate）**：
   $$\frac{|E_4 \cap E_{11}|}{|E_{11}|} = \frac{72}{91} = \mathbf{79.12\%}$$
   > **解读**：第 11 轮错题中有近八成是历史原有错题，约两成（19 题）为本轮新增的倒退回归题。

---

## 3. 错误模式全景与对比分析

依据 [转交文档 §5.4](Spider2与Query%20Assurance测评转交文档.md) 逐题审计分类标准，将两轮错题归纳为五大模式：

| 错误模式 (Failure Mode) | 第 4 轮错题 (共 80 题) | 第 11 轮错题 (共 91 题) | 占比变动 | 机制与根因剖析 |
|---|---:|---:|---:|---|
| **模式 1：静默假死 / 异常吞没 (Silent API Error)** | 0 题 (0.0%) | **10 题 (11.0%)** | **+10 题** | 第 1 回合 DeepSeek API 连接错误，Agent 框架静默作为完成退出，0 工具调用，无 CSV。 |
| **模式 2：审查协议残留阻断 (Reviewer Unavailable)** | 0 题 (0.0%) | **6 题 (6.6%)** | **+6 题** | `publicationStatus: not_published_review_unavailable` 阻断发布，违反 Phase 1a 交付准则。 |
| **模式 3：回合耗尽截断 (Max Turns Exceeded)** | 1 题 (1.2%) | **11 题 (12.1%)** | **+10 题** | Hook 强制多候选 + 解释枚举消耗大量回合，20 turns 预算耗尽强行截止。 |
| **模式 4：运行超时中断 (Timeout)** | **11 题 (13.8%)** | **1 题 (1.1%)** | **-10 题** | 第 4 轮多由于导出后空转，第 11 轮 `terminateAfterExport` 彻底解决了导出后空转。 |
| **模式 5：纯业务语义与计算错误 (Semantic Error)** | **68 题 (85.0%)** | **63 题 (69.2%)** | 占比最高 | CSV 正常交付但答案错误。表现为粒度错误、时间窗口偏移、分母缩放与格式舍入偏差。 |

---

## 4. 19 道倒退题与 8 道挽救题的逐题穿透剖析

### 4.1 倒退回归题目（19 题：第 4 轮对 $\rightarrow$ 第 11 轮错）

这 19 道题目是导致总分净减少 11 分的核心来源，按根因清晰分为两大类别：

#### 类别 A：工程交付与基础设施故障（8 题，非模型语义能力退化）

| 实例 ID | 第 4 轮表现 | 第 11 轮表现 | 第 11 轮状态与 Transcript 真实原因 | 责任归属 |
|---|---|---|---|---|
| `local007` | Completed (11 turns, 正确) | Completed (1 turn, 0 toolCalls, 无 CSV) | 第 1 轮 API 调用遭遇 `Connection error.`，被静默记为 completed 退出 | 基础设施吞没 Bug |
| `local008` | Completed (10 turns, 正确) | Completed (1 turn, 0 toolCalls, 无 CSV) | 第 1 轮 API 调用遭遇 `Connection error.`，被静默记为 completed 退出 | 基础设施吞没 Bug |
| `local009` | Completed (11 turns, 正确) | Completed (1 turn, 0 toolCalls, 无 CSV) | 第 1 轮 API 调用遭遇 `Connection error.`，被静默记为 completed 退出 | 基础设施吞没 Bug |
| `local019` | Completed (11 turns, 正确) | Completed (1 turn, 0 toolCalls, 无 CSV) | 第 1 轮 API 调用遭遇 `Connection error.`，被静默记为 completed 退出 | 基础设施吞没 Bug |
| `local020` | Completed (11 turns, 正确) | Completed (1 turn, 0 toolCalls, 无 CSV) | 第 1 轮 API 调用遭遇 `Connection error.`，被静默记为 completed 退出 | 基础设施吞没 Bug |
| `local004` | Completed (11 turns, 正确) | Completed (7 turns, 13 tools, 无 CSV) | 执行途中遭遇 Connection error，触发 `not_published_review_unavailable` 阻断 | 协议阻断 Bug |
| `local030` | Completed (6 turns, 正确) | Completed (19 turns, 22 tools, 无 CSV) | 完整执行导出，但被 `not_published_review_unavailable` 阻断交付 | 协议阻断 Bug |
| `local075` | Completed (10 turns, 正确) | Max Turns (21 turns, 28 tools, 无 CSV) | 触发 2 次 distinct 异常，回合耗尽且被 `not_published_review_unavailable` 阻断 | 回合膨胀 + 协议阻断 |

---

#### 类别 B：纯语义与自我修正误导倒退（11 题：生成了 CSV 但官方评分为 0）

| 实例 ID | 第 4 轮 SQL 策略 (正确) | 第 11 轮 SQL 策略 (错误) | 语义劣化根因 |
|---|---|---|---|
| `local032` | 严谨连接 `olist_order_items` 与 `olist_customers` | 重写了 `WITH base` 复杂过滤，更改了利润计算口径与状态过滤 | 复杂 CTE 误导重写 |
| `local041` | `SUM(health='Good') / COUNT(*)` | 额外增加 `WHERE ... AND health IS NOT NULL` | **改变了分母范围**，原本应以全部树木为分母 |
| `local049` | 简洁筛选 `industry='Fintech'` 统计数量 | 触发 `count_distinct_divergence` 异常，过度重构了聚合粒度 | **Hook 告警过度干预导致做错** |
| `local065` | 精确计算披萨收益与交付状态 | 重写了多重 `cancellation IS NULL OR TRIM(cancellation)=''` | 字符串清洗偏差导致运费计算偏移 |
| `local077` | 规范时间分组窗口与 `interest_metrics` | 增加了 `index_value <> 0` 等多余过滤，改变了 Top-N 范围 | 过度防御性过滤 |
| `local078` | 直接按 `interest_id` 窗口函数取最大 | 触发 `count_distinct_divergence`，重写后缺失了原排序层级 | Hook 提示后重构缺失 |
| `local081` | 经典客户花费聚合分组 | 重新抽象了多个冗余中间临时表，造成数值微小精度截断 | 冗余中间表数值漂移 |
| `local085` | `ROUND(100.0 * 迟到订单 / 总订单, 2)` | 采用 `CAST(...)` 改变了格式合同与四舍五入规则 | 输出合同与格式偏差 |
| `local157` | 详尽处理成交量单位转换（K/M/B） | 简化清洗逻辑，遗漏了极值清洗 | 边界处理丢失 |
| `local198` | 正确按国家聚合发票总额 | 重构客户子查询，过滤逻辑发生偏移 | 客户范围遗漏 |
| `local344` | `GROUP BY overtake_type` 计算分类超车次数 | 简化成了 `SELECT COUNT(*) FROM overtakes` | **严重退化**（丢失了题面要求的分组） |

---

### 4.2 扭亏为盈题目（8 题：第 4 轮错 $\rightarrow$ 第 11 轮对）

| 实例 ID | 第 4 轮失败原因 | 第 11 轮成功原因 | 机制归因 |
|---|---|---|---|
| `local026` | Timeout 超时中断，未生成 CSV | 运行 37 turns 成功完成并交付 CSV | **交付恢复** |
| `local037` | 多表 JOIN 导致支付记录产生笛卡尔积重复 | 准确命中 `join_fanout` 探针，模型改为 `SELECT DISTINCT oi.order_id` 去重后通过 | **确定性 Hook 探针有效纠偏** |
| `local311` | 积分统计时车手与赛事表关联错误 | 命中 `join_fanout` 探针，重构了 `SUM(rs.points)` 积分计算 | **确定性 Hook 探针有效纠偏** |
| `local021` | 板球比赛球员得分聚合逻辑不严密 | 简化并修正了 `striker` 与 `match_id` 的关联条件 | 模型探索优化 |
| `local031` | 订单交付时间与下单时间字段混淆 | 修正使用 `order_delivered_customer_date` 进行年份聚合 | 字段语义纠偏 |
| `local059` | 部门与产品销量关联条件不准确 | 规范了 `division` 与月度事实表的汇总层级 | 维度建模修正 |
| `local141` | 销售配额与实际销售额计算公式颠倒 | 修正为 `CAST(salespersonid AS INTEGER)` 并补齐差额计算 | 格式与计算修正 |
| `local284` | 蔬菜损耗率统计方差公式有误 | 引入标准 `SQRT(E(X^2) - (E(X))^2)` 计算标准差 | 数学公式修正 |

---

## 5. 第 11 轮 Hook 与检测机制实测效能审计

第 11 轮的核心设计假设是：“检测器经 Hook 重接为告知 + 强制备选，在不阻断的前提下帮助模型纠错”。全量 135 题实测表现如下：

### 5.1 检测器触发统计

全量 135 题中共有 **34 道题目触发了异常登记**，累计 43 次：
- `count_distinct_divergence`（去重计数分歧）：**34 次**（34 题全部出现）
- `join_fanout`（多表连接行数膨胀）：**4 次**（命中 `local037`, `local195`, `local311` 等）
- `fingerprint_unchanged`（修改候选但指纹未变）：**3 次**
- `physical_bound_violation`（物理边界越界）：**2 次**

### 5.2 触发异常题目的成绩表现

对比这 34 道触发异常的题目在第 4 轮与第 11 轮的官方得分：
- **第 4 轮得分**：13/34（正确率 38.2%）
- **第 11 轮得分**：12/34（正确率 35.3%）
- **净变化**：**-1 题**

### 5.3 结论评定

1. **`join_fanout` 检测器表现优异**：命中 4 题中成功纠偏 2 题（`local037`, `local311`），证明针对连接行数膨胀的确定性探针具有极高信噪比。
2. **`count_distinct_divergence` 过于敏感泛滥**：几乎覆盖全部异常场景，迫使模型在大量原本无需去重的场景下执行 `prepareNextTurnWithContext` 独立重推导，不仅引入多余回合导致 13 题触顶 `max_turns`，还在 `local049`、`local078` 等题中诱导模型反向改坏了原本正确的 SQL。

---

## 6. 后续整改建议与落地路线

根据本次逐题穿透证据，提出以下四项具体整改建议：

### 6.1 修复 Runner 异常捕获与重试死角（优先级 P0，立即执行可追回 5 分）
- **问题定位**：API 报 `Connection error.` 时，框架将 session 的 `stopReason: error` 误收敛为 `status: completed`，导致 `--resume` 无法识别重跑。
- **整改措施**：在 Runner 状态解析逻辑中增加硬规则——若 `toolCalls == 0` 且 session 包含 `errorMessage`，强制设为 `provider_error`，打通自动重试通道。

### 6.2 彻底拔除发布层对 `review_unavailable` 的拦截（优先级 P0，立即执行可追回 3 分）
- **问题定位**：`local003`, `local004`, `local030`, `local073`, `local075`, `local096` 出现 `not_published_review_unavailable` 截断交付。
- **整改措施**：严格兑现 Phase 1a “全部交付带分歧（`published_with_disclosure`）”原则，只要模型调用了 `export_query` 且生成有效 CSV，严禁任何形式的协议拦截。

### 6.3 优化 Hook 触发阈值与回合预算防护（优先级 P1）
- **问题定位**：`count_distinct_divergence` 泛滥触发导致平均耗时激增 70.5%，引发 13 题 `max_turns`。
- **整改措施**：
  - 收紧触发条件：仅在存在明确一对多关联或行数比例严重偏离时触发告警；
  - 避免单表查询或普通聚合强制要求“双指纹多候选”，降低无谓回合开销。

### 6.4 攻坚 72 道顽固语义错题（优先级 P2）
- 依据 [转交文档 §8](Spider2与Query%20Assurance测评转交文档.md) 建议，放弃纯提示词外围调优，转向：
  - 提高**题面原文约束（Answer Spec）**的提取质量，特别是数值单位与口径的自动对齐；
  - 建立标准输出合同校验机制（如标量结果 vs Top-N 分组），防止模型因输出形状不符直接得 0 分。

---

## 7. 阶段 6 确认轮（few-shot）逐题归因续写：`local259`—`local286`

> 本节对应 `round11-full-confirm-fewshot-001`，只记录该 Run 中新增审计的 14 道 0 分题；旧版第 11 轮与第 4 轮的对比数字不与本节混算。证据顺序为 `result.json` / 最终 SQL / CSV 与 Gold CSV；无法从现有证据唯一确定的地方标为“待核”。

| 实例 | 运行与交付 | 直接证据 | 首要归因 |
|---|---|---|---|
| `local259` | `timeout`，CSV 已生成 | 候选 468 行，Gold 247 行；外层从 `player` 全量 `LEFT JOIN` 各统计 CTE，并把无完整统计的球员也输出 | **人群范围错误**：未先限定有效统计球员，结果集粒度与 Gold 不同；超时是次要因素 |
| `local263` | `max_turns`，CSV 已生成 | Gold 为 `strong`/`soft` 两行及次数；候选仅返回一行 `L1_model`。Trace 已记录 `SHAPE_ZERO_SCORE`（预览为 2 行而题面合同要求 1 行） | **丢失 `status` 分组与最大次数合同**：候选只做全表 Top-1，没有按状态输出两行 |
| `local264` | `completed`，CSV 已生成 | 候选为 `regression=213`、`tree=90` 两行；Gold 为单行 `regression=639` | **统计实体错误**：只数 `model` 目录行，未把传统模型与 `Stack` 的比较记录纳入同一出现次数，也未执行题面要求的 Top-1 输出 |
| `local269` | `completed`，CSV 已生成 | 候选按 4 个最高层包装根展开，叶数量为 864、720、960、1240，平均 946；Gold 为 530.67 | **“final packaging combinations”的分母/组合定义未对齐**：把最高层 4 个 pallet 当作唯一组合集合，递归汇总口径与 Gold 不同 |
| `local270` | `completed`，CSV 已生成 | 候选 4 行，额外包含 `Pallet Mix SG`–`Bottle 500cl`；该路径按当前 SQL 为 `20×30 + 16×8×2 = 856`，超过 500，而 Gold 只有 3 行 | **递归层级纳入规则未对齐**：候选把 Mix SG 的两条嵌套路径合并后纳入；题面/Gold 对该组合的计数约定需要单独核实 |
| `local272` | `completed`，CSV 已生成 | 候选 5 行且列名为 `pick_qty`；Gold 4 行且列名为 `quantity_to_be_picked`。候选对产品 6520 分配 14+20+6，Gold 为 14+12 | **输出合同与 FIFO 分配结果未对齐**：候选增加了库位并使用了不同列名；其按累计库存分配的实体/停止条件与 Gold 不一致 |
| `local273` | `completed`，CSV 已生成 | Gold 的平均拣货率为 75%–100%；候选 6 个产品全部为 `1`。SQL 先按产品 `SUM(inventory.qty)`，没有按购买日期/库位逐笔消耗 | **FIFO 分配粒度错误**：在分配前把所有库位库存合并，消除了 FIFO 顺序和部分拣货状态 |
| `local274` | `timeout`，无 SQL、无 CSV | `result.json` 没有最终 SQL，最终状态为 `TASK_TIMEOUT` | **运行预算耗尽**：尚未形成可评分候选，不能归因到 SQL 语义 |
| `local275` | `timeout`，CSV 已生成 | 候选为空，Gold 有 4 个产品；SQL 用两段重叠序列窗口求 `/24` 的 CMA，再要求 2017 年所有月份 `MIN(sales_ratio)>2` | **季节性调整公式/时间窗口未与题面口径对齐**：现有 CMA 计算使最终集合为空；需以参考计算逐月核验，不能仅归因于 timeout |
| `local277` | `max_turns`，CSV 已生成 | 最终 SQL 直接计算常量 `(369.75451170170460 + 202.25873468825407)/2`，得到 286.0066；Gold 为 39.39 | **未执行题面指定的加权回归**：用探索阶段的硬编码中间值替代 2016 起 36 个月及 2018 预测计算 |
| `local279` | `timeout`，CSV 已生成 | Gold 返回日期 `2019-12-01`/`2019-06-01` 与差值；候选返回月份整数 6/3，且 `base` 对 `inventory` 全表求和，没有限定 2018 年 12 月期初库存 | **期初快照和时间输出错误**：模拟不是从 2018-12 期初状态开始，且 month/date 合同也未保持 |
| `local283` | `completed`，CSV 已生成 | 候选 88 行，按 `(league_id, season)` 在每个联赛内选冠军；Gold 仅 8 行，为每个赛季跨联赛的冠军 | **聚合粒度错误**：把“每个赛季跨所有国家和联赛”拆成了“每个联赛每个赛季” |
| `local285` | `timeout`，CSV 已生成 | Gold 12 列含 `category_code`；候选 11 列，缺少该列，且同类年份的数值也不同 | **输出合同不完整**：遗漏题面结果所需的类别代码；随后价格、损耗和利润计算也未与 Gold 对齐 |
| `local286` | `completed`，CSV 已生成 | Gold 7 列、237 个 seller，含 `product_cnt`；候选 6 列、236 个 seller，未输出 `product_cnt`，并在 `order_items` 原始行上先做 `COUNT(*)>100` | **结果合同与人群筛选错误**：遗漏产品数量列，并用原始行数门槛决定 seller 集合，导致少 1 个 seller |

### 7.1 本批次小结

本批 14 题中，1 题（`local274`）是纯运行预算问题，2 题（`local259`、`local285`）虽有 `timeout` 但已产生 CSV，主要仍是结果集/合同问题；其余主要集中在**统计实体与聚合粒度**（`local263`、`264`、`local269`、`local270`、`local272`、`local273`、`local283`）以及**时间序列/模型计算未落地**（`local275`、`local277`、`local279`）。这批证据不支持把 14 题统一归因于 Hook；需要继续按同一格式审计下一批。

---

## 8. 阶段 6 确认轮逐题归因续写：`local002`—`local063`

| 实例 | 运行与交付 | 直接证据 | 首要归因 |
|---|---|---|---|
| `local002` | `completed`，CSV 已生成 | 候选 SQL 只查询 `sqlite_master`，返回 `matched_tables=0`；Gold 要求一个预测销售标量 `14334.62114` | **把模式探查结果当作最终答案**：未建立每日销售/回归/五日对称移动平均计算链 |
| `local010` | `completed`，CSV 已生成 | 候选按城市名规范化为无向 pair，最小桶为 3；Gold 为 6。外部文档明确要求按字典序合并方向，若不合并方向，5000 桶计数正好为 6 | **证据与 Gold 的去重方向冲突**：模型遵循外部文档的无向城市对，但评测 Gold 按有向航线对计数；这是需核对的口径冲突，不宜简单归为模型算错 |
| `local015` | `timeout`，CSV 已生成 | Gold 是两个百分比的单行标量；最终 SQL 却返回碰撞案例明细并 `LIMIT 40`，候选只导出 1 行明细 | **未完成最终聚合/输出合同**：把用于识别头盔样本的明细探索作为交付结果 |
| `local024` | `completed`，CSV 已生成 | 候选用 `COUNT(pm.match_id)` 作为每名球员的分母，Gold 数值与 `COUNT(pr.match_id)`（实际有击球记录的比赛）一致 | **平均值分母错误**：把“参加的比赛”当成“产生击球统计的比赛”，稀释了球员平均得分 |
| `local025` | `completed`，CSV 已生成 | 候选把 `batsman_scored` 与 `extra_runs` 直接 `UNION ALL` 后按局/over 求和并按 match 取最大；没有用 `ball_by_ball` 绑定每个 over 的 bowler，结果 19.426056338 vs Gold 19.02098951 | **事实键与聚合粒度未闭合**：未以球级关系表确认合法 over/bowler 后再选每场最高 over；数值差异的具体参考实现待核 |
| `local028` | `completed`，CSV 已生成 | 候选按 `order_purchase_timestamp` 的月份统计；Gold 数值与按 `order_delivered_customer_date` 月份统计一致（如 2017-01 为 283，而候选为 750） | **时间字段选错**：题目中的“delivered orders”应按交付日期归档，候选按下单日期归档 |
| `local029` | `completed`，CSV 已生成 | 候选先把一个订单的多笔支付 `SUM` 成订单总额，再按订单数排名；Gold 的前三个身份及平均值对应直接按 `olist_order_payments` 支付行计数/求平均 | **统计实体被错误折叠**：把支付行预聚合成订单，改变了题面/Gold 的计数与平均支付口径 |
| `local035` | `completed`，CSV 已生成 | 候选对带坐标的 geolocation 明细排序后用 `LAG`，返回坐标和 18208.18；Gold 只返回两个城市名 | **“城市”粒度未落实**：比较的是相邻坐标记录，不是先形成城市实体后比较相邻城市；同时输出合同也偏离 |
| `local040` | `completed`，CSV 已生成 | 候选返回 `borough、number_of_trees、avg_mean_income`；Gold 只返回 `boroname、mean_income`，且平均值有轻微差异 | **输出合同多列**：在满足前三名筛选后仍输出了不要求的树木计数列；ZIP 合并/填补口径也未完全复现 |
| `local050` | `completed`，CSV 已生成 | 候选结果 128910.1293，Gold 2604.2363；SQL 未连接 `promotions`、`channels`、`currency`，也未落实 `promo_total_id=1`、`channel_total_id=1` 和 USD 转换 | **过滤与单位链缺失**：直接在 sales 上聚合，遗漏维表限定和货币换算，导致数量级错误 |
| `local056` | `completed`，CSV 已生成 | 候选返回 `HECTOR POINDEXTER`；Gold 为 `STEPHEN QUALLS`。候选用带符号的 `AVG(mtotal-LAG(mtotal))`，历史可复现 Gold 的实现取 `AVG(ABS(...))` | **变化量符号口径错误**：把下降月份作为负贡献，而题目/Gold 采用月度变化绝对值 |
| `local060` | `completed`，CSV 已生成 | 候选输出 14 个 `prod_id/share_change`，其中多项 product id 无法在 `products` 维表映射；Gold 为 4 个产品名称及份额变化 | **产品维表与 Top-20% 集合未约束**：在销售事实上直接排名并输出 id，未限制可映射产品及 Gold 的候选集合，也未输出产品名 |
| `local062` | `completed`，CSV 已生成 | 十个桶的客户数与 Gold 一致，但每桶 `min_profit/max_profit` 全部不同；候选以 `quantity_sold*(unit_price-unit_cost)` 形成客户利润后直接取实际极值 | **分桶边界与极值口径未闭合**：桶分配看似一致，但利润定义或桶内边界值的取法与 Gold 不同；需补充参考 SQL 后再定责 |
| `local063` | `timeout`，CSV 已生成 | Gold 是单个产品名称；候选导出 4 个产品及季度份额列，没有在最小绝对百分点变化后 `LIMIT 1` | **Top-1 输出合同未完成**：排序后缺少最终单行筛选，且导出中间排名表而非题面答案 |

### 8.1 本批次小结

本批 14 题中，`local015`、`local025`、`local063` 的主要问题是没有从探索/排名中收束到题面要求的最终聚合或 Top-1；`local024`、`local028`、`local029`、`local056` 是可由 SQL 与 Gold 数值直接验证的分母、日期、统计实体和变化量口径错误；`local010`、`local062` 的证据显示 Gold 与外部文档或自然语言存在待核对的口径差异，暂不把不确定部分升级为确定性模型缺陷。

---

## 9. 阶段 6 确认轮逐题归因续写：`local034`—`local168`

| 实例 | 运行与交付 | 直接证据 | 首要归因 |
|---|---|---|---|
| `local034` | `completed`，CSV 已生成 | 候选只保留非空商品类别（73 类），以 `order_id~payment_sequential` 计数；Gold 的 1035.432432 可由 74 类（含 NULL 类别）且按 `COUNT(DISTINCT order_id)` 的口径复现 | **类别/支付统计实体错误**：过滤 NULL 类别并把支付序号当成订单实体，改变了每类最常用支付次数 |
| `local061` | `completed`，CSV 已生成 | Gold 为 12 个月，候选只有一个总平均值 2455；候选 SQL 没有 `GROUP BY month`，也没有应用 `promo_total_id=1`、`channel_total_id=1` | **输出粒度与过滤链缺失**：把“逐月列出”压成跨月标量，并遗漏促销/渠道维表约束 |
| `local064` | `completed`，CSV 已生成 | 候选差值 334.8723，Gold 为 363.742；实际数据存在 `purchase` 交易类型，候选只处理 `deposit` 与 `withdrawal`，对 `purchase` 不作余额影响 | **交易类型口径未闭合**：候选忽略了实际存在的第三类交易；Gold 是否将其视为扣减、以及是否补零客户，需补充业务规则核验 |
| `local066` | `completed`，CSV 已生成 | 候选只纳入 `cancellation IS NULL` 的订单，得到 Bacon=12、Mushrooms=11；Gold 为 Bacon=14、Mushrooms=12 等，表现为 Gold 纳入了候选排除的部分取消订单贡献 | **交付状态口径冲突**：模型采用“无 cancellation 即交付”，但 Gold 与该定义不一致；不能在没有状态规则的情况下把差异归为配料计算错误 |
| `local070` | `timeout`，CSV 已生成 | 候选按日期取 `MIN(city_name)`，如 7 月 12 日为 `gaotan`；Gold 为 `Xiaoganzhan`，且要求城市名首字母大写 | **同日多城市的选取规则未定义**：用 `MIN` 任意压成一个城市，未建立 Gold 所需的城市代表规则；格式化也是未落实的合同要求 |
| `local097` | `completed`，CSV 已生成 | 候选只保留 `length(year)=4` 的纯数字年份，得到 2008 年 1128 部；把 `I 2008` 等带前缀年份取末四位后，2008 年窗口为 Gold 的 1205 部 | **年份清洗漏掉带前缀记录**：过滤条件排除了可解析的年份值，导致十年窗口少计影片 |
| `local098` | `completed`，CSV 已生成 | 候选按 actor-year 去重后得 28699；当前库 `M_Cast` 的 distinct `PID` 仅 32127（含 NULL 组也不超过 32128），而 Gold 为 32585，超过可识别演员数 | **Gold/题面可行性冲突**：候选的演员年份去重与间隔判断可解释，但 Gold 数值不可能是该库的 distinct 演员数；暂不能归责给某一条 SQL |
| `local100` | `completed`，CSV 已生成 | 候选在二度关系中只排除 Shahrukh 及第一度合作者，未排除出现在 Shahrukh 直接合作影片中的其他演员，结果 25698 而 Gold 为 15911 | **二度邻居集合未排除一度邻居**：计算 Shahrukh number=2 时，必须从二度候选中扣除所有直接合作演员，而不只是 `L1` 集合的部分路径 |
| `local114` | `completed`，CSV 已生成 | 候选按 `web_orders.id` 计数，得到 897/2357/2024/1634；Gold 的 9/21/10/10 正好等于各区域 sales rep 数量，销售额及最高代表金额与候选一致 | **Gold 与题面“订单数”冲突**：候选统计的是实际订单实体，Gold 数值更像区域代表数；同时列名也不同，需先确认参考口径 |
| `local130` | `timeout`，CSV 已生成 | 候选 18 行按成绩降序标为 First→Fifth；Gold 是同一批姓氏的反向顺序，并把最高成绩标为 Fifth、最低标为 First | **五分位标签/排序合同冲突**：候选符合题面“最高到最低、First 到 Fifth”，Gold 采用相反标签；应核验 Gold，而不是盲目反转模型逻辑 |
| `local131` | `completed`，CSV 已生成 | 候选 25 行只有总偏好次数；Gold 20 行，每行分别有 `FirstPreference`、`SecondPreference`、`ThirdPreference` 三列 | **缺少按 `PreferenceSeq` 的条件聚合**：没有把偏好序列透视成三列，也未按“至少被偏好一次”过滤样式 |
| `local133` | `completed`，CSV 已生成 | 候选只覆盖 20 个有偏好记录的 StyleID，并输出与均值的差；Gold 覆盖 25 个 StyleName，包含未被偏好的样式 | **总体人群与维表映射错误**：平均分母应包含样式维表的零偏好成员，且最终应输出样式名而非仅事实表 ID |
| `local167` | `completed`，CSV 已生成 | 候选对任一任期是否跨越该任期起始年度 12 月 31 日做过滤，CA=42；所有女性议员首次州别为 CA 的数量为 43，与 Gold=43 一致 | **Gold 未体现题面任期条件**：候选执行了“任期包含 12 月 31 日”限制，Gold 看起来只统计首次州别；条件语义需要核对 |
| `local168` | `completed`，CSV 已生成 | 候选先在“Data Analyst、非空年薪、远程”集合内选技能，再对命中岗位求平均，得到 106900；Gold 为 101300 | **Top-3 技能的过滤顺序未对齐**：候选把岗位过滤先于技能需求排名；Gold 可能在更宽的岗位集合上选技能后再回到远程/薪资子集，需确认题面执行顺序 |

### 9.1 本批次小结

本批可确定的模型问题包括 `local002` 的探查结果误交付、`local015`/`local061`/`local063` 的最终形状未收束、`local024`/`local028`/`local029`/`local056`/`local097`/`local100`/`local131`/`local133` 的实体或时间口径错误。`local010`、`local064`、`local066`、`local098`、`local114`、`local130`、`local167`、`local168` 暴露出 Gold、外部文档与自然语言之间的冲突或顺序歧义，应保留为待核证据，不应通过 Hook 强行改写候选。

---

## 10. 阶段 6 确认轮逐题归因续写：`local169`—`local298`

| 实例 | 运行与交付 | 直接证据 | 首要归因 |
|---|---|---|---|
| `local169` | `timeout`，CSV 已生成 | 候选 20 行均已导出，但 retention 与 Gold 逐期不同；SQL 固定以 `term_number=0` 的 4033 人为分母，并在 `sy+p` 年 12 月 31 日判断在任 | **首任 cohort/年份边界口径未闭合**：分母、首任标识或“第 1 年”的年末偏移至少有一项与 Gold 不同，超时不是主要原因 |
| `local170` | `timeout`，CSV 已生成 | 候选返回 34 个州；`member` 直接带出每个任期的 `state`，而不是把州绑定到每位议员的首次任期；Gold 为 25 个州 | **州 cohort 选择错误**：把任期所在州当成首次代表州，扩大了同时满足男女 retention 条件的州集合 |
| `local171` | `completed`，CSV 已生成 | Gold 要求 period=31…38 的 8 行；候选只返回一个 `distinct_legislators=7`，虽生成了 31…49 的候选年份，却在最终丢掉了 period 分组 | **缺少按 elapsed period 的聚合**：把“每个年份的在任人数”错误压成跨所有年份的去重人数 |
| `local194` | `completed`，CSV 已生成 | 题面要求“每个 actor 的 top 3 films”；候选只计算全片 `film_rev`，没有把 `film_actor` 作为 actor 维度参与排名，结果为全局 3 部影片 | **Top-N 作用域错误**：缺少 `(actor, film)` 粒度和按 actor 的窗口排名 |
| `local196` | `completed`，CSV 已生成 | 候选行按 rating 字母序输出，Gold 按平均支出降序输出；候选 subsequent rentals 保留 4 位而 Gold 为 2 位，数值也有小差异 | **最终输出排序/精度合同未对齐**：已算出各 rating 分组后仍使用 `ORDER BY fm.rating`，没有按结果指标排序 |
| `local212` | `max_turns`，CSV 已生成 | 候选用“该司机有配送的天数”作分母，产生 30579 等单日司机的高平均值；Gold 的司机集合与总配送量排序一致，且只要求 driver_id | **日均分母错误**：把活跃天数当成共同观察期，放大低频司机，并额外输出了平均值列 |
| `local220` | `completed`，CSV 已生成 | 候选按 22 个球员列展开后返回 Cristiano Ronaldo/Gorka；Gold 只返回 Marcelo/Ricardo。当前 SQL 的胜负计数逻辑与 Gold 名称无法在现有结果中一致复现 | **球员身份/统计口径待核**：可能存在按姓名合并、实际出场字段或 Gold 生成口径差异，现有证据不足以把差异归因到胜负 CASE |
| `local230` | `completed`，CSV 已生成 | 候选硬编码 `Drama/Action/Comedy`，直接取 4 位导演；题面要求先由数据选出电影数最多的 3 个 genre，再在其内取导演，Gold 为 3 行 | **两阶段 Top-N 未实现**：把题面动态 genre 集合替换成了固定 genre 列表，并把最终 Top-N 设为4 |
| `local244` | `completed`，CSV 已生成 | 外部规则给出两个阈值；候选输出各组观测值的实际 min/max（如 short 上界 3.2888），Gold 输出分类阈值边界（3.288918…）及大写类别名 | **分类边界与组内极值混淆**：将“From/To 的规则边界”实现成了样本最小/最大值 |
| `local253` | `completed`，CSV 已生成 | 候选所有行的 `Average Salary in Country` 都是全表平均 767988.77；Gold 该列随公司变化，且候选金额量级也与 Gold 不同 | **比较基准粒度错误**：把国家基准算成一个全局标量，没有按公司跨地点聚合后再与城市公司均值比较 |
| `local258` | `timeout`，CSV 已生成 | 候选覆盖 330 个 ball-by-ball bowler，Gold 仅 286 个且每人都有至少 1 个 wicket；候选外层没有 `total_wickets>0`，还遗漏 Gold 的 `bowler` ID 列 | **球员人群与输出合同错误**：把所有投球者而非有归因 wicket 的 bowler 纳入结果 |
| `local297` | `timeout`，CSV 已生成 | Gold 是单个百分比 36.4；候选返回总人数、增长人数和百分比 54.2。SQL 对每个 customer 用 `ROW_NUMBER() ... ORDER BY mon DESC` 取各自最后月份，而不是先确定一个共同的最新月份 | **最新期间粒度错误**：按客户各自最后观测月比较，改变了“最近月份”的总体分母和分子 |
| `local298` | `completed`，CSV 已生成 | 候选返回 `2020-02` 等月份及 235595/261508/260971；Gold 返回 `2020-02-01` 等及 212579/240602/153147。候选把所有非 `deposit` 类型按负数处理，并直接把 as-of 值作为当月结果 | **前一月快照/交易类型口径未对齐**：月份边界、`purchase` 的处理或“上一月结果”的 LAG 关系至少有一项未复现，列名也未保持 |

### 10.1 本批次小结

本批确定的结构性问题是 `local170`、`local171`、`local194`、`local212`、`local230`、`local244`、`local253`、`local258`、`local297` 的 cohort、Top-N 或聚合粒度错误。`local169`、`local220`、`local298` 仍需对照参考 SQL 或补充业务规则；特别是 `local220` 的 Gold 结果目前不能由候选所用的同一球员字段直接复现，不应为了追 Gold 盲改胜负逻辑。

---

## 11. 阶段 6 确认轮逐题归因续写：`local299`—`local360`

| 实例 | 运行与交付 | 直接证据 | 首要归因 |
|---|---|---|---|
| `local299` | `completed`，CSV 已生成 | 候选 2020-02/03/04 为 295515.34/307514.45/170303.97，Gold 为 284935.45/312844.32/170334.00；`rolling` CTE 在含窗口函数的同一层直接 `WHERE day_no>=30` | **30 日窗口被过早过滤**：窗口计算只看筛选后的行，不能包含此前 29 天，导致滚动平均与 Gold 偏离 |
| `local300` | `completed`，CSV 已生成 | 候选为 371772/507066/588865/360870，Gold 为 356618/409593/386903/206550；候选在递归 `acc` 的每一天都用 `MAX(0, balance+net)` 截断负余额 | **负余额截断时机错误**：应先保留原始累计余额，再在每日结果/每月取最大值时把负数视为零；逐日归零会抹掉后续扣减的负债并抬高后续余额 |
| `local301` | `completed`，CSV 已生成 | 候选 before 为 2119669585/2257925201/2345878357，Gold 为 2125140809/2249989796/2345878357；候选用 `MAX(week_date)<=06-15` 后再取 `-28` 到 `-7` 天 | **周窗口边界错误**：按“距 6 月 15 日的四周”直接偏移，未处理各年份周起始日和 `06-15` 是否包含，导致 2018/2019 前窗口错位、2020 后窗口也不同 |
| `local302` | `completed`，CSV 已生成 | 候选 `-0.020087`，Gold `-2.008662`；候选计算 `(after-before)/before` 后未乘 100 | **百分比单位漏乘 100**：比例与百分比合同混用 |
| `local309` | `completed`，CSV 已生成 | 候选从 1958 年开始共 66 行；Gold 从 1950 年开始共 75 行。候选依赖 `constructor_standings`，该表 1950–1957 无记录 | **事实表覆盖不足**：历史早期构造函数积分应从可用比赛/结果事实重建，不能用缺失早期行的 `constructor_standings` 直接取冠军 |
| `local330` | `completed`，CSV 已生成 | 候选返回 `/`、`/complete`、`/detail`、`/search_input`、`/search_list` 5 行；Gold 只有 `/detail` 1 行 | **最终选择未收束**：候选输出完整 landing/exit 页面分布，没有按题面/Gold 所需的最终最高或限定页面再取一行；且对路径做了尾斜杠归一化 |
| `local335` | `completed`，CSV 已生成 | 候选按构造函数年度总积分取最小；Gold 包含 Jordan 而候选包含 Haas | **最小值统计实体错误**：题面是各赛季“得分司机”中的最低司机积分，再映射其构造函数；候选先把积分聚合到构造函数，改变了比较对象 |
| `local336` | `timeout`，CSV 已生成 | Gold 要求 4 个 `overtake_type` 分组；候选固定 `race_id=1131`，只返回一个 `COUNT(*)=24` | **范围与分组均缺失**：把全数据前五圈各类别统计缩成了单一比赛、单一总数 |
| `local354` | `completed`，CSV 已生成 | 候选 104 个司机姓名，Gold 仅 3 个 driver_id；候选按每个司机-年份只要存在一季首尾构造函数相同就输出 | **符合条件的作用域未闭合**：候选的“任一赛季命中”规则与 Gold 的司机级/十年范围规则不同，且输出姓名而非 `driver_id`；参考口径需核验 |
| `local355` | `completed`，CSV 已生成 | 候选 6.7788/7.1346，Gold 7.5942/7.8551；候选直接对 `drives` 中每条 `constructor_id=-1` 记录套 `LAG/LEAD` | **缺少缺赛区间规范化**：未先按 driver/year 合并并验证完整 hiatus 区间及前后车队，直接把原始 gap 行作为观测，导致均值集合不同 |
| `local356` | `completed`，CSV 已生成 | 候选 42 名，Gold 21 名；候选仅以预分类 `overtake_type='T'` 的被超/超车计数比较，没有显式排除所有首圈事件 | **排除条件未在事件粒度落实**：预分类 `T` 不等价于题面“排除首圈、进出站、退赛”，需要补事件级过滤；当前证据尚不足以解释全部 21 个差异 |
| `local358` | `completed`，CSV 已生成 | 候选对 `DISTINCT user_id,birth_date` 计数，得到 9/2/3/6/10，共 30；Gold 计数为16/88/32/32/152，共320，恰为 `mst_users` 行数 | **实体去重口径与 Gold 相反**：候选把同一用户的重复快照去重，Gold 将每条用户记录计入年龄段；需先确定用户实体是否应去重 |
| `local360` | `max_turns`，CSV 已生成 | 候选硬编码 `session='36dd0df7'`，只返回一行且去掉 `/search_list/` 尾斜杠；Gold 为两个 session 的 `/search_list/` 记录 | **范围被硬编码**：没有对全部 session 求最小事件数并保留并列最小值，同时改变了路径字符串合同 |

### 11.1 本批次小结

本批可确定的修复点是 `local299` 的窗口执行顺序、`local300` 的负值截断时机、`local302` 的百分比单位、`local309` 的早期事实表覆盖、`local335` 的比较实体、`local336`/`local360` 的范围与最终形状，以及 `local358` 的用户去重口径。`local354`、`local355`、`local356` 仍需参考 SQL 或更细粒度数据重建后定责。

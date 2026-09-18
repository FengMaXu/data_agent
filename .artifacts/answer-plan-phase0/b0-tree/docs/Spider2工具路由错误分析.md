# Spider2 工具路由错误分析

## 1. 范围与结论

本报告检查了 `spider2-local-baseline-full-002` 中所有实际调用 `run_python`、`show_widget` 和 `load_skill("analysis")` 的 transcript 与 trace。统计以 transcript 中真实 assistant toolCall 为准，不将流式 delta 重复计数。

| 工具 | 调用次数 | 涉及题数 | 成功 | 失败 |
|---|---:|---:|---:|---:|
| run_python | 27 | 23 | 0 | 27 |
| show_widget | 15 | 10 | 8 | 7 |
| load_skill(analysis) | 8 | 8 | 8 | 0 |

三类调用共涉及34道题。

核心结论不是“模型无缘无故画图”，而是四层问题叠加：

1. **评测器没有把已配置的Python解释器传给Agent Harness**，但Runtime仍暴露`run_python`，因此27次调用必然失败；
2. **Agent没有查询型任务模式**，复杂统计会自然回退Python，导出完成后又继续执行通用分析报告流程；
3. **System Prompt、Analysis Skill和实际Widget API不一致**，导致模型按文档构造的Widget调用被Runtime拒绝；
4. **Skill触发描述过宽**，“calculate/average/analyze/report”被误判为可视化分析任务。

因此需要同时修评测环境、工具合同和路由，而不是给Spider2题目增加特定提示。

## 2. run_python：为什么纯查询题会调用Python

### 2.1 直接技术原因

`createDataAgentHarness`支持：

```ts
pythonExecutable?: string | (() => string | undefined)
pythonWorkspaceDir?: string
```

生产Electron Host会传入Python路径，但Spider2评测器创建Harness时没有传入这两个参数。虽然`config.local.json`已经配置：

```text
C:/data-agent-eval/.venv/Scripts/python.exe
```

该配置只用于官方评分器，没有传给Agent。因此Runtime依然注册`run_python`，执行时却统一抛出：

```text
PYTHON_RUNTIME_NOT_AVAILABLE
```

这是本轮27/27失败的直接原因，属于**评测适配器能力接线错误**。

### 2.2 Agent为什么选择Python

23个case中的调用目的如下：

| Case | 可观测推理中的调用目的 | 判断 |
|---|---|---|
| local002 | 补齐日序列、线性回归、预测、对称移动平均；失败后再次探测 | 首次合理，第二次无效重试 |
| local003 | CSV已导出后计算报告汇总和图表数据 | 非必要后处理 |
| local009 | 使用Haversine计算机场距离 | 复杂数学回退 |
| local018 | 已手算百分比后用Python复核，并重复一次 | 非必要验证和重试 |
| local019 | 读取3003行CSV、解析时长、找最短比赛 | 大结果后处理 |
| local063 | 计算季度增长、销售份额、Top 20%和份额变化 | 多阶段统计回退 |
| local070 | 查找日期连续段及最短/最长streak | 序列算法回退 |
| local073 | 验证披萨配料排除、附加、倍数和排序 | 字符串/集合算法回退 |
| local201 | SQL受阻后尝试处理23103个单词的anagram；失败后加载Skill再重试 | Guard回退 + 错误重试 |
| local218 | 从299行CSV计算中位数 | 可由SQL完成的统计 |
| local220 | 用Python生成22路UNION SQL | SQL Guard间接诱发 |
| local273 | 对库存和订单执行FIFO分配 | 复杂算法回退 |
| local275 | 读取CSV计算两个重叠12月窗口的CMA | 时间序列回退 |
| local277 | 获取完整数据并执行季节分解、加权回归预测 | 时间序列回退；首个调用还是空占位 |
| local279 | 用Python复核递归库存模型 | 非必要验证 |
| local284 | 计算平均值、标准差和区间计数 | SQL可表达；代码还是占位 |
| local286 | CSV已导出后计算“综合报告”汇总 | 非必要后处理 |
| local298 | 先用Python建立参考答案，再构造SQL | 复杂窗口验证 |
| local300 | 逐日余额展开、carry-forward和负值clamp | 复杂递归回退 |
| local301 | SQL已有结果后精确复核简单百分比 | 非必要验证 |
| local302 | 计算属性值百分比变化及类型平均值 | 多阶段统计回退 |
| local331 | SQL方言失败后探测Python数据库连接 | 方言回退/环境探测 |
| local356 | 面对57.5万圈速记录，探测Python驱动和处理可行性 | 大数据回退/环境探测 |

可见：

- 多数核心调用来自复杂时间序列、序列识别、FIFO、递归或大结果后处理；如果Python能力真实可用，这种路线在通用Data Agent中并非不合理；
- 至少8次属于明确不必要的验证、探测或重复调用；
- `local201`、`local220`等案例先被SQL Guard或方言问题阻断，再转向Python，因此Python调用也是上游工具失败的次生结果；
- 23个Python case中只有2个在首次Python调用前加载了Analysis Skill，说明Python过度使用并不主要由Skill单独造成。

### 2.3 System Prompt的诱因

冻结锁中的System Prompt哈希与当前`.pi/SYSTEM.md`完全一致，因此可以还原当时规则。Prompt同时告诉Agent：

- 它是通用数据分析助手；
- 数据分析应导出CSV后继续做“deep, insightful analytical report”；
- `run_python`是可用的Sandbox工具；
- 对匹配任务应优先加载Skill。

这会让包含“forecast、median、analyze、report、moving average”等词的问题被理解为“SQL取数 + Python分析”，而不是严格的SQL-only任务。

## 3. show_widget：为什么导出后还继续展示

### 3.1 调用发生在任务已经交付之后

10个Widget case中，9个在第一次Widget调用前已经成功导出了题目指定的最终文件：

`local003, local061, local068, local081, local218, local258, local283, local286, local301`

Agent的显式理由包括：

- “present the results using a widget”
- “render a bar chart to visualize the differences”
- “show the median value in a widget for clarity”
- “present a concise summary with the champions table”
- “provide a comprehensive analysis report with visualizations”

所以Widget不是用于解决SQL，而是**完成导出后的可选展示增强**。这遵循了通用Agent的“结构化输出、深度报告”规则，但不符合Spider2只评估最终查询结果的目标。

`local336`是例外：Agent认为题目没有给出具体F1比赛，试图用steps Widget表达澄清说明，但调用失败。

### 3.2 每个Widget case

| Case | 调用目的 | 结果 |
|---|---|---|
| local003 | RFM结果表 + 柱状图 | 表成功，图失败；最终max_turns |
| local061 | 月度预测表 | 成功 |
| local068 | 城市增长表 | 第一次字段错误，重试成功 |
| local081 | 客户消费分组表 | 成功 |
| local218 | 中位数KPI | 失败；最终max_turns |
| local258 | Bowler Top榜摘要表 | 成功 |
| local283 | 冠军队摘要表 | 成功 |
| local286 | ECharts + KPI + 修正后的Chart | 前两次失败，第三次成功；最终max_turns |
| local301 | 销售变化表 | 第一次失败，重试成功 |
| local336 | 澄清步骤卡 | 失败；最终max_turns |

15次调用中7次失败。成功Widget没有提高CSV正确性，失败Widget则增加了轮次和终止风险。

### 3.3 Widget合同冲突

冻结System Prompt声明：

```text
kind = metric_cards / table / chart / steps / rich_text / echarts
kind="echarts" 时传 config
```

Analysis Skill也示例：

```text
show_widget(kind="echarts", config={...})
```

但Runtime实际工具Schema只接受：

```text
kind = kpi / chart / table / steps
参数 = spec
```

这直接解释了：

- `local286`按Skill使用`kind=echarts`被Schema拒绝，改成`kind=chart`后成功；
- `local218`的KPI结构不符合Runtime要求；
- `local068`、`local301`使用`rows`而Runtime要求`data`；
- `local003`的Chart结构不符合Runtime校验；
- `local336`的Steps缺少Runtime要求的`data`。

这是**Prompt/Skill/API合同漂移**，不是单纯的模型参数生成错误。

## 4. Analysis Skill：为什么被误激活

8个Skill case：

| Case | 加载原因 | 后续 |
|---|---|---|
| local004 | 无说明，与Schema检索并行 | 未使用Skill能力，纯浪费 |
| local021 | “探索数据库结构”同时加载 | 未使用，纯浪费 |
| local040 | 默认先加载analysis Skill | 未使用，纯浪费 |
| local081 | 与业务阈值检索并行加载 | 后续展示Widget |
| local196 | 与Schema检索并行 | 未使用，纯浪费 |
| local201 | Python失败后加载Skill排查可用性 | 次生错误，随后再次失败 |
| local230 | “load relevant skill and knowledge first” | 未使用，纯浪费 |
| local286 | 导出后准备综合报告和可视化 | 符合通用报告意图，但与SQL评测无关 |

根因是Skill对外描述为“数据分析与可视化”，而系统要求“任务匹配时优先加载”。模型在加载Skill正文前只能依据宽泛描述判断，因此普通的calculate/average/report也会被识别为匹配。Skill正文的`when_to_use`虽然主要指向图表，但此时加载成本已经发生。

## 5. 完整因果链

典型错误路径为：

```text
Spider2问题包含复杂计算或report/analyze措辞
→ 通用System Prompt将其识别为数据分析任务
→ 所有工具和Analysis Skill均可见，没有query-only路由
→ System Tool Mapping又硬编码“MySQL”，与当前SQLite冲突
→ SQL方言错误或SQL Guard拒绝复杂只读SQL
→ Agent转向Python进行计算、验证或生成SQL
→ 评测Harness未注入Python解释器，调用必然失败
→ 确定性能力错误没有熔断，部分case重试
→ 即使已成功export，通用深度报告规则仍触发Widget/Skill
→ Widget文档与Runtime Schema冲突，再产生失败和额外轮次
→ 部分任务最终max_turns/timeout
```

代表案例：

- `local201`：复杂anagram SQL受阻 → Python失败 → 加载Skill排查 → Python再次失败；
- `local220`：复杂UNION被Guard拒绝 → 用Python生成UNION SQL，但Python本身不可用；
- `local003`：最终CSV已导出 → Python汇总失败 → 表格Widget → 图表Widget失败 → max_turns；
- `local286`：236行CSV已导出 → 加载Skill → Python失败 → 两次Widget合同错误 → 第三次成功 → max_turns；
- `local068`：CSV已导出 → Widget使用错误`rows`字段 → 修正为`data`后成功。

## 6. 问题归属

### 评测适配器

- 未把`config.pythonExecutable`和case workspace传给Harness；
- 没有在运行前验证“暴露工具 = 实际可用工具”；
- 没有单独记录规范化工具调用账本，原始trace包含大量流式重复事件。

### Agent路由

- 没有区分“查询并导出”与“分析/可视化”任务模式；
- SQL可以完成时仍用Python做简单验证；
- 确定性能力错误后仍会重试；
- 成功导出后继续做未请求的Widget和深度报告；
- Analysis Skill被当成通用SQL任务初始化步骤。

### Prompt、Skill与工具合同

- System Prompt声明的Widget类型/参数与Runtime实际Schema不一致；
- Analysis Skill继续使用旧`echarts/config`合同；
- Tool Mapping硬编码MySQL，与SQLite连接冲突；
- Skill描述过宽，触发规则不够严格。

## 7. 改进建议

### P0：先修环境和合同，再重新测基线

1. Spider2 Harness传入：

```ts
pythonExecutable: config.pythonExecutable
pythonWorkspaceDir: prepared.workspaceRoot
```

如果生产环境本来没有Python，则不要注册`run_python`。不能继续保持“可见但必失败”。

2. Widget文档、Skill示例和Runtime Schema必须从同一个工具Schema生成，删除`metric_cards/rich_text/echarts/config`与`kpi/chart/table/steps/spec`的双重合同。

3. 删除Tool Mapping中的硬编码MySQL，按连接动态注入SQLite/MySQL/PostgreSQL方言。

### P1：增加通用任务模式路由

- **query/export模式**：`knowledge → SQL预览 → 结果形状验证 → export_query → 简短final`；
- **analysis模式**：只有用户明确要求洞察、统计后处理时启用Python；
- **visualization模式**：只有明确出现图表、可视化、Dashboard等意图时启用Widget和Analysis Skill。

“calculate、average、analyze、report、CSV”不能单独触发可视化。

### P1：完成和错误熔断

- `PYTHON_RUNTIME_NOT_AVAILABLE`标为永久capability error，本会话禁止再次调用；
- 用户没有要求图表时，指定文件成功导出后不自动调用Widget；
- 可选展示失败不能推翻已经成功完成的查询交付；
- 简单比例、中位数、标准差优先放入最终SQL，不再用Python二次验证。

### P2：Skill触发收紧

- 将Analysis Skill的外部描述改为明确的“仅图表/可视化/可下载图像”；
- 对纯查询任务不加载Skill；
- Skill契约测试必须实际调用当前Widget Schema的最小合法payload。

## 8. 是否需要修改Agent Prompt

不建议加入“Spider2题目禁止Python/Widget”之类评测特化规则。正确做法是：

- 修复真实能力接线；
- 动态暴露工具；
- 建立通用任务意图路由；
- 统一工具合同；
- 让直接查询任务自然停在SQL导出，而不是针对评测集打补丁。

## 9. 证据路径

- 运行：`C:/data-agent-eval/runs/spider2-local-baseline-full-002/`
- Transcripts：`transcripts/<case_id>/**/*.jsonl`
- Traces：`cases/<case_id>/trace.json`
- 独立复核：`tool-routing-independent-review.md`
- 冻结System Prompt：`D:/data_agent/.pi/SYSTEM.md`
- Runtime工具注册：`D:/data_agent/packages/runtime/src/agent-assembly.ts`
- Analysis Skill：`D:/data_agent/.agents/skills/analysis/SKILL.md`

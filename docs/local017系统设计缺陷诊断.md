# local017 运行失败与系统设计缺陷诊断

## 1. 案例基本信息与运行结果

- **题目 ID**：`local017`
- **评测批次**：`spider2-gold109-deepseek-flash-retry40-max-001`
- **数据库**：`California_Traffic_Collision` (SQLite)
- **原始题目**：*In which year were the two most common causes of traffic accidents different from those in other years?*
- **最终状态**：
  - 任务状态：`completed`
  - 交付状态：`not_published_no_export_call`（未调用 `export_query` 导出 CSV，官方得分 0/1）
  - 运行耗时：525,558 ms（约 8.7 分钟）
  - 执行回合：19 回合（Turns）
  - 工具调用：33 次（工具报错 3 次）
  - 最终 SQL：`null`

---

## 2. 失败现场与直接触发过程

通过对 `trace.json` 及全量底层 transcript 的对齐分析，任务终止的直接触发过程如下：

1. **Turn 18（第 18 回合）工具调用被模型输出截断**：
   - Agent 历经 17 个回合后，终于将系统要求的全部 4 个假设标记为 `handled`（生成 Spec Revision 6）。
   - 在准备执行结果查询时，Agent 单回合的思考链（Reasoning）消耗了 5,604 Tokens。
   - 随后输出 `query_database` 工具调用时，触碰单次模型输出 Token 上限，输出被截断（API 返回 `stopReason: "length"`, `rawStopReason: "incomplete"`），SQL 在 `FROM base\n` 处中断，JSON 格式未闭合。
2. **Runtime 拦截并返回重试提示**：
   - Runtime 识别到参数截断，未执行该查询，向模型返回错误提示：
     `Tool call "query_database" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`
3. **Turn 19（第 19 回合）总上下文击穿 128k 上限，API 猝死**：
   - 接收到上述提示后，当前对话上下文（含历史 DDL、探查返回及多轮长思考）已累积至 **123,776 Tokens**（`cacheRead`）。
   - 模型在第 19 回合刚生成 16 个 Token 的思考片段（`thinking: "My tool call hit the output token limit and got truncated (I cut off the"`），总 Token 达到 **124,010 Tokens**，因触碰模型总上下文极限再次被 API 强行中止（`stopReason: "length"`）。
4. **会话因空响应直接结算**：
   - 由于第 19 回合输出被截断且未包含任何文本和工具调用，Agent Harness 判定无后续动作，直接进入 `settled` 状态，未导出任何结果。

---

## 3. 本例暴露出的不合理系统设计

`local017` 表面上是 Token 耗尽导致的 API 截断，深层次则是 Runtime 与交互协议层存在的若干不合理设计，迫使 Agent 在元数据合规上陷入长达 12 个回合的内耗。

### 缺陷 1：假设（Hypothesis）与决策提案（Decision Proposal）双轨制造成机制繁冗
- **现象**：
  Agent 在 Turn 6 登记了业务假设（H1、H2、H3 及系统派生的 HY-4），状态均为 `candidate`。
  系统随后要求通过 `decisionProposals` 来处置假设。
- **不合理之处**：
  协议同时存在 `hypotheses`、`decisionProposals` 和 `legacyHypothesisRefs` 三重抽象。模型既要在 `hypotheses` 数组中维护 `status` 和绑定路径，又要在 `decisionProposals` 中维护备选项和映射引用。这种双轨制让 Agent 分不清两者的职责边界，多次出现“假设已写明、但因未挂载对应 Decision 而被系统判定为 unhandled”的情况。

### 缺陷 2：将编译器级的精密代数向量强加给大模型，且报错晦涩抽象
- **现象**：
  - Turn 9~10：Agent 尝试提交 Decision，系统校验驳回：
    `[DECISION_ACTION_REQUIRED] DEC-YEAR-SOURCE=affectedAspects inconsistent with derived affected aspects`（要求必须包含 population）。
  - Turn 16~17：Agent 为剩余假设补充 Decision，系统再次校验驳回：
    `[DECISION_ACTION_REQUIRED] DEC-ENTITY=assumption vector inconsistent with normalized semantics`。
- **不合理之处**：
  Runtime 要求大模型在自然语言交互中准确填写底层代数结构（包括 `normalizedSemantics.populationEffect` 与 `assumptionProfile` 中五个维度的假设向量精确对齐）。
  大语言模型擅长业务理解与 SQL 编写，极其不擅长做复杂的矩阵/向量维度推导。当向量出现一位偏差时，Runtime 仅返回抽象的内部错误名，未指出具体哪个字段冲突、应如何纠正，迫使 Agent 花费数万 Token 盲猜底层代数规则。

### 缺陷 3：级联式前置硬阻断（Cascading Hard Blocks）锁死正常执行
- **现象**：
  系统提示词规定：`mode="result"`、`export_query` 和 `publish_query_result` 在存在任何 `unhandled` 假设时会被强制阻塞。
- **不合理之处**：
  这种“前置全通关才允许运行”的设计，将 Agent 强行锁死在元数据编辑环节。即便 Agent 在 Turn 8 就已经通过探索查明了数据的核心规律，也无法执行并预览最终结果，被迫在 Turn 7 到 Turn 17 之间进行了连续 11 个回合的表单调试。

### 缺陷 4：探索预算截断与提示词引导产生矛盾，诱发模型离题空转
- **现象**：
  - Turn 11：系统提示假设未处置，并建议“重新查阅题目和参考文档”；与此同时，系统的探索查询预算被标记耗尽（`[BUDGET] exploration budget exhausted`）。
  - Turn 12~14：在无法继续执行 SQL 探索的情况下，Agent 误以为环境中藏有未读取的外部文件，开始调用 `run_python` 编写 Python 脚本扫描本地磁盘（`os.walk`）、检查空目录 `docs/external` 及查看残留脚本。
- **不合理之处**：
  系统既剥夺了模型的数据探查权，又提示模型“缺少参考文档证据”，给模型发出了互相矛盾的信号，直接导致 Agent 偏离数据分析主流程，在文件系统里盲目消耗了 3 个关键回合。

### 缺陷 5：全量上下文线性堆叠，缺乏修剪与滚动机制（Context Bloat）
- **现象**：
  会话中累积了所有历史工具调用的输入输出、全量 DDL、探索查询返回的表格数据，以及多达 6 个版本的完整 Spec JSON 串。
- **不合理之处**：
  系统缺乏针对大上下文的修剪策略（Pruning）或摘要滚动机制。历史失败的表单校验文本和中间探索数据被无差别地塞入后续每一个回合，导致上下文在第 18 回合直接膨胀至 12.4 万 Token，几乎耗尽了模型的物理上下文窗口。

### 缺陷 6：单回合截断后缺乏容错与优雅降级机制
- **现象**：
  - 当 Turn 18 因 Reasoning 过长导致 Tool Call JSON 被切断后，Runtime 的处理方式是直接把异常原样抛回给模型，要求模型“完整重发”；
  - 但此时上下文已满，模型根本没有足够的输出空间来完整重发；第 19 回合输出 16 Token 后再次被掐死；
  - 连续截断后，系统没有任何兜底逻辑（如截断历史上下文、降级参数、或基于已有 SQL 执行），而是判定会话无动作直接退出。

### 缺陷 7：背离 ADR-0003 确立的“默认告知、不阻断交付”架构原则
- **现象**：
  评测配置启用了 `informOnUnresolvedHypotheses: true`，并将未处置假设直接作为发布和查询的硬阻断条件。
- **不合理之处**：
  ADR-0003（《确定性检测默认告知而非裁决》）明确总结过历史教训：硬阻断会导致模型无法交付，产生大面积未交付 0 分；正确做法应是将未决假设记录并随结果披露（Disclosure），不阻断交付。
  `local017` 的配置事实上重新恢复了前置强阻断，重蹈了此前评测中因状态机死锁导致全盘崩溃的覆辙。

---

## 4. 诊断结论总结

`local017` 的失败并非算法或业务理解能力不足，而是**协议复杂性反噬业务执行**的典型案例：

```text
协议要求模型填写复杂的代数向量与双轨表单
→ 模型因格式微小偏差屡次被 Runtime 校验驳回
→ 前置硬阻断阻止模型执行结果查询
→ 模型盲目调试表单并遍历磁盘，消耗 17 个回合
→ 全量历史无修剪堆叠，上下文膨胀至 12.4 万 Token
→ 模型输出与上下文双重截断，系统猝死退出
```
该案例客观证明：**把编译器级别的元数据校验和强阻断推给大模型交互层，不仅无法提升答案准确率，反而会制造极高的链路脆弱性，直接扼杀任务的基本交付能力。**

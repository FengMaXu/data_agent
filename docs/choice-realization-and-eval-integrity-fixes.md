# 评测完整性与 Choice 兑现修复方案

- 日期：2026-09-26
- 相关决策：ADR-0003、ADR-0004、ADR-0005（本方案新增）
- 触发：`wrong-submitted-34-20260926-deepseek-rationale-480s` 的 trace 分析，以及三轮运行中 72 次 `compare_hypotheses` 的离线标注

## 1. 要修的问题

| 编号 | 问题 | 证据 |
|---|---|---|
| P1 | `run_python` 可以读评测机上的任意文件 | local286、local311 试图读 `evaluation_suite\gold`；local354 读了历史运行的 `digests\local354.md` |
| P2 | 数据库服务进程失效后，每次重连都立即失败，工具把失败原样交给 Agent；Agent 转而 `sleep`、遍历文件系统 | 16:41（UTC）起 8 题全部出现 `Connection closed`，日志中重连后的进程 `write EPIPE` |
| P3 | 临时选择（provisional）不需要理由；`compare_hypotheses` 与 Spec 中的 Choice 无关联，运行时无法核对建议倾向 | local031：建议"送达时间"（0.53 对 0.04），Agent 临时选择"下单时间"；local028 同样模式 |
| P4 | Choice 处置与结果 SQL 无关联 | local028、local031 两轮交付的都是"下单时间"口径的结果 |
| P5 | 不影响输出的歧义也被当作决策处理；运行时不知道哪些 Choice 是决定性的 | local054 按销量、按销售额都得到 Iron Maiden；local263 两种计数口径的胜出者相同 |
| P6 | 决定结果的计算细节没被列为候选 | 45 次可判断的调用里 12 次候选集不含正确答案（local263、local264、local297、local050、local168 等） |

**更正：** 之前的分析称 local028 "把互斥解释建成两条假设并同时支持"，这不准确。local028 建了 Choice，两条被支持的假设（状态筛选、订单号唯一）并不互斥；真正绕开理由检查的是临时选择。本方案按实际证据设计（见 §4）。

## 2. 目标不变量

1. Agent 代码只能读写本题工作区与 Python 运行环境自身的文件。
2. 数据库不可用时，本题以基础设施故障结束，Agent 不接触故障处理。
3. 互斥解释的比较只在 Choice 上进行；建议与 Choice 的对应关系由运行时记录。
4. 每个 Choice 处置都有理由；偏离建议倾向时有证据。
5. 结果若等于一个未被采纳候选的输出，就不能成为 Result Candidate。
6. 所有候选输出相同的 Choice 不需要裁决。
7. 固定类目的决策点全部声明之前，不执行 result SQL。

## 3. 修复 1：评测完整性

### 3.1 `run_python` 限定在工作区（P1）

**位置：** `packages/runtime/src/python-job.ts`。

**设计：**

- `runPythonJob` 不再直接执行 Agent 脚本，而是执行一个运行时生成的引导脚本。引导脚本先注册 `sys.addaudithook`，再用 `runpy.run_path` 执行 Agent 脚本。
- 允许访问的根目录：
  - 本次会话的工作区（`options.workspace`）
  - Python 自身的 `sys.prefix`、`sys.base_prefix`、`sys.exec_prefix`，以及 `site.getsitepackages()`、`site.getusersitepackages()`。这些只读，用于导入模块。
- 审计钩子拦截的事件：
  - 文件访问：`open`（路径不在允许根下时拒绝；工作区可写，其余只读）、`os.listdir`、`os.scandir`、`os.chdir`、`os.remove`、`os.rename`、`shutil.*`、`glob.glob`
  - 数据库：`sqlite3.connect`（数据库路径不在工作区时拒绝）
  - 进程与本地代码：`subprocess.Popen`、`os.system`、`os.exec*`、`os.spawn*`、`os.posix_spawn`、`ctypes.dlopen`
- 路径判断用 `os.path.realpath` 规范化后再比较前缀，避免 `..` 和符号链接绕过；Windows 下比较时忽略大小写。
- 被拒绝时抛出 `PermissionError("WORKSPACE_ACCESS_DENIED: <path>")`，Agent 看到的是普通 Python 异常。
- 工具提示改为："只能访问当前工作区；数据库请用 query_database"。原先"不承诺这是安全沙箱"的说明保留。审计钩子能防止误用，但不是安全边界。

**测试（`python-job.test.ts`）：**
- 读写工作区内文件成功
- 读工作区外的文件、列目录、`sqlite3.connect` 外部路径都失败，并带 `WORKSPACE_ACCESS_DENIED`
- `subprocess` 和 `os.system` 被拒绝
- `import pandas` 等标准导入正常
- 用 `..` 和绝对路径绕行都失败

### 3.2 数据库断线自动重连，失败则本题终止（P2）

**位置：**
- `apps/server/src/mcp-query-executor.ts`、`packages/electron-host/src/mcp-query-executor.ts`（两份实现同步修改）
- `packages/runtime/src/answering/sql-execution.ts`、`budget.ts`
- `packages/runtime/src/agent/harness-factory.ts`
- `packages/runtime/src/application/delegation.ts`
- `evaluations/spider2/run.mjs`

**执行器：**
- 新增错误类型 `DatabaseUnavailableError`（`code = "DATABASE_UNAVAILABLE"`）。
- `run` 和 `getSchema` 遇到连接类错误（`Connection closed`、`EPIPE`、`ECONNRESET`、transport 已关闭）时：
  1. 重置连接，按 0.5 秒、2 秒、5 秒退避，最多重连 3 次。
  2. 每次重连后先调用 `listTools` 做健康检查，通过后再重试原请求一次。所有请求都是只读的，重试是安全的。
- 3 次都失败就抛出 `DatabaseUnavailableError`。
- 原有的超时和中止处理不变。

**运行时：**
- `SqlExecutionError` 分类时，`DATABASE_UNAVAILABLE` 不转换成 `technical_failure` 障碍，而是作为终止性错误原样抛出。
- `query_database` 工具不再把它包装成 `[IMPLEMENTATION_OBSTACLE]`。harness 的 `after_tool` 钩子识别到这个错误码后，对本次操作请求中止，中止原因为 `DATABASE_UNAVAILABLE`。
- 子 Agent 的 `explore_sql` 和 `describe_schema` 遇到同样的错误时，除了终止子 Agent，还要向父操作传递同样的中止。

**评测 runner：**
- 操作以 `DATABASE_UNAVAILABLE` 结束时，题目状态记为 `infra_error`，不计入答错。
- 在 `--baseline` 或 `--formal` 下，与 `provider_error` 一样中止整轮，不再用失效的数据库跑后面的题。
- `infra_error` 加入默认的续跑状态。

**测试：**
- 执行器：模拟连接关闭，重连一次后成功，请求被重试；连续失败 3 次后抛出 `DATABASE_UNAVAILABLE`；超时路径行为不变
- 运行时：`DATABASE_UNAVAILABLE` 不产生障碍结果，操作以该原因结束
- 子 Agent：失败会传递到父操作
- runner：`infra_error` 的状态映射和中止

## 4. 修复 2：选择机制

### 4.1 比较只在 Choice 上进行（P3，对应"互斥的解释只能建成 Choice"）

运行时无法判断两条自由文本假设是否互斥，所以"两条互斥假设同时被支持就拒绝"没法直接实现。改用结构约束，让互斥解释只有一条路可走：

- `compare_hypotheses` 的参数改为 `{ taskId, choiceId, evidence? }`。候选由运行时从该 Choice 的全部候选读出，使用稳定 ID 和原文表述，模型不能再自由拼凑候选。
- 如果某个候选已有探针（§5），运行时把它的输出摘要（前 5 行加行数）作为观测证据自动附给 Jev。
- 建议写入受信任的 **Advisory Ledger**（新增端口，注入 `AnsweringDeps`，由组合根持有）：`{ taskId, choiceId, alternativesSignature, model, probabilities, recommendation, lean? }`。
- **明显倾向（lean）** 的判定按顺序：
  1. Jev 推荐了某个候选时，就是该候选。
  2. 否则，最高概率 p1 ≥ 0.2 且 p1 ≥ 2 × 第二名 p2 时，是概率最高的候选。
  3. 否则无明显倾向。
  
  以 local028 为例：0.25 对 0，判为倾向"送达月"。
- `answer-spec` Skill 写明：会相互排斥的解释必须建成 Choice；Hypothesis 只用于可以单独被支持或反驳的假定。

### 4.2 处置要有理由，偏离建议要有证据（P3）

**位置：** `answering/transition.ts`、`model.ts`、`tools/answering.ts`。

- 临时选择（`provisional`）也必须写 `rationale`，最少 20 字，与正式选定（`select`）一致。
- 两种处置都新增可选字段 `adviceOverride: { reason, evidenceIds }`。当 Ledger 中该 Choice 有明显倾向 L，而处置选的不是 L 时：
  - `adviceOverride.reason` 必填，最少 20 字；
  - `evidenceIds` 至少一条已准入证据（任何权威等级，包括查询观测）；
  - 否则拒绝（`SPEC_TRANSITION_INVALID`），错误信息写明倾向的候选和概率。
- 配置了建议器、且 Choice 是决定性的（§5），并且影响 `metric`、`entity`、`filters`、`groupBy` 或 `time` 时，处置之前 Ledger 里必须已有该 Choice 的建议；没有就拒绝，并提示先调用 `compare_hypotheses`。
- 建议本身仍不是证据：它既不能满足 `select` 对合格证据的要求，也不能单独处置一个 Choice（ADR-0004 不变）。
- `ChoiceView` 显示 `advice: { lean?, probabilities }` 和 `adviceOverride`；发布披露中列出偏离建议的处置。

### 4.3 处置在结果中兑现（P4）

**位置：** `answering/result-execution.ts`，新增 `answering/result-fingerprint.ts`。

- 执行结果查询时，对完整结果（来自 ResultStore）计算指纹（规则见 §5.2）。
- 对每个已处置、且指纹可用的 Choice：如果结果指纹等于某个未被采纳候选的探针指纹，并且不等于被采纳候选的指纹，就产生阻断发现 `choice_not_realized`。这时不生成 Result Candidate，Agent 收到的障碍里写明 Choice、被采纳的候选和结果实际对应的候选。
- 结果和任何探针指纹都不相等时，只记录 `realization: unavailable` 并披露，不阻断。其他 Choice 的处置变化会让旧探针过时，这种情况下无法判断。
- 这是 ADR-0005 新增的阻断类别。

## 5. 修复 3：已列出的歧义，执行后比对输出（P5）

### 5.1 探针

- `query_database` 的探索模式新增可选参数 `probe: { choiceId, alternativeId }`。探针就是一次普通的探索查询，另外由运行时计算结果指纹，并记入该任务的探针记录：`{ choiceId, alternativeId, revisionId, fingerprint | unavailable, rowCount, previewDigest }`。同一候选以最后一次探针为准。
- 探针 SQL 应当计算按该候选口径得到的**最终输出**：其他 Choice 取当前处置，没处置的取当前倾向。
- 某个候选实在无法单独执行时，可以通过修订提交 `notProbeable: { choiceId, alternativeId, reason }`。
- 结果被截断、执行失败或标记为不可探测时，指纹记为 `unavailable`。

### 5.2 指纹规则（`result-fingerprint.ts`）

与官方评测比对的口径保持一致：
- 忽略列名和列顺序
- 忽略行顺序
- 数值按四舍五入到 2 位小数比较
- 字符串去掉首尾空白；空值统一表示

计算方法：把每列的取值序列序列化，按序列化结果给列排出规范顺序；再按这个顺序重组每一行，对行排序后取 SHA-256。

### 5.3 决定性判定与自动处置

- `ChoiceView.outputs` 标明输出状态：`identical`（全部候选指纹可用且相同）、`distinct`（至少两个可用指纹不同）、`incomplete`（其余情况）。
- `identical` 的 Choice 由 Agent 提交处置 `{ action: "equivalent", choiceId }`，运行时核验指纹后接受，记为新的结果类型 `equivalent`，不需要理由、建议和披露。修订记录不可变，所以不由运行时自动改写。
- `incomplete` 按决定性处理；没有可用指纹的候选不参与 §4.3 的兑现检查。
- **处置前提：** 选定或临时选择之前，每个候选都必须有探针或 `notProbeable` 声明。所以建立 Choice 时直接选定，只在全部候选都声明不可探测时才允许。
- `ChoiceView` 显示每个候选的指纹状态、行数和输出摘要，方便 Agent 直接看到差异。

## 6. 修复 4：没被列出的歧义，逐项声明决策点（P6）

### 6.1 决策点清单

Revision 新增 `decisionPoints`，包含 8 个固定类目：

| 类目 | 要回答的问题 |
|---|---|
| `population` | 哪些行和实体算在内；零值、空值实体要不要纳入 |
| `join_multiplicity` | 连接后会不会重复计数，要不要去重 |
| `time_field` | 用哪个事件的时间字段；区间两端含不含 |
| `count_grain` | 按行、按实体还是按事件计数 |
| `denominator` | 比率或平均的分母是什么；分母为 0 怎么处理 |
| `window` | 滚动或累计窗口从哪里开始；前面数据不足时怎么算 |
| `ties` | 并列时取一个还是全部取；按什么规则取 |
| `output_shape` | 输出几行、几列、什么粒度 |

每个类目必须声明为以下四种之一：
- `{ status: "fixed_by_request", quote }`：`quote` 由运行时用现有的 `quoteAppearsIn` 核验，必须出现在原题中；
- `{ status: "not_applicable" }`；
- `{ status: "choice", choiceId }`：该 Choice 必须存在；
- `{ status: "assumed", hypothesisId }`：该 Hypothesis 必须存在。

任何一种都可以附 `observationEvidenceIds`，说明依据的数据检查。

### 6.2 生命周期

- 在建立规格和修订时都可以声明或修改决策点，修订时只提交变化的部分，未提及的沿用上一版（ADR-0004 的沿用规则）。
- 还有类目未声明时，Revision 不能进入 Ready；视图中列出 `undeclaredDecisionPoints`。exploration 不受影响。
- 旧快照没有 `decisionPoints` 字段的，视为豁免，不阻断已经进行中的任务。

### 6.3 数据异常检查（Skill 引导，不由运行时强制）

在 `answer-spec` Skill 和 `semantic-guide` 中加一节"数据异常检查"：声明 `join_multiplicity`、`count_grain`、`ties`、`denominator` 之前，先派一个子 Agent 查以下几项：
- 键是否重复
- 同一实体、同一时间点是否有多条记录
- 分母是否可能为 0
- 实体是否跨多个组（州、队伍）
- 取值是否有编码不规范的情况

出现异常的类目，优先建成 Choice 并做探针。

## 7. 工具层与提示

- `update_answer_spec` 的参数：
  - `dispositions` 中的 `provisional` 增加 `rationale`；`select` 和 `provisional` 增加 `adviceOverride`
  - 新增 `decisionPoints`
  - 新增 `notProbeable`
  - 工具说明改为：先探针，再比较，最后处置
- `query_database` 的参数新增 `probe`。
- `compare_hypotheses` 的参数改为 `{ taskId, choiceId, evidence? }`。
- `answer-spec` Skill 的流程改为：
  1. 先按决策点清单逐项过一遍
  2. 对有歧义的项建 Choice
  3. 每个候选做一次探针
  4. 所有候选输出相同的由运行时自动处置；其余的调用 `compare_hypotheses`
  5. 处置时写理由，偏离建议时附证据
  6. 执行结果查询
- 评测 Skill 与 `semantic-spec-disabled` 提示同步修改。

## 8. 组合根

- `createEvidenceSource` 旁新增 `createAdvisoryLedger`，作用范围是单个会话。它注入 `AnsweringDeps`，也交给 `compare_hypotheses` 工具。
- 两处 `mcp-query-executor` 的实现都导出 `DatabaseUnavailableError` 的错误码常量，由运行时识别。
- 子 Agent 的委派上下文增加父操作的中止入口，用于传递基础设施故障。

## 9. 实施中的调整

- **开关：** §4.2、§5.3、§6 的规则由 `InMemoryAnsweringOptions.choiceProbes` 控制。组合根在语义规格模式为 `required` 时开启；关闭时保持原有行为，旧测试和消融实验不受影响。
- **比较工具的注册：** 语义规格为 `disabled` 时不注册 `compare_hypotheses`，因为没有 Choice 可比较。
- **Advisory Ledger 的范围：** 在会话内存中，会话重启后不保留。重启后没有建议记录，偏离建议的检查不生效，但"必须先有建议"的要求仍然生效，Agent 需要重新比较。
- **探针的行数：** 探针以 10,000 行为上限执行，只把预览返回给模型，观测行数按预览计费；超过上限的输出记为 `unavailable`。

## 10. 兼容性

- `Answering` 的 5 个公开用例不变；架构测试固定的接口不变。新能力都通过参数和视图字段扩展。
- 旧快照：
  - 没有探针或建议记录的 Choice，保持原有处置规则
  - 没有 `decisionPoints` 字段的，视为豁免
  - 已经存在的临时选择不补要求理由
- `compare_hypotheses` 的参数是不兼容变更，需同步修改测试和评测 Skill。

## 11. 实施顺序

每一步都要让测试全部通过，并重新构建分发产物。

1. §3.1 `run_python` 限定工作区
2. §3.2 数据库重连与终止
3. §5.2 指纹计算，§5.1 探针记录，§5.3 自动处置与处置前提
4. §4.1 `compare_hypotheses` 绑定 Choice，Advisory Ledger
5. §4.2 理由与偏离建议的规则
6. §4.3 兑现检查
7. §6 决策点
8. §7 提示与 Skill，同步 `CONTEXT.md` 术语（Choice Probe、Result Fingerprint、Advisory Ledger、Decision Point、Equivalent Choice）

## 12. 验收

**单元和集成测试：** 覆盖 §3–§6 列出的每条规则。每个拒绝路径都要有测试，并验证错误信息里带有 Agent 修正所需的信息。

**回放检查（不重跑）：** 用 local028 和 local031 的 trace 构造输入：
- 选择"下单时间"时，因为建议倾向另一个候选，处置被拒绝；
- 按"下单时间"口径的结果查询，被兑现检查阻断。

**评测重跑：** 按 README 的口径，在你的终端里运行。题单是本轮 34 题中有效的 26 题，加上受基础设施故障影响的 9 题。对比以下指标：
- 交卷率、正确率
- 超时数
- 平均耗时和工具调用数
- 自动判为 `equivalent` 的 Choice 数量
- 偏离建议的次数，以及偏离后的正确率
- 被兑现检查拦下后修正成功的次数
- 声明为 `fixed_by_request` 与建成 Choice 的决策点比例
- `WORKSPACE_ACCESS_DENIED` 出现的次数（应为 0，或只出现在误用时）

**风险：** 探针和决策点会增加调用次数，在 480 秒的时限下可能增加超时。如果超时明显增加，先看每题的探针数，再决定是否把探针改为只对影响 `metric`、`entity`、`filters`、`groupBy`、`time` 的 Choice 强制要求。

## 13. 不在本次范围

- **`run_python` 输出长度上限：** local336 和 local356 因输出过长撑爆上下文，建议另行加上。
- **`compare_hypotheses` 改为强制选择（去掉弃权选项）：** 等本方案落地后，用 Ledger 数据重新评估。
- **超时根因分析：** 例如子 Agent 调用次数、探索轮次，另行处理。

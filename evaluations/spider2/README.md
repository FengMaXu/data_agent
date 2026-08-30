# Spider2 Agent Evaluation

该目录是 Data Agent 与官方 Spider2-Lite 之间的薄适配层。它直接运行现有 `createDataAgentHarness`，不包含独立模型链路或自定义评分器。

## 存储建议

仓库代码位于 `D:/data_agent/evaluations/spider2`。Spider2 数据库和评测结果体积较大，默认放在：

```text
C:/data-agent-eval/
├── Spider2/   # 官方仓库，包含 spider2-lite/
└── runs/      # 本地评测结果
```

C 盘当前空间仍需由使用者确认。不要将本地数据库、云凭据或评测结果提交到本仓库。

## 准备

1. 将官方 Spider2 仓库放到 `C:/data-agent-eval/Spider2`，或修改本地配置。
2. 按官方说明下载 local SQLite 数据库。
3. 确保数据库位于以下任一受支持位置：
   - `<spider2-lite>/resource/databases/<db>.sqlite`
   - `<spider2-lite>/resource/databases/spider2-localdb/<db>.sqlite`
   - `backends.sqlite.databaseDir` 指定目录。
4. 安装 Spider2 官方评测依赖并准备 Python。
5. 先构建 Data Agent：`npm run build:runtime && npm run build:server`。
6. 设置模型密钥，例如 `OPENAI_API_KEY`。
7. 如需自定义，复制 `config.example.json` 为 `config.local.json`；该文件已被 Git 忽略。

评测 Runner 会将配置的 Python 解释器和每题独立工作区传给 Agent；纯查询评测默认不注册 Widget 和 Dashboard 工具，并按每题后端动态注入 SQL 方言提示。每题默认最多执行 6 次元数据/样本探索查询；达到 60% 轮次预算且尚未导出时，查询结果会附加交付提醒。

## 命令

```bash
# 单元测试
npm run test:eval:spider2

# 校验官方文件、数据库、文档和构建产物
npm run eval:spider2 -- preflight --backend sqlite --max-cases 20

# 执行 Gold SQL 兼容性检查和一次真实模型 canary；正式基线前必须通过
npm run eval:spider2 -- preflight --backend sqlite --gold-check 3 --model-canary

# 冻结本轮基线的 Prompt、Runtime、工具、Skills、模型和评测适配器
npm run eval:spider2 -- freeze

# 单题
npm run eval:spider2 -- run --instance-id local001

# 冻结后的基线冒烟
npm run eval:spider2 -- run --ids-file evaluations/spider2/smoke-local.txt --baseline --score

# 指定固定 ID 清单
npm run eval:spider2 -- run --ids-file evaluations/spider2/smoke-local.txt

# 评分和报告
npm run eval:spider2 -- score --run <run_id>
npm run eval:spider2 -- report --run <run_id>
```

`run` 可追加 `--score`，完成后立即执行官方 SQL/CSV 两种评分。正式发布运行使用 `--formal`；首轮基线必须使用 `--baseline`。`--baseline` 会同时检查 Gold 兼容性和冻结指纹，并在开始前执行真实模型 canary；Prompt、Runtime、工具、Skills、模型或评测适配器发生任何变化都会阻断运行。

运行器会把模型 `stopReason=error` 记为 `provider_error`。遇到供应商错误，或正式运行中的资源/基础设施错误，会保存已有证据并立即终止，不再把失败误记为 `completed`。正式运行只有在所有选定题目均得到有效执行结果后才允许评分；`timeout`、`max_turns` 属于 Agent 表现，仍计入完整分母。

## 结果

```text
<runsRoot>/<run_id>/
├── manifest.json
├── cases.jsonl
├── summary.json
├── cases/<instance_id>/
│   ├── knowledge/
│   ├── workspace/
│   ├── result.json
│   └── trace.json
├── transcripts/<instance_id>/
├── submissions/sql/<instance_id>.sql
├── submissions/csv/<instance_id>.csv
├── official_score/
└── report.md
```

最终 SQL 选择规则：最后一次已完成且成功的 `export_query`，否则最后一次已完成且成功的 `query_database`；未完成的工具调用不计入候选。`export_query` 必须声明 `expected_rows`，Top-N 还必须声明 `expected_row_count`，并可用 `expected_columns` 声明精确列白名单；Shape 不匹配时不会发布 CSV。最终 CSV 只接受与最终导出调用关联且非空的文件，不使用“第一个 CSV”兜底；零行结果必须保留 CSV 表头。报告同时保留官方“已提交样本”分数和以本次固定题目数为分母的严格分数，未提交 SQL/CSV 的题目按错误计入严格分数。

## 云数据库

BigQuery 和 Snowflake 通过 `backends.<backend>.mcp` 配置现有 MCP 进程。该 MCP 必须实现 Data Agent 当前数据库契约：

- `execute_query_preview`
- `execute_query_export_batch`

配置中的参数支持 `{db}`、`{instance_id}`、`{spider2Repo}`、`{spider2LiteRoot}` 占位符。凭据通过环境变量传递，不写入配置或运行 Manifest。

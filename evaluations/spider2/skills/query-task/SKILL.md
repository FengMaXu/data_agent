---
name: query-task
description: 语义规格消融实验的数据查询流程——创建 Query Task、探索与最终查询、发布
when_to_use: 本实验中每个需要从数据库取数、统计、排名或导出的请求，在第一次调用 begin_query_task 之前加载。
requires-tools:
  - begin_query_task
  - query_database
---

# Query Task 流程（语义规格消融）

本实验不创建或修订七槽位 Answer Spec，但仍使用唯一的 Query Task、探索/结果分流、不可变 Result Candidate 和 Publication Receipt。语义分析方法见知识库 `semantic-guide`；SQL 实现规则见 `sql-rules`。

## 1. 按需取证

- 只读取回答当前问题所需的 Schema、业务文档和 SQL 规则。
- 遇到会实质改变总体、分母、时间窗口、排名或事件序列的歧义时，先利用题面、业务材料和 Schema 取证。
- 确实无法裁决时才请求用户澄清，并披露仍未证实的业务假设。

## 2. 创建 Query Task

任何数据库查询前，必须先且只需调用一次：

```text
begin_query_task()
```

精确复用其返回的 `taskId` 和 `revisionId`；不要自行构造 opaque ID。该工具只建立实验任务身份，不表达或验证业务语义。

## 3. 探索与最终查询

```text
query_database(kind="exploration", taskId, sql, limit?)
query_database(kind="result", taskId, revisionId, sql)
```

探索：

- 只用于验证字段、值编码、时间范围、连接基数或其他会改变答案的关键点；每次解决一个有界问题。
- Exploration Artifact 不可发布，也不能原地升级为结果。

SQL 是当前唯一的生产查询路径：不要调用未安装的语义层工具，也不要在同一任务中切换到另一套查询协议。

最终查询：

- 最终 SQL 生成一个不可变 Result Candidate；截断、部分完成或身份不完整的结果不能发布。
- CandidateCheck 报告技术问题时修复 SQL；未知执行结果不得盲目重跑。
- exploration、result、修复与子 Agent 共享同一任务预算。

## 4. 发布

- 行数 ≤ 10：`publish_query_result(candidateId, format="inline")`
- 行数 > 10 或题目明确要求 CSV：`export_query(candidateId, format="csv")`

发布不会重跑 SQL，也不能用 Preview 拼接完整结果。`inspect_answer(taskId)` 可读取只读任务投影，它不是第二份可写状态。

## 5. 输出责任

即使本实验关闭了七槽位 Spec，最终 SQL 和输出仍须严格匹配题面：统计实体、指标、资格总体、分组、时间边界、排名、并列政策、列、排序和行数。不要把探索诊断列带入正式输出。

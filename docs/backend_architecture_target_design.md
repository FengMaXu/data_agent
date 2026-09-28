# 后端目标架构设计（已合并）

本文件原有目标设计已经被“Data Agent 作为唯一产品 Agent、内部以 Pi `AgentHarness` 为执行内核”的 v2.1 方案取代；该方案同时包含 QA 瘦身与强类型 Answering 内核。

请以以下文档为唯一设计来源：

- [`backend_architecture_decoupling_analysis_and_plan.md`](./backend_architecture_decoupling_analysis_and_plan.md)

合并原因：

- 不再自行实现 `Runs`、`RunHandle`、`AgentEngine` 和 Pi 事件镜像状态机；
- Data Agent 是唯一产品 Agent，Pi AgentHarness 只是其内部执行内核，不是第二个 Agent；
- 直接复用 Pi 原生 Session、AgentLane、Operation、持久取消和恢复；
- Answering、Workspace、Knowledge、Python、Presentation 等业务 Module 都属于 Data Agent；
- QA 只保留 Answer Spec、Evidence、Hypothesis/Choice、Resolution、Result Candidate、Finding 与 Receipt；
- 使用品牌 ID、判别联合和 ReadyRevision typestate 消除非法状态，不把类型当作业务真值证明；
- 实施采用“Pi 最小地基先行、QA 随迁随减”，禁止旧新状态双写；
- 使用窄 Chord Service 和 ReplicatedState 隔离 Session Host 与 Presentation；
- 避免两个目标架构文档并行演进产生口径分歧。

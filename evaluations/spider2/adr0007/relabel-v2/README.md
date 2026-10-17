# 118 份卷宗逐题重标（v2）

## 交付

- `wrong118-relabel-v2.md`：118 题的可读卷宗审阅，三维标签、比较说明、源文件行号、JSON pointer、逐字引文和证据限制。
- `wrong118-relabel-v2.jsonl`：机器可读完整记录。
- `wrong118-relabel-v2.csv`：118 行便于筛选的表；`evidence` 保留完整引文 JSON。
- `validation-summary.json`：覆盖与引用校验统计。
- `PROTOCOL.md`：18 节点、三维分类及证据不足的处置规则。
- `parent-audit-overrides.json`：父协调者对分批标注的五处修正及理由；合并程序自动应用。
- `lane-N-labels.jsonl`、`lanes.json`：逐题分工和原始分批标注，保留审计过程。

原始卷宗、旧 classification 文件以及 ADR 文档均未覆盖。临时按批复制的阅读包已删除，来源仍是 `evaluations/spider2/wrong118-dossiers.jsonl`；`lanes.json` 保存题号和原始行号范围。

## 完成程度与限制

逐题复核 118 份，题号无遗漏、无重复；584 条引文均在其 JSON pointer 指定的卷宗字段中逐字存在。

- **61 题**：三个维度均有现有枚举标签。
- **13 题**：节点、错误层可暂定，但可见性五类不能准确表达“Spec 声明正确而实现错误”或“Gold 错、声明不一定错”等情形。`visibility=null`、`visibility_status=taxonomy_gap`，未造第六标签。
- **44 题**：标准细则不足、无法证明 SQL 分叉，或卷宗 SQL 与结果绑定疑似错配；三项保留 null、`classification_status=insufficient_evidence`，逐题列明需要补什么证据。**这 44 题尚未完成定性**，不是“树外”也不是已证明的方言/数据错误。

118 份中 **101 份无 Gold SQL**。输出列、粒度或已知公式偏差是“最早可证差异”，不保证解释全部失分：可能还有卷宗目前无法证实的更早问题，详见每题 `limitations`。工具参数仅证明声明/决定意图，未见工具成功返回时不声称已生效。空快照仅证明卷宗可见记录缺失，不证明运行时未声明。

在能分类的 74 题中，口径错 60、实现错 8、标准答案有问题 6，未发现可证的树外错误。不能据此证明字段树完整，不能据未知错因或节点零出现决定删节点；本次只完成用户要求的逐题定性审阅，不把覆盖或必要性结论补进 ADR。

## 复核与复现

从仓库根目录执行：

```bash
python evaluations/spider2/adr0007/relabel-v2/validate_labels.py --merge
python evaluations/spider2/adr0007/relabel-v2/render_report.py
```

Windows 终端如出现中文乱码，可先设置 `PYTHONIOENCODING=utf-8`。校验是离线检查，不查询数据库；检查题号覆盖、枚举/待定状态、来源 run、JSON pointer 与逐字引文，不等于语义正确性认证。`confidence` 是审阅判断，不是经过校准的概率。

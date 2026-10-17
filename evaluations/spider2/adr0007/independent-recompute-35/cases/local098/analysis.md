# local098：独立重算与事后字段审查

**结论：相邻出演年差≤4确实等价最多3缺年；原28698正确实现。当前全库只有32127可识别出演者，Gold32585超过全集上界。独立初稿误计1个NULL身份，冻结保留并另发布修正28698。**

### 原题（逐字）

> From the first year each actor appeared in a film to the last, how many actors in the database never had a gap longer than three consecutive years without at least one new movie appearance, meaning there is no four-year span anywhere in their active career without at least a single film credit?

## 独立算法和一个自查修正
相邻出演年份差d，夹在两次出演之间的空年为d−1；题目禁止连续4年无片，因此d≤4，而非d≤3。每演员出演年DISTINCT后LAG，再取最大差；单年出演者无内部空窗，纳入。演员用PID，非演员姓名合并。
独立初稿得到28699并冻结；揭示后实际检查发现M_Cast有两条NULL PID记录，被GROUP BY合并成1个未知身份并误计为演员。**这是独立题解自己的实现错误，不能隐去。** 保留第一次freeze，追加非NULL/非空身份条件，重新执行最终查询并发布修正Candidate，正确结果28698，与原SQL一致。初次官方分0不变，修正也没有贴合Gold。
## Gold核对和全集上界
当前M_Cast COUNT DISTINCT PID及TRIM PID均32127；连接Movie后可识别PID全集仍32127。Gold32585比出演者全集多458，已超出任何“从首片到末片”活动职业子集的可能上界。Person有37565身份，但其中没有出演记录的人不能自行得到首/末出演年；若标准将其纳入，则需要题面没有的资格规则。
实际相邻年差=4的演员有798名；误用≤3得到27901（包含初稿NULL组），正确≤4为28699，再排除NULL为28698。这证明旧卷宗的“缺口off-by-one”不能成立。不是只因没有Gold SQL就结束，而是用全集约束实际反证。
## 最后审查原Spec/SQL
原population.conditions显式写“相邻出现年份之差不超过4”，原eligibility限至少一条出演记录，SQL还排除mc.PID IS NULL；DISTINCT PID/year及LAG实现正确。原未定位题现可判为当前输入下Gold资格/数据兼容冲突，不能归为原measure.window错。具体标准究竟加入无cast人物、使用另一数据库还是有其他计数缺陷，仍未恢复。

## 可复核原始依据

- `blind.json`，JSON pointer `/question`：

```text
From the first year each actor appeared in a film to the last, how many actors in the database never had a gap longer than three consecutive years without at least one new movie appearance, meaning there is no four-year span anywhere in their active career without at least a single film credit?
```

- `parent-post-actor-upper-bound-response.json`，JSON pointer `/details/preview/rows`：

```text
32127
```

- `parent-post-gap-boundary-response.json`，JSON pointer `/details/preview/rows`：

```text
798
```

- `parent-post-null-cast-identity-response.json`，JSON pointer `/details/preview/rows`：

```text
tt2355921
```

- `parent-post-correction-note.json`，JSON pointer `/corrected_count`：

```text
28698
```

- `comparison-input.json`，JSON pointer `/goldCsv/0/content`：

```text
output
32585
```

- `C:/data-agent-eval/runs/adr0007-fieldtree-wrong118-deepseek-flash-20261010/cases/local098/attempts/attempt-001/trace.json`，JSON pointer `/toolCalls/29/result/details/fields/2/value`：

```text
相邻出现年份之差不超过 4
```

## 独立最终产物与限制

- 初次独立SQL/CSV/Receipt：`cases/local098/publications/publication_100fa935-2fa9-4d9d-b187-dde933024236/`。
- 初次冻结：`cases/local098/independent-freeze.json`。官方独立分：0。
- 已披露独立初稿多计NULL1人的更正：`parent-post-correction-note.json`及其新发布Receipt；不覆盖初次冻结。

- Gold生成机制/数据库版本未知，只确定当前出演者全集无法支持32585。
- 独立首稿多计NULL1人；初次冻结不可覆盖，修正SQL和新Receipt另行保留。

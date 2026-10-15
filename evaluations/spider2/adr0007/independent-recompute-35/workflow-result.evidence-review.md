# 35题真实产物只读审阅

## Review

**验收结论：BLOCK——目前不能认定35题全部完成。**

所有路径均相对于 `D:/data_agent/evaluations/spider2/adr0007/independent-recompute-35/`。本审阅仅读取文件，没有执行SQL、评分程序、Git命令，也没有修改代码、数据库或产物。审阅期间目录仍有新增文件；已纳入后来出现的 `local168/analysis.md`、`analysis.json`。

### Correct
- 实体证据显示：**29题有实际 executor 返回；25题有最终发布、freeze、reveal、评分和双格式分析；10题未完成。**
- 29题首次成功任务登记均早于首次 executor 事件，且任务ID对应。证据分别为各题 `tool-events.jsonl:1` 与 `executor-events.jsonl:1`，下表逐题列出。
- 25题的 freeze 时间均早于对应 reveal；未发现现存文件中的反向时序。
- 25份授权CSV均已直接读取，Receipt/Candidate标识与freeze中的发布标识对应。不是仅凭lane自述或“Ready”判断完成。
- 已完成分析总体能区分“重现Gold数值”和“业务规则确证”，尤其没有把未决的留存、库存递归、预测总体问题强行标为原系统语义错误。

### Fixed
- 无；只读审阅。

## Findings

### F1 — P1：10题缺少完整交付链，35题完成条件未满足

未完成题为：

`local096、local098、local100、local196、local285、local286、local297、local298、local299、local354`。

具体证据：
- `cases/local096/executor-events.jsonl:1`：实际探索已开始；目录没有最终发布、freeze、reveal或分析。
- `cases/local285/tool-events.jsonl:6`：最终查询返回 `ANSWERING_TOOL_INPUT_INVALID`；没有最终 executor 事件或发布链。
- `cases/local286/tool-events.jsonl:9`：探索被拒，`sqlExecuted:false`；`:11` 最终查询返回 `ANSWERING_TOOL_INPUT_INVALID`。不能把已有探索返回算成交付结果。
- `cases/local354/executor-events.jsonl:1`、`tool-events.jsonl:8`：只有探索证据，没有发布、freeze或分析。
- `cases/local098/`、`local100/`、`local196/`、`local297/`、`local298/`、`local299/` 的目录清单均只有 `blind.json`。

**最小处理：**补齐这些题，或明确交付为“25题完成、10题未完成”；未完成题应保留 `not_completed` 及阻塞原因，不能继承lane完成声明。

### F2 — P1：公共validation既过期，又不能正确解析现有证据路径

- `progress-current.json#/actual_database_cases`、`progress-validation.json#/actual_database_cases` 仍为6；两文件的 `/frozen_cases`、`/analyzed_cases` 均为0，与25份现存freeze和分析矛盾。
- `validate_progress.py:42–45` 使用 `Path(e['source'])`，没有把相对路径解析到本题目录。
- 例如 `cases/local040/analysis.json#/evidence/0/source` 为 `blind.json`，实际文件是 `cases/local040/blind.json`。从协议规定的 `D:/data_agent` 运行会读错位置；换到实验根也不能修复跨35题的相对路径解析。

**最小处理：**由上游修正case-relative source解析，再重新生成公共validation；当前“validation_error_cases=0”不能作为完整审查通过证明。本审阅未运行该脚本。

### F3 — P2：四题JSON证据缺少协议要求的pointer

`PROTOCOL.md:48` 明确要求JSON source给pointer，但以下条目仅有source和quote：

- `cases/local220/analysis.json#/evidence/2`
- `cases/local263/analysis.json#/evidence/3`
- `cases/local264/analysis.json#/evidence/2`
- `cases/local335/analysis.json#/evidence/3`

这些条目都引用 `original-spec-review.json`。当前人工可搜索到文本，但没有定位到具体成功写入字段。

**最小处理：**补入实际数组索引及字段pointer；不要以整文件包含quote替代字段级证据。

## 逐题执行与冻结核对

记号：
- `T1/E1`：本题 `tool-events.jsonl:1` / `executor-events.jsonl:1`，已核对成功任务登记先于查询。
- “最终/发布”分别为本题 executor 的最终结果行号、tool日志的 `export_query` 行号。
- freeze/reveal分别引用本题 `independent-freeze.json#/frozenAt`、`comparison-input.json#/revealedAt`；日期均为 **2026-10-11，UTC**。
- 发布绑定引用本题 `independent-freeze.json#/publication` 与 `publications/<receiptId>/receipt.json` 的 `/candidateId`、`/revisionId`、`/resultRef`。对应 `result.csv` 均已直接读取。

| 题 | 任务/首查询 | 最终/发布行 | freeze → reveal | 产物状态 |
|---|---|---:|---|---|
| local002 | T1/E1 | 5 / 10 | 09:03:18.593 → 09:03:23.112 | 整链、分析齐 |
| local010 | T1/E1 | 8 / 11 | 09:08:52.362 → 09:08:55.024 | 整链、分析齐 |
| local040 | T1/E1 | 7 / 10 | 09:12:58.045 → 09:13:01.692 | 整链齐；独立答案错误已承认 |
| local049 | T1/E1 | 8 / 11 | 09:18:02.886 → 09:18:04.195 | 整链、分析齐 |
| local168 | T1/E1 | 9 / 12 | 09:22:22.125 → 09:22:23.536 | 整链、分析齐；审阅中补入分析 |
| local037 | T1/E1 | 4 / 11 | 09:02:42.204 → 09:02:51.994 | 整链、分析齐 |
| local050 | T1/E1 | 6 / 9 | 09:11:00.626 → 09:11:04.825 | 整链、分析齐 |
| local061 | T1/E1 | 5 / 8 | 09:15:03.141 → 09:15:05.345 | 整链、分析齐 |
| local067 | T1/E1 | 6 / 9 | 09:19:50.775 → 09:19:52.671 | 整链、分析齐 |
| local286 | T1/E1 | 无成功最终/发布 | 无 | 未完成；最终输入被拒 |
| local064 | T1/E1 | 3 / 10 | 09:00:54.733 → 09:01:05.387 | 整链、分析齐 |
| local285 | T1/E1 | 无成功最终/发布 | 无 | 未完成；最终输入被拒 |
| local297 | 无 | 无 | 无 | 只有blind |
| local298 | 无 | 无 | 无 | 只有blind |
| local299 | 无 | 无 | 无 | 只有blind |
| local056 | T1/E1 | 6 / 11 | 09:01:57.631 → 09:02:01.759 | 整链、分析齐 |
| local096 | T1/E1 | 无 | 无 | 探索未完成 |
| local098 | 无 | 无 | 无 | 只有blind |
| local100 | 无 | 无 | 无 | 只有blind |
| local196 | 无 | 无 | 无 | 只有blind |
| local070 | T1/E1 | 4 / 11 | 09:00:33.292 → 09:00:35.441 | 整链、分析齐 |
| local167 | T1/E1 | 8 / 11 | 09:04:18.049 → 09:04:22.874 | 整链、分析齐 |
| local169 | T1/E1 | 7 / 10 | 09:08:09.960 → 09:08:12.840 | 整链、分析齐；根因未决 |
| local171 | T1/E1 | 8 / 11 | 09:13:31.354 → 09:13:33.675 | 整链、分析齐 |
| local358 | T1/E1 | 8 / 11 | 09:17:07.227 → 09:17:10.150 | 整链、分析齐 |
| local220 | T1/E1 | 4 / 11 | 09:04:36.538 → 09:04:42.507 | 整链、分析齐 |
| local263 | T1/E1 | 7 / 10 | 09:09:44.756 → 09:09:48.351 | 整链、分析齐 |
| local264 | T1/E1 | 5 / 8 | 09:12:47.630 → 09:12:51.584 | 整链、分析齐 |
| local335 | T1/E1 | 6 / 9 | 09:15:33.414 → 09:15:37.001 | 整链、分析齐；根因未唯一 |
| local354 | T1/E1 | 无 | 无 | 探索未完成 |
| local131 | T1/E1 | 3 / 8 | 09:00:19.624 → 09:00:23.091 | 整链、分析齐 |
| local269 | T1/E1 | 4 / 7 | 09:03:28.726 → 09:03:33.994 | 整链、分析齐 |
| local273 | T1/E1 | 6 / 9 | 09:06:56.481 → 09:06:59.792 | 整链、分析齐 |
| local279 | T1/E1 | 6 / 9 | 09:10:40.754 → 09:10:43.822 | 整链、分析齐；根因未决 |
| local331 | T1/E1 | 7 / 10 | 09:15:41.713 → 09:15:43.688 | 整链、分析齐 |

绑定的完整实例：
- `cases/local070/tool-events.jsonl:10` 生成 `candidate_e44ca490-2ecd-4217-bb12-39238ce538c7`；`:11` 发布 `publication_839a5a17-d2ca-4077-b345-e0a989fca4b8`。
- `cases/local070/independent-freeze.json:8–18` 与该发布的 `receipt.json:2–12` 标识及hash一致。
- 同发布目录 `query.sql:1` 对应执行SQL；`result.csv:2–16` 为15个日期结果。

桥接实现也确实保存真实数据库返回并授权导出：`answering_bridge.mjs:42`、`:77`；freeze要求当前发布且禁止覆盖，见`:87–93`。这证明交付来源链，不证明业务正确。

## 独立算法、Gold与diagnosis审查

25题 `independent-plan.md` 均有自然语言推导、题面引文及假定，不是仅列字段节点。以下结论依据实际返回或具体源pointer，不以analysis自述单独认定。

| 题 | 审阅判断与具体证据 |
|---|---|
| local002 | **未决合理。** `executor-events.jsonl:6` 实算金额OLS为4340.100656966221；`:7–10` 验证缺期、日序及精度替代。`analysis.json#/limitations` 没把Gold不匹配升级为Gold错误。 |
| local010 | **局部Gold冲突证据充分。** `blind.json#/documents/haversine_formula.md/content` 明确无向归并；`bins.json-response.json#/details/preview/rows/5` 为5000箱3对；`executor-events.jsonl:9–10` 列出3对及6个正反方向。方向变体重现6不证明Gold内部代码。 |
| local040 | **去重诊断有实证，冻结独立解不能当正确答案。** `executor-events.jsonl:1` 为690626行、683788个tree_id；`post-distinct-tree-original.json-response.json#/details/preview/rows` 恢复全部Gold均值。`analysis.md`“冻结的独立答案与自查错误”明确承认独立解也错误。 |
| local049 | **公司/关联行冲突有实证。** `post-raw-final.json-response.json#/details/preview/rows/0` 为179、59.67；`analysis.json#/limitations` 保留date_joined与身份解释限制，未把COUNT(*)匹配当标准口径。 |
| local168 | **数值重建成立，业务未唯一。** `executor-events.jsonl:26` 得101300但只有2种技能；`analysis.json#/limitations` 明确不足三种及并列问题。不能称“三技能业务算法已确证”。 |
| local037 | **支付事件/订单差异已定位，保留歧义正确。** `executor-events.jsonl:5` 三类事件与订单差为24/25/19；`:6` 给真实不同payment_sequential反例。原字段证据在 `original-spec-extract.json#/5/message/details/fields/7/value`。 |
| local050 | **重建充分，舍入层级与资格分开。** `executor-events.jsonl:7–9` 分别增加2021可见资格、月度中间量及商品舍入，最后得2604.236291208791；`analysis.json#/limitations` 没宣称唯一业务依据。 |
| local061 | **12月数值分叉完整定位。** `executor-events.jsonl:6` 输出历史总体与2021可见总体的12月比较；`:7` 给被排除商品反例。仍缺目标年资格的唯一业务依据。 |
| local067 | **DESC与余数分配诊断成立。** `executor-events.jsonl:7–8` 验证DESC边界及同额成员分配，不把ASC失分称唯一语义错。 |
| local064 | **全年月份遗漏有证据；Gold指纹不能覆盖全部错误。** `executor-events.jsonl:1` 数据仅到4月；`:4` 同时比较全年/观测月及purchase，`:5` 重跑旧SQL。`analysis.json#/summary` 正确区分实现遗漏和Gold数值机制。 |
| local056 | **两维歧义证据充分。** `executor-events.jsonl:3` 观测月ABS赢家STEPHEN；`analysis.json#/fork_node` 明确缺月资格在前、formula在后，未误说只加ABS便恢复原-Gold差异。 |
| local070 | **得分1不等于业务规则确证。** `key-comparison.json#/independent_gold_exact_rows` 为true，`/original_mismatched_dates` 为6日；`analysis.json#/limitations` 仍披露代表城规则未定义。 |
| local167 | **Gold资格冲突充分。** `ca-person-inventory.json-response.txt#/details/preview/rows/0` 的Katie Hill唯一任期不含年末；`comparison-input.json#/goldCsv/0/content` 为CA43；独立授权CSV为CA42。 |
| local169 | **未决是诚实结论。** `executor-events.jsonl:8–13` 实测起始期、删失、周年、空隙桥接及日期维表行/人粒度，仍不能共同解释Gold。4033队列及固定分母有实际返回，不能仅用一期接近值归因。 |
| local171 | **局部Gold下界冲突充分。** `period31-counterexample-members.json-response.txt#/details/preview/rows` 给5名合法男性LA在任者；观察窗变体能匹配Gold，但题面没有该窗。首州/任一州另行保留歧义合理。 |
| local358 | **重复人数错误确定，时间解释不确定。** `executor-events.jsonl:1` 为320行/30用户；`:9–12` 分别复跑raw、参考日、匹配区间及生日反例。`original-final-fields.json#/0/value/keyColumns` 与`/8/value` 自身存在“身份键/每行一人”矛盾；分类为纯实现错应保留这一语义前提风险。 |
| local220 | **姓名合并冲突有真实身份反例。** `executor-events.jsonl:5–6` 列出不同Marcelo/Ricardo身份及合并极值301/163。分析没有承诺姓名修正就一定得分，另披露额外输出列问题。 |
| local263 | **Gold超计数有实测，不只是倍率猜测。** `query-underkeyed-join-response.json#/details/preview/rows` 同时给108/234与36/78；`analysis.json#/limitations` 区分模型/步歧义与漏step重建。 |
| local264 | **跨步放大有实测。** `query-underkeyed-join-response.json#/details/preview/rows/0` 为639、213、426跨步行。重建Gold算法仍不是Gold源码证明。 |
| local335 | **不能唯一归因，分析处理正确。** `executor-events.jsonl:9–12` 显示得分车队归属与driver-constructor积分两种不同机制都能恢复Gold名称，且有真实转队反例。 |
| local131 | **全集资格未决合理。** `executor-events.jsonl:1` 给25风格及5个全零行；`comparison-input.json#/goldSql` 明确非零筛选。不是实现不遵从原全集Spec。 |
| local269 | **数值机制有证据，最终组合定义仍未决。** `executor-events.jsonl:6` 给7条根叶路径，`:8` 跨根去重得到3184/6=530.67。没有把此标量吻合升格为正确组合均值。 |
| local273 | **守恒及分母分叉有实证。** `executor-events.jsonl:7–8` 给完整Gold向量及库存部分耗用反例；`:10` 重跑原订单满足率。分母仍未定义，保留未决合理。 |
| local279 | **并列政策单因解释被排除，未决有计算支撑。** `executor-events.jsonl:8` 保存168组有效替代，`:9` 重跑原递归仍与独立一致；不能称已唯一确定Gold日期错误机制。 |
| local331 | **局部Gold冲突充分。** `end-is-not-observed.json-response.txt#/details/preview/rows/0/0` 为0；`synthetic-end-counterfactual.json-response.txt#/details/preview/rows` 精确恢复 `/detail,33; END,7; /,2`。不存在的END不是实际第三页面访问。 |

## 残余风险与审阅边界

1. **独立性时序可核对，但不能证明全部文件读取历史。** 现存工具日志记录查询而非所有文件读取；不能仅凭“independent:true”认证未提前读过旧材料。
2. `cases/local061/independent-plan.md:3` 明确已见相近题local050的Gold重建方案。当前SQL未采用该资格，未发现可证明的本题提前reveal；但“完全无相关Gold先验”的强声明不成立。
3. 独立计划文件没有可核验的首次写入时间，不能仅靠当前文件证明其一定先于查询写成。
4. 未重新计算所有Receipt内容hash、未重新执行官方评分。因此评分1/0是持久化评分记录，不是本审阅新跑的测试结果。
5. `cases/local040/analysis.json#/limitations/1` 明确独立冻结答案也错误；应计为“完成调查”，不能计为“独立正确解出”。
6. 只有 `lanes/E/analysis-index.md`、`lanes/G/analysis.md` 有lane分析索引；A/B/C/D/F汇总尚缺。公共进度文件也需刷新。
7. 目录存在并发更新；后续补齐必须重新核对，不自动继承本报告的完成状态。

**Merge verdict：BLOCK。** 原因是35题完整交付未满足及公共validation不可作为当前验收依据；已完成的25题证据链总体可信，业务未决项多数披露得当。
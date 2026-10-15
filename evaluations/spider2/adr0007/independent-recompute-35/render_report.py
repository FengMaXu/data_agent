"""Render the independently solved cases; never executes SQL or overwrites the previous report."""
import json,collections,sys,re
from pathlib import Path
HERE=Path(__file__).resolve().parent
ids=(HERE/'case-ids.txt').read_text(encoding='utf8').split()
validation=json.loads((HERE/'progress-validation.json').read_text(encoding='utf8'))
partial='--partial' in sys.argv
if not partial and validation['analyzed_cases']!=len(ids): raise SystemExit('Not all 35 analyses persisted; final report refused. Use --partial only for explicitly labelled intermediate report.')
if not partial and validation['validation_error_cases']: raise SystemExit('Evidence validation errors; final report refused.')
analyses=[]
for id in ids:
    p=HERE/'cases'/id/'analysis.json'
    if p.exists(): analyses.append(json.loads(p.read_text(encoding='utf8')))
counts=collections.Counter(x['status'] for x in analyses)
synthesis=(HERE/'pattern-synthesis.md').read_text(encoding='utf8') if (HERE/'pattern-synthesis.md').exists() else ''
label={'confirmed_semantic_error':'口径错误已定位','confirmed_implementation_error':'实现错误已定位','gold_conflict':'Gold局部冲突','ambiguous_after_recompute':'重算后仍有歧义','data_or_dialect_error':'数据/方言问题','independent_solution_error':'独立题解发现错误','not_completed':'未完成'}
header=['# 字段树测评：35道原未定位题的独立数据库重算','',('> **中间成果，尚未完成全部35题，不是最终结论。**' if partial else '> 35题均已实际重算并完成逐题复盘：3题原系统局部错误，17题Gold局部冲突，15题业务解释未唯一裁决（其中12题已复现差异机制）。独立计算在先，Gold核对与原字段审查在后。'),'','**导航**：[逐题索引](#case-index) · [结论与模式](#findings) · [逐题正文](#case-details) · [证据验收](#evidence-review)','','## 范围与方法','',f"范围为原审计中35道根因未定位题。实际数据库计算覆盖{validation['actual_database_cases']}/35题，独立答案冻结{validation['frozen_cases']}/35题，持久化分析{validation['analyzed_cases']}/35题。",'', '每题仅以原题、任务业务文档、正式DDL和数据库形成独立算法，保存自然语言推导、SQL、原始查询结果。独立最终结果生成并发布后不可覆盖冻结，随后读取Gold与原SQL；最后才审查原Spec。原运行、Gold和数据库均未改写。', '', '工具适配器仅承担只读查询授权、任务记账、最终Candidate和Receipt持久化，不作为独立解题方法，不运行原评测模型，不调用其口径建议。当前仓库已删除旧begin/revise，记录采用现行set工具。未配置外部反馈/比较建议、fanout关闭；这些保障不可用，不应宣称通过机器语义认证。', '', '本轮是有较大人工探索预算的离线独立研究，不是原模型、原预算下的重跑，也不是新旧接口A/B。Gold评分仍采用官方逐列比较；吻合不自动证明业务正确，题面约束、业务键与计算不变量另行核对。', '', '## 汇总','', '| 状态 | 数量 |','|---|---:|']
for k,v in counts.items(): header.append(f"| {label.get(k,k)} | {v} |")
header+=['','<a id="case-index"></a>','## 逐题索引','','| 题目 | 独立答案官方评分 | 归因 | 相关节点（不全是原错误） | 摘要 |','|---|---:|---|---|---|']
byid={x['instance_id']:x for x in analyses}
for id in ids:
    a=byid.get(id,{})
    p=HERE/'cases'/id/'csv-comparison.json'
    c=json.loads(p.read_text(encoding='utf8')) if p.exists() else {}
    summary=str(a.get('summary','尚未完成')).replace('|','\\|').replace('\n',' ')
    review=a.get('parent_field_review',{})
    node=review.get('relevant_node') or a.get('fork_node') or '未确定/不适用'
    if review and not review.get('node_is_confirmed_original_error'): node+='（差异相关，非原错误确证）'
    header.append(f"| [{id}](#{id}) | {c.get('independent_official_score','—')} | {label.get(a.get('status'),a.get('status','待完成'))} | {node} | {summary} |")
header+=['','<a id="findings"></a>',synthesis,'','<a id="case-details"></a>','## 逐题分析','']
for id in ids:
    header+= [f'<a id="{id}"></a>',f'### {id}','']
    p=HERE/'cases'/id/'analysis.md'
    if p.exists():
        text=p.read_text(encoding='utf8')
        text=re.sub(r'^# ', '#### ',text,flags=re.M)
        header.append(text)
    else: header.append('尚未完成，不能给出根因结论。')
    header+=['']
review=HERE/'validation-review.md'
if review.exists(): header+=['<a id="evidence-review"></a>','## 最终证据与完整性复核（父Agent）','',review.read_text(encoding='utf8')]
header+=['','## 复现材料','','- 各题原始数据库执行日志：`independent-recompute-35/cases/<id>/executor-events.jsonl`。','- 各题任务、观测证据和发布日志：`tool-events.jsonl`、`answering-state.json`。','- 独立冻结答案：`independent-freeze.json`以及其Receipt对应的`publications/`。','- Gold揭示与三方比较：`comparison-input.json`、`csv-comparison.json`。','- 引文、时间顺序和Candidate绑定校验：`progress-validation.json`。','- 范围、隔离和执行说明：`PROTOCOL.md`、`lane-board.json`。','']
name='fieldtree-unresolved35-recompute-partial.md' if partial else 'fieldtree-unresolved35-recompute.md'
out=HERE.parent/name
out.write_text('\n'.join(header),encoding='utf8')
(HERE/'classification-summary.json').write_text(json.dumps({'cases':len(analyses),'statuses':dict(counts),'report':str(out).replace('\\','/'),'partial':partial},ensure_ascii=False,indent=2),encoding='utf8')
print(str(out))

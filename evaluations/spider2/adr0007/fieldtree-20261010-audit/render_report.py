"""Render the reviewed latest-run case analyses and pattern synthesis as Markdown."""
import collections
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPORT = HERE.parent / 'fieldtree-wrong118-20261010-analysis.md'
PATTERNS = {
    'population_scope':'总体资格与条件阶段', 'source_or_identity':'来源或实体身份',
    'formula_aggregation':'公式、嵌套粒度与权重', 'count_or_join':'计数对象或连接权重',
    'time_or_missing':'时间锚点、端点或缺期', 'ranking_or_ties':'排名域、选取与并列',
    'units_or_precision':'运算单位或精度', 'output_values':'被评分的输出值/行形状',
    'spec_sql_drift':'已声明口径与SQL漂移', 'spec_api_friction':'字段接口/探针摩擦',
    'gold_conflict':'Gold与题面冲突', 'insufficient_evidence':'证据不足未定位'
}
STATUSES={'confirmed':'可证差异','probable':'较强候选','unresolved':'未定位','gold_conflict':'Gold冲突'}


def read_json(path):return json.loads(path.read_text(encoding='utf8'))


def main():
    from review_helpers import validate, verify_sql_bindings, fenced_text
    cases=[json.loads(l) for l in (HERE/'case-analyses.jsonl').read_text(encoding='utf8').splitlines()]
    registry=read_json(HERE/'registry.json')
    binding_count=verify_sql_bindings(registry)
    assert binding_count==101
    expected=[r['instance_id'] for r in registry if r['group']=='wrong']
    errors,quote_count=validate(cases,expected)
    if errors:raise ValueError('\n'.join(errors))
    stats=read_json(HERE/'artifact-summary.json')
    status_counts=collections.Counter(c['cause_status'] for c in cases)
    count_map=collections.Counter(c['primary_pattern'] for c in cases)
    unscored=[r['instance_id'] for r in registry if r['group']=='unscored']
    lines=['# 最新字段树测评：逐题错因分析与模式识别', '',
           f'> Run：`{stats["run"]}`。离线复核，不执行数据库 SQL、不重跑模型。', '',
           '## 1. 结论与审阅范围', '',
           '**本次实际有 61 道已评分错题，另有 17 道无评分案例；两类不能混算。**', '',
           '| 指标 | 本文核对后的值 |', '|---|---:|',
           '| 计划题数 | 118 |', '| 有官方逐题评分 / CSV 重放 | 101 / 101 |',
           '| 判对 / 判错 | 40 / 61 |', '| 无评分 | 17 |',
           '| 已提交样本正确率 | 40 / 101 = 39.60% |',
           '| 固定 118 题分母正确率 | 40 / 118 = 33.90% |', '',
           '**汇总文件不一致必须先纠正。** `report.md`、`official_score/evaluation.json`、`score-record.json`仍展示首批的18/39；最新`official_score/summary.json`的`execResult.caseScores`已合并为101题、40题正确，但同一对象的`score`仍为22/62，`fixedDenominator`仍是22/118。这些值不能直接互换。本文以两次评分文件的逐题map为准，并重放101份CSV，全部与逐题分数一致。详情见评分与执行链专项审计。', '',
           '61 题逐题分析已完成阅读；其中：' + '，'.join(f'{STATUSES[k]} {status_counts[k]} 题' for k in STATUSES) + '。**“可证差异”不代表已证明解释全部数值失分；候选与未定位的题保留证据边界。**',
           f'逐题证据共 **{quote_count}** 条，通过来源文件、JSON pointer或JSONL题号、逐字引文核验；校验不是语义正确性认证。', '',
           '**关键模式**：字段齐全仍可声明错误的计算拓扑（客户比率再分段平均、先删历史再LAG、错误排名域）；Ready与published不是语义认证；输出表示/Gold冲突混入同一0分；35题缺细则无法定位，不强贴原因。优先修评分汇总和补证，再做计算图回归。', '',
           '快速导航：[逐题分析](#cases) · [模式与改进优先级](#patterns) · [17道无评分审计](#process-audit)。', '',
           '## 2. 方法与证据边界', '',
           '1. 按评分attempt挑选`cases/<id>/attempts/<attempt>/result.json`与`trace.json`，不用case根的陈旧结果。local099/130/131已重试，根记录的402不能当本次最终结果。',
           '2. 对照题面/已审核标准、实际set_answer_spec成功与拒绝返回、提交SQL、判分CSV；101题的提交SQL、官方评分SQL缓存、result.finalSql内容一致。',
           '3. 官方CSV比较忽略列名和列序，额外预测列本身不会造成失败；`condition_cols`决定Gold检查列，`ignore_order`决定是否忽略行序，数值容差为0.01。因此不把改别名/多列/列序单独归为本次错因。',
           '4. 保留18节点词汇及最早可证分叉；可见性仅对口径错适用。字段引用存在、字段applied、Spec已Ready或结果已published，均不自动证明业务语义正确。',
           '5. Gold SQL缺失、隐含口径无法恢复时不从数值倒推业务事实。Gold冲突必须有明确题面或定义矛盾；probe等价只证明所列候选输出相同，不证明候选全集覆盖正确答案。',
           '6. 本文只读事后审阅；纯CSV判分重放是反馈环，没有执行solver SQL或重现runtime缺陷。修复建议是后续实验/回归检查，不是已经实施或验证的修复。', '',
           '主要来源：`official_score/summary-attempt-001.json`、`summary-retry.json`、每题attempt的result/trace/submissions、Spider2原题、`spec-quality-labels.jsonl`、Gold CSV/SQL、`evaluation_suite/evaluate.py:60–125`。原run未修改。', '',
           '<a id="cases"></a>', '## 3. 61 道错题逐题分析', '',
           '| 题号 | 判因状态 | 最早可证节点 | 主模式 |', '|---|---|---|---|']
    lines += [f'| [{c["instance_id"]}](#{c["instance_id"]}) | {STATUSES[c["cause_status"]]} | `{c.get("bifurcation_node") or "未定位"}` | {PATTERNS[c["primary_pattern"]]} |' for c in cases]
    for c in cases:
        ident=c['instance_id']
        lines += ['',f'<a id="{ident}"></a>',f'### {ident} — {c["title"]}', '',
                  f'- **Attempt**：`{c["attempt_id"]}`；官方CSV分数及离线重放均为0。',
                  f'- **定性**：{STATUSES[c["cause_status"]]}；节点 `{c.get("bifurcation_node") or "未定位"}`；错误层：{c.get("error_layer") or "未定/不适用"}；可见性：{c.get("visibility") or "不适用或未定"}。',
                  '- **题面/标准**：'+c['standard'],
                  '- **本次SQL**：'+c['actual'],
                  '- **实际失配**：'+c['observed_difference'],
                  '- **Spec处理**：'+c['spec_handling'],
                  '- **错因分析**：'+c['cause']]
        if c['process_findings']:
            lines += ['- **过程机制**：'+'；'.join(c['process_findings'])]
        lines += ['- **后续验证/修复**：'+c['recommendation']]
        if c['limitations']:
            lines += ['- **限制**：'+'；'.join(c['limitations'])]
        lines += ['', '**原文证据**：', '']
        for e in c['evidence']:
            ref=e['source_file']
            if e.get('record_id'):ref+=' #'+e['record_id']
            if e.get('json_pointer'):ref+=' '+e['json_pointer']
            lines += [f'- **{e["role"]}**：`{ref}`'] + fenced_text(e['quote']) + [e['supports']]
    lines += ['', '<a id="patterns"></a>', '## 4. 模式识别', '',
              '以下主模式统计以61道错题为分母，每题只计一个主模式；次模式可以重叠。较强候选、Gold冲突、未定位单独列出，不把它们并入已证明的业务错因。', '',
              '| 主模式 | 可证差异 | 较强候选 | Gold冲突 | 未定位 | 合计 | 题号 |', '|---|---:|---:|---:|---:|---:|---|']
    for key,count in count_map.most_common():
        xs=[c for c in cases if c['primary_pattern']==key];cc=collections.Counter(c['cause_status'] for c in xs)
        lines.append(f'| {PATTERNS[key]} | {cc["confirmed"]} | {cc["probable"]} | {cc["gold_conflict"]} | {cc["unresolved"]} | {count} | '+ '、'.join(c['instance_id'] for c in xs)+' |')
    synthesis=HERE/'pattern-synthesis.md'
    if not synthesis.exists():raise ValueError('Parent pattern synthesis must exist before publication')
    lines += ['', synthesis.read_text(encoding='utf8').strip(), '',
              '### 过程统计：关联不等于因果', '',
              '| 组别 | 有outcomes的applied路径次数 | rejected路径次数 | 路径被拒比例 |', '|---|---:|---:|---:|']
    for g,name in [('wrong','61道错题'),('correct','40道判对题'),('unscored','17道无评分案例（部分记录缺失）')]:
        outcomes=stats['set_outcomes']
        applied=sum(x['count'] for x in outcomes if x['group']==g and x['status']=='applied')
        rejected=sum(x['count'] for x in outcomes if x['group']==g and x['status']=='rejected')
        lines.append(f'| {name} | {applied} | {rejected} | {rejected/(applied+rejected):.2%} |')
    lines += ['', '这些是工具实际返回outcomes里的路径尝试次数，不是整次调用失败率，也不包含没有outcomes的失败。判对题同样出现接口拒绝，因此不能把“出现过API错误”直接当作SQL失分的原因。错题集与判对集难度不同，不能由拒绝率差直接归因接口设计。', '',
              '| 组别 | Spec feedback完成 | 不可用 | 最终fanout clear / unknown / n/a |', '|---|---:|---:|---|']
    for g,name in [('wrong','61道错题'),('correct','40道判对题')]:
        xs=[r for r in registry if r['group']==g]
        completed=sum(r['spec_feedback_metrics'].get('byStatus',{}).get('completed',0) for r in xs)
        unavailable=sum(r['spec_feedback_metrics'].get('byStatus',{}).get('unavailable',0) for r in xs)
        f=[sum(r['fanout_metrics'].get('byStatus',{}).get(k,0) for r in xs) for k in ['clear','unknown','not_applicable']]
        lines.append(f'| {name} | {completed} | {unavailable} | {f[0]} / {f[1]} / {f[2]} |')
    lines += ['', '反馈不可用与fanout unknown是保障覆盖限制，不是业务口径错误的证明；0个finding也不等于已经排除连接放大。上述计数由prepare_review.py从本attempt结果重算。', '',
              '<a id="process-audit"></a>', '## 5. 无评分案例与评分/执行链专项审计', '',
              '**以下17题没有最新官方分数，不属于61道已评分错题的语义归因分母：** '+ '、'.join(unscored)+'。', '']
    audit=(HERE/'score-and-process-audit.md').read_text(encoding='utf8')
    for line in audit.splitlines():
        if line.startswith('#'):line='#'+line
        lines.append(line)
    lines += ['', '## 6. 复核材料', '',
              '- `fieldtree-20261010-audit/registry.json`：118题的最新attempt、分数和原始文件绑定。',
              '- `fieldtree-20261010-audit/case-analyses.jsonl`：61题结构化分析及完整原文引用。',
              '- `fieldtree-20261010-audit/artifact-summary.json`：CSV重放、过程统计及作用范围。',
              '- `fieldtree-20261010-audit/prepare_review.py`：只读抽取及101份CSV比较重放，不执行SQL。',
              '- `fieldtree-20261010-audit/review_helpers.py`：引用和覆盖校验。',
              '- `fieldtree-20261010-audit/PROTOCOL.md`：定性、字段与证据不足的审阅规则。',
              '- `fieldtree-20261010-audit/audit_process.py`、`score-process-evidence.json`：17题停止位置和55条逐字过程引用，可单独重算校验。',
              '- `fieldtree-20261010-audit/parent-review-overrides.json`：父复核对3个输出表示案例的保守修订，不把评分布局直接标成业务口径错。', '',
              '```bash',
              'python evaluations/spider2/adr0007/fieldtree-20261010-audit/review_helpers.py --merge',
              'python evaluations/spider2/adr0007/fieldtree-20261010-audit/render_report.py',
              '```', '',
              '后续若补齐Gold业务细则或重跑，需要另存版本，不能把本文未定位题静默改成已证实。']
    REPORT.write_text('\n'.join(lines)+'\n',encoding='utf8')
    summary={'scored_wrong_cases':len(cases),'verbatim_citations':quote_count,'cause_status':dict(status_counts),'primary_patterns':dict(count_map),'unscored_cases':unscored,'report':str(REPORT).replace('\\','/')}
    (HERE/'review-validation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':main()

"""Render the validated annotations as a human-readable, evidence-linked review."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    records = [json.loads(x) for x in (HERE / 'wrong118-relabel-v2.jsonl').read_text(encoding='utf-8').splitlines()]
    summary = json.loads((HERE / 'validation-summary.json').read_text(encoding='utf-8'))
    lines = ['# 118 份错题卷宗：ADR-0007 三维重标', '',
             '来源：`evaluations/spider2/wrong118-dossiers.jsonl`。按源文件顺序逐题列出；每条引用给出卷宗行号和 JSON pointer。', '',
             '## 使用边界', '',
             '- 这是离线卷宗归因，不重新执行 SQL；标准口径、Gold SQL、最终 SQL、Spec 与决定记录是各自独立的证据。',
             '- 18 节点按“总体→度量→分组→选取→输出”选最早可证差异，不把结果行数/数值变化直接当作节点证据。',
             '- 未声明指卷宗可见声明中没有该细项；记录缺失不能证明运行时从未声明。调用参数没有成功返回时不认定已生效。',
             '- 五种可见性均描述错误声明；节点正确声明而 SQL 写错时，如不能适用五类，保留 null 并记 taxonomy_gap。',
             '- 仅结果不同但标准细则不足、最终 SQL 与导出候选可能错配等，保留三项 null 并记 insufficient_evidence。它不是“树外”、不是证明 Gold 错，也不是已完成定性。',
             '- 校验程序检查覆盖、枚举、来源 run、引用路径和逐字引文，不构成语义正确性认证。', '',
             f'已复核记录 **{summary["rows"]}** 条，唯一题号 **{summary["unique_ids"]}** 个；逐字校验通过 **{summary["verbatim_citations_checked"]}** 条引文。',
             f'能够定位节点与错误层：**{summary["classification_status"].get("classified", 0)}** 题；证据不足待定：**{len(summary["insufficient_evidence"])}** 题；已定位但可见性定义缺口：**{len(summary["taxonomy_gaps"])}** 题。', '',
             '## 分类分布', '']
    for title, key in [('分叉节点', 'nodes'), ('错误层', 'layers'), ('可见性', 'visibility')]:
        lines += [f'### {title}', '', '| 标签 | 题数 |', '|---|---:|']
        lines += [f'| {k} | {v} |' for k, v in summary[key].items()]
        lines.append('')
    lines += ['## 待补证据与定义缺口', '',
              '- 证据不足：' + ('、'.join(summary['insufficient_evidence']) or '无') + '。',
              '- 可见性定义缺口：' + ('、'.join(summary['taxonomy_gaps']) or '无') + '。', '',
              '## 逐题标注', '']
    for x in records:
        lines += [f'### {x["dossier_line"]}. {x["instance_id"]}', '',
                  f'- 运行：`{x["latest_wrong_run"]}`；卷宗行：{x["dossier_line"]}。',
                  f'- 分叉节点：**{x["bifurcation_node"] or "待定（证据不足）"}**；错误层：**{x["error_layer"] or "待定（证据不足）"}**；可见性：**{x["visibility"] or ("定义缺口" if x["visibility_status"] == "taxonomy_gap" else "待定（证据不足）")}**。',
                  f'- 状态：`{x["classification_status"]}`；置信：`{x["confidence"]}`。',
                  '- 标准：' + x['comparison']['standard'],
                  '- SQL 实际：' + x['comparison']['actual'],
                  '- 最早分叉依据：' + x['comparison']['earliest_reason'],
                  '- 错误层依据：' + x['layer_reason'],
                  '- 可见性依据：' + x['visibility_reason']]
        if x['comparison'].get('secondary_nodes'):
            lines.append('- 其他差异：' + json.dumps(x['comparison']['secondary_nodes'], ensure_ascii=False))
        if x.get('tree_out_reason'):
            lines.append('- 树外原因：' + x['tree_out_reason'])
        for e in x['evidence']:
            lines += ['', f'**{e["role"]} 原文**（卷宗第 {x["dossier_line"]} 行，`{e["path"]}`）：', '', '```text', e['quote'], '```', e['supports']]
        if x['limitations']:
            lines += ['', '**证据限制**：'] + ['- ' + v for v in x['limitations']]
        lines.append('')
    (HERE / 'wrong118-relabel-v2.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('Rendered', len(records), 'dossiers')


if __name__ == '__main__':
    main()

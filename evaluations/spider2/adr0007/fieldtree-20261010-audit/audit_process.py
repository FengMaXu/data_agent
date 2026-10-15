"""Read-only score, terminal-state and partial event-log audit. No SQL execution."""
import json,collections
from pathlib import Path
from review_helpers import check_quote,resolve,fenced_text
HERE=Path(__file__).resolve().parent
R=json.loads((HERE/'registry.json').read_text(encoding='utf8'))
RUN=Path(json.loads((HERE/'artifact-summary.json').read_text(encoding='utf8'))['run'])
E=[]

def cite(file,pointer,value,why,event_sequence=None):
    e={'source_file':str(file).replace('\\','/'),'json_pointer':pointer,'quote':value if isinstance(value,str) else json.dumps(value,ensure_ascii=False),'supports':why}
    if event_sequence is not None:e['event_sequence']=event_sequence
    assert not check_quote(e),e
    E.append(e);return e


def main():
    ss=[json.loads((RUN/'official_score'/f).read_text(encoding='utf8')) for f in ['summary-attempt-001.json','summary-retry.json','summary.json']]
    maps=[s['execResult']['caseScores'] for s in ss]
    assert not set(maps[0])&set(maps[1]);assert maps[2]==maps[0]|maps[1]
    assert len(maps[2])==101 and sum(maps[2].values())==40
    lines=['# 评分及执行链专项审计','', '此部分由父协调者补齐中断的审计工作。纯CSV重放与逐题来源校验不是数据库重跑，也不是独立业务正确性认证。','',
           '## 评分文件版本','', '| 文件 | map题数/判对 | 对外比例 | 判断 |','|---|---|---|---|',
           '| summary-attempt-001.json | 39/18 | 18/39 | 首批 |','| summary-retry.json | 62/22 | 22/62 | 第二批 |',
           '| summary.json | 101/40 | score仍22/62；fixed仍22/118 | map已合并，比例未同步 |',
           '| report.md、evaluation.json、score-record.json | 仍为首批 | 18/39 | 不能作为最新分母 |','',
           '两个map无重叠，latest map恰等于二者并集。101份CSV重放全部一致；118固定集合中有17题无分数。run根summary只记录115个旧终态，根结果仍含local099/130/131早先402；这三题最新attempt已发布且分别判对/判对/判错，不纳入最新无评分。','',
           '汇总原文：']
    for pointer in ['/execResult/correct','/execResult/total','/execResult/score','/execResult/fixedDenominator']:
        v=resolve(ss[2],pointer);e=cite(RUN/'official_score/summary.json',pointer,v,'map与比例口径不同，应按实际题目map重算。')
        lines += [f'- `{e["source_file"]} {pointer}`：`{e["quote"]}`']
    lines+=['','## 17道无评分的逐题停止位置','',
            '13个保存为timeout、1个保存为max_tool_calls、3个缺失result/trace终态。timeout是运行器终态，不等于数据库查询超时；记录时长不能直接当单个API时长。三段缺终态日志只记录观测窗口，不按0秒或timeout计入平均。','',
            '| 题号 | 保存状态 | 时长/观测窗（秒） | 最后可见位置 |','|---|---|---:|---|']
    notes={'local018':'grouping仍open；两次451后比较返回建议，未见最终决定或结果查询。',
           'local023':'只见6个知识/子代理工具，未建立Spec；最后patterns子代理完成。',
           'local024':'Spec eligibility及ties open，3个探索已返回，未见最终决定。',
           'local025':'只见5个知识/子代理工具，未建立Spec；某子代理返回空content。',
           'local026':'知识section S08/S03两次not found；未建Spec，最后子代理空content。',
           'local028':'timeField两候选有不同输出，比较已有建议，但字段尚open。',
           'local029':'只见4个工具，停知识阅读；未建立Spec。',
           'local031':'已建Spec，formula/selection/output未声明且4字段open；继续找语义/业务知识。',
           'local032':'只见4个工具，schema子代理完成；未建立Spec。',
           'local034':'只见5个工具，停知识检索；未建立Spec。',
           'local035':'最后set已无undeclared/open，可执行结果；未见结果查询或export，不是已证Spec阻断。',
           'local062':'eligibility尚open；比较已有倾向，未见最终决定或结果。',
           'local063':'selection尚open；22个query调用含预算障碍，末两次返回exploration budget exhausted。',
           'local212':'第50工具已生成候选；第51 export被取消，MAX_TOOL_CALLS停止，无发布CSV。'}
    for r in R:
        if r['group']!='unscored':continue
        id=r['instance_id'];file=Path(r['result_file'])
        if r['result_exists']:
            res=json.loads(file.read_text(encoding='utf8'));duration=res['durationMs']/1000
            lines.append(f'| {id} | {res["status"]} | {duration:.3f} | {notes[id]} |')
            cite(file,'/status',res['status'],'保存的运行终态，不是SQL语义得分。');cite(file,'/error/message',res['error']['message'],'实际停止标记。')
            trace=json.loads(Path(r['trace_file']).read_text(encoding='utf8'));calls=trace['toolCalls']
            chosen=len(calls)-1
            if id=='local212':chosen=len(calls)-1
            c=calls[chosen]
            txt=[v['text'] for v in c.get('result',{}).get('content',[]) if v.get('type')=='text']
            if txt:
                snippet=txt[0][:900]
                e=cite(Path(r['trace_file']),f'/toolCalls/{chosen}/result/content/0/text',snippet,notes[id])
                lines += []
            if id=='local212':
                e=cite(Path(r['trace_file']),'/toolCalls/49/result/content/0/text','[RESULT_CANDIDATE]','停止前已生成候选，不是SQL未成功。')
        else:
            events=file.parent/'record/events.jsonl';first=None;last=None;counts=collections.Counter();set_event=None;last_query=None
            for line in events.open(encoding='utf8'):
                v=json.loads(line);first=first or v;last=v;counts[v['type']]+=1
                if v['type']=='entry_added':
                    msg=v['payload']['entry'].get('message',{})
                    if msg.get('toolName')=='set_answer_spec' and msg.get('role')=='toolResult':set_event=v
                if v['type']=='tool_start' and v['payload'].get('toolName')=='query_database':last_query=v
            duration=(last['occurredAt']-first['occurredAt'])/1000
            detail=f'{counts["tool_start"]}工具start/{counts["tool_end"]}end；末事件'+last['type']
            if last['type']=='message_update':detail+='/'+last['payload'].get('updateType','')
            if set_event:
                d=set_event['payload']['entry']['message']['details'];detail+='；undeclared='+str(d.get('undeclared',[]))+'，open='+str(d.get('open',[]))
                cite(events,'/payload/entry/message/details/undeclared',d.get('undeclared',[]),'最后可见Spec未声明字段。',set_event['sequence'])
                cite(events,'/payload/entry/message/details/open',d.get('open',[]),'最后可见Spec待定字段。',set_event['sequence'])
            lines.append(f'| {id} | record_missing | {duration:.3f}（观测窗） | {detail}；无run_end。 |')
            cite(events,'/payload',last['payload'],'日志末尾未形成运行终态；不归为timeout。',last['sequence'])
    lines+=['','这些停止位置是可见事实，不证明是谁耗尽时间。6个timeout没有Spec、6个有待定字段、1个已Ready；因此不能将全部13个归为字段树死循环。local063可证有探索预算耗尽；local212可证发生在交付阶段。','',
            '## 无评分证据摘录','']
    for e in E:
        if '/official_score/' in e['source_file']:continue
        seq=' sequence='+str(e['event_sequence']) if e.get('event_sequence') is not None else ''
        lines += [f'- `{e["source_file"]}{seq} {e["json_pointer"]}`'] + fenced_text(e['quote']) + [e['supports']]
    lines+=['','## 执行链改进建议','',
            '- 以attempt索引驱动结果汇总；一次性原子更新caseScores、correct/total/score、fixedDenominator与用户报告，防止局部重试后混用不同批次分母。',
            '- 保留未终结的events和启动/结束记录，明确partial≠timeout；取消时落盘停止阶段、正在执行的工具及候选/发布状态。',
            '- 修订/探针/证据预算与外层工具预算分开报告；预留交付工具预算，避免候选已产生却在export被取消。',
            '- 对知识section not found、比较器451、预算障碍作专门回归；不能只看isError，set的路径拒绝或run_python内部status:error也可能发生在isError=false返回中。',
            '- 本审计发现的是现象及保障缺口，没有实施运行器修复，也没有定位全部timeout的上游原因。']
    (HERE/'score-and-process-audit.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
    (HERE/'score-process-evidence.json').write_text(json.dumps(E,ensure_ascii=False,indent=2),encoding='utf8')
    print('PASS score union and',len(E),'verbatim process citations')

if __name__=='__main__':main()

"""Read-only JSONL timing summary; never prints prompts, SQL, rows or secrets.
Usage: python scratch/diagnose-subagent-timing.py
"""
import json
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone, timedelta

ROOT = Path('.data_agent/runtime-web')
TZ = timezone(timedelta(hours=8))
def stamp(ms):
    return datetime.fromtimestamp(ms / 1000, TZ).strftime('%H:%M:%S.%f')[:-3]
def rows(p):
    for ln, line in enumerate(p.open(encoding='utf-8'), 1):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        for item in value if isinstance(value, list) else [value]:
            yield ln, item

def analyze(p):
    entries = []
    final = None
    tool_names = Counter()
    errors = Counter()
    for ln, r in rows(p):
        if r.get('kind') == 'entry' and r.get('type') == 'message':
            entries.append((ln, r['timestamp'], r['message']))
        if r.get('namespace') == 'pi.result' and r.get('value'):
            final = r['value']
    batches = []
    call_to_batch = {}
    assistants = []
    for ln, ts, m in entries:
        content = m.get('content', [])
        content = content if isinstance(content, list) else []
        if m.get('role') == 'assistant':
            assistants.append((ln, ts, m))
            calls = [c for c in content if c.get('type') == 'toolCall']
            if calls:
                batch = {'start': ts, 'end': ts, 'names': [], 'line': ln}
                batches.append(batch)
                for c in calls:
                    batch['names'].append(c['name'])
                    call_to_batch[c['id']] = batch
        elif m.get('role') == 'toolResult':
            tool_names[m.get('toolName')] += 1
            b = call_to_batch.get(m.get('toolCallId'))
            if b:
                b['end'] = max(b['end'], ts)
            if m.get('isError'):
                texts = ' '.join(c.get('text', '') for c in content)
                errors[texts.split(':', 1)[0][:90]] += 1
    start = final['startedAt'] if final else entries[0][1]
    end = final['endedAt'] if final else entries[-1][1]
    tool_wait = sum(b['end'] - b['start'] for b in batches)
    last = assistants[-1] if assistants else None
    last_results = [ts for _, ts, m in entries if m.get('role') == 'toolResult']
    result = {
        'file': str(p), 'start': stamp(start), 'end': stamp(end),
        'wall_s': round((end-start)/1000, 3),
        'tool_batch_wait_s': round(tool_wait/1000, 3),
        'outside_tool_batches_s': round((end-start-tool_wait)/1000, 3),
        'model_responses': len(assistants), 'tool_results': sum(tool_names.values()),
        'tools': dict(tool_names), 'tool_errors': dict(errors),
        'status': final.get('status') if final else 'no_terminal_record',
    }
    if last:
        content = last[2].get('content', [])
        result['final_report_chars'] = sum(len(c.get('text', '')) for c in content if c.get('type') == 'text')
        result['final_response_output_tokens'] = last[2].get('usage', {}).get('output')
        if last_results:
            result['last_tool_to_final_message_s'] = round((last[1]-max(last_results))/1000, 3)
    return result, entries

p = max((ROOT/'sessions').rglob('*.jsonl'), key=lambda p:p.stat().st_mtime)
sid = json.loads(p.open(encoding='utf-8').readline())['id']
parent, entries = analyze(p)
print('SESSION',sid)
print('PARENT',json.dumps(parent, ensure_ascii=False))
calls = {}
child_keys = {}
call_durations = []
for ln, ts, m in entries:
    content = m.get('content', [])
    content = content if isinstance(content, list) else []
    if m.get('role') == 'assistant':
        for c in content:
            if c.get('type') == 'toolCall' and c.get('name') == 'subagent':
                calls[c['id']] = (ts, ln, [t.get('key') for t in c.get('arguments',{}).get('tasks',[])])
    if m.get('role') == 'toolResult' and m.get('toolName') == 'subagent':
        start, start_ln, keys = calls[m['toolCallId']]
        duration = (ts-start)/1000
        call_durations.append(duration)
        print('SUBAGENT_CALL', json.dumps({'start':stamp(start),'end':stamp(ts),'seconds':duration,'call_line':start_ln,'result_line':ln,'keys':keys,'isError':m.get('isError')},ensure_ascii=False))
        details = m.get('details', [])
        if isinstance(details,list):
            for o in details:
                child_keys[o.get('childSessionId')] = o.get('key')
                print('CHILD_OUTCOME',json.dumps({k:o.get(k) for k in ['key','childSessionId','status','error','terminalConfirmed']},ensure_ascii=False))
results=[]
for child in sorted((ROOT/'subagents'/sid).rglob('*.jsonl')):
    result,_ = analyze(child)
    header=json.loads(child.open(encoding='utf-8').readline())
    result['key']=child_keys.get(header['id'])
    results.append(result)
    print('CHILD_TIMING',json.dumps(result,ensure_ascii=False))
print('DELEGATION_WALL_S',round(sum(call_durations),3))
print('REPLAY_CHECK', 'LONG_SILENT_BATCH_OBSERVED' if max(call_durations, default=0)>120 else 'NO_BATCH_OVER_120S')
out=Path('scratch/subagent-timing-latest.json')
out.write_text(json.dumps({'sessionId':sid,'parent':parent,'subagent_call_durations_s':call_durations,'children':results},ensure_ascii=False,indent=2),encoding='utf-8')
print('SUMMARY_FILE',out)

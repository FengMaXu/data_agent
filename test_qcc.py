import json
import urllib.request

req = urllib.request.Request(
    'http://127.0.0.1:8080/agent/chat',
    data=json.dumps({
        'prompt': '请使用企查查工具查询 深圳市怡亚通供应链股份有限公司 的注册地址。只输出最终结果即可。',
        'session_id': 'test-qcc-2',
        'attached_files': [],
        'enabled_mcp_servers': ['database', 'qcc-company', 'qcc-risk', 'qcc-ipr', 'qcc-operation']
    }).encode('utf-8'),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
try:
    with urllib.request.urlopen(req, timeout=120) as response:
        for line in response:
            line = line.decode('utf-8').strip()
            if line.startswith('data:'):
                try:
                    event = json.loads(line[5:].strip())
                    if event['type'] == 'text_delta':
                        print(event['content'], end='', flush=True)
                    elif event['type'] == 'tool_call':
                        print('\n[Tool Call]', event['name'], json.dumps(event['arguments'], ensure_ascii=False)[:200])
                    elif event['type'] == 'tool_result':
                        content = event.get('content', '')
                        print('\n[Tool Result]', content[:300] if content else '(empty)')
                    elif event['type'] == 'error':
                        print('\n[Error]', event['error'])
                    elif event['type'] == 'done':
                        print('\n[Done]', event.get('reason', ''))
                except Exception:
                    pass
except Exception as e:
    print('Error:', e)

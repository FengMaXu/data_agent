import urllib.request
import json
import time
from urllib.error import HTTPError

url = 'http://127.0.0.1:8080/agent/chat'
data = json.dumps({
    "prompt": "2026年餐饮业累计商品销售额是多少",
    "session_id": "test_get_sales_py",
    "attached_files": []
}).encode('utf-8')

req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})

print("Sending request to backend...")
try:
    with urllib.request.urlopen(req) as response:
        for line in response:
            line = line.decode('utf-8').strip()
            if not line: continue
            print(f"RAW LINE: {line}")
            if line.startswith('data: '):
                data_str = line[6:]
                try:
                    event = json.loads(data_str)
                    etype = event.get('type')
                    if etype in ['tool_call', 'tool_result', 'text_delta', 'progress', 'error', 'done', 'agent_message']:
                        print(f"[{etype}] {json.dumps(event, ensure_ascii=False)}")
                except json.JSONDecodeError:
                    pass
except HTTPError as e:
    print(f"HTTPError: {e.code}")
    print(e.read().decode('utf-8', errors='replace'))
except Exception as e:
    print(f"Error: {e}")

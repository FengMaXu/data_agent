import urllib.request
import json
import time

url = 'http://127.0.0.1:8080/agent/chat'
data = json.dumps({
    "prompt": "Please use a tool, like python or terminal, to calculate 2^10 and then reply with the answer.",
    "session_id": "latency_test_py",
    "attached_files": []
}).encode('utf-8')

req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})

start_time = time.time()
first_byte_time = None
tool_call_start = None
tool_call_end = None
first_text_delta = None

print("Sending request to backend...")
try:
    with urllib.request.urlopen(req) as response:
        for line in response:
            line = line.decode('utf-8').strip()
            if not line: continue
            
            if first_byte_time is None:
                first_byte_time = time.time()
                print(f"Time to connection/first byte: {first_byte_time - start_time:.2f} seconds")
            
            if line.startswith('data: '):
                data_str = line[6:]
                try:
                    event = json.loads(data_str)
                    etype = event.get('type')
                    if etype == 'text_delta' and first_text_delta is None:
                        first_text_delta = time.time()
                        print(f"Time to first text generation token: {first_text_delta - start_time:.2f} seconds")
                    elif etype == 'tool_call' and tool_call_start is None:
                        tool_call_start = time.time()
                        print(f"Tool execution started at: {tool_call_start - start_time:.2f} seconds")
                    elif etype == 'tool_result' and tool_call_start is not None:
                        tool_call_end = time.time()
                        print(f"Tool execution finished at: {tool_call_end - start_time:.2f} seconds")
                        print(f"Tool execution duration: {tool_call_end - tool_call_start:.2f} seconds")
                except json.JSONDecodeError:
                    pass

    end_time = time.time()
    print(f"Total turnaround time: {end_time - start_time:.2f} seconds")

except Exception as e:
    print(f"Error: {e}")

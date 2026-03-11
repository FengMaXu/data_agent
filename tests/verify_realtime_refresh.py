import requests
import json
import time


def test_realtime_refresh():
    url = "http://localhost:8000/agent/chat"
    payload = {
        "prompt": "请写三个简单的文本文件到工作区，每个文件之间间隔 2 秒。第一个文件叫 a.txt，第二个叫 b.txt，第三个叫 c.txt。只需执行，不需要解释。",
        "session_id": "test_realtime",
    }

    print(f"Sending request to {url}...")
    response = requests.post(url, json=payload, stream=True)

    start_time = time.time()
    workspace_updates = []

    for line in response.iter_lines():
        if line:
            decoded_line = line.decode("utf-8")
            if decoded_line.startswith("data: "):
                data_str = decoded_line[6:]
                try:
                    event = json.loads(data_str)
                    event_type = event.get("type")
                    current_time = time.time() - start_time

                    if event_type == "workspace_updated":
                        print(
                            f"[{current_time:.2f}s] Received workspace_updated event!"
                        )
                        workspace_updates.append(current_time)
                    elif event_type == "text_delta":
                        pass  # Ignore text deltas for brevity
                    elif event_type == "tool_call":
                        print(f"[{current_time:.2f}s] Tool Call: {event.get('name')}")
                    elif event_type == "tool_result":
                        print(f"[{current_time:.2f}s] Tool Result: {event.get('name')}")
                    elif event_type == "done":
                        print(f"[{current_time:.2f}s] Done.")
                        break
                except json.JSONDecodeError:
                    print(f"Failed to decode: {data_str}")

    print("\nSummary:")
    print(f"Total workspace_updated events: {len(workspace_updates)}")
    if len(workspace_updates) > 1:
        gaps = [
            workspace_updates[i] - workspace_updates[i - 1]
            for i in range(1, len(workspace_updates))
        ]
        print(f"Time gaps between updates: {[f'{g:.2f}s' for g in gaps]}")
        if any(g > 1.0 for g in gaps):
            print("✅ Success: Updates were received incrementally!")
        else:
            print(
                "❌ Failed: Updates were received too close together (possibly batched)."
            )
    else:
        print("❌ Failed: Not enough update events received.")


if __name__ == "__main__":
    test_realtime_refresh()

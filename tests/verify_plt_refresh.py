import requests
import json
import time


def test_matplotlib_realtime():
    url = "http://localhost:8000/agent/chat"
    # This prompt will likely trigger run_python
    payload = {
        "prompt": "请先等待 2 秒，然后生成一张简单的折线图并保存为 'plot1.png'。接着再等待 2 秒，生成第二张图保存为 'plot2.png'。请使用 python 执行并保存。",
        "session_id": "test_plt_realtime",
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
                    elif event_type == "tool_call":
                        print(f"[{current_time:.2f}s] Tool Call: {event.get('name')}")
                    elif event_type == "tool_result":
                        print(f"[{current_time:.2f}s] Tool Result: {event.get('name')}")
                    elif event_type == "done":
                        print(f"[{current_time:.2f}s] Done.")
                        break
                except json.JSONDecodeError:
                    pass

    print("\nSummary:")
    print(f"Total workspace_updated events: {len(workspace_updates)}")
    # We expect at least 2 events if it's real-time
    if len(workspace_updates) >= 2:
        print("✅ Success: Matplotlib updates were received incrementally!")
    else:
        print("❌ Failed: Did not receive incremental updates for plots.")


if __name__ == "__main__":
    test_matplotlib_realtime()

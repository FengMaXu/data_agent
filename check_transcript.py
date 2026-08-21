import sqlite3, json

conn = sqlite3.connect('.data_agent/app.sqlite3')
conn.row_factory = sqlite3.Row
row = conn.execute(
    'SELECT ui_transcript_json FROM chat_sessions WHERE id = ?',
    ('session_0651af9f-68b3-4462-b393-4269dd90f1a5',)
).fetchone()
messages = json.loads(row['ui_transcript_json'])

for i, m in enumerate(messages):
    role = m.get('role')
    content = m.get('content', '')
    stage = m.get('currentStage')
    terminal = m.get('terminalReason')
    msg_id = m.get('messageId', '')
    tools = m.get('toolCallsById', {})
    widgets = m.get('widgetsById', {})

    tool_list = []
    for tk, tv in tools.items():
        tname = tv.get("name", "?")
        tstatus = tv.get("status", "?")
        tool_list.append(f"{tname}={tstatus}")

    widget_list = []
    for wk, wv in widgets.items():
        wkind = wv.get("kind", "?")
        wstatus = wv.get("status", "?")
        widget_list.append(f"{wkind}={wstatus}")

    mid = msg_id[:30] if msg_id else ""
    print(f"[{i}] role={role} stage={stage} terminal={terminal} msgId={mid} contentLen={len(content)}")
    if tool_list:
        print(f"     tools: {tool_list}")
    if widget_list:
        print(f"     widgets: {widget_list}")

conn.close()

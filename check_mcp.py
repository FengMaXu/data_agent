import urllib.request
import json

r = urllib.request.urlopen('http://127.0.0.1:8080/mcp/servers')
data = json.loads(r.read())
for s in data['servers']:
    print(f"{s['name']}: connected={s['connected']}, tools={s['tool_count']}")

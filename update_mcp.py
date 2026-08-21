import json
import urllib.request
import urllib.error

req = urllib.request.Request("http://127.0.0.1:8080/mcp/config", method="GET")
try:
    with urllib.request.urlopen(req) as response:
        current_data = json.loads(response.read().decode())
        servers = current_data.get("servers", [])
except Exception as e:
    print("Error fetching old config:", e)
    servers = []

new_api_key = "Bearer MDuVCZCSXes0t73Ylg8KL5ugVLYXlnbykJppKJeVyZDbWc0G"
new_servers_payload = {
  "qcc-company": {
    "url": "https://agent.qcc.com/mcp/company/stream",
    "headers": { "Authorization": new_api_key }
  },
  "qcc-risk": {
    "url": "https://agent.qcc.com/mcp/risk/stream",
    "headers": { "Authorization": new_api_key }
  },
  "qcc-ipr": {
    "url": "https://agent.qcc.com/mcp/ipr/stream",
    "headers": { "Authorization": new_api_key }
  },
  "qcc-operation": {
    "url": "https://agent.qcc.com/mcp/operation/stream",
    "headers": { "Authorization": new_api_key }
  }
}

clean_servers = []
for s in servers:
    if s["name"] not in new_servers_payload:
        s["headers"] = {} # send empty to keep old secrets via API
        s["env"] = {}
        clean_servers.append(s)

for name, info in new_servers_payload.items():
    clean_servers.append({
        "name": name,
        "transport": "streamable-http",
        "enabled": True,
        "url": info["url"],
        "headers": info["headers"],
        "description": "企查查 MCP Server",
        "server_type": "service",
        "tags": ["qcc"]
    })

post_payload = json.dumps({"servers": clean_servers}).encode('utf-8')
headers = {'Content-Type': 'application/json'}
post_req = urllib.request.Request("http://127.0.0.1:8080/mcp/config", data=post_payload, headers=headers, method="POST")

try:
    with urllib.request.urlopen(post_req) as response:
        print("Success:", response.read().decode())
except urllib.error.HTTPError as e:
    print("Error POSTing new config:", str(e), e.read().decode())
except Exception as e:
    print("Error POSTing new config:", str(e))

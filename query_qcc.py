import asyncio
import json
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def main():
    url = "https://agent.qcc.com/mcp/company/stream"
    headers = {"Authorization": "Bearer MDuVCZCSXes0t73Ylg8KL5ugVLYXlnbykJppKJeVyZDbWc0G"}

    print("Connecting to QCC Streamable HTTP MCP...")
    async with streamablehttp_client(url=url, headers=headers) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            print("Connected! Listing tools...\n")

            result = await session.list_tools()
            for t in result.tools:
                desc = t.description or ""
                print(f"- {t.name}: {desc[:80]}")
                if hasattr(t, 'inputSchema') and t.inputSchema:
                    props = t.inputSchema.get('properties', {})
                    required = t.inputSchema.get('required', [])
                    for pname, pinfo in props.items():
                        req_mark = " [必填]" if pname in required else ""
                        print(f"    param: {pname}{req_mark} - {pinfo.get('description', '')[:60]}")

            # Find a tool that looks like company search/detail
            tool_names = [t.name for t in result.tools]
            print(f"\nAll tool names: {tool_names}")

            # Try the first tool with the company name
            if tool_names:
                first_tool = result.tools[0]
                props = {}
                if hasattr(first_tool, 'inputSchema') and first_tool.inputSchema:
                    props = first_tool.inputSchema.get('properties', {})

                # Build arguments based on available params
                args = {}
                for pname in props:
                    lower = pname.lower()
                    if 'keyword' in lower or 'name' in lower or 'search' in lower or 'company' in lower:
                        args[pname] = "深圳市怡亚通供应链股份有限公司"
                        break

                if not args:
                    # Just try keyword
                    args = {"keyword": "深圳市怡亚通供应链股份有限公司"}

                print(f"\nCalling {first_tool.name} with args: {args}")
                try:
                    call_result = await session.call_tool(first_tool.name, args)
                    for c in call_result.content:
                        text = c.text if hasattr(c, 'text') else str(c)
                        print("\n=== Result ===")
                        # Try to parse as JSON for pretty printing
                        try:
                            parsed = json.loads(text)
                            print(json.dumps(parsed, ensure_ascii=False, indent=2))
                        except:
                            print(text)
                except Exception as e:
                    print(f"Error calling tool: {e}")

if __name__ == "__main__":
    asyncio.run(main())

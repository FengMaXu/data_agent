import asyncio
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    script_path = "d:/database_agent/mysql_mcp_server/server.py"
    server_params = StdioServerParameters(
        command="python",
        args=[script_path],
    )
    
    print("Starting stdio_client...")
    try:
        async with stdio_client(server_params) as (read_stream, write_stream):
            print("Client attached, initializing session...")
            async with ClientSession(read_stream, write_stream) as session:
                try:
                    await session.initialize()
                    print("Session initialized successfully!")
                    tools = await session.list_tools()
                    print("Tools:", tools)
                except Exception as e:
                    print(f"Exception during initialize: {type(e).__name__}: {e}")
    except Exception as e:
        print(f"Exception during connection: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(main())

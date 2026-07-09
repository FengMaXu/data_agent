# MCP Session Cache Dev Log

## 2026-04-27 - Invalidate Session Tools After MCP Reconnect

### Completed

Fixed a stale session tool cache issue where an existing chat session could keep calling the old database MCP server object after the user manually reconnected MCP.

Files changed:

1. `src/mcp/manager.py`
2. `src/api/agent.py`
3. `tests/test_mcp_manager_reconcile.py`
4. `tests/test_agent_runtime_signature.py`

### Decision

Include the MCP runtime fingerprint in the chat session tool-cache signature.

### Decision reasons

1. Existing session tools close over the managed MCP server object created at tool assembly time.
2. Manual reconnect replaces that server object, so cached tools can keep pointing at the stopped object.
3. A new chat window works only because it builds tools from scratch; existing sessions should get the same refresh automatically.
4. The smallest durable fix is to make MCP generation, ready state, and tool count part of the cache key.

### Verification

Commands run:

1. `python -m pytest tests\test_agent_runtime_signature.py tests\test_mcp_manager_reconcile.py`
2. `python -m py_compile src\api\agent.py src\mcp\manager.py`

Results:

1. Focused tests passed: 11 passed.
2. Python compile check passed.

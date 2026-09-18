# Tool Search Autoload Development Log

## 2026-05-18

### Goal

Fix two production issues in the deferred tool catalog:

- If the model calls a deferred tool that exists in the full catalog, load it automatically instead of returning an unknown-tool error.
- Keep tools loaded through `tool_search` visible across later prepares in the same session.

### Changes

- Added `ToolSearchCatalog.loaded_tool_names`, `load_tool_name(...)`, and an `on_loaded_change` callback.
- Added `SessionRuntime.loaded_tool_names` and wired `_prepare_session_runtime(...)` to seed new catalogs from the session-level loaded set.
- Added agent-loop autoload before tool execution so known deferred tools are promoted into the visible tool list and executed in the same batch.
- Added timing stage `tool_catalog_autoload` for observability.

### Verification

- `python -m py_compile src\agent\tool_search.py src\agent\agent_loop.py src\api\agent.py`
- `python -m pytest tests\test_tool_search.py tests\test_agent_loop_timing.py`

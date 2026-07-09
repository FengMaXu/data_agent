from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from src.ai.base_provider import ToolResultContent

from .types import AgentTimingRecorder, AgentTool, AgentToolResult

TOOL_SEARCH_TOOL_NAME = "tool_search"
TOOL_SEARCH_DEFAULT_MAX_RESULTS = 6
TOOL_SEARCH_MAX_RESULTS = 12

_CAMEL_BOUNDARY_RE = re.compile(r"([a-z0-9])([A-Z])")
_TERM_RE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+")
_CJK_RE = re.compile(r"^[\u4e00-\u9fff]+$")


@dataclass(frozen=True)
class _ToolSearchEntry:
    tool: AgentTool
    index: int
    text: str
    compact_text: str
    terms: set[str]
    name_terms: set[str]
    parameter_names: list[str]


@dataclass(frozen=True)
class _ScoredEntry:
    entry: _ToolSearchEntry
    score: float
    reason: str


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _split_camel(value: str) -> str:
    return _CAMEL_BOUNDARY_RE.sub(r"\1 \2", value)


def _normalize_text(value: str) -> str:
    value = _split_camel(value).lower()
    value = value.replace("_", " ").replace("-", " ").replace(".", " ")
    return re.sub(r"\s+", " ", value).strip()


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", _normalize_text(value))


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _cjk_ngrams(value: str) -> list[str]:
    terms = [value]
    if len(value) >= 2:
        terms.extend(value[i : i + 2] for i in range(len(value) - 1))
    if len(value) >= 4:
        terms.extend(value[i : i + 3] for i in range(len(value) - 2))
    return terms


def _extract_terms(value: str) -> set[str]:
    terms: list[str] = []
    for raw in _TERM_RE.findall(_split_camel(value)):
        token = raw.lower()
        if not token:
            continue
        if _CJK_RE.match(token):
            terms.extend(_cjk_ngrams(token))
        else:
            terms.append(token)
    return set(_unique(terms))


def _iter_schema_text(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key)
            yield from _iter_schema_text(child)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_schema_text(item)
    elif isinstance(value, (str, int, float, bool)):
        yield str(value)


def _parameter_names(parameters: dict[str, Any]) -> list[str]:
    properties = parameters.get("properties") if isinstance(parameters, dict) else None
    if not isinstance(properties, dict):
        return []
    return [str(name) for name in properties.keys()]


def _shorten(value: str, limit: int = 360) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "..."


def _coerce_max_results(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = TOOL_SEARCH_DEFAULT_MAX_RESULTS
    return max(1, min(parsed, TOOL_SEARCH_MAX_RESULTS))


def _coerce_queries(arguments: dict[str, Any]) -> list[str]:
    queries: list[str] = []
    raw_query = _safe_text(arguments.get("query")).strip()
    if raw_query:
        queries.append(raw_query)

    raw_queries = arguments.get("queries")
    if isinstance(raw_queries, list):
        for item in raw_queries:
            query = _safe_text(item).strip()
            if query:
                queries.append(query)

    return _unique(queries)


class ToolSearchCatalog:
    """Runtime catalog that exposes only selected tool schemas to the model."""

    def __init__(
        self,
        tools: Iterable[Any],
        *,
        initial_loaded_names: Iterable[str] | None = None,
        always_loaded_names: Iterable[str] | None = None,
        timing: AgentTimingRecorder | None = None,
        on_loaded_change: Callable[[set[str]], None] | None = None,
    ) -> None:
        self._timing = timing
        self._on_loaded_change = on_loaded_change
        self._tools_by_name: dict[str, AgentTool] = {}
        self._lower_name_index: dict[str, str] = {}
        for tool in tools:
            if not isinstance(tool, AgentTool):
                continue
            if tool.name == TOOL_SEARCH_TOOL_NAME:
                continue
            if tool.name in self._tools_by_name:
                continue
            self._tools_by_name[tool.name] = tool
            self._lower_name_index[tool.name.lower()] = tool.name

        self._entries = [
            self._build_entry(tool, index)
            for index, tool in enumerate(self._tools_by_name.values())
        ]
        valid_names = set(self._tools_by_name)
        self._always_loaded_names = set(always_loaded_names or []) & valid_names
        self._loaded_names = set(initial_loaded_names or []) & valid_names
        self._loaded_names.update(self._always_loaded_names)
        self._tool_search_tool = AgentTool(
            name=TOOL_SEARCH_TOOL_NAME,
            label="Tool Search",
            description=(
                "Searches the runtime tool catalog and loads matching tool schemas "
                "for the next model turn. Use this whenever the user request needs "
                "database access, SQL, charts, widgets, exports, files, skills, MCP "
                "tools, or any capability that is not currently visible. Use "
                "'select:<tool_name>' to load exact tool names. '+term' marks a "
                "required search term. Use queries:[...] to search several independent "
                "tool intents in one call."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Single search intent or exact selection. Examples: "
                            "'sales sql chart', '+SQL export', "
                            "'select:execute_sql,show_widget'."
                        ),
                    },
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Several independent searches to run in the same tool call. "
                            "Each item can be an intent query or select:<tool_name,...>."
                        ),
                    },
                    "max_results": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": TOOL_SEARCH_MAX_RESULTS,
                        "description": (
                            "Maximum ranked keyword matches to load per query. "
                            "Exact select:<tool_name,...> selections are loaded as listed, "
                            f"up to the hard cap of {TOOL_SEARCH_MAX_RESULTS} tools."
                        ),
                    },
                },
            },
            execute_fn=self.execute,
            read_only=False,
            resource="tool_catalog",
            max_concurrency=1,
        )
        self._notify_loaded_change()

    @property
    def total_tool_count(self) -> int:
        return len(self._tools_by_name)

    @property
    def loaded_tool_count(self) -> int:
        return len(self._loaded_names)

    @property
    def loaded_tool_names(self) -> set[str]:
        return set(self._loaded_names)

    @property
    def deferred_tool_count(self) -> int:
        return max(0, self.total_tool_count - self.loaded_tool_count)

    def visible_tools(self) -> list[AgentTool]:
        tools = [self._tool_search_tool]
        for name, tool in self._tools_by_name.items():
            if name in self._loaded_names:
                tools.append(tool)
        return tools

    def known_tools(self) -> list[AgentTool]:
        return [self._tool_search_tool, *self._tools_by_name.values()]

    def load_tool_name(self, name: str) -> AgentTool | None:
        canonical_name = self._lower_name_index.get(name.lower())
        if canonical_name is None:
            return None
        self._loaded_names.add(canonical_name)
        self._notify_loaded_change()
        return self._tools_by_name[canonical_name]

    def _notify_loaded_change(self) -> None:
        if self._on_loaded_change is None:
            return
        self._on_loaded_change(set(self._loaded_names))

    async def execute(
        self,
        tool_call_id: str,
        arguments: dict[str, Any],
    ) -> AgentToolResult:
        arguments = arguments or {}
        queries = _coerce_queries(arguments)
        max_results = _coerce_max_results(arguments.get("max_results"))
        if not queries:
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        type="text",
                        text="tool_search requires a non-empty query or queries.",
                    )
                ],
                details={"error": "empty_query"},
                is_error=True,
            )

        before_loaded = set(self._loaded_names)
        matched_by_query: list[tuple[str, _ScoredEntry]] = []
        unmatched_by_query: dict[str, list[str]] = {}
        omitted_by_query: dict[str, list[str]] = {}
        seen_matched_names: set[str] = set()
        for query in queries:
            matches, unmatched_names, omitted_names = self._search(
                query,
                max_results=max_results,
            )
            if unmatched_names:
                unmatched_by_query[query] = unmatched_names
            if omitted_names:
                omitted_by_query[query] = omitted_names
            for match in matches:
                tool_name = match.entry.tool.name
                if tool_name in seen_matched_names:
                    continue
                seen_matched_names.add(tool_name)
                matched_by_query.append((query, match))

        for _query, match in matched_by_query:
            self._loaded_names.add(match.entry.tool.name)
        self._notify_loaded_change()
        newly_loaded = [
            match.entry.tool.name
            for _query, match in matched_by_query
            if match.entry.tool.name not in before_loaded
        ]
        unmatched_names = _unique(
            name for names in unmatched_by_query.values() for name in names
        )
        omitted_names = _unique(
            name for names in omitted_by_query.values() for name in names
        )
        payload = {
            "query": queries[0],
            "queries": queries,
            "matched_tools": [
                self._serialize_match(match, before_loaded, matched_query=query)
                for query, match in matched_by_query
            ],
            "newly_loaded_tools": newly_loaded,
            "loaded_tool_count": self.loaded_tool_count,
            "deferred_tool_count": self.deferred_tool_count,
            "total_tool_count": self.total_tool_count,
            "unmatched_names": unmatched_names,
            "unmatched_by_query": unmatched_by_query,
            "omitted_names": omitted_names,
            "omitted_by_query": omitted_by_query,
            "next_step": (
                "Matched tools are loaded for the next model turn. "
                "Call the loaded tools directly if they are relevant. "
                "Use queries:[...] or select:<tool_name,...> to load multiple tools "
                "in a single future call."
                if matched_by_query
                else "No tool matched. Try broader intent keywords or select:<tool_name>."
            ),
        }
        if self._timing is not None:
            self._timing.record_tool_stage(
                "tool_search_match",
                tool_name=TOOL_SEARCH_TOOL_NAME,
                tool_call_id=tool_call_id,
                query_count=len(queries),
                match_count=len(matched_by_query),
                newly_loaded_count=len(newly_loaded),
                loaded_tool_count=self.loaded_tool_count,
                deferred_tool_count=self.deferred_tool_count,
                omitted_count=len(omitted_names),
                matched_names=",".join(
                    match.entry.tool.name for _query, match in matched_by_query
                ),
            )
        return AgentToolResult(
            content=[
                ToolResultContent(
                    type="text",
                    text=json.dumps(payload, ensure_ascii=False, indent=2),
                )
            ],
            details={
                "queries": queries,
                "matches": [match.entry.tool.name for _query, match in matched_by_query],
                "newly_loaded_tools": newly_loaded,
                "loaded_tool_count": self.loaded_tool_count,
                "deferred_tool_count": self.deferred_tool_count,
                "unmatched_names": unmatched_names,
                "unmatched_by_query": unmatched_by_query,
                "omitted_names": omitted_names,
                "omitted_by_query": omitted_by_query,
            },
        )

    def _build_entry(self, tool: AgentTool, index: int) -> _ToolSearchEntry:
        schema_text = " ".join(_iter_schema_text(tool.parameters))
        text_parts = [
            tool.name,
            tool.label,
            tool.description,
            schema_text,
        ]
        text = _normalize_text(" ".join(_safe_text(part) for part in text_parts))
        return _ToolSearchEntry(
            tool=tool,
            index=index,
            text=text,
            compact_text=_compact(text),
            terms=_extract_terms(text),
            name_terms=_extract_terms(tool.name),
            parameter_names=_parameter_names(tool.parameters),
        )

    def _search(
        self,
        query: str,
        *,
        max_results: int,
    ) -> tuple[list[_ScoredEntry], list[str], list[str]]:
        selected_names = self._parse_select_query(query)
        if selected_names is not None:
            matches: list[_ScoredEntry] = []
            unmatched: list[str] = []
            omitted: list[str] = []
            entry_by_name = {entry.tool.name: entry for entry in self._entries}
            for raw_name in selected_names:
                canonical_name = self._canonical_tool_name(raw_name)
                if canonical_name is None:
                    unmatched.append(raw_name)
                    continue
                entry = entry_by_name[canonical_name]
                matches.append(_ScoredEntry(entry=entry, score=1000.0, reason="select"))
            if len(matches) > TOOL_SEARCH_MAX_RESULTS:
                omitted = [match.entry.tool.name for match in matches[TOOL_SEARCH_MAX_RESULTS:]]
                matches = matches[:TOOL_SEARCH_MAX_RESULTS]
            return matches, unmatched, omitted

        query_text, required_terms = self._parse_keyword_query(query)
        query_terms = _extract_terms(query_text or query)
        query_compact = _compact(query_text or query)
        scored: list[_ScoredEntry] = []
        for entry in self._entries:
            if required_terms and not self._entry_matches_all(entry, required_terms):
                continue
            score, reason = self._score_entry(entry, query_terms, query_compact)
            if score > 0:
                scored.append(_ScoredEntry(entry=entry, score=score, reason=reason))
        scored.sort(key=lambda item: (-item.score, item.entry.index))
        return scored[:max_results], [], []

    def _parse_select_query(self, query: str) -> list[str] | None:
        stripped = query.strip()
        if not stripped.lower().startswith("select:"):
            return None
        body = stripped.split(":", 1)[1]
        return [name for name in re.split(r"[\s,;]+", body) if name]

    def _parse_keyword_query(self, query: str) -> tuple[str, set[str]]:
        required_parts: list[str] = []
        optional_parts: list[str] = []
        for part in query.split():
            if part.startswith("+") and len(part) > 1:
                required_parts.append(part[1:])
            else:
                optional_parts.append(part)
        return " ".join(optional_parts), _extract_terms(" ".join(required_parts))

    def _canonical_tool_name(self, raw_name: str) -> str | None:
        if raw_name in self._tools_by_name:
            return raw_name
        return self._lower_name_index.get(raw_name.lower())

    def _entry_matches_all(self, entry: _ToolSearchEntry, required_terms: set[str]) -> bool:
        return all(term in entry.terms or term in entry.compact_text for term in required_terms)

    def _score_entry(
        self,
        entry: _ToolSearchEntry,
        query_terms: set[str],
        query_compact: str,
    ) -> tuple[float, str]:
        tool = entry.tool
        score = 0.0
        reasons: list[str] = []
        name_compact = _compact(tool.name)
        label_compact = _compact(tool.label)

        if query_compact and query_compact == name_compact:
            score += 200
            reasons.append("exact_name")
        elif query_compact and query_compact in name_compact:
            score += 90
            reasons.append("name_substring")
        elif query_compact and query_compact in label_compact:
            score += 50
            reasons.append("label_substring")
        elif query_compact and query_compact in entry.compact_text:
            score += 30
            reasons.append("text_substring")

        for term in query_terms:
            if term in entry.name_terms:
                score += 28
                reasons.append("name_term")
            elif term in entry.terms:
                score += 8
                reasons.append("catalog_term")
            elif term in entry.compact_text:
                score += 4
                reasons.append("catalog_substring")

        return score, ",".join(_unique(reasons)) or "keyword"

    def _serialize_match(
        self,
        match: _ScoredEntry,
        previously_loaded: set[str],
        *,
        matched_query: str | None = None,
    ) -> dict[str, Any]:
        tool = match.entry.tool
        return {
            "name": tool.name,
            "label": tool.label,
            "description": _shorten(tool.description),
            "parameter_names": match.entry.parameter_names,
            "score": round(match.score, 3),
            "reason": match.reason,
            "matched_query": matched_query,
            "already_loaded": tool.name in previously_loaded,
        }

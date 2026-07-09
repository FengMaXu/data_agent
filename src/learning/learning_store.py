"""
4.1 错题本存储 (Learning Store)

实现 Diagnose → Fix → Save Learning 闭环：
1. SQL 执行失败或用户反馈错误时，自动保存"错误 SQL + 报错原因 + 修正后的 SQL"
2. 下次生成 SQL 前，自动检索相关的历史教训
3. 越用越聪明，同类错误不再重犯

存储方式：JSON 文件（轻量级，无需额外数据库依赖）
检索方式：关键词匹配（表名 + 错误类型）
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.learning.store")


@dataclass
class LearningEntry:
    """一条学习记录（错题本条目）"""

    id: str = ""
    timestamp: float = 0.0
    # 错误信息
    failed_sql: str = ""
    error_message: str = ""
    error_type: str = ""  # syntax / type_mismatch / table_not_found / logic / other
    # 修正信息
    fixed_sql: str = ""
    fix_explanation: str = ""
    # 元数据
    tables_involved: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    source: str = ""  # auto_sandbox / user_feedback / manual


class LearningStore:
    """
    错题本存储

    存储结构：
      learnings/
        data.json          ← 所有学习记录（JSON格式，供程序检索）
      context/doc/
        learning.md        ← 学习记录（Markdown格式，供grep工具检索）

    使用流程：
      1. SQL 沙盒验证失败 → 自动调用 save()
      2. 用户标记"这个查询不对" → 手动调用 save()
      3. LLM 生成 SQL 前 → 调用 search() 检索相关教训
    """

    def __init__(self, storage_dir: str | Path | None = None):
        if storage_dir:
            self._storage_dir = Path(storage_dir)
        else:
            project_root = Path(__file__).resolve().parent.parent.parent
            self._storage_dir = project_root / "learnings"

        self._data_file = self._storage_dir / "data.json"
        # context/doc/learning.md 用于 grep 工具检索
        project_root = Path(__file__).resolve().parent.parent.parent
        self._learning_md_file = project_root / "context" / "doc" / "learning.md"
        self._entries: list[LearningEntry] = []
        self._loaded = False

    def _ensure_loaded(self) -> None:
        """确保数据已加载"""
        if self._loaded:
            return
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        if self._data_file.exists():
            try:
                with open(self._data_file, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                self._entries = [self._dict_to_entry(d) for d in raw]
                logger.info(f"[Learning] 加载 {len(self._entries)} 条学习记录")
            except Exception as e:
                logger.error(f"[Learning] 加载失败: {e}")
                self._entries = []
        self._loaded = True

    def _dict_to_entry(self, d: dict) -> LearningEntry:
        return LearningEntry(
            id=d.get("id", ""),
            timestamp=d.get("timestamp", 0),
            failed_sql=d.get("failed_sql", ""),
            error_message=d.get("error_message", ""),
            error_type=d.get("error_type", "other"),
            fixed_sql=d.get("fixed_sql", ""),
            fix_explanation=d.get("fix_explanation", ""),
            tables_involved=d.get("tables_involved", []),
            keywords=d.get("keywords", []),
            source=d.get("source", ""),
        )

    def _save_to_disk(self) -> None:
        """持久化到磁盘"""
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        data = [asdict(e) for e in self._entries]
        with open(self._data_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        # 同时追加到 context/doc/learning.md
        self._append_to_learning_md()

    def _append_to_learning_md(self) -> None:
        """追加最后一条学习记录到 learning.md"""
        if not self._entries:
            return

        # 确保目录存在
        self._learning_md_file.parent.mkdir(parents=True, exist_ok=True)

        # 获取最后一条记录
        entry = self._entries[-1]

        # 格式化为 Markdown
        timestamp_str = datetime.fromtimestamp(entry.timestamp).strftime("%Y-%m-%d %H:%M:%S")
        md_content = f"""

### 错误: {entry.error_type or '未知错误'}
**时间**: {timestamp_str}
**来源**: {entry.source or 'agent'}

**失败SQL**:
```sql
{entry.failed_sql}
```

**错误信息**: {entry.error_message}

**修正SQL**:
```sql
{entry.fixed_sql}
```

**说明**: {entry.fix_explanation}

---
"""

        # 追加到文件
        try:
            with open(self._learning_md_file, "a", encoding="utf-8") as f:
                f.write(md_content)
            logger.info(f"[Learning] 已追加到 learning.md: {entry.id}")
        except Exception as e:
            logger.error(f"[Learning] 追加到 learning.md 失败: {e}")

    def save(self, entry: LearningEntry) -> str:
        """
        保存一条学习记录

        Returns:
            记录 ID
        """
        self._ensure_loaded()

        if not entry.id:
            entry.id = f"learn_{int(time.time() * 1000)}"
        if not entry.timestamp:
            entry.timestamp = time.time()

        # 自动提取涉及的表名
        if not entry.tables_involved and entry.failed_sql:
            entry.tables_involved = self._extract_tables(entry.failed_sql)

        # 自动提取关键词
        if not entry.keywords:
            entry.keywords = self._extract_keywords(entry)

        self._entries.append(entry)
        self._save_to_disk()

        logger.info(
            f"[Learning] 保存记录 {entry.id}: "
            f"type={entry.error_type}, tables={entry.tables_involved}"
        )
        return entry.id

    def search(
        self, query: str = "", tables: list[str] | None = None
    ) -> list[LearningEntry]:
        """
        检索相关的学习记录

        Args:
            query: 搜索关键词（表名、错误类型等）
            tables: 涉及的表名列表

        Returns:
            匹配的学习记录（按相关度排序，最多10条）
        """
        self._ensure_loaded()

        if not self._entries:
            return []

        query_lower = query.lower()
        query_tokens = set(re.split(r"[\s,，。_\-/]+", query_lower))
        query_tokens = {t for t in query_tokens if len(t) >= 2}

        table_set = set(t.lower() for t in (tables or []))

        scored: list[tuple[float, LearningEntry]] = []

        for entry in self._entries:
            score = 0.0

            # 表名匹配（高权重）
            entry_tables = set(t.lower() for t in entry.tables_involved)
            if table_set and entry_tables & table_set:
                score += 3.0 * len(entry_tables & table_set)

            # 关键词匹配
            entry_keywords = set(k.lower() for k in entry.keywords)
            if query_tokens and entry_keywords & query_tokens:
                score += 2.0 * len(entry_keywords & query_tokens)

            # 全文匹配
            searchable = f"{entry.failed_sql} {entry.error_message} {entry.fix_explanation}".lower()
            for token in query_tokens:
                if token in searchable:
                    score += 1.0

            # 表名在 query 中出现
            for t in entry.tables_involved:
                if t.lower() in query_lower:
                    score += 2.0

            if score > 0:
                scored.append((score, entry))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [e for _, e in scored[:10]]

    def format_learnings(self, entries: list[LearningEntry]) -> str:
        """格式化学习记录为 LLM 可读的文本"""
        if not entries:
            return ""

        lines = ["# ⚠️ 历史教训（请务必避免重复犯错！）\n"]

        for i, e in enumerate(entries, 1):
            lines.append(f"## 教训 {i}: {e.error_type}")

            if e.failed_sql:
                lines.append(f"**错误 SQL**:")
                lines.append(f"```sql\n{e.failed_sql}\n```")

            if e.error_message:
                lines.append(f"**报错**: {e.error_message}")

            if e.fixed_sql:
                lines.append(f"**正确 SQL**:")
                lines.append(f"```sql\n{e.fixed_sql}\n```")

            if e.fix_explanation:
                lines.append(f"**教训**: {e.fix_explanation}")

            lines.append("")

        return "\n".join(lines)

    def get_stats(self) -> dict[str, Any]:
        """获取学习统计"""
        self._ensure_loaded()
        error_types: dict[str, int] = {}
        for e in self._entries:
            error_types[e.error_type] = error_types.get(e.error_type, 0) + 1
        return {
            "total": len(self._entries),
            "by_type": error_types,
        }

    def _extract_tables(self, sql: str) -> list[str]:
        """从 SQL 中提取表名"""
        patterns = [
            r"\bFROM\s+(\w+)",
            r"\bJOIN\s+(\w+)",
            r"\bINTO\s+(\w+)",
            r"\bUPDATE\s+(\w+)",
            r"\bTABLE\s+(\w+)",
        ]
        tables = set()
        for p in patterns:
            for match in re.finditer(p, sql, re.IGNORECASE):
                name = match.group(1).lower()
                if name not in ("select", "set", "values", "where", "and", "or"):
                    tables.add(name)
        return sorted(tables)

    def _extract_keywords(self, entry: LearningEntry) -> list[str]:
        """自动提取关键词"""
        keywords = set()
        keywords.update(entry.tables_involved)
        if entry.error_type:
            keywords.add(entry.error_type)

        # 从错误消息提取关键信息
        error_lower = entry.error_message.lower()
        if "column" in error_lower or "列" in error_lower:
            keywords.add("column")
        if "type" in error_lower or "类型" in error_lower:
            keywords.add("type_mismatch")
        if "syntax" in error_lower or "语法" in error_lower:
            keywords.add("syntax")
        if "exist" in error_lower or "不存在" in error_lower:
            keywords.add("not_found")
        if "null" in error_lower:
            keywords.add("null")
        if "ambiguous" in error_lower or "歧义" in error_lower:
            keywords.add("ambiguous")

        return sorted(keywords)

    def create_tools(self) -> list[AgentTool]:
        """创建学习相关的 Agent 工具"""
        store = self

        async def search_past_learnings(
            tool_call_id: str, arguments: dict[str, Any]
        ) -> AgentToolResult:
            """搜索历史教训"""
            query = arguments.get("query", "")
            tables = arguments.get("tables", [])

            def _run_search() -> str:
                store._ensure_loaded()
                entries = store.search(query, tables if tables else None)
                if entries:
                    return store.format_learnings(entries)
                return "✅ 未找到相关历史教训。可以放心编写 SQL。"

            text = await asyncio.to_thread(_run_search)
            return AgentToolResult(content=[ToolResultContent(text=text)])

        async def save_learning(
            tool_call_id: str, arguments: dict[str, Any]
        ) -> AgentToolResult:
            """保存一条新的学习记录"""
            entry = LearningEntry(
                failed_sql=arguments.get("failed_sql", ""),
                error_message=arguments.get("error_message", ""),
                error_type=arguments.get("error_type", "other"),
                fixed_sql=arguments.get("fixed_sql", ""),
                fix_explanation=arguments.get("fix_explanation", ""),
                source="agent",
            )
            record_id = store.save(entry)
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        text=f"✅ 已保存学习记录 ({record_id})。下次遇到类似问题会自动召回此教训。"
                    )
                ],
            )

        return [
            AgentTool(
                name="search_past_learnings",
                description=(
                    "搜索历史错题本，查找之前犯过的 SQL 错误和修正经验。\n"
                    "在编写涉及特定表的 SQL 前，应先搜索该表相关的历史教训。\n"
                    "可按关键词或表名搜索。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "搜索关键词（表名、错误类型等）",
                        },
                        "tables": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "涉及的表名列表",
                        },
                    },
                    "required": [],
                },
                execute_fn=search_past_learnings,
                label="搜索历史教训",
                read_only=True,
                resource="learning",
                max_concurrency=4,
            ),
            AgentTool(
                name="save_learning",
                description=(
                    "保存一条学习记录到错题本。\n"
                    "当你修正了一个 SQL 错误后，应调用此工具保存经验，\n"
                    "这样下次遇到类似问题就能自动避免。"
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "failed_sql": {
                            "type": "string",
                            "description": "失败的 SQL 语句",
                        },
                        "error_message": {
                            "type": "string",
                            "description": "错误信息",
                        },
                        "error_type": {
                            "type": "string",
                            "enum": [
                                "syntax",
                                "type_mismatch",
                                "table_not_found",
                                "logic",
                                "other",
                            ],
                            "description": "错误类型",
                        },
                        "fixed_sql": {
                            "type": "string",
                            "description": "修正后的正确 SQL",
                        },
                        "fix_explanation": {
                            "type": "string",
                            "description": "修正说明（教训总结）",
                        },
                    },
                    "required": ["failed_sql", "error_message", "fixed_sql"],
                },
                execute_fn=save_learning,
                label="保存学习记录",
                read_only=False,
                resource="learning",
                max_concurrency=1,
            ),
        ]

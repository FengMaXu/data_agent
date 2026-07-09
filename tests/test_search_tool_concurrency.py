import asyncio
import threading

from src.context import knowledge_tools


def test_search_knowledge_runs_blocking_scan_concurrently(monkeypatch, tmp_path):
    knowledge_root = tmp_path / "knowledge"
    doc_root = knowledge_root / "doc"
    doc_root.mkdir(parents=True)
    (doc_root / "rules.md").write_text("# Rules\nsales amount\n", encoding="utf-8")

    barrier = threading.Barrier(2)

    def blocking_scan(*_args, **_kwargs):
        barrier.wait(timeout=1.0)
        return []

    monkeypatch.setattr(knowledge_tools, "KNOWLEDGE_ROOT", knowledge_root)
    monkeypatch.setattr(knowledge_tools, "_search_hits_by_keywords", blocking_scan)

    async def run_two_searches():
        return await asyncio.gather(
            knowledge_tools._search_knowledge("call-1", {"query": "sales"}),
            knowledge_tools._search_knowledge("call-2", {"query": "amount"}),
        )

    results = asyncio.run(run_two_searches())

    assert len(results) == 2
    assert all(result.is_error is False for result in results)

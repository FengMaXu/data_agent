from src.api.agent import _runtime_signature


def test_runtime_signature_distinguishes_missing_and_empty_mcp_selection():
    missing = _runtime_signature(None, None)
    empty = _runtime_signature(None, [])

    assert missing != empty


def test_runtime_signature_changes_with_mcp_runtime_generation():
    before = _runtime_signature(
        None,
        ["database"],
        mcp_runtime=[{"name": "database", "generation": 1}],
    )
    after = _runtime_signature(
        None,
        ["database"],
        mcp_runtime=[{"name": "database", "generation": 2}],
    )

    assert before != after

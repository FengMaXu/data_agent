import unittest

from src.agent.tool_providers.show_widget import _normalize_widget_spec


class ShowWidgetGuardTests(unittest.TestCase):
    def test_rich_text_is_limited_to_an_inline_summary(self):
        spec = _normalize_widget_spec(
            "tool-call",
            {
                "kind": "rich_text",
                "title": "Report summary",
                "data": [f"section {index}" for index in range(20)],
            },
        )

        self.assertLessEqual(len(spec["data"]), 7)
        self.assertTrue(spec["metadata"]["truncated"])
        self.assertEqual(spec["data"][-1]["type"], "notice")

    def test_short_rich_text_is_preserved(self):
        data = ["headline", {"type": "table", "headers": ["A"], "rows": [[1]]}]
        spec = _normalize_widget_spec(
            "tool-call",
            {"kind": "rich_text", "title": "Summary", "data": data},
        )

        self.assertEqual(spec["data"], data)
        self.assertNotIn("truncated", spec["metadata"])


if __name__ == "__main__":
    unittest.main()
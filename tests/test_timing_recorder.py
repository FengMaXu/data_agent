import logging

from src.agent.types import AgentTimingRecorder


def test_timing_summary_includes_phase_metrics(caplog):
    recorder = AgentTimingRecorder(req="run_test", session="session_test")

    with caplog.at_level(logging.INFO):
        recorder.mark_once("request_start")
        recorder.mark_once("attachments_read_done")
        recorder.mark_once("session_tools_start")
        recorder.mark_once("session_tools_ready")
        recorder.mark_once("agent_run_start")
        recorder.mark_once("first_sse")
        recorder.mark_once("first_text")
        recorder.mark_once("first_tool_call")
        recorder.add_counter("turns", 2)
        recorder.add_counter("llm_calls", 3)
        recorder.add_counter("tool_calls", 2)
        recorder.record_tool_stage("tool_done", tool_name="foo", tool_call_id="call_1", duration_ms=12.5)
        recorder.record_tool_stage("tool_done", tool_name="bar", tool_call_id="call_2", duration_ms=7.25)
        recorder.mark_once("agent_done")
        summary = recorder.log_summary(status="completed")

    assert summary["req"] == "run_test"
    assert summary["session"] == "session_test"
    assert summary["status"] == "completed"
    assert summary["turns"] == 2
    assert summary["llm_calls"] == 3
    assert summary["tool_calls"] == 2
    assert summary["tool_ms_total"] == 19.75
    assert summary["tool_ms_max"] == 12.5
    assert summary["attachments_ms"] is not None
    assert summary["session_tools_ms"] is not None
    assert summary["agent_runtime_ms"] is not None
    assert any("[Timing][Chat]" in record.message for record in caplog.records)

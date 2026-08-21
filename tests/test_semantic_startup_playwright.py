from __future__ import annotations

import json
import re
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from playwright.sync_api import Page, expect, sync_playwright


pytestmark = pytest.mark.playwright


class StartupApi:
    def __init__(self, snapshots: list[dict[str, Any]], *, first_snapshot_calls: int = 20) -> None:
        self.snapshots = snapshots
        self.index = 0
        self.first_snapshot_calls = first_snapshot_calls
        self.status_calls = 0
        self.retry_count = 0
        self.lock = threading.Lock()

    def status(self) -> dict[str, Any]:
        with self.lock:
            if self.index == 0:
                self.status_calls += 1
                if self.status_calls > self.first_snapshot_calls:
                    self.index = 1
            return self.snapshots[min(self.index, len(self.snapshots) - 1)]

    def retry(self) -> dict[str, Any]:
        with self.lock:
            self.retry_count += 1
            self.index = min(1, len(self.snapshots) - 1)
            return self.snapshots[self.index]


class ApiHandler(BaseHTTPRequestHandler):
    api: StartupApi

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/auth/status":
            self._json({"authenticated": True, "registration_open": False, "user": {"id": "u1", "username": "tester", "display_name": "Tester"}})
            return
        if self.path == "/settings/config":
            self._json({"default_model": "test", "openai_api_key": "configured"})
            return
        if self.path == "/startup/status":
            self._json(self.api.status())
            return
        if self.path == "/tasks":
            self._json({"tasks": []})
            return
        self._json({})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/startup/semantic-ingest/retry":
            self._json(self.api.retry())
            return
        self._json({})

    def _json(self, value: Any) -> None:
        body = json.dumps(value).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: Any) -> None:
        return


class ApiServer:
    def __init__(self, snapshots: list[dict[str, Any]], *, first_snapshot_calls: int = 20) -> None:
        self.api = StartupApi(snapshots, first_snapshot_calls=first_snapshot_calls)
        handler = type("BoundApiHandler", (ApiHandler,), {"api": self.api})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self) -> "ApiServer":
        self.thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def status(phase: str, *, catalog_ready: bool = False, failed: int = 0, failed_connections: list[str] | None = None) -> dict[str, Any]:
    api_phase = {
        "ingesting": "ingesting",
        "refreshing": "refreshing",
        "ready": "ready",
        "failed": "failed",
        "degraded": "degraded",
        "skipped": "skipped",
        "checking": "checking",
    }[phase]
    return {
        "status": api_phase,
        "jobId": "job-1" if phase not in {"checking", "ready", "skipped"} else None,
        "currentConnectionId": "warehouse" if phase in {"ingesting", "refreshing"} else None,
        "completedConnections": 1 if phase in {"ready", "degraded"} else 0,
        "totalConnections": 1,
        "summary": {"updated": 1 if phase in {"ready", "degraded"} else 0, "unchanged": 0, "failed": failed, "skipped": 0},
        "failedConnections": failed_connections or [],
        "errorCode": None if phase not in {"failed", "degraded"} else "semantic_catalog_not_ready",
        "updatedAt": "2026-08-12T00:00:00Z",
        "catalogReady": catalog_ready,
    }


def start_frontend_server() -> Any:
    import subprocess

    root = Path(__file__).parents[1] / "frontend"
    node = shutil.which("node.exe") or shutil.which("node")
    vite = root / "node_modules" / "vite" / "bin" / "vite.js"
    if not node or not vite.is_file():
        pytest.skip("Vite and Node are not available")
    return subprocess.Popen(
        [node, str(vite), "--host", "127.0.0.1", "--port", "0", "--clearScreen", "false"],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def wait_for_frontend(process: Any) -> str:
    import time

    assert process.stdout is not None
    deadline = time.time() + 30
    output = ""
    ansi_escape = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
    while time.time() < deadline:
        line = process.stdout.readline()
        if line:
            output += line
            clean_line = ansi_escape.sub("", line)
            match = re.search(r"http://127\.0\.0\.1:(\d+)/", clean_line)
            if match:
                return f"http://127.0.0.1:{match.group(1)}"
        elif process.poll() is not None:
            break
    raise RuntimeError(f"frontend did not start: {output}")


def open_app(page: Page, frontend_url: str, api_url: str) -> None:
    api_port = int(api_url.rsplit(':', 1)[1])
    page.route(f"{api_url}/**", lambda route: route.continue_())
    page.add_init_script(
        f"window.__PORT__ = {api_port}; window.dataAgent = {{ backendPort: {api_port} }}; window.localStorage.setItem('data-agent:auth-token', 'test-token');"
    )
    page.goto(f"{frontend_url}/app", wait_until="commit", timeout=60_000)
    page.wait_for_function('() => document.querySelector("#root")?.innerHTML.length > 0', timeout=120_000)
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass
    page.wait_for_timeout(150)


def run_state_flow(snapshots: list[dict[str, Any]], assertions: list[tuple[str, str]]) -> None:
    frontend = start_frontend_server()
    try:
        frontend_url = wait_for_frontend(frontend)
        with ApiServer(snapshots) as api, sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.on("pageerror", lambda error: pytest.fail(f"browser page error: {error}"))
            open_app(page, frontend_url, api.url)
            page.wait_for_timeout(5_000)
            for selector, text in assertions:
                expect(page.locator(selector)).to_contain_text(text, timeout=15_000)
            browser.close()
    finally:
        frontend.terminate()
        frontend.wait(timeout=10)


def test_initial_ingest_success_unlocks_chat() -> None:
    run_state_flow(
        [status("ingesting"), status("ready", catalog_ready=True)],
        [(".semantic-startup-strip", "正在同步语义上下文")],
    )


def test_failed_ingest_retry_and_degraded_last_known_good() -> None:
    frontend = start_frontend_server()
    try:
        frontend_url = wait_for_frontend(frontend)
        snapshots = [status("failed", failed=1, failed_connections=["warehouse"]), status("degraded", catalog_ready=True, failed=1, failed_connections=["warehouse"])]
        with ApiServer(snapshots, first_snapshot_calls=100) as api, sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            open_app(page, frontend_url, api.url)
            page.wait_for_timeout(5_000)
            expect(page.locator(".semantic-startup-strip")).to_contain_text("语义上下文不可用")
            expect(page.locator(".semantic-startup-retry")).to_be_enabled()
            page.locator(".semantic-startup-retry").click()
            expect(page.locator(".semantic-startup-strip")).to_contain_text("语义上下文部分可用")
            expect(page.locator(".semantic-startup-failures")).to_contain_text("warehouse")
            assert api.api.retry_count == 1
            browser.close()
    finally:
        frontend.terminate()
        frontend.wait(timeout=10)


def test_refreshing_keeps_chat_available_and_skipped_is_explained() -> None:
    frontend = start_frontend_server()
    try:
        frontend_url = wait_for_frontend(frontend)
        with ApiServer([status("refreshing", catalog_ready=True), status("skipped")], first_snapshot_calls=100) as api, sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 390, "height": 844})
            open_app(page, frontend_url, api.url)
            page.wait_for_timeout(5_000)
            expect(page.locator(".semantic-startup-strip")).to_contain_text("正在更新语义上下文")
            expect(page.locator(".chat-area")).to_be_visible()
            page.wait_for_timeout(2_500)
            api.api.index = 1
            page.wait_for_timeout(1_200)
            expect(page.locator(".semantic-startup-strip")).to_contain_text("语义上下文尚未配置")
            assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
            browser.close()
    finally:
        frontend.terminate()
        frontend.wait(timeout=10)
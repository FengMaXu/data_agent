from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

BASE_URL = "http://127.0.0.1:5174"
ARTIFACT_DIR = Path("D:/data_agent/workspace/test_mcp_settings_ui")
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOT_PATH = ARTIFACT_DIR / "mcp-settings-page.png"
RESULT_PATH = ARTIFACT_DIR / "mcp-settings-result.json"
CHROME_EXECUTABLE = "C:/Program Files/Google/Chrome/Application/chrome.exe"


def main() -> None:
    result: dict[str, object] = {
        "page_loaded": False,
        "settings_opened": False,
        "mcp_nav_opened": False,
        "installed_loaded": False,
        "refresh_worked": False,
        "settings_loaded": False,
        "test_button_worked": False,
        "save_button_worked": False,
        "server_name": None,
        "test_result": None,
        "save_dialog": None,
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME_EXECUTABLE)
        page = browser.new_page(viewport={"width": 1440, "height": 1100})

        try:
            page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_load_state("networkidle")
            result["page_loaded"] = True

            settings_button = page.get_by_role("button", name="Settings 设置")
            expect(settings_button).to_be_visible(timeout=10000)
            settings_button.click()
            expect(page.get_by_role("heading", name="工作区")).to_be_visible(timeout=10000)
            result["settings_opened"] = True

            mcp_button = page.get_by_role("button", name="MCP")
            expect(mcp_button).to_be_visible(timeout=10000)
            mcp_button.click()
            expect(page.get_by_text("管理 MCP Server 配置、连接状态与桥接工具。")).to_be_visible(timeout=10000)
            result["mcp_nav_opened"] = True

            mcp_root = page.locator("div", has_text="管理 MCP Server 配置、连接状态与桥接工具。")

            installed_tab = page.get_by_role("button", name="已安装", exact=True)
            installed_tab.click()
            server_title = page.get_by_text("database", exact=True).first
            expect(server_title).to_be_visible(timeout=15000)
            result["installed_loaded"] = True
            result["server_name"] = server_title.text_content()

            with page.expect_response(lambda resp: resp.url.endswith("/mcp/config") and resp.request.method == "GET", timeout=15000):
                page.get_by_role("button", name="刷新").click()
            result["refresh_worked"] = True

            settings_tab = mcp_root.get_by_role("button", name="设置", exact=True)
            settings_tab.click()
            expect(page.get_by_text("MCP Server 设置")).to_be_visible(timeout=10000)

            name_input = page.locator('input[placeholder="database"]').first
            expect(name_input).to_have_value("database", timeout=10000)
            result["settings_loaded"] = True

            test_button = page.get_by_role("button", name="测试 MCP")
            test_button.click()
            success_alert = page.get_by_text("✓ 测试成功")
            failure_alert = page.get_by_text("✗ 测试失败")
            try:
                expect(success_alert).to_be_visible(timeout=30000)
                result["test_result"] = "success"
            except Exception:
                expect(failure_alert).to_be_visible(timeout=5000)
                result["test_result"] = "failure"
            result["test_button_worked"] = True

            save_message: dict[str, str | None] = {"text": None}

            def handle_dialog(dialog):
                save_message["text"] = dialog.message
                dialog.accept()

            page.on("dialog", handle_dialog)
            save_button = page.get_by_role("button", name="保存配置")
            save_button.click()
            page.wait_for_timeout(2000)
            result["save_dialog"] = save_message["text"]
            if save_message["text"] == "MCP 配置保存成功":
                result["save_button_worked"] = True
            else:
                raise AssertionError(f"Unexpected save dialog: {save_message['text']}")

            page.screenshot(path=str(SCREENSHOT_PATH), full_page=True)
        finally:
            browser.close()

    RESULT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

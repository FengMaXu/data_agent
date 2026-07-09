from pathlib import Path
import sys
import tempfile
import unittest

from src.workspace.code_executor import CodeExecutor
from src.workspace.workspace_manager import WorkspaceManager


class PythonRuntimeSelectionTests(unittest.TestCase):
    def test_external_python_command_uses_configured_executable(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = WorkspaceManager(root_dir=tmp, session_id="session")
            executor = CodeExecutor(
                workspace,
                python_runtime={"mode": "external", "executable": r"C:\Python\python.exe"},
            )

            cmd = executor._python_command(Path("script.py"))

        self.assertEqual(cmd[0], r"C:\Python\python.exe")
        self.assertEqual(cmd[-1], "script.py")

    def test_bundled_python_command_uses_packaged_server_mode_when_frozen(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = WorkspaceManager(root_dir=tmp, session_id="session")
            executor = CodeExecutor(workspace, python_runtime={"mode": "bundled"})
            old_executable = sys.executable
            had_frozen = hasattr(sys, "frozen")
            old_frozen = getattr(sys, "frozen", None)
            try:
                sys.executable = r"C:\App\data_agent_server.exe"
                sys.frozen = True
                cmd = executor._python_command(Path("script.py"))
            finally:
                sys.executable = old_executable
                if had_frozen:
                    sys.frozen = old_frozen
                else:
                    delattr(sys, "frozen")

        self.assertEqual(
            cmd,
            [r"C:\App\data_agent_server.exe", "--data-agent-run-python-script", "script.py"],
        )


if __name__ == "__main__":
    unittest.main()

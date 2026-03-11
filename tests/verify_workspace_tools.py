import asyncio
import os
import sys

sys.path.append(os.getcwd())

from src.workspace.workspace_manager import WorkspaceManager
from src.workspace.code_executor import CodeExecutor


async def test_fixes():
    print("--- 1. Testing Python Execution with Chinese Font ---")
    ws = WorkspaceManager(session_id="test_session")
    executor = CodeExecutor(ws)
    code = """
import matplotlib.pyplot as plt
import os

print("Hello from Sandbox!")
print(f"Current Font: {plt.rcParams['font.family']}")

plt.figure(figsize=(6, 4))
plt.plot([1, 2, 3], [4, 5, 2])
plt.title("测试图表 - Chinese Title")
plt.xlabel("X 轴")
plt.ylabel("Y 轴")

output_path = os.path.join(os.environ['OUTPUT_DIR'], 'test_plot.png')
plt.savefig(output_path)
print(f"Plot saved to {output_path}")
"""
    exec_result = await executor.execute_code(code, "Test Plot")
    print(f"Status: {exec_result['status']}")
    print(f"Stdout:\n{exec_result['stdout']}")
    print(f"Stderr:\n{exec_result['stderr']}")

    plot_path = ws.output_dir / "test_plot.png"
    if plot_path.exists():
        print(f"✅ Success: Plot generated at {plot_path}")
    else:
        print("❌ Failed: Plot not generated")


if __name__ == "__main__":
    asyncio.run(test_fixes())

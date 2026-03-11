"""
直接测试 CodeExecutor 类
"""
import asyncio
import sys
import os
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.workspace.workspace_manager import WorkspaceManager
from src.workspace.code_executor import CodeExecutor

async def main():
    # 创建测试工作区
    workspace = WorkspaceManager(session_id="test_code_executor")

    print(f"Session dir: {workspace.session_dir}")
    print(f"Data dir: {workspace.data_dir}")
    print(f"Output dir: {workspace.output_dir}")

    # 创建执行器
    executor = CodeExecutor(workspace, timeout=30)

    # 测试代码
    test_code = """
import sys
import os

print("=== Python 环境测试 ===")
print(f"Python 版本: {sys.version}")
print(f"Python 可执行文件: {sys.executable}")
print(f"当前工作目录: {os.getcwd()}")
print(f"DATA_DIR: {os.environ.get('DATA_DIR', '未设置')}")
print(f"OUTPUT_DIR: {os.environ.get('OUTPUT_DIR', '未设置')}")

# 测试中文字体配置
import matplotlib.pyplot as plt
import matplotlib
print(f"当前字体: {matplotlib.rcParams['font.family']}")

# 简单绘图测试
fig, ax = plt.subplots(figsize=(6, 4))
ax.bar(['A', 'B', 'C'], [1, 2, 3])
ax.set_title('测试图表')
plt.savefig(os.path.join(os.environ['OUTPUT_DIR'], 'test.png'))
print("图表已保存")
"""

    print("\n=== 执行代码 ===")
    result = await executor.execute_code(test_code, "测试脚本")

    print(f"\n状态: {result['status']}")
    print(f"退出码: {result['exit_code']}")
    print(f"\n--- stdout ---")
    print(result['stdout'][:5000])
    if result['stderr']:
        print(f"\n--- stderr ---")
        print(result['stderr'][:5000])
    print(f"\n新生成的文件: {result['new_output_files']}")

if __name__ == "__main__":
    asyncio.run(main())

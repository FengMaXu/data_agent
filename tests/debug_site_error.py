"""
调试 site 模块错误
"""
import subprocess
import sys
import os

# 简单的测试代码
test_code = """import sys
print("Python version:", sys.version)
print("Python executable:", sys.executable)
print("Standard library path:", sys.path)
print("Test Chinese: 中文测试")
"""

test_script = "D:/data_agent/workspace/test_site_script.py"
with open(test_script, "w", encoding="utf-8") as f:
    f.write(test_code)

output_file = "D:/data_agent/workspace/debug_site_output.txt"
with open(output_file, "w", encoding="utf-8") as out:
    # 测试 1: 不带任何参数
    out.write("=== Test 1: Plain python ===\n")
    result = subprocess.run(
        [sys.executable, test_script],
        capture_output=True,
        text=False,
    )
    out.write("stdout: " + result.stdout.decode("utf-8", errors="replace") + "\n")
    out.write("stderr: " + result.stderr.decode("utf-8", errors="replace") + "\n")
    out.write("returncode: " + str(result.returncode) + "\n\n")

    # 测试 2: 带 -X utf8
    out.write("=== Test 2: With -X utf8 ===\n")
    result = subprocess.run(
        [sys.executable, "-X", "utf8", test_script],
        capture_output=True,
        text=False,
    )
    out.write("stdout: " + result.stdout.decode("utf-8", errors="replace") + "\n")
    out.write("stderr: " + result.stderr.decode("utf-8", errors="replace") + "\n")
    out.write("returncode: " + str(result.returncode) + "\n\n")

    # 测试 3: 带环境变量 PYTHONIOENCODING
    out.write("=== Test 3: With PYTHONIOENCODING ===\n")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    result = subprocess.run(
        [sys.executable, test_script],
        capture_output=True,
        text=False,
        env=env,
    )
    out.write("stdout: " + result.stdout.decode("utf-8", errors="replace") + "\n")
    out.write("stderr: " + result.stderr.decode("utf-8", errors="replace") + "\n")
    out.write("returncode: " + str(result.returncode) + "\n\n")

    # 测试 4: 切换工作目录
    out.write("=== Test 4: With cwd change ===\n")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    result = subprocess.run(
        [sys.executable, test_script],
        cwd="D:/data_agent/workspace",
        capture_output=True,
        text=False,
        env=env,
    )
    out.write("stdout: " + result.stdout.decode("utf-8", errors="replace") + "\n")
    out.write("stderr: " + result.stderr.decode("utf-8", errors="replace") + "\n")
    out.write("returncode: " + str(result.returncode) + "\n\n")

print(f"Output saved to: {output_file}")

# 清理
os.remove(test_script)

"""
测试沙盒中 stdout 中文编码问题 - 简化版
"""
import asyncio
import subprocess
import sys
import os

async def test_stdout_encoding():
    """测试注入编码修复后的输出"""

    # 模拟 code_executor.py 的代码注入
    test_code = """# -*- coding: utf-8 -*-
import sys
import os

# 强制设置 stdout/stderr 编码为 UTF-8
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

print("=== 测试中文输出 ===")
print("图片已保存到: /output/test.png")
print("=== 2025年12月各行业销售数据摘要 ===")
print(f"{'行业名称':<10} {'累计商品销售额_万元':<20}")
print(f"{'批发业':<10} {7276.57:<20.2f}")
print(f"{'零售业':<10} {499.88:<20.2f}")
print(f"{'住宿业':<10} {49.74:<20.2f}")
print("总计累计商品销售额: 7,826.19 万元")
"""

    # 写入临时脚本
    test_script = "D:/data_agent/workspace/test_encoding_script.py"
    with open(test_script, "w", encoding="utf-8") as f:
        f.write(test_code)

    # 使用 subprocess.run 模拟沙盒执行
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

    # 构建命令：添加 -X utf8 选项
    python_cmd = [sys.executable]
    if sys.platform == "win32":
        python_cmd.extend(["-X", "utf8"])
    python_cmd.append(test_script)

    # 输出到文件以避免终端编码问题
    result = subprocess.run(
        python_cmd,
        capture_output=True,
        text=False,  # 使用 bytes 模式
        env=env
    )

    # 手动解码
    stdout_text = result.stdout.decode("utf-8", errors="replace")
    stderr_text = result.stderr.decode("utf-8", errors="replace")

    # 写入文件查看
    output_file = "D:/data_agent/workspace/test_encoding_output.txt"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write("=== STDOUT ===\n")
        f.write(stdout_text)
        f.write("\n=== STDERR ===\n")
        f.write(stderr_text)

    print(f"输出已保存到: {output_file}")

    # 检查是否有乱码
    if "批发业" in stdout_text and "零售业" in stdout_text:
        print("[SUCCESS] 中文字符正确显示")
        return True
    else:
        print("[FAIL] 仍有乱码")
        print("Output:", repr(stdout_text[:200]))
        return False

if __name__ == "__main__":
    asyncio.run(test_stdout_encoding())

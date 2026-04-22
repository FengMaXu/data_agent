# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

project_root = Path(SPECPATH).resolve()

hiddenimports = collect_submodules("mcp")

hiddenimports += [
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "src.mcp.client.stdio_client",
    "src.mcp.client.sse_client",
    "src.mcp.client.streamable_http_client",
]

datas = []
for source, target in [
    ("knowledge", "knowledge"),
    ("src/templates", "src/templates"),
    (".env.example", "."),
]:
    if (project_root / source).exists():
        datas.append((str(project_root / source), target))

datas += collect_data_files("mcp")

a = Analysis(
    [str(project_root / "server.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={
        "matplotlib": {
            "backends": "Agg",
        },
    },
    runtime_hooks=[],
    excludes=[
        "tests",
        "pytest",
        "torch",
        "torchaudio",
        "torchvision",
        "transformers",
        "datasets",
        "evaluate",
        "sentence_transformers",
        "onnxruntime",
        "tokenizers",
        "safetensors",
        "huggingface_hub",
        "accelerate",
        "PyQt6",
        "PySide6",
        "PySide2",
        "tkinter",
        "_tkinter",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name="data_agent_server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    exclude_binaries=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="data_agent_server",
)

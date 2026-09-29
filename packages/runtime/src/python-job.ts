import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

export interface PythonJobResult { jobId: string; status: "success" | "error" | "timeout" | "aborted"; exitCode: number | null; stdout: string; stderr: string; scriptPath: string; artifacts: string[]; durationMs: number }

const PYTHON_ENV_ALLOWLIST = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES",
  "PROGRAMFILES(X86)", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "LANG", "LC_ALL", "LC_CTYPE",
]);

/** Agent-authored code receives only OS/process essentials, never ambient host credentials. */
export function pythonJobEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name]) => PYTHON_ENV_ALLOWLIST.has(name.toUpperCase())));
}

/**
 * Bootstrap that confines agent-authored code before it runs: file access is
 * limited to the session workspace (read/write), the Python installation and
 * the temp directory (read/write), and subprocess/shell execution is refused.
 * Audit hooks guard against accidental reads of host files such as evaluation
 * gold answers; they are not a security boundary against hostile code.
 */
export const PYTHON_WORKSPACE_BOOTSTRAP = String.raw`import json, os, runpy, site, sys, sysconfig, tempfile, threading

_config = json.loads(os.environ.pop("DATA_AGENT_PYTHON_CONFINEMENT"))
_script = _config["script"]
sys.dont_write_bytecode = True

def _norm(value):
    try:
        text = os.fsdecode(value)
    except TypeError:
        return None
    if text.startswith("file:"):
        text = text[5:].split("?", 1)[0]
    return os.path.normcase(os.path.realpath(os.path.abspath(text)))

def _roots(values):
    result = []
    for value in values:
        if value:
            normalized = _norm(value)
            if normalized and normalized not in result:
                result.append(normalized)
    return result

_write_roots = _roots([_config["workspace"], tempfile.gettempdir()])
_read_candidates = [sys.prefix, sys.base_prefix, sys.exec_prefix, sys.base_exec_prefix]
_read_candidates += list(sysconfig.get_paths().values())
try:
    _read_candidates += list(site.getsitepackages())
except Exception:
    pass
try:
    _read_candidates.append(site.getusersitepackages())
except Exception:
    pass
if os.name == "nt":
    _read_candidates += [os.environ.get("SYSTEMROOT"), os.environ.get("WINDIR")]
else:
    _read_candidates += ["/usr", "/etc", "/lib", "/lib64", "/opt", "/dev/null", "/dev/urandom", "/proc/self"]
_read_roots = _write_roots + _roots(_read_candidates)

def _inside(path, roots):
    return any(path == root or path.startswith(root.rstrip(os.sep) + os.sep) for root in roots)

_guard = threading.local()

def _deny(detail):
    raise PermissionError("WORKSPACE_ACCESS_DENIED: " + str(detail) + " (run_python may only access the session workspace; query data through query_database)")

def _check(path, write):
    if isinstance(path, int) or path is None:
        return
    normalized = _norm(path)
    if normalized is None:
        return
    if not _inside(normalized, _write_roots if write else _read_roots):
        _deny(os.fsdecode(path))

_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
_DENIED_EVENTS = {"subprocess.Popen", "os.system", "os.exec", "os.spawn", "os.posix_spawn", "os.startfile", "os.fork", "os.forkpty", "pty.spawn"}
_WRITE_PATH_EVENTS = {"os.remove", "os.rmdir", "os.mkdir", "os.chmod", "os.truncate", "os.utime", "shutil.rmtree", "os.symlink", "os.link"}

def _hook(event, args):
    if getattr(_guard, "active", False):
        return
    _guard.active = True
    try:
        if event in _DENIED_EVENTS:
            _deny(event)
        elif event == "open":
            path, mode, flags = (tuple(args) + (None, None, None))[:3]
            write = (isinstance(mode, str) and any(flag in mode for flag in "wax+")) or (isinstance(flags, int) and bool(flags & _WRITE_FLAGS))
            _check(path, write)
        elif event in ("os.listdir", "os.scandir", "os.chdir"):
            _check(args[0] if args else ".", False)
        elif event in _WRITE_PATH_EVENTS:
            _check(args[0] if args else None, True)
        elif event in ("os.rename", "shutil.copyfile", "shutil.copytree", "shutil.move"):
            if len(args) >= 2:
                _check(args[0], event == "os.rename" or event == "shutil.move")
                _check(args[1], True)
        elif event == "sqlite3.connect":
            database = args[0] if args else ""
            if isinstance(database, (str, bytes, os.PathLike)) and os.fsdecode(database) not in ("", ":memory:"):
                _check(database, False)
    finally:
        _guard.active = False

sys.addaudithook(_hook)
sys.argv = [_script]
runpy.run_path(_script, run_name="__main__")
`;

export async function runPythonJob(code: string, options: { workspace: string; executable: string; timeoutMs?: number; signal?: AbortSignal }): Promise<PythonJobResult> {
  const jobId = randomUUID(); const started = Date.now(); const workspace = path.resolve(options.workspace); const scripts = path.join(workspace, "scripts"); await mkdir(scripts, { recursive: true }); const scriptPath = path.join(scripts, `${jobId}.py`); await writeFile(scriptPath, code, "utf8");
  const bootstrapPath = path.join(scripts, `${jobId}.bootstrap.py`); await writeFile(bootstrapPath, PYTHON_WORKSPACE_BOOTSTRAP, "utf8");
  const env = { ...pythonJobEnvironment(), DATA_AGENT_PYTHON_CONFINEMENT: JSON.stringify({ workspace, script: scriptPath }) };
  return await new Promise((resolve) => { const child = spawn(options.executable, [bootstrapPath], { cwd: workspace, shell: false, windowsHide: true, env }); let stdout="", stderr=""; child.stdout.on("data", chunk => { stdout += chunk.toString(); }); child.stderr.on("data", chunk => { stderr += chunk.toString(); }); let status: PythonJobResult["status"] = "error"; const timer = setTimeout(() => { status="timeout"; child.kill(); }, options.timeoutMs ?? 60000); const abort = () => { status="aborted"; child.kill(); }; options.signal?.addEventListener("abort", abort, { once: true }); const finish = (exitCode: number | null, extraStderr = "") => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); unlink(bootstrapPath).catch(() => undefined).then(() => readdir(workspace)).then((artifacts) => resolve({ jobId, status, exitCode, stdout, stderr: `${stderr}${extraStderr}`, scriptPath, artifacts, durationMs: Date.now() - started })); }; child.on("error", error => finish(null, error.message)); child.on("close", code => { if(status !== "timeout" && status !== "aborted") status=code===0?"success":"error"; finish(code); }); });
}

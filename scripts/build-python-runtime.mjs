import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const source = process.argv[2]; const output = process.argv[3];
if (!source || !output) throw new Error("Usage: node build-python-runtime.mjs <source-runtime> <output-runtime>");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, force: true });
const hash = createHash("sha256");
const requiredSqlglotVersion = "30.17.0";
const executableRelative = process.platform === "win32" ? (await readFile(path.join(output, "python.exe")).then(() => "python.exe").catch(() => "Scripts/python.exe")) : "bin/python";
const executable = path.join(output, executableRelative);
const files = await readFile(executable);

// Charts are drawn from ChartSpec, never in Python (ADR-0008), so the pack ships no plotting library.
// These distributions exist only for matplotlib; pillow and pyparsing are general-purpose and stay.
const PLOTTING_DISTRIBUTIONS = ["matplotlib", "contourpy", "cycler", "kiwisolver", "fonttools"];
const REMOVE_DISTRIBUTIONS = `
import importlib.metadata as md, json, pathlib, sys
removed = []
for name in json.loads(sys.argv[1]):
    try:
        dist = md.distribution(name)
    except md.PackageNotFoundError:
        continue
    root = pathlib.Path(dist.locate_file(""))
    dirs = set()
    for entry in dist.files or []:
        path = pathlib.Path(dist.locate_file(entry))
        if path.is_file():
            path.unlink()
            dirs.add(path.parent)
    for directory in sorted(dirs, key=lambda d: len(d.parts), reverse=True):
        while directory != root and directory.exists() and not any(directory.iterdir()):
            directory.rmdir()
            directory = directory.parent
    removed.append(name)
print(json.dumps(removed))
`;
const removal = spawnSync(executable, ["-c", REMOVE_DISTRIBUTIONS, JSON.stringify(PLOTTING_DISTRIBUTIONS)], { encoding: "utf8" });
if (removal.status !== 0) {
  console.error(`Removing plotting libraries failed\n${removal.stderr || removal.stdout}`);
  process.exit(1);
}

// The manifest must describe an executable capability, not an intended one.
// Fail the pack build if the data dependencies are unimportable or a plotting library is still present.
const dataCheck = spawnSync(executable, ["-c", "import importlib.util, numpy, pandas, sqlglot; print('sqlglot='+sqlglot.__version__); print('matplotlib=' + ('present' if importlib.util.find_spec('matplotlib') else 'absent'))"], { encoding: "utf8" });
if (dataCheck.status !== 0 || !dataCheck.stdout.includes(`sqlglot=${requiredSqlglotVersion}`) || !dataCheck.stdout.includes("matplotlib=absent")) {
  console.error(`Python data/query pack is incomplete or still ships matplotlib: numpy, pandas and sqlglot ${requiredSqlglotVersion} must import, matplotlib must be absent\n${dataCheck.stderr || dataCheck.stdout}`);
  process.exit(1);
}
hash.update(files);
const manifest = { runtimeId: `python-data-${process.platform}-${process.arch}`, pythonVersion: process.env.PYTHON_VERSION ?? "3.13.x", platform: process.platform, arch: process.arch, packs: ["base", "data", "sqlglot"], sha256: hash.digest("hex") };
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(JSON.stringify(manifest));

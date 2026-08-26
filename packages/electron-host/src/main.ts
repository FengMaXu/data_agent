import { pathToFileURL } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Production Electron main entry for the TypeScript stack.
 *
 * Responsibilities:
 * - create the per-user data directories (metadata DB, Pi sessions, workspace, knowledge)
 * - construct the shared DataAgentRuntime over those paths
 * - register the versioned command channel on ipcMain
 * - open a BrowserWindow that loads the built Renderer (dist/index.html)
 *
 * The legacy Python backend is never spawned. The bundled Python runtime pack
 * and KTX semantic context are consumed from extraResources at runtime by the
 * Runtime itself.
 */

export interface ElectronMainRuntimePaths {
  userDataDir: string;
  /** Packaged resources dir; resolved from process.resourcesPath by the entry. */
  resourcesPath?: string;
  rendererDist: string;
}

declare const __dirname: string;

export function resolveRuntimePaths(options: { userDataDir: string; appDir?: string }): ElectronMainRuntimePaths {
  let appDir = options.appDir;
  if (!appDir && typeof __dirname !== "undefined") {
    // Dev layout:  frontend/electron-host/main.cjs -> frontend
    // Packaged:     resources/app.asar/electron-host -> resources/app.asar
    const insideAsar = __dirname.includes(`${path.sep}app.asar`);
    appDir = insideAsar ? path.resolve(__dirname, "..") : path.resolve(__dirname, "..", "..");
  }
  return {
    userDataDir: options.userDataDir,
    // Renderer output lives in <app>/dist when packaged via electron-builder files config
    rendererDist: path.join(appDir ?? process.cwd(), "dist"),
  };
}

export interface MainDeps {
  app: {
    whenReady(): Promise<void>;
    getPath(name: "userData"): string;
    quit(): void;
  };
  /** Packaged resources dir (process.resourcesPath); absent in dev. */
  resourcesPath?: string;
  BrowserWindow: new (options: Record<string, unknown>) => { loadFile(file: string): Promise<void>; loadURL(url: string): Promise<void> };
  ipcMain: unknown;
}

export async function startElectronHost(deps: MainDeps, overrides: Partial<ElectronMainRuntimePaths> = {}): Promise<void> {
  const { DataAgentRuntime, MetadataStore, PiJsonlSessionStore } = await import("@data-agent/runtime");
  const { KnowledgeIndex } = await import("@data-agent/runtime");
  const { registerElectronRuntimeIpc } = await import("./index.js");

  const paths = resolveRuntimePaths({ userDataDir: deps.app.getPath("userData") });
  if (overrides.userDataDir) paths.userDataDir = overrides.userDataDir;
  if (overrides.rendererDist) paths.rendererDist = overrides.rendererDist;

  // Bundled Python runtime pack ships under extraResources; never fall back to
  // development paths inside the packaged application.
  const effectiveResources = overrides.resourcesPath ?? deps.resourcesPath;
  let pythonExecutable: string | undefined;
  const bundledPython = path.join(effectiveResources ?? "", "python-runtime", "Scripts", "python.exe");
  if (effectiveResources && existsSync(bundledPython)) pythonExecutable = bundledPython;

  for (const dir of ["metadata", "sessions", "workspace", "knowledge"]) {
    mkdirSync(path.join(paths.userDataDir, dir), { recursive: true });
  }

  const metadata = new MetadataStore(path.join(paths.userDataDir, "metadata", "app.db"));
  const sessions = new PiJsonlSessionStore(path.join(paths.userDataDir, "sessions"));
  const knowledgeRoot = path.join(paths.userDataDir, "knowledge");
  let knowledge: InstanceType<typeof KnowledgeIndex> | undefined;
  try {
    knowledge = new (KnowledgeIndex as unknown as new (root?: string) => InstanceType<typeof KnowledgeIndex>)(knowledgeRoot);
  } catch {
    knowledge = undefined;
  }
    // Semantic sources live in a KTX project under the user data dir; the
  // runtime scans business-semantic/ and semantic-layer/ layouts there.
  // DATA_AGENT_SEMANTIC_PROJECT_DIR overrides (e.g. to reuse an existing project).
  const semanticProjectDir = process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR
    ? path.resolve(process.env.DATA_AGENT_SEMANTIC_PROJECT_DIR)
    : path.join(paths.userDataDir, "semantic-context");
  const applicationRoot = path.dirname(paths.rendererDist);
  const developmentRoot = applicationRoot.includes(`${path.sep}app.asar`) ? applicationRoot : path.resolve(applicationRoot, "..");
  const packagedRoot = effectiveResources ?? applicationRoot;
  const runtime = new DataAgentRuntime({
    metadata,
    sessions,
    knowledgeRoot,
    knowledge,
    pythonExecutable,
    semanticProjectDir,
    skillRoots: [path.join(developmentRoot, ".agents", "skills"), path.join(packagedRoot, ".agents", "skills")],
  });

  registerElectronRuntimeIpc(deps.ipcMain as never, runtime);

  await deps.app.whenReady();
  if (process.env.DATA_AGENT_SMOKE === "1") {
    // Startup smoke: runtime + IPC registered without loading a window.
    const { writeFileSync } = await import("node:fs");
    try { writeFileSync(path.join(paths.userDataDir, "smoke.ok"), "ok"); } catch { /* best effort */ }
    deps.app.quit();
    return;
  }
  const window = new deps.BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "..", "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(path.join(paths.rendererDist, "index.html"));
}

// This module is only loaded as an Electron main entry (tests import
// ./index.js directly), so starting unconditionally here is safe.
// Vitest imports this file for unit tests; never boot electron there.
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") void (async () => {
  try {
    const electronModule = "electron";
    const electron = (await import(/* @vite-ignore */ electronModule)) as never as MainDeps & { resourcesPath?: string };
    await startElectronHost(electron, { resourcesPath: electron.resourcesPath });
  } catch (error) {
    // GUI-subsystem processes have no console; persist the failure for diagnostics.
    try {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(path.join(process.env.TEMP ?? process.cwd(), "data-agent-main-error.log"),
        `[${new Date().toISOString()}] electron host failed to start:\n${(error instanceof Error ? error.stack : String(error))}\n`);
    } catch {
      /* ignore */
    }
    console.error("electron host failed to start:", error);
    const electronModule2 = "electron";
    try {
      const { app: crashedApp } = (await import(/* @vite-ignore */ electronModule2)) as never;
      (crashedApp as { exit?: (code: number) => void }).exit?.(1);
    } catch { /* not in electron */ }
    process.exitCode = 1;
  }
})();

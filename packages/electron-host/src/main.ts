import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
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
  rendererDist: string;
}

export function resolveRuntimePaths(options: { userDataDir: string; appDir?: string }): ElectronMainRuntimePaths {
  return {
    userDataDir: options.userDataDir,
    // Renderer output lives in <app>/dist when packaged via electron-builder files config
    rendererDist: options.appDir ? path.join(options.appDir, "dist") : "dist",
  };
}

export interface MainDeps {
  app: {
    whenReady(): Promise<void>;
    getPath(name: "userData"): string;
    quit(): void;
  };
  BrowserWindow: new (options: Record<string, unknown>) => { loadFile(file: string): Promise<void>; loadURL(url: string): Promise<void> };
  ipcMain: unknown;
}

export async function startElectronHost(deps: MainDeps, overrides: Partial<ElectronMainRuntimePaths> = {}): Promise<void> {
  const { DataAgentRuntime, MetadataStore, PiJsonlSessionStore } = await import("@data-agent/runtime");
  const { KnowledgeIndex } = await import("@data-agent/runtime");
  const { registerElectronRuntimeIpc } = await import("./index.js");

  const paths = resolveRuntimePaths({ userDataDir: deps.app.getPath("userData"), appDir: path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")) });
  if (overrides.userDataDir) paths.userDataDir = overrides.userDataDir;
  if (overrides.rendererDist) paths.rendererDist = overrides.rendererDist;

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
  const runtime = new DataAgentRuntime({ metadata, sessions, knowledgeRoot, knowledge });

  registerElectronRuntimeIpc(deps.ipcMain as never, runtime);

  await deps.app.whenReady();
  const window = new deps.BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(path.join(paths.rendererDist, "index.html"));
}

const isElectronMain = process.argv[1] && process.argv[1].includes("electron-host");
if (isElectronMain) {
  // Executed as the real Electron main; resolved at runtime so unit tests never load electron.
  const electronModule = "electron";
  void (async () => {
    const electron = (await import(/* @vite-ignore */ electronModule)) as never;
    await startElectronHost(electron);
  })();
}

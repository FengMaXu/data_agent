import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveRuntimePaths } from "./main.js";

describe("resolveRuntimePaths", () => {
  it("resolves the renderer dist relative to the frontend root in dev layout", () => {
    // Dev: frontend/electron-host/main.cjs -> app root is two levels up.
    const fakeDir = path.join("D:", "data_agent", "frontend", "electron-host");
    const paths = resolveRuntimePaths({ userDataDir: "C:\\u", appDir: path.resolve(fakeDir, "..") });
    expect(paths.rendererDist).toBe(path.join("D:", "data_agent", "frontend", "dist"));
    expect(paths.userDataDir).toBe("C:\\u");
  });

  it("resolves the renderer dist inside app.asar when packaged", () => {
    // Packaged: resources/app.asar/electron-host -> app root is one level up.
    const fakeDir = path.join("C:", "app", "resources", "app.asar", "electron-host");
    const paths = resolveRuntimePaths({ userDataDir: "C:\\u", appDir: path.resolve(fakeDir, "..") });
    expect(paths.rendererDist).toBe(path.join("C:", "app", "resources", "app.asar", "dist"));
  });

});

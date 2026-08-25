// Headless page check: load a URL in Electron, capture console errors and
// render failures, write a report file, quit.
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");

const target = process.argv[2];
const out = process.argv[3] ?? path.join(require("node:os").tmpdir(), "page-check.json");
const lines = [];
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    lines.push({ level, message: String(message).slice(0, 500), sourceId: String(sourceId).slice(-80), line });
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => lines.push({ level: "fail-load", message: `${code} ${desc} ${url}` }));
  try {
    await win.loadURL(target);
  } catch (error) {
    lines.push({ level: "load-throw", message: String(error) });
  }
  await new Promise((r) => setTimeout(r, 6000));
  let rootHtml = "";
  try { rootHtml = await win.webContents.executeJavaScript("document.getElementById('root')?.innerHTML?.slice(0, 300) ?? 'NO-ROOT'"); } catch (e) { rootHtml = "eval-failed: " + e.message; }
  fs.writeFileSync(out, JSON.stringify({ url: target, rootHtml, lines }, null, 2));
  app.quit();
});

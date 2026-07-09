import { app, BrowserWindow, ipcMain, safeStorage, Menu, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFileSync, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(frontendRoot, '..');

let mainWindow = null;
let backendProcess = null;
let backendPort = null;
let isQuitting = false;
let healthTimer = null;
let updateEventsConfigured = false;
let mainLogPath = null;

const isDev = process.argv.includes('--dev') || process.env.ELECTRON_DEV === '1';
const autoUpdateEnabled = process.env.DATA_AGENT_ENABLE_AUTO_UPDATE === '1';
const bootLogPath = path.join(path.dirname(process.execPath), 'desktop_boot.log');
const { autoUpdater } = electronUpdater;

app.setName('Data Agent');

function writeBootLog(message, details = undefined) {
    const line = [
        new Date().toISOString(),
        message,
        details === undefined ? '' : typeof details === 'string' ? details : JSON.stringify(details),
    ].filter(Boolean).join(' ');
    try {
        appendFileSync(bootLogPath, `${line}\n`, 'utf-8');
    } catch {
        // Best-effort early diagnostics only.
    }
}

writeBootLog('main module loaded', {
    execPath: process.execPath,
    cwd: process.cwd(),
    argv: process.argv,
});

async function writeMainLog(level, message, details = undefined) {
    const line = [
        new Date().toISOString(),
        `[${level}]`,
        message,
        details === undefined ? '' : typeof details === 'string' ? details : JSON.stringify(details),
    ].filter(Boolean).join(' ');

    if (level === 'error') {
        console.error(line);
    } else {
        console.log(line);
    }

    if (!mainLogPath) return;
    try {
        await fs.appendFile(mainLogPath, `${line}\n`, 'utf-8');
        writeBootLog(line);
    } catch (error) {
        console.error('Failed to write desktop main log:', error);
        writeBootLog('failed to write desktop main log', error instanceof Error ? error.message : String(error));
    }
}

async function findAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(() => resolve(port));
        });
    });
}

function getSecretStorePath() {
    return path.join(app.getPath('userData'), 'llm-secrets.bin');
}

async function readStoredSecrets() {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            return {};
        }
        const encoded = await fs.readFile(getSecretStorePath(), 'utf-8');
        const encrypted = Buffer.from(encoded, 'base64');
        const plaintext = safeStorage.decryptString(encrypted);
        return pickSecretFields(JSON.parse(plaintext));
    } catch {
        return {};
    }
}

async function saveStoredSecrets(secrets) {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Electron safeStorage encryption is not available on this device');
    }

    const current = await readStoredSecrets();
    const next = { ...current };
    for (const [key, value] of Object.entries(pickSecretFields(secrets || {}))) {
        if (typeof value === 'string' && value.trim()) {
            next[key] = value.trim();
        }
    }

    const payload = JSON.stringify(next);
    const encrypted = safeStorage.encryptString(payload);
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(getSecretStorePath(), encrypted.toString('base64'), 'utf-8');
    return { ok: true };
}

function pickSecretFields(secrets) {
    return {
        openai_api_key: typeof secrets?.openai_api_key === 'string' ? secrets.openai_api_key : undefined,
        anthropic_api_key: typeof secrets?.anthropic_api_key === 'string' ? secrets.anthropic_api_key : undefined,
    };
}

function getBackendCommand() {
    if (app.isPackaged) {
        return {
            command: path.join(process.resourcesPath, 'backend', 'data_agent_server', 'data_agent_server.exe'),
            args: [],
        };
    }

    const venvPython = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
    return {
        command: existsSync(venvPython) ? venvPython : 'python',
        args: [path.join(projectRoot, 'server.py')],
    };
}

function startBackend() {
    if (!backendPort) {
        throw new Error('Backend port has not been assigned');
    }

    const { command, args } = getBackendCommand();
    const runtimeArgs = [
        ...args,
        '--host',
        '127.0.0.1',
        '--port',
        String(backendPort),
        '--log-dir',
        app.getPath('userData'),
    ];

    void writeMainLog('info', 'starting backend', {
        command,
        args: runtimeArgs,
        cwd: projectRoot,
        resourcesPath: process.resourcesPath,
        packaged: app.isPackaged,
    });

    backendProcess = spawn(command, runtimeArgs, {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            DATA_AGENT_CONFIG_DIR: app.getPath('userData'),
        },
    });

    backendProcess.stdout?.on('data', (chunk) => {
        void writeMainLog('info', '[backend stdout]', chunk.toString().trimEnd());
    });
    backendProcess.stderr?.on('data', (chunk) => {
        void writeMainLog('error', '[backend stderr]', chunk.toString().trimEnd());
    });
    backendProcess.on('error', (error) => {
        void writeMainLog('error', 'backend process spawn error', {
            message: error.message,
            stack: error.stack,
        });
    });
    backendProcess.on('exit', (code, signal) => {
        void writeMainLog('error', 'backend exited', { code, signal });
        backendProcess = null;
        if (!isQuitting) {
            setTimeout(() => {
                try {
                    startBackend();
                } catch (error) {
                    console.error('Failed to restart backend:', error);
                }
            }, 1500);
        }
    });
}

async function waitForBackend() {
    const healthUrl = `http://127.0.0.1:${backendPort}/health`;
    const deadline = Date.now() + 120_000;
    let lastRetryLogAt = 0;
    void writeMainLog('info', 'waiting for backend health', { healthUrl });
    while (Date.now() < deadline) {
        try {
            const response = await fetch(healthUrl);
            if (response.ok) {
                void writeMainLog('info', 'backend health check passed');
                return;
            }
        } catch (error) {
            const now = Date.now();
            if (now - lastRetryLogAt > 5_000) {
                lastRetryLogAt = now;
                void writeMainLog('info', 'backend health check retry', error instanceof Error ? error.message : String(error));
            }
            // Retry while the Python process starts.
        }
        await new Promise((resolve) => setTimeout(resolve, 450));
    }
    throw new Error('Backend did not become healthy in time');
}

async function applyStoredSecretsToBackend() {
    const secrets = await readStoredSecrets();
    if (!secrets.openai_api_key && !secrets.anthropic_api_key) return;

    const provider = secrets.anthropic_api_key ? 'anthropic' : 'openai';
    await fetch(`http://127.0.0.1:${backendPort}/api/settings/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider,
            openai_api_key: secrets.openai_api_key,
            anthropic_api_key: secrets.anthropic_api_key,
        }),
    });
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 980,
        minHeight: 680,
        backgroundColor: '#f6f0f9',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            additionalArguments: [`--backend-port=${backendPort}`],
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        void writeMainLog('error', 'renderer failed to load', {
            errorCode,
            errorDescription,
            validatedURL,
        });
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        void writeMainLog('error', 'renderer process gone', details);
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });

    mainWindow.loadFile(path.join(__dirname, 'loading.html'));
}

function getDesktopMenuTemplate(menuName) {
    const templates = {
        file: [
            { role: 'close', label: 'Close' },
        ],
        edit: [
            { role: 'undo', label: 'Undo' },
            { role: 'redo', label: 'Redo' },
            { type: 'separator' },
            { role: 'cut', label: 'Cut' },
            { role: 'copy', label: 'Copy' },
            { role: 'paste', label: 'Paste' },
            { role: 'selectAll', label: 'Select All' },
        ],
        view: [
            { role: 'reload', label: 'Reload' },
            { role: 'forceReload', label: 'Force Reload' },
            { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
            { type: 'separator' },
            { role: 'resetZoom', label: 'Actual Size' },
            { role: 'zoomIn', label: 'Zoom In' },
            { role: 'zoomOut', label: 'Zoom Out' },
            { type: 'separator' },
            { role: 'togglefullscreen', label: 'Toggle Full Screen' },
        ],
        window: [
            { role: 'minimize', label: 'Minimize' },
            { role: 'zoom', label: 'Zoom' },
            { role: 'close', label: 'Close' },
        ],
        help: [
            {
                label: 'Check for Updates',
                click: () => {
                    void checkForUpdates();
                },
            },
        ],
    };

    return templates[menuName] || [];
}

function loadRendererWindow() {
    if (!mainWindow) return;
    if (isDev) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(frontendRoot, 'dist', 'index.html'));
    }
}

function startHealthMonitor() {
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = setInterval(async () => {
        if (!backendPort || !backendProcess) return;
        try {
            const response = await fetch(`http://127.0.0.1:${backendPort}/health`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.error('Backend health check failed, restarting:', error);
            backendProcess.kill();
        }
    }, 15_000);
}

function configureAutoUpdater() {
    if (updateEventsConfigured) return;
    updateEventsConfigured = true;

    autoUpdater.autoDownload = false;

    autoUpdater.on('checking-for-update', () => {
        console.log('[updater] checking for update');
    });
    autoUpdater.on('update-available', (info) => {
        console.log(`[updater] update available: ${info.version}`);
        mainWindow?.webContents.send('data-agent:update-event', {
            type: 'available',
            version: info.version,
        });
    });
    autoUpdater.on('update-not-available', (info) => {
        console.log(`[updater] no update available: ${info.version}`);
        mainWindow?.webContents.send('data-agent:update-event', {
            type: 'not-available',
            version: info.version,
        });
    });
    autoUpdater.on('error', (error) => {
        console.error('[updater] error:', error);
        mainWindow?.webContents.send('data-agent:update-event', {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
        });
    });
    autoUpdater.on('download-progress', (progress) => {
        mainWindow?.webContents.send('data-agent:update-event', {
            type: 'download-progress',
            percent: progress.percent,
        });
    });
    autoUpdater.on('update-downloaded', (info) => {
        mainWindow?.webContents.send('data-agent:update-event', {
            type: 'downloaded',
            version: info.version,
        });
    });
}

async function checkForUpdates() {
    configureAutoUpdater();
    if (!app.isPackaged) {
        return { ok: false, skipped: true, reason: 'updates are only checked in packaged builds' };
    }
    return autoUpdater.checkForUpdates();
}

function stopBackend() {
    if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
    }
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        mainLogPath = path.join(app.getPath('userData'), 'desktop_main.log');
        await writeMainLog('info', 'app ready', {
            isDev,
            packaged: app.isPackaged,
            userData: app.getPath('userData'),
            appPath: app.getAppPath(),
            resourcesPath: process.resourcesPath,
        });
        backendPort = await findAvailablePort();
        await writeMainLog('info', 'allocated backend port', { backendPort });
        createMainWindow();
        startBackend();
        await waitForBackend();
        await applyStoredSecretsToBackend();
        loadRendererWindow();
        startHealthMonitor();
        configureAutoUpdater();
        if (autoUpdateEnabled) {
            await checkForUpdates();
        }
    }).catch((error) => {
        void writeMainLog('error', 'fatal startup error', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        app.quit();
    });
}

ipcMain.handle('data-agent:get-backend-port', () => backendPort);
ipcMain.handle('data-agent:get-stored-secrets', () => readStoredSecrets());
ipcMain.handle('data-agent:save-secrets', (_event, secrets) => saveStoredSecrets(secrets));
ipcMain.handle('data-agent:check-for-updates', () => checkForUpdates());
ipcMain.handle('data-agent:download-update', () => autoUpdater.downloadUpdate());
ipcMain.handle('data-agent:quit-and-install-update', () => autoUpdater.quitAndInstall());
ipcMain.handle('data-agent:select-python-executable', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: 'Select Python executable',
        properties: ['openFile'],
        filters: [
            { name: 'Python executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});
ipcMain.handle('data-agent:show-menu', (event, menuName, position = {}) => {
    const template = getDesktopMenuTemplate(menuName);
    if (template.length === 0) return false;
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) return false;
    Menu.buildFromTemplate(template).popup({
        window: targetWindow,
        x: Number(position.x) || 0,
        y: Number(position.y) || 0,
    });
    return true;
});

app.on('before-quit', () => {
    isQuitting = true;
    stopBackend();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

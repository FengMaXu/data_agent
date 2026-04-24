const { contextBridge, ipcRenderer } = require('electron');

const portArg = process.argv.find((arg) => arg.startsWith('--backend-port='));
const backendPort = portArg ? Number(portArg.split('=')[1]) : undefined;

contextBridge.exposeInMainWorld('__PORT__', backendPort);

contextBridge.exposeInMainWorld('dataAgent', {
    backendPort,
    getBackendPort: () => ipcRenderer.invoke('data-agent:get-backend-port'),
    getStoredSecrets: () => ipcRenderer.invoke('data-agent:get-stored-secrets'),
    saveSecrets: (secrets) => ipcRenderer.invoke('data-agent:save-secrets', secrets),
    checkForUpdates: () => ipcRenderer.invoke('data-agent:check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('data-agent:download-update'),
    quitAndInstallUpdate: () => ipcRenderer.invoke('data-agent:quit-and-install-update'),
    showMenu: (menuName, position) => ipcRenderer.invoke('data-agent:show-menu', menuName, position),
    onUpdateEvent: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('data-agent:update-event', listener);
        return () => ipcRenderer.removeListener('data-agent:update-event', listener);
    },
});

const { contextBridge, ipcRenderer } = require('electron');

// Versioned runtime bridge for the TypeScript stack. The renderer dispatches
// DataAgent command envelopes and receives response envelopes plus runtime
// events over the dedicated channels below.

contextBridge.exposeInMainWorld('dataAgentRuntime', {
    invokeRuntimeCommand: (envelope) => ipcRenderer.invoke('data-agent:command', envelope),
    subscribeRuntimeEvents: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('data-agent:event', handler);
        ipcRenderer.send('data-agent:events:subscribe');
        return () => {
            ipcRenderer.removeListener('data-agent:event', handler);
            ipcRenderer.send('data-agent:events:unsubscribe');
        };
    },
});

contextBridge.exposeInMainWorld('dataAgent', {
    getStoredSecrets: () => ipcRenderer.invoke('data-agent:get-stored-secrets'),
    saveSecrets: (secrets) => ipcRenderer.invoke('data-agent:save-secrets', secrets),
    checkForUpdates: () => ipcRenderer.invoke('data-agent:check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('data-agent:download-update'),
    quitAndInstallUpdate: () => ipcRenderer.invoke('data-agent:quit-and-install-update'),
    selectPythonExecutable: () => ipcRenderer.invoke('data-agent:select-python-executable'),
});

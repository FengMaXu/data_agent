export interface StoredLLMSecrets {
    openai_api_key?: string;
    anthropic_api_key?: string;
    default_model?: string;
    openai_base_url?: string;
}

export interface DataAgentDesktopBridge {
    backendPort?: number;
    getBackendPort: () => Promise<number | null>;
    getStoredSecrets: () => Promise<StoredLLMSecrets>;
    saveSecrets: (secrets: StoredLLMSecrets) => Promise<{ ok: boolean }>;
    checkForUpdates: () => Promise<unknown>;
    downloadUpdate: () => Promise<unknown>;
    quitAndInstallUpdate: () => Promise<unknown>;
    showMenu: (menuName: string, position: { x: number; y: number }) => Promise<boolean>;
    onUpdateEvent: (callback: (event: unknown) => void) => () => void;
}

declare global {
    interface Window {
        __PORT__?: number;
        dataAgent?: DataAgentDesktopBridge;
    }
}

export {};

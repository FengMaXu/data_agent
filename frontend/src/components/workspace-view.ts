import type { PluginsTab } from './PluginsPanel';
import type { SettingsSection } from './SettingsPanel';

/** What the main pane shows: the chat, or a page the sidebar opened. */
export type WorkspaceView =
    | { kind: 'chat' }
    | { kind: 'plugins'; tab: PluginsTab }
    | { kind: 'settings'; section: SettingsSection };

export const CHAT_VIEW: WorkspaceView = { kind: 'chat' };

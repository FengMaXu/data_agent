import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ToolPanel, { type ToolData } from './components/ToolPanel';
import SettingsModal from './components/SettingsModal';
import PluginsModal from './components/PluginsModal';
import LandingPage from './components/LandingPage';
import Onboarding from './components/Onboarding';
import { SessionProvider } from './hooks/useSession';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { PreviewProvider } from './context/PreviewContext';
import { getConfig, updateLLMConfig } from './api/client';
import LoginView from './components/LoginView';
import GlobalPreviewModal from './components/common/GlobalPreviewModal';

interface AppShellProps {
  startupState: 'checking' | 'ready' | 'onboarding';
  setStartupState: React.Dispatch<React.SetStateAction<'checking' | 'ready' | 'onboarding'>>;
}

const DESKTOP_MENU_ITEMS = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'view', label: 'View' },
  { id: 'window', label: 'Window' },
  { id: 'help', label: 'Help' },
];

const TOOL_PANEL_WIDTH = 410;
const CHAT_PANEL_MIN_WIDTH = 560;

const AppShell: React.FC<AppShellProps> = ({ startupState, setStartupState }) => {
  const { t } = useLanguage();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tools, setTools] = useState<ToolData[]>([]);
  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);
  const [pluginsModalTab, setPluginsModalTab] = useState<'MCP' | 'Skills' | null>(null);

  const previousToolsRef = useRef<ToolData[]>([]);
  const sidebarShellRef = useRef<HTMLDivElement>(null);
  const chatPanelShellRef = useRef<HTMLDivElement>(null);
  const chatMainPaneRef = useRef<HTMLDivElement>(null);
  const chatResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [chatPaneWidth, setChatPaneWidth] = useState<number | null>(null);
  const isDesktop = typeof window !== 'undefined' && Boolean(window.dataAgent);

  const handleUpdateTools = useCallback((newTools: ToolData[]) => {
    setTools(newTools);
    previousToolsRef.current = newTools;
  }, []);

  const getMaxChatPaneWidth = useCallback(() => {
    const sidebarWidth = sidebarShellRef.current?.getBoundingClientRect().width ?? 260;
    const chromeAllowance = 40;
    return Math.max(
      CHAT_PANEL_MIN_WIDTH,
      window.innerWidth - sidebarWidth - TOOL_PANEL_WIDTH - chromeAllowance,
    );
  }, []);

  const openToolPanel = useCallback(() => {
    const currentWidth =
      chatMainPaneRef.current?.getBoundingClientRect().width ??
      chatPanelShellRef.current?.getBoundingClientRect().width ??
      CHAT_PANEL_MIN_WIDTH;

    setChatPaneWidth((prev) => {
      const nextWidth = prev ?? currentWidth;
      return Math.min(getMaxChatPaneWidth(), Math.max(CHAT_PANEL_MIN_WIDTH, nextWidth));
    });
    setIsToolPanelOpen(true);
  }, [getMaxChatPaneWidth]);

  const closeToolPanel = useCallback(() => {
    setIsToolPanelOpen(false);
  }, []);

  const toggleToolPanel = useCallback(() => {
    if (isToolPanelOpen) {
      closeToolPanel();
      return;
    }
    openToolPanel();
  }, [closeToolPanel, isToolPanelOpen, openToolPanel]);

  const handleChatResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const currentWidth = chatMainPaneRef.current?.getBoundingClientRect().width ?? CHAT_PANEL_MIN_WIDTH;
    chatResizeStartRef.current = {
      startX: event.clientX,
      startWidth: currentWidth,
    };
    document.body.classList.add('chat-panel-resizing');

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!chatResizeStartRef.current) return;
      const { startX, startWidth } = chatResizeStartRef.current;
      const maxWidth = getMaxChatPaneWidth();
      const nextWidth = Math.min(
        maxWidth,
        Math.max(CHAT_PANEL_MIN_WIDTH, startWidth + (moveEvent.clientX - startX)),
      );
      setChatPaneWidth(nextWidth);
    };

    const handleMouseUp = () => {
      chatResizeStartRef.current = null;
      document.body.classList.remove('chat-panel-resizing');
      window.removeEventListener('mousemove', handleMouseMove);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
  }, [getMaxChatPaneWidth]);

  useEffect(() => {
    if (!isToolPanelOpen || chatPaneWidth == null) {
      return;
    }

    const handleResize = () => {
      setChatPaneWidth((current) => {
        if (current == null) return current;
        return Math.min(getMaxChatPaneWidth(), Math.max(CHAT_PANEL_MIN_WIDTH, current));
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [chatPaneWidth, getMaxChatPaneWidth, isToolPanelOpen]);

  if (startupState === 'checking') {
    return <div className="app-loading">{t('app.preparing')}</div>;
  }

  if (startupState === 'onboarding') {
    return <Onboarding onComplete={() => setStartupState('ready')} />;
  }

  return (
    <SessionProvider>
      <div className="desktop-shell">
        {isDesktop && (
          <div className="desktop-menu-strip" role="menubar" aria-label="Application menu">
            {DESKTOP_MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="desktop-menu-item"
                role="menuitem"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  void window.dataAgent?.showMenu(item.id, {
                    x: Math.round(rect.left),
                    y: Math.round(rect.bottom),
                  });
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        <div className="app-container">
          <div ref={sidebarShellRef} className="sidebar-shell">
            <Sidebar
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenWorkspace={() => {}}
              onOpenPlugins={(tab) => setPluginsModalTab(tab)}
            />
          </div>

          <div
            ref={chatPanelShellRef}
            className={`chat-panel-shell ${isToolPanelOpen ? 'has-tool-panel' : ''}`}
          >
            <div
              ref={chatMainPaneRef}
              className="chat-main-pane"
              style={isToolPanelOpen && chatPaneWidth ? { flex: `0 0 ${chatPaneWidth}px`, width: chatPaneWidth } : undefined}
            >
              {isToolPanelOpen && (
                <div
                  className="chat-panel-resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整对话区域宽度"
                  title="拖动调整对话区域宽度"
                  onMouseDown={handleChatResizeStart}
                />
              )}

              <ChatArea
                onUpdateTools={handleUpdateTools}
                onOpenToolPanel={openToolPanel}
                onToggleToolPanel={toggleToolPanel}
                isToolPanelOpen={isToolPanelOpen}
                hasTools={tools.length > 0}
              />
            </div>

            {isToolPanelOpen && <ToolPanel tools={tools} onClose={closeToolPanel} />}
          </div>

          {isSettingsOpen && (
            <SettingsModal onClose={() => setIsSettingsOpen(false)} />
          )}

          {pluginsModalTab && (
            <PluginsModal initialTab={pluginsModalTab} onClose={() => setPluginsModalTab(null)} />
          )}
        </div>
      </div>
    </SessionProvider>
  );
};

const App: React.FC = () => {
  const [startupState, setStartupState] = useState<'checking' | 'ready' | 'onboarding'>('checking');
  const { status } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }

    let cancelled = false;
    setStartupState('checking');

    const completeStartupCheck = async () => {
      try {
        const config = await getConfig();
        if (config.openai_api_key || config.anthropic_api_key) {
          if (!cancelled) setStartupState('ready');
          return;
        }

        const storedSecrets = await window.dataAgent?.getStoredSecrets();
        if (storedSecrets?.openai_api_key || storedSecrets?.anthropic_api_key) {
          await updateLLMConfig({
            provider: storedSecrets.anthropic_api_key ? 'anthropic' : 'openai',
            openai_api_key: storedSecrets.openai_api_key,
            anthropic_api_key: storedSecrets.anthropic_api_key,
          });
          if (!cancelled) setStartupState('ready');
          return;
        }

        if (!cancelled) setStartupState('onboarding');
      } catch (error) {
        console.error('Startup config check failed:', error);
        if (!cancelled) setStartupState('ready');
      }
    };

    void completeStartupCheck();
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === 'checking') {
    return <div className="app-loading">{t('app.preparing')}</div>;
  }

  if (status === 'anonymous') {
    return <LoginView />;
  }

  return (
    <PreviewProvider>
      <AppShell startupState={startupState} setStartupState={setStartupState} />
      <GlobalPreviewModal />
    </PreviewProvider>
  );
};

const Root: React.FC = () => {
  const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.dataAgent);
  const isAppRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/app');

  return (
    <LanguageProvider>
      {isDesktopRuntime || isAppRoute ? (
        <AuthProvider>
          <App />
        </AuthProvider>
      ) : (
        <LandingPage />
      )}
    </LanguageProvider>
  );
};

export default Root;

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
import { getConfigViaRuntime } from './api/runtime-client';
import LoginView from './components/LoginView';
import GlobalPreviewModal from './components/common/GlobalPreviewModal';
import { SemanticStartupStatus } from './components/SemanticStartupStatus';
import { useSemanticStartupStatus } from './hooks/useSemanticStartupStatus';

interface AppShellProps {
  startupState: 'checking' | 'ready' | 'onboarding';
  setStartupState: React.Dispatch<React.SetStateAction<'checking' | 'ready' | 'onboarding'>>;
}

const DESKTOP_MENU_ITEMS = [
  { id: 'file', labelKey: 'desktop.file' },
  { id: 'edit', labelKey: 'desktop.edit' },
  { id: 'view', labelKey: 'desktop.view' },
  { id: 'window', labelKey: 'desktop.window' },
  { id: 'help', labelKey: 'desktop.help' },
];

const TOOL_PANEL_MIN_WIDTH = 300;
const DEFAULT_CHAT_RATIO = 0.62;
const CHAT_PANEL_MIN_WIDTH = 560;

const AppShell: React.FC<AppShellProps> = ({ startupState, setStartupState }) => {
  const { t } = useLanguage();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tools, setTools] = useState<ToolData[]>([]);
  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [pluginsModalTab, setPluginsModalTab] = useState<'MCP' | 'Skills' | null>(null);
  const { status: semanticStatus, retrying: semanticRetrying, retry: retrySemantic } = useSemanticStartupStatus();

  const previousToolsRef = useRef<ToolData[]>([]);
  const sidebarShellRef = useRef<HTMLDivElement>(null);
  const chatPanelShellRef = useRef<HTMLDivElement>(null);
  const chatMainPaneRef = useRef<HTMLDivElement>(null);
  const chatResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const chatPaneRatioRef = useRef<number | null>(null);
  const [chatPaneWidth, setChatPaneWidth] = useState<number | null>(null);
  const isDesktop = typeof window !== 'undefined' && Boolean(window.dataAgent);
  const semanticBlocked = !semanticStatus || ['checking', 'ingesting', 'failed'].includes(semanticStatus.status);

  const handleUpdateTools = useCallback((newTools: ToolData[]) => {
    setTools(newTools);
    previousToolsRef.current = newTools;
  }, []);

  const getAvailablePaneWidth = useCallback(() => {
    const sidebarWidth = sidebarShellRef.current?.getBoundingClientRect().width ?? 220;
    const chromeAllowance = 40;
    return Math.max(
      CHAT_PANEL_MIN_WIDTH + TOOL_PANEL_MIN_WIDTH,
      window.innerWidth - sidebarWidth - chromeAllowance,
    );
  }, []);

  const getMaxChatPaneWidth = useCallback(() => (
    Math.max(CHAT_PANEL_MIN_WIDTH, getAvailablePaneWidth() - TOOL_PANEL_MIN_WIDTH)
  ), [getAvailablePaneWidth]);

  const recordChatPaneWidth = useCallback((nextWidth: number) => {
    const available = Math.max(CHAT_PANEL_MIN_WIDTH, getMaxChatPaneWidth());
    const clamped = Math.min(available, Math.max(CHAT_PANEL_MIN_WIDTH, nextWidth));
    chatPaneRatioRef.current = clamped / available;
    setChatPaneWidth(clamped);
  }, [getMaxChatPaneWidth]);

  const openToolPanel = useCallback(() => {
    recordChatPaneWidth(getAvailablePaneWidth() * DEFAULT_CHAT_RATIO);
    setIsToolPanelOpen(true);
  }, [getAvailablePaneWidth, recordChatPaneWidth]);

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
      recordChatPaneWidth(nextWidth);
    };

    const handleMouseUp = () => {
      chatResizeStartRef.current = null;
      document.body.classList.remove('chat-panel-resizing');
      window.removeEventListener('mousemove', handleMouseMove);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
  }, [getMaxChatPaneWidth, recordChatPaneWidth]);

  const handleChatResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const maxWidth = getMaxChatPaneWidth();
    setChatPaneWidth((current) => {
      const width = current ?? chatMainPaneRef.current?.getBoundingClientRect().width ?? CHAT_PANEL_MIN_WIDTH;
      let next: number;
      if (event.key === 'Home') next = CHAT_PANEL_MIN_WIDTH;
      else if (event.key === 'End') next = maxWidth;
      else {
        const delta = event.key === 'ArrowRight' ? 40 : -40;
        next = Math.min(maxWidth, Math.max(CHAT_PANEL_MIN_WIDTH, width + delta));
      }
      chatPaneRatioRef.current = next / Math.max(CHAT_PANEL_MIN_WIDTH, maxWidth);
      return next;
    });
  }, [getMaxChatPaneWidth]);

  useEffect(() => {
    if (chatPaneWidth == null) {
      return;
    }

    const handleResize = () => {
      const available = Math.max(CHAT_PANEL_MIN_WIDTH, getMaxChatPaneWidth());
      setChatPaneWidth((current) => {
        if (current == null) return current;
        const ratio = chatPaneRatioRef.current ?? current / available;
        const next = Math.min(available, Math.max(CHAT_PANEL_MIN_WIDTH, ratio * available));
        chatPaneRatioRef.current = next / available;
        return next;
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [chatPaneWidth, getMaxChatPaneWidth, isSidebarOpen]);

  if (startupState === 'checking') {
    return <div className="app-loading">{t('app.preparing')}</div>;
  }

  if (startupState === 'onboarding') {
    return <Onboarding onComplete={() => setStartupState('ready')} />;
  }

  return (
    <SessionProvider>
      <div className="desktop-shell">
        <a className="skip-link" href="#main-content">{t('accessibility.skipToContent')}</a>
        {isDesktop && (
          <div className="desktop-menu-strip" role="menubar" aria-label={t('desktop.menu')}>
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
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        )}

        <SemanticStartupStatus status={semanticStatus} retrying={semanticRetrying} onRetry={retrySemantic} />

        <div className="app-container">
          <div ref={sidebarShellRef} className={`sidebar-shell ${isSidebarOpen ? '' : 'is-collapsed'}`}>
            <Sidebar
              onOpenSettings={() => setIsSettingsOpen(true)}
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
                  aria-valuemin={CHAT_PANEL_MIN_WIDTH}
                  aria-valuemax={typeof window !== 'undefined' ? getMaxChatPaneWidth() : CHAT_PANEL_MIN_WIDTH}
                  aria-valuenow={Math.round(chatPaneWidth ?? CHAT_PANEL_MIN_WIDTH)}
                  aria-label={t('chat.resizeWidth')}
                  title={t('chat.resizeWidth')}
                  tabIndex={0}
                  onMouseDown={handleChatResizeStart}
                  onKeyDown={handleChatResizeKeyDown}
                />
              )}

              <ChatArea
                onUpdateTools={handleUpdateTools}
                onOpenToolPanel={openToolPanel}
                onToggleToolPanel={toggleToolPanel}
                isToolPanelOpen={isToolPanelOpen}
                hasTools={tools.length > 0}
                semanticBlocked={semanticBlocked}
                isSidebarOpen={isSidebarOpen}
                onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
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
        const config = await getConfigViaRuntime();
        const configRecord = config as Record<string, unknown>;
        const storedSecrets = await window.dataAgent?.getStoredSecrets();
        const hasConfiguredKey = [
          configRecord.api_key,
          configRecord.openai_api_key,
          configRecord.anthropic_api_key,
          storedSecrets?.openai_api_key,
          storedSecrets?.anthropic_api_key,
        ].some((value) => typeof value === 'string' && value.trim().length > 0);
        if (hasConfiguredKey) {
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

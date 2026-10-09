import React, { useEffect, useState, useCallback, useRef } from 'react';
// Chinese text face for the workspace app only; the landing page never loads it.
import '@fontsource-variable/noto-serif-sc';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ToolPanel, { type ToolData } from './components/ToolPanel';
import SettingsPanel from './components/SettingsPanel';
import PluginsPanel from './components/PluginsPanel';
import { CHAT_VIEW, type WorkspaceView } from './components/workspace-view';
import Onboarding from './components/Onboarding';
import { SessionProvider } from './hooks/useSession';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useLanguage } from './context/LanguageContext';
import { PreviewProvider } from './context/PreviewContext';
import { getConfigViaRuntime } from './api/runtime-client';
import LoginView from './components/LoginView';
import GlobalPreviewModal from './components/common/GlobalPreviewModal';
import { SemanticStartupStatus } from './components/SemanticStartupStatus';
import { useSemanticStartupStatus } from './hooks/useSemanticStartupStatus';

type StartupState = 'checking' | 'ready' | 'onboarding' | 'error';

interface AppShellProps {
  startupState: StartupState;
  setStartupState: React.Dispatch<React.SetStateAction<StartupState>>;
  onRetryStartup: () => void;
}

const DESKTOP_MENU_ITEMS = [
  { id: 'file', labelKey: 'desktop.file' },
  { id: 'edit', labelKey: 'desktop.edit' },
  { id: 'view', labelKey: 'desktop.view' },
  { id: 'window', labelKey: 'desktop.window' },
  { id: 'help', labelKey: 'desktop.help' },
];

const TOOL_PANEL_MIN_WIDTH = 300;
const DEFAULT_CHAT_RATIO = 0.64;
const CHAT_PANEL_MIN_WIDTH = 560;
// Hovering the collapsed rail peeks the full sidebar, pushing the page right; short delays keep a passing pointer from flickering it.
const SIDEBAR_PEEK_OPEN_DELAY = 80;
const SIDEBAR_PEEK_CLOSE_DELAY = 180;

const AppShell: React.FC<AppShellProps> = ({ startupState, setStartupState, onRetryStartup }) => {
  const { t } = useLanguage();
  const [tools, setTools] = useState<ToolData[]>([]);
  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);
  // The sidebar follows the tool panel (closed while it is open, open otherwise).
  // A manual toggle overrides that only until the tool panel next opens or closes.
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const isSidebarOpen = sidebarOverride ?? !isToolPanelOpen;
  const [isSidebarPeeking, setIsSidebarPeeking] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>(CHAT_VIEW);
  const sidebarPeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status: semanticStatus, retrying: semanticRetrying, retry: retrySemantic } = useSemanticStartupStatus();

  const previousToolsRef = useRef<ToolData[]>([]);
  const chatPanelShellRef = useRef<HTMLDivElement>(null);
  const chatMainPaneRef = useRef<HTMLDivElement>(null);
  const chatResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const chatPaneRatioRef = useRef<number | null>(null);
  const [chatPaneWidth, setChatPaneWidth] = useState<number | null>(null);
  const isDesktop = typeof window !== 'undefined' && Boolean(window.dataAgent);
  const semanticBlocked = !semanticStatus || ['checking', 'ingesting', 'failed'].includes(semanticStatus.status);

  const scheduleSidebarPeek = useCallback((peek: boolean) => {
    if (sidebarPeekTimerRef.current) clearTimeout(sidebarPeekTimerRef.current);
    sidebarPeekTimerRef.current = setTimeout(() => {
      sidebarPeekTimerRef.current = null;
      setIsSidebarPeeking(peek);
    }, peek ? SIDEBAR_PEEK_OPEN_DELAY : SIDEBAR_PEEK_CLOSE_DELAY);
  }, []);

  const toggleSidebarPinned = useCallback(() => {
    if (sidebarPeekTimerRef.current) clearTimeout(sidebarPeekTimerRef.current);
    sidebarPeekTimerRef.current = null;
    setIsSidebarPeeking(false);
    setSidebarOverride(!isSidebarOpen);
  }, [isSidebarOpen]);

  useEffect(() => () => {
    if (sidebarPeekTimerRef.current) clearTimeout(sidebarPeekTimerRef.current);
  }, []);

  const handleUpdateTools = useCallback((newTools: ToolData[]) => {
    setTools(newTools);
    previousToolsRef.current = newTools;
  }, []);

  const getAvailablePaneWidth = useCallback(() => {
    // Read the width the sidebar is settling to, not its mid-transition box.
    const sidebarWidth = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(isSidebarOpen ? '--sidebar-width' : '--sidebar-rail-width'),
    ) || (isSidebarOpen ? 184 : 64);
    const chromeAllowance = 40;
    return Math.max(
      CHAT_PANEL_MIN_WIDTH + TOOL_PANEL_MIN_WIDTH,
      window.innerWidth - sidebarWidth - chromeAllowance,
    );
  }, [isSidebarOpen]);

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
    // Clicking a tool row while the panel is already open must not undo a manual sidebar toggle.
    if (isToolPanelOpen) return;
    recordChatPaneWidth(getAvailablePaneWidth() * DEFAULT_CHAT_RATIO);
    setSidebarOverride(null);
    setIsToolPanelOpen(true);
  }, [getAvailablePaneWidth, isToolPanelOpen, recordChatPaneWidth]);

  const closeToolPanel = useCallback(() => {
    setSidebarOverride(null);
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

  if (startupState === 'error') {
    return (
      <div className="app-loading" role="alert">
        <p>{t('app.startupError')}</p>
        <button type="button" onClick={onRetryStartup}>{t('app.retry')}</button>
      </div>
    );
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
          <div
            className={`sidebar-shell ${isSidebarOpen ? '' : 'is-collapsed'} ${!isSidebarOpen && isSidebarPeeking ? 'is-peeking' : ''}`}
            // Tracked while open too, so the hover state is never stale when the sidebar auto-collapses.
            onMouseEnter={() => scheduleSidebarPeek(true)}
            onMouseLeave={() => scheduleSidebarPeek(false)}
          >
            <Sidebar
              activeView={activeView}
              onNavigate={setActiveView}
              collapsed={!isSidebarOpen && !isSidebarPeeking}
              pinned={isSidebarOpen}
              onExpand={() => setSidebarOverride(true)}
              onTogglePinned={toggleSidebarPinned}
            />
          </div>

          {/* The chat stays mounted behind settings pages so a running turn keeps streaming. */}
          <div
            ref={chatPanelShellRef}
            className={`chat-panel-shell ${isToolPanelOpen ? 'has-tool-panel' : ''}`}
            hidden={activeView.kind !== 'chat'}
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
              />
            </div>

            {isToolPanelOpen && <ToolPanel tools={tools} onClose={closeToolPanel} />}
          </div>

          {activeView.kind !== 'chat' && (
            <div className="workspace-page-shell">
              {activeView.kind === 'plugins'
                ? <PluginsPanel tab={activeView.tab} />
                : <SettingsPanel section={activeView.section} />}
            </div>
          )}
        </div>
      </div>
    </SessionProvider>
  );
};

const App: React.FC = () => {
  const [startupState, setStartupState] = useState<StartupState>('checking');
  const [startupAttempt, setStartupAttempt] = useState(0);
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
        const hasConfiguredKey = configRecord.llm_enabled !== false && [
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
        if (!cancelled) setStartupState('error');
      }
    };

    void completeStartupCheck();
    return () => {
      cancelled = true;
    };
  }, [status, startupAttempt]);

  if (status === 'checking') {
    return <div className="app-loading">{t('app.preparing')}</div>;
  }

  if (status === 'anonymous') {
    return <LoginView />;
  }

  return (
    <PreviewProvider>
      <AppShell
        startupState={startupState}
        setStartupState={setStartupState}
        onRetryStartup={() => setStartupAttempt((attempt) => attempt + 1)}
      />
      <GlobalPreviewModal />
    </PreviewProvider>
  );
};

/** The workspace app, loaded lazily by Root for /app and the desktop runtime. */
const AppRoot: React.FC = () => (
  <AuthProvider>
    <App />
  </AuthProvider>
);

export default AppRoot;

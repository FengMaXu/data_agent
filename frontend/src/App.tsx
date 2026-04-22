import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Terminal } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ToolPanel, { type ToolData } from './components/ToolPanel';
import SettingsModal from './components/SettingsModal';
import PluginsModal from './components/PluginsModal';
import Onboarding from './components/Onboarding';
import { SessionProvider } from './hooks/useSession';
import { LanguageProvider } from './context/LanguageContext';
import { getConfig, updateLLMConfig } from './api/client';

const App: React.FC = () => {
  const [startupState, setStartupState] = useState<'checking' | 'ready' | 'onboarding'>('checking');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tools, setTools] = useState<ToolData[]>([]);
  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);
  const [pluginsModalTab, setPluginsModalTab] = useState<'MCP' | 'Skills' | null>(null);

  const previousToolsRef = useRef<ToolData[]>([]);

  const handleUpdateTools = useCallback((newTools: ToolData[]) => {
    setTools(newTools);
    previousToolsRef.current = newTools;
  }, []);

  useEffect(() => {
    let cancelled = false;

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
            openai_base_url: storedSecrets.openai_base_url,
            model: storedSecrets.default_model,
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
  }, []);

  if (startupState === 'checking') {
    return <div className="app-loading">Preparing Data Agent...</div>;
  }

  if (startupState === 'onboarding') {
    return <Onboarding onComplete={() => setStartupState('ready')} />;
  }

  return (
    <LanguageProvider>
      <SessionProvider>
        <div className="app-container">
        <Sidebar
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenWorkspace={() => {}}
          onOpenPlugins={(tab) => setPluginsModalTab(tab)}
        />
        <ChatArea 
          onUpdateTools={handleUpdateTools} 
          onOpenToolPanel={() => setIsToolPanelOpen(true)}
        />
        {isToolPanelOpen && <ToolPanel tools={tools} onClose={() => setIsToolPanelOpen(false)} />}
        
        {!isToolPanelOpen && tools.length > 0 && (
          <div style={{ position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 50 }}>
            <button
              onClick={() => setIsToolPanelOpen(true)}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRight: 'none',
                padding: '12px 10px',
                borderRadius: '12px 0 0 12px',
                boxShadow: '-4px 0 12px rgba(0,0,0,0.05)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: '#6b7280',
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#f9fafb';
                e.currentTarget.style.color = '#3b82f6';
                e.currentTarget.style.paddingRight = '16px';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.color = '#6b7280';
                e.currentTarget.style.paddingRight = '10px';
              }}
              title="打开工具执行详情"
            >
              <Terminal size={18} />
            </button>
          </div>
        )}

        {isSettingsOpen && (
          <SettingsModal onClose={() => setIsSettingsOpen(false)} />
        )}
        
        {pluginsModalTab && (
          <PluginsModal initialTab={pluginsModalTab} onClose={() => setPluginsModalTab(null)} />
        )}
      </div>
      </SessionProvider>
    </LanguageProvider>
  );
};

export default App;

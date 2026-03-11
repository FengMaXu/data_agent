import React, { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ToolPanel, { type ToolData } from './components/ToolPanel';
import SettingsModal from './components/SettingsModal';
import { SessionProvider } from './hooks/useSession';

const App: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tools, setTools] = useState<ToolData[]>([]);
  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);

  const handleUpdateTools = useCallback((newTools: ToolData[]) => {
    setTools(newTools);
    if (newTools.length > 0) {
      setIsToolPanelOpen(true);
    }
  }, []);

  return (
    <SessionProvider>
      <div className="app-container">
        <Sidebar
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenWorkspace={() => {}}
        />
        <ChatArea onUpdateTools={handleUpdateTools} />
        {isToolPanelOpen && <ToolPanel tools={tools} onClose={() => setIsToolPanelOpen(false)} />}

        {isSettingsOpen && (
          <SettingsModal onClose={() => setIsSettingsOpen(false)} />
        )}
      </div>
    </SessionProvider>
  );
};

export default App;

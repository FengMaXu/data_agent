import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ToolPanel, { type ToolData } from './components/ToolPanel';
import SettingsModal from './components/SettingsModal';

const App: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tools, setTools] = useState<ToolData[]>([]);
  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);

  const handleUpdateTools = (newTools: ToolData[]) => {
    setTools(newTools);
    if (newTools.length > 0) {
      setIsToolPanelOpen(true);
    }
  };

  return (
    <div className="app-container">
      <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />
      <ChatArea onUpdateTools={handleUpdateTools} />
      {isToolPanelOpen && <ToolPanel tools={tools} onClose={() => setIsToolPanelOpen(false)} />}

      {isSettingsOpen && (
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />
      )}
    </div>
  );
};

export default App;

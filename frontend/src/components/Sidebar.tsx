import React from 'react';
import {
    MessageSquare,
    BookOpen,
    HardDrive,
    BarChart2,
    Settings
} from 'lucide-react';

interface SidebarProps {
    onOpenSettings: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings }) => {
    return (
        <nav className="sidebar">
            <div className="nav-menu scrollable-area">

                {/* Top Section */}
                <div className="nav-section">

                    {/* We keep the yourdb logo here, nicely integrated but taking user's original design intent */}
                    <div className="sidebar-logo" style={{
                        fontSize: '1.25rem',
                        fontWeight: 700,
                        padding: '0 12px 16px',
                        color: '#1f2937',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        letterSpacing: '-0.5px'
                    }}>
                        <img
                            src="/yourdb-logo.png"
                            alt="YourDB logo"
                            style={{ width: '28px', height: '28px', borderRadius: '6px', objectFit: 'contain' }}
                        />
                        YourDB
                    </div>

                    <button className="nav-item active">
                        <MessageSquare className="nav-item-icon" size={18} />
                        <span className="nav-item-text">Chat <span className="nav-item-zh">聊天</span></span>
                    </button>

                    <button className="nav-item">
                        <BookOpen className="nav-item-icon" size={18} />
                        <span className="nav-item-text">Knowledge <span className="nav-item-zh">知识</span></span>
                    </button>

                    <button className="nav-item">
                        <HardDrive className="nav-item-icon" size={18} />
                        <span className="nav-item-text">Workspace <span className="nav-item-zh">工作区</span></span>
                    </button>

                    <button className="nav-item">
                        <BarChart2 className="nav-item-icon" size={18} />
                        <span className="nav-item-text">Metrics <span className="nav-item-zh">指标</span></span>
                    </button>

                </div>
            </div>

            <div className="sidebar-footer">
                <button className="nav-item" onClick={onOpenSettings}>
                    <Settings className="nav-item-icon" size={18} />
                    <span className="nav-item-text">Settings <span className="nav-item-zh">设置</span></span>
                </button>
            </div>
        </nav>
    );
};

export default Sidebar;

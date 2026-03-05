import React, { useState } from 'react';
import {
    Settings as SettingsIcon, FolderOpen, Cpu, Server, Sparkles, X,
    Shield, ServerOff, Folder, FileText, ChevronDown, Search, Plus, Database,
    User, Key, Activity, Link, Eye, Check, ExternalLink, Loader2
} from 'lucide-react';
import { getConfig, updateLLMConfig, updateDBConfig, testDBConnection, type AIConfig } from '../api/client';
import { useEffect } from 'react';

interface SettingsModalProps {
    onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const [activeMenu, setActiveMenu] = useState('工作区');

    // States for sub-tabs
    const [modelProvider, setModelProvider] = useState('模型设置');
    const [mcpTab, setMcpTab] = useState('已安装');
    const [skillsTab, setSkillsTab] = useState('已安装');

    const menuItems = [
        { id: '工作区', icon: FolderOpen },
        { id: '模型', icon: Cpu },
        { id: '数据库', icon: Database },
        { id: 'MCP', icon: Server },
        { id: 'Skills', icon: Sparkles },
    ];

    const providers = [
        { id: 'MiniMax', label: 'M MiniMax' },
        { id: 'Google', label: 'G Google' },
        { id: 'Moonshot AI', label: 'M Moonshot AI' },
        { id: 'Anthropic', label: 'A Anthropic' },
        { id: 'DeepSeek', label: 'D DeepSeek' },
        { id: 'xAI', label: 'X xAI' },
        { id: 'Qwen', label: 'Q Qwen (阿里巴巴)' },
        { id: 'Z-AI', label: 'Z Z-AI / GLM (智谱AI)' },
        { id: 'OpenAI', label: 'O OpenAI' },
        { id: 'Meta', label: 'M Meta' },
    ];

    // Config states
    const [config, setConfig] = useState<AIConfig | null>(null);
    const [isSavingLLM, setIsSavingLLM] = useState(false);

    // DB states
    const [dbHost, setDbHost] = useState('localhost');
    const [dbPort, setDbPort] = useState(3306);
    const [dbUser, setDbUser] = useState('root');
    const [dbPassword, setDbPassword] = useState('');
    const [dbName, setDbName] = useState('my_database');
    const [isTestingDB, setIsTestingDB] = useState(false);
    const [isSavingDB, setIsSavingDB] = useState(false);
    const [dbTestResult, setDbTestResult] = useState<{ success: boolean, message: string } | null>(null);

    // Load config on mount
    useEffect(() => {
        getConfig().then(data => {
            setConfig(data);
            setDbHost(data.mysql_host || 'localhost');
            setDbPort(data.mysql_port || 3306);
            setDbUser(data.mysql_user || 'root');
            setDbName(data.mysql_database || '');
            // Do not prefill password for security
        }).catch(err => {
            console.error("Failed to load config:", err);
        });
    }, []);

    const handleSaveLLM = async () => {
        setIsSavingLLM(true);
        try {
            await updateLLMConfig({
                api_key: config?.openai_api_key,
                base_url: config?.openai_base_url,
                model: config?.default_model
            });
            alert('LLM 配置保存成功');
        } catch (e: any) {
            alert('LLM 配置保存失败: ' + e.message);
        } finally {
            setIsSavingLLM(false);
        }
    };

    const handleTestDB = async () => {
        setIsTestingDB(true);
        setDbTestResult(null);
        try {
            const res = await testDBConnection({
                host: dbHost,
                port: dbPort,
                user: dbUser,
                password: dbPassword,
                database: dbName
            });
            setDbTestResult(res);
        } catch (e: any) {
            setDbTestResult({ success: false, message: e.message || '测试连接期间发生错误' });
        } finally {
            setIsTestingDB(false);
        }
    };

    const handleSaveDB = async () => {
        setIsSavingDB(true);
        try {
            await updateDBConfig({
                host: dbHost,
                port: dbPort,
                user: dbUser,
                password: dbPassword,
                database: dbName
            });
            alert('数据库配置保存并应用成功');
            setDbTestResult(null);
        } catch (e: any) {
            alert('保存失败: ' + e.message);
        } finally {
            setIsSavingDB(false);
        }
    };

    return (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal-container" onMouseDown={(e) => e.stopPropagation()}>
                {/* Left Navigation */}
                <aside className="modal-sidebar">
                    <div className="modal-brand">
                        <img
                            src="/yourdb-logo.png"
                            alt="YourDB logo"
                            style={{ width: '24px', height: '24px', marginRight: '8px', borderRadius: '4px', objectFit: 'contain' }}
                        />
                        <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.5px' }}>YourDB</span>
                    </div>

                    <nav className="modal-nav">
                        {menuItems.map(item => (
                            <button
                                key={item.id}
                                className={`modal-nav-item ${activeMenu === item.id ? 'active' : ''}`}
                                onClick={() => setActiveMenu(item.id)}
                            >
                                <item.icon size={18} className="modal-nav-icon" />
                                <span>{item.id}</span>
                            </button>
                        ))}
                    </nav>
                </aside>

                {/* Right Content Area */}
                <div className="modal-content-area flex-1 flex flex-col">
                    {/* Header */}
                    <header className="modal-header">
                        <h2>{activeMenu}</h2>
                        <button className="modal-close-btn" onClick={onClose}>
                            <X size={20} />
                        </button>
                    </header>

                    {/* Dynamic Content */}
                    <div className="modal-body scrollable-area" style={{ padding: activeMenu === '模型' ? 0 : '32px', display: 'flex', flexDirection: 'column', flex: 1 }}>

                        {/* 工作区 (Workspace) */}
                        {activeMenu === '工作区' && (
                            <div className="settings-tab-content">
                                <h3 className="settings-section-title" style={{ fontSize: '1rem', color: '#6b7280', marginBottom: '24px', fontWeight: 500 }}>配置代码环境和工作目录</h3>

                                <h4 className="settings-section-title">默认沙盒</h4>
                                <p className="settings-section-desc">选择脚本执行时使用的沙盒环境</p>

                                <div className="sandbox-toggle-group">
                                    <div className="sandbox-card active">
                                        <Shield className="sandbox-icon" size={20} />
                                        <div>
                                            <div className="sandbox-title">Codex 沙盒</div>
                                            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>在沙盒环境中执行代码</div>
                                        </div>
                                    </div>

                                    <div className="sandbox-card">
                                        <ServerOff className="sandbox-icon" size={20} />
                                        <div>
                                            <div className="sandbox-title" style={{ color: '#1f2937' }}>本机执行</div>
                                            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>直接在主机运行，无隔离</div>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ marginBottom: '32px' }}>
                                    <h4 className="settings-section-title">工作目录</h4>
                                    <p className="settings-section-desc">所有会话输出和文件将保存在此目录中。每个对话会在 sessions/ 下创建一个子文件夹。</p>

                                    <div className="settings-input-wrapper">
                                        <input type="text" value="C:\Users\Negan\.workany" readOnly />
                                        <Folder className="settings-input-icon" size={18} />
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>结构: C:\Users\Negan\.workany/sessions/[task-id]/</div>
                                </div>

                                <div>
                                    <h4 className="settings-section-title">日志文件</h4>
                                    <p className="settings-section-desc">应用运行日志，用于调试和排查问题。</p>

                                    <div className="settings-input-wrapper">
                                        <input type="text" value="C:\Users\Negan\.workany\logs\workany.log" readOnly />
                                        <FileText className="settings-input-icon" size={18} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 模型 (Model) */}
                        {activeMenu === '模型' && (
                            <div style={{ display: 'flex', flex: 1, height: '100%' }}>
                                {/* Internal Sidebar for Model */}
                                <div style={{ width: '200px', borderRight: '1px solid #e5e7eb', padding: '16px' }}>
                                    <button
                                        className={`modal-nav-item ${modelProvider === '模型设置' ? 'active' : ''}`}
                                        onClick={() => setModelProvider('模型设置')}
                                        style={{ marginBottom: '16px' }}
                                    >
                                        <SettingsIcon size={16} className="modal-nav-icon" />
                                        <span>模型设置</span>
                                    </button>

                                    <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '8px', paddingLeft: '8px' }}>供应商</div>
                                    {providers.map(p => (
                                        <button
                                            key={p.id}
                                            className={`modal-nav-item ${modelProvider === p.id ? 'active' : ''}`}
                                            onClick={() => setModelProvider(p.id)}
                                            style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                                        >
                                            <span style={{ fontFamily: 'inherit', marginRight: '6px', opacity: 0.5 }}>{p.label.split(' ')[0]}</span>
                                            <span>{p.label.split(' ')[1]}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Model Content */}
                                <div style={{ flex: 1, padding: '24px' }}>
                                    {modelProvider === '模型设置' ? (
                                        <>
                                            <h3 className="settings-section-title" style={{ fontSize: '1rem', color: '#6b7280', marginBottom: '24px', fontWeight: 500 }}>配置默认模型和供应商</h3>

                                            <h4 className="settings-section-title" style={{ marginBottom: '2px' }}>默认模型</h4>
                                            <p className="settings-section-desc" style={{ fontSize: '0.8rem', marginBottom: '8px' }}>Agent 工作模型</p>

                                            <div className="settings-input-wrapper" style={{ padding: '8px 16px', cursor: 'pointer', background: '#fff', marginBottom: '8px' }}>
                                                <input
                                                    style={{ flex: 1, fontSize: '0.9rem', border: 'none', outline: 'none', background: 'transparent' }}
                                                    value={config?.default_model || ''}
                                                    onChange={e => setConfig(prev => prev ? { ...prev, default_model: e.target.value } : null)}
                                                    placeholder="输入默认模型名，如 deepseek-chat"
                                                />
                                                <ChevronDown size={16} className="settings-input-icon" />
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '16px' }}>从本地环境加载 Agent 运行配置</div>

                                            <button style={{ background: 'none', border: 'none', color: '#f04438', fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '32px' }}>
                                                <Plus size={16} /> 添加自定义模型
                                            </button>

                                            <h4 className="settings-section-title" style={{ marginBottom: '16px' }}>对话历史限制</h4>

                                            <div style={{ marginBottom: '24px' }}>
                                                <h4 className="settings-section-title" style={{ marginBottom: '4px', fontSize: '0.85rem' }}>最大对话轮次</h4>
                                                <p className="settings-section-desc" style={{ fontSize: '0.8rem', marginBottom: '8px' }}>保留的对话轮次数量（0 = 不限制）</p>
                                                <div className="settings-input-wrapper" style={{ background: '#fff' }}>
                                                    <input type="number" value="20" readOnly />
                                                </div>
                                            </div>

                                            <div>
                                                <h4 className="settings-section-title" style={{ marginBottom: '4px', fontSize: '0.85rem' }}>最大历史 Token 数</h4>
                                                <p className="settings-section-desc" style={{ fontSize: '0.8rem', marginBottom: '8px' }}>对话历史的最大 Token 数量（0 = 不限制）</p>
                                                <div className="settings-input-wrapper" style={{ background: '#fff' }}>
                                                    <input type="number" value="2000" readOnly />
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                            {/* Header */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid #f3f4f6', marginBottom: '24px' }}>
                                                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#1f2937' }}>{providers.find(p => p.id === modelProvider)?.label.split(' ')[1] || modelProvider}</h3>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#d1d5db' }}></div>
                                                    <span style={{ fontSize: '0.85rem', color: '#9ca3af', marginRight: '4px' }}>未配置</span>
                                                    {/* Custom Toggle Switch */}
                                                    <div style={{ width: '36px', height: '20px', backgroundColor: '#1f2937', borderRadius: '12px', position: 'relative', cursor: 'pointer' }}>
                                                        <div style={{ width: '16px', height: '16px', backgroundColor: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', right: '2px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}></div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* API Key */}
                                            <div style={{ marginBottom: '24px' }}>
                                                <h4 className="settings-section-title" style={{ fontSize: '0.9rem', marginBottom: '12px' }}>API 密钥</h4>
                                                <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
                                                    <input
                                                        type="password"
                                                        placeholder="输入您的 API 密钥"
                                                        style={{ fontSize: '0.95rem', width: '100%' }}
                                                        value={config?.openai_api_key || ''}
                                                        onChange={e => setConfig(prev => prev ? { ...prev, openai_api_key: e.target.value } : null)}
                                                    />
                                                    <Eye size={18} color="#9ca3af" style={{ cursor: 'pointer' }} />
                                                </div>
                                                <a href="#" style={{ fontSize: '0.8rem', color: '#f97316', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '12px' }}>
                                                    获取 API 密钥 <ExternalLink size={14} />
                                                </a>
                                            </div>

                                            {/* API Base URL */}
                                            <div style={{ marginBottom: '32px' }}>
                                                <h4 className="settings-section-title" style={{ fontSize: '0.9rem', marginBottom: '12px' }}>API Base URL</h4>
                                                <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb' }}>
                                                    <input
                                                        type="text"
                                                        style={{ fontSize: '0.95rem', width: '100%' }}
                                                        value={config?.openai_base_url || ''}
                                                        onChange={e => setConfig(prev => prev ? { ...prev, openai_base_url: e.target.value } : null)}
                                                        placeholder="例如: https://api.openai.com/v1"
                                                    />
                                                </div>
                                            </div>

                                            {/* Models */}
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                    <h4 className="settings-section-title" style={{ fontSize: '0.9rem', margin: 0 }}>模型</h4>
                                                    <button style={{ background: 'none', border: 'none', color: '#f97316', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Plus size={14} /> 添加模型
                                                    </button>
                                                </div>

                                                <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <Check size={16} color="#10b981" />
                                                        <span style={{ fontSize: '0.95rem', color: '#1f2937' }}>{modelProvider === 'MiniMax' ? 'MiniMax-M2.1' : `${modelProvider}-Default`}</span>
                                                    </div>
                                                    <button style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div style={{ flex: 1 }} />
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '32px', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
                                                <button
                                                    onClick={handleSaveLLM}
                                                    disabled={isSavingLLM}
                                                    style={{
                                                        padding: '10px 24px', background: '#1f2937', color: '#fff', border: 'none',
                                                        borderRadius: '8px', fontWeight: 600, cursor: isSavingLLM ? 'not-allowed' : 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: '8px'
                                                    }}
                                                >
                                                    {isSavingLLM ? <Loader2 size={16} className="animate-spin" /> : null}
                                                    保存模型配置
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 数据库 (Database) */}
                        {activeMenu === '数据库' && (
                            <div className="settings-tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #f3f4f6', flex: 1 }}>

                                    {/* Row 1 */}
                                    <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>
                                                <Server size={18} />
                                                <span>主机地址</span>
                                            </div>
                                            <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '14px 16px' }}>
                                                <input type="text" placeholder="localhost" value={dbHost} onChange={e => setDbHost(e.target.value)} style={{ fontSize: '0.95rem' }} />
                                            </div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>
                                                <Activity size={18} />
                                                <span>端口</span>
                                            </div>
                                            <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '14px 16px' }}>
                                                <input type="number" placeholder="3306" value={dbPort} onChange={e => setDbPort(parseInt(e.target.value) || 3306)} style={{ fontSize: '0.95rem' }} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Row 2 */}
                                    <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>
                                                <User size={18} />
                                                <span>用户名</span>
                                            </div>
                                            <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '14px 16px' }}>
                                                <input type="text" placeholder="root" value={dbUser} onChange={e => setDbUser(e.target.value)} style={{ fontSize: '0.95rem' }} />
                                            </div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>
                                                <Key size={18} />
                                                <span>密码</span>
                                            </div>
                                            <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '14px 16px', background: '#eef2ff' }}>
                                                <input type="password" placeholder="••••••••" value={dbPassword} onChange={e => setDbPassword(e.target.value)} style={{ fontSize: '0.95rem' }} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Row 3 */}
                                    <div style={{ marginBottom: '32px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>
                                            <Link size={18} />
                                            <span>数据库名称</span>
                                        </div>
                                        <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '14px 16px', border: '2px solid #a5b4fc', outline: '4px solid #eef2ff' }}>
                                            <input type="text" placeholder="my_database" value={dbName} onChange={e => setDbName(e.target.value)} style={{ fontSize: '0.95rem' }} />
                                        </div>
                                    </div>

                                    {/* Test Result Alert */}
                                    {dbTestResult && (
                                        <div style={{ padding: '16px', borderRadius: '8px', background: dbTestResult.success ? '#ecfdf5' : '#fef2f2', border: `1px solid ${dbTestResult.success ? '#6ee7b7' : '#fca5a5'}`, color: dbTestResult.success ? '#065f46' : '#991b1b', marginBottom: '24px' }}>
                                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>{dbTestResult.success ? '✓ 测试成功' : '✗ 测试失败'}</div>
                                            <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{dbTestResult.message}</div>
                                        </div>
                                    )}

                                    {/* Buttons at bottom right */}
                                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end', marginTop: '48px', paddingTop: '24px', borderTop: '1px solid #f3f4f6' }}>
                                        <button
                                            onClick={handleTestDB}
                                            disabled={isTestingDB}
                                            style={{ width: '180px', padding: '12px 24px', background: '#f3f4f6', color: '#1f2937', border: '1px solid #e5e7eb', borderRadius: '8px', fontWeight: 600, cursor: isTestingDB ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                            {isTestingDB ? <Loader2 size={16} className="animate-spin" /> : null}
                                            测试连接
                                        </button>
                                        <button
                                            onClick={handleSaveDB}
                                            disabled={isSavingDB}
                                            style={{ width: '180px', padding: '12px 24px', background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: isSavingDB ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                            {isSavingDB ? <Loader2 size={16} className="animate-spin" /> : null}
                                            保存配置
                                        </button>
                                    </div>

                                </div>
                            </div>
                        )}

                        {/* MCP */}
                        {activeMenu === 'MCP' && (
                            <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                                <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '24px', gap: '24px' }}>
                                    <button
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: mcpTab === '已安装' ? 600 : 400, color: mcpTab === '已安装' ? '#1f2937' : '#6b7280', borderBottom: mcpTab === '已安装' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setMcpTab('已安装')}
                                    >
                                        已安装
                                    </button>
                                    <button
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: mcpTab === '设置' ? 600 : 400, color: mcpTab === '设置' ? '#1f2937' : '#6b7280', borderBottom: mcpTab === '设置' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setMcpTab('设置')}
                                    >
                                        设置
                                    </button>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '64px' }}>
                                    <div className="settings-input-wrapper" style={{ background: '#fff', width: '300px', margin: 0, padding: '8px 16px', borderRadius: '8px' }}>
                                        <Search size={16} color="#9ca3af" style={{ marginRight: '8px' }} />
                                        <input placeholder="搜索 MCP 服务器" style={{ fontSize: '0.85rem' }} />
                                    </div>
                                    <button style={{ background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <Plus size={16} /> 添加 <ChevronDown size={16} />
                                    </button>
                                </div>

                                <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '64px' }}>
                                    暂无 MCP 服务器配置
                                </div>
                            </div>
                        )}

                        {/* Skills */}
                        {activeMenu === 'Skills' && (
                            <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                                <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '24px', gap: '24px' }}>
                                    <button
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: skillsTab === '已安装' ? 600 : 400, color: skillsTab === '已安装' ? '#1f2937' : '#6b7280', borderBottom: skillsTab === '已安装' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setSkillsTab('已安装')}
                                    >
                                        已安装
                                    </button>
                                    <button
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: skillsTab === '设置' ? 600 : 400, color: skillsTab === '设置' ? '#1f2937' : '#6b7280', borderBottom: skillsTab === '设置' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setSkillsTab('设置')}
                                    >
                                        设置
                                    </button>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '64px' }}>
                                    <div className="settings-input-wrapper" style={{ background: '#fff', width: '300px', margin: 0, padding: '8px 16px', borderRadius: '8px' }}>
                                        <Search size={16} color="#9ca3af" style={{ marginRight: '8px' }} />
                                        <input placeholder="搜索 Skill" style={{ fontSize: '0.85rem' }} />
                                    </div>
                                    <button style={{ background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <Plus size={16} /> 添加 <ChevronDown size={16} />
                                    </button>
                                </div>

                                <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '64px' }}>
                                    暂无 Skills
                                </div>
                            </div>
                        )}

                        {!['工作区', '模型', '数据库', 'MCP', 'Skills'].includes(activeMenu) && (
                            <div>
                                <p>Content for {activeMenu} is under construction...</p>
                            </div>
                        )}

                    </div>
                </div>
            </div>
        </div >
    );
};

export default SettingsModal;

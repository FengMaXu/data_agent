import React, { useEffect, useState } from 'react';
import {
    Settings as SettingsIcon, FolderOpen, Cpu, Server, Sparkles, X,
    Shield, ServerOff, Folder, FileText, Search, Database, Plus,
    User, Key, Activity, Link, Eye, ExternalLink, Loader2, RefreshCw
} from 'lucide-react';
import {
    getConfig,
    updateLLMConfig,
    updateDBConfig,
    testDBConnection,
    getMCPConfig,
    saveMCPConfig,
    getMCPServers,
    getMCPTools,
    testMCPServer,
    getSkills,
    type AIConfig,
    type MCPConfig,
    type MCPServerConfig,
    type MCPServerStatus,
    type MCPToolInfo,
    type MCPTestResult,
    type SkillInfo,
} from '../api/client';

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

    const PROVIDER_REGISTRY: Record<string, { label: string; letter: string; baseUrl: string; models: string[]; apiKeyUrl: string }> = {
        'DeepSeek':    { letter: 'D', label: 'DeepSeek',               baseUrl: 'https://api.deepseek.com',                   models: ['deepseek-chat', 'deepseek-reasoner'],                                                              apiKeyUrl: 'https://platform.deepseek.com/api_keys' },
        'OpenAI':      { letter: 'O', label: 'OpenAI',                 baseUrl: 'https://api.openai.com/v1',                  models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],                               apiKeyUrl: 'https://platform.openai.com/api-keys' },
        'Anthropic':   { letter: 'A', label: 'Anthropic',              baseUrl: 'https://api.anthropic.com/v1',               models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],                   apiKeyUrl: 'https://console.anthropic.com/settings/keys' },
        'Google':      { letter: 'G', label: 'Google',                 baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],                                     apiKeyUrl: 'https://aistudio.google.com/apikey' },
        'Qwen':        { letter: 'Q', label: 'Qwen (阿里巴巴)',        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],                                         apiKeyUrl: 'https://bailian.console.aliyun.com/' },
        'Z-AI':        { letter: 'Z', label: 'Z-AI / GLM (智谱AI)',    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',       models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-4'],                                               apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
        'Moonshot AI': { letter: 'M', label: 'Moonshot AI',            baseUrl: 'https://api.moonshot.cn/v1',                 models: ['moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],                                           apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys' },
        'MiniMax':     { letter: 'M', label: 'MiniMax',                baseUrl: 'https://api.minimax.chat/v1',                models: ['MiniMax-M1', 'abab6.5s-chat', 'abab5.5-chat'],                                                     apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key' },
        'xAI':         { letter: 'X', label: 'xAI',                    baseUrl: 'https://api.x.ai/v1',                       models: ['grok-3', 'grok-3-mini', 'grok-2'],                                                                 apiKeyUrl: 'https://console.x.ai/' },
        'SiliconFlow': { letter: 'S', label: 'SiliconFlow (硅基流动)',  baseUrl: 'https://api.siliconflow.cn/v1',              models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'],                      apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak' },
    };
    const providerIds = Object.keys(PROVIDER_REGISTRY);

    // Detect which provider is active based on current base_url
    const detectActiveProvider = (baseUrl: string | undefined): string | null => {
        if (!baseUrl) return null;
        for (const [id, reg] of Object.entries(PROVIDER_REGISTRY)) {
            if (baseUrl.startsWith(reg.baseUrl) || reg.baseUrl.startsWith(baseUrl)) return id;
        }
        return null;
    };

    const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

    // Provide an array from the registry for easy mapping
    const providers = providerIds.map(id => ({ id, ...PROVIDER_REGISTRY[id] }));

    type ProviderConfig = {
        apiKey: string;
        baseUrl: string;
        models: string[]; // Built-in + custom
        selectedModel: string;
        enabled: boolean;
    };

    // Keep independent config for each provider
    const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>(() => {
        const initial: Record<string, ProviderConfig> = {};
        for (const [id, reg] of Object.entries(PROVIDER_REGISTRY)) {
            // Load from localStorage if present to remember user inputs when switching tabs
            const saved = localStorage.getItem(`provider_config_${id}`);
            if (saved) {
                try {
                    initial[id] = JSON.parse(saved);
                    // Ensure models array exists
                    if (!initial[id].models) {
                        initial[id].models = [...reg.models];
                    }
                    continue;
                } catch (e) { }
            }
            initial[id] = {
                apiKey: '',
                baseUrl: reg.baseUrl,
                models: [...reg.models],
                selectedModel: reg.models[0],
                enabled: false
            };
        }
        return initial;
    });

    // Save individual provider config to localStorage when it changes
    const updateProviderConfig = (id: string, updates: Partial<ProviderConfig>) => {
        setProviderConfigs(prev => {
            const next = { ...prev, [id]: { ...prev[id], ...updates } };
            localStorage.setItem(`provider_config_${id}`, JSON.stringify(next[id]));
            return next;
        });
    };

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

    // MCP states
    const [mcpConfig, setMcpConfig] = useState<MCPConfig>({ servers: [] });
    const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);
    const [mcpTools, setMcpTools] = useState<MCPToolInfo[]>([]);
    const [selectedMcpServer, setSelectedMcpServer] = useState<number | null>(null);
    const [isLoadingMCP, setIsLoadingMCP] = useState(false);
    const [isSavingMCP, setIsSavingMCP] = useState(false);
    const [isTestingMCP, setIsTestingMCP] = useState(false);
    const [mcpTestResult, setMcpTestResult] = useState<MCPTestResult | null>(null);
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [isLoadingSkills, setIsLoadingSkills] = useState(false);

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const initialConfig = await getConfig();
                setConfig(initialConfig);
                setDbHost(initialConfig.mysql_host || 'localhost');
                setDbPort(initialConfig.mysql_port || 3306);
                setDbUser(initialConfig.mysql_user || 'root');
                setDbName(initialConfig.mysql_database || '');

                // Determine active provider
                const activeId = detectActiveProvider(initialConfig.openai_base_url);
                if (activeId) {
                    setProviderConfigs(prev => {
                        const next = { ...prev };
                        const pConfig = { ...next[activeId] };
                        pConfig.enabled = true;
                        pConfig.baseUrl = initialConfig.openai_base_url || pConfig.baseUrl;
                        
                        // Just check if we have a key configured, we can't get the actual key from backend
                        if (initialConfig.openai_api_key === '[configured]') {
                             // Keep what's in local storage if we have one, otherwise it's just a placeholder placeholder
                             if (!pConfig.apiKey) pConfig.apiKey = '[configured_in_backend]';
                        }
                        
                        // Handle custom model if it's not in the list
                        if (initialConfig.default_model) {
                            pConfig.selectedModel = initialConfig.default_model;
                            if (!pConfig.models.includes(initialConfig.default_model)) {
                                pConfig.models = [...pConfig.models, initialConfig.default_model];
                            }
                        }
                        next[activeId] = pConfig;
                        localStorage.setItem(`provider_config_${activeId}`, JSON.stringify(pConfig));
                        return next;
                    });
                }

            } catch (err) {
                console.error('Failed to load settings config:', err);
            }
        };

        void loadInitialData();
        void loadMCPData();
        void loadSkills();
    }, []);

    const emptyMcpServer = (): MCPServerConfig => ({
        name: '',
        transport: 'stdio',
        enabled: true,
        command: 'python',
        script: '',
        url: '',
        description: '',
        tool_prefix: '',
        server_type: 'service',
        tags: [],
        headers: { configured: false, count: 0 },
        env: { configured: false, count: 0 },
        env_input: '',
        headers_input: '',
    });

    const loadMCPData = async () => {
        setIsLoadingMCP(true);
        try {
            const [configRes, serversRes, toolsRes] = await Promise.all([
                getMCPConfig(),
                getMCPServers(),
                getMCPTools(),
            ]);
            setMcpConfig(configRes);
            setMcpServers(serversRes.servers || []);
            setMcpTools(toolsRes.tools || []);
            setSelectedMcpServer(prev => {
                if ((configRes.servers || []).length === 0) return null;
                if (prev === null || prev >= configRes.servers.length) return 0;
                return prev;
            });
        } catch (err) {
            console.error('Failed to load MCP config:', err);
        } finally {
            setIsLoadingMCP(false);
        }
    };

    const updateMcpServerField = (index: number, field: keyof MCPServerConfig, value: any) => {
        setMcpConfig(prev => ({
            ...prev,
            servers: prev.servers.map((server, i) => i === index ? { ...server, [field]: value } : server),
        }));
    };

    const addMcpServer = () => {
        setMcpConfig(prev => ({ ...prev, servers: [...prev.servers, emptyMcpServer()] }));
        setSelectedMcpServer(mcpConfig.servers.length);
        setMcpTab('设置');
    };

    const removeMcpServer = (index: number) => {
        setMcpConfig(prev => ({
            ...prev,
            servers: prev.servers.filter((_, i) => i !== index),
        }));
        setSelectedMcpServer(prev => {
            if (prev === null) return null;
            if (prev === index) return null;
            if (prev > index) return prev - 1;
            return prev;
        });
    };

    const handleSaveMCP = async () => {
        setIsSavingMCP(true);
        try {
            const payload = {
                servers: mcpConfig.servers.map(server => {
                    const srv: any = {
                        name: server.name,
                        transport: server.transport,
                        enabled: server.enabled,
                        command: server.command || '',
                        script: server.script || '',
                        url: server.url || '',
                        description: server.description || '',
                        tool_prefix: server.tool_prefix || '',
                        server_type: server.server_type || 'service',
                        tags: server.tags || [],
                    };
                    
                    if (server.env_input?.trim()) {
                        srv.env = JSON.parse(server.env_input);
                    }
                    if (server.headers_input?.trim()) {
                        srv.headers = JSON.parse(server.headers_input);
                    }
                    return srv;
                }),
            };
            await saveMCPConfig(payload);
            await loadMCPData();
            alert('MCP 配置保存成功');
        } catch (e: any) {
            alert('MCP 配置保存失败: ' + (e instanceof SyntaxError ? '环境变量或请求头 JSON 格式错误' : e.message));
        } finally {
            setIsSavingMCP(false);
        }
    };

    const handleTestMCP = async () => {
        if (selectedMcpServer === null) return;
        const server = mcpConfig.servers[selectedMcpServer];
        setIsTestingMCP(true);
        setMcpTestResult(null);
        try {
            const result = await testMCPServer({
                name: server.name,
                transport: server.transport,
                enabled: server.enabled,
                command: server.command || '',
                script: server.script || '',
                url: server.url || '',
                description: server.description || '',
                tool_prefix: server.tool_prefix || '',
                server_type: server.server_type || 'service',
                tags: server.tags || [],
            });
            setMcpTestResult(result);
            await loadMCPData();
        } catch (e: any) {
            setMcpTestResult({ success: false, message: e.message || '测试 MCP 失败' });
        } finally {
            setIsTestingMCP(false);
        }
    };
    const loadSkills = async () => {
        setIsLoadingSkills(true);
        try {
            const result = await getSkills();
            setSkills(result.skills || []);
        } catch (err) {
            console.error('Failed to load skills:', err);
            setSkills([]);
        } finally {
            setIsLoadingSkills(false);
        }
    };

    const toggleProvider = async (providerId: string) => {
        const configToSave = providerConfigs[providerId];
        const isTurningOn = !configToSave.enabled;

        // Optimistically update UI
        setProviderConfigs(prev => {
            const next = { ...prev };
            // Turn off all others
            for (const id of Object.keys(next)) {
                if (id === providerId) {
                    next[id] = { ...next[id], enabled: isTurningOn };
                } else {
                    next[id] = { ...next[id], enabled: false };
                }
            }
            return next;
        });

        if (isTurningOn) {
            setIsSavingLLM(true);
            setSaveFeedback(null);
            try {
                // If API key is the placeholder, send empty string to not overwrite with literal '[configured]'
                // The backend ignores empty API keys during update
                const apikeyToSend = (configToSave.apiKey && !configToSave.apiKey.startsWith('[')) 
                    ? configToSave.apiKey : '';
                    
                await updateLLMConfig({ 
                    api_key: apikeyToSend, 
                    base_url: configToSave.baseUrl, 
                    model: configToSave.selectedModel 
                });
                
                // Update top-level config to reflect changes
                setConfig(prev => prev ? { 
                    ...prev, 
                    openai_base_url: configToSave.baseUrl, 
                    default_model: configToSave.selectedModel,
                    openai_api_key: apikeyToSend ? '[configured]' : prev.openai_api_key
                } : null);
                
                setSaveFeedback('✓ 已启用并保存');
                setTimeout(() => setSaveFeedback(null), 2000);
            } catch (e: any) {
                setSaveFeedback('✗ 保存失败: ' + e.message);
                // Revert toggle on failure
                setProviderConfigs(prev => ({
                    ...prev,
                    [providerId]: { ...prev[providerId], enabled: false }
                }));
            } finally {
                setIsSavingLLM(false);
            }
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
                                            <span style={{ fontFamily: 'inherit' }}>{p.label}</span>
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

                                            <div className="settings-input-wrapper" style={{ padding: '8px 16px', cursor: 'not-allowed', background: '#f9fafb', marginBottom: '8px' }}>
                                                <input
                                                    style={{ flex: 1, fontSize: '0.9rem', border: 'none', outline: 'none', background: 'transparent', cursor: 'not-allowed', color: '#6b7280' }}
                                                    value={config?.default_model || ''}
                                                    readOnly
                                                    placeholder="未设置"
                                                />
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '32px' }}>
                                                提示：要更改工作模型，请在左侧选择对应的供应商，然后开启供应商并选择所需模型。
                                            </div>

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
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#1f2937', margin: 0 }}>
                                                        {providers.find(p => p.id === modelProvider)?.label || modelProvider}
                                                    </h3>
                                                    {saveFeedback && providerConfigs[modelProvider]?.enabled && (
                                                        <span style={{ fontSize: '0.8rem', color: saveFeedback.includes('败') ? '#ef4444' : '#10b981', marginLeft: '8px' }}>
                                                            {saveFeedback}
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: providerConfigs[modelProvider]?.enabled ? '#10b981' : '#d1d5db' }}></div>
                                                    <span style={{ fontSize: '0.85rem', color: providerConfigs[modelProvider]?.enabled ? '#10b981' : '#9ca3af', marginRight: '4px' }}>
                                                        {providerConfigs[modelProvider]?.enabled ? '已启用 (当前工作平台)' : '已停用'}
                                                    </span>
                                                    {/* Custom Toggle Switch */}
                                                    <div 
                                                        onClick={() => toggleProvider(modelProvider)}
                                                        style={{ 
                                                            width: '36px', 
                                                            height: '20px', 
                                                            backgroundColor: providerConfigs[modelProvider]?.enabled ? '#10b981' : '#d1d5db', 
                                                            borderRadius: '12px', 
                                                            position: 'relative', 
                                                            cursor: isSavingLLM ? 'not-allowed' : 'pointer',
                                                            transition: 'background-color 0.2s'
                                                        }}
                                                    >
                                                        <div style={{ 
                                                            width: '16px', 
                                                            height: '16px', 
                                                            backgroundColor: '#fff', 
                                                            borderRadius: '50%', 
                                                            position: 'absolute', 
                                                            top: '2px', 
                                                            left: providerConfigs[modelProvider]?.enabled ? '18px' : '2px', 
                                                            boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                                            transition: 'left 0.2s'
                                                        }}></div>
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
                                                        value={providerConfigs[modelProvider]?.apiKey || ''}
                                                        onChange={e => updateProviderConfig(modelProvider, { apiKey: e.target.value })}
                                                    />
                                                    <Eye size={18} color="#9ca3af" style={{ cursor: 'pointer' }} />
                                                </div>
                                                <a href={providers.find(p => p.id === modelProvider)?.apiKeyUrl || '#'} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: '#f97316', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '12px' }}>
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
                                                        value={providerConfigs[modelProvider]?.baseUrl || ''}
                                                        onChange={e => updateProviderConfig(modelProvider, { baseUrl: e.target.value })}
                                                        placeholder="例如: https://api.openai.com/v1"
                                                    />
                                                </div>
                                            </div>

                                            {/* Model */}
                                            <div style={{ marginBottom: '24px' }}>
                                                <h4 className="settings-section-title" style={{ fontSize: '0.9rem', marginBottom: '12px' }}>模型名称</h4>
                                                <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb' }}>
                                                    <input
                                                        type="text"
                                                        style={{ fontSize: '0.95rem', width: '100%' }}
                                                        value={providerConfigs[modelProvider]?.selectedModel || ''}
                                                        onChange={e => updateProviderConfig(modelProvider, { selectedModel: e.target.value })}
                                                        placeholder="例如: deepseek-chat"
                                                    />
                                                </div>
                                            </div>

                                            <div style={{ flex: 1 }} />
                                            <div style={{ marginTop: '24px', fontSize: '0.85rem', color: '#6b7280', display: 'flex', alignItems: 'flex-start', gap: '8px', background: '#f9fafb', padding: '12px', borderRadius: '8px' }}>
                                                <SettingsIcon size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                <span>配置保存在浏览器本地。开启右上角开关后，系统会自动保存并热重载后端服务，使用该提供商的选中模型处理请求。</span>
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

                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center' }}>
                                    <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                                        管理 MCP Server 配置、连接状态与桥接工具。
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button
                                            onClick={loadMCPData}
                                            disabled={isLoadingMCP}
                                            style={{ background: '#fff', color: '#1f2937', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px', cursor: isLoadingMCP ? 'not-allowed' : 'pointer' }}
                                        >
                                            {isLoadingMCP ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                            刷新
                                        </button>
                                        <button onClick={addMcpServer} style={{ background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <Plus size={16} /> 添加
                                        </button>
                                    </div>
                                </div>

                                {mcpTab === '已安装' && (
                                    <div style={{ display: 'grid', gap: '16px' }}>
                                        {mcpServers.length === 0 && (
                                            <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '64px' }}>暂无 MCP 服务器配置</div>
                                        )}
                                        {mcpServers.map((server, index) => {
                                            const toolCount = mcpTools.filter(tool => tool.server === server.name).length;
                                            return (
                                                <div key={`${server.name}-${index}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 18px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                                                        <div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                                <span style={{ fontWeight: 600, color: '#111827' }}>{server.name}</span>
                                                                <span style={{ fontSize: '0.75rem', color: server.connected ? '#059669' : '#b45309', background: server.connected ? '#ecfdf5' : '#fffbeb', padding: '2px 8px', borderRadius: '999px' }}>
                                                                    {server.connected ? '已连接' : '未连接'}
                                                                </span>
                                                                {!server.enabled && (
                                                                    <span style={{ fontSize: '0.75rem', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: '999px' }}>已禁用</span>
                                                                )}
                                                            </div>
                                                            <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '4px' }}>{server.description || '暂无描述'}</div>
                                                            <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                                                                transport: {server.transport} · type: {server.server_type || 'service'} · tools: {toolCount}
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                const targetIndex = mcpConfig.servers.findIndex(item => item.name === server.name);
                                                                setSelectedMcpServer(targetIndex >= 0 ? targetIndex : index);
                                                                setMcpTab('设置');
                                                            }}
                                                            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', color: '#374151' }}
                                                        >
                                                            编辑
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {mcpTab === '设置' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '24px', flex: 1 }}>
                                        <div style={{ display: 'grid', gap: '12px', alignContent: 'start' }}>
                                            {mcpConfig.servers.length === 0 && (
                                                <div style={{ background: '#fff', border: '1px dashed #d1d5db', borderRadius: '12px', padding: '18px', color: '#6b7280', textAlign: 'center' }}>
                                                    还没有 MCP server，点击右上角“添加”。
                                                </div>
                                            )}
                                            {mcpConfig.servers.map((server, index) => (
                                                <button
                                                    key={`${server.name || 'new'}-${index}`}
                                                    onClick={() => setSelectedMcpServer(index)}
                                                    style={{
                                                        textAlign: 'left',
                                                        background: selectedMcpServer === index ? '#eef2ff' : '#fff',
                                                        border: selectedMcpServer === index ? '1px solid #a5b4fc' : '1px solid #e5e7eb',
                                                        borderRadius: '12px',
                                                        padding: '14px',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <div style={{ fontWeight: 600, color: '#111827', marginBottom: '4px' }}>{server.name || '未命名 server'}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{server.transport} · {server.server_type || 'service'}</div>
                                                </button>
                                            ))}
                                        </div>

                                        <div>
                                            {selectedMcpServer === null || !mcpConfig.servers[selectedMcpServer] ? (
                                                <div style={{ background: '#fff', border: '1px dashed #d1d5db', borderRadius: '12px', padding: '24px', color: '#6b7280' }}>
                                                    请选择左侧的 MCP server 进行编辑。
                                                </div>
                                            ) : (
                                                <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', border: '1px solid #f3f4f6' }}>
                                                    <div style={{ marginBottom: '24px' }}>
                                                        <h4 className="settings-section-title" style={{ marginBottom: '4px' }}>MCP Server 设置</h4>
                                                        <p className="settings-section-desc">支持 stdio / http / sse 配置。当前前端优先接 stdio 主链路。</p>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                                        {/* Name & Transport */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>名称 (Name) <span style={{ color: '#ef4444' }}>*</span></div>
                                                                <div className="settings-input-wrapper" style={{ margin: 0 }}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].name || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'name', e.target.value)} placeholder="如: my-database" style={{ width: '100%', border: 'none', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>Transport</div>
                                                                <div className="settings-input-wrapper" style={{ margin: 0 }}>
                                                                    <select value={mcpConfig.servers[selectedMcpServer].transport} onChange={e => updateMcpServerField(selectedMcpServer, 'transport', e.target.value as MCPServerConfig['transport'])} style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }}>
                                                                        <option value="stdio">stdio</option>
                                                                        <option value="http">http</option>
                                                                        <option value="sse">sse</option>
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Command & Script */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>Command</div>
                                                                <div className="settings-input-wrapper" style={{ margin: 0 }}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].command || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'command', e.target.value)} placeholder="python / npx" style={{ width: '100%', border: 'none', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? 'Script Args' : 'URL'}</div>
                                                                <div className="settings-input-wrapper" style={{ margin: 0 }}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? (mcpConfig.servers[selectedMcpServer].script || '') : (mcpConfig.servers[selectedMcpServer].url || '')} onChange={e => updateMcpServerField(selectedMcpServer, mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? 'script' : 'url', e.target.value)} placeholder={mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? 'server.py' : 'https://...'} style={{ width: '100%', border: 'none', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Env & Headers */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151', display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span>环境变量 (env)</span>
                                                                    {mcpConfig.servers[selectedMcpServer].env?.configured && <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 400 }}>已配置 ({mcpConfig.servers[selectedMcpServer].env?.count})</span>}
                                                                </div>
                                                                <textarea 
                                                                    className="settings-input-wrapper" 
                                                                    style={{ margin: 0, width: '100%', minHeight: '80px', padding: '12px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }} 
                                                                    value={mcpConfig.servers[selectedMcpServer].env_input ?? ''} 
                                                                    onChange={e => updateMcpServerField(selectedMcpServer, 'env_input', e.target.value)} 
                                                                    placeholder='{"KEY": "value"}' 
                                                                />
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151', display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span>请求头 (headers)</span>
                                                                    {mcpConfig.servers[selectedMcpServer].headers?.configured && <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 400 }}>已配置 ({mcpConfig.servers[selectedMcpServer].headers?.count})</span>}
                                                                </div>
                                                                <textarea 
                                                                    className="settings-input-wrapper" 
                                                                    style={{ margin: 0, width: '100%', minHeight: '80px', padding: '12px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }} 
                                                                    value={mcpConfig.servers[selectedMcpServer].headers_input ?? ''} 
                                                                    onChange={e => updateMcpServerField(selectedMcpServer, 'headers_input', e.target.value)} 
                                                                    placeholder='{"Authorization": "Bearer..."}' 
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* prefix and type */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>Tool Prefix</div>
                                                                <div className="settings-input-wrapper" style={{ margin: 0 }}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].tool_prefix || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'tool_prefix', e.target.value)} placeholder="如: db_" style={{ width: '100%', border: 'none', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>Server Type</div>
                                                                <div className="settings-input-wrapper" style={{ margin: 0 }}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].server_type || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'server_type', e.target.value)} placeholder="如: service / database" style={{ width: '100%', border: 'none', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Description */}
                                                        <div>
                                                            <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>简介描述 (Description)</div>
                                                            <div className="settings-input-wrapper" style={{ margin: 0 }}>
                                                                <input value={mcpConfig.servers[selectedMcpServer].description || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'description', e.target.value)} placeholder="用途说明" style={{ width: '100%', border: 'none', outline: 'none' }} />
                                                            </div>
                                                        </div>

                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '16px', borderTop: '1px solid #f3f4f6' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#374151', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 500 }}>
                                                                <input type="checkbox" checked={mcpConfig.servers[selectedMcpServer].enabled} onChange={e => updateMcpServerField(selectedMcpServer, 'enabled', e.target.checked)} style={{ width: '16px', height: '16px' }} />
                                                                启用该 MCP Server
                                                            </label>
                                                            <button 
                                                                onClick={() => removeMcpServer(selectedMcpServer)} 
                                                                style={{ background: '#fff0f2', border: '1px solid #ffccd5', color: '#e11d48', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}
                                                            >
                                                                删除配置
                                                            </button>
                                                        </div>
                                                    </div>

                                                        {mcpTestResult && (
                                                            <div style={{ padding: '16px', borderRadius: '8px', background: mcpTestResult.success ? '#ecfdf5' : '#fef2f2', border: `1px solid ${mcpTestResult.success ? '#6ee7b7' : '#fca5a5'}`, color: mcpTestResult.success ? '#065f46' : '#991b1b' }}>
                                                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>{mcpTestResult.success ? '✓ 测试成功' : '✗ 测试失败'}</div>
                                                                <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{mcpTestResult.message}</div>
                                                                {mcpTestResult.tools && mcpTestResult.tools.length > 0 && (
                                                                    <div style={{ marginTop: '8px', fontSize: '0.85rem' }}>发现工具: {mcpTestResult.tools.map(tool => tool.name).join(', ')}</div>
                                                                )}
                                                            </div>
                                                        )}

                                                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end', marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #f3f4f6' }}>
                                                        <button onClick={handleTestMCP} disabled={isTestingMCP} style={{ width: '180px', padding: '12px 24px', background: '#f3f4f6', color: '#1f2937', border: '1px solid #e5e7eb', borderRadius: '8px', fontWeight: 600, cursor: isTestingMCP ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                                            {isTestingMCP ? <Loader2 size={16} className="animate-spin" /> : null}
                                                            测试 MCP
                                                        </button>
                                                        <button onClick={handleSaveMCP} disabled={isSavingMCP} style={{ width: '180px', padding: '12px 24px', background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: isSavingMCP ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                                            {isSavingMCP ? <Loader2 size={16} className="animate-spin" /> : null}
                                                            保存配置
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
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

                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                                    <div className="settings-input-wrapper" style={{ background: '#fff', width: '300px', margin: 0, padding: '8px 16px', borderRadius: '8px' }}>
                                        <Search size={16} color="#9ca3af" style={{ marginRight: '8px' }} />
                                        <input placeholder="搜索 Skill" style={{ fontSize: '0.85rem' }} />
                                    </div>
                                    <button onClick={loadSkills} style={{ background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <RefreshCw size={16} /> 刷新 Skills
                                    </button>
                                </div>

                                {isLoadingSkills ? (
                                    <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '64px' }}>正在加载 Skills...</div>
                                ) : skills.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '64px' }}>
                                        暂无 Skills
                                    </div>
                                ) : (
                                    <div style={{ display: 'grid', gap: '12px' }}>
                                        {skills.map(skill => (
                                            <div key={skill.name} style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', background: '#fff' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                                                    <div>
                                                        <div style={{ fontWeight: 700, color: '#1f2937' }}>{skill.name}</div>
                                                        <div style={{ fontSize: '0.9rem', color: '#6b7280', marginTop: '4px' }}>{skill.description}</div>
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{skill.source_scope}</div>
                                                </div>
                                                {skill.when_to_use && (
                                                    <div style={{ fontSize: '0.85rem', color: '#374151', marginTop: '10px' }}>使用时机：{skill.when_to_use}</div>
                                                )}
                                                <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: '10px', wordBreak: 'break-all' }}>路径：{skill.location}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
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

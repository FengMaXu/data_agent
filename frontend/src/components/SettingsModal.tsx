import React, { useEffect, useState } from 'react';
import {
    Settings as SettingsIcon, Cpu, Server, X,
    Database, User, Key, Activity, Link, Eye, ExternalLink, Loader2
} from 'lucide-react';
import {
    getConfig,
    updateLLMConfig,
    updateDBConfig,
    testDBConnection,
    type AIConfig,
} from '../api/client';
import { useLanguage } from '../context/LanguageContext';

interface SettingsModalProps {
    onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const { t } = useLanguage();
    const logoSrc = `${import.meta.env.BASE_URL}yourdb-logo.png`;
    const [activeMenu, setActiveMenu] = useState('模型');

    // States for sub-tabs
    const [modelProvider, setModelProvider] = useState('模型设置');

    const menuItems = [
        { id: '模型', icon: Cpu },
        { id: '数据库', icon: Database },
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

    const persistProviderPreference = (id: string, providerConfig: ProviderConfig) => {
        const { apiKey: _apiKey, ...safeConfig } = providerConfig;
        localStorage.setItem(`provider_config_${id}`, JSON.stringify(safeConfig));
    };

    // Keep independent config for each provider
    const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>(() => {
        const initial: Record<string, ProviderConfig> = {};
        for (const [id, reg] of Object.entries(PROVIDER_REGISTRY)) {
            // Load from localStorage if present to remember user inputs when switching tabs
            const saved = localStorage.getItem(`provider_config_${id}`);
            if (saved) {
                try {
                    initial[id] = { ...JSON.parse(saved), apiKey: '' };
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
            persistProviderPreference(id, next[id]);
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


    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const initialConfig = await getConfig();
                setConfig(initialConfig);
                setDbHost(initialConfig.mysql_host || 'localhost');
                setDbPort(initialConfig.mysql_port || 3306);
                setDbUser(initialConfig.mysql_user || 'root');
                setDbName(initialConfig.mysql_database || '');
                const desktopSecrets = await window.dataAgent?.getStoredSecrets();

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
                        if (desktopSecrets?.openai_api_key && activeId !== 'Anthropic') {
                            pConfig.apiKey = '[configured_in_desktop]';
                        }
                        
                        // Handle custom model if it's not in the list
                        if (initialConfig.default_model) {
                            pConfig.selectedModel = initialConfig.default_model;
                            if (!pConfig.models.includes(initialConfig.default_model)) {
                                pConfig.models = [...pConfig.models, initialConfig.default_model];
                            }
                        }
                        next[activeId] = pConfig;
                        persistProviderPreference(activeId, pConfig);
                        return next;
                    });
                }

            } catch (err) {
                console.error('Failed to load settings config:', err);
            }
        };

        void loadInitialData();
    }, []);



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

                const provider = providerId === 'Anthropic' ? 'anthropic' : 'openai';
                if (window.dataAgent && apikeyToSend) {
                    await window.dataAgent.saveSecrets({
                        openai_api_key: provider === 'openai' ? apikeyToSend : undefined,
                        anthropic_api_key: provider === 'anthropic' ? apikeyToSend : undefined,
                        default_model: configToSave.selectedModel,
                        openai_base_url: provider === 'openai' ? configToSave.baseUrl : undefined,
                    });
                }

                await updateLLMConfig({
                    provider,
                    api_key: apikeyToSend,
                    openai_api_key: provider === 'openai' ? apikeyToSend : undefined,
                    anthropic_api_key: provider === 'anthropic' ? apikeyToSend : undefined,
                    base_url: provider === 'openai' ? configToSave.baseUrl : undefined,
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
                            src={logoSrc}
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
                                <span>{item.id === '模型' ? (t('settings.model') || '模型') : (t('settings.database') || '数据库')}</span>
                            </button>
                        ))}
                    </nav>
                </aside>

                {/* Right Content Area */}
                <div className="modal-content-area flex-1 flex flex-col">
                    {/* Header */}
                    <header className="modal-header">
                        <h2>{activeMenu === '模型' ? (t('settings.model') || '模型') : (t('settings.database') || '数据库')}</h2>
                        <button className="modal-close-btn" onClick={onClose}>
                            <X size={20} />
                        </button>
                    </header>

                    {/* Dynamic Content */}
                    <div className="modal-body scrollable-area" style={{ padding: activeMenu === '模型' ? 0 : '32px', display: 'flex', flexDirection: 'column', flex: 1 }}>



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
                                        <span>{t('settings.modelSettings')}</span>
                                    </button>

                                    <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '8px', paddingLeft: '8px' }}>{t('settings.providers')}</div>
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
                                            <h3 className="settings-section-title" style={{ fontSize: '1rem', color: '#6b7280', marginBottom: '24px', fontWeight: 500 }}>{t('settings.defaultModelTitle')}</h3>

                                            <h4 className="settings-section-title" style={{ marginBottom: '2px' }}>{t('settings.defaultModelSubtitle')}</h4>

                                            <div className="settings-input-wrapper" style={{ padding: '8px 16px', cursor: 'not-allowed', background: '#f9fafb', marginBottom: '8px' }}>
                                                <input
                                                    style={{ flex: 1, fontSize: '0.9rem', border: 'none', outline: 'none', background: 'transparent', cursor: 'not-allowed', color: '#6b7280' }}
                                                    value={config?.default_model || ''}
                                                    readOnly
                                                    placeholder="未设置"
                                                />
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '32px' }}>
                                                {t('settings.defaultModelHint')}
                                            </div>

                                            <h4 className="settings-section-title" style={{ marginBottom: '16px' }}>{t('settings.historyLimitTitle')}</h4>

                                            <div style={{ marginBottom: '24px' }}>
                                                <h4 className="settings-section-title" style={{ marginBottom: '4px', fontSize: '0.85rem' }}>{t('settings.maxTurns')}</h4>
                                                <p className="settings-section-desc" style={{ fontSize: '0.8rem', marginBottom: '8px' }}>{t('settings.maxTurnsSubtitle')}</p>
                                                <div className="settings-input-wrapper" style={{ background: '#fff' }}>
                                                    <input type="number" value="20" readOnly />
                                                </div>
                                            </div>

                                            <div>
                                                <h4 className="settings-section-title" style={{ marginBottom: '4px', fontSize: '0.85rem' }}>{t('settings.maxTokens')}</h4>
                                                <p className="settings-section-desc" style={{ fontSize: '0.8rem', marginBottom: '8px' }}>{t('settings.maxTokensSubtitle')}</p>
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
                                                <h4 className="settings-section-title" style={{ fontSize: '0.9rem', marginBottom: '12px' }}>{t('settings.apiKeyTitle')}</h4>
                                                <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
                                                    <input
                                                        type="password"
                                                        placeholder={t('settings.apiKeyPlaceholder')}
                                                        style={{ fontSize: '0.95rem', width: '100%' }}
                                                        value={providerConfigs[modelProvider]?.apiKey || ''}
                                                        onChange={e => updateProviderConfig(modelProvider, { apiKey: e.target.value })}
                                                    />
                                                    <Eye size={18} color="#9ca3af" style={{ cursor: 'pointer' }} />
                                                </div>
                                                <a href={providers.find(p => p.id === modelProvider)?.apiKeyUrl || '#'} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: '#f97316', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '12px' }}>
                                                    {t('settings.howToGetToken')} <ExternalLink size={14} />
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
                                                <span>{t('settings.dbHost')}</span>
                                            </div>
                                            <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '14px 16px' }}>
                                                <input type="text" placeholder="localhost" value={dbHost} onChange={e => setDbHost(e.target.value)} style={{ fontSize: '0.95rem' }} />
                                            </div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>
                                                <Activity size={18} />
                                                <span>{t('settings.dbPort')}</span>
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
                                                <span>{t('settings.dbUser')}</span>
                                            </div>
                                            <div className="settings-input-wrapper" style={{ margin: 0, borderRadius: '12px', padding: '14px 16px' }}>
                                                <input type="text" placeholder="root" value={dbUser} onChange={e => setDbUser(e.target.value)} style={{ fontSize: '0.95rem' }} />
                                            </div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.9rem', fontWeight: 600, color: '#1f2937' }}>
                                                <Key size={18} />
                                                <span>{t('settings.dbPassword')}</span>
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
                                            <span>{t('settings.dbDatabase')}</span>
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
                                            {isTestingDB ? t('settings.testing') : t('settings.dbTest')}
                                        </button>
                                        <button
                                            onClick={handleSaveDB}
                                            disabled={isSavingDB}
                                            style={{ width: '180px', padding: '12px 24px', background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: isSavingDB ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                            {isSavingDB ? <Loader2 size={16} className="animate-spin" /> : null}
                                            {t('settings.save')}
                                        </button>
                                    </div>

                                </div>
                            </div>
                        )}


                        {!['模型', '数据库'].includes(activeMenu) && (
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

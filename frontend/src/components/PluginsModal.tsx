import React, { useState, useEffect, useRef } from 'react';
import { X, Search, RefreshCw, Plus, Loader2 } from './icons/Typicons';
import {
    getMCPConfig,
    saveMCPConfig,
    getMCPServers,
    updateMCPServerEnabled,
    restartMCPServer,
    testMCPServer,
    getSkills,
    type MCPConfig,
    type MCPServerConfig,
    type MCPServerRequest,
    type MCPServerStatus,
    type MCPTestResult,
    type SkillInfo,
} from '../api/client';
import { useLanguage } from '../context/LanguageContext';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface PluginsModalProps {
    initialTab?: 'MCP' | 'Skills';
    onClose: () => void;
}

const PluginsModal: React.FC<PluginsModalProps> = ({ initialTab = 'MCP', onClose }) => {
    const { t } = useLanguage();
    const overlayRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    useFocusTrap(true, modalRef, overlayRef);
    // States for sub-tabs
    const [mcpTab, setMcpTab] = useState('已安装');
    const [skillsTab, setSkillsTab] = useState('已安装');

    // MCP states
    const [mcpConfig, setMcpConfig] = useState<MCPConfig>({ servers: [] });
    const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);
    const [selectedMcpServer, setSelectedMcpServer] = useState<number | null>(null);
    const [isLoadingMCP, setIsLoadingMCP] = useState(false);
    const [isSavingMCP, setIsSavingMCP] = useState(false);
    const [isTestingMCP, setIsTestingMCP] = useState(false);
    const [mcpTestResult, setMcpTestResult] = useState<MCPTestResult | null>(null);
    const [mcpError, setMcpError] = useState<string | null>(null);
    const [pendingToggleServer, setPendingToggleServer] = useState<string | null>(null);
    const [pendingRestartServer, setPendingRestartServer] = useState<string | null>(null);
    
    // Skills states
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [isLoadingSkills, setIsLoadingSkills] = useState(false);
    const [skillsError, setSkillsError] = useState<string | null>(null);
    const [skillQuery, setSkillQuery] = useState('');

    useEffect(() => {
        void loadMCPData();
        void loadSkills();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const emptyMcpServer = (): MCPServerConfig => ({
        name: '',
        transport: 'stdio',
        enabled: true,
        command: 'python',
        script: '',
        args: [],
        args_input: '',
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

    const loadMCPData = async ({ silent = false }: { silent?: boolean } = {}) => {
        if (!silent) {
            setIsLoadingMCP(true);
        }
        try {
            const [configRes, serversRes] = await Promise.all([
                getMCPConfig(),
                getMCPServers(),
            ]);
            setMcpError(null);
            setMcpConfig(configRes);
            setMcpServers(serversRes.servers || []);
            setSelectedMcpServer(prev => {
                if ((configRes.servers || []).length === 0) return null;
                if (prev === null || prev >= configRes.servers.length) return 0;
                return prev;
            });
        } catch (err) {
            console.error('Failed to load MCP config:', err);
            setMcpError(t('plugins.loadFailed'));
        } finally {
            if (!silent) {
                setIsLoadingMCP(false);
            }
        }
    };

    const updateMcpServerField = (index: number, field: keyof MCPServerConfig, value: MCPServerConfig[keyof MCPServerConfig]) => {
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

    const parseMcpArgs = (server: MCPServerConfig): string[] => {
        if (!server.args_input?.trim()) {
            return server.args || [];
        }
        const parsed = JSON.parse(server.args_input);
        if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string')) {
            throw new Error('MCP 参数必须是字符串数组，例如 ["mcp", "stdio"]');
        }
        return parsed;
    };

    const buildMcpServerPayload = (server: MCPServerConfig): MCPServerRequest => {
        const payload: MCPServerRequest = {
            name: server.name,
            transport: server.transport,
            enabled: server.enabled,
            command: server.command || '',
            script: server.script || '',
            args: parseMcpArgs(server),
            url: server.url || '',
            description: server.description || '',
            tool_prefix: server.tool_prefix || '',
            server_type: server.server_type || 'service',
            tags: server.tags || [],
        };

        if (server.env_input?.trim()) {
            payload.env = JSON.parse(server.env_input);
        }
        if (server.headers_input?.trim()) {
            payload.headers = JSON.parse(server.headers_input);
        }
        return payload;
    };

    const buildMcpPayload = (config: MCPConfig) => ({
        servers: config.servers.map(buildMcpServerPayload),
    });
    const persistMcpConfig = async (config: MCPConfig) => {
        await saveMCPConfig(buildMcpPayload(config));
    };

    const handleToggleMCPEnabled = async (serverName: string, enabled: boolean) => {
        const nextConfig: MCPConfig = {
            ...mcpConfig,
            servers: mcpConfig.servers.map(server =>
                server.name === serverName ? { ...server, enabled } : server
            ),
        };

        setMcpError(null);
        setPendingToggleServer(serverName);
        setMcpConfig(nextConfig);
        try {
            const result = await updateMCPServerEnabled(serverName, enabled);
            setMcpConfig(prev => ({
                ...prev,
                servers: prev.servers.map(server =>
                    server.name === serverName ? { ...server, ...result.server, enabled: result.server.enabled } : server
                ),
            }));
            setMcpServers(prev => {
                let found = false;
                const next = prev.map(server => {
                    if (server.name !== serverName) {
                        return server;
                    }
                    found = true;
                    return result.server;
                });
                return found ? next : [...next, result.server];
            });
        } catch (e: unknown) {
            console.error('Failed to update MCP status:', e);
            setMcpError(e instanceof SyntaxError ? t('plugins.invalidJson') : t('plugins.updateFailed'));
            await loadMCPData();
        } finally {
            setPendingToggleServer(null);
        }
    };

    const handleRestartMCPServer = async (serverName: string) => {
        setMcpError(null);
        setPendingRestartServer(serverName);
        try {
            const result = await restartMCPServer(serverName);
            setMcpConfig(prev => ({
                ...prev,
                servers: prev.servers.map(server =>
                    server.name === serverName ? { ...server, ...result.server, enabled: result.server.enabled } : server
                ),
            }));
            setMcpServers(prev => prev.map(server => server.name === serverName ? result.server : server));
        } catch (e: unknown) {
            console.error('Failed to reconnect MCP server:', e);
            setMcpError(t('plugins.reconnectFailed'));
            await loadMCPData();
        } finally {
            setPendingRestartServer(null);
        }
    };

    const handleSaveMCP = async () => {
        setIsSavingMCP(true);
        setMcpError(null);
        try {
            await persistMcpConfig(mcpConfig);
            void loadMCPData({ silent: true });
        } catch (e: unknown) {
            console.error('Failed to save MCP configuration:', e);
            setMcpError(e instanceof SyntaxError ? t('plugins.invalidJson') : t('plugins.saveFailed'));
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
            const result = await testMCPServer(buildMcpServerPayload(server));
            setMcpTestResult(result);
            await loadMCPData();
        } catch (e: unknown) {
            console.error('MCP test failed:', e);
            setMcpTestResult({ success: false, message: t('plugins.testFailed') });
        } finally {
            setIsTestingMCP(false);
        }
    };

    const loadSkills = async () => {
        setIsLoadingSkills(true);
        setSkillsError(null);
        try {
            const result = await getSkills();
            setSkills(result.skills || []);
        } catch (err) {
            console.error('Failed to load skills:', err);
            setSkills([]);
            setSkillsError(t('plugins.loadSkillsFailed'));
        } finally {
            setIsLoadingSkills(false);
        }
    };

    const displayedMcpServers = mcpServers.map((server, index) => ({
        ...server,
        key: `${server.name || 'server'}-${index}`,
        connected: server.enabled ? Boolean(server.connected) : false,
        tool_count: server.enabled ? (server.tool_count ?? 0) : 0,
    }));
    const filteredSkills = skills.filter((skill) => !skillQuery || skill.name.toLowerCase().includes(skillQuery.toLowerCase()) || (skill.description || '').toLowerCase().includes(skillQuery.toLowerCase()));
    const selectedServerStatus = selectedMcpServer === null ? null : displayedMcpServers.find(
        server => server.name === mcpConfig.servers[selectedMcpServer]?.name,
    );

    const isHostManaged = (server: MCPServerStatus) => Boolean(server.host_managed || server.server_type === 'semantic');

    const getServerStatusMeta = (server: MCPServerStatus) => {
        if (isHostManaged(server) && !server.enabled) {
            return { label: t('plugins.notConfigured'), fg: '#6b7280', bg: '#f3f4f6' };
        }
        const status = !server.enabled ? 'disabled' : (server.status || (server.connected ? 'connected' : 'disconnected'));
        if (status === 'connected') {
            return { label: t('plugins.connected'), fg: '#047857', bg: '#ecfdf5' };
        }
        if (status === 'connecting') {
            return { label: t('plugins.connecting'), fg: '#1d4ed8', bg: '#eff6ff' };
        }
        if (status === 'error') {
            return { label: t('plugins.error'), fg: '#b91c1c', bg: '#fef2f2' };
        }
        if (status === 'disabled') {
            return { label: t('plugins.disabled'), fg: '#6b7280', bg: '#f3f4f6' };
        }
        return { label: t('plugins.disconnected'), fg: '#b45309', bg: '#fffbeb' };
    };

    return (
        <div ref={overlayRef} className="plugins-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <div ref={modalRef} className="plugins-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="plugins-modal-title" tabIndex={-1}>
                {/* Header */}
                <div className="plugins-modal-header">
                    <h2 id="plugins-modal-title" className="plugins-modal-title">{initialTab === 'MCP' ? t('plugins.mcp') : t('plugins.skills')}</h2>
                    <button type="button" aria-label={t('common.close')} title={t('common.close')} className="plugins-modal-close" onClick={onClose}>
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                {/* Body */}
                <div className="plugins-modal-body">
                    {/* Content */}
                    <div className="plugins-modal-content">
                        {/* MCP */}
                        {initialTab === 'MCP' && (
                            <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                                <div className="plugins-tab-list" role="tablist" aria-label={t('plugins.mcp')}>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={mcpTab === '已安装'}
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: mcpTab === '已安装' ? 600 : 400, color: mcpTab === '已安装' ? '#1f2937' : '#6b7280', borderBottom: mcpTab === '已安装' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setMcpTab('已安装')}
                                    >
                                        {t('plugins.installed')}
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={mcpTab === '设置'}
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: mcpTab === '设置' ? 600 : 400, color: mcpTab === '设置' ? '#1f2937' : '#6b7280', borderBottom: mcpTab === '设置' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setMcpTab('设置')}
                                    >
                                        {t('plugins.settings')}
                                    </button>
                                </div>

                                <div className="plugins-mcp-toolbar">
                                    <div style={{ color: '#4b5563', fontSize: '0.9rem' }}>
                                        {t('plugins.mcpDesc')}
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button
                                            onClick={() => void loadMCPData()}
                                            disabled={isLoadingMCP}
                                            style={{ background: '#fff', color: '#1f2937', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px', cursor: isLoadingMCP ? 'not-allowed' : 'pointer' }}
                                        >
                                            {isLoadingMCP ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                            {t('plugins.refresh')}
                                        </button>
                                        <button onClick={addMcpServer} style={{ background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <Plus size={16} /> {t('plugins.add')}
                                        </button>
                                    </div>
                                </div>

                                {mcpError && (
                                    <div role="alert" aria-live="assertive" style={{ marginBottom: '16px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #fecaca', background: '#fff1f2', color: '#b91c1c', fontSize: '0.85rem' }}>
                                        {mcpError}
                                    </div>
                                )}

                                {mcpTab === '已安装' && (
                                    <div style={{ display: 'grid', gap: '16px' }}>
                                        {displayedMcpServers.length === 0 && (
                                            <div role="status" style={{ textAlign: 'center', color: '#6b7280', marginTop: '64px' }}>{t('plugins.noServers')}</div>
                                        )}
                                        {displayedMcpServers.map((server, index) => {
                                            const isToggling = pendingToggleServer === server.name;
                                            const isRestarting = pendingRestartServer === server.name;
                                            const hostManaged = isHostManaged(server);
                                            const statusMeta = getServerStatusMeta(server);
                                            const displayName = hostManaged ? 'KTX Semantic' : server.name;
                                            return (
                                                <div key={server.key} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 18px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                                                        <div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                                <span style={{ fontWeight: 600, color: '#111827' }}>{displayName}</span>
                                                                <span style={{ fontSize: '0.75rem', color: statusMeta.fg, background: statusMeta.bg, padding: '2px 8px', borderRadius: '999px' }}>
                                                                    {statusMeta.label}
                                                                </span>
                                                            </div>
                                                            <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '4px' }}>{server.description || t('plugins.noDesc')}</div>
                                                            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                                                                {t('plugins.transportSummary')}: {server.transport} · {t('plugins.typeSummary')}: {server.server_type || 'service'} · {t('plugins.toolsSummary')}: {server.tool_count ?? 0}
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            {hostManaged ? (
                                                                <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                                                                    {t('plugins.hostManaged')}
                                                                </span>
                                                            ) : (
                                                                <>
                                                                    {server.enabled && (
                                                                        <button
                                                                            onClick={() => void handleRestartMCPServer(server.name)}
                                                                            disabled={isRestarting || isToggling}
                                                                            style={{
                                                                                background: '#eff6ff',
                                                                                border: '1px solid #bfdbfe',
                                                                                borderRadius: '8px',
                                                                                padding: '8px 12px',
                                                                                minWidth: '78px',
                                                                                cursor: (isRestarting || isToggling) ? 'not-allowed' : 'pointer',
                                                                                color: '#1d4ed8'
                                                                            }}
                                                                        >
                                                                            {isRestarting ? <Loader2 size={16} className="animate-spin" /> : t('plugins.reconnect')}
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => void handleToggleMCPEnabled(server.name, !server.enabled)}
                                                                        disabled={isToggling || isRestarting}
                                                                        style={{
                                                                            background: server.enabled ? '#fff7ed' : '#ecfdf5',
                                                                            border: `1px solid ${server.enabled ? '#fdba74' : '#86efac'}`,
                                                                            borderRadius: '8px',
                                                                            padding: '8px 12px',
                                                                            minWidth: '78px',
                                                                            cursor: (isToggling || isRestarting) ? 'not-allowed' : 'pointer',
                                                                            color: server.enabled ? '#c2410c' : '#166534'
                                                                        }}
                                                                    >
                                                                        {isToggling ? <Loader2 size={16} className="animate-spin" /> : (server.enabled ? t('plugins.disable') : t('plugins.enable'))}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            const targetIndex = mcpConfig.servers.findIndex(item => item.name === server.name);
                                                                            setSelectedMcpServer(targetIndex >= 0 ? targetIndex : index);
                                                                            setMcpTab('设置');
                                                                        }}
                                                                        style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', color: '#374151' }}
                                                                    >
                                                                        {t('plugins.edit')}
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {mcpTab === '设置' && (
                                    <div className="plugins-server-settings-layout" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '24px', flex: 1 }}>
                                        <div style={{ display: 'grid', gap: '12px', alignContent: 'start' }}>
                                            {mcpConfig.servers.length === 0 && (
                                                <div style={{ background: '#fff', border: '1px dashed #d1d5db', borderRadius: '12px', padding: '18px', color: '#6b7280', textAlign: 'center' }}>
                                                    {t('plugins.noSrvHint')}
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
                                                    <div style={{ fontWeight: 600, color: '#111827', marginBottom: '4px' }}>{server.name || t('plugins.unnamedSrv')}</div>
                                                    <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{server.transport} · {server.server_type || 'service'}</div>
                                                </button>
                                            ))}
                                        </div>

                                        <div>
                                            {selectedMcpServer === null || !mcpConfig.servers[selectedMcpServer] ? (
                                                <div style={{ background: '#fff', border: '1px dashed #d1d5db', borderRadius: '12px', padding: '24px', color: '#6b7280' }}>
                                                    {t('plugins.selectHint')}
                                                </div>
                                            ) : (
                                                <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', border: '1px solid #f3f4f6' }}>
                                                    <div style={{ marginBottom: '24px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                                                            <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{t('plugins.serverSettings')}</h4>
                                                            {selectedServerStatus && (
                                                                <span style={{
                                                                    fontSize: '0.75rem',
                                                                    color: getServerStatusMeta(selectedServerStatus).fg,
                                                                    background: getServerStatusMeta(selectedServerStatus).bg,
                                                                    padding: '2px 8px',
                                                                    borderRadius: '999px'
                                                                }}>
                                                                    {getServerStatusMeta(selectedServerStatus).label}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p style={{ fontSize: '0.9rem', color: '#4b5563' }}>{t('plugins.serverHint')}</p>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                                        {/* Name & Transport */}
                                                        <div className="plugins-form-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                                                            <div>
                                                                <label htmlFor="mcp-server-name" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{t('plugins.name')} <span aria-hidden="true" style={{ color: '#b91c1c' }}>*</span></label>
                                                                <div className="plugins-input-group">
                                                                    <input id="mcp-server-name" value={mcpConfig.servers[selectedMcpServer].name || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'name', e.target.value)} placeholder="如: my-database" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label htmlFor="mcp-server-transport" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{t('plugins.transport')}</label>
                                                                <div className="plugins-input-group">
                                                                    <select id="mcp-server-transport" value={mcpConfig.servers[selectedMcpServer].transport} onChange={e => updateMcpServerField(selectedMcpServer, 'transport', e.target.value as MCPServerConfig['transport'])} style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }}>
                                                                        <option value="stdio">stdio</option>
                                                                        <option value="http">http</option>
                                                                        <option value="sse">sse</option>
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Command & Script */}
                                                        <div className="plugins-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                                                            <div>
                                                                <label htmlFor="mcp-server-command" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{t('plugins.command')}</label>
                                                                <div className="plugins-input-group">
                                                                    <input id="mcp-server-command" value={mcpConfig.servers[selectedMcpServer].command || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'command', e.target.value)} placeholder="python / npx" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label htmlFor="mcp-server-script-or-url" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? t('plugins.scriptArgs') : t('plugins.url')}</label>
                                                                <div className="plugins-input-group">
                                                                    <input id="mcp-server-script-or-url" value={mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? (mcpConfig.servers[selectedMcpServer].script || '') : (mcpConfig.servers[selectedMcpServer].url || '')} onChange={e => updateMcpServerField(selectedMcpServer, mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? 'script' : 'url', e.target.value)} placeholder={mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? 'server.py' : 'https://...'} style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {mcpConfig.servers[selectedMcpServer].transport === 'stdio' && (
                                                            <div>
                                                                <label htmlFor="mcp-server-args" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{t('plugins.arguments')}</label>
                                                                <textarea
                                                                    id="mcp-server-args"
                                                                    value={mcpConfig.servers[selectedMcpServer].args_input ?? JSON.stringify(mcpConfig.servers[selectedMcpServer].args || [], null, 2)}
                                                                    onChange={e => updateMcpServerField(selectedMcpServer, 'args_input', e.target.value)}
                                                                    placeholder='["mcp", "stdio"]'
                                                                    style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', margin: 0, width: '100%', minHeight: '72px', padding: '12px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
                                                                />
                                                            </div>
                                                        )}

                                                        {/* Env & Headers */}
                                                        <div className="plugins-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                            <div>
                                                                <label htmlFor="mcp-server-env" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151', display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span>{t('plugins.environment')}</span>
                                                                    {mcpConfig.servers[selectedMcpServer].env?.configured && <span style={{ fontSize: '0.75rem', color: '#047857', fontWeight: 400 }}>{t('plugins.configured').replace('{count}', String(mcpConfig.servers[selectedMcpServer].env?.count ?? 0))}</span>}
                                                                </label>
                                                                <textarea
                                                                    id="mcp-server-env"
                                                                    style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', margin: 0, width: '100%', minHeight: '80px', padding: '12px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
                                                                    value={mcpConfig.servers[selectedMcpServer].env_input ?? ''}
                                                                    onChange={e => updateMcpServerField(selectedMcpServer, 'env_input', e.target.value)}
                                                                    placeholder='{"KEY": "value"}'
                                                                />
                                                            </div>
                                                            <div>
                                                                <label htmlFor="mcp-server-headers" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151', display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span>{t('plugins.headers')}</span>
                                                                    {mcpConfig.servers[selectedMcpServer].headers?.configured && <span style={{ fontSize: '0.75rem', color: '#047857', fontWeight: 400 }}>{t('plugins.configured').replace('{count}', String(mcpConfig.servers[selectedMcpServer].headers?.count ?? 0))}</span>}
                                                                </label>
                                                                <textarea
                                                                    id="mcp-server-headers"
                                                                    style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', margin: 0, width: '100%', minHeight: '80px', padding: '12px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
                                                                    value={mcpConfig.servers[selectedMcpServer].headers_input ?? ''}
                                                                    onChange={e => updateMcpServerField(selectedMcpServer, 'headers_input', e.target.value)}
                                                                    placeholder='{"Authorization": "Bearer..."}'
                                                                />
                                                            </div>
                                                        </div>

                                                        {/* prefix and type */}
                                                        <div className="plugins-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                            <div>
                                                                <label htmlFor="mcp-server-tool-prefix" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{t('plugins.toolPrefix')}</label>
                                                                <div className="plugins-input-group">
                                                                    <input id="mcp-server-tool-prefix" value={mcpConfig.servers[selectedMcpServer].tool_prefix || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'tool_prefix', e.target.value)} placeholder="如: db_" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label htmlFor="mcp-server-type" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{t('plugins.serverType')}</label>
                                                                <div className="plugins-input-group">
                                                                    <input id="mcp-server-type" value={mcpConfig.servers[selectedMcpServer].server_type || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'server_type', e.target.value)} placeholder="如: service / database" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Description */}
                                                        <div>
                                                            <label htmlFor="mcp-server-description" style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{t('plugins.description')}</label>
                                                            <div className="plugins-input-group">
                                                                <input id="mcp-server-description" value={mcpConfig.servers[selectedMcpServer].description || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'description', e.target.value)} placeholder="用途说明" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                            </div>
                                                        </div>

                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '16px', borderTop: '1px solid #f3f4f6' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#374151', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 500 }}>
                                                                <input type="checkbox" checked={mcpConfig.servers[selectedMcpServer].enabled} onChange={e => updateMcpServerField(selectedMcpServer, 'enabled', e.target.checked)} style={{ width: '16px', height: '16px' }} />
                                                                {t('plugins.enableServer')}
                                                            </label>
                                                            <button
                                                                type="button"
                                                                onClick={() => removeMcpServer(selectedMcpServer)}
                                                                style={{ background: '#fff0f2', border: '1px solid #ffccd5', color: '#be123c', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}
                                                            >
                                                                {t('plugins.deleteConfig')}
                                                            </button>
                                                        </div>
                                                    </div>

                                                        {mcpTestResult && (
                                                            <div role={mcpTestResult.success ? 'status' : 'alert'} aria-live={mcpTestResult.success ? 'polite' : 'assertive'} style={{ padding: '16px', borderRadius: '8px', marginTop: '20px', background: mcpTestResult.success ? '#ecfdf5' : '#fef2f2', border: `1px solid ${mcpTestResult.success ? '#6ee7b7' : '#fca5a5'}`, color: mcpTestResult.success ? '#065f46' : '#991b1b' }}>
                                                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>{mcpTestResult.success ? `✓ ${t('settings.dbTestSuccess')}` : `✗ ${t('settings.dbTestFailed')}`}</div>
                                                                <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{mcpTestResult.message}</div>
                                                                {mcpTestResult.tools && mcpTestResult.tools.length > 0 && (
                                                                    <div style={{ marginTop: '8px', fontSize: '0.85rem' }}>{t('plugins.discoveredTools')}: {mcpTestResult.tools.map(tool => tool.name).join(', ')}</div>
                                                                )}
                                                            </div>
                                                        )}

                                                    <div className="plugins-action-row" style={{ display: 'flex', gap: '16px', justifyContent: 'flex-end', marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #f3f4f6' }}>
                                                        {selectedServerStatus?.enabled && (
                                                            <button
                                                                onClick={() => void handleRestartMCPServer(selectedServerStatus.name)}
                                                                disabled={pendingRestartServer === selectedServerStatus.name}
                                                                style={{ width: '180px', padding: '12px 24px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '8px', fontWeight: 600, cursor: pendingRestartServer === selectedServerStatus.name ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                                            >
                                                                {pendingRestartServer === selectedServerStatus.name ? <Loader2 size={16} className="animate-spin" /> : null}
                                                                {t('plugins.reconnect')} MCP
                                                            </button>
                                                        )}
                                                        <button onClick={handleTestMCP} disabled={isTestingMCP} style={{ width: '180px', padding: '12px 24px', background: '#f3f4f6', color: '#1f2937', border: '1px solid #e5e7eb', borderRadius: '8px', fontWeight: 600, cursor: isTestingMCP ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                                            {isTestingMCP ? <Loader2 size={16} className="animate-spin" /> : null}
                                                            {t('plugins.test')}
                                                        </button>
                                                        <button onClick={handleSaveMCP} disabled={isSavingMCP} style={{ width: '180px', padding: '12px 24px', background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: isSavingMCP ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                                            {isSavingMCP ? <Loader2 size={16} className="animate-spin" /> : null}
                                                            {t('plugins.saveConfig')}
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
                        {initialTab === 'Skills' && (
                            <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                                <div className="plugins-tab-list" role="tablist" aria-label={t('plugins.skills')}>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={skillsTab === '已安装'}
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: skillsTab === '已安装' ? 600 : 400, color: skillsTab === '已安装' ? '#1f2937' : '#6b7280', borderBottom: skillsTab === '已安装' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setSkillsTab('已安装')}
                                    >
                                        {t('plugins.installed')}
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={skillsTab === '设置'}
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: skillsTab === '设置' ? 600 : 400, color: skillsTab === '设置' ? '#1f2937' : '#6b7280', borderBottom: skillsTab === '设置' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setSkillsTab('设置')}
                                    >
                                        {t('plugins.settings')}
                                    </button>
                                </div>

                                <div className="plugins-skills-toolbar">
                                    <div className="plugins-search-box" style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', width: '300px' }}>
                                        <Search size={16} color="#9ca3af" style={{ marginRight: '8px' }} />
                                        <input placeholder={t('plugins.searchSkill') || "搜索 Skill"} value={skillQuery} onChange={e => setSkillQuery(e.target.value)} aria-label={t('plugins.searchSkill') || '搜索 Skill'} style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.85rem' }} />
                                    </div>
                                    <button onClick={loadSkills} style={{ background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <RefreshCw size={16} /> {t('plugins.refresh')}
                                    </button>
                                </div>

                                {skillsError ? (
                                    <div role="alert" aria-live="assertive" style={{ marginBottom: '16px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #fecaca', background: '#fff1f2', color: '#b91c1c', fontSize: '0.85rem' }}>{skillsError}</div>
                                ) : null}
                                {isLoadingSkills ? (
                                    <div role="status" style={{ textAlign: 'center', color: '#6b7280', marginTop: '64px' }}>{t('plugins.loadingSkills')}</div>
                                ) : skills.length === 0 ? (
                                    <div role="status" style={{ textAlign: 'center', color: '#6b7280', marginTop: '64px' }}>
                                        {t('plugins.noSkills')}
                                    </div>
                                ) : filteredSkills.length === 0 ? (
                                    <div role="status" style={{ textAlign: 'center', color: '#6b7280', marginTop: '64px' }}>
                                        {t('plugins.noSearchResults')}
                                    </div>
                                ) : (
                                    <div style={{ display: 'grid', gap: '12px' }}>
                                        {filteredSkills.map(skill => (
                                            <div key={skill.name} style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', background: '#fff' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                                                    <div>
                                                        <div style={{ fontWeight: 700, color: '#1f2937' }}>{skill.name}</div>
                                                        <div style={{ fontSize: '0.9rem', color: '#6b7280', marginTop: '4px' }}>{skill.description}</div>
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{skill.source_scope}</div>
                                                </div>
                                                {skill.when_to_use && (
                                                    <div style={{ fontSize: '0.85rem', color: '#374151', marginTop: '10px' }}>{t('plugins.whenToUse')}：{skill.when_to_use}</div>
                                                )}
                                                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '10px', wordBreak: 'break-all' }}>{t('plugins.path')}：{skill.location}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}



                    </div>
                </div>
            </div>
        </div >
    );
};

export default PluginsModal;

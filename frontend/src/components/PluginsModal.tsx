import React, { useState, useEffect } from 'react';
import { X, Search, RefreshCw, Plus, Loader2 } from 'lucide-react';
import {
    getMCPConfig,
    saveMCPConfig,
    getMCPServers,
    getMCPTools,
    testMCPServer,
    getSkills,
    type MCPConfig,
    type MCPServerConfig,
    type MCPServerStatus,
    type MCPToolInfo,
    type MCPTestResult,
    type SkillInfo,
} from '../api/client';
import { useLanguage } from '../context/LanguageContext';

interface PluginsModalProps {
    initialTab?: 'MCP' | 'Skills';
    onClose: () => void;
}

const PluginsModal: React.FC<PluginsModalProps> = ({ initialTab = 'MCP', onClose }) => {
    const { t } = useLanguage();
    // States for sub-tabs
    const [mcpTab, setMcpTab] = useState('已安装');
    const [skillsTab, setSkillsTab] = useState('已安装');

    // MCP states
    const [mcpConfig, setMcpConfig] = useState<MCPConfig>({ servers: [] });
    const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);
    const [mcpTools, setMcpTools] = useState<MCPToolInfo[]>([]);
    const [selectedMcpServer, setSelectedMcpServer] = useState<number | null>(null);
    const [isLoadingMCP, setIsLoadingMCP] = useState(false);
    const [isSavingMCP, setIsSavingMCP] = useState(false);
    const [isTestingMCP, setIsTestingMCP] = useState(false);
    const [mcpTestResult, setMcpTestResult] = useState<MCPTestResult | null>(null);
    
    // Skills states
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [isLoadingSkills, setIsLoadingSkills] = useState(false);

    useEffect(() => {
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

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }} onClick={onClose}>
            <div style={{ background: '#f9fafb', borderRadius: '16px', width: '800px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', flexShrink: 0 }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#111827' }}>{initialTab === 'MCP' ? t('plugins.mcp') : t('plugins.skills')}</h2>
                    <button style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '8px', color: '#6b7280', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose} onMouseOver={e => e.currentTarget.style.background = '#f3f4f6'} onMouseOut={e => e.currentTarget.style.background = 'none'}>
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                    {/* Content */}
                    <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
                        {/* MCP */}
                        {initialTab === 'MCP' && (
                            <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                                <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '24px', gap: '24px' }}>
                                    <button
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: mcpTab === '已安装' ? 600 : 400, color: mcpTab === '已安装' ? '#1f2937' : '#6b7280', borderBottom: mcpTab === '已安装' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setMcpTab('已安装')}
                                    >
                                        {t('plugins.installed')}
                                    </button>
                                    <button
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: mcpTab === '设置' ? 600 : 400, color: mcpTab === '设置' ? '#1f2937' : '#6b7280', borderBottom: mcpTab === '设置' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setMcpTab('设置')}
                                    >
                                        {t('plugins.settings')}
                                    </button>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', alignItems: 'center' }}>
                                    <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                                        {t('plugins.mcpDesc')}
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button
                                            onClick={loadMCPData}
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

                                {mcpTab === '已安装' && (
                                    <div style={{ display: 'grid', gap: '16px' }}>
                                        {mcpServers.length === 0 && (
                                            <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '64px' }}>{t('plugins.noServers')}</div>
                                        )}
                                        {mcpServers.map((server, index) => {
                                            const toolCount = mcpTools.filter((tool: any) => tool.server === server.name).length;
                                            return (
                                                <div key={`${server.name}-${index}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 18px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                                                        <div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                                <span style={{ fontWeight: 600, color: '#111827' }}>{server.name}</span>
                                                                <span style={{ fontSize: '0.75rem', color: server.connected ? '#059669' : '#b45309', background: server.connected ? '#ecfdf5' : '#fffbeb', padding: '2px 8px', borderRadius: '999px' }}>
                                                                    {server.connected ? t('plugins.connected') : t('plugins.disconnected')}
                                                                </span>
                                                                {!server.enabled && (
                                                                    <span style={{ fontSize: '0.75rem', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: '999px' }}>{t('plugins.disabled')}</span>
                                                                )}
                                                            </div>
                                                            <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '4px' }}>{server.description || t('plugins.noDesc')}</div>
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
                                                            {t('plugins.edit')}
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
                                                        <h4 style={{ marginBottom: '4px', fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>MCP Server 设置</h4>
                                                        <p style={{ fontSize: '0.9rem', color: '#6b7280' }}>支持 stdio / http / sse 配置。当前前端优先接 stdio 主链路。</p>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                                        {/* Name & Transport */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>名称 (Name) <span style={{ color: '#ef4444' }}>*</span></div>
                                                                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', transition: 'border-color 0.2s, box-shadow 0.2s', '&:focus-within': { borderColor: '#a5b4fc', boxShadow: '0 0 0 2px #e0e7ff', background: '#fff' } } as any}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].name || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'name', e.target.value)} placeholder="如: my-database" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>Transport</div>
                                                                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', transition: 'border-color 0.2s, box-shadow 0.2s', '&:focus-within': { borderColor: '#a5b4fc', boxShadow: '0 0 0 2px #e0e7ff', background: '#fff' } } as any}>
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
                                                                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', transition: 'border-color 0.2s, box-shadow 0.2s', '&:focus-within': { borderColor: '#a5b4fc', boxShadow: '0 0 0 2px #e0e7ff', background: '#fff' } } as any}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].command || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'command', e.target.value)} placeholder="python / npx" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>{mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? 'Script Args' : 'URL'}</div>
                                                                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', transition: 'border-color 0.2s, box-shadow 0.2s', '&:focus-within': { borderColor: '#a5b4fc', boxShadow: '0 0 0 2px #e0e7ff', background: '#fff' } } as any}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? (mcpConfig.servers[selectedMcpServer].script || '') : (mcpConfig.servers[selectedMcpServer].url || '')} onChange={e => updateMcpServerField(selectedMcpServer, mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? 'script' : 'url', e.target.value)} placeholder={mcpConfig.servers[selectedMcpServer].transport === 'stdio' ? 'server.py' : 'https://...'} style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
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
                                                                    style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', margin: 0, width: '100%', minHeight: '80px', padding: '12px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }} 
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
                                                                    style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', margin: 0, width: '100%', minHeight: '80px', padding: '12px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }} 
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
                                                                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', transition: 'border-color 0.2s, box-shadow 0.2s', '&:focus-within': { borderColor: '#a5b4fc', boxShadow: '0 0 0 2px #e0e7ff', background: '#fff' } } as any}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].tool_prefix || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'tool_prefix', e.target.value)} placeholder="如: db_" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>Server Type</div>
                                                                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', transition: 'border-color 0.2s, box-shadow 0.2s', '&:focus-within': { borderColor: '#a5b4fc', boxShadow: '0 0 0 2px #e0e7ff', background: '#fff' } } as any}>
                                                                    <input value={mcpConfig.servers[selectedMcpServer].server_type || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'server_type', e.target.value)} placeholder="如: service / database" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Description */}
                                                        <div>
                                                            <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', color: '#374151' }}>简介描述 (Description)</div>
                                                            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', transition: 'border-color 0.2s, box-shadow 0.2s', '&:focus-within': { borderColor: '#a5b4fc', boxShadow: '0 0 0 2px #e0e7ff', background: '#fff' } } as any}>
                                                                <input value={mcpConfig.servers[selectedMcpServer].description || ''} onChange={e => updateMcpServerField(selectedMcpServer, 'description', e.target.value)} placeholder="用途说明" style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }} />
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
                                                            <div style={{ padding: '16px', borderRadius: '8px', marginTop: '20px', background: mcpTestResult.success ? '#ecfdf5' : '#fef2f2', border: `1px solid ${mcpTestResult.success ? '#6ee7b7' : '#fca5a5'}`, color: mcpTestResult.success ? '#065f46' : '#991b1b' }}>
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
                        {initialTab === 'Skills' && (
                            <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                                <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '24px', gap: '24px' }}>
                                    <button
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: skillsTab === '已安装' ? 600 : 400, color: skillsTab === '已安装' ? '#1f2937' : '#6b7280', borderBottom: skillsTab === '已安装' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setSkillsTab('已安装')}
                                    >
                                        {t('plugins.installed')}
                                    </button>
                                    <button
                                        style={{ paddingBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', fontWeight: skillsTab === '设置' ? 600 : 400, color: skillsTab === '设置' ? '#1f2937' : '#6b7280', borderBottom: skillsTab === '设置' ? '2px solid #1f2937' : '2px solid transparent' }}
                                        onClick={() => setSkillsTab('设置')}
                                    >
                                        {t('plugins.settings')}
                                    </button>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
                                    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', width: '300px' }}>
                                        <Search size={16} color="#9ca3af" style={{ marginRight: '8px' }} />
                                        <input placeholder={t('plugins.searchSkill') || "搜索 Skill"} style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.85rem' }} />
                                    </div>
                                    <button onClick={loadSkills} style={{ background: '#1f2937', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <RefreshCw size={16} /> {t('plugins.refresh')}
                                    </button>
                                </div>

                                {isLoadingSkills ? (
                                    <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '64px' }}>{t('plugins.loadingSkills') || '正在加载 Skills...'}</div>
                                ) : skills.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '64px' }}>
                                        {t('plugins.noSkills')}
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



                    </div>
                </div>
            </div>
        </div >
    );
};

export default PluginsModal;

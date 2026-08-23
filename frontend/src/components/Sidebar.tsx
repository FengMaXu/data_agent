import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    BookOpen,
    Settings,
    Languages,
    ChevronDown,
    ChevronRight,
    FileText,
    Folder,
    X,
    Save,
    Edit3,
    Trash2,
    Box,
    Database,
    Server,
    Sparkles,
    MessageSquare,
    Check,
    History,
    User,
    LogOut,
    Plus,
} from './icons/Typicons';
import {
    type KnowledgeFile,
} from '../api/client';
import { getSemanticSourceViaRuntime, listSemanticSourcesViaRuntime, readKnowledgeViaRuntime } from '../api/runtime-client';
import { listKnowledgeViaRuntime, saveKnowledgeViaRuntime } from '../api/runtime-client';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../hooks/useAuth';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { SemanticAssetViewer, SourceKindBadge, type SemanticConnection, type SemanticSourceViewDto } from './semantic-viewer';

interface SidebarProps {
    onOpenSettings: () => void;
    onOpenPlugins?: (tab: 'MCP' | 'Skills') => void;
}

interface KnowledgeFileNode {
    item: KnowledgeFile;
    children: KnowledgeFileNode[];
    level: number;
}

const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings, onOpenPlugins }) => {
    const {
        tasks,
        sessions,
        currentTask,
        currentSession,
        createTask,
        createSession,
        switchTask,
        switchSession,
        deleteTask,
        deleteSession,
        updateTaskName,
    } = useSession();
    const { t, language, toggleLanguage } = useLanguage();
    const { user, logout } = useAuth();
    const displayName = user?.display_name || user?.username || 'User';

    const [tasksExpanded, setTasksExpanded] = useState(true);
    const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editTaskName, setEditTaskName] = useState('');
    const [knowledgeExpanded, setKnowledgeExpanded] = useState(false);
    const [semanticExpanded, setSemanticExpanded] = useState(false);
    const [pluginsExpanded, setPluginsExpanded] = useState(false);
    const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
    const [semanticConnections, setSemanticConnections] = useState<SemanticConnection[]>([]);
    const [loadingSemantic, setLoadingSemantic] = useState(false);
    const [semanticExpandedConnections, setSemanticExpandedConnections] = useState<Set<string>>(new Set());
    const [loadingKnowledge, setLoadingKnowledge] = useState(false);
    const [knowledgeExpandedPaths, setKnowledgeExpandedPaths] = useState<Set<string>>(new Set(['doc']));
    const [editorOpen, setEditorOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null);
    const [fileContent, setFileContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [semanticViewerOpen, setSemanticViewerOpen] = useState(false);
    const [semanticDetail, setSemanticDetail] = useState<SemanticSourceViewDto | null>(null);
    const [loadingSemanticDetail, setLoadingSemanticDetail] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const editorOverlayRef = useRef<HTMLDivElement>(null);
    const editorModalRef = useRef<HTMLDivElement>(null);
    const semanticOverlayRef = useRef<HTMLDivElement>(null);
    const semanticModalRef = useRef<HTMLDivElement>(null);

    useFocusTrap(editorOpen, editorModalRef, editorOverlayRef);
    useFocusTrap(semanticViewerOpen, semanticModalRef, semanticOverlayRef);

    const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ text, type });
        if (type === 'success') {
            toastTimerRef.current = setTimeout(() => setToast(null), 3000);
        }
    }, []);

    useEffect(() => () => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    }, []);

    const loadKnowledgeFiles = useCallback(async () => {
        setLoadingKnowledge(true);
        try {
            const runtimeFiles = await listKnowledgeViaRuntime();
            const response = { files: runtimeFiles.map((f) => ({ name: f.path.split('/').pop() || f.path, path: f.path, size: f.size, modified_at: new Date(f.modifiedAt).toISOString(), type: 'file' as const })) };
            setKnowledgeFiles(response.files);
        } catch {
            showToast(t('knowledge.loadFailed') || '加载知识库失败', 'error');
        } finally {
            setLoadingKnowledge(false);
        }
    }, [showToast, t]);

    useEffect(() => {
        if (knowledgeExpanded && knowledgeFiles.length === 0) void loadKnowledgeFiles();
    }, [knowledgeExpanded, knowledgeFiles.length, loadKnowledgeFiles]);

    const loadSemanticSources = useCallback(async () => {
        setLoadingSemantic(true);
        try {
            const runtimeSources = await listSemanticSourcesViaRuntime();
            const byConnection = new Map<string, SemanticConnection>();
            for (const item of runtimeSources) {
                const connection = byConnection.get(item.connectionId) ?? { connectionId: item.connectionId, sources: [] as SemanticConnection['sources'] };
                connection.sources.push({ sourceName: item.sourceName, sourceKind: 'standalone', assetType: 'semantic_model', title: null, isQueryable: true, hasOverlay: false, description: '' });
                byConnection.set(item.connectionId, connection);
            }
            const response = { connections: Array.from(byConnection.values()) };
            setSemanticConnections(response.connections);
            setSemanticExpandedConnections((previous) => {
                if (previous.size > 0) return previous;
                return response.connections.length > 0 ? new Set([response.connections[0].connectionId]) : previous;
            });
        } catch (error) {
            console.error('Failed to load semantic assets:', error);
            showToast(t('semantic.loadFailed'), 'error');
        } finally {
            setLoadingSemantic(false);
        }
    }, [showToast, t]);

    useEffect(() => {
        if (semanticExpanded && semanticConnections.length === 0) void loadSemanticSources();
    }, [semanticExpanded, semanticConnections.length, loadSemanticSources]);

    useEffect(() => {
        if (!editorOpen && !semanticViewerOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (semanticViewerOpen) {
                    setSemanticViewerOpen(false);
                    setSemanticDetail(null);
                } else if (editorOpen) {
                    setEditorOpen(false);
                    setSelectedFile(null);
                    setFileContent('');
                    setIsEditing(false);
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [editorOpen, semanticViewerOpen]);

    const toggleExclusiveSection = (section: 'tasks' | 'knowledge' | 'semantic' | 'plugins') => {
        setTasksExpanded(section === 'tasks' ? !tasksExpanded : false);
        setKnowledgeExpanded(section === 'knowledge' ? !knowledgeExpanded : false);
        setSemanticExpanded(section === 'semantic' ? !semanticExpanded : false);
        setPluginsExpanded(section === 'plugins' ? !pluginsExpanded : false);
    };

    const toggleTask = (taskId: string) => {
        setExpandedTaskIds((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) next.delete(taskId);
            else next.add(taskId);
            return next;
        });
    };

    const commitTaskName = (taskId: string) => {
        updateTaskName(taskId, editTaskName);
        setEditingTaskId(null);
    };

    const openKnowledgeFile = async (file: KnowledgeFile) => {
        if (file.type === 'directory') return;
        setSelectedFile(file);
        setIsEditing(false);
        try {
            const response = await readKnowledgeViaRuntime(file.path);
            setFileContent(response);
            setEditorOpen(true);
        } catch (error) {
            console.error('Failed to load knowledge file:', error);
            showToast(t('editor.loadFailed'), 'error');
        }
    };

    const openSemanticSource = async (connectionId: string, sourceName: string) => {
        setSemanticViewerOpen(true);
        setSemanticDetail(null);
        setLoadingSemanticDetail(true);
        try {
            const detail = await getSemanticSourceViaRuntime(connectionId, sourceName);
            setSemanticDetail({ connectionId, sourceName, sourceKind: 'standalone', assetType: 'semantic_model', title: null, isQueryable: true, rawYaml: detail.rawYaml ?? '', table: null, sql: null, descriptions: {}, primaryDescription: null, descriptionProvenance: null, grain: [], columns: [], measures: [], segments: [], joins: [], tags: [], defaultTimeDimension: null, sourceDocuments: [], businessRules: [], queryTemplates: [] });
        } catch (error) {
            console.error('Failed to load semantic asset:', error);
            setSemanticViewerOpen(false);
            showToast(t('semantic.loadFailed'), 'error');
        } finally {
            setLoadingSemanticDetail(false);
        }
    };

    const closeSemanticViewer = () => {
        setSemanticViewerOpen(false);
        setSemanticDetail(null);
    };

    const toggleSemanticConnection = (connectionId: string) => {
        setSemanticExpandedConnections((previous) => {
            const next = new Set(previous);
            if (next.has(connectionId)) next.delete(connectionId);
            else next.add(connectionId);
            return next;
        });
    };

    const handleSave = async () => {
        if (!selectedFile) return;
        setSaving(true);
        try {
            await saveKnowledgeViaRuntime(selectedFile.path, fileContent);
            showToast(`${selectedFile.name} 已保存`);
            setIsEditing(false);
        } catch (error) {
            console.error('Failed to save knowledge file:', error);
            showToast(t('editor.saveFailed'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const closeEditor = () => {
        setEditorOpen(false);
        setSelectedFile(null);
        setFileContent('');
        setIsEditing(false);
    };

    const toggleKnowledgePath = (path: string) => {
        setKnowledgeExpandedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    const buildKnowledgeFileTree = (): KnowledgeFileNode[] => {
        const pathMap = new Map<string, KnowledgeFileNode>();
        knowledgeFiles.forEach((file) => {
            const parts = file.path.split('/');
            let currentPath = '';
            parts.forEach((part, index) => {
                currentPath = index === 0 ? part : `${currentPath}/${part}`;
                if (!pathMap.has(currentPath)) {
                    const isLast = index === parts.length - 1;
                    pathMap.set(currentPath, {
                        item: isLast ? file : {
                            name: part,
                            path: currentPath,
                            size: 0,
                            modified_at: '',
                            type: 'directory' as const,
                        },
                        children: [],
                        level: index,
                    });
                }
            });
        });

        const roots: KnowledgeFileNode[] = [];
        pathMap.forEach((node, path) => {
            const splitAt = path.lastIndexOf('/');
            const parent = splitAt >= 0 ? pathMap.get(path.slice(0, splitAt)) : undefined;
            if (parent) parent.children.push(node);
            else roots.push(node);
        });
        return roots;
    };

    const renderKnowledgeNode = (node: KnowledgeFileNode): React.ReactNode => {
        const { item, children, level } = node;
        const isDirectory = item.type === 'directory';
        const expanded = knowledgeExpandedPaths.has(item.path);
        return (
            <div key={item.path}>
                <button
                    type="button"
                    className={`knowledge-file-node ${isDirectory ? 'directory' : 'file'}`}
                    style={{ paddingLeft: `${12 + level * 16}px` }}
                    aria-expanded={isDirectory || children.length > 0 ? expanded : undefined}
                    onClick={() => isDirectory || children.length > 0 ? toggleKnowledgePath(item.path) : void openKnowledgeFile(item)}
                >
                    {isDirectory || children.length > 0 ? (
                        <span className="expand-icon">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                    ) : <span className="expand-icon" />}
                    {isDirectory ? <Folder size={14} className="file-icon" /> : <FileText size={14} className="file-icon" />}
                    <span className="file-name">{item.name}</span>
                </button>
                {expanded && children.map(renderKnowledgeNode)}
            </div>
        );
    };

    const knowledgeFileTree = buildKnowledgeFileTree();
    const isMarkdown = selectedFile?.name.toLowerCase().endsWith('.md');

    const renderSemanticConnection = (connection: SemanticConnection) => {
        const expanded = semanticExpandedConnections.has(connection.connectionId);
        return (
            <div className="semantic-connection" key={connection.connectionId}>
                <button type="button" className="semantic-connection-node" onClick={() => toggleSemanticConnection(connection.connectionId)}>
                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Database size={14} />
                    <span title={connection.connectionId}>{connection.connectionId}</span>
                    <span className="semantic-connection-count">{connection.sources.length}</span>
                </button>
                {expanded && (
                    <div className="semantic-source-list">
                        {connection.sources.map((source) => (
                            <button
                                type="button"
                                className="semantic-source-node"
                                key={source.sourceName}
                                onClick={() => void openSemanticSource(connection.connectionId, source.sourceName)}
                                title={source.description || source.sourceName}
                            >
                                <FileText size={13} />
                                <span className="semantic-source-name">{source.title || source.sourceName}</span>
                                {source.assetType === 'business_knowledge' && (
                                    <span className="semantic-asset-type-badge">{t('semantic.businessKnowledge')}</span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <nav id="workspace-sidebar" className="sidebar" aria-label={t('sidebar.navigation')}>
                <div className="nav-menu scrollable-area">
                    <div className="nav-section">
                        <div className="sidebar-logo">YourDB</div>

                        <button type="button" className="nav-item sidebar-primary-action" title={t('sidebar.newTask')} aria-label={t('sidebar.newTask')} onClick={() => {
                            createTask();
                            showToast(t('task.created') || '新任务创建成功');
                        }}>
                            <Edit3 className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.newTask')}</span>
                        </button>

                        <button type="button" className={`nav-item ${tasksExpanded ? 'expanded' : ''}`} title={t('sidebar.currentTask')} aria-label={t('sidebar.currentTask')} onClick={() => toggleExclusiveSection('tasks')}>
                            <History className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.currentTask')}</span>
                        </button>

                        {tasksExpanded && (
                            <div className="task-tree">
                                {tasks.map((task) => {
                                    const expanded = expandedTaskIds.has(task.id);
                                    const active = currentTask?.id === task.id && !currentSession;
                                    const taskSessions = sessions.filter((session) => session.taskId === task.id);
                                    return (
                                        <div className="task-tree-item" key={task.id}>
                                            <div className={`task-row ${active ? 'active' : ''}`}>
                                                <button
                                                    type="button"
                                                    className="task-select-btn"
                                                    onClick={() => {
                                                        switchTask(task.id);
                                                        toggleTask(task.id);
                                                    }}
                                                    aria-label={task.name}
                                                    aria-expanded={expanded}
                                                    aria-current={active ? 'page' : undefined}
                                                >
                                                    <span className="task-expand-indicator" aria-hidden="true">
                                                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                    </span>
                                                    <Folder size={14} aria-hidden="true" />
                                                    {editingTaskId !== task.id && <span className="task-name" title={task.name}>{task.name}</span>}
                                                </button>
                                                {editingTaskId === task.id && (
                                                    <input
                                                        className="task-name-input"
                                                        value={editTaskName}
                                                        onChange={(event) => setEditTaskName(event.target.value)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') commitTaskName(task.id);
                                                            if (event.key === 'Escape') setEditingTaskId(null);
                                                        }}
                                                        onBlur={() => commitTaskName(task.id)}
                                                        autoFocus
                                                        aria-label={task.name}
                                                    />
                                                )}
                                                <div className="task-actions">
                                                    <button type="button" className="tree-action-btn" onClick={() => {
                                                        setExpandedTaskIds((prev) => new Set(prev).add(task.id));
                                                        createSession(task.id);
                                                    }} title={t('session.create')} aria-label={t('session.create')}>
                                                        <Plus size={11} aria-hidden="true" />
                                                    </button>
                                                    {editingTaskId === task.id ? (
                                                        <button type="button" className="tree-action-btn" onMouseDown={(event) => event.preventDefault()} onClick={() => commitTaskName(task.id)} title={t('common.save')} aria-label={t('common.save')}>
                                                            <Check size={11} aria-hidden="true" />
                                                        </button>
                                                    ) : (
                                                        <button type="button" className="tree-action-btn" onClick={() => { setEditTaskName(task.name); setEditingTaskId(task.id); }} title={t('common.edit')} aria-label={t('common.edit')}>
                                                            <Edit3 size={11} aria-hidden="true" />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="tree-action-btn delete"
                                                        onClick={() => {
                                                            if (window.confirm(t('task.confirmDelete').replace('{name}', task.name))) deleteTask(task.id);
                                                        }}
                                                        title={t('common.delete')}
                                                        aria-label={t('common.delete')}
                                                    >
                                                        <Trash2 size={11} aria-hidden="true" />
                                                    </button>
                                                </div>
                                            </div>

                                            {expanded && (
                                                <div className="task-session-list">
                                                    {taskSessions.length === 0 && (
                                                        <div className="task-empty-sessions">{t('session.empty')}</div>
                                                    )}
                                                    {taskSessions.map((session) => (
                                                        <div key={session.id} className={`session-row ${currentSession?.id === session.id ? 'active' : ''}`}>
                                                            <button
                                                                type="button"
                                                                className="session-select-btn"
                                                                onClick={() => switchSession(session.id)}
                                                                aria-current={currentSession?.id === session.id ? 'page' : undefined}
                                                            >
                                                                <MessageSquare size={13} aria-hidden="true" />
                                                                <span className="session-name" title={session.name}>{session.name}</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="tree-action-btn session-delete-btn"
                                                                onClick={() => {
                                                                    if (window.confirm(t('session.confirmDelete').replace('{name}', session.name))) deleteSession(session.id);
                                                                }}
                                                                title={t('common.delete')}
                                                                aria-label={t('common.delete')}
                                                            >
                                                                <Trash2 size={11} aria-hidden="true" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <button type="button" className={`nav-item ${knowledgeExpanded ? 'expanded' : ''}`} title={t('sidebar.knowledge')} aria-label={t('sidebar.knowledge')} onClick={() => toggleExclusiveSection('knowledge')}>
                            <BookOpen className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.knowledge')}</span>
                        </button>
                        {knowledgeExpanded && (
                            <div className="knowledge-file-list">
                                {loadingKnowledge && knowledgeFiles.length === 0 ? (
                                    <div className="loading-state" role="status">{t('common.loading')}</div>
                                ) : knowledgeFileTree.length === 0 ? (
                                    <div className="empty-state sidebar-empty-state">
                                        <strong>{t('common.noKnowledgeFiles')}</strong>
                                        <span>{t('common.noKnowledgeFilesHint')}</span>
                                    </div>
                                ) : knowledgeFileTree.map(renderKnowledgeNode)}
                            </div>
                        )}

                        <button type="button" className={`nav-item ${semanticExpanded ? 'expanded' : ''}`} title={t('sidebar.semantic')} aria-label={t('sidebar.semantic')} onClick={() => toggleExclusiveSection('semantic')}>
                            <Database className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.semantic')}</span>
                        </button>
                        {semanticExpanded && (
                            <div className="semantic-asset-list">
                                {loadingSemantic && semanticConnections.length === 0 ? (
                                    <div className="loading-state" role="status">{t('common.loading')}</div>
                                ) : semanticConnections.length === 0 ? (
                                    <div className="empty-state sidebar-empty-state">
                                        <strong>{t('common.noSemanticAssets')}</strong>
                                        <span>{t('common.noSemanticAssetsHint')}</span>
                                    </div>
                                ) : semanticConnections.map(renderSemanticConnection)}
                            </div>
                        )}

                        <button type="button" className={`nav-item ${pluginsExpanded ? 'expanded' : ''}`} title={t('sidebar.plugins')} aria-label={t('sidebar.plugins')} onClick={() => toggleExclusiveSection('plugins')}>
                            <Box className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.plugins')}</span>
                        </button>
                        {pluginsExpanded && (
                            <div className="sidebar-plugin-list">
                                <button type="button" className="nav-item sidebar-plugin-item" title="MCP" aria-label="MCP" onClick={() => onOpenPlugins?.('MCP')}>
                                    <Server className="nav-item-icon" size={16} />
                                    <span className="nav-item-text sidebar-plugin-text">MCP</span>
                                </button>
                                <button type="button" className="nav-item sidebar-plugin-item" title="Skills" aria-label="Skills" onClick={() => onOpenPlugins?.('Skills')}>
                                    <Sparkles className="nav-item-icon" size={16} />
                                    <span className="nav-item-text sidebar-plugin-text">Skills</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="sidebar-footer">
                    <div className="nav-item sidebar-footer-user" title={user?.username || displayName}>
                        <User className="nav-item-icon" size={18} />
                        <span className="nav-item-text">{displayName}</span>
                    </div>
                    <button type="button" className="nav-item sidebar-footer-settings" onClick={toggleLanguage} title={t('sidebar.langToggle')} aria-label={t('sidebar.langToggle')}>
                        <Languages className="nav-item-icon" size={18} />
                        <span className="nav-item-text">{language === 'zh' ? 'EN' : '中文'}</span>
                    </button>
                    <button type="button" className="nav-item sidebar-footer-settings" onClick={onOpenSettings} title={t('sidebar.settings')} aria-label={t('sidebar.settings')}>
                        <Settings className="nav-item-icon" size={18} />
                        <span className="nav-item-text">{t('sidebar.settings')}</span>
                    </button>
                    <button type="button" className="nav-item sidebar-footer-settings" onClick={() => void logout()} title={t('sidebar.logout')} aria-label={t('sidebar.logout')}>
                        <LogOut className="nav-item-icon" size={18} />
                        <span className="nav-item-text">{t('sidebar.logout')}</span>
                    </button>
                </div>

                {toast && (
                    <div className={`sidebar-toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
                        <span>{toast.text}</span>
                        {toast.type === 'error' && (
                            <button type="button" className="sidebar-toast-close" onClick={() => setToast(null)} aria-label={t('common.close')}>
                                <X size={13} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                )}
            </nav>

            {editorOpen && selectedFile && (
                <div ref={editorOverlayRef} className="editor-modal-overlay" onClick={closeEditor}>
                    <div ref={editorModalRef} className="editor-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="editor-modal-title" tabIndex={-1}>
                        <div className="editor-modal-header">
                            <div className="editor-title" id="editor-modal-title"><FileText size={16} aria-hidden="true" /><span>{selectedFile.name}</span></div>
                            <div className="editor-actions">
                                {isMarkdown && !isEditing && <button type="button" className="action-btn" onClick={() => setIsEditing(true)} title={t('editor.edit')} aria-label={t('editor.edit')}><Edit3 size={14} aria-hidden="true" /></button>}
                                {isEditing && <button type="button" className="action-btn save" onClick={handleSave} disabled={saving} title={t('editor.save')} aria-label={t('editor.save')}><Save size={14} aria-hidden="true" /></button>}
                                <button type="button" className="action-btn" onClick={closeEditor} title={t('editor.close')} aria-label={t('editor.close')}><X size={14} aria-hidden="true" /></button>
                            </div>
                        </div>
                        <div className="editor-modal-content">
                            {isMarkdown && !isEditing ? (
                                <div className="editor-preview markdown-preview"><div className="markdown-content"><ReactMarkdown>{fileContent}</ReactMarkdown></div></div>
                            ) : !isEditing ? (
                                <div className="editor-preview plain-preview"><pre>{fileContent}</pre></div>
                            ) : (
                                <textarea className="editor-textarea" value={fileContent} onChange={(event) => setFileContent(event.target.value)} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {semanticViewerOpen && (
                <div ref={semanticOverlayRef} className="semantic-modal-overlay" onClick={closeSemanticViewer}>
                    <div ref={semanticModalRef} className="semantic-asset-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="semantic-modal-title" tabIndex={-1}>
                        <div className="semantic-modal-header">
                            <div className="semantic-modal-title" id="semantic-modal-title">
                                <Database size={16} aria-hidden="true" />
                                <span>{semanticDetail?.assetType === 'business_knowledge'
                                    ? (semanticDetail.title || semanticDetail.sourceName)
                                    : (semanticDetail?.sourceName || t('sidebar.semantic'))}</span>
                                {semanticDetail && (semanticDetail.assetType === 'business_knowledge' ? (
                                    <span className="semantic-asset-type-badge">{t('semantic.businessKnowledge')}</span>
                                ) : (
                                    <>
                                        <SourceKindBadge kind={semanticDetail.sourceKind} />
                                        {semanticDetail.isQueryable && <span className="semantic-queryable-badge">{t('semantic.queryable')}</span>}
                                    </>
                                ))}
                            </div>
                            <button type="button" className="semantic-modal-close" onClick={closeSemanticViewer} title={t('semantic.close')} aria-label={t('semantic.close')}>
                                <X size={16} aria-hidden="true" />
                            </button>
                        </div>
                        <div className="semantic-modal-content">
                            {loadingSemanticDetail || !semanticDetail ? (
                                <div className="semantic-loading-state" role="status">{t('semantic.loading')}</div>
                            ) : (
                                <SemanticAssetViewer dto={semanticDetail} onClose={closeSemanticViewer} />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Sidebar;

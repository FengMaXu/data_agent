import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    BookOpen,
    HardDrive,
    Settings,
    ChevronDown,
    ChevronRight,
    FileText,
    Folder,
    RefreshCw,
    X,
    Save,
    Edit3,
    Download,
    Trash2,
    Clock,
    Image,
    Paperclip,
    Box,
    Server,
    Sparkles,
    MessageSquare,
    Check,
    History,
} from 'lucide-react';
import {
    getKnowledgeFiles,
    getKnowledgeContent,
    saveKnowledgeContent,
    type KnowledgeFile,
    getWorkspaceFiles,
    uploadWorkspaceFile,
    deleteWorkspaceFile,
    getWorkspaceFileDownloadUrl,
    type WorkspaceFile,
} from '../api/client';
import { FileIcon } from './FileIcons';
import { formatFileSize, formatTime } from '../utils/helpers';
import ReactMarkdown from 'react-markdown';
import { useSession, type Session } from '../hooks/useSession';
import { useLanguage } from '../context/LanguageContext';

interface SidebarProps {
    onOpenSettings: () => void;
    onOpenWorkspace: () => void;
    onOpenPlugins?: (tab: 'MCP' | 'Skills') => void;
}

interface KnowledgeFileNode {
    item: KnowledgeFile;
    children: KnowledgeFileNode[];
    expanded: boolean;
    level: number;
}

const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings, onOpenWorkspace, onOpenPlugins }) => {
    const {
        sessions,
        currentSession,
        createSession,
        switchSession,
        deleteSession,
        updateSessionName,
        attachedFiles,
        toggleAttachedFile,
        isFileAttached,
    } = useSession();

    const { t, language, toggleLanguage } = useLanguage();

    const [knowledgeExpanded, setKnowledgeExpanded] = useState(false);
    const [pluginsExpanded, setPluginsExpanded] = useState(false);
    const [historyExpanded, setHistoryExpanded] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editSessionName, setEditSessionName] = useState('');
    const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
    const [loadingKnowledge, setLoadingKnowledge] = useState(false);
    const [knowledgeExpandedPaths, setKnowledgeExpandedPaths] = useState<Set<string>>(new Set(['doc']));

    const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
    const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
    const [loadingWorkspace, setLoadingWorkspace] = useState(false);
    const [deletingPath, setDeletingPath] = useState<string | null>(null);

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<'knowledge' | 'workspace-preview'>('knowledge');
    const [selectedFile, setSelectedFile] = useState<KnowledgeFile | WorkspaceFile | null>(null);
    const [fileContent, setFileContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
        setToast({ text, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    const loadKnowledgeFiles = useCallback(async () => {
        setLoadingKnowledge(true);
        try {
            const res = await getKnowledgeFiles();
            setKnowledgeFiles(res.files);
        } catch (e: any) {
            showToast('加载知识库失败', 'error');
        } finally {
            setLoadingKnowledge(false);
        }
    }, [showToast]);

    const loadWorkspaceFiles = useCallback(async () => {
        setLoadingWorkspace(true);
        try {
            const res = await getWorkspaceFiles(currentSession.id);
            const sortedFiles = [...res.files].sort((a, b) =>
                new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime(),
            );
            setWorkspaceFiles(sortedFiles);
        } catch (e: any) {
            showToast('加载工作区失败', 'error');
        } finally {
            setLoadingWorkspace(false);
        }
    }, [currentSession.id, showToast]);

    const debouncedLoadWorkspaceFiles = useCallback(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            loadWorkspaceFiles();
        }, 500);
    }, [loadWorkspaceFiles]);

    useEffect(() => {
        if (knowledgeExpanded && knowledgeFiles.length === 0) {
            loadKnowledgeFiles();
        }
    }, [knowledgeExpanded, knowledgeFiles.length, loadKnowledgeFiles]);

    useEffect(() => {
        if (workspaceExpanded) {
            loadWorkspaceFiles();
        }
    }, [workspaceExpanded, loadWorkspaceFiles]);

    useEffect(() => {
        const handler = () => {
            if (workspaceExpanded) {
                debouncedLoadWorkspaceFiles();
            }
        };
        window.addEventListener('workspace_updated', handler);
        return () => {
            window.removeEventListener('workspace_updated', handler);
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [debouncedLoadWorkspaceFiles, workspaceExpanded]);

    useEffect(() => {
        if (workspaceExpanded) {
            loadWorkspaceFiles();
        }
    }, [currentSession.id, workspaceExpanded, loadWorkspaceFiles]);

    const toggleHistory = () => {
        setHistoryExpanded(!historyExpanded);
        if (workspaceExpanded) setWorkspaceExpanded(false);
        if (knowledgeExpanded) setKnowledgeExpanded(false);
        if (pluginsExpanded) setPluginsExpanded(false);
    };

    const toggleKnowledge = () => {
        setKnowledgeExpanded(!knowledgeExpanded);
        if (workspaceExpanded) setWorkspaceExpanded(false);
        if (pluginsExpanded) setPluginsExpanded(false);
        if (historyExpanded) setHistoryExpanded(false);
    };

    const toggleWorkspace = () => {
        setWorkspaceExpanded(!workspaceExpanded);
        if (knowledgeExpanded) setKnowledgeExpanded(false);
        if (pluginsExpanded) setPluginsExpanded(false);
        if (historyExpanded) setHistoryExpanded(false);
    };

    const togglePlugins = () => {
        setPluginsExpanded(!pluginsExpanded);
        if (knowledgeExpanded) setKnowledgeExpanded(false);
        if (workspaceExpanded) setWorkspaceExpanded(false);
        if (historyExpanded) setHistoryExpanded(false);
    };

    const toggleExpand = (path: string) => {
        setKnowledgeExpandedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    };

    const openKnowledgeFile = async (file: KnowledgeFile) => {
        if (file.type === 'directory') return;

        setSelectedFile(file);
        setIsEditing(false);
        setEditorMode('knowledge');
        try {
            const res = await getKnowledgeContent(file.path);
            setFileContent(res.content);
            setEditorOpen(true);
        } catch (e: any) {
            showToast(`加载文件失败: ${e.message}`, 'error');
        }
    };

    const previewWorkspaceFile = async (file: WorkspaceFile) => {
        setSelectedFile(file);
        setEditorMode('workspace-preview');
        setEditorOpen(true);

        const lower = file.name.toLowerCase();
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp')) {
            setFileContent(getWorkspaceFileDownloadUrl(file.relative_path));
            return;
        }

        if (lower.endsWith('.csv') || lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.json')) {
            try {
                const response = await fetch(getWorkspaceFileDownloadUrl(file.relative_path));
                setFileContent(await response.text());
            } catch {
                setFileContent('无法预览此文件');
            }
            return;
        }

        setFileContent('');
    };

    const handleSave = async () => {
        if (!selectedFile || editorMode !== 'knowledge' || !('path' in selectedFile)) return;

        setSaving(true);
        try {
            await saveKnowledgeContent(selectedFile.path, fileContent);
            showToast(`${selectedFile.name} 已保存`);
            setIsEditing(false);
        } catch (e: any) {
            showToast(`保存失败: ${e.message}`, 'error');
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

    const handleFileUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        for (const file of Array.from(files)) {
            try {
                await uploadWorkspaceFile(file, currentSession.id);
                showToast(`${file.name} 上传成功`);
            } catch (e: any) {
                showToast(`上传失败: ${e.message}`, 'error');
            }
        }
        await loadWorkspaceFiles();
        window.dispatchEvent(new CustomEvent('workspace_updated'));
    };

    const handleDeleteFile = async (file: WorkspaceFile) => {
        if (!window.confirm(`确定要删除 "${file.name}" 吗？`)) return;
        setDeletingPath(file.relative_path);
        try {
            await deleteWorkspaceFile(file.relative_path);
            showToast(`${file.name} 已删除`);
            await loadWorkspaceFiles();
            window.dispatchEvent(new CustomEvent('workspace_updated'));
        } catch (e: any) {
            showToast(`删除失败: ${e.message}`, 'error');
        } finally {
            setDeletingPath(null);
        }
    };

    const handleDownloadFile = (file: WorkspaceFile) => {
        const a = document.createElement('a');
        a.href = getWorkspaceFileDownloadUrl(file.relative_path);
        a.target = '_blank';
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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
                    const nodeItem = isLast
                        ? file
                        : {
                            name: part,
                            path: currentPath,
                            size: 0,
                            modified_at: '',
                            type: 'directory' as const,
                        };

                    pathMap.set(currentPath, {
                        item: nodeItem,
                        children: [],
                        expanded: knowledgeExpandedPaths.has(currentPath),
                        level: index,
                    });
                }
            });
        });

        const rootNodes: KnowledgeFileNode[] = [];
        pathMap.forEach((node, path) => {
            const lastSlashIndex = path.lastIndexOf('/');
            if (lastSlashIndex !== -1) {
                const parentPath = path.substring(0, lastSlashIndex);
                const parentNode = pathMap.get(parentPath);
                if (parentNode) {
                    parentNode.children.push(node);
                }
            } else {
                rootNodes.push(node);
            }
        });

        return rootNodes;
    };

    const renderKnowledgeFileNode = (node: KnowledgeFileNode): React.ReactNode => {
        const { item, children, level } = node;
        const isExpanded = knowledgeExpandedPaths.has(item.path);
        const hasChildren = children.length > 0;
        const isDirectory = item.type === 'directory';

        return (
            <div key={item.path}>
                <div
                    className={`knowledge-file-node ${isDirectory ? 'directory' : 'file'}`}
                    style={{ paddingLeft: `${12 + level * 16}px` }}
                    onClick={() => {
                        if (hasChildren || isDirectory) {
                            toggleExpand(item.path);
                        } else {
                            openKnowledgeFile(item);
                        }
                    }}
                >
                    {hasChildren || isDirectory ? (
                        <span className="expand-icon">
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                    ) : (
                        <span className="expand-icon" />
                    )}
                    {isDirectory ? (
                        <Folder size={14} className="file-icon" />
                    ) : (
                        <FileText size={14} className="file-icon" />
                    )}
                    <span className="file-name">{item.name}</span>
                </div>
                {hasChildren && isExpanded && children.map((child) => renderKnowledgeFileNode(child))}
            </div>
        );
    };

    const knowledgeFileTree = buildKnowledgeFileTree();
    const isMarkdown = selectedFile?.name.endsWith('.md');
    const isImagePreview = editorMode === 'workspace-preview' && Boolean(
        selectedFile?.name.toLowerCase().endsWith('.png') ||
        selectedFile?.name.toLowerCase().endsWith('.jpg') ||
        selectedFile?.name.toLowerCase().endsWith('.jpeg') ||
        selectedFile?.name.toLowerCase().endsWith('.gif') ||
        selectedFile?.name.toLowerCase().endsWith('.webp'),
    );
    const isReadOnlyPreview = editorMode === 'workspace-preview' || !isEditing;

    const handleCreateSession = () => {
        createSession();
        showToast('新工作区创建成功');
    };


    return (
        <>
            <nav className="sidebar">
                <div className="nav-menu scrollable-area">
                    <div className="nav-section">
                        <div className="sidebar-logo" style={{
                            fontSize: '1.25rem',
                            fontWeight: 700,
                            padding: '0 12px 16px',
                            color: '#1f2937',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            letterSpacing: '-0.5px',
                        }}>
                            <img
                                src="/yourdb-logo.png"
                                alt="YourDB logo"
                                style={{ width: '28px', height: '28px', borderRadius: '6px', objectFit: 'contain' }}
                            />
                            YourDB
                        </div>

                        <button className="nav-item" onClick={handleCreateSession} style={{ marginBottom: '8px' }}>
                            <Edit3 className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.newWorkspace')}</span>
                        </button>


                        <button className={`nav-item ${historyExpanded ? 'expanded' : ''}`} onClick={toggleHistory}>
                            <History className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.history')}</span>
                            <ChevronDown className={`expand-arrow ${historyExpanded ? 'rotated' : ''}`} size={14} />
                        </button>

                        {historyExpanded && (
                            <div className="workspace-file-list" style={{ padding: '4px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {sessions.map((session) => (
                                    <div
                                        key={session.id}
                                        className={`workspace-file-item ${currentSession.id === session.id ? 'active' : ''}`}
                                        onClick={() => {
                                            if (editingSessionId !== session.id) {
                                                switchSession(session.id);
                                            }
                                        }}
                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', background: currentSession.id === session.id ? '#f3f4f6' : 'transparent', marginBottom: '2px' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', flex: 1 }}>
                                            <MessageSquare size={14} style={{ flexShrink: 0 }} color={currentSession.id === session.id ? '#3b82f6' : '#6b7280'} />
                                            {editingSessionId === session.id ? (
                                                <input
                                                    type="text"
                                                    value={editSessionName}
                                                    onChange={(e) => setEditSessionName(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            updateSessionName(session.id, editSessionName);
                                                            setEditingSessionId(null);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingSessionId(null);
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        updateSessionName(session.id, editSessionName);
                                                        setEditingSessionId(null);
                                                    }}
                                                    autoFocus
                                                    style={{ outline: 'none', border: '1px solid #d1d5db', borderRadius: '4px', padding: '2px 4px', fontSize: '0.85rem', width: '100px' }}
                                                />
                                            ) : (
                                                <span className="workspace-file-name" style={{ fontSize: '0.85rem', color: currentSession.id === session.id ? '#111827' : '#4b5563', fontWeight: currentSession.id === session.id ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={session.name}>
                                                    {session.name}
                                                </span>
                                            )}
                                        </div>
                                        {currentSession.id === session.id && (
                                            <div className="workspace-file-actions" onClick={(e) => e.stopPropagation()} style={{ display: 'flex' }}>
                                                {editingSessionId === session.id ? (
                                                    <button className="workspace-action-btn" onClick={() => { updateSessionName(session.id, editSessionName); setEditingSessionId(null); }} title="Save">
                                                        <Check size={12} color="#10b981" />
                                                    </button>
                                                ) : (
                                                    <button className="workspace-action-btn" onClick={() => { setEditSessionName(session.name); setEditingSessionId(session.id); }} title="Edit">
                                                        <Edit3 size={12} />
                                                    </button>
                                                )}
                                                <button className="workspace-action-btn delete" onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm(`确认删除工作区 "${session.name}" 吗？\n删除后历史对话和文件将不可见。`)) {
                                                        deleteSession(session.id);
                                                    }
                                                }} title="Delete" disabled={sessions.length <= 1}>
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        <button className={`nav-item ${knowledgeExpanded ? 'expanded' : ''}`} onClick={toggleKnowledge}>
                            <BookOpen className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.knowledge')}</span>
                            <ChevronDown className={`expand-arrow ${knowledgeExpanded ? 'rotated' : ''}`} size={14} />
                        </button>

                        {knowledgeExpanded && (
                            <div className="knowledge-file-list">
                                {loadingKnowledge && knowledgeFiles.length === 0 ? (
                                    <div className="loading-state">加载中...</div>
                                ) : knowledgeFileTree.length === 0 ? (
                                    <div className="empty-state">暂无知识库文件</div>
                                ) : (
                                    knowledgeFileTree.map((node) => renderKnowledgeFileNode(node))
                                )}
                            </div>
                        )}

                        <button className={`nav-item ${workspaceExpanded ? 'expanded' : ''}`} onClick={toggleWorkspace}>
                            <HardDrive className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.workspace')}</span>
                            <ChevronDown className={`expand-arrow ${workspaceExpanded ? 'rotated' : ''}`} size={14} />
                        </button>

                        {workspaceExpanded && (
                            <div className="workspace-file-list">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        handleFileUpload(e.target.files);
                                        e.target.value = '';
                                    }}
                                />


                                <div className="workspace-list-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span className="file-count">{workspaceFiles.length} 文件 · 已附加 {attachedFiles.length}</span>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="refresh-btn" onClick={() => fileInputRef.current?.click()} title="上传文件">
                                            <Paperclip size={12} />
                                        </button>
                                        <button className="refresh-btn" onClick={loadWorkspaceFiles} disabled={loadingWorkspace} title="刷新">
                                            <RefreshCw size={12} className={loadingWorkspace ? 'spin' : ''} />
                                        </button>
                                    </div>
                                </div>

                                {loadingWorkspace && workspaceFiles.length === 0 ? (
                                    <div className="loading-state">加载中...</div>
                                ) : workspaceFiles.length === 0 ? (
                                    <div className="empty-state">暂无文件</div>
                                ) : (
                                    <div className="workspace-files">
                                        {workspaceFiles.map((file) => {
                                            const attached = isFileAttached(file.relative_path);
                                            return (
                                                <div
                                                    key={file.relative_path}
                                                    className={`workspace-file-item ${deletingPath === file.relative_path ? 'deleting' : ''}`}
                                                    onClick={() => previewWorkspaceFile(file)}
                                                >
                                                    <div className="workspace-file-icon">
                                                        <FileIcon filename={file.name} size={16} />
                                                    </div>
                                                    <div className="workspace-file-info">
                                                        <div className="workspace-file-name" title={file.name}>{file.name}</div>
                                                        <div className="workspace-file-meta">
                                                            <span>{formatFileSize(file.size)}</span>
                                                            <span className="file-time">
                                                                <Clock size={10} />
                                                                {formatTime(file.modified_at)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="workspace-file-actions" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            className="workspace-action-btn download"
                                                            onClick={() => toggleAttachedFile(file.relative_path)}
                                                            title={attached ? '取消附加到当前提问' : '附加到当前提问'}
                                                            style={{ color: attached ? '#1d4ed8' : undefined }}
                                                        >
                                                            <Paperclip size={12} />
                                                        </button>
                                                        <button className="workspace-action-btn download" onClick={() => handleDownloadFile(file)} title="下载">
                                                            <Download size={12} />
                                                        </button>
                                                        <button
                                                            className="workspace-action-btn delete"
                                                            onClick={() => handleDeleteFile(file)}
                                                            title="删除"
                                                            disabled={deletingPath === file.relative_path}
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Plugins */}
                        <button className={`nav-item ${pluginsExpanded ? 'expanded' : ''}`} onClick={togglePlugins}>
                            <Box className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.plugins')}</span>
                            <ChevronDown className={`expand-arrow ${pluginsExpanded ? 'rotated' : ''}`} size={14} />
                        </button>

                        {pluginsExpanded && (
                            <div className="workspace-file-list" style={{ padding: '4px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <button className="nav-item" onClick={() => onOpenPlugins?.('MCP')} style={{ paddingLeft: '32px', height: '36px', width: '100%', marginBottom: '4px' }}>
                                    <Server className="nav-item-icon" size={16} />
                                    <span className="nav-item-text" style={{ fontSize: '0.9rem' }}>MCP</span>
                                </button>
                                <button className="nav-item" onClick={() => onOpenPlugins?.('Skills')} style={{ paddingLeft: '32px', height: '36px', width: '100%' }}>
                                    <Sparkles className="nav-item-icon" size={16} />
                                    <span className="nav-item-text" style={{ fontSize: '0.9rem' }}>Skills</span>
                                </button>
                            </div>
                        )}

                    </div>
                </div>

                <div className="sidebar-footer">
                    <button className="nav-item lang-toggle" onClick={toggleLanguage} style={{
                        padding: '6px 12px',
                        background: 'transparent',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        color: '#6b7280',
                        fontWeight: 600,
                        marginLeft: 'auto',
                        marginRight: '12px'
                    }}>
                        {language === 'zh' ? 'EN' : '中文'}
                    </button>
                    <button className="nav-item" onClick={onOpenSettings}>
                        <Settings className="nav-item-icon" size={18} />
                        <span className="nav-item-text">{t('sidebar.settings')}</span>
                    </button>
                </div>

                {toast && (
                    <div className={`sidebar-toast ${toast.type}`}>
                        <span>{toast.text}</span>
                    </div>
                )}
            </nav>

            {editorOpen && selectedFile && (
                <div className="editor-modal-overlay" onClick={closeEditor}>
                    <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="editor-modal-header">
                            <div className="editor-title">
                                {editorMode === 'workspace-preview' && isImagePreview ? (
                                    <Image size={16} />
                                ) : (
                                    <FileText size={16} />
                                )}
                                <span>{selectedFile.name}</span>
                            </div>
                            <div className="editor-actions">
                                {editorMode === 'knowledge' && isMarkdown && !isEditing && (
                                    <button className="action-btn" onClick={() => setIsEditing(true)} title="编辑">
                                        <Edit3 size={14} />
                                    </button>
                                )}
                                {editorMode === 'knowledge' && isEditing && (
                                    <button className="action-btn save" onClick={handleSave} disabled={saving} title="保存">
                                        <Save size={14} />
                                    </button>
                                )}
                                <button className="action-btn" onClick={closeEditor} title="关闭">
                                    <X size={14} />
                                </button>
                            </div>
                        </div>

                        <div className="editor-modal-content">
                            {editorMode === 'workspace-preview' && isImagePreview ? (
                                <div className="editor-preview image-preview">
                                    <img src={fileContent} alt={selectedFile.name} style={{ maxWidth: '100%', borderRadius: '8px' }} />
                                </div>
                            ) : editorMode === 'knowledge' && isMarkdown && !isEditing ? (
                                <div className="editor-preview markdown-preview">
                                    <div className="markdown-content">
                                        <ReactMarkdown>{fileContent}</ReactMarkdown>
                                    </div>
                                </div>
                            ) : isReadOnlyPreview ? (
                                <div className="editor-preview plain-preview">
                                    <pre>{fileContent}</pre>
                                </div>
                            ) : (
                                <textarea
                                    className="editor-textarea"
                                    value={fileContent}
                                    onChange={(e) => setFileContent(e.target.value)}
                                    readOnly={false}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Sidebar;

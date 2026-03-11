import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    MessageSquare,
    BookOpen,
    HardDrive,
    BarChart2,
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
    Plus,
    Users,
} from 'lucide-react';
import {
    getKnowledgeFiles, getKnowledgeContent, saveKnowledgeContent, type KnowledgeFile,
    getWorkspaceFiles, uploadWorkspaceFile, deleteWorkspaceFile, getWorkspaceFileDownloadUrl, type WorkspaceFile
} from '../api/client';
import { FileIcon } from './FileIcons';
import { formatFileSize, formatTime } from '../utils/helpers';
import ReactMarkdown from 'react-markdown';
import { useSession, type Session } from '../hooks/useSession';

interface SidebarProps {
    onOpenSettings: () => void;
    onOpenWorkspace?: () => void;
}

interface KnowledgeFileNode {
    item: KnowledgeFile;
    children: KnowledgeFileNode[];
    expanded: boolean;
    level: number;
}

const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings }) => {
    // 会话管理
    const { currentSession, sessions, createSession, switchSession, deleteSession, updateSessionName } = useSession();

    // 会话选择器状态
    const [sessionSelectorOpen, setSessionSelectorOpen] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingSessionName, setEditingSessionName] = useState('');

    // Knowledge 状态
    const [knowledgeExpanded, setKnowledgeExpanded] = useState(false);
    const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
    const [loadingKnowledge, setLoadingKnowledge] = useState(false);
    const [knowledgeExpandedPaths, setKnowledgeExpandedPaths] = useState<Set<string>>(new Set(['doc']));

    // Workspace 状态
    const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
    const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
    const [loadingWorkspace, setLoadingWorkspace] = useState(false);
    const [deletingPath, setDeletingPath] = useState<string | null>(null);

    // 编辑器模态框状态
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<'knowledge' | 'workspace-preview'>('knowledge');
    const [selectedFile, setSelectedFile] = useState<any>(null);
    const [fileContent, setFileContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // 加载知识库文件
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
    }, []);

    // 加载工作区文件
    const loadWorkspaceFiles = useCallback(async () => {
        setLoadingWorkspace(true);
        try {
            const res = await getWorkspaceFiles(currentSession.id);
            // Sort by modified_at descending
            const sortedFiles = [...res.files].sort((a, b) =>
                new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime()
            );
            setWorkspaceFiles(sortedFiles);
        } catch (e: any) {
            showToast('加载工作区失败', 'error');
        } finally {
            setLoadingWorkspace(false);
        }
    }, [currentSession.id]);

    // 防抖版本的 loadWorkspaceFiles（500ms），避免 watcher 与工具结果重复刷新
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debouncedLoadWorkspaceFiles = useCallback(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            loadWorkspaceFiles();
        }, 500);
    }, [loadWorkspaceFiles]);

    // 首次展开时加载文件
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

    // 监听工作区更新事件（使用防抖避免频繁刷新）
    useEffect(() => {
        const handler = () => {
            if (workspaceExpanded) {
                debouncedLoadWorkspaceFiles();
            }
        };
        window.addEventListener('workspace_updated', handler);
        return () => {
            window.removeEventListener('workspace_updated', handler);
            // 清理防抖定时器
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [debouncedLoadWorkspaceFiles, workspaceExpanded]);

    const showToast = (text: string, type: 'success' | 'error' = 'success') => {
        setToast({ text, type });
        setTimeout(() => setToast(null), 3000);
    };

    // Knowledge 展开/折叠
    const toggleKnowledge = () => {
        setKnowledgeExpanded(!knowledgeExpanded);
        // 关闭 Workspace
        if (workspaceExpanded) setWorkspaceExpanded(false);
    };

    const toggleWorkspace = () => {
        setWorkspaceExpanded(!workspaceExpanded);
        // 关闭 Knowledge
        if (knowledgeExpanded) setKnowledgeExpanded(false);
    };

    const toggleExpand = (path: string, isKnowledge: boolean) => {
        const setter = isKnowledge ? setKnowledgeExpandedPaths : (v: any) => v;
        setter((prev: Set<string>) => {
            const newSet = new Set(prev);
            if (newSet.has(path)) {
                newSet.delete(path);
            } else {
                newSet.add(path);
            }
            return newSet;
        });
    };

    // 打开 Knowledge 文件编辑
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

    // 预览 Workspace 文件
    const previewWorkspaceFile = async (file: WorkspaceFile) => {
        setSelectedFile(file);
        setEditorMode('workspace-preview');
        setEditorOpen(true);

        // 尝试预览图片
        if (file.name.toLowerCase().endsWith('.png') ||
            file.name.toLowerCase().endsWith('.jpg') ||
            file.name.toLowerCase().endsWith('.jpeg') ||
            file.name.toLowerCase().endsWith('.gif') ||
            file.name.toLowerCase().endsWith('.webp')) {
            const url = getWorkspaceFileDownloadUrl(file.relative_path);
            setFileContent(url); // 使用 URL 作为内容
        } else if (file.name.toLowerCase().endsWith('.csv') ||
            file.name.toLowerCase().endsWith('.md') ||
            file.name.toLowerCase().endsWith('.txt') ||
            file.name.toLowerCase().endsWith('.json')) {
            // 尝试获取文本内容
            try {
                const response = await fetch(getWorkspaceFileDownloadUrl(file.relative_path));
                const text = await response.text();
                setFileContent(text);
            } catch (e) {
                setFileContent('无法预览此文件');
            }
        } else {
            setFileContent(''); // 不支持的预览类型
        }
    };

    const handleSave = async () => {
        if (!selectedFile || editorMode !== 'knowledge') return;

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

    // 处理文件上传
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
        if (workspaceExpanded) {
            loadWorkspaceFiles();
        }
    };

    // 处理删除文件
    const handleDeleteFile = async (file: WorkspaceFile) => {
        if (!window.confirm(`确定要删除 "${file.name}" 吗？`)) return;
        setDeletingPath(file.relative_path);
        try {
            await deleteWorkspaceFile(file.relative_path);
            showToast(`${file.name} 已删除`);
            await loadWorkspaceFiles();
        } catch (e: any) {
            showToast(`删除失败: ${e.message}`, 'error');
        } finally {
            setDeletingPath(null);
        }
    };

    // 处理下载文件
    const handleDownloadFile = (file: WorkspaceFile) => {
        const a = document.createElement('a');
        a.href = getWorkspaceFileDownloadUrl(file.relative_path);
        a.target = '_blank';
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // 构建 Knowledge 文件树
    const buildKnowledgeFileTree = (): KnowledgeFileNode[] => {
        const pathMap = new Map<string, KnowledgeFileNode>();

        knowledgeFiles.forEach(file => {
            const parts = file.path.split('/');
            let currentPath = '';

            parts.forEach((part, index) => {
                currentPath = index === 0 ? part : `${currentPath}/${part}`;

                if (!pathMap.has(currentPath)) {
                    const isLast = index === parts.length - 1;
                    const nodeItem = isLast ? file : {
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
                            toggleExpand(item.path, true);
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
                {hasChildren && isExpanded && children.map(child => renderKnowledgeFileNode(child))}
            </div>
        );
    };

    const knowledgeFileTree = buildKnowledgeFileTree();
    const isMarkdown = selectedFile?.name.endsWith('.md');
    const isImagePreview = editorMode === 'workspace-preview' &&
        (selectedFile?.name.toLowerCase().endsWith('.png') ||
            selectedFile?.name.toLowerCase().endsWith('.jpg') ||
            selectedFile?.name.toLowerCase().endsWith('.jpeg') ||
            selectedFile?.name.toLowerCase().endsWith('.gif') ||
            selectedFile?.name.toLowerCase().endsWith('.webp'));

    // 暴露上传函数到全局，供 ChatArea 调用
    useEffect(() => {
        (window as any).handleWorkspaceUpload = handleFileUpload;
    }, [currentSession.id]);

    // 会话切换时刷新工作区文件
    useEffect(() => {
        if (workspaceExpanded) {
            loadWorkspaceFiles();
        }
    }, [currentSession.id]);

    // 会话相关处理函数
    const handleCreateSession = () => {
        createSession();
        setSessionSelectorOpen(false);
    };

    const handleSwitchSession = (sessionId: string) => {
        switchSession(sessionId);
        setSessionSelectorOpen(false);
    };

    const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (window.confirm('确定要删除这个会话吗？')) {
            deleteSession(sessionId);
        }
    };

    const handleStartEditSession = (e: React.MouseEvent, session: Session) => {
        e.stopPropagation();
        setEditingSessionId(session.id);
        setEditingSessionName(session.name);
    };

    const handleSaveSessionName = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (editingSessionName.trim()) {
            updateSessionName(sessionId, editingSessionName.trim());
        }
        setEditingSessionId(null);
        setEditingSessionName('');
    };

    const handleCancelEditSession = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingSessionId(null);
        setEditingSessionName('');
    };

    return (
        <>
            <nav className="sidebar">
                <div className="nav-menu scrollable-area">

                    {/* Top Section */}
                    <div className="nav-section">

                        {/* Logo */}
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

                        {/* Knowledge */}
                        <button className={`nav-item ${knowledgeExpanded ? 'active' : ''}`} onClick={toggleKnowledge}>
                            <BookOpen className="nav-item-icon" size={18} />
                            <span className="nav-item-text">Knowledge <span className="nav-item-zh">知识</span></span>
                            {knowledgeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>

                        {knowledgeExpanded && (
                            <div className="knowledge-file-list">
                                <div className="knowledge-list-header">
                                    <span className="file-count">{knowledgeFiles.filter(f => f.type === 'file').length} 文件</span>
                                    <button className="refresh-btn" onClick={loadKnowledgeFiles} disabled={loadingKnowledge}>
                                        <RefreshCw size={12} className={loadingKnowledge ? 'spin' : ''} />
                                    </button>
                                </div>
                                {loadingKnowledge && knowledgeFiles.length === 0 ? (
                                    <div className="loading-state">加载中...</div>
                                ) : knowledgeFiles.length === 0 ? (
                                    <div className="empty-state">暂无文件</div>
                                ) : (
                                    <div className="file-tree">
                                        {knowledgeFileTree.map(node => renderKnowledgeFileNode(node))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Workspace */}
                        <button className={`nav-item ${workspaceExpanded ? 'active' : ''}`} onClick={toggleWorkspace}>
                            <HardDrive className="nav-item-icon" size={18} />
                            <span className="nav-item-text">Workspace <span className="nav-item-zh">工作区</span></span>
                            {workspaceExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>

                        {workspaceExpanded && (
                            <div className="workspace-file-list">
                                {/* 会话选择器 */}
                                <div className="workspace-session-selector">
                                    <button
                                        className="session-current-btn"
                                        onClick={() => setSessionSelectorOpen(!sessionSelectorOpen)}
                                    >
                                        <Users size={14} />
                                        <span className="session-name">{currentSession.name}</span>
                                        <ChevronDown size={12} />
                                    </button>
                                    {sessionSelectorOpen && (
                                        <div className="session-dropdown" onClick={(e) => e.stopPropagation()}>
                                            <div className="session-dropdown-header">
                                                <span className="session-dropdown-title">选择会话</span>
                                                <button
                                                    className="session-new-btn"
                                                    onClick={handleCreateSession}
                                                >
                                                    <Plus size={12} />
                                                    新建
                                                </button>
                                            </div>
                                            <div className="session-list">
                                                {sessions.map(session => (
                                                    <div
                                                        key={session.id}
                                                        className={`session-item ${session.id === currentSession.id ? 'active' : ''}`}
                                                        onClick={() => handleSwitchSession(session.id)}
                                                    >
                                                        {editingSessionId === session.id ? (
                                                            <div className="session-edit-form">
                                                                <input
                                                                    type="text"
                                                                    className="session-edit-input"
                                                                    value={editingSessionName}
                                                                    onChange={(e) => setEditingSessionName(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') {
                                                                            handleSaveSessionName(e as any, session.id);
                                                                        } else if (e.key === 'Escape') {
                                                                            handleCancelEditSession(e as any);
                                                                        }
                                                                    }}
                                                                    autoFocus
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                                <div className="session-edit-actions">
                                                                    <button
                                                                        className="session-edit-btn save"
                                                                        onClick={(e) => handleSaveSessionName(e, session.id)}
                                                                    >
                                                                        保存
                                                                    </button>
                                                                    <button
                                                                        className="session-edit-btn cancel"
                                                                        onClick={handleCancelEditSession}
                                                                    >
                                                                        取消
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <span className="session-item-name">{session.name}</span>
                                                                <div className="session-item-actions">
                                                                    <button
                                                                        className="session-action-btn edit"
                                                                        onClick={(e) => handleStartEditSession(e, session)}
                                                                        title="重命名"
                                                                    >
                                                                        <Edit3 size={10} />
                                                                    </button>
                                                                    {session.id !== 'default_session' && (
                                                                        <button
                                                                            className="session-action-btn delete"
                                                                            onClick={(e) => handleDeleteSession(e, session.id)}
                                                                            title="删除"
                                                                        >
                                                                            <Trash2 size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="workspace-list-header">
                                    <span className="file-count">{workspaceFiles.length} 文件</span>
                                    <button className="refresh-btn" onClick={loadWorkspaceFiles} disabled={loadingWorkspace}>
                                        <RefreshCw size={12} className={loadingWorkspace ? 'spin' : ''} />
                                    </button>
                                </div>
                                {loadingWorkspace && workspaceFiles.length === 0 ? (
                                    <div className="loading-state">加载中...</div>
                                ) : workspaceFiles.length === 0 ? (
                                    <div className="empty-state">暂无文件</div>
                                ) : (
                                    <div className="workspace-files">
                                        {workspaceFiles.map(file => (
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
                                                        onClick={() => handleDownloadFile(file)}
                                                        title="下载"
                                                    >
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
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

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

                {/* Toast 提示 */}
                {toast && (
                    <div className={`sidebar-toast ${toast.type}`}>
                        <span>{toast.text}</span>
                    </div>
                )}
            </nav>

            {/* 编辑器/预览模态框 */}
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
                                    <button
                                        className="action-btn"
                                        onClick={() => setIsEditing(true)}
                                        title="编辑"
                                    >
                                        <Edit3 size={14} />
                                    </button>
                                )}
                                {editorMode === 'knowledge' && isEditing && (
                                    <button
                                        className="action-btn save"
                                        onClick={handleSave}
                                        disabled={saving}
                                        title="保存"
                                    >
                                        <Save size={14} />
                                    </button>
                                )}
                                <button
                                    className="action-btn"
                                    onClick={closeEditor}
                                    title="关闭"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>

                        {editorMode === 'knowledge' && isEditing ? (
                            <textarea
                                className="editor-textarea"
                                value={fileContent}
                                onChange={(e) => setFileContent(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        handleSave();
                                    }
                                }}
                                spellCheck={false}
                                autoFocus
                            />
                        ) : editorMode === 'workspace-preview' && isImagePreview ? (
                            <div className="editor-preview image-preview">
                                <img src={fileContent} alt={selectedFile.name} />
                            </div>
                        ) : (
                            <div className="editor-preview markdown-content">
                                {editorMode === 'knowledge' && isMarkdown ? (
                                    <ReactMarkdown>{fileContent}</ReactMarkdown>
                                ) : editorMode === 'workspace-preview' && fileContent ? (
                                    fileContent.endsWith('.csv') ?
                                        <pre className="csv-preview">{fileContent}</pre> :
                                        <pre>{fileContent}</pre>
                                ) : (
                                    <div className="preview-not-supported">不支持预览此文件类型</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default Sidebar;

import React, { useCallback, useEffect, useState } from 'react';
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
    getKnowledgeFiles,
    getKnowledgeContent,
    saveKnowledgeContent,
    type KnowledgeFile,
} from '../api/client';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../hooks/useAuth';

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
    const [pluginsExpanded, setPluginsExpanded] = useState(false);
    const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
    const [loadingKnowledge, setLoadingKnowledge] = useState(false);
    const [knowledgeExpandedPaths, setKnowledgeExpandedPaths] = useState<Set<string>>(new Set(['doc']));
    const [editorOpen, setEditorOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null);
    const [fileContent, setFileContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
        setToast({ text, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    const loadKnowledgeFiles = useCallback(async () => {
        setLoadingKnowledge(true);
        try {
            const response = await getKnowledgeFiles();
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

    const toggleExclusiveSection = (section: 'tasks' | 'knowledge' | 'plugins') => {
        setTasksExpanded(section === 'tasks' ? !tasksExpanded : false);
        setKnowledgeExpanded(section === 'knowledge' ? !knowledgeExpanded : false);
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
            const response = await getKnowledgeContent(file.path);
            setFileContent(response.content);
            setEditorOpen(true);
        } catch (error) {
            showToast(`加载文件失败: ${(error as Error).message}`, 'error');
        }
    };

    const handleSave = async () => {
        if (!selectedFile) return;
        setSaving(true);
        try {
            await saveKnowledgeContent(selectedFile.path, fileContent);
            showToast(`${selectedFile.name} 已保存`);
            setIsEditing(false);
        } catch (error) {
            showToast(`保存失败: ${(error as Error).message}`, 'error');
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
                <div
                    className={`knowledge-file-node ${isDirectory ? 'directory' : 'file'}`}
                    style={{ paddingLeft: `${12 + level * 16}px` }}
                    onClick={() => isDirectory || children.length > 0 ? toggleKnowledgePath(item.path) : void openKnowledgeFile(item)}
                >
                    {isDirectory || children.length > 0 ? (
                        <span className="expand-icon">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                    ) : <span className="expand-icon" />}
                    {isDirectory ? <Folder size={14} className="file-icon" /> : <FileText size={14} className="file-icon" />}
                    <span className="file-name">{item.name}</span>
                </div>
                {expanded && children.map(renderKnowledgeNode)}
            </div>
        );
    };

    const knowledgeFileTree = buildKnowledgeFileTree();
    const isMarkdown = selectedFile?.name.toLowerCase().endsWith('.md');

    return (
        <>
            <nav className="sidebar">
                <div className="nav-menu scrollable-area">
                    <div className="nav-section">
                        <div className="sidebar-logo">YourDB</div>

                        <button className="nav-item sidebar-primary-action" onClick={() => {
                            createTask();
                            showToast(t('task.created') || '新任务创建成功');
                        }}>
                            <Edit3 className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.newTask')}</span>
                        </button>

                        <button className={`nav-item ${tasksExpanded ? 'expanded' : ''}`} onClick={() => toggleExclusiveSection('tasks')}>
                            <History className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.currentTask')}</span>
                            <ChevronDown className={`expand-arrow ${tasksExpanded ? 'rotated' : ''}`} size={14} />
                        </button>

                        {tasksExpanded && (
                            <div className="task-tree">
                                {tasks.map((task) => {
                                    const expanded = expandedTaskIds.has(task.id);
                                    const active = currentTask?.id === task.id && !currentSession;
                                    const taskSessions = sessions.filter((session) => session.taskId === task.id);
                                    return (
                                        <div className="task-tree-item" key={task.id}>
                                            <div
                                                className={`task-row ${active ? 'active' : ''}`}
                                                onClick={() => {
                                                    switchTask(task.id);
                                                    toggleTask(task.id);
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    className="task-expand-btn"
                                                    onClick={(event) => { event.stopPropagation(); toggleTask(task.id); }}
                                                    title={expanded ? '收起会话' : '展开会话'}
                                                >
                                                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                </button>
                                                <Folder size={14} />
                                                {editingTaskId === task.id ? (
                                                    <input
                                                        className="task-name-input"
                                                        value={editTaskName}
                                                        onChange={(event) => setEditTaskName(event.target.value)}
                                                        onClick={(event) => event.stopPropagation()}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') commitTaskName(task.id);
                                                            if (event.key === 'Escape') setEditingTaskId(null);
                                                        }}
                                                        onBlur={() => commitTaskName(task.id)}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className="task-name" title={task.name}>{task.name}</span>
                                                )}
                                                <div className="task-actions" onClick={(event) => event.stopPropagation()}>
                                                    <button className="tree-action-btn" onClick={() => {
                                                        setExpandedTaskIds((prev) => new Set(prev).add(task.id));
                                                        createSession(task.id);
                                                    }} title={t('session.create') || '新建会话'}>
                                                        <Plus size={11} />
                                                    </button>
                                                    {editingTaskId === task.id ? (
                                                        <button className="tree-action-btn" onMouseDown={(event) => event.preventDefault()} onClick={() => commitTaskName(task.id)} title="保存">
                                                            <Check size={11} />
                                                        </button>
                                                    ) : (
                                                        <button className="tree-action-btn" onClick={() => { setEditTaskName(task.name); setEditingTaskId(task.id); }} title="重命名任务">
                                                            <Edit3 size={11} />
                                                        </button>
                                                    )}
                                                    <button
                                                        className="tree-action-btn delete"
                                                        onClick={() => {
                                                            if (window.confirm(`确认删除任务“${task.name}”及其全部会话吗？`)) deleteTask(task.id);
                                                        }}
                                                        title="删除任务"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                </div>
                                            </div>

                                            {expanded && (
                                                <div className="task-session-list">
                                                    {taskSessions.length === 0 && (
                                                        <div className="task-empty-sessions">{t('session.empty')}</div>
                                                    )}
                                                    {taskSessions.map((session) => (
                                                        <div
                                                            key={session.id}
                                                            className={`session-row ${currentSession?.id === session.id ? 'active' : ''}`}
                                                            onClick={() => switchSession(session.id)}
                                                        >
                                                            <MessageSquare size={13} />
                                                            <span className="session-name" title={session.name}>{session.name}</span>
                                                            <button
                                                                className="tree-action-btn session-delete-btn"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    if (window.confirm(`确认删除会话“${session.name}”吗？`)) deleteSession(session.id);
                                                                }}
                                                                title="删除会话"
                                                            >
                                                                <Trash2 size={11} />
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

                        <button className={`nav-item ${knowledgeExpanded ? 'expanded' : ''}`} onClick={() => toggleExclusiveSection('knowledge')}>
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
                                ) : knowledgeFileTree.map(renderKnowledgeNode)}
                            </div>
                        )}

                        <button className={`nav-item ${pluginsExpanded ? 'expanded' : ''}`} onClick={() => toggleExclusiveSection('plugins')}>
                            <Box className="nav-item-icon" size={18} />
                            <span className="nav-item-text">{t('sidebar.plugins')}</span>
                            <ChevronDown className={`expand-arrow ${pluginsExpanded ? 'rotated' : ''}`} size={14} />
                        </button>
                        {pluginsExpanded && (
                            <div className="sidebar-plugin-list">
                                <button className="nav-item sidebar-plugin-item" onClick={() => onOpenPlugins?.('MCP')}>
                                    <Server className="nav-item-icon" size={16} />
                                    <span className="nav-item-text sidebar-plugin-text">MCP</span>
                                </button>
                                <button className="nav-item sidebar-plugin-item" onClick={() => onOpenPlugins?.('Skills')}>
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
                    <button className="nav-item sidebar-footer-settings" onClick={toggleLanguage}>
                        <Languages className="nav-item-icon" size={18} />
                        <span className="nav-item-text">{language === 'zh' ? 'EN' : '中文'}</span>
                    </button>
                    <button className="nav-item sidebar-footer-settings" onClick={onOpenSettings}>
                        <Settings className="nav-item-icon" size={18} />
                        <span className="nav-item-text">{t('sidebar.settings')}</span>
                    </button>
                    <button className="nav-item sidebar-footer-settings" onClick={() => void logout()} title="退出">
                        <LogOut className="nav-item-icon" size={18} />
                        <span className="nav-item-text">退出</span>
                    </button>
                </div>

                {toast && <div className={`sidebar-toast ${toast.type}`}><span>{toast.text}</span></div>}
            </nav>

            {editorOpen && selectedFile && (
                <div className="editor-modal-overlay" onClick={closeEditor}>
                    <div className="editor-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="editor-modal-header">
                            <div className="editor-title"><FileText size={16} /><span>{selectedFile.name}</span></div>
                            <div className="editor-actions">
                                {isMarkdown && !isEditing && <button className="action-btn" onClick={() => setIsEditing(true)} title="编辑"><Edit3 size={14} /></button>}
                                {isEditing && <button className="action-btn save" onClick={handleSave} disabled={saving} title="保存"><Save size={14} /></button>}
                                <button className="action-btn" onClick={closeEditor} title="关闭"><X size={14} /></button>
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
        </>
    );
};

export default Sidebar;

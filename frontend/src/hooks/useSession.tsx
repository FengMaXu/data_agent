import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    createTask as createTaskRequest,
    createTaskSession,
    deleteChatSession,
    deleteTask as deleteTaskRequest,
    getChatSession,
    listTasks,
    prepareAgentSession,
    saveChatTranscript,
    saveSessionAttachedFiles,
    updateTaskName as updateTaskNameRequest,
    type SessionSnapshotMessage,
} from '../api/client';
import { useLanguage } from '../context/LanguageContext';

export interface Task {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

export interface Session {
    id: string;
    taskId: string;
    name: string;
    createdAt: string;
    conversationVersion: number;
}

const CURRENT_TASK_STORAGE_KEY = 'data-agent:current-task';
const CURRENT_SESSION_STORAGE_KEY = 'data-agent:current-session';
const TRANSCRIPT_SAVE_DEBOUNCE_MS = 800;
const DEFAULT_TASK_NAMES = new Set(['New task', 'New Task', '新任务']);
const DEFAULT_SESSION_NAMES = new Set(['New session', 'New Session', '新会话']);

type SessionTranscriptStore = Record<string, SessionSnapshotMessage[]>;
type SessionAttachedFilesStore = Record<string, string[]>;

interface SessionContextType {
    tasks: Task[];
    sessions: Session[];
    currentTask: Task | null;
    currentSession: Session | null;
    currentTranscript: SessionSnapshotMessage[];
    attachedFiles: string[];
    createTask: () => void;
    createSession: (taskId?: string) => void;
    switchTask: (taskId: string) => void;
    switchSession: (sessionId: string) => void;
    deleteTask: (taskId: string) => void;
    deleteSession: (sessionId: string) => void;
    updateTaskName: (taskId: string, name: string) => void;
    setCurrentTranscript: (sessionId: string, messages: SessionSnapshotMessage[]) => void;
    clearCurrentTranscript: (sessionId: string, options?: { persist?: boolean; conversationVersion?: number }) => void;
    setAttachedFiles: (files: string[]) => void;
    toggleAttachedFile: (filePath: string) => void;
    clearAttachedFiles: (options?: { persist?: boolean }) => void;
    isFileAttached: (filePath: string) => boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

function createId(prefix: 'task' | 'session'): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readCurrentTaskId(): string {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(CURRENT_TASK_STORAGE_KEY) || '';
}

function writeCurrentTaskId(taskId: string) {
    if (typeof window === 'undefined') return;
    if (taskId) window.localStorage.setItem(CURRENT_TASK_STORAGE_KEY, taskId);
    else window.localStorage.removeItem(CURRENT_TASK_STORAGE_KEY);
}

function readCurrentSessionId(): string {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY) || '';
}

function writeCurrentSessionId(sessionId: string) {
    if (typeof window === 'undefined') return;
    if (sessionId) window.localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, sessionId);
    else window.localStorage.removeItem(CURRENT_SESSION_STORAGE_KEY);
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const { t } = useLanguage();
    const [isLoaded, setIsLoaded] = useState(false);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentTaskId, setCurrentTaskId] = useState('');
    const [currentSessionId, setCurrentSessionId] = useState('');
    const [transcriptsBySession, setTranscriptsBySession] = useState<SessionTranscriptStore>({});
    const [attachedFilesBySession, setAttachedFilesBySession] = useState<SessionAttachedFilesStore>({});
    const attachedFilesRef = useRef<SessionAttachedFilesStore>({});
    const conversationVersionsRef = useRef<Record<string, number>>({});
    const transcriptSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const titleSaveRequestedRef = useRef<Set<string>>(new Set());
    const sessionNamesRef = useRef<Record<string, string>>({});

    const defaultTaskName = t('task.new') || 'New task';
    const defaultSessionName = t('session.new') || 'New session';

    useEffect(() => {
        attachedFilesRef.current = attachedFilesBySession;
    }, [attachedFilesBySession]);

    useEffect(() => {
        sessionNamesRef.current = Object.fromEntries(sessions.map((session) => [session.id, session.name]));
    }, [sessions]);

    const warmSession = useCallback((sessionId: string) => {
        void prepareAgentSession(sessionId).catch((error) => {
            console.warn('Failed to prepare session runtime:', error);
        });
    }, []);

    const persistTranscript = useCallback((sessionId: string, messages: SessionSnapshotMessage[]) => {
        void saveChatTranscript(
            sessionId,
            messages,
            attachedFilesRef.current[sessionId],
            conversationVersionsRef.current[sessionId],
        ).then((saved) => {
            setSessions((prev) => prev.map((session) => (
                session.id === sessionId
                    ? { ...session, name: saved.name, conversationVersion: saved.conversation_version || session.conversationVersion }
                    : session
            )));
            conversationVersionsRef.current[sessionId] = saved.conversation_version || conversationVersionsRef.current[sessionId] || 1;
        }).catch((error) => {
            console.warn('Failed to save transcript:', error);
        });
    }, []);

    const scheduleTranscriptSave = useCallback((
        sessionId: string,
        messages: SessionSnapshotMessage[],
        immediate = false,
    ) => {
        const existingTimer = transcriptSaveTimersRef.current[sessionId];
        if (existingTimer) {
            clearTimeout(existingTimer);
            delete transcriptSaveTimersRef.current[sessionId];
        }
        if (immediate) {
            persistTranscript(sessionId, messages);
            return;
        }
        transcriptSaveTimersRef.current[sessionId] = setTimeout(() => {
            delete transcriptSaveTimersRef.current[sessionId];
            persistTranscript(sessionId, messages);
        }, TRANSCRIPT_SAVE_DEBOUNCE_MS);
    }, [persistTranscript]);

    useEffect(() => () => {
        Object.values(transcriptSaveTimersRef.current).forEach(clearTimeout);
        transcriptSaveTimersRef.current = {};
    }, []);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const response = await listTasks();
                if (cancelled) return;

                const loadedTasks: Task[] = response.tasks.map((task) => ({
                    id: task.id,
                    name: DEFAULT_TASK_NAMES.has(task.name) ? defaultTaskName : task.name,
                    createdAt: new Date(task.created_at * 1000).toISOString(),
                    updatedAt: new Date(task.updated_at * 1000).toISOString(),
                }));
                const loadedSessions: Session[] = response.tasks.flatMap((task) => (task.sessions || []).map((session) => ({
                    id: session.id,
                    taskId: task.id,
                    name: DEFAULT_SESSION_NAMES.has(session.name) ? defaultSessionName : session.name,
                    createdAt: new Date(session.created_at * 1000).toISOString(),
                    conversationVersion: session.conversation_version || 1,
                })));

                loadedSessions.forEach((session) => {
                    conversationVersionsRef.current[session.id] = session.conversationVersion;
                });
                const storedSessionId = readCurrentSessionId();
                const storedTaskId = readCurrentTaskId();
                const selectedTask = loadedTasks.find((task) => task.id === storedTaskId)
                    || loadedTasks.find((task) => task.id === loadedSessions.find((session) => session.id === storedSessionId)?.taskId)
                    || loadedTasks[0]
                    || null;
                const selectedSession = selectedTask
                    ? loadedSessions.find((session) => session.id === storedSessionId && session.taskId === selectedTask.id)
                        || loadedSessions.find((session) => session.taskId === selectedTask.id)
                        || null
                    : null;

                let transcripts: SessionTranscriptStore = {};
                let attached: SessionAttachedFilesStore = {};
                if (selectedSession) {
                    const detail = await getChatSession(selectedSession.id);
                    if (cancelled) return;
                    conversationVersionsRef.current[selectedSession.id] = detail.conversation_version || selectedSession.conversationVersion;
                    transcripts = { [selectedSession.id]: detail.messages || [] };
                    attached = { [selectedSession.id]: detail.attached_files || [] };
                    warmSession(selectedSession.id);
                }

                setTasks(loadedTasks);
                setSessions(loadedSessions);
                setCurrentTaskId(selectedTask?.id || '');
                setCurrentSessionId(selectedSession?.id || '');
                writeCurrentTaskId(selectedTask?.id || '');
                writeCurrentSessionId(selectedSession?.id || '');
                setTranscriptsBySession(transcripts);
                setAttachedFilesBySession(attached);
            } catch (error) {
                console.error('Failed to load tasks:', error);
            } finally {
                if (!cancelled) setIsLoaded(true);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [defaultSessionName, defaultTaskName, warmSession]);

    const currentTask = useMemo(
        () => tasks.find((task) => task.id === currentTaskId) || null,
        [currentTaskId, tasks],
    );
    const currentSession = useMemo(
        () => sessions.find((session) => session.id === currentSessionId && session.taskId === currentTaskId) || null,
        [currentSessionId, currentTaskId, sessions],
    );

    const currentTranscript = useMemo(
        () => currentSession ? transcriptsBySession[currentSession.id] || [] : [],
        [currentSession, transcriptsBySession],
    );
    const attachedFiles = useMemo(
        () => currentSession ? attachedFilesBySession[currentSession.id] || [] : [],
        [attachedFilesBySession, currentSession],
    );

    const selectSession = useCallback((sessionId: string) => {
        const session = sessions.find((item) => item.id === sessionId);
        if (!session) return;
        setCurrentTaskId(session.taskId);
        setCurrentSessionId(session.id);
        writeCurrentTaskId(session.taskId);
        writeCurrentSessionId(session.id);
        warmSession(session.id);
    }, [sessions, warmSession]);

    const createTask = useCallback(() => {
        const now = new Date().toISOString();
        const task: Task = {
            id: createId('task'),
            name: defaultTaskName,
            createdAt: now,
            updatedAt: now,
        };
        setTasks((prev) => [task, ...prev]);
        setCurrentTaskId(task.id);
        setCurrentSessionId('');
        writeCurrentTaskId(task.id);
        writeCurrentSessionId('');
        void createTaskRequest({ id: task.id, name: task.name })
            .catch((error) => console.warn('Failed to create task:', error));
    }, [defaultTaskName]);

    const createSession = useCallback((taskId = currentTask?.id || '') => {
        if (!taskId) return;
        const session: Session = {
            id: createId('session'),
            taskId,
            name: defaultSessionName,
            createdAt: new Date().toISOString(),
            conversationVersion: 1,
        };
        setSessions((prev) => [session, ...prev]);
        setTranscriptsBySession((prev) => ({ ...prev, [session.id]: [] }));
        setAttachedFilesBySession((prev) => ({ ...prev, [session.id]: [] }));
        conversationVersionsRef.current[session.id] = 1;
        setCurrentTaskId(taskId);
        setCurrentSessionId(session.id);
        writeCurrentTaskId(taskId);
        writeCurrentSessionId(session.id);

        void createTaskSession(taskId, { id: session.id, name: session.name }).then((created) => {
            conversationVersionsRef.current[session.id] = created.conversation_version || 1;
            warmSession(session.id);
        }).catch((error) => console.warn('Failed to create session:', error));
    }, [currentTask?.id, defaultSessionName, warmSession]);

    const switchSession = useCallback((sessionId: string) => {
        if (!sessions.some((session) => session.id === sessionId)) return;
        if (transcriptsBySession[sessionId] === undefined) {
            void getChatSession(sessionId).then((detail) => {
                setTranscriptsBySession((prev) => ({ ...prev, [sessionId]: detail.messages || [] }));
                setAttachedFilesBySession((prev) => ({ ...prev, [sessionId]: detail.attached_files || [] }));
                conversationVersionsRef.current[sessionId] = detail.conversation_version || 1;
                setSessions((prev) => prev.map((session) => (
                    session.id === sessionId
                        ? { ...session, name: detail.name, conversationVersion: detail.conversation_version || 1 }
                        : session
                )));
                selectSession(sessionId);
            }).catch((error) => console.warn('Failed to load session:', error));
            return;
        }
        selectSession(sessionId);
    }, [selectSession, sessions, transcriptsBySession]);

    const switchTask = useCallback((taskId: string) => {
        if (!tasks.some((task) => task.id === taskId)) return;
        setCurrentTaskId(taskId);
        setCurrentSessionId('');
        writeCurrentTaskId(taskId);
        writeCurrentSessionId('');
    }, [tasks]);

    const deleteSession = useCallback((sessionId: string) => {
        const target = sessions.find((session) => session.id === sessionId);
        if (!target) return;
        const nextSessions = sessions.filter((session) => session.id !== sessionId);
        setSessions(nextSessions);
        setTranscriptsBySession((prev) => {
            const next = { ...prev };
            delete next[sessionId];
            return next;
        });
        setAttachedFilesBySession((prev) => {
            const next = { ...prev };
            delete next[sessionId];
            return next;
        });
        void deleteChatSession(sessionId);
        if (sessionId === currentSessionId) {
            const next = nextSessions.find((session) => session.taskId === target.taskId);
            if (next) switchSession(next.id);
            else {
                setCurrentSessionId('');
                writeCurrentSessionId('');
            }
        }
    }, [currentSessionId, sessions, switchSession]);

    const deleteTask = useCallback((taskId: string) => {
        const removedSessionIds = new Set(sessions.filter((session) => session.taskId === taskId).map((session) => session.id));
        const nextTasks = tasks.filter((task) => task.id !== taskId);
        const nextSessions = sessions.filter((session) => session.taskId !== taskId);
        setTasks(nextTasks);
        setSessions(nextSessions);
        setTranscriptsBySession((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !removedSessionIds.has(id))));
        setAttachedFilesBySession((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !removedSessionIds.has(id))));
        void deleteTaskRequest(taskId);
        if (taskId === currentTaskId) {
            const nextTask = nextTasks[0] || null;
            const nextSession = nextTask ? nextSessions.find((session) => session.taskId === nextTask.id) || null : null;
            setCurrentTaskId(nextTask?.id || '');
            setCurrentSessionId(nextSession?.id || '');
            writeCurrentTaskId(nextTask?.id || '');
            writeCurrentSessionId(nextSession?.id || '');
            if (nextSession) warmSession(nextSession.id);
        }
    }, [currentSessionId, currentTaskId, sessions, tasks, warmSession]);

    const updateTaskName = useCallback((taskId: string, name: string) => {
        const nextName = name.trim() || defaultTaskName;
        setTasks((prev) => prev.map((task) => task.id === taskId ? { ...task, name: nextName } : task));
        void updateTaskNameRequest(taskId, nextName);
    }, [defaultTaskName]);

    const setCurrentTranscript = useCallback((sessionId: string, messages: SessionSnapshotMessage[]) => {
        setTranscriptsBySession((prev) => ({ ...prev, [sessionId]: messages }));
        const sessionName = sessionNamesRef.current[sessionId];
        const isUntitled = ['New session', 'New Session', '新会话'].includes(sessionName);
        const hasFirstMessage = messages.some((message) => message.role === 'user');
        const shouldSaveTitleNow = Boolean(isUntitled && hasFirstMessage && !titleSaveRequestedRef.current.has(sessionId));
        if (shouldSaveTitleNow) titleSaveRequestedRef.current.add(sessionId);
        scheduleTranscriptSave(sessionId, messages, shouldSaveTitleNow);
    }, [scheduleTranscriptSave]);

    const clearCurrentTranscript = useCallback((
        sessionId: string,
        options: { persist?: boolean; conversationVersion?: number } = {},
    ) => {
        if (typeof options.conversationVersion === 'number') {
            conversationVersionsRef.current[sessionId] = options.conversationVersion;
            setSessions((prev) => prev.map((session) => (
                session.id === sessionId ? { ...session, conversationVersion: options.conversationVersion as number } : session
            )));
        }
        setTranscriptsBySession((prev) => ({ ...prev, [sessionId]: [] }));
        if (options.persist === false) {
            const existingTimer = transcriptSaveTimersRef.current[sessionId];
            if (existingTimer) {
                clearTimeout(existingTimer);
                delete transcriptSaveTimersRef.current[sessionId];
            }
            return;
        }
        scheduleTranscriptSave(sessionId, [], true);
    }, [scheduleTranscriptSave]);

    const setAttachedFiles = useCallback((files: string[]) => {
        if (!currentSession) return;
        const deduped = Array.from(new Set(files));
        setAttachedFilesBySession((prev) => ({ ...prev, [currentSession.id]: deduped }));
        void saveSessionAttachedFiles(currentSession.id, deduped, conversationVersionsRef.current[currentSession.id]);
    }, [currentSession]);

    const toggleAttachedFile = useCallback((filePath: string) => {
        if (!currentSession) return;
        const current = attachedFilesBySession[currentSession.id] || [];
        const next = current.includes(filePath) ? current.filter((item) => item !== filePath) : [...current, filePath];
        setAttachedFilesBySession((prev) => ({ ...prev, [currentSession.id]: next }));
        void saveSessionAttachedFiles(currentSession.id, next, conversationVersionsRef.current[currentSession.id]);
    }, [attachedFilesBySession, currentSession]);

    const clearAttachedFiles = useCallback((options: { persist?: boolean } = {}) => {
        if (!currentSession) return;
        setAttachedFilesBySession((prev) => ({ ...prev, [currentSession.id]: [] }));
        if (options.persist === false) return;
        void saveSessionAttachedFiles(currentSession.id, [], conversationVersionsRef.current[currentSession.id]);
    }, [currentSession]);

    const isFileAttached = useCallback((filePath: string) => attachedFiles.includes(filePath), [attachedFiles]);

    if (!isLoaded) return null;

    return (
        <SessionContext.Provider value={{
            tasks,
            sessions,
            currentTask,
            currentSession,
            currentTranscript,
            attachedFiles,
            createTask,
            createSession,
            switchTask,
            switchSession,
            deleteTask,
            deleteSession,
            updateTaskName,
            setCurrentTranscript,
            clearCurrentTranscript,
            setAttachedFiles,
            toggleAttachedFile,
            clearAttachedFiles,
            isFileAttached,
        }}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) throw new Error('useSession must be used within a SessionProvider');
    return context;
}

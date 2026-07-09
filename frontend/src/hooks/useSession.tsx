import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    createChatSession,
    deleteChatSession,
    getChatSession,
    listChatSessions,
    prepareAgentSession,
    saveChatTranscript,
    saveSessionAttachedFiles,
    updateChatSessionName,
    type SessionSnapshotMessage,
} from '../api/client';
import { useLanguage } from '../context/LanguageContext';

export interface Session {
    id: string;
    name: string;
    createdAt: string;
    conversationVersion: number;
}

const CURRENT_SESSION_STORAGE_KEY = 'data-agent:current-session';
const TRANSCRIPT_SAVE_DEBOUNCE_MS = 800;
const DEFAULT_WORKSPACE_NAMES = new Set(['New workspace', 'New Workspace', '新建工作区']);

type SessionTranscriptStore = Record<string, SessionSnapshotMessage[]>;
type SessionAttachedFilesStore = Record<string, string[]>;

interface SessionContextType {
    currentSession: Session;
    sessions: Session[];
    currentTranscript: SessionSnapshotMessage[];
    attachedFiles: string[];
    createSession: (name?: string) => Session;
    switchSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => void;
    updateSessionName: (sessionId: string, name: string) => void;
    setCurrentTranscript: (sessionId: string, messages: SessionSnapshotMessage[]) => void;
    clearCurrentTranscript: (sessionId: string, options?: { persist?: boolean; conversationVersion?: number }) => void;
    setAttachedFiles: (files: string[]) => void;
    toggleAttachedFile: (filePath: string) => void;
    clearAttachedFiles: (options?: { persist?: boolean }) => void;
    isFileAttached: (filePath: string) => boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

function createSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `session_${crypto.randomUUID()}`;
    }
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readCurrentSessionId(): string {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY) || '';
}

function writeCurrentSessionId(sessionId: string) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, sessionId);
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const { t } = useLanguage();
    const [isLoaded, setIsLoaded] = useState(false);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string>('');
    const [transcriptsBySession, setTranscriptsBySession] = useState<SessionTranscriptStore>({});
    const [attachedFilesBySession, setAttachedFilesBySession] = useState<SessionAttachedFilesStore>({});
    const attachedFilesRef = useRef<SessionAttachedFilesStore>({});
    const conversationVersionsRef = useRef<Record<string, number>>({});
    const transcriptSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    useEffect(() => {
        attachedFilesRef.current = attachedFilesBySession;
    }, [attachedFilesBySession]);

    const persistTranscript = useCallback((sessionId: string, messages: SessionSnapshotMessage[]) => {
        void saveChatTranscript(
            sessionId,
            messages,
            attachedFilesRef.current[sessionId],
            conversationVersionsRef.current[sessionId],
        ).catch((error) => {
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

    const warmSession = useCallback((sessionId: string) => {
        void prepareAgentSession(sessionId).catch((error) => {
            console.warn('Failed to prepare session runtime:', error);
        });
    }, []);

    const defaultWorkspaceName = t('session.newWorkspace') || 'New workspace';
    const normalizeSessionName = useCallback((name: string) => {
        const trimmed = name.trim();
        return DEFAULT_WORKSPACE_NAMES.has(trimmed) ? defaultWorkspaceName : name;
    }, [defaultWorkspaceName]);
    const isDefaultWorkspaceName = useCallback((name: string) => {
        const trimmed = name.trim();
        return trimmed === defaultWorkspaceName || DEFAULT_WORKSPACE_NAMES.has(trimmed);
    }, [defaultWorkspaceName]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const response = await listChatSessions();
                if (cancelled) return;

                if (response.sessions.length === 0) {
                    const storedId = readCurrentSessionId();
                    const initial = {
                        id: storedId || createSessionId(),
                        name: defaultWorkspaceName,
                        createdAt: new Date().toISOString(),
                        conversationVersion: 1,
                    };
                    writeCurrentSessionId(initial.id);
                    const created = await createChatSession({ id: initial.id, name: initial.name });
                    if (cancelled) return;
                    const initialWithVersion = {
                        ...initial,
                        conversationVersion: created.conversation_version || 1,
                    };
                    conversationVersionsRef.current[initial.id] = initialWithVersion.conversationVersion;
                    setSessions([initialWithVersion]);
                    setCurrentSessionId(initial.id);
                    setTranscriptsBySession({ [initial.id]: created.messages || [] });
                    setAttachedFilesBySession({ [initial.id]: created.attached_files || [] });
                    warmSession(initial.id);
                    return;
                }

                const loaded = response.sessions.map((item) => ({
                    id: item.id,
                    name: normalizeSessionName(item.name),
                    createdAt: new Date(item.created_at * 1000).toISOString(),
                    conversationVersion: item.conversation_version || 1,
                }));
                const keptDefault = loaded.find((item) => isDefaultWorkspaceName(item.name));
                const deduped = loaded.filter((item) => item === keptDefault || !isDefaultWorkspaceName(item.name));
                const duplicates = loaded.filter((item) => item !== keptDefault && isDefaultWorkspaceName(item.name));
                duplicates.forEach((session) => {
                    void getChatSession(session.id).then((detail) => {
                        const isEmpty = (detail.messages || []).length === 0 && (detail.attached_files || []).length === 0;
                        if (isEmpty) {
                            void deleteChatSession(session.id);
                        }
                    }).catch(() => {});
                });

                const storedId = readCurrentSessionId();
                const selected = deduped.find((item) => item.id === storedId) || deduped[0];
                const detail = await getChatSession(selected.id);
                if (cancelled) return;

                setSessions(deduped);
                conversationVersionsRef.current[selected.id] = detail.conversation_version || selected.conversationVersion || 1;
                setCurrentSessionId(selected.id);
                writeCurrentSessionId(selected.id);
                setTranscriptsBySession({ [selected.id]: detail.messages || [] });
                setAttachedFilesBySession({ [selected.id]: detail.attached_files || [] });
                warmSession(selected.id);
            } finally {
                if (!cancelled) {
                    setIsLoaded(true);
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [defaultWorkspaceName, isDefaultWorkspaceName, normalizeSessionName, warmSession]);

    const currentSession = useMemo(() => {
        const existing = sessions.find((session) => session.id === currentSessionId);
        if (existing) return existing;
        return sessions[0] || { id: '', name: defaultWorkspaceName, createdAt: new Date(0).toISOString(), conversationVersion: 1 };
    }, [currentSessionId, defaultWorkspaceName, sessions]);

    const currentTranscript = transcriptsBySession[currentSession.id] || [];
    const attachedFiles = attachedFilesBySession[currentSession.id] || [];

    const createSession = useCallback((name?: string) => {
        const newSession: Session = {
            id: createSessionId(),
            name: name || `${t('session.workspacePrefix') || 'Workspace'} ${sessions.length + 1}`,
            createdAt: new Date().toISOString(),
            conversationVersion: 1,
        };
        setSessions((prev) => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
        writeCurrentSessionId(newSession.id);
        setTranscriptsBySession((prev) => ({ ...prev, [newSession.id]: [] }));
        setAttachedFilesBySession((prev) => ({ ...prev, [newSession.id]: [] }));
        conversationVersionsRef.current[newSession.id] = newSession.conversationVersion;
        void createChatSession({ id: newSession.id, name: newSession.name }).then((created) => {
            conversationVersionsRef.current[newSession.id] = created.conversation_version || 1;
            setSessions((prev) => prev.map((session) => (
                session.id === newSession.id
                    ? { ...session, conversationVersion: conversationVersionsRef.current[newSession.id] }
                    : session
            )));
            warmSession(newSession.id);
        }).catch((error) => {
            console.warn('Failed to create session:', error);
        });
        return newSession;
    }, [sessions.length, t, warmSession]);

    const switchSession = useCallback((sessionId: string) => {
        if (!sessions.some((item) => item.id === sessionId)) return;
        if (!transcriptsBySession[sessionId]) {
            void getChatSession(sessionId).then((detail) => {
                setTranscriptsBySession((prev) => ({ ...prev, [sessionId]: detail.messages || [] }));
                setAttachedFilesBySession((prev) => ({ ...prev, [sessionId]: detail.attached_files || [] }));
                conversationVersionsRef.current[sessionId] = detail.conversation_version || 1;
                setSessions((prev) => prev.map((session) => (
                    session.id === sessionId
                        ? { ...session, conversationVersion: conversationVersionsRef.current[sessionId] }
                        : session
                )));
                setCurrentSessionId(sessionId);
                writeCurrentSessionId(sessionId);
                warmSession(sessionId);
            });
            return;
        }
        setCurrentSessionId(sessionId);
        writeCurrentSessionId(sessionId);
        warmSession(sessionId);
    }, [sessions, transcriptsBySession, warmSession]);

    const deleteSession = useCallback((sessionId: string) => {
        if (sessions.length <= 1) return;
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
            setCurrentSessionId(nextSessions[0].id);
            writeCurrentSessionId(nextSessions[0].id);
            warmSession(nextSessions[0].id);
        }
    }, [currentSessionId, sessions, warmSession]);

    const updateSessionName = useCallback((sessionId: string, name: string) => {
        const nextName = name.trim() || defaultWorkspaceName;
        setSessions((prev) => prev.map((session) => (
            session.id === sessionId ? { ...session, name: nextName } : session
        )));
        void updateChatSessionName(sessionId, nextName);
    }, [defaultWorkspaceName]);

    const setCurrentTranscript = useCallback((sessionId: string, messages: SessionSnapshotMessage[]) => {
        setTranscriptsBySession((prev) => ({ ...prev, [sessionId]: messages }));
        scheduleTranscriptSave(sessionId, messages);
    }, [scheduleTranscriptSave]);

    const clearCurrentTranscript = useCallback((
        sessionId: string,
        options: { persist?: boolean; conversationVersion?: number } = {},
    ) => {
        if (typeof options.conversationVersion === 'number') {
            conversationVersionsRef.current[sessionId] = options.conversationVersion;
            setSessions((prev) => prev.map((session) => (
                session.id === sessionId
                    ? { ...session, conversationVersion: options.conversationVersion as number }
                    : session
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
        const deduped = Array.from(new Set(files));
        setAttachedFilesBySession((prev) => ({ ...prev, [currentSession.id]: deduped }));
        void saveSessionAttachedFiles(
            currentSession.id,
            deduped,
            conversationVersionsRef.current[currentSession.id],
        );
    }, [currentSession.id]);

    const toggleAttachedFile = useCallback((filePath: string) => {
        const current = attachedFilesBySession[currentSession.id] || [];
        const nextFiles = current.includes(filePath)
            ? current.filter((item) => item !== filePath)
            : [...current, filePath];
        setAttachedFilesBySession((prev) => ({ ...prev, [currentSession.id]: nextFiles }));
        void saveSessionAttachedFiles(
            currentSession.id,
            nextFiles,
            conversationVersionsRef.current[currentSession.id],
        );
    }, [attachedFilesBySession, currentSession.id]);

    const clearAttachedFiles = useCallback((options: { persist?: boolean } = {}) => {
        setAttachedFilesBySession((prev) => ({ ...prev, [currentSession.id]: [] }));
        if (options.persist === false) return;
        void saveSessionAttachedFiles(
            currentSession.id,
            [],
            conversationVersionsRef.current[currentSession.id],
        );
    }, [currentSession.id]);

    const isFileAttached = useCallback((filePath: string) => {
        return attachedFiles.includes(filePath);
    }, [attachedFiles]);

    if (!isLoaded || !currentSession.id) {
        return null;
    }

    return (
        <SessionContext.Provider value={{
            currentSession,
            sessions,
            currentTranscript,
            attachedFiles,
            createSession,
            switchSession,
            deleteSession,
            updateSessionName,
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
    if (!context) {
        throw new Error('useSession must be used within a SessionProvider');
    }
    return context;
}

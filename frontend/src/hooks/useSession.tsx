import { useState, useCallback, createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { SessionSnapshotMessage } from '../api/client';
import { useLanguage } from '../context/LanguageContext';

export interface Session {
    id: string;
    name: string;
    createdAt: string;
}

const SESSIONS_STORAGE_KEY = 'data-agent:sessions';
const CURRENT_SESSION_STORAGE_KEY = 'data-agent:current-session';
const SESSION_TRANSCRIPTS_STORAGE_KEY = 'data-agent:session-transcripts';
const SESSION_ATTACHED_FILES_STORAGE_KEY = 'data-agent:session-attached-files';

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
    clearCurrentTranscript: (sessionId: string) => void;
    setAttachedFiles: (files: string[]) => void;
    toggleAttachedFile: (filePath: string) => void;
    clearAttachedFiles: () => void;
    isFileAttached: (filePath: string) => boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

interface SessionProviderProps {
    children: ReactNode;
}

function createSessionId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `session_${crypto.randomUUID()}`;
    }
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createInitialSession(name: string): Session {
    return {
        id: createSessionId(),
        name,
        createdAt: new Date().toISOString(),
    };
}

function readStorage<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') {
        return fallback;
    }
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return fallback;
        }
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeStorage<T>(key: string, value: T) {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
}

export function SessionProvider({ children }: SessionProviderProps) {
    const { t } = useLanguage();

    const [sessions, setSessions] = useState<Session[]>(() => {
        const storedSessions = readStorage<Session[]>(SESSIONS_STORAGE_KEY, []);
        if (storedSessions.length > 0) {
            return storedSessions;
        }
        const initialSession = createInitialSession(t('session.newWorkspace') || '新建工作区');
        writeStorage(SESSIONS_STORAGE_KEY, [initialSession]);
        writeStorage(CURRENT_SESSION_STORAGE_KEY, initialSession.id);
        return [initialSession];
    });

    const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
        const stored = readStorage<string>(CURRENT_SESSION_STORAGE_KEY, '');
        if (stored) {
            return stored;
        }
        const initialSession = readStorage<Session[]>(SESSIONS_STORAGE_KEY, [])[0];
        return initialSession?.id || '';
    });

    const [transcriptsBySession, setTranscriptsBySession] = useState<SessionTranscriptStore>(() =>
        readStorage<SessionTranscriptStore>(SESSION_TRANSCRIPTS_STORAGE_KEY, {})
    );

    const [attachedFilesBySession, setAttachedFilesBySession] = useState<SessionAttachedFilesStore>(() =>
        readStorage<SessionAttachedFilesStore>(SESSION_ATTACHED_FILES_STORAGE_KEY, {})
    );

    const currentSession = useMemo(() => {
        const existing = sessions.find((session) => session.id === currentSessionId);
        if (existing) {
            return existing;
        }
        const fallback = sessions[0] || createInitialSession(t('session.newWorkspace') || '新建工作区');
        if (!existing && sessions.length === 0) {
            setSessions([fallback]);
            writeStorage(SESSIONS_STORAGE_KEY, [fallback]);
        }
        if (fallback.id !== currentSessionId) {
            setCurrentSessionId(fallback.id);
            writeStorage(CURRENT_SESSION_STORAGE_KEY, fallback.id);
        }
        return fallback;
    }, [currentSessionId, sessions]);

    const currentTranscript = transcriptsBySession[currentSession.id] || [];
    const attachedFiles = attachedFilesBySession[currentSession.id] || [];

    const createSession = useCallback((name?: string) => {
        const newSession: Session = {
            id: createSessionId(),
            name: name || `${t('session.workspacePrefix') || '工作区'} ${sessions.length + 1}`,
            createdAt: new Date().toISOString(),
        };
        setSessions((prev) => {
            const next = [...prev, newSession];
            writeStorage(SESSIONS_STORAGE_KEY, next);
            return next;
        });
        setCurrentSessionId(newSession.id);
        writeStorage(CURRENT_SESSION_STORAGE_KEY, newSession.id);
        return newSession;
    }, [sessions.length]);

    const switchSession = useCallback((sessionId: string) => {
        const session = sessions.find((item) => item.id === sessionId);
        if (!session) {
            return;
        }
        setCurrentSessionId(sessionId);
        writeStorage(CURRENT_SESSION_STORAGE_KEY, sessionId);
    }, [sessions]);

    const deleteSession = useCallback((sessionId: string) => {
        if (sessions.length <= 1) return;

        const newSessions = sessions.filter((session) => session.id !== sessionId);
        setSessions(newSessions);
        writeStorage(SESSIONS_STORAGE_KEY, newSessions);

        setTranscriptsBySession((prev) => {
            const next = { ...prev };
            delete next[sessionId];
            writeStorage(SESSION_TRANSCRIPTS_STORAGE_KEY, next);
            return next;
        });

        setAttachedFilesBySession((prev) => {
            const next = { ...prev };
            delete next[sessionId];
            writeStorage(SESSION_ATTACHED_FILES_STORAGE_KEY, next);
            return next;
        });

        if (sessionId === currentSessionId) {
            const nextSession = newSessions[0];
            setCurrentSessionId(nextSession.id);
            writeStorage(CURRENT_SESSION_STORAGE_KEY, nextSession.id);
        }
    }, [currentSessionId, sessions]);

    const updateSessionName = useCallback((sessionId: string, name: string) => {
        setSessions((prev) => {
            const next = prev.map((session) => (
                session.id === sessionId ? { ...session, name } : session
            ));
            writeStorage(SESSIONS_STORAGE_KEY, next);
            return next;
        });
    }, []);

    const setCurrentTranscript = useCallback((sessionId: string, messages: SessionSnapshotMessage[]) => {
        setTranscriptsBySession((prev) => {
            const next = {
                ...prev,
                [sessionId]: messages,
            };
            writeStorage(SESSION_TRANSCRIPTS_STORAGE_KEY, next);
            return next;
        });
    }, []);

    const clearCurrentTranscript = useCallback((sessionId: string) => {
        setTranscriptsBySession((prev) => {
            const next = {
                ...prev,
                [sessionId]: [],
            };
            writeStorage(SESSION_TRANSCRIPTS_STORAGE_KEY, next);
            return next;
        });
    }, []);

    const setAttachedFiles = useCallback((files: string[]) => {
        const deduped = Array.from(new Set(files));
        setAttachedFilesBySession((prev) => {
            const next = {
                ...prev,
                [currentSession.id]: deduped,
            };
            writeStorage(SESSION_ATTACHED_FILES_STORAGE_KEY, next);
            return next;
        });
    }, [currentSession.id]);

    const toggleAttachedFile = useCallback((filePath: string) => {
        setAttachedFilesBySession((prev) => {
            const current = prev[currentSession.id] || [];
            const nextFiles = current.includes(filePath)
                ? current.filter((item) => item !== filePath)
                : [...current, filePath];
            const next = {
                ...prev,
                [currentSession.id]: nextFiles,
            };
            writeStorage(SESSION_ATTACHED_FILES_STORAGE_KEY, next);
            return next;
        });
    }, [currentSession.id]);

    const clearAttachedFiles = useCallback(() => {
        setAttachedFilesBySession((prev) => {
            const next = {
                ...prev,
                [currentSession.id]: [],
            };
            writeStorage(SESSION_ATTACHED_FILES_STORAGE_KEY, next);
            return next;
        });
    }, [currentSession.id]);

    const isFileAttached = useCallback((filePath: string) => {
        return attachedFiles.includes(filePath);
    }, [attachedFiles]);

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

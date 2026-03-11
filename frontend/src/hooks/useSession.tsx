import { useState, useCallback, createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface Session {
    id: string;
    name: string;
    createdAt: string;
}

interface SessionContextType {
    currentSession: Session;
    sessions: Session[];
    createSession: (name?: string) => Session;
    switchSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => void;
    updateSessionName: (sessionId: string, name: string) => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);


interface SessionProviderProps {
    children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
    const [sessions, setSessions] = useState<Session[]>(() => {
        const initialSession: Session = {
            id: `session_${Date.now()}`,
            name: '新建会话',
            createdAt: new Date().toISOString(),
        };
        return [initialSession];
    });
    const [currentSession, setCurrentSession] = useState<Session>(() => sessions ? sessions[0] : {
        id: `session_${Date.now()}`,
        name: '新建会话',
        createdAt: new Date().toISOString(),
    });

    // Ensure currentSession is synchronized with the first item if sessions state is initialized later
    // In this case, we use the function initializer for useState so it's consistent.

    const createSession = useCallback((name?: string) => {
        const newSession: Session = {
            id: `session_${Date.now()}`,
            name: name || `会话 ${sessions.length + 1}`,
            createdAt: new Date().toISOString(),
        };
        setSessions(prev => [...prev, newSession]);
        setCurrentSession(newSession);
        return newSession;
    }, [sessions.length]);

    const switchSession = useCallback((sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            setCurrentSession(session);
        }
    }, [sessions]);

    const deleteSession = useCallback((sessionId: string) => {
        if (sessions.length <= 1) return; // 不允许删除最后一个会话

        const newSessions = sessions.filter(s => s.id !== sessionId);
        setSessions(newSessions);

        if (sessionId === currentSession.id) {
            setCurrentSession(newSessions[0]);
        }
    }, [sessions, currentSession.id]);

    const updateSessionName = useCallback((sessionId: string, name: string) => {
        setSessions(prev => prev.map(s =>
            s.id === sessionId ? { ...s, name } : s
        ));
        if (currentSession.id === sessionId) {
            setCurrentSession(prev => ({ ...prev, name }));
        }
    }, [currentSession.id]);

    return (
        <SessionContext.Provider value={{
            currentSession,
            sessions,
            createSession,
            switchSession,
            deleteSession,
            updateSessionName,
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

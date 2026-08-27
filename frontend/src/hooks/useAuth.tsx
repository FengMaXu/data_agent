import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
    getAuthStatus,
    login as apiLogin,
    logout as apiLogout,
    register as apiRegister,
    type AuthUser,
} from '../api/client';

interface AuthContextType {
    status: 'checking' | 'authenticated' | 'anonymous';
    user: AuthUser | null;
    registrationOpen: boolean;
    login: (username: string, password: string) => Promise<void>;
    register: (username: string, password: string, displayName?: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const isDesktop = typeof window !== 'undefined' && Boolean(window.dataAgentRuntime);
    const [status, setStatus] = useState<AuthContextType['status']>(() => isDesktop ? 'authenticated' : 'checking');
    const [user, setUser] = useState<AuthUser | null>(() => isDesktop ? { id: 'local', username: 'local', display_name: 'Local user' } : null);
    const [registrationOpen, setRegistrationOpen] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const payload = await getAuthStatus();
            setRegistrationOpen(payload.registration_open);
            setUser(payload.user);
            setStatus(payload.authenticated ? 'authenticated' : 'anonymous');
        } catch {
            setStatus('anonymous');
        }
    }, []);

    useEffect(() => {
        if (isDesktop) return;
        const timer = window.setTimeout(() => { void refresh(); }, 0);
        return () => window.clearTimeout(timer);
    }, [isDesktop, refresh]);

    const login = useCallback(async (username: string, password: string) => {
        const payload = await apiLogin(username, password);
        setUser(payload.user);
        setStatus('authenticated');
    }, []);

    const register = useCallback(async (username: string, password: string, displayName?: string) => {
        const payload = await apiRegister(username, password, displayName);
        setUser(payload.user);
        setStatus('authenticated');
        setRegistrationOpen(false);
    }, []);

    const logout = useCallback(async () => {
        if (isDesktop) return;
        await apiLogout();
        setUser(null);
        setStatus('anonymous');
    }, [isDesktop]);

    const value = useMemo(() => ({
        status,
        user,
        registrationOpen,
        login,
        register,
        logout,
    }), [login, logout, register, registrationOpen, status, user]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

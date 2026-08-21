import React, { useState } from 'react';
import { LockKeyhole, LogIn, UserPlus } from './icons/Typicons';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../context/LanguageContext';

interface LoginViewProps {
    embedded?: boolean;
}

const LoginView: React.FC<LoginViewProps> = ({ embedded = false }) => {
    const { login, register, registrationOpen } = useAuth();
    const { t } = useLanguage();
    const [mode, setMode] = useState<'login' | 'register'>(registrationOpen ? 'register' : 'login');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const isRegister = mode === 'register';

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            if (isRegister) {
                await register(username, password, username);
            } else {
                await login(username, password);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('auth.errorFallback'));
        } finally {
            setSubmitting(false);
        }
    };

    const form = (
            <form className={`auth-panel ${embedded ? 'auth-panel-embedded' : ''}`} onSubmit={handleSubmit}>
                <div className="auth-brand">
                    <div className="auth-mark">
                        <LockKeyhole size={22} />
                    </div>
                    <div>
                        <h1>YourDB</h1>
                        <p>{isRegister ? t('auth.registerSubtitle') : t('auth.loginSubtitle')}</p>
                    </div>
                </div>

                <label className="auth-field">
                    <span>{t('auth.username')}</span>
                    <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        autoComplete="username"
                        minLength={3}
                        required
                    />
                </label>

                <label className="auth-field">
                    <span>{t('auth.password')}</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete={isRegister ? 'new-password' : 'current-password'}
                        minLength={8}
                        required
                    />
                </label>

                {error && <div className="auth-error" role="alert" aria-live="assertive">{error}</div>}

                <button className="auth-submit" type="submit" disabled={submitting}>
                    {isRegister ? <UserPlus size={18} /> : <LogIn size={18} />}
                    <span>{submitting ? t('auth.submitting') : isRegister ? t('auth.createAccount') : t('auth.signIn')}</span>
                </button>

                {registrationOpen && (
                    <button
                        className="auth-mode-toggle"
                        type="button"
                        onClick={() => setMode(isRegister ? 'login' : 'register')}
                    >
                        {isRegister ? t('auth.useExisting') : t('auth.createFirst')}
                    </button>
                )}
            </form>
    );

    if (embedded) {
        return form;
    }

    return (
        <main className="auth-shell">
            {form}
        </main>
    );
};

export default LoginView;

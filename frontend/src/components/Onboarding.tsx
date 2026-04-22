import React, { useState } from 'react';
import { Database, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import {
    testLLMConfig,
    updateDBConfig,
    updateLLMConfig,
    type DBConfigUpdate,
    type LLMConfigUpdate,
} from '../api/client';

interface OnboardingProps {
    onComplete: () => void;
}

const defaultOpenAIBaseUrl = 'https://api.openai.com/v1';

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
    const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
    const [openaiKey, setOpenaiKey] = useState('');
    const [anthropicKey, setAnthropicKey] = useState('');
    const [baseUrl, setBaseUrl] = useState(defaultOpenAIBaseUrl);
    const [model, setModel] = useState('gpt-4o-mini');
    const [dbConfig, setDbConfig] = useState<DBConfigUpdate>({
        host: 'localhost',
        port: 3306,
        user: '',
        password: '',
        database: '',
    });
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const activeKey = provider === 'anthropic' ? anthropicKey : openaiKey;
    const hasDesktopStorage = Boolean(window.dataAgent);

    const buildLLMPayload = (): LLMConfigUpdate => {
        if (provider === 'anthropic') {
            return {
                provider,
                api_key: anthropicKey,
                anthropic_api_key: anthropicKey,
                model: model || 'claude-sonnet-4-20250514',
            };
        }

        return {
            provider,
            api_key: openaiKey,
            openai_api_key: openaiKey,
            base_url: baseUrl || defaultOpenAIBaseUrl,
            model: model || 'gpt-4o-mini',
        };
    };

    const handleProviderChange = (nextProvider: 'openai' | 'anthropic') => {
        setProvider(nextProvider);
        setError(null);
        if (nextProvider === 'anthropic') {
            setModel('claude-sonnet-4-20250514');
        } else {
            setModel('gpt-4o-mini');
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        if (!activeKey.trim()) {
            setError('Please enter at least one API key before continuing.');
            return;
        }

        setIsSaving(true);
        try {
            const llmPayload = buildLLMPayload();
            const testResult = await testLLMConfig(llmPayload);
            if (!testResult.success) {
                throw new Error(testResult.message || 'LLM verification failed');
            }

            if (window.dataAgent) {
                await window.dataAgent.saveSecrets({
                    openai_api_key: openaiKey || undefined,
                    anthropic_api_key: anthropicKey || undefined,
                    default_model: llmPayload.model,
                    openai_base_url: provider === 'openai' ? baseUrl : undefined,
                });
            }

            await updateLLMConfig(llmPayload);

            if (dbConfig.database || dbConfig.user || dbConfig.password) {
                await updateDBConfig(dbConfig);
            }

            onComplete();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save configuration');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <main className="onboarding-shell">
            <section className="onboarding-card">
                <div className="onboarding-copy">
                    <div className="onboarding-kicker">
                        <ShieldCheck size={18} />
                        Desktop setup
                    </div>
                    <h1>Connect Data Agent to your model provider</h1>
                    <p>
                        Add one provider key to unlock the local assistant. In the desktop app,
                        secrets are encrypted through Electron safeStorage before they are reused.
                    </p>
                    {!hasDesktopStorage && (
                        <div className="onboarding-warning">
                            Browser dev mode detected. Keys will be sent to the backend for this
                            session, but they will not be persisted in localStorage.
                        </div>
                    )}
                </div>

                <form className="onboarding-form" onSubmit={handleSubmit}>
                    <div className="onboarding-provider-toggle" role="tablist" aria-label="Model provider">
                        <button
                            type="button"
                            className={provider === 'openai' ? 'active' : ''}
                            onClick={() => handleProviderChange('openai')}
                        >
                            OpenAI compatible
                        </button>
                        <button
                            type="button"
                            className={provider === 'anthropic' ? 'active' : ''}
                            onClick={() => handleProviderChange('anthropic')}
                        >
                            Anthropic
                        </button>
                    </div>

                    <label className="onboarding-field">
                        <span><KeyRound size={16} /> API key</span>
                        <input
                            type="password"
                            value={provider === 'anthropic' ? anthropicKey : openaiKey}
                            onChange={(event) => {
                                if (provider === 'anthropic') {
                                    setAnthropicKey(event.target.value);
                                } else {
                                    setOpenaiKey(event.target.value);
                                }
                            }}
                            placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                            autoComplete="off"
                        />
                    </label>

                    {provider === 'openai' && (
                        <label className="onboarding-field">
                            <span>Base URL</span>
                            <input
                                type="url"
                                value={baseUrl}
                                onChange={(event) => setBaseUrl(event.target.value)}
                                placeholder={defaultOpenAIBaseUrl}
                            />
                        </label>
                    )}

                    <label className="onboarding-field">
                        <span>Default model</span>
                        <input
                            type="text"
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            placeholder={provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini'}
                        />
                    </label>

                    <div className="onboarding-db-panel">
                        <div className="onboarding-db-title">
                            <Database size={17} />
                            Optional MySQL connection
                        </div>
                        <div className="onboarding-db-grid">
                            <input
                                value={dbConfig.host}
                                onChange={(event) => setDbConfig((prev) => ({ ...prev, host: event.target.value }))}
                                placeholder="Host"
                            />
                            <input
                                type="number"
                                value={dbConfig.port}
                                onChange={(event) => setDbConfig((prev) => ({ ...prev, port: Number(event.target.value) || 3306 }))}
                                placeholder="Port"
                            />
                            <input
                                value={dbConfig.user}
                                onChange={(event) => setDbConfig((prev) => ({ ...prev, user: event.target.value }))}
                                placeholder="User"
                            />
                            <input
                                type="password"
                                value={dbConfig.password}
                                onChange={(event) => setDbConfig((prev) => ({ ...prev, password: event.target.value }))}
                                placeholder="Password"
                            />
                            <input
                                className="wide"
                                value={dbConfig.database}
                                onChange={(event) => setDbConfig((prev) => ({ ...prev, database: event.target.value }))}
                                placeholder="Database name"
                            />
                        </div>
                    </div>

                    {error && <div className="onboarding-error">{error}</div>}

                    <button className="onboarding-submit" type="submit" disabled={isSaving}>
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : null}
                        {isSaving ? 'Verifying...' : 'Verify and start'}
                    </button>
                </form>
            </section>
        </main>
    );
};

export default Onboarding;

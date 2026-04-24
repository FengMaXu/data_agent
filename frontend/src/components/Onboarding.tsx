import React, { useState } from 'react';
import { Database, KeyRound, Languages, Loader2, ShieldCheck } from 'lucide-react';
import {
    testLLMConfig,
    updateDBConfig,
    updateLLMConfig,
    type DBConfigUpdate,
    type LLMConfigUpdate,
} from '../api/client';
import { useLanguage } from '../context/LanguageContext';

interface OnboardingProps {
    onComplete: () => void;
}

const defaultOpenAIBaseUrl = 'https://api.openai.com/v1';

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
    const { language, setLanguage, t } = useLanguage();
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

    const titleLines = [t('onboarding.titleLine1'), t('onboarding.titleLine2')];
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
            setError(t('onboarding.errorMissingKey'));
            return;
        }

        setIsSaving(true);
        try {
            const llmPayload = buildLLMPayload();
            const testResult = await testLLMConfig(llmPayload);
            if (!testResult.success) {
                throw new Error(testResult.message || t('onboarding.errorVerify'));
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
            setError(err instanceof Error ? err.message : t('onboarding.errorSave'));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <main className="onboarding-shell">
            <section className="onboarding-card">
                <div className={`onboarding-copy onboarding-copy-${language}`}>
                    <div className="onboarding-kicker">
                        <ShieldCheck size={18} />
                        {t('onboarding.badge')}
                    </div>
                    <div className="onboarding-copy-body">
                        <div className="onboarding-copy-title">
                            {titleLines.map((line) => (
                                <span key={line}>{line}</span>
                            ))}
                        </div>
                        <p className="onboarding-copy-description">{t('onboarding.description')}</p>
                    </div>
                    <div className="onboarding-copy-meta">
                        <div className="onboarding-copy-meta-label">{t('onboarding.featureLabel')}</div>
                        <ul className="onboarding-copy-points">
                            <li>{t('onboarding.featureOne')}</li>
                            <li>{t('onboarding.featureTwo')}</li>
                            <li>{t('onboarding.featureThree')}</li>
                        </ul>
                    </div>
                    {!hasDesktopStorage && (
                        <div className="onboarding-warning">
                            {t('onboarding.browserWarning')}
                        </div>
                    )}
                </div>

                <form className="onboarding-form" onSubmit={handleSubmit}>
                    <div className="onboarding-form-header">
                        <div className="onboarding-form-eyebrow">{t('onboarding.formEyebrow')}</div>
                        <h2>{t('onboarding.formTitle')}</h2>
                        <p>{t('onboarding.formDescription')}</p>
                    </div>

                    <div className="onboarding-form-scroll">
                        <section className="onboarding-step-card">
                            <div className="onboarding-step-header">
                                <span className="onboarding-step-icon">
                                    <Languages size={17} />
                                </span>
                                <div>
                                    <div className="onboarding-step-title">{t('onboarding.languageLabel')}</div>
                                    <div className="onboarding-step-hint">{t('onboarding.languageHint')}</div>
                                </div>
                            </div>
                            <div className="onboarding-language-toggle" role="group" aria-label={t('onboarding.languageLabel')}>
                                {(['zh', 'en'] as const).map((langOption) => (
                                    <button
                                        key={langOption}
                                        type="button"
                                        className={language === langOption ? 'active' : ''}
                                        onClick={() => setLanguage(langOption)}
                                    >
                                        {langOption === 'zh' ? t('onboarding.language.zh') : t('onboarding.language.en')}
                                    </button>
                                ))}
                            </div>
                        </section>

                        <div className="onboarding-provider-toggle" role="tablist" aria-label={t('onboarding.providerAria')}>
                            <button
                                type="button"
                                className={provider === 'openai' ? 'active' : ''}
                                onClick={() => handleProviderChange('openai')}
                            >
                                {t('onboarding.provider.openai')}
                            </button>
                            <button
                                type="button"
                                className={provider === 'anthropic' ? 'active' : ''}
                                onClick={() => handleProviderChange('anthropic')}
                            >
                                {t('onboarding.provider.anthropic')}
                            </button>
                        </div>

                        <label className="onboarding-field">
                            <span><KeyRound size={16} /> {t('onboarding.apiKey')}</span>
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
                                <span>{t('onboarding.baseUrl')}</span>
                                <input
                                    type="url"
                                    value={baseUrl}
                                    onChange={(event) => setBaseUrl(event.target.value)}
                                    placeholder={defaultOpenAIBaseUrl}
                                />
                            </label>
                        )}

                        <label className="onboarding-field">
                            <span>{t('onboarding.defaultModel')}</span>
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
                                {t('onboarding.optionalMySql')}
                            </div>
                            <div className="onboarding-db-grid">
                                <input
                                    value={dbConfig.host}
                                    onChange={(event) => setDbConfig((prev) => ({ ...prev, host: event.target.value }))}
                                    placeholder={t('onboarding.host')}
                                />
                                <input
                                    type="number"
                                    value={dbConfig.port}
                                    onChange={(event) => setDbConfig((prev) => ({ ...prev, port: Number(event.target.value) || 3306 }))}
                                    placeholder={t('onboarding.port')}
                                />
                                <input
                                    value={dbConfig.user}
                                    onChange={(event) => setDbConfig((prev) => ({ ...prev, user: event.target.value }))}
                                    placeholder={t('onboarding.user')}
                                />
                                <input
                                    type="password"
                                    value={dbConfig.password}
                                    onChange={(event) => setDbConfig((prev) => ({ ...prev, password: event.target.value }))}
                                    placeholder={t('onboarding.password')}
                                />
                                <input
                                    className="wide"
                                    value={dbConfig.database}
                                    onChange={(event) => setDbConfig((prev) => ({ ...prev, database: event.target.value }))}
                                    placeholder={t('onboarding.databaseName')}
                                />
                            </div>
                        </div>

                        {error && <div className="onboarding-error">{error}</div>}
                    </div>

                    <div className="onboarding-form-footer">
                        <button className="onboarding-submit" type="submit" disabled={isSaving}>
                            {isSaving ? <Loader2 size={18} className="animate-spin" /> : null}
                            {isSaving ? t('onboarding.verifying') : t('onboarding.verify')}
                        </button>
                    </div>
                </form>
            </section>
        </main>
    );
};

export default Onboarding;

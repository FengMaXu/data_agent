import React from 'react';
import { KeyRound } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

/** The runtime refuses to start an agent session without a model profile. */
export function isModelNotConfiguredError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.includes('LLM_NOT_CONFIGURED');
}

export interface ModelSetupPromptProps {
    onConfigure: () => void;
}

/** Shares the startup strip styling so both notices read as one family. */
export const ModelSetupPrompt: React.FC<ModelSetupPromptProps> = ({ onConfigure }) => {
    const { t } = useLanguage();
    return (
        <div className="startup-strip" role="status">
            <div className="startup-main">
                <KeyRound size={17} aria-hidden="true" />
                <strong>{t('modelSetup.title')}</strong>
                <span className="startup-hint">{t('modelSetup.hint')}</span>
            </div>
            <button type="button" className="startup-retry" onClick={onConfigure}>
                <span>{t('modelSetup.action')}</span>
            </button>
        </div>
    );
};

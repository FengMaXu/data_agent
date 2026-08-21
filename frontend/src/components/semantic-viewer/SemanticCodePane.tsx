import { useState } from 'react';
import { FileCode2, Copy, Check } from '../icons/Typicons';
import { useLanguage } from '../../context/LanguageContext';
import type { SemanticSourceViewDto } from './types';

export function SemanticCodePane({ dto }: { dto: SemanticSourceViewDto }) {
    const { t } = useLanguage();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (!dto.rawYaml) return;
        try {
            await navigator.clipboard.writeText(dto.rawYaml);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback
        }
    };

    if (!dto.rawYaml) {
        return (
            <div className="semantic-code-empty">
                <FileCode2 size={28} />
                <strong>{t('semantic.manifestOnly')}</strong>
                <p>{t('semantic.manifestOnlyDesc')}</p>
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 12px', background: '#252526', borderBottom: '1px solid #333' }}>
                <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={copied ? t('semantic.copied') : t('semantic.copy')}
                    style={{
                        background: 'transparent',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        color: copied ? '#4ade80' : '#d4d4d4',
                        padding: '3px 8px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}
                >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copied ? t('semantic.copied') : t('semantic.copy')}</span>
                </button>
            </div>
            <pre className="semantic-code-block" tabIndex={0} aria-label={`${dto.sourceName} ${t('semantic.yamlSource')}`} style={{ flex: 1, margin: 0, overflow: 'auto' }}>
                <code>{dto.rawYaml}</code>
            </pre>
        </div>
    );
}

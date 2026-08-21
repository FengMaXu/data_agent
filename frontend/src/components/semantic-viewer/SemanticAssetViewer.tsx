import { useEffect, useState } from 'react';
import { Columns2, Code2, Eye } from 'lucide-react';
import { SemanticCodePane } from './SemanticCodePane';
import { SemanticVisualPane } from './SemanticVisualPane';
import { useLanguage } from '../../context/LanguageContext';
import type { SemanticSourceViewDto } from './types';

export type SemanticViewerMode = 'split' | 'code' | 'visual';

type MobilePane = 'code' | 'visual';

interface Props {
    dto: SemanticSourceViewDto;
    onClose?: () => void;
    mode?: SemanticViewerMode;
    onModeChange?: (mode: SemanticViewerMode) => void;
}

export function SemanticAssetViewer({ dto, mode: controlledMode, onModeChange }: Props) {
    const { t } = useLanguage();
    const [internalMode, setInternalMode] = useState<SemanticViewerMode>('split');
    const [mobilePane, setMobilePane] = useState<MobilePane>('visual');
    const [isNarrow, setIsNarrow] = useState(false);
    const mode = controlledMode ?? internalMode;

    useEffect(() => {
        const media = window.matchMedia('(max-width: 767px)');
        const update = () => setIsNarrow(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    const changeMode = (nextMode: SemanticViewerMode) => {
        if (controlledMode === undefined) setInternalMode(nextMode);
        onModeChange?.(nextMode);
    };

    const effectiveMode: SemanticViewerMode = isNarrow && mode === 'split' ? mobilePane : mode;
    const splitActive = mode === 'split' && !isNarrow;
    const codeActive = mode === 'code' || (isNarrow && mode === 'split' && mobilePane === 'code');
    const visualActive = mode === 'visual' || (isNarrow && mode === 'split' && mobilePane === 'visual');

    return (
        <div className="semantic-asset-viewer">
            <div className="semantic-viewer-toolbar" role="toolbar" aria-label={t('semantic.toolbarLabel')}>
                <div className="semantic-viewer-mode-group">
                    <button type="button" className={`semantic-mode-button ${splitActive ? 'active' : ''}`} aria-pressed={splitActive} onClick={() => changeMode('split')}>
                        <Columns2 size={14} /> {t('semantic.split')}
                    </button>
                    <button type="button" className={`semantic-mode-button ${codeActive ? 'active' : ''}`} aria-pressed={codeActive} onClick={() => { setMobilePane('code'); changeMode('code'); }}>
                        <Code2 size={14} /> {t('semantic.code')}
                    </button>
                    <button type="button" className={`semantic-mode-button ${visualActive ? 'active' : ''}`} aria-pressed={visualActive} onClick={() => { setMobilePane('visual'); changeMode('visual'); }}>
                        <Eye size={14} /> {t('semantic.visual')}
                    </button>
                </div>
                {isNarrow && mode === 'split' && <span className="semantic-mobile-hint">{t('semantic.narrowHint')}</span>}
            </div>
            <div className={`semantic-viewer-body mode-${effectiveMode}`}>
                <div className="semantic-code-pane"><SemanticCodePane dto={dto} /></div>
                <div className="semantic-visual-pane"><SemanticVisualPane dto={dto} /></div>
            </div>
        </div>
    );
}

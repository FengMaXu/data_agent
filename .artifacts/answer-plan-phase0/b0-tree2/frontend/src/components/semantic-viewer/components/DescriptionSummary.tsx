import { Info, User } from '../../icons/Typicons';
import type { SemanticSourceViewDto } from '../types';

const PROVENANCE_LABELS: Record<string, string> = {
    ai: '🤖 AI 生成',
    dbt: '📦 dbt',
    db: '🗄️ 数据库',
    ktx: '⚙️ 系统兜底',
};

export function DescriptionSummary({ dto }: { dto: SemanticSourceViewDto }) {
    const description = dto.primaryDescription || dto.descriptions.user || dto.descriptions.ai;
    const provenance = dto.descriptionProvenance;
    const provenanceLabel = provenance ? PROVENANCE_LABELS[provenance] || provenance : null;
    const isSystemFallback = provenance === 'ktx';

    return (
        <section className={`semantic-summary ${isSystemFallback ? 'is-system-fallback' : ''}`}>
            <div className="semantic-section-heading">
                <span className="semantic-section-icon"><Info size={15} /></span>
                <h2>业务速览</h2>
            </div>
            {description ? (
                <p className="semantic-summary-text">{description}</p>
            ) : (
                <p className="semantic-summary-empty">暂无业务说明</p>
            )}
            <div className="semantic-summary-meta">
                {provenanceLabel && <span>{provenanceLabel}</span>}
                {!provenanceLabel && <span><User size={12} /> 未标注来源</span>}
            </div>
        </section>
    );
}

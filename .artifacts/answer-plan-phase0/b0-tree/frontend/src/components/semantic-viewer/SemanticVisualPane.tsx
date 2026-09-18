import { Database } from '../icons/Typicons';
import { Tag } from 'lucide-react';
import { ColumnFieldGroup } from './components/ColumnFieldGroup';
import { DescriptionSummary } from './components/DescriptionSummary';
import { JoinRelationList } from './components/JoinRelationList';
import { MeasureCardList } from './components/MeasureCardList';
import { SegmentChipList } from './components/SegmentChipList';
import { BusinessKnowledgePane } from './components/BusinessKnowledgePane';
import { useLanguage } from '../../context/LanguageContext';
import type { SemanticSourceViewDto } from './types';

export function SemanticVisualPane({ dto }: { dto: SemanticSourceViewDto }) {
    const { t } = useLanguage();
    const sourceReference = dto.assetType === 'business_knowledge'
        ? t('semantic.businessKnowledge')
        : (dto.table || dto.sql || t('semantic.noPhysicalSource'));
    return (
        <div className="semantic-visual-content">
            <div className="semantic-source-meta">
                <span><Database size={13} /> {sourceReference}</span>
                {dto.defaultTimeDimension && <span>{t('semantic.defaultTime')}{dto.defaultTimeDimension}</span>}
            </div>
            <DescriptionSummary dto={dto} />
            {dto.assetType === 'business_knowledge' ? (
                <BusinessKnowledgePane dto={dto} />
            ) : (
                <>
                    <MeasureCardList measures={dto.measures} />
                    <ColumnFieldGroup columns={dto.columns} />
                    <SegmentChipList segments={dto.segments} />
                    <JoinRelationList joins={dto.joins} />
                </>
            )}
            {dto.tags.length > 0 && (
                <section className="semantic-section semantic-tags-section">
                    <div className="semantic-section-heading">
                        <span className="semantic-section-icon"><Tag size={15} /></span>
                        <h2>{t('semantic.tags')} <span className="semantic-count">{dto.tags.length}</span></h2>
                    </div>
                    <div className="semantic-tag-list">
                        {dto.tags.map((tag) => <span className="semantic-tag" key={tag}>{tag}</span>)}
                    </div>
                </section>
            )}
        </div>
    );
}

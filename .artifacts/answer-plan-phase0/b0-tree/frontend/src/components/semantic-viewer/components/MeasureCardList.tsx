import { Activity } from '../../icons/Typicons';
import type { MeasureView } from '../types';

export function MeasureCardList({ measures }: { measures: MeasureView[] }) {
    return (
        <section className="semantic-section">
            <div className="semantic-section-heading">
                <span className="semantic-section-icon"><Activity size={15} /></span>
                <h2>核心指标 <span className="semantic-count">{measures.length}</span></h2>
            </div>
            {measures.length === 0 ? (
                <p className="semantic-empty">未定义指标</p>
            ) : (
                <div className="semantic-measure-list">
                    {measures.map((measure) => (
                        <article className="semantic-measure-card" key={measure.name}>
                            <div className="semantic-measure-name">{measure.name}</div>
                            <code className="semantic-expression">{measure.expr}</code>
                            {measure.description && <p className="semantic-card-description">{measure.description}</p>}
                            {measure.filter && (
                                <div className="semantic-rule-row"><span>过滤</span><code>{measure.filter}</code></div>
                            )}
                            {measure.segments && measure.segments.length > 0 && (
                                <div className="semantic-rule-row"><span>分群</span><span className="semantic-inline-tags">{measure.segments.join(' · ')}</span></div>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

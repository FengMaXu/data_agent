import { Link } from '../../icons/Typicons';
import type { JoinView } from '../types';

export function JoinRelationList({ joins }: { joins: JoinView[] }) {
    return (
        <section className="semantic-section">
            <div className="semantic-section-heading">
                <span className="semantic-section-icon"><Link size={15} /></span>
                <h2>关联关系 <span className="semantic-count">{joins.length}</span></h2>
            </div>
            {joins.length === 0 ? (
                <p className="semantic-empty">无关联定义</p>
            ) : (
                <div className="semantic-join-list">
                    {joins.map((join, index) => (
                        <article className="semantic-join-card" key={`${join.to}-${join.on}-${index}`}>
                            <div className="semantic-join-header">
                                <strong>{join.to}</strong>
                                <span className="semantic-relationship-badge">{join.relationship}</span>
                            </div>
                            <code className="semantic-expression">{join.on}</code>
                            {join.alias && <div className="semantic-join-alias">别名：{join.alias}</div>}
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}

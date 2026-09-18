import { Filter } from 'lucide-react';
import type { SegmentView } from '../types';

export function SegmentChipList({ segments }: { segments: SegmentView[] }) {
    if (segments.length === 0) return null;
    return (
        <section className="semantic-section">
            <div className="semantic-section-heading">
                <span className="semantic-section-icon"><Filter size={15} /></span>
                <h2>分群规则 <span className="semantic-count">{segments.length}</span></h2>
            </div>
            <div className="semantic-segment-list">
                {segments.map((segment) => (
                    <article className="semantic-segment-card" key={segment.name}>
                        <div className="semantic-segment-name">{segment.name}</div>
                        <code className="semantic-expression">{segment.expr}</code>
                        {segment.description && <p className="semantic-card-description">{segment.description}</p>}
                    </article>
                ))}
            </div>
        </section>
    );
}

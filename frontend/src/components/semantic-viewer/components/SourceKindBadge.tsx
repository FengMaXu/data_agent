import type { SemanticSourceKind } from '../types';

const LABELS: Record<SemanticSourceKind, string> = {
    standalone: '独立模型',
    manifest_only: '系统 manifest',
    manifest_with_overlay: '含覆盖层',
    standalone_shadows_manifest: '遮蔽 manifest',
    orphan_overlay: '孤立覆盖层',
};

export function SourceKindBadge({ kind }: { kind: SemanticSourceKind }) {
    return (
        <span className={`semantic-source-kind semantic-source-kind-${kind}`}>
            {LABELS[kind]}
        </span>
    );
}

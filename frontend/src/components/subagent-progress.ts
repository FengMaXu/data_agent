import type { SubagentChildProgress } from '@data-agent/contracts';

function formatElapsed(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
}

/** subagent：名称  工具：当前工具名/已调用的工具数  用时：xx  产物：待输出/已输出 */
export function formatSubagentLine(child: SubagentChildProgress, now: number, t: (key: string) => string): string {
    const elapsed = formatElapsed((child.endedAt ?? now) - child.startedAt);
    const output = child.output === 'pending'
        ? t('chat.subagentOutputPending')
        : child.output === 'produced'
            ? t('chat.subagentOutputProduced')
            : t('chat.subagentOutputNone').replace('{status}', t(`chat.subagentStatus.${child.status}`));
    return t('chat.subagentLine')
        .replace('{name}', `${child.key}（${child.role}）`)
        .replace('{tool}', child.currentTool ?? '—')
        .replace('{count}', String(child.toolCalls))
        .replace('{elapsed}', elapsed)
        .replace('{output}', output);
}

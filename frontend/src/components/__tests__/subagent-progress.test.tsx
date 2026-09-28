import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SubagentChildProgress } from '@data-agent/contracts';
import { mapRuntimeEvent } from '../../api/chat-events';
import { formatSubagentLine } from '../subagent-progress';
import { subagentChildrenOf, mergeToolResultState, type ToolCallState } from '../tool-event-state';
import SubagentProgressLines from '../SubagentProgressLines';
import { LanguageProvider } from '../../context/LanguageContext';

const zh: Record<string, string> = {
    'chat.subagentLine': 'subagent：{name}  工具：{tool}/{count}  用时：{elapsed}  产物：{output}',
    'chat.subagentOutputPending': '待输出',
    'chat.subagentOutputProduced': '已输出',
    'chat.subagentOutputNone': '未输出（{status}）',
    'chat.subagentStatus.timed_out': '超时',
};
const t = (key: string) => zh[key] ?? key;

const running: SubagentChildProgress = { key: 'schema', role: 'explorer', task: '列出 orders 的列', currentTool: 'describe_table', toolCalls: 3, startedAt: 10_000, status: 'running', output: 'pending' };

describe('subagent progress presentation', () => {
    it('formats one child in the agreed layout, ticking while running and frozen once ended', () => {
        expect(formatSubagentLine(running, 22_500, t)).toBe('subagent：schema（explorer）  工具：describe_table/3  用时：12s  产物：待输出');
        expect(formatSubagentLine({ ...running, currentTool: null, toolCalls: 0 }, 10_000, t)).toContain('工具：—/0  用时：0s');
        expect(formatSubagentLine({ ...running, status: 'completed', output: 'produced', endedAt: 75_000 }, 999_999, t)).toContain('用时：1m05s  产物：已输出');
        expect(formatSubagentLine({ ...running, status: 'timed_out', output: 'none', endedAt: 20_000 }, 30_000, t)).toContain('产物：未输出（超时）');
    });

    it('maps runtime tool progress to a subagent progress chat event', () => {
        const mapped = mapRuntimeEvent({ type: 'agent.tool_progress', toolCallId: 'call-1', toolName: 'subagent', progress: { kind: 'subagent', children: [running] } }, 'message-1');
        expect(mapped?.event).toEqual({ type: 'subagent_progress', message_id: 'message-1', tool_call_id: 'call-1', name: 'subagent', children: [running] });
    });

    it('prefers final progress stored with the outcomes, including after a restore', () => {
        const live: ToolCallState = { toolCallId: 'call-1', name: 'subagent', arguments: {}, status: 'running', subagentChildren: [running] };
        expect(subagentChildrenOf(live)).toEqual([running]);
        const final = { ...running, status: 'completed' as const, output: 'produced' as const, endedAt: 20_000 };
        const done = mergeToolResultState(live, { type: 'tool_result', message_id: 'message-1', tool_call_id: 'call-1', name: 'subagent', content: 'report', details: [{ key: 'schema', status: 'completed', progress: final }] });
        expect(subagentChildrenOf(done)).toEqual([final]);
        const restored: ToolCallState = { toolCallId: 'call-1', name: 'subagent', arguments: {}, status: 'done', details: [{ key: 'schema', status: 'completed', progress: final }] };
        expect(subagentChildrenOf(restored)).toEqual([final]);
        expect(subagentChildrenOf({ ...restored, details: [{ key: 'schema', status: 'completed' }] })).toEqual([]);
        expect(subagentChildrenOf({ ...live, name: 'query_database' })).toEqual([]);
    });

    it('renders one line per child', () => {
        render(<LanguageProvider><SubagentProgressLines progress={[running, { ...running, key: 'values' }]} /></LanguageProvider>);
        expect(screen.getAllByText(/^subagent/)).toHaveLength(2);
    });
});

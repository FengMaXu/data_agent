import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/runtime-client', () => ({
    answerClarificationViaRuntime: vi.fn(),
    clearSessionViaRuntime: vi.fn(),
    getRuntimeClient: vi.fn(() => ({ dispatch: vi.fn() })),
    renameSessionViaRuntime: vi.fn(),
    steerAgentViaRuntime: vi.fn(),
    stopAgentViaRuntime: vi.fn(),
    subscribeRuntimeEvents: vi.fn(() => () => undefined),
}));

import { isAgentMessageEmpty, type AgentMessageLike } from '../../utils/agent-message';

const emptyAgent = (): AgentMessageLike => ({
    content: '',
    transientContent: '',
    reasoningContent: '',
    toolCallsById: {},
    widgetsById: {},
    skillActivations: [],
    terminalReason: null,
});

describe('ChatArea agent message buffering', () => {
    it('recognizes only a completely empty agent message as empty', () => {
        expect(isAgentMessageEmpty(emptyAgent())).toBe(true);

        const updates: Array<Partial<AgentMessageLike>> = [
            { content: 'diagnostic' },
            { reasoningContent: 'thinking' },
            { toolCallsById: { tool: { toolCallId: 'tool', name: 'query', arguments: {}, status: 'done' } } },
            { widgetsById: { widget: { widget_id: 'widget', kind: 'table', title: 'Total' } } },
            { retryNotice: 'retrying' },
            { terminalReason: 'error' },
        ];
        for (const update of updates) {
            expect(isAgentMessageEmpty({ ...emptyAgent(), ...update })).toBe(false);
        }
    });
});

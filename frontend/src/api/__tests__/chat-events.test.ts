import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapRuntimeEvent, sendChatViaRuntime } from '../chat-events';

let runtimeListener: ((event: unknown) => void) | undefined;
const unsubscribe = vi.fn();
const dispatch = vi.fn(async () => ({
    response: { type: 'agent.prompt.accepted', runId: 'run-1' },
}));

vi.mock('../runtime-client', () => ({
    subscribeRuntimeEvents: vi.fn((listener: (event: unknown) => void) => {
        runtimeListener = listener;
        return unsubscribe;
    }),
    getRuntimeClient: vi.fn(() => ({ dispatch })),
}));

describe('Runtime Widget event replay adapter', () => {
    it('maps the lifecycle vocabulary while keeping the active message', () => {
        const common = { messageId: 'message-1', toolCallId: 'call-1', widgetId: 'widget-call-1', toolName: 'show_widget' };
        const types = ['widget', 'widget_patch', 'widget_done', 'widget_remove', 'widget_error'] as const;
        const events = types.map((type) => {
            const event = type === 'widget'
                ? { type, ...common, widget: { widget_id: common.widgetId, kind: 'kpi', title: 'Revenue' } }
                : type === 'widget_patch'
                    ? { type, ...common, patch: { subtitle: 'Today' } }
                    : type === 'widget_error'
                        ? { type, ...common, error: 'failed' }
                        : { type, ...common };
            return mapRuntimeEvent(event, 'message-1')!.event;
        });

        expect(events.map((event) => event.type)).toEqual(types);
        expect(events.every((event) => 'message_id' in event && event.message_id === 'message-1')).toBe(true);
    });

    it('turns a structured tool result into readable legacy fallback text', () => {
        const mapped = mapRuntimeEvent({
            type: 'agent.tool_finished',
            toolCallId: 'call-1',
            toolName: 'show_widget',
            args: {},
            result: {
                content: [{ type: 'text', text: '[widget:kpi] Revenue: 42' }],
                details: { widgetId: 'widget-call-1' },
            },
            isError: false,
        }, 'message-1');

        expect(mapped?.event).toMatchObject({
            type: 'tool_result',
            content: '[widget:kpi] Revenue: 42',
            widget_id: 'widget-call-1',
        });
    });
});

describe('runtime chat event replay', () => {
    beforeEach(() => {
        runtimeListener = undefined;
        unsubscribe.mockReset();
        dispatch.mockClear();
    });

    it('replays message and tool events with session identity and original arguments', async () => {
        const events: unknown[] = [];
        const onFinish = vi.fn();
        const handle = sendChatViaRuntime('show sales', (event) => events.push(event), vi.fn(), onFinish);
        await handle.finished;

        runtimeListener?.({
            sessionId: 'session-1',
            event: { type: 'agent.message_started', messageId: 'message-1' },
        });
        runtimeListener?.({
            sessionId: 'session-1',
            event: { type: 'agent.tool_started', toolCallId: 'tool-1', toolName: 'query_database', args: { sql: 'SELECT 1' } },
        });
        runtimeListener?.({
            sessionId: 'session-1',
            event: { type: 'agent.tool_finished', toolCallId: 'tool-1', toolName: 'query_database', result: [{ value: 1 }], isError: false },
        });

        expect(events).toEqual([
            { type: 'message_start', message_id: 'message-1', session_id: 'session-1' },
            { type: 'tool_call', message_id: 'message-1', tool_call_id: 'tool-1', name: 'query_database', arguments: { sql: 'SELECT 1' }, session_id: 'session-1' },
            { type: 'tool_result', message_id: 'message-1', tool_call_id: 'tool-1', name: 'query_database', arguments: { sql: 'SELECT 1' }, content: '[{"value":1}]', is_error: false, session_id: 'session-1' },
        ]);
    });

    it('keeps replayed error results and follows message ids across turns', async () => {
        const events: unknown[] = [];
        const handle = sendChatViaRuntime('show sales', (event) => events.push(event), vi.fn(), vi.fn());
        await handle.finished;

        runtimeListener?.({
            sessionId: 'session-1',
            event: { type: 'agent.message_started', messageId: 'message-1' },
        });
        runtimeListener?.({
            sessionId: 'session-1',
            event: { type: 'agent.text_delta', delta: 'The first answer' },
        });
        runtimeListener?.({
            sessionId: 'session-1',
            event: { type: 'agent.message_started', messageId: 'message-2' },
        });
        runtimeListener?.({
            sessionId: 'session-1',
            event: { type: 'agent.tool_finished', toolCallId: 'tool-2', toolName: 'query_database', result: 'database unavailable', isError: true },
        });

        expect(events).toEqual([
            { type: 'message_start', message_id: 'message-1', session_id: 'session-1' },
            { type: 'text_delta', message_id: 'message-1', content: 'The first answer', session_id: 'session-1' },
            { type: 'message_start', message_id: 'message-2', session_id: 'session-1' },
            { type: 'tool_result', message_id: 'message-2', tool_call_id: 'tool-2', name: 'query_database', arguments: {}, content: 'database unavailable', is_error: true, session_id: 'session-1' },
        ]);
    });

    it('finishes once when a replay contains duplicate completion events', () => {
        const onFinish = vi.fn();
        sendChatViaRuntime('hello', vi.fn(), vi.fn(), onFinish);
        runtimeListener?.({ event: { type: 'agent.completed' } });
        runtimeListener?.({ event: { type: 'agent.completed' } });
        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});

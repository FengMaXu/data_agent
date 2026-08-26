import type { SSEEvent } from '../api/client';

export interface ToolCallState {
    toolCallId: string;
    name: string;
    arguments: any;
    partialArguments?: string;
    result?: string;
    details?: any;
    isError?: boolean;
    widgetId?: string | null;
    status: 'calling' | 'running' | 'done' | 'error';
    progressText?: string;
}

/** Completion events may omit args (or carry an empty object); in both cases
 * the arguments captured at tool start remain authoritative for the details panel. */
export function mergeToolResultState(
    existing: ToolCallState | undefined,
    event: Extract<SSEEvent, { type: 'tool_result' }>,
): ToolCallState {
    const current = existing ?? {
        toolCallId: event.tool_call_id,
        name: event.name,
        arguments: {},
        status: 'done' as const,
    };
    const completionArgs = event.arguments;
    const hasCompletionArgs = completionArgs !== undefined
        && completionArgs !== null
        && (typeof completionArgs !== 'object'
            || Array.isArray(completionArgs)
            || Object.keys(completionArgs).length > 0);
    return {
        ...current,
        name: event.name,
        arguments: hasCompletionArgs ? completionArgs : current.arguments,
        result: event.content,
        details: event.details,
        isError: event.is_error,
        widgetId: event.widget_id ?? current.widgetId,
        status: event.is_error ? 'error' : 'done',
    };
}

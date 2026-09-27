import { isToolProgress, type SubagentChildProgress } from '@data-agent/contracts';
import type { SSEEvent } from '../api/client';

export interface ToolCallState {
    toolCallId: string;
    name: string;
    arguments: unknown;
    partialArguments?: string;
    result?: string;
    details?: unknown;
    isError?: boolean;
    widgetId?: string | null;
    status: 'calling' | 'running' | 'done' | 'error';
    progressText?: string;
    /** Live per-child progress of a running `subagent` call. */
    subagentChildren?: SubagentChildProgress[];
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

/**
 * Per-child rows of a `subagent` call: the final progress stored with each
 * outcome once the tool finished (also after a restore), otherwise live progress.
 */
export function subagentChildrenOf(tool: ToolCallState): SubagentChildProgress[] {
    if (tool.name !== 'subagent') return [];
    if (Array.isArray(tool.details)) {
        const children = tool.details.flatMap((outcome) => {
            const progress = outcome && typeof outcome === 'object' ? (outcome as { progress?: unknown }).progress : undefined;
            return progress !== undefined && isToolProgress({ kind: 'subagent', children: [progress] }) ? [progress as SubagentChildProgress] : [];
        });
        if (children.length > 0) return children;
    }
    return tool.subagentChildren ?? [];
}

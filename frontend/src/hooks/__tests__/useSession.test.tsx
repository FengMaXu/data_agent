import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { SessionProvider, useSession } from '../useSession';

const runtime = vi.hoisted(() => ({
    createSessionViaRuntime: vi.fn(),
    createTaskWithIdViaRuntime: vi.fn(),
    deleteSessionViaRuntime: vi.fn(),
    deleteTaskViaRuntime: vi.fn(),
    getTranscriptViaRuntime: vi.fn(),
    listSessionsViaRuntime: vi.fn(),
    listTasksViaRuntime: vi.fn(),
    prepareSessionViaRuntime: vi.fn(),
    renameSessionViaRuntime: vi.fn(),
    renameTaskViaRuntime: vi.fn(),
}));

vi.mock('../../api/runtime-client', () => runtime);

const wrapper = ({ children }: { children: ReactNode }) => (
    <LanguageProvider>
        <SessionProvider>{children}</SessionProvider>
    </LanguageProvider>
);

const firstPrompt = {
    id: 'user-1',
    role: 'user' as const,
    content: '## **Quarterly sales**\nreport',
};

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    runtime.listTasksViaRuntime.mockResolvedValue([
        { id: 'task-1', name: 'Sales', createdAt: 0, updatedAt: 0 },
    ]);
    runtime.listSessionsViaRuntime.mockResolvedValue([
        { id: 'session-1', taskId: 'task-1', name: 'New session' },
    ]);
    runtime.getTranscriptViaRuntime.mockResolvedValue([]);
    runtime.prepareSessionViaRuntime.mockResolvedValue(undefined);
    runtime.renameSessionViaRuntime.mockResolvedValue(undefined);
});

describe('SessionProvider automatic session titles', () => {
    it('renames from the first user message once, across later turns', async () => {
        const { result } = renderHook(() => useSession(), { wrapper });
        await waitFor(() => expect(result.current.currentSession?.id).toBe('session-1'));

        act(() => {
            result.current.setCurrentTranscript('session-1', [firstPrompt]);
        });
        await waitFor(() => expect(runtime.renameSessionViaRuntime).toHaveBeenCalledWith(
            'session-1',
            'Quarterly sales report',
        ));

        act(() => {
            result.current.setCurrentTranscript('session-1', [
                firstPrompt,
                { id: 'user-2', role: 'user', content: 'A later question' },
            ]);
        });
        expect(runtime.renameSessionViaRuntime).toHaveBeenCalledTimes(1);
    });

    it('keeps the local title and transcript flow when rename fails', async () => {
        runtime.renameSessionViaRuntime.mockRejectedValueOnce(new Error('metadata unavailable'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { result } = renderHook(() => useSession(), { wrapper });
        await waitFor(() => expect(result.current.currentSession?.id).toBe('session-1'));

        expect(() => act(() => {
            result.current.setCurrentTranscript('session-1', [firstPrompt]);
        })).not.toThrow();
        await waitFor(() => expect(warn).toHaveBeenCalledWith(
            'Failed to rename session:',
            expect.any(Error),
        ));
        expect(result.current.currentSession?.name).toBe('Quarterly sales report');
        expect(result.current.currentTranscript).toEqual([firstPrompt]);
        warn.mockRestore();
    });
});

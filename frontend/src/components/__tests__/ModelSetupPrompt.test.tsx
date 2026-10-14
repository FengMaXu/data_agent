import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelSetupPrompt, isModelNotConfiguredError } from '../ModelSetupPrompt';

describe('isModelNotConfiguredError', () => {
    it('recognizes the runtime code inside an Electron IPC rejection', () => {
        const ipc = new Error("Error invoking remote method 'data-agent:command': Error: LLM_NOT_CONFIGURED: add a model API key in Settings → Model");
        expect(isModelNotConfiguredError(ipc)).toBe(true);
        expect(isModelNotConfiguredError(new Error('LLM_NOT_CONFIGURED'))).toBe(true);
    });

    it('ignores other failures', () => {
        expect(isModelNotConfiguredError(new Error('DataAgent HTTP command failed: 500'))).toBe(false);
        expect(isModelNotConfiguredError(undefined)).toBe(false);
    });
});

describe('ModelSetupPrompt', () => {
    it('sends the user to model settings', () => {
        const onConfigure = vi.fn();
        render(<ModelSetupPrompt onConfigure={onConfigure} />);
        expect(screen.getByText('尚未配置模型')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '立即配置' }));
        expect(onConfigure).toHaveBeenCalledTimes(1);
    });
});

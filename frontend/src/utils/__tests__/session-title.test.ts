import { describe, expect, it } from 'vitest';
import { cleanSessionTitle } from '../session-title';

describe('cleanSessionTitle', () => {
    it('cleans markdown, line breaks, and control characters locally', () => {
        expect(cleanSessionTitle('## **Sales**\n[Q1 report](https://example.test)\u0000')).toBe('Sales Q1 report');
        expect(cleanSessionTitle('North\u2028\u0007\tSouth')).toBe('North South');
        expect(cleanSessionTitle('What is C#?')).toBe('What is C#?');
    });

    it('limits titles by grapheme clusters without splitting emoji', () => {
        const title = cleanSessionTitle('👨‍👩‍👧‍👦'.repeat(31));
        expect(title).toBe('👨‍👩‍👧‍👦'.repeat(30));
        expect(Array.from(title).length).toBeGreaterThan(30);
    });

    it('returns an empty title for markdown-only input', () => {
        expect(cleanSessionTitle('***\n```\u0007')).toBe('');
    });
});

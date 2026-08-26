const MARKDOWN_LINK = /!?(?:\[([^\]]+)\])\([^)]*\)/g;
const MARKDOWN_HTML = /<[^>]*>/g;
const MARKDOWN_INLINE_MARKERS = /[`*_~]/g;
const MARKDOWN_BLOCK_MARKERS = /(^|\s)(?:#{1,6}|>)\s*/gm;

/**
 * Make a short, local session title from the user's first prompt.
 * This intentionally does not invoke a model: titles must be available even
 * when the agent cannot be started.
 */
export function cleanSessionTitle(source: string, maxGraphemes = 30): string {
    const cleaned = source
        .replace(MARKDOWN_LINK, '$1')
        .replace(MARKDOWN_HTML, '')
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
        .replace(MARKDOWN_BLOCK_MARKERS, '$1')
        .replace(MARKDOWN_INLINE_MARKERS, '')
        // Keep words separated when markdown/newline syntax was removed.
        .replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, ' ')
        .replace(/\p{Cc}/gu, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned || maxGraphemes <= 0) return '';
    const normalized = cleaned.normalize('NFC');
    const segmenter = typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : undefined;
    const graphemes = segmenter
        ? Array.from(segmenter.segment(normalized), ({ segment }) => segment)
        : fallbackGraphemes(normalized);
    return graphemes.slice(0, maxGraphemes).join('');
}

/** A small fallback for runtimes without Intl.Segmenter. */
function fallbackGraphemes(value: string): string[] {
    const codePoints = Array.from(value);
    const result: string[] = [];
    for (const codePoint of codePoints) {
        const previous = result[result.length - 1];
        const value = codePoint.codePointAt(0) ?? 0;
        const previousValue = Array.from(previous ?? '').at(-1)?.codePointAt(0) ?? 0;
        const isCombining = /^\p{M}$/u.test(codePoint) || (value >= 0x1f3fb && value <= 0x1f3ff);
        const joinsPrevious = previous?.endsWith('\u200d');
        const isRegionalIndicator = value >= 0x1f1e6 && value <= 0x1f1ff;
        const previousIsRegionalIndicator = previousValue >= 0x1f1e6 && previousValue <= 0x1f1ff;
        if (previous && (isCombining || joinsPrevious || (isRegionalIndicator && previousIsRegionalIndicator))) {
            result[result.length - 1] = `${previous}${codePoint}`;
        } else {
            result.push(codePoint);
        }
    }
    return result;
}

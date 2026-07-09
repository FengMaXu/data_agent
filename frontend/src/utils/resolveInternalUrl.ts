/**
 * Resolve internal API paths (e.g. /workspace/...) to absolute backend URLs.
 *
 * The backend generates relative paths like `/workspace/files/download?path=…`
 * in tool results and Markdown content.  When rendered in the frontend, these
 * paths must point at the backend API server – not the frontend dev-server /
 * Electron renderer – and must carry an auth token so the request passes the
 * authentication middleware.
 *
 * This module is the **single source of truth** for that resolution.
 */

import { API_BASE_URL, getAuthToken } from '../api/client';

/** Prefixes that denote a backend API path rather than an external URL. */
const INTERNAL_PREFIXES = ['/workspace/', '/api/'];
const SESSION_RELATIVE_WORKSPACE_ROOTS = ['data', 'output', 'dashboards'];

/** Check whether `href` is an internal (backend) relative path. */
export function isInternalApiPath(href: string | undefined): href is string {
    return !!href && INTERNAL_PREFIXES.some((p) => href.startsWith(p));
}

/**
 * Resolve an internal relative API path to an absolute URL with auth token.
 *
 * - Already-absolute URLs (`http://…` / `https://…`) are returned as-is.
 * - Internal paths are prefixed with `API_BASE_URL` and get an
 *   `access_token` query parameter appended.
 * - All other hrefs are returned unchanged.
 */
export function resolveInternalUrl(href: string | undefined, currentSessionId?: string): string {
    if (!href) return '';
    if (href.startsWith('http://') || href.startsWith('https://')) return href;

    if (isInternalApiPath(href)) {
        const normalizedHref = normalizeWorkspaceDownloadPath(href, currentSessionId);
        const token = getAuthToken();
        const separator = normalizedHref.includes('?') ? '&' : '?';
        const authSuffix = token
            ? `${separator}access_token=${encodeURIComponent(token)}`
            : '';
        return `${API_BASE_URL}${normalizedHref}${authSuffix}`;
    }

    return href;
}

export function resolveWorkspacePreviewUrl(href: string | undefined, currentSessionId?: string): string {
    if (!href) return '';
    if (!href.startsWith('/workspace/files/download') && !href.startsWith('/workspace/files/preview')) {
        return resolveInternalUrl(href, currentSessionId);
    }

    const normalizedHref = normalizeWorkspaceDownloadPath(href, currentSessionId);
    const previewHref = normalizedHref.replace('/workspace/files/download', '/workspace/files/preview');
    return resolveInternalUrl(previewHref);
}

function normalizeWorkspaceDownloadPath(href: string, currentSessionId?: string): string {
    if (
        !currentSessionId ||
        (!href.startsWith('/workspace/files/download') && !href.startsWith('/workspace/files/preview'))
    ) {
        return href;
    }

    const url = new URL(href, 'http://data-agent.local');
    const path = url.searchParams.get('path') || '';
    const firstSegment = path.split('/')[0] || '';
    if (!path || firstSegment === currentSessionId) {
        return href;
    }
    if (!SESSION_RELATIVE_WORKSPACE_ROOTS.includes(firstSegment)) {
        return href;
    }

    url.searchParams.set('path', `${currentSessionId}/${path}`);
    return `${url.pathname}${url.search}`;
}

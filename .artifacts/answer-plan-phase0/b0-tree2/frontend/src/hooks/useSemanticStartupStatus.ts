import { useCallback, useEffect, useState } from 'react';
import { type SemanticStartupStatus } from '../api/client';
import { getIngestStatusViaRuntime, retryIngestViaRuntime } from '../api/runtime-client';

export function useSemanticStartupStatus(): {
    status: SemanticStartupStatus | null;
    retrying: boolean;
    retry: () => void;
} {
    const [status, setStatus] = useState<SemanticStartupStatus | null>(null);
    const [retrying, setRetrying] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const runtime = await getIngestStatusViaRuntime();
            setStatus({
                status: runtime.status as SemanticStartupStatus['status'],
                jobId: runtime.jobId,
                currentConnectionId: null,
                completedConnections: 0,
                totalConnections: 0,
                summary: runtime.summary,
                failedConnections: [],
                errorCode: runtime.errorCode,
                updatedAt: new Date().toISOString(),
            });
        } catch {
            setStatus((current) => current ?? {
                status: 'failed',
                jobId: null,
                currentConnectionId: null,
                completedConnections: 0,
                totalConnections: 0,
                summary: { updated: 0, unchanged: 0, failed: 0, skipped: 0 },
                failedConnections: [],
                errorCode: 'startup_status_unavailable',
                updatedAt: null,
            });
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (cancelled) return;
            await refresh();
        };
        void load();
        const timer = window.setInterval(() => void load(), 1_000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [refresh]);

    const retry = useCallback(() => {
        if (retrying) return;
        setRetrying(true);
        void retryIngestViaRuntime()
            .then(() => refresh())
            .catch(() => setStatus((current) => current ? { ...current, status: 'failed', errorCode: 'semantic_retry_failed' } : current))
            .finally(() => setRetrying(false));
    }, [retrying]);

    return { status, retrying, retry };
}

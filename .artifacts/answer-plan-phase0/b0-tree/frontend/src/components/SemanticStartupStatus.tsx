import React from 'react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, RefreshCw } from 'lucide-react';
import type { SemanticStartupStatus as SemanticStartupStatusDto } from '../api/client';
import { useLanguage } from '../context/LanguageContext';

export interface SemanticStartupStatusProps {
    status: SemanticStartupStatusDto | null;
    retrying: boolean;
    onRetry: () => void;
}

export const SemanticStartupStatus: React.FC<SemanticStartupStatusProps> = ({ status, retrying, onRetry }) => {
    const { language } = useLanguage();
    if (!status || status.status === 'ready') return null;

    const isBlocked = status.status === 'checking' || status.status === 'ingesting' || status.status === 'failed';
    const isFailure = status.status === 'failed';
    const copy = language === 'zh'
        ? {
            checking: '正在检查语义上下文',
            ingesting: '正在同步语义上下文',
            refreshing: '正在更新语义上下文',
            skipped: '语义上下文尚未配置',
            degraded: '语义上下文部分可用',
            failed: '语义上下文不可用',
            retry: '重试同步',
            waiting: '语义分析将在目录就绪后开放',
            refreshingHint: '正在后台同步，当前查询继续使用最近一次有效目录',
            skippedHint: '配置 ktx.yaml 后，Data Agent 会自动启动 KTX MCP 并同步数据',
            degradedHint: '部分连接不可用，仍可继续使用已就绪目录',
        }
        : {
            checking: 'Checking semantic context',
            ingesting: 'Syncing semantic context',
            refreshing: 'Refreshing semantic context',
            skipped: 'Semantic context is not configured',
            degraded: 'Semantic context partially available',
            failed: 'Semantic context unavailable',
            retry: 'Retry sync',
            waiting: 'Semantic analysis will unlock when the catalog is ready',
            refreshingHint: 'Sync is running in the background; queries continue on the last valid catalog',
            skippedHint: 'Configure ktx.yaml and Data Agent will start the KTX MCP and sync the sources',
            degradedHint: 'Some connections are unavailable; the last valid catalog remains usable',
        };
    const title = copy[status.status];
    const progress = status.totalConnections > 0
        ? `${status.completedConnections}/${status.totalConnections}`
        : '';
    const connection = status.currentConnectionId ? ` · ${status.currentConnectionId}` : '';
    const summary = language === 'zh'
        ? `更新 ${status.summary.updated} · 未变更 ${status.summary.unchanged} · 失败 ${status.summary.failed} · 跳过 ${status.summary.skipped}`
        : `Updated ${status.summary.updated} · Unchanged ${status.summary.unchanged} · Failed ${status.summary.failed} · Skipped ${status.summary.skipped}`;

    return (
        <div className={`semantic-startup-strip ${isFailure ? 'is-error' : status.status === 'degraded' ? 'is-degraded' : status.status === 'skipped' ? 'is-skipped' : ''}`} role="status">
            <div className="semantic-startup-main">
                {isFailure ? <CircleAlert size={17} aria-hidden="true" /> : status.status === 'degraded' ? <CircleCheck size={17} aria-hidden="true" /> : status.status === 'skipped' ? <Info size={17} aria-hidden="true" /> : <LoaderCircle size={17} className="semantic-startup-spinner" aria-hidden="true" />}
                <strong>{title}</strong>
                {progress && <span>{progress}{connection}</span>}
                <span className="semantic-startup-summary">{summary}</span>
                {isBlocked && !isFailure && <span className="semantic-startup-hint">{copy.waiting}</span>}
                {status.status === 'refreshing' && <span className="semantic-startup-hint">{copy.refreshingHint}</span>}
                {status.status === 'skipped' && <span className="semantic-startup-hint">{copy.skippedHint}</span>}
                {status.status === 'degraded' && <span className="semantic-startup-hint">{copy.degradedHint}</span>}
                {status.failedConnections.length > 0 && <span className="semantic-startup-failures">{status.failedConnections.join(', ')}</span>}
            </div>
            {(isFailure || status.status === 'degraded') && (
                <button type="button" className="semantic-startup-retry" onClick={onRetry} disabled={retrying} title={copy.retry}>
                    <RefreshCw size={15} className={retrying ? 'semantic-startup-spinner' : undefined} aria-hidden="true" />
                    <span>{retrying ? (language === 'zh' ? '重试中...' : 'Retrying...') : copy.retry}</span>
                </button>
            )}
        </div>
    );
};

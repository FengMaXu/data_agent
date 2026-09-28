import React, { useEffect, useState } from 'react';
import type { SubagentChildProgress } from '@data-agent/contracts';
import { useLanguage } from '../context/LanguageContext';
import { formatSubagentLine } from './subagent-progress';

/** One line per delegated child under the `subagent` tool hint; running rows tick every second. */
const SubagentProgressLines: React.FC<{ progress: SubagentChildProgress[] }> = ({ progress }) => {
    const { t } = useLanguage();
    const [now, setNow] = useState(() => Date.now());
    const running = progress.some((child) => child.endedAt === undefined);

    useEffect(() => {
        if (!running) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [running]);

    if (progress.length === 0) return null;
    return (
        <>
            {progress.map((child) => {
                const line = formatSubagentLine(child, now, t);
                return (
                    <div
                        key={child.key}
                        className={`agent-hint-line agent-hint-subline ${child.output === 'none' ? 'is-error' : ''}`}
                        title={line}
                    >
                        <span className="agent-hint-dot" aria-hidden="true" />
                        <span className="agent-hint-subline-text">{line}</span>
                    </div>
                );
            })}
        </>
    );
};

export default SubagentProgressLines;

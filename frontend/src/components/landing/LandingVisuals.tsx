import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { BrandMark, BrandWordmark } from '../Brand';

export function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(() =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false,
    );
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => setReduced(query.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);
    return reduced;
}

export function useInView<T extends HTMLElement>(threshold = 0.3): [React.RefObject<T | null>, boolean] {
    const ref = useRef<T>(null);
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const node = ref.current;
        if (!node) return;
        if (typeof IntersectionObserver === 'undefined') {
            setInView(true);
            return;
        }
        const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
        observer.observe(node);
        return () => observer.disconnect();
    }, [threshold]);
    return [ref, inView];
}

const delay = (i: number) => ({ '--i': i } as React.CSSProperties);

export const BrowserFrame: React.FC<{ url: string; children: React.ReactNode; className?: string }> = ({ url, children, className = '' }) => (
    <div className={`lp-frame ${className}`}>
        <div className="lp-frame-bar" aria-hidden="true">
            <span className="lp-frame-dots"><i /><i /><i /></span>
            <span className="lp-frame-url">{url}</span>
        </div>
        <div className="lp-frame-view">{children}</div>
    </div>
);

/* ---------- Capability visuals (light stage) ---------- */

const CapQuery: React.FC = () => {
    const { t } = useLanguage();
    return (
        <div className="lp-cap-query">
            <div className="lp-cap-ask" style={delay(0)}>{t('landing.cap.query.prompt')}</div>
            <pre className="lp-cap-sql" style={delay(1)}><code>{`SELECT region, SUM(paid_amount) AS sales
FROM orders
WHERE paid_at >= '2026-09-01'
GROUP BY region
ORDER BY sales DESC;`}</code></pre>
            <table className="lp-cap-table" style={delay(2)}>
                <thead><tr><th>region</th><th>sales</th></tr></thead>
                <tbody>
                    <tr><td>East</td><td>4,812,400</td></tr>
                    <tr><td>South</td><td>3,105,880</td></tr>
                    <tr><td>North</td><td>2,476,150</td></tr>
                </tbody>
            </table>
        </div>
    );
};

const CapExport: React.FC = () => (
    <div className="lp-cap-file" style={delay(0)}>
        <div className="lp-cap-file-head"><b>CSV</b><span>orders_2026_09.csv</span><em>12,408 rows</em></div>
        <pre><code>{`order_id,region,channel,paid_amount,paid_at
A10293,East,app,328.00,2026-09-01
A10294,South,web,129.50,2026-09-01
A10295,East,store,88.00,2026-09-01
A10296,North,app,452.90,2026-09-02
A10297,East,web,61.20,2026-09-02
…`}</code></pre>
    </div>
);

const CapReport: React.FC = () => {
    const { t } = useLanguage();
    return (
        <div className="lp-cap-doc" style={delay(0)}>
            <div className="lp-cap-file-head"><b>MD</b><span>east_q3_review.md</span></div>
            <div className="lp-doc">
                <h4>{t('landing.cap.report.docTitle')}</h4>
                <h5>{t('landing.cap.report.summary')}</h5>
                <p>{t('landing.cap.report.summaryText')}</p>
                <h5>{t('landing.cap.report.findings')}</h5>
                <ul>
                    <li>{t('landing.cap.report.f1')}</li>
                    <li>{t('landing.cap.report.f2')}</li>
                </ul>
                <div className="lp-doc-chart">
                    {[46, 70, 58, 84, 66, 100].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
                </div>
            </div>
        </div>
    );
};

const CapDashboard: React.FC = () => {
    const { t } = useLanguage();
    return (
        <div className="lp-gallery">
            <BrowserFrame url="dashboards / delivery_center_overview.html" className="lp-gallery-frame">
                <div className="lp-pan">
                    <img src="/landing/dashboard-delivery.webp" width={2880} height={2949} alt={t('landing.dash.delivery.alt')} loading="lazy" />
                </div>
            </BrowserFrame>
            <div className="lp-gallery-foot">
                <strong>{t('landing.dash.delivery.name')}</strong>
                <span>{t('landing.dash.delivery.note')}</span>
            </div>
        </div>
    );
};

export const CAPABILITY_VISUALS: Record<string, React.FC> = {
    query: CapQuery,
    export: CapExport,
    report: CapReport,
    dashboard: CapDashboard,
};

const GUARD_LINES = [
    { sql: 'DROP TABLE orders;', ok: false },
    { sql: 'UPDATE users SET role = \'admin\';', ok: false },
    { sql: 'SELECT region, SUM(amount) FROM sales GROUP BY region;', ok: true },
];

export const GuardTerminal: React.FC = () => {
    const { t } = useLanguage();
    return (
        <div className="lp-guard" aria-hidden="true">
            {GUARD_LINES.map(({ sql, ok }, i) => (
                <div key={sql} className={`lp-guard-line ${ok ? 'is-ok' : 'is-no'}`} data-reveal style={delay(i)}>
                    <code><span>sql›</span> {sql}</code>
                    <b>{ok ? t('landing.guard.allowed') : t('landing.guard.blocked')}</b>
                </div>
            ))}
        </div>
    );
};

/* ---------- Devices ---------- */

export const DeviceSync: React.FC = () => {
    const { t } = useLanguage();
    return (
        <div className="lp-sync" aria-label={t('landing.where.sync')}>
            {['desktop', 'web', 'mobile'].map((key, index) => (
                <React.Fragment key={key}>
                    {index > 0 && <span className="lp-sync-link" aria-hidden="true"><i /></span>}
                    <span className="lp-sync-node">{t(`landing.where.${key}`)}</span>
                </React.Fragment>
            ))}
        </div>
    );
};

/* ---------- Phone ---------- */

const MiniBars: React.FC = () => (
    <span className="lp-minibars" aria-hidden="true">
        {[46, 70, 58, 84, 66, 100].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
    </span>
);

type PhoneMessage = { from: 'user' | 'bot'; key?: string; kind?: 'chart' | 'file' };

const PHONE_SCRIPT: PhoneMessage[] = [
    { from: 'user', key: 'landing.phone.q1' },
    { from: 'bot', key: 'landing.phone.a1' },
    { from: 'bot', kind: 'chart' },
    { from: 'bot', kind: 'file' },
    { from: 'user', key: 'landing.phone.q2' },
    { from: 'bot', key: 'landing.phone.a2' },
];

/** A phone conversation with yourDB, played message by message. */
export const PhoneDemo: React.FC = () => {
    const { t } = useLanguage();
    const reduced = usePrefersReducedMotion();
    const [ref, inView] = useInView<HTMLDivElement>(0.3);
    const [shown, setShown] = useState(1);

    useEffect(() => {
        if (reduced || !inView) return;
        const done = shown >= PHONE_SCRIPT.length;
        const timer = window.setTimeout(
            () => setShown(done ? 1 : shown + 1),
            done ? 4200 : PHONE_SCRIPT[shown].from === 'user' ? 1500 : 1100,
        );
        return () => window.clearTimeout(timer);
    }, [shown, reduced, inView]);

    const visible = reduced ? PHONE_SCRIPT.length : shown;
    const typing = !reduced && shown < PHONE_SCRIPT.length && PHONE_SCRIPT[shown].from === 'bot';

    return (
        <div ref={ref} className="lp-phone" role="img" aria-label={t('landing.phone.label')}>
            <div className="lp-phone-screen">
                <div className="lp-phone-head">
                    <span className="lp-phone-avatar"><BrandMark /></span>
                    <div>
                        <strong><BrandWordmark title="yourDB" /></strong>
                        <small>{t('landing.phone.status')}</small>
                    </div>
                </div>
                <div className="lp-phone-chat" aria-hidden="true">
                    {PHONE_SCRIPT.slice(0, visible).map((msg, i) => {
                        if (msg.kind === 'chart') {
                            return (
                                <div key={i} className="lp-bubble is-card">
                                    <span className="lp-card-title">{t('landing.phone.chartTitle')}</span>
                                    <MiniBars />
                                </div>
                            );
                        }
                        if (msg.kind === 'file') {
                            return (
                                <div key={i} className="lp-bubble is-file">
                                    <b>HTML</b>
                                    <span>east_weekly_sales.html</span>
                                </div>
                            );
                        }
                        return (
                            <div key={i} className={`lp-bubble ${msg.from === 'user' ? 'is-user' : ''}`}>
                                {t(msg.key ?? '')}
                            </div>
                        );
                    })}
                    {typing && <div className="lp-bubble lp-typing"><i /><i /><i /></div>}
                </div>
                <div className="lp-phone-input" aria-hidden="true">
                    <span>{t('landing.phone.input')}</span>
                </div>
            </div>
        </div>
    );
};

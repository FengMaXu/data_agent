import React from 'react';
import { WORDMARK_PATH } from '../Brand';
import { useLanguage } from '../../context/LanguageContext';

/** Rough text width for laying out SVG chips: CJK glyphs are about one em, others about 0.6 em. */
function textWidth(text: string, size: number): number {
    let width = 0;
    for (const char of text) width += char.charCodeAt(0) > 0x2e80 ? size : size * 0.6;
    return width;
}

const Chips: React.FC<{ items: readonly string[]; x: number; y: number; maxWidth: number; size?: number; align?: 'start' | 'center' }> = ({
    items,
    x,
    y,
    maxWidth,
    size = 11.5,
    align = 'start',
}) => {
    const pad = 10;
    const gap = 8;
    const height = size + 13;
    const rows: { text: string; w: number }[][] = [[]];
    let rowWidth = 0;
    for (const text of items) {
        const w = textWidth(text, size) + pad * 2;
        if (rowWidth > 0 && rowWidth + gap + w > maxWidth) {
            rows.push([]);
            rowWidth = 0;
        }
        rows[rows.length - 1].push({ text, w });
        rowWidth += (rowWidth > 0 ? gap : 0) + w;
    }
    return (
        <g className="lp-dg-chips">
            {rows.map((row, r) => {
                const total = row.reduce((sum, chip) => sum + chip.w, 0) + gap * (row.length - 1);
                let cx = align === 'center' ? x - total / 2 : x;
                return row.map((chip) => {
                    const left = cx;
                    cx += chip.w + gap;
                    const top = y + r * (height + 8);
                    return (
                        <g key={`${r}-${chip.text}`}>
                            <rect x={left} y={top} width={chip.w} height={height} rx={height / 2} />
                            <text x={left + chip.w / 2} y={top + height / 2 + size * 0.36} textAnchor="middle" style={{ fontSize: size }}>
                                {chip.text}
                            </text>
                        </g>
                    );
                });
            })}
        </g>
    );
};

const Card: React.FC<{
    x: number;
    y: number;
    w: number;
    h: number;
    title: string;
    lines: readonly string[];
    mono?: readonly number[];
}> = ({ x, y, w, h, title, lines, mono = [] }) => {
    const cx = x + w / 2;
    const top = y + h / 2 - (lines.length * 22) / 2 + 4;
    return (
        <g className="lp-dg-card">
            <rect x={x} y={y} width={w} height={h} rx={12} />
            <text className="lp-dg-card-title" x={cx} y={top}>{title}</text>
            {lines.map((line, i) => (
                <text key={line} className={`lp-dg-card-line ${mono.includes(i) ? 'is-mono' : ''}`} x={cx} y={top + 24 + i * 21}>
                    {line}
                </text>
            ))}
        </g>
    );
};

const Grid: React.FC<{ id: string; w: number; h: number }> = ({ id, w, h }) => (
    <>
        <defs>
            <pattern id={`${id}-grid`} width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M32 0H0V32" className="lp-dg-gridline" />
            </pattern>
            <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" className="lp-dg-arrowhead" />
            </marker>
        </defs>
        <rect className="lp-dg-panel" x="1" y="1" width={w - 2} height={h - 2} rx="20" />
        <rect x="1" y="1" width={w - 2} height={h - 2} rx="20" fill={`url(#${id}-grid)`} />
    </>
);

/** The wordmark, right-aligned so its baseline sits at (x, y). */
const Brand: React.FC<{ x: number; y: number }> = ({ x, y }) => {
    const height = 30;
    const scale = height / 674;
    return (
        <g className="lp-dg-brand" aria-label="yourDB">
            <path
                transform={`translate(${x - 2300 * scale} ${y - 0.758 * height}) scale(${scale})`}
                fillRule="evenodd"
                d={WORDMARK_PATH}
            />
        </g>
    );
};

/** System architecture, as wired in apps/server, packages/electron-host and packages/runtime. */
export const ArchitectureDiagram: React.FC = () => {
    const { t } = useLanguage();
    const id = 'lp-arch';
    const arrow = `url(#${id}-arrow)`;
    const W = 1200;
    const H = 720;

    return (
        <figure className="lp-dg" data-reveal>
            <div className="lp-dg-scroll">
                <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
                    <title id={`${id}-title`}>{t('landing.arch.title')}</title>
                    <desc id={`${id}-desc`}>{t('landing.arch.desc')}</desc>
                    <Grid id={id} w={W} h={H} />
                    <text className="lp-dg-title" x="48" y="66">{t('landing.arch.title')}</text>
                    <Brand x={1152} y={66} />

                    {/* Entry points */}
                    <text className="lp-dg-note" x="48" y="226">{t('landing.arch.entry')}</text>
                    {['desktop', 'web', 'mobile'].map((key, i) => (
                        <g key={key} className="lp-dg-pill">
                            <rect x="40" y={244 + i * 58} width="200" height="46" rx="23" />
                            <text x="140" y={273 + i * 58} textAnchor="middle">{t(`landing.arch.entry.${key}`)}</text>
                        </g>
                    ))}
                    <path className="lp-dg-edge" d="M240 267H262M240 325H262M240 383H262M262 267V383" />
                    <path className="lp-dg-edge" d="M262 325H288" markerEnd={arrow} />

                    <Card x={290} y={270} w={170} h={110} title="HOST" lines={['Fastify · Electron', t('landing.arch.host')]} />
                    <path className="lp-dg-edge is-flow" d="M460 325H508" markerEnd={arrow} />

                    {/* Context, loaded on demand */}
                    <rect className="lp-dg-group" x="440" y="96" width="400" height="132" rx="18" />
                    <Card x={456} y={112} w={180} h={100} title="KNOWLEDGE" lines={['knowledge/doc', t('landing.arch.knowledge')]} mono={[0]} />
                    <Card x={648} y={112} w={176} h={100} title="SKILLS · PROMPT" lines={['.agents/skills', '.pi/SYSTEM.md']} mono={[0, 1]} />
                    <path className="lp-dg-edge" d="M640 228V273" markerEnd={arrow} />
                    <text className="lp-dg-note" x="652" y="256">{t('landing.arch.onDemand')}</text>

                    {/* Runtime */}
                    <Card x={510} y={275} w={260} h={100} title="DATA AGENT RUNTIME" lines={[t('landing.arch.runtime')]} />

                    {/* Model */}
                    <Card x={900} y={246} w={240} h={86} title="MODEL" lines={[t('landing.arch.model')]} />
                    <path className="lp-dg-edge is-flow" d="M770 280H898" markerEnd={arrow} />
                    <path className="lp-dg-edge" d="M900 304H772" markerEnd={arrow} />
                    <text className="lp-dg-note" x="835" y="270" textAnchor="middle">{t('landing.arch.reason')}</text>

                    {/* Answering */}
                    <path className="lp-dg-edge" d="M640 377V408" markerStart={arrow} markerEnd={arrow} />
                    <Card x={510} y={410} w={260} h={86} title="ANSWERING" lines={[t('landing.arch.answering')]} />

                    {/* Jev */}
                    <Card x={900} y={372} w={240} h={86} title="JEV" lines={[t('landing.arch.jev')]} />
                    <path className="lp-dg-edge is-dashed" d="M770 432H835V415H898" markerEnd={arrow} />
                    <text className="lp-dg-note" x="780" y="424">{t('landing.arch.advice')}</text>

                    {/* Workspace */}
                    <Card x={900} y={556} w={240} h={108} title="WORKSPACE" lines={['CSV · Markdown · HTML', 'SVG + .chart.json']} mono={[1]} />
                    <path className="lp-dg-edge is-flow" d="M770 476H860V610H898" markerEnd={arrow} />
                    <text className="lp-dg-note" x="780" y="468">{t('landing.arch.publish')}</text>

                    {/* Data access */}
                    <rect className="lp-dg-group" x="440" y="540" width="400" height="140" rx="18" />
                    <Card x={456} y={556} w={180} h={108} title="MCP SERVER" lines={['mcp-mysql · mcp-pg', t('landing.arch.mcp')]} mono={[0]} />
                    <Card x={648} y={556} w={176} h={108} title="DATABASE" lines={['MySQL · PostgreSQL', 'SQLite']} />
                    <path className="lp-dg-edge is-flow" d="M560 496V554" markerEnd={arrow} />
                    <text className="lp-dg-note" x="572" y="524">{t('landing.arch.viaMcp')}</text>
                    <path className="lp-dg-edge" d="M636 610H646" markerEnd={arrow} />

                </svg>
            </div>
        </figure>
    );
};

/** How one answer reaches the user, as enforced in packages/runtime/src/answering. */
export const AnswerFlowDiagram: React.FC = () => {
    const { t } = useLanguage();
    const id = 'lp-flowdg';
    const arrow = `url(#${id}-arrow)`;
    const W = 1200;
    const H = 660;

    return (
        <figure className="lp-dg" data-reveal>
            <div className="lp-dg-scroll">
                <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
                    <title id={`${id}-title`}>{t('landing.flowdg.title')}</title>
                    <desc id={`${id}-desc`}>{t('landing.flowdg.desc')}</desc>
                    <Grid id={id} w={W} h={H} />
                    <text className="lp-dg-title" x="48" y="66">{t('landing.flowdg.title')}</text>
                    <Brand x={1152} y={66} />

                    {/* Start */}
                    <g className="lp-dg-card">
                        <rect x="430" y="100" width="340" height="60" rx="12" />
                        <circle className="lp-dg-dot" cx="462" cy="130" r="6" />
                        <text className="lp-dg-start" x="480" y="136">{t('landing.flowdg.start')}</text>
                    </g>
                    <path className="lp-dg-edge" d="M600 160V190M340 190H860" />
                    <path className="lp-dg-edge" d="M340 190V218" markerEnd={arrow} />
                    <path className="lp-dg-edge" d="M860 190V218" markerEnd={arrow} />

                    {/* Outer loop */}
                    <g className="lp-dg-card">
                        <rect x="120" y="220" width="440" height="160" rx="14" />
                        <text className="lp-dg-h" x="148" y="262">{t('landing.flowdg.outer')}</text>
                        <text className="lp-dg-sub" x="148" y="288">{t('landing.flowdg.outerDesc')}</text>
                    </g>
                    <Chips x={148} y={306} maxWidth={384} items={['set_answer_spec', t('landing.flowdg.evidence'), 'compare_hypotheses · Jev', 'ask_user_clarification']} />

                    {/* Inner loop */}
                    <g className="lp-dg-card">
                        <rect x="640" y="220" width="440" height="160" rx="14" />
                        <text className="lp-dg-h" x="668" y="262">{t('landing.flowdg.inner')}</text>
                        <text className="lp-dg-sub" x="668" y="288">{t('landing.flowdg.innerDesc')}</text>
                    </g>
                    <Chips x={668} y={306} maxWidth={384} items={['query_database', t('landing.flowdg.probe'), t('landing.flowdg.fingerprint')]} />

                    <path className="lp-dg-edge is-dashed" d="M560 300H638" markerStart={arrow} markerEnd={arrow} />

                    <text className="lp-dg-mid" x="600" y="428" textAnchor="middle">
                        <tspan className="is-muted">{t('landing.flowdg.midA')}</tspan>
                        <tspan>{t('landing.flowdg.midB')}</tspan>
                    </text>

                    <path className="lp-dg-edge" d="M340 380V466" markerEnd={arrow} />
                    <path className="lp-dg-edge" d="M860 380V466" markerEnd={arrow} />

                    {/* Gate */}
                    <g className="lp-dg-card">
                        <rect x="200" y="468" width="800" height="66" rx="12" />
                        <text className="lp-dg-gate" x="600" y="508" textAnchor="middle">⟳  {t('landing.flowdg.gate')}</text>
                    </g>
                    <Chips x={600} y={556} maxWidth={760} align="center" items={['sealForResult', 'result_shape', 'result_completeness', 'result_identity', 'fanout', 'DECISION_NOT_REALIZED']} />
                    <text className="lp-dg-out" x="600" y="624" textAnchor="middle">{t('landing.flowdg.out')}</text>

                    {/* Feedback */}
                    <path className="lp-dg-edge is-feedback" d="M1000 501H1130V130H774" markerEnd={arrow} />
                    <g className="lp-dg-badge">
                        <rect x="1012" y="488" width="104" height="26" rx="6" />
                        <text x="1064" y="505" textAnchor="middle">{t('landing.flowdg.retry')}</text>
                    </g>
                </svg>
            </div>
        </figure>
    );
};

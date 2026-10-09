import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AgentOrbitIcon from '../AgentOrbitIcon';
import { BrandWordmark } from '../Brand';
import { ExternalLink } from '../icons/Typicons';
import {
    RiArrowDown,
    RiArrowRightS,
    RiBookShelf,
    RiBrain4,
    RiChat3,
    RiClose,
    RiEyeLine,
    RiFolder3,
    RiInfoCard,
    RiLayoutLeft2,
    RiLinkM,
    RiListCheck3,
    RiLogoutBox,
    RiPuzzle2,
    RiSendPlane,
    RiSettings4,
    RiTaskLine,
    RiTranslate,
    RiUser3,
} from '../icons/RemixIcons';
import { useLanguage } from '../../context/LanguageContext';
import { BrowserFrame, useInView, usePrefersReducedMotion } from './LandingVisuals';
import './heroDemo.css';

/*
 * A scripted replay of a real yourDB session (delivery_center, 2026-10-02), condensed to ~30s.
 * Everything on the stage is derived from one clock, so chapters can seek and the loop is deterministic.
 */

const STAGE_W = 1280;
const STAGE_H = 800;
const DURATION = 32000;
/** Frame shown when motion is reduced: the finished dashboard. */
const POSTER_TIME = 23600;

const T = {
    newTask: 1500,
    typeStart: 2900,
    typeEnd: 6000,
    send: 6700,
    m1: 7200,
    m1Text: 8200,
    m1Skill: 8500,
    m1Read: 8800,
    sub: 9200,
    subDone: 11000,
    m2: 11500,
    spec: 12900,
    q1: 13300,
    q2: 13650,
    q3: 14000,
    pub: 14350,
    panel: 15100,
    m3: 17000,
    dashSkill: 17300,
    gen: 17700,
    genDone: 18700,
    done: 19000,
    eye: 20300,
} as const;

const MODAL_AT = T.eye + 150;

const CHAPTERS = [
    { key: 'new', at: 0 },
    { key: 'ask', at: 2100 },
    { key: 'explore', at: T.m1 },
    { key: 'query', at: T.m2 },
    { key: 'dashboard', at: T.m3 },
] as const;

type Target = 'newTask' | 'input' | 'send' | 'queryHint' | 'eye';
type Point = { x: number; y: number };

const MOVES: { at: number; dur: number; to: Target | Point }[] = [
    { at: 0, dur: 0, to: { x: 720, y: 470 } },
    { at: 450, dur: 900, to: 'newTask' },
    { at: 2000, dur: 750, to: 'input' },
    { at: T.send - 520, dur: 450, to: 'send' },
    { at: T.panel - 750, dur: 650, to: 'queryHint' },
    { at: T.eye - 800, dur: 700, to: 'eye' },
];
const CLICKS = [T.newTask, T.send, T.panel, T.eye];
const TARGETS: Target[] = ['newTask', 'input', 'send', 'queryHint', 'eye'];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (v: number) => 1 - (1 - v) ** 3;
const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2);
const span = (time: number, start: number, dur: number) => clamp01((time - start) / dur);
const typed = (text: string, time: number, start: number, end: number) =>
    text.slice(0, Math.round(text.length * span(time, start, end - start)));
const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

/** Advances a looping clock with requestAnimationFrame while `playing`. */
function useTimeline(playing: boolean): [number, (ms: number) => void] {
    const [time, setTime] = useState(0);
    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            const dt = Math.min(100, now - last);
            last = now;
            setTime((prev) => (prev + dt) % DURATION);
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [playing]);
    return [time, setTime];
}

/* ---------- Dashboard (the generated delivery_center_overview.html) ---------- */

const DIST = [
    { label: '0-1 km', value: 74639, share: '19.7%' },
    { label: '1-3 km', value: 185292, share: '48.9%', hot: true },
    { label: '3-5 km', value: 76153, share: '20.1%' },
    { label: '5-10 km', value: 30566, share: '8.1%' },
    { label: '>10 km', value: 12120, share: '3.2%' },
];

const PAY = [
    ['ONLINE', 77.93], ['VOUCHER', 12.12], ['DEBIT', 3.1], ['MEAL_BENEFIT', 1.7], ['STORE_DIRECT_PA…', 1.6],
    ['CREDIT', 1.2], ['DEBIT_STORE', 0.5], ['VOUCHER_STORE', 0.4], ['PAYMENT_LINK', 0.4], ['CREDIT_STORE', 0.3], ['MONEY', 0.3],
] as const;

/** The real preview renders HTML at a 1440px base width and scales it to the modal body. */
const DASH_W = 1440;
const DASH_SCROLL = { at: 4600, dur: 2800 };

const DemoDashboard: React.FC<{ time: number; scale: number; viewH: number }> = ({ time, scale, viewH }) => {
    const { t } = useLanguage();
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => setHeight(ref.current?.offsetHeight ?? 0), []);

    const grow = (start: number, dur = 1100) => easeOut(span(time, start, dur));
    const count = (target: number, start: number) => target * grow(start, 1300);
    const scroll = Math.max(0, height * scale - viewH) * easeInOut(span(time, DASH_SCROLL.at, DASH_SCROLL.dur));
    const donut = grow(1200, 1400);
    const C = 2 * Math.PI * 70;
    const arcs = [
        { share: 98.03, start: 0, color: 'var(--hd-slate)' },
        { share: 1.91, start: 98.03, color: 'var(--hd-orange)' },
        { share: 0.06, start: 99.94, color: 'var(--hd-green)' },
    ];

    return (
        <div className="hd-dash" ref={ref} style={{ width: DASH_W, transform: `translateY(${-scroll / scale}px)` }}>
            <div className="hd-dash-head">
                <div>
                    <h3>{t('landing.demo.dash.title')}</h3>
                    <div className="hd-chips">
                        <span>{t('landing.demo.dash.chip1')}</span>
                        <span>{t('landing.demo.dash.chip2')}</span>
                        <span>{t('landing.demo.dash.chip3')}</span>
                    </div>
                </div>
                <small>{t('landing.demo.dash.asof')}</small>
            </div>

            <section className="hd-card hd-findings">
                <h4>{t('landing.demo.dash.summary')}</h4>
                {[
                    { value: 98.03, key: 'f1', tone: 'is-good' },
                    { value: 48.92, key: 'f2', tone: '' },
                    { value: 77.93, key: 'f3', tone: '' },
                ].map((row, i) => (
                    <div key={row.key} className="hd-finding" style={{ opacity: grow(200 + i * 180, 500) }}>
                        <b className={row.tone}>{(row.value * grow(200 + i * 180, 1300)).toFixed(1)}%</b>
                        <span>{row.value.toFixed(2)}% {t(`landing.demo.dash.${row.key}`)}</span>
                    </div>
                ))}
            </section>

            <span className="hd-dash-label">{t('landing.demo.dash.status')}</span>
            <div className="hd-kpis">
                {[
                    { key: 'delivered', value: 371367, share: '+98.0%' },
                    { key: 'cancelled', value: 7253, share: '+1.9%' },
                    { key: 'delivering', value: 223, share: '+0.1%' },
                ].map((kpi, i) => (
                    <section key={kpi.key} className="hd-card hd-kpi" style={{ opacity: grow(600 + i * 120, 500) }}>
                        <span>{t(`landing.demo.dash.${kpi.key}`)}</span>
                        <strong>{fmt(count(kpi.value, 600 + i * 120))}<small>{t('landing.demo.dash.unit')}</small></strong>
                        <em>{t('landing.demo.dash.share')} ▲ {kpi.share}</em>
                    </section>
                ))}
            </div>

            <div className="hd-row">
                <section className="hd-card hd-chart">
                    <h5>{t('landing.demo.dash.distTitle')}</h5>
                    <p>{t('landing.demo.dash.distSub')}</p>
                    <div className="hd-vbars">
                        {[210, 180, 150, 120, 90, 60, 30, 0].map((tick) => (
                            <i key={tick} className="hd-grid" style={{ bottom: `${(tick / 210) * 100}%` }}><span>{tick ? `${tick},000` : 0}</span></i>
                        ))}
                        {DIST.map((bar, i) => {
                            const k = grow(1000 + i * 110);
                            return (
                                <div key={bar.label} className="hd-vbar">
                                    <div className="hd-vbar-track">
                                        <em style={{ opacity: k }}>{bar.share}</em>
                                        <i className={bar.hot ? 'is-hot' : ''} style={{ height: `${(bar.value / 210000) * 100 * k}%` }} />
                                    </div>
                                    <span>{bar.label}</span>
                                </div>
                            );
                        })}
                    </div>
                </section>
                <section className="hd-card hd-chart">
                    <h5>{t('landing.demo.dash.donutTitle')}</h5>
                    <p>{t('landing.demo.dash.donutSub')}</p>
                    <svg className="hd-donut" viewBox="0 0 220 220" aria-hidden="true">
                        {arcs.map((arc) => (
                            <circle
                                key={arc.color}
                                cx="110" cy="110" r="70"
                                fill="none" stroke={arc.color} strokeWidth="36"
                                strokeDasharray={`${(arc.share / 100) * C * donut} ${C}`}
                                strokeDashoffset={-(arc.start / 100) * C * donut}
                                transform="rotate(-90 110 110)"
                            />
                        ))}
                    </svg>
                    <div className="hd-legend">
                        <span><i style={{ background: 'var(--hd-slate)' }} />DELIVERED</span>
                        <span><i style={{ background: 'var(--hd-orange)' }} />CANCELLED</span>
                        <span><i style={{ background: 'var(--hd-green)' }} />DELIVERING</span>
                    </div>
                </section>
            </div>

            <section className="hd-card hd-chart hd-pay">
                <h5>{t('landing.demo.dash.payTitle')}</h5>
                <p>{t('landing.demo.dash.paySub')}</p>
                <div className="hd-hbars">
                    {PAY.map(([label, share], i) => {
                        const k = grow(DASH_SCROLL.at + 900 + i * 70, 1200);
                        return (
                            <div key={label} className="hd-hbar">
                                <span>{label}</span>
                                <div>
                                    <i className={i === 0 ? 'is-hot' : ''} style={{ width: `${((share * 4008.34) / 350000) * 100 * k}%` }} />
                                    <em style={{ opacity: k }}>{share.toFixed(1)}%</em>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
};

/* ---------- App replay ---------- */

const Hint: React.FC<{ label: string; sub?: boolean; innerRef?: React.Ref<HTMLDivElement> }> = ({ label, sub, innerRef }) => (
    <div ref={innerRef} className={`hd-hint ${sub ? 'is-sub' : ''}`}>
        <i aria-hidden="true" />
        <span>{label}</span>
    </div>
);

const AgentTurn: React.FC<{ running: boolean; children: React.ReactNode; reasoning?: React.ReactNode }> = ({ running, children, reasoning }) => {
    const { t } = useLanguage();
    return (
        <div className="hd-msg">
            <span className="hd-msg-icon"><AgentOrbitIcon size={26} animated={running} /></span>
            <div className="hd-msg-body">
                {reasoning ?? <div className="hd-reason">▸ {t('landing.demo.reasoningDone')}</div>}
                {children}
            </div>
        </div>
    );
};

const DIST_SQL = `SELECT CASE
  WHEN delivery_distance_meters <= 1000 THEN '0-1 km'
  WHEN delivery_distance_meters <= 3000 THEN '1-3 km'
  WHEN delivery_distance_meters <= 5000 THEN '3-5 km'
  WHEN delivery_distance_meters <= 10000 THEN '5-10 km'
  ELSE '>10 km' END AS 距离段_km,
  COUNT(*) AS 配送单数,
  ROUND(COUNT(*) * 100.0 / 378770, 2) AS 占比_百分比
FROM delivery_center.deliveries
WHERE delivery_distance_meters IS NOT NULL
GROUP BY 1;`;

const AppReplay: React.FC<{ time: number; scale: number }> = ({ time, scale }) => {
    const { t, language } = useLanguage();
    const stageRef = useRef<HTMLDivElement>(null);
    const cursorRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const threadRef = useRef<HTMLDivElement>(null);
    const targets = useRef<Partial<Record<Target, HTMLElement | null>>>({});
    const lastPoints = useRef<Partial<Record<Target, Point>>>({});
    const targetRef = useMemo(
        () => Object.fromEntries(TARGETS.map((name) => [name, (el: HTMLElement | null) => { targets.current[name] = el; }])) as Record<Target, (el: HTMLElement | null) => void>,
        [],
    );

    const question = t('landing.demo.question');
    const hasTask = time >= T.newTask;
    const sent = time >= T.send;
    const running = time >= T.m1 && time < T.done;
    const panelOpen = time >= T.panel;
    const modal = time >= MODAL_AT;
    const tool = (name: string, at: number, doneAt = at + 260) =>
        time >= doneAt ? t('chat.toolCompleted').replace('{name}', name) : t('chat.toolCalling').replace('{name}', name);
    const subLine = (name: string, start: number, finalSec: number, calls: number) => {
        const done = time >= T.subDone;
        const elapsed = done ? finalSec : Math.min(finalSec, Math.floor(((time - start) / (T.subDone - start)) * finalSec));
        return t('chat.subagentLine')
            .replace('{name}', `${name}（explorer）`)
            .replace('{tool}', done ? '—' : 'query_database')
            .replace('{count}', String(done ? calls : Math.max(1, Math.ceil(calls * span(time, start, T.subDone - start)))))
            .replace('{elapsed}', `${elapsed}s`)
            .replace('{output}', t(done ? 'chat.subagentOutputProduced' : 'chat.subagentOutputPending'));
    };

    // Keep the newest message in view, like the real chat list does.
    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        const thread = threadRef.current;
        if (!viewport || !thread) return;
        const overflow = Math.max(0, thread.offsetHeight - viewport.clientHeight);
        thread.style.transform = `translateY(${-overflow}px)`;
    });

    // Place the cursor by measuring its current target, so it follows the real layout.
    useLayoutEffect(() => {
        const stage = stageRef.current;
        const cursor = cursorRef.current;
        if (!stage || !cursor || !scale) return;
        const box = stage.getBoundingClientRect();
        const resolve = (to: Target | Point): Point => {
            if (typeof to !== 'string') return to;
            const el = targets.current[to];
            if (el) {
                const rect = el.getBoundingClientRect();
                lastPoints.current[to] = {
                    x: (rect.left + rect.width / 2 - box.left) / scale,
                    y: (rect.top + rect.height / 2 - box.top) / scale,
                };
            }
            return lastPoints.current[to] ?? MOVES[0].to as Point;
        };
        let index = 0;
        while (index + 1 < MOVES.length && MOVES[index + 1].at <= time) index += 1;
        const move = MOVES[index];
        const from = resolve(MOVES[Math.max(0, index - 1)].to);
        const to = resolve(move.to);
        const k = move.dur ? easeInOut(span(time, move.at, move.dur)) : 1;
        cursor.style.transform = `translate(${from.x + (to.x - from.x) * k}px, ${from.y + (to.y - from.y) * k}px)`;
    });

    const clicking = CLICKS.some((at) => time >= at && time < at + 380);
    const cursorOpacity = 1 - span(time, MODAL_AT + 200, 300);
    const stageOpacity = Math.min(span(time, 0, 350), 1 - span(time, DURATION - 700, 700));
    const shortQuestion = `${question.slice(0, language === 'zh' ? 9 : 16)}…`;

    // GlobalPreviewModal opens at 78% × 88% of the window.
    const modalW = Math.round(STAGE_W * 0.78);
    const modalH = Math.round(STAGE_H * 0.88);
    const bodyH = modalH - 52;
    const dashScale = (modalW - 2) / DASH_W;
    const modalK = easeOut(span(time, MODAL_AT, 450));

    return (
        <div className="hd-stage" ref={stageRef} style={{ transform: `scale(${scale})`, opacity: stageOpacity }}>
            <aside className="hd-side">
                <div className="hd-logo">
                    <BrandWordmark />
                    <RiLayoutLeft2 size={18} />
                </div>
                <div className={`hd-nav is-primary ${time >= T.newTask - 200 && time < T.newTask + 300 ? 'is-pressed' : ''}`} ref={targetRef.newTask}>
                    <RiTaskLine size={18} /><span>{t('sidebar.newTask')}</span>
                </div>
                <div className="hd-nav is-current"><RiListCheck3 size={18} /><span>{t('sidebar.currentTask')}</span></div>
                <div className="hd-tree">
                    {hasTask && (
                        <div className="hd-tree-group is-new">
                            <div className="hd-tree-row is-open"><RiArrowRightS size={14} /><RiFolder3 size={15} /><span>{t('task.new')}</span></div>
                            {sent && <div className="hd-tree-row is-leaf is-active"><RiChat3 size={15} /><span>{shortQuestion}</span></div>}
                        </div>
                    )}
                    <div className="hd-tree-row"><RiArrowRightS size={14} /><RiFolder3 size={15} /><span>{t('landing.demo.task1')}</span></div>
                    <div className="hd-tree-row"><RiArrowRightS size={14} /><RiFolder3 size={15} /><span>{t('landing.demo.task2')}</span></div>
                </div>
                <div className="hd-nav"><RiBookShelf size={18} /><span>{t('sidebar.knowledge')}</span></div>
                <div className="hd-nav"><RiBrain4 size={18} /><span>{t('sidebar.semantic')}</span></div>
                <div className="hd-nav"><RiPuzzle2 size={18} /><span>{t('sidebar.plugins')}</span></div>
                <div className="hd-side-foot">
                    <div className="hd-nav"><RiUser3 size={18} /><span>user_ld</span></div>
                    <div className="hd-nav"><RiTranslate size={18} /><span>{t('sidebar.language')}</span></div>
                    <div className="hd-nav"><RiSettings4 size={18} /><span>{t('sidebar.settings')}</span></div>
                    <div className="hd-nav"><RiLogoutBox size={18} /><span>{t('sidebar.logout')}</span></div>
                </div>
            </aside>

            <div className="hd-main">
                <header className="hd-head">
                    <AgentOrbitIcon size={26} animated={running} />
                    <b>{t('chat.agents')}</b>
                    {hasTask && <><span>/</span><em>{t('task.new')}</em></>}
                    {sent && <><span>/</span><em className="is-session">{question}</em></>}
                    <RiInfoCard size={18} className="hd-head-panel" />
                </header>

                <div className="hd-body">
                    <div className="hd-chat">
                        {!hasTask ? (
                            <div className="hd-empty">{t('task.emptyPrompt')}</div>
                        ) : (
                            <>
                                <div className="hd-viewport" ref={viewportRef}>
                                    <div className="hd-thread" ref={threadRef}>
                                        {!sent && <div className="hd-empty is-inline">{t('chat.placeholder')}</div>}
                                        {sent && (
                                            <div className="hd-user">
                                                <div>{question}</div>
                                                <span>U</span>
                                            </div>
                                        )}
                                        {time >= T.m1 && (
                                            <AgentTurn
                                                running={time < T.m2}
                                                reasoning={time < T.m1Text ? (
                                                    <div className="hd-reason is-open">
                                                        <b>▾ {t('tools.statusRunning')}</b>
                                                        <p>{typed(t('landing.demo.reasoning'), time, T.m1 + 150, T.m1Text - 150)}</p>
                                                    </div>
                                                ) : undefined}
                                            >
                                                {time >= T.m1Text && <p className="hd-text">{typed(t('landing.demo.m1'), time, T.m1Text, T.m1Text + 300)}</p>}
                                                <div className="hd-hints">
                                                    {time >= T.m1Skill && <Hint label={t('chat.skillLoaded').replace('{name}', 'answer-spec')} />}
                                                    {time >= T.m1Read && <Hint label={tool('read_knowledge', T.m1Read)} />}
                                                    {time >= T.sub && <Hint label={tool('subagent', T.sub, T.subDone)} />}
                                                    {time >= T.sub + 150 && <Hint sub label={subLine('schema', T.sub + 150, 14, 6)} />}
                                                    {time >= T.sub + 300 && <Hint sub label={subLine('rowcounts', T.sub + 300, 12, 8)} />}
                                                </div>
                                            </AgentTurn>
                                        )}
                                        {time >= T.m2 && (
                                            <AgentTurn running={time < T.m3}>
                                                <p className="hd-text">{typed(t('landing.demo.m2'), time, T.m2 + 100, T.spec - 200)}</p>
                                                <div className="hd-hints">
                                                    {time >= T.spec && <Hint label={tool('begin_answer_spec', T.spec)} />}
                                                    {time >= T.q1 && <Hint label={tool('query_database', T.q1)} />}
                                                    {time >= T.q2 && <Hint label={tool('query_database', T.q2)} innerRef={targetRef.queryHint} />}
                                                    {time >= T.q3 && <Hint label={tool('query_database', T.q3)} />}
                                                    {time >= T.pub && <Hint label={tool('publish_query_result', T.pub)} />}
                                                </div>
                                            </AgentTurn>
                                        )}
                                        {time >= T.m3 && (
                                            <AgentTurn running={time < T.done}>
                                                <div className="hd-hints">
                                                    {time >= T.dashSkill && <Hint label={t('chat.skillLoaded').replace('{name}', 'dashboard')} />}
                                                    {time >= T.gen && <Hint label={tool('generate_dashboard', T.gen, T.genDone)} />}
                                                </div>
                                                {time >= T.done && (
                                                    <>
                                                        <p className="hd-text">{t('landing.demo.m3')}</p>
                                                        <div className="hd-file">
                                                            <b>{t('landing.demo.file')}：</b>
                                                            <code>dashboards/delivery_center_overview.html</code>
                                                            <span className={`hd-file-btn ${time >= T.eye - 120 && time < T.eye + 300 ? 'is-pressed' : ''}`} ref={targetRef.eye}><RiEyeLine size={15} /></span>
                                                            <span className="hd-file-btn"><RiArrowDown size={15} /></span>
                                                        </div>
                                                    </>
                                                )}
                                            </AgentTurn>
                                        )}
                                    </div>
                                </div>
                                <div className="hd-input">
                                    <small>{t('chat.attachHint')}</small>
                                    <div className={`hd-input-box ${time >= T.typeStart - 300 && !sent ? 'is-focused' : ''}`} ref={targetRef.input}>
                                        <RiLinkM size={18} />
                                        <span className={time >= T.typeStart && !sent ? 'is-typing' : 'is-placeholder'}>
                                            {time >= T.typeStart && !sent ? typed(question, time, T.typeStart, T.typeEnd) : t('chat.placeholder')}
                                        </span>
                                        <i className={`hd-send ${time >= T.typeStart && !sent ? 'is-ready' : ''}`} ref={targetRef.send}><RiSendPlane size={17} /></i>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <aside className={`hd-panel ${panelOpen ? 'is-open' : ''}`}>
                        <div className="hd-panel-head">{t('tools.details')}</div>
                        <div className="hd-card-tool">
                            <div className="hd-card-tool-head"><b>query_database</b><span>{t('tools.statusDone')}</span></div>
                            <small>{t('tools.args')}</small>
                            <pre>{typed(DIST_SQL, time, T.panel + 250, T.panel + 1300)}</pre>
                            <small>{t('tools.result')}</small>
                            <table style={{ opacity: span(time, T.panel + 1400, 300) }}>
                                <thead><tr><th>距离段_km</th><th>配送单数</th><th>占比_百分比</th></tr></thead>
                                <tbody>
                                    <tr><td>1-3 km</td><td>185,292</td><td>48.92</td></tr>
                                    <tr><td>3-5 km</td><td>76,153</td><td>20.11</td></tr>
                                    <tr><td>0-1 km</td><td>74,639</td><td>19.71</td></tr>
                                    <tr><td>…</td><td /><td /></tr>
                                </tbody>
                            </table>
                        </div>
                    </aside>
                </div>
            </div>

            {modal && (
                <div className="hd-modal-veil" style={{ opacity: modalK }}>
                    <section
                        className="hd-modal"
                        style={{ width: modalW, height: modalH, transform: `scale(${0.55 + 0.45 * modalK})`, opacity: modalK }}
                    >
                        <header>
                            <div><b>delivery_center_overview.html</b><span>HTML</span></div>
                            <ExternalLink size={17} />
                            <RiClose size={18} />
                        </header>
                        <div className="hd-modal-body" style={{ height: bodyH }}>
                            <div style={{ transform: `scale(${dashScale})`, transformOrigin: '0 0' }}>
                                <DemoDashboard time={time - MODAL_AT} scale={dashScale} viewH={bodyH} />
                            </div>
                        </div>
                    </section>
                </div>
            )}

            <div className="hd-cursor" ref={cursorRef} style={{ opacity: cursorOpacity }}>
                {clicking && <i className="hd-ripple" />}
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 2.5 19.5 12l-7 1.6L9 20.5Z" fill="#111" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
            </div>
        </div>
    );
};

/** Hero demo: a self-playing replay of the delivery_center dashboard case inside the browser frame. */
const HeroDemo: React.FC = () => {
    const { t } = useLanguage();
    const reduced = usePrefersReducedMotion();
    const [viewRef, inView] = useInView<HTMLDivElement>(0.2);
    const [paused, setPaused] = useState(false);
    const [scale, setScale] = useState(0);
    const [time, setTime] = useTimeline(inView && !paused && !reduced);
    const shown = reduced ? POSTER_TIME : time;

    useEffect(() => {
        const node = viewRef.current;
        if (!node) return;
        const update = () => setScale(node.clientWidth / STAGE_W);
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, [viewRef]);

    const chapter = CHAPTERS.reduce((current, item, index) => (shown >= item.at ? index : current), 0);

    return (
        <div className="hd-demo">
            <BrowserFrame url="yourDB / app">
                <div ref={viewRef} className="hd-view" role="img" aria-label={t('landing.demo.label')}>
                    <div aria-hidden="true">{scale > 0 && <AppReplay time={shown} scale={scale} />}</div>
                </div>
            </BrowserFrame>
            {!reduced && (
                <div className="hd-controls">
                    <button
                        type="button"
                        className="hd-play"
                        onClick={() => setPaused((value) => !value)}
                        aria-label={t(paused ? 'landing.demo.play' : 'landing.demo.pause')}
                        title={t(paused ? 'landing.demo.play' : 'landing.demo.pause')}
                    >
                        {paused
                            ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor" /></svg>
                            : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" /></svg>}
                    </button>
                    <ol className="hd-chapters" aria-label={t('landing.demo.chapters')}>
                        {CHAPTERS.map((item, index) => {
                            const end = CHAPTERS[index + 1]?.at ?? DURATION;
                            const fill = index < chapter ? 1 : index > chapter ? 0 : span(shown, item.at, end - item.at);
                            return (
                                <li key={item.key}>
                                    <button
                                        type="button"
                                        className={index === chapter ? 'is-active' : ''}
                                        aria-current={index === chapter ? 'step' : undefined}
                                        onClick={() => setTime(item.at)}
                                    >
                                        <i><b style={{ transform: `scaleX(${fill})` }} /></i>
                                        <span>{t(`landing.demo.ch.${item.key}`)}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}
        </div>
    );
};

export default HeroDemo;

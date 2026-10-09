import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Languages } from '../icons/Typicons';
import { BrandMark, BrandWordmark } from '../Brand';
import { useLanguage } from '../../context/LanguageContext';
import {
    CAPABILITY_VISUALS,
    DeviceSync,
    GuardTerminal,
    PhoneDemo,
} from './LandingVisuals';
import { AnswerFlowDiagram, ArchitectureDiagram } from './Diagrams';
import HeroDemo from './HeroDemo';
import './landing.css';

/** Where the "enter app" buttons go: the bundled /app, or VITE_APP_URL in a landing-only build (.env.landing). */
const APP_URL = (import.meta.env.VITE_APP_URL as string | undefined)?.trim() || '/app';

const PERSONAS = ['ops', 'engineer', 'analyst', 'boss'];
const CAPABILITIES = ['query', 'export', 'report', 'dashboard'];
const ACCURACY = ['answer', 'hypothesis', 'loop', 'jev', 'clarify'];
const SECURE_POINTS = ['local', 'mcp', 'guard'];
const FORMATS = ['png', 'chart', 'ai', 'csv', 'md', 'html'];
const DESKTOP_STEPS = ['launch', 'connect', 'ask', 'deliver'];
const MOBILE_STEPS = ['scan', 'bind', 'ask', 'receive'];

/** Adds `is-visible` to every `[data-reveal]` element inside the root once it scrolls into view. */
function useRevealAll(root: React.RefObject<HTMLElement | null>) {
    useEffect(() => {
        const nodes = root.current?.querySelectorAll<HTMLElement>('[data-reveal]') ?? [];
        if (typeof IntersectionObserver === 'undefined') {
            nodes.forEach((node) => node.classList.add('is-visible'));
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            }
        }, { threshold: 0.15 });
        nodes.forEach((node) => observer.observe(node));
        return () => observer.disconnect();
    }, [root]);
}

const SectionHead: React.FC<{ id: string }> = ({ id }) => {
    const { t } = useLanguage();
    return (
        <div className="lp-block-head" data-reveal>
            <span className="lp-kicker">{t(`landing.${id}.kicker`)}</span>
            <h2>{t(`landing.${id}.title`)}</h2>
            <p>{t(`landing.${id}.desc`)}</p>
        </div>
    );
};

const Capabilities: React.FC = () => {
    const { t } = useLanguage();
    const [active, setActive] = useState(0);
    const key = CAPABILITIES[active];
    const Visual = CAPABILITY_VISUALS[key];

    return (
        <div className="lp-caps">
            <div className="lp-caps-tabs" role="tablist" aria-label={t('landing.what.title')}>
                {CAPABILITIES.map((cap, index) => (
                    <button
                        key={cap}
                        type="button"
                        role="tab"
                        id={`lp-cap-tab-${cap}`}
                        aria-selected={index === active}
                        aria-controls="lp-cap-panel"
                        className={index === active ? 'is-active' : ''}
                        onClick={() => setActive(index)}
                    >
                        <span>0{index + 1}</span>
                        {t(`landing.cap.${cap}.title`)}
                    </button>
                ))}
            </div>
            <div className="lp-caps-stage" id="lp-cap-panel" role="tabpanel" aria-labelledby={`lp-cap-tab-${key}`} key={key}>
                <div className="lp-caps-copy">
                    <h3>{t(`landing.cap.${key}.title`)}</h3>
                    <p>{t(`landing.cap.${key}.desc`)}</p>
                    <div className="lp-try">
                        <span>{t('landing.cap.try')}</span>
                        <code>“{t(`landing.cap.${key}.ask`)}”</code>
                    </div>
                    <div className="lp-gets">
                        <span>{t('landing.cap.gets')}</span>
                        <b>{t(`landing.cap.${key}.output`)}</b>
                    </div>
                </div>
                <div className="lp-caps-visual">
                    <Visual />
                </div>
            </div>
        </div>
    );
};

const LandingPage: React.FC = () => {
    const { t, language, toggleLanguage } = useLanguage();
    const rootRef = useRef<HTMLElement>(null);
    const shotRef = useRef<HTMLDivElement>(null);
    useRevealAll(rootRef);

    useEffect(() => {
        const root = rootRef.current;
        const shot = shotRef.current;
        if (!root || !shot) return;
        let frame = 0;
        const update = () => {
            frame = 0;
            shot.style.setProperty('--tilt', String(1 - Math.min(1, root.scrollTop / 520)));
        };
        const onScroll = () => {
            if (!frame) frame = window.requestAnimationFrame(update);
        };
        update();
        root.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            root.removeEventListener('scroll', onScroll);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, []);

    return (
        <main className="lp" ref={rootRef}>
            <a className="skip-link" href="#landing-content">{t('accessibility.skipToContent')}</a>

            <header className="lp-nav">
                <div className="lp-nav-inner">
                    <a className="lp-logo" href="#landing-content" aria-label="yourDB">
                        <BrandMark />
                        <BrandWordmark />
                    </a>
                    <nav className="lp-nav-links" aria-label={t('landing.nav.label')}>
                        <a href="#who">{t('landing.nav.who')}</a>
                        <a href="#what">{t('landing.nav.what')}</a>
                        <a href="#where">{t('landing.nav.where')}</a>
                        <a href="#build">{t('landing.nav.build')}</a>
                        <a href="#why">{t('landing.nav.why')}</a>
                        <a href="#how">{t('landing.nav.how')}</a>
                    </nav>
                    <div className="lp-nav-actions">
                        <button className="lp-btn lp-btn-quiet" type="button" onClick={toggleLanguage}>
                            <Languages size={15} />
                            <span>{language === 'zh' ? 'EN' : '中文'}</span>
                        </button>
                        <a className="lp-btn lp-btn-solid" href={APP_URL}>{t('landing.enterApp')}</a>
                    </div>
                </div>
            </header>

            <section id="landing-content" className="lp-hero">
                <div className="lp-hero-grid" aria-hidden="true" />
                <span className="lp-pill">
                    <i />
                    {t('landing.hero.eyebrow')}
                </span>
                <h1 className="lp-hero-title">
                    <span style={{ '--d': 0 } as React.CSSProperties}>anytime,</span>{' '}
                    <span style={{ '--d': 1 } as React.CSSProperties}>anywhere,</span>
                    <br />
                    <span className="is-strong" style={{ '--d': 2 } as React.CSSProperties}>it&apos;s</span>{' '}
                    <span className="is-strong" style={{ '--d': 3 } as React.CSSProperties}><BrandWordmark title="yourDB" />.</span>
                </h1>
                <p className="lp-hero-sub">{t('landing.hero.subtitle')}</p>
                <div className="lp-actions">
                    <a className="lp-btn lp-btn-solid lp-btn-lg" href={APP_URL}>
                        <span>{t('landing.hero.primary')}</span>
                        <ArrowRight size={16} />
                    </a>
                    <a className="lp-btn lp-btn-line lp-btn-lg" href="#who">{t('landing.hero.secondary')}</a>
                </div>
                <ul className="lp-platforms" aria-label={t('landing.hero.platforms')}>
                    <li>{t('landing.where.desktop')}</li>
                    <li>{t('landing.where.web')}</li>
                    <li>{t('landing.where.mobile')}</li>
                </ul>

                <div className="lp-shot" ref={shotRef}>
                    <HeroDemo />
                </div>
            </section>

            <section id="who" className="lp-block">
                <SectionHead id="who" />
                <div className="lp-personas">
                    {PERSONAS.map((key, index) => (
                        <article key={key} className="lp-persona" data-reveal style={{ '--i': index } as React.CSSProperties}>
                            <span className="lp-persona-index">0{index + 1}</span>
                            <h3>{t(`landing.who.${key}.name`)}</h3>
                            <p className="lp-persona-pain">“{t(`landing.who.${key}.pain`)}”</p>
                            <p className="lp-persona-fix">{t(`landing.who.${key}.fix`)}</p>
                            <code className="lp-persona-ask">› {t(`landing.who.${key}.ask`)}</code>
                        </article>
                    ))}
                </div>
            </section>

            <section id="what" className="lp-block">
                <SectionHead id="what" />
                <Capabilities />
            </section>

            <section id="where" className="lp-where">
                <div className="lp-where-inner">
                    <div className="lp-where-copy" data-reveal>
                        <span className="lp-kicker">{t('landing.where.kicker')}</span>
                        <h2>{t('landing.where.title')}</h2>
                        <p>{t('landing.where.desc')}</p>
                        <DeviceSync />
                        <ul className="lp-checks">
                            <li>{t('landing.where.point.dashboard')}</li>
                            <li>{t('landing.where.point.clarify')}</li>
                            <li>{t('landing.where.point.new')}</li>
                            <li>{t('landing.where.point.access')}</li>
                        </ul>
                    </div>
                    <PhoneDemo />
                </div>
            </section>

            <section id="build" className="lp-block">
                <SectionHead id="build" />
                <div className="lp-build">
                    <ArchitectureDiagram />
                </div>
            </section>

            <section id="why" className="lp-block">
                <SectionHead id="why" />

                <div className="lp-why">
                    <div className="lp-why-head" data-reveal>
                        <span className="lp-why-num">01</span>
                        <h3>{t('landing.why.accurate.title')}</h3>
                        <p>{t('landing.why.accurate.desc')}</p>
                    </div>
                    <ul className="lp-mechs">
                        {ACCURACY.map((key, index) => (
                            <li key={key} data-reveal style={{ '--i': index } as React.CSSProperties}>
                                <strong>{t(`landing.acc.${key}.title`)}</strong>
                                <p>{t(`landing.acc.${key}.desc`)}</p>
                            </li>
                        ))}
                    </ul>
                    <div className="lp-why-wide">
                        <AnswerFlowDiagram />
                    </div>
                </div>

                <div className="lp-why">
                    <div className="lp-why-head" data-reveal>
                        <span className="lp-why-num">02</span>
                        <h3>{t('landing.why.secure.title')}</h3>
                        <p>{t('landing.why.secure.desc')}</p>
                    </div>
                    <div className="lp-secure">
                        <div className="lp-secure-side">
                            <ul className="lp-points">
                                {SECURE_POINTS.map((key, index) => (
                                    <li key={key} data-reveal style={{ '--i': index } as React.CSSProperties}>
                                        <strong>{t(`landing.secure.${key}.title`)}</strong>
                                        <p>{t(`landing.secure.${key}.desc`)}</p>
                                    </li>
                                ))}
                            </ul>
                            <GuardTerminal />
                        </div>
                    </div>
                </div>

                <div className="lp-why">
                    <div className="lp-why-head" data-reveal>
                        <span className="lp-why-num">03</span>
                        <h3>{t('landing.why.easy.title')}</h3>
                        <p>{t('landing.why.easy.desc')}</p>
                    </div>
                    <div className="lp-easy">
                        <div className="lp-oneshot" data-reveal>
                            <span>{t('landing.easy.oneshot.kicker')}</span>
                            <code>› {t('landing.easy.oneshot.ask')}</code>
                            <div className="lp-oneshot-out">
                                {['SQL', 'CSV', 'PNG', 'HTML'].map((tag, i) => (
                                    <b key={tag} style={{ '--i': i } as React.CSSProperties}>{tag}</b>
                                ))}
                            </div>
                            <p>{t('landing.easy.oneshot.desc')}</p>
                        </div>
                        <div className="lp-formats">
                            {FORMATS.map((key, index) => (
                                <div key={key} className="lp-format" data-reveal style={{ '--i': index } as React.CSSProperties}>
                                    <b>{t(`landing.format.${key}.tag`)}</b>
                                    <strong>{t(`landing.format.${key}.title`)}</strong>
                                    <span>{t(`landing.format.${key}.desc`)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section id="how" className="lp-block">
                <SectionHead id="how" />
                <div className="lp-tracks">
                    {[
                        { id: 'desktop', steps: DESKTOP_STEPS },
                        { id: 'mobile', steps: MOBILE_STEPS },
                    ].map(({ id, steps }, trackIndex) => (
                        <div key={id} className="lp-track" data-reveal style={{ '--i': trackIndex } as React.CSSProperties}>
                            <div className="lp-track-head">
                                <h3>{t(`landing.how.${id}.title`)}</h3>
                                <span>{t(`landing.how.${id}.note`)}</span>
                            </div>
                            <ol>
                                {steps.map((step, index) => (
                                    <li key={step}>
                                        <span className="lp-step-num">{index + 1}</span>
                                        <div>
                                            <strong>{t(`landing.how.${id}.${step}.title`)}</strong>
                                            <p>{t(`landing.how.${id}.${step}.desc`)}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    ))}
                </div>
            </section>

            <section className="lp-final">
                <div className="lp-hero-grid" aria-hidden="true" />
                <h2 data-reveal>{t('landing.final.title')}</h2>
                <p>{t('landing.final.desc')}</p>
                <div className="lp-actions">
                    <a className="lp-btn lp-btn-solid lp-btn-lg" href={APP_URL}>
                        <span>{t('landing.hero.primary')}</span>
                        <ArrowRight size={16} />
                    </a>
                </div>
            </section>

            <footer className="lp-footer">
                <a className="lp-logo lp-logo-sm" href="#landing-content" aria-label="yourDB">
                    <BrandMark />
                    <BrandWordmark />
                </a>
                <span>anytime, anywhere, it&apos;s <BrandWordmark title="yourDB" />.</span>
                <span>© 2026</span>
            </footer>
        </main>
    );
};

export default LandingPage;

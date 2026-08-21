import React from 'react';
import {
    ArrowRight,
    BrainCircuit,
    CheckCircle2,
    Database,
    FileSpreadsheet,
    Languages,
    LineChart,
    LockKeyhole,
    PlugZap,
    ShieldCheck,
    Sparkles,
    Wand2,
} from './icons/Typicons';
import { useLanguage } from '../context/LanguageContext';

const capabilityIcons = [Database, FileSpreadsheet, LineChart, Wand2];
const highlightIcons = [BrainCircuit, ArrowRight, ShieldCheck, PlugZap, Sparkles, LockKeyhole];

const LandingPage: React.FC = () => {
    const { t, language, toggleLanguage } = useLanguage();
    const capabilities = [
        ['landing.capability.query.title', 'landing.capability.query.desc', 'landing.capability.query.caption'],
        ['landing.capability.export.title', 'landing.capability.export.desc', 'landing.capability.export.caption'],
        ['landing.capability.dashboard.title', 'landing.capability.dashboard.desc', 'landing.capability.dashboard.caption'],
        ['landing.capability.report.title', 'landing.capability.report.desc', 'landing.capability.report.caption'],
    ];
    const trustItems = [
        'landing.trust.local',
        'landing.trust.mcp',
        'landing.trust.database',
        'landing.trust.skills',
    ];
    const highlights = [
        ['landing.highlight.context.title', 'landing.highlight.context.desc'],
        ['landing.highlight.redirect.title', 'landing.highlight.redirect.desc'],
        ['landing.highlight.sql.title', 'landing.highlight.sql.desc'],
        ['landing.highlight.mcp.title', 'landing.highlight.mcp.desc'],
        ['landing.highlight.skill.title', 'landing.highlight.skill.desc'],
        ['landing.highlight.local.title', 'landing.highlight.local.desc'],
    ];

    return (
        <main className="landing-shell">
            <a className="skip-link" href="#landing-content">{t('accessibility.skipToContent')}</a>
            <header className="landing-nav">
                <div className="landing-brand">
                    <span className="landing-brand-mark"><Sparkles size={18} /></span>
                    <span>YourDB</span>
                </div>
                <nav className="landing-nav-links" aria-label={t('landing.nav.label')}>
                    <a href="#capabilities">{t('landing.nav.capabilities')}</a>
                    <a href="#highlights">{t('landing.nav.highlights')}</a>
                </nav>
                <div className="landing-nav-actions">
                    <button className="landing-lang-btn" type="button" onClick={toggleLanguage}>
                        <Languages size={16} />
                        <span>{language === 'zh' ? 'EN' : '中文'}</span>
                    </button>
                </div>
            </header>

            <section id="landing-content" className="landing-hero">
                <div className="landing-hero-copy">
                    <div className="landing-kicker">
                        <Sparkles size={15} />
                        <span>{t('landing.kicker')}</span>
                    </div>
                    <h1>{t('landing.hero.title')}</h1>
                    <p>{t('landing.hero.subtitle')}</p>
                    <div className="landing-hero-actions">
                        <a className="landing-primary-btn" href="#capabilities">
                            <span>{t('landing.hero.primary')}</span>
                            <ArrowRight size={18} />
                        </a>
                        <a className="landing-secondary-link" href="#highlights">
                            {t('landing.hero.secondary')}
                        </a>
                    </div>
                    <div className="landing-proof-row">
                        {trustItems.map((key) => (
                            <span key={key}><CheckCircle2 size={15} />{t(key)}</span>
                        ))}
                    </div>
                </div>

                <div className="landing-product-visual landing-placeholder-visual" aria-label={t('landing.visual.label')}>
                    <div className="landing-placeholder-frame">
                        <div className="landing-placeholder-top">
                            <span />
                            <span />
                            <span />
                            <strong>{t('landing.visual.placeholderTitle')}</strong>
                        </div>
                        <div className="landing-placeholder-body">
                            <div className="landing-placeholder-mark">
                                <Sparkles size={28} />
                            </div>
                            <div>
                                <h2>{t('landing.visual.placeholder')}</h2>
                                <p>{t('landing.visual.placeholderDesc')}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="capabilities" className="landing-capability-pages">
                {capabilities.map(([titleKey, descKey, captionKey], index) => {
                    const Icon = capabilityIcons[index];
                    return (
                        <article className={`landing-capability-page ${index % 2 === 1 ? 'is-reversed' : ''}`} key={titleKey}>
                            <div className="landing-capability-copy">
                                <span className="landing-section-kicker">0{index + 1}</span>
                                <Icon size={28} />
                                <h2>{t(titleKey)}</h2>
                                <p>{t(descKey)}</p>
                            </div>
                            <div className="landing-capability-media" aria-label={t(captionKey)}>
                                <div className="landing-media-placeholder">
                                    <div className="landing-media-grid" />
                                    <div className="landing-media-content">
                                        <Icon size={34} />
                                        <strong>{t(captionKey)}</strong>
                                    </div>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </section>

            <section id="highlights" className="landing-section landing-highlight-section">
                <div className="landing-section-heading">
                    <span>{t('landing.highlights.eyebrow')}</span>
                    <h2>{t('landing.highlights.title')}</h2>
                    <p>{t('landing.highlights.desc')}</p>
                </div>
                <div className="landing-highlight-grid">
                    {highlights.map(([titleKey, descKey], index) => {
                        const Icon = highlightIcons[index];
                        return (
                            <article className="landing-highlight-card" key={titleKey}>
                                <Icon size={22} />
                                <h3>{t(titleKey)}</h3>
                                <p>{t(descKey)}</p>
                            </article>
                        );
                    })}
                </div>
            </section>

        </main>
    );
};

export default LandingPage;

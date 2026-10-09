import React, { Suspense, lazy } from 'react';
import { LanguageProvider } from './context/LanguageContext';

const AppRoot = lazy(() => import('./App'));
const LandingPage = lazy(() => import('./components/landing/LandingPage'));

/** Picks the landing page or the workspace app by route, so each only downloads its own code. */
const Root: React.FC = () => {
    const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.dataAgent);
    const isAppRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/app');

    return (
        <LanguageProvider>
            <Suspense fallback={null}>
                {isDesktopRuntime || isAppRoute ? <AppRoot /> : <LandingPage />}
            </Suspense>
        </LanguageProvider>
    );
};

export default Root;

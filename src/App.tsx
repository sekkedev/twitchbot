import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ConfirmProvider } from './components/ConfirmProvider';
import { ErrorBanner } from './components/ErrorBanner';
import { NavHotkeys } from './components/NavHotkeys';
import { NoticeBanner } from './components/NoticeBanner';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Analytics } from './pages/Analytics';
import { Commands } from './pages/Commands';
import { Dashboard } from './pages/Dashboard';
import { Loyalty } from './pages/Loyalty';
import { Popout } from './pages/Popout';
import { Settings as SettingsPage } from './pages/Settings';
import { SignIn } from './pages/SignIn';
import { useAppStore } from './stores/useAppStore';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/commands': 'Commands',
  '/loyalty': 'Loyalty',
  '/analytics': 'Analytics',
  '/settings': 'Settings',
};

function useTitleForPath(): string {
  const location = useLocation();
  return PAGE_TITLES[location.pathname] ?? 'TwitchBot';
}

export default function App() {
  const init = useAppStore((s) => s.init);
  const auth = useAppStore((s) => s.auth);
  const location = useLocation();

  useEffect(() => init(), [init]);

  // Popout windows render a bare view — no sidebar, top bar or auth gate.
  if (location.pathname.startsWith('/popout/')) {
    return (
      <Routes>
        <Route path="/popout/:kind" element={<Popout />} />
      </Routes>
    );
  }

  if (!auth.loggedIn) {
    return <SignIn />;
  }

  return (
    <ConfirmProvider>
      <NavHotkeys />
      <div className="flex h-screen overflow-hidden bg-bg text-text">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <InnerRoutes />
        </div>
      </div>
      <NoticeBanner />
    </ConfirmProvider>
  );
}

function InnerRoutes() {
  const title = useTitleForPath();
  return (
    <>
      <TopBar title={title} />
      <ErrorBanner />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/commands" element={<Commands />} />
          <Route path="/loyalty" element={<Loyalty />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

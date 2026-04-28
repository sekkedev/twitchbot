import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Order matches the sidebar (src/components/Sidebar.tsx → NAV).
const ROUTES = [
  '/',
  '/commands',
  '/timers',
  '/loyalty',
  '/moderation',
  '/automations',
  '/webhooks',
  '/analytics',
  '/settings',
];

/**
 * Dev-only keyboard shortcuts: Alt+1..9 jump between the nine top-level
 * pages (sidebar order). Useful for scripted screenshot runs and quick
 * navigation without reaching for the sidebar.
 */
export function NavHotkeys() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const idx = Number.parseInt(e.key, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= ROUTES.length) return;
      e.preventDefault();
      navigate(ROUTES[idx]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return null;
}

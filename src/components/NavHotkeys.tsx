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
  '/analytics',
  '/settings',
];

// Dedicated nested-view hotkeys: pages with internal tabs map an extra slot.
const NESTED_ROUTES: Record<string, string> = {
  '9': '/moderation?tab=logs',
};

/**
 * Dev-only keyboard shortcuts: Alt+1..8 jump between the eight top-level
 * pages (sidebar order). Alt+9 deep-links to the Moderation Logs tab.
 * Useful for scripted screenshot runs and quick navigation without
 * reaching for the sidebar.
 */
export function NavHotkeys() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const nested = NESTED_ROUTES[e.key];
      if (nested) {
        e.preventDefault();
        navigate(nested);
        return;
      }
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

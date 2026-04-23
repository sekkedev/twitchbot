import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const ROUTES = ['/', '/commands', '/loyalty', '/analytics', '/settings'];

/**
 * Dev-only keyboard shortcuts: Alt+1..5 jump between the five top-level
 * pages. Useful for scripted screenshot runs and quick navigation without
 * reaching for the sidebar.
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

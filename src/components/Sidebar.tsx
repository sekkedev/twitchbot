import { NavLink } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import {
  BarChartIcon,
  ClockIcon,
  GearIcon,
  HomeIcon,
  TerminalIcon,
  TrophyIcon,
} from './Icons';

const NAV = [
  { to: '/', label: 'Dashboard', icon: HomeIcon, end: true },
  { to: '/commands', label: 'Commands', icon: TerminalIcon, end: false },
  { to: '/timers', label: 'Timers', icon: ClockIcon, end: false },
  { to: '/loyalty', label: 'Loyalty', icon: TrophyIcon, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChartIcon, end: false },
  { to: '/settings', label: 'Settings', icon: GearIcon, end: false },
] as const;

const BOT_STATE_CLASS: Record<string, string> = {
  connected: 'live',
  connecting: 'pending',
  disconnected: 'offline',
  error: 'offline',
};

const BOT_STATE_LABEL: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  error: 'Error',
};

export function Sidebar() {
  const auth = useAppStore((s) => s.auth);
  const bot = useAppStore((s) => s.bot);
  const session = useAppStore((s) => s.session);

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-bg-elev">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="flex h-6 w-6 items-center justify-center border border-accent/40 bg-accent/10 text-[10px] font-bold text-accent">
          T
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-text">
          TwitchBot
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 pt-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-accent bg-accent/5 text-text'
                  : 'border-transparent text-text-muted hover:bg-bg-hover hover:text-text'
              }`
            }
          >
            <Icon width={14} height={14} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-4 text-xs">
        {auth.loggedIn ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`status-dot ${BOT_STATE_CLASS[bot.state]}`} />
              <span className="text-text-muted">{BOT_STATE_LABEL[bot.state]}</span>
            </div>
            <div className="font-mono text-[11px] text-text">{auth.channel}</div>
            {session && (
              <div className="flex items-center gap-2 text-live">
                <span className="status-dot live" />
                <span className="font-mono uppercase tracking-wider">
                  live · #{session.id}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-text-dim">
            <span className="status-dot offline" />
            <span>Not signed in</span>
          </div>
        )}
      </div>
    </aside>
  );
}

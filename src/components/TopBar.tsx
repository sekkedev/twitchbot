import { useNow } from '../lib/hooks';
import { useAppStore } from '../stores/useAppStore';

const BOT_LABEL: Record<string, string> = {
  connected: 'Disconnect bot',
  connecting: 'Connecting...',
  disconnected: 'Connect bot',
  error: 'Connect bot',
};

export function TopBar({ title }: { title: string }) {
  const auth = useAppStore((s) => s.auth);
  const bot = useAppStore((s) => s.bot);
  const session = useAppStore((s) => s.session);
  const busy = useAppStore((s) => s.busy);
  const devAvailable = useAppStore((s) => s.devAvailable);

  const login = useAppStore((s) => s.login);
  const connectBot = useAppStore((s) => s.connectBot);
  const disconnectBot = useAppStore((s) => s.disconnectBot);
  const toggleFakeStream = useAppStore((s) => s.toggleFakeStream);

  const now = useNow(session ? 1000 : 60_000);
  const uptimeLabel = session
    ? formatUptime(now - new Date(session.started_at).getTime())
    : null;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-bg-elev px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold uppercase tracking-wider text-text">
          {title}
        </h1>
        {auth.loggedIn && (
          <span className="flex items-center gap-2 text-xs text-text-muted">
            <span className="text-text-dim">@</span>
            <span className="font-mono text-text">{auth.channel}</span>
            <span className="text-text-dim">·</span>
            {session ? (
              <span className="flex items-center gap-1 text-live">
                <span className="status-dot live" />
                <span className="font-mono uppercase tracking-wider">
                  live {uptimeLabel}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-text-dim">
                <span className="status-dot offline" />
                <span className="font-mono uppercase tracking-wider">offline</span>
              </span>
            )}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {auth.loggedIn && devAvailable && (
          <button
            onClick={() => {
              void toggleFakeStream();
            }}
            className="border border-pending/40 bg-pending/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-pending hover:bg-pending/20"
            title="Dev-only: simulate Twitch stream.online / stream.offline"
          >
            {session ? 'Fake offline' : 'Fake online'}
          </button>
        )}
        {auth.loggedIn && (
          <button
            onClick={() => {
              void (bot.state === 'connected' || bot.state === 'connecting'
                ? disconnectBot()
                : connectBot());
            }}
            disabled={busy || bot.state === 'connecting'}
            className="border border-border bg-bg-panel px-3 py-1.5 text-xs uppercase tracking-wider text-text hover:bg-bg-hover disabled:opacity-50"
          >
            {BOT_LABEL[bot.state]}
          </button>
        )}
        {!auth.loggedIn && (
          <button
            onClick={() => {
              void login();
            }}
            disabled={busy}
            className="border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? 'Opening...' : 'Connect to Twitch'}
          </button>
        )}
      </div>
    </header>
  );
}

function formatUptime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

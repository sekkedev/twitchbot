import { useCallback, useEffect, useState } from 'react';
import { PopoutIcon } from '../components/Icons';
import { LiveFeed, useLiveFeed } from '../components/LiveFeed';
import { useNow } from '../lib/hooks';
import { invoke, on, tryInvoke } from '../lib/ipc';
import type { OverviewStats } from '../lib/types';
import { useAppStore } from '../stores/useAppStore';

export function Dashboard() {
  const bot = useAppStore((s) => s.bot);
  const session = useAppStore((s) => s.session);
  const feed = useLiveFeed(100);

  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await tryInvoke<OverviewStats>('analytics:overview');
    if (res.success) setOverview(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    const off = on('users:exp-gained', () => void refresh());
    return () => {
      window.clearInterval(interval);
      off();
    };
  }, [refresh]);

  return (
    <div className="grid h-full grid-cols-[1fr_320px] grid-rows-[auto_1fr] gap-4 p-6">
      <ConnectionCard
        botState={bot.state}
        botError={bot.error}
        sessionId={session?.id ?? null}
        startedAt={session?.started_at ?? null}
      />
      <QuickStats overview={overview} loading={loading} />

      <section className="col-span-1 flex min-h-0 flex-col border border-border bg-bg-panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Live feed
          </h2>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-text-dim">
              {feed.length} event{feed.length === 1 ? '' : 's'}
            </span>
            <PopoutButton
              route="/popout/feed"
              title="Live feed"
              width={540}
              height={860}
            />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LiveFeed feed={feed} />
        </div>
      </section>

      <LeaderboardCard overview={overview} loading={loading} />
    </div>
  );
}

function ConnectionCard({
  botState,
  botError,
  sessionId,
  startedAt,
}: {
  botState: string;
  botError: string | null;
  sessionId: number | null;
  startedAt: string | null;
}) {
  const live = sessionId !== null;
  const now = useNow(live ? 1000 : 60_000);
  const uptime = live && startedAt ? formatUptime(now - new Date(startedAt).getTime()) : null;
  const botLabel = {
    connected: 'Bot connected',
    connecting: 'Bot connecting…',
    disconnected: 'Bot disconnected',
    error: 'Bot error',
  }[botState] ?? botState;

  return (
    <section className="border border-border bg-bg-panel">
      <header className="border-b border-border px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          Connection
        </h2>
      </header>
      <div className="grid grid-cols-2 gap-0 divide-x divide-border">
        <div className="flex flex-col gap-1 p-4">
          <span className="flex items-center gap-2 text-xs text-text-muted">
            <span
              className={`status-dot ${
                botState === 'connected'
                  ? 'live'
                  : botState === 'connecting'
                    ? 'pending'
                    : 'offline'
              }`}
            />
            {botLabel}
          </span>
          {botError && (
            <span className="text-xs text-offline">{botError}</span>
          )}
        </div>
        <div className="flex flex-col gap-1 p-4">
          <span className="flex items-center gap-2 text-xs text-text-muted">
            <span className={`status-dot ${live ? 'live' : 'offline'}`} />
            {live ? 'Stream live' : 'Stream offline'}
          </span>
          {live && uptime && (
            <span className="font-mono text-[11px] text-text-dim">
              uptime {uptime}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function PopoutButton({
  route,
  title,
  width,
  height,
}: {
  route: string;
  title: string;
  width?: number;
  height?: number;
}) {
  return (
    <button
      onClick={() => {
        void invoke('window:popout', { route, title, width, height }).catch(
          (err) => console.error('popout failed:', err),
        );
      }}
      title="Pop out into its own window"
      className="text-text-dim transition-colors hover:text-text"
      aria-label={`Pop out ${title}`}
    >
      <PopoutIcon width={13} height={13} />
    </button>
  );
}

function formatUptime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function QuickStats({
  overview,
  loading,
}: {
  overview: OverviewStats | null;
  loading: boolean;
}) {
  const stats = [
    {
      label: 'Total users',
      value: overview?.totalUsers ?? 0,
    },
    {
      label: 'Total EXP',
      value: overview?.totalExp ?? 0,
    },
    {
      label: 'Streams',
      value: overview?.totalSessions ?? 0,
    },
  ];
  return (
    <section className="border border-border bg-bg-panel">
      <header className="border-b border-border px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          Lifetime
        </h2>
      </header>
      <div className="divide-y divide-border">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs text-text-muted">{s.label}</span>
            <span className="font-mono text-sm text-text">
              {loading ? '—' : s.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function LeaderboardCard({
  overview,
  loading,
}: {
  overview: OverviewStats | null;
  loading: boolean;
}) {
  return (
    <section className="border border-border bg-bg-panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          Top viewers
        </h2>
        <PopoutButton
          route="/popout/leaderboard"
          title="Top viewers"
          width={400}
          height={600}
        />
      </header>
      {loading ? (
        <div className="px-4 py-3 text-xs text-text-dim">Loading…</div>
      ) : !overview || overview.topByExp.length === 0 ? (
        <div className="px-4 py-3 text-xs text-text-dim">No ranked users yet.</div>
      ) : (
        <ol className="divide-y divide-border">
          {overview.topByExp.map((row, idx) => (
            <li
              key={row.username}
              className="flex items-center gap-3 px-4 py-2 text-sm"
            >
              <span className="w-5 font-mono text-xs text-text-dim">{idx + 1}</span>
              <span className="flex-1 truncate font-semibold text-text">
                {row.username}
              </span>
              <span className="font-mono text-[11px] text-text-muted">
                L{row.level}
              </span>
              <span className="font-mono text-[11px] text-accent">
                {row.exp.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

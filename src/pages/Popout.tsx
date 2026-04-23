import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LiveFeed, useLiveFeed } from '../components/LiveFeed';
import { on, tryInvoke } from '../lib/ipc';
import type { OverviewStats } from '../lib/types';

export function Popout() {
  const { kind } = useParams<{ kind: string }>();

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      {kind === 'feed' ? (
        <FeedPopout />
      ) : kind === 'leaderboard' ? (
        <LeaderboardPopout />
      ) : (
        <UnknownPopout kind={kind} />
      )}
    </div>
  );
}

function FeedPopout() {
  const feed = useLiveFeed(200);
  return (
    <>
      <PopoutHeader title="Live feed" subtitle={`${feed.length} events`} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {feed.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-dim">
            Waiting for activity…
          </div>
        ) : (
          <LiveFeed feed={feed} />
        )}
      </div>
    </>
  );
}

function LeaderboardPopout() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await tryInvoke<OverviewStats>('analytics:overview');
    if (res.success) setOverview(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    const off = on('users:exp-gained', () => {
      // throttle via the interval; we don't need sub-second precision here
    });
    return () => {
      window.clearInterval(interval);
      off();
    };
  }, [refresh]);

  return (
    <>
      <PopoutHeader
        title="Top viewers"
        subtitle={overview ? `${overview.totalUsers.toLocaleString()} users` : ''}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-text-dim">
            Loading…
          </div>
        ) : !overview || overview.topByExp.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-dim">
            No ranked users yet.
          </div>
        ) : (
          <ol className="divide-y divide-border">
            {overview.topByExp.map((row, idx) => (
              <li
                key={row.username}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="w-6 font-mono text-xs text-text-dim">
                  {idx + 1}
                </span>
                <span className="flex-1 truncate font-semibold text-text">
                  {row.username}
                </span>
                <span className="font-mono text-xs text-text-muted">
                  L{row.level}
                </span>
                <span className="font-mono text-xs text-accent">
                  {row.exp.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

function UnknownPopout({ kind }: { kind?: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-dim">
      Unknown popout: {kind ?? '(none)'}
    </div>
  );
}

function PopoutHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-bg-elev px-4 py-2.5">
      <h1 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
        {title}
      </h1>
      {subtitle && (
        <span className="font-mono text-[10px] text-text-dim">{subtitle}</span>
      )}
    </header>
  );
}

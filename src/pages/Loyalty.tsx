import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { SearchIcon } from '../components/Icons';
import { SkeletonRows } from '../components/Skeleton';
import { invoke, on, tryInvoke } from '../lib/ipc';
import type { UserProfile, UserRow } from '../lib/types';

type SortKey = 'exp' | 'level' | 'watch_time' | 'messages' | 'username' | 'last_seen';

const COLUMNS: Array<{ key: SortKey; label: string; align?: 'right' }> = [
  { key: 'username', label: 'User' },
  { key: 'level', label: 'Lvl', align: 'right' },
  { key: 'exp', label: 'EXP', align: 'right' },
  { key: 'watch_time', label: 'Watch (h)', align: 'right' },
  { key: 'messages', label: 'Msgs', align: 'right' },
];

export function Loyalty() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('exp');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await tryInvoke<{ users: UserRow[]; total: number }>('users:list', {
      sort,
      direction,
      search,
      limit: 200,
    });
    if (res.success) {
      setUsers(res.data.users);
      setTotal(res.data.total);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, [sort, direction, search]);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 150);
    return () => window.clearTimeout(t);
  }, [refresh]);

  // Live-refresh on EXP awards (debounced — bursts are common).
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    let timer: number | null = null;
    const off = on('users:exp-gained', () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refreshRef.current();
      }, 600);
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      off();
    };
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sort === key) {
      setDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(key);
      setDirection(key === 'username' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="flex h-full min-h-0 gap-4 p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1">
            <SearchIcon
              width={14}
              height={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by username…"
              className="w-full border border-border bg-bg-panel py-1.5 pl-8 pr-3 font-mono text-sm text-text outline-none focus:border-accent"
            />
          </div>
          <span className="font-mono text-xs text-text-dim">
            {total.toLocaleString()} user{total === 1 ? '' : 's'}
          </span>
        </div>

        {error && (
          <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto border border-border bg-bg-panel">
          {loading && users.length === 0 ? (
            <SkeletonRows
              rows={8}
              columns={[
                { width: 50, align: 'right' },
                { width: 160 },
                { width: 50, align: 'right' },
                { width: 80, align: 'right' },
                { width: 80, align: 'right' },
                { width: 70, align: 'right' },
                { width: 80, align: 'right' },
              ]}
            />
          ) : users.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-text-dim">
              {search ? 'No users match that search.' : 'No users yet.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-bg-elev text-[10px] uppercase tracking-wider text-text-dim">
                <tr>
                  <th className="px-4 py-2 text-right font-normal">Rank</th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-2 font-normal ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      <button
                        onClick={() => toggleSort(col.key)}
                        className="flex items-center gap-1 font-normal uppercase tracking-wider hover:text-text"
                      >
                        {col.label}
                        {sort === col.key && (
                          <span className="text-accent">
                            {direction === 'desc' ? '↓' : '↑'}
                          </span>
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-normal">Streak</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.twitch_id}
                    onClick={() =>
                      setSelected((prev) =>
                        prev === user.twitch_id ? null : user.twitch_id,
                      )
                    }
                    className={`cursor-pointer border-t border-border hover:bg-bg-hover ${
                      selected === user.twitch_id ? 'bg-accent/5' : ''
                    }`}
                  >
                    <td className="px-4 py-2 text-right font-mono text-xs text-text-dim">
                      #{user.rank}
                    </td>
                    <td className="px-4 py-2 text-text">{user.username}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {user.level}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-accent">
                      {user.exp.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                      {(user.watch_time_minutes / 60).toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                      {user.messages_sent.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      <span className="text-text">{user.watch_streak}</span>
                      <span className="text-text-dim">
                        {' '}
                        / {user.best_watch_streak}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <UserProfilePanel
        twitchId={selected}
        onClose={() => setSelected(null)}
        onMutated={refresh}
      />
    </div>
  );
}

function UserProfilePanel({
  twitchId,
  onClose,
  onMutated,
}: {
  twitchId: string | null;
  onClose: () => void;
  onMutated: () => void;
}) {
  const confirm = useConfirm();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!twitchId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    void tryInvoke<UserProfile>('users:get', twitchId).then((res) => {
      if (res.success) setProfile(res.data);
      else setError(res.error);
      setLoading(false);
    });
  }, [twitchId]);

  if (!twitchId) {
    return (
      <aside className="hidden w-[340px] shrink-0 items-center justify-center border border-dashed border-border bg-bg-panel/50 text-center text-xs text-text-dim lg:flex">
        Select a user to view their profile.
      </aside>
    );
  }

  const adjustExp = async () => {
    const n = parseInt(delta, 10);
    if (!Number.isFinite(n) || n === 0) return;
    setError(null);
    try {
      await invoke('users:update-exp', {
        twitchId,
        delta: n,
        reason: reason || undefined,
      });
      setDelta('');
      setReason('');
      const res = await tryInvoke<UserProfile>('users:get', twitchId);
      if (res.success) setProfile(res.data);
      onMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjust failed.');
    }
  };

  const resetOne = async () => {
    const confirmed = await confirm({
      title: 'Reset user',
      message: (
        <>
          Reset all stats for <span className="font-semibold text-text">{profile?.username}</span>?
          EXP, level, messages, watch time and streaks will be zeroed.
          Their event history is preserved.
        </>
      ),
      confirmLabel: 'Reset user',
      tone: 'danger',
    });
    if (!confirmed) return;
    setError(null);
    try {
      await invoke('users:reset', { twitchId });
      const res = await tryInvoke<UserProfile>('users:get', twitchId);
      if (res.success) setProfile(res.data);
      onMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    }
  };

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border border-border bg-bg-panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          Profile
        </h2>
        <button
          onClick={onClose}
          className="text-xs text-text-dim hover:text-text"
        >
          close
        </button>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-dim">
          Loading…
        </div>
      ) : !profile ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-offline">
          {error ?? 'User not found.'}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-base font-semibold text-text">{profile.username}</h3>
              <span className="font-mono text-xs text-text-dim">
                #{profile.rank}
              </span>
            </div>
            <div className="font-mono text-[11px] text-text-dim">
              {profile.twitch_id}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Level" value={profile.level} />
            <Stat label="EXP" value={profile.exp.toLocaleString()} />
            <Stat
              label="Watch time"
              value={`${(profile.watch_time_minutes / 60).toFixed(1)}h`}
            />
            <Stat label="Messages" value={profile.messages_sent.toLocaleString()} />
            <Stat label="Streak" value={profile.watch_streak} />
            <Stat label="Best streak" value={profile.best_watch_streak} />
          </div>

          <div className="border-t border-border pt-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Adjust EXP
            </h4>
            {error && (
              <div className="mb-2 border border-offline/40 bg-offline/10 px-2 py-1 text-[11px] text-offline">
                {error}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="±100"
                className="w-20 border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-accent"
              />
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="reason (optional)"
                className="min-w-0 flex-1 border border-border bg-bg px-2 py-1 text-xs text-text outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={() => void adjustExp()}
              disabled={!delta}
              className="mt-2 w-full border border-accent bg-accent/10 py-1.5 text-[10px] uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              Apply adjustment
            </button>
            <p className="mt-1 text-[10px] text-text-dim">
              Clamped to zero minimum. Level recomputed automatically.
            </p>
          </div>

          <div className="border-t border-border pt-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Recent events
            </h4>
            {profile.events.length === 0 ? (
              <p className="text-xs text-text-dim">No events logged.</p>
            ) : (
              <ul className="space-y-0.5 text-[11px]">
                {profile.events.slice(0, 15).map((ev) => (
                  <EventListRow key={ev.id} event={ev} />
                ))}
              </ul>
            )}
          </div>

          <div className="mt-auto border-t border-border pt-3">
            <button
              onClick={() => void resetOne()}
              className="w-full border border-offline/40 bg-offline/10 py-1.5 text-xs uppercase tracking-wider text-offline hover:bg-offline/20"
            >
              Reset this user
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border bg-bg px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-text">{value}</div>
    </div>
  );
}

function EventListRow({
  event,
}: {
  event: {
    id: number;
    type: string;
    data: string | null;
    exp_awarded: number;
    created_at: string;
  };
}) {
  const reason = parseReason(event.data);
  return (
    <li className="border-t border-border/60 py-1 first:border-t-0 first:pt-0">
      <div className="grid grid-cols-[70px_1fr_60px_58px] items-center gap-2">
        <span className="truncate font-mono uppercase tracking-wider text-text-dim">
          {event.type}
        </span>
        <span className="min-w-0 truncate text-[11px] text-text-muted" title={reason ?? ''}>
          {reason ?? ''}
        </span>
        <span
          className={`text-right font-mono ${
            event.exp_awarded < 0 ? 'text-offline/80' : 'text-accent/80'
          }`}
        >
          {event.exp_awarded > 0 ? '+' : ''}
          {event.exp_awarded}
        </span>
        <span className="text-right font-mono text-[10px] text-text-dim">
          {new Date(event.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </li>
  );
}

function parseReason(data: string | null): string | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (typeof parsed.reason === 'string' && parsed.reason) return parsed.reason;
    if (typeof parsed.streak === 'number') return `streak ${parsed.streak}`;
    if (typeof parsed.bits === 'number') return `${parsed.bits} bits`;
    if (typeof parsed.viewers === 'number') return `${parsed.viewers} viewers`;
    if (typeof parsed.total === 'number') return `${parsed.total} gifts`;
    if (typeof parsed.tier === 'string') {
      const tier = parsed.tier as string;
      return `Tier ${tier.replace(/0+$/, '')}`;
    }
  } catch {
    return null;
  }
  return null;
}

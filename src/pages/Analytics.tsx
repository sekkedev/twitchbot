import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { tryInvoke } from '../lib/ipc';
import type { ActivityData, ActivityRange, OverviewStats } from '../lib/types';

const RANGES: Array<{ key: ActivityRange; label: string }> = [
  { key: 'day', label: '24h' },
  { key: 'week', label: '7d' },
  { key: 'month', label: '30d' },
];

const CHART_GRID = '#2a2a30';
const CHART_AXIS = '#6e6e78';
const CHART_TEXT = '#adadb8';
const ACCENT = '#a78bfa';
const LIVE = '#22c55e';

export function Analytics() {
  const [range, setRange] = useState<ActivityRange>('week');
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [actRes, ovRes] = await Promise.all([
      tryInvoke<ActivityData>('analytics:activity', range),
      tryInvoke<OverviewStats>('analytics:overview'),
    ]);
    if (actRes.success) setActivity(actRes.data);
    else setError(actRes.error);
    if (ovRes.success) setOverview(ovRes.data);
    setLoading(false);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const bucketData = useMemo(
    () =>
      (activity?.buckets ?? []).map((b) => ({
        label: formatBucket(b.bucket, range),
        messages: b.messages,
        exp: b.exp,
      })),
    [activity, range],
  );

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-text">
            Analytics
          </h2>
          <p className="text-xs text-text-dim">
            All data is stored locally in SQLite. Time-series uses the events table.
          </p>
        </div>
        <div className="flex gap-1 border border-border bg-bg-panel p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                range === r.key
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
          {error}
        </div>
      )}

      <div className="grid grid-cols-5 gap-3">
        <MetricCard
          label="Total users"
          value={overview?.totalUsers ?? 0}
          loading={loading}
        />
        <MetricCard
          label="Total EXP"
          value={overview?.totalExp.toLocaleString() ?? 0}
          loading={loading}
        />
        <MetricCard
          label="Messages"
          value={overview?.totalMessages.toLocaleString() ?? 0}
          loading={loading}
        />
        <MetricCard
          label="Command uses"
          value={overview?.totalCommandUses.toLocaleString() ?? 0}
          loading={loading}
        />
        <MetricCard
          label="Streams"
          value={overview?.totalSessions ?? 0}
          loading={loading}
          tone={overview?.activeSessions ? 'live' : undefined}
          hint={overview?.activeSessions ? 'live now' : undefined}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ChartPanel title="Messages over time">
          {bucketData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={bucketData}>
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke={CHART_AXIS}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                />
                <YAxis
                  stroke={CHART_AXIS}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                  width={30}
                />
                <Tooltip
                  contentStyle={{
                    background: '#18181b',
                    border: '1px solid #2a2a30',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: CHART_TEXT }}
                />
                <Line
                  type="monotone"
                  dataKey="messages"
                  stroke={ACCENT}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart>No messages in this range.</EmptyChart>
          )}
        </ChartPanel>

        <ChartPanel title="EXP awarded over time">
          {bucketData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bucketData}>
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke={CHART_AXIS}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                />
                <YAxis
                  stroke={CHART_AXIS}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    background: '#18181b',
                    border: '1px solid #2a2a30',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: CHART_TEXT }}
                />
                <Bar dataKey="exp" fill={ACCENT} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart>No EXP awarded in this range.</EmptyChart>
          )}
        </ChartPanel>

        <ChartPanel title="Top commands">
          {activity && activity.topCommands.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={activity.topCommands}
                layout="vertical"
                margin={{ left: 40 }}
              >
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  stroke={CHART_AXIS}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke={CHART_AXIS}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    background: '#18181b',
                    border: '1px solid #2a2a30',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: CHART_TEXT }}
                />
                <Bar dataKey="usage_count" fill={ACCENT} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart>No custom command usage yet.</EmptyChart>
          )}
        </ChartPanel>

        <ChartPanel title="Session peak viewers">
          {activity && activity.sessions.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={activity.sessions.map((s) => ({
                  id: `#${s.id}`,
                  peak: s.peak_viewers,
                  active: s.ended_at === null,
                }))}
              >
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                <XAxis
                  dataKey="id"
                  stroke={CHART_AXIS}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                />
                <YAxis
                  stroke={CHART_AXIS}
                  tick={{ fill: CHART_TEXT, fontSize: 11 }}
                  width={30}
                />
                <Tooltip
                  contentStyle={{
                    background: '#18181b',
                    border: '1px solid #2a2a30',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: CHART_TEXT }}
                />
                <Bar dataKey="peak">
                  {activity.sessions.map((s, i) => (
                    <Cell key={i} fill={s.ended_at === null ? LIVE : ACCENT} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart>No sessions in this range.</EmptyChart>
          )}
        </ChartPanel>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  loading,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  loading: boolean;
  tone?: 'live';
  hint?: string;
}) {
  return (
    <div className="border border-border bg-bg-panel px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-text-dim">{label}</div>
        {hint && (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-live">
            <span className="status-dot live" />
            {hint}
          </span>
        )}
      </div>
      <div
        className={`mt-1 font-mono text-xl ${
          tone === 'live' ? 'text-live' : 'text-text'
        }`}
      >
        {loading ? '—' : value}
      </div>
    </div>
  );
}

function ChartPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col border border-border bg-bg-panel">
      <header className="border-b border-border px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          {title}
        </h3>
      </header>
      <div className="min-h-0 flex-1 p-2">{children}</div>
    </section>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-text-dim">
      {children}
    </div>
  );
}

function formatBucket(bucket: string, range: ActivityRange): string {
  if (range === 'day') {
    return bucket.slice(11, 13) + ':00';
  }
  return bucket.slice(5); // MM-DD
}

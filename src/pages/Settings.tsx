import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useConfirm } from '../components/ConfirmProvider';
import { CredentialsCard } from '../components/CredentialsCard';
import { invoke, on, tryInvoke } from '../lib/ipc';
import { useAppStore } from '../stores/useAppStore';

interface NumericField {
  key: string;
  label: string;
  hint?: string;
  kind?: 'int' | 'float';
  min?: number;
  max?: number;
  step?: number;
}

const EXP_FIELDS: NumericField[] = [
  { key: 'exp_per_message', label: 'Per chat message' },
  { key: 'exp_per_minute_watched', label: 'Per minute watched' },
  { key: 'exp_per_follow', label: 'Per follow' },
  { key: 'exp_per_subscribe', label: 'Per subscribe' },
  { key: 'exp_per_gift_sub', label: 'Per gift sub' },
  { key: 'exp_per_10_bits', label: 'Per 10 bits cheered' },
  { key: 'exp_per_raid_viewer', label: 'Per raid viewer' },
  { key: 'streak_bonus_per_stream', label: 'Streak bonus per streak count' },
  { key: 'message_exp_cap_per_minute', label: 'Chat EXP cap per minute' },
];

const LEVEL_FIELDS: NumericField[] = [
  { key: 'level_base', label: 'Base', kind: 'float', step: 1 },
  { key: 'level_exponent', label: 'Exponent', kind: 'float', step: 0.05 },
];

export function Settings() {
  const auth = useAppStore((s) => s.auth);
  const logout = useAppStore((s) => s.logout);
  const showNotice = useAppStore((s) => s.showNotice);
  const confirm = useConfirm();

  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [userCount, setUserCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await tryInvoke<Record<string, string>>('settings:get-all');
    if (res.success) setSettings(res.data);
    else setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    void tryInvoke<{ totalUsers: number }>('analytics:overview').then((res) => {
      if (res.success) setUserCount(res.data.totalUsers);
    });
    const off = on<{ key: string; value: string }>('settings:updated', (p) => {
      setSettings((prev) => ({ ...prev, [p.key]: p.value }));
    });
    return off;
  }, [load]);

  const update = useCallback(
    async (key: string, value: unknown) => {
      setError(null);
      try {
        await invoke('settings:update', { key, value });
        setSavedKey(key);
        window.setTimeout(() => setSavedKey((prev) => (prev === key ? null : prev)), 1200);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed.');
        await load();
      }
    },
    [load],
  );

  const handleResetAll = useCallback(async () => {
    const count = userCount ?? 0;

    const step1 = await confirm({
      title: 'Reset all user data · step 1 of 3',
      message: (
        <>
          This will zero out EXP, level, watch time, message count and streak
          for <span className="font-semibold text-text">{count.toLocaleString()}</span>{' '}
          user{count === 1 ? '' : 's'}. Event history is preserved for the audit log.
          Custom commands are untouched. Continue?
        </>
      ),
      confirmLabel: 'Continue',
      tone: 'danger',
    });
    if (!step1) return;

    const step2 = await confirm({
      title: 'Reset all user data · step 2 of 3',
      message: (
        <>
          This action cannot be undone. Every viewer&apos;s rank, level progress,
          and streak will be lost. Are you sure?
        </>
      ),
      confirmLabel: 'Yes, continue',
      tone: 'danger',
    });
    if (!step2) return;

    const step3 = await confirm({
      title: 'Final confirmation · step 3 of 3',
      message: 'Type the phrase below to enable the final commit.',
      confirmLabel: 'Reset all data',
      tone: 'danger',
      requireText: 'reset all data',
    });
    if (!step3) return;

    setResetting(true);
    setError(null);
    try {
      await invoke('users:reset');
      const overview = await tryInvoke<{ totalUsers: number }>('analytics:overview');
      if (overview.success) setUserCount(overview.data.totalUsers);
      showNotice(
        'success',
        `Reset complete. ${count.toLocaleString()} user${count === 1 ? '' : 's'} wiped.`,
        6000,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setResetting(false);
    }
  }, [confirm, showNotice, userCount]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await invoke<{ canceled: boolean; path: string | null }>('db:export');
      if (!res.canceled && res.path) {
        showNotice('success', `Database exported to ${res.path}`, 8000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [showNotice]);

  const levelBase = Number(settings.level_base ?? '100');
  const levelExponent = Number(settings.level_exponent ?? '1.5');
  const levelPreview = useMemo(() => {
    if (!Number.isFinite(levelBase) || !Number.isFinite(levelExponent)) return [];
    const rows: Array<{ level: number; needed: number; cumulative: number }> = [];
    let cumulative = 0;
    for (let level = 1; level <= 10; level++) {
      const needed = Math.floor(levelBase * Math.pow(level, levelExponent));
      cumulative += needed;
      rows.push({ level: level + 1, needed, cumulative });
    }
    return rows;
  }, [levelBase, levelExponent]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-dim">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-6">
      {error && (
        <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
          {error}
        </div>
      )}

      <Section
        title="Twitch connection"
        hint="Signed-in account used for chat and EventSub."
      >
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-sm font-semibold">{auth.username}</div>
            <div className="font-mono text-xs text-text-dim">{auth.channel}</div>
          </div>
          <button
            onClick={() => {
              void logout();
            }}
            className="border border-offline/40 bg-offline/10 px-3 py-1.5 text-xs uppercase tracking-wider text-offline hover:bg-offline/20"
          >
            Disconnect account
          </button>
        </div>
      </Section>

      <CredentialsCard />

      <Section title="Bot">
        <Field label="Command prefix" hint="1–4 characters. Default: !">
          <TextInput
            value={settings.bot_prefix ?? '!'}
            saved={savedKey === 'bot_prefix'}
            onCommit={(v) => update('bot_prefix', v)}
            maxLength={4}
          />
        </Field>
        <Field
          label="Global command cooldown (sec)"
          hint="Minimum time between any two command invocations."
        >
          <NumberInput
            value={settings.global_cooldown_seconds ?? '2'}
            saved={savedKey === 'global_cooldown_seconds'}
            onCommit={(v) => update('global_cooldown_seconds', v)}
          />
        </Field>
      </Section>

      <Section title="EXP values" hint="Applied live — no restart needed.">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {EXP_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <NumberInput
                value={settings[f.key] ?? ''}
                saved={savedKey === f.key}
                onCommit={(v) => update(f.key, v)}
                step={f.step}
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section
        title="Level scaling"
        hint="EXP needed for next level = floor(base × level^exponent)"
      >
        <div className="grid grid-cols-2 gap-6">
          {LEVEL_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <NumberInput
                value={settings[f.key] ?? ''}
                saved={savedKey === f.key}
                onCommit={(v) => update(f.key, v)}
                step={f.step}
                allowFloat
              />
            </Field>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-[1fr_200px] gap-0 border border-border bg-bg">
          <div className="flex min-h-[220px] flex-col">
            <div className="border-b border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-dim">
              Cumulative EXP curve
            </div>
            <div className="min-h-0 flex-1 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={levelPreview.map((r) => ({
                    level: r.level,
                    exp: r.cumulative,
                  }))}
                  margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
                >
                  <CartesianGrid stroke="#2a2a30" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="level"
                    stroke="#6e6e78"
                    tick={{ fill: '#adadb8', fontSize: 10 }}
                    label={{ value: 'level', fill: '#6e6e78', fontSize: 10, dy: 12 }}
                  />
                  <YAxis
                    stroke="#6e6e78"
                    tick={{ fill: '#adadb8', fontSize: 10 }}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#18181b',
                      border: '1px solid #2a2a30',
                      fontSize: 11,
                    }}
                    labelStyle={{ color: '#adadb8' }}
                    formatter={(value: number) => [value.toLocaleString(), 'Total EXP']}
                    labelFormatter={(level) => `Level ${level}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="exp"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={{ fill: '#a78bfa', r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="flex min-w-0 flex-col border-l border-border">
            <div className="border-b border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-dim">
              Thresholds
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-text-dim">
                    <th className="px-2 py-1 text-left font-normal">Lvl</th>
                    <th className="px-2 py-1 text-right font-normal">Next</th>
                    <th className="px-2 py-1 text-right font-normal">Total</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {levelPreview.map((row) => (
                    <tr key={row.level} className="border-t border-border">
                      <td className="px-2 py-0.5 text-text">{row.level}</td>
                      <td className="px-2 py-0.5 text-right text-text-muted">
                        {row.needed}
                      </td>
                      <td className="px-2 py-0.5 text-right text-text">
                        {row.cumulative}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Streak">
        <Field
          label="Minimum minutes watched to count for streak"
          hint="Per session. Default 10."
        >
          <NumberInput
            value={settings.streak_minimum_minutes ?? '10'}
            saved={savedKey === 'streak_minimum_minutes'}
            onCommit={(v) => update('streak_minimum_minutes', v)}
          />
        </Field>
      </Section>

      <Section title="Announcements">
        <Field
          label="Enable level-up announcement in chat"
          hint="Bot posts in chat when a viewer levels up."
        >
          <Toggle
            value={settings.levelup_announce_enabled === '1'}
            saved={savedKey === 'levelup_announce_enabled'}
            onCommit={(v) => update('levelup_announce_enabled', v)}
          />
        </Field>
        <Field
          label="Level-up template"
          hint="Variables: {user}, {level}"
        >
          <TextInput
            value={settings.levelup_announcement ?? ''}
            saved={savedKey === 'levelup_announcement'}
            onCommit={(v) => update('levelup_announcement', v)}
            maxLength={200}
          />
        </Field>
      </Section>

      <Section title="Data">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm">Export database</div>
            <div className="text-xs text-text-dim">
              Writes a consistent snapshot of the SQLite file using the online
              backup API. Safe to run while the bot is connected.
            </div>
          </div>
          <button
            onClick={() => {
              void handleExport();
            }}
            disabled={exporting}
            className="shrink-0 border border-border bg-bg px-3 py-1.5 text-xs uppercase tracking-wider text-text hover:bg-bg-hover disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export…'}
          </button>
        </div>
      </Section>

      <Section
        title="Danger zone"
        hint="These actions are irreversible."
        tone="danger"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm">Reset all user EXP, levels, streaks</div>
            <div className="text-xs text-text-dim">
              Clears stats for
              {userCount !== null && (
                <>
                  {' '}
                  <span className="font-mono text-text">
                    {userCount.toLocaleString()}
                  </span>{' '}
                  user{userCount === 1 ? '' : 's'}.
                </>
              )}{' '}
              Event log is preserved. Requires three confirmations.
            </div>
          </div>
          <button
            onClick={() => {
              void handleResetAll();
            }}
            disabled={resetting}
            className="shrink-0 border border-offline/40 bg-offline/10 px-3 py-1.5 text-xs uppercase tracking-wider text-offline hover:bg-offline/20 disabled:opacity-50"
          >
            {resetting ? 'Resetting…' : 'Reset all user data'}
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
  tone,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  tone?: 'danger';
}) {
  return (
    <section
      className={`border ${
        tone === 'danger' ? 'border-offline/30' : 'border-border'
      } bg-bg-panel`}
    >
      <div
        className={`border-b px-5 py-3 ${
          tone === 'danger' ? 'border-offline/30' : 'border-border'
        }`}
      >
        <h2
          className={`text-xs font-semibold uppercase tracking-[0.18em] ${
            tone === 'danger' ? 'text-offline' : 'text-text'
          }`}
        >
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-xs text-text-dim">{hint}</p>}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-text-muted">{label}</label>
        <div className="w-[180px]">{children}</div>
      </div>
      {hint && <p className="text-[11px] text-text-dim">{hint}</p>}
    </div>
  );
}

function TextInput({
  value,
  saved,
  onCommit,
  maxLength,
}: {
  value: string;
  saved?: boolean;
  onCommit: (value: string) => void;
  maxLength?: number;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="relative">
      <input
        type="text"
        value={local}
        maxLength={maxLength}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onCommit(local);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
      />
      {saved && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-wider text-live">
          saved
        </span>
      )}
    </div>
  );
}

function NumberInput({
  value,
  saved,
  onCommit,
  step = 1,
  allowFloat,
}: {
  value: string;
  saved?: boolean;
  onCommit: (value: string) => void;
  step?: number;
  allowFloat?: boolean;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="relative">
      <input
        type="number"
        value={local}
        step={step}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const parsed = allowFloat ? parseFloat(local) : parseInt(local, 10);
          if (Number.isFinite(parsed) && String(parsed) !== value) {
            onCommit(String(parsed));
          } else {
            setLocal(value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
      />
      {saved && (
        <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 font-mono text-[9px] uppercase tracking-wider text-live">
          saved
        </span>
      )}
    </div>
  );
}

function Toggle({
  value,
  saved,
  onCommit,
}: {
  value: boolean;
  saved?: boolean;
  onCommit: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() => onCommit(!value)}
        className={`relative h-5 w-10 border transition-colors ${
          value ? 'border-accent bg-accent/30' : 'border-border bg-bg'
        }`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 transition-all ${
            value ? 'left-6 bg-accent' : 'left-0.5 bg-text-dim'
          }`}
        />
      </button>
      {saved && (
        <span className="font-mono text-[9px] uppercase tracking-wider text-live">
          saved
        </span>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { Modal } from '../components/Modal';
import { PlusIcon, TrashIcon } from '../components/Icons';
import { SkeletonRows } from '../components/Skeleton';
import { invoke, tryInvoke } from '../lib/ipc';
import type { Timer } from '../lib/types';

const VARIABLES = [
  '{user}',
  '{level}',
  '{exp}',
  '{watch_time}',
  '{streak}',
  '{best_streak}',
  '{messages}',
  '{rank}',
  '{channel}',
  '{uptime}',
  '{count}',
];

const INTERVAL_PRESETS = [
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
  { label: '60m', seconds: 3600 },
];

interface EditorState {
  mode: 'create' | 'edit';
  timer?: Timer;
}

export function Timers() {
  const confirm = useConfirm();
  const [timers, setTimers] = useState<Timer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await tryInvoke<Timer[]>('timers:list');
    if (res.success) setTimers(res.data);
    else setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSave = async (input: {
    id?: number;
    name: string;
    message: string;
    interval_seconds: number;
    min_chat_lines: number;
    enabled: boolean;
  }) => {
    setError(null);
    try {
      if (input.id !== undefined) {
        await invoke('timers:update', input);
      } else {
        await invoke('timers:create', input);
      }
      setEditor(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const onToggle = async (timer: Timer) => {
    try {
      await invoke('timers:toggle', timer.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed.');
    }
  };

  const onDelete = async (timer: Timer) => {
    const confirmed = await confirm({
      title: 'Delete timer',
      message: (
        <>
          Permanently delete <span className="font-mono text-text">{timer.name}</span>?
        </>
      ),
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await invoke('timers:delete', timer.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-text">
            Timers
          </h2>
          <p className="text-xs text-text-dim">
            Recurring chat messages that respect interval and chat activity gates.
          </p>
        </div>
        <button
          onClick={() => setEditor({ mode: 'create' })}
          className="flex items-center gap-2 border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20"
        >
          <PlusIcon width={14} height={14} />
          Add Timer
        </button>
      </div>

      {error && (
        <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto border border-border bg-bg-panel">
        {loading ? (
          <SkeletonRows
            rows={6}
            columns={[
              { width: 140 },
              { width: 320 },
              { width: 90, align: 'right' },
              { width: 100, align: 'right' },
              { width: 120, align: 'right' },
              { width: 60, align: 'center' },
              { width: 30 },
            ]}
          />
        ) : timers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-text">No timers yet.</p>
            <p className="text-xs text-text-dim">
              Click <span className="font-mono">Add Timer</span> to schedule one.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-elev text-[10px] uppercase tracking-wider text-text-dim">
              <tr>
                <th className="px-4 py-2 text-left font-normal">Name</th>
                <th className="px-4 py-2 text-left font-normal">Message</th>
                <th className="px-4 py-2 text-right font-normal">Interval</th>
                <th className="px-4 py-2 text-right font-normal">Chat lines</th>
                <th className="px-4 py-2 text-right font-normal">Last fired</th>
                <th className="px-4 py-2 text-center font-normal">On</th>
                <th className="px-4 py-2 text-right font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {timers.map((timer) => (
                <tr
                  key={timer.id}
                  className="cursor-pointer border-t border-border hover:bg-bg-hover"
                  onClick={() => setEditor({ mode: 'edit', timer })}
                >
                  <td className="px-4 py-2 font-mono text-text">{timer.name}</td>
                  <td className="max-w-[420px] truncate px-4 py-2 text-text-muted">
                    {timer.message}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                    {formatInterval(timer.interval_seconds)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                    {timer.min_chat_lines}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                    {formatLastFired(timer.last_fired_at)}
                  </td>
                  <td
                    className="px-4 py-2 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        void onToggle(timer);
                      }}
                      className={`relative h-4 w-8 border transition-colors ${
                        timer.enabled
                          ? 'border-accent bg-accent/30'
                          : 'border-border bg-bg'
                      }`}
                      aria-pressed={timer.enabled}
                    >
                      <span
                        className={`absolute top-0.5 h-2.5 w-2.5 transition-all ${
                          timer.enabled
                            ? 'left-[18px] bg-accent'
                            : 'left-0.5 bg-text-dim'
                        }`}
                      />
                    </button>
                  </td>
                  <td
                    className="px-4 py-2 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        void onDelete(timer);
                      }}
                      className="text-text-dim hover:text-offline"
                      aria-label={`Delete ${timer.name}`}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editor && (
        <TimerEditor
          mode={editor.mode}
          timer={editor.timer}
          onClose={() => setEditor(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
}

function TimerEditor({
  mode,
  timer,
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit';
  timer?: Timer;
  onClose: () => void;
  onSave: (input: {
    id?: number;
    name: string;
    message: string;
    interval_seconds: number;
    min_chat_lines: number;
    enabled: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(timer?.name ?? '');
  const [message, setMessage] = useState(timer?.message ?? '');
  const [interval, setIntervalSeconds] = useState(timer?.interval_seconds ?? 300);
  const [minChatLines, setMinChatLines] = useState(timer?.min_chat_lines ?? 0);
  const [enabled, setEnabled] = useState(timer?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSave = async () => {
    setLocalError(null);
    setSaving(true);
    try {
      await onSave({
        id: timer?.id,
        name,
        message,
        interval_seconds: interval,
        min_chat_lines: minChatLines,
        enabled,
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const insertVariable = (v: string) => {
    setMessage((prev) => prev + v);
  };

  return (
    <Modal
      title={mode === 'create' ? 'Add Timer' : `Edit ${timer?.name}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="border border-border bg-bg-panel px-3 py-1.5 text-xs uppercase tracking-wider text-text-muted hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={saving || !name.trim() || !message.trim()}
            className="border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {saving ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {localError && (
          <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
            {localError}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-text-muted">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Discord promo"
            className="w-full border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-text-muted">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Join the Discord, {user}: example.com"
            className="w-full resize-none border border-border bg-bg px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-text-muted hover:border-accent/50 hover:text-accent"
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-text-muted">Interval</label>
          <div className="flex flex-wrap gap-1.5">
            {INTERVAL_PRESETS.map((preset) => {
              const active = interval === preset.seconds;
              return (
                <button
                  key={preset.seconds}
                  type="button"
                  onClick={() => setIntervalSeconds(preset.seconds)}
                  className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    active
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg text-text-muted hover:bg-bg-hover'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
            <input
              type="number"
              min={15}
              value={interval}
              onChange={(e) => setIntervalSeconds(Number(e.target.value))}
              className="w-24 border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-accent"
              aria-label="Custom interval in seconds"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-text-muted">
              Min chat lines
            </label>
            <input
              type="number"
              min={0}
              value={minChatLines}
              onChange={(e) => setMinChatLines(Number(e.target.value))}
              className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              Enabled
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function formatInterval(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function formatLastFired(timestamp: number | null): string {
  if (!timestamp) return 'never';
  return new Date(timestamp * 1000).toLocaleString();
}

import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { Modal } from '../components/Modal';
import { PlusIcon, TrashIcon } from '../components/Icons';
import { SkeletonRows } from '../components/Skeleton';
import { invoke, tryInvoke } from '../lib/ipc';
import type { Command, Role } from '../lib/types';

const ALL_ROLES: Role[] = ['everyone', 'follower', 'vip', 'subscriber', 'moderator'];
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

interface EditorState {
  mode: 'create' | 'edit';
  command?: Command;
}

export function Commands() {
  const confirm = useConfirm();
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [prefix, setPrefix] = useState('!');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [listRes, settingsRes] = await Promise.all([
      tryInvoke<Command[]>('commands:list'),
      tryInvoke<Record<string, string>>('settings:get-all'),
    ]);
    if (listRes.success) setCommands(listRes.data);
    else setError(listRes.error);
    if (settingsRes.success) setPrefix(settingsRes.data.bot_prefix ?? '!');
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSave = async (input: {
    id?: number;
    name: string;
    response: string;
    cooldown_seconds: number;
    permissions: Role[];
    enabled: boolean;
  }) => {
    setError(null);
    try {
      if (input.id !== undefined) {
        await invoke('commands:update', input);
      } else {
        await invoke('commands:create', input);
      }
      setEditor(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const onToggle = async (cmd: Command) => {
    try {
      await invoke('commands:update', { id: cmd.id, enabled: !cmd.enabled });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed.');
    }
  };

  const onDelete = async (cmd: Command) => {
    const confirmed = await confirm({
      title: 'Delete command',
      message: (
        <>
          Permanently delete <span className="font-mono text-text">{prefix}{cmd.name}</span>?
          Its usage count ({cmd.usage_count.toLocaleString()}) and response template will be lost.
        </>
      ),
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await invoke('commands:delete', cmd.id);
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
            Custom commands
          </h2>
          <p className="text-xs text-text-dim">
            Built-in commands (<span className="font-mono">!rank, !leaderboard, !streak, !watchtime, !commands</span>) are always available.
          </p>
        </div>
        <button
          onClick={() => setEditor({ mode: 'create' })}
          className="flex items-center gap-2 border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20"
        >
          <PlusIcon width={14} height={14} />
          New command
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
              { width: 120 },
              { width: 280 },
              { width: 80, align: 'right' },
              { width: 160 },
              { width: 60, align: 'right' },
              { width: 40, align: 'center' },
              { width: 30 },
            ]}
          />
        ) : commands.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-text">No custom commands yet.</p>
            <p className="text-xs text-text-dim">
              Click <span className="font-mono">New command</span> to add your first one.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-elev text-[10px] uppercase tracking-wider text-text-dim">
              <tr>
                <th className="px-4 py-2 text-left font-normal">Name</th>
                <th className="px-4 py-2 text-left font-normal">Response</th>
                <th className="px-4 py-2 text-right font-normal">Cooldown</th>
                <th className="px-4 py-2 text-left font-normal">Permissions</th>
                <th className="px-4 py-2 text-right font-normal">Uses</th>
                <th className="px-4 py-2 text-center font-normal">On</th>
                <th className="px-4 py-2 text-right font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {commands.map((cmd) => (
                <tr
                  key={cmd.id}
                  className="cursor-pointer border-t border-border hover:bg-bg-hover"
                  onClick={() => setEditor({ mode: 'edit', command: cmd })}
                >
                  <td className="px-4 py-2 font-mono text-text">
                    {prefix}
                    {cmd.name}
                  </td>
                  <td className="max-w-[360px] truncate px-4 py-2 text-text-muted">
                    {cmd.response}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                    {cmd.cooldown_seconds}s
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {cmd.permissions.map((role) => (
                        <span
                          key={role}
                          className="border border-border bg-bg px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-muted"
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                    {cmd.usage_count}
                  </td>
                  <td
                    className="px-4 py-2 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        void onToggle(cmd);
                      }}
                      className={`relative h-4 w-8 border transition-colors ${
                        cmd.enabled
                          ? 'border-accent bg-accent/30'
                          : 'border-border bg-bg'
                      }`}
                      aria-pressed={cmd.enabled}
                    >
                      <span
                        className={`absolute top-0.5 h-2.5 w-2.5 transition-all ${
                          cmd.enabled ? 'left-[18px] bg-accent' : 'left-0.5 bg-text-dim'
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
                        void onDelete(cmd);
                      }}
                      className="text-text-dim hover:text-offline"
                      aria-label={`Delete ${cmd.name}`}
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
        <CommandEditor
          mode={editor.mode}
          command={editor.command}
          prefix={prefix}
          onClose={() => setEditor(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
}

function CommandEditor({
  mode,
  command,
  prefix,
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit';
  command?: Command;
  prefix: string;
  onClose: () => void;
  onSave: (input: {
    id?: number;
    name: string;
    response: string;
    cooldown_seconds: number;
    permissions: Role[];
    enabled: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(command?.name ?? '');
  const [response, setResponse] = useState(command?.response ?? '');
  const [cooldown, setCooldown] = useState(command?.cooldown_seconds ?? 5);
  const [permissions, setPermissions] = useState<Role[]>(
    command?.permissions ?? ['everyone'],
  );
  const [enabled, setEnabled] = useState(command?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const togglePermission = (role: Role) => {
    setPermissions((prev) => {
      if (role === 'everyone') return ['everyone'];
      const withoutEveryone = prev.filter((r) => r !== 'everyone');
      if (withoutEveryone.includes(role)) {
        const next = withoutEveryone.filter((r) => r !== role);
        return next.length === 0 ? ['everyone'] : next;
      }
      return [...withoutEveryone, role];
    });
  };

  const handleSave = async () => {
    setLocalError(null);
    setSaving(true);
    try {
      await onSave({
        id: command?.id,
        name,
        response,
        cooldown_seconds: cooldown,
        permissions,
        enabled,
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const insertVariable = (v: string) => {
    setResponse((prev) => prev + v);
  };

  return (
    <Modal
      title={mode === 'create' ? 'New command' : `Edit !${command?.name}`}
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
            disabled={saving || !name.trim() || !response.trim()}
            className="border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
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
          <label className="mb-1 block text-xs text-text-muted">
            Command name
          </label>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm text-text-dim">{prefix}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="hello"
              disabled={mode === 'edit'}
              className="flex-1 border border-border bg-bg px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent disabled:opacity-60"
            />
          </div>
          <p className="mt-1 text-[11px] text-text-dim">
            1–40 characters: lowercase letters, numbers, dashes, underscores.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs text-text-muted">
            Response template
          </label>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            rows={3}
            placeholder="Hello {user}! You are level {level}."
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-text-muted">
              Cooldown (seconds)
            </label>
            <input
              type="number"
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              min={0}
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

        <div>
          <label className="mb-1 block text-xs text-text-muted">Permissions</label>
          <p className="mb-2 text-[11px] text-text-dim">
            Set-based. Broadcaster is always allowed. Selecting &ldquo;everyone&rdquo; overrides the other roles.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_ROLES.map((role) => {
              const active = permissions.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => togglePermission(role)}
                  className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    active
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg text-text-muted hover:bg-bg-hover'
                  }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

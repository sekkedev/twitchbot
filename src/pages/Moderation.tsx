import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { PlusIcon, TrashIcon } from '../components/Icons';
import { invoke, on, tryInvoke } from '../lib/ipc';
import type { ModStatus, ModWarning, PermittedUser } from '../lib/types';
import { useAppStore } from '../stores/useAppStore';

type Tab = 'rules' | 'logs';

const RULES = [
  { key: 'links', title: 'Links', enabled: 'mod_links_enabled' },
  { key: 'caps', title: 'Caps', enabled: 'mod_caps_enabled' },
  { key: 'emote', title: 'Emotes', enabled: 'mod_emote_enabled' },
  { key: 'repeat', title: 'Repeated', enabled: 'mod_repeat_enabled' },
  { key: 'symbols', title: 'Symbols', enabled: 'mod_symbols_enabled' },
] as const;

const DEFAULT_SETTINGS: Record<string, string> = {
  mod_links_enabled: 'false',
  mod_links_whitelist: '',
  mod_links_permit_seconds: '60',
  mod_links_subs_exempt: 'true',
  mod_caps_enabled: 'false',
  mod_caps_min_length: '10',
  mod_caps_max_percent: '70',
  mod_emote_enabled: 'false',
  mod_emote_max_count: '10',
  mod_repeat_enabled: 'false',
  mod_repeat_max_count: '3',
  mod_repeat_window_seconds: '60',
  mod_symbols_enabled: 'false',
  mod_symbols_min_length: '10',
  mod_symbols_max_percent: '50',
  mod_vips_exempt: 'false',
  mod_escalation_1: 'delete',
  mod_escalation_2_timeout: '10',
  mod_escalation_3_timeout: '600',
  mod_escalation_4_timeout: '86400',
};

export function Moderation() {
  const confirm = useConfirm();
  const login = useAppStore((s) => s.login);
  const auth = useAppStore((s) => s.auth);
  const [tab, setTab] = useState<Tab>('rules');
  const [settings, setSettings] = useState<Record<string, string>>(DEFAULT_SETTINGS);
  const [warnings, setWarnings] = useState<ModWarning[]>([]);
  const [permitted, setPermitted] = useState<PermittedUser[]>([]);
  const [status, setStatus] = useState<ModStatus>({
    botMustBeMod: false,
    missingScopes: [],
  });
  const [ruleFilter, setRuleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [permitUserId, setPermitUserId] = useState('');
  const [permitUsername, setPermitUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const missingScopes = useMemo(
    () =>
      status.missingScopes.length > 0
        ? status.missingScopes
        : [
            'moderator:manage:chat_messages',
            'moderator:manage:banned_users',
          ].filter((scope) => !auth.scopes.includes(scope)),
    [auth.scopes, status.missingScopes],
  );

  const loadSettings = useCallback(async () => {
    const res = await tryInvoke<Record<string, string>>('mod:getSettings');
    if (res.success) setSettings({ ...DEFAULT_SETTINGS, ...res.data });
    else setError(res.error);
  }, []);

  const loadWarnings = useCallback(async () => {
    const res = await tryInvoke<ModWarning[]>('mod:getWarnings', {
      rule: ruleFilter || undefined,
      search: search || undefined,
      limit: 200,
    });
    if (res.success) setWarnings(res.data);
    else setError(res.error);
  }, [ruleFilter, search]);

  const loadPermitted = useCallback(async () => {
    const res = await tryInvoke<PermittedUser[]>('mod:getPermittedUsers');
    if (res.success) setPermitted(res.data);
    else setError(res.error);
  }, []);

  const loadStatus = useCallback(async () => {
    const res = await tryInvoke<ModStatus>('mod:getStatus');
    if (res.success) setStatus(res.data);
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadWarnings();
    void loadPermitted();
    void loadStatus();
    const offStatus = on<ModStatus>('mod:status', setStatus);
    const offWarnings = on('mod:warnings-updated', () => {
      void loadWarnings();
    });
    const offAuth = on('auth:reauth-required', () => {
      void loadStatus();
    });
    return () => {
      offStatus();
      offWarnings();
      offAuth();
    };
  }, [loadPermitted, loadSettings, loadStatus, loadWarnings]);

  useEffect(() => {
    void loadWarnings();
  }, [loadWarnings]);

  const updateLocal = (key: string, value: string | boolean | number) => {
    setSettings((prev) => ({ ...prev, [key]: String(value) }));
  };

  const saveSettings = async () => {
    setError(null);
    setSaved(false);
    try {
      const res = await invoke<Record<string, string>>('mod:updateSettings', settings);
      setSettings({ ...DEFAULT_SETTINGS, ...res });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      await loadSettings();
    }
  };

  const clearAll = async () => {
    const ok = await confirm({
      title: 'Clear moderation logs',
      message: 'Delete all moderation warning rows?',
      confirmLabel: 'Clear all',
      tone: 'danger',
    });
    if (!ok) return;
    await invoke('mod:clearWarnings');
    await loadWarnings();
  };

  const clearForUser = async (warning: ModWarning) => {
    await invoke('mod:clearWarnings', { user_id: warning.user_id });
    await loadWarnings();
  };

  const addPermit = async () => {
    setError(null);
    try {
      await invoke('mod:addPermittedUser', {
        user_id: permitUserId.trim(),
        username: permitUsername.trim(),
      });
      setPermitUserId('');
      setPermitUsername('');
      await loadPermitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add permitted user failed.');
    }
  };

  const removePermit = async (userId: string) => {
    await invoke('mod:removePermittedUser', userId);
    await loadPermitted();
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-text">
            Moderation
          </h2>
          <p className="text-xs text-text-dim">
            Automatic filters, escalation, permits, and action logs.
          </p>
        </div>
        <div className="flex border border-border bg-bg-panel p-0.5">
          {(['rules', 'logs'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider ${
                tab === item
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-bg-hover hover:text-text'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {missingScopes.length > 0 && (
        <Banner tone="warn">
          <span>Moderation requires additional permissions.</span>
          <button
            onClick={() => {
              void login();
            }}
            className="border border-pending/50 bg-pending/10 px-2 py-1 text-[10px] uppercase tracking-wider text-pending hover:bg-pending/20"
          >
            Reconnect
          </button>
        </Banner>
      )}

      {status.botMustBeMod && (
        <Banner tone="danger">
          Bot must be a moderator in your channel to use moderation features.
        </Banner>
      )}

      {error && <Banner tone="danger">{error}</Banner>}

      {tab === 'rules' ? (
        <RulesTab
          settings={settings}
          saved={saved}
          updateLocal={updateLocal}
          saveSettings={saveSettings}
        />
      ) : (
        <LogsTab
          warnings={warnings}
          permitted={permitted}
          ruleFilter={ruleFilter}
          search={search}
          permitUserId={permitUserId}
          permitUsername={permitUsername}
          setRuleFilter={setRuleFilter}
          setSearch={setSearch}
          setPermitUserId={setPermitUserId}
          setPermitUsername={setPermitUsername}
          clearAll={clearAll}
          clearForUser={clearForUser}
          addPermit={addPermit}
          removePermit={removePermit}
        />
      )}
    </div>
  );
}

function RulesTab({
  settings,
  saved,
  updateLocal,
  saveSettings,
}: {
  settings: Record<string, string>;
  saved: boolean;
  updateLocal: (key: string, value: string | boolean | number) => void;
  saveSettings: () => Promise<void>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-2 gap-4">
        {RULES.map((rule) => (
          <section key={rule.key} className="border border-border bg-bg-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
                {rule.title}
              </h3>
              <Toggle
                value={settings[rule.enabled] === 'true'}
                onChange={(value) => updateLocal(rule.enabled, value)}
              />
            </div>
            <div className="space-y-3 p-4">
              {rule.key === 'links' && (
                <>
                  <TextField
                    label="Whitelist"
                    value={settings.mod_links_whitelist}
                    onChange={(value) => updateLocal('mod_links_whitelist', value)}
                    placeholder="example.com, twitch.tv"
                  />
                  <NumberField
                    label="Permit seconds"
                    value={settings.mod_links_permit_seconds}
                    onChange={(value) => updateLocal('mod_links_permit_seconds', value)}
                  />
                  <CheckboxField
                    label="Subscribers exempt"
                    value={settings.mod_links_subs_exempt === 'true'}
                    onChange={(value) => updateLocal('mod_links_subs_exempt', value)}
                  />
                </>
              )}
              {rule.key === 'caps' && (
                <>
                  <NumberField
                    label="Minimum length"
                    value={settings.mod_caps_min_length}
                    onChange={(value) => updateLocal('mod_caps_min_length', value)}
                  />
                  <NumberField
                    label="Maximum percent"
                    value={settings.mod_caps_max_percent}
                    onChange={(value) => updateLocal('mod_caps_max_percent', value)}
                  />
                </>
              )}
              {rule.key === 'emote' && (
                <NumberField
                  label="Maximum count"
                  value={settings.mod_emote_max_count}
                  onChange={(value) => updateLocal('mod_emote_max_count', value)}
                />
              )}
              {rule.key === 'repeat' && (
                <>
                  <NumberField
                    label="Maximum repeats"
                    value={settings.mod_repeat_max_count}
                    onChange={(value) => updateLocal('mod_repeat_max_count', value)}
                  />
                  <NumberField
                    label="Window seconds"
                    value={settings.mod_repeat_window_seconds}
                    onChange={(value) =>
                      updateLocal('mod_repeat_window_seconds', value)
                    }
                  />
                </>
              )}
              {rule.key === 'symbols' && (
                <>
                  <NumberField
                    label="Minimum length"
                    value={settings.mod_symbols_min_length}
                    onChange={(value) => updateLocal('mod_symbols_min_length', value)}
                  />
                  <NumberField
                    label="Maximum percent"
                    value={settings.mod_symbols_max_percent}
                    onChange={(value) =>
                      updateLocal('mod_symbols_max_percent', value)
                    }
                  />
                </>
              )}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-4 border border-border bg-bg-panel">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
            Escalation
          </h3>
        </div>
        <div className="grid grid-cols-4 gap-4 p-4">
          <SelectField
            label="First offense"
            value={settings.mod_escalation_1}
            onChange={(value) => updateLocal('mod_escalation_1', value)}
            options={[
              { label: 'Delete', value: 'delete' },
              { label: 'Warn only', value: 'warn' },
            ]}
          />
          <NumberField
            label="Second timeout"
            value={settings.mod_escalation_2_timeout}
            onChange={(value) => updateLocal('mod_escalation_2_timeout', value)}
          />
          <NumberField
            label="Third timeout"
            value={settings.mod_escalation_3_timeout}
            onChange={(value) => updateLocal('mod_escalation_3_timeout', value)}
          />
          <NumberField
            label="Fourth timeout"
            value={settings.mod_escalation_4_timeout}
            onChange={(value) => updateLocal('mod_escalation_4_timeout', value)}
          />
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <CheckboxField
            label="VIPs exempt"
            value={settings.mod_vips_exempt === 'true'}
            onChange={(value) => updateLocal('mod_vips_exempt', value)}
          />
          <div className="flex items-center gap-3">
            {saved && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-live">
                saved
              </span>
            )}
            <button
              onClick={() => {
                void saveSettings();
              }}
              className="border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20"
            >
              Save
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function LogsTab({
  warnings,
  permitted,
  ruleFilter,
  search,
  permitUserId,
  permitUsername,
  setRuleFilter,
  setSearch,
  setPermitUserId,
  setPermitUsername,
  clearAll,
  clearForUser,
  addPermit,
  removePermit,
}: {
  warnings: ModWarning[];
  permitted: PermittedUser[];
  ruleFilter: string;
  search: string;
  permitUserId: string;
  permitUsername: string;
  setRuleFilter: (value: string) => void;
  setSearch: (value: string) => void;
  setPermitUserId: (value: string) => void;
  setPermitUsername: (value: string) => void;
  clearAll: () => Promise<void>;
  clearForUser: (warning: ModWarning) => Promise<void>;
  addPermit: () => Promise<void>;
  removePermit: (userId: string) => Promise<void>;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-4">
      <section className="min-h-0 overflow-hidden border border-border bg-bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex gap-2">
            <select
              value={ruleFilter}
              onChange={(e) => setRuleFilter(e.target.value)}
              className="border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
            >
              <option value="">All rules</option>
              <option value="links">Links</option>
              <option value="caps">Caps</option>
              <option value="emotes">Emotes</option>
              <option value="repeat">Repeated</option>
              <option value="symbols">Symbols</option>
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search username"
              className="w-44 border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={() => {
              void clearAll();
            }}
            className="border border-offline/40 bg-offline/10 px-2 py-1.5 text-[10px] uppercase tracking-wider text-offline hover:bg-offline/20"
          >
            Clear all
          </button>
        </div>
        <div className="max-h-full overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-elev text-[10px] uppercase tracking-wider text-text-dim">
              <tr>
                <th className="px-3 py-2 text-left font-normal">Time</th>
                <th className="px-3 py-2 text-left font-normal">User</th>
                <th className="px-3 py-2 text-left font-normal">Rule</th>
                <th className="px-3 py-2 text-left font-normal">Message</th>
                <th className="px-3 py-2 text-left font-normal">Action</th>
                <th className="px-3 py-2 text-right font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {warnings.map((warning) => (
                <tr key={warning.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-[11px] text-text-muted">
                    {new Date(warning.created_at * 1000).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-text">{warning.username}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">
                    {warning.rule}
                  </td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-text-muted">
                    {warning.message_text}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">
                    {warning.action_taken}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        void clearForUser(warning);
                      }}
                      className="text-[10px] uppercase tracking-wider text-text-dim hover:text-offline"
                    >
                      clear user
                    </button>
                  </td>
                </tr>
              ))}
              {warnings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-text-dim">
                    No moderation logs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="min-h-0 overflow-y-auto border border-border bg-bg-panel">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
            Permitted users
          </h3>
        </div>
        <div className="space-y-3 p-4">
          <input
            value={permitUserId}
            onChange={(e) => setPermitUserId(e.target.value)}
            placeholder="Twitch user ID"
            className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <input
              value={permitUsername}
              onChange={(e) => setPermitUsername(e.target.value)}
              placeholder="Username"
              className="min-w-0 flex-1 border border-border bg-bg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
            <button
              onClick={() => {
                void addPermit();
              }}
              className="border border-accent bg-accent/10 px-2 text-accent hover:bg-accent/20"
              aria-label="Add permitted user"
            >
              <PlusIcon width={14} height={14} />
            </button>
          </div>
          <div className="space-y-1">
            {permitted.map((user) => (
              <div
                key={user.user_id}
                className="flex items-center justify-between border border-border bg-bg px-2 py-1.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs text-text">{user.username}</div>
                  <div className="truncate font-mono text-[10px] text-text-dim">
                    {user.user_id}
                  </div>
                </div>
                <button
                  onClick={() => {
                    void removePermit(user.user_id);
                  }}
                  className="text-text-dim hover:text-offline"
                  aria-label={`Remove ${user.username}`}
                >
                  <TrashIcon width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'warn' | 'danger';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'warn'
      ? 'border-pending/40 bg-pending/10 text-pending'
      : 'border-offline/40 bg-offline/10 text-offline';
  return (
    <div className={`flex items-center justify-between gap-3 border px-3 py-2 text-xs ${cls}`}>
      {children}
    </div>
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
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
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-border bg-bg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-text-muted">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-accent"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-border bg-bg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-muted">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent"
      />
      {label}
    </label>
  );
}

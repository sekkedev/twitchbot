import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmProvider';
import { PlusIcon, TrashIcon, XIcon } from '../components/Icons';
import { invoke, on, tryInvoke } from '../lib/ipc';
import type {
  ModStats,
  ModStatus,
  ModWarning,
  ModWarningsPage,
  PermittedUser,
} from '../lib/types';
import { useAppStore } from '../stores/useAppStore';

type Tab = 'rules' | 'logs';

const RULES = [
  { key: 'links', title: 'Links', enabled: 'mod_links_enabled', startTier: 'mod_links_start_tier' },
  { key: 'caps', title: 'Caps', enabled: 'mod_caps_enabled', startTier: 'mod_caps_start_tier' },
  { key: 'emote', title: 'Emotes', enabled: 'mod_emote_enabled', startTier: 'mod_emote_start_tier' },
  { key: 'repeat', title: 'Repeated', enabled: 'mod_repeat_enabled', startTier: 'mod_repeat_start_tier' },
  { key: 'symbols', title: 'Symbols', enabled: 'mod_symbols_enabled', startTier: 'mod_symbols_start_tier' },
] as const;

const TIER_OPTIONS = [
  { label: 'Tier 1 (warn / delete)', value: '1' },
  { label: 'Tier 2 (short timeout)', value: '2' },
  { label: 'Tier 3 (medium timeout)', value: '3' },
  { label: 'Tier 4 (long timeout)', value: '4' },
];

const RULE_FILTER_OPTIONS = [
  { label: 'All rules', value: '' },
  { label: 'Links', value: 'links' },
  { label: 'Caps', value: 'caps' },
  { label: 'Emotes', value: 'emotes' },
  { label: 'Repeated', value: 'repeat' },
  { label: 'Symbols', value: 'symbols' },
  { label: 'Blocked words', value: 'blocked_words' },
  { label: 'First message', value: 'first_message' },
];

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
  mod_blocked_words: '[]',
  mod_blocked_words_enabled: 'false',
  mod_first_message_screening: 'false',
  mod_vips_exempt: 'false',
  mod_escalation_1: 'delete',
  mod_escalation_2_timeout: '10',
  mod_escalation_3_timeout: '600',
  mod_escalation_4_timeout: '86400',
  mod_links_start_tier: '1',
  mod_caps_start_tier: '1',
  mod_emote_start_tier: '1',
  mod_repeat_start_tier: '1',
  mod_symbols_start_tier: '1',
  mod_blocked_words_start_tier: '1',
  mod_first_message_start_tier: '1',
  mod_discord_webhook_key: '',
  mod_discord_webhook_enabled: 'false',
};

const PAGE_SIZE = 25;

interface WebhookEntry {
  key: string;
  url: string;
}

export function Moderation() {
  const confirm = useConfirm();
  const login = useAppStore((s) => s.login);
  const auth = useAppStore((s) => s.auth);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab: Tab = searchParams.get('tab') === 'logs' ? 'logs' : 'rules';
  const [tab, setTabState] = useState<Tab>(urlTab);
  useEffect(() => {
    setTabState(urlTab);
  }, [urlTab]);
  const setTab = useCallback(
    (next: Tab) => {
      setTabState(next);
      const nextParams = new URLSearchParams(searchParams);
      if (next === 'rules') nextParams.delete('tab');
      else nextParams.set('tab', next);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [settings, setSettings] = useState<Record<string, string>>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<ModStats | null>(null);
  const [permitted, setPermitted] = useState<PermittedUser[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [status, setStatus] = useState<ModStatus>({
    botMustBeMod: false,
    missingScopes: [],
  });
  const [permitUserId, setPermitUserId] = useState('');
  const [permitUsername, setPermitUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Logs tab state
  const [page, setPage] = useState(1);
  const [ruleFilter, setRuleFilter] = useState('');
  const [logPage, setLogPage] = useState<ModWarningsPage>({
    warnings: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
  });

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

  const loadStats = useCallback(async () => {
    const res = await tryInvoke<ModStats>('mod:getStats');
    if (res.success) setStats(res.data);
  }, []);

  const loadLogPage = useCallback(async () => {
    const res = await tryInvoke<ModWarningsPage>('mod:getWarningsPage', {
      page,
      pageSize: PAGE_SIZE,
      ruleFilter: ruleFilter || undefined,
      sortOrder: 'desc',
    });
    if (res.success) setLogPage(res.data);
    else setError(res.error);
  }, [page, ruleFilter]);

  const loadPermitted = useCallback(async () => {
    const res = await tryInvoke<PermittedUser[]>('mod:getPermittedUsers');
    if (res.success) setPermitted(res.data);
    else setError(res.error);
  }, []);

  const loadStatus = useCallback(async () => {
    const res = await tryInvoke<ModStatus>('mod:getStatus');
    if (res.success) setStatus(res.data);
  }, []);

  const loadWebhooks = useCallback(async () => {
    const res = await tryInvoke<WebhookEntry[]>('discord-webhooks:list');
    if (res.success) setWebhooks(res.data);
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadStats();
    void loadPermitted();
    void loadStatus();
    void loadWebhooks();
    const offStatus = on<ModStatus>('mod:status', setStatus);
    const offWarnings = on('mod:warnings-updated', () => {
      void loadStats();
      void loadLogPage();
    });
    const offAuth = on('auth:reauth-required', () => {
      void loadStatus();
    });
    return () => {
      offStatus();
      offWarnings();
      offAuth();
    };
    // loadLogPage purposely excluded — first-mount load happens in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPermitted, loadSettings, loadStats, loadStatus, loadWebhooks]);

  useEffect(() => {
    void loadLogPage();
  }, [loadLogPage]);

  // Filter changes should reset to page 1.
  useEffect(() => {
    setPage(1);
  }, [ruleFilter]);

  const updateLocal = (key: string, value: string | boolean | number | string[]) => {
    setSettings((prev) => ({
      ...prev,
      [key]: Array.isArray(value) ? JSON.stringify(value) : String(value),
    }));
  };

  const saveSettings = async () => {
    setError(null);
    setSaved(false);
    try {
      // mod_blocked_words is stored as a JSON string in settings; pass it
      // as a real array so the normalizer's array branch trims and dedupes.
      const payload: Record<string, unknown> = { ...settings };
      try {
        payload.mod_blocked_words = JSON.parse(settings.mod_blocked_words || '[]');
      } catch {
        payload.mod_blocked_words = [];
      }
      const res = await invoke<Record<string, string>>('mod:updateSettings', payload);
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
    await loadLogPage();
    await loadStats();
  };

  const clearForUser = async (warning: ModWarning) => {
    await invoke('mod:clearWarnings', { user_id: warning.user_id });
    await loadLogPage();
    await loadStats();
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

      <StatsStrip stats={stats} />

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
          webhooks={webhooks}
          updateLocal={updateLocal}
          saveSettings={saveSettings}
        />
      ) : (
        <LogsTab
          logPage={logPage}
          permitted={permitted}
          ruleFilter={ruleFilter}
          page={page}
          permitUserId={permitUserId}
          permitUsername={permitUsername}
          setRuleFilter={setRuleFilter}
          setPage={setPage}
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

// ── Stats strip ────────────────────────────────────────────────────────────

function StatsStrip({ stats }: { stats: ModStats | null }) {
  const today = stats?.byTimeframe.today ?? 0;
  const last7 = stats?.byTimeframe.last7Days ?? 0;
  const last30 = stats?.byTimeframe.last30Days ?? 0;
  const topRules = stats?.byRule.slice(0, 3) ?? [];
  const topUser = stats?.topUsers[0];

  return (
    <div className="grid grid-cols-[140px_140px_140px_1fr_240px] gap-2">
      <StatCell label="Today" value={today} />
      <StatCell label="Last 7d" value={last7} />
      <StatCell label="Last 30d" value={last30} />
      <div className="border border-border bg-bg-panel p-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-dim">
          Top rules
        </div>
        {topRules.length === 0 ? (
          <div className="mt-1 text-xs text-text-dim">No warnings yet.</div>
        ) : (
          <div className="mt-1 grid grid-cols-3 gap-2">
            {topRules.map((entry) => (
              <div key={entry.rule} className="min-w-0">
                <div className="truncate text-[11px] text-text">{entry.rule}</div>
                <div className="font-mono text-xs text-text-muted">{entry.count}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border border-border bg-bg-panel p-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-dim">
          Top warned (30d)
        </div>
        {topUser ? (
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <div className="truncate text-sm text-text">{topUser.username}</div>
            <div className="font-mono text-xs text-text-muted">
              {topUser.count} warnings
            </div>
          </div>
        ) : (
          <div className="mt-1 text-xs text-text-dim">No warnings yet.</div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border bg-bg-panel p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl text-text">{value}</div>
    </div>
  );
}

// ── Rules tab ──────────────────────────────────────────────────────────────

function RulesTab({
  settings,
  saved,
  webhooks,
  updateLocal,
  saveSettings,
}: {
  settings: Record<string, string>;
  saved: boolean;
  webhooks: WebhookEntry[];
  updateLocal: (key: string, value: string | boolean | number | string[]) => void;
  saveSettings: () => Promise<void>;
}) {
  const blockedWords = useMemo(() => {
    try {
      const parsed = JSON.parse(settings.mod_blocked_words || '[]');
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }, [settings.mod_blocked_words]);

  const setBlockedWords = (words: string[]) => {
    updateLocal('mod_blocked_words', words);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-2 gap-4">
        {RULES.map((rule) => (
          <section key={rule.key} className="border border-border bg-bg-panel">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
                {rule.title}
              </h3>
              <div className="flex items-center gap-3">
                <CompactSelect
                  label="Start"
                  value={settings[rule.startTier] ?? '1'}
                  onChange={(value) => updateLocal(rule.startTier, value)}
                  options={TIER_OPTIONS}
                />
                <Toggle
                  value={settings[rule.enabled] === 'true'}
                  onChange={(value) => updateLocal(rule.enabled, value)}
                />
              </div>
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

        <BlockedWordsCard
          enabled={settings.mod_blocked_words_enabled === 'true'}
          words={blockedWords}
          startTier={settings.mod_blocked_words_start_tier ?? '1'}
          setEnabled={(value) => updateLocal('mod_blocked_words_enabled', value)}
          setStartTier={(value) => updateLocal('mod_blocked_words_start_tier', value)}
          setWords={setBlockedWords}
        />

        <FirstMessageCard
          enabled={settings.mod_first_message_screening === 'true'}
          startTier={settings.mod_first_message_start_tier ?? '1'}
          setEnabled={(value) => updateLocal('mod_first_message_screening', value)}
          setStartTier={(value) => updateLocal('mod_first_message_start_tier', value)}
        />
      </div>

      <section className="mt-4 border border-border bg-bg-panel">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
            Escalation
          </h3>
        </div>
        <div className="grid grid-cols-4 gap-4 p-4">
          <SelectField
            label="Tier 1 default"
            value={settings.mod_escalation_1}
            onChange={(value) => updateLocal('mod_escalation_1', value)}
            options={[
              { label: 'Delete', value: 'delete' },
              { label: 'Warn only', value: 'warn' },
            ]}
          />
          <NumberField
            label="Tier 2 timeout (s)"
            value={settings.mod_escalation_2_timeout}
            onChange={(value) => updateLocal('mod_escalation_2_timeout', value)}
          />
          <NumberField
            label="Tier 3 timeout (s)"
            value={settings.mod_escalation_3_timeout}
            onChange={(value) => updateLocal('mod_escalation_3_timeout', value)}
          />
          <NumberField
            label="Tier 4 timeout (s)"
            value={settings.mod_escalation_4_timeout}
            onChange={(value) => updateLocal('mod_escalation_4_timeout', value)}
          />
        </div>
        <div className="border-t border-border px-4 py-3">
          <CheckboxField
            label="VIPs exempt"
            value={settings.mod_vips_exempt === 'true'}
            onChange={(value) => updateLocal('mod_vips_exempt', value)}
          />
        </div>
      </section>

      <DiscordAlertsSection
        enabled={settings.mod_discord_webhook_enabled === 'true'}
        webhookKey={settings.mod_discord_webhook_key ?? ''}
        webhooks={webhooks}
        setEnabled={(value) => updateLocal('mod_discord_webhook_enabled', value)}
        setWebhookKey={(value) => updateLocal('mod_discord_webhook_key', value)}
      />

      <div className="mt-4 flex items-center justify-end gap-3">
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
  );
}

// ── Cards ──────────────────────────────────────────────────────────────────

function BlockedWordsCard({
  enabled,
  words,
  startTier,
  setEnabled,
  setStartTier,
  setWords,
}: {
  enabled: boolean;
  words: string[];
  startTier: string;
  setEnabled: (value: boolean) => void;
  setStartTier: (value: string) => void;
  setWords: (words: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const addWord = () => {
    const cleaned = draft.trim().toLowerCase();
    if (!cleaned || words.includes(cleaned)) {
      setDraft('');
      return;
    }
    setWords([...words, cleaned]);
    setDraft('');
  };

  const removeWord = (word: string) => {
    setWords(words.filter((entry) => entry !== word));
  };

  return (
    <section className="col-span-2 border border-border bg-bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
          Blocked Words
        </h3>
        <div className="flex items-center gap-3">
          <CompactSelect
            label="Start"
            value={startTier}
            onChange={setStartTier}
            options={TIER_OPTIONS}
          />
          <Toggle value={enabled} onChange={setEnabled} />
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addWord();
              }
            }}
            placeholder="Type a word, press Enter"
            className="min-w-0 flex-1 border border-border bg-bg px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
          />
          <button
            onClick={addWord}
            disabled={!draft.trim()}
            className="border border-accent bg-accent/10 px-2 text-accent hover:bg-accent/20 disabled:opacity-50"
            aria-label="Add blocked word"
          >
            <PlusIcon width={14} height={14} />
          </button>
        </div>
        {words.length === 0 ? (
          <div className="text-[11px] text-text-dim">
            No blocked words. Match is case-insensitive substring.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {words.map((word) => (
              <span
                key={word}
                className="flex items-center gap-1 border border-border bg-bg px-2 py-1 font-mono text-[11px] text-text"
              >
                {word}
                <button
                  onClick={() => removeWord(word)}
                  className="text-text-dim hover:text-offline"
                  aria-label={`Remove ${word}`}
                >
                  <XIcon width={11} height={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FirstMessageCard({
  enabled,
  startTier,
  setEnabled,
  setStartTier,
}: {
  enabled: boolean;
  startTier: string;
  setEnabled: (value: boolean) => void;
  setStartTier: (value: string) => void;
}) {
  return (
    <section className="col-span-2 border border-border bg-bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
          First Message Screening
        </h3>
        <div className="flex items-center gap-3">
          <CompactSelect
            label="Start"
            value={startTier}
            onChange={setStartTier}
            options={TIER_OPTIONS}
          />
          <Toggle value={enabled} onChange={setEnabled} />
        </div>
      </div>
      <div className="p-4 text-xs text-text-muted">
        Auto-deletes the first message from any user with no prior chat history.
        Subscribers are exempt. Useful for catching spam-bot raids.
      </div>
    </section>
  );
}

function DiscordAlertsSection({
  enabled,
  webhookKey,
  webhooks,
  setEnabled,
  setWebhookKey,
}: {
  enabled: boolean;
  webhookKey: string;
  webhooks: WebhookEntry[];
  setEnabled: (value: boolean) => void;
  setWebhookKey: (value: string) => void;
}) {
  return (
    <section className="mt-4 border border-border bg-bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
          Discord Alerts
        </h3>
        <Toggle value={enabled} onChange={setEnabled} />
      </div>
      <div className="grid grid-cols-2 gap-4 p-4">
        <SelectField
          label="Webhook"
          value={webhookKey}
          onChange={setWebhookKey}
          options={[
            { label: '(none)', value: '' },
            ...webhooks.map((w) => ({ label: w.key, value: w.key })),
          ]}
        />
        <div className="text-[11px] text-text-muted">
          Sends an embed using the <span className="font-mono text-text">moderation</span>{' '}
          template (editable in Webhooks). Vars resolved per action:{' '}
          <span className="font-mono">{'{username}'}</span>,{' '}
          <span className="font-mono">{'{rule}'}</span>,{' '}
          <span className="font-mono">{'{action}'}</span>,{' '}
          <span className="font-mono">{'{message_snippet}'}</span>.
        </div>
      </div>
    </section>
  );
}

// ── Logs tab ───────────────────────────────────────────────────────────────

function LogsTab({
  logPage,
  permitted,
  ruleFilter,
  page,
  permitUserId,
  permitUsername,
  setRuleFilter,
  setPage,
  setPermitUserId,
  setPermitUsername,
  clearAll,
  clearForUser,
  addPermit,
  removePermit,
}: {
  logPage: ModWarningsPage;
  permitted: PermittedUser[];
  ruleFilter: string;
  page: number;
  permitUserId: string;
  permitUsername: string;
  setRuleFilter: (value: string) => void;
  setPage: (next: number | ((prev: number) => number)) => void;
  setPermitUserId: (value: string) => void;
  setPermitUsername: (value: string) => void;
  clearAll: () => Promise<void>;
  clearForUser: (warning: ModWarning) => Promise<void>;
  addPermit: () => Promise<void>;
  removePermit: (userId: string) => Promise<void>;
}) {
  const totalPages = Math.max(1, Math.ceil(logPage.total / logPage.pageSize));
  const fromRow = logPage.total === 0 ? 0 : (page - 1) * logPage.pageSize + 1;
  const toRow = Math.min(page * logPage.pageSize, logPage.total);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-4">
      <section className="flex min-h-0 flex-col overflow-hidden border border-border bg-bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <select
            value={ruleFilter}
            onChange={(e) => setRuleFilter(e.target.value)}
            className="border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
          >
            {RULE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              void clearAll();
            }}
            className="border border-offline/40 bg-offline/10 px-2 py-1.5 text-[10px] uppercase tracking-wider text-offline hover:bg-offline/20"
          >
            Clear all
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
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
              {logPage.warnings.map((warning) => (
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
              {logPage.warnings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-text-dim">
                    No moderation logs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-bg-elev px-4 py-2 font-mono text-[11px] text-text-muted">
          <span>
            {fromRow}–{toRow} of {logPage.total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="border border-border bg-bg px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted hover:bg-bg-hover disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-1">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="border border-border bg-bg px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted hover:bg-bg-hover disabled:opacity-40"
            >
              Next
            </button>
          </div>
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

// ── Primitives ─────────────────────────────────────────────────────────────

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

function CompactSelect({
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
    <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-dim">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-border bg-bg px-1.5 py-0.5 text-[11px] normal-case text-text-muted outline-none focus:border-accent"
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

import { useCallback, useEffect, useState } from 'react';
import { invoke, tryInvoke } from '../lib/ipc';
import { EyeIcon, EyeOffIcon } from './Icons';

interface Credentials {
  clientId: string;
  clientSecret: string;
}

export interface CredentialsCardProps {
  onSaved?: () => void;
  tone?: 'inline' | 'prompt';
}

export function CredentialsCard({ onSaved, tone = 'inline' }: CredentialsCardProps) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showId, setShowId] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [hadCredentials, setHadCredentials] = useState(false);

  const load = useCallback(async () => {
    const res = await tryInvoke<Credentials>('credentials:get');
    if (res.success) {
      setClientId(res.data.clientId);
      setClientSecret(res.data.clientSecret);
      setHadCredentials(
        Boolean(res.data.clientId) && Boolean(res.data.clientSecret),
      );
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke('credentials:set', {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setSavedAt(Date.now());
      setHadCredentials(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const isPrompt = tone === 'prompt';

  return (
    <div
      className={`flex flex-col gap-4 border ${
        isPrompt ? 'border-accent/30' : 'border-border'
      } bg-bg-panel p-5`}
    >
      <div className="space-y-1">
        <h2
          className={`text-xs font-semibold uppercase tracking-[0.18em] ${
            isPrompt ? 'text-accent' : 'text-text'
          }`}
        >
          Twitch application credentials
        </h2>
        <p className="text-xs text-text-dim">
          Register an app at{' '}
          <a
            href="https://dev.twitch.tv/console/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            dev.twitch.tv/console/apps
          </a>{' '}
          as a <span className="font-mono text-text-muted">Confidential</span> client
          with OAuth Redirect URL{' '}
          <span className="font-mono text-text">http://localhost:42817/callback</span>.
          Paste the Client ID and Client Secret below.
        </p>
      </div>

      {!loaded ? (
        <p className="text-xs text-text-dim">Loading…</p>
      ) : (
        <div className="space-y-3">
          <SecretField
            label="Client ID"
            value={clientId}
            onChange={setClientId}
            visible={showId}
            onToggle={() => setShowId((v) => !v)}
            placeholder="30-char alphanumeric"
          />
          <SecretField
            label="Client Secret"
            value={clientSecret}
            onChange={setClientSecret}
            visible={showSecret}
            onToggle={() => setShowSecret((v) => !v)}
            placeholder="30-char alphanumeric"
          />
        </div>
      )}

      {error && (
        <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-dim">
          Stored encrypted via Electron safeStorage. Never sent off this machine.
        </span>
        <div className="flex items-center gap-2">
          {savedAt !== null && Date.now() - savedAt < 2500 && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-live">
              saved
            </span>
          )}
          <button
            onClick={() => void save()}
            disabled={saving || !clientId.trim() || !clientSecret.trim()}
            className="border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {saving ? 'Saving…' : hadCredentials ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SecretField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-text-muted">{label}</span>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full border border-border bg-bg px-2.5 py-1.5 pr-10 font-mono text-xs text-text outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-text-dim hover:text-text"
          title={visible ? 'Hide' : 'Show'}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? (
            <EyeOffIcon width={14} height={14} />
          ) : (
            <EyeIcon width={14} height={14} />
          )}
        </button>
      </div>
    </label>
  );
}

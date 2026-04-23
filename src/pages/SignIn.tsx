import { useCallback, useEffect, useState } from 'react';
import { CredentialsCard } from '../components/CredentialsCard';
import { tryInvoke } from '../lib/ipc';
import { useAppStore } from '../stores/useAppStore';

export function SignIn() {
  const busy = useAppStore((s) => s.busy);
  const error = useAppStore((s) => s.error);
  const login = useAppStore((s) => s.login);

  const [credentialsReady, setCredentialsReady] = useState<boolean | null>(null);

  const checkCredentials = useCallback(async () => {
    const res = await tryInvoke<boolean>('credentials:has');
    if (res.success) setCredentialsReady(res.data);
  }, []);

  useEffect(() => {
    void checkCredentials();
  }, [checkCredentials]);

  const onCredentialsSaved = () => {
    void checkCredentials();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
      <div className="flex w-[520px] flex-col gap-5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center border border-accent/40 bg-accent/10 text-[10px] font-bold text-accent">
            T
          </div>
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
            TwitchBot
          </span>
        </div>

        {credentialsReady === false && (
          <CredentialsCard tone="prompt" onSaved={onCredentialsSaved} />
        )}

        <div className="flex flex-col gap-4 border border-border bg-bg-panel px-6 py-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Sign in with Twitch</h1>
            <p className="text-sm text-text-muted">
              {credentialsReady === false
                ? 'Configure your Twitch application credentials above, then sign in.'
                : 'Connect your channel to start tracking loyalty and running commands.'}
            </p>
          </div>
          <button
            onClick={() => {
              void login();
            }}
            disabled={busy || credentialsReady !== true}
            className="border border-accent bg-accent/10 px-4 py-2.5 text-sm uppercase tracking-wider text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Opening browser…' : 'Connect to Twitch'}
          </button>
          {error && (
            <div className="border border-offline/40 bg-offline/10 px-3 py-2 text-xs text-offline">
              {error}
            </div>
          )}
          <div className="border-t border-border pt-3 text-[11px] leading-relaxed text-text-dim">
            Your access token is encrypted with Electron safeStorage and stored
            only on this machine. This app talks to Twitch directly — no third
            party servers.
          </div>
        </div>

        {credentialsReady === true && (
          <div className="flex items-center justify-between gap-4 border border-border bg-bg-panel px-5 py-3 text-xs text-text-dim">
            <span>Credentials are saved. Need to change them?</span>
            <button
              onClick={() => setCredentialsReady(false)}
              className="text-accent hover:text-accent-hover"
            >
              Edit credentials
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal } from './Modal';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /**
   * If set, the confirm button stays disabled until the user types this exact
   * phrase. Used for irreversible actions.
   */
  requireText?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider.');
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setTyped('');
      setOpts(o);
    });
  }, []);

  const handle = (result: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    setTyped('');
    resolver?.(result);
  };

  const confirmDisabled = Boolean(
    opts?.requireText && typed.trim() !== opts.requireText,
  );

  const confirmClass =
    opts?.tone === 'danger'
      ? 'border-offline bg-offline/20 text-offline hover:bg-offline/30'
      : 'border-accent bg-accent/10 text-accent hover:bg-accent/20';

  useEffect(() => {
    if (!opts) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !confirmDisabled) {
        handle(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [opts, confirmDisabled]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal
          title={opts.title}
          onClose={() => handle(false)}
          width={420}
          footer={
            <>
              <button
                onClick={() => handle(false)}
                className="border border-border bg-bg-panel px-3 py-1.5 text-xs uppercase tracking-wider text-text-muted hover:bg-bg-hover"
              >
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                onClick={() => handle(true)}
                disabled={confirmDisabled}
                className={`border px-3 py-1.5 text-xs uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40 ${confirmClass}`}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm leading-relaxed text-text-muted">
            <div>{opts.message}</div>
            {opts.requireText && (
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-text-dim">
                  Type{' '}
                  <span className="font-mono text-text">{opts.requireText}</span>{' '}
                  to enable the button
                </label>
                <input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={opts.requireText}
                  className="w-full border border-border bg-bg px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent"
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

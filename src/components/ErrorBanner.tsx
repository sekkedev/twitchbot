import { useAppStore } from '../stores/useAppStore';
import { XIcon } from './Icons';

export function ErrorBanner() {
  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 border-b border-offline/40 bg-offline/10 px-6 py-2 text-xs text-offline">
      <span className="flex-1">{error}</span>
      <button
        onClick={() => setError(null)}
        className="text-offline/70 hover:text-offline"
        aria-label="Dismiss error"
      >
        <XIcon width={14} height={14} />
      </button>
    </div>
  );
}

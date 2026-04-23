import { XIcon } from './Icons';
import { useAppStore } from '../stores/useAppStore';

export function NoticeBanner() {
  const notice = useAppStore((s) => s.notice);
  const dismissNotice = useAppStore((s) => s.dismissNotice);
  if (!notice) return null;

  const tone =
    notice.tone === 'success'
      ? 'border-live/40 bg-live/10 text-live'
      : 'border-accent/40 bg-accent/10 text-accent';

  return (
    <div
      className={`pointer-events-auto fixed bottom-6 right-6 z-40 flex items-start gap-3 border px-4 py-2.5 text-xs shadow-lg shadow-black/40 ${tone}`}
      role="status"
    >
      <span className="font-mono">{notice.message}</span>
      <button
        onClick={dismissNotice}
        className="opacity-70 hover:opacity-100"
        aria-label="Dismiss notice"
      >
        <XIcon width={12} height={12} />
      </button>
    </div>
  );
}

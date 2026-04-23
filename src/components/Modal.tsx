import { useEffect } from 'react';
import { XIcon } from './Icons';

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 560,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] flex-col border border-border bg-bg-panel"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-text">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text"
            aria-label="Close"
          >
            <XIcon width={16} height={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-bg px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

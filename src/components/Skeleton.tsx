export function SkeletonBlock({
  width = '100%',
  height = 12,
  className = '',
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  return (
    <span
      className={`inline-block animate-pulse-soft bg-bg-hover ${className}`}
      style={{ width, height }}
      aria-hidden
    />
  );
}

export function SkeletonRows({
  rows = 5,
  columns,
}: {
  rows?: number;
  columns: Array<{ width: number | string; align?: 'left' | 'right' | 'center' }>;
}) {
  return (
    <div role="status" aria-live="polite" className="w-full">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center gap-4 border-t border-border px-4 py-2.5 first:border-t-0"
        >
          {columns.map((col, i) => (
            <div
              key={i}
              className={`flex ${
                col.align === 'right'
                  ? 'justify-end'
                  : col.align === 'center'
                    ? 'justify-center'
                    : 'justify-start'
              }`}
              style={{ width: col.width, flexShrink: 0 }}
            >
              <SkeletonBlock
                width={typeof col.width === 'number' ? Math.max(col.width - 20, 20) : '70%'}
                height={10}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

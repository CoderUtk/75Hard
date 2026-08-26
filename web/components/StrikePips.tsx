export function StrikePips({ used, limit }: { used: number; limit: number }) {
  return (
    // The count label is why this is never colour-only.
    <div className="flex items-center gap-2" aria-label={`${used} of ${limit} strikes used`}>
      <span className="display text-xs text-[var(--color-muted)]">Strikes</span>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: limit }, (_, i) => (
          <span
            key={i}
            className="h-1.5 w-5 rounded-sm"
            style={{ background: i < used ? 'var(--color-primary)' : '#2A3550' }}
          />
        ))}
      </div>
      <span className="tabular text-xs text-[var(--color-muted)]">{used}/{limit}</span>
    </div>
  );
}

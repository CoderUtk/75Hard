import { useState } from 'react';
import { X } from 'lucide-react';
import type { FoodItem } from '../api';

export function BannedListSheet({
  items, strikesUsed, strikeLimit, onClose, onConfirm,
}: {
  items: FoodItem[]; strikesUsed: number; strikeLimit: number;
  onClose: () => void; onConfirm: (item: FoodItem) => void;
}) {
  const [picked, setPicked] = useState<FoodItem | null>(null);
  const cost = strikesUsed + 1;

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Log a slip"
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="w-full rounded-t-2xl border-t border-[var(--color-border)]
                   bg-[var(--color-card)] p-6"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display text-xl">{picked ? 'Confirm' : 'Not-allowed list'}</h2>
          <button onClick={onClose} aria-label="Close" autoFocus><X size={22} aria-hidden /></button>
        </div>

        {!picked && (
          items.length === 0 ? (
            <p className="text-[var(--color-muted)]">Nothing on your not-allowed list yet.</p>
          ) : (
            <div>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setPicked(item)}
                  className="mb-2 flex w-full items-center justify-between rounded-xl border
                             border-[var(--color-border)] bg-[var(--color-background)] p-3 text-left"
                >
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          )
        )}

        {picked && (
          <div>
            <p className="text-lg">
              Log <strong>{picked.name}</strong>? That&rsquo;s strike{' '}
              <span className="tabular">{cost}</span> of <span className="tabular">{strikeLimit}</span>.
            </p>
            <p className="mt-2 text-[var(--color-muted)]">
              A strike, once logged, cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setPicked(null)}
                className="display flex-1 rounded-xl border border-[var(--color-border)] py-3"
              >
                Back
              </button>
              <button
                onClick={() => { onConfirm(picked); onClose(); }}
                className="display flex-1 rounded-xl bg-[var(--color-destructive)] py-3"
              >
                Log it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

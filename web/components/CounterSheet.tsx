import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { Goal } from '../api';

export function CounterSheet({
  goal, initial, onClose, onSave,
}: {
  goal: Goal; initial: number;
  onClose: () => void; onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  const step = goal.kind === 'duration' ? 5 : 1;

  return (
    <div
      role="dialog" aria-modal="true" aria-label={goal.title}
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl border-t border-[var(--color-border)]
                   bg-[var(--color-card)] p-6"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="display text-xl">{goal.title}</h2>
          <button onClick={onClose} aria-label="Close"><X size={22} aria-hidden /></button>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setValue((v) => Math.max(0, v - step))}
            aria-label={`Decrease by ${step}`}
            className="rounded-full bg-[var(--color-background)] p-4"
          >
            <Minus size={24} aria-hidden />
          </button>

          <div className="text-center">
            <div className="tabular display text-5xl">{value}</div>
            <div className="text-sm text-[var(--color-muted)]">
              of {goal.target} {goal.unit ?? ''}
            </div>
          </div>

          <button
            onClick={() => setValue((v) => v + step)}
            aria-label={`Increase by ${step}`}
            className="rounded-full bg-[var(--color-background)] p-4"
          >
            <Plus size={24} aria-hidden />
          </button>
        </div>

        <button
          onClick={() => { onSave(value); onClose(); }}
          className="display mt-6 w-full rounded-xl bg-[var(--color-primary)] py-4 text-lg"
        >
          Save
        </button>
      </div>
    </div>
  );
}

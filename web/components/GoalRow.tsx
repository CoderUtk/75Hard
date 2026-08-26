import { Check } from 'lucide-react';
import type { Goal } from '../api';

export function GoalRow({
  goal, value, editable, onToggle, onOpenSheet,
}: {
  goal: Goal; value: number; editable: boolean;
  onToggle: () => void; onOpenSheet: () => void;
}) {
  const done = value >= goal.target;
  const isCheck = goal.kind === 'check';

  return (
    <button
      onClick={editable ? (isCheck ? onToggle : onOpenSheet) : undefined}
      disabled={!editable}
      aria-pressed={isCheck ? done : undefined}
      className="mb-2 flex w-full items-center gap-3 rounded-xl border
                 border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left
                 transition-colors duration-200 disabled:opacity-60"
    >
      <span
        className="flex h-6 w-6 flex-none items-center justify-center rounded border"
        style={{
          background: done ? 'var(--color-primary)' : 'transparent',
          borderColor: done ? 'var(--color-primary)' : '#3A4459',
        }}
        aria-hidden
      >
        {done && <Check size={16} strokeWidth={3} />}
      </span>

      <span className="flex-1">{goal.title}</span>

      {!isCheck && (
        <span className="tabular text-sm text-[var(--color-muted)]">
          {value}/{goal.target}
        </span>
      )}
    </button>
  );
}

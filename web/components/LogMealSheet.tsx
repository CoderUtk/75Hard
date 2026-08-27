import { useState } from 'react';
import { X } from 'lucide-react';

export function LogMealSheet({
  onClose, onSave,
}: { onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState('');

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Log a meal"
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
          <h2 className="display text-xl">Log a meal</h2>
          <button onClick={onClose} aria-label="Close" autoFocus><X size={22} aria-hidden /></button>
        </div>

        <label className="sr-only" htmlFor="meal-text">What did you eat?</label>
        <textarea
          id="meal-text" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Grilled chicken, rice, salad"
          rows={3}
          className="w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
        />

        <button
          disabled={!text.trim()}
          onClick={() => { onSave(text.trim()); onClose(); }}
          className="display mt-4 w-full rounded-xl bg-[var(--color-primary)] py-4 text-lg disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function Onboarding() {
  const [variant, setVariant] = useState<'hard' | 'soft'>('hard');
  const [startDate, setStartDate] = useState(todayIST());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function start() {
    setBusy(true);
    setError('');
    try {
      await api.onboard(variant, startDate);
      navigate('/today', { replace: true });
    } catch {
      setError('Could not start the run. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <h1 className="display mt-8 text-3xl">Pick your challenge</h1>

      {([
        ['hard', '75 Hard', 'Two 45-minute workouts, one outdoors. 16 glasses of water. 10 pages. Diet. Daily photo.'],
        ['soft', '75 Soft', 'One 45-minute session. 12 glasses of water. 10 pages. Diet.'],
      ] as const).map(([v, title, blurb]) => (
        <button
          key={v}
          onClick={() => setVariant(v)}
          aria-pressed={variant === v}
          className="rounded-xl border p-4 text-left transition-colors duration-200"
          style={{
            borderColor: variant === v ? 'var(--color-primary)' : 'var(--color-border)',
            background: 'var(--color-card)',
          }}
        >
          <div className="display text-xl">{title}</div>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{blurb}</p>
        </button>
      ))}

      <label className="flex flex-col gap-2">
        <span className="display text-xs text-[var(--color-muted)]">Start date</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-base"
        />
      </label>

      <p className="text-sm text-[var(--color-muted)]">
        Every goal you miss is a strike. Three strikes and you go back to Day 1.
        You can edit your goals any time — changes apply from today forward.
      </p>

      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}

      <button
        onClick={start}
        disabled={busy}
        className="display mt-auto rounded-xl bg-[var(--color-primary)] py-4 text-lg
                   disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start Day 1'}
      </button>
    </main>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError } from '../api';
import { BottomNav } from '../components/BottomNav';

export function PinChange() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit() {
    setError('');
    setDone(false);
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) {
      setError('PINs must be 4 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('New PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePin(currentPin, newPin);
      setDone(true);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.message === 'wrong current pin') {
        setError('Current PIN is wrong.');
      } else if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    } finally {
      setBusy(false);
    }
  }

  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 4);

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <button
          onClick={() => navigate('/me')}
          aria-label="Back to Me"
          className="mb-2 flex items-center gap-1 text-[var(--color-muted)]"
        >
          <ArrowLeft size={18} aria-hidden /> Me
        </button>
        <h1 className="display text-3xl">Change PIN</h1>

        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-border)] p-4">
          <label className="display block text-xs text-[var(--color-muted)]" htmlFor="current-pin">
            Current PIN
          </label>
          <input
            id="current-pin" type="password" inputMode="numeric" maxLength={4}
            value={currentPin} onChange={(e) => setCurrentPin(digitsOnly(e.target.value))}
            className="tabular mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />

          <label className="display mt-4 block text-xs text-[var(--color-muted)]" htmlFor="new-pin">
            New PIN
          </label>
          <input
            id="new-pin" type="password" inputMode="numeric" maxLength={4}
            value={newPin} onChange={(e) => setNewPin(digitsOnly(e.target.value))}
            className="tabular mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />

          <label className="display mt-4 block text-xs text-[var(--color-muted)]" htmlFor="confirm-pin">
            Confirm new PIN
          </label>
          <input
            id="confirm-pin" type="password" inputMode="numeric" maxLength={4}
            value={confirmPin} onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
            className="tabular mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />

          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}
          {done && <p className="mt-2 text-sm text-[var(--color-success)]">PIN changed.</p>}

          <button onClick={submit} disabled={busy}
            className="display mt-4 w-full rounded-lg bg-[var(--color-primary)] py-3 disabled:opacity-50">
            {busy ? 'Saving…' : 'Change PIN'}
          </button>
        </div>
      </main>
      <BottomNav />
    </>
  );
}

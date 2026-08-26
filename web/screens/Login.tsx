import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete } from 'lucide-react';
import { api, ApiError, type PublicUser } from '../api';

export function Login() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [picked, setPicked] = useState<PublicUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { api.users().then(setUsers).catch(() => setError('Could not load users.')); }, []);

  useEffect(() => {
    if (pin.length !== 4 || !picked || busy) return;
    setBusy(true);
    api.login(picked.id, pin)
      .then(() => navigate('/today', { replace: true }))
      .catch((e: ApiError) => {
        setError(e.status === 429
          ? 'Too many attempts. Locked for 15 minutes.'
          : 'Wrong PIN.');
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin, picked, busy, navigate]);

  if (!picked) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="display mb-4 text-3xl">Who's training?</h1>
        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        {users.map((u) => (
          <button
            key={u.id}
            onClick={() => { setPicked(u); setError(''); }}
            className="flex items-center gap-3 rounded-xl border border-[var(--color-border)]
                       bg-[var(--color-card)] p-4 text-left transition-colors duration-200"
          >
            <span className="h-6 w-6 rounded-lg" style={{ background: u.color }} aria-hidden />
            <span className="text-lg">{u.name}</span>
          </button>
        ))}
      </main>
    );
  }

  const press = (d: string) => setPin((p) => (p.length < 4 ? p + d : p));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <button
        onClick={() => { setPicked(null); setPin(''); setError(''); }}
        className="display self-start text-xs text-[var(--color-muted)]"
      >
        ← Not {picked.name}
      </button>

      <h1 className="display text-3xl">Enter PIN</h1>

      <div className="flex gap-3" aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-4 w-4 rounded-full border border-[var(--color-border)]"
            style={{ background: i < pin.length ? 'var(--color-primary)' : 'transparent' }}
          />
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {['1','2','3','4','5','6','7','8','9'].map((d) => (
          <button key={d} onClick={() => press(d)}
            className="tabular rounded-xl bg-[var(--color-card)] py-4 text-2xl">{d}</button>
        ))}
        <span />
        <button onClick={() => press('0')}
          className="tabular rounded-xl bg-[var(--color-card)] py-4 text-2xl">0</button>
        <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete last digit"
          className="flex items-center justify-center rounded-xl bg-[var(--color-card)]">
          <Delete size={22} aria-hidden />
        </button>
      </div>
    </main>
  );
}

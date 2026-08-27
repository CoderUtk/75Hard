import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type FamilyMember } from '../api';
import { StrikePips } from '../components/StrikePips';
import { BottomNav } from '../components/BottomNav';

export function Family() {
  const [members, setMembers] = useState<FamilyMember[] | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.family().then((m) => { setMembers(m); setError(''); }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    });
  }, [navigate]);

  if (!members) {
    return (
      <main className="grid min-h-dvh place-items-center text-[var(--color-muted)]">
        Loading…
      </main>
    );
  }

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <h1 className="display mt-4 text-3xl">Family</h1>
        {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}

        <div className="mt-5">
          {members.map((m) => (
            <div key={m.id}
              className="mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-center gap-3">
                <span className="h-6 w-6 rounded-lg" style={{ background: m.color }} aria-hidden />
                <span className="flex-1 text-lg">{m.name}</span>
                <span className="display text-xs text-[var(--color-muted)]">
                  {m.status === 'active'
                    ? `75 ${m.variant === 'hard' ? 'Hard' : 'Soft'} · Attempt ${m.attemptNo}`
                    : 'Not active'}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="display text-2xl">
                  {m.dayNumber !== null
                    ? <>Day <span className="tabular text-[var(--color-primary)]">{m.dayNumber}</span></>
                    : <span className="text-[var(--color-muted)]">—</span>}
                </span>
                <StrikePips used={m.strikes} limit={m.strikeLimit} />
              </div>

              <div className="mt-2 text-xs text-[var(--color-muted)]">
                Best day: <span className="tabular">{m.bestDay ?? '—'}</span>
              </div>
            </div>
          ))}
        </div>
      </main>
      <BottomNav />
    </>
  );
}

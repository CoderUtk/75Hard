import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError, type Run } from '../api';
import { BottomNav } from '../components/BottomNav';

export function History() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.history().then((r) => { setRuns(r); setError(''); }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    });
  }, [navigate]);

  const label = (status: Run['status']) =>
    status === 'active' ? 'In progress' : status === 'done' ? '75 done' : 'Ended early';
  const color = (status: Run['status']) =>
    status === 'done' ? 'var(--color-success)'
      : status === 'failed' ? 'var(--color-destructive)' : 'var(--color-muted)';

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
        <h1 className="display text-3xl">Run history</h1>

        {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}

        {runs === null ? null : runs.length === 0 ? (
          <p className="mt-4 text-[var(--color-muted)]">No runs yet.</p>
        ) : (
          <div className="mt-5">
            {runs.map((r) => (
              <div key={r.id}
                className="mb-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                <div className="flex items-center justify-between">
                  <span>Attempt {r.attempt_no} · {r.variant === 'hard' ? 'Hard' : 'Soft'}</span>
                  <span className="display text-xs" style={{ color: color(r.status) }}>
                    {label(r.status)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  Started {r.start_date}{r.ended_date ? ` · ended ${r.ended_date}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}

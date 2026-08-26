import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type MeView } from '../api';

export function RunOver() {
  const [me, setMe] = useState<MeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.me().then((m) => {
      // An active run means we should not be here.
      if (m.run) return navigate('/today', { replace: true });
      if (m.needsOnboarding) return navigate('/onboarding', { replace: true });
      setMe(m);
    }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    });
  }, [navigate]);

  if (!me) return <main className="grid min-h-dvh place-items-center">…</main>;

  const attempt = me.lastRun?.attempt_no ?? 1;
  // A finished run and a failed run are opposite outcomes. They must never
  // share a screen — see spec §5.5.
  const finished = me.lastRun?.status === 'done';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6 text-center">
      <h1
        className="display text-5xl"
        style={{ color: finished ? 'var(--color-success)' : 'var(--color-destructive)' }}
      >
        {finished ? '75 done' : 'Run over'}
      </h1>
      <p className="text-lg">
        {finished
          ? `Attempt ${attempt} went the full 75 days.`
          : `Attempt ${attempt} ended after three strikes.`}
      </p>
      <p className="text-[var(--color-muted)]">
        Nothing is deleted. Your goals and food lists carry over.
      </p>
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api.reset();
            navigate('/today', { replace: true });
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not reach the server');
          } finally {
            setBusy(false);
          }
        }}
        className="display mt-4 rounded-xl bg-[var(--color-primary)] py-4 text-lg disabled:opacity-50"
      >
        {busy ? 'Starting…' : `Start attempt ${attempt + 1}`}
      </button>
    </main>
  );
}

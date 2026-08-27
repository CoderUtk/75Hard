import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type FoodItem, type FoodLogEntry, type MeView } from '../api';
import { LogMealSheet } from '../components/LogMealSheet';
import { BannedListSheet } from '../components/BannedListSheet';
import { BottomNav } from '../components/BottomNav';

export function Food() {
  const [me, setMe] = useState<MeView | null>(null);
  const [entries, setEntries] = useState<FoodLogEntry[] | null>(null);
  const [items, setItems] = useState<FoodItem[]>([]);
  const [mealSheet, setMealSheet] = useState(false);
  const [bannedSheet, setBannedSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setError(null);
      if (m.needsOnboarding) return navigate('/onboarding', { replace: true });
      if (!m.run) return navigate('/run-over', { replace: true });
      // The diary date always comes from the server's today, never the
      // device clock — see the global constraints.
      const date = m.today!.date;
      const [log, foodItems] = await Promise.all([api.foodLog(date), api.foodItems()]);
      setEntries(log);
      setItems(foodItems);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    }
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  async function saveMeal(text: string) {
    let failure: string | null = null;
    try {
      await api.logMeal(text);
    } catch (e) {
      failure = e instanceof ApiError ? e.message : 'Could not reach the server';
    }
    await load();
    if (failure) setError(failure);
  }

  async function confirmSlip(item: FoodItem) {
    try {
      const result = await api.logSlip(item.id);
      if (result.runFailed) {
        navigate('/run-over', { replace: true });
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server');
    }
  }

  if (!me?.run || !entries) {
    return <main className="grid min-h-dvh place-items-center text-[var(--color-muted)]">Loading…</main>;
  }

  const banned = items.filter((i) => i.status === 'banned');
  const allowed = items.filter((i) => i.status === 'allowed');

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <h1 className="display mt-4 text-3xl">Food</h1>

        {error && <p role="alert" className="mt-3 text-[var(--color-destructive)]">{error}</p>}

        <div className="mt-4">
          {entries.length === 0 && (
            <p className="text-[var(--color-muted)]">Nothing logged yet today.</p>
          )}
          {entries.map((e) => (
            <div
              key={e.id}
              className="mb-2 rounded-xl border p-3"
              style={{
                borderColor: e.kind === 'slip' ? 'var(--color-destructive)' : 'var(--color-border)',
                background: 'var(--color-card)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: e.kind === 'slip' ? 'var(--color-destructive)' : undefined }}>
                  {e.text}
                </span>
                {e.kind === 'slip' && (
                  <span className="display flex-none text-xs text-[var(--color-destructive)]">
                    +1 strike
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setMealSheet(true)}
          className="display mt-4 w-full rounded-xl bg-[var(--color-primary)] py-4 text-lg"
        >
          Log a meal
        </button>
        <button
          onClick={() => setBannedSheet(true)}
          className="display mt-3 w-full rounded-xl border border-[var(--color-destructive)]
                     py-3 text-[var(--color-destructive)]"
        >
          Log a slip
        </button>

        <div className="mt-6 flex gap-3">
          <Link to="/food/allowed"
            className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <div className="display text-xs text-[var(--color-muted)]">Allowed</div>
            <div className="tabular text-2xl">{allowed.length}</div>
          </Link>
          <Link to="/food/banned"
            className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <div className="display text-xs text-[var(--color-muted)]">Not allowed</div>
            <div className="tabular text-2xl">{banned.length}</div>
          </Link>
        </div>
      </main>

      {mealSheet && <LogMealSheet onClose={() => setMealSheet(false)} onSave={saveMeal} />}
      {bannedSheet && (
        <BannedListSheet
          items={banned}
          strikesUsed={me.strikes?.used ?? 0}
          strikeLimit={me.strikes?.limit ?? 3}
          onClose={() => setBannedSheet(false)}
          onConfirm={confirmSlip}
        />
      )}

      <BottomNav />
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type DayView, type Goal, type MeView } from '../api';
import { GoalRow } from '../components/GoalRow';
import { CounterSheet } from '../components/CounterSheet';
import { StrikePips } from '../components/StrikePips';
import { BottomNav } from '../components/BottomNav';

/** Pure calendar shift on a YYYY-MM-DD string. No clock, no timezone — the
 *  date it shifts always came from the server. */
const shiftDate = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
       + `-${String(t.getUTCDate()).padStart(2, '0')}`;
};

const istHour = () =>
  Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date()));

export function Today() {
  const [me, setMe] = useState<MeView | null>(null);
  // `date` and `serverToday` both come from the server. The device clock is
  // never allowed to decide which day the user is writing to: a skewed phone
  // would post today's work onto yesterday's row (still editable until noon),
  // leaving today empty and earning a strike per goal for work actually done.
  const [serverToday, setServerToday] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<DayView | null>(null);
  const [sheet, setSheet] = useState<Goal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const m = await api.me();
      if (seq !== loadSeq.current) return;
      setMe(m);
      setError(null);
      if (m.needsOnboarding) return navigate('/onboarding', { replace: true });
      if (!m.run) return navigate('/run-over', { replace: true });
      setServerToday(m.today?.date ?? null);
      const target = date ?? m.today?.date;
      if (!target) {
        setError('The server did not report a current date.');
        return;
      }
      const d = await api.day(target);
      if (seq !== loadSeq.current) return;
      // Only on the first load, where `date` is still null — assigning the
      // same string back would re-run this effect for nothing.
      if (date === null) setDate(d.date);
      setDay(d);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    }
  }, [date, navigate]);

  useEffect(() => { void load(); }, [load]);

  async function write(goalId: string, value: number) {
    if (!day || !date) return;
    // Optimistic, then reconcile — a grading pass may have ended the run.
    setDay((d) => d && { ...d, progress: { ...d.progress, [goalId]: value } });
    let failure: string | null = null;
    try {
      await api.setProgress(date, goalId, value);
    } catch (e) {
      failure = e instanceof ApiError ? e.message : 'Could not reach the server';
    }
    // Reconcile first: load() clears `error` on success, so surface the
    // write failure afterwards or it would be wiped before the user sees it.
    await load();
    if (failure) setError(failure);
  }

  if (!me?.run || !day || !date || !serverToday) {
    return <main className="grid min-h-dvh place-items-center text-[var(--color-muted)]">Loading…</main>;
  }

  // Only decides whether to OFFER the yesterday view; the server is the
  // authority on whether the write is accepted (`day.editable`).
  const graceOpen = istHour() < 12;
  const yesterday = shiftDate(serverToday, -1);
  const viewingToday = date === serverToday;
  const canShowYesterday = graceOpen && yesterday >= me.run.start_date;

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <div className="flex items-start justify-between">
          <div>
            <div className="display text-xs text-[var(--color-muted)]">
              75 {me.run.variant === 'hard' ? 'Hard' : 'Soft'} · {me.user.name}
            </div>
            <div className="display text-5xl">
              Day <span className="tabular text-[var(--color-primary)]">{day.dayNumber}</span>
            </div>
          </div>
          <StrikePips used={me.strikes?.used ?? 0} limit={me.strikes?.limit ?? 3} />
        </div>

        {(canShowYesterday || !viewingToday) && (
          <button
            onClick={() => { setDay(null); setDate(viewingToday ? yesterday : serverToday); }}
            className="display mt-3 w-full rounded-xl border border-[var(--color-primary)]
                       py-3 text-xs text-[var(--color-primary)]"
          >
            {viewingToday ? 'Yesterday — locks at 12:00' : 'Back to today'}
          </button>
        )}

        {error && (
          <p role="alert" className="mt-3 text-[var(--color-destructive)]">
            {error}
          </p>
        )}

        {!day.editable && (
          <p className="mt-3 text-[var(--color-muted)]">
            This day is locked. {day.state === 'failed' ? 'Goals were missed.' : 'All goals met.'}
          </p>
        )}

        <div className="mt-4">
          {day.goals.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              value={day.progress[g.id] ?? 0}
              editable={day.editable}
              onToggle={() => write(g.id, (day.progress[g.id] ?? 0) >= g.target ? 0 : g.target)}
              onOpenSheet={() => setSheet(g)}
            />
          ))}
        </div>
      </main>

      {sheet && (
        <CounterSheet
          goal={sheet}
          initial={day.progress[sheet.id] ?? 0}
          onClose={() => setSheet(null)}
          onSave={(v) => write(sheet.id, v)}
        />
      )}

      <BottomNav />
    </>
  );
}

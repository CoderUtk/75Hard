import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type DayView, type Goal, type MeView } from '../api';
import { GoalRow } from '../components/GoalRow';
import { CounterSheet } from '../components/CounterSheet';
import { StrikePips } from '../components/StrikePips';
import { BottomNav } from '../components/BottomNav';

const istDate = (offsetDays = 0) => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number) as [number, number, number];
  return fmt.format(new Date(Date.UTC(y, m - 1, d + offsetDays, 12)));
};

const istHour = () =>
  Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date()));

export function Today() {
  const [me, setMe] = useState<MeView | null>(null);
  const [date, setDate] = useState(istDate());
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
      const d = await api.day(date);
      if (seq !== loadSeq.current) return;
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
    if (!day) return;
    // Optimistic, then reconcile — a grading pass may have ended the run.
    setDay((d) => d && { ...d, progress: { ...d.progress, [goalId]: value } });
    try {
      await api.setProgress(date, goalId, value);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server');
    } finally {
      await load();
    }
  }

  if (!me?.run || !day) {
    return <main className="grid min-h-dvh place-items-center text-[var(--color-muted)]">Loading…</main>;
  }

  const graceOpen = istHour() < 12;
  const yesterday = istDate(-1);
  const viewingToday = date === istDate();
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
            onClick={() => { setDay(null); setDate(viewingToday ? yesterday : istDate()); }}
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

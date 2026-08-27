import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, ArrowLeft } from 'lucide-react';
import { api, ApiError, type Goal, type GoalKind } from '../api';
import { BottomNav } from '../components/BottomNav';

const KINDS: { kind: GoalKind; label: string; unit: string | null; target: number }[] = [
  { kind: 'check',    label: 'Done / not done', unit: null,      target: 1 },
  { kind: 'count',    label: 'Counter',         unit: 'times',   target: 1 },
  { kind: 'duration', label: 'Minutes',         unit: 'min',     target: 30 },
];

export function GoalsEditor() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState('');
  const [kindIdx, setKindIdx] = useState(0);
  const [target, setTarget] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = () =>
    api.goals().then((g) => { setGoals(g); setError(''); }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    });
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function add() {
    const preset = KINDS[kindIdx]!;
    if (!title.trim()) return setError('Give the goal a name.');
    if (target < 1) return setError('Target must be at least 1.');
    setError('');
    setBusy(true);
    try {
      await api.addGoal({
        title: title.trim(), kind: preset.kind,
        target: preset.kind === 'check' ? 1 : target, unit: preset.unit,
      });
      setTitle('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: Goal) {
    let failure: string | null = null;
    try {
      await api.deleteGoal(g.id);
    } catch (e) {
      failure = e instanceof ApiError ? e.message : 'Could not reach the server';
    }
    // Reconcile first: load() clears `error` on success, so surface the
    // delete failure afterwards or it would be wiped before the user sees it.
    await load();
    if (failure) setError(failure);
  }

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
        <h1 className="display mt-4 text-3xl">My goals</h1>
        <p className="mt-1 text-[var(--color-muted)]">
          Changes apply from today forward. Past days keep the goals they were graded against.
        </p>

        <div className="mt-5">
          {goals.map((g) => (
            <div key={g.id}
              className="mb-2 flex items-center gap-3 rounded-xl border
                         border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <span className="flex-1">{g.title}</span>
              <span className="tabular text-sm text-[var(--color-muted)]">
                {g.kind === 'check' ? '—' : `${g.target} ${g.unit ?? ''}`}
              </span>
              <button
                onClick={() => remove(g)}
                aria-label={`Remove ${g.title}`}
                className="text-[var(--color-destructive)]"
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-border)] p-4">
          <label className="display block text-xs text-[var(--color-muted)]" htmlFor="goal-title">
            New goal
          </label>
          <input
            id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Meditate"
            className="mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />

          <div className="mt-3 flex gap-2">
            {KINDS.map((k, i) => (
              <button
                key={k.kind} onClick={() => { setKindIdx(i); setTarget(k.target); }}
                aria-pressed={kindIdx === i}
                className="display flex-1 rounded-lg py-2 text-xs"
                style={{
                  background: kindIdx === i ? 'var(--color-primary)' : 'var(--color-background)',
                }}
              >
                {k.label}
              </button>
            ))}
          </div>

          {KINDS[kindIdx]!.kind !== 'check' && (
            <label className="mt-3 flex items-center gap-3">
              <span className="text-sm text-[var(--color-muted)]">Target</span>
              <input
                type="number" min={1} inputMode="numeric" value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                className="tabular w-24 rounded-lg bg-[var(--color-background)] p-2 text-base"
              />
              <span className="text-sm text-[var(--color-muted)]">{KINDS[kindIdx]!.unit}</span>
            </label>
          )}

          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}

          <button onClick={add} disabled={busy}
            className="display mt-4 w-full rounded-lg bg-[var(--color-primary)] py-3 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add goal'}
          </button>
        </div>
      </main>
      <BottomNav />
    </>
  );
}

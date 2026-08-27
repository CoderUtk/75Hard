import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2, ArrowLeft } from 'lucide-react';
import { api, ApiError, type FoodItem } from '../api';
import { BottomNav } from '../components/BottomNav';

export function FoodListEditor() {
  const { status: param } = useParams<{ status: string }>();
  const status: 'allowed' | 'banned' = param === 'banned' ? 'banned' : 'allowed';
  const [items, setItems] = useState<FoodItem[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = () =>
    api.foodItems().then((all) => {
      setItems(all.filter((i) => i.status === status));
      setError('');
    }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        navigate('/login', { replace: true });
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [status]);

  async function add() {
    if (!name.trim()) return setError('Give it a name.');
    setError('');
    setBusy(true);
    try {
      await api.addFoodItem(name.trim(), status);
      setName('');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('Already on your list.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: FoodItem) {
    let failure: string | null = null;
    try {
      await api.deleteFoodItem(item.id);
    } catch (e) {
      failure = e instanceof ApiError ? e.message : 'Could not reach the server';
    }
    await load();
    if (failure) setError(failure);
  }

  const title = status === 'banned' ? 'Not allowed' : 'Allowed';

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <button
          onClick={() => navigate('/food')}
          aria-label="Back to Food"
          className="mb-2 flex items-center gap-1 text-[var(--color-muted)]"
        >
          <ArrowLeft size={18} aria-hidden /> Food
        </button>
        <h1 className="display text-3xl">{title}</h1>

        <div className="mt-5">
          {items.map((item) => (
            <div key={item.id}
              className="mb-2 flex items-center gap-3 rounded-xl border
                         border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <span className="flex-1">{item.name}</span>
              <button
                onClick={() => remove(item)}
                aria-label={`Remove ${item.name}`}
                className="text-[var(--color-destructive)]"
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-border)] p-4">
          <label className="display block text-xs text-[var(--color-muted)]" htmlFor="item-name">
            Add to {title.toLowerCase()}
          </label>
          <input
            id="item-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ice cream"
            className="mt-2 w-full rounded-lg bg-[var(--color-background)] p-3 text-base"
          />
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{error}</p>}
          <button onClick={add} disabled={busy}
            className="display mt-4 w-full rounded-lg bg-[var(--color-primary)] py-3 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </main>
      <BottomNav />
    </>
  );
}

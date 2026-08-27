import { useNavigate } from 'react-router-dom';
import { ChevronRight, Target, Check, Ban, History as HistoryIcon, KeyRound, LogOut } from 'lucide-react';
import { api } from '../api';
import { BottomNav } from '../components/BottomNav';

const LINKS = [
  { to: '/me/goals', label: 'My goals', Icon: Target },
  { to: '/food/allowed', label: 'Allowed foods', Icon: Check },
  { to: '/food/banned', label: 'Not-allowed foods', Icon: Ban },
  { to: '/me/history', label: 'Run history', Icon: HistoryIcon },
  { to: '/me/pin', label: 'Change PIN', Icon: KeyRound },
] as const;

export function Me() {
  const navigate = useNavigate();

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <h1 className="display mt-4 text-3xl">Me</h1>

        <div className="mt-5">
          {LINKS.map(({ to, label, Icon }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="mb-2 flex w-full items-center gap-3 rounded-xl border
                         border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left"
            >
              <Icon size={20} aria-hidden />
              <span className="flex-1">{label}</span>
              <ChevronRight size={18} aria-hidden className="text-[var(--color-muted)]" />
            </button>
          ))}
        </div>

        <button
          onClick={async () => { await api.logout(); navigate('/login', { replace: true }); }}
          className="display mt-8 flex w-full items-center justify-center gap-2 rounded-xl
                     border border-[var(--color-destructive)] py-3 text-sm
                     text-[var(--color-destructive)]"
        >
          <LogOut size={16} aria-hidden /> Log out
        </button>
      </main>
      <BottomNav />
    </>
  );
}

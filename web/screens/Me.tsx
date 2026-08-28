import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Target, Check, Ban, History as HistoryIcon, KeyRound, LogOut, Bell } from 'lucide-react';
import { api } from '../api';
import { BottomNav } from '../components/BottomNav';
import { pushState, enablePush, disablePush, type PushState } from '../lib/push';
import { InstallCard } from '../components/InstallCard';

const LINKS = [
  { to: '/me/goals', label: 'My goals', Icon: Target },
  { to: '/food/allowed', label: 'Allowed foods', Icon: Check },
  { to: '/food/banned', label: 'Not-allowed foods', Icon: Ban },
  { to: '/me/history', label: 'Run history', Icon: HistoryIcon },
  { to: '/me/pin', label: 'Change PIN', Icon: KeyRound },
] as const;

export function Me() {
  const navigate = useNavigate();

  const [push, setPush] = useState<PushState>('unsupported');
  const [pushErr, setPushErr] = useState('');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => { pushState().then(setPush).catch(() => setPush('unsupported')); }, []);

  async function togglePush() {
    setPushErr('');
    setPushBusy(true);
    try {
      if (push === 'subscribed') { await disablePush(); }
      else { await enablePush(); }
      setPush(await pushState());
    } catch (e) {
      setPushErr(e instanceof Error ? e.message : 'Could not change reminders.');
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <>
      <main className="mx-auto max-w-md p-4 pb-28">
        <h1 className="display mt-4 text-3xl">Me</h1>

        {push !== 'unsupported' && (
          <div className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div className="flex items-center gap-3">
              <Bell size={20} aria-hidden />
              <span className="flex-1">Daily reminders</span>
              <button
                onClick={togglePush}
                disabled={pushBusy || push === 'denied'}
                className="display rounded-lg border border-[var(--color-border)] px-3 py-1 text-sm
                           disabled:opacity-50"
              >
                {push === 'subscribed' ? 'On' : 'Off'}
              </button>
            </div>
            {push === 'denied' && (
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Turn on notifications for this site in your browser settings.
              </p>
            )}
            {pushErr && (
              <p role="alert" className="mt-2 text-sm text-[var(--color-destructive)]">{pushErr}</p>
            )}
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Reminders only reach an installed app — add 75 Hard to your Home Screen.
            </p>
          </div>
        )}

        <div className="mt-3">
          <InstallCard />
        </div>

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

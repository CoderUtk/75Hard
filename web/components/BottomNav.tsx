import { NavLink } from 'react-router-dom';
import { CalendarCheck, Utensils, Users, User } from 'lucide-react';

const items = [
  { to: '/today',  label: 'Today',  Icon: CalendarCheck, enabled: true },
  { to: '/food',   label: 'Food',   Icon: Utensils,      enabled: true },
  { to: '/family', label: 'Family', Icon: Users,         enabled: false },
  { to: '/me',     label: 'Me',     Icon: User,          enabled: true },
];

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 flex justify-around border-t
                 border-[var(--color-border)] bg-[var(--color-background)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map(({ to, label, Icon, enabled }) =>
        enabled ? (
          <NavLink
            key={to} to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2 display text-[10px] ${
                isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted)]'
              }`
            }
          >
            <Icon size={20} aria-hidden />
            {label}
          </NavLink>
        ) : (
          <span
            key={to} aria-disabled="true"
            className="flex flex-1 flex-col items-center gap-1 py-2 display text-[10px]
                       text-[var(--color-muted)] opacity-40"
          >
            <Icon size={20} aria-hidden />
            {label}
          </span>
        ),
      )}
    </nav>
  );
}

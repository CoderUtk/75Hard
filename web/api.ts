export type PublicUser = { id: string; name: string; color: string };
export type GoalKind = 'check' | 'count' | 'duration';
export type Goal = {
  id: string; title: string; kind: GoalKind; target: number; unit: string | null;
};
export type DayView = {
  date: string; dayNumber: number; state: 'open' | 'passed' | 'failed';
  editable: boolean; goals: Goal[]; progress: Record<string, number>;
};
export type Run = {
  id: string; variant: 'hard' | 'soft'; attempt_no: number;
  start_date: string; status: 'active' | 'failed' | 'done'; ended_date: string | null;
};
export type MeView = {
  user: PublicUser;
  run: Run | null;
  needsOnboarding: boolean;
  lastRun?: Run | null;
  today?: Omit<DayView, 'editable'>;
  strikes?: { used: number; limit: number };
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json<{ error?: string }>().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json<T>();
}

export const api = {
  users: () => call<PublicUser[]>('/api/auth/users'),
  login: (userId: string, pin: string) =>
    call<PublicUser>('/api/auth/login', { method: 'POST', body: JSON.stringify({ userId, pin }) }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  me: () => call<MeView>('/api/me'),
  onboard: (variant: 'hard' | 'soft', startDate: string) =>
    call<Run>('/api/onboarding', { method: 'POST', body: JSON.stringify({ variant, startDate }) }),
  reset: () => call<Run>('/api/run/reset', { method: 'POST', body: '{}' }),

  day: (date: string) => call<DayView>(`/api/days/${date}`),
  setProgress: (date: string, goalId: string, value: number) =>
    call<{ ok: true }>(`/api/days/${date}/goals/${goalId}`, {
      method: 'PUT', body: JSON.stringify({ value }),
    }),

  goals: () => call<Goal[]>('/api/goals'),
  addGoal: (g: Omit<Goal, 'id'>) =>
    call<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(g) }),
  deleteGoal: (id: string) =>
    call<{ ok: true }>(`/api/goals/${id}`, { method: 'DELETE' }),
};

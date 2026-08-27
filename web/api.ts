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

export type FoodItem = { id: string; name: string; status: 'allowed' | 'banned' };
export type FoodLogEntry = {
  id: string; date: string; kind: 'meal' | 'slip';
  text: string | null; food_item_id: string | null; at: number;
};
export type SlipResult = { log: FoodLogEntry; strikeCount: number; limit: number; runFailed: boolean };

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

  foodItems: () => call<FoodItem[]>('/api/food/items'),
  addFoodItem: (name: string, status: 'allowed' | 'banned') =>
    call<FoodItem>('/api/food/items', { method: 'POST', body: JSON.stringify({ name, status }) }),
  updateFoodItem: (id: string, name: string, status: 'allowed' | 'banned') =>
    call<{ ok: true }>(`/api/food/items/${id}`, { method: 'PATCH', body: JSON.stringify({ name, status }) }),
  deleteFoodItem: (id: string) => call<{ ok: true }>(`/api/food/items/${id}`, { method: 'DELETE' }),

  foodLog: (date: string) => call<FoodLogEntry[]>(`/api/food/log?date=${date}`),
  logMeal: (text: string) =>
    call<{ log: FoodLogEntry }>('/api/food/log', {
      method: 'POST', body: JSON.stringify({ kind: 'meal', text }),
    }),
  logSlip: (foodItemId: string) =>
    call<SlipResult>('/api/food/log', {
      method: 'POST', body: JSON.stringify({ kind: 'slip', foodItemId }),
    }),
  deleteFoodLog: (id: string) => call<{ ok: true }>(`/api/food/log/${id}`, { method: 'DELETE' }),
};

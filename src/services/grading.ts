import {
  todayIST, istMinutes, addDays, dayNumber, datesBetween, LOCK_HOUR_MINUTES,
} from '../lib/dates';
import { gradeDay, isRunOver, type GoalSnapshot } from '../lib/rules';
import { getActiveRun, failRun, type RunRow } from '../db/runs';
import { listActiveGoals, toSnapshot } from '../db/goals';
import {
  getDay, createDay, listUnlockedDays, lockDay, getProgress, type DayRow,
} from '../db/days';
import { addStrikes, countStrikes } from '../db/strikes';

/** The most recent date whose lock window has closed.
 *  Day D locks at 12:00 IST on D+1, so before noon only D-2 is gradable. */
export function lastGradableDate(now: Date): string {
  const today = todayIST(now);
  return istMinutes(now) >= LOCK_HOUR_MINUTES ? addDays(today, -1) : addDays(today, -2);
}

/** Fetch a day row, creating it from the user's current goals if absent. */
export async function ensureDay(
  db: D1Database, run: RunRow, date: string, userId: string, _now: Date,
): Promise<DayRow> {
  const existing = await getDay(db, run.id, date);
  if (existing) return existing;
  const snapshot: GoalSnapshot[] = toSnapshot(await listActiveGoals(db, userId));
  return createDay(db, run.id, date, dayNumber(run.start_date, date), snapshot);
}

/**
 * Materialise every missing day up to yesterday, then grade every unlocked
 * day whose lock window has closed. Safe to call concurrently and repeatedly:
 * `lockDay` only acts on rows where `locked_at IS NULL`.
 */
export async function catchUpGrading(
  db: D1Database, userId: string, now: Date,
): Promise<{ runFailed: boolean }> {
  const run = await getActiveRun(db, userId);
  if (!run) return { runFailed: false };

  const today = todayIST(now);
  if (run.start_date > today) return { runFailed: false };

  // 1. Materialise gaps. Up to yesterday — today's row is created on demand
  //    so that a same-day goal edit is reflected in its snapshot.
  const yesterday = addDays(today, -1);
  if (run.start_date <= yesterday) {
    for (const date of datesBetween(run.start_date, yesterday)) {
      await ensureDay(db, run, date, userId, now);
    }
  }

  // 2. Grade everything whose window has closed, oldest first.
  const cutoff = lastGradableDate(now);
  if (cutoff < run.start_date) return { runFailed: false };

  const at = now.getTime();
  for (const day of await listUnlockedDays(db, run.id, cutoff)) {
    const snapshot = JSON.parse(day.goals_snapshot) as GoalSnapshot[];
    const progress = await getProgress(db, day.id);
    const grade = gradeDay(snapshot, progress);

    // Claim the day first. If another pass already locked it, skip entirely
    // so its strikes are never appended twice.
    const claimed = await lockDay(db, day.id, grade.state, at);
    if (!claimed) continue;

    if (grade.missedGoalIds.length > 0) {
      await addStrikes(db, run.id, day.date, 'missed_goal', grade.missedGoalIds, at);
    }

    if (isRunOver(await countStrikes(db, run.id))) {
      await failRun(db, run.id, today);
      return { runFailed: true };
    }
  }

  return { runFailed: false };
}

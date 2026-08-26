export type GoalKind = 'check' | 'count' | 'duration';

export type GoalSnapshot = {
  id: string;
  title: string;
  kind: GoalKind;
  target: number;
  unit: string | null;
};

export type ProgressMap = Record<string, number>;

export type DayGrade = {
  state: 'passed' | 'failed';
  missedGoalIds: string[];
};

export const STRIKE_LIMIT = 3;

/** All three kinds grade identically. Only the UI differs. */
export function isGoalComplete(goal: GoalSnapshot, value: number): boolean {
  return value >= goal.target;
}

/** One entry in missedGoalIds becomes one strike. This function never
 *  clamps: a day with four misses reports four. */
export function gradeDay(snapshot: GoalSnapshot[], progress: ProgressMap): DayGrade {
  const missedGoalIds = snapshot
    .filter((g) => !isGoalComplete(g, progress[g.id] ?? 0))
    .map((g) => g.id);
  return {
    state: missedGoalIds.length > 0 ? 'failed' : 'passed',
    missedGoalIds,
  };
}

export function isRunOver(strikeCount: number): boolean {
  return strikeCount >= STRIKE_LIMIT;
}

/** Display only. The ledger keeps the true count. */
export function displayStrikes(strikeCount: number): number {
  return Math.min(strikeCount, STRIKE_LIMIT);
}

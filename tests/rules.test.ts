import { describe, it, expect } from 'vitest';
import {
  isGoalComplete, gradeDay, isRunOver, displayStrikes,
  STRIKE_LIMIT, type GoalSnapshot,
} from '../src/lib/rules';

const check = (id: string): GoalSnapshot =>
  ({ id, title: 'Read', kind: 'check', target: 1, unit: null });
const count = (id: string, target: number): GoalSnapshot =>
  ({ id, title: 'Water', kind: 'count', target, unit: 'glasses' });
const duration = (id: string, target: number): GoalSnapshot =>
  ({ id, title: 'Workout', kind: 'duration', target, unit: 'min' });

describe('isGoalComplete', () => {
  it('completes a checkbox at 1', () => {
    expect(isGoalComplete(check('a'), 0)).toBe(false);
    expect(isGoalComplete(check('a'), 1)).toBe(true);
  });
  it('completes a counter only at or above target', () => {
    expect(isGoalComplete(count('a', 4), 3)).toBe(false);
    expect(isGoalComplete(count('a', 4), 4)).toBe(true);
    expect(isGoalComplete(count('a', 4), 9)).toBe(true);
  });
  it('completes a duration only at or above target', () => {
    expect(isGoalComplete(duration('a', 45), 44)).toBe(false);
    expect(isGoalComplete(duration('a', 45), 45)).toBe(true);
  });
});

describe('gradeDay', () => {
  it('passes when every goal is met', () => {
    const snap = [check('a'), count('b', 4)];
    expect(gradeDay(snap, { a: 1, b: 4 })).toEqual({ state: 'passed', missedGoalIds: [] });
  });

  it('produces one missed goal id per incomplete goal', () => {
    const snap = [check('a'), count('b', 4), duration('c', 45)];
    const grade = gradeDay(snap, { a: 1, b: 2 });
    expect(grade.state).toBe('failed');
    expect(grade.missedGoalIds).toEqual(['b', 'c']);
  });

  it('treats a goal with no progress entry as zero', () => {
    expect(gradeDay([check('a')], {})).toEqual({ state: 'failed', missedGoalIds: ['a'] });
  });

  it('passes an empty snapshot rather than failing it', () => {
    expect(gradeDay([], {})).toEqual({ state: 'passed', missedGoalIds: [] });
  });

  it('reports every miss when a single day exceeds the strike limit', () => {
    const snap = [check('a'), check('b'), check('c'), check('d')];
    const grade = gradeDay(snap, {});
    // Four strikes from one day. The ledger keeps all four; nothing is clamped here.
    expect(grade.missedGoalIds).toHaveLength(4);
    expect(grade.missedGoalIds.length).toBeGreaterThan(STRIKE_LIMIT);
  });
});

describe('run termination', () => {
  it('is not over below the limit', () => {
    expect(isRunOver(0)).toBe(false);
    expect(isRunOver(2)).toBe(false);
  });
  it('is over at the limit', () => {
    expect(isRunOver(3)).toBe(true);
  });
  it('is over past the limit', () => {
    expect(isRunOver(7)).toBe(true);
  });
  it('clamps only the display, never the count', () => {
    expect(displayStrikes(1)).toBe(1);
    expect(displayStrikes(3)).toBe(3);
    expect(displayStrikes(7)).toBe(3);
  });
});

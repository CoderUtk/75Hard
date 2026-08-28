import { it, expect } from 'vitest';
import { nudgeText, milestoneText } from '../src/push/messages';

it('nudge names the day and the count, singular vs plural', () => {
  expect(nudgeText(12, 2)).toBe('Day 12 — 2 goals left.');
  expect(nudgeText(1, 1)).toBe('Day 1 — 1 goal left.');
});

it('milestone names the person and the day', () => {
  expect(milestoneText('Utkarsh', 50)).toBe('Utkarsh reached Day 50 🔥');
  expect(milestoneText('Priya', 25)).toBe('Priya reached Day 25 🔥');
});

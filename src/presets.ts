import type { GoalKind } from './lib/rules';

export type PresetGoal = {
  title: string;
  kind: GoalKind;
  target: number;
  unit: string | null;
};

export const PRESETS: Record<'hard' | 'soft', { goals: PresetGoal[]; banned: string[] }> = {
  hard: {
    goals: [
      { title: '45 min workout',    kind: 'duration', target: 45, unit: 'min' },
      { title: 'Outdoor workout',   kind: 'duration', target: 45, unit: 'min' },
      { title: 'Drink water',       kind: 'count',    target: 16, unit: 'glasses' },
      { title: 'Read 10 pages',     kind: 'count',    target: 10, unit: 'pages' },
      { title: 'Follow the diet',   kind: 'check',    target: 1,  unit: null },
      { title: 'Progress photo',    kind: 'check',    target: 1,  unit: null },
    ],
    banned: ['Alcohol', 'Sugar / sweets', 'Fried snacks', 'Soft drinks', 'Processed snacks'],
  },
  soft: {
    goals: [
      { title: '45 min movement',   kind: 'duration', target: 45, unit: 'min' },
      { title: 'Drink water',       kind: 'count',    target: 12, unit: 'glasses' },
      { title: 'Read 10 pages',     kind: 'count',    target: 10, unit: 'pages' },
      { title: 'Follow the diet',   kind: 'check',    target: 1,  unit: null },
    ],
    banned: ['Alcohol', 'Sugar / sweets', 'Fried snacks'],
  },
};

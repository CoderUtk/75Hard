/** Pure notification-copy builders. No I/O — unit-tested against fixed strings. */

/** goalsLeft is always >= 1 here; a complete day sends no nudge at all. */
export function nudgeText(dayNumber: number, goalsLeft: number): string {
  const noun = goalsLeft === 1 ? 'goal' : 'goals';
  return `Day ${dayNumber} — ${goalsLeft} ${noun} left.`;
}

export function milestoneText(name: string, dayNumber: number): string {
  return `${name} reached Day ${dayNumber} 🔥`;
}

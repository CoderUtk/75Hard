import { describe, it, expect } from 'vitest';
import {
  todayIST, istMinutes, addDays, daysBetween,
  dayNumber, datesBetween, isEditable,
} from '../src/lib/dates';

// 2026-08-26T18:45:00Z === 2026-08-27 00:15 IST
const lateUTC = new Date('2026-08-26T18:45:00Z');

describe('todayIST', () => {
  it('uses the IST calendar day, not the UTC one', () => {
    expect(todayIST(lateUTC)).toBe('2026-08-27');
    expect(todayIST(new Date('2026-08-26T12:00:00Z'))).toBe('2026-08-26');
  });

  it('handles the IST midnight boundary exactly', () => {
    // 18:29:59Z is 23:59:59 IST on the 26th
    expect(todayIST(new Date('2026-08-26T18:29:59Z'))).toBe('2026-08-26');
    // 18:30:00Z is 00:00:00 IST on the 27th
    expect(todayIST(new Date('2026-08-26T18:30:00Z'))).toBe('2026-08-27');
  });
});

describe('istMinutes', () => {
  it('returns 0 at IST midnight, not 1440', () => {
    expect(istMinutes(new Date('2026-08-26T18:30:00Z'))).toBe(0);
  });

  it('returns 720 at noon IST', () => {
    // 06:30Z === 12:00 IST
    expect(istMinutes(new Date('2026-08-26T06:30:00Z'))).toBe(720);
  });

  it('returns 719 one minute before noon IST', () => {
    expect(istMinutes(new Date('2026-08-26T06:29:00Z'))).toBe(719);
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('goes backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });
  it('handles a non-leap year February', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('daysBetween / dayNumber', () => {
  it('counts zero for the same day', () => {
    expect(daysBetween('2026-08-26', '2026-08-26')).toBe(0);
  });
  it('counts across a leap year correctly', () => {
    expect(daysBetween('2028-02-27', '2028-03-01')).toBe(3);
  });
  it('makes the start date Day 1', () => {
    expect(dayNumber('2026-08-26', '2026-08-26')).toBe(1);
  });
  it('makes a full 75-day run end on Day 75', () => {
    expect(dayNumber('2026-08-26', addDays('2026-08-26', 74))).toBe(75);
  });
});

describe('datesBetween', () => {
  it('is inclusive at both ends', () => {
    expect(datesBetween('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ]);
  });
  it('returns empty when the range is inverted', () => {
    expect(datesBetween('2026-09-02', '2026-08-30')).toEqual([]);
  });
});

describe('isEditable', () => {
  const beforeNoon = new Date('2026-08-26T06:29:00Z'); // 11:59 IST on the 26th
  const atNoon     = new Date('2026-08-26T06:30:00Z'); // 12:00 IST on the 26th

  it('always allows today', () => {
    expect(isEditable('2026-08-26', beforeNoon)).toBe(true);
    expect(isEditable('2026-08-26', atNoon)).toBe(true);
  });

  it('allows yesterday before noon', () => {
    expect(isEditable('2026-08-25', beforeNoon)).toBe(true);
  });

  it('rejects yesterday from noon onward', () => {
    expect(isEditable('2026-08-25', atNoon)).toBe(false);
  });

  it('rejects the day before yesterday even before noon', () => {
    expect(isEditable('2026-08-24', beforeNoon)).toBe(false);
  });

  it('rejects future dates', () => {
    expect(isEditable('2026-08-27', beforeNoon)).toBe(false);
  });
});

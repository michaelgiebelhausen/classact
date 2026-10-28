import { describe, expect, it } from 'vitest';
import { attendanceHistoryRow as row } from '../attendancehistory';
const date = '2026-10-27';
const click = { verified: false, professor_confirmed_at: null, denied_count: 0 };

describe('attendance record states', () => {
  it('does not call a missing check-in an absence', () => {
    expect(row(date)).toMatchObject({ checkin: 'None recorded', attendance: 'No attendance recorded' });
  });
  it('separates a seat click from verified presence', () => {
    expect(row(date, click)).toMatchObject({ checkin: 'Recorded', attendance: 'Not confirmed' });
    expect(row(date, { ...click, verified: true }).attendance).toBe('Present · confirmed');
    expect(row(date, { ...click, professor_confirmed_at: '2026-10-27T12:00:00Z' }).detail).toBe('Confirmed by your instructor.');
  });
  it('does not mistake a pending late claim for attendance credit', () => {
    expect(row(date, undefined, { status: 'pending' })).toMatchObject({ checkin: 'None recorded', attendance: 'Awaiting confirmation' });
    expect(row(date, { ...click, verified: true }, { status: 'confirmed' })).toMatchObject({ checkin: 'Recorded', attendance: 'Present · confirmed' });
  });
  it('does not let an old late approval override a removed or newly unverified check-in', () => {
    expect(row(date, undefined, { status: 'confirmed' })).toMatchObject({ checkin: 'None recorded', attendance: 'No attendance recorded' });
    expect(row(date, click, { status: 'confirmed' })).toMatchObject({ checkin: 'Recorded', attendance: 'Not confirmed' });
  });
  it('active disputes override previous confirmations including recovered attendance', () => {
    expect(row(date, { ...click, verified: true, denied_count: 1, professor_confirmed_at: '2026-10-27' }, { status: 'confirmed' }).attendance).toBe('Needs review');
  });
  it('keeps absence decisions and pending appeals visible without erasing presence', () => {
    expect(row(date, undefined, undefined, { verdict: 'excused', appealPending: false }).attendance).toBe('Excused absence');
    expect(row(date, undefined, undefined, { verdict: 'unexcused', appealPending: true })).toMatchObject({ attendance: 'Unexcused absence', absence: 'Unexcused absence · Appeal pending' });
    expect(row(date, { ...click, verified: true }, undefined, { verdict: 'excused', appealPending: false })).toMatchObject({ attendance: 'Present · confirmed', absence: 'Excused absence' });
  });
});

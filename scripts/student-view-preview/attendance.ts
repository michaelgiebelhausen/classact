import { attendanceHistoryRow } from '../../src/lib/attendancehistory';
const click = { verified: false, professor_confirmed_at: null, denied_count: 0 };
export async function getMyAttendanceHistory() {
  await new Promise(resolve => setTimeout(resolve, 400));
  const mode = new URLSearchParams(window.location.search).get('history');
  if (mode === 'error') return { ok: false as const, error: 'Your attendance record could not load. Please try again.' };
  return { ok: true as const, data: { today: '2026-10-28', rows: mode === 'empty' ? [] : [
    attendanceHistoryRow('2026-10-28', click),
    attendanceHistoryRow('2026-10-27', { ...click, verified: true }),
    attendanceHistoryRow('2026-10-22', { ...click, verified: true }, { status: 'confirmed' }),
    attendanceHistoryRow('2026-10-20', undefined, { status: 'pending' }),
    attendanceHistoryRow('2026-10-15', undefined, undefined, { verdict: 'excused', appealPending: false }),
    attendanceHistoryRow('2026-10-13'),
    attendanceHistoryRow('2026-10-08', { ...click, denied_count: 1 }),
  ] } };
}
export async function requestLateCheckin() { return { ok: false as const, error: 'This is a local preview.' }; }
export const respondLateCheckin = requestLateCheckin;
export const retryLateCheckinEmails = requestLateCheckin;

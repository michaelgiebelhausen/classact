import type { AbsenceVerdict, CheckInRow, LateCheckinRequestRow } from '@/types/db';

export type AttendanceHistoryRow = {
  date: string;
  checkin: 'Recorded' | 'None recorded';
  attendance: 'Present · confirmed' | 'Not confirmed' | 'Needs review' | 'Awaiting confirmation' | 'Excused absence' | 'Unexcused absence' | 'No attendance recorded';
  detail: string;
  absence: string | null;
};
export type AttendanceHistoryData = { rows: AttendanceHistoryRow[]; today: string };

/** A seat click and confirmed presence are distinct; active disputes take precedence. */
export function attendanceHistoryRow(
  date: string,
  checkin?: Pick<CheckInRow, 'verified' | 'professor_confirmed_at' | 'denied_count'>,
  late?: Pick<LateCheckinRequestRow, 'status'>,
  absence?: { verdict: AbsenceVerdict; appealPending: boolean },
): AttendanceHistoryRow {
  const recovered = late?.status === 'confirmed';
  const row: AttendanceHistoryRow = {
    date,
    checkin: checkin ? 'Recorded' : 'None recorded',
    attendance: 'No attendance recorded',
    detail: 'No check-in or confirmed late request is on file.',
    absence: absence ? `${absence.verdict === 'excused' ? 'Excused' : 'Unexcused'} absence${absence.appealPending ? ' · Appeal pending' : ''}` : null,
  };
  if (checkin && checkin.denied_count > 0) {
    row.attendance = 'Needs review';
    row.detail = 'Your seat was disputed. Ask your instructor to review it.';
  } else if (checkin?.professor_confirmed_at || checkin?.verified) {
    row.attendance = 'Present · confirmed';
    row.detail = checkin?.professor_confirmed_at ? 'Confirmed by your instructor.' : recovered ? 'Your late attendance request was confirmed.' : 'Confirmed by a classmate.';
  } else if (late?.status === 'pending') {
    row.attendance = 'Awaiting confirmation';
    row.detail = 'Your late attendance request is still pending.';
  } else if (checkin) {
    row.attendance = 'Not confirmed';
    row.detail = 'You checked in, but your presence has not been confirmed.';
  } else if (absence) {
    row.attendance = absence.verdict === 'excused' ? 'Excused absence' : 'Unexcused absence';
    row.detail = absence.appealPending ? 'Your appeal is awaiting an instructor decision.' : 'Based on your absence report.';
  } else if (recovered) {
    row.detail = 'An earlier late request was confirmed, but no current check-in remains. Ask your instructor to review it.';
  }
  return row;
}

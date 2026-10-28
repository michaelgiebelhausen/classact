import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const action = vi.hoisted(() => vi.fn());
vi.mock('@/server/actions/attendancehistory', () => ({ getMyAttendanceHistory: action }));
import { AttendanceHistory } from './AttendanceHistory';
beforeEach(() => vi.resetAllMocks());
const empty = { ok: true, data: { today: '2026-10-28', rows: [] } };
it('loads only on request and shows empty state, then refreshes on reopen', async () => {
  action.mockResolvedValue(empty);
  render(<AttendanceHistory courseId="course" />);
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'See my attendance record' }));
  expect(await screen.findByText('No class sessions have been recorded yet.')).toBeVisible();
  expect(action).toHaveBeenCalledWith('course');
  fireEvent.click(screen.getByRole('button', { name: 'Hide my attendance record' }));
  expect(screen.queryByRole('region')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'See my attendance record' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
});
it('shows loading, honest errors and retry without a false absence list', async () => {
  let finish!: (value: unknown) => void;
  action.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(empty);
  render(<AttendanceHistory courseId="course" />);
  fireEvent.click(screen.getByRole('button', { name: 'See my attendance record' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  finish({ ok: false, error: 'Please try again.' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No class sessions have been recorded yet.')).toBeVisible();
});
it('renders each class date and distinguishes check-in from presence', async () => {
  action.mockResolvedValue({ ok: true, data: { today: '2026-10-28', rows: [
    { date: '2026-10-28', checkin: 'Recorded', attendance: 'Not confirmed', detail: 'Not yet vouched for.', absence: null },
    { date: '2026-10-27', checkin: 'Recorded', attendance: 'Present · confirmed', detail: 'Late request confirmed.', absence: null },
    { date: '2026-10-22', checkin: 'None recorded', attendance: 'Excused absence', detail: 'Based on your report.', absence: 'Excused absence' },
  ] } });
  render(<AttendanceHistory courseId="course" />);
  fireEvent.click(screen.getByRole('button', { name: 'See my attendance record' }));
  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(4);
  expect(within(table).getByText('Today')).toBeVisible();
  expect(within(table).getByText('Wed, Oct 28, 2026')).toBeVisible();
  expect(screen.getByText('3 class sessions · 1 confirmed present')).toBeVisible();
});

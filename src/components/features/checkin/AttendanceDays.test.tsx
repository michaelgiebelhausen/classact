import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const save = vi.hoisted(() => vi.fn());
vi.mock('@/server/actions/attendancedays', () => ({ setAttendanceDays: save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AttendanceDays } from './AttendanceDays';
beforeEach(() => save.mockReset().mockResolvedValue({ ok: true }));
it('bulk excludes selected dates and can restore an excluded date', async () => {
  render(<AttendanceDays courseId="course" days={[{ date: '2026-09-01', excluded: false, reason: '' }, { date: '2026-09-03', excluded: true, reason: 'Exam' }]} />);
  fireEvent.click(screen.getByText('Manage dates'));
  fireEvent.click(screen.getByLabelText('Select all listed dates'));
  fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'First week' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check-in not required' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith('course', ['2026-09-01', '2026-09-03'], true, 'First week'));
  await screen.findByRole('status');
  fireEvent.click(screen.getByLabelText(/2026-09-03/));
  fireEvent.click(screen.getByRole('button', { name: 'Restore check-in requirement' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith('course', ['2026-09-03'], false, 'First week'));
});
it('reports a save failure without claiming success', async () => {
  save.mockResolvedValue({ ok: false, error: 'Could not save attendance days.' });
  render(<AttendanceDays courseId="course" days={[]} />);
  fireEvent.click(screen.getByText('Manage dates'));
  fireEvent.change(screen.getByLabelText('Additional date'), { target: { value: '2026-10-29' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check-in not required' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save attendance days.');
});

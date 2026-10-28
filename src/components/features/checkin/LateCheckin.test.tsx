import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LateCheckin, type LateCheckinProps } from './LateCheckin';

const actions = vi.hoisted(() => ({ requestLateCheckin: vi.fn(), respondLateCheckin: vi.fn(), retryLateCheckinEmails: vi.fn() }));
vi.mock('@/server/actions/latecheckin', () => actions);
vi.mock('@/server/actions/attendancehistory', () => ({ getMyAttendanceHistory: vi.fn() }));
const props: LateCheckinProps = {
  courseId: 'course', sessions: [{ id: 'session', date: '2026-09-15' }],
  seats: [{ id: 'seat', label: 'B4' }], mine: [], incoming: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  actions.requestLateCheckin.mockResolvedValue({ ok: true });
  actions.respondLateCheckin.mockResolvedValue({ ok: true });
});
describe('late check-in', () => {
  it('requires a date and seat before asking neighbors, including weeks-old dates', async () => {
    render(<LateCheckin {...props} />);
    const submit = screen.getByRole('button', { name: 'Ask my neighbors to vouch' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Class date'), { target: { value: 'session' } });
    fireEvent.change(screen.getByLabelText('Where did you sit?'), { target: { value: 'seat' } });
    fireEvent.click(submit);
    await waitFor(() => expect(actions.requestLateCheckin).toHaveBeenCalledWith('course', 'session', 'seat'));
    expect(await screen.findByRole('status')).toHaveTextContent('pending their confirmation');
  });
  it('does not respond merely by opening an invitation and offers honest uncertainty', async () => {
    render(<LateCheckin {...props} incoming={[{ id: 'request', name: 'Maya Chen', date: '2026-09-15', seat: 'B4' }]} />);
    expect(actions.respondLateCheckin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'I don’t remember' }));
    await waitFor(() => expect(actions.respondLateCheckin).toHaveBeenCalledWith('course', 'request', 'unsure'));
  });
  it('submits explicit confirmation', async () => {
    render(<LateCheckin {...props} incoming={[{ id: 'request', name: 'Maya Chen', date: '2026-09-15', seat: 'B4' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, they were there' }));
    await waitFor(() => expect(actions.respondLateCheckin).toHaveBeenCalledWith('course', 'request', 'confirm'));
  });
  it('shows delivery failures without claiming success', async () => {
    actions.requestLateCheckin.mockResolvedValue({ ok: false, error: 'Request saved; email failed.' });
    render(<LateCheckin {...props} />);
    fireEvent.change(screen.getByLabelText('Class date'), { target: { value: 'session' } });
    fireEvent.change(screen.getByLabelText('Where did you sit?'), { target: { value: 'seat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask my neighbors to vouch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('email failed');
  });
  it('distinguishes pending claims from confirmed attendance and offers delivery retry', () => {
    render(<LateCheckin {...props} mine={[{ id: 'request', date: '2026-09-15', seat: 'B4', confirmed: false, unsent: true, responses: 'Waiting for a neighbor.' }]} />);
    expect(screen.getByText('Pending confirmation')).toBeVisible();
    expect(screen.queryByText('Attendance confirmed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry emails' })).toBeVisible();
  });
  it('keeps the rest of check-in usable when this feature is unavailable', () => {
    render(<LateCheckin {...props} unavailable />);
    expect(screen.getByText(/not available yet/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'See my attendance record' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ask my neighbors to vouch' })).toBeNull();
  });
});

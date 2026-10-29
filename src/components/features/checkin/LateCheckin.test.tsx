import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LateCheckin, type LateCheckinProps } from './LateCheckin';

const actions = vi.hoisted(() => ({ pledgeLateCheckin: vi.fn(), requestLateCheckin: vi.fn(), respondLateCheckin: vi.fn(), retryLateCheckinEmails: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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
    fireEvent.click(screen.getByRole('button', { name: "I don't remember." }));
    await waitFor(() => expect(actions.respondLateCheckin).toHaveBeenCalledWith('course', 'request', 'unsure', false));
  });
  it('submits explicit confirmation', async () => {
    render(<LateCheckin {...props} incoming={[{ id: 'request', name: 'Maya Chen', date: '2026-09-15', seat: 'B4' }]} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /I personally saw/ }));
    fireEvent.click(screen.getByRole('button', { name: 'I am confident that they were there.' }));
    await waitFor(() => expect(actions.respondLateCheckin).toHaveBeenCalledWith('course', 'request', 'confirm', true));
  });
  it('offers the three recollection choices in order and records a negative response', async () => {
    render(<LateCheckin {...props} incoming={[{ id: 'request', name: 'Maya Chen', date: '2026-09-15', seat: 'B4' }]} />);
    const choices = screen.getByRole('region', { name: 'Attendance confirmations' }).querySelectorAll('button');
    expect(Array.from(choices, button => button.textContent)).toEqual([
      'I am confident that they were there.',
      "I don't remember.",
      'To the best of my recollection, they were not there.',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'To the best of my recollection, they were not there.' }));
    await waitFor(() => expect(actions.respondLateCheckin).toHaveBeenCalledWith('course', 'request', 'not_present', false));
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

it('requires a personal pledge and clears it when the date or seat changes', async () => {
  actions.pledgeLateCheckin.mockResolvedValue({ ok: true });
  render(<LateCheckin {...props} />);
  fireEvent.click(screen.getByText('No one nearby checked in?'));
  const button = screen.getByRole('button', { name: 'Confirm my attendance by pledge' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Class date'), { target: { value: 'session' } });
  fireEvent.change(screen.getByLabelText('Where did you sit?'), { target: { value: 'seat' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I attended this class/ }));
  expect(button).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Where did you sit?'), { target: { value: '' } });
  expect(screen.getByRole('checkbox', { name: /I attended this class/ })).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('Where did you sit?'), { target: { value: 'seat' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I attended this class/ }));
  fireEvent.click(button);
  await waitFor(() => expect(actions.pledgeLateCheckin).toHaveBeenCalledWith('course', 'session', 'seat', true));
});

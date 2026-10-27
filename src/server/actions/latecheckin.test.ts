import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), admin: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/env', () => ({ env: {}, isConfigured: { supabaseAdmin: true, email: true } }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { requestLateCheckin, respondLateCheckin, retryLateCheckinEmails } from './latecheckin';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});
describe('late check-in server boundary', () => {
  it('refuses unsigned requests before privileged access or database mutation', async () => {
    expect((await requestLateCheckin('course', 'session', 'seat')).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('refuses unsigned email retries before privileged access', async () => {
    expect((await retryLateCheckinEmails('course', 'request')).ok).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('rejects a session from a different course before mutation', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'student' } } });
    const builder = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { course_id: 'other-course' } }) };
    mocks.from.mockReturnValue(builder);
    expect((await requestLateCheckin('course', 'session', 'seat')).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('does not send another email round for a duplicate request', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'student' } } });
    mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { course_id: 'course' } }) });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505' } });
    expect(await requestLateCheckin('course', 'session', 'seat')).toEqual({ ok: false, error: 'You already requested a check-in for this class.' });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('reports unauthorized replies without revalidating or reporting success', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: 'P0001', message: 'This request is not awaiting your response.' } });
    expect((await respondLateCheckin('course', 'request', 'confirm')).ok).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('revalidates after a response commits', async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    expect((await respondLateCheckin('course', 'request', 'confirm')).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('respond_late_checkin', { p_request: 'request', p_response: 'confirm' });
    expect(mocks.revalidate).toHaveBeenCalledWith('/course/course/checkin');
  });
});

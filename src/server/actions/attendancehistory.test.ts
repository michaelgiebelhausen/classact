import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getUser: vi.fn(), memberFrom: vi.fn(), adminFrom: vi.fn(), admin: vi.fn(), configured: { supabaseAdmin: true } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, from: m.memberFrom }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/env', () => ({ isConfigured: m.configured }));
import { getMyAttendanceHistory } from './attendancehistory';

function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(result), single: vi.fn().mockResolvedValue(result), then: (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T02:00:00Z'));
  m.configured.supabaseAdmin = true;
  m.getUser.mockResolvedValue({ data: { user: { id: 'me' } }, error: null });
  m.memberFrom.mockImplementation(table => query(table === 'enrollments' ? { id: 'mine' } : { timezone: 'America/New_York' }));
  m.admin.mockReturnValue({ from: m.adminFrom });
  m.adminFrom.mockReturnValue(query([]));
});
afterEach(() => vi.useRealTimers());

describe('private attendance history', () => {
  it('blocks signed-out users and nonmembers before privileged queries', async () => {
    m.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await getMyAttendanceHistory('course')).ok).toBe(false);
    expect(m.memberFrom).not.toHaveBeenCalled();
    m.memberFrom.mockReturnValueOnce(query(null));
    expect((await getMyAttendanceHistory('other-course')).ok).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
  });
  it('derives the enrollment from the signed-in identity and scopes every private read', async () => {
    const enrollment = query({ id: 'mine' });
    m.memberFrom.mockReturnValueOnce(enrollment).mockReturnValueOnce(query({ timezone: 'America/New_York' }));
    const sessions = query([{ id: 'session', session_date: '2026-10-28' }]);
    const checkins = query([{ session_id: 'session', verified: true, denied_count: 0, professor_confirmed_at: null }]);
    const late = query([]);
    const absences = query([{ absence_date: '2026-10-28', ai_verdict: 'unexcused', professor_verdict: 'excused', appealed_at: '2026-10-28' }]);
    const queries = { class_sessions: sessions, check_ins: checkins, late_checkin_requests: late, absences };
    m.adminFrom.mockImplementation((table: keyof typeof queries) => queries[table]);
    const result = await getMyAttendanceHistory('course');
    expect(enrollment.eq.mock.calls).toEqual([['course_id', 'course'], ['profile_id', 'me'], ['status', 'active']]);
    expect(sessions.eq).toHaveBeenCalledWith('course_id', 'course');
    expect(sessions.lte).toHaveBeenCalledWith('session_date', '2026-10-28');
    for (const q of [checkins, late, absences]) expect(q.eq).toHaveBeenCalledWith('enrollment_id', 'mine');
    expect(checkins.in).toHaveBeenCalledWith('session_id', ['session']);
    expect(late.in).toHaveBeenCalledWith('session_id', ['session']);
    expect(absences.eq).toHaveBeenCalledWith('course_id', 'course');
    expect(absences.in).toHaveBeenCalledWith('absence_date', ['2026-10-28']);
    expect(absences.select).toHaveBeenCalledWith('absence_date, ai_verdict, professor_verdict, appealed_at, assessment_pending');
    expect(result).toEqual({ ok: true, data: { today: '2026-10-28', rows: [{ date: '2026-10-28', checkin: 'Recorded', attendance: 'Present · confirmed', detail: 'Confirmed by a classmate.', absence: 'Excused absence' }] } });
  });
  it.each(['class_sessions', 'check_ins', 'late_checkin_requests', 'absences'])('does not report missing attendance when %s fails', async failed => {
    m.adminFrom.mockImplementation(table => query(table === 'class_sessions' ? [{ id: 's', session_date: '2026-10-28' }] : [], table === failed ? { message: 'unavailable' } : null));
    expect(await getMyAttendanceHistory('course')).toEqual({ ok: false, error: expect.stringContaining('could not load') });
  });
  it('paginates recorded sessions instead of silently truncating history', async () => {
    const first = query(Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, session_date: '2026-10-28' })));
    const second = query([{ id: 'last', session_date: '2026-05-01' }]);
    let page = 0;
    m.adminFrom.mockImplementation(table => table === 'class_sessions' ? [first, second][page++] : query([]));
    const result = await getMyAttendanceHistory('course');
    expect(first.range).toHaveBeenCalledWith(0, 99);
    expect(second.range).toHaveBeenCalledWith(100, 199);
    expect(result.ok && result.data?.rows).toHaveLength(101);
  });
  it('supports empty history without inventing scheduled meetings', async () => {
    expect(await getMyAttendanceHistory('course')).toEqual({ ok: true, data: { today: '2026-10-28', rows: [] } });
  });
  it('reports missing configuration and thrown failures honestly', async () => {
    m.configured.supabaseAdmin = false;
    expect((await getMyAttendanceHistory('course')).ok).toBe(false);
    expect(m.admin).not.toHaveBeenCalled();
    m.getUser.mockRejectedValueOnce(new Error('network'));
    expect((await getMyAttendanceHistory('course')).ok).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn(), pendingSaved: false, resolveAi: vi.fn(), assess: vi.fn(), priors: [] as unknown[], exclusions: [] as unknown[], currentDecision: null as null | Record<string, unknown> }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'student' } } }) } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
  const data = table === 'courses' ? { id: 'course', name: 'Test course', meeting_days: [], attendance_policy: {} } : table === 'enrollments' ? { id: 'enrollment', roster_name: 'Student' } : null;
  let updated = false;
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, is: () => q,
    maybeSingle: async () => ({ data: updated ? (state.currentDecision ? null : { id: 'report' }) : table === 'absences' && state.pendingSaved ? state.currentDecision : data }), single: async () => ({ data: { id: 'report' }, error: null }),
    insert: (input: unknown) => { state.insert(input); state.pendingSaved = true; return q; },
    update: (input: unknown) => { state.update(input); updated = true; return q; },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === 'absences' ? state.priors : table === 'attendance_exclusions' ? state.exclusions : [], error: null }).then(resolve),
  }; return q;
} }) }));
vi.mock('@/lib/env', () => ({ isConfigured: { supabaseAdmin: true } }));
vi.mock('@/server/aicreds', () => ({ resolveCourseAi: state.resolveAi }));
vi.mock('@/server/absenceai', () => ({ assessAbsence: state.assess }));
vi.mock('@/server/absences', () => ({ checkedInElsewhere: async () => false }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock('@/lib/email', () => ({ sendAbsenceAppealNotification: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { submitAbsence } from './absences';

beforeEach(() => { vi.clearAllMocks(); state.pendingSaved = false; state.priors = []; state.exclusions = []; state.currentDecision = null; });
describe('absence request persistence', () => {
  it('saves the request before assessment and retains pending status when assessment is unavailable', async () => {
    state.resolveAi.mockImplementation(async () => { expect(state.pendingSaved).toBe(true); return null; });
    const result = await submitAbsence({ courseId: 'course', date: new Date().toISOString().slice(0, 10), category: 'illness', explanation: 'I cannot attend class today.', document: null });
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ assessment_pending: true, enrollment_id: 'enrollment' }));
    expect(state.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, data: { id: 'report', assessmentPending: true } });
  });
});

it('omits excluded and pending absences from subsequent assessment history', async () => {
  state.resolveAi.mockResolvedValue({ provider: 'fixture' });
  state.assess.mockResolvedValue({ ok: true, assessment: { verdict: 'excused', legitimacy: 80, summary: 'Fixture', reason: 'Fixture', docKind: null, docAuthenticity: null, flags: [] } });
  state.exclusions = [{ session_date: '2026-09-01' }];
  state.priors = [
    { absence_date: '2026-09-01', ai_verdict: 'unexcused', professor_verdict: null },
    { absence_date: '2026-09-03', ai_verdict: 'unexcused', professor_verdict: null, assessment_pending: true },
    { absence_date: '2026-09-08', ai_verdict: 'excused', professor_verdict: null },
  ];
  const result = await submitAbsence({ courseId: 'course', date: new Date().toISOString().slice(0, 10), category: 'illness', explanation: 'I cannot attend class today.', document: null });
  expect(result.ok).toBe(true);
  expect(state.assess).toHaveBeenCalledWith(expect.objectContaining({ priorExcused: 1, priorUnexcused: 0 }), expect.anything());
  expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ assessment_pending: false, ai_verdict: 'excused' }));
});

it('returns the instructor decision when it wins the race with automated assessment', async () => {
  state.resolveAi.mockResolvedValue({ provider: 'fixture' });
  state.assess.mockImplementation(async () => {
    state.currentDecision = { id: 'report', ai_verdict: 'unexcused', ai_reason: 'Pending', professor_verdict: 'excused', professor_note: 'Approved by instructor.', assessment_pending: true };
    return { ok: true, assessment: { verdict: 'unexcused', legitimacy: 20, summary: 'Fixture', reason: 'Discarded AI result', docKind: null, docAuthenticity: null, flags: [] } };
  });
  const result = await submitAbsence({ courseId: 'course', date: new Date().toISOString().slice(0, 10), category: 'illness', explanation: 'I cannot attend class today.', document: null });
  expect(result).toMatchObject({ ok: true, data: { verdict: 'excused', reason: 'Approved by instructor.', assessmentPending: false } });
});

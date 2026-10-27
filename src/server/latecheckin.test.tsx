import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ profileName: null as string | null, signedIn: true, admin: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ isConfigured: { supabaseAdmin: true, email: true } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.signedIn ? { id: 'witness-profile' } : null } }) },
  from: () => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, maybeSingle: async () => ({ data: { id: 'witness-enrollment' } }) };
    return query;
  },
}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: state.admin }));
import { LateCheckinSection } from './latecheckin';

function adminClient() {
  return { from: (table: string) => {
    let result: unknown[] = [];
    const query = {
      select: () => query, lt: () => query, order: () => query, is: () => query, in: () => query,
      eq: (column: string) => {
        if (table === 'class_sessions') result = [{ id: 'session', session_date: '2026-09-15' }];
        if (table === 'seats') result = [{ id: 'seat', label: 'B4' }];
        if (table === 'late_checkin_requests' && column === 'status') result = [{ id: 'request', session_id: 'session', seat_id: 'seat', enrollment_id: 'claimant', status: 'pending' }];
        if (table === 'late_checkin_witnesses') result = [{ request_id: 'request' }];
        if (table === 'enrollments') result = [{ id: 'claimant', roster_name: 'maya.private@example.test', profile_id: 'claimant-profile' }];
        return query;
      },
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        if (table === 'profiles') result = [{ id: 'claimant-profile', full_name: state.profileName }];
        return Promise.resolve({ data: result, error: null }).then(resolve);
      },
    };
    return query;
  } };
}
beforeEach(() => {
  state.signedIn = true;
  state.profileName = null;
  state.admin.mockReset().mockImplementation(adminClient);
});
describe('late check-in read model privacy', () => {
  it('does not expose an email-backed roster name in client props', async () => {
    const element = await LateCheckinSection({ courseId: 'course', today: '2026-10-27' });
    expect(element?.props.incoming[0].name).toBe('maya.private');
    expect(JSON.stringify(element?.props)).not.toContain('maya.private@example.test');
  });
  it('uses the classmate’s chosen name when available', async () => {
    state.profileName = 'Maya Chen';
    const element = await LateCheckinSection({ courseId: 'course', today: '2026-10-27' });
    expect(element?.props.incoming[0].name).toBe('Maya Chen');
    expect(JSON.stringify(element?.props)).not.toContain('maya.private@example.test');
  });
  it('never opens the service client for an unsigned viewer', async () => {
    state.signedIn = false;
    expect(await LateCheckinSection({ courseId: 'course', today: '2026-10-27' })).toBeNull();
    expect(state.admin).not.toHaveBeenCalled();
  });
});

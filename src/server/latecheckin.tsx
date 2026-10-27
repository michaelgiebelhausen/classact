import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isConfigured } from '@/lib/env';
import { LateCheckin, type LateCheckinProps } from '@/components/features/checkin/LateCheckin';
import { rosterDisplayName } from '@/lib/names';

export async function LateCheckinSection({ courseId, today }: { courseId: string; today: string }) {
  const empty: LateCheckinProps = { courseId, sessions: [], seats: [], mine: [], incoming: [] };
  if (!isConfigured.supabaseAdmin || !isConfigured.email) return <LateCheckin {...empty} unavailable />;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data: enrollment } = await client.from('enrollments').select('id').eq('course_id', courseId).eq('profile_id', user.id).eq('status', 'active').order('created_at').limit(1).maybeSingle();
  if (!enrollment) return null;
  // Membership has been established. Admin reads never reach the client raw:
  // only the student's claims and invitations addressed to them are exposed.
  const admin = createAdminClient();
  const [{ data: sessions, error: sessionError }, { data: seats, error: seatError }, { data: requests, error }, { data: invitations, error: invitationError }, { data: checkins, error: checkinError }] = await Promise.all([
    admin.from('class_sessions').select('id, session_date').eq('course_id', courseId).lt('session_date', today).order('session_date', { ascending: false }),
    admin.from('seats').select('id, label').eq('course_id', courseId).order('label'),
    admin.from('late_checkin_requests').select('*').eq('enrollment_id', enrollment.id),
    admin.from('late_checkin_witnesses').select('request_id').eq('enrollment_id', enrollment.id).is('response', null),
    admin.from('check_ins').select('session_id').eq('enrollment_id', enrollment.id),
  ]);
  if (error || sessionError || seatError || invitationError || checkinError) return <LateCheckin {...empty} unavailable />;
  const ownIds = (requests ?? []).map(r => r.id);
  const invitationIds = (invitations ?? []).map(w => w.request_id);
  const [{ data: witnesses }, { data: incoming }] = await Promise.all([
    ownIds.length ? admin.from('late_checkin_witnesses').select('request_id, response, emailed_at').in('request_id', ownIds) : { data: [] },
    invitationIds.length ? admin.from('late_checkin_requests').select('*').in('id', invitationIds).eq('status', 'pending') : { data: [] },
  ]);
  const studentIds = [...new Set((incoming ?? []).map(r => r.enrollment_id))];
  const { data: names } = studentIds.length ? await admin.from('enrollments').select('id, roster_name, profile_id').eq('course_id', courseId).in('id', studentIds) : { data: [] };
  const profileIds = [...new Set((names ?? []).flatMap(n => n.profile_id ? [n.profile_id] : []))];
  const { data: profiles } = profileIds.length ? await admin.from('profiles').select('id, full_name').in('id', profileIds) : { data: [] };
  const displayNames = new Map((names ?? []).map(n => [n.id, rosterDisplayName(n.roster_name, profiles?.find(p => p.id === n.profile_id)?.full_name) || 'A classmate']));
  const dateFor = (sessionId: string) => sessions?.find(s => s.id === sessionId)?.session_date;
  const seatFor = (seatId: string) => seats?.find(s => s.id === seatId)?.label ?? 'Unknown';
  const excluded = new Set([...(requests ?? []).map(r => r.session_id), ...(checkins ?? []).map(c => c.session_id)]);
  return <LateCheckin {...empty}
    sessions={(sessions ?? []).filter(s => !excluded.has(s.id)).map(s => ({ id: s.id, date: s.session_date }))}
    seats={seats ?? []}
    mine={(requests ?? []).map(r => {
      const replies = (witnesses ?? []).filter(w => w.request_id === r.id);
      return { id: r.id, date: dateFor(r.session_id) ?? 'Past class', seat: seatFor(r.seat_id), confirmed: r.status === 'confirmed', unsent: replies.some(w => !w.emailed_at && !w.response), responses: replies.every(w => w.response) ? 'Your neighbors have responded, but neither confirmed attendance.' : 'Waiting for a neighbor to confirm. You do not have attendance credit yet.' };
    })}
    incoming={(incoming ?? []).filter(r => dateFor(r.session_id)).map(r => ({ id: r.id, name: displayNames.get(r.enrollment_id) ?? 'A classmate', date: dateFor(r.session_id)!, seat: seatFor(r.seat_id) }))}
  />;
}

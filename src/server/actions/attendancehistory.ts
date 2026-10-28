'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isConfigured } from '@/lib/env';
import { finalVerdict } from '@/lib/absences';
import { attendanceHistoryRow, type AttendanceHistoryData, type AttendanceHistoryRow } from '@/lib/attendancehistory';
import type { ActionResult } from './auth';

const unavailable = 'Your attendance record could not load. Please try again.';

/** Read only. Enrollment comes from the session, never from a client-supplied student ID. */
export async function getMyAttendanceHistory(courseId: string): Promise<ActionResult<AttendanceHistoryData>> {
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return { ok: false, error: 'Sign in to see your attendance record.' };
    const { data: enrollment, error: enrollmentError } = await client.from('enrollments')
      .select('id').eq('course_id', courseId).eq('profile_id', user.id).eq('status', 'active')
      .order('created_at').limit(1).maybeSingle();
    if (enrollmentError) return { ok: false, error: unavailable };
    if (!enrollment) return { ok: false, error: 'You need an active student enrollment in this course.' };
    const { data: course, error: courseError } = await client.from('courses').select('timezone').eq('id', courseId).single();
    if (courseError || !course || !isConfigured.supabaseAdmin) return { ok: false, error: unavailable };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: course.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    // Absences are professor-only under RLS to protect internal assessment fields.
    // After the membership gate, read only this student's minimal attendance fields.
    const admin = createAdminClient();
    const rows: AttendanceHistoryRow[] = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const { data: sessions, error } = await admin.from('class_sessions').select('id, session_date')
        .eq('course_id', courseId).lte('session_date', today).order('session_date', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error || !sessions) return { ok: false, error: unavailable };
      if (!sessions.length) break;
      const ids = sessions.map(s => s.id);
      const dates = sessions.map(s => s.session_date);
      const [checkins, requests, absences] = await Promise.all([
        admin.from('check_ins').select('session_id, verified, professor_confirmed_at, denied_count')
          .eq('enrollment_id', enrollment.id).in('session_id', ids),
        admin.from('late_checkin_requests').select('session_id, status')
          .eq('enrollment_id', enrollment.id).in('session_id', ids),
        admin.from('absences').select('absence_date, ai_verdict, professor_verdict, appealed_at')
          .eq('course_id', courseId).eq('enrollment_id', enrollment.id).in('absence_date', dates),
      ]);
      // Never turn a failed query into a list of apparent missed classes.
      if (checkins.error || requests.error || absences.error || !checkins.data || !requests.data || !absences.data) return { ok: false, error: unavailable };
      for (const session of sessions) {
        const absence = absences.data.find(a => a.absence_date === session.session_date);
        rows.push(attendanceHistoryRow(session.session_date,
          checkins.data.find(c => c.session_id === session.id),
          requests.data.find(r => r.session_id === session.id),
          absence ? { verdict: finalVerdict(absence), appealPending: !!absence.appealed_at && !absence.professor_verdict } : undefined));
      }
      if (sessions.length < pageSize) break;
    }
    return { ok: true, data: { rows, today } };
  } catch {
    return { ok: false, error: unavailable };
  }
}

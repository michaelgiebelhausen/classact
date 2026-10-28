"use server";

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env, isConfigured } from '@/lib/env';
import { Resend } from 'resend';
import { lateCheckinEmail, type LateResponse } from '@/lib/latecheckin';
import type { ActionResult } from '@/server/actions/auth';
import { rosterDisplayName } from '@/lib/names';
import { isPracticeCourse } from '@/server/practice';

export async function requestLateCheckin(courseId: string, sessionId: string, seatId: string): Promise<ActionResult> {
  if (!isConfigured.supabaseAdmin || !isConfigured.email) {
    return { ok: false, error: 'Late check-in requests are unavailable until email is configured.' };
  }
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const { data: session } = await client.from('class_sessions').select('course_id').eq('id', sessionId).single();
  if (session?.course_id !== courseId) return { ok: false, error: 'Choose a session in this course.' };
  const { data: requestId, error } = await client.rpc('request_late_checkin', { p_session: sessionId, p_seat: seatId });
  if (error || !requestId) return { ok: false, error: error?.code === '23505' ? 'You already requested a check-in for this class.' : error?.code === 'P0001' ? error.message : 'Could not save your request. Try again later.' };
  const sent = await emailWitnesses(requestId, user.id);
  revalidatePath(`/course/${courseId}/checkin`);
  return sent ? { ok: true } : { ok: false, error: 'Your request is saved, but some emails could not be sent. Use Retry emails below.' };
}

// Only the requester may retry delivery. A database lease prevents parallel
// retries from sending duplicates; failed deliveries release their lease.
export async function retryLateCheckinEmails(courseId: string, requestId: string): Promise<ActionResult> {
  if (!isConfigured.supabaseAdmin || !isConfigured.email) return { ok: false, error: 'Email is unavailable.' };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const sent = await emailWitnesses(requestId, user.id, courseId);
  revalidatePath(`/course/${courseId}/checkin`);
  return sent ? { ok: true } : { ok: false, error: 'Some emails could not be sent. Try again later.' };
}

async function emailWitnesses(requestId: string, profileId: string, expectedCourseId?: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: request } = await admin.from('late_checkin_requests').select('*').eq('id', requestId).single();
  if (!request || request.status !== 'pending') return false;
  const { data: student } = await admin.from('enrollments').select('profile_id, roster_name, course_id, status').eq('id', request.enrollment_id).single();
  if (student?.profile_id !== profileId || student.status !== 'active' || (expectedCourseId && student.course_id !== expectedCourseId)) return false;
  if (await isPracticeCourse(student.course_id)) return false;
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', profileId).maybeSingle();
  const studentName = rosterDisplayName(student.roster_name, profile?.full_name) || 'A classmate';
  const [{ data: course }, { data: session }, { data: seat }, { data: witnesses }] = await Promise.all([
    admin.from('courses').select('name, timezone').eq('id', student.course_id).single(),
    admin.from('class_sessions').select('session_date').eq('id', request.session_id).single(),
    admin.from('seats').select('label').eq('id', request.seat_id).single(),
    admin.from('late_checkin_witnesses').select('*').eq('request_id', requestId).is('emailed_at', null).is('response', null),
  ]);
  if (!course || !session || !seat || !witnesses) return false;
  // Match actual lecture timestamps in the course timezone; never infer a
  // topic from a nearby date or a deck that was merely uploaded that day.
  const { data: lectures } = await admin.from('lectures').select('started_at, deck_id').eq('course_id', student.course_id);
  const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: course.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const deckIds = [...new Set((lectures ?? []).filter(l => dateFormatter.format(new Date(l.started_at)) === session.session_date).map(l => l.deck_id))];
  const { data: decks } = deckIds.length ? await admin.from('lecture_decks').select('title').in('id', deckIds) : { data: [] };
  const topic = (decks ?? []).map(d => d.title).join('; ') || null;
  let allSent = true;
  for (const witness of witnesses) {
    const { data: recipient } = await admin.from('enrollments').select('roster_email, status, course_id').eq('id', witness.enrollment_id).single();
    if (!recipient || recipient.status !== 'active' || recipient.course_id !== student.course_id) { allSent = false; continue; }
    const lease = new Date().toISOString();
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: claimed, error: claimError } = await admin.from('late_checkin_witnesses').update({ email_claimed_at: lease }).eq('id', witness.id).is('emailed_at', null).or(`email_claimed_at.is.null,email_claimed_at.lt.${staleBefore}`).select('id').maybeSingle();
    if (claimError) { allSent = false; continue; }
    if (!claimed) { allSent = false; continue; }
    const message = lateCheckinEmail({ studentName, courseName: course.name, date: session.session_date, seatLabel: seat.label, topic, url: `${env.siteUrl}/course/${student.course_id}/checkin#late-checkin` });
    let sent = false;
    try {
      const { error } = await new Resend(env.resendApiKey).emails.send(
        { from: env.emailFrom, to: recipient.roster_email, ...message },
        { idempotencyKey: `late-checkin-${witness.id}` },
      );
      sent = !error;
    } catch { /* Keep the saved request and offer delivery retry. */ }
    if (!sent) {
      allSent = false;
    }
    const { error: receiptError } = await admin.from('late_checkin_witnesses').update({ emailed_at: sent ? new Date().toISOString() : null, email_claimed_at: null }).eq('id', witness.id).eq('email_claimed_at', lease);
    if (receiptError) allSent = false;
  }
  return allSent;
}

export async function respondLateCheckin(courseId: string, requestId: string, response: LateResponse): Promise<ActionResult> {
  const client = await createClient();
  const { error } = await client.rpc('respond_late_checkin', { p_request: requestId, p_response: response });
  if (error) return { ok: false, error: error.code === 'P0001' ? error.message : 'Could not save your response. Refresh and try again.' };
  revalidatePath(`/course/${courseId}/checkin`);
  return { ok: true };
}

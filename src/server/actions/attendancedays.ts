'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from './auth';

export async function setAttendanceDays(courseId: string, dates: string[], excluded: boolean, reason: string): Promise<ActionResult> {
  if (!Array.isArray(dates) || !dates.length || dates.length > 400 || dates.some(d => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) || typeof reason !== 'string' || reason.length > 200 || typeof excluded !== 'boolean') {
    return { ok: false, error: 'Select valid dates and a reason of at most 200 characters.' };
  }
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const { error } = await client.rpc('set_attendance_exclusions', { p_course: courseId, p_dates: dates, p_excluded: excluded, p_reason: reason.trim() });
  if (error) return { ok: false, error: error.code === 'P0001' ? error.message : 'Could not save attendance days. Try again.' };
  revalidatePath(`/course/${courseId}`, 'layout');
  return { ok: true };
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { setAttendanceDays } from '@/server/actions/attendancedays';

export function AttendanceDays({ courseId, days }: { courseId: string; days: { date: string; excluded: boolean; reason: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [extraDate, setExtraDate] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  function save(excluded: boolean) {
    const dates = [...new Set([...selected, ...(extraDate ? [extraDate] : [])])];
    startTransition(async () => {
      try {
        const result = await setAttendanceDays(courseId, dates, excluded, reason);
        setFailed(!result.ok);
        setMessage(result.ok ? 'Attendance days updated.' : result.error ?? 'Could not save. Try again.');
        if (result.ok) { setSelected([]); setExtraDate(''); router.refresh(); }
      } catch { setFailed(true); setMessage('Connection failed. Refresh to check whether your changes were saved.'); }
    });
  }
  return <Card>
    <CardHeader><CardTitle>Attendance days</CardTitle><CardDescription>Exclude exam days, the first week, or any dates when check-in is not required. Excluded days disappear from student attendance lists and do not count toward attendance totals. Existing records are preserved.</CardDescription></CardHeader>
    <CardContent className="grid gap-4">
      <details>
        <summary className="cursor-pointer font-medium">Manage dates</summary>
        <div className="mt-4 grid gap-4">
          {days.length ? <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={pending} checked={selected.length === days.length} onChange={e => setSelected(e.target.checked ? days.map(d => d.date) : [])} />Select all listed dates</label>
            <div className="max-h-80 overflow-y-auto rounded-md border p-3">
              {days.map(day => <label key={day.date} className="flex items-start gap-3 py-2 text-sm"><input type="checkbox" disabled={pending} checked={selected.includes(day.date)} onChange={e => setSelected(e.target.checked ? [...selected, day.date] : selected.filter(d => d !== day.date))} /><span>{day.date} · {day.excluded ? 'Check-in not required' : 'Check-in required'}{day.reason && ` · ${day.reason}`}</span></label>)}
            </div>
          </> : <p className="text-sm text-muted-foreground">No class dates yet. Add a date below, or set the course schedule to list the semester.</p>}
          <label className="grid gap-2 text-sm">Additional date<input type="date" value={extraDate} disabled={pending} onChange={e => setExtraDate(e.target.value)} className="rounded-md border bg-background px-3 py-2" /></label>
          <label className="grid gap-2 text-sm">Reason (optional)<input value={reason} maxLength={200} disabled={pending} onChange={e => setReason(e.target.value)} placeholder="Exam day, first week, canceled class" className="rounded-md border bg-background px-3 py-2" /></label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || (!selected.length && !extraDate)} onClick={() => save(true)}>{pending ? 'Saving…' : 'Check-in not required'}</Button>
            <Button variant="outline" disabled={pending || (!selected.length && !extraDate)} onClick={() => save(false)}>Restore check-in requirement</Button>
          </div>
        </div>
      </details>
      {message && <p role={failed ? 'alert' : 'status'} className={failed ? 'text-sm text-destructive' : 'text-sm'}>{message}</p>}
    </CardContent>
  </Card>;
}

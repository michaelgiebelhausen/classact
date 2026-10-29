'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getMyAttendanceHistory } from '@/server/actions/attendancehistory';
import type { AttendanceHistoryData } from '@/lib/attendancehistory';

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

export function AttendanceHistory({ courseId }: { courseId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [data, setData] = useState<AttendanceHistoryData | null>(null);
  const [error, setError] = useState('');
  async function load() {
    setPending(true); setError(''); setData(null);
    try {
      const result = await getMyAttendanceHistory(courseId);
      if (result.ok && result.data) setData(result.data);
      else setError(result.ok ? 'Your attendance record could not load.' : result.error);
    } catch { setError('Your attendance record could not load. Please try again.'); }
    finally { setPending(false); }
  }
  return <div className="grid gap-4">
    <Button variant="link" className="h-auto justify-self-start whitespace-normal p-0 text-left" aria-expanded={open} aria-controls={id} disabled={pending} onClick={() => {
      setOpen(!open);
      if (!open) void load();
    }}>{open ? 'Hide my attendance record' : 'See my attendance record'}</Button>
    {open && <section id={id} aria-label="My attendance record" className="grid gap-4 rounded-lg border p-4" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">My attendance record</h3>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void load()}>{error ? 'Try again' : 'Refresh record'}</Button>
      </div>
      <p className="text-sm text-muted-foreground">Class sessions recorded in ClassAct, newest first. A check-in records your seat; confirmed attendance means a classmate or instructor vouched for you, or you signed an attendance pledge. A missing check-in does not necessarily mean you were absent.</p>
      {pending && <p role="status" className="text-sm">Loading your attendance record…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data && (data.rows.length ? <>
        <p className="text-sm">{data.rows.length} class {data.rows.length === 1 ? 'session' : 'sessions'} · {data.rows.filter(r => r.attendance === 'Present · confirmed').length} confirmed present</p>
        <ol className="grid gap-4 sm:hidden" aria-label="Attendance by class date">
          {data.rows.map(row => <li key={row.date} className="grid gap-2 rounded-md bg-muted p-3 text-sm">
            <p className="font-semibold"><time dateTime={row.date}>{dateLabel(row.date)}</time>{row.date === data.today && <span className="block font-normal text-muted-foreground">Today</span>}</p>
            <dl className="grid gap-2">
              <div><dt className="text-xs text-muted-foreground">Check-in</dt><dd>{row.checkin}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Attendance</dt><dd><p className="font-medium">{row.attendance}</p><p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>{row.absence && <p className="mt-2 text-xs">Absence report: {row.absence}</p>}</dd></div>
            </dl>
          </li>)}
        </ol>
        <table className="hidden w-full table-fixed text-left text-sm sm:table">
          <caption className="sr-only">Your check-ins and attendance by class date</caption>
          <thead><tr><th scope="col" className="pb-3 pr-3">Class date</th><th scope="col" className="pb-3 pr-3">Check-in</th><th scope="col" className="pb-3">Attendance</th></tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.date} className="align-top">
            <th scope="row" className="py-3 pr-3 font-normal"><time dateTime={row.date}>{dateLabel(row.date)}</time>{row.date === data.today && <span className="block text-muted-foreground">Today</span>}</th>
            <td className="py-3 pr-3">{row.checkin}</td>
            <td className="py-3"><p className="font-medium">{row.attendance}</p><p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>{row.absence && <p className="mt-2 text-xs">Absence report: {row.absence}</p>}</td>
          </tr>)}</tbody>
        </table>
        <p className="text-sm text-muted-foreground">Missing a day you attended? Use the date and seat fields below to request a late confirmation. Dates excluded by your instructor do not appear here and need no check-in. Reported absences do not need attendance recovery.</p>
      </> : <p className="text-sm">No class sessions have been recorded yet.</p>)}
    </section>}
  </div>;
}

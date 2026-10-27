"use client";

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requestLateCheckin, respondLateCheckin, retryLateCheckinEmails } from '@/server/actions/latecheckin';
import type { LateResponse } from '@/lib/latecheckin';
import type { ActionResult } from '@/server/actions/auth';

export type LateCheckinProps = {
  courseId: string;
  sessions: { id: string; date: string }[];
  seats: { id: string; label: string }[];
  mine: { id: string; date: string; seat: string; confirmed: boolean; unsent: boolean; responses: string }[];
  incoming: { id: string; name: string; date: string; seat: string }[];
  unavailable?: boolean;
};

export function LateCheckin({ courseId, sessions, seats, mine, incoming, unavailable }: LateCheckinProps) {
  const [sessionId, setSessionId] = useState('');
  const [seatId, setSeatId] = useState('');
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  function run(action: () => Promise<ActionResult>, success: string) {
    setMessage('');
    startTransition(async () => {
      try {
        const result = await action();
        setError(!result.ok);
        setMessage(result.ok ? success : result.error || 'Please try again.');
      } catch {
        setError(true);
        setMessage('Connection failed. Refresh to check whether your request was saved.');
      }
    });
  }
  const selectClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return <Card id="late-checkin">
    <CardHeader>
      <CardTitle>Forgot to check in?</CardTitle>
      <CardDescription>Choose the class and the seat you used, even if it was weeks ago. We’ll ask the students recorded on either side of you to vouch for your attendance. One confirmation is enough.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-6">
      {unavailable ? <p className="text-sm text-muted-foreground">Late check-in is not available yet. Please try again later.</p> : <>
        {incoming.length > 0 && <section aria-label="Attendance confirmations" className="grid gap-3">
          <h3 className="font-medium">Can you vouch for a classmate?</h3>
          {incoming.map(request => <div key={request.id} className="grid gap-3 rounded-md border p-4">
            <p className="text-sm"><strong>{request.name}</strong> says they sat next to you in seat {request.seat} on {request.date}. Do you remember them being there?</p>
            <div className="flex flex-wrap gap-2">
              {([['confirm', 'Yes, they were there'], ['not_present', 'They were not there'], ['unsure', 'I don’t remember']] as [LateResponse, string][]).map(([response, label]) => <Button key={response} disabled={pending} variant={response === 'confirm' ? 'default' : 'outline'} onClick={() => run(() => respondLateCheckin(courseId, request.id, response), 'Your response is saved.')}>{label}</Button>)}
            </div>
          </div>)}
        </section>}
        <form className="grid gap-3" onSubmit={event => {
          event.preventDefault();
          run(() => requestLateCheckin(courseId, sessionId, seatId), 'Request saved. Your neighbors have been emailed. Attendance is pending their confirmation.');
        }}>
          {sessions.length ? <>
            <label className="grid gap-2 text-sm" htmlFor="late-session">Class date
              <select id="late-session" className={selectClass} required value={sessionId} disabled={pending} onChange={e => setSessionId(e.target.value)}><option value="">Choose a class</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.date}</option>)}</select>
            </label>
            <label className="grid gap-2 text-sm" htmlFor="late-seat">Where did you sit?
              <select id="late-seat" className={selectClass} required value={seatId} disabled={pending} onChange={e => setSeatId(e.target.value)}><option value="">Choose your seat</option>{seats.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </label>
            <Button type="submit" disabled={pending || !sessionId || !seatId} className="justify-self-start">{pending ? 'Saving…' : 'Ask my neighbors to vouch'}</Button>
          </> : <p className="text-sm text-muted-foreground">No past classes are awaiting a check-in request.</p>}
        </form>
        {mine.length > 0 && <section aria-label="Your late check-in requests" className="grid gap-3">
          <h3 className="font-medium">Your requests</h3>
          {mine.map(request => <div key={request.id} className="grid gap-2 rounded-md border p-4 text-sm">
            <p>{request.date} · Seat {request.seat} · <strong>{request.confirmed ? 'Attendance confirmed' : 'Pending confirmation'}</strong></p>
            {!request.confirmed && <p className="text-muted-foreground">{request.responses}</p>}
            {!request.confirmed && request.unsent && <Button variant="outline" disabled={pending} className="justify-self-start" onClick={() => run(() => retryLateCheckinEmails(courseId, request.id), 'Neighbor emails sent.')}>Retry emails</Button>}
          </div>)}
        </section>}
      </>}
      {message && <p role={error ? 'alert' : 'status'} className={error ? 'text-sm text-destructive' : 'text-sm'}>{message}</p>}
    </CardContent>
  </Card>;
}

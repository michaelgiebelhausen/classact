"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AllocationEditor } from "./AllocationEditor";
import { contributionCommand } from "@/server/actions/contributions";
import { equalAllocation, needsExplanation, summarizeContributions, type Agreement, type Allocation, type Checkpoint, type ContributionMember, type ContributionResponse } from "@/lib/contributions";

type Command = (action: string, data: Record<string, unknown>) => Promise<boolean>;
const percentage = (n: number | null) => n === null ? "No assessment" : `${(n / 100).toFixed(2)}%`;
const dateLabel = (date: string) => new Date(date).toLocaleString(undefined, { timeZoneName: "short" });

export function ContributionPanel({ courseId, projectId, teamId, members, agreements, checkpoints, responses, me, isProfessor, now, brief }: {
  courseId: string; projectId: string; teamId: string; members: ContributionMember[];
  agreements: Agreement[]; checkpoints: Checkpoint[]; responses: ContributionResponse[];
  me: string | null; isProfessor: boolean; now: string; brief: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const latest = agreements[0];
  const confirmed = agreements.find(a => a.confirmed_at);
  const matchesRoster = (a: Agreement) => a.roster.map(m => m.id).sort().join() === members.map(m => m.id).sort().join();
  const [shares, setShares] = useState<Allocation>(() => latest && matchesRoster(latest) ? latest.shares : equalAllocation(members.map(m => m.id)));
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const command: Command = async (action, data) => {
    setBusy(true); setMessage("");
    try {
      const result = await contributionCommand(courseId, projectId, teamId, action, data);
      setMessage(result.ok ? "Saved." : result.error);
      if (result.ok) router.refresh();
      return result.ok;
    } catch { setMessage("Connection failed. Try again."); return false; }
    finally { setBusy(false); }
  };
  return <div className="grid min-w-0 gap-8 [--primary:var(--foreground)] [--primary-foreground:var(--background)]">
    {brief && <p className="max-w-prose whitespace-pre-wrap text-sm">{brief}</p>}
    <p className="max-w-prose text-sm text-foreground/75">Agree on the work split together, then privately report work and recommend credit at each checkpoint. Your instructor makes grading decisions. These charts do not change grades or participation scores.</p>
    {message && <p role="status" aria-live="polite" className="text-sm">{message}</p>}
    <section className="grid gap-4" aria-label="Work agreement">
      <h2 className="text-xl font-semibold">Agreed work shares</h2>
      {confirmed ? <div className="rounded-lg border p-4">
        <p className="mb-2 text-sm font-medium">Confirmed {dateLabel(confirmed.confirmed_at!)}{!matchesRoster(confirmed) ? " · Previous roster; a new agreement is needed" : ""}</p>
        <ul className="grid gap-1 text-sm">{confirmed.roster.map(m => <li key={m.id}>{m.name}: {percentage(confirmed.shares[m.id])}</li>)}</ul>
      </div> : <p className="text-sm text-foreground/75">No confirmed agreement yet. Equal starting values require everyone’s explicit confirmation.</p>}
      {latest && !latest.confirmed_at && <div className="grid gap-2 rounded-lg border p-4">
        <p className="font-medium">Pending proposal · {latest.confirmations.length} of {latest.roster.length} confirmed</p>
        <ul className="grid gap-1 text-sm">{latest.roster.map(m => <li key={m.id}>{m.name}: {percentage(latest.shares[m.id])} · {latest.confirmations.includes(m.id) ? "Confirmed" : "Awaiting confirmation"}</li>)}</ul>
        {latest.note && <p className="whitespace-pre-wrap text-sm">{latest.note}</p>}
        {!isProfessor && <Button size="lg" disabled={busy || !me || latest.confirmations.includes(me) || !matchesRoster(latest)} className="justify-self-start" onClick={() => void command("confirm", { id: latest.id })}>Confirm this work split</Button>}
        {!matchesRoster(latest) && <p className="text-sm">Membership changed. Propose a fresh work split.</p>}
      </div>}
      {!isProfessor && <details className="rounded-lg border p-4" open={!latest}>
        <summary className="cursor-pointer text-sm font-medium">{latest ? "Propose a revised work split" : "Set up your team’s work split"}</summary>
        <div className="mt-4 grid gap-4">
          <AllocationEditor title="Expected contribution" members={members} value={shares} onChange={setShares} me={me} disabled={busy} />
          <label className="grid gap-2 text-sm">Reason for this split (optional; avoid personal details)<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className="min-h-24 rounded-lg border bg-background p-3 focus-visible:outline-ring" /></label>
          <Button size="lg" disabled={busy || !members.length} className="justify-self-start" onClick={() => void command("propose", { shares, note, previous: latest?.id ?? "" })}>Propose work split</Button>
        </div>
      </details>}
      {!!agreements.length && <details><summary className="cursor-pointer text-sm">Agreement history ({agreements.length})</summary><ul className="mt-3 grid gap-3">{agreements.map(a => <li key={a.id} className="text-sm"><p>{dateLabel(a.created_at)} · {a.confirmed_at ? "Confirmed" : "Proposal"} · {a.confirmations.length}/{a.roster.length} confirmations</p><p>{a.roster.map(m => `${m.name}: ${percentage(a.shares[m.id])}`).join(" · ")}</p>{a.note && <p>{a.note}</p>}</li>)}</ul></details>}
    </section>
    {isProfessor && <section className="grid gap-3" aria-label="Create checkpoint">
      <h2 className="text-xl font-semibold">Open a private check-in</h2>
      <p className="text-sm text-foreground/75">Each checkpoint freezes this roster and the latest confirmed agreement. Students may edit until its deadline.</p>
      <label className="grid gap-1 text-sm">Checkpoint title<Input maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Final project check-in" /></label>
      <label className="grid gap-1 text-sm">Deadline in your device’s local time<Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
      {deadline && <p className="text-sm">{dateLabel(new Date(deadline).toISOString())}</p>}
      <Button size="lg" className="justify-self-start" disabled={busy || !title.trim() || !deadline || !confirmed || !matchesRoster(confirmed)} onClick={() => void command("checkpoint", { title, deadline: new Date(deadline).toISOString() })}>Open checkpoint</Button>
      {(!confirmed || !matchesRoster(confirmed)) && <p className="text-sm">The current team must confirm its work split first.</p>}
    </section>}
    <section className="grid gap-6" aria-label="Checkpoints">
      <h2 className="text-xl font-semibold">Private check-ins</h2>
      {!checkpoints.length && <p className="text-sm text-foreground/75">No checkpoints yet. Your instructor will open one when it’s time to reflect on the work.</p>}
      {checkpoints.map(cp => <section key={cp.id} className="grid gap-4 rounded-lg border p-4 sm:p-6">
        <div><h3 className="text-lg font-semibold">{cp.title}</h3><p className="text-sm text-foreground/75">{Date.parse(now) >= Date.parse(cp.deadline) ? "Closed" : "Open"} · Deadline {dateLabel(cp.deadline)}</p></div>
        {isProfessor ? <InstructorCheckpoint checkpoint={cp} responses={responses.filter(r => r.checkpoint_id === cp.id)} command={command} busy={busy} /> : <ResponseForm key={`${cp.id}-${responses.find(r => r.checkpoint_id === cp.id)?.revision ?? 0}`} checkpoint={cp} response={responses.find(r => r.checkpoint_id === cp.id)} agreement={agreements.find(a => a.id === cp.agreement_id)} me={me} command={command} busy={busy} closed={Date.parse(now) >= Date.parse(cp.deadline)} />}
      </section>)}
    </section>
  </div>;
}

function ResponseForm({ checkpoint: cp, response, agreement, me, command, busy, closed }: { checkpoint: Checkpoint; response?: ContributionResponse; agreement?: Agreement; me: string | null; command: Command; busy: boolean; closed: boolean }) {
  const [actual, setActual] = useState(response?.actual ?? equalAllocation(cp.roster.map(m => m.id)));
  const [credit, setCredit] = useState(response?.credit ?? equalAllocation(cp.roster.map(m => m.id)));
  const [declined, setDeclined] = useState(response?.declined ?? false);
  const [explanation, setExplanation] = useState(response?.explanation ?? "");
  const [help, setHelp] = useState(response?.help_requested ?? false);
  const explanationRequired = !declined && needsExplanation(actual, credit);
  const save = (submit: boolean) => command("save", { id: cp.id, actual, credit, declined, explanation, help, submit, revision: response?.revision ?? 0 });
  return <div className="grid gap-5">
    <p className="text-sm">Private to you and your instructor after submission. Teammates cannot see your ratings or comments. {response?.submitted_at ? `Submitted ${dateLabel(response.submitted_at)}.` : "Not submitted. Starting values are not feedback."}</p>
    <fieldset disabled={closed || busy} className="grid min-w-0 gap-5">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={declined} onChange={e => setDeclined(e.target.checked)} /> I don&apos;t have enough information to assess this</label>
      {!declined && <>
        <p className="text-sm text-foreground/75">Of the work your team actually completed, what percentage did each person contribute? This describes the distribution of completed work, not how much of the assignment is finished.</p>
        <AllocationEditor title="Actual contribution" members={cp.roster} value={actual} onChange={setActual} reference={agreement?.shares} me={me} disabled={closed || busy} />
        <div className="grid gap-3 border-t pt-5">
          <p className="text-sm text-foreground/75">How would you divide 100 credit points among everyone, including yourself? This is a shared pool of points, not a grade out of 100 for each person.</p>
          <Button size="lg" variant="outline" className="justify-self-start" onClick={() => setCredit({ ...actual })}>Use my contribution estimates</Button>
          <AllocationEditor title="Recommended credit" members={cp.roster} value={credit} onChange={setCredit} me={me} disabled={closed || busy} points />
        </div>
      </>}
      <label className="grid gap-2 text-sm">Explanation {explanationRequired ? "(required for zero work or a credit difference over one point)" : "(optional)"}<textarea maxLength={4000} value={explanation} onChange={e => setExplanation(e.target.value)} className="min-h-24 rounded-lg border bg-background p-3 focus-visible:outline-ring" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={help} onChange={e => setHelp(e.target.checked)} /> I’d like the instructor to help</label>
      <div className="flex flex-wrap gap-3">
        {!response?.submitted_at && <Button size="lg" variant="outline" onClick={() => void save(false)}>Save private draft</Button>}
        <Button size="lg" disabled={explanationRequired && explanation.trim().length < 3} onClick={() => void save(true)}>{busy ? "Saving…" : response?.submitted_at ? "Update submitted check-in" : "Submit private check-in"}</Button>
      </div>
    </fieldset>
  </div>;
}

function InstructorCheckpoint({ checkpoint: cp, responses, command, busy }: { checkpoint: Checkpoint; responses: ContributionResponse[]; command: Command; busy: boolean }) {
  const [deadline, setDeadline] = useState("");
  const submitted = responses.filter(r => r.submitted_at);
  const summaries = summarizeContributions(cp.roster, submitted);
  return <div className="grid min-w-0 gap-4">
    <p className="text-sm">{submitted.length} of {cp.roster.length} submitted. Missing or declined feedback is not zero work. Disagreement calls for a conversation; it does not establish who is right.</p>
    <ul className="grid gap-1 text-sm">{cp.roster.map(m => { const r = submitted.find(r => r.respondent_id === m.id); return <li key={m.id}>{m.name}: {r ? r.declined ? "Submitted · unable to assess" : "Submitted" : "Missing submission"}{r?.help_requested ? " · Requests instructor help" : ""}</li>; })}</ul>
    <div className="overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Contribution summary; scroll horizontally to see all columns"><table className="w-full min-w-[40rem] text-left text-sm"><caption className="mb-2 text-left text-foreground/75">Work estimates and credit recommendations (100 points total per response)</caption><thead><tr>{["Member", "Self", "Peers: average / range / count", "Credit: average / range / count"].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead><tbody>{summaries.map(m => <tr key={m.id} className="border-t"><th className="p-2 font-medium">{m.name}</th><td className="p-2 tabular-nums">{percentage(m.self)}</td><td className="p-2 tabular-nums">{m.peers ? `${percentage(m.peers.mean)} / ${percentage(m.peers.min)}–${percentage(m.peers.max)} / n=${m.peers.n}` : "No peer assessments"}</td><td className="p-2 tabular-nums">{m.credit ? `${(m.credit.mean / 100).toFixed(2)} / ${(m.credit.min / 100).toFixed(2)}–${(m.credit.max / 100).toFixed(2)} / n=${m.credit.n}` : "No recommendations"}</td></tr>)}</tbody></table></div>
    {submitted.map(r => <details key={r.respondent_id} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Response from {cp.roster.find(m => m.id === r.respondent_id)?.name} {r.help_requested ? "· Help requested" : ""}</summary><div className="mt-3 grid gap-2 text-sm"><p>{r.declined ? "Unable to assess" : "Submitted ratings"} · {dateLabel(r.submitted_at!)}</p>{!r.declined && cp.roster.map(m => <p key={m.id}>{m.name}: work {percentage(r.actual?.[m.id] ?? null)}, credit {((r.credit?.[m.id] ?? 0) / 100).toFixed(2)} points</p>)}<p className="whitespace-pre-wrap">{r.explanation || "No explanation provided."}</p></div></details>)}
    <details><summary className="cursor-pointer text-sm">Change deadline or reopen</summary><div className="mt-3 grid gap-3"><label className="grid gap-1 text-sm">New deadline in your device’s local time<Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /></label><Button size="lg" className="justify-self-start" disabled={busy || !deadline} onClick={() => void command("reopen", { id: cp.id, deadline: new Date(deadline).toISOString() })}>Set new deadline</Button></div></details>
  </div>;
}

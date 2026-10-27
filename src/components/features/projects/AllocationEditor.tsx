"use client";

import { useId, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { equalAllocation, rebalance, type Allocation, type ContributionMember } from "@/lib/contributions";
import styles from "./AllocationEditor.module.css";

export function AllocationEditor({ title, members, value, onChange, reference, me, disabled = false, points = false }: {
  title: string; members: ContributionMember[]; value: Allocation;
  onChange: (value: Allocation) => void; reference?: Allocation; me?: string | null;
  disabled?: boolean; points?: boolean;
}) {
  const prefix = useId();
  const [locked, setLocked] = useState<string[]>([]);
  return <fieldset disabled={disabled} className="min-w-0 grid gap-3">
    <legend className="mb-3 text-base font-semibold">{title}</legend>
    <p className="text-sm text-foreground/75">Total: 100{points ? " points" : "%"}. Adjusting one bar redistributes the rest. Lock values to hold them steady.</p>
    {members.map(member => {
      const id = `${prefix}-${member.id}`;
      const isLocked = locked.includes(member.id);
      const canMove = !isLocked && members.some(m => m.id !== member.id && !locked.includes(m.id));
      return <div key={member.id} className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={id} className="min-w-0 break-words text-sm font-medium">{member.name}{member.id === me ? " (You)" : ""}</label>
          <label className="flex min-h-11 items-center gap-2 text-xs">
            <input type="checkbox" checked={isLocked} onChange={() => setLocked(old => isLocked ? old.filter(x => x !== member.id) : [...old, member.id])} /> Lock {member.name}
          </label>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
          {reference && <span aria-hidden="true" className="pointer-events-none absolute top-1 h-9 border-l-2 border-foreground" style={{ left: `${reference[member.id] / 100}%` }} />}
          <input id={id} type="range" min="0" max="10000" step="1"
            className={`${styles.slider} h-11 w-full min-w-0 focus-visible:outline-2 focus-visible:outline-ring`}
            style={{ "--fill": `${(value[member.id] ?? 0) / 100}%` } as CSSProperties}
            aria-valuetext={`${(value[member.id] / 100).toFixed(2)}${points ? " points" : " percent"}`}
            value={value[member.id] ?? 0} disabled={!canMove}
            onChange={e => onChange(rebalance(value, member.id, Number(e.target.value), locked))} />
          </div>
          <Input type="number" min="0" max="100" step="0.01" className="min-h-11 w-24 tabular-nums"
            aria-label={`${member.name} ${points ? "points" : "percent"}`}
            value={Number(((value[member.id] ?? 0) / 100).toFixed(2))} disabled={!canMove}
            onChange={e => onChange(rebalance(value, member.id, e.target.valueAsNumber * 100, locked))} />
        </div>
        {reference && <p className="text-xs text-foreground/75">Agreed: {((reference[member.id] ?? 0) / 100).toFixed(2)}%</p>}
      </div>;
    })}
    <Button size="lg" type="button" variant="outline" className="justify-self-start" onClick={() => { setLocked([]); onChange(equalAllocation(members.map(m => m.id))); }}>Reset to equal</Button>
  </fieldset>;
}

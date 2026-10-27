import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ContributionPanel } from "../../src/components/features/projects/ContributionPanel";
import { equalAllocation, type ContributionResponse } from "../../src/lib/contributions";
import "../../src/app/globals.css";

const roster = ["Amara Chen", "Mateo Ellis", "Priya Shah", "Theo Brooks"].map((name, i) => ({ id: `member-${i}`, profile_id: `profile-${i}`, name }));
const shares = equalAllocation(roster.map(m => m.id));
const agreement = {id:"agreement",team_id:"team",course_id:"course",roster,shares,confirmations:roster.map(m=>m.id),confirmed_at:"2026-10-27T14:00:00Z",created_at:"2026-10-27T13:00:00Z",note:""};
const checkpoint = {id:"checkpoint",team_id:"team",course_id:"course",title:"Final project reflection",deadline:"2099-01-01T04:59:00Z",roster,agreement_id:"agreement",created_at:"2026-10-27T14:01:00Z"};
const responses: ContributionResponse[] = roster.slice(0,3).map((m,i)=>({checkpoint_id:"checkpoint",respondent_id:m.id,respondent_profile_id:m.profile_id!,course_id:"course",actual:i===0?{"member-0":3500,"member-1":3000,"member-2":2500,"member-3":1000}:shares,credit:shares,declined:false,explanation:i===0?"We agreed to redistribute the work and keep credit equal.":"",help_requested:i===0,submitted_at:"2026-10-27T15:00:00Z",revision:1,updated_at:"2026-10-27T15:00:00Z"}));
function Preview() {
  const [view,setView]=useState("student");
  return <main className="mx-auto grid max-w-5xl gap-6 p-4 text-foreground sm:p-8">
    <div className="grid gap-3 rounded-lg border p-4"><p className="text-sm font-semibold">Local preview · fictional data · no database writes</p><label className="grid gap-2 text-sm">Preview scenario<select className="min-h-11 rounded-lg border bg-background p-2" value={view} onChange={e=>setView(e.target.value)}><option value="student">Student check-in</option><option value="instructor">Instructor review</option><option value="pending">Pending work split</option><option value="empty">First work split</option></select></label></div>
    <h1 className="text-2xl font-semibold">Community research project</h1>
    <ContributionPanel key={view} courseId="course" projectId="project" teamId="team" members={roster}
      agreements={view==="empty"?[]:view==="pending"?[{...agreement,id:"proposal",confirmed_at:null,confirmations:[roster[1].id]},agreement]:[agreement]}
      checkpoints={view==="empty"||view==="pending"?[]:[checkpoint]} responses={view==="instructor"?responses:[]}
      me={view==="instructor"?null:roster[0].id} isProfessor={view==="instructor"} now="2026-10-27T16:00:00Z" brief="Work together to investigate a community research question. Agree on a workable split and reflect privately on the result."/>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);

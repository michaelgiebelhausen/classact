import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AllocationEditor } from "./AllocationEditor";
import { ContributionPanel } from "./ContributionPanel";
import { equalAllocation } from "@/lib/contributions";
const mocks=vi.hoisted(()=>({command:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/server/actions/contributions",()=>({contributionCommand:mocks.command}));
const members=["Amara","Mateo","Priya","Theo"].map((name,i)=>({id:String(i),name,profile_id:`p${i}`}));
const shares=equalAllocation(members.map(m=>m.id));
const agreement={id:"a",team_id:"team",course_id:"course",roster:members,shares,confirmations:members.map(m=>m.id),confirmed_at:"2026-10-27T12:00:00Z",created_at:"2026-10-27T11:00:00Z",note:""};
const checkpoint={id:"cp",team_id:"team",course_id:"course",roster:members,title:"Reflection",deadline:"2026-10-30T12:00:00Z",agreement_id:"a",created_at:"2026-10-27T12:00:00Z"};
const props={courseId:"course",projectId:"project",teamId:"team",members,agreements:[agreement],checkpoints:[checkpoint],responses:[],me:"0",isProfessor:false,now:"2026-10-27T13:00:00Z",brief:"Fictional brief"};
beforeEach(()=>{vi.clearAllMocks();mocks.command.mockResolvedValue({ok:true});});
describe("allocation controls",()=>{
  it("provides named keyboard-native sliders and numeric inputs with locks",()=>{
    const onChange=vi.fn(); render(<AllocationEditor title="Work" members={members} value={shares} onChange={onChange}/>);
    expect(screen.getAllByRole("slider")).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("Amara percent"),{target:{value:"40"}});
    expect(onChange.mock.calls[0][0]).toEqual({"0":4000,"1":2000,"2":2000,"3":2000});
    fireEvent.click(screen.getByLabelText("Lock Amara")); expect(screen.getByLabelText("Amara percent")).toBeDisabled();
    fireEvent.click(screen.getByText("Reset to equal")); expect(onChange).toHaveBeenLastCalledWith(shares);
  });
});
describe("private check-in flow",()=>{
  it("keeps defaults unsubmitted until explicit submission",async()=>{
    render(<ContributionPanel {...props}/>);
    expect(mocks.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Submit private check-in"));
    await waitFor(()=>expect(mocks.command).toHaveBeenCalledWith("course","project","team","save",expect.objectContaining({submit:true,revision:0,actual:shares,credit:shares})));
  });
  it("saves drafts without submission and can copy contribution estimates",async()=>{
    render(<ContributionPanel {...props}/>);
    const actual=screen.getByRole("group",{name:"Actual contribution"});
    fireEvent.change(within(actual).getByLabelText("Amara percent"),{target:{value:"40"}});
    expect(screen.getByText("Submit private check-in")).toBeDisabled();
    fireEvent.click(screen.getByText("Use my contribution estimates"));
    expect(screen.getByText("Submit private check-in")).toBeEnabled();
    fireEvent.click(screen.getByText("Save private draft"));
    await waitFor(()=>expect(mocks.command).toHaveBeenCalledWith("course","project","team","save",expect.objectContaining({submit:false,credit:{"0":4000,"1":2000,"2":2000,"3":2000}})));
  });
  it("supports inability to assess without treating equal defaults as ratings",async()=>{
    render(<ContributionPanel {...props}/>);
    fireEvent.click(screen.getByLabelText("I don't have enough information to assess this"));
    expect(screen.queryByRole("group",{name:"Actual contribution"})).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Submit private check-in"));
    await waitFor(()=>expect(mocks.command).toHaveBeenCalledWith("course","project","team","save",expect.objectContaining({declined:true,submit:true})));
  });
  it("disables saving when the server-provided deadline is closed",()=>{
    render(<ContributionPanel {...props} now="2026-11-01T00:00:00Z"/>);
    expect(screen.getByText("Submit private check-in")).toBeDisabled();
  });
  it("shows instructor completion and missing evidence without zero estimates",()=>{
    render(<ContributionPanel {...props} isProfessor me={null}/>);
    expect(screen.getByText(/0 of 4 submitted/)).toBeInTheDocument();
    expect(screen.getAllByText("No peer assessments")).toHaveLength(4);
    expect(screen.queryByText("Submit private check-in")).not.toBeInTheDocument();
  });
  it("reports connection errors without discarding entered values",async()=>{
    mocks.command.mockRejectedValue(new Error("offline")); render(<ContributionPanel {...props}/>);
    fireEvent.click(screen.getByText("Submit private check-in"));
    await waitFor(()=>expect(screen.getByRole("status")).toHaveTextContent("Connection failed"));
    expect(screen.getByText("Submit private check-in")).toBeEnabled();
  });
});

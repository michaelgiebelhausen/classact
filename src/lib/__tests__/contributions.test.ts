import { describe, expect, it } from "vitest";
import { equalAllocation, rebalance, validAllocation, needsExplanation, summarizeContributions, type Allocation, type ContributionResponse } from "../contributions";
import { participationScore } from "../participation";

describe("exact contribution allocations", () => {
  it("starts equal, including deterministic rounding for odd team sizes", () => {
    expect(equalAllocation(["a","b","c","d"])).toEqual({a:2500,b:2500,c:2500,d:2500});
    expect(equalAllocation(["a","b","c"])).toEqual({a:3334,b:3333,c:3333});
    expect(equalAllocation([])).toEqual({});
  });
  it("redistributes zero weights equally and preserves locks and bounds", () => {
    expect(rebalance({a:10000,b:0,c:0},"a",5000)).toEqual({a:5000,b:2500,c:2500});
    expect(rebalance({a:2500,b:2500,c:5000},"a",10000,["c"])).toEqual({a:5000,b:0,c:5000});
    expect(rebalance({a:5000,b:5000},"a",2000,["b"])).toEqual({a:5000,b:5000});
  });
  it("keeps exact totals through thousands of deterministic adjustments", () => {
    for(let size=1;size<=20;size++) {
      const ids=Array.from({length:size},(_,i)=>String(i)); let values=equalAllocation(ids);
      for(let n=0;n<200;n++) {
        values=rebalance(values,ids[n%size],(n*137)%13000-1000,n%3===0?[ids[(n+1)%size]]:[]);
        expect(validAllocation(values,ids)).toBe(true);
      }
    }
  });
  it("rejects missing, extra, fractional and non-finite entries", () => {
    const invalid: Allocation[] = [{a:10000},{a:5000,b:5000,c:0},{a:5000.5,b:4999.5},{a:NaN,b:10000}];
    for(const value of invalid) expect(validAllocation(value,["a","b"])).toBe(false);
  });
  it("requires explanations for zero work or over one point difference", () => {
    expect(needsExplanation({a:5000,b:5000},{a:5100,b:4900})).toBe(false);
    expect(needsExplanation({a:5000,b:5000},{a:5101,b:4899})).toBe(true);
    expect(needsExplanation({a:0,b:10000},{a:0,b:10000})).toBe(true);
  });
});

describe("private assessment summaries", () => {
  it("separates self from peers, excludes drafts and declines, preserves missing", () => {
    const roster=[{id:"a",name:"A",profile_id:"pa"},{id:"b",name:"B",profile_id:"pb"}];
    const base={checkpoint_id:"cp",course_id:"course",explanation:"",help_requested:false,updated_at:"",revision:1,respondent_profile_id:"pa",credit:{a:5000,b:5000},declined:false,submitted_at:"2026-10-27"};
    const responses: ContributionResponse[]=[{...base,respondent_id:"a",actual:{a:7000,b:3000}},{...base,respondent_id:"b",actual:{a:4000,b:6000},submitted_at:null}];
    const result=summarizeContributions(roster,responses);
    expect(result[0].self).toBe(7000); expect(result[0].peers).toBeNull();
    expect(result[1].self).toBeNull(); expect(result[1].peers).toEqual({mean:3000,min:3000,max:3000,n:1});
    expect(summarizeContributions(roster,[{...responses[0],declined:true}])[0].credit).toBeNull();
  });
  it("does not count unavailable task evidence as zero participation", () => {
    expect(participationScore({attendance:80},[{key:"attendance",label:"Attendance",weight:0.5},{key:"work-ethic",label:"Work",weight:0.5}])).toBe(80);
  });
});

import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({getUser:vi.fn(),from:vi.fn(),rpc:vi.fn(),revalidate:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:mocks.getUser},from:mocks.from,rpc:mocks.rpc})}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
import { contributionCommand } from "./contributions";
beforeEach(()=>{vi.resetAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:"student"}}});});
it("rejects unsigned callers before reading project records",async()=>{
  mocks.getUser.mockResolvedValue({data:{user:null}});
  expect((await contributionCommand("c","p","t","save",{})).ok).toBe(false);
  expect(mocks.from).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects teams outside the specified course and project",async()=>{
  const b={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:null})};mocks.from.mockReturnValue(b);
  expect((await contributionCommand("c","p","t","save",{})).ok).toBe(false);
  expect(b.eq).toHaveBeenCalledWith("course_id","c");expect(b.eq).toHaveBeenCalledWith("project_id","p");expect(mocks.rpc).not.toHaveBeenCalled();
});
it("preserves database authorization failures and only revalidates on success",async()=>{
  mocks.from.mockReturnValue({select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{id:"t"}})});
  mocks.rpc.mockResolvedValue({error:{code:"P0001",message:"This checkpoint is closed."}});
  expect(await contributionCommand("c","p","t","save",{})).toEqual({ok:false,error:"This checkpoint is closed."});expect(mocks.revalidate).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({error:null});expect((await contributionCommand("c","p","t","save",{})).ok).toBe(true);expect(mocks.revalidate).toHaveBeenCalledWith("/course/c/projects/p");
});

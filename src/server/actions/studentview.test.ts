import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({getUser:vi.fn(),from:vi.fn(),admin:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.getUser},from:m.from})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:m.admin}));
vi.mock('@/lib/env',()=>({isConfigured:{supabaseAdmin:true}}));
import { enterStudentView, reopenPracticeAssignments } from './studentview';
const query=(data:unknown)=>({select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data})});
beforeEach(()=>{vi.resetAllMocks();m.getUser.mockResolvedValue({data:{user:{id:'teacher'}}});});
it('rejects anonymous entry before any privileged operation',async()=>{
  m.getUser.mockResolvedValue({data:{user:null}});
  expect((await enterStudentView('source','/course/source')).ok).toBe(false);
  expect(m.admin).not.toHaveBeenCalled();
});
it('rejects another instructors course and reset before any privileged operation',async()=>{
  m.from.mockReturnValue(query({id:'source',professor_id:'another',practice_source_id:null}));
  expect((await enterStudentView('source','/course/source',true)).ok).toBe(false);
  expect(m.admin).not.toHaveBeenCalled();
});
it('cannot recursively preview a practice course',async()=>{
  m.from.mockReturnValue(query({id:'practice',professor_id:'teacher',practice_source_id:'source'}));
  expect((await enterStudentView('practice','/course/practice')).ok).toBe(false);
  expect(m.admin).not.toHaveBeenCalled();
});
it('never reopens assignments in the live course',async()=>{
  m.from.mockReturnValue(query({practice_source_id:null,practice_instructor_id:null}));
  expect((await reopenPracticeAssignments('source')).ok).toBe(false);
  expect(m.admin).not.toHaveBeenCalled();
});
it('refuses practice management after ownership of its source changes',async()=>{
  m.from.mockReturnValueOnce(query({practice_source_id:'source',practice_instructor_id:'teacher'})).mockReturnValueOnce(query({professor_id:'another'}));
  expect((await reopenPracticeAssignments('practice')).ok).toBe(false);
  expect(m.admin).not.toHaveBeenCalled();
});

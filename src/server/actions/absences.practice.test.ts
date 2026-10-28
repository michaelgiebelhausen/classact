import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({from:vi.fn(),send:vi.fn(),getOwner:vi.fn(),practice:true}));
vi.mock('server-only',()=>({}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'teacher'}}})}})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({from:m.from,auth:{admin:{getUserById:m.getOwner}}})}));
vi.mock('@/lib/email',()=>({sendAbsenceAppealNotification:m.send}));
vi.mock('@/lib/env',()=>({isConfigured:{supabaseAdmin:true},env:{}}));
import { appealAbsence } from './absences';
beforeEach(()=>{
  vi.clearAllMocks();m.practice=true;
  m.getOwner.mockResolvedValue({data:{user:{email:'instructor@example.invalid'}}});
  m.from.mockImplementation((table:string)=>({
    select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),update:vi.fn().mockReturnThis(),
    then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve),
    maybeSingle:async()=>({data:{id:'absence',course_id:'course',absence_date:'2026-10-28',category:'illness',enrollments:{profile_id:'teacher',roster_name:'Practice student'}}}),
    single:async()=>({data:table==='courses'?{name:'Course',professor_id:'owner',practice_source_id:m.practice?'source':null}:null}),
  }));
});
it('saves a practice appeal without resolving a recipient or sending email',async()=>{
  expect(await appealAbsence('absence','Please review this fictional absence.')).toEqual({ok:true});
  expect(m.getOwner).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
it('preserves the normal course appeal notification',async()=>{
  m.practice=false;
  expect(await appealAbsence('absence','Please review this fictional absence.')).toEqual({ok:true});
  expect(m.send).toHaveBeenCalledOnce();
});

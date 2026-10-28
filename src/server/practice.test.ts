import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({single:vi.fn(),update:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/env',()=>({isConfigured:{supabaseAdmin:true}}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({from:()=>({select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),single:m.single,update:m.update})})}));
import { isPracticeCourse } from './practice';
import { flagAbsencesElsewhere, checkedInElsewhere } from './absences';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/db';
beforeEach(()=>vi.resetAllMocks());
it('uses the authorized member client without requiring an administrator key',async()=>{
  const member={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{practice_source_id:null}})})})})};
  expect(await isPracticeCourse('real',member as unknown as SupabaseClient<Database>)).toBe(false);
  expect(m.single).not.toHaveBeenCalled();
});
it('fails closed on a missing course or schema error',async()=>{
  m.single.mockResolvedValue({data:null,error:{code:'42703'}});
  await expect(isPracticeCourse('course')).rejects.toThrow('Could not verify');
});
it('practice attendance cannot flag real absences or become cross-course evidence',async()=>{
  m.single.mockResolvedValue({data:{practice_source_id:'source'}});
  await flagAbsencesElsewhere('teacher','practice','2026-10-28');
  expect(await checkedInElsewhere('teacher','practice','2026-10-28')).toBe(false);
  expect(m.update).not.toHaveBeenCalled();
});

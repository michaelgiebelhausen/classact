// Isolated PostgreSQL/WASM: real migrations, synthetic records, no network.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import('../../.classact-verification/node_modules/@electric-sql/pglite/dist/index.js');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_user::text$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
create publication supabase_realtime;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;`);
const migrations = new URL('../supabase/migrations/', import.meta.url);
for (const file of (await readdir(migrations)).sort()) {
  if (!file.endsWith('.sql') || /^(0048|0049)_/.test(file)) continue; // platform cron extensions only
  try { await db.exec(await readFile(new URL(file,migrations),'utf8')); }
  catch(e) { console.error('Migration failed:',file,e.message); process.exit(1); }
}
await db.exec('grant select,insert,update,delete on all tables in schema public,storage to authenticated; grant all on all tables in schema public,auth,storage to service_role;');

const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const teacher=id(1), a=id(2), b=id(3), c=id(4), course=id(10), session=id(11), second=id(12);
for(const who of [teacher,a,b,c]) await db.query(`insert into auth.users(id,email) values($1,$2)`,[who,`${who}@example.invalid`]);
await db.query(`insert into courses(id,professor_id,name,join_code,timezone) values($1,$2,'Attendance test','ATTEND','UTC')`,[course,teacher]);
for(const [i,who] of [a,b,c].entries()) {
 await db.query(`insert into enrollments(id,course_id,profile_id,roster_name,roster_email,status) values($1,$2,$3,$4,$5,'active')`,[id(20+i),course,who,`Student ${i}`,`${who}@example.invalid`]);
 await db.query(`insert into seats(id,course_id,label,x,y,neighbors) values($1,$2,$3,$4,0,$5)`,[id(30+i),course,`A${i}`,i,JSON.stringify({left:`A${i-1}`,right:`A${i+1}`})]);
}
await db.query(`insert into class_sessions(id,course_id,session_date) values($1,$2,'2026-01-01'),($3,$2,'2026-01-02')`,[session,course,second]);
const rows=async(q,args=[]) => (await db.query(q,args)).rows;
const as=async who=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec('set role authenticated');};
await as(a);
await assert.rejects(()=>db.query(`select set_attendance_exclusions($1,array['2026-01-01'::date],true,'Exam')`,[course]),/Only the course instructor/);
await assert.rejects(()=>db.query(`select pledge_late_checkin($1,$2,false)`,[session,id(30)]),/Affirm/);
await assert.rejects(()=>db.query(`select pledge_late_checkin($1,$2,true)`,[session,id(999)]),/Choose a seat/);
await db.query(`select pledge_late_checkin($1,$2,true)`,[session,id(30)]);
await assert.rejects(()=>db.query(`select pledge_late_checkin($1,$2,true)`,[session,id(30)]),/already have attendance/);
await as(b);
await assert.rejects(()=>db.query(`select pledge_late_checkin($1,$2,true)`,[session,id(31)]),/recorded neighbor/);
const request=(await rows('select request_late_checkin($1,$2) id',[session,id(31)]))[0].id;
await as(c);
await assert.rejects(()=>db.query(`select respond_late_checkin($1,'confirm',true)`,[request]),/not awaiting your response/);
await as(a);
await assert.rejects(()=>db.query(`select respond_late_checkin($1,'confirm')`,[request]),/Affirm/);
await db.query(`select respond_late_checkin($1,'confirm',true)`,[request]);
await db.exec('reset role');
assert.equal((await rows('select count(*)::int n from check_ins where session_id=$1 and verified and not is_new_seat',[session]))[0].n,2);
assert.match((await rows('select pledge_text from late_checkin_requests where enrollment_id=$1',[id(20)]))[0].pledge_text,/university’s academic integrity expectations/);
assert.match((await rows('select pledge_text from late_checkin_witnesses where request_id=$1',[request]))[0].pledge_text,/personally saw/);
await db.query(`insert into absences(course_id,enrollment_id,absence_date,category,explanation,ai_verdict,ai_legitimacy,ai_summary,ai_reason,assessment_pending) values($1,$2,'2026-01-02','illness','Fictional absence','unexcused',50,'Pending','Pending',true)`,[course,id(22)]);
await as(c);
await assert.rejects(()=>db.query(`select pledge_late_checkin($1,$2,true)`,[second,id(32)]),/reported an absence/);
await assert.rejects(()=>db.query(`select request_late_checkin($1,$2)`,[second,id(32)]),/reported an absence/);
await as(teacher);
await db.query(`select set_attendance_exclusions($1,array['2026-01-01'::date,'2026-01-03'::date],true,'Exam')`,[course]);
assert.equal((await rows('select attendance_required from class_sessions where id=$1',[session]))[0].attendance_required,false);
assert.equal((await rows('select count(*)::int n from check_ins where session_id=$1',[session]))[0].n,2);
await db.query(`insert into class_sessions(course_id,session_date) values($1,'2026-01-03')`,[course]);
assert.equal((await rows(`select attendance_required from class_sessions where course_id=$1 and session_date='2026-01-03'`,[course]))[0].attendance_required,false);
await as(a);
await assert.rejects(()=>db.query(`update check_ins set session_id=$1 where enrollment_id=$2 and session_id=$3`,[second,id(20),session]),/Attendance identity cannot be changed/);
await as(c);
await assert.rejects(()=>db.query(`select pledge_late_checkin($1,$2,true)`,[session,id(32)]),/not required/);
await assert.rejects(()=>db.query(`select request_late_checkin($1,$2)`,[session,id(32)]),/not required/);
await assert.rejects(()=>db.query(`insert into check_ins(session_id,enrollment_id,seat_id) values($1,$2,$3)`,[session,id(22),id(32)]),/not required/);
await as(teacher);
await db.query(`select set_attendance_exclusions($1,array['2026-01-01'::date],false,'')`,[course]);
assert.equal((await rows('select attendance_required from class_sessions where id=$1',[session]))[0].attendance_required,true);
await db.exec('reset role; set role anon');
await assert.rejects(()=>db.query(`select pledge_late_checkin($1,$2,true)`,[second,id(32)]),/permission denied/);
await db.close();
console.log('Attendance recovery: pledges, witness eligibility, explicit affirmations, absence suppression, exclusions, restoration and access checks passed.');

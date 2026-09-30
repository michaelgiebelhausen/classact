-- The grading tick: grading runs on its own.
--
-- AI grading used to advance only while the professor kept the assignment
-- page open — their browser turned the crank two submissions at a time. Close
-- the tab and it stopped: NB03–NB05 sat half-graded for two weeks, and nothing
-- started until the professor remembered to press Start. Now pg_cron pings
-- the app every minute; each tick starts grading on anything past its
-- deadline, resumes anything stalled, and scores late submissions as they
-- arrive (submissions stay open until the professor publishes).
--
-- Vercel's Hobby plan only runs its own crons once a day, so the clock lives
-- here. pg_net fires the request and doesn't wait; the endpoint answers 202 at
-- once and does the work in the background.
--
-- No schema changes: the engine keeps its lock and retry bookkeeping inside
-- assignments.analysis.
--
-- BEFORE running this, put the shared secret in Vault, then copy it into the
-- CRON_SECRET env var on Vercel (HANDOFF.md, "Grading runs on its own"):
--
--   select vault.create_secret(
--     replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
--     'grading_tick_secret');
--   select decrypted_secret from vault.decrypted_secrets where name = 'grading_tick_secret';
--
-- To rotate it later: select vault.update_secret(id, '<new>') using the id
-- from vault.secrets where name = 'grading_tick_secret', then update Vercel.
--
-- To stop the tick:  select cron.unschedule('grading-tick');
-- To see recent runs: select * from cron.job_run_details
--                     where jobid = (select jobid from cron.job where jobname = 'grading-tick')
--                     order by start_time desc limit 20;
-- And the HTTP answers: select status_code, content, created
--                       from net._http_response order by created desc limit 20;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: re-running replaces the job instead of stacking a second one.
select cron.unschedule(jobid) from cron.job where jobname = 'grading-tick';

select cron.schedule(
  'grading-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://classact.college/api/cron/grading',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'grading_tick_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

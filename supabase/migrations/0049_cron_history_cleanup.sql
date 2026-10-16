-- Keep pg_cron's run history small.
--
-- pg_cron writes a row to cron.job_run_details for every run, and the grading
-- tick (0048) runs every minute: ~1,440 rows a day, forever. Nothing reads
-- them except a person checking that the tick is alive, so keep only what
-- that check needs:
--
--   * successful runs for 1 hour (enough to see the tick is still firing)
--   * failed runs for 7 days (enough to notice and debug a problem)
--
-- That caps the table at roughly a hundred rows. The cleanup runs every 10
-- minutes and its own rows are swept with everything else.
--
-- Turning history off outright (cron.log_run = off) is a server setting that
-- Supabase doesn't expose, so a sweep is the compact option. pg_net's
-- net._http_response already clears itself (6-hour TTL), so it needs nothing.
--
-- To stop the sweep: select cron.unschedule('cron-history-cleanup');

create extension if not exists pg_cron;

-- Idempotent: re-running replaces the job instead of stacking a second one.
select cron.unschedule(jobid) from cron.job where jobname = 'cron-history-cleanup';

select cron.schedule(
  'cron-history-cleanup',
  '*/10 * * * *',
  $$
  delete from cron.job_run_details
  where (status = 'succeeded' and end_time < now() - interval '1 hour')
     or start_time < now() - interval '7 days';
  $$
);

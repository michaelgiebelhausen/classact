-- ClassAct — 0039: retire the freeform note blobs.
--
-- 0038 replaced one text blob per student per lecture with page-stamped
-- entries, and imported every existing blob as an unstamped entry. That import
-- was confirmed against production on 2026-08-28: 24 non-empty blobs, 24
-- imported. Nothing has written to `lecture_notes` since the deploy that
-- removed `saveLectureNotes`, and no code path reads it — the table has been
-- inert, kept only until the import could be verified. It has been.
--
-- The guard below re-verifies that claim at the moment of the drop rather than
-- trusting the count above. If a lecture was live during the migrate→deploy
-- window, the old build could have written a blob *after* the import ran; this
-- migration refuses to destroy it and names the fix. A drop that cannot be
-- undone should be the one statement that checks its own premise.
--
-- One consequence worth stating plainly: this forecloses rolling back to a
-- build older than 0038. That code writes student notes here, and here will no
-- longer exist. The notes themselves are not at risk — they live in
-- `lecture_note_entries` — but a rollback past this point stops note-taking
-- rather than merely reverting it.

do $drop_guard$
declare
  unimported int;
begin
  select count(*)
    into unimported
  from public.lecture_notes n
  where n.content <> ''
    and not exists (
      select 1
      from public.lecture_note_entries e
      where e.lecture_id = n.lecture_id
        and e.enrollment_id = n.enrollment_id
        and e.page is null
    );

  if unimported > 0 then
    raise exception
      'Refusing to drop lecture_notes: % freeform note(s) were never imported. '
      'Re-run the insert…select at the bottom of 0038_note_entries.sql, then '
      'run this migration again.', unimported;
  end if;
end
$drop_guard$;

-- No cascade, deliberately: the index and the `notes_all_own` policy fall with
-- the table, and anything else that turns out to depend on it should stop this
-- migration and get looked at, not be swept away by it.
drop table if exists public.lecture_notes;

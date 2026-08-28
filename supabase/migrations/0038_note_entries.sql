-- ClassAct — 0038: notes become entries, each stamped with the slide it was about.
--
-- Students were typing notes into ClassAct and then pasting them into a Word
-- document, because nothing in the app told them what became of the text. The
-- text was in fact saved the whole time — one freeform blob per student per
-- lecture — but a blob nobody can retrieve after class is indistinguishable
-- from a blob that was thrown away. Both problems are the same problem: notes
-- were never treated as something the student keeps.
--
-- So each committed thought is its own row now, stamped with the slide that
-- was on screen when it was typed. That is the one thing the app knows and a
-- notebook doesn't, and it is what makes an export worth reading later: a
-- semester of notes filed under the slide that prompted them.
--
-- `page` is nullable rather than defaulted, because the freeform notes being
-- imported below were never about a particular slide. Recording them as
-- "slide 1" would be inventing a fact; null says honestly that we don't know,
-- and the app files those under "General notes".
--
-- Privacy is inherited deliberately and exactly: like `lecture_notes`, the
-- only policy here is the author's own. The professor has no read path — not
-- a hidden one, not an admin one. A student who suspects otherwise will keep
-- their real thinking in a Word document, which is the behavior this whole
-- change exists to end.

create table if not exists public.lecture_note_entries (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  -- null = not stamped to a slide (the imported freeform notes below).
  page int check (page is null or page >= 1),
  content text not null check (content <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The live feed: one lecture, one student, in the order they thought of things.
create index if not exists idx_note_entries_lecture_enrollment
  on public.lecture_note_entries(lecture_id, enrollment_id, created_at);
-- The Notes page: everything a student wrote in a course, across every lecture.
create index if not exists idx_note_entries_enrollment
  on public.lecture_note_entries(enrollment_id, created_at);

alter table public.lecture_note_entries enable row level security;

-- Private to their author — even the professor can't read them.
-- (Mirrors `notes_all_own` on lecture_notes, deliberately, word for word.)
drop policy if exists note_entries_all_own on public.lecture_note_entries;
create policy note_entries_all_own on public.lecture_note_entries for all
  using (public.owns_enrollment(enrollment_id))
  with check (public.owns_enrollment(enrollment_id));

-- ---------- Import the freeform notes ----------
--
-- Each non-empty blob becomes one unstamped entry, so nobody loses a word they
-- wrote before today. Idempotent by design: this migration is run by hand
-- before the deploy that stops writing blobs, so a lecture that is live during
-- that window will still be writing to `lecture_notes` afterwards. Re-running
-- this statement once after the deploy catches those without duplicating the
-- notes it already imported.
--
-- The guard is "does this student already have an unstamped entry for this
-- lecture" rather than a content match, because the blob keeps growing as they
-- type: matching on content would import the same notes again at every new
-- length. A student who legitimately has one unstamped entry and then adds to
-- their blob is not a case that exists — the deploy that creates unstamped
-- entries is the same deploy that stops blobs being written.

insert into public.lecture_note_entries
  (lecture_id, enrollment_id, page, content, created_at, updated_at)
select n.lecture_id, n.enrollment_id, null, n.content, n.updated_at, n.updated_at
from public.lecture_notes n
where n.content <> ''
  and not exists (
    select 1 from public.lecture_note_entries e
    where e.lecture_id = n.lecture_id
      and e.enrollment_id = n.enrollment_id
      and e.page is null
  );

comment on table public.lecture_notes is
  'LEGACY as of 0038. The freeform blobs were imported into '
  'lecture_note_entries as unstamped (page is null) entries; nothing writes '
  'here any more. Kept until the import is confirmed in production, then '
  'droppable.';

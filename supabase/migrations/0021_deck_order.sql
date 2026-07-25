-- ClassAct — 0021: manual deck order.
-- Decks were listed newest-first, but a course runs in syllabus order, so
-- professors drag them into the sequence they teach. The backfill assigns
-- today's display order (newest first) so nothing appears to move when this
-- lands; re-running is safe because only NULL positions are filled.

alter table public.lecture_decks
  add column if not exists position int;

with ordered as (
  select
    id,
    (row_number() over (partition by course_id order by created_at desc)) - 1 as rn
  from public.lecture_decks
)
update public.lecture_decks d
   set position = o.rn
  from ordered o
 where d.id = o.id
   and d.position is null;

alter table public.lecture_decks
  alter column position set default 0;

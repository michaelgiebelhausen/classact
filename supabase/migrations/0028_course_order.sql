-- 0028: Professors order their own course list.
--
-- The dashboard shows courses as one stack the professor can drag into the
-- order they think in — usually chronological by meeting time. Position is
-- per-course (professors own their courses outright, so no join table);
-- existing rows all start at 0 and keep their created_at order until the
-- professor first drags.

alter table public.courses
  add column if not exists position integer not null default 0;

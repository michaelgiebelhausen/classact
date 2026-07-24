-- ClassAct — 0016: lecture pause windows ("go look it up").
-- The professor can pause a live lecture when the class is sent off to
-- browse on purpose; student tab-away time that overlaps a pause is
-- excluded from all focus scoring. Stored on the lecture row as a jsonb
-- list of {"start": iso, "end": iso | null} — an open pause has end null.
-- Riding the lectures row means pause state reaches students over the
-- realtime publication they already follow for slide sync; writes are
-- covered by the existing professor-only lectures_write policy.

alter table public.lectures
  add column if not exists pauses jsonb not null default '[]'::jsonb;

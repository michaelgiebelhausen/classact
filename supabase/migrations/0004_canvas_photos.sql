-- ClassAct — store a seeded roster photo (e.g. from Canvas) per enrollment.
-- Lives at the enrollment level so it works before a student activates an
-- account. Served only via server-side signed URLs; a student's own uploaded
-- profile_photos always take precedence in the UI.

alter table public.enrollments
  add column if not exists roster_photo_path text;

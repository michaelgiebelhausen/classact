-- ClassAct — private storage bucket for profile photos.
-- Photos live at path `{userId}/{kind}`. Owner has full control; classmates and
-- the professor can read (they share an active course). App normally serves via
-- signed URLs generated server-side.

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

-- Owner can insert/update/delete/select their own folder.
drop policy if exists photos_owner_all on storage.objects;
create policy photos_owner_all on storage.objects for all
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Course members (classmates + professor) can read a student's photos.
drop policy if exists photos_member_read on storage.objects;
create policy photos_member_read on storage.objects for select
  using (
    bucket_id = 'profile-photos'
    and public.shares_active_course( ((storage.foldername(name))[1])::uuid )
  );

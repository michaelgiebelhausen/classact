-- ClassAct — 0023: honor the role chosen at sign-up.
-- handle_new_user() always fell back to the 'student' default, so a
-- professor who signed up got a student account with no way to create a
-- course — the sign-up form now passes role in user metadata and this
-- reads it. Anything other than 'professor' stays a student.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    case
      when new.raw_user_meta_data->>'role' = 'professor' then 'professor'
      else 'student'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 0024: close a billing bypass. profiles_update (0002) lets a user update
-- their own row with NO column restriction, and the course-creation billing
-- gate trusts profiles.founder / comp / subscription_status — so any signed-in
-- user could PATCH /rest/v1/profiles with the public anon key, set
-- founder = true (or subscription_status = 'active'), and never see checkout.
-- Billing fields become writable only by the service role (Stripe webhook,
-- admin tooling) and direct SQL (the dashboard editor).

create or replace function public.protect_billing_columns()
returns trigger
language plpgsql
as $$
begin
  -- PostgREST requests carry the JWT role: browser clients arrive as
  -- 'authenticated' or 'anon'; the service key arrives as 'service_role';
  -- direct SQL in the dashboard has no JWT at all. Only browsers are blocked.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.founder is distinct from old.founder
     or new.comp is distinct from old.comp
     or new.subscription_status is distinct from old.subscription_status
     or new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'billing fields can only be changed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_billing_columns on public.profiles;
create trigger protect_billing_columns
  before update on public.profiles
  for each row execute function public.protect_billing_columns();

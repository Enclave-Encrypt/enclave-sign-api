-- Minimal billing guard primitives for Sign Stripe RPCs (standalone Sign data project).

create or replace function public.begin_billing_mutation()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.billing_mutation', 'allowed', true);
end;
$$;

create or replace function public.billing_mutation_allowed()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.billing_mutation', true), '') = 'allowed';
$$;

revoke all on function public.begin_billing_mutation() from public;
grant execute on function public.begin_billing_mutation() to service_role;

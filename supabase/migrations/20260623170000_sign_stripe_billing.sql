-- SIGN PRODUCT: Stripe subscription billing on sign_accounts.

alter table public.sign_accounts
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'starter', 'business', 'enterprise')),
  add column if not exists billing_period text
    check (billing_period is null or billing_period in ('monthly', 'annual')),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz;

comment on column public.sign_accounts.plan is
  'SIGN PRODUCT: active Sign plan tier.';

comment on column public.sign_accounts.stripe_customer_id is
  'SIGN PRODUCT: Stripe customer for subscription billing.';

create index if not exists sign_accounts_stripe_customer_id_idx
  on public.sign_accounts (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists sign_accounts_stripe_subscription_id_idx
  on public.sign_accounts (stripe_subscription_id)
  where stripe_subscription_id is not null;

create or replace function public.guard_sign_accounts_billing_columns()
returns trigger
language plpgsql
as $$
begin
  if public.billing_mutation_allowed() then
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.billing_period is distinct from old.billing_period
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
     or new.current_period_end is distinct from old.current_period_end then
    raise exception 'Billing fields on sign_accounts cannot be updated directly';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_sign_accounts_billing_columns on public.sign_accounts;
create trigger guard_sign_accounts_billing_columns
before update on public.sign_accounts
for each row
execute function public.guard_sign_accounts_billing_columns();

create or replace function public.apply_sign_subscription(
  p_enclave_user_id uuid,
  p_plan text,
  p_billing_period text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_subscription_status text,
  p_current_period_end timestamptz,
  p_stripe_checkout_session_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_event_id uuid;
begin
  perform public.begin_billing_mutation();

  if p_stripe_checkout_session_id is not null then
    select id
      into existing_event_id
    from public.sign_billing_events
    where stripe_checkout_session_id = p_stripe_checkout_session_id
    limit 1;

    if existing_event_id is not null then
      return;
    end if;
  end if;

  insert into public.sign_accounts (enclave_user_id)
  values (p_enclave_user_id)
  on conflict (enclave_user_id) do nothing;

  update public.sign_accounts
  set
    plan = p_plan,
    billing_period = p_billing_period,
    stripe_customer_id = coalesce(p_stripe_customer_id, stripe_customer_id),
    stripe_subscription_id = coalesce(p_stripe_subscription_id, stripe_subscription_id),
    subscription_status = p_subscription_status,
    current_period_end = p_current_period_end
  where enclave_user_id = p_enclave_user_id;

  if p_stripe_checkout_session_id is not null then
    insert into public.sign_billing_events (
      enclave_user_id,
      event_type,
      stripe_checkout_session_id,
      metadata
    )
    values (
      p_enclave_user_id,
      'checkout_completed',
      p_stripe_checkout_session_id,
      jsonb_build_object(
        'plan', p_plan,
        'billing_period', p_billing_period
      )
    );
  end if;
end;
$$;

create or replace function public.clear_sign_subscription(
  p_stripe_subscription_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.begin_billing_mutation();

  update public.sign_accounts
  set
    plan = 'free',
    billing_period = null,
    stripe_subscription_id = null,
    subscription_status = 'canceled',
    current_period_end = null
  where stripe_subscription_id = p_stripe_subscription_id;
end;
$$;

create table if not exists public.sign_billing_events (
  id uuid primary key default gen_random_uuid(),
  enclave_user_id uuid not null,
  event_type text not null,
  stripe_checkout_session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.sign_billing_events is
  'SIGN PRODUCT: idempotent Stripe billing event ledger.';

create unique index if not exists sign_billing_events_checkout_session_idx
  on public.sign_billing_events (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.sign_billing_events enable row level security;

revoke all on function public.apply_sign_subscription(
  uuid, text, text, text, text, text, timestamptz, text
) from public;
grant execute on function public.apply_sign_subscription(
  uuid, text, text, text, text, text, timestamptz, text
) to service_role;

revoke all on function public.clear_sign_subscription(text) from public;
grant execute on function public.clear_sign_subscription(text) to service_role;

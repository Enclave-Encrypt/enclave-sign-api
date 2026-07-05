-- Drop sign_* prefix from Sign product tables, indexes, policies, functions, and triggers.

-- ---------------------------------------------------------------------------
-- Triggers (must drop before renaming trigger functions)
-- ---------------------------------------------------------------------------

drop trigger if exists guard_sign_accounts_billing_columns on public.sign_accounts;

-- ---------------------------------------------------------------------------
-- RLS policies (drop sign_* names; recreated after table renames)
-- ---------------------------------------------------------------------------

drop policy if exists "sign_accounts_select_own" on public.sign_accounts;
drop policy if exists "sign_accounts_insert_own" on public.sign_accounts;
drop policy if exists "sign_accounts_update_own" on public.sign_accounts;

drop policy if exists "sign_envelopes_select_own" on public.sign_envelopes;
drop policy if exists "sign_envelopes_insert_own" on public.sign_envelopes;
drop policy if exists "sign_envelopes_update_own" on public.sign_envelopes;
drop policy if exists "sign_envelopes_delete_own" on public.sign_envelopes;

drop policy if exists "sign_envelope_recipients_select_own" on public.sign_envelope_recipients;
drop policy if exists "sign_envelope_recipients_insert_own" on public.sign_envelope_recipients;
drop policy if exists "sign_envelope_recipients_update_own" on public.sign_envelope_recipients;

drop policy if exists "sign_envelope_documents_select_own" on public.sign_envelope_documents;
drop policy if exists "sign_envelope_documents_insert_own" on public.sign_envelope_documents;

drop policy if exists "sign_envelope_document_keys_select_own" on public.sign_envelope_document_keys;
drop policy if exists "sign_envelope_document_keys_insert_own" on public.sign_envelope_document_keys;

drop policy if exists "sign_envelope_fields_select_own" on public.sign_envelope_fields;
drop policy if exists "sign_envelope_fields_insert_own" on public.sign_envelope_fields;

drop policy if exists "sign_envelope_completed_artifacts_select_own" on public.sign_envelope_completed_artifacts;

drop policy if exists "sign_contacts_select_own" on public.sign_contacts;
drop policy if exists "sign_contacts_insert_own" on public.sign_contacts;
drop policy if exists "sign_contacts_update_own" on public.sign_contacts;
drop policy if exists "sign_contacts_delete_own" on public.sign_contacts;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.sign_accounts rename to accounts;
alter table public.sign_envelopes rename to envelopes;
alter table public.sign_envelope_recipients rename to envelope_recipients;
alter table public.sign_envelope_documents rename to envelope_documents;
alter table public.sign_envelope_document_keys rename to envelope_document_keys;
alter table public.sign_envelope_fields rename to envelope_fields;
alter table public.sign_envelope_completed_artifacts rename to envelope_completed_artifacts;
alter table public.sign_contacts rename to contacts;
alter table public.sign_billing_events rename to billing_events;

comment on table public.accounts is
  'SIGN PRODUCT: one row per Enclave Account user';
comment on table public.envelopes is
  'SIGN PRODUCT: envelope metadata and lifecycle status';
comment on table public.envelope_recipients is
  'SIGN PRODUCT: signers on an envelope';
comment on table public.envelope_documents is
  'SIGN PRODUCT: document metadata for an envelope';
comment on table public.envelope_document_keys is
  'SIGN PRODUCT: per-recipient ML-KEM wrapped document DEKs.';
comment on table public.envelope_fields is
  'SIGN PRODUCT: placed signing fields per document page (normalized coordinates)';
comment on table public.envelope_completed_artifacts is
  'SIGN PRODUCT: flattened PDFs and certificate of completion for download';
comment on table public.contacts is
  'SIGN PRODUCT: saved signer contacts for repeat envelope sends';
comment on table public.billing_events is
  'SIGN PRODUCT: idempotent Stripe billing event ledger.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

alter index if exists sign_accounts_enclave_user_id_idx rename to accounts_enclave_user_id_idx;
alter index if exists sign_accounts_stripe_customer_id_idx rename to accounts_stripe_customer_id_idx;
alter index if exists sign_accounts_stripe_subscription_id_idx rename to accounts_stripe_subscription_id_idx;

alter index if exists sign_envelopes_enclave_user_id_idx rename to envelopes_enclave_user_id_idx;
alter index if exists sign_envelopes_status_idx rename to envelopes_status_idx;

alter index if exists sign_envelope_recipients_envelope_id_idx rename to envelope_recipients_envelope_id_idx;
alter index if exists sign_envelope_recipients_signing_token_hash_idx rename to envelope_recipients_signing_token_hash_idx;

alter index if exists sign_envelope_documents_envelope_id_idx rename to envelope_documents_envelope_id_idx;

alter index if exists sign_envelope_document_keys_document_id_idx rename to envelope_document_keys_document_id_idx;
alter index if exists sign_envelope_document_keys_recipient_id_idx rename to envelope_document_keys_recipient_id_idx;

alter index if exists sign_envelope_fields_envelope_id_idx rename to envelope_fields_envelope_id_idx;
alter index if exists sign_envelope_fields_recipient_id_idx rename to envelope_fields_recipient_id_idx;

alter index if exists sign_envelope_completed_artifacts_envelope_doc_idx rename to envelope_completed_artifacts_envelope_doc_idx;
alter index if exists sign_envelope_completed_artifacts_certificate_idx rename to envelope_completed_artifacts_certificate_idx;
alter index if exists sign_envelope_completed_artifacts_envelope_id_idx rename to envelope_completed_artifacts_envelope_id_idx;

alter index if exists sign_contacts_enclave_user_id_idx rename to contacts_enclave_user_id_idx;

alter index if exists sign_billing_events_checkout_session_idx rename to billing_events_checkout_session_idx;

-- ---------------------------------------------------------------------------
-- Constraints (primary keys, uniques, checks, foreign keys)
-- ---------------------------------------------------------------------------

alter table public.accounts rename constraint sign_accounts_pkey to accounts_pkey;
alter table public.accounts rename constraint sign_accounts_enclave_user_id_key to accounts_enclave_user_id_key;
alter table public.accounts rename constraint sign_accounts_plan_check to accounts_plan_check;
alter table public.accounts rename constraint sign_accounts_billing_period_check to accounts_billing_period_check;

alter table public.envelopes rename constraint sign_envelopes_pkey to envelopes_pkey;
alter table public.envelopes rename constraint sign_envelopes_enclave_user_id_fkey to envelopes_enclave_user_id_fkey;
alter table public.envelopes rename constraint sign_envelopes_status_check to envelopes_status_check;

alter table public.envelope_recipients rename constraint sign_envelope_recipients_pkey to envelope_recipients_pkey;
alter table public.envelope_recipients rename constraint sign_envelope_recipients_envelope_id_fkey to envelope_recipients_envelope_id_fkey;
alter table public.envelope_recipients rename constraint sign_envelope_recipients_status_check to envelope_recipients_status_check;

alter table public.envelope_documents rename constraint sign_envelope_documents_pkey to envelope_documents_pkey;
alter table public.envelope_documents rename constraint sign_envelope_documents_envelope_id_fkey to envelope_documents_envelope_id_fkey;

alter table public.envelope_document_keys rename constraint sign_envelope_document_keys_pkey to envelope_document_keys_pkey;
alter table public.envelope_document_keys rename constraint sign_envelope_document_keys_document_id_fkey to envelope_document_keys_document_id_fkey;
alter table public.envelope_document_keys rename constraint sign_envelope_document_keys_recipient_id_fkey to envelope_document_keys_recipient_id_fkey;
alter table public.envelope_document_keys rename constraint sign_envelope_document_keys_document_id_recipient_id_key to envelope_document_keys_document_id_recipient_id_key;

alter table public.envelope_fields rename constraint sign_envelope_fields_pkey to envelope_fields_pkey;
alter table public.envelope_fields rename constraint sign_envelope_fields_envelope_id_fkey to envelope_fields_envelope_id_fkey;
alter table public.envelope_fields rename constraint sign_envelope_fields_document_id_fkey to envelope_fields_document_id_fkey;
alter table public.envelope_fields rename constraint sign_envelope_fields_recipient_id_fkey to envelope_fields_recipient_id_fkey;
alter table public.envelope_fields rename constraint sign_envelope_fields_field_type_check to envelope_fields_field_type_check;
alter table public.envelope_fields rename constraint sign_envelope_fields_page_index_check to envelope_fields_page_index_check;
alter table public.envelope_fields rename constraint sign_envelope_fields_x_check to envelope_fields_x_check;
alter table public.envelope_fields rename constraint sign_envelope_fields_y_check to envelope_fields_y_check;
alter table public.envelope_fields rename constraint sign_envelope_fields_width_check to envelope_fields_width_check;
alter table public.envelope_fields rename constraint sign_envelope_fields_height_check to envelope_fields_height_check;

alter table public.envelope_completed_artifacts rename constraint sign_envelope_completed_artifacts_pkey to envelope_completed_artifacts_pkey;
alter table public.envelope_completed_artifacts rename constraint sign_envelope_completed_artifacts_envelope_id_fkey to envelope_completed_artifacts_envelope_id_fkey;
alter table public.envelope_completed_artifacts rename constraint sign_envelope_completed_artifacts_document_id_fkey to envelope_completed_artifacts_document_id_fkey;
alter table public.envelope_completed_artifacts rename constraint sign_envelope_completed_artifacts_artifact_type_check to envelope_completed_artifacts_artifact_type_check;

alter table public.contacts rename constraint sign_contacts_pkey to contacts_pkey;
alter table public.contacts rename constraint sign_contacts_email_lowercase to contacts_email_lowercase;
alter table public.contacts rename constraint sign_contacts_enclave_user_id_email_key to contacts_enclave_user_id_email_key;

alter table public.billing_events rename constraint sign_billing_events_pkey to billing_events_pkey;

-- ---------------------------------------------------------------------------
-- RLS policies (unprefixed names, unprefixed table references)
-- ---------------------------------------------------------------------------

create policy "accounts_select_own"
  on public.accounts
  for select
  to authenticated
  using (enclave_user_id = auth.uid());

create policy "accounts_insert_own"
  on public.accounts
  for insert
  to authenticated
  with check (enclave_user_id = auth.uid());

create policy "accounts_update_own"
  on public.accounts
  for update
  to authenticated
  using (enclave_user_id = auth.uid())
  with check (enclave_user_id = auth.uid());

create policy "envelopes_select_own"
  on public.envelopes
  for select
  to authenticated
  using (enclave_user_id = auth.uid());

create policy "envelopes_insert_own"
  on public.envelopes
  for insert
  to authenticated
  with check (enclave_user_id = auth.uid());

create policy "envelopes_update_own"
  on public.envelopes
  for update
  to authenticated
  using (enclave_user_id = auth.uid())
  with check (enclave_user_id = auth.uid());

create policy "envelopes_delete_own"
  on public.envelopes
  for delete
  to authenticated
  using (
    enclave_user_id = auth.uid()
    and status <> 'completed'
  );

create policy "envelope_recipients_select_own"
  on public.envelope_recipients
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_recipients.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_recipients_insert_own"
  on public.envelope_recipients
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_recipients.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_recipients_update_own"
  on public.envelope_recipients
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_recipients.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_recipients.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_documents_select_own"
  on public.envelope_documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_documents.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_documents_insert_own"
  on public.envelope_documents
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_documents.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_document_keys_select_own"
  on public.envelope_document_keys
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.envelope_documents ed
      join public.envelopes e on e.id = ed.envelope_id
      where ed.id = envelope_document_keys.document_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_document_keys_insert_own"
  on public.envelope_document_keys
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.envelope_documents ed
      join public.envelopes e on e.id = ed.envelope_id
      where ed.id = envelope_document_keys.document_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_fields_select_own"
  on public.envelope_fields
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_fields.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_fields_insert_own"
  on public.envelope_fields
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_fields.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "envelope_completed_artifacts_select_own"
  on public.envelope_completed_artifacts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.envelopes e
      where e.id = envelope_completed_artifacts.envelope_id
        and e.enclave_user_id = auth.uid()
    )
  );

create policy "contacts_select_own"
  on public.contacts
  for select
  to authenticated
  using (enclave_user_id = auth.uid());

create policy "contacts_insert_own"
  on public.contacts
  for insert
  to authenticated
  with check (enclave_user_id = auth.uid());

create policy "contacts_update_own"
  on public.contacts
  for update
  to authenticated
  using (enclave_user_id = auth.uid())
  with check (enclave_user_id = auth.uid());

create policy "contacts_delete_own"
  on public.contacts
  for delete
  to authenticated
  using (enclave_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Functions (create unprefixed, drop prefixed)
-- ---------------------------------------------------------------------------

create or replace function public.ensure_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_account public.accounts%rowtype;
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select *
  into existing_account
  from public.accounts
  where enclave_user_id = current_user_id
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_exists', true,
      'account_id', existing_account.id
    );
  end if;

  insert into public.accounts (enclave_user_id)
  values (current_user_id)
  returning * into existing_account;

  return jsonb_build_object(
    'ok', true,
    'already_exists', false,
    'account_id', existing_account.id
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
end;
$$;

create or replace function public.guard_accounts_billing_columns()
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
    raise exception 'Billing fields on accounts cannot be updated directly';
  end if;

  return new;
end;
$$;

create or replace function public.apply_subscription(
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
    from public.billing_events
    where stripe_checkout_session_id = p_stripe_checkout_session_id
    limit 1;

    if existing_event_id is not null then
      return;
    end if;
  end if;

  insert into public.accounts (enclave_user_id)
  values (p_enclave_user_id)
  on conflict (enclave_user_id) do nothing;

  update public.accounts
  set
    plan = p_plan,
    billing_period = p_billing_period,
    stripe_customer_id = coalesce(p_stripe_customer_id, stripe_customer_id),
    stripe_subscription_id = coalesce(p_stripe_subscription_id, stripe_subscription_id),
    subscription_status = p_subscription_status,
    current_period_end = p_current_period_end
  where enclave_user_id = p_enclave_user_id;

  if p_stripe_checkout_session_id is not null then
    insert into public.billing_events (
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

create or replace function public.clear_subscription(
  p_stripe_subscription_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.begin_billing_mutation();

  update public.accounts
  set
    plan = 'free',
    billing_period = null,
    stripe_subscription_id = null,
    subscription_status = 'canceled',
    current_period_end = null
  where stripe_subscription_id = p_stripe_subscription_id;
end;
$$;

drop function if exists public.sign_ensure_account();
drop function if exists public.guard_sign_accounts_billing_columns();
drop function if exists public.apply_sign_subscription(
  uuid, text, text, text, text, text, timestamptz, text
);
drop function if exists public.clear_sign_subscription(text);

revoke all on function public.ensure_account() from public;
grant execute on function public.ensure_account() to authenticated;

revoke all on function public.apply_subscription(
  uuid, text, text, text, text, text, timestamptz, text
) from public;
grant execute on function public.apply_subscription(
  uuid, text, text, text, text, text, timestamptz, text
) to service_role;

revoke all on function public.clear_subscription(text) from public;
grant execute on function public.clear_subscription(text) to service_role;

-- ---------------------------------------------------------------------------
-- Triggers (unprefixed name + function)
-- ---------------------------------------------------------------------------

create trigger guard_accounts_billing_columns
before update on public.accounts
for each row
execute function public.guard_accounts_billing_columns();

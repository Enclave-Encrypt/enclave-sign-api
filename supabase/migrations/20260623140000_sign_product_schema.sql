-- SIGN PRODUCT: Enclave Sign dedicated data project.

create table public.sign_accounts (
  id uuid primary key default gen_random_uuid(),
  enclave_user_id uuid unique not null,
  created_at timestamptz not null default now()
);

comment on table public.sign_accounts is
  'SIGN PRODUCT: one row per Enclave Account user';

create index sign_accounts_enclave_user_id_idx
  on public.sign_accounts (enclave_user_id);

create table public.sign_envelopes (
  id uuid primary key default gen_random_uuid(),
  enclave_user_id uuid not null references public.sign_accounts (enclave_user_id) on delete cascade,
  subject text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'waiting', 'completed', 'voided', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz
);

comment on table public.sign_envelopes is
  'SIGN PRODUCT: envelope metadata and lifecycle status';

create index sign_envelopes_enclave_user_id_idx
  on public.sign_envelopes (enclave_user_id, updated_at desc);

create index sign_envelopes_status_idx
  on public.sign_envelopes (status);

create table public.sign_envelope_recipients (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.sign_envelopes (id) on delete cascade,
  name text,
  email text not null,
  signing_order integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'signed', 'declined')),
  created_at timestamptz not null default now()
);

comment on table public.sign_envelope_recipients is
  'SIGN PRODUCT: signers on an envelope';

create index sign_envelope_recipients_envelope_id_idx
  on public.sign_envelope_recipients (envelope_id, signing_order);

create table public.sign_envelope_documents (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.sign_envelopes (id) on delete cascade,
  file_name text not null,
  storage_path text,
  byte_size bigint,
  content_type text,
  created_at timestamptz not null default now()
);

comment on table public.sign_envelope_documents is
  'SIGN PRODUCT: document metadata for an envelope';

create index sign_envelope_documents_envelope_id_idx
  on public.sign_envelope_documents (envelope_id);

alter table public.sign_accounts enable row level security;
alter table public.sign_envelopes enable row level security;
alter table public.sign_envelope_recipients enable row level security;
alter table public.sign_envelope_documents enable row level security;

create policy "sign_accounts_select_own"
  on public.sign_accounts
  for select
  to authenticated
  using (enclave_user_id = auth.uid());

create policy "sign_accounts_insert_own"
  on public.sign_accounts
  for insert
  to authenticated
  with check (enclave_user_id = auth.uid());

create policy "sign_envelopes_select_own"
  on public.sign_envelopes
  for select
  to authenticated
  using (enclave_user_id = auth.uid());

create policy "sign_envelopes_insert_own"
  on public.sign_envelopes
  for insert
  to authenticated
  with check (enclave_user_id = auth.uid());

create policy "sign_envelopes_update_own"
  on public.sign_envelopes
  for update
  to authenticated
  using (enclave_user_id = auth.uid())
  with check (enclave_user_id = auth.uid());

create policy "sign_envelope_recipients_select_own"
  on public.sign_envelope_recipients
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_recipients.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  );

create policy "sign_envelope_recipients_insert_own"
  on public.sign_envelope_recipients
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_recipients.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  );

create policy "sign_envelope_documents_select_own"
  on public.sign_envelope_documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_documents.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  );

create policy "sign_envelope_documents_insert_own"
  on public.sign_envelope_documents
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_documents.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  );

create or replace function public.sign_ensure_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_account public.sign_accounts%rowtype;
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select *
  into existing_account
  from public.sign_accounts
  where enclave_user_id = current_user_id
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_exists', true,
      'account_id', existing_account.id
    );
  end if;

  insert into public.sign_accounts (enclave_user_id)
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

revoke all on function public.sign_ensure_account() from public;
grant execute on function public.sign_ensure_account() to authenticated;

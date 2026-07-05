-- Saved signer contacts for Enclave Sign (frequent recipients).

create table public.sign_contacts (
  id uuid primary key default gen_random_uuid(),
  enclave_user_id uuid not null,
  name text not null default '',
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sign_contacts_email_lowercase check (email = lower(email)),
  unique (enclave_user_id, email)
);

comment on table public.sign_contacts is
  'SIGN PRODUCT: saved signer contacts for repeat envelope sends';

create index sign_contacts_enclave_user_id_idx
  on public.sign_contacts (enclave_user_id, updated_at desc);

alter table public.sign_contacts enable row level security;

create policy "sign_contacts_select_own"
  on public.sign_contacts
  for select
  to authenticated
  using (enclave_user_id = auth.uid());

create policy "sign_contacts_insert_own"
  on public.sign_contacts
  for insert
  to authenticated
  with check (enclave_user_id = auth.uid());

create policy "sign_contacts_update_own"
  on public.sign_contacts
  for update
  to authenticated
  using (enclave_user_id = auth.uid())
  with check (enclave_user_id = auth.uid());

create policy "sign_contacts_delete_own"
  on public.sign_contacts
  for delete
  to authenticated
  using (enclave_user_id = auth.uid());

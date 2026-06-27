-- SIGN PRODUCT: PQC envelope encryption metadata + encrypted document storage.

alter table public.sign_accounts
  add column if not exists mldsa_public_key text;

comment on column public.sign_accounts.mldsa_public_key is
  'Sender ML-DSA-65 public key (base64url) for envelope manifest signatures.';

create policy "sign_accounts_update_own"
  on public.sign_accounts
  for update
  to authenticated
  using (enclave_user_id = auth.uid())
  with check (enclave_user_id = auth.uid());

alter table public.sign_envelopes
  add column if not exists manifest_signature text,
  add column if not exists manifest_algorithm text not null default 'ML-DSA-65',
  add column if not exists encryption_metadata jsonb not null default '{}'::jsonb;

alter table public.sign_envelope_documents
  add column if not exists content_hash text,
  add column if not exists iv_base64 text,
  add column if not exists encryption_algorithm text not null default 'AES-256-GCM+ML-KEM-768';

alter table public.sign_envelope_recipients
  add column if not exists kem_public_key text,
  add column if not exists encryption_metadata jsonb not null default '{}'::jsonb;

create table public.sign_envelope_document_keys (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.sign_envelope_documents (id) on delete cascade,
  recipient_id uuid not null references public.sign_envelope_recipients (id) on delete cascade,
  kem_ciphertext text not null,
  wrapped_dek_b64 text not null,
  created_at timestamptz not null default now(),
  unique (document_id, recipient_id)
);

comment on table public.sign_envelope_document_keys is
  'SIGN PRODUCT: per-recipient ML-KEM wrapped document DEKs.';

create index sign_envelope_document_keys_document_id_idx
  on public.sign_envelope_document_keys (document_id);

create index sign_envelope_document_keys_recipient_id_idx
  on public.sign_envelope_document_keys (recipient_id);

alter table public.sign_envelope_document_keys enable row level security;

create policy "sign_envelope_document_keys_select_own"
  on public.sign_envelope_document_keys
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sign_envelope_documents sed
      join public.sign_envelopes se on se.id = sed.envelope_id
      where sed.id = sign_envelope_document_keys.document_id
        and se.enclave_user_id = auth.uid()
    )
  );

create policy "sign_envelope_document_keys_insert_own"
  on public.sign_envelope_document_keys
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.sign_envelope_documents sed
      join public.sign_envelopes se on se.id = sed.envelope_id
      where sed.id = sign_envelope_document_keys.document_id
        and se.enclave_user_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('sign-envelope-documents', 'sign-envelope-documents', false)
on conflict (id) do nothing;

drop policy if exists "Sign owners upload encrypted envelope documents" on storage.objects;
create policy "Sign owners upload encrypted envelope documents"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'sign-envelope-documents'
  and owner = auth.uid()
);

drop policy if exists "Sign owners read encrypted envelope documents" on storage.objects;
create policy "Sign owners read encrypted envelope documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'sign-envelope-documents'
  and owner = auth.uid()
);

drop policy if exists "Sign owners delete encrypted envelope documents" on storage.objects;
create policy "Sign owners delete encrypted envelope documents"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'sign-envelope-documents'
  and owner = auth.uid()
);

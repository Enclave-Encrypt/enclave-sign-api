-- SIGN PRODUCT: flattened completed documents + certificate of completion

alter table public.sign_envelopes
  add column if not exists completed_at timestamptz,
  add column if not exists finalized_at timestamptz;

create table public.sign_envelope_completed_artifacts (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.sign_envelopes (id) on delete cascade,
  document_id uuid references public.sign_envelope_documents (id) on delete set null,
  artifact_type text not null
    check (artifact_type in ('document', 'certificate')),
  file_name text not null,
  storage_path text not null,
  byte_size bigint,
  created_at timestamptz not null default now()
);

comment on table public.sign_envelope_completed_artifacts is
  'SIGN PRODUCT: flattened PDFs and certificate of completion for download';

create unique index sign_envelope_completed_artifacts_envelope_doc_idx
  on public.sign_envelope_completed_artifacts (envelope_id, document_id)
  where document_id is not null;

create unique index sign_envelope_completed_artifacts_certificate_idx
  on public.sign_envelope_completed_artifacts (envelope_id)
  where artifact_type = 'certificate';

create index sign_envelope_completed_artifacts_envelope_id_idx
  on public.sign_envelope_completed_artifacts (envelope_id);

alter table public.sign_envelope_completed_artifacts enable row level security;

create policy "sign_envelope_completed_artifacts_select_own"
  on public.sign_envelope_completed_artifacts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_completed_artifacts.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('sign-envelope-completed', 'sign-envelope-completed', false)
on conflict (id) do nothing;

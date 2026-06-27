-- SIGN PRODUCT: envelope field placement (signature, text, date, etc.)

create table public.sign_envelope_fields (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.sign_envelopes (id) on delete cascade,
  document_id uuid not null references public.sign_envelope_documents (id) on delete cascade,
  recipient_id uuid not null references public.sign_envelope_recipients (id) on delete cascade,
  field_type text not null
    check (field_type in ('signature', 'initials', 'date', 'text', 'checkbox', 'name', 'email')),
  page_index integer not null default 0 check (page_index >= 0),
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  width double precision not null check (width > 0 and width <= 1),
  height double precision not null check (height > 0 and height <= 1),
  required boolean not null default true,
  label text,
  placeholder text,
  value text,
  filled_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.sign_envelope_fields is
  'SIGN PRODUCT: placed signing fields per document page (normalized coordinates)';

create index sign_envelope_fields_envelope_id_idx
  on public.sign_envelope_fields (envelope_id);

create index sign_envelope_fields_recipient_id_idx
  on public.sign_envelope_fields (recipient_id, document_id);

alter table public.sign_envelope_fields enable row level security;

create policy "sign_envelope_fields_select_own"
  on public.sign_envelope_fields
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_fields.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  );

create policy "sign_envelope_fields_insert_own"
  on public.sign_envelope_fields
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_fields.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  );

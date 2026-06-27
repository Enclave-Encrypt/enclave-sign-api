-- SIGN PRODUCT: recipient signing tokens + wrapped DEK IVs.

alter table public.sign_envelope_recipients
  add column if not exists signing_token_hash text,
  add column if not exists signed_at timestamptz,
  add column if not exists signature text,
  add column if not exists signature_algorithm text;

create unique index if not exists sign_envelope_recipients_signing_token_hash_idx
  on public.sign_envelope_recipients (signing_token_hash)
  where signing_token_hash is not null;

alter table public.sign_envelope_document_keys
  add column if not exists wrapped_dek_iv_b64 text;

comment on column public.sign_envelope_recipients.signing_token_hash is
  'SHA-256 hex of opaque recipient signing token.';

comment on column public.sign_envelope_document_keys.wrapped_dek_iv_b64 is
  'AES-GCM IV used when wrapping the document DEK with ML-KEM shared secret.';

-- Drop Ed25519 migration artifacts; all credentials use ML-DSA-65.

alter table public.verify_certificates
  alter column proof_algorithm set default 'ML-DSA-65';

alter table public.verify_certificates
  drop column if exists legacy_ed25519_sig;

comment on column public.verify_certificates.proof_algorithm is
  'Credential signature algorithm; ML-DSA-65 only';

-- Restrict envelope owners from forging signing state via PostgREST.
-- Service-role edge functions (auth.uid() is null) bypass these guards.

create or replace function public.guard_envelope_recipients_owner_update()
returns trigger
language plpgsql
as $$
declare
  is_owner boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  select exists (
    select 1
    from public.envelopes e
    where e.id = old.envelope_id
      and e.enclave_user_id = auth.uid()
  ) into is_owner;

  if not is_owner then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.signature is distinct from old.signature
     or new.signature_algorithm is distinct from old.signature_algorithm
     or new.signed_at is distinct from old.signed_at
     or new.encryption_metadata is distinct from old.encryption_metadata
     or new.kem_public_key is distinct from old.kem_public_key
     or new.signing_order is distinct from old.signing_order then
    raise exception 'Envelope owners cannot modify recipient signing state';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_envelope_recipients_owner_update on public.envelope_recipients;

create trigger guard_envelope_recipients_owner_update
  before update on public.envelope_recipients
  for each row
  execute function public.guard_envelope_recipients_owner_update();

create or replace function public.guard_envelopes_owner_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.enclave_user_id is distinct from auth.uid() then
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (old.status in ('sent', 'waiting') and new.status = 'voided') then
      raise exception 'Envelope owners may only void in-progress envelopes';
    end if;
  end if;

  if new.completed_at is distinct from old.completed_at
     or new.finalized_at is distinct from old.finalized_at
     or new.manifest_signature is distinct from old.manifest_signature
     or new.manifest_algorithm is distinct from old.manifest_algorithm
     or new.encryption_metadata is distinct from old.encryption_metadata
     or new.sent_at is distinct from old.sent_at then
    raise exception 'Envelope owners cannot modify protected envelope fields';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_envelopes_owner_update on public.envelopes;

create trigger guard_envelopes_owner_update
  before update on public.envelopes
  for each row
  execute function public.guard_envelopes_owner_update();

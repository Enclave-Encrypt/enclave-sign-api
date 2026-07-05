-- Cross-app identity: relink Sign rows when the same email signs in through
-- Enclave Account with a different auth.users id (no public.users profile table).

create or replace function public.rewrite_enclave_user_id(p_old_id uuid, p_new_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, storage
as $$
begin
  if p_old_id is null or p_new_id is null or p_old_id = p_new_id then
    return;
  end if;

  -- Drop empty stub account for new_id so enclave_user_id unique allows relink.
  delete from public.accounts a
  where a.enclave_user_id = p_new_id
    and not exists (
      select 1 from public.envelopes e where e.enclave_user_id = p_new_id
    )
    and not exists (
      select 1 from public.contacts c where c.enclave_user_id = p_new_id
    );

  update public.envelopes
  set enclave_user_id = p_new_id
  where enclave_user_id = p_old_id;

  update public.contacts
  set enclave_user_id = p_new_id
  where enclave_user_id = p_old_id;

  update public.billing_events
  set enclave_user_id = p_new_id
  where enclave_user_id = p_old_id;

  update public.accounts
  set enclave_user_id = p_new_id
  where enclave_user_id = p_old_id;

  update storage.objects
  set owner = p_new_id
  where owner = p_old_id;
end;
$$;

create or replace function public.migrate_product_identity(
  p_product text,
  p_legacy_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  new_id uuid := auth.uid();
  jwt_email text := nullif(trim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
  legacy_email text;
begin
  if new_id is null or jwt_email is null or p_legacy_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_legacy_user_id = new_id then
    return jsonb_build_object(
      'ok', true,
      'relinked', false,
      'auth_id', new_id::text,
      'product', p_product
    );
  end if;

  select lower(trim(coalesce(au.email, '')))
  into legacy_email
  from auth.users au
  join public.accounts a on a.enclave_user_id = au.id
  where au.id = p_legacy_user_id
    and lower(trim(coalesce(au.email, ''))) = jwt_email
  limit 1;

  if legacy_email is null then
    return jsonb_build_object('ok', false, 'reason', 'legacy_account_not_found_for_email');
  end if;

  if not exists (
    select 1
    from auth.users au
    where au.id = new_id
      and lower(trim(coalesce(au.email, ''))) = jwt_email
  ) then
    return jsonb_build_object('ok', false, 'reason', 'current_auth_email_mismatch');
  end if;

  perform public.rewrite_enclave_user_id(p_legacy_user_id, new_id);
  delete from auth.users where id = p_legacy_user_id;

  return jsonb_build_object(
    'ok', true,
    'relinked', true,
    'product', p_product,
    'auth_id', new_id::text,
    'previous_auth_id', p_legacy_user_id::text,
    'email', legacy_email
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'relinked', false, 'reason', sqlerrm);
end;
$$;

create or replace function public.reconcile_product_identity(p_product text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  new_id uuid := auth.uid();
  jwt_email text := nullif(trim(lower(coalesce(auth.jwt() ->> 'email', ''))), '');
  old_id uuid;
  legacy_email text;
begin
  if new_id is null or jwt_email is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select au.id, lower(trim(coalesce(au.email, '')))
  into old_id, legacy_email
  from auth.users au
  join public.accounts a on a.enclave_user_id = au.id
  where lower(trim(coalesce(au.email, ''))) = jwt_email
    and au.id is distinct from new_id
  order by a.created_at asc nulls last
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'relinked', false,
      'auth_id', new_id::text,
      'product', p_product
    );
  end if;

  if not exists (
    select 1
    from auth.users au
    where au.id = new_id
      and lower(trim(coalesce(au.email, ''))) = jwt_email
  ) then
    return jsonb_build_object('ok', false, 'reason', 'current_auth_email_mismatch');
  end if;

  perform public.rewrite_enclave_user_id(old_id, new_id);
  delete from auth.users where id = old_id;

  return jsonb_build_object(
    'ok', true,
    'relinked', true,
    'product', p_product,
    'auth_id', new_id::text,
    'previous_auth_id', old_id::text,
    'email', legacy_email
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'relinked', false, 'reason', sqlerrm);
end;
$$;

revoke all on function public.rewrite_enclave_user_id(uuid, uuid) from public;
revoke all on function public.migrate_product_identity(text, uuid) from public;
revoke all on function public.reconcile_product_identity(text) from public;

grant execute on function public.migrate_product_identity(text, uuid) to authenticated;
grant execute on function public.reconcile_product_identity(text) to authenticated;

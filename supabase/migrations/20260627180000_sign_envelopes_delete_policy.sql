-- Allow envelope owners to delete non-completed envelopes (matches API rules).
create policy "sign_envelopes_delete_own"
  on public.sign_envelopes
  for delete
  to authenticated
  using (
    enclave_user_id = auth.uid()
    and status <> 'completed'
  );

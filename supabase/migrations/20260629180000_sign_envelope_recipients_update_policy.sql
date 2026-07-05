-- Envelope owners need to update recipients when rotating signing tokens (Sign / Resend).
create policy "sign_envelope_recipients_update_own"
  on public.sign_envelope_recipients
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_recipients.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.sign_envelopes se
      where se.id = sign_envelope_recipients.envelope_id
        and se.enclave_user_id = auth.uid()
    )
  );

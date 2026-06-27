# sign-send-invite

Sends Enclave Sign recipient invite emails via Resend after an envelope is created.

## Secrets (Social data project)

| Secret | Notes |
|--------|-------|
| `RESEND_API_KEY` | Same key as Account SMTP / Resend contacts |
| `SIGN_INVITE_FROM_EMAIL` | Optional. Default `Enclave Sign <noreply@enclave.talk>` |

## Deploy

```bash
npx supabase functions deploy sign-send-invite --no-verify-jwt
```

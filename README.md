# Enclave Sign API

Supabase edge functions and migrations for **Enclave Sign**. Lives in **Enclave-Encrypt** alongside `@enclave/pqc-core`.

The Sign **app** is [`Enclave-Sign/enclave-sign`](https://github.com/Enclave-Sign/enclave-sign). Cryptography is implemented in [`Enclave-Sign/enclave-sign-sdk`](https://github.com/Enclave-Sign/enclave-sign-sdk) (AGPL) and invoked from these handlers — not duplicated inline.

## Layout

```
enclave-sign-api/
  supabase/
    functions/
      exchange-account-token/
      sign-open-envelope/
      sign-complete-recipient/
      sign-send-invite/
      sign-download-completed/
      _shared/sign/          # PDF helpers; decrypt re-exports sign-sdk
    migrations/              # sign_* schema + billing guards
```

## Dependencies (closed loop)

```
sign-api handlers  →  @enclave/sign-sdk  →  @enclave/pqc-core
enclave-sign app   →  @enclave/sign-sdk  →  @enclave/pqc-core
```

Local Deno import map: `supabase/functions/deno.json` (paths to sibling repos).

## Deploy

Link your **dedicated Sign data** Supabase project, then push schema and deploy functions:

```bash
npx supabase link --project-ref dqjwchquqeznftdnncec
npm run deploy
```

`npm run deploy` runs `db push` then deploys all Sign edge functions. Build SDKs before first deploy:

```bash
cd ../enclave-pqc-core && npm run build
cd ../../Enclave-Sign/enclave-sign-sdk && npm run build
```

### Account JWT trust

In Sign **Project Settings → JWT Signing Keys**, add verification for Account JWKS (`https://eyqaeigblulbtnorqyts.supabase.co/auth/v1/.well-known/jwks.json`) so `exchange-account-token` sessions validate at the gateway.

## Secrets

| Secret | Used by |
|--------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | All handlers |
| `ACCOUNT_SUPABASE_URL` / `ACCOUNT_SUPABASE_ANON_KEY` | `exchange-account-token` |
| `RESEND_API_KEY` | `sign-send-invite` |

## License

AGPL-3.0-or-later (same as sign-sdk and pqc-core).

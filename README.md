# Enclave Sign API

Supabase edge functions and migrations for **Enclave Sign**. Lives in **Enclave-Encrypt** alongside `@enclave/pqc-core`.

The Sign **app** is [`Enclave-Sign/enclave-sign`](https://github.com/Enclave-Sign/enclave-sign). Cryptography is implemented in [`Enclave-Sign/enclave-sign-sdk`](https://github.com/Enclave-Sign/enclave-sign-sdk) (AGPL) and invoked from these handlers — not duplicated inline.

## Layout

```
enclave-sign-api/
  supabase/
    functions/
      sign-open-envelope/
      sign-complete-recipient/
      sign-send-invite/
      sign-download-completed/
      _shared/sign/          # PDF helpers; decrypt re-exports sign-sdk
    migrations/              # sign_* schema (2026062314–2026062319)
```

## Dependencies (closed loop)

```
sign-api handlers  →  @enclave/sign-sdk  →  @enclave/pqc-core
enclave-sign app   →  @enclave/sign-sdk  →  @enclave/pqc-core
```

Local Deno import map: `supabase/functions/deno.json` (paths to sibling repos).

## Deploy

Currently colocated on the Social data Supabase project (`kltykhkcvdwhfjgvevbt`) until a dedicated Sign data project exists.

```bash
npx supabase link --project-ref kltykhkcvdwhfjgvevbt
npx supabase db push
npx supabase functions deploy sign-open-envelope
npx supabase functions deploy sign-complete-recipient
npx supabase functions deploy sign-send-invite
npx supabase functions deploy sign-download-completed
```

Build SDKs before deploying functions:

```bash
cd ../enclave-pqc-core && npm run build
cd ../../Enclave-Sign/enclave-sign-sdk && npm run build
```

## Secrets

| Secret | Used by |
|--------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | All handlers |
| `RESEND_API_KEY` | `sign-send-invite` |

## License

AGPL-3.0-or-later (same as sign-sdk and pqc-core).

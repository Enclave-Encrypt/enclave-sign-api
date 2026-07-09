# Enclave Sign API

Supabase edge functions and migrations for **Enclave Sign**.

Cryptography lives in [`Enclave-Sign/enclave-sign-sdk`](https://github.com/Enclave-Sign/enclave-sign-sdk) and [`Enclave-Inc/enclave-pqc-primitives`](https://github.com/Enclave-Inc/enclave-pqc-primitives) — handlers call the SDK, not low-level libraries.

## Layout

```text
enclave-sign-api/
  scripts/vendor-sign-sdk.mjs
  supabase/
    functions/
      _shared/sign/          # PDF + session helpers; decrypt via sign-sdk
      _vendor/               # Vendored dist (gitignored; npm run vendor)
      deno.json
    migrations/
```

## Dependency chain

```text
sign-api handlers  →  @enclave/sign-sdk  →  @enclave/pqc-primitives
enclave-sign app   →  @enclave/sign-sdk  →  @enclave/pqc-primitives
```

## Deploy

```bash
npx supabase link --project-ref dqjwchquqeznftdnncec
npm run deploy
```

Build siblings before first deploy or after crypto changes:

```bash
cd ../../Enclave-Inc/enclave-pqc-primitives && npm run build
cd ../../Enclave-Sign/enclave-sign-sdk && npm run build
cd ../../Enclave-Encrypt/enclave-sign-api && npm run vendor
```

### Account JWT trust

In Sign **Project Settings → JWT Signing Keys**, add verification for Account JWKS (`https://eyqaeigblulbtnorqyts.supabase.co/auth/v1/.well-known/jwks.json`).

## Secrets

| Secret | Used by |
|--------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | All handlers |
| `ACCOUNT_SUPABASE_URL` / `ACCOUNT_SUPABASE_ANON_KEY` | `exchange-account-token` |
| `RESEND_API_KEY` | `sign-send-invite` |

## License

AGPL-3.0-or-later (same as sign-sdk and pqc-primitives).

# exchange-account-token

Exchanges a valid **Enclave Account** access token for a **Sign data** Supabase session.

## Auth model

- `verify_jwt = false` in `supabase/config.toml` because callers send an Account-project JWT.
- Handler verifies the bearer token against Account JWKS (`eyqaeigblulbtnorqyts`) and rejects Sign data tokens.
- Only issues a Sign data session after Account identity is confirmed.

## Required secrets

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (Sign data project)
- `ACCOUNT_SUPABASE_URL` / `ACCOUNT_SUPABASE_ANON_KEY` (Account project)

## Client

- `enclave-sign/packages/shared/src/supabase/sign-data-exchange.ts`

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function readServiceRoleKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (direct) return direct;

  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeysJson) return "";

  try {
    const parsed = JSON.parse(secretKeysJson) as Record<string, string>;
    return parsed.default?.trim() ?? parsed.service_role?.trim() ?? "";
  } catch {
    return "";
  }
}

export function requireSignDataConfig(): { url: string; serviceRoleKey: string } | null {
  const url = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = readServiceRoleKey();
  if (!url || !serviceRoleKey) {
    return null;
  }
  return { url, serviceRoleKey };
}

export function createSignAdminClient(
  config: { url: string; serviceRoleKey: string },
): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function requireSignAnonConfig(): { url: string; anonKey: string } | null {
  const url = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  if (!url || !anonKey) {
    return null;
  }
  return { url, anonKey };
}

export function createSignUserClient(
  config: { url: string; anonKey: string },
  accessToken: string,
): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

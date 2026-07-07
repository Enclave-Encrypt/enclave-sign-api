import {
  actionResponse,
  handleSignOptions,
  jsonResponse,
  requireSignPost,
} from "../_shared/sign/http.ts";
import { openSigningSession } from "../_shared/sign/open-signing-session.ts";
import {
  createSignAdminClient,
  requireSignDataConfig,
} from "../_shared/sign/supabase.ts";

Deno.serve(async (req) => {
  const options = handleSignOptions(req);
  if (options) return options;

  const methodError = requireSignPost(req);
  if (methodError) return methodError;

  try {
    const body = (await req.json()) as { token?: string };
    const token = body.token?.trim();

    if (!token) {
      return jsonResponse({ error: "Missing token" }, 400);
    }

    const config = requireSignDataConfig();
    if (!config) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const admin = createSignAdminClient(config);
    const result = await openSigningSession(admin, token);

    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status);
    }

    return jsonResponse(result.session);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});

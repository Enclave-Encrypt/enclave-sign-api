import { hashSigningToken } from "@enclave/sign-sdk/signing-tokens";

import {
  actionResponse,
  handleSignOptions,
  jsonResponse,
  requireSignPost,
} from "../_shared/sign/http.ts";
import { completeRecipientAction } from "../_shared/sign/recipient-completion.ts";
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
    const body = (await req.json()) as {
      token?: string;
      action?: "sign" | "decline";
      signature?: string;
      signatureAlgorithm?: string;
      signerPublicKey?: string;
      signedAt?: string;
      fieldValues?: Array<{ fieldId?: string; value?: string }>;
    };

    const token = body.token?.trim();
    const action = body.action;

    if (!token || (action !== "sign" && action !== "decline")) {
      return jsonResponse({ error: "Invalid request" }, 400);
    }

    if (action === "sign" && !body.signature?.trim()) {
      return jsonResponse({ error: "Missing signature" }, 400);
    }

    const config = requireSignDataConfig();
    if (!config) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const admin = createSignAdminClient(config);
    const result = await completeRecipientAction(
      admin,
      hashSigningToken(token),
      body,
    );

    if (!result.ok) {
      return actionResponse(
        { ok: false, reason: result.reason },
        result.status ?? 500,
      );
    }

    return actionResponse({
      ok: true,
      envelope_status: result.envelope_status,
      finalized: result.finalized,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return actionResponse({ ok: false, reason: message }, 500);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashSigningToken } from "@enclave/sign-sdk/signing-tokens";

import { finalizeEnvelopeIfNeeded } from "../_shared/sign/finalize-envelope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function readServiceRoleKey(): string {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as {
      token?: string;
      action?: "sign" | "decline";
      signature?: string;
      signatureAlgorithm?: string;
      signerPublicKey?: string;
      fieldValues?: Array<{ fieldId?: string; value?: string }>;
    };

    const token = body.token?.trim();
    const action = body.action;

    if (!token || (action !== "sign" && action !== "decline")) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sign" && !body.signature?.trim()) {
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const socialUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = readServiceRoleKey();

    if (!socialUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(socialUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tokenHash = hashSigningToken(token);

    const { data: recipient, error: recipientError } = await admin
      .from("envelope_recipients")
      .select("id, envelope_id, status, encryption_metadata")
      .eq("signing_token_hash", tokenHash)
      .maybeSingle();

    if (recipientError || !recipient) {
      return new Response(JSON.stringify({ ok: false, reason: "invalid_token" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (recipient.status !== "pending") {
      return new Response(JSON.stringify({ ok: false, reason: "already_resolved" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sign") {
      const { data: recipientFields, error: recipientFieldsError } = await admin
        .from("envelope_fields")
        .select("id, required, value")
        .eq("recipient_id", recipient.id);

      if (recipientFieldsError) {
        return new Response(
          JSON.stringify({ ok: false, reason: "field_lookup_failed" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const fieldValues = new Map(
        (body.fieldValues ?? [])
          .filter((entry) => entry.fieldId && entry.value !== undefined)
          .map((entry) => [entry.fieldId as string, entry.value as string]),
      );

      for (const field of recipientFields ?? []) {
        const nextValue = fieldValues.get(field.id as string) ?? field.value;

        if (field.required && !String(nextValue ?? "").trim()) {
          return new Response(
            JSON.stringify({ ok: false, reason: "required_fields_missing" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      const filledAt = new Date().toISOString();

      for (const field of recipientFields ?? []) {
        if (!fieldValues.has(field.id as string)) {
          continue;
        }

        const { error: fieldUpdateError } = await admin
          .from("envelope_fields")
          .update({
            value: fieldValues.get(field.id as string),
            filled_at: filledAt,
          })
          .eq("id", field.id)
          .eq("recipient_id", recipient.id);

        if (fieldUpdateError) {
          return new Response(
            JSON.stringify({ ok: false, reason: fieldUpdateError.message }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }
    }

    const signedAt = new Date().toISOString();
    const existingMetadata = (recipient.encryption_metadata ?? {}) as Record<
      string,
      unknown
    >;

    const { error: updateRecipientError } = await admin
      .from("envelope_recipients")
      .update({
        status: action === "sign" ? "signed" : "declined",
        signed_at: signedAt,
        signature: action === "sign" ? body.signature?.trim() ?? null : null,
        signature_algorithm:
          action === "sign" ? body.signatureAlgorithm?.trim() ?? "ML-DSA-65" : null,
        encryption_metadata:
          action === "sign"
            ? {
                ...existingMetadata,
                signer_public_key: body.signerPublicKey?.trim() ?? null,
              }
            : existingMetadata,
      })
      .eq("id", recipient.id);

    if (updateRecipientError) {
      return new Response(JSON.stringify({ ok: false, reason: updateRecipientError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: recipients, error: recipientsError } = await admin
      .from("envelope_recipients")
      .select("status")
      .eq("envelope_id", recipient.envelope_id);

    if (recipientsError || !recipients) {
      return new Response(JSON.stringify({ ok: false, reason: "recipient_lookup_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let envelopeStatus = "waiting";

    if (recipients.some((entry) => entry.status === "declined")) {
      envelopeStatus = "voided";
    } else if (recipients.every((entry) => entry.status === "signed")) {
      envelopeStatus = "completed";
    } else if (recipients.some((entry) => entry.status === "signed")) {
      envelopeStatus = "waiting";
    } else {
      envelopeStatus = "sent";
    }

    const { error: envelopeUpdateError } = await admin
      .from("envelopes")
      .update({
        status: envelopeStatus,
        updated_at: signedAt,
        completed_at: envelopeStatus === "completed" ? signedAt : undefined,
      })
      .eq("id", recipient.envelope_id);

    if (envelopeUpdateError) {
      return new Response(JSON.stringify({ ok: false, reason: envelopeUpdateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let finalized = false;
    if (envelopeStatus === "completed") {
      const finalizeResult = await finalizeEnvelopeIfNeeded(
        admin,
        recipient.envelope_id as string,
      );
      finalized = finalizeResult.ok;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        envelope_status: envelopeStatus,
        finalized,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ ok: false, reason: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

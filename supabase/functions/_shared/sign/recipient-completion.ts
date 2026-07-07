import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifyRecipientSignature,
} from "@enclave/sign-sdk/verify-signature";

import { deriveEnvelopeStatus } from "./envelope-status.ts";
import { finalizeEnvelopeIfNeeded } from "./finalize-envelope.ts";

export type CompleteRecipientInput = {
  token: string;
  action: "sign" | "decline";
  signature?: string;
  signatureAlgorithm?: string;
  signerPublicKey?: string;
  signedAt?: string;
  fieldValues?: Array<{ fieldId?: string; value?: string }>;
};

export type CompleteRecipientResult =
  | { ok: true; envelope_status: string; finalized: boolean }
  | { ok: false; reason: string; status?: number };

export async function completeRecipientAction(
  admin: SupabaseClient,
  tokenHash: string,
  body: CompleteRecipientInput,
): Promise<CompleteRecipientResult> {
  const action = body.action;

  const { data: recipient, error: recipientError } = await admin
    .from("envelope_recipients")
    .select("id, envelope_id, status, email, encryption_metadata")
    .eq("signing_token_hash", tokenHash)
    .maybeSingle();

  if (recipientError || !recipient) {
    return { ok: false, reason: "invalid_token", status: 404 };
  }

  if (recipient.status !== "pending") {
    return { ok: false, reason: "already_resolved", status: 409 };
  }

  const { data: envelope, error: envelopeError } = await admin
    .from("envelopes")
    .select("id, status, expires_at")
    .eq("id", recipient.envelope_id)
    .maybeSingle();

  if (envelopeError || !envelope) {
    return { ok: false, reason: "envelope_not_found", status: 404 };
  }

  if (envelope.status === "voided" || envelope.status === "expired") {
    return { ok: false, reason: "envelope_unavailable", status: 410 };
  }

  if (envelope.expires_at) {
    const expiresAt = new Date(envelope.expires_at as string);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: "envelope_expired", status: 410 };
    }
  }

  if (action === "sign") {
    const signature = body.signature?.trim();
    const signerPublicKey = body.signerPublicKey?.trim();
    const signedAt = body.signedAt?.trim();

    if (!signature || !signerPublicKey || !signedAt) {
      return { ok: false, reason: "missing_signature", status: 400 };
    }

    const verified = verifyRecipientSignature({
      envelopeId: recipient.envelope_id as string,
      recipientId: recipient.id as string,
      recipientEmail: recipient.email as string,
      signedAt,
      signature,
      signerPublicKey,
    });

    if (!verified) {
      return { ok: false, reason: "invalid_signature", status: 400 };
    }

    const { data: recipientFields, error: recipientFieldsError } = await admin
      .from("envelope_fields")
      .select("id, required, value")
      .eq("recipient_id", recipient.id);

    if (recipientFieldsError) {
      return { ok: false, reason: "field_lookup_failed", status: 500 };
    }

    const fieldValues = new Map(
      (body.fieldValues ?? [])
        .filter((entry) => entry.fieldId && entry.value !== undefined)
        .map((entry) => [entry.fieldId as string, entry.value as string]),
    );

    for (const field of recipientFields ?? []) {
      const nextValue = fieldValues.get(field.id as string) ?? field.value;

      if (field.required && !String(nextValue ?? "").trim()) {
        return { ok: false, reason: "required_fields_missing", status: 400 };
      }
    }

    const filledAt = signedAt;

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
        return { ok: false, reason: "field_update_failed", status: 500 };
      }
    }
  }

  const signedAt = body.signedAt?.trim() || new Date().toISOString();
  const existingMetadata = (recipient.encryption_metadata ?? {}) as Record<
    string,
    unknown
  >;

  const { data: updatedRecipient, error: updateRecipientError } = await admin
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
    .eq("id", recipient.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateRecipientError) {
    return { ok: false, reason: "recipient_update_failed", status: 500 };
  }

  if (!updatedRecipient) {
    return { ok: false, reason: "already_resolved", status: 409 };
  }

  const { data: recipients, error: recipientsError } = await admin
    .from("envelope_recipients")
    .select("status")
    .eq("envelope_id", recipient.envelope_id);

  if (recipientsError || !recipients) {
    return { ok: false, reason: "recipient_lookup_failed", status: 500 };
  }

  const envelopeStatus = deriveEnvelopeStatus(
    recipients.map((entry) => entry.status as "pending" | "signed" | "declined"),
  );

  const { error: envelopeUpdateError } = await admin
    .from("envelopes")
    .update({
      status: envelopeStatus,
      updated_at: signedAt,
      completed_at: envelopeStatus === "completed" ? signedAt : null,
    })
    .eq("id", recipient.envelope_id);

  if (envelopeUpdateError) {
    return { ok: false, reason: "envelope_update_failed", status: 500 };
  }

  let finalized = false;
  if (envelopeStatus === "completed") {
    const finalizeResult = await finalizeEnvelopeIfNeeded(
      admin,
      recipient.envelope_id as string,
    );
    finalized = finalizeResult.ok;
  }

  return {
    ok: true,
    envelope_status: envelopeStatus,
    finalized,
  };
}

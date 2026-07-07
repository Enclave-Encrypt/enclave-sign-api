import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashSigningToken } from "@enclave/sign-sdk/signing-tokens";
import { verifyEnvelopeManifest } from "@enclave/sign-sdk/verify-signature";

const SIGN_DOCUMENTS_BUCKET = "sign-envelope-documents";

export type OpenSigningSessionResult =
  | {
      ok: true;
      session: {
        envelopeId: string;
        subject: string;
        recipientId: string;
        recipientName: string | null;
        recipientEmail: string;
        recipientStatus: string;
        manifestSignature: string | null;
        manifestAlgorithm: string;
        senderPublicKey: string | null;
        kemSecretKey: string;
        documents: Array<{
          id: string;
          fileName: string;
          contentType: string;
          contentHash: string;
          ivBase64: string;
          downloadUrl: string;
          kemCiphertext: string;
          wrappedDekB64: string;
          wrappedDekIvB64: string;
        }>;
        fields: Array<{
          id: string;
          documentId: string;
          fieldType: string;
          pageIndex: number;
          x: number;
          y: number;
          width: number;
          height: number;
          required: boolean;
          label: string | null;
          placeholder: string | null;
          value: string | null;
        }>;
      };
    }
  | { ok: false; error: string; status: number };

export async function openSigningSession(
  admin: SupabaseClient,
  token: string,
): Promise<OpenSigningSessionResult> {
  const tokenHash = hashSigningToken(token);

  const { data: recipient, error: recipientError } = await admin
    .from("envelope_recipients")
    .select(
      "id, name, email, status, encryption_metadata, envelopes(id, subject, status, expires_at, manifest_signature, manifest_algorithm, encryption_metadata, accounts(mldsa_public_key))",
    )
    .eq("signing_token_hash", tokenHash)
    .maybeSingle();

  if (recipientError || !recipient) {
    return { ok: false, error: "Invalid signing link", status: 404 };
  }

  const envelope = recipient.envelopes as {
    id: string;
    subject: string;
    status: string;
    expires_at: string | null;
    manifest_signature: string | null;
    manifest_algorithm: string;
    encryption_metadata: Record<string, unknown>;
    accounts: { mldsa_public_key: string | null } | null;
  } | null;

  if (!envelope) {
    return { ok: false, error: "Envelope not found", status: 404 };
  }

  if (envelope.status === "voided" || envelope.status === "expired") {
    return { ok: false, error: "Envelope is no longer available", status: 410 };
  }

  if (envelope.expires_at) {
    const expiresAt = new Date(envelope.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      return { ok: false, error: "Envelope is no longer available", status: 410 };
    }
  }

  const encryptionMetadata = recipient.encryption_metadata as {
    kem_secret_key?: string;
  };

  if (!encryptionMetadata.kem_secret_key) {
    return { ok: false, error: "Recipient keys unavailable", status: 500 };
  }

  const { data: documents, error: documentsError } = await admin
    .from("envelope_documents")
    .select("id, file_name, content_type, content_hash, iv_base64, storage_path, byte_size")
    .eq("envelope_id", envelope.id)
    .order("file_name", { ascending: true });

  if (documentsError || !documents?.length) {
    return { ok: false, error: "Documents not found", status: 404 };
  }

  const { data: envelopeRecipients, error: recipientsError } = await admin
    .from("envelope_recipients")
    .select("email, kem_public_key")
    .eq("envelope_id", envelope.id)
    .order("signing_order", { ascending: true });

  if (recipientsError || !envelopeRecipients?.length) {
    return { ok: false, error: "Recipients not found", status: 404 };
  }

  const senderPublicKey = envelope.accounts?.mldsa_public_key ?? null;

  if (
    envelope.manifest_signature &&
    senderPublicKey &&
    !verifyEnvelopeManifest({
      subject: envelope.subject,
      manifestSignature: envelope.manifest_signature,
      senderPublicKey,
      documents: documents.map((document) => ({
        fileName: document.file_name as string,
        contentHash: document.content_hash as string,
        byteSize: document.byte_size as number,
      })),
      recipients: envelopeRecipients.map((entry) => ({
        email: entry.email as string,
        kemPublicKey: entry.kem_public_key as string,
      })),
    })
  ) {
    return { ok: false, error: "Envelope integrity check failed", status: 500 };
  }

  const { data: documentKeys, error: keysError } = await admin
    .from("envelope_document_keys")
    .select("document_id, kem_ciphertext, wrapped_dek_b64, wrapped_dek_iv_b64")
    .eq("recipient_id", recipient.id);

  if (keysError || !documentKeys?.length) {
    return { ok: false, error: "Document keys not found", status: 404 };
  }

  const keysByDocumentId = new Map(
    documentKeys.map((entry) => [entry.document_id as string, entry]),
  );

  const sessionDocuments = [];

  for (const document of documents) {
    const keyRow = keysByDocumentId.get(document.id as string);
    const storagePath = document.storage_path as string | null;

    if (!keyRow || !storagePath) {
      continue;
    }

    const { data: signedUrl, error: signedUrlError } = await admin.storage
      .from(SIGN_DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, 3600);

    if (signedUrlError || !signedUrl?.signedUrl) {
      return { ok: false, error: "Could not prepare document download", status: 500 };
    }

    sessionDocuments.push({
      id: document.id,
      fileName: document.file_name,
      contentType: document.content_type,
      contentHash: document.content_hash,
      ivBase64: document.iv_base64,
      downloadUrl: signedUrl.signedUrl,
      kemCiphertext: keyRow.kem_ciphertext,
      wrappedDekB64: keyRow.wrapped_dek_b64,
      wrappedDekIvB64: keyRow.wrapped_dek_iv_b64,
    });
  }

  if (sessionDocuments.length === 0) {
    return { ok: false, error: "Documents not found", status: 404 };
  }

  const { data: fields, error: fieldsError } = await admin
    .from("envelope_fields")
    .select(
      "id, document_id, field_type, page_index, x, y, width, height, required, label, placeholder, value",
    )
    .eq("recipient_id", recipient.id);

  if (fieldsError) {
    return { ok: false, error: "Fields not found", status: 500 };
  }

  return {
    ok: true,
    session: {
      envelopeId: envelope.id,
      subject: envelope.subject,
      recipientId: recipient.id,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      recipientStatus: recipient.status,
      manifestSignature: envelope.manifest_signature,
      manifestAlgorithm: envelope.manifest_algorithm,
      senderPublicKey,
      kemSecretKey: encryptionMetadata.kem_secret_key,
      documents: sessionDocuments,
      fields: (fields ?? []).map((field) => ({
        id: field.id,
        documentId: field.document_id,
        fieldType: field.field_type,
        pageIndex: field.page_index,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        required: field.required,
        label: field.label,
        placeholder: field.placeholder,
        value: field.value,
      })),
    },
  };
}

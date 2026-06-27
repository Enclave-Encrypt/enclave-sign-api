import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildCertificateOfCompletionPdf } from "./certificate-pdf.ts";
import { decryptEnvelopeDocument } from "./decrypt-document.ts";
import { flattenFieldsIntoPdf, type FlattenField } from "./flatten-pdf.ts";

const COMPLETED_BUCKET = "sign-envelope-completed";
const SOURCE_BUCKET = "sign-envelope-documents";

function isPdf(fileName: string, contentType: string | null) {
  return (
    contentType === "application/pdf" ||
    fileName.toLowerCase().endsWith(".pdf")
  );
}

function completedFileName(fileName: string) {
  if (fileName.toLowerCase().endsWith(".pdf")) {
    return fileName.replace(/\.pdf$/i, "") + "-completed.pdf";
  }
  return `${fileName}-completed.pdf`;
}

export async function finalizeEnvelopeIfNeeded(
  admin: SupabaseClient,
  envelopeId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: envelope, error: envelopeError } = await admin
    .from("sign_envelopes")
    .select("id, subject, status, finalized_at, enclave_user_id, completed_at")
    .eq("id", envelopeId)
    .maybeSingle();

  if (envelopeError || !envelope) {
    return { ok: false, reason: "envelope_not_found" };
  }

  if (envelope.status !== "completed") {
    return { ok: false, reason: "envelope_not_completed" };
  }

  if (envelope.finalized_at) {
    return { ok: true };
  }

  const { count: artifactCount } = await admin
    .from("sign_envelope_completed_artifacts")
    .select("id", { count: "exact", head: true })
    .eq("envelope_id", envelopeId);

  if ((artifactCount ?? 0) > 0) {
    await admin
      .from("sign_envelopes")
      .update({
        finalized_at: envelope.finalized_at ?? new Date().toISOString(),
        completed_at: envelope.completed_at ?? new Date().toISOString(),
      })
      .eq("id", envelopeId);
    return { ok: true };
  }

  const { data: recipients, error: recipientsError } = await admin
    .from("sign_envelope_recipients")
    .select(
      "id, name, email, signed_at, signature_algorithm, encryption_metadata, status",
    )
    .eq("envelope_id", envelopeId)
    .order("signing_order", { ascending: true });

  if (recipientsError || !recipients?.length) {
    return { ok: false, reason: "recipients_not_found" };
  }

  const decryptRecipient = recipients.find((recipient) => {
    const metadata = recipient.encryption_metadata as {
      kem_secret_key?: string;
    };
    return recipient.status === "signed" && metadata.kem_secret_key;
  });

  if (!decryptRecipient) {
    return { ok: false, reason: "decrypt_recipient_not_found" };
  }

  const kemMetadata = decryptRecipient.encryption_metadata as {
    kem_secret_key: string;
  };

  const { data: documents, error: documentsError } = await admin
    .from("sign_envelope_documents")
    .select("id, file_name, content_type, content_hash, iv_base64, storage_path")
    .eq("envelope_id", envelopeId);

  if (documentsError || !documents?.length) {
    return { ok: false, reason: "documents_not_found" };
  }

  const { data: fields, error: fieldsError } = await admin
    .from("sign_envelope_fields")
    .select(
      "document_id, field_type, page_index, x, y, width, height, value",
    )
    .eq("envelope_id", envelopeId);

  if (fieldsError) {
    return { ok: false, reason: fieldsError.message };
  }

  const { data: documentKeys, error: keysError } = await admin
    .from("sign_envelope_document_keys")
    .select("document_id, kem_ciphertext, wrapped_dek_b64, wrapped_dek_iv_b64")
    .eq("recipient_id", decryptRecipient.id);

  if (keysError || !documentKeys?.length) {
    return { ok: false, reason: "document_keys_not_found" };
  }

  const keysByDocumentId = new Map(
    documentKeys.map((entry) => [entry.document_id as string, entry]),
  );

  const completedAt = new Date().toISOString();
  const artifactRows: Array<{
    envelope_id: string;
    document_id: string | null;
    artifact_type: "document" | "certificate";
    file_name: string;
    storage_path: string;
    byte_size: number;
  }> = [];

  for (const document of documents) {
    const keyRow = keysByDocumentId.get(document.id as string);
    if (!keyRow?.wrapped_dek_iv_b64 || !document.storage_path) {
      return { ok: false, reason: "document_key_missing" };
    }

    const { data: ciphertextBlob, error: downloadError } = await admin.storage
      .from(SOURCE_BUCKET)
      .download(document.storage_path as string);

    if (downloadError || !ciphertextBlob) {
      return { ok: false, reason: downloadError?.message ?? "download_failed" };
    }

    const ciphertext = new Uint8Array(await ciphertextBlob.arrayBuffer());
    const plaintext = await decryptEnvelopeDocument({
      ciphertext,
      ivBase64: document.iv_base64 as string,
      kemCiphertextB64: keyRow.kem_ciphertext as string,
      kemSecretKeyB64: kemMetadata.kem_secret_key,
      wrappedDekB64: keyRow.wrapped_dek_b64 as string,
      wrappedDekIvB64: keyRow.wrapped_dek_iv_b64 as string,
      subject: envelope.subject as string,
      fileName: document.file_name as string,
      recipientEmail: decryptRecipient.email as string,
    });

    const documentFields: FlattenField[] = (fields ?? [])
      .filter((field) => field.document_id === document.id)
      .map((field) => ({
        fieldType: field.field_type as string,
        pageIndex: field.page_index as number,
        x: Number(field.x),
        y: Number(field.y),
        width: Number(field.width),
        height: Number(field.height),
        value: (field.value as string | null) ?? null,
      }));

    let outputBytes = plaintext;
    const fileName = document.file_name as string;
    const contentType = document.content_type as string | null;

    if (isPdf(fileName, contentType)) {
      outputBytes = await flattenFieldsIntoPdf(plaintext, documentFields);
    }

    const outputName = isPdf(fileName, contentType)
      ? completedFileName(fileName)
      : `completed-${fileName}`;
    const storagePath =
      `${envelope.enclave_user_id}/${envelopeId}/${crypto.randomUUID()}-${outputName}`;

    const { error: uploadError } = await admin.storage
      .from(COMPLETED_BUCKET)
      .upload(storagePath, outputBytes, {
        contentType: isPdf(fileName, contentType)
          ? "application/pdf"
          : contentType ?? "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return { ok: false, reason: uploadError.message };
    }

    artifactRows.push({
      envelope_id: envelopeId,
      document_id: document.id as string,
      artifact_type: "document",
      file_name: outputName,
      storage_path: storagePath,
      byte_size: outputBytes.byteLength,
    });
  }

  const certificateBytes = await buildCertificateOfCompletionPdf({
    subject: envelope.subject as string,
    envelopeId,
    completedAt,
    recipients: recipients.map((recipient) => ({
      name: recipient.name as string | null,
      email: recipient.email as string,
      signedAt: recipient.signed_at as string | null,
      signatureAlgorithm: recipient.signature_algorithm as string | null,
    })),
    documents: documents.map((document) => ({
      fileName: document.file_name as string,
      contentHash: document.content_hash as string | null,
    })),
  });

  const certificatePath =
    `${envelope.enclave_user_id}/${envelopeId}/${crypto.randomUUID()}-certificate-of-completion.pdf`;

  const { error: certificateUploadError } = await admin.storage
    .from(COMPLETED_BUCKET)
    .upload(certificatePath, certificateBytes, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (certificateUploadError) {
    return { ok: false, reason: certificateUploadError.message };
  }

  artifactRows.push({
    envelope_id: envelopeId,
    document_id: null,
    artifact_type: "certificate",
    file_name: "Certificate-of-Completion.pdf",
    storage_path: certificatePath,
    byte_size: certificateBytes.byteLength,
  });

  const { error: insertError } = await admin
    .from("sign_envelope_completed_artifacts")
    .insert(artifactRows);

  if (insertError) {
    return { ok: false, reason: insertError.message };
  }

  const { error: envelopeUpdateError } = await admin
    .from("sign_envelopes")
    .update({
      completed_at: envelope.completed_at ?? completedAt,
      finalized_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", envelopeId);

  if (envelopeUpdateError) {
    return { ok: false, reason: envelopeUpdateError.message };
  }

  return { ok: true };
}

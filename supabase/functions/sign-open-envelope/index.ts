import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashSigningToken } from "@enclave/sign-sdk/signing-tokens";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SIGN_DOCUMENTS_BUCKET = "sign-envelope-documents";

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
    const body = (await req.json()) as { token?: string };
    const token = body.token?.trim();

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
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
      .from("sign_envelope_recipients")
      .select(
        "id, name, email, status, encryption_metadata, sign_envelopes(id, subject, status, manifest_signature, manifest_algorithm, encryption_metadata, sign_accounts(mldsa_public_key))",
      )
      .eq("signing_token_hash", tokenHash)
      .maybeSingle();

    if (recipientError || !recipient) {
      return new Response(JSON.stringify({ error: "Invalid signing link" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const envelope = recipient.sign_envelopes as {
      id: string;
      subject: string;
      status: string;
      manifest_signature: string | null;
      manifest_algorithm: string;
      encryption_metadata: Record<string, unknown>;
      sign_accounts: { mldsa_public_key: string | null } | null;
    } | null;

    if (!envelope) {
      return new Response(JSON.stringify({ error: "Envelope not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (envelope.status === "voided" || envelope.status === "expired") {
      return new Response(JSON.stringify({ error: "Envelope is no longer available" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const encryptionMetadata = recipient.encryption_metadata as {
      kem_secret_key?: string;
    };

    if (!encryptionMetadata.kem_secret_key) {
      return new Response(JSON.stringify({ error: "Recipient keys unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: documents, error: documentsError } = await admin
      .from("sign_envelope_documents")
      .select("id, file_name, content_type, content_hash, iv_base64, storage_path")
      .eq("envelope_id", envelope.id);

    if (documentsError || !documents?.length) {
      return new Response(JSON.stringify({ error: "Documents not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: documentKeys, error: keysError } = await admin
      .from("sign_envelope_document_keys")
      .select("document_id, kem_ciphertext, wrapped_dek_b64, wrapped_dek_iv_b64")
      .eq("recipient_id", recipient.id);

    if (keysError || !documentKeys?.length) {
      return new Response(JSON.stringify({ error: "Document keys not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keysByDocumentId = new Map(
      documentKeys.map((entry) => [entry.document_id as string, entry]),
    );

    const sessionDocuments = [];

    for (const document of documents) {
      const keyRow = keysByDocumentId.get(document.id as string);
      if (!keyRow?.storage_path) {
        continue;
      }

      const { data: signedUrl, error: signedUrlError } = await admin.storage
        .from(SIGN_DOCUMENTS_BUCKET)
        .createSignedUrl(document.storage_path as string, 3600);

      if (signedUrlError || !signedUrl?.signedUrl) {
        return new Response(JSON.stringify({ error: "Could not prepare document download" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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

    const { data: fields, error: fieldsError } = await admin
      .from("sign_envelope_fields")
      .select(
        "id, document_id, field_type, page_index, x, y, width, height, required, label, placeholder, value",
      )
      .eq("recipient_id", recipient.id);

    if (fieldsError) {
      return new Response(JSON.stringify({ error: "Fields not found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        envelopeId: envelope.id,
        subject: envelope.subject,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        recipientStatus: recipient.status,
        manifestSignature: envelope.manifest_signature,
        manifestAlgorithm: envelope.manifest_algorithm,
        senderPublicKey: envelope.sign_accounts?.mldsa_public_key ?? null,
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

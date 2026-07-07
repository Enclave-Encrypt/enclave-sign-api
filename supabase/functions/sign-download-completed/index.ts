import { hashSigningToken } from "@enclave/sign-sdk/signing-tokens";

import {
  handleSignOptions,
  jsonResponse,
  requireSignPost,
} from "../_shared/sign/http.ts";
import {
  createSignAdminClient,
  createSignUserClient,
  requireSignAnonConfig,
  requireSignDataConfig,
} from "../_shared/sign/supabase.ts";

const COMPLETED_BUCKET = "sign-envelope-completed";

Deno.serve(async (req) => {
  const options = handleSignOptions(req);
  if (options) return options;

  const methodError = requireSignPost(req);
  if (methodError) return methodError;

  try {
    const body = (await req.json()) as {
      envelope_id?: string;
      token?: string;
    };

    const config = requireSignDataConfig();
    if (!config) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const admin = createSignAdminClient(config);
    let envelopeId = body.envelope_id?.trim() ?? "";

    if (body.token?.trim()) {
      const tokenHash = hashSigningToken(body.token);
      const { data: recipient, error: recipientError } = await admin
        .from("envelope_recipients")
        .select("envelope_id, status, envelopes(status)")
        .eq("signing_token_hash", tokenHash)
        .maybeSingle();

      if (recipientError || !recipient) {
        return jsonResponse({ error: "Invalid signing link" }, 404);
      }

      const envelope = recipient.envelopes as { status: string } | null;
      if (!envelope || envelope.status !== "completed") {
        return jsonResponse({ error: "Envelope not completed" }, 409);
      }

      envelopeId = recipient.envelope_id as string;
    } else {
      const anonConfig = requireSignAnonConfig();
      const authHeader = req.headers.get("Authorization");

      if (!authHeader || !anonConfig) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const userClient = createSignUserClient(
        anonConfig,
        authHeader.replace(/^Bearer\s+/i, "").trim(),
      );

      const {
        data: { user },
      } = await userClient.auth.getUser();

      if (!user?.id || !envelopeId) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const { data: envelope, error: envelopeError } = await admin
        .from("envelopes")
        .select("id, status, enclave_user_id")
        .eq("id", envelopeId)
        .maybeSingle();

      if (
        envelopeError ||
        !envelope ||
        envelope.enclave_user_id !== user.id ||
        envelope.status !== "completed"
      ) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
    }

    if (!envelopeId) {
      return jsonResponse({ error: "Missing envelope_id" }, 400);
    }

    const { data: artifacts, error: artifactsError } = await admin
      .from("envelope_completed_artifacts")
      .select("id, document_id, artifact_type, file_name, storage_path, byte_size")
      .eq("envelope_id", envelopeId)
      .order("artifact_type", { ascending: true })
      .order("file_name", { ascending: true });

    if (artifactsError) {
      return jsonResponse({ error: "artifact_lookup_failed" }, 500);
    }

    if (!artifacts?.length) {
      return jsonResponse({ error: "Completed files not ready" }, 404);
    }

    const responseArtifacts = [];

    for (const artifact of artifacts) {
      const { data: signedUrl, error: signedUrlError } = await admin.storage
        .from(COMPLETED_BUCKET)
        .createSignedUrl(artifact.storage_path as string, 3600);

      if (signedUrlError || !signedUrl?.signedUrl) {
        return jsonResponse({ error: "Could not prepare completed download" }, 500);
      }

      responseArtifacts.push({
        id: artifact.id,
        documentId: artifact.document_id,
        artifactType: artifact.artifact_type,
        fileName: artifact.file_name,
        byteSize: artifact.byte_size,
        downloadUrl: signedUrl.signedUrl,
      });
    }

    return jsonResponse({
      envelopeId,
      artifacts: responseArtifacts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});

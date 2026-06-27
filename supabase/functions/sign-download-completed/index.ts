import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashSigningToken } from "@enclave/sign-sdk/signing-tokens";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COMPLETED_BUCKET = "sign-envelope-completed";

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
      envelope_id?: string;
      token?: string;
    };

    const socialUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = readServiceRoleKey();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";

    if (!socialUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(socialUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let envelopeId = body.envelope_id?.trim() ?? "";

    if (body.token?.trim()) {
      const tokenHash = hashSigningToken(body.token);
      const { data: recipient, error: recipientError } = await admin
        .from("sign_envelope_recipients")
        .select("envelope_id, status, sign_envelopes(status)")
        .eq("signing_token_hash", tokenHash)
        .maybeSingle();

      if (recipientError || !recipient) {
        return new Response(JSON.stringify({ error: "Invalid signing link" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const envelope = recipient.sign_envelopes as { status: string } | null;
      if (!envelope || envelope.status !== "completed") {
        return new Response(JSON.stringify({ error: "Envelope not completed" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      envelopeId = recipient.envelope_id as string;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !anonKey) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userClient = createClient(socialUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const {
        data: { user },
      } = await userClient.auth.getUser();

      if (!user?.id || !envelopeId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: envelope, error: envelopeError } = await admin
        .from("sign_envelopes")
        .select("id, status, enclave_user_id")
        .eq("id", envelopeId)
        .maybeSingle();

      if (
        envelopeError ||
        !envelope ||
        envelope.enclave_user_id !== user.id ||
        envelope.status !== "completed"
      ) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!envelopeId) {
      return new Response(JSON.stringify({ error: "Missing envelope_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: artifacts, error: artifactsError } = await admin
      .from("sign_envelope_completed_artifacts")
      .select("id, document_id, artifact_type, file_name, storage_path, byte_size")
      .eq("envelope_id", envelopeId)
      .order("artifact_type", { ascending: true })
      .order("file_name", { ascending: true });

    if (artifactsError) {
      return new Response(JSON.stringify({ error: artifactsError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!artifacts?.length) {
      return new Response(JSON.stringify({ error: "Completed files not ready" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const responseArtifacts = [];

    for (const artifact of artifacts) {
      const { data: signedUrl, error: signedUrlError } = await admin.storage
        .from(COMPLETED_BUCKET)
        .createSignedUrl(artifact.storage_path as string, 3600);

      if (signedUrlError || !signedUrl?.signedUrl) {
        return new Response(
          JSON.stringify({ error: "Could not prepare completed download" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
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

    return new Response(
      JSON.stringify({
        envelopeId,
        artifacts: responseArtifacts,
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

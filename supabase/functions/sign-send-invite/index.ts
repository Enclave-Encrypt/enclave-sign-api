const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type InviteInput = {
  recipient_id: string;
  email: string;
  name?: string | null;
  signing_url: string;
};

type SendInviteBody = {
  envelope_id?: string;
  subject?: string;
  sender_name?: string | null;
  invites?: InviteInput[];
};

function getResendApiKey(): string {
  return Deno.env.get("RESEND_API_KEY")?.trim() ?? "";
}

function inviteFromAddress(): string {
  return Deno.env.get("SIGN_INVITE_FROM_EMAIL")?.trim() ??
    "Enclave Sign <noreply@enclave.talk>";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildInviteHtml(input: {
  recipientName: string;
  senderName: string;
  subject: string;
  signingUrl: string;
}): string {
  const greeting = escapeHtml(input.recipientName);
  const sender = escapeHtml(input.senderName);
  const subject = escapeHtml(input.subject);
  const url = escapeHtml(input.signingUrl);

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;color:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#111;border:1px solid #2a2a2a;">
          <tr>
            <td style="padding:28px 28px 8px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#ff6b2c;font-weight:600;">
              Enclave Sign
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 16px;font-size:22px;font-weight:600;line-height:1.3;">
              ${sender} sent you a document to sign
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 16px;font-size:15px;line-height:1.6;color:#b3b3b3;">
              Hi ${greeting}, review and sign <strong style="color:#fff;">${subject}</strong>.
              Documents are encrypted with post-quantum cryptography and decrypted on your device.
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              <a href="${url}" style="display:inline-block;background:#ff6b2c;color:#0a0a0a;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;">
                Review and sign
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;font-size:12px;line-height:1.6;color:#666;">
              If the button does not work, copy this link into your browser:<br />
              <span style="color:#999;word-break:break-all;">${url}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    return { ok: false, reason: "resend_not_configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: inviteFromAddress(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  const body = (await response.json()) as { id?: string; message?: string };

  if (!response.ok) {
    return { ok: false, reason: body.message ?? `resend_${response.status}` };
  }

  return { ok: true, id: body.id ?? "sent" };
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
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const socialUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!socialUrl || !anonKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const userClient = createClient(socialUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as SendInviteBody;
    const envelopeId = body.envelope_id?.trim();
    const subject = body.subject?.trim();
    const invites = body.invites ?? [];
    const senderName = body.sender_name?.trim() || "An Enclave user";

    if (!envelopeId || !subject || invites.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: envelope, error: envelopeError } = await userClient
      .from("sign_envelopes")
      .select("id")
      .eq("id", envelopeId)
      .eq("enclave_user_id", user.id)
      .maybeSingle();

    if (envelopeError || !envelope) {
      return new Response(JSON.stringify({ error: "Envelope not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{
      recipient_id: string;
      email: string;
      ok: boolean;
      reason?: string;
      resend_id?: string;
    }> = [];

    for (const invite of invites) {
      const email = invite.email?.trim().toLowerCase();
      const signingUrl = invite.signing_url?.trim();

      if (!email || !signingUrl || !invite.recipient_id) {
        results.push({
          recipient_id: invite.recipient_id ?? "",
          email: email ?? "",
          ok: false,
          reason: "invalid_invite",
        });
        continue;
      }

      const recipientName = invite.name?.trim() || email.split("@")[0] || "there";
      const emailSubject = `${senderName} sent you a document to sign: ${subject}`;

      const sent = await sendResendEmail({
        to: email,
        subject: emailSubject,
        html: buildInviteHtml({
          recipientName,
          senderName,
          subject,
          signingUrl,
        }),
      });

      results.push({
        recipient_id: invite.recipient_id,
        email,
        ok: sent.ok,
        reason: sent.ok ? undefined : sent.reason,
        resend_id: sent.ok ? sent.id : undefined,
      });
    }

    const sentCount = results.filter((entry) => entry.ok).length;

    return new Response(
      JSON.stringify({
        ok: sentCount > 0,
        sent: sentCount,
        failed: results.length - sentCount,
        results,
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

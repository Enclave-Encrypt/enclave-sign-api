import {
  buildSigningUrl,
  generateSigningToken,
  hashSigningToken,
} from "@enclave/sign-sdk/signing-tokens";

import {
  handleSignOptions,
  jsonResponse,
  requireSignPost,
} from "../_shared/sign/http.ts";
import {
  createSignUserClient,
  requireSignAnonConfig,
} from "../_shared/sign/supabase.ts";

type InviteInput = {
  recipient_id: string;
  email: string;
  name?: string | null;
  signing_url?: string;
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

function signSiteUrl(): string {
  return Deno.env.get("SIGN_SITE_URL")?.trim() ??
    Deno.env.get("NEXT_PUBLIC_SIGN_SITE_URL")?.trim() ??
    "https://sign.enclave.talk";
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
  const options = handleSignOptions(req);
  if (options) return options;

  const methodError = requireSignPost(req);
  if (methodError) return methodError;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const config = requireSignAnonConfig();
    if (!config) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    const userClient = createSignUserClient(config, accessToken);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as SendInviteBody;
    const envelopeId = body.envelope_id?.trim();
    const subject = body.subject?.trim();
    const invites = body.invites ?? [];
    const senderName = body.sender_name?.trim() || "An Enclave user";

    if (!envelopeId || !subject || invites.length === 0) {
      return jsonResponse({ error: "Invalid request" }, 400);
    }

    const { data: envelope, error: envelopeError } = await userClient
      .from("envelopes")
      .select("id")
      .eq("id", envelopeId)
      .eq("enclave_user_id", user.id)
      .maybeSingle();

    if (envelopeError || !envelope) {
      return jsonResponse({ error: "Envelope not found" }, 404);
    }

    const { data: envelopeRecipients, error: recipientsError } = await userClient
      .from("envelope_recipients")
      .select("id, email, status")
      .eq("envelope_id", envelopeId);

    if (recipientsError || !envelopeRecipients) {
      return jsonResponse({ error: "Recipients not found" }, 404);
    }

    const recipientsById = new Map(
      envelopeRecipients.map((entry) => [entry.id as string, entry]),
    );

    const results: Array<{
      recipient_id: string;
      email: string;
      ok: boolean;
      reason?: string;
      resend_id?: string;
    }> = [];

    for (const invite of invites) {
      const email = invite.email?.trim().toLowerCase();
      const recipientId = invite.recipient_id?.trim();

      if (!email || !recipientId) {
        results.push({
          recipient_id: recipientId ?? "",
          email: email ?? "",
          ok: false,
          reason: "invalid_invite",
        });
        continue;
      }

      const recipient = recipientsById.get(recipientId);
      if (!recipient) {
        results.push({
          recipient_id: recipientId,
          email,
          ok: false,
          reason: "recipient_not_found",
        });
        continue;
      }

      if ((recipient.email as string).toLowerCase() !== email) {
        results.push({
          recipient_id: recipientId,
          email,
          ok: false,
          reason: "recipient_email_mismatch",
        });
        continue;
      }

      let signingUrl = invite.signing_url?.trim() ?? "";

      if (!signingUrl) {
        const token = generateSigningToken();
        const tokenHash = hashSigningToken(token);

        const { error: tokenUpdateError } = await userClient
          .from("envelope_recipients")
          .update({ signing_token_hash: tokenHash })
          .eq("id", recipientId)
          .eq("envelope_id", envelopeId);

        if (tokenUpdateError) {
          results.push({
            recipient_id: recipientId,
            email,
            ok: false,
            reason: "signing_link_failed",
          });
          continue;
        }

        signingUrl = buildSigningUrl(token, signSiteUrl());
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
        recipient_id: recipientId,
        email,
        ok: sent.ok,
        reason: sent.ok ? undefined : sent.reason,
        resend_id: sent.ok ? sent.id : undefined,
      });
    }

    const sentCount = results.filter((entry) => entry.ok).length;

    return jsonResponse({
      ok: sentCount > 0,
      sent: sentCount,
      failed: results.length - sentCount,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});

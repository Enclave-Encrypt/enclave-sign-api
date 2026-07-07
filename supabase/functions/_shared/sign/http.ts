export const signCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...signCorsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function actionResponse(
  body: { ok: boolean; reason?: string; [key: string]: unknown },
  status = 200,
): Response {
  return jsonResponse(body, status);
}

export function handleSignOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: signCorsHeaders });
  }
  return null;
}

export function requireSignPost(req: Request): Response | null {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  return null;
}

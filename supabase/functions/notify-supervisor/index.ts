// Supabase Edge Function: sends a push notification to a Yard Supervisor's
// device when a truck gets assigned to them.
//
// Trigger: a Supabase Database Webhook on `vehicles`, event UPDATE, pointed
// at this function's URL. See ANDROID_BUILD.md for how to wire that up.
//
// Required secrets (set with `supabase secrets set ...`, see ANDROID_BUILD.md):
//   FIREBASE_SERVICE_ACCOUNT  - the full JSON contents of a Firebase service
//                                account key (Firebase console -> Project
//                                settings -> Service accounts -> Generate new
//                                private key), as a single-line string.
//   SUPABASE_URL               - auto-provided by Supabase, no action needed.
//   SUPABASE_SERVICE_ROLE_KEY  - auto-provided by Supabase, no action needed.

import { createClient } from "npm:@supabase/supabase-js@2";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(serviceAccount: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.${base64url(
    new TextEncoder().encode(JSON.stringify(claim))
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Failed to get FCM access token: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

async function sendFcm(projectId: string, accessToken: string, token: string, title: string, body: string) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        android: { priority: "high" },
      },
    }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record ?? {};
    const oldRecord = payload.old_record ?? {};

    const supervisorName = record.assigned_supervisor;
    const changed = supervisorName && supervisorName !== oldRecord.assigned_supervisor;
    if (!changed) {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .eq("role", "Yard Supervisor")
      .eq("full_name", supervisorName)
      .maybeSingle();

    if (!profile) {
      return new Response(JSON.stringify({ skipped: true, reason: "no matching supervisor profile" }), { status: 200 });
    }

    const { data: tokens } = await supabaseAdmin
      .from("push_tokens")
      .select("token")
      .eq("user_id", profile.user_id);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "no push tokens for supervisor" }), { status: 200 });
    }

    const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
    const accessToken = await getAccessToken(serviceAccount);

    const title = "New truck assigned";
    const body = `${record.vehicle_number ?? "A truck"} has been assigned to you.`;

    const results = [];
    for (const { token } of tokens) {
      const result = await sendFcm(serviceAccount.project_id, accessToken, token, title, body);
      results.push(result);
      // Token no longer valid on the device (uninstalled, etc.) - drop it.
      if (!result.ok && (result.status === 404 || result.body.includes("UNREGISTERED"))) {
        await supabaseAdmin.from("push_tokens").delete().eq("token", token);
      }
    }

    return new Response(JSON.stringify({ sent: results.length, results }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

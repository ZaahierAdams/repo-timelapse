// Repo Timelapse ingest.
// Accepts the stats JSON only from the nightly GitHub Action in ZaahierAdams/repo-timelapse,
// proven with a GitHub OIDC token (no shared secret to leak or rotate).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "repo-timelapse-ingest";
const OWNER_ID = "58355846"; // ZaahierAdams — survives renames, blocks look-alike repos
const WORKFLOW = "ZaahierAdams/repo-timelapse/.github/workflows/collect.yml@refs/heads/main";
const MAX_BYTES = 25 * 1024 * 1024;

const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "missing token" });

  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUDIENCE });
    if (
      payload.repository_owner_id !== OWNER_ID ||
      payload.job_workflow_ref !== WORKFLOW ||
      payload.ref !== "refs/heads/main"
    ) {
      return json(403, { error: "workflow not allowed" });
    }
  } catch {
    return json(401, { error: "invalid token" });
  }

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return json(413, { error: "payload too large" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }
  if (!body || typeof body !== "object" || !Array.isArray((body as { repos?: unknown }).repos)) {
    return json(400, { error: "payload.repos must be an array" });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc("repo_timelapse_ingest", { payload: body });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, generated_at: data, repos: (body as { repos: unknown[] }).repos.length });
});

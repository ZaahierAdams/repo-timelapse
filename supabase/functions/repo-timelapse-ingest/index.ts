// Repo Timelapse ingest.
// Each of ZaahierAdams' repos runs the reusable workflow
// ZaahierAdams/repo-timelapse/.github/workflows/repo-stats.yml@main on push and posts its own stats here,
// proven with a GitHub OIDC token. No shared secret exists anywhere.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "repo-timelapse-ingest";
const OWNER = "ZaahierAdams";
const OWNER_ID = "58355846"; // survives renames, blocks look-alike accounts
// Only code from this exact reusable workflow on main may send data.
const WORKFLOW = "ZaahierAdams/repo-timelapse/.github/workflows/repo-stats.yml@refs/heads/main";
const MAX_BYTES = 10 * 1024 * 1024;

const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "missing token" });

  let repoName: string, visibility: string;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUDIENCE });
    const repository = String(payload.repository ?? "");
    if (
      payload.repository_owner_id !== OWNER_ID ||
      payload.job_workflow_ref !== WORKFLOW ||
      !repository.startsWith(`${OWNER}/`)
    ) {
      return json(403, { error: "workflow not allowed" });
    }
    repoName = repository.slice(OWNER.length + 1);
    visibility = String(payload.repository_visibility ?? "private");
  } catch {
    return json(401, { error: "invalid token" });
  }
  if (repoName === "repo-timelapse") return json(200, { ok: true, skipped: "self" });

  if (Number(req.headers.get("content-length") ?? "0") > MAX_BYTES) return json(413, { error: "payload too large" });
  let body: { generated_at?: string; repo?: Record<string, unknown> | null };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // A repo with no history on its default branch is removed rather than shown empty.
  if (!body.repo) {
    const { error } = await sb.rpc("repo_timelapse_delete_repo", { repo_name: repoName });
    return error ? json(500, { error: error.message }) : json(200, { ok: true, repo: repoName, removed: true });
  }
  if (!Array.isArray(body.repo.series)) return json(400, { error: "repo.series must be an array" });

  // identity comes from the verified token, never from the payload
  const data = { ...body.repo, name: repoName, private: visibility !== "public" };
  const { error } = await sb.rpc("repo_timelapse_upsert_repo", {
    repo_name: repoName, payload: data, generated: body.generated_at ?? null,
  });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, repo: repoName, days: (body.repo.series as unknown[]).length });
});

import { createSign, randomBytes } from "node:crypto";
import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

import { CONNECTOR_TOKEN_SECRET_PREFIX, sm } from "@/utils/connectors";

/**
 * GitHub App integration for the GitHub connector.
 *
 * One GitHub App is registered per Context101 deployment via GitHub's
 * app-manifest flow (no manual copy-pasting of keys): the Sources page
 * links to /api/connectors/github-app/create, GitHub shows a pre-filled
 * "Create GitHub App" page, and the manifest callback receives the app's
 * credentials and stores them here. Users then connect repos through
 * GitHub's own installation screen (per-repo consent) instead of pasting
 * PATs, and the sync Lambda mints short-lived installation tokens.
 *
 * The config lives in one Secrets Manager secret under the connector
 * prefix, so the existing SSR + sync-Lambda IAM grants
 * (context101-connector-*) cover it with no infra changes.
 */

export const GITHUB_APP_SECRET_NAME = `${CONNECTOR_TOKEN_SECRET_PREFIX}github-app`;

export type GithubAppConfig = {
  app_id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  /** PEM-encoded RSA private key GitHub generated for the app. */
  private_key: string;
  html_url: string;
  /** The (single) installation this deployment uses, once installed. */
  installation_id?: number;
  /** ARN of this secret — stored on app-authed connector rows so the sync
   *  Lambda can read the config without extra env plumbing. */
  secret_arn?: string;
};

export async function getGithubAppConfig(): Promise<GithubAppConfig | null> {
  try {
    const r = await sm.send(
      new GetSecretValueCommand({ SecretId: GITHUB_APP_SECRET_NAME })
    );
    if (!r.SecretString) return null;
    const cfg = JSON.parse(r.SecretString) as GithubAppConfig;
    cfg.secret_arn = r.ARN ?? cfg.secret_arn;
    return cfg;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return null;
    throw err;
  }
}

export async function saveGithubAppConfig(
  cfg: Omit<GithubAppConfig, "secret_arn">
): Promise<string> {
  const body = JSON.stringify(cfg);
  try {
    const created = await sm.send(
      new CreateSecretCommand({
        Name: GITHUB_APP_SECRET_NAME,
        Description: "Context101 GitHub App credentials (manifest flow)",
        SecretString: body,
      })
    );
    return created.ARN!;
  } catch (err) {
    // Already exists (re-setup / installation-id update) — overwrite.
    if ((err as { name?: string }).name === "ResourceExistsException") {
      const updated = await sm.send(
        new PutSecretValueCommand({
          SecretId: GITHUB_APP_SECRET_NAME,
          SecretString: body,
        })
      );
      return updated.ARN!;
    }
    throw err;
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Short-lived app JWT (RS256) — authenticates as the app itself. */
export function githubAppJwt(cfg: Pick<GithubAppConfig, "app_id" | "private_key">): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // 60s clock-drift backdate per GitHub's docs; 8min expiry (max 10).
  const payload = b64url(
    JSON.stringify({ iat: now - 60, exp: now + 8 * 60, iss: cfg.app_id })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer
    .sign(cfg.private_key)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.${signature}`;
}

async function githubApi(
  token: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "context101-github-app",
      ...(init?.headers ?? {}),
    },
  });
}

/** Mint a short-lived (1h) installation access token for repo reads. */
export async function mintInstallationToken(
  cfg: Pick<GithubAppConfig, "app_id" | "private_key">,
  installationId: number
): Promise<string> {
  const r = await githubApi(
    githubAppJwt(cfg),
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST" }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(
      `installation token mint failed (${r.status}): ${body.slice(0, 300)}`
    );
  }
  const j = (await r.json()) as { token: string };
  return j.token;
}

/** Can this installation read owner/repo? (404 ⇒ not covered.) */
export async function installationCanAccessRepo(
  installationToken: string,
  ownerRepo: string
): Promise<boolean> {
  const r = await githubApi(installationToken, `/repos/${ownerRepo}`);
  return r.ok;
}

/** GitHub's own repo-picker/consent screen for this app. `state` round-trips
 *  to the app's Setup URL so the callback can resume the connector. */
export function installUrl(slug: string, state: string): string {
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

/** Manifest for GitHub's "create app from manifest" flow. */
export function buildAppManifest(origin: string) {
  const suffix = randomBytes(3).toString("hex");
  return {
    // App names are globally unique on GitHub, ≤34 chars.
    name: `context101-${suffix}`,
    url: origin,
    redirect_url: `${origin}/api/connectors/github-app/manifest-callback`,
    setup_url: `${origin}/api/connectors/github-app/setup-callback`,
    setup_on_update: true,
    public: false,
    default_permissions: {
      contents: "read",
      metadata: "read",
    },
    default_events: [],
  };
}

/** Exchange the manifest-flow code for the app's credentials. */
export async function convertManifestCode(code: string): Promise<{
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  pem: string;
  html_url: string;
}> {
  const r = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "context101-github-app",
      },
    }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(
      `manifest conversion failed (${r.status}): ${body.slice(0, 300)}`
    );
  }
  return (await r.json()) as {
    id: number;
    slug: string;
    client_id: string;
    client_secret: string;
    pem: string;
    html_url: string;
  };
}

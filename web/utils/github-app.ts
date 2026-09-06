import {
  createHmac,
  createSign,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
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
  /** Legacy single-tenant field; new installs live in github_app_installations. */
  installation_id?: number;
  /** ARN of this secret — stored on app-authed connector rows so the sync
   *  Lambda can read the config without extra env plumbing. */
  secret_arn?: string;
};

export type GithubInstallationDetails = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  settingsUrl: string | null;
};

export type GithubRepository = {
  fullName: string;
  htmlUrl: string;
  private: boolean;
  installationId: string;
  accountLogin: string;
};

type GithubState = {
  v: 1;
  purpose: "install" | "oauth";
  orgId: string;
  userId: string;
  installationId?: string;
  exp: number;
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
  installationId: string | number
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

/** Read the app's current identity so GitHub App renames do not leave stale
 * slug-based install URLs in the deployment secret. */
export async function getGithubAppProfile(
  cfg: Pick<GithubAppConfig, "app_id" | "private_key">
): Promise<{ name: string; slug: string; htmlUrl: string }> {
  const r = await githubApi(githubAppJwt(cfg), "/app");
  if (!r.ok) {
    throw new Error(`GitHub App profile could not be read (${r.status})`);
  }
  const body = (await r.json()) as {
    name?: string;
    slug?: string;
    html_url?: string;
  };
  if (!body.name || !body.slug || !body.html_url) {
    throw new Error("GitHub App profile is incomplete");
  }
  return { name: body.name, slug: body.slug, htmlUrl: body.html_url };
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

function signState(
  cfg: Pick<GithubAppConfig, "client_secret">,
  state: GithubState
): string {
  const payload = b64url(JSON.stringify(state));
  const signature = b64url(
    createHmac("sha256", cfg.client_secret).update(payload).digest()
  );
  return `${payload}.${signature}`;
}

export function createGithubInstallState(
  cfg: Pick<GithubAppConfig, "client_secret">,
  auth: { orgId: string; userId: string }
): string {
  return signState(cfg, {
    v: 1,
    purpose: "install",
    orgId: auth.orgId,
    userId: auth.userId,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  });
}

export function createGithubOauthState(
  cfg: Pick<GithubAppConfig, "client_secret">,
  auth: { orgId: string; userId: string },
  installationId: string
): string {
  return signState(cfg, {
    v: 1,
    purpose: "oauth",
    orgId: auth.orgId,
    userId: auth.userId,
    installationId,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  });
}

export function verifyGithubState(
  cfg: Pick<GithubAppConfig, "client_secret">,
  value: string,
  purpose: GithubState["purpose"]
): GithubState | null {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", cfg.client_secret)
    .update(payload)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }
  try {
    const state = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as GithubState;
    if (
      state.v !== 1 ||
      state.purpose !== purpose ||
      !state.orgId ||
      !state.userId ||
      state.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function githubOauthUrl(
  cfg: Pick<GithubAppConfig, "client_id">,
  origin: string,
  state: string
): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", cfg.client_id);
  url.searchParams.set(
    "redirect_uri",
    `${origin}/api/connectors/github-app/oauth-callback`
  );
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGithubOauthCode(
  cfg: Pick<GithubAppConfig, "client_id" | "client_secret">,
  code: string
): Promise<string> {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "context101-github-app",
    },
    body: JSON.stringify({
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      code,
    }),
  });
  const body = (await r.json().catch(() => null)) as
    | { access_token?: string; error_description?: string }
    | null;
  if (!r.ok || !body?.access_token) {
    throw new Error(
      body?.error_description ?? `GitHub authorization failed (${r.status})`
    );
  }
  return body.access_token;
}

export async function userCanAccessInstallation(
  userToken: string,
  installationId: string
): Promise<boolean> {
  const r = await githubApi(
    userToken,
    `/user/installations/${encodeURIComponent(installationId)}`
  );
  return r.ok;
}

export async function getInstallationDetails(
  cfg: Pick<GithubAppConfig, "app_id" | "private_key">,
  installationId: string
): Promise<GithubInstallationDetails> {
  const r = await githubApi(
    githubAppJwt(cfg),
    `/app/installations/${encodeURIComponent(installationId)}`
  );
  if (!r.ok) {
    throw new Error(`GitHub installation could not be read (${r.status})`);
  }
  const body = (await r.json()) as {
    id: number;
    account?: { login?: string; type?: string };
    repository_selection?: string;
    html_url?: string;
  };
  if (!body.account?.login) {
    throw new Error("GitHub installation is missing its account");
  }
  return {
    installationId: String(body.id),
    accountLogin: body.account.login,
    accountType: body.account.type ?? "Account",
    repositorySelection: body.repository_selection ?? "selected",
    settingsUrl: body.html_url ?? null,
  };
}

export async function listInstallationRepositories(
  installationToken: string,
  installationId: string,
  accountLogin: string
): Promise<GithubRepository[]> {
  const repositories: GithubRepository[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const r = await githubApi(
      installationToken,
      `/installation/repositories?per_page=100&page=${page}`
    );
    if (!r.ok) {
      throw new Error(`GitHub repositories could not be listed (${r.status})`);
    }
    const body = (await r.json()) as {
      repositories?: Array<{
        full_name?: string;
        html_url?: string;
        private?: boolean;
      }>;
    };
    const batch = body.repositories ?? [];
    for (const repo of batch) {
      if (!repo.full_name || !repo.html_url) continue;
      repositories.push({
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        private: !!repo.private,
        installationId,
        accountLogin,
      });
    }
    if (batch.length < 100) break;
  }
  return repositories;
}

/** Manifest for GitHub's "create app from manifest" flow. */
export function buildAppManifest(origin: string, setupNonce?: string) {
  const suffix = randomBytes(3).toString("hex");
  const redirectUrl = new URL(
    "/api/connectors/github-app/manifest-callback",
    origin
  );
  if (setupNonce) redirectUrl.searchParams.set("setup_state", setupNonce);
  return {
    // App names are globally unique on GitHub, ≤34 chars.
    name: `context101-${suffix}`,
    url: origin,
    redirect_url: redirectUrl.toString(),
    callback_urls: [`${origin}/api/connectors/github-app/oauth-callback`],
    setup_url: `${origin}/api/connectors/github-app/setup-callback`,
    setup_on_update: true,
    // Public means any GitHub account or organization can install this
    // deployment's app. It does not publish the app to GitHub Marketplace.
    public: true,
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

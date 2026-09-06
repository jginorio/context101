import type { NextRequest } from "next/server";

type HeaderReader = {
  get(name: string): string | null;
};

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(":")[0].toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function originFromEnv(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (isLoopbackHost(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Public origin from APP_URL / BETTER_AUTH_URL when those point off-loopback.
 * Hosted Amplify SSR often reports localhost in Host / x-forwarded-host;
 * the configured URL is the only reliable public hostname in that case.
 */
export function configuredPublicOrigin(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return originFromEnv(env.APP_URL) ?? originFromEnv(env.BETTER_AUTH_URL);
}

/**
 * Derive the public origin (scheme + host) from request headers.
 *
 * Why this exists: on Amplify Hosting's SSR Lambda runtime,
 * `request.nextUrl.origin` returns `https://localhost:3000` because
 * Next.js can't see the public hostname from inside the compute
 * container. The public host + proto are usually passed through as
 * `x-forwarded-host` and `x-forwarded-proto` — but Amplify sometimes
 * forwards localhost there too, so a configured APP_URL / BETTER_AUTH_URL
 * wins whenever the derived host is loopback.
 *
 * Order of preference:
 *   1. x-forwarded-host + x-forwarded-proto   (Amplify, CloudFront, most proxies)
 *   2. host header                            (local dev, direct requests)
 *   3. fallbackOrigin                         (request.nextUrl.origin)
 *   4. configured APP_URL / BETTER_AUTH_URL   (when 1–3 resolved to localhost)
 */
export function resolvePublicOrigin(
  headers: HeaderReader,
  fallbackOrigin: string,
  configuredOrigin: string | null = configuredPublicOrigin()
): string {
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");

  let derived: string;
  if (forwardedHost) {
    const proto = forwardedProto ?? "https";
    const host = forwardedHost.split(",")[0].trim();
    derived = `${proto}://${host}`;
  } else {
    const host = headers.get("host");
    if (host) {
      const proto =
        forwardedProto ?? (isLoopbackHost(host) ? "http" : "https");
      derived = `${proto}://${host}`;
    } else {
      derived = fallbackOrigin;
    }
  }

  if (configuredOrigin) {
    try {
      if (isLoopbackHost(new URL(derived).hostname)) return configuredOrigin;
    } catch {
      return configuredOrigin;
    }
  }

  return derived;
}

export function getPublicOrigin(request: NextRequest): string {
  return resolvePublicOrigin(request.headers, request.nextUrl.origin);
}

/** Absolute URL on the public origin — never `https://localhost:3000` in prod. */
export function getPublicUrl(request: NextRequest, path: string): URL {
  return new URL(path, `${getPublicOrigin(request)}/`);
}

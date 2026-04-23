import type { NextRequest } from "next/server";

/**
 * Derive the public origin (scheme + host) of the incoming request.
 *
 * Why this exists: on Amplify Hosting's SSR Lambda runtime,
 * `request.nextUrl.origin` returns `https://localhost:3000` because
 * Next.js can't see the public hostname from inside the compute
 * container. The public host + proto are passed through as
 * `x-forwarded-host` and `x-forwarded-proto` headers.
 *
 * Order of preference:
 *   1. x-forwarded-host + x-forwarded-proto   (Amplify, CloudFront, most proxies)
 *   2. host header                            (local dev, direct requests)
 *   3. request.nextUrl.origin                 (last-resort fallback)
 */
export function getPublicOrigin(request: NextRequest): string {
  const h = request.headers;
  const forwardedHost = h.get("x-forwarded-host");
  const forwardedProto = h.get("x-forwarded-proto");

  if (forwardedHost) {
    const proto = forwardedProto ?? "https";
    // x-forwarded-host can contain a comma-separated list; take the first.
    const host = forwardedHost.split(",")[0].trim();
    return `${proto}://${host}`;
  }

  const host = h.get("host");
  if (host) {
    const proto =
      forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return request.nextUrl.origin;
}

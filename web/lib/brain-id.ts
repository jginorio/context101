/**
 * Active-brain id resolution. Client and server share this precedence:
 *   ?brain=<id>  →  x-brain-id header  →  ctx_brain cookie  →  none
 *
 * There is no implicit `default` brain. An empty catalog means no brain
 * is selected; the user creates the first one. Do not invent an id here.
 */

export const COOKIE_NAME = "ctx_brain";
export const QUERY_PARAM = "brain";
export const HEADER_NAME = "x-brain-id";

export function resolveRequestedBrainId(input: {
  query?: string | null;
  header?: string | null;
  cookie?: string | null;
}): string | null {
  for (const raw of [input.query, input.header, input.cookie]) {
    const value = raw?.trim();
    if (value) return value;
  }
  return null;
}

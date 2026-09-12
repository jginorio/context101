/**
 * GitHub connector document format.
 *
 * Sync writes a citation header in front of the repo file so retrieval can
 * name the source. Apply must invert that header before Contents PUT, and
 * hash the body without `last synced` so a 6h re-PUT is not a content change.
 *
 * Keep the header strings identical to
 * `cdk/lambda/connector-sync-github/index.mjs` (renderMarkdown / renderCode).
 */

export type GithubRenderCtx = {
  path: string;
  repoFullName: string;
  htmlUrl: string;
  now: string;
  language?: string;
};

export function renderMarkdown(text: string, ctx: GithubRenderCtx): string {
  return [
    `# ${ctx.path}`,
    "",
    `Source: [GitHub](${ctx.htmlUrl}) · repo \`${ctx.repoFullName}\` · last synced ${ctx.now}`,
    "",
    text,
    "",
  ].join("\n");
}

export function renderCode(text: string, ctx: GithubRenderCtx): string {
  const fence = ctx.language || "";
  return [
    `# ${ctx.path}`,
    "",
    `Source: [GitHub](${ctx.htmlUrl}) · repo \`${ctx.repoFullName}\` · ${ctx.language || "text"} · last synced ${ctx.now}`,
    "",
    `\`\`\`${fence}`,
    text,
    "```",
    "",
  ].join("\n");
}

/** Strip the sync citation header. No-op when the GitHub Source line is absent. */
export function invertGithubS3Body(body: string): string {
  const lines = body.split("\n");
  if (lines.length < 3) return body;
  if (!lines[0].startsWith("# ")) return body;
  let srcIdx = -1;
  const limit = Math.min(lines.length, 6);
  for (let i = 1; i < limit; i += 1) {
    if (
      lines[i].startsWith("Source: [GitHub](") &&
      lines[i].includes("last synced")
    ) {
      srcIdx = i;
      break;
    }
  }
  if (srcIdx < 0) return body;
  let start = srcIdx + 1;
  if (lines[start] === "") start += 1;
  let end = lines.length;
  if (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

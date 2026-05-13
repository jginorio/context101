"use client";

import * as React from "react";
import { ChevronDown, ExternalLink, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Dropdown that opens the supplied query in ChatGPT, Claude, or Cursor.
 *
 *   - ChatGPT / Claude: regular HTTPS URLs, opened in a new tab.
 *   - Cursor:           custom URL scheme handled by the desktop app.
 *                       Browser will prompt "Open Cursor?" the first time.
 *                       Falls through silently if Cursor isn't installed.
 *
 * Wiki / file viewers wrap the markdown body in a short instruction
 * prefix so the receiving agent has context for what was sent.
 */

// URL length cap. Browsers vary (Chrome ~32k, Safari ~80k) but the
// receiving platforms truncate around 8k–10k chars regardless. 6000
// leaves headroom for the URL-encoded form to fit comfortably under
// every limit we've observed.
const MAX_QUERY_LEN = 6000;

type Platform = {
  label: string;
  url: (encoded: string) => string;
  // External link (true) opens in a new tab. Custom-scheme links
  // (false) navigate in-place; browsers intercept and prompt.
  external: boolean;
};

const PLATFORMS: Platform[] = [
  {
    label: "ChatGPT",
    url: (q) => `https://chatgpt.com/?q=${q}`,
    external: true,
  },
  {
    label: "Claude",
    url: (q) => `https://claude.ai/new?q=${q}`,
    external: true,
  },
  {
    label: "Cursor",
    // The Cursor desktop deeplink. If Cursor isn't installed, the
    // browser will silently no-op (or show "no app handles this link"
    // depending on the OS).
    url: (q) => `cursor://anysphere.cursor-deeplink/prompt?text=${q}`,
    external: false,
  },
];

function buildQuery(content: string, title?: string): string {
  // Light prefix so the receiving agent has context for what landed.
  // Intentionally short — the doc content does most of the explaining.
  const prefix = title
    ? `Here's a doc from my team's knowledge base ("${title}"). Help me understand it:\n\n`
    : "Here's a doc from my team's knowledge base. Help me understand it:\n\n";
  const body = `${prefix}${content}`;
  if (body.length <= MAX_QUERY_LEN) return body;
  return body.slice(0, MAX_QUERY_LEN - 16) + "\n\n…[truncated]";
}

export function OpenInChat({
  content,
  title,
}: {
  /** Raw markdown / text to send into the chosen agent. */
  content: string;
  /** Optional doc title — included in the prompt prefix. */
  title?: string;
}) {
  const query = React.useMemo(
    () => encodeURIComponent(buildQuery(content, title)),
    [content, title]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <MessageSquare className="mr-1 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Open in chat</span>
            <span className="sm:hidden">Chat</span>
            <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {PLATFORMS.map((p) => (
          <DropdownMenuItem
            key={p.label}
            render={
              <a
                href={p.url(query)}
                target={p.external ? "_blank" : undefined}
                rel={p.external ? "noreferrer" : undefined}
              />
            }
          >
            <span>{p.label}</span>
            <ExternalLink className="ml-auto h-3 w-3 opacity-60" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

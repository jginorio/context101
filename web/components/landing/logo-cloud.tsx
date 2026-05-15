import * as React from "react";
import { Bot, Code2, MessageSquare, Sparkles, Terminal } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Strip of MCP clients that work with Context101. These are real
 * integration targets (not a faux logo wall): every entry below is an
 * agent the team has actually connected to a brain via MCP.
 *
 * Rendered as icon + wordmark chips so we don't depend on third-party
 * brand SVGs we don't own.
 */
const CLIENTS: Array<{ name: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { name: "Claude Desktop", Icon: MessageSquare },
  { name: "Claude Code", Icon: Terminal },
  { name: "Cursor", Icon: Code2 },
  { name: "Devin", Icon: Bot },
  { name: "Your custom agent", Icon: Sparkles },
];

export function LogoCloud({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-8 gap-y-4 sm:gap-x-12",
        className,
      )}
    >
      {CLIENTS.map(({ name, Icon }) => (
        <div
          key={name}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <Icon className="size-4 shrink-0" />
          <span className="text-sm font-medium tracking-tight">{name}</span>
        </div>
      ))}
    </div>
  );
}

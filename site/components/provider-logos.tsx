"use client";

import * as React from "react";
import { Anthropic, Bedrock, Gemini, Grok, OpenAI } from "@lobehub/icons";

import { Marquee } from "@/components/ui/marquee";

// LLM providers Context101 can generate wikis with. Rendered as monochrome
// brand marks (a clean, consistent "logo cloud") via @lobehub/icons — which,
// unlike Lucide or Simple Icons, ships an official xAI Grok mark.
const PROVIDERS: { name: string; Icon: React.ComponentType<{ size?: number }> }[] =
  [
    { name: "Amazon Bedrock", Icon: Bedrock },
    { name: "Anthropic", Icon: Anthropic },
    { name: "OpenAI", Icon: OpenAI },
    { name: "Google Gemini", Icon: Gemini },
    { name: "xAI Grok", Icon: Grok },
  ];

export function ProviderMarquee() {
  return (
    <Marquee className="py-1 [--duration:34s] [--gap:3.25rem]">
      {PROVIDERS.map(({ name, Icon }) => (
        <div
          key={name}
          className="flex items-center gap-2.5 text-foreground/70 transition-colors hover:text-foreground"
          title={name}
        >
          <Icon size={24} />
          <span className="whitespace-nowrap text-sm font-medium tracking-[-0.01em]">
            {name}
          </span>
        </div>
      ))}
    </Marquee>
  );
}

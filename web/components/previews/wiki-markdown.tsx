"use client";

import Link from "next/link";
import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MermaidDiagram } from "@/components/previews/mermaid-diagram";

function childText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
    .join("");
}

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const lang = match?.[1];
    const text = String(children).replace(/\n$/, "");
    if (lang === "mermaid") {
      return <MermaidDiagram code={text} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children, ...props }) {
    const text = childText(children);
    // Source citations render as `[sources/...md]()` — empty href, the S3 key
    // as the link text. Turn those into deep-links that open the cited
    // knowledge doc in a tab on /knowledge.
    const isCitation = (!href || href === "") && /\//.test(text) && /\.md$/.test(text);
    if (isCitation) {
      return (
        <Link href={`/knowledge?open=${encodeURIComponent(text)}`}>
          {children}
        </Link>
      );
    }
    if (href && /^https?:\/\//.test(href)) {
      return (
        <a href={href} target="_blank" rel="noreferrer" {...props}>
          {children}
        </a>
      );
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
};

export function WikiMarkdown({ content }: { content: string }) {
  return (
    <article className="prose prose-sm max-w-none dark:prose-invert prose-pre:text-xs prose-headings:tracking-tight">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  );
}

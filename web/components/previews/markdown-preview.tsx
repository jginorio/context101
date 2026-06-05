"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function childText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
    .join("");
}

export function MarkdownPreview({
  content,
  onOpenKey,
}: {
  content: string;
  // When provided, internal document links (S3 keys, e.g. Notion child pages)
  // open in a tab instead of navigating the browser.
  onOpenKey?: (key: string) => void;
}) {
  const components: Components | undefined = onOpenKey
    ? {
        a({ href, children, ...props }) {
          const isInternal =
            href && !/^(https?:|mailto:|#|\/)/.test(href) && /\.md$/.test(href);
          if (isInternal) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  onOpenKey(href as string);
                }}
                className="cursor-pointer"
                {...props}
              >
                {children || childText(children)}
              </a>
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
      }
    : undefined;

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert prose-pre:text-xs prose-headings:tracking-tight">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  );
}

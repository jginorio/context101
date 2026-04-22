"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MermaidDiagram } from "@/components/previews/mermaid-diagram";

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

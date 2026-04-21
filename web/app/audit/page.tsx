"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Link2,
  Copy,
  Layers,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyFindingDialog } from "@/components/apply-finding-dialog";
import { cn } from "@/lib/utils";
import type { Finding } from "@/utils/bedrock";

import "@/utils/amplify-client-config";

function CategoryIcon({ category }: { category: Finding["category"] }) {
  const cls = "h-3.5 w-3.5";
  switch (category) {
    case "overlap":
      return <Copy className={cls} />;
    case "missing_link":
      return <Link2 className={cls} />;
    case "inconsistency":
      return <AlertTriangle className={cls} />;
    case "consolidation":
      return <Layers className={cls} />;
    default:
      return <HelpCircle className={cls} />;
  }
}

function SeverityBadge({ s }: { s: Finding["severity"] }) {
  const cls = cn(
    "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide",
    s === "high" &&
      "bg-destructive/15 text-destructive border border-destructive/30",
    s === "medium" &&
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30",
    s === "low" &&
      "bg-muted text-muted-foreground border"
  );
  return <span className={cls}>{s}</span>;
}

function FindingCard({
  finding,
  onReview,
}: {
  finding: Finding;
  onReview: (f: Finding) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-start justify-between gap-3">
          <span className="flex items-center gap-2 flex-1 min-w-0">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-normal uppercase tracking-wide">
              <CategoryIcon category={finding.category} />
              {finding.category.replace("_", " ")}
            </span>
            <SeverityBadge s={finding.severity} />
          </span>
        </CardTitle>
        <p className="font-medium text-sm mt-1">{finding.title}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground whitespace-pre-line">
          {finding.description}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {finding.file_paths.map((p) => (
            <code
              key={p}
              className="font-mono text-[11px] px-1.5 py-0.5 rounded border bg-muted/30"
            >
              {p}
            </code>
          ))}
        </div>
        <div className="rounded-md bg-muted/30 border p-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">
            Proposed fix
          </p>
          <p className="text-sm">{finding.proposed_fix}</p>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => onReview(finding)}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Review fix
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AuditPage() {
  const [loading, setLoading] = React.useState(false);
  const [findings, setFindings] = React.useState<Finding[] | null>(null);
  const [fileCount, setFileCount] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = React.useState<Finding | null>(null);

  async function runAudit() {
    setLoading(true);
    setError(null);
    setFindings(null);
    try {
      const r = await fetch("/api/brain/audit", { method: "POST" });
      const text = await r.text();
      if (!r.ok) {
        // 504s / platform errors often return empty body or HTML
        if (!text)
          throw new Error(
            `HTTP ${r.status} — empty response (likely a gateway timeout; the audit is still running on the backend, but the browser gave up). Try again.`
          );
        try {
          const j = JSON.parse(text);
          throw new Error(j.error ?? `audit failed: HTTP ${r.status}`);
        } catch {
          throw new Error(
            `HTTP ${r.status}: ${text.slice(0, 200)}`
          );
        }
      }
      let j: { findings?: Finding[]; fileCount?: number };
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(
          `Server returned non-JSON (first 200 chars): ${text.slice(0, 200)}`
        );
      }
      setFindings(j.findings ?? []);
      setFileCount(j.fileCount ?? 0);
      setDismissed(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const visible = (findings ?? []).filter((f) => !dismissed.has(f.id));

  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Brain audit
            </h1>
            <p className="text-xs text-muted-foreground">
              Cross-document issues Claude Opus 4.7 finds in the corpus
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <article className="mx-auto w-full max-w-3xl px-6 py-10 space-y-6">
        {findings === null && !loading && !error && (
          <Card>
            <CardContent className="p-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                Run a cross-document audit over every markdown file in the
                brain. Claude Opus 4.7 looks for:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                <li>
                  <strong>Overlap</strong> — docs redundantly covering the same
                  topic
                </li>
                <li>
                  <strong>Missing cross-references</strong> — a doc mentions
                  another but doesn&apos;t link to it
                </li>
                <li>
                  <strong>Inconsistencies</strong> — conflicting facts between
                  docs
                </li>
                <li>
                  <strong>Consolidation</strong> — content scattered that would
                  read better centralized
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Nothing is written until you review each fix individually.
                Typical run: 30s–2min. Cost: a few cents to a dollar depending
                on brain size.
              </p>
              <Button onClick={runAudit}>
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                Run audit
              </Button>
            </CardContent>
          </Card>
        )}

        {loading && (
          <Card>
            <CardContent className="p-6 flex items-center gap-3 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 animate-pulse" />
              Auditing the brain… Opus may take 30s–2min on a moderately-sized
              corpus.
            </CardContent>
          </Card>
        )}

        {error && (
          <Card>
            <CardContent className="p-6 space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={runAudit}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {findings !== null && !loading && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {visible.length === 0
                  ? `No issues found across ${fileCount} doc(s).`
                  : `${visible.length} finding(s) across ${fileCount} doc(s)${
                      dismissed.size > 0 ? ` · ${dismissed.size} dismissed` : ""
                    }`}
              </p>
              <Button variant="outline" size="sm" onClick={runAudit}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-run audit
              </Button>
            </div>

            {visible.map((f) => (
              <div key={f.id} className="relative group">
                <FindingCard finding={f} onReview={setReviewing} />
                <button
                  onClick={() =>
                    setDismissed((prev) => new Set(prev).add(f.id))
                  }
                  className="absolute top-2 right-2 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                  title="Dismiss this finding from this session"
                >
                  dismiss
                </button>
              </div>
            ))}
          </>
        )}
      </article>

      {reviewing && (
        <ApplyFindingDialog
          open={!!reviewing}
          finding={reviewing}
          onOpenChange={(o) => !o && setReviewing(null)}
          onApplied={() => {
            // After a successful apply, the docs have changed. Re-running
            // the audit is the safest way to reflect the new state — don't
            // try to locally mutate findings.
            toast.info("Re-run audit to refresh the view.");
            setReviewing(null);
          }}
        />
      )}
    </main>
  );
}

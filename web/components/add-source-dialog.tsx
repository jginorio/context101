"use client";

import * as React from "react";
import {
  BookOpen,
  FileText,
  GitBranch,
  Loader2,
  Presentation,
  Sheet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SourceType = "sheets" | "docs" | "slides" | "notion" | "github";

type Copy = {
  icon: LucideIcon;
  title: string;
  description: string;
  urlLabel: string;
  urlPlaceholder: string;
  labelPlaceholder: string;
};

const COPY: Record<SourceType, Copy> = {
  sheets: {
    icon: Sheet,
    title: "Add a Google Sheet",
    description:
      "Paste a spreadsheet URL and give it a friendly label. You'll be redirected to Google to authorize read access. After you approve, every tab is pulled into the brain as markdown and re-synced every 6 hours.",
    urlLabel: "Spreadsheet URL",
    urlPlaceholder: "https://docs.google.com/spreadsheets/d/…",
    labelPlaceholder: "Platea Instagram analytics",
  },
  docs: {
    icon: FileText,
    title: "Add a Google Doc",
    description:
      "Paste a doc URL and give it a friendly label. After you approve Google read access, the doc is rendered to markdown and re-synced every 6 hours.",
    urlLabel: "Document URL",
    urlPlaceholder: "https://docs.google.com/document/d/…",
    labelPlaceholder: "Q2 strategy memo",
  },
  slides: {
    icon: Presentation,
    title: "Add a Google Slides deck",
    description:
      "Paste a deck URL and give it a friendly label. After you approve Google read access, slide text + speaker notes are rendered to markdown and re-synced every 6 hours.",
    urlLabel: "Presentation URL",
    urlPlaceholder: "https://docs.google.com/presentation/d/…",
    labelPlaceholder: "All-hands kickoff deck",
  },
  notion: {
    icon: BookOpen,
    title: "Add a Notion page or database",
    description:
      "Paste a page or database URL and give it a friendly label. After you approve Notion read access (pick which pages the integration can see), we walk the block tree and render to markdown, re-syncing every 6 hours. Database URLs pull every page as a separate markdown file.",
    urlLabel: "Notion URL",
    urlPlaceholder: "https://www.notion.so/workspace/Page-Title-abc123…",
    labelPlaceholder: "Engineering handbook",
  },
  github: {
    icon: GitBranch,
    title: "Add a GitHub repo",
    description:
      "Paste a repo URL and a Personal Access Token with `repo` scope (or `public_repo` for public-only). We pull every markdown + code file (skipping lockfiles, node_modules, builds), wrap them in fenced markdown, and re-sync every 6 hours. The token is stored in Secrets Manager — never sent to the client again.",
    urlLabel: "Repo URL",
    urlPlaceholder: "https://github.com/owner/repo",
    labelPlaceholder: "context101 platform repo",
  },
};

export function AddSourceDialog({
  open,
  onOpenChange,
  type,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: SourceType;
}) {
  const [label, setLabel] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [pat, setPat] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setLabel("");
      setUrl("");
      setPat("");
      setSubmitting(false);
    }
  }, [open]);

  const copy = COPY[type];
  const Icon = copy.icon;
  const needsPat = type === "github";
  const ready =
    !!label.trim() && !!url.trim() && (!needsPat || !!pat.trim());

  async function connect() {
    if (!ready) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/connectors/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          label: label.trim(),
          resource_url: url.trim(),
          ...(needsPat ? { github_pat: pat.trim() } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (!j.oauthUrl) throw new Error("No redirect URL returned");
      // Full-page navigation. For OAuth providers this hits the consent
      // screen; for GitHub it goes straight to /sources?connected=<id>.
      window.location.href = j.oauthUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4" /> {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium mb-1">Label</p>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={copy.labelPlaceholder}
              disabled={submitting}
              autoFocus
            />
          </div>
          <div>
            <p className="text-xs font-medium mb-1">{copy.urlLabel}</p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={copy.urlPlaceholder}
              disabled={submitting}
              className="font-mono text-xs"
            />
          </div>
          {needsPat && (
            <div>
              <p className="text-xs font-medium mb-1">
                Personal Access Token
              </p>
              <Input
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                disabled={submitting}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Create one at{" "}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  github.com/settings/tokens
                </a>{" "}
                with <code className="font-mono">repo</code> scope (private)
                or <code className="font-mono">public_repo</code> (public
                only). Stored encrypted in Secrets Manager.
              </p>
            </div>
          )}
          {!needsPat && (
            <p className="text-xs text-muted-foreground">
              You only need <strong>Viewer</strong> access — sync is read-only.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={connect} disabled={submitting || !ready}>
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                {type === "github" ? "Adding…" : "Redirecting…"}
              </>
            ) : type === "notion" ? (
              "Connect Notion workspace"
            ) : type === "github" ? (
              "Add repo"
            ) : (
              "Connect Google account"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

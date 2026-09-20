"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
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
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { AddGoogleSourceForm } from "@/components/add-google-source-form";
import {
  ADD_SOURCE_MENU,
  FILES_SOURCE,
  isGoogleAddKind,
  SOURCE_TYPES,
  type AddSourceKind,
} from "@/lib/source-providers";
import {
  describeUploadResult,
  uploadMarkdownFiles,
} from "@/lib/knowledge-upload";
import { useExternalFileDrop } from "@/lib/use-external-file-drop";
import { cn } from "@/lib/utils";

type Copy = {
  title: string;
  description: string;
  urlLabel: string;
  urlPlaceholder: string;
  labelPlaceholder: string;
};

type GithubInstallation = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  settingsUrl: string | null;
};

type GithubRepository = {
  fullName: string;
  htmlUrl: string;
  private: boolean;
  installationId: string;
  accountLogin: string;
};

type GithubStatus = {
  configured: boolean;
  installed?: boolean;
  installations?: GithubInstallation[];
};

const COPY: Record<"notion" | "github", Copy> = {
  notion: {
    title: "Add a Notion page or database",
    description:
      "Paste a page or database URL and give it a friendly label. After you approve Notion read access (pick which pages the integration can see), we walk the block tree and render to markdown, re-syncing every 6 hours. Database URLs pull every page as a separate markdown file.",
    urlLabel: "Notion URL",
    urlPlaceholder: "https://www.notion.so/workspace/Page-Title-abc123…",
    labelPlaceholder: "Engineering handbook",
  },
  github: {
    title: "Add a GitHub repository",
    description: "Choose a repository and optional paths to sync every 6 hours.",
    urlLabel: "Repository URL",
    urlPlaceholder: "https://github.com/owner/repo",
    labelPlaceholder: "context101 platform repo",
  },
};

function PickerRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      {icon}
      <span className="flex-1 text-sm font-medium">{label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function SourcePicker({
  onSelect,
}: {
  onSelect: (type: AddSourceKind) => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a source</DialogTitle>
        <DialogDescription>
          Upload markdown files or connect a provider.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        {ADD_SOURCE_MENU.map((item) => {
          const Icon = item.icon;
          return (
            <PickerRow
              key={item.kind}
              icon={<Icon className="h-5 w-5 shrink-0" />}
              label={item.menuLabel}
              onClick={() => onSelect(item.kind)}
            />
          );
        })}
      </div>
    </>
  );
}

function UploadFilesForm({
  onBack,
  onOpenChange,
  onUploaded,
}: {
  onBack: () => void;
  onOpenChange: (open: boolean) => void;
  onUploaded?: (keys: string[]) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const uploadingRef = React.useRef(false);
  const [uploading, setUploading] = React.useState(false);
  const FilesIcon = FILES_SOURCE.icon;

  const handleFiles = React.useCallback(
    async (files: File[]) => {
      if (uploadingRef.current) {
        toast.info("Upload already in progress");
        return;
      }
      uploadingRef.current = true;
      setUploading(true);
      const toastId = toast.loading(
        files.length === 1
          ? "Uploading file…"
          : `Uploading ${files.length} files…`
      );
      try {
        const result = await uploadMarkdownFiles("", files);
        const summary = describeUploadResult(result);
        if (summary.tone === "success")
          toast.success(summary.message, { id: toastId });
        else if (summary.tone === "error")
          toast.error(summary.message, { id: toastId });
        else toast.info(summary.message, { id: toastId });

        if (result.uploaded.length > 0) {
          onUploaded?.(result.uploaded);
          onOpenChange(false);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : String(error),
          { id: toastId }
        );
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [onOpenChange, onUploaded]
  );

  const drop = useExternalFileDrop(!uploading, (files) => {
    void handleFiles(files);
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-8">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            disabled={uploading}
            aria-label="Back to source types"
            className="-ml-1"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <FilesIcon className="h-4 w-4" /> Upload files
        </DialogTitle>
        <DialogDescription>
          Drop markdown files or choose them from your computer. They land in
          the library as Uploaded Files.
        </DialogDescription>
      </DialogHeader>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        multiple
        className="sr-only"
        disabled={uploading}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) void handleFiles(files);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm transition-colors",
          drop.active
            ? "bg-accent/40 text-foreground ring-1 ring-inset ring-primary/40"
            : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          uploading && "pointer-events-none opacity-60"
        )}
        data-drop-prefix=""
        {...drop.handlers}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <FilesIcon className="h-5 w-5" />
        )}
        <span className="font-medium text-foreground">
          {drop.active
            ? "Drop markdown files to upload"
            : uploading
              ? "Uploading…"
              : "Drop .md files here, or click to choose"}
        </span>
        <span className="text-xs leading-relaxed">
          Markdown only, up to 5 MB each.
        </span>
      </button>
      <DialogFooter>
        <Button variant="outline" onClick={onBack} disabled={uploading}>
          Back
        </Button>
      </DialogFooter>
    </>
  );
}

function SourceParamsForm({
  type,
  onBack,
  onOpenChange,
}: {
  type: "notion" | "github";
  onBack: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [label, setLabel] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [pat, setPat] = React.useState("");
  const [pathsText, setPathsText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [usePat, setUsePat] = React.useState(false);
  const [githubStatus, setGithubStatus] = React.useState<GithubStatus | null>(
    null
  );
  const [githubRepos, setGithubRepos] = React.useState<GithubRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = React.useState("");
  const [githubLoading, setGithubLoading] = React.useState(false);
  const [githubError, setGithubError] = React.useState<{
    message: string;
    settingsUrl?: string | null;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLabel("");
    setUrl("");
    setPat("");
    setPathsText("");
    setSubmitting(false);
    setUsePat(false);
    setGithubStatus(null);
    setGithubRepos([]);
    setSelectedRepo("");
    setGithubError(null);
    if (type === "github") {
      setGithubLoading(true);
      void (async () => {
        try {
          const statusResponse = await fetch("/api/connectors/github-app");
          const status = (await statusResponse.json()) as GithubStatus & {
            error?: string;
          };
          if (!statusResponse.ok) {
            throw new Error(
              status.error ?? "GitHub connection status could not be loaded"
            );
          }
          if (cancelled) return;
          setGithubStatus(status);

          if (status.configured && status.installed) {
            const reposResponse = await fetch(
              "/api/connectors/github-app/repositories"
            );
            const reposBody = (await reposResponse.json()) as {
              repositories?: GithubRepository[];
              error?: string;
            };
            if (!reposResponse.ok) {
              throw new Error(
                reposBody.error ?? "GitHub repositories could not be loaded"
              );
            }
            if (!cancelled) setGithubRepos(reposBody.repositories ?? []);
          }
        } catch (error) {
          if (!cancelled) {
            setGithubError({
              message:
                error instanceof Error
                  ? error.message
                  : "GitHub access could not be loaded",
            });
          }
        } finally {
          if (!cancelled) setGithubLoading(false);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [type]);

  const copy = COPY[type];
  const Icon = SOURCE_TYPES[type].icon;
  const isGithub = type === "github";
  const needsPat =
    isGithub && (usePat || githubStatus?.configured === false);
  const selectedGithubRepo = githubRepos.find(
    (repo) => repo.fullName === selectedRepo
  );
  const needsGithubInstall =
    isGithub &&
    !needsPat &&
    githubStatus?.configured === true &&
    !githubStatus.installed;
  const githubSettingsUrl =
    githubError?.settingsUrl ??
    githubStatus?.installations?.find(
      (installation) =>
        installation.installationId === selectedGithubRepo?.installationId
    )?.settingsUrl ??
    githubStatus?.installations?.find((installation) => installation.settingsUrl)
      ?.settingsUrl ??
    "https://github.com/settings/installations";
  const ready = isGithub
    ? needsPat
      ? !!label.trim() && !!url.trim() && !!pat.trim()
      : !!label.trim() && !!selectedGithubRepo && !githubLoading
    : !!label.trim() && !!url.trim();

  function chooseRepo(value: string) {
    setSelectedRepo(value);
    const repo = githubRepos.find((item) => item.fullName === value);
    if (!repo) return;
    setUrl(repo.htmlUrl);
    setLabel(repo.fullName);
    setGithubError(null);
  }

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
          ...(isGithub && !needsPat && selectedGithubRepo
            ? {
                github_installation_id: selectedGithubRepo.installationId,
              }
            : {}),
          ...(isGithub && pathsText.trim()
            ? {
                paths: pathsText
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : {}),
        }),
      });
      const j = (await r.json()) as {
        error?: string;
        oauthUrl?: string;
        settingsUrl?: string | null;
      };
      if (!r.ok) {
        const message = j.error ?? `HTTP ${r.status}`;
        if (isGithub) {
          setGithubError({ message, settingsUrl: j.settingsUrl });
          setSubmitting(false);
          return;
        }
        throw new Error(message);
      }
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
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-8">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            disabled={submitting}
            aria-label="Back to source types"
            className="-ml-1"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Icon className="h-4 w-4" /> {copy.title}
        </DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3 pb-2">
        {isGithub ? (
          <>
            {githubLoading && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking your GitHub access…
              </div>
            )}

            {!needsPat &&
              githubStatus?.configured &&
              githubStatus.installed && (
                <>
                  <div>
                    <p className="mb-1 text-xs font-medium">Repository</p>
                    <Combobox
                      value={selectedRepo}
                      onValueChange={chooseRepo}
                      items={githubRepos.map((repo) => repo.fullName)}
                      placeholder={
                        githubRepos.length
                          ? "Search repositories…"
                          : "No repositories available"
                      }
                      emptyText="No granted repository matches"
                      disabled={submitting || githubLoading}
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Connected as{" "}
                        {githubStatus.installations
                          ?.map((installation) => installation.accountLogin)
                          .join(", ")}
                      </span>
                      <a
                        href={githubSettingsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 underline hover:text-foreground"
                      >
                        Manage repository access
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <a
                        href="/api/connectors/github-app/install"
                        className="underline hover:text-foreground"
                      >
                        Connect another account
                      </a>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium">
                      Connection name{" "}
                      <span className="font-normal text-muted-foreground">
                        (editable)
                      </span>
                    </p>
                    <Input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder={copy.labelPlaceholder}
                      disabled={submitting}
                    />
                  </div>
                </>
              )}

            {needsPat && (
              <>
                <div>
                  <p className="mb-1 text-xs font-medium">Connection name</p>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={copy.labelPlaceholder}
                    disabled={submitting}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">{copy.urlLabel}</p>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={copy.urlPlaceholder}
                    disabled={submitting}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">
                    Personal access token
                  </p>
                  <Input
                    type="password"
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                    placeholder="github_pat_…"
                    disabled={submitting}
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create a fine-grained token in{" "}
                    <a
                      href="https://github.com/settings/personal-access-tokens/new"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-foreground"
                    >
                      GitHub settings
                    </a>{" "}
                    with read-only Contents access to this repository. The token
                    is encrypted in AWS Secrets Manager.
                  </p>
                </div>
              </>
            )}

            {githubError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <p className="font-medium">{githubError.message}</p>
                <p className="mt-1 text-foreground/80">
                  Grant Context101 access to the repository in GitHub, then
                  reopen this dialog. If you cannot install the app, use a
                  personal access token instead.
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <a
                    href={githubSettingsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Open GitHub App settings
                  </a>
                  {!needsPat && (
                    <button
                      type="button"
                      onClick={() => {
                        setUsePat(true);
                        setGithubError(null);
                      }}
                      className="underline hover:text-foreground"
                    >
                      Use a personal access token
                    </button>
                  )}
                </div>
              </div>
            )}

            {githubStatus?.configured === false && !githubError && (
              <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                This Context101 instance has no GitHub App configured, so a
                personal access token is required. Instance admins can{" "}
                <a
                  href="/api/connectors/github-app/create"
                  className="underline hover:text-foreground"
                >
                  configure the shared GitHub App
                </a>
                .
              </p>
            )}

            {!needsPat && githubStatus?.configured && (
              <button
                type="button"
                onClick={() => {
                  setUsePat(true);
                  setGithubError(null);
                }}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Use a personal access token instead
              </button>
            )}

            {(needsPat ||
              (githubStatus?.configured && githubStatus.installed)) && (
              <div>
                <p className="mb-1 text-xs font-medium">
                  Paths to sync{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </p>
                <Textarea
                  value={pathsText}
                  onChange={(e) => setPathsText(e.target.value)}
                  placeholder={"docs/\nREADME.md\napps/*/docs/**"}
                  disabled={submitting}
                  rows={3}
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Add one folder, file, or glob per line. Leave empty to sync
                  the whole repository.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <p className="mb-1 text-xs font-medium">Label</p>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={copy.labelPlaceholder}
                disabled={submitting}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">{copy.urlLabel}</p>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={copy.urlPlaceholder}
                disabled={submitting}
                className="font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              You only need <strong>Viewer</strong> access — sync is read-only.
            </p>
          </>
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
        <Button
          onClick={
            needsGithubInstall
              ? () => {
                  window.location.href =
                    "/api/connectors/github-app/install";
                }
              : connect
          }
          disabled={
            submitting ||
            githubLoading ||
            (!needsGithubInstall && !ready)
          }
        >
          {submitting ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              {type === "github" ? "Adding…" : "Redirecting…"}
            </>
          ) : type === "notion" ? (
            "Connect Notion workspace"
          ) : githubLoading ? (
            "Checking GitHub…"
          ) : needsGithubInstall ? (
            "Connect GitHub"
          ) : (
            "Add repository"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

export function AddSourceDialog({
  open,
  onOpenChange,
  type = null,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When set, skip the picker and open directly on that source's params.
  type?: AddSourceKind | null;
  // After a successful file upload, refresh the library and open tabs.
  onUploaded?: (keys: string[]) => void;
}) {
  const [selected, setSelected] = React.useState<AddSourceKind | null>(type);

  React.useEffect(() => {
    if (open) setSelected(type ?? null);
  }, [open, type]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 md:max-w-md">
        {selected === "files" ? (
          <UploadFilesForm
            onBack={() => setSelected(null)}
            onOpenChange={onOpenChange}
            onUploaded={onUploaded}
          />
        ) : isGoogleAddKind(selected) ? (
          <AddGoogleSourceForm
            onBack={() => setSelected(null)}
            onOpenChange={onOpenChange}
            initialType={selected === "google" ? undefined : selected}
          />
        ) : selected === "notion" || selected === "github" ? (
          <SourceParamsForm
            type={selected}
            onBack={() => setSelected(null)}
            onOpenChange={onOpenChange}
          />
        ) : (
          <SourcePicker onSelect={setSelected} />
        )}
      </DialogContent>
    </Dialog>
  );
}

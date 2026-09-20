"use client";

import * as React from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleLogo } from "@/components/source-logos";
import {
  SOURCE_TYPES,
  TypeIcon,
  type GoogleConnectorType,
} from "@/lib/source-providers";
import {
  googleTypeFromUrl,
  type PickedGoogleFile,
} from "@/lib/google-source";
import {
  openGooglePicker,
  requestGoogleAuthCode,
  useGooglePickerScripts,
} from "@/lib/use-google-picker";

type PickerConfig = {
  oauthConfigured: boolean;
  pickerConfigured: boolean;
  clientId: string;
  apiKey: string;
  appId: string;
};

type SessionStatus = {
  connected: boolean;
  accessToken?: string;
  email?: string | null;
  error?: string;
};

function fileLabel(file: PickedGoogleFile): string {
  return file.name || SOURCE_TYPES[file.type].menuLabel;
}

export function AddGoogleSourceForm({
  onBack,
  onOpenChange,
  initialType,
}: {
  onBack: () => void;
  onOpenChange: (open: boolean) => void;
  initialType?: GoogleConnectorType;
}) {
  const [label, setLabel] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [picked, setPicked] = React.useState<PickedGoogleFile | null>(null);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [busy, setBusy] = React.useState<"config" | "auth" | "picker" | null>(
    "config"
  );
  const [config, setConfig] = React.useState<PickerConfig | null>(null);
  const [session, setSession] = React.useState<SessionStatus>({
    connected: false,
  });
  const [configError, setConfigError] = React.useState<string | null>(null);
  const scripts = useGooglePickerScripts();

  React.useEffect(() => {
    if (scripts.error) setPasteOpen(true);
  }, [scripts.error]);

  React.useEffect(() => {
    let cancelled = false;
    setBusy("config");
    void (async () => {
      try {
        const [configResponse, sessionResponse] = await Promise.all([
          fetch("/api/connectors/google/picker-config"),
          fetch("/api/connectors/google/session"),
        ]);
        const configBody = (await configResponse.json()) as PickerConfig & {
          error?: string;
        };
        if (!configResponse.ok) {
          throw new Error(
            configBody.error ?? "Google connection status could not be loaded"
          );
        }
        if (cancelled) return;
        setConfig(configBody);

        if (sessionResponse.ok) {
          const sessionBody = (await sessionResponse.json()) as SessionStatus;
          if (!cancelled) setSession(sessionBody);
        }

        if (!configBody.pickerConfigured) setPasteOpen(true);
      } catch (error) {
        if (!cancelled) {
          setConfigError(
            error instanceof Error
              ? error.message
              : "Google connection status could not be loaded"
          );
          setPasteOpen(true);
        }
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const inferredType = picked?.type ?? googleTypeFromUrl(url) ?? initialType;
  const pickerReady = Boolean(
    config?.pickerConfigured && config.clientId && scripts.ready
  );
  const resourceUrl = picked?.url ?? url.trim();
  const ready =
    !!label.trim() &&
    !!resourceUrl &&
    !!inferredType &&
    !busy &&
    !submitting;

  function applyPicked(file: PickedGoogleFile) {
    setPicked(file);
    setUrl(file.url);
    setLabel((current) => current.trim() || fileLabel(file));
    setPasteOpen(false);
  }

  async function ensureAccessToken(): Promise<string> {
    if (session.connected && session.accessToken) return session.accessToken;
    if (!config?.clientId) {
      throw new Error("This instance has no Google OAuth client configured");
    }
    setBusy("auth");
    const code = await requestGoogleAuthCode(config.clientId);
    const response = await fetch("/api/connectors/google/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = (await response.json()) as SessionStatus & { error?: string };
    if (!response.ok || !body.accessToken) {
      throw new Error(body.error ?? "Google authorization could not be completed");
    }
    setSession({
      connected: body.connected ?? Boolean(body.accessToken),
      accessToken: body.accessToken,
      email: body.email,
    });
    return body.accessToken;
  }

  async function browseDrive() {
    if (!config?.pickerConfigured) return;
    try {
      const accessToken = await ensureAccessToken();
      setBusy("picker");
      const file = await openGooglePicker({
        accessToken,
        apiKey: config.apiKey,
        appId: config.appId,
      });
      if (file) applyPicked(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function disconnectGoogle() {
    await fetch("/api/connectors/google/session", { method: "DELETE" });
    setSession({ connected: false });
  }

  async function connect() {
    if (!ready || !inferredType) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/connectors/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: inferredType,
          label: label.trim(),
          resource_url: resourceUrl,
        }),
      });
      const j = (await r.json()) as { error?: string; oauthUrl?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (!j.oauthUrl) throw new Error("No redirect URL returned");
      window.location.href = j.oauthUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const loading = busy === "config";
  const working = submitting || busy === "auth" || busy === "picker";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-8">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            disabled={working}
            aria-label="Back to source types"
            className="-ml-1"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <GoogleLogo className="h-4 w-4" /> Add a Google file
        </DialogTitle>
        <DialogDescription>
          {pickerReady
            ? "Connect Google, then pick a Doc, Sheet, or Slides deck. After you approve read access, we render it to markdown and re-sync every 6 hours."
            : "Paste a Doc, Sheet, or Slides URL and give it a friendly label. After you approve Google read access, it's rendered to markdown and re-synced every 6 hours."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 pb-2">
        {loading && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking your Google access…
          </div>
        )}

        {configError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {configError}
          </div>
        )}

        {!loading && config && !config.oauthConfigured && (
          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            This Context101 instance has no Google OAuth client. Instance
            admins can run{" "}
            <code className="font-mono">context101 connectors setup google</code>
            .
          </p>
        )}

        {!loading && pickerReady && (
          <div className="space-y-2">
            <Button
              type="button"
              className="w-full"
              onClick={() => void browseDrive()}
              disabled={working || !config?.oauthConfigured}
            >
              {busy === "auth" || busy === "picker" ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  {busy === "auth" ? "Connecting Google…" : "Opening Drive…"}
                </>
              ) : session.connected ? (
                "Browse Google Drive"
              ) : (
                "Connect Google account"
              )}
            </Button>
            {session.email && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>Connected as {session.email}</span>
                <button
                  type="button"
                  onClick={() => void disconnectGoogle()}
                  disabled={working}
                  className="underline hover:text-foreground"
                >
                  Use a different account
                </button>
              </div>
            )}
            {scripts.error && (
              <p className="text-xs text-muted-foreground">
                Drive picker scripts could not load. Paste a link instead.
              </p>
            )}
          </div>
        )}

        {picked && (
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="flex items-start gap-2">
              <TypeIcon type={picked.type} className="mt-0.5 h-4 w-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {picked.name || SOURCE_TYPES[picked.type].menuLabel}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {picked.url}
                </p>
              </div>
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-medium">
            Label{" "}
            <span className="font-normal text-muted-foreground">(editable)</span>
          </p>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              inferredType
                ? SOURCE_TYPES[inferredType].menuLabel
                : "Q2 strategy memo"
            }
            disabled={working}
          />
        </div>

        <details
          className="rounded-md border bg-muted/20 px-3 py-2"
          open={pasteOpen || !pickerReady}
          onToggle={(event) =>
            setPasteOpen((event.target as HTMLDetailsElement).open)
          }
        >
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Or paste a link
          </summary>
          <div className="mt-2 space-y-2">
            <Input
              value={url}
              onChange={(e) => {
                const next = e.target.value;
                setUrl(next);
                setPicked(null);
                const type = googleTypeFromUrl(next);
                if (type && !label.trim()) {
                  setLabel(SOURCE_TYPES[type].menuLabel);
                }
              }}
              placeholder="https://docs.google.com/document/d/…"
              disabled={working}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Docs, Sheets, or Slides URLs. Viewer access is enough — sync is
              read-only.
              {inferredType ? (
                <>
                  {" "}
                  This will connect as{" "}
                  <strong>{SOURCE_TYPES[inferredType].label}</strong>.
                </>
              ) : null}
            </p>
          </div>
        </details>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={working}
        >
          Cancel
        </Button>
        <Button onClick={() => void connect()} disabled={!ready}>
          {submitting ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              {session.connected ? "Adding…" : "Redirecting…"}
            </>
          ) : session.connected || picked ? (
            "Add Google file"
          ) : (
            "Connect Google account"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

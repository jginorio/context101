"use client";

import * as React from "react";
import { ExternalLink, HelpCircle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Provider =
  | "bedrock"
  | "anthropic"
  | "openai"
  | "grok"
  | "gemini"
  | "claude-code";

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "bedrock", label: "AWS Bedrock (no key needed)" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "grok", label: "xAI Grok" },
  { id: "gemini", label: "Google Gemini" },
  { id: "claude-code", label: "Claude Code (Pro/Max subscription)" },
];

const MODEL_PLACEHOLDER: Record<Provider, string> = {
  bedrock: "us.anthropic.claude-opus-4-7 (leave blank for default)",
  anthropic: "e.g. claude-sonnet-4-20250514",
  openai: "e.g. gpt-4o",
  grok: "e.g. grok-4",
  gemini: "e.g. gemini-2.5-pro",
  "claude-code": "optional — e.g. opus, sonnet (blank = subscription default)",
};

const KEY_LABEL: Partial<Record<Provider, string>> = {
  anthropic: "Anthropic API key",
  openai: "OpenAI API key",
  grok: "xAI API key",
  gemini: "Google AI API key",
  "claude-code": "Claude Code OAuth token",
};

const KEY_HELP: {
  id: Exclude<Provider, "bedrock">;
  label: string;
  url: string;
  steps: string[];
  prefix?: string;
}[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    url: "https://console.anthropic.com/settings/keys",
    steps: [
      "Sign in to the Anthropic Console",
      "Settings → API Keys → Create Key",
      "Add billing/credits under Plans & Billing if prompted",
    ],
    prefix: "sk-ant-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    url: "https://platform.openai.com/api-keys",
    steps: [
      "Sign in to platform.openai.com",
      "API keys → Create new secret key",
      "Make sure the org has billing set up under Settings → Billing",
    ],
    prefix: "sk-…",
  },
  {
    id: "grok",
    label: "xAI Grok",
    url: "https://console.x.ai",
    steps: [
      "Sign in to the xAI Console",
      "API Keys → Create API key",
      "Add credits under Billing if prompted",
    ],
    prefix: "xai-…",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    url: "https://aistudio.google.com/app/apikey",
    steps: [
      "Open Google AI Studio and sign in",
      "Get API key → Create API key (in a Google Cloud project)",
    ],
    prefix: "AIza…",
  },
  {
    id: "claude-code",
    label: "Claude Code (Pro/Max subscription)",
    url: "https://docs.claude.com/en/docs/claude-code/setup",
    steps: [
      "Install Claude Code: npm i -g @anthropic-ai/claude-code",
      "Run `claude setup-token` in your terminal",
      "Log in with your Claude Pro/Max account in the browser",
      "Paste the printed long-lived token here (not a console API key)",
    ],
    prefix: "sk-ant-oat…",
  },
];

type BrainOption = { brain_id: string; display_name: string };

export function WikiModelSettings() {
  const [brains, setBrains] = React.useState<BrainOption[] | null>(null);
  const [brainId, setBrainId] = React.useState<string>("");
  const [loadingConfig, setLoadingConfig] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [provider, setProvider] = React.useState<Provider>("bedrock");
  const [modelId, setModelId] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [hasKey, setHasKey] = React.useState(false);
  const [models, setModels] = React.useState<string[]>([]);
  const [groups, setGroups] = React.useState<
    { provider: string; models: string[] }[]
  >([]);
  const [bedrockProvider, setBedrockProvider] = React.useState("");
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [modelsWarning, setModelsWarning] = React.useState<string | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Load the org's ready brains for the picker.
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/brains/list?status=ready", {
          cache: "no-store",
        });
        const data = await res.json();
        const items = (data?.items ?? []) as BrainOption[];
        setBrains(items);
        if (items.length > 0) setBrainId(items[0].brain_id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        setBrains([]);
      }
    })();
  }, []);

  const loadConfig = React.useCallback(async (id: string) => {
    if (!id) return;
    setLoadingConfig(true);
    try {
      const res = await fetch(
        `/api/settings/wiki-model?brain=${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setProvider((data.provider ?? "bedrock") as Provider);
      setModelId(data.model_id ?? "");
      setHasKey(!!data.has_key);
      setApiKey("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  React.useEffect(() => {
    if (brainId) loadConfig(brainId);
  }, [brainId, loadConfig]);

  const fetchModels = React.useCallback(
    async (keyOverride?: string, notify = false) => {
      if (!brainId) return;
      setLoadingModels(true);
      setModelsWarning(null);
      try {
        const qs = new URLSearchParams({ provider, brain: brainId });
        if (keyOverride) qs.set("key", keyOverride);
        const res = await fetch(`/api/settings/wiki-model/models?${qs}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
        let count = 0;
        if (Array.isArray(data.groups)) {
          const gs = data.groups as { provider: string; models: string[] }[];
          setGroups(gs);
          setModels([]);
          setBedrockProvider((prev) => {
            const provs = gs.map((g) => g.provider);
            return prev && provs.includes(prev) ? prev : provs[0] ?? "";
          });
          count = gs.reduce((n, g) => n + g.models.length, 0);
        } else {
          setGroups([]);
          const list = (data.models ?? []) as string[];
          setModels(list);
          count = list.length;
        }
        setModelsWarning(data.warning ?? null);
        if (notify) {
          if (data.warning) {
            toast.warning(data.warning);
          } else {
            toast.success(
              keyOverride
                ? `Key validated — loaded ${count} model${count === 1 ? "" : "s"}`
                : `Loaded ${count} model${count === 1 ? "" : "s"}`,
            );
          }
        }
      } catch (err) {
        setModels([]);
        setGroups([]);
        const msg = err instanceof Error ? err.message : String(err);
        setModelsWarning(msg);
        if (notify) toast.error(msg);
      } finally {
        setLoadingModels(false);
      }
    },
    [provider, brainId]
  );

  // Auto-load the model list when the brain/provider changes (uses the
  // brain's stored key for BYO providers; bedrock is keyless).
  React.useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings/wiki-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brainId,
          provider,
          modelId: modelId.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`);
      toast.success("Wiki model saved");
      await loadConfig(brainId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (brains === null) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (brains.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No ready brains yet. Create a brain first, then configure its wiki
          model here.
        </CardContent>
      </Card>
    );
  }

  const isBedrock = provider === "bedrock";
  const comboItems = isBedrock
    ? groups.find((g) => g.provider === bedrockProvider)?.models ?? []
    : models;
  // For bring-your-own providers, keep the model picker locked until a key is
  // validated (models loaded) or one is already saved — i.e. ask for the key
  // first, then surface the models.
  const byoLocked = !isBedrock && !hasKey && models.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wiki generation model</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Brain</label>
            <select
              value={brainId}
              onChange={(e) => setBrainId(e.target.value)}
              disabled={saving}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
            >
              {brains.map((b) => (
                <option key={b.brain_id} value={b.brain_id}>
                  {b.display_name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              The model is configured per brain.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              disabled={saving || loadingConfig}
              className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {isBedrock ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Model provider</label>
              <select
                value={bedrockProvider}
                onChange={(e) => setBedrockProvider(e.target.value)}
                disabled={saving || loadingModels || groups.length === 0}
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm disabled:opacity-50"
              >
                {groups.length === 0 ? (
                  <option value="">
                    {loadingModels ? "Loading…" : "—"}
                  </option>
                ) : (
                  groups.map((g) => (
                    <option key={g.provider} value={g.provider}>
                      {g.provider}
                    </option>
                  ))
                )}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  {KEY_LABEL[provider] ?? "API key"}
                </label>
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  Where do I get a key?
                </button>
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    hasKey
                      ? "•••••••••• (leave blank to keep current key)"
                      : "Paste the API key"
                  }
                  disabled={saving || loadingConfig}
                  autoComplete="off"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fetchModels(apiKey.trim() || undefined, true)}
                  disabled={loadingModels || (!apiKey.trim() && !hasKey)}
                >
                  {loadingModels ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Validate &amp; load models
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Stored encrypted in AWS Secrets Manager — never in the database
                and never shown again.
                {hasKey ? " A key is already saved." : ""}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Model {isBedrock ? "(optional)" : ""}
            </label>
            <Combobox
              value={modelId}
              onValueChange={setModelId}
              items={comboItems}
              placeholder={MODEL_PLACEHOLDER[provider]}
              disabled={saving || loadingConfig || byoLocked}
              emptyText="No matching models — you can type a custom id"
            />
            <p className="text-xs text-muted-foreground">
              {modelsWarning
                ? modelsWarning
                : byoLocked
                  ? "Enter your API key and validate to load the model list — or you can type a model id after."
                  : "Pick from the list or type any model id."}
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={saving || loadingConfig}>
              {saving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Save
            </Button>
            {loadingConfig ? (
              <span className="text-xs text-muted-foreground">Loading…</span>
            ) : null}
          </div>
        </form>
      </CardContent>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Getting a provider API key</DialogTitle>
            <DialogDescription>
              Create a key in the provider&apos;s console, make sure billing is
              set up, then paste it here. Keys are stored encrypted in AWS
              Secrets Manager.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {KEY_HELP.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "rounded-md border p-3",
                  p.id === provider && "border-foreground/30 bg-muted/40",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {p.label}
                    {p.id === provider ? (
                      <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        selected
                      </span>
                    ) : null}
                  </span>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open console <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <ol className="ml-4 list-decimal space-y-0.5 text-xs text-muted-foreground">
                  {p.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                {p.prefix ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Key looks like{" "}
                    <code className="font-mono">{p.prefix}</code>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

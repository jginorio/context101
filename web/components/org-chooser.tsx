"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Org = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  role: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "team"
  );
}

export function OrgChooser({
  orgs,
  activeOrgId,
  next,
}: {
  orgs: Org[];
  activeOrgId: string | null;
  next: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [orgName, setOrgName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  async function openOrg(id: string) {
    if (pendingId) return;
    setPendingId(id);
    const { error } = await authClient.organization.setActive({
      organizationId: id,
    });
    if (error) {
      setPendingId(null);
      toast.error(error.message ?? "Could not switch organization");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    const name = orgName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;
      const { data, error } = await authClient.organization.create({
        name,
        slug,
      });
      if (error) throw new Error(error.message ?? "Could not create organization");
      const newId = (data as { id?: string } | null)?.id;
      if (newId) {
        await authClient.organization
          .setActive({ organizationId: newId })
          .catch(() => {});
      }
      setCreateOpen(false);
      setOrgName("");
      router.push(next);
      router.refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {orgs.map((org) => {
          const isActive = org.id === activeOrgId;
          const isPending = pendingId === org.id;
          return (
            <button
              key={org.id}
              type="button"
              onClick={() => openOrg(org.id)}
              disabled={!!pendingId}
              className={cn(
                "group relative flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border bg-card p-4 text-center transition hover:border-foreground/40 hover:shadow-sm disabled:opacity-60",
                isActive && "border-foreground/40 ring-2 ring-foreground/15"
              )}
            >
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-muted text-xl font-semibold text-foreground">
                {org.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={org.logo}
                    alt={org.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials(org.name)
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{org.name}</div>
                <div className="text-xs capitalize text-muted-foreground">
                  {org.role}
                </div>
              </div>
              {isActive ? (
                <span className="absolute right-2 top-2 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
                  current
                </span>
              ) : null}
              {isPending ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/60">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </span>
              ) : null}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={!!pendingId}
          className="flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-background p-4 text-center text-muted-foreground transition hover:border-foreground/40 hover:text-foreground disabled:opacity-60"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed">
            <Plus className="h-6 w-6" />
          </div>
          <div className="text-sm font-medium">New organization</div>
        </button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Organizations have their own brains, members, and settings.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={createOrg}>
            <Input
              autoFocus
              placeholder="Organization name"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
            {createError ? (
              <p className="text-sm text-destructive">{createError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !orgName.trim()}>
                {creating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : null}
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

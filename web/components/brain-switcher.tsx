"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";

import { BrainOrb } from "@/components/brain-orb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBrain } from "@/lib/brain-context";

/**
 * Header dropdown for picking the active brain. Lists every brain in
 * `ready` status; provisioning/error brains are accessible from the
 * /brains admin page so the switcher stays focused on usable targets.
 *
 * Selection updates the URL `?brain=<id>` *and* the `ctx_brain` cookie
 * via `useBrain().setBrain`, so the choice survives reloads and is
 * shareable via copy/paste of the URL.
 */
export function BrainSwitcher() {
  const { currentBrain, currentBrainId, brains, loading, setBrain } = useBrain();

  const ready = brains.filter((b) => b.status === "ready");
  const provisioning = brains.filter((b) => b.status === "provisioning");

  const label = currentBrain?.display_name ?? currentBrainId ?? "Default";
  const status = currentBrain?.status;
  // The active brain isn't usable yet (deep-linked to a provisioning/errored
  // one). Surface it so the header always tells the truth about where you are.
  const statusHint =
    status === "provisioning"
      ? "Provisioning…"
      : status === "error"
        ? "Needs attention"
        : status === "deleting"
          ? "Deleting…"
          : "Active brain";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2.5 px-2 py-2 hover:bg-primary/10"
            aria-label={`Active brain: ${label}. Switch brain`}
          />
        }
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          <BrainOrb className="h-full w-full" />
          {status === "provisioning" || status === "deleting" ? (
            <Loader2 className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 animate-spin rounded-full bg-sidebar p-px text-primary" />
          ) : status === "error" ? (
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-sidebar" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start text-left leading-tight">
          <span className="text-[11px] font-medium text-muted-foreground">
            {loading && !currentBrain ? "Loading brains…" : statusHint}
          </span>
          <span className="w-full truncate text-sm font-semibold text-foreground">
            {label}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        {/* DropdownMenuLabel wraps Base UI's Menu.GroupLabel, which now
            requires a Menu.Group parent (Base UI #31) — bare labels crash
            on open. Each label + its following items is wrapped in a
            DropdownMenuGroup. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {loading ? "Loading brains…" : "Switch brain"}
          </DropdownMenuLabel>
          {ready.length === 0 && !loading ? (
            <DropdownMenuItem disabled>No brains available</DropdownMenuItem>
          ) : (
            ready.map((b) => (
              <DropdownMenuItem
                key={b.brain_id}
                onClick={() => setBrain(b.brain_id)}
                className="justify-between"
              >
                <span className="truncate">{b.display_name}</span>
                {b.brain_id === currentBrainId ? (
                  <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />
                ) : null}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>

        {provisioning.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                Provisioning…
              </DropdownMenuLabel>
              {provisioning.map((b) => (
                <DropdownMenuItem key={b.brain_id} disabled>
                  <span className="truncate">{b.display_name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/brains" />}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Manage brains
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

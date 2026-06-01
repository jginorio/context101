"use client";

import * as React from "react";
import Link from "next/link";
import { Brain, Check, ChevronDown, Plus } from "lucide-react";

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-1 text-primary hover:bg-primary/10 hover:text-primary">
            <Brain className="h-3.5 w-3.5" />
            <span className="max-w-[12ch] truncate">{label}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-[14rem]">
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

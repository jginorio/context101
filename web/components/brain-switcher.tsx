"use client";

import * as React from "react";
import Link from "next/link";
import { Brain, Check, ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
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
          <Button variant="ghost" size="sm" className="gap-1">
            <Brain className="h-3.5 w-3.5" />
            <span className="max-w-[12ch] truncate">{label}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>
          {loading ? "Loading brains…" : "Switch brain"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
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
                <Check className="h-3.5 w-3.5 ml-2 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        {provisioning.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Provisioning…
            </DropdownMenuLabel>
            {provisioning.map((b) => (
              <DropdownMenuItem key={b.brain_id} disabled>
                <span className="truncate">{b.display_name}</span>
              </DropdownMenuItem>
            ))}
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

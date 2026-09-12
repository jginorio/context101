"use client";

import * as React from "react";
import { Check, GitCompare, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ClientConflict } from "@/lib/conflicts/types";

type Kind = "keep-left" | "keep-right" | "merge";

export function ConflictReviewSheet({
  conflict,
  open,
  onOpenChange,
  onActioned,
}: {
  conflict: ClientConflict | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActioned: () => void;
}) {
  const [kind, setKind] = React.useState<Kind>("keep-left");
  const [loserBody, setLoserBody] = React.useState("");
  const [leftBody, setLeftBody] = React.useState("");
  const [rightBody, setRightBody] = React.useState("");
  const [saving, setSaving] = React.useState<"approve" | "reject" | null>(null);

  React.useEffect(() => {
    if (!open || !conflict) return;
    setKind("keep-left");
    setLoserBody(conflict.proposed_loser_body.right);
    setLeftBody(conflict.proposed_loser_body.left);
    setRightBody(conflict.proposed_loser_body.right);
  }, [open, conflict]);

  React.useEffect(() => {
    if (!conflict) return;
    if (kind === "keep-left") setLoserBody(conflict.proposed_loser_body.right);
    if (kind === "keep-right") setLoserBody(conflict.proposed_loser_body.left);
  }, [kind, conflict]);

  if (!conflict) return null;

  const isPending = conflict.status === "pending";
  const loser =
    kind === "keep-left"
      ? conflict.right
      : kind === "keep-right"
        ? conflict.left
        : null;
  const unwritable =
    kind === "merge"
      ? conflict.left.unwritable || conflict.right.unwritable
      : !!loser?.unwritable;

  async function approve() {
    if (!conflict) return;
    setSaving("approve");
    try {
      const body =
        kind === "merge"
          ? {
              id: conflict.id,
              kind: "merge",
              leftBody,
              rightBody,
            }
          : {
              id: conflict.id,
              kind: "keep",
              winner: kind === "keep-left" ? "left" : "right",
              loserBody,
            };
      const r = await fetch("/api/conflicts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "approve failed");
      toast.success("Approved");
      onOpenChange(false);
      onActioned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  async function reject() {
    if (!conflict) return;
    setSaving("reject");
    try {
      const r = await fetch("/api/conflicts/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conflict.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "reject failed");
      toast.success("Rejected");
      onOpenChange(false);
      onActioned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="!max-w-[min(1100px,95vw)] w-full flex flex-col gap-0 p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" /> {conflict.title}
          </SheetTitle>
          <SheetDescription className="space-y-1">
            <span className="block text-xs">
              {conflict.topic}
              {" · "}
              {new Date(conflict.created_at).toLocaleString()}
            </span>
            {conflict.rationale && (
              <span className="block text-xs">
                <span className="text-muted-foreground">Why: </span>
                {conflict.rationale}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SideCard
              title="Left"
              side={conflict.left}
              selected={kind === "keep-left"}
            />
            <SideCard
              title="Right"
              side={conflict.right}
              selected={kind === "keep-right"}
            />
          </div>

          {isPending && (
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["keep-left", "Keep left"],
                  ["keep-right", "Keep right"],
                  ["merge", "Merge"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={kind === value ? "default" : "outline"}
                  onClick={() => setKind(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}

          {kind !== "merge" && loser && (
            <div className="space-y-1">
              <p className="text-xs font-medium">
                Loser body
                {loser.kind === "github" ? (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    will write {loser.label}
                  </span>
                ) : null}
              </p>
              <Textarea
                value={loserBody}
                onChange={(e) => setLoserBody(e.target.value)}
                className="min-h-40 font-mono text-xs"
                disabled={!isPending}
              />
            </div>
          )}

          {kind === "merge" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium">Left body</p>
                <Textarea
                  value={leftBody}
                  onChange={(e) => setLeftBody(e.target.value)}
                  className="min-h-40 font-mono text-xs"
                  disabled={!isPending}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium">Right body</p>
                <Textarea
                  value={rightBody}
                  onChange={(e) => setRightBody(e.target.value)}
                  className="min-h-40 font-mono text-xs"
                  disabled={!isPending}
                />
              </div>
            </div>
          )}

          {unwritable && isPending && (
            <p className="text-sm text-destructive">
              Notion and Google losers cannot be written back yet. Keep the
              other side, or reject.
            </p>
          )}
        </div>

        <SheetFooter className="border-t flex-row gap-2 justify-end">
          {isPending ? (
            <>
              <Button
                variant="outline"
                onClick={reject}
                disabled={saving !== null}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                {saving === "reject" ? "Rejecting…" : "Reject"}
              </Button>
              <Button
                onClick={approve}
                disabled={saving !== null || unwritable}
              >
                {saving === "approve" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1 h-3.5 w-3.5" />
                )}
                {saving === "approve" ? "Approving…" : "Approve"}
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              This conflict is already {conflict.status}.
            </p>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SideCard({
  title,
  side,
  selected,
}: {
  title: string;
  side: ClientConflict["left"];
  selected: boolean;
}) {
  return (
    <div
      className={
        selected
          ? "rounded-md border border-primary/40 bg-primary/5 p-3 space-y-1"
          : "rounded-md border p-3 space-y-1"
      }
    >
      <p className="text-xs font-medium">{title}</p>
      <code className="block text-[10px] font-mono text-muted-foreground truncate">
        {side.label}
      </code>
      <p className="text-sm">{side.claim || side.excerpt}</p>
    </div>
  );
}

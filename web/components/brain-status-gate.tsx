"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  Brain,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBrain } from "@/lib/brain-context";

/**
 * Renders `children` only when the active brain is fully `ready`.
 * Otherwise short-circuits with a centered status card explaining
 * what's going on (provisioning / errored / deleting / not found /
 * still resolving) — so SSR routes don't get a barrage of 409s and
 * the user gets actionable next steps instead of toast.error spam.
 *
 * Pages should wrap the *main content* (post-header) in this gate
 * so the brain switcher in the header stays interactive. Auto-polls
 * the registry every 5 s while a brain is provisioning or deleting,
 * so the gate clears itself when the resource finishes.
 */
export function BrainStatusGate({ children }: { children: React.ReactNode }) {
  const {
    currentBrain,
    currentBrainId,
    currentBrainNotFound,
    loading,
    refreshBrains,
  } = useBrain();

  const status = currentBrain?.status;
  const transient = status === "provisioning" || status === "deleting";

  // Poll the registry while a transient state is in flight. Stops as
  // soon as we see "ready" (or anything else terminal), and on unmount.
  React.useEffect(() => {
    if (!transient) return;
    const t = setInterval(() => {
      refreshBrains();
    }, 5_000);
    return () => clearInterval(t);
  }, [transient, refreshBrains]);

  // Fast path — render children. Includes the initial render before
  // the provider has finished loading anything, to avoid a flash of
  // the "Resolving…" state during a fresh page mount where the
  // brain is likely the (already-known-good) "default".
  if (status === "ready") return <>{children}</>;

  // Still resolving (no fast-path match, no slow-path response yet,
  // and we haven't confirmed 404 either).
  if (!currentBrain && !currentBrainNotFound && loading) {
    return (
      <StatusCard
        icon={<Loader2 className="h-5 w-5 animate-spin" />}
        title="Loading brain…"
        body="Hang tight."
      />
    );
  }

  if (currentBrainNotFound) {
    return (
      <StatusCard
        icon={<AlertCircle className="h-5 w-5 text-destructive" />}
        title="Brain not found"
        body={
          <>
            No brain registered under{" "}
            <code className="font-mono">{currentBrainId}</code>. It may have
            been deleted, or the link may be stale.
          </>
        }
        actions={
          <Link href="/brains">
            <Button size="sm" variant="outline">
              <Brain className="mr-1 h-3.5 w-3.5" />
              Pick another brain
            </Button>
          </Link>
        }
      />
    );
  }

  if (status === "provisioning") {
    return (
      <StatusCard
        icon={<Loader2 className="h-5 w-5 animate-spin" />}
        title="Brain is still provisioning"
        body={
          <>
            <code className="font-mono">{currentBrain?.display_name}</code> was
            created moments ago — its S3 bucket, Bedrock KB, vector index, and
            tables are being created. This usually takes 30–60 seconds; the
            page auto-refreshes when it's ready.
          </>
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => refreshBrains()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Check now
          </Button>
        }
      />
    );
  }

  if (status === "error") {
    return (
      <StatusCard
        icon={<AlertCircle className="h-5 w-5 text-destructive" />}
        title="Brain failed to provision"
        body={
          <>
            <code className="font-mono">{currentBrain?.display_name}</code>{" "}
            errored during setup. Some AWS resources may exist in a
            half-created state — delete the brain to clean up, then create a
            new one.
            {currentBrain?.error_msg ? (
              <>
                <br />
                <span className="mt-2 inline-block rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 font-mono text-[11px] text-destructive">
                  {currentBrain.error_msg}
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          <Link href="/brains">
            <Button size="sm" variant="outline">
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete &amp; retry
            </Button>
          </Link>
        }
      />
    );
  }

  if (status === "deleting") {
    return (
      <StatusCard
        icon={<Loader2 className="h-5 w-5 animate-spin" />}
        title="Brain is being deleted"
        body={
          <>
            <code className="font-mono">{currentBrain?.display_name}</code> is
            being torn down — bucket, KB, vector index, tables, and bearer
            token are being removed. The page auto-refreshes when it's done.
          </>
        }
      />
    );
  }

  // Truly unknown status — render a generic card so we never silently
  // pass through a non-ready brain.
  return (
    <StatusCard
      icon={<AlertCircle className="h-5 w-5 text-destructive" />}
      title="Brain isn't ready"
      body={
        <>
          Brain <code className="font-mono">{currentBrainId}</code> is in an
          unexpected state{status ? ` ("${status}")` : ""}. Try the brains
          page.
        </>
      }
      actions={
        <Link href="/brains">
          <Button size="sm" variant="outline">
            <Brain className="mr-1 h-3.5 w-3.5" /> Brains
          </Button>
        </Link>
      }
    />
  );
}

function StatusCard({
  icon,
  title,
  body,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl items-center justify-center p-6 sm:p-10">
      <Card className="w-full">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2 font-medium">
            {icon}
            <span>{title}</span>
          </div>
          <div className="text-sm leading-relaxed text-muted-foreground">
            {body}
          </div>
          {actions ? <div className="pt-1">{actions}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}

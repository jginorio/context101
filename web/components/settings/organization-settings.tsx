"use client";

import * as React from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type OrgRole = "owner" | "admin" | "member";
const ASSIGNABLE_ROLES: OrgRole[] = ["admin", "member"];

type Member = {
  id: string;
  userId: string;
  role: string;
  createdAt?: string | Date;
  user?: { id?: string; name?: string | null; email?: string | null };
};

type Invitation = {
  id: string;
  email: string;
  role?: string | null;
  status: string;
  expiresAt?: string | Date;
};

function isPrivileged(role: string | undefined): boolean {
  return role === "admin" || role === "owner";
}

function RoleBadge({ role }: { role: string }) {
  const privileged = isPrivileged(role);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs capitalize",
        privileged
          ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground"
      )}
    >
      {privileged ? <ShieldCheck className="h-3 w-3" /> : null}
      {role}
    </span>
  );
}

export function OrganizationSettings() {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;

  const [members, setMembers] = React.useState<Member[] | null>(null);
  const [invitations, setInvitations] = React.useState<Invitation[] | null>(
    null
  );
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<OrgRole>("member");
  const [inviting, setInviting] = React.useState(false);
  const [busyMemberId, setBusyMemberId] = React.useState<string | null>(null);
  const [toRemove, setToRemove] = React.useState<Member | null>(null);
  const [toReset, setToReset] = React.useState<Member | null>(null);
  const [newPassword, setNewPassword] = React.useState("");
  const [resetting, setResetting] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [resendingInviteId, setResendingInviteId] = React.useState<
    string | null
  >(null);

  const currentRole = members?.find((m) => m.userId === currentUserId)?.role;
  const canManage = isPrivileged(currentRole);
  const isOwner = currentRole === "owner";
  const adminCount = (members ?? []).filter((m) => isPrivileged(m.role)).length;

  const loadMembers = React.useCallback(async () => {
    const { data, error } = await authClient.organization.listMembers({
      query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" },
    });
    if (error) {
      toast.error(error.message ?? "Failed to load members");
      setMembers([]);
      return;
    }
    setMembers((data?.members ?? []) as Member[]);
  }, []);

  const loadInvitations = React.useCallback(async () => {
    const { data, error } = await authClient.organization.listInvitations({});
    if (error) {
      // Members (non-admins) may not be allowed to list invitations — don't
      // surface that as a hard error, just show none.
      setInvitations([]);
      return;
    }
    const pending = ((data ?? []) as Invitation[]).filter(
      (i) => i.status === "pending"
    );
    setInvitations(pending);
  }, []);

  React.useEffect(() => {
    loadMembers();
    loadInvitations();
  }, [loadMembers, loadInvitations]);

  function acceptLink(invitationId: string): string {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/accept-invitation/${invitationId}`;
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Email is required");
      return;
    }
    setInviting(true);
    try {
      const { error } = await authClient.organization.inviteMember({
        email,
        role: inviteRole,
      });
      if (error) throw new Error(error.message ?? "Invite failed");
      toast.success(`Invited ${email} as ${inviteRole}`);
      setInviteEmail("");
      await loadInvitations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(member: Member, role: OrgRole) {
    if (role === member.role) return;
    // Don't let the org lose its last admin by demotion.
    if (
      isPrivileged(member.role) &&
      !isPrivileged(role) &&
      adminCount <= 1
    ) {
      toast.error("Cannot demote the last admin. Promote another member first.");
      return;
    }
    setBusyMemberId(member.id);
    try {
      const { error } = await authClient.organization.updateMemberRole({
        memberId: member.id,
        role,
      });
      if (error) throw new Error(error.message ?? "Role update failed");
      toast.success(`Updated ${member.user?.email ?? "member"} to ${role}`);
      await loadMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleRemove(member: Member) {
    setBusyMemberId(member.id);
    try {
      // Server route enforces the admin check + last-admin guard and revokes
      // the removed user's sessions (so they lose access immediately).
      const res = await fetch("/api/org/remove-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Remove failed (${res.status})`);
      toast.success(`Removed ${member.user?.email ?? "member"}`);
      await loadMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMemberId(null);
      setToRemove(null);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!toReset) return;
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setResetting(true);
    try {
      const res = await fetch("/api/org/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: toReset.id, password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Reset failed (${res.status})`);
      toast.success(
        `Password reset for ${toReset.user?.email ?? "member"}. They'll need to sign in again.`
      );
      setToReset(null);
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }

  async function handleCancelInvite(invitation: Invitation) {
    try {
      const { error } = await authClient.organization.cancelInvitation({
        invitationId: invitation.id,
      });
      if (error) throw new Error(error.message ?? "Cancel failed");
      toast.success(`Canceled invite for ${invitation.email}`);
      await loadInvitations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleResendInvite(invitation: Invitation) {
    setResendingInviteId(invitation.id);
    try {
      const role = ASSIGNABLE_ROLES.includes(invitation.role as OrgRole)
        ? (invitation.role as OrgRole)
        : "member";
      const { error } = await authClient.organization.inviteMember({
        email: invitation.email,
        role,
        resend: true,
      });
      if (error) throw new Error(error.message ?? "Resend failed");
      toast.success(`Resent invite to ${invitation.email}`);
      await loadInvitations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setResendingInviteId(null);
    }
  }

  async function copyInviteLink(invitation: Invitation) {
    try {
      await navigator.clipboard.writeText(acceptLink(invitation.id));
      setCopiedId(invitation.id);
      toast.success("Invite link copied");
      setTimeout(() => setCopiedId((id) => (id === invitation.id ? null : id)), 2000);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite */}
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleInvite}
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
            >
              <Input
                type="email"
                placeholder="teammate@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviting}
                className="sm:flex-1"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                disabled={inviting}
                className="h-9 rounded-lg border bg-background px-2 text-sm"
                aria-label="Role"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={inviting}>
                {inviting ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="mr-1 h-3.5 w-3.5" />
                )}
                Invite
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              We&apos;ll email the invite link. You can also copy it from pending
              invitations below if you need to share it manually.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Pending invitations */}
      {canManage && invitations && invitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Pending invitations ({invitations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm">{inv.email}</span>
                  {inv.role ? <RoleBadge role={inv.role} /> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={resendingInviteId === inv.id}
                    size="sm"
                    variant="outline"
                    onClick={() => handleResendInvite(inv)}
                  >
                    {resendingInviteId === inv.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mail className="mr-1 h-3.5 w-3.5" />
                    )}
                    Resend
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyInviteLink(inv)}
                  >
                    {copiedId === inv.id ? (
                      <Check className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <Copy className="mr-1 h-3.5 w-3.5" />
                    )}
                    {copiedId === inv.id ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCancelInvite(inv)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Members{members ? ` (${members.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="w-[160px]">Role</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members === null ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="ml-auto h-4 w-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : members.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No members.
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => {
                  const isSelf = m.userId === currentUserId;
                  const busy = busyMemberId === m.id;
                  const isLastAdmin = isPrivileged(m.role) && adminCount <= 1;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="font-medium">
                          {m.user?.name || m.user?.email || m.userId}
                          {isSelf ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (you)
                            </span>
                          ) : null}
                        </div>
                        {m.user?.email && m.user?.name ? (
                          <div className="text-xs text-muted-foreground">
                            {m.user.email}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {canManage && !isSelf && m.role !== "owner" ? (
                          <select
                            value={ASSIGNABLE_ROLES.includes(m.role as OrgRole) ? m.role : "member"}
                            onChange={(e) =>
                              handleRoleChange(m, e.target.value as OrgRole)
                            }
                            disabled={busy || isLastAdmin}
                            title={
                              isLastAdmin
                                ? "Promote another member before changing the last admin's role"
                                : undefined
                            }
                            className="h-8 rounded-lg border bg-background px-2 text-sm disabled:opacity-50"
                            aria-label="Member role"
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <RoleBadge role={m.role} />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canManage &&
                          !isSelf &&
                          (m.role !== "owner" || isOwner) ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => {
                                setNewPassword("");
                                setToReset(m);
                              }}
                              disabled={busy}
                              title="Reset password"
                              aria-label="Reset password"
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canManage && !isSelf && m.role !== "owner" ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setToRemove(m)}
                              disabled={busy || isLastAdmin}
                              title={
                                isLastAdmin
                                  ? "Promote another member before removing the last admin"
                                  : undefined
                              }
                              aria-label="Remove member"
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {!canManage && members !== null ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Only organization admins can invite, remove, or change member
              roles.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!toRemove}
        onOpenChange={(v) => !v && setToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {toRemove?.user?.email ?? "This member"} will lose access to the
              organization and all its brains. They can be re-invited later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toRemove && handleRemove(toRemove)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!toReset}
        onOpenChange={(v) => {
          if (!v) {
            setToReset(null);
            setNewPassword("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Set a new password for{" "}
              <span className="font-medium text-foreground">
                {toReset?.user?.email ?? toReset?.user?.name ?? "this member"}
              </span>
              . They&apos;ll be signed out and must use the new password. Share
              it with them securely.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleReset}>
            <PasswordInput
              autoComplete="new-password"
              minLength={8}
              placeholder="New password (min 8 characters)"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setToReset(null);
                  setNewPassword("");
                }}
                disabled={resetting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={resetting || newPassword.length < 8}
              >
                {resetting ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : null}
                Reset password
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  approveUser,
  removeUser,
  resetUserPassword,
  setUserMfaRequired,
  setUserRole,
  setUserStatus,
} from "@/lib/admin/users/actions";
import { adminResetMfa } from "@/lib/auth/mfa/actions";
import type { AdminUserSummary } from "@/lib/admin/users/queries";

const STATUS_BADGE: Record<AdminUserSummary["status"], { label: string; variant: "warning" | "success" | "secondary" }> = {
  PENDING: { label: "Pending approval", variant: "warning" },
  ACTIVE: { label: "Active", variant: "success" },
  INACTIVE: { label: "Inactive", variant: "secondary" },
};

export function UserRow({ user, isCurrentAdmin }: { user: AdminUserSummary; isCurrentAdmin: boolean }) {
  const statusBadge = STATUS_BADGE[user.status];

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          <Badge variant={user.mfaEnabled ? "success" : "outline"}>
            {user.mfaEnabled ? "MFA enrolled" : "Not enrolled"}
          </Badge>
          {user.mfaRequired && <Badge variant="warning">MFA required</Badge>}
        </div>
      </div>

      {isCurrentAdmin ? (
        <p className="text-xs text-muted-foreground">
          This is your own account — role, status, and MFA reset for it aren&apos;t available here.
        </p>
      ) : user.status === "PENDING" ? (
        <ApprovalControls userId={user.id} />
      ) : (
        <ActiveUserControls user={user} />
      )}
    </div>
  );
}

/** Self-registered account awaiting approval — the admin picks the role at approval time, since the registrant never chose one (see lib/auth/signup.ts). */
function ApprovalControls({ userId }: { userId: string }) {
  const [result, formAction, isPending] = useActionState(approveUser, undefined);

  if (result?.status === "success") {
    return <p className="text-sm font-medium text-emerald-700">Approved — the account is now active.</p>;
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="space-y-1">
        <Label htmlFor={`approve-role-${userId}`} className="text-xs">
          Role
        </Label>
        <Select id={`approve-role-${userId}`} name="role" defaultValue="STAFF" className="h-8 text-xs">
          <option value="ADMIN">Admin</option>
          <option value="ATTORNEY">Attorney</option>
          <option value="PARALEGAL">Paralegal</option>
          <option value="STAFF">Staff</option>
        </Select>
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Approving…" : "Approve"}
      </Button>
      {result?.status === "error" && (
        <p className="w-full text-xs font-medium text-destructive" role="alert">
          {result.message}
        </p>
      )}
    </form>
  );
}

function ActiveUserControls({ user }: { user: AdminUserSummary }) {
  const [roleError, roleAction, rolePending] = useActionState(setUserRole, undefined);
  const [statusError, statusAction, statusPending] = useActionState(setUserStatus, undefined);
  const [mfaRequiredError, mfaRequiredAction, mfaRequiredPending] = useActionState(setUserMfaRequired, undefined);
  const [resetError, resetAction, resetPending] = useActionState(adminResetMfa, undefined);
  const [showReset, setShowReset] = useState(false);

  // Closes the reset form once a submission completes successfully (it
  // returns undefined on success, same as disableMfa/regenerateRecoveryCodes
  // elsewhere) — without this, the form stayed open with the admin's own
  // password still sitting in the input, and once the target's mfaEnabled
  // flips to false the "Reset MFA" toggle button that could close it
  // disappears too, leaving it permanently stuck open.
  const wasResetPending = useRef(false);
  useEffect(() => {
    if (wasResetPending.current && !resetPending && !resetError) {
      setShowReset(false);
    }
    wasResetPending.current = resetPending;
  }, [resetPending, resetError]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <form action={roleAction} className="flex items-end gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <div className="space-y-1">
            <Label htmlFor={`role-${user.id}`} className="text-xs">
              Role
            </Label>
            <Select id={`role-${user.id}`} name="role" defaultValue={user.role} className="h-8 text-xs">
              <option value="ADMIN">Admin</option>
              <option value="ATTORNEY">Attorney</option>
              <option value="PARALEGAL">Paralegal</option>
              <option value="STAFF">Staff</option>
            </Select>
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={rolePending}>
            Update role
          </Button>
        </form>

        <form action={statusAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="status" value={user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />
          <Button type="submit" size="sm" variant="outline" disabled={statusPending}>
            {user.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
          </Button>
        </form>

        <form action={mfaRequiredAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="mfaRequired" value={user.mfaRequired ? "false" : "true"} />
          <Button type="submit" size="sm" variant="outline" disabled={mfaRequiredPending}>
            {user.mfaRequired ? "Don't require MFA" : "Require MFA"}
          </Button>
        </form>

        {user.mfaEnabled && (
          <Button type="button" size="sm" variant="outline" onClick={() => setShowReset((value) => !value)}>
            Reset MFA
          </Button>
        )}

        <ResetPasswordControl userId={user.id} />
        <RemoveUserControl userId={user.id} />
      </div>

      {(roleError || statusError || mfaRequiredError) && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {roleError || statusError || mfaRequiredError}
        </p>
      )}

      {showReset && (
        <form action={resetAction} className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <input type="hidden" name="userId" value={user.id} />
          <p className="text-xs text-muted-foreground">
            Confirm your own password{" "}
            {"(and your own current code, if you have MFA enabled)"} to clear {user.name}&apos;s MFA and force
            re-enrollment. This never reveals their previous secret or recovery codes.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input name="adminPassword" type="password" autoComplete="current-password" placeholder="Your password" required />
            <Input name="adminCode" type="text" inputMode="text" autoComplete="one-time-code" placeholder="Your code (if MFA enabled)" />
          </div>
          {resetError && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {resetError}
            </p>
          )}
          <Button type="submit" size="sm" variant="destructive" disabled={resetPending}>
            {resetPending ? "Resetting…" : "Confirm MFA reset"}
          </Button>
        </form>
      )}
    </div>
  );
}

/** Mirrors the "Create user" temp-password reveal (create-user-form.tsx) — shown exactly once, never stored. */
function ResetPasswordControl({ userId }: { userId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setPending(true);
    const result = await resetUserPassword(userId);
    setPending(false);
    if (result.status === "success") {
      setTemporaryPassword(result.temporaryPassword);
    } else {
      setError(result.message);
    }
  }

  if (temporaryPassword) {
    return (
      <div className="space-y-1 rounded-md border border-border bg-muted/40 p-2">
        <p className="text-xs text-muted-foreground">
          New temporary password — hand off through a secure channel, shown once:
        </p>
        <p className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs">{temporaryPassword}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={handleClick}>
        {pending ? "Resetting…" : "Reset password"}
      </Button>
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Archives (status -> INACTIVE, Matter assignments removed) unless the account has zero historical relations, in which case it's actually deleted — see lib/admin/users/actions.ts#removeUser. */
function RemoveUserControl({ userId }: { userId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"archived" | "deleted" | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    setError(null);
    setPending(true);
    const result = await removeUser(userId);
    setPending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setOutcome(result.status);
  }

  if (outcome) {
    return (
      <p className="text-xs font-medium text-foreground">
        {outcome === "deleted" ? "Account deleted." : "Account archived — deactivated and removed from all matters."}
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="destructive" onClick={() => setConfirming(true)}>
        Remove…
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
      <p className="text-xs text-muted-foreground">
        Removes an unused account entirely, or archives one with history (deactivates it and clears its matter
        assignments). Are you sure?
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={handleConfirm}>
          {pending ? "Removing…" : "Confirm remove"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

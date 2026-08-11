"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { setUserActive, setUserMfaRequired, setUserRole } from "@/lib/admin/users/actions";
import { adminResetMfa } from "@/lib/auth/mfa/actions";
import type { AdminUserSummary } from "@/lib/admin/users/queries";

export function UserRow({ user, isCurrentAdmin }: { user: AdminUserSummary; isCurrentAdmin: boolean }) {
  const [roleError, roleAction, rolePending] = useActionState(setUserRole, undefined);
  const [activeError, activeAction, activePending] = useActionState(setUserActive, undefined);
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
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={user.active ? "success" : "secondary"}>{user.active ? "Active" : "Deactivated"}</Badge>
          <Badge variant={user.mfaEnabled ? "success" : "outline"}>
            {user.mfaEnabled ? "MFA enrolled" : "Not enrolled"}
          </Badge>
          {user.mfaRequired && <Badge variant="warning">MFA required</Badge>}
        </div>
      </div>

      {isCurrentAdmin ? (
        <p className="text-xs text-muted-foreground">
          This is your own account — role, activation, and MFA reset for it aren&apos;t available here.
        </p>
      ) : (
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

          <form action={activeAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="active" value={user.active ? "false" : "true"} />
            <Button type="submit" size="sm" variant="outline" disabled={activePending}>
              {user.active ? "Deactivate" : "Reactivate"}
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
        </div>
      )}

      {(roleError || activeError || mfaRequiredError) && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {roleError || activeError || mfaRequiredError}
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

"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { disableMfa, regenerateRecoveryCodes } from "@/lib/auth/mfa/actions";

function ReauthFields() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="password">Current password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code">Current code</Label>
        <Input
          id="code"
          name="code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          required
          placeholder="123456 or XXXX-XXXX-XXXX"
        />
      </div>
    </div>
  );
}

/**
 * Both actions here require the current password AND a current TOTP/
 * recovery code — re-authentication, not just an open session — before
 * they can weaken or reset MFA on this account (see
 * lib/auth/mfa/actions.ts#disableMfa / #regenerateRecoveryCodes).
 */
export function MfaManagementForms() {
  const [disableError, disableAction, disablePending] = useActionState(disableMfa, undefined);
  const [regenResult, regenAction, regenPending] = useActionState(regenerateRecoveryCodes, undefined);
  const [mode, setMode] = useState<"none" | "disable" | "regenerate">("none");

  if (regenResult?.status === "success") {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">
          Save these new recovery codes now — the old ones no longer work, and these will not be shown again.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
          {regenResult.recoveryCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMode(mode === "regenerate" ? "none" : "regenerate")}
        >
          Regenerate recovery codes
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setMode(mode === "disable" ? "none" : "disable")}>
          Disable MFA
        </Button>
      </div>

      {mode === "regenerate" && (
        <form action={regenAction} className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm text-muted-foreground">
            Confirm your password and a current code to generate a fresh set of recovery codes.
          </p>
          <ReauthFields />
          {regenResult?.status === "error" && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {regenResult.message}
            </p>
          )}
          <Button type="submit" size="sm" disabled={regenPending}>
            {regenPending ? "Regenerating…" : "Regenerate codes"}
          </Button>
        </form>
      )}

      {mode === "disable" && (
        <form action={disableAction} className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm text-muted-foreground">
            Confirm your password and a current code to turn off two-factor authentication.
          </p>
          <ReauthFields />
          {disableError && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {disableError}
            </p>
          )}
          <Button type="submit" variant="destructive" size="sm" disabled={disablePending}>
            {disablePending ? "Disabling…" : "Disable MFA"}
          </Button>
        </form>
      )}
    </div>
  );
}

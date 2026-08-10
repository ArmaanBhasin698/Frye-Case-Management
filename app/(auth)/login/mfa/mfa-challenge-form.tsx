"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyMfaChallenge } from "@/lib/auth/mfa/actions";

export function MfaChallengeForm({ callbackUrl }: { callbackUrl: string }) {
  const [errorMessage, formAction, isPending] = useActionState(verifyMfaChallenge, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <div className="space-y-1.5">
        <Label htmlFor="code">Authenticator or recovery code</Label>
        <Input
          id="code"
          name="code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          required
          placeholder="123456 or XXXX-XXXX-XXXX"
        />
      </div>

      {errorMessage && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}

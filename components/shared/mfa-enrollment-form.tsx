"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfirmEnrollmentResult } from "@/lib/auth/mfa/actions";

type ConfirmAction = (
  prevState: ConfirmEnrollmentResult | undefined,
  formData: FormData,
) => Promise<ConfirmEnrollmentResult>;

/**
 * Shared QR-scan-then-confirm enrollment UI, used by both the forced
 * pre-session setup flow (app/(auth)/login/mfa/setup) and the self-service
 * flow (app/(dashboard)/account/security). `confirmAction` is the only
 * thing that differs between them. Recovery codes are rendered exactly
 * once, from the Server Action's response — they are never fetched again
 * after this render.
 */
export function MfaEnrollmentForm({
  qrDataUrl,
  secret,
  confirmAction,
  children,
}: {
  qrDataUrl: string;
  secret: string;
  confirmAction: ConfirmAction;
  children: (result: { status: "success"; recoveryCodes: string[] }) => React.ReactNode;
}) {
  const [result, formAction, isPending] = useActionState(confirmAction, undefined);

  if (result?.status === "success") {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">
          Save these recovery codes somewhere safe. Each one can be used once if you lose access to your
          authenticator app — they will not be shown again.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
          {result.recoveryCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
        {children(result)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable remote image */}
        <img src={qrDataUrl} alt="Authenticator QR code" className="h-40 w-40 rounded-md border border-border" />
        <p className="text-center text-xs text-muted-foreground">
          Can&apos;t scan it? Enter this code manually: <span className="font-mono">{secret}</span>
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="123456"
          />
        </div>

        {result?.status === "error" && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {result.message}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Confirming…" : "Confirm and enable MFA"}
        </Button>
      </form>
    </div>
  );
}

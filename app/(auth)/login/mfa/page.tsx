import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/shared/logo";
import { prisma } from "@/lib/db";
import { readPendingTicket } from "@/lib/auth/mfa/tickets";
import { MfaChallengeForm } from "./mfa-challenge-form";

/**
 * Reachable only via the signed pending-challenge cookie set by the login
 * action after a correct password for an MFA-enabled account (see
 * app/(auth)/login/actions.ts) — there is no NextAuth session at this
 * point, so proxy.ts would otherwise redirect here straight to /login;
 * this route is excluded from that gate the same way /login itself is.
 */
export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  const pending = await readPendingTicket();
  if (!pending) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({ where: { id: pending.userId }, select: { mfaEnabled: true } });
  if (!user?.mfaEnabled) {
    const suffix = callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : "";
    redirect(`/login/mfa/setup${suffix}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size="lg" />
          <div>
            <h1 className="font-serif text-lg font-semibold text-foreground">Frye Law Group</h1>
            <p className="text-sm text-muted-foreground">Case Management</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Two-factor verification</CardTitle>
            <CardDescription>Enter the code from your authenticator app, or a recovery code.</CardDescription>
          </CardHeader>
          <CardContent>
            <MfaChallengeForm callbackUrl={callbackUrl ?? "/"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

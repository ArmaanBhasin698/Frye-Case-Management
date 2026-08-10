import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/shared/logo";
import { MfaEnrollmentForm } from "@/components/shared/mfa-enrollment-form";
import { confirmForcedEnrollment, finishForcedEnrollment, getForcedEnrollmentSetup } from "@/lib/auth/mfa/actions";

/**
 * Forced enrollment for an account with mfaRequired=true and
 * mfaEnabled=false — reached the same way as /login/mfa (a signed pending
 * ticket, no session yet). Confirming here marks mfaEnabled=true but does
 * NOT by itself complete sign-in; the user must submit the "Continue"
 * form (finishForcedEnrollment) so the pending ticket is consumed and the
 * NextAuth session is created exactly the way a normal MFA challenge
 * success would (see lib/auth/mfa/actions.ts).
 */
export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  const setup = await getForcedEnrollmentSetup();
  if (!setup) {
    redirect("/login");
  }

  const qrDataUrl = await QRCode.toDataURL(setup.otpauthUri);

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
            <CardTitle>Set up two-factor authentication</CardTitle>
            <CardDescription>This account requires an authenticator app before you can continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <MfaEnrollmentForm qrDataUrl={qrDataUrl} secret={setup.secret} confirmAction={confirmForcedEnrollment}>
              {() => (
                <form action={finishForcedEnrollment}>
                  <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
                  <Button type="submit" className="w-full">
                    Continue
                  </Button>
                </form>
              )}
            </MfaEnrollmentForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

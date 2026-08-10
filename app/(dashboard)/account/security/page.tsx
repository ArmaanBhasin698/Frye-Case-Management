import QRCode from "qrcode";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { confirmSelfEnrollment, getSelfEnrollmentSetup } from "@/lib/auth/mfa/actions";
import { MfaEnrollmentForm } from "@/components/shared/mfa-enrollment-form";
import { MfaManagementForms } from "./mfa-management-forms";

export default async function AccountSecurityPage() {
  const user = await requireCurrentUser();
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { mfaEnabled: true } });

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Two-factor authentication</h1>
        <p className="text-sm text-muted-foreground">Manage the authenticator app protecting your account.</p>
      </div>

      {dbUser?.mfaEnabled ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Status</CardTitle>
              <CardDescription>Two-factor authentication is protecting this account.</CardDescription>
            </div>
            <Badge variant="success">Enabled</Badge>
          </CardHeader>
          <CardContent>
            <MfaManagementForms />
          </CardContent>
        </Card>
      ) : (
        <EnrollmentCard />
      )}
    </div>
  );
}

async function EnrollmentCard() {
  const setup = await getSelfEnrollmentSetup();
  if (!setup) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Set up two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Unable to start enrollment. Please refresh the page.</p>
        </CardContent>
      </Card>
    );
  }

  const qrDataUrl = await QRCode.toDataURL(setup.otpauthUri);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
        <CardDescription>Scan the QR code with an authenticator app, then confirm with a current code.</CardDescription>
      </CardHeader>
      <CardContent>
        <MfaEnrollmentForm qrDataUrl={qrDataUrl} secret={setup.secret} confirmAction={confirmSelfEnrollment}>
          {() => (
            <p className="text-sm text-muted-foreground">
              Two-factor authentication is now enabled for your account.
            </p>
          )}
        </MfaEnrollmentForm>
      </CardContent>
    </Card>
  );
}

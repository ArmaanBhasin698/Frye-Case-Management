import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/shared/logo";
import { ChangePasswordForm } from "./change-password-form";

/**
 * Reached the same way /login/mfa is — after a correct password for an
 * account with mustChangePassword=true, before any session exists (see
 * app/(auth)/login/actions.ts and lib/auth/login-flow.ts). No ticket/
 * session identifies the user here; the form itself re-collects the
 * current password and verifies it server-side (see ./actions.ts).
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; callbackUrl?: string }>;
}) {
  const { email, callbackUrl } = await searchParams;

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
            <CardTitle>Set a new password</CardTitle>
            <CardDescription>
              This account was created with a temporary password. Choose your own before continuing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm email={email ?? ""} callbackUrl={callbackUrl ?? "/"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

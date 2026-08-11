import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth/config";
import { createPendingTicket } from "@/lib/auth/mfa/tickets";
import type { VerifiedCredentialsUser } from "@/lib/auth/credentials";

/**
 * Shared post-password-verification routing, used by both the login
 * Server Action (app/(auth)/login/actions.ts) and the change-password
 * Server Action (app/(auth)/login/change-password/actions.ts) so the two
 * call sites can't drift on gate ordering or duplicate the branching.
 *
 * Order: password-change requirement first, then MFA. A temporary
 * password is more likely to have passed through an admin/out-of-band
 * channel than one the account holder chose themselves, so minimizing how
 * long it stays the active credential takes priority — and the ordering
 * is safe either way, since MFA enrollment is tied to the account, not the
 * password, and no session exists until *every* gate below has passed.
 * `authorize()` (lib/auth/config.ts) independently refuses to complete
 * sign-in for any account with `mustChangePassword`, `mfaEnabled`, or
 * `mfaRequired` set — that refusal, not this routing, is what actually
 * prevents a bypass; this function only decides where to send the user
 * next after a correct password.
 */
export async function routeAfterPasswordVerified(
  user: VerifiedCredentialsUser,
  password: string,
  callbackUrl: string,
): Promise<void> {
  if (user.mustChangePassword) {
    const params = new URLSearchParams({ email: user.email, callbackUrl });
    redirect(`/login/change-password?${params.toString()}`);
  }

  if (user.mfaEnabled || user.mfaRequired) {
    await createPendingTicket(user.id);
    const destination = user.mfaEnabled ? "/login/mfa" : "/login/mfa/setup";
    redirect(`${destination}?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  await signIn("credentials", { email: user.email, password, redirectTo: callbackUrl });
}

"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/config";
import { verifyPassword } from "@/lib/auth/credentials";
import { createPendingTicket } from "@/lib/auth/mfa/tickets";

/**
 * Server Action backing the login form (see app/login/login-form.tsx).
 * Password verification happens here, not inside `signIn`, so an
 * MFA-enabled or MFA-required account can be routed into a second-factor
 * or forced-enrollment flow WITHOUT ever calling `signIn` — no NextAuth
 * session is created until that flow succeeds (see
 * lib/auth/config.ts's `authorize()`, which independently refuses to
 * complete sign-in for such an account regardless of how it's called).
 * `signIn` still redirects on success by throwing internally — that throw
 * is not an AuthError, so it passes through the catch below and Next.js
 * handles the navigation.
 */
export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = formData.get("email");
  const password = formData.get("password");
  const callbackUrl = (formData.get("callbackUrl") as string) || "/";

  if (typeof email !== "string" || typeof password !== "string") {
    return "Invalid email or password.";
  }

  const user = await verifyPassword(email, password);
  if (!user) {
    return "Invalid email or password.";
  }

  if (user.mfaEnabled || user.mfaRequired) {
    await createPendingTicket(user.id);
    const destination = user.mfaEnabled ? "/login/mfa" : "/login/mfa/setup";
    redirect(`${destination}?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  try {
    await signIn("credentials", { email, password, redirectTo: callbackUrl });
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return "Invalid email or password.";
        default:
          return "Something went wrong. Please try again.";
      }
    }
    throw error;
  }
}

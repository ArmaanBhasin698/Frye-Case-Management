"use server";

import { AuthError } from "next-auth";

import { verifyPassword } from "@/lib/auth/credentials";
import { routeAfterPasswordVerified } from "@/lib/auth/login-flow";

/**
 * Server Action backing the login form (see app/login/login-form.tsx).
 * Password verification happens here, not inside `signIn`, so an account
 * requiring a password change or MFA can be routed into the right
 * pre-session flow WITHOUT ever calling `signIn` — no NextAuth session is
 * created until that flow succeeds (see lib/auth/config.ts's
 * `authorize()`, which independently refuses to complete sign-in for such
 * an account regardless of how it's called, and lib/auth/login-flow.ts
 * for the shared gate ordering). `signIn`/`redirect` both redirect on
 * success by throwing internally — that throw is not an AuthError, so it
 * passes through the catch below and Next.js handles the navigation.
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

  try {
    await routeAfterPasswordVerified(user, password, callbackUrl);
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

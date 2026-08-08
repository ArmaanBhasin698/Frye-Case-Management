"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/config";

/**
 * Server Action backing the login form (see app/login/login-form.tsx).
 * `signIn` redirects on success by throwing internally — that throw is not
 * an AuthError, so it passes through the catch below and Next.js handles
 * the navigation. Only real sign-in failures return an error string.
 */
export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: (formData.get("callbackUrl") as string) || "/",
    });
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

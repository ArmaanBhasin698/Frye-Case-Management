"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/credentials";
import { routeAfterPasswordVerified } from "@/lib/auth/login-flow";

/**
 * Completes the forced first-login password change. The user re-enters
 * their current (temporary) password themselves — re-verified server-side
 * via the same `verifyPassword()` every other auth path uses — rather than
 * this page relying on any ticket/cookie carried over from the login form.
 * That keeps the plaintext password from ever touching a URL, cookie, or
 * query string, at the cost of one extra re-entry the user just typed
 * seconds earlier. On success, routes through the exact same shared
 * `routeAfterPasswordVerified` the login action uses, so MFA enforcement
 * afterward is identical either way.
 */

const changePasswordSchema = z
  .object({
    newPassword: z.string().min(12, "New password must be at least 12 characters.").max(200),
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "New passwords don't match.",
    path: ["confirmNewPassword"],
  });

export async function changePassword(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = formData.get("email");
  const currentPassword = formData.get("currentPassword");
  const callbackUrl = (formData.get("callbackUrl") as string) || "/";

  if (typeof email !== "string" || !email || typeof currentPassword !== "string" || !currentPassword) {
    return "Enter your current password.";
  }

  const parsed = changePasswordSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmNewPassword: formData.get("confirmNewPassword"),
  });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid input.";
  }

  const user = await verifyPassword(email, currentPassword);
  if (!user) {
    return "Incorrect email or current password.";
  }
  if (parsed.data.newPassword === currentPassword) {
    return "Choose a different password than your current one.";
  }

  const newPasswordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newPasswordHash, mustChangePassword: false },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      metadata: { event: "password_changed_first_login" },
    },
  });

  try {
    await routeAfterPasswordVerified({ ...user, mustChangePassword: false }, parsed.data.newPassword, callbackUrl);
  } catch (error) {
    if (error instanceof AuthError) {
      return "Something went wrong completing sign-in. Please try again.";
    }
    throw error;
  }
}

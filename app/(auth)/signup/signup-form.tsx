"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerAccount, type SignUpResult } from "@/lib/auth/signup";

const INITIAL_STATE: SignUpResult | undefined = undefined;

export function SignUpForm() {
  const [result, formAction, isPending] = useActionState(registerAccount, INITIAL_STATE);

  if (result?.status === "success") {
    return (
      <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-center">
        <p className="text-sm font-medium text-foreground">Account created.</p>
        <p className="text-sm text-muted-foreground">
          An administrator needs to approve your account before you can sign in. You&apos;ll be notified once that
          happens.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" autoComplete="given-name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" autoComplete="family-name" required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@fryelawgroup.example"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
      </div>

      {result?.status === "error" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {result.message}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Your account will need administrator approval before you can sign in.
      </p>
    </form>
  );
}

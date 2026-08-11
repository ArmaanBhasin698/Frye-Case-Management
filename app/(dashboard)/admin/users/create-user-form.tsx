"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createUser } from "@/lib/admin/users/actions";

export function CreateUserForm() {
  const [result, formAction, isPending] = useActionState(createUser, undefined);
  // Without this, once one user is created there is no way to create a
  // second one short of a full page reload — the success view replaced
  // the form permanently. Reset on the submit event itself (not an effect)
  // so it's ready to show the *next* result once this submission resolves.
  const [dismissed, setDismissed] = useState(false);

  if (result?.status === "success" && !dismissed) {
    return (
      <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
        <p className="text-sm font-medium text-foreground">
          User created. Hand off this temporary password through a secure channel — it will not be shown again. The
          account must change it and complete MFA setup at first login.
        </p>
        <p className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
          {result.temporaryPassword}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setDismissed(true)}>
          Create another user
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" onSubmit={() => setDismissed(false)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required placeholder="Jordan Rivera" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required placeholder="jordan.rivera@fryelawgroup.example" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" defaultValue="STAFF" required>
            <option value="ADMIN">Admin</option>
            <option value="ATTORNEY">Attorney</option>
            <option value="PARALEGAL">Paralegal</option>
            <option value="STAFF">Staff</option>
          </Select>
        </div>
        <div className="flex items-end gap-2 pb-1.5">
          <input id="mfaRequired" name="mfaRequired" type="checkbox" defaultChecked className="h-4 w-4" />
          <Label htmlFor="mfaRequired" className="!mb-0">
            Require MFA enrollment
          </Label>
        </div>
      </div>

      {result?.status === "error" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {result.message}
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create user"}
      </Button>
    </form>
  );
}

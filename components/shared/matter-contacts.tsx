"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { addContactToMatter, removeContactFromMatter, type FormActionState } from "@/lib/contacts/actions";
import { CONTACT_CATEGORY_GROUPS, CONTACT_CATEGORY_LABELS } from "@/lib/contacts/labels";

const INITIAL_STATE: FormActionState = { error: null };

/**
 * Link an existing directory contact to this matter, or jump to New
 * Contact pre-linked to it. `contacts` is pre-scoped to what this user can
 * see; `addContactToMatter` re-checks both the contact and the matter.
 */
export function AddMatterContactForm({
  matterId,
  contacts,
}: {
  matterId: string;
  contacts: { id: string; label: string }[];
}) {
  const [state, formAction, isPending] = useActionState(addContactToMatter, INITIAL_STATE);
  const [open, setOpen] = React.useState(false);
  const [prevState, setPrevState] = React.useState(state);

  if (state !== prevState) {
    setPrevState(state);
    if (!state.error) setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Add existing contact
        </Button>
        <Button size="sm" asChild>
          <Link href={`/contacts/new?matterId=${matterId}`}>New contact</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="matterId" value={matterId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mc-contact">Contact</Label>
          <Select id="mc-contact" name="contactId" required defaultValue="">
            <option value="" disabled>
              Choose a contact…
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mc-role">Role in this matter</Label>
          <Select id="mc-role" name="role" required defaultValue="">
            <option value="" disabled>
              Choose a role…
            </option>
            {CONTACT_CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.categories.map((c) => (
                  <option key={c} value={c}>
                    {CONTACT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="mc-roleDetail">Role detail (optional)</Label>
          <Input id="mc-roleDetail" name="roleDetail" placeholder="e.g. Arresting officer, State's witness" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mc-start">Involved from (optional)</Label>
          <Input id="mc-start" name="startDate" type="date" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mc-end">Involved until (optional)</Label>
          <Input id="mc-end" name="endDate" type="date" />
        </div>
      </div>
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Adding…" : "Add to matter"}
        </Button>
      </div>
    </form>
  );
}

export function RemoveMatterContactButton({ matterContactId }: { matterContactId: string }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function remove() {
    if (!window.confirm("Remove this contact from the matter? The contact record itself is kept.")) return;
    setError(null);
    setPending(true);
    const result = await removeContactFromMatter({ matterContactId });
    setPending(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
        Remove
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

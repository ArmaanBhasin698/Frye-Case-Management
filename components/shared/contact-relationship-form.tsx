"use client";

import * as React from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createContactRelationship, deleteContactRelationship, type FormActionState } from "@/lib/contacts/actions";
import { RELATIONSHIP_TYPE_LABELS, RELATIONSHIP_TYPE_VALUES } from "@/lib/contacts/labels";

const INITIAL_STATE: FormActionState = { error: null };

type Option = { id: string; label: string };

/**
 * "Add associated person": records "<other> is <type> of this contact".
 * Contact and matter options are pre-scoped server-side; the action
 * re-checks both contacts' visibility and the matter's access.
 */
export function ContactRelationshipForm({
  contactId,
  contacts,
  matters,
}: {
  contactId: string;
  contacts: Option[];
  matters: Option[];
}) {
  const [state, formAction, isPending] = useActionState(createContactRelationship, INITIAL_STATE);
  const [open, setOpen] = React.useState(false);
  const [scope, setScope] = React.useState<"PERMANENT" | "MATTER">("PERMANENT");
  const [prevState, setPrevState] = React.useState(state);

  if (state !== prevState) {
    setPrevState(state);
    if (!state.error) setOpen(false);
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add associated person
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="contactId" value={contactId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rel-other">Person or organization</Label>
          <Select id="rel-other" name="otherContactId" required defaultValue="">
            <option value="" disabled>
              Choose a contact…
            </option>
            {contacts
              .filter((c) => c.id !== contactId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rel-type">…is this contact&apos;s</Label>
          <Select id="rel-type" name="type" required defaultValue="">
            <option value="" disabled>
              Choose a relationship…
            </option>
            {RELATIONSHIP_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {RELATIONSHIP_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rel-scope">Scope</Label>
          <Select
            id="rel-scope"
            name="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as "PERMANENT" | "MATTER")}
          >
            <option value="PERMANENT">Permanent (personal relationship)</option>
            <option value="MATTER">Specific to one matter</option>
          </Select>
        </div>
        {scope === "MATTER" && (
          <div className="space-y-1.5">
            <Label htmlFor="rel-matter">Matter</Label>
            <Select id="rel-matter" name="matterId" required defaultValue="">
              <option value="" disabled>
                Choose a matter…
              </option>
              {matters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rel-context">Context (optional)</Label>
          <Textarea id="rel-context" name="context" rows={2} />
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
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteRelationshipButton({ relationshipId }: { relationshipId: string }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function remove() {
    if (!window.confirm("Remove this association? The contacts themselves are not affected.")) return;
    setError(null);
    setPending(true);
    const result = await deleteContactRelationship({ relationshipId });
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

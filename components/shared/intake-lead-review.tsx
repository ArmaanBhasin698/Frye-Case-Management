"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createClientFromIntakeLead,
  dismissIntakeLead,
  linkIntakeLeadToExistingClient,
} from "@/lib/intake/reviewActions";
import type { ActionResult } from "@/lib/matters/actions";

type IntakeLeadSummary = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
};

type ClientOption = { id: string; firstName: string; lastName: string };

const DISMISS_INITIAL: ActionResult = { ok: false, error: "" };
const LINK_INITIAL: ActionResult = { ok: false, error: "" };
const CREATE_INITIAL: { error: string | null } = { error: null };

export function DismissIntakeLeadForm({ intakeLeadId }: { intakeLeadId: string }) {
  const [state, formAction, isPending] = useActionState(dismissIntakeLead, DISMISS_INITIAL);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="intakeLeadId" value={intakeLeadId} />
      {!state.ok && state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Dismissing…" : "Dismiss lead"}
      </Button>
    </form>
  );
}

export function LinkIntakeLeadForm({
  intakeLeadId,
  clients,
}: {
  intakeLeadId: string;
  clients: ClientOption[];
}) {
  const [state, formAction, isPending] = useActionState(linkIntakeLeadToExistingClient, LINK_INITIAL);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="intakeLeadId" value={intakeLeadId} />
      <div className="space-y-1.5">
        <Label htmlFor="link-clientId">Existing client</Label>
        <Select id="link-clientId" name="clientId" required defaultValue="">
          <option value="" disabled>
            Select a client…
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.lastName}, {client.firstName}
            </option>
          ))}
        </Select>
      </div>
      {!state.ok && state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={isPending || clients.length === 0}>
        {isPending ? "Linking…" : "Link to this client"}
      </Button>
    </form>
  );
}

export function CreateClientFromIntakeLeadForm({ lead }: { lead: IntakeLeadSummary }) {
  const [state, formAction, isPending] = useActionState(createClientFromIntakeLead, CREATE_INITIAL);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="intakeLeadId" value={lead.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-firstName">First name</Label>
          <Input id="new-firstName" name="firstName" required defaultValue={lead.firstName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-lastName">Last name</Label>
          <Input id="new-lastName" name="lastName" required defaultValue={lead.lastName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-dateOfBirth">Date of birth</Label>
          <Input id="new-dateOfBirth" name="dateOfBirth" type="date" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-email">Email</Label>
          <Input id="new-email" name="email" type="email" defaultValue={lead.email ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-phone">Phone</Label>
          <Input id="new-phone" name="phone" defaultValue={lead.phone ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="new-address">Address</Label>
          <Input id="new-address" name="address" placeholder="Street, city, state" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="new-notes">Notes</Label>
          <Textarea id="new-notes" name="notes" rows={3} placeholder="Optional intake notes…" />
        </div>
      </div>
      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create client and link"}
        </Button>
      </div>
    </form>
  );
}

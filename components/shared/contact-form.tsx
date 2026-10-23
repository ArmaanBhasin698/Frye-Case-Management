"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { ContactCategory, ContactKind } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createContact, updateContact, type ContactFormState } from "@/lib/contacts/actions";
import type { ContactFormInitial } from "@/lib/contacts/fields";
import {
  CONTACT_CATEGORY_GROUPS,
  CONTACT_CATEGORY_LABELS,
  PREFERRED_CONTACT_METHOD_LABELS,
  PREFERRED_CONTACT_METHOD_VALUES,
  PROFESSIONAL_COURT_CATEGORIES,
} from "@/lib/contacts/labels";

const INITIAL_STATE: ContactFormState = { error: null };

type Option = { id: string; label: string };

/**
 * Create/edit form for a directory contact. Organization and staff
 * options arrive already scoped server-side (visible organizations, active
 * staff); the Server Action re-validates both regardless. When `link` is
 * given (creating from a matter's Contacts tab) the new contact is linked
 * to that matter in the same transaction.
 *
 * Duplicate warnings come back from the server as `state.duplicates` and
 * only ever list contacts this user can already see; submitting again with
 * "create anyway" sets `confirmDuplicate`.
 */
export function ContactForm({
  initial,
  organizations,
  staff,
  link,
  clientLinked = false,
  cancelHref,
}: {
  initial: ContactFormInitial;
  organizations: Option[];
  staff: Option[];
  link?: { matterId: string; matterLabel: string };
  clientLinked?: boolean;
  cancelHref: string;
}) {
  const isEdit = Boolean(initial.id);
  const [state, formAction, isPending] = useActionState(isEdit ? updateContact : createContact, INITIAL_STATE);
  const [kind, setKind] = React.useState<ContactKind>(initial.kind);
  const [categories, setCategories] = React.useState<Set<ContactCategory>>(new Set(initial.categories));
  // Stable row keys so removing a middle row doesn't shift the remaining
  // (uncontrolled) inputs' values. Initial rows key by position; rows
  // added later take keys from a counter read only in click handlers.
  const nextKey = React.useRef(0);
  const [phones, setPhones] = React.useState(() =>
    (initial.phones.length ? initial.phones : [{ label: "", number: "" }]).map((row, i) => ({ ...row, key: `initial-${i}` })),
  );
  const [emails, setEmails] = React.useState(() =>
    (initial.emails.length ? initial.emails : [{ label: "", address: "" }]).map((row, i) => ({ ...row, key: `initial-${i}` })),
  );
  const newKey = () => `added-${nextKey.current++}`;
  const [, startTransition] = React.useTransition();

  // Submitted via onSubmit rather than <form action>: React resets an
  // uncontrolled form after an `action` submission, which would wipe
  // everything the user typed when the server answers with a duplicate
  // warning or a validation error.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const showCourtFields = [...categories].some((c) => PROFESSIONAL_COURT_CATEGORIES.has(c));
  const duplicates = state.duplicates ?? [];

  function toggleCategory(category: ContactCategory) {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-border bg-card p-6">
      {initial.id && <input type="hidden" name="contactId" value={initial.id} />}
      {link && <input type="hidden" name="linkMatterId" value={link.matterId} />}
      {duplicates.length > 0 && <input type="hidden" name="confirmDuplicate" value="1" />}

      {link && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
          <Label htmlFor="contact-linkRole">Role on {link.matterLabel}</Label>
          <Select id="contact-linkRole" name="linkRole" required defaultValue="">
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
      )}

      <section className="space-y-4">
        {clientLinked ? (
          <>
            <input type="hidden" name="kind" value="INDIVIDUAL" />
            <p className="text-sm text-muted-foreground">
              This is a client&apos;s directory entry — the name, email, phone, and address are managed on the
              client record.
            </p>
          </>
        ) : (
          <div className="flex gap-4 text-sm">
            {(["INDIVIDUAL", "ORGANIZATION"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {value === "INDIVIDUAL" ? "Individual" : "Organization"}
              </label>
            ))}
          </div>
        )}

        {!clientLinked && kind === "INDIVIDUAL" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-firstName">First name</Label>
              <Input id="contact-firstName" name="firstName" required defaultValue={initial.firstName} placeholder="e.g. Jordan" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-lastName">Last name</Label>
              <Input id="contact-lastName" name="lastName" required defaultValue={initial.lastName} placeholder="e.g. Ellis" />
            </div>
          </div>
        )}
        {!clientLinked && kind === "ORGANIZATION" && (
          <div className="space-y-1.5">
            <Label htmlFor="contact-organizationName">Organization name</Label>
            <Input
              id="contact-organizationName"
              name="organizationName"
              required
              defaultValue={initial.organizationName}
              placeholder="e.g. Example County Sheriff's Office"
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {kind === "INDIVIDUAL" && (
            <div className="space-y-1.5">
              <Label htmlFor="contact-organizationId">Organization</Label>
              <Select id="contact-organizationId" name="organizationId" defaultValue={initial.organizationId}>
                <option value="">None</option>
                {organizations
                  .filter((o) => o.id !== initial.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="contact-jobTitle">Job title</Label>
            <Input id="contact-jobTitle" name="jobTitle" defaultValue={initial.jobTitle} />
          </div>
        </div>
      </section>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Categories</legend>
        <p className="text-xs text-muted-foreground">
          Select every role that applies. Current/former client status is derived from the client&apos;s matters.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CONTACT_CATEGORY_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
              {group.categories.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="categories"
                    value={c}
                    checked={categories.has(c)}
                    onChange={() => toggleCategory(c)}
                  />
                  {CONTACT_CATEGORY_LABELS[c]}
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>

      {showCourtFields && (
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="contact-court">Court</Label>
            <Input id="contact-court" name="court" defaultValue={initial.court} placeholder="e.g. Example County Superior Court" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-jurisdiction">Jurisdiction</Label>
            <Input id="contact-jurisdiction" name="jurisdiction" defaultValue={initial.jurisdiction} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-position">Position</Label>
            <Input id="contact-position" name="position" defaultValue={initial.position} placeholder="e.g. Presiding Judge" />
          </div>
        </section>
      )}

      {!clientLinked && (
        <section className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Phone numbers</p>
            <p className="text-xs text-muted-foreground">The first number is the primary.</p>
            {phones.map((phone) => (
              <div key={phone.key} className="flex gap-2">
                <Input name="phoneLabel" aria-label="Phone label" className="w-28" defaultValue={phone.label} placeholder="Mobile" />
                <Input name="phoneNumber" aria-label="Phone number" defaultValue={phone.number} placeholder="555-0100" />
                {phones.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPhones(phones.filter((p) => p.key !== phone.key))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setPhones([...phones, { label: "", number: "", key: newKey() }])}>
              Add phone
            </Button>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Email addresses</p>
            <p className="text-xs text-muted-foreground">The first address is the primary.</p>
            {emails.map((email) => (
              <div key={email.key} className="flex gap-2">
                <Input name="emailLabel" aria-label="Email label" className="w-28" defaultValue={email.label} placeholder="Work" />
                <Input name="emailAddress" aria-label="Email address" type="email" defaultValue={email.address} placeholder="name@example.com" />
                {emails.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEmails(emails.filter((e) => e.key !== email.key))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setEmails([...emails, { label: "", address: "", key: newKey() }])}>
              Add email
            </Button>
          </div>
        </section>
      )}

      {!clientLinked && (
        <section className="grid gap-4 sm:grid-cols-6">
          <div className="space-y-1.5 sm:col-span-6">
            <Label htmlFor="contact-addressLine1">Mailing address</Label>
            <Input id="contact-addressLine1" name="addressLine1" defaultValue={initial.addressLine1} placeholder="Street address" />
            <Input name="addressLine2" aria-label="Address line 2" defaultValue={initial.addressLine2} placeholder="Suite, unit (optional)" />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="contact-city">City</Label>
            <Input id="contact-city" name="city" defaultValue={initial.city} />
          </div>
          <div className="space-y-1.5 sm:col-span-1">
            <Label htmlFor="contact-state">State</Label>
            <Input id="contact-state" name="state" defaultValue={initial.state} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="contact-postalCode">Postal code</Label>
            <Input id="contact-postalCode" name="postalCode" defaultValue={initial.postalCode} />
          </div>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-preferred">Preferred communication</Label>
          <Select id="contact-preferred" name="preferredContactMethod" defaultValue={initial.preferredContactMethod}>
            <option value="">No preference</option>
            {PREFERRED_CONTACT_METHOD_VALUES.map((m) => (
              <option key={m} value={m}>
                {PREFERRED_CONTACT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-assignedStaff">Assigned staff member</Label>
          <Select id="contact-assignedStaff" name="assignedStaffId" defaultValue={initial.assignedStaffId}>
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="contact-notes">Notes</Label>
          <Textarea id="contact-notes" name="notes" rows={3} defaultValue={initial.notes} />
        </div>
      </section>

      {duplicates.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" role="alert">
          <p className="font-medium text-amber-900">Possible duplicate — you may already have this contact:</p>
          <ul className="list-disc space-y-1 pl-5">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/contacts/${d.id}`} className="font-medium underline" target="_blank">
                  {d.displayName}
                </Link>{" "}
                <span className="text-muted-foreground">(matching {d.reasons.join(", ")})</span>
              </li>
            ))}
          </ul>
          <p className="text-amber-900">
            If this is a different person or organization, submit again to create it anyway.
          </p>
        </div>
      )}

      {state.error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : duplicates.length > 0 ? "Create anyway" : isEdit ? "Save Contact" : "Create Contact"}
        </Button>
      </div>
    </form>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

import { prisma } from "@/lib/db";
import { getContactMeetingHistory } from "@/lib/calendar/queries";
import { formatInZone } from "@/lib/calendar/timezone";
import { requireCurrentUser } from "@/lib/auth/session";
import { canManageClientsAndMatters } from "@/lib/auth/authorization";
import { getContactDetail, listAccessibleMatterOptions, listContactOptions } from "@/lib/contacts/queries";
import { CLIENT_STATUS_LABELS } from "@/lib/contacts/history";
import {
  CONTACT_CATEGORY_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  INTERACTION_TYPE_LABELS,
  PREFERRED_CONTACT_METHOD_LABELS,
  relationshipLabelFor,
} from "@/lib/contacts/labels";
import {
  asCalendarDate,
  callDirectionLabel,
  formatCallDuration,
  matterStatusLabel,
  matterStatusVariant,
  matterTitle,
} from "@/lib/matters/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArchiveContactButton } from "@/components/shared/archive-contact-button";
import { ScheduleWithContactLink } from "@/components/shared/calendar/schedule-with-contact-link";
import { ContactRelationshipForm, DeleteRelationshipButton } from "@/components/shared/contact-relationship-form";
import { CompleteFollowUpButton, ContactInteractionForm } from "@/components/shared/contact-interaction-form";
import {
  PROFESSIONAL_HISTORY_CATEGORIES,
  ProfessionalHistorySection,
  readHistoryFilters,
} from "@/components/shared/history/professional-history-section";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {value || "—"}
    </p>
  );
}

/**
 * Contact profile. `getContactDetail` returns null for a contact this user
 * can't see (same not-found page as a nonexistent id), and every
 * matter-derived section on it is already limited to matters this user can
 * access — including the client-status badge.
 */
export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { contactId } = await params;
  const historyFilters = readHistoryFilters(await searchParams);
  const user = await requireCurrentUser();
  const detail = await getContactDetail(user, contactId);
  if (!detail) notFound();
  const { contact, clientStatus, associatedMatters, relationships, timeline } = detail;

  const [contactOptions, matterOptions, staff, meetings] = await Promise.all([
    listContactOptions(user),
    listAccessibleMatterOptions(user),
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getContactMeetingHistory(user, contactId),
  ]);
  const matterSelect = matterOptions.map((m) => ({ id: m.id, label: `${m.caseNumber} — ${matterTitle(m)}` }));

  const address = [contact.addressLine1, contact.addressLine2, [contact.city, contact.state, contact.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/contacts" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; All contacts
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="page-title">{contact.displayName}</h1>
            {contact.archived && <Badge variant="secondary">Archived</Badge>}
            {clientStatus && (
              <Badge variant={clientStatus === "CURRENT" ? "success" : "secondary"}>{CLIENT_STATUS_LABELS[clientStatus]}</Badge>
            )}
            {contact.kind === "ORGANIZATION" && <Badge variant="outline">Organization</Badge>}
            {contact.categories.map((c) => (
              <Badge key={c} variant="outline">
                {CONTACT_CATEGORY_LABELS[c]}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[contact.jobTitle, contact.organization?.displayName].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/contacts/${contact.id}/edit`}>Edit Contact</Link>
          </Button>
          {canManageClientsAndMatters(user) && <ArchiveContactButton contactId={contact.id} archived={contact.archived} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {contact.client ? (
              <>
                <Field label="Email" value={contact.client.email} />
                <Field label="Phone" value={contact.client.phone} />
                <Field label="Address" value={contact.client.address} />
                {canManageClientsAndMatters(user) && (
                  <p className="pt-1">
                    <Link href={`/clients/${contact.client.id}`} className="text-primary hover:underline">
                      Open client record
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <>
                {contact.phones.length === 0 && <Field label="Phone" value={null} />}
                {contact.phones.map((p) => (
                  <Field key={p.id} label={`Phone${p.label ? ` (${p.label})` : ""}${p.isPrimary ? " — primary" : ""}`} value={p.number} />
                ))}
                {contact.emails.length === 0 && <Field label="Email" value={null} />}
                {contact.emails.map((e) => (
                  <Field key={e.id} label={`Email${e.label ? ` (${e.label})` : ""}${e.isPrimary ? " — primary" : ""}`} value={e.address} />
                ))}
                <Field label="Mailing address" value={address} />
              </>
            )}
            <Field
              label="Preferred communication"
              value={contact.preferredContactMethod ? PREFERRED_CONTACT_METHOD_LABELS[contact.preferredContactMethod] : null}
            />
            <Field label="Assigned staff" value={contact.assignedStaff?.name} />
            {(contact.court || contact.jurisdiction || contact.position) && (
              <>
                <Field label="Court" value={contact.court} />
                <Field label="Jurisdiction" value={contact.jurisdiction} />
                <Field label="Position" value={contact.position} />
              </>
            )}
            <Field label="Last contacted" value={contact.lastContactedAt ? format(contact.lastContactedAt, "MMM d, yyyy") : null} />
            <Field
              label="Created"
              value={`${format(contact.createdAt, "MMM d, yyyy")}${contact.createdBy ? ` by ${contact.createdBy.name}` : ""}`}
            />
            <Field label="Last updated" value={format(contact.updatedAt, "MMM d, yyyy")} />
            {contact.notes && <p className="whitespace-pre-wrap pt-2 text-muted-foreground">{contact.notes}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Associated matters</CardTitle>
          </CardHeader>
          <CardContent>
            {associatedMatters.length === 0 ? (
              <p className="text-sm text-muted-foreground">No associated matters you have access to.</p>
            ) : (
              <ul className="divide-y divide-border">
                {associatedMatters.map((row) => (
                  <li key={`${row.matter.id}-${row.role}`} className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={`/matters/${row.matter.id}`} className="text-sm font-medium text-foreground hover:underline">
                        {matterTitle(row.matter)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {row.matter.caseNumber} · Role: {row.role === "CLIENT" ? "Client" : CONTACT_CATEGORY_LABELS[row.role]}
                        {row.roleDetail ? ` (${row.roleDetail})` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          row.startDate || row.endDate
                            ? `${row.startDate ? format(asCalendarDate(row.startDate), "MMM d, yyyy") : "—"} – ${
                                row.endDate ? format(asCalendarDate(row.endDate), "MMM d, yyyy") : "present"
                              }`
                            : null,
                          row.leadAttorney ? `Lead: ${row.leadAttorney}` : null,
                          row.lastInteractionAt ? `Last interaction ${format(row.lastInteractionAt, "MMM d, yyyy")}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Badge variant={matterStatusVariant(row.matter.status)}>{matterStatusLabel(row.matter.status)}</Badge>
                      {row.matter.archived && <Badge variant="secondary">Archived</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {contact.kind === "ORGANIZATION" && contact.members.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>People at this organization</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {contact.members.map((m) => (
                <li key={m.id}>
                  <Link href={`/contacts/${m.id}`} className="font-medium hover:underline">
                    {m.displayName}
                  </Link>
                  {m.jobTitle && <span className="text-muted-foreground"> · {m.jobTitle}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Associated with</CardTitle>
          <ContactRelationshipForm
            contactId={contact.id}
            contacts={contactOptions.map((c) => ({ id: c.id, label: c.displayName }))}
            matters={matterSelect}
          />
        </CardHeader>
        <CardContent>
          {relationships.length === 0 ? (
            <p className="text-sm text-muted-foreground">No associated people recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {relationships.map((r) => {
                const other = r.fromContactId === contact.id ? r.toContact : r.fromContact;
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <Link href={`/contacts/${other.id}`} className="font-medium hover:underline">
                        {other.displayName}
                      </Link>
                      <span className="text-muted-foreground"> — {relationshipLabelFor(r, contact.id)}</span>
                      <p className="text-xs text-muted-foreground">
                        {r.scope === "MATTER" && r.matter ? `Matter-specific: ${r.matter.caseNumber}` : "Permanent relationship"}
                        {r.context ? ` · ${r.context}` : ""}
                      </p>
                    </div>
                    <DeleteRelationshipButton relationshipId={r.id} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {contact.categories.some((c) => PROFESSIONAL_HISTORY_CATEGORIES.has(c)) && (
        <ProfessionalHistorySection
          user={user}
          contactId={contact.id}
          isJudge={contact.categories.includes("JUDGE")}
          filters={historyFilters}
          matterOptions={matterSelect}
        />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Meetings &amp; appointments</CardTitle>
          {!contact.archived && <ScheduleWithContactLink contactId={contact.id} />}
        </CardHeader>
        <CardContent>
          {meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calendar events you can see are linked to this contact.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {meetings.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={`/calendar/events/${m.id}`} className="font-medium hover:underline">
                      {m.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatInZone(
                        m.startTime,
                        m.timeZone,
                        m.allDay ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" },
                      )}
                      {m.matter ? ` · ${m.matter.caseNumber}` : " · Internal"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.status === "CANCELLED" && <Badge variant="secondary">Cancelled</Badge>}
                    {m.meetingUrl && m.status !== "CANCELLED" && (
                      <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                        Join meeting
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Interaction history</CardTitle>
          <ContactInteractionForm
            contactId={contact.id}
            matters={matterSelect}
            staff={staff.map((s) => ({ id: s.id, label: s.name }))}
            currentUserId={user.id}
          />
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded interactions.</p>
          ) : (
            <ol className="space-y-3">
              {timeline.map((entry) => (
                <li key={`${entry.source}-${entry.id}`} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{INTERACTION_TYPE_LABELS[entry.type]}</Badge>
                      <span className="font-medium">{format(entry.occurredAt, "MMM d, yyyy h:mm a")}</span>
                      {entry.staffName && <span className="text-muted-foreground">· {entry.staffName}</span>}
                      {entry.matter && (
                        <Link href={`/matters/${entry.matter.id}`} className="text-muted-foreground hover:underline">
                          · {entry.matter.caseNumber}
                        </Link>
                      )}
                    </div>
                    {entry.source === "interaction" && entry.followUpStatus !== "NONE" && (
                      <Badge variant={entry.followUpStatus === "PENDING" ? "warning" : "secondary"}>
                        {FOLLOW_UP_STATUS_LABELS[entry.followUpStatus]}
                      </Badge>
                    )}
                  </div>
                  {entry.source === "call" && entry.callDirection && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {callDirectionLabel(entry.callDirection)} call · {formatCallDuration(entry.callDurationSeconds ?? 0)}
                    </p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap">{entry.summary}</p>
                  {entry.outcome && <p className="mt-1 text-muted-foreground">Outcome: {entry.outcome}</p>}
                  {entry.source === "interaction" && entry.followUpStatus === "PENDING" && (
                    <div className="mt-2">
                      <CompleteFollowUpButton interactionId={entry.id} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Fictional, provider-neutral fixtures shaped like Loop/HighLevel contact
 * webhook payloads. No real person's information — every name/email/phone
 * here is invented. Used by tests only; never sent to or received from
 * Loop/HighLevel.
 */

export const newLeadEvent = {
  type: "ContactCreate",
  contactId: "fictional-contact-0001",
  firstName: "Jordan",
  lastName: "Ellis",
  email: "jordan.ellis.fictional@example.com",
  phone: "+15550142000",
  dateAdded: "2026-01-01T12:00:00Z",
};

export const updatedLeadEvent = {
  type: "ContactUpdate",
  contactId: "fictional-contact-0001",
  firstName: "Jordan",
  lastName: "Ellis",
  email: "jordan.ellis.fictional@example.com",
  phone: "+15550142111",
  dateAdded: "2026-01-01T12:00:00Z",
};

/** Same contactId as `newLeadEvent` — simulates a retried/duplicated webhook delivery. */
export const duplicateNewLeadEvent = { ...newLeadEvent };

export const incompleteLeadEvent = {
  type: "ContactCreate",
  contactId: "fictional-contact-0002",
  firstName: "Maria",
  // lastName missing — a common "form partially filled out" real-world case.
  dateAdded: "2026-01-02T09:30:00Z",
};

export const malformedLeadEvent = {
  type: "SomethingElseEntirely",
  contactId: "fictional-contact-0003",
};

/**
 * Shaped like the real HighLevel contacts API response (see
 * docs/INTEGRATION_ARCHITECTURE.md's live-verified finding): `id` instead
 * of `contactId`, and no discrete `firstName`/`lastName` — only a combined
 * `contactName`, which normalizeIntakeLead must split.
 */
export const restShapedContactNameOnlyEvent = {
  type: "ContactCreate",
  id: "fictional-contact-0004",
  contactName: "Taylor Rivera",
  email: "taylor.rivera.fictional@example.com",
  phone: "+15550142222",
  dateAdded: "2026-01-03T08:00:00Z",
};

/** A single-word contactName has no splittable last name — must be rejected as incomplete, not guessed at. */
export const unsplittableContactNameEvent = {
  type: "ContactCreate",
  id: "fictional-contact-0005",
  contactName: "Cher",
  dateAdded: "2026-01-04T08:00:00Z",
};

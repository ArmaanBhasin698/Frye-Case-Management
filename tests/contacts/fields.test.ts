import { describe, expect, it } from "vitest";

import { contactColumnsFrom, deriveDisplayName, emailRowsFrom, phoneRowsFrom, readContactFields } from "@/lib/contacts/fields";

function fd(entries: [string, string][]) {
  const formData = new FormData();
  for (const [key, value] of entries) formData.append(key, value);
  return formData;
}

describe("readContactFields", () => {
  it("requires first and last name for an individual", () => {
    const result = readContactFields(fd([["kind", "INDIVIDUAL"], ["firstName", "Jane"]]));
    expect(result.success).toBe(false);
  });

  it("requires an organization name for an organization", () => {
    const result = readContactFields(fd([["kind", "ORGANIZATION"]]));
    expect(result.success).toBe(false);
    expect(readContactFields(fd([["kind", "ORGANIZATION"], ["organizationName", "Example PD"]])).success).toBe(true);
  });

  it("accepts multiple categories and de-duplicates them", () => {
    const result = readContactFields(
      fd([
        ["firstName", "Jane"],
        ["lastName", "Doe"],
        ["categories", "WITNESS"],
        ["categories", "FAMILY_MEMBER"],
        ["categories", "WITNESS"],
      ]),
    );
    expect(result.success && result.data.categories).toEqual(["WITNESS", "FAMILY_MEMBER"]);
  });

  it("rejects an unknown category", () => {
    expect(readContactFields(fd([["firstName", "Jane"], ["lastName", "Doe"], ["categories", "NOT_A_ROLE"]])).success).toBe(false);
  });

  it("drops blank phone/email rows and pairs labels by position", () => {
    const result = readContactFields(
      fd([
        ["firstName", "Jane"],
        ["lastName", "Doe"],
        ["phoneLabel", "Mobile"],
        ["phoneNumber", "555-0100"],
        ["phoneLabel", ""],
        ["phoneNumber", "  "],
        ["emailLabel", "Work"],
        ["emailAddress", "Jane.Doe@Example.com"],
      ]),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.phones).toEqual([{ label: "Mobile", number: "555-0100" }]);
    expect(phoneRowsFrom(result.data)).toEqual([{ number: "555-0100", label: "Mobile", isPrimary: true }]);
    expect(emailRowsFrom(result.data)).toEqual([{ address: "jane.doe@example.com", label: "Work", isPrimary: true }]);
  });

  it("rejects an invalid email address", () => {
    expect(readContactFields(fd([["firstName", "Jane"], ["lastName", "Doe"], ["emailAddress", "nope"]])).success).toBe(false);
  });

  it("rejects a phone number with no digits", () => {
    expect(readContactFields(fd([["firstName", "Jane"], ["lastName", "Doe"], ["phoneNumber", "call me"]])).success).toBe(false);
  });
});

describe("deriveDisplayName / contactColumnsFrom", () => {
  it("builds the display name from the kind", () => {
    expect(deriveDisplayName({ kind: "INDIVIDUAL", firstName: "Jane", lastName: "Doe" })).toBe("Jane Doe");
    expect(deriveDisplayName({ kind: "ORGANIZATION", organizationName: " Example PD " })).toBe("Example PD");
  });

  it("clears person-only fields for an organization", () => {
    const parsed = readContactFields(
      fd([
        ["kind", "ORGANIZATION"],
        ["organizationName", "Example PD"],
        ["firstName", "Stray"],
        ["organizationId", "org-x"],
      ]),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const columns = contactColumnsFrom(parsed.data);
    expect(columns).toMatchObject({ displayName: "Example PD", firstName: null, lastName: null, organizationId: null });
  });
});

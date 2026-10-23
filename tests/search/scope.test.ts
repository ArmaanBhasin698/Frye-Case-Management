import { describe, expect, it } from "vitest";

import { SEARCH_TYPES, parseSearchParams, type SearchParams } from "@/lib/search/params";
import { buildTypeQuery, type SearchScope } from "@/lib/search/scope";

function params(extra: Record<string, string> = {}): SearchParams {
  const r = parseSearchParams({ q: "ellis", ...extra });
  if (!r.ok) throw new Error("bad params");
  return r.params;
}

const VISIBLE = { createdById: "visible-contacts-sentinel" };
const RULINGS = { matterId: { in: ["ruling-scope-sentinel"] } };
const OBSERVATIONS = { authorId: "observation-scope-sentinel" };

function scope(overrides: Partial<SearchScope> = {}): SearchScope {
  return {
    isAdmin: false,
    canSeeClients: false,
    assignedMatterIds: ["m1"],
    contactVisibility: VISIBLE,
    readableConversationIds: ["conv-1"],
    rulingFilter: RULINGS,
    observationFilter: OBSERVATIONS,
    ...overrides,
  };
}

const json = (v: unknown) => JSON.stringify(v);

describe("buildTypeQuery — authorization scope is part of every where", () => {
  it("restricts matter-linked types to assigned matters for non-admins", () => {
    for (const type of ["tasks", "documents", "time", "notes"] as const) {
      const q = buildTypeQuery(type, scope(), params())!;
      expect(json(q.where)).toContain(json({ matterId: { in: ["m1"] } }));
    }
    expect(json(buildTypeQuery("matters", scope(), params())!.where)).toContain(json({ id: { in: ["m1"] } }));
  });

  it("an unassigned user's scope is an empty id list — matches nothing", () => {
    const q = buildTypeQuery("notes", scope({ assignedMatterIds: [] }), params())!;
    expect(json(q.where)).toContain(json({ matterId: { in: [] } }));
  });

  it("admins get no matter restriction", () => {
    const q = buildTypeQuery("notes", scope({ isAdmin: true, assignedMatterIds: [] }), params())!;
    expect(json(q.where)).not.toContain('"in":[]');
    expect(json(q.where)).not.toContain('"matterId":{"in"');
  });

  it("hides the client type entirely from roles that can't use /clients", () => {
    expect(buildTypeQuery("clients", scope({ canSeeClients: false }), params())).toBeNull();
    expect(buildTypeQuery("clients", scope({ canSeeClients: true }), params())).not.toBeNull();
  });

  it("uses contact visibility for contacts and for observation subjects", () => {
    expect(json(buildTypeQuery("contacts", scope(), params())!.where)).toContain(json(VISIBLE));
    expect(json(buildTypeQuery("observations", scope(), params())!.where)).toContain(json({ subject: VISIBLE }));
  });

  it("searches chat only in readable conversations, excluding deleted messages", () => {
    const where = json(buildTypeQuery("chat", scope({ readableConversationIds: [] }), params())!.where);
    expect(where).toContain(json({ conversationId: { in: [] } }));
    expect(where).toContain(json({ deletedAt: null }));
  });

  it("applies professional-history filters and current versions only", () => {
    const rulings = json(buildTypeQuery("rulings", scope(), params())!.where);
    expect(rulings).toContain(json(RULINGS));
    expect(rulings).toContain(json({ supersededAt: null }));
    expect(json(buildTypeQuery("observations", scope(), params())!.where)).toContain(json(OBSERVATIONS));
  });

  it("labels documents as metadata-only: title, filename, tags — never contents", () => {
    const where = json(buildTypeQuery("documents", scope(), params())!.where);
    expect(where).toContain("originalFilename");
    expect(where).not.toMatch(/text|content/i);
  });

  it("adds (never replaces) the matter filter — the scope stays in the AND", () => {
    const where = json(buildTypeQuery("tasks", scope(), params({ matterId: "m-forged" }))!.where);
    expect(where).toContain(json({ matterId: { in: ["m1"] } }));
    expect(where).toContain(json({ matterId: "m-forged" }));
  });

  it("applies the active/archived matter filter", () => {
    expect(json(buildTypeQuery("tasks", scope(), params())!.where)).toContain(json({ matter: { archived: false } }));
    expect(json(buildTypeQuery("tasks", scope(), params({ archived: "archived" }))!.where)).toContain(json({ matter: { archived: true } }));
    expect(json(buildTypeQuery("tasks", scope(), params({ archived: "all" }))!.where)).not.toContain('"archived"');
  });

  it("uses case-insensitive partial matching for every type", () => {
    for (const type of SEARCH_TYPES) {
      const q = buildTypeQuery(type, scope({ canSeeClients: true }), params());
      expect(json(q!.where)).toContain('"contains":"ellis"');
    }
  });
});

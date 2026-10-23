import { describe, expect, it } from "vitest";

import { buildSnippet, parseSearchParams, searchHref, splitPage } from "@/lib/search/params";

describe("parseSearchParams", () => {
  it("bounds the query to 2–100 characters after trimming and collapsing whitespace", () => {
    expect(parseSearchParams({})).toEqual({ ok: false, reason: "empty" });
    expect(parseSearchParams({ q: "   " })).toEqual({ ok: false, reason: "empty" });
    expect(parseSearchParams({ q: " a " })).toEqual({ ok: false, reason: "too_short" });
    expect(parseSearchParams({ q: "x".repeat(101) })).toEqual({ ok: false, reason: "too_long" });
    const ok = parseSearchParams({ q: "  Jane   Doe " });
    expect(ok.ok && ok.params.q).toBe("Jane Doe");
  });

  it("drops invalid type, dates, matter ids and pages instead of erroring", () => {
    const r = parseSearchParams({ q: "ellis", type: "secrets", from: "2026-13-99x", matterId: "x'; DROP", page: "-4", archived: "bogus" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.type).toBeUndefined();
    expect(r.params.from).toBeUndefined();
    expect(r.params.matterId).toBeUndefined();
    expect(r.params.page).toBe(1);
    expect(r.params.archived).toBe("active");
  });

  it("turns the to-date into an exclusive next-day bound", () => {
    const r = parseSearchParams({ q: "ellis", from: "2026-01-01", to: "2026-01-31" });
    expect(r.ok && r.params.from).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(r.ok && r.params.to).toEqual(new Date("2026-02-01T00:00:00Z"));
  });
});

describe("buildSnippet", () => {
  it("excerpts around the first case-insensitive match", () => {
    const text = `${"a".repeat(100)} Body-cam footage reviewed ${"b".repeat(100)}`;
    const s = buildSnippet(text, "BODY-CAM", 10)!;
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("Body-cam");
  });

  it("returns null for empty text", () => {
    expect(buildSnippet(null, "x")).toBeNull();
  });
});

describe("splitPage (exact matches first, stable pagination)", () => {
  it("fills page 1 with exact matches first, then partial matches", () => {
    expect(splitPage(1, 25, 3)).toEqual({ exact: { skip: 0, take: 3 }, rest: { skip: 0, take: 22 } });
  });

  it("continues the partial segment at the right offset on later pages", () => {
    expect(splitPage(2, 25, 3)).toEqual({ exact: { skip: 0, take: 0 }, rest: { skip: 22, take: 25 } });
  });

  it("handles more exact matches than one page", () => {
    expect(splitPage(1, 25, 30)).toEqual({ exact: { skip: 0, take: 25 }, rest: { skip: 0, take: 0 } });
    expect(splitPage(2, 25, 30)).toEqual({ exact: { skip: 25, take: 5 }, rest: { skip: 0, take: 20 } });
  });

  it("never overlaps or skips rows across pages", () => {
    const exactCount = 7;
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const s = splitPage(page, 5, exactCount);
      for (let i = 0; i < s.exact.take; i++) seen.push(`e${s.exact.skip + i}`);
      for (let i = 0; i < s.rest.take; i++) seen.push(`r${s.rest.skip + i}`);
    }
    expect(seen).toEqual(["e0", "e1", "e2", "e3", "e4", "e5", "e6", "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
  });
});

describe("searchHref", () => {
  it("keeps filters and applies overrides", () => {
    const href = searchHref({ q: "ellis", type: "tasks", archived: "all", matterId: "m1" }, { page: 2 });
    expect(href).toBe("/search?q=ellis&type=tasks&matterId=m1&archived=all&page=2");
  });
});

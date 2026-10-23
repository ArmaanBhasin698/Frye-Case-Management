import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import {
  buildMatterCustomFieldFilter,
  formatValue,
  inputValue,
  parseFieldInput,
  parseOptions,
  sameColumns,
  slugifyKey,
  validateOptionsChange,
} from "@/lib/custom-fields/values";

const options = [
  { id: "opt_a", label: "Felony", archived: false },
  { id: "opt_b", label: "Misdemeanor", archived: false },
  { id: "opt_old", label: "Traffic", archived: true },
];
const def = (type: Parameters<typeof parseFieldInput>[0]["type"]) => ({ type, label: "Field", options });

describe("parseFieldInput", () => {
  it("treats an empty value as clearing the field for every type", () => {
    for (const t of ["SHORT_TEXT", "LONG_TEXT", "NUMBER", "BOOLEAN", "DATE", "SINGLE_SELECT"] as const) {
      expect(parseFieldInput(def(t), "   ")).toEqual({ ok: true, clear: true });
    }
  });

  it("validates short and long text", () => {
    expect(parseFieldInput(def("SHORT_TEXT"), "Example PD")).toMatchObject({ ok: true, columns: { valueText: "Example PD" } });
    expect(parseFieldInput(def("SHORT_TEXT"), "a\nb").ok).toBe(false);
    expect(parseFieldInput(def("SHORT_TEXT"), "x".repeat(201)).ok).toBe(false);
    expect(parseFieldInput(def("LONG_TEXT"), "line1\nline2")).toMatchObject({ ok: true, columns: { valueText: "line1\nline2" } });
    expect(parseFieldInput(def("LONG_TEXT"), "x".repeat(5001)).ok).toBe(false);
  });

  it("parses numbers exactly with at most 4 decimals and a sane range", () => {
    const r = parseFieldInput(def("NUMBER"), "1234.5678");
    expect(r.ok && !r.clear && r.columns.valueNumber?.toString()).toBe("1234.5678");
    expect(parseFieldInput(def("NUMBER"), "-3").ok).toBe(true);
    for (const bad of ["1.23456", "abc", "1e5", "Infinity", "NaN", "100000000000000"]) {
      expect(parseFieldInput(def("NUMBER"), bad).ok).toBe(false);
    }
  });

  it("accepts only true/false for booleans", () => {
    expect(parseFieldInput(def("BOOLEAN"), "true")).toMatchObject({ ok: true, columns: { valueBoolean: true } });
    expect(parseFieldInput(def("BOOLEAN"), "false")).toMatchObject({ ok: true, columns: { valueBoolean: false } });
    expect(parseFieldInput(def("BOOLEAN"), "yes").ok).toBe(false);
  });

  it("accepts only real calendar dates", () => {
    const r = parseFieldInput(def("DATE"), "2026-02-28");
    expect(r.ok && !r.clear && r.columns.valueDate?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    for (const bad of ["2026-02-30", "2026-13-01", "02/03/2026", "2026-2-3"]) {
      expect(parseFieldInput(def("DATE"), bad).ok).toBe(false);
    }
  });

  it("requires an existing, active option for a new selection", () => {
    expect(parseFieldInput(def("SINGLE_SELECT"), "opt_a")).toMatchObject({ ok: true, columns: { valueOptionId: "opt_a" } });
    expect(parseFieldInput(def("SINGLE_SELECT"), "opt_forged").ok).toBe(false);
    expect(parseFieldInput(def("SINGLE_SELECT"), "opt_old").ok).toBe(false);
  });

  it("lets an already-stored retired option be re-submitted unchanged", () => {
    expect(parseFieldInput(def("SINGLE_SELECT"), "opt_old", "opt_old")).toMatchObject({ ok: true, columns: { valueOptionId: "opt_old" } });
  });
});

describe("display and equality", () => {
  const stored = { valueText: null, valueNumber: null, valueBoolean: null, valueDate: null, valueOptionId: "opt_old" };

  it("still displays retired options and unknown ids honestly", () => {
    expect(formatValue({ type: "SINGLE_SELECT", options }, stored)).toBe("Traffic (retired)");
    expect(formatValue({ type: "SINGLE_SELECT", options }, { ...stored, valueOptionId: "gone" })).toBe("(unknown option)");
    expect(formatValue({ type: "BOOLEAN", options: null }, { ...stored, valueOptionId: null, valueBoolean: false })).toBe("No");
    expect(formatValue({ type: "NUMBER", options: null }, { ...stored, valueOptionId: null, valueNumber: new Prisma.Decimal("2.5") })).toBe("2.5");
    expect(inputValue({ type: "DATE" }, { ...stored, valueOptionId: null, valueDate: new Date("2026-01-05T00:00:00Z") })).toBe("2026-01-05");
  });

  it("detects no-op writes, including decimal normalization", () => {
    const a = { valueText: null, valueNumber: new Prisma.Decimal("2.50"), valueBoolean: null, valueDate: null, valueOptionId: null };
    const b = { valueText: null, valueNumber: new Prisma.Decimal("2.5"), valueBoolean: null, valueDate: null, valueOptionId: null };
    expect(sameColumns(a, b)).toBe(true);
    expect(sameColumns(a, { ...b, valueNumber: new Prisma.Decimal("3") })).toBe(false);
  });
});

describe("options and keys", () => {
  it("parses only well-formed options", () => {
    expect(parseOptions([{ id: "a", label: "A" }, { id: 1, label: "bad" }, null, "x"])).toEqual([{ id: "a", label: "A", archived: false }]);
    expect(parseOptions(null)).toEqual([]);
  });

  it("refuses deleting an option but allows retiring it", () => {
    expect(validateOptionsChange(options, options.slice(0, 2))).toMatch(/retired but not deleted/);
    expect(validateOptionsChange(options, options.map((o) => ({ ...o, archived: true })))).toBeNull();
    expect(validateOptionsChange([], [{ id: "x", label: "A", archived: false }, { id: "y", label: "a", archived: false }])).toMatch(/unique/);
  });

  it("slugifies labels into valid permanent keys", () => {
    expect(slugifyKey("Arresting Agency")).toBe("arresting_agency");
    expect(slugifyKey("123 Code")).toBe("f_123_code");
  });
});

describe("buildMatterCustomFieldFilter", () => {
  const matterSelect = { id: "def1", entity: "MATTER" as const, type: "SINGLE_SELECT" as const, options };

  it("builds an equality filter for a valid option", () => {
    expect(buildMatterCustomFieldFilter(matterSelect, "opt_a")).toEqual({
      customFieldValues: { some: { definitionId: "def1", valueOptionId: "opt_a" } },
    });
  });

  it("ignores forged options, non-matter definitions, and unsupported types instead of widening", () => {
    expect(buildMatterCustomFieldFilter(matterSelect, "opt_forged")).toBeNull();
    expect(buildMatterCustomFieldFilter({ ...matterSelect, entity: "CONTACT" }, "opt_a")).toBeNull();
    expect(buildMatterCustomFieldFilter({ ...matterSelect, type: "NUMBER" }, "1")).toBeNull();
    expect(buildMatterCustomFieldFilter({ ...matterSelect, type: "BOOLEAN" }, "maybe")).toBeNull();
  });

  it("matches short text case-insensitively and booleans exactly", () => {
    expect(buildMatterCustomFieldFilter({ ...matterSelect, type: "SHORT_TEXT" }, "Example PD")).toEqual({
      customFieldValues: { some: { definitionId: "def1", valueText: { equals: "Example PD", mode: "insensitive" } } },
    });
    expect(buildMatterCustomFieldFilter({ ...matterSelect, type: "BOOLEAN" }, "true")).toEqual({
      customFieldValues: { some: { definitionId: "def1", valueBoolean: true } },
    });
  });
});

import { CONTACT_CATEGORY_LABELS, CONTACT_CATEGORY_VALUES } from "@/lib/contacts/labels";

/**
 * Document-template merge fields — pure parsing, validation, and
 * rendering. Templates are plain text with `{{token}}` placeholders. The
 * catalog of allowed tokens is explicit: an unknown token is a validation
 * error, never silently rendered blank, and a known token with no value
 * is reported as missing so the user decides (fill it in, or explicitly
 * leave it blank) before anything is generated.
 */

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
export const MAX_TEMPLATE_BODY = 50_000;

export const STATIC_MERGE_FIELDS: { token: string; label: string }[] = [
  { token: "matter.caseNumber", label: "Matter case number" },
  { token: "matter.court", label: "Matter court" },
  { token: "matter.charges", label: "Matter charges" },
  { token: "matter.openedDate", label: "Matter opened date" },
  { token: "client.fullName", label: "Client full name" },
  { token: "client.firstName", label: "Client first name" },
  { token: "client.lastName", label: "Client last name" },
  { token: "client.address", label: "Client address" },
  { token: "client.email", label: "Client email" },
  { token: "client.phone", label: "Client phone" },
  { token: "firm.name", label: "Firm name" },
  { token: "today", label: "Today's date" },
  { token: "user.name", label: "Your name" },
];

export const CONTACT_MERGE_FIELDS = CONTACT_CATEGORY_VALUES.map((role) => ({
  token: `contact.${role}.displayName`,
  label: `Matter contact — ${CONTACT_CATEGORY_LABELS[role]}`,
}));

export type MergeCatalog = {
  /** Custom field keys that exist (active or archived) per entity. */
  customMatterKeys: string[];
  customClientKeys: string[];
};

export function parseTokens(body: string): string[] {
  const tokens = new Set<string>();
  for (const match of body.matchAll(TOKEN_RE)) tokens.add(match[1]!.trim());
  return [...tokens];
}

export function isKnownToken(token: string, catalog: MergeCatalog): boolean {
  if (STATIC_MERGE_FIELDS.some((f) => f.token === token)) return true;
  if (CONTACT_MERGE_FIELDS.some((f) => f.token === token)) return true;
  if (token.startsWith("custom.matter.")) return catalog.customMatterKeys.includes(token.slice("custom.matter.".length));
  if (token.startsWith("custom.client.")) return catalog.customClientKeys.includes(token.slice("custom.client.".length));
  return false;
}

export function validateTemplateBody(body: string, catalog: MergeCatalog): { error: string | null; unknown: string[] } {
  if (!body.trim()) return { error: "Template body is required.", unknown: [] };
  if (body.length > MAX_TEMPLATE_BODY) return { error: "Template body is too long.", unknown: [] };
  const unknown = parseTokens(body).filter((t) => !isKnownToken(t, catalog));
  return unknown.length > 0
    ? { error: `Unknown merge field${unknown.length === 1 ? "" : "s"}: ${unknown.map((u) => `{{${u}}}`).join(", ")}`, unknown }
    : { error: null, unknown: [] };
}

export type RenderResult = { text: string; missing: string[] };

/**
 * Substitutes values. Missing (null/empty) values are listed; they render
 * as empty text only when `leaveBlank` is set — otherwise the token is
 * left visible so a preview makes the gap obvious.
 */
export function renderTemplate(
  body: string,
  values: Record<string, string | null | undefined>,
  options: { leaveBlank?: boolean } = {},
): RenderResult {
  const missing = new Set<string>();
  const text = body.replace(TOKEN_RE, (whole, rawToken: string) => {
    const token = rawToken.trim();
    const value = values[token];
    if (value === null || value === undefined || value === "") {
      missing.add(token);
      return options.leaveBlank ? "" : whole;
    }
    return value;
  });
  return { text, missing: [...missing] };
}
